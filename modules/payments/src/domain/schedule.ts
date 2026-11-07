/**
 * Time-based policies for verification and virtual-card charging. All functions take `now` explicitly.
 */
import { addDays, type LocalDate } from '@portico/kernel';

/** Pending-verification lookup schedule (spec PAY-R13): 10 s, 30 s, 2 min, 10 min, 1 h, then every 6 h. */
export const VERIFICATION_BACKOFF_MS: readonly number[] = [10_000, 30_000, 120_000, 600_000, 3_600_000];
export const VERIFICATION_STEADY_MS = 6 * 3_600_000;

export function nextVerificationAt(checkCount: number, now: Date): Date {
  const delay = VERIFICATION_BACKOFF_MS[checkCount] ?? VERIFICATION_STEADY_MS;
  return new Date(now.getTime() + delay);
}

/** An operation marked `sent` longer than this without an outcome is treated as pending verification. */
export const STALE_SENT_MS = 60_000;

/**
 * "Not found at the provider" is only conclusive after this grace period (provider search indexes are
 * eventually consistent). Before that a miss leaves the operation pending verification.
 */
export const NOT_FOUND_GRACE_MS = 15 * 60_000;

/** Unresolved this long → an urgent exception with an owner (a person must look). */
export const ESCALATE_PENDING_AFTER_MS = 24 * 3_600_000;

/**
 * Virtual-card funding retries (research 04 §B6: funds may arrive days after activation): 6 h, 12 h, 24 h,
 * 24 h, 48 h. After the last failure the card is marked failed and a task is raised.
 */
export const VCC_RETRY_MS: readonly number[] = [6, 12, 24, 24, 48].map((h) => h * 3_600_000);

export type VccRetryDecision = { kind: 'retry'; at: Date } | { kind: 'give_up'; reason: string };

export function vccRetryDecision(input: {
  attempts: number; // attempts made so far, including the one that just failed
  now: Date;
  expiresOn: LocalDate | null;
  todayLocal: LocalDate;
  retryable: boolean;
}): VccRetryDecision {
  if (!input.retryable) return { kind: 'give_up', reason: 'The decline is not retryable.' };
  const delay = VCC_RETRY_MS[input.attempts - 1];
  if (delay === undefined) return { kind: 'give_up', reason: `No success after ${input.attempts} attempts.` };
  const at = new Date(input.now.getTime() + delay);
  if (input.expiresOn && input.todayLocal >= input.expiresOn) {
    return { kind: 'give_up', reason: 'The virtual card has expired.' };
  }
  return { kind: 'retry', at };
}

/** A virtual card may be charged from its activation date (property-local), never earlier. */
export function vccIsActive(activationDate: LocalDate, todayLocal: LocalDate): boolean {
  return todayLocal >= activationDate;
}

/** Default authorization validity when the provider does not state one (configurable by policy). */
export function authorizationExpiry(now: Date, validityDays: number): Date {
  return new Date(now.getTime() + validityDays * 86_400_000);
}

/** Statement period helper: is `day` within [from, to] inclusive. */
export function withinPeriod(day: LocalDate, from: LocalDate, to: LocalDate): boolean {
  return day >= from && day <= to;
}

export function dayBefore(d: LocalDate): LocalDate {
  return addDays(d, -1);
}
