/**
 * Regression tests for the steward review of feat/operations-core (docs/orchestration/reviews/review-operations.md).
 * Each test is the inverse of a review experiment that demonstrated a defect.
 */
import { BusinessRuleError, newId } from '@portico/kernel';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ATTENDANT_GRANTS,
  BUSINESS_DATE,
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

const now = () => h.clock.now().toISOString();
const ENGINEER = [
  'operations.maintenance.manage',
  'operations.maintenance.setInventoryImpact',
  'operations.task.manage',
  'operations.unit.read',
].map((permission) => ({ permission }));

describe('P0-1 offline sync never applies a stale change through a "no change" shortcut', () => {
  it('E1: a stale "cleaning/clean" chain after a failed inspection and re-clean is rejected, not applied', async () => {
    const org = await setupOrg(h);
    const [u] = await seedUnits(h, org, [{ number: 'E1', condition: 'dirty' }]);
    if (!u) throw new Error('unit');
    const mariyam = org.as(ATTENDANT_GRANTS, { displayName: 'Mariyam' });
    const hussain = org.as(ATTENDANT_GRANTS, { displayName: 'Hussain' });
    const supervisor = org.as(SUPERVISOR_GRANTS, { displayName: 'Supervisor' });
    const seen = await org.tx(mariyam, (tx) => h.ops.getUnit(tx, u));
    let v = seen.version;
    v = (
      await org.tx(hussain, (tx) =>
        h.ops.setCondition(tx, u, { condition: 'cleaning' }, { expectedVersion: v }),
      )
    ).unit.version;
    v = (
      await org.tx(hussain, (tx) => h.ops.setCondition(tx, u, { condition: 'clean' }, { expectedVersion: v }))
    ).unit.version;
    const failed = await org.tx(supervisor, (tx) =>
      h.ops.recordInspection(tx, u, { items: [], failureReasons: ['Hair in drain'] }),
    );
    // Hussain starts the re-clean task (the normal path; direct condition edits need an override).
    const reclean = failed.recleanTask;
    if (!reclean) throw new Error('reclean');
    await org.tx(hussain, (tx) =>
      h.ops.transitionTask(tx, reclean.id, { to: 'in_progress' }, { expectedVersion: reclean.version }),
    );
    const res = await h.ops.applySyncBatch(h.t.db, mariyam, {
      propertyId: org.propertyId,
      deviceId: 'dev-e1',
      mutations: [
        {
          clientMutationId: 'e1-m1-cleaning',
          clientTimestamp: now(),
          op: 'unit.setCondition',
          unitId: u,
          baseVersion: seen.version,
          condition: 'cleaning',
        },
        {
          clientMutationId: 'e1-m2-clean',
          clientTimestamp: now(),
          op: 'unit.setCondition',
          unitId: u,
          baseVersion: seen.version,
          condition: 'clean',
        },
      ],
    });
    expect(res.results.map((r) => [r.status, r.code])).toEqual([
      ['conflict', 'unit_already_inspected'],
      ['skipped', 'earlier_change_rejected'],
    ]);
    expect((await org.tx(supervisor, (tx) => h.ops.getUnit(tx, u))).condition).toBe('cleaning');
  });

  it('E1b: a stale "done" never completes a task reassigned to and started by someone else', async () => {
    const org = await setupOrg(h);
    const [u] = await seedUnits(h, org, [{ number: 'E1b', condition: 'dirty' }]);
    if (!u) throw new Error('unit');
    const ownerId = newId();
    const otherId = newId();
    const owner = org.as(SUPERVISOR_GRANTS, { userId: ownerId, displayName: 'Owner' });
    const manager = org.as(SUPERVISOR_GRANTS, { displayName: 'Manager' });
    const other = org.as(ATTENDANT_GRANTS, { userId: otherId, displayName: 'Other' });
    const plan = await org.tx(manager, (tx) => h.ops.generateDayPlan(tx, org.propertyId, {}));
    const t0 = plan.created.find((t) => t.unitId === u);
    if (!t0) throw new Error('task');
    const t1 = await org.tx(manager, (tx) =>
      h.ops.assignTask(tx, t0.id, { assigneeUserId: ownerId }, { expectedVersion: t0.version }),
    );
    const t2 = await org.tx(manager, (tx) =>
      h.ops.assignTask(tx, t0.id, { assigneeUserId: otherId }, { expectedVersion: t1.version }),
    );
    await org.tx(other, (tx) =>
      h.ops.transitionTask(tx, t0.id, { to: 'in_progress' }, { expectedVersion: t2.version }),
    );
    const res = await h.ops.applySyncBatch(h.t.db, owner, {
      propertyId: org.propertyId,
      deviceId: 'dev-e1b',
      mutations: [
        {
          clientMutationId: 'e1b-m1-start',
          clientTimestamp: now(),
          op: 'task.transition',
          taskId: t0.id,
          baseVersion: t1.version,
          to: 'in_progress',
        },
        {
          clientMutationId: 'e1b-m2-done',
          clientTimestamp: now(),
          op: 'task.transition',
          taskId: t0.id,
          baseVersion: t1.version,
          to: 'done',
        },
      ],
    });
    expect(res.results.map((r) => r.status)).toEqual(['conflict', 'skipped']);
    expect(res.results[0]?.code).toBe('task_reassigned');
    expect((await org.tx(manager, (tx) => h.ops.getTask(tx, t0.id))).status.task).toBe('in_progress');
  });
});

describe('P0-2 offline sync is authorized per mutation and never leaks records', () => {
  it('E2/E2b: a user without operations permission gets refusals, no records, no history, no conflict entries', async () => {
    const org = await setupOrg(h);
    const [u] = await seedUnits(h, org, [{ number: 'E2', condition: 'dirty' }]);
    if (!u) throw new Error('unit');
    const supervisor = org.as(SUPERVISOR_GRANTS);
    const task = await org.tx(supervisor, (tx) =>
      h.ops.createGenericTask(tx, {
        propertyId: org.propertyId,
        title: 'Call Mr Rasheed (room 12) about his anniversary cake',
        kind: 'guest_commitment',
        unitId: u,
      }),
    );
    const att = org.as(ATTENDANT_GRANTS, { displayName: 'Aishath' });
    const v = (await org.tx(att, (tx) => h.ops.getUnit(tx, u))).version;
    await org.tx(att, (tx) => h.ops.setCondition(tx, u, { condition: 'cleaning' }, { expectedVersion: v }));
    const nobody = org.as([{ permission: 'platform.property.read' }], { displayName: 'Finance clerk' });
    const res = await h.ops.applySyncBatch(h.t.db, nobody, {
      propertyId: org.propertyId,
      deviceId: 'x',
      mutations: [
        {
          clientMutationId: 'e2-probe-unit',
          clientTimestamp: now(),
          op: 'unit.setCondition',
          unitId: u,
          baseVersion: 0,
          condition: 'clean',
        },
        {
          clientMutationId: 'e2-probe-task',
          clientTimestamp: now(),
          op: 'task.comment',
          taskId: task.id,
          text: 'x',
          attachments: [],
        },
      ],
    });
    expect(res.results.map((r) => [r.status, r.code, r.conflict])).toEqual([
      ['rejected', 'forbidden', null],
      ['rejected', 'forbidden', null],
    ]);
    expect(res.units).toEqual([]);
    expect(res.tasks).toEqual([]);
    const list = await org.tx(supervisor, (tx) => h.ops.listSyncConflicts(tx, org.propertyId));
    expect(list).toEqual([]);
  });

  it('a user granted at another property cannot touch or read this property through sync', async () => {
    const org = await setupOrg(h);
    const [u] = await seedUnits(h, org, [{ number: 'P2', condition: 'dirty' }]);
    if (!u) throw new Error('unit');
    const elsewhere = org.as(ATTENDANT_GRANTS.map((g) => ({ ...g, propertyIds: [newId()] })));
    const res = await h.ops.applySyncBatch(h.t.db, elsewhere, {
      propertyId: org.propertyId,
      deviceId: 'x',
      mutations: [
        {
          clientMutationId: 'p2-probe-unit',
          clientTimestamp: now(),
          op: 'unit.setCondition',
          unitId: u,
          baseVersion: 1,
          condition: 'clean',
        },
      ],
    });
    expect(res.results[0]).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(res.units).toEqual([]);
  });

  it('the delta pull shows attendants housekeeping work only, not guest commitments or front-office tasks', async () => {
    const org = await setupOrg(h);
    const [u] = await seedUnits(h, org, [{ number: 'P26', condition: 'dirty' }]);
    if (!u) throw new Error('unit');
    const supervisor = org.as(SUPERVISOR_GRANTS);
    await org.tx(supervisor, (tx) =>
      h.ops.createGenericTask(tx, {
        propertyId: org.propertyId,
        title: 'Call Mr Rasheed',
        kind: 'guest_commitment',
        unitId: u,
      }),
    );
    await org.tx(supervisor, (tx) => h.ops.generateDayPlan(tx, org.propertyId, {}));
    const att = org.as(ATTENDANT_GRANTS);
    const pull = await org.tx(att, (tx) => h.ops.pullChanges(tx, { propertyId: org.propertyId, limit: 100 }));
    expect(pull.tasks.map((t) => t.kind)).toEqual(['vacant_clean']);
  });
});

describe('P1-2 stay projection is order-tolerant', () => {
  it('E3: a booking modification never resets an in-house stay to expected', async () => {
    const org = await setupOrg(h);
    const [u] = await seedUnits(h, org, [{ number: 'E3', condition: 'inspected' }]);
    if (!u) throw new Error('unit');
    const stayId = newId();
    const bookingId = newId();
    await publish(h, org, {
      type: 'reservations.booking.confirmed',
      aggregate: { type: 'booking', id: bookingId },
      payload: { bookingId, stays: [{ stayId, unitId: u, arrival: BUSINESS_DATE, departure: '2026-11-10' }] },
    });
    await publish(h, org, {
      type: 'reservations.stay.checkedIn',
      aggregate: { type: 'stay', id: stayId },
      payload: { stayId, unitId: u },
    });
    await publish(h, org, {
      type: 'reservations.booking.modified',
      aggregate: { type: 'booking', id: bookingId },
      payload: {
        bookingId,
        stays: [{ stayId, unitId: u, arrival: BUSINESS_DATE, departure: '2026-11-10', vip: true }],
      },
    });
    expect((await org.tx(org.admin, (tx) => h.ops.getUnit(tx, u))).occupancy).toBe('occupied');
    const arrivals = await org.tx(org.admin, (tx) => h.ops.arrivalReadiness(tx, org.propertyId));
    expect(arrivals.items.some((i) => i.stayId === stayId)).toBe(false);
  });

  it('E9: checkedIn delivered after checkedOut does not re-occupy the unit', async () => {
    const org = await setupOrg(h);
    const [u] = await seedUnits(h, org, [{ number: 'E9', condition: 'inspected' }]);
    if (!u) throw new Error('unit');
    const stayId = newId();
    await publish(h, org, {
      type: 'reservations.booking.confirmed',
      aggregate: { type: 'booking', id: newId() },
      payload: {
        bookingId: newId(),
        stays: [{ stayId, unitId: u, arrival: BUSINESS_DATE, departure: '2026-11-08' }],
      },
    });
    await publish(h, org, {
      type: 'reservations.stay.checkedOut',
      aggregate: { type: 'stay', id: stayId },
      payload: { stayId, unitId: u },
    });
    await publish(h, org, {
      type: 'reservations.stay.checkedIn',
      aggregate: { type: 'stay', id: stayId },
      payload: { stayId, unitId: u },
    });
    expect((await org.tx(org.admin, (tx) => h.ops.getUnit(tx, u))).occupancy).toBe('vacant');
  });

  it('versioned stay events: an older version is ignored, a newer one (reinstatement) applies', async () => {
    const org = await setupOrg(h);
    const [u] = await seedUnits(h, org, [{ number: 'V1', condition: 'inspected' }]);
    if (!u) throw new Error('unit');
    const stayId = newId();
    await publish(h, org, {
      type: 'reservations.booking.confirmed',
      aggregate: { type: 'booking', id: newId() },
      payload: {
        bookingId: newId(),
        stays: [{ stayId, unitId: u, arrival: BUSINESS_DATE, departure: '2026-11-09' }],
      },
    });
    await publish(h, org, {
      type: 'reservations.stay.checkedOut',
      aggregate: { type: 'stay', id: stayId },
      aggregateVersion: 5,
      payload: { stayId, unitId: u },
    });
    await publish(h, org, {
      type: 'reservations.stay.checkedIn',
      aggregate: { type: 'stay', id: stayId },
      aggregateVersion: 4,
      payload: { stayId, unitId: u },
    });
    expect((await org.tx(org.admin, (tx) => h.ops.getUnit(tx, u))).occupancy).toBe('vacant');
    await publish(h, org, {
      type: 'reservations.stay.checkedIn',
      aggregate: { type: 'stay', id: stayId },
      aggregateVersion: 6,
      payload: { stayId, unitId: u },
    });
    expect((await org.tx(org.admin, (tx) => h.ops.getUnit(tx, u))).occupancy).toBe('occupied');
  });
});

describe('P1-7 escalation is anchored on the service date', () => {
  it("E4: tomorrow's planned tasks do not escalate today", async () => {
    const org = await setupOrg(h);
    await seedUnits(h, org, [{ number: 'E4', condition: 'dirty' }]);
    const supervisor = org.as(SUPERVISOR_GRANTS);
    const plan = await org.tx(supervisor, (tx) =>
      h.ops.generateDayPlan(tx, org.propertyId, { date: '2026-11-08' }),
    );
    expect(plan.created.length).toBeGreaterThan(0);
    h.clock.advance(16 * 60_000);
    const sys = org.as([{ permission: 'operations.task.manage' }]);
    const r = await org.tx(sys, (tx) => h.ops.runEscalations(tx, org.propertyId));
    expect(r.escalated.filter((e) => plan.created.some((t) => t.id === e.taskId))).toEqual([]);
  });
});

describe('P2-2 DND does not survive checkout', () => {
  it('E5: checkout clears DND and a vacant unit gets no welfare check', async () => {
    const org = await setupOrg(h);
    const [u] = await seedUnits(h, org, [{ number: 'E5', condition: 'inspected' }]);
    if (!u) throw new Error('unit');
    const stayId = newId();
    await publish(h, org, {
      type: 'reservations.booking.confirmed',
      aggregate: { type: 'booking', id: newId() },
      payload: {
        bookingId: newId(),
        stays: [{ stayId, unitId: u, arrival: BUSINESS_DATE, departure: '2026-11-08' }],
      },
    });
    await publish(h, org, {
      type: 'reservations.stay.checkedIn',
      aggregate: { type: 'stay', id: stayId },
      payload: { stayId, unitId: u },
    });
    const attendant = org.as(ATTENDANT_GRANTS);
    const v = (await org.tx(attendant, (tx) => h.ops.getUnit(tx, u))).version;
    await org.tx(attendant, (tx) => h.ops.setDnd(tx, u, { dnd: true }, { expectedVersion: v }));
    await publish(h, org, {
      type: 'reservations.stay.checkedOut',
      aggregate: { type: 'stay', id: stayId },
      payload: { stayId, unitId: u },
    });
    expect(await org.tx(attendant, (tx) => h.ops.getUnit(tx, u))).toMatchObject({
      occupancy: 'vacant',
      dnd: false,
    });
    h.clock.advance(49 * 3_600_000);
    const sys = org.as([{ permission: 'operations.task.manage' }]);
    expect((await org.tx(sys, (tx) => h.ops.runEscalations(tx, org.propertyId))).welfareChecks).toEqual([]);
  });
});

describe('P1-4 maintenance forward mode becomes effective on acknowledgement', () => {
  it('E6: acknowledged create/block make the work order effective; return to service completes after the release ack', async () => {
    const org = await setupOrg(h);
    await org.tx(org.admin, (tx) =>
      platform.setDataAuthority(tx, {
        propertyId: org.propertyId,
        domain: 'maintenance',
        authority: 'external',
        connectionId: newId(),
        systemName: 'CMMS',
        writeMode: 'forward',
        reason: 'test',
      }),
    );
    await org.tx(org.admin, (tx) =>
      platform.setPolicy(tx, {
        key: 'operations.settings',
        scopeType: 'property',
        scopeId: org.propertyId,
        value: { returnToService: { requireInspection: false, requireCleaning: false } },
        reason: 'test',
      }),
    );
    const [u] = await seedUnits(h, org, [{ number: 'E6' }]);
    if (!u) throw new Error('unit');
    const engineer = org.as(ENGINEER);
    const integration = org.as([
      { permission: 'operations.external.sync' },
      { permission: 'operations.unit.read' },
    ]);
    const ackAll = async () => {
      for (const f of await org.tx(integration, (tx) => h.ops.listForwards(tx, org.propertyId, 'pending')))
        await org.tx(integration, (tx) => h.ops.acknowledgeForward(tx, f.id, { outcome: 'acknowledged' }));
    };
    const wo = await org.tx(engineer, (tx) =>
      h.ops.createWorkOrder(tx, {
        propertyId: org.propertyId,
        unitId: u,
        title: 'AC',
        faultCategory: 'ac',
        urgency: 'high',
        block: { kind: 'out_of_order', from: BUSINESS_DATE, to: '2026-11-09', reason: 'AC dead' },
      }),
    );
    await ackAll();
    const after = await org.tx(engineer, (tx) => h.ops.getWorkOrder(tx, wo.id));
    expect(after).toMatchObject({ authorityState: 'effective', block: { status: 'active' } });
    expect((await org.tx(engineer, (tx) => h.ops.getUnit(tx, u))).block?.kind).toBe('out_of_order');
    const done = await org.tx(engineer, (tx) =>
      h.ops.completeWorkOrder(tx, wo.id, after.version, { resolutionNote: 'fixed' }),
    );
    const rts = await org.tx(engineer, (tx) => h.ops.returnToService(tx, wo.id, done.version));
    expect(rts.block.status).toBe('pending_forward');
    await ackAll();
    expect(await org.tx(engineer, (tx) => h.ops.getWorkOrder(tx, wo.id))).toMatchObject({
      returnToService: 'returned',
      block: { status: 'released' },
    });
    expect((await org.tx(engineer, (tx) => h.ops.getUnit(tx, u))).block).toBeNull();
  });
});

describe('P2-3 return to service needs an inspection PERFORMED after the repair', () => {
  it('E8: an offline inspection made before completion (synced after) does not release the block', async () => {
    const org = await setupOrg(h);
    await org.tx(org.admin, (tx) =>
      platform.setPolicy(tx, {
        key: 'operations.settings',
        scopeType: 'property',
        scopeId: org.propertyId,
        value: { returnToService: { requireCleaning: false, requireInspection: true } },
        reason: 'test',
      }),
    );
    const [u] = await seedUnits(h, org, [{ number: 'E8', condition: 'inspected' }]);
    if (!u) throw new Error('unit');
    const engineer = org.as(ENGINEER);
    const inspector = org.as(SUPERVISOR_GRANTS, { displayName: 'Inspector' });
    const wo = await org.tx(engineer, (tx) =>
      h.ops.createWorkOrder(tx, {
        propertyId: org.propertyId,
        unitId: u,
        title: 'Leak',
        faultCategory: 'plumbing',
        urgency: 'high',
        block: { kind: 'out_of_order', from: BUSINESS_DATE, to: '2026-11-09', reason: 'Leak' },
      }),
    );
    const seen = await org.tx(inspector, (tx) => h.ops.getUnit(tx, u));
    const inspectedOfflineAt = now();
    h.clock.advance(30 * 60_000);
    await org.tx(engineer, (tx) =>
      h.ops.completeWorkOrder(tx, wo.id, wo.version, { resolutionNote: 'Pipe replaced' }),
    );
    h.clock.advance(30 * 60_000);
    await h.ops.applySyncBatch(h.t.db, inspector, {
      propertyId: org.propertyId,
      deviceId: 'insp',
      mutations: [
        {
          clientMutationId: 'e8-inspection-offline',
          clientTimestamp: inspectedOfflineAt,
          op: 'inspection.record',
          unitId: u,
          baseVersion: seen.version,
          inspection: { items: [] },
        },
      ],
    });
    const wo2 = await org.tx(engineer, (tx) => h.ops.getWorkOrder(tx, wo.id));
    expect(wo2.returnToService).toBe('awaiting_inspection');
    await expect(
      org.tx(engineer, (tx) => h.ops.returnToService(tx, wo.id, wo2.version)),
    ).rejects.toMatchObject({
      code: 'return_to_service_blocked',
      details: { missing: [{ code: 'inspection_not_passed' }] },
    });
  });
});

describe('P1-1 / P1-12 / ADR-0015 inventory blocks', () => {
  it('R3: a refused block keeps the work order with the reason and next step (no rollback)', async () => {
    const org = await setupOrg(h);
    const [u] = await seedUnits(h, org, [{ number: 'R3' }]);
    if (!u) throw new Error('unit');
    const engineer = org.as(ENGINEER);
    const block = { kind: 'out_of_order' as const, from: BUSINESS_DATE, to: '2026-11-09', reason: 'AC dead' };
    await org.tx(engineer, (tx) =>
      h.ops.createWorkOrder(tx, {
        propertyId: org.propertyId,
        unitId: u,
        title: 'AC',
        faultCategory: 'ac',
        block,
      }),
    );
    const second = await org.tx(engineer, (tx) =>
      h.ops.createWorkOrder(tx, {
        propertyId: org.propertyId,
        unitId: u,
        title: 'Leak too',
        faultCategory: 'plumbing',
        block,
      }),
    );
    expect(second.block).toMatchObject({ status: 'refused', refusal: { code: 'unit_already_blocked' } });
    expect(second.issues.find((i) => i.code === 'block_refused')?.message).toContain('Next step');
    // Another refusal kind from inventory is recorded the same way; the request can be retried later.
    h.inventory.refuseNext = new BusinessRuleError(
      'forwarding_not_available',
      'Availability is managed in the PMS.',
    );
    const [u2] = await seedUnits(h, org, [{ number: 'R3b' }]);
    if (!u2) throw new Error('unit');
    const third = await org.tx(engineer, (tx) =>
      h.ops.createWorkOrder(tx, {
        propertyId: org.propertyId,
        unitId: u2,
        title: 'Door',
        faultCategory: 'carpentry',
        block,
      }),
    );
    expect(third.block.refusal?.code).toBe('forwarding_not_available');
    const retry = await org.tx(engineer, (tx) =>
      h.ops.requestUnitBlock(tx, third.id, block, { expectedVersion: third.version }),
    );
    expect(retry.block.status).toBe('active');
  });

  it('R5: a late `inventory.unit.blocked` after return to service never re-blocks the unit', async () => {
    const org = await setupOrg(h);
    await org.tx(org.admin, (tx) =>
      platform.setPolicy(tx, {
        key: 'operations.settings',
        scopeType: 'property',
        scopeId: org.propertyId,
        value: { returnToService: { requireInspection: false, requireCleaning: false } },
        reason: 'test',
      }),
    );
    const [u] = await seedUnits(h, org, [{ number: 'R5' }]);
    if (!u) throw new Error('unit');
    const engineer = org.as(ENGINEER);
    const wo = await org.tx(engineer, (tx) =>
      h.ops.createWorkOrder(tx, {
        propertyId: org.propertyId,
        unitId: u,
        title: 'AC',
        faultCategory: 'ac',
        block: { kind: 'out_of_order', from: BUSINESS_DATE, to: '2026-11-09', reason: 'AC' },
      }),
    );
    const done = await org.tx(engineer, (tx) =>
      h.ops.completeWorkOrder(tx, wo.id, wo.version, { resolutionNote: 'ok' }),
    );
    await org.tx(engineer, (tx) => h.ops.returnToService(tx, wo.id, done.version));
    // Inventory's own events arrive afterwards (no ordering guarantee).
    await publish(h, org, {
      type: 'inventory.unit.blocked',
      aggregate: { type: 'unit', id: u },
      payload: {
        unitId: u,
        blockId: wo.block.blockId,
        kind: 'out_of_order',
        nights: { from: BUSINESS_DATE, to: '2026-11-09' },
        affectedAssignments: [],
      },
    });
    await publish(h, org, {
      type: 'inventory.unit.unblocked',
      aggregate: { type: 'unit', id: u },
      payload: { unitId: u, blockId: wo.block.blockId },
    });
    expect(await org.tx(engineer, (tx) => h.ops.getUnit(tx, u))).toMatchObject({
      block: null,
      readiness: { ready: true },
    });
  });

  it('R4: a block released directly in inventory is flagged on the work order as a blocking issue', async () => {
    const org = await setupOrg(h);
    const [u] = await seedUnits(h, org, [{ number: 'R4' }]);
    if (!u) throw new Error('unit');
    const engineer = org.as(ENGINEER);
    const wo = await org.tx(engineer, (tx) =>
      h.ops.createWorkOrder(tx, {
        propertyId: org.propertyId,
        unitId: u,
        title: 'Leak',
        faultCategory: 'plumbing',
        block: { kind: 'out_of_order', from: BUSINESS_DATE, to: '2026-11-09', reason: 'Leak' },
      }),
    );
    await publish(h, org, {
      type: 'inventory.unit.unblocked',
      aggregate: { type: 'unit', id: u },
      payload: { unitId: u, blockId: wo.block.blockId },
    });
    const after = await org.tx(engineer, (tx) => h.ops.getWorkOrder(tx, wo.id));
    expect(after.block).toMatchObject({ status: 'released', releasedExternallyAt: expect.any(String) });
    expect(after.issues.map((i) => i.code)).toContain('released_outside_return_to_service');
  });
});

describe('P1-9 OPS-R22(c): offline "clean" for a unit that became occupied meanwhile', () => {
  it('applies the change and asks the front office to check the unit', async () => {
    const org = await setupOrg(h);
    const [u] = await seedUnits(h, org, [{ number: 'C1', condition: 'dirty' }]);
    if (!u) throw new Error('unit');
    const attendant = org.as(ATTENDANT_GRANTS);
    const seen = await org.tx(attendant, (tx) => h.ops.getUnit(tx, u));
    const cleanedAt = now();
    h.clock.advance(10 * 60_000);
    const stayId = newId();
    await publish(h, org, {
      type: 'reservations.booking.confirmed',
      aggregate: { type: 'booking', id: newId() },
      payload: {
        bookingId: newId(),
        stays: [{ stayId, unitId: u, arrival: BUSINESS_DATE, departure: '2026-11-09' }],
      },
    });
    await publish(h, org, {
      type: 'reservations.stay.checkedIn',
      aggregate: { type: 'stay', id: stayId },
      payload: { stayId, unitId: u },
    });
    const res = await h.ops.applySyncBatch(h.t.db, attendant, {
      propertyId: org.propertyId,
      deviceId: 'd',
      mutations: [
        {
          clientMutationId: 'c1-clean',
          clientTimestamp: cleanedAt,
          op: 'unit.setCondition',
          unitId: u,
          baseVersion: seen.version,
          condition: 'clean',
        },
      ],
    });
    expect(res.results[0]).toMatchObject({ status: 'applied', code: 'applied_unit_now_occupied' });
    const work = await org.tx(org.admin, (tx) =>
      h.ops.listMyWork(tx, { propertyId: org.propertyId, departments: ['front_office'], limit: 10 }),
    );
    expect(work.some((w) => w.title.startsWith('Check unit: reported clean offline'))).toBe(true);
  });
});

describe('P2-15 / P2-11 / P2-14 smaller review fixes', () => {
  it('leaving an inspection result directly needs inspect/override permission and a reason', async () => {
    const org = await setupOrg(h);
    const [u] = await seedUnits(h, org, [{ number: 'O1', condition: 'inspected' }]);
    if (!u) throw new Error('unit');
    const attendant = org.as(ATTENDANT_GRANTS);
    const supervisor = org.as(SUPERVISOR_GRANTS);
    const v = (await org.tx(attendant, (tx) => h.ops.getUnit(tx, u))).version;
    await expect(
      org.tx(attendant, (tx) => h.ops.setCondition(tx, u, { condition: 'dirty' }, { expectedVersion: v })),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      org.tx(supervisor, (tx) => h.ops.setCondition(tx, u, { condition: 'dirty' }, { expectedVersion: v })),
    ).rejects.toMatchObject({ code: 'reason_required' });
    const r = await org.tx(supervisor, (tx) =>
      h.ops.setCondition(
        tx,
        u,
        { condition: 'dirty', reason: 'Guest viewed the villa and used the bathroom' },
        { expectedVersion: v },
      ),
    );
    expect(r.unit.condition).toBe('dirty');
  });

  it('a cancelled booking cancels the planned in-room service for its stay', async () => {
    const org = await setupOrg(h); // resort profile: turndown planned for tonight's arrivals
    const [u] = await seedUnits(h, org, [{ number: 'X1', condition: 'inspected' }]);
    if (!u) throw new Error('unit');
    const stayId = newId();
    const bookingId = newId();
    await publish(h, org, {
      type: 'reservations.booking.confirmed',
      aggregate: { type: 'booking', id: bookingId },
      payload: { bookingId, stays: [{ stayId, unitId: u, arrival: BUSINESS_DATE, departure: '2026-11-09' }] },
    });
    const plan = await org.tx(org.admin, (tx) => h.ops.generateDayPlan(tx, org.propertyId, {}));
    const turndown = plan.created.find((t) => t.kind === 'turndown' && t.stayId === stayId);
    expect(turndown).toBeDefined();
    await publish(h, org, {
      type: 'reservations.booking.cancelled',
      aggregate: { type: 'booking', id: bookingId },
      payload: { bookingId, stayIds: [stayId] },
    });
    const after = await org.tx(org.admin, (tx) => h.ops.getTask(tx, turndown?.id ?? ''));
    expect(after).toMatchObject({ status: { task: 'cancelled' }, cancelledReason: 'Booking cancelled' });
  });

  it('readiness is refreshed when the business date advances (a future block becomes active)', async () => {
    const org = await setupOrg(h);
    const [u] = await seedUnits(h, org, [{ number: 'BD1', condition: 'inspected' }]);
    if (!u) throw new Error('unit');
    const engineer = org.as(ENGINEER);
    await org.tx(engineer, (tx) =>
      h.ops.createWorkOrder(tx, {
        propertyId: org.propertyId,
        unitId: u,
        title: 'Planned repaint',
        faultCategory: 'painting',
        block: { kind: 'out_of_service', from: '2026-11-08', to: '2026-11-10', reason: 'Repaint' },
      }),
    );
    expect(
      (await org.tx(engineer, (tx) => h.ops.listUnitConditions(tx, { propertyId: org.propertyId })))[0]
        ?.ready,
    ).toBe(true);
    await org.tx(org.admin, (tx) => platform.advanceBusinessDate(tx, org.propertyId, BUSINESS_DATE));
    await publish(h, org, {
      type: 'platform.property.businessDateAdvanced',
      aggregate: { type: 'property', id: org.propertyId },
      payload: { propertyId: org.propertyId, from: BUSINESS_DATE, to: '2026-11-08' },
    });
    expect(
      (await org.tx(engineer, (tx) => h.ops.listUnitConditions(tx, { propertyId: org.propertyId })))[0]
        ?.ready,
    ).toBe(false);
  });
});
