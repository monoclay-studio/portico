import {
  explainVersionMiss,
  type PorticoDatabase,
  sql,
  type TxContext,
  typed,
  withTenantTx,
} from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  isUuid,
  NotFoundError,
  newId,
  type RequestContext,
  randomToken,
  requirePermission,
  sha256Hex,
  systemAuthorizer,
  type TenantEnvironment,
  UnauthenticatedError,
  ValidationError,
} from '@portico/kernel';
import type { IdentityPorts, NotifierResult, StaffMessage } from '../ports';
import { assignRole, hashPassword } from '../service';
import type { IdentityDB } from '../tables';
import { mfaStatus } from './mfa';

/**
 * Staff lifecycle (readiness brief §13 "onboarding, transfers and termination"; IDN-R05/R06/R07):
 * invitations, password resets, transfers between properties, time-limited assignments, reactivation and removal.
 * Messages go through the Notifier port, which applies environment safety (simulated outside live).
 */
const db = (tx: TxContext) => typed<IdentityDB>(tx.db);

export const INVITATION_DAYS = 7;
export const PASSWORD_RESET_MINUTES = 60;

type RoleInput = {
  roleKey: string;
  scopeType: 'organization' | 'brand' | 'region' | 'property';
  scopeId?: string | undefined;
  startsAt?: Date | undefined;
  endsAt?: Date | undefined;
};

function actorRef(tx: TxContext): string {
  return tx.actor.kind === 'user' ? `user:${tx.actor.userId}` : `${tx.actor.kind}`;
}

async function send(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'notifier'>,
  message: StaffMessage,
): Promise<NotifierResult> {
  // Without a bound notifier nothing can be delivered; treat it as simulated so the caller can show the link.
  if (!ports.notifier) return { mode: 'simulate', simulated: message };
  return ports.notifier.send(tx, message);
}

async function issueToken(
  tx: TxContext,
  userId: string,
  kind: 'invitation' | 'password_reset',
  ttlMs: number,
) {
  await db(tx)
    .updateTable('identity.credential_tokens')
    .set({ revoked_at: tx.now })
    .where('user_id', '=', userId)
    .where('kind', '=', kind)
    .where('used_at', 'is', null)
    .where('revoked_at', 'is', null)
    .execute();
  const token = `${kind === 'invitation' ? 'inv' : 'prt'}.${tx.tenantId}.${randomToken(32)}`;
  const expiresAt = new Date(tx.now.getTime() + ttlMs);
  await db(tx)
    .insertInto('identity.credential_tokens')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      user_id: userId,
      kind,
      token_hash: sha256Hex(token),
      expires_at: expiresAt,
      used_at: null,
      revoked_at: null,
      created_by: actorRef(tx),
    })
    .execute();
  return { token, expiresAt };
}

function link(ports: Pick<IdentityPorts, 'config'>, path: string, token: string): string {
  const base = ports.config?.appBaseUrl ?? 'http://localhost:5173';
  return `${base.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;
}

/** Invite a person: membership `invited`, roles granted (effective once accepted), invitation link sent. */
export async function inviteMember(
  tx: TxContext,
  ports: Pick<
    IdentityPorts,
    'notifier' | 'config' | 'organizationName' | 'propertyIdsInScope' | 'assertPropertyExists'
  >,
  input: { email: string; displayName: string; jobTitle?: string | undefined; roles: RoleInput[] },
) {
  requirePermission(tx, 'identity.user.manage');
  const { rows } = await sql<{
    id: string;
  }>`select identity.ensure_user(${newId()}::uuid, ${input.email}) as id`.execute(tx.db);
  const userId = rows[0]?.id as string;
  const existing = await db(tx)
    .selectFrom('identity.memberships')
    .select(['id', 'status'])
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (existing && existing.status !== 'removed')
    throw new ConflictError(
      'already_member',
      `${input.email} is already a member of this organization (${existing.status}).`,
    );
  if (existing) {
    // Rehire: the removed membership is reused as a fresh invitation (history stays in the audit trail).
    await db(tx)
      .updateTable('identity.memberships')
      .set({
        status: 'invited',
        display_name: input.displayName,
        job_title: input.jobTitle ?? null,
        activated_at: null,
        removed_at: null,
        status_reason: null,
        provisioned_by: 'invitation',
        version: sql`version + 1`,
      })
      .where('id', '=', existing.id)
      .execute();
  } else {
    await db(tx)
      .insertInto('identity.memberships')
      .values({
        id: newId(),
        tenant_id: tx.tenantId,
        user_id: userId,
        display_name: input.displayName,
        job_title: input.jobTitle ?? null,
        status: 'invited',
        activated_at: null,
        provisioned_by: 'invitation',
        external_id: null,
        status_reason: null,
        removed_at: null,
        default_property_id: null,
      })
      .execute();
  }
  for (const r of input.roles) {
    await assignRole(
      tx,
      {
        userId,
        roleKey: r.roleKey,
        scopeType: r.scopeType,
        ...(r.scopeId ? { scopeId: r.scopeId } : {}),
        ...(r.startsAt ? { startsAt: r.startsAt } : {}),
        ...(r.endsAt ? { endsAt: r.endsAt } : {}),
      },
      ports,
    );
  }
  const { token, expiresAt } = await issueToken(tx, userId, 'invitation', INVITATION_DAYS * 86_400_000);
  const orgName = ports.organizationName ? await ports.organizationName(tx) : 'your organization';
  const delivery = await send(tx, ports, {
    kind: 'staff.invitation',
    to: input.email,
    subject: `You have been invited to ${orgName} on Portico`,
    body: `${input.displayName}, you have been invited to join ${orgName}. The invitation is valid until ${expiresAt.toISOString()}.`,
    link: link(ports, '/accept-invitation', token),
  });
  await tx.audit({
    action: 'identity.user.invite',
    target: { type: 'user', id: userId },
    after: {
      email: input.email,
      displayName: input.displayName,
      roles: input.roles,
      delivery: delivery.mode,
    },
  });
  await tx.emit({
    type: 'identity.membership.invited',
    aggregate: { type: 'user', id: userId },
    payload: { userId, expiresAt: expiresAt.toISOString(), delivery: delivery.mode },
  });
  return { userId, invitationExpiresAt: expiresAt.toISOString(), delivery };
}

async function tokenContext(database: PorticoDatabase, token: string, prefix: 'inv' | 'prt') {
  const [kind, tenantId] = token.split('.');
  if (kind !== prefix || !tenantId || !isUuid(tenantId)) return null;
  const { rows } = await sql<{ environment: string; status: string }>`
    select environment, status from platform.tenant_summaries(${[tenantId]}::uuid[])`.execute(
    database.kysely,
  );
  const org = rows[0];
  if (org?.status !== 'active') return null;
  const ctx: RequestContext = {
    tenantId,
    environment: org.environment as TenantEnvironment,
    actor: { kind: 'system', process: prefix === 'inv' ? 'invitation' : 'password-reset' },
    authz: systemAuthorizer,
    correlationId: newId(),
  };
  return ctx;
}

async function consumeToken(tx: TxContext, token: string, kind: 'invitation' | 'password_reset') {
  const row = await db(tx)
    .selectFrom('identity.credential_tokens')
    .selectAll()
    .where('token_hash', '=', sha256Hex(token))
    .where('kind', '=', kind)
    .forUpdate()
    .executeTakeFirst();
  if (!row || row.used_at || row.revoked_at || row.expires_at <= tx.now) return null;
  await db(tx)
    .updateTable('identity.credential_tokens')
    .set({ used_at: tx.now })
    .where('id', '=', row.id)
    .execute();
  return row;
}

const INVALID_TOKEN =
  'This link is invalid, already used or expired. Ask your administrator to send a new invitation or reset link.';

/** Accept an invitation (public). Sets the first password if the person has none yet. */
export async function acceptInvitation(
  database: PorticoDatabase,
  input: { token: string; password?: string | undefined },
): Promise<{ organizationId: string; userId: string }> {
  const ctx = await tokenContext(database, input.token, 'inv');
  if (!ctx) throw new UnauthenticatedError(INVALID_TOKEN);
  const passwordHash = input.password ? await hashPassword(input.password) : null;
  return withTenantTx(database, ctx, async (tx) => {
    const t = await consumeToken(tx, input.token, 'invitation');
    if (!t) throw new UnauthenticatedError(INVALID_TOKEN);
    const m = await db(tx)
      .selectFrom('identity.memberships')
      .select(['id', 'status'])
      .where('user_id', '=', t.user_id)
      .executeTakeFirst();
    if (m?.status !== 'invited') throw new UnauthenticatedError(INVALID_TOKEN);
    const u = await db(tx)
      .selectFrom('identity.users')
      .select('password_hash')
      .where('id', '=', t.user_id)
      .executeTakeFirstOrThrow();
    if (!u.password_hash) {
      const sso = await db(tx)
        .selectFrom('identity.sso_connections')
        .select(['sso_required', 'status'])
        .executeTakeFirst();
      const ssoOnly = sso?.status === 'active' && sso.sso_required;
      if (!passwordHash && !ssoOnly)
        throw new ValidationError(
          'password_required',
          'Choose a password (at least 12 characters) to finish joining.',
        );
      if (passwordHash && !ssoOnly)
        await db(tx)
          .updateTable('identity.users')
          .set({ password_hash: passwordHash })
          .where('id', '=', t.user_id)
          .execute();
    }
    await db(tx)
      .updateTable('identity.memberships')
      .set({ status: 'active', activated_at: tx.now, version: sql`version + 1` })
      .where('id', '=', m.id)
      .execute();
    await tx.audit({ action: 'identity.user.acceptInvitation', target: { type: 'user', id: t.user_id } });
    await tx.emit({
      type: 'identity.membership.activated',
      aggregate: { type: 'user', id: t.user_id },
      payload: { userId: t.user_id },
    });
    return { organizationId: tx.tenantId, userId: t.user_id };
  });
}

async function sendReset(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'notifier' | 'config'>,
  user: { id: string; email: string },
) {
  const { token, expiresAt } = await issueToken(
    tx,
    user.id,
    'password_reset',
    PASSWORD_RESET_MINUTES * 60_000,
  );
  const delivery = await send(tx, ports, {
    kind: 'staff.passwordReset',
    to: user.email,
    subject: 'Reset your Portico password',
    body: `Use this link within ${PASSWORD_RESET_MINUTES} minutes to choose a new password. If you did not ask for this, ignore this message.`,
    link: link(ports, '/reset-password', token),
  });
  await tx.audit({
    action: 'identity.password.resetRequested',
    target: { type: 'user', id: user.id },
    metadata: { delivery: delivery.mode, expiresAt: expiresAt.toISOString() },
  });
  return delivery;
}

/**
 * Self-service "forgot password" (public). Always answers the same way whether or not the email exists. The reset
 * is issued in one of the person's active organizations (a live one when there is one) so that its environment
 * decides whether the email is real or simulated; organizations that require SSO are skipped.
 */
export async function requestPasswordReset(
  database: PorticoDatabase,
  ports: Pick<IdentityPorts, 'notifier' | 'config'>,
  input: { email: string },
): Promise<void> {
  const { rows } = await sql<{ user_id: string; status: string; tenant_ids: string[] }>`
    select user_id, status, tenant_ids from identity.login_lookup(${input.email})`.execute(database.kysely);
  const user = rows[0];
  if (!user || user.status === 'disabled' || user.tenant_ids.length === 0) return;
  const { rows: orgs } = await sql<{ id: string; environment: string; status: string }>`
    select id, environment, status from platform.tenant_summaries(${user.tenant_ids}::uuid[])`.execute(
    database.kysely,
  );
  const ordered = orgs
    .filter((o) => o.status === 'active')
    .sort((a, b) => (a.environment === 'live' ? -1 : b.environment === 'live' ? 1 : 0));
  for (const org of ordered) {
    const ctx: RequestContext = {
      tenantId: org.id,
      environment: org.environment as TenantEnvironment,
      actor: { kind: 'system', process: 'password-reset' },
      authz: systemAuthorizer,
      correlationId: newId(),
    };
    const sent = await withTenantTx(database, ctx, async (tx) => {
      const sso = await db(tx)
        .selectFrom('identity.sso_connections')
        .select(['sso_required', 'status', 'sso_exempt_user_ids'])
        .executeTakeFirst();
      if (sso?.status === 'active' && sso.sso_required && !sso.sso_exempt_user_ids.includes(user.user_id))
        return false;
      const u = await db(tx)
        .selectFrom('identity.users')
        .select(['id', 'email'])
        .where('id', '=', user.user_id)
        .executeTakeFirst();
      if (!u) return false;
      await sendReset(tx, ports, u);
      return true;
    });
    if (sent) return;
  }
}

/** Administrator sends a reset link to a member (lost password; never sets a password for them). */
export async function sendPasswordResetForMember(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'notifier' | 'config'>,
  userId: string,
) {
  requirePermission(tx, 'identity.user.manage');
  const u = await db(tx)
    .selectFrom('identity.users as u')
    .innerJoin('identity.memberships as m', 'm.user_id', 'u.id')
    .select(['u.id', 'u.email', 'm.status'])
    .where('u.id', '=', userId)
    .executeTakeFirst();
  if (!u || u.status === 'removed') throw new NotFoundError('user', userId);
  return sendReset(tx, ports, u);
}

/** Complete a reset (public). Revokes the person's sessions in every organization (credential changed). */
export async function completePasswordReset(
  database: PorticoDatabase,
  input: { token: string; newPassword: string },
): Promise<{ sessionsRevoked: number }> {
  const ctx = await tokenContext(database, input.token, 'prt');
  if (!ctx) throw new UnauthenticatedError(INVALID_TOKEN);
  const hash = await hashPassword(input.newPassword);
  return withTenantTx(database, ctx, async (tx) => {
    const t = await consumeToken(tx, input.token, 'password_reset');
    if (!t) throw new UnauthenticatedError(INVALID_TOKEN);
    await db(tx)
      .updateTable('identity.users')
      .set({ password_hash: hash, failed_logins: 0, locked_until: null })
      .where('id', '=', t.user_id)
      .execute();
    const { rows } = await sql<{
      n: number;
    }>`select identity.revoke_sessions_everywhere(${t.user_id}::uuid, 'password_reset') as n`.execute(tx.db);
    await tx.audit({ action: 'identity.password.reset', target: { type: 'user', id: t.user_id } });
    await tx.emit({
      type: 'identity.password.changed',
      aggregate: { type: 'user', id: t.user_id },
      payload: { userId: t.user_id, sessionsRevoked: rows[0]?.n ?? 0 },
    });
    return { sessionsRevoked: rows[0]?.n ?? 0 };
  });
}

// ───────────────────────────── Transfers ─────────────────────────────

export interface TransferPlan {
  userId: string;
  fromPropertyId: string;
  toPropertyId: string;
  effectiveAt: string;
  remove: Array<{ assignmentId: string; roleKey: string }>;
  add: Array<{ roleKey: string; propertyId: string }>;
}

async function planTransfer(
  tx: TxContext,
  input: {
    userId: string;
    fromPropertyId: string;
    toPropertyId: string;
    roleKeys?: string[] | undefined;
    effectiveAt?: Date | undefined;
  },
): Promise<TransferPlan> {
  if (input.fromPropertyId === input.toPropertyId)
    throw new ValidationError('same_property', 'Choose a different property to transfer to.');
  const effective = input.effectiveAt ?? tx.now;
  const current = await db(tx)
    .selectFrom('identity.role_assignments as a')
    .innerJoin('identity.roles as r', 'r.id', 'a.role_id')
    .select(['a.id', 'r.key', 'a.ends_at'])
    .where('a.user_id', '=', input.userId)
    .where('a.scope_type', '=', 'property')
    .where('a.scope_id', '=', input.fromPropertyId)
    .where('a.revoked_at', 'is', null)
    .execute();
  const selected = current.filter(
    (a) => (!input.roleKeys || input.roleKeys.includes(a.key)) && (!a.ends_at || a.ends_at > effective),
  );
  if (selected.length === 0) {
    throw new BusinessRuleError(
      'nothing_to_transfer',
      'This person has no current roles at the property they are moving from. Grant roles at the new property instead.',
    );
  }
  return {
    userId: input.userId,
    fromPropertyId: input.fromPropertyId,
    toPropertyId: input.toPropertyId,
    effectiveAt: effective.toISOString(),
    remove: selected.map((a) => ({ assignmentId: a.id, roleKey: a.key })),
    add: [...new Set(selected.map((a) => a.key))].map((roleKey) => ({
      roleKey,
      propertyId: input.toPropertyId,
    })),
  };
}

export async function previewTransfer(
  tx: TxContext,
  input: {
    userId: string;
    fromPropertyId: string;
    toPropertyId: string;
    roleKeys?: string[] | undefined;
    effectiveAt?: Date | undefined;
  },
) {
  requirePermission(tx, 'identity.role.assign');
  return planTransfer(tx, input);
}

/**
 * Move a member between properties as ONE operation (IDN-R07): the old property-scoped assignments end and the
 * same roles start at the new property at the same instant (now, or a scheduled `effectiveAt`). Audited as a
 * transfer, not as unrelated grants and revocations.
 */
export async function transferMember(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'propertyIdsInScope' | 'assertPropertyExists'>,
  input: {
    userId: string;
    fromPropertyId: string;
    toPropertyId: string;
    roleKeys?: string[] | undefined;
    effectiveAt?: Date | undefined;
    reason: string;
  },
): Promise<TransferPlan> {
  requirePermission(tx, 'identity.role.assign');
  const plan = await planTransfer(tx, input);
  const effective = new Date(plan.effectiveAt);
  const immediate = effective.getTime() <= tx.now.getTime();
  for (const r of plan.remove) {
    await db(tx)
      .updateTable('identity.role_assignments')
      .set(
        immediate
          ? { revoked_at: tx.now, revoked_by: actorRef(tx), revoke_reason: `transfer: ${input.reason}` }
          : { ends_at: effective },
      )
      .where('id', '=', r.assignmentId)
      .execute();
  }
  for (const a of plan.add) {
    await assignRole(
      tx,
      {
        userId: input.userId,
        roleKey: a.roleKey,
        scopeType: 'property',
        scopeId: a.propertyId,
        reason: `transfer: ${input.reason}`,
        source: 'transfer',
        ...(immediate ? {} : { startsAt: effective }),
      },
      ports,
    );
  }
  await db(tx)
    .updateTable('identity.memberships')
    .set({ default_property_id: input.toPropertyId, version: sql`version + 1` })
    .where('user_id', '=', input.userId)
    .where('default_property_id', '=', input.fromPropertyId)
    .execute();
  await tx.audit({
    action: 'identity.user.transfer',
    target: { type: 'user', id: input.userId },
    reason: input.reason,
    before: { propertyId: input.fromPropertyId, roles: plan.remove.map((r) => r.roleKey) },
    after: {
      propertyId: input.toPropertyId,
      roles: plan.add.map((a) => a.roleKey),
      effectiveAt: plan.effectiveAt,
    },
  });
  await tx.emit({
    type: 'identity.member.transferred',
    propertyId: input.toPropertyId,
    aggregate: { type: 'user', id: input.userId },
    payload: { ...plan },
  });
  return plan;
}

// ───────────────────────────── Membership administration ─────────────────────────────

export async function updateMember(
  tx: TxContext,
  userId: string,
  expectedVersion: number,
  patch: {
    displayName?: string | undefined;
    jobTitle?: string | null | undefined;
    defaultPropertyId?: string | null | undefined;
  },
) {
  requirePermission(tx, 'identity.user.manage');
  const row = await db(tx)
    .updateTable('identity.memberships')
    .set({
      ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
      ...(patch.jobTitle !== undefined ? { job_title: patch.jobTitle } : {}),
      ...(patch.defaultPropertyId !== undefined ? { default_property_id: patch.defaultPropertyId } : {}),
      version: sql`version + 1`,
    })
    .where('user_id', '=', userId)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) {
    return explainVersionMiss('user', userId, expectedVersion, async () => {
      const m = await db(tx)
        .selectFrom('identity.memberships')
        .select('version')
        .where('user_id', '=', userId)
        .executeTakeFirst();
      return m?.version;
    });
  }
  await tx.audit({ action: 'identity.user.update', target: { type: 'user', id: userId }, after: patch });
  return getMember(tx, userId);
}

export async function reactivateMember(tx: TxContext, userId: string, reason: string) {
  requirePermission(tx, 'identity.user.manage');
  const res = await db(tx)
    .updateTable('identity.memberships')
    .set({ status: 'active', status_reason: reason, version: sql`version + 1` })
    .where('user_id', '=', userId)
    .where('status', '=', 'suspended')
    .executeTakeFirst();
  if (Number(res.numUpdatedRows) === 0)
    throw new BusinessRuleError('not_suspended', 'Only a suspended member can be reactivated.');
  await tx.audit({ action: 'identity.user.reactivate', target: { type: 'user', id: userId }, reason });
  await tx.emit({
    type: 'identity.membership.activated',
    aggregate: { type: 'user', id: userId },
    payload: { userId },
  });
  return getMember(tx, userId);
}

/**
 * Remove a member (terminal for this membership; IDN-R06): sessions, role assignments, pending invitations,
 * elevations and the API credentials this person issued in this organization are revoked immediately. The person's
 * records stay for audit attribution; other organizations are unaffected.
 */
export async function removeMember(tx: TxContext, userId: string, reason: string) {
  requirePermission(tx, 'identity.user.manage');
  if (tx.actor.kind === 'user' && tx.actor.userId === userId)
    throw new BusinessRuleError(
      'segregation_of_duties',
      'You cannot remove yourself. Ask another administrator.',
    );
  const res = await db(tx)
    .updateTable('identity.memberships')
    .set({ status: 'removed', status_reason: reason, removed_at: tx.now, version: sql`version + 1` })
    .where('user_id', '=', userId)
    .where('status', '<>', 'removed')
    .executeTakeFirst();
  if (Number(res.numUpdatedRows) === 0) throw new NotFoundError('user', userId);
  const by = actorRef(tx);
  const sessions = await db(tx)
    .updateTable('identity.sessions')
    .set({ revoked_at: tx.now, revoked_reason: 'member_removed', revoked_by: by })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  const assignments = await db(tx)
    .updateTable('identity.role_assignments')
    .set({ revoked_at: tx.now, revoked_by: by, revoke_reason: 'member_removed' })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  const apiClients = await db(tx)
    .updateTable('identity.api_clients')
    .set({ status: 'revoked' })
    .where('created_by', '=', userId)
    .where('status', '=', 'active')
    .executeTakeFirst();
  await db(tx)
    .updateTable('identity.credential_tokens')
    .set({ revoked_at: tx.now })
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .where('revoked_at', 'is', null)
    .execute();
  await db(tx)
    .updateTable('identity.elevations')
    .set({ ended_at: tx.now, ended_reason: 'member_removed' })
    .where('user_id', '=', userId)
    .where('ended_at', 'is', null)
    .execute();
  const counts = {
    sessions: Number(sessions.numUpdatedRows),
    assignments: Number(assignments.numUpdatedRows),
    apiClients: Number(apiClients.numUpdatedRows),
  };
  await tx.audit({
    action: 'identity.user.remove',
    target: { type: 'user', id: userId },
    reason,
    after: counts,
  });
  await tx.emit({
    type: 'identity.membership.removed',
    aggregate: { type: 'user', id: userId },
    payload: { userId, reason, ...counts },
  });
  return counts;
}

/** A member with their assignments (ids, scopes, periods, source), MFA status and sign-in activity. */
export async function getMember(tx: TxContext, userId: string) {
  const self = tx.actor.kind === 'user' && tx.actor.userId === userId;
  if (!self) requirePermission(tx, 'identity.user.read');
  const m = await db(tx)
    .selectFrom('identity.memberships as m')
    .innerJoin('identity.users as u', 'u.id', 'm.user_id')
    .select([
      'u.id',
      'u.email',
      'm.display_name',
      'm.job_title',
      'm.status',
      'm.default_property_id',
      'm.provisioned_by',
      'm.external_id',
      'm.activated_at',
      'm.version',
    ])
    .where('m.user_id', '=', userId)
    .executeTakeFirst();
  if (!m) throw new NotFoundError('user', userId);
  const assignments = await db(tx)
    .selectFrom('identity.role_assignments as a')
    .innerJoin('identity.roles as r', 'r.id', 'a.role_id')
    .select(['a.id', 'r.key', 'r.name', 'a.scope_type', 'a.scope_id', 'a.starts_at', 'a.ends_at', 'a.source'])
    .where('a.user_id', '=', userId)
    .where('a.revoked_at', 'is', null)
    .orderBy('a.created_at')
    .execute();
  const lastSession = await db(tx)
    .selectFrom('identity.sessions')
    .select('created_at')
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  return {
    userId: m.id,
    email: m.email,
    displayName: m.display_name,
    jobTitle: m.job_title,
    status: m.status,
    defaultPropertyId: m.default_property_id,
    provisionedBy: m.provisioned_by,
    externalId: m.external_id,
    activatedAt: m.activated_at?.toISOString() ?? null,
    lastSignInAt: lastSession?.created_at.toISOString() ?? null,
    mfa: await mfaStatus(tx, userId),
    assignments: assignments.map((a) => ({
      assignmentId: a.id,
      roleKey: a.key,
      roleName: a.name,
      scopeType: a.scope_type,
      scopeId: a.scope_id,
      startsAt: a.starts_at?.toISOString() ?? null,
      endsAt: a.ends_at?.toISOString() ?? null,
      source: a.source,
      effective: (!a.starts_at || a.starts_at <= tx.now) && (!a.ends_at || a.ends_at > tx.now),
    })),
    version: m.version,
  };
}
