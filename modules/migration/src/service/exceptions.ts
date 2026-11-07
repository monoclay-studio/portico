/**
 * Exception list with owners (phase M5). Financial exceptions are decided only by finance; "accepted as loss" needs
 * the hotel decision-maker. A decision never deletes anything: an excluded record is accounted for as excluded.
 */
import type { TxContext } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  isUuid,
  NotFoundError,
  type RecordAction,
  requirePermission,
} from '@portico/kernel';
import { type DataClass, FINANCIAL_CLASSES } from '../domain/records';
import { P } from '../manifest';
import type { ExceptionStatus } from '../vocabulary';
import { actorKey, assertOpen, db, loadJob, saveJob } from './context';
import { IMPORT_AS_IS_ALLOWED, ledgerNamespace } from './state';

type Row = Awaited<ReturnType<typeof loadRow>>;

async function loadRow(tx: TxContext, id: string) {
  if (!isUuid(id)) throw new NotFoundError('migration_exception', id);
  const row = await db(tx)
    .selectFrom('migration.exceptions')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw new NotFoundError('migration_exception', id);
  if (!tx.authz.can(P.read, { propertyId: row.property_id }))
    throw new NotFoundError('migration_exception', id);
  return row;
}

function view(tx: TxContext, r: Row) {
  const financial = r.financial || FINANCIAL_CLASSES.has(r.data_class as DataClass);
  const decide = financial ? P.financeSignoff : P.exceptionManage;
  const open = r.status === 'open' || r.status === 'in_progress';
  const can = tx.authz.can(decide, { propertyId: r.property_id });
  const act = (action: string, label: string, ok: boolean, why: string): RecordAction =>
    ok ? { action, label, enabled: true } : { action, label, enabled: false, reason: why };
  const needPerm = `You need ${decide}${financial ? ' (financial exception)' : ''}.`;
  return {
    id: r.id,
    jobId: r.job_id,
    dataClass: r.data_class as DataClass,
    sourceKey: r.source_key || null,
    code: r.code,
    severity: r.severity,
    financial,
    problem: r.problem,
    impact: r.impact,
    proposedResolution: r.proposed_resolution,
    ownerRole: r.owner_role,
    ownerUserId: r.owner_user_id,
    dueAt: r.due_at?.toISOString() ?? null,
    state: r.status as ExceptionStatus,
    resolution: r.resolution,
    repeatCount: r.repeat_count,
    status: { exception: r.status, severity: r.severity },
    allowedActions: [
      act('resolve', 'Mark resolved', open && can, open ? needPerm : 'Already closed.'),
      act(
        'importAsIs',
        'Import as is',
        open && can && IMPORT_AS_IS_ALLOWED.has(r.code),
        !IMPORT_AS_IS_ALLOWED.has(r.code)
          ? 'This problem cannot be imported as is (it would import uncertain data).'
          : needPerm,
      ),
      act(
        'exclude',
        'Exclude by decision',
        open && can && r.source_key !== '',
        r.source_key === '' ? 'Not a single record.' : needPerm,
      ),
      act(
        'acceptAsLoss',
        'Accept as loss',
        open && tx.authz.can(P.productionAuthorize, { propertyId: r.property_id }),
        `Accepting a loss needs the hotel decision-maker (${P.productionAuthorize}).`,
      ),
    ],
    issues:
      open && r.due_at && r.due_at.getTime() < tx.now.getTime()
        ? [{ code: 'overdue', severity: 'warning' as const, message: `Due ${r.due_at.toISOString()}.` }]
        : [],
    links: [{ rel: 'migration', type: 'migration_job', id: r.job_id }],
    version: r.version,
  };
}

export type ExceptionView = ReturnType<typeof view>;

export async function listExceptions(
  tx: TxContext,
  jobId: string,
  q: {
    status: 'open' | 'closed' | 'all';
    severity?: 'blocking' | 'warning' | undefined;
    dataClass?: string | undefined;
    limit: number;
  },
): Promise<ExceptionView[]> {
  const job = await loadJob(tx, jobId);
  requirePermission(tx, P.read, { propertyId: job.propertyId });
  let query = db(tx).selectFrom('migration.exceptions').selectAll().where('job_id', '=', job.id);
  if (q.status === 'open') query = query.where('status', 'in', ['open', 'in_progress']);
  if (q.status === 'closed') query = query.where('status', 'not in', ['open', 'in_progress']);
  if (q.severity) query = query.where('severity', '=', q.severity);
  if (q.dataClass) query = query.where('data_class', '=', q.dataClass);
  const rows = await query.orderBy('severity').orderBy('first_seen_at').limit(q.limit).execute();
  return rows.map((r) => view(tx, r));
}

export async function getException(tx: TxContext, id: string): Promise<ExceptionView> {
  return view(tx, await loadRow(tx, id));
}

export async function resolveException(
  tx: TxContext,
  id: string,
  input: {
    outcome: 'resolved' | 'import_as_is' | 'excluded' | 'accepted_as_loss' | 'deferred';
    resolution: string;
  },
  expectedVersion?: number,
): Promise<ExceptionView> {
  const r = await loadRow(tx, id);
  if (expectedVersion !== undefined && expectedVersion !== r.version)
    throw new ConflictError('version_conflict', 'This exception was changed by someone else. Reload it.', {
      currentVersion: r.version,
    });
  const job = await loadJob(tx, r.job_id, { lock: true });
  assertOpen(job);
  const financial = r.financial || FINANCIAL_CLASSES.has(r.data_class as DataClass);
  requirePermission(tx, financial ? P.financeSignoff : P.exceptionManage, { propertyId: r.property_id });
  if (input.outcome === 'accepted_as_loss')
    requirePermission(tx, P.productionAuthorize, { propertyId: r.property_id });
  if (r.status !== 'open' && r.status !== 'in_progress')
    throw new ConflictError('exception_closed', `This exception is already ${r.status.replace(/_/g, ' ')}.`);
  if (input.outcome === 'import_as_is' && !IMPORT_AS_IS_ALLOWED.has(r.code))
    throw new BusinessRuleError(
      'cannot_import_as_is',
      'This problem would import uncertain data (amounts, dates, masked or duplicated records). Correct it in the source, or exclude the record by decision.',
    );
  if ((input.outcome === 'excluded' || input.outcome === 'accepted_as_loss') && r.source_key) {
    const l = await db(tx)
      .selectFrom('migration.import_ledger')
      .select('state')
      .where('property_id', '=', r.property_id)
      .where('source_system', '=', ledgerNamespace(job))
      .where('data_class', '=', r.data_class)
      .where('source_key', '=', r.source_key)
      .executeTakeFirst();
    if (l && (l.state === 'imported' || l.state === 'merged'))
      throw new BusinessRuleError(
        'already_imported',
        'This record is already in Portico. It is never deleted by a migration decision; correct it in its module (for money: through finance’s correction flow).',
      );
  }
  const status =
    input.outcome === 'import_as_is' || input.outcome === 'resolved'
      ? 'resolved'
      : input.outcome === 'excluded'
        ? 'excluded'
        : input.outcome;
  const outcome = input.outcome === 'resolved' ? null : input.outcome;
  const updated = await db(tx)
    .updateTable('migration.exceptions')
    .set((eb) => ({
      status,
      outcome,
      resolution: input.resolution,
      closed_by: actorKey(tx),
      closed_at: tx.now,
      version: eb('version', '+', 1),
    }))
    .where('id', '=', r.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  // A decision changes what is imported: the rehearsal must run (and reconcile) again.
  if (
    !job.frozenAt &&
    (outcome === 'import_as_is' || outcome === 'excluded' || outcome === 'accepted_as_loss')
  ) {
    const steps = { ...job.steps };
    for (const s of ['rehearse', 'reconcile', 'signoff'] as const) steps[s] = 'pending';
    await saveJob(tx, job, {
      steps,
      ...(job.purpose === 'rehearsal' && job.certificate ? { certificate: null } : {}),
    });
  }
  await tx.audit({
    action: 'migration.exception.resolve',
    target: { type: 'migration_exception', id: r.id },
    propertyId: r.property_id,
    reason: input.resolution,
    before: { status: r.status },
    after: { status, outcome },
  });
  await tx.emit({
    type: 'migration.exception.resolved',
    propertyId: r.property_id,
    aggregate: { type: 'migration_exception', id: r.id },
    aggregateVersion: updated.version,
    payload: { exceptionId: r.id, jobId: r.job_id, status, outcome },
  });
  return view(tx, updated);
}

export async function assignException(
  tx: TxContext,
  id: string,
  ownerUserId: string,
): Promise<ExceptionView> {
  const r = await loadRow(tx, id);
  const financial = r.financial || FINANCIAL_CLASSES.has(r.data_class as DataClass);
  requirePermission(tx, financial ? P.financeSignoff : P.exceptionManage, { propertyId: r.property_id });
  const updated = await db(tx)
    .updateTable('migration.exceptions')
    .set((eb) => ({
      owner_user_id: ownerUserId,
      status: r.status === 'open' ? 'in_progress' : r.status,
      version: eb('version', '+', 1),
    }))
    .where('id', '=', r.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'migration.exception.assign',
    target: { type: 'migration_exception', id: r.id },
    propertyId: r.property_id,
    after: { ownerUserId },
  });
  return view(tx, updated);
}

/** Decisions of a job (copied into its rehearsal so the trial imports exactly what the cutover will import). */
export async function decisionsOf(tx: TxContext, jobId: string) {
  return db(tx)
    .selectFrom('migration.exceptions')
    .select(['data_class', 'source_key', 'code', 'outcome', 'status', 'resolution'])
    .where('job_id', '=', jobId)
    .where('outcome', 'in', ['import_as_is', 'excluded', 'accepted_as_loss', 'deferred'])
    .execute();
}
