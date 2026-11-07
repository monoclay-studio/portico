import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { type PorticoDatabase, sql, type TxContext, typed, withTenantTx } from '@portico/db';
import {
  type Actor,
  type Authorizer,
  assertExternalEffectAllowed,
  BusinessRuleError,
  DomainError,
  ForbiddenError,
  isUuid,
  NotFoundError,
  newId,
  type RequestContext,
  randomToken,
  requirePermission,
  sha256Hex,
  staticAuthorizer,
  systemAuthorizer,
  type TenantEnvironment,
  UnauthenticatedError,
  ValidationError,
} from '@portico/kernel';
import { indexCatalog } from './domain/permissions';
import { ROLE_TEMPLATES } from './domain/role-templates';
import { type StepUpState, stepUpAuthorizer } from './domain/step-up';
import type { IdentityPorts } from './ports';
import { activeElevation } from './services/break-glass';
import {
  assertAdministratorRemains,
  assertCanGrantRole,
  assertNotElevated,
  assertPowerOver,
  revokeApiKeysIssuedBy,
} from './services/guard';
import { createMfaChallenge, hasActiveTotp } from './services/mfa';
import { getSecurityPolicy } from './services/policy';
import { checkSignInLocation, recordSignInAttempt } from './services/security';
import { createSession, SESSION_ABSOLUTE_HOURS, SESSION_IDLE_MINUTES } from './services/sessions';
import { authenticateSupportToken } from './services/support';
import type { AssignmentSource, IdentityDB } from './tables';

const db = (tx: TxContext) => typed<IdentityDB>(tx.db);

export type { IdentityPorts } from './ports';
export { SESSION_ABSOLUTE_HOURS, SESSION_IDLE_MINUTES };

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$QmZ2QzN0cG9vZ1R6c0FwZ0p0cG9vZ1R6c0FwZ0p0cG8';

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12)
    throw new ValidationError('weak_password', 'Passwords must be at least 12 characters long.');
  return argonHash(password, ARGON);
}

// ───────────────────────────── Roles ─────────────────────────────

/**
 * Seed or refresh the system role templates. P2-15: a template never overwrites a custom role that happens to use
 * the same key (custom keys are refused for template keys and the `portico_` namespace, so this only matters for
 * rows created before the reservation existed).
 */
export async function seedSystemRoles(tx: TxContext): Promise<void> {
  for (const t of ROLE_TEMPLATES) {
    await db(tx)
      .insertInto('identity.roles')
      .values({
        id: newId(),
        tenant_id: tx.tenantId,
        key: t.key,
        name: t.name,
        description: t.description,
        permissions: [...t.permissions],
        is_system: true,
      })
      .onConflict((oc) =>
        oc
          .columns(['tenant_id', 'key'])
          .doUpdateSet({ permissions: [...t.permissions], name: t.name, description: t.description })
          .where('identity.roles.is_system', '=', true),
      )
      .execute();
  }
}

export async function listRoles(tx: TxContext) {
  return db(tx)
    .selectFrom('identity.roles')
    .select(['id', 'key', 'name', 'description', 'permissions', 'is_system'])
    .orderBy('name')
    .execute();
}

// ───────────────────────────── Users ─────────────────────────────

export interface CreateUserInput {
  email: string;
  displayName: string;
  jobTitle?: string;
  initialPassword?: string;
  roles: Array<{
    roleKey: string;
    scopeType: 'organization' | 'brand' | 'region' | 'property';
    scopeId?: string;
  }>;
}

/**
 * Add a staff member. ADR-0017 §2: when the email already belongs to a person (a global user who works elsewhere or
 * was provisioned before), the membership is created `invited` — the person accepts it while signed in as themselves
 * — and no password is ever set for them. An initial password is accepted only for a brand-new person.
 */
export async function createUser(
  tx: TxContext,
  input: CreateUserInput,
): Promise<{ userId: string; status: 'active' | 'invited' }> {
  requirePermission(tx, 'identity.user.manage');
  assertNotElevated(tx, 'Adding staff');
  const candidate = newId();
  const { rows } = await sql<{
    id: string;
  }>`select identity.ensure_user(${candidate}::uuid, ${input.email}) as id`.execute(tx.db);
  const userId = rows[0]?.id as string;
  const brandNew = userId === candidate;
  const existing = await db(tx)
    .selectFrom('identity.memberships')
    .select('id')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (existing)
    throw new BusinessRuleError('already_member', `${input.email} is already a member of this organization.`);
  if (!brandNew && input.initialPassword) {
    throw new ValidationError(
      'person_already_has_sign_in',
      'This person already has a Portico sign-in. Add them without a password: they will be invited and keep their own password.',
    );
  }
  const status = brandNew ? 'active' : 'invited';
  await db(tx)
    .insertInto('identity.memberships')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      user_id: userId,
      display_name: input.displayName,
      job_title: input.jobTitle ?? null,
      status,
      activated_at: brandNew ? tx.now : null,
      provisioned_by: brandNew ? 'manual' : 'invitation',
    })
    .execute();
  if (brandNew && input.initialPassword) {
    await db(tx)
      .updateTable('identity.users')
      .set({ password_hash: await hashPassword(input.initialPassword) })
      .where('id', '=', userId)
      .execute();
  }
  for (const r of input.roles) await assignRole(tx, { userId, ...r });
  await tx.audit({
    action: 'identity.user.create',
    target: { type: 'user', id: userId },
    after: { displayName: input.displayName, roles: input.roles, status },
  });
  return { userId, status };
}

/**
 * Trusted provisioning only (system actor): give the requesting person — already signed in as themselves — an
 * active membership in an organization they just created (e.g. their own trial). This is the person's consent.
 */
export async function addSelfToOrganization(
  tx: TxContext,
  input: { userId: string; displayName: string; roleKey: string },
): Promise<void> {
  if (tx.actor.kind !== 'system') throw new ForbiddenError('identity.user.manage');
  await db(tx)
    .insertInto('identity.memberships')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      user_id: input.userId,
      display_name: input.displayName,
      status: 'active',
      activated_at: tx.now,
      provisioned_by: 'manual',
    })
    .execute();
  await assignRole(tx, { userId: input.userId, roleKey: input.roleKey, scopeType: 'organization' });
  await tx.audit({ action: 'identity.user.joinOwnOrganization', target: { type: 'user', id: input.userId } });
}

export { assertCanGrantRole };

export async function assignRole(
  tx: TxContext,
  input: {
    userId: string;
    roleKey: string;
    scopeType: 'organization' | 'brand' | 'region' | 'property';
    scopeId?: string;
    reason?: string;
    startsAt?: Date;
    endsAt?: Date;
    source?: AssignmentSource;
    sourceRef?: string;
  },
  ports?: Pick<IdentityPorts, 'propertyIdsInScope' | 'assertPropertyExists'>,
): Promise<{ assignmentId: string }> {
  requirePermission(tx, 'identity.role.assign');
  assertNotElevated(tx, 'Granting roles');
  if ((input.scopeType === 'organization') !== (input.scopeId === undefined)) {
    throw new ValidationError(
      'invalid_scope',
      'Organization-wide roles have no scope id; brand, region and property roles need one.',
    );
  }
  if (tx.actor.kind === 'user' && tx.actor.userId === input.userId) {
    throw new BusinessRuleError(
      'segregation_of_duties',
      'You cannot grant a role to yourself. Ask another administrator.',
      { rule: 'no_self_grant' },
    );
  }
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt)
    throw new ValidationError('invalid_period', 'The assignment must end after it starts.');
  const role = await db(tx)
    .selectFrom('identity.roles')
    .select(['id', 'permissions', 'archived_at'])
    .where('key', '=', input.roleKey)
    .executeTakeFirst();
  if (!role) throw new NotFoundError('role', input.roleKey);
  if (role.archived_at)
    throw new BusinessRuleError(
      'role_archived',
      `Role ${input.roleKey} is archived and can no longer be granted.`,
    );
  if (input.scopeType === 'property' && input.scopeId && ports?.assertPropertyExists)
    await ports.assertPropertyExists(tx, input.scopeId);
  await assertCanGrantRole(tx, role.permissions, { type: input.scopeType, id: input.scopeId ?? null }, ports);
  const id = newId();
  await db(tx)
    .insertInto('identity.role_assignments')
    .values({
      id,
      tenant_id: tx.tenantId,
      user_id: input.userId,
      role_id: role.id,
      scope_type: input.scopeType,
      scope_id: input.scopeId ?? null,
      starts_at: input.startsAt ?? null,
      ends_at: input.endsAt ?? null,
      granted_by: tx.actor.kind === 'user' ? tx.actor.userId : tx.actor.kind,
      reason: input.reason ?? null,
      source: input.source ?? 'manual',
      source_ref: input.sourceRef ?? null,
    })
    .execute();
  await tx.audit({
    action: 'identity.role.assign',
    target: { type: 'user', id: input.userId },
    after: input,
    ...(input.reason ? { reason: input.reason } : {}),
  });
  await tx.emit({
    type: 'identity.roleAssignment.changed',
    ...(input.scopeType === 'property' ? { propertyId: input.scopeId ?? null } : {}),
    aggregate: { type: 'user', id: input.userId },
    payload: {
      change: 'granted',
      assignmentId: id,
      userId: input.userId,
      roleKey: input.roleKey,
      scopeType: input.scopeType,
      scopeId: input.scopeId ?? null,
      endsAt: input.endsAt?.toISOString() ?? null,
    },
  });
  return { assignmentId: id };
}

/** Revoke one role assignment (immediately effective: authorizers are built per request). */
export async function revokeAssignment(
  tx: TxContext,
  assignmentId: string,
  reason: string,
  ports?: Pick<IdentityPorts, 'propertyIdsInScope'>,
): Promise<void> {
  requirePermission(tx, 'identity.role.assign');
  const a = await db(tx)
    .selectFrom('identity.role_assignments')
    .select(['id', 'user_id', 'revoked_at', 'scope_type', 'scope_id'])
    .where('id', '=', assignmentId)
    .executeTakeFirst();
  if (!a) throw new NotFoundError('role_assignment', assignmentId);
  if (tx.actor.kind === 'user' && tx.actor.userId === a.user_id)
    throw new BusinessRuleError('segregation_of_duties', 'You cannot change your own role assignments.');
  if (a.revoked_at) return;
  // ADR-0017 §6: only someone holding at least the target's access may take it away; never the last administrator.
  await assertPowerOver(tx, a.user_id, ports);
  await assertAdministratorRemains(tx, { assignmentIds: [assignmentId] });
  await db(tx)
    .updateTable('identity.role_assignments')
    .set({
      revoked_at: tx.now,
      revoked_by: tx.actor.kind === 'user' ? tx.actor.userId : tx.actor.kind,
      revoke_reason: reason,
    })
    .where('id', '=', assignmentId)
    .execute();
  await tx.audit({
    action: 'identity.role.revoke',
    target: { type: 'user', id: a.user_id },
    reason,
    metadata: { assignmentId },
  });
  await tx.emit({
    type: 'identity.roleAssignment.changed',
    ...(a.scope_type === 'property' ? { propertyId: a.scope_id } : {}),
    aggregate: { type: 'user', id: a.user_id },
    payload: { change: 'revoked', assignmentId, userId: a.user_id },
  });
}

/** Offboarding: suspend membership, revoke all sessions and role assignments immediately. */
export async function suspendMember(
  tx: TxContext,
  userId: string,
  reason: string,
  ports?: Pick<IdentityPorts, 'propertyIdsInScope'>,
): Promise<void> {
  requirePermission(tx, 'identity.user.manage');
  if (tx.actor.kind === 'user' && tx.actor.userId === userId)
    throw new BusinessRuleError('segregation_of_duties', 'You cannot suspend yourself.');
  await assertPowerOver(tx, userId, ports);
  await assertAdministratorRemains(tx, { userId });
  const updated = await db(tx)
    .updateTable('identity.memberships')
    .set({ status: 'suspended', status_reason: reason, version: sql`version + 1` })
    .where('user_id', '=', userId)
    .where('status', '<>', 'removed')
    .executeTakeFirst();
  if (Number(updated.numUpdatedRows) === 0) throw new NotFoundError('user', userId);
  await db(tx)
    .updateTable('identity.sessions')
    .set({ revoked_at: tx.now, revoked_reason: 'member_suspended' })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .execute();
  await db(tx)
    .updateTable('identity.role_assignments')
    .set({ revoked_at: tx.now })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .execute();
  // ADR-0017 §9: API keys the person issued stop with them.
  const keys = await revokeApiKeysIssuedBy(tx, userId);
  await tx.audit({
    action: 'identity.user.suspend',
    target: { type: 'user', id: userId },
    reason,
    metadata: { apiKeysRevoked: keys },
  });
  await tx.emit({
    type: 'identity.membership.suspended',
    aggregate: { type: 'user', id: userId },
    payload: { userId, reason },
  });
}

export async function listUsers(tx: TxContext) {
  requirePermission(tx, 'identity.user.read');
  const members = await db(tx)
    .selectFrom('identity.memberships as m')
    .innerJoin('identity.users as u', 'u.id', 'm.user_id')
    .select(['u.id as userId', 'u.email', 'm.display_name as displayName', 'm.status'])
    .orderBy('m.display_name')
    .execute();
  const assignments = await db(tx)
    .selectFrom('identity.role_assignments as a')
    .innerJoin('identity.roles as r', 'r.id', 'a.role_id')
    .select(['a.user_id', 'r.key', 'a.scope_type', 'a.scope_id'])
    .where('a.revoked_at', 'is', null)
    .execute();
  return members.map((m) => ({
    ...m,
    roles: assignments
      .filter((a) => a.user_id === m.userId)
      .map((a) => ({ key: a.key, scopeType: a.scope_type, scopeId: a.scope_id })),
  }));
}

// ───────────────────────────── Authorization ─────────────────────────────

export interface AuthorizerOptions {
  /** MFA state of the session; when given (and the catalog is bound) sensitive permissions need step-up. */
  stepUp?: StepUpState;
  /** Break-glass: permissions of the emergency role, granted organization-wide until the elevation ends. */
  elevationPermissions?: readonly string[];
}

export async function buildAuthorizer(
  tx: TxContext,
  userId: string,
  ports: IdentityPorts,
  opts: AuthorizerOptions = {},
): Promise<Authorizer> {
  const rows = await db(tx)
    .selectFrom('identity.role_assignments as a')
    .innerJoin('identity.roles as r', 'r.id', 'a.role_id')
    .select(['r.permissions', 'a.scope_type', 'a.scope_id', 'a.starts_at', 'a.ends_at'])
    .where('a.user_id', '=', userId)
    .where('a.revoked_at', 'is', null)
    .execute();
  const grants: Array<{ permission: string; propertyIds: string[] | 'all' }> = [];
  for (const r of rows) {
    if (r.starts_at && r.starts_at > tx.now) continue;
    if (r.ends_at && r.ends_at <= tx.now) continue;
    let propertyIds: string[] | 'all';
    if (r.scope_type === 'organization') propertyIds = 'all';
    else if (r.scope_type === 'property') propertyIds = [r.scope_id as string];
    else propertyIds = await ports.propertyIdsInScope(tx, { type: r.scope_type, id: r.scope_id as string });
    for (const permission of r.permissions) grants.push({ permission, propertyIds });
  }
  for (const permission of opts.elevationPermissions ?? []) grants.push({ permission, propertyIds: 'all' });
  const base = staticAuthorizer(grants);
  if (!opts.stepUp || !ports.permissionCatalog) return base;
  const catalog = indexCatalog(ports.permissionCatalog());
  return stepUpAuthorizer(base, (p) => catalog.isSensitive(p), opts.stepUp);
}

/** MFA state of a session for the step-up authorizer. */
async function stepUpStateFor(
  tx: TxContext,
  session: {
    user_id: string;
    mfa_verified_at: Date | null;
    auth_method: 'password' | 'sso';
    idp_mfa: boolean;
  },
  person: { first_activated_at: Date | null; created_at: Date },
): Promise<StepUpState> {
  const policy = await getSecurityPolicy(tx);
  const totp = await hasActiveTotp(tx, session.user_id);
  const ssoMfa = session.auth_method === 'sso' && session.idp_mfa;
  // ADR-0017 §8: anchored to the person's FIRST activation anywhere — rehire or re-invitation cannot restart it.
  const since = person.first_activated_at ?? person.created_at;
  return {
    now: tx.now,
    mfaEnrolled: totp || ssoMfa,
    mfaVerifiedAt: session.mfa_verified_at,
    enrolmentGraceEndsAt: new Date(since.getTime() + policy.mfaGracePeriodHours * 3600_000),
    stepUpWindowMinutes: policy.mfaStepUpWindowMinutes,
    requireMfaForAll: policy.requireMfaForAll,
  };
}

// ───────────────────────────── Sessions & sign-in ─────────────────────────────

export interface LoginInput {
  email: string;
  password: string;
  organizationId?: string;
  ip?: string;
  userAgent?: string;
}

export type LoginResult =
  | {
      status: 'signed_in';
      token: string;
      expiresAt: Date;
      userId: string;
      organization: { id: string; name: string; environment: string };
    }
  | {
      status: 'select_organization';
      organizations: Array<{ id: string; name: string; environment: string }>;
    }
  | {
      status: 'mfa_required';
      challengeToken: string;
      expiresAt: Date;
      methods: Array<'totp' | 'recovery_code'>;
      organization: { id: string; name: string; environment: string };
    };

const GENERIC_LOGIN_ERROR =
  'The email or password is incorrect, or the account is not active. Check your details or ask your administrator.';

export class SsoRequiredError extends DomainError {
  constructor(organizationId: string) {
    super(
      'sso_required',
      'Your organization requires single sign-on. Choose "Sign in with your company account" instead of a password.',
      { status: 401, details: { organizationId, ssoStartPath: '/v1/auth/sso/start' } },
    );
  }
}

export async function login(
  database: PorticoDatabase,
  input: LoginInput,
  ports: Pick<IdentityPorts, 'geo'> = {},
): Promise<LoginResult> {
  const { rows } = await sql<{
    user_id: string;
    password_hash: string | null;
    status: string;
    locked_until: Date | null;
    tenant_ids: string[];
  }>`
    select * from identity.login_lookup(${input.email})`.execute(database.kysely);
  const user = rows[0];
  // Always verify against some hash so response timing does not reveal whether the email exists.
  const ok = await argonVerify(user?.password_hash ?? DUMMY_HASH, input.password).catch(() => false);
  const now = database.clock.now();
  const signal = (success: boolean) =>
    recordSignInAttempt(database, {
      ip: input.ip,
      email: input.email,
      success,
      knownTenantIds: user?.tenant_ids ?? [],
    }).catch((err: unknown) => console.error('sign-in signal failed', err));
  if (!user?.password_hash) {
    await signal(false);
    throw new UnauthenticatedError(GENERIC_LOGIN_ERROR);
  }
  if (user.locked_until && user.locked_until > now) {
    throw new UnauthenticatedError(
      'Too many failed sign-in attempts. Wait 15 minutes or ask your administrator to unlock the account.',
    );
  }
  await sql`select identity.record_login_result(${user.user_id}::uuid, ${ok})`.execute(database.kysely);
  await signal(ok);
  if (!ok || user.status !== 'active') throw new UnauthenticatedError(GENERIC_LOGIN_ERROR);

  const { rows: orgs } = await sql<{ id: string; name: string; environment: string; status: string }>`
    select * from platform.tenant_summaries(${user.tenant_ids}::uuid[])`.execute(database.kysely);
  const active = orgs.filter((o) => o.status === 'active');
  if (active.length === 0) throw new UnauthenticatedError(GENERIC_LOGIN_ERROR);
  const chosen = input.organizationId
    ? active.find((o) => o.id === input.organizationId)
    : active.length === 1
      ? active[0]
      : undefined;
  if (!chosen) {
    if (input.organizationId) throw new UnauthenticatedError(GENERIC_LOGIN_ERROR);
    return {
      status: 'select_organization',
      organizations: active.map(({ id, name, environment }) => ({ id, name, environment })),
    };
  }

  const ctx: RequestContext = {
    tenantId: chosen.id,
    environment: chosen.environment as TenantEnvironment,
    actor: { kind: 'user', userId: user.user_id },
    authz: systemAuthorizer,
    correlationId: newId(),
  };
  const organization = { id: chosen.id, name: chosen.name, environment: chosen.environment };
  return withTenantTx(database, ctx, async (tx): Promise<LoginResult> => {
    const sso = await db(tx)
      .selectFrom('identity.sso_connections')
      .select(['sso_required', 'sso_exempt_user_ids', 'status'])
      .executeTakeFirst();
    if (sso?.status === 'active' && sso.sso_required && !sso.sso_exempt_user_ids.includes(user.user_id)) {
      throw new SsoRequiredError(chosen.id);
    }
    if (await hasActiveTotp(tx, user.user_id)) {
      const challenge = await createMfaChallenge(tx, {
        userId: user.user_id,
        ip: input.ip,
        userAgent: input.userAgent,
      });
      return { status: 'mfa_required', ...challenge, methods: ['totp', 'recovery_code'], organization };
    }
    const session = await createSession(tx, {
      userId: user.user_id,
      authMethod: 'password',
      mfaVerifiedAt: null,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await checkSignInLocation(tx, ports, { userId: user.user_id, ip: input.ip });
    return {
      status: 'signed_in',
      token: session.token,
      expiresAt: session.expiresAt,
      userId: user.user_id,
      organization,
    };
  });
}

export interface AuthenticatedPrincipal {
  tenantId: string;
  environment: TenantEnvironment;
  actor: RequestContext['actor'];
  authz: Authorizer;
}

/** Resolve a bearer token (staff session `pts.` or API client `ptk.`) into a principal, or null. */
export async function authenticateToken(
  database: PorticoDatabase,
  token: string,
  ports: IdentityPorts,
  request?: { method: string; path: string },
): Promise<AuthenticatedPrincipal | null> {
  const parts = token.split('.');
  const kind = parts[0];
  const tenantId = parts[1];
  if (!tenantId || !isUuid(tenantId) || (kind !== 'pts' && kind !== 'ptk' && kind !== 'pss')) return null;
  const { rows } = await sql<{
    environment: string | null;
  }>`select platform.tenant_environment(${tenantId}::uuid) as environment`.execute(database.kysely);
  const environment = rows[0]?.environment as TenantEnvironment | null | undefined;
  if (!environment) return null;
  const now = database.clock.now();
  const ctx: RequestContext = {
    tenantId,
    environment,
    actor: { kind: 'system', process: 'authenticate' },
    authz: systemAuthorizer,
    correlationId: newId(),
  };

  return withTenantTx(database, ctx, async (tx) => {
    if (kind === 'pss') {
      const support = await authenticateSupportToken(tx, token, ports.permissionCatalog?.(), request);
      return support ? { tenantId, environment, ...support } : null;
    }
    if (kind === 'pts') {
      const session = await db(tx)
        .selectFrom('identity.sessions as s')
        .innerJoin('identity.memberships as m', 'm.user_id', 's.user_id')
        .innerJoin('identity.users as u', 'u.id', 's.user_id')
        .select([
          's.id',
          's.user_id',
          's.expires_at',
          's.idle_expires_at',
          's.revoked_at',
          's.last_seen_at',
          's.mfa_verified_at',
          's.auth_method',
          's.idp_mfa',
          'm.status',
          'm.display_name',
          'm.activated_at',
          'm.created_at',
          'u.status as user_status',
          'u.first_activated_at',
        ])
        .where('s.token_hash', '=', sha256Hex(token))
        .executeTakeFirst();
      if (
        !session ||
        session.revoked_at ||
        session.expires_at <= now ||
        session.idle_expires_at <= now ||
        session.status !== 'active' ||
        session.user_status === 'disabled'
      )
        return null;
      if (now.getTime() - session.last_seen_at.getTime() > 60_000) {
        await db(tx)
          .updateTable('identity.sessions')
          .set({
            last_seen_at: now,
            idle_expires_at: new Date(
              Math.min(session.expires_at.getTime(), now.getTime() + SESSION_IDLE_MINUTES * 60_000),
            ),
          })
          .where('id', '=', session.id)
          .execute();
      }
      const elevation = await activeElevation(tx, session.id);
      const actor: Actor & { via?: 'elevation'; elevationId?: string } = {
        kind: 'user',
        userId: session.user_id,
        displayName: session.display_name,
        sessionId: session.id,
        ...(elevation ? { via: 'elevation' as const, elevationId: elevation.id } : {}),
      };
      return {
        tenantId,
        environment,
        actor,
        authz: await buildAuthorizer(tx, session.user_id, ports, {
          stepUp: await stepUpStateFor(tx, session, session),
          ...(elevation ? { elevationPermissions: elevation.permissions } : {}),
        }),
      };
    }
    // API client: ptk.<tenant>.<clientId>.<secret>
    const clientId = parts[2];
    if (!clientId || !isUuid(clientId) || !parts[3]) return null;
    const client = await db(tx)
      .selectFrom('identity.api_clients')
      .selectAll()
      .where('id', '=', clientId)
      .executeTakeFirst();
    if (
      client?.status !== 'active' ||
      client.secret_hash !== sha256Hex(token) ||
      (client.expires_at && client.expires_at <= now)
    )
      return null;
    await db(tx)
      .updateTable('identity.api_clients')
      .set({ last_used_at: now })
      .where('id', '=', clientId)
      .execute();
    const propertyIds: string[] | 'all' = client.property_ids ?? 'all';
    return {
      tenantId,
      environment,
      // `createdBy` lets separation-of-duties checks resolve the key to the person responsible for it (ADR-0017 §7).
      actor: {
        kind: 'api_client',
        clientId,
        displayName: client.name,
        createdBy: client.created_by,
      } as Actor,
      authz: staticAuthorizer(client.permissions.map((permission) => ({ permission, propertyIds }))),
    };
  });
}

/** Wave-0 primitive (logout, tests); see services/sessions.ts for the permission-checked variants. */
export async function revokeSession(tx: TxContext, sessionId: string, reason: string): Promise<void> {
  await db(tx)
    .updateTable('identity.sessions')
    .set({ revoked_at: tx.now, revoked_reason: reason })
    .where('id', '=', sessionId)
    .execute();
  await tx.audit({ action: 'identity.session.revoke', target: { type: 'session', id: sessionId }, reason });
}

export async function createApiClient(
  tx: TxContext,
  input: { name: string; permissions: string[]; propertyIds?: string[]; expiresAt?: Date },
): Promise<{ clientId: string; token: string }> {
  requirePermission(tx, 'identity.apiClient.manage');
  assertNotElevated(tx, 'Issuing API keys');
  // ADR-0010 / ADR-0017 §9: production credentials are never issued outside the live environment.
  assertExternalEffectAllowed(tx, 'credentials.production');
  const clientId = newId();
  const token = `ptk.${tx.tenantId}.${clientId}.${randomToken(32)}`;
  await db(tx)
    .insertInto('identity.api_clients')
    .values({
      id: clientId,
      tenant_id: tx.tenantId,
      name: input.name,
      secret_hash: sha256Hex(token),
      permissions: input.permissions,
      property_ids: input.propertyIds ?? null,
      created_by: tx.actor.kind === 'user' ? tx.actor.userId : tx.actor.kind,
      expires_at: input.expiresAt ?? null,
    })
    .execute();
  await tx.audit({
    action: 'identity.apiClient.create',
    target: { type: 'api_client', id: clientId },
    after: { name: input.name, permissions: input.permissions, propertyIds: input.propertyIds ?? 'all' },
  });
  return { clientId, token };
}

export async function getMe(tx: TxContext, userId: string) {
  const m = await db(tx)
    .selectFrom('identity.memberships as m')
    .innerJoin('identity.users as u', 'u.id', 'm.user_id')
    .select(['u.id', 'u.email', 'm.display_name'])
    .where('m.user_id', '=', userId)
    .executeTakeFirst();
  if (!m) throw new NotFoundError('user', userId);
  const roles = await db(tx)
    .selectFrom('identity.role_assignments as a')
    .innerJoin('identity.roles as r', 'r.id', 'a.role_id')
    .select(['r.key', 'r.name', 'a.scope_type', 'a.scope_id'])
    .where('a.user_id', '=', userId)
    .where('a.revoked_at', 'is', null)
    .execute();
  return {
    userId: m.id,
    displayName: m.display_name,
    email: m.email,
    organizationId: tx.tenantId,
    environment: tx.environment,
    roles: roles.map((r) => ({ key: r.key, name: r.name, scopeType: r.scope_type, scopeId: r.scope_id })),
  };
}
