import type { TxContext } from '@portico/db';
import {
  BusinessRuleError,
  type EntityRef,
  type Money,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { LineDraft } from '../domain/ledger';
import { recordDeposit, refundDeposit } from './deposits';
import { prepareDestination } from './folios';
import { findOriginalPayment } from './postings';
import {
  claimEntry,
  type Deps,
  type FolioRow,
  findEntryByKey,
  loadFolio,
  lockFolios,
  postingIdsOfEntry,
  requestHash,
  writeEntryBody,
} from './support';
import { bridgeLines, clearingSide, decodeMethod } from './tender';

/**
 * Correction of a recorded payment found wrong by reconciliation (payments "Route D"): a new linked adjusting
 * entry, never an edit. `amount` is signed — negative reduces the recorded payment, positive increases it.
 */
export async function recordPaymentAdjustment(
  tx: TxContext,
  deps: Deps,
  input: {
    folioId: string | null;
    bookingId: string | null;
    amount: Money;
    paymentRef: EntityRef;
    adjustmentRef: EntityRef;
    reason: string;
    idempotencyKey: string;
  },
): Promise<{ postingId: string; entryId: string; replayed: boolean }> {
  if (input.amount.amountMinor === 0)
    throw new ValidationError('invalid_amount', 'An adjustment cannot be zero.');
  const original = await findOriginalPayment(tx, input.paymentRef);
  if (input.amount.currency !== original.tenderCurrency) {
    throw new ValidationError(
      'adjustment_currency_mismatch',
      `Adjust the payment in ${original.tenderCurrency}.`,
    );
  }
  if (!input.folioId) {
    if (!input.bookingId)
      throw new ValidationError('target_required', 'Give the folio or booking of the payment.');
    const { method, provider } = decodeMethod(original.paymentMethod);
    if (input.amount.amountMinor > 0) {
      const r = await recordDeposit(tx, deps, {
        bookingId: input.bookingId,
        amount: input.amount,
        paymentRef: input.adjustmentRef,
        idempotencyKey: input.idempotencyKey,
        method,
        ...(provider ? { provider } : {}),
        verification: 'recorded_unverified',
        cashWithoutSession: 'flag',
      });
      return { postingId: r.entryId, entryId: r.entryId, replayed: r.replayed };
    }
    const r = await refundDeposit(tx, deps, {
      bookingId: input.bookingId,
      amount: { amountMinor: -input.amount.amountMinor, currency: input.amount.currency },
      refundRef: input.adjustmentRef,
      originalPaymentRef: input.paymentRef,
      idempotencyKey: input.idempotencyKey,
      cashWithoutSession: 'flag',
      movementKind: 'adjusted',
    });
    return { postingId: r.entryId, entryId: r.entryId, replayed: r.replayed };
  }
  const f0 = await loadFolio(tx, input.folioId);
  requirePermission(tx, 'finance.posting.create', { propertyId: f0.property_id });
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: 'payment-adjustment', ...rest });
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) {
    const ids = await postingIdsOfEntry(tx, prior);
    return { postingId: ids[0] as string, entryId: prior, replayed: true };
  }
  if (
    input.amount.amountMinor < 0 &&
    -input.amount.amountMinor > original.tenderMinor - original.refundedMinor
  ) {
    throw new BusinessRuleError(
      'adjustment_exceeds_payment',
      `The recorded payment can be reduced by at most ${original.tenderMinor - original.refundedMinor} (minor units).`,
    );
  }
  await deps.ports.platform.assertWritable(tx, f0.property_id, 'charges');
  const businessDate = await deps.ports.platform.getBusinessDate(tx, f0.property_id);
  const claim = await claimEntry(tx, {
    legalEntityId: f0.legal_entity_id,
    propertyId: f0.property_id,
    entryType: 'payment_adjustment',
    businessDate,
    idempotencyKey,
    requestHash: hash,
    source: input.adjustmentRef,
    reasonCode: 'payment_reconciliation',
    description: `Payment correction: ${input.reason}`,
  });
  if (!claim.claimed) {
    const ids = await postingIdsOfEntry(tx, claim.entryId);
    return { postingId: ids[0] as string, entryId: claim.entryId, replayed: true };
  }
  const locked = (await lockFolios(tx, [f0.id])).get(f0.id) as FolioRow;
  const { folio } = await prepareDestination(tx, locked, 'payment');
  const { method, provider } = decodeMethod(original.paymentMethod);
  const bridge = await bridgeLines(
    tx,
    deps,
    folio.legal_entity_id,
    businessDate,
    { ...clearingSide(method, provider, null), amount: input.amount },
    {
      accountKey: 'guest_ledger',
      subLedger: { type: 'folio', id: folio.id },
      postingIndex: 0,
      currency: folio.currency,
    },
  );
  const [postingId] = await writeEntryBody(
    tx,
    deps,
    claim.entryId,
    {
      legalEntityId: folio.legal_entity_id,
      propertyId: folio.property_id,
      businessDate,
      description: 'Payment correction',
    },
    [
      {
        folioId: folio.id,
        kind: 'adjustment',
        amountMinor: -bridge.creditAmount.amountMinor,
        currency: folio.currency,
        description: `Payment correction: ${input.reason}`,
        paymentRef: input.adjustmentRef,
        paymentMethod: original.paymentMethod,
        correctsPostingId: original.postingId,
        source: input.paymentRef,
        fxRateId: bridge.fxRateId,
        ...(input.amount.currency !== folio.currency
          ? { originalAmountMinor: -input.amount.amountMinor, originalCurrency: input.amount.currency }
          : {}),
      },
    ],
    bridge.lines,
  );
  await tx.audit({
    action: 'finance.posting.paymentAdjustment',
    target: { type: 'folio', id: folio.id },
    propertyId: folio.property_id,
    reason: input.reason,
    after: {
      amount: input.amount,
      paymentRef: input.paymentRef,
      adjustmentRef: input.adjustmentRef,
      entryId: claim.entryId,
    },
  });
  await tx.emit({
    type: 'finance.posting.created',
    propertyId: folio.property_id,
    aggregate: { type: 'journal_entry', id: claim.entryId },
    payload: {
      entryId: claim.entryId,
      kind: 'payment_adjustment',
      postingIds: [postingId],
      folioIds: [folio.id],
      amount: input.amount,
      businessDate,
    },
  });
  return { postingId: postingId as string, entryId: claim.entryId, replayed: false };
}

/**
 * Dispute fund movements (spec PAY-R18): `debit` when the provider withdraws the disputed amount from the
 * hotel's balance (card clearing → disputed funds); `reversal` when a won dispute returns it. The guest's bill is
 * not touched — the payment stays recorded; a lost dispute is settled later by an explicit write-off.
 */
export async function recordDisputeMovement(
  tx: TxContext,
  deps: Deps,
  input: {
    legalEntityId: string;
    paymentRef: EntityRef;
    disputeRef: EntityRef;
    amount: Money;
    kind: 'debit' | 'reversal';
    idempotencyKey: string;
  },
): Promise<{ journalEntryId: string; replayed: boolean }> {
  requirePermission(tx, 'finance.ledger.manage');
  if (input.amount.amountMinor <= 0)
    throw new ValidationError('invalid_amount', 'A dispute movement must be positive.');
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: 'dispute', ...rest });
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) return { journalEntryId: prior, replayed: true };
  await deps.ports.platform.getLegalEntity(tx, input.legalEntityId);
  const original = await findOriginalPayment(tx, input.paymentRef).catch(() => null);
  const { method, provider } = decodeMethod(original?.paymentMethod ?? 'card');
  const clearing = clearingSide(method, provider, null).accountKey;
  const businessDate = tx.now.toISOString().slice(0, 10);
  const claim = await claimEntry(tx, {
    legalEntityId: input.legalEntityId,
    propertyId: null,
    entryType: 'dispute',
    businessDate,
    idempotencyKey,
    requestHash: hash,
    source: input.disputeRef,
    description: `Dispute ${input.kind === 'debit' ? 'withdrawal' : 'reversal'} (${input.disputeRef.id})`,
  });
  if (!claim.claimed) return { journalEntryId: claim.entryId, replayed: true };
  const sign = input.kind === 'debit' ? 1 : -1;
  const lines: LineDraft[] = [
    {
      accountKey: 'disputed_funds',
      amountMinor: sign * input.amount.amountMinor,
      currency: input.amount.currency,
      memo: `dispute ${input.disputeRef.id}`,
    },
    {
      accountKey: clearing,
      amountMinor: -sign * input.amount.amountMinor,
      currency: input.amount.currency,
      memo: `payment ${input.paymentRef.id}`,
    },
  ];
  await writeEntryBody(
    tx,
    deps,
    claim.entryId,
    { legalEntityId: input.legalEntityId, propertyId: null, businessDate, description: 'Dispute' },
    [],
    lines,
  );
  await tx.audit({
    action: `finance.dispute.${input.kind}`,
    target: { type: 'journal_entry', id: claim.entryId },
    after: { paymentRef: input.paymentRef, disputeRef: input.disputeRef, amount: input.amount },
  });
  await tx.emit({
    type: 'finance.dispute.recorded',
    aggregate: { type: 'journal_entry', id: claim.entryId },
    payload: {
      entryId: claim.entryId,
      kind: input.kind,
      paymentRef: input.paymentRef,
      disputeRef: input.disputeRef,
      amount: input.amount,
    },
  });
  return { journalEntryId: claim.entryId, replayed: false };
}
