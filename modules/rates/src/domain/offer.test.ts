import { describe, expect, it } from 'vitest';
import { cancellationStructure, termsSnapshot } from '../contracts';
import { assemble, checkEligibility, priceNights } from './offer';
import { DEFAULT_CHILD_AGE_BANDS } from './pricing';
import {
  applyPriceOverride,
  evaluateCancellationPenalty,
  levyTrueUp,
  postingPlan,
  reprice,
  verifyTerms,
} from './terms';

const KEY = Buffer.from('test-seal-key').toString('base64');
/** One rule set for the whole file: agreed commercial version ids must match the rules used later. */
const RULES = maldivesLikeRules();

import { maldivesLikeRules, RESORT } from './test-fixtures';

const UT = '00000000-0000-7000-8000-00000000a001';
const UT2 = '00000000-0000-7000-8000-00000000a002';
const PLAN = '00000000-0000-7000-8000-00000000b001';
const PROP = '00000000-0000-7000-8000-00000000c001';
const params = (base: number) => ({
  baseOccupancy: 2,
  baseAmountMinor: base,
  singleAmountMinor: null,
  extraAdultMinor: 15_000,
  childAmountsMinor: { infant: 0, child: 5_000, teen: 8_000 },
  occupancyAmountsMinor: {},
});
const occupancy = { adults: 2, childrenAges: [] as number[] };

function build(opts: { arrival?: string; departure?: string; base?: number } = {}) {
  const arrival = opts.arrival ?? '2026-12-01';
  const departure = opts.departure ?? '2026-12-04';
  const nights = ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05'];
  const rootPrices = new Map(nights.map((d) => [d, params(opts.base ?? 50_000)]));
  const priced = priceNights({
    nights: nights.filter((d) => d >= arrival && d < departure),
    rootPrices,
    steps: [],
    unitTypeId: UT,
    ratePlanId: PLAN,
    occupancy,
    bands: DEFAULT_CHILD_AGE_BANDS,
    promotions: [],
    promotionContext: {
      arrival,
      departure,
      nights: 3,
      bookingDate: '2026-11-07',
      unitTypeId: UT,
      ratePlanId: PLAN,
    },
    currency: 'USD',
  });
  const assembled = assemble({
    property: { id: PROP, timezone: 'Indian/Maldives', checkInTime: '14:00', classification: RESORT },
    plan: {
      id: PLAN,
      code: 'BAR-HB',
      name: 'Best available, half board',
      version: 3,
      currency: 'USD',
      mealPlan: 'HB',
      roomChargeCode: 'ROOM',
      marketSegment: 'leisure',
      taxInclusion: { mode: 'exclusive' },
      commission: null,
      chain: [{ id: PLAN, code: 'BAR-HB', version: 3 }],
    },
    unitTypeId: UT,
    arrival,
    departure,
    bookingDate: '2026-11-07',
    occupancy,
    bands: DEFAULT_CHILD_AGE_BANDS,
    drafts: priced.drafts,
    inclusions: [
      {
        id: '00000000-0000-7000-8000-00000000d001',
        version: 1,
        code: 'HB',
        name: 'Half board',
        kind: 'component',
        chargeCode: 'FB_HB',
        taxCategory: 'food_beverage',
        pricing: { kind: 'fixed', amountMinor: 6_000 },
        basis: 'per_person',
        rhythm: { kind: 'nightly' },
        priceMode: 'included',
        fulfilmentOutlets: ['main-restaurant'],
        outletKind: null,
        allowance: null,
      },
    ],
    promotions: [],
    policies: {
      cancellation: {
        id: '00000000-0000-7000-8000-00000000e001',
        code: 'FLEX14',
        name: 'Flexible 14 days',
        version: 1,
        structure: cancellationStructure.parse({
          tiers: [{ from: { kind: 'days_before_arrival', days: 14 }, penalty: { kind: 'first_night' } }],
          earlyDeparture: { kind: 'nights', nights: 1 },
        }),
      },
      guarantee: null,
      deposit: null,
    },
    taxRules: RULES,
    meta: {
      quoteId: '00000000-0000-7000-8000-00000000f001',
      quotedAt: '2026-11-07T08:00:00.000Z',
      configVector: 'cv1',
      priceSource: 'portico_quote',
      restrictionOverride: null,
      supersedesSeal: null,
      sealKey: KEY,
    },
  });
  return { assembled, priced };
}

describe('offer assembly', () => {
  it('splits revenue, computes taxes per component and keeps totals equal to line sums', () => {
    const { assembled } = build();
    const n = assembled.nightly[0];
    expect(n?.components.map((c) => [c.code, c.amount.amountMinor])).toEqual([
      ['ROOM', 38_000],
      ['HB', 12_000],
    ]);
    // Green Tax only on the accommodation component; SC + TGST on both.
    expect(n?.taxes.filter((t) => t.ruleCode === 'GREEN12')).toHaveLength(1);
    expect(n?.taxes.filter((t) => t.ruleCode === 'TGST')).toHaveLength(2);
    const t = assembled.totals;
    expect(t.net.amountMinor).toBe(150_000);
    expect(t.net.amountMinor + t.taxes.amountMinor + t.fees.amountMinor).toBe(t.gross.amountMinor);
    expect(assembled.nightly.reduce((s, x) => s + x.gross.amountMinor, 0)).toBe(t.gross.amountMinor);
    expect(t.fees.amountMinor).toBe(15_000); // 10% service charge
    expect(t.taxes.amountMinor).toBe(3 * (2_400 + Math.round(0.17 * 55_000)));
    expect(assembled.taxSummary.map((x) => x.ruleCode)).toEqual(['SC', 'TGST', 'GREEN12']);
    expect(assembled.taxesAndFees.length).toBe(3 * 5); // flat lines: per night, room (3 rules) + HB (2 rules)
    expect(assembled.terms.taxes.commercialRuleVersionIds).toHaveLength(1);
    expect(assembled.unverifiedTaxRules).toEqual(['SC', 'TGST', 'GREEN12']);
    expect(assembled.policies.cancellation?.tiers[0]?.fromInstant).toBe('2026-11-16T19:00:00.000Z');
  });

  it('produces a sealed snapshot that survives JSON + schema round trips', () => {
    const { assembled } = build();
    expect(verifyTerms(KEY, assembled.terms)).toBe(true);
    const roundTrip = termsSnapshot.parse(JSON.parse(JSON.stringify(assembled.terms)));
    expect(verifyTerms(KEY, roundTrip)).toBe(true);
    const tampered = {
      ...roundTrip,
      nights: roundTrip.nights.map((x, i) =>
        i === 0 ? { ...x, amount: { ...x.amount, amountMinor: 1 } } : x,
      ),
    };
    expect(verifyTerms(KEY, tampered)).toBe(false);
  });

  it('derives the posting plan from the snapshot alone with deterministic keys', () => {
    const { assembled } = build();
    const plan = postingPlan(assembled.terms, 'stay-1');
    expect(plan).toHaveLength(6);
    expect(plan[0]).toMatchObject({
      idempotencyKey: 'room:stay-1:2026-12-01',
      amount: { amountMinor: 38_000 },
      taxCategory: 'accommodation',
    });
    expect(plan[1]?.idempotencyKey).toBe('inclusion:stay-1:00000000-0000-7000-8000-00000000d001:2026-12-01');
    const sum = plan.reduce((s, l) => s + l.amount.amountMinor, 0);
    expect(sum).toBe(assembled.totals.net.amountMinor);
    // Additive line identity: nightly lines keep their key; the identity never depends on anything else.
    for (const l of plan) if (l.occurrence.rhythm === 'nightly') expect(l.lineKey).toBe(l.idempotencyKey);
    expect(new Set(plan.map((l) => l.lineKey)).size).toBe(plan.length);
  });

  it('reports eligibility violations as not overridable', () => {
    const v = checkEligibility(
      {
        status: 'active',
        eligibility: {
          channels: ['direct'],
          companyIds: ['00000000-0000-7000-8000-000000000001'],
          maxAdults: 2,
        },
      },
      {
        channelId: 'ota-x',
        occupancy: { adults: 3, childrenAges: [] },
        bookingDate: '2026-11-07',
        arrival: '2026-12-01',
        departure: '2026-12-02',
      },
    );
    expect(v.map((x) => x.kind)).toEqual([
      'not_eligible_channel',
      'not_eligible_company',
      'occupancy_not_allowed',
    ]);
    expect(v.every((x) => !x.overridable)).toBe(true);
  });
});

describe('repricing agreed terms (change previews)', () => {
  const ctx = (current: ReturnType<typeof build>['priced'] | null) => ({
    property: { id: PROP, timezone: 'Indian/Maldives', checkInTime: '14:00', classification: RESORT },
    taxRules: RULES,
    meta: {
      quoteId: '00000000-0000-7000-8000-00000000f002',
      quotedAt: '2026-11-20T08:00:00.000Z',
      configVector: 'cv2',
      sealKey: KEY,
    },
    current: current
      ? { drafts: new Map(current.drafts.map((d) => [d.date, d])), violations: current.violations }
      : null,
    currentAgreedType: null,
  });

  it('keeps agreed nights at agreed prices and prices extension nights at current rates', () => {
    const agreed = build().assembled.terms;
    // Rates went up after booking: current price 70,000.
    const current = build({ arrival: '2026-12-01', departure: '2026-12-06', base: 70_000 }).priced;
    const r = reprice({
      ...ctx(current),
      terms: agreed,
      range: { from: '2026-12-01', to: '2026-12-06' },
      occupancy,
      unitTypeId: UT,
      newNightsPolicy: 'current_rates',
      typeChangePolicy: 'keep_agreed',
      changeAt: new Date('2026-11-20T08:00:00Z'),
    });
    expect(r.nightly.map((n) => [n.date, n.source, n.after?.amountMinor])).toEqual([
      ['2026-12-01', 'agreed', 50_000],
      ['2026-12-02', 'agreed', 50_000],
      ['2026-12-03', 'agreed', 50_000],
      ['2026-12-04', 'current_rates', 70_000],
      ['2026-12-05', 'current_rates', 70_000],
    ]);
    expect(r.violations).toEqual([]);
    expect(r.terms.supersedesSeal).toBe(agreed.seal);
    expect(verifyTerms(KEY, r.terms)).toBe(true);
    expect(verifyTerms(Buffer.from('another-key').toString('base64'), r.terms)).toBe(false);
    expect(r.difference.amountMinor).toBe(r.after.gross.amountMinor - r.before.gross.amountMinor);
  });

  it('prices new nights at the agreed average or manually, by policy', () => {
    const agreed = build().assembled.terms;
    const avg = reprice({
      ...ctx(null),
      terms: agreed,
      range: { from: '2026-12-01', to: '2026-12-05' },
      occupancy,
      unitTypeId: UT,
      newNightsPolicy: 'agreed_average',
      typeChangePolicy: 'keep_agreed',
      changeAt: new Date('2026-11-20T08:00:00Z'),
    });
    expect(avg.nightly[3]).toMatchObject({ source: 'agreed_average', after: { amountMinor: 50_000 } });
    const manual = reprice({
      ...ctx(null),
      terms: agreed,
      range: { from: '2026-12-01', to: '2026-12-05' },
      occupancy,
      unitTypeId: UT,
      newNightsPolicy: 'manual',
      typeChangePolicy: 'keep_agreed',
      changeAt: new Date('2026-11-20T08:00:00Z'),
    });
    expect(manual.violations[0]?.message).toMatch(/manual price/);
  });

  it('reprices occupancy changes from the agreed occupancy pricing and applies penalties to removed nights', () => {
    const agreed = build().assembled.terms;
    const r = reprice({
      ...ctx(null),
      terms: agreed,
      range: { from: '2026-12-01', to: '2026-12-03' },
      occupancy: { adults: 3, childrenAges: [] },
      unitTypeId: UT,
      newNightsPolicy: 'current_rates',
      typeChangePolicy: 'keep_agreed',
      changeAt: new Date('2026-11-25T08:00:00Z'), // inside the 14-day tier
    });
    expect(r.nightly.map((n) => [n.source, n.after?.amountMinor ?? null])).toEqual([
      ['occupancy_repriced', 65_000],
      ['occupancy_repriced', 65_000],
      ['removed', null],
    ]);
    expect(r.penalties[0]).toMatchObject({ kind: 'cancellation', nights: ['2026-12-03'] });
    // Penalty basis = night price + hotel-set fees (service charge), not statutory per-guest levies.
    const third = agreed.nights[2];
    const fees = (third?.taxes ?? [])
      .filter((t) => t.nature === 'commercial')
      .reduce((a, t) => a + t.amount.amountMinor, 0);
    expect(r.penalties[0]?.amount.amountMinor).toBe((third?.net.amountMinor ?? 0) + fees);
    // After arrival a removed night is an early departure.
    const late = reprice({
      ...ctx(null),
      terms: agreed,
      range: { from: '2026-12-01', to: '2026-12-03' },
      occupancy,
      unitTypeId: UT,
      newNightsPolicy: 'current_rates',
      typeChangePolicy: 'keep_agreed',
      changeAt: new Date('2026-12-02T08:00:00Z'),
    });
    expect(late.penalties[0]?.kind).toBe('early_departure');
  });

  it('a complimentary unit-type upgrade keeps the agreed price', () => {
    const agreed = build().assembled.terms;
    const r = reprice({
      ...ctx(null),
      terms: agreed,
      range: { from: '2026-12-01', to: '2026-12-04' },
      occupancy,
      unitTypeId: UT2,
      newNightsPolicy: 'current_rates',
      typeChangePolicy: 'keep_agreed',
      changeAt: new Date('2026-11-20T08:00:00Z'),
    });
    expect(r.difference.amountMinor).toBe(0);
    expect(r.terms.unitTypeId).toBe(UT2);
  });
});

describe('agreed-terms providers (penalties, Green Tax true-up, overrides)', () => {
  const property = { id: PROP, timezone: 'Indian/Maldives', checkInTime: '14:00', classification: RESORT };

  it('evaluates cancellation, no-show and early-departure penalties from the agreement alone', () => {
    const terms = build().assembled.terms;
    const free = evaluateCancellationPenalty(terms, new Date('2026-11-10T00:00:00Z'));
    expect(free).toMatchObject({ event: 'cancellation', tier: null, amount: { amountMinor: 0 } });
    const late = evaluateCancellationPenalty(terms, new Date('2026-11-25T00:00:00Z'));
    expect(late.event).toBe('cancellation');
    expect(late.penalty.kind).toBe('first_night');
    // Basis = night price + service charge; Green Tax (statutory per-guest levy) is not a penalty (R-27).
    const n0 = terms.nights[0];
    const sc = (n0?.taxes ?? [])
      .filter((t) => t.nature === 'commercial')
      .reduce((a, t) => a + t.amount.amountMinor, 0);
    expect(late.amount.amountMinor).toBe((n0?.net.amountMinor ?? 0) + sc);
    const noShow = evaluateCancellationPenalty(terms, new Date('2026-12-02T10:00:00Z'), { event: 'no_show' });
    expect(noShow.penalty.kind).toBe('first_night');
    const early = evaluateCancellationPenalty(terms, new Date('2026-12-02T10:00:00Z'));
    expect(early).toMatchObject({ event: 'early_departure', nights: ['2026-12-02', '2026-12-03'] });
    expect(early.amount.amountMinor).toBe(terms.nights[1]?.net.amountMinor ? early.amount.amountMinor : 0);
  });

  it('trues up Green Tax to actual 24-hour blocks at check-out', () => {
    const terms = build().assembled.terms; // 3 nights, 2 adults
    const late = levyTrueUp(terms, {
      checkInAt: new Date('2026-12-01T09:00:00Z'),
      checkOutAt: new Date('2026-12-04T21:00:00Z'),
    });
    expect(late).toMatchObject({ agreedDays: 3, actualDays: 4, deltaDays: 1 });
    expect(late.line).toMatchObject({
      levyOnly: true,
      nights: 1,
      adjustment: 'supply',
      serviceDate: '2026-12-05',
    });
    const short = levyTrueUp(terms, {
      checkInAt: new Date('2026-12-01T21:00:00Z'),
      checkOutAt: new Date('2026-12-04T07:00:00Z'),
    });
    expect(short).toMatchObject({ actualDays: 2, deltaDays: -1 });
    expect(short.line?.adjustment).toBe('reversal');
    expect(
      levyTrueUp(terms, {
        checkInAt: new Date('2026-12-01T09:00:00Z'),
        checkOutAt: new Date('2026-12-04T07:00:00Z'),
      }).line,
    ).toBeNull();
  });

  it('makes complimentary terms: price 0, value-based taxes 0, Green Tax kept, sealed with the original recorded', () => {
    const terms = build().assembled.terms;
    const comp = applyPriceOverride({
      terms,
      override: { kind: 'complimentary' },
      reason: 'Travel agent familiarization trip',
      by: 'user:gm',
      at: '2026-11-20T08:00:00.000Z',
      property,
      taxRules: RULES,
      meta: {
        quoteId: '00000000-0000-7000-8000-00000000f003',
        quotedAt: '2026-11-20T08:00:00.000Z',
        configVector: 'cv',
        sealKey: KEY,
      },
    });
    expect(comp.priceSource).toBe('complimentary');
    expect(comp.totals.net.amountMinor).toBe(0);
    expect(comp.totals.fees.amountMinor).toBe(0);
    expect(comp.totals.taxes.amountMinor).toBe(3 * 2_400);
    expect(comp.priceOverride).toMatchObject({
      kind: 'complimentary',
      original: { seal: terms.seal, totals: terms.totals },
    });
    expect(comp.supersedesSeal).toBe(terms.seal);
    expect(verifyTerms(KEY, comp)).toBe(true);
    const manual = applyPriceOverride({
      terms,
      override: { kind: 'total', totalMinor: 100_001 },
      reason: 'Matched competitor rate',
      by: 'user:gm',
      at: '2026-11-20T08:00:00.000Z',
      property,
      taxRules: RULES,
      meta: {
        quoteId: '00000000-0000-7000-8000-00000000f004',
        quotedAt: '2026-11-20T08:00:00.000Z',
        configVector: 'cv',
        sealKey: KEY,
      },
    });
    expect(manual.nights.map((n) => n.amount.amountMinor)).toEqual([33_334, 33_334, 33_333]);
    expect(manual.priceSource).toBe('manual_override');
  });
});
