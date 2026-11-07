import { describe, expect, it } from 'vitest';
import {
  adHocAllowanceNeeded,
  availableOf,
  cellStatus,
  compositeAvailability,
  conflictAction,
  diffConsumption,
  overbookingInUse,
  oversoldBy,
  resolutionFor,
  shortNights,
} from './availability';

const cell = (over: Partial<Parameters<typeof availableOf>[0]> = {}) => ({
  capacity: 10,
  outOfOrder: 0,
  sold: 0,
  held: 0,
  overbookingAllowance: 0,
  ...over,
});

describe('availability formula (glossary)', () => {
  it('is capacity − out of order − sold − held + authorized overbooking', () => {
    expect(availableOf(cell({ outOfOrder: 1, sold: 6, held: 2, overbookingAllowance: 1 }))).toBe(2);
  });

  it('distinguishes authorized overbooking from an inventory conflict', () => {
    const authorized = cell({ sold: 11, overbookingAllowance: 2 });
    expect(availableOf(authorized)).toBe(1);
    expect(overbookingInUse(authorized)).toBe(1);
    expect(oversoldBy(authorized)).toBe(0);
    expect(cellStatus(authorized)).toBe('overbooked');

    const conflict = cell({ sold: 11, overbookingAllowance: 0 });
    expect(oversoldBy(conflict)).toBe(1);
    expect(cellStatus(conflict)).toBe('oversold');

    const exhausted = cell({ sold: 12, overbookingAllowance: 2 });
    expect(cellStatus(exhausted)).toBe('overbooked');
    expect(availableOf(exhausted)).toBe(0);
  });

  it('labels closed, sold out and available cells', () => {
    expect(cellStatus(cell({ capacity: 0 }))).toBe('closed');
    expect(cellStatus(cell({ sold: 10 }))).toBe('sold_out');
    expect(cellStatus(cell({ outOfOrder: 10 }))).toBe('sold_out');
    expect(cellStatus(cell({ sold: 3 }))).toBe('available');
    // capacity 0 but something sold (e.g. unit retired after sale) is an oversold cell, never "closed"
    expect(cellStatus(cell({ capacity: 0, sold: 1 }))).toBe('oversold');
  });

  it('reports short nights with the available count (possibly negative)', () => {
    expect(
      shortNights(
        [
          { night: '2026-11-10', available: 2 },
          { night: '2026-11-11', available: 0 },
          { night: '2026-11-12', available: -1 },
        ],
        1,
      ),
    ).toEqual([
      { date: '2026-11-11', available: 0 },
      { date: '2026-11-12', available: -1 },
    ]);
  });

  it('authorizes exactly the shortfall of one sale and never an existing deficit', () => {
    expect(adHocAllowanceNeeded(0, 1)).toBe(1);
    expect(adHocAllowanceNeeded(1, 3)).toBe(2);
    expect(adHocAllowanceNeeded(5, 3)).toBe(0);
    expect(adHocAllowanceNeeded(-2, 1)).toBe(1);
  });
});

describe('composite availability (INV-R07)', () => {
  it('worked example from the spec: Deluxe 101–103, Suite = 101+102', () => {
    // one unassigned Deluxe sold: Deluxe available 2, one free suite → min(1, floor(2/2)) = 1
    expect(
      compositeAvailability({
        freeUnits: 1,
        held: 0,
        unassignedSold: 0,
        components: [{ unitTypeId: 'deluxe', perComposite: 2, available: 2 }],
      }).available,
    ).toBe(1);
    // two Deluxe sold: floor(1/2) = 0 even though the suite's rooms are not yet assigned
    const r = compositeAvailability({
      freeUnits: 1,
      held: 0,
      unassignedSold: 0,
      components: [{ unitTypeId: 'deluxe', perComposite: 2, available: 1 }],
    });
    expect(r).toMatchObject({
      available: 0,
      unitLimit: 1,
      componentLimit: 0,
      limitingComponentTypeId: 'deluxe',
    });
  });

  it('subtracts composite holds and unassigned composite sales from free composites', () => {
    expect(
      compositeAvailability({
        freeUnits: 2,
        held: 1,
        unassignedSold: 0,
        components: [{ unitTypeId: 't', perComposite: 2, available: 6 }],
      }).available,
    ).toBe(1);
    expect(compositeAvailability({ freeUnits: 1, held: 1, unassignedSold: 1, components: [] })).toMatchObject(
      { available: -1, componentLimit: null },
    );
  });

  it('takes the most limiting component type when a composite mixes types', () => {
    const r = compositeAvailability({
      freeUnits: 3,
      held: 0,
      unassignedSold: 0,
      components: [
        { unitTypeId: 'beach', perComposite: 1, available: 5 },
        { unitTypeId: 'pool', perComposite: 1, available: 1 },
      ],
    });
    expect(r).toMatchObject({ available: 1, limitingComponentTypeId: 'pool' });
  });

  it('floors negative component availability (component oversold → composite unavailable)', () => {
    expect(
      compositeAvailability({
        freeUnits: 1,
        held: 0,
        unassignedSold: 0,
        components: [{ unitTypeId: 't', perComposite: 2, available: -1 }],
      }).available,
    ).toBe(-1);
  });
});

describe('inventory conflicts', () => {
  it('opens, updates, resolves or ignores per cell state', () => {
    expect(conflictAction(false, -1)).toBe('open');
    expect(conflictAction(true, -2)).toBe('update');
    expect(conflictAction(true, 0)).toBe('resolve');
    expect(conflictAction(false, 0)).toBe('none');
  });

  it('records the resolution kind from the action that resolved it', () => {
    expect(resolutionFor('release')).toBe('cancelled');
    expect(resolutionFor('allowance_change')).toBe('allowance_authorized');
    expect(resolutionFor('block_released')).toBe('capacity_restored');
    expect(resolutionFor('upgrade')).toBe('upgraded');
    expect(resolutionFor('assignment')).toBe('relocated');
    expect(resolutionFor('consumption_change')).toBe('moved_dates');
    expect(resolutionFor('consumption')).toBe('other');
  });
});

describe('consumption diff', () => {
  const c = (unitTypeId: string, night: string, quantity = 1) => ({ unitTypeId, night, quantity });

  it('keeps unchanged nights and only adds new ones for an extension', () => {
    const d = diffConsumption(
      [c('A', '2026-11-10'), c('A', '2026-11-11')],
      [c('A', '2026-11-10'), c('A', '2026-11-11'), c('A', '2026-11-12')],
    );
    expect(d.keep).toHaveLength(2);
    expect(d.add).toEqual([c('A', '2026-11-12')]);
    expect(d.remove).toEqual([]);
  });

  it('moves every night for a type change and re-applies changed quantities', () => {
    const d = diffConsumption(
      [c('A', '2026-11-10'), c('A', '2026-11-11', 2)],
      [c('B', '2026-11-10'), c('A', '2026-11-11', 3)],
    );
    expect(d.remove).toEqual([c('A', '2026-11-10'), c('A', '2026-11-11', 2)]);
    expect(d.add).toEqual([c('A', '2026-11-11', 3), c('B', '2026-11-10')]);
    expect(d.keep).toEqual([]);
  });
});
