/**
 * The Day Close engine (DCL-R02/R03/R04/R06): claims the run's execution lease, walks the ordered steps from the
 * first incomplete one, records every outcome, and releases the lease. It never logs anyone out and takes no global
 * lock: other commands keep running; only Day Close's own executors serialize on the run row.
 *
 * Crash model: a process can die anywhere. Item effects and item progress commit together, completed steps are
 * final (DB trigger), the advance and its step completion commit together, and a dead executor's lease expires so
 * a resume (by a person or the worker) takes over and starts at the first incomplete step — never redoing.
 */
import { type PorticoDatabase, type TxContext, type Updateable, withTenantTx } from '@portico/db';
import {
  assertExternalEffectAllowed,
  BusinessRuleError,
  ConflictError,
  effectMode,
  ForbiddenError,
  newId,
  type RequestContext,
} from '@portico/kernel';
import type { RunStatus, StepKey } from '../contracts';
import { type FailureRecord, toFailure } from '../domain/errors';
import { nextRetryAt } from '../domain/schedule';
import { firstIncompleteStep, isActive } from '../domain/steps';
import { DAY_CLOSE_EVENTS } from '../events';
import { DAY_CLOSE_PERMISSIONS as P } from '../manifest';
import type { RunsTable } from '../tables';
import { actorKey, actorName, type Deps, db, type EngineHooks, json } from './context';
import { resolvePolicy } from './policy';
import { emitRunEvent, heartbeat, loadSteps, lockRun, type RunRow, setStep, upsertIssue } from './repo';
import { STEP_FUNCTIONS } from './steps';
import { isFatal, type StepContext, type StepOutcome } from './steps/shared';

export interface ExecuteOptions {
  hooks?: EngineHooks;
}

export type ExecuteResult =
  | { executed: true; status: RunStatus }
  | { executed: false; status: RunStatus; reason: 'not_active' | 'in_progress'; leaseUntil: Date | null };

const STATUS_FOR_STEP = (key: StepKey): RunStatus => (key === 'preflight' ? 'preflight' : 'running');

/** Notification request to the duty roles (comms delivers; simulated in non-live organizations). */
async function notify(
  tx: TxContext,
  run: RunRow,
  type: (typeof DAY_CLOSE_EVENTS)[keyof typeof DAY_CLOSE_EVENTS],
  payload: Record<string, unknown>,
  roles: readonly string[] = ['night_audit', 'front_office_manager'],
) {
  const mode = assertExternalEffectAllowed(tx, 'message.staff');
  await emitRunEvent(tx, run, type, { ...payload, notification: { roles, mode } });
}

async function claim(
  deps: Deps,
  tx: TxContext,
  runId: string,
  owner: string,
): Promise<
  | { run: RunRow; ok: true; previousBlockers: string[] }
  | { run: RunRow; ok: false; reason: 'not_active' | 'in_progress' }
> {
  const run = await lockRun(tx, runId);
  // The executor acts on the user's intent: starting or resuming Day Close at this property (system processes pass).
  if (
    !tx.authz.can(P.runStart, { propertyId: run.property_id }) &&
    !tx.authz.can(P.runResume, { propertyId: run.property_id })
  ) {
    throw new ForbiddenError(P.runResume, { propertyId: run.property_id });
  }
  if (!isActive(run.status as RunStatus)) return { run, ok: false, reason: 'not_active' };
  if (run.lease_owner && run.lease_until && (run.lease_until as Date).getTime() > tx.now.getTime()) {
    return { run, ok: false, reason: 'in_progress' };
  }
  const steps = await loadSteps(tx, runId);
  const next = firstIncompleteStep(steps.map((s) => ({ key: s.key as StepKey, status: s.status as never })));
  const executions = Array.isArray(run.executions) ? (run.executions as unknown[]) : [];
  const crashed =
    run.lease_owner !== null && run.status !== 'blocked' && run.status !== 'failed'
      ? { previousOwner: run.lease_owner, lastHeartbeatAt: run.heartbeat_at }
      : null;
  const updated = await db(tx)
    .updateTable('day_close.runs')
    .set({
      lease_owner: owner,
      lease_until: new Date(tx.now.getTime() + deps.config.leaseMs),
      heartbeat_at: tx.now,
      status: next ? STATUS_FOR_STEP(next) : run.status,
      current_step: next,
      failure: null,
      next_retry_at: null,
      executions: json([
        ...executions.slice(-19),
        {
          owner,
          actor: actorKey(tx),
          actorName: actorName(tx),
          startedAt: tx.now.toISOString(),
          codeVersion: deps.config.codeVersion,
          fromStep: next,
          ...(crashed ? { tookOverFrom: crashed } : {}),
        },
      ]),
      version: run.version + 1,
    })
    .where('id', '=', runId)
    .returningAll()
    .executeTakeFirstOrThrow();
  if (crashed) {
    await tx.audit({
      action: 'dayClose.run.recovered',
      target: { type: 'day_close_run', id: runId },
      propertyId: run.property_id,
      before: crashed,
      after: { owner, resumedAt: next },
    });
  }
  const previousBlockers = ((run.failure as { blockers?: string[] } | null)?.blockers ?? []).slice().sort();
  return { run: updated, ok: true, previousBlockers };
}

async function release(
  tx: TxContext,
  runId: string,
  owner: string,
  patch: Updateable<RunsTable>,
): Promise<RunRow | undefined> {
  return db(tx)
    .updateTable('day_close.runs')
    .set((eb) => ({ ...patch, lease_owner: null, lease_until: null, version: eb('version', '+', 1) }))
    .where('id', '=', runId)
    .where('lease_owner', '=', owner)
    .returningAll()
    .executeTakeFirst();
}

/**
 * Execute (or resume) a run with the caller's context. Returns `executed: false` when the run is not active or
 * another executor holds a live lease (two auditors pressing Resume: one works, the other sees who and until when).
 */
export async function executeRun(
  deps: Deps,
  database: PorticoDatabase,
  ctx: RequestContext,
  runId: string,
  opts: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const owner = `${actorKey(ctx)}#${newId()}`;
  const hooks = opts.hooks ?? {};
  const claimed = await withTenantTx(database, ctx, (tx) => claim(deps, tx, runId, owner));
  if (!claimed.ok) {
    return {
      executed: false,
      status: claimed.run.status as RunStatus,
      reason: claimed.reason,
      leaseUntil: (claimed.run.lease_until as Date | null) ?? null,
    };
  }
  let run = claimed.run;
  const inTx = <T>(fn: (tx: TxContext) => Promise<T>) =>
    withTenantTx(database, ctx, async (tx) => {
      await heartbeat(tx, runId, owner, deps.config.leaseMs);
      return fn(tx);
    });
  const { property, policy } = await inTx(async (tx) => ({
    property: await deps.ports.platform.getProperty(tx, run.property_id),
    policy: (await resolvePolicy(deps, tx, run.property_id)).policy,
  }));
  if (run.started_at && run.executions && (run.executions as unknown[]).length === 1) {
    await inTx((tx) => notify(tx, run, DAY_CLOSE_EVENTS.runStarted, { trigger: run.trigger }));
  }

  for (;;) {
    const steps = await inTx((tx) => loadSteps(tx, runId));
    const next = firstIncompleteStep(
      steps.map((s) => ({ key: s.key as StepKey, status: s.status as never })),
    );
    if (!next) break;
    await hooks.beforeStep?.(next);
    run = await inTx(async (tx) => {
      const r = await heartbeat(tx, runId, owner, deps.config.leaseMs, {
        status: STATUS_FOR_STEP(next),
        currentStep: next,
      });
      await setStep(tx, runId, next, { status: 'running', started: true, attempt: true, error: null });
      return r;
    });
    const sctx: StepContext = { deps, database, ctx, run, property, policy, owner, hooks, inTx };
    let outcome: StepOutcome;
    try {
      outcome = await STEP_FUNCTIONS[next](sctx);
    } catch (err) {
      if (isFatal(err)) throw err;
      outcome = { status: 'failed', error: toFailure(err) };
    }
    if (outcome.status === 'blocked') {
      await inTx(async (tx) => {
        await setStep(tx, runId, next, { status: 'pending', detail: outcome.detail ?? {} });
        const r = await release(tx, runId, owner, {
          status: 'blocked',
          failure: json({
            step: next,
            code: 'blocked',
            message: `${outcome.blockers.length} item(s) must be settled (or overridden with a reason) before Day Close can continue.`,
            retryable: true,
            blockers: outcome.blockers.map((b) => b.key),
          }),
        });
        // Audit and tell the duty roles when the list of blockers changes — not on every automatic re-check
        // (review P3-1: a blocked auto-close re-checks every minute).
        const keys = outcome.blockers.map((b) => b.key).sort();
        const changed = keys.join('|') !== claimed.previousBlockers.join('|');
        if (changed)
          await tx.audit({
            action: 'dayClose.run.blocked',
            target: { type: 'day_close_run', id: runId },
            propertyId: run.property_id,
            after: { blockers: outcome.blockers.map((b) => ({ key: b.key, code: b.code })) },
          });
        if (r && changed)
          await notify(tx, r, DAY_CLOSE_EVENTS.runBlocked, { blocking: outcome.blockers.length });
      });
      return { executed: true, status: 'blocked' };
    }
    if (outcome.status === 'failed') {
      await recordFailure(deps, database, ctx, run, owner, next, outcome);
      return { executed: true, status: 'failed' };
    }
    await inTx(async (tx) => {
      if (!(outcome.status === 'completed' && outcome.persisted)) {
        await setStep(tx, runId, next, {
          status: outcome.status,
          finished: true,
          ...(outcome.status === 'completed' && outcome.total !== undefined ? { total: outcome.total } : {}),
          detail: outcome.detail ?? {},
        });
      }
      await emitRunEvent(tx, run, DAY_CLOSE_EVENTS.stepCompleted, { step: next, status: outcome.status });
    });
    await hooks.afterStep?.(next);
  }

  await inTx(async (tx) => {
    const r = await release(tx, runId, owner, {
      status: 'completed',
      finished_at: tx.now,
      current_step: null,
    });
    if (!r) return;
    await tx.audit({
      action: 'dayClose.run.complete',
      target: { type: 'day_close_run', id: runId },
      propertyId: r.property_id,
      after: { status: 'completed', businessDate: r.business_date },
    });
    await notify(tx, r, DAY_CLOSE_EVENTS.runCompleted, {});
  });
  return { executed: true, status: 'completed' };
}

async function recordFailure(
  deps: Deps,
  database: PorticoDatabase,
  ctx: RequestContext,
  run: RunRow,
  owner: string,
  step: StepKey,
  outcome: {
    status: 'failed';
    error: FailureRecord;
    total?: number | null;
    detail?: Record<string, unknown>;
  },
) {
  await withTenantTx(database, ctx, async (tx) => {
    // Fenced like every other executor write (review P3-2): a stale executor that lost its lease records nothing.
    await heartbeat(tx, run.id, owner, deps.config.leaseMs);
    const failure = outcome.error;
    await setStep(tx, run.id, step, {
      status: 'failed',
      error: failure,
      ...(outcome.total !== undefined ? { total: outcome.total } : {}),
      ...(outcome.detail ? { detail: outcome.detail } : {}),
    });
    const retryAt = run.trigger === 'manual' ? null : nextRetryAt(tx.now, run.retry_count, failure);
    const r = await release(tx, run.id, owner, {
      status: 'failed',
      failure: json({ step, ...failure }),
      next_retry_at: retryAt,
      ...(retryAt ? { retry_count: run.retry_count + 1 } : {}),
    });
    if (failure.integrity) {
      await upsertIssue(tx, {
        propertyId: run.property_id,
        businessDate: run.business_date,
        runId: run.id,
        code: 'integrity_failed',
        severity: 'blocking',
        dedupeKey: `integrity_failed:${run.property_id}:${run.business_date}`,
        ref: { type: 'day_close_run', id: run.id },
        message: failure.message,
        owner: { kind: 'department', id: 'finance' },
        details: (failure.details as Record<string, unknown>) ?? {},
      });
    }
    await tx.audit({
      action: 'dayClose.run.fail',
      target: { type: 'day_close_run', id: run.id },
      propertyId: run.property_id,
      after: { step, code: failure.code, retryable: failure.retryable, nextRetryAt: retryAt },
    });
    // An integrity failure is owned by finance: finance is told too (review P3-6; it still needs CR-13 to open the
    // Day Close issue).
    if (r)
      await notify(
        tx,
        r,
        DAY_CLOSE_EVENTS.runFailed,
        { step, code: failure.code },
        failure.integrity ? ['night_audit', 'front_office_manager', 'finance'] : undefined,
      );
  });
}

/** Refuse a second concurrent executor with who holds the run and until when. */
export function inProgressError(leaseUntil: Date | null): ConflictError {
  return new ConflictError(
    'run_in_progress',
    `Day Close is already working on this run${leaseUntil ? ` (it reports in until ${leaseUntil.toISOString()})` : ''}. Watch its progress; if that process died, Resume becomes available when its lease expires.`,
    { leaseUntil: leaseUntil?.toISOString() ?? null },
  );
}

export function notActiveError(status: string): BusinessRuleError {
  return new BusinessRuleError('run_not_active', `This Day Close run is ${status} and cannot be resumed.`, {
    status,
  });
}

export function notificationMode(ctx: RequestContext) {
  return effectMode(ctx, 'message.staff');
}
