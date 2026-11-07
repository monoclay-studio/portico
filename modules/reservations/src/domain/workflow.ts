import { BusinessRuleError, ValidationError } from '@portico/kernel';

/**
 * Check-in / check-out as resumable workflows (RES-R24..R27, brief §6 "an interrupted workflow must make it clear
 * which steps succeeded and which remain"). Every step result is persisted. A step that caused an external effect
 * records its idempotency key and is never re-executed on resume (RES-I09).
 */
export type WorkflowKind = 'check_in' | 'check_out';
export type CheckInStep = 'registration' | 'unit' | 'guarantee' | 'deposits' | 'access' | 'confirm';
export type CheckOutStep = 'charges' | 'settle' | 'access' | 'confirm';
export type StepKey = CheckInStep | CheckOutStep;
export type StepStatus = 'pending' | 'done' | 'failed' | 'skipped';
export type RunStatus = 'in_progress' | 'completed' | 'abandoned';

export interface StepState {
  key: StepKey;
  status: StepStatus;
  mandatory: boolean;
  /** Step talks to an external system (payments, door locks). */
  external: boolean;
  attempts: number;
  idempotencyKey: string | null;
  message: string | null;
  result: Record<string, unknown> | null;
  updatedAt: string | null;
  skipped?: { by: string; reason: string } | null;
}

export const CHECK_IN_STEPS: readonly CheckInStep[] = [
  'registration',
  'unit',
  'guarantee',
  'deposits',
  'access',
  'confirm',
];
export const CHECK_OUT_STEPS: readonly CheckOutStep[] = ['charges', 'settle', 'access', 'confirm'];

const EXTERNAL: ReadonlySet<StepKey> = new Set<StepKey>(['guarantee', 'access']);

const STEP_LABEL: Record<StepKey, string> = {
  registration: 'Verify identity and required details',
  unit: 'Unit assigned and ready',
  guarantee: 'Payment guarantee / authorization',
  deposits: 'Apply deposits to the folio',
  access: 'Keys',
  confirm: 'Confirm',
  charges: 'Review pending charges',
  settle: 'Settle folios',
};

export function stepLabel(key: StepKey): string {
  return STEP_LABEL[key];
}

/** Steps for a run. `optional` lists steps the property's policy marks optional (skippable without permission). */
export function initialSteps(kind: WorkflowKind, optional: readonly StepKey[] = []): StepState[] {
  const keys: readonly StepKey[] = kind === 'check_in' ? CHECK_IN_STEPS : CHECK_OUT_STEPS;
  return keys.map((key) => ({
    key,
    status: 'pending',
    mandatory: key === 'confirm' || !optional.includes(key),
    external: EXTERNAL.has(key),
    attempts: 0,
    idempotencyKey: null,
    message: null,
    result: null,
    updatedAt: null,
    skipped: null,
  }));
}

export function getStep(steps: readonly StepState[], key: StepKey): StepState {
  const s = steps.find((x) => x.key === key);
  if (!s) throw new ValidationError('unknown_step', `This workflow has no step "${key}".`, { key });
  return s;
}

const ALLOWED: Record<StepStatus, readonly StepStatus[]> = {
  pending: ['pending', 'done', 'failed', 'skipped'],
  failed: ['pending', 'done', 'failed', 'skipped'],
  done: [],
  skipped: [],
};

/** Record a step outcome. Done/skipped steps are final (never repeated on resume). */
export function recordStep(
  steps: readonly StepState[],
  key: StepKey,
  outcome: {
    status: StepStatus;
    message?: string | null;
    result?: Record<string, unknown> | null;
    idempotencyKey?: string | null;
    skipped?: { by: string; reason: string };
    at: string;
  },
): StepState[] {
  const current = getStep(steps, key);
  if (!ALLOWED[current.status].includes(outcome.status)) {
    throw new BusinessRuleError(
      'step_already_final',
      `The step "${stepLabel(key)}" is already ${current.status}; it is not repeated.`,
      { step: key, status: current.status },
    );
  }
  return steps.map((s) =>
    s.key === key
      ? {
          ...s,
          status: outcome.status,
          attempts: s.attempts + 1,
          message: outcome.message ?? null,
          result: outcome.result ?? s.result,
          idempotencyKey: outcome.idempotencyKey ?? s.idempotencyKey,
          updatedAt: outcome.at,
          skipped: outcome.skipped ?? null,
        }
      : s,
  );
}

/** Steps (other than confirm) that still block confirmation. */
export function blockingSteps(steps: readonly StepState[]): StepState[] {
  return steps.filter((s) => s.key !== 'confirm' && s.status !== 'done' && s.status !== 'skipped');
}

export function canConfirm(steps: readonly StepState[]): boolean {
  return blockingSteps(steps).length === 0;
}

/** The next step to work on: the first not done/skipped (confirm last). */
export function nextStep(steps: readonly StepState[]): StepState | null {
  return steps.find((s) => s.status === 'pending' || s.status === 'failed') ?? null;
}

export function summarize(steps: readonly StepState[]): {
  succeeded: StepKey[];
  remaining: StepKey[];
  failed: StepKey[];
  pendingExternal: StepKey[];
} {
  return {
    succeeded: steps.filter((s) => s.status === 'done' || s.status === 'skipped').map((s) => s.key),
    remaining: steps.filter((s) => s.status === 'pending' || s.status === 'failed').map((s) => s.key),
    failed: steps.filter((s) => s.status === 'failed').map((s) => s.key),
    pendingExternal: steps
      .filter((s) => s.external && s.status === 'pending' && s.idempotencyKey !== null)
      .map((s) => s.key),
  };
}
