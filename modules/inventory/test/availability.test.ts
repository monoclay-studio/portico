import { newId } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InventoryUnavailableError } from '../src';
import {
  adminQuery,
  assertLedgerConsistent,
  cell,
  createInventoryTestDatabase,
  dropTestDatabase,
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
  await dropTestDatabase(t);
});

const N = { from: '2026-11-10', to: '2026-11-13' }; // nights 10, 11, 12

describe('catalog and capacity', () => {
  it('counts active units per unit type per night, from the date they enter inventory', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'BV', count: 3 });
    expect((await cell(p, type.id, '2026-11-10')).capacity).toBe(3);
    // a villa opening later only counts from its opening night, and is applied to existing ledger rows
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: { from: '2026-11-30', to: '2026-12-02' },
        quantity: 1,
        ref: stay(),
      }),
    );
    await p.run((tx) =>
      inventory.createUnit(tx, p.propertyId, {
        unitTypeId: type.id,
        number: 'BV99',
        inInventoryFrom: '2026-12-01',
      }),
    );
    expect((await cell(p, type.id, '2026-11-30')).capacity).toBe(3);
    expect((await cell(p, type.id, '2026-12-01')).capacity).toBe(4);
  });

  it('validates occupancy limits and unique codes with explanations', async () => {
    const p = await setupProperty(t);
    await expect(
      p.run((tx) =>
        inventory.createUnitType(tx, p.propertyId, {
          code: 'BAD',
          name: 'Bad',
          kind: 'room',
          baseOccupancy: 4,
          maxAdults: 2,
          maxChildren: 0,
          maxOccupancy: 2,
        }),
      ),
    ).rejects.toThrow(/Occupancy limits do not fit/);
    await unitTypeWithUnits(p, { code: 'DUP', count: 1 });
    await expect(unitTypeWithUnits(p, { code: 'DUP', count: 1 })).rejects.toThrow(/already used/);
  });

  it('only accepts features from the property catalog', async () => {
    const p = await setupProperty(t);
    await expect(
      p.run((tx) =>
        inventory.createUnitType(tx, p.propertyId, {
          code: 'WV',
          name: 'Water Villa',
          kind: 'villa',
          baseOccupancy: 2,
          maxAdults: 2,
          maxChildren: 1,
          maxOccupancy: 3,
          features: ['water_villa'],
        }),
      ),
    ).rejects.toThrow(/not in the property's feature catalog: water_villa/);
    await p.run((tx) =>
      inventory.createFeature(tx, p.propertyId, {
        code: 'water_villa',
        name: 'Over water',
        category: 'location',
      }),
    );
    const wv = await p.run((tx) =>
      inventory.createUnitType(tx, p.propertyId, {
        code: 'WV',
        name: 'Water Villa',
        kind: 'villa',
        baseOccupancy: 2,
        maxAdults: 2,
        maxChildren: 1,
        maxOccupancy: 3,
        features: ['water_villa'],
      }),
    );
    expect(wv).toMatchObject({
      noun: 'Villa',
      features: ['water_villa'],
      isComposite: false,
      composition: null,
    });
  });

  it('enforces the plan limit on units (limits.units)', async () => {
    const p = await setupProperty(t, { planCode: 'essentials' }); // 40 units
    await unitTypeWithUnits(p, { code: 'RM', kind: 'room', count: 40 });
    await expect(unitTypeWithUnits(p, { code: 'RX', kind: 'room', count: 1 })).rejects.toThrow(
      /plan allows 40 units/,
    );
  });
});

describe('consume and release', () => {
  it('consumes every night or none and reports the short nights', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'BV', count: 1 });
    const first = stay();
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: { from: '2026-11-11', to: '2026-11-12' },
        quantity: 1,
        ref: first,
      }),
    );
    const err = await p
      .run((tx) =>
        inventory.consume(tx, {
          propertyId: p.propertyId,
          unitTypeId: type.id,
          nights: N,
          quantity: 1,
          ref: stay(),
        }),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InventoryUnavailableError);
    expect((err as InventoryUnavailableError).shortNights).toEqual([{ date: '2026-11-11', available: 0 }]);
    expect((err as InventoryUnavailableError).message).toMatch(/nothing was booked/);
    // nights 10 and 12 were not consumed (all-or-nothing)
    expect((await cell(p, type.id, '2026-11-10')).sold).toBe(0);
    expect((await cell(p, type.id, '2026-11-12')).sold).toBe(0);
  });

  it('leaves nothing behind when the caller catches the error and continues its transaction', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'BV', count: 1 });
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: { from: '2026-11-12', to: '2026-11-13' },
        quantity: 1,
        ref: stay(),
      }),
    );
    const other = stay();
    await p.run(async (tx) => {
      await expect(
        inventory.consume(tx, {
          propertyId: p.propertyId,
          unitTypeId: type.id,
          nights: N,
          quantity: 1,
          ref: other,
        }),
      ).rejects.toBeInstanceOf(InventoryUnavailableError);
      // the transaction is still usable and nothing was consumed for `other`
      await inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: { from: '2026-11-10', to: '2026-11-12' },
        quantity: 1,
        ref: other,
      });
    });
    expect((await cell(p, type.id, '2026-11-10')).sold).toBe(1);
    expect((await cell(p, type.id, '2026-11-12')).sold).toBe(1);
  });

  it('re-applying the same consumption is idempotent (INV-R14)', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'BV', count: 2 });
    const ref = stay();
    const input = { propertyId: p.propertyId, unitTypeId: type.id, nights: N, quantity: 1, ref };
    const a = await p.run((tx) => inventory.consume(tx, input));
    const b = await p.run((tx) => inventory.consume(tx, input));
    expect(a.applied).toBe(true);
    expect(b.applied).toBe(false);
    expect((await cell(p, type.id, '2026-11-11')).sold).toBe(1);
    await expect(p.run((tx) => inventory.consume(tx, { ...input, quantity: 2 }))).rejects.toThrow(
      /changeConsumption/,
    );
  });

  it('releases all or part of a ref and its unit assignment', async () => {
    const p = await setupProperty(t);
    const { type, unitIds } = await unitTypeWithUnits(p, { code: 'BV', count: 2 });
    const ref = stay();
    await p.run(async (tx) => {
      await inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        ref,
      });
      await inventory.assignUnit(tx, { unitId: unitIds[0] as string, ref, nights: N });
    });
    const part = await p.run((tx) =>
      inventory.release(tx, { ref, nights: { from: '2026-11-12', to: '2026-11-13' } }),
    );
    expect(part.releasedCells).toHaveLength(1);
    expect(part.unassigned).toEqual([
      { unitId: unitIds[0], nights: { from: '2026-11-12', to: '2026-11-13' } },
    ]);
    const assignments = await p.run((tx) =>
      inventory.listAssignments(tx, { propertyId: p.propertyId, range: N, ref }),
    );
    expect(assignments.map((a) => a.nights)).toEqual([{ from: '2026-11-10', to: '2026-11-12' }]);
    await p.run((tx) => inventory.release(tx, { ref }));
    expect((await cell(p, type.id, '2026-11-10')).sold).toBe(0);
    expect(
      await p.run((tx) => inventory.listAssignments(tx, { propertyId: p.propertyId, range: N, ref })),
    ).toEqual([]);
    // releasing again is a no-op
    expect((await p.run((tx) => inventory.release(tx, { ref }))).releasedCells).toEqual([]);
  });

  it('changes consumption atomically: extension keeps the assignment, a failing change keeps the original', async () => {
    const p = await setupProperty(t);
    const { type, unitIds } = await unitTypeWithUnits(p, { code: 'BV', count: 1 });
    const { type: other } = await unitTypeWithUnits(p, { code: 'WV', count: 1 });
    const ref = stay();
    await p.run(async (tx) => {
      await inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        ref,
      });
      await inventory.assignUnit(tx, { unitId: unitIds[0] as string, ref, nights: N });
    });
    const ext = await p.run((tx) =>
      inventory.changeConsumption(tx, {
        ref,
        from: { unitTypeId: type.id, nights: N },
        to: { unitTypeId: type.id, nights: { from: '2026-11-10', to: '2026-11-15' } },
      }),
    );
    expect(ext.added.map((a) => a.night)).toEqual(['2026-11-13', '2026-11-14']);
    expect(ext.kept).toHaveLength(3);
    const asg = await p.run((tx) =>
      inventory.listAssignments(tx, { propertyId: p.propertyId, range: N, ref }),
    );
    expect(asg.map((a) => a.nights)).toEqual([{ from: '2026-11-10', to: '2026-11-13' }]);

    // move to WV fails on a sold-out night → original consumption intact
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: other.id,
        nights: { from: '2026-11-14', to: '2026-11-15' },
        quantity: 1,
        ref: stay(),
      }),
    );
    await p.run(async (tx) => {
      await expect(
        inventory.changeConsumption(tx, {
          ref,
          from: { unitTypeId: type.id, nights: { from: '2026-11-10', to: '2026-11-15' } },
          to: { unitTypeId: other.id, nights: { from: '2026-11-10', to: '2026-11-15' } },
        }),
      ).rejects.toBeInstanceOf(InventoryUnavailableError);
    });
    expect((await cell(p, type.id, '2026-11-10')).sold).toBe(1);
    expect((await cell(p, other.id, '2026-11-10')).sold).toBe(0);
    const still = await p.run((tx) =>
      inventory.listAssignments(tx, { propertyId: p.propertyId, range: N, ref }),
    );
    expect(still).toHaveLength(1);
  });

  it('transfers consumption between refs without changing availability', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'BV', count: 5 });
    const block = { type: 'groupBlock', id: newId() };
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 3,
        ref: block,
        kind: 'block_allocation',
      }),
    );
    const s = stay();
    await p.run((tx) =>
      inventory.transferConsumption(tx, { from: block, to: s, unitTypeId: type.id, nights: N, quantity: 1 }),
    );
    const c = await cell(p, type.id, '2026-11-11');
    expect(c).toMatchObject({ sold: 3, available: 2 });
    await expect(
      p.run((tx) =>
        inventory.transferConsumption(tx, {
          from: block,
          to: stay(),
          unitTypeId: type.id,
          nights: N,
          quantity: 3,
        }),
      ),
    ).rejects.toThrow(/does not hold 3/);
  });
});

describe('holds', () => {
  it('holds count until converted; conversion keeps availability unchanged', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'BV', count: 2 });
    const quote = { type: 'quote', id: newId() };
    const { holdId } = await p.run((tx) =>
      inventory.createHold(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        ref: quote,
      }),
    );
    expect(await cell(p, type.id, '2026-11-10')).toMatchObject({ held: 1, available: 1 });
    const s = stay();
    await p.run((tx) => inventory.convertHold(tx, { holdId, ref: s }));
    expect(await cell(p, type.id, '2026-11-10')).toMatchObject({ held: 0, sold: 1, available: 1 });
    // converting again for the same ref is idempotent
    const again = await p.run((tx) => inventory.convertHold(tx, { holdId, ref: s }));
    expect(again.applied).toBe(false);
  });

  it('never lets an expired hold block a sale (lazy expiry, INV-I09) and emits hold.expired once', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'BV', count: 1 });
    const { holdId } = await p.run((tx) =>
      inventory.createHold(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        expiresAt: new Date(Date.now() + 1500),
        ref: { type: 'cart', id: newId() },
      }),
    );
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
    ).rejects.toBeInstanceOf(InventoryUnavailableError);
    await new Promise((r) => setTimeout(r, 1600));
    // the grid already excludes the expired hold before anything sweeps it
    expect((await cell(p, type.id, '2026-11-10')).held).toBe(0);
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: { from: '2026-11-11', to: '2026-11-12' },
        quantity: 1,
        ref: stay(),
      }),
    );
    const hold = await p.run((tx) => inventory.getHold(tx, holdId));
    expect(hold.status).toBe('expired');
    expect((await cell(p, type.id, '2026-11-10')).held).toBe(0);
    const rows = await adminQuery<{ n: number }>(
      t,
      `select count(*)::int as n from core.outbox where type = 'inventory.hold.expired' and payload->>'holdId' = $1`,
      [holdId],
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe('authorized overbooking vs inventory conflicts', () => {
  it('ad-hoc overbooking needs the sensitive permission and is recorded with who and why', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'BV', count: 1 });
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        ref: stay(),
      }),
    );
    const managerId = newId();
    const over = { authorizedBy: managerId, reason: 'VIP repeat guest; one villa expected to free up' };
    await expect(
      p.as(['inventory.availability.read'], (tx) =>
        inventory.consume(tx, {
          propertyId: p.propertyId,
          unitTypeId: type.id,
          nights: N,
          quantity: 1,
          ref: stay(),
          overbooking: over,
        }),
      ),
    ).rejects.toThrow(/inventory\.overbooking\.authorize/);
    const r = await p.as(['inventory.overbooking.authorize', 'inventory.availability.read'], (tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        ref: stay(),
        overbooking: over,
      }),
    );
    expect(r.overbookingAllowanceIds).toHaveLength(3);
    const c = await cell(p, type.id, '2026-11-11');
    expect(c).toMatchObject({
      sold: 2,
      overbookingAllowance: 1,
      available: 0,
      overbookingInUse: 1,
      oversoldBy: 0,
      status: 'overbooked',
      conflictId: null,
    });
    const allowances = await p.run((tx) =>
      inventory.listOverbookingAllowances(tx, { propertyId: p.propertyId, range: N }),
    );
    expect(allowances[0]).toMatchObject({ kind: 'ad_hoc', authorizedBy: managerId, reason: over.reason });
  });

  it('records a channel sale on a sold-out night as an inventory conflict, and resolves it when inventory returns', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'BV', count: 1 });
    const desk = stay();
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        ref: desk,
      }),
    );
    const channel = stay();
    const r = await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        ref: channel,
        onShortfall: 'record_conflict',
      }),
    );
    expect(r.conflictIds).toHaveLength(3);
    const c = await cell(p, type.id, '2026-11-11');
    expect(c).toMatchObject({ available: -1, oversoldBy: 1, status: 'oversold' });
    expect(c.conflictId).not.toBeNull();
    const conflicts = await p.run((tx) => inventory.listConflicts(tx, { propertyId: p.propertyId }));
    expect(conflicts).toHaveLength(3);
    expect(conflicts[0]).toMatchObject({
      status: 'open',
      shortfall: 1,
      causes: [{ kind: 'consumption', ref: channel }],
    });

    // a manager authorizes overbooking for one night → that conflict resolves as allowance_authorized
    await p.run((tx) =>
      inventory.setOverbookingAllowance(tx, p.propertyId, {
        unitTypeId: type.id,
        nights: { from: '2026-11-10', to: '2026-11-11' },
        quantity: 1,
        reason: 'Accept OTA booking; guest relocation partner on standby',
      }),
    );
    // the desk booking cancels → the other nights resolve as cancelled
    await p.run((tx) => inventory.release(tx, { ref: desk }));
    const all = await p.run((tx) => inventory.listConflicts(tx, { propertyId: p.propertyId, status: 'all' }));
    expect(all.map((x) => [x.night, x.status, x.resolution])).toEqual([
      ['2026-11-10', 'resolved', 'allowance_authorized'],
      ['2026-11-11', 'resolved', 'cancelled'],
      ['2026-11-12', 'resolved', 'cancelled'],
    ]);
  });

  it('refuses to lower an allowance below what is sold into it', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'BV', count: 1 });
    await p.run((tx) =>
      inventory.setOverbookingAllowance(tx, p.propertyId, {
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        reason: 'Historic no-shows',
      }),
    );
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 2,
        ref: stay(),
      }),
    );
    await expect(
      p.run((tx) =>
        inventory.setOverbookingAllowance(tx, p.propertyId, {
          unitTypeId: type.id,
          nights: N,
          quantity: 0,
          reason: 'Stop overbooking',
        }),
      ),
    ).rejects.toThrow(/already sold into this allowance/);
  });
});

describe('explanations', () => {
  it('explains a night term by term with the records behind each number', async () => {
    const p = await setupProperty(t);
    const { type, unitIds } = await unitTypeWithUnits(p, { code: 'WV', count: 3 });
    const s = stay();
    await p.run(async (tx) => {
      await inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        ref: s,
      });
      await inventory.assignUnit(tx, { unitId: unitIds[1] as string, ref: s, nights: N });
      await inventory.blockUnit(tx, {
        unitId: unitIds[2] as string,
        nights: N,
        kind: 'out_of_order',
        reason: 'Deck boards broken',
      });
      await inventory.createHold(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        expiresAt: new Date(Date.now() + 3600_000),
        ref: { type: 'quote', id: newId() },
      });
    });
    const e = await p.run((tx) =>
      inventory.explainAvailability(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        date: '2026-11-11',
      }),
    );
    expect(e).toMatchObject({
      status: 'sold_out',
      available: 0,
      terms: { capacity: 3, outOfOrder: 1, sold: 1, held: 1, overbookingAllowance: 0 },
      provenance: 'live',
    });
    expect(e.formula).toBe('3 capacity − 1 out of order − 1 sold − 1 held + 0 authorized overbooking = 0');
    expect(e.units.map((u) => u.state)).toEqual(['free', 'assigned', 'out_of_order']);
    expect(e.units[1]?.ref).toEqual(s);
    expect(e.reasons.join('\n')).toContain('Villa WV03 — Deck boards broken (back on 2026-11-13)');
    expect(e.holds).toHaveLength(1);
    expect(e.sold).toEqual([{ ref: s, quantity: 1, kind: 'stay' }]);
  });
});
