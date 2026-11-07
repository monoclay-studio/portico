import { type PorticoDatabase, runIdempotent, type TxContext, withTenantTx } from '@portico/db';
import { type HttpModule, idParams, requireIdempotencyKey, requireIfMatch, setVersion } from '@portico/http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  account,
  accountInput,
  adjustmentInput,
  agingReport,
  allowanceInstance,
  applyDepositsInput,
  billingRule,
  billingRuleInput,
  billingRuleUpdate,
  cashierSummary,
  chargeCode,
  chargeCodeInput,
  chargeCodeUpdate,
  closeSessionInput,
  collectPaymentInput,
  creditNoteInput,
  dailyRevenue,
  depositSummary,
  entryResult,
  financeException,
  fiscalDocument,
  fiscalSeries,
  fiscalSeriesInput,
  folio,
  folioDetail,
  folioOwnerType,
  forfeitDepositInput,
  fxRate,
  fxRateInput,
  integrityReport,
  issueInvoiceInput,
  moneyInput,
  openFolioInput,
  openingDepositsInput,
  openingImportReport,
  openSessionInput,
  paidOutInput,
  postChargeInput,
  postChargeResult,
  previewInput,
  previewResult,
  receivablesAccount,
  receivablesAccountInput,
  receivablesAccountUpdate,
  receivablesPaymentInput,
  ruleOwnerType,
  transferInput,
  transferToReceivablesInput,
  trialBalance,
  unbalancedItem,
} from './contracts';
import type { FinanceService } from './service';

const uuid = z.uuid();
const date = z.iso.date();
const tags = (t: string) => [t];

export function financeHttp(deps: { database: PorticoDatabase; finance: FinanceService }): HttpModule {
  const { database, finance: svc } = deps;
  const read = <T>(req: FastifyRequest, fn: (tx: TxContext) => Promise<T>) =>
    withTenantTx(database, req.ctx, fn);
  /** Idempotent command: the Idempotency-Key is stored with the response and doubles as the business key. */
  const command = async <T>(
    req: FastifyRequest,
    reply: FastifyReply,
    scope: string,
    fn: (tx: TxContext, key: string) => Promise<T>,
    status = 201,
  ): Promise<T> => {
    const key = requireIdempotencyKey(req);
    const res = await runIdempotent(
      database,
      req.ctx,
      { scope, key, request: { params: req.params, body: req.body } },
      async (tx) => ({
        status,
        body: await fn(tx, `http:${key}`),
      }),
    );
    reply.status(res.status);
    if (res.replayed) reply.header('Idempotent-Replayed', 'true');
    return res.body;
  };
  const versioned = <T extends { version: number }>(reply: FastifyReply, body: T): T => {
    setVersion(reply, body.version);
    return body;
  };

  return {
    name: 'finance',
    routes(app) {
      // ───────────── Chart of accounts, charge codes, FX ─────────────
      app.get(
        '/finance/accounts',
        {
          schema: {
            tags: tags('Finance setup'),
            querystring: z.object({ legalEntityId: uuid }),
            response: { 200: z.object({ items: z.array(account) }) },
          },
        },
        async (req) => ({
          items: await read(req, (tx) => svc.listAccounts(tx, req.query.legalEntityId)),
        }),
      );
      app.post(
        '/finance/accounts',
        { schema: { tags: tags('Finance setup'), body: accountInput, response: { 201: account } } },
        (req, reply) =>
          command(req, reply, 'POST /finance/accounts', (tx) => svc.createAccount(tx, req.body)),
      );
      app.get(
        '/finance/charge-codes',
        {
          schema: {
            tags: tags('Finance setup'),
            querystring: z.object({ propertyId: uuid }),
            response: { 200: z.object({ items: z.array(chargeCode) }) },
          },
        },
        async (req) => ({
          items: await read(req, (tx) => svc.listChargeCodes(tx, req.query.propertyId)),
        }),
      );
      app.post(
        '/finance/charge-codes',
        { schema: { tags: tags('Finance setup'), body: chargeCodeInput, response: { 201: chargeCode } } },
        async (req, reply) =>
          versioned(
            reply,
            await command(req, reply, 'POST /finance/charge-codes', (tx) =>
              svc.createChargeCode(tx, req.body),
            ),
          ),
      );
      app.patch(
        '/finance/charge-codes/:id',
        {
          schema: {
            tags: tags('Finance setup'),
            params: idParams,
            body: chargeCodeUpdate,
            response: { 200: chargeCode },
          },
        },
        async (req, reply) => {
          const v = requireIfMatch(req);
          return versioned(
            reply,
            await read(req, (tx) => svc.updateChargeCode(tx, req.params.id, v, req.body)),
          );
        },
      );
      app.post(
        '/finance/fx-rates',
        { schema: { tags: tags('Finance setup'), body: fxRateInput, response: { 201: fxRate } } },
        (req, reply) => command(req, reply, 'POST /finance/fx-rates', (tx) => svc.recordFxRate(tx, req.body)),
      );
      app.get(
        '/finance/fx-rates',
        {
          schema: {
            tags: tags('Finance setup'),
            querystring: z.object({ legalEntityId: uuid, from: date.optional() }),
            response: { 200: z.object({ items: z.array(fxRate) }) },
          },
        },
        async (req) => ({
          items: await read(req, (tx) => svc.listFxRates(tx, req.query.legalEntityId, req.query.from)),
        }),
      );

      // ───────────── Folios ─────────────
      app.post(
        '/finance/folios',
        { schema: { tags: tags('Folios'), body: openFolioInput, response: { 201: folioDetail } } },
        async (req, reply) => {
          const res = await command(req, reply, 'POST /finance/folios', async (tx) =>
            svc.getFolio(tx, (await svc.openFolio(tx, req.body)).folioId),
          );
          return versioned(reply, res);
        },
      );
      app.get(
        '/finance/folios',
        {
          schema: {
            tags: tags('Folios'),
            querystring: z.object({ ownerType: folioOwnerType, ownerId: uuid }),
            response: { 200: z.object({ items: z.array(folio) }) },
          },
        },
        async (req) => ({
          items: await read(req, (tx) =>
            svc.listFolios(tx, { owner: { type: req.query.ownerType, id: req.query.ownerId } }),
          ),
        }),
      );
      app.get(
        '/finance/folios/:id',
        { schema: { tags: tags('Folios'), params: idParams, response: { 200: folioDetail } } },
        async (req, reply) => versioned(reply, await read(req, (tx) => svc.getFolio(tx, req.params.id))),
      );
      for (const op of ['settle', 'close'] as const) {
        app.post(
          `/finance/folios/:id/${op}`,
          { schema: { tags: tags('Folios'), params: idParams, response: { 200: folio } } },
          async (req, reply) => {
            const v = requireIfMatch(req);
            return versioned(
              reply,
              await read(req, (tx) =>
                op === 'settle'
                  ? svc.settleFolio(tx, req.params.id, v)
                  : svc.closeFolio(tx, req.params.id, v),
              ),
            );
          },
        );
      }
      app.post(
        '/finance/folios/:id/void',
        {
          schema: {
            tags: tags('Folios'),
            params: idParams,
            body: z.object({ reason: z.string().min(1).max(500) }),
            response: { 200: folio },
          },
        },
        async (req, reply) => {
          const v = requireIfMatch(req);
          return versioned(
            reply,
            await read(req, (tx) => svc.voidFolio(tx, req.params.id, v, req.body.reason)),
          );
        },
      );
      app.post(
        '/finance/folios/:id/payments',
        {
          schema: {
            tags: tags('Folios'),
            params: idParams,
            body: collectPaymentInput,
            response: {
              201: z.object({
                entries: z.array(entryResult.extend({ postingId: uuid })),
                balance: moneyInput,
              }),
            },
          },
        },
        (req, reply) =>
          command(req, reply, 'POST /finance/folios/:id/payments', (tx, key) =>
            svc.collectPayment(tx, {
              folioId: req.params.id,
              tenders: req.body.tenders,
              idempotencyKey: key,
            }),
          ),
      );
      app.post(
        '/finance/folios/:id/invoices',
        {
          schema: {
            tags: tags('Invoices'),
            params: idParams,
            body: issueInvoiceInput,
            response: { 201: fiscalDocument },
          },
        },
        (req, reply) =>
          command(req, reply, 'POST /finance/folios/:id/invoices', (tx, key) =>
            svc.issueInvoice(tx, {
              folioId: req.params.id,
              ...(req.body.seriesId ? { seriesId: req.body.seriesId } : {}),
              ...(req.body.payerDetails ? { payerDetails: req.body.payerDetails } : {}),
              idempotencyKey: key,
            }),
          ),
      );
      app.get(
        '/finance/folios/:id/documents',
        {
          schema: {
            tags: tags('Invoices'),
            params: idParams,
            response: { 200: z.object({ items: z.array(fiscalDocument) }) },
          },
        },
        async (req) => ({
          items: await read(req, (tx) => svc.listDocuments(tx, req.params.id)),
        }),
      );
      app.post(
        '/finance/folios/:id/transfer-to-receivables',
        {
          schema: {
            tags: tags('Receivables'),
            params: idParams,
            body: transferToReceivablesInput,
            response: {
              201: z.object({
                entryId: uuid,
                itemId: uuid,
                amount: moneyInput,
                creditWarning: z.string().nullable(),
                replayed: z.boolean(),
              }),
            },
          },
        },
        (req, reply) =>
          command(req, reply, 'POST /finance/folios/:id/transfer-to-receivables', (tx, key) =>
            svc.transferToReceivables(tx, {
              folioId: req.params.id,
              receivablesAccountId: req.body.receivablesAccountId,
              ...(req.body.overrideCreditLimit ? { overrideCreditLimit: true } : {}),
              idempotencyKey: key,
            }),
          ),
      );

      // ───────────── Postings ─────────────
      app.post(
        '/finance/charges',
        { schema: { tags: tags('Postings'), body: postChargeInput, response: { 201: postChargeResult } } },
        (req, reply) =>
          command(req, reply, 'POST /finance/charges', async (tx, key) => {
            const b = req.body;
            const serviceDate = b.serviceDate ?? (await svc.getBusinessDateFor(tx, b.propertyId));
            return svc.postCharge(tx, {
              ...b,
              serviceDate,
              sourceRef: b.sourceRef ?? { type: 'manual_posting', id: key },
              idempotencyKey: key,
            });
          }),
      );
      app.post(
        '/finance/postings/:id/adjustments',
        {
          schema: {
            tags: tags('Postings'),
            params: idParams,
            body: adjustmentInput,
            response: { 201: entryResult },
          },
        },
        (req, reply) =>
          command(req, reply, 'POST /finance/postings/:id/adjustments', (tx, key) =>
            svc.adjustPosting(tx, { postingId: req.params.id, ...req.body, idempotencyKey: key }),
          ),
      );
      app.post(
        '/finance/transfers',
        { schema: { tags: tags('Postings'), body: transferInput, response: { 201: entryResult } } },
        (req, reply) =>
          command(req, reply, 'POST /finance/transfers', (tx, key) =>
            svc.transferPostings(tx, { ...req.body, idempotencyKey: key }),
          ),
      );

      // ───────────── Billing rules ─────────────
      app.get(
        '/finance/billing-rules',
        {
          schema: {
            tags: tags('Billing rules'),
            querystring: z.object({ ownerType: ruleOwnerType, ownerId: uuid }),
            response: { 200: z.object({ items: z.array(billingRule) }) },
          },
        },
        async (req) => ({
          items: await read(req, (tx) =>
            svc.listBillingRules(tx, { type: req.query.ownerType, id: req.query.ownerId }),
          ),
        }),
      );
      app.post(
        '/finance/billing-rules',
        { schema: { tags: tags('Billing rules'), body: billingRuleInput, response: { 201: billingRule } } },
        async (req, reply) =>
          versioned(
            reply,
            await command(req, reply, 'POST /finance/billing-rules', (tx) =>
              svc.createBillingRule(tx, req.body),
            ),
          ),
      );
      app.patch(
        '/finance/billing-rules/:id',
        {
          schema: {
            tags: tags('Billing rules'),
            params: idParams,
            body: billingRuleUpdate,
            response: { 200: billingRule },
          },
        },
        async (req, reply) => {
          const v = requireIfMatch(req);
          return versioned(
            reply,
            await read(req, (tx) => svc.updateBillingRule(tx, req.params.id, v, req.body)),
          );
        },
      );
      app.post(
        '/finance/billing-rules/:id/deactivate',
        { schema: { tags: tags('Billing rules'), params: idParams, response: { 200: billingRule } } },
        async (req, reply) => {
          const v = requireIfMatch(req);
          return versioned(reply, await read(req, (tx) => svc.deactivateBillingRule(tx, req.params.id, v)));
        },
      );
      app.post(
        '/finance/billing-rules/preview',
        { schema: { tags: tags('Billing rules'), body: previewInput, response: { 200: previewResult } } },
        async (req) => read(req, (tx) => svc.previewRouting(tx, req.body)),
      );

      // ───────────── Deposits & allowances ─────────────
      const bookingParams = z.object({ bookingId: uuid });
      app.get(
        '/finance/bookings/:bookingId/deposits',
        {
          schema: {
            tags: tags('Deposits'),
            params: bookingParams,
            response: { 200: depositSummary.nullable() },
          },
        },
        async (req) => read(req, (tx) => svc.getDeposits(tx, req.params.bookingId)),
      );
      app.post(
        '/finance/bookings/:bookingId/deposits/apply',
        {
          schema: {
            tags: tags('Deposits'),
            params: bookingParams,
            body: applyDepositsInput,
            response: {
              201: z.object({
                entryId: uuid.nullable(),
                applied: moneyInput,
                postingIds: z.array(uuid),
                replayed: z.boolean(),
              }),
            },
          },
        },
        (req, reply) =>
          command(req, reply, 'POST /finance/bookings/:bookingId/deposits/apply', (tx, key) =>
            svc.applyDeposits(tx, {
              bookingId: req.params.bookingId,
              toFolioId: req.body.toFolioId,
              ...(req.body.amountMinor ? { amountMinor: req.body.amountMinor } : {}),
              idempotencyKey: key,
            }),
          ),
      );
      app.post(
        '/finance/bookings/:bookingId/deposits/forfeit',
        {
          schema: {
            tags: tags('Deposits'),
            params: bookingParams,
            body: forfeitDepositInput,
            response: { 201: z.object({ entryId: uuid, balance: moneyInput, replayed: z.boolean() }) },
          },
        },
        (req, reply) =>
          command(req, reply, 'POST /finance/bookings/:bookingId/deposits/forfeit', (tx, key) =>
            svc.forfeitDeposit(tx, { bookingId: req.params.bookingId, ...req.body, idempotencyKey: key }),
          ),
      );
      app.get(
        '/finance/stays/:stayId/allowances',
        {
          schema: {
            tags: tags('Deposits'),
            params: z.object({ stayId: uuid }),
            response: { 200: z.object({ items: z.array(allowanceInstance) }) },
          },
        },
        async (req) => ({
          items: await read(req, (tx) => svc.listAllowances(tx, req.params.stayId)),
        }),
      );
      app.post(
        '/finance/opening-balances/deposits',
        {
          schema: {
            tags: tags('Migration'),
            body: openingDepositsInput,
            response: { 201: openingImportReport },
          },
        },
        (req, reply) =>
          command(req, reply, 'POST /finance/opening-balances/deposits', (tx, key) =>
            svc.importOpeningDeposits(tx, { ...req.body, idempotencyKey: key }),
          ),
      );

      // ───────────── Fiscal documents ─────────────
      app.get(
        '/finance/documents/:id',
        { schema: { tags: tags('Invoices'), params: idParams, response: { 200: fiscalDocument } } },
        async (req) => read(req, (tx) => svc.getDocument(tx, req.params.id)),
      );
      app.get(
        '/finance/documents/:id/pdf',
        { schema: { tags: tags('Invoices'), params: idParams } },
        async (req, reply) => {
          const { filename, pdf } = await read(req, (tx) => svc.renderDocumentPdf(tx, req.params.id));
          return reply
            .type('application/pdf')
            .header('Content-Disposition', `inline; filename="${filename}"`)
            .send(pdf);
        },
      );
      app.post(
        '/finance/documents/:id/credit-notes',
        {
          schema: {
            tags: tags('Invoices'),
            params: idParams,
            body: creditNoteInput,
            response: { 201: fiscalDocument },
          },
        },
        (req, reply) =>
          command(req, reply, 'POST /finance/documents/:id/credit-notes', (tx, key) =>
            svc.issueCreditNote(tx, { invoiceId: req.params.id, ...req.body, idempotencyKey: key }),
          ),
      );
      app.get(
        '/finance/fiscal-series',
        {
          schema: {
            tags: tags('Invoices'),
            querystring: z.object({ legalEntityId: uuid }),
            response: { 200: z.object({ items: z.array(fiscalSeries) }) },
          },
        },
        async (req) => ({
          items: await read(req, (tx) => svc.listFiscalSeries(tx, req.query.legalEntityId)),
        }),
      );
      app.post(
        '/finance/fiscal-series',
        { schema: { tags: tags('Invoices'), body: fiscalSeriesInput, response: { 201: fiscalSeries } } },
        (req, reply) =>
          command(req, reply, 'POST /finance/fiscal-series', (tx) => svc.createFiscalSeries(tx, req.body)),
      );
      app.get(
        '/finance/fiscal-ledger/verify',
        {
          schema: {
            tags: tags('Invoices'),
            querystring: z.object({ legalEntityId: uuid }),
            response: {
              200: z.object({
                ok: z.boolean(),
                documents: z.number().int(),
                brokenAt: z.number().int().nullable(),
                reason: z.string().nullable(),
                gaps: z.array(z.object({ seriesId: uuid, missing: z.array(z.number().int()) })),
              }),
            },
          },
        },
        async (req) => read(req, (tx) => svc.verifyFiscalLedger(tx, req.query.legalEntityId)),
      );

      // ───────────── Receivables ─────────────
      app.post(
        '/finance/receivables-accounts',
        {
          schema: {
            tags: tags('Receivables'),
            body: receivablesAccountInput,
            response: { 201: receivablesAccount },
          },
        },
        async (req, reply) =>
          versioned(
            reply,
            await command(req, reply, 'POST /finance/receivables-accounts', (tx) =>
              svc.createReceivablesAccount(tx, req.body),
            ),
          ),
      );
      app.get(
        '/finance/receivables-accounts',
        {
          schema: {
            tags: tags('Receivables'),
            querystring: z.object({ legalEntityId: uuid }),
            response: { 200: z.object({ items: z.array(receivablesAccount) }) },
          },
        },
        async (req) => ({
          items: await read(req, (tx) => svc.listReceivablesAccounts(tx, req.query.legalEntityId)),
        }),
      );
      app.get(
        '/finance/receivables-accounts/:id',
        { schema: { tags: tags('Receivables'), params: idParams, response: { 200: receivablesAccount } } },
        async (req, reply) =>
          versioned(reply, await read(req, (tx) => svc.getReceivablesAccount(tx, req.params.id))),
      );
      app.patch(
        '/finance/receivables-accounts/:id',
        {
          schema: {
            tags: tags('Receivables'),
            params: idParams,
            body: receivablesAccountUpdate,
            response: { 200: receivablesAccount },
          },
        },
        async (req, reply) => {
          const v = requireIfMatch(req);
          return versioned(
            reply,
            await read(req, (tx) => svc.updateReceivablesAccount(tx, req.params.id, v, req.body)),
          );
        },
      );
      app.get(
        '/finance/receivables-accounts/:id/items',
        {
          schema: {
            tags: tags('Receivables'),
            params: idParams,
            response: { 200: z.object({ items: z.array(z.record(z.string(), z.unknown())) }) },
          },
        },
        async (req) => ({
          items: await read(req, (tx) => svc.listReceivablesItems(tx, req.params.id)),
        }),
      );
      app.post(
        '/finance/receivables-accounts/:id/payments',
        {
          schema: {
            tags: tags('Receivables'),
            params: idParams,
            body: receivablesPaymentInput,
            response: {
              201: z.object({ entryId: uuid, itemId: uuid, unallocated: moneyInput, replayed: z.boolean() }),
            },
          },
        },
        (req, reply) =>
          command(req, reply, 'POST /finance/receivables-accounts/:id/payments', (tx, key) =>
            svc.recordReceivablesPayment(tx, { accountId: req.params.id, ...req.body, idempotencyKey: key }),
          ),
      );
      app.post(
        '/finance/receivables-accounts/:id/allocations',
        {
          schema: {
            tags: tags('Receivables'),
            params: idParams,
            body: z.object({
              paymentItemId: uuid,
              allocations: z
                .array(z.object({ itemId: uuid, amountMinor: z.number().int().positive() }))
                .min(1)
                .max(200),
            }),
            response: { 200: z.object({ unallocated: z.number().int() }) },
          },
        },
        async (req) =>
          read(req, (tx) => svc.allocateReceivablesPayment(tx, { accountId: req.params.id, ...req.body })),
      );
      app.get(
        '/finance/receivables/aging',
        {
          schema: {
            tags: tags('Receivables'),
            querystring: z.object({ legalEntityId: uuid, asOf: date, accountId: uuid.optional() }),
            response: { 200: agingReport },
          },
        },
        async (req) =>
          read(req, (tx) =>
            svc.receivablesAging(tx, {
              legalEntityId: req.query.legalEntityId,
              asOf: req.query.asOf,
              ...(req.query.accountId ? { accountId: req.query.accountId } : {}),
            }),
          ),
      );

      // ───────────── Cashier ─────────────
      app.post(
        '/finance/cashier-sessions',
        { schema: { tags: tags('Cashier'), body: openSessionInput, response: { 201: cashierSummary } } },
        async (req, reply) =>
          versioned(
            reply,
            await command(req, reply, 'POST /finance/cashier-sessions', (tx) =>
              svc.openCashierSession(tx, req.body),
            ),
          ),
      );
      app.get(
        '/finance/cashier-sessions',
        {
          schema: {
            tags: tags('Cashier'),
            querystring: z.object({ propertyId: uuid }),
            response: { 200: z.object({ items: z.array(cashierSummary) }) },
          },
        },
        async (req) => ({
          items: await read(req, (tx) => svc.listOpenCashierSessions(tx, req.query.propertyId)),
        }),
      );
      app.get(
        '/finance/cashier-sessions/:id',
        { schema: { tags: tags('Cashier'), params: idParams, response: { 200: cashierSummary } } },
        async (req, reply) =>
          versioned(reply, await read(req, (tx) => svc.getCashierSession(tx, req.params.id))),
      );
      app.post(
        '/finance/cashier-sessions/:id/close',
        {
          schema: {
            tags: tags('Cashier'),
            params: idParams,
            body: closeSessionInput,
            response: { 200: cashierSummary },
          },
        },
        async (req, reply) => {
          const v = requireIfMatch(req);
          return versioned(
            reply,
            await read(req, (tx) =>
              svc.closeCashierSession(tx, {
                sessionId: req.params.id,
                expectedVersion: v,
                counted: req.body.counted,
                ...(req.body.note ? { note: req.body.note } : {}),
              }),
            ),
          );
        },
      );
      app.post(
        '/finance/cashier-sessions/:id/paid-outs',
        {
          schema: {
            tags: tags('Cashier'),
            params: idParams,
            body: paidOutInput,
            response: { 201: z.object({ entryId: uuid, postingIds: z.array(uuid), replayed: z.boolean() }) },
          },
        },
        (req, reply) =>
          command(req, reply, 'POST /finance/cashier-sessions/:id/paid-outs', (tx, key) =>
            svc.recordPaidOut(tx, { sessionId: req.params.id, ...req.body, idempotencyKey: key }),
          ),
      );

      // ───────────── Reports & checks ─────────────
      app.get(
        '/finance/trial-balance',
        {
          schema: {
            tags: tags('Finance reports'),
            querystring: z.object({ legalEntityId: uuid, asOf: date.optional() }),
            response: { 200: trialBalance },
          },
        },
        async (req) =>
          read(req, (tx) =>
            svc.trialBalance(tx, {
              legalEntityId: req.query.legalEntityId,
              ...(req.query.asOf ? { asOf: req.query.asOf } : {}),
            }),
          ),
      );
      app.get(
        '/finance/integrity',
        {
          schema: {
            tags: tags('Finance reports'),
            querystring: z.object({ legalEntityId: uuid }),
            response: { 200: integrityReport },
          },
        },
        async (req) => read(req, (tx) => svc.integrityReport(tx, req.query.legalEntityId)),
      );
      app.get(
        '/finance/reports/daily-revenue',
        {
          schema: {
            tags: tags('Finance reports'),
            querystring: z.object({ propertyId: uuid, businessDate: date }),
            response: { 200: dailyRevenue },
          },
        },
        async (req) => read(req, (tx) => svc.dailyRevenue(tx, req.query)),
      );
      app.get(
        '/finance/reports/green-tax',
        {
          schema: {
            tags: tags('Finance reports'),
            querystring: z.object({ legalEntityId: uuid, month: z.string().regex(/^\d{4}-\d{2}$/) }),
            response: {
              200: z.object({
                legalEntityId: uuid,
                month: z.string(),
                currency: z.string(),
                rows: z.array(
                  z.object({
                    propertyId: uuid,
                    rateCategory: z.string(),
                    rate: z.string().nullable(),
                    guestDays: z.number(),
                    exemptGuestDays: z.number(),
                    amountMinor: z.number().int(),
                  }),
                ),
                totalMinor: z.number().int(),
              }),
            },
          },
        },
        async (req) => read(req, (tx) => svc.greenTaxReport(tx, req.query)),
      );
      app.get(
        '/finance/day-close-checks',
        {
          schema: {
            tags: tags('Finance reports'),
            querystring: z.object({ propertyId: uuid, businessDate: date }),
            response: { 200: z.object({ items: z.array(unbalancedItem) }) },
          },
        },
        async (req) => ({
          items: await read(req, (tx) => svc.getUnbalancedItems(tx, req.query)),
        }),
      );
      app.get(
        '/finance/exceptions',
        {
          schema: {
            tags: tags('Finance reports'),
            querystring: z.object({ propertyId: uuid, status: z.enum(['open', 'resolved']).optional() }),
            response: { 200: z.object({ items: z.array(financeException) }) },
          },
        },
        async (req) => ({
          items: await read(req, (tx) =>
            svc.listExceptions(tx, {
              propertyId: req.query.propertyId,
              ...(req.query.status ? { status: req.query.status } : {}),
            }),
          ),
        }),
      );
      app.post(
        '/finance/exceptions/:id/resolve',
        {
          schema: {
            tags: tags('Finance reports'),
            params: idParams,
            body: z.object({ resolution: z.string().min(1).max(1000) }),
            response: { 204: z.null() },
          },
        },
        async (req, reply) => {
          const v = requireIfMatch(req);
          await read(req, (tx) =>
            svc.resolveException(tx, {
              id: req.params.id,
              expectedVersion: v,
              resolution: req.body.resolution,
            }),
          );
          return reply.status(204).send(null);
        },
      );
    },
  };
}
