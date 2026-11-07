import { InProgressError, newId } from '@portico/kernel';
import { createTestDatabase, type TestDatabase, testContext } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drainOutbox, runIdempotent, sql, withTenantTx } from '../src';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase([]);
  // A throwaway tenant-owned table to exercise the standard isolation helpers.
  await sql`create schema demo;
    create table demo.notes (id uuid primary key, tenant_id uuid not null, body text not null, counter int not null default 0);
    select core.enable_tenant_isolation('demo.notes');
    select core.apply_standard_grants('demo');`.execute(t.admin.kysely);
});
afterAll(async () => t?.drop());

describe('tenant isolation (Row Level Security)', () => {
  it('a tenant can never read or write another tenant’s rows, even with a guessed id', async () => {
    const a = testContext();
    const b = testContext();
    const noteId = newId();
    await withTenantTx(t.db, a, (tx) =>
      tx.db
        .insertInto('demo.notes')
        .values({ id: noteId, tenant_id: a.tenantId, body: 'A secret' })
        .execute(),
    );

    const seenByB = await withTenantTx(t.db, b, (tx) =>
      tx.db.selectFrom('demo.notes').selectAll().where('id', '=', noteId).execute(),
    );
    expect(seenByB).toHaveLength(0);

    const updatedByB = await withTenantTx(t.db, b, (tx) =>
      tx.db.updateTable('demo.notes').set({ body: 'hacked' }).where('id', '=', noteId).executeTakeFirst(),
    );
    expect(Number(updatedByB.numUpdatedRows)).toBe(0);

    await expect(
      withTenantTx(t.db, b, (tx) =>
        tx.db
          .insertInto('demo.notes')
          .values({ id: newId(), tenant_id: a.tenantId, body: 'spoof' })
          .execute(),
      ),
    ).rejects.toThrow(/row-level security/);

    const seenByA = await withTenantTx(t.db, a, (tx) =>
      tx.db.selectFrom('demo.notes').select('body').where('id', '=', noteId).executeTakeFirst(),
    );
    expect(seenByA?.body).toBe('A secret');
  });

  it('fails closed when no tenant is set', async () => {
    const rows = await sql`select * from demo.notes`.execute(t.db.kysely);
    expect(rows.rows).toHaveLength(0);
  });
});

describe('audit log', () => {
  it('is append-only for the application role', async () => {
    const ctx = testContext();
    await withTenantTx(t.db, ctx, (tx) =>
      tx.audit({ action: 'test.thing.done', target: { type: 'thing', id: '1' }, after: { ok: true } }),
    );
    await expect(
      withTenantTx(t.db, ctx, (tx) =>
        tx.db.updateTable('core.audit_log').set({ action: 'tampered' }).execute(),
      ),
    ).rejects.toThrow(/permission denied|append-only/);
    await expect(
      withTenantTx(t.db, ctx, (tx) => tx.db.deleteFrom('core.audit_log').execute()),
    ).rejects.toThrow(/permission denied|append-only/);
  });
});

describe('idempotency', () => {
  it('executes once and replays the stored response for retries', async () => {
    const ctx = testContext();
    const id = newId();
    let executions = 0;
    const run = () =>
      runIdempotent(t.db, ctx, { scope: 'POST /notes', key: 'k-1', request: { body: 'x' } }, async (tx) => {
        executions++;
        await tx.db.insertInto('demo.notes').values({ id, tenant_id: ctx.tenantId, body: 'x' }).execute();
        return { status: 201, body: { id } };
      });
    const first = await run();
    const second = await run();
    expect(first.replayed).toBe(false);
    expect(second).toEqual({ status: 201, body: { id }, replayed: true });
    expect(executions).toBe(1);
  });

  it('serializes concurrent duplicates: exactly one execution', async () => {
    const ctx = testContext();
    let executions = 0;
    const run = () =>
      runIdempotent(
        t.db,
        ctx,
        { scope: 'POST /notes', key: 'k-concurrent', request: { n: 1 } },
        async (tx) => {
          executions++;
          await sql`select pg_sleep(0.2)`.execute(tx.db);
          await tx.db
            .insertInto('demo.notes')
            .values({ id: newId(), tenant_id: ctx.tenantId, body: 'once' })
            .execute();
          return { status: 201, body: { ok: true } };
        },
      );
    const results = await Promise.all([run(), run(), run()]);
    expect(executions).toBe(1);
    expect(results.filter((r) => r.replayed)).toHaveLength(2);
  });

  it('re-executes after a failed attempt (nothing was committed)', async () => {
    const ctx = testContext();
    let attempts = 0;
    const run = () =>
      runIdempotent(t.db, ctx, { scope: 'POST /x', key: 'k-fail', request: {} }, async () => {
        attempts++;
        if (attempts === 1) throw new InProgressError();
        return { status: 200, body: { attempt: attempts } };
      });
    await expect(run()).rejects.toThrow();
    expect((await run()).body).toEqual({ attempt: 2 });
  });

  it('rejects key reuse with a different request', async () => {
    const ctx = testContext();
    const run = (body: string) =>
      runIdempotent(t.db, ctx, { scope: 'POST /y', key: 'k-reuse', request: { body } }, async () => ({
        status: 200,
        body: {},
      }));
    await run('a');
    await expect(run('b')).rejects.toThrow(/different request/);
  });
});

describe('outbox', () => {
  it('delivers each event once per consumer, atomically with the consumer’s effects, retrying failures', async () => {
    const ctx = testContext();
    const noteId = newId();
    await withTenantTx(t.db, ctx, async (tx) => {
      await tx.db
        .insertInto('demo.notes')
        .values({ id: noteId, tenant_id: ctx.tenantId, body: 'evt' })
        .execute();
      await tx.emit({
        type: 'demo.note.created',
        aggregate: { type: 'note', id: noteId },
        payload: { noteId },
      });
    });
    let failOnce = true;
    const opts = {
      environmentOf: async () => 'live' as const,
      subscriptions: [
        {
          consumer: 'counter',
          types: ['demo.*'],
          handle: async (tx: import('../src').TxContext, e: import('@portico/kernel').DomainEvent) => {
            await tx.db
              .updateTable('demo.notes')
              .set({ counter: sql`counter + 1` })
              .where('id', '=', e.payload.noteId as string)
              .execute();
            if (failOnce) {
              failOnce = false;
              throw new Error('transient failure');
            }
          },
        },
      ],
    };
    await drainOutbox(t.db, opts);
    // first attempt failed and rolled back; delivery is scheduled for retry with backoff
    await sql`update core.event_deliveries set next_attempt_at = now()`.execute(t.admin.kysely);
    await drainOutbox(t.db, opts);
    await drainOutbox(t.db, opts);
    const note = await withTenantTx(t.db, ctx, (tx) =>
      tx.db.selectFrom('demo.notes').select('counter').where('id', '=', noteId).executeTakeFirstOrThrow(),
    );
    expect(note.counter).toBe(1);
  });
});

describe('scheduled jobs', () => {
  it('runs a job once per interval even when several workers race for it', async () => {
    const { runDueJobs } = await import('../src');
    let runs = 0;
    const job = {
      name: `test.job.${Date.now()}`,
      intervalSeconds: 3600,
      run: async () => {
        runs++;
      },
    };
    await Promise.all([runDueJobs(t.db, [job]), runDueJobs(t.db, [job]), runDueJobs(t.db, [job])]);
    expect(runs).toBe(1);
    await runDueJobs(t.db, [job]);
    expect(runs).toBe(1); // interval not elapsed
  });

  it('expires stored idempotency responses (they may contain personal data)', async () => {
    const ctx = testContext();
    await runIdempotent(t.db, ctx, { scope: 'POST /pii', key: 'k-exp', request: {} }, async () => ({
      status: 201,
      body: { name: 'Guest Name' },
    }));
    await sql`update core.idempotency_keys set expires_at = now() - interval '1 day' where key = 'k-exp'`.execute(
      t.admin.kysely,
    );
    const { rows } = await sql<{ n: number }>`select core.purge_expired_idempotency_keys(100) as n`.execute(
      t.db.kysely,
    );
    expect(rows[0]?.n).toBeGreaterThanOrEqual(1);
  });
});

describe('idempotency is bound to the caller', () => {
  it('never replays a stored response to a different user', async () => {
    const owner = testContext();
    const other = { ...testContext({ tenantId: owner.tenantId }), tenantId: owner.tenantId };
    const run = (ctx: typeof owner) =>
      runIdempotent(t.db, ctx, { scope: 'POST /guests', key: 'k-actor', request: { a: 1 } }, async () => ({
        status: 201,
        body: { secret: 'pii' },
      }));
    await run(owner);
    expect((await run(owner)).replayed).toBe(true);
    await expect(run(other)).rejects.toThrow(/different user or integration/);
  });
});

describe('idempotency without personal data (SW-GUE-1)', () => {
  const plan = {
    store: (b: { id: string; name: string }) => ({ id: b.id }),
    rebuild: async (tx: Parameters<Parameters<typeof withTenantTx>[2]>[0], s: { id: string }) => {
      const row = await tx.db
        .selectFrom('demo.notes')
        .select(['id', 'body'])
        .where('id', '=', s.id)
        .executeTakeFirst();
      if (!row) throw new Error('gone');
      return { id: row.id as string, name: row.body as string };
    },
  };

  it('a replay plan stores ids only and rebuilds the response from the current record', async () => {
    const ctx = testContext();
    const id = newId();
    const run = () =>
      runIdempotent(
        t.db,
        ctx,
        { scope: 'POST /people', key: 'k-plan', request: { n: 1 } },
        async (tx) => {
          await tx.db
            .insertInto('demo.notes')
            .values({ id, tenant_id: ctx.tenantId, body: 'Quilla Person' })
            .execute();
          return { status: 201, body: { id, name: 'Quilla Person' } };
        },
        { replay: plan },
      );
    expect((await run()).body).toEqual({ id, name: 'Quilla Person' });
    const { rows } = await sql<{ body: string }>`
      select response_body::text as body from core.idempotency_keys where key = 'k-plan'`.execute(
      t.admin.kysely,
    );
    expect(rows[0]?.body).not.toContain('Quilla');
    expect(JSON.parse(rows[0]?.body ?? '{}')).toEqual({ $replay: 1, ref: { id } });
    // The record changed since: the replay shows the current state, never a stored copy.
    await withTenantTx(t.db, ctx, (tx) =>
      tx.db.updateTable('demo.notes').set({ body: 'Renamed' }).where('id', '=', id).execute(),
    );
    const replay = await run();
    expect(replay).toMatchObject({ replayed: true, status: 201, body: { id, name: 'Renamed' } });
  });

  it('erasure redaction: responses mentioning the subject answer 410; short values never match', async () => {
    const { redactIdempotencyResponses } = await import('../src');
    const ctx = testContext();
    const subject = newId();
    const store = (key: string, body: unknown) =>
      runIdempotent(t.db, ctx, { scope: 'POST /x', key, request: {} }, async () => ({ status: 201, body }));
    await store('k-a', { bookerProfileId: subject, booker: 'Quilla Person' });
    await store('k-b', { email: 'quilla@guest.example' });
    await store('k-c', { other: 'unrelated record Ali' });
    const n = await withTenantTx(t.db, ctx, (tx) =>
      redactIdempotencyResponses(tx, { identifiers: [subject, 'quilla@guest.example', 'Ali'] }),
    );
    expect(n).toBe(2);
    await expect(store('k-a', {})).rejects.toMatchObject({ code: 'idempotent_response_erased', status: 410 });
    await expect(store('k-b', {})).rejects.toMatchObject({ status: 410 });
    expect((await store('k-c', {})).body).toEqual({ other: 'unrelated record Ali' });
    // Another tenant's records are never touched.
    const other = testContext();
    const kept = await runIdempotent(
      t.db,
      other,
      { scope: 'POST /x', key: 'k-a', request: {} },
      async () => ({
        status: 201,
        body: { bookerProfileId: subject },
      }),
    );
    expect(kept.replayed).toBe(false);
  });

  it('matches identifiers only as WHOLE string values, case-insensitively — never substrings, numbers or kept subjects', async () => {
    const { redactIdempotencyResponses } = await import('../src');
    const ctx = testContext();
    const subject = newId();
    const held = newId();
    const store = (key: string, body: unknown) =>
      runIdempotent(t.db, ctx, { scope: 'POST /m', key, request: {} }, async () => ({ status: 201, body }));
    const cases: Record<string, { body: unknown; erased: boolean }> = {
      // real copies — must be erased
      'mixed-case email': { body: { payer: { email: 'Quilla.E@Guest.Example' } }, erased: true },
      'deeply nested id': { body: { a: [{ b: { c: [subject] } }] }, erased: true },
      'e164 phone': { body: { contact: '+9607771234' }, erased: true },
      // unrelated — must survive
      'time zone containing a word': { body: { timezone: 'Indian/Maldives' }, erased: false },
      'amount containing the digits': { body: { amountMinor: 17771234, ref: '17771234x' }, erased: false },
      'longer phone with the same prefix': { body: { contact: '+96077712345' }, erased: false },
      'longer email ending the same': { body: { email: 'xquilla.e@guest.example' }, erased: false },
      'email inside free text': { body: { note: 'write to quilla.e@guest.example' }, erased: false },
      'another subject on legal hold': {
        body: { payer: held, email: 'quilla.e@guest.example' },
        erased: false,
      },
    };
    for (const [k, c] of Object.entries(cases)) await store(k, c.body);
    await withTenantTx(t.db, ctx, (tx) =>
      redactIdempotencyResponses(tx, {
        identifiers: [subject, 'quilla.e@guest.example', '+9607771234', 'Maldives', '7771234'],
        keep: [held],
      }),
    );
    for (const [k, c] of Object.entries(cases)) {
      const r = await store(k, {}).then(
        () => 'kept',
        (e: { status?: number }) => (e.status === 410 ? 'erased' : `error ${e.status}`),
      );
      expect(r, k).toBe(c.erased ? 'erased' : 'kept');
    }
  });

  it('after redaction every body answers 410 — the stored request hash is no oracle for the erased data', async () => {
    const { redactIdempotencyResponses } = await import('../src');
    const ctx = testContext();
    const subject = newId();
    const call = (request: unknown) =>
      runIdempotent(t.db, ctx, { scope: 'POST /oracle', key: 'k-oracle', request }, async () => ({
        status: 201,
        body: { profileId: subject },
      }));
    await call({ name: 'Quilla', dob: '1981-02-03' });
    await withTenantTx(t.db, ctx, (tx) => redactIdempotencyResponses(tx, { identifiers: [subject] }));
    await expect(call({ name: 'Quilla', dob: '1981-02-03' })).rejects.toMatchObject({ status: 410 });
    await expect(call({ name: 'Quilla', dob: '1980-01-01' })).rejects.toMatchObject({ status: 410 });
    const { rows } = await sql<{
      h: string;
    }>`select request_hash as h from core.idempotency_keys where key = 'k-oracle'`.execute(t.admin.kysely);
    expect(rows[0]?.h).toBe('erased');
  });

  it('a replay racing an erasure waits for it and then answers 410 (never the erased data)', async () => {
    const { redactIdempotencyResponses } = await import('../src');
    const ctx = testContext();
    const subject = newId();
    const replay = () =>
      runIdempotent(t.db, ctx, { scope: 'POST /race', key: 'k-race', request: {} }, async () => ({
        status: 201,
        body: { profileId: subject, name: 'Quilla Person' },
      }));
    await replay();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let redacted: () => void = () => {};
    const didRedact = new Promise<void>((r) => {
      redacted = r;
    });
    const erasure = withTenantTx(t.db, ctx, async (tx) => {
      await redactIdempotencyResponses(tx, { identifiers: [subject] });
      redacted();
      await gate; // erasure transaction still open
    });
    await didRedact;
    let settled = false;
    const racing = replay().then(
      (r) => {
        settled = true;
        return r;
      },
      (e: unknown) => {
        settled = true;
        throw e;
      },
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(settled).toBe(false); // waits on the erasure's row lock instead of reading the old body
    release();
    await erasure;
    await expect(racing).rejects.toMatchObject({ status: 410 });
  });
});

describe('savepoints', () => {
  it('rolls back only the failed part and keeps the transaction usable', async () => {
    const { withSavepoint, pgCode } = await import('../src');
    const ctx = testContext();
    const keep = newId();
    const dup = newId();
    await withTenantTx(t.db, ctx, async (tx) => {
      await tx.db
        .insertInto('demo.notes')
        .values({ id: keep, tenant_id: ctx.tenantId, body: 'kept' })
        .execute();
      await tx.db
        .insertInto('demo.notes')
        .values({ id: dup, tenant_id: ctx.tenantId, body: 'first' })
        .execute();
      const err = await withSavepoint(tx, 'sp_dup', () =>
        tx.db.insertInto('demo.notes').values({ id: dup, tenant_id: ctx.tenantId, body: 'again' }).execute(),
      ).catch((e: unknown) => e);
      expect(pgCode(err)).toBe('23505');
    });
    const rows = await withTenantTx(t.db, ctx, (tx) =>
      tx.db.selectFrom('demo.notes').select('id').where('id', 'in', [keep, dup]).execute(),
    );
    expect(rows).toHaveLength(2);
  });
});
