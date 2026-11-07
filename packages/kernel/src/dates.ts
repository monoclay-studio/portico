import { ValidationError } from './errors';

/** A calendar date without time zone, 'YYYY-MM-DD'. */
export type LocalDate = string;

/** Half-open date range [from, to). For stays: from = arrival, to = departure. */
export interface DateRange {
  readonly from: LocalDate;
  readonly to: LocalDate;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

export function assertLocalDate(value: string, field = 'date'): LocalDate {
  if (!isLocalDate(value)) throw new ValidationError('invalid_date', `${field} must be a valid date in YYYY-MM-DD format.`, { field, value });
  return value;
}

function toUtcMs(d: LocalDate): number {
  assertLocalDate(d);
  return Date.parse(`${d}T00:00:00Z`);
}

function fromUtcMs(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: LocalDate, days: number): LocalDate {
  return fromUtcMs(toUtcMs(d) + days * MS_PER_DAY);
}

export function diffDays(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY);
}

export function compareDates(a: LocalDate, b: LocalDate): -1 | 0 | 1 {
  return a === b ? 0 : a < b ? -1 : 1;
}

export function dateRange(from: LocalDate, to: LocalDate): DateRange {
  assertLocalDate(from, 'from');
  assertLocalDate(to, 'to');
  if (to <= from) throw new ValidationError('invalid_date_range', `The end date (${to}) must be after the start date (${from}).`, { from, to });
  return Object.freeze({ from, to });
}

/** Each night in a stay range: [arrival, departure) → arrival … departure-1. */
export function eachNight(range: DateRange): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = range.from; d < range.to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function nightsCount(range: DateRange): number {
  return diffDays(range.from, range.to);
}

export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.from < b.to && b.from < a.to;
}

export function rangeContains(range: DateRange, d: LocalDate): boolean {
  return d >= range.from && d < range.to;
}

/** Calendar date of an instant in a given IANA time zone (e.g. 'Indian/Maldives'). */
export function localDateIn(instant: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
  return parts; // en-CA formats as YYYY-MM-DD
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Age in whole years on a given date. */
export function ageOn(birthDate: LocalDate, on: LocalDate): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [oy, om, od] = on.split('-').map(Number) as [number, number, number];
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age--;
  return age;
}
