import { describe, expect, it } from 'vitest';
import {
  cellKey,
  describeRange,
  intersectRanges,
  lockOrder,
  nightsOfRange,
  nightsToRuns,
  rangeCovers,
  spanOf,
  subtractRange,
} from './ranges';

describe('night ranges', () => {
  it('lists the nights of a half-open range (departure night excluded)', () => {
    expect(nightsOfRange({ from: '2026-11-10', to: '2026-11-13' })).toEqual([
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
    ]);
  });

  it('crosses month, year and leap-day boundaries', () => {
    expect(nightsOfRange({ from: '2026-12-30', to: '2027-01-02' })).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ]);
    expect(nightsOfRange({ from: '2028-02-28', to: '2028-03-01' })).toEqual(['2028-02-28', '2028-02-29']);
  });

  it('rejects zero-night, reversed, malformed and over-long ranges with explanations', () => {
    expect(() => nightsOfRange({ from: '2026-11-10', to: '2026-11-10' })).toThrow(/at least one night/);
    expect(() => nightsOfRange({ from: '2026-11-12', to: '2026-11-10' })).toThrow(/after the arrival/);
    expect(() => nightsOfRange({ from: '2026-02-30', to: '2026-03-02' })).toThrow(/YYYY-MM-DD/);
    expect(() => nightsOfRange({ from: '2026-01-01', to: '2026-03-01' }, 10)).toThrow(/at most 10/);
  });

  it('groups nights into contiguous runs regardless of order and duplicates', () => {
    expect(nightsToRuns(['2026-11-12', '2026-11-10', '2026-11-11', '2026-11-11', '2026-11-15'])).toEqual([
      { from: '2026-11-10', to: '2026-11-13' },
      { from: '2026-11-15', to: '2026-11-16' },
    ]);
    expect(nightsToRuns([])).toEqual([]);
  });

  it('intersects and subtracts ranges', () => {
    const a = { from: '2026-11-10', to: '2026-11-20' };
    expect(intersectRanges(a, { from: '2026-11-18', to: '2026-11-25' })).toEqual({
      from: '2026-11-18',
      to: '2026-11-20',
    });
    expect(intersectRanges(a, { from: '2026-11-20', to: '2026-11-25' })).toBeNull();
    expect(subtractRange(a, { from: '2026-11-12', to: '2026-11-14' })).toEqual([
      { from: '2026-11-10', to: '2026-11-12' },
      { from: '2026-11-14', to: '2026-11-20' },
    ]);
    expect(subtractRange(a, { from: '2026-11-01', to: '2026-11-30' })).toEqual([]);
    expect(subtractRange(a, { from: '2026-12-01', to: '2026-12-02' })).toEqual([a]);
    expect(rangeCovers(a, { from: '2026-11-10', to: '2026-11-20' })).toBe(true);
    expect(rangeCovers(a, { from: '2026-11-09', to: '2026-11-20' })).toBe(false);
  });

  it('orders cells deterministically by (unit type, night) and deduplicates', () => {
    const cells = lockOrder([
      { unitTypeId: 'b', night: '2026-11-10' },
      { unitTypeId: 'a', night: '2026-11-11' },
      { unitTypeId: 'a', night: '2026-11-10' },
      { unitTypeId: 'b', night: '2026-11-10' },
    ]);
    expect(cells.map((c) => cellKey(c.unitTypeId, c.night))).toEqual([
      'a|2026-11-10',
      'a|2026-11-11',
      'b|2026-11-10',
    ]);
  });

  it('computes the span of nights for coalescible events and describes ranges', () => {
    expect(spanOf(['2026-11-12', '2026-11-10'])).toEqual({ from: '2026-11-10', to: '2026-11-13' });
    expect(spanOf([])).toBeNull();
    expect(describeRange({ from: '2026-11-10', to: '2026-11-11' })).toBe('night of 2026-11-10');
    expect(describeRange({ from: '2026-11-10', to: '2026-11-13' })).toBe('nights 2026-11-10 to 2026-11-12');
  });
});
