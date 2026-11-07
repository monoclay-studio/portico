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
  assertSessionCurrent,
  assertSoleOrganizationMember,
  isDemoSeeding,
  lockPerson,
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

/** R3-P1-1: credentials from an older epoch (before a first-verification wipe) are ignored everywhere. */
const sameEpoch = (userId: string) =>
  sql<boolean>`credential_epoch = (select u.credential_epoch from identity.users u where u.id = ${userId}::uuid)`;

export async function hasActiveTotp(tx: TxContext, userId: string): Promise<boolean> {
  const f = await db(tx)
    .selectFrom('identity.mfa_factors')
    .select('id')
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .where(sameEpoch(userId))
    .executeTakeFirst();
  return !!f;
}

export async function mfaStatus(tx: TxContext, userId: string) {
  const factors = await db(tx)
    .selectFrom('identity.mfa_factors')
    .select(['status', 'confirmed_at'])
    .where('user_id', '=', userId)
    .where('status', 'in', ['active', 'pending'])
    .where(sameEpoch(userId))
    .execute();
  const codes = await db(tx)
    .selectFrom('identity.mfa_recovery_codes')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .where('revoked_at', 'is', null)
    .where(sameEpoch(userId))
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

/**
 * Reserve one second-factor attempt for the person BEFORE checking the code (review R2-P2-1). The counter is taken
 * with a single guarded UPDATE that also holds the person's row until the transaction ends, so concurrent attempts
 * are serialized and each one sees the lock set by the previous failure. Returns the lock when the person is locked
 * (nothing reserved), otherwise null. Success resets the counter; failure applies the escalation.
 */
export async function reserveSecondFactorAttempt(tx: TxContext, userId: string): Promise<Date | null> {
  const row = await db(tx)
    .updateTable('identity.users')
    .set({ mfa_failed_attempts: sql`mfa_failed_attempts + 1` })
    .where('id', '=', userId)
    .where((eb) => eb.or([eb('mfa_locked_until', 'is', null), eb('mfa_locked_until', '<=', tx.now)]))
    .returning('id')
    .executeTakeFirst();
  if (row) return null;
  const lock = await secondFactorLock(tx, userId);
  if (!lock) throw new NotFoundError('user', userId);
  return lock;
}

/**
 * A reserved attempt failed: escalate delays, lock, and alert the person and the organization's admins. The counter
 * was already taken by `reserveSecondFactorAttempt`.
 */
export async function recordSecondFactorFailure(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'notifier'>,
  userId: string,
): Promise<number> {
  const row = await db(tx)
    .selectFrom('identity.users')
    .select(['mfa_failed_attempts', 'email'])
    .where('id', '=', userId)
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
  if (await hasActiveTotp(tx, userId)) {
    if (!proof.code && !proof.recoveryCode)
      return { ok: false, error: new ValidationError('proof_required', PROOF_REQUIRED_TOTP) };
    const lock = await reserveSecondFactorAttempt(tx, userId);
    if (lock) return { ok: false, error: new SecondFactorLockedError(lock) };
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
    const lock = await reserveSecondFactorAttempt(tx, userId);
    if (lock) return { ok: false, error: new SecondFactorLockedError(lock) };
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
  // R3-P1-1: the person's row lock first, then the session must still belong to the current credential epoch.
  const person = await lockPerson(tx, userId);
  await assertSessionCurrent(tx, person.epoch);
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
      created_at: tx.now,
      credential_epoch: person.epoch,
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

/**
 * Demo seeding only (ADR-0017 rule 12, extended by the coordinator's demo decision): enrol an ACTIVE authenticator
 * factor with a fixed, published demo secret, so fictitious demo administrators keep their ⚑ permissions (which
 * never take effect without two-step verification) and the demo, e2e suite and UX lab can sign in.
 *
 * Refused unless ALL hold, exactly like `seedDemoMember`: the caller is a system process, the organization is in the
 * `demo` environment, and the person's address is a reserved fictitious `*.portico.invalid` address. The person must
 * also be a member of this demo organization. Never routed over HTTP. Idempotent (an active factor is kept).
 */
export async function seedDemoTotp(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'cipher'>,
  input: { userId: string; secret: string },
): Promise<{ factorId: string }> {
  const refuse = () =>
    new ValidationError(
      'demo_factor_not_allowed',
      'A fixed authenticator secret may be seeded only by a system process, in a demo organization, for a member with a *.portico.invalid address.',
    );
  if (tx.actor.kind !== 'system' || tx.environment !== 'demo') throw refuse();
  const user = await db(tx)
    .selectFrom('identity.users')
    .select('email')
    .where('id', '=', input.userId)
    .executeTakeFirst();
  if (!user || !(await isDemoSeeding(tx, user.email))) throw refuse();
  const member = await db(tx)
    .selectFrom('identity.memberships')
    .select('id')
    .where('user_id', '=', input.userId)
    .executeTakeFirst();
  if (!member) throw refuse();
  // Validate the secret is usable before storing it (base32, at least 80 bits).
  let bytes = 0;
  try {
    bytes = base32Decode(input.secret).length;
  } catch {
    bytes = 0;
  }
  if (bytes < 10)
    throw new ValidationError(
      'invalid_secret',
      'The demo authenticator secret must be base32 with at least 80 bits.',
    );
  const cipher = cipherOf(ports);
  const person = await lockPerson(tx, input.userId);
  const existing = await db(tx)
    .selectFrom('identity.mfa_factors')
    .select('id')
    .where('user_id', '=', input.userId)
    .where('status', '=', 'active')
    .where(sameEpoch(input.userId))
    .executeTakeFirst();
  if (existing) return { factorId: existing.id };
  const id = newId();
  await db(tx)
    .insertInto('identity.mfa_factors')
    .values({
      id,
      user_id: input.userId,
      kind: 'totp',
      status: 'active',
      secret_enc: cipher.encrypt(input.secret, `mfa:${id}`),
      last_used_step: null,
      confirmed_at: tx.now,
      disabled_at: null,
      created_at: tx.now,
      credential_epoch: person.epoch,
    })
    .execute();
  await tx.audit({ action: 'identity.mfa.seedDemo', target: { type: 'user', id: input.userId } });
  return { factorId: id };
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
    .where('status', 'in', ['pending', 'active'])
    .where((eb) => eb.or([eb('last_used_step', 'is', null), eb('last_used_step', '<', step)]))
    .executeTakeFirst();
  return Number(res.numUpdatedRows) === 1;
}

/** Wrong codes allowed while confirming one pending factor (review R2-P3-2); then the set-up must restart. */
export const MFA_CONFIRM_MAX_ATTEMPTS = 5;

/**
 * Confirm enrolment with a first code. Activates the factor and returns 10 recovery codes (shown once). Failures
 * count per person (R2-P2-1) and per pending factor (5, then it is discarded); they are returned, not thrown, so the
 * counters commit.
 */
export async function confirmTotp(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'cipher' | 'notifier'>,
  input: { code: string },
): Promise<Outcome<{ recoveryCodes: string[] }>> {
  const userId = selfUserId(tx);
  const cipher = cipherOf(ports);
  // R3-P1-1: lock the person BEFORE reading the pending factor; a first-verification wipe that committed meanwhile
  // has revoked this session and moved the epoch, so nothing set before it can be activated after it.
  const person = await lockPerson(tx, userId);
  await assertSessionCurrent(tx, person.epoch);
  const pending = await db(tx)
    .selectFrom('identity.mfa_factors')
    .selectAll()
    .where('user_id', '=', userId)
    .where('status', '=', 'pending')
    .where('credential_epoch', '=', person.epoch)
    .where('created_at', '>', new Date(tx.now.getTime() - MFA_PENDING_MINUTES * 60_000))
    .executeTakeFirst();
  if (!pending)
    throw new BusinessRuleError(
      'no_pending_enrolment',
      'Start the authenticator set-up first (it expires after 15 minutes), then enter a code from the app.',
    );
  const lock = await reserveSecondFactorAttempt(tx, userId);
  if (lock) return { ok: false, error: new SecondFactorLockedError(lock) };
  if (!(await verifyFactorCode(tx, cipher, pending, input.code))) {
    await recordSecondFactorFailure(tx, ports, userId);
    const failures = pending.confirm_failures + 1;
    await db(tx)
      .updateTable('identity.mfa_factors')
      .set({
        confirm_failures: failures,
        ...(failures >= MFA_CONFIRM_MAX_ATTEMPTS ? { status: 'disabled', disabled_at: tx.now } : {}),
      })
      .where('id', '=', pending.id)
      .execute();
    return {
      ok: false,
      error: new ValidationError(
        'invalid_code',
        failures >= MFA_CONFIRM_MAX_ATTEMPTS
          ? 'Too many wrong codes for this set-up. Start the authenticator set-up again.'
          : 'That code is not valid. Check that your phone’s time is set automatically and enter the current 6-digit code.',
        // The staff app offers "Start the set-up again" when this set-up was discarded.
        failures >= MFA_CONFIRM_MAX_ATTEMPTS ? { setupDiscarded: true } : undefined,
      ),
    };
  }
  await recordSecondFactorSuccess(tx, userId);
  await db(tx)
    .updateTable('identity.mfa_factors')
    .set({ status: 'disabled', disabled_at: tx.now })
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .execute();
  const activated = await db(tx)
    .updateTable('identity.mfa_factors')
    .set({ status: 'active', confirmed_at: tx.now, version: sql`version + 1` })
    .where('id', '=', pending.id)
    .where('status', '=', 'pending')
    .executeTakeFirst();
  if (Number(activated.numUpdatedRows) !== 1)
    throw new BusinessRuleError(
      'no_pending_enrolment',
      'This authenticator set-up is no longer pending. Start the set-up again.',
    );
  const codes = await replaceRecoveryCodes(tx, userId, person.epoch);
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
  return { ok: true, value: { recoveryCodes: codes } };
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

async function replaceRecoveryCodes(tx: TxContext, userId: string, epoch: number): Promise<string[]> {
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
        credential_epoch: epoch,
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
  const person = await lockPerson(tx, userId);
  await assertSessionCurrent(tx, person.epoch);
  if (!(await hasActiveTotp(tx, userId)))
    throw new BusinessRuleError('mfa_not_enrolled', 'Set up an authenticator app first.');
  const proven = await proveExistingCredential(tx, ports, userId, proof);
  if (!proven.ok) return proven;
  const codes = await replaceRecoveryCodes(tx, userId, person.epoch);
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
      .where(sameEpoch(userId))
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
      .where(sameEpoch(userId))
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
  const person = await lockPerson(tx, userId);
  await assertSessionCurrent(tx, person.epoch);
  const session = await currentSession(tx);
  if (!session) throw new UnauthenticatedError();
  const lock = await reserveSecondFactorAttempt(tx, userId);
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
  const person = await lockPerson(tx, userId);
  await assertSessionCurrent(tx, person.epoch);
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
  input: { userId: string; credentialEpoch: number; ip?: string | undefined; userAgent?: string | undefined },
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
      credential_epoch: input.credentialEpoch,
      ip: input.ip ?? null,
      user_agent: input.userAgent?.slice(0, 500) ?? null,
    })
    .execute();
  return { challengeToken, expiresAt };
}

/**
 * Why a sign-in code was refused. The code stays `unauthenticated` (401); `details.reason` lets the sign-in screen
 * say what to do next: `invalid_code` → try again (with `attemptsRemaining`), `challenge_expired` → enter the
 * password again. Neither reveals anything about the person that the password step had not already proven.
 */
export type MfaChallengeFailure = 'challenge_expired' | 'invalid_code';

export class MfaChallengeError extends DomainError {
  constructor(reason: MfaChallengeFailure, attemptsRemaining?: number) {
    super(
      'unauthenticated',
      reason === 'invalid_code' && attemptsRemaining !== 0
        ? 'That code is not right. Check the 6-digit code in your authenticator app (or the recovery code) and try again.'
        : 'This sign-in request has expired or used up its attempts. Enter your password again to get a new one.',
      {
        status: 401,
        details: {
          reason: reason === 'invalid_code' && attemptsRemaining === 0 ? 'challenge_expired' : reason,
          ...(attemptsRemaining !== undefined ? { attemptsRemaining } : {}),
        },
      },
    );
  }
}

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
  if (kind !== 'pmc' || !tenantId || !isUuid(tenantId)) throw new MfaChallengeError('challenge_expired');
  const { rows } = await sql<{ id: string; name: string; environment: string; status: string }>`
    select id, name, environment, status from platform.tenant_summaries(${[tenantId]}::uuid[])`.execute(
    database.kysely,
  );
  const org = rows[0];
  if (org?.status !== 'active') throw new MfaChallengeError('challenge_expired');
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
    const expired = { ok: false as const, reason: 'challenge_expired' as const };
    if (!c || c.consumed_at || c.expires_at <= tx.now || c.attempts >= MFA_MAX_ATTEMPTS) return expired;
    // R3-P1-1: the password behind this challenge was checked in an epoch; a wipe since then voids it.
    const person = await lockPerson(tx, c.user_id);
    if (person.epoch !== c.credential_epoch) return expired;
    const lock = await reserveSecondFactorAttempt(tx, c.user_id);
    if (lock) return { ok: false as const, reason: 'locked' as const, lock };
    const method = await verifySecondFactor(tx, ports, c.user_id, input);
    if (!method) {
      await db(tx)
        .updateTable('identity.mfa_challenges')
        .set({ attempts: sql`attempts + 1` })
        .where('id', '=', c.id)
        .execute();
      await recordSecondFactorFailure(tx, ports, c.user_id);
      await tx.audit({ action: 'identity.mfa.challengeFailed', target: { type: 'user', id: c.user_id } });
      return {
        ok: false as const,
        reason: 'invalid_code' as const,
        attemptsRemaining: Math.max(0, MFA_MAX_ATTEMPTS - (c.attempts + 1)),
      };
    }
    await recordSecondFactorSuccess(tx, c.user_id);
    await db(tx)
      .updateTable('identity.mfa_challenges')
      .set({ consumed_at: tx.now })
      .where('id', '=', c.id)
      .execute();
    const session = await createSession(tx, {
      userId: c.user_id,
      credentialEpoch: person.epoch,
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
    if (outcome.reason === 'locked') throw new SecondFactorLockedError(outcome.lock);
    if (outcome.reason === 'invalid_code')
      throw new MfaChallengeError('invalid_code', outcome.attemptsRemaining);
    throw new MfaChallengeError('challenge_expired');
  }
  return {
    status: 'signed_in' as const,
    token: outcome.token,
    expiresAt: outcome.expiresAt,
    userId: outcome.userId,
    organization: { id: org.id, name: org.name, environment: org.environment },
  };
}
