/**
 * What payments needs from other modules (bound in apps/api/src/composition.ts; tests bind fakes).
 *
 *  - LedgerPort → finance (domain map § finance). Called ONLY after the provider confirmed success (or, for
 *    recorded Route D payments, at record time with method external_terminal / cash / bank_transfer), inside
 *    the same transaction as the payments record, with a deterministic idempotency key so a retry can never
 *    create a second posting.
 *  - PlatformPort → platform (property/legal entity, policies, data authority).
 */
import type { TxContext } from '@portico/db';
import type { Money } from '@portico/kernel';

export interface EntityRef {
  type: string;
  id: string;
}

export type LedgerPaymentMethod =
  | 'card'
  | 'virtual_card'
  | 'payment_link'
  | 'external_terminal'
  | 'cash'
  | 'bank_transfer';

/** Where the money sits before payout: lets finance keep one clearing account per acquirer/provider account. */
export interface ClearingRef {
  provider: 'simulator' | 'stripe_connect' | 'external_terminal' | 'cash' | 'bank_transfer';
  accountId: string | null;
}

/**
 * Every posting carries the property and its operating legal entity. Finance MUST refuse a posting whose target
 * (folio / booking deposit) belongs to another property or legal entity (defence in depth with `describeTarget`).
 */
export interface LedgerScope {
  propertyId: string;
  legalEntityId: string;
}

/**
 * What finance knows about a ledger target beyond its scope (re-review #3): for a folio, whose folio it is (the stay or
 * booking that owns it) and who pays it — payments resolves a folio's booking family (double-collection guard) and the
 * people the cardholder's consent may cover (ADR-0015 Amendment 2).
 */
export interface LedgerTargetInfo extends LedgerScope {
  owner?: { type: string; id: string } | null;
  /** Finance's payer type (`guest` | `company` | `agency` | `house` | `other`) and id. */
  payer?: { type: string; id: string | null } | null;
}

export interface LedgerPort {
  /**
   * Owner of a ledger target, BEFORE any money moves: payments refuses a collection whose folio/booking belongs to
   * another property or legal entity. `null` = finance does not know the target (a folio must exist; a booking may
   * receive its first deposit, which then binds it to `propertyId`).
   */
  describeTarget(
    tx: TxContext,
    ref: { type: 'folio' | 'booking'; id: string },
  ): Promise<LedgerTargetInfo | null>;
  /**
   * Re-review #4 (R4-P2-1, R4-P3-3): what a folio owes now (positive) or holds in credit (negative), from the ledger;
   * null when finance cannot say (a booking deposit, an unknown target). Payments uses it to state an over-collection
   * and to let a balance charge through only up to what the folio owes.
   */
  balanceOf(tx: TxContext, ref: { type: 'folio' | 'booking'; id: string }): Promise<number | null>;
  /**
   * Review R2-P1-3 (AP-44): finance's own posting predicate for new money on this target at this scope, asked BEFORE
   * any card is charged, so pre-check and posting can never disagree (e.g. a booking whose deposits are held at
   * another property, or an imported deposit of a booking reservations does not know). Throws the refusal.
   */
  assertTargetUsable(
    tx: TxContext,
    ref: { type: 'folio' | 'booking'; id: string },
    scope: LedgerScope,
  ): Promise<void>;
  /** Payment against a folio (domain map + scope, method, verification, clearing). */
  recordPayment(
    tx: TxContext,
    input: LedgerScope & {
      folioId: string;
      amount: Money;
      paymentRef: EntityRef;
      method: LedgerPaymentMethod;
      idempotencyKey: string;
      verification: 'provider_confirmed' | 'recorded_unverified' | 'recorded_verified';
      clearing: ClearingRef;
    },
  ): Promise<{ postingId: string }>;
  /** Deposit (liability, not revenue) against a booking; `propertyId` lets finance open the first deposit account. */
  recordDeposit(
    tx: TxContext,
    input: LedgerScope & {
      bookingId: string;
      amount: Money;
      paymentRef: EntityRef;
      idempotencyKey: string;
      method: LedgerPaymentMethod;
      verification: 'provider_confirmed' | 'recorded_unverified' | 'recorded_verified';
      clearing: ClearingRef;
    },
  ): Promise<{ postingId: string }>;
  /** Refund as a new linked entry; the original payment posting is never altered. */
  recordRefund(
    tx: TxContext,
    input: LedgerScope & {
      folioId: string | null;
      bookingId: string | null;
      amount: Money;
      refundRef: EntityRef;
      originalPaymentRef: EntityRef;
      idempotencyKey: string;
      clearing: ClearingRef;
    },
  ): Promise<{ postingId: string }>;
  /** Payout: settlement transfer, never revenue. */
  recordPayout(
    tx: TxContext,
    input: {
      legalEntityId: string;
      payoutRef: EntityRef;
      gross: Money;
      fees: Money;
      net: Money;
      currency: string;
      clearing: ClearingRef;
      idempotencyKey: string;
    },
  ): Promise<{ journalEntryId: string }>;
  /**
   * Correction of a recorded payment found wrong by reconciliation — a new linked adjusting entry, never an edit.
   * `amount` is signed (negative reduces the recorded payment). Finance must count it in the refund ceiling.
   */
  recordPaymentAdjustment(
    tx: TxContext,
    input: LedgerScope & {
      folioId: string | null;
      bookingId: string | null;
      amount: Money;
      paymentRef: EntityRef;
      adjustmentRef: EntityRef;
      reason: string;
      idempotencyKey: string;
      clearing: ClearingRef;
    },
  ): Promise<{ postingId: string }>;
  /** Dispute fund movements: `debit` when the provider withdraws; `reversal` when a won dispute returns it. */
  recordDisputeMovement(
    tx: TxContext,
    input: {
      legalEntityId: string;
      paymentRef: EntityRef;
      disputeRef: EntityRef;
      amount: Money;
      kind: 'debit' | 'reversal';
      clearing: ClearingRef;
      idempotencyKey: string;
    },
  ): Promise<{ journalEntryId: string }>;
  /**
   * Route D: a recorded payment/refund was matched to a settlement or bank statement (or staff confirmed a bank
   * receipt). Verification is a separate fact — the posting stays immutable — so folios leave "awaiting
   * verification". Idempotent by key.
   */
  markPaymentVerified(
    tx: TxContext,
    input: LedgerScope & {
      paymentRef: EntityRef; // { type: 'payment' | 'refund', id }
      evidenceRef: EntityRef; // { type: 'statement_line' | 'bank_confirmation', id }
      idempotencyKey: string;
    },
  ): Promise<void>;
  /** Acquirer fees (MDR) from a settlement statement: an expense of the hotel, never a guest-payment adjustment. */
  recordSettlementFees(
    tx: TxContext,
    input: LedgerScope & {
      statementRef: EntityRef;
      amount: Money;
      clearing: ClearingRef;
      idempotencyKey: string;
    },
  ): Promise<{ journalEntryId: string }>;
}

/**
 * Which property owns a business reference (reservations: a booking or a stay), bound in the composition root.
 * Review P1-1: a hold or payment for a stay/booking of another property — or for one that exists nowhere — is refused
 * before anything is recorded. `undefined` = not a reference type the directory knows (no check).
 */
/**
 * Owner of stays and bookings (reservations). `null` = no such record in this organization; `undefined` = a reference
 * type the directory does not own (payments refuses those). For a booking, where it came from: a channel virtual
 * card is accepted only for a booking of that channel connection (review R2-P1-1).
 */
export interface ReferenceDirectoryPort {
  describeReference(
    tx: TxContext,
    ref: { type: string; id: string },
  ): Promise<ReferenceOwner | null | undefined>;
}

export interface ReferenceOwner {
  propertyId: string;
  /** Bookings only: how the booking was made (`channel` for OTA/GDS bookings) and the channel connection. */
  source?: string;
  channelConnectionId?: string | null;
  /** Stays and bookings: the booking (a stay's booking; a booking's own id) — its collection family. */
  bookingId?: string;
  /**
   * Stays and bookings: the booking's people as payments owner keys (`guest_profile:<id>`, `company:<id>`,
   * `agency:<id>`, `booking:<id>`) — a standing card-on-file consent covers only its cardholder's own bookings.
   */
  people?: string[];
  /** Stays only: when the stay was created — consent given before it does not cover it (ADR-0015 Amendment 3). */
  stayCreatedAt?: string;
}

export interface PropertyInfo {
  id: string;
  legalEntityId: string;
  timezone: string;
  baseCurrency: string;
}

export interface PlatformPort {
  /** Property facts payments needs AFTER it has checked its own permission (merchant, time zone). */
  getProperty(tx: TxContext, propertyId: string): Promise<PropertyInfo>;
  getLegalEntity(
    tx: TxContext,
    legalEntityId: string,
  ): Promise<{ id: string; countryCode: string; baseCurrency: string }>;
  /** ADR-0014: throws external_system_of_record when another system owns `payments` here. */
  assertWritable(tx: TxContext, propertyId: string, domain: 'payments'): Promise<'portico' | 'forward'>;
  resolvePolicy<T>(tx: TxContext, propertyId: string, key: string, defaultValue: T): Promise<{ value: T }>;
}
