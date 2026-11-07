import { type PorticoDatabase, sql, type TxContext, typed, withTenantTx } from '@portico/db';
import {
  BusinessRuleError,
  type FieldCipher,
  ForbiddenError,
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
import { generateRecoveryCodes, hashRecoveryCode } from '../domain/recovery-codes';
import { base32Decode, generateTotpSecret, provisioningUri, verifyTotp } from '../domain/totp';
import { MfaRequiredError, NotConfiguredError } from '../errors';
import type { IdentityPorts } from '../ports';
import type { IdentityDB } from '../tables';
import { getSecurityPolicy } from './policy';
import { createSession } from './sessions';

/**
 * Multi-factor authentication: TOTP (RFC 6238) with replay protection, single-use recovery codes, a second-factor
 * challenge at sign-in for enrolled members, and step-up verification on the session (mfa_verified_at).
 * WebAuthn/passkeys are LATER (same factor table, kind 'webauthn').
 */
const db = (tx: TxContext) => typed<IdentityDB>(tx.db);

export const MFA_CHALLENGE_MINUTES = 5;
export const MFA_MAX_ATTEMPTS = 5;

function cipherOf(ports: Pick<IdentityPorts, 'cipher'>): FieldCipher {
  if (!ports.cipher) throw new NotConfiguredError('Two-step verification', 'field encryption');
  return ports.cipher;
}

function selfUserId(tx: TxContext): string {
  if (tx.actor.kind !== 'user' || tx.actor.impersonatedBy)
    throw new BusinessRuleError(
      'not_a_user',
      'Only a signed-in staff member can manage their own two-step verification.',
    );
  return tx.actor.userId;
}

export async function hasActiveTotp(tx: TxContext, userId: string): Promise<boolean> {
  const f = await db(tx)
    .selectFrom('identity.mfa_factors')
    .select('id')
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .executeTakeFirst();
  return !!f;
}

export async function mfaStatus(tx: TxContext, userId: string) {
  const factors = await db(tx)
    .selectFrom('identity.mfa_factors')
    .select(['status', 'confirmed_at'])
    .where('user_id', '=', userId)
    .where('status', 'in', ['active', 'pending'])
    .execute();
  const codes = await db(tx)
    .selectFrom('identity.mfa_recovery_codes')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .executeTakeFirstOrThrow();
  const active = factors.find((f) => f.status === 'active');
  return {
    enrolled: !!active,
    enrolledAt: active?.confirmed_at?.toISOString() ?? null,
    pendingEnrolment: factors.some((f) => f.status === 'pending'),
    recoveryCodesRemaining: active ? codes.n : 0,
  };
}

async function currentSession(tx: TxContext) {
  if (tx.actor.kind !== 'user' || !tx.actor.sessionId) return undefined;
  return db(tx)
    .selectFrom('identity.sessions')
    .select(['id', 'mfa_verified_at', 'mfa_failures'])
    .where('id', '=', tx.actor.sessionId)
    .executeTakeFirst();
}

/** Sensitive self-service changes (re-enrol, disable, new recovery codes) need a recent verification. */
export async function requireRecentStepUp(tx: TxContext): Promise<void> {
  const policy = await getSecurityPolicy(tx);
  const s = await currentSession(tx);
  const fresh =
    s?.mfa_verified_at &&
    tx.now.getTime() - s.mfa_verified_at.getTime() <= policy.mfaStepUpWindowMinutes * 60_000;
  if (!fresh) throw new MfaRequiredError({ stepUpWindowMinutes: policy.mfaStepUpWindowMinutes });
}

/** Start TOTP enrolment: returns the secret and the otpauth:// URI for the QR code (shown once). */
export async function enrolTotp(tx: TxContext, ports: Pick<IdentityPorts, 'cipher' | 'config'>) {
  const userId = selfUserId(tx);
  const cipher = cipherOf(ports);
  if (await hasActiveTotp(tx, userId)) await requireRecentStepUp(tx);
  const user = await db(tx)
    .selectFrom('identity.users')
    .select('email')
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!user) throw new NotFoundError('user', userId);
  await db(tx)
    .updateTable('identity.mfa_factors')
    .set({ status: 'disabled', disabled_at: tx.now })
    .where('user_id', '=', userId)
    .where('status', '=', 'pending')
    .execute();
  const id = newId();
  const secret = generateTotpSecret();
  await db(tx)
    .insertInto('identity.mfa_factors')
    .values({
      id,
      user_id: userId,
      kind: 'totp',
      status: 'pending',
      secret_enc: cipher.encrypt(secret, `mfa:${id}`),
      last_used_step: null,
      confirmed_at: null,
      disabled_at: null,
    })
    .execute();
  await tx.audit({ action: 'identity.mfa.enrolStart', target: { type: 'user', id: userId } });
  return {
    factorId: id,
    secret,
    otpauthUri: provisioningUri({
      secret,
      accountName: user.email,
      issuer: ports.config?.totpIssuer ?? 'Portico',
    }),
  };
}

async function verifyFactorCode(
  tx: TxContext,
  cipher: FieldCipher,
  factor: { id: string; secret_enc: string; last_used_step: number | null },
  code: string,
): Promise<boolean> {
  const secret = base32Decode(cipher.decrypt(factor.secret_enc, `mfa:${factor.id}`));
  const step = verifyTotp(secret, code, tx.now, { lastUsedStep: factor.last_used_step });
  if (step === null) return false;
  // Replay protection under concurrency: only one request can advance last_used_step to this step.
  const res = await db(tx)
    .updateTable('identity.mfa_factors')
    .set({ last_used_step: step })
    .where('id', '=', factor.id)
    .where((eb) => eb.or([eb('last_used_step', 'is', null), eb('last_used_step', '<', step)]))
    .executeTakeFirst();
  return Number(res.numUpdatedRows) === 1;
}

/** Confirm enrolment with a first code. Activates the factor and returns 10 recovery codes (shown once). */
export async function confirmTotp(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'cipher'>,
  input: { code: string },
) {
  const userId = selfUserId(tx);
  const cipher = cipherOf(ports);
  const pending = await db(tx)
    .selectFrom('identity.mfa_factors')
    .selectAll()
    .where('user_id', '=', userId)
    .where('status', '=', 'pending')
    .executeTakeFirst();
  if (!pending)
    throw new BusinessRuleError(
      'no_pending_enrolment',
      'Start the authenticator set-up first, then enter a code from the app.',
    );
  if (!(await verifyFactorCode(tx, cipher, pending, input.code))) {
    throw new ValidationError(
      'invalid_code',
      'That code is not valid. Check that your phone’s time is set automatically and enter the current 6-digit code.',
    );
  }
  await db(tx)
    .updateTable('identity.mfa_factors')
    .set({ status: 'disabled', disabled_at: tx.now })
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .execute();
  await db(tx)
    .updateTable('identity.mfa_factors')
    .set({ status: 'active', confirmed_at: tx.now, version: sql`version + 1` })
    .where('id', '=', pending.id)
    .execute();
  const codes = await replaceRecoveryCodes(tx, userId);
  if (tx.actor.kind === 'user' && tx.actor.sessionId) {
    await db(tx)
      .updateTable('identity.sessions')
      .set({ mfa_verified_at: tx.now, mfa_verified: true, mfa_failures: 0 })
      .where('id', '=', tx.actor.sessionId)
      .execute();
  }
  await tx.audit({
    action: 'identity.mfa.enrol',
    target: { type: 'user', id: userId },
    metadata: { kind: 'totp' },
  });
  await tx.emit({
    type: 'identity.mfa.enrolled',
    aggregate: { type: 'user', id: userId },
    payload: { userId, kind: 'totp' },
  });
  return { recoveryCodes: codes };
}

async function replaceRecoveryCodes(tx: TxContext, userId: string): Promise<string[]> {
  await db(tx)
    .updateTable('identity.mfa_recovery_codes')
    .set({ used_at: tx.now })
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .execute();
  const codes = generateRecoveryCodes();
  await db(tx)
    .insertInto('identity.mfa_recovery_codes')
    .values(
      codes.map((c) => ({
        id: newId(),
        user_id: userId,
        code_hash: hashRecoveryCode(c) as string,
        used_at: null,
      })),
    )
    .execute();
  return codes;
}

export async function regenerateRecoveryCodes(tx: TxContext) {
  const userId = selfUserId(tx);
  if (!(await hasActiveTotp(tx, userId)))
    throw new BusinessRuleError('mfa_not_enrolled', 'Set up an authenticator app first.');
  await requireRecentStepUp(tx);
  const codes = await replaceRecoveryCodes(tx, userId);
  await tx.audit({ action: 'identity.mfa.recoveryCodes.regenerate', target: { type: 'user', id: userId } });
  return { recoveryCodes: codes };
}

/** Check a TOTP code or a recovery code for a member (single use for both). */
export async function verifySecondFactor(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'cipher'>,
  userId: string,
  input: { code?: string | undefined; recoveryCode?: string | undefined },
): Promise<'totp' | 'recovery_code' | null> {
  if (input.code) {
    const factor = await db(tx)
      .selectFrom('identity.mfa_factors')
      .select(['id', 'secret_enc', 'last_used_step'])
      .where('user_id', '=', userId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (factor && (await verifyFactorCode(tx, cipherOf(ports), factor, input.code))) return 'totp';
    return null;
  }
  if (input.recoveryCode) {
    const hash = hashRecoveryCode(input.recoveryCode);
    if (!hash) return null;
    const res = await db(tx)
      .updateTable('identity.mfa_recovery_codes')
      .set({ used_at: tx.now })
      .where('user_id', '=', userId)
      .where('code_hash', '=', hash)
      .where('used_at', 'is', null)
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) === 1) {
      await tx.audit({ action: 'identity.mfa.recoveryCodeUsed', target: { type: 'user', id: userId } });
      return 'recovery_code';
    }
  }
  return null;
}

export type StepUpOutcome =
  | { ok: true; verifiedAt: string; method: 'totp' | 'recovery_code' }
  | { ok: false; attemptsRemaining: number; sessionRevoked: boolean };

/**
 * Step-up: verify on the current session and record `mfa_verified_at`. After 5 consecutive failures the session is
 * revoked (the person signs in again) — protects a stolen session from guessing codes. Failures are returned (not
 * thrown) so the failure counter commits; the caller reports the error after the transaction.
 */
export async function stepUp(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'cipher'>,
  input: { code?: string | undefined; recoveryCode?: string | undefined },
): Promise<StepUpOutcome> {
  const userId = selfUserId(tx);
  const session = await currentSession(tx);
  if (!session) throw new UnauthenticatedError();
  const method = await verifySecondFactor(tx, ports, userId, input);
  if (!method) {
    const failures = session.mfa_failures + 1;
    const revoke = failures >= MFA_MAX_ATTEMPTS;
    await db(tx)
      .updateTable('identity.sessions')
      .set({
        mfa_failures: failures,
        ...(revoke ? { revoked_at: tx.now, revoked_reason: 'mfa_failures' } : {}),
      })
      .where('id', '=', session.id)
      .execute();
    await tx.audit({
      action: 'identity.mfa.verifyFailed',
      target: { type: 'user', id: userId },
      metadata: { failures },
    });
    return { ok: false, attemptsRemaining: Math.max(0, MFA_MAX_ATTEMPTS - failures), sessionRevoked: revoke };
  }
  await db(tx)
    .updateTable('identity.sessions')
    .set({ mfa_verified_at: tx.now, mfa_verified: true, mfa_failures: 0 })
    .where('id', '=', session.id)
    .execute();
  await tx.audit({
    action: 'identity.mfa.stepUp',
    target: { type: 'user', id: userId },
    metadata: { method },
  });
  return { ok: true, verifiedAt: tx.now.toISOString(), method };
}

/** The error to report for a failed step-up (after the failure counter has committed). */
export function stepUpFailure(
  outcome: Extract<StepUpOutcome, { ok: false }>,
): ValidationError | UnauthenticatedError {
  if (outcome.sessionRevoked)
    return new UnauthenticatedError(
      'Too many wrong verification codes. You have been signed out; sign in again.',
    );
  return new ValidationError(
    'invalid_code',
    `That code is not valid. Enter the current code from your authenticator app or a recovery code (${outcome.attemptsRemaining} attempts left).`,
    { attemptsRemaining: outcome.attemptsRemaining },
  );
}

/** Turn off one's own MFA (needs a recent verification). Sensitive permissions stop working until re-enrolled. */
export async function disableOwnMfa(tx: TxContext): Promise<void> {
  const userId = selfUserId(tx);
  await requireRecentStepUp(tx);
  await disableFactors(tx, userId);
  await tx.audit({ action: 'identity.mfa.disable', target: { type: 'user', id: userId } });
  await tx.emit({
    type: 'identity.mfa.disabled',
    aggregate: { type: 'user', id: userId },
    payload: { userId, by: 'self' },
  });
}

async function disableFactors(tx: TxContext, userId: string) {
  await db(tx)
    .updateTable('identity.mfa_factors')
    .set({ status: 'disabled', disabled_at: tx.now })
    .where('user_id', '=', userId)
    .where('status', 'in', ['active', 'pending'])
    .execute();
  await db(tx)
    .updateTable('identity.mfa_recovery_codes')
    .set({ used_at: tx.now })
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .execute();
}

/**
 * Lost device: an administrator resets another member's MFA. Allowed only when this person's sign-in identity is
 * not shared with another organization (otherwise one organization could weaken another's security); then Monoclay
 * support handles it. The member's sessions are revoked.
 */
export async function resetMemberMfa(tx: TxContext, userId: string, reason: string): Promise<void> {
  requirePermission(tx, 'identity.user.manage');
  if (tx.actor.kind === 'user' && tx.actor.userId === userId)
    throw new ForbiddenError('identity.user.manage', {
      reason: 'cannot reset your own MFA as an administrator',
    });
  const member = await db(tx)
    .selectFrom('identity.memberships')
    .select('id')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!member) throw new NotFoundError('user', userId);
  const { rows } = await sql<{
    n: number;
  }>`select identity.active_membership_count(${userId}::uuid) as n`.execute(tx.db);
  if ((rows[0]?.n ?? 0) > 1) {
    throw new BusinessRuleError(
      'mfa_reset_requires_support',
      "This person's sign-in is shared with another organization, so their two-step verification can only be reset by Monoclay support after identity checks.",
    );
  }
  await disableFactors(tx, userId);
  await db(tx)
    .updateTable('identity.sessions')
    .set({ revoked_at: tx.now, revoked_reason: 'mfa_reset' })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .execute();
  await tx.audit({ action: 'identity.mfa.adminReset', target: { type: 'user', id: userId }, reason });
  await tx.emit({
    type: 'identity.mfa.disabled',
    aggregate: { type: 'user', id: userId },
    payload: { userId, by: 'admin' },
  });
}

// ───────────────────────────── Sign-in second factor ─────────────────────────────

export async function createMfaChallenge(
  tx: TxContext,
  input: { userId: string; ip?: string | undefined; userAgent?: string | undefined },
): Promise<{ challengeToken: string; expiresAt: Date }> {
  const challengeToken = `pmc.${tx.tenantId}.${randomToken(32)}`;
  const expiresAt = new Date(tx.now.getTime() + MFA_CHALLENGE_MINUTES * 60_000);
  await db(tx)
    .insertInto('identity.mfa_challenges')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      user_id: input.userId,
      token_hash: sha256Hex(challengeToken),
      expires_at: expiresAt,
      consumed_at: null,
      ip: input.ip ?? null,
      user_agent: input.userAgent?.slice(0, 500) ?? null,
    })
    .execute();
  return { challengeToken, expiresAt };
}

const CHALLENGE_ERROR =
  'The verification code is not valid or has expired. Sign in again to get a new challenge.';

/** Complete sign-in with the second factor. Returns a session bound to the organization chosen at sign-in. */
export async function completeMfaChallenge(
  database: PorticoDatabase,
  ports: Pick<IdentityPorts, 'cipher'>,
  input: {
    challengeToken: string;
    code?: string | undefined;
    recoveryCode?: string | undefined;
    ip?: string | undefined;
    userAgent?: string | undefined;
  },
) {
  const [kind, tenantId] = input.challengeToken.split('.');
  if (kind !== 'pmc' || !tenantId || !isUuid(tenantId)) throw new UnauthenticatedError(CHALLENGE_ERROR);
  const { rows } = await sql<{ id: string; name: string; environment: string; status: string }>`
    select id, name, environment, status from platform.tenant_summaries(${[tenantId]}::uuid[])`.execute(
    database.kysely,
  );
  const org = rows[0];
  if (!org || org.status !== 'active') throw new UnauthenticatedError(CHALLENGE_ERROR);
  const ctx: RequestContext = {
    tenantId,
    environment: org.environment as TenantEnvironment,
    actor: { kind: 'system', process: 'mfa-challenge' },
    authz: systemAuthorizer,
    correlationId: newId(),
  };
  const outcome = await withTenantTx(database, ctx, async (tx) => {
    const c = await db(tx)
      .selectFrom('identity.mfa_challenges')
      .selectAll()
      .where('token_hash', '=', sha256Hex(input.challengeToken))
      .forUpdate()
      .executeTakeFirst();
    if (!c || c.consumed_at || c.expires_at <= tx.now || c.attempts >= MFA_MAX_ATTEMPTS)
      return { ok: false as const };
    const method = await verifySecondFactor(tx, ports, c.user_id, input);
    if (!method) {
      await db(tx)
        .updateTable('identity.mfa_challenges')
        .set({ attempts: sql`attempts + 1` })
        .where('id', '=', c.id)
        .execute();
      await tx.audit({ action: 'identity.mfa.challengeFailed', target: { type: 'user', id: c.user_id } });
      return { ok: false as const };
    }
    await db(tx)
      .updateTable('identity.mfa_challenges')
      .set({ consumed_at: tx.now })
      .where('id', '=', c.id)
      .execute();
    const session = await createSession(tx, {
      userId: c.user_id,
      authMethod: 'password',
      mfaVerifiedAt: tx.now,
      ip: input.ip ?? c.ip ?? undefined,
      userAgent: input.userAgent ?? c.user_agent ?? undefined,
    });
    return { ok: true as const, userId: c.user_id, ...session };
  });
  if (!outcome.ok) throw new UnauthenticatedError(CHALLENGE_ERROR);
  return {
    status: 'signed_in' as const,
    token: outcome.token,
    expiresAt: outcome.expiresAt,
    userId: outcome.userId,
    organization: { id: org.id, name: org.name, environment: org.environment },
  };
}
