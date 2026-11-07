/**
 * Partner webhooks: signing, verification, retry schedule, endpoint safety and the public event catalogue.
 * Pattern adopted from research 02 §8 ("self-serve subscriptions with topic wildcards and property filters,
 * thin events plus fetch, signed payloads, retries with a visible delivery log and replay") and 01 §8 (replay).
 * Pure logic — no IO.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { checkOutboundUrl, type OutboundUrlPolicy } from '../net/address-policy';

export const SIGNATURE_HEADER = 'portico-signature';
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** Delays before attempts 2…10: about 25.9 hours in total, so retries cover at least 24 hours (INT-R26). */
export const WEBHOOK_RETRY_SCHEDULE_SECONDS: readonly number[] = [
  60, 300, 900, 1800, 3600, 7200, 14_400, 28_800, 36_000,
];
export const MAX_DELIVERY_ATTEMPTS = WEBHOOK_RETRY_SCHEDULE_SECONDS.length + 1;
/**
 * An endpoint failing this many attempts in a row (across deliveries) is disabled until an admin re-enables it.
 * Higher than one delivery's attempts, so a single dead delivery never disables an endpoint on its own.
 */
export const DISABLE_AFTER_CONSECUTIVE_FAILURES = 12;
export const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * A webhook URL as written to audit and record history (F23): partners sometimes put tokens in the query string or
 * userinfo, so both are masked; scheme, host, port and path stay readable.
 */
export function maskUrlForAudit(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}${u.search ? '?[masked]' : ''}${u.hash ? '#[masked]' : ''}`;
  } catch {
    return '[invalid URL]';
  }
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` (timestamp binding defeats replay of old bodies). */
export function signPayload(secret: string, timestampSeconds: number, body: string): string {
  const mac = createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
  return `t=${timestampSeconds},v1=${mac}`;
}

/** Header with one v1 signature per active secret (two during a signing-secret rotation). */
export function signatureHeader(secrets: readonly string[], timestampSeconds: number, body: string): string {
  const macs = secrets.map((s) =>
    createHmac('sha256', s).update(`${timestampSeconds}.${body}`).digest('hex'),
  );
  return [`t=${timestampSeconds}`, ...macs.map((m) => `v1=${m}`)].join(',');
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
  let t = Number.NaN;
  const candidates: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = Number(v);
    else if (k === 'v1' && v) candidates.push(v);
  }
  if (!Number.isInteger(t) || candidates.length === 0)
    return { valid: false, reason: 'malformed signature header' };
  if (Math.abs(nowSeconds - t) > toleranceSeconds)
    return { valid: false, reason: 'timestamp outside tolerance' };
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${body}`).digest('hex'), 'utf8');
  const ok = candidates.some((c) => {
    const b = Buffer.from(c, 'utf8');
    return b.length === expected.length && timingSafeEqual(expected, b);
  });
  return ok ? { valid: true } : { valid: false, reason: 'signature mismatch' };
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
 * Subscription-time URL check (https, DNS host name, allowed port, no internal names). This alone is NOT the SSRF
 * defense: every delivery goes through `safeFetch`, which resolves the name, refuses non-public addresses and pins
 * the connection to the vetted address.
 */
export function checkEndpointUrl(raw: string, policy: OutboundUrlPolicy = {}): UrlCheck {
  const c = checkOutboundUrl(raw, policy);
  return c.ok ? { ok: true } : { ok: false, reason: c.reason };
}
