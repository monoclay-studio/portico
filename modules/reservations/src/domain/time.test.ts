import { describe, expect, it } from 'vitest';
import { assertLocalTime, deadlineBeforeArrival, localDateTime, zonedInstant } from './time';

describe('property-local deadlines', () => {
  it('converts Maldives local time (UTC+5, no DST)', () => {
    expect(zonedInstant('2026-12-08', '14:00', 'Indian/Maldives').toISOString()).toBe(
      '2026-12-08T09:00:00.000Z',
    );
    expect(zonedInstant('2026-12-08', '00:00', 'Indian/Maldives').toISOString()).toBe(
      '2026-12-07T19:00:00.000Z',
    );
  });

  it('handles DST gaps and overlaps deterministically', () => {
    // 2026-03-08 02:30 does not exist in New York: shifted forward to 03:30 EDT.
    expect(zonedInstant('2026-03-08', '02:30', 'America/New_York').toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    // 2026-11-01 01:30 happens twice: the earlier (EDT) instant is used.
    expect(zonedInstant('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    );
    expect(zonedInstant('2026-07-01', '12:00', 'America/New_York').toISOString()).toBe(
      '2026-07-01T16:00:00.000Z',
    );
  });

  it('computes "N days before arrival at HH:MM local"', () => {
    expect(deadlineBeforeArrival('2026-12-20', 14, '23:59', 'Indian/Maldives').toISOString()).toBe(
      '2026-12-06T18:59:00.000Z',
    );
  });

  it('reports local date and time of an instant', () => {
    expect(localDateTime(new Date('2026-12-07T19:30:00Z'), 'Indian/Maldives')).toEqual({
      date: '2026-12-08',
      time: '00:30',
    });
  });

  it('validates HH:MM', () => {
    expect(() => assertLocalTime('24:00')).toThrow(/HH:MM/);
    expect(assertLocalTime('09:05')).toBe('09:05');
  });
});
