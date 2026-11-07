/**
 * Unit ownership shares (owners & condo-hotel / villa ownership schemes). Shares are basis points (1/100 of a
 * percent, integers, never floats) over half-open date periods [effectiveFrom, effectiveTo). For every unit and
 * every date the sum of shares is ≤ 10 000 bp (100 %). Less than 100 % means the remainder is held by the
 * operating legal entity / unallocated — owner statements (finance, LATER) report it explicitly.
 */
export const FULL_SHARE_BPS = 10_000;

export interface SharePeriod {
  shareBps: number;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null; // exclusive; null = open-ended
}

const END_OF_TIME = '9999-12-31';

export function periodsOverlap(a: SharePeriod, b: SharePeriod): boolean {
  return a.effectiveFrom < (b.effectiveTo ?? END_OF_TIME) && b.effectiveFrom < (a.effectiveTo ?? END_OF_TIME);
}

/**
 * Highest total share on any date for `existing` + `candidate`. Only boundaries can change the total, so it
 * suffices to evaluate the sum at each period start within the candidate's period.
 */
export function maxConcurrentShare(
  existing: readonly SharePeriod[],
  candidate: SharePeriod,
): {
  maxBps: number;
  onDate: string;
} {
  const relevant = existing.filter((p) => periodsOverlap(p, candidate));
  const points = new Set<string>([candidate.effectiveFrom]);
  for (const p of relevant) if (p.effectiveFrom > candidate.effectiveFrom) points.add(p.effectiveFrom);
  let max = { maxBps: candidate.shareBps, onDate: candidate.effectiveFrom };
  for (const d of [...points].sort()) {
    if (d >= (candidate.effectiveTo ?? END_OF_TIME)) continue;
    const total =
      candidate.shareBps +
      relevant
        .filter((p) => p.effectiveFrom <= d && d < (p.effectiveTo ?? END_OF_TIME))
        .reduce((s, p) => s + p.shareBps, 0);
    if (total > max.maxBps) max = { maxBps: total, onDate: d };
  }
  return max;
}

export function validateSharePeriod(p: SharePeriod): string | null {
  if (!Number.isInteger(p.shareBps) || p.shareBps < 1 || p.shareBps > FULL_SHARE_BPS)
    return 'A share must be a whole number of basis points between 1 and 10000 (0.01 % to 100 %).';
  if (p.effectiveTo !== null && p.effectiveTo <= p.effectiveFrom)
    return 'The share must end after it starts (the end date is exclusive).';
  return null;
}

/** Shares in effect on a date. */
export function sharesOn<T extends SharePeriod>(periods: readonly T[], date: string): T[] {
  return periods.filter((p) => p.effectiveFrom <= date && date < (p.effectiveTo ?? END_OF_TIME));
}

/**
 * A payout reference/hint must not carry bank data in plain text: at most 4 consecutive digits (e.g. a last-4
 * hint such as "BML ••••1234"), and no IBAN-shaped strings.
 */
export function looksLikeBankData(text: string): boolean {
  const compact = text.replace(/[\s-]/g, '');
  if (/\d{5,}/.test(compact)) return true;
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/i.test(compact)) return true;
  return false;
}
