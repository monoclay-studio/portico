/**
 * S07 — A room fails inspection just before its arriving guest reaches reception. Operations records the failed
 * inspection (re-clean task, event naming the arriving stay); reservations' arrivals board shows the blocker from
 * the real unit condition; the desk moves the assignment to another inspected villa atomically (inventory) and the
 * arrival is ready again.
 */
import { sql } from '@portico/db';
import type { Booking } from '@portico/reservations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applied,
  assertGlobalConsistency,
  bookingInput,
  cardOnFile,
  guestWithCard,
  kandu,
  organization,
  readyUnit,
  type Scenario,
  startScenario,
} from './harness';

let s: Scenario;
beforeAll(async () => {
  s = await startScenario({ now: '2027-03-10T13:30:00+05:00' });
});
afterAll(async () => s?.close());

describe('S07 — failed inspection at arrival', () => {
  it('the desk sees the blocker and moves the VIP couple to another inspected villa', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { reservations, operations } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId: guestId, card } = await guestWithCard(s, org, k);
    const b = applied<Booking>(
      await org.run(desk, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(
            k,
            {
              arrival: '2027-03-10',
              departure: '2027-03-14',
              type: 'WV',
              unit: '305',
              guestProfileId: guestId,
            },
            { tags: ['vip'], guarantee: { kind: 'card', paymentMethodId: card.id } },
          ),
        ),
      ),
    );
    const stayId = b.stays[0]?.id as string;
    await s.drain();
    await readyUnit(s, org, k.id, k.units['305'] as string);
    await readyUnit(s, org, k.id, k.units['307'] as string);
    let arrivals = await org.run(desk, (tx) => reservations.listArrivals(tx, { propertyId: k.id }));
    expect(arrivals.items[0]?.readiness?.checks.find((c) => c.key === 'unit_ready')?.status).toBe('ok');

    // 14:05 — the inspector fails villa 305.
    s.clock.set('2027-03-10T14:05:00+05:00');
    const inspector = org.staff('housekeeping_supervisor', 'Inspector Ali', [k.id]);
    const inspection = await org.run(inspector, (tx) =>
      operations.recordInspection(tx, k.units['305'] as string, {
        items: [],
        failureReasons: ['Stained bed linen'],
      }),
    );
    expect(inspection.inspection.result).toBe('failed');
    expect(inspection.inspection.recleanTaskId).toBeTruthy();
    expect(inspection.inspection.affectedStayId).toBe(stayId);
    await s.drain();
    arrivals = await org.run(desk, (tx) => reservations.listArrivals(tx, { propertyId: k.id }));
    const row = arrivals.items.find((r) => r.stayId === stayId);
    expect(row?.readiness?.ready).toBe(false);
    expect(row?.readiness?.blockingReason?.key).toBe('unit_ready');

    // The desk moves the assignment to 307 (same type, no price change), atomically in inventory.
    const current = await org.run(desk, (tx) => reservations.getBooking(tx, b.id));
    await org.run(desk, (tx) =>
      reservations.assignUnit(tx, {
        stayId,
        unitId: k.units['307'] as string,
        expectedVersion: current.version,
      }),
    );
    arrivals = await org.run(desk, (tx) => reservations.listArrivals(tx, { propertyId: k.id }));
    const moved = arrivals.items.find((r) => r.stayId === stayId);
    expect(moved?.unitId).toBe(k.units['307']);
    expect(moved?.readiness?.checks.find((c) => c.key === 'unit_ready')?.status).toBe('ok');
    const assignments = await sql<{ unit_id: string }>`
      select unit_id from inventory.assignments where ref_type = 'stay' and ref_id = ${stayId}`.execute(
      s.t.admin.kysely,
    );
    expect(assignments.rows.map((r) => r.unit_id)).toEqual([k.units['307']]);
    await assertGlobalConsistency(s, org, {
      auditActions: ['reservations.booking.create'],
    });
  });

  it.todo(
    'interrupt alert to the desk with ETA and next-best inspected villas (comms/notification centre — wave 2)',
  );
  it.todo(
    'waiting-guest timer and estimated readiness when the guest arrives first (reservations waiting-guests list not built)',
  );
});
