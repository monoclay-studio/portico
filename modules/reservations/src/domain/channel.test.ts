import { describe, expect, it } from 'vitest';
import type { CanonicalChannelBooking } from '../contracts';
import { compareRevision, detectFieldLosses } from './channel';
import { diffValues } from './diff';

const base: CanonicalChannelBooking = {
  status: 'confirmed',
  propertyId: '00000000-0000-7000-8000-000000000001',
  currency: 'USD',
  booker: { firstName: 'Lena', lastName: 'Hoffmann' },
  rooms: [
    {
      roomRef: 'R1',
      unitTypeId: '00000000-0000-7000-8000-000000000002',
      ratePlanId: '00000000-0000-7000-8000-000000000003',
      arrival: '2026-12-10',
      departure: '2026-12-13',
      adults: 2,
      childrenAges: [],
      guests: [
        { firstName: 'Lena', lastName: 'Hoffmann' },
        { firstName: 'Max', lastName: 'Hoffmann' },
      ],
      nightlyPrices: [],
      specialRequests: ['Late arrival by seaplane'],
    },
  ],
  guarantee: { kind: 'prepaid_channel' },
  amountsIncludeTax: false,
  specialRequests: ['Honeymoon'],
  marketSegment: 'ota',
};

describe('channel revisions (RES-R30/R31)', () => {
  it('orders revisions', () => {
    expect(compareRevision(1, null)).toBe('first');
    expect(compareRevision(3, 2)).toBe('newer');
    expect(compareRevision(2, 2)).toBe('same');
    expect(compareRevision(1, 2)).toBe('older');
  });

  it('flags information a full-replacement modification silently dropped', () => {
    const next: CanonicalChannelBooking = {
      ...base,
      specialRequests: [],
      rooms: [
        {
          ...(base.rooms[0] as CanonicalChannelBooking['rooms'][number]),
          departure: '2026-12-14',
          specialRequests: [],
          guests: [{ firstName: 'Lena', lastName: 'Hoffmann' }],
        },
      ],
    };
    const losses = detectFieldLosses(base, next);
    expect(losses.map((l) => [l.kind, l.lost])).toEqual([
      ['special_request', 'Honeymoon'],
      ['special_request', 'Late arrival by seaplane'],
      ['occupant', { firstName: 'Max', lastName: 'Hoffmann' }],
    ]);
    expect(detectFieldLosses(base, { ...base, rooms: [] })).toEqual([
      expect.objectContaining({ kind: 'room' }),
    ]);
    expect(detectFieldLosses(base, base)).toEqual([]);
  });

  it('diffs field by field', () => {
    expect(
      diffValues({ a: 1, b: [1, 2], c: { d: 'x' } }, { a: 1, b: [1, 3], c: { d: 'y' }, e: true }),
    ).toEqual([
      { path: 'b[1]', from: 2, to: 3 },
      { path: 'c.d', from: 'x', to: 'y' },
      { path: 'e', from: null, to: true },
    ]);
  });
});
