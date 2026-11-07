import { addDays, type LocalDate, ValidationError } from '@portico/kernel';
import type { IntervalUnit } from './model';

/** Add calendar months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12; // 0-based
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

export function advance(date: LocalDate, unit: IntervalUnit, count: number): LocalDate {
  if (count <= 0) throw new ValidationError('invalid_interval', 'A preventive interval must be at least 1.');
  switch (unit) {
    case 'day':
      return addDays(date, count);
    case 'week':
      return addDays(date, count * 7);
    case 'month':
      return addMonths(date, count);
  }
}

/**
 * Which occurrences of a preventive schedule are due for generation on `asOf` (work orders are generated
 * `leadDays` before the due date). Missed occurrences (e.g. the scheduler did not run for a while) are all
 * returned, oldest first, up to `cap`, so nothing is silently skipped; anything beyond the cap is reported.
 */
export function dueOccurrences(input: {
  nextDueOn: LocalDate;
  unit: IntervalUnit;
  count: number;
  asOf: LocalDate;
  leadDays: number;
  cap?: number;
}): { occurrences: LocalDate[]; nextDueOn: LocalDate; skipped: number } {
  const cap = input.cap ?? 12;
  const horizon = addDays(input.asOf, input.leadDays);
  const occurrences: LocalDate[] = [];
  let skipped = 0;
  let due = input.nextDueOn;
  while (due <= horizon) {
    if (occurrences.length < cap) occurrences.push(due);
    else skipped++;
    due = advance(due, input.unit, input.count);
  }
  return { occurrences, nextDueOn: due, skipped };
}
