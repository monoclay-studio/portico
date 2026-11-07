import type { TxContext } from '@portico/db';
import { type DomainEvent, type EmitEventInput, zonedTimeToInstant } from '@portico/kernel';
import type { StayEventInfo } from '../contracts';
import { RESERVATIONS_EVENTS as E } from '../events';
import { db, parseNights } from './context';

export type { StayEventInfo } from '../contracts';

const BOOKING_EVENTS: ReadonlySet<string> = new Set([
  E.bookingCreated,
  E.bookingStatusChanged,
  E.bookingConfirmed,
  E.bookingModified,
  E.bookingCancelled,
]);
const STAY_EVENTS: ReadonlySet<string> = new Set([
  E.stayCheckedIn,
  E.stayCheckedOut,
  E.stayMoved,
  E.stayExtended,
  E.stayShortened,
  E.stayNoShow,
  E.stayRelocationRequired,
  E.stayWaitlistAvailable,
]);

function vipLevel(tags: readonly string[]): string | null {
  for (const t of tags) {
    const lower = t.toLowerCase();
    if (lower === 'vip') return 'vip';
    if (lower.startsWith('vip:')) return t.slice(4);
  }
  return null;
}

export async function staysForEvent(
  tx: TxContext,
  scope: { bookingId: string } | { stayId: string },
): Promise<{ stays: StayEventInfo[]; bookingVersion: number | null; stayVersion: number | null }> {
  let q = db(tx).selectFrom('reservations.stays').selectAll().orderBy('position');
  q = 'bookingId' in scope ? q.where('booking_id', '=', scope.bookingId) : q.where('id', '=', scope.stayId);
  const stays = await q.execute();
  if (stays.length === 0) return { stays: [], bookingVersion: null, stayVersion: null };
  const booking = await db(tx)
    .selectFrom('reservations.bookings')
    .select(['tags', 'special_requests', 'property_timezone', 'version'])
    .where('id', '=', (stays[0] as { booking_id: string }).booking_id)
    .executeTakeFirstOrThrow();
  const segments = await db(tx)
    .selectFrom('reservations.stay_segments')
    .select(['stay_id', 'nights', 'unit_type_id', 'unit_id', 'adults', 'children_ages'])
    .where(
      'stay_id',
      'in',
      stays.map((s) => s.id),
    )
    .execute();
  const level = vipLevel(booking.tags);
  const out = stays.map((s) => {
    const segs = segments
      .filter((g) => g.stay_id === s.id)
      .map((g) => ({ ...g, ...parseNights(g.nights) }))
      .sort((a, b) => (a.from < b.from ? -1 : 1));
    const first = segs[0];
    const requests = (s.requests ?? []) as Array<{ status: string }>;
    const early = s.early_check_in as { time?: string } | null;
    const late = s.late_check_out as { time?: string } | null;
    return {
      stayId: s.id,
      bookingId: s.booking_id,
      propertyId: s.property_id,
      status: s.status as StayEventInfo['status'],
      commercialType: s.commercial_type as StayEventInfo['commercialType'],
      unitTypeId: first?.unit_type_id ?? null,
      unitId: first?.unit_id ?? null,
      arrival: s.arrival,
      departure: s.departure,
      eta: s.eta ? zonedTimeToInstant(s.arrival, s.eta, booking.property_timezone).toISOString() : null,
      etaLocal: s.eta,
      etdLocal: s.etd,
      earlyCheckIn: Boolean(early?.time),
      earlyCheckInTime: early?.time ?? null,
      lateCheckOut: Boolean(late?.time),
      lateCheckOutTime: late?.time ?? null,
      vip: level !== null,
      vipLevel: level,
      occupants: {
        adults: first?.adults ?? 0,
        children: first?.children_ages.length ?? 0,
        childrenAges: first?.children_ages ?? [],
      },
      requests: {
        open: requests.filter((r) => r.status === 'open').length,
        total: requests.length,
        bookingSpecialRequests: ((booking.special_requests ?? []) as unknown[]).length,
      },
    };
  });
  return {
    stays: out,
    bookingVersion: booking.version,
    stayVersion: 'stayId' in scope ? (stays[0]?.version ?? null) : null,
  };
}

/**
 * Emit a reservations event. Booking and stay events carry `stays[]` (payload version 2; all version-1 fields
 * kept). Other events pass through unchanged.
 */
export async function emitReservationEvent<T extends Record<string, unknown>>(
  tx: TxContext,
  input: EmitEventInput<T>,
): Promise<DomainEvent<T & { stays?: StayEventInfo[] }>> {
  const p = input.payload as Record<string, unknown>;
  let facts: Awaited<ReturnType<typeof staysForEvent>> | null = null;
  if (BOOKING_EVENTS.has(input.type) && typeof p.bookingId === 'string') {
    facts = await staysForEvent(tx, { bookingId: p.bookingId });
  } else if (STAY_EVENTS.has(input.type) && typeof p.stayId === 'string') {
    facts = await staysForEvent(tx, { stayId: p.stayId });
  }
  if (!facts) return tx.emit(input) as Promise<DomainEvent<T & { stays?: StayEventInfo[] }>>;
  // aggregateVersion lets state-deriving consumers ignore late events (kernel isNewerThan).
  const aggregateVersion = BOOKING_EVENTS.has(input.type) ? facts.bookingVersion : facts.stayVersion;
  return tx.emit({
    ...input,
    version: 2,
    ...(aggregateVersion !== null ? { aggregateVersion } : {}),
    payload: { ...input.payload, stays: facts.stays },
  });
}
