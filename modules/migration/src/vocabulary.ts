/**
 * Migration's own vocabularies, dependency-free so the web apps can import them through `contracts.ts`.
 * (Shared vocabularies — provenance, environment, data-authority domains — are imported from their owners.)
 */

/** Entity classes a migration moves, in import (dependency) order. */
export const DATA_CLASSES = [
  'unit_type',
  'unit',
  'rate_plan',
  'guest',
  'reservation',
  'deposit',
  'in_house_balance',
  'ar_open_item',
] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/**
 * Source booking statuses after normalization. Migration's own vocabulary for what the SOURCE said; the reservations
 * import contract (MIG-CR-1) maps it onto reservations' booking and stay status families.
 */
export const BOOKING_STATUSES = [
  'confirmed',
  'tentative',
  'in_house',
  'departed',
  'cancelled',
  'no_show',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const RECORD_STATES = [
  'imported',
  'merged',
  'rejected',
  'excluded',
  'exception',
  'suggested',
  'pending',
] as const;
export type RecordState = (typeof RECORD_STATES)[number];

export const EXCEPTION_STATUSES = [
  'open',
  'in_progress',
  'resolved',
  'accepted_as_loss',
  'deferred',
  'excluded',
] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];
