import { BusinessRuleError } from '@portico/kernel';
import { label } from './conditions';
import {
  CLEANING_KINDS,
  type DepartmentKind,
  OPEN_TASK_STATUSES,
  type ServiceRequestStatus,
  type TaskKind,
  type TaskPriority,
  type TaskStatus,
  type UnitCondition,
  type Urgency,
} from './model';

/**
 * Task lifecycle (glossary: Task). `done` means the work is finished; `verified` means a supervisor (or an
 * inspection) confirmed it. `open → done` is allowed so a quick action on a phone needs one tap.
 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  open: ['in_progress', 'blocked', 'done', 'cancelled'],
  in_progress: ['open', 'blocked', 'done', 'cancelled'],
  blocked: ['open', 'in_progress', 'cancelled'],
  done: ['verified', 'in_progress'],
  verified: [],
  cancelled: [],
};

export function isOpenStatus(s: TaskStatus): boolean {
  return OPEN_TASK_STATUSES.includes(s);
}

export function allowedTaskTransitions(from: TaskStatus): readonly TaskStatus[] {
  return TRANSITIONS[from];
}

export interface TransitionRequest {
  from: TaskStatus;
  to: TaskStatus;
  kind: TaskKind;
  reason?: string | null;
}

/** Validates a requested status change and explains what to do instead when it is not allowed. */
export function assertTaskTransition(req: TransitionRequest): void {
  const { from, to, kind } = req;
  if (from === to) {
    throw new BusinessRuleError('task_status_unchanged', `The task is already ${label(to)}.`, { from, to });
  }
  if (!TRANSITIONS[from].includes(to)) {
    const allowed = TRANSITIONS[from];
    throw new BusinessRuleError(
      'invalid_task_transition',
      allowed.length
        ? `A task that is ${label(from)} cannot become ${label(to)}. It can become: ${allowed.map(label).join(', ')}.`
        : `This task is ${label(from)} and can no longer change. Create a new task if more work is needed.`,
      { from, to, allowed },
    );
  }
  if (kind === 'inspection' && (to === 'done' || to === 'verified')) {
    throw new BusinessRuleError(
      'inspection_result_required',
      'An inspection task is completed by recording the inspection result (pass or fail with reasons), not by marking it done.',
      { kind, to },
    );
  }
  if (to === 'blocked' && !req.reason?.trim()) {
    throw new BusinessRuleError(
      'reason_required',
      'Say why the task is blocked (e.g. "guest in room", "waiting for part") so the owner knows what to clear.',
      { to },
    );
  }
  if (to === 'cancelled' && !req.reason?.trim()) {
    throw new BusinessRuleError('reason_required', 'Give a reason for cancelling the task.', { to });
  }
  if (from === 'done' && to === 'in_progress' && !req.reason?.trim()) {
    throw new BusinessRuleError(
      'reason_required',
      'Say why the finished task is being reopened (what was not done) so the assignee knows what to fix.',
      { from, to },
    );
  }
}

/**
 * Unit condition implied by a cleaning (or stayover service) task's status change, given the unit's current
 * condition. Never downgrades an inspected unit and never overrides a newer inspection result.
 */
export function conditionEffect(
  kind: TaskKind,
  to: TaskStatus,
  current: UnitCondition,
): UnitCondition | null {
  if (!CLEANING_KINDS.includes(kind) && kind !== 'stayover') return null;
  if (to === 'in_progress' && (current === 'dirty' || current === 'failed_inspection')) return 'cleaning';
  if (to === 'done' && (current === 'dirty' || current === 'cleaning' || current === 'failed_inspection'))
    return 'clean';
  return null;
}

/** A service request's status mirrors its task: it is fulfilled only when the task is done (brief §8). */
export function serviceRequestStatusFor(task: TaskStatus): ServiceRequestStatus {
  switch (task) {
    case 'open':
    case 'blocked':
      return 'open';
    case 'in_progress':
      return 'in_progress';
    case 'done':
    case 'verified':
      return 'fulfilled';
    case 'cancelled':
      return 'cancelled';
  }
}

export function defaultDepartmentFor(kind: TaskKind): DepartmentKind {
  switch (kind) {
    case 'work_order':
      return 'engineering';
    case 'service_request':
      return 'guest_services';
    case 'guest_commitment':
      return 'front_office';
    case 'general':
      return 'front_office';
    default:
      return 'housekeeping';
  }
}

export function priorityForUrgency(u: Urgency): TaskPriority {
  return u === 'emergency' ? 'urgent' : u;
}

export const PRIORITY_RANK: Record<TaskPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

/**
 * Who may perform a transition. Staff with `task.update` work on tasks assigned to them (and may claim an
 * unassigned task by starting or completing it); `task.manage` (supervisors, managers) may act on any task, and
 * verifying or cancelling always needs `task.manage`.
 */
export function transitionPermissionNeeded(
  to: TaskStatus,
  relation: 'assignee' | 'unassigned' | 'other',
): 'operations.task.update' | 'operations.task.manage' {
  if (to === 'verified' || to === 'cancelled') return 'operations.task.manage';
  if (relation === 'assignee') return 'operations.task.update';
  if (relation === 'unassigned' && (to === 'in_progress' || to === 'done')) return 'operations.task.update';
  return 'operations.task.manage';
}
