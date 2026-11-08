import { type PorticoDatabase, runIdempotent, type TxContext, withTenantTx } from '@portico/db';
import { type HttpModule, requireIdempotencyKey, requireIfMatch, setVersion } from '@portico/http';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import * as c from './contracts';
import type { DayCloseService } from './service';

const TAGS = ['Day Close'];
const items = <S extends z.ZodType>(s: S) => z.object({ items: z.array(s) });

/**
 * HTTP surface of day-close (mounted under /v1). Starting a run needs an Idempotency-Key (a retried start never
 * creates a second run — and a concurrent start returns the active one); resume, cancel, policy and issue updates
 * need If-Match. Run and policy reads return an ETag.
 */
export function dayCloseHttp(deps: { database: PorticoDatabase; service: DayCloseService }): HttpModule {
  const { database, service } = deps;
  const tx = <R>(req: FastifyRequest, fn: (tx: TxContext) => Promise<R>) =>
    withTenantTx(database, req.ctx, fn);
  return {
    name: 'day-close',
    routes(app) {
      app.get(
        '/day-close/properties/:propertyId/readiness',
        {
          schema: {
            tags: TAGS,
            summary: 'What is still open for the business date (blocking vs warnings, owners, fixes)',
            params: c.propertyParams,
            querystring: c.readinessQuery,
            response: { 200: c.readiness },
          },
        },
        (req) =>
          tx(req, (t) =>
            service.getReadiness(
              t,
              req.params.propertyId,
              req.query.businessDate ? { businessDate: req.query.businessDate } : {},
            ),
          ),
      );
      app.post(
        '/day-close/properties/:propertyId/runs',
        {
          schema: {
            tags: TAGS,
            summary: 'Start Day Close for the current business date (or get the active run)',
            params: c.propertyParams,
            body: c.startRunInput,
            response: { 200: c.runView, 201: c.runView },
          },
        },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const created = await runIdempotent(
            database,
            req.ctx,
            { scope: 'dayClose.run.start', key, request: { params: req.params, body: req.body } },
            async (t) => {
              const r = await service.createRun(t, {
                propertyId: req.params.propertyId,
                ...(req.body.businessDate ? { businessDate: req.body.businessDate } : {}),
                trigger: req.ctx.actor.kind === 'api_client' ? 'api' : 'manual',
              });
              return {
                status: r.alreadyActive ? 200 : 201,
                body: { runId: r.run.id, alreadyActive: r.alreadyActive },
              };
            },
          );
          if (req.body.execute !== false && !created.body.alreadyActive) {
            await service.executeRun(database, req.ctx, created.body.runId);
          }
          const view = await tx(req, (t) => service.getRun(t, created.body.runId));
          setVersion(reply, view.version);
          return reply
            .status(created.status === 200 ? 200 : 201)
            .send(created.body.alreadyActive ? { ...view, alreadyActive: true } : view);
        },
      );
      app.get(
        '/day-close/properties/:propertyId/runs',
        {
          schema: {
            tags: TAGS,
            params: c.propertyParams,
            querystring: c.runListQuery,
            response: { 200: items(c.runSummary) },
          },
        },
        async (req) => ({
          items: await tx(req, (t) => service.listRuns(t, req.params.propertyId, req.query)),
        }),
      );
      app.get(
        '/day-close/runs/:id',
        { schema: { tags: TAGS, params: c.runParams, response: { 200: c.runView } } },
        async (req, reply) => {
          const v = await tx(req, (t) => service.getRun(t, req.params.id));
          setVersion(reply, v.version);
          return v;
        },
      );
      app.post(
        '/day-close/runs/:id/resume',
        {
          schema: { tags: TAGS, params: c.runParams, body: c.resumeInput, response: { 200: c.runView } },
        },
        async (req, reply) => {
          const v = await service.resumeRun(database, req.ctx, req.params.id, requireIfMatch(req));
          setVersion(reply, v.version);
          return v;
        },
      );
      app.post(
        '/day-close/runs/:id/cancel',
        { schema: { tags: TAGS, params: c.runParams, body: c.cancelInput, response: { 200: c.runView } } },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const v = await tx(req, (t) => service.cancelRun(t, req.params.id, expected, req.body.reason));
          setVersion(reply, v.version);
          return v;
        },
      );
      app.post(
        '/day-close/runs/:id/overrides',
        {
          schema: { tags: TAGS, params: c.runParams, body: c.overrideInput, response: { 201: c.runView } },
        },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: 'dayClose.exception.override', key, request: { params: req.params, body: req.body } },
            async (t) => {
              await service.overrideItem(t, req.params.id, req.body);
              return { status: 201, body: { runId: req.params.id } };
            },
          );
          const v = await tx(req, (t) => service.getRun(t, res.body.runId));
          setVersion(reply, v.version);
          return reply.status(201).send(v);
        },
      );
      app.get(
        '/day-close/properties/:propertyId/issues',
        {
          schema: {
            tags: TAGS,
            params: c.propertyParams,
            querystring: z.object({ status: z.enum(['open', 'resolved']).default('open') }),
            response: { 200: items(c.issueView) },
          },
        },
        async (req) => ({
          items: await tx(req, (t) => service.listIssues(t, req.params.propertyId, req.query.status)),
        }),
      );
      app.post(
        '/day-close/issues/:id/resolve',
        {
          schema: {
            tags: TAGS,
            params: c.runParams,
            body: c.resolveIssueInput,
            response: { 200: c.issueView },
          },
        },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const v = await tx(req, (t) =>
            service.resolveIssue(t, req.params.id, expected, req.body.resolution),
          );
          setVersion(reply, v.version);
          return v;
        },
      );
      app.get(
        '/day-close/properties/:propertyId/days/:date/report',
        { schema: { tags: TAGS, params: c.dateParams, response: { 200: c.dayReport } } },
        (req) => tx(req, (t) => service.getReport(t, req.params.propertyId, req.params.date)),
      );
      app.get(
        // The record route of `day_report` (manifest record type; id = `{propertyId}:{date}`, review P3-3).
        '/day-close/reports/:id',
        {
          schema: {
            tags: TAGS,
            params: z.object({ id: z.string().regex(/^[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}$/) }),
            response: { 200: c.dayReport },
          },
        },
        (req) => {
          const [propertyId, date] = [req.params.id.slice(0, 36), req.params.id.slice(37)];
          return tx(req, (t) => service.getReport(t, propertyId, date));
        },
      );
      app.post(
        '/day-close/properties/:propertyId/night-decisions',
        {
          schema: {
            tags: TAGS,
            summary:
              'Decide a stay-night taken out of Day Close: Day Close posts it, or it was charged another way',
            params: c.propertyParams,
            body: c.nightDecisionInput,
            response: {
              201: z.object({ stayId: z.string(), night: z.string(), decision: z.string() }),
            },
          },
        },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const r = await runIdempotent(
            database,
            req.ctx,
            { scope: 'dayClose.night.decide', key, request: { params: req.params, body: req.body } },
            async (t) => ({
              status: 201,
              body: await service.decideNight(t, req.params.propertyId, req.body),
            }),
          );
          return reply.status(201).send(r.body);
        },
      );
      app.get(
        '/day-close/properties/:propertyId/days/:date/facts',
        { schema: { tags: TAGS, params: c.dateParams, response: { 200: c.dayFacts } } },
        (req) => tx(req, (t) => service.getFacts(t, req.params.propertyId, req.params.date)),
      );
      app.get(
        '/day-close/portfolio',
        { schema: { tags: TAGS, response: { 200: c.portfolioBoard } } },
        (req) => tx(req, (t) => service.portfolio(t)),
      );
      app.get(
        '/day-close/properties/:propertyId/policy',
        { schema: { tags: TAGS, params: c.propertyParams, response: { 200: c.policyView } } },
        async (req, reply) => {
          const v = await tx(req, (t) => service.getPolicy(t, req.params.propertyId));
          setVersion(reply, v.version);
          return v;
        },
      );
      app.put(
        '/day-close/properties/:propertyId/policy',
        {
          schema: {
            tags: TAGS,
            params: c.propertyParams,
            body: c.policyUpdateInput,
            response: { 200: c.policyView },
          },
        },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const v = await tx(req, (t) => service.updatePolicy(t, req.params.propertyId, req.body, expected));
          setVersion(reply, v.version);
          return v;
        },
      );
      app.post(
        '/day-close/properties/:propertyId/schedule/skip-today',
        {
          schema: {
            tags: TAGS,
            params: c.propertyParams,
            body: z.object({ reason: z.string().min(3).max(500) }),
            response: { 200: z.object({ businessDate: z.string(), version: z.number().int() }) },
          },
        },
        async (req) => {
          const key = requireIdempotencyKey(req);
          const r = await runIdempotent(
            database,
            req.ctx,
            { scope: 'dayClose.schedule.skipToday', key, request: { params: req.params, body: req.body } },
            async (t) => ({
              status: 200,
              body: await service.skipToday(t, req.params.propertyId, req.body.reason),
            }),
          );
          return r.body;
        },
      );
    },
  };
}
