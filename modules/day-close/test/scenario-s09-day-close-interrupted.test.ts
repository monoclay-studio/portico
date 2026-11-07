/**
 * S09 / E07 — Night audit (Day Close) stops after some charges have been posted (docs/scenarios/README.md).
 *
 * Pre: 112 in-house stays at Kandu Atoll Resort (real sealed BAR terms: room + breakfast); Day Close for D; the
 * process dies right after 67 stay-nights committed. Steps: the run page shows "Room postings: 67 of 112"; a
 * resume while the dead process still holds its lease is refused with when it becomes possible; after the lease
 * expires the auditor presses Resume. State: run completed, business date D+1, statistics snapshot for D.
 * Money: exactly 112 room postings (+112 breakfast inclusions), no duplicates, trial balance balanced at every
 * point. Audit: step log with the failure (crash take-over) and the resume. Recovery: resume never redoes.
 */
import { sql } from '@portico/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SimulatedCrash } from '../src';
import {
  addStay,
  assertBooksBalance,
  businessDate,
  D,
  entriesByKey,
  type Harness,
  nightAudit,
  setupOrg,
  startHarness,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('S09: Day Close interrupted after 67 of 112 room postings', () => {
  it('resumes at the remaining 45 stay-nights, posts each exactly once and closes the day', async () => {
    const org = await setupOrg(h, { capacity: 120 });
    const stays = [];
    for (let i = 0; i < 112; i++)
      stays.push(await addStay(h, org, { arrival: '2026-11-05', departure: '2026-11-09', plan: 'BAR' }));
    const auditor = nightAudit(h, org);

    // ── The process dies right after the 67th stay-night committed. ──
    await expect(
      h.service.startRun(h.t.db, auditor, {
        propertyId: org.propertyId,
        hooks: {
          afterItem: (step, index) => {
            if (step === 'room_and_package_postings' && index === 67)
              throw new SimulatedCrash('after 67 postings');
          },
        },
      }),
    ).rejects.toBeInstanceOf(SimulatedCrash);

    const runId = (await org.run((tx) => sql<{ id: string }>`select id from day_close.runs`.execute(tx.db)))
      .rows[0]?.id as string;
    const crashed = await org.run((tx) => h.service.getRun(tx, runId), auditor);
    // State: the dead process still holds the run; nothing pretends it finished or failed cleanly.
    expect(crashed.runStatus).toBe('running');
    expect(crashed.currentStep).toBe('room_and_package_postings');
    const postings = crashed.steps.find((s) => s.key === 'room_and_package_postings');
    expect(postings?.progress).toBe('Room postings: 67 of 112 stay-nights posted, 45 remaining');
    expect(postings?.remaining).toBe(45);
    // Money: exactly 67 room nights in the ledger, each once; the books balance mid-run.
    const midRoom = await entriesByKey(h, org.tenantId, 'room:');
    expect(midRoom).toHaveLength(67);
    expect(midRoom.every((r) => r.n === 1)).toBe(true);
    await assertBooksBalance(h, org);
    expect(await businessDate(org)).toBe(D);

    // ── Resume while the dead process's lease is still live: refused, with when it becomes possible. ──
    const resume = crashed.allowedActions.find((a) => a.action === 'resume');
    expect(resume?.enabled).toBe(false);
    expect(resume?.reason).toMatch(/working on it right now/);
    await expect(h.service.resumeRun(h.t.db, auditor, runId, crashed.version)).rejects.toMatchObject({
      code: 'run_in_progress',
    });

    // ── The lease expires; the auditor presses Resume. Count what the resume asks finance to post. ──
    h.clock.advance(3 * 60_000);
    let postCalls = 0;
    const original = h.ports.finance.postCharge;
    h.ports.finance.postCharge = (tx, scope, input) => {
      postCalls++;
      return original(tx, scope, input);
    };
    let done: Awaited<ReturnType<typeof h.service.resumeRun>>;
    try {
      done = await h.service.resumeRun(h.t.db, auditor, runId, crashed.version);
    } finally {
      h.ports.finance.postCharge = original;
    }

    // State: completed, business date D+1, statistics frozen for D.
    expect(done.runStatus).toBe('completed');
    expect(await businessDate(org)).toBe('2026-11-08');
    const facts = await org.run((tx) => h.service.getFacts(tx, org.propertyId, D), auditor);
    expect(facts.rooms.sold).toBe(112);
    expect(facts.occupancyPercent).toBe('93.33');

    // Money: only the remaining 45 stay-nights were sent to finance (room + breakfast each) — resume, never redo.
    expect(postCalls).toBe(45 * 2);
    const room = await entriesByKey(h, org.tenantId, 'room:');
    expect(room).toHaveLength(112);
    expect(room.every((r) => r.n === 1)).toBe(true);
    for (const s of stays) expect(room.some((r) => r.idempotency_key === `room:${s.stayId}:${D}`)).toBe(true);
    const breakfast = await entriesByKey(h, org.tenantId, 'inclusion:');
    expect(breakfast).toHaveLength(112);
    expect(breakfast.every((r) => r.n === 1)).toBe(true);
    const posted = done.steps.find((s) => s.key === 'room_and_package_postings');
    expect(posted).toMatchObject({ status: 'completed', total: 112, done: 112, failed: 0, attempts: 2 });

    // Audit: the crash take-over and the resume are on the run's history; two executions recorded.
    const audit = await h.t.admin.kysely
      .selectFrom('core.audit_log')
      .select(['action', 'before', 'after'])
      .where('tenant_id', '=', org.tenantId)
      .where('target_id', '=', runId)
      .orderBy('occurred_at')
      .execute();
    const actions = audit.map((a) => a.action);
    expect(actions).toContain('dayClose.run.start');
    expect(actions).toContain('dayClose.run.resume');
    expect(actions).toContain('dayClose.run.recovered');
    expect(actions).toContain('dayClose.businessDate.advanced');
    expect(actions.at(-1)).toBe('dayClose.run.complete');
    expect(done.execution.executions).toHaveLength(2);
    expect(done.execution.executions[1]).toMatchObject({ fromStep: 'room_and_package_postings' });
    expect(done.execution.executions[1]?.tookOverFrom).toBeTruthy();

    // Global consistency: trial balance zero, control accounts = sub-ledgers; one business-date advance.
    const report = await assertBooksBalance(h, org);
    expect(report.ok).toBe(true);
    const log = await h.t.admin.kysely
      .selectFrom('platform.business_date_log')
      .select(['from_date', 'to_date', 'day_close_run_id'])
      .where('tenant_id', '=', org.tenantId)
      .execute();
    expect(log).toEqual([{ from_date: D, to_date: '2026-11-08', day_close_run_id: runId }]);
  });
});
