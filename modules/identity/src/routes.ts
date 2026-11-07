import { type PorticoDatabase, runIdempotent, type TxContext, withTenantTx } from '@portico/db';
import {
  type Authenticator,
  bearerToken,
  type HttpModule,
  idParams,
  type PorticoApp,
  requireIdempotencyKey,
  requireIfMatch,
  setVersion,
  toProblem,
} from '@portico/http';
import {
  BusinessRuleError,
  ConflictError,
  DomainError,
  requirePermission,
  UnauthenticatedError,
} from '@portico/kernel';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { readDevMailbox } from './adapters';
import * as svc from './api';
import {
  acceptInvitationRequest,
  apiClientCreated,
  apiClientRequest,
  apiClientSummary,
  cloneRoleRequest,
  createRoleRequest,
  createUserRequest,
  createUserResponse,
  credentialProof,
  delivery,
  devMailboxMessage,
  elevationRequest,
  elevationView,
  inviteRequest,
  inviteResponse,
  loginRequest,
  loginResponse,
  me,
  memberDetail,
  memberUpdate,
  mfaChallengeRequest,
  mfaStatusResponse,
  myInvitation,
  passwordResetComplete,
  passwordResetRequest,
  permissionCatalog,
  reasonRequest,
  recoveryCodesResponse,
  roleGrant,
  rolePreviewRequest,
  rolePreviewResponse,
  roleView,
  scimGroupRequest,
  scimListQuery,
  scimPatchRequest,
  scimUserRequest,
  securityAlert,
  securityPolicy,
  securityPolicyUpdate,
  sessionSummary,
  ssoCallbackRequest,
  ssoConfigRequest,
  ssoConnection,
  ssoDomain,
  ssoDomainRequest,
  ssoEnforcementRequest,
  ssoMappingsRequest,
  ssoStartRequest,
  ssoStartResponse,
  stepUpRequest,
  stepUpResponse,
  supportAccessLogEntry,
  supportSession,
  supportSessionRequest,
  totpConfirmRequest,
  totpEnrolResponse,
  transferPlan,
  transferRequest,
  updateRoleRequest,
  userSummary,
} from './contracts';
import { isExplainingAuthorizer } from './domain/step-up';
import { MfaEnrollmentRequiredError, MfaRequiredError } from './errors';
import type { IdentityPorts, Operator } from './ports';
import { ScimError } from './services/scim';

export function identityAuthenticator(database: PorticoDatabase, ports: IdentityPorts): Authenticator {
  return {
    async authenticate(req) {
      const token = bearerToken(req);
      if (!token) return null;
      return svc.authenticateToken(database, token, ports, { method: req.method, path: req.url });
    },
  };
}

const noPorts: IdentityPorts = { propertyIdsInScope: async () => [] };
const signedIn = loginResponse.options[0];

function serializeLogin(res: svc.LoginResult): z.infer<typeof loginResponse> {
  if (res.status === 'select_organization') return res;
  return { ...res, expiresAt: res.expiresAt.toISOString() };
}

function origin(req: FastifyRequest) {
  return { ip: req.ip, ...(req.headers['user-agent'] ? { userAgent: req.headers['user-agent'] } : {}) };
}

async function maybeIdempotent<T>(
  database: PorticoDatabase,
  req: FastifyRequest,
  scope: string,
  request: unknown,
  fn: (tx: TxContext) => Promise<T>,
): Promise<T> {
  const key = req.headers['idempotency-key'];
  if (typeof key === 'string' && key.length > 0) {
    return (
      await runIdempotent(database, req.ctx, { scope, key, request }, async (tx) => ({
        status: 200,
        body: await fn(tx),
      }))
    ).body;
  }
  return withTenantTx(database, req.ctx, fn);
}

/** Credential changes return their failure (so the failure counter commits) and are thrown here, after commit. */
function unwrap<T>(outcome: svc.Outcome<T>): T {
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

function currentUserId(req: FastifyRequest): string {
  const a = req.ctx.actor;
  if (a.kind !== 'user')
    throw new BusinessRuleError('not_a_user', 'This endpoint is for signed-in staff members.');
  return a.userId;
}

/**
 * Central step-up translation: when a route refused with plain `forbidden` but the permission IS granted by role
 * and only blocked by the MFA policy, the response becomes `mfa_required` / `mfa_enrollment_required` so the client
 * can prompt for a code. Modules keep calling `requirePermission` and never see MFA.
 */
function installStepUpTranslator(app: PorticoApp) {
  app.addHook('onSend', async (req, reply, payload) => {
    if (reply.statusCode !== 403 || typeof payload !== 'string' || !req.auth) return payload;
    const authz = req.auth.authz;
    if (!isExplainingAuthorizer(authz)) return payload;
    let problem: {
      code?: string;
      details?: { permission?: string; scope?: { propertyId?: string; reason?: string } };
    };
    try {
      problem = JSON.parse(payload);
    } catch {
      return payload;
    }
    const permission = problem.details?.permission;
    if (problem.code !== 'forbidden' || !permission) return payload;
    const scope = problem.details?.scope;
    // Identity's own escalation refusals ("you can only grant what you hold") carry a reason, not a property:
    // stepping up would not help, so they stay `forbidden` (P2-1). Only a property scope is passed on.
    if (scope?.reason) return payload;
    const denial = authz.explainDenial(
      permission,
      scope?.propertyId ? { propertyId: scope.propertyId } : undefined,
    );
    if (!denial) return payload;
    const err =
      denial === 'mfa_required'
        ? new MfaRequiredError({ permission, stepUpWindowMinutes: authz.stepUp.stepUpWindowMinutes })
        : new MfaEnrollmentRequiredError({ permission });
    return JSON.stringify(toProblem(err, String(req.id)));
  });
}

async function requireOperator(ports: IdentityPorts, req: FastifyRequest): Promise<Operator> {
  // P2-17: static operator tokens have no expiry and no MFA, so the console is off in production until operators
  // sign in through AWS IAM Identity Center (launch gate in the readiness register).
  if (ports.config?.operatorConsoleEnabled === false)
    throw new DomainError(
      'operator_console_disabled',
      'The operator console is disabled in this deployment until operator sign-in uses AWS IAM Identity Center.',
      { status: 403 },
    );
  const token = bearerToken(req);
  const op = token && ports.operators ? ports.operators.authenticate(token) : null;
  if (!op)
    throw new UnauthenticatedError('Monoclay operator credentials are required for the operator console.');
  return op;
}

export function identityHttp(deps: { database: PorticoDatabase; ports?: IdentityPorts }): HttpModule {
  const { database } = deps;
  const ports = deps.ports ?? noPorts;
  return {
    name: 'identity',
    routes(app) {
      installStepUpTranslator(app);
      registerAuthRoutes(app, database, ports);
      registerSelfRoutes(app, database, ports);
      registerAdminRoutes(app, database, ports);
      registerSecurityRoutes(app, database, ports);
      registerSsoRoutes(app, database, ports);
      registerScimRoutes(app, database, ports);
      registerOperatorRoutes(app, database, ports);
    },
  };
}

// ───────────────────────────── Public authentication ─────────────────────────────

function registerAuthRoutes(app: PorticoApp, database: PorticoDatabase, ports: IdentityPorts) {
  const limited = (max: number) => ({ public: true, rateLimit: { max, timeWindow: '1 minute' } });
  app.post(
    '/auth/login',
    {
      config: limited(20),
      schema: { tags: ['Authentication'], body: loginRequest, response: { 200: loginResponse } },
    },
    async (req) => serializeLogin(await svc.login(database, { ...req.body, ...origin(req) }, ports)),
  );
  app.post(
    '/auth/login/mfa',
    {
      config: limited(20),
      schema: { tags: ['Authentication'], body: mfaChallengeRequest, response: { 200: signedIn } },
    },
    async (req) => {
      const res = await svc.completeMfaChallenge(database, ports, { ...req.body, ...origin(req) });
      return { ...res, expiresAt: res.expiresAt.toISOString() };
    },
  );
  app.post(
    '/auth/logout',
    { schema: { tags: ['Authentication'], response: { 204: z.null() } } },
    async (req, reply) => {
      const actor = req.ctx.actor;
      if (actor.kind === 'user' && actor.sessionId && !actor.impersonatedBy) {
        const sessionId = actor.sessionId;
        await withTenantTx(database, req.ctx, (tx) => svc.revokeSession(tx, sessionId, 'logout'));
      }
      return reply.status(204).send(null);
    },
  );
  app.post(
    '/auth/sso/start',
    {
      config: limited(30),
      schema: { tags: ['Single sign-on'], body: ssoStartRequest, response: { 200: ssoStartResponse } },
    },
    async (req) => {
      const r = await svc.startSsoLogin(database, ports, req.body);
      return {
        authorizationUrl: r.authorizationUrl,
        expiresAt: r.expiresAt.toISOString(),
        browserBinding: r.browserBinding,
      };
    },
  );
  app.post(
    '/auth/sso/callback',
    {
      config: limited(30),
      schema: { tags: ['Single sign-on'], body: ssoCallbackRequest, response: { 200: signedIn } },
    },
    async (req) => {
      const res = await svc.completeSsoLogin(database, ports, { ...req.body, ...origin(req) });
      return { ...res, expiresAt: res.expiresAt.toISOString() };
    },
  );
  app.post(
    '/auth/invitations/accept',
    {
      config: limited(20),
      schema: {
        tags: ['Authentication'],
        body: acceptInvitationRequest,
        response: { 200: z.object({ organizationId: z.uuid(), userId: z.uuid() }) },
      },
    },
    (req) => svc.acceptInvitation(database, ports, req.body),
  );
  app.post(
    '/auth/password-reset',
    {
      config: limited(5),
      schema: {
        tags: ['Authentication'],
        body: passwordResetRequest,
        response: { 202: z.object({ status: z.literal('accepted') }) },
      },
    },
    async (req, reply) => {
      // Same answer whether or not the email exists (no account enumeration).
      await svc
        .requestPasswordReset(database, ports, req.body)
        .catch((err: unknown) => req.log.error({ err }, 'password reset failed'));
      return reply.status(202).send({ status: 'accepted' as const });
    },
  );
  app.post(
    '/auth/password-reset/complete',
    {
      config: limited(10),
      schema: {
        tags: ['Authentication'],
        body: passwordResetComplete,
        response: { 200: z.object({ sessionsRevoked: z.number().int() }) },
      },
    },
    (req) => svc.completePasswordReset(database, req.body),
  );
}

// ───────────────────────────── Self-service (MFA, sessions, emergency access) ─────────────────────────────

function registerSelfRoutes(app: PorticoApp, database: PorticoDatabase, ports: IdentityPorts) {
  app.get('/me', { schema: { tags: ['Authentication'], response: { 200: me } } }, async (req) => {
    const userId = currentUserId(req);
    const base = await withTenantTx(database, req.ctx, (tx) => svc.getMe(tx, userId));
    const authz = req.ctx.authz;
    const actor = req.ctx.actor as typeof req.ctx.actor & { elevationId?: string };
    const s = isExplainingAuthorizer(authz) ? authz.stepUp : null;
    return {
      ...base,
      ...(s
        ? {
            mfa: {
              enrolled: s.mfaEnrolled,
              verifiedAt: s.mfaVerifiedAt?.toISOString() ?? null,
              stepUpValidUntil: s.mfaVerifiedAt
                ? new Date(s.mfaVerifiedAt.getTime() + s.stepUpWindowMinutes * 60_000).toISOString()
                : null,
              enrolmentGraceEndsAt: s.mfaEnrolled ? null : (s.enrolmentGraceEndsAt?.toISOString() ?? null),
              requiredForSensitive: true,
            },
          }
        : {}),
      ...(actor.elevationId ? { elevation: { elevationId: actor.elevationId } } : {}),
    };
  });
  app.get(
    '/me/mfa',
    { schema: { tags: ['Two-step verification'], response: { 200: mfaStatusResponse } } },
    (req) => withTenantTx(database, req.ctx, (tx) => svc.mfaStatus(tx, currentUserId(req))),
  );
  // ADR-0017 §4: changing a global credential needs proof of the existing one (current code or recovery code when
  // enrolled, otherwise the current password); a fresh session is not enough.
  app.post(
    '/me/mfa/totp',
    {
      schema: {
        tags: ['Two-step verification'],
        body: credentialProof,
        response: { 200: totpEnrolResponse },
      },
    },
    async (req) => unwrap(await withTenantTx(database, req.ctx, (tx) => svc.enrolTotp(tx, ports, req.body))),
  );
  app.post(
    '/me/mfa/totp/confirm',
    {
      schema: {
        tags: ['Two-step verification'],
        body: totpConfirmRequest,
        response: { 200: recoveryCodesResponse },
      },
    },
    (req) => withTenantTx(database, req.ctx, (tx) => svc.confirmTotp(tx, ports, req.body)),
  );
  app.post(
    '/auth/mfa/verify',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { tags: ['Two-step verification'], body: stepUpRequest, response: { 200: stepUpResponse } },
    },
    async (req) => {
      const outcome = await withTenantTx(database, req.ctx, (tx) => svc.stepUp(tx, ports, req.body));
      if (!outcome.ok) throw svc.stepUpFailure(outcome);
      return { verifiedAt: outcome.verifiedAt, method: outcome.method };
    },
  );
  app.post(
    '/me/mfa/recovery-codes',
    {
      schema: {
        tags: ['Two-step verification'],
        body: credentialProof,
        response: { 200: recoveryCodesResponse },
      },
    },
    async (req) =>
      unwrap(await withTenantTx(database, req.ctx, (tx) => svc.regenerateRecoveryCodes(tx, ports, req.body))),
  );
  const disableMfa = async (
    req: FastifyRequest<{ Body: z.infer<typeof credentialProof> }>,
    reply: FastifyReply,
  ) => {
    unwrap(await withTenantTx(database, req.ctx, (tx) => svc.disableOwnMfa(tx, ports, req.body)));
    return reply.status(204).send(null);
  };
  const disableSchema = {
    schema: { tags: ['Two-step verification'], body: credentialProof, response: { 204: z.null() } },
  };
  app.delete('/me/mfa', disableSchema, disableMfa);
  // Same as DELETE /me/mfa for clients that cannot send a body with DELETE.
  app.post('/me/mfa/disable', disableSchema, disableMfa);
  app.get(
    '/me/invitations',
    { schema: { tags: ['Authentication'], response: { 200: z.object({ items: z.array(myInvitation) }) } } },
    async (req) => ({ items: await svc.listMyInvitations(database, req.ctx.actor) }),
  );
  app.post(
    '/me/invitations/:organizationId/accept',
    {
      schema: {
        tags: ['Authentication'],
        params: z.object({ organizationId: z.uuid() }),
        response: { 200: z.object({ organizationId: z.uuid(), userId: z.uuid() }) },
      },
    },
    (req) => svc.acceptMembershipAsSelf(database, req.ctx.actor, req.params.organizationId),
  );
  app.get(
    '/me/sessions',
    { schema: { tags: ['Sessions'], response: { 200: z.object({ items: z.array(sessionSummary) }) } } },
    async (req) => ({
      items: await withTenantTx(database, req.ctx, (tx) => svc.listSessions(tx, currentUserId(req))),
    }),
  );
  app.post(
    '/me/sessions/revoke-others',
    { schema: { tags: ['Sessions'], response: { 200: z.object({ revoked: z.number().int() }) } } },
    async (req) => ({
      revoked: await withTenantTx(database, req.ctx, (tx) =>
        svc.revokeAllSessions(tx, currentUserId(req), 'signed out elsewhere', { exceptCurrent: true }),
      ),
    }),
  );
  app.post(
    '/sessions/:id/revoke',
    { schema: { tags: ['Sessions'], params: idParams, body: reasonRequest, response: { 204: z.null() } } },
    async (req, reply) => {
      await withTenantTx(database, req.ctx, (tx) =>
        svc.revokeSessionById(tx, req.params.id, req.body.reason),
      );
      return reply.status(204).send(null);
    },
  );
  app.post(
    '/me/emergency-access',
    {
      schema: {
        tags: ['Emergency access'],
        body: elevationRequest,
        response: { 201: z.object({ elevationId: z.uuid(), endsAt: z.string(), role: z.string() }) },
      },
    },
    async (req, reply) =>
      reply
        .status(201)
        .send(await withTenantTx(database, req.ctx, (tx) => svc.startElevation(tx, ports, req.body))),
  );
  app.post(
    '/me/emergency-access/:id/end',
    { schema: { tags: ['Emergency access'], params: idParams, response: { 204: z.null() } } },
    async (req, reply) => {
      await withTenantTx(database, req.ctx, (tx) => svc.endElevation(tx, req.params.id));
      return reply.status(204).send(null);
    },
  );
}

// ───────────────────────────── Administration (staff, roles, catalog) ─────────────────────────────

function registerAdminRoutes(app: PorticoApp, database: PorticoDatabase, ports: IdentityPorts) {
  app.get(
    '/permissions',
    { schema: { tags: ['Roles'], response: { 200: permissionCatalog } } },
    async (req) => {
      requirePermission(req.ctx, 'identity.user.read');
      return svc.getPermissionCatalog(ports);
    },
  );
  app.get(
    '/users',
    { schema: { tags: ['Users'], response: { 200: z.object({ items: z.array(userSummary) }) } } },
    async (req) => ({ items: await withTenantTx(database, req.ctx, (tx) => svc.listUsers(tx)) }),
  );
  app.post(
    '/users',
    {
      schema: { tags: ['Users'], body: createUserRequest, response: { 201: createUserResponse } },
    },
    async (req, reply) => {
      const key = requireIdempotencyKey(req);
      const res = await runIdempotent(
        database,
        req.ctx,
        { scope: 'POST /users', key, request: { ...req.body, initialPassword: undefined } },
        async (tx) => {
          const created = await svc.createUser(tx, req.body);
          if (created.status === 'active') return { status: 201, body: created };
          // An existing person: they are invited and accept themselves (ADR-0017 §2). The link goes only to them.
          const sent = await svc.sendInvitation(tx, ports, {
            userId: created.userId,
            email: req.body.email,
            displayName: req.body.displayName,
          });
          return { status: 201, body: { ...created, ...sent } };
        },
      );
      return reply.status(201).send(res.body);
    },
  );
  app.post(
    '/users/invitations',
    { schema: { tags: ['Users'], body: inviteRequest, response: { 201: inviteResponse } } },
    async (req, reply) => {
      const key = requireIdempotencyKey(req);
      const roles = req.body.roles.map((r) => ({
        ...r,
        ...(r.startsAt ? { startsAt: new Date(r.startsAt) } : { startsAt: undefined }),
        ...(r.endsAt ? { endsAt: new Date(r.endsAt) } : { endsAt: undefined }),
      }));
      const res = await runIdempotent(
        database,
        req.ctx,
        { scope: 'POST /users/invitations', key, request: req.body },
        async (tx) => ({
          status: 201,
          body: await svc.inviteMember(tx, ports, { ...req.body, roles }),
        }),
      );
      return reply.status(201).send(res.body);
    },
  );
  app.get(
    '/users/:id',
    { schema: { tags: ['Users'], params: idParams, response: { 200: memberDetail } } },
    async (req, reply) => {
      const m = await withTenantTx(database, req.ctx, (tx) => svc.getMember(tx, req.params.id));
      setVersion(reply, m.version);
      return m;
    },
  );
  app.patch(
    '/users/:id',
    { schema: { tags: ['Users'], params: idParams, body: memberUpdate, response: { 200: memberDetail } } },
    async (req, reply) => {
      const expected = requireIfMatch(req);
      const m = await withTenantTx(database, req.ctx, (tx) =>
        svc.updateMember(tx, req.params.id, expected, req.body),
      );
      setVersion(reply, m.version);
      return m;
    },
  );
  app.post(
    '/users/:id/roles',
    { schema: { tags: ['Users'], params: idParams, body: roleGrant, response: { 201: memberDetail } } },
    async (req, reply) => {
      const key = requireIdempotencyKey(req);
      const res = await runIdempotent(
        database,
        req.ctx,
        { scope: `POST /users/${req.params.id}/roles`, key, request: req.body },
        async (tx) => {
          await svc.assignRole(
            tx,
            {
              userId: req.params.id,
              roleKey: req.body.roleKey,
              scopeType: req.body.scopeType,
              ...(req.body.scopeId ? { scopeId: req.body.scopeId } : {}),
              ...(req.body.reason ? { reason: req.body.reason } : {}),
              ...(req.body.startsAt ? { startsAt: new Date(req.body.startsAt) } : {}),
              ...(req.body.endsAt ? { endsAt: new Date(req.body.endsAt) } : {}),
            },
            ports,
          );
          return { status: 201, body: await svc.getMember(tx, req.params.id) };
        },
      );
      return reply.status(201).send(res.body);
    },
  );
  app.post(
    '/users/:id/roles/:assignmentId/revoke',
    {
      schema: {
        tags: ['Users'],
        params: z.object({ id: z.uuid(), assignmentId: z.uuid() }),
        body: reasonRequest,
        response: { 200: memberDetail },
      },
    },
    (req) =>
      withTenantTx(database, req.ctx, async (tx) => {
        await svc.revokeAssignment(tx, req.params.assignmentId, req.body.reason, ports);
        return svc.getMember(tx, req.params.id);
      }),
  );
  const transferInput = (id: string, body: z.infer<typeof transferRequest>) => ({
    userId: id,
    fromPropertyId: body.fromPropertyId,
    toPropertyId: body.toPropertyId,
    roleKeys: body.roleKeys,
    effectiveAt: body.effectiveAt ? new Date(body.effectiveAt) : undefined,
    reason: body.reason,
  });
  app.post(
    '/users/:id/transfer/preview',
    { schema: { tags: ['Users'], params: idParams, body: transferRequest, response: { 200: transferPlan } } },
    (req) =>
      withTenantTx(database, req.ctx, (tx) =>
        svc.previewTransfer(tx, transferInput(req.params.id, req.body)),
      ),
  );
  app.post(
    '/users/:id/transfer',
    { schema: { tags: ['Users'], params: idParams, body: transferRequest, response: { 200: transferPlan } } },
    async (req) => {
      const key = requireIdempotencyKey(req);
      return (
        await runIdempotent(
          database,
          req.ctx,
          { scope: `POST /users/${req.params.id}/transfer`, key, request: req.body },
          async (tx) => ({
            status: 200,
            body: await svc.transferMember(tx, ports, transferInput(req.params.id, req.body)),
          }),
        )
      ).body;
    },
  );
  app.post(
    '/users/:id/suspend',
    { schema: { tags: ['Users'], params: idParams, body: reasonRequest, response: { 200: memberDetail } } },
    (req) =>
      maybeIdempotent(database, req, `POST /users/${req.params.id}/suspend`, req.body, async (tx) => {
        await svc.suspendMember(tx, req.params.id, req.body.reason, ports);
        return svc.getMember(tx, req.params.id);
      }),
  );
  app.post(
    '/users/:id/reactivate',
    { schema: { tags: ['Users'], params: idParams, body: reasonRequest, response: { 200: memberDetail } } },
    (req) =>
      maybeIdempotent(database, req, `POST /users/${req.params.id}/reactivate`, req.body, (tx) =>
        svc.reactivateMember(tx, req.params.id, req.body.reason),
      ),
  );
  app.post(
    '/users/:id/remove',
    {
      schema: {
        tags: ['Users'],
        params: idParams,
        body: reasonRequest,
        response: {
          200: z.object({
            sessions: z.number().int(),
            assignments: z.number().int(),
            apiClients: z.number().int(),
          }),
        },
      },
    },
    (req) =>
      maybeIdempotent(database, req, `POST /users/${req.params.id}/remove`, req.body, (tx) =>
        svc.removeMember(tx, req.params.id, req.body.reason, ports),
      ),
  );
  app.post(
    '/users/:id/password-reset',
    {
      schema: {
        tags: ['Users'],
        params: idParams,
        response: { 202: z.object({ delivery }) },
      },
    },
    async (req, reply) => {
      const delivery = await withTenantTx(database, req.ctx, (tx) =>
        svc.sendPasswordResetForMember(tx, ports, req.params.id),
      );
      return reply.status(202).send({ delivery: { mode: delivery.mode } });
    },
  );
  app.post(
    '/users/:id/mfa/reset',
    { schema: { tags: ['Users'], params: idParams, body: reasonRequest, response: { 204: z.null() } } },
    async (req, reply) => {
      await withTenantTx(database, req.ctx, (tx) =>
        svc.resetMemberMfa(tx, req.params.id, req.body.reason, ports),
      );
      return reply.status(204).send(null);
    },
  );
  app.get(
    '/users/:id/sessions',
    {
      schema: {
        tags: ['Sessions'],
        params: idParams,
        response: { 200: z.object({ items: z.array(sessionSummary) }) },
      },
    },
    async (req) => ({
      items: await withTenantTx(database, req.ctx, (tx) => svc.listSessions(tx, req.params.id)),
    }),
  );
  app.post(
    '/users/:id/sessions/revoke-all',
    {
      schema: {
        tags: ['Sessions'],
        params: idParams,
        body: reasonRequest,
        response: { 200: z.object({ revoked: z.number().int() }) },
      },
    },
    async (req) => ({
      revoked: await withTenantTx(database, req.ctx, (tx) =>
        svc.revokeAllSessions(tx, req.params.id, req.body.reason),
      ),
    }),
  );

  // API clients (integrations, SCIM provisioning). The token is returned once.
  app.get(
    '/api-clients',
    { schema: { tags: ['API clients'], response: { 200: z.object({ items: z.array(apiClientSummary) }) } } },
    async (req) => ({ items: await withTenantTx(database, req.ctx, (tx) => svc.listApiClients(tx)) }),
  );
  app.post(
    '/api-clients',
    { schema: { tags: ['API clients'], body: apiClientRequest, response: { 201: apiClientCreated } } },
    async (req, reply) => {
      const key = requireIdempotencyKey(req);
      // P2-7: the token is shown once and never stored with the idempotency record. A replay of the same request
      // finds the key already issued and says so instead of returning (or re-minting) the secret.
      let token: string | null = null;
      const res = await runIdempotent(
        database,
        req.ctx,
        { scope: 'POST /api-clients', key, request: req.body },
        async (tx) => {
          const issued = await svc.issueApiClient(tx, ports, {
            ...req.body,
            expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined,
          });
          token = issued.token;
          return { status: 201, body: { clientId: issued.clientId } };
        },
      );
      if (res.replayed || token === null)
        throw new ConflictError(
          'already_issued',
          'This API client was already issued for this request and its token is shown only once. If the token was lost, revoke the client and issue a new one.',
          { clientId: res.body.clientId },
        );
      return reply.status(201).send({ clientId: res.body.clientId, token });
    },
  );
  app.post(
    '/api-clients/:id/revoke',
    { schema: { tags: ['API clients'], params: idParams, body: reasonRequest, response: { 204: z.null() } } },
    async (req, reply) => {
      await withTenantTx(database, req.ctx, (tx) => svc.revokeApiClient(tx, req.params.id, req.body.reason));
      return reply.status(204).send(null);
    },
  );

  // Roles. GET /roles keeps its wave-0 fields and adds the role-editor view (additive).
  app.get('/roles', { schema: { tags: ['Roles'] } }, async (req) => {
    requirePermission(req.ctx, 'identity.user.read');
    return withTenantTx(database, req.ctx, async (tx) => {
      const rows = await svc.listRoles(tx);
      const views = new Map((await svc.listRoleViews(tx, ports)).map((v) => [v.id, v]));
      return { items: rows.map((r) => ({ ...r, ...views.get(r.id) })) };
    });
  });
  app.get(
    '/roles/:id',
    { schema: { tags: ['Roles'], params: idParams, response: { 200: roleView } } },
    async (req, reply) => {
      const r = await withTenantTx(database, req.ctx, (tx) => svc.getRole(tx, ports, req.params.id));
      setVersion(reply, r.version);
      return r;
    },
  );
  app.post(
    '/roles',
    { schema: { tags: ['Roles'], body: createRoleRequest, response: { 201: roleView } } },
    async (req, reply) => {
      const key = requireIdempotencyKey(req);
      const res = await runIdempotent(
        database,
        req.ctx,
        { scope: 'POST /roles', key, request: req.body },
        async (tx) => ({
          status: 201,
          body: await svc.createRole(tx, ports, req.body),
        }),
      );
      setVersion(reply, res.body.version);
      return reply.status(201).send(res.body);
    },
  );
  app.post(
    '/roles/:id/clone',
    { schema: { tags: ['Roles'], params: idParams, body: cloneRoleRequest, response: { 201: roleView } } },
    async (req, reply) => {
      const key = requireIdempotencyKey(req);
      const res = await runIdempotent(
        database,
        req.ctx,
        { scope: `POST /roles/${req.params.id}/clone`, key, request: req.body },
        async (tx) => ({
          status: 201,
          body: await svc.cloneRole(tx, ports, req.params.id, req.body),
        }),
      );
      return reply.status(201).send(res.body);
    },
  );
  app.post(
    '/roles/:id/preview',
    {
      schema: {
        tags: ['Roles'],
        params: idParams,
        body: rolePreviewRequest,
        response: { 200: rolePreviewResponse },
      },
    },
    (req) =>
      withTenantTx(database, req.ctx, (tx) =>
        svc.previewRoleChange(tx, ports, req.params.id, req.body.permissions),
      ),
  );
  app.patch(
    '/roles/:id',
    { schema: { tags: ['Roles'], params: idParams, body: updateRoleRequest, response: { 200: roleView } } },
    async (req, reply) => {
      const expected = requireIfMatch(req);
      const r = await withTenantTx(database, req.ctx, (tx) =>
        svc.updateRole(tx, ports, req.params.id, expected, req.body),
      );
      setVersion(reply, r.version);
      return r;
    },
  );
  app.post(
    '/roles/:id/archive',
    { schema: { tags: ['Roles'], params: idParams, body: reasonRequest, response: { 200: roleView } } },
    (req) =>
      withTenantTx(database, req.ctx, (tx) => svc.archiveRole(tx, ports, req.params.id, req.body.reason)),
  );
}

// ───────────────────────────── Security policy, alerts, emergency access, support access ─────────────────────────────

function registerSecurityRoutes(app: PorticoApp, database: PorticoDatabase, ports: IdentityPorts) {
  app.get(
    '/security/policy',
    { schema: { tags: ['Security'], response: { 200: securityPolicy } } },
    async (req, reply) => {
      requirePermission(req.ctx, 'identity.user.read');
      const p = await withTenantTx(database, req.ctx, (tx) => svc.getSecurityPolicy(tx));
      setVersion(reply, p.version);
      return p;
    },
  );
  app.put(
    '/security/policy',
    { schema: { tags: ['Security'], body: securityPolicyUpdate, response: { 200: securityPolicy } } },
    async (req, reply) => {
      const expected = requireIfMatch(req);
      const p = await withTenantTx(database, req.ctx, (tx) =>
        svc.updateSecurityPolicy(tx, expected, req.body),
      );
      setVersion(reply, p.version);
      return p;
    },
  );
  app.get(
    '/security/alerts',
    { schema: { tags: ['Security'], response: { 200: z.object({ items: z.array(securityAlert) }) } } },
    async (req) => ({ items: await withTenantTx(database, req.ctx, (tx) => svc.listSecurityAlerts(tx)) }),
  );
  app.post(
    '/security/alerts/:id/acknowledge',
    {
      schema: {
        tags: ['Security'],
        params: idParams,
        body: z.object({ note: z.string().max(1000).optional() }).default({}),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      await withTenantTx(database, req.ctx, (tx) =>
        svc.acknowledgeSecurityAlert(tx, req.params.id, req.body.note),
      );
      return reply.status(204).send(null);
    },
  );
  app.get(
    '/security/emergency-access',
    {
      schema: {
        tags: ['Emergency access'],
        querystring: z.object({ pendingReview: z.coerce.boolean().optional() }),
        response: { 200: z.object({ items: z.array(elevationView) }) },
      },
    },
    async (req) => ({
      items: await withTenantTx(database, req.ctx, (tx) =>
        svc.listElevations(tx, { pendingReviewOnly: req.query.pendingReview ?? false }),
      ),
    }),
  );
  app.post(
    '/security/emergency-access/:id/review',
    {
      schema: {
        tags: ['Emergency access'],
        params: idParams,
        body: z.object({ notes: z.string().min(10).max(4000) }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      await withTenantTx(database, req.ctx, (tx) => svc.reviewElevation(tx, req.params.id, req.body.notes));
      return reply.status(204).send(null);
    },
  );
  app.get(
    '/support-sessions',
    { schema: { tags: ['Support access'], response: { 200: z.object({ items: z.array(supportSession) }) } } },
    async (req) => ({ items: await withTenantTx(database, req.ctx, (tx) => svc.listSupportSessions(tx)) }),
  );
  for (const step of ['approve', 'decline', 'revoke'] as const) {
    app.post(
      `/support-sessions/:id/${step}`,
      {
        schema: {
          tags: ['Support access'],
          params: idParams,
          body: z.object({ note: z.string().max(1000).optional() }).default({}),
          response: { 200: supportSession },
        },
      },
      (req) =>
        withTenantTx(database, req.ctx, (tx) =>
          step === 'approve'
            ? svc.approveSupportSession(tx, req.params.id, req.body.note)
            : step === 'decline'
              ? svc.declineSupportSession(tx, req.params.id, req.body.note)
              : svc.revokeSupportSession(tx, req.params.id, req.body.note),
        ),
    );
  }
  app.get(
    '/support-sessions/:id/access-log',
    {
      schema: {
        tags: ['Support access'],
        params: idParams,
        response: { 200: z.object({ items: z.array(supportAccessLogEntry) }) },
      },
    },
    async (req) => ({
      items: await withTenantTx(database, req.ctx, (tx) => svc.getSupportAccessLog(tx, req.params.id)),
    }),
  );
  void ports;
}

// ───────────────────────────── SSO administration ─────────────────────────────

function registerSsoRoutes(app: PorticoApp, database: PorticoDatabase, ports: IdentityPorts) {
  app.get(
    '/sso',
    { schema: { tags: ['Single sign-on'], response: { 200: ssoConnection.nullable() } } },
    async (req, reply) => {
      const c = await withTenantTx(database, req.ctx, (tx) => svc.getSsoConnection(tx));
      if (c) setVersion(reply, c.version);
      return c;
    },
  );
  app.put(
    '/sso',
    { schema: { tags: ['Single sign-on'], body: ssoConfigRequest, response: { 200: ssoConnection } } },
    async (req, reply) => {
      const ifMatch = req.headers['if-match'] ? requireIfMatch(req) : undefined;
      requirePermission(req.ctx, 'identity.sso.manage');
      // The identity provider is called before the transaction opens (P2-2).
      const discovery = await svc.discoverIssuer(ports, req.body.issuer);
      const c = await withTenantTx(database, req.ctx, (tx) =>
        svc.configureSso(tx, ports, req.body, ifMatch, discovery),
      );
      setVersion(reply, c.version);
      return c;
    },
  );
  app.put(
    '/sso/mappings',
    {
      schema: {
        tags: ['Single sign-on'],
        body: ssoMappingsRequest,
        response: { 200: z.object({ mappings: z.number().int() }) },
      },
    },
    async (req) => ({
      mappings: await withTenantTx(database, req.ctx, (tx) =>
        svc.setGroupRoleMappings(tx, ports, req.body.mappings),
      ),
    }),
  );
  app.put(
    '/sso/enforcement',
    {
      schema: {
        tags: ['Single sign-on'],
        body: ssoEnforcementRequest,
        response: { 200: z.object({ ssoRequired: z.boolean(), passwordSessionsRevoked: z.number().int() }) },
      },
    },
    (req) => withTenantTx(database, req.ctx, (tx) => svc.setSsoEnforcement(tx, req.body)),
  );
  // ADR-0017 §5: an organization proves it owns an email domain before SSO may link existing people of it.
  app.get(
    '/sso/domains',
    { schema: { tags: ['Single sign-on'], response: { 200: z.object({ items: z.array(ssoDomain) }) } } },
    async (req) => ({ items: await withTenantTx(database, req.ctx, (tx) => svc.listSsoDomains(tx)) }),
  );
  app.post(
    '/sso/domains',
    { schema: { tags: ['Single sign-on'], body: ssoDomainRequest, response: { 201: ssoDomain } } },
    async (req, reply) =>
      reply
        .status(201)
        .send(await withTenantTx(database, req.ctx, (tx) => svc.addSsoDomain(tx, req.body.domain))),
  );
  app.post(
    '/sso/domains/:domain/verify',
    {
      schema: {
        tags: ['Single sign-on'],
        params: z.object({ domain: z.string().min(3).max(253) }),
        response: { 200: ssoDomain },
      },
    },
    (req) => svc.verifySsoDomain(database, req.ctx, ports, req.params.domain),
  );
}

// ───────────────────────────── SCIM 2.0 ─────────────────────────────

function scimBase(req: FastifyRequest): string {
  return `${req.protocol}://${req.headers.host ?? 'localhost'}/v1/scim/v2`;
}

async function scim(reply: FastifyReply, status: number, fn: () => Promise<unknown>) {
  try {
    const body = await fn();
    return reply
      .status(status)
      .type('application/scim+json')
      .send(body === undefined ? null : body);
  } catch (err) {
    if (err instanceof ScimError)
      return reply.status(err.status).type('application/scim+json').send(err.body());
    throw err;
  }
}

function registerScimRoutes(app: PorticoApp, database: PorticoDatabase, ports: IdentityPorts) {
  app.addContentTypeParser('application/scim+json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });
  const tags = ['SCIM'];
  const tx = <T>(req: FastifyRequest, fn: (tx: TxContext) => Promise<T>) =>
    withTenantTx(database, req.ctx, fn);
  app.get('/scim/v2/ServiceProviderConfig', { schema: { tags } }, async () => ({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'API client token',
        description: 'Portico API client with identity.scim.provision',
      },
    ],
  }));
  app.get('/scim/v2/Users', { schema: { tags, querystring: scimListQuery } }, (req, reply) =>
    scim(reply, 200, () => tx(req, (t) => svc.scimListUsers(t, ports, scimBase(req), req.query))),
  );
  app.post('/scim/v2/Users', { schema: { tags, body: scimUserRequest } }, (req, reply) =>
    scim(reply, 201, () => tx(req, (t) => svc.scimCreateUser(t, ports, scimBase(req), req.body))),
  );
  app.get('/scim/v2/Users/:id', { schema: { tags, params: idParams } }, (req, reply) =>
    scim(reply, 200, () => tx(req, (t) => svc.scimGetUser(t, ports, scimBase(req), req.params.id))),
  );
  app.put('/scim/v2/Users/:id', { schema: { tags, params: idParams, body: scimUserRequest } }, (req, reply) =>
    scim(reply, 200, () =>
      tx(req, (t) => svc.scimReplaceUser(t, ports, scimBase(req), req.params.id, req.body)),
    ),
  );
  app.patch(
    '/scim/v2/Users/:id',
    { schema: { tags, params: idParams, body: scimPatchRequest } },
    (req, reply) =>
      scim(reply, 200, () =>
        tx(req, (t) => svc.scimPatchUser(t, ports, scimBase(req), req.params.id, req.body.Operations)),
      ),
  );
  app.delete('/scim/v2/Users/:id', { schema: { tags, params: idParams } }, (req, reply) =>
    scim(reply, 204, () => tx(req, (t) => svc.scimDeleteUser(t, ports, req.params.id))),
  );
  app.get('/scim/v2/Groups', { schema: { tags, querystring: scimListQuery } }, (req, reply) =>
    scim(reply, 200, () => tx(req, (t) => svc.scimListGroups(t, ports, scimBase(req), req.query))),
  );
  app.post('/scim/v2/Groups', { schema: { tags, body: scimGroupRequest } }, (req, reply) =>
    scim(reply, 201, () => tx(req, (t) => svc.scimCreateGroup(t, ports, scimBase(req), req.body))),
  );
  app.get('/scim/v2/Groups/:id', { schema: { tags, params: idParams } }, (req, reply) =>
    scim(reply, 200, () => tx(req, (t) => svc.scimGetGroup(t, ports, scimBase(req), req.params.id))),
  );
  app.patch(
    '/scim/v2/Groups/:id',
    { schema: { tags, params: idParams, body: scimPatchRequest } },
    (req, reply) =>
      scim(reply, 200, () =>
        tx(req, (t) => svc.scimPatchGroup(t, ports, scimBase(req), req.params.id, req.body.Operations)),
      ),
  );
  app.delete('/scim/v2/Groups/:id', { schema: { tags, params: idParams } }, (req, reply) =>
    scim(reply, 204, () => tx(req, (t) => svc.scimDeleteGroup(t, ports, req.params.id))),
  );
}

// ───────────────────────────── Monoclay operator console (not tenant users) ─────────────────────────────

function registerOperatorRoutes(app: PorticoApp, database: PorticoDatabase, ports: IdentityPorts) {
  const config = { public: true, rateLimit: { max: 60, timeWindow: '1 minute' } };
  const tags = ['Operator console'];
  app.post(
    '/operator/support-sessions',
    {
      config,
      schema: {
        tags,
        body: supportSessionRequest,
        response: { 201: z.object({ session: supportSession, token: z.string() }) },
      },
    },
    async (req, reply) => {
      const op = await requireOperator(ports, req);
      return reply.status(201).send(await svc.requestSupportSession(database, op, req.body));
    },
  );
  const orgSession = z.object({ organizationId: z.uuid(), id: z.uuid() });
  app.get(
    '/operator/organizations/:organizationId/support-sessions/:id',
    { config, schema: { tags, params: orgSession, response: { 200: supportSession } } },
    async (req) =>
      svc.getSupportSessionForOperator(
        database,
        await requireOperator(ports, req),
        req.params.organizationId,
        req.params.id,
      ),
  );
  app.post(
    '/operator/organizations/:organizationId/support-sessions/:id/end',
    { config, schema: { tags, params: orgSession, response: { 200: supportSession } } },
    async (req) =>
      svc.endSupportSession(
        database,
        await requireOperator(ports, req),
        req.params.organizationId,
        req.params.id,
      ),
  );
  app.get(
    '/operator/security-alerts',
    {
      config,
      schema: {
        tags,
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.uuid(),
                rule: z.string(),
                subject: z.string(),
                details: z.record(z.string(), z.unknown()),
                occurredAt: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      await requireOperator(ports, req);
      return { items: await svc.listPlatformAlerts(database) };
    },
  );
  // ADR-0017 §3: simulated (non-live) invitations and resets land here, never in the admin's API response.
  app.get(
    '/operator/mailbox',
    {
      config,
      schema: {
        tags,
        querystring: z.object({ recipient: z.email() }),
        response: { 200: z.object({ items: z.array(devMailboxMessage) }) },
      },
    },
    async (req) => {
      await requireOperator(ports, req);
      return { items: await readDevMailbox(database, ports.cipher, req.query.recipient) };
    },
  );
}

export { requireOperator };
