/**
 * The connection setup journey (adoption brief §7) as a state machine.
 *
 *   1 select → 2 review compatibility → 3 authorize → 4 review suggested mappings → 5 resolve issues →
 *   6 validate → 7 preview → 8 activate → 9 monitor
 *
 * States record the last COMPLETED step, so progress is preserved: a connection in `authorized` has finished
 * steps 1–3 and is working on step 4. Lifecycle states (`paused`, `disconnected`, `error`) sit beside the journey.
 * Pure logic — no IO.
 */
import type { ConnectionState } from '../contracts';

export interface StepDefinition {
  step: number;
  key: string;
  title: string;
  /** State reached when this step is completed. */
  completes: ConnectionState;
}

export const SETUP_STEPS: readonly StepDefinition[] = [
  { step: 1, key: 'select', title: 'Select the existing system', completes: 'selected' },
  {
    step: 2,
    key: 'compatibility',
    title: 'Review compatibility, permissions, prerequisites and charges',
    completes: 'compatibility_reviewed',
  },
  { step: 3, key: 'authorize', title: 'Authorize access', completes: 'authorized' },
  { step: 4, key: 'mappings', title: 'Review suggested mappings', completes: 'mappings_suggested' },
  { step: 5, key: 'issues', title: 'Resolve flagged issues', completes: 'issues_resolved' },
  { step: 6, key: 'validate', title: 'Run validation', completes: 'validated' },
  { step: 7, key: 'preview', title: 'Preview expected behavior', completes: 'previewed' },
  { step: 8, key: 'activate', title: 'Activate the approved scope', completes: 'active' },
  { step: 9, key: 'monitor', title: 'Monitor connection health', completes: 'monitoring' },
];

const SETUP_ORDER: readonly ConnectionState[] = SETUP_STEPS.map((s) => s.completes);

/** Number of the last completed step for a journey state; lifecycle states return null. */
export function completedStep(state: ConnectionState): number | null {
  const i = SETUP_ORDER.indexOf(state);
  return i === -1 ? null : i + 1;
}

export function isOperational(state: ConnectionState): boolean {
  return state === 'active' || state === 'monitoring';
}

export function isSetupState(state: ConnectionState): boolean {
  const n = completedStep(state);
  return n !== null && n <= 7;
}

export type JourneyAction =
  | 'reviewCompatibility'
  | 'authorize'
  | 'suggestMappings'
  | 'resolveIssues'
  | 'validate'
  | 'preview'
  | 'activate'
  | 'confirmMonitoring'
  | 'reopen'
  | 'pause'
  | 'resume'
  | 'fail'
  | 'recover'
  | 'disconnect';

/**
 * Allowed source states per action. Setup steps may be REPEATED from any later setup state (re-authorize,
 * re-suggest, re-validate) — repeating a step invalidates the steps after it, which the caller enforces by
 * moving the state back to the step's completion state.
 */
const ALLOWED_FROM: Record<JourneyAction, readonly ConnectionState[]> = {
  reviewCompatibility: [
    'selected',
    'compatibility_reviewed',
    'authorized',
    'mappings_suggested',
    'issues_resolved',
    'validated',
    'previewed',
  ],
  authorize: [
    'compatibility_reviewed',
    'authorized',
    'mappings_suggested',
    'issues_resolved',
    'validated',
    'previewed',
  ],
  suggestMappings: ['authorized', 'mappings_suggested', 'issues_resolved', 'validated', 'previewed'],
  resolveIssues: ['mappings_suggested', 'issues_resolved', 'validated', 'previewed'],
  validate: ['issues_resolved', 'validated', 'previewed'],
  preview: ['validated', 'previewed'],
  activate: ['previewed'],
  confirmMonitoring: ['active'],
  reopen: ['mappings_suggested', 'issues_resolved', 'validated', 'previewed'],
  pause: ['active', 'monitoring', 'error'],
  resume: ['paused'],
  fail: ['active', 'monitoring'],
  recover: ['error'],
  disconnect: [
    'selected',
    'compatibility_reviewed',
    'authorized',
    'mappings_suggested',
    'issues_resolved',
    'validated',
    'previewed',
    'active',
    'monitoring',
    'paused',
    'error',
  ],
};

const TARGET: Partial<Record<JourneyAction, ConnectionState>> = {
  reviewCompatibility: 'compatibility_reviewed',
  authorize: 'authorized',
  suggestMappings: 'mappings_suggested',
  resolveIssues: 'issues_resolved',
  validate: 'validated',
  preview: 'previewed',
  activate: 'active',
  confirmMonitoring: 'monitoring',
  pause: 'paused',
  fail: 'error',
  disconnect: 'disconnected',
};

export class JourneyTransitionError extends Error {
  constructor(
    readonly action: JourneyAction,
    readonly from: ConnectionState,
  ) {
    super(`Action ${action} is not possible while the connection is ${from}.`);
  }
}

export function canTransition(action: JourneyAction, from: ConnectionState): boolean {
  return ALLOWED_FROM[action].includes(from);
}

/**
 * Next state for an action. `resume` and `recover` return to the remembered operational state; `reopen`
 * returns to the given earlier setup state (used when mappings change after validation).
 */
export function nextState(
  action: JourneyAction,
  from: ConnectionState,
  opts: { resumeState?: 'active' | 'monitoring' | null; reopenTo?: ConnectionState } = {},
): ConnectionState {
  if (!canTransition(action, from)) throw new JourneyTransitionError(action, from);
  if (action === 'resume' || action === 'recover') return opts.resumeState ?? 'active';
  if (action === 'reopen') {
    const to = opts.reopenTo ?? 'mappings_suggested';
    const toStep = completedStep(to);
    const fromStep = completedStep(from);
    if (toStep === null || fromStep === null || toStep > fromStep)
      throw new JourneyTransitionError(action, from);
    return to;
  }
  const target = TARGET[action];
  if (!target) throw new JourneyTransitionError(action, from);
  return target;
}

/** Step number an action completes (0 for lifecycle actions). */
export function stepOfAction(action: JourneyAction): number {
  const target = TARGET[action];
  if (!target || action === 'pause' || action === 'fail' || action === 'disconnect') return 0;
  return completedStep(target) ?? 0;
}

/**
 * After mappings change, any validation and preview are stale: a connection that had reached
 * `validated`/`previewed` falls back to `mappings_suggested` (issues must be re-checked, validation re-run).
 */
export function stateAfterMappingChange(state: ConnectionState): ConnectionState {
  const step = completedStep(state);
  if (step === null || step < 4 || step > 7) return state;
  return 'mappings_suggested';
}

export interface StepRecord {
  step: number;
  outcome: 'completed' | 'failed' | 'reopened' | 'lifecycle';
  occurredAt: string;
  actorLabel: string;
}

/** Progress view: which steps are done, which is current, with who completed each and when. */
export function progress(
  state: ConnectionState,
  resumeState: 'active' | 'monitoring' | null,
  history: readonly StepRecord[],
): {
  currentStep: number;
  steps: Array<{
    step: number;
    key: string;
    title: string;
    status: 'done' | 'current' | 'todo';
    completedAt: string | null;
    completedBy: string | null;
  }>;
} {
  const effective: ConnectionState =
    state === 'paused' || state === 'error' ? (resumeState ?? 'active') : state;
  const done = state === 'disconnected' ? lastCompletedFromHistory(history) : (completedStep(effective) ?? 0);
  const currentStep = Math.min(done + 1, SETUP_STEPS.length);
  return {
    currentStep: done >= SETUP_STEPS.length ? SETUP_STEPS.length : currentStep,
    steps: SETUP_STEPS.map((s) => {
      const last = [...history].reverse().find((h) => h.step === s.step && h.outcome === 'completed');
      const status: 'done' | 'current' | 'todo' =
        s.step <= done ? 'done' : s.step === currentStep && state !== 'disconnected' ? 'current' : 'todo';
      return {
        step: s.step,
        key: s.key,
        title: s.title,
        status,
        completedAt: status === 'done' ? (last?.occurredAt ?? null) : null,
        completedBy: status === 'done' ? (last?.actorLabel ?? null) : null,
      };
    }),
  };
}

function lastCompletedFromHistory(history: readonly StepRecord[]): number {
  let max = 0;
  for (const h of history) if (h.outcome === 'completed' && h.step > max) max = h.step;
  return max;
}
