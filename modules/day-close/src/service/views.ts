/**
 * Universal record view of a Day Close run (status per family, server-computed allowed actions with reasons,
 * issues, owner, links, provenance) and the per-step progress the run page shows ("88 of 112 posted").
 */
import type { TxContext } from '@portico/db';
import { effectMode } from '@portico/kernel';
import type { ReadinessItem, RunStatus, RunView, StepKey, StepStatus, StepView } from '../contracts';
import { cancellable, isActive, progressLine, remaining, STEP_LABELS } from '../domain/steps';
import { DAY_CLOSE_PERMISSIONS as P } from '../manifest';
import { type Deps, db } from './context';
import { collectReadiness } from './readiness';
import { loadSteps, type RunRow } from './repo';
import { itemOverrideKey } from './steps/shared';

interface FailureJson {
  step: string;
  code: string;
  message: string;
  retryable: boolean;
  integrity?: boolean;
}

export async function buildRunView(deps: Deps, tx: TxContext, run: RunRow): Promise<RunView> {
  const steps = await loadSteps(tx, run.id);
  const failedItems = await db(tx)
    .selectFrom('day_close.step_items')
    .selectAll()
    .where('run_id', '=', run.id)
    .where('status', '=', 'failed')
    .execute();
  const overrides = await db(tx)
    .selectFrom('day_close.overrides')
    .selectAll()
    .where('run_id', '=', run.id)
    .orderBy('created_at')
    .execute();
  const overriddenKeys = new Set(overrides.map((o) => o.item_key));
  const doneItems = await db(tx)
    .selectFrom('day_close.step_items')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('run_id', '=', run.id)
    .where('status', '=', 'done')
    .executeTakeFirstOrThrow();
  // Live progress: counted from the items committed with their effects (never a stale counter).
  const counts = await db(tx)
    .selectFrom('day_close.step_items')
    .select(['step_key', 'status', (eb) => eb.fn.countAll<number>().as('n')])
    .where('run_id', '=', run.id)
    .groupBy(['step_key', 'status'])
    .execute();
  const count = (step: string, status: string) =>
    Number(counts.find((c) => c.step_key === step && c.status === status)?.n ?? 0);
  const stepViews: StepView[] = steps.map((s) => {
    const p = {
      key: s.key as StepKey,
      status: s.status as StepStatus,
      total: s.total,
      done: count(s.key, 'done'),
      failed: count(s.key, 'failed'),
      skipped: count(s.key, 'skipped'),
    };
    const err = s.error as { code: string; message: string; retryable: boolean; integrity?: boolean } | null;
    return {
      key: s.key as StepKey,
      ordinal: s.ordinal,
      label: STEP_LABELS[s.key as StepKey],
      status: s.status as StepStatus,
      total: s.total,
      done: p.done,
      failed: p.failed,
      skipped: p.skipped,
      remaining: remaining(p),
      progress: progressLine(p),
      detail: (s.detail as Record<string, unknown>) ?? {},
      error: err
        ? {
            code: err.code,
            message: err.message,
            retryable: err.retryable,
            ...(err.integrity ? { integrity: true } : {}),
          }
        : null,
      attempts: s.attempts,
      startedAt: s.started_at ? (s.started_at as Date).toISOString() : null,
      finishedAt: s.finished_at ? (s.finished_at as Date).toISOString() : null,
      failedItems: failedItems
        .filter((i) => i.step_key === s.key)
        .map((i) => {
          const e = (i.error as { code?: string; message?: string; retryable?: boolean } | null) ?? {};
          const key = itemOverrideKey(s.key as StepKey, i.item_key);
          return {
            itemKey: key,
            ref: i.ref_type && i.ref_id ? { type: i.ref_type, id: i.ref_id } : null,
            code: e.code ?? 'failed',
            message: e.message ?? 'Failed.',
            retryable: e.retryable !== false,
            overridden: overriddenKeys.has(key),
          };
        }),
    };
  });
  const status = run.status as RunStatus;
  let blockers: ReadinessItem[] = [];
  if (status === 'blocked') {
    const r = await collectReadiness(deps, tx, run.property_id, {
      runId: run.id,
      businessDate: run.business_date,
    });
    blockers = r.blocking;
  }
  const failure = (run.failure as FailureJson | null) ?? null;
  const now = tx.now.getTime();
  const leaseLive = !!run.lease_owner && !!run.lease_until && (run.lease_until as Date).getTime() > now;
  const canResume = tx.authz.can(P.runResume, { propertyId: run.property_id });
  const resumeReason = !isActive(status)
    ? `The run is ${status}.`
    : leaseLive
      ? `Day Close is working on it right now (until ${(run.lease_until as Date).toISOString()} unless it reports in).`
      : !canResume
        ? `Needs the ${P.runResume} permission.`
        : undefined;
  const cancel = cancellable(
    status,
    steps.map((s) => ({ key: s.key as StepKey, status: s.status as StepStatus })),
    Number(doneItems.n),
  );
  const canCancel = tx.authz.can(P.runCancel, { propertyId: run.property_id });
  const canOverride = tx.authz.can(P.exceptionOverride, { propertyId: run.property_id });
  const overridable =
    blockers.filter((b) => b.overridable && !b.override).length +
    stepViews.flatMap((s) => s.failedItems).filter((i) => !i.overridden && !i.retryable).length;
  const current = stepViews.find((s) => s.key === run.current_step) ?? null;
  const advanceStep = stepViews.find((s) => s.key === 'advance');
  const summary =
    status === 'completed'
      ? `Day closed: business date advanced to ${(advanceStep?.detail.to as string) ?? 'the next day'}.`
      : status === 'cancelled'
        ? `Cancelled: ${run.cancel_reason ?? ''}`
        : status === 'blocked'
          ? `${blockers.length} thing${blockers.length === 1 ? '' : 's'} to settle before Day Close can continue.`
          : status === 'failed'
            ? `${current ? current.progress : 'Stopped'} — stopped: ${failure?.message ?? 'see the step'}${failure?.retryable === false ? '' : ' Resume continues from there; nothing done is repeated.'}`
            : current
              ? current.progress
              : 'Starting…';
  const issues: RunView['issues'] = [];
  if (failure && status === 'failed') {
    issues.push({
      code: failure.code,
      severity: 'blocking',
      message: failure.message,
      owner: failure.integrity
        ? { kind: 'department', id: 'role:finance', name: 'Finance' }
        : { kind: 'department', id: 'role:night_audit', name: 'Night audit' },
    });
  }
  if (status === 'blocked')
    for (const b of blockers)
      issues.push({ code: b.code, severity: 'blocking', message: b.message, owner: b.owner });
  const startedByUser = run.started_by.startsWith('user:') ? run.started_by.slice(5) : null;
  return {
    id: run.id,
    propertyId: run.property_id,
    businessDate: run.business_date,
    status: { dayClose: status, ...(run.current_step ? { step: run.current_step } : {}) },
    runStatus: status,
    trigger: run.trigger as RunView['trigger'],
    startedBy: run.started_by,
    startedByName: run.started_by_name,
    startedAt: (run.started_at as Date).toISOString(),
    finishedAt: run.finished_at ? (run.finished_at as Date).toISOString() : null,
    currentStep: (run.current_step as StepKey | null) ?? null,
    summary,
    steps: stepViews,
    blockers,
    failure,
    overrides: overrides.map((o) => ({
      itemKey: o.item_key,
      code: o.code,
      reason: o.reason,
      by: o.actor_name ?? o.actor,
      at: (o.created_at as Date).toISOString(),
    })),
    execution: {
      leaseHeldBy: leaseLive ? (run.lease_owner?.split('#')[0] ?? null) : null,
      leaseUntil: run.lease_until ? (run.lease_until as Date).toISOString() : null,
      lastHeartbeatAt: run.heartbeat_at ? (run.heartbeat_at as Date).toISOString() : null,
      resumableAt: leaseLive ? (run.lease_until as Date).toISOString() : null,
      retryCount: run.retry_count,
      nextRetryAt: run.next_retry_at ? (run.next_retry_at as Date).toISOString() : null,
      executions: Array.isArray(run.executions) ? (run.executions as Array<Record<string, unknown>>) : [],
    },
    notifications: { mode: effectMode(tx, 'message.staff') },
    autoContinue: run.auto_continue,
    allowedActions: [
      {
        action: 'resume',
        label: status === 'blocked' ? 'Check again and continue' : 'Resume',
        enabled: resumeReason === undefined,
        ...(resumeReason ? { reason: resumeReason } : {}),
      },
      {
        action: 'cancel',
        label: 'Cancel this Day Close',
        enabled: cancel.ok && canCancel,
        ...(!cancel.ok
          ? { reason: cancel.reason }
          : !canCancel
            ? { reason: `Needs the ${P.runCancel} permission.` }
            : {}),
      },
      {
        action: 'override',
        label: 'Proceed past an item (with a reason)',
        enabled: isActive(status) && overridable > 0 && canOverride,
        ...(!isActive(status) || overridable === 0
          ? { reason: 'Nothing to override.' }
          : !canOverride
            ? { reason: `Needs the ${P.exceptionOverride} permission.` }
            : {}),
      },
      {
        action: 'viewReport',
        label: 'Open the day report',
        enabled: status === 'completed' && tx.authz.can(P.reportRead, { propertyId: run.property_id }),
        ...(status !== 'completed' ? { reason: 'The day report exists once the day is closed.' } : {}),
      },
    ],
    issues,
    ...(startedByUser
      ? {
          owner: {
            kind: 'user' as const,
            id: startedByUser,
            ...(run.started_by_name ? { name: run.started_by_name } : {}),
          },
        }
      : {}),
    links: [
      { rel: 'property', type: 'property', id: run.property_id },
      ...(status === 'completed'
        ? [
            {
              rel: 'report',
              type: 'day_report',
              id: `${run.property_id}:${run.business_date}`,
              title: `Day report ${run.business_date}`,
            },
          ]
        : []),
    ],
    provenance: tx.environment === 'live' ? 'live' : 'simulated',
    version: run.version,
  };
}
