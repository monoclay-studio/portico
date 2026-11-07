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
