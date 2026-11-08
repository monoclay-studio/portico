/**
 * Finance's `PaymentsPort.syncBalanceRequest` (charges after departure), implemented by payments in the owning
 * direction. Finance calls it inside its posting transaction (under the folio lock, in a savepoint) after EVERY change
 * to a departed folio's balance; payments keeps the folio's ONE open balance request equal to what the folio owes —
 * creating, amending, re-issuing or closing it (review R2-P1-2). Intent only: links are made after commit, nothing is
 * charged here. A business refusal (no payment account, scope) is returned as `not_possible` with the reason and
 * `openMinor: 0`, so the posting is kept and the exception never claims a request that does not exist.
 *
 * Gap (recorded, Q156): a merchant-initiated charge on the card on file when the agreed terms allow it (S10) needs the
 * stay's agreed terms and the card's MIT mandate; until then collection is always by payment request.
 */
import { type TxContext, withSavepoint } from '@portico/db';
import { DomainError, type Money } from '@portico/kernel';
import type { PaymentsService } from './service';

export interface FinanceBalanceSync {
  propertyId: string;
  folioId: string;
  outstanding: Money;
  reason: string;
  /** The folio payer's name (finance knows it), for the payment request. */
  payerName?: string;
  /** The folio payer (finance's types: guest / company / agency), so the request is addressed to them (P3-5). */
  payer?: { type: string; id?: string };
}

export type FinanceBalanceSyncStatus =
  | 'requested'
  | 'reissued'
  | 'cancelled'
  | 'unchanged'
  | 'none'
  | 'deferred'
  | 'not_possible'
  | 'unavailable';

/** Finance's payer → payments' payer (glossary § Payer: finance `guest` = payments `guest_profile`). */
function payerOf(input: FinanceBalanceSync): {
  type: 'guest_profile' | 'company' | 'agency' | 'other';
  id?: string;
  name: string;
} {
  const name = input.payerName?.trim() || 'Guest';
  const t = input.payer?.type;
  const type = t === 'guest' ? 'guest_profile' : t === 'company' || t === 'agency' ? t : 'other';
  return type !== 'other' && input.payer?.id ? { type, id: input.payer.id, name } : { type: 'other', name };
}

export function paymentsCollectionsForFinance(service: Pick<PaymentsService, 'provider'>) {
  return {
    /** R3-P3-3: finance takes payments' collection lock for these folios before locking them. */
    async lockCollections(tx: TxContext, input: { folioIds: readonly string[] }): Promise<void> {
      await service.provider.lockCollections(
        tx,
        input.folioIds.map((id) => ({ type: 'folio', id })),
      );
    },
    /** Re-review #6 R6-P3-1: finance asks before it keeps a card-funded deposit as revenue. */
    cardDepositForfeitProblem: (tx: TxContext, input: { bookingId: string; amountMinor: number }) =>
      service.provider.cardDepositForfeitProblem(tx, input),
    /** Re-review #5 R5-P1-2: finance asks whether card money may meet this debt before it moves either. */
    cardMoneyMayMeet: (
      tx: TxContext,
      input: Parameters<PaymentsService['provider']['cardMoneyMayMeet']>[1],
    ): ReturnType<PaymentsService['provider']['cardMoneyMayMeet']> =>
      service.provider.cardMoneyMayMeet(tx, input),
    async syncBalanceRequest(
      tx: TxContext,
      input: FinanceBalanceSync,
    ): Promise<{
      status: FinanceBalanceSyncStatus;
      openMinor: number;
      requestId?: string | null;
      linkReady?: boolean;
      oldLinkStopping?: boolean;
      detail?: string;
    }> {
      try {
        const r = await withSavepoint(tx, 'payments_balance_sync', () =>
          service.provider.syncBalanceRequest(tx, {
            propertyId: input.propertyId,
            folioId: input.folioId,
            outstanding: { amountMinor: input.outstanding.amountMinor, currency: input.outstanding.currency },
            payer: payerOf(input),
            reason: input.reason,
          }),
        );
        return {
          status: r.status,
          openMinor: r.openMinor,
          requestId: r.requestId,
          linkReady: r.linkReady,
          oldLinkStopping: r.retiredRequestId !== undefined,
          detail: r.detail,
        };
      } catch (err) {
        if (err instanceof DomainError && err.status < 500)
          return { status: 'not_possible', openMinor: 0, detail: err.message };
        if (err instanceof DomainError) return { status: 'unavailable', openMinor: 0, detail: err.message };
        throw err;
      }
    },
  };
}
