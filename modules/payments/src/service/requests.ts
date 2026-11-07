/**
 * Payment requests (links) and OTA virtual cards.
 *
 * A payment request is "paid" only when provider-confirmed payments sum to its amount (PAY-R19). Link creation
 * is a provider call: it runs after commit with a persisted idempotency key; while the provider is down the
 * request stays open with link status `pending` ("send a payment link later") and is retried by reconciliation.
 *
 * Virtual cards (PAY-R07): metadata separate from the token; the token is the alias issued by the PCI vault /
 * proxy that received the OTA card (vault selection is an unresolved dependency — README). Charged for exactly
 * the card amount, from the activation date in property-local time, retried on funding delay.
 */
import { explainVersionMiss, type TxContext, withTenantTx } from '@portico/db';
import {
  BusinessRuleError,
  localDateIn,
  NotFoundError,
  newId,
  type RequestContext,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { z } from 'zod';
import type { PaymentRequest, paymentRequestInput, VirtualCard, virtualCardInput } from '../contracts';
import { decideAttempt } from '../domain/circuit-breaker';
import { explainDecline } from '../domain/declines';
import { vccIsActive } from '../domain/schedule';
import { PaymentsEvents } from '../events';
import { isSimulatorTestToken } from '../providers/simulator';
import { charge } from './collect';
import { executeOperation, loadBreaker } from './operations';
import {
  actorKey,
  assertAccountUsable,
  assertPaymentsWritable,
  db,
  effectiveModeFor,
  loadAccount,
  loadProperty,
  type PaymentsDeps,
  requireRead,
  type RequestRow,
  toProviderAccount,
  toRequestView,
} from './shared';

export async function createPaymentRequest(
  d: PaymentsDeps,
  tx: TxContext,
  input: z.infer<typeof paymentRequestInput> & { businessKey: string },
): Promise<{ id: string; replayed: boolean }> {
  requirePermission(tx, 'payments.paymentRequest.create', { propertyId: input.propertyId });
  const businessKey = `request:${input.businessKey}`;
  const existing = await db(tx).selectFrom('payments.payment_requests').select('id').where('business_key', '=', businessKey).executeTakeFirst();
  if (existing) return { id: existing.id, replayed: true };
  await assertPaymentsWritable(d, tx, input.propertyId);
  const property = await loadProperty(d, tx, input.propertyId);
  const expiresAt = new Date(input.expiresAt);
  if (expiresAt.getTime() <= tx.now.getTime() + 15 * 60_000) {
    throw new ValidationError('expiry_too_soon', 'A payment request must stay open for at least 15 minutes.');
  }
  let accountId = input.accountId;
  if (!accountId) {
    const candidates = await db(tx)
      .selectFrom('payments.accounts')
      .selectAll()
      .where('legal_entity_id', '=', property.legalEntityId)
      .where('provider', '!=', 'external_terminal')
      .where('status', '=', 'active')
      .orderBy('created_at')
      .execute();
    const usable = candidates.find(
      (a) => a.currencies.includes(input.amount.currency) && ((a.capabilities as string[]) ?? []).includes('paymentLinks'),
    );
    if (!usable) {
      throw new BusinessRuleError(
        'no_payment_link_account',
        `No active payment account of this property's legal entity can create payment links in ${input.amount.currency}. Send the guest your bank's payment link and record the payment when it arrives.`,
      );
    }
    accountId = usable.id;
  }
  const account = await loadAccount(tx, accountId);
  assertAccountUsable(account, property, input.amount.currency);
  if (!((account.capabilities as string[]) ?? []).includes('paymentLinks')) {
    throw new BusinessRuleError('capability_not_supported', 'This payment account cannot create payment links.');
  }
  const mode = d.registry.modeFor(tx, account);
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('payments.payment_requests')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      legal_entity_id: property.legalEntityId,
      account_id: account.id,
      business_key: businessKey,
      payer: JSON.stringify(input.payer),
      currency: input.amount.currency,
      amount_minor: input.amount.amountMinor,
      purpose: input.purpose,
      description: input.description ?? null,
      ref_type: input.ref.type,
      ref_id: input.ref.id,
      expires_at: expiresAt,
      status: 'open',
      mode,
      provider_link_ref: null,
      link_url: null,
      link_status: 'pending',
      cancelled_reason: null,
      created_by: actorKey(tx),
    })
    .execute();
  await tx.audit({
    action: 'payments.request.create',
    target: { type: 'payment_request', id },
    propertyId: input.propertyId,
    after: { amount: input.amount, purpose: input.purpose, ref: input.ref, expiresAt: input.expiresAt, mode },
  });
  await tx.emit({
    type: PaymentsEvents.requestCreated,
    propertyId: input.propertyId,
    aggregate: { type: 'payment_request', id },
    payload: { paymentRequestId: id, ref: input.ref, amountMinor: input.amount.amountMinor, currency: input.amount.currency },
  });
  return { id, replayed: false };
}

/** Create the provider-hosted link (after commit). Safe to repeat: same idempotency key, no money moves. */
export async function ensurePaymentLink(d: PaymentsDeps, ctx: RequestContext, requestId: string): Promise<void> {
  const loaded = await withTenantTx(d.database, ctx, async (tx) => {
    const r = await db(tx).selectFrom('payments.payment_requests').selectAll().where('id', '=', requestId).executeTakeFirst();
    if (!r || r.status !== 'open' || r.link_status === 'created' || r.link_status === 'failed') return null;
    const account = await loadAccount(tx, r.account_id);
    const breaker = decideAttempt(await loadBreaker(tx, account.id), tx.now, d.breaker);
    if (!breaker.allowed) return null; // provider down: the link is created when it is back
    return { r, account };
  });
  if (!loaded) return;
  const { r, account } = loaded;
  const pa = toProviderAccount(account);
  let outcome: Awaited<ReturnType<import('../providers/provider').PaymentProvider['createPaymentLink']>>;
  try {
    const resolved = d.registry.forAccount(ctx, pa);
    outcome = resolved.ok
      ? await resolved.provider.createPaymentLink(pa, {
          operationId: r.id,
          idempotencyKey: `portico-link-${r.id}`,
          amount: { amountMinor: r.amount_minor - r.paid_minor, currency: r.currency },
          description: r.description ?? `Payment ${r.purpose}`,
          expiresAt: new Date(r.expires_at),
          requestId: r.id,
        })
      : { kind: 'failed', code: 'provider_not_configured', message: 'No provider credentials configured.' };
  } catch (err) {
    outcome = { kind: 'unknown', reason: err instanceof Error ? err.message : String(err) };
  }
  await withTenantTx(d.database, ctx, async (tx) => {
    await db(tx)
      .updateTable('payments.payment_requests')
      .set(
        outcome.kind === 'created'
          ? { link_status: 'created', provider_link_ref: outcome.linkRef, link_url: outcome.url, version: r.version + 1 }
          : { link_status: outcome.kind === 'failed' ? 'failed' : 'unknown', version: r.version + 1 },
      )
      .where('id', '=', r.id)
      .execute();
  });
}

export async function getPaymentRequest(tx: TxContext, id: string): Promise<PaymentRequest> {
  const r = await db(tx).selectFrom('payments.payment_requests').selectAll().where('id', '=', id).executeTakeFirst();
  if (!r) throw new NotFoundError('payment_request', id);
  if (!tx.authz.can('payments.paymentRequest.create', { propertyId: r.property_id })) requireRead(tx, r.property_id);
  return toRequestView(r);
}

export async function listPaymentRequests(tx: TxContext, ref: { type: string; id: string }): Promise<PaymentRequest[]> {
  const rows = await db(tx)
    .selectFrom('payments.payment_requests')
    .selectAll()
    .where('ref_type', '=', ref.type as 'folio')
    .where('ref_id', '=', ref.id)
    .orderBy('created_at')
    .execute();
  return rows
    .filter(
      (r) =>
        tx.authz.can('payments.payment.read', { propertyId: r.property_id }) ||
        tx.authz.can('payments.paymentRequest.create', { propertyId: r.property_id }),
    )
    .map(toRequestView);
}

export async function cancelPaymentRequest(
  d: PaymentsDeps,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  reason: string,
): Promise<PaymentRequest> {
  const r = await db(tx).selectFrom('payments.payment_requests').selectAll().where('id', '=', id).executeTakeFirst();
  if (!r) throw new NotFoundError('payment_request', id);
  requirePermission(tx, 'payments.paymentRequest.create', { propertyId: r.property_id });
  await assertPaymentsWritable(d, tx, r.property_id);
  if (r.status !== 'open' && r.status !== 'partially_paid') {
    throw new BusinessRuleError('payment_request_closed', `This payment request is already ${r.status}.`);
  }
  const row = await db(tx)
    .updateTable('payments.payment_requests')
    .set({ status: 'cancelled', cancelled_reason: reason, version: r.version + 1 })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) return explainVersionMiss('payment_request', id, expectedVersion, async () => r.version);
  await tx.audit({
    action: 'payments.request.cancel',
    target: { type: 'payment_request', id },
    propertyId: r.property_id,
    reason,
    before: { status: r.status },
    after: { status: 'cancelled' },
  });
  await tx.emit({
    type: PaymentsEvents.requestCancelled,
    propertyId: r.property_id,
    aggregate: { type: 'payment_request', id },
    payload: { paymentRequestId: id, reason },
  });
  return toRequestView(row);
}

/** Demo/test: the guest pays the simulated link (only in simulated mode). */
export async function simulateRequestPayment(
  d: PaymentsDeps,
  ctx: RequestContext,
  requestId: string,
  amountMinor?: number,
): Promise<void> {
  const { r, account } = await withTenantTx(d.database, ctx, async (tx) => {
    const r = await db(tx).selectFrom('payments.payment_requests').selectAll().where('id', '=', requestId).executeTakeFirst();
    if (!r) throw new NotFoundError('payment_request', requestId);
    requirePermission(tx, 'payments.paymentRequest.create', { propertyId: r.property_id });
    const account = await loadAccount(tx, r.account_id);
    if (r.mode !== 'simulate' || effectiveModeFor(d, tx, account) !== 'simulate') {
      throw new BusinessRuleError('not_simulated', 'Only simulated payment links can be paid from Portico.');
    }
    if (!r.provider_link_ref) {
      throw new BusinessRuleError('link_not_ready', 'The payment link has not been created yet.');
    }
    return { r: r as RequestRow, account };
  });
  await d.registry.simulator.simulateLinkPayment(toProviderAccount(account), r.provider_link_ref as string, amountMinor);
}

// ───────────────────────── virtual cards ─────────────────────────

function toVccView(v: {
  id: string;
  property_id: string;
  method_id: string;
  booking_id: string;
  channel: string;
  channel_reference: string;
  currency: string;
  amount_minor: number;
  activation_date: string;
  expires_on: string | null;
  status: string;
  attempts: number;
  next_attempt_at: Date | null;
  last_failure: unknown;
  charged_payment_id: string | null;
  version: number;
}): VirtualCard {
  const code = (v.last_failure as { code?: string } | null)?.code;
  return {
    id: v.id,
    propertyId: v.property_id,
    methodId: v.method_id,
    bookingId: v.booking_id,
    channel: v.channel,
    channelReference: v.channel_reference,
    amount: { amountMinor: v.amount_minor, currency: v.currency },
    activationDate: v.activation_date,
    expiresOn: v.expires_on,
    status: v.status,
    attempts: v.attempts,
    nextAttemptAt: v.next_attempt_at ? new Date(v.next_attempt_at).toISOString() : null,
    lastFailure: code ? explainDecline(code) : null,
    chargedPaymentId: v.charged_payment_id,
    version: v.version,
  };
}

export async function registerVirtualCard(
  d: PaymentsDeps,
  tx: TxContext,
  input: z.infer<typeof virtualCardInput>,
): Promise<VirtualCard> {
  requirePermission(tx, 'payments.vcc.manage', { propertyId: input.propertyId });
  const existing = await db(tx)
    .selectFrom('payments.virtual_cards')
    .selectAll()
    .where('channel', '=', input.channel)
    .where('channel_reference', '=', input.channelReference)
    .executeTakeFirst();
  if (existing) return toVccView(existing);
  await assertPaymentsWritable(d, tx, input.propertyId);
  const property = await loadProperty(d, tx, input.propertyId);
  const account = await loadAccount(tx, input.accountId);
  assertAccountUsable(account, property, input.amount.currency);
  if (effectiveModeFor(d, tx, account) === 'simulate' && !isSimulatorTestToken(input.vaultToken)) {
    throw new ValidationError(
      'simulator_test_token_required',
      'In this environment payments are simulated: register virtual cards with a simulator test token.',
    );
  }
  const methodId = newId(tx.now.getTime());
  await db(tx)
    .insertInto('payments.payment_methods')
    .values({
      id: methodId,
      tenant_id: tx.tenantId,
      account_id: account.id,
      property_id: input.propertyId,
      kind: 'virtual_card',
      provider_token: input.vaultToken,
      provider_customer_ref: null,
      brand: input.brand ?? null,
      last4: input.last4 ?? null,
      exp_month: input.expMonth ?? null,
      exp_year: input.expYear ?? null,
      holder_name: null,
      owner_type: 'booking',
      owner_id: input.bookingId,
      // A virtual card is issued by the channel to pay this stay: charging it is agreed by the channel contract.
      mit_agreement: true,
      mandate: JSON.stringify({ channel: input.channel, channelReference: input.channelReference }),
      token_portability: 'vault_portable',
      portability_note: 'Virtual card held via a PCI vault/proxy (vendor not yet selected — unresolved dependency).',
      status: 'active',
    })
    .execute();
  const id = newId(tx.now.getTime());
  const ref = input.ledgerRef ?? { type: 'booking' as const, id: input.bookingId };
  const row = await db(tx)
    .insertInto('payments.virtual_cards')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      method_id: methodId,
      booking_id: input.bookingId,
      ref_type: ref.type,
      ref_id: ref.id,
      channel: input.channel,
      channel_reference: input.channelReference,
      currency: input.amount.currency,
      amount_minor: input.amount.amountMinor,
      activation_date: input.activationDate,
      expires_on: input.expiresOn ?? null,
      status: 'scheduled',
      next_attempt_at: null,
      last_failure: null,
      charged_payment_id: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'payments.vcc.register',
    target: { type: 'virtual_card', id },
    propertyId: input.propertyId,
    after: { channel: input.channel, channelReference: input.channelReference, amount: input.amount, activationDate: input.activationDate },
  });
  return toVccView(row);
}

export async function getVirtualCard(tx: TxContext, id: string): Promise<VirtualCard> {
  const v = await db(tx).selectFrom('payments.virtual_cards').selectAll().where('id', '=', id).executeTakeFirst();
  if (!v) throw new NotFoundError('virtual_card', id);
  requireRead(tx, v.property_id);
  return toVccView(v);
}

export interface VccRunResult {
  considered: number;
  started: number;
  skipped: Array<{ id: string; reason: string }>;
}

/**
 * Charge virtual cards whose activation date has arrived (property-local) and whose retry time is due.
 * Before every attempt the card is re-validated: never charged twice (a succeeded payment ends it), never
 * before activation, never after cancellation.
 */
export async function runDueVirtualCards(
  d: PaymentsDeps,
  ctx: RequestContext,
  opts: { propertyId?: string } = {},
): Promise<VccRunResult> {
  const due = await withTenantTx(d.database, ctx, async (tx) => {
    let q = db(tx)
      .selectFrom('payments.virtual_cards')
      .select(['id', 'property_id'])
      .where('status', 'in', ['scheduled', 'funding_retry'])
      .where((eb) => eb.or([eb('next_attempt_at', 'is', null), eb('next_attempt_at', '<=', tx.now)]));
    if (opts.propertyId) q = q.where('property_id', '=', opts.propertyId);
    return q.execute();
  });
  const result: VccRunResult = { considered: due.length, started: 0, skipped: [] };
  for (const v of due) {
    try {
      const started = await withTenantTx(d.database, ctx, async (tx) => {
        requirePermission(tx, 'payments.vcc.manage', { propertyId: v.property_id });
        const card = await db(tx).selectFrom('payments.virtual_cards').selectAll().where('id', '=', v.id).forUpdate().executeTakeFirstOrThrow();
        if (card.status !== 'scheduled' && card.status !== 'funding_retry') return { skip: `status ${card.status}` };
        const property = await loadProperty(d, tx, card.property_id);
        const today = localDateIn(tx.now, property.timezone);
        if (!vccIsActive(card.activation_date, today)) return { skip: `activates on ${card.activation_date}` };
        const paid = await db(tx)
          .selectFrom('payments.payments')
          .select('id')
          .where('virtual_card_id', '=', card.id)
          .where('status', 'in', ['succeeded', 'processing', 'pending_verification'])
          .executeTakeFirst();
        if (paid) return { skip: 'already charged or in progress' };
        const attempt = card.attempts + 1;
        const res = await charge(
          d,
          tx,
          {
            propertyId: card.property_id,
            methodId: card.method_id,
            amount: { amountMinor: card.amount_minor, currency: card.currency },
            ref: { type: card.ref_type, id: card.ref_id },
            initiator: 'merchant',
            businessKey: `vcc:${card.id}:attempt:${attempt}`,
          },
          { virtualCardId: card.id, method: 'virtual_card', skipPendingGuard: true },
        );
        await db(tx)
          .updateTable('payments.virtual_cards')
          .set({ status: 'charging', attempts: attempt, version: card.version + 1 })
          .where('id', '=', card.id)
          .execute();
        return { operationId: res.operationId };
      });
      if ('skip' in started) {
        result.skipped.push({ id: v.id, reason: started.skip as string });
        continue;
      }
      if (started.operationId) await executeOperation(d, ctx, started.operationId);
      result.started++;
    } catch (err) {
      result.skipped.push({ id: v.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
