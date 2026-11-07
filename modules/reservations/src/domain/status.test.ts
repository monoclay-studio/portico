import { describe, expect, it } from 'vitest';
import {
  assertBookingTransition,
  assertStayTransition,
  BOOKING_STATUSES,
  bookingShouldComplete,
  canTransitionBooking,
  canTransitionStay,
  inventoryEffect,
  STAY_STATUSES,
  stayConsumes,
} from './status';

describe('booking status machine (spec §4.2)', () => {
  it.each([
    ['inquiry', 'quoted'],
    ['quoted', 'quoted'],
    ['quoted', 'held'],
    ['quoted', 'confirmed'],
    ['held', 'tentative'],
    ['held', 'expired'],
    ['tentative', 'confirmed'],
    ['confirmed', 'cancelled'],
    ['confirmed', 'completed'],
    ['cancelled', 'confirmed'],
  ] as const)('allows %s → %s', (from, to) => expect(canTransitionBooking(from, to)).toBe(true));

  it.each([
    ['inquiry', 'confirmed'],
    ['held', 'quoted'],
    ['confirmed', 'tentative'],
    ['completed', 'confirmed'],
    ['declined', 'quoted'],
    ['expired', 'confirmed'],
  ] as const)('refuses %s → %s with an explanation', (from, to) => {
    expect(canTransitionBooking(from, to)).toBe(false);
    expect(() => assertBookingTransition(from, to)).toThrow(/cannot become/);
  });

  it('final statuses have no way out', () => {
    for (const s of ['declined', 'expired', 'completed'] as const) {
      for (const to of BOOKING_STATUSES) expect(canTransitionBooking(s, to)).toBe(false);
    }
  });

  it('maps statuses to inventory effects (RES-R08)', () => {
    expect(inventoryEffect('quoted')).toBe('none');
    expect(inventoryEffect('held')).toBe('hold');
    expect(inventoryEffect('tentative')).toBe('consume');
    expect(inventoryEffect('confirmed')).toBe('consume');
    expect(inventoryEffect('cancelled')).toBe('released');
  });
});

describe('stay status machine (spec §4.3)', () => {
  it('follows the transition table', () => {
    expect(canTransitionStay('expected', 'in_house')).toBe(true);
    expect(canTransitionStay('expected', 'no_show')).toBe(true);
    expect(canTransitionStay('in_house', 'departed')).toBe(true);
    expect(canTransitionStay('in_house', 'cancelled')).toBe(false);
    expect(canTransitionStay('departed', 'expected')).toBe(false);
    expect(canTransitionStay('waitlisted', 'in_house')).toBe(false);
    expect(() => assertStayTransition('departed', 'no_show')).toThrow(/cannot become no show/);
  });

  it('only expected and in-house stays consume inventory (RES-I02)', () => {
    expect(STAY_STATUSES.filter(stayConsumes)).toEqual(['expected', 'in_house']);
  });

  it('completes a confirmed booking only when every stay is terminal and someone stayed or no-showed', () => {
    expect(bookingShouldComplete('confirmed', ['departed', 'cancelled'])).toBe(true);
    expect(bookingShouldComplete('confirmed', ['departed', 'in_house'])).toBe(false);
    expect(bookingShouldComplete('confirmed', ['cancelled'])).toBe(false);
    expect(bookingShouldComplete('tentative', ['departed'])).toBe(false);
  });
});
