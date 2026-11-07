import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest } from '@portico/kernel';

/** Permission keys (spec §8). Sensitive ones (⚑) are highlighted in role editors. */
export const RESERVATIONS_PERMISSIONS = {
  bookingRead: 'reservations.booking.read',
  bookingCreate: 'reservations.booking.create',
  bookingUpdate: 'reservations.booking.update',
  bookingCancel: 'reservations.booking.cancel',
  bookingWaivePenalty: 'reservations.booking.waivePenalty',
  bookingReinstate: 'reservations.booking.reinstate',
  bookingOverbook: 'reservations.booking.overbook',
  stayCheckIn: 'reservations.stay.checkIn',
  stayCheckOut: 'reservations.stay.checkOut',
  stayCheckoutWithBalance: 'reservations.stay.checkoutWithBalance',
  stayMove: 'reservations.stay.move',
  stayComplimentary: 'reservations.stay.complimentary',
  stayHouseUse: 'reservations.stay.houseUse',
  staySkipCheckInStep: 'reservations.stay.skipCheckInStep',
  stayNoShow: 'reservations.stay.noShow',
  channelIngest: 'reservations.channelBooking.ingest',
  channelOverride: 'reservations.channelBooking.overrideLocally',
  relocationManage: 'reservations.relocation.manage',
  handoverManage: 'reservations.handover.manage',
  waitlistManage: 'reservations.waitlist.manage',
  forwardAcknowledge: 'reservations.forwardedChange.acknowledge',
} as const;

const P = RESERVATIONS_PERMISSIONS;

export const reservationsManifest: ModuleManifest = {
  name: 'reservations',
  schema: 'reservations',
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
  permissions: [
    { key: P.bookingRead, description: 'View bookings, stays and front-desk lists', scope: 'property' },
    {
      key: P.bookingCreate,
      description: 'Quote, hold and create bookings (incl. walk-ins)',
      scope: 'property',
    },
    { key: P.bookingUpdate, description: 'Change bookings and stays (previewed changes)', scope: 'property' },
    { key: P.bookingCancel, description: 'Cancel bookings and stays', scope: 'property' },
    {
      key: P.bookingWaivePenalty,
      description: 'Waive cancellation / no-show penalties',
      scope: 'property',
      sensitive: true,
    },
    {
      key: P.bookingReinstate,
      description: 'Reinstate cancelled bookings and no-show stays',
      scope: 'property',
      sensitive: true,
    },
    {
      key: P.bookingOverbook,
      description: 'Sell beyond availability (authorized overbooking for one sale)',
      scope: 'property',
      sensitive: true,
    },
    { key: P.stayCheckIn, description: 'Check guests in', scope: 'property' },
    { key: P.stayCheckOut, description: 'Check guests out', scope: 'property' },
    {
      key: P.stayCheckoutWithBalance,
      description: 'Check out leaving an unsettled balance',
      scope: 'property',
      sensitive: true,
    },
    { key: P.stayMove, description: 'Assign units and move stays between units', scope: 'property' },
    {
      key: P.stayComplimentary,
      description: 'Create complimentary stays',
      scope: 'property',
      sensitive: true,
    },
    { key: P.stayHouseUse, description: 'Create house-use stays', scope: 'property', sensitive: true },
    {
      key: P.staySkipCheckInStep,
      description: 'Skip mandatory check-in/check-out steps with a reason',
      scope: 'property',
      sensitive: true,
    },
    { key: P.stayNoShow, description: 'Mark stays as no-show', scope: 'property' },
    {
      key: P.channelIngest,
      description: 'Deliver channel bookings (integration clients)',
      scope: 'property',
    },
    {
      key: P.channelOverride,
      description: 'Override channel-owned booking fields locally',
      scope: 'property',
      sensitive: true,
    },
    { key: P.relocationManage, description: 'Work relocation cases', scope: 'property' },
    {
      key: P.handoverManage,
      description: 'Write, publish and acknowledge shift handovers',
      scope: 'property',
    },
    { key: P.waitlistManage, description: 'Manage the waitlist', scope: 'property' },
    {
      key: P.forwardAcknowledge,
      description: 'Record acknowledgements of changes forwarded to an external system of record',
      scope: 'property',
    },
  ],
};
