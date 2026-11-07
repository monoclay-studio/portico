/**
 * Scheduler time rules (DCL-R05, EC-DCL-024): a schedule time belongs to a business date D. Times before noon fall
 * after midnight (calendar day D+1, e.g. 02:00); times from noon fall on D itself (e.g. 23:30). In a DST gap the
 * next valid local minute is used (kernel `zonedTimeToInstant`). Retries of transient failures: 3 × 5 minutes.
 */
import { addDays, type LocalDate, zonedTimeToInstant } from '@portico/kernel';

export const RETRY_LIMIT = 3;
export const RETRY_DELAY_MS = 5 * 60_000;

export function scheduledInstant(businessDate: LocalDate, localTime: string, timeZone: string): Date {
  const hour = Number(localTime.slice(0, 2));
  const calendarDay = hour < 12 ? addDays(businessDate, 1) : businessDate;
  return zonedTimeToInstant(calendarDay, localTime, timeZone);
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
