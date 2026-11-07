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

/**
 * When a step fires: `afterMinutes` after the due time, or — for acknowledgement steps (`from: 'created'`) —
 * after the task was created. Null when the step's clock has no anchor (no due time).
 */
export function stepTime(
  step: EscalationStep,
  anchors: { dueAt: Date | null; createdAt: Date | null },
): Date | null {
  const base = step.from === 'created' ? anchors.createdAt : anchors.dueAt;
  return base ? new Date(base.getTime() + step.afterMinutes * MINUTE) : null;
}

export interface EscalationClock {
  dueAt: Date | null;
  createdAt: Date | null;
  /** Acknowledgement steps are skipped once someone started the task. */
  started: boolean;
}

/** Time of the next escalation after `currentLevel` steps, or null when the path is exhausted / unanchored. */
export function nextEscalationAt(
  clock: EscalationClock,
  path: readonly EscalationStep[],
  currentLevel: number,
): Date | null {
  for (let level = currentLevel; level < path.length; level++) {
    const step = path[level];
    if (!step) break;
    if (step.from === 'created' && clock.started) continue;
    return stepTime(step, clock);
  }
  return null;
}

export interface EscalationDecision {
  /** New escalation level (index of the next step to consider). */
  level: number;
  /** Steps that fire now (normally one; several if the scheduler was down and more are overdue). */
  fired: Array<{
    level: number;
    target: EscalationTarget;
    firesAt: Date;
    reason: 'not_acknowledged' | 'overdue';
  }>;
  next: Date | null;
  minutesOverdue: number;
}

/**
 * Decide which escalation steps are due at `now`. Returns null when nothing changes. Steps fire at most once;
 * acknowledgement steps of a task already started are passed over silently. The caller persists `level`/`next`.
 */
export function evaluateEscalation(
  input: EscalationClock & {
    now: Date;
    path: readonly EscalationStep[];
    currentLevel: number;
  },
): EscalationDecision | null {
  const { now, path } = input;
  const fired: EscalationDecision['fired'] = [];
  let level = input.currentLevel;
  while (level < path.length) {
    const step = path[level];
    if (!step) break;
    if (step.from === 'created' && input.started) {
      level++;
      continue;
    }
    const firesAt = stepTime(step, input);
    if (!firesAt || firesAt.getTime() > now.getTime()) break;
    level++;
    fired.push({
      level,
      target: step.target,
      firesAt,
      reason: step.from === 'created' ? 'not_acknowledged' : 'overdue',
    });
  }
  if (level === input.currentLevel) return null;
  return {
    level,
    fired,
    next: nextEscalationAt(input, path, level),
    minutesOverdue: input.dueAt
      ? Math.max(0, Math.floor((now.getTime() - input.dueAt.getTime()) / MINUTE))
      : 0,
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
