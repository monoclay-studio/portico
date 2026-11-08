/**
 * Regression tests from the steward review (fix round 1), the post-switch sweep seam: re-keyed exports never create
 * duplicates (R-P1-5), opening money after the switch waits for finance (R-P1-8), and the sweep's own writes are
 * never journaled as staff activity while staff writes always are (R-P2-3). PoCs from
 * `docs/orchestration/reviews/migration-poc/zz-review-integration.test.ts.txt`, inverted.
 */
import { sql } from '@portico/db';
import { type DomainEvent, ForbiddenError } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migration, sampleGuesthouseFiles } from '../src';
import { db } from '../src/service/context';
import { sampleGuesthousePack } from '../src/sources/templates';
import { LEAD, productionInSync } from './flows';
import { asSystem, type Harness, startHarness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const BD = '2026-12-01';
const pack = () => sampleGuesthousePack(BD);

async function switched() {
  const f = await productionInSync(h);
  await migration.runPipeline(h.t.db, h.deps, f.lead, f.jobId, { start: 'freeze' });
  expect((await f.live.run((tx) => migration.getJob(tx, f.jobId))).state).toBe('rollback_window');
  expect(await f.live.run((tx) => h.reservations.count(tx, f.live.propertyId))).toBe(8);
  return f;
}

async function openExceptions(f: Awaited<ReturnType<typeof switched>>) {
  return f.live.run((tx) => migration.listExceptions(tx, f.jobId, { status: 'open', limit: 200 }), f.lead);
}

describe('R-P1-5 a re-keyed export after the switch never creates duplicate bookings', () => {
  it('cn1003 is CN1003; CN1001-R (same Booking.com id) and CN1002-X (same stay) are held; only the real new booking is imported', async () => {
    const f = await switched();
    const p = pack();
    const reservations = p.reservations.map((r) =>
      r[0] === 'CN1003'
        ? ['cn1003', ...r.slice(1)]
        : r[0] === 'CN1001'
          ? ['CN1001-R', ...r.slice(1)]
          : r[0] === 'CN1002'
            ? ['CN1002-X', ...r.slice(1)]
            : r,
    );
    // A guest added in the old system after the final capture (the sweep's legitimate case).
    reservations.push(
      (p.reservations.find((r) => r[0] === 'CN1005') as string[]).map((v, i) =>
        i === 0 ? 'CN1100' : i === 6 ? 'G007' : i === 2 ? '2026-12-24' : i === 3 ? '2026-12-26' : v,
      ),
    );
    const guests = [...p.guests, ['G007', 'Nadia', 'Kareem', 'nadia.k@example.test', '', 'MV', '', 'en', '']];
    await migration.uploadFiles(h.t.db, h.deps, f.lead, f.jobId, {
      files: sampleGuesthouseFiles(BD, { reservations, guests }),
    });
    const sweepCtx = f.live.user('Lead', LEAD);
    await migration.sweep(h.t.db, h.deps, sweepCtx, f.jobId);
    expect(await f.live.run((tx) => h.reservations.count(tx, f.live.propertyId))).toBe(9);
    const bdc = await f.live.run((tx) =>
      sql<{
        keys: string[];
      }>`select array_agg(source_key order by source_key) as keys from fake_providers.bookings
        where property_id = ${f.live.propertyId} and source_key in ('CN1001', 'CN1001-R', 'CN1002', 'CN1002-X', 'CN1100')`.execute(
        tx.db,
      ),
    );
    expect(bdc.rows[0]?.keys).toEqual(['CN1001', 'CN1002', 'CN1100']);
    const ex = await openExceptions(f);
    expect(ex.filter((e) => e.severity === 'blocking').map((e) => `${e.sourceKey}:${e.code}`)).toEqual(
      expect.arrayContaining(['CN1001-R:rekeyed_channel_booking', 'CN1002-X:possible_duplicate_booking']),
    );
    // A second sweep imports nothing more.
    const again = await migration.sweep(h.t.db, h.deps, sweepCtx, f.jobId);
    expect(again.imported).toBe(0);

    // The reservations manager decides CN1002-X is a separate booking: import as is → imported exactly once.
    const target = ex.find((e) => e.sourceKey === 'CN1002-X' && e.code === 'possible_duplicate_booking') as {
      id: string;
    };
    await f.live.run(
      (tx) =>
        migration.resolveException(tx, target.id, {
          outcome: 'import_as_is',
          resolution: 'Second room booked separately by the same guest',
        }),
      f.lead,
    );
    await migration.sweep(h.t.db, h.deps, sweepCtx, f.jobId);
    await migration.sweep(h.t.db, h.deps, sweepCtx, f.jobId);
    expect(await f.live.run((tx) => h.reservations.count(tx, f.live.propertyId))).toBe(10);
    // A channel booking id is one booking: never "import as is".
    const channel = ex.find((e) => e.sourceKey === 'CN1001-R' && e.code === 'rekeyed_channel_booking') as {
      id: string;
    };
    await expect(
      f.live.run(
        (tx) => migration.resolveException(tx, channel.id, { outcome: 'import_as_is', resolution: 'x' }),
        f.lead,
      ),
    ).rejects.toMatchObject({ code: 'cannot_import_as_is' });

    // R-P2-3 (a): the sweep's own writes are the migration (server-issued actor), never staff activity.
    const own = await f.live.run((tx) =>
      sql<{
        id: string;
        type: string;
        aggregate_type: string;
        aggregate_id: string;
        occurred_at: Date;
        property_id: string | null;
        payload: unknown;
        actor: DomainEvent['actor'];
      }>`select id, type, aggregate_type, aggregate_id, occurred_at, property_id, payload, actor from core.outbox
         where correlation_id = ${sweepCtx.correlationId} and type like 'guests.profile.%'`.execute(tx.db),
    );
    expect(own.rows.length).toBeGreaterThan(0);
    const e = own.rows[0] as (typeof own.rows)[number];
    expect(e.actor).toEqual({ kind: 'system', process: 'migration' });
    const event: DomainEvent = {
      id: e.id,
      type: e.type,
      tenantId: f.live.tenantId,
      propertyId: e.property_id ?? f.live.propertyId,
      aggregate: { type: e.aggregate_type, id: e.aggregate_id },
      aggregateVersion: 1,
      occurredAt: e.occurred_at.toISOString(),
      actor: e.actor,
      correlationId: sweepCtx.correlationId,
      version: 1,
      payload: e.payload as Record<string, unknown>,
    };
    expect(await f.live.run((tx) => migration.journalEvent(asSystem(tx), event))).toBe(false);
    // (b) a staff write sent with the sweep's correlation id (a client-chosen X-Request-Id) is still journaled.
    const staff: DomainEvent = {
      ...event,
      id: crypto.randomUUID(),
      actor: { kind: 'user', userId: crypto.randomUUID() },
    };
    expect(await f.live.run((tx) => migration.journalEvent(asSystem(tx), staff))).toBe(true);
    // The sweep held the run lease (one runner at a time) and released it.
    const job = await f.live.run((tx) =>
      db(tx)
        .selectFrom('migration.jobs')
        .select(['run_correlations', 'running_by'])
        .where('id', '=', f.jobId)
        .executeTakeFirstOrThrow(),
    );
    expect(job.run_correlations).toContain(sweepCtx.correlationId);
    expect(job.running_by).toBeNull();
  });
});

describe('R-P1-8 after the switch, opening money waits for finance', () => {
  it('the lead sweeps a new USD 5,000 deposit: staged as a finance exception, not posted; finance confirms; posted once', async () => {
    const f = await switched();
    const p = pack();
    const deposits = [...p.deposits, ['CN1003', '5000.00', 'USD', '', '', BD]];
    await migration.uploadFiles(h.t.db, h.deps, f.lead, f.jobId, {
      files: sampleGuesthouseFiles(BD, { deposits }),
    });
    const lead = f.live.user('Lead', LEAD);
    expect(LEAD).not.toContain('migration.finance.signoff');
    await migration.sweep(h.t.db, h.deps, lead, f.jobId);
    const state = async () =>
      f.live.run(async (tx) => {
        const ledger = await migration.loadLedger(tx, await migration.getJob(tx, f.jobId));
        const b = ledger.get('reservation:CN1003')?.targetId as string;
        return {
          state: ledger.get('deposit:CN1003')?.state,
          deposit: await h.finance.getDeposits(asSystem(tx), b),
        };
      }, f.lead);
    const held = await state();
    expect(held.state).toBe('exception');
    expect(held.deposit?.balance.amountMinor ?? 0).toBe(0);
    const ex = (await openExceptions(f)).find(
      (e) => e.sourceKey === 'CN1003' && e.code === 'post_switch_money',
    );
    expect(ex).toMatchObject({ financial: true, ownerRole: 'Finance controller', severity: 'blocking' });
    // The lead cannot release money.
    await expect(
      f.live.run(
        (tx) =>
          migration.resolveException(tx, (ex as { id: string }).id, {
            outcome: 'import_as_is',
            resolution: 'post it',
          }),
        lead,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Finance confirms it: the next sweep posts it, exactly once.
    await f.live.run(
      (tx) =>
        migration.resolveException(tx, (ex as { id: string }).id, {
          outcome: 'import_as_is',
          resolution: 'Deposit confirmed against the bank statement',
        }),
      f.finance,
    );
    await migration.sweep(h.t.db, h.deps, lead, f.jobId);
    await migration.sweep(h.t.db, h.deps, lead, f.jobId);
    const posted = await state();
    expect(posted.state).toBe('imported');
    expect(posted.deposit?.balance.amountMinor).toBe(500000);
  });
});
