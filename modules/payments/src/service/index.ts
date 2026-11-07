/**
 * The payments service, bound to its dependencies. Three surfaces:
 *  - `provider`: the domain-map functions other modules call INSIDE their transaction (intent only; the provider
 *    call runs after commit and, durably, via the `payments.operation.requested` consumer);
 *  - driver functions that run a command and then execute/verify it (HTTP routes, jobs, tests);
 *  - worker subscriptions (executor + reconciler).
 */
import { type TxContext, type TxEventSubscription, withTenantTx } from '@portico/db';
import { DomainError, delegateAtProperty, type RequestContext } from '@portico/kernel';
import type { Authorization, Payment, PaymentRequest, Refund } from '../contracts';
import { type BreakerConfig, DEFAULT_BREAKER } from '../domain/circuit-breaker';
import { PaymentsEvents } from '../events';
import type { LedgerPort, PlatformPort } from '../ports';
import type { ProviderRegistry } from '../providers/registry';
import * as accounts from './accounts';
import * as collect from './collect';
import { executeOperation, verifyOperation } from './operations';
import * as queries from './queries';
import * as reconcile from './reconcile';
import * as requests from './requests';
import { db, type PaymentsDeps, requestContextOf, requireRead } from './shared';
import * as webhooks from './webhooks';

export interface PaymentsServiceDeps {
  database: PaymentsDeps['database'];
  ledger: LedgerPort;
  platform: PlatformPort;
  registry: ProviderRegistry;
  breaker?: BreakerConfig;
}

type Target = { type: 'payment' | 'authorization' | 'refund'; id: string };

/** Payments keys a port call implies once the calling module authorized its own command at the property. */
export const PAYMENTS_PORT_DELEGATION: readonly string[] = [
  'payments.payment.read',
  'payments.payment.collect',
  'payments.paymentRequest.create',
];
const PORT_DELEGATION = PAYMENTS_PORT_DELEGATION;

function scopeMismatch(kind: string, id: string, propertyId: string): DomainError {
  return new DomainError(
    'scope_mismatch',
    `This ${kind} belongs to another property, so it cannot be used from here. Open it at its own property.`,
    { status: 403, details: { kind, id, propertyId } },
  );
}

async function assertRecordAt(
  tx: TxContext,
  table: 'authorizations' | 'payments',
  kind: string,
  id: string,
  propertyId: string,
): Promise<void> {
  const row = await db(tx)
    .selectFrom(`payments.${table}`)
    .select('property_id')
    .where('id', '=', id)
    .executeTakeFirst();
  if (row && row.property_id !== propertyId) throw scopeMismatch(kind, id, propertyId);
}

async function assertRefAt(
  tx: TxContext,
  ref: { type: string; id: string },
  propertyId: string,
): Promise<void> {
  const rows = await db(tx)
    .selectFrom('payments.payments')
    .select('property_id')
    .where('ref_type', '=', ref.type as 'folio')
    .where('ref_id', '=', ref.id)
    .union(
      db(tx)
        .selectFrom('payments.authorizations')
        .select('property_id')
        .where('ref_type', '=', ref.type)
        .where('ref_id', '=', ref.id),
    )
    .execute();
  if (rows.some((r) => r.property_id !== propertyId)) throw scopeMismatch(ref.type, ref.id, propertyId);
}

export function createPaymentsService(input: PaymentsServiceDeps) {
  const d: PaymentsDeps = { ...input, breaker: input.breaker ?? DEFAULT_BREAKER };

  function scheduleAfterCommit(tx: TxContext, operationId: string | null) {
    if (!operationId) return;
    const ctx = requestContextOf(tx);
    tx.afterCommit(() => executeOperation(d, ctx, operationId));
  }

  /** Execute never-sent operations of a record; optionally verify unresolved ones now ("check now"). */
  async function settle(
    ctx: RequestContext,
    target: Target,
    opts: { verifyPending?: boolean } = {},
  ): Promise<void> {
    const ops = await withTenantTx(d.database, ctx, (tx) =>
      db(tx)
        .selectFrom('payments.provider_operations')
        .select(['id', 'status'])
        .where((eb) =>
          eb.or([
            eb.and([eb('target_type', '=', target.type), eb('target_id', '=', target.id)]),
            ...(target.type === 'authorization' ? [eb('authorization_id', '=', target.id)] : []),
          ]),
        )
        .where('status', 'in', ['pending', 'sent', 'pending_verification'])
        .orderBy('created_at')
        .execute(),
    );
    for (const op of ops) {
      if (op.status === 'pending') await executeOperation(d, ctx, op.id);
      else if (opts.verifyPending) await verifyOperation(d, ctx, op.id, { force: true });
    }
  }

  const view = {
    payment: (ctx: RequestContext, id: string) =>
      withTenantTx(d.database, ctx, (tx) => queries.getPayment(tx, id)),
    authorization: (ctx: RequestContext, id: string) =>
      withTenantTx(d.database, ctx, (tx) => queries.getAuthorization(tx, id)),
    refund: (ctx: RequestContext, id: string) =>
      withTenantTx(d.database, ctx, (tx) => queries.getRefund(tx, id)),
    request: (ctx: RequestContext, id: string) =>
      withTenantTx(d.database, ctx, (tx) => requests.getPaymentRequest(tx, id)),
  };

  return {
    deps: d,

    // ── domain-map provider functions (called inside the caller's transaction) ──
    // ADR-0015: the calling module (reservations, finance, front desk) authorized the user's intent at `propertyId`;
    // payments does not re-check its own keys for that user (granted at that property only) and refuses records of
    // another property (`scope_mismatch`). Refunds stay explicit: the user needs payments.payment.refund (§5).
    // Payments' own HTTP routes keep every permission check.
    provider: {
      async createPaymentRequest(
        tx: TxContext,
        i: {
          propertyId: string;
          legalEntityId?: string;
          payer: {
            type: 'guest_profile' | 'company' | 'agency' | 'other';
            id?: string;
            name: string;
            email?: string;
          };
          amount: { amountMinor: number; currency: string };
          purpose: 'deposit' | 'balance' | 'incidentals_preauth' | 'custom';
          ref: { type: 'folio' | 'booking'; id: string };
          expiresAt: Date | string;
          idempotencyKey: string;
          description?: string;
        },
      ): Promise<PaymentRequest> {
        tx = delegateAtProperty(tx, PORT_DELEGATION, i.propertyId);
        const r = await requests.createPaymentRequest(d, tx, {
          propertyId: i.propertyId,
          payer: i.payer,
          amount: i.amount,
          purpose: i.purpose,
          ref: i.ref,
          expiresAt: new Date(i.expiresAt).toISOString(),
          ...(i.description ? { description: i.description } : {}),
          businessKey: i.idempotencyKey,
        });
        const ctx = requestContextOf(tx);
        tx.afterCommit(() => requests.ensurePaymentLink(d, ctx, r.id));
        return requests.getPaymentRequest(tx, r.id);
      },
      async authorize(
        tx: TxContext,
        i: {
          propertyId: string;
          methodId: string;
          amount: { amountMinor: number; currency: string };
          ref: { type: string; id: string };
          idempotencyKey: string;
        },
      ): Promise<Authorization> {
        // Who initiates is derived from the consent record (P1-8), never declared by the caller.
        tx = delegateAtProperty(tx, PORT_DELEGATION, i.propertyId);
        const s = await collect.authorize(d, tx, {
          propertyId: i.propertyId,
          methodId: i.methodId,
          amount: i.amount,
          ref: i.ref,
          businessKey: i.idempotencyKey,
        });
        scheduleAfterCommit(tx, s.operationId);
        return queries.getAuthorization(tx, s.id);
      },
      async capture(
        tx: TxContext,
        i: {
          authorizationId: string;
          amount?: { amountMinor: number; currency: string };
          ledgerRef?: { type: 'folio' | 'booking'; id: string };
          idempotencyKey: string;
          /** The property the caller authorized (ADR-0015); the hold must belong to it. */
          propertyId?: string;
        },
      ): Promise<Payment> {
        const { propertyId, ...rest } = i;
        if (propertyId) {
          await assertRecordAt(tx, 'authorizations', 'authorization', i.authorizationId, propertyId);
          tx = delegateAtProperty(tx, PORT_DELEGATION, propertyId);
        }
        const s = await collect.capture(d, tx, { ...rest, businessKey: i.idempotencyKey });
        scheduleAfterCommit(tx, s.operationId);
        return queries.getPayment(tx, s.id);
      },
      async charge(
        tx: TxContext,
        i: {
          propertyId: string;
          methodId: string;
          amount: { amountMinor: number; currency: string };
          ref: { type: 'folio' | 'booking'; id: string };
          idempotencyKey: string;
          purpose?: 'deposit' | 'balance' | 'incidentals' | 'custom';
        },
      ): Promise<Payment> {
        tx = delegateAtProperty(tx, PORT_DELEGATION, i.propertyId);
        const s = await collect.charge(d, tx, {
          propertyId: i.propertyId,
          methodId: i.methodId,
          amount: i.amount,
          ref: i.ref,
          ...(i.purpose ? { purpose: i.purpose } : {}),
          businessKey: i.idempotencyKey,
        });
        scheduleAfterCommit(tx, s.operationId);
        return queries.getPayment(tx, s.id);
      },
      async refund(
        tx: TxContext,
        i: {
          paymentId: string;
          amount: { amountMinor: number; currency: string };
          reason: string;
          idempotencyKey: string;
        },
      ): Promise<Refund> {
        const s = await collect.refund(d, tx, { ...i, businessKey: i.idempotencyKey });
        scheduleAfterCommit(tx, s.operationId);
        return queries.getRefund(tx, s.id);
      },
      /**
       * `scope` (ADR-0015): the property the caller authorized; every record on the reference must belong to it.
       * Without it, the caller's own payments read permission applies (HTTP-equivalent behaviour).
       */
      async getPaymentStatus(
        tx: TxContext,
        ref: { type: string; id: string },
        scope?: { propertyId: string },
      ) {
        if (!scope) return queries.getPaymentStatus(tx, ref);
        await assertRefAt(tx, ref, scope.propertyId);
        return queries.getPaymentStatus(delegateAtProperty(tx, PORT_DELEGATION, scope.propertyId), ref);
      },
      listUnresolved: (tx: TxContext, i: { propertyId: string }) =>
        queries.listUnresolved(delegateAtProperty(tx, PORT_DELEGATION, i.propertyId), i),
    },

    // ── drivers: command + execute (+ verify on retry) ──
    async chargeNow(ctx: RequestContext, i: collect.ChargeCommand): Promise<Payment> {
      const s = await withTenantTx(d.database, ctx, (tx) => collect.charge(d, tx, i));
      await settle(ctx, { type: 'payment', id: s.id }, { verifyPending: s.replayed });
      return view.payment(ctx, s.id);
    },
    settle,
    view,
    execute: (ctx: RequestContext, operationId: string) => executeOperation(d, ctx, operationId),
    verify: (ctx: RequestContext, operationId: string, force = true) =>
      verifyOperation(d, ctx, operationId, { force }),
    /** "Check now" on a record: verify its unresolved operations with the provider immediately. */
    async checkNow(ctx: RequestContext, target: Target): Promise<void> {
      await withTenantTx(d.database, ctx, async (tx) => {
        const table =
          target.type === 'payment'
            ? 'payments.payments'
            : target.type === 'refund'
              ? 'payments.refunds'
              : 'payments.authorizations';
        const row = await db(tx)
          .selectFrom(table)
          .select(['property_id'])
          .where('id', '=', target.id)
          .executeTakeFirst();
        if (!row)
          throw new DomainError(`${target.type}_not_found`, `${target.type} ${target.id} was not found.`, {
            status: 404,
          });
        requireRead(tx, row.property_id);
      });
      await settle(ctx, target, { verifyPending: true });
    },
    runReconciliation: (ctx: RequestContext, opts: { propertyId?: string } = {}) =>
      reconcile.runReconciliation(d, ctx, opts),
    runDueVirtualCards: (ctx: RequestContext, opts: { propertyId?: string } = {}) =>
      requests.runDueVirtualCards(d, ctx, opts),
    ensurePaymentLink: (ctx: RequestContext, requestId: string) =>
      requests.ensurePaymentLink(d, ctx, requestId),
    simulateRequestPayment: (ctx: RequestContext, requestId: string, amountMinor?: number) =>
      requests.simulateRequestPayment(d, ctx, requestId, amountMinor),
    deliverSimulatorWebhooks: (ctx: RequestContext, accountId: string) =>
      webhooks.deliverSimulatorWebhooks(d, ctx, accountId),
    runEventBackstop: (ctx: RequestContext) => webhooks.runEventBackstop(d, ctx),
    /** Monoclay operator tooling only (never exposed on tenant routes). */
    operator: {
      linkProviderAccount: (tx: TxContext, i: Parameters<typeof accounts.operatorLinkProviderAccount>[1]) =>
        accounts.operatorLinkProviderAccount(tx, i),
      setApplicationFee: (tx: TxContext, i: Parameters<typeof accounts.operatorSetApplicationFee>[1]) =>
        accounts.operatorSetApplicationFee(tx, i),
    },
    receiveStripeWebhook: (rawBody: string, headers: Record<string, string | undefined>) =>
      webhooks.receiveStripeWebhook(d, rawBody, headers),

    // ── tx-level commands and queries (routes wrap them in transactions) ──
    tx: {
      createAccount: (tx: TxContext, i: Parameters<typeof accounts.createAccount>[2]) =>
        accounts.createAccount(d, tx, i),
      listAccounts: (tx: TxContext, legalEntityId?: string) => accounts.listAccounts(d, tx, legalEntityId),
      getAccount: (tx: TxContext, id: string) => accounts.getAccount(d, tx, id),
      updateAccount: (
        tx: TxContext,
        id: string,
        v: number,
        p: Parameters<typeof accounts.updateAccount>[4],
      ) => accounts.updateAccount(d, tx, id, v, p),
      setSimulatorControls: (
        tx: TxContext,
        id: string,
        c: Parameters<typeof accounts.setSimulatorControls>[3],
      ) => accounts.setSimulatorControls(d, tx, id, c),
      accountHealth: (tx: TxContext, id: string) => accounts.accountHealth(d, tx, id),
      createMethod: (tx: TxContext, i: Parameters<typeof accounts.createMethod>[2]) =>
        accounts.createMethod(d, tx, i),
      getMethod: accounts.getMethod,
      listMethods: accounts.listMethods,
      detachMethod: (tx: TxContext, id: string, v: number) => accounts.detachMethod(d, tx, id, v),
      authorize: (tx: TxContext, i: Parameters<typeof collect.authorize>[2]) => collect.authorize(d, tx, i),
      increment: (tx: TxContext, i: Parameters<typeof collect.incrementAuthorization>[2]) =>
        collect.incrementAuthorization(d, tx, i),
      capture: (tx: TxContext, i: Parameters<typeof collect.capture>[2]) => collect.capture(d, tx, i),
      void: (tx: TxContext, i: Parameters<typeof collect.voidAuthorization>[2]) =>
        collect.voidAuthorization(d, tx, i),
      charge: (tx: TxContext, i: Parameters<typeof collect.charge>[2]) => collect.charge(d, tx, i),
      refund: (tx: TxContext, i: Parameters<typeof collect.refund>[2]) => collect.refund(d, tx, i),
      recordPayment: (tx: TxContext, i: Parameters<typeof collect.recordPayment>[2]) =>
        collect.recordPayment(d, tx, i),
      recordAuthorization: (tx: TxContext, i: Parameters<typeof collect.recordAuthorization>[2]) =>
        collect.recordAuthorization(d, tx, i),
      recordRefund: (tx: TxContext, i: Parameters<typeof collect.recordRefund>[2]) =>
        collect.recordRefund(d, tx, i),
      confirmBankTransfer: (tx: TxContext, i: Parameters<typeof collect.confirmBankTransfer>[2]) =>
        collect.confirmBankTransfer(d, tx, i),
      cancelBankTransfer: (tx: TxContext, paymentId: string, reason: string) =>
        collect.cancelBankTransfer(d, tx, paymentId, reason),
      adjustRecordedPayment: (tx: TxContext, i: Parameters<typeof collect.adjustRecordedPayment>[2]) =>
        collect.adjustRecordedPayment(d, tx, i),
      createPaymentRequest: (tx: TxContext, i: Parameters<typeof requests.createPaymentRequest>[2]) =>
        requests.createPaymentRequest(d, tx, i),
      getPaymentRequest: requests.getPaymentRequest,
      listPaymentRequests: requests.listPaymentRequests,
      cancelPaymentRequest: (tx: TxContext, id: string, v: number, reason: string) =>
        requests.cancelPaymentRequest(d, tx, id, v, reason),
      registerVirtualCard: (tx: TxContext, i: Parameters<typeof requests.registerVirtualCard>[2]) =>
        requests.registerVirtualCard(d, tx, i),
      getVirtualCard: requests.getVirtualCard,
      importStatement: (tx: TxContext, i: Parameters<typeof reconcile.importStatement>[2]) =>
        reconcile.importStatement(d, tx, i),
      recordPayout: (tx: TxContext, i: Parameters<typeof reconcile.recordPayout>[2]) =>
        reconcile.recordPayout(d, tx, i),
      listPayouts: reconcile.listPayouts,
      getDispute: reconcile.getDispute,
      listDisputes: reconcile.listDisputes,
      updateDisputeEvidence: reconcile.updateDisputeEvidence,
      getPayment: queries.getPayment,
      getAuthorization: queries.getAuthorization,
      getRefund: queries.getRefund,
      operationHistory: queries.operationHistory,
      getPaymentStatus: queries.getPaymentStatus,
      listUnresolved: queries.listUnresolved,
      paymentsStatus: (tx: TxContext, propertyId: string) => queries.paymentsStatus(d, tx, propertyId),
      listExceptions: queries.listExceptions,
      resolveException: queries.resolveException,
    },

    /** Worker consumers: send committed intents once; verify pending outcomes with provider backoff. */
    subscriptions(): TxEventSubscription[] {
      return [
        {
          consumer: 'payments.operation-executor',
          types: [PaymentsEvents.operationRequested],
          async handle(tx, event) {
            const operationId = String((event.payload as { operationId?: unknown }).operationId ?? '');
            // P2-7: never hold the delivery transaction across the provider call — run it after commit.
            const ctx = requestContextOf(tx);
            if (operationId) tx.afterCommit(() => executeOperation(d, ctx, operationId));
          },
        },
        {
          consumer: 'payments.reconciler',
          types: [PaymentsEvents.operationPendingVerification],
          async handle(tx, event) {
            const operationId = String((event.payload as { operationId?: unknown }).operationId ?? '');
            if (!operationId) return;
            const r = await verifyOperation(d, requestContextOf(tx), operationId, { force: true });
            if (r.status === 'pending_verification' || r.status === 'sent') {
              // Still unknown: fail this delivery so the outbox retries it with exponential backoff.
              throw new DomainError(
                'payment_still_pending_verification',
                `Operation ${operationId} is still pending verification; it will be checked again.`,
                { retryable: true },
              );
            }
          },
        },
      ];
    },
  };
}

export type PaymentsService = ReturnType<typeof createPaymentsService>;
