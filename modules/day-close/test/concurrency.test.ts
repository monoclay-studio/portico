/**
 * Concurrency (DCL-R04, DCL-R06, DCL-I05, EC-DCL-002/004/005/010): two auditors at once, two executors on one run,
 * a stale executor waking up after a take-over, postings arriving during the close (before, across and after the
 * advance), and a guest checking in during or after the close. Nobody is logged out or blocked: every other
 * command in these tests runs while Day Close holds its run.
 */
import { withTenantTx } from '@portico/db';
import { money, newId } from '@portico/kernel';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SimulatedCrash } from '../src';
import { LeaseLostError } from '../src/domain/errors';
import {
  addStay,
  assertBooksBalance,
  businessDate,
  checkIn,
  D,
  entriesByKey,
  type Harness,
  NIGHT,
  nightAudit,
  type Org,
  setupOrg,
  startHarness,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const DESK = ['finance.posting.create', 'finance.folio.read', 'dayClose.run.read'];

async function barCharge(org: Org, stayId: string, key: string, serviceDate = D, amountMinor = 5_000) {
  const desk = org.as(DESK, [org.propertyId], 'Bar');
  return withTenantTx(h.t.db, desk, (tx) =>
    h.finance.postCharge(tx, {
      propertyId: org.propertyId,
      target: { type: 'stay', id: stayId },
      chargeCode: 'FB_ALACARTE',
      amount: money(amountMinor, 'USD'),
      serviceDate,
      description: 'Sunset bar',
      sourceRef: { type: 'pos_check', id: newId() },
      idempotencyKey: key,
    }),
  );
}

async function entryDate(org: Org, key: string) {
  const r = await h.t.admin.kysely
    .selectFrom('finance.journal_entries')
    .select(['business_date'])
    .where('tenant_id', '=', org.tenantId)
    .where('idempotency_key', '=', key)
    .executeTakeFirstOrThrow();
  return r.business_date as string;
}

describe('two auditors at once', () => {
  it('two Start presses at the same moment create one run; postings and the advance happen once', async () => {
    const org = await setupOrg(h);
    for (let i = 0; i < 4; i++) await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    nightAudit(h, org);
    const a = org.as(['dayClose.*', 'platform.businessDate.advance'], [org.propertyId], 'Auditor A');
    const b = org.as(['dayClose.*', 'platform.businessDate.advance'], [org.propertyId], 'Auditor B');
    const [ra, rb] = await Promise.all([
      h.service.startRun(h.t.db, a, { propertyId: org.propertyId }),
      h.service.startRun(h.t.db, b, { propertyId: org.propertyId }),
    ]);
    expect(ra.id).toBe(rb.id);
    expect([ra.alreadyActive, rb.alreadyActive].filter(Boolean)).toHaveLength(1);
    const final = await org.run((tx) => h.service.getRun(tx, ra.id), a);
    expect(final.runStatus).toBe('completed');
    expect((await entriesByKey(h, org.tenantId, 'room:')).map((r) => r.n)).toEqual([1, 1, 1, 1]);
    const log = await h.t.admin.kysely
      .selectFrom('platform.business_date_log')
      .select('from_date')
      .where('tenant_id', '=', org.tenantId)
      .execute();
    expect(log).toHaveLength(1);
    const runs = await h.t.admin.kysely
      .selectFrom('day_close.runs')
      .select('id')
      .where('tenant_id', '=', org.tenantId)
      .execute();
    expect(runs).toHaveLength(1);
  });

  it('two Resume presses on a crashed run: one executes, the other is told it is in progress', async () => {
    const org = await setupOrg(h);
    for (let i = 0; i < 3; i++) await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    const auditor = nightAudit(h, org);
    await expect(
      h.service.startRun(h.t.db, auditor, {
        propertyId: org.propertyId,
        hooks: {
          afterItem: (s, i) => {
            if (s === 'room_and_package_postings' && i === 1) throw new SimulatedCrash('after 1');
          },
        },
      }),
    ).rejects.toBeInstanceOf(SimulatedCrash);
    const [run] = await org.run((tx) => h.service.listRuns(tx, org.propertyId, { limit: 1 }), auditor);
    h.clock.advance(3 * 60_000);
    const a = org.as(['dayClose.*', 'platform.businessDate.advance'], [org.propertyId], 'Auditor A');
    const b = org.as(['dayClose.*', 'platform.businessDate.advance'], [org.propertyId], 'Auditor B');
    const results = await Promise.allSettled([
      h.service.resumeRun(h.t.db, a, run?.id as string, run?.version as number),
      h.service.resumeRun(h.t.db, b, run?.id as string, run?.version as number),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(['run_in_progress', 'version_conflict']).toContain((refused[0]?.reason as { code: string }).code);
    expect((await entriesByKey(h, org.tenantId, 'room:')).map((r) => r.n)).toEqual([1, 1, 1]);
    expect(await businessDate(org)).toBe('2026-11-08');
  });

  it('a stale executor that wakes up after a take-over stops without committing anything (lease lost)', async () => {
    const org = await setupOrg(h);
    for (let i = 0; i < 3; i++) await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    const auditor = nightAudit(h, org);
    let release!: () => void;
    const paused = new Promise<void>((r) => {
      release = r;
    });
    let reachedPause!: () => void;
    const atPause = new Promise<void>((r) => {
      reachedPause = r;
    });
    // Executor A pauses between two items (a long GC pause / frozen VM) — its lease expires meanwhile.
    const a = h.service.startRun(h.t.db, auditor, {
      propertyId: org.propertyId,
      hooks: {
        afterItem: async (s, i) => {
          if (s === 'room_and_package_postings' && i === 1) {
            reachedPause();
            await paused;
          }
        },
      },
    });
    await atPause;
    h.clock.advance(3 * 60_000);
    const [run] = await org.run((tx) => h.service.listRuns(tx, org.propertyId, { limit: 1 }), auditor);
    const b = await h.service.resumeRun(h.t.db, org.auditor, run?.id as string, run?.version as number);
    expect(b.runStatus).toBe('completed');
    release();
    await expect(a).rejects.toBeInstanceOf(LeaseLostError);
    expect((await entriesByKey(h, org.tenantId, 'room:')).map((r) => r.n)).toEqual([1, 1, 1]);
    await assertBooksBalance(h, org);
  });
});

describe('postings arriving during the close (cut-over rule)', () => {
  it('lands before the advance on D, after it on D+1, and an in-flight posting is surfaced in the report', async () => {
    const org = await setupOrg(h);
    const s = await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    const t2 = await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    const auditor = nightAudit(h, org);
    let inflight: Promise<unknown> | null = null;
    let commit!: () => void;
    const gate = new Promise<void>((r) => {
      commit = r;
    });
    const run = await h.service.startRun(h.t.db, auditor, {
      propertyId: org.propertyId,
      hooks: {
        afterItem: async (step, i) => {
          if (step === 'room_and_package_postings' && i === 1) {
            // The bar posts while Day Close is mid-step: no lock, no logout; it belongs to D.
            await barCharge(org, s.stayId, 'pos:before');
            // Another user reads readiness meanwhile.
            const r = await org.run(
              (tx) => h.service.getReadiness(tx, org.propertyId),
              org.as(['dayClose.run.read']),
            );
            expect(r.activeRun?.status).toBe('running');
          }
        },
        beforeStep: async (step) => {
          if (step === 'advance') {
            // A posting whose transaction read business date D and is still open when the date advances.
            let posted!: () => void;
            const ready = new Promise<void>((r) => {
              posted = r;
            });
            const desk = org.as(DESK, [org.propertyId], 'Bar');
            inflight = withTenantTx(h.t.db, desk, async (tx) => {
              await h.finance.postCharge(tx, {
                propertyId: org.propertyId,
                target: { type: 'stay', id: t2.stayId },
                chargeCode: 'FB_ALACARTE',
                amount: money(7_000, 'USD'),
                serviceDate: D,
                description: 'Sunset bar (in flight)',
                sourceRef: { type: 'pos_check', id: newId() },
                idempotencyKey: 'pos:inflight',
              });
              posted();
              await gate;
            });
            await ready;
          }
        },
        afterStep: async (step) => {
          if (step === 'advance') {
            commit();
            await inflight;
            await barCharge(org, s.stayId, 'pos:after', '2026-11-08');
          }
        },
      },
    });
    expect(run.runStatus).toBe('completed');
    expect(await entryDate(org, 'pos:before')).toBe(D);
    expect(await entryDate(org, 'pos:after')).toBe('2026-11-08');
    // FIN-I10 without a business-date lock (foundation request): the in-flight posting is stamped D after D closed.
    expect(await entryDate(org, 'pos:inflight')).toBe(D);
    const report = await org.run((tx) => h.service.getReport(tx, org.propertyId, D), auditor);
    // Never silently lost: the report shows D's revenue moved since it closed.
    expect(report.restatementsSince.changed).toBe(true);
    const bar = report.restatementsSince.revenueDelta.find((d) => d.chargeCode === 'FB_ALACARTE');
    expect(bar).toBeDefined();
    expect((bar?.nowMinor ?? 0) - (bar?.closedMinor ?? 0)).toBe(7_000);
    await assertBooksBalance(h, org);
  });
});

describe('a guest arriving during or after the close (EC-DCL-004, EC-DCL-010)', () => {
  it('a delayed seaplane arrival is not a no-show; checked in after the postings step, its night is posted once before the advance', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    const late = await addStay(h, org, {
      arrival: D,
      departure: '2026-11-09',
      status: 'expected',
      transfer: {
        mode: 'seaplane',
        scheduledAt: '2026-11-07T10:00:00Z',
        estimatedAt: '2026-11-07T20:30:00Z',
      },
    });
    const auditor = nightAudit(h, org);
    const ready = await org.run((tx) => h.service.getReadiness(tx, org.propertyId), auditor);
    const item = ready.warnings.find((w) => w.code === 'arrival_transfer_delayed');
    expect(item?.ref).toEqual({ type: 'stay', id: late.stayId });
    expect(item?.actions.map((a) => a.action)).toEqual(['checkIn', 'markNoShow']);
    const run = await h.service.startRun(h.t.db, auditor, {
      propertyId: org.propertyId,
      hooks: {
        afterStep: async (step) => {
          if (step === 'room_and_package_postings') await checkIn(org, late.stayId); // 01:30, seaplane landed
        },
      },
    });
    expect(run.runStatus).toBe('completed');
    expect(await entriesByKey(h, org.tenantId, `penalty:no_show:${late.stayId}`)).toEqual([]);
    expect(await entriesByKey(h, org.tenantId, `room:${late.stayId}`)).toEqual([
      { idempotency_key: `room:${late.stayId}:${D}`, n: 1 },
    ]);
    const noShows = run.steps.find((s) => s.key === 'no_shows');
    expect(noShows?.done).toBe(1); // recorded: kept expected (transfer delayed)
    const sweep = run.steps.find((s) => s.key === 'advance');
    expect(sweep?.done).toBe(1); // the stay-night posted by the pre-advance sweep
  });

  it('a stay checked in after the advance gets its missed night posted by the next close (catch-up), once', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-10' });
    const late = await addStay(h, org, { arrival: D, departure: '2026-11-10', status: 'expected' });
    const auditor = nightAudit(h, org);
    // Policy: no-shows by hand, so the late arrival stays expected through the close of D.
    await org.run(async (tx) => {
      const p = await h.service.getPolicy(tx, org.propertyId);
      await h.service.updatePolicy(
        tx,
        org.propertyId,
        {
          policy: { noShow: { mode: 'off', protectDelayedTransfers: true, collectFee: 'never' } },
          reason: 'test',
        },
        p.version,
      );
    });
    expect((await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId })).runStatus).toBe(
      'completed',
    );
    await checkIn(org, late.stayId); // business date is now D+1
    const ready = await org.run((tx) => h.service.getReadiness(tx, org.propertyId), auditor);
    expect(ready.info.find((i) => i.code === 'night_not_posted')?.details).toEqual({ night: D });
    h.clock.set(new Date(new Date(NIGHT).getTime() + 86_400_000).toISOString());
    const next = await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId });
    expect(next.runStatus).toBe('completed');
    expect(await entriesByKey(h, org.tenantId, `room:${late.stayId}`)).toEqual([
      { idempotency_key: `room:${late.stayId}:${D}`, n: 1 },
      { idempotency_key: `room:${late.stayId}:2026-11-08`, n: 1 },
    ]);
    const np = await h.t.admin.kysely
      .selectFrom('day_close.night_postings')
      .select(['night', 'catch_up', 'business_date'])
      .where('stay_id', '=', late.stayId)
      .orderBy('night')
      .execute();
    expect(np).toEqual([
      { night: D, catch_up: true, business_date: '2026-11-08' },
      { night: '2026-11-08', catch_up: false, business_date: '2026-11-08' },
    ]);
    expect(await org.run((tx) => platform.getBusinessDate(tx, org.propertyId))).toBe('2026-11-09');
  });
});
