import { newId } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Offer, seedGuesthouseRates, seedResortRates, termsSnapshot, verifyTerms } from '../src';
import { newOrg, type Org, startDb, sum, unitTypes } from './harness';

let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

async function resort() {
  const o = await newOrg(t);
  const uts = unitTypes();
  const seeded = await o.run(async (tx, r) => {
    await r.installTaxTemplate(tx, { template: 'MV' });
    return seedResortRates(r, tx, {
      propertyId: o.propertyId,
      unitTypes: uts,
      from: '2026-11-07',
      days: 400,
    });
  });
  return { o, uts, seeded };
}

const q = (o: Org, body: Record<string, unknown>) =>
  o.run((tx, r) =>
    r.quoteDetailed(tx, {
      propertyId: o.propertyId,
      occupancy: { adults: 2, childrenAges: [] },
      bookingDate: '2026-11-07',
      ...body,
    }),
  );
const find = (offers: Offer[], code: string, unitTypeId: string) =>
  offers.find((x) => x.ratePlanCode === code && x.unitTypeId === unitTypeId) as Offer;

describe('quote engine — Maldives resort', () => {
  it('prices every plan × unit type with nightly prices, inclusions, taxes, totals, policies and agreed terms', async () => {
    const { o, uts } = await resort();
    const beach = uts[0]?.id as string;
    const res = await q(o, { nights: { from: '2027-02-10', to: '2027-02-13' } });
    expect(res.offers.map((x) => x.ratePlanCode).sort()).toEqual([
      'AI',
      'AI',
      'AI-HONEY',
      'AI-HONEY',
      'BAR',
      'BAR',
      'BAR-NR',
      'BAR-NR',
    ]);
    const bar = find(res.offers, 'BAR', beach);
    const nr = find(res.offers, 'BAR-NR', beach);
    expect(bar.bookable).toBe(true);
    expect(bar.nightly.map((n) => n.amount.amountMinor)).toEqual([90_000, 90_000, 90_000]); // high season
    expect(nr.nightly[0]?.amount.amountMinor).toBe(81_000); // derived −10%
    // Breakfast is allocated out of the night (revenue split), taxed as food & beverage.
    expect(bar.nightly[0]?.components.map((c) => [c.code, c.chargeCode, c.amount.amountMinor])).toEqual([
      ['ROOM', 'ROOM', 83_000],
      ['BRKF', 'FB_BREAKFAST', 7_000],
    ]);
    expect(bar.taxesAndFees.map((x) => x.ruleCode)).toEqual(['MV-SC', 'MV-TGST', 'MV-GREEN-12']);
    const t0 = bar.totals;
    expect(t0.net.amountMinor).toBe(270_000);
    expect(t0.net.amountMinor + t0.taxes.amountMinor + t0.fees.amountMinor).toBe(t0.gross.amountMinor);
    expect(sum(bar.nightly.map((n) => n.gross))).toBe(t0.gross.amountMinor);
    expect(t0.fees.amountMinor).toBe(27_000);
    expect(t0.taxes.amountMinor).toBe(3 * 2 * 1_200 + Math.round(0.17 * 297_000));
    expect(bar.unverifiedTaxRules).toEqual(['MV-SC', 'MV-TGST', 'MV-GREEN-12']);
    // Policies: structured, rendered, deadlines in Maldives time, deposit schedule instantiated.
    expect(bar.policies.cancellation?.text).toMatch(/Free cancellation until the first deadline/);
    expect(bar.policies.cancellation?.tiers[0]?.fromInstant).toBe('2027-01-19T19:00:00.000Z');
    expect(bar.policies.deposit?.schedule.map((s) => [s.kind, s.dueDate])).toEqual([
      ['deposit', '2026-11-07'],
      ['balance', '2027-01-11'],
    ]);
    expect(sum(bar.policies.deposit?.schedule.map((s) => s.amount) ?? [])).toBe(t0.gross.amountMinor);
    expect(nr.policies.cancellation?.code).toBe('NONREF');
    expect(nr.policies.deposit?.schedule[0]?.amount.amountMinor).toBe(nr.totals.gross.amountMinor);
    // Agreed terms are sealed and survive the JSON/schema round trip reservations will do.
    expect(verifyTerms(termsSnapshot.parse(JSON.parse(JSON.stringify(bar.terms))))).toBe(true);
    expect(bar.terms.configVector).toBe(res.configVector);
  });

  it('explains restriction violations and only lets permitted staff book through them (never channels)', async () => {
    const { o, uts } = await resort();
    const beach = uts[0]?.id as string;
    const festive = { nights: { from: '2026-12-22', to: '2026-12-25' }, ratePlanIds: undefined };
    const res = await q(o, festive);
    const bar = find(res.offers, 'BAR', beach);
    expect(bar.bookable).toBe(false);
    expect(bar.restrictionViolations).toEqual([
      expect.objectContaining({
        kind: 'min_los',
        date: '2026-12-22',
        required: 5,
        actual: 3,
        overridable: true,
        message: expect.stringMatching(/at least 5 nights/),
      }),
    ]);
    await expect(
      o.as([{ permission: 'rates.quote.read', propertyIds: [o.propertyId] }], (tx, r) =>
        r.quoteDetailed(tx, {
          propertyId: o.propertyId,
          occupancy: { adults: 2 },
          ...festive,
          restrictionOverride: { reason: 'VIP returning guest' },
        }),
      ),
    ).rejects.toThrow(/rates.restriction.override/);
    const overridden = await o.run((tx, r) =>
      r.quoteDetailed(tx, {
        propertyId: o.propertyId,
        occupancy: { adults: 2 },
        ...festive,
        bookingDate: '2026-11-07',
        restrictionOverride: { reason: 'VIP returning guest' },
      }),
    );
    const ob = find(overridden.offers, 'BAR', beach);
    expect(ob.bookable).toBe(true);
    expect(ob.overriddenViolations.map((v) => v.kind)).toEqual(['min_los']);
    expect(ob.terms.restrictionOverride).toMatchObject({
      reason: 'VIP returning guest',
      violations: [expect.objectContaining({ kind: 'min_los' })],
    });
    await expect(
      q(o, { ...festive, channelId: 'ota-x', restrictionOverride: { reason: 'please' } }),
    ).rejects.toThrow(/channels and the booking engine can never/);
    // RAT-I07: a channel quote never returns an offer violating restrictions.
    const channel = await q(o, { ...festive, channelId: 'ota-x' });
    expect(channel.offers).toEqual([]);
  });

  it('applies promotions per night (promo code, stay-7-pay-6) and snapshots them', async () => {
    const { o, uts, seeded } = await resort();
    const beach = uts[0]?.id as string;
    const plain = find(
      (await q(o, { nights: { from: '2027-02-10', to: '2027-02-14' } })).offers,
      'BAR',
      beach,
    );
    expect(plain.nightly[0]?.promotions).toEqual([]);
    const honey = find(
      (await q(o, { nights: { from: '2027-02-10', to: '2027-02-14' }, promoCode: 'honeymoon' })).offers,
      'BAR',
      beach,
    );
    expect(honey.nightly[0]?.promotions).toEqual([
      expect.objectContaining({
        code: 'HONEYMOON',
        kind: 'percent',
        discount: { amountMinor: 13_500, currency: 'USD' },
      }),
    ]);
    expect(honey.nightly[0]?.amount.amountMinor).toBe(76_500);
    expect(honey.terms.promotions.map((p) => [p.id, p.code])).toEqual([
      [seeded.promotions.HONEYMOON, 'HONEYMOON'],
    ]);
    // The derived NR plan is not in the promotion's plan list.
    expect(
      find(
        (await q(o, { nights: { from: '2027-02-10', to: '2027-02-14' }, promoCode: 'HONEYMOON' })).offers,
        'BAR-NR',
        beach,
      ).nightly[0]?.promotions,
    ).toEqual([]);
    const week = find(
      (await q(o, { nights: { from: '2027-03-01', to: '2027-03-08' } })).offers,
      'BAR',
      beach,
    );
    const free = week.nightly.filter((n) => n.amount.amountMinor === 0);
    expect(free).toHaveLength(1);
    expect(free[0]?.promotions[0]?.kind).toBe('free_night');
    // Green Tax is still due on the free night (complimentary stays are taxable).
    expect(free[0]?.taxes.find((x) => x.ruleCode === 'MV-GREEN-12')?.amount.amountMinor).toBe(2_400);
  });

  it('adds packages to a stay on top of the plan price and derives the payment schedule from the agreement', async () => {
    const { o, uts, seeded } = await resort();
    const beach = uts[0]?.id as string;
    const res = await q(o, {
      nights: { from: '2027-02-10', to: '2027-02-13' },
      addOnPackageIds: [seeded.packages.HONEYMOON],
    });
    const bar = find(res.offers, 'BAR', beach);
    expect(bar.inclusions.added.map((a) => [a.code, a.serviceDate, a.amount.amountMinor])).toEqual([
      ['SUNSET_CRUISE', '2027-02-11', 18_000],
    ]);
    expect(bar.nightly.map((n) => n.amount.amountMinor)).toEqual([90_000, 90_000, 90_000]);
    expect(bar.totals.net.amountMinor).toBe(270_000 + 18_000);
    expect(o.rates.instantiatePaymentSchedule(bar.terms)).toEqual(bar.policies.deposit?.schedule);
    await expect(
      q(o, { nights: { from: '2027-02-10', to: '2027-02-13' }, addOnPackageIds: [newId()] }),
    ).rejects.toThrow(/do not exist/);
  });

  it('honours eligibility: occupancy limits, channels and negotiated company plans', async () => {
    const { o, uts } = await resort();
    const beach = uts[0]?.id as string;
    const three = await q(o, {
      nights: { from: '2027-02-10', to: '2027-02-13' },
      occupancy: { adults: 3, childrenAges: [] },
    });
    expect(find(three.offers, 'AI-HONEY', beach).restrictionViolations.map((v) => v.kind)).toContain(
      'occupancy_not_allowed',
    );
    expect(find(three.offers, 'BAR', beach).nightly[0]?.amount.amountMinor).toBe(90_000 + 25_000);
    const companyId = newId();
    await o.run(async (tx, r) => {
      const bar = (await r.listRatePlans(tx, { propertyId: o.propertyId })).find((p) => p.code === 'BAR');
      const corp = await r.createRatePlan(tx, {
        propertyId: o.propertyId,
        code: 'CORP-ACME',
        name: 'ACME negotiated',
        derivation: { parentRatePlanId: bar?.id as string, adjustment: { kind: 'percent', percent: '-20' } },
        eligibility: { companyIds: [companyId], channels: ['direct'] },
        commission: { model: 'commissionable', percent: '10', base: 'room_net' },
      });
      await r.changeRatePlanStatus(tx, corp.id, corp.version, { status: 'active' });
    });
    const anonymous = await q(o, { nights: { from: '2027-02-10', to: '2027-02-13' } });
    expect(anonymous.offers.some((x) => x.ratePlanCode === 'CORP-ACME')).toBe(false);
    const acme = await q(o, { nights: { from: '2027-02-10', to: '2027-02-13' }, companyId });
    const corp = find(acme.offers, 'CORP-ACME', beach);
    expect(corp.nightly[0]?.amount.amountMinor).toBe(72_000);
    expect(corp.commission?.amount.amountMinor).toBe(
      Math.round(0.1 * sum(corp.nightly.map((n) => n.components[0]?.amount ?? { amountMinor: 0 }))),
    );
    expect(corp.terms.commission?.model).toBe('commissionable');
    const viaOta = await q(o, {
      nights: { from: '2027-02-10', to: '2027-02-13' },
      companyId,
      channelId: 'ota-x',
    });
    expect(viaOta.offers.some((x) => x.ratePlanCode === 'CORP-ACME')).toBe(false);
  });

  it('is deterministic for the same configuration vector (RAT-R30)', async () => {
    const { o } = await resort();
    const a = await q(o, { nights: { from: '2027-02-10', to: '2027-02-13' } });
    const b = await q(o, { nights: { from: '2027-02-10', to: '2027-02-13' } });
    expect(b.configVector).toBe(a.configVector);
    const strip = (r: typeof a) => r.offers.map(({ terms: _t, ...rest }) => rest);
    expect(JSON.stringify(strip(b))).toBe(JSON.stringify(strip(a)));
    await o.run(async (tx, r) => {
      const bar = (await r.listRatePlans(tx, { propertyId: o.propertyId })).find((p) => p.code === 'BAR');
      await r.updateRatePlan(tx, bar?.id as string, bar?.version as number, { name: 'BAR renamed' });
    });
    expect((await q(o, { nights: { from: '2027-02-10', to: '2027-02-13' } })).configVector).not.toBe(
      a.configVector,
    );
  });

  it('enforces sales limits through the plan sales ledger', async () => {
    const { o, uts, seeded } = await resort();
    const beach = uts[0]?.id as string;
    const nights = { from: '2027-02-10', to: '2027-02-12' };
    await o.run((tx, r) =>
      r.applyRestrictionUpdate(tx, {
        propertyId: o.propertyId,
        ratePlanId: seeded.ratePlans['BAR-NR'] as string,
        unitTypeIds: [null],
        ranges: [{ from: '2027-02-11', to: '2027-02-12' }],
        set: { salesLimit: 1 },
      }),
    );
    const sell = (id: string) =>
      o.run((tx, r) =>
        r.recordPlanSale(tx, {
          propertyId: o.propertyId,
          ratePlanId: seeded.ratePlans['BAR-NR'] as string,
          unitTypeId: beach,
          nights,
          ref: { type: 'stay', id },
        }),
      );
    const first = newId();
    await sell(first);
    await sell(first); // idempotent per ref
    await expect(sell(newId())).rejects.toMatchObject({ code: 'sales_limit_reached' });
    const offer = find((await q(o, { nights })).offers, 'BAR-NR', beach);
    expect(offer.restrictionViolations.map((v) => [v.kind, v.date])).toEqual([['sales_limit', '2027-02-11']]);
    await o.run((tx, r) => r.releasePlanSale(tx, { ref: { type: 'stay', id: first } }));
    expect(find((await q(o, { nights })).offers, 'BAR-NR', beach).bookable).toBe(true);
  });
});

describe('quote engine — Maldives guesthouse', () => {
  it('prices B&B and derived half board with child bands and the USD 6 Green Tax', async () => {
    const o = await newOrg(t, { profile: 'guesthouse' });
    const uts = unitTypes();
    await o.run(async (tx, r) => {
      await r.installTaxTemplate(tx, { template: 'MV' });
      await seedGuesthouseRates(r, tx, {
        propertyId: o.propertyId,
        unitTypes: uts,
        from: '2026-11-07',
        days: 200,
      });
    });
    const res = await q(o, {
      nights: { from: '2026-11-20', to: '2026-11-23' },
      occupancy: { adults: 2, childrenAges: [1, 7] },
      unitTypeIds: [uts[0]?.id],
    });
    const bb = res.offers.find((x) => x.ratePlanCode === 'BB') as Offer;
    const hb = res.offers.find((x) => x.ratePlanCode === 'HB') as Offer;
    // 2 adults 65 + infant 0 + child 10 = 75; HB = BB + 30 per unit-night (child amounts unchanged).
    expect(bb.nightly[0]?.amount.amountMinor).toBe(7_500);
    expect(hb.nightly[0]?.amount.amountMinor).toBe(10_500);
    expect(bb.mealPlan).toBe('BB');
    expect(hb.nightly[0]?.components.map((c) => c.code)).toEqual(['ROOM', 'BRKF', 'DINNER']);
    const green = bb.taxesAndFees.find((x) => x.ruleCode === 'MV-GREEN-6');
    expect(green?.amount.amountMinor).toBe(3 * 3 * 600); // 3 nights × (2 adults + 7-year-old); infant exempt
    expect(bb.taxesAndFees.find((x) => x.ruleCode === 'MV-GREEN-12')).toBeUndefined();
  });
});

describe('change previews (scenario S03: extension reprices only new nights)', () => {
  it('keeps agreed nights at agreed prices after a rate rise and prices the extension at current rates', async () => {
    const { o, uts, seeded } = await resort();
    const beach = uts[0]?.id as string;
    const offer = find(
      (await q(o, { nights: { from: '2027-02-10', to: '2027-02-13' } })).offers,
      'BAR',
      beach,
    );
    await o.run((tx, r) =>
      r.applyPriceUpdate(tx, {
        propertyId: o.propertyId,
        ratePlanId: seeded.ratePlans.BAR as string,
        unitTypeIds: [beach],
        ranges: [{ from: '2027-02-01', to: '2027-03-01' }],
        adjust: { kind: 'percent', percent: '20' },
        reason: 'demand',
      }),
    );
    const preview = await o.run((tx, r) =>
      r.priceChange(tx, { terms: offer.terms, change: { nights: { from: '2027-02-10', to: '2027-02-15' } } }),
    );
    expect(preview.nights.map((n) => [n.date, n.source, n.after?.amountMinor])).toEqual([
      ['2027-02-10', 'agreed', 90_000],
      ['2027-02-11', 'agreed', 90_000],
      ['2027-02-12', 'agreed', 90_000],
      ['2027-02-13', 'current_rates', 108_000],
      ['2027-02-14', 'current_rates', 108_000],
    ]);
    expect(preview.violations).toEqual([]);
    expect(preview.after.net.amountMinor).toBe(3 * 90_000 + 2 * 108_000);
    expect(preview.candidateTerms.supersedesHash).toBe(offer.terms.hash);
    expect(preview.difference.amountMinor).toBe(
      preview.after.gross.amountMinor - offer.totals.gross.amountMinor,
    );
    // A tampered snapshot is refused.
    const tampered = {
      ...offer.terms,
      nights: offer.terms.nights.map((n) => ({ ...n, amount: { ...n.amount, amountMinor: 1 } })),
    };
    await expect(o.run((tx, r) => r.priceChange(tx, { terms: tampered, change: {} }))).rejects.toThrow(
      /do not match their hash/,
    );
  });
});
