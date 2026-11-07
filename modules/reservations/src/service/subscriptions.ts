import type { TxContext, TxEventSubscription } from '@portico/db';
import { type DateRange, type DomainEvent, eachNight } from '@portico/kernel';
import { CONSUMED_EVENTS as C, RESERVATIONS_EVENTS as E } from '../events';
import { type Deps, db, parseNights } from './context';
import { openRelocationCase, raiseIssue } from './issues';
import { loadStay } from './repo';

/**
 * Consumers of other modules' events. Each runs inside the delivery transaction (exactly-once effects per
 * consumer, ADR-0004) and is idempotent by business identity (open relocation case per stay+cause, open issue
 * per dedupe key).
 */
export function reservationsSubscriptions(deps: Deps): TxEventSubscription[] {
  return [
    {
      // OOO / OOS / house use placed on units with assignments → a relocation case per affected stay (S08).
      consumer: 'reservations.relocation-on-unit-blocked',
      types: [C.inventoryUnitBlocked],
      handle: async (tx, event) => {
        const payload = event.payload as {
          unitId?: string;
          kind?: string;
          affectedAssignments?: Array<{ ref: { type: string; id: string }; nights: DateRange }>;
        };
        for (const a of payload.affectedAssignments ?? []) {
          if (a.ref.type !== 'stay') continue;
          const stay = await loadStay(tx, a.ref.id).catch(() => null);
          if (!stay || !['expected', 'in_house'].includes(stay.row.status)) continue;
          const owner = await db(tx)
            .selectFrom('reservations.bookings')
            .select('owner_id')
            .where('id', '=', stay.row.booking_id)
            .executeTakeFirst();
          await openRelocationCase(deps, tx, {
            stay,
            cause: 'out_of_order',
            nights: a.nights,
            causeRef: { eventId: event.id, unitId: payload.unitId ?? null, kind: payload.kind ?? null },
            ownerId: owner?.owner_id ?? null,
          });
        }
      },
    },
    {
      // Availability appeared → tell the owner of waitlisted stays / waitlisted extensions (RES-R21).
      consumer: 'reservations.waitlist-on-availability',
      types: [C.inventoryAvailabilityChanged],
      handle: async (tx, event) => waitlistMatches(deps, tx, event),
    },
    {
      // Profile merges re-point booker and occupant references (guests spec GUE-R11/R12).
      consumer: 'reservations.profile-merge',
      types: [C.guestsProfileMerged, C.guestsProfileUnmerged],
      handle: async (tx, event) => {
        const p = event.payload as {
          survivorId?: string;
          mergedId?: string;
          restored?: Array<{ module: string; type: string; id: string }>;
        };
        if (event.type === C.guestsProfileMerged && p.survivorId && p.mergedId) {
          await db(tx)
            .updateTable('reservations.bookings')
            .set({ booker_profile_id: p.survivorId })
            .where('booker_profile_id', '=', p.mergedId)
            .execute();
          await db(tx)
            .updateTable('reservations.occupants')
            .set({ profile_id: p.survivorId })
            .where('profile_id', '=', p.mergedId)
            .execute();
          await tx.audit({
            action: 'reservations.profile.repoint',
            target: { type: 'guest_profile', id: p.mergedId },
            after: { survivorId: p.survivorId, eventId: event.id },
          });
        }
        if (event.type === C.guestsProfileUnmerged && p.mergedId) {
          for (const r of (p.restored ?? []).filter((x) => x.module === 'reservations')) {
            if (r.type === 'booking') {
              await db(tx)
                .updateTable('reservations.bookings')
                .set({ booker_profile_id: p.mergedId })
                .where('id', '=', r.id)
                .execute();
            }
            if (r.type === 'occupant') {
              await db(tx)
                .updateTable('reservations.occupants')
                .set({ profile_id: p.mergedId })
                .where('id', '=', r.id)
                .execute();
            }
          }
        }
      },
    },
  ];
}

async function waitlistMatches(deps: Deps, tx: TxContext, event: DomainEvent): Promise<void> {
  const payload = event.payload as {
    propertyId?: string;
    cells?: Array<{ unitTypeId: string; night: string }>;
  };
  const propertyId = payload.propertyId ?? event.propertyId;
  if (!propertyId) return;
  const types = new Set((payload.cells ?? []).map((c) => c.unitTypeId));
  const waitlisted = await db(tx)
    .selectFrom('reservations.stays as s')
    .innerJoin('reservations.stay_segments as g', 'g.stay_id', 's.id')
    .select(['s.id', 's.booking_id', 's.arrival', 's.departure', 'g.unit_type_id', 'g.nights'])
    .where('s.property_id', '=', propertyId)
    .where('s.status', '=', 'waitlisted')
    .execute();
  for (const w of waitlisted) {
    if (types.size && !types.has(w.unit_type_id)) continue;
    const nights = parseNights(w.nights);
    const cells = await deps.ports.inventory.getAvailability(tx, {
      propertyId,
      unitTypeIds: [w.unit_type_id],
      range: nights,
    });
    const ok = eachNight(nights).every((d) => (cells.find((c) => c.date === d)?.available ?? 0) >= 1);
    if (!ok) continue;
    const b = await db(tx)
      .selectFrom('reservations.bookings')
      .select(['code', 'owner_id'])
      .where('id', '=', w.booking_id)
      .executeTakeFirstOrThrow();
    await raiseIssue(tx, {
      propertyId,
      kind: 'waitlist_available',
      severity: 'routine',
      bookingId: w.booking_id,
      stayId: w.id,
      dedupeKey: `waitlist_available:${w.id}`,
      message: `Waitlisted stay on booking ${b.code} can now be confirmed (${nights.from} to ${nights.to}).`,
      ownerId: b.owner_id,
    });
    await tx.emit({
      type: E.stayWaitlistAvailable,
      propertyId,
      aggregate: { type: 'stay', id: w.id },
      payload: { stayId: w.id, bookingId: w.booking_id, nights },
    });
  }
  const extensions = await db(tx)
    .selectFrom('reservations.issues')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('kind', '=', 'extension_waitlisted')
    .where('status', '=', 'open')
    .execute();
  for (const ext of extensions) {
    const d = ext.details as { requestedDeparture?: string; unitTypeId?: string };
    if (!ext.stay_id || !d.requestedDeparture || !d.unitTypeId) continue;
    if (types.size && !types.has(d.unitTypeId)) continue;
    const stay = await loadStay(tx, ext.stay_id);
    if (d.requestedDeparture <= stay.row.departure) continue;
    const range = { from: stay.row.departure, to: d.requestedDeparture };
    const cells = await deps.ports.inventory.getAvailability(tx, {
      propertyId,
      unitTypeIds: [d.unitTypeId],
      range,
    });
    if (!eachNight(range).every((n) => (cells.find((c) => c.date === n)?.available ?? 0) >= 1)) continue;
    await raiseIssue(tx, {
      propertyId,
      kind: 'waitlist_available',
      severity: 'routine',
      bookingId: ext.booking_id,
      stayId: ext.stay_id,
      dedupeKey: `waitlist_available:extension:${ext.id}`,
      message: `The waitlisted extension to ${d.requestedDeparture} is now available: preview the extension to confirm it.`,
      ownerId: ext.owner_id,
    });
  }
}
