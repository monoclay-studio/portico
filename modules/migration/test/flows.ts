/** Shared flows for tests: a production job brought to "in sync" (every gate prepared), in a live organization. */
import { migration, sampleGuesthouseFiles } from '../src';
import { ALL_MIGRATION, type Harness, type Org, setupLiveWithTrial } from './harness';

export const LEAD = [
  'migration.job.read',
  'migration.job.manage',
  'migration.mapping.review',
  'migration.exception.manage',
  'migration.cutover.execute',
  'migration.checklist.complete',
];

export interface ProductionFlow {
  live: Org;
  trial: Org;
  jobId: string;
  lead: Org['admin'];
  gm: Org['admin'];
  finance: Org['admin'];
}

export async function productionInSync(
  h: Harness,
  opts: { files?: ReturnType<typeof sampleGuesthouseFiles>; stopAt?: 'signoff' | 'in_sync' } = {},
): Promise<ProductionFlow> {
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
  await migration.uploadFiles(h.t.db, h.deps, lead, job.id, {
    files: opts.files ?? sampleGuesthouseFiles(live.businessDate),
  });
  await migration.runPipeline(h.t.db, h.deps, lead, job.id);
  await live.run(
    (tx) =>
      migration.reviewMapping(tx, h.deps, job.id, {
        taxAccounts: [{ sourceCode: 'TGST', accountKey: 'tgst' }],
      }),
    finance,
  );
  await migration.runPipeline(h.t.db, h.deps, lead, job.id);
  if (opts.stopAt === 'signoff') return { live, trial, jobId: job.id, lead, gm, finance };
  const done = (key: string, evidence: Record<string, string>, ctx = gm) =>
    live.run((tx) => migration.completeChecklistItem(tx, job.id, key, { status: 'done', evidence }), ctx);
  await done('data_authorization', { reference: 'DPA-1' });
  await done('card_transfer', { decision: 're_collect' }, finance);
  await done('opening_balances', { note: 'agreed' }, finance);
  await done('channel_switch', { note: 'order agreed' });
  await done('staff_acceptance', { note: 'arrivals, check-in, check-out checked' });
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
  return { live, trial, jobId: job.id, lead, gm, finance };
}
