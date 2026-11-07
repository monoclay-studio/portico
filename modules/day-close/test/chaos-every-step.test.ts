/**
 * E07 "crash at each step boundary (parameterized)" — plus a crash inside the first item of every step that has
 * items. One property closes consecutive business dates (D, D+1, D+2, … — EC-DCL-013: runs go in order, each with
 * its own night keys); each day the process dies at a different point and is resumed after its lease expires.
 * Every day has two room-only stays, one all-inclusive package stay (allowance with breakage, arrival transfer,
 * departure transfer deferred to the next day's close) and one expected arrival that becomes a no-show.
 * After all days: every ledger effect exists exactly once (0 duplicate postings after any interruption).
 */
import { addDays } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STEP_KEYS, SimulatedCrash, type StepKey } from '../src';
import {
  addStay,
  assertBooksBalance,
  businessDate,
  D,
  entriesByKey,
  type Harness,
  NIGHT,
  type Org,
  setupOrg,
  startHarness,
} from './harness';

let h: Harness;
let org: Org;
beforeAll(async () => {
  h = await startHarness();
  org = await setupOrg(h);
});
afterAll(async () => h?.close());

type Point = { at: 'beforeStep' | 'afterStep' | 'insideItem'; step: StepKey };
const WITH_ITEMS: StepKey[] = ['no_shows', 'room_and_package_postings', 'allowance_close', 'advance'];
const POINTS: Point[] = [
  ...STEP_KEYS.flatMap((step) => [
    { at: 'beforeStep' as const, step },
    { at: 'afterStep' as const, step },
  ]),
  ...WITH_ITEMS.map((step) => ({ at: 'insideItem' as const, step })),
];

const nightOf = (date: string) => new Date(new Date(NIGHT).getTime() + (Date.parse(date) - Date.parse(D))).toISOString();

describe('crash at every step boundary and inside every step, then resume (E07)', () => {
  let day = D;
  it.each(POINTS.map((p, i) => [i, p.at, p.step] as const))('day %i: crash %s %s', async (_i, at, step) => {
    const next = addDays(day, 1);
    const rooms = [
      await addStay(h, org, { arrival: day, departure: next, plan: 'BAR' }),
      await addStay(h, org, { arrival: day, departure: next, plan: 'BAR' }),
      await addStay(h, org, { arrival: day, departure: next, plan: 'AI' }),
    ];
    const noShow = await addStay(h, org, { arrival: day, departure: next, status: 'expected', plan: 'BAR' });
    h.clock.set(nightOf(day));
    const crash = (where: string) => {
      throw new SimulatedCrash(where);
    };
    const hooks = {
      beforeStep: (s: StepKey) => (at === 'beforeStep' && s === step ? crash(`before ${s}`) : undefined),
      afterStep: (s: StepKey) => (at === 'afterStep' && s === step ? crash(`after ${s}`) : undefined),
      insideItem: (s: StepKey) => (at === 'insideItem' && s === step ? crash(`inside ${s}`) : undefined),
    };
    await expect(h.service.startRun(h.t.db, org.auditor, { propertyId: org.propertyId, hooks })).rejects.toBeInstanceOf(
      SimulatedCrash,
    );
    await assertBooksBalance(h, org);
    const runs = await org.run((tx) => h.service.listRuns(tx, org.propertyId, { limit: 1 }), org.auditor);
    const run = runs[0];
    expect(run?.businessDate).toBe(day);
    // A crash after the advance committed leaves the new date; any earlier crash leaves the date unchanged.
    const advanced = step === 'post_advance' || (at === 'afterStep' && step === 'advance');
    expect(await businessDate(org)).toBe(advanced ? next : day);

    h.clock.advance(3 * 60_000);
    const done = await h.service.resumeRun(h.t.db, org.auditor, run?.id as string, run?.version as number);
    expect(done.runStatus).toBe('completed');
    expect(await businessDate(org)).toBe(next);

    // Exactly once per stay-night and per no-show, whatever the crash point.
    for (const r of rooms) {
      expect(await entriesByKey(h, org.tenantId, `room:${r.stayId}:${day}`)).toEqual([
        { idempotency_key: `room:${r.stayId}:${day}`, n: 1 },
      ]);
    }
    expect(await entriesByKey(h, org.tenantId, `penalty:no_show:${noShow.stayId}`)).toHaveLength(1);
    await assertBooksBalance(h, org);
    day = next;
  });

  it('after every crash and resume: no ledger effect exists twice, one advance per date, one report per date', async () => {
    for (const prefix of ['room:', 'inclusion:', 'penalty:', 'breakage:', 'carry:']) {
      const rows = await entriesByKey(h, org.tenantId, prefix);
      expect(rows.filter((r) => r.n !== 1)).toEqual([]);
    }
    expect(await entriesByKey(h, org.tenantId, 'room:')).toHaveLength(3 * POINTS.length);
    expect(await entriesByKey(h, org.tenantId, 'penalty:no_show:')).toHaveLength(POINTS.length);
    // Allowance breakage closed nightly for each package stay (forfeit), once.
    expect(await entriesByKey(h, org.tenantId, 'breakage:')).toHaveLength(POINTS.length);
    const log = await h.t.admin.kysely
      .selectFrom('platform.business_date_log')
      .select(['from_date'])
      .where('tenant_id', '=', org.tenantId)
      .execute();
    expect(log).toHaveLength(POINTS.length);
    expect(new Set(log.map((l) => l.from_date)).size).toBe(POINTS.length);
    const reports = await h.t.admin.kysely
      .selectFrom('day_close.day_reports')
      .select(['business_date'])
      .where('tenant_id', '=', org.tenantId)
      .execute();
    expect(reports).toHaveLength(POINTS.length);
    await assertBooksBalance(h, org);
  });
});
