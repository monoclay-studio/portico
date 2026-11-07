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
  ConflictError,
  formatMoney,
  localDateIn,
  money,
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
import { recordContext } from './records';
import {
  actorKey,
  assertAccountUsable,
  assertLedgerTarget,
  assertPaymentsWritable,
  assertSameRequest,
  db,
  effectiveModeFor,
  loadAccount,
  loadProperty,
  lockCollectionRefs,
  type PaymentsDeps,
  type RequestRow,
  requestHash,
  requireRead,
  toProviderAccount,
  toRequestView,
} from './shared';

const REQUEST_TO_PAYMENT_PURPOSE: Record<string, string> = {
  deposit: 'deposit',
  balance: 'balance',
  incidentals_preauth: 'incidentals',
};

/** P1-2: a new link must not ask again for money already collected (or being collected) for the same purpose. */
async function assertNoCompetingCollection(
  tx: TxContext,
  ref: { type: 'folio' | 'booking'; id: string },
  purpose: string,
  override: { reason: string } | undefined,
): Promise<void> {
  const paymentPurpose = REQUEST_TO_PAYMENT_PURPOSE[purpose];
  if (!paymentPurpose) return;
  const competing = await db(tx)
    .selectFrom('payments.payments')
    .select(['id', 'status', 'amount_minor', 'currency'])
    .where('ref_type', '=', ref.type)
    .where('ref_id', '=', ref.id)
    .where('purpose', '=', paymentPurpose as 'deposit')
    .where('status', 'in', [
      'processing',
      'pending_verification',
      'succeeded',
      'recorded_unverified',
      'recorded_verified',
    ])
    .executeTakeFirst();
  const openRequest = await db(tx)
    .selectFrom('payments.payment_requests')
    .select(['id', 'status'])
    .where('ref_type', '=', ref.type)
    .where('ref_id', '=', ref.id)
    .where('purpose', '=', purpose as 'deposit')
    .where('status', 'in', ['open', 'partially_paid'])
    .executeTakeFirst();
  if (!competing && !openRequest) return;
  if (override?.reason) {
    await tx.audit({
      action: 'payments.collection.ownershipOverride',
      target: {
        type: competing ? 'payment' : 'payment_request',
        id: (competing?.id ?? openRequest?.id) as string,
      },
      reason: override.reason,
      after: { ref, purpose },
    });
    return;
  }
  throw new BusinessRuleError(
    'collection_already_in_progress',
    competing
      ? `The ${paymentPurpose} of this ${ref.type} has already been collected or is being collected (payment ${competing.status.replace('_', ' ')}). A link would ask the guest to pay twice. If this is a separate amount, give a reason.`
      : `An open payment link for the ${paymentPurpose} of this ${ref.type} already exists. Cancel it first, or give a reason if this is a separate amount.`,
    { paymentId: competing?.id ?? null, paymentRequestId: openRequest?.id ?? null },
  );
}

export async function createPaymentRequest(
  d: PaymentsDeps,
  tx: TxContext,
  input: z.infer<typeof paymentRequestInput> & { businessKey: string },
  opts: { ledgerSynced?: boolean } = {},
): Promise<{ id: string; replayed: boolean }> {
  requirePermission(tx, 'payments.paymentRequest.create', { propertyId: input.propertyId });
  const businessKey = `request:${input.businessKey}`;
  const hash = requestHash({ p: input.propertyId, a: input.amount, r: input.ref, u: input.purpose });
  const existing = await db(tx)
    .selectFrom('payments.payment_requests')
    .select(['id', 'request_hash'])
    .where('business_key', '=', businessKey)
    .executeTakeFirst();
  if (existing) {
    assertSameRequest(existing.request_hash, hash, 'payment request');
    return { id: existing.id, replayed: true };
  }
  await assertPaymentsWritable(d, tx, input.propertyId);
  const property = await loadProperty(d, tx, input.propertyId);
  await assertLedgerTarget(d, tx, input.ref, property);
  // SW-PAY-1: the same per-reference lock as every collection path, so a link and a desk charge never both pass.
  await lockCollectionRefs(tx, [input.ref]);
  // A balance request kept in line with the folio (late charges) asks for what the ledger says is owed, which
  // already counts every payment collected; its caller refused while one is still in flight.
  if (!opts.ledgerSynced) {
    await assertNoCompetingCollection(tx, input.ref, input.purpose, input.separateCollection);
  }
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
      (a) =>
        a.currencies.includes(input.amount.currency) &&
        ((a.capabilities as string[]) ?? []).includes('paymentLinks'),
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
    throw new BusinessRuleError(
      'capability_not_supported',
      'This payment account cannot create payment links.',
    );
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
      request_hash: hash,
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
      created_at: tx.now,
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
    payload: {
      paymentRequestId: id,
      ref: input.ref,
      amountMinor: input.amount.amountMinor,
      currency: input.amount.currency,
    },
  });
  return { id, replayed: false };
}

/** Create the provider-hosted link (after commit). Safe to repeat: same idempotency key, no money moves. */
export async function ensurePaymentLink(
  d: PaymentsDeps,
  ctx: RequestContext,
  requestId: string,
): Promise<void> {
  const loaded = await withTenantTx(d.database, ctx, async (tx) => {
    const r = await db(tx)
      .selectFrom('payments.payment_requests')
      .selectAll()
      .where('id', '=', requestId)
      .executeTakeFirst();
    if (r?.status !== 'open' || r.link_status === 'created' || r.link_status === 'failed') return null;
    const account = await loadAccount(tx, r.account_id);
    // P1-11: a link recorded for one effect mode is never created in another (e.g. simulated → live).
    let modeNow: string;
    try {
      modeNow = d.registry.modeFor(tx, account);
    } catch {
      modeNow = 'blocked';
    }
    if (modeNow !== r.mode) {
      await db(tx)
        .updateTable('payments.payment_requests')
        .set({ link_status: 'failed', version: r.version + 1 })
        .where('id', '=', r.id)
        .execute();
      return null;
    }
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
          ? {
              link_status: 'created',
              provider_link_ref: outcome.linkRef,
              link_url: outcome.url,
              version: r.version + 1,
            }
          : { link_status: outcome.kind === 'failed' ? 'failed' : 'unknown', version: r.version + 1 },
      )
      .where('id', '=', r.id)
      .execute();
  });
}

export async function getPaymentRequest(tx: TxContext, id: string): Promise<PaymentRequest> {
  const r = await db(tx)
    .selectFrom('payments.payment_requests')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!r) throw new NotFoundError('payment_request', id);
  if (!tx.authz.can('payments.paymentRequest.create', { propertyId: r.property_id }))
    requireRead(tx, r.property_id);
  return toRequestView(r, await recordContext(tx, [{ type: 'payment_request', id }]));
}

export async function listPaymentRequests(
  tx: TxContext,
  ref: { type: string; id: string },
): Promise<PaymentRequest[]> {
  const rows = await db(tx)
    .selectFrom('payments.payment_requests')
    .selectAll()
    .where('ref_type', '=', ref.type as 'folio')
    .where('ref_id', '=', ref.id)
    .orderBy('created_at')
    .execute();
  const visible = rows.filter(
    (r) =>
      tx.authz.can('payments.payment.read', { propertyId: r.property_id }) ||
      tx.authz.can('payments.paymentRequest.create', { propertyId: r.property_id }),
  );
  const rc = await recordContext(
    tx,
    visible.map((r) => ({ type: 'payment_request', id: r.id })),
  );
  return visible.map((r) => toRequestView(r, rc));
}

export async function cancelPaymentRequest(
  d: PaymentsDeps,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  reason: string,
): Promise<PaymentRequest> {
  const r = await db(tx)
    .selectFrom('payments.payment_requests')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
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
  return toRequestView(row, await recordContext(tx, [{ type: 'payment_request', id }]));
}

/** Demo/test: the guest pays the simulated link (only in simulated mode). */
export async function simulateRequestPayment(
  d: PaymentsDeps,
  ctx: RequestContext,
  requestId: string,
  amountMinor?: number,
): Promise<void> {
  const { r, account } = await withTenantTx(d.database, ctx, async (tx) => {
    const r = await db(tx)
      .selectFrom('payments.payment_requests')
      .selectAll()
      .where('id', '=', requestId)
      .executeTakeFirst();
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
  await d.registry.simulator.simulateLinkPayment(
    toProviderAccount(account),
    r.provider_link_ref as string,
    amountMinor,
  );
}

// ───────────────────────── balance requests kept in line with the folio (late charges) ─────────────────────────

export interface BalanceSyncInput {
  propertyId: string;
  folioId: string;
  /** What the folio owes now, from finance's ledger (0 when settled or in credit). */
  outstanding: { amountMinor: number; currency: string };
  payer: { type: 'guest_profile' | 'company' | 'agency' | 'other'; id?: string; name: string };
  /** Why the balance changed (late charge, correction, transfer…), for the audit and the request's description. */
  reason: string;
}

export interface BalanceSyncResult {
  status: 'requested' | 'amended' | 'reissued' | 'cancelled' | 'unchanged' | 'none' | 'deferred';
  /** The open balance request after the sync, if any. */
  requestId: string | null;
  /** What the open request still asks the payer for (0 when none). Never more than the folio owes. */
  openMinor: number;
  detail: string;
}

/** Days a balance request for charges after departure stays open before it expires. */
const BALANCE_REQUEST_DAYS = 7;

/**
 * Review R2-P1-2: after departure a folio has at most ONE open balance request, and it always asks for what the
 * folio owes now. Finance calls this under its folio lock after every change to a departed folio's balance (late
 * charge, reversal, adjustment, transfer, desk payment, deposit application): payments creates the request, amends
 * it up or down (never below what was already paid through it), re-issues it when the provider link cannot be changed,
 * or closes it when nothing is owed. While a payment on the folio is still being confirmed nothing changes (the
 * folio's balance does not show it yet), and the result says so — never "requested" for an amount that was not.
 */
export async function syncBalanceRequest(
  d: PaymentsDeps,
  tx: TxContext,
  input: BalanceSyncInput,
): Promise<BalanceSyncResult> {
  requirePermission(tx, 'payments.paymentRequest.create', { propertyId: input.propertyId });
  const ref = { type: 'folio' as const, id: input.folioId };
  await assertPaymentsWritable(d, tx, input.propertyId);
  const property = await loadProperty(d, tx, input.propertyId);
  await assertLedgerTarget(d, tx, ref, property);
  await lockCollectionRefs(tx, [ref]);
  const open = await db(tx)
    .selectFrom('payments.payment_requests')
    .selectAll()
    .where('ref_type', '=', 'folio')
    .where('ref_id', '=', input.folioId)
    .where('purpose', '=', 'balance')
    .where('status', 'in', ['open', 'partially_paid'])
    .orderBy('created_at')
    .forUpdate()
    .execute();
  const current = open[0];
  const openMinor = (r: RequestRow | undefined) => (r ? r.amount_minor - r.paid_minor : 0);
  const inflight = await db(tx)
    .selectFrom('payments.payments')
    .select('id')
    .where('ref_type', '=', 'folio')
    .where('ref_id', '=', input.folioId)
    .where('status', 'in', ['processing', 'pending_verification'])
    .executeTakeFirst();
  if (inflight) {
    return {
      status: 'deferred',
      requestId: current?.id ?? null,
      openMinor: openMinor(current),
      detail:
        'A payment on this folio is still being confirmed, so the balance request was not changed (asking now could ask twice). Check the folio once the payment is confirmed.',
    };
  }
  const want = Math.max(0, input.outstanding.amountMinor);
  const currency = input.outstanding.currency;
  const fmt = (n: number) => formatMoney(money(n, currency));
  const create = async (n: number) => {
    const count = await db(tx)
      .selectFrom('payments.payment_requests')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('ref_type', '=', 'folio')
      .where('ref_id', '=', input.folioId)
      .where('purpose', '=', 'balance')
      .executeTakeFirstOrThrow();
    const r = await createPaymentRequest(
      d,
      tx,
      {
        propertyId: input.propertyId,
        payer: input.payer,
        amount: { amountMinor: n, currency },
        purpose: 'balance',
        ref,
        description: 'Charges posted after departure',
        expiresAt: new Date(tx.now.getTime() + BALANCE_REQUEST_DAYS * 86_400_000).toISOString(),
        businessKey: `balance-sync:${input.folioId}:${Number(count.n) + 1}`,
      },
      { ledgerSynced: true },
    );
    return r.id;
  };
  const audit = async (id: string, before: number, after: number, how: string) =>
    tx.audit({
      action: 'payments.request.balanceSync',
      target: { type: 'payment_request', id },
      propertyId: input.propertyId,
      reason: input.reason,
      before: { openMinor: before },
      after: { openMinor: after, how },
    });
  if (!current) {
    if (want === 0) {
      return {
        status: 'none',
        requestId: null,
        openMinor: 0,
        detail: 'The folio owes nothing; no payment request.',
      };
    }
    const id = await create(want);
    await audit(id, 0, want, 'requested');
    return {
      status: 'requested',
      requestId: id,
      openMinor: want,
      detail: `Payment request for ${fmt(want)} created; send the link to the payer.`,
    };
  }
  const before = openMinor(current);
  if (before === want) {
    return {
      status: 'unchanged',
      requestId: current.id,
      openMinor: before,
      detail: `The open payment request already asks for ${fmt(want)}.`,
    };
  }
  if (want === 0) {
    // Nothing owed any more: close the request. Never below what was already paid through it.
    const paidInFull = current.paid_minor > 0;
    await db(tx)
      .updateTable('payments.payment_requests')
      .set(
        paidInFull
          ? { amount_minor: current.paid_minor, status: 'paid', version: current.version + 1 }
          : {
              status: 'cancelled',
              cancelled_reason: `The folio no longer owes anything (${input.reason}).`,
              version: current.version + 1,
            },
      )
      .where('id', '=', current.id)
      .execute();
    await audit(current.id, before, 0, paidInFull ? 'closed_as_paid' : 'cancelled');
    if (!paidInFull) {
      await tx.emit({
        type: PaymentsEvents.requestCancelled,
        propertyId: current.property_id,
        aggregate: { type: 'payment_request', id: current.id },
        payload: { paymentRequestId: current.id, reason: 'balance_settled' },
      });
    }
    return {
      status: 'cancelled',
      requestId: null,
      openMinor: 0,
      detail: `The folio no longer owes anything, so the payment request for ${fmt(before)} was ${paidInFull ? 'closed' : 'cancelled'}.`,
    };
  }
  if (!current.provider_link_ref) {
    // No provider link yet: amend in place (the link is created for the new amount).
    await db(tx)
      .updateTable('payments.payment_requests')
      .set({ amount_minor: current.paid_minor + want, version: current.version + 1 })
      .where('id', '=', current.id)
      .execute();
    await audit(current.id, before, want, 'amended');
    return {
      status: 'amended',
      requestId: current.id,
      openMinor: want,
      detail: `The open payment request now asks for ${fmt(want)} (was ${fmt(before)}).`,
    };
  }
  // A provider link cannot change its amount: cancel it and issue a new one. A payment that still arrives on the old
  // link is credited to the cancelled request and raised for a refund or credit (never lost).
  await db(tx)
    .updateTable('payments.payment_requests')
    .set({
      status: 'cancelled',
      cancelled_reason: `Replaced by a request for ${fmt(want)}: the folio balance changed (${input.reason}).`,
      version: current.version + 1,
    })
    .where('id', '=', current.id)
    .execute();
  await tx.emit({
    type: PaymentsEvents.requestCancelled,
    propertyId: current.property_id,
    aggregate: { type: 'payment_request', id: current.id },
    payload: { paymentRequestId: current.id, reason: 'balance_changed' },
  });
  const id = await create(want);
  await audit(id, before, want, `reissued (replaces ${current.id})`);
  return {
    status: 'reissued',
    requestId: id,
    openMinor: want,
    detail: `The folio now owes ${fmt(want)}: the earlier link for ${fmt(before)} was cancelled and a new payment link created. Send the new link.`,
  };
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
  await assertLedgerTarget(d, tx, input.ledgerRef ?? { type: 'booking', id: input.bookingId }, property);
  // Review R2-P1-1: a channel's virtual card pays a booking OF THAT CHANNEL. Registering one for a direct booking would
  // let anyone with `payments.vcc.manage` attach a card the booking's guest never supplied.
  const booking = await d.references.describeReference(tx, { type: 'booking', id: input.bookingId });
  if (!booking || booking.propertyId !== input.propertyId) {
    throw new BusinessRuleError(
      'reference_unknown',
      'Portico has no booking with this reference at this property, so no virtual card can be registered for it.',
      { bookingId: input.bookingId },
    );
  }
  if (booking.source !== 'channel' || !booking.channelConnectionId) {
    throw new BusinessRuleError(
      'vcc_booking_not_from_channel',
      'This booking was not made through a channel, so a channel virtual card cannot pay or guarantee it. Ask the guest for their card through a payment link.',
      { bookingId: input.bookingId },
    );
  }
  const account = await loadAccount(tx, input.accountId);
  assertAccountUsable(account, property, input.amount.currency);
  const simulated = effectiveModeFor(d, tx, account) === 'simulate';
  if (simulated && !isSimulatorTestToken(input.vaultToken)) {
    throw new ValidationError(
      'simulator_test_token_required',
      'In this environment payments are simulated: register virtual cards with a simulator test token.',
    );
  }
  // Review R2-P2-1 / AP-39: one stored token per card; a token already saved is refused cleanly (never an aborted
  // transaction), and the simulator's shared test tokens are stored per booking.
  const storedToken = simulated
    ? `${input.vaultToken}#${input.propertyId}:booking:${input.bookingId}:${input.channelReference}`
    : input.vaultToken;
  const taken = await db(tx)
    .selectFrom('payments.payment_methods')
    .select('id')
    .where('account_id', '=', account.id)
    .where('provider_token', '=', storedToken)
    .executeTakeFirst();
  if (taken) {
    throw new ConflictError(
      'payment_method_token_in_use',
      'This virtual card token is already saved in Portico. Check the channel reference; a virtual card is registered once.',
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
      provider_token: storedToken,
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
      mandate: JSON.stringify({
        kind: 'ota_virtual_card',
        channel: input.channel,
        channelReference: input.channelReference,
        channelConnectionId: booking.channelConnectionId,
        termsVersion: `channel-contract:${input.channel}`,
        acceptedAt: tx.now.toISOString(),
        scope: {
          legalEntityId: property.legalEntityId,
          propertyIds: [input.propertyId],
          purposes: ['guarantee', 'deposit', 'balance', 'no_show'],
          maxAmount: input.amount,
          bookingIds: [input.bookingId],
        },
      }),
      entry_channel: 'vault',
      created_at: tx.now,
      token_portability: 'vault_portable',
      portability_note:
        'Virtual card held via a PCI vault/proxy (vendor not yet selected — unresolved dependency).',
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
    after: {
      channel: input.channel,
      channelReference: input.channelReference,
      amount: input.amount,
      activationDate: input.activationDate,
    },
  });
  return toVccView(row);
}

export async function getVirtualCard(tx: TxContext, id: string): Promise<VirtualCard> {
  const v = await db(tx)
    .selectFrom('payments.virtual_cards')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
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
        const card = await db(tx)
          .selectFrom('payments.virtual_cards')
          .selectAll()
          .where('id', '=', v.id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (card.status !== 'scheduled' && card.status !== 'funding_retry')
          return { skip: `status ${card.status}` };
        const property = await loadProperty(d, tx, card.property_id);
        const today = localDateIn(tx.now, property.timezone);
        if (!vccIsActive(card.activation_date, today))
          return { skip: `activates on ${card.activation_date}` };
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
            purpose: 'custom', // the channel's card pays the channel's booking: not owned by a guest link
            businessKey: `vcc:${card.id}:attempt:${attempt}`,
          },
          { virtualCardId: card.id, method: 'virtual_card' },
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
