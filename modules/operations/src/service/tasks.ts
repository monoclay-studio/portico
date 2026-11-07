import { explainVersionMiss, type Selectable, sql, type TxContext, type Updateable } from '@portico/db';
import {
  BusinessRuleError,
  NotFoundError,
  newId,
  newReferenceCode,
  requirePermission,
  ValidationError,
  VersionConflictError,
  zonedTimeToInstant,
} from '@portico/kernel';
import type {
  ServiceRequestInput,
  ServiceRequestView,
  TaskCreateInput,
  TaskDetail,
  TaskListQuery,
  TaskView,
  WorkItem,
} from '../contracts';
import { defaultDueAt, evaluateEscalation, nextEscalationAt } from '../domain/escalation';
import {
  CLEANING_KINDS,
  type DepartmentKind,
  type EntityRef,
  HOUSEKEEPING_KINDS,
  OPEN_TASK_STATUSES,
  type ServiceRequestChannel,
  type TaskKind,
  type TaskPriority,
  type TaskStatus,
  type UnitCondition,
} from '../domain/model';
import { type ArrivalContext, housekeepingPriority } from '../domain/priority';
import { serviceRequestFacets } from '../domain/records';
import { creditsFor, type EscalationStep, escalationPathFor } from '../domain/settings';
import {
  assertTaskTransition,
  conditionEffect,
  defaultDepartmentFor,
  serviceRequestStatusFor,
  transitionPermissionNeeded,
} from '../domain/tasks';
import type { ServiceRequestsTable, TasksTable } from '../tables';
import {
  type Attachment,
  actorName,
  actorUserId,
  type Deps,
  db,
  feedMark,
  iso,
  loadSettings,
  logTask,
  propertyFacts,
  requireAny,
  TASK_READ_PERMISSIONS,
  type TaskRow,
  toTaskView,
  type UnitRow,
} from './internal';
import { loadUnit, refreshReadiness, writeRoomStatus } from './units';

// ───────────────────────────── Creation ─────────────────────────────

export interface NewTask {
  propertyId: string;
  kind: TaskKind;
  title: string;
  description?: string | null;
  departmentKind?: string;
  departmentId?: string | null;
  priority?: TaskPriority;
  priorityScore?: number;
  priorityReasons?: string[];
  unitId?: string | null;
  stayId?: string | null;
  guestProfileId?: string | null;
  parentTaskId?: string | null;
  refs?: EntityRef[];
  assigneeUserId?: string | null;
  assigneeName?: string | null;
  serviceDate?: string | null;
  dueAt?: Date | null;
  credits?: number;
  source: TasksTable['source'];
  dedupeKey?: string | null;
}

const departmentCache = new WeakMap<TxContext, Map<string, Array<{ id: string; kind: string }>>>();

async function resolveDepartmentId(
  d: Deps,
  tx: TxContext,
  propertyId: string,
  kind: string,
): Promise<string | null> {
  let m = departmentCache.get(tx);
  if (!m) {
    m = new Map();
    departmentCache.set(tx, m);
  }
  let list = m.get(propertyId);
  if (!list) {
    list = await d.ports.platform.listDepartments(tx, propertyId);
    m.set(propertyId, list);
  }
  return list.find((x) => x.kind === kind)?.id ?? null;
}

/**
 * Insert a task (internal: the calling command has already authorized the actor). Idempotent on `dedupeKey`:
 * a second request for the same business identity returns the existing task with `created: false`.
 */
export async function insertTask(
  d: Deps,
  tx: TxContext,
  t: NewTask,
): Promise<{ row: TaskRow; created: boolean }> {
  if (t.dedupeKey) {
    const existing = await db(tx)
      .selectFrom('operations.tasks')
      .selectAll()
      .where('dedupe_key', '=', t.dedupeKey)
      .executeTakeFirst();
    if (existing) return { row: existing, created: false };
  }
  const settings = await loadSettings(d, tx, t.propertyId);
  let unitTypeId: string | null = null;
  if (t.unitId) {
    const unit = await db(tx)
      .selectFrom('operations.unit_status')
      .select(['property_id', 'unit_type_id'])
      .where('id', '=', t.unitId)
      .executeTakeFirst();
    if (!unit) throw new NotFoundError('unit', t.unitId);
    if (unit.property_id !== t.propertyId)
      throw new ValidationError('unit_property_mismatch', 'The unit belongs to another property.', {
        unitId: t.unitId,
      });
    unitTypeId = unit.unit_type_id;
  }
  const departmentKind = t.departmentKind ?? defaultDepartmentFor(t.kind);
  const departmentId = t.departmentId ?? (await resolveDepartmentId(d, tx, t.propertyId, departmentKind));
  const priority = t.priority ?? 'normal';
  const dueAt =
    t.dueAt ??
    (settings.autoDueKinds.includes(t.kind)
      ? defaultDueAt(tx.now, priority, settings.resolutionMinutes)
      : null);
  const path = escalationPathFor(settings, departmentKind);
  // Planned work (a service date in the future, e.g. tomorrow's plan or a preventive job) starts its
  // acknowledgement clock at the start of that day in property time, never at planning time.
  let anchor = tx.now;
  if (t.serviceDate) {
    const facts = await propertyFacts(d, tx, t.propertyId);
    const dayStart = zonedTimeToInstant(t.serviceDate, '00:00', facts.timezone);
    if (dayStart > anchor) anchor = dayStart;
  }
  const id = newId(tx.now.getTime());
  const inserted = await db(tx)
    .insertInto('operations.tasks')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: t.propertyId,
      department_kind: departmentKind,
      department_id: departmentId,
      kind: t.kind,
      title: t.title,
      description: t.description ?? null,
      status: 'open',
      priority,
      priority_score: t.priorityScore ?? 0,
      priority_reasons: t.priorityReasons ?? [],
      unit_id: t.unitId ?? null,
      stay_id: t.stayId ?? null,
      guest_profile_id: t.guestProfileId ?? null,
      parent_task_id: t.parentTaskId ?? null,
      refs: JSON.stringify(t.refs ?? []),
      assignee_user_id: t.assigneeUserId ?? null,
      assignee_name: t.assigneeName ?? null,
      service_date: t.serviceDate ?? null,
      due_at: dueAt,
      credits: t.credits ?? creditsFor(settings, t.kind, unitTypeId),
      blocked_reason: null,
      cancelled_reason: null,
      started_at: null,
      done_at: null,
      done_by: null,
      verified_at: null,
      verified_by: null,
      cancelled_at: null,
      escalation_path: JSON.stringify(path),
      escalation_anchor_at: anchor,
      next_escalation_at: nextEscalationAt({ dueAt, createdAt: anchor, started: false }, path, 0),
      last_escalated_at: null,
      source: t.source,
      dedupe_key: t.dedupeKey ?? null,
      created_by: actorName(tx),
      created_at: tx.now,
      updated_at: tx.now,
      feed_xid: feedMark(),
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'dedupe_key']).doNothing())
    .returningAll()
    .executeTakeFirst();
  if (!inserted) {
    // A concurrent transaction created the same business task first.
    const existing = await db(tx)
      .selectFrom('operations.tasks')
      .selectAll()
      .where('dedupe_key', '=', t.dedupeKey ?? '')
      .executeTakeFirstOrThrow();
    return { row: existing, created: false };
  }
  await logTask(tx, inserted, {
    kind: 'created',
    to: inserted.assignee_user_id
      ? `assigned:${inserted.assignee_name ?? inserted.assignee_user_id}`
      : 'open',
    source: t.source,
  });
  await tx.emit({
    type: 'operations.task.created',
    propertyId: t.propertyId,
    aggregate: { type: 'task', id },
    aggregateVersion: inserted.version,
    payload: {
      taskId: id,
      kind: t.kind,
      title: t.title,
      departmentKind,
      departmentId,
      priority,
      unitId: t.unitId ?? null,
      stayId: t.stayId ?? null,
      assigneeUserId: t.assigneeUserId ?? null,
      dueAt: iso(dueAt),
      source: t.source,
    },
  });
  if (t.unitId && HOUSEKEEPING_KINDS.includes(t.kind)) await refreshReadiness(d, tx, t.unitId);
  return { row: inserted, created: true };
}

/** Arrival context for priority: an expected arrival on the unit for the property's business date. */
export async function arrivalContext(
  d: Deps,
  tx: TxContext,
  propertyId: string,
  unitId: string,
): Promise<{ ctx: ArrivalContext; stayId: string; eta: Date | null } | null> {
  const facts = await propertyFacts(d, tx, propertyId);
  const stay = await db(tx)
    .selectFrom('operations.stay_projection')
    .selectAll()
    .where('unit_id', '=', unitId)
    .where('status', '=', 'expected')
    .where('arrival', '=', facts.businessDate)
    .orderBy('eta')
    .executeTakeFirst();
  if (!stay) return null;
  const expectedAt = stay.eta
    ? new Date(stay.eta)
    : zonedTimeToInstant(facts.businessDate, facts.checkInTime, facts.timezone);
  return {
    ctx: {
      expectedAt,
      vip: stay.vip,
      earlyCheckIn: stay.early_check_in,
      today: true,
      guestWaiting: stay.guest_waiting_since !== null,
    },
    stayId: stay.id,
    eta: stay.eta ? new Date(stay.eta) : null,
  };
}

export async function housekeepingPriorityFor(
  d: Deps,
  tx: TxContext,
  input: { propertyId: string; unitId: string; kind: TaskKind; departed?: boolean },
) {
  const settings = await loadSettings(d, tx, input.propertyId);
  const arrival = await arrivalContext(d, tx, input.propertyId, input.unitId);
  return housekeepingPriority({
    kind: input.kind,
    now: tx.now,
    arrival: arrival?.ctx ?? null,
    departed: input.departed ?? false,
    arrivalSoonMinutes: settings.arrivalSoonMinutes,
  });
}

/** Re-score open housekeeping tasks of a unit (arrival details changed: ETA, VIP, early check-in). */
export async function rescoreUnitTasks(
  d: Deps,
  tx: TxContext,
  propertyId: string,
  unitId: string,
): Promise<void> {
  const tasks = await db(tx)
    .selectFrom('operations.tasks')
    .selectAll()
    .where('unit_id', '=', unitId)
    .where('status', 'in', ['open', 'in_progress', 'blocked'])
    .where('kind', 'in', [...HOUSEKEEPING_KINDS])
    .execute();
  for (const t of tasks) {
    const p = await housekeepingPriorityFor(d, tx, {
      propertyId,
      unitId,
      kind: t.kind as TaskKind,
      departed: t.kind === 'departure_clean',
    });
    if (p.score === t.priority_score && p.priority === t.priority) continue;
    // Priority is derived from arrival facts: it does not bump the version (no false offline conflicts).
    await db(tx)
      .updateTable('operations.tasks')
      .set({
        priority: p.priority,
        priority_score: p.score,
        priority_reasons: p.reasons,
        feed_xid: feedMark(),
        updated_at: tx.now,
      })
      .where('id', '=', t.id)
      .execute();
    if (p.priority !== t.priority) {
      await logTask(tx, t, { kind: 'priority_changed', from: t.priority, to: p.priority, source: 'system' });
    }
  }
  if (tasks.length) await refreshReadiness(d, tx, unitId);
}

function assertSameProperty(row: { property_id: string }, propertyId: string, what: string) {
  if (row.property_id !== propertyId)
    throw new ValidationError('property_mismatch', `The ${what} belongs to another property.`);
}

export async function createTask(d: Deps, tx: TxContext, input: TaskCreateInput): Promise<TaskView> {
  requirePermission(tx, 'operations.task.manage', { propertyId: input.propertyId });
  if (input.kind === 'work_order' || input.kind === 'service_request' || input.kind === 'inspection') {
    throw new ValidationError(
      'use_dedicated_endpoint',
      `Create a ${input.kind.replace('_', ' ')} through its own endpoint so its details (and, for inspections, the checklist) are captured.`,
      { kind: input.kind },
    );
  }
  if (input.unitId) assertSameProperty(await loadUnit(tx, input.unitId), input.propertyId, 'unit');
  const kind = (input.kind ?? 'general') as TaskKind;
  let priority = (input.priority ?? 'normal') as TaskPriority;
  let score = 0;
  let reasons: string[] = [];
  if (input.unitId && HOUSEKEEPING_KINDS.includes(kind) && input.priority === undefined) {
    const p = await housekeepingPriorityFor(d, tx, {
      propertyId: input.propertyId,
      unitId: input.unitId,
      kind,
    });
    priority = p.priority;
    score = p.score;
    reasons = p.reasons;
  }
  const facts = await propertyFacts(d, tx, input.propertyId);
  const { row } = await insertTask(d, tx, {
    propertyId: input.propertyId,
    kind,
    title: input.title,
    description: input.description ?? null,
    ...(input.departmentKind ? { departmentKind: input.departmentKind } : {}),
    departmentId: input.departmentId ?? null,
    priority,
    priorityScore: score,
    priorityReasons: reasons,
    unitId: input.unitId ?? null,
    stayId: input.stayId ?? null,
    guestProfileId: input.guestProfileId ?? null,
    refs: input.refs ?? [],
    assigneeUserId: input.assigneeUserId ?? null,
    assigneeName:
      input.assigneeName ??
      (input.assigneeUserId ? await attendantName(tx, input.propertyId, input.assigneeUserId) : null),
    serviceDate: HOUSEKEEPING_KINDS.includes(kind) ? facts.businessDate : null,
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    source: 'manual',
  });
  await tx.audit({
    action: 'operations.task.create',
    target: { type: 'task', id: row.id },
    propertyId: input.propertyId,
    after: { kind, title: input.title, priority, assigneeUserId: input.assigneeUserId ?? null },
  });
  return taskView(tx, row);
}

/**
 * Domain-map provider: `createTask(tx, { propertyId, departmentId, kind, title, ref?, dueAt?, priority })`.
 * ADR-0015: the calling module authorized its own command at `propertyId`, so operations does not re-check
 * `operations.task.manage` for that user (its HTTP route `POST /operations/tasks` does); a referenced unit of
 * another property is refused (`unit_property_mismatch`, insertTask).
 */
export async function createTaskForModule(
  d: Deps,
  tx: TxContext,
  input: {
    propertyId: string;
    departmentId?: string | null;
    departmentKind?: DepartmentKind;
    kind: TaskKind;
    title: string;
    description?: string;
    ref?: EntityRef;
    dueAt?: Date | string | null;
    priority: TaskPriority;
    dedupeKey?: string;
  },
): Promise<{ taskId: string; created: boolean }> {
  const ref = input.ref;
  const { row, created } = await insertTask(d, tx, {
    propertyId: input.propertyId,
    kind: input.kind,
    title: input.title,
    description: input.description ?? null,
    ...(input.departmentKind ? { departmentKind: input.departmentKind } : {}),
    departmentId: input.departmentId ?? null,
    priority: input.priority,
    stayId: ref?.type === 'stay' ? ref.id : null,
    unitId: ref?.type === 'unit' ? ref.id : null,
    guestProfileId: ref?.type === 'guestProfile' ? ref.id : null,
    refs: ref ? [ref] : [],
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    source: 'system',
    dedupeKey: input.dedupeKey ?? null,
  });
  return { taskId: row.id, created };
}

async function attendantName(tx: TxContext, propertyId: string, userId: string): Promise<string | null> {
  const a = await db(tx)
    .selectFrom('operations.attendants')
    .select('display_name')
    .where('property_id', '=', propertyId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return a?.display_name ?? null;
}

// ───────────────────────────── Reads ─────────────────────────────

export async function loadTask(
  tx: TxContext,
  id: string,
  opts: { forUpdate?: boolean } = {},
): Promise<TaskRow> {
  let q = db(tx).selectFrom('operations.tasks').selectAll().where('id', '=', id);
  if (opts.forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw new NotFoundError('task', id);
  return row;
}

export async function taskView(tx: TxContext, row: TaskRow): Promise<TaskView> {
  let unitNumber: string | null = null;
  if (row.unit_id) {
    const u = await db(tx)
      .selectFrom('operations.unit_status')
      .select('unit_number')
      .where('id', '=', row.unit_id)
      .executeTakeFirst();
    unitNumber = u?.unit_number ?? null;
  }
  let backs: { type: 'service_request' | 'work_order'; id: string; number: string } | null = null;
  if (row.kind === 'service_request') {
    const sr = await db(tx)
      .selectFrom('operations.service_requests')
      .select(['id', 'number'])
      .where('task_id', '=', row.id)
      .executeTakeFirst();
    if (sr) backs = { type: 'service_request', id: sr.id, number: sr.number };
  } else if (row.kind === 'work_order') {
    const wo = await db(tx)
      .selectFrom('operations.work_orders')
      .select(['id', 'number'])
      .where('task_id', '=', row.id)
      .executeTakeFirst();
    if (wo) backs = { type: 'work_order', id: wo.id, number: wo.number };
  }
  return toTaskView(row, tx, unitNumber, backs);
}

export async function getTask(_d: Deps, tx: TxContext, id: string): Promise<TaskDetail> {
  const row = await loadTask(tx, id);
  requireAny(tx, TASK_READ_PERMISSIONS, row.property_id);
  const history = await db(tx)
    .selectFrom('operations.task_activity')
    .selectAll()
    .where('task_id', '=', id)
    .orderBy('occurred_at')
    .orderBy('id')
    .execute();
  return {
    ...(await taskView(tx, row)),
    history: history.map((h) => ({
      id: h.id,
      kind: h.kind,
      from: h.from_value,
      to: h.to_value,
      comment: h.comment,
      attachments: (h.attachments ?? []) as Attachment[],
      actor: actorLabelFrom(h.actor),
      occurredAt: new Date(h.occurred_at).toISOString(),
      clientOccurredAt: iso(h.client_occurred_at),
      source: h.source,
    })),
  };
}

function actorLabelFrom(actor: unknown): string {
  const a = actor as {
    kind?: string;
    displayName?: string;
    userId?: string;
    process?: string;
    clientId?: string;
  };
  return a.displayName ?? a.userId ?? a.process ?? a.clientId ?? a.kind ?? 'unknown';
}

export async function listTasks(_d: Deps, tx: TxContext, q: TaskListQuery): Promise<TaskView[]> {
  requireAny(tx, TASK_READ_PERMISSIONS, q.propertyId);
  let query = db(tx)
    .selectFrom('operations.tasks as t')
    .leftJoin('operations.unit_status as u', 'u.id', 't.unit_id')
    .selectAll('t')
    .select('u.unit_number')
    .where('t.property_id', '=', q.propertyId)
    .orderBy('t.priority_score', 'desc')
    .orderBy('t.created_at')
    .limit(q.limit);
  if (q.status?.length) query = query.where('t.status', 'in', q.status);
  if (q.kind?.length) query = query.where('t.kind', 'in', q.kind);
  if (q.assigneeUserId) query = query.where('t.assignee_user_id', '=', q.assigneeUserId);
  if (q.unitId) query = query.where('t.unit_id', '=', q.unitId);
  if (q.departmentKind) query = query.where('t.department_kind', '=', q.departmentKind);
  if (q.serviceDate) query = query.where('t.service_date', '=', q.serviceDate);
  if (q.overdue)
    query = query.where('t.due_at', '<', tx.now).where('t.status', 'in', [...OPEN_TASK_STATUSES]);
  const rows = await query.execute();
  return rows.map((r) => toTaskView(r, tx, r.unit_number ?? null));
}

// ───────────────────────────── Transitions ─────────────────────────────

export interface TaskChangeMeta {
  expectedVersion?: number;
  source?: 'staff' | 'mobile_sync' | 'system' | 'inspection' | 'work_order';
  clientOccurredAt?: Date | null;
  /** Internal callers (inspection, work-order completion) may perform transitions reserved to them. */
  internal?: boolean;
}

function assertTaskVersion(row: TaskRow, expected: number | undefined) {
  if (expected !== undefined && row.version !== expected)
    throw new VersionConflictError('task', row.id, expected, row.version);
}

export async function transitionTask(
  d: Deps,
  tx: TxContext,
  taskId: string,
  input: { to: TaskStatus; reason?: string; comment?: string },
  meta: TaskChangeMeta = {},
): Promise<TaskView> {
  const row = await loadTask(tx, taskId, { forUpdate: true });
  assertTaskVersion(row, meta.expectedVersion);
  const me = actorUserId(tx);
  const relation = row.assignee_user_id ? (row.assignee_user_id === me ? 'assignee' : 'other') : 'unassigned';
  if (!meta.internal) {
    const needed = transitionPermissionNeeded(input.to, relation);
    // task.manage covers everything task.update allows.
    requireAny(
      tx,
      needed === 'operations.task.update' ? [needed, 'operations.task.manage'] : [needed],
      row.property_id,
    );
  }
  const from = row.status as TaskStatus;
  const kind = row.kind as TaskKind;
  if (!meta.internal) {
    assertTaskTransition({ from, to: input.to, kind, reason: input.reason ?? null });
    if (kind === 'work_order' && input.to === 'done') {
      throw new BusinessRuleError(
        'work_order_completion_required',
        'Complete the work order (with a resolution note and parts used) instead of marking its task done.',
      );
    }
  }
  const set: Updateable<TasksTable> = { status: input.to, updated_at: tx.now };
  if (
    relation === 'unassigned' &&
    me &&
    (input.to === 'in_progress' || input.to === 'done') &&
    !meta.internal
  ) {
    set.assignee_user_id = me;
    set.assignee_name = (await attendantName(tx, row.property_id, me)) ?? actorName(tx);
  }
  set.blocked_reason = input.to === 'blocked' ? (input.reason ?? null) : null;
  if (input.to === 'in_progress' && !row.started_at) set.started_at = tx.now;
  if (input.to === 'done') {
    set.done_at = tx.now;
    set.done_by = actorName(tx);
    if (!row.started_at) set.started_at = tx.now;
  }
  if (input.to === 'verified') {
    set.verified_at = tx.now;
    set.verified_by = actorName(tx);
  }
  if (input.to === 'cancelled') {
    set.cancelled_at = tx.now;
    set.cancelled_reason = input.reason ?? null;
  }
  const terminalOrDone = input.to === 'done' || input.to === 'verified' || input.to === 'cancelled';
  if (terminalOrDone) set.next_escalation_at = null;
  else {
    if (from === 'done') {
      set.done_at = null;
      set.done_by = null;
    }
    // Acknowledgement steps stop applying once the task is started; overdue steps keep running.
    set.next_escalation_at = nextEscalationAt(
      {
        dueAt: row.due_at ? new Date(row.due_at) : null,
        createdAt: new Date(row.escalation_anchor_at ?? row.created_at),
        started: input.to === 'in_progress' || !!row.started_at,
      },
      row.escalation_path as EscalationStep[],
      row.escalation_level,
    );
  }
  const updated = await db(tx)
    .updateTable('operations.tasks')
    .set({ ...set, feed_xid: feedMark(), version: row.version + 1 })
    .where('id', '=', taskId)
    .where('version', '=', row.version)
    .returningAll()
    .executeTakeFirst();
  if (!updated)
    return explainVersionMiss('task', taskId, row.version, async () => (await loadTask(tx, taskId)).version);
  const source = meta.source ?? 'staff';
  await logTask(tx, updated, {
    kind: 'status_changed',
    from,
    to: input.to,
    comment: input.reason ?? null,
    source,
    clientOccurredAt: meta.clientOccurredAt ?? null,
  });
  if (set.assignee_user_id) {
    await logTask(tx, updated, {
      kind: 'assigned',
      from: null,
      to: set.assignee_name ?? set.assignee_user_id,
      source,
    });
  }
  if (input.comment?.trim()) {
    await logTask(tx, updated, {
      kind: 'comment',
      comment: input.comment,
      source,
      clientOccurredAt: meta.clientOccurredAt ?? null,
    });
  }
  await tx.audit({
    action: 'operations.task.transition',
    target: { type: 'task', id: taskId },
    propertyId: row.property_id,
    reason: input.reason ?? null,
    before: { status: from },
    after: { status: input.to, source },
  });
  await tx.emit({
    type: 'operations.task.statusChanged',
    propertyId: row.property_id,
    aggregate: { type: 'task', id: taskId },
    aggregateVersion: updated.version,
    payload: {
      taskId,
      kind,
      from,
      to: input.to,
      unitId: row.unit_id,
      stayId: row.stay_id,
      assigneeUserId: updated.assignee_user_id,
      reason: input.reason ?? null,
    },
  });
  await applyTaskSideEffects(d, tx, updated, from, input.to, source, meta.clientOccurredAt ?? null);
  return taskView(tx, await loadTask(tx, taskId));
}

async function applyTaskSideEffects(
  d: Deps,
  tx: TxContext,
  task: TaskRow,
  from: TaskStatus,
  to: TaskStatus,
  source: string,
  clientOccurredAt: Date | null,
): Promise<void> {
  const kind = task.kind as TaskKind;
  if (task.unit_id) {
    const unit = await loadUnit(tx, task.unit_id, { forUpdate: true });
    const effect = conditionEffect(kind, to, unit.condition as UnitCondition);
    if (effect) {
      await writeRoomStatus(
        d,
        tx,
        unit,
        { condition: effect },
        {
          reason: `${task.title} ${to === 'done' ? 'completed' : 'started'}`,
          source: source === 'mobile_sync' ? 'mobile_sync' : 'task',
          clientOccurredAt,
        },
      );
    }
    if (kind === 'turndown' && to === 'done') {
      await writeRoomStatus(
        d,
        tx,
        await loadUnit(tx, task.unit_id, { forUpdate: true }),
        { turndown: 'done' },
        {
          source: 'task',
          clientOccurredAt,
        },
      );
    }
    if (CLEANING_KINDS.includes(kind) && to === 'done') {
      const settings = await loadSettings(d, tx, task.property_id);
      const current = await loadUnit(tx, task.unit_id);
      if (settings.inspectionAfterCleaning && current.occupancy === 'vacant') {
        const p = await housekeepingPriorityFor(d, tx, {
          propertyId: task.property_id,
          unitId: task.unit_id,
          kind: 'inspection',
        });
        await insertTask(d, tx, {
          propertyId: task.property_id,
          kind: 'inspection',
          title: `Inspect · ${current.unit_number}`,
          unitId: task.unit_id,
          stayId: task.stay_id,
          parentTaskId: task.id,
          priority: p.priority,
          priorityScore: p.score,
          priorityReasons: p.reasons,
          serviceDate: task.service_date,
          refs: [{ type: 'task', id: task.id }],
          source: 'system',
          dedupeKey: `inspection:after:${task.id}`,
        });
      }
    }
    await refreshReadiness(d, tx, task.unit_id);
  }
  if (kind === 'service_request') {
    const sr = await db(tx)
      .selectFrom('operations.service_requests')
      .selectAll()
      .where('task_id', '=', task.id)
      .forUpdate()
      .executeTakeFirst();
    if (sr) {
      const status = serviceRequestStatusFor(to);
      if (status !== sr.status) {
        await db(tx)
          .updateTable('operations.service_requests')
          .set({
            status,
            fulfilled_at: status === 'fulfilled' ? (sr.fulfilled_at ?? tx.now) : null,
            version: sr.version + 1,
          })
          .where('id', '=', sr.id)
          .execute();
        if (status === 'fulfilled' && from !== 'done') {
          await tx.emit({
            type: 'operations.serviceRequest.completed',
            propertyId: sr.property_id,
            aggregate: { type: 'service_request', id: sr.id },
            payload: {
              serviceRequestId: sr.id,
              number: sr.number,
              taskId: task.id,
              stayId: sr.stay_id,
              guestProfileId: sr.guest_profile_id,
              category: sr.category,
              completedBy: task.done_by,
            },
          });
        }
      }
    }
  }
}

/** DND on: in-room service tasks wait (blocked "Do not disturb"); DND off: they are released again. */
export async function setDndOnServiceTasks(
  d: Deps,
  tx: TxContext,
  unit: UnitRow,
  dnd: boolean,
): Promise<void> {
  const DND_REASON = 'Do not disturb';
  const tasks = await db(tx)
    .selectFrom('operations.tasks')
    .selectAll()
    .where('unit_id', '=', unit.id)
    .where('kind', 'in', ['stayover', 'turndown'])
    .where('status', '=', dnd ? 'open' : 'blocked')
    .execute();
  for (const t of tasks) {
    if (!dnd && t.blocked_reason !== DND_REASON) continue;
    await transitionTask(
      d,
      tx,
      t.id,
      { to: dnd ? 'blocked' : 'open', reason: dnd ? DND_REASON : 'Do not disturb removed' },
      { internal: true, source: 'system' },
    );
  }
}

export async function assignTask(
  d: Deps,
  tx: TxContext,
  taskId: string,
  input: { assigneeUserId: string | null; assigneeName?: string; reason?: string },
  meta: TaskChangeMeta = {},
): Promise<TaskView> {
  const row = await loadTask(tx, taskId, { forUpdate: true });
  assertTaskVersion(row, meta.expectedVersion);
  if (!meta.internal) {
    const perms = HOUSEKEEPING_KINDS.includes(row.kind as TaskKind)
      ? ['operations.housekeeping.assign', 'operations.task.manage']
      : ['operations.task.manage'];
    requireAny(tx, perms, row.property_id);
  }
  if (!OPEN_TASK_STATUSES.includes(row.status as TaskStatus)) {
    throw new BusinessRuleError(
      'task_closed',
      `This task is ${row.status.replace('_', ' ')} and can no longer be reassigned.`,
      { status: row.status },
    );
  }
  if (row.assignee_user_id === input.assigneeUserId) return taskView(tx, row);
  const name = input.assigneeUserId
    ? (input.assigneeName ?? (await attendantName(tx, row.property_id, input.assigneeUserId)))
    : null;
  const updated = await db(tx)
    .updateTable('operations.tasks')
    .set({
      assignee_user_id: input.assigneeUserId,
      assignee_name: name,
      // A reassigned in-progress task goes back to open for the new assignee.
      status: row.status === 'in_progress' ? 'open' : row.status,
      version: row.version + 1,
      feed_xid: feedMark(),
      updated_at: tx.now,
    })
    .where('id', '=', taskId)
    .where('version', '=', row.version)
    .returningAll()
    .executeTakeFirst();
  if (!updated)
    return explainVersionMiss('task', taskId, row.version, async () => (await loadTask(tx, taskId)).version);
  await logTask(tx, updated, {
    kind: 'assigned',
    from: row.assignee_name ?? row.assignee_user_id,
    to: name ?? input.assigneeUserId,
    comment: input.reason ?? null,
    source: meta.source ?? 'staff',
  });
  await tx.audit({
    action: row.assignee_user_id ? 'operations.task.reassign' : 'operations.task.assign',
    target: { type: 'task', id: taskId },
    propertyId: row.property_id,
    reason: input.reason ?? null,
    before: { assigneeUserId: row.assignee_user_id },
    after: { assigneeUserId: input.assigneeUserId },
  });
  await tx.emit({
    type: 'operations.task.assigned',
    propertyId: row.property_id,
    aggregate: { type: 'task', id: taskId },
    aggregateVersion: updated.version,
    payload: {
      taskId,
      kind: row.kind,
      unitId: row.unit_id,
      previousAssigneeUserId: row.assignee_user_id,
      assigneeUserId: input.assigneeUserId,
      reason: input.reason ?? null,
    },
  });
  if (row.unit_id) await refreshReadiness(d, tx, row.unit_id);
  return taskView(tx, updated);
}

export async function commentTask(
  _d: Deps,
  tx: TxContext,
  taskId: string,
  input: { text: string; attachments: Attachment[] },
  meta: TaskChangeMeta = {},
): Promise<TaskView> {
  const row = await loadTask(tx, taskId);
  requireAny(tx, ['operations.task.update', 'operations.task.manage'], row.property_id);
  if (!input.text.trim() && !input.attachments.length) {
    throw new ValidationError('empty_comment', 'Write a comment or attach a photo.');
  }
  await logTask(tx, row, {
    kind: input.attachments.length ? 'attachment' : 'comment',
    comment: input.text.trim() || null,
    attachments: input.attachments,
    source: meta.source ?? 'staff',
    clientOccurredAt: meta.clientOccurredAt ?? null,
  });
  // Comments do not change the task's version (they never conflict with other edits).
  await db(tx)
    .updateTable('operations.tasks')
    .set({ feed_xid: feedMark(), updated_at: tx.now })
    .where('id', '=', taskId)
    .execute();
  return taskView(tx, await loadTask(tx, taskId));
}

// ───────────────────────────── Escalation ─────────────────────────────

/**
 * Escalate overdue tasks whose next escalation time has passed (run by the worker scheduler every minute, and
 * callable on demand). Each step fires exactly once; firing is recorded in history and emitted as
 * `operations.task.escalated` for notifications.
 */
export async function runEscalations(d: Deps, tx: TxContext, propertyId: string) {
  requirePermission(tx, 'operations.task.manage', { propertyId });
  const due = await db(tx)
    .selectFrom('operations.tasks')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('next_escalation_at', '<=', tx.now)
    .where('status', 'in', [...OPEN_TASK_STATUSES])
    .orderBy('next_escalation_at')
    .forUpdate()
    .skipLocked()
    .execute();
  const escalated: Array<{
    taskId: string;
    level: number;
    target: EscalationStep['target'];
    minutesOverdue: number;
  }> = [];
  for (const t of due) {
    const decision = evaluateEscalation({
      now: tx.now,
      dueAt: t.due_at ? new Date(t.due_at) : null,
      createdAt: new Date(t.escalation_anchor_at ?? t.created_at),
      started: t.started_at !== null,
      path: t.escalation_path as EscalationStep[],
      currentLevel: t.escalation_level,
    });
    if (!decision?.fired.length) {
      // Nothing fires (e.g. an acknowledgement step passed over because the task was started): move the clock on.
      await db(tx)
        .updateTable('operations.tasks')
        .set({
          escalation_level: decision?.level ?? t.escalation_level,
          next_escalation_at:
            decision?.next ??
            nextEscalationAt(
              {
                dueAt: t.due_at ? new Date(t.due_at) : null,
                createdAt: new Date(t.escalation_anchor_at ?? t.created_at),
                started: t.started_at !== null,
              },
              t.escalation_path as EscalationStep[],
              t.escalation_level + 1,
            ),
          feed_xid: feedMark(),
        })
        .where('id', '=', t.id)
        .execute();
      continue;
    }
    // Escalation is time-derived metadata: it does not bump the task version.
    await db(tx)
      .updateTable('operations.tasks')
      .set({
        escalation_level: decision.level,
        next_escalation_at: decision.next,
        last_escalated_at: tx.now,
        feed_xid: feedMark(),
        updated_at: tx.now,
      })
      .where('id', '=', t.id)
      .execute();
    for (const f of decision.fired) {
      await logTask(tx, t, {
        kind: 'escalated',
        from: String(f.level - 1),
        to: `${f.level}:${f.target}`,
        comment:
          f.reason === 'not_acknowledged'
            ? `Not started in time — escalated to ${f.target.replace('_', ' ')}.`
            : `Overdue by ${decision.minutesOverdue} min — escalated to ${f.target.replace('_', ' ')}.`,
        source: 'system',
      });
      await tx.emit({
        type: 'operations.task.escalated',
        propertyId,
        aggregate: { type: 'task', id: t.id },
        payload: {
          taskId: t.id,
          kind: t.kind,
          title: t.title,
          level: f.level,
          target: f.target,
          departmentKind: t.department_kind,
          departmentId: t.department_id,
          assigneeUserId: t.assignee_user_id,
          unitId: t.unit_id,
          stayId: t.stay_id,
          dueAt: iso(t.due_at),
          minutesOverdue: decision.minutesOverdue,
          reason: f.reason,
        },
      });
      escalated.push({
        taskId: t.id,
        level: f.level,
        target: f.target,
        minutesOverdue: decision.minutesOverdue,
      });
    }
    await tx.audit({
      action: 'operations.task.escalate',
      target: { type: 'task', id: t.id },
      propertyId,
      before: { level: t.escalation_level },
      after: { level: decision.level, targets: decision.fired.map((f) => f.target) },
    });
  }
  // OPS-R03: do-not-disturb held for too long becomes a welfare check for the duty manager (once per DND period).
  const settings = await loadSettings(d, tx, propertyId);
  const limit = new Date(tx.now.getTime() - settings.dndWelfareCheckHours * 3_600_000);
  const longDnd = await db(tx)
    .selectFrom('operations.unit_status')
    .select(['id', 'unit_number', 'dnd_since', 'occupancy_stay_id'])
    .where('property_id', '=', propertyId)
    .where('dnd', '=', true)
    .where('occupancy', '=', 'occupied') // a vacant unit has no guest to check on
    .where('dnd_since', '<=', limit)
    .execute();
  const welfareChecks: string[] = [];
  for (const u of longDnd) {
    const r = await insertTask(d, tx, {
      propertyId,
      kind: 'general',
      departmentKind: 'management',
      title: `Welfare check: do not disturb for over ${settings.dndWelfareCheckHours} h · ${u.unit_number}`,
      description: 'Do not disturb has been on for a long time. Check on the guest discreetly (policy).',
      priority: 'high',
      unitId: u.id,
      stayId: u.occupancy_stay_id,
      dueAt: new Date(tx.now.getTime() + settings.resolutionMinutes.high * 60_000),
      source: 'system',
      dedupeKey: `dnd_welfare:${u.id}:${new Date(u.dnd_since ?? tx.now).toISOString()}`,
    });
    if (r.created) welfareChecks.push(r.row.id);
  }
  return { escalated, welfareChecks };
}

// ───────────────────────────── Service requests ─────────────────────────────

function toServiceRequestView(sr: Selectable<ServiceRequestsTable>, task: TaskView): ServiceRequestView {
  return {
    id: sr.id,
    propertyId: sr.property_id,
    number: sr.number,
    channel: sr.channel as ServiceRequestChannel,
    category: sr.category,
    description: sr.description,
    stayId: sr.stay_id,
    guestProfileId: sr.guest_profile_id,
    unitId: sr.unit_id,
    requestedAt: new Date(sr.requested_at).toISOString(),
    fulfilledAt: iso(sr.fulfilled_at),
    task,
    version: sr.version,
    ...serviceRequestFacets(
      {
        status: sr.status,
        taskId: sr.task_id,
        stayId: sr.stay_id,
        guestProfileId: sr.guest_profile_id,
        unitId: sr.unit_id,
      },
      task,
    ),
  };
}

/**
 * Log a guest-originated request. It always creates a task with a responsible department, a due time and an
 * escalation path; the request is fulfilled only when that task is done (brief §8).
 */
export async function createServiceRequest(
  d: Deps,
  tx: TxContext,
  input: ServiceRequestInput,
): Promise<ServiceRequestView> {
  requirePermission(tx, 'operations.task.manage', { propertyId: input.propertyId });
  let unitId = input.unitId ?? null;
  if (!unitId && input.stayId) {
    const stay = await db(tx)
      .selectFrom('operations.stay_projection')
      .select('unit_id')
      .where('id', '=', input.stayId)
      .executeTakeFirst();
    unitId = stay?.unit_id ?? null;
  }
  if (unitId) assertSameProperty(await loadUnit(tx, unitId), input.propertyId, 'unit');
  const priority = (input.priority ?? 'normal') as TaskPriority;
  const { row: task } = await insertTask(d, tx, {
    propertyId: input.propertyId,
    kind: 'service_request',
    title: `${input.category}: ${input.description.slice(0, 120)}`,
    description: input.description,
    departmentKind: input.departmentKind ?? 'guest_services',
    priority,
    unitId,
    stayId: input.stayId ?? null,
    guestProfileId: input.guestProfileId ?? null,
    assigneeUserId: input.assigneeUserId ?? null,
    assigneeName: input.assigneeUserId
      ? await attendantName(tx, input.propertyId, input.assigneeUserId)
      : null,
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    source: 'service_request',
  });
  const id = newId(tx.now.getTime());
  const sr = await db(tx)
    .insertInto('operations.service_requests')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      number: newReferenceCode('SR'),
      task_id: task.id,
      stay_id: input.stayId ?? null,
      guest_profile_id: input.guestProfileId ?? null,
      unit_id: unitId,
      channel: input.channel,
      category: input.category,
      description: input.description,
      status: 'open',
      requested_at: tx.now,
      fulfilled_at: null,
      created_at: tx.now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'operations.serviceRequest.create',
    target: { type: 'service_request', id },
    propertyId: input.propertyId,
    after: { number: sr.number, category: input.category, channel: input.channel, taskId: task.id },
  });
  await tx.emit({
    type: 'operations.serviceRequest.created',
    propertyId: input.propertyId,
    aggregate: { type: 'service_request', id },
    payload: {
      serviceRequestId: id,
      number: sr.number,
      taskId: task.id,
      stayId: sr.stay_id,
      guestProfileId: sr.guest_profile_id,
      category: sr.category,
      departmentKind: task.department_kind,
      dueAt: iso(task.due_at),
    },
  });
  return toServiceRequestView(sr, await taskView(tx, task));
}

export async function getServiceRequest(_d: Deps, tx: TxContext, id: string): Promise<ServiceRequestView> {
  const sr = await db(tx)
    .selectFrom('operations.service_requests')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!sr) throw new NotFoundError('service_request', id);
  requireAny(tx, TASK_READ_PERMISSIONS, sr.property_id);
  return toServiceRequestView(sr, await taskView(tx, await loadTask(tx, sr.task_id)));
}

export async function listServiceRequests(
  _d: Deps,
  tx: TxContext,
  q: { propertyId: string; status?: string; stayId?: string },
): Promise<ServiceRequestView[]> {
  requireAny(tx, TASK_READ_PERMISSIONS, q.propertyId);
  let query = db(tx)
    .selectFrom('operations.service_requests')
    .selectAll()
    .where('property_id', '=', q.propertyId)
    .orderBy('requested_at', 'desc')
    .limit(500);
  if (q.status) query = query.where('status', '=', q.status);
  if (q.stayId) query = query.where('stay_id', '=', q.stayId);
  const rows = await query.execute();
  const out: ServiceRequestView[] = [];
  for (const sr of rows)
    out.push(toServiceRequestView(sr, await taskView(tx, await loadTask(tx, sr.task_id))));
  return out;
}

// ───────────────────────────── My work ─────────────────────────────

/**
 * Feed for the cross-module "My work" inbox: open tasks assigned to me, plus unassigned tasks queued for the
 * given departments — only at properties where I may see tasks. Uses the assignee and department-queue indexes.
 */
export async function listMyWork(
  _d: Deps,
  tx: TxContext,
  q: { propertyId?: string; departments?: string[]; limit: number },
): Promise<WorkItem[]> {
  const me = actorUserId(tx);
  const scopes = TASK_READ_PERMISSIONS.map((p) => tx.authz.propertyScope(p));
  const all = scopes.includes('all');
  const ids = all ? [] : [...new Set(scopes.flatMap((s) => (s === 'all' ? [] : [...s])))];
  if (!all && !ids.length) return [];
  if (q.propertyId && !all && !ids.includes(q.propertyId)) return [];
  let query = db(tx)
    .selectFrom('operations.tasks as t')
    .leftJoin('operations.unit_status as u', 'u.id', 't.unit_id')
    .selectAll('t')
    .select('u.unit_number')
    .where('t.status', 'in', [...OPEN_TASK_STATUSES])
    .where((eb) => {
      const mine = me ? [eb('t.assignee_user_id', '=', me)] : [];
      const queue = q.departments?.length
        ? [eb.and([eb('t.assignee_user_id', 'is', null), eb('t.department_kind', 'in', q.departments)])]
        : [];
      return eb.or([...mine, ...queue, ...(mine.length || queue.length ? [] : [eb.val(false)])]);
    })
    .orderBy('t.priority_score', 'desc')
    .orderBy(sql`t.due_at nulls last`)
    .limit(q.limit);
  if (q.propertyId) query = query.where('t.property_id', '=', q.propertyId);
  else if (!all) query = query.where('t.property_id', 'in', ids);
  const rows = await query.execute();
  return rows.map((r) => {
    const v = toTaskView(r, tx, r.unit_number ?? null);
    return {
      type: 'task' as const,
      id: v.id,
      propertyId: v.propertyId,
      title: v.unitNumber && !v.title.includes(v.unitNumber) ? `${v.title} · ${v.unitNumber}` : v.title,
      kind: v.kind,
      status: v.status,
      priority: v.priority,
      dueAt: v.dueAt,
      owner: v.owner ?? { kind: 'department', id: r.department_kind, name: r.department_kind },
      issues: v.issues,
      links: v.links,
    };
  });
}

// ───────────────────────────── Waiting guest ─────────────────────────────

/**
 * Provider for reservations / front desk: the arriving guest is here and waiting for the unit (or no longer
 * waiting). Re-prioritises the unit's cleaning/inspection to the top and tells housekeeping.
 */
export async function setGuestWaiting(
  d: Deps,
  tx: TxContext,
  input: { stayId: string; waiting: boolean },
): Promise<{ stayId: string; unitId: string | null; waitingSince: string | null }> {
  const stay = await db(tx)
    .selectFrom('operations.stay_projection')
    .selectAll()
    .where('id', '=', input.stayId)
    .forUpdate()
    .executeTakeFirst();
  if (!stay) throw new NotFoundError('stay', input.stayId);
  requireAny(tx, ['operations.task.manage', 'operations.housekeeping.assign'], stay.property_id);
  const since = input.waiting ? (stay.guest_waiting_since ?? tx.now) : null;
  await db(tx)
    .updateTable('operations.stay_projection')
    .set({ guest_waiting_since: since, updated_at: tx.now })
    .where('id', '=', stay.id)
    .execute();
  if (stay.unit_id) await rescoreUnitTasks(d, tx, stay.property_id, stay.unit_id);
  await tx.audit({
    action: input.waiting ? 'operations.arrival.guestWaiting' : 'operations.arrival.guestNoLongerWaiting',
    target: { type: 'stay', id: stay.id },
    propertyId: stay.property_id,
    after: { stayId: stay.id, waiting: input.waiting },
  });
  await tx.emit({
    type: 'operations.arrival.guestWaiting',
    propertyId: stay.property_id,
    aggregate: { type: 'stay', id: stay.id },
    payload: { stayId: stay.id, unitId: stay.unit_id, waiting: input.waiting, since: iso(since) },
  });
  return { stayId: stay.id, unitId: stay.unit_id, waitingSince: iso(since) };
}
