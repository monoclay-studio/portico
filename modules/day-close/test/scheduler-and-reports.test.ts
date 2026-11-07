/**
 * Scheduler (DCL-R05/R09, EC-DCL-008/014/024/035): the close fires at the property's local time, continues by
 * itself when nothing blocks, re-checks a blocked auto-close (notifying only when the list changes), retries
 * transient failures 3 × 5 minutes and never integrity failures, and can be skipped for a day (logged).
 * Reports (DCL-R07, EC-DCL-021): the "as closed" pack is immutable; corrections relating to the date appear in the
 * "restatements since" annex; frozen facts never change. Portfolio board (DCL-R08).
 */
import { money, newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayCloseJobs } from '../src';
import {
  addStay,
  businessDate,
  checkOut,
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

const job = () => dayCloseJobs(h.service)[0] as ReturnType<typeof dayCloseJobs>[number];
const tick = (iso: string) => {
  h.clock.set(iso);
  return job().run(h.t.db, h.clock.now());
};

async function schedule(org: Org, extra: Record<string, unknown> = {}) {
  await org.run(async (tx) => {
    const p = await h.service.getPolicy(tx, org.propertyId);
    await h.service.updatePolicy(
      tx,
      org.propertyId,
      {
        policy: { schedule: { enabled: true, localTime: '02:00', autoContinue: true }, ...extra },
        reason: 'auto-close',
      },
      p.version,
    );
  });
}

async function runsOf(org: Org) {
  return h.t.admin.kysely
    .selectFrom('day_close.runs')
    .selectAll()
    .where('tenant_id', '=', org.tenantId)
    .orderBy('business_date')
    .execute();
}

async function eventCount(org: Org, type: string) {
  const r = await h.t.admin.kysely
    .selectFrom('core.outbox')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('tenant_id', '=', org.tenantId)
    .where('type', '=', type)
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

describe('scheduler', () => {
  it('fires at 02:00 property time, waits while something blocks, continues by itself once it is settled', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    const overstay = await addStay(h, org, { arrival: '2026-11-05', departure: D });
    await schedule(org);
    const s = await h.t.admin.kysely
      .selectFrom('day_close.schedules')
      .select(['next_due_at'])
      .where('tenant_id', '=', org.tenantId)
      .executeTakeFirstOrThrow();
    expect((s.next_due_at as Date).toISOString()).toBe('2026-11-07T21:00:00.000Z'); // 02:00 on 8 Nov in Malé
    await tick('2026-11-07T20:59:00.000Z');
    expect(await runsOf(org)).toHaveLength(0);
    await tick('2026-11-07T21:00:30.000Z');
    const [run] = await runsOf(org);
    expect(run).toMatchObject({
      trigger: 'schedule',
      status: 'blocked',
      auto_continue: true,
      started_by: 'system:dayClose.scheduler',
    });
    expect(await eventCount(org, 'dayClose.run.blocked')).toBe(1);
    // Re-checked every minute; the duty roles are told once, not every minute.
    await tick('2026-11-07T21:01:30.000Z');
    await tick('2026-11-07T21:02:30.000Z');
    expect((await runsOf(org))[0]?.status).toBe('blocked');
    expect(await eventCount(org, 'dayClose.run.blocked')).toBe(1);
    // The guest checks out in the morning: the next re-check closes the day with nobody pressing anything.
    await checkOut(org, overstay.stayId);
    await tick('2026-11-08T03:00:00.000Z');
    expect((await runsOf(org))[0]?.status).toBe('completed');
    expect(await businessDate(org)).toBe('2026-11-08');
    const after = await h.t.admin.kysely
      .selectFrom('day_close.schedules')
      .select(['next_due_at'])
      .where('tenant_id', '=', org.tenantId)
      .executeTakeFirstOrThrow();
    expect((after.next_due_at as Date).toISOString()).toBe('2026-11-08T21:00:00.000Z');
    const log = await h.t.admin.kysely
      .selectFrom('day_close.schedule_log')
      .select(['event'])
      .where('tenant_id', '=', org.tenantId)
      .execute();
    expect(log.map((l) => l.event)).toEqual(['configured', 'fired']);
  });

  it('a scheduled close whose process died mid-step is resumed by the worker once its lease expires', async () => {
    const org = await setupOrg(h);
    for (let i = 0; i < 3; i++) await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    await schedule(org);
    h.clock.set('2026-11-07T21:00:30.000Z');
    const sys = { ...org.admin, actor: { kind: 'system' as const, process: 'dayClose.scheduler' } };
    const { run } = await org.run(
      (tx) => h.service.createRun(tx, { propertyId: org.propertyId, trigger: 'schedule' }),
      sys,
    );
    const { SimulatedCrash } = await import('../src');
    await expect(
      h.service.executeRun(h.t.db, sys, run.id, {
        hooks: {
          afterItem: (st, i) => {
            if (st === 'room_and_package_postings' && i === 2) throw new SimulatedCrash('power cut');
          },
        },
      }),
    ).rejects.toBeInstanceOf(SimulatedCrash);
    await tick('2026-11-07T21:01:30.000Z'); // lease still live: nothing happens
    expect((await runsOf(org))[0]?.status).toBe('running');
    await tick('2026-11-07T21:04:00.000Z'); // lease expired: the worker takes over and finishes
    expect((await runsOf(org))[0]?.status).toBe('completed');
    expect((await entriesByKey(h, org.tenantId, 'room:')).map((r) => r.n)).toEqual([1, 1, 1]);
    expect(await businessDate(org)).toBe('2026-11-08');
  });

  it('retries a transient failure three times five minutes apart, then stops and waits for a person', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    await schedule(org);
    const original = h.ports.finance.postCharge;
    h.ports.finance.postCharge = async () => {
      const { ModuleUnavailableError } = await import('@portico/kernel');
      throw new ModuleUnavailableError('finance', 'postCharge');
    };
    try {
      await tick('2026-11-07T21:00:30.000Z');
      let [run] = await runsOf(org);
      expect(run).toMatchObject({ status: 'failed', retry_count: 1 });
      expect(new Date(run?.next_retry_at as Date).toISOString()).toBe('2026-11-07T21:05:30.000Z');
      await tick('2026-11-07T21:05:30.000Z');
      await tick('2026-11-07T21:10:30.000Z');
      await tick('2026-11-07T21:15:30.000Z');
      [run] = await runsOf(org);
      expect(run).toMatchObject({ status: 'failed', retry_count: 3, next_retry_at: null });
      await tick('2026-11-07T21:20:30.000Z');
      const steps = await h.t.admin.kysely
        .selectFrom('day_close.steps')
        .select(['attempts'])
        .where('run_id', '=', run?.id as string)
        .where('key', '=', 'room_and_package_postings')
        .executeTakeFirstOrThrow();
      expect(steps.attempts).toBe(4); // first try + 3 automatic retries, then nothing more
    } finally {
      h.ports.finance.postCharge = original;
    }
    expect(await businessDate(org)).toBe(D);
  });

  it('never retries an integrity failure automatically', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    await schedule(org);
    h.fakes.inventory.discrepancies = [{ unitTypeId: newId(), night: D, sold: 1, consumed: 0 }];
    try {
      await tick('2026-11-07T21:00:30.000Z');
      const [run] = await runsOf(org);
      expect(run).toMatchObject({ status: 'failed', retry_count: 0, next_retry_at: null });
      expect(run?.failure).toMatchObject({ code: 'integrity_failed', integrity: true });
    } finally {
      h.fakes.inventory.discrepancies = [];
    }
  });

  it('skip today: the schedule does not fire for this date; the skip is logged with its reason', async () => {
    const org = await setupOrg(h);
    await schedule(org);
    await org.run((tx) => h.service.skipToday(tx, org.propertyId, 'Owner closes by hand after the wedding'));
    await tick('2026-11-07T21:00:30.000Z');
    expect(await runsOf(org)).toHaveLength(0);
    const log = await h.t.admin.kysely
      .selectFrom('day_close.schedule_log')
      .select(['event', 'detail'])
      .where('tenant_id', '=', org.tenantId)
      .execute();
    expect(log.map((l) => l.event)).toEqual(['configured', 'skipped_today']);
  });
});

describe('day reports and facts', () => {
  it('keeps the as-closed pack and frozen facts; a later correction appears as a restatement (EC-DCL-021)', async () => {
    const org = await setupOrg(h, { capacity: 12 });
    const s = await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09', commercialType: 'house_use' });
    const auditor = nightAudit(h, org);
    const run = await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId });
    expect(run.runStatus).toBe('completed');
    const facts = await org.run((tx) => h.service.getFacts(tx, org.propertyId, D), auditor);
    expect(facts.rooms).toEqual({
      capacity: 12,
      outOfOrder: 0,
      available: 11,
      sold: 1,
      complimentary: 0,
      houseUse: 1,
    });
    expect(facts.occupancyPercent).toBe('9.09');
    expect(facts.adr.amountMinor).toBe(facts.roomRevenue.amountMinor);
    expect(facts.nationality.status).toBe('incomplete');
    const before = await org.run((tx) => h.service.getReport(tx, org.propertyId, D), auditor);
    expect(before.pack.trialBalance).toMatchObject({ balanced: true, asOf: D });
    expect(before.restatementsSince.changed).toBe(false);
    expect(before.pack.steps).toHaveLength(9);
    // Next morning (D+1) finance corrects the room charge of D with a linked adjustment.
    const posting = await h.t.admin.kysely
      .selectFrom('finance.postings as p')
      .innerJoin('finance.journal_entries as e', 'e.id', 'p.entry_id')
      .select(['p.id'])
      .where('e.idempotency_key', '=', `room:${s.stayId}:${D}`)
      .where('p.kind', '=', 'charge')
      .executeTakeFirstOrThrow();
    await org.run((tx) =>
      h.finance.adjustPosting(tx, {
        postingId: posting.id,
        amountMinor: 5_000,
        reasonCode: 'goodwill',
        note: 'Air conditioning failed overnight',
        idempotencyKey: `adj:${posting.id}`,
      }),
    );
    const after = await org.run((tx) => h.service.getReport(tx, org.propertyId, D), auditor);
    expect(after.pack).toEqual(before.pack);
    expect(after.restatementsSince.changed).toBe(true);
    expect(after.restatementsSince.entries).toHaveLength(1);
    expect(after.restatementsSince.entries[0]).toMatchObject({ relatesTo: D });
    expect(await org.run((tx) => h.service.getFacts(tx, org.propertyId, D), auditor)).toEqual(facts);
    expect(await entriesByKey(h, org.tenantId, `room:${s.stayId}`)).toHaveLength(1);
    void money;
  });

  it('the portfolio board shows each property, its run and whether it lags', async () => {
    const org = await setupOrg(h);
    h.clock.set('2026-11-09T06:00:00.000Z'); // 11:00 on 9 Nov in Malé: business date 7 Nov is a day behind
    const board = await org.run((tx) => h.service.portfolio(tx), org.auditor);
    expect(board.properties).toEqual([
      expect.objectContaining({
        propertyId: org.propertyId,
        businessDate: D,
        lagDays: 1,
        run: null,
        alert: expect.stringMatching(/1 day behind/),
      }),
    ]);
    h.clock.set(NIGHT);
  });
});
