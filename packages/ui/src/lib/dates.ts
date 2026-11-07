/**
 * LocalDate helpers ('YYYY-MM-DD', no time zone). Pure functions; never use the browser's local time zone for
 * calendar arithmetic — all math happens in UTC on date-only values. Night ranges are half-open [from, to).
 */
export type LocalDate = string;

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLocalDate(value: string): value is LocalDate {
  const m = RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
}

export function toUtcDate(date: LocalDate): Date {
  const m = RE.exec(date);
  if (!m) throw new Error(`Not a LocalDate: ${date}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function fromUtcDate(d: Date): LocalDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = toUtcDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtcDate(d);
}

export function addMonths(date: LocalDate, months: number): LocalDate {
  const d = toUtcDate(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return fromUtcDate(d);
}

/** Whole days from `a` to `b` (b − a). */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return Math.round((toUtcDate(b).getTime() - toUtcDate(a).getTime()) / 86_400_000);
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function startOfMonth(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: LocalDate): number {
  return toUtcDate(date).getUTCDay();
}

/** Inclusive list of dates from `from` for `count` days. */
export function dateSeries(from: LocalDate, count: number): LocalDate[] {
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}

/** Weeks (rows of 7) covering the month of `month`, starting on `weekStartsOn` (0 Sunday, 1 Monday, 6 Saturday). */
export function monthMatrix(month: LocalDate, weekStartsOn = 1): LocalDate[][] {
  const first = startOfMonth(month);
  const offset = (dayOfWeek(first) - weekStartsOn + 7) % 7;
  const start = addDays(first, -offset);
  const weeks: LocalDate[][] = [];
  for (let w = 0; w < 6; w++) {
    const week = dateSeries(addDays(start, w * 7), 7);
    if (w > 3 && week[0]?.slice(0, 7) !== first.slice(0, 7)) break;
    weeks.push(week);
  }
  return weeks;
}

export function clampDate(date: LocalDate, min?: LocalDate, max?: LocalDate): LocalDate {
  if (min && date < min) return min;
  if (max && date > max) return max;
  return date;
}
