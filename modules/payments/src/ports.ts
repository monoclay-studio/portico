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

export interface LedgerPort {
  /**
   * Owner of a ledger target, BEFORE any money moves: payments refuses a collection whose folio/booking belongs to
   * another property or legal entity. `null` = finance does not know the target (a folio must exist; a booking may
   * receive its first deposit, which then binds it to `propertyId`).
   */
  describeTarget(tx: TxContext, ref: { type: 'folio' | 'booking'; id: string }): Promise<LedgerScope | null>;
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
