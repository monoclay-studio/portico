/**
 * Jobs: "Move to Portico" (create), the job record with the universal record contract, listing, linking the trial
 * organization for rehearsals.
 */
import { pgCode, type TxContext, withSavepoint } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  newId,
  type RecordAction,
  type RecordIssue,
  type RecordLink,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { CreateJobInput, JobView } from '../contracts';
import { CHECKLIST, FREEZE_TARGET_MINUTES } from '../domain/cutover';
import { emptyPlan, pendingReview } from '../domain/mapping';
import { initialSteps, purposeFor, STEP_LABELS, STEPS, type StepKey } from '../domain/pipeline';
import { DATA_CLASSES, type DataClass, FINANCIAL_CLASSES } from '../domain/records';
import { P } from '../manifest';
import { DEFAULT_MIGRATED_DOMAINS, type MigrationPorts } from '../ports';
import { sourceAdapter } from '../sources/adapters';
import { initChecklist, loadChecklist } from './checklist';
import {
  actorKey,
  assertOpen,
  db,
  type Job,
  loadJobFor,
  type MigrationDeps,
  saveJob,
  toJob,
} from './context';
import { latestReports } from './reconcile';
import { ledgerNamespace } from './state';

export async function createJob(tx: TxContext, deps: MigrationDeps, input: CreateJobInput): Promise<Job> {
  requirePermission(tx, P.manage, { propertyId: input.propertyId });
  const adapter = sourceAdapter(input.sourceAdapter);
  if (!adapter)
    throw new ValidationError(
      'unknown_source',
      `Unknown source "${input.sourceAdapter}". Choose one from the list of sources (or the Portico templates).`,
    );
  if (adapter.kind === 'simulator') {
    if (tx.environment === 'live')
      throw new BusinessRuleError(
        'simulator_not_in_live',
        'The PMS simulator is never a source in a live organization. Use a real export or connection.',
      );
    if (!input.sourceRef)
      throw new ValidationError('simulator_account_required', 'Choose the simulator account.');
  }
  const property = await deps.ports.platform.getProperty(tx, input.propertyId);
  const purpose = purposeFor(tx.environment);
  if (purpose === 'rehearsal' && input.rehearsal)
    throw new ValidationError(
      'rehearsal_link_live_only',
      'Only a live migration links a trial organization.',
    );
  if (purpose === 'production') {
    // One property, one migrated history (R-P1-7): until records can be matched across sources, a production
    // migration is refused when the property already holds records imported from ANOTHER source (another adapter,
    // or the same adapter with another account). The same source dedupes through the import ledger.
    const namespace = ledgerNamespace({ sourceAdapter: adapter.key, sourceRef: input.sourceRef ?? null });
    const other = await db(tx)
      .selectFrom('migration.import_ledger')
      .select(['source_system', 'last_job_id'])
      .where('property_id', '=', input.propertyId)
      .where('source_system', '!=', namespace)
      .where('state', 'in', ['imported', 'merged'])
      .limit(1)
      .executeTakeFirst();
    if (other)
      throw new BusinessRuleError(
        'property_already_migrated',
        `This property already holds records migrated from another source (${other.source_system}). A second migration from a different source would create every booking and guest again. Continue with the same source, or ask Monoclay onboarding to reconcile the two sources first.`,
        { sourceSystem: other.source_system, jobId: other.last_job_id },
      );
  }
  const scope: DataClass[] = input.scope ?? [
    ...new Set<DataClass>([...adapter.provides, 'deposit', 'in_house_balance', 'ar_open_item']),
  ];
  const id = newId(tx.now.getTime());
  try {
    // In a savepoint: a refused insert (one open migration per property) leaves the transaction usable.
    const row = await withSavepoint(tx, 'mig_create_job', () =>
      db(tx)
        .insertInto('migration.jobs')
        .values({
          id,
          tenant_id: tx.tenantId,
          property_id: input.propertyId,
          purpose,
          environment: tx.environment,
          source_adapter: adapter.key,
          source_system: input.sourceSystem,
          source_ref: input.sourceRef ?? null,
          source_identity: id,
          state: 'draft',
          steps: JSON.stringify(initialSteps()),
          step_detail: '{}',
          plan: JSON.stringify(emptyPlan(property.baseCurrency, scope)),
          plan_fingerprint: null,
          domains: [...DEFAULT_MIGRATED_DOMAINS],
          rehearsal_link: input.rehearsal ? JSON.stringify(input.rehearsal) : null,
          live_job_ref: null,
          certificate: null,
          transition_id: null,
          rollback_transition_id: null,
          cutover_planned_at: null,
          frozen_at: null,
          switched_at: null,
          opened_at: null,
          freeze_minutes: null,
          rollback_window_ends_at: null,
          rolled_back_at: null,
          running_until: null,
          running_by: null,
          owner_user_id: tx.actor.kind === 'user' ? tx.actor.userId : null,
          created_by: actorKey(tx),
          created_at: tx.now,
          updated_at: tx.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    const job = toJob(row);
    await initChecklist(tx, job);
    await tx.audit({
      action: 'migration.job.create',
      target: { type: 'migration_job', id },
      propertyId: input.propertyId,
      after: { purpose, source: adapter.key, sourceSystem: input.sourceSystem, scope },
    });
    await tx.emit({
      type: 'migration.job.created',
      propertyId: input.propertyId,
      aggregate: { type: 'migration_job', id },
      aggregateVersion: 1,
      payload: { jobId: id, purpose, source: adapter.key },
    });
    return job;
  } catch (err) {
    if (pgCode(err) === '23505') {
      const open = await db(tx)
        .selectFrom('migration.jobs')
        .select('id')
        .where('property_id', '=', input.propertyId)
        .where('state', 'not in', ['completed', 'rolled_back', 'cancelled', 'failed'])
        .executeTakeFirst();
      throw new ConflictError(
        'migration_already_open',
        'This property already has a migration in progress. Continue it (its progress is kept) or cancel it first.',
        { jobId: open?.id ?? null },
      );
    }
    throw err;
  }
}

export async function linkRehearsal(
  tx: TxContext,
  jobId: string,
  input: { trialOrganizationId: string; trialPropertyId: string },
): Promise<Job> {
  const job = await loadJobFor(tx, jobId, P.manage, { lock: true });
  assertOpen(job);
  if (job.purpose !== 'production')
    throw new BusinessRuleError(
      'rehearsal_link_live_only',
      'Only a live migration links a trial organization.',
    );
  if (job.frozenAt) throw new ConflictError('cutover_started', 'The cutover has started.');
  const steps = { ...job.steps };
  for (const s of ['rehearse', 'reconcile', 'signoff'] as const) steps[s] = 'pending';
  const next = await saveJob(tx, job, { rehearsalLink: input, steps, certificate: null });
  await tx.audit({
    action: 'migration.job.linkRehearsal',
    target: { type: 'migration_job', id: job.id },
    propertyId: job.propertyId,
    after: input,
  });
  return next;
}

/** A job, for a caller who may read it at its property (404 otherwise). */
export async function getJob(tx: TxContext, id: string): Promise<Job> {
  return loadJobFor(tx, id, P.read);
}

export async function listJobs(tx: TxContext, filter: { propertyId?: string | undefined }) {
  const scope = tx.authz.propertyScope(P.read);
  if (scope !== 'all' && scope.length === 0) return [];
  let q = db(tx).selectFrom('migration.jobs').selectAll().orderBy('created_at', 'desc').limit(100);
  if (filter.propertyId) q = q.where('property_id', '=', filter.propertyId);
  if (scope !== 'all') q = q.where('property_id', 'in', [...scope]);
  return (await q.execute()).map(toJob);
}

// ───────────────────────────── the record view ─────────────────────────────

export async function jobView(tx: TxContext, job: Job, _ports?: MigrationPorts): Promise<JobView> {
  const adapter = sourceAdapter(job.sourceAdapter);
  const sourceCounts = await db(tx)
    .selectFrom('migration.source_records')
    .select(['data_class', (eb) => eb.fn.countAll<string>().as('n')])
    .where('job_id', '=', job.id)
    .where('missing_since', 'is', null)
    .groupBy('data_class')
    .execute();
  const ledgerCounts = await db(tx)
    .selectFrom('migration.import_ledger')
    .select(['data_class', 'state', (eb) => eb.fn.countAll<string>().as('n')])
    .where('property_id', '=', job.propertyId)
    .where('source_system', '=', ledgerNamespace(job))
    .groupBy(['data_class', 'state'])
    .execute();
  const counts: JobView['counts'] = {};
  for (const c of DATA_CLASSES) {
    const source = Number(sourceCounts.find((r) => r.data_class === c)?.n ?? 0);
    const l = ledgerCounts.filter((r) => r.data_class === c);
    const imported = l
      .filter((r) => ['imported', 'merged', 'suggested'].includes(r.state))
      .reduce((s, r) => s + Number(r.n), 0);
    const exceptions = l.filter((r) => r.state === 'exception').reduce((s, r) => s + Number(r.n), 0);
    if (source || imported || exceptions) counts[c] = { source, imported, exceptions };
  }
  const open = await db(tx)
    .selectFrom('migration.exceptions')
    .select(['severity', 'financial', 'data_class', (eb) => eb.fn.countAll<string>().as('n')])
    .where('job_id', '=', job.id)
    .where('status', 'in', ['open', 'in_progress'])
    .groupBy(['severity', 'financial', 'data_class'])
    .execute();
  const openExceptions = {
    blocking: open.filter((o) => o.severity === 'blocking').reduce((s, o) => s + Number(o.n), 0),
    warning: open.filter((o) => o.severity === 'warning').reduce((s, o) => s + Number(o.n), 0),
    financial: open
      .filter((o) => o.financial || FINANCIAL_CLASSES.has(o.data_class as DataClass))
      .reduce((s, o) => s + Number(o.n), 0),
  };
  const last = (await latestReports(tx, job.id, 1))[0];
  const checklistRows = await loadChecklist(tx, job.id);
  const checklist = CHECKLIST.filter(() => job.purpose === 'production').map((d) => {
    const r = checklistRows.find((x) => x.key === d.key);
    return {
      key: d.key,
      title: d.title,
      why: d.why,
      ownerRole: d.ownerRole,
      ownerUserId: r?.owner_user_id ?? null,
      completion: d.completion,
      status: r?.status ?? 'waiting',
      dueAt: (r?.due_at ?? tx.now).toISOString(),
      overdue: r?.status === 'waiting' && (r?.due_at?.getTime() ?? 0) < tx.now.getTime(),
      reminders: r?.reminders ?? 0,
      completedBy: r?.completed_by ?? null,
      completedAt: r?.completed_at?.toISOString() ?? null,
      evidence: (r?.evidence ?? null) as Record<string, unknown> | null,
    };
  });
  const steps = STEPS.map((s) => ({
    key: s,
    label: STEP_LABELS[s],
    status: job.steps[s],
    detail: job.stepDetail[s]?.detail ?? null,
    owner: job.stepDetail[s]?.owner ?? null,
    at: job.stepDetail[s]?.at ?? null,
  }));
  const pending = pendingReview(job.plan);
  const can = (p: string) => tx.authz.can(p, { propertyId: job.propertyId });
  const closed = ['completed', 'rolled_back', 'cancelled'].includes(job.state);
  const action = (
    a: string,
    label: string,
    permission: string,
    why: string | null,
    preview = false,
  ): RecordAction => {
    const reason = closed
      ? `The migration is ${job.state.replace('_', ' ')}.`
      : !can(permission)
        ? `You need ${permission}.`
        : why;
    return {
      action: a,
      label,
      enabled: !reason,
      ...(reason ? { reason } : {}),
      ...(preview ? { previewRequired: true } : {}),
    };
  };
  const waitingStep = STEPS.find((s) => job.steps[s] === 'waiting' || job.steps[s] === 'failed');
  const inSync = job.state === 'in_sync';
  const switched = job.state === 'switched' || job.state === 'rollback_window';
  const allowedActions: RecordAction[] = [
    action(
      'run',
      'Move to Portico (continue)',
      P.manage,
      job.runningUntil && job.runningUntil > tx.now ? 'Already running.' : null,
    ),
    action(
      'upload',
      'Upload exports',
      P.manage,
      job.sourceAdapter === 'pms.simulator' ? 'The simulator is read directly.' : null,
    ),
    action('reviewMapping', 'Review mappings', P.mappingReview, pending.length ? null : 'Nothing to review.'),
    action(
      'planCutover',
      'Plan cutover',
      P.cutoverExecute,
      job.frozenAt ? 'The cutover has started.' : null,
      true,
    ),
    action(
      'authorize',
      'Authorize production migration',
      P.productionAuthorize,
      job.purpose !== 'production' ? 'Rehearsals and drills need no authorization.' : null,
    ),
    action(
      'startCutover',
      'Start cutover (old system frozen)',
      P.cutoverExecute,
      inSync ? null : 'Available when the copy is in sync and the cutover is planned.',
      true,
    ),
    action(
      'sweep',
      'Read late changes from the old system',
      P.manage,
      switched ? null : 'Available after the switch.',
    ),
    action(
      'requestRollback',
      'Request rollback',
      P.cutoverExecute,
      switched ? null : 'Available after the switch, inside the rollback window.',
      true,
    ),
    action(
      'cancel',
      'Cancel migration',
      P.manage,
      job.frozenAt ? 'Use the rollback after the cutover started.' : null,
      true,
    ),
  ];
  const issues: RecordIssue[] = [];
  if (adapter?.verification === 'unverified')
    issues.push({ code: 'source_format_unverified', severity: 'warning', message: adapter.verificationNote });
  if (openExceptions.blocking)
    issues.push({
      code: 'blocking_exceptions',
      severity: 'blocking',
      message: `${openExceptions.blocking} blocking exception(s) are open; the cutover waits for them.`,
    });
  if (waitingStep)
    issues.push({
      code: `step_${job.steps[waitingStep]}`,
      severity: job.steps[waitingStep] === 'failed' ? 'blocking' : 'info',
      message: `${STEP_LABELS[waitingStep]}: ${job.stepDetail[waitingStep]?.detail ?? job.steps[waitingStep]}`,
      ...(job.stepDetail[waitingStep]?.at ? { since: job.stepDetail[waitingStep]?.at as string } : {}),
    });
  const links: RecordLink[] = [{ rel: 'property', type: 'property', id: job.propertyId }];
  if (job.transitionId)
    links.push({ rel: 'authorityTransition', type: 'authority_transition', id: job.transitionId });
  if (job.rollbackTransitionId)
    links.push({ rel: 'rollbackTransition', type: 'authority_transition', id: job.rollbackTransitionId });
  if (job.rehearsalLink)
    links.push({
      rel: 'rehearsalOrganization',
      type: 'organization',
      id: job.rehearsalLink.trialOrganizationId,
    });
  if (last) links.push({ rel: 'latestReport', type: 'migration_report', id: last.id });
  const cert = job.certificate as { exact?: boolean; certifiedAt?: string | null } | null;
  const cutoverStatus = job.rolledBackAt
    ? 'rolled_back'
    : job.openedAt
      ? 'verified'
      : job.switchedAt
        ? 'switched'
        : job.frozenAt
          ? 'frozen'
          : job.transitionId
            ? 'planned'
            : 'not_planned';
  const doneSteps = steps.filter((s) => s.status === 'succeeded').length;
  const headline = [
    job.stepDetail.discover?.detail ?? `Waiting for data from ${job.sourceSystem}.`,
    cert?.exact && cert.certifiedAt ? 'Rehearsed twice with zero differences.' : null,
    job.openedAt && job.freezeMinutes !== null
      ? `Portico is the system of record (freeze ${job.freezeMinutes} min).`
      : null,
    waitingStep ? `Waiting for: ${job.stepDetail[waitingStep]?.detail ?? STEP_LABELS[waitingStep]}` : null,
    `${doneSteps}/${steps.length} steps done.`,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    id: job.id,
    propertyId: job.propertyId,
    purpose: job.purpose,
    environment: job.environment,
    source: {
      adapter: job.sourceAdapter,
      label: adapter?.label ?? job.sourceAdapter,
      system: job.sourceSystem,
      verification: adapter?.verification ?? 'unverified',
      verificationNote: adapter?.verificationNote ?? '',
    },
    state: job.state,
    headline,
    steps,
    counts,
    pendingReview: pending,
    planFingerprint: job.planFingerprint,
    lastReport: last
      ? {
          id: last.id,
          seq: last.seq,
          exact: last.exact,
          fingerprint: last.fingerprint,
          generatedAt: last.generated_at.toISOString(),
        }
      : null,
    certificate: job.certificate,
    freeze: {
      targetMinutes: FREEZE_TARGET_MINUTES,
      measuredMinutes: job.freezeMinutes,
      frozenAt: job.frozenAt?.toISOString() ?? null,
      openedAt: job.openedAt?.toISOString() ?? null,
    },
    rollbackWindowEndsAt: job.rollbackWindowEndsAt?.toISOString() ?? null,
    checklist,
    openExceptions,
    provenance: job.environment === 'live' ? 'live' : job.environment === 'trial' ? 'copied' : 'simulated',
    status: {
      migration: job.state,
      rehearsal: cert?.exact && cert.certifiedAt ? 'certified' : 'not_certified',
      cutover: cutoverStatus,
    },
    allowedActions,
    issues,
    ...(job.ownerUserId ? { owner: { kind: 'user' as const, id: job.ownerUserId } } : {}),
    links,
    createdAt: job.createdAt.toISOString(),
    version: job.version,
  };
}

export function stepKeys(): readonly StepKey[] {
  return STEPS;
}
