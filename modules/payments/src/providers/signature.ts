/**
 * Webhook signatures in the Stripe scheme: header `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`.
 * Verification is constant-time and rejects timestamps outside the tolerance window (replay protection).
 * The simulator signs its events the same way so both providers go through identical verification.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookSignatureError } from './provider';

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function computeSignature(secret: string, timestamp: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
}

export function signatureHeader(secret: string, timestamp: number, rawBody: string): string {
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, rawBody)}`;
}

export function verifySignature(
  header: string | undefined,
  rawBody: string,
  secrets: readonly string[],
  now: Date,
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): void {
  if (!header) throw new WebhookSignatureError('Missing signature header.');
  if (secrets.length === 0) throw new WebhookSignatureError('No webhook signing secret is configured.');
  let timestamp: number | undefined;
  const candidates: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2).map((s) => s.trim());
    if (k === 't' && v && /^\d+$/.test(v)) timestamp = Number(v);
    else if (k === 'v1' && v) candidates.push(v);
  }
  if (timestamp === undefined || candidates.length === 0) {
    throw new WebhookSignatureError('Malformed signature header.');
  }
  const age = Math.abs(Math.floor(now.getTime() / 1000) - timestamp);
  if (age > toleranceSeconds) throw new WebhookSignatureError('Signature timestamp outside the tolerance window.');
  for (const secret of secrets) {
    const expected = Buffer.from(computeSignature(secret, timestamp, rawBody), 'hex');
    for (const c of candidates) {
      if (!/^[0-9a-f]+$/i.test(c)) continue;
      const got = Buffer.from(c, 'hex');
      if (got.length === expected.length && timingSafeEqual(got, expected)) return;
    }
  }
  throw new WebhookSignatureError('Signature does not match.');
}
