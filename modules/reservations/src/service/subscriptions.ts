import type { TxContext, TxEventSubscription } from '@portico/db';
import { type DateRange, DomainError, type DomainEvent, eachNight } from '@portico/kernel';
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
      // guests.profile.merged → re-point booker/occupant references to the survivor and report exactly what was
      // re-pointed (GUE-I03) so an unmerge restores those references and nothing else.
      consumer: 'reservations.profile-merged',
      types: [C.guestsProfileMerged],
      handle: async (tx, event) =>
        repointOnMerge(deps, tx, event.payload as unknown as GuestsProfileMergedPayload, event.id),
    },
    {
      // guests.profile.unmerged → restore the references guests lists for this module, and re-point records staff
      // reassigned to the restored profile during unmerge review.
      consumer: 'reservations.profile-unmerged',
      types: [C.guestsProfileUnmerged],
      handle: async (tx, event) =>
        restoreOnUnmerge(tx, event.payload as unknown as GuestsProfileUnmergedPayload, event.id),
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

/** guests.profile.merged payload (modules/guests/src/events.ts — kept structurally, modules never import each other). */
export interface GuestsProfileMergedPayload {
  mergeId: string;
  survivorId: string;
  mergedId: string;
}

/** guests.profile.unmerged payload. */
export interface GuestsProfileUnmergedPayload {
  mergeId: string;
  restoredId: string;
  survivorId: string;
  referencesToRestore: Record<string, Array<{ type: string; id: string; field?: string | null }>>;
  reassigned: Array<{ type: string; id: string }>;
}

const MODULE = 'reservations';

export async function repointOnMerge(
  deps: Deps,
  tx: TxContext,
  p: GuestsProfileMergedPayload,
  eventId: string,
): Promise<void> {
  if (!p.mergeId || !p.survivorId || !p.mergedId) return;
  const bookings = await db(tx)
    .selectFrom('reservations.bookings')
    .select('id')
    .where('booker_profile_id', '=', p.mergedId)
    .execute();
  const occupants = await db(tx)
    .selectFrom('reservations.occupants')
    .select('id')
    .where('profile_id', '=', p.mergedId)
    .execute();
  const references = [
    ...bookings.map((b) => ({ type: 'booking', id: b.id, field: 'booker_profile_id' })),
    ...occupants.map((o) => ({ type: 'occupant', id: o.id, field: 'profile_id' })),
  ];
  if (references.length === 0) return; // idempotent: a re-delivery finds nothing left to re-point
  try {
    // Report first: if the merge was already undone, nothing must be re-pointed.
    await deps.ports.guests.recordReferenceRepoints(tx, { mergeId: p.mergeId, module: MODULE, references });
  } catch (err) {
    if (err instanceof DomainError && err.code === 'merge_not_active') return;
    throw err;
  }
  if (bookings.length) {
    await db(tx)
      .updateTable('reservations.bookings')
      .set({ booker_profile_id: p.survivorId })
      .where(
        'id',
        'in',
        bookings.map((b) => b.id),
      )
      .execute();
  }
  if (occupants.length) {
    await db(tx)
      .updateTable('reservations.occupants')
      .set({ profile_id: p.survivorId })
      .where(
        'id',
        'in',
        occupants.map((o) => o.id),
      )
      .execute();
  }
  await tx.audit({
    action: 'reservations.profile.repoint',
    target: { type: 'guest_profile', id: p.mergedId },
    after: {
      mergeId: p.mergeId,
      survivorId: p.survivorId,
      bookings: bookings.length,
      occupants: occupants.length,
      eventId,
    },
  });
}

export async function restoreOnUnmerge(
  tx: TxContext,
  p: GuestsProfileUnmergedPayload,
  eventId: string,
): Promise<void> {
  if (!p.mergeId || !p.restoredId || !p.survivorId) return;
  const mine = p.referencesToRestore?.[MODULE] ?? [];
  const bookingIds = mine.filter((r) => r.type === 'booking').map((r) => r.id);
  const occupantIds = mine.filter((r) => r.type === 'occupant').map((r) => r.id);
  // Only references still pointing at the survivor are restored (a later edit is never overwritten).
  if (bookingIds.length) {
    await db(tx)
      .updateTable('reservations.bookings')
      .set({ booker_profile_id: p.restoredId })
      .where('id', 'in', bookingIds)
      .where('booker_profile_id', '=', p.survivorId)
      .execute();
  }
  if (occupantIds.length) {
    await db(tx)
      .updateTable('reservations.occupants')
      .set({ profile_id: p.restoredId })
      .where('id', 'in', occupantIds)
      .where('profile_id', '=', p.survivorId)
      .execute();
  }
  // Records created after the merge that staff assigned to the restored profile (stays, bookings, occupants).
  const reassignedStays = (p.reassigned ?? []).filter((r) => r.type === 'stay').map((r) => r.id);
  const reassignedBookings = (p.reassigned ?? []).filter((r) => r.type === 'booking').map((r) => r.id);
  const reassignedOccupants = (p.reassigned ?? []).filter((r) => r.type === 'occupant').map((r) => r.id);
  if (reassignedStays.length) {
    await db(tx)
      .updateTable('reservations.occupants')
      .set({ profile_id: p.restoredId })
      .where('stay_id', 'in', reassignedStays)
      .where('profile_id', '=', p.survivorId)
      .execute();
  }
  if (reassignedBookings.length) {
    await db(tx)
      .updateTable('reservations.bookings')
      .set({ booker_profile_id: p.restoredId })
      .where('id', 'in', reassignedBookings)
      .where('booker_profile_id', '=', p.survivorId)
      .execute();
  }
  if (reassignedOccupants.length) {
    await db(tx)
      .updateTable('reservations.occupants')
      .set({ profile_id: p.restoredId })
      .where('id', 'in', reassignedOccupants)
      .where('profile_id', '=', p.survivorId)
      .execute();
  }
  await tx.audit({
    action: 'reservations.profile.restore',
    target: { type: 'guest_profile', id: p.restoredId },
    after: {
      mergeId: p.mergeId,
      restored: bookingIds.length + occupantIds.length,
      reassigned: reassignedStays.length + reassignedBookings.length + reassignedOccupants.length,
      eventId,
    },
  });
}
