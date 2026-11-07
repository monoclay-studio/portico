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

export interface LedgerPort {
  /** Payment against a folio (domain map). */
  recordPayment(
    tx: TxContext,
    input: {
      folioId: string;
      amount: Money;
      paymentRef: EntityRef;
      method: LedgerPaymentMethod;
      idempotencyKey: string;
      /** Proposed additive field: provider-confirmed vs recorded (unverified) — lets finance label it. */
      verification: 'provider_confirmed' | 'recorded_unverified';
    },
  ): Promise<{ postingId: string }>;
  /** Deposit (liability, not revenue) against a booking (domain map). */
  recordDeposit(
    tx: TxContext,
    input: {
      bookingId: string;
      amount: Money;
      paymentRef: EntityRef;
      idempotencyKey: string;
      method: LedgerPaymentMethod;
      verification: 'provider_confirmed' | 'recorded_unverified';
    },
  ): Promise<{ postingId: string }>;
  /** Refund as a new linked entry; the original payment posting is never altered (domain map + `bookingId`). */
  recordRefund(
    tx: TxContext,
    input: {
      folioId: string | null;
      /** Proposed additive field: set when the original payment was a booking deposit. */
      bookingId: string | null;
      amount: Money;
      refundRef: EntityRef;
      originalPaymentRef: EntityRef;
      idempotencyKey: string;
    },
  ): Promise<{ postingId: string }>;
  /** Payout: settlement transfer, never revenue (domain map). */
  recordPayout(
    tx: TxContext,
    input: {
      legalEntityId: string;
      payoutRef: EntityRef;
      gross: Money;
      fees: Money;
      net: Money;
      currency: string;
      idempotencyKey: string;
    },
  ): Promise<{ journalEntryId: string }>;
  /**
   * PROPOSED (contract change): correction of a recorded payment found wrong by reconciliation — a new linked
   * adjusting entry, never an edit. `amount` is signed (negative reduces the recorded payment).
   */
  recordPaymentAdjustment(
    tx: TxContext,
    input: {
      folioId: string | null;
      bookingId: string | null;
      amount: Money;
      paymentRef: EntityRef;
      adjustmentRef: EntityRef;
      reason: string;
      idempotencyKey: string;
    },
  ): Promise<{ postingId: string }>;
  /**
   * PROPOSED (spec PAY-R18, finance contract change): dispute fund movements. `debit` when the provider withdraws
   * the disputed amount; `reversal` when a won dispute returns it.
   */
  recordDisputeMovement(
    tx: TxContext,
    input: {
      legalEntityId: string;
      paymentRef: EntityRef;
      disputeRef: EntityRef;
      amount: Money;
      kind: 'debit' | 'reversal';
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
