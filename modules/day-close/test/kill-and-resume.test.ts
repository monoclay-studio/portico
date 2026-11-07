/**
 * E07 with a REAL process death: a separate Node process executes Day Close and is SIGKILLed while it holds an open
 * transaction (mid-item of the posting step; inside the advance transaction). Postgres rolls the open transaction
 * back; the resume (another executor, after the dead one's lease expired) starts at the first incomplete item and
 * never repeats a committed effect.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';
import { sql } from '@portico/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const CHILD = join(import.meta.dirname, 'fixtures', 'child-executor.ts');

/** Start the child, wait until it hangs inside the open transaction, then kill -9 it. */
async function runAndKill(org: Org, runId: string, step: string, hangAt: number): Promise<string> {
  const child: ChildProcess = spawn(
    process.execPath,
    ['--import', 'tsx', CHILD, h.t.appUrl, org.tenantId, runId, step, String(hangAt), NIGHT],
    { cwd: join(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let out = '';
  let err = '';
  child.stderr?.on('data', (d) => {
    err += String(d);
  });
  const hung = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`child did not reach the hang point: ${out}\n${err}`)),
      45_000,
    );
    child.stdout?.on('data', (d) => {
      out += String(d);
      const m = /HANGING (\S+) (\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
      if (out.includes('FINISHED')) {
        clearTimeout(timer);
        reject(new Error(`child finished without hanging: ${out}`));
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (!/HANGING/.test(out)) reject(new Error(`child exited ${code}: ${out}\n${err}`));
    });
  });
  const exited = new Promise((r) => child.on('exit', r));
  child.kill('SIGKILL');
  await exited;
  // Postgres notices the dropped connection and rolls the open transaction back; wait until its backend is gone.
  for (let i = 0; i < 100; i++) {
    const { rows } = await sql<{ n: number }>`select count(*)::int as n from pg_stat_activity
      where datname = current_database() and state like 'idle in transaction%'`.execute(h.t.admin.kysely);
    if ((rows[0]?.n ?? 0) === 0) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return hung;
}

async function createRun(org: Org) {
  h.clock.set(NIGHT);
  const run = await org.run((tx) => h.service.createRun(tx, { propertyId: org.propertyId }), org.auditor);
  return run.run.id;
}

describe('SIGKILL mid-step and resume (E07)', () => {
  it('kill -9 inside the 4th stay-night transaction: 3 committed, the 4th rolled back, resume posts 4..8 once', async () => {
    const org = await setupOrg(h);
    for (let i = 0; i < 8; i++) await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-08' });
    const runId = await createRun(org);
    const hung = await runAndKill(org, runId, 'room_and_package_postings', 4);
    expect(hung).toBe('HANGING room_and_package_postings 4');

    // After the kill: three stay-nights committed with their progress; the fourth left nothing behind.
    const mid = await org.run((tx) => h.service.getRun(tx, runId), org.auditor);
    expect(mid.runStatus).toBe('running');
    expect(mid.steps.find((s) => s.key === 'room_and_package_postings')?.progress).toBe(
      'Room postings: 3 of 8 stay-nights posted, 5 remaining',
    );
    expect(await entriesByKey(h, org.tenantId, 'room:')).toHaveLength(3);
    expect(await entriesByKey(h, org.tenantId, 'inclusion:')).toHaveLength(3);
    await assertBooksBalance(h, org);

    h.clock.advance(3 * 60_000);
    const done = await h.service.resumeRun(h.t.db, org.auditor, runId, mid.version);
    expect(done.runStatus).toBe('completed');
    const room = await entriesByKey(h, org.tenantId, 'room:');
    expect(room).toHaveLength(8);
    expect(room.every((r) => r.n === 1)).toBe(true);
    expect((await entriesByKey(h, org.tenantId, 'inclusion:')).every((r) => r.n === 1)).toBe(true);
    expect(await businessDate(org)).toBe('2026-11-08');
    await assertBooksBalance(h, org);
  });

  it('kill -9 inside the advance transaction: the date stays D; resume advances exactly once', async () => {
    const org = await setupOrg(h);
    for (let i = 0; i < 2; i++) await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-08' });
    const runId = await createRun(org);
    await runAndKill(org, runId, 'advance', 0);

    // platform.advanceBusinessDate ran inside the killed transaction: rolled back with the step completion.
    expect(await businessDate(org)).toBe(D);
    const mid = await org.run((tx) => h.service.getRun(tx, runId), org.auditor);
    expect(mid.steps.find((s) => s.key === 'advance')?.status).toBe('running');
    expect(mid.steps.find((s) => s.key === 'integrity')?.status).toBe('completed');

    h.clock.advance(3 * 60_000);
    const done = await h.service.resumeRun(h.t.db, org.auditor, runId, mid.version);
    expect(done.runStatus).toBe('completed');
    expect(await businessDate(org)).toBe('2026-11-08');
    const log = await h.t.admin.kysely
      .selectFrom('platform.business_date_log')
      .select(['from_date', 'to_date'])
      .where('tenant_id', '=', org.tenantId)
      .execute();
    expect(log).toEqual([{ from_date: D, to_date: '2026-11-08' }]);
    expect((await entriesByKey(h, org.tenantId, 'room:')).every((r) => r.n === 1)).toBe(true);
  });
});
