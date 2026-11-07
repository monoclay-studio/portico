import {
  addDays,
  compareDates,
  type DateRange,
  eachNight,
  isLocalDate,
  type LocalDate,
  ValidationError,
} from '@portico/kernel';

/** Longest night range a single inventory command may touch (two years covers long-stay apartments). */
export const MAX_COMMAND_NIGHTS = 731;
/**
 * Longest range one availability read may cover: two years (PAR-INV-032 asks for ≥ 400 nights; the spec's 400 is
 * raised so a full year ahead plus history fits one request).
 */
export const MAX_READ_NIGHTS = 731;

/** Validate a half-open night range [from, to) and return its nights. */
export function nightsOfRange(range: DateRange, max = MAX_COMMAND_NIGHTS, field = 'nights'): LocalDate[] {
  if (!isLocalDate(range.from) || !isLocalDate(range.to)) {
    throw new ValidationError('invalid_date', `${field} must use dates in YYYY-MM-DD format.`, {
      field,
      range,
    });
  }
  if (range.to <= range.from) {
    throw new ValidationError(
      'invalid_night_range',
      `${field}: the departure (${range.to}) must be after the arrival (${range.from}); a stay has at least one night.`,
      { field, range },
    );
  }
  const nights = eachNight(range);
  if (nights.length > max) {
    throw new ValidationError(
      'night_range_too_long',
      `${field} covers ${nights.length} nights; at most ${max} are allowed in one request. Split it into shorter ranges.`,
      { field, range, max },
    );
  }
  return nights;
}

/** Group nights (any order, duplicates allowed) into sorted, maximal contiguous half-open ranges. */
export function nightsToRuns(nights: readonly LocalDate[]): DateRange[] {
  const sorted = [...new Set(nights)].sort();
  const runs: DateRange[] = [];
  for (const n of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.to === n) runs[runs.length - 1] = { from: last.from, to: addDays(n, 1) };
    else runs.push({ from: n, to: addDays(n, 1) });
  }
  return runs;
}

/** The later of two dates (ISO dates compare lexicographically). */
export function laterDate(a: LocalDate, b: LocalDate): LocalDate {
  return compareDates(a, b) >= 0 ? a : b;
}

/** The earlier of two dates. */
export function earlierDate(a: LocalDate, b: LocalDate): LocalDate {
  return compareDates(a, b) <= 0 ? a : b;
}

export function intersectRanges(a: DateRange, b: DateRange): DateRange | null {
  const from = laterDate(a.from, b.from);
  const to = earlierDate(a.to, b.to);
  return from < to ? { from, to } : null;
}

/** `a` minus `b`: zero, one or two ranges. */
export function subtractRange(a: DateRange, b: DateRange): DateRange[] {
  const overlap = intersectRanges(a, b);
  if (!overlap) return [{ from: a.from, to: a.to }];
  const out: DateRange[] = [];
  if (a.from < overlap.from) out.push({ from: a.from, to: overlap.from });
  if (overlap.to < a.to) out.push({ from: overlap.to, to: a.to });
  return out;
}

export function rangeContainsNight(range: DateRange, night: LocalDate): boolean {
  return night >= range.from && night < range.to;
}

export function rangeCovers(outer: DateRange, inner: DateRange): boolean {
  return outer.from <= inner.from && inner.to <= outer.to;
}

export function nightCount(range: DateRange): number {
  return eachNight(range).length;
}

/** Postgres `daterange` literal parts are handled in SQL; this formats a range for messages: "10–13 Nov 2026". */
export function describeRange(range: DateRange): string {
  const last = addDays(range.to, -1);
  return range.from === last ? `night of ${range.from}` : `nights ${range.from} to ${last}`;
}

/** Ledger cell identity. Lock order is ascending (unitTypeId, night) — see `compareCells`. */
export interface CellRef {
  readonly unitTypeId: string;
  readonly night: LocalDate;
}

export const cellKey = (unitTypeId: string, night: LocalDate): string => `${unitTypeId}|${night}`;

export function compareCells(a: CellRef, b: CellRef): number {
  if (a.unitTypeId !== b.unitTypeId) return a.unitTypeId < b.unitTypeId ? -1 : 1;
  return a.night === b.night ? 0 : a.night < b.night ? -1 : 1;
}

/** Deduplicate and sort cells into the global lock order. */
export function lockOrder(cells: readonly CellRef[]): CellRef[] {
  const seen = new Map<string, CellRef>();
  for (const c of cells)
    seen.set(cellKey(c.unitTypeId, c.night), { unitTypeId: c.unitTypeId, night: c.night });
  return [...seen.values()].sort(compareCells);
}

/** Smallest range covering the given nights (for coalescible events). */
export function spanOf(nights: readonly LocalDate[]): DateRange | null {
  if (nights.length === 0) return null;
  const sorted = [...nights].sort();
  return { from: sorted[0] as LocalDate, to: addDays(sorted[sorted.length - 1] as LocalDate, 1) };
}
