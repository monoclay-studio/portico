/**
 * Events emitted (outbox) and consumed. Consumed payloads are parsed with schemas typed against the producers'
 * exported payload interfaces (compile-time check in test/compat/event-payloads.test.ts).
 */
import { z } from 'zod';

export const DISTRIBUTION_EVENTS = {
  ariAccepted: 'distribution.ari.accepted',
  ariRejected: 'distribution.ari.rejected',
  bookingReceived: 'distribution.booking.received',
  bookingParked: 'distribution.booking.parked',
  bookingRecovered: 'distribution.booking.recovered',
  discrepancyDetected: 'distribution.discrepancy.detected',
  discrepancyResolved: 'distribution.discrepancy.resolved',
  channelDegraded: 'distribution.channel.degraded',
  channelRestored: 'distribution.channel.restored',
  stopSellApplied: 'distribution.stopSell.applied',
  stopSellReleased: 'distribution.stopSell.released',
} as const;

export const CONSUMED_EVENTS = {
  availabilityChanged: 'inventory.availability.changed',
  pricesChanged: 'rates.prices.changed',
  restrictionsChanged: 'rates.restrictions.changed',
  dataAuthorityChanged: 'platform.dataAuthority.changed',
  /** guests' erasure (consumed only when the GuestErasurePort is bound — FR-7). */
  guestAnonymized: 'guests.profile.anonymized',
} as const;

const range = z.object({ from: z.iso.date(), to: z.iso.date() });

/** guests.profile.anonymized (guests' ProfileAnonymizedPayload; equal copy, no import of another module). */
export const guestAnonymizedPayload = z
  .object({ profileId: z.string(), privacyRequestId: z.string(), alsoAnonymized: z.array(z.string()) })
  .loose();

/** inventory.availability.changed (inventory `AvailabilityChangedPayload`). */
export const availabilityChangedPayload = z
  .object({ propertyId: z.uuid(), unitTypeId: z.uuid(), range, coalesceKey: z.string(), cause: z.string() })
  .loose();

/** rates.prices.changed (rates `PricesChangedPayload`). */
export const pricesChangedPayload = z
  .object({
    propertyId: z.uuid(),
    changeSetId: z.string(),
    ratePlanIds: z.array(z.uuid()),
    unitTypeIds: z.array(z.uuid()),
    ranges: z.array(range),
  })
  .loose();

/** rates.restrictions.changed (rates `RestrictionsChangedPayload`): null = every plan / unit type. */
export const restrictionsChangedPayload = z
  .object({
    propertyId: z.uuid(),
    changeSetId: z.string(),
    ratePlanIds: z.array(z.uuid().nullable()),
    unitTypeIds: z.array(z.uuid().nullable()),
    ranges: z.array(range),
  })
  .loose();

/** platform.dataAuthority.changed — only the fields distribution needs. */
export const dataAuthorityChangedPayload = z
  .object({ propertyId: z.uuid(), domain: z.string(), authority: z.string().optional() })
  .loose();
