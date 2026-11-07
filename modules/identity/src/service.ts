import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { type PorticoDatabase, sql, type TxContext, typed, withTenantTx } from '@portico/db';
import {
  type Authorizer,
  BusinessRuleError,
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
import { ROLE_TEMPLATES } from './domain/role-templates';
import type { IdentityDB } from './tables';

const db = (tx: TxContext) => typed<IdentityDB>(tx.db);

/** What identity needs from other modules (bound in the composition root). */
export interface IdentityPorts {
  propertyIdsInScope(tx: TxContext, scope: { type: 'brand' | 'region'; id: string }): Promise<string[]>;
}

export const SESSION_ABSOLUTE_HOURS = 12;
export const SESSION_IDLE_MINUTES = 120;
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$QmZ2QzN0cG9vZ1R6c0FwZ0p0cG9vZ1R6c0FwZ0p0cG8';

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12)
    throw new ValidationError('weak_password', 'Passwords must be at least 12 characters long.');
  return argonHash(password, ARGON);
}

// ───────────────────────────── Roles ─────────────────────────────

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
          .doUpdateSet({ permissions: [...t.permissions], name: t.name, description: t.description }),
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

export async function createUser(tx: TxContext, input: CreateUserInput): Promise<{ userId: string }> {
  requirePermission(tx, 'identity.user.manage');
  const { rows } = await sql<{
    id: string;
  }>`select identity.ensure_user(${newId()}::uuid, ${input.email}) as id`.execute(tx.db);
  const userId = rows[0]?.id as string;
  const existing = await db(tx)
    .selectFrom('identity.memberships')
    .select('id')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (existing)
    throw new BusinessRuleError('already_member', `${input.email} is already a member of this organization.`);
  await db(tx)
    .insertInto('identity.memberships')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      user_id: userId,
      display_name: input.displayName,
      job_title: input.jobTitle ?? null,
    })
    .execute();
  if (input.initialPassword) {
    const user = await db(tx)
      .selectFrom('identity.users')
      .select('password_hash')
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    if (!user.password_hash) {
      await db(tx)
        .updateTable('identity.users')
        .set({ password_hash: await hashPassword(input.initialPassword) })
        .where('id', '=', userId)
        .execute();
    }
  }
  for (const r of input.roles) await assignRole(tx, { userId, ...r });
  await tx.audit({
    action: 'identity.user.create',
    target: { type: 'user', id: userId },
    after: { email: input.email, displayName: input.displayName, roles: input.roles },
  });
  return { userId };
}

export async function assignRole(
  tx: TxContext,
  input: {
    userId: string;
    roleKey: string;
    scopeType: 'organization' | 'brand' | 'region' | 'property';
    scopeId?: string;
    reason?: string;
    endsAt?: Date;
  },
): Promise<{ assignmentId: string }> {
  requirePermission(tx, 'identity.role.assign');
  if ((input.scopeType === 'organization') !== (input.scopeId === undefined)) {
    throw new ValidationError(
      'invalid_scope',
      'Organization-wide roles have no scope id; brand, region and property roles need one.',
    );
  }
  const role = await db(tx)
    .selectFrom('identity.roles')
    .select(['id'])
    .where('key', '=', input.roleKey)
    .executeTakeFirst();
  if (!role) throw new NotFoundError('role', input.roleKey);
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
      starts_at: null,
      ends_at: input.endsAt ?? null,
      granted_by: tx.actor.kind === 'user' ? tx.actor.userId : tx.actor.kind,
      reason: input.reason ?? null,
    })
    .execute();
  await tx.audit({
    action: 'identity.role.assign',
    target: { type: 'user', id: input.userId },
    after: input,
    ...(input.reason ? { reason: input.reason } : {}),
  });
  return { assignmentId: id };
}

/** Offboarding: suspend membership, revoke all sessions and role assignments immediately. */
export async function suspendMember(tx: TxContext, userId: string, reason: string): Promise<void> {
  requirePermission(tx, 'identity.user.manage');
  const updated = await db(tx)
    .updateTable('identity.memberships')
    .set({ status: 'suspended', version: sql`version + 1` })
    .where('user_id', '=', userId)
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
  await tx.audit({ action: 'identity.user.suspend', target: { type: 'user', id: userId }, reason });
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

export async function buildAuthorizer(
  tx: TxContext,
  userId: string,
  ports: IdentityPorts,
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
  return staticAuthorizer(grants);
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
    };

const GENERIC_LOGIN_ERROR =
  'The email or password is incorrect, or the account is not active. Check your details or ask your administrator.';

export async function login(database: PorticoDatabase, input: LoginInput): Promise<LoginResult> {
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
  if (!user?.password_hash) throw new UnauthenticatedError(GENERIC_LOGIN_ERROR);
  if (user.locked_until && user.locked_until > now) {
    throw new UnauthenticatedError(
      'Too many failed sign-in attempts. Wait 15 minutes or ask your administrator to unlock the account.',
    );
  }
  await sql`select identity.record_login_result(${user.user_id}::uuid, ${ok})`.execute(database.kysely);
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

  const secret = randomToken(32);
  const token = `pts.${chosen.id}.${secret}`;
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_HOURS * 3600_000);
  const ctx: RequestContext = {
    tenantId: chosen.id,
    environment: chosen.environment as TenantEnvironment,
    actor: { kind: 'user', userId: user.user_id },
    authz: systemAuthorizer,
    correlationId: newId(),
  };
  await withTenantTx(database, ctx, async (tx) => {
    await db(tx)
      .insertInto('identity.sessions')
      .values({
        id: newId(),
        tenant_id: chosen.id,
        user_id: user.user_id,
        token_hash: sha256Hex(token),
        expires_at: expiresAt,
        idle_expires_at: new Date(
          Math.min(expiresAt.getTime(), now.getTime() + SESSION_IDLE_MINUTES * 60_000),
        ),
        ip: input.ip ?? null,
        user_agent: input.userAgent?.slice(0, 500) ?? null,
      })
      .execute();
    await tx.audit({
      action: 'identity.session.create',
      target: { type: 'user', id: user.user_id },
      metadata: { ip: input.ip ?? null },
    });
  });
  return {
    status: 'signed_in',
    token,
    expiresAt,
    userId: user.user_id,
    organization: { id: chosen.id, name: chosen.name, environment: chosen.environment },
  };
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
): Promise<AuthenticatedPrincipal | null> {
  const parts = token.split('.');
  const kind = parts[0];
  const tenantId = parts[1];
  if (!tenantId || !isUuid(tenantId) || (kind !== 'pts' && kind !== 'ptk')) return null;
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
    if (kind === 'pts') {
      const session = await db(tx)
        .selectFrom('identity.sessions as s')
        .innerJoin('identity.memberships as m', 'm.user_id', 's.user_id')
        .select([
          's.id',
          's.user_id',
          's.expires_at',
          's.idle_expires_at',
          's.revoked_at',
          's.last_seen_at',
          'm.status',
          'm.display_name',
        ])
        .where('s.token_hash', '=', sha256Hex(token))
        .executeTakeFirst();
      if (
        !session ||
        session.revoked_at ||
        session.expires_at <= now ||
        session.idle_expires_at <= now ||
        session.status !== 'active'
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
      return {
        tenantId,
        environment,
        actor: {
          kind: 'user',
          userId: session.user_id,
          displayName: session.display_name,
          sessionId: session.id,
        },
        authz: await buildAuthorizer(tx, session.user_id, ports),
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
      actor: { kind: 'api_client', clientId, displayName: client.name },
      authz: staticAuthorizer(client.permissions.map((permission) => ({ permission, propertyIds }))),
    };
  });
}

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
