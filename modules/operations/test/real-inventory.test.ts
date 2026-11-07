/**
 * Operations × the REAL inventory provider (review P1-3, R1–R5), bound exactly as in apps/api composition:
 * operations authorizes the intent, inventory's port surface is property-scoped (ADR-0015), refusals keep the
 * work order, inventory events delivered late or reordered never corrupt operations' state.
 */
import { drainOutbox, sourcesFromManifests, type TxContext, withTenantTx } from '@portico/db';
import { createInventoryService, inventoryManifest, inventoryProvider } from '@portico/inventory';
import { newId, type RequestContext } from '@portico/kernel';
import { platform, platformManifest } from '@portico/platform';
import { createTestDatabase, type TestDatabase, testContext } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOperationsService,
  type OperationsPorts,
  operationsManifest,
  operationsSubscriptions,
} from '../src';
import { platformPort } from './support';

const inventory = createInventoryService({
  platform: {
    getBusinessDate: platform.getBusinessDate,
    getDataAuthority: platform.getDataAuthority,
    assertWritable: platform.assertWritable,
    getLimit: platform.getLimit,
    resolvePolicy: platform.resolvePolicy,
  },
});
// ADR-0015: inventory's port surface (property-scoped delegation), exactly as the composition root binds it.
const inventoryPort = inventoryProvider(inventory);
const ports: OperationsPorts = {
  platform: platformPort(),
  inventory: {
    blockUnit: (tx, input) => inventoryPort.blockUnit(tx, input),
    releaseBlock: (tx, input) => inventoryPort.releaseBlock(tx, input),
    listUnits: (tx, propertyId, filter) => inventoryPort.listUnits(tx, propertyId, filter),
  },
};
const ops = createOperationsService(ports);

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase(
    sourcesFromManifests([platformManifest, inventoryManifest, operationsManifest]),
  );
  t.db.pool.on('error', () => {});
  t.admin.pool.on('error', () => {});
});
afterAll(async () => t?.drop());

const drain = () =>
  drainOutbox(t.db, {
    subscriptions: operationsSubscriptions(ports),
    environmentOf: async () => 'live',
    maxAttempts: 1,
    onError: (e) => {
      throw e;
    },
  });

async function setup() {
  const admin = testContext({ actor: { kind: 'user', userId: newId(), displayName: 'Admin' } });
  await withTenantTx(t.db, admin, (tx) =>
    platform.provisionOrganization(tx, {
      name: 'Org',
      slug: `org-${admin.tenantId.slice(-12)}`,
      environment: 'live',
      planCode: 'enterprise',
    }),
  );
  const propertyId = await withTenantTx(t.db, admin, async (tx) => {
    const le = await platform.createLegalEntity(tx, {
      name: 'X',
      legalName: 'X Pvt',
      countryCode: 'MV',
      baseCurrency: 'USD',
    });
    const p = await platform.createProperty(tx, {
      code: 'RSV',
      name: 'Resort',
      profile: 'resort',
      legalEntityId: le.id,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      businessDate: '2026-11-07',
    });
    return p.id;
  });
  const unitIds = await withTenantTx(t.db, admin, async (tx) => {
    const type = await inventory.createUnitType(tx, propertyId, {
      code: 'WV',
      name: 'Water villa',
      kind: 'villa',
      baseOccupancy: 2,
      maxAdults: 2,
      maxChildren: 1,
      maxOccupancy: 3,
    });
    const ids: string[] = [];
    for (const n of ['W1', 'W2', 'W3']) {
      const u = await inventory.createUnit(tx, propertyId, {
        unitTypeId: type.id,
        number: n,
        location: { zone: 'Jetty B' },
      });
      ids.push(u.id);
    }
    await ops.syncUnitsFromInventory(tx, propertyId);
    return ids;
  });
  const as = (permissions: string[]): RequestContext =>
    testContext({
      tenantId: admin.tenantId,
      actor: { kind: 'user', userId: newId(), displayName: 'Engineer' },
      grants: permissions.map((permission) => ({ permission, propertyIds: [propertyId] })),
    });
  const run = <T>(ctx: RequestContext, fn: (tx: TxContext) => Promise<T>) => withTenantTx(t.db, ctx, fn);
  return { admin, propertyId, unitIds, as, run };
}

// Operations permissions only — no inventory permission (ADR-0015).
const ENGINEER = [
  'operations.maintenance.manage',
  'operations.maintenance.setInventoryImpact',
  'operations.unit.read',
  'operations.task.manage',
  'operations.housekeeping.update',
  'operations.housekeeping.inspect',
];
const block = {
  kind: 'out_of_order' as const,
  from: '2026-11-07',
  to: '2026-11-09',
  reason: 'AC compressor',
};

describe('operations × real inventory', () => {
  it('mirrors the inventory catalog (location → path, unit type id)', async () => {
    const s = await setup();
    const u = await s.run(s.admin, (tx) => ops.getUnit(tx, s.unitIds[0] as string));
    expect(u).toMatchObject({ unitNumber: 'W1', unitTypeId: expect.any(String) });
  });

  it('R1/R3: an engineer with operations permissions blocks a unit; a second block is refused but the work order is kept', async () => {
    const s = await setup();
    const eng = s.as(ENGINEER);
    const unitId = s.unitIds[0] as string;
    const first = await s.run(eng, (tx) =>
      ops.createWorkOrder(tx, {
        propertyId: s.propertyId,
        unitId,
        title: 'AC dead',
        faultCategory: 'ac',
        urgency: 'high',
        block,
      }),
    );
    expect(first.block.status).toBe('active');
    const second = await s.run(eng, (tx) =>
      ops.createWorkOrder(tx, {
        propertyId: s.propertyId,
        unitId,
        title: 'Water leak',
        faultCategory: 'plumbing',
        block,
      }),
    );
    expect(second.block).toMatchObject({ status: 'refused', refusal: { code: 'unit_already_blocked' } });
    const all = await s.run(s.admin, (tx) => ops.listWorkOrders(tx, { propertyId: s.propertyId, limit: 10 }));
    expect(all).toHaveLength(2);
  });

  it('R2: availability managed externally (forward) — the out-of-order request is forwarded, the work order kept', async () => {
    const s = await setup();
    await s.run(s.admin, (tx) =>
      platform.setDataAuthority(tx, {
        propertyId: s.propertyId,
        domain: 'availability',
        authority: 'external',
        connectionId: newId(),
        systemName: 'OPERA Cloud',
        writeMode: 'forward',
        reason: 'Housekeeping & maintenance alongside OPERA',
      }),
    );
    const wo = await s.run(s.as(ENGINEER), (tx) =>
      ops.createWorkOrder(tx, {
        propertyId: s.propertyId,
        unitId: s.unitIds[0] as string,
        title: 'AC dead',
        faultCategory: 'ac',
        urgency: 'high',
        block,
      }),
    );
    expect(wo.block.status).toBe('pending_forward');
    const forwards = await s.run(s.admin, (tx) => ops.listForwards(tx, s.propertyId, 'pending'));
    expect(forwards.map((f) => f.change.action)).toEqual(['block']);
  });

  it('R4: a release done directly in inventory is flagged on the work order', async () => {
    const s = await setup();
    const unitId = s.unitIds[1] as string;
    const wo = await s.run(s.as(ENGINEER), (tx) =>
      ops.createWorkOrder(tx, {
        propertyId: s.propertyId,
        unitId,
        title: 'Deck',
        faultCategory: 'structural',
        block,
      }),
    );
    await drain();
    await s.run(s.as(['inventory.block.manage', 'inventory.unit.read']), (tx) =>
      inventory.releaseBlock(tx, { blockId: wo.block.blockId as string, reason: 'Need the villa' }),
    );
    await drain();
    const after = await s.run(s.admin, (tx) => ops.getWorkOrder(tx, wo.id));
    expect(after.block.status).toBe('released');
    expect(after.issues.map((i) => i.code)).toContain('released_outside_return_to_service');
  });

  it('R5: after a proper return to service, late inventory events never re-block the unit', async () => {
    const s = await setup();
    const eng = s.as(ENGINEER);
    const unitId = s.unitIds[2] as string;
    const wo = await s.run(eng, (tx) =>
      ops.createWorkOrder(tx, {
        propertyId: s.propertyId,
        unitId,
        title: 'AC dead',
        faultCategory: 'ac',
        block,
      }),
    );
    await s.run(eng, (tx) => ops.completeWorkOrder(tx, wo.id, wo.version, { resolutionNote: 'fixed' }));
    // Cleaning after maintenance, then inspection.
    const tasks = await s.run(s.admin, (tx) =>
      ops.listTasks(tx, { propertyId: s.propertyId, unitId, limit: 10 }),
    );
    const clean = tasks.find((x) => x.kind === 'vacant_clean');
    if (!clean) throw new Error('clean task');
    await s.run(eng, (tx) =>
      ops.transitionTask(tx, clean.id, { to: 'done' }, { expectedVersion: clean.version }),
    );
    await s.run(eng, (tx) => ops.recordInspection(tx, unitId, { items: [] }));
    const ready = await s.run(eng, (tx) => ops.getWorkOrder(tx, wo.id));
    const back = await s.run(eng, (tx) => ops.returnToService(tx, wo.id, ready.version));
    expect(back.returnToService).toBe('returned');
    await drain(); // inventory.unit.blocked + unblocked delivered only now
    const unit = await s.run(eng, (tx) => ops.getUnit(tx, unitId));
    expect(unit).toMatchObject({ block: null, readiness: { ready: true } });
    const final = await s.run(eng, (tx) => ops.getWorkOrder(tx, wo.id));
    expect(final.issues.map((i) => i.code)).not.toContain('released_outside_return_to_service');
  });
});
