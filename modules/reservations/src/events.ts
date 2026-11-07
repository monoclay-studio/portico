/**
 * Events emitted by reservations (domain map + spec §7 proposed). Payloads carry ids, never PII.
 * Consumers must be idempotent (dedupe by event id).
 */
export const RESERVATIONS_EVENTS = {
  bookingCreated: 'reservations.booking.created',
  bookingStatusChanged: 'reservations.booking.statusChanged',
  bookingConfirmed: 'reservations.booking.confirmed',
  bookingModified: 'reservations.booking.modified',
  bookingCancelled: 'reservations.booking.cancelled',
  stayCheckedIn: 'reservations.stay.checkedIn',
  stayCheckedOut: 'reservations.stay.checkedOut',
  stayMoved: 'reservations.stay.moved',
  stayExtended: 'reservations.stay.extended',
  stayShortened: 'reservations.stay.shortened',
  stayNoShow: 'reservations.stay.noShow',
  stayRelocationRequired: 'reservations.stay.relocationRequired',
  stayWaitlistAvailable: 'reservations.stay.waitlistAvailable',
  checkInStepFailed: 'reservations.checkIn.stepFailed',
  handoverPublished: 'reservations.handover.published',
  handoverAcknowledged: 'reservations.handover.acknowledged',
  channelFieldLoss: 'reservations.channelRevision.fieldLoss',
  forwardedChangeCreated: 'reservations.forwardedChange.created',
} as const;

export type ReservationsEventType = (typeof RESERVATIONS_EVENTS)[keyof typeof RESERVATIONS_EVENTS];

/** Events from other modules that reservations consumes (see subscriptions.ts). */
export const CONSUMED_EVENTS = {
  inventoryUnitBlocked: 'inventory.unit.blocked',
  inventoryAvailabilityChanged: 'inventory.availability.changed',
  guestsProfileMerged: 'guests.profile.merged',
  guestsProfileUnmerged: 'guests.profile.unmerged',
} as const;

export interface StayMovedPayload extends Record<string, unknown> {
  stayId: string;
  bookingId: string;
  fromUnitId: string | null;
  toUnitId: string | null;
  fromDate: string;
  reason: string;
}

export interface BookingEventPayload extends Record<string, unknown> {
  bookingId: string;
  code: string;
  status: string;
  stayIds: string[];
}
