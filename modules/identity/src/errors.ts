import { DomainError } from '@portico/kernel';

/**
 * Step-up problems. The HTTP layer turns a plain `forbidden` into one of these when the permission is granted by
 * role but not effective for MFA reasons (see routes.ts `stepUpTranslator`), so clients can prompt for a code
 * instead of telling the person they lack access.
 */
export class MfaRequiredError extends DomainError {
  constructor(details: { permission?: string; stepUpWindowMinutes: number }) {
    super(
      'mfa_required',
      `This action needs a recent verification with your authenticator app (within ${details.stepUpWindowMinutes} minutes). Enter a code from your app (or a recovery code) and try again.`,
      { status: 403, details: { ...details, verifyPath: '/v1/auth/mfa/verify' } },
    );
  }
}

export class MfaEnrollmentRequiredError extends DomainError {
  constructor(details: { permission?: string }) {
    super(
      'mfa_enrollment_required',
      'Your role includes sensitive permissions, which need two-step verification. Set up an authenticator app under Security settings, then try again.',
      { status: 403, details: { ...details, enrolPath: '/v1/auth/mfa/totp' } },
    );
  }
}

export class NotConfiguredError extends DomainError {
  constructor(feature: string, what: string) {
    super('not_configured', `${feature} is not available on this server: ${what} is not configured.`, {
      status: 503,
      details: { feature },
    });
  }
}
