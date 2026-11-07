/**
 * Provider-agnostic adapter contract (ADR-0007). Adapters never touch Portico's database state for business
 * records: they translate one provider call into a normalized outcome. Uncertainty is explicit — an adapter
 * returns `unknown` when it cannot tell whether the provider acted (timeout, network error, 5xx), and the
 * caller records `pending_verification`. Nothing is ever guessed.
 */
import type { Money } from '@portico/kernel';

export type ProviderKind = 'simulator' | 'stripe_connect' | 'external_terminal';
export type ProviderMode = 'live' | 'sandbox' | 'simulate';

export type Capability =
  | 'hostedCardEntry'
  | 'authorize'
  | 'incrementalAuthorize'
  | 'capture'
  | 'partialCapture'
  | 'multiCapture'
  | 'void'
  | 'charge'
  | 'refund'
  | 'partialRefund'
  | 'paymentLinks'
  | 'webhooks'
  | 'payoutReports'
  | 'disputes'
  | 'lookup';

/** What the adapter needs to know about the account it acts on. Never contains secrets. */
export interface ProviderAccount {
  id: string;
  tenantId: string;
  provider: ProviderKind;
  externalAccountId: string | null;
  currencies: readonly string[];
  applicationFeeBps: number | null;
  statementDescriptor: string | null;
  simulatorControls: SimulatorControls;
}

/** Simulator controls set on a simulator account (demo presenter / tests). Ignored by real providers. */
export interface SimulatorControls {
  /** Provider outage: 'refuse' = connection refused (nothing executed); 'timeout' = calls hang (unknown). */
  outage?: 'refuse' | 'timeout' | null;
  /** Deliver every webhook twice. */
  duplicateWebhooks?: boolean;
  /** Deliver queued webhooks newest-first. */
  outOfOrderWebhooks?: boolean;
  /** Settlement (payout) is delayed by this many days. */
  settlementDelayDays?: number;
}

export interface CallBase {
  operationId: string;
  /** Persisted before the call; forwarded to the provider so a replay can never act twice. */
  idempotencyKey: string;
}

export interface PaymentCall extends CallBase {
  amount: Money;
  methodToken: string;
  customerRef: string | null;
  initiator: 'customer' | 'merchant';
  /** Scheme reference from the original customer-initiated, authenticated transaction (MIT). */
  networkTransactionId: string | null;
  description: string | null;
}

export interface DeclineInfo {
  code: string;
  providerMessage?: string;
}

/** Normalized result of a provider call. */
export type ProviderOutcome =
  | {
      kind: 'succeeded';
      providerRef: string;
      amountMinor: number;
      /** Authorization: amount still held after this operation (0 when fully captured/released). */
      remainingAuthorizedMinor?: number;
      /** Authorization: provider-stated latest capture time. */
      expiresAt?: Date;
      networkTransactionId?: string;
    }
  | { kind: 'declined'; providerRef?: string; decline: DeclineInfo }
  | { kind: 'failed'; code: string; message: string } // definitive: the provider did NOT act
  | { kind: 'unavailable'; reason: string } // provider unreachable before acting (connection refused)
  | { kind: 'unknown'; reason: string }; // the provider MAY have acted → pending_verification

export type LookupResult =
  | { found: true; outcome: Extract<ProviderOutcome, { kind: 'succeeded' | 'declined' | 'failed' }> }
  | { found: false }
  | { found: 'unknown'; reason: string };

export type OperationKind = 'authorize' | 'increment' | 'capture' | 'void' | 'charge' | 'refund';

export interface LookupCall {
  operationId: string;
  kind: OperationKind;
  idempotencyKey: string;
  providerRef: string | null;
  /** For capture/void/increment/refund: the provider ref of the authorization/payment acted upon. */
  parentProviderRef: string | null;
  amountMinor: number;
}

export interface PaymentLinkCall extends CallBase {
  amount: Money;
  description: string;
  expiresAt: Date;
  requestId: string;
}

export type PaymentLinkOutcome =
  | { kind: 'created'; linkRef: string; url: string }
  | { kind: 'failed'; code: string; message: string }
  | { kind: 'unknown'; reason: string };

/**
 * Re-review #3 (ADR-0015 Amendment 2): a payment link is externally writable — the guest can pay it at the provider
 * until the provider confirms it no longer takes payments.
 */
export type LinkDeactivationOutcome =
  | { kind: 'deactivated' }
  /** The link was already paid (or is being paid): the payment arrives by webhook and is resolved as an exception. */
  | { kind: 'already_completed' }
  | { kind: 'failed'; code: string; message: string }
  | { kind: 'unknown'; reason: string };

/** Normalized provider object carried by a verified webhook. */
export type WebhookObject =
  | {
      kind: 'payment';
      providerRef: string;
      /** authorized = held (manual capture); succeeded = collected; failed; canceled = released. */
      state: 'authorized' | 'succeeded' | 'failed' | 'canceled' | 'processing';
      amountMinor: number;
      amountCapturableMinor: number;
      amountReceivedMinor: number;
      currency: string;
      operationId: string | null;
      decline: DeclineInfo | null;
    }
  | {
      kind: 'refund';
      providerRef: string;
      paymentProviderRef: string | null;
      state: 'succeeded' | 'failed' | 'pending';
      amountMinor: number;
      currency: string;
      operationId: string | null;
    }
  | {
      kind: 'dispute';
      providerRef: string;
      paymentProviderRef: string;
      state: 'evidence_required' | 'evidence_submitted' | 'won' | 'lost' | 'accepted';
      amountMinor: number;
      currency: string;
      reason: string;
      evidenceDueBy: Date | null;
      fundsWithdrawn: boolean;
    }
  | {
      kind: 'payout';
      providerRef: string;
      state: 'in_transit' | 'paid' | 'failed';
      amountMinor: number;
      currency: string;
      arrivalDate: string | null;
      failureCode: string | null;
    }
  | {
      kind: 'payment_link';
      providerRef: string;
      requestId: string | null;
      paymentProviderRef: string | null;
      state: 'completed' | 'expired';
      amountMinor: number;
      currency: string;
    }
  | { kind: 'account'; chargesEnabled: boolean; payoutsEnabled: boolean; disabledReason: string | null }
  | { kind: 'unknown'; rawType: string };

export interface VerifiedWebhook {
  eventId: string;
  type: string;
  livemode: boolean;
  /** Provider account the event belongs to (routing key). */
  externalAccountId: string;
  createdAt: Date;
  object: WebhookObject;
  /** Payload to store for audit (card data scrubbed by the caller). */
  payload: unknown;
}

/** Thrown when a webhook signature cannot be verified. Never processed further. */
export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

export interface PaymentProvider {
  readonly kind: ProviderKind;
  readonly mode: ProviderMode;
  readonly capabilities: readonly Capability[];
  authorize(account: ProviderAccount, call: PaymentCall): Promise<ProviderOutcome>;
  incrementAuthorization(
    account: ProviderAccount,
    call: CallBase & { providerRef: string; newTotal: Money },
  ): Promise<ProviderOutcome>;
  capture(
    account: ProviderAccount,
    call: CallBase & { providerRef: string; amount: Money; applicationFeeMinor: number | null },
  ): Promise<ProviderOutcome>;
  void(account: ProviderAccount, call: CallBase & { providerRef: string }): Promise<ProviderOutcome>;
  charge(
    account: ProviderAccount,
    call: PaymentCall & { applicationFeeMinor: number | null },
  ): Promise<ProviderOutcome>;
  refund(
    account: ProviderAccount,
    call: CallBase & { paymentProviderRef: string; amount: Money; reason: string },
  ): Promise<ProviderOutcome>;
  lookup(account: ProviderAccount, call: LookupCall): Promise<LookupResult>;
  createPaymentLink(account: ProviderAccount, call: PaymentLinkCall): Promise<PaymentLinkOutcome>;
  /** Stop a link from taking payments (idempotent). Until it answers `deactivated`, the link may still be paid. */
  deactivatePaymentLink(
    account: ProviderAccount,
    call: CallBase & { linkRef: string },
  ): Promise<LinkDeactivationOutcome>;
  /** Verify the signature and normalize. Throws WebhookSignatureError on any doubt. */
  parseWebhook(rawBody: string, headers: Record<string, string | undefined>, now: Date): VerifiedWebhook;
  /**
   * Event backstop: provider events after `after` (or since `since` on the first run), oldest first, fetched over
   * the authenticated API (so no signature is involved). Returns the new cursor.
   */
  listEvents?(
    account: ProviderAccount,
    opts: { after: string | null; since: Date },
  ): Promise<{ events: VerifiedWebhook[]; cursor: string | null }>;
}

/** Platform application fee (Route A only, optional — Q3). Integer basis points, rounded down. */
export function applicationFeeMinor(amountMinor: number, bps: number | null): number | null {
  if (!bps) return null;
  return Math.floor((amountMinor * bps) / 10_000);
}
