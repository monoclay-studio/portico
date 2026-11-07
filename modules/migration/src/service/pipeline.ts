/**
 * The one-button pipeline runner. `run` executes steps in order until a step waits for a person, fails, or a step
 * must be started by a person (the freeze). Every step is idempotent and its status is persisted, so `run` resumes
 * from the first unfinished step after a crash. A lease on the job prevents two runners at once (the import itself
 * is also protected by the job row lock and the ledger, so even a broken lease cannot duplicate records).
 */
import { type PorticoDatabase, sql, withTenantTx } from '@portico/db';
import { ConflictError, DomainError, newId, type RequestContext } from '@portico/kernel';
import { HUMAN_STARTED, resumePoint, STEP_LABELS, type StepKey } from '../domain/pipeline';
import { DATA_CLASS_LABELS, type DataClass, type ReservationRecord } from '../domain/records';
import { P } from '../manifest';
import { observeSourceAccess, waitingChecklist } from './checklist';
import {
  actorKey,
  assertOpen,
  db,
  type Job,
  loadJob,
  loadJobFor,
  type MigrationDeps,
  saveJob,
} from './context';
import { runCutoverStep, runDeltaSyncStep, runFreezeStep, runVerifyStep, runWindowStep } from './cutover';
import { decisionsOf } from './exceptions';
import { extractFromSimulator, loadExtracts, materialize } from './extract';
import { importAll } from './importer';
import { runMapStep, runValidateStep } from './plan';
import { buildReport, latestReports } from './reconcile';
import { countOpenBlocking, loadSourceRecords } from './state';

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
        ? withTenantTx(database, ctx, async (tx) => {
            const j = await loadJob(tx, job.id, { lock: true });
            const rep = await buildReport(tx, deps, j, 'rehearsal');
            const unexplained = rep.result.differences.filter((d) => !d.explained).length;
            return rep.result.exact
              ? ({
                  status: 'succeeded',
                  detail: `Report ${rep.seq}: exact (fingerprint ${rep.result.fingerprint}).`,
                } as const)
              : ({
                  status: 'waiting',
                  detail: `Report ${rep.seq}: ${unexplained} unexplained difference(s). Each is an exception with an owner.`,
                  owner: 'Migration lead and finance controller',
                } as const);
          })
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

/** Rehearsal jobs import into their own (trial / sandbox) organization. */
async function rehearseHere(
  database: PorticoDatabase,
  deps: MigrationDeps,
  ctx: RequestContext,
  job: Job,
  opts: { failAfter?: number },
): Promise<StepOutcome> {
  if (ctx.environment === 'live')
    throw new DomainError('rehearsal_in_live', 'Rehearsals never import into a live organization.', {
      status: 409,
    });
  const s = await importAll(
    database,
    deps,
    ctx,
    job.id,
    opts.failAfter === undefined ? {} : { failAfter: opts.failAfter },
  );
  if (ctx.environment === 'trial')
    await withTenantTx(database, ctx, async (tx) => {
      const counts: Record<string, number> = {};
      for (const r of await loadSourceRecords(tx, job.id))
        counts[r.dataClass] = (counts[r.dataClass] ?? 0) + 1;
      await deps.ports.platform.recordTrialImport(tx, {
        sourceSystem: job.sourceSystem,
        copiedAt: tx.now,
        recordCounts: counts,
      });
    });
  const detail = `${s.created} created, ${s.updated} updated, ${s.merged} linked, ${s.unchanged} unchanged, ${s.exceptions} waiting on exceptions, ${s.excluded} excluded.`;
  if (s.unavailable.length)
    return {
      status: 'waiting',
      detail: `${detail} Not available on this server yet: ${s.unavailable.join(', ')} (provider contract requested).`,
      owner: 'Monoclay onboarding lead',
    };
  return { status: 'succeeded', detail };
}

/** Second rehearsal: re-import (must change nothing) and reconcile again; two exact identical reports certify. */
async function certify(
  database: PorticoDatabase,
  deps: MigrationDeps,
  ctx: RequestContext,
  job: Job,
): Promise<StepOutcome> {
  const s = await importAll(database, deps, ctx, job.id);
  return withTenantTx(database, ctx, async (tx) => {
    const j = await loadJob(tx, job.id, { lock: true });
    const prev = (await latestReports(tx, j.id, 1))[0];
    const rep = await buildReport(tx, deps, j, 'certification');
    const changed = s.created + s.updated;
    if (!rep.result.exact || !prev?.exact || prev.fingerprint !== rep.result.fingerprint || changed > 0)
      return {
        status: 'waiting',
        detail: `The second rehearsal ${changed > 0 ? `changed ${changed} record(s)` : 'did not reproduce the first report'}; it must reconcile exactly twice in a row. Run it again after resolving the exceptions.`,
        owner: 'Migration lead',
      } as const;
    const extracts = await db(tx)
      .selectFrom('migration.extracts')
      .select(['seq', 'fingerprint'])
      .where('job_id', '=', j.id)
      .orderBy('seq', 'desc')
      .limit(1)
      .execute();
    const certificate = {
      planFingerprint: j.planFingerprint,
      extractFingerprint: extracts[0]?.fingerprint ?? null,
      exact: true,
      reports: [
        {
          seq: prev.seq,
          fingerprint: prev.fingerprint,
          exact: prev.exact,
          generatedAt: prev.generated_at.toISOString(),
        },
        { seq: rep.seq, fingerprint: rep.result.fingerprint, exact: true, generatedAt: tx.now.toISOString() },
      ],
      openBlockingExceptions: await countOpenBlocking(tx, j.id),
      certifiedAt: tx.now.toISOString(),
    };
    await saveJob(tx, j, { certificate, state: 'rehearsed' });
    await db(tx)
      .insertInto('migration.signoffs')
      .values({
        id: newId(tx.now.getTime()),
        tenant_id: tx.tenantId,
        job_id: j.id,
        kind: 'rehearsal_certificate',
        report_id: rep.id,
        report_fingerprint: rep.result.fingerprint,
        signer: actorKey(tx),
        signer_name: null,
        note: 'Two consecutive exact reconciliations of the same plan and extract (automatic).',
        evidence: JSON.stringify(certificate),
        signed_at: tx.now,
      })
      .execute();
    await tx.emit({
      type: 'migration.rehearsal.certified',
      propertyId: j.propertyId,
      aggregate: { type: 'migration_job', id: j.id },
      payload: {
        jobId: j.id,
        planFingerprint: j.planFingerprint,
        reports: certificate.reports.map((r) => r.seq),
      },
    });
    return {
      status: 'succeeded',
      detail: `Rehearsed twice with zero differences (reports ${prev.seq} and ${rep.seq}).`,
    } as const;
  });
}

/** Production: rehearse through the linked trial organization (same plan, same extract). */
async function rehearseInTrial(
  database: PorticoDatabase,
  deps: MigrationDeps,
  ctx: RequestContext,
  job: Job,
): Promise<StepOutcome> {
  if (!job.rehearsalLink)
    return {
      status: 'waiting',
      detail: 'Link a trial organization (and its property) where the rehearsal runs.',
      owner: 'Migration lead',
    };
  const link = job.rehearsalLink;
  const payload = await withTenantTx(database, ctx, async (tx) => {
    const extracts = await loadExtracts(tx, job.id);
    const records = await loadSourceRecords(tx, job.id);
    const controlTotals = extracts.flatMap((e) => materialize(e, job.plan).controlTotals);
    const decisions = (await decisionsOf(tx, job.id)).map((d) => ({
      dataClass: d.data_class,
      sourceKey: d.source_key,
      code: d.code,
      outcome: d.outcome as string,
      resolution: d.resolution,
    }));
    return { seq: extracts[extracts.length - 1]?.seq ?? 0, records, controlTotals, decisions };
  });
  const evidence = await withTenantTx(database, ctx, (tx) =>
    deps.ports.rehearsal.rehearse(tx, {
      trialOrganizationId: link.trialOrganizationId,
      trialPropertyId: link.trialPropertyId,
      liveJobId: job.id,
      sourceAdapter: job.sourceAdapter,
      sourceSystem: job.sourceSystem,
      plan: job.plan,
      extract: { seq: payload.seq, records: payload.records, controlTotals: payload.controlTotals },
      decisions: payload.decisions,
    }),
  );
  await withTenantTx(database, ctx, async (tx) => {
    const j = await loadJob(tx, job.id, { lock: true });
    await saveJob(tx, j, { certificate: { ...evidence } });
  });
  return {
    status: 'succeeded',
    detail: `Rehearsed in the trial organization (${evidence.reports.length} report(s); ${evidence.exact ? 'exact' : 'not exact yet'}).`,
  };
}

async function evidenceStep(
  database: PorticoDatabase,
  deps: MigrationDeps,
  ctx: RequestContext,
  job: Job,
): Promise<StepOutcome> {
  if (!job.rehearsalLink)
    return { status: 'waiting', detail: 'No trial organization is linked.', owner: 'Migration lead' };
  const link = job.rehearsalLink;
  const evidence = await withTenantTx(database, ctx, (tx) =>
    deps.ports.rehearsal.evidence(tx, { trialOrganizationId: link.trialOrganizationId, liveJobId: job.id }),
  );
  await withTenantTx(database, ctx, async (tx) => {
    const j = await loadJob(tx, job.id, { lock: true });
    await saveJob(tx, j, { certificate: evidence ? { ...evidence } : null });
  });
  if (!evidence?.exact || !evidence.certifiedAt)
    return {
      status: 'waiting',
      detail:
        'The rehearsal in the trial organization has not reconciled exactly twice yet. Resolve its exceptions there and run it again.',
      owner: 'Migration lead',
    };
  if (evidence.planFingerprint !== job.planFingerprint)
    return {
      status: 'waiting',
      detail: 'The trial rehearsal ran an older plan. Run the rehearsal again.',
      owner: 'Migration lead',
    };
  return {
    status: 'succeeded',
    detail: `Rehearsal certified at ${evidence.certifiedAt} (two exact reconciliations).`,
  };
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
