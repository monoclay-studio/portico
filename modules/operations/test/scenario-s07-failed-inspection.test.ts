/**
 * Scenario 7 (brief §17): a room fails inspection just before its arriving guest reaches reception.
 * Operations' part: the failure is recorded with checklist reasons, the attendant who cleaned the villa is
 * re-tasked with an urgent re-clean, `operations.inspection.failed` names the affected arriving stay with an
 * expected-ready ESTIMATE, and the readiness API shows "not ready" with the reason and ETA — before the guest
 * reaches reception. Then the re-clean passes and the villa becomes ready.
 */
import { sql } from '@portico/db';
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ATTENDANT_GRANTS,
  BUSINESS_DATE,
  eventsOf,
  type Harness,
  publish,
  SUPERVISOR_GRANTS,
  seedUnits,
  setupOrg,
  startHarness,
} from './support';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('scenario 7: a villa fails inspection just before its arriving guest reaches reception', () => {
  it('re-tasks the attendant, tells the front desk which arrival is affected, and shows not-ready with reason + ETA', async () => {
    const org = await setupOrg(h);
    const [w101] = await seedUnits(h, org, [{ number: 'W101', sectionCode: 'JA', condition: 'inspected' }]);
    if (!w101) throw new Error('unit');
    const aminathId = newId();
    const aminath = org.as(ATTENDANT_GRANTS, { userId: aminathId, displayName: 'Aminath' });
    const supervisor = org.as(SUPERVISOR_GRANTS, { displayName: 'Supervisor Ibrahim' });
    const frontDesk = org.as(
      [{ permission: 'operations.unit.read' }, { permission: 'operations.task.manage' }],
      {
        displayName: 'Front desk',
      },
    );
    await org.tx(org.admin, async (tx) => {
      await h.ops.upsertAttendant(tx, org.propertyId, {
        userId: aminathId,
        displayName: 'Aminath',
        homeSectionCodes: ['JA'],
        dailyCreditCapacity: 24,
      });
      await h.ops.createChecklistTemplate(tx, org.propertyId, {
        code: 'water-villa',
        name: 'Water villa pre-arrival',
        purpose: 'unit',
        items: [
          { code: 'bath', label: 'Bathroom', critical: true },
          { code: 'deck', label: 'Deck & ladder', critical: true },
          { code: 'minibar', label: 'Minibar', critical: false },
        ],
      });
    });

    // The departing guest (in house since 4 Nov) and today's VIP arrival on the same villa, ETA 10:30 local.
    const departingStay = newId();
    const arrivingStay = newId();
    await publish(h, org, {
      type: 'reservations.booking.confirmed',
      aggregate: { type: 'booking', id: newId() },
      payload: {
        bookingId: newId(),
        stays: [{ stayId: departingStay, unitId: w101, arrival: '2026-11-04', departure: BUSINESS_DATE }],
      },
    });
    await publish(h, org, {
      type: 'reservations.stay.checkedIn',
      aggregate: { type: 'stay', id: departingStay },
      payload: { stayId: departingStay, unitId: w101 },
    });
    await publish(h, org, {
      type: 'reservations.booking.confirmed',
      aggregate: { type: 'booking', id: newId() },
      payload: {
        bookingId: newId(),
        stays: [
          {
            stayId: arrivingStay,
            unitId: w101,
            arrival: BUSINESS_DATE,
            departure: '2026-11-12',
            vip: true,
            eta: '2026-11-07T05:30:00Z',
            guestLabel: 'Mr & Mrs Rasheed',
          },
        ],
      },
    });
    const occupied = await org.tx(frontDesk, (tx) => h.ops.getUnit(tx, w101));
    expect(occupied).toMatchObject({
      occupancy: 'occupied',
      occupancyStayId: departingStay,
      condition: 'inspected',
    });

    // 09:00 — checkout → villa dirty + departure clean (priority: VIP arrival due soon).
    await publish(h, org, {
      type: 'reservations.stay.checkedOut',
      aggregate: { type: 'stay', id: departingStay },
      payload: { stayId: departingStay },
    });
    const clean = (
      await org.tx(supervisor, (tx) => h.ops.listTasks(tx, { propertyId: org.propertyId, limit: 50 }))
    ).find((t) => t.kind === 'departure_clean');
    expect(clean).toMatchObject({
      unitId: w101,
      status: 'open',
      priorityReasons: expect.arrayContaining(['arrival_due_soon', 'vip']),
    });
    if (!clean) throw new Error('departure clean');

    // Supervisor accepts the assignment suggestion (home section JA → Aminath).
    const suggestions = await org.tx(supervisor, (tx) => h.ops.suggestAssignments(tx, org.propertyId, {}));
    expect(suggestions.suggestions[0]).toMatchObject({ taskId: clean.id, attendantName: 'Aminath' });
    await org.tx(supervisor, (tx) =>
      h.ops.applyAssignments(tx, org.propertyId, {
        assignments: [
          {
            taskId: clean.id,
            expectedVersion: clean.version,
            attendantId: suggestions.suggestions[0]?.attendantId ?? '',
          },
        ],
      }),
    );

    // Aminath cleans: start → done. The villa becomes clean and an inspection task appears.
    const started = await org.tx(aminath, (tx) =>
      h.ops.transitionTask(tx, clean.id, { to: 'in_progress' }, { expectedVersion: clean.version + 1 }),
    );
    h.clock.advance(35 * 60_000);
    await org.tx(aminath, (tx) =>
      h.ops.transitionTask(tx, clean.id, { to: 'done' }, { expectedVersion: started.version }),
    );
    const afterClean = await org.tx(frontDesk, (tx) => h.ops.getUnitReadiness(tx, w101));
    expect(afterClean.condition).toBe('clean');
    expect(afterClean.readiness).toMatchObject({ ready: false, reasons: [{ code: 'awaiting_inspection' }] });

    // 09:45 — the supervisor inspects and FAILS the villa (guest lands at the jetty at 10:30).
    h.clock.advance(10 * 60_000);
    const result = await org.tx(supervisor, (tx) =>
      h.ops.recordInspection(tx, w101, {
        checklistCode: 'water-villa',
        items: [
          {
            code: 'bath',
            result: 'fail',
            note: 'hair in shower drain',
            photoRefs: ['obj://inspections/w101-1.jpg'],
          },
          { code: 'deck', result: 'pass' },
          { code: 'minibar', result: 'pass' },
        ],
      }),
    );
    expect(result.inspection).toMatchObject({
      result: 'failed',
      reasons: ['Bathroom: hair in shower drain'],
      affectedStayId: arrivingStay,
      inspector: 'Supervisor Ibrahim',
    });
    expect(result.unit.condition).toBe('failed_inspection');
    // The attendant who cleaned it is re-tasked immediately, with the reason and an elevated priority.
    expect(result.recleanTask).toMatchObject({
      kind: 'reclean',
      assigneeUserId: aminathId,
      assigneeName: 'Aminath',
      description: 'Bathroom: hair in shower drain',
      priorityReasons: expect.arrayContaining(['failed_inspection', 'arrival_due_soon', 'vip']),
    });
    expect(['high', 'urgent']).toContain(result.recleanTask?.priority);

    // The front desk is told before the guest arrives: event naming the arriving stay + ETA.
    const [failed] = await eventsOf(h, org.tenantId, 'operations.inspection.failed');
    expect(failed?.payload).toMatchObject({
      unitId: w101,
      unitNumber: 'W101',
      reasons: ['Bathroom: hair in shower drain'],
      recleanAssigneeName: 'Aminath',
      affectedStay: { stayId: arrivingStay, vip: true },
      ready: false,
    });
    // ETA = re-clean 2 credits × 10 min + inspection 10 min = 30 min after the failed inspection (09:45 → 10:15).
    expect(failed?.payload.expectedReadyAt).toBe('2026-11-07T05:15:00.000Z');

    // Readiness API for the desk: not ready, why, and the estimate.
    const board = await org.tx(frontDesk, (tx) => h.ops.arrivalReadiness(tx, org.propertyId));
    const item = board.items.find((i) => i.stayId === arrivingStay);
    expect(item).toMatchObject({ unitNumber: 'W101', vip: true, readiness: { ready: false } });
    expect(item?.blocker).toContain('failed inspection: Bathroom: hair in shower drain');
    expect(item?.readiness?.expectedReadyAt).toBe('2026-11-07T05:15:00.000Z');
    expect(item?.readiness?.estimateBasis.join(' ')).toContain('Aminath');

    // Aminath re-cleans; supervisor re-inspects and passes → ready for the guest.
    const reclean = result.recleanTask;
    if (!reclean) throw new Error('reclean');
    h.clock.advance(15 * 60_000);
    await org.tx(aminath, (tx) =>
      h.ops.transitionTask(tx, reclean.id, { to: 'done' }, { expectedVersion: reclean.version }),
    );
    h.clock.advance(5 * 60_000);
    const passed = await org.tx(supervisor, (tx) =>
      h.ops.recordInspection(tx, w101, {
        checklistCode: 'water-villa',
        items: [
          { code: 'bath', result: 'pass' },
          { code: 'deck', result: 'pass' },
          { code: 'minibar', result: 'pass' },
        ],
      }),
    );
    expect(passed.unit).toMatchObject({ condition: 'inspected', readiness: { ready: true } });
    const ready = await org.tx(frontDesk, (tx) => h.ops.arrivalReadiness(tx, org.propertyId));
    expect(ready.items.find((i) => i.stayId === arrivingStay)).toMatchObject({
      blocker: null,
      readiness: { ready: true },
    });

    // History: both cleanings verified/done, inspections append-only, audit trail present.
    const recleanDetail = await org.tx(supervisor, (tx) => h.ops.getTask(tx, reclean.id));
    expect(recleanDetail.status).toBe('verified');
    const audit = await h.t.admin.kysely
      .selectFrom('core.audit_log')
      .select(['action'])
      .where('tenant_id', '=', org.tenantId)
      .where('target_id', '=', w101)
      .execute();
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'operations.inspection.failed',
        'operations.inspection.passed',
        'operations.unit.conditionChange',
      ]),
    );
    // Inspection records are immutable (append-only, enforced by the database).
    await expect(
      org.tx(org.admin, (tx) => sql`update operations.inspections set result = 'passed'`.execute(tx.db)),
    ).rejects.toThrow(/append-only|permission denied/);
  });
});
