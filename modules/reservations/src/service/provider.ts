import type { TxContext } from '@portico/db';
import { type LocalDate, type Money, type Occupancy, requirePermission } from '@portico/kernel';
import type { Stay } from '../contracts';
import { RESERVATIONS_PERMISSIONS as P } from '../manifest';
import type { TermsSnapshot } from '../ports';
import { type Deps, db } from './context';
import { bookingPeople } from './guarantee';
import { stayRecordView } from './record';
import { loadBooking, loadSnapshots, loadStay, loadStayRecords, snapshotOf } from './repo';

/** What Day Close needs to post one night of one in-house stay — from the agreed terms only (domain map). */
export interface StayForPosting {
  stayId: string;
  bookingId: string;
  propertyId: string;
  night: LocalDate;
  commercialType: 'standard' | 'complimentary' | 'house_use';
  unitId: string | null;
  unitTypeId: string;
  ratePlanId: string;
  occupancy: Occupancy;
  termsSnapshotId: string;
  terms: TermsSnapshot;
  nightly: { net: Money; taxes: TermsSnapshot['nights'][number]['taxes'] };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Booking directory (provider for payments and finance, integration-step review P1-1): which property owns a
 * booking, or null when this organization has no such booking. Routing metadata only — no names, no money — so it
 * does not check a reservations permission; tenant isolation is enforced by RLS. Money modules use it to refuse a
 * deposit for an unknown booking or a booking of another property before any money moves.
 */
export async function describeBooking(
  _deps: Deps,
  tx: TxContext,
  bookingId: string,
): Promise<{ propertyId: string; status: string } | null> {
  if (!UUID.test(bookingId)) return null;
  const row = await db(tx)
    .selectFrom('reservations.bookings')
    .select(['property_id', 'status'])
    .where('id', '=', bookingId)
    .executeTakeFirst();
  return row ? { propertyId: row.property_id, status: row.status } : null;
}

/**
 * Reference directory for money modules (review P1-1/P1-2): the property that owns a booking or a stay; null when no
 * such record exists in this organization; undefined for reference types reservations does not own.
 */
export async function describeReference(
  _deps: Deps,
  tx: TxContext,
  ref: { type: string; id: string },
): Promise<
  | {
      propertyId: string;
      source?: string;
      channelConnectionId?: string | null;
      bookingId: string;
      people: string[];
    }
  | null
  | undefined
> {
  if (ref.type !== 'booking' && ref.type !== 'stay') return undefined;
  if (!UUID.test(ref.id)) return null;
  const bookingId =
    ref.type === 'booking'
      ? ref.id
      : (
          await db(tx)
            .selectFrom('reservations.stays')
            .select('booking_id')
            .where('id', '=', ref.id)
            .executeTakeFirst()
        )?.booking_id;
  if (!bookingId) return null;
  // Review R2-P1-1: where the booking came from — payments accepts a channel's virtual card only for a booking of that
  // channel connection. Re-review #3: its booking (the collection family) and its people (whose cards a standing
  // card-on-file consent covers).
  const b = await db(tx)
    .selectFrom('reservations.bookings')
    .select(['property_id', 'source', 'channel_connection_id'])
    .where('id', '=', bookingId)
    .executeTakeFirst();
  if (!b) return null;
  return {
    propertyId: b.property_id,
    source: b.source,
    channelConnectionId: b.channel_connection_id,
    bookingId,
    people: [...(await bookingPeople(tx, bookingId))],
  };
}

export async function getStay(deps: Deps, tx: TxContext, stayId: string): Promise<Stay> {
  const stay = await loadStay(tx, stayId);
  requirePermission(tx, P.bookingRead, { propertyId: stay.row.property_id });
  return stayRecordView(deps, tx, await loadBooking(tx, stay.row.booking_id), stayId);
}

/** listInHouseStaysForNight(propertyId, date) — Day Close room posting. */
export async function listInHouseStaysForNight(
  _deps: Deps,
  tx: TxContext,
  input: { propertyId: string; date: LocalDate },
): Promise<StayForPosting[]> {
  requirePermission(tx, P.bookingRead, { propertyId: input.propertyId });
  const rows = await db(tx)
    .selectFrom('reservations.stays')
    .selectAll()
    .where('property_id', '=', input.propertyId)
    .where('status', '=', 'in_house')
    .where('arrival', '<=', input.date)
    .where('departure', '>', input.date)
    .orderBy('id')
    .execute();
  const stays = await loadStayRecords(tx, rows);
  const snaps = await loadSnapshots(
    tx,
    stays.flatMap((s) => s.segments.map((g) => g.termsSnapshotId)),
  );
  const out: StayForPosting[] = [];
  for (const s of stays) {
    const seg = s.segments.find((g) => input.date >= g.from && input.date < g.to);
    if (!seg) continue;
    const terms = snapshotOf(snaps, seg.termsSnapshotId);
    const line = terms.nights.find((n) => n.date === input.date);
    if (!line) continue;
    out.push({
      stayId: s.row.id,
      bookingId: s.row.booking_id,
      propertyId: s.row.property_id,
      night: input.date,
      commercialType: s.row.commercial_type as StayForPosting['commercialType'],
      unitId: seg.unitId,
      unitTypeId: seg.unitTypeId,
      ratePlanId: seg.ratePlanId,
      occupancy: seg.occupancy,
      termsSnapshotId: seg.termsSnapshotId,
      terms,
      nightly: { net: line.net, taxes: line.taxes },
    });
  }
  return out;
}

/** Expected stays due to arrive on or before `date` that are not checked in (Day Close exceptions). */
export async function listDueArrivals(
  deps: Deps,
  tx: TxContext,
  input: { propertyId: string; date: LocalDate },
) {
  requirePermission(tx, P.bookingRead, { propertyId: input.propertyId });
  const rows = await db(tx)
    .selectFrom('reservations.stays')
    .selectAll()
    .where('property_id', '=', input.propertyId)
    .where('status', '=', 'expected')
    .where('arrival', '<=', input.date)
    .orderBy('arrival')
    .execute();
  return Promise.all(rows.map((r) => getStay(deps, tx, r.id)));
}

/** In-house stays due to depart on or before `date` (incl. overstays). */
export async function listDueDepartures(
  deps: Deps,
  tx: TxContext,
  input: { propertyId: string; date: LocalDate },
) {
  requirePermission(tx, P.bookingRead, { propertyId: input.propertyId });
  const rows = await db(tx)
    .selectFrom('reservations.stays')
    .selectAll()
    .where('property_id', '=', input.propertyId)
    .where('status', '=', 'in_house')
    .where('departure', '<=', input.date)
    .orderBy('departure')
    .execute();
  return Promise.all(rows.map((r) => getStay(deps, tx, r.id)));
}
