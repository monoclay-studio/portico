/**
 * Money commands. Each one runs INSIDE the caller's transaction and only records intent (the business record
 * + the provider operation). The provider call happens after commit (`executeOperation`), so a rolled-back
 * command can never have moved money, and a committed one always has a journal entry.
 *
 * Safety rules enforced here (steward review fixes):
 *  - the folio/booking must belong to the caller's property and its legal entity (P0-1);
 *  - one collection in flight per folio/booking, enforced by a unique index (P1-1);
 *  - a payment request owns its purpose on a reference: no second collection of the same deposit (P1-2);
 *  - customer- vs merchant-initiated is DERIVED from the consent record, never declared by the caller (P1-8);
 *  - business keys carry a request fingerprint; reuse with different content is refused (P2-3).
 *
 * Recorded payments (Route D — the hotel's own terminal or gateway, cash) are recorded as `recorded_unverified`,
 * posted at record time and verified by statement matching; bank transfers wait in `awaiting_receipt` and are
 * posted only once receipt is confirmed (P1-7). None of them is ever presented as provider-verified.
 */
import { pgCode, pgConstraint, type TxContext, withSavepoint } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  formatMoney,
  localDateIn,
  money,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { z } from 'zod';
import type {
  adjustmentInput,
  authorizeInput,
  CollectionPurpose,
  chargeInput,
  confirmBankTransferInput,
  recordAuthorizationInput,
  recordPaymentInput,
  recordRefundInput,
  refundInput,
} from '../contracts';
import { capturableMinor, refundableMinor } from '../domain/states';
import { PaymentsEvents } from '../events';
import type { PropertyInfo } from '../ports';
import { assertDestinationCovered, assertWithinConsent } from './consent';
import {
  clearingOf,
  ledgerKey,
  postPaymentLedger,
  postRefundLedger,
  postVerification,
  tryLedger,
} from './ledger';
import { assertBreakerAllows, createOperation } from './operations';
import { assertWithinFact, derivePurpose, folioOwedNow } from './purpose';
import {
  type AccountRow,
  type AuthorizationRow,
  actorKey,
  assertAccountUsable,
  assertLedgerTarget,
  assertPaymentsWritable,
  assertReferenceAt,
  assertSameRequest,
  db,
  loadAccount,
  loadProperty,
  lockCollectionRefs,
  type MethodRow,
  type PaymentRow,
  type PaymentsDeps,
  PendingVerificationBlockError,
  referenceContext,
  requestHash,
  resolveExceptionsByKey,
} from './shared';

export interface Started {
  id: string;
  operationId: string | null;
  replayed: boolean;
}

function capability(account: AccountRow, cap: string): boolean {
  return ((account.capabilities as string[]) ?? []).includes(cap);
}

function requireCapability(account: AccountRow, cap: string, what: string): void {
  if (!capability(account, cap)) {
    throw new BusinessRuleError(
      'capability_not_supported',
      `${what} is not supported by the provider of "${account.display_name}". Use another payment method or account.`,
      { capability: cap, accountId: account.id },
    );
  }
}

/**
 * Fix sweep SW-PAY-3 (AP-01 on the card record): a card is a parameter of a command at the property it was saved at.
 * A card the actor cannot read here is reported exactly like an unknown card. Using a card saved at a sister
 * property is an explicit, audited act of someone who may collect THERE too; the account's legal entity is then
 * checked against the acting property (`assertAccountUsable`), so a card never crosses hotel companies.
 */
async function loadUsableMethod(tx: TxContext, methodId: string, property: PropertyInfo): Promise<MethodRow> {
  const m = await db(tx)
    .selectFrom('payments.payment_methods')
    .selectAll()
    .where('id', '=', methodId)
    .executeTakeFirst();
  if (!m) throw new NotFoundError('payment_method', methodId);
  if (m.property_id !== property.id) {
    if (!tx.authz.can('payments.payment.collect', { propertyId: m.property_id })) {
      throw new NotFoundError('payment_method', methodId);
    }
    await tx.audit({
      action: 'payments.method.crossPropertyUse',
      target: { type: 'payment_method', id: m.id },
      propertyId: property.id,
      after: { savedAt: m.property_id, usedAt: property.id },
    });
  }
  if (m.status !== 'active') {
    throw new BusinessRuleError(
      'payment_method_inactive',
      `This saved card is ${m.status}. Ask the guest for another card or send a payment link.`,
    );
  }
  return m;
}

/**
 * P1-8 / fix sweep SW-PAY-4: who initiates is a server fact, never a client claim. The guest is present only when the
 * guest acts (booking engine, guest portal). Every use of a stored card by staff (desk charge, check-in hold, late
 * charge) is merchant-initiated and needs the cardholder's recorded agreement. How or when the card was saved (a
 * field the client declares) no longer decides it.
 */
export function deriveInitiator(tx: TxContext): 'customer' | 'merchant' {
  return tx.actor.kind === 'guest' ? 'customer' : 'merchant';
}

function defaultPurpose(ref: { type: 'folio' | 'booking' }): CollectionPurpose {
  return ref.type === 'booking' ? 'deposit' : 'balance';
}

/** A payment request's purpose as a collection purpose (incidentals pre-authorisations and custom links are neither). */
const REQUEST_PURPOSE: Record<string, string> = {
  deposit: 'deposit',
  balance: 'balance',
  incidentals_preauth: 'incidentals',
  custom: 'custom',
};

const isLedgerRef = (ref: { type: string; id: string }): ref is { type: 'folio' | 'booking'; id: string } =>
  ref.type === 'folio' || ref.type === 'booking';

/**
 * P1-2 (until collection plans exist): a payment link owns the money it asks for. Fix sweep SW-PAY-1/2, re-review #3
 * R3-P2-1 and #5 R5-P1-1: every collection path calls this (charge, capture, recorded payment, VCC through charge; holds
 * warn early) under the family collection lock, with the purpose DERIVED from the facts (`purpose.ts` — no label the
 * client sends reaches it). A booking, its stays and their folios are ONE family. A new collection needs the stated
 * separate-collection reason (audited) when:
 *  - any link is open or paid on the very same reference, whatever its purpose;
 *  - a link in the family is still open (the guest may still pay it);
 *  - a paid link in the family has the same purpose;
 *  - it collects a folio's balance or a no-show fee beyond what the folio owes now, less deposits held for the booking
 *    and payments not yet posted — before a paid deposit is applied, the same money would be collected twice.
 */
async function assertCollectionOwnership(
  d: PaymentsDeps,
  tx: TxContext,
  ref: { type: 'folio' | 'booking'; id: string },
  purpose: CollectionPurpose,
  override: { reason: string } | undefined,
  opts: { amountMinor?: number } = {},
): Promise<void> {
  await lockCollectionRefs(d, tx, [ref]);
  const { bookingId } = await referenceContext(d, tx, ref);
  const owners = await db(tx)
    .selectFrom('payments.payment_requests')
    .select(['id', 'purpose', 'status', 'amount_minor', 'paid_minor', 'currency', 'ref_type', 'ref_id'])
    .where('status', 'in', ['open', 'partially_paid', 'paid'])
    .where((eb) =>
      eb.or([
        eb.and([eb('ref_type', '=', ref.type), eb('ref_id', '=', ref.id)]),
        ...(bookingId ? [eb('family_booking_id', '=', bookingId)] : []),
      ]),
    )
    .orderBy('created_at')
    .execute();
  // R4-P3-3 / R5-P1-1: a folio's balance (or a no-show fee, which is part of it) collected after a paid link elsewhere in
  // the family is the normal flow only up to what the folio owes now — less deposits held for the booking (a folio nets
  // a deposit only once it is applied) and less money not yet posted; beyond it the same money could be taken twice.
  const folioMoney = purpose === 'balance' || purpose === 'no_show';
  const withinOwed =
    folioMoney && ref.type === 'folio' && opts.amountMinor !== undefined && owners.length > 0
      ? opts.amountMinor <= (await folioOwedNow(d, tx, ref.id, bookingId))
      : false;
  const owner = owners.find(
    (r) =>
      (r.ref_type === ref.type && r.ref_id === ref.id) ||
      r.status !== 'paid' ||
      REQUEST_PURPOSE[r.purpose] === purpose ||
      (folioMoney && !withinOwed),
  );
  if (!owner) return;
  if (override?.reason) {
    await tx.audit({
      action: 'payments.collection.ownershipOverride',
      target: { type: 'payment_request', id: owner.id },
      reason: override.reason,
      after: { ref, purpose, linkRef: { type: owner.ref_type, id: owner.ref_id } },
    });
    return;
  }
  const what = REQUEST_PURPOSE[owner.purpose] ?? owner.purpose;
  const where =
    owner.ref_type === ref.type && owner.ref_id === ref.id
      ? `this ${ref.type}`
      : `this booking (its ${owner.ref_type})`;
  throw new BusinessRuleError(
    'collection_owned_by_payment_request',
    `A payment link for the ${what} of ${where} is ${owner.status.replace('_', ' ')} (${formatMoney(money(owner.paid_minor, owner.currency))} paid of ${formatMoney(money(owner.amount_minor, owner.currency))}). Collecting again — whatever it is called — could charge the guest twice. Cancel the link first, or confirm this is a separate collection by giving a reason.`,
    { paymentRequestId: owner.id, purpose },
  );
}

/** Map unique-index races to the explanations staff need (and re-read a concurrent same-key winner). */
function constraintOf(err: unknown): string | undefined {
  return pgCode(err) === '23505' ? pgConstraint(err) : undefined;
}

async function pendingPaymentError(tx: TxContext, ref: { type: string; id: string }): Promise<Error> {
  const p = await db(tx)
    .selectFrom('payments.payments')
    .select(['id', 'amount_minor', 'currency', 'created_at'])
    .where('ref_type', '=', ref.type as 'folio')
    .where('ref_id', '=', ref.id)
    .where('status', 'in', ['processing', 'pending_verification'])
    .orderBy('created_at')
    .executeTakeFirst();
  if (!p) {
    return new ConflictError(
      'payment_pending_verification',
      'Another collection for this reference started at the same moment. Check its status before trying again — charging now could charge the guest twice.',
    );
  }
  return new PendingVerificationBlockError({
    kind: 'payment',
    id: p.id,
    amountMinor: p.amount_minor,
    currency: p.currency,
    since: new Date(p.created_at),
  });
}

async function insertPayment(
  tx: TxContext,
  values: Record<string, unknown>,
  ref: { type: string; id: string },
  businessKey: string,
  hash: string,
): Promise<{ inserted: true } | { inserted: false; existingId: string }> {
  try {
    await withSavepoint(tx, 'payments_insert', () =>
      db(tx)
        .insertInto('payments.payments')
        .values(values as never)
        .execute(),
    );
    return { inserted: true };
  } catch (err) {
    const c = constraintOf(err);
    if (c === 'payments_tenant_id_business_key_key') {
      const existing = await db(tx)
        .selectFrom('payments.payments')
        .select(['id', 'request_hash'])
        .where('business_key', '=', businessKey)
        .executeTakeFirstOrThrow();
      assertSameRequest(existing.request_hash, hash, 'payment');
      return { inserted: false, existingId: existing.id };
    }
    if (c === 'payments_one_inflight_per_ref') throw await pendingPaymentError(tx, ref);
    if (c === 'payments_terminal_reference_once' || c === 'payments_cash_bank_reference_once') {
      throw new ConflictError(
        'duplicate_reference',
        'A payment with this reference was already recorded (same terminal and day, or same receipt/bank reference). Check it before recording again — recording twice would double the guest’s payment. If it really is a second payment, record it with an override reason.',
      );
    }
    throw err;
  }
}

// ───────────────────────── authorizations ─────────────────────────

export async function authorize(
  d: PaymentsDeps,
  tx: TxContext,
  input: Omit<z.infer<typeof authorizeInput>, 'initiator'> & { businessKey: string },
): Promise<Started> {
  requirePermission(tx, 'payments.payment.collect', { propertyId: input.propertyId });
  const businessKey = `authorize:${input.businessKey}`;
  const hash = requestHash({ p: input.propertyId, m: input.methodId, a: input.amount, r: input.ref });
  const existing = await db(tx)
    .selectFrom('payments.authorizations')
    .select(['id', 'request_hash'])
    .where('business_key', '=', businessKey)
    .executeTakeFirst();
  if (existing) {
    assertSameRequest(existing.request_hash, hash, 'authorization');
    return { id: existing.id, operationId: null, replayed: true };
  }
  await assertPaymentsWritable(d, tx, input.propertyId);
  const property = await loadProperty(d, tx, input.propertyId);
  await assertReferenceAt(d, tx, input.ref, property.id);
  const method = await loadUsableMethod(tx, input.methodId, property);
  const account = await loadAccount(tx, method.account_id);
  assertAccountUsable(account, property, input.amount.currency);
  requireCapability(account, 'authorize', 'Pre-authorization');
  const initiator = deriveInitiator(tx);
  // ADR-0015 Amendment 2 / R3-P1-2: inside the cardholder's consent (purpose, bookings, amount), whoever acts.
  await assertWithinConsent(d, tx, method, property, initiator, {
    kind: 'hold',
    purpose: 'guarantee',
    amount: input.amount,
    ref: input.ref,
  });
  // SW-PAY-1: a hold is the first half of hold-then-capture — refuse it early when a link owns this collection.
  if (isLedgerRef(input.ref)) {
    await assertCollectionOwnership(d, tx, input.ref, defaultPurpose(input.ref), input.separateCollection, {
      amountMinor: input.amount.amountMinor,
    });
  } else {
    await lockCollectionRefs(d, tx, [input.ref]);
  }
  if (initiator === 'merchant') await assertDestinationCovered(d, tx, method, property, input.ref);
  const mode = d.registry.modeFor(tx, account);
  await assertBreakerAllows(d, tx, account);
  const id = newId(tx.now.getTime());
  try {
    await withSavepoint(tx, 'payments_insert', () =>
      db(tx)
        .insertInto('payments.authorizations')
        .values({
          id,
          tenant_id: tx.tenantId,
          property_id: input.propertyId,
          legal_entity_id: property.legalEntityId,
          account_id: account.id,
          method_id: method.id,
          ref_type: input.ref.type,
          ref_id: input.ref.id,
          business_key: businessKey,
          request_hash: hash,
          currency: input.amount.currency,
          amount_minor: input.amount.amountMinor,
          status: 'processing',
          mode,
          initiator,
          provider_ref: null,
          external_reference: null,
          expires_at: null,
          decline: null,
          created_by: actorKey(tx),
          created_at: tx.now,
        })
        .execute(),
    );
  } catch (err) {
    const c = constraintOf(err);
    if (c === 'authorizations_tenant_id_business_key_key') {
      const winner = await db(tx)
        .selectFrom('payments.authorizations')
        .select(['id', 'request_hash'])
        .where('business_key', '=', businessKey)
        .executeTakeFirstOrThrow();
      assertSameRequest(winner.request_hash, hash, 'authorization');
      return { id: winner.id, operationId: null, replayed: true };
    }
    if (c === 'authorizations_one_inflight_per_ref') {
      const pending = await db(tx)
        .selectFrom('payments.authorizations')
        .select(['id', 'amount_minor', 'currency', 'created_at'])
        .where('ref_type', '=', input.ref.type)
        .where('ref_id', '=', input.ref.id)
        .where('status', 'in', ['processing', 'pending_verification'])
        .executeTakeFirst();
      throw new PendingVerificationBlockError({
        kind: 'authorization',
        id: pending?.id ?? 'unknown',
        amountMinor: pending?.amount_minor ?? input.amount.amountMinor,
        currency: pending?.currency ?? input.amount.currency,
        since: pending ? new Date(pending.created_at) : tx.now,
      });
    }
    throw err;
  }
  const operationId = await createOperation(tx, {
    propertyId: input.propertyId,
    account,
    kind: 'authorize',
    targetType: 'authorization',
    targetId: id,
    authorizationId: id,
    amount: money(input.amount.amountMinor, input.amount.currency),
    mode,
  });
  await tx.audit({
    action: 'payments.authorization.request',
    target: { type: 'authorization', id },
    propertyId: input.propertyId,
    after: { amount: input.amount, ref: input.ref, methodId: method.id, initiator, mode, operationId },
  });
  return { id, operationId, replayed: false };
}

async function loadAuthorization(tx: TxContext, id: string): Promise<AuthorizationRow> {
  const a = await db(tx)
    .selectFrom('payments.authorizations')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!a) throw new NotFoundError('authorization', id);
  return a;
}

function assertOpenAuthorization(a: AuthorizationRow, action: string): void {
  if (a.status === 'authorized' || a.status === 'partially_captured') return;
  const why: Record<string, string> = {
    processing: 'the hold is still being requested',
    pending_verification: 'the hold is still being verified with the provider — check its status first',
    captured: 'the hold has already been fully collected',
    voided: 'the hold was released',
    expired: 'the hold has expired — take a new authorization or payment',
    failed: 'the hold was declined',
  };
  throw new BusinessRuleError('authorization_not_open', `Cannot ${action}: ${why[a.status] ?? a.status}.`, {
    authorizationId: a.id,
    status: a.status,
  });
}

export async function incrementAuthorization(
  d: PaymentsDeps,
  tx: TxContext,
  input: { authorizationId: string; additionalAmount: { amountMinor: number; currency: string } },
): Promise<Started> {
  const a = await loadAuthorization(tx, input.authorizationId);
  requirePermission(tx, 'payments.payment.collect', { propertyId: a.property_id });
  await assertPaymentsWritable(d, tx, a.property_id);
  assertOpenAuthorization(a, 'increase the hold');
  if (a.mode === 'recorded') {
    throw new BusinessRuleError(
      'recorded_authorization',
      "This hold was taken on the hotel's own terminal. Increase it there and record the new approval code as a new manual authorization.",
    );
  }
  if (input.additionalAmount.currency !== a.currency) {
    throw new ValidationError(
      'currency_mismatch',
      `The hold is in ${a.currency}; increase it in the same currency.`,
    );
  }
  const account = await loadAccount(tx, a.account_id);
  requireCapability(account, 'incrementalAuthorize', 'Increasing a hold');
  // R3-P1-2: the increased hold, as a whole, stays inside the cardholder's consent.
  if (a.method_id) {
    const method = await db(tx)
      .selectFrom('payments.payment_methods')
      .selectAll()
      .where('id', '=', a.method_id)
      .executeTakeFirstOrThrow();
    await assertWithinConsent(
      d,
      tx,
      method,
      await loadProperty(d, tx, a.property_id),
      a.initiator === 'customer' ? 'customer' : 'merchant',
      {
        kind: 'hold',
        purpose: 'guarantee',
        amount: { amountMinor: a.amount_minor + input.additionalAmount.amountMinor, currency: a.currency },
        ref: { type: a.ref_type, id: a.ref_id },
        authorizationId: a.id,
      },
    );
  }
  const inflight = await db(tx)
    .selectFrom('payments.provider_operations')
    .select('id')
    .where('authorization_id', '=', a.id)
    .where('kind', 'in', ['increment', 'void'])
    .where('status', 'in', ['pending', 'sent', 'pending_verification'])
    .executeTakeFirst();
  if (inflight) {
    throw new ConflictError(
      'authorization_change_in_progress',
      'Another change to this hold is still in progress. Wait for it to finish before increasing it again.',
    );
  }
  await assertBreakerAllows(d, tx, account);
  const operationId = await createOperation(tx, {
    propertyId: a.property_id,
    account,
    kind: 'increment',
    targetType: 'authorization',
    targetId: a.id,
    authorizationId: a.id,
    amount: money(input.additionalAmount.amountMinor, a.currency),
    mode: a.mode as 'live' | 'sandbox' | 'simulate',
  });
  await tx.audit({
    action: 'payments.authorization.incrementRequest',
    target: { type: 'authorization', id: a.id },
    propertyId: a.property_id,
    after: { additionalAmount: input.additionalAmount, operationId },
  });
  return { id: a.id, operationId, replayed: false };
}

export async function capture(
  d: PaymentsDeps,
  tx: TxContext,
  input: {
    authorizationId: string;
    amount?: { amountMinor: number; currency: string };
    ledgerRef?: { type: 'folio' | 'booking'; id: string };
    separateCollection?: { reason: string };
    businessKey: string;
  },
): Promise<Started> {
  const businessKey = `capture:${input.businessKey}`;
  const hash = requestHash({ a: input.authorizationId, m: input.amount ?? null, r: input.ledgerRef ?? null });
  const existing = await db(tx)
    .selectFrom('payments.payments')
    .select(['id', 'request_hash'])
    .where('business_key', '=', businessKey)
    .executeTakeFirst();
  if (existing) {
    assertSameRequest(existing.request_hash, hash, 'capture');
    return { id: existing.id, operationId: null, replayed: true };
  }
  const a = await loadAuthorization(tx, input.authorizationId);
  requirePermission(tx, 'payments.payment.collect', { propertyId: a.property_id });
  await assertPaymentsWritable(d, tx, a.property_id);
  assertOpenAuthorization(a, 'collect from the hold');
  if (a.mode === 'recorded') {
    throw new BusinessRuleError(
      'recorded_authorization',
      "This hold was taken on the hotel's own terminal. Complete it there and record the payment with its approval code (linking this authorization).",
    );
  }
  const capturable = capturableMinor({
    amountMinor: a.amount_minor,
    capturedMinor: a.captured_minor,
    captureReservedMinor: a.capture_reserved_minor,
  });
  const amountMinor = input.amount?.amountMinor ?? capturable;
  if (input.amount && input.amount.currency !== a.currency) {
    throw new ValidationError(
      'currency_mismatch',
      `The hold is in ${a.currency}; collect in the same currency.`,
    );
  }
  if (amountMinor <= 0 || amountMinor > capturable) {
    throw new BusinessRuleError(
      'capture_exceeds_hold',
      `Only ${formatMoney(money(capturable, a.currency))} can still be collected from this hold. Collect that amount and take the rest as a separate payment.`,
      { capturableMinor: capturable, requestedMinor: amountMinor },
    );
  }
  const account = await loadAccount(tx, a.account_id);
  if (amountMinor < capturable) requireCapability(account, 'partialCapture', 'Collecting part of a hold');
  const ref =
    input.ledgerRef ??
    (a.ref_type === 'folio' || a.ref_type === 'booking'
      ? { type: a.ref_type as 'folio' | 'booking', id: a.ref_id }
      : null);
  if (!ref) {
    throw new ValidationError(
      'ledger_target_required',
      'Say which folio (or booking deposit) this collection pays, so the bill shows it.',
    );
  }
  const property = await loadProperty(d, tx, a.property_id);
  await assertLedgerTarget(d, tx, ref, property);
  // R3-P1-2 / R4-P1-2: a merchant-initiated capture stays inside the cardholder's consent (the bill it pays is covered;
  // the running total stays within the agreed amount), checked under the card lock — taken BEFORE the collection lock
  // (domain-map order: authorization → card → collection → folio → request).
  // R4-P3-6: a customer-initiated hold is captured only onto its own booking family.
  const holdRef = { type: a.ref_type, id: a.ref_id };
  const holdMethod = a.method_id
    ? await db(tx)
        .selectFrom('payments.payment_methods')
        .selectAll()
        .where('id', '=', a.method_id)
        .executeTakeFirstOrThrow()
    : null;
  if (holdMethod) {
    const method = holdMethod;
    if (a.initiator === 'merchant') {
      await assertWithinConsent(d, tx, method, property, 'merchant', {
        kind: 'capture',
        purpose: 'guarantee',
        amount: { amountMinor, currency: a.currency },
        ref,
        authorizationId: a.id,
      });
    } else {
      const [mine, target] = [await referenceContext(d, tx, holdRef), await referenceContext(d, tx, ref)];
      const sameFamily =
        (holdRef.type === ref.type && holdRef.id === ref.id) ||
        (mine.bookingId !== null && mine.bookingId === target.bookingId);
      if (!sameFamily) {
        throw new BusinessRuleError(
          'capture_outside_booking',
          'This hold was given by the guest for their own booking; it can only pay that booking’s bills. Ask the guest to pay the other bill.',
          { authorizationId: a.id },
        );
      }
    }
  }
  // Fix sweep SW-PAY-1: hold-then-capture is a collection like any other. The money a link owns — on the ledger
  // target, and on the booking or folio the hold was taken for when the capture moves it elsewhere — is not taken
  // again without a stated reason (audited). Both references are locked in a fixed order.
  const refs =
    isLedgerRef(holdRef) && (holdRef.type !== ref.type || holdRef.id !== ref.id) ? [ref, holdRef] : [ref];
  await lockCollectionRefs(d, tx, refs);
  for (const r of refs) {
    await assertCollectionOwnership(d, tx, r, defaultPurpose(r), input.separateCollection, {
      amountMinor,
    });
  }
  // Amendment 4 rule 2, under the collection lock: where a merchant hold's money lands is still covered.
  if (holdMethod && a.initiator === 'merchant')
    await assertDestinationCovered(d, tx, holdMethod, property, ref);
  await assertBreakerAllows(d, tx, account);
  const id = newId(tx.now.getTime());
  const inserted = await insertPayment(
    tx,
    {
      id,
      tenant_id: tx.tenantId,
      property_id: a.property_id,
      legal_entity_id: a.legal_entity_id,
      account_id: a.account_id,
      method_id: a.method_id,
      authorization_id: a.id,
      payment_request_id: null,
      virtual_card_id: null,
      kind: 'capture',
      purpose: defaultPurpose(ref),
      method: 'card',
      initiator: a.initiator,
      ref_type: ref.type,
      ref_id: ref.id,
      business_key: businessKey,
      request_hash: hash,
      currency: a.currency,
      amount_minor: amountMinor,
      status: 'processing',
      mode: a.mode,
      ledger_status: 'not_required',
      created_by: actorKey(tx),
      created_at: tx.now,
    },
    ref,
    businessKey,
    hash,
  );
  if (!inserted.inserted) return { id: inserted.existingId, operationId: null, replayed: true };
  await db(tx)
    .updateTable('payments.authorizations')
    .set({ capture_reserved_minor: a.capture_reserved_minor + amountMinor, version: a.version + 1 })
    .where('id', '=', a.id)
    .execute();
  const operationId = await createOperation(tx, {
    propertyId: a.property_id,
    account,
    kind: 'capture',
    targetType: 'payment',
    targetId: id,
    authorizationId: a.id,
    amount: money(amountMinor, a.currency),
    mode: a.mode as 'live' | 'sandbox' | 'simulate',
  });
  await tx.audit({
    action: 'payments.authorization.captureRequest',
    target: { type: 'payment', id },
    propertyId: a.property_id,
    after: { authorizationId: a.id, amountMinor, currency: a.currency, ref, operationId },
  });
  return { id, operationId, replayed: false };
}

export async function voidAuthorization(
  d: PaymentsDeps,
  tx: TxContext,
  input: { authorizationId: string; reason: string },
): Promise<Started> {
  const a = await loadAuthorization(tx, input.authorizationId);
  requirePermission(tx, 'payments.payment.collect', { propertyId: a.property_id });
  await assertPaymentsWritable(d, tx, a.property_id);
  assertOpenAuthorization(a, 'release the hold');
  if (a.capture_reserved_minor > 0) {
    throw new ConflictError(
      'capture_in_progress',
      'A collection from this hold is still in progress. Wait until it is confirmed before releasing the rest.',
    );
  }
  if (a.mode === 'recorded') {
    // Released on the hotel's own terminal: record it (no provider call exists for this account).
    await db(tx)
      .updateTable('payments.authorizations')
      .set({ status: a.captured_minor > 0 ? 'captured' : 'voided', version: a.version + 1 })
      .where('id', '=', a.id)
      .execute();
    await tx.audit({
      action: 'payments.authorization.releaseRecorded',
      target: { type: 'authorization', id: a.id },
      propertyId: a.property_id,
      reason: input.reason,
    });
    await tx.emit({
      type: PaymentsEvents.authorizationVoided,
      propertyId: a.property_id,
      aggregate: { type: 'authorization', id: a.id },
      payload: { authorizationId: a.id, releasedMinor: a.amount_minor - a.captured_minor, recorded: true },
    });
    return { id: a.id, operationId: null, replayed: false };
  }
  const account = await loadAccount(tx, a.account_id);
  await assertBreakerAllows(d, tx, account);
  const inflight = await db(tx)
    .selectFrom('payments.provider_operations')
    .select('id')
    .where('authorization_id', '=', a.id)
    .where('kind', '=', 'void')
    .where('status', 'in', ['pending', 'sent', 'pending_verification'])
    .executeTakeFirst();
  if (inflight) return { id: a.id, operationId: inflight.id, replayed: true };
  const operationId = await createOperation(tx, {
    propertyId: a.property_id,
    account,
    kind: 'void',
    targetType: 'authorization',
    targetId: a.id,
    authorizationId: a.id,
    amount: money(0, a.currency),
    mode: a.mode as 'live' | 'sandbox' | 'simulate',
  });
  await tx.audit({
    action: 'payments.authorization.voidRequest',
    target: { type: 'authorization', id: a.id },
    propertyId: a.property_id,
    reason: input.reason,
    after: { operationId },
  });
  return { id: a.id, operationId, replayed: false };
}

// ───────────────────────── charges ─────────────────────────

export interface ChargeExtras {
  paymentRequestId?: string;
  virtualCardId?: string;
  method?: 'card' | 'virtual_card';
}

export type ChargeCommand = Omit<z.infer<typeof chargeInput>, 'initiator'> & { businessKey: string };

export async function charge(
  d: PaymentsDeps,
  tx: TxContext,
  input: ChargeCommand,
  extras: ChargeExtras = {},
): Promise<Started> {
  requirePermission(tx, 'payments.payment.collect', { propertyId: input.propertyId });
  const businessKey = `charge:${input.businessKey}`;
  const hash = requestHash({
    p: input.propertyId,
    m: input.methodId,
    a: input.amount,
    r: input.ref,
    u: input.purpose ?? defaultPurpose(input.ref),
  });
  const existing = await db(tx)
    .selectFrom('payments.payments')
    .select(['id', 'request_hash'])
    .where('business_key', '=', businessKey)
    .executeTakeFirst();
  if (existing) {
    assertSameRequest(existing.request_hash, hash, 'payment');
    return { id: existing.id, operationId: null, replayed: true };
  }
  await assertPaymentsWritable(d, tx, input.propertyId);
  const property = await loadProperty(d, tx, input.propertyId);
  await assertLedgerTarget(d, tx, input.ref, property);
  const method = await loadUsableMethod(tx, input.methodId, property);
  const account = await loadAccount(tx, method.account_id);
  assertAccountUsable(account, property, input.amount.currency);
  requireCapability(account, 'charge', 'Charging a card');
  const initiator = deriveInitiator(tx);
  // ADR-0015 Amendment 4 rule 1 (R5-P1-1): the purpose is the fact that justifies the money, not the client's label.
  const fact = await derivePurpose(d, tx, input.ref, input.purpose);
  const purpose = fact.purpose;
  await assertWithinConsent(d, tx, method, property, initiator, {
    kind: 'charge',
    purpose,
    amount: input.amount,
    ref: input.ref,
  });
  await assertCollectionOwnership(d, tx, input.ref, purpose, input.separateCollection, {
    amountMinor: input.amount.amountMinor,
  });
  // One collection in flight per reference (the unique index is the backstop): an unresolved payment on it is the
  // first thing staff must see — it may already have taken the money the fact still allows.
  const inflight = await db(tx)
    .selectFrom('payments.payments')
    .select('id')
    .where('ref_type', '=', input.ref.type)
    .where('ref_id', '=', input.ref.id)
    .where('status', 'in', ['processing', 'pending_verification'])
    .executeTakeFirst();
  if (inflight) throw await pendingPaymentError(tx, input.ref);
  if (initiator === 'merchant') {
    // Under the collection lock: within what the fact still allows (deposit due, folio owed, penalty owed), and the
    // destination is still covered (no other stay's charges moved onto it while this charge waited) — rule 2.
    await assertWithinFact(d, tx, method, fact, input.ref, input.amount);
    await assertDestinationCovered(d, tx, method, property, input.ref);
  }
  const mode = d.registry.modeFor(tx, account);
  await assertBreakerAllows(d, tx, account);
  const id = newId(tx.now.getTime());
  const inserted = await insertPayment(
    tx,
    {
      id,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      legal_entity_id: property.legalEntityId,
      account_id: account.id,
      method_id: method.id,
      authorization_id: null,
      payment_request_id: extras.paymentRequestId ?? null,
      virtual_card_id: extras.virtualCardId ?? null,
      kind: 'charge',
      purpose,
      purpose_basis: fact.basis,
      method: extras.method ?? (method.kind === 'virtual_card' ? 'virtual_card' : 'card'),
      initiator,
      ref_type: input.ref.type,
      ref_id: input.ref.id,
      business_key: businessKey,
      request_hash: hash,
      currency: input.amount.currency,
      amount_minor: input.amount.amountMinor,
      status: 'processing',
      mode,
      card_brand: method.brand,
      card_last4: method.last4,
      ledger_status: 'not_required',
      note: input.description ?? null,
      created_by: actorKey(tx),
      created_at: tx.now,
    },
    input.ref,
    businessKey,
    hash,
  );
  if (!inserted.inserted) return { id: inserted.existingId, operationId: null, replayed: true };
  const operationId = await createOperation(tx, {
    propertyId: input.propertyId,
    account,
    kind: 'charge',
    targetType: 'payment',
    targetId: id,
    amount: money(input.amount.amountMinor, input.amount.currency),
    mode,
  });
  await tx.audit({
    action: 'payments.payment.chargeRequest',
    target: { type: 'payment', id },
    propertyId: input.propertyId,
    after: {
      amount: input.amount,
      ref: input.ref,
      purpose,
      methodId: method.id,
      initiator,
      mode,
      operationId,
    },
  });
  return { id, operationId, replayed: false };
}

// ───────────────────────── refunds ─────────────────────────

async function loadPaymentForUpdate(tx: TxContext, id: string): Promise<PaymentRow> {
  const p = await db(tx)
    .selectFrom('payments.payments')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!p) throw new NotFoundError('payment', id);
  return p;
}

function assertRefundAmount(p: PaymentRow, amount: { amountMinor: number; currency: string }): void {
  if (amount.currency !== p.currency) {
    throw new ValidationError(
      'currency_mismatch',
      `The payment was in ${p.currency}; refund in the same currency.`,
    );
  }
  const refundable = refundableMinor({
    amountMinor: p.amount_minor,
    adjustedMinor: p.adjusted_minor,
    refundedMinor: p.refunded_minor,
    refundReservedMinor: p.refund_reserved_minor,
  });
  if (amount.amountMinor > refundable) {
    const m = (n: number) => formatMoney(money(n, p.currency));
    throw new BusinessRuleError(
      'refund_exceeds_refundable',
      `Only ${m(refundable)} of this payment can still be refunded (collected ${m(p.amount_minor + p.adjusted_minor)}${p.adjusted_minor ? ' after corrections' : ''}, already refunded or in progress ${m(p.refunded_minor + p.refund_reserved_minor)}).`,
      { refundableMinor: refundable, requestedMinor: amount.amountMinor },
    );
  }
}

async function assertNotDisputed(tx: TxContext, paymentId: string): Promise<void> {
  const d = await db(tx)
    .selectFrom('payments.disputes')
    .select(['id', 'status'])
    .where('payment_id', '=', paymentId)
    .where('status', 'not in', ['won', 'accepted'])
    .executeTakeFirst();
  if (d) {
    throw new BusinessRuleError(
      'payment_disputed',
      d.status === 'lost'
        ? 'The guest’s bank already took this money back in a dispute; refunding it as well would pay the guest twice.'
        : 'This payment is under dispute with the guest’s bank. Do not refund it now — the bank may return the money to the guest as well. Work the dispute instead.',
      { disputeId: d.id, status: d.status },
    );
  }
}

export async function refund(
  d: PaymentsDeps,
  tx: TxContext,
  input: z.infer<typeof refundInput> & { businessKey: string },
): Promise<Started> {
  const businessKey = `refund:${input.businessKey}`;
  const hash = requestHash({ p: input.paymentId, a: input.amount });
  const existing = await db(tx)
    .selectFrom('payments.refunds')
    .select(['id', 'request_hash'])
    .where('business_key', '=', businessKey)
    .executeTakeFirst();
  if (existing) {
    assertSameRequest(existing.request_hash, hash, 'refund');
    return { id: existing.id, operationId: null, replayed: true };
  }
  const p = await loadPaymentForUpdate(tx, input.paymentId);
  // A concurrent same-key request may have committed while we waited for the payment lock.
  const winner = await db(tx)
    .selectFrom('payments.refunds')
    .select(['id', 'request_hash'])
    .where('business_key', '=', businessKey)
    .executeTakeFirst();
  if (winner) {
    assertSameRequest(winner.request_hash, hash, 'refund');
    return { id: winner.id, operationId: null, replayed: true };
  }
  requirePermission(tx, 'payments.payment.refund', { propertyId: p.property_id });
  await assertPaymentsWritable(d, tx, p.property_id);
  if (p.mode === 'recorded') {
    throw new BusinessRuleError(
      'recorded_payment_refund',
      'This payment was taken outside Portico (own terminal, cash or bank transfer). Refund it the same way and record the refund with its reference.',
    );
  }
  if (p.status !== 'succeeded') {
    throw new BusinessRuleError(
      'payment_not_refundable',
      p.status === 'pending_verification' || p.status === 'processing'
        ? 'This payment is still being verified. A refund is possible once the provider confirms it.'
        : 'This payment was not collected, so there is nothing to refund.',
      { status: p.status },
    );
  }
  await assertNotDisputed(tx, p.id);
  assertRefundAmount(p, input.amount);
  const account = await loadAccount(tx, p.account_id as string);
  if (input.amount.amountMinor < p.amount_minor)
    requireCapability(account, 'partialRefund', 'Partial refunds');
  await assertBreakerAllows(d, tx, account);
  await db(tx)
    .updateTable('payments.payments')
    .set({
      refund_reserved_minor: p.refund_reserved_minor + input.amount.amountMinor,
      version: p.version + 1,
    })
    .where('id', '=', p.id)
    .execute();
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('payments.refunds')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: p.property_id,
      payment_id: p.id,
      account_id: p.account_id,
      business_key: businessKey,
      request_hash: hash,
      currency: p.currency,
      amount_minor: input.amount.amountMinor,
      reason: input.reason,
      status: 'processing',
      mode: p.mode,
      provider_ref: null,
      external_reference: null,
      failure: null,
      ledger_status: 'not_required',
      ledger_posting_id: null,
      ledger_error: null,
      created_by: actorKey(tx),
      created_at: tx.now,
    })
    .execute();
  const operationId = await createOperation(tx, {
    propertyId: p.property_id,
    account,
    kind: 'refund',
    targetType: 'refund',
    targetId: id,
    amount: money(input.amount.amountMinor, p.currency),
    mode: p.mode as 'live' | 'sandbox' | 'simulate',
  });
  await tx.audit({
    action: 'payments.refund.request',
    target: { type: 'refund', id },
    propertyId: p.property_id,
    reason: input.reason,
    after: { paymentId: p.id, amount: input.amount, operationId },
  });
  return { id, operationId, replayed: false };
}

// ───────────────────────── Route D: recorded payments, authorizations, refunds ─────────────────────────

export async function recordPayment(
  d: PaymentsDeps,
  tx: TxContext,
  input: z.infer<typeof recordPaymentInput> & { businessKey: string },
): Promise<Started> {
  requirePermission(tx, 'payments.externalRecord.create', { propertyId: input.propertyId });
  const businessKey = `record:${input.businessKey}`;
  const hash = requestHash({
    p: input.propertyId,
    m: input.method,
    a: input.amount,
    r: input.ref,
    x: input.reference,
    t: input.terminalId ?? null,
    at: input.receivedAt,
  });
  const existing = await db(tx)
    .selectFrom('payments.payments')
    .select(['id', 'request_hash'])
    .where('business_key', '=', businessKey)
    .executeTakeFirst();
  if (existing) {
    assertSameRequest(existing.request_hash, hash, 'payment record');
    return { id: existing.id, operationId: null, replayed: true };
  }
  await assertPaymentsWritable(d, tx, input.propertyId);
  const property = await loadProperty(d, tx, input.propertyId);
  await assertLedgerTarget(d, tx, input.ref, property);
  let account: AccountRow | null = null;
  if (input.method === 'external_terminal') {
    if (!input.accountId) {
      throw new ValidationError(
        'terminal_account_required',
        "Choose the hotel's terminal/gateway account the card was taken on, so the payment can be matched to its settlement statement.",
      );
    }
    account = await loadAccount(tx, input.accountId);
    if (account.provider !== 'external_terminal') {
      throw new BusinessRuleError(
        'not_a_terminal_account',
        'Recorded card payments belong to an own-terminal account. Payments through an integrated provider are taken with a charge, not recorded.',
      );
    }
    assertAccountUsable(account, property, input.amount.currency);
  } else if (input.accountId) {
    throw new ValidationError(
      'account_not_applicable',
      `${input.method} payments are not linked to a provider account.`,
    );
  }
  const receivedAt = new Date(input.receivedAt);
  if (receivedAt.getTime() > tx.now.getTime() + 5 * 60_000) {
    throw new ValidationError('received_in_future', 'The payment time cannot be in the future.');
  }
  // R5-P1-1: the purpose the ownership guard reads is derived from the facts, as for a card charge.
  const fact = await derivePurpose(d, tx, input.ref, input.purpose);
  const purpose = fact.purpose;
  await assertCollectionOwnership(d, tx, input.ref, purpose, input.separateCollection, {
    amountMinor: input.amount.amountMinor,
  });
  let authorization: AuthorizationRow | null = null;
  if (input.authorizationId) {
    authorization = await loadAuthorization(tx, input.authorizationId);
    if (authorization.mode !== 'recorded') {
      throw new BusinessRuleError(
        'provider_authorization',
        'This hold was taken through the integrated provider; collect it with a capture instead of recording a payment.',
      );
    }
    assertOpenAuthorization(authorization, 'complete the hold');
    if (authorization.currency !== input.amount.currency) {
      throw new ValidationError('currency_mismatch', 'The payment currency differs from the hold.');
    }
  }
  // P1-7: a bank transfer is only EXPECTED until receipt is confirmed (statement match or authorized staff).
  const awaiting = input.method === 'bank_transfer';
  const id = newId(tx.now.getTime());
  const inserted = await insertPayment(
    tx,
    {
      id,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      legal_entity_id: property.legalEntityId,
      account_id: account?.id ?? null,
      method_id: null,
      authorization_id: authorization?.id ?? null,
      payment_request_id: null,
      virtual_card_id: null,
      kind: 'recorded',
      purpose,
      purpose_basis: fact.basis,
      method: input.method,
      initiator: null,
      ref_type: input.ref.type,
      ref_id: input.ref.id,
      business_key: businessKey,
      request_hash: hash,
      currency: input.amount.currency,
      amount_minor: input.amount.amountMinor,
      status: awaiting ? 'awaiting_receipt' : 'recorded_unverified',
      mode: 'recorded',
      external_reference: input.reference,
      terminal_id: input.terminalId ?? null,
      card_brand: input.cardBrand ?? null,
      card_last4: input.cardLast4 ?? null,
      received_at: receivedAt,
      received_on: localDateIn(receivedAt, property.timezone),
      duplicate_override: input.duplicateOverride?.reason ?? null,
      ledger_status: awaiting ? 'not_required' : 'pending',
      note: input.note ?? null,
      created_by: actorKey(tx),
      created_at: tx.now,
    },
    input.ref,
    businessKey,
    hash,
  );
  if (!inserted.inserted) return { id: inserted.existingId, operationId: null, replayed: true };
  if (authorization) {
    const captured = authorization.captured_minor + input.amount.amountMinor;
    await db(tx)
      .updateTable('payments.authorizations')
      .set({
        captured_minor: Math.min(captured, authorization.amount_minor),
        status: captured >= authorization.amount_minor ? 'captured' : 'partially_captured',
        version: authorization.version + 1,
      })
      .where('id', '=', authorization.id)
      .execute();
  }
  // Route D (coordinator decision): terminal/cash payments post at record time, labeled recorded/unverified.
  if (!awaiting) await postPaymentLedger(d, tx, id);
  await tx.audit({
    action: 'payments.payment.record',
    target: { type: 'payment', id },
    propertyId: input.propertyId,
    ...(input.duplicateOverride ? { reason: `Repeated reference: ${input.duplicateOverride.reason}` } : {}),
    after: {
      method: input.method,
      amount: input.amount,
      ref: input.ref,
      purpose,
      reference: input.reference,
      terminalId: input.terminalId ?? null,
      receivedAt: input.receivedAt,
      status: awaiting ? 'awaiting_receipt' : 'recorded_unverified',
    },
  });
  await tx.emit({
    type: PaymentsEvents.paymentRecorded,
    propertyId: input.propertyId,
    aggregate: { type: 'payment', id },
    payload: {
      paymentId: id,
      method: input.method,
      ref: input.ref,
      amountMinor: input.amount.amountMinor,
      currency: input.amount.currency,
      verification: awaiting ? 'awaiting_receipt' : 'recorded_unverified',
    },
  });
  return { id, operationId: null, replayed: false };
}

/** P1-7: receipt of an expected bank transfer confirmed by an authorized person (sensitive permission). */
export async function confirmBankTransfer(
  d: PaymentsDeps,
  tx: TxContext,
  input: z.infer<typeof confirmBankTransferInput> & { paymentId: string },
): Promise<void> {
  const p = await loadPaymentForUpdate(tx, input.paymentId);
  requirePermission(tx, 'payments.bankTransfer.confirm', { propertyId: p.property_id });
  await assertPaymentsWritable(d, tx, p.property_id);
  if (p.method !== 'bank_transfer') {
    throw new BusinessRuleError(
      'not_a_bank_transfer',
      'Only expected bank transfers need a receipt confirmation.',
    );
  }
  if (p.status !== 'awaiting_receipt') {
    if (p.status === 'recorded_verified') return; // already confirmed (idempotent)
    throw new BusinessRuleError(
      'bank_transfer_not_expected',
      `This bank transfer is ${p.status.replace('_', ' ')}.`,
    );
  }
  await markBankTransferReceived(d, tx, p, { type: 'bank_confirmation', id: newId(tx.now.getTime()) }, input);
}

/** Shared by staff confirmation and bank-statement matching: received → verified and posted (once). */
export async function markBankTransferReceived(
  d: PaymentsDeps,
  tx: TxContext,
  p: PaymentRow,
  evidence: { type: string; id: string },
  detail: { bankReference?: string; receivedAt?: string },
): Promise<void> {
  await db(tx)
    .updateTable('payments.payments')
    .set({
      status: 'recorded_verified',
      ledger_status: 'pending',
      verification_ledger_status: 'posted', // the posting itself carries verification = recorded_verified
      ...(detail.receivedAt ? { received_at: new Date(detail.receivedAt) } : {}),
      version: p.version + 1,
    })
    .where('id', '=', p.id)
    .execute();
  await postPaymentLedger(d, tx, p.id);
  await tx.audit({
    action: 'payments.bankTransfer.received',
    target: { type: 'payment', id: p.id },
    propertyId: p.property_id,
    before: { status: p.status },
    after: { status: 'recorded_verified', evidence, bankReference: detail.bankReference ?? null },
  });
  await tx.emit({
    type: PaymentsEvents.paymentVerified,
    propertyId: p.property_id,
    aggregate: { type: 'payment', id: p.id },
    payload: { paymentId: p.id, evidence },
  });
}

export async function cancelBankTransfer(d: PaymentsDeps, tx: TxContext, paymentId: string, reason: string) {
  const p = await loadPaymentForUpdate(tx, paymentId);
  requirePermission(tx, 'payments.externalRecord.create', { propertyId: p.property_id });
  await assertPaymentsWritable(d, tx, p.property_id);
  if (p.status !== 'awaiting_receipt') {
    throw new BusinessRuleError(
      'bank_transfer_not_expected',
      'Only an expected (not yet received) transfer can be cancelled.',
    );
  }
  await db(tx)
    .updateTable('payments.payments')
    .set({ status: 'cancelled', version: p.version + 1 })
    .where('id', '=', p.id)
    .execute();
  await tx.audit({
    action: 'payments.bankTransfer.cancel',
    target: { type: 'payment', id: p.id },
    propertyId: p.property_id,
    reason,
  });
}

export async function recordAuthorization(
  d: PaymentsDeps,
  tx: TxContext,
  input: z.infer<typeof recordAuthorizationInput> & { businessKey: string },
): Promise<Started> {
  requirePermission(tx, 'payments.externalRecord.create', { propertyId: input.propertyId });
  const businessKey = `record-authorization:${input.businessKey}`;
  const hash = requestHash({ p: input.propertyId, a: input.amount, r: input.ref, x: input.approvalCode });
  const existing = await db(tx)
    .selectFrom('payments.authorizations')
    .select(['id', 'request_hash'])
    .where('business_key', '=', businessKey)
    .executeTakeFirst();
  if (existing) {
    assertSameRequest(existing.request_hash, hash, 'authorization record');
    return { id: existing.id, operationId: null, replayed: true };
  }
  await assertPaymentsWritable(d, tx, input.propertyId);
  const property = await loadProperty(d, tx, input.propertyId);
  await assertReferenceAt(d, tx, input.ref, property.id);
  const account = await loadAccount(tx, input.accountId);
  if (account.provider !== 'external_terminal') {
    throw new BusinessRuleError(
      'not_a_terminal_account',
      "Manual authorizations are recorded against the hotel's own terminal account.",
    );
  }
  assertAccountUsable(account, property, input.amount.currency);
  const validity = await d.platform.resolvePolicy(
    tx,
    input.propertyId,
    'payments.authorization.validityDays',
    7,
  );
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('payments.authorizations')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      legal_entity_id: property.legalEntityId,
      account_id: account.id,
      method_id: null,
      ref_type: input.ref.type,
      ref_id: input.ref.id,
      business_key: businessKey,
      request_hash: hash,
      currency: input.amount.currency,
      amount_minor: input.amount.amountMinor,
      status: 'authorized',
      mode: 'recorded',
      initiator: 'customer',
      provider_ref: null,
      external_reference: input.approvalCode,
      expires_at: input.expiresAt
        ? new Date(input.expiresAt)
        : new Date(tx.now.getTime() + Number(validity.value) * 86_400_000),
      decline: null,
      created_by: actorKey(tx),
      created_at: tx.now,
    })
    .execute();
  await tx.audit({
    action: 'payments.authorization.record',
    target: { type: 'authorization', id },
    propertyId: input.propertyId,
    after: {
      amount: input.amount,
      approvalCode: input.approvalCode,
      ref: input.ref,
      cardLast4: input.cardLast4 ?? null,
    },
  });
  await tx.emit({
    type: PaymentsEvents.authorizationAuthorized,
    propertyId: input.propertyId,
    aggregate: { type: 'authorization', id },
    payload: {
      authorizationId: id,
      ref: input.ref,
      amountMinor: input.amount.amountMinor,
      currency: input.amount.currency,
      recorded: true,
    },
  });
  return { id, operationId: null, replayed: false };
}

export async function recordRefund(
  d: PaymentsDeps,
  tx: TxContext,
  input: z.infer<typeof recordRefundInput> & { businessKey: string },
): Promise<Started> {
  const businessKey = `record-refund:${input.businessKey}`;
  const hash = requestHash({ p: input.paymentId, a: input.amount, x: input.reference });
  const existing = await db(tx)
    .selectFrom('payments.refunds')
    .select(['id', 'request_hash'])
    .where('business_key', '=', businessKey)
    .executeTakeFirst();
  if (existing) {
    assertSameRequest(existing.request_hash, hash, 'refund record');
    return { id: existing.id, operationId: null, replayed: true };
  }
  const p = await loadPaymentForUpdate(tx, input.paymentId);
  requirePermission(tx, 'payments.payment.refund', { propertyId: p.property_id });
  await assertPaymentsWritable(d, tx, p.property_id);
  if (p.mode !== 'recorded') {
    throw new BusinessRuleError(
      'provider_payment_refund',
      'This payment went through the integrated provider; refund it through Portico so the provider returns the money.',
    );
  }
  if (p.status === 'awaiting_receipt' || p.status === 'cancelled') {
    throw new BusinessRuleError(
      'payment_not_refundable',
      'This bank transfer has not been received, so there is nothing to refund.',
    );
  }
  assertRefundAmount(p, input.amount);
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('payments.refunds')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: p.property_id,
      payment_id: p.id,
      account_id: p.account_id,
      business_key: businessKey,
      request_hash: hash,
      currency: p.currency,
      amount_minor: input.amount.amountMinor,
      reason: input.reason,
      status: 'recorded_unverified',
      mode: 'recorded',
      provider_ref: null,
      external_reference: input.reference,
      failure: null,
      ledger_status: 'pending',
      ledger_posting_id: null,
      ledger_error: null,
      created_by: actorKey(tx),
      created_at: tx.now,
    })
    .execute();
  await db(tx)
    .updateTable('payments.payments')
    .set({ refunded_minor: p.refunded_minor + input.amount.amountMinor, version: p.version + 1 })
    .where('id', '=', p.id)
    .execute();
  await postRefundLedger(d, tx, id);
  await tx.audit({
    action: 'payments.refund.record',
    target: { type: 'refund', id },
    propertyId: p.property_id,
    reason: input.reason,
    after: { paymentId: p.id, amount: input.amount, reference: input.reference },
  });
  await tx.emit({
    type: PaymentsEvents.refundRecorded,
    propertyId: p.property_id,
    aggregate: { type: 'refund', id },
    payload: { refundId: id, paymentId: p.id, amountMinor: input.amount.amountMinor, currency: p.currency },
  });
  return { id, operationId: null, replayed: false };
}

/**
 * Correct a recorded payment found wrong by reconciliation: a new linked adjustment (and ledger entry), never an
 * edit of the original record. `adjusted_minor` keeps the refund ceiling honest (P1-4).
 */
export async function adjustRecordedPayment(
  d: PaymentsDeps,
  tx: TxContext,
  input: z.infer<typeof adjustmentInput> & { businessKey: string },
) {
  const businessKey = `adjust:${input.businessKey}`;
  const existing = await db(tx)
    .selectFrom('payments.payment_adjustments')
    .selectAll()
    .where('business_key', '=', businessKey)
    .executeTakeFirst();
  if (existing) return existing;
  const p = await loadPaymentForUpdate(tx, input.paymentId);
  requirePermission(tx, 'payments.reconciliation.manage', { propertyId: p.property_id });
  await assertPaymentsWritable(d, tx, p.property_id);
  if (p.mode !== 'recorded') {
    throw new BusinessRuleError(
      'not_recorded_payment',
      'Only payments recorded from the hotel’s own terminal, cash or bank transfer are corrected this way. Provider payments are corrected by refunds.',
    );
  }
  if (p.status === 'awaiting_receipt' || p.status === 'cancelled') {
    throw new BusinessRuleError(
      'payment_not_received',
      'This bank transfer has not been received; there is nothing to correct.',
    );
  }
  if (input.amount.currency !== p.currency) {
    throw new ValidationError('currency_mismatch', `The payment was in ${p.currency}.`);
  }
  const effective = p.amount_minor + p.adjusted_minor + input.amount.amountMinor;
  if (effective < p.refunded_minor + p.refund_reserved_minor || effective < 0) {
    throw new BusinessRuleError(
      'adjustment_below_refunded',
      'After this correction the payment would be smaller than what was already refunded. Review the refunds first.',
    );
  }
  const id = newId(tx.now.getTime());
  const clearing = await clearingOf(tx, p);
  const ledger = await tryLedger(tx, () =>
    d.ledger.recordPaymentAdjustment(tx, {
      propertyId: p.property_id,
      legalEntityId: p.legal_entity_id,
      folioId: p.ref_type === 'folio' ? p.ref_id : null,
      bookingId: p.ref_type === 'booking' ? p.ref_id : null,
      amount: money(input.amount.amountMinor, p.currency),
      paymentRef: { type: 'payment', id: p.id },
      adjustmentRef: { type: 'payment_adjustment', id },
      reason: input.reason,
      idempotencyKey: ledgerKey.adjustment(id),
      clearing,
    }),
  );
  if (!ledger.ok) {
    throw new BusinessRuleError(
      'ledger_rejected_adjustment',
      `Finance could not post the correction (${ledger.error}). Nothing was changed; fix the bill reference and try again.`,
    );
  }
  const row = await db(tx)
    .insertInto('payments.payment_adjustments')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: p.property_id,
      payment_id: p.id,
      business_key: businessKey,
      currency: p.currency,
      amount_minor: input.amount.amountMinor,
      reason: input.reason,
      exception_id: input.exceptionId ?? null,
      ledger_posting_id: ledger.value.postingId,
      created_by: actorKey(tx),
      created_at: tx.now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db(tx)
    .updateTable('payments.payments')
    .set({ adjusted_minor: p.adjusted_minor + input.amount.amountMinor, version: p.version + 1 })
    .where('id', '=', p.id)
    .execute();
  if (input.exceptionId) {
    const ex = await db(tx)
      .selectFrom('payments.exceptions')
      .select(['dedupe_key'])
      .where('id', '=', input.exceptionId)
      .executeTakeFirst();
    if (ex) await resolveExceptionsByKey(tx, ex.dedupe_key, `Corrected by adjustment ${id}: ${input.reason}`);
  }
  // If a statement line disagreed only in amount and the correction makes them agree, the statement line is
  // now the verification evidence for this payment.
  const line = await db(tx)
    .selectFrom('payments.statement_lines')
    .select(['id'])
    .where('matched_payment_id', '=', p.id)
    .where('match_status', '=', 'amount_mismatch')
    .where('amount_minor', '=', effective)
    .executeTakeFirst();
  if (line && p.status === 'recorded_unverified') {
    await db(tx)
      .updateTable('payments.statement_lines')
      .set({ match_status: 'matched', match_basis: 'reference_after_adjustment' })
      .where('id', '=', line.id)
      .execute();
    await db(tx)
      .updateTable('payments.payments')
      .set({ status: 'recorded_verified', verification_ledger_status: 'pending' })
      .where('id', '=', p.id)
      .execute();
    await postVerification(d, tx, { type: 'payment', id: p.id }, { type: 'statement_line', id: line.id });
  }
  await tx.audit({
    action: 'payments.payment.adjust',
    target: { type: 'payment', id: p.id },
    propertyId: p.property_id,
    reason: input.reason,
    before: { amountMinor: p.amount_minor + p.adjusted_minor },
    after: { amountMinor: effective, adjustmentId: id },
  });
  await tx.emit({
    type: PaymentsEvents.paymentAdjusted,
    propertyId: p.property_id,
    aggregate: { type: 'payment', id: p.id },
    payload: {
      paymentId: p.id,
      adjustmentId: id,
      amountMinor: input.amount.amountMinor,
      currency: p.currency,
    },
  });
  return row;
}

export type { PropertyInfo };
