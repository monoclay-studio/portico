/**
 * Half-open stay-date range algebra for the ARI dirty set (pure). A set of ranges is kept NORMALIZED: sorted,
 * disjoint and non-adjacent (overlapping and touching ranges are merged), so a burst of changes over the same or
 * neighbouring nights collapses into one range per product.
 */
import { addDays, type DateRange, diffDays, type LocalDate } from '@portico/kernel';

const minDate = (a: LocalDate, b: LocalDate) => (a < b ? a : b);
const maxDate = (a: LocalDate, b: LocalDate) => (a > b ? a : b);

function valid(r: DateRange): boolean {
  return r.from < r.to;
}

/** Sort, then merge overlapping AND adjacent ranges ([1,3) + [3,5) → [1,5)). Empty ranges are dropped. */
export function normalizeRanges(ranges: readonly DateRange[]): DateRange[] {
  const sorted = ranges.filter(valid).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const out: Array<{ from: LocalDate; to: LocalDate }> = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to) {
      last.to = maxDate(last.to, r.to);
    } else {
      out.push({ from: r.from, to: r.to });
    }
  }
  return out;
}

export function mergeRanges(existing: readonly DateRange[], incoming: readonly DateRange[]): DateRange[] {
  return normalizeRanges([...existing, ...incoming]);
}

/** Keep only the parts of `ranges` inside `window`. */
export function clipRanges(ranges: readonly DateRange[], window: DateRange): DateRange[] {
  return normalizeRanges(
    ranges.map((r) => ({ from: maxDate(r.from, window.from), to: minDate(r.to, window.to) })),
  );
}

/** `ranges` minus `remove` (both normalized on the way). */
export function subtractRanges(ranges: readonly DateRange[], remove: readonly DateRange[]): DateRange[] {
  let current = normalizeRanges(ranges);
  for (const cut of normalizeRanges(remove)) {
    const next: DateRange[] = [];
    for (const r of current) {
      if (cut.to <= r.from || cut.from >= r.to) {
        next.push(r);
        continue;
      }
      if (cut.from > r.from) next.push({ from: r.from, to: cut.from });
      if (cut.to < r.to) next.push({ from: cut.to, to: r.to });
    }
    current = next;
  }
  return normalizeRanges(current);
}

export function countNights(ranges: readonly DateRange[]): number {
  return normalizeRanges(ranges).reduce((n, r) => n + diffDays(r.from, r.to), 0);
}

/** Take at most `maxNights` nights, earliest first (nearest stay dates are the most urgent to publish). */
export function takeNights(
  ranges: readonly DateRange[],
  maxNights: number,
): { taken: DateRange[]; rest: DateRange[] } {
  const all = normalizeRanges(ranges);
  const taken: DateRange[] = [];
  let budget = Math.max(0, Math.floor(maxNights));
  for (const r of all) {
    if (budget === 0) break;
    const n = diffDays(r.from, r.to);
    if (n <= budget) {
      taken.push(r);
      budget -= n;
    } else {
      taken.push({ from: r.from, to: addDays(r.from, budget) });
      budget = 0;
    }
  }
  return { taken, rest: subtractRanges(all, taken) };
}

/** Group a set of dates into normalized ranges. */
export function rangesFromDates(dates: readonly LocalDate[]): DateRange[] {
  return normalizeRanges(dates.map((d) => ({ from: d, to: addDays(d, 1) })));
}

export function eachDate(ranges: readonly DateRange[]): LocalDate[] {
  const out: LocalDate[] = [];
  for (const r of normalizeRanges(ranges)) {
    for (let d = r.from; d < r.to; d = addDays(d, 1)) out.push(d);
  }
  return out;
}

export function sameRanges(a: readonly DateRange[], b: readonly DateRange[]): boolean {
  const x = normalizeRanges(a);
  const y = normalizeRanges(b);
  return x.length === y.length && x.every((r, i) => r.from === y[i]?.from && r.to === y[i]?.to);
}
