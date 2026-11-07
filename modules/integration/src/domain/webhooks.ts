/**
 * Partner webhooks: signing, verification, retry schedule, endpoint safety and the public event catalogue.
 * Pattern adopted from research 02 §8 ("self-serve subscriptions with topic wildcards and property filters,
 * thin events plus fetch, signed payloads, retries with a visible delivery log and replay") and 01 §8 (replay).
 * Pure logic — no IO.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'portico-signature';
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** Delays before attempts 2…8 (≈ 21 hours in total, comparable to a 24-hour retry window). */
export const WEBHOOK_RETRY_SCHEDULE_SECONDS: readonly number[] = [60, 300, 900, 3600, 10_800, 21_600, 43_200];
export const MAX_DELIVERY_ATTEMPTS = WEBHOOK_RETRY_SCHEDULE_SECONDS.length + 1;
/** An endpoint failing this many attempts in a row (across deliveries) is disabled until an admin re-enables it. */
export const DISABLE_AFTER_CONSECUTIVE_FAILURES = 10;
export const DELIVERY_TIMEOUT_MS = 10_000;

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` (timestamp binding defeats replay of old bodies). */
export function signPayload(secret: string, timestampSeconds: number, body: string): string {
  const mac = createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
  return `t=${timestampSeconds},v1=${mac}`;
}

export type VerifyResult = { valid: true } | { valid: false; reason: string };

/** Reference verification for partners (documented in the README). Constant-time comparison. */
export function verifySignature(
  secret: string,
  header: string | undefined,
  body: string,
  nowSeconds: number,
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): VerifyResult {
  if (!header) return { valid: false, reason: 'missing signature header' };
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isInteger(t) || !v1) return { valid: false, reason: 'malformed signature header' };
  if (Math.abs(nowSeconds - t) > toleranceSeconds)
    return { valid: false, reason: 'timestamp outside tolerance' };
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: 'signature mismatch' };
  return { valid: true };
}

/** Seconds until the next attempt after `attempts` failed attempts, or null when the delivery is dead. */
export function nextRetryDelay(attempts: number): number | null {
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return null;
  return WEBHOOK_RETRY_SCHEDULE_SECONDS[attempts - 1] ?? null;
}

export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Event types partners may subscribe to. Payloads are THIN (type, ids, time, property): partners fetch details
 * through the API with their own permissions, so a webhook never carries guest PII or more than the partner may
 * read.
 */
export const PUBLIC_WEBHOOK_EVENTS: ReadonlyArray<{ type: string; description: string }> = [
  { type: 'reservations.booking.confirmed', description: 'A booking was confirmed.' },
  { type: 'reservations.booking.modified', description: 'A booking changed.' },
  { type: 'reservations.booking.cancelled', description: 'A booking was cancelled.' },
  { type: 'reservations.stay.checkedIn', description: 'A guest checked in.' },
  { type: 'reservations.stay.checkedOut', description: 'A guest checked out.' },
  { type: 'reservations.stay.moved', description: 'A stay moved to another unit.' },
  { type: 'operations.unit.conditionChanged', description: 'A unit’s housekeeping condition changed.' },
  { type: 'finance.invoice.issued', description: 'An invoice was issued.' },
  { type: 'platform.property.businessDateAdvanced', description: 'Day Close advanced the business date.' },
  { type: 'integration.connection.statusChanged', description: 'A connection’s status or health changed.' },
  { type: 'integration.webhook.test', description: 'A test event sent on request.' },
];
const PUBLIC_TYPES = new Set(PUBLIC_WEBHOOK_EVENTS.map((e) => e.type));

export function matchesEventType(pattern: string, type: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) return type.startsWith(pattern.slice(0, -1));
  return pattern === type;
}

/** Patterns that match no public event type (rejected at subscription time). */
export function invalidPatterns(patterns: readonly string[]): string[] {
  return patterns.filter((p) => ![...PUBLIC_TYPES].some((t) => matchesEventType(p, t)));
}

export function isPublicEventType(type: string): boolean {
  return PUBLIC_TYPES.has(type);
}

export type UrlCheck = { ok: true } | { ok: false; reason: string };

/**
 * Basic server-side request forgery protection: https only, no credentials in the URL, no localhost, private,
 * link-local or internal hosts. (DNS rebinding is handled at delivery time by the transport — see README.)
 */
export function checkEndpointUrl(raw: string): UrlCheck {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: 'This is not a valid URL.' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'Webhook endpoints must use https://.' };
  if (u.username || u.password)
    return { ok: false, reason: 'Do not put credentials in the URL; use the signing secret.' };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return { ok: false, reason: 'Webhook endpoints must be reachable on the public internet.' };
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    const privateRange =
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224;
    if (privateRange)
      return { ok: false, reason: 'Webhook endpoints cannot be private or reserved IP addresses.' };
  }
  if (host.includes(':')) {
    if (
      host === '::1' ||
      host === '::' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80')
    ) {
      return { ok: false, reason: 'Webhook endpoints cannot be private or reserved IP addresses.' };
    }
  }
  return { ok: true };
}
