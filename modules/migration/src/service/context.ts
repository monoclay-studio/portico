import {
  type PorticoDatabase,
  type Selectable,
  sql,
  type TxContext,
  typed,
  type Updateable,
} from '@portico/db';
import {
  actorId,
  ConflictError,
  isUuid,
  NotFoundError,
  requirePermission,
  type TenantEnvironment,
} from '@portico/kernel';
import type { MigrationPlan } from '../domain/mapping';
import { initialSteps, type JobState, type Purpose, type StepKey, type StepStatus } from '../domain/pipeline';
import type { MigrationPorts } from '../ports';
import type { JobsTable, MigrationDB } from '../tables';

export interface MigrationDeps {
  ports: MigrationPorts;
}

export const db = (tx: Pick<TxContext, 'db'>) => typed<MigrationDB>(tx.db);

export function actorKey(tx: Pick<TxContext, 'actor'>): string {
  return `${tx.actor.kind}:${actorId(tx.actor)}`;
}

export function actorName(tx: Pick<TxContext, 'actor'>): string | null {
  return tx.actor.kind === 'user' || tx.actor.kind === 'api_client' ? (tx.actor.displayName ?? null) : null;
}

export interface StepDetail {
  detail: string | null;
  owner: string | null;
  at: string | null;
}

export interface Job {
  id: string;
  propertyId: string;
  purpose: Purpose;
  environment: TenantEnvironment;
  sourceAdapter: string;
  sourceSystem: string;
  sourceRef: string | null;
  sourceIdentity: string;
  state: JobState;
  steps: Record<StepKey, StepStatus>;
  stepDetail: Partial<Record<StepKey, StepDetail>>;
  plan: MigrationPlan;
  planFingerprint: string | null;
  domains: string[];
  rehearsalLink: { trialOrganizationId: string; trialPropertyId: string } | null;
  liveJobRef: { organizationId: string; jobId: string } | null;
  certificate: Record<string, unknown> | null;
  transitionId: string | null;
  rollbackTransitionId: string | null;
  /** Domains this migration restricted (made read-only in Portico) and their previous write mode (R-P2-1). */
  restricted: Array<{ domain: string; writeMode: 'exclusive' | 'forward' | 'read_only' }>;
  restoreTransitionId: string | null;
  cutoverPlannedAt: Date | null;
  frozenAt: Date | null;
  switchedAt: Date | null;
  openedAt: Date | null;
  freezeMinutes: number | null;
  rollbackWindowEndsAt: Date | null;
  rolledBackAt: Date | null;
  runningUntil: Date | null;
  ownerUserId: string | null;
  createdBy: string;
  createdAt: Date;
  version: number;
}

export function toJob(r: Selectable<JobsTable>): Job {
  return {
    id: r.id,
    propertyId: r.property_id,
    purpose: r.purpose,
    environment: r.environment as TenantEnvironment,
    sourceAdapter: r.source_adapter,
    sourceSystem: r.source_system,
    sourceRef: r.source_ref,
    sourceIdentity: r.source_identity,
    state: r.state as JobState,
    steps: { ...initialSteps(), ...(r.steps as Record<StepKey, StepStatus>) },
    stepDetail: (r.step_detail ?? {}) as Job['stepDetail'],
    plan: r.plan as MigrationPlan,
    planFingerprint: r.plan_fingerprint,
    domains: r.domains,
    rehearsalLink: (r.rehearsal_link ?? null) as Job['rehearsalLink'],
    liveJobRef: (r.live_job_ref ?? null) as Job['liveJobRef'],
    certificate: (r.certificate ?? null) as Job['certificate'],
    transitionId: r.transition_id,
    rollbackTransitionId: r.rollback_transition_id,
    restricted: (r.restricted ?? []) as Job['restricted'],
    restoreTransitionId: r.restore_transition_id ?? null,
    cutoverPlannedAt: r.cutover_planned_at,
    frozenAt: r.frozen_at,
    switchedAt: r.switched_at,
    openedAt: r.opened_at,
    freezeMinutes: r.freeze_minutes === null ? null : Number(r.freeze_minutes),
    rollbackWindowEndsAt: r.rollback_window_ends_at,
    rolledBackAt: r.rolled_back_at,
    runningUntil: r.running_until,
    ownerUserId: r.owner_user_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
    version: r.version,
  };
}

/** Load a job (RLS: only this organization's). `lock` serializes concurrent commands on the job. */
export async function loadJob(tx: TxContext, id: string, opts: { lock?: boolean } = {}): Promise<Job> {
  if (!isUuid(id)) throw new NotFoundError('migration_job', id);
  let q = db(tx).selectFrom('migration.jobs').selectAll().where('id', '=', id);
  if (opts.lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw new NotFoundError('migration_job', id);
  return toJob(row);
}

/** Load and check the caller's permission at the job's property (deny by default; 404 hides other properties). */
export async function loadJobFor(
  tx: TxContext,
  id: string,
  permission: string,
  opts: { lock?: boolean } = {},
): Promise<Job> {
  const job = await loadJob(tx, id, opts);
  if (!tx.authz.can('migration.job.read', { propertyId: job.propertyId }))
    throw new NotFoundError('migration_job', id);
  requirePermission(tx, permission, { propertyId: job.propertyId });
  return job;
}

/** Persist step statuses / details / fields with an optimistic version bump. */
export async function saveJob(
  tx: TxContext,
  job: Job,
  patch: Partial<{
    state: JobState;
    steps: Record<StepKey, StepStatus>;
    stepDetail: Job['stepDetail'];
    plan: MigrationPlan;
    planFingerprint: string | null;
    certificate: Record<string, unknown> | null;
    transitionId: string | null;
    rollbackTransitionId: string | null;
    restricted: Job['restricted'];
    restoreTransitionId: string | null;
    cutoverPlannedAt: Date | null;
    frozenAt: Date | null;
    switchedAt: Date | null;
    openedAt: Date | null;
    freezeMinutes: number | null;
    rollbackWindowEndsAt: Date | null;
    rolledBackAt: Date | null;
    rehearsalLink: Job['rehearsalLink'];
    ownerUserId: string | null;
  }>,
): Promise<Job> {
  const set: Updateable<JobsTable> = { updated_at: tx.now };
  if (patch.state !== undefined) set.state = patch.state;
  if (patch.steps !== undefined) set.steps = JSON.stringify(patch.steps);
  if (patch.stepDetail !== undefined) set.step_detail = JSON.stringify(patch.stepDetail);
  if (patch.plan !== undefined) set.plan = JSON.stringify(patch.plan);
  if (patch.planFingerprint !== undefined) set.plan_fingerprint = patch.planFingerprint;
  if (patch.certificate !== undefined)
    set.certificate = patch.certificate === null ? null : JSON.stringify(patch.certificate);
  if (patch.transitionId !== undefined) set.transition_id = patch.transitionId;
  if (patch.rollbackTransitionId !== undefined) set.rollback_transition_id = patch.rollbackTransitionId;
  if (patch.restricted !== undefined) set.restricted = JSON.stringify(patch.restricted);
  if (patch.restoreTransitionId !== undefined) set.restore_transition_id = patch.restoreTransitionId;
  if (patch.cutoverPlannedAt !== undefined) set.cutover_planned_at = patch.cutoverPlannedAt;
  if (patch.frozenAt !== undefined) set.frozen_at = patch.frozenAt;
  if (patch.switchedAt !== undefined) set.switched_at = patch.switchedAt;
  if (patch.openedAt !== undefined) set.opened_at = patch.openedAt;
  if (patch.freezeMinutes !== undefined) set.freeze_minutes = patch.freezeMinutes;
  if (patch.rollbackWindowEndsAt !== undefined) set.rollback_window_ends_at = patch.rollbackWindowEndsAt;
  if (patch.rolledBackAt !== undefined) set.rolled_back_at = patch.rolledBackAt;
  if (patch.rehearsalLink !== undefined)
    set.rehearsal_link = patch.rehearsalLink === null ? null : JSON.stringify(patch.rehearsalLink);
  if (patch.ownerUserId !== undefined) set.owner_user_id = patch.ownerUserId;
  const row = await db(tx)
    .updateTable('migration.jobs')
    .set({ ...set, version: sql<number>`version + 1` })
    .where('id', '=', job.id)
    .where('version', '=', job.version)
    .returningAll()
    .executeTakeFirst();
  if (!row)
    throw new ConflictError(
      'migration_job_changed',
      'Someone else changed this migration at the same time. Reload it and try again.',
      { jobId: job.id },
    );
  return toJob(row);
}

/** Every write path re-checks the job is still open. */
export function assertOpen(job: Job): void {
  if (['completed', 'rolled_back', 'cancelled'].includes(job.state))
    throw new ConflictError(
      'migration_closed',
      `This migration is ${job.state.replace('_', ' ')} and does not change any more. To migrate this property again, start a new migration from the same source (the import ledger prevents duplicates); a different source is refused while this one's records are in Portico.`,
      { state: job.state },
    );
}

export type { PorticoDatabase };
