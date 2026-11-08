/**
 * The one-button pipeline runner. `run` executes steps in order until a step waits for a person, fails, or a step
 * must be started by a person (the freeze). Every step is idempotent and its status is persisted, so `run` resumes
 * from the first unfinished step after a crash. A lease on the job prevents two runners at once (the import itself
 * is also protected by the job row lock and the ledger, so even a broken lease cannot duplicate records).
 */
import { type PorticoDatabase, sql, withTenantTx } from '@portico/db';
import { ConflictError, DomainError, type RequestContext } from '@portico/kernel';
import { HUMAN_STARTED, resumePoint, STEP_LABELS, type StepKey } from '../domain/pipeline';
import { DATA_CLASS_LABELS, type DataClass, type ReservationRecord } from '../domain/records';
import { P } from '../manifest';
import { observeSourceAccess, waitingChecklist } from './checklist';
import { assertOpen, db, type Job, loadJob, loadJobFor, type MigrationDeps, saveJob } from './context';
import { runCutoverStep, runDeltaSyncStep, runFreezeStep, runVerifyStep, runWindowStep } from './cutover';
import { extractFromSimulator, loadExtracts, materialize } from './extract';
import { runMapStep, runValidateStep } from './plan';
import { certify, evidenceStep, reconcileRehearsal, rehearseHere, rehearseInTrial } from './rehearse';
import { loadSourceRecords } from './state';

export const LEASE_MS = 10 * 60_000;

export type StepOutcome =
  | { status: 'succeeded'; detail: string | null }
  | { status: 'waiting'; detail: string; owner: string | null }
  | { status: 'failed'; detail: string };

export interface RunReport {
  executed: Array<{ step: StepKey; status: string; detail: string | null }>;
}

async function acquireLease(database: PorticoDatabase, ctx: RequestContext, jobId: string): Promise<Job> {
  return withTenantTx(database, ctx, async (tx) => {
    const job = await loadJobFor(tx, jobId, P.manage, { lock: true });
    assertOpen(job);
    if (job.runningUntil && job.runningUntil.getTime() > tx.now.getTime())
      throw new ConflictError(
        'migration_running',
        'This migration is already running (started by another request). Wait for it to finish; its progress is on the migration page.',
        { runningUntil: job.runningUntil.toISOString() },
      );
    await db(tx)
      .updateTable('migration.jobs')
      .set({
        running_until: new Date(tx.now.getTime() + LEASE_MS),
        running_by: ctx.correlationId,
        run_correlations: sql`array_append(run_correlations, ${ctx.correlationId}::text)`,
      })
      .where('id', '=', jobId)
      .execute();
    return job;
  });
}

async function releaseLease(database: PorticoDatabase, ctx: RequestContext, jobId: string) {
  await withTenantTx(database, ctx, (tx) =>
    db(tx)
      .updateTable('migration.jobs')
      .set({ running_until: null, running_by: null })
      .where('id', '=', jobId)
      .where('running_by', '=', ctx.correlationId)
      .execute(),
  );
}

async function setStep(
  database: PorticoDatabase,
  ctx: RequestContext,
  jobId: string,
  step: StepKey,
  outcome: {
    status: 'running' | 'succeeded' | 'waiting' | 'failed';
    detail: string | null;
    owner?: string | null;
  },
) {
  return withTenantTx(database, ctx, async (tx) => {
    const job = await loadJob(tx, jobId, { lock: true });
    const steps = { ...job.steps, [step]: outcome.status };
    const stepDetail = {
      ...job.stepDetail,
      [step]: { detail: outcome.detail, owner: outcome.owner ?? null, at: tx.now.toISOString() },
    };
    const state =
      outcome.status === 'waiting' && ['in_progress', 'draft'].includes(job.state)
        ? ('waiting' as const)
        : outcome.status === 'running' && ['waiting', 'draft'].includes(job.state)
          ? ('in_progress' as const)
          : undefined;
    const next = await saveJob(tx, job, { steps, stepDetail, ...(state ? { state } : {}) });
    if (outcome.status !== 'running') {
      await tx.audit({
        action: `migration.step.${outcome.status}`,
        target: { type: 'migration_job', id: jobId },
        propertyId: job.propertyId,
        after: { step, detail: outcome.detail },
      });
      await tx.emit({
        type: `migration.step.${outcome.status}`,
        propertyId: job.propertyId,
        aggregate: { type: 'migration_job', id: jobId },
        aggregateVersion: next.version,
        payload: { jobId, step, status: outcome.status, detail: outcome.detail },
      });
    }
    return next;
  });
}

/**
 * Run the pipeline from where it stopped. `start` lets a person start a step that never starts by itself (the
 * freeze). `failAfter` injects a crash during the import (tests).
 */
export async function runPipeline(
  database: PorticoDatabase,
  deps: MigrationDeps,
  ctx: RequestContext,
  jobId: string,
  opts: { start?: StepKey; maxSteps?: number; failAfter?: number; finalFiles?: unknown } = {},
): Promise<RunReport> {
  await acquireLease(database, ctx, jobId);
  const executed: RunReport['executed'] = [];
  try {
    for (let i = 0; i < (opts.maxSteps ?? 20); i++) {
      const job = await withTenantTx(database, ctx, (tx) => loadJob(tx, jobId));
      const step = resumePoint(job.steps);
      if (!step) break;
      if (HUMAN_STARTED.has(step) && opts.start !== step) break;
      await setStep(database, ctx, jobId, step, { status: 'running', detail: null });
      let outcome: StepOutcome;
      try {
        outcome = await executeStep(database, deps, ctx, job, step, opts);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        await setStep(database, ctx, jobId, step, { status: 'failed', detail });
        executed.push({ step, status: 'failed', detail });
        if (err instanceof DomainError) break;
        throw err;
      }
      await setStep(database, ctx, jobId, step, {
        status: outcome.status,
        detail: outcome.detail,
        owner: outcome.status === 'waiting' ? outcome.owner : null,
      });
      executed.push({ step, status: outcome.status, detail: outcome.detail });
      if (outcome.status !== 'succeeded') break;
    }
  } finally {
    await releaseLease(database, ctx, jobId);
  }
  return { executed };
}

function headlineCounts(
  records: Awaited<ReturnType<typeof loadSourceRecords>>,
  businessDate: string,
): string {
  const parts: string[] = [];
  const count = (c: DataClass) => records.filter((r) => r.dataClass === c).length;
  for (const c of ['unit_type', 'unit', 'rate_plan', 'guest'] as const)
    if (count(c)) parts.push(`${count(c)} ${DATA_CLASS_LABELS[c].toLowerCase()}`);
  const res = records
    .filter((r) => r.dataClass === 'reservation' && r.payload)
    .map((r) => r.payload as ReservationRecord);
  if (res.length) {
    const future = res.filter(
      (r) => ['confirmed', 'tentative'].includes(r.status) && r.arrival >= businessDate,
    ).length;
    const inHouse = res.filter((r) => r.status === 'in_house').length;
    parts.push(
      `${res.length} reservations (${future} future, ${inHouse} in house, ${res.length - future - inHouse} history)`,
    );
  }
  for (const c of ['deposit', 'in_house_balance', 'ar_open_item'] as const)
    if (count(c)) parts.push(`${count(c)} ${DATA_CLASS_LABELS[c].toLowerCase()}`);
  return parts.length ? `Found ${parts.join(', ')}.` : 'The source holds no records yet.';
}

async function executeStep(
  database: PorticoDatabase,
  deps: MigrationDeps,
  ctx: RequestContext,
  job: Job,
  step: StepKey,
  opts: { failAfter?: number; finalFiles?: unknown },
): Promise<StepOutcome> {
  switch (step) {
    case 'discover':
      return withTenantTx(database, ctx, async (tx) => {
        let j = await loadJob(tx, job.id, { lock: true });
        let extracts = await loadExtracts(tx, j.id);
        if (extracts.length === 0 && j.sourceAdapter === 'pms.simulator') {
          j = (await extractFromSimulator(tx, deps, j, 'initial')).job;
          extracts = await loadExtracts(tx, j.id);
        }
        if (extracts.length === 0)
          return {
            status: 'waiting',
            detail: `Waiting for the export from ${j.sourceSystem}: upload the files (templates are under Sources), or connect the system.`,
            owner: 'Hotel IT or general manager',
          } as const;
        const records = await loadSourceRecords(tx, j.id);
        const property = await deps.ports.platform.getProperty(tx, j.propertyId);
        await observeSourceAccess(tx, j, extracts[extracts.length - 1]?.seq ?? 0);
        return { status: 'succeeded', detail: headlineCounts(records, property.businessDate) } as const;
      });
    case 'extract':
      return withTenantTx(database, ctx, async (tx) => {
        const extracts = await loadExtracts(tx, job.id);
        const last = extracts[extracts.length - 1];
        if (!last) return { status: 'waiting', detail: 'No extract yet.', owner: 'Migration lead' } as const;
        const m = materialize(last, job.plan);
        return {
          status: 'succeeded',
          detail: `Extract ${last.seq} (${last.kind}): ${m.records.length} records.`,
        } as const;
      });
    case 'map':
      return withTenantTx(database, ctx, async (tx) => {
        const j = await loadJob(tx, job.id, { lock: true });
        const out = await runMapStep(tx, deps, j);
        return out.waiting
          ? ({ status: 'waiting', detail: out.waiting, owner: out.owner } as const)
          : ({ status: 'succeeded', detail: 'Every code and status is mapped.' } as const);
      });
    case 'validate':
      return withTenantTx(database, ctx, async (tx) => {
        const j = await loadJob(tx, job.id, { lock: true });
        const q = await runValidateStep(tx, deps, j);
        return {
          status: 'succeeded',
          detail: `${q.blocking} blocking problem(s) (those records wait for a decision), ${q.warnings} warning(s).`,
        } as const;
      });
    case 'rehearse':
      return job.purpose === 'rehearsal'
        ? rehearseHere(database, deps, ctx, job, opts)
        : rehearseInTrial(database, deps, ctx, job);
    case 'reconcile':
      return job.purpose === 'rehearsal'
        ? reconcileRehearsal(database, deps, ctx, job)
        : evidenceStep(database, deps, ctx, job);
    case 'signoff':
      return job.purpose === 'rehearsal'
        ? certify(database, deps, ctx, job)
        : productionSignoff(database, deps, ctx, job);
    case 'delta_sync':
      return runDeltaSyncStep(database, deps, ctx, job);
    case 'freeze':
      return runFreezeStep(database, deps, ctx, job, opts);
    case 'cutover':
      return runCutoverStep(database, deps, ctx, job, opts);
    case 'verify':
      return runVerifyStep(database, deps, ctx, job);
    case 'rollback_window':
      return runWindowStep(database, deps, ctx, job);
  }
}

async function productionSignoff(
  database: PorticoDatabase,
  _deps: MigrationDeps,
  ctx: RequestContext,
  job: Job,
): Promise<StepOutcome> {
  return withTenantTx(database, ctx, async (tx) => {
    const waiting = await waitingChecklist(tx, job, { except: ['cutover_window'] });
    const auth = await db(tx)
      .selectFrom('migration.authorizations')
      .select(['kind', 'plan_fingerprint', 'expires_at'])
      .where('job_id', '=', job.id)
      .orderBy('granted_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    const authorized =
      auth?.kind === 'production' &&
      auth.plan_fingerprint === job.planFingerprint &&
      (auth.expires_at?.getTime() ?? 0) > tx.now.getTime();
    if (waiting.length || !authorized)
      return {
        status: 'waiting',
        detail: `Waiting for: ${[
          ...waiting.map((w) => `${w.title} (${w.ownerRole})`),
          ...(authorized ? [] : ['production authorization by a second authorized person']),
        ].join('; ')}.`,
        owner: waiting[0]?.ownerRole ?? 'Migration approver',
      } as const;
    return { status: 'succeeded', detail: 'Every sign-off is recorded.' } as const;
  });
}

export function stepLabel(step: StepKey): string {
  return STEP_LABELS[step];
}
