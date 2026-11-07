/**
 * HTTP surface (mounted under /v1/integration). Creates and money-adjacent commands require Idempotency-Key;
 * updates of versioned records require If-Match; reads return ETag. Errors are problem+json that explain the
 * problem and the recovery.
 */
import { type PorticoDatabase, runIdempotent, withTenantTx } from '@portico/db';
import { type HttpModule, idParams, requireIdempotencyKey, requireIfMatch, setVersion } from '@portico/http';
import { z } from 'zod';
import {
  activateInput,
  activationPreview,
  assignExceptionInput,
  authorizeInput,
  catalogueQuery,
  compatibilityReport,
  connection,
  connectionHealth,
  connectionScope,
  connectorSummary,
  createConnectionInput,
  credentialView,
  disconnectInput,
  exceptionsQuery,
  exchangeEntry,
  exchangeQuery,
  exportedFile,
  fileExportInput,
  fileImportInput,
  healthQuery,
  ignoreExceptionInput,
  integrationException,
  lifecyclePreview,
  lifecyclePreviewQuery,
  listConnectionsQuery,
  manualSyncInput,
  mapping,
  mappingHistoryEntry,
  mappingSet,
  outboundCommand,
  outboundQuery,
  pauseInput,
  portfolioHealth,
  replaceInput,
  replayDeliveryInput,
  replayRangeInput,
  resolveExceptionInput,
  resumeInput,
  revalidateInput,
  reviewCompatibilityInput,
  reviewMappingInput,
  rotateCredentialInput,
  rotatedSigningSecret,
  rotateSigningSecretInput,
  simulatorAccountCreated,
  simulatorEventInput,
  simulatorFaults,
  syncRun,
  validationRun,
  vendorNoticeInput,
  webhookDelivery,
  webhookSubscription,
  webhookSubscriptionCreated,
  webhookSubscriptionInput,
  webhookSubscriptionUpdate,
} from './contracts';
import { P } from './manifest';
import { getCatalogueEntry, listCatalogue } from './service/catalogue';
import type { IntegrationDeps } from './service/common';
import { loadConnection, requireOnConnection } from './service/common';
import * as conns from './service/connections';
import { listCredentials } from './service/credentials';
import * as exc from './service/exceptions';
import * as ex from './service/exchange';
import * as health from './service/health';
import * as maps from './service/mappings';
import { createIntegrationProvider } from './service/provider';
import * as sims from './service/simulators';
import * as hooks from './service/webhooks';

const tags = ['Integration'];
const connParams = z.object({ id: z.uuid() });
const mappingParams = z.object({ mappingId: z.uuid() });
const items = <T extends z.ZodType>(t: T) => z.object({ items: z.array(t) });

export function integrationHttp(deps: {
  database: PorticoDatabase;
  integration: IntegrationDeps;
}): HttpModule {
  const { database } = deps;
  const d = deps.integration;
  const provider = createIntegrationProvider(d);
  return {
    name: 'integration',
    routes(app) {
      // ── Catalogue ──
      app.get(
        '/integration/catalogue',
        { schema: { tags, querystring: catalogueQuery, response: { 200: items(connectorSummary) } } },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, async (tx) => listCatalogue(tx, d, req.query)),
        }),
      );
      app.get(
        '/integration/catalogue/:key',
        {
          schema: {
            tags,
            params: z.object({ key: z.string().min(1).max(100) }),
            response: { 200: connectorSummary },
          },
        },
        (req) => withTenantTx(database, req.ctx, async (tx) => getCatalogueEntry(tx, d, req.params.key)),
      );
      app.get(
        '/integration/webhook-event-types',
        {
          schema: { tags, response: { 200: items(z.object({ type: z.string(), description: z.string() })) } },
        },
        async () => ({ items: [...hooks.publicEventTypes()] }),
      );

      // ── Connections ──
      app.get(
        '/integration/connections',
        { schema: { tags, querystring: listConnectionsQuery, response: { 200: items(connection) } } },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, (tx) => conns.listConnections(tx, d, req.query)),
        }),
      );
      app.post(
        '/integration/connections',
        { schema: { tags, body: createConnectionInput, response: { 201: connection } } },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: 'POST /integration/connections', key, request: req.body },
            async (tx) => ({
              status: 201,
              body: await conns.createConnection(tx, d, req.body),
            }),
          );
          setVersion(reply, res.body.version);
          return reply.status(201).send(res.body);
        },
      );
      app.get(
        '/integration/connections/:id',
        { schema: { tags, params: connParams, response: { 200: connection } } },
        async (req, reply) => {
          const c = await withTenantTx(database, req.ctx, (tx) => conns.getConnection(tx, d, req.params.id));
          setVersion(reply, c.version);
          return c;
        },
      );
      app.post(
        '/integration/connections/:id/compatibility/preview',
        {
          schema: {
            tags,
            params: connParams,
            body: z.object({ scope: connectionScope }),
            response: { 200: compatibilityReport },
          },
        },
        (req) =>
          withTenantTx(database, req.ctx, (tx) =>
            conns.previewCompatibility(tx, d, req.params.id, req.body.scope),
          ),
      );
      app.post(
        '/integration/connections/:id/compatibility',
        {
          schema: {
            tags,
            params: connParams,
            body: reviewCompatibilityInput,
            response: { 200: z.object({ connection, report: compatibilityReport }) },
          },
        },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const res = await withTenantTx(database, req.ctx, (tx) =>
            conns.reviewCompatibility(tx, d, req.params.id, v, req.body.scope),
          );
          setVersion(reply, res.connection.version);
          return res;
        },
      );
      app.post(
        '/integration/connections/:id/authorize',
        { schema: { tags, params: connParams, body: authorizeInput, response: { 200: connection } } },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const c = await conns.authorize(database, d, req.ctx, req.params.id, v, req.body);
          setVersion(reply, c.version);
          return c;
        },
      );
      app.post(
        '/integration/connections/:id/mappings/suggest',
        { schema: { tags, params: connParams, response: { 200: mappingSet.extend({ connection }) } } },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const res = await maps.suggestConnectionMappings(database, d, req.ctx, req.params.id, v);
          setVersion(reply, res.connection.version);
          return res;
        },
      );
      app.get(
        '/integration/connections/:id/mappings',
        { schema: { tags, params: connParams, response: { 200: mappingSet } } },
        (req) => withTenantTx(database, req.ctx, (tx) => maps.getMappingSet(tx, req.params.id)),
      );
      app.post(
        '/integration/mappings/:mappingId/review',
        {
          schema: {
            tags,
            params: mappingParams,
            body: reviewMappingInput,
            response: {
              200: z.object({
                mapping,
                connectionState: z.string(),
                reprocessed: z
                  .object({ applied: z.number(), stillHeld: z.number(), stale: z.number() })
                  .nullable(),
              }),
            },
          },
        },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const res = await withTenantTx(database, req.ctx, (tx) =>
            ex.reviewMappingAndReprocess(tx, d, req.params.mappingId, v, req.body),
          );
          setVersion(reply, res.mapping.version);
          return res;
        },
      );
      app.get(
        '/integration/mappings/:mappingId/history',
        { schema: { tags, params: mappingParams, response: { 200: items(mappingHistoryEntry) } } },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, (tx) => maps.mappingHistory(tx, req.params.mappingId)),
        }),
      );
      app.post(
        '/integration/connections/:id/issues/resolve',
        { schema: { tags, params: connParams, response: { 200: connection } } },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const c = await withTenantTx(database, req.ctx, (tx) =>
            conns.resolveIssues(tx, d, req.params.id, v),
          );
          setVersion(reply, c.version);
          return c;
        },
      );
      app.post(
        '/integration/connections/:id/validation-runs',
        { schema: { tags, params: connParams, response: { 201: validationRun } } },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const run = await conns.runValidation(database, d, req.ctx, req.params.id, v);
          return reply.status(201).send(run);
        },
      );
      app.post(
        '/integration/connections/:id/activation-preview',
        { schema: { tags, params: connParams, response: { 201: activationPreview } } },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const p = await conns.previewActivation(database, d, req.ctx, req.params.id, v);
          return reply.status(201).send(p);
        },
      );
      app.post(
        '/integration/connections/:id/activate',
        { schema: { tags, params: connParams, body: activateInput, response: { 200: connection } } },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const c = await withTenantTx(database, req.ctx, (tx) =>
            conns.activate(tx, d, req.params.id, v, req.body),
          );
          setVersion(reply, c.version);
          return c;
        },
      );

      // ── Safe lifecycle operations (impact preview first) ──
      app.get(
        '/integration/connections/:id/lifecycle-preview',
        {
          schema: {
            tags,
            params: connParams,
            querystring: lifecyclePreviewQuery,
            response: { 200: lifecyclePreview },
          },
        },
        (req) =>
          withTenantTx(database, req.ctx, (tx) =>
            conns.previewLifecycle(
              tx,
              d,
              req.params.id,
              req.query.action,
              req.query.replacementConnectionId
                ? { replacementConnectionId: req.query.replacementConnectionId }
                : {},
            ),
          ),
      );
      app.post(
        '/integration/connections/:id/pause',
        { schema: { tags, params: connParams, body: pauseInput, response: { 200: connection } } },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const c = await withTenantTx(database, req.ctx, (tx) =>
            conns.pause(tx, d, req.params.id, v, req.body),
          );
          setVersion(reply, c.version);
          return c;
        },
      );
      app.post(
        '/integration/connections/:id/resume',
        { schema: { tags, params: connParams, body: resumeInput, response: { 200: connection } } },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const c = await withTenantTx(database, req.ctx, (tx) =>
            conns.resume(tx, d, req.params.id, v, req.body),
          );
          setVersion(reply, c.version);
          return c;
        },
      );
      app.post(
        '/integration/connections/:id/disconnect',
        { schema: { tags, params: connParams, body: disconnectInput, response: { 200: connection } } },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const c = await withTenantTx(database, req.ctx, (tx) =>
            conns.disconnect(tx, d, req.params.id, v, req.body),
          );
          setVersion(reply, c.version);
          return c;
        },
      );
      app.post(
        '/integration/connections/:id/replace',
        {
          schema: {
            tags,
            params: connParams,
            body: replaceInput,
            response: { 200: z.object({ replaced: connection, replacement: connection }) },
          },
        },
        (req) => {
          const v = requireIfMatch(req);
          return withTenantTx(database, req.ctx, (tx) => conns.replace(tx, d, req.params.id, v, req.body));
        },
      );
      app.post(
        '/integration/connections/:id/credentials/rotate',
        { schema: { tags, params: connParams, body: rotateCredentialInput, response: { 200: connection } } },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const c = await conns.rotateCredential(database, d, req.ctx, req.params.id, v, req.body);
          setVersion(reply, c.version);
          return c;
        },
      );
      app.get(
        '/integration/connections/:id/credentials',
        { schema: { tags, params: connParams, response: { 200: items(credentialView) } } },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, async (tx) => {
            const c = await loadConnection(tx, req.params.id);
            requireOnConnection(tx, c, P.connectionRead, 'any');
            return listCredentials(tx, req.params.id);
          }),
        }),
      );
      app.post(
        '/integration/connections/:id/vendor-notices',
        {
          schema: {
            tags,
            params: connParams,
            body: vendorNoticeInput,
            response: { 201: z.object({ id: z.uuid() }) },
          },
        },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            {
              scope: `POST /integration/connections/${req.params.id}/vendor-notices`,
              key,
              request: req.body,
            },
            async (tx) => ({
              status: 201,
              body: await conns.recordVendorNotice(tx, d, req.params.id, req.body),
            }),
          );
          return reply.status(201).send(res.body);
        },
      );
      app.post(
        '/integration/connections/:id/vendor-notices/:noticeId/complete',
        { schema: { tags, params: z.object({ id: z.uuid(), noticeId: z.uuid() }) } },
        async (req, reply) => {
          await withTenantTx(database, req.ctx, (tx) =>
            conns.completeVendorNotice(tx, d, req.params.id, req.params.noticeId),
          );
          return reply.status(204).send();
        },
      );

      // ── Health ──
      app.get(
        '/integration/connections/:id/health',
        { schema: { tags, params: connParams, response: { 200: connectionHealth } } },
        (req) => withTenantTx(database, req.ctx, (tx) => health.getConnectionHealth(tx, d, req.params.id)),
      );
      app.get(
        '/integration/health',
        { schema: { tags, querystring: healthQuery, response: { 200: portfolioHealth } } },
        (req) => withTenantTx(database, req.ctx, (tx) => health.portfolioHealth(tx, d, req.query)),
      );

      // ── Exchange, sync runs, files, outbound ──
      app.get(
        '/integration/connections/:id/exchanges',
        {
          schema: {
            tags,
            params: connParams,
            querystring: exchangeQuery,
            response: { 200: items(exchangeEntry) },
          },
        },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, (tx) =>
            ex.listExchanges(tx, req.params.id, req.query),
          ),
        }),
      );
      app.get(
        '/integration/connections/:id/sync-runs',
        { schema: { tags, params: connParams, response: { 200: items(syncRun) } } },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, (tx) => ex.listSyncRuns(tx, req.params.id)),
        }),
      );
      // Re-running a sync is harmless (inbound records are deduplicated), so no Idempotency-Key is required.
      app.post(
        '/integration/connections/:id/sync-runs',
        { schema: { tags, params: connParams, body: manualSyncInput, response: { 201: syncRun } } },
        async (req, reply) => {
          const run = await ex.runSync(database, d, req.ctx, req.params.id, {
            trigger: req.body.kind,
            ...(req.body.workflow ? { workflow: req.body.workflow } : {}),
          });
          return reply.status(201).send(run);
        },
      );
      app.post(
        '/integration/connections/:id/files/import',
        {
          schema: {
            tags,
            params: connParams,
            body: fileImportInput,
            response: {
              201: z.object({ fileId: z.uuid(), storedAsSample: z.boolean(), syncRun: syncRun.nullable() }),
            },
          },
        },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: `POST /integration/connections/${req.params.id}/files/import`, key, request: req.body },
            async (tx) => ({
              status: 201,
              body: await ex.importFile(tx, d, req.params.id, req.body),
            }),
          );
          return reply.status(201).send(res.body);
        },
      );
      app.post(
        '/integration/connections/:id/files/export',
        { schema: { tags, params: connParams, body: fileExportInput, response: { 201: exportedFile } } },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: `POST /integration/connections/${req.params.id}/files/export`, key, request: req.body },
            async (tx) => ({
              status: 201,
              body: await ex.exportFile(tx, d, req.params.id, req.body),
            }),
          );
          return reply.status(201).send(res.body);
        },
      );
      app.get(
        '/integration/connections/:id/outbound',
        {
          schema: {
            tags,
            params: connParams,
            querystring: outboundQuery,
            response: { 200: items(outboundCommand) },
          },
        },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, (tx) =>
            ex.listOutbound(tx, req.params.id, req.query.status),
          ),
        }),
      );
      app.post(
        '/integration/connections/:id/outbound/dispatch',
        { schema: { tags, params: connParams } },
        (req) => ex.dispatchOutbound(database, d, req.ctx, req.params.id, { manual: true }),
      );
      app.post(
        '/integration/outbound/:commandId/revalidate',
        {
          schema: {
            tags,
            params: z.object({ commandId: z.uuid() }),
            body: revalidateInput,
            response: { 200: outboundCommand },
          },
        },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const c = await withTenantTx(database, req.ctx, (tx) =>
            ex.revalidateCommand(tx, d, req.params.commandId, v, req.body),
          );
          setVersion(reply, c.version);
          return c;
        },
      );

      // ── Exceptions and "My work" ──
      app.get(
        '/integration/exceptions',
        { schema: { tags, querystring: exceptionsQuery, response: { 200: items(integrationException) } } },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, (tx) => exc.listExceptions(tx, req.query)),
        }),
      );
      app.get(
        '/integration/exceptions/:id',
        { schema: { tags, params: idParams, response: { 200: integrationException } } },
        async (req, reply) => {
          const e = await withTenantTx(database, req.ctx, (tx) => exc.getException(tx, req.params.id));
          setVersion(reply, e.version);
          return e;
        },
      );
      app.post(
        '/integration/exceptions/:id/assign',
        {
          schema: {
            tags,
            params: idParams,
            body: assignExceptionInput,
            response: { 200: integrationException },
          },
        },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const e = await withTenantTx(database, req.ctx, (tx) =>
            exc.assignException(tx, { exceptionId: req.params.id, ...req.body, expectedVersion: v }),
          );
          setVersion(reply, e.version);
          return e;
        },
      );
      app.post(
        '/integration/exceptions/:id/resolve',
        {
          schema: {
            tags,
            params: idParams,
            body: resolveExceptionInput,
            response: { 200: integrationException },
          },
        },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const e = await withTenantTx(database, req.ctx, (tx) =>
            exc.resolveException(tx, {
              exceptionId: req.params.id,
              resolution: req.body.resolution,
              expectedVersion: v,
            }),
          );
          setVersion(reply, e.version);
          return e;
        },
      );
      app.post(
        '/integration/exceptions/:id/ignore',
        {
          schema: {
            tags,
            params: idParams,
            body: ignoreExceptionInput,
            response: { 200: integrationException },
          },
        },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const e = await withTenantTx(database, req.ctx, (tx) =>
            exc.ignoreException(tx, {
              exceptionId: req.params.id,
              reason: req.body.reason,
              expectedVersion: v,
            }),
          );
          setVersion(reply, e.version);
          return e;
        },
      );
      app.get(
        '/integration/my-work',
        {
          schema: {
            tags,
            querystring: z.object({ departmentId: z.array(z.uuid()).or(z.uuid()).optional() }),
            response: { 200: items(integrationException) },
          },
        },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, (tx) =>
            provider.listWorkItems(tx, {
              ...(req.ctx.actor.kind === 'user' ? { userId: req.ctx.actor.userId } : {}),
              ...(req.query.departmentId
                ? { departmentIds: ([] as string[]).concat(req.query.departmentId) }
                : {}),
            }),
          ),
        }),
      );

      // ── Partner webhooks ──
      app.get(
        '/integration/webhooks/subscriptions',
        { schema: { tags, response: { 200: items(webhookSubscription) } } },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, (tx) => hooks.listSubscriptions(tx)),
        }),
      );
      app.post(
        '/integration/webhooks/subscriptions',
        { schema: { tags, body: webhookSubscriptionInput, response: { 201: webhookSubscriptionCreated } } },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: 'POST /integration/webhooks/subscriptions', key, request: req.body },
            async (tx) => {
              const created = await hooks.createSubscription(tx, d, req.body);
              // The signing secret is shown once: a replayed request returns the subscription without it.
              return {
                status: 201,
                body: { ...created, signingSecret: '' } as typeof created,
                secret: created.signingSecret,
              };
            },
          );
          const secret = (res as unknown as { secret?: string }).secret;
          return reply.status(201).send({
            ...res.body,
            signingSecret: res.replayed
              ? '(shown once at creation — rotate the secret to get a new one)'
              : (secret ?? ''),
          });
        },
      );
      app.get(
        '/integration/webhooks/subscriptions/:id',
        { schema: { tags, params: idParams, response: { 200: webhookSubscription } } },
        async (req, reply) => {
          const s = await withTenantTx(database, req.ctx, (tx) => hooks.getSubscription(tx, req.params.id));
          setVersion(reply, s.version);
          return s;
        },
      );
      app.patch(
        '/integration/webhooks/subscriptions/:id',
        {
          schema: {
            tags,
            params: idParams,
            body: webhookSubscriptionUpdate,
            response: { 200: webhookSubscription },
          },
        },
        async (req, reply) => {
          const v = requireIfMatch(req);
          const s = await withTenantTx(database, req.ctx, (tx) =>
            hooks.updateSubscription(tx, d, req.params.id, v, req.body),
          );
          setVersion(reply, s.version);
          return s;
        },
      );
      app.post(
        '/integration/webhooks/subscriptions/:id/rotate-secret',
        {
          schema: {
            tags,
            params: idParams,
            body: rotateSigningSecretInput,
            response: { 200: rotatedSigningSecret },
          },
        },
        (req) => {
          const v = requireIfMatch(req);
          return withTenantTx(database, req.ctx, (tx) =>
            hooks.rotateSigningSecret(tx, d, req.params.id, v, req.body.overlapHours),
          );
        },
      );
      app.post(
        '/integration/webhooks/subscriptions/:id/test',
        { schema: { tags, params: idParams, response: { 201: webhookDelivery } } },
        async (req, reply) => {
          const del = await withTenantTx(database, req.ctx, (tx) => hooks.sendTestEvent(tx, req.params.id));
          return reply.status(201).send(del);
        },
      );
      app.get(
        '/integration/webhooks/subscriptions/:id/deliveries',
        {
          schema: {
            tags,
            params: idParams,
            querystring: z.object({ status: webhookDelivery.shape.status.optional() }),
            response: { 200: items(webhookDelivery) },
          },
        },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, (tx) =>
            hooks.listDeliveries(tx, req.params.id, req.query.status),
          ),
        }),
      );
      app.post(
        '/integration/webhooks/subscriptions/:id/replay',
        {
          schema: {
            tags,
            params: idParams,
            body: replayRangeInput,
            response: { 201: z.object({ replayed: z.number().int() }) },
          },
        },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            {
              scope: `POST /integration/webhooks/subscriptions/${req.params.id}/replay`,
              key,
              request: req.body,
            },
            async (tx) => ({
              status: 201,
              body: await hooks.replayRange(tx, req.params.id, req.body),
            }),
          );
          return reply.status(201).send(res.body);
        },
      );
      app.post(
        '/integration/webhooks/deliveries/:deliveryId/replay',
        {
          schema: {
            tags,
            params: z.object({ deliveryId: z.uuid() }),
            body: replayDeliveryInput,
            response: { 201: webhookDelivery },
          },
        },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            {
              scope: `POST /integration/webhooks/deliveries/${req.params.deliveryId}/replay`,
              key,
              request: req.body,
            },
            async (tx) => ({
              status: 201,
              body: await hooks.replayDelivery(tx, req.params.deliveryId, req.body.reason),
            }),
          );
          return reply.status(201).send(res.body);
        },
      );

      // ── Simulated PMS (demonstration and testing) ──
      app.post(
        '/integration/simulators/pms',
        {
          schema: {
            tags,
            body: z.object({
              seed: z.boolean().default(true),
              keyExpiresAt: z.iso.datetime().optional(),
              readOnlyKey: z.boolean().optional(),
            }),
            response: { 201: simulatorAccountCreated },
          },
        },
        async (req, reply) => {
          const res = await withTenantTx(database, req.ctx, (tx) => sims.createPmsSimulator(tx, d, req.body));
          return reply.status(201).send(res);
        },
      );
      app.get(
        '/integration/simulators/pms/:accountId',
        { schema: { tags, params: z.object({ accountId: z.string().min(1).max(100) }) } },
        (req) =>
          withTenantTx(database, req.ctx, async (tx) =>
            sims.describePmsSimulator(tx, d, req.params.accountId),
          ),
      );
      app.patch(
        '/integration/simulators/pms/:accountId/faults',
        {
          schema: {
            tags,
            params: z.object({ accountId: z.string().min(1).max(100) }),
            body: simulatorFaults,
          },
        },
        (req) =>
          withTenantTx(database, req.ctx, (tx) =>
            sims.setPmsSimulatorFaults(tx, d, req.params.accountId, req.body),
          ),
      );
      app.post(
        '/integration/simulators/pms/:accountId/events',
        {
          schema: {
            tags,
            params: z.object({ accountId: z.string().min(1).max(100) }),
            body: simulatorEventInput,
          },
        },
        async (req, reply) => {
          const res = await withTenantTx(database, req.ctx, async (tx) =>
            sims.generatePmsSimulatorEvent(tx, d, req.params.accountId, req.body),
          );
          return reply.status(201).send(res);
        },
      );
    },
  };
}
