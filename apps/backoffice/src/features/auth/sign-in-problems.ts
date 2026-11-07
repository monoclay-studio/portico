import { ApiError } from '../../api/errors';

/**
 * What a refused sign-in code means for the person (POST /v1/auth/login/mfa), so the screen can offer the right next
 * step instead of a generic error:
 *  - `wrong_code`: try again (the server says how many tries are left on this sign-in);
 *  - `expired`: the sign-in request is over (too old, used up, or no longer valid) — enter the password again;
 *  - `locked`: too many wrong codes for this person — wait until the given time;
 *  - `other`: anything else (connection, server) — shown as a problem with its reference.
 */
export type SecondStepFailure =
  | { kind: 'wrong_code'; triesLeft: number | null }
  | { kind: 'expired' }
  | { kind: 'locked'; until: Date }
  | { kind: 'other' };

export function secondStepFailure(e: unknown, now = new Date()): SecondStepFailure {
  if (!(e instanceof ApiError)) return { kind: 'other' };
  const details = e.problem.details ?? {};
  if (e.status === 429 && e.code === 'second_factor_locked') {
    const until = typeof details.retryAfter === 'string' ? new Date(details.retryAfter) : null;
    return {
      kind: 'locked',
      until: until && !Number.isNaN(until.getTime()) ? until : new Date(now.getTime() + 60_000),
    };
  }
  if (e.status === 401) {
    if (details.reason === 'invalid_code')
      return {
        kind: 'wrong_code',
        triesLeft: typeof details.attemptsRemaining === 'number' ? details.attemptsRemaining : null,
      };
    return { kind: 'expired' };
  }
  return { kind: 'other' };
}

/** The organization requires its company account (single sign-on) for this person. */
export function isCompanySignInRequired(e: unknown): boolean {
  return e instanceof ApiError && e.code === 'sso_required';
}

/** A 6-digit authenticator code, ignoring spaces ("123 456"); null when it cannot be one. */
export function normalizeAuthenticatorCode(input: string): string | null {
  const s = input.replace(/\s/g, '');
  return /^\d{6}$/.test(s) ? s : null;
}

/** A recovery code (10 letters and digits, dash and spaces optional), formatted XXXXX-XXXXX; null when malformed. */
export function normalizeRecoveryCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  return /^[0-9A-Z]{10}$/.test(s) ? `${s.slice(0, 5)}-${s.slice(5)}` : null;
}

/** Whole seconds until `until` (never negative). */
export function secondsUntil(until: Date, now = new Date()): number {
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 1000));
}
