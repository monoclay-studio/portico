import { canonicalJson, sha256Hex } from '@portico/kernel';

/** Hash at the start of every legal entity's fiscal chain. */
export const GENESIS_HASH = '0'.repeat(64);

/** Human document number: prefix + zero-padded sequence, e.g. INV-2026-000042. */
export function formatDocumentNumber(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(6, '0')}`;
}

/**
 * Each fiscal document hashes the previous one in its legal entity's chain together with its own immutable
 * content. Any later alteration or deletion breaks every following hash (verifiable with `verifyChain`).
 */
export function documentHash(input: {
  previousHash: string;
  chainPosition: number;
  documentNumber: string;
  kind: string;
  totalMinor: number;
  currency: string;
  snapshot: unknown;
}): string {
  return sha256Hex(canonicalJson(input));
}

export interface ChainLink {
  chainPosition: number;
  previousHash: string;
  hash: string;
  documentNumber: string;
  kind: string;
  totalMinor: number;
  currency: string;
  snapshot: unknown;
}

/** Returns the first broken position, or null if the chain verifies end to end. */
export function verifyChain(links: readonly ChainLink[]): { brokenAt: number; reason: string } | null {
  let prev = GENESIS_HASH;
  const sorted = [...links].sort((a, b) => a.chainPosition - b.chainPosition);
  for (let i = 0; i < sorted.length; i++) {
    const l = sorted[i] as ChainLink;
    if (l.chainPosition !== i + 1) return { brokenAt: l.chainPosition, reason: 'gap in chain positions' };
    if (l.previousHash !== prev) return { brokenAt: l.chainPosition, reason: 'previous hash mismatch' };
    const h = documentHash({
      previousHash: l.previousHash,
      chainPosition: l.chainPosition,
      documentNumber: l.documentNumber,
      kind: l.kind,
      totalMinor: l.totalMinor,
      currency: l.currency,
      snapshot: l.snapshot,
    });
    if (h !== l.hash) return { brokenAt: l.chainPosition, reason: 'content hash mismatch' };
    prev = l.hash;
  }
  return null;
}

/** Verifies gapless numbering: numbers are exactly 1..n. */
export function findNumberingGaps(numbers: readonly number[]): number[] {
  const set = new Set(numbers);
  const max = numbers.length === 0 ? 0 : Math.max(...numbers);
  const gaps: number[] = [];
  for (let i = 1; i <= max; i++) if (!set.has(i)) gaps.push(i);
  return gaps;
}
