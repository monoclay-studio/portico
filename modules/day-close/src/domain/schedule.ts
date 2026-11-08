/**
 * Scheduler time rules (DCL-R05, EC-DCL-024): a schedule time belongs to a business date D. Times before noon fall
 * after midnight (calendar day D+1, e.g. 02:00); times from noon fall on D itself (e.g. 23:30). The instant is the
 * first instant whose local wall time on that calendar day is at or after the configured time (review P2-1):
 * - in a spring-forward gap, the end of the gap (New York 02:30 → 03:00 EDT; Lord Howe 02:15 → 02:30);
 * - in a fall-back overlap, the EARLIER of the two occurrences (London 01:30 on the last Sunday of October → 01:30 BST).
 * Computed directly from the offsets either side of the date, never by correcting a guess in one direction.
 * Retries of transient failures: 3 × 5 minutes.
 */
import { addDays, instantToZoned, type LocalDate } from '@portico/kernel';

export const RETRY_LIMIT = 3;
export const RETRY_DELAY_MS = 5 * 60_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function scheduledInstant(businessDate: LocalDate, localTime: string, timeZone: string): Date {
  const hour = Number(localTime.slice(0, 2));
  const calendarDay = hour < 12 ? addDays(businessDate, 1) : businessDate;
  return firstInstantAtOrAfter(calendarDay, localTime, timeZone);
}

/** Minutes the zone is ahead of UTC at an instant (minute precision, from the zone's own wall clock). */
function offsetMs(instant: Date, timeZone: string): number {
  const z = instantToZoned(instant, timeZone);
  const wall = Date.parse(`${z.date}T${z.time}:00Z`);
  return wall - Math.floor(instant.getTime() / MINUTE) * MINUTE;
}

const wallKey = (instant: Date, timeZone: string): string => {
  const z = instantToZoned(instant, timeZone);
  return `${z.date}T${z.time}`;
};

/**
 * The first instant whose local wall time (in `timeZone`) is at or after `localTime` on `date`. Valid local times map
 * to their instant (the earlier one in an overlap); a time inside a gap maps to the instant the gap ends.
 */
export function firstInstantAtOrAfter(date: LocalDate, localTime: string, timeZone: string): Date {
  const target = `${date}T${localTime}`;
  const wall = Date.parse(`${target}:00Z`);
  // Offsets a day either side bracket at most one transition (zones change offset at most twice a year).
  const before = offsetMs(new Date(wall - 24 * HOUR), timeZone);
  const after = offsetMs(new Date(wall + 24 * HOUR), timeZone);
  const candidates = [...new Set([wall - before, wall - after])]
    .sort((a, b) => a - b)
    .filter((c) => wallKey(new Date(c), timeZone) === target);
  if (candidates.length) return new Date(candidates[0] as number); // the earlier occurrence in an overlap
  // In a gap: binary-search (minute precision) the first instant whose wall time is at or after the target. Between
  // the two candidates the wall clock only jumps forward, so the predicate is monotone there.
  let lo = Math.min(wall - before, wall - after) - HOUR;
  let hi = Math.max(wall - before, wall - after) + HOUR;
  while (hi - lo > MINUTE) {
    const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE;
    if (wallKey(new Date(mid), timeZone) >= target) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
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
