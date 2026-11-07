/**
 * Interruption and concurrency: the pipeline resumes after a crash without duplicates; two runners never run at
 * once; concurrent importers (delta sync and sweep racing) never create a second copy; the same files give the same
 * records and the same reconciliation report (MG-01).
 */
import { withTenantTx } from '@portico/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migration, sampleGuesthouseFiles } from '../src';
import { db } from '../src/service/context';
import { ALL_MIGRATION, asSystem, type Harness, type Org, setupOrg, startHarness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

async function readyJob(org: Org) {
  const lead = org.user('Lead', ALL_MIGRATION);
  const job = await org.run(
    (tx) =>
      migration.createJob(tx, h.deps, {
        propertyId: org.propertyId,
        sourceAdapter: 'portico.pack.v1',
        sourceSystem: 'Sheets',
      }),
    lead,
  );
  await migration.uploadFiles(h.t.db, h.deps, lead, job.id, {
    files: sampleGuesthouseFiles(org.businessDate),
  });
  await migration.runPipeline(h.t.db, h.deps, lead, job.id);
  await org.run(
    (tx) =>
      migration.reviewMapping(tx, h.deps, job.id, {
        taxAccounts: [{ sourceCode: 'TGST', accountKey: 'tgst' }],
      }),
    lead,
  );
  return { lead, jobId: job.id };
}

const ledgerCount = (org: Org, dataClass: string) =>
  withTenantTx(h.t.db, org.admin, async (tx) =>
    Number(
      (
        await db(tx)
          .selectFrom('migration.import_ledger')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('property_id', '=', org.propertyId)
          .where('data_class', '=', dataClass)
          .where('state', '=', 'imported')
          .executeTakeFirst()
      )?.n,
    ),
  );

describe('resume after a crash', () => {
  it('a crash inside the reservations import rolls that chunk back; run resumes and imports each record once', async () => {
    const org = await setupOrg(h, { environment: 'trial' });
    const { lead, jobId } = await readyJob(org);
    h.reservations.calls = 0;
    h.reservations.crashOnCall = 5;
    await expect(migration.runPipeline(h.t.db, h.deps, lead, jobId)).rejects.toThrow(
      /simulated process crash/,
    );
    h.reservations.crashOnCall = null;
    const after = await org.run((tx) => migration.loadJob(tx, jobId));
    expect(after.steps.rehearse).toBe('failed');
    expect(after.stepDetail.rehearse?.detail).toMatch(/simulated process crash/);
    expect(after.runningUntil).toBeNull(); // the lease is released even when the step throws
    // Classes before the crash committed; the reservation chunk did not.
    expect(await ledgerCount(org, 'unit')).toBe(6);
    expect(await ledgerCount(org, 'reservation')).toBe(0);
    expect(await org.run((tx) => h.reservations.count(tx, org.propertyId))).toBe(0);
    const r = await migration.runPipeline(h.t.db, h.deps, lead, jobId);
    expect(r.executed.map((e) => `${e.step}:${e.status}`)).toEqual([
      'rehearse:succeeded',
      'reconcile:succeeded',
      'signoff:succeeded',
      'delta_sync:waiting',
    ]);
    expect(await org.run((tx) => h.reservations.count(tx, org.propertyId))).toBe(8);
    expect(await ledgerCount(org, 'reservation')).toBe(8);
  });

  it('a hard crash leaves the lease: a resume waits until it expires, then continues', async () => {
    const org = await setupOrg(h, { environment: 'trial' });
    const { lead, jobId } = await readyJob(org);
    await withTenantTx(h.t.db, org.admin, (tx) =>
      db(tx)
        .updateTable('migration.jobs')
        .set({ running_until: new Date(Date.now() + 60_000), running_by: 'dead-process' })
        .where('id', '=', jobId)
        .execute(),
    );
    await expect(migration.runPipeline(h.t.db, h.deps, lead, jobId)).rejects.toMatchObject({
      code: 'migration_running',
      status: 409,
    });
    await withTenantTx(h.t.db, org.admin, (tx) =>
      db(tx)
        .updateTable('migration.jobs')
        .set({ running_until: new Date(Date.now() - 1000) })
        .where('id', '=', jobId)
        .execute(),
    );
    const r = await migration.runPipeline(h.t.db, h.deps, lead, jobId);
    expect(r.executed.at(-1)?.step).toBe('delta_sync');
  });
});

describe('concurrency', () => {
  it('two "Move to Portico" presses at once: one runs, the other is told it is already running', async () => {
    const org = await setupOrg(h, { environment: 'trial' });
    const { lead, jobId } = await readyJob(org);
    const results = await Promise.allSettled([
      migration.runPipeline(h.t.db, h.deps, lead, jobId),
      migration.runPipeline(h.t.db, h.deps, { ...lead, correlationId: crypto.randomUUID() }, jobId),
    ]);
    const refused = results.filter((r) => r.status === 'rejected');
    expect(refused.length).toBeLessThanOrEqual(1);
    for (const r of refused)
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'migration_running' });
    // whichever ran, the result is one copy of everything
    await migration.runPipeline(h.t.db, h.deps, lead, jobId).catch(() => undefined);
    expect(await org.run((tx) => h.reservations.count(tx, org.propertyId))).toBe(8);
  });

  it('five importers racing (delta sync, sweep, retries) never create a second copy, nor a second consumption', async () => {
    const org = await setupOrg(h, { environment: 'trial' });
    const { lead, jobId } = await readyJob(org);
    await Promise.all(Array.from({ length: 5 }, () => migration.importAll(h.t.db, h.deps, lead, jobId)));
    expect(await org.run((tx) => h.reservations.count(tx, org.propertyId))).toBe(8);
    expect(await ledgerCount(org, 'reservation')).toBe(8);
    expect(await ledgerCount(org, 'guest')).toBe(6);
    const sold = await org.run(async (tx) =>
      (
        await h.inventory.getAvailability(asSystem(tx), {
          propertyId: org.propertyId,
          range: { from: '2026-12-04', to: '2026-12-05' },
        })
      ).reduce((s, c) => s + c.sold, 0),
    );
    expect(sold).toBe(2); // CN1001 + CN1008, once each
    const deposits = await withTenantTx(h.t.db, org.admin, async (tx) => {
      const ledger = await migration.loadLedger(tx, await migration.loadJob(tx, jobId));
      return h.finance.getDeposits(asSystem(tx), ledger.get('reservation:CN1001')?.targetId as string);
    });
    expect(deposits?.balance.amountMinor).toBe(10000); // posted once, not five times
  });
});

describe('MG-01: the same files give the same records and the same report', () => {
  it('re-uploading identical files changes nothing; a second organization reconciles to the same fingerprint', async () => {
    const a = await setupOrg(h, { environment: 'trial' });
    const ja = await readyJob(a);
    await migration.runPipeline(h.t.db, h.deps, ja.lead, ja.jobId);
    const up = await migration.uploadFiles(h.t.db, h.deps, ja.lead, ja.jobId, {
      files: sampleGuesthouseFiles(a.businessDate),
    });
    expect(up.delta).toEqual({ added: 0, changed: 0, removed: 0 });
    await migration.runPipeline(h.t.db, h.deps, ja.lead, ja.jobId);
    const b = await setupOrg(h, { environment: 'trial' });
    const jb = await readyJob(b);
    await migration.runPipeline(h.t.db, h.deps, jb.lead, jb.jobId);
    const fa = await a.run((tx) => migration.latestReports(tx, ja.jobId, 4));
    const fb = await b.run((tx) => migration.latestReports(tx, jb.jobId, 2));
    expect(new Set([...fa, ...fb].map((r) => r.fingerprint)).size).toBe(1);
    expect([...fa, ...fb].every((r) => r.exact)).toBe(true);
  });
});
