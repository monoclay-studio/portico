import { describe, expect, it } from 'vitest';
import { cancellationStructure, depositStructure, promotionConditions } from '../contracts';
import { computeInclusions } from './inclusions';
import {
  formatLocal,
  instantiateSchedule,
  penaltyAmount,
  renderCancellationText,
  resolveCancellationTiers,
  tierInForce,
  zonedInstant,
} from './policies';
import { DEFAULT_CHILD_AGE_BANDS } from './pricing';
import { applyPromotions, type PromotionCandidate } from './promotions';
import { effectiveRestrictions, evaluateRestrictions, type RestrictionRow } from './restrictions';

describe('restrictions', () => {
  const row = (r: Partial<RestrictionRow> & Pick<RestrictionRow, 'date' | 'values'>): RestrictionRow => ({
    ratePlanId: null,
    unitTypeId: null,
    ...r,
  });
  const chain = [
    { id: 'bar', inheritedKinds: [] },
    { id: 'nr', inheritedKinds: ['closed', 'closedToArrival', 'closedToDeparture', 'minLosThrough', 'maxLos'] as const },
  ];

  it('reports every violated restriction with night, kind and a reason', () => {
    const rows = [
      row({ date: '2026-12-20', ratePlanId: 'bar', values: { closedToArrival: true, minLos: 5, maxAdvanceDays: 10 } }),
      row({ date: '2026-12-21', values: { closed: true } }),
      row({ date: '2026-12-22', ratePlanId: 'bar', unitTypeId: 'villa', values: { minLosThrough: 4, salesLimit: 2 } }),
      row({ date: '2026-12-23', values: { closedToDeparture: true } }),
    ];
    const eff = effectiveRestrictions(rows, chain.slice(0, 1), 'villa');
    const v = evaluateRestrictions({
      arrival: '2026-12-20',
      departure: '2026-12-23',
      bookingDate: '2026-11-07',
      effective: eff,
      sold: new Map([['2026-12-22', 2]]),
    });
    expect(v.map((x) => [x.kind, x.date])).toEqual([
      ['closed_to_arrival', '2026-12-20'],
      ['min_los', '2026-12-20'],
      ['max_advance', '2026-12-20'],
      ['closed', '2026-12-21'],
      ['min_los_through', '2026-12-22'],
      ['sales_limit', '2026-12-22'],
      ['closed_to_departure', '2026-12-23'],
    ]);
    expect(v.find((x) => x.kind === 'min_los')?.message).toMatch(/at least 5 nights; this stay has 3/);
    expect(v.every((x) => x.overridable)).toBe(true);
    // Another unit type is not affected by the villa-specific row (only the all-types CTD applies).
    const room = evaluateRestrictions({ arrival: '2026-12-22', departure: '2026-12-23', bookingDate: '2026-12-01', effective: effectiveRestrictions(rows, chain.slice(0, 1), 'room') });
    expect(room.map((x) => x.kind)).toEqual(['closed_to_departure']);
  });

  it('never inherits sales limits (they count the plan\'s own sales)', () => {
    const rows = [row({ date: '2026-12-20', ratePlanId: 'bar', values: { salesLimit: 1 } }), row({ date: '2026-12-21', ratePlanId: 'nr', values: { salesLimit: 2 } })];
    const allKinds = [{ id: 'bar', inheritedKinds: [] }, { id: 'nr', inheritedKinds: ['salesLimit', 'closed'] as const }];
    const eff = effectiveRestrictions(rows, allKinds, 'room');
    expect(eff.get('2026-12-20')?.salesLimit).toBeUndefined();
    expect(eff.get('2026-12-21')?.salesLimit?.value).toBe(2);
  });

  it('takes the most restrictive value across scopes', () => {
    const rows = [
      row({ date: '2026-12-20', values: { minLos: 3, maxLos: 14 } }),
      row({ date: '2026-12-20', ratePlanId: 'bar', values: { minLos: 2, maxLos: 7 } }),
    ];
    const eff = effectiveRestrictions(rows, chain.slice(0, 1), 'room').get('2026-12-20');
    expect(eff?.minLos?.value).toBe(3);
    expect(eff?.maxLos?.value).toBe(7);
  });

  it('derived plans inherit chosen kinds from the parent and use their own for the others', () => {
    const rows = [
      row({ date: '2026-12-20', ratePlanId: 'bar', values: { closed: true, minLos: 2 } }),
      row({ date: '2026-12-20', ratePlanId: 'nr', values: { minLos: 4, closed: false } }),
    ];
    const eff = effectiveRestrictions(rows, chain, 'room').get('2026-12-20');
    expect(eff?.closed?.value).toBe(true); // inherited from BAR
    expect(eff?.closed?.source.ratePlanId).toBe('bar');
    expect(eff?.minLos?.value).toBe(4); // own value
  });
});

describe('promotions', () => {
  const promo = (p: Partial<PromotionCandidate> & Pick<PromotionCandidate, 'code' | 'discount'>): PromotionCandidate => ({
    id: `00000000-0000-7000-8000-0000000000${p.code.length}${p.code.charCodeAt(0)}`.slice(0, 36),
    version: 1,
    name: p.code,
    conditions: promotionConditions.parse({}),
    combinability: 'exclusive',
    stackableWith: [],
    sequence: 100,
    ...p,
  });
  const ctx = { arrival: '2026-12-01', departure: '2026-12-08', nights: 7, bookingDate: '2026-09-01', unitTypeId: 'u', ratePlanId: 'p' };
  const nights = Array.from({ length: 7 }, (_, i) => ({ date: `2026-12-0${i + 1}`, amountMinor: i === 3 ? 30_000 : 40_000 }));

  it('chooses the best exclusive promotion and shows its effect per night', () => {
    const early = promo({ code: 'EARLY', discount: { kind: 'percent', percent: '15' }, conditions: promotionConditions.parse({ minAdvanceDays: 60 }) });
    const stay7 = promo({ code: 'STAY7', discount: { kind: 'free_nights', stayNights: 7, freeNights: 1, which: 'cheapest' } });
    const r = applyPromotions([early, stay7], ctx, nights);
    expect(r.chosen.map((p) => p.code)).toEqual(['EARLY']); // 15% of 270,000 = 40,500 > cheapest night 30,000
    expect(r.effects.get('2026-12-01')?.[0]).toMatchObject({ code: 'EARLY', kind: 'percent', discountMinor: 6_000 });
    const late = applyPromotions([early, stay7], { ...ctx, bookingDate: '2026-11-20' }, nights);
    expect(late.chosen.map((p) => p.code)).toEqual(['STAY7']);
    expect(late.amounts.get('2026-12-04')).toBe(0); // the cheapest night is free
  });

  it('stacks only promotions that list each other, and requires promo codes when configured', () => {
    const a = promo({ code: 'HONEY', discount: { kind: 'percent', percent: '10' }, combinability: 'stackable', stackableWith: ['DIVE'], conditions: promotionConditions.parse({ promoCode: 'HONEYMOON' }) });
    const b = promo({ code: 'DIVE', discount: { kind: 'amount_per_night', amountMinor: 1_000 }, combinability: 'stackable' });
    const none = applyPromotions([a, b], ctx, nights);
    expect(none.chosen.map((p) => p.code)).toEqual(['DIVE']);
    const both = applyPromotions([a, b], { ...ctx, promoCode: 'honeymoon' }, nights);
    expect(both.chosen.map((p) => p.code).sort()).toEqual(['DIVE', 'HONEY']);
  });

  it('respects blackout dates per night and stay length conditions', () => {
    const p = promo({ code: 'X', discount: { kind: 'percent', percent: '10' }, conditions: promotionConditions.parse({ blackoutDates: ['2026-12-02'], minNights: 7 }) });
    const r = applyPromotions([p], ctx, nights);
    expect(r.effects.get('2026-12-02')).toBeUndefined();
    expect(r.effects.get('2026-12-03')).toHaveLength(1);
    expect(applyPromotions([p], { ...ctx, nights: 3 }, nights.slice(0, 3)).chosen).toEqual([]);
  });
});

describe('inclusions and allowances', () => {
  const base = {
    version: 1,
    fulfilmentOutlets: [],
    allowance: null,
  };
  it('allocates included components from night prices, adds others, and builds allowance entitlements', () => {
    const r = computeInclusions({
      inclusions: [
        { ...base, id: 'b', code: 'BRKF', name: 'Breakfast', kind: 'component', chargeCode: 'FB_BRKF', taxCategory: 'food_beverage', pricing: { kind: 'fixed', amountMinor: 2_500 }, basis: 'per_person', rhythm: { kind: 'nightly' }, priceMode: 'included' },
        { ...base, id: 't', code: 'SEAPLANE', name: 'Seaplane', kind: 'component', chargeCode: 'TRANSFER', taxCategory: 'transfer', pricing: { kind: 'fixed', amountMinor: 35_000 }, basis: 'per_person', rhythm: { kind: 'departure' }, priceMode: 'added' },
        {
          ...base,
          id: 'd',
          code: 'DINE',
          name: 'Dining credit',
          kind: 'allowance',
          chargeCode: 'ALLOW_DINING',
          taxCategory: 'food_beverage',
          pricing: { kind: 'percent_of_night', percent: '10' },
          basis: 'per_person',
          rhythm: { kind: 'nightly' },
          priceMode: 'included',
          allowance: { kind: 'monetary', amountMinor: 5_000, period: 'per_night', perPerson: true, eligibleChargeCodes: ['FB'], eligibleOutlets: [], excludedChargeCodes: [], remainderPolicy: 'forfeit' },
        },
      ],
      nights: [
        { date: '2026-12-01', amountMinor: 50_000 },
        { date: '2026-12-02', amountMinor: 50_000 },
      ],
      departure: '2026-12-03',
      occupancy: { adults: 2, childrenAges: [5] },
      bands: DEFAULT_CHILD_AGE_BANDS,
      currency: 'USD',
    });
    expect(r.included.get('2026-12-01')?.map((o) => [o.inclusion.code, o.amountMinor])).toEqual([
      ['BRKF', 7_500],
      ['DINE', 5_000],
    ]);
    expect(r.added).toHaveLength(1);
    expect(r.added[0]).toMatchObject({ serviceDate: '2026-12-03', nightDate: '2026-12-02', quantity: 3, amountMinor: 105_000 });
    expect(r.allowances[0]?.periods.map((p) => p.amount?.amountMinor)).toEqual([15_000, 15_000]);
    expect(r.violations).toEqual([]);
  });

  it('shrinks included revenue shares in proportion when a promotion discounts the night (never a negative room)', () => {
    const inclusion = (id: string, code: string, amountMinor: number) => ({
      ...base,
      id,
      code,
      name: code,
      kind: 'component' as const,
      chargeCode: code,
      taxCategory: 'food_beverage',
      pricing: { kind: 'fixed' as const, amountMinor },
      basis: 'per_unit' as const,
      rhythm: { kind: 'nightly' as const },
      priceMode: 'included' as const,
    });
    const r = computeInclusions({
      inclusions: [inclusion('a', 'BRKF', 3_000), inclusion('b', 'DINNER', 6_000)],
      nights: [
        { date: '2026-12-01', amountMinor: 0, baseAmountMinor: 50_000 },
        { date: '2026-12-02', amountMinor: 4_501, baseAmountMinor: 50_000 },
      ],
      departure: '2026-12-03',
      occupancy: { adults: 2, childrenAges: [] },
      bands: DEFAULT_CHILD_AGE_BANDS,
      currency: 'USD',
    });
    expect(r.violations).toEqual([]);
    expect(r.included.get('2026-12-01')?.map((o) => o.amountMinor)).toEqual([0, 0]);
    expect(r.included.get('2026-12-02')?.map((o) => o.amountMinor)).toEqual([1_500, 3_001]);
  });

  it('flags inclusions worth more than the night price', () => {
    const r = computeInclusions({
      inclusions: [{ ...base, id: 'b', code: 'AI', name: 'All inclusive', kind: 'component', chargeCode: 'FB', taxCategory: 'food_beverage', pricing: { kind: 'fixed', amountMinor: 30_000 }, basis: 'per_person', rhythm: { kind: 'nightly' }, priceMode: 'included' }],
      nights: [{ date: '2026-12-01', amountMinor: 50_000 }],
      departure: '2026-12-02',
      occupancy: { adults: 2, childrenAges: [] },
      bands: DEFAULT_CHILD_AGE_BANDS,
      currency: 'USD',
    });
    expect(r.violations[0]).toMatchObject({ kind: 'inclusion_exceeds_price', overridable: false });
  });
});

describe('policies', () => {
  it('computes deadlines in the property time zone', () => {
    // Maldives is UTC+5: 2026-12-01 00:00 local = 2026-11-30T19:00Z
    expect(zonedInstant('2026-12-01', '00:00', 'Indian/Maldives').toISOString()).toBe('2026-11-30T19:00:00.000Z');
    // DST zone: New York 2026-07-01 12:00 EDT = 16:00Z; 2026-12-01 12:00 EST = 17:00Z
    expect(zonedInstant('2026-07-01', '12:00', 'America/New_York').toISOString()).toBe('2026-07-01T16:00:00.000Z');
    expect(zonedInstant('2026-12-01', '12:00', 'America/New_York').toISOString()).toBe('2026-12-01T17:00:00.000Z');
    expect(formatLocal(new Date('2026-11-30T19:00:00Z'), 'Indian/Maldives')).toBe('2026-12-01 00:00');
  });

  const policy = cancellationStructure.parse({
    tiers: [
      { from: { kind: 'days_before_arrival', days: 14 }, penalty: { kind: 'first_night' } },
      { from: { kind: 'hours_before_checkin', hours: 48 }, penalty: { kind: 'percent_of_stay', percent: '100' } },
    ],
    noShow: { kind: 'percent_of_stay', percent: '100' },
  });
  const timing = { arrival: '2026-12-20', timeZone: 'Indian/Maldives', checkInTime: '14:00' };

  it('resolves tiers and the penalty in force at an instant', () => {
    const tiers = resolveCancellationTiers(policy, timing, 'USD');
    expect(tiers.map((t) => t.fromInstant)).toEqual(['2026-12-05T19:00:00.000Z', '2026-12-18T09:00:00.000Z']);
    expect(tierInForce(tiers, new Date('2026-12-05T18:59:59Z'))).toBeNull();
    expect(tierInForce(tiers, new Date('2026-12-05T19:00:00Z'))?.penalty.kind).toBe('first_night');
    expect(tierInForce(tiers, new Date('2026-12-19T00:00:00Z'))?.penalty.kind).toBe('percent_of_stay');
    expect(tiers[0]?.description).toBe('From 2026-12-06 00:00 (Indian/Maldives): the first night is charged.');
  });

  it('renders text from structure, including non-refundable plans', () => {
    expect(renderCancellationText(policy, 'USD')).toMatch(/^Free cancellation until the first deadline\. From 14 days before arrival/);
    const nr = cancellationStructure.parse({ tiers: [{ from: { kind: 'at_booking' }, penalty: { kind: 'percent_of_stay', percent: '100' } }] });
    expect(renderCancellationText(nr, 'USD')).toMatch(/^Non-refundable: 100% of the stay is charged/);
    expect(tierInForce(resolveCancellationTiers(nr, timing, 'USD'), new Date('2026-01-01T00:00:00Z'))?.penalty.kind).toBe('percent_of_stay');
  });

  it('computes penalty amounts', () => {
    const nights = [{ amountMinor: 10_000 }, { amountMinor: 12_000 }, { amountMinor: 12_000 }];
    expect(penaltyAmount({ kind: 'first_night' }, nights)).toBe(10_000);
    expect(penaltyAmount({ kind: 'nights', nights: 2 }, nights)).toBe(22_000);
    expect(penaltyAmount({ kind: 'percent_of_stay', percent: '50' }, nights)).toBe(17_000);
    expect(penaltyAmount({ kind: 'amount', amountMinor: 50_000 }, nights)).toBe(34_000);
  });

  it('instantiates a payment schedule that never exceeds the total and is never due before booking', () => {
    const s = depositStructure.parse({
      items: [
        { kind: 'deposit', amount: { basis: 'percent', percent: '30' }, due: { anchor: 'booking' }, method: 'payment_request' },
        { kind: 'balance', amount: { basis: 'remaining' }, due: { anchor: 'arrival', offsetDays: -30 }, method: 'card_on_file' },
      ],
    });
    const r = instantiateSchedule(s, {
      bookingDate: '2026-11-25',
      arrival: '2026-12-20',
      departure: '2026-12-23',
      nightsGrossMinor: [33_333, 33_333, 33_334],
      totalGrossMinor: 100_000,
      currency: 'USD',
    });
    expect(r.map((i) => [i.kind, i.dueDate, i.amount.amountMinor])).toEqual([
      ['deposit', '2026-11-25', 30_000],
      ['balance', '2026-11-25', 70_000],
    ]);
  });
});
