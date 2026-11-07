/**
 * Review R2-P1-2: after departure a folio has at most ONE open balance request (payments), and it always asks for what
 * the folio owes now. Every change finance makes to a departed folio's balance — a late charge, a reversal, an
 * adjustment, a transfer in or out, a payment taken at the desk, a deposit applied — calls `syncDepartedFolios` under
 * the folio lock, so the request is amended up or down, re-issued, or closed in the same transaction, and the folio's
 * one open `late_charge` exception says what is owed and what was ACTUALLY requested (severity recomputed every time).
 *
 * A folio counts as departed once a charge was posted to it after its owner left (`post_departure`); payments made
 * through payments' own paths (cards, links) keep the request in step themselves (a paid link credits its request).
 */
import { type TxContext, withSavepoint } from '@portico/db';
import { DomainError, formatMoney, type LocalDate, money } from '@portico/kernel';
import type { BalanceSyncResult } from '../ports';
import { type Deps, db, folioBalance, loadFolio, ownerDeparture, raiseException } from './support';

export interface FolioBalanceChange {
  /** What changed, in words staff recognise ("Late charge \"Spa\"", "Reversal of …", "Transfer to …"). */
  reason: string;
  entryId: string;
  businessDate: LocalDate;
}

const REQUESTED = new Set(['requested', 'amended', 'reissued', 'unchanged']);

export async function syncDepartedFolios(
  tx: TxContext,
  deps: Deps,
  folioIds: readonly string[],
  change: FolioBalanceChange,
): Promise<void> {
  for (const folioId of [...new Set(folioIds)].sort()) {
    const f = await loadFolio(tx, folioId);
    if (!f.post_departure) continue;
    const balance = await folioBalance(tx, folioId);
    const owed = Math.max(0, balance);
    const sync: BalanceSyncResult = await withSavepoint(tx, 'finance_balance_sync', () =>
      deps.ports.payments.syncBalanceRequest(tx, {
        propertyId: f.property_id,
        folioId,
        outstanding: money(owed, f.currency),
        reason: change.reason,
        payerName: f.payer_name,
        ...(f.payer_type !== 'house'
          ? { payer: { type: f.payer_type, ...(f.payer_id ? { id: f.payer_id } : {}) } }
          : {}),
      }),
    ).catch(
      (err: unknown): BalanceSyncResult => ({
        status: 'not_possible',
        openMinor: 0,
        detail:
          err instanceof DomainError
            ? err.message
            : 'Payments could not record the payment request. Arrange collection manually.',
      }),
    );
    // Only what payments accepted counts as requested; a refusal or a deferral never looks like a request.
    const requested = REQUESTED.has(sync.status) ? sync.openMinor : 0;
    const fmt = (n: number) => formatMoney(money(n, f.currency));
    const departure = await ownerDeparture(tx, { type: f.owner_type, id: f.owner_id });
    const details = {
      entryId: change.entryId,
      ...(departure ? { departedOn: departure.departedOn } : {}),
      balanceMinor: balance,
      owedMinor: owed,
      amountRequested: requested,
      collection: sync.status,
      ...(sync.requestId ? { paymentRequestId: sync.requestId } : {}),
      ...(sync.detail ? { collectionDetail: sync.detail } : {}),
    };
    if (owed > 0) {
      const ask =
        requested === owed
          ? `A payment link for ${fmt(owed)} is open — send it to ${f.payer_name}, or collect from the card on file.`
          : requested > 0
            ? `The open payment link asks for only ${fmt(requested)}; collect the remaining ${fmt(owed - requested)} another way.`
            : `No payment link was created (${sync.detail ?? sync.status}). Collect payment from ${f.payer_name} or the card on file.`;
      await raiseException(tx, {
        propertyId: f.property_id,
        kind: 'late_charge',
        severity: 'urgent',
        ref: { type: 'folio', id: folioId },
        message: `${change.reason}: ${f.payer_name}'s folio, after departure, now owes ${fmt(owed)}. ${ask}`,
        details,
        businessDate: change.businessDate,
      });
      continue;
    }
    // Nothing owed. In credit: keep a routine item (review the credit before refunding it). Settled: close the item.
    if (balance < 0) {
      await raiseException(tx, {
        propertyId: f.property_id,
        kind: 'late_charge',
        severity: 'routine',
        ref: { type: 'folio', id: folioId },
        message: `${change.reason}: ${f.payer_name}'s folio, after departure, is in credit by ${fmt(-balance)}, so nothing is collected${sync.status === 'cancelled' ? ' and the open payment link was cancelled' : ''}. Review the folio before refunding the credit.`,
        details,
        businessDate: change.businessDate,
      });
      continue;
    }
    await db(tx)
      .updateTable('finance.exceptions')
      .set((eb) => ({
        status: 'resolved',
        resolved_at: tx.now,
        resolution: `${change.reason}: the folio owes nothing${sync.status === 'cancelled' ? '; the payment link was cancelled' : ''}.`,
        details: JSON.stringify(details),
        version: eb('version', '+', 1),
      }))
      .where('kind', '=', 'late_charge')
      .where('ref_type', '=', 'folio')
      .where('ref_id', '=', folioId)
      .where('status', '=', 'open')
      .execute();
  }
}
