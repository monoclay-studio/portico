/**
 * Housekeeping planning on a realistic resort layout (island zones, overwater jetty): day plan from mirrored
 * stays, workload-balanced assignment suggestions with explanations, supervisor reassignment, room moves, DND,
 * discrepancies, and the seed helper.
 */
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedResortOperations } from '../src';
import {
  ATTENDANT_GRANTS,
  BUSINESS_DATE,
  type Harness,
  publish,
  SUPERVISOR_GRANTS,
  setupOrg,
  startHarness,
} from './support';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('housekeeping planning and workload balancing', () => {
  it('plans the day, suggests balanced assignments by section/zone with explanations, and applies them', async () => {
    const org = await setupOrg(h);
    const seeded = await org.tx(org.admin, (tx) =>
      seedResortOperations(tx, h.ops, { propertyId: org.propertyId, villasPerSection: 3 }),
    );
    expect(seeded.sections.map((s) => s.code)).toEqual(
      expect.arrayContaining(['SUNRISE', 'SUNSET', 'LAGOON', 'SR-N', 'SS-S', 'JETTY-A', 'JETTY-B']),
    );
    expect(seeded.attendants.length).toBeGreaterThanOrEqual(4);
    expect(seeded.preventiveSchedules.map((p) => p.code)).toEqual(
      expect.arrayContaining(['AC-SERVICE-90D', 'LADDER-INSPECT-30D']),
    );
    const supervisor = org.as(SUPERVISOR_GRANTS, { displayName: 'Supervisor Ibrahim' });
    // Seeded villas start dirty and vacant → vacant cleans; one jetty villa has a departure today.
    const departing = seeded.units.find((u) => u.number === 'A101');
    if (!departing) throw new Error('seed');
    const stayId = newId();
    await publish(h, org, {
      type: 'reservations.booking.confirmed',
      aggregate: { type: 'booking', id: newId() },
      payload: {
        bookingId: newId(),
        stays: [{ stayId, unitId: departing.unitId, arrival: '2026-11-03', departure: BUSINESS_DATE }],
      },
    });
    await publish(h, org, {
      type: 'reservations.stay.checkedIn',
      aggregate: { type: 'stay', id: stayId },
      payload: { stayId },
    });
    const plan = await org.tx(supervisor, (tx) => h.ops.generateDayPlan(tx, org.propertyId, {}));
    expect(plan.created.find((t) => t.unitId === departing.unitId)?.kind).toBe('departure_clean');
    expect(plan.created.filter((t) => t.kind === 'vacant_clean').length).toBe(seeded.units.length - 1);
    // Resort profile: turndown planned for the in-house stay.
    expect(plan.created.some((t) => t.kind === 'turndown' && t.unitId === departing.unitId)).toBe(false);
    // Re-running the plan creates nothing new (business identity).
    const again = await org.tx(supervisor, (tx) => h.ops.generateDayPlan(tx, org.propertyId, {}));
    expect(again.created).toHaveLength(0);
    expect(again.alreadyPlanned).toBeGreaterThan(0);

    const suggestions = await org.tx(supervisor, (tx) => h.ops.suggestAssignments(tx, org.propertyId, {}));
    expect(suggestions.unassigned).toEqual([]);
    expect(suggestions.suggestions).toHaveLength(plan.created.length);
    // Every suggestion explains itself; jetty villas go to the jetty attendant first.
    for (const s of suggestions.suggestions) expect(s.explanation[0]).toMatch(/load after \d+\/\d+ credits/);
    const jetty = suggestions.suggestions.filter((s) => s.unitNumber?.startsWith('A1'));
    expect(jetty[0]?.attendantName).toBe('Hawwa (Jetty A)');
    expect(jetty[0]?.explanation[0]).toContain('home section');
    // Nobody is pushed over capacity while colleagues have room.
    for (const w of suggestions.workload) expect(w.creditsAfter).toBeLessThanOrEqual(w.capacity);

    const applied = await org.tx(supervisor, (tx) =>
      h.ops.applyAssignments(tx, org.propertyId, {
        assignments: suggestions.suggestions.map((s) => ({
          taskId: s.taskId,
          expectedVersion: s.taskVersion,
          attendantId: s.attendantId,
        })),
      }),
    );
    expect(applied.conflicts).toEqual([]);
    expect(applied.applied.every((t) => t.assigneeUserId)).toBe(true);
    // Stale suggestion → reported per task, not applied.
    const stale = await org.tx(supervisor, (tx) =>
      h.ops.applyAssignments(tx, org.propertyId, {
        assignments: [
          {
            taskId: suggestions.suggestions[0]?.taskId ?? '',
            expectedVersion: suggestions.suggestions[0]?.taskVersion ?? 0,
            attendantId: suggestions.suggestions[0]?.attendantId ?? '',
          },
        ],
      }),
    );
    expect(stale.conflicts[0]?.code).toBe('version_conflict');

    // Supervisor reassigns with a reason; history keeps both.
    const t0 = applied.applied[0];
    if (!t0) throw new Error('task');
    const other = seeded.attendants.find((a) => a.userId !== t0.assigneeUserId);
    if (!other) throw new Error('attendant');
    const re = await org.tx(supervisor, (tx) =>
      h.ops.assignTask(
        tx,
        t0.id,
        { assigneeUserId: other.userId, reason: 'Balance after sick call' },
        { expectedVersion: t0.version },
      ),
    );
    expect(re.assigneeName).toBe(other.displayName);
    const hist = await org.tx(supervisor, (tx) => h.ops.getTask(tx, t0.id));
    expect(hist.history.filter((x) => x.kind === 'assigned').map((x) => x.to)).toEqual(
      expect.arrayContaining([other.displayName]),
    );

    // The board orders by priority and shows counts by condition and occupancy (never merged).
    const board = await org.tx(supervisor, (tx) => h.ops.board(tx, org.propertyId, {}));
    expect(board.counts.byOccupancy.occupied).toBe(1);
    expect(board.rows[0]?.unit).toHaveProperty('condition');
    expect(board.rows[0]?.unit).toHaveProperty('occupancy');
    expect(board.rows[0]?.unit.status).toEqual(
      expect.objectContaining({ condition: expect.any(String), occupancy: expect.any(String) }),
    );
  });

  it('checkout and room move events drive conditions and tasks; DND blocks in-room service', async () => {
    const org = await setupOrg(h);
    const seeded = await org.tx(org.admin, (tx) =>
      seedResortOperations(tx, h.ops, {
        propertyId: org.propertyId,
        villasPerSection: 1,
        initialCondition: 'inspected',
      }),
    );
    const [a, b] = seeded.units;
    if (!a || !b) throw new Error('seed');
    const supervisor = org.as(SUPERVISOR_GRANTS);
    const stayId = newId();
    await publish(h, org, {
      type: 'reservations.booking.confirmed',
      aggregate: { type: 'booking', id: newId() },
      payload: {
        bookingId: newId(),
        stays: [{ stayId, unitId: a.unitId, arrival: '2026-11-05', departure: '2026-11-09' }],
      },
    });
    await publish(h, org, {
      type: 'reservations.stay.checkedIn',
      aggregate: { type: 'stay', id: stayId },
      payload: { stayId },
    });
    const plan = await org.tx(supervisor, (tx) => h.ops.generateDayPlan(tx, org.propertyId, {}));
    const stayover = plan.created.find((t) => t.kind === 'stayover' && t.unitId === a.unitId);
    const turndown = plan.created.find((t) => t.kind === 'turndown' && t.unitId === a.unitId);
    expect(stayover).toBeDefined();
    expect(turndown).toBeDefined(); // resort profile: turndown on by default

    // DND → in-room service waits (blocked "Do not disturb"); cleared → released.
    const unitA = await org.tx(supervisor, (tx) => h.ops.getUnit(tx, a.unitId));
    const dnd = await org.tx(supervisor, (tx) =>
      h.ops.setDnd(tx, a.unitId, { dnd: true }, { expectedVersion: unitA.version }),
    );
    expect(dnd.unit.issues.map((i) => i.code)).toContain('dnd');
    const blocked = await org.tx(supervisor, (tx) => h.ops.getTask(tx, stayover?.id ?? ''));
    expect(blocked).toMatchObject({ status: { task: 'blocked' }, blockedReason: 'Do not disturb' });
    await org.tx(supervisor, (tx) =>
      h.ops.setDnd(tx, a.unitId, { dnd: false }, { expectedVersion: dnd.unit.version }),
    );
    expect((await org.tx(supervisor, (tx) => h.ops.getTask(tx, stayover?.id ?? ''))).status.task).toBe(
      'open',
    );

    // Guest moves from A to B: A needs a clean, the open service tasks follow the guest.
    await publish(h, org, {
      type: 'reservations.stay.moved',
      aggregate: { type: 'stay', id: stayId },
      payload: { stayId, fromUnitId: a.unitId, toUnitId: b.unitId },
    });
    const afterMove = await org.tx(supervisor, (tx) => h.ops.getUnit(tx, a.unitId));
    expect(afterMove).toMatchObject({ condition: 'dirty', occupancy: 'vacant' });
    expect((await org.tx(supervisor, (tx) => h.ops.getUnit(tx, b.unitId))).occupancy).toBe('occupied');
    expect((await org.tx(supervisor, (tx) => h.ops.getTask(tx, stayover?.id ?? ''))).unitId).toBe(b.unitId);

    // Checkout from B → dirty + one departure clean (event redelivery creates no duplicate).
    const checkout = {
      type: 'reservations.stay.checkedOut',
      aggregate: { type: 'stay', id: stayId },
      payload: { stayId },
    };
    await publish(h, org, checkout);
    await publish(h, org, checkout);
    const tasks = await org.tx(supervisor, (tx) =>
      h.ops.listTasks(tx, { propertyId: org.propertyId, unitId: b.unitId, limit: 50 }),
    );
    expect(tasks.filter((t) => t.kind === 'departure_clean')).toHaveLength(1);
    expect(tasks.find((t) => t.kind === 'turndown')?.status.task).toBe('cancelled');
    expect((await org.tx(supervisor, (tx) => h.ops.getUnit(tx, b.unitId))).condition).toBe('dirty');
  });

  it('housekeeping-reported discrepancies become a front-office exception with an owner', async () => {
    const org = await setupOrg(h);
    const seeded = await org.tx(org.admin, (tx) =>
      seedResortOperations(tx, h.ops, { propertyId: org.propertyId, villasPerSection: 1 }),
    );
    const unit = seeded.units[0];
    if (!unit) throw new Error('seed');
    const stayId = newId();
    await publish(h, org, {
      type: 'reservations.booking.confirmed',
      aggregate: { type: 'booking', id: newId() },
      payload: {
        bookingId: newId(),
        stays: [{ stayId, unitId: unit.unitId, arrival: '2026-11-05', departure: '2026-11-09' }],
      },
    });
    await publish(h, org, {
      type: 'reservations.stay.checkedIn',
      aggregate: { type: 'stay', id: stayId },
      payload: { stayId },
    });
    const attendant = org.as(ATTENDANT_GRANTS, { displayName: 'Aminath' });
    const u = await org.tx(attendant, (tx) => h.ops.getUnit(tx, unit.unitId));
    const r = await org.tx(attendant, (tx) =>
      h.ops.reportOccupancy(
        tx,
        unit.unitId,
        { observed: 'vacant', note: 'Wardrobe empty' },
        { expectedVersion: u.version },
      ),
    );
    expect(r.unit).toMatchObject({ discrepancy: 'skip', occupancy: 'occupied', observedOccupancy: 'vacant' });
    expect(r.unit.issues.find((i) => i.code === 'discrepancy_skip')?.severity).toBe('warning');
    const exceptions = await org.tx(org.admin, (tx) =>
      h.ops.listMyWork(tx, { propertyId: org.propertyId, departments: ['front_office'], limit: 20 }),
    );
    expect(exceptions.find((w) => w.title.startsWith('Verify occupancy (skip)'))).toMatchObject({
      owner: { kind: 'department' },
      priority: 'high',
      links: expect.arrayContaining([expect.objectContaining({ rel: 'stay', id: stayId })]),
    });
  });
});

describe('demo seed step', () => {
  it('falls back to sample units when inventory is not available, for a resort and a guesthouse', async () => {
    const { createOperationsDemoSeed, createOperationsService } = await import('../src');
    const ops = createOperationsService({
      ...h.ports,
      inventory: {
        ...h.ports.inventory,
        listUnits: async () => {
          throw new Error('inventory not available');
        },
      },
    });
    const resort = await setupOrg(h, { code: 'DEMO1' });
    const step = createOperationsDemoSeed(ops);
    await resort.tx(resort.admin, (tx) =>
      step.run(tx, { tenantId: resort.tenantId, properties: [{ id: resort.propertyId, profile: 'resort' }] }),
    );
    const board = await resort.tx(resort.admin, (tx) => ops.board(tx, resort.propertyId, {}));
    expect(board.rows.length).toBe(36);
    const guesthouse = await setupOrg(h, { code: 'DEMO2', profile: 'guesthouse' });
    await guesthouse.tx(guesthouse.admin, (tx) =>
      step.run(tx, {
        tenantId: guesthouse.tenantId,
        properties: [{ id: guesthouse.propertyId, profile: 'guesthouse' }],
      }),
    );
    const small = await guesthouse.tx(guesthouse.admin, (tx) => ops.board(tx, guesthouse.propertyId, {}));
    expect(small.rows).toHaveLength(12);
    // Guesthouse profile: clean is enough for arrival (inspection off by default).
    expect(small.rows[0]?.unit.readiness).toMatchObject({ requiredCondition: 'clean', ready: true });
  });
});

describe('stay date changes', () => {
  it('an extension cancels the departure clean planned for the old departure date', async () => {
    const org = await setupOrg(h);
    const seeded = await org.tx(org.admin, (tx) =>
      seedResortOperations(tx, h.ops, {
        propertyId: org.propertyId,
        villasPerSection: 1,
        initialCondition: 'inspected',
      }),
    );
    const unit = seeded.units[0];
    if (!unit) throw new Error('seed');
    const stayId = newId();
    await publish(h, org, {
      type: 'reservations.booking.confirmed',
      aggregate: { type: 'booking', id: newId() },
      payload: {
        bookingId: newId(),
        stays: [{ stayId, unitId: unit.unitId, arrival: '2026-11-04', departure: BUSINESS_DATE }],
      },
    });
    await publish(h, org, {
      type: 'reservations.stay.checkedIn',
      aggregate: { type: 'stay', id: stayId },
      payload: { stayId },
    });
    const plan = await org.tx(org.admin, (tx) => h.ops.generateDayPlan(tx, org.propertyId, {}));
    const departure = plan.created.find((t) => t.kind === 'departure_clean' && t.stayId === stayId);
    expect(departure).toBeDefined();
    await publish(h, org, {
      type: 'reservations.stay.extended',
      aggregate: { type: 'stay', id: stayId },
      payload: { stayId, departure: '2026-11-09' },
    });
    const after = await org.tx(org.admin, (tx) => h.ops.getTask(tx, departure?.id ?? ''));
    expect(after).toMatchObject({ status: { task: 'cancelled' }, cancelledReason: 'Stay dates changed' });
    expect((await org.tx(org.admin, (tx) => h.ops.getUnit(tx, unit.unitId))).occupancy).toBe('occupied');
  });
});

describe('payload shapes published by sibling modules', () => {
  it('learns arrivals from inventory assignment events and new dates from `to` on extension events', async () => {
    const org = await setupOrg(h);
    const seeded = await org.tx(org.admin, (tx) =>
      seedResortOperations(tx, h.ops, {
        propertyId: org.propertyId,
        villasPerSection: 1,
        initialCondition: 'clean',
      }),
    );
    const unit = seeded.units[0];
    if (!unit) throw new Error('seed');
    const stayId = newId();
    await publish(h, org, {
      type: 'inventory.assignment.changed',
      aggregate: { type: 'stay', id: stayId },
      payload: {
        propertyId: org.propertyId,
        ref: { type: 'stay', id: stayId },
        change: 'assigned',
        unitId: unit.unitId,
        previousUnitIds: [],
        nights: { from: BUSINESS_DATE, to: '2026-11-10' },
      },
    });
    const arrivals = await org.tx(org.admin, (tx) => h.ops.arrivalReadiness(tx, org.propertyId));
    expect(arrivals.items).toEqual([
      expect.objectContaining({
        stayId,
        unitId: unit.unitId,
        readiness: expect.objectContaining({ ready: false }),
      }),
    ]);
    await publish(h, org, {
      type: 'reservations.stay.extended',
      aggregate: { type: 'stay', id: stayId },
      payload: {
        stayId,
        from: { arrival: BUSINESS_DATE, departure: '2026-11-10' },
        to: { arrival: BUSINESS_DATE, departure: '2026-11-12' },
      },
    });
    const board = await org.tx(org.admin, (tx) => h.ops.board(tx, org.propertyId, { arrivalsOnly: true }));
    expect(board.rows.map((r) => r.unit.unitId)).toEqual([unit.unitId]);
  });
});
