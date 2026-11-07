/** Content hash of agreed terms: proves a persisted TermsSnapshot was not altered (RAT-I03). */
import { canonicalJson, sha256Hex } from '@portico/kernel';
import type { TermsSnapshot } from '../contracts';

export function hashTerms(terms: Omit<TermsSnapshot, 'hash'>): string {
  return `sha256:${sha256Hex(canonicalJson(terms))}`;
}

export function sealTerms(draft: Omit<TermsSnapshot, 'hash'>): TermsSnapshot {
  return { ...draft, hash: hashTerms(draft) };
}

/** True when the snapshot's content matches its hash. */
export function verifyTerms(terms: TermsSnapshot): boolean {
  const { hash, ...rest } = terms;
  return hashTerms(rest) === hash;
}
