/**
 * Run commands: start (or return the active run — DCL-R06), resume, cancel (nothing posted), override an item
 * (permission + reason), resolve a follow-up; and the reads (run view, list).
 */
import { type PorticoDatabase, type TxContext, withTenantTx } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  EntitlementError,
  type LocalDate,
  NotFoundError,
  newId,
  type RequestContext,
  requirePermission,
  ValidationError,
  VersionConflictError,
} from '@portico/kernel';
import type { RunStatus, RunView, StepKey, StepStatus } from '../contracts';
import { isIntegrityCode } from '../domain/policy';
import { earliestStart } from '../domain/schedule';
import { cancellable, isActive } from '../domain/steps';
import { DAY_CLOSE_EVENTS } from '../events';
import { DAY_CLOSE_PERMISSIONS as P } from '../manifest';
import { actorKey, actorName, type Deps, db, type EngineHooks, json } from './context';
import { executeRun, inProgressError, notActiveError } from './engine';
import { resolvePolicy } from './policy';
import { collectReadiness } from './readiness';
import { createSteps, emitRunEvent, loadRun, loadSteps, lockRun, type RunRow } from './repo';
import { buildRunView } from './views';

export interface StartInput {
  propertyId: string;
  businessDate?: LocalDate;
  trigger?: 'manual' | 'schedule' | 'api';
}

/** Create the run for the property's current business date, or return the active one (inside the caller's tx). */
export async function createRun(
  deps: Deps,
  tx: TxContext,
  input: StartInput,
): Promise<{ run: RunRow; alreadyActive: boolean }> {
  const { propertyId } = input;
  requirePermission(tx, P.runStart, { propertyId });
  const { ports } = deps;
  if (!(await ports.platform.hasEntitlement(tx, 'core.dayClose', propertyId))) {
    throw new EntitlementError('core.dayClose');
  }
  const property = await ports.platform.getProperty(tx, propertyId);
  const D = property.businessDate;
  if (input.businessDate && input.businessDate !== D) {
    throw new ConflictError(
      'not_current_business_date',
      `The business date of this property is ${D}, not ${input.businessDate}. Day Close runs for the current business date only; refresh and try again.`,
      { businessDate: D },
    );
  }
  const active = await db(tx)
    .selectFrom('day_close.runs')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('status', 'in', ['preflight', 'blocked', 'running', 'failed'])
    .executeTakeFirst();
  if (active) {
    if (active.business_date !== D) {
      throw new BusinessRuleError(
        'previous_run_incomplete',
        `Day Close of ${active.business_date} has not finished yet (it is ${active.status}). Resume it first; the next day cannot close before it.`,
        { runId: active.id, businessDate: active.business_date },
      );
    }
    return { run: active, alreadyActive: true };
  }
  for (const domain of ['reservations', 'charges'] as const) {
    const a = await ports.platform.getDataAuthority(tx, propertyId, domain);
    if (a.authority === 'external') {
      throw new BusinessRuleError(
        'external_system_of_record',
        `${a.systemName ?? 'Another system'} is the system of record for ${domain} at this property, so its own night audit closes the day; Portico's business date mirrors it. Day Close does not run here.`,
        { domain },
      );
    }
  }
  const policy = (await resolvePolicy(deps, tx, propertyId)).policy;
  const earliest = earliestStart(D, policy.earliestStartLocalTime, property.timezone);
  if (earliest && tx.now.getTime() < earliest.getTime()) {
    throw new BusinessRuleError(
      'too_early_to_close',
      `Day Close for ${D} can start from ${policy.earliestStartLocalTime} property time (${earliest.toISOString()}). Try again then.`,
      { earliestStartAt: earliest.toISOString() },
    );
  }
  const trigger = input.trigger ?? 'manual';
  const id = newId();
  const inserted = await db(tx)
    .insertInto('day_close.runs')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: propertyId,
      business_date: D,
      status: 'preflight',
      trigger,
      started_by: actorKey(tx),
      started_by_name: actorName(tx),
      started_at: tx.now,
      current_step: 'preflight',
      auto_continue: trigger === 'schedule' ? policy.schedule.autoContinue : false,
      executions: json([]),
    })
    .onConflict((oc) => oc.doNothing())
    .returningAll()
    .executeTakeFirst();
  if (!inserted) {
    // Another start won the race (two auditors at once): return the run it created.
    const winner = await db(tx)
      .selectFrom('day_close.runs')
      .selectAll()
      .where('property_id', '=', propertyId)
      .where('status', 'in', ['preflight', 'blocked', 'running', 'failed'])
      .executeTakeFirst();
    if (!winner || winner.business_date !== D) {
      throw new ConflictError(
        'run_start_conflict',
        'Another Day Close started at the same moment for a different date. Refresh and check Day Close status.',
      );
    }
    return { run: winner, alreadyActive: true };
  }
  await createSteps(tx, id);
  await tx.audit({
    action: 'dayClose.run.start',
    target: { type: 'day_close_run', id },
    propertyId,
    after: { businessDate: D, trigger },
  });
  return { run: inserted, alreadyActive: false };
}

export async function startRun(
  deps: Deps,
  database: PorticoDatabase,
  ctx: RequestContext,
  input: StartInput & { execute?: boolean; hooks?: EngineHooks },
): Promise<RunView> {
  const { run, alreadyActive } = await withTenantTx(database, ctx, (tx) => createRun(deps, tx, input));
  if (input.execute !== false && !alreadyActive) {
    await executeRun(deps, database, ctx, run.id, input.hooks ? { hooks: input.hooks } : {});
  }
  return withTenantTx(database, ctx, async (tx) => ({
    ...(await buildRunView(deps, tx, await loadRun(tx, run.id))),
    ...(alreadyActive ? { alreadyActive: true } : {}),
  }));
}

/** Resume a blocked, failed or interrupted run (If-Match on the run version). */
export async function resumeRun(
  deps: Deps,
  database: PorticoDatabase,
  ctx: RequestContext,
  runId: string,
  expectedVersion: number,
  opts: { hooks?: EngineHooks } = {},
): Promise<RunView> {
  await withTenantTx(database, ctx, async (tx) => {
    const run = await loadRun(tx, runId);
    requirePermission(tx, P.runResume, { propertyId: run.property_id });
    if (run.version !== expectedVersion)
      throw new VersionConflictError('day_close_run', runId, expectedVersion, run.version);
    if (!isActive(run.status as RunStatus)) throw notActiveError(run.status);
    if (run.lease_owner && run.lease_until && (run.lease_until as Date).getTime() > tx.now.getTime())
      throw inProgressError(run.lease_until as Date);
    await tx.audit({
      action: 'dayClose.run.resume',
      target: { type: 'day_close_run', id: runId },
      propertyId: run.property_id,
      before: { status: run.status, step: run.current_step },
    });
  });
  const r = await executeRun(deps, database, ctx, runId, opts.hooks ? { hooks: opts.hooks } : {});
  if (!r.executed && r.reason === 'in_progress') throw inProgressError(r.leaseUntil);
  return withTenantTx(database, ctx, async (tx) => buildRunView(deps, tx, await loadRun(tx, runId)));
}

export async function cancelRun(
  deps: Deps,
  tx: TxContext,
  runId: string,
  expectedVersion: number,
  reason: string,
): Promise<RunView> {
  const run0 = await loadRun(tx, runId);
  requirePermission(tx, P.runCancel, { propertyId: run0.property_id });
  const run = await lockRun(tx, runId);
  if (run.version !== expectedVersion)
    throw new VersionConflictError('day_close_run', runId, expectedVersion, run.version);
  const steps = await loadSteps(tx, runId);
  const done = await db(tx)
    .selectFrom('day_close.step_items')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('run_id', '=', runId)
    .where('status', '=', 'done')
    .executeTakeFirstOrThrow();
  const c = cancellable(
    run.status as RunStatus,
    steps.map((s) => ({ key: s.key as StepKey, status: s.status as StepStatus })),
    Number(done.n),
  );
  if (!c.ok) throw new BusinessRuleError('run_not_cancellable', c.reason);
  if (run.lease_owner && run.lease_until && (run.lease_until as Date).getTime() > tx.now.getTime())
    throw inProgressError(run.lease_until as Date);
  const updated = await db(tx)
    .updateTable('day_close.runs')
    .set({
      status: 'cancelled',
      cancel_reason: reason,
      finished_at: tx.now,
      current_step: null,
      lease_owner: null,
      lease_until: null,
      version: run.version + 1,
    })
    .where('id', '=', runId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'dayClose.run.cancel',
    target: { type: 'day_close_run', id: runId },
    propertyId: run.property_id,
    reason,
    before: { status: run.status },
    after: { status: 'cancelled' },
  });
  await emitRunEvent(tx, updated, DAY_CLOSE_EVENTS.runCancelled, { reason });
  return buildRunView(deps, tx, updated);
}

/**
 * Override one blocking item (readiness key) or one failed step item (`item:{step}:{key}`) for this run, with a
 * reason (EC-DCL-009). Integrity items can never be overridden. Takes effect on the next resume.
 */
export async function overrideItem(
  deps: Deps,
  tx: TxContext,
  runId: string,
  input: { itemKey: string; reason: string },
): Promise<RunView> {
  const run0 = await loadRun(tx, runId);
  requirePermission(tx, P.exceptionOverride, { propertyId: run0.property_id });
  const run = await lockRun(tx, runId);
  if (!isActive(run.status as RunStatus)) throw notActiveError(run.status);
  const reason = input.reason.trim();
  if (reason.length < 3)
    throw new ValidationError('override_reason_required', 'Give a reason for the override.');
  let code: string;
  let ref: unknown = null;
  if (input.itemKey.startsWith('item:')) {
    const [, step, ...rest] = input.itemKey.split(':');
    const itemKey = rest.join(':');
    const item = await db(tx)
      .selectFrom('day_close.step_items')
      .selectAll()
      .where('run_id', '=', runId)
      .where('step_key', '=', step as string)
      .where('item_key', '=', itemKey)
      .executeTakeFirst();
    if (item?.status !== 'failed') {
      throw new BusinessRuleError(
        'nothing_to_override',
        'This item has not failed in this run (it may have succeeded meanwhile). Refresh the run page.',
      );
    }
    code = (item.error as { code?: string } | null)?.code ?? 'step_item_failed';
    ref = item.ref_type ? { type: item.ref_type, id: item.ref_id } : null;
  } else {
    const r = await collectReadiness(deps, tx, run.property_id, { runId, businessDate: run.business_date });
    const all = [...r.blocking, ...r.warnings, ...r.info];
    const item = all.find((i) => i.key === input.itemKey);
    const keepExpected = item?.code === 'arrival_not_checked_in';
    if (item && isIntegrityCode(item.code)) {
      throw new BusinessRuleError(
        'integrity_not_overridable',
        'Ledger integrity checks cannot be overridden: the business date advances only when the books balance. Finance must correct the cause.',
      );
    }
    if (!item || (!item.overridable && !keepExpected)) {
      throw new BusinessRuleError(
        'nothing_to_override',
        'This item is not a blocking item of this Day Close any more (it may have been resolved). Refresh the list.',
      );
    }
    code = item.code;
    ref = item.ref;
  }
  const exists = await db(tx)
    .selectFrom('day_close.overrides')
    .select('id')
    .where('run_id', '=', runId)
    .where('item_key', '=', input.itemKey)
    .executeTakeFirst();
  if (exists) throw new ConflictError('already_overridden', 'This item is already overridden for this run.');
  const id = newId();
  await db(tx)
    .insertInto('day_close.overrides')
    .values({
      id,
      tenant_id: tx.tenantId,
      run_id: runId,
      property_id: run.property_id,
      item_key: input.itemKey,
      code,
      ref: ref ? json(ref) : null,
      reason,
      actor: actorKey(tx),
      actor_name: actorName(tx),
      created_at: tx.now,
    })
    .execute();
  const updated = await db(tx)
    .updateTable('day_close.runs')
    .set({ version: run.version + 1 })
    .where('id', '=', runId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'dayClose.exception.override',
    target: { type: 'day_close_run', id: runId },
    propertyId: run.property_id,
    reason,
    after: { itemKey: input.itemKey, code, ref },
  });
  return buildRunView(deps, tx, updated);
}

export async function resolveIssue(
  _deps: Deps,
  tx: TxContext,
  issueId: string,
  expectedVersion: number,
  resolution: string,
) {
  const issue = await db(tx)
    .selectFrom('day_close.issues')
    .selectAll()
    .where('id', '=', issueId)
    .executeTakeFirst();
  if (!issue) throw new NotFoundError('day_close_issue', issueId);
  requirePermission(tx, P.issueResolve, { propertyId: issue.property_id });
  if (isIntegrityCode(issue.code)) {
    throw new BusinessRuleError(
      'integrity_not_resolvable',
      'An integrity alarm clears itself when the integrity checks pass again; it cannot be marked as handled.',
    );
  }
  const row = await db(tx)
    .updateTable('day_close.issues')
    .set({
      status: 'resolved',
      resolved_at: tx.now,
      resolved_by: actorKey(tx),
      resolution,
      version: issue.version + 1,
    })
    .where('id', '=', issueId)
    .where('version', '=', expectedVersion)
    .where('status', '=', 'open')
    .returningAll()
    .executeTakeFirst();
  if (!row) {
    if (issue.status !== 'open')
      throw new BusinessRuleError('issue_not_open', 'This follow-up is already resolved.');
    throw new VersionConflictError('day_close_issue', issueId, expectedVersion, issue.version);
  }
  await tx.audit({
    action: 'dayClose.issue.resolve',
    target: { type: 'day_close_issue', id: issueId },
    propertyId: issue.property_id,
    reason: resolution,
    before: { status: 'open' },
    after: { status: 'resolved' },
  });
  return issueView(row);
}

export function issueView(i: {
  id: string;
  property_id: string;
  business_date: string;
  code: string;
  severity: string;
  message: string;
  ref_type: string | null;
  ref_id: string | null;
  owner: unknown;
  status: string;
  details: unknown;
  created_at: unknown;
  resolved_at: unknown;
  resolution: string | null;
  version: number;
}) {
  const owner = (i.owner as { kind: 'user' | 'department'; id: string; name?: string } | null) ?? {
    kind: 'department' as const,
    id: 'night_audit',
  };
  return {
    id: i.id,
    propertyId: i.property_id,
    businessDate: i.business_date,
    code: i.code,
    severity: i.severity as 'blocking' | 'warning' | 'info',
    message: i.message,
    ref: i.ref_type && i.ref_id ? { type: i.ref_type, id: i.ref_id } : null,
    owner,
    status: i.status as 'open' | 'resolved',
    details: (i.details as Record<string, unknown>) ?? {},
    createdAt: (i.created_at as Date).toISOString(),
    resolvedAt: i.resolved_at ? (i.resolved_at as Date).toISOString() : null,
    resolution: i.resolution,
    version: i.version,
  };
}

export async function listIssues(
  _deps: Deps,
  tx: TxContext,
  propertyId: string,
  status: 'open' | 'resolved',
) {
  requirePermission(tx, P.runRead, { propertyId });
  const rows = await db(tx)
    .selectFrom('day_close.issues')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('status', '=', status)
    .orderBy('created_at', 'desc')
    .limit(200)
    .execute();
  return rows.map(issueView);
}

export async function getRun(deps: Deps, tx: TxContext, runId: string): Promise<RunView> {
  const run = await loadRun(tx, runId);
  if (!tx.authz.can(P.runRead, { propertyId: run.property_id }))
    throw new NotFoundError('day_close_run', runId);
  return buildRunView(deps, tx, run);
}

export async function listRuns(
  _deps: Deps,
  tx: TxContext,
  propertyId: string,
  q: { from?: LocalDate; to?: LocalDate; limit: number },
) {
  requirePermission(tx, P.runRead, { propertyId });
  let query = db(tx)
    .selectFrom('day_close.runs')
    .selectAll()
    .where('property_id', '=', propertyId)
    .orderBy('business_date', 'desc')
    .orderBy('started_at', 'desc')
    .limit(q.limit);
  if (q.from) query = query.where('business_date', '>=', q.from);
  if (q.to) query = query.where('business_date', '<=', q.to);
  const rows = await query.execute();
  return rows.map((r) => ({
    id: r.id,
    propertyId: r.property_id,
    businessDate: r.business_date,
    runStatus: r.status as RunStatus,
    startedAt: (r.started_at as Date).toISOString(),
    finishedAt: r.finished_at ? (r.finished_at as Date).toISOString() : null,
    currentStep: (r.current_step as StepKey | null) ?? null,
    version: r.version,
  }));
}
