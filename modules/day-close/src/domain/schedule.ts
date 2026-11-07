/**
 * Scheduler time rules (DCL-R05, EC-DCL-024): a schedule time belongs to a business date D. Times before noon fall
 * after midnight (calendar day D+1, e.g. 02:00); times from noon fall on D itself (e.g. 23:30). In a DST gap the
 * next valid local minute is used (kernel `zonedTimeToInstant`). Retries of transient failures: 3 × 5 minutes.
 */
import { addDays, instantToZoned, type LocalDate, zonedTimeToInstant } from '@portico/kernel';

export const RETRY_LIMIT = 3;
export const RETRY_DELAY_MS = 5 * 60_000;

export function scheduledInstant(businessDate: LocalDate, localTime: string, timeZone: string): Date {
  const hour = Number(localTime.slice(0, 2));
  const calendarDay = hour < 12 ? addDays(businessDate, 1) : businessDate;
  return nextValidLocalMinute(calendarDay, localTime, timeZone);
}

/**
 * The instant of `localTime` on `date`; when that local time does not exist (spring-forward gap) the first local
 * minute after the gap (e.g. 01:30 on a 01:00 → 02:00 night runs at 02:00).
 */
export function nextValidLocalMinute(date: LocalDate, localTime: string, timeZone: string): Date {
  let t = zonedTimeToInstant(date, localTime, timeZone);
  const z = instantToZoned(t, timeZone);
  if (z.date === date && z.time === localTime) return t;
  for (let i = 0; i < 24 * 60; i++) {
    const prev = new Date(t.getTime() - 60_000);
    const pz = instantToZoned(prev, timeZone);
    if (pz.date < date || (pz.date === date && pz.time < localTime)) break;
    t = prev;
  }
  return t;
}

/** The earliest instant a run for D may start (EC-DCL-026); null when the policy sets no limit. */
export function earliestStart(
  businessDate: LocalDate,
  earliestLocalTime: string | null,
  timeZone: string,
): Date | null {
  if (!earliestLocalTime) return null;
  return scheduledInstant(businessDate, earliestLocalTime, timeZone);
}

/** Next automatic retry for a transient failure; null when the limit is reached or the failure is not transient. */
export function nextRetryAt(
  now: Date,
  retryCount: number,
  failure: { retryable: boolean; integrity?: boolean },
): Date | null {
  if (!failure.retryable || failure.integrity) return null;
  if (retryCount >= RETRY_LIMIT) return null;
  return new Date(now.getTime() + RETRY_DELAY_MS);
}
