import { type PorticoDatabase, runIdempotent, withTenantTx } from '@portico/db';
import { type HttpModule, idParams, requireIdempotencyKey, requireIfMatch, setVersion } from '@portico/http';
import { z } from 'zod';
import {
  legalEntity,
  legalEntityInput,
  organization,
  property,
  propertyInput,
  propertyUpdate,
} from './contracts';
import * as svc from './service';

export function platformHttp(deps: { database: PorticoDatabase }): HttpModule {
  const { database } = deps;
  return {
    name: 'platform',
    routes(app) {
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
