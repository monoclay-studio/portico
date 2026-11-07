/**
 * Outlet opening hours: per ISO weekday (1 = Monday … 7 = Sunday) one or more intervals in property-local time.
 * An interval whose close is earlier than (or equal to) its open crosses midnight (e.g. a bar 18:00–01:00 is open
 * from Friday 18:00 until Saturday 01:00 and belongs to Friday).
 */
export interface OpeningInterval {
  day: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  opens: string; // HH:MM
  closes: string; // HH:MM; '24:00' allowed for end of day
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function minutes(hhmm: string): number {
  if (hhmm === '24:00') return 1440;
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Expand into minute ranges on a 7-day week clock (0 = Monday 00:00), splitting at the week boundary. */
function weekRanges(i: OpeningInterval): Array<[number, number]> {
  const start = (i.day - 1) * 1440 + minutes(i.opens);
  let end = (i.day - 1) * 1440 + minutes(i.closes);
  if (minutes(i.closes) <= minutes(i.opens)) end += 1440;
  const week = 7 * 1440;
  return end <= week
    ? [[start, end]]
    : [
        [start, week],
        [0, end - week],
      ];
}

export function validateOpeningHours(intervals: readonly OpeningInterval[]): string[] {
  const problems: string[] = [];
  for (const i of intervals) {
    if (!HHMM.test(i.opens)) problems.push(`Opening time "${i.opens}" must be HH:MM (00:00–23:59).`);
    if (!HHMM.test(i.closes) && i.closes !== '24:00')
      problems.push(`Closing time "${i.closes}" must be HH:MM (00:00–24:00).`);
    if (i.opens === i.closes)
      problems.push(`Day ${i.day}: an interval cannot open and close at the same time.`);
  }
  if (problems.length) return problems;
  const ranges = intervals.flatMap((i) => weekRanges(i).map((r) => ({ r, i })));
  ranges.sort((a, b) => a.r[0] - b.r[0]);
  for (let k = 1; k < ranges.length; k++) {
    const prev = ranges[k - 1];
    const cur = ranges[k];
    if (prev && cur && cur.r[0] < prev.r[1]) {
      problems.push(
        `Intervals overlap: day ${prev.i.day} ${prev.i.opens}–${prev.i.closes} and day ${cur.i.day} ${cur.i.opens}–${cur.i.closes}.`,
      );
    }
  }
  return problems;
}

/** Is the outlet open at a property-local weekday and time? */
export function isOpenAt(intervals: readonly OpeningInterval[], isoWeekday: number, hhmm: string): boolean {
  const t = (isoWeekday - 1) * 1440 + minutes(hhmm);
  return intervals.some((i) => weekRanges(i).some(([s, e]) => t >= s && t < e));
}
