/**
 * Composite units (connecting villas / two-bedroom residences): selling or assigning a composite consumes its
 * components and vice versa, and type-level availability of composite and component types stays consistent
 * (INV-R05..R08, INV-I06). Model: README § Composite units.
 */
import { newId } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InventoryUnavailableError } from '../src';
import {
  assertLedgerConsistent,
  cell,
  createInventoryTestDatabase,
  inventory,
  type PropertyFixture,
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

const N = { from: '2026-11-10', to: '2026-11-13' };
const D = '2026-11-11';

/** Beach Pool Villas P01–P04; residences R1 = P01+P02, R2 = P03+P04. */
async function residences(p: PropertyFixture) {
  const { type: pool, unitIds: villas } = await unitTypeWithUnits(p, {
    code: 'BPV',
    name: 'Beach Pool Villa',
    count: 4,
    prefix: 'P',
  });
  const { residence, r1, r2 } = await p.run(async (tx) => {
    const residence = await inventory.createUnitType(tx, p.propertyId, {
      code: 'RES2',
      name: 'Two-Bedroom Residence',
      kind: 'villa',
      noun: 'Residence',
      baseOccupancy: 4,
      maxAdults: 4,
      maxChildren: 2,
      maxOccupancy: 6,
      isComposite: true,
    });
    const r1 = await inventory.createCompositeUnit(tx, p.propertyId, {
      unitTypeId: residence.id,
      number: 'R1',
      componentUnitIds: [villas[0] as string, villas[1] as string],
    });
    const r2 = await inventory.createCompositeUnit(tx, p.propertyId, {
      unitTypeId: residence.id,
      number: 'R2',
      componentUnitIds: [villas[2] as string, villas[3] as string],
    });
    return { residence, r1, r2 };
  });
  return { pool, villas, residence, r1, r2 };
}

describe('composite units', () => {
  it('describes the composition and counts composite capacity separately from components', async () => {
    const p = await setupProperty(t);
    const { pool, residence, r1, villas } = await residences(p);
    const type = await p.run((tx) => inventory.getUnitType(tx, residence.id));
    expect(type.composition).toEqual([{ unitTypeId: pool.id, perComposite: 2 }]);
    expect(r1.componentUnitIds.sort()).toEqual([villas[0], villas[1]].sort());
    const villa = await p.run((tx) => inventory.getUnit(tx, villas[0] as string));
    expect(villa.memberOfCompositeUnitIds).toEqual([r1.id]);
    expect(await cell(p, pool.id, D)).toMatchObject({ capacity: 4, available: 4 });
    expect(await cell(p, residence.id, D)).toMatchObject({
      capacity: 2,
      available: 2,
      composite: { totalUnits: 2, freeUnits: 2, unitLimit: 2, componentLimit: 2 },
    });
  });

  it('selling component villas reduces residence availability (unassigned sales included)', async () => {
    const p = await setupProperty(t);
    const { pool, residence } = await residences(p);
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: pool.id,
        nights: N,
        quantity: 1,
        ref: stay(),
      }),
    );
    // 3 villas left → floor(3/2) = 1 residence, although both residences are physically free
    expect(await cell(p, residence.id, D)).toMatchObject({
      available: 1,
      composite: { freeUnits: 2, componentLimit: 1, limitingComponentTypeId: pool.id },
    });
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: pool.id,
        nights: N,
        quantity: 2,
        ref: { type: 'groupBlock', id: newId() },
        kind: 'block_allocation',
      }),
    );
    expect((await cell(p, residence.id, D)).available).toBe(0);
    await expect(
      p.run((tx) =>
        inventory.consume(tx, {
          propertyId: p.propertyId,
          unitTypeId: residence.id,
          nights: N,
          quantity: 1,
          ref: stay(),
        }),
      ),
    ).rejects.toBeInstanceOf(InventoryUnavailableError);
  });

  it('selling a residence assigns a specific residence and consumes both component villas', async () => {
    const p = await setupProperty(t);
    const { pool, residence, r1, villas } = await residences(p);
    const family = stay();
    const r = await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: residence.id,
        nights: N,
        quantity: 1,
        ref: family,
      }),
    );
    expect(r.assignedUnitId).toBe(r1.id);
    expect(await cell(p, pool.id, D)).toMatchObject({ sold: 2, available: 2 });
    expect(await cell(p, residence.id, D)).toMatchObject({
      sold: 1,
      available: 1,
      composite: { freeUnits: 1 },
    });
    // INV-I06: the composite assignment has component rows with identical ref and nights
    const rows = await p.run((tx) =>
      inventory.listAssignments(tx, { propertyId: p.propertyId, range: N, ref: family }),
    );
    expect(rows.map((a) => [a.unitId, a.viaCompositeUnitId, a.nights]).sort()).toEqual(
      [
        [r1.id, null, N],
        [villas[0], r1.id, N],
        [villas[1], r1.id, N],
      ].sort(),
    );
    // the component villas are not assignable to an ordinary villa stay
    const villaStay = stay();
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: pool.id,
        nights: N,
        quantity: 1,
        ref: villaStay,
      }),
    );
    const candidates = await p.run((tx) =>
      inventory.findAssignableUnits(tx, {
        propertyId: p.propertyId,
        unitTypeId: pool.id,
        nights: N,
        ref: villaStay,
      }),
    );
    const byNumber = Object.fromEntries(candidates.map((c) => [c.number, c]));
    expect(byNumber.P01?.exclusions[0]).toMatchObject({ code: 'composite_in_use', ref: family });
    expect(byNumber.P03?.assignable).toBe(true);
    await expect(
      p.run((tx) => inventory.assignUnit(tx, { unitId: villas[0] as string, ref: villaStay, nights: N })),
    ).rejects.toThrow(/assigned to stay/);

    // releasing the residence frees the villas and both views of availability
    await p.run((tx) => inventory.release(tx, { ref: family }));
    expect(await cell(p, pool.id, D)).toMatchObject({ sold: 1, available: 3 });
    expect(await cell(p, residence.id, D)).toMatchObject({ sold: 0, available: 1 });
    expect(
      await p.run((tx) => inventory.listAssignments(tx, { propertyId: p.propertyId, range: N, ref: family })),
    ).toEqual([]);
  });

  it('assigning a component villa individually takes that residence out of sale', async () => {
    const p = await setupProperty(t);
    const { pool, residence, villas } = await residences(p);
    const s = stay();
    await p.run(async (tx) => {
      await inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: pool.id,
        nights: N,
        quantity: 1,
        ref: s,
      });
      await inventory.assignUnit(tx, { unitId: villas[2] as string, ref: s, nights: N });
    });
    const c = await cell(p, residence.id, D);
    expect(c).toMatchObject({ available: 1, composite: { freeUnits: 1 } });
    // the next residence sale is assigned R1 (R2's villa P03 is occupied)
    const r = await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: residence.id,
        nights: N,
        quantity: 1,
        ref: stay(),
      }),
    );
    const units = await p.run((tx) => inventory.listUnits(tx, p.propertyId, { unitTypeId: residence.id }));
    expect(units.find((u) => u.id === r.assignedUnitId)?.number).toBe('R1');
    // no residence left; ordinary villas: 4 − 1 − 2 = 1
    expect((await cell(p, residence.id, D)).available).toBe(0);
    expect((await cell(p, pool.id, D)).available).toBe(1);
    // ranking keeps standalone units ahead of components for ordinary stays
    const ranked = await p.run((tx) =>
      inventory.findAssignableUnits(tx, {
        propertyId: p.propertyId,
        unitTypeId: pool.id,
        nights: { from: '2026-12-01', to: '2026-12-02' },
      }),
    );
    expect(ranked.every((x) => x.isComponent)).toBe(true);
  });

  it('a residence hold also holds its villas, so villa sales cannot make it unconvertible', async () => {
    const p = await setupProperty(t);
    const { pool, residence } = await residences(p);
    const { holdId } = await p.run((tx) =>
      inventory.createHold(tx, {
        propertyId: p.propertyId,
        unitTypeId: residence.id,
        nights: N,
        quantity: 1,
        expiresAt: new Date(Date.now() + 3600_000),
        ref: { type: 'quote', id: newId() },
      }),
    );
    expect(await cell(p, pool.id, D)).toMatchObject({ held: 2, available: 2 });
    expect(await cell(p, residence.id, D)).toMatchObject({ held: 1, available: 1 });
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: pool.id,
        nights: N,
        quantity: 2,
        ref: stay(),
      }),
    );
    await expect(
      p.run((tx) =>
        inventory.consume(tx, {
          propertyId: p.propertyId,
          unitTypeId: pool.id,
          nights: N,
          quantity: 1,
          ref: stay(),
        }),
      ),
    ).rejects.toBeInstanceOf(InventoryUnavailableError);
    const converted = await p.run((tx) => inventory.convertHold(tx, { holdId, ref: stay() }));
    expect(converted.assignedUnitId).not.toBeNull();
    expect(await cell(p, pool.id, D)).toMatchObject({ held: 0, sold: 4, available: 0 });
    expect(await cell(p, residence.id, D)).toMatchObject({ held: 0, sold: 1, available: 0 });
  });

  it('blocks on a component make the residence unavailable; composites themselves cannot be blocked or overbooked', async () => {
    const p = await setupProperty(t);
    const { residence, r1, villas } = await residences(p);
    await p.run((tx) =>
      inventory.blockUnit(tx, {
        unitId: villas[1] as string,
        nights: N,
        kind: 'out_of_service',
        reason: 'Pool pump',
      }),
    );
    expect(await cell(p, residence.id, D)).toMatchObject({ available: 1, composite: { freeUnits: 1 } });
    const why = await p.run((tx) =>
      inventory.explainAvailability(tx, { propertyId: p.propertyId, unitTypeId: residence.id, date: D }),
    );
    expect(why.units.find((u) => u.unitId === r1.id)).toMatchObject({
      state: 'out_of_service',
      reason: 'Component P02: Pool pump',
    });
    expect(why.formula).toMatch(/min\(1 free combined units, 2 allowed by component availability\) = 1/);
    await expect(
      p.run((tx) =>
        inventory.blockUnit(tx, {
          unitId: r1.id,
          nights: N,
          kind: 'out_of_order',
          reason: 'Whole residence',
        }),
      ),
    ).rejects.toThrow(/Block the physical units/);
    await expect(
      p.run((tx) =>
        inventory.setOverbookingAllowance(tx, p.propertyId, {
          unitTypeId: residence.id,
          nights: N,
          quantity: 1,
          reason: 'Try',
        }),
      ),
    ).rejects.toThrow(/cannot be overbooked/);
  });

  it('a channel sale of a residence with none free is recorded as a conflict, never silently oversold', async () => {
    const p = await setupProperty(t);
    const { residence } = await residences(p);
    for (let i = 0; i < 2; i++) {
      await p.run((tx) =>
        inventory.consume(tx, {
          propertyId: p.propertyId,
          unitTypeId: residence.id,
          nights: N,
          quantity: 1,
          ref: stay(),
        }),
      );
    }
    const r = await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: residence.id,
        nights: N,
        quantity: 1,
        ref: stay(),
        onShortfall: 'record_conflict',
      }),
    );
    expect(r.assignedUnitId).toBeNull();
    expect(r.conflictIds.length).toBeGreaterThanOrEqual(3);
    expect(await cell(p, residence.id, D)).toMatchObject({
      status: 'oversold',
      oversoldBy: 1,
      composite: { unassignedSold: 1 },
    });
  });

  it('validates composite structure: same mix, one composite per component, at least two units', async () => {
    const p = await setupProperty(t);
    const { residence, villas } = await residences(p);
    const { unitIds: beach } = await unitTypeWithUnits(p, { code: 'BV', count: 2 });
    await expect(
      p.run((tx) =>
        inventory.createCompositeUnit(tx, p.propertyId, {
          unitTypeId: residence.id,
          number: 'R3',
          componentUnitIds: [beach[0] as string, beach[1] as string],
        }),
      ),
    ).rejects.toThrow(/same mix of unit types/);
    await expect(
      p.run((tx) =>
        inventory.createCompositeUnit(tx, p.propertyId, {
          unitTypeId: residence.id,
          number: 'R4',
          componentUnitIds: [villas[0] as string, villas[2] as string],
        }),
      ),
    ).rejects.toThrow(/already part of another/);
    await expect(
      p.run((tx) => inventory.createUnit(tx, p.propertyId, { unitTypeId: residence.id, number: 'R5' })),
    ).rejects.toThrow(/create it as a composite unit/);
  });
});
