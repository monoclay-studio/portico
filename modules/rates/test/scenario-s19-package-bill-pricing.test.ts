/**
 * Operational proof scenario 19 (brief §17): "A guest's bill combines packages, allowances, different taxes, and
 * partial payments." Rates' part: one quote / agreed terms that combines a half-board package (revenue split), a
 * dining allowance with a forfeited remainder, included seaplane transfers, an added excursion, and different
 * taxes per component (service charge + TGST compounding, Green Tax per guest with the under-2 exemption, TGST
 * without service charge on transfers/activities). Totals are exact. Partial payments are finance/payments'
 * part: here the payment schedule shows the deposit/balance split that payments will collect.
 */
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Offer, postingPlan, seedResortRates, type TaxLine } from '../src';
import { newOrg, startDb, sum, unitTypes } from './harness';

let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

describe('scenario S19 — pricing a bill with packages, allowances and different taxes', () => {
  it('prices a family half-board package with allowance, transfers and an excursion with exact, explainable taxes', async () => {
    const o = await newOrg(t);
    const uts = unitTypes();
    const villa = uts[1]?.id as string;
    const seeded = await o.run(async (tx, r) => {
      await r.installTaxTemplate(tx, { template: 'MV' });
      return seedResortRates(r, tx, {
        propertyId: o.propertyId,
        unitTypes: uts,
        from: '2026-11-07',
        days: 400,
      });
    });
    const plan = await o.run(async (tx, r) => {
      const hbMeals = await r.createInclusion(tx, {
        propertyId: o.propertyId,
        code: 'HB_MEALS',
        name: 'Half board (breakfast and dinner)',
        kind: 'component',
        chargeCode: 'FB_HALFBOARD',
        taxCategory: 'food_beverage',
        pricing: {
          kind: 'fixed',
          amountMinor: 6_000,
          childBandAmountsMinor: { infant: 0, child: 2_000, teen: 4_000 },
        },
        basis: 'per_person',
        rhythm: { kind: 'nightly' },
        priceMode: 'included',
        fulfilmentOutlets: ['reef-restaurant'],
      });
      const pkg = await r.createPackage(tx, {
        propertyId: o.propertyId,
        code: 'HB-FAMILY',
        name: 'Family half board with dining credit and seaplane',
        mealPlanCode: 'HB',
        inclusionIds: [
          hbMeals.id,
          seeded.inclusions.DINE_CREDIT as string,
          seeded.inclusions.SEAPLANE_IN as string,
          seeded.inclusions.SEAPLANE_OUT as string,
        ],
      });
      const created = await r.createRatePlan(tx, {
        propertyId: o.propertyId,
        code: 'HB-FAMILY',
        name: 'Family half board package',
        mealPlan: 'HB',
        derivation: {
          parentRatePlanId: seeded.ratePlans.BAR as string,
          adjustment: { kind: 'amount', amountMinor: 100_000 },
        },
        inherit: { packages: false },
        packageIds: [pkg.id, seeded.packages.HONEYMOON as string],
      });
      return r.changeRatePlanStatus(tx, created.id, created.version, { status: 'active' });
    });
    const res = await o.run((tx, r) =>
      r.quoteDetailed(tx, {
        propertyId: o.propertyId,
        nights: { from: '2027-02-10', to: '2027-02-13' },
        occupancy: { adults: 2, childrenAges: [1, 7] },
        ratePlanIds: [plan.id],
        unitTypeIds: [villa],
        bookingDate: '2026-11-07',
      }),
    );
    const offer = res.offers[0] as Offer;
    expect(offer.bookable).toBe(true);

    // Night price: BAR water villa high season 1,300 + child (7) 120 + infant 0 = 1,420; package +1,000/unit-night.
    expect(offer.nightly.map((n) => n.amount.amountMinor)).toEqual([242_000, 242_000, 242_000]);
    // Revenue split of the arrival night: half board (2×60 + child 20 + infant 0), dining credit (2 adults × 50),
    // seaplane in (4 guests × 375), room = remainder.
    expect(
      offer.nightly[0]?.components.map((c) => [c.kind, c.code, c.taxCategory, c.amount.amountMinor]),
    ).toEqual([
      ['room', 'ROOM', 'accommodation', 242_000 - 14_000 - 10_000 - 150_000],
      ['inclusion', 'HB_MEALS', 'food_beverage', 14_000],
      ['allowance', 'DINE_CREDIT', 'food_beverage', 10_000],
      ['inclusion', 'SEAPLANE_IN', 'transfer', 150_000],
    ]);
    // Departure transfer allocated from the last night; service date = departure day.
    expect(offer.nightly[2]?.components.map((c) => c.code)).toEqual([
      'ROOM',
      'HB_MEALS',
      'DINE_CREDIT',
      'SEAPLANE_OUT',
    ]);
    // Added excursion (honeymoon extras package) on night 2, charged on top.
    expect(offer.inclusions.added.map((a) => [a.code, a.serviceDate, a.amount.amountMinor])).toEqual([
      ['SUNSET_CRUISE', '2027-02-11', 18_000],
    ]);

    // Different taxes per component.
    const taxesOf = (code: string, night = 0) =>
      (offer.nightly[night]?.taxes ?? [])
        .filter((x) => x.lineId.endsWith(`:${code === 'ROOM' ? 'room' : code}`))
        .map((x) => x.ruleCode);
    expect(taxesOf('ROOM')).toEqual(['MV-SC', 'MV-TGST', 'MV-GREEN-12']);
    expect(taxesOf('HB_MEALS')).toEqual(['MV-SC', 'MV-TGST']);
    expect(taxesOf('DINE_CREDIT')).toEqual(['MV-SC', 'MV-TGST']);
    expect(taxesOf('SEAPLANE_IN')).toEqual(['MV-TGST']);
    expect(offer.inclusions.added[0]?.taxes.map((x) => x.ruleCode)).toEqual(['MV-TGST']);
    // Compounding: TGST base = net + service charge, on every line; Green Tax outside the GST base.
    const all: TaxLine[] = [
      ...offer.nightly.flatMap((n) => n.taxes),
      ...offer.inclusions.added.flatMap((a) => a.taxes),
    ];
    for (const tg of all.filter((x) => x.ruleCode === 'MV-TGST')) {
      const sc = all.find((x) => x.lineId === tg.lineId && x.ruleCode === 'MV-SC');
      const component = [
        ...offer.nightly.flatMap((n) => n.components.map((c) => ({ c, date: n.date }))),
        ...offer.inclusions.added.map((a) => ({ c: a, date: a.nightDate })),
      ].find(({ c, date }) =>
        tg.lineId.startsWith(`n:${date}:`)
          ? tg.lineId.endsWith(`:${c.code === 'ROOM' ? 'room' : c.code}`)
          : tg.lineId.startsWith(`a:${c.code}:`),
      );
      expect(tg.base?.amountMinor ?? Number.NaN).toBe(
        (component?.c.amount.amountMinor ?? Number.NaN) + (sc?.amount.amountMinor ?? 0),
      );
      expect(tg.amount.amountMinor).toBe(Math.round(((tg.base?.amountMinor ?? Number.NaN) * 17) / 100));
    }
    // Green Tax: 3 guests per night (2 adults + 7-year-old); the 1-year-old is exempt.
    const green = all.filter((x) => x.ruleCode === 'MV-GREEN-12');
    expect(green).toHaveLength(3);
    expect(green.every((g) => g.quantity?.persons === 3 && g.amount.amountMinor === 3_600)).toBe(true);

    // Exact totals: net + taxes + fees = gross; totals equal the sum of nights + added items.
    const tot = offer.totals;
    expect(tot.net.amountMinor).toBe(3 * 242_000 + 18_000);
    expect(tot.net.amountMinor + tot.taxes.amountMinor + tot.fees.amountMinor).toBe(tot.gross.amountMinor);
    expect(sum(offer.nightly.map((n) => n.gross)) + sum(offer.inclusions.added.map((a) => a.gross))).toBe(
      tot.gross.amountMinor,
    );
    expect(sum(offer.taxesAndFees.map((x) => x.amount))).toBe(tot.taxes.amountMinor + tot.fees.amountMinor);

    // Allowance entitlement: USD 50 per adult per night, forfeited remainder → breakage (finance closes periods).
    const allowance = offer.inclusions.allowances[0];
    expect(allowance?.terms).toMatchObject({
      remainderPolicy: 'forfeit',
      breakageChargeCode: 'ALLOWANCE_BREAKAGE',
      eligibleOutlets: ['teppanyaki', 'overwater-grill'],
    });
    expect(allowance?.periods.map((p) => [p.periodKey, p.amount?.amountMinor])).toEqual([
      ['2027-02-10', 10_000],
      ['2027-02-11', 10_000],
      ['2027-02-12', 10_000],
    ]);

    // Partial payments: the agreed schedule splits the gross into deposit (30%) and balance.
    const schedule = offer.policies.deposit?.schedule ?? [];
    expect(schedule.map((s) => s.kind)).toEqual(['deposit', 'balance']);
    expect(sum(schedule.map((s) => s.amount))).toBe(tot.gross.amountMinor);

    // Everything finance needs to post the bill comes from the agreed terms alone.
    const plan2 = postingPlan(offer.terms, 'stay-s19');
    expect(plan2.map((p) => p.chargeCode)).toEqual(
      expect.arrayContaining([
        'ROOM',
        'FB_HALFBOARD',
        'ALLOWANCE_DINING',
        'TRANSFER_SEAPLANE',
        'ACTIVITY_EXCURSION',
      ]),
    );
    expect(sum(plan2.map((p) => p.amount))).toBe(tot.net.amountMinor);
    expect(new Set(plan2.map((p) => p.idempotencyKey)).size).toBe(plan2.length);
    expect(
      plan2.find((p) => p.chargeCode === 'TRANSFER_SEAPLANE' && p.nightDate === '2027-02-12')?.serviceDate,
    ).toBe('2027-02-13');
    // Additive (day-close review P0-1): the departure transfer is identified by its occurrence, not by the night it
    // is allocated to, so a re-price that moves it (extension, shortening) keeps the same line identity.
    const out = plan2.find((p) => p.chargeCode === 'TRANSFER_SEAPLANE' && p.nightDate === '2027-02-12');
    expect(out?.lineKey).toBe(`inclusion:stay-s19:${out?.inclusionId}:departure`);
    expect(out?.occurrence).toEqual({ rhythm: 'departure', stayNight: 3 });
    const arrivalTransfer = plan2.find(
      (p) => p.chargeCode === 'TRANSFER_SEAPLANE' && p.nightDate === '2027-02-10',
    );
    expect(arrivalTransfer?.lineKey).toBe(`inclusion:stay-s19:${arrivalTransfer?.inclusionId}:arrival`);
  });
});
