import { randomBytes } from 'node:crypto';

/** UUIDv7 (RFC 9562): 48-bit unix ms timestamp + random. Time-ordered, index-friendly. */
export function newId(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  bytes[0] = Math.floor(now / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(now / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(now / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(now / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Human-facing reference codes (confirmation numbers etc.). Crockford base32, no ambiguous chars. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newReferenceCode(prefix: string, length = 6): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CROCKFORD[(bytes[i] ?? 0) % 32];
  return `${prefix}-${out}`;
}
