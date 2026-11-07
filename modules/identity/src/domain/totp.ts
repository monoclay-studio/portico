import { createHmac, randomBytes } from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238 over RFC 4226 HOTP). Pure functions: the caller supplies the time.
 *
 * Portico profile (what authenticator apps support universally): HMAC-SHA1, 6 digits, 30-second steps, a
 * 160-bit secret, and a verification window of ±1 step for clock drift. Replay protection is the caller's job:
 * `verifyTotp` returns the matched time step, which must be strictly greater than the last accepted step for
 * that factor (stored and compared atomically in the database).
 */
export interface TotpParams {
  digits: 6 | 8;
  periodSeconds: number;
  algorithm: 'sha1' | 'sha256' | 'sha512';
}

export const TOTP_DEFAULTS: TotpParams = { digits: 6, periodSeconds: 30, algorithm: 'sha1' };
/** Steps accepted either side of "now" to tolerate phone clock drift (RFC 6238 §5.2 recommends ≤ 1). */
export const TOTP_DRIFT_STEPS = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding (what otpauth:// URIs carry). */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random 160-bit secret, base32-encoded. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** RFC 4226 HOTP value for a counter. */
export function hotp(secret: Buffer, counter: number, params: TotpParams = TOTP_DEFAULTS): string {
  if (!Number.isSafeInteger(counter) || counter < 0)
    throw new Error('HOTP counter must be a non-negative integer');
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(params.algorithm, secret).update(msg).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return String(binary % 10 ** params.digits).padStart(params.digits, '0');
}

export function timeStep(at: Date, params: TotpParams = TOTP_DEFAULTS): number {
  return Math.floor(at.getTime() / 1000 / params.periodSeconds);
}

export function totp(secret: Buffer, at: Date, params: TotpParams = TOTP_DEFAULTS): string {
  return hotp(secret, timeStep(at, params), params);
}

/** Constant-time comparison of two equal-length digit strings. */
function sameDigits(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a code. Returns the matched time step, or null. Steps ≤ `lastUsedStep` are never accepted, so a code
 * that has been used once (or any older code) cannot be replayed.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  at: Date,
  opts: { lastUsedStep?: number | null; drift?: number; params?: TotpParams } = {},
): number | null {
  const params = opts.params ?? TOTP_DEFAULTS;
  const normalized = code.replace(/\s/g, '');
  if (!/^\d+$/.test(normalized) || normalized.length !== params.digits) return null;
  const now = timeStep(at, params);
  const drift = opts.drift ?? TOTP_DRIFT_STEPS;
  let matched: number | null = null;
  // Check every candidate (no early exit) so timing does not reveal which step matched.
  for (let step = now - drift; step <= now + drift; step++) {
    if (step < 0) continue;
    if (sameDigits(hotp(secret, step, params), normalized) && matched === null) matched = step;
  }
  if (matched === null) return null;
  if (opts.lastUsedStep !== undefined && opts.lastUsedStep !== null && matched <= opts.lastUsedStep)
    return null;
  return matched;
}

/** `otpauth://` provisioning URI rendered as a QR code by the UI (Key Uri Format used by authenticator apps). */
export function provisioningUri(input: {
  secret: string;
  accountName: string;
  issuer: string;
  params?: TotpParams;
}): string {
  const params = input.params ?? TOTP_DEFAULTS;
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.accountName)}`;
  const query = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: params.algorithm.toUpperCase(),
    digits: String(params.digits),
    period: String(params.periodSeconds),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
