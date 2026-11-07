import { BusinessRuleError, type LocalDate } from '@portico/kernel';
import type {
  BlockKind,
  Discrepancy,
  ObservedOccupancy,
  Occupancy,
  TaskKind,
  TaskStatus,
  UnitCondition,
} from './model';

/**
 * Condition changes staff may make directly (mobile quick actions / board). `inspected` and
 * `failed_inspection` are reached ONLY by recording an inspection, so the inspected state always has a
 * checklist record behind it.
 */
const MANUAL_TRANSITIONS: Record<UnitCondition, readonly UnitCondition[]> = {
  dirty: ['cleaning', 'clean'],
  cleaning: ['clean', 'dirty'],
  clean: ['dirty', 'cleaning'],
  inspected: ['dirty', 'cleaning'],
  failed_inspection: ['cleaning', 'clean', 'dirty'],
};

export function allowedManualConditions(from: UnitCondition): readonly UnitCondition[] {
  return MANUAL_TRANSITIONS[from];
}

export function assertManualConditionChange(from: UnitCondition, to: UnitCondition): void {
  if (to === 'inspected' || to === 'failed_inspection') {
    throw new BusinessRuleError(
      'inspection_required',
      'A unit becomes inspected (or fails inspection) only by recording an inspection. Open the inspection checklist for this unit instead.',
      { from, to },
    );
  }
  if (from === to) {
    throw new BusinessRuleError(
      'condition_unchanged',
      `The unit is already ${label(to)}. Nothing was changed.`,
      {
        from,
        to,
      },
    );
  }
  if (!MANUAL_TRANSITIONS[from].includes(to)) {
    throw new BusinessRuleError(
      'invalid_condition_change',
      `A unit cannot go from ${label(from)} to ${label(to)} directly. Allowed next conditions: ${MANUAL_TRANSITIONS[
        from
      ]
        .map(label)
        .join(', ')}.`,
      { from, to, allowed: MANUAL_TRANSITIONS[from] },
    );
  }
}

export function label(c: string): string {
  return c.replace(/_/g, ' ');
}

/** Compare system occupancy (from stays) with what housekeeping observed. Never auto-corrects either side. */
export function deriveDiscrepancy(system: Occupancy, observed: ObservedOccupancy | null): Discrepancy {
  if (!observed) return 'none';
  if (system === 'occupied' && observed === 'vacant') return 'skip';
  if (system === 'vacant' && observed !== 'vacant') return 'sleep';
  if (system === 'occupied' && observed === 'occupied_no_luggage') return 'occupied_no_luggage';
  return 'none';
}

// ───────────────────────────── Readiness ─────────────────────────────

export type ReadinessReasonCode =
  | 'out_of_order'
  | 'out_of_service'
  | 'house_use'
  | 'reported_occupied'
  | 'occupied'
  | 'dirty'
  | 'cleaning_in_progress'
  | 'awaiting_inspection'
  | 'failed_inspection'
  | 'pending_external_confirmation';

export interface ReadinessReason {
  code: ReadinessReasonCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface OpenUnitTask {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  credits: number;
  startedAt: Date | null;
  assigneeName: string | null;
  /** Credits of the assignee's other open work that is ahead of this task in their queue. */
  queueAheadCredits: number;
}

export interface ReadinessInput {
  now: Date;
  /** The business date for which readiness is assessed (blocks are night ranges). */
  date: LocalDate;
  condition: UnitCondition;
  occupancy: Occupancy;
  /** Housekeeping-reported discrepancy (a `sleep` makes a vacant unit not ready). */
  discrepancy?: Discrepancy;
  block: { kind: BlockKind | 'house_use'; from: LocalDate; to: LocalDate; reason: string | null } | null;
  pendingChange: { condition?: UnitCondition } | null;
  lastFailure: { reasons: string[]; inspectedAt: Date } | null;
  requiredCondition: 'clean' | 'inspected';
  openTasks: readonly OpenUnitTask[];
  minutesPerCredit: number;
  inspectionMinutes: number;
}

export interface ReadinessAssessment {
  ready: boolean;
  reasons: ReadinessReason[];
  /** Estimate (never a promise) of when the unit will meet the required condition; null when unknown. */
  expectedReadyAt: Date | null;
  /** Human-readable explanation of how the estimate was computed. */
  estimateBasis: string[];
}

const CLEANING: readonly TaskKind[] = ['departure_clean', 'vacant_clean', 'reclean', 'deep_clean'];

function blockActive(block: ReadinessInput['block'], date: LocalDate): boolean {
  return !!block && block.from <= date && date < block.to;
}

export function meetsRequired(condition: UnitCondition, required: 'clean' | 'inspected'): boolean {
  return required === 'clean'
    ? condition === 'clean' || condition === 'inspected'
    : condition === 'inspected';
}

/**
 * Is the unit ready for an arriving guest, and if not: why, and when do we expect it to be? Pure function of
 * the unit's facts, its open housekeeping tasks and the property's settings.
 */
export function assessReadiness(input: ReadinessInput): ReadinessAssessment {
  const reasons: ReadinessReason[] = [];
  const basis: string[] = [];
  const blocked = blockActive(input.block, input.date);
  if (blocked && input.block) {
    const code: ReadinessReasonCode = input.block.kind;
    reasons.push({
      code,
      message: `Unit is ${label(input.block.kind)} until ${input.block.to}${input.block.reason ? ` (${input.block.reason})` : ''}.`,
      details: { from: input.block.from, to: input.block.to },
    });
  }
  if (input.occupancy === 'occupied') {
    reasons.push({ code: 'occupied', message: 'The previous guest is still in the unit.' });
  } else if (input.discrepancy === 'sleep') {
    // Physically vacant is required (OPS-R04): housekeeping found someone using the unit.
    reasons.push({
      code: 'reported_occupied',
      message:
        'Housekeeping found the unit in use although no guest is checked in. Front office must check it first.',
    });
  }
  const conditionOk = meetsRequired(input.condition, input.requiredCondition);
  if (!conditionOk) {
    switch (input.condition) {
      case 'dirty':
        reasons.push({ code: 'dirty', message: 'Unit is dirty and has not been cleaned yet.' });
        break;
      case 'cleaning':
        reasons.push({ code: 'cleaning_in_progress', message: 'Cleaning is in progress.' });
        break;
      case 'clean':
        reasons.push({ code: 'awaiting_inspection', message: 'Unit is clean and waiting for inspection.' });
        break;
      case 'failed_inspection':
        reasons.push({
          code: 'failed_inspection',
          message: `Unit failed inspection${
            input.lastFailure?.reasons.length ? `: ${input.lastFailure.reasons.join('; ')}` : ''
          }. Re-cleaning is required.`,
          details: input.lastFailure
            ? { reasons: input.lastFailure.reasons, inspectedAt: input.lastFailure.inspectedAt.toISOString() }
            : {},
        });
        break;
      case 'inspected':
        break;
    }
  }
  if (input.pendingChange) {
    reasons.push({
      code: 'pending_external_confirmation',
      message: 'A room-status change is waiting for confirmation from the external system of record.',
      details: { pendingChange: input.pendingChange },
    });
  }
  // A pending forwarded change alone does not make a unit "not ready": the effective condition decides.
  const ready = reasons.every((r) => r.code === 'pending_external_confirmation');
  if (ready) return { ready: true, reasons, expectedReadyAt: null, estimateBasis: [] };

  if (blocked || input.occupancy === 'occupied' || input.discrepancy === 'sleep') {
    basis.push(
      blocked
        ? 'No estimate: the unit is blocked for maintenance; readiness depends on the work order and return to service.'
        : input.occupancy === 'occupied'
          ? 'No estimate: the unit is still occupied; readiness depends on the guest departing.'
          : 'No estimate: the front office must resolve the occupancy discrepancy first.',
    );
    return { ready, reasons, expectedReadyAt: null, estimateBasis: basis };
  }

  const mpc = input.minutesPerCredit;
  let minutes = 0;
  const needsCleaning = input.condition !== 'clean' && input.condition !== 'inspected';
  if (needsCleaning) {
    const task = pickCleaningTask(input.openTasks);
    if (!task) {
      basis.push('No estimate: no cleaning task is scheduled for this unit yet.');
      return { ready, reasons, expectedReadyAt: null, estimateBasis: basis };
    }
    const workMinutes = task.credits * mpc;
    if (task.status === 'in_progress' && task.startedAt) {
      const elapsed = Math.max(0, (input.now.getTime() - task.startedAt.getTime()) / 60_000);
      const remaining = Math.max(Math.ceil(workMinutes - elapsed), Math.min(5, workMinutes));
      minutes += remaining;
      basis.push(
        `Cleaning in progress${task.assigneeName ? ` by ${task.assigneeName}` : ''}: about ${remaining} min left of ${workMinutes} min (${task.credits} credits × ${mpc} min).`,
      );
    } else {
      const queue = task.queueAheadCredits * mpc;
      minutes += queue + workMinutes;
      basis.push(
        task.assigneeName
          ? `${task.assigneeName} has ${task.queueAheadCredits} credits of higher-priority work first (${queue} min), then this cleaning: ${workMinutes} min.`
          : `Cleaning not yet assigned: ${workMinutes} min once an attendant starts (${task.credits} credits × ${mpc} min).`,
      );
      if (task.status === 'blocked')
        basis.push('The cleaning task is currently blocked — the estimate may slip.');
    }
  }
  if (input.requiredCondition === 'inspected' && input.condition !== 'inspected') {
    minutes += input.inspectionMinutes;
    basis.push(`Inspection: ${input.inspectionMinutes} min.`);
  }
  return {
    ready,
    reasons,
    expectedReadyAt: new Date(input.now.getTime() + minutes * 60_000),
    estimateBasis: basis,
  };
}

function pickCleaningTask(tasks: readonly OpenUnitTask[]): OpenUnitTask | undefined {
  const cleaning = tasks.filter((t) => CLEANING.includes(t.kind));
  // Prefer the task already being worked on, then a reclean (it supersedes the original clean).
  return (
    cleaning.find((t) => t.status === 'in_progress') ??
    cleaning.find((t) => t.kind === 'reclean') ??
    cleaning[0]
  );
}
