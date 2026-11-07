/**
 * Universal record contract for operations records (domain-map § Universal record contract): separate status
 * families, server-computed next actions with plain-language reasons when disabled, issues, owner and links.
 * Pure: permissions arrive as a `can(permission)` function evaluated for the record's property.
 */
import type { RecordAction, RecordIssue, RecordLink, RecordOwner } from '@portico/kernel';
import { label } from './conditions';
import type { EntityRef, TaskKind, TaskStatus } from './model';

export interface RecordFacets {
  status: Record<string, string>;
  allowedActions: RecordAction[];
  issues: RecordIssue[];
  owner?: RecordOwner;
  links: RecordLink[];
}

type Can = (permission: string) => boolean;

const act = (
  action: string,
  lbl: string,
  enabled: boolean,
  reason?: string,
  previewRequired?: boolean,
): RecordAction => ({
  action,
  label: lbl,
  enabled,
  ...(!enabled && reason ? { reason } : {}),
  ...(previewRequired ? { previewRequired } : {}),
});
const noPermission = 'You do not have permission for this. Ask a supervisor.';

// ───────────────────────────── Unit (housekeeping facet) ─────────────────────────────

export interface UnitFacts {
  unitId: string;
  unitNumber: string;
  condition: string;
  occupancy: string;
  occupancyStayId: string | null;
  discrepancy: string;
  dnd: boolean;
  turndown: string;
  ready: boolean;
  readinessReasons: Array<{ code: string; message: string }>;
  expectedReadyAt: string | null;
  block: { kind: string; to: string; workOrderId: string | null } | null;
  workOrder: { number: string; completed: boolean; returnToService: string } | null;
  pending: boolean;
  provenanceExternal: boolean;
  arrivalStayId: string | null;
  openTask: { assigneeUserId: string | null; assigneeName: string | null } | null;
  housekeepingDepartment: { id: string; name: string };
}

export function unitFacets(u: UnitFacts, can: Can): RecordFacets {
  const update = can('operations.housekeeping.update');
  const blocked = !!u.block;
  const issues: RecordIssue[] = [];
  if (u.condition === 'failed_inspection') {
    const r = u.readinessReasons.find((x) => x.code === 'failed_inspection');
    issues.push({
      code: 'failed_inspection',
      severity: 'blocking',
      message: r?.message ?? 'Unit failed inspection.',
    });
  }
  if (blocked && u.block)
    issues.push({
      code: u.block.kind,
      severity: 'blocking',
      message: `Unit is ${label(u.block.kind)} until ${u.block.to}${u.workOrder ? ` (work order ${u.workOrder.number})` : ''}.`,
    });
  if (u.discrepancy !== 'none')
    issues.push({
      code: `discrepancy_${u.discrepancy}`,
      severity: 'warning',
      message:
        u.discrepancy === 'skip'
          ? 'Housekeeping found the unit vacant but a guest is checked in (possible skip). Front office should verify.'
          : u.discrepancy === 'sleep'
            ? 'Housekeeping found the unit occupied but no guest is checked in (possible sleeper). Front office should verify.'
            : 'Guest checked in but no luggage found. Front office should verify.',
    });
  if (u.arrivalStayId && !u.ready && !blocked)
    issues.push({
      code: 'arrival_not_ready',
      severity: 'blocking',
      message: `An arriving guest is due and the unit is not ready${u.expectedReadyAt ? ` (estimated ready ${u.expectedReadyAt})` : ''}.`,
    });
  if (u.pending)
    issues.push({
      code: 'pending_external_confirmation',
      severity: 'info',
      message: 'A status change is waiting for confirmation from the external system of record.',
    });
  if (u.dnd) issues.push({ code: 'dnd', severity: 'info', message: 'Do not disturb is on.' });

  const canClean = u.condition === 'dirty' || u.condition === 'failed_inspection';
  const rts = u.workOrder;
  const actions: RecordAction[] = [
    act(
      'startCleaning',
      'Start cleaning',
      update && canClean && !blocked,
      !update
        ? noPermission
        : blocked
          ? 'The unit is blocked for maintenance.'
          : `The unit is ${label(u.condition)}.`,
    ),
    act(
      'markClean',
      'Mark clean',
      update && ['dirty', 'cleaning', 'failed_inspection'].includes(u.condition),
      !update ? noPermission : `The unit is already ${label(u.condition)}.`,
    ),
    act(
      'inspect',
      'Inspect',
      can('operations.housekeeping.inspect') && u.occupancy === 'vacant' && u.condition !== 'cleaning',
      !can('operations.housekeeping.inspect')
        ? noPermission
        : u.occupancy !== 'vacant'
          ? 'A guest is still in the unit.'
          : 'Cleaning is still in progress.',
    ),
    act(
      'markDirty',
      'Mark dirty',
      update && u.condition !== 'dirty',
      !update ? noPermission : 'The unit is already dirty.',
    ),
    act(
      u.dnd ? 'clearDnd' : 'setDnd',
      u.dnd ? 'Clear do not disturb' : 'Do not disturb',
      update,
      noPermission,
    ),
    act('reportOccupancy', 'Report occupancy / discrepancy', update, noPermission),
    act(
      'reportFault',
      'Report a fault',
      can('operations.maintenance.report') || can('operations.maintenance.manage'),
      noPermission,
    ),
    act(
      'takeOutOfOrder',
      'Take out of order',
      can('operations.maintenance.setInventoryImpact') && !blocked,
      !can('operations.maintenance.setInventoryImpact') ? noPermission : 'The unit is already blocked.',
      true,
    ),
    act(
      'returnToService',
      'Return to service',
      can('operations.maintenance.setInventoryImpact') && blocked && rts?.returnToService === 'ready',
      !can('operations.maintenance.setInventoryImpact')
        ? noPermission
        : !blocked
          ? 'The unit is not out of order or out of service.'
          : !rts
            ? 'The block was placed outside a work order; release it in inventory.'
            : !rts.completed
              ? `Work order ${rts.number} is still open.`
              : 'The unit needs a passed inspection after the repair.',
      true,
    ),
  ];
  const links: RecordLink[] = [{ rel: 'unit', type: 'unit', id: u.unitId, title: u.unitNumber }];
  if (u.occupancyStayId) links.push({ rel: 'currentStay', type: 'stay', id: u.occupancyStayId });
  if (u.arrivalStayId) links.push({ rel: 'arrivingStay', type: 'stay', id: u.arrivalStayId });
  if (u.block?.workOrderId)
    links.push({
      rel: 'workOrder',
      type: 'work_order',
      id: u.block.workOrderId,
      ...(rts ? { title: rts.number } : {}),
    });
  return {
    status: {
      condition: u.condition,
      occupancy: u.occupancy,
      readiness: u.ready ? 'ready' : 'not_ready',
      ...(u.block ? { maintenance: u.block.kind } : {}),
      ...(u.pending ? { sync: 'pending_external_confirmation' } : {}),
    },
    allowedActions: actions,
    issues,
    owner: u.openTask?.assigneeUserId
      ? {
          kind: 'user',
          id: u.openTask.assigneeUserId,
          ...(u.openTask.assigneeName ? { name: u.openTask.assigneeName } : {}),
        }
      : { kind: 'department', id: u.housekeepingDepartment.id, name: u.housekeepingDepartment.name },
    links,
  };
}

// ───────────────────────────── Task ─────────────────────────────

export interface TaskFacts {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  priority: string;
  title: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  departmentKind: string;
  departmentId: string | null;
  blockedReason: string | null;
  slaState: string;
  slaMinutes: number;
  escalationLevel: number;
  unitId: string | null;
  unitNumber: string | null;
  stayId: string | null;
  guestProfileId: string | null;
  parentTaskId: string | null;
  refs: EntityRef[];
  /** Records this task backs (service request / work order), when known. */
  backs?: { type: 'service_request' | 'work_order'; id: string; number: string } | null;
}

export function taskFacets(t: TaskFacts, can: Can, actorUserId: string | null): RecordFacets {
  const manage = can('operations.task.manage');
  const mine = !!actorUserId && t.assigneeUserId === actorUserId;
  const worker = manage || (can('operations.task.update') && (mine || !t.assigneeUserId));
  const open = t.status === 'open' || t.status === 'in_progress' || t.status === 'blocked';
  const workerReason =
    !can('operations.task.update') && !manage
      ? noPermission
      : `This task is assigned to ${t.assigneeName ?? 'someone else'}; only they or a supervisor can work on it.`;
  const special =
    t.kind === 'inspection'
      ? 'Record the inspection result (pass or fail) to complete this task.'
      : t.kind === 'work_order'
        ? 'Complete the work order with a resolution note to finish this task.'
        : null;
  const actions: RecordAction[] = [
    act(
      'start',
      'Start',
      worker && t.status === 'open',
      !worker ? workerReason : `The task is ${label(t.status)}.`,
    ),
    act(
      'complete',
      t.kind === 'service_request' ? 'Mark request done' : 'Complete',
      worker && !special && (t.status === 'open' || t.status === 'in_progress'),
      special ??
        (!worker
          ? workerReason
          : t.status === 'blocked'
            ? `Unblock the task first (${t.blockedReason ?? 'blocked'}).`
            : `The task is ${label(t.status)}.`),
    ),
    act(
      'block',
      'Block',
      worker && (t.status === 'open' || t.status === 'in_progress'),
      !worker ? workerReason : `The task is ${label(t.status)}.`,
    ),
    act(
      'unblock',
      'Unblock',
      worker && t.status === 'blocked',
      !worker ? workerReason : 'The task is not blocked.',
    ),
    act(
      'verify',
      'Verify',
      manage && t.status === 'done',
      !manage ? noPermission : 'Only finished tasks can be verified.',
    ),
    act(
      'reopen',
      'Reopen',
      manage && t.status === 'done',
      !manage ? noPermission : 'Only finished tasks can be reopened.',
    ),
    act(
      'assign',
      t.assigneeUserId ? 'Reassign' : 'Assign',
      open && (manage || can('operations.housekeeping.assign')),
      !open ? `The task is ${label(t.status)}.` : noPermission,
    ),
    act('cancel', 'Cancel', manage && open, !manage ? noPermission : `The task is ${label(t.status)}.`),
    act('comment', 'Comment', manage || can('operations.task.update'), noPermission),
  ];
  const issues: RecordIssue[] = [];
  if (open && t.slaState === 'overdue')
    issues.push({
      code: 'overdue',
      severity: t.escalationLevel > 0 ? 'blocking' : 'warning',
      message: `Overdue by ${t.slaMinutes} min${t.escalationLevel > 0 ? ` — escalated (level ${t.escalationLevel})` : ''}.`,
    });
  if (open && t.slaState === 'due_soon')
    issues.push({ code: 'due_soon', severity: 'info', message: `Due in ${t.slaMinutes} min.` });
  if (t.status === 'blocked')
    issues.push({
      code: 'blocked',
      severity: 'warning',
      message: `Blocked: ${t.blockedReason ?? 'no reason given'}.`,
    });
  if (open && !t.assigneeUserId)
    issues.push({ code: 'unassigned', severity: 'info', message: 'Nobody is assigned yet.' });
  const links: RecordLink[] = [];
  if (t.unitId)
    links.push({ rel: 'unit', type: 'unit', id: t.unitId, ...(t.unitNumber ? { title: t.unitNumber } : {}) });
  if (t.stayId) links.push({ rel: 'stay', type: 'stay', id: t.stayId });
  if (t.guestProfileId) links.push({ rel: 'guest', type: 'guest', id: t.guestProfileId });
  if (t.parentTaskId) links.push({ rel: 'parentTask', type: 'task', id: t.parentTaskId });
  if (t.backs)
    links.push({
      rel: t.backs.type === 'work_order' ? 'workOrder' : 'serviceRequest',
      type: t.backs.type,
      id: t.backs.id,
      title: t.backs.number,
    });
  for (const r of t.refs) {
    if (!links.some((l) => l.type === r.type && l.id === r.id))
      links.push({ rel: r.type, type: r.type, id: r.id });
  }
  return {
    status: { task: t.status, priority: t.priority, sla: t.slaState },
    allowedActions: actions,
    issues,
    owner: t.assigneeUserId
      ? { kind: 'user', id: t.assigneeUserId, ...(t.assigneeName ? { name: t.assigneeName } : {}) }
      : { kind: 'department', id: t.departmentId ?? t.departmentKind, name: label(t.departmentKind) },
    links,
  };
}

// ───────────────────────────── Work order ─────────────────────────────

export interface WorkOrderFacts {
  id: string;
  number: string;
  taskStatus: TaskStatus;
  completed: boolean;
  blockStatus: string;
  returnToService: string;
  authorityState: string;
  openResolutionItems: number;
  refusal: { message: string; nextStep: string } | null;
  releasedExternally: boolean;
  unitId: string | null;
  assetId: string | null;
  taskId: string;
  hasUnit: boolean;
}

export function workOrderFacets(w: WorkOrderFacts, task: RecordFacets, can: Can): RecordFacets {
  const manage = can('operations.maintenance.manage');
  const impact = can('operations.maintenance.setInventoryImpact');
  const open = !w.completed && w.taskStatus !== 'cancelled';
  const actions: RecordAction[] = [
    ...task.allowedActions.filter((a) =>
      ['start', 'block', 'unblock', 'assign', 'comment'].includes(a.action),
    ),
    act(
      'completeRepair',
      'Complete repair',
      manage && open,
      !manage
        ? noPermission
        : `Work order ${w.number} is already ${w.completed ? 'completed' : 'cancelled'}.`,
    ),
    act(
      'takeOutOfOrder',
      'Take unit out of order',
      impact && w.hasUnit && open && ['none', 'released', 'refused'].includes(w.blockStatus),
      !impact
        ? noPermission
        : !w.hasUnit
          ? 'This work order is not on a unit.'
          : !open
            ? 'The work order is closed.'
            : 'The unit is already blocked for this work order.',
      true,
    ),
    act(
      'returnToService',
      'Return to service',
      impact && w.blockStatus === 'active' && w.returnToService === 'ready',
      !impact
        ? noPermission
        : w.blockStatus !== 'active'
          ? 'The unit is not blocked by this work order.'
          : !w.completed
            ? `Work order ${w.number} is still open.`
            : 'The unit needs a passed inspection after the repair.',
      true,
    ),
    act('addParts', 'Add parts', manage, noPermission),
    act('addPhotos', 'Add photos', manage || can('operations.maintenance.report'), noPermission),
  ];
  const issues = [...task.issues];
  if (w.openResolutionItems > 0)
    issues.push({
      code: 'resolution_required',
      severity: 'blocking',
      message: `${w.openResolutionItems} affected stay${w.openResolutionItems === 1 ? '' : 's'} need front-office resolution.`,
      owner: { kind: 'department', id: 'front_office', name: 'front office' },
    });
  if (w.blockStatus === 'refused' && w.refusal)
    issues.push({
      code: 'block_refused',
      severity: 'blocking',
      message: `Out-of-order request refused: ${w.refusal.message} Next step: ${w.refusal.nextStep}`,
    });
  if (w.releasedExternally)
    issues.push({
      code: 'released_outside_return_to_service',
      severity: 'blocking',
      message:
        'The block was released in inventory before return to service: the repair and inspection were not confirmed. Check the unit now.',
    });
  if (w.authorityState === 'rejected')
    issues.push({
      code: 'rejected_by_system_of_record',
      severity: 'warning',
      message: 'The external maintenance system rejected this work order.',
    });
  if (w.returnToService === 'awaiting_inspection')
    issues.push({
      code: 'awaiting_inspection',
      severity: 'info',
      message: 'Repair done — waiting for cleaning and inspection before return to service.',
    });
  if (w.authorityState === 'pending_forward' || w.blockStatus === 'pending_forward')
    issues.push({
      code: 'pending_external_confirmation',
      severity: 'info',
      message: 'Waiting for the external maintenance system to confirm.',
    });
  const links: RecordLink[] = [
    { rel: 'task', type: 'task', id: w.taskId },
    ...task.links.filter((l) => l.rel !== 'workOrder'),
  ];
  if (w.assetId) links.push({ rel: 'asset', type: 'asset', id: w.assetId });
  return {
    status: {
      workOrder: w.completed ? 'completed' : w.taskStatus,
      maintenanceBlock: w.blockStatus,
      returnToService: w.returnToService,
      ...(w.authorityState === 'pending_forward' ? { sync: 'pending_external_confirmation' } : {}),
    },
    allowedActions: actions,
    issues,
    ...(task.owner ? { owner: task.owner } : {}),
    links,
  };
}

// ───────────────────────────── Service request ─────────────────────────────

export function serviceRequestFacets(
  sr: {
    status: string;
    taskId: string;
    stayId: string | null;
    guestProfileId: string | null;
    unitId: string | null;
  },
  task: RecordFacets,
): RecordFacets {
  const links: RecordLink[] = [{ rel: 'task', type: 'task', id: sr.taskId }];
  if (sr.stayId) links.push({ rel: 'stay', type: 'stay', id: sr.stayId });
  if (sr.guestProfileId) links.push({ rel: 'guest', type: 'guest', id: sr.guestProfileId });
  if (sr.unitId) links.push({ rel: 'unit', type: 'unit', id: sr.unitId });
  return {
    status: { serviceRequest: sr.status, task: task.status.task ?? 'open', sla: task.status.sla ?? 'none' },
    // A request is done only through its task (brief §8) — the request offers the task's actions.
    allowedActions: task.allowedActions,
    issues: task.issues,
    ...(task.owner ? { owner: task.owner } : {}),
    links,
  };
}

// ───────────────────────────── Lost & found ─────────────────────────────

export function lostFoundFacets(
  i: {
    status: string;
    retentionUntil: string;
    today: string;
    highValue: boolean;
    matchedStayId: string | null;
    matchedGuestProfileId: string | null;
    foundUnitId: string | null;
  },
  can: Can,
): RecordFacets {
  const manage = can('operations.lostFound.manage');
  const active = i.status === 'stored' || i.status === 'matched';
  const closed = `This item was already ${i.status}.`;
  const actions: RecordAction[] = [
    act('match', 'Match to guest', manage && active, !manage ? noPermission : closed),
    act('release', 'Release to owner', manage && active, !manage ? noPermission : closed, true),
    act('dispose', 'Dispose', manage && active, !manage ? noPermission : closed, true),
  ];
  const issues: RecordIssue[] = [];
  if (active && i.today >= i.retentionUntil)
    issues.push({
      code: 'retention_ended',
      severity: 'warning',
      message: `Retention period ended on ${i.retentionUntil}: release or dispose.`,
    });
  if (active && i.highValue)
    issues.push({ code: 'high_value', severity: 'info', message: 'High-value item: keep in the safe.' });
  const links: RecordLink[] = [];
  if (i.matchedStayId) links.push({ rel: 'stay', type: 'stay', id: i.matchedStayId });
  if (i.matchedGuestProfileId) links.push({ rel: 'guest', type: 'guest', id: i.matchedGuestProfileId });
  if (i.foundUnitId) links.push({ rel: 'foundIn', type: 'unit', id: i.foundUnitId });
  return {
    status: { lostFound: i.status },
    allowedActions: actions,
    issues,
    owner: { kind: 'department', id: 'housekeeping', name: 'housekeeping' },
    links,
  };
}
