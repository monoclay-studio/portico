import { type PorticoDatabase, runIdempotent, withTenantTx } from '@portico/db';
import { type Authenticator, bearerToken, type HttpModule, requireIdempotencyKey } from '@portico/http';
import { BusinessRuleError, requirePermission } from '@portico/kernel';
import { z } from 'zod';
import { createUserRequest, loginRequest, loginResponse, me, userSummary } from './contracts';
import * as svc from './service';

export function identityAuthenticator(database: PorticoDatabase, ports: svc.IdentityPorts): Authenticator {
  return {
    async authenticate(req) {
      const token = bearerToken(req);
      if (!token) return null;
      return svc.authenticateToken(database, token, ports);
    },
  };
}

export function identityHttp(deps: { database: PorticoDatabase }): HttpModule {
  const { database } = deps;
  return {
    name: 'identity',
    routes(app) {
      app.post(
        '/auth/login',
        {
          config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } },
          schema: { tags: ['Authentication'], body: loginRequest, response: { 200: loginResponse } },
        },
        async (req) => {
          const res = await svc.login(database, {
            ...req.body,
            ip: req.ip,
            ...(req.headers['user-agent'] ? { userAgent: req.headers['user-agent'] } : {}),
          });
          return res.status === 'signed_in' ? { ...res, expiresAt: res.expiresAt.toISOString() } : res;
        },
      );

      app.post(
        '/auth/logout',
        { schema: { tags: ['Authentication'], response: { 204: z.null() } } },
        async (req, reply) => {
          const actor = req.ctx.actor;
          if (actor.kind === 'user' && actor.sessionId) {
            const sessionId = actor.sessionId;
            await withTenantTx(database, req.ctx, (tx) => svc.revokeSession(tx, sessionId, 'logout'));
          }
          return reply.status(204).send(null);
        },
      );

      app.get('/me', { schema: { tags: ['Authentication'], response: { 200: me } } }, async (req) => {
        const actor = req.ctx.actor;
        if (actor.kind !== 'user')
          throw new BusinessRuleError('not_a_user', 'This endpoint is for signed-in staff members.');
        return withTenantTx(database, req.ctx, (tx) => svc.getMe(tx, actor.userId));
      });

      app.get(
        '/users',
        { schema: { tags: ['Users'], response: { 200: z.object({ items: z.array(userSummary) }) } } },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, (tx) => svc.listUsers(tx)),
        }),
      );

      app.post(
        '/users',
        {
          schema: {
            tags: ['Users'],
            body: createUserRequest,
            response: { 201: z.object({ userId: z.uuid() }) },
          },
        },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: 'POST /users', key, request: { ...req.body, initialPassword: undefined } },
            async (tx) => ({
              status: 201,
              body: await svc.createUser(tx, req.body),
            }),
          );
          return reply.status(201).send(res.body);
        },
      );

      app.get('/roles', { schema: { tags: ['Users'] } }, async (req) => {
        requirePermission(req.ctx, 'identity.user.read');
        return { items: await withTenantTx(database, req.ctx, (tx) => svc.listRoles(tx)) };
      });
    },
  };
}
