/**
 * HTTP surface (mounted under /v1/distribution). Creates require Idempotency-Key; updates of versioned records
 * require If-Match; reads of versioned records return ETag. The booking-revision webhook is public (it is
 * authenticated by the connection's webhook token) and rate-limited.
 */
import { type PorticoDatabase, runIdempotent, withTenantTx } from '@portico/db';
import { type HttpModule, requireIdempotencyKey, requireIfMatch, setVersion } from '@portico/http';
import { z } from 'zod';
import type { ConnectionView } from './contracts';
import {
  calendarCell,
  calendarQuery,
  completenessView,
  connectionView,
  createConnectionInput,
  createdConnection,
  discrepancyView,
  exceptionView,
  healthView,
  mappingView,
  messageView,
  pullBookingsInput,
  rateMappingInput,
  releaseInput,
  resolveDiscrepancyInput,
  resolveInput,
  resolveRevisionInput,
  resyncInput,
  revisionState,
  revisionView,
  roomMappingInput,
  simulatorBookingInput,
  simulatorFaultInput,
  simulatorOutageInput,
  stopSellInput,
  stopSellView,
  updateSettingsInput,
} from './contracts';
import { P } from './manifest';
import { getChannelCalendar, runDiscrepancyCheck } from './service/calendar';
import { type DistributionDeps, loadConnection, requireOnConnection } from './service/common';
import * as conns from './service/connections';
import { listDiscrepancies, resolveDiscrepancy } from './service/discrepancies';
import { listExceptions, resolveException } from './service/exceptions';
import { getHealth, propertyHealth } from './service/health';
import { getRevision, listRevisions, pullFeed, recoverSince, resolveRevision } from './service/inbound';
import * as maps from './service/mappings';
import { listMessages } from './service/messages';
import * as sim from './service/simulator-control';
import { createStopSell, listStopSells, releaseStopSell } from './service/stop-sell';
import { receiveWebhook } from './service/webhooks';

const tags = ['Distribution'];
const idParams = z.object({ id: z.uuid() });
const items = <T extends z.ZodType>(t: T) => z.object({ items: z.array(t) });

export function distributionHttp(input: { database: PorticoDatabase; deps: DistributionDeps }): HttpModule {
  const { database, deps } = input;
  const tx = <T>(
    req: { ctx: Parameters<typeof withTenantTx>[1] },
    fn: Parameters<typeof withTenantTx<T>>[2],
  ) => withTenantTx(database, req.ctx, fn);
  return {
    name: 'distribution',
    async routes(app) {
      // ── Connections ──
      app.get(
        '/distribution/connections',
        {
          schema: {
            tags,
            querystring: z.object({ propertyId: z.uuid() }),
            response: { 200: items(connectionView) },
          },
        },
        async (req) => ({ items: await tx(req, (t) => conns.listConnections(t, deps, req.query)) }),
      );
      app.post(
        '/distribution/connections',
        { schema: { tags, body: createConnectionInput, response: { 201: createdConnection } } },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: 'POST /distribution/connections', key, request: req.body },
            async (t) => ({
              status: 201,
              body: (await conns.createConnection(t, deps, req.body)) as {
                connection: ConnectionView;
                webhookToken: string | null;
              },
            }),
            {
              // The webhook token is shown ONCE: a replay rebuilds the connection without it (never stored).
              replay: {
                store: (body) => ({ id: body.connection.id }),
                rebuild: async (t, stored: { id: string }) => ({
                  connection: await conns.getConnection(t, deps, stored.id),
                  webhookToken: null,
                }),
              },
            },
          );
          setVersion(reply, res.body.connection.version);
          return reply.status(201).send(res.body);
        },
      );
      app.get(
        '/distribution/connections/:id',
        { schema: { tags, params: idParams, response: { 200: connectionView } } },
        async (req, reply) => {
          const c = await tx(req, (t) => conns.getConnection(t, deps, req.params.id));
          setVersion(reply, c.version);
          return c;
        },
      );
      app.post(
        '/distribution/connections/:id/verify',
        { schema: { tags, params: idParams, response: { 200: connectionView } } },
        async (req, reply) => {
          const c = await conns.verifyConnection(database, deps, req.ctx, req.params.id);
          setVersion(reply, c.version);
          return c;
        },
      );
      for (const action of ['activate', 'pause', 'resume', 'disconnect'] as const) {
        app.post(
          `/distribution/connections/:id/${action}`,
          {
            schema: {
              tags,
              params: idParams,
              body: z
                .object({ reason: z.string().min(3).max(500).optional() })
                .strict()
                .optional(),
              response: { 200: connectionView },
            },
          },
          async (req, reply) => {
            const v = requireIfMatch(req);
            const reason = req.body?.reason ?? `${action} requested`;
            const c = await tx(req, (t) =>
              action === 'activate'
                ? conns.activateConnection(t, deps, req.params.id, v)
                : action === 'pause'
                  ? conns.pauseConnection(t, deps, req.params.id, v, reason)
                  : action === 'resume'
                    ? conns.resumeConnection(t, deps, req.params.id, v)
                    : conns.disconnectConnection(t, deps, req.params.id, v, reason),
            );
            setVersion(reply, c.version);
            return c;
          },
        );
      }
      app.patch(
        '/distribution/connections/:id/settings',
        { schema: { tags, params: idParams, body: updateSettingsInput, response: { 200: connectionView } } },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const c = await tx(req, (t) => conns.updateSettings(t, deps, req.params.id, v, req.body));
          setVersion(reply, c.version);
          return c;
        },
      );
      app.post(
        '/distribution/connections/:id/credentials',
        {
          schema: {
            tags,
            params: idParams,
            body: z.object({ apiKey: z.string().min(8).max(500) }).strict(),
            response: { 200: connectionView },
          },
        },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const c = await tx(req, (t) => conns.rotateCredential(t, deps, req.params.id, v, req.body.apiKey));
          setVersion(reply, c.version);
          return c;
        },
      );
      app.post(
        '/distribution/connections/:id/webhook-token',
        { schema: { tags, params: idParams, response: { 200: createdConnection } } },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const r = await tx(req, (t) => conns.rotateWebhookToken(t, deps, req.params.id, v));
          setVersion(reply, r.connection.version);
          return r;
        },
      );
      app.get(
        '/distribution/connections/:id/health',
        { schema: { tags, params: idParams, response: { 200: healthView } } },
        (req) => tx(req, (t) => getHealth(t, deps, req.params.id)),
      );
      app.get(
        '/distribution/health',
        {
          schema: {
            tags,
            querystring: z.object({ propertyId: z.uuid() }),
            response: { 200: items(healthView) },
          },
        },
        async (req) => ({ items: await tx(req, (t) => propertyHealth(t, deps, req.query.propertyId)) }),
      );
      app.get(
        '/distribution/connections/:id/calendar',
        {
          schema: {
            tags,
            params: idParams,
            querystring: calendarQuery,
            response: { 200: items(calendarCell) },
          },
        },
        async (req) => ({
          items: await tx(req, (t) => getChannelCalendar(t, deps, req.params.id, req.query)),
        }),
      );
      app.post(
        '/distribution/connections/:id/resync',
        {
          schema: {
            tags,
            params: idParams,
            body: resyncInput,
            response: {
              202: z.object({
                products: z.number().int(),
                range: z.object({ from: z.string(), to: z.string() }),
              }),
            },
          },
        },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: `POST /distribution/connections/${req.params.id}/resync`, key, request: req.body },
            async (t) => ({
              status: 202,
              body: await conns.resyncConnection(t, deps, req.params.id, req.body),
            }),
          );
          return reply.status(202).send(res.body);
        },
      );
      app.post(
        '/distribution/connections/:id/discrepancy-check',
        {
          schema: {
            tags,
            params: idParams,
            response: { 200: z.object({ differing: z.number().int(), discrepancies: z.number().int() }) },
          },
        },
        (req) => tx(req, (t) => runDiscrepancyCheck(t, deps, req.params.id)),
      );
      app.post(
        '/distribution/connections/:id/pull-bookings',
        {
          schema: {
            tags,
            params: idParams,
            body: pullBookingsInput,
            response: {
              200: z.object({ stored: z.number().int(), detail: z.record(z.string(), z.unknown()) }),
            },
          },
        },
        async (req) => {
          await tx(req, async (t) => {
            const conn = await loadConnection(t, req.params.id);
            requireOnConnection(t, conn, P.reservationRecover);
          });
          if (req.body.since) {
            const r = await recoverSince(database, deps, req.ctx, req.params.id, new Date(req.body.since));
            return { stored: r.stored, detail: r };
          }
          const r = await pullFeed(database, deps, req.ctx, req.params.id, 'recovery');
          return { stored: r.stored, detail: r };
        },
      );
      app.get(
        '/distribution/connections/:id/messages',
        { schema: { tags, params: idParams, response: { 200: items(messageView) } } },
        async (req) => ({ items: await tx(req, (t) => listMessages(t, req.params.id)) }),
      );

      // ── Mapping ──
      app.get(
        '/distribution/connections/:id/mappings',
        {
          schema: {
            tags,
            params: idParams,
            response: { 200: z.object({ rooms: z.array(mappingView), rates: z.array(mappingView) }) },
          },
        },
        (req) => tx(req, (t) => maps.listMappings(t, req.params.id)),
      );
      app.get(
        '/distribution/connections/:id/completeness',
        { schema: { tags, params: idParams, response: { 200: completenessView } } },
        (req) => tx(req, (t) => maps.getCompleteness(t, deps, req.params.id)),
      );
      for (const kind of ['rooms', 'rates'] as const) {
        app.post(
          `/distribution/connections/:id/mappings/${kind}`,
          {
            schema: {
              tags,
              params: idParams,
              body: kind === 'rooms' ? roomMappingInput : rateMappingInput,
              response: { 201: mappingView },
            },
          },
          async (req, reply) => {
            const key = requireIdempotencyKey(req);
            const res = await runIdempotent(
              database,
              req.ctx,
              {
                scope: `POST /distribution/connections/${req.params.id}/mappings/${kind}`,
                key,
                request: req.body,
              },
              async (t) => ({
                status: 201,
                body:
                  kind === 'rooms'
                    ? await maps.setRoomMapping(
                        t,
                        deps,
                        req.params.id,
                        req.body as z.infer<typeof roomMappingInput>,
                      )
                    : await maps.setRateMapping(
                        t,
                        deps,
                        req.params.id,
                        req.body as z.infer<typeof rateMappingInput>,
                      ),
              }),
            );
            setVersion(reply, res.body.version);
            return reply.status(201).send(res.body);
          },
        );
      }
      app.post(
        '/distribution/mappings/:kind/:id/retire',
        {
          schema: {
            tags,
            params: z.object({ kind: z.enum(['room', 'rate']), id: z.uuid() }),
            response: { 200: z.object({ id: z.uuid(), status: z.literal('retired') }) },
          },
        },
        async (req) => {
          const v = requireIfMatch(req);
          return tx(req, (t) => maps.retireMapping(t, req.params.kind, req.params.id, v));
        },
      );

      // ── Stop-sell ──
      app.get(
        '/distribution/connections/:id/stop-sells',
        { schema: { tags, params: idParams, response: { 200: items(stopSellView) } } },
        async (req) => ({ items: await tx(req, (t) => listStopSells(t, req.params.id)) }),
      );
      app.post(
        '/distribution/connections/:id/stop-sells',
        { schema: { tags, params: idParams, body: stopSellInput, response: { 201: stopSellView } } },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: `POST /distribution/connections/${req.params.id}/stop-sells`, key, request: req.body },
            async (t) => ({ status: 201, body: await createStopSell(t, deps, req.params.id, req.body) }),
          );
          setVersion(reply, res.body.version);
          return reply.status(201).send(res.body);
        },
      );
      app.post(
        '/distribution/stop-sells/:id/release',
        { schema: { tags, params: idParams, body: releaseInput, response: { 200: stopSellView } } },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const s = await tx(req, (t) => releaseStopSell(t, deps, req.params.id, v, req.body.reason));
          setVersion(reply, s.version);
          return s;
        },
      );

      // ── Booking revisions ──
      app.get(
        '/distribution/connections/:id/revisions',
        {
          schema: {
            tags,
            params: idParams,
            querystring: z.object({
              state: revisionState.optional(),
              channelBookingId: z.string().max(200).optional(),
            }),
            response: { 200: items(revisionView) },
          },
        },
        async (req) => ({ items: await tx(req, (t) => listRevisions(t, req.params.id, req.query)) }),
      );
      app.get(
        '/distribution/revisions/:id',
        { schema: { tags, params: idParams, response: { 200: revisionView } } },
        async (req, reply) => {
          const r = await tx(req, (t) => getRevision(t, req.params.id));
          setVersion(reply, r.version);
          return r;
        },
      );
      app.post(
        '/distribution/revisions/:id/resolve',
        { schema: { tags, params: idParams, body: resolveRevisionInput, response: { 200: revisionView } } },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const r = await tx(req, (t) => resolveRevision(t, deps, req.params.id, v, req.body));
          setVersion(reply, r.version);
          return r;
        },
      );

      // ── Exceptions and discrepancies ──
      app.get(
        '/distribution/connections/:id/exceptions',
        {
          schema: {
            tags,
            params: idParams,
            querystring: z.object({ status: z.enum(['open', 'resolved']).optional() }),
            response: { 200: items(exceptionView) },
          },
        },
        async (req) => ({
          items: await tx(req, (t) =>
            listExceptions(t, {
              connectionId: req.params.id,
              ...(req.query.status ? { status: req.query.status } : {}),
            }),
          ),
        }),
      );
      app.post(
        '/distribution/exceptions/:id/resolve',
        { schema: { tags, params: idParams, body: resolveInput, response: { 200: exceptionView } } },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const e = await tx(req, (t) => resolveException(t, req.params.id, v, req.body.resolution));
          setVersion(reply, e.version);
          return e;
        },
      );
      app.get(
        '/distribution/connections/:id/discrepancies',
        { schema: { tags, params: idParams, response: { 200: items(discrepancyView) } } },
        async (req) => ({ items: await tx(req, (t) => listDiscrepancies(t, req.params.id)) }),
      );
      app.post(
        '/distribution/discrepancies/:id/resolve',
        {
          schema: {
            tags,
            params: idParams,
            body: resolveDiscrepancyInput,
            response: { 200: discrepancyView },
          },
        },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const d = await tx(req, (t) => resolveDiscrepancy(t, req.params.id, v, req.body));
          setVersion(reply, d.version);
          return d;
        },
      );

      // ── Simulated hub (never in live organizations) ──
      app.get('/distribution/connections/:id/simulator', { schema: { tags, params: idParams } }, (req) =>
        tx(req, (t) => sim.readSimulator(t, deps, req.params.id)),
      );
      app.post(
        '/distribution/connections/:id/simulator/bookings',
        { schema: { tags, params: idParams, body: simulatorBookingInput } },
        async (req) => {
          requireIdempotencyKey(req);
          return sim.simulateBooking(database, deps, req.ctx, req.params.id, req.body);
        },
      );
      app.post(
        '/distribution/connections/:id/simulator/faults',
        { schema: { tags, params: idParams, body: simulatorFaultInput } },
        (req) => tx(req, (t) => sim.injectFault(t, deps, req.params.id, req.body)),
      );
      app.post(
        '/distribution/connections/:id/simulator/outage',
        { schema: { tags, params: idParams, body: simulatorOutageInput } },
        (req) => tx(req, (t) => sim.setOutage(t, deps, req.params.id, req.body.minutes)),
      );

      // ── Public webhook (Channex → Portico) ──
      await app.register(async (scope) => {
        scope.removeContentTypeParser(['application/json']);
        scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) =>
          done(null, body),
        );
        scope.post(
          '/distribution/webhooks/channex/:endpointId',
          {
            config: { public: true, rateLimit: { max: 600, timeWindow: '1 minute' } },
            schema: { tags: ['Distribution webhooks'] },
          },
          async (req, reply) => {
            const headers: Record<string, string | undefined> = {};
            for (const [k, v] of Object.entries(req.headers))
              headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
            const params = req.params as { endpointId?: unknown };
            const r = await receiveWebhook(database, deps, {
              endpointId: typeof params.endpointId === 'string' ? params.endpointId : '',
              headers,
              rawBody: typeof req.body === 'string' ? req.body : '',
            });
            return reply.status(r.status).send(r.body);
          },
        );
      });
    },
  };
}
