import type { TxContext } from '@portico/db';
import {
  BusinessRuleError,
  type EntityRef,
  type Money,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { LineDraft } from '../domain/ledger';
import { syncDepartedFolios } from './departed-folios';
import { recordDeposit, refundDeposit } from './deposits';
import { prepareDestination } from './folios';
import { findOriginalPayment } from './postings';
import {
  actorKey,
  claimEntry,
  type Deps,
  db,
  type FolioRow,
  findEntryByKey,
  loadFolio,
  lockMoneyFolios,
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
  const locked = (await lockMoneyFolios(tx, deps, [f0.id])).get(f0.id) as FolioRow;
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
  // Re-review #3 R3-P1-1(i) sibling: a corrected payment changes what a departed folio owes.
  await syncDepartedFolios(tx, deps, [folio.id], {
    reason: 'Payment corrected after reconciliation',
    entryId: claim.entryId,
    businessDate,
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
    /** Clearing provider key when the original payment is not in the ledger (per-acquirer clearing account). */
    provider?: string;
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
  const decoded = decodeMethod(original?.paymentMethod ?? 'card');
  const clearing = clearingSide(decoded.method, decoded.provider ?? input.provider ?? null, null).accountKey;
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

/**
 * Owner of a ledger target (ADR-0015): which property and legal entity a folio or booking deposit belongs to. A
 * booking's owner comes from reservations (booking directory, review P1-1); only deposits finance already holds for a
 * booking reservations does not know (opening balances imported from a previous system) are described from finance.
 */
export async function describeTarget(
  tx: TxContext,
  deps: Deps,
  ref: { type: 'folio' | 'booking'; id: string },
): Promise<{
  propertyId: string;
  legalEntityId: string;
  owner?: { type: string; id: string };
  payer?: { type: string; id: string | null };
} | null> {
  if (ref.type === 'booking') {
    const booking = await deps.ports.bookings.describeBooking(tx, ref.id);
    if (booking) {
      const p = await deps.ports.platform.getProperty(tx, booking.propertyId);
      return { propertyId: p.id, legalEntityId: p.legalEntityId };
    }
  }
  if (ref.type === 'folio') {
    const f = await db(tx)
      .selectFrom('finance.folios')
      .select(['property_id', 'legal_entity_id', 'owner_type', 'owner_id', 'payer_type', 'payer_id'])
      .where('id', '=', ref.id)
      .executeTakeFirst();
    // Re-review #3: who owns the folio (its stay or booking) and who pays it — payments resolves the folio's booking
    // family (double-collection guard) and whether a card's consent covers it.
    return f
      ? {
          propertyId: f.property_id,
          legalEntityId: f.legal_entity_id,
          owner: { type: f.owner_type, id: f.owner_id },
          payer: { type: f.payer_type, id: f.payer_id },
        }
      : null;
  }
  const acct = await db(tx)
    .selectFrom('finance.deposit_accounts')
    .select(['property_id', 'legal_entity_id'])
    .where('booking_id', '=', ref.id)
    .executeTakeFirst();
  // Only imported opening deposits exist for bookings reservations does not know; a booking folio alone never makes
  // an unknown booking acceptable for money (review P1-1).
  return acct ? { propertyId: acct.property_id, legalEntityId: acct.legal_entity_id } : null;
}

/**
 * THE predicate for money on a ledger target (ADR-0015 §3; review P1-1, R2-P1-3, AP-44). Finance applies it when it
 * posts, and payments asks it BEFORE any card is charged (LedgerPort `assertTargetUsable`), so the pre-check and the
 * posting can never disagree:
 *  - a folio must exist and belong to the scope;
 *  - a booking must be one reservations knows, at the scope's property and legal entity, and any deposits finance
 *    already holds for it must be held there too (an import or repair at another property blocks new money until
 *    finance moves them);
 *  - `outflow` (refunds, adjustments of money already received) also accepts an imported legacy deposit of a booking
 *    reservations does not know yet, so it can be paid back; new money never goes to one (`inflow`).
 */
export async function assertTargetInScope(
  tx: TxContext,
  deps: Deps,
  ref: { type: 'folio' | 'booking'; id: string },
  scope: { propertyId: string; legalEntityId: string },
  direction: 'inflow' | 'outflow' = 'inflow',
): Promise<void> {
  let owner: { propertyId: string; legalEntityId: string };
  if (ref.type === 'folio') {
    const f = await db(tx)
      .selectFrom('finance.folios')
      .select(['property_id', 'legal_entity_id'])
      .where('id', '=', ref.id)
      .executeTakeFirst();
    if (!f) throw new ValidationError('folio_not_found', 'The folio was not found.');
    owner = { propertyId: f.property_id, legalEntityId: f.legal_entity_id };
  } else {
    const booking = await deps.ports.bookings.describeBooking(tx, ref.id);
    const acct = await db(tx)
      .selectFrom('finance.deposit_accounts')
      .select(['property_id', 'legal_entity_id'])
      .where('booking_id', '=', ref.id)
      .executeTakeFirst();
    if (!booking) {
      if (direction === 'inflow' || !acct) {
        throw new BusinessRuleError(
          'ledger_target_unknown',
          acct
            ? "This booking's deposit was imported from the previous system, but the booking is not in Portico yet. No new money is taken for it until the booking is migrated. Nothing was charged or posted."
            : 'Portico has no booking with this reference, so the money could not be held for it. Check the booking code, or record the payment on the booking it belongs to. Nothing was posted.',
          { ref },
        );
      }
      owner = { propertyId: acct.property_id, legalEntityId: acct.legal_entity_id };
    } else {
      const p = await deps.ports.platform.getProperty(tx, booking.propertyId);
      owner = { propertyId: p.id, legalEntityId: p.legalEntityId };
      if (acct && (acct.property_id !== owner.propertyId || acct.legal_entity_id !== owner.legalEntityId)) {
        throw new BusinessRuleError(
          'deposit_account_conflict',
          "This booking's deposits are held at another property or hotel company. Finance must move them to the booking's property before more money is taken for it. Nothing was charged or posted.",
          { ref },
        );
      }
    }
  }
  if (owner.propertyId !== scope.propertyId || owner.legalEntityId !== scope.legalEntityId) {
    throw new BusinessRuleError(
      'scope_mismatch',
      `This ${ref.type} belongs to another property or legal entity than the one you are working in. Nothing was posted.`,
      { ref, expected: scope, actual: owner },
    );
  }
}

/** The property is operated by the legal entity the caller named (ledger calls without a folio or booking). */
export async function assertPropertyScope(
  tx: TxContext,
  deps: Deps,
  scope: { propertyId: string; legalEntityId: string },
): Promise<void> {
  const property = await deps.ports.platform.getProperty(tx, scope.propertyId);
  if (property.legalEntityId !== scope.legalEntityId) {
    throw new BusinessRuleError(
      'scope_mismatch',
      'The property is operated by another legal entity than the one given. Nothing was posted.',
      { scope },
    );
  }
}

/** Route D: a recorded payment/refund was matched to a statement line or bank confirmation (idempotent by key). */
export async function markPaymentVerified(
  tx: TxContext,
  input: {
    paymentRef: EntityRef;
    evidenceRef: EntityRef;
    idempotencyKey: string;
    scope?: { propertyId: string; legalEntityId: string };
  },
): Promise<{ verified: boolean; replayed: boolean }> {
  const exists = await db(tx)
    .selectFrom('finance.payment_verifications')
    .select('id')
    .where('idempotency_key', '=', input.idempotencyKey)
    .executeTakeFirst();
  if (exists) return { verified: true, replayed: true };
  const posting = await db(tx)
    .selectFrom('finance.postings as p')
    .innerJoin('finance.folios as f', 'f.id', 'p.folio_id')
    .select(['p.id', 'p.folio_id', 'p.property_id', 'f.legal_entity_id'])
    .where('p.payment_ref_type', '=', input.paymentRef.type)
    .where('p.payment_ref_id', '=', input.paymentRef.id)
    .executeTakeFirst();
  const movement = posting
    ? null
    : await db(tx)
        .selectFrom('finance.deposit_movements as m')
        .innerJoin('finance.deposit_accounts as a', 'a.id', 'm.deposit_account_id')
        .select(['m.id', 'a.property_id', 'a.legal_entity_id'])
        .where('m.payment_ref_type', '=', input.paymentRef.type)
        .where('m.payment_ref_id', '=', input.paymentRef.id)
        .executeTakeFirst();
  const owner = posting ?? movement;
  if (!owner) {
    throw new BusinessRuleError('payment_not_found', 'The payment to verify is not recorded in the ledger.', {
      paymentRef: input.paymentRef,
    });
  }
  requirePermission(tx, 'finance.posting.create', { propertyId: owner.property_id });
  if (
    input.scope &&
    (owner.property_id !== input.scope.propertyId || owner.legal_entity_id !== input.scope.legalEntityId)
  ) {
    throw new BusinessRuleError(
      'scope_mismatch',
      'This payment belongs to another property or legal entity than the one you are working in. Nothing was verified.',
      { paymentRef: input.paymentRef },
    );
  }
  await db(tx)
    .insertInto('finance.payment_verifications')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      payment_ref_type: input.paymentRef.type,
      payment_ref_id: input.paymentRef.id,
      evidence_type: input.evidenceRef.type,
      evidence_id: input.evidenceRef.id,
      idempotency_key: input.idempotencyKey,
      verified_at: tx.now,
      verified_by: actorKey(tx),
    })
    .execute();
  if (posting) {
    await tx.audit({
      action: 'finance.payment.verified',
      target: { type: 'folio', id: posting.folio_id },
      propertyId: posting.property_id,
      after: { paymentRef: input.paymentRef, evidenceRef: input.evidenceRef },
    });
  }
  return { verified: true, replayed: false };
}

/** Acquirer fees (MDR) from a settlement statement: an expense, never a guest-payment adjustment. */
export async function recordSettlementFees(
  tx: TxContext,
  deps: Deps,
  input: {
    legalEntityId: string;
    statementRef: EntityRef;
    amount: Money;
    provider: string;
    idempotencyKey: string;
  },
): Promise<{ journalEntryId: string; replayed: boolean }> {
  requirePermission(tx, 'finance.ledger.manage');
  if (input.amount.amountMinor <= 0) throw new ValidationError('invalid_amount', 'Fees must be positive.');
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: 'settlement-fees', ...rest });
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) return { journalEntryId: prior, replayed: true };
  await deps.ports.platform.getLegalEntity(tx, input.legalEntityId);
  const businessDate = tx.now.toISOString().slice(0, 10);
  const claim = await claimEntry(tx, {
    legalEntityId: input.legalEntityId,
    propertyId: null,
    entryType: 'payout',
    businessDate,
    idempotencyKey,
    requestHash: hash,
    source: input.statementRef,
    description: `Acquirer fees (${input.statementRef.id})`,
  });
  if (!claim.claimed) return { journalEntryId: claim.entryId, replayed: true };
  await writeEntryBody(
    tx,
    deps,
    claim.entryId,
    { legalEntityId: input.legalEntityId, propertyId: null, businessDate, description: 'Acquirer fees' },
    [],
    [
      {
        accountKey: 'payment_fees',
        amountMinor: input.amount.amountMinor,
        currency: input.amount.currency,
        memo: `statement ${input.statementRef.id}`,
      },
      {
        ...clearingSide('card', input.provider, null),
        amountMinor: -input.amount.amountMinor,
        currency: input.amount.currency,
      },
    ],
  );
  await tx.audit({
    action: 'finance.payout.fees',
    target: { type: 'journal_entry', id: claim.entryId },
    after: rest,
  });
  return { journalEntryId: claim.entryId, replayed: false };
}
