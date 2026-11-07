/**
 * Scenario 3 (brief §17), inventory part: a guest extends a stay into dates when their assigned villa is already
 * booked. Type-level availability is checked separately from the specific villa: the extension succeeds at type
 * level, assigning the same villa for the new nights fails clearly with the conflicting stay, and
 * findAssignableUnits offers the alternatives (another villa for the extra nights, or a villa free for the whole
 * stay). Reservations builds the previewed options (RES-R15) on top of these calls.
 */
import { addDays } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InventoryUnavailableError, UnitAssignmentConflictError } from '../src';
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

const ORIGINAL = { from: '2026-11-10', to: '2026-11-13' };
const EXTENDED = { from: '2026-11-10', to: '2026-11-15' };
const EXTRA = { from: '2026-11-13', to: '2026-11-15' };

async function setup() {
  const p = await setupProperty(t);
  const { type, unitIds, numbers } = await unitTypeWithUnits(p, {
    code: 'WV',
    name: 'Water Villa',
    count: 3,
    zone: 'Jetty A',
  });
  const guest = stay();
  const next = stay();
  await p.run(async (tx) => {
    await inventory.consume(tx, {
      propertyId: p.propertyId,
      unitTypeId: type.id,
      nights: ORIGINAL,
      quantity: 1,
      ref: guest,
    });
    await inventory.assignUnit(tx, { unitId: unitIds[0] as string, ref: guest, nights: ORIGINAL });
    // the same villa is booked from the 13th by the next guest
    await inventory.consume(tx, {
      propertyId: p.propertyId,
      unitTypeId: type.id,
      nights: { from: '2026-11-13', to: '2026-11-16' },
      quantity: 1,
      ref: next,
    });
    await inventory.assignUnit(tx, {
      unitId: unitIds[0] as string,
      ref: next,
      nights: { from: '2026-11-13', to: '2026-11-16' },
    });
  });
  return { p, type, unitIds, numbers, guest, next };
}

describe('S03 — extension into nights where the assigned villa is taken', () => {
  it('extends at type level, fails clearly on the villa, and offers alternatives', async () => {
    const { p, type, unitIds, numbers, guest, next } = await setup();
    const outcome = await p.run(async (tx) => {
      // 1) type-level: two more nights of Water Villa are available
      const change = await inventory.changeConsumption(tx, {
        ref: guest,
        from: { unitTypeId: type.id, nights: ORIGINAL },
        to: { unitTypeId: type.id, nights: EXTENDED },
        reason: 'dates',
      });
      // 2) the guest's villa is taken on the new nights → clear conflict naming the other stay
      const conflict = await inventory
        .assignUnit(tx, { unitId: unitIds[0] as string, ref: guest, nights: EXTRA })
        .catch((e: unknown) => e);
      // 3) alternatives for the extra nights, and for the whole stay
      const forExtraNights = await inventory.findAssignableUnits(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: EXTRA,
        ref: guest,
      });
      const forWholeStay = await inventory.findAssignableUnits(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: EXTENDED,
        ref: guest,
      });
      return { change, conflict, forExtraNights, forWholeStay };
    });

    expect(outcome.change.added.map((a) => a.night)).toEqual(['2026-11-13', '2026-11-14']);
    expect(outcome.conflict).toBeInstanceOf(UnitAssignmentConflictError);
    const err = outcome.conflict as UnitAssignmentConflictError;
    expect(err.code).toBe('unit_assignment_conflict');
    expect(err.status).toBe(409);
    // domain-map contract: { ref, nights }[] (unit details alongside in conflictDetails)
    expect(err.conflicts).toEqual([{ ref: next, nights: EXTRA }]);
    expect(err.details?.conflicts).toEqual([{ ref: next, nights: EXTRA }]);
    expect(err.conflictDetails[0]).toMatchObject({ unitNumber: numbers[0], nights: EXTRA });
    expect(err.message).toMatch(/Choose another unit .* or move the other stay first/);

    // alternatives: the two other villas are free on the extra nights; the guest's own villa is excluded with the reason
    const extra = outcome.forExtraNights;
    expect(extra.filter((c) => c.assignable).map((c) => c.number)).toEqual([numbers[1], numbers[2]]);
    const own = extra.find((c) => c.unitId === unitIds[0]);
    expect(own).toMatchObject({ assignable: false });
    expect(own?.exclusions[0]).toMatchObject({ code: 'assigned', ref: next, nights: EXTRA });
    // for the whole stay, the current villa is not possible; the guest's current villa ranks first only when free
    const whole = outcome.forWholeStay;
    expect(whole[0]).toMatchObject({ assignable: true, number: numbers[1] });
    expect(whole.find((c) => c.unitId === unitIds[0])?.assignable).toBe(false);

    // The extension committed at type level; the original assignment (10–13) is intact.
    expect((await cell(p, type.id, '2026-11-14')).sold).toBe(2);
    const asg = await p.run((tx) =>
      inventory.listAssignments(tx, { propertyId: p.propertyId, range: EXTENDED, ref: guest }),
    );
    expect(asg.map((a) => [a.unitNumber, a.nights])).toEqual([[numbers[0], ORIGINAL]]);
  });

  it('option (a): another villa for the extra nights only (split with a move)', async () => {
    const { p, unitIds, numbers, guest, type } = await setup();
    await p.run(async (tx) => {
      await inventory.changeConsumption(tx, {
        ref: guest,
        from: { unitTypeId: type.id, nights: ORIGINAL },
        to: { unitTypeId: type.id, nights: EXTENDED },
      });
      await inventory.assignUnit(tx, { unitId: unitIds[1] as string, ref: guest, nights: EXTRA });
    });
    const asg = await p.run((tx) =>
      inventory.listAssignments(tx, { propertyId: p.propertyId, range: EXTENDED, ref: guest }),
    );
    expect(asg.map((a) => [a.unitNumber, a.nights])).toEqual([
      [numbers[0], ORIGINAL],
      [numbers[1], EXTRA],
    ]);
  });

  it('option (b): move the whole stay to a villa free for the full period (atomic move)', async () => {
    const { p, unitIds, numbers, guest, type } = await setup();
    const moved = await p.run(async (tx) => {
      await inventory.changeConsumption(tx, {
        ref: guest,
        from: { unitTypeId: type.id, nights: ORIGINAL },
        to: { unitTypeId: type.id, nights: EXTENDED },
      });
      return inventory.assignUnit(tx, { unitId: unitIds[2] as string, ref: guest, nights: EXTENDED });
    });
    expect(moved).toMatchObject({ change: 'moved', previousUnitIds: [unitIds[0]] });
    const asg = await p.run((tx) =>
      inventory.listAssignments(tx, { propertyId: p.propertyId, range: EXTENDED, ref: guest }),
    );
    expect(asg.map((a) => [a.unitNumber, a.nights])).toEqual([[numbers[2], EXTENDED]]);
  });

  it('a locked assignment is only moved with an explicit, permitted override', async () => {
    const { p, unitIds, guest, type } = await setup();
    await p.run((tx) =>
      inventory.assignUnit(tx, {
        unitId: unitIds[0] as string,
        ref: guest,
        nights: ORIGINAL,
        locked: true,
        lockReason: 'Honeymoon — requested villa',
      }),
    );
    await p.run((tx) =>
      inventory.changeConsumption(tx, {
        ref: guest,
        from: { unitTypeId: type.id, nights: ORIGINAL },
        to: { unitTypeId: type.id, nights: EXTENDED },
      }),
    );
    await expect(
      p.run((tx) => inventory.assignUnit(tx, { unitId: unitIds[1] as string, ref: guest, nights: EXTENDED })),
    ).rejects.toThrow(/locked to unit\(s\) .*Honeymoon/);
    await expect(
      p.as(['inventory.assignment.manage'], (tx) =>
        inventory.assignUnit(tx, {
          unitId: unitIds[1] as string,
          ref: guest,
          nights: EXTENDED,
          overrideLock: true,
        }),
      ),
    ).rejects.toThrow(/inventory\.assignment\.overrideLock/);
    const moved = await p.as(['inventory.assignment.manage', 'inventory.assignment.overrideLock'], (tx) =>
      inventory.assignUnit(tx, {
        unitId: unitIds[1] as string,
        ref: guest,
        nights: EXTENDED,
        overrideLock: true,
      }),
    );
    expect(moved.change).toBe('moved');
  });

  it('when the whole villa type is sold out on the new nights, the extension fails and nothing changes', async () => {
    const { p, type, guest } = await setup();
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: { from: '2026-11-14', to: addDays('2026-11-14', 1) },
        quantity: 2,
        ref: stay(),
      }),
    );
    const err = await p
      .run((tx) =>
        inventory.changeConsumption(tx, {
          ref: guest,
          from: { unitTypeId: type.id, nights: ORIGINAL },
          to: { unitTypeId: type.id, nights: EXTENDED },
        }),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InventoryUnavailableError);
    expect((err as InventoryUnavailableError).shortNights).toEqual([{ date: '2026-11-14', available: 0 }]);
    expect((await cell(p, type.id, '2026-11-13')).sold).toBe(1);
    const asg = await p.run((tx) =>
      inventory.listAssignments(tx, { propertyId: p.propertyId, range: EXTENDED, ref: guest }),
    );
    expect(asg).toHaveLength(1);
  });
});
