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
import type { LinkDeactivationOutcome } from '../providers/provider';
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
  bookingConsentEvidence,
  db,
  effectiveModeFor,
  loadAccount,
  loadProperty,
  lockCollectionRefs,
  type PaymentsDeps,
  type RequestRow,
  raiseException,
  referenceContext,
  requestContextOf,
  requestHash,
  requireRead,
  resolveExceptionsByKey,
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
  d: PaymentsDeps,
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
  // R3-P2-1: an open link for the same purpose anywhere in the booking family (booking, stays, folios) competes too.
  const { bookingId } = await referenceContext(d, tx, ref);
  const openRequest = await db(tx)
    .selectFrom('payments.payment_requests')
    .select(['id', 'status'])
    .where((eb) =>
      eb.or([
        eb.and([eb('ref_type', '=', ref.type), eb('ref_id', '=', ref.id)]),
        ...(bookingId ? [eb('family_booking_id', '=', bookingId)] : []),
      ]),
    )
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
  await lockCollectionRefs(d, tx, [input.ref]);
  // A balance request kept in line with the folio (late charges) asks for what the ledger says is owed, which
  // already counts every payment collected; its caller refused while one is still in flight.
  if (!opts.ledgerSynced) {
    await assertNoCompetingCollection(d, tx, input.ref, input.purpose, input.separateCollection);
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
  const { bookingId: familyBookingId } = await referenceContext(d, tx, input.ref);
  await db(tx)
    .insertInto('payments.payment_requests')
    .values({
      id,
      tenant_id: tx.tenantId,
      family_booking_id: familyBookingId,
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
    // Re-review #3 (Amendment 2): a replacement link is sent only once the provider confirmed the old link of the
    // same reference no longer takes payments (`deactivating` → `deactivated`); until then the guest has one link.
    const retiring = await db(tx)
      .selectFrom('payments.payment_requests')
      .select('id')
      .where('ref_type', '=', r.ref_type)
      .where('ref_id', '=', r.ref_id)
      .where('link_status', 'in', ['deactivating', 'completed'])
      .where('id', '!=', r.id)
      .executeTakeFirst();
    if (retiring) return null;
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
          now: d.database.clock.now(),
        })
      : { kind: 'failed', code: 'provider_not_configured', message: 'No provider credentials configured.' };
  } catch (err) {
    outcome = { kind: 'unknown', reason: err instanceof Error ? err.message : String(err) };
  }
  const retire = await withTenantTx(d.database, ctx, async (tx) => {
    const now = await db(tx)
      .selectFrom('payments.payment_requests')
      .select(['status', 'version'])
      .where('id', '=', r.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    // The request was closed or replaced while its link was being created: the new link must not stay payable.
    const closed = now.status !== 'open' && now.status !== 'partially_paid';
    await db(tx)
      .updateTable('payments.payment_requests')
      .set(
        outcome.kind === 'created'
          ? {
              link_status: closed ? 'deactivating' : 'created',
              provider_link_ref: outcome.linkRef,
              link_url: closed ? null : outcome.url,
              version: now.version + 1,
            }
          : {
              link_status: outcome.kind === 'failed' ? 'failed' : closed ? 'deactivating' : 'unknown',
              version: now.version + 1,
            },
      )
      .where('id', '=', r.id)
      .execute();
    return closed && outcome.kind !== 'failed';
  });
  if (retire) await ensureLinkDeactivated(d, ctx, r.id);
}

/**
 * Re-review #3 (ADR-0015 Amendment 2): payment links are externally writable — the provider takes payments on a link
 * until it confirms the link is deactivated. Inside the transaction that closes, replaces or cancels a request, its
 * link is marked `deactivating`; after commit `ensureLinkDeactivated` tells the provider. Until the provider confirms,
 * the old link counts as possibly payable (a payment on it is credited to the closed request and raised as an URGENT
 * refund exception), and no replacement link is sent.
 */
export async function retireRequestLink(tx: TxContext, r: RequestRow): Promise<boolean> {
  const possiblyLive = r.provider_link_ref !== null || r.link_status === 'unknown';
  if (!possiblyLive || r.link_status === 'deactivated') return false;
  await db(tx)
    .updateTable('payments.payment_requests')
    .set({ link_status: 'deactivating', link_url: null, link_status_at: tx.now })
    .where('id', '=', r.id)
    .execute();
  return true;
}

/** After commit: deactivate a retired link at the provider, then release any replacement waiting for it. */
export async function ensureLinkDeactivated(
  d: PaymentsDeps,
  ctx: RequestContext,
  requestId: string,
): Promise<'deactivated' | 'pending'> {
  const loaded = await withTenantTx(d.database, ctx, async (tx) => {
    const r = await db(tx)
      .selectFrom('payments.payment_requests')
      .selectAll()
      .where('id', '=', requestId)
      .executeTakeFirst();
    if (r?.link_status !== 'deactivating') return null;
    return { r, account: await loadAccount(tx, r.account_id) };
  });
  if (!loaded) return 'deactivated';
  const { r, account } = loaded;
  const pa = toProviderAccount(account);
  let outcome: LinkDeactivationOutcome;
  try {
    const resolved = d.registry.forAccount(ctx, pa);
    if (!resolved.ok) {
      outcome = { kind: 'unknown', reason: 'provider not available' };
    } else {
      let linkRef = r.provider_link_ref;
      if (!linkRef) {
        // The link's creation outcome was unknown: recover its reference (same idempotency key — never a second link).
        const created = await resolved.provider.createPaymentLink(pa, {
          operationId: r.id,
          idempotencyKey: `portico-link-${r.id}`,
          // R4-P2-2: the ORIGINAL amount, so the provider's idempotency check matches the first call.
          amount: { amountMinor: r.amount_minor, currency: r.currency },
          description: r.description ?? `Payment ${r.purpose}`,
          expiresAt: new Date(r.expires_at),
          requestId: r.id,
        });
        linkRef = created.kind === 'created' ? created.linkRef : null;
      }
      outcome = linkRef
        ? await resolved.provider.deactivatePaymentLink(pa, {
            operationId: r.id,
            idempotencyKey: `portico-link-off-${r.id}`,
            linkRef,
          })
        : { kind: 'unknown', reason: 'link reference not recovered' };
      if (linkRef && !r.provider_link_ref) {
        await withTenantTx(d.database, ctx, (tx) =>
          db(tx)
            .updateTable('payments.payment_requests')
            .set({ provider_link_ref: linkRef })
            .where('id', '=', r.id)
            .execute(),
        );
      }
    }
  } catch (err) {
    outcome = { kind: 'unknown', reason: err instanceof Error ? err.message : String(err) };
  }
  // R4-P2-1 / R4-P2-2: `already_completed` — the provider took a payment on it. The replacement waits until that payment
  // is recorded here (the webhook credits it; its finance posting re-syncs the balance request), so it never asks for
  // money just paid. `failed` raises an owned, urgent item at once; `unknown` is retried (oldest first) and raised
  // after a deadline by reconciliation.
  if (outcome.kind === 'failed') {
    await withTenantTx(d.database, ctx, (tx) => raiseLinkNotStopped(tx, r, outcome.message));
    return 'pending';
  }
  if (outcome.kind !== 'deactivated' && outcome.kind !== 'already_completed') return 'pending';
  const released = await withTenantTx(d.database, ctx, async (tx) => {
    const recorded =
      outcome.kind === 'deactivated' ||
      (await db(tx)
        .selectFrom('payments.payments')
        .select('id')
        .where('payment_request_id', '=', r.id)
        .where('kind', '=', 'link')
        .executeTakeFirst()) !== undefined;
    await db(tx)
      .updateTable('payments.payment_requests')
      .set((eb) => ({
        link_status: recorded ? 'deactivated' : 'completed',
        link_status_at: tx.now,
        version: eb('version', '+', 1),
      }))
      .where('id', '=', r.id)
      .where('link_status', '=', 'deactivating')
      .execute();
    await tx.audit({
      action: 'payments.request.linkDeactivated',
      target: { type: 'payment_request', id: r.id },
      propertyId: r.property_id,
      after: { outcome: outcome.kind, paymentRecorded: recorded },
    });
    if (recorded)
      await resolveExceptionsByKey(
        tx,
        `link-not-stopped:${r.id}`,
        'The provider confirmed the link is stopped.',
      );
    return recorded;
  });
  if (!released) return 'pending';
  await releaseWaitingLinks(d, ctx, { type: r.ref_type, id: r.ref_id });
  return 'deactivated';
}

/** After a retired link is known dead and its payments are accounted for: send the replacement link(s) waiting for it. */
export async function releaseWaitingLinks(
  d: PaymentsDeps,
  ctx: RequestContext,
  ref: { type: string; id: string },
): Promise<void> {
  const waiting = await withTenantTx(d.database, ctx, (tx) =>
    db(tx)
      .selectFrom('payments.payment_requests')
      .select('id')
      .where('ref_type', '=', ref.type as 'folio')
      .where('ref_id', '=', ref.id)
      .where('status', '=', 'open')
      .where('link_status', '=', 'pending')
      .execute(),
  );
  for (const w of waiting) await ensurePaymentLink(d, ctx, w.id);
}

/**
 * R4-P2-2: a link Portico retired that the provider has not confirmed as stopped is "possibly live" — it has an owner
 * and a next step. Raised at once on a provider refusal, and by reconciliation when the confirmation is overdue.
 */
export async function raiseLinkNotStopped(tx: TxContext, r: RequestRow, why: string): Promise<void> {
  await raiseException(tx, {
    propertyId: r.property_id,
    kind: 'payment_link_not_stopped',
    severity: 'urgent',
    problem: `The payment provider has not confirmed that the replaced or cancelled payment link for ${formatMoney(money(r.amount_minor, r.currency))} no longer takes payments (${why}).`,
    businessImpact:
      'The guest could still pay the old link, and the new link (if any) is held back so the guest is not asked twice.',
    nextStep:
      'Stop the link in the provider dashboard, then confirm it on the payment request ("Link stopped", with what you did). The replacement link is created then.',
    ownerRole: 'finance',
    responsibleParty: 'hotel',
    ref: { type: 'payment_request', id: r.id },
    dedupeKey: `link-not-stopped:${r.id}`,
  });
}

/**
 * R4-P2-2: staff confirm a retired link is stopped (they stopped it in the provider dashboard). Idempotent with a late
 * provider confirmation (only a link still `deactivating`/`completed` changes). Audited with the reason.
 */
export async function confirmLinkStopped(
  d: PaymentsDeps,
  tx: TxContext,
  input: { requestId: string; reason: string },
): Promise<void> {
  const r = await db(tx)
    .selectFrom('payments.payment_requests')
    .selectAll()
    .where('id', '=', input.requestId)
    .forUpdate()
    .executeTakeFirst();
  if (!r) throw new NotFoundError('payment_request', input.requestId);
  requirePermission(tx, 'payments.paymentRequest.create', { propertyId: r.property_id });
  if (r.link_status !== 'deactivating' && r.link_status !== 'completed') return;
  await db(tx)
    .updateTable('payments.payment_requests')
    .set({ link_status: 'deactivated', link_status_at: tx.now, version: r.version + 1 })
    .where('id', '=', r.id)
    .execute();
  await tx.audit({
    action: 'payments.request.linkStoppedConfirmed',
    target: { type: 'payment_request', id: r.id },
    propertyId: r.property_id,
    reason: input.reason,
    before: { linkStatus: r.link_status },
    after: { linkStatus: 'deactivated' },
  });
  await resolveExceptionsByKey(tx, `link-not-stopped:${r.id}`, `Confirmed stopped by staff: ${input.reason}`);
  const ctx = requestContextOf(tx);
  tx.afterCommit(() => releaseWaitingLinks(d, ctx, { type: r.ref_type, id: r.ref_id }));
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
  // Re-review #3: a cancelled request's link stops taking payments at the provider (after commit).
  if (await retireRequestLink(tx, row)) {
    const ctx = requestContextOf(tx);
    tx.afterCommit(() => ensureLinkDeactivated(d, ctx, id).then(() => undefined));
  }
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
  status: 'requested' | 'reissued' | 'cancelled' | 'unchanged' | 'none' | 'deferred';
  /** The open balance request after the sync, if any. */
  requestId: string | null;
  /** What the open request still asks the payer for (0 when none). Never more than the folio owes. */
  openMinor: number;
  /**
   * The request this sync closed or replaced, whose provider link is being deactivated (after commit). Until the
   * provider confirms, that link may still be paid; the replacement link is sent only after the confirmation.
   */
  retiredRequestId?: string;
  /** R4-P2-2: whether the open request's link exists at the provider NOW (never claim "send it" before). */
  linkReady: boolean;
  detail: string;
}

/** Days a balance request for charges after departure stays open before it expires. */
const BALANCE_REQUEST_DAYS = 7;

/**
 * Review R2-P1-2 / re-review #3 R3-P1-1: after departure a folio has at most ONE open balance request, and it always asks
 * for what the folio owes now. Finance calls this under the collection lock and its folio lock after every change to a
 * departed folio's balance (late charge, reversal, adjustment, transfer, settlement to receivables, payment, refund,
 * payment adjustment, deposit application, and the end of a deferral when an in-flight payment fails or succeeds).
 *
 * The request is a small state machine with the provider as an external writer (ADR-0015 Amendment 2):
 *  - none + debt → `requested` (a new request; its link is created after commit);
 *  - open + same debt → `unchanged`;
 *  - open + other debt → `reissued`: the old request is cancelled and its link deactivated at the provider; the new
 *    request's link is created only once the provider confirmed (until then the old link may still be paid — such a
 *    payment is credited to the cancelled request and raised as an URGENT refund exception);
 *  - open + no debt → `cancelled` (or closed as paid at what was already paid through it), link deactivated;
 *  - a payment on the folio still being confirmed → `deferred`: nothing changes (the balance does not show it yet);
 *    finance keeps an open item and re-runs the sync when that payment fails or succeeds.
 * Amounts never change in place: a provider link's amount cannot change, and a request's amount is what was sent.
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
  await lockCollectionRefs(d, tx, [ref]);
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
      linkReady: current?.link_status === 'created',
      detail:
        'A payment on this folio is still being confirmed, so the balance request was not changed (asking now could ask twice). It is brought in line as soon as that payment succeeds or fails.',
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
        linkReady: false,
        detail: 'The folio owes nothing; no payment request.',
      };
    }
    const id = await create(want);
    await audit(id, 0, want, 'requested');
    return {
      status: 'requested',
      requestId: id,
      openMinor: want,
      linkReady: false,
      detail: `Payment request for ${fmt(want)} created; send the link to the payer.`,
    };
  }
  const before = openMinor(current);
  if (before === want) {
    return {
      status: 'unchanged',
      requestId: current.id,
      openMinor: before,
      linkReady: current.link_status === 'created',
      detail: `The open payment request already asks for ${fmt(want)}.`,
    };
  }
  // Close the current request (never below what was already paid through it) and stop its link at the provider.
  const paidSome = current.paid_minor > 0;
  await db(tx)
    .updateTable('payments.payment_requests')
    .set(
      paidSome && want === 0
        ? { amount_minor: current.paid_minor, status: 'paid', version: current.version + 1 }
        : {
            status: 'cancelled',
            cancelled_reason:
              want === 0
                ? `The folio no longer owes anything (${input.reason}).`
                : `Replaced by a request for ${fmt(want)}: the folio balance changed (${input.reason}).`,
            version: current.version + 1,
          },
    )
    .where('id', '=', current.id)
    .execute();
  const retiring = await retireRequestLink(tx, current);
  await tx.emit({
    type: PaymentsEvents.requestCancelled,
    propertyId: current.property_id,
    aggregate: { type: 'payment_request', id: current.id },
    payload: { paymentRequestId: current.id, reason: want === 0 ? 'balance_settled' : 'balance_changed' },
  });
  const linkNote = retiring
    ? ' Its link is being deactivated at the provider; until the provider confirms, a payment on it is refunded as an urgent item.'
    : '';
  if (want === 0) {
    await audit(current.id, before, 0, paidSome ? 'closed_as_paid' : 'cancelled');
    return {
      status: 'cancelled',
      requestId: null,
      openMinor: 0,
      linkReady: false,
      ...(retiring ? { retiredRequestId: current.id } : {}),
      detail: `The folio no longer owes anything, so the payment request for ${fmt(before)} was closed.${linkNote}`,
    };
  }
  const id = await create(want);
  await audit(id, before, want, `reissued (replaces ${current.id})`);
  return {
    status: 'reissued',
    requestId: id,
    openMinor: want,
    linkReady: false,
    ...(retiring ? { retiredRequestId: current.id } : {}),
    detail: `The folio now owes ${fmt(want)}: the request for ${fmt(before)} was replaced.${linkNote} The new link is sent once the old one is confirmed inactive.`,
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
          // Amendment 3: the booking's stays as the channel sent it — a stay added later is not paid by this card.
          bookingEvidence: {
            [input.bookingId]: await bookingConsentEvidence(
              d,
              tx,
              input.bookingId,
              tx.now.toISOString(),
              `channel:${input.channel}`,
            ),
          },
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
            // The channel's card pays the channel's booking: a deposit on the booking (or the balance of a folio),
            // inside the channel card's agreement (R3-P1-2: `custom` is never a covered purpose).
            purpose: card.ref_type === 'booking' ? 'deposit' : 'balance',
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
