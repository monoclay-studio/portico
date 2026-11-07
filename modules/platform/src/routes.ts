import { type PorticoDatabase, runIdempotent, withTenantTx } from '@portico/db';
import { type HttpModule, idParams, requireIdempotencyKey, requireIfMatch, setVersion } from '@portico/http';
import { requirePermission } from '@portico/kernel';
import { z } from 'zod';
import {
  dataAuthority,
  legalEntity,
  legalEntityInput,
  organization,
  policyValue,
  property,
  propertyInput,
  propertyUpdate,
} from './contracts';
import type { PlatformPorts } from './ports';
import { registerEnterpriseRoutes } from './routes-enterprise';
import * as svc from './service';

export function platformHttp(deps: { database: PorticoDatabase; ports?: PlatformPorts }): HttpModule {
  const { database } = deps;
  const ports = deps.ports ?? {};
  return {
    name: 'platform',
    routes(app) {
      registerEnterpriseRoutes(app, database, ports);

      app.get(
        '/organization',
        { schema: { tags: ['Organization'], response: { 200: organization } } },
        (req) => withTenantTx(database, req.ctx, (tx) => svc.getOrganization(tx)),
      );

      app.get(
        '/legal-entities',
        { schema: { tags: ['Organization'], response: { 200: z.object({ items: z.array(legalEntity) }) } } },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, (tx) => svc.listLegalEntities(tx)),
        }),
      );

      app.post(
        '/legal-entities',
        { schema: { tags: ['Organization'], body: legalEntityInput, response: { 201: legalEntity } } },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: 'POST /legal-entities', key, request: req.body },
            async (tx) => ({
              status: 201,
              body: await svc.createLegalEntity(tx, req.body),
            }),
          );
          return reply.status(201).send(res.body);
        },
      );

      app.get(
        '/properties',
        { schema: { tags: ['Properties'], response: { 200: z.object({ items: z.array(property) }) } } },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, (tx) => svc.listProperties(tx)),
        }),
      );

      app.post(
        '/properties',
        { schema: { tags: ['Properties'], body: propertyInput, response: { 201: property } } },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: 'POST /properties', key, request: req.body },
            async (tx) => ({
              status: 201,
              body: await svc.createProperty(tx, req.body),
            }),
          );
          setVersion(reply, res.body.version);
          return reply.status(201).send(res.body);
        },
      );

      app.get(
        '/properties/:id',
        { schema: { tags: ['Properties'], params: idParams, response: { 200: property } } },
        async (req, reply) => {
          const p = await withTenantTx(database, req.ctx, (tx) => svc.getProperty(tx, req.params.id));
          setVersion(reply, p.version);
          return p;
        },
      );

      // UX round 1 INT-03 / SET-05 (read side): who is the system of record per domain, the resolved value of a
      // policy with its source, and a preview of a policy change across properties. Writes (authority transitions,
      // policy changes) follow the identity-plus approval rules and are not exposed here yet.
      app.get(
        '/properties/:id/data-authority',
        {
          schema: {
            tags: ['Properties'],
            params: idParams,
            response: { 200: z.object({ items: z.array(dataAuthority) }) },
          },
        },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, async (tx) => {
            await svc.getProperty(tx, req.params.id); // 404 for a property this organization does not have
            return svc.listDataAuthority(tx, req.params.id);
          }),
        }),
      );

      app.get(
        '/properties/:id/policies/:key',
        {
          schema: {
            tags: ['Policies'],
            params: z.object({ id: z.uuid(), key: z.string().regex(/^[a-zA-Z0-9_.-]{1,120}$/) }),
            response: { 200: policyValue },
          },
        },
        (req) =>
          withTenantTx(database, req.ctx, async (tx) => {
            requirePermission(tx, 'platform.property.read', { propertyId: req.params.id });
            await svc.getProperty(tx, req.params.id); // 404 for a property this organization does not have
            const r = await svc.resolvePolicy<unknown>(tx, req.params.id, req.params.key, null);
            return { key: r.key, value: r.value, source: r.source, isLocalOverride: r.isLocalOverride };
          }),
      );

      app.post(
        '/policies/preview',
        {
          schema: {
            tags: ['Policies'],
            body: z.object({
              key: z.string().regex(/^[a-zA-Z0-9_.-]{1,120}$/),
              scopeType: z.enum(['organization', 'brand', 'region', 'property']),
              scopeId: z.uuid(),
              value: z.unknown(),
              defaultValue: z.unknown().optional(),
            }),
          },
        },
        (req) =>
          withTenantTx(database, req.ctx, (tx) =>
            svc.previewPolicyChange(tx, { ...req.body, defaultValue: req.body.defaultValue ?? null }),
          ),
      );

      app.patch(
        '/properties/:id',
        {
          schema: {
            tags: ['Properties'],
            params: idParams,
            body: propertyUpdate,
            response: { 200: property },
          },
        },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const p = await withTenantTx(database, req.ctx, (tx) =>
            svc.updateProperty(tx, req.params.id, expected, req.body),
          );
          setVersion(reply, p.version);
          return p;
        },
      );
    },
  };
}
