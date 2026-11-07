import { createHash, randomBytes } from 'node:crypto';

/**
 * MFA recovery codes: 10 single-use codes of 10 Crockford-base32 characters (50 bits each), shown once, stored
 * only as SHA-256 hashes. High entropy makes a fast hash appropriate (no password-style stretching needed).
 */
export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const bytes = randomBytes(10);
    let raw = '';
    for (const b of bytes) raw += ALPHABET[b % 32];
    codes.add(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return [...codes];
}

/** Normalize what a person types: case-insensitive, ignore spaces/dashes, Crockford aliases (O→0, I/L→1). */
export function normalizeRecoveryCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(s)) return null;
  return s;
}

export function hashRecoveryCode(code: string): string | null {
  const n = normalizeRecoveryCode(code);
  return n ? createHash('sha256').update(`portico-recovery:${n}`).digest('hex') : null;
}
