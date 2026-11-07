import { verify as argonVerify } from '@node-rs/argon2';
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
import {
  assertAdministratorRemains,
  assertCanGrantRole,
  assertNotElevated,
  assertPowerOver,
  assertSoleOrganizationMember,
  credentialSummary,
  hasAnyCredential,
  isHumanSelf,
  lockPerson,
  verifyEmailOwnership,
} from './guard';
import {
  mfaStatus,
  recordSecondFactorFailure,
  recordSecondFactorSuccess,
  reserveSecondFactorAttempt,
  SecondFactorLockedError,
  verifySecondFactor,
} from './mfa';

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
  // ADR-0017 §3: links reach only the person. Without a bound notifier nothing is delivered (and nothing is
  // returned to the caller either).
  if (!ports.notifier) return { mode: 'simulated' };
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
  const id = newId();
  const expiresAt = new Date(tx.now.getTime() + ttlMs);
  await db(tx)
    .insertInto('identity.credential_tokens')
    .values({
      id,
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
  return { token, expiresAt, tokenId: id };
}

/** R3-P3-3: remember how the link was delivered; only `queued` (sent to the real address) proves the email. */
async function recordDelivery(tx: TxContext, tokenId: string, mode: NotifierResult['mode']) {
  await db(tx)
    .updateTable('identity.credential_tokens')
    .set({ delivery_mode: mode })
    .where('id', '=', tokenId)
    .execute();
}

function link(ports: Pick<IdentityPorts, 'config'>, path: string, token: string): string {
  const base = ports.config?.appBaseUrl ?? 'http://localhost:5173';
  return `${base.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;
}

/** Ports an invitation needs (the notifier delivers the link to the person only). */
export type InvitePorts = Pick<IdentityPorts, 'notifier' | 'config' | 'organizationName'> &
  Partial<Pick<IdentityPorts, 'propertyIdsInScope' | 'assertPropertyExists'>>;

export interface CreateUserInput {
  email: string;
  displayName: string;
  jobTitle?: string | undefined;
  roles: Array<{
    roleKey: string;
    scopeType: 'organization' | 'brand' | 'region' | 'property';
    scopeId?: string | undefined;
  }>;
}

const NO_ORG_SET_PASSWORDS =
  'Portico never lets an organization choose a person’s password. Add them without one: they receive an invitation by email and choose their own password.';

/**
 * Add a staff member (ADR-0017 rules 2 and 12). No organization ever sets a password: every person — new or existing
 * — gets an `invited` membership and an invitation link sent to their own email; the membership becomes active when
 * they accept it (a new person chooses their first password there, which also verifies their email). The answer has
 * the same shape whether or not the email already had a Portico identity (no account enumeration, R2-P3-6).
 */
export async function createUser(
  tx: TxContext,
  input: CreateUserInput,
  ports: InvitePorts = {},
): Promise<{ userId: string; status: 'invited'; invitationExpiresAt: string; delivery: NotifierResult }> {
  if ((input as { initialPassword?: unknown }).initialPassword !== undefined)
    throw new ValidationError('password_not_allowed', NO_ORG_SET_PASSWORDS);
  const r = await inviteMember(tx, ports, input);
  await tx.audit({
    action: 'identity.user.create',
    target: { type: 'user', id: r.userId },
    after: { displayName: input.displayName, roles: input.roles, status: 'invited' },
  });
  return {
    userId: r.userId,
    status: 'invited',
    invitationExpiresAt: r.invitationExpiresAt,
    delivery: r.delivery,
  };
}

/**
 * Demo and test seeding only (ADR-0017 rule 12): a system process may give a person a password ONLY in a `demo`
 * organization and ONLY for a reserved fictitious address (`*.portico.invalid`). Never routed over HTTP. The person
 * is active immediately with a verified (fictitious) email.
 */
export async function seedDemoMember(
  tx: TxContext,
  input: CreateUserInput & { password: string },
): Promise<{ userId: string }> {
  const domain = input.email.toLowerCase().split('@').at(-1) ?? '';
  if (
    tx.actor.kind !== 'system' ||
    tx.environment !== 'demo' ||
    !(domain === 'portico.invalid' || domain.endsWith('.portico.invalid'))
  )
    throw new ValidationError(
      'password_not_allowed',
      'Passwords may be seeded only by a system process, in a demo organization, for *.portico.invalid addresses.',
    );
  const { rows } = await sql<{
    id: string;
  }>`select identity.ensure_user(${newId()}::uuid, ${input.email}) as id`.execute(tx.db);
  const userId = rows[0]?.id as string;
  await db(tx)
    .insertInto('identity.memberships')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      user_id: userId,
      display_name: input.displayName,
      job_title: input.jobTitle ?? null,
      status: 'active',
      activated_at: tx.now,
      provisioned_by: 'manual',
    })
    .execute();
  await db(tx)
    .updateTable('identity.users')
    .set({ password_hash: await hashPassword(input.password), email_verified_at: tx.now })
    .where('id', '=', userId)
    .execute();
  for (const r of input.roles) await assignRole(tx, { userId, ...r });
  await tx.audit({
    action: 'identity.user.seedDemo',
    target: { type: 'user', id: userId },
    after: { displayName: input.displayName, roles: input.roles },
  });
  return { userId };
}

/** Invite a person: membership `invited`, roles granted (effective once accepted), invitation link sent. */
export async function inviteMember(
  tx: TxContext,
  ports: InvitePorts,
  input: { email: string; displayName: string; jobTitle?: string | undefined; roles: RoleInput[] },
) {
  requirePermission(tx, 'identity.user.manage');
  assertNotElevated(tx, 'Inviting staff');
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
      ports.propertyIdsInScope
        ? (ports as Pick<IdentityPorts, 'propertyIdsInScope' | 'assertPropertyExists'>)
        : undefined,
    );
  }
  const sent = await sendInvitation(tx, ports, {
    userId,
    email: input.email,
    displayName: input.displayName,
  });
  await tx.audit({
    action: 'identity.user.invite',
    target: { type: 'user', id: userId },
    after: { displayName: input.displayName, roles: input.roles, delivery: sent.delivery.mode },
  });
  return { userId, ...sent };
}

/**
 * Send (or re-send) the invitation link to the person's OWN email (ADR-0017 §3). The link is never returned to the
 * caller; in non-live environments it lands in the operator/developer mailbox.
 */
export async function sendInvitation(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'notifier' | 'config' | 'organizationName'>,
  input: { userId: string; email: string; displayName: string },
): Promise<{ invitationExpiresAt: string; delivery: NotifierResult }> {
  const { token, expiresAt, tokenId } = await issueToken(
    tx,
    input.userId,
    'invitation',
    INVITATION_DAYS * 86_400_000,
  );
  const orgName = ports.organizationName ? await ports.organizationName(tx) : 'your organization';
  const delivery = await send(tx, ports, {
    kind: 'staff.invitation',
    to: input.email,
    subject: `You have been invited to ${orgName} on Portico`,
    body: `${input.displayName}, you have been invited to join ${orgName}. The invitation is valid until ${expiresAt.toISOString()}. If you already use Portico, sign in and accept it from your account.`,
    link: link(ports, '/accept-invitation', token),
  });
  await recordDelivery(tx, tokenId, delivery.mode);
  await tx.emit({
    type: 'identity.membership.invited',
    aggregate: { type: 'user', id: input.userId },
    payload: { userId: input.userId, expiresAt: expiresAt.toISOString(), delivery: delivery.mode },
  });
  return { invitationExpiresAt: expiresAt.toISOString(), delivery };
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

/**
 * Accept an invitation with the emailed link (public). ADR-0017 §2/§4:
 *  - a brand-new person (no other membership) chooses their first password here;
 *  - a person who already has a Portico sign-in must prove it — their current password and, when enrolled, a code
 *    from their authenticator (or a recovery code); their credentials are never changed here;
 *  - a person who exists elsewhere but has no password (SSO/SCIM-only) accepts while signed in as themselves
 *    (`acceptMembershipAsSelf`).
 * Failed proofs count towards the per-person lock and do not consume the link.
 */
export async function acceptInvitation(
  database: PorticoDatabase,
  ports: Pick<IdentityPorts, 'cipher' | 'notifier'>,
  input: {
    token: string;
    password?: string | undefined;
    code?: string | undefined;
    recoveryCode?: string | undefined;
  },
): Promise<{ organizationId: string; userId: string }> {
  const ctx = await tokenContext(database, input.token, 'inv');
  if (!ctx) throw new UnauthenticatedError(INVALID_TOKEN);
  // R3-P1-1 (d): hash a possible first password BEFORE the transaction, so the person's row lock is short.
  const newHash = input.password && input.password.length >= 12 ? await hashPassword(input.password) : null;
  const outcome = await withTenantTx(
    database,
    ctx,
    async (tx): Promise<{ ok: true; userId: string } | { ok: false; error: Error }> => {
      const t = await db(tx)
        .selectFrom('identity.credential_tokens')
        .selectAll()
        .where('token_hash', '=', sha256Hex(input.token))
        .where('kind', '=', 'invitation')
        .forUpdate()
        .executeTakeFirst();
      if (!t || t.used_at || t.revoked_at || t.expires_at <= tx.now)
        throw new UnauthenticatedError(INVALID_TOKEN);
      const m = await db(tx)
        .selectFrom('identity.memberships')
        .select(['id', 'status'])
        .where('user_id', '=', t.user_id)
        .executeTakeFirst();
      if (m?.status !== 'invited') throw new UnauthenticatedError(INVALID_TOKEN);
      // R3-P1-1: the person's row lock before any credential state is read.
      await lockPerson(tx, t.user_id);
      const creds = await credentialSummary(tx, t.user_id);
      // R3-P3-3: only a link actually sent to the person's address proves it; a simulated link (non-live
      // organizations, read from the operator mailbox) never verifies an email.
      const proves = t.delivery_mode === 'queued';
      const sso = await db(tx)
        .selectFrom('identity.sso_connections')
        .select(['sso_required', 'status'])
        .executeTakeFirst();
      const ssoOnly = sso?.status === 'active' && sso.sso_required;
      if (!creds.emailVerified || !hasAnyCredential(creds)) {
        // ADR-0017 rules 12 and 14: this link proves control of the email. A person whose email was never verified,
        // or who holds no credential at all, chooses their first password here — whatever invitations they hold
        // elsewhere. The first verification wipes every credential set before it (pre-hijacking defence).
        if (!ssoOnly && (input.password ?? '').length < 12)
          throw new ValidationError(
            'password_required',
            'Choose a password (at least 12 characters) to finish joining.',
          );
        if (proves) await verifyEmailOwnership(tx, t.user_id);
        if (!ssoOnly && newHash)
          await db(tx)
            .updateTable('identity.users')
            .set({ password_hash: newHash, failed_logins: 0, locked_until: null })
            .where('id', '=', t.user_id)
            .execute();
      } else if (creds.hasPassword) {
        // A verified person with a sign-in proves it; their credentials are never changed here.
        if (!input.password)
          return {
            ok: false,
            error: new ValidationError(
              'proof_required',
              'You already have a Portico sign-in: enter your current password (and a code from your authenticator if you use one) to accept.',
            ),
          };
        const lock = await reserveSecondFactorAttempt(tx, t.user_id);
        if (lock) return { ok: false, error: new SecondFactorLockedError(lock) };
        const u = await db(tx)
          .selectFrom('identity.users')
          .select('password_hash')
          .where('id', '=', t.user_id)
          .executeTakeFirstOrThrow();
        const pwOk = await argonVerify(u.password_hash as string, input.password).catch(() => false);
        const factorOk =
          !creds.hasFactor ||
          ((!!input.code || !!input.recoveryCode) &&
            (await verifySecondFactor(tx, ports, t.user_id, input)) !== null);
        if (!pwOk || !factorOk) {
          await recordSecondFactorFailure(tx, ports, t.user_id);
          return {
            ok: false,
            error: new UnauthenticatedError(
              'Your password or verification code is not correct. Enter the credentials you already use for Portico.',
            ),
          };
        }
        await recordSecondFactorSuccess(tx, t.user_id);
      } else {
        // Verified, signs in only through an identity provider: accept from the account (in-app).
        return {
          ok: false,
          error: new BusinessRuleError(
            'sign_in_to_accept',
            'You already sign in to Portico through your organization’s single sign-on. Sign in that way and accept this invitation from your account.',
          ),
        };
      }
      await db(tx)
        .updateTable('identity.credential_tokens')
        .set({ used_at: tx.now })
        .where('id', '=', t.id)
        .execute();
      await activateInvitedMembership(tx, m.id, t.user_id, 'invitation_link');
      return { ok: true, userId: t.user_id };
    },
  );
  if (!outcome.ok) throw outcome.error;
  return { organizationId: ctx.tenantId, userId: outcome.userId };
}

async function activateInvitedMembership(tx: TxContext, membershipId: string, userId: string, via: string) {
  await db(tx)
    .updateTable('identity.memberships')
    .set({ status: 'active', activated_at: tx.now, version: sql`version + 1` })
    .where('id', '=', membershipId)
    .execute();
  await tx.audit({
    action: 'identity.user.acceptInvitation',
    target: { type: 'user', id: userId },
    metadata: { via },
  });
  await tx.emit({
    type: 'identity.membership.activated',
    aggregate: { type: 'user', id: userId },
    payload: { userId, via },
  });
}

async function emailVerified(database: PorticoDatabase, userId: string): Promise<boolean> {
  const { rows } = await sql<{ email_verified: boolean }>`
    select email_verified from identity.credential_summary(${userId}::uuid)`.execute(database.kysely);
  return rows[0]?.email_verified ?? false;
}

function systemContextFor(organizationId: string, environment: string, process: string): RequestContext {
  return {
    tenantId: organizationId,
    environment: environment as TenantEnvironment,
    actor: { kind: 'system', process },
    authz: systemAuthorizer,
    correlationId: newId(),
  };
}

/** An unused, unrevoked, unexpired invitation for the person in this organization (ADR-0017 rule 13). */
async function hasValidInvitation(tx: TxContext, userId: string): Promise<boolean> {
  const t = await db(tx)
    .selectFrom('identity.credential_tokens')
    .select('id')
    .where('user_id', '=', userId)
    .where('kind', '=', 'invitation')
    .where('used_at', 'is', null)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', tx.now)
    .executeTakeFirst();
  return !!t;
}

/**
 * Organizations that invited the signed-in person, so they can accept while signed in (ADR-0017 §2). Rule 13: only
 * an identity whose email is verified sees them, and only invitations that have not expired.
 */
export async function listMyInvitations(database: PorticoDatabase, actor: RequestContext['actor']) {
  if (!isHumanSelf(actor) || !(await emailVerified(database, actor.userId))) return [];
  const { rows } = await sql<{ id: string; name: string; environment: string; status: string }>`
    select id, name, environment, status from platform.tenant_summaries(
      array(select identity.pending_invitations(${actor.userId}::uuid))::uuid[])`.execute(database.kysely);
  const out: Array<{ organizationId: string; name: string; environment: string }> = [];
  for (const r of rows.filter((x) => x.status === 'active')) {
    const ok = await withTenantTx(database, systemContextFor(r.id, r.environment, 'invitations'), (tx) =>
      hasValidInvitation(tx, actor.userId),
    );
    if (ok) out.push({ organizationId: r.id, name: r.name, environment: r.environment });
  }
  return out;
}

/**
 * Accept an invitation while signed in as oneself. ADR-0017 rule 13: the identity's email must be verified (a session
 * alone is not proof that the person owns the address) and the invitation must not have expired.
 */
export async function acceptMembershipAsSelf(
  database: PorticoDatabase,
  actor: RequestContext['actor'],
  organizationId: string,
): Promise<{ organizationId: string; userId: string }> {
  if (!isHumanSelf(actor) || !actor.sessionId)
    throw new BusinessRuleError('not_a_user', 'Sign in as yourself to accept an invitation.');
  if (!(await emailVerified(database, actor.userId)))
    throw new BusinessRuleError(
      'email_not_verified',
      'Your email address is not confirmed yet. Open the invitation email and accept from there; that confirms your address.',
    );
  const { rows } = await sql<{ environment: string; status: string }>`
    select environment, status from platform.tenant_summaries(${[organizationId]}::uuid[])`.execute(
    database.kysely,
  );
  const org = rows[0];
  if (org?.status !== 'active') throw new NotFoundError('invitation', organizationId);
  const ctx: RequestContext = {
    tenantId: organizationId,
    environment: org.environment as TenantEnvironment,
    actor,
    authz: systemAuthorizer,
    correlationId: newId(),
  };
  return withTenantTx(database, ctx, async (tx) => {
    const m = await db(tx)
      .selectFrom('identity.memberships')
      .select(['id', 'status'])
      .where('user_id', '=', actor.userId)
      .executeTakeFirst();
    if (m?.status !== 'invited') throw new NotFoundError('invitation', organizationId);
    if (!(await hasValidInvitation(tx, actor.userId)))
      throw new BusinessRuleError(
        'invitation_expired',
        'This invitation has expired. Ask the organization to send a new one.',
      );
    await db(tx)
      .updateTable('identity.credential_tokens')
      .set({ used_at: tx.now })
      .where('user_id', '=', actor.userId)
      .where('kind', '=', 'invitation')
      .where('used_at', 'is', null)
      .execute();
    await activateInvitedMembership(tx, m.id, actor.userId, 'signed_in_acceptance');
    return { organizationId, userId: actor.userId };
  });
}

async function sendReset(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'notifier' | 'config'>,
  user: { id: string; email: string },
) {
  const { token, expiresAt, tokenId } = await issueToken(
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
  await recordDelivery(tx, tokenId, delivery.mode);
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
 * decides whether the email is real or simulated; organizations that require SSO are skipped. ADR-0017 rule 14: a
 * person who only holds invitations is reached too, through an organization that invited them (live first).
 */
export async function requestPasswordReset(
  database: PorticoDatabase,
  ports: Pick<IdentityPorts, 'notifier' | 'config'>,
  input: { email: string },
): Promise<void> {
  const { rows } = await sql<{ user_id: string; status: string; tenant_ids: string[] }>`
    select user_id, status, tenant_ids from identity.login_lookup(${input.email})`.execute(database.kysely);
  const user = rows[0];
  if (!user || user.status === 'disabled') return;
  let tenantIds = user.tenant_ids;
  if (tenantIds.length === 0) {
    const { rows: invited } = await sql<{ id: string }>`
      select identity.pending_invitations(${user.user_id}::uuid) as id`.execute(database.kysely);
    tenantIds = invited.map((r) => r.id);
  }
  if (tenantIds.length === 0) return;
  const { rows: orgs } = await sql<{ id: string; environment: string; status: string }>`
    select id, environment, status from platform.tenant_summaries(${tenantIds}::uuid[])`.execute(
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
  ports: Pick<IdentityPorts, 'notifier' | 'config' | 'propertyIdsInScope'>,
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
  // ADR-0017 §1/§6: only for a person whose every membership is here, and only by someone with at least their access.
  await assertSoleOrganizationMember(tx, userId, 'password_reset');
  await assertPowerOver(tx, userId, ports);
  return sendReset(tx, ports, u);
}

/**
 * Complete a reset (public). Revokes the person's sessions in every organization (credential changed). The link
 * proves control of the email (ADR-0017 rule 12): the first time, every earlier credential is wiped before the new
 * password is set.
 */
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
    await lockPerson(tx, t.user_id);
    if (t.delivery_mode === 'queued') await verifyEmailOwnership(tx, t.user_id);
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
  // Review R2-P2-2: a transfer removes access at one property and grants it at another, so the actor needs role
  // assignment at BOTH properties and power over the roles being removed — exactly as a direct revocation would.
  requirePermission(tx, 'identity.role.assign', { propertyId: input.fromPropertyId });
  requirePermission(tx, 'identity.role.assign', { propertyId: input.toPropertyId });
  assertNotElevated(tx, 'Transferring staff');
  if (tx.actor.kind === 'user' && tx.actor.userId === input.userId)
    throw new BusinessRuleError(
      'segregation_of_duties',
      'You cannot transfer yourself. Ask another administrator.',
    );
  const plan = await planTransfer(tx, input);
  if (plan.remove.length) {
    const roles = await db(tx)
      .selectFrom('identity.roles')
      .select(['key', 'permissions'])
      .where(
        'key',
        'in',
        plan.remove.map((r) => r.roleKey),
      )
      .execute();
    for (const r of roles)
      await assertCanGrantRole(
        tx,
        r.permissions,
        { type: 'property', id: input.fromPropertyId },
        ports,
        'You can only transfer people whose access at that property you also hold.',
      );
  }
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
export async function removeMember(
  tx: TxContext,
  userId: string,
  reason: string,
  ports?: Pick<IdentityPorts, 'propertyIdsInScope'>,
) {
  requirePermission(tx, 'identity.user.manage');
  if (tx.actor.kind === 'user' && tx.actor.userId === userId)
    throw new BusinessRuleError(
      'segregation_of_duties',
      'You cannot remove yourself. Ask another administrator.',
    );
  await assertPowerOver(tx, userId, ports);
  await assertAdministratorRemains(tx, { userId });
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
  // A removed member keeps no SSO link here (no orphan links, R2-P1-3).
  await db(tx).deleteFrom('identity.sso_identities').where('user_id', '=', userId).execute();
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
    mfa: m.status === 'invited' ? null : await mfaStatus(tx, userId),
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
