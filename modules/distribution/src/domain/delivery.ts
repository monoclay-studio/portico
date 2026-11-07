/**
 * Delivery policy for hub calls (pure): how a failure is classified and when the next attempt happens.
 *
 * DST-R04: a payload error is never retried (it would fail the same way) and becomes an exception with a
 * plain-language fix. A transient error backs off 5 s → 10 s → 20 s → 40 s, then retries every minute; after 30
 * minutes of failing the problem becomes URGENT — retries continue every minute (availability must reach the
 * channel eventually), and the urgent exception resolves itself when a retry is accepted.
 */
export type FailureClass = 'payload' | 'transient' | 'rate_limited' | 'auth';

export interface HubFailure {
  class: FailureClass;
  /** Plain-language problem for staff. */
  message: string;
  httpStatus: number | null;
  /** Seconds the hub asked us to wait (HTTP 429 Retry-After), when given. */
  retryAfterSeconds: number | null;
  /** True when the request may have been applied (timeout / connection lost after sending). */
  outcomeUnknown: boolean;
  detail?: Record<string, unknown>;
}

export const BACKOFF_SCHEDULE_MS = [5_000, 10_000, 20_000, 40_000] as const;
export const STEADY_RETRY_MS = 60_000;
export const ESCALATE_AFTER_MS = 30 * 60_000;
/** After HTTP 429 the hub asks for a pause; Channex guidance: pause updates for the property for one minute. */
export const RATE_LIMIT_PAUSE_MS = 60_000;

/** Delay before attempt number `failures + 1`, given how many attempts already failed (1 → 5 s). */
export function retryDelayMs(failures: number): number {
  if (failures <= 0) return 0;
  return BACKOFF_SCHEDULE_MS[failures - 1] ?? STEADY_RETRY_MS;
}

export function nextAttemptAt(
  now: Date,
  failures: number,
  failure?: Pick<HubFailure, 'class' | 'retryAfterSeconds'>,
): Date {
  let delay = retryDelayMs(failures);
  if (failure?.class === 'rate_limited') {
    delay = Math.max(delay, RATE_LIMIT_PAUSE_MS, (failure.retryAfterSeconds ?? 0) * 1000);
  }
  return new Date(now.getTime() + delay);
}

/** True once a transient problem has lasted long enough to be urgent. */
export function isEscalated(firstFailedAt: Date | null, now: Date): boolean {
  return firstFailedAt !== null && now.getTime() - firstFailedAt.getTime() >= ESCALATE_AFTER_MS;
}

/**
 * Classify an HTTP answer or transport failure. 2xx is success and never reaches here.
 *  - 429 → rate_limited (transient, plus a budget pause)
 *  - 401 / 403 → auth (credential revoked or wrong: pause publication for this connection only, E04)
 *  - 408, 425, 5xx, timeout, connection errors → transient
 *  - other 4xx (400, 404, 409, 422) → payload (never retried)
 */
export function classifyHttp(status: number): FailureClass {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth';
  if (status === 408 || status === 425 || status >= 500) return 'transient';
  return 'payload';
}

export const isRetryable = (c: FailureClass) => c === 'transient' || c === 'rate_limited';
