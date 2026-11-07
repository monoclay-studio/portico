/**
 * Money commands. Each one runs INSIDE the caller's transaction and only records intent (the business record
 * + the provider operation). The provider call happens after commit (`executeOperation`), so a rolled-back
 * command can never have moved money, and a committed one always has a journal entry.
 *
 * Recorded payments (Route D — the hotel's own terminal or gateway, cash, bank transfer) have no provider call:
 * they are recorded as `recorded_unverified`, posted to the ledger at record time, and verified later by
 * statement matching. They are never presented as provider-verified.
 */
import type { TxContext } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
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
  chargeInput,
  recordAuthorizationInput,
  recordPaymentInput,
  recordRefundInput,
  refundInput,
} from '../contracts';
import { capturableMinor, refundableMinor } from '../domain/states';
import { PaymentsEvents } from '../events';
import { ledgerKey, postPaymentLedger, postRefundLedger, tryLedger } from './ledger';
import { assertBreakerAllows, createOperation } from './operations';
import {
  type AccountRow,
  type AuthorizationRow,
  actorKey,
  assertAccountUsable,
  assertPaymentsWritable,
  db,
  loadAccount,
  loadProperty,
  type MethodRow,
  type PaymentRow,
  type PaymentsDeps,
  PendingVerificationBlockError,
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

async function loadActiveMethod(tx: TxContext, methodId: string): Promise<MethodRow> {
  const m = await db(tx)
    .selectFrom('payments.payment_methods')
    .selectAll()
    .where('id', '=', methodId)
    .executeTakeFirst();
  if (!m) throw new NotFoundError('payment_method', methodId);
  if (m.status !== 'active') {
    throw new BusinessRuleError(
      'payment_method_inactive',
      `This saved card is ${m.status}. Ask the guest for another card or send a payment link.`,
    );
  }
  return m;
}

function assertMitAllowed(method: MethodRow, initiator: 'customer' | 'merchant'): void {
  if (initiator === 'merchant' && !method.mit_agreement) {
    throw new BusinessRuleError(
      'mit_not_agreed',
      'This card was not saved with the guest’s agreement to later charges by the hotel, so it cannot be charged without the guest present. Send a payment link instead.',
      { methodId: method.id },
    );
  }
}

/** PAY-R14: block a new collection on the same reference while another one is still being verified. */
async function assertNothingPendingFor(tx: TxContext, ref: { type: string; id: string }): Promise<void> {
  const p = await db(tx)
    .selectFrom('payments.payments')
    .select(['id', 'amount_minor', 'currency', 'created_at'])
    .where('ref_type', '=', ref.type as 'folio')
    .where('ref_id', '=', ref.id)
    .where('status', 'in', ['processing', 'pending_verification'])
    .orderBy('created_at')
    .executeTakeFirst();
  if (p) {
    throw new PendingVerificationBlockError({
      kind: 'payment',
      id: p.id,
      amountMinor: p.amount_minor,
      currency: p.currency,
      since: new Date(p.created_at),
    });
  }
}

// ───────────────────────── authorizations ─────────────────────────

export async function authorize(
  d: PaymentsDeps,
  tx: TxContext,
  input: z.infer<typeof authorizeInput> & { businessKey: string },
): Promise<Started> {
  requirePermission(tx, 'payments.payment.collect', { propertyId: input.propertyId });
  const businessKey = `authorize:${input.businessKey}`;
  const existing = await db(tx)
    .selectFrom('payments.authorizations')
    .select(['id'])
    .where('business_key', '=', businessKey)
    .executeTakeFirst();
  if (existing) return { id: existing.id, operationId: null, replayed: true };
  await assertPaymentsWritable(d, tx, input.propertyId);
  const property = await loadProperty(d, tx, input.propertyId);
  const method = await loadActiveMethod(tx, input.methodId);
  const account = await loadAccount(tx, method.account_id);
  assertAccountUsable(account, property, input.amount.currency);
  requireCapability(account, 'authorize', 'Pre-authorization');
  assertMitAllowed(method, input.initiator);
  const pending = await db(tx)
    .selectFrom('payments.authorizations')
    .select(['id', 'amount_minor', 'currency', 'created_at'])
    .where('ref_type', '=', input.ref.type)
    .where('ref_id', '=', input.ref.id)
    .where('status', 'in', ['processing', 'pending_verification'])
    .executeTakeFirst();
  if (pending) {
    throw new PendingVerificationBlockError({
      kind: 'authorization',
      id: pending.id,
      amountMinor: pending.amount_minor,
      currency: pending.currency,
      since: new Date(pending.created_at),
    });
  }
  const mode = d.registry.modeFor(tx, account);
  await assertBreakerAllows(d, tx, account);
  const id = newId(tx.now.getTime());
  await db(tx)
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
      currency: input.amount.currency,
      amount_minor: input.amount.amountMinor,
      status: 'processing',
      mode,
      initiator: input.initiator,
      provider_ref: null,
      external_reference: null,
      expires_at: null,
      decline: null,
      created_by: actorKey(tx),
      created_at: tx.now,
    })
    .execute();
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
    after: { amount: input.amount, ref: input.ref, methodId: method.id, mode, operationId },
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
    businessKey: string;
  },
): Promise<Started> {
  const businessKey = `capture:${input.businessKey}`;
  const existing = await db(tx)
    .selectFrom('payments.payments')
    .select(['id'])
    .where('business_key', '=', businessKey)
    .executeTakeFirst();
  if (existing) return { id: existing.id, operationId: null, replayed: true };
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
      `Only ${a.currency} ${(capturable / 100).toFixed(2)} can still be collected from this hold. Collect that amount and take the rest as a separate payment.`,
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
  await assertBreakerAllows(d, tx, account);
  await db(tx)
    .updateTable('payments.authorizations')
    .set({ capture_reserved_minor: a.capture_reserved_minor + amountMinor, version: a.version + 1 })
    .where('id', '=', a.id)
    .execute();
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('payments.payments')
    .values({
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
      method: 'card',
      initiator: a.initiator,
      ref_type: ref.type,
      ref_id: ref.id,
      business_key: businessKey,
      currency: a.currency,
      amount_minor: amountMinor,
      status: 'processing',
      mode: a.mode,
      provider_ref: null,
      external_reference: null,
      terminal_id: null,
      card_brand: null,
      card_last4: null,
      received_at: null,
      decline: null,
      ledger_status: 'not_required',
      ledger_posting_id: null,
      ledger_error: null,
      payout_id: null,
      note: null,
      created_by: actorKey(tx),
      created_at: tx.now,
    })
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
  skipPendingGuard?: boolean;
}

export async function charge(
  d: PaymentsDeps,
  tx: TxContext,
  input: z.infer<typeof chargeInput> & { businessKey: string },
  extras: ChargeExtras = {},
): Promise<Started> {
  requirePermission(tx, 'payments.payment.collect', { propertyId: input.propertyId });
  const businessKey = `charge:${input.businessKey}`;
  const existing = await db(tx)
    .selectFrom('payments.payments')
    .select(['id'])
    .where('business_key', '=', businessKey)
    .executeTakeFirst();
  if (existing) return { id: existing.id, operationId: null, replayed: true };
  await assertPaymentsWritable(d, tx, input.propertyId);
  const property = await loadProperty(d, tx, input.propertyId);
  const method = await loadActiveMethod(tx, input.methodId);
  const account = await loadAccount(tx, method.account_id);
  assertAccountUsable(account, property, input.amount.currency);
  requireCapability(account, 'charge', 'Charging a card');
  assertMitAllowed(method, input.initiator);
  if (!extras.skipPendingGuard) await assertNothingPendingFor(tx, input.ref);
  const mode = d.registry.modeFor(tx, account);
  await assertBreakerAllows(d, tx, account);
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('payments.payments')
    .values({
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
      method: extras.method ?? (method.kind === 'virtual_card' ? 'virtual_card' : 'card'),
      initiator: input.initiator,
      ref_type: input.ref.type,
      ref_id: input.ref.id,
      business_key: businessKey,
      currency: input.amount.currency,
      amount_minor: input.amount.amountMinor,
      status: 'processing',
      mode,
      provider_ref: null,
      external_reference: null,
      terminal_id: null,
      card_brand: method.brand,
      card_last4: method.last4,
      received_at: null,
      decline: null,
      ledger_status: 'not_required',
      ledger_posting_id: null,
      ledger_error: null,
      payout_id: null,
      note: input.description ?? null,
      created_by: actorKey(tx),
      created_at: tx.now,
    })
    .execute();
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
      methodId: method.id,
      initiator: input.initiator,
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
    refundedMinor: p.refunded_minor,
    refundReservedMinor: p.refund_reserved_minor,
  });
  if (amount.amountMinor > refundable) {
    throw new BusinessRuleError(
      'refund_exceeds_refundable',
      `Only ${p.currency} ${(refundable / 100).toFixed(2)} of this payment can still be refunded (collected ${(p.amount_minor / 100).toFixed(2)}, already refunded or in progress ${((p.refunded_minor + p.refund_reserved_minor) / 100).toFixed(2)}).`,
      { refundableMinor: refundable, requestedMinor: amount.amountMinor },
    );
  }
}

export async function refund(
  d: PaymentsDeps,
  tx: TxContext,
  input: z.infer<typeof refundInput> & { businessKey: string },
): Promise<Started> {
  const businessKey = `refund:${input.businessKey}`;
  const existing = await db(tx)
    .selectFrom('payments.refunds')
    .select(['id'])
    .where('business_key', '=', businessKey)
    .executeTakeFirst();
  if (existing) return { id: existing.id, operationId: null, replayed: true };
  const p = await loadPaymentForUpdate(tx, input.paymentId);
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
  requirePermission(tx, 'payments.payment.collect', { propertyId: input.propertyId });
  const businessKey = `record:${input.businessKey}`;
  const existing = await db(tx)
    .selectFrom('payments.payments')
    .select(['id'])
    .where('business_key', '=', businessKey)
    .executeTakeFirst();
  if (existing) return { id: existing.id, operationId: null, replayed: true };
  await assertPaymentsWritable(d, tx, input.propertyId);
  const property = await loadProperty(d, tx, input.propertyId);
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
  if (new Date(input.receivedAt).getTime() > tx.now.getTime() + 5 * 60_000) {
    throw new ValidationError('received_in_future', 'The payment time cannot be in the future.');
  }
  const duplicate = await db(tx)
    .selectFrom('payments.payments')
    .select(['id', 'created_at'])
    .where('property_id', '=', input.propertyId)
    .where('method', '=', input.method)
    .where('external_reference', '=', input.reference)
    .executeTakeFirst();
  if (duplicate) {
    throw new ConflictError(
      'duplicate_reference',
      `A ${input.method.replace('_', ' ')} payment with reference "${input.reference}" was already recorded at ${new Date(duplicate.created_at).toISOString()}. Check it before recording again — recording twice would double the guest's payment.`,
      { paymentId: duplicate.id },
    );
  }
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
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('payments.payments')
    .values({
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
      method: input.method,
      initiator: null,
      ref_type: input.ref.type,
      ref_id: input.ref.id,
      business_key: businessKey,
      currency: input.amount.currency,
      amount_minor: input.amount.amountMinor,
      status: 'recorded_unverified',
      mode: 'recorded',
      provider_ref: null,
      external_reference: input.reference,
      terminal_id: input.terminalId ?? null,
      card_brand: input.cardBrand ?? null,
      card_last4: input.cardLast4 ?? null,
      received_at: new Date(input.receivedAt),
      decline: null,
      ledger_status: 'pending',
      ledger_posting_id: null,
      ledger_error: null,
      payout_id: null,
      note: input.note ?? null,
      created_by: actorKey(tx),
      created_at: tx.now,
    })
    .execute();
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
  // Coordinator decision (Route D): the ledger is posted at record time, labeled as recorded/unverified.
  await postPaymentLedger(d, tx, id);
  await tx.audit({
    action: 'payments.payment.record',
    target: { type: 'payment', id },
    propertyId: input.propertyId,
    after: {
      method: input.method,
      amount: input.amount,
      ref: input.ref,
      reference: input.reference,
      terminalId: input.terminalId ?? null,
      receivedAt: input.receivedAt,
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
      verification: 'recorded_unverified',
    },
  });
  return { id, operationId: null, replayed: false };
}

export async function recordAuthorization(
  d: PaymentsDeps,
  tx: TxContext,
  input: z.infer<typeof recordAuthorizationInput> & { businessKey: string },
): Promise<Started> {
  requirePermission(tx, 'payments.payment.collect', { propertyId: input.propertyId });
  const businessKey = `record-authorization:${input.businessKey}`;
  const existing = await db(tx)
    .selectFrom('payments.authorizations')
    .select(['id'])
    .where('business_key', '=', businessKey)
    .executeTakeFirst();
  if (existing) return { id: existing.id, operationId: null, replayed: true };
  await assertPaymentsWritable(d, tx, input.propertyId);
  const property = await loadProperty(d, tx, input.propertyId);
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
  const existing = await db(tx)
    .selectFrom('payments.refunds')
    .select(['id'])
    .where('business_key', '=', businessKey)
    .executeTakeFirst();
  if (existing) return { id: existing.id, operationId: null, replayed: true };
  const p = await loadPaymentForUpdate(tx, input.paymentId);
  requirePermission(tx, 'payments.payment.refund', { propertyId: p.property_id });
  await assertPaymentsWritable(d, tx, p.property_id);
  if (p.mode !== 'recorded') {
    throw new BusinessRuleError(
      'provider_payment_refund',
      'This payment went through the integrated provider; refund it through Portico so the provider returns the money.',
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
 * edit of the original record.
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
  if (input.amount.currency !== p.currency) {
    throw new ValidationError('currency_mismatch', `The payment was in ${p.currency}.`);
  }
  const prior = await db(tx)
    .selectFrom('payments.payment_adjustments')
    .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('amount_minor'), eb.lit(0)).as('total'))
    .where('payment_id', '=', p.id)
    .executeTakeFirstOrThrow();
  const effective = p.amount_minor + Number(prior.total) + input.amount.amountMinor;
  if (effective < p.refunded_minor) {
    throw new BusinessRuleError(
      'adjustment_below_refunded',
      'After this correction the payment would be smaller than what was already refunded. Review the refunds first.',
    );
  }
  const id = newId(tx.now.getTime());
  const ledger = await tryLedger(tx, () =>
    d.ledger.recordPaymentAdjustment(tx, {
      folioId: p.ref_type === 'folio' ? p.ref_id : null,
      bookingId: p.ref_type === 'booking' ? p.ref_id : null,
      amount: money(input.amount.amountMinor, p.currency),
      paymentRef: { type: 'payment', id: p.id },
      adjustmentRef: { type: 'payment_adjustment', id },
      reason: input.reason,
      idempotencyKey: ledgerKey.adjustment(id),
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
      .set({ status: 'recorded_verified', version: p.version + 1 })
      .where('id', '=', p.id)
      .execute();
  }
  await tx.audit({
    action: 'payments.payment.adjust',
    target: { type: 'payment', id: p.id },
    propertyId: p.property_id,
    reason: input.reason,
    before: { amountMinor: p.amount_minor + Number(prior.total) },
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
