import type { Authorizer } from '@portico/kernel';

/**
 * MFA policy for staff sessions, evaluated centrally inside the Authorizer so that no module has to know about
 * MFA: `requirePermission(ctx, <sensitive permission>)` simply fails when step-up is missing.
 *
 * Rules (organization security policy):
 *  1. A sensitive (⚑) permission is effective only for a member who has MFA enrolled (TOTP factor, or a session
 *     established through the organization's SSO with MFA asserted by the identity provider). New members get an
 *     enrolment grace period (default 72 h from activation) so that onboarding is possible; after it ends,
 *     sensitive permissions stop working until MFA is enrolled (`mfa_enrollment_required`).
 *  2. For an enrolled member, a sensitive permission additionally requires a recent MFA verification on the
 *     session: `now - mfaVerifiedAt <= stepUpWindowMinutes` (default 15). Otherwise `mfa_required` (step-up).
 *  3. Optionally (`requireMfaForAll`), every permission requires enrolment after the grace period.
 *  Non-sensitive permissions never require step-up, so desk work is not interrupted.
 */
export type StepUpDenial = 'mfa_required' | 'mfa_enrollment_required';

export interface StepUpState {
  now: Date;
  mfaEnrolled: boolean;
  mfaVerifiedAt: Date | null;
  /** Until when an un-enrolled member may still use sensitive permissions. null = no grace. */
  enrolmentGraceEndsAt: Date | null;
  stepUpWindowMinutes: number;
  requireMfaForAll: boolean;
}

export function stepUpDenial(sensitive: boolean, s: StepUpState): StepUpDenial | null {
  const inGrace = s.enrolmentGraceEndsAt !== null && s.now < s.enrolmentGraceEndsAt;
  if (!s.mfaEnrolled) {
    if (inGrace) return null;
    if (sensitive || s.requireMfaForAll) return 'mfa_enrollment_required';
    return null;
  }
  if (!sensitive) return null;
  if (s.mfaVerifiedAt && s.now.getTime() - s.mfaVerifiedAt.getTime() <= s.stepUpWindowMinutes * 60_000) {
    return null;
  }
  return 'mfa_required';
}

/** An Authorizer that can explain why a granted permission is currently not effective. */
export interface ExplainingAuthorizer extends Authorizer {
  /** null when the permission is effective or simply not granted; otherwise the step-up reason. */
  explainDenial(permission: string, scope?: { propertyId?: string | null }): StepUpDenial | null;
  /** The MFA state the decision was based on (for /me and problem details). */
  readonly stepUp: Readonly<StepUpState>;
}

export function isExplainingAuthorizer(a: Authorizer): a is ExplainingAuthorizer {
  return typeof (a as Partial<ExplainingAuthorizer>).explainDenial === 'function';
}

/**
 * Wrap the role-based authorizer with the MFA policy. `can` keeps the kernel contract (pure boolean, never
 * throws); `propertyScope` returns [] for permissions blocked by step-up, so lists fail closed too.
 */
export function stepUpAuthorizer(
  base: Authorizer,
  isSensitive: (permission: string) => boolean,
  state: StepUpState,
): ExplainingAuthorizer {
  const denial = (permission: string) => stepUpDenial(isSensitive(permission), state);
  return {
    stepUp: state,
    can(permission, scope) {
      return base.can(permission, scope) && denial(permission) === null;
    },
    propertyScope(permission) {
      return denial(permission) === null ? base.propertyScope(permission) : [];
    },
    explainDenial(permission, scope) {
      if (!base.can(permission, scope)) return null;
      return denial(permission);
    },
  };
}
