/**
 * Tenant isolation (scenario 17), property scope, permissions per action, and connected mode (data authority
 * `availability` held by an external system — ADR-0014).
 */
import { sql, withTenantTx } from '@portico/db';
import { newId } from '@portico/kernel';
import { platform } from '@portico/platform';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inventorySearch } from '../src';
import {
  assertLedgerConsistent,
  cell,
  createInventoryTestDatabase,
  inventory,
  setupProperty,
  stay,
  unitTypeWithUnits,
} from './harness';

let t: TestDatabase;
beforeAll(async () => {
  t = await createInventoryTestDatabase();
});
afterAll(async () => {
  if (t) await assertLedgerConsistent(t);
  await t?.drop();
});

const N = { from: '2026-11-10', to: '2026-11-12' };

describe('tenant isolation', () => {
  it('another organization cannot read, sell, assign, block or release by id', async () => {
    const a = await setupProperty(t);
    const b = await setupProperty(t);
    const { type, unitIds } = await unitTypeWithUnits(a, { code: 'WV', count: 2 });
    const guest = stay();
    await a.run((tx) =>
      inventory.consume(tx, {
        propertyId: a.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        ref: guest,
      }),
    );

    await expect(b.run((tx) => inventory.getUnitType(tx, type.id))).rejects.toThrow(/not found/);
    await expect(b.run((tx) => inventory.getUnit(tx, unitIds[0] as string))).rejects.toThrow(/not found/);
    await expect(
      b.run((tx) =>
        inventory.consume(tx, {
          propertyId: a.propertyId,
          unitTypeId: type.id,
          nights: N,
          quantity: 1,
          ref: stay(),
        }),
      ),
    ).rejects.toThrow(/not found/);
    await expect(
      b.run((tx) => inventory.assignUnit(tx, { unitId: unitIds[0] as string, ref: guest, nights: N })),
    ).rejects.toThrow(/not found/);
    await expect(
      b.run((tx) =>
        inventory.blockUnit(tx, {
          unitId: unitIds[0] as string,
          nights: N,
          kind: 'out_of_order',
          reason: 'Nope',
        }),
      ),
    ).rejects.toThrow(/not found/);
    await expect(
      b.run((tx) =>
        inventory.explainAvailability(tx, {
          propertyId: a.propertyId,
          unitTypeId: type.id,
          date: '2026-11-10',
        }),
      ),
    ).rejects.toThrow(/not found/);
    expect(await b.run((tx) => inventory.listUnitTypes(tx, a.propertyId))).toEqual([]);
    expect(
      await b.run((tx) => inventory.getAvailability(tx, { propertyId: a.propertyId, range: N })),
    ).toEqual([]);
    expect((await b.run((tx) => inventory.release(tx, { ref: guest }))).releasedCells).toEqual([]);
    expect(await b.run((tx) => inventorySearch.search(tx, 'WV', { limit: 10 }))).toEqual([]);
    expect(
      await b.run(async (tx) =>
        inventorySearch.summarize ? inventorySearch.summarize(tx, 'unit', unitIds[0] as string) : null,
      ),
    ).toBeNull();
    // A's sale is untouched
    expect((await cell(a, type.id, '2026-11-10')).sold).toBe(1);
  });

  it('row level security rejects writes carrying another organization id, even with raw SQL', async () => {
    const a = await setupProperty(t);
    const b = await setupProperty(t);
    const { type } = await unitTypeWithUnits(a, { code: 'BV', count: 1 });
    await expect(
      withTenantTx(t.db, b.ctx, (tx) =>
        sql`insert into inventory.ledger (tenant_id, property_id, unit_type_id, night, capacity)
            values (${a.tenantId}, ${a.propertyId}, ${type.id}, '2026-11-10', 99)`.execute(tx.db),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('property scope and permissions', () => {
  it('a user scoped to one property cannot read another property of the same organization', async () => {
    const a = await setupProperty(t, { code: 'P1' });
    const second = await a.run(async (tx) => {
      const le = (await platform.listLegalEntities(tx))[0];
      return platform.createProperty(tx, {
        code: 'P2',
        name: 'Second',
        profile: 'hotel',
        legalEntityId: le?.id as string,
        countryCode: 'MV',
        timezone: 'Indian/Maldives',
        baseCurrency: 'USD',
        businessDate: '2026-11-07',
      });
    });
    await unitTypeWithUnits(a, { code: 'WV', count: 1 });
    const reader = ['inventory.availability.read', 'inventory.unit.read'];
    await expect(
      a.as(reader, (tx) => inventory.getAvailability(tx, { propertyId: second.id, range: N })),
    ).rejects.toThrow(/permission/);
    await expect(a.as(reader, (tx) => inventory.listUnitTypes(tx, second.id))).rejects.toThrow(/permission/);
    expect(
      await a.as(reader, (tx) => inventory.getAvailability(tx, { propertyId: a.propertyId, range: N })),
    ).toHaveLength(2);
    const hits = await a.as(reader, (tx) => inventorySearch.search(tx, 'WV', { limit: 10 }), [second.id]);
    expect(hits).toEqual([]);
  });

  it('each consequential action needs its permission; record actions explain what is missing', async () => {
    const p = await setupProperty(t);
    const { type, unitIds } = await unitTypeWithUnits(p, { code: 'WV', count: 2 });
    const readOnly = ['inventory.unit.read', 'inventory.availability.read'];
    const denied: Array<[string, () => Promise<unknown>]> = [
      [
        'inventory.unitType.manage',
        () =>
          p.as(readOnly, (tx) =>
            inventory.createUnitType(tx, p.propertyId, {
              code: 'X',
              name: 'X',
              kind: 'room',
              baseOccupancy: 1,
              maxAdults: 1,
              maxChildren: 0,
              maxOccupancy: 1,
            }),
          ),
      ],
      [
        'inventory.unit.manage',
        () =>
          p.as(readOnly, (tx) =>
            inventory.createUnit(tx, p.propertyId, { unitTypeId: type.id, number: 'Z1' }),
          ),
      ],
      [
        'inventory.block.manage',
        () =>
          p.as(readOnly, (tx) =>
            inventory.blockUnit(tx, {
              unitId: unitIds[0] as string,
              nights: N,
              kind: 'out_of_order',
              reason: 'Leak',
            }),
          ),
      ],
      [
        'inventory.overbooking.authorize',
        () =>
          p.as(readOnly, (tx) =>
            inventory.setOverbookingAllowance(tx, p.propertyId, {
              unitTypeId: type.id,
              nights: N,
              quantity: 1,
              reason: 'No-shows',
            }),
          ),
      ],
      [
        'inventory.assignment.manage',
        () =>
          p.as(readOnly, (tx) =>
            inventory.assignUnit(tx, { unitId: unitIds[0] as string, ref: stay(), nights: N }),
          ),
      ],
    ];
    for (const [permission, attempt] of denied) {
      await expect(attempt()).rejects.toThrow(new RegExp(permission.replace(/\./g, '\\.')));
    }
    const record = await p.as(readOnly, (tx) => inventory.getUnitRecord(tx, unitIds[0] as string));
    const ooo = record.allowedActions.find((a) => a.action === 'placeOutOfOrder');
    expect(ooo).toMatchObject({ enabled: false, reason: expect.stringMatching(/inventory\.block\.manage/) });
    expect(record.allowedActions.find((a) => a.action === 'viewAvailability')?.enabled).toBe(true);
    // the API never reveals records of a property the user is not scoped to
    await expect(
      p.as(readOnly, (tx) => inventory.getUnit(tx, unitIds[0] as string), [newId()]),
    ).rejects.toThrow(/permission/);
  });
});

describe('units leaving inventory', () => {
  it('refuses to take a unit out while stays are assigned; capacity changes reconcile conflicts', async () => {
    const p = await setupProperty(t);
    const { type, unitIds } = await unitTypeWithUnits(p, { code: 'BV', count: 2 });
    const guest = stay();
    await p.run(async (tx) => {
      await inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        ref: guest,
      });
      await inventory.assignUnit(tx, { unitId: unitIds[0] as string, ref: guest, nights: N });
      await inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        ref: stay(),
      });
    });
    const u0 = await p.run((tx) => inventory.getUnit(tx, unitIds[0] as string));
    await expect(
      p.run((tx) => inventory.updateUnit(tx, u0.id, u0.version, { status: 'inactive' })),
    ).rejects.toThrow(/assigned to 1 stay\(s\).*Move them to other units first/);
    // the unassigned unit can be deactivated: both nights become oversold → conflicts, then restored
    const u1 = await p.run((tx) => inventory.getUnit(tx, unitIds[1] as string));
    const inactive = await p.run((tx) => inventory.updateUnit(tx, u1.id, u1.version, { status: 'inactive' }));
    expect(await cell(p, type.id, '2026-11-10')).toMatchObject({
      capacity: 1,
      oversoldBy: 1,
      status: 'oversold',
    });
    await p.run((tx) => inventory.updateUnit(tx, u1.id, inactive.version, { status: 'active' }));
    expect(await cell(p, type.id, '2026-11-10')).toMatchObject({ capacity: 2, oversoldBy: 0 });
    const conflicts = await p.run((tx) =>
      inventory.listConflicts(tx, { propertyId: p.propertyId, status: 'all' }),
    );
    expect(conflicts.map((c) => c.resolution)).toEqual(['capacity_restored', 'capacity_restored']);
    // stale version is detected
    await expect(p.run((tx) => inventory.updateUnit(tx, u1.id, u1.version, { name: 'Old' }))).rejects.toThrow(
      /changed by someone else/,
    );
  });
});

describe('connected mode: an external system is the system of record for availability', () => {
  async function connected(writeMode: 'read_only' | 'forward', maintenance = false) {
    const p = await setupProperty(t);
    const { type, unitIds } = await unitTypeWithUnits(p, { code: 'WV', count: 2 });
    const connectionId = newId();
    if (maintenance) {
      await p.run((tx) =>
        platform.setDataAuthority(tx, {
          propertyId: p.propertyId,
          domain: 'maintenance',
          authority: 'external',
          connectionId,
          systemName: 'Legacy PMS',
          writeMode,
          reason: 'Connect alongside: PMS keeps selling',
        }),
      );
    } else {
      // Availability is a governed domain (CR-10): it moves to the external system through an authority transition
      // planned by one person and approved by another (plan → approve → freeze → effective).
      const plan = await p.run((tx) =>
        platform.planAuthorityTransition(tx, p.propertyId, {
          changes: [
            {
              domain: 'availability',
              authority: 'external',
              connectionId,
              systemName: 'Legacy PMS',
              writeMode,
            },
          ],
          reason: 'Connect alongside: PMS keeps selling',
          freezeMinutes: 5,
        }),
      );
      await withTenantTx(t.db, p.ctxWith(['platform.dataAuthority.manage']), (tx) =>
        platform.approveAuthorityTransition(tx, plan.id, 'second approver'),
      );
      await p.run((tx) => platform.freezeAuthorityTransition(tx, plan.id));
      await p.run((tx) => platform.completeAuthorityTransition(tx, {}, plan.id));
    }
    return { p, type, unitIds, connectionId };
  }

  it('refuses every direct inventory write — catalog, blocks, allowances, sales, holds, assignments', async () => {
    const { p, type, unitIds } = await connected('read_only');
    const guest = stay();
    const attempts: Array<[string, () => Promise<unknown>]> = [
      [
        'createUnit',
        () => p.run((tx) => inventory.createUnit(tx, p.propertyId, { unitTypeId: type.id, number: 'W9' })),
      ],
      [
        'blockUnit',
        () =>
          p.run((tx) =>
            inventory.blockUnit(tx, {
              unitId: unitIds[0] as string,
              nights: N,
              kind: 'out_of_order',
              reason: 'Leak',
            }),
          ),
      ],
      [
        'setOverbookingAllowance',
        () =>
          p.run((tx) =>
            inventory.setOverbookingAllowance(tx, p.propertyId, {
              unitTypeId: type.id,
              nights: N,
              quantity: 1,
              reason: 'No-shows',
            }),
          ),
      ],
      [
        'consume',
        () =>
          p.run((tx) =>
            inventory.consume(tx, {
              propertyId: p.propertyId,
              unitTypeId: type.id,
              nights: N,
              quantity: 1,
              ref: guest,
            }),
          ),
      ],
      [
        'createHold',
        () =>
          p.run((tx) =>
            inventory.createHold(tx, {
              propertyId: p.propertyId,
              unitTypeId: type.id,
              nights: N,
              quantity: 1,
              expiresAt: new Date(Date.now() + 600_000),
              ref: { type: 'quote', id: newId() },
            }),
          ),
      ],
      [
        'assignUnit',
        () =>
          p.run((tx) => inventory.assignUnit(tx, { unitId: unitIds[0] as string, ref: guest, nights: N })),
      ],
    ];
    for (const [name, attempt] of attempts) {
      const err = await attempt().catch((e: unknown) => e);
      expect(err, name).toMatchObject({ code: 'external_system_of_record' });
      expect((err as Error).message, name).toMatch(/Legacy PMS is the system of record for availability/);
    }
  });

  it('applies mirrored state only through applyExternalAvailability from the authoritative connection', async () => {
    const { p, type, unitIds, connectionId } = await connected('read_only');
    // Before any sync, the local numbers do not reflect the external system: labelled incomplete.
    const before = await p.run((tx) =>
      inventory.getAvailabilityGrid(tx, { propertyId: p.propertyId, range: N }),
    );
    expect(before).toMatchObject({ provenance: 'incomplete', lastSyncAt: null });
    await expect(
      p.run((tx) =>
        inventory.applyExternalAvailability(tx, {
          propertyId: p.propertyId,
          connectionId: newId(),
          operations: [],
        }),
      ),
    ).rejects.toMatchObject({ code: 'not_system_of_record' });
    const guest = stay();
    const r = await p.run((tx) =>
      inventory.applyExternalAvailability(tx, {
        propertyId: p.propertyId,
        connectionId,
        operations: [
          {
            op: 'consume',
            unitTypeId: type.id,
            nights: N,
            quantity: 2,
            ref: { type: 'externalBlock', id: newId() },
          },
          { op: 'consume', unitTypeId: type.id, nights: N, quantity: 1, ref: guest },
          { op: 'assign', unitId: unitIds[0] as string, ref: guest, nights: N },
        ],
      }),
    );
    // the external system sold 3 of 2 villas: mirrored, and the difference is a visible conflict, not a refusal
    expect(r.applied).toBe(3);
    expect(r.conflictIds.length).toBeGreaterThan(0);
    const grid = await p.run((tx) =>
      inventory.getAvailabilityGrid(tx, { propertyId: p.propertyId, range: N }),
    );
    expect(grid).toMatchObject({
      provenance: 'external',
      authority: { authority: 'external', systemName: 'Legacy PMS' },
    });
    expect(grid.lastSyncAt).not.toBeNull();
    expect(grid.cells[0]).toMatchObject({ sold: 3, oversoldBy: 1, sellable: 0 });
    const why = await p.run((tx) =>
      inventory.explainAvailability(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        date: '2026-11-10',
      }),
    );
    expect(why.reasons[0]).toMatch(/managed in Legacy PMS/);
    expect(why.lastSyncAt).not.toBeNull();
    // the integration can mirror the catalog too (origin = the authoritative connection)
    const mirrored = await p.run((tx) =>
      inventory.createUnit(
        tx,
        p.propertyId,
        { unitTypeId: type.id, number: 'W9' },
        { origin: { connectionId } },
      ),
    );
    expect(mirrored.number).toBe('W9');
    const record = await p.run((tx) => inventory.getUnitRecord(tx, unitIds[0] as string));
    expect(record.provenance).toBe('external');
  });

  it('forward mode is refused clearly until forwarding exists — including sales', async () => {
    const { p, type } = await connected('forward');
    await expect(
      p.run((tx) => inventory.createUnit(tx, p.propertyId, { unitTypeId: type.id, number: 'W9' })),
    ).rejects.toThrow(/Forwarding this change to it is not available yet/);
    await expect(
      p.run((tx) =>
        inventory.consume(tx, {
          propertyId: p.propertyId,
          unitTypeId: type.id,
          nights: N,
          quantity: 1,
          ref: stay(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'forwarding_not_available' });
  });

  it('out-of-order blocks respect an external maintenance system; house use does not depend on it', async () => {
    const { p, unitIds } = await connected('read_only', true);
    await expect(
      p.run((tx) =>
        inventory.blockUnit(tx, {
          unitId: unitIds[0] as string,
          nights: N,
          kind: 'out_of_order',
          reason: 'Leak',
        }),
      ),
    ).rejects.toThrow(/system of record for maintenance/);
    const houseUse = await p.run((tx) =>
      inventory.blockUnit(tx, {
        unitId: unitIds[1] as string,
        nights: N,
        kind: 'house_use',
        reason: 'Owner visit',
      }),
    );
    expect(houseUse.block.kind).toBe('house_use');
  });
});
