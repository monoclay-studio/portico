/**
 * The migration pipeline as data (DD11 §7.1; acceptance criteria M0–M10):
 *
 *   discover → extract → map → validate → rehearse → reconcile → signoff → delta_sync → freeze → cutover → verify
 *   → rollback_window → completed
 *
 * Each step is idempotent and persisted, so `run` resumes from the first unfinished step after a crash. A step
 * either succeeds, waits for a person (with the reason and the owner), or fails (with the error and a retry).
 * A rehearsal job (trial / sandbox / training / demo organization) imports into its own organization during
 * `rehearse` and certifies two consecutive exact reconciliations in `signoff`; its later steps are a cutover DRILL.
 * A production job (live organization only) rehearses through the linked trial organization and imports only at
 * cutover, after every gate passed.
 */
import type { TenantEnvironment } from '@portico/kernel';

export const STEPS = [
  'discover',
  'extract',
  'map',
  'validate',
  'rehearse',
  'reconcile',
  'signoff',
  'delta_sync',
  'freeze',
  'cutover',
  'verify',
  'rollback_window',
] as const;
export type StepKey = (typeof STEPS)[number];

export type StepStatus = 'pending' | 'running' | 'succeeded' | 'waiting' | 'failed' | 'skipped';

export type Purpose = 'rehearsal' | 'production';

export const JOB_STATES = [
  'draft',
  'in_progress',
  'waiting',
  'rehearsed',
  'in_sync',
  'frozen',
  'switched',
  'rollback_window',
  'completed',
  'rolled_back',
  'cancelled',
  'failed',
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const STEP_LABELS: Record<StepKey, string> = {
  discover: 'Discover what the current system holds',
  extract: 'Read the data',
  map: 'Map codes and statuses',
  validate: 'Check data quality',
  rehearse: 'Rehearse in a trial copy',
  reconcile: 'Reconcile source and Portico',
  signoff: 'Sign-off',
  delta_sync: 'Keep in sync until cutover',
  freeze: 'Freeze and final capture',
  cutover: 'Switch to Portico and import',
  verify: 'Verify after the switch',
  rollback_window: 'Rollback window',
};

/** Which purpose an organization's environment allows (rehearsals never run in live; production only in live). */
export function purposeFor(environment: TenantEnvironment): Purpose {
  return environment === 'live' ? 'production' : 'rehearsal';
}

/** Steps a person must start (never automatic). */
export const HUMAN_STARTED: ReadonlySet<StepKey> = new Set(['freeze']);

/** The first step that is not finished — where `run` resumes. */
export function resumePoint(steps: Readonly<Record<StepKey, StepStatus>>): StepKey | null {
  for (const s of STEPS) if (steps[s] !== 'succeeded' && steps[s] !== 'skipped') return s;
  return null;
}

/** Steps that must re-run when a new extract arrives (the plan and checks apply to the new data). */
export const RERUN_ON_NEW_EXTRACT: ReadonlySet<StepKey> = new Set([
  'discover',
  'map',
  'validate',
  'rehearse',
  'reconcile',
  'signoff',
]);

export function initialSteps(): Record<StepKey, StepStatus> {
  return Object.fromEntries(STEPS.map((s) => [s, 'pending'])) as Record<StepKey, StepStatus>;
}

/** Steps before `delta_sync` must all be done before the cutover part of the pipeline starts. */
export function preparationDone(steps: Readonly<Record<StepKey, StepStatus>>): boolean {
  const idx = STEPS.indexOf('delta_sync');
  return STEPS.slice(0, idx).every((s) => steps[s] === 'succeeded' || steps[s] === 'skipped');
}
