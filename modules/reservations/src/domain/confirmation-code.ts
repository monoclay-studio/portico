/**
 * Confirmation codes (RES-R01): 8 characters of Crockford base32 without ambiguous characters (no I, L, O, U,
 * and additionally no 0/1 which staff confuse with O/I when reading aloud). Unique per organization (DB
 * constraint) and never reused (RES-I08): codes are never released, cancelled bookings keep theirs.
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 8;

/** Build a code from random bytes (inject randomness for tests). Rejection sampling keeps it unbiased. */
export function confirmationCodeFrom(randomBytes: (n: number) => Uint8Array): string {
  const n = CODE_ALPHABET.length; // 30
  const limit = 256 - (256 % n); // 240
  let out = '';
  while (out.length < CODE_LENGTH) {
    const bytes = randomBytes(CODE_LENGTH * 2);
    for (const b of bytes) {
      if (b >= limit) continue;
      out += CODE_ALPHABET[b % n];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}

export function isConfirmationCode(value: string): boolean {
  if (value.length !== CODE_LENGTH) return false;
  for (const ch of value) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/** Normalise user input (lowercase, spaces, dashes, and the common O→0 / I→1 confusions are rejected). */
export function normalizeConfirmationCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}
