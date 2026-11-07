import { sql, type TxContext, typed } from '@portico/db';
import {
  type Actor,
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
} from '@portico/kernel';
import { entryCovers } from '../domain/permissions';
import type { IdentityPorts } from '../ports';
import type { IdentityDB } from '../tables';

/**
 * Guardrails from ADR-0017 (global identity and cross-organization safety). Shared by every identity service that
 * changes credentials or privileges. No imports from service.ts (avoids cycles).
 */
const db = (tx: TxContext) => typed<IdentityDB>(tx.db);

/** Memberships (ANY status) the person has in other organizations. Never says which. */
export async function membershipsElsewhere(tx: TxContext, userId: string): Promise<number> {
  const { rows } = await sql<{ n: number }>`
    select identity.memberships_elsewhere(${userId}::uuid, ${tx.tenantId}::uuid) as n`.execute(tx.db);
  return rows[0]?.n ?? 0;
}

/**
 * ADR-0017 §1: an organization may reset a person's credentials (password, MFA) only when EVERY membership of that
 * person, in any status, is in this organization. Otherwise only the person (self-service) or Monoclay support can.
 */
export async function assertSoleOrganizationMember(
  tx: TxContext,
  userId: string,
  action: 'password_reset' | 'mfa_reset',
): Promise<void> {
  if ((await membershipsElsewhere(tx, userId)) > 0) {
    throw new BusinessRuleError(
      'person_shared_with_other_organization',
      action === 'password_reset'
        ? 'This person also works for another organization, so only they can reset their password. Ask them to use "Forgot password" on the sign-in page.'
        : 'This person also works for another organization, so their two-step verification can only be reset by them (with a recovery code) or by Monoclay support after an identity check.',
      { action },
    );
  }
}

/** A human acting as themselves (not an API client, not a system process, not a Monoclay support session). */
export function isHumanSelf(actor: Actor): actor is Extract<Actor, { kind: 'user' }> {
  return actor.kind === 'user' && !actor.impersonatedBy;
}

/** Approvals governed by separation of duties are human acts (ADR-0017 §7). */
export function assertHumanApprover(tx: TxContext, what: string): void {
  if (!isHumanSelf(tx.actor)) {
    throw new BusinessRuleError(
      'human_approval_required',
      `${what} must be approved by a person signed in as themselves, not by an API client, a system process or a support session.`,
    );
  }
}

/** ADR-0017 §10: while emergency access is active, no durable privilege may be created or changed. */
export function assertNotElevated(tx: TxContext, what: string): void {
  if ((tx.actor as Actor & { via?: string }).via === 'elevation') {
    throw new BusinessRuleError(
      'not_during_emergency_access',
      `${what} is not possible during emergency access: emergency access must not leave lasting privileges. End emergency access and ask an administrator.`,
    );
  }
}

/**
 * Guardrail against privilege escalation: the actor must hold every listed permission across the whole scope.
 * Trusted system processes use the system authorizer and pass.
 */
export async function assertCanGrantRole(
  tx: TxContext,
  permissions: readonly string[],
  scope: { type: 'organization' | 'brand' | 'region' | 'property'; id: string | null },
  ports?: Pick<IdentityPorts, 'propertyIdsInScope'>,
  reason = 'You can only grant roles whose permissions you hold yourself for the same scope.',
): Promise<void> {
  let propertyIds: string[] | 'all' = 'all';
  if (scope.type === 'property') propertyIds = [scope.id as string];
  else if ((scope.type === 'brand' || scope.type === 'region') && ports)
    propertyIds = await ports.propertyIdsInScope(tx, { type: scope.type, id: scope.id as string });
  for (const p of permissions) {
    const held = tx.authz.propertyScope(p);
    const ok =
      held === 'all' ||
      (propertyIds !== 'all' && propertyIds.length > 0 && propertyIds.every((id) => held.includes(id)));
    if (!ok) throw new ForbiddenError(p, { reason });
  }
}

async function activeAssignments(tx: TxContext, userId: string) {
  return db(tx)
    .selectFrom('identity.role_assignments as a')
    .innerJoin('identity.roles as r', 'r.id', 'a.role_id')
    .select(['a.id', 'r.permissions', 'a.scope_type', 'a.scope_id'])
    .where('a.user_id', '=', userId)
    .where('a.revoked_at', 'is', null)
    .where((eb) => eb.or([eb('a.ends_at', 'is', null), eb('a.ends_at', '>', tx.now)]))
    .execute();
}

/**
 * ADR-0017 §6: an actor may revoke, suspend, remove or reset only members whose effective permissions are a subset
 * of their own (for the same scopes).
 */
export async function assertPowerOver(
  tx: TxContext,
  targetUserId: string,
  ports?: Pick<IdentityPorts, 'propertyIdsInScope'>,
): Promise<void> {
  for (const a of await activeAssignments(tx, targetUserId)) {
    await assertCanGrantRole(
      tx,
      a.permissions,
      { type: a.scope_type, id: a.scope_id },
      ports,
      'You can only manage people whose permissions you also hold. Ask an administrator with at least their access.',
    );
  }
}

const ADMIN_PERMISSIONS = ['identity.role.assign', 'identity.user.manage'] as const;

/**
 * ADR-0017 §6: no change may leave the organization without an active member holding organization-wide
 * `identity.role.assign` + `identity.user.manage`. Pass what the pending change removes.
 */
export async function assertAdministratorRemains(
  tx: TxContext,
  removing: { userId?: string; assignmentIds?: readonly string[] },
): Promise<void> {
  const rows = await db(tx)
    .selectFrom('identity.role_assignments as a')
    .innerJoin('identity.roles as r', 'r.id', 'a.role_id')
    .innerJoin('identity.memberships as m', 'm.user_id', 'a.user_id')
    .innerJoin('identity.users as u', 'u.id', 'a.user_id')
    .select(['a.id', 'a.user_id', 'r.permissions'])
    .where('a.scope_type', '=', 'organization')
    .where('a.revoked_at', 'is', null)
    .where((eb) => eb.or([eb('a.starts_at', 'is', null), eb('a.starts_at', '<=', tx.now)]))
    .where((eb) => eb.or([eb('a.ends_at', 'is', null), eb('a.ends_at', '>', tx.now)]))
    .where('m.status', '=', 'active')
    .where('u.status', '<>', 'disabled')
    .execute();
  const admins = (exclude: boolean) => {
    const held = new Map<string, Set<string>>();
    for (const r of rows) {
      if (exclude && (r.user_id === removing.userId || removing.assignmentIds?.includes(r.id))) continue;
      const set = held.get(r.user_id) ?? new Set<string>();
      for (const p of ADMIN_PERMISSIONS) if (r.permissions.some((e) => entryCovers(e, p))) set.add(p);
      held.set(r.user_id, set);
    }
    return [...held.values()].filter((s) => ADMIN_PERMISSIONS.every((p) => s.has(p))).length;
  };
  // Only a change that REMOVES the last administrator is refused (an organization without one is not made worse).
  if (admins(false) > 0 && admins(true) === 0) {
    throw new BusinessRuleError(
      'last_administrator',
      'This would leave the organization without an active administrator who can manage staff and roles. Make someone else an administrator first.',
    );
  }
}

/** Revoke the API keys a person issued in this organization (suspension, MFA reset; ADR-0017 §9). */
export async function revokeApiKeysIssuedBy(tx: TxContext, userId: string): Promise<number> {
  const res = await db(tx)
    .updateTable('identity.api_clients')
    .set({ status: 'revoked' })
    .where('created_by', '=', userId)
    .where('status', '=', 'active')
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
}

export interface CredentialSummary {
  emailVerified: boolean;
  hasPassword: boolean;
  hasFactor: boolean;
  ssoLinks: number;
}

/** What credentials a person holds anywhere (ADR-0017 rule 14). Counts only; never says where. */
export async function credentialSummary(tx: TxContext, userId: string): Promise<CredentialSummary> {
  const { rows } = await sql<{
    email_verified: boolean;
    has_password: boolean;
    has_factor: boolean;
    sso_links: number;
  }>`select * from identity.credential_summary(${userId}::uuid)`.execute(tx.db);
  const r = rows[0];
  return {
    emailVerified: r?.email_verified ?? false,
    hasPassword: r?.has_password ?? false,
    hasFactor: r?.has_factor ?? false,
    ssoLinks: r?.sso_links ?? 0,
  };
}

export function hasAnyCredential(c: CredentialSummary): boolean {
  return c.hasPassword || c.hasFactor || c.ssoLinks > 0;
}

/**
 * ADR-0017 rule 12: the person has just proved control of their email (an emailed link, or an IdP whose domain this
 * organization verified). The first time, every earlier credential is wiped everywhere (password, factors, recovery
 * codes, SSO links, sessions, API keys they issued) so nothing set before the proof survives. Returns true when this
 * was the first verification. Call it while the person has a membership in the current organization.
 */
export async function verifyEmailOwnership(tx: TxContext, userId: string): Promise<boolean> {
  const { rows } = await sql<{ first: boolean }>`
    select identity.first_email_verification(${userId}::uuid, ${tx.now}::timestamptz) as first`.execute(
    tx.db,
  );
  const first = rows[0]?.first ?? false;
  if (first)
    await tx.audit({
      action: 'identity.email.verified',
      target: { type: 'user', id: userId },
      metadata: { earlierCredentialsWiped: true },
    });
  return first;
}

/** Everyone holding organization-wide `identity.user.manage` among active members (the organization's admins). */
export async function administratorEmails(tx: TxContext, exceptUserId?: string): Promise<string[]> {
  let q = db(tx)
    .selectFrom('identity.role_assignments as a')
    .innerJoin('identity.roles as r', 'r.id', 'a.role_id')
    .innerJoin('identity.users as u', 'u.id', 'a.user_id')
    .innerJoin('identity.memberships as m', 'm.user_id', 'a.user_id')
    .select(['u.email', 'r.permissions'])
    .where('a.scope_type', '=', 'organization')
    .where('a.revoked_at', 'is', null)
    .where('m.status', '=', 'active');
  if (exceptUserId) q = q.where('a.user_id', '<>', exceptUserId);
  const rows = await q.execute();
  return [
    ...new Set(
      rows
        .filter((r) => r.permissions.some((p) => entryCovers(p, 'identity.user.manage')))
        .map((r) => r.email),
    ),
  ];
}

/** Tell every administrator about a security-relevant change (break-glass, SSO root changes). */
export async function notifyAdministrators(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'notifier'>,
  message: { subject: string; body: string; exceptUserId?: string },
): Promise<void> {
  if (!ports.notifier) return;
  for (const to of await administratorEmails(tx, message.exceptUserId))
    await ports.notifier.send(tx, {
      kind: 'staff.securityAlert',
      to,
      subject: message.subject,
      body: message.body,
    });
}

/**
 * ADR-0017 rule 15: some changes are root changes (they decide who can sign in as whom). The editor must hold
 * organization-wide `*`; a second-administrator approval flow is not built yet, so nothing weaker is accepted.
 */
export function assertRootChange(tx: TxContext, what: string): void {
  if (tx.actor.kind === 'system') return;
  if (tx.authz.propertyScope('*') !== 'all')
    throw new ForbiddenError('*', {
      reason: `${what} is a root change: only an administrator with full organization-wide access can make it.`,
    });
}

/**
 * Review R3-P1-1: lock the person's row BEFORE reading any credential state. A first-verification wipe takes the same
 * lock, so a credential write either completes before the wipe (and is wiped) or starts after it (and sees the new
 * epoch). Returns the current email verification and credential epoch.
 */
/**
 * Demo seeding (ADR-0017 rules 12 and 16): only a system process, only in an organization that IS in the `demo`
 * environment (checked in the database too, not only in the request context), only for a reserved fictitious
 * `*.portico.invalid` address. Anything else is refused by the caller.
 */
export async function isDemoSeeding(tx: TxContext, email: string): Promise<boolean> {
  if (tx.actor.kind !== 'system' || tx.environment !== 'demo') return false;
  const domain = email.toLowerCase().split('@').at(-1) ?? '';
  if (!(domain === 'portico.invalid' || domain.endsWith('.portico.invalid'))) return false;
  const { rows } = await sql<{ environment: string }>`
    select environment from platform.tenant_summaries(${[tx.tenantId]}::uuid[])`.execute(tx.db);
  return rows[0]?.environment === 'demo';
}

export async function lockPerson(
  tx: TxContext,
  userId: string,
): Promise<{ emailVerified: boolean; epoch: number }> {
  const { rows } = await sql<{ email_verified: boolean; credential_epoch: number }>`
    select * from identity.lock_person(${userId}::uuid)`.execute(tx.db);
  const r = rows[0];
  if (!r) throw new NotFoundError('user', userId);
  return { emailVerified: r.email_verified, epoch: r.credential_epoch };
}

/**
 * The acting session must still be valid AFTER the person's row lock: not revoked, and from the current credential
 * epoch. A request authenticated just before a first-verification wipe cannot finish a credential change after it.
 */
export async function assertSessionCurrent(tx: TxContext, epoch: number): Promise<void> {
  const actor = tx.actor;
  if (actor.kind !== 'user' || !actor.sessionId) return;
  const s = await db(tx)
    .selectFrom('identity.sessions')
    .select(['revoked_at', 'credential_epoch'])
    .where('id', '=', actor.sessionId)
    .executeTakeFirst();
  if (!s || s.revoked_at || s.credential_epoch !== epoch)
    throw new UnauthenticatedError('Your session ended because your sign-in details changed. Sign in again.');
}
