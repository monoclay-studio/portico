/**
 * Ranking for assignable-unit search (INV-R08/R22). Pure: the service gathers the facts, this orders them and
 * explains the order. Housekeeping condition is NOT considered here — callers (reservations) combine it.
 */
export type ExclusionCode =
  | 'assigned'
  | 'out_of_order'
  | 'out_of_service'
  | 'house_use'
  | 'inactive'
  | 'component_unavailable'
  | 'composite_in_use';

export interface Exclusion {
  code: ExclusionCode;
  message: string;
}

export interface CandidateFacts {
  unitId: string;
  number: string;
  sortOrder: number;
  features: readonly string[];
  exclusions: readonly Exclusion[];
  /** The unit is a component of at least one composite unit (e.g. a connecting room). */
  isComponent: boolean;
  /** The ref being placed already occupies this unit on some of the nights. */
  currentForRef: boolean;
}

export interface RankedCandidate<T extends CandidateFacts> {
  facts: T;
  assignable: boolean;
  score: number;
  matchedFeatures: string[];
  missingFeatures: string[];
  ranking: string[];
}

/** Natural order for unit numbers: "2" < "10", "A2" < "A10". */
export function compareUnitNumbers(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

/**
 * Features that protect a unit from casual assignment (PAR-INV-005): an accessible unit is kept for guests who need
 * it, so it ranks last unless the guest asked for that feature.
 */
export const PROTECTED_FEATURES: readonly string[] = ['accessible'];

export function rankCandidates<T extends CandidateFacts>(
  candidates: readonly T[],
  opts: {
    requestedFeatures?: readonly string[];
    compositeStay: boolean;
    protectedFeatures?: readonly string[];
  },
): RankedCandidate<T>[] {
  const wanted = [...new Set(opts.requestedFeatures ?? [])];
  const protectedFeatures = opts.protectedFeatures ?? PROTECTED_FEATURES;
  const ranked = candidates.map((facts) => {
    const assignable = facts.exclusions.length === 0;
    const matched = wanted.filter((f) => facts.features.includes(f));
    const missing = wanted.filter((f) => !facts.features.includes(f));
    const ranking: string[] = [];
    let score = 0;
    if (assignable) score += 1000;
    else ranking.push(facts.exclusions.map((e) => e.message).join(' '));
    if (assignable && facts.currentForRef) {
      score += 200;
      ranking.push('Already occupied by this stay — keeps the guest in the same unit.');
    }
    if (!opts.compositeStay) {
      if (facts.isComponent) {
        if (assignable)
          ranking.push('Ranked lower: part of a combinable unit; using it may break a multi-unit sale.');
      } else score += 100;
    }
    score += matched.length * 10 - missing.length * 10;
    const kept = protectedFeatures.filter((f) => facts.features.includes(f) && !wanted.includes(f));
    if (kept.length > 0) {
      score -= 150;
      if (assignable)
        ranking.push(
          `Ranked last: kept for guests who need it (${kept.join(', ')}); use it only if nothing else fits.`,
        );
    }
    if (wanted.length > 0 && assignable) {
      ranking.push(
        missing.length === 0
          ? `Matches every requested feature (${matched.join(', ')}).`
          : `Missing requested feature${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`,
      );
    }
    return { facts, assignable, score, matchedFeatures: matched, missingFeatures: missing, ranking };
  });
  return ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.facts.sortOrder - b.facts.sortOrder ||
      compareUnitNumbers(a.facts.number, b.facts.number),
  );
}
