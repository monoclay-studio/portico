import { BusinessRuleError } from '@portico/kernel';

/**
 * Booking status and stay status are SEPARATE machines (glossary; spec RES-R07). Neither encodes occupancy,
 * unit condition, availability or payment status.
 */
export const BOOKING_STATUSES = [
  'inquiry',
  'quoted',
  'held',
  'tentative',
  'confirmed',
  'cancelled',
  'declined',
  'expired',
  'completed',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const STAY_STATUSES = [
  'expected',
  'in_house',
  'departed',
  'cancelled',
  'no_show',
  'waitlisted',
] as const;
export type StayStatus = (typeof STAY_STATUSES)[number];

/** Spec §4.2. `quoted → quoted` is a re-quote. `cancelled → confirmed` is a reinstatement (permissioned). */
const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  inquiry: ['quoted', 'declined', 'expired'],
  quoted: ['quoted', 'held', 'tentative', 'confirmed', 'declined', 'expired'],
  held: ['tentative', 'confirmed', 'cancelled', 'expired'],
  tentative: ['confirmed', 'cancelled', 'expired'],
  confirmed: ['cancelled', 'completed'],
  cancelled: ['confirmed'],
  declined: [],
  expired: [],
  completed: [],
};

/** Spec §4.3. */
const STAY_TRANSITIONS: Record<StayStatus, readonly StayStatus[]> = {
  waitlisted: ['expected', 'cancelled'],
  expected: ['in_house', 'cancelled', 'no_show', 'waitlisted'],
  in_house: ['expected', 'departed'],
  departed: ['in_house'],
  cancelled: ['expected'],
  no_show: ['expected'],
};

export function canTransitionBooking(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

export function canTransitionStay(from: StayStatus, to: StayStatus): boolean {
  return STAY_TRANSITIONS[from].includes(to);
}

const BOOKING_LABEL: Record<BookingStatus, string> = {
  inquiry: 'an inquiry',
  quoted: 'quoted',
  held: 'held',
  tentative: 'tentative',
  confirmed: 'confirmed',
  cancelled: 'cancelled',
  declined: 'declined',
  expired: 'expired',
  completed: 'completed',
};

export function assertBookingTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransitionBooking(from, to)) {
    const allowed = BOOKING_TRANSITIONS[from];
    throw new BusinessRuleError(
      'invalid_booking_transition',
      `This booking is ${BOOKING_LABEL[from]}, so it cannot become ${to}. ${
        allowed.length
          ? `From here it can become: ${allowed.join(', ')}.`
          : 'It is final; create a new booking instead.'
      }`,
      { from, to, allowed },
    );
  }
}

export function assertStayTransition(from: StayStatus, to: StayStatus): void {
  if (!canTransitionStay(from, to)) {
    const allowed = STAY_TRANSITIONS[from];
    throw new BusinessRuleError(
      'invalid_stay_transition',
      `This stay is ${from.replace('_', ' ')}, so it cannot become ${to.replace('_', ' ')}. ${
        allowed.length ? `From here it can become: ${allowed.join(', ')}.` : ''
      }`.trim(),
      { from, to, allowed },
    );
  }
}

/** Inventory effect by booking status (RES-R08). */
export function inventoryEffect(status: BookingStatus): 'none' | 'hold' | 'consume' | 'released' {
  switch (status) {
    case 'inquiry':
    case 'quoted':
      return 'none';
    case 'held':
      return 'hold';
    case 'tentative':
    case 'confirmed':
    case 'completed':
      return 'consume';
    case 'cancelled':
    case 'declined':
    case 'expired':
      return 'released';
  }
}

/** Stay statuses that hold inventory when the booking consumes (RES-I02). */
export function stayConsumes(status: StayStatus): boolean {
  return status === 'expected' || status === 'in_house';
}

export function isTerminalStay(status: StayStatus): boolean {
  return status === 'departed' || status === 'cancelled' || status === 'no_show';
}

export function isFinalBooking(status: BookingStatus): boolean {
  return status === 'declined' || status === 'expired' || status === 'completed';
}

/** A confirmed booking completes when every stay is terminal (departed / cancelled / no-show). */
export function bookingShouldComplete(status: BookingStatus, stayStatuses: readonly StayStatus[]): boolean {
  return (
    status === 'confirmed' &&
    stayStatuses.length > 0 &&
    stayStatuses.every(isTerminalStay) &&
    stayStatuses.some((s) => s === 'departed' || s === 'no_show')
  );
}
