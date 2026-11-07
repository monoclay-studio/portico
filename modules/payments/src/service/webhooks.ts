/**
 * Provider webhook intake (PAY-R15): signature-verified, deduplicated by provider event id (PAY-I07), stored
 * (card data scrubbed) for audit, and out-of-order safe. Payment and refund events are treated as TRIGGERS to
 * verify the related operations by provider lookup ("fetch the latest object state instead of trusting event
 * order", research 04 §B7.3); state changes are monotonic, so an old snapshot arriving late changes nothing.
 */
import { sql, type TxContext, withTenantTx } from '@portico/db';
import {
  BusinessRuleError,
  DomainError,
  formatMoney,
  isUuid,
  money,
  newId,
  type RequestContext,
  requirePermission,
  systemContext,
  type TenantEnvironment,
} from '@portico/kernel';
import { scrubCardData } from '../domain/pci';
import { type AuthorizationStatus, authorizationTransition, disputeTransition } from '../domain/states';
import { PaymentsEvents } from '../events';
import { type VerifiedWebhook, type WebhookObject, WebhookSignatureError } from '../providers/provider';
import { clearingOf, ledgerKey, postPaymentLedger, tryLedger } from './ledger';
import { creditPaymentRequest, raiseIfOvercollected, verifyOperation } from './operations';
import { releaseWaitingLinks } from './requests';
import {
  db,
  effectiveModeFor,
  loadAccount,
  lockCollectionRefs,
  type PaymentsDeps,
  raiseException,
  requestContextOf,
  resolveExceptionsByKey,
  toProviderAccount,
} from './shared';

type WebhookOutcome = 'applied' | 'no_change' | 'stale' | 'unknown_type' | 'no_match';

export interface WebhookReceipt {
  status: 'processed' | 'duplicate' | 'ignored' | 'failed';
  outcome?: WebhookOutcome;
  detail?: string;
}

/** Public endpoint entry point for Stripe Connect events. */
export async function receiveStripeWebhook(
  d: PaymentsDeps,
  rawBody: string,
  headers: Record<string, string | undefined>,
): Promise<WebhookReceipt> {
  const now = d.database.clock.now();
  let event: VerifiedWebhook | null = null;
  let configured = false;
  for (const mode of ['live', 'sandbox'] as const) {
    const adapter = d.registry.stripeForWebhooks(mode);
    if (!adapter) continue;
    configured = true;
    try {
      event = adapter.parseWebhook(rawBody, headers, now);
      break;
    } catch (err) {
      if (!(err instanceof WebhookSignatureError)) throw err;
    }
  }
  if (!configured) {
    throw new DomainError(
      'webhooks_not_configured',
      'Stripe webhooks are not configured for this deployment; the event was not processed.',
      { status: 503, retryable: true },
    );
  }
  if (!event) {
    throw new DomainError(
      'webhook_signature_invalid',
      'The webhook signature could not be verified; the event was ignored.',
      {
        status: 400,
      },
    );
  }
  const { rows } = await sql<{ tenant_id: string; account_id: string; environment: TenantEnvironment }>`
    select tenant_id, account_id, environment
      from payments.route_webhook(${'stripe_connect'}, ${event.externalAccountId}, ${event.livemode})`.execute(
    d.database.kysely,
  );
  if (rows.length > 1) {
    // Cannot happen with the global uniqueness of provider accounts; refuse rather than guess (P0-2).
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'ambiguous webhook route',
        provider: 'stripe_connect',
        event: event.eventId,
      }),
    );
    return { status: 'ignored', detail: 'Ambiguous payment account; event not routed.' };
  }
  const route = rows[0];
  if (!route) return { status: 'ignored', detail: 'No payment account matches this event.' };
  const ctx = systemContext(
    route.tenant_id,
    'payments-webhook',
    route.environment,
    `webhook:${event.eventId}`,
  );
  return processVerifiedWebhook(d, ctx, route.account_id, 'stripe_connect', event);
}

/** Demo/test: deliver the simulator's queued events through the same verification + processing path. */
export async function deliverSimulatorWebhooks(
  d: PaymentsDeps,
  ctx: RequestContext,
  accountId: string,
): Promise<{ delivered: number; receipts: WebhookReceipt[] }> {
  const account = await withTenantTx(d.database, ctx, async (tx) => {
    requirePermission(tx, 'payments.account.manage');
    const a = await loadAccount(tx, accountId);
    if (effectiveModeFor(d, tx, a) !== 'simulate') {
      throw new BusinessRuleError('not_simulated', 'Only simulated accounts have simulator webhooks.');
    }
    return a;
  });
  const sim = d.registry.simulator;
  const events = await sim.drainWebhooks(toProviderAccount(account));
  const system = systemContext(ctx.tenantId, 'payments-webhook', ctx.environment, newId());
  const receipts: WebhookReceipt[] = [];
  for (const e of events) {
    const verified = sim.parseWebhook(e.rawBody, e.headers, d.database.clock.now());
    if (verified.externalAccountId !== account.external_account_id) {
      receipts.push({ status: 'ignored', detail: 'account mismatch' });
      continue;
    }
    try {
      receipts.push(await processVerifiedWebhook(d, system, account.id, 'simulator', verified));
    } catch (err) {
      // Like a real provider: a failed delivery is delivered again later.
      await sim.requeue(toProviderAccount(account), verified.eventId);
      receipts.push({ status: 'failed', detail: err instanceof Error ? err.message : String(err) });
    }
  }
  return { delivered: events.length, receipts };
}

function objectRef(o: WebhookObject): string | null {
  return 'providerRef' in o ? o.providerRef : null;
}

/**
 * Process a verified provider event at most once — but never LOSE it (P0-3): the event row is a receipt, and
 * only `processed_at` (written in the same transaction as the effect, or after all lookups succeeded) makes a
 * redelivery a duplicate. A failure leaves the event unprocessed, the caller answers non-2xx, and the provider's
 * redelivery or the event backstop job processes it again.
 */
export async function processVerifiedWebhook(
  d: PaymentsDeps,
  ctx: RequestContext,
  accountId: string,
  provider: string,
  event: VerifiedWebhook,
): Promise<WebhookReceipt> {
  const claimed = await withTenantTx(d.database, ctx, async (tx) => {
    const row = await db(tx)
      .insertInto('payments.webhook_events')
      .values({
        id: newId(tx.now.getTime()),
        tenant_id: tx.tenantId,
        account_id: accountId,
        provider,
        provider_event_id: event.eventId,
        event_type: event.type,
        object_kind: event.object.kind,
        object_ref: objectRef(event.object),
        livemode: event.livemode,
        // Data minimisation: only the normalized object (ids, states, amounts) — no billing details (P3-8).
        payload: JSON.stringify(
          scrubCardData({
            id: event.eventId,
            type: event.type,
            account: event.externalAccountId,
            created: event.createdAt.toISOString(),
            object: event.object,
          }),
        ),
        received_at: tx.now,
        outcome: 'received',
        outcome_detail: null,
      })
      .onConflict((oc) => oc.columns(['tenant_id', 'provider', 'provider_event_id']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (row) return row.id;
    const existing = await db(tx)
      .selectFrom('payments.webhook_events')
      .select(['id', 'processed_at', 'attempts'])
      .where('provider', '=', provider)
      .where('provider_event_id', '=', event.eventId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (existing.processed_at) return null;
    await db(tx)
      .updateTable('payments.webhook_events')
      .set({ attempts: existing.attempts + 1 })
      .where('id', '=', existing.id)
      .execute();
    return existing.id;
  });
  if (!claimed) return { status: 'duplicate', detail: `Event ${event.eventId} was already processed.` };
  const markProcessed = (tx: TxContext, outcome: WebhookOutcome) =>
    db(tx)
      .updateTable('payments.webhook_events')
      .set({ outcome, processed_at: tx.now, outcome_detail: null })
      .where('id', '=', claimed)
      .execute();
  const inOneTx = (fn: (tx: TxContext) => Promise<WebhookOutcome>) =>
    withTenantTx(d.database, ctx, async (tx) => {
      const outcome = await fn(tx);
      await markProcessed(tx, outcome);
      return outcome;
    });

  let outcome: WebhookOutcome;
  const o = event.object;
  try {
    switch (o.kind) {
      case 'payment':
        outcome = await handlePaymentObject(d, ctx, accountId, o);
        await withTenantTx(d.database, ctx, (tx) => markProcessed(tx, outcome));
        break;
      case 'refund':
        outcome = await handleRefundObject(d, ctx, accountId, o);
        await withTenantTx(d.database, ctx, (tx) => markProcessed(tx, outcome));
        break;
      case 'dispute':
        outcome = await inOneTx((tx) => applyDispute(d, tx, accountId, o));
        break;
      case 'payout':
        outcome = await inOneTx((tx) => applyPayoutEvent(d, tx, accountId, o));
        break;
      case 'payment_link':
        outcome = await inOneTx((tx) => applyLinkEvent(d, tx, accountId, o));
        break;
      case 'account':
        outcome = await inOneTx((tx) => applyAccountEvent(tx, accountId, o, event.createdAt));
        break;
      default:
        outcome = await inOneTx(async () => 'unknown_type');
    }
  } catch (err) {
    await withTenantTx(d.database, ctx, (tx) =>
      db(tx)
        .updateTable('payments.webhook_events')
        .set({
          outcome: 'failed',
          outcome_detail: (err instanceof Error ? err.message : String(err)).slice(0, 1000),
        })
        .where('id', '=', claimed)
        .execute(),
    );
    throw err;
  }
  return { status: 'processed', outcome };
}

/**
 * Event backstop (PAY-R16 partial, P0-3): list the provider's events since the last cursor for every account
 * and process the ones never (successfully) received — disputes, payouts, account restrictions and payment
 * outcomes cannot be lost because one webhook delivery failed.
 */
export async function runEventBackstop(
  d: PaymentsDeps,
  ctx: RequestContext,
): Promise<{ accounts: number; applied: number }> {
  const accounts = await withTenantTx(d.database, ctx, (tx) =>
    db(tx)
      .selectFrom('payments.accounts')
      .selectAll()
      .where('provider', '!=', 'external_terminal')
      .where('external_account_id', 'is not', null)
      .execute(),
  );
  let applied = 0;
  const system = systemContext(ctx.tenantId, 'payments-event-backstop', ctx.environment, newId());
  for (const a of accounts) {
    let modeNow: string;
    try {
      modeNow = d.registry.modeFor(ctx, a);
    } catch {
      continue;
    }
    const pa = toProviderAccount(a);
    const resolved =
      modeNow === 'simulate'
        ? { ok: true as const, provider: d.registry.simulator }
        : d.registry.forAccount(ctx, pa);
    if (!resolved.ok || !resolved.provider.listEvents) continue;
    const cursorRow = await withTenantTx(d.database, ctx, (tx) =>
      db(tx)
        .selectFrom('payments.event_cursors')
        .selectAll()
        .where('account_id', '=', a.id)
        .executeTakeFirst(),
    );
    try {
      const page = await resolved.provider.listEvents(pa, {
        after: cursorRow?.cursor ?? null,
        since: new Date(d.database.clock.now().getTime() - 3 * 86_400_000),
      });
      for (const ev of page.events) {
        if (ev.externalAccountId && ev.externalAccountId !== a.external_account_id) continue;
        const r = await processVerifiedWebhook(
          d,
          system,
          a.id,
          a.provider === 'simulator' || modeNow === 'simulate' ? 'simulator' : a.provider,
          ev,
        );
        if (r.status === 'processed') applied++;
      }
      await withTenantTx(d.database, ctx, (tx) =>
        db(tx)
          .insertInto('payments.event_cursors')
          .values({
            account_id: a.id,
            tenant_id: tx.tenantId,
            cursor: page.cursor,
            last_run_at: tx.now,
            last_error: null,
          })
          .onConflict((oc) =>
            oc.column('account_id').doUpdateSet({
              cursor: page.cursor ?? cursorRow?.cursor ?? null,
              last_run_at: tx.now,
              last_error: null,
            }),
          )
          .execute(),
      );
    } catch (err) {
      await withTenantTx(d.database, ctx, (tx) =>
        db(tx)
          .insertInto('payments.event_cursors')
          .values({
            account_id: a.id,
            tenant_id: tx.tenantId,
            cursor: cursorRow?.cursor ?? null,
            last_run_at: tx.now,
            last_error: err instanceof Error ? err.message : String(err),
          })
          .onConflict((oc) =>
            oc.column('account_id').doUpdateSet({
              last_run_at: tx.now,
              last_error: err instanceof Error ? err.message : String(err),
            }),
          )
          .execute(),
      );
    }
  }
  return { accounts: accounts.length, applied };
}

// ───────────────────────── payments / authorizations ─────────────────────────

async function handlePaymentObject(
  d: PaymentsDeps,
  ctx: RequestContext,
  accountId: string,
  o: Extract<WebhookObject, { kind: 'payment' }>,
): Promise<WebhookOutcome> {
  const related = await withTenantTx(d.database, ctx, async (tx) => {
    const auths = await db(tx)
      .selectFrom('payments.authorizations')
      .select('id')
      .where('account_id', '=', accountId)
      .where('provider_ref', '=', o.providerRef)
      .execute();
    const authIds = auths.map((a) => a.id);
    const ops = await db(tx)
      .selectFrom('payments.provider_operations')
      .select(['id', 'kind', 'status'])
      .where('account_id', '=', accountId)
      .where((eb) =>
        eb.or([
          eb('provider_ref', '=', o.providerRef),
          ...(o.operationId && isUuid(o.operationId) ? [eb('id', '=', o.operationId)] : []),
          ...(authIds.length ? [eb('authorization_id', 'in', authIds)] : []),
        ]),
      )
      .execute();
    const payments = await db(tx)
      .selectFrom('payments.payments')
      .select('id')
      .where('account_id', '=', accountId)
      .where('provider_ref', '=', o.providerRef)
      .execute();
    return { ops, known: ops.length + auths.length + payments.length > 0 };
  });
  const toVerify = related.ops.filter(
    (op) =>
      op.status === 'sent' ||
      op.status === 'pending_verification' ||
      (op.status === 'failed' && op.kind === 'charge' && o.state === 'succeeded') ||
      (op.status === 'failed' &&
        op.kind === 'authorize' &&
        (o.state === 'authorized' || o.state === 'succeeded')),
  );
  let changed = false;
  for (const op of toVerify) {
    const r = await verifyOperation(d, ctx, op.id, { force: true });
    changed = changed || r.changed;
  }
  const snapshot = await withTenantTx(d.database, ctx, (tx) =>
    reconcileAuthorizationSnapshot(tx, accountId, o),
  );
  if (changed || snapshot === 'applied') return 'applied';
  if (!related.known) return 'no_match';
  return snapshot === 'stale' ? 'stale' : 'no_change';
}

/** Compare a provider snapshot of a PaymentIntent with our authorization (monotonic; never re-captures). */
async function reconcileAuthorizationSnapshot(
  tx: TxContext,
  accountId: string,
  o: Extract<WebhookObject, { kind: 'payment' }>,
): Promise<'applied' | 'stale' | 'none'> {
  const a = await db(tx)
    .selectFrom('payments.authorizations')
    .selectAll()
    .where('account_id', '=', accountId)
    .where('provider_ref', '=', o.providerRef)
    .forUpdate()
    .executeTakeFirst();
  if (!a) return 'none';
  const unresolved = await db(tx)
    .selectFrom('payments.provider_operations')
    .select('id')
    .where('authorization_id', '=', a.id)
    .where('status', 'in', ['pending', 'sent', 'pending_verification'])
    .executeTakeFirst();
  if (unresolved) return 'none';
  let implied: AuthorizationStatus | null = null;
  if (o.state === 'authorized') implied = o.amountReceivedMinor > 0 ? 'partially_captured' : 'authorized';
  else if (o.state === 'succeeded') implied = 'captured';
  else if (o.state === 'canceled') implied = o.amountReceivedMinor > 0 ? 'captured' : 'voided';
  else if (o.state === 'failed') implied = 'failed';
  if (!implied) return 'none';
  const verdict = authorizationTransition(a.status, implied);
  if (verdict.kind === 'noop') return 'none';
  if (verdict.kind === 'stale') return 'stale';
  if (verdict.kind === 'mismatch' || o.amountReceivedMinor > a.captured_minor) {
    await raiseException(tx, {
      propertyId: a.property_id,
      kind: o.amountReceivedMinor > a.captured_minor ? 'captured_outside_portico' : 'provider_mismatch',
      severity: 'urgent',
      problem:
        o.amountReceivedMinor > a.captured_minor
          ? `The provider shows ${formatMoney(money(o.amountReceivedMinor, o.currency))} collected on this hold, but Portico recorded ${formatMoney(money(a.captured_minor, o.currency))}. It was collected outside Portico (e.g. in the provider dashboard).`
          : `The provider reports this hold as ${implied}, Portico has ${a.status}.`,
      businessImpact: 'The bill may not show money that was collected, or show a hold that no longer exists.',
      nextStep: 'Check the transaction in the provider dashboard and record or refund the difference.',
      ownerRole: 'finance',
      responsibleParty: 'hotel',
      ref: { type: 'authorization', id: a.id },
      dedupeKey: `auth-snapshot:${a.id}:${implied}:${o.amountReceivedMinor}`,
    });
    return 'none';
  }
  await db(tx)
    .updateTable('payments.authorizations')
    .set({ status: implied, version: a.version + 1 })
    .where('id', '=', a.id)
    .execute();
  await tx.audit({
    action: 'payments.authorization.providerUpdate',
    target: { type: 'authorization', id: a.id },
    propertyId: a.property_id,
    before: { status: a.status },
    after: { status: implied },
    reason: 'Provider webhook',
  });
  if (implied === 'voided') {
    await tx.emit({
      type: PaymentsEvents.authorizationVoided,
      propertyId: a.property_id,
      aggregate: { type: 'authorization', id: a.id },
      payload: { authorizationId: a.id, releasedMinor: a.amount_minor - a.captured_minor, byProvider: true },
    });
  }
  return 'applied';
}

async function handleRefundObject(
  d: PaymentsDeps,
  ctx: RequestContext,
  accountId: string,
  o: Extract<WebhookObject, { kind: 'refund' }>,
): Promise<WebhookOutcome> {
  const ops = await withTenantTx(d.database, ctx, async (tx) =>
    db(tx)
      .selectFrom('payments.provider_operations')
      .select(['id', 'status'])
      .where('account_id', '=', accountId)
      .where('kind', '=', 'refund')
      .where((eb) =>
        eb.or([
          eb('provider_ref', '=', o.providerRef),
          ...(o.operationId && isUuid(o.operationId) ? [eb('id', '=', o.operationId)] : []),
        ]),
      )
      .execute(),
  );
  if (ops.length === 0) return 'no_match';
  let changed = false;
  for (const op of ops) {
    const contradicted =
      (op.status === 'succeeded' && o.state === 'failed') ||
      (op.status === 'failed' && o.state === 'succeeded');
    if (op.status === 'sent' || op.status === 'pending_verification' || contradicted) {
      const r = await verifyOperation(d, ctx, op.id, { force: true });
      changed = changed || r.changed;
    }
  }
  return changed ? 'applied' : 'no_change';
}

// ───────────────────────── disputes ─────────────────────────

const EVIDENCE_CHECKLIST: ReadonlyArray<{ key: string; label: string }> = [
  {
    key: 'agreed_terms',
    label: 'Agreed terms snapshot with cancellation/no-show policy and acceptance proof',
  },
  { key: 'registration_card', label: 'Signed or e-signed registration card' },
  { key: 'authentication', label: '3-D Secure / authentication result of the original transaction' },
  { key: 'folio', label: 'Itemized folio for the stay' },
  { key: 'communications', label: 'Guest communications (confirmation, pre-arrival, receipts)' },
  { key: 'stay_evidence', label: 'Check-in / check-out log (and door-lock log if available)' },
];

async function applyDispute(
  d: PaymentsDeps,
  tx: TxContext,
  accountId: string,
  o: Extract<WebhookObject, { kind: 'dispute' }>,
): Promise<WebhookOutcome> {
  const payment = await db(tx)
    .selectFrom('payments.payments')
    .selectAll()
    .where('account_id', '=', accountId)
    .where('provider_ref', '=', o.paymentProviderRef)
    .where('status', '=', 'succeeded')
    .executeTakeFirst();
  if (!payment) {
    await raiseException(tx, {
      propertyId: null,
      kind: 'dispute_unmatched',
      severity: 'urgent',
      problem: `The provider opened dispute ${o.providerRef} for a payment Portico does not know (${o.paymentProviderRef}).`,
      businessImpact: 'A chargeback may be debited from the hotel without evidence being prepared.',
      nextStep: 'Find the payment in the provider dashboard and prepare evidence before the deadline.',
      ownerRole: 'finance',
      responsibleParty: 'hotel',
      dedupeKey: `dispute-unmatched:${o.providerRef}`,
    });
    return 'no_match';
  }
  const existing = await db(tx)
    .selectFrom('payments.disputes')
    .selectAll()
    .where('account_id', '=', accountId)
    .where('provider_dispute_id', '=', o.providerRef)
    .forUpdate()
    .executeTakeFirst();
  const movements: Array<Record<string, unknown>> =
    (existing?.ledger_movements as Array<Record<string, unknown>>) ?? [];
  let id = existing?.id;
  if (!existing) {
    id = newId(tx.now.getTime());
    await db(tx)
      .insertInto('payments.disputes')
      .values({
        id,
        tenant_id: tx.tenantId,
        property_id: payment.property_id,
        payment_id: payment.id,
        account_id: accountId,
        provider_dispute_id: o.providerRef,
        currency: o.currency,
        amount_minor: o.amountMinor,
        reason: o.reason,
        status: o.state,
        evidence_due_at: o.evidenceDueBy,
        evidence: JSON.stringify(EVIDENCE_CHECKLIST.map((e) => ({ ...e, done: false, note: null }))),
        funds_withdrawn: false,
        ledger_movements: JSON.stringify([]),
        opened_at: tx.now,
        closed_at: null,
      })
      .execute();
    await tx.emit({
      type: PaymentsEvents.disputeOpened,
      propertyId: payment.property_id,
      aggregate: { type: 'dispute', id },
      payload: {
        disputeId: id,
        paymentId: payment.id,
        amountMinor: o.amountMinor,
        currency: o.currency,
        reason: o.reason,
      },
    });
    await raiseException(tx, {
      propertyId: payment.property_id,
      kind: 'dispute_opened',
      severity: 'urgent',
      problem: `The guest's bank disputed a payment of ${formatMoney(money(o.amountMinor, o.currency))}, reason: ${o.reason}.`,
      businessImpact:
        'The amount (and a dispute fee) is debited from the hotel unless evidence wins the case.',
      nextStep: `Collect the evidence checklist${o.evidenceDueBy ? ` before ${o.evidenceDueBy.toISOString()}` : ''} and submit it in the provider dashboard.`,
      ownerRole: 'finance',
      responsibleParty: 'hotel',
      ref: { type: 'dispute', id },
      dedupeKey: `dispute:${id}`,
    });
  } else {
    const verdict = disputeTransition(existing.status, o.state);
    if (verdict.kind === 'apply') {
      const closed = o.state === 'won' || o.state === 'lost' || o.state === 'accepted';
      await db(tx)
        .updateTable('payments.disputes')
        .set({
          status: o.state,
          evidence_due_at: o.evidenceDueBy ?? existing.evidence_due_at,
          closed_at: closed ? tx.now : null,
          version: existing.version + 1,
        })
        .where('id', '=', existing.id)
        .execute();
      await tx.emit({
        type: closed ? PaymentsEvents.disputeClosed : PaymentsEvents.disputeUpdated,
        propertyId: existing.property_id,
        aggregate: { type: 'dispute', id: existing.id },
        payload: { disputeId: existing.id, status: o.state },
      });
      if (closed) await resolveExceptionsByKey(tx, `dispute:${existing.id}`, `Dispute ${o.state}.`);
    } else if (verdict.kind === 'mismatch') {
      return 'stale';
    }
  }
  const disputeId = id as string;
  const has = (k: string) => movements.some((m) => m.kind === k);
  // Ledger implications (finance port): funds withdrawn → debit; won after withdrawal → reversal.
  const wantDebit = o.fundsWithdrawn && !has('debit');
  const wantReversal = o.state === 'won' && has('debit') && !has('reversal');
  for (const kind of [
    ...(wantDebit ? ['debit' as const] : []),
    ...(wantReversal ? ['reversal' as const] : []),
  ]) {
    const clearing = await clearingOf(tx, payment);
    const r = await tryLedger(tx, () =>
      d.ledger.recordDisputeMovement(tx, {
        legalEntityId: payment.legal_entity_id,
        paymentRef: { type: 'payment', id: payment.id },
        disputeRef: { type: 'dispute', id: disputeId },
        amount: { amountMinor: o.amountMinor, currency: o.currency },
        kind,
        clearing,
        idempotencyKey: ledgerKey.dispute(disputeId, kind),
      }),
    );
    if (r.ok) movements.push({ kind, journalEntryId: r.value.journalEntryId, at: tx.now.toISOString() });
    else {
      await raiseException(tx, {
        propertyId: payment.property_id,
        kind: 'ledger_posting_failed',
        severity: 'urgent',
        problem: `The dispute ${kind} could not be posted to the ledger: ${r.error}`,
        businessImpact: 'The books do not reflect the chargeback movement.',
        nextStep: 'Finance posts the dispute movement manually or retries after fixing the cause.',
        ownerRole: 'finance',
        responsibleParty: 'hotel',
        ref: { type: 'dispute', id: disputeId },
        dedupeKey: `ledger:dispute:${disputeId}:${kind}`,
      });
    }
  }
  if (wantDebit || wantReversal) {
    await db(tx)
      .updateTable('payments.disputes')
      .set({
        funds_withdrawn: o.fundsWithdrawn || (existing?.funds_withdrawn ?? false),
        ledger_movements: JSON.stringify(movements),
      })
      .where('id', '=', disputeId)
      .execute();
  }
  return 'applied';
}

// ───────────────────────── payouts ─────────────────────────

async function applyPayoutEvent(
  _d: PaymentsDeps,
  tx: TxContext,
  accountId: string,
  o: Extract<WebhookObject, { kind: 'payout' }>,
): Promise<WebhookOutcome> {
  const account = await loadAccount(tx, accountId);
  const existing = await db(tx)
    .selectFrom('payments.payouts')
    .selectAll()
    .where('account_id', '=', accountId)
    .where('provider_payout_id', '=', o.providerRef)
    .forUpdate()
    .executeTakeFirst();
  if (!existing) {
    const id = newId(tx.now.getTime());
    await db(tx)
      .insertInto('payments.payouts')
      .values({
        id,
        tenant_id: tx.tenantId,
        account_id: accountId,
        legal_entity_id: account.legal_entity_id,
        provider_payout_id: o.providerRef,
        currency: o.currency,
        gross_minor: null,
        fees_minor: null,
        net_minor: o.amountMinor,
        arrival_date: o.arrivalDate,
        status: o.state,
        failure_reason: o.failureCode,
        source: 'webhook',
        ledger_status: 'not_required',
        ledger_ref: null,
        ledger_error: null,
      })
      .execute();
    await payoutFollowUp(tx, id, account.legal_entity_id, o.state, o.failureCode, false);
    return 'applied';
  }
  const rank = { in_transit: 0, paid: 1, failed: 2 } as const;
  if (existing.status === o.state || rank[o.state] < rank[existing.status]) return 'stale';
  await db(tx)
    .updateTable('payments.payouts')
    .set({
      status: o.state,
      failure_reason: o.failureCode,
      arrival_date: o.arrivalDate ?? existing.arrival_date,
      version: existing.version + 1,
    })
    .where('id', '=', existing.id)
    .execute();
  await payoutFollowUp(
    tx,
    existing.id,
    existing.legal_entity_id,
    o.state,
    o.failureCode,
    existing.ledger_status === 'posted',
  );
  return 'applied';
}

/** Events + exceptions for payout status changes. Breakdown-less payouts are flagged (never guessed). */
export async function payoutFollowUp(
  tx: TxContext,
  payoutId: string,
  _legalEntityId: string,
  state: 'in_transit' | 'paid' | 'failed',
  failureCode: string | null,
  ledgerPosted: boolean,
): Promise<void> {
  const p = await db(tx)
    .selectFrom('payments.payouts')
    .selectAll()
    .where('id', '=', payoutId)
    .executeTakeFirstOrThrow();
  if (state === 'failed') {
    await tx.emit({
      type: PaymentsEvents.payoutFailed,
      aggregate: { type: 'payout', id: payoutId },
      payload: { payoutId, failureCode, netMinor: p.net_minor, currency: p.currency },
    });
    await raiseException(tx, {
      propertyId: null,
      kind: 'payout_failed',
      severity: 'urgent',
      problem: `Payout ${p.provider_payout_id} of ${formatMoney(money(p.net_minor, p.currency))} to the hotel's bank failed${failureCode ? ` (${failureCode})` : ''}.${ledgerPosted ? ' It had already been recorded as paid in the ledger.' : ''}`,
      businessImpact: 'The money stays at the provider and has not reached the hotel bank account.',
      nextStep: ledgerPosted
        ? 'Check the bank details with the provider; finance reverses the payout entry in the ledger.'
        : 'Check the bank details with the provider; the provider retries the payout once fixed.',
      ownerRole: 'finance',
      responsibleParty: 'hotel',
      ref: { type: 'payout', id: payoutId },
      dedupeKey: `payout-failed:${payoutId}`,
    });
  }
  if (state === 'paid') {
    await tx.emit({
      type: PaymentsEvents.payoutPaid,
      aggregate: { type: 'payout', id: payoutId },
      payload: { payoutId, netMinor: p.net_minor, currency: p.currency },
    });
    if (p.gross_minor === null || p.fees_minor === null) {
      await raiseException(tx, {
        propertyId: null,
        kind: 'payout_breakdown_missing',
        severity: 'routine',
        problem: `Payout ${p.provider_payout_id} (net ${formatMoney(money(p.net_minor, p.currency))}) arrived without its gross/fees breakdown.`,
        businessImpact:
          'The payout cannot be reconciled to payments and fees, so it is not yet in the ledger.',
        nextStep:
          'Import the provider payout report or record the payout with gross, fees and included payments.',
        ownerRole: 'finance',
        responsibleParty: 'hotel',
        ref: { type: 'payout', id: payoutId },
        dedupeKey: `payout-breakdown:${payoutId}`,
      });
    }
  }
}

// ───────────────────────── payment links ─────────────────────────

async function applyLinkEvent(
  d: PaymentsDeps,
  tx: TxContext,
  accountId: string,
  o: Extract<WebhookObject, { kind: 'payment_link' }>,
): Promise<WebhookOutcome> {
  const target = await db(tx)
    .selectFrom('payments.payment_requests')
    .select(['ref_type', 'ref_id'])
    .where('account_id', '=', accountId)
    .where('provider_link_ref', '=', o.providerRef)
    .executeTakeFirst();
  if (!target) return 'no_match';
  // SW-PAY-1: the same per-reference collection lock as desk charges, holds and captures (taken before the row lock,
  // in the same order as every other path).
  await lockCollectionRefs(d, tx, [{ type: target.ref_type, id: target.ref_id }]);
  const r = await db(tx)
    .selectFrom('payments.payment_requests')
    .selectAll()
    .where('account_id', '=', accountId)
    .where('provider_link_ref', '=', o.providerRef)
    .forUpdate()
    .executeTakeFirst();
  if (!r) return 'no_match';
  if (o.state === 'expired') {
    // The provider expired the link itself: it takes no more payments.
    if (r.link_status === 'deactivating' || r.link_status === 'created' || r.link_status === 'unknown') {
      await db(tx)
        .updateTable('payments.payment_requests')
        .set({ link_status: 'deactivated', link_status_at: tx.now })
        .where('id', '=', r.id)
        .execute();
    }
    if (r.status !== 'open') return 'stale';
    await db(tx)
      .updateTable('payments.payment_requests')
      .set({ status: 'expired', version: r.version + 1 })
      .where('id', '=', r.id)
      .execute();
    await tx.emit({
      type: PaymentsEvents.requestExpired,
      propertyId: r.property_id,
      aggregate: { type: 'payment_request', id: r.id },
      payload: { paymentRequestId: r.id },
    });
    return 'applied';
  }
  const businessKey = `link:${o.providerRef}:${o.paymentProviderRef ?? 'unknown'}`;
  const existing = await db(tx)
    .selectFrom('payments.payments')
    .select('id')
    .where('business_key', '=', businessKey)
    .executeTakeFirst();
  if (existing) return 'no_change';
  if (o.currency !== r.currency) {
    await raiseException(tx, {
      propertyId: r.property_id,
      kind: 'payment_link_currency_mismatch',
      severity: 'urgent',
      problem: `A payment link was paid in ${o.currency} but requested in ${r.currency}.`,
      businessImpact: 'The payment cannot be applied to the bill automatically.',
      nextStep: 'Check the payment in the provider dashboard and apply it manually or refund it.',
      ownerRole: 'finance',
      responsibleParty: 'hotel',
      ref: { type: 'payment_request', id: r.id },
      dedupeKey: `link-currency:${businessKey}`,
    });
    return 'applied';
  }
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('payments.payments')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: r.property_id,
      legal_entity_id: r.legal_entity_id,
      account_id: r.account_id,
      method_id: null,
      authorization_id: null,
      payment_request_id: r.id,
      virtual_card_id: null,
      kind: 'link',
      method: 'payment_link',
      initiator: 'customer',
      ref_type: r.ref_type,
      ref_id: r.ref_id,
      business_key: businessKey,
      currency: o.currency,
      amount_minor: o.amountMinor,
      status: 'succeeded',
      mode: r.mode,
      provider_ref: o.paymentProviderRef,
      external_reference: o.providerRef,
      terminal_id: null,
      card_brand: null,
      card_last4: null,
      received_at: tx.now,
      decline: null,
      ledger_status: 'pending',
      ledger_posting_id: null,
      ledger_error: null,
      payout_id: null,
      note: null,
      created_by: 'system:payments-webhook',
      created_at: tx.now,
    })
    .execute();
  // Review R2-P1-2: credit the request before finance posts (its balance sync then sees this payment on the link);
  // R4-P2-1: then state any over-collection from the posted balance, and release a replacement that waited for this
  // payment ("already paid" at the provider).
  const credited = await creditPaymentRequest(tx, r.id, o.amountMinor);
  await postPaymentLedger(d, tx, id);
  await raiseIfOvercollected(d, tx, credited.before, credited.paid, o.amountMinor, id);
  if (credited.before.link_status === 'completed') {
    const ctx = requestContextOf(tx);
    tx.afterCommit(() => releaseWaitingLinks(d, ctx, { type: r.ref_type, id: r.ref_id }));
  }
  await tx.emit({
    type: PaymentsEvents.paymentSucceeded,
    propertyId: r.property_id,
    aggregate: { type: 'payment', id },
    payload: {
      paymentId: id,
      ref: { type: r.ref_type, id: r.ref_id },
      amountMinor: o.amountMinor,
      currency: o.currency,
      method: 'payment_link',
      mode: r.mode,
      paymentRequestId: r.id,
    },
  });
  return 'applied';
}

// ───────────────────────── account status ─────────────────────────

async function applyAccountEvent(
  tx: TxContext,
  accountId: string,
  o: Extract<WebhookObject, { kind: 'account' }>,
  createdAt: Date,
): Promise<WebhookOutcome> {
  const a = await loadAccount(tx, accountId, true);
  // P2-10: an older account snapshot never overrides a newer one.
  if (a.provider_status_at && createdAt.getTime() < new Date(a.provider_status_at).getTime()) return 'stale';
  const status = o.chargesEnabled ? 'active' : a.onboarding_status === 'complete' ? 'restricted' : 'pending';
  const reason = o.chargesEnabled
    ? null
    : (o.disabledReason ?? 'The provider has not enabled card payments.');
  if (status === a.status && reason === a.status_reason) return 'no_change';
  await db(tx)
    .updateTable('payments.accounts')
    .set({
      status,
      status_reason: reason,
      provider_status_at: createdAt,
      onboarding_status: o.chargesEnabled ? 'complete' : a.onboarding_status,
      version: a.version + 1,
    })
    .where('id', '=', a.id)
    .execute();
  await tx.audit({
    action: 'payments.account.providerUpdate',
    target: { type: 'payment_account', id: a.id },
    before: { status: a.status, reason: a.status_reason },
    after: { status, reason },
  });
  await tx.emit({
    type: PaymentsEvents.accountStatusChanged,
    aggregate: { type: 'payment_account', id: a.id },
    payload: { accountId: a.id, from: a.status, to: status, reason },
  });
  return 'applied';
}
