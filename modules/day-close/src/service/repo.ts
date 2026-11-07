/**
 * Persistence helpers for runs, steps, items, issues and events. Every write of a step item happens in the same
 * transaction as the item's effects; every executor write first renews the lease it holds (or fails).
 */
import type { Selectable, TxContext } from '@portico/db';
import { NotFoundError, newId } from '@portico/kernel';
import type { RunStatus, StepKey, StepStatus } from '../contracts';
import type { FailureRecord } from '../domain/errors';
import { LeaseLostError } from '../domain/errors';
import { STEP_ORDER, stepOrdinal } from '../domain/steps';
import type { DAY_CLOSE_EVENTS } from '../events';
import type { IssuesTable, RunsTable, StepItemsTable, StepsTable } from '../tables';
import { db, json } from './context';

export type RunRow = Selectable<RunsTable>;
export type StepRow = Selectable<StepsTable>;
export type ItemRow = Selectable<StepItemsTable>;
export type IssueRow = Selectable<IssuesTable>;

export async function loadRun(tx: TxContext, runId: string): Promise<RunRow> {
  const r = await db(tx).selectFrom('day_close.runs').selectAll().where('id', '=', runId).executeTakeFirst();
  if (!r) throw new NotFoundError('day_close_run', runId);
  return r;
}

export async function lockRun(tx: TxContext, runId: string): Promise<RunRow> {
  const r = await db(tx)
    .selectFrom('day_close.runs')
    .selectAll()
    .where('id', '=', runId)
    .forUpdate()
    .executeTakeFirst();
  if (!r) throw new NotFoundError('day_close_run', runId);
  return r;
}

export async function loadSteps(tx: TxContext, runId: string): Promise<StepRow[]> {
  return db(tx)
    .selectFrom('day_close.steps')
    .selectAll()
    .where('run_id', '=', runId)
    .orderBy('ordinal')
    .execute();
}

export async function createSteps(tx: TxContext, runId: string): Promise<void> {
  await db(tx)
    .insertInto('day_close.steps')
    .values(
      STEP_ORDER.map((key) => ({
        tenant_id: tx.tenantId,
        run_id: runId,
        key,
        ordinal: stepOrdinal(key),
        status: 'pending',
        detail: json({}),
      })),
    )
    .execute();
}

/**
 * Renew the executor's lease inside the current transaction. The UPDATE takes the run row lock, so item
 * transactions of one run are serialized and only the lease holder can commit effects (LeaseLostError otherwise).
 */
export async function heartbeat(
  tx: TxContext,
  runId: string,
  owner: string,
  leaseMs: number,
  extra: { status?: RunStatus; currentStep?: StepKey | null } = {},
): Promise<RunRow> {
  const row = await db(tx)
    .updateTable('day_close.runs')
    .set({
      lease_until: new Date(tx.now.getTime() + leaseMs),
      heartbeat_at: tx.now,
      ...(extra.status ? { status: extra.status } : {}),
      ...(extra.currentStep !== undefined ? { current_step: extra.currentStep } : {}),
    })
    .where('id', '=', runId)
    .where('lease_owner', '=', owner)
    .returningAll()
    .executeTakeFirst();
  if (!row) throw new LeaseLostError(runId);
  return row;
}

export async function setStep(
  tx: TxContext,
  runId: string,
  key: StepKey,
  patch: {
    status?: StepStatus;
    total?: number | null;
    detail?: Record<string, unknown>;
    error?: FailureRecord | null;
    started?: boolean;
    finished?: boolean;
    attempt?: boolean;
  },
): Promise<void> {
  const cur = await db(tx)
    .selectFrom('day_close.steps')
    .selectAll()
    .where('run_id', '=', runId)
    .where('key', '=', key)
    .executeTakeFirstOrThrow();
  const counts = await itemCounts(tx, runId, key);
  await db(tx)
    .updateTable('day_close.steps')
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.total !== undefined ? { total: patch.total } : {}),
      ...(patch.detail
        ? { detail: json({ ...((cur.detail as Record<string, unknown>) ?? {}), ...patch.detail }) }
        : {}),
      ...(patch.error !== undefined ? { error: patch.error ? json(patch.error) : null } : {}),
      ...(patch.started ? { started_at: cur.started_at ?? tx.now } : {}),
      ...(patch.finished ? { finished_at: tx.now } : {}),
      ...(patch.attempt ? { attempts: cur.attempts + 1 } : {}),
      done: counts.done,
      failed: counts.failed,
      skipped: counts.skipped,
      version: cur.version + 1,
    })
    .where('run_id', '=', runId)
    .where('key', '=', key)
    .execute();
}

export async function itemCounts(
  tx: TxContext,
  runId: string,
  key: StepKey,
): Promise<{ done: number; failed: number; skipped: number }> {
  const rows = await db(tx)
    .selectFrom('day_close.step_items')
    .select(['status', (eb) => eb.fn.countAll<number>().as('n')])
    .where('run_id', '=', runId)
    .where('step_key', '=', key)
    .groupBy('status')
    .execute();
  const n = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
  return { done: n('done'), failed: n('failed'), skipped: n('skipped') };
}

export async function loadItems(tx: TxContext, runId: string, key: StepKey): Promise<Map<string, ItemRow>> {
  const rows = await db(tx)
    .selectFrom('day_close.step_items')
    .selectAll()
    .where('run_id', '=', runId)
    .where('step_key', '=', key)
    .execute();
  return new Map(rows.map((r) => [r.item_key, r]));
}

/** Record an item's outcome (insert or update; a done item is final — DB trigger). */
export async function recordItem(
  tx: TxContext,
  input: {
    runId: string;
    step: StepKey;
    itemKey: string;
    ref: { type: string; id: string } | null;
    status: 'done' | 'failed' | 'skipped';
    result?: Record<string, unknown>;
    error?: FailureRecord | null;
  },
): Promise<void> {
  await db(tx)
    .insertInto('day_close.step_items')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      run_id: input.runId,
      step_key: input.step,
      item_key: input.itemKey,
      ref_type: input.ref?.type ?? null,
      ref_id: input.ref?.id ?? null,
      status: input.status,
      result: json(input.result ?? {}),
      error: input.error ? json(input.error) : null,
      updated_at: tx.now,
    })
    .onConflict((oc) =>
      oc.columns(['tenant_id', 'run_id', 'step_key', 'item_key']).doUpdateSet((eb) => ({
        status: eb.ref('excluded.status'),
        result: eb.ref('excluded.result'),
        error: eb.ref('excluded.error'),
        attempts: eb('day_close.step_items.attempts', '+', 1),
        updated_at: eb.ref('excluded.updated_at'),
      })),
    )
    .execute();
}

/** Open or refresh one of Day Close's own follow-ups (deduplicated by business identity). */
export async function upsertIssue(
  tx: TxContext,
  input: {
    propertyId: string;
    businessDate: string;
    runId: string | null;
    code: string;
    severity: 'blocking' | 'warning' | 'info';
    dedupeKey: string;
    ref: { type: string; id: string } | null;
    message: string;
    owner: { kind: 'user' | 'department'; id: string; name?: string };
    details?: Record<string, unknown>;
  },
): Promise<void> {
  const existing = await db(tx)
    .selectFrom('day_close.issues')
    .selectAll()
    .where('dedupe_key', '=', input.dedupeKey)
    .forUpdate()
    .executeTakeFirst();
  if (existing) {
    if (existing.status === 'resolved') return;
    await db(tx)
      .updateTable('day_close.issues')
      .set({
        message: input.message,
        severity: input.severity,
        details: json(input.details ?? {}),
        version: existing.version + 1,
      })
      .where('id', '=', existing.id)
      .execute();
    return;
  }
  const id = newId();
  await db(tx)
    .insertInto('day_close.issues')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      business_date: input.businessDate,
      run_id: input.runId,
      code: input.code,
      severity: input.severity,
      dedupe_key: input.dedupeKey,
      ref_type: input.ref?.type ?? null,
      ref_id: input.ref?.id ?? null,
      message: input.message,
      owner: json(input.owner),
      details: json(input.details ?? {}),
      status: 'open',
      created_at: tx.now,
    })
    .execute();
  await tx.audit({
    action: 'dayClose.issue.raised',
    target: { type: 'day_close_issue', id },
    propertyId: input.propertyId,
    after: { code: input.code, severity: input.severity, ref: input.ref, message: input.message },
  });
}

/** Close an open follow-up automatically when its cause is gone (recomputed, never frozen). */
export async function closeIssue(tx: TxContext, dedupeKey: string, resolution: string): Promise<void> {
  await db(tx)
    .updateTable('day_close.issues')
    .set((eb) => ({
      status: 'resolved',
      resolved_at: tx.now,
      resolved_by: 'system:day-close',
      resolution,
      version: eb('version', '+', 1),
    }))
    .where('dedupe_key', '=', dedupeKey)
    .where('status', '=', 'open')
    .execute();
}

export async function emitRunEvent(
  tx: TxContext,
  run: Pick<RunRow, 'id' | 'property_id' | 'business_date' | 'version'>,
  type: (typeof DAY_CLOSE_EVENTS)[keyof typeof DAY_CLOSE_EVENTS],
  payload: Record<string, unknown> = {},
): Promise<void> {
  await tx.emit({
    type,
    propertyId: run.property_id,
    aggregate: { type: 'day_close_run', id: run.id },
    aggregateVersion: run.version,
    payload: { runId: run.id, propertyId: run.property_id, businessDate: run.business_date, ...payload },
  });
}
