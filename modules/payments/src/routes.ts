/**
 * HTTP surface of payments (/v1/payments/…). Thin handlers: validation (Zod), idempotency (Idempotency-Key is
 * mandatory for every create and every money movement), ETag / If-Match for versioned records, and honest
 * status codes: 201 = done and confirmed (or recorded), 202 = pending (processing / pending verification),
 * 402 = declined / failed with an explanation of the problem AND the recovery.
 */
import { type PorticoDatabase, runIdempotent, type TxContext, withTenantTx } from '@portico/db';
import { type HttpModule, idParams, requireIdempotencyKey, requireIfMatch, setVersion } from '@portico/http';
import { DomainError, ForbiddenError, requirePermission } from '@portico/kernel';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  type Authorization as AuthorizationView,
  account,
  accountHealth,
  accountInput,
  accountUpdate,
  adjustmentInput,
  authorization,
  authorizeInput,
  cancelBankTransferInput,
  cancelRequestInput,
  captureInput,
  chargeInput,
  confirmBankTransferInput,
  dispute,
  evidenceUpdate,
  incrementInput,
  type Payment,
  payment,
  paymentException,
  paymentMethod,
  paymentMethodInput,
  paymentRequest,
  paymentRequestInput,
  paymentsStatus,
  payout,
  payoutInput,
  type Refund,
  reconciliationResult,
  recordAuthorizationInput,
  recordPaymentInput,
  recordRefundInput,
  refund,
  refundInput,
  resolveExceptionInput,
  simulatorControls,
  statementImportInput,
  statementResult,
  virtualCard,
  virtualCardInput,
  voidInput,
} from './contracts';
import { SIMULATOR_TEST_TOKENS } from './providers/simulator';
import type { PaymentsService } from './service';

const tags = ['Payments'];
const propertyQuery = z.object({ propertyId: z.uuid() });
const refQuery = z.object({ refType: z.string().min(1).max(40), refId: z.uuid() });

function replyPayment(reply: FastifyReply, p: Payment): FastifyReply {
  if (p.status.payment === 'failed') {
    throw new DomainError(
      'payment_declined',
      `${p.decline?.message ?? 'The payment did not go through.'} ${p.decline?.recovery ?? ''} Nothing was collected.`.trim(),
      { status: 402, details: { payment: p } },
    );
  }
  setVersion(reply, p.version);
  const pending = ['processing', 'pending_verification', 'awaiting_receipt'].includes(p.status.payment ?? '');
  return reply.status(pending ? 202 : 201).send(p);
}

function replyAuthorization(reply: FastifyReply, a: AuthorizationView, created = true): FastifyReply {
  if (a.status.authorization === 'failed') {
    throw new DomainError(
      'authorization_declined',
      `${a.decline?.message ?? 'The hold was declined.'} ${a.decline?.recovery ?? ''} No funds are held.`.trim(),
      { status: 402, details: { authorization: a } },
    );
  }
  setVersion(reply, a.version);
  return reply
    .status(
      a.status.authorization === 'processing' || a.status.authorization === 'pending_verification'
        ? 202
        : created
          ? 201
          : 200,
    )
    .send(a);
}

function replyRefund(reply: FastifyReply, r: Refund): FastifyReply {
  if (r.status.refund === 'failed') {
    throw new DomainError(
      'refund_failed',
      `${r.failure?.message ?? 'The refund did not go through.'} No money left the hotel. ${r.failure?.recovery ?? ''}`.trim(),
      { status: 402, details: { refund: r } },
    );
  }
  setVersion(reply, r.version);
  return reply
    .status(r.status.refund === 'processing' || r.status.refund === 'pending_verification' ? 202 : 201)
    .send(r);
}

export function paymentsHttp(deps: { database: PorticoDatabase; service: PaymentsService }): HttpModule {
  const { database, service: svc } = deps;

  async function idem<T>(
    req: FastifyRequest,
    scope: string,
    fn: (tx: TxContext, key: string) => Promise<T>,
  ): Promise<{ body: T; replayed: boolean }> {
    const key = requireIdempotencyKey(req);
    const res = await runIdempotent(
      database,
      req.ctx,
      { scope, key, request: { params: req.params ?? null, body: req.body ?? null } },
      async (tx) => ({ status: 200, body: await fn(tx, key) }),
    );
    return { body: res.body, replayed: res.replayed };
  }
  const tx = <T>(req: FastifyRequest, fn: (tx: TxContext) => Promise<T>) =>
    withTenantTx(database, req.ctx, fn);

  return {
    name: 'payments',
    async routes(app) {
      // ───────────── accounts ─────────────
      app.get(
        '/payments/accounts',
        {
          schema: {
            tags,
            querystring: z.object({ legalEntityId: z.uuid().optional() }),
            response: { 200: z.object({ items: z.array(account) }) },
          },
        },
        async (req) => ({ items: await tx(req, (t) => svc.tx.listAccounts(t, req.query.legalEntityId)) }),
      );
      app.post(
        '/payments/accounts',
        { schema: { tags, body: accountInput, response: { 201: account } } },
        async (req, reply) => {
          const r = await idem(req, 'POST /payments/accounts', (t) => svc.tx.createAccount(t, req.body));
          setVersion(reply, r.body.version);
          return reply.status(201).send(r.body);
        },
      );
      app.get(
        '/payments/accounts/:id',
        { schema: { tags, params: idParams, response: { 200: account } } },
        async (req, reply) => {
          const a = await tx(req, (t) => svc.tx.getAccount(t, req.params.id));
          setVersion(reply, a.version);
          return a;
        },
      );
      app.patch(
        '/payments/accounts/:id',
        { schema: { tags, params: idParams, body: accountUpdate, response: { 200: account } } },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const a = await tx(req, (t) => svc.tx.updateAccount(t, req.params.id, expected, req.body));
          setVersion(reply, a.version);
          return a;
        },
      );
      app.get(
        '/payments/accounts/:id/health',
        { schema: { tags, params: idParams, response: { 200: accountHealth } } },
        async (req) =>
          tx(req, async (t) => {
            requirePermission(t, 'payments.account.read');
            return svc.tx.accountHealth(t, req.params.id);
          }),
      );
      app.put(
        '/payments/accounts/:id/simulator-controls',
        {
          schema: {
            tags: ['Payments simulator'],
            params: idParams,
            body: simulatorControls,
            response: { 200: account },
          },
        },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const a = await tx(req, async (t) => {
            const current = await svc.tx.getAccount(t, req.params.id);
            if (current.version !== expected) {
              throw new DomainError(
                'version_conflict',
                'This account was changed by someone else. Reload it and apply your change again.',
                { status: 409, details: { expectedVersion: expected, currentVersion: current.version } },
              );
            }
            return svc.tx.setSimulatorControls(t, req.params.id, req.body);
          });
          setVersion(reply, a.version);
          return a;
        },
      );
      app.post(
        '/payments/accounts/:id/simulator/deliver-webhooks',
        { schema: { tags: ['Payments simulator'], params: idParams } },
        async (req) => {
          const r = await svc.deliverSimulatorWebhooks(req.ctx, req.params.id);
          return { delivered: r.delivered, receipts: r.receipts };
        },
      );
      app.get('/payments/simulator/test-tokens', { schema: { tags: ['Payments simulator'] } }, async () => ({
        note: 'Approved TEST instruments only. They work only where payments are simulated (demo, trial, training, tests).',
        items: SIMULATOR_TEST_TOKENS.map((t) => ({
          token: t.token,
          brand: t.brand,
          last4: t.last4,
          description: t.description,
        })),
      }));

      // ───────────── payment methods (tokens only) ─────────────
      app.post(
        '/payments/methods',
        { schema: { tags, body: paymentMethodInput, response: { 201: paymentMethod } } },
        async (req, reply) => {
          const r = await idem(req, 'POST /payments/methods', (t) => svc.tx.createMethod(t, req.body));
          setVersion(reply, r.body.version);
          return reply.status(201).send(r.body);
        },
      );
      app.get(
        '/payments/methods',
        {
          schema: {
            tags,
            querystring: z.object({
              ownerType: z.enum(['guest_profile', 'company', 'agency', 'booking']),
              ownerId: z.uuid(),
            }),
            response: { 200: z.object({ items: z.array(paymentMethod) }) },
          },
        },
        async (req) => ({
          items: await tx(req, (t) =>
            svc.tx.listMethods(t, { type: req.query.ownerType, id: req.query.ownerId }),
          ),
        }),
      );
      app.get(
        '/payments/methods/:id',
        { schema: { tags, params: idParams, response: { 200: paymentMethod } } },
        async (req, reply) => {
          const m = await tx(req, (t) => svc.tx.getMethod(t, req.params.id));
          setVersion(reply, m.version);
          return m;
        },
      );
      app.post(
        '/payments/methods/:id/detach',
        { schema: { tags, params: idParams, response: { 200: paymentMethod } } },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const m = await tx(req, (t) => svc.tx.detachMethod(t, req.params.id, expected));
          setVersion(reply, m.version);
          return m;
        },
      );

      // ───────────── authorizations ─────────────
      app.post(
        '/payments/authorizations',
        { schema: { tags, body: authorizeInput, response: { 201: authorization, 202: authorization } } },
        async (req, reply) => {
          const r = await idem(req, 'POST /payments/authorizations', (t, key) =>
            svc.tx.authorize(t, { ...req.body, businessKey: key }),
          );
          await svc.settle(req.ctx, { type: 'authorization', id: r.body.id }, { verifyPending: r.replayed });
          return replyAuthorization(reply, await svc.view.authorization(req.ctx, r.body.id));
        },
      );
      app.post(
        '/payments/authorizations/recorded',
        { schema: { tags, body: recordAuthorizationInput, response: { 201: authorization } } },
        async (req, reply) => {
          const r = await idem(req, 'POST /payments/authorizations/recorded', (t, key) =>
            svc.tx.recordAuthorization(t, { ...req.body, businessKey: key }),
          );
          return replyAuthorization(reply, await svc.view.authorization(req.ctx, r.body.id));
        },
      );
      app.get(
        '/payments/authorizations/:id',
        { schema: { tags, params: idParams, response: { 200: authorization } } },
        async (req, reply) => {
          const a = await tx(req, (t) => svc.tx.getAuthorization(t, req.params.id));
          setVersion(reply, a.version);
          return a;
        },
      );
      app.post(
        '/payments/authorizations/:id/increment',
        {
          schema: {
            tags,
            params: idParams,
            body: incrementInput,
            response: { 200: authorization, 202: authorization },
          },
        },
        async (req, reply) => {
          await idem(req, 'POST /payments/authorizations/:id/increment', (t) =>
            svc.tx.increment(t, {
              authorizationId: req.params.id,
              additionalAmount: req.body.additionalAmount,
            }),
          );
          await svc.settle(req.ctx, { type: 'authorization', id: req.params.id });
          return replyAuthorization(reply, await svc.view.authorization(req.ctx, req.params.id), false);
        },
      );
      app.post(
        '/payments/authorizations/:id/capture',
        { schema: { tags, params: idParams, body: captureInput, response: { 201: payment, 202: payment } } },
        async (req, reply) => {
          const r = await idem(req, 'POST /payments/authorizations/:id/capture', (t, key) =>
            svc.tx.capture(t, {
              authorizationId: req.params.id,
              businessKey: key,
              ...(req.body.amount ? { amount: req.body.amount } : {}),
              ...(req.body.ledgerRef ? { ledgerRef: req.body.ledgerRef } : {}),
              ...(req.body.separateCollection ? { separateCollection: req.body.separateCollection } : {}),
            }),
          );
          await svc.settle(req.ctx, { type: 'payment', id: r.body.id }, { verifyPending: r.replayed });
          return replyPayment(reply, await svc.view.payment(req.ctx, r.body.id));
        },
      );
      app.post(
        '/payments/authorizations/:id/void',
        {
          schema: {
            tags,
            params: idParams,
            body: voidInput,
            response: { 200: authorization, 202: authorization },
          },
        },
        async (req, reply) => {
          await idem(req, 'POST /payments/authorizations/:id/void', (t) =>
            svc.tx.void(t, { authorizationId: req.params.id, reason: req.body.reason }),
          );
          await svc.settle(req.ctx, { type: 'authorization', id: req.params.id });
          return replyAuthorization(reply, await svc.view.authorization(req.ctx, req.params.id), false);
        },
      );
      app.post(
        '/payments/authorizations/:id/check',
        { schema: { tags, params: idParams, response: { 200: authorization, 202: authorization } } },
        async (req, reply) => {
          await svc.checkNow(req.ctx, { type: 'authorization', id: req.params.id });
          return replyAuthorization(reply, await svc.view.authorization(req.ctx, req.params.id), false);
        },
      );

      // ───────────── charges and recorded payments ─────────────
      app.post(
        '/payments/charges',
        { schema: { tags, body: chargeInput, response: { 201: payment, 202: payment } } },
        async (req, reply) => {
          const r = await idem(req, 'POST /payments/charges', (t, key) =>
            svc.tx.charge(t, { ...req.body, businessKey: key }),
          );
          await svc.settle(req.ctx, { type: 'payment', id: r.body.id }, { verifyPending: r.replayed });
          return replyPayment(reply, await svc.view.payment(req.ctx, r.body.id));
        },
      );
      app.post(
        '/payments/recorded',
        { schema: { tags, body: recordPaymentInput, response: { 201: payment, 202: payment } } },
        async (req, reply) => {
          const r = await idem(req, 'POST /payments/recorded', (t, key) =>
            svc.tx.recordPayment(t, { ...req.body, businessKey: key }),
          );
          return replyPayment(reply, await svc.view.payment(req.ctx, r.body.id));
        },
      );
      app.get(
        '/payments/transactions/:id',
        { schema: { tags, params: idParams, response: { 200: payment } } },
        async (req, reply) => {
          const p = await tx(req, (t) => svc.tx.getPayment(t, req.params.id));
          setVersion(reply, p.version);
          return p;
        },
      );
      app.get('/payments/transactions/:id/history', { schema: { tags, params: idParams } }, async (req) =>
        tx(req, async (t) => {
          const p = await svc.tx.getPayment(t, req.params.id);
          return {
            items: await svc.tx.operationHistory(t, { type: 'payment', id: p.id, propertyId: p.propertyId }),
          };
        }),
      );
      app.post(
        '/payments/transactions/:id/confirm-receipt',
        { schema: { tags, params: idParams, body: confirmBankTransferInput, response: { 200: payment } } },
        async (req, reply) => {
          await idem(req, 'POST /payments/transactions/:id/confirm-receipt', (t) =>
            svc.tx.confirmBankTransfer(t, { ...req.body, paymentId: req.params.id }),
          );
          const p = await svc.view.payment(req.ctx, req.params.id);
          setVersion(reply, p.version);
          return p;
        },
      );
      app.post(
        '/payments/transactions/:id/cancel-expected',
        { schema: { tags, params: idParams, body: cancelBankTransferInput, response: { 200: payment } } },
        async (req, reply) => {
          await idem(req, 'POST /payments/transactions/:id/cancel-expected', (t) =>
            svc.tx.cancelBankTransfer(t, req.params.id, req.body.reason),
          );
          const p = await svc.view.payment(req.ctx, req.params.id);
          setVersion(reply, p.version);
          return p;
        },
      );
      app.post(
        '/payments/transactions/:id/check',
        { schema: { tags, params: idParams, response: { 200: payment, 202: payment } } },
        async (req, reply) => {
          await svc.checkNow(req.ctx, { type: 'payment', id: req.params.id });
          const p = await svc.view.payment(req.ctx, req.params.id);
          setVersion(reply, p.version);
          return reply
            .status(
              p.status.payment === 'pending_verification' || p.status.payment === 'processing' ? 202 : 200,
            )
            .send(p);
        },
      );
      app.get('/payments/status-by-ref', { schema: { tags, querystring: refQuery } }, async (req) =>
        tx(req, (t) => svc.tx.getPaymentStatus(t, { type: req.query.refType, id: req.query.refId })),
      );
      app.post('/payments/adjustments', { schema: { tags, body: adjustmentInput } }, async (req, reply) => {
        const r = await idem(req, 'POST /payments/adjustments', (t, key) =>
          svc.tx.adjustRecordedPayment(t, { ...req.body, businessKey: key }),
        );
        return reply.status(201).send({
          id: r.body.id,
          paymentId: r.body.payment_id,
          amount: { amountMinor: Number(r.body.amount_minor), currency: r.body.currency },
          reason: r.body.reason,
          ledgerPostingId: r.body.ledger_posting_id,
          createdAt: new Date(r.body.created_at).toISOString(),
        });
      });

      // ───────────── refunds ─────────────
      app.post(
        '/payments/refunds',
        { schema: { tags, body: refundInput, response: { 201: refund, 202: refund } } },
        async (req, reply) => {
          const r = await idem(req, 'POST /payments/refunds', (t, key) =>
            svc.tx.refund(t, { ...req.body, businessKey: key }),
          );
          await svc.settle(req.ctx, { type: 'refund', id: r.body.id }, { verifyPending: r.replayed });
          return replyRefund(reply, await svc.view.refund(req.ctx, r.body.id));
        },
      );
      app.post(
        '/payments/refunds/recorded',
        { schema: { tags, body: recordRefundInput, response: { 201: refund } } },
        async (req, reply) => {
          const r = await idem(req, 'POST /payments/refunds/recorded', (t, key) =>
            svc.tx.recordRefund(t, { ...req.body, businessKey: key }),
          );
          return replyRefund(reply, await svc.view.refund(req.ctx, r.body.id));
        },
      );
      app.get(
        '/payments/refunds/:id',
        { schema: { tags, params: idParams, response: { 200: refund } } },
        async (req, reply) => {
          const r = await tx(req, (t) => svc.tx.getRefund(t, req.params.id));
          setVersion(reply, r.version);
          return r;
        },
      );
      app.post(
        '/payments/refunds/:id/check',
        { schema: { tags, params: idParams, response: { 200: refund, 202: refund } } },
        async (req, reply) => {
          await svc.checkNow(req.ctx, { type: 'refund', id: req.params.id });
          const r = await svc.view.refund(req.ctx, req.params.id);
          setVersion(reply, r.version);
          return reply
            .status(
              r.status.refund === 'pending_verification' || r.status.refund === 'processing' ? 202 : 200,
            )
            .send(r);
        },
      );

      // ───────────── payment requests (links) ─────────────
      app.post(
        '/payments/requests',
        { schema: { tags, body: paymentRequestInput, response: { 201: paymentRequest } } },
        async (req, reply) => {
          const r = await idem(req, 'POST /payments/requests', (t, key) =>
            svc.tx.createPaymentRequest(t, { ...req.body, businessKey: key }),
          );
          await svc.ensurePaymentLink(req.ctx, r.body.id);
          const view = await svc.view.request(req.ctx, r.body.id);
          setVersion(reply, view.version);
          return reply.status(201).send(view);
        },
      );
      app.get(
        '/payments/requests',
        {
          schema: {
            tags,
            querystring: refQuery,
            response: { 200: z.object({ items: z.array(paymentRequest) }) },
          },
        },
        async (req) => ({
          items: await tx(req, (t) =>
            svc.tx.listPaymentRequests(t, { type: req.query.refType, id: req.query.refId }),
          ),
        }),
      );
      app.get(
        '/payments/requests/:id',
        { schema: { tags, params: idParams, response: { 200: paymentRequest } } },
        async (req, reply) => {
          const r = await tx(req, (t) => svc.tx.getPaymentRequest(t, req.params.id));
          setVersion(reply, r.version);
          return r;
        },
      );
      app.post(
        '/payments/requests/:id/cancel',
        { schema: { tags, params: idParams, body: cancelRequestInput, response: { 200: paymentRequest } } },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const r = await tx(req, (t) =>
            svc.tx.cancelPaymentRequest(t, req.params.id, expected, req.body.reason),
          );
          setVersion(reply, r.version);
          return r;
        },
      );
      // R4-P2-2: staff stopped a retired link in the provider dashboard (the provider never confirmed it): record it with
      // the reason, close the owned exception, and let the replacement link go out.
      app.post(
        '/payments/requests/:id/link-stopped',
        { schema: { tags, params: idParams, body: cancelRequestInput, response: { 200: paymentRequest } } },
        async (req) => {
          await idem(req, 'POST /payments/requests/:id/link-stopped', async (t) => {
            await svc.tx.confirmLinkStopped(t, { requestId: req.params.id, reason: req.body.reason });
            return { ok: true };
          });
          return svc.view.request(req.ctx, req.params.id);
        },
      );
      app.post(
        '/payments/requests/:id/simulate-payment',
        {
          schema: {
            tags: ['Payments simulator'],
            params: idParams,
            body: z.object({ amountMinor: z.number().int().positive().optional() }).strict(),
            response: { 200: paymentRequest },
          },
        },
        async (req) => {
          requireIdempotencyKey(req);
          const r = await tx(req, (t) => svc.tx.getPaymentRequest(t, req.params.id));
          await svc.simulateRequestPayment(req.ctx, req.params.id, req.body.amountMinor);
          await svc.deliverSimulatorWebhooks(req.ctx, r.accountId);
          return svc.view.request(req.ctx, req.params.id);
        },
      );

      // ───────────── virtual cards ─────────────
      app.post(
        '/payments/virtual-cards',
        { schema: { tags, body: virtualCardInput, response: { 201: virtualCard } } },
        async (req, reply) => {
          const r = await idem(req, 'POST /payments/virtual-cards', (t) =>
            svc.tx.registerVirtualCard(t, req.body),
          );
          setVersion(reply, r.body.version);
          return reply.status(201).send(r.body);
        },
      );
      app.get(
        '/payments/virtual-cards/:id',
        { schema: { tags, params: idParams, response: { 200: virtualCard } } },
        async (req) => tx(req, (t) => svc.tx.getVirtualCard(t, req.params.id)),
      );
      app.post('/payments/virtual-cards/run-due', { schema: { tags, body: propertyQuery } }, async (req) =>
        svc.runDueVirtualCards(req.ctx, { propertyId: req.body.propertyId }),
      );

      // ───────────── disputes ─────────────
      app.get(
        '/payments/disputes',
        {
          schema: {
            tags,
            querystring: propertyQuery,
            response: { 200: z.object({ items: z.array(dispute) }) },
          },
        },
        async (req) => ({ items: await tx(req, (t) => svc.tx.listDisputes(t, req.query.propertyId)) }),
      );
      app.get(
        '/payments/disputes/:id',
        { schema: { tags, params: idParams, response: { 200: dispute } } },
        async (req, reply) => {
          const r = await tx(req, (t) => svc.tx.getDispute(t, req.params.id));
          setVersion(reply, r.version);
          return r;
        },
      );
      app.patch(
        '/payments/disputes/:id/evidence',
        { schema: { tags, params: idParams, body: evidenceUpdate, response: { 200: dispute } } },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const r = await tx(req, (t) =>
            svc.tx.updateDisputeEvidence(t, req.params.id, expected, req.body.items),
          );
          setVersion(reply, r.version);
          return r;
        },
      );

      // ───────────── payouts and statements ─────────────
      app.post(
        '/payments/payouts',
        { schema: { tags, body: payoutInput, response: { 201: payout } } },
        async (req, reply) => {
          const r = await idem(req, 'POST /payments/payouts', (t) => svc.tx.recordPayout(t, req.body));
          return reply.status(201).send(r.body);
        },
      );
      app.get(
        '/payments/payouts',
        {
          schema: {
            tags,
            querystring: z.object({ accountId: z.uuid().optional() }),
            response: { 200: z.object({ items: z.array(payout) }) },
          },
        },
        async (req) => ({ items: await tx(req, (t) => svc.tx.listPayouts(t, req.query.accountId)) }),
      );
      app.post(
        '/payments/statements',
        { schema: { tags, body: statementImportInput, response: { 201: statementResult } } },
        async (req, reply) => {
          const r = await idem(req, 'POST /payments/statements', (t) => svc.tx.importStatement(t, req.body));
          return reply.status(201).send(r.body);
        },
      );

      // ───────────── exceptions, status, reconciliation ─────────────
      app.get(
        '/payments/exceptions',
        {
          schema: {
            tags,
            querystring: z.object({
              propertyId: z.uuid().optional(),
              status: z.enum(['open', 'resolved']).optional(),
            }),
            response: { 200: z.object({ items: z.array(paymentException) }) },
          },
        },
        async (req) => ({
          items: await tx(req, (t) =>
            svc.tx.listExceptions(t, {
              ...(req.query.propertyId ? { propertyId: req.query.propertyId } : {}),
              ...(req.query.status ? { status: req.query.status } : {}),
            }),
          ),
        }),
      );
      app.post(
        '/payments/exceptions/:id/resolve',
        {
          schema: {
            tags,
            params: idParams,
            body: resolveExceptionInput,
            response: { 200: paymentException },
          },
        },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const r = await tx(req, (t) =>
            svc.tx.resolveException(t, req.params.id, expected, req.body.resolution),
          );
          setVersion(reply, r.version);
          return r;
        },
      );
      app.get(
        '/payments/status',
        { schema: { tags, querystring: propertyQuery, response: { 200: paymentsStatus } } },
        async (req) => tx(req, (t) => svc.tx.paymentsStatus(t, req.query.propertyId)),
      );
      app.post(
        '/payments/reconciliation/run',
        {
          schema: {
            tags,
            body: z.object({ propertyId: z.uuid().optional() }).strict(),
            response: { 200: reconciliationResult },
          },
        },
        async (req) => {
          const propertyId = req.body.propertyId;
          if (propertyId) requirePermission(req.ctx, 'payments.reconciliation.manage', { propertyId });
          else if (req.ctx.authz.propertyScope('payments.reconciliation.manage') !== 'all') {
            throw new ForbiddenError('payments.reconciliation.manage');
          }
          return svc.runReconciliation(req.ctx, propertyId ? { propertyId } : {});
        },
      );

      // ───────────── provider webhooks (public; signature-verified; raw body) ─────────────
      await app.register(async (scope) => {
        scope.removeContentTypeParser(['application/json']);
        scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) =>
          done(null, body),
        );
        scope.post(
          '/payments/webhooks/stripe',
          { config: { public: true }, schema: { tags: ['Payments webhooks'] } },
          async (req, reply) => {
            const raw = typeof req.body === 'string' ? req.body : '';
            const headers: Record<string, string | undefined> = {};
            for (const [k, v] of Object.entries(req.headers))
              headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
            const r = await svc.receiveStripeWebhook(raw, headers);
            return reply.status(200).send({ received: true, ...r });
          },
        );
      });
    },
  };
}
