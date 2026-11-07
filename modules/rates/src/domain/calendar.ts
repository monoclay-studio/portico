/** Calendar helpers for bulk price/restriction updates (pure). */
import {
  addDays,
  compareDates,
  type DateRange,
  eachNight,
  type LocalDate,
  ValidationError,
} from '@portico/kernel';

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: LocalDate): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export const MAX_BULK_DAYS = 800;

/** Expand half-open ranges filtered by weekdays into sorted, unique dates. */
export function expandDates(ranges: readonly DateRange[], weekdays?: readonly number[]): LocalDate[] {
  const set = new Set<LocalDate>();
  for (const r of ranges) {
    if (r.to <= r.from) {
      throw new ValidationError(
        'invalid_date_range',
        `The range ${r.from} → ${r.to} is empty. Ranges are [from, to).`,
      );
    }
    for (const d of eachNight(r)) {
      if (!weekdays || weekdays.includes(isoWeekday(d))) set.add(d);
      if (set.size > MAX_BULK_DAYS) {
        throw new ValidationError(
          'bulk_range_too_large',
          `A bulk update may cover at most ${MAX_BULK_DAYS} days. Split it into smaller updates.`,
        );
      }
    }
  }
  return [...set].sort();
}

/** Coalesce dates into the fewest half-open ranges (for compact events and summaries). */
export function coalesceDates(dates: Iterable<LocalDate>): DateRange[] {
  const sorted = [...new Set(dates)].sort();
  const out: DateRange[] = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && last.to === d) out[out.length - 1] = { from: last.from, to: addDays(d, 1) };
    else out.push({ from: d, to: addDays(d, 1) });
  }
  return out;
}

/** Earlier / later of two dates (LocalDate strings compare lexically; Math.min/max must not be used). */
export const earlierDate = (a: LocalDate, b: LocalDate): LocalDate => (compareDates(a, b) <= 0 ? a : b);
export const laterDate = (a: LocalDate, b: LocalDate): LocalDate => (compareDates(a, b) >= 0 ? a : b);
