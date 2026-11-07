import type { TxContext } from '@portico/db';
import { type LocalDate, type Money, type Occupancy, requirePermission } from '@portico/kernel';
import type { Stay } from '../contracts';
import { RESERVATIONS_PERMISSIONS as P } from '../manifest';
import type { TermsSnapshot } from '../ports';
import { type Deps, db } from './context';
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
