/**
 * Scenario 8 (brief §17): a maintenance outage makes several assigned rooms unavailable.
 * Operations' part: work orders take the villas out of order through the InventoryPort (fake here), the stays
 * inventory reports as assigned become "resolution required" items for the front office, and the villas return
 * to sale only after the repair is completed AND a passed inspection is on record (configurable policy).
 */
import { newId } from '@portico/kernel';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ATTENDANT_GRANTS,
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

const ENGINEER = ['operations.maintenance.manage', 'operations.unit.read', 'operations.task.manage'].map(
  (permission) => ({
    permission,
  }),
);

describe('scenario 8: a jetty water outage makes several assigned villas unavailable', () => {
  it('blocks the villas, lists every affected stay for front office, and gates return to service', async () => {
    const org = await setupOrg(h);
    const [w201, w202, w203] = await seedUnits(h, org, [
      { number: 'W201', sectionCode: 'JB' },
      { number: 'W202', sectionCode: 'JB' },
      { number: 'W203', sectionCode: 'JB' },
    ]);
    if (!w201 || !w202 || !w203) throw new Error('units');
    const s1 = newId();
    const s2 = newId();
    const s3 = newId();
    h.inventory.assign(w201, s1, { from: '2026-11-07', to: '2026-11-10' }); // in the outage
    h.inventory.assign(w201, s2, { from: '2026-11-12', to: '2026-11-14' }); // after the outage
    h.inventory.assign(w202, s3, { from: '2026-11-08', to: '2026-11-09' }); // in the outage
    const engineer = org.as(ENGINEER, { displayName: 'Chief Engineer' });
    const frontDesk = org.as([
      { permission: 'operations.unit.read' },
      { permission: 'operations.task.manage' },
    ]);

    const asset = await org.tx(engineer, (tx) =>
      h.ops.createAsset(tx, org.propertyId, {
        kind: 'public_area',
        code: 'JETTY-B',
        name: 'Water villa jetty B',
        category: 'jetty',
      }),
    );
    const block = {
      kind: 'out_of_order' as const,
      from: '2026-11-07',
      to: '2026-11-11',
      reason: 'Jetty B water main burst',
    };
    const orders = [];
    for (const unitId of [w201, w202, w203]) {
      orders.push(
        await org.tx(engineer, (tx) =>
          h.ops.createWorkOrder(tx, {
            propertyId: org.propertyId,
            unitId,
            title: 'No water supply — jetty B main',
            faultCategory: 'plumbing',
            urgency: 'emergency',
            photos: [{ ref: 'obj://wo/jetty-b-main.jpg', caption: 'Burst main under deck 3' }],
            block,
          }),
        ),
      );
    }
    expect(h.inventory.calls.filter((c) => c.startsWith('blockUnit'))).toHaveLength(3);
    for (const wo of orders) {
      expect(wo).toMatchObject({
        urgency: 'emergency',
        block: { status: 'active', kind: 'out_of_order', from: '2026-11-07', to: '2026-11-11' },
        returnToService: 'awaiting_completion',
        task: { kind: 'work_order', priority: 'urgent', departmentKind: 'engineering' },
      });
      expect(wo.task.dueAt).toBe('2026-11-07T05:00:00.000Z'); // emergency: 60 min
    }

    // Front office sees exactly the stays that need resolution (S1 on W201, S3 on W202; not S2).
    const items = await org.tx(frontDesk, (tx) => h.ops.listResolutionItems(tx, org.propertyId, 'open'));
    expect(items.map((i) => [i.unitNumber, i.ref.id]).sort()).toEqual(
      [
        ['W201', s1],
        ['W202', s3],
      ].sort(),
    );
    const required = await eventsOf(h, org.tenantId, 'operations.resolution.required');
    expect(required).toHaveLength(2);

    // Inventory's own `inventory.unit.blocked` event for the same block is idempotent (no duplicates).
    const wo1 = orders[0];
    if (!wo1) throw new Error('wo');
    await publish(h, org, {
      type: 'inventory.unit.blocked',
      aggregate: { type: 'unit', id: w201 },
      payload: {
        unitId: w201,
        blockId: wo1.block.blockId,
        kind: 'out_of_order',
        nights: { from: '2026-11-07', to: '2026-11-11' },
        affectedAssignments: [
          { ref: { type: 'stay', id: s1 }, nights: { from: '2026-11-07', to: '2026-11-10' } },
        ],
        sourceRef: { type: 'workOrder', id: wo1.id },
      },
    });
    expect(
      await org.tx(frontDesk, (tx) => h.ops.listResolutionItems(tx, org.propertyId, 'open')),
    ).toHaveLength(2);

    // Board: blocked villas are not ready, with the reason.
    const unit = await org.tx(frontDesk, (tx) => h.ops.getUnitReadiness(tx, w201));
    expect(unit.block).toMatchObject({ kind: 'out_of_order', workOrderId: wo1.id });
    expect(unit.readiness.reasons[0]).toMatchObject({ code: 'out_of_order' });
    expect(unit.readiness.reasons[0]?.message).toContain('Jetty B water main burst');

    // Return to service is refused until repair + inspection — with the explanation.
    await expect(
      org.tx(engineer, (tx) => h.ops.returnToService(tx, wo1.id, wo1.version)),
    ).rejects.toMatchObject({
      code: 'return_to_service_blocked',
      details: { missing: [{ code: 'work_order_not_completed' }, { code: 'inspection_not_passed' }] },
    });

    // Repair recorded → villa set dirty with a cleaning task; still not returnable (inspection pending).
    const done = await org.tx(engineer, (tx) =>
      h.ops.completeWorkOrder(tx, wo1.id, wo1.version, {
        resolutionNote: 'Replaced 2m of main and coupling; pressure tested.',
        parts: [{ name: 'PVC pipe 50mm', quantity: 2 }],
      }),
    );
    expect(done).toMatchObject({ returnToService: 'awaiting_inspection', task: { status: 'done' } });
    await expect(
      org.tx(engineer, (tx) => h.ops.returnToService(tx, wo1.id, done.version)),
    ).rejects.toMatchObject({
      code: 'return_to_service_blocked',
      details: { missing: [{ code: 'inspection_not_passed' }] },
    });
    const attendant = org.as(ATTENDANT_GRANTS, { displayName: 'Mariyam' });
    const supervisor = org.as(SUPERVISOR_GRANTS);
    const cleanTask = (
      await org.tx(supervisor, (tx) =>
        h.ops.listTasks(tx, { propertyId: org.propertyId, unitId: w201, limit: 20 }),
      )
    ).find((t) => t.kind === 'vacant_clean');
    if (!cleanTask) throw new Error('vacant clean after maintenance');
    await org.tx(attendant, (tx) =>
      h.ops.transitionTask(tx, cleanTask.id, { to: 'done' }, { expectedVersion: cleanTask.version }),
    );
    h.clock.advance(60_000);
    await org.tx(supervisor, (tx) => h.ops.recordInspection(tx, w201, { items: [] }));
    const ready = await org.tx(engineer, (tx) => h.ops.getWorkOrder(tx, wo1.id));
    expect(ready.returnToService).toBe('ready');

    const returned = await org.tx(engineer, (tx) => h.ops.returnToService(tx, wo1.id, ready.version));
    expect(returned).toMatchObject({ returnToService: 'returned', block: { status: 'released' } });
    expect(h.inventory.calls).toContain(`releaseBlock:${wo1.block.blockId}`);
    const back = await org.tx(frontDesk, (tx) => h.ops.getUnitReadiness(tx, w201));
    expect(back).toMatchObject({ block: null, condition: 'inspected', readiness: { ready: true } });

    // Front office closes its items with what they did.
    const s1Item = items.find((i) => i.ref.id === s1);
    if (!s1Item) throw new Error('item');
    const resolved = await org.tx(frontDesk, (tx) =>
      h.ops.resolveResolutionItem(tx, s1Item.id, s1Item.version, {
        status: 'resolved',
        note: 'Moved to W305 (upgrade, complimentary)',
      }),
    );
    expect(resolved.status).toBe('resolved');
    expect(
      await org.tx(frontDesk, (tx) => h.ops.listResolutionItems(tx, org.propertyId, 'open')),
    ).toHaveLength(1);

    // Asset history shows the work, and the work-order events were emitted.
    const history = await org.tx(engineer, (tx) => h.ops.assetHistory(tx, asset.id));
    expect(history.asset.code).toBe('JETTY-B');
    expect((await eventsOf(h, org.tenantId, 'operations.workOrder.completed')).length).toBe(1);
    expect((await eventsOf(h, org.tenantId, 'operations.workOrder.returnedToService')).length).toBe(1);
  });

  it('a property may relax the policy (no inspection or cleaning required) — configuration, not code', async () => {
    const org = await setupOrg(h, { code: 'GH1', profile: 'guesthouse' });
    await org.tx(org.admin, (tx) =>
      platform.setPolicy(tx, {
        key: 'operations.settings',
        scopeType: 'property',
        scopeId: org.propertyId,
        value: { returnToService: { requireInspection: false, requireCleaning: false } },
        reason: 'Guesthouse: owner checks rooms personally',
      }),
    );
    const [room] = await seedUnits(h, org, [{ number: '3' }]);
    if (!room) throw new Error('unit');
    const engineer = org.as(ENGINEER);
    const wo = await org.tx(engineer, (tx) =>
      h.ops.createWorkOrder(tx, {
        propertyId: org.propertyId,
        unitId: room,
        title: 'AC not cooling',
        faultCategory: 'ac',
        urgency: 'high',
        block: { kind: 'out_of_service', from: '2026-11-07', to: '2026-11-08', reason: 'AC repair' },
      }),
    );
    const done = await org.tx(engineer, (tx) =>
      h.ops.completeWorkOrder(tx, wo.id, wo.version, { resolutionNote: 'Regassed' }),
    );
    expect(done.returnToService).toBe('ready');
    const back = await org.tx(engineer, (tx) => h.ops.returnToService(tx, wo.id, done.version));
    expect(back.returnToService).toBe('returned');
  });

  it('only maintenance managers can take units out of inventory; reporters can still log faults', async () => {
    const org = await setupOrg(h, { code: 'PERM' });
    const [room] = await seedUnits(h, org, [{ number: '7' }]);
    if (!room) throw new Error('unit');
    const reporter = org.as([
      { permission: 'operations.maintenance.report' },
      { permission: 'operations.unit.read' },
    ]);
    const wo = await org.tx(reporter, (tx) =>
      h.ops.createWorkOrder(tx, {
        propertyId: org.propertyId,
        unitId: room,
        title: 'Dripping tap',
        faultCategory: 'plumbing',
      }),
    );
    expect(wo.block.status).toBe('none');
    await expect(
      org.tx(reporter, (tx) =>
        h.ops.requestUnitBlock(tx, wo.id, {
          kind: 'out_of_order',
          from: '2026-11-07',
          to: '2026-11-08',
          reason: 'x',
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
