/**
 * Regression tests from the steward review (fix round 1), the gate seam: what the rehearsal certificate binds
 * (R-P1-2) and what the final capture counts (R-P1-4). Each is a PoC from
 * `docs/orchestration/reviews/migration-poc/zz-review-integration.test.ts.txt`, inverted.
 */
import { sql, withTenantTx } from '@portico/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type MigrationDeps, migration, sampleGuesthouseFiles } from '../src';
import { currentDataFingerprint } from '../src/service/certificate';
import { db, loadJob } from '../src/service/context';
import { sampleGuesthousePack } from '../src/sources/templates';
import { LEAD, productionInSync } from './flows';
import { ALL_MIGRATION, type Harness, setupLiveWithTrial, startHarness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const BD = '2026-12-01';
const pack = () => sampleGuesthousePack(BD);
const ROOM_TOTAL = 12;
const TOTAL = 17;

/** The export the hotel uploads while in sync: CN1003 now costs 999.00 and a new booking CN1099 appears. */
function changedExport() {
  const p = pack();
  const reservations = p.reservations.map((r) =>
    r[0] === 'CN1003' ? r.map((v, i) => (i === ROOM_TOTAL ? '999.00' : i === TOTAL ? '1035.60' : v)) : r,
  );
  const cn1003 = reservations.find((r) => r[0] === 'CN1003') as string[];
  reservations.push(cn1003.map((v, i) => (i === 0 ? 'CN1099' : v)));
  return sampleGuesthouseFiles(BD, { reservations });
}

async function trialJob(trial: Awaited<ReturnType<typeof productionInSync>>['trial']) {
  return withTenantTx(h.t.db, trial.admin, async (tx) => {
    const row = await db(tx).selectFrom('migration.jobs').select('id').executeTakeFirstOrThrow();
    return loadJob(tx, row.id);
  });
}

describe('R-P1-2 the certificate binds plan AND data AND decisions', () => {
  it('an export uploaded while in sync is rehearsed again in the trial before the freeze; the cutover imports only rehearsed data', async () => {
    const f = await productionInSync(h);
    const up = await migration.uploadFiles(h.t.db, h.deps, f.lead, f.jobId, { files: changedExport() });
    expect(up.delta).toMatchObject({ added: 1, changed: 1 });
    const r = await migration.runPipeline(h.t.db, h.deps, f.lead, f.jobId, { start: 'freeze' });
    expect(r.executed.map((e) => `${e.step}:${e.status}`)).toEqual([
      'delta_sync:succeeded',
      'freeze:succeeded',
      'cutover:succeeded',
      'verify:succeeded',
      'rollback_window:waiting',
    ]);
    expect(r.executed[0]?.detail).toMatch(/rehearsed again and reconcile exactly/);
    // The trial holds what live holds — 9 bookings, CN1003 at the new price — and certified those exact data.
    const trialCount = await withTenantTx(h.t.db, f.trial.admin, (tx) =>
      h.reservations.count(tx, f.trial.propertyId),
    );
    expect(trialCount).toBe(9);
    expect(await f.live.run((tx) => h.reservations.count(tx, f.live.propertyId))).toBe(9);
    const tj = await trialJob(f.trial);
    const trialPrice = await withTenantTx(h.t.db, f.trial.admin, (tx) =>
      sql<{ total: string }>`select terms->>'roomTotalMinor' as total from fake_providers.bookings
        where property_id = ${f.trial.propertyId} and source_key = 'CN1003'`.execute(tx.db),
    );
    expect(trialPrice.rows[0]?.total).toBe('99900');
    const liveData = await f.live.run(async (tx) => currentDataFingerprint(tx, await loadJob(tx, f.jobId)));
    expect((tj.certificate as { dataFingerprint: string }).dataFingerprint).toBe(liveData);
  });

  it('an upload that lands after the delta sync (a race) is rehearsed again inside the measured freeze', async () => {
    const f = await productionInSync(h);
    await migration.uploadFiles(h.t.db, h.deps, f.lead, f.jobId, { files: changedExport() });
    // Simulate the race: the delta sync already succeeded when the upload landed.
    await f.live.run(async (tx) => {
      const j = await loadJob(tx, f.jobId, { lock: true });
      await db(tx)
        .updateTable('migration.jobs')
        .set({ steps: JSON.stringify({ ...j.steps, delta_sync: 'succeeded' }) })
        .where('id', '=', f.jobId)
        .execute();
    });
    const r = await migration.runPipeline(h.t.db, h.deps, f.lead, f.jobId, { start: 'freeze', maxSteps: 1 });
    expect(r.executed).toEqual([
      { step: 'freeze', status: 'succeeded', detail: expect.stringMatching(/rehearsed again/) },
    ]);
    expect(
      await withTenantTx(h.t.db, f.trial.admin, (tx) => h.reservations.count(tx, f.trial.propertyId)),
    ).toBe(9);
  });

  it('when the rehearsal cannot cover the new data, the gate refuses (rehearsal_stale_data) and nothing is imported', async () => {
    const f = await productionInSync(h);
    const stale = await f.live.run(async (tx) => (await loadJob(tx, f.jobId)).certificate);
    // A rehearsal side that keeps answering with the OLD certificate (the trial could not rehearse the new data).
    const deps: MigrationDeps = {
      ...h.deps,
      ports: {
        ...h.deps.ports,
        rehearsal: {
          rehearse: async () => stale as never,
          evidence: async () => stale as never,
        },
      },
    };
    await migration.uploadFiles(h.t.db, deps, f.lead, f.jobId, { files: changedExport() });
    const sync = await migration.runPipeline(h.t.db, deps, f.lead, f.jobId, { start: 'freeze' });
    expect(sync.executed).toEqual([
      { step: 'delta_sync', status: 'waiting', detail: expect.stringMatching(/changed after the rehearsal/) },
    ]);
    // Even if the delta sync is forced past (a race), the freeze gate itself compares the data.
    await f.live.run(async (tx) => {
      const j = await loadJob(tx, f.jobId, { lock: true });
      await db(tx)
        .updateTable('migration.jobs')
        .set({ steps: JSON.stringify({ ...j.steps, delta_sync: 'succeeded' }) })
        .where('id', '=', f.jobId)
        .execute();
    });
    const r = await migration.runPipeline(h.t.db, deps, f.lead, f.jobId, { start: 'freeze' });
    expect(r.executed).toEqual([
      {
        step: 'freeze',
        status: 'waiting',
        detail: expect.stringMatching(/Cutover not started.*changed after the rehearsal/),
      },
    ]);
    expect(await f.live.run((tx) => h.reservations.count(tx, f.live.propertyId))).toBe(0);
    const refused = await f.live.run((tx) =>
      sql<{ reason: string }>`select reason from core.audit_log where tenant_id = ${f.live.tenantId}
        and action = 'migration.cutover.refused'`.execute(tx.db),
    );
    expect(refused.rows.map((x) => x.reason)).toContain('rehearsal_stale_data');
  });
});

describe('R-P1-4 decided records never hold the cutover; undecided (or newly changed) problems do', () => {
  /** A stale "confirmed" booking (its stay ended before the business date): future_stay_in_past, blocking. */
  function staleRow(extra: (v: string, i: number) => string = (v) => v) {
    const p = pack();
    return (p.reservations.find((r) => r[0] === 'CN1003') as string[])
      .map((v, i) => (i === 0 ? 'CN1009' : i === 2 ? '2026-11-20' : i === 3 ? '2026-11-22' : v))
      .map(extra);
  }

  async function excludedFlow() {
    const p = pack();
    const files = sampleGuesthouseFiles(BD, { reservations: [...p.reservations, staleRow()] });
    const { live, trial } = await setupLiveWithTrial(h);
    const lead = live.user('Lead', LEAD);
    const gm = live.user('GM', ALL_MIGRATION);
    const finance = live.user('Finance', [
      'migration.job.read',
      'migration.mapping.review',
      'migration.finance.signoff',
    ]);
    const job = await live.run(
      (tx) =>
        migration.createJob(tx, h.deps, {
          propertyId: live.propertyId,
          sourceAdapter: 'portico.pack.v1',
          sourceSystem: 'Coral Nest spreadsheets',
          rehearsal: { trialOrganizationId: trial.tenantId, trialPropertyId: trial.propertyId },
        }),
      lead,
    );
    await migration.uploadFiles(h.t.db, h.deps, lead, job.id, { files });
    await migration.runPipeline(h.t.db, h.deps, lead, job.id);
    await live.run(
      (tx) =>
        migration.reviewMapping(tx, h.deps, job.id, {
          taxAccounts: [{ sourceCode: 'TGST', accountKey: 'tgst' }],
        }),
      finance,
    );
    await migration.runPipeline(h.t.db, h.deps, lead, job.id);
    const ex = await live.run(
      (tx) => migration.listExceptions(tx, job.id, { status: 'open', limit: 100 }),
      lead,
    );
    const blocking = ex.filter((e) => e.severity === 'blocking');
    expect(blocking.map((e) => `${e.sourceKey}:${e.code}`)).toEqual(['CN1009:future_stay_in_past']);
    await live.run(
      (tx) =>
        migration.resolveException(tx, (blocking[0] as { id: string }).id, {
          outcome: 'excluded',
          resolution: 'Old test booking, not real',
        }),
      lead,
    );
    await migration.runPipeline(h.t.db, h.deps, lead, job.id);
    const done = (key: string, evidence: Record<string, string>, ctx = gm) =>
      live.run((tx) => migration.completeChecklistItem(tx, job.id, key, { status: 'done', evidence }), ctx);
    await done('data_authorization', { reference: 'DPA-1' });
    await done('card_transfer', { decision: 're_collect' }, finance);
    await done('opening_balances', { note: 'agreed' }, finance);
    await done('channel_switch', { note: 'order agreed' });
    await done('staff_acceptance', { note: 'checked' });
    await live.run(
      (tx) => migration.authorizeProduction(tx, job.id, { evidenceRef: 'DPA-1', validHours: 72 }),
      gm,
    );
    await migration.runPipeline(h.t.db, h.deps, lead, job.id);
    await live.run(
      (tx) =>
        migration.planCutover(tx, h.deps, job.id, {
          plannedStartAt: '2026-12-01T22:00:00Z',
          freezeMinutes: 15,
        }),
      lead,
    );
    await live.run((tx) => migration.approveCutover(tx, h.deps, job.id), gm);
    await migration.runPipeline(h.t.db, h.deps, lead, job.id);
    expect((await live.run((tx) => migration.getJob(tx, job.id))).state).toBe('in_sync');
    return { live, trial, lead, jobId: job.id };
  }

  it('the lead excludes a blocking booking as documented; the freeze passes and the booking is never imported', async () => {
    const f = await excludedFlow();
    const r = await migration.runPipeline(h.t.db, h.deps, f.lead, f.jobId, { start: 'freeze' });
    expect(r.executed.map((e) => `${e.step}:${e.status}`)).toEqual([
      'freeze:succeeded',
      'cutover:succeeded',
      'verify:succeeded',
      'rollback_window:waiting',
    ]);
    const ledger = await f.live.run(
      async (tx) => migration.loadLedger(tx, await migration.getJob(tx, f.jobId)),
      f.lead,
    );
    expect(ledger.get('reservation:CN1009')?.state).toBe('excluded');
    // The decision travelled to the rehearsal (the trial excluded it too).
    const trialDecision = await withTenantTx(h.t.db, f.trial.admin, (tx) =>
      db(tx)
        .selectFrom('migration.exceptions')
        .select(['outcome'])
        .where('source_key', '=', 'CN1009')
        .where('code', '=', 'future_stay_in_past')
        .executeTakeFirst(),
    );
    expect(trialDecision?.outcome).toBe('excluded');
  });

  it('a NEW blocking problem on the decided record (final capture) holds the cutover again', async () => {
    const f = await excludedFlow();
    // The final export: CN1009's amount is now unreadable — a problem the exclusion did not decide.
    const p = pack();
    const files = sampleGuesthouseFiles(BD, {
      reservations: [...p.reservations, staleRow((v, i) => (i === ROOM_TOTAL ? '1.2.3' : v))],
    });
    await migration.uploadFiles(h.t.db, h.deps, f.lead, f.jobId, { files });
    const r = await migration.runPipeline(h.t.db, h.deps, f.lead, f.jobId, { start: 'freeze' });
    const freeze = r.executed.find((e) => e.step === 'freeze') ?? r.executed[r.executed.length - 1];
    expect(freeze?.status).toBe('waiting');
    expect(r.executed.map((e) => e.step)).not.toContain('cutover');
    const refused = await f.live.run((tx) =>
      sql<{ after: { blockers: Array<{ code: string }> } }>`select after from core.audit_log
        where tenant_id = ${f.live.tenantId} and action = 'migration.cutover.refused'`.execute(tx.db),
    );
    const codes = refused.rows.flatMap((x) => x.after.blockers.map((b) => b.code));
    expect(codes).toContain('final_capture_blocking');
    expect(await f.live.run((tx) => h.reservations.count(tx, f.live.propertyId))).toBe(0);
  });

  it('a decision changes what the cutover imports: the data fingerprint changes with it', async () => {
    const f = await productionInSync(h, { stopAt: 'signoff' });
    const before = await f.live.run(async (tx) => currentDataFingerprint(tx, await loadJob(tx, f.jobId)));
    await f.live.run((tx) =>
      db(tx)
        .insertInto('migration.exceptions')
        .values({
          id: '01900000-0000-7000-8000-000000000001',
          tenant_id: tx.tenantId,
          job_id: f.jobId,
          property_id: f.live.propertyId,
          data_class: 'reservation',
          source_key: 'CN1003',
          code: 'prepaid_without_deposit',
          severity: 'blocking',
          financial: true,
          problem: 'p',
          impact: 'i',
          proposed_resolution: 'r',
          owner_role: 'Finance controller',
          status: 'resolved',
          outcome: 'import_as_is',
          first_seen_at: tx.now,
          last_seen_at: tx.now,
        })
        .execute(),
    );
    const after = await f.live.run(async (tx) => currentDataFingerprint(tx, await loadJob(tx, f.jobId)));
    expect(after).not.toBe(before);
  });
});
