/**
 * Seal of agreed terms: HMAC-SHA256 with a SERVER key over the canonical JSON of every field except the seal.
 * Without the key nobody can produce a valid seal, so a client cannot fabricate agreed prices (RAT-I03). The
 * check runs over the raw stored object (not a re-parsed one), so future schema versions with new defaults never
 * invalidate stored v1 terms.
 */
import { createHmac } from 'node:crypto';
import { canonicalJson, constantTimeEqual } from '@portico/kernel';
import type { TermsSnapshot } from '../contracts';

const PREFIX = 'hmac-sha256:';

export function sealOf(key: string, content: Record<string, unknown>): string {
  const { seal: _seal, ...rest } = content;
  return `${PREFIX}${createHmac('sha256', Buffer.from(key, 'base64')).update(canonicalJson(rest)).digest('hex')}`;
}

export function sealTerms(key: string, draft: Omit<TermsSnapshot, 'seal'>): TermsSnapshot {
  return { ...draft, seal: sealOf(key, draft) };
}

/** True when the (raw, as stored) terms carry a seal made with this server key over exactly this content. */
export function verifyTerms(key: string, terms: unknown): boolean {
  if (typeof terms !== 'object' || terms === null) return false;
  const seal = (terms as { seal?: unknown }).seal;
  if (typeof seal !== 'string' || !seal.startsWith(PREFIX)) return false;
  return constantTimeEqual(sealOf(key, terms as Record<string, unknown>), seal);
}
