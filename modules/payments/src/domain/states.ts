/**
 * State machines for payment objects. Transitions are MONOTONIC: an outcome learned late (an out-of-order
 * webhook, a slow lookup) can never move a record backwards. Every allowed edge is listed explicitly; anything
 * else is either a no-op (same state, or an older state arriving late) or a provider mismatch that becomes a
 * payment exception — never a silent overwrite.
 */

export type AuthorizationStatus =
  | 'processing'
  | 'pending_verification'
  | 'authorized'
  | 'partially_captured'
  | 'captured'
  | 'voided'
  | 'expired'
  | 'failed';

export type PaymentStatus =
  | 'processing'
  | 'pending_verification'
  | 'succeeded'
  | 'failed'
  | 'awaiting_receipt'
  | 'recorded_unverified'
  | 'recorded_verified'
  | 'cancelled';

export type RefundStatus = PaymentStatus;

export type OperationStatus = 'pending' | 'sent' | 'succeeded' | 'failed' | 'pending_verification';

export type PaymentRequestStatus = 'open' | 'partially_paid' | 'paid' | 'expired' | 'cancelled';

export type DisputeStatus =
  | 'opened'
  | 'evidence_required'
  | 'evidence_submitted'
  | 'won'
  | 'lost'
  | 'accepted';

export type VirtualCardStatus =
  | 'scheduled'
  | 'charging'
  | 'charged'
  | 'funding_retry'
  | 'failed'
  | 'cancelled';

/** Result of asking whether `from → to` may be applied. */
export type TransitionVerdict =
  | { kind: 'apply' }
  | { kind: 'noop' } // already there
  | { kind: 'stale' } // an older state arriving late: ignore
  | { kind: 'mismatch'; reason: string }; // contradicts what we recorded: raise an exception

type Edges<S extends string> = Record<S, readonly S[]>;

const AUTHORIZATION_EDGES: Edges<AuthorizationStatus> = {
  processing: ['pending_verification', 'authorized', 'failed', 'captured', 'partially_captured', 'voided'],
  pending_verification: ['authorized', 'failed', 'captured', 'partially_captured', 'voided', 'expired'],
  authorized: ['partially_captured', 'captured', 'voided', 'expired'],
  partially_captured: ['captured', 'voided', 'expired'],
  captured: [],
  voided: [],
  expired: [],
  failed: [],
};

/** Order used to decide whether a disallowed transition is a late (stale) arrival or a contradiction. */
const AUTHORIZATION_RANK: Record<AuthorizationStatus, number> = {
  processing: 0,
  pending_verification: 1,
  authorized: 2,
  partially_captured: 3,
  captured: 4,
  voided: 4,
  expired: 4,
  failed: 4,
};

const PAYMENT_EDGES: Edges<PaymentStatus> = {
  processing: ['pending_verification', 'succeeded', 'failed'],
  pending_verification: ['succeeded', 'failed'],
  succeeded: [],
  // A provider-confirmed success after we recorded failure means money WAS collected. It is applied (money must
  // never be hidden) but always flagged as a mismatch by the caller. See `paymentTransition`.
  failed: [],
  awaiting_receipt: ['recorded_verified', 'cancelled'],
  recorded_unverified: ['recorded_verified'],
  recorded_verified: [],
  cancelled: [],
};

const PAYMENT_RANK: Record<PaymentStatus, number> = {
  processing: 0,
  pending_verification: 1,
  succeeded: 2,
  failed: 2,
  awaiting_receipt: 0,
  recorded_unverified: 0,
  recorded_verified: 1,
  cancelled: 2,
};

function verdict<S extends string>(
  edges: Edges<S>,
  rank: Record<S, number>,
  from: S,
  to: S,
): TransitionVerdict {
  if (from === to) return { kind: 'noop' };
  if (edges[from].includes(to)) return { kind: 'apply' };
  if (rank[to] < rank[from]) return { kind: 'stale' };
  return { kind: 'mismatch', reason: `cannot move from ${from} to ${to}` };
}

export function authorizationTransition(
  from: AuthorizationStatus,
  to: AuthorizationStatus,
): TransitionVerdict {
  return verdict(AUTHORIZATION_EDGES, AUTHORIZATION_RANK, from, to);
}

/**
 * Payment/refund transitions. `failed → succeeded` (provider says the money moved after all) is APPLIED and
 * reported as a mismatch so staff check for a double collection; `succeeded → failed` is a contradiction
 * that is never applied automatically (for refunds see `refundTransition`).
 */
export function paymentTransition(
  from: PaymentStatus,
  to: PaymentStatus,
): TransitionVerdict | { kind: 'apply_with_mismatch'; reason: string } {
  if (from === 'failed' && to === 'succeeded') {
    return {
      kind: 'apply_with_mismatch',
      reason: 'The provider reports this payment as collected although it was recorded as failed.',
    };
  }
  return verdict(PAYMENT_EDGES, PAYMENT_RANK, from, to);
}

/**
 * Refunds can fail AFTER the provider first reported success (e.g. the card account was closed); the funds then
 * return to the hotel's balance. That transition is applied and flagged so finance corrects the ledger.
 */
export function refundTransition(
  from: RefundStatus,
  to: RefundStatus,
): TransitionVerdict | { kind: 'apply_with_mismatch'; reason: string } {
  if (from === 'succeeded' && to === 'failed') {
    return {
      kind: 'apply_with_mismatch',
      reason: 'The provider reports this refund as failed after first confirming it.',
    };
  }
  return paymentTransition(from, to);
}

export function isFinalPaymentStatus(s: PaymentStatus): boolean {
  return s === 'succeeded' || s === 'failed' || s === 'recorded_verified' || s === 'cancelled';
}

export function isFinalAuthorizationStatus(s: AuthorizationStatus): boolean {
  return s === 'captured' || s === 'voided' || s === 'expired' || s === 'failed';
}

/** Authorization status after a successful capture of `capturedTotal` with `remaining` still held. */
export function statusAfterCapture(remainingMinor: number): AuthorizationStatus {
  return remainingMinor > 0 ? 'partially_captured' : 'captured';
}

const DISPUTE_EDGES: Edges<DisputeStatus> = {
  opened: ['evidence_required', 'evidence_submitted', 'won', 'lost', 'accepted'],
  evidence_required: ['evidence_submitted', 'won', 'lost', 'accepted'],
  evidence_submitted: ['won', 'lost'],
  won: [],
  lost: [],
  accepted: [],
};
const DISPUTE_RANK: Record<DisputeStatus, number> = {
  opened: 0,
  evidence_required: 1,
  evidence_submitted: 2,
  won: 3,
  lost: 3,
  accepted: 3,
};

export function disputeTransition(from: DisputeStatus, to: DisputeStatus): TransitionVerdict {
  return verdict(DISPUTE_EDGES, DISPUTE_RANK, from, to);
}

/** Payment request status from confirmed paid total. Never "paid" from a submission alone. */
export function paymentRequestStatusFor(
  current: PaymentRequestStatus,
  amountMinor: number,
  confirmedPaidMinor: number,
): PaymentRequestStatus {
  if (current === 'cancelled') return current;
  if (confirmedPaidMinor >= amountMinor) return 'paid';
  if (current === 'expired') return current;
  return confirmedPaidMinor > 0 ? 'partially_paid' : 'open';
}

/** What remains refundable on a payment (PAY-I03): captured − refunded − in-flight refunds. */
export function refundableMinor(p: {
  amountMinor: number;
  /** Σ linked adjustments (negative when the statement showed less than recorded). */
  adjustedMinor?: number;
  refundedMinor: number;
  refundReservedMinor: number;
}): number {
  return Math.max(0, p.amountMinor + (p.adjustedMinor ?? 0) - p.refundedMinor - p.refundReservedMinor);
}

/** What remains capturable on an authorization: authorized − captured − in-flight captures. */
export function capturableMinor(a: {
  amountMinor: number;
  capturedMinor: number;
  captureReservedMinor: number;
}): number {
  return Math.max(0, a.amountMinor - a.capturedMinor - a.captureReservedMinor);
}
