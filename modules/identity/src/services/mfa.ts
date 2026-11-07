import { verify as argonVerify } from '@node-rs/argon2';
import { type PorticoDatabase, sql, type TxContext, typed, withTenantTx } from '@portico/db';
import {
  BusinessRuleError,
  DomainError,
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
import { alertDedupeKey } from '../domain/security-rules';
import { base32Decode, generateTotpSecret, provisioningUri, verifyTotp } from '../domain/totp';
import { MfaRequiredError, NotConfiguredError } from '../errors';
import type { IdentityPorts } from '../ports';
import type { IdentityDB } from '../tables';
import {
  assertPowerOver,
  assertSoleOrganizationMember,
  membershipsElsewhere,
  revokeApiKeysIssuedBy,
} from './guard';
import { getSecurityPolicy } from './policy';
import { checkSignInLocation, raiseSecurityAlert } from './security';
import { createSession } from './sessions';

/**
 * Multi-factor authentication: TOTP (RFC 6238) with replay protection, single-use recovery codes, a second-factor
 * challenge at sign-in for enrolled members, and step-up verification on the session (mfa_verified_at).
 * WebAuthn/passkeys are LATER (same factor table, kind 'webauthn').
 *
 * ADR-0017: factors belong to the PERSON (global). Changing them needs proof of the existing credential (§4);
 * second-factor failures are counted per person across challenges, with escalating delays, a lock and an alert (§8).
 */
const db = (tx: TxContext) => typed<IdentityDB>(tx.db);

export const MFA_CHALLENGE_MINUTES = 5;
export const MFA_MAX_ATTEMPTS = 5;
/** A pending factor must be confirmed within this time after enrolment started. */
export const MFA_PENDING_MINUTES = 15;
/** Per-person second-factor failures (across challenges, step-ups and credential proofs). */
export const SECOND_FACTOR_LIMITS = { delayAfter: 5, alertAfter: 10, lockAfter: 20 } as const;

/** A result that must commit even when it is a failure (failure counters), reported after the transaction. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export interface CredentialProof {
  currentPassword?: string | undefined;
  code?: string | undefined;
  recoveryCode?: string | undefined;
}

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
    .where('revoked_at', 'is', null)
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
    .select(['id', 'mfa_verified_at', 'mfa_failures', 'auth_method'])
    .where('id', '=', tx.actor.sessionId)
    .executeTakeFirst();
}

/** Organization step-up for emergency access (break-glass). Not used for credential changes (§4). */
export async function requireRecentStepUp(tx: TxContext): Promise<void> {
  const policy = await getSecurityPolicy(tx);
  const s = await currentSession(tx);
  const fresh =
    s?.mfa_verified_at &&
    tx.now.getTime() - s.mfa_verified_at.getTime() <= policy.mfaStepUpWindowMinutes * 60_000;
  if (!fresh) throw new MfaRequiredError({ stepUpWindowMinutes: policy.mfaStepUpWindowMinutes });
}

// ───────────────────────────── Per-person second-factor failures (ADR-0017 §8) ─────────────────────────────

export class SecondFactorLockedError extends DomainError {
  constructor(until: Date) {
    super(
      'second_factor_locked',
      `Too many wrong verification codes. For your protection, try again after ${until.toISOString()}. If this was not you, tell your administrator.`,
      { status: 429, retryable: true, details: { retryAfter: until.toISOString() } },
    );
  }
}

/** The person's second-factor lock, if any. */
export async function secondFactorLock(tx: TxContext, userId: string): Promise<Date | null> {
  const u = await db(tx)
    .selectFrom('identity.users')
    .select('mfa_locked_until')
    .where('id', '=', userId)
    .executeTakeFirst();
  return u?.mfa_locked_until && u.mfa_locked_until > tx.now ? u.mfa_locked_until : null;
}

/** Count one failure for the person; escalate delays, lock, and alert the person and the organization's admins. */
export async function recordSecondFactorFailure(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'notifier'>,
  userId: string,
): Promise<number> {
  const row = await db(tx)
    .updateTable('identity.users')
    .set({ mfa_failed_attempts: sql`mfa_failed_attempts + 1` })
    .where('id', '=', userId)
    .returning(['mfa_failed_attempts', 'email'])
    .executeTakeFirst();
  const n = row?.mfa_failed_attempts ?? 0;
  const L = SECOND_FACTOR_LIMITS;
  const delayMinutes = n >= L.lockAfter ? 24 * 60 : n >= L.alertAfter ? 15 : n >= L.delayAfter ? 1 : 0;
  if (delayMinutes > 0) {
    await db(tx)
      .updateTable('identity.users')
      .set({ mfa_locked_until: new Date(tx.now.getTime() + delayMinutes * 60_000) })
      .where('id', '=', userId)
      .execute();
  }
  if (n === L.alertAfter || n === L.lockAfter) {
    await raiseSecurityAlert(tx, {
      rule: 'mfa_bruteforce_suspected',
      severity: 'high',
      summary: `${n} wrong second-factor codes in a row for one member; further attempts are delayed${n >= L.lockAfter ? ' and the second factor is locked for 24 hours' : ''}.`,
      subjectUserId: userId,
      details: { failures: n },
      dedupeKey: alertDedupeKey('mfa_bruteforce_suspected', `${userId}:${n}`, tx.now, 24 * 60),
    });
    if (row?.email && ports.notifier) {
      await ports.notifier.send(tx, {
        kind: 'staff.securityAlert',
        to: row.email,
        subject: 'Repeated wrong verification codes on your account',
        body: `Someone entered ${n} wrong verification codes for your Portico account. If this was not you, change your password and tell your administrator.`,
      });
    }
  }
  return n;
}

export async function recordSecondFactorSuccess(tx: TxContext, userId: string): Promise<void> {
  await db(tx)
    .updateTable('identity.users')
    .set({ mfa_failed_attempts: 0, mfa_locked_until: null })
    .where('id', '=', userId)
    .execute();
}

// ───────────────────────────── Proof of the existing credential (ADR-0017 §4) ─────────────────────────────

const PROOF_REQUIRED_TOTP =
  'Confirm it is you: enter a code from your current authenticator app (or a recovery code).';
const PROOF_REQUIRED_PASSWORD = 'Confirm it is you: enter your current password.';

/**
 * Prove the person's existing credential before changing a global credential: the current TOTP (or a recovery
 * code) when one is enrolled, otherwise the current password. A person without either (SSO-only) may change their
 * own factors only while every membership is in this organization (its identity provider is then their only
 * authority). Failures count towards the per-person lock; the caller reports them after the transaction commits.
 */
export async function proveExistingCredential(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'cipher' | 'notifier'>,
  userId: string,
  proof: CredentialProof,
): Promise<{ ok: true } | { ok: false; error: DomainError }> {
  const lock = await secondFactorLock(tx, userId);
  if (lock) return { ok: false, error: new SecondFactorLockedError(lock) };
  if (await hasActiveTotp(tx, userId)) {
    if (!proof.code && !proof.recoveryCode)
      return { ok: false, error: new ValidationError('proof_required', PROOF_REQUIRED_TOTP) };
    const method = await verifySecondFactor(tx, ports, userId, proof);
    if (!method) {
      await recordSecondFactorFailure(tx, ports, userId);
      return {
        ok: false,
        error: new ValidationError('invalid_code', `That code is not valid. ${PROOF_REQUIRED_TOTP}`),
      };
    }
    await recordSecondFactorSuccess(tx, userId);
    return { ok: true };
  }
  const user = await db(tx)
    .selectFrom('identity.users')
    .select('password_hash')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  if (user.password_hash) {
    if (!proof.currentPassword)
      return { ok: false, error: new ValidationError('proof_required', PROOF_REQUIRED_PASSWORD) };
    const ok = await argonVerify(user.password_hash, proof.currentPassword).catch(() => false);
    if (!ok) {
      await recordSecondFactorFailure(tx, ports, userId);
      return {
        ok: false,
        error: new ValidationError(
          'invalid_password',
          `That password is not correct. ${PROOF_REQUIRED_PASSWORD}`,
        ),
      };
    }
    await recordSecondFactorSuccess(tx, userId);
    return { ok: true };
  }
  if ((await membershipsElsewhere(tx, userId)) > 0) {
    return {
      ok: false,
      error: new BusinessRuleError(
        'proof_unavailable',
        'Your sign-in is shared with another organization and has no password or authenticator yet. Sign in there with your own credentials to set up two-step verification.',
      ),
    };
  }
  return { ok: true };
}

/** Start TOTP enrolment (after proving the existing credential): the secret and `otpauth://` URI, shown once. */
export async function enrolTotp(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'cipher' | 'config' | 'notifier'>,
  proof: CredentialProof = {},
): Promise<Outcome<{ factorId: string; secret: string; otpauthUri: string }>> {
  const userId = selfUserId(tx);
  const cipher = cipherOf(ports);
  const proven = await proveExistingCredential(tx, ports, userId, proof);
  if (!proven.ok) return proven;
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
    ok: true,
    value: {
      factorId: id,
      secret,
      otpauthUri: provisioningUri({
        secret,
        accountName: user.email,
        issuer: ports.config?.totpIssuer ?? 'Portico',
      }),
    },
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
    .where('created_at', '>', new Date(tx.now.getTime() - MFA_PENDING_MINUTES * 60_000))
    .executeTakeFirst();
  if (!pending)
    throw new BusinessRuleError(
      'no_pending_enrolment',
      'Start the authenticator set-up first (it expires after 15 minutes), then enter a code from the app.',
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

async function revokeRecoveryCodes(tx: TxContext, userId: string) {
  await db(tx)
    .updateTable('identity.mfa_recovery_codes')
    .set({ revoked_at: tx.now })
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .where('revoked_at', 'is', null)
    .execute();
}

async function replaceRecoveryCodes(tx: TxContext, userId: string): Promise<string[]> {
  await revokeRecoveryCodes(tx, userId);
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

export async function regenerateRecoveryCodes(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'cipher' | 'notifier'>,
  proof: CredentialProof,
): Promise<Outcome<{ recoveryCodes: string[] }>> {
  const userId = selfUserId(tx);
  if (!(await hasActiveTotp(tx, userId)))
    throw new BusinessRuleError('mfa_not_enrolled', 'Set up an authenticator app first.');
  const proven = await proveExistingCredential(tx, ports, userId, proof);
  if (!proven.ok) return proven;
  const codes = await replaceRecoveryCodes(tx, userId);
  await tx.audit({ action: 'identity.mfa.recoveryCodes.regenerate', target: { type: 'user', id: userId } });
  return { ok: true, value: { recoveryCodes: codes } };
}

/** Check a TOTP code or a recovery code for a member (single use for both). Does not count failures. */
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
      .where('revoked_at', 'is', null)
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
  | { ok: false; attemptsRemaining: number; sessionRevoked: boolean; lockedUntil?: Date };

/**
 * Step-up: verify on the current session and record `mfa_verified_at`. Failures count per session (5 → the session
 * is revoked) and per person (escalating delays, lock, alert). Failures are returned (not thrown) so the counters
 * commit; the caller reports the error after the transaction.
 */
export async function stepUp(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'cipher' | 'notifier'>,
  input: { code?: string | undefined; recoveryCode?: string | undefined },
): Promise<StepUpOutcome> {
  const userId = selfUserId(tx);
  const session = await currentSession(tx);
  if (!session) throw new UnauthenticatedError();
  const lock = await secondFactorLock(tx, userId);
  if (lock) return { ok: false, attemptsRemaining: 0, sessionRevoked: false, lockedUntil: lock };
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
    await recordSecondFactorFailure(tx, ports, userId);
    await tx.audit({
      action: 'identity.mfa.verifyFailed',
      target: { type: 'user', id: userId },
      metadata: { failures },
    });
    return { ok: false, attemptsRemaining: Math.max(0, MFA_MAX_ATTEMPTS - failures), sessionRevoked: revoke };
  }
  await recordSecondFactorSuccess(tx, userId);
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

/** The error to report for a failed step-up (after the failure counters have committed). */
export function stepUpFailure(outcome: Extract<StepUpOutcome, { ok: false }>): DomainError {
  if (outcome.lockedUntil) return new SecondFactorLockedError(outcome.lockedUntil);
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

/** Turn off one's own MFA (proof of the current factor required). Sensitive permissions stop working. */
export async function disableOwnMfa(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'cipher' | 'notifier'>,
  proof: CredentialProof,
): Promise<Outcome<null>> {
  const userId = selfUserId(tx);
  if (!(await hasActiveTotp(tx, userId)))
    throw new BusinessRuleError('mfa_not_enrolled', 'Two-step verification is not set up.');
  const proven = await proveExistingCredential(tx, ports, userId, proof);
  if (!proven.ok) return proven;
  await disableFactors(tx, userId);
  await tx.audit({ action: 'identity.mfa.disable', target: { type: 'user', id: userId } });
  await tx.emit({
    type: 'identity.mfa.disabled',
    aggregate: { type: 'user', id: userId },
    payload: { userId, by: 'self' },
  });
  return { ok: true, value: null };
}

async function disableFactors(tx: TxContext, userId: string) {
  await db(tx)
    .updateTable('identity.mfa_factors')
    .set({ status: 'disabled', disabled_at: tx.now })
    .where('user_id', '=', userId)
    .where('status', 'in', ['active', 'pending'])
    .execute();
  await revokeRecoveryCodes(tx, userId);
}

/**
 * Lost device: an administrator resets another member's MFA. ADR-0017 §1: only for a person whose EVERY membership
 * (any status) is in this organization, and only by someone holding at least the person's access (§6). The person's
 * sessions and the API keys they issued are revoked (§9).
 */
export async function resetMemberMfa(
  tx: TxContext,
  userId: string,
  reason: string,
  ports?: Pick<IdentityPorts, 'propertyIdsInScope'>,
): Promise<void> {
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
  await assertSoleOrganizationMember(tx, userId, 'mfa_reset');
  await assertPowerOver(tx, userId, ports);
  await disableFactors(tx, userId);
  await recordSecondFactorSuccess(tx, userId);
  await db(tx)
    .updateTable('identity.sessions')
    .set({ revoked_at: tx.now, revoked_reason: 'mfa_reset' })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .execute();
  const keys = await revokeApiKeysIssuedBy(tx, userId);
  await tx.audit({
    action: 'identity.mfa.adminReset',
    target: { type: 'user', id: userId },
    reason,
    metadata: { apiKeysRevoked: keys },
  });
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
  ports: Pick<IdentityPorts, 'cipher' | 'notifier' | 'geo'>,
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
  if (org?.status !== 'active') throw new UnauthenticatedError(CHALLENGE_ERROR);
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
    const lock = await secondFactorLock(tx, c.user_id);
    if (lock) return { ok: false as const, lock };
    const method = await verifySecondFactor(tx, ports, c.user_id, input);
    if (!method) {
      await db(tx)
        .updateTable('identity.mfa_challenges')
        .set({ attempts: sql`attempts + 1` })
        .where('id', '=', c.id)
        .execute();
      await recordSecondFactorFailure(tx, ports, c.user_id);
      await tx.audit({ action: 'identity.mfa.challengeFailed', target: { type: 'user', id: c.user_id } });
      return { ok: false as const };
    }
    await recordSecondFactorSuccess(tx, c.user_id);
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
    // P3-2: the new-country signal also covers members who sign in with a second factor.
    await checkSignInLocation(tx, ports, { userId: c.user_id, ip: input.ip ?? c.ip ?? undefined });
    return { ok: true as const, userId: c.user_id, ...session };
  });
  if (!outcome.ok) {
    if ('lock' in outcome && outcome.lock) throw new SecondFactorLockedError(outcome.lock);
    throw new UnauthenticatedError(CHALLENGE_ERROR);
  }
  return {
    status: 'signed_in' as const,
    token: outcome.token,
    expiresAt: outcome.expiresAt,
    userId: outcome.userId,
    organization: { id: org.id, name: org.name, environment: org.environment },
  };
}
