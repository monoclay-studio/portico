import type { TxContext } from '@portico/db';
import type { DomainEvent, EmitEventInput } from '@portico/kernel';
import { RESERVATIONS_EVENTS as E } from '../events';
import { db, parseNights } from './context';

/**
 * Per-stay facts carried by booking and stay events (payload version 2) so consumers — housekeeping priorities,
 * arrival readiness, comms, analytics — need no synchronous call back into reservations. Ids, dates, counts and
 * flags only: no names, contact details or request texts (events are copied into every consumer).
 */
export interface StayEventInfo extends Record<string, unknown> {
  stayId: string;
  bookingId: string;
  propertyId: string;
  status: string;
  commercialType: string;
  unitTypeId: string | null;
  /** Unit for the arrival night (or the current night for in-house stays), if assigned. */
  unitId: string | null;
  arrival: string;
  departure: string;
  /** Expected arrival time (property local, HH:MM) and ETD, when known. */
  eta: string | null;
  etd: string | null;
  earlyCheckIn: { time: string } | null;
  lateCheckOut: { time: string } | null;
  /** Recognition from the booking's tags (`vip`, `vip:<level>`); guests owns the full recognition summary. */
  vipLevel: string | null;
  occupants: { adults: number; children: number; childrenAges: number[] };
  requests: { open: number; total: number; bookingSpecialRequests: number };
}

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
): Promise<StayEventInfo[]> {
  let q = db(tx).selectFrom('reservations.stays').selectAll().orderBy('position');
  q = 'bookingId' in scope ? q.where('booking_id', '=', scope.bookingId) : q.where('id', '=', scope.stayId);
  const stays = await q.execute();
  if (stays.length === 0) return [];
  const booking = await db(tx)
    .selectFrom('reservations.bookings')
    .select(['tags', 'special_requests'])
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
  return stays.map((s) => {
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
      status: s.status,
      commercialType: s.commercial_type,
      unitTypeId: first?.unit_type_id ?? null,
      unitId: first?.unit_id ?? null,
      arrival: s.arrival,
      departure: s.departure,
      eta: s.eta,
      etd: s.etd,
      earlyCheckIn: early?.time ? { time: early.time } : null,
      lateCheckOut: late?.time ? { time: late.time } : null,
      vipLevel: vipLevel(booking.tags),
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
  let stays: StayEventInfo[] | null = null;
  if (BOOKING_EVENTS.has(input.type) && typeof p.bookingId === 'string') {
    stays = await staysForEvent(tx, { bookingId: p.bookingId });
  } else if (STAY_EVENTS.has(input.type) && typeof p.stayId === 'string') {
    stays = await staysForEvent(tx, { stayId: p.stayId });
  }
  if (!stays) return tx.emit(input) as Promise<DomainEvent<T & { stays?: StayEventInfo[] }>>;
  return tx.emit({ ...input, version: 2, payload: { ...input.payload, stays } });
}
