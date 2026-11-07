import { pgCode, type Selectable, sql, type TxContext, typed } from '@portico/db';
import {
  actorId,
  actorLabel,
  ForbiddenError,
  type LocalDate,
  newId,
  requirePermission,
} from '@portico/kernel';
import type { attachment, Readiness, TaskView, UnitStatusView } from '../contracts';
import { slaState } from '../domain/escalation';
import type { EntityRef, TaskKind, TaskPriority, TaskStatus } from '../domain/model';
import { taskFacets, unitFacets } from '../domain/records';
import { defaultsForProfile, mergeSettings, type OperationsSettings } from '../domain/settings';
import type { OperationsPorts } from '../ports';
import type { OperationsDB, TasksTable, UnitStatusTable } from '../tables';

export const db = (tx: TxContext) => typed<OperationsDB>(tx.db);

export interface Deps {
  ports: OperationsPorts;
}

export const SETTINGS_POLICY_KEY = 'operations.settings';
/** Reservations' policy (spec RES-R24 / OPS-R04): condition required to check a guest in. */
export const CHECK_IN_CONDITION_POLICY_KEY = 'reservations.checkIn.requiredCondition';

// Per-transaction caches (a TxContext lives for exactly one transaction).
const settingsCache = new WeakMap<TxContext, Map<string, OperationsSettings>>();
const propertyCache = new WeakMap<
  TxContext,
  Map<string, { timezone: string; businessDate: LocalDate; checkInTime: string; profile: string }>
>();

export async function loadSettings(d: Deps, tx: TxContext, propertyId: string): Promise<OperationsSettings> {
  let m = settingsCache.get(tx);
  if (!m) {
    m = new Map();
    settingsCache.set(tx, m);
  }
  const hit = m.get(propertyId);
  if (hit) return hit;
  const raw = await d.ports.platform.resolvePolicy(tx, propertyId, SETTINGS_POLICY_KEY);
  const facts = await propertyFacts(d, tx, propertyId);
  const s = mergeSettings(raw, defaultsForProfile(facts.profile));
  // One concept, one policy: when reservations' check-in requirement is configured it decides readiness too, so
  // the board never says "ready" while check-in refuses (or the reverse).
  const checkIn = await d.ports.platform.resolvePolicy(tx, propertyId, CHECK_IN_CONDITION_POLICY_KEY);
  if (checkIn === 'clean' || checkIn === 'inspected') s.readinessCondition = checkIn;
  m.set(propertyId, s);
  return s;
}

export async function propertyFacts(d: Deps, tx: TxContext, propertyId: string) {
  let m = propertyCache.get(tx);
  if (!m) {
    m = new Map();
    propertyCache.set(tx, m);
  }
  const hit = m.get(propertyId);
  if (hit) return hit;
  const p = await d.ports.platform.getProperty(tx, propertyId);
  const facts = {
    timezone: p.timezone,
    businessDate: p.businessDate,
    checkInTime: p.checkInTime,
    profile: p.profile,
  };
  m.set(propertyId, facts);
  return facts;
}

/**
 * Change-feed stamp: the writing transaction's id. Delta pulls return rows stamped at or after the reader's
 * previous snapshot xmin, so no committed change is ever skipped (see service/sync.ts).
 */
export function feedMark() {
  return sql<string>`pg_current_xact_id()`;
}

export function actorKey(tx: TxContext): string {
  return `${tx.actor.kind}:${actorId(tx.actor)}`;
}

export function actorName(tx: TxContext): string {
  return actorLabel(tx.actor);
}

export function actorUserId(tx: TxContext): string | null {
  return tx.actor.kind === 'user' ? tx.actor.userId : null;
}

/** Deny unless the actor holds at least one of the permissions for the property. */
export function requireAny(tx: TxContext, permissions: readonly string[], propertyId: string): void {
  if (permissions.some((p) => tx.authz.can(p, { propertyId }))) return;
  const first = permissions[0];
  if (first) requirePermission(tx, first, { propertyId });
  throw new ForbiddenError(permissions.join(' | '), { propertyId });
}

export const UNIT_READ_PERMISSIONS = ['operations.unit.read', 'operations.housekeeping.read'] as const;

export const TASK_READ_PERMISSIONS = [
  'operations.task.read',
  'operations.task.update',
  'operations.task.manage',
] as const;

export const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

// ───────────────────────────── Mappers ─────────────────────────────

export type UnitRow = Selectable<UnitStatusTable>;
export type TaskRow = Selectable<TasksTable>;

function emptyReadiness(now: Date): Readiness {
  return {
    ready: false,
    requiredCondition: 'inspected',
    reasons: [],
    readyAt: null,
    expectedReadyAt: null,
    estimateBasis: [],
    assessedAt: now.toISOString(),
  };
}

function pendingRequestedAt(change: unknown): string | null {
  const v = (change as { requestedAt?: unknown } | null)?.requestedAt;
  return typeof v === 'string' ? v : null;
}

export type ViewCtx = Pick<TxContext, 'now' | 'authz' | 'actor'>;

/** Permission check bound to a record's property (for allowedActions). */
export function canFor(ctx: Pick<TxContext, 'authz'>, propertyId: string) {
  return (permission: string) => ctx.authz.can(permission, { propertyId });
}

export interface UnitViewExtras {
  sectionName?: string | null;
  readiness?: Readiness;
  arrivalStayId?: string | null;
  openTask?: { assigneeUserId: string | null; assigneeName: string | null } | null;
  workOrder?: { number: string; completed: boolean; returnToService: string } | null;
}

export function toUnitView(row: UnitRow, ctx: ViewCtx, opts: UnitViewExtras = {}) {
  const stored = row.readiness as Partial<Readiness> | null;
  const readiness: Readiness =
    opts.readiness ??
    (stored && typeof stored.ready === 'boolean'
      ? (stored as Readiness)
      : emptyReadiness(new Date(row.updated_at)));
  const view: UnitStatusView = {
    unitId: row.id,
    propertyId: row.property_id,
    unitNumber: row.unit_number,
    unitTypeId: row.unit_type_id,
    unitTypeCode: row.unit_type_code,
    sectionId: row.section_id,
    sectionName: opts.sectionName ?? null,
    floor: row.floor,
    features: row.features ?? [],
    condition: row.condition as UnitStatusView['condition'],
    conditionChangedAt: new Date(row.condition_changed_at).toISOString(),
    occupancy: row.occupancy as UnitStatusView['occupancy'],
    occupancyStayId: row.occupancy_stay_id,
    observedOccupancy: row.observed_occupancy as UnitStatusView['observedOccupancy'],
    observedAt: iso(row.observed_at),
    discrepancy: row.discrepancy as UnitStatusView['discrepancy'],
    dnd: row.dnd,
    dndSince: iso(row.dnd_since),
    turndown: row.turndown as UnitStatusView['turndown'],
    lastCleanedAt: iso(row.last_cleaned_at),
    lastInspectedAt: iso(row.last_inspected_at),
    lastInspectionResult: row.last_inspection_result as UnitStatusView['lastInspectionResult'],
    block:
      row.block_kind && row.block_from && row.block_to
        ? {
            kind: row.block_kind as 'out_of_order' | 'out_of_service' | 'house_use',
            blockId: row.block_id,
            from: row.block_from,
            to: row.block_to,
            reason: row.block_reason,
            workOrderId: row.block_work_order_id,
          }
        : null,
    readiness,
    pendingChange: row.pending_forward_id
      ? {
          forwardId: row.pending_forward_id,
          change: (row.pending_change ?? {}) as Record<string, unknown>,
          requestedAt: pendingRequestedAt(row.pending_change),
        }
      : null,
    provenance: row.provenance as UnitStatusView['provenance'],
    externalSyncedAt: iso(row.external_synced_at),
    version: row.version,
    ...unitFacets(
      {
        unitId: row.id,
        unitNumber: row.unit_number,
        condition: row.condition,
        occupancy: row.occupancy,
        occupancyStayId: row.occupancy_stay_id,
        discrepancy: row.discrepancy,
        dnd: row.dnd,
        turndown: row.turndown,
        ready: readiness.ready,
        readinessReasons: readiness.reasons,
        expectedReadyAt: readiness.expectedReadyAt,
        block:
          row.block_kind && row.block_to
            ? { kind: row.block_kind, to: row.block_to, workOrderId: row.block_work_order_id }
            : null,
        workOrder: opts.workOrder ?? null,
        pending: row.pending_forward_id !== null,
        provenanceExternal: row.provenance === 'external',
        arrivalStayId: opts.arrivalStayId ?? null,
        openTask: opts.openTask ?? null,
        housekeepingDepartment: { id: 'housekeeping', name: 'housekeeping' },
      },
      canFor(ctx, row.property_id),
    ),
  };
  return view;
}

export function toTaskView(
  row: TaskRow,
  ctx: ViewCtx,
  unitNumber: string | null = null,
  backs: { type: 'service_request' | 'work_order'; id: string; number: string } | null = null,
): TaskView {
  const now = ctx.now;
  const open = row.status === 'open' || row.status === 'in_progress' || row.status === 'blocked';
  const sla = open
    ? slaState(now, row.due_at ? new Date(row.due_at) : null)
    : { state: 'none' as const, minutes: 0 };
  const refs = (row.refs ?? []) as EntityRef[];
  return {
    id: row.id,
    propertyId: row.property_id,
    departmentKind: row.department_kind,
    departmentId: row.department_id,
    kind: row.kind as TaskKind,
    title: row.title,
    description: row.description,
    priority: row.priority as TaskPriority,
    priorityScore: row.priority_score,
    priorityReasons: row.priority_reasons ?? [],
    unitId: row.unit_id,
    unitNumber,
    stayId: row.stay_id,
    guestProfileId: row.guest_profile_id,
    parentTaskId: row.parent_task_id,
    refs,
    assigneeUserId: row.assignee_user_id,
    assigneeName: row.assignee_name,
    serviceDate: row.service_date,
    dueAt: iso(row.due_at),
    sla,
    credits: row.credits,
    blockedReason: row.blocked_reason,
    cancelledReason: row.cancelled_reason,
    startedAt: iso(row.started_at),
    doneAt: iso(row.done_at),
    verifiedAt: iso(row.verified_at),
    escalationLevel: row.escalation_level,
    escalationPath: (row.escalation_path ?? []) as TaskView['escalationPath'],
    nextEscalationAt: iso(row.next_escalation_at),
    source: row.source,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    version: row.version,
    ...taskFacets(
      {
        id: row.id,
        kind: row.kind as TaskKind,
        status: row.status as TaskStatus,
        priority: row.priority,
        title: row.title,
        assigneeUserId: row.assignee_user_id,
        assigneeName: row.assignee_name,
        departmentKind: row.department_kind,
        departmentId: row.department_id,
        blockedReason: row.blocked_reason,
        slaState: sla.state,
        slaMinutes: sla.minutes,
        escalationLevel: row.escalation_level,
        unitId: row.unit_id,
        unitNumber,
        stayId: row.stay_id,
        guestProfileId: row.guest_profile_id,
        parentTaskId: row.parent_task_id,
        refs,
        backs,
      },
      canFor(ctx, row.property_id),
      ctx.actor.kind === 'user' ? ctx.actor.userId : null,
    ),
  };
}

export type Attachment = typeof attachment._output;

/** Append a task history row (append-only table). */
export async function logTask(
  tx: TxContext,
  task: { id: string; property_id: string; version: number },
  entry: {
    kind: string;
    from?: string | null;
    to?: string | null;
    comment?: string | null;
    attachments?: Attachment[] | null;
    source: string;
    clientOccurredAt?: Date | null;
  },
): Promise<void> {
  await db(tx)
    .insertInto('operations.task_activity')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      property_id: task.property_id,
      task_id: task.id,
      kind: entry.kind,
      from_value: entry.from ?? null,
      to_value: entry.to ?? null,
      comment: entry.comment ?? null,
      attachments: entry.attachments ? JSON.stringify(entry.attachments) : null,
      task_version: task.version,
      source: entry.source,
      actor: JSON.stringify(tx.actor),
      actor_key: actorKey(tx),
      occurred_at: tx.now,
      client_occurred_at: entry.clientOccurredAt ?? null,
    })
    .execute();
}

export async function logUnit(
  tx: TxContext,
  unit: { id: string; property_id: string },
  entry: {
    field: string;
    from: string | null;
    to: string | null;
    reason?: string | null;
    source: string;
    versionAfter: number;
    clientOccurredAt?: Date | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db(tx)
    .insertInto('operations.unit_status_log')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      property_id: unit.property_id,
      unit_id: unit.id,
      field: entry.field,
      from_value: entry.from,
      to_value: entry.to,
      reason: entry.reason ?? null,
      source: entry.source,
      version_after: entry.versionAfter,
      actor: JSON.stringify(tx.actor),
      actor_key: actorKey(tx),
      occurred_at: tx.now,
      client_occurred_at: entry.clientOccurredAt ?? null,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    })
    .execute();
}

export function pgUniqueViolation(err: unknown): boolean {
  return pgCode(err) === '23505';
}
