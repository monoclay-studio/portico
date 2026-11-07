import { type PorticoDatabase, runIdempotent, withTenantTx } from '@portico/db';
import { type HttpModule, idParams, requireIdempotencyKey, requireIfMatch, setVersion } from '@portico/http';
import { requirePermission } from '@portico/kernel';
import { z } from 'zod';
import {
  calendarQuery,
  computeTaxesInput,
  inclusion,
  inclusionInput,
  packageInput,
  packageUpdate,
  pkg,
  policy,
  policyInput,
  policyUpdate,
  priceBulkUpdate,
  priceCell,
  priceChangeRequest,
  priceHistoryEntry,
  pricePreview,
  promotion,
  promotionInput,
  promotionUpdate,
  propertyQuery,
  quoteRequest,
  quoteResponse,
  ratePlanInput,
  ratePlanRecord,
  ratePlanStatus,
  ratePlanStatusChange,
  ratePlanUpdate,
  repricingResult,
  restrictionBulkUpdate,
  restrictionCell,
  restrictionPreview,
  restrictionQuery,
  taxComputation,
  taxRuleActivation,
  taxRuleInput,
  taxRuleRecord,
  taxRuleVersionInput,
  taxTemplateInstall,
} from './contracts';
import type { RatesService } from './service';

const tags = {
  plans: ['Rates: plans'],
  calendar: ['Rates: calendar'],
  catalog: ['Rates: packages & policies'],
  tax: ['Rates: tax & fee rules'],
  quotes: ['Rates: quotes'],
};
const changeSetResult = z.object({ changeSetId: z.uuid().nullable(), preview: z.unknown() });

export function ratesHttp(deps: { database: PorticoDatabase; rates: RatesService }): HttpModule {
  const { database, rates } = deps;
  const tx = <T>(
    req: { ctx: Parameters<typeof withTenantTx>[1] },
    fn: Parameters<typeof withTenantTx<T>>[2],
  ) => withTenantTx(database, req.ctx, fn);
  return {
    name: 'rates',
    routes(app) {
      // ───────────── Rate plans ─────────────
      app.get(
        '/rate-plans',
        {
          schema: {
            tags: tags.plans,
            querystring: propertyQuery.extend({ status: ratePlanStatus.optional() }),
            response: { 200: z.object({ items: z.array(ratePlanRecord) }) },
          },
        },
        async (req) => ({
          items: await tx(req, async (t) =>
            rates.ratePlanRecords(t, req.query.propertyId, await rates.listRatePlans(t, req.query)),
          ),
        }),
      );
      app.post(
        '/rate-plans',
        { schema: { tags: tags.plans, body: ratePlanInput, response: { 201: ratePlanRecord } } },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: 'POST /rate-plans', key, request: req.body },
            async (t) => ({
              status: 201,
              body: await rates.ratePlanRecord(t, await rates.createRatePlan(t, req.body)),
            }),
          );
          setVersion(reply, res.body.version);
          return reply.status(201).send(res.body);
        },
      );
      app.get(
        '/rate-plans/:id',
        { schema: { tags: tags.plans, params: idParams, response: { 200: ratePlanRecord } } },
        async (req, reply) => {
          const p = await tx(req, async (t) =>
            rates.ratePlanRecord(t, await rates.getRatePlan(t, req.params.id)),
          );
          setVersion(reply, p.version);
          return p;
        },
      );
      app.patch(
        '/rate-plans/:id',
        {
          schema: {
            tags: tags.plans,
            params: idParams,
            body: ratePlanUpdate,
            response: { 200: ratePlanRecord },
          },
        },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const p = await tx(req, async (t) =>
            rates.ratePlanRecord(t, await rates.updateRatePlan(t, req.params.id, expected, req.body)),
          );
          setVersion(reply, p.version);
          return p;
        },
      );
      app.post(
        '/rate-plans/:id/status',
        {
          schema: {
            tags: tags.plans,
            params: idParams,
            body: ratePlanStatusChange,
            response: { 200: ratePlanRecord },
          },
        },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const p = await tx(req, async (t) =>
            rates.ratePlanRecord(t, await rates.changeRatePlanStatus(t, req.params.id, expected, req.body)),
          );
          setVersion(reply, p.version);
          return p;
        },
      );
      app.get(
        '/rate-plans/:id/calendar',
        {
          schema: {
            tags: tags.calendar,
            params: idParams,
            querystring: calendarQuery,
            response: { 200: z.object({ ratePlanId: z.uuid(), cells: z.array(priceCell) }) },
          },
        },
        async (req) => tx(req, (t) => rates.getPriceCalendar(t, { ratePlanId: req.params.id, ...req.query })),
      );
      app.get(
        '/rate-plans/:id/price-history',
        {
          schema: {
            tags: tags.calendar,
            params: idParams,
            querystring: z.object({
              unitTypeId: z.uuid().optional(),
              from: z.iso.date().optional(),
              to: z.iso.date().optional(),
            }),
            response: { 200: z.object({ items: z.array(priceHistoryEntry) }) },
          },
        },
        async (req) => ({
          items: await tx(req, (t) => rates.getPriceHistory(t, { ratePlanId: req.params.id, ...req.query })),
        }),
      );

      app.get(
        '/rate-plans/:id/effective-restrictions',
        {
          schema: {
            tags: tags.calendar,
            params: idParams,
            querystring: z.object({ unitTypeId: z.uuid(), from: z.iso.date(), to: z.iso.date() }),
          },
        },
        async (req) => ({
          items: await tx(req, (t) =>
            rates.getEffectiveRestrictions(t, { ratePlanId: req.params.id, ...req.query }),
          ),
        }),
      );

      // ───────────── Price calendar (bulk, with preview) ─────────────
      app.post(
        '/rate-calendar/prices/preview',
        { schema: { tags: tags.calendar, body: priceBulkUpdate, response: { 200: pricePreview } } },
        async (req) => tx(req, (t) => rates.previewPriceUpdate(t, req.body)),
      );
      app.post(
        '/rate-calendar/prices',
        { schema: { tags: tags.calendar, body: priceBulkUpdate, response: { 200: changeSetResult } } },
        async (req) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: 'POST /rate-calendar/prices', key, request: req.body },
            async (t) => ({
              status: 200,
              body: await rates.applyPriceUpdate(t, req.body),
            }),
          );
          return res.body;
        },
      );

      // ───────────── Restrictions ─────────────
      app.get(
        '/rate-restrictions',
        {
          schema: {
            tags: tags.calendar,
            querystring: restrictionQuery,
            response: { 200: z.object({ items: z.array(restrictionCell) }) },
          },
        },
        async (req) => ({ items: await tx(req, (t) => rates.getRestrictions(t, req.query)) }),
      );
      app.post(
        '/rate-restrictions/preview',
        {
          schema: { tags: tags.calendar, body: restrictionBulkUpdate, response: { 200: restrictionPreview } },
        },
        async (req) => tx(req, (t) => rates.previewRestrictionUpdate(t, req.body)),
      );
      app.post(
        '/rate-restrictions',
        { schema: { tags: tags.calendar, body: restrictionBulkUpdate, response: { 200: changeSetResult } } },
        async (req) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: 'POST /rate-restrictions', key, request: req.body },
            async (t) => ({
              status: 200,
              body: await rates.applyRestrictionUpdate(t, req.body),
            }),
          );
          return res.body;
        },
      );

      // ───────────── Inclusions, packages, policies, promotions ─────────────
      type Tx = Parameters<RatesService['listInclusions']>[0];
      const crud = (c: {
        path: string;
        input: z.ZodType;
        update: z.ZodType;
        output: z.ZodType;
        list: (t: Tx, propertyId: string) => Promise<unknown[]>;
        create: (t: Tx, body: unknown) => Promise<{ version: number }>;
        patch: (t: Tx, id: string, v: number, body: unknown) => Promise<{ version: number }>;
      }) => {
        app.get(
          c.path,
          {
            schema: {
              tags: tags.catalog,
              querystring: propertyQuery,
              response: { 200: z.object({ items: z.array(c.output) }) },
            },
          },
          async (req) => ({ items: await tx(req, (t) => c.list(t, req.query.propertyId)) }),
        );
        app.post(
          c.path,
          { schema: { tags: tags.catalog, body: c.input, response: { 201: c.output } } },
          async (req, reply) => {
            const key = requireIdempotencyKey(req);
            const res = await runIdempotent(
              database,
              req.ctx,
              { scope: `POST ${c.path}`, key, request: req.body },
              async (t) => ({
                status: 201,
                body: await c.create(t, req.body),
              }),
            );
            setVersion(reply, res.body.version);
            return reply.status(201).send(res.body);
          },
        );
        app.patch(
          `${c.path}/:id`,
          { schema: { tags: tags.catalog, params: idParams, body: c.update, response: { 200: c.output } } },
          async (req, reply) => {
            const expected = requireIfMatch(req);
            const out = await tx(req, (t) => c.patch(t, req.params.id, expected, req.body));
            setVersion(reply, out.version);
            return out;
          },
        );
      };
      crud({
        path: '/rate-inclusions',
        input: inclusionInput,
        update: z.record(z.string(), z.unknown()),
        output: inclusion,
        list: rates.listInclusions,
        create: rates.createInclusion,
        patch: rates.updateInclusion,
      });
      crud({
        path: '/rate-packages',
        input: packageInput,
        update: packageUpdate,
        output: pkg,
        list: rates.listPackages,
        create: rates.createPackage,
        patch: rates.updatePackage,
      });
      crud({
        path: '/rate-policies',
        input: policyInput,
        update: policyUpdate,
        output: policy,
        list: rates.listPolicies,
        create: rates.createPolicy,
        patch: (t, id, v, body) =>
          rates.updatePolicy(t, id, v, body as { name?: string; structure?: unknown }),
      });
      crud({
        path: '/rate-promotions',
        input: promotionInput,
        update: promotionUpdate,
        output: promotion,
        list: rates.listPromotions,
        create: rates.createPromotion,
        patch: rates.updatePromotion,
      });
      app.get(
        '/rate-policies/:id',
        { schema: { tags: tags.catalog, params: idParams, response: { 200: policy } } },
        async (req, reply) => {
          const p = await tx(req, (t) => rates.getPolicy(t, req.params.id));
          setVersion(reply, p.version);
          return p;
        },
      );
      app.get(
        '/rate-policies/:id/versions',
        { schema: { tags: tags.catalog, params: idParams } },
        async (req) => ({
          items: await tx(req, (t) => rates.policyVersionHistory(t, req.params.id)),
        }),
      );

      // ───────────── Tax & fee rules (effective-dated) ─────────────
      app.get(
        '/tax-rules',
        {
          schema: {
            tags: tags.tax,
            querystring: z.object({ jurisdiction: z.string().optional() }),
            response: { 200: z.object({ items: z.array(taxRuleRecord) }) },
          },
        },
        async (req) => ({
          items: await tx(req, async (t) =>
            (await rates.listTaxRules(t, req.query)).map((r) => rates.taxRuleRecord(t, r)),
          ),
        }),
      );
      app.get(
        '/tax-rules/:id',
        { schema: { tags: tags.tax, params: idParams, response: { 200: taxRuleRecord } } },
        async (req, reply) => {
          const r = await tx(req, async (t) =>
            rates.taxRuleRecord(t, await rates.getTaxRule(t, req.params.id)),
          );
          setVersion(reply, r.version);
          return r;
        },
      );
      app.post(
        '/tax-rules',
        { schema: { tags: tags.tax, body: taxRuleInput, response: { 201: taxRuleRecord } } },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: 'POST /tax-rules', key, request: req.body },
            async (t) => ({
              status: 201,
              body: rates.taxRuleRecord(t, await rates.createTaxRule(t, req.body)),
            }),
          );
          return reply.status(201).send(res.body);
        },
      );
      app.post(
        '/tax-rules/:id/versions',
        {
          schema: {
            tags: tags.tax,
            params: idParams,
            body: taxRuleVersionInput,
            response: { 201: taxRuleRecord },
          },
        },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: `POST /tax-rules/${req.params.id}/versions`, key, request: req.body },
            async (t) => ({
              status: 201,
              body: rates.taxRuleRecord(t, await rates.addTaxRuleVersion(t, req.params.id, req.body)),
            }),
          );
          return reply.status(201).send(res.body);
        },
      );
      app.post(
        '/tax-rule-versions/:id/activation-preview',
        { schema: { tags: tags.tax, params: idParams } },
        async (req) => tx(req, (t) => rates.previewTaxRuleActivation(t, req.params.id)),
      );
      app.post(
        '/tax-rule-versions/:id/activate',
        { schema: { tags: tags.tax, params: idParams, body: taxRuleActivation } },
        async (req) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: `POST /tax-rule-versions/${req.params.id}/activate`, key, request: req.body },
            async (t) => ({
              status: 200,
              body: await rates.activateTaxRuleVersion(t, req.params.id, req.body),
            }),
          );
          return res.body;
        },
      );
      app.post(
        '/tax-rule-versions/:id/withdraw',
        {
          schema: {
            tags: tags.tax,
            params: idParams,
            body: z.object({ reason: z.string().min(3).max(500) }),
            response: { 200: taxRuleRecord },
          },
        },
        async (req) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: `POST /tax-rule-versions/${req.params.id}/withdraw`, key, request: req.body },
            async (t) => ({
              status: 200,
              body: rates.taxRuleRecord(t, await rates.withdrawTaxRuleVersion(t, req.params.id, req.body)),
            }),
          );
          return res.body;
        },
      );
      app.post(
        '/tax-templates/install',
        { schema: { tags: tags.tax, body: taxTemplateInstall } },
        async (req) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: 'POST /tax-templates/install', key, request: req.body },
            async (t) => ({
              status: 200,
              body: await rates.installTaxTemplate(t, req.body),
            }),
          );
          return res.body;
        },
      );
      app.post(
        '/tax-calculations',
        { schema: { tags: tags.tax, body: computeTaxesInput, response: { 200: taxComputation } } },
        async (req) =>
          tx(req, async (t) => {
            requirePermission(t, 'rates.quote.read', { propertyId: req.body.propertyId });
            return rates.computeTaxesDetailed(t, req.body);
          }),
      );

      // ───────────── Quotes ─────────────
      app.post(
        '/quotes',
        { schema: { tags: tags.quotes, body: quoteRequest, response: { 200: quoteResponse } } },
        async (req) => tx(req, (t) => rates.quoteDetailed(t, req.body)),
      );
      app.post(
        '/quotes/reprice',
        { schema: { tags: tags.quotes, body: priceChangeRequest, response: { 200: repricingResult } } },
        async (req) => tx(req, (t) => rates.priceChange(t, req.body)),
      );
    },
  };
}
