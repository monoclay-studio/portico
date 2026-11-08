/**
 * Per-connection ARI request budget (pure). A token bucket whose tokens each return exactly `windowMs` after they
 * were spent (a sliding-window log). It guarantees at most `limit` requests in ANY window of `windowMs`, while still
 * allowing a burst of `limit` and a sustained `limit` per window.
 *
 * Why not a continuous-refill bucket: a bucket of capacity N refilled at N per minute allows N at second 0 and
 * another N during the next 59 seconds — up to 2N requests inside one minute, which a provider counting per minute
 * (Channex: HTTP 429) would refuse. See the README "Rate limit" section.
 */
export const BUDGET_WINDOW_MS = 60_000;

export interface BudgetState {
  /** Instants of requests still inside the window, possibly LATER than `now` (another worker, a completion). */
  sends: readonly Date[];
  /** Set after the hub refused for rate (HTTP 429): nothing is sent before this instant. */
  pausedUntil: Date | null;
}

export type Reservation =
  | { ok: true; sends: Date[]; stamp: Date }
  | { ok: false; sends: Date[]; retryAt: Date; reason: 'budget_exhausted' | 'paused_after_rate_limit' };

/**
 * Drop only stamps that have LEFT the window (P2-2). A stamp later than `now` is kept and counted: it was written by
 * a worker whose clock is ahead, or re-stamped at a request's completion; discarding what this worker cannot see as
 * past is how two workers granted 20 requests in one minute.
 */
export function pruneSends(sends: readonly Date[], now: Date, windowMs = BUDGET_WINDOW_MS): Date[] {
  const floor = now.getTime() - windowMs;
  return sends.filter((s) => s.getTime() > floor).sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Try to spend one token at `now`. Pure: the caller persists the returned `sends` under a row lock. The stamp is
 * never earlier than the latest stamp (monotonic: a clock stepping back cannot free a slot).
 */
export function reserveSlot(
  state: BudgetState,
  now: Date,
  limit: number,
  windowMs = BUDGET_WINDOW_MS,
): Reservation {
  const sends = pruneSends(state.sends, now, windowMs);
  if (state.pausedUntil && state.pausedUntil.getTime() > now.getTime()) {
    return { ok: false, sends, retryAt: state.pausedUntil, reason: 'paused_after_rate_limit' };
  }
  const cap = Math.max(0, Math.floor(limit));
  if (sends.length < cap) {
    const latest = sends[sends.length - 1];
    const stamp = latest && latest.getTime() > now.getTime() ? latest : now;
    return { ok: true, sends: [...sends, stamp], stamp };
  }
  const oldest = sends[sends.length - cap] ?? sends[0] ?? now;
  return {
    ok: false,
    sends,
    retryAt: new Date(Math.max(now.getTime(), oldest.getTime() + windowMs)),
    reason: 'budget_exhausted',
  };
}

/**
 * A request finished (answer, failure or timeout): its slot is counted from the LATER of its reservation and its
 * completion, since the hub may have received it at any instant in between (latency, a cold TLS handshake) — P2-2.
 * The reservation stamp is replaced (or the completion added when it was already pruned).
 */
export function restampAtCompletion(
  sends: readonly Date[],
  reserved: Date,
  completedAt: Date,
  windowMs = BUDGET_WINDOW_MS,
): Date[] {
  const later = completedAt.getTime() > reserved.getTime() ? completedAt : reserved;
  const out = [...sends];
  const i = out.findIndex((s) => s.getTime() === reserved.getTime());
  if (i >= 0) out[i] = later;
  else out.push(later);
  return pruneSends(out, later, windowMs);
}

/** When the next token is available (now when one is free). */
export function nextSlotAt(state: BudgetState, now: Date, limit: number, windowMs = BUDGET_WINDOW_MS): Date {
  const r = reserveSlot(state, now, limit, windowMs);
  return r.ok ? now : r.retryAt;
}

export function budgetUse(
  state: BudgetState,
  now: Date,
  limit: number,
  windowMs = BUDGET_WINDOW_MS,
): { used: number; limit: number; pausedUntil: string | null } {
  return {
    used: pruneSends(state.sends, now, windowMs).length,
    limit,
    pausedUntil:
      state.pausedUntil && state.pausedUntil.getTime() > now.getTime()
        ? state.pausedUntil.toISOString()
        : null,
  };
}

/** The largest number of requests found inside any window of `windowMs` (used by tests and health evidence). */
export function maxInAnyWindow(instants: readonly Date[], windowMs = BUDGET_WINDOW_MS): number {
  const t = instants.map((d) => d.getTime()).sort((a, b) => a - b);
  let best = 0;
  let lo = 0;
  for (let hi = 0; hi < t.length; hi++) {
    while ((t[hi] as number) - (t[lo] as number) >= windowMs) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}
