import { addDays, type LocalDate, localDateIn, ValidationError } from '@portico/kernel';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function assertLocalTime(value: string, field = 'time'): string {
  if (!TIME_RE.test(value)) {
    throw new ValidationError('invalid_time', `${field} must be a time of day in HH:MM format (24-hour).`, {
      field,
      value,
    });
  }
  return value;
}

/** Offset (ms) of a time zone from UTC at a given instant: localWallClock − utc. */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `timeZone` shows `date` `time`. For wall-clock times that do not exist
 * (spring-forward gap) the time is shifted forward by the gap (02:30 → 03:30); for ambiguous times (fall-back)
 * the earlier instant is returned. Policies are evaluated in property local time (RES-R20).
 */
export function zonedInstant(date: LocalDate, time: string, timeZone: string): Date {
  assertLocalTime(time);
  const [h, m] = time.split(':').map(Number) as [number, number];
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, mo - 1, d, h, m, 0);
  // Two passes converge for every real-world offset rule.
  let guess = naive - offsetMs(new Date(naive), timeZone);
  const second = naive - offsetMs(new Date(guess), timeZone);
  if (second !== guess) {
    // Fall-back ambiguity or gap: prefer the earlier valid instant that maps to the requested wall time.
    const candidate = Math.min(guess, second);
    guess =
      localWallClock(new Date(candidate), timeZone) === `${date}T${time}`
        ? candidate
        : Math.max(guess, second);
  }
  return new Date(guess);
}

function localWallClock(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Local calendar date and HH:MM of an instant in a property's time zone. */
export function localDateTime(instant: Date, timeZone: string): { date: LocalDate; time: string } {
  const s = localWallClock(instant, timeZone);
  return { date: localDateIn(instant, timeZone), time: s.slice(11, 16) };
}

/** Deadline instant for "N days before arrival at HH:MM local". */
export function deadlineBeforeArrival(
  arrival: LocalDate,
  daysBefore: number,
  time: string,
  timeZone: string,
): Date {
  return zonedInstant(addDays(arrival, -daysBefore), time, timeZone);
}
