/**
 * S08 — A maintenance outage makes assigned rooms unavailable. The engineer (no inventory keys) creates a work order
 * with an out-of-order block through operations → inventory's port surface (ADR-0015); inventory reports the
 * affected assignment; reservations opens a relocation case (event consumer); the front office moves the guest to a
 * Sunset Water Villa as a complimentary upgrade (agreed price kept) and resolves the case; the villa returns to sale
 * only after the work order is completed.
 */
import type { Booking, CommitResult } from '@portico/reservations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applied,
  assertGlobalConsistency,
  bookingInput,
  kandu,
  organization,
  readyUnit,
  type Scenario,
  startScenario,
} from './harness';

let s: Scenario;
beforeAll(async () => {
  s = await startScenario();
});
afterAll(async () => s?.close());

describe('S08 — maintenance outage', () => {
  it('work order → block → relocation case → complimentary upgrade → return to service', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { reservations, operations, inventory } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const b = applied<Booking>(
      await org.run(desk, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(k, { arrival: '2027-03-11', departure: '2027-03-13', type: 'WV', unit: '305' }),
        ),
      ),
    );
    const stayId = b.stays[0]?.id as string;
    await s.drain();
    const engineer = org.staff('engineer', 'Ibrahim (engineering)', [k.id]);
    const wo = await org.run(engineer, (tx) =>
      operations.createWorkOrder(tx, {
        propertyId: k.id,
        unitId: k.units['305'] as string,
        title: 'Chiller failure on Jetty B',
        faultCategory: 'hvac',
        urgency: 'high',
        block: {
          kind: 'out_of_order',
          from: '2027-03-10',
          to: '2027-03-12',
          reason: 'Chiller failure on Jetty B',
        },
      }),
    );
    expect(wo.block?.status).toBe('active');
    await s.drain(); // inventory.unit.blocked → reservations relocation case
    const cases = await org.run(desk, (tx) => reservations.listRelocationCases(tx, { propertyId: k.id }));
    const relocation = cases.find((c) => c.stayId === stayId);
    expect(relocation).toBeTruthy();

    // Complimentary upgrade to a Sunset Water Villa, keeping the agreed price.
    const preview = await org.run(desk, (tx) =>
      reservations.previewChange(tx, {
        kind: 'unit_type',
        stayId,
        unitTypeId: k.types.OWPV as string,
        unitId: k.units['501'] as string,
        typeChange: 'keep_agreed',
      }),
    );
    expect(preview.feasible).toBe(true);
    expect(preview.totals.difference.amountMinor).toBe(0);
    const moved = applied<CommitResult>(
      await reservations.commitChangeSafely(s.t.db, desk, { previewToken: preview.token }),
    );
    expect(moved.booking.stays[0]?.unitId).toBe(k.units['501']);
    const dutyManager = org.staff('general_manager', 'Duty manager', [k.id]);
    await org.run(dutyManager, (tx) =>
      reservations.resolveRelocationCase(tx, {
        caseId: relocation?.id as string,
        outcome: 'completed',
        note: 'Complimentary upgrade to Sunset Water Villa 501',
      }),
    );
    // Return to sale only after the work order is completed.
    const done = await org.run(engineer, (tx) =>
      operations.completeWorkOrder(tx, wo.id, wo.version, { resolutionNote: 'Chiller compressor replaced' }),
    );
    // Not before a passed inspection after the repair (operations' return-to-service guard).
    await expect(
      org.run(engineer, (tx) => operations.returnToService(tx, wo.id, done.version)),
    ).rejects.toMatchObject({ code: 'return_to_service_blocked' });
    s.clock.advance(30 * 60_000);
    await readyUnit(s, org, k.id, k.units['305'] as string);
    const back = await org.run(engineer, async (tx) =>
      operations.returnToService(tx, wo.id, (await operations.getWorkOrder(tx, wo.id)).version),
    );
    expect(back.block?.status).toBe('released');
    const blocks = await org.run(org.setup, (tx) =>
      inventory.listBlocks(tx, {
        propertyId: k.id,
        range: { from: '2027-03-10', to: '2027-03-12' },
        status: 'active',
      }),
    );
    expect(blocks).toEqual([]);
    await assertGlobalConsistency(s, org, { auditActions: ['reservations.booking.create'] });
  });

  it.todo(
    'relocation of an arriving guest to a sister property of the group (groups/multi-property relocation not built)',
  );
  it.todo('relocation costs posted to the house account (no relocation-cost posting flow yet)');
});
