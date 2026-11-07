import type { EscalationTarget, TaskPriority } from './model';
import type { EscalationStep } from './settings';

/**
 * SLA timers and escalation (brief §8: every service request has a responsible team, status and escalation
 * path). The clock is the task's due time; each step fires `afterMinutes` after it. Pure: `now` is passed in.
 */

const MINUTE = 60_000;

/** Due time for a task without an explicit one: creation + the priority's resolution time. */
export function defaultDueAt(
  createdAt: Date,
  priority: TaskPriority,
  resolutionMinutes: Record<TaskPriority, number>,
) {
  return new Date(createdAt.getTime() + resolutionMinutes[priority] * MINUTE);
}

/** When the step at index `level` (0-based: the next step after `level` steps already fired) fires. */
export function stepTime(dueAt: Date, step: EscalationStep): Date {
  return new Date(dueAt.getTime() + step.afterMinutes * MINUTE);
}

/** Time of the next escalation after `currentLevel` steps have fired, or null when the path is exhausted. */
export function nextEscalationAt(
  dueAt: Date | null,
  path: readonly EscalationStep[],
  currentLevel: number,
): Date | null {
  if (!dueAt) return null;
  const step = path[currentLevel];
  return step ? stepTime(dueAt, step) : null;
}

export interface EscalationDecision {
  /** New escalation level (number of steps fired). */
  level: number;
  /** Steps that fire now (normally one; several if the scheduler was down and more are overdue). */
  fired: Array<{ level: number; target: EscalationTarget; dueAt: Date; firesAt: Date }>;
  next: Date | null;
  minutesOverdue: number;
}

/**
 * Decide which escalation steps are due at `now`. Returns null when nothing is due. Steps fire at most once;
 * the caller persists `level` and `next`.
 */
export function evaluateEscalation(input: {
  now: Date;
  dueAt: Date | null;
  path: readonly EscalationStep[];
  currentLevel: number;
}): EscalationDecision | null {
  const { now, dueAt, path } = input;
  if (!dueAt) return null;
  const fired: EscalationDecision['fired'] = [];
  let level = input.currentLevel;
  while (level < path.length) {
    const step = path[level];
    if (!step) break;
    const firesAt = stepTime(dueAt, step);
    if (firesAt.getTime() > now.getTime()) break;
    level++;
    fired.push({ level, target: step.target, dueAt, firesAt });
  }
  if (!fired.length) return null;
  return {
    level,
    fired,
    next: nextEscalationAt(dueAt, path, level),
    minutesOverdue: Math.max(0, Math.floor((now.getTime() - dueAt.getTime()) / MINUTE)),
  };
}

/** SLA state for display: on track / due soon / overdue, with minutes. */
export function slaState(
  now: Date,
  dueAt: Date | null,
  dueSoonMinutes = 15,
): { state: 'none' | 'on_track' | 'due_soon' | 'overdue'; minutes: number } {
  if (!dueAt) return { state: 'none', minutes: 0 };
  const diff = Math.round((dueAt.getTime() - now.getTime()) / MINUTE);
  if (diff < 0) return { state: 'overdue', minutes: -diff };
  if (diff <= dueSoonMinutes) return { state: 'due_soon', minutes: diff };
  return { state: 'on_track', minutes: diff };
}
