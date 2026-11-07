/**
 * Circuit breaker per payment account (scenario s20). After `failureThreshold` consecutive provider
 * unavailability errors the breaker opens: Portico stops sending (nothing new is attempted, nothing shows
 * success), staff see safe alternatives. After `cooldownMs` ONE probe is allowed (half-open); success closes the
 * breaker, failure re-opens it. Declines never count — they prove the provider is up.
 */

export type BreakerStateName = 'closed' | 'open' | 'half_open';

export interface BreakerState {
  state: BreakerStateName;
  consecutiveFailures: number;
  openedAt: Date | null;
  probeAfter: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
}

export interface BreakerConfig {
  failureThreshold: number;
  cooldownMs: number;
}

export const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 3, cooldownMs: 60_000 };

export const INITIAL_BREAKER: BreakerState = {
  state: 'closed',
  consecutiveFailures: 0,
  openedAt: null,
  probeAfter: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
};

export type AttemptDecision =
  | { allowed: true; probe: boolean; next: BreakerState }
  | { allowed: false; retryAfter: Date; next: BreakerState };

/** Decide whether a provider call may be sent now. A half-open breaker lets exactly one probe through. */
export function decideAttempt(s: BreakerState, now: Date, cfg: BreakerConfig = DEFAULT_BREAKER): AttemptDecision {
  if (s.state === 'closed') return { allowed: true, probe: false, next: s };
  const probeAt = s.probeAfter ?? new Date((s.openedAt ?? now).getTime() + cfg.cooldownMs);
  if (now.getTime() < probeAt.getTime()) return { allowed: false, retryAfter: probeAt, next: s };
  // Cool-down elapsed: allow a single probe and push the next probe window out so concurrent callers wait.
  return {
    allowed: true,
    probe: true,
    next: { ...s, state: 'half_open', probeAfter: new Date(now.getTime() + cfg.cooldownMs) },
  };
}

export function recordSuccess(s: BreakerState, now: Date): BreakerState {
  return {
    ...s,
    state: 'closed',
    consecutiveFailures: 0,
    openedAt: null,
    probeAfter: null,
    lastSuccessAt: now,
  };
}

export function recordFailure(
  s: BreakerState,
  now: Date,
  error: string,
  cfg: BreakerConfig = DEFAULT_BREAKER,
): BreakerState {
  const failures = s.consecutiveFailures + 1;
  const shouldOpen = s.state === 'half_open' || failures >= cfg.failureThreshold;
  if (!shouldOpen) return { ...s, consecutiveFailures: failures, lastFailureAt: now, lastError: error };
  return {
    ...s,
    state: 'open',
    consecutiveFailures: failures,
    openedAt: s.state === 'open' && s.openedAt ? s.openedAt : now,
    probeAfter: new Date(now.getTime() + cfg.cooldownMs),
    lastFailureAt: now,
    lastError: error,
  };
}

/** State as staff should see it right now (an open breaker past its cool-down is "probing"). */
export function effectiveState(s: BreakerState, now: Date): BreakerStateName {
  if (s.state === 'open' && s.probeAfter && now.getTime() >= s.probeAfter.getTime()) return 'half_open';
  return s.state;
}

export interface StaffAction {
  key: 'accept_cash' | 'send_payment_link_later' | 'record_manual_authorization' | 'record_terminal_payment';
  label: string;
  detail: string;
}

/** The clear set of actions shown when card payments are unavailable (scenario s20). */
export const OUTAGE_ACTIONS: readonly StaffAction[] = [
  {
    key: 'accept_cash',
    label: 'Accept cash',
    detail: 'Record a cash payment; it posts to the folio immediately and is reconciled at cashier close.',
  },
  {
    key: 'send_payment_link_later',
    label: 'Send a payment link later',
    detail: 'Create a payment request now; the guest pays when the provider is back. Nothing is charged until then.',
  },
  {
    key: 'record_manual_authorization',
    label: 'Record a manual authorization',
    detail:
      "Take a pre-authorization on the hotel's own terminal and record its approval code. It is a hold, not a payment.",
  },
  {
    key: 'record_terminal_payment',
    label: "Take the card on the hotel's own terminal",
    detail:
      'Record the terminal approval code; it stays "recorded — not verified" until matched to the settlement statement.',
  },
];
