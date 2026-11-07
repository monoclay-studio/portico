import { describe, expect, it } from 'vitest';
import { chargeLine } from '../contracts';
import {
  computeLine,
  computeTaxesPure,
  evalClassification,
  levyDays,
  orderForCompounding,
} from './tax-engine';
import { GUESTHOUSE, line, maldivesLikeRules, RESORT, rule } from './test-fixtures';

const adults2 = { adults: 2, childrenAges: [] as number[] };

describe('tax engine — compounding and rounding', () => {
  it('computes service charge, TGST on (net + service charge) and Green Tax per person-night (exclusive)', () => {
    const r = computeLine(maldivesLikeRules(), line({ amountMinor: 10_000, occupancy: adults2 }), {
      classification: RESORT,
    });
    const by = Object.fromEntries(r.taxes.map((t) => [t.ruleCode, t]));
    expect(by.SC?.amount.amountMinor).toBe(1_000);
    expect(by.TGST?.base?.amountMinor).toBe(11_000);
    expect(by.TGST?.amount.amountMinor).toBe(1_870);
    expect(by.GREEN12?.amount.amountMinor).toBe(2_400);
    expect(by.GREEN12?.quantity).toEqual({ persons: 2, exemptPersons: 0, nights: 1, units: 1 });
    expect(by.GREEN6).toBeUndefined();
    expect(r.net.amountMinor).toBe(10_000);
    expect(r.gross.amountMinor).toBe(10_000 + 1_000 + 1_870 + 2_400);
    // Order is the compounding order.
    expect(r.taxes.map((t) => t.ruleCode)).toEqual(['SC', 'TGST', 'GREEN12']);
  });

  it('applies the guesthouse Green Tax by property classification', () => {
    const r = computeLine(maldivesLikeRules(), line({ amountMinor: 5_000, occupancy: adults2 }), {
      classification: GUESTHOUSE,
    });
    expect(r.taxes.find((t) => t.ruleCode === 'GREEN6')?.amount.amountMinor).toBe(1_200);
    expect(r.taxes.find((t) => t.ruleCode === 'GREEN12')).toBeUndefined();
  });

  it('rounds each rule once, half-up, to the minor unit', () => {
    // 33.33 → SC 3.333 → 3.33; TGST 17% of 36.66 = 6.2322 → 6.23
    const r = computeLine(maldivesLikeRules(), line({ amountMinor: 3_333, taxCategory: 'food_beverage' }), {
      classification: RESORT,
    });
    expect(r.taxes.map((t) => t.amount.amountMinor)).toEqual([333, 623]);
    expect(r.gross.amountMinor).toBe(3_333 + 333 + 623);
  });

  it('supports half-even rounding as configuration', () => {
    const rules = [
      rule({ code: 'HE' }, [
        {
          def: {
            kind: 'percentage',
            ratePercent: '10',
            appliesTo: { taxCategories: ['accommodation'] },
            rounding: { mode: 'half_even' },
          },
        },
      ]),
    ];
    // 10% of 125 = 12.5 → half-even 12; 10% of 135 = 13.5 → 14
    expect(
      computeLine(rules, line({ amountMinor: 125 }), { classification: {} }).taxes[0]?.amount.amountMinor,
    ).toBe(12);
    expect(
      computeLine(rules, line({ amountMinor: 135 }), { classification: {} }).taxes[0]?.amount.amountMinor,
    ).toBe(14);
  });

  it('decomposes a tax-inclusive price exactly (net + Σ included = amount), Green Tax added on top', () => {
    const r = computeLine(
      maldivesLikeRules(),
      line({
        amountMinor: 12_870,
        occupancy: adults2,
        taxInclusion: { mode: 'rules', includedRuleCodes: ['SC', 'TGST'] },
      }),
      { classification: RESORT },
    );
    expect(r.net.amountMinor).toBe(10_000);
    expect(r.roundingResidueMinor).toBe(0);
    const included = r.taxes.filter((t) => t.inclusive).reduce((s, t) => s + t.amount.amountMinor, 0);
    expect(r.net.amountMinor + included).toBe(12_870);
    expect(r.taxes.find((t) => t.ruleCode === 'GREEN12')?.inclusive).toBe(false);
    expect(r.gross.amountMinor).toBe(12_870 + 2_400);
  });

  it('assigns the inclusive rounding residue to the net', () => {
    const r = computeLine(
      maldivesLikeRules(),
      line({ amountMinor: 12_999, taxInclusion: { mode: 'inclusive' }, taxCategory: 'food_beverage' }),
      { classification: RESORT },
    );
    const sum = r.taxes.reduce((s, t) => s + t.amount.amountMinor, 0);
    expect(r.net.amountMinor + sum).toBe(12_999);
    expect(Math.abs(r.roundingResidueMinor)).toBeLessThanOrEqual(2);
  });

  it('backs out fixed per-person amounts only when a line names them explicitly', () => {
    const r = computeLine(
      maldivesLikeRules(),
      line({
        amountMinor: 15_270,
        occupancy: adults2,
        taxInclusion: { mode: 'rules', includedRuleCodes: ['SC', 'TGST', 'GREEN12'] },
      }),
      { classification: RESORT },
    );
    expect(r.net.amountMinor).toBe(10_000);
    expect(r.gross.amountMinor).toBe(15_270);
  });

  it('inclusive mode includes value-based rules only: levies are added on top (R-06)', () => {
    const r = computeLine(
      maldivesLikeRules(),
      line({ amountMinor: 12_870, occupancy: adults2, taxInclusion: { mode: 'inclusive' } }),
      { classification: RESORT },
    );
    expect(r.net.amountMinor).toBe(10_000);
    expect(r.taxes.find((t) => t.ruleCode === 'GREEN12')).toMatchObject({
      inclusive: false,
      amount: { amountMinor: 2_400 },
    });
    expect(r.gross.amountMinor).toBe(12_870 + 2_400);
    // A free / complimentary tax-inclusive night does not fail and still carries Green Tax.
    const free = computeLine(
      maldivesLikeRules(),
      line({ amountMinor: 0, occupancy: adults2, taxInclusion: { mode: 'inclusive' } }),
      { classification: RESORT },
    );
    expect(free.taxes.map((t) => [t.ruleCode, t.amount.amountMinor])).toEqual([
      ['SC', 0],
      ['TGST', 0],
      ['GREEN12', 2_400],
    ]);
  });

  it('refuses an inclusive price smaller than the fixed amounts it must contain', () => {
    expect(() =>
      computeLine(
        maldivesLikeRules(),
        line({
          amountMinor: 1_000,
          occupancy: adults2,
          taxInclusion: { mode: 'rules', includedRuleCodes: ['SC', 'TGST', 'GREEN12'] },
        }),
        { classification: RESORT },
      ),
    ).toThrow(/smaller than the fixed taxes/);
  });

  it('rejects inclusion of a rule whose base depends on an excluded rule', () => {
    expect(() =>
      computeLine(
        maldivesLikeRules(),
        line({
          amountMinor: 10_000,
          occupancy: adults2,
          taxInclusion: { mode: 'rules', includedRuleCodes: ['TGST'] },
        }),
        { classification: RESORT },
      ),
    ).toThrow(/Include both or neither/);
  });

  it('mirrors reversal lines exactly, levies included', () => {
    const pos = computeLine(maldivesLikeRules(), line({ amountMinor: 3_333, occupancy: adults2 }), {
      classification: RESORT,
    });
    const neg = computeLine(
      maldivesLikeRules(),
      line({ amountMinor: -3_333, occupancy: adults2, adjustment: 'reversal' }),
      { classification: RESORT },
    );
    expect(neg.taxes.map((t) => t.amount.amountMinor)).toEqual(pos.taxes.map((t) => -t.amount.amountMinor));
    expect(neg.gross.amountMinor).toBe(-pos.gross.amountMinor);
  });

  it('a price adjustment (rebate) never touches per-guest levies (R-15)', () => {
    const rebate = computeLine(maldivesLikeRules(), line({ amountMinor: -5_000, occupancy: adults2 }), {
      classification: RESORT,
    });
    expect(rebate.taxes.map((t) => [t.ruleCode, t.amount.amountMinor])).toEqual([
      ['SC', -500],
      ['TGST', -935],
    ]);
  });

  it('keeps Green Tax on complimentary (zero-price) nights', () => {
    const r = computeLine(maldivesLikeRules(), line({ amountMinor: 0, occupancy: adults2 }), {
      classification: RESORT,
    });
    expect(r.taxes.find((t) => t.ruleCode === 'GREEN12')?.amount.amountMinor).toBe(2_400);
    expect(r.taxes.find((t) => t.ruleCode === 'SC')?.amount.amountMinor).toBe(0);
  });
});

describe('tax engine — effective dating and tax point', () => {
  it('uses the rule version in force on the service date (16% before 2025-07-01, 17% from)', () => {
    const before = computeLine(
      maldivesLikeRules(),
      line({ amountMinor: 10_000, serviceDate: '2025-06-30', occupancy: adults2 }),
      {
        classification: RESORT,
      },
    );
    const after = computeLine(
      maldivesLikeRules(),
      line({ amountMinor: 10_000, serviceDate: '2025-07-01', occupancy: adults2 }),
      {
        classification: RESORT,
      },
    );
    expect(before.taxes.find((t) => t.ruleCode === 'TGST')?.amount.amountMinor).toBe(1_760);
    expect(after.taxes.find((t) => t.ruleCode === 'TGST')?.amount.amountMinor).toBe(1_870);
    expect(before.taxes.find((t) => t.ruleCode === 'TGST')?.ruleVersionId).not.toBe(
      after.taxes.find((t) => t.ruleCode === 'TGST')?.ruleVersionId,
    );
  });

  it('pinned versions ignore end dates set later by a successor (historical recompute stays identical)', () => {
    const rules = maldivesLikeRules();
    const tgst = rules.find((r) => r.rule.code === 'TGST');
    const v17 = tgst?.versions[1];
    const closed = {
      ...tgst,
      rule: tgst?.rule,
      versions: [{ ...v17, effectiveTo: '2027-01-01' }],
      pinned: true,
    } as (typeof rules)[number];
    const r = computeLine(
      [closed],
      line({ amountMinor: 10_000, serviceDate: '2027-06-01', taxCategory: 'food_beverage' }),
      { classification: RESORT },
    );
    expect(r.taxes[0]?.ratePercent).toBe('17');
    const live = computeLine(
      [{ ...closed, pinned: false }],
      line({ amountMinor: 10_000, serviceDate: '2027-06-01', taxCategory: 'food_beverage' }),
      { classification: RESORT },
    );
    expect(live.taxes).toEqual([]);
  });

  it('does not apply a rule before its first effective date', () => {
    const r = computeLine(
      maldivesLikeRules(),
      line({ amountMinor: 10_000, serviceDate: '2024-12-31', occupancy: adults2 }),
      {
        classification: RESORT,
      },
    );
    expect(r.taxes.find((t) => t.ruleCode === 'GREEN12')).toBeUndefined();
  });

  it('honours a booking-date tax point policy as configuration', () => {
    const rules = maldivesLikeRules().map((r) =>
      r.rule.code === 'TGST' ? { ...r, rule: { ...r.rule, taxPointPolicy: 'booking_date' as const } } : r,
    );
    const r = computeLine(
      rules,
      line({ amountMinor: 10_000, serviceDate: '2025-08-01', occupancy: adults2 }),
      {
        classification: RESORT,
        stayContext: { stayNights: 3, bookingDate: '2025-05-01' },
      },
    );
    const tgst = r.taxes.find((t) => t.ruleCode === 'TGST');
    expect(tgst?.amount.amountMinor).toBe(1_760);
    expect(tgst?.taxPointDate).toBe('2025-05-01');
  });
});

describe('tax engine — time of supply (Maldives TGST: earlier of invoice or payment)', () => {
  const tosRules = () =>
    maldivesLikeRules().map((r) =>
      r.rule.code === 'TGST' ? { ...r, rule: { ...r.rule, taxPointPolicy: 'time_of_supply' as const } } : r,
    );
  const tgst = (r: ReturnType<typeof computeLine>) => r.taxes.find((t) => t.ruleCode === 'TGST');

  it('uses the earlier of invoice and payment dates', () => {
    const l = line({ amountMinor: 10_000, serviceDate: '2025-07-10', occupancy: adults2 });
    const paidEarly = computeLine(tosRules(), l, {
      classification: RESORT,
      fullPaymentDate: '2025-06-15',
      invoiceDate: '2025-07-11',
    });
    expect(tgst(paidEarly)?.amount.amountMinor).toBe(1_760);
    expect(tgst(paidEarly)?.taxPointDate).toBe('2025-06-15');
    const invoicedFirst = computeLine(tosRules(), l, {
      classification: RESORT,
      fullPaymentDate: '2025-07-12',
      invoiceDate: '2025-07-02',
    });
    expect(tgst(invoicedFirst)?.amount.amountMinor).toBe(1_870);
  });

  it('estimates with the service date when neither date is known yet (quotes)', () => {
    const r = computeLine(
      tosRules(),
      line({ amountMinor: 10_000, serviceDate: '2025-07-10', occupancy: adults2 }),
      {
        classification: RESORT,
      },
    );
    expect(tgst(r)).toMatchObject({ taxPointDate: '2025-07-10', estimated: true });
    // With an expected invoice date (e.g. check-out after a rate change) the estimate uses it (R-16).
    const atCheckout = computeLine(
      tosRules(),
      line({ amountMinor: 10_000, serviceDate: '2025-06-29', occupancy: adults2 }),
      { classification: RESORT, expectedInvoiceDate: '2025-07-02' },
    );
    expect(tgst(atCheckout)).toMatchObject({
      ratePercent: '17',
      taxPointDate: '2025-07-02',
      estimated: true,
    });
    expect(atCheckout.taxes.find((t) => t.ruleCode === 'GREEN12')?.estimated).toBe(false);
  });

  it('splits a line at fixed tax points: TGST per part, Green Tax ONCE for the line (R-08)', () => {
    const night = line({
      amountMinor: 100_000,
      serviceDate: '2025-07-10',
      occupancy: { adults: 2, childrenAges: [1, 5] },
      taxPointSplits: [{ amountMinor: 30_000, taxPointDate: '2025-06-20' }],
    });
    const r = computeLine(tosRules(), night, { classification: RESORT, invoiceDate: '2025-07-11' });
    const tg = r.taxes.filter((t) => t.ruleCode === 'TGST');
    expect(tg.map((t) => [t.ratePercent, t.taxPointDate, t.base?.amountMinor])).toEqual([
      ['16', '2025-06-20', 33_000],
      ['17', '2025-07-11', 77_000],
    ]);
    const green = r.taxes.filter((t) => t.ruleCode === 'GREEN12');
    expect(green).toHaveLength(1);
    // The fixture rule has no child exemption: 4 guests (the MV pack exempts under-2s).
    expect(green[0]).toMatchObject({
      amount: { amountMinor: 4_800 },
      quantity: { persons: 4, exemptPersons: 0 },
    });
    expect(r.net.amountMinor).toBe(100_000);
    expect(r.gross.amountMinor).toBe(
      r.net.amountMinor + r.taxes.reduce((s, t) => s + t.amount.amountMinor, 0),
    );
    expect(() =>
      computeLine(
        tosRules(),
        { ...night, taxPointSplits: [{ amountMinor: 200_000, taxPointDate: '2025-06-20' }] },
        {
          classification: RESORT,
        },
      ),
    ).toThrow(/must not exceed/);
  });

  it('never re-taxes an amount whose tax point is already fixed (a deposit taxed at payment)', () => {
    const deposit = line({
      amountMinor: 12_870,
      serviceDate: '2025-08-01',
      taxPointDate: '2025-06-20',
      taxInclusion: { mode: 'rules', includedRuleCodes: ['SC', 'TGST'] },
      occupancy: adults2,
    });
    const r = computeLine(tosRules(), deposit, { classification: RESORT, invoiceDate: '2025-08-02' });
    expect(tgst(r)?.ratePercent).toBe('16');
    expect(tgst(r)?.taxPointDate).toBe('2025-06-20');
  });
});

describe('tax engine — applicability, exemptions and caps', () => {
  it('excludes outlet kinds outside a rule (general-sector outlet not under tourism GST)', () => {
    const rules = [
      rule({ code: 'TGST' }, [
        {
          def: {
            kind: 'percentage',
            ratePercent: '17',
            appliesTo: { taxCategories: ['food_beverage'], excludeOutletKinds: ['general_sector'] },
          },
        },
      ]),
      rule({ code: 'GST' }, [
        {
          def: {
            kind: 'percentage',
            ratePercent: '8',
            appliesTo: { taxCategories: ['food_beverage'], outletKinds: ['general_sector'] },
          },
        },
      ]),
    ];
    const resortBar = computeLine(
      rules,
      line({ amountMinor: 1_000, taxCategory: 'food_beverage', outletKind: 'restaurant' }),
      { classification: {} },
    );
    expect(resortBar.taxes.map((t) => t.ruleCode)).toEqual(['TGST']);
    const shop = computeLine(
      rules,
      line({ amountMinor: 1_000, taxCategory: 'food_beverage', outletKind: 'general_sector' }),
      { classification: {} },
    );
    expect(shop.taxes.map((t) => t.ruleCode)).toEqual(['GST']);
  });

  it('refuses to guess when a classification the rule depends on is missing', () => {
    expect(() =>
      computeLine(maldivesLikeRules(), line({ amountMinor: 10_000, occupancy: adults2 }), {
        classification: { 'mv.establishmentType': 'resort' },
      }),
    ).toThrow(/mv.inhabitedIsland/);
  });

  it('decides without a missing key when another condition already settles it', () => {
    expect(
      evalClassification(
        {
          any: [
            { key: 'a', equals: true },
            { key: 'b', equals: 1 },
          ],
        },
        { a: true },
      ).result,
    ).toBe(true);
    expect(
      evalClassification(
        {
          all: [
            { key: 'a', equals: true },
            { key: 'b', equals: 1 },
          ],
        },
        { a: false },
      ).result,
    ).toBe(false);
  });

  it('applies only to matching tax categories', () => {
    const r = computeLine(maldivesLikeRules(), line({ amountMinor: 10_000, taxCategory: 'retail' }), {
      classification: RESORT,
    });
    expect(r.taxes).toEqual([]);
    expect(r.gross.amountMinor).toBe(10_000);
  });

  it('exempts children under a configured age from per-person rules', () => {
    const rules = [
      rule({ code: 'PP' }, [
        {
          def: {
            kind: 'per_person_night',
            amount: { value: '6', currency: 'USD' },
            appliesTo: { taxCategories: ['accommodation'] },
            persons: { exemptChildrenUnderAge: 2 },
          },
        },
      ]),
    ];
    const r = computeLine(rules, line({ amountMinor: 1, occupancy: { adults: 2, childrenAges: [1, 5] } }), {
      classification: {},
    });
    expect(r.taxes[0]?.quantity?.persons).toBe(3);
    expect(r.taxes[0]?.amount.amountMinor).toBe(1_800);
  });

  it('requires occupancy for per-person rules instead of assuming one', () => {
    expect(() =>
      computeLine(maldivesLikeRules(), line({ amountMinor: 10_000 }), { classification: RESORT }),
    ).toThrow(/per person per night/);
  });

  it('caps a rule to the first N nights of a stay', () => {
    const rules = [
      rule({ code: 'DIRHAM' }, [
        {
          def: {
            kind: 'per_unit_night',
            amount: { value: '20', currency: 'AED' },
            appliesTo: { taxCategories: ['accommodation'] },
            caps: { maxNights: 30 },
          },
        },
      ]),
    ];
    const ctx = { classification: {}, stayContext: { stayNights: 40 } };
    expect(
      computeLine(rules, line({ amountMinor: 50_000, currency: 'AED', nightIndex: 29 }), ctx).taxes,
    ).toHaveLength(1);
    expect(
      computeLine(rules, line({ amountMinor: 50_000, currency: 'AED', nightIndex: 30 }), ctx).taxes,
    ).toHaveLength(0);
    expect(() => computeLine(rules, line({ amountMinor: 50_000, currency: 'AED' }), ctx)).toThrow(
      /nightIndex/,
    );
  });

  it('applies a long-stay exemption and stay-length applicability', () => {
    const rules = [
      rule({ code: 'OCC' }, [
        {
          def: {
            kind: 'percentage',
            ratePercent: '5',
            appliesTo: { taxCategories: ['accommodation'] },
            exemptions: [{ kind: 'stay_nights_over', nights: 29 }],
          },
        },
      ]),
    ];
    expect(
      computeLine(rules, line({ amountMinor: 10_000 }), {
        classification: {},
        stayContext: { stayNights: 29 },
      }).taxes,
    ).toHaveLength(1);
    expect(
      computeLine(rules, line({ amountMinor: 10_000 }), {
        classification: {},
        stayContext: { stayNights: 30 },
      }).taxes,
    ).toHaveLength(0);
  });

  it('caps the amount per line', () => {
    const rules = [
      rule({ code: 'CAP' }, [
        {
          def: {
            kind: 'percentage',
            ratePercent: '10',
            appliesTo: { taxCategories: ['accommodation'] },
            caps: { maxAmountPerLine: { value: '5.00', currency: 'USD' } },
          },
        },
      ]),
    ];
    expect(
      computeLine(rules, line({ amountMinor: 10_000 }), { classification: {} }).taxes[0]?.amount.amountMinor,
    ).toBe(500);
    const incl = computeLine(rules, line({ amountMinor: 10_500, taxInclusion: { mode: 'inclusive' } }), {
      classification: {},
    });
    expect(incl.net.amountMinor).toBe(10_000);
    expect(incl.taxes[0]?.amount.amountMinor).toBe(500);
  });

  it('honours a valid exemption certificate and records it', () => {
    const rules = [
      rule({ code: 'VAT' }, [
        {
          def: {
            kind: 'percentage',
            ratePercent: '8',
            appliesTo: { taxCategories: ['accommodation'] },
            exemptions: [{ kind: 'certificate' }],
          },
        },
      ]),
    ];
    const cert = { ruleCode: 'VAT', reference: 'EXEMPT-42', validFrom: '2026-01-01', validTo: '2026-12-31' };
    const r = computeLine(rules, line({ amountMinor: 10_000 }), {
      classification: {},
      exemptionCertificates: [cert],
    });
    expect(r.taxes).toEqual([]);
    expect(r.exemptionsApplied).toEqual([{ ruleCode: 'VAT', reference: 'EXEMPT-42' }]);
    const expired = computeLine(rules, line({ amountMinor: 10_000, serviceDate: '2027-01-02' }), {
      classification: {},
      exemptionCertificates: [cert],
    });
    expect(expired.taxes).toHaveLength(1);
  });

  it('charges per-stay rules only on the first night', () => {
    const rules = [
      rule({ code: 'ARR' }, [
        {
          def: {
            kind: 'per_stay',
            amount: { value: '25', currency: 'USD' },
            appliesTo: { taxCategories: ['accommodation'] },
          },
        },
      ]),
    ];
    expect(
      computeLine(rules, line({ amountMinor: 100, nightIndex: 0 }), { classification: {} }).taxes,
    ).toHaveLength(1);
    expect(
      computeLine(rules, line({ amountMinor: 100, nightIndex: 1 }), { classification: {} }).taxes,
    ).toHaveLength(0);
  });
});

describe('tax engine — banded rates and currencies', () => {
  const banded = () => [
    rule({ code: 'GST' }, [
      {
        def: {
          kind: 'banded',
          bands: [
            { upToPerUnitNight: { value: '7500', currency: 'INR' }, ratePercent: '5' },
            { upToPerUnitNight: null, ratePercent: '18' },
          ],
          appliesTo: { taxCategories: ['accommodation'] },
        },
      },
    ]),
  ];

  it('switches rate by net price per unit-night', () => {
    expect(
      computeLine(banded(), line({ amountMinor: 750_000, currency: 'INR' }), { classification: {} }).taxes[0]
        ?.amount.amountMinor,
    ).toBe(37_500);
    expect(
      computeLine(banded(), line({ amountMinor: 750_100, currency: 'INR' }), { classification: {} }).taxes[0]
        ?.amount.amountMinor,
    ).toBe(135_018);
  });

  it('solves inclusive banded prices and refuses prices in the band gap', () => {
    const low = computeLine(
      banded(),
      line({ amountMinor: 787_500, currency: 'INR', taxInclusion: { mode: 'inclusive' } }),
      {
        classification: {},
      },
    );
    expect(low.net.amountMinor).toBe(750_000);
    const high = computeLine(
      banded(),
      line({ amountMinor: 1_180_000, currency: 'INR', taxInclusion: { mode: 'inclusive' } }),
      {
        classification: {},
      },
    );
    expect(high.net.amountMinor).toBe(1_000_000);
    expect(() =>
      computeLine(
        banded(),
        line({ amountMinor: 800_000, currency: 'INR', taxInclusion: { mode: 'inclusive' } }),
        {
          classification: {},
        },
      ),
    ).toThrow(/gap/);
  });

  it('converts fixed foreign-currency amounts only with an explicit exchange rate', () => {
    const l = line({ amountMinor: 154_200, currency: 'MVR', occupancy: adults2 });
    expect(() => computeLine(maldivesLikeRules(), l, { classification: RESORT })).toThrow(/exchange rate/);
    const r = computeLine(maldivesLikeRules(), l, {
      classification: RESORT,
      fxRates: [{ from: 'USD', to: 'MVR', rate: '15.42' }],
    });
    expect(r.taxes.find((t) => t.ruleCode === 'GREEN12')?.amount).toEqual({
      amountMinor: 37_008,
      currency: 'MVR',
    });
  });
});

describe('tax engine — determinism, ordering and totals', () => {
  it('orders by base dependencies before sequence and detects cycles', () => {
    const a = {
      rule: { code: 'A', sequence: 1 },
      def: { base: { includeNet: true, includeRuleCodes: ['B'] } },
    };
    const b = { rule: { code: 'B', sequence: 2 }, def: { base: { includeNet: true, includeRuleCodes: [] } } };
    expect(orderForCompounding([a, b]).map((x) => x.rule.code)).toEqual(['B', 'A']);
    const c = {
      rule: { code: 'C', sequence: 1 },
      def: { base: { includeNet: true, includeRuleCodes: ['D'] } },
    };
    const d = {
      rule: { code: 'D', sequence: 1 },
      def: { base: { includeNet: true, includeRuleCodes: ['C'] } },
    };
    expect(() => orderForCompounding([c, d])).toThrow(/cycle/);
  });

  it('totals equal the sum of lines and identical inputs give identical output', () => {
    const rules = maldivesLikeRules();
    const lines = [
      line({ lineId: 'n1', amountMinor: 45_000, occupancy: adults2 }),
      line({ lineId: 'b1', amountMinor: 3_000, taxCategory: 'food_beverage' }),
      line({ lineId: 't1', amountMinor: 50_000, taxCategory: 'transfer' }),
    ];
    const a = computeTaxesPure(rules, lines, { classification: RESORT });
    const b = computeTaxesPure(rules, lines, { classification: RESORT });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const net = a.lines.reduce((s, l) => s + l.net.amountMinor, 0);
    const gross = a.lines.reduce((s, l) => s + l.gross.amountMinor, 0);
    expect(a.totals.net.amountMinor).toBe(net);
    expect(a.totals.gross.amountMinor).toBe(gross);
    expect(a.totals.fees.amountMinor).toBe(4_500 + 300);
    expect(a.totals.net.amountMinor + a.totals.taxes.amountMinor + a.totals.fees.amountMinor).toBe(
      a.totals.gross.amountMinor,
    );
  });

  it('rejects mixed currencies and duplicate line ids', () => {
    expect(() =>
      computeTaxesPure(
        maldivesLikeRules(),
        [
          line({ amountMinor: 1, taxCategory: 'retail' }),
          line({ amountMinor: 1, currency: 'MVR', taxCategory: 'retail' }),
        ],
        {
          classification: RESORT,
        },
      ),
    ).toThrow(/same currency/);
    expect(() =>
      computeTaxesPure(
        maldivesLikeRules(),
        [
          line({ lineId: 'x', amountMinor: 1, taxCategory: 'retail' }),
          line({ lineId: 'x', amountMinor: 1, taxCategory: 'retail' }),
        ],
        {
          classification: RESORT,
        },
      ),
    ).toThrow(/unique/);
  });
});

describe('tax engine — commercial rules, levies and evidence', () => {
  const rulesWithScChange = () => {
    const rules = maldivesLikeRules();
    const sc = rules.find((r) => r.rule.code === 'SC');
    if (!sc) throw new Error('fixture');
    const v10 = { ...(sc.versions[0] as (typeof sc.versions)[number]), effectiveTo: '2027-01-01' };
    const v12 = {
      ...v10,
      id: '00000000-0000-7000-8000-0000000c0012',
      effectiveFrom: '2027-01-01',
      effectiveTo: null,
      definition: { ...v10.definition, ratePercent: '12' },
    };
    return { rules: rules.map((r) => (r === sc ? { ...sc, versions: [v10, v12] } : r)), v10, v12 };
  };

  it('posts hotel-set fees at the AGREED version; later versions apply only outside an agreement (R-01)', () => {
    const { rules, v10 } = rulesWithScChange();
    const agreed = computeLine(
      rules,
      line({
        amountMinor: 10_000,
        serviceDate: '2027-02-01',
        occupancy: adults2,
        agreedRuleVersionIds: [v10.id],
      }),
      { classification: RESORT },
    );
    expect(agreed.taxes.find((t) => t.ruleCode === 'SC')).toMatchObject({
      ratePercent: '10',
      nature: 'commercial',
    });
    expect(agreed.taxes.find((t) => t.ruleCode === 'TGST')?.base?.amountMinor).toBe(11_000);
    const walkIn = computeLine(
      rules,
      line({ amountMinor: 10_000, serviceDate: '2027-02-01', occupancy: adults2 }),
      {
        classification: RESORT,
      },
    );
    expect(walkIn.taxes.find((t) => t.ruleCode === 'SC')?.ratePercent).toBe('12');
    // An agreement made before a fee existed does not acquire it.
    const noFee = computeLine(
      rules,
      line({ amountMinor: 10_000, serviceDate: '2027-02-01', occupancy: adults2, agreedRuleVersionIds: [] }),
      { classification: RESORT },
    );
    expect(noFee.taxes.find((t) => t.ruleCode === 'SC')).toBeUndefined();
  });

  it('a line cannot be both levy-only and value-only (review P3-4)', () => {
    const base = {
      lineId: 'x',
      chargeCode: 'ROOM',
      taxCategory: 'accommodation',
      amount: { amountMinor: 1_000, currency: 'USD' },
      serviceDate: '2027-02-01',
    };
    expect(chargeLine.safeParse({ ...base, levyOnly: true, valueOnly: true }).success).toBe(false);
    expect(chargeLine.safeParse({ ...base, valueOnly: true }).success).toBe(true);
  });

  it('value-only lines (prepayments) need no occupancy: per-guest levies are left to the stay (integration step)', () => {
    // Regression (integration step): finance taxes a booking deposit at receipt without knowing the occupancy; with a
    // per-person Green Tax in force the engine refused it (tax_occupancy_required) and every deposit failed to post.
    expect(() =>
      computeLine(maldivesLikeRules(), line({ amountMinor: 10_000, taxPointDate: '2027-02-01' }), {
        classification: RESORT,
      }),
    ).toThrow(/per person per night/);
    const r = computeLine(
      maldivesLikeRules(),
      line({ amountMinor: 10_000, taxPointDate: '2027-02-01', valueOnly: true }),
      { classification: RESORT },
    );
    expect(r.taxes.map((t) => t.basis).every((b) => b === 'percentage' || b === 'banded')).toBe(true);
    expect(r.taxes.length).toBeGreaterThan(0);
  });

  it('levy-only lines charge per-guest levies alone; quantity rules carry no base but quantity and amount', () => {
    const r = computeLine(
      maldivesLikeRules(),
      line({ amountMinor: 0, occupancy: adults2, nights: 2, levyOnly: true }),
      { classification: RESORT },
    );
    expect(r.taxes).toHaveLength(1);
    expect(r.taxes[0]).toMatchObject({
      ruleCode: 'GREEN12',
      basis: 'per_person_night',
      base: null,
      fixedAmount: { value: '12.00', currency: 'USD' },
      quantity: { persons: 2, exemptPersons: 0, nights: 2 },
      amount: { amountMinor: 4_800 },
    });
    const reversal = computeLine(
      maldivesLikeRules(),
      line({ amountMinor: 0, occupancy: adults2, nights: 1, levyOnly: true, adjustment: 'reversal' }),
      { classification: RESORT },
    );
    expect(reversal.taxes[0]?.amount.amountMinor).toBe(-2_400);
  });

  it('counts Green Tax days in 24-hour blocks from actual check-in; the check-out block counts at ≥ 12 h (R-09)', () => {
    const at = (s: string) => new Date(s);
    // 3 nights, standard times 14:00 → 12:00: 2 full blocks + 22 h → 3 days.
    expect(levyDays(at('2026-12-01T09:00:00Z'), at('2026-12-04T07:00:00Z')).days).toBe(3);
    // Arrival after midnight (02:00) for a 3-night booking, check-out 12:00: 3 blocks + 10 h → 3 days.
    expect(levyDays(at('2026-12-01T21:00:00Z'), at('2026-12-05T07:00:00Z'))).toMatchObject({
      days: 3,
      lastBlockHours: 10,
    });
    // Late check-out 20:00 after a 14:00 arrival: 3 blocks + 6 h → 3 days; at 02:00 next day (12 h) → 4 days.
    expect(levyDays(at('2026-12-01T09:00:00Z'), at('2026-12-04T15:00:00Z')).days).toBe(3);
    expect(levyDays(at('2026-12-01T09:00:00Z'), at('2026-12-04T21:00:00Z')).days).toBe(4);
    expect(() => levyDays(at('2026-12-02T00:00:00Z'), at('2026-12-01T00:00:00Z'))).toThrow(/after check-in/);
  });

  it('records the exchange rate used for fixed foreign amounts and refuses a rate for another date (R-17)', () => {
    const l = line({ amountMinor: 154_200, currency: 'MVR', occupancy: adults2, serviceDate: '2026-12-01' });
    const r = computeLine(maldivesLikeRules(), l, {
      classification: RESORT,
      fxRates: [{ from: 'USD', to: 'MVR', rate: '15.42', source: 'MMA', asOf: '2026-12-01' }],
    });
    expect(r.taxes.find((t) => t.ruleCode === 'GREEN12')).toMatchObject({
      fx: { from: 'USD', to: 'MVR', rate: '15.42', source: 'MMA', asOf: '2026-12-01' },
      fixedAmount: { value: '12.00', currency: 'USD' },
    });
    expect(() =>
      computeLine(maldivesLikeRules(), l, {
        classification: RESORT,
        fxRates: [{ from: 'USD', to: 'MVR', rate: '15.42', source: 'MMA', asOf: '2026-11-01' }],
      }),
    ).toThrow(/for its tax point 2026-12-01/);
  });
});
