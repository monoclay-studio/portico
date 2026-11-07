/**
 * Provider-operation journal and executor (ADR-0007).
 *
 *   1. intent   — inside the business transaction: the operation row (amount, idempotency key) is inserted
 *                 together with the payment/authorization/refund it acts on, and `operation.requested` is emitted.
 *   2. claim    — its own transaction: `pending → sent` (only one executor can win), attempt journaled. COMMITTED
 *                 BEFORE the provider call.
 *   3. call     — outside any transaction, with the persisted idempotency key.
 *   4. outcome  — its own transaction: monotonic state change, ledger posting (only on provider-confirmed
 *                 success), events.
 *
 * Portico sends each operation to the provider AT MOST ONCE. An unknown outcome (timeout, network error, 5xx)
 * becomes `pending_verification` and is resolved ONLY by provider lookup or webhook — never by re-sending and
 * never by guessing. A lookup that finds nothing is conclusive only after a grace period.
 */
import { type Selectable, type TxContext, withTenantTx } from '@portico/db';
import {
  DomainError,
  localDateIn,
  type Money,
  money,
  NotFoundError,
  newId,
  type RequestContext,
} from '@portico/kernel';
import {
  type BreakerState,
  decideAttempt,
  INITIAL_BREAKER,
  recordFailure,
  recordSuccess,
} from '../domain/circuit-breaker';
import { explainDecline } from '../domain/declines';
import {
  ESCALATE_PENDING_AFTER_MS,
  NOT_FOUND_GRACE_MS,
  nextVerificationAt,
  STALE_SENT_MS,
  vccRetryDecision,
} from '../domain/schedule';
import {
  type AuthorizationStatus,
  authorizationTransition,
  type PaymentStatus,
  paymentRequestStatusFor,
  paymentTransition,
  refundTransition,
  statusAfterCapture,
} from '../domain/states';
import { PaymentsEvents } from '../events';
import {
  applicationFeeMinor,
  type LookupResult,
  type OperationKind,
  type PaymentProvider,
  type ProviderAccount,
  type ProviderOutcome,
} from '../providers/provider';
import type { ProviderOperationsTable } from '../tables';
import { postPaymentLedger, postRefundLedger } from './ledger';
import {
  type AccountRow,
  db,
  type PaymentsDeps,
  ProviderUnavailableError,
  raiseException,
  resolveExceptionsByKey,
  toProviderAccount,
} from './shared';

/** An intent never sent within this window is expired instead of sent late (queued actions are re-validated). */
export const MAX_PENDING_AGE_MS = 15 * 60_000;

type OpRow = Selectable<ProviderOperationsTable>;

// ───────────────────────── circuit breaker persistence ─────────────────────────

async function loadBreaker(tx: TxContext, accountId: string): Promise<BreakerState> {
  const row = await db(tx)
    .selectFrom('payments.account_health')
    .selectAll()
    .where('account_id', '=', accountId)
    .executeTakeFirst();
  if (!row) return INITIAL_BREAKER;
  return {
    state: row.state,
    consecutiveFailures: row.consecutive_failures,
    openedAt: row.opened_at,
    probeAfter: row.probe_after,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    lastError: row.last_error,
  };
}

export { loadBreaker };

async function saveBreaker(tx: TxContext, account: AccountRow, s: BreakerState): Promise<void> {
  const values = {
    state: s.state,
    consecutive_failures: s.consecutiveFailures,
    opened_at: s.openedAt,
    probe_after: s.probeAfter,
    last_success_at: s.lastSuccessAt,
    last_failure_at: s.lastFailureAt,
    last_error: s.lastError,
    updated_at: tx.now,
  };
  await db(tx)
    .insertInto('payments.account_health')
    .values({ account_id: account.id, tenant_id: tx.tenantId, ...values })
    .onConflict((oc) => oc.column('account_id').doUpdateSet(values))
    .execute();
}

/** Refuse new provider work while the account's breaker is open (nothing is created, alternatives listed). */
export async function assertBreakerAllows(
  d: PaymentsDeps,
  tx: TxContext,
  account: AccountRow,
): Promise<void> {
  const s = await loadBreaker(tx, account.id);
  const decision = decideAttempt(s, tx.now, d.breaker);
  if (!decision.allowed) throw new ProviderUnavailableError(account.id, decision.retryAfter);
}

async function updateBreaker(tx: TxContext, account: AccountRow, outcome: ProviderOutcome): Promise<void> {
  if (
    outcome.kind === 'failed' &&
    (outcome.code === 'provider_not_configured' || outcome.code === 'expired_before_sending')
  ) {
    return;
  }
  const before = await loadBreaker(tx, account.id);
  const failure = outcome.kind === 'unavailable' || outcome.kind === 'unknown';
  const after = failure ? recordFailure(before, tx.now, outcome.reason) : recordSuccess(before, tx.now);
  await saveBreaker(tx, account, after);
  if (before.state === 'closed' && after.state === 'open') {
    await tx.emit({
      type: PaymentsEvents.providerDegraded,
      aggregate: { type: 'payment_account', id: account.id },
      payload: {
        accountId: account.id,
        error: after.lastError,
        probeAfter: after.probeAfter?.toISOString() ?? null,
      },
    });
    await raiseException(tx, {
      propertyId: null,
      kind: 'provider_unavailable',
      severity: 'urgent',
      problem: `The payment provider for "${account.display_name}" is not responding (${after.lastError ?? 'unknown error'}).`,
      businessImpact:
        'Card payments, refunds and payment links through this account are paused. Nothing is being charged.',
      nextStep:
        'Accept cash, send payment links to be paid later, or use the hotel’s own terminal and record payments. Portico probes the provider and resumes automatically.',
      ownerRole: 'front_office_manager',
      responsibleParty: 'provider',
      ref: { type: 'payment_account', id: account.id },
      dedupeKey: `provider-down:${account.id}:${(after.openedAt ?? tx.now).toISOString()}`,
    });
  }
  if (before.state !== 'closed' && after.state === 'closed') {
    await tx.emit({
      type: PaymentsEvents.providerRestored,
      aggregate: { type: 'payment_account', id: account.id },
      payload: { accountId: account.id },
    });
    if (before.openedAt) {
      await resolveExceptionsByKey(
        tx,
        `provider-down:${account.id}:${before.openedAt.toISOString()}`,
        'The provider answered again; card payments resumed.',
      );
    }
  }
}

// ───────────────────────── intent ─────────────────────────

export interface OperationIntent {
  propertyId: string;
  account: AccountRow;
  kind: OperationKind;
  targetType: 'authorization' | 'payment' | 'refund';
  targetId: string;
  authorizationId?: string | null;
  amount: Money;
  mode: 'live' | 'sandbox' | 'simulate';
}

export async function createOperation(tx: TxContext, input: OperationIntent): Promise<string> {
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('payments.provider_operations')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      account_id: input.account.id,
      kind: input.kind,
      target_type: input.targetType,
      target_id: input.targetId,
      authorization_id: input.authorizationId ?? null,
      currency: input.amount.currency,
      amount_minor: input.amount.amountMinor,
      // Deterministic from the operation's identity and persisted BEFORE any call: every retry reuses it.
      idempotency_key: `portico-${input.kind}-${id}`,
      mode: input.mode,
      status: 'pending',
      provider_ref: null,
      outcome: null,
      failure_code: null,
      failure_message: null,
      sent_at: null,
      completed_at: null,
      next_check_at: null,
      created_at: tx.now,
    })
    .execute();
  await tx.emit({
    type: PaymentsEvents.operationRequested,
    propertyId: input.propertyId,
    aggregate: { type: 'provider_operation', id },
    payload: { operationId: id, kind: input.kind, accountId: input.account.id },
  });
  return id;
}

async function journal(
  tx: TxContext,
  op: { id: string; attempts: number },
  phase: 'intent' | 'outcome' | 'lookup' | 'webhook' | 'short_circuit',
  status: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await db(tx)
    .insertInto('payments.operation_journal')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      operation_id: op.id,
      attempt: op.attempts,
      phase,
      status,
      detail: JSON.stringify(detail),
      recorded_at: tx.now,
    })
    .execute();
}

// ───────────────────────── claim + call ─────────────────────────

interface CallDetails {
  methodToken?: string;
  customerRef?: string | null;
  initiator?: 'customer' | 'merchant';
  networkTransactionId?: string | null;
  parentProviderRef?: string | null;
  newTotalMinor?: number;
  reason?: string;
}

async function loadCallDetails(tx: TxContext, op: OpRow): Promise<CallDetails> {
  const details: CallDetails = {};
  const methodFor = async (methodId: string | null) => {
    if (!methodId) return;
    const m = await db(tx)
      .selectFrom('payments.payment_methods')
      .selectAll()
      .where('id', '=', methodId)
      .executeTakeFirst();
    if (!m) return;
    details.methodToken = m.provider_token;
    details.customerRef = m.provider_customer_ref;
    const mandate = (m.mandate ?? {}) as { networkTransactionId?: string };
    details.networkTransactionId = mandate.networkTransactionId ?? null;
  };
  if (op.kind === 'authorize') {
    const a = await db(tx)
      .selectFrom('payments.authorizations')
      .selectAll()
      .where('id', '=', op.target_id)
      .executeTakeFirstOrThrow();
    details.initiator = a.initiator;
    await methodFor(a.method_id);
  } else if (op.kind === 'charge') {
    const p = await db(tx)
      .selectFrom('payments.payments')
      .selectAll()
      .where('id', '=', op.target_id)
      .executeTakeFirstOrThrow();
    details.initiator = p.initiator ?? 'customer';
    await methodFor(p.method_id);
  } else if (op.kind === 'refund') {
    const r = await db(tx)
      .selectFrom('payments.refunds')
      .selectAll()
      .where('id', '=', op.target_id)
      .executeTakeFirstOrThrow();
    const p = await db(tx)
      .selectFrom('payments.payments')
      .select(['provider_ref'])
      .where('id', '=', r.payment_id)
      .executeTakeFirstOrThrow();
    details.parentProviderRef = p.provider_ref;
    details.reason = r.reason;
  } else if (op.authorization_id) {
    const a = await db(tx)
      .selectFrom('payments.authorizations')
      .selectAll()
      .where('id', '=', op.authorization_id)
      .executeTakeFirstOrThrow();
    details.parentProviderRef = a.provider_ref;
    details.newTotalMinor = a.amount_minor + op.amount_minor;
  }
  return details;
}

interface Claimed {
  op: OpRow;
  account: AccountRow;
  details: CallDetails;
}

async function claim(d: PaymentsDeps, tx: TxContext, operationId: string): Promise<Claimed | null> {
  const op = (await db(tx)
    .selectFrom('payments.provider_operations')
    .selectAll()
    .where('id', '=', operationId)
    .forUpdate()
    .executeTakeFirst()) as OpRow | undefined;
  if (op?.status !== 'pending') return null;
  const account = await db(tx)
    .selectFrom('payments.accounts')
    .selectAll()
    .where('id', '=', op.account_id)
    .executeTakeFirstOrThrow();
  const fail = async (code: string, message: string) => {
    await journal(tx, op, 'short_circuit', 'failed', { code, message });
    await applyOutcome(d, tx, op.id, { kind: 'failed', code, message }, 'call');
    return null;
  };
  if (tx.now.getTime() - new Date(op.created_at).getTime() > MAX_PENDING_AGE_MS) {
    return fail(
      'expired_before_sending',
      'The request was not sent in time and was cancelled; nothing was charged.',
    );
  }
  if (account.status === 'restricted' || account.status === 'disabled') {
    return fail('account_restricted', `The payment account is ${account.status}; nothing was sent.`);
  }
  const breaker = await loadBreaker(tx, account.id);
  const decision = decideAttempt(breaker, tx.now, d.breaker);
  if (!decision.allowed)
    return fail('provider_unavailable', 'The provider is unavailable (circuit open); nothing was sent.');
  if (decision.probe) await saveBreaker(tx, account, decision.next);
  const details = await loadCallDetails(tx, op);
  if ((op.kind === 'authorize' || op.kind === 'charge') && !details.methodToken) {
    return fail('invalid_request', 'The payment method is missing; nothing was sent.');
  }
  if (op.kind !== 'authorize' && op.kind !== 'charge' && !details.parentProviderRef) {
    return fail(
      'invalid_request',
      'The provider reference of the original transaction is unknown; nothing was sent.',
    );
  }
  await db(tx)
    .updateTable('payments.provider_operations')
    .set({
      status: 'sent',
      attempts: op.attempts + 1,
      sent_at: tx.now,
      next_check_at: new Date(tx.now.getTime() + STALE_SENT_MS),
      version: op.version + 1,
    })
    .where('id', '=', op.id)
    .execute();
  const claimed = { ...op, attempts: op.attempts + 1, status: 'sent' as const, sent_at: tx.now };
  await journal(tx, claimed, 'intent', 'sent', {
    kind: op.kind,
    amountMinor: op.amount_minor,
    currency: op.currency,
    idempotencyKey: op.idempotency_key,
    mode: op.mode,
  });
  return { op: claimed, account, details };
}

async function send(
  provider: PaymentProvider,
  account: ProviderAccount,
  c: Claimed,
): Promise<ProviderOutcome> {
  const { op, details } = c;
  const amount = money(op.amount_minor, op.currency);
  const base = { operationId: op.id, idempotencyKey: op.idempotency_key };
  const fee = applicationFeeMinor(op.amount_minor, account.applicationFeeBps);
  switch (op.kind) {
    case 'authorize':
    case 'charge': {
      const call = {
        ...base,
        amount,
        methodToken: details.methodToken as string,
        customerRef: details.customerRef ?? null,
        initiator: details.initiator ?? 'customer',
        networkTransactionId: details.networkTransactionId ?? null,
        description: null,
      };
      return op.kind === 'authorize'
        ? provider.authorize(account, call)
        : provider.charge(account, { ...call, applicationFeeMinor: fee });
    }
    case 'increment':
      return provider.incrementAuthorization(account, {
        ...base,
        providerRef: details.parentProviderRef as string,
        newTotal: money(details.newTotalMinor ?? op.amount_minor, op.currency),
      });
    case 'capture':
      return provider.capture(account, {
        ...base,
        providerRef: details.parentProviderRef as string,
        amount,
        applicationFeeMinor: fee,
      });
    case 'void':
      return provider.void(account, { ...base, providerRef: details.parentProviderRef as string });
    case 'refund':
      return provider.refund(account, {
        ...base,
        paymentProviderRef: details.parentProviderRef as string,
        amount,
        reason: details.reason ?? 'requested_by_customer',
      });
  }
}

const NEVER_SENT_CODES = new Set([
  'effect_blocked_in_environment',
  'recorded_only_account',
  'simulator_in_live',
  'stripe_key_mode_mismatch',
  'stripe_account_missing',
]);

/**
 * Execute an operation whose intent is committed. Safe to call concurrently and repeatedly: only the caller
 * that claims `pending → sent` talks to the provider.
 */
export async function executeOperation(
  d: PaymentsDeps,
  ctx: RequestContext,
  operationId: string,
): Promise<void> {
  const claimed = await withTenantTx(d.database, ctx, (tx) => claim(d, tx, operationId));
  if (!claimed) return;
  const account = toProviderAccount(claimed.account);
  let outcome: ProviderOutcome;
  try {
    const resolved = d.registry.forAccount(ctx, account);
    outcome = resolved.ok
      ? await send(resolved.provider, account, claimed)
      : {
          kind: 'failed',
          code: 'provider_not_configured',
          message: 'No provider credentials are configured for this environment; nothing was sent.',
        };
  } catch (err) {
    outcome =
      err instanceof DomainError && NEVER_SENT_CODES.has(err.code)
        ? { kind: 'failed', code: err.code, message: err.message }
        : {
            kind: 'unknown',
            reason: `Unexpected adapter error: ${err instanceof Error ? err.message : String(err)}`,
          };
  }
  await withTenantTx(d.database, ctx, async (tx) => {
    await applyOutcome(d, tx, operationId, outcome, 'call');
    await updateBreaker(tx, claimed.account, outcome);
  });
}

// ───────────────────────── outcome application ─────────────────────────

type Source = 'call' | 'lookup' | 'webhook';

function failureOf(outcome: ProviderOutcome): { code: string; message: string } | null {
  if (outcome.kind === 'declined')
    return { code: outcome.decline.code, message: explainDecline(outcome.decline.code).message };
  if (outcome.kind === 'failed') return { code: outcome.code, message: outcome.message };
  if (outcome.kind === 'unavailable') return { code: 'provider_unavailable', message: outcome.reason };
  return null;
}

/**
 * Apply a provider outcome to an operation and its target. Monotonic and idempotent: duplicates are no-ops,
 * late older states are ignored, contradictions raise exceptions (and a provider-confirmed collection is never
 * hidden). Returns whether anything changed.
 */
export async function applyOutcome(
  d: PaymentsDeps,
  tx: TxContext,
  operationId: string,
  outcome: ProviderOutcome,
  source: Source,
): Promise<boolean> {
  const op = (await db(tx)
    .selectFrom('payments.provider_operations')
    .selectAll()
    .where('id', '=', operationId)
    .forUpdate()
    .executeTakeFirst()) as OpRow | undefined;
  if (!op) throw new NotFoundError('provider_operation', operationId);
  const next =
    outcome.kind === 'succeeded'
      ? 'succeeded'
      : outcome.kind === 'unknown'
        ? 'pending_verification'
        : 'failed';
  const isFinal = op.status === 'succeeded' || op.status === 'failed';

  if (next === 'pending_verification') {
    if (isFinal) {
      await journal(tx, op, source === 'call' ? 'outcome' : source, 'ignored_unknown_after_final', {
        outcome,
      });
      return false;
    }
    const checkCount = source === 'lookup' ? op.check_count + 1 : op.check_count;
    await db(tx)
      .updateTable('payments.provider_operations')
      .set({
        status: 'pending_verification',
        check_count: checkCount,
        next_check_at: nextVerificationAt(checkCount, tx.now),
        outcome: JSON.stringify(outcome),
        version: op.version + 1,
      })
      .where('id', '=', op.id)
      .execute();
    await journal(tx, op, source === 'call' ? 'outcome' : source, 'pending_verification', { outcome });
    if (op.status !== 'pending_verification') {
      await markTargetPending(tx, op);
      await tx.emit({
        type: PaymentsEvents.operationPendingVerification,
        propertyId: op.property_id,
        aggregate: { type: 'provider_operation', id: op.id },
        payload: { operationId: op.id, kind: op.kind, accountId: op.account_id },
      });
    }
    return op.status !== 'pending_verification';
  }

  if (isFinal && op.status === next) {
    await journal(tx, op, source === 'call' ? 'outcome' : source, 'duplicate', { outcome });
    return false;
  }
  const contradiction = isFinal; // final and different
  const failure = failureOf(outcome);
  await db(tx)
    .updateTable('payments.provider_operations')
    .set({
      status: next,
      provider_ref:
        (outcome.kind === 'succeeded' || outcome.kind === 'declined' ? outcome.providerRef : undefined) ??
        op.provider_ref,
      outcome: JSON.stringify(outcome),
      failure_code: failure?.code ?? null,
      failure_message: failure?.message ?? null,
      completed_at: tx.now,
      next_check_at: null,
      version: op.version + 1,
    })
    .where('id', '=', op.id)
    .execute();
  await journal(
    tx,
    op,
    source === 'call' ? 'outcome' : source,
    contradiction ? `contradiction:${next}` : next,
    { outcome },
  );
  await resolveExceptionsByKey(tx, `pending:${op.id}`, `Resolved by ${source}: ${next}.`);

  switch (op.kind) {
    case 'authorize':
      await applyAuthorize(d, tx, op, outcome, contradiction);
      break;
    case 'increment':
      await applyIncrement(tx, op, outcome, contradiction);
      break;
    case 'void':
      await applyVoid(tx, op, outcome, contradiction);
      break;
    case 'capture':
    case 'charge':
      await applyPayment(d, tx, op, outcome, contradiction);
      break;
    case 'refund':
      await applyRefund(d, tx, op, outcome, contradiction);
      break;
  }
  return true;
}

async function markTargetPending(tx: TxContext, op: OpRow): Promise<void> {
  if (op.target_type === 'authorization' && op.kind === 'authorize') {
    await db(tx)
      .updateTable('payments.authorizations')
      .set({ status: 'pending_verification', version: (eb) => eb('version', '+', 1) })
      .where('id', '=', op.target_id)
      .where('status', '=', 'processing')
      .execute();
  } else if (op.target_type === 'payment') {
    const updated = await db(tx)
      .updateTable('payments.payments')
      .set({ status: 'pending_verification', version: (eb) => eb('version', '+', 1) })
      .where('id', '=', op.target_id)
      .where('status', '=', 'processing')
      .returning(['id', 'amount_minor', 'currency'])
      .executeTakeFirst();
    if (updated) {
      await tx.emit({
        type: PaymentsEvents.paymentPendingVerification,
        propertyId: op.property_id,
        aggregate: { type: 'payment', id: op.target_id },
        payload: { paymentId: op.target_id, amountMinor: updated.amount_minor, currency: updated.currency },
      });
    }
  } else if (op.target_type === 'refund') {
    const updated = await db(tx)
      .updateTable('payments.refunds')
      .set({ status: 'pending_verification', version: (eb) => eb('version', '+', 1) })
      .where('id', '=', op.target_id)
      .where('status', '=', 'processing')
      .returning(['id'])
      .executeTakeFirst();
    if (updated) {
      await tx.emit({
        type: PaymentsEvents.refundPendingVerification,
        propertyId: op.property_id,
        aggregate: { type: 'refund', id: op.target_id },
        payload: { refundId: op.target_id },
      });
    }
  }
}

async function contradictionException(tx: TxContext, op: OpRow, outcome: ProviderOutcome, detail: string) {
  await raiseException(tx, {
    propertyId: op.property_id,
    kind: 'provider_mismatch',
    severity: 'urgent',
    problem: `The provider now reports a different final outcome for a ${op.kind} than Portico recorded: ${detail}`,
    businessImpact: 'The guest may have been charged twice or not at all; balances may be wrong.',
    nextStep:
      'Check the transaction in the provider dashboard, then refund a duplicate or collect what is missing.',
    ownerRole: 'finance',
    responsibleParty: 'hotel',
    ref: { type: op.target_type, id: op.target_id },
    dedupeKey: `mismatch:${op.id}:${outcome.kind}`,
  });
}

async function applyAuthorize(
  d: PaymentsDeps,
  tx: TxContext,
  op: OpRow,
  outcome: ProviderOutcome,
  contradiction: boolean,
) {
  const a = await db(tx)
    .selectFrom('payments.authorizations')
    .selectAll()
    .where('id', '=', op.target_id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (outcome.kind === 'succeeded') {
    const verdict = authorizationTransition(a.status, 'authorized');
    if (verdict.kind !== 'apply' && !contradiction) return;
    if (contradiction) {
      await contradictionException(tx, op, outcome, 'a hold recorded as declined exists at the provider.');
    }
    const validity = await d.platform.resolvePolicy(
      tx,
      a.property_id,
      'payments.authorization.validityDays',
      7,
    );
    const amount =
      outcome.amountMinor > 0 && outcome.amountMinor < a.amount_minor ? outcome.amountMinor : a.amount_minor;
    await db(tx)
      .updateTable('payments.authorizations')
      .set({
        status: 'authorized',
        provider_ref: outcome.providerRef,
        amount_minor: amount, // a partial approval is recorded as partial, never rounded up
        expires_at: outcome.expiresAt ?? new Date(tx.now.getTime() + Number(validity.value) * 86_400_000),
        decline: null,
        version: a.version + 1,
      })
      .where('id', '=', a.id)
      .execute();
    if (outcome.networkTransactionId && a.method_id) {
      // Keep the scheme reference of this customer-initiated transaction for later merchant-initiated charges.
      const m = await db(tx)
        .selectFrom('payments.payment_methods')
        .select(['mandate'])
        .where('id', '=', a.method_id)
        .executeTakeFirst();
      const mandate = (m?.mandate ?? {}) as Record<string, unknown>;
      if (m && !mandate.networkTransactionId) {
        await db(tx)
          .updateTable('payments.payment_methods')
          .set({
            mandate: JSON.stringify({ ...mandate, networkTransactionId: outcome.networkTransactionId }),
          })
          .where('id', '=', a.method_id)
          .execute();
      }
    }
    await tx.emit({
      type: PaymentsEvents.authorizationAuthorized,
      propertyId: a.property_id,
      aggregate: { type: 'authorization', id: a.id },
      payload: {
        authorizationId: a.id,
        ref: { type: a.ref_type, id: a.ref_id },
        amountMinor: amount,
        currency: a.currency,
      },
    });
    return;
  }
  if (contradiction) {
    await contradictionException(
      tx,
      op,
      outcome,
      'an authorization recorded as active is reported as declined.',
    );
    return;
  }
  const verdict = authorizationTransition(a.status, 'failed');
  if (verdict.kind !== 'apply') return;
  await db(tx)
    .updateTable('payments.authorizations')
    .set({ status: 'failed', decline: JSON.stringify(failureOf(outcome)), version: a.version + 1 })
    .where('id', '=', a.id)
    .execute();
  await tx.emit({
    type: PaymentsEvents.authorizationFailed,
    propertyId: a.property_id,
    aggregate: { type: 'authorization', id: a.id },
    payload: { authorizationId: a.id, code: failureOf(outcome)?.code ?? 'unknown' },
  });
}

async function applyIncrement(tx: TxContext, op: OpRow, outcome: ProviderOutcome, contradiction: boolean) {
  if (contradiction) {
    await contradictionException(tx, op, outcome, 'an increment changed outcome.');
    return;
  }
  if (outcome.kind !== 'succeeded' || !op.authorization_id) return;
  const a = await db(tx)
    .selectFrom('payments.authorizations')
    .selectAll()
    .where('id', '=', op.authorization_id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const newTotal = Math.max(a.amount_minor, outcome.amountMinor);
  await db(tx)
    .updateTable('payments.authorizations')
    .set({ amount_minor: newTotal, expires_at: outcome.expiresAt ?? a.expires_at, version: a.version + 1 })
    .where('id', '=', a.id)
    .execute();
  await tx.audit({
    action: 'payments.authorization.incremented',
    target: { type: 'authorization', id: a.id },
    propertyId: a.property_id,
    before: { amountMinor: a.amount_minor },
    after: { amountMinor: newTotal },
  });
}

async function applyVoid(tx: TxContext, op: OpRow, outcome: ProviderOutcome, contradiction: boolean) {
  if (contradiction) {
    await contradictionException(tx, op, outcome, 'a release changed outcome.');
    return;
  }
  if (outcome.kind !== 'succeeded' || !op.authorization_id) return;
  const a = await db(tx)
    .selectFrom('payments.authorizations')
    .selectAll()
    .where('id', '=', op.authorization_id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const to: AuthorizationStatus = a.captured_minor > 0 ? 'captured' : 'voided';
  if (authorizationTransition(a.status, to).kind !== 'apply') return;
  await db(tx)
    .updateTable('payments.authorizations')
    .set({ status: to, version: a.version + 1 })
    .where('id', '=', a.id)
    .execute();
  await tx.emit({
    type: PaymentsEvents.authorizationVoided,
    propertyId: a.property_id,
    aggregate: { type: 'authorization', id: a.id },
    payload: { authorizationId: a.id, releasedMinor: a.amount_minor - a.captured_minor },
  });
}

async function applyPayment(
  d: PaymentsDeps,
  tx: TxContext,
  op: OpRow,
  outcome: ProviderOutcome,
  contradiction: boolean,
) {
  const p = await db(tx)
    .selectFrom('payments.payments')
    .selectAll()
    .where('id', '=', op.target_id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const to: PaymentStatus = outcome.kind === 'succeeded' ? 'succeeded' : 'failed';
  const verdict = paymentTransition(p.status, to);
  if (verdict.kind === 'noop' || verdict.kind === 'stale') return;
  if (verdict.kind === 'mismatch') {
    await contradictionException(tx, op, outcome, `payment recorded as ${p.status}, provider says ${to}.`);
    return;
  }
  if (verdict.kind === 'apply_with_mismatch' || contradiction) {
    await contradictionException(
      tx,
      op,
      outcome,
      'a payment recorded as failed was collected by the provider.',
    );
  }
  const failure = failureOf(outcome);
  await db(tx)
    .updateTable('payments.payments')
    .set({
      status: to,
      provider_ref:
        outcome.kind === 'succeeded'
          ? outcome.providerRef
          : (p.provider_ref ?? (outcome.kind === 'declined' ? (outcome.providerRef ?? null) : null)),
      decline: to === 'failed' ? JSON.stringify(failure) : null,
      ledger_status: to === 'succeeded' ? 'pending' : p.ledger_status,
      version: p.version + 1,
    })
    .where('id', '=', p.id)
    .execute();

  if (op.kind === 'capture' && p.authorization_id) {
    const a = await db(tx)
      .selectFrom('payments.authorizations')
      .selectAll()
      .where('id', '=', p.authorization_id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const reserved = Math.max(0, a.capture_reserved_minor - (p.status === 'failed' ? 0 : p.amount_minor));
    if (to === 'succeeded') {
      const captured = a.captured_minor + p.amount_minor;
      const remaining =
        outcome.kind === 'succeeded' && outcome.remainingAuthorizedMinor !== undefined
          ? outcome.remainingAuthorizedMinor
          : a.amount_minor - captured - reserved;
      const status = statusAfterCapture(remaining);
      const apply = authorizationTransition(a.status, status);
      await db(tx)
        .updateTable('payments.authorizations')
        .set({
          captured_minor: Math.min(captured, a.amount_minor),
          capture_reserved_minor: reserved,
          status: apply.kind === 'apply' || apply.kind === 'noop' ? status : a.status,
          version: a.version + 1,
        })
        .where('id', '=', a.id)
        .execute();
      if (status === 'captured') {
        await tx.emit({
          type: PaymentsEvents.authorizationCaptured,
          propertyId: a.property_id,
          aggregate: { type: 'authorization', id: a.id },
          payload: {
            authorizationId: a.id,
            capturedMinor: captured,
            releasedMinor: Math.max(0, a.amount_minor - captured),
          },
        });
      }
    } else {
      await db(tx)
        .updateTable('payments.authorizations')
        .set({ capture_reserved_minor: reserved, version: a.version + 1 })
        .where('id', '=', a.id)
        .execute();
    }
  }

  if (to === 'succeeded') {
    await postPaymentLedger(d, tx, p.id);
    if (p.payment_request_id) await creditPaymentRequest(tx, p.payment_request_id, p.amount_minor);
    if (p.virtual_card_id) {
      await db(tx)
        .updateTable('payments.virtual_cards')
        .set({
          status: 'charged',
          charged_payment_id: p.id,
          next_attempt_at: null,
          version: (eb) => eb('version', '+', 1),
        })
        .where('id', '=', p.virtual_card_id)
        .execute();
      await tx.emit({
        type: PaymentsEvents.vccCharged,
        propertyId: p.property_id,
        aggregate: { type: 'virtual_card', id: p.virtual_card_id },
        payload: { virtualCardId: p.virtual_card_id, paymentId: p.id },
      });
    }
    await tx.emit({
      type: PaymentsEvents.paymentSucceeded,
      propertyId: p.property_id,
      aggregate: { type: 'payment', id: p.id },
      payload: {
        paymentId: p.id,
        ref: { type: p.ref_type, id: p.ref_id },
        amountMinor: p.amount_minor,
        currency: p.currency,
        method: p.method,
        mode: p.mode,
      },
    });
  } else {
    if (p.virtual_card_id) await vccAfterFailure(d, tx, p.virtual_card_id, p.property_id, outcome);
    await tx.emit({
      type: PaymentsEvents.paymentFailed,
      propertyId: p.property_id,
      aggregate: { type: 'payment', id: p.id },
      payload: { paymentId: p.id, ref: { type: p.ref_type, id: p.ref_id }, code: failure?.code ?? 'unknown' },
    });
  }
}

export async function creditPaymentRequest(tx: TxContext, requestId: string, amountMinor: number) {
  const r = await db(tx)
    .selectFrom('payments.payment_requests')
    .selectAll()
    .where('id', '=', requestId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const paid = r.paid_minor + amountMinor;
  const status = paymentRequestStatusFor(r.status, r.amount_minor, paid);
  await db(tx)
    .updateTable('payments.payment_requests')
    .set({ paid_minor: paid, status, version: r.version + 1 })
    .where('id', '=', r.id)
    .execute();
  if (status === 'paid' && r.status !== 'paid') {
    await tx.emit({
      type: PaymentsEvents.requestPaid,
      propertyId: r.property_id,
      aggregate: { type: 'payment_request', id: r.id },
      payload: {
        paymentRequestId: r.id,
        ref: { type: r.ref_type, id: r.ref_id },
        paidMinor: paid,
        currency: r.currency,
      },
    });
  }
  if (r.status === 'cancelled' || r.status === 'expired' || paid > r.amount_minor) {
    await raiseException(tx, {
      propertyId: r.property_id,
      kind: 'payment_request_overpaid',
      severity: 'routine',
      problem: `A payment arrived on a ${r.status} payment request (paid ${paid} of ${r.amount_minor} ${r.currency} minor units).`,
      businessImpact: 'The guest may have paid more than requested or after cancellation.',
      nextStep: 'Keep it as a credit on the bill or refund the difference.',
      ownerRole: 'finance',
      responsibleParty: 'hotel',
      ref: { type: 'payment_request', id: r.id },
      dedupeKey: `request-overpaid:${r.id}:${paid}`,
    });
  }
}

async function vccAfterFailure(
  d: PaymentsDeps,
  tx: TxContext,
  vccId: string,
  propertyId: string,
  outcome: ProviderOutcome,
) {
  const v = await db(tx)
    .selectFrom('payments.virtual_cards')
    .selectAll()
    .where('id', '=', vccId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const code = failureOf(outcome)?.code ?? 'generic_decline';
  const explanation = explainDecline(code);
  const property = await d.platform.getProperty(tx, propertyId);
  const decision = vccRetryDecision({
    attempts: v.attempts,
    now: tx.now,
    expiresOn: v.expires_on,
    todayLocal: localDateIn(tx.now, property.timezone),
    retryable: explanation.retryable || explanation.category === 'funding_delay',
  });
  if (decision.kind === 'retry') {
    await db(tx)
      .updateTable('payments.virtual_cards')
      .set({
        status: 'funding_retry',
        next_attempt_at: decision.at,
        last_failure: JSON.stringify({ code }),
        version: v.version + 1,
      })
      .where('id', '=', v.id)
      .execute();
    return;
  }
  await db(tx)
    .updateTable('payments.virtual_cards')
    .set({
      status: 'failed',
      next_attempt_at: null,
      last_failure: JSON.stringify({ code }),
      version: v.version + 1,
    })
    .where('id', '=', v.id)
    .execute();
  await tx.emit({
    type: PaymentsEvents.vccFailed,
    propertyId,
    aggregate: { type: 'virtual_card', id: v.id },
    payload: { virtualCardId: v.id, code, bookingId: v.booking_id },
  });
  await raiseException(tx, {
    propertyId,
    kind: 'vcc_charge_failed',
    severity: 'urgent',
    problem: `The ${v.channel} virtual card for booking reference ${v.channel_reference} could not be charged: ${explanation.message} (${decision.reason})`,
    businessImpact: 'The stay is not paid by the channel yet.',
    nextStep:
      'Check the virtual card in the channel extranet; ask the channel for a new card or collect from the guest.',
    ownerRole: 'reservations',
    responsibleParty: 'hotel',
    ref: { type: 'virtual_card', id: v.id },
    dedupeKey: `vcc-failed:${v.id}`,
  });
}

async function applyRefund(
  d: PaymentsDeps,
  tx: TxContext,
  op: OpRow,
  outcome: ProviderOutcome,
  contradiction: boolean,
) {
  const r = await db(tx)
    .selectFrom('payments.refunds')
    .selectAll()
    .where('id', '=', op.target_id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const p = await db(tx)
    .selectFrom('payments.payments')
    .selectAll()
    .where('id', '=', r.payment_id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const to: PaymentStatus = outcome.kind === 'succeeded' ? 'succeeded' : 'failed';
  const verdict = refundTransition(r.status, to);
  if (verdict.kind === 'noop' || verdict.kind === 'stale') return;
  if (verdict.kind === 'mismatch') {
    await contradictionException(tx, op, outcome, `refund recorded as ${r.status}, provider says ${to}.`);
    return;
  }
  if (verdict.kind === 'apply_with_mismatch' || contradiction) {
    await contradictionException(
      tx,
      op,
      outcome,
      to === 'failed'
        ? 'a refund first confirmed was later reported as failed (the guest did not receive it); finance must correct the ledger.'
        : 'a refund recorded as failed went through at the provider.',
    );
  }
  const failure = failureOf(outcome);
  const wasInFlight = r.status === 'processing' || r.status === 'pending_verification';
  await db(tx)
    .updateTable('payments.refunds')
    .set({
      status: to,
      provider_ref: outcome.kind === 'succeeded' ? outcome.providerRef : r.provider_ref,
      failure: to === 'failed' ? JSON.stringify(failure) : null,
      ledger_status: to === 'succeeded' ? 'pending' : r.ledger_status,
      version: r.version + 1,
    })
    .where('id', '=', r.id)
    .execute();
  const reserved = wasInFlight ? p.refund_reserved_minor - r.amount_minor : p.refund_reserved_minor;
  const refunded =
    to === 'succeeded'
      ? p.refunded_minor + r.amount_minor
      : r.status === 'succeeded'
        ? p.refunded_minor - r.amount_minor
        : p.refunded_minor;
  await db(tx)
    .updateTable('payments.payments')
    .set({
      refund_reserved_minor: Math.max(0, reserved),
      refunded_minor: Math.max(0, refunded),
      version: p.version + 1,
    })
    .where('id', '=', p.id)
    .execute();
  if (to === 'succeeded') await postRefundLedger(d, tx, r.id);
  await tx.emit({
    type: to === 'succeeded' ? PaymentsEvents.refundSucceeded : PaymentsEvents.refundFailed,
    propertyId: r.property_id,
    aggregate: { type: 'refund', id: r.id },
    payload: { refundId: r.id, paymentId: p.id, amountMinor: r.amount_minor, currency: r.currency },
  });
}

// ───────────────────────── verification (lookup only, never re-send) ─────────────────────────

export interface VerifyResult {
  operationId: string;
  status: string;
  changed: boolean;
}

/**
 * Resolve a `sent` / `pending_verification` operation by asking the provider. `force` ignores the backoff
 * schedule (staff pressed "check now", or a webhook arrived).
 */
export async function verifyOperation(
  d: PaymentsDeps,
  ctx: RequestContext,
  operationId: string,
  opts: { force?: boolean } = {},
): Promise<VerifyResult> {
  const loaded = await withTenantTx(d.database, ctx, async (tx) => {
    const op = (await db(tx)
      .selectFrom('payments.provider_operations')
      .selectAll()
      .where('id', '=', operationId)
      .executeTakeFirst()) as OpRow | undefined;
    if (!op) throw new NotFoundError('provider_operation', operationId);
    if (op.status !== 'sent' && op.status !== 'pending_verification')
      return { op, account: null, parent: null };
    if (!opts.force && op.next_check_at && new Date(op.next_check_at).getTime() > tx.now.getTime()) {
      return { op, account: null, parent: null };
    }
    const account = await db(tx)
      .selectFrom('payments.accounts')
      .selectAll()
      .where('id', '=', op.account_id)
      .executeTakeFirstOrThrow();
    const details = op.kind === 'authorize' || op.kind === 'charge' ? {} : await loadCallDetails(tx, op);
    return { op, account, parent: details.parentProviderRef ?? null };
  });
  const { op, account } = loaded;
  if (!account) return { operationId, status: op.status, changed: false };

  let result: LookupResult;
  try {
    const resolved = d.registry.forAccount(ctx, toProviderAccount(account));
    result = resolved.ok
      ? await resolved.provider.lookup(toProviderAccount(account), {
          operationId: op.id,
          kind: op.kind,
          idempotencyKey: op.idempotency_key,
          providerRef: op.provider_ref,
          parentProviderRef: loaded.parent,
          amountMinor: op.kind === 'increment' ? 0 : op.amount_minor,
        })
      : { found: 'unknown', reason: 'provider not configured' };
  } catch (err) {
    result = { found: 'unknown', reason: err instanceof Error ? err.message : String(err) };
  }

  return withTenantTx(d.database, ctx, async (tx) => {
    const current = await db(tx)
      .selectFrom('payments.provider_operations')
      .select(['status', 'attempts', 'sent_at', 'created_at'])
      .where('id', '=', op.id)
      .executeTakeFirstOrThrow();
    await journal(tx, { id: op.id, attempts: current.attempts }, 'lookup', String(result.found), { result });
    let changed = false;
    const sentAt = new Date(current.sent_at ?? current.created_at).getTime();
    if (result.found === true) {
      changed = await applyOutcome(d, tx, op.id, result.outcome, 'lookup');
    } else if (result.found === false && tx.now.getTime() - sentAt >= NOT_FOUND_GRACE_MS) {
      changed = await applyOutcome(
        d,
        tx,
        op.id,
        {
          kind: 'failed',
          code: 'not_received_by_provider',
          message: 'The provider has no record of this request.',
        },
        'lookup',
      );
    } else {
      changed = await applyOutcome(
        d,
        tx,
        op.id,
        { kind: 'unknown', reason: result.found === false ? 'not found yet' : result.reason },
        'lookup',
      );
    }
    const after = await db(tx)
      .selectFrom('payments.provider_operations')
      .select(['status'])
      .where('id', '=', op.id)
      .executeTakeFirstOrThrow();
    if (
      (after.status === 'pending_verification' || after.status === 'sent') &&
      tx.now.getTime() - new Date(current.created_at).getTime() >= ESCALATE_PENDING_AFTER_MS
    ) {
      await raiseException(tx, {
        propertyId: op.property_id,
        kind: 'pending_verification_overdue',
        severity: 'urgent',
        problem: `A ${op.kind} of ${op.currency} ${op.amount_minor} (minor units) has been pending verification for more than a day.`,
        businessImpact: 'Portico cannot tell whether money moved; the bill shows it as pending.',
        nextStep:
          'Look the transaction up in the provider dashboard and confirm with the guest; contact provider support if needed.',
        ownerRole: 'finance',
        responsibleParty: 'provider',
        ref: { type: op.target_type, id: op.target_id },
        dedupeKey: `pending:${op.id}`,
      });
    }
    return { operationId: op.id, status: after.status, changed };
  });
}
