import { describe, expect, it } from 'vitest';
import { bookingActions, type StayActionInput, stayActions } from './actions';

const base: StayActionInput = {
  stayStatus: 'expected',
  bookingStatus: 'confirmed',
  arrival: '2026-12-10',
  departure: '2026-12-13',
  businessDate: '2026-12-10',
  unitAssigned: true,
  unitName: 'Villa 214',
  unitReady: true,
  unitCondition: 'inspected',
  checkInInProgress: false,
  checkOutInProgress: false,
  can: () => true,
};
const find = (i: StayActionInput, action: string) => stayActions(i).find((a) => a.action === action);

describe('allowed actions with plain-language reasons (universal record contract)', () => {
  it('enables check-in for a ready arrival', () => {
    expect(find(base, 'checkIn')).toEqual({ action: 'checkIn', label: 'Check in', enabled: true });
  });

  it('explains why check-in is disabled', () => {
    expect(find({ ...base, unitReady: false, unitCondition: 'dirty' }, 'checkIn')).toMatchObject({
      enabled: false,
      reason: 'Villa 214 is dirty and has not passed inspection yet.',
    });
    expect(find({ ...base, unitAssigned: false, unitName: null }, 'checkIn')?.reason).toBe(
      'No unit is assigned yet.',
    );
    expect(find({ ...base, arrival: '2026-12-12' }, 'checkIn')?.reason).toMatch(/due on 2026-12-12/);
    expect(find({ ...base, bookingStatus: 'quoted' }, 'checkIn')?.reason).toMatch(/quoted/);
    expect(find({ ...base, can: (p) => p !== 'checkIn' }, 'checkIn')?.reason).toMatch(/permission/);
  });

  it('marks consequential changes as previewed', () => {
    expect(find(base, 'changeDates')).toMatchObject({ enabled: true, previewRequired: true });
    expect(find({ ...base, unitAssigned: true }, 'moveUnit')).toMatchObject({ previewRequired: true });
    expect(find({ ...base, unitAssigned: false }, 'assignUnit')?.previewRequired).toBeUndefined();
  });

  it('offers the right verbs per stay status', () => {
    const inHouse = stayActions({ ...base, stayStatus: 'in_house' }).map((a) => a.action);
    expect(inHouse).toContain('checkOut');
    expect(inHouse).not.toContain('checkIn');
    expect(find({ ...base, stayStatus: 'in_house' }, 'cancel')).toMatchObject({
      enabled: false,
      reason: expect.stringMatching(/shorten the stay or check out/),
    });
    expect(find({ ...base, businessDate: '2026-12-09' }, 'markNoShow')?.enabled).toBe(false);
    expect(stayActions({ ...base, stayStatus: 'departed' })).toEqual([]);
  });

  it('booking actions follow the booking status', () => {
    const quoted = bookingActions({
      status: 'quoted',
      hasActiveStays: true,
      hasInHouseStays: false,
      can: () => true,
    }).map((a) => a.action);
    expect(quoted).toEqual(['confirm', 'hold', 'markTentative', 'decline', 'addStay', 'edit']);
    const inHouse = bookingActions({
      status: 'confirmed',
      hasActiveStays: false,
      hasInHouseStays: true,
      can: () => true,
    });
    expect(inHouse.find((a) => a.action === 'cancel')).toMatchObject({
      enabled: false,
      reason: expect.stringMatching(/in house/),
    });
  });
});
