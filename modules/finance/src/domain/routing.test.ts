import { describe, expect, it } from 'vitest';
import {
  assertRuleSetConsistent,
  compareSelectors,
  dayOfWeek,
  findConflicts,
  type RoutingRule,
  routeBatch,
  routeCharge,
  selectorMatches,
  validateSelector,
} from './routing';
import type { ChargeGroup } from './types';

const groups: Record<string, ChargeGroup> = {
  ROOM: 'room',
  BRKF: 'food',
  FOOD: 'food',
  SPA: 'spa',
  BEV: 'beverage',
};
const groupOf = (c: string) => groups[c];
const rule = (
  id: string,
  selector: RoutingRule['selector'],
  cap: RoutingRule['cap'] = null,
  dest = `f-${id}`,
): RoutingRule => ({
  id,
  label: id,
  destinationFolioId: dest,
  selector,
  cap,
});

describe('selector relations (specificity, never ranking)', () => {
  it('knows the weekday of a date', () => {
    expect(dayOfWeek('2026-11-07')).toBe(6); // Saturday
  });

  it('classifies disjoint, nested, identical and partial overlaps', () => {
    expect(compareSelectors({ chargeGroups: ['room'] }, { chargeGroups: ['food'] }, groupOf)).toBe(
      'disjoint',
    );
    expect(compareSelectors({ chargeCodes: ['BRKF'] }, { chargeGroups: ['food'] }, groupOf)).toBe(
      'more_specific',
    );
    expect(compareSelectors({}, { chargeCodes: ['SPA'] }, groupOf)).toBe('less_specific');
    expect(compareSelectors({ chargeGroups: ['food'] }, { chargeGroups: ['food'] }, groupOf)).toBe(
      'identical',
    );
    expect(
      compareSelectors({ chargeGroups: ['food', 'spa'] }, { chargeGroups: ['food', 'room'] }, groupOf),
    ).toBe('partial');
    // Same charges, nested dates.
    expect(
      compareSelectors(
        { chargeGroups: ['room'], serviceDateFrom: '2026-11-08', serviceDateTo: '2026-11-10' },
        { chargeGroups: ['room'], serviceDateFrom: '2026-11-07', serviceDateTo: '2026-11-12' },
        groupOf,
      ),
    ).toBe('more_specific');
    // Overlapping date windows, neither inside the other.
    expect(
      compareSelectors(
        { serviceDateFrom: '2026-11-07', serviceDateTo: '2026-11-10' },
        { serviceDateFrom: '2026-11-09', serviceDateTo: '2026-11-12' },
        groupOf,
      ),
    ).toBe('partial');
    // Adjacent half-open ranges do not overlap.
    expect(
      compareSelectors({ serviceDateTo: '2026-11-09' }, { serviceDateFrom: '2026-11-09' }, groupOf),
    ).toBe('disjoint');
  });

  it('reasons exactly about weekdays inside short ranges', () => {
    // 2026-11-07 is a Saturday; the range [Sat, Mon) contains only Sat and Sun.
    const weekendOnly = { serviceDateFrom: '2026-11-07', serviceDateTo: '2026-11-09' };
    expect(compareSelectors(weekendOnly, { daysOfWeek: [0, 6] }, groupOf)).toBe('more_specific');
    // Weekdays rule and a weekend-only range never meet.
    expect(compareSelectors(weekendOnly, { daysOfWeek: [1, 2, 3, 4, 5] }, groupOf)).toBe('disjoint');
    expect(() =>
      validateSelector({ serviceDateFrom: '2026-11-07', serviceDateTo: '2026-11-09', daysOfWeek: [3] }),
    ).toThrow(/can never match/);
    expect(() => validateSelector({ serviceDateFrom: '2026-11-09', serviceDateTo: '2026-11-07' })).toThrow(
      /must be after/,
    );
  });

  it('matches charges by code or group, half-open dates and weekday', () => {
    const s = { chargeGroups: ['food' as const], serviceDateFrom: '2026-11-07', serviceDateTo: '2026-11-08' };
    expect(selectorMatches(s, { chargeCode: 'FOOD', chargeGroup: 'food', serviceDate: '2026-11-07' })).toBe(
      true,
    );
    expect(selectorMatches(s, { chargeCode: 'FOOD', chargeGroup: 'food', serviceDate: '2026-11-08' })).toBe(
      false,
    );
    expect(selectorMatches(s, { chargeCode: 'SPA', chargeGroup: 'spa', serviceDate: '2026-11-07' })).toBe(
      false,
    );
  });

  it('rejects ties and partial overlaps when saving, naming the colliding rule', () => {
    const existing = [rule('food', { chargeGroups: ['food'] })];
    expect(findConflicts({ id: 'new', selector: { chargeGroups: ['food'] } }, existing, groupOf)).toEqual([
      { ruleId: 'food', label: 'food', verdict: 'identical' },
    ]);
    expect(findConflicts({ id: 'new', selector: { chargeCodes: ['BRKF'] } }, existing, groupOf)).toEqual([]);
    expect(() =>
      assertRuleSetConsistent(
        [...existing, rule('x', { chargeGroups: ['food', 'spa'], daysOfWeek: [6] })],
        groupOf,
      ),
    ).toThrow(/partly overlap/);
  });
});

describe('routing', () => {
  it('sends unmatched charges to the default folio and matched ones to the most specific rule', () => {
    const rules = [rule('all-food', { chargeGroups: ['food'] }), rule('brkf', { chargeCodes: ['BRKF'] })];
    const route = (code: string) =>
      routeCharge(
        rules,
        {
          chargeCode: code,
          chargeGroup: groups[code] as ChargeGroup,
          serviceDate: '2026-11-07',
          grossMinor: 1000,
        },
        'default',
        groupOf,
        () => 0,
      );
    expect(route('BRKF')).toEqual([
      expect.objectContaining({ folioId: 'f-brkf', ruleId: 'brkf', grossMinor: 1000 }),
    ]);
    expect(route('FOOD')).toEqual([expect.objectContaining({ folioId: 'f-all-food', grossMinor: 1000 })]);
    expect(route('SPA')).toEqual([expect.objectContaining({ folioId: 'default', ruleId: null })]);
  });

  it('applies per-night, per-stay and percentage limits; overflow goes to the default folio', () => {
    const nightly = [
      rule('n', { chargeGroups: ['room'] }, { kind: 'per_night', amountMinor: 30000, currency: 'USD' }),
    ];
    const out = routeBatch(
      nightly,
      [
        { chargeCode: 'ROOM', chargeGroup: 'room', serviceDate: '2026-11-07', grossMinor: 25000 },
        { chargeCode: 'ROOM', chargeGroup: 'room', serviceDate: '2026-11-07', grossMinor: 10000 },
        { chargeCode: 'ROOM', chargeGroup: 'room', serviceDate: '2026-11-08', grossMinor: 10000 },
      ],
      'default',
      groupOf,
      () => 0,
    );
    expect(out.map((o) => o.allocations.map((a) => [a.folioId, a.grossMinor]))).toEqual([
      [['f-n', 25000]],
      [
        ['f-n', 5000],
        ['default', 5000],
      ],
      [['f-n', 10000]],
    ]);
    const stay = [rule('s', {}, { kind: 'per_stay', amountMinor: 1000, currency: 'USD' })];
    expect(
      routeCharge(
        stay,
        { chargeCode: 'SPA', chargeGroup: 'spa', serviceDate: '2026-11-07', grossMinor: 700 },
        'default',
        groupOf,
        () => 600,
      ),
    ).toEqual([
      expect.objectContaining({ folioId: 'f-s', grossMinor: 400 }),
      expect.objectContaining({ folioId: 'default', grossMinor: 300 }),
    ]);
    const half = [rule('h', {}, { kind: 'percent', percent: '50' })];
    expect(
      routeCharge(
        half,
        { chargeCode: 'SPA', chargeGroup: 'spa', serviceDate: '2026-11-07', grossMinor: 1001 },
        'default',
        groupOf,
        () => 0,
      ).map((a) => a.grossMinor),
    ).toEqual([501, 500]);
    // Credits (negative charges) follow the rule without limits.
    expect(
      routeCharge(
        nightly,
        { chargeCode: 'ROOM', chargeGroup: 'room', serviceDate: '2026-11-07', grossMinor: -500 },
        'default',
        groupOf,
        () => 30000,
      ),
    ).toEqual([expect.objectContaining({ folioId: 'f-n', grossMinor: -500 })]);
  });

  it('keeps the overflow separate even when the rule targets the default folio (limits count only what the rule paid)', () => {
    const r = [rule('d', {}, { kind: 'per_night', amountMinor: 100, currency: 'USD' }, 'default')];
    expect(
      routeCharge(
        r,
        { chargeCode: 'SPA', chargeGroup: 'spa', serviceDate: '2026-11-07', grossMinor: 150 },
        'default',
        groupOf,
        () => 0,
      ),
    ).toEqual([
      expect.objectContaining({ folioId: 'default', ruleId: 'd', grossMinor: 100 }),
      expect.objectContaining({ folioId: 'default', ruleId: null, grossMinor: 50 }),
    ]);
  });
});
