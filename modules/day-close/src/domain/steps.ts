/**
 * The Day Close run as a pure state machine (spec §4): ordered steps, the run's allowed transitions, where a resume
 * starts, what a step's progress says, and when a run may still be cancelled. No IO.
 */
import { BusinessRuleError } from '@portico/kernel';
import { type RunStatus, STEP_KEYS, type StepKey, type StepStatus } from '../contracts';

export const STEP_ORDER: readonly StepKey[] = STEP_KEYS;

export const STEP_LABELS: Record<StepKey, string> = {
  preflight: 'Readiness check',
  no_shows: 'No-shows',
  room_and_package_postings: 'Room postings',
  allowance_close: 'Allowance close',
  payments_housekeeping: 'Payments housekeeping',
  integrity: 'Books balance',
  statistics_snapshot: 'Day statistics',
  advance: 'Advance business date',
  post_advance: 'Day report and exports',
};

/** What a step counts (the noun of its progress line). */
const STEP_NOUN: Partial<Record<StepKey, string>> = {
  no_shows: 'arrivals',
  room_and_package_postings: 'stay-nights',
  allowance_close: 'stays',
};

export function stepOrdinal(key: StepKey): number {
  return STEP_ORDER.indexOf(key) + 1;
}

export interface StepState {
  key: StepKey;
  status: StepStatus;
}

/** Resume starts at the first step that is neither completed nor skipped (DCL-R03); null when all are done. */
export function firstIncompleteStep(steps: readonly StepState[]): StepKey | null {
  for (const key of STEP_ORDER) {
    const s = steps.find((x) => x.key === key);
    if (!s || (s.status !== 'completed' && s.status !== 'skipped')) return key;
  }
  return null;
}

const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  preflight: ['blocked', 'running', 'failed', 'cancelled', 'preflight'],
  blocked: ['preflight', 'cancelled', 'blocked'],
  running: ['running', 'failed', 'completed', 'blocked'],
  failed: ['running', 'preflight', 'failed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransition(from, to)) {
    throw new BusinessRuleError(
      'run_transition_not_allowed',
      `A ${from} Day Close run cannot become ${to}.`,
      { from, to },
    );
  }
}

/** Non-terminal statuses: at most one per property (DCL-I05). */
export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ['preflight', 'blocked', 'running', 'failed'];

export function isActive(status: RunStatus): boolean {
  return ACTIVE_RUN_STATUSES.includes(status);
}

/**
 * A run can be cancelled only while nothing was posted: every step after `preflight` is still pending and no
 * item of any step was done (spec §4: `scheduled|blocked → cancelled`, "nothing posted").
 */
export function cancellable(
  status: RunStatus,
  steps: readonly StepState[],
  doneItems: number,
): { ok: true } | { ok: false; reason: string } {
  if (!isActive(status)) return { ok: false, reason: `The run is ${status}.` };
  if (status === 'running')
    return { ok: false, reason: 'The run is working right now; wait until it stops.' };
  const started = steps.filter((s) => s.key !== 'preflight' && s.status !== 'pending');
  if (started.length > 0 || doneItems > 0) {
    return {
      ok: false,
      reason:
        'Day Close already made changes for this date (postings, no-shows or allowance closes). Resume it instead: every completed change is kept and nothing is repeated.',
    };
  }
  return { ok: true };
}

export interface ProgressInput {
  key: StepKey;
  status: StepStatus;
  total: number | null;
  done: number;
  failed: number;
  skipped: number;
}

/** "Room postings: 88 of 112 stay-nights posted, 24 remaining" — the line the run page shows per step. */
export function progressLine(p: ProgressInput): string {
  const label = STEP_LABELS[p.key];
  if (p.status === 'skipped') return `${label}: skipped`;
  const noun = STEP_NOUN[p.key];
  if (noun && p.total !== null) {
    const handled = p.done + p.skipped;
    const remaining = Math.max(0, p.total - handled);
    const verb = p.key === 'room_and_package_postings' ? 'posted' : 'done';
    const parts = [`${label}: ${p.done} of ${p.total} ${noun} ${verb}`];
    if (p.skipped > 0) parts.push(`${p.skipped} skipped`);
    if (p.failed > 0) parts.push(`${p.failed} failed`);
    if (p.status !== 'completed') parts.push(`${remaining} remaining`);
    return parts.join(', ');
  }
  const word: Record<StepStatus, string> = {
    pending: 'waiting',
    running: 'in progress',
    completed: 'done',
    failed: 'failed',
    skipped: 'skipped',
  };
  return `${label}: ${word[p.status]}`;
}

export function remaining(p: ProgressInput): number | null {
  if (p.total === null) return null;
  return Math.max(0, p.total - p.done - p.skipped);
}
