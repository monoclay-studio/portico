import type { TxContext, TxEventSubscription } from '@portico/db';
import { addDays, type DomainEvent, isLocalDate } from '@portico/kernel';
import { z } from 'zod';
import { dedupeKeyFor } from './domain/day-plan';
import type { OperationsPorts } from './ports';
import { type Deps, db, feedMark, logTask, propertyFacts } from './service/internal';
import { mirrorUnitBlock, noteBlockReleased, recordResolutionItems } from './service/maintenance';
import { housekeepingPriorityFor, insertTask, rescoreUnitTasks, transitionTask } from './service/tasks';
import {
  loadUnit,
  projectStay,
  refreshReadiness,
  systemConditionChange,
  writeRoomStatus,
} from './service/units';

/** Events emitted by operations (`<module>.<aggregate>.<pastTenseVerb>`). Payloads are documented in README. */
export const OPERATIONS_EVENTS = {
  unitConditionChanged: 'operations.unit.conditionChanged',
  unitDiscrepancyReported: 'operations.unit.discrepancyReported',
  inspectionPassed: 'operations.inspection.passed',
  inspectionFailed: 'operations.inspection.failed',
  taskCreated: 'operations.task.created',
  taskStatusChanged: 'operations.task.statusChanged',
  taskAssigned: 'operations.task.assigned',
  taskEscalated: 'operations.task.escalated',
  serviceRequestCreated: 'operations.serviceRequest.created',
  serviceRequestCompleted: 'operations.serviceRequest.completed',
  workOrderCreated: 'operations.workOrder.created',
  workOrderUnitBlocked: 'operations.workOrder.unitBlocked',
  workOrderCompleted: 'operations.workOrder.completed',
  workOrderReturnedToService: 'operations.workOrder.returnedToService',
  resolutionRequired: 'operations.resolution.required',
  statusForwardRequested: 'operations.statusForward.requested',
  statusForwardAcknowledged: 'operations.statusForward.acknowledged',
  statusForwardRejected: 'operations.statusForward.rejected',
} as const;

/** Events consumed (subscriptions registered in the composition root). */
export const CONSUMED_EVENTS = [
  'reservations.booking.confirmed',
  'reservations.booking.modified',
  'reservations.booking.cancelled',
  'reservations.stay.checkedIn',
  'reservations.stay.checkedOut',
  'reservations.stay.moved',
  'reservations.stay.noShow',
  'reservations.stay.extended',
  'reservations.stay.shortened',
  'inventory.unit.blocked',
  'inventory.unit.unblocked',
  'inventory.assignment.changed',
  'platform.property.businessDateAdvanced',
] as const;

// Tolerant payload schemas: reservations/inventory are built in parallel; unknown fields are ignored and only
// the fields operations needs are required. A payload missing them fails loudly (retried, then dead-lettered
// where operators see it) rather than being silently dropped.
const date = z.string().refine(isLocalDate, 'YYYY-MM-DD');
const uuid = z.uuid();
const stayShape = z.looseObject({
  stayId: uuid,
  unitId: uuid.nullish(),
  arrival: date,
  departure: date,
  status: z.enum(['expected', 'in_house', 'departed', 'cancelled', 'no_show', 'waitlisted']).optional(),
  vip: z.boolean().optional(),
  earlyCheckIn: z.boolean().optional(),
  eta: z.iso.datetime({ offset: true }).nullish(),
  guestProfileId: uuid.nullish(),
  guestLabel: z.string().max(120).nullish(),
});
const bookingPayload = z.looseObject({ bookingId: uuid, stays: z.array(stayShape).default([]) });
const bookingCancelledPayload = z.looseObject({
  bookingId: uuid,
  stayIds: z.array(uuid).optional(),
  stays: z.array(z.looseObject({ stayId: uuid })).optional(),
});
const stayEventPayload = z.looseObject({
  stayId: uuid,
  unitId: uuid.nullish(),
  arrival: date.optional(),
  departure: date.optional(),
  /** reservations' extended/shortened events carry the new dates as `to: { arrival, departure }`. */
  to: z.looseObject({ arrival: date.optional(), departure: date.optional() }).optional(),
});
const assignmentPayload = z.looseObject({
  ref: z.object({ type: z.string(), id: uuid }),
  change: z.string().optional(),
  unitId: uuid.nullish(),
  previousUnitIds: z.array(uuid).optional(),
  nights: z.object({ from: date, to: date }),
});
const movedPayload = z.looseObject({
  stayId: uuid,
  fromUnitId: uuid.nullish(),
  toUnitId: uuid,
  effectiveDate: date.optional(),
});
const blockedPayload = z.looseObject({
  unitId: uuid,
  blockId: uuid,
  kind: z.enum(['out_of_order', 'out_of_service', 'house_use']),
  nights: z.object({ from: date, to: date }),
  reason: z.string().nullish(),
  affectedAssignments: z
    .array(
      z.object({ ref: z.object({ type: z.string(), id: uuid }), nights: z.object({ from: date, to: date }) }),
    )
    .default([]),
  sourceRef: z.object({ type: z.string(), id: uuid }).nullish(),
});
const unblockedPayload = z.looseObject({ unitId: uuid, blockId: uuid });

function propertyOf(event: DomainEvent): string {
  if (!event.propertyId)
    throw new Error(`Event ${event.type} ${event.id} has no propertyId; operations cannot route it.`);
  return event.propertyId;
}

/** aggregateVersion of a stay event (ordering guard), when the producer versions the stay aggregate. */
function stayVersion(event: DomainEvent): number | null {
  return event.aggregate.type === 'stay' ? event.aggregateVersion : null;
}

async function cancelStayService(d: Deps, tx: TxContext, stayId: string, reason: string) {
  const open = await db(tx)
    .selectFrom('operations.tasks')
    .select('id')
    .where('stay_id', '=', stayId)
    .where('kind', 'in', ['stayover', 'turndown', 'departure_clean'])
    .where('status', 'in', ['open', 'blocked'])
    .execute();
  for (const t of open) {
    await transitionTask(d, tx, t.id, { to: 'cancelled', reason }, { internal: true, source: 'system' });
  }
}

async function projection(tx: TxContext, stayId: string) {
  return db(tx)
    .selectFrom('operations.stay_projection')
    .selectAll()
    .where('id', '=', stayId)
    .executeTakeFirst();
}

async function unitKnown(tx: TxContext, unitId: string | null | undefined): Promise<boolean> {
  if (!unitId) return false;
  return !!(await db(tx)
    .selectFrom('operations.unit_status')
    .select('id')
    .where('id', '=', unitId)
    .executeTakeFirst());
}

async function onBookingConfirmed(d: Deps, tx: TxContext, event: DomainEvent) {
  const propertyId = propertyOf(event);
  const p = bookingPayload.parse(event.payload);
  const facts = await propertyFacts(d, tx, propertyId);
  for (const s of p.stays) {
    if (s.status === 'waitlisted') continue;
    const prev = await projectStay(d, tx, {
      stayId: s.stayId,
      propertyId,
      bookingId: p.bookingId,
      ...(s.unitId !== undefined ? { unitId: s.unitId ?? null } : {}),
      arrival: s.arrival,
      departure: s.departure,
      // A modification without a status never resets the stay (in-house stays stay in-house).
      ...(s.status ? { status: s.status as 'expected' } : {}),
      guestProfileId: s.guestProfileId ?? null,
      guestLabel: s.guestLabel ?? null,
      ...(s.vip !== undefined ? { vip: s.vip } : {}),
      ...(s.earlyCheckIn !== undefined ? { earlyCheckIn: s.earlyCheckIn } : {}),
      ...(s.eta !== undefined ? { eta: s.eta ? new Date(s.eta) : null } : {}),
    });
    // Arrivals for today change cleaning priorities (arrival due soon, VIP, early check-in).
    if (s.arrival === facts.businessDate) {
      const units = new Set([s.unitId, prev.previousUnitId].filter((x): x is string => !!x));
      for (const u of units) if (await unitKnown(tx, u)) await rescoreUnitTasks(d, tx, propertyId, u);
    }
  }
}

async function onBookingCancelled(d: Deps, tx: TxContext, event: DomainEvent) {
  const propertyId = propertyOf(event);
  const p = bookingCancelledPayload.parse(event.payload);
  let ids = p.stayIds ?? p.stays?.map((s) => s.stayId) ?? [];
  if (!ids.length) {
    ids = (
      await db(tx)
        .selectFrom('operations.stay_projection')
        .select('id')
        .where('booking_id', '=', p.bookingId)
        .execute()
    ).map((r) => r.id);
  }
  for (const id of ids) {
    const prev = await projection(tx, id);
    if (!prev) continue;
    const r = await projectStay(d, tx, {
      stayId: id,
      propertyId,
      arrival: prev.arrival,
      departure: prev.departure,
      status: 'cancelled',
    });
    if (r.applied) await cancelStayService(d, tx, id, 'Booking cancelled');
    if (prev.unit_id && (await unitKnown(tx, prev.unit_id)))
      await rescoreUnitTasks(d, tx, propertyId, prev.unit_id);
  }
}

async function onCheckedIn(d: Deps, tx: TxContext, event: DomainEvent) {
  const propertyId = propertyOf(event);
  const p = stayEventPayload.parse(event.payload);
  const prev = await projection(tx, p.stayId);
  const facts = await propertyFacts(d, tx, propertyId);
  const arrival = p.arrival ?? prev?.arrival ?? facts.businessDate;
  const departure = p.departure ?? prev?.departure ?? addDays(arrival, 1);
  await projectStay(d, tx, {
    stayId: p.stayId,
    propertyId,
    ...(p.unitId !== undefined ? { unitId: p.unitId ?? null } : {}),
    arrival,
    departure,
    status: 'in_house',
    stayEventVersion: stayVersion(event),
  });
}

/** Checkout → unit dirty + departure clean task; the stay's remaining in-room service tasks are cancelled. */
async function onCheckedOut(d: Deps, tx: TxContext, event: DomainEvent) {
  const propertyId = propertyOf(event);
  const p = stayEventPayload.parse(event.payload);
  const prev = await projection(tx, p.stayId);
  const facts = await propertyFacts(d, tx, propertyId);
  const unitId = p.unitId ?? prev?.unit_id ?? null;
  const projected = await projectStay(d, tx, {
    stayId: p.stayId,
    propertyId,
    ...(unitId ? { unitId } : {}),
    arrival: p.arrival ?? prev?.arrival ?? facts.businessDate,
    departure: p.departure ?? prev?.departure ?? facts.businessDate,
    status: 'departed',
    stayEventVersion: stayVersion(event),
  });
  if (!projected.applied) return; // an older event than one already applied: nothing to do
  if (!unitId || !(await unitKnown(tx, unitId))) return;
  let unit = await loadUnit(tx, unitId, { forUpdate: true });
  unit = await systemConditionChange(d, tx, unit, 'dirty', 'Guest checked out');
  // The next guest must not inherit do-not-disturb (and a vacant unit needs no welfare check).
  if (unit.dnd && unit.occupancy === 'vacant') {
    const authority = await d.ports.platform.getDataAuthority(tx, propertyId, 'roomStatus');
    if (authority.authority === 'portico') {
      unit = (
        await writeRoomStatus(
          d,
          tx,
          unit,
          { dnd: false },
          { source: 'event', authorityChecked: true, reason: 'Guest checked out' },
        )
      ).row;
    }
  }
  if (unit.turndown !== 'not_required' && unit.turndown !== 'done') {
    const authority = await d.ports.platform.getDataAuthority(tx, propertyId, 'roomStatus');
    if (authority.authority === 'portico') {
      await writeRoomStatus(
        d,
        tx,
        unit,
        { turndown: 'not_required' },
        { source: 'event', authorityChecked: true },
      );
    }
  }
  const service = await db(tx)
    .selectFrom('operations.tasks')
    .select('id')
    .where('stay_id', '=', p.stayId)
    .where('unit_id', '=', unitId)
    .where('kind', 'in', ['stayover', 'turndown'])
    .where('status', 'in', ['open', 'blocked'])
    .execute();
  for (const t of service) {
    await transitionTask(
      d,
      tx,
      t.id,
      { to: 'cancelled', reason: 'Guest checked out' },
      { internal: true, source: 'system' },
    );
  }
  const pr = await housekeepingPriorityFor(d, tx, {
    propertyId,
    unitId,
    kind: 'departure_clean',
    departed: true,
  });
  await insertTask(d, tx, {
    propertyId,
    kind: 'departure_clean',
    title: `Departure clean · ${unit.unit_number}`,
    unitId,
    stayId: p.stayId,
    priority: pr.priority,
    priorityScore: pr.score,
    priorityReasons: pr.reasons,
    serviceDate: facts.businessDate,
    source: 'event',
    dedupeKey: dedupeKeyFor('departure_clean', { unitId, stayId: p.stayId, date: facts.businessDate }),
  });
}

/** Room move: the vacated unit (if the guest had used it) needs a clean; open in-room service follows the guest. */
async function onMoved(d: Deps, tx: TxContext, event: DomainEvent) {
  const propertyId = propertyOf(event);
  const p = movedPayload.parse(event.payload);
  const prev = await projection(tx, p.stayId);
  const facts = await propertyFacts(d, tx, propertyId);
  const fromUnitId = p.fromUnitId ?? prev?.unit_id ?? null;
  const wasInHouse = prev?.status === 'in_house';
  const projected = await projectStay(d, tx, {
    stayId: p.stayId,
    propertyId,
    unitId: p.toUnitId,
    arrival: prev?.arrival ?? p.effectiveDate ?? facts.businessDate,
    departure: prev?.departure ?? addDays(p.effectiveDate ?? facts.businessDate, 1),
    stayEventVersion: stayVersion(event),
  });
  if (!projected.applied) return;
  if (fromUnitId && fromUnitId !== p.toUnitId && (await unitKnown(tx, fromUnitId))) {
    if (wasInHouse) {
      const unit = await systemConditionChange(
        d,
        tx,
        await loadUnit(tx, fromUnitId, { forUpdate: true }),
        'dirty',
        'Guest moved to another unit',
      );
      const pr = await housekeepingPriorityFor(d, tx, {
        propertyId,
        unitId: fromUnitId,
        kind: 'departure_clean',
        departed: true,
      });
      await insertTask(d, tx, {
        propertyId,
        kind: 'departure_clean',
        title: `Clean after room move · ${unit.unit_number}`,
        unitId: fromUnitId,
        stayId: p.stayId,
        priority: pr.priority,
        priorityScore: pr.score,
        priorityReasons: pr.reasons,
        serviceDate: facts.businessDate,
        source: 'event',
        dedupeKey: `departure_clean:move:${p.stayId}:${fromUnitId}`,
      });
    }
    // Open in-room service tasks of the stay follow the guest to the new unit.
    if (await unitKnown(tx, p.toUnitId)) {
      const tasks = await db(tx)
        .selectFrom('operations.tasks')
        .selectAll()
        .where('stay_id', '=', p.stayId)
        .where('unit_id', '=', fromUnitId)
        .where('kind', 'in', ['stayover', 'turndown', 'service_request', 'guest_commitment'])
        .where('status', 'in', ['open', 'in_progress', 'blocked'])
        .execute();
      for (const t of tasks) {
        const updated = await db(tx)
          .updateTable('operations.tasks')
          .set({ unit_id: p.toUnitId, version: t.version + 1, feed_xid: feedMark(), updated_at: tx.now })
          .where('id', '=', t.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await logTask(tx, updated, {
          kind: 'comment',
          comment: 'Guest moved: task moved to the new unit.',
          source: 'event',
        });
      }
      await rescoreUnitTasks(d, tx, propertyId, p.toUnitId);
    }
    await rescoreUnitTasks(d, tx, propertyId, fromUnitId);
  }
}

async function onNoShow(d: Deps, tx: TxContext, event: DomainEvent) {
  const propertyId = propertyOf(event);
  const p = stayEventPayload.parse(event.payload);
  const prev = await projection(tx, p.stayId);
  if (!prev) return;
  const projected = await projectStay(d, tx, {
    stayId: p.stayId,
    propertyId,
    arrival: prev.arrival,
    departure: prev.departure,
    status: 'no_show',
    stayEventVersion: stayVersion(event),
  });
  if (projected.applied) await cancelStayService(d, tx, p.stayId, 'Guest did not arrive (no-show)');
  if (prev.unit_id && (await unitKnown(tx, prev.unit_id)))
    await rescoreUnitTasks(d, tx, propertyId, prev.unit_id);
}

/** Extension / shortening: the departure date moves, so the departure clean and stayovers are re-planned. */
async function onDatesChanged(d: Deps, tx: TxContext, event: DomainEvent) {
  const propertyId = propertyOf(event);
  const p = stayEventPayload.parse(event.payload);
  const prev = await projection(tx, p.stayId);
  if (!prev) return;
  const departure = p.to?.departure ?? p.departure ?? prev.departure;
  const projected = await projectStay(d, tx, {
    stayId: p.stayId,
    propertyId,
    arrival: p.to?.arrival ?? p.arrival ?? prev.arrival,
    departure,
    stayEventVersion: stayVersion(event),
  });
  if (!projected.applied) return;
  // A departure clean planned for the old departure date of a stay that is still in house is no longer due.
  if (prev.unit_id && departure !== prev.departure && prev.status === 'in_house') {
    const planned = await db(tx)
      .selectFrom('operations.tasks')
      .select('id')
      .where('stay_id', '=', p.stayId)
      .where('kind', '=', 'departure_clean')
      .where('status', '=', 'open')
      .where('service_date', '=', prev.departure)
      .execute();
    for (const t of planned) {
      await transitionTask(
        d,
        tx,
        t.id,
        { to: 'cancelled', reason: 'Stay dates changed' },
        { internal: true, source: 'system' },
      );
    }
  }
  if (prev.unit_id && (await unitKnown(tx, prev.unit_id)))
    await rescoreUnitTasks(d, tx, propertyId, prev.unit_id);
}

/**
 * Unit assignment of a stay changed in inventory: keeps the stay projection's unit current even when reservation
 * events do not carry unit details (dates from reservations events win when known).
 */
async function onAssignmentChanged(d: Deps, tx: TxContext, event: DomainEvent) {
  const propertyId = propertyOf(event);
  const p = assignmentPayload.parse(event.payload);
  if (p.ref.type !== 'stay') return;
  const prev = await projection(tx, p.ref.id);
  // Units operations does not mirror (e.g. a composite "combined villa") never replace the physical unit.
  if (p.unitId && !(await unitKnown(tx, p.unitId))) return;
  const unassigned = p.change === 'unassigned' || !p.unitId;
  const unitId = unassigned
    ? prev?.unit_id && (p.previousUnitIds ?? []).includes(prev.unit_id)
      ? null
      : (prev?.unit_id ?? null)
    : (p.unitId ?? null);
  await projectStay(d, tx, {
    stayId: p.ref.id,
    propertyId,
    unitId,
    arrival: prev?.arrival ?? p.nights.from,
    departure: prev?.departure ?? p.nights.to,
  });
  for (const u of new Set([unitId, prev?.unit_id].filter((x): x is string => !!x))) {
    if (await unitKnown(tx, u)) await rescoreUnitTasks(d, tx, propertyId, u);
  }
}

/** A block placed in inventory (by operations or directly there): mirror it and list affected stays. */
async function onUnitBlocked(d: Deps, tx: TxContext, event: DomainEvent) {
  const propertyId = propertyOf(event);
  const p = blockedPayload.parse(event.payload);
  if (!(await unitKnown(tx, p.unitId))) return;
  const workOrderId =
    p.sourceRef && ['work_order', 'workOrder'].includes(p.sourceRef.type) ? p.sourceRef.id : null;
  await mirrorUnitBlock(d, tx, {
    unitId: p.unitId,
    blockId: p.blockId,
    kind: p.kind,
    from: p.nights.from,
    to: p.nights.to,
    reason: p.reason ?? null,
    workOrderId,
  });
  if (p.kind !== 'house_use' && p.affectedAssignments.length) {
    await recordResolutionItems(d, tx, {
      propertyId,
      unitId: p.unitId,
      blockId: p.blockId,
      workOrderId,
      affected: p.affectedAssignments,
    });
  }
}

async function onUnitUnblocked(d: Deps, tx: TxContext, event: DomainEvent) {
  const p = unblockedPayload.parse(event.payload);
  if (!(await unitKnown(tx, p.unitId))) return;
  await noteBlockReleased(d, tx, p.unitId, p.blockId);
}

/** Event subscriptions for the composition root (worker). Handlers run inside the delivery transaction. */
export function operationsSubscriptions(ports: OperationsPorts): TxEventSubscription[] {
  const d: Deps = { ports };
  const reservationHandlers: Record<string, (tx: TxContext, e: DomainEvent) => Promise<void>> = {
    'reservations.booking.confirmed': (tx, e) => onBookingConfirmed(d, tx, e),
    'reservations.booking.modified': (tx, e) => onBookingConfirmed(d, tx, e),
    'reservations.booking.cancelled': (tx, e) => onBookingCancelled(d, tx, e),
    'reservations.stay.checkedIn': (tx, e) => onCheckedIn(d, tx, e),
    'reservations.stay.checkedOut': (tx, e) => onCheckedOut(d, tx, e),
    'reservations.stay.moved': (tx, e) => onMoved(d, tx, e),
    'reservations.stay.noShow': (tx, e) => onNoShow(d, tx, e),
    'reservations.stay.extended': (tx, e) => onDatesChanged(d, tx, e),
    'reservations.stay.shortened': (tx, e) => onDatesChanged(d, tx, e),
  };
  const inventoryHandlers: Record<string, (tx: TxContext, e: DomainEvent) => Promise<void>> = {
    'inventory.unit.blocked': (tx, e) => onUnitBlocked(d, tx, e),
    'inventory.unit.unblocked': (tx, e) => onUnitUnblocked(d, tx, e),
    'inventory.assignment.changed': (tx, e) => onAssignmentChanged(d, tx, e),
  };
  return [
    {
      // Stored readiness depends on the business date (blocks are night ranges): refresh it when the day changes.
      consumer: 'operations.businessDate',
      types: ['platform.property.businessDateAdvanced'],
      handle: async (tx, e) => {
        if (!e.propertyId) return;
        const units = await db(tx)
          .selectFrom('operations.unit_status')
          .select('id')
          .where('property_id', '=', e.propertyId)
          .where('active', '=', true)
          .execute();
        for (const u of units) await refreshReadiness(d, tx, u.id);
      },
    },
    {
      consumer: 'operations.stays',
      types: Object.keys(reservationHandlers),
      handle: async (tx, e) => reservationHandlers[e.type]?.(tx, e),
    },
    {
      consumer: 'operations.unitBlocks',
      types: Object.keys(inventoryHandlers),
      handle: async (tx, e) => inventoryHandlers[e.type]?.(tx, e),
    },
  ];
}
