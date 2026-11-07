import { describe, expect, it } from 'vitest';
import {
  addDays,
  ageOn,
  dateRange,
  diffDays,
  eachNight,
  isLocalDate,
  localDateIn,
  rangesOverlap,
} from './dates';
import { isUuid, newId } from './ids';

describe('dates', () => {
  it('validates real calendar dates', () => {
    expect(isLocalDate('2026-02-28')).toBe(true);
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-2-3')).toBe(false);
  });

  it('enumerates nights in a half-open range', () => {
    expect(eachNight(dateRange('2026-12-30', '2027-01-02'))).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ]);
    expect(diffDays('2026-12-30', '2027-01-02')).toBe(3);
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('rejects empty or inverted ranges', () => {
    expect(() => dateRange('2026-01-02', '2026-01-02')).toThrow(/must be after/);
  });

  it('detects overlap of half-open ranges (back-to-back stays do not overlap)', () => {
    expect(rangesOverlap(dateRange('2026-01-01', '2026-01-03'), dateRange('2026-01-03', '2026-01-05'))).toBe(
      false,
    );
    expect(rangesOverlap(dateRange('2026-01-01', '2026-01-04'), dateRange('2026-01-03', '2026-01-05'))).toBe(
      true,
    );
  });

  it('computes local date in a property time zone', () => {
    // 2026-11-07T20:30Z is 01:30 on 8 Nov in the Maldives (UTC+5)
    expect(localDateIn(new Date('2026-11-07T20:30:00Z'), 'Indian/Maldives')).toBe('2026-11-08');
  });

  it('computes ages for child rules', () => {
    expect(ageOn('2014-03-10', '2026-03-09')).toBe(11);
    expect(ageOn('2014-03-10', '2026-03-10')).toBe(12);
  });

  it('generates time-ordered UUIDv7', () => {
    const a = newId(1_700_000_000_000);
    const b = newId(1_700_000_000_001);
    expect(isUuid(a)).toBe(true);
    expect(a[14]).toBe('7');
    expect(a < b).toBe(true);
  });
});

describe('time zones', async () => {
  const { zonedTimeToInstant, instantToZoned, timeZoneOffsetMinutes } = await import('./dates');
  it('converts property-local times (Maldives, no DST)', () => {
    expect(timeZoneOffsetMinutes(new Date('2026-11-07T00:00:00Z'), 'Indian/Maldives')).toBe(300);
    expect(zonedTimeToInstant('2026-12-24', '14:00', 'Indian/Maldives').toISOString()).toBe(
      '2026-12-24T09:00:00.000Z',
    );
    expect(instantToZoned(new Date('2026-12-24T20:30:00Z'), 'Indian/Maldives')).toEqual({
      date: '2026-12-25',
      time: '01:30',
    });
  });
  it('handles DST transitions (Europe/London)', () => {
    expect(zonedTimeToInstant('2026-07-01', '12:00', 'Europe/London').toISOString()).toBe(
      '2026-07-01T11:00:00.000Z',
    );
    expect(zonedTimeToInstant('2026-01-15', '12:00', 'Europe/London').toISOString()).toBe(
      '2026-01-15T12:00:00.000Z',
    );
    // 01:30 does not exist on 2026-03-29 in London (clocks jump 01:00 → 02:00): next valid instant
    expect(
      instantToZoned(zonedTimeToInstant('2026-03-29', '01:30', 'Europe/London'), 'Europe/London').time,
    ).toMatch(/^0[12]:30$/);
  });
});
