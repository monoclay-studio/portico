/**
 * Finance's `PaymentsPort.requestCollection` (late charges after departure), implemented by payments in the owning
 * direction: finance calls it inside its posting transaction (already in a savepoint) and payments records INTENT
 * only — a payment request (link) for the folio, created `open`; the provider link is made after commit. Nothing is
 * charged here. A business refusal (no payment account, a collection already in flight on the folio, scope) is
 * returned as `not_possible` with the reason, so the late charge is still posted and listed for staff.
 *
 * Gap (recorded): a merchant-initiated charge on the card on file when the agreed terms allow it (S10) needs the
 * stay's agreed terms and the card's MIT mandate; until then collection is always by payment request.
 */
import { type TxContext, withSavepoint } from '@portico/db';
import { DomainError, type Money } from '@portico/kernel';
import type { PaymentsService } from './service';

export interface FinanceCollectionRequest {
  propertyId: string;
  folioId: string;
  amount: Money;
  reason: 'late_charge';
  ref: { type: string; id: string };
  idempotencyKey: string;
  /** The folio payer's name (finance knows it), for the payment request. */
  payerName?: string;
}

/** Days a late-charge payment request stays open before it expires. */
const LATE_CHARGE_REQUEST_DAYS = 7;

export function paymentsCollectionsForFinance(service: Pick<PaymentsService, 'provider'>) {
  return {
    async requestCollection(
      tx: TxContext,
      input: FinanceCollectionRequest,
    ): Promise<{ status: 'requested' | 'not_possible' | 'unavailable'; detail?: string }> {
      try {
        const r = await withSavepoint(tx, 'payments_collection', () =>
          service.provider.createPaymentRequest(tx, {
            propertyId: input.propertyId,
            payer: { type: 'other', name: input.payerName?.trim() || 'Guest' },
            amount: { amountMinor: input.amount.amountMinor, currency: input.amount.currency },
            purpose: 'balance',
            ref: { type: 'folio', id: input.folioId },
            expiresAt: new Date(tx.now.getTime() + LATE_CHARGE_REQUEST_DAYS * 86_400_000),
            idempotencyKey: input.idempotencyKey,
            description: 'Charges posted after departure',
          }),
        );
        return {
          status: 'requested',
          detail: `Payment request ${r.id} created for the late charges; send the link to the guest.`,
        };
      } catch (err) {
        if (err instanceof DomainError && err.status < 500)
          return { status: 'not_possible', detail: err.message };
        if (err instanceof DomainError) return { status: 'unavailable', detail: err.message };
        throw err;
      }
    },
  };
}
