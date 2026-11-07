import { describe, expect, it } from 'vitest';
import type { OccupancyPricing } from '../contracts';
import { coalesceDates, expandDates, isoWeekday } from './calendar';
import {
  ancestry,
  applyAdjustment,
  DEFAULT_CHILD_AGE_BANDS,
  descendants,
  priceForOccupancy,
  resolveDerivedParams,
  validateDerivationGraph,
} from './pricing';

const params: OccupancyPricing = {
  baseOccupancy: 2,
  baseAmountMinor: 45_000,
  singleAmountMinor: 40_000,
  extraAdultMinor: 12_000,
  childAmountsMinor: { infant: 0, child: 6_000 },
  occupancyAmountsMinor: {},
};

describe('occupancy pricing', () => {
  it('prices single, base, extra adults and child bands', () => {
    const bands = DEFAULT_CHILD_AGE_BANDS;
    expect(priceForOccupancy(params, { adults: 1, childrenAges: [] }, bands)).toMatchObject({ ok: true, amountMinor: 40_000 });
    expect(priceForOccupancy(params, { adults: 2, childrenAges: [] }, bands)).toMatchObject({ ok: true, amountMinor: 45_000 });
    expect(priceForOccupancy(params, { adults: 3, childrenAges: [] }, bands)).toMatchObject({ ok: true, amountMinor: 57_000 });
    expect(priceForOccupancy(params, { adults: 2, childrenAges: [1, 7] }, bands)).toMatchObject({ ok: true, amountMinor: 51_000 });
  });

  it('uses explicit occupancy overrides first', () => {
    const p = { ...params, occupancyAmountsMinor: { '3': 50_000 } };
    expect(priceForOccupancy(p, { adults: 3, childrenAges: [] }, DEFAULT_CHILD_AGE_BANDS)).toMatchObject({ amountMinor: 50_000 });
  });

  it('never guesses a missing child band or extra adult price', () => {
    const r = priceForOccupancy(params, { adults: 2, childrenAges: [14] }, DEFAULT_CHILD_AGE_BANDS);
    expect(r).toMatchObject({ ok: false, kind: 'no_child_price' });
    const noExtra = priceForOccupancy({ ...params, extraAdultMinor: null }, { adults: 3, childrenAges: [] }, DEFAULT_CHILD_AGE_BANDS);
    expect(noExtra).toMatchObject({ ok: false, kind: 'no_price' });
  });

  it('counts children older than every band as adults', () => {
    const r = priceForOccupancy(params, { adults: 2, childrenAges: [18] }, DEFAULT_CHILD_AGE_BANDS.slice(0, 2));
    expect(r).toMatchObject({ ok: true, amountMinor: 57_000, adultsPriced: 3 });
  });
});

describe('derived plans', () => {
  it('applies percent and amount adjustments with one rounding to the increment', () => {
    expect(applyAdjustment(45_000, { kind: 'percent', percent: '-10' }, { incrementMinor: 1, mode: 'half_up' })).toBe(40_500);
    expect(applyAdjustment(45_050, { kind: 'percent', percent: '-10' }, { incrementMinor: 100, mode: 'half_up' })).toBe(40_500);
    expect(applyAdjustment(45_099, { kind: 'percent', percent: '-10' }, { incrementMinor: 100, mode: 'down' })).toBe(40_500);
    expect(applyAdjustment(1_000, { kind: 'amount', amountMinor: -2_000 }, { incrementMinor: 1, mode: 'half_up' })).toBe(0);
  });

  it('derives every price parameter through a multi-level chain, with per-unit-type differentials', () => {
    const steps = [
      { ratePlanId: 'nr', adjustment: { kind: 'percent' as const, percent: '-10' }, rounding: { incrementMinor: 100, mode: 'half_up' as const }, unitTypeAdjustments: {} },
      {
        ratePlanId: 'pkg',
        adjustment: { kind: 'amount' as const, amountMinor: 5_000 },
        rounding: { incrementMinor: 1, mode: 'half_up' as const },
        unitTypeAdjustments: { villa: { kind: 'amount' as const, amountMinor: 10_000 } },
      },
    ];
    const room = resolveDerivedParams(params, steps, 'room');
    expect(room.baseAmountMinor).toBe(40_500 + 5_000);
    expect(room.childAmountsMinor).toEqual({ infant: 5_000, child: 10_400 });
    const villa = resolveDerivedParams(params, steps, 'villa');
    expect(villa.baseAmountMinor).toBe(40_500 + 10_000);
  });

  const plans = [
    { id: 'bar', parentId: null, code: 'BAR' },
    { id: 'nr', parentId: 'bar', code: 'NR' },
    { id: 'nrpkg', parentId: 'nr', code: 'NRPKG' },
    { id: 'other', parentId: null, code: 'OTHER' },
  ];

  it('rejects cycles and depth beyond base + 2', () => {
    expect(() => validateDerivationGraph(plans, 'bar', 'nrpkg')).toThrow(/derive from itself/);
    expect(() => validateDerivationGraph(plans, 'bar', 'bar')).toThrow(/derive from itself/);
    expect(() => validateDerivationGraph([...plans, { id: 'x', parentId: null, code: 'X' }], 'x', 'nrpkg')).toThrow(/at most 2 levels/);
    // Re-parenting a plan that has children must keep the whole subtree within depth.
    expect(() => validateDerivationGraph(plans, 'nr', 'other')).not.toThrow();
    expect(() => validateDerivationGraph([...plans, { id: 'mid', parentId: 'other', code: 'MID' }], 'nr', 'mid')).toThrow(/NRPKG would be deeper/);
    expect(() => validateDerivationGraph(plans, 'nr', 'missing')).toThrow(/does not exist/);
  });

  it('walks ancestry and descendants', () => {
    expect(ancestry(plans, 'nrpkg').map((p) => p.id)).toEqual(['bar', 'nr', 'nrpkg']);
    expect(descendants(plans, 'bar').map((p) => p.id)).toEqual(['nr', 'nrpkg']);
  });
});

describe('calendar expansion', () => {
  it('expands half-open ranges by ISO weekday and coalesces back', () => {
    expect(isoWeekday('2026-11-09')).toBe(1); // Monday
    expect(isoWeekday('2026-11-08')).toBe(7); // Sunday
    const weekends = expandDates([{ from: '2026-11-01', to: '2026-11-15' }], [6, 7]);
    expect(weekends).toEqual(['2026-11-01', '2026-11-07', '2026-11-08', '2026-11-14']);
    expect(coalesceDates(weekends)).toEqual([
      { from: '2026-11-01', to: '2026-11-02' },
      { from: '2026-11-07', to: '2026-11-09' },
      { from: '2026-11-14', to: '2026-11-15' },
    ]);
  });

  it('deduplicates overlapping ranges and bounds bulk size', () => {
    expect(expandDates([{ from: '2026-01-01', to: '2026-01-04' }, { from: '2026-01-03', to: '2026-01-05' }])).toHaveLength(4);
    expect(() => expandDates([{ from: '2026-01-01', to: '2029-01-01' }])).toThrow(/at most/);
  });
});
