/**
 * Scenario 8 (brief §17), inventory part: a maintenance outage (a water-villa jetty section) makes several
 * assigned villas unavailable. blockUnit never refuses because nights are sold — it returns the affected
 * assignments (and emits them in inventory.unit.blocked) so reservations can relocate the guests, records an
 * inventory conflict for nights that became oversold, and availability/explanations change immediately.
 * Relocating the guests (move, upgrade) resolves the conflict; releasing the block restores capacity.
 */
import type { EntityRef } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const STAYS = { from: '2026-11-10', to: '2026-11-14' };
const OUTAGE = { from: '2026-11-11', to: '2026-11-13' };

describe('S08 — a maintenance outage makes several assigned villas unavailable', () => {
  it('returns affected assignments, records conflicts, updates availability, and resolves through relocation', async () => {
    const p = await setupProperty(t);
    const {
      type: wv,
      unitIds: villas,
      numbers,
    } = await unitTypeWithUnits(p, { code: 'WV', name: 'Water Villa', count: 5, zone: 'Jetty A' });
    const { type: owv } = await unitTypeWithUnits(p, {
      code: 'OWV',
      name: 'Overwater Pool Villa',
      count: 2,
      zone: 'Jetty B',
    });
    const guests = [stay(), stay(), stay(), stay()];
    await p.run(async (tx) => {
      for (const [i, g] of guests.entries()) {
        await inventory.consume(tx, {
          propertyId: p.propertyId,
          unitTypeId: wv.id,
          nights: STAYS,
          quantity: 1,
          ref: g,
        });
        if (i < 3) await inventory.assignUnit(tx, { unitId: villas[i] as string, ref: g, nights: STAYS });
      }
    });
    expect(await cell(p, wv.id, '2026-11-11')).toMatchObject({ capacity: 5, sold: 4, available: 1 });

    // The engineer closes villas 01 and 02 (jetty boards) for two nights.
    const engineer = ['inventory.block.manage', 'inventory.unit.read'];
    const first = await p.as(engineer, (tx) =>
      inventory.blockUnit(tx, {
        unitId: villas[0] as string,
        nights: OUTAGE,
        kind: 'out_of_order',
        reason: 'Jetty A boards unsafe',
        sourceRef: { type: 'workOrder', id: '0193f0a0-0000-7000-8000-000000000001' },
      }),
    );
    expect(first.affectedAssignments).toEqual([
      { ref: guests[0], nights: OUTAGE, unitId: villas[0], viaCompositeUnitId: null },
    ]);
    expect(first.conflictsCreated).toEqual([]); // 5 − 1 − 4 = 0: still fits
    const second = await p.as(engineer, (tx) =>
      inventory.blockUnit(tx, {
        unitId: villas[1] as string,
        nights: OUTAGE,
        kind: 'out_of_order',
        reason: 'Jetty A boards unsafe',
      }),
    );
    expect(second.affectedAssignments).toEqual([
      { ref: guests[1], nights: OUTAGE, unitId: villas[1], viaCompositeUnitId: null },
    ]);
    expect(second.conflictsCreated).toHaveLength(2); // both nights oversold by 1

    // Availability and the explanation reflect it immediately.
    const night = await cell(p, wv.id, '2026-11-11');
    expect(night).toMatchObject({
      capacity: 5,
      outOfOrder: 2,
      sold: 4,
      available: -1,
      oversoldBy: 1,
      status: 'oversold',
    });
    const why = await p.run((tx) =>
      inventory.explainAvailability(tx, { propertyId: p.propertyId, unitTypeId: wv.id, date: '2026-11-11' }),
    );
    expect(why.headline).toMatch(/Oversold by 1/);
    expect(why.units.filter((u) => u.state === 'out_of_order').map((u) => u.number)).toEqual([
      numbers[0],
      numbers[1],
    ]);
    expect(why.reasons.join(' ')).toContain('Jetty A boards unsafe');
    expect(why.conflict).toMatchObject({ status: 'open', shortfall: 1 });

    // The event carries the affected assignments for reservations' relocation workflow.
    const events = await adminQuery<{
      payload: { blockId: string; affectedAssignments: unknown[]; conflictsCreated: string[] };
    }>(
      t,
      `select payload from core.outbox where type = 'inventory.unit.blocked' and tenant_id = $1 order by created_at`,
      [p.tenantId],
    );
    expect(events.map((e) => e.payload.blockId)).toEqual([first.blockId, second.blockId]);
    expect(events[1]?.payload.affectedAssignments).toEqual(second.affectedAssignments);
    expect(events[1]?.payload.conflictsCreated).toEqual(second.conflictsCreated);

    // Blocked villas cannot be assigned; the block names its reason and end.
    await expect(
      p.run((tx) =>
        inventory.assignUnit(tx, { unitId: villas[0] as string, ref: guests[3] as EntityRef, nights: STAYS }),
      ),
    ).rejects.toThrow(/out of order \(Jetty A boards unsafe\) from 2026-11-11 until 2026-11-13/);

    // Relocation: guest 0 is upgraded to an overwater villa for the whole stay; guest 1 moves to villa 05.
    const candidates = await p.run((tx) =>
      inventory.findAssignableUnits(tx, {
        propertyId: p.propertyId,
        unitTypeId: wv.id,
        nights: STAYS,
        ref: guests[1],
      }),
    );
    expect(candidates.filter((c) => c.assignable).map((c) => c.number)).toEqual([numbers[3], numbers[4]]);
    expect(candidates.find((c) => c.unitId === villas[0])?.exclusions[0]).toMatchObject({
      code: 'out_of_order',
    });
    const owvUnits = await p.run((tx) => inventory.listUnits(tx, p.propertyId, { unitTypeId: owv.id }));
    await p.run(async (tx) => {
      const up = await inventory.assignUnit(tx, {
        unitId: owvUnits[0]?.id as string,
        ref: guests[0] as EntityRef,
        nights: STAYS,
        upgrade: { reason: 'Relocated: jetty maintenance', chargeable: false },
      });
      expect(up).toMatchObject({ change: 'moved', upgradedFromUnitTypeIds: [wv.id] });
      await inventory.assignUnit(tx, {
        unitId: villas[4] as string,
        ref: guests[1] as EntityRef,
        nights: STAYS,
      });
    });
    const after = await cell(p, wv.id, '2026-11-11');
    expect(after).toMatchObject({ sold: 3, available: 0, oversoldBy: 0, conflictId: null });
    const conflicts = await p.run((tx) =>
      inventory.listConflicts(tx, { propertyId: p.propertyId, status: 'all' }),
    );
    expect(conflicts.map((c) => [c.status, c.resolution])).toEqual([
      ['resolved', 'upgraded'],
      ['resolved', 'upgraded'],
    ]);
    const block = await p.run((tx) => inventory.getBlock(tx, second.blockId));
    expect(block.affectedAssignments).toHaveLength(1);
    expect(block.outstandingAssignments).toEqual([]); // everyone relocated

    // Work finished early: releasing one block restores capacity and emits unblocked.
    const released = await p.as(engineer, (tx) =>
      inventory.releaseBlock(tx, { blockId: first.blockId, reason: 'Boards replaced and inspected' }),
    );
    expect(released).toMatchObject({ status: 'released', effectiveNights: null });
    expect(await cell(p, wv.id, '2026-11-11')).toMatchObject({ outOfOrder: 1, available: 1 });
    const unblocked = await adminQuery<{ n: number }>(
      t,
      `select count(*)::int as n from core.outbox where type = 'inventory.unit.unblocked' and tenant_id = $1`,
      [p.tenantId],
    );
    expect(unblocked[0]?.n).toBe(1);
  });

  it('out of service keeps the villa sellable but not assignable; house use consumes without revenue', async () => {
    const p = await setupProperty(t);
    const { type, unitIds } = await unitTypeWithUnits(p, { code: 'BV', count: 3 });
    await p.run((tx) =>
      inventory.blockUnit(tx, {
        unitId: unitIds[0] as string,
        nights: OUTAGE,
        kind: 'out_of_service',
        reason: 'AC service',
      }),
    );
    expect(await cell(p, type.id, '2026-11-11')).toMatchObject({
      capacity: 3,
      outOfOrder: 0,
      outOfService: 1,
      available: 3,
    });
    await expect(
      p.as(['inventory.block.manage'], (tx) =>
        inventory.blockUnit(tx, {
          unitId: unitIds[1] as string,
          nights: OUTAGE,
          kind: 'house_use',
          reason: 'GM family visit',
        }),
      ),
    ).rejects.toThrow(/inventory\.houseUse\.create/);
    await p.run((tx) =>
      inventory.blockUnit(tx, {
        unitId: unitIds[1] as string,
        nights: OUTAGE,
        kind: 'house_use',
        reason: 'GM family visit',
      }),
    );
    expect(await cell(p, type.id, '2026-11-11')).toMatchObject({ sold: 1, houseUse: 1, available: 2 });
    const s = stay();
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: OUTAGE,
        quantity: 1,
        ref: s,
      }),
    );
    await expect(
      p.run((tx) => inventory.assignUnit(tx, { unitId: unitIds[0] as string, ref: s, nights: OUTAGE })),
    ).rejects.toThrow(/out of service/);
    await expect(
      p.run((tx) => inventory.assignUnit(tx, { unitId: unitIds[1] as string, ref: s, nights: OUTAGE })),
    ).rejects.toThrow(/in house use/);
    const ok = await p.run((tx) =>
      inventory.assignUnit(tx, { unitId: unitIds[2] as string, ref: s, nights: OUTAGE }),
    );
    expect(ok.change).toBe('assigned');
  });

  it('refuses overlapping blocks, blocks in the past and blocks on combined units', async () => {
    const p = await setupProperty(t, { businessDate: '2026-11-07' });
    const { unitIds } = await unitTypeWithUnits(p, { code: 'BV', count: 2 });
    await p.run((tx) =>
      inventory.blockUnit(tx, {
        unitId: unitIds[0] as string,
        nights: OUTAGE,
        kind: 'out_of_order',
        reason: 'Roof',
      }),
    );
    await expect(
      p.run((tx) =>
        inventory.blockUnit(tx, {
          unitId: unitIds[0] as string,
          nights: { from: '2026-11-12', to: '2026-11-14' },
          kind: 'out_of_service',
          reason: 'Paint',
        }),
      ),
    ).rejects.toThrow(/already out of order \(Roof\)/);
    await expect(
      p.run((tx) =>
        inventory.blockUnit(tx, {
          unitId: unitIds[1] as string,
          nights: { from: '2026-11-01', to: '2026-11-03' },
          kind: 'out_of_order',
          reason: 'Late entry',
        }),
      ),
    ).rejects.toThrow(/before the current business date \(2026-11-07\)/);
  });
});
