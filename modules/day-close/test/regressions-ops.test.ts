/**
 * Day-close fix round 1 — the steward reviewer's operations probes as regression tests (review P2-2, P2-3, P2-5,
 * P2-6, P2-7, P2-12, P2-13, P3-1, P3-9). Each failed on the reviewed commit (the DST probes are domain tests in
 * src/domain/domain.test.ts).
 */
import { sql } from '@portico/db';
import { money, newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayCloseJobs } from '../src';
import {
  addStay,
  businessDate,
  checkIn,
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

const DAY = 86_400_000;
const nightOf = (offset: number) => new Date(new Date(NIGHT).getTime() + offset * DAY).toISOString();
const SEAPLANE_LATE = {
  mode: 'seaplane',
  scheduledAt: '2026-11-07T10:00:00Z',
  estimatedAt: '2026-11-07T20:30:00Z',
};
const scheduler = () => dayCloseJobs(h.service)[0] as ReturnType<typeof dayCloseJobs>[number];
const overdueJob = () => dayCloseJobs(h.service)[1] as ReturnType<typeof dayCloseJobs>[number];
const tick = (iso: string) => {
  h.clock.set(iso);
  return scheduler().run(h.t.db, h.clock.now());
};

async function setPolicy(org: Org, policy: Record<string, unknown>, ctx = org.admin) {
  await org.run(async (tx) => {
    const p = await h.service.getPolicy(tx, org.propertyId);
    await h.service.updatePolicy(tx, org.propertyId, { policy, reason: 'regression test' }, p.version);
  }, ctx);
}

const openIssues = (org: Org) =>
  org.run((tx) => h.service.listIssues(tx, org.propertyId, 'open'), org.auditor);

describe('P2-2: no occupied stay-night leaves Day Close’s sight (DCL-I04)', () => {
  it('R-GAP: a check-in after the final sweep (during the re-check) is posted before the date moves', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-10' });
    const late = await addStay(h, org, {
      arrival: D,
      departure: '2026-11-08',
      status: 'expected',
      transfer: SEAPLANE_LATE,
    });
    const auditor = nightAudit(h, org);
    const original = h.ports.platform.listDepartments;
    let armed = false;
    h.ports.platform.listDepartments = async (tx, propertyId) => {
      if (armed) {
        armed = false;
        await checkIn(org, late.stayId); // the seaplane lands while the close re-checks what blocks
      }
      return original(tx, propertyId);
    };
    try {
      const run = await h.service.startRun(h.t.db, auditor, {
        propertyId: org.propertyId,
        hooks: {
          beforeStep: (s) => {
            if (s === 'final_sweep') armed = true;
          },
        },
      });
      expect(run.runStatus).toBe('completed');
    } finally {
      h.ports.platform.listDepartments = original;
    }
    // The advance transaction found the new in-house stay and sent the close back to the sweep: posted on D.
    const e = await h.t.admin.kysely
      .selectFrom('finance.journal_entries')
      .select(['business_date'])
      .where('idempotency_key', '=', `room:${late.stayId}:${D}`)
      .execute();
    expect(e).toEqual([{ business_date: D }]);
  });

  it('a check-in committing during the advance transaction is posted right after it (post-advance sweep), once', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-10' });
    const late = await addStay(h, org, {
      arrival: D,
      departure: '2026-11-08',
      status: 'expected',
      transfer: SEAPLANE_LATE,
    });
    const auditor = nightAudit(h, org);
    const run = await h.service.startRun(h.t.db, auditor, {
      propertyId: org.propertyId,
      hooks: {
        insideItem: async (s, i) => {
          if (s === 'advance' && i === 0) await checkIn(org, late.stayId); // commits before the advance commits
        },
      },
    });
    expect(run.runStatus).toBe('completed');
    await checkOut(org, late.stayId); // leaves the next morning, before the next close
    expect(await entriesByKey(h, org.tenantId, `room:${late.stayId}`)).toEqual([
      { idempotency_key: `room:${late.stayId}:${D}`, n: 1 },
    ]);
    h.clock.set(nightOf(1));
    expect((await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId })).runStatus).toBe(
      'completed',
    );
    expect(await entriesByKey(h, org.tenantId, `room:${late.stayId}`)).toHaveLength(1);
  });

  it('checked in after the close and gone before the next: the next close charges the night from the agreement', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-10' });
    const late = await addStay(h, org, {
      arrival: D,
      departure: '2026-11-08',
      status: 'expected',
      transfer: SEAPLANE_LATE,
    });
    const auditor = nightAudit(h, org);
    expect((await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId })).runStatus).toBe(
      'completed',
    );
    await checkIn(org, late.stayId); // 03:00 on 8 Nov: business date is already 8 Nov
    await checkOut(org, late.stayId); // and leaves on the 08:00 seaplane
    h.clock.set(nightOf(1));
    expect((await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId })).runStatus).toBe(
      'completed',
    );
    expect(await entriesByKey(h, org.tenantId, `room:${late.stayId}`)).toEqual([
      { idempotency_key: `room:${late.stayId}:${D}`, n: 1 },
    ]);
  });

  it('…and while the agreement lookup is not connected (main), a blocking follow-up says so instead of silence', async () => {
    const org = await setupOrg(h);
    h.fakes.reservations.connected = false;
    try {
      await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-10' });
      const late = await addStay(h, org, {
        arrival: D,
        departure: '2026-11-08',
        status: 'expected',
        transfer: SEAPLANE_LATE,
      });
      const auditor = nightAudit(h, org);
      expect((await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId })).runStatus).toBe(
        'completed',
      );
      await checkIn(org, late.stayId);
      await checkOut(org, late.stayId);
      h.clock.set(nightOf(1));
      const next = await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId });
      expect(next.runStatus).toBe('blocked');
      const item = next.blockers.find((b) => b.code === 'night_not_posted_departed');
      expect(item?.ref).toEqual({ type: 'stay', id: late.stayId });
      expect(item?.details).toMatchObject({ nights: [D] });
    } finally {
      h.fakes.reservations.connected = true;
    }
  });
});

describe('P2-3: the day facts are frozen from the state the advance closes', () => {
  it('R-STATS: a stay posted by the final sweep is in the frozen revenue; the annex shows nothing to restate', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-10' });
    const late = await addStay(h, org, {
      arrival: D,
      departure: '2026-11-10',
      status: 'expected',
      transfer: SEAPLANE_LATE,
    });
    const auditor = nightAudit(h, org);
    const run = await h.service.startRun(h.t.db, auditor, {
      propertyId: org.propertyId,
      hooks: {
        afterStep: async (s) => {
          if (s === 'room_and_package_postings') await checkIn(org, late.stayId);
        },
      },
    });
    expect(run.runStatus).toBe('completed');
    const facts = await org.run((tx) => h.service.getFacts(tx, org.propertyId, D), auditor);
    const report = await org.run((tx) => h.service.getReport(tx, org.propertyId, D), auditor);
    expect(facts.rooms.sold).toBe(2);
    expect(facts.roomRevenue.amountMinor).toBe(2 * facts.adr.amountMinor); // ADR over both nights (was halved)
    expect(report.restatementsSince.revenueDelta).toEqual([]);
    expect(report.restatementsSince.changed).toBe(false);
  });
});

describe('P2-5: no daytime close', () => {
  it('R-DAYTIME: a 10:00 start is refused by default; nobody is no-showed and the date stays', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-10' });
    const arriving = await addStay(h, org, {
      arrival: D,
      departure: '2026-11-10',
      status: 'expected',
      plan: 'BAR-NR',
    });
    h.clock.set('2026-11-07T05:00:00.000Z'); // 10:00 in Malé on 7 Nov
    await expect(
      h.service.startRun(h.t.db, org.auditor, { propertyId: org.propertyId }),
    ).rejects.toMatchObject({
      code: 'too_early_to_close',
    });
    expect(await businessDate(org)).toBe(D);
    expect(await entriesByKey(h, org.tenantId, `penalty:no_show:${arriving.stayId}`)).toEqual([]);
  });

  it('a schedule earlier than the earliest start cannot be saved (DCL-R05 MUST)', async () => {
    const org = await setupOrg(h);
    await expect(
      setPolicy(org, { schedule: { enabled: true, localTime: '13:00', autoContinue: true } }),
    ).rejects.toMatchObject({ code: 'policy_unusable' });
    await setPolicy(org, { schedule: { enabled: true, localTime: '02:00', autoContinue: true } });
  });

  it('the no-show step itself waits for the cut-off, whenever the run is resumed', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-10' });
    const arriving = await addStay(h, org, {
      arrival: D,
      departure: '2026-11-10',
      status: 'expected',
      plan: 'BAR-NR',
    });
    h.clock.set('2026-11-07T17:30:00.000Z'); // 22:30 in Malé: after the default 22:00 earliest start
    const created = await org.run(
      (tx) => h.service.createRun(tx, { propertyId: org.propertyId }),
      org.auditor,
    );
    // The policy moves the cut-off later while the run waits (e.g. the last seaplane is late tonight).
    await setPolicy(org, { earliestStartLocalTime: '23:30' });
    const r = await h.service.executeRun(h.t.db, org.auditor, created.run.id);
    expect(r.status).toBe('blocked');
    const view = await org.run((tx) => h.service.getRun(tx, created.run.id), org.auditor);
    expect(view.blockers.map((b) => b.code)).toEqual(['no_shows_before_cutoff']);
    expect(await entriesByKey(h, org.tenantId, `penalty:no_show:${arriving.stayId}`)).toEqual([]);
  });
});

describe('P2-6: the append-only report holds no guest names', () => {
  it("R-PII: a departed guest's name never reaches the pack or the step detail; the report still explains the item", async () => {
    const org = await setupOrg(h);
    const stayId = newId();
    await org.run(async (tx) => {
      await h.finance.openFolio(tx, {
        propertyId: org.propertyId,
        owner: { type: 'stay', id: stayId },
        payer: { type: 'guest', id: newId(), name: 'Aishath Zz-Unique Rasheed' },
      });
      await h.finance.postCharge(tx, {
        propertyId: org.propertyId,
        target: { type: 'stay', id: stayId },
        chargeCode: 'FB_ALACARTE',
        amount: money(4_000, 'USD'),
        serviceDate: D,
        description: 'Minibar',
        sourceRef: { type: 'pos_check', id: newId() },
        idempotencyKey: `pos:${stayId}`,
      });
      await h.finance.markOwnerDeparted(tx, {
        propertyId: org.propertyId,
        owner: { type: 'stay', id: stayId },
        departedOn: D,
      });
    });
    const auditor = nightAudit(h, org);
    expect((await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId })).runStatus).toBe(
      'completed',
    );
    const n = async (table: 'day_reports' | 'steps' | 'issues') =>
      (
        await sql<{ n: number }>`select count(*)::int as n from ${sql.table(`day_close.${table}`)}
          where tenant_id = ${org.tenantId} and ${sql.raw(table === 'day_reports' ? 'pack' : table === 'steps' ? 'detail' : 'message')}::text like '%Zz-Unique%'`.execute(
          h.t.admin.kysely,
        )
      ).rows[0]?.n;
    expect(await n('day_reports')).toBe(0);
    expect(await n('steps')).toBe(0);
    const report = await org.run((tx) => h.service.getReport(tx, org.propertyId, D), auditor);
    const item = report.pack.exceptions.find((e) => e.code === 'departed_with_balance');
    expect(item).toMatchObject({
      ref: { type: 'folio' },
      message: 'A departed stay still has an open balance',
    });
  });
});

describe('P2-13: what was posted for a date after it closed shows in its report, labelled', () => {
  it("R-LATE: Day Close's own late posting is listed; other modules' late charges are labelled as not visible yet (CR-19)", async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-10' });
    const late = await addStay(h, org, {
      arrival: D,
      departure: '2026-11-10',
      status: 'expected',
      transfer: SEAPLANE_LATE,
    });
    const auditor = nightAudit(h, org);
    expect((await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId })).runStatus).toBe(
      'completed',
    );
    await checkIn(org, late.stayId); // after the advance
    h.clock.set(nightOf(1));
    expect((await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId })).runStatus).toBe(
      'completed',
    );
    const report = await org.run((tx) => h.service.getReport(tx, org.propertyId, D), auditor);
    const own = report.restatementsSince.latePostings.byDayClose.find(
      (l) => l.lineKey === `room:${late.stayId}:${D}`,
    );
    expect(own).toMatchObject({ serviceDate: D, postedOn: '2026-11-08', cause: 'late_posting' });
    expect(report.restatementsSince.latePostings.otherSources.status).toBe('not_connected');
    expect(report.restatementsSince.changed).toBe(true);
  });
});

describe('P2-7: a close that does not happen is said out loud', () => {
  it('a refused scheduled close raises a follow-up at once; a long-overdue close raises close_overdue and pages', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-10' });
    await setPolicy(org, {
      earliestStartLocalTime: '22:00',
      schedule: { enabled: true, localTime: '23:00', autoContinue: true },
    });
    // The entitlement is withdrawn: every fire is refused.
    await sql`update platform.organizations set plan_code = 'starter' where id = ${org.tenantId}`
      .execute(h.t.admin.kysely)
      .catch(() => undefined);
    const original = h.ports.platform.hasEntitlement;
    h.ports.platform.hasEntitlement = async () => false;
    try {
      await tick('2026-11-07T18:00:30.000Z');
      expect((await openIssues(org)).filter((i) => i.code === 'close_not_started')).toHaveLength(1);
      // Three hours later nothing has run: the dead-man's switch speaks, once.
      h.clock.set('2026-11-07T21:30:00.000Z');
      await overdueJob().run(h.t.db, h.clock.now());
      await overdueJob().run(h.t.db, h.clock.now());
      expect((await openIssues(org)).filter((i) => i.code === 'close_overdue')).toHaveLength(1);
      const paged = await h.t.admin.kysely
        .selectFrom('core.outbox')
        .select(['payload'])
        .where('tenant_id', '=', org.tenantId)
        .where('type', '=', 'dayClose.close.overdue')
        .execute();
      expect(paged).toHaveLength(1);
      expect(paged[0]?.payload).toMatchObject({
        notification: { roles: expect.arrayContaining(['night_audit']) },
      });
    } finally {
      h.ports.platform.hasEntitlement = original;
    }
  });
});

describe('P2-12: managing the policy does not reach the business date', () => {
  it('enabling a schedule needs platform.businessDate.advance at the property; who configured it is recorded', async () => {
    const org = await setupOrg(h);
    const manager = org.as(
      ['dayClose.policy.manage', 'dayClose.run.read'],
      [org.propertyId],
      'Policy manager',
    );
    await expect(
      setPolicy(org, { schedule: { enabled: true, localTime: '02:00', autoContinue: true } }, manager),
    ).rejects.toMatchObject({ status: 403 });
    // Other policy changes stay with dayClose.policy.manage.
    await setPolicy(org, { catchUpWindowNights: 5 }, manager);
    const gm = org.as(
      ['dayClose.policy.manage', 'dayClose.run.read', 'platform.businessDate.advance'],
      [org.propertyId],
      'General manager',
    );
    await setPolicy(org, { schedule: { enabled: true, localTime: '02:00', autoContinue: true } }, gm);
    const row = await h.t.admin.kysely
      .selectFrom('day_close.schedules')
      .select(['configured_by', 'enabled'])
      .where('tenant_id', '=', org.tenantId)
      .executeTakeFirstOrThrow();
    expect(row.enabled).toBe(true);
    expect(row.configured_by).toBe(`user:${(gm.actor as { userId: string }).userId}`);
  });
});

describe('P3-1 / P3-9: the scheduler neither churns nor drops the auto-close', () => {
  it('R-CHURN: a blocked auto-close audits once per change, and a stuck run does not re-fire every minute', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    await addStay(h, org, { arrival: '2026-11-05', departure: D }); // overstay: blocks
    await setPolicy(org, { schedule: { enabled: true, localTime: '02:00', autoContinue: true } });
    await tick('2026-11-07T21:00:30.000Z');
    for (let m = 1; m <= 5; m++) await tick(`2026-11-07T21:0${m}:30.000Z`);
    const audits = await sql<{ n: number }>`select count(*)::int as n from core.audit_log
      where tenant_id = ${org.tenantId} and action = 'dayClose.run.blocked'`.execute(h.t.admin.kysely);
    expect(audits.rows[0]?.n).toBe(1);
    for (let m = 0; m < 4; m++) await tick(`2026-11-08T22:0${m}:30.000Z`);
    const fired = await sql<{ n: number }>`select count(*)::int as n from day_close.schedule_log
      where tenant_id = ${org.tenantId} and event = 'fired'`.execute(h.t.admin.kysely);
    expect(fired.rows[0]?.n).toBeLessThanOrEqual(2);
  });

  it('a run someone created by hand first is adopted by the schedule (auto-continue), not silently left manual', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-10' });
    await setPolicy(org, { schedule: { enabled: true, localTime: '02:00', autoContinue: true } });
    h.clock.set('2026-11-07T20:30:00.000Z');
    const created = await org.run(
      (tx) => h.service.createRun(tx, { propertyId: org.propertyId }),
      org.auditor,
    );
    expect(created.run.auto_continue).toBe(false);
    await tick('2026-11-07T21:00:30.000Z');
    expect(await businessDate(org)).toBe('2026-11-08');
    const log = await h.t.admin.kysely
      .selectFrom('day_close.schedule_log')
      .select(['event'])
      .where('tenant_id', '=', org.tenantId)
      .where('event', '=', 'adopted_run')
      .execute();
    expect(log).toHaveLength(1);
  });
});
