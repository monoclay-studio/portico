/**
 * The rates provider contract as consumers (reservations, finance, distribution, booking engine) use it, and the
 * steward-review fixes behind it: principal-derived channel / booking date / company (R-04), connected mode
 * (R-11), inclusive free nights (R-06), bounded percentages (R-07), price override and complimentary terms (R-12),
 * unit-type-scoped sales limits (R-13), net rates (R-23), plan changes in priceChange (R-03), rule-pack status.
 */
import { withTenantTx } from '@portico/db';
import { newId, type RequestContext, staticAuthorizer } from '@portico/kernel';
import { platform } from '@portico/platform';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Offer, promotionInput, seedResortRates } from '../src';
import { newOrg, type Org, startDb, sum, unitTypes } from './harness';

let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

async function resort(opts: Parameters<typeof newOrg>[1] = {}) {
  const o = await newOrg(t, opts);
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
  return { o, uts, seeded, beach: uts[0]?.id as string, water: uts[1]?.id as string };
}

/** Run as an external principal (OTA API client or booking-engine guest) holding only rates.quote.read. */
function asPrincipal<T>(
  o: Org,
  actor: RequestContext['actor'],
  fn: Parameters<Org['run']>[0] extends (tx: infer X, r: infer R) => unknown
    ? (tx: X, r: R) => Promise<T>
    : never,
) {
  const ctx: RequestContext = {
    ...o.ctx,
    actor,
    authz: staticAuthorizer([{ permission: 'rates.quote.read', propertyIds: [o.propertyId] }]),
  };
  return withTenantTx(t.db, ctx, (tx) => fn(tx, o.rates));
}

const stay = { from: '2027-02-10', to: '2027-02-13' };
const find = (offers: Offer[], code: string, unitTypeId: string) =>
  offers.find((x) => x.ratePlanCode === code && x.unitTypeId === unitTypeId) as Offer;

describe('who is asking decides what they see (R-04)', () => {
  it('channels get their channel from the principal, quote today, never name a company or see unbookable offers', async () => {
    const { o, beach } = await resort();
    // A direct-only plan must never reach an OTA.
    await o.run(async (tx, r) => {
      const bar = (await r.listRatePlans(tx, { propertyId: o.propertyId })).find((p) => p.code === 'BAR');
      const direct = await r.createRatePlan(tx, {
        propertyId: o.propertyId,
        code: 'DIRECT-ONLY',
        name: 'Direct only',
        derivation: { parentRatePlanId: bar?.id as string, adjustment: { kind: 'percent', percent: '-5' } },
        eligibility: { channels: ['direct'] },
      });
      await r.changeRatePlanStatus(tx, direct.id, direct.version, { status: 'active' });
    });
    const ota = { kind: 'api_client' as const, clientId: newId(), displayName: 'OTA X' };
    const otaQuote = await asPrincipal(o, ota, (tx, r) =>
      r.quoteDetailed(tx, { propertyId: o.propertyId, nights: stay, occupancy: { adults: 2 } }),
    );
    expect(otaQuote.offers.length).toBeGreaterThan(0);
    expect(otaQuote.offers.every((x) => x.bookable)).toBe(true);
    expect(otaQuote.offers.some((x) => x.ratePlanCode === 'DIRECT-ONLY')).toBe(false);
    // Omitting channelId does not make an OTA "direct"; a festive stay with restrictions returns nothing.
    const festive = await asPrincipal(o, ota, (tx, r) =>
      r.quoteDetailed(tx, {
        propertyId: o.propertyId,
        nights: { from: '2026-12-22', to: '2026-12-25' },
        occupancy: { adults: 2 },
      }),
    );
    expect(festive.offers).toEqual([]);
    await expect(
      asPrincipal(o, ota, (tx, r) =>
        r.quoteDetailed(tx, {
          propertyId: o.propertyId,
          nights: stay,
          occupancy: { adults: 2 },
          channelId: 'direct',
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      asPrincipal(o, ota, (tx, r) =>
        r.quoteDetailed(tx, {
          propertyId: o.propertyId,
          nights: stay,
          occupancy: { adults: 2 },
          bookingDate: '2026-01-01',
        }),
      ),
    ).rejects.toThrow(/rates.quote.backdate/);
    await expect(
      asPrincipal(o, ota, (tx, r) =>
        r.quoteDetailed(tx, {
          propertyId: o.propertyId,
          nights: stay,
          occupancy: { adults: 2 },
          companyId: newId(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // The booking engine (guest actor) sells as channel 'booking_engine'.
    const guest = await asPrincipal(o, { kind: 'guest' }, (tx, r) =>
      r.quoteDetailed(tx, { propertyId: o.propertyId, nights: stay, occupancy: { adults: 2 } }),
    );
    expect(guest.offers.some((x) => x.ratePlanCode === 'DIRECT-ONLY')).toBe(false);
    // Staff see the direct-only plan.
    const staff = await o.run((tx, r) =>
      r.quoteDetailed(tx, { propertyId: o.propertyId, nights: stay, occupancy: { adults: 2 } }),
    );
    expect(find(staff.offers, 'DIRECT-ONLY', beach)).toBeDefined();
  });

  it('staff need rates.quote.backdate to quote as of another date', async () => {
    const { o } = await resort();
    await expect(
      o.as([{ permission: 'rates.quote.read', propertyIds: [o.propertyId] }], (tx, r) =>
        r.quoteDetailed(tx, {
          propertyId: o.propertyId,
          nights: stay,
          occupancy: { adults: 2 },
          bookingDate: '2026-01-01',
        }),
      ),
    ).rejects.toThrow(/rates.quote.backdate/);
    const ok = await o.as(
      [
        { permission: 'rates.quote.read', propertyIds: [o.propertyId] },
        { permission: 'rates.quote.backdate', propertyIds: [o.propertyId] },
      ],
      (tx, r) =>
        r.quoteDetailed(tx, {
          propertyId: o.propertyId,
          nights: stay,
          occupancy: { adults: 2 },
          bookingDate: '2026-01-01',
        }),
    );
    expect(ok.offers[0]?.terms.bookingDate).toBe('2026-01-01');
  });
});

describe('connected mode (R-11)', () => {
  it('refuses room quotes when an external system is the system of record for rates', async () => {
    const { o } = await resort();
    await o.run((tx) =>
      platform.setDataAuthority(tx, {
        propertyId: o.propertyId,
        domain: 'rates',
        authority: 'external',
        connectionId: newId(),
        systemName: 'Legacy PMS',
        writeMode: 'read_only',
        reason: 'connect alongside',
      }),
    );
    await expect(
      o.run((tx, r) =>
        r.quoteDetailed(tx, { propertyId: o.propertyId, nights: stay, occupancy: { adults: 2 } }),
      ),
    ).rejects.toMatchObject({ code: 'rates_managed_externally' });
    // The tax engine keeps working (tax rules are always Portico data).
    const taxes = await o.run((tx, r) =>
      r.computeTaxes(tx, {
        propertyId: o.propertyId,
        lines: [
          {
            lineId: 'x',
            chargeCode: 'SPA',
            taxCategory: 'spa',
            amount: { amountMinor: 10_000, currency: 'USD' },
            serviceDate: '2027-02-10',
          },
        ],
      }),
    );
    expect(taxes.map((x) => x.ruleCode)).toEqual(['MV-TGST']);
  });
});

describe('robust pricing (R-06, R-07, R-20, R-23)', () => {
  it('a tax-inclusive plan with a free night quotes fine; Green Tax is added on top and kept on the free night', async () => {
    const { o, beach, seeded } = await resort();
    await o.run(async (tx, r) => {
      const incl = await r.createRatePlan(tx, {
        propertyId: o.propertyId,
        code: 'BAR-INCL',
        name: 'BAR all taxes included',
        derivation: {
          parentRatePlanId: seeded.ratePlans.BAR as string,
          adjustment: { kind: 'percent', percent: '0' },
        },
        taxInclusion: { mode: 'inclusive' },
      });
      await r.changeRatePlanStatus(tx, incl.id, incl.version, { status: 'active' });
      await r.createPromotion(tx, {
        propertyId: o.propertyId,
        code: 'STAY4PAY3',
        name: 'Stay 4 pay 3',
        discount: { kind: 'free_nights', stayNights: 4, freeNights: 1, which: 'last' },
        conditions: { ratePlanIds: [incl.id] },
      });
    });
    const res = await o.run((tx, r) =>
      r.quoteDetailed(tx, {
        propertyId: o.propertyId,
        nights: { from: '2027-02-10', to: '2027-02-14' },
        occupancy: { adults: 2 },
      }),
    );
    const offer = find(res.offers, 'BAR-INCL', beach);
    expect(offer.bookable).toBe(true);
    const free = offer.nightly[3];
    expect(free?.amount.amountMinor).toBe(0);
    expect(
      free?.taxes.filter((x) => x.ruleCode === 'MV-GREEN-12').map((x) => [x.inclusive, x.amount.amountMinor]),
    ).toEqual([[false, 2_400]]);
    const paid = offer.nightly[0];
    // 900.00 includes SC + TGST; Green Tax on top.
    expect(
      (paid?.net.amountMinor ?? 0) +
        (paid?.taxes ?? []).filter((x) => x.inclusive).reduce((a, x) => a + x.amount.amountMinor, 0),
    ).toBe(90_000);
    expect(
      offer.totals.net.amountMinor + offer.totals.taxes.amountMinor + offer.totals.fees.amountMinor,
    ).toBe(offer.totals.gross.amountMinor);
  });

  it('bounds percentages and refuses negative derived prices with an explanation', async () => {
    expect(
      promotionInput.safeParse({
        propertyId: newId(),
        code: 'X',
        name: 'X',
        discount: { kind: 'percent', percent: '150' },
      }).success,
    ).toBe(false);
    const { o, beach, seeded } = await resort();
    await o.run(async (tx, r) => {
      const neg = await r.createRatePlan(tx, {
        propertyId: o.propertyId,
        code: 'NEG',
        name: 'Too cheap',
        derivation: {
          parentRatePlanId: seeded.ratePlans.BAR as string,
          adjustment: { kind: 'amount', amountMinor: -200_000 },
        },
      });
      await r.changeRatePlanStatus(tx, neg.id, neg.version, { status: 'active' });
      const combo = await r.createRatePlan(tx, {
        propertyId: o.propertyId,
        code: 'COMBO',
        name: 'BAR −10% + USD 30',
        derivation: {
          parentRatePlanId: seeded.ratePlans.BAR as string,
          adjustment: { kind: 'combined', percent: '-10', amountMinor: 3_000 },
          floorMinor: 50_000,
        },
      });
      await r.changeRatePlanStatus(tx, combo.id, combo.version, { status: 'active' });
    });
    const res = await o.run((tx, r) =>
      r.quoteDetailed(tx, { propertyId: o.propertyId, nights: stay, occupancy: { adults: 2 } }),
    );
    expect(find(res.offers, 'NEG', beach).restrictionViolations.map((v) => v.kind)).toContain(
      'derived_price_below_zero',
    );
    expect(find(res.offers, 'NEG', beach).bookable).toBe(false);
    expect(find(res.offers, 'COMBO', beach).nightly[0]?.amount.amountMinor).toBe(84_000); // 900 × 0.9 + 30
  });

  it('net (contracted) rates: the agency collects, the hotel invoices the net plus taxes, no commission', async () => {
    const { o, beach, seeded } = await resort();
    const agency = newId();
    await o.run(async (tx, r) => {
      const net = await r.createRatePlan(tx, {
        propertyId: o.propertyId,
        code: 'DMC-NET',
        name: 'DMC contracted net',
        derivation: {
          parentRatePlanId: seeded.ratePlans.BAR as string,
          adjustment: { kind: 'percent', percent: '-25' },
        },
        eligibility: { companyIds: [agency] },
        commission: { model: 'net' },
      });
      await r.changeRatePlanStatus(tx, net.id, net.version, { status: 'active' });
    });
    const res = await o.run((tx, r) =>
      r.quoteDetailed(tx, {
        propertyId: o.propertyId,
        nights: { from: '2027-03-01', to: '2027-03-08' },
        occupancy: { adults: 2 },
        companyId: agency,
      }),
    );
    const net = find(res.offers, 'DMC-NET', beach);
    expect(net.commission).toMatchObject({ model: 'net', agencyCollects: true, amount: { amountMinor: 0 } });
    expect(net.commission?.invoiceable).toEqual(net.totals.gross);
    // Promotions without an explicit plan list never discount a contracted net rate (STAY7PAY6 lists BAR/AI only).
    expect(net.nightly.every((n) => n.promotions.length === 0)).toBe(true);
  });
});

describe('price override, complimentary and house use (R-12)', () => {
  it('produces sealed terms that keep per-guest levies, needs rates.price.override and is audited', async () => {
    const { o, beach } = await resort();
    const offer = find(
      (
        await o.run((tx, r) =>
          r.quoteDetailed(tx, {
            propertyId: o.propertyId,
            nights: stay,
            occupancy: { adults: 2, childrenAges: [1] },
          }),
        )
      ).offers,
      'BAR',
      beach,
    );
    await expect(
      o.as([{ permission: 'rates.quote.read', propertyIds: [o.propertyId] }], (tx, r) =>
        r.complimentaryTerms(tx, {
          terms: offer.terms,
          kind: 'complimentary',
          reason: 'VIP guest of the owner',
        }),
      ),
    ).rejects.toThrow(/rates.price.override/);
    const comp = await o.run((tx, r) =>
      r.complimentaryTerms(tx, { terms: offer.terms, kind: 'house_use', reason: 'Owner stay' }),
    );
    expect(comp).toMatchObject({ priceSource: 'house_use', supersedesSeal: offer.terms.seal });
    expect(comp.totals.net.amountMinor).toBe(0);
    expect(comp.totals.taxes.amountMinor).toBe(3 * 2 * 1_200); // Green Tax for 2 adults; the 1-year-old is exempt
    expect(o.rates.verifyTerms(comp)).toBe(true);
    const manual = await o.run((tx, r) =>
      r.overridePrice(tx, {
        terms: offer.terms,
        override: { kind: 'nightly', nightsMinor: { '2027-02-11': 50_000 } },
        reason: 'Service recovery',
      }),
    );
    expect(manual.nights.map((n) => n.amount.amountMinor)).toEqual([90_000 + 0, 50_000, 90_000]);
    const forged = {
      ...offer.terms,
      totals: { ...offer.terms.totals, gross: { amountMinor: 1, currency: 'USD' } },
    };
    await expect(
      o.run((tx, r) =>
        r.overridePrice(tx, { terms: forged, override: { kind: 'complimentary' }, reason: 'forged' }),
      ),
    ).rejects.toThrow(/valid Portico seal/);
    await expect(
      asPrincipal(o, { kind: 'api_client', clientId: newId() }, (tx, r) =>
        r.overridePrice(tx, {
          terms: offer.terms,
          override: { kind: 'complimentary' },
          reason: 'channel attempt',
        }),
      ),
    ).rejects.toThrow(/rates.price.override/);
  });
});

describe('sales limits scoped to their restriction (R-13, R-14)', () => {
  it('a unit-type-specific limit is not consumed by another unit type; an all-plans limit counts every plan', async () => {
    const { o, beach, water, seeded } = await resort();
    const bar = seeded.ratePlans.BAR as string;
    const nr = seeded.ratePlans['BAR-NR'] as string;
    await o.run((tx, r) =>
      r.applyRestrictionUpdate(tx, {
        propertyId: o.propertyId,
        ratePlanId: bar,
        unitTypeIds: [water],
        ranges: [{ from: '2027-02-10', to: '2027-02-11' }],
        set: { salesLimit: 1 },
      }),
    );
    const sell = (planId: string, unitTypeId: string) =>
      o.run((tx, r) =>
        r.recordPlanSale(tx, {
          propertyId: o.propertyId,
          ratePlanId: planId,
          unitTypeId,
          nights: { from: '2027-02-10', to: '2027-02-11' },
          ref: { type: 'stay', id: newId() },
        }),
      );
    await sell(bar, beach);
    await sell(bar, beach); // beach villas are not limited
    await sell(bar, water);
    await expect(sell(bar, water)).rejects.toMatchObject({ code: 'sales_limit_reached' });
    // All-plans limit of 4 on the night: 3 sold on BAR so far → one more on any plan, then none.
    await o.run((tx, r) =>
      r.applyRestrictionUpdate(tx, {
        propertyId: o.propertyId,
        ratePlanId: null,
        unitTypeIds: [null],
        ranges: [{ from: '2027-02-10', to: '2027-02-11' }],
        set: { salesLimit: 4 },
      }),
    );
    await sell(nr, beach);
    await expect(sell(nr, beach)).rejects.toMatchObject({ code: 'sales_limit_reached' });
    const res = await o.run((tx, r) =>
      r.quoteDetailed(tx, {
        propertyId: o.propertyId,
        nights: { from: '2027-02-10', to: '2027-02-11' },
        occupancy: { adults: 2 },
      }),
    );
    const v = find(res.offers, 'BAR-NR', beach).restrictionViolations.find((x) => x.kind === 'sales_limit');
    expect(v).toMatchObject({ overridable: false, actual: 4 });
  });
});

describe('priceChange contract (R-03)', () => {
  it('changes the rate plan (all nights at current rates on the new plan, its policies) and returns new sealed terms', async () => {
    const { o, beach, seeded } = await resort();
    const offer = find(
      (
        await o.run((tx, r) =>
          r.quoteDetailed(tx, { propertyId: o.propertyId, nights: stay, occupancy: { adults: 2 } }),
        )
      ).offers,
      'BAR',
      beach,
    );
    const res = await o.run((tx, r) =>
      r.priceChange(tx, {
        terms: offer.terms,
        change: { ratePlanId: seeded.ratePlans['BAR-NR'], typeChange: 'keep_agreed' },
      }),
    );
    expect(res.nightly.map((n) => [n.source, n.after?.amountMinor])).toEqual([
      ['plan_changed', 81_000],
      ['plan_changed', 81_000],
      ['plan_changed', 81_000],
    ]);
    expect(res.terms).toMatchObject({ ratePlan: { code: 'BAR-NR' }, supersedesSeal: offer.terms.seal });
    expect(res.terms.policies.cancellation?.code).toBe('NONREF');
    expect(o.rates.verifyTerms(res.terms)).toBe(true);
    await expect(
      o.run((tx, r) =>
        r.priceChange(tx, { terms: offer.terms, change: { changeAt: '2026-12-01T00:00:00Z' } }),
      ),
    ).rejects.toThrow(/missing or invalid/);
    await expect(
      o.as([{ permission: 'rates.quote.read', propertyIds: [o.propertyId] }], (tx, r) =>
        r.priceChange(tx, { terms: offer.terms, change: { asOf: '2027-02-11' } }),
      ),
    ).rejects.toThrow(/rates.quote.backdate/);
    const asOf = await o.run((tx, r) =>
      r.priceChange(tx, {
        terms: offer.terms,
        change: { nights: { from: '2027-02-10', to: '2027-02-12' }, asOf: '2027-02-11' },
      }),
    );
    expect(asOf.penalties[0]).toMatchObject({ kind: 'early_departure', nights: ['2027-02-12'] });
  });
});

describe('rule pack status and tax-rule isolation', () => {
  it('reports whether every rule in force is adviser-confirmed (finance live gate)', async () => {
    const { o } = await resort();
    const status = await o.run((tx, r) => r.getRulePackStatus(tx, o.propertyId));
    expect(status.verified).toBe(false);
    expect(status.unverifiedRuleCodes.sort()).toEqual(['MV-GREEN-12', 'MV-GST-GENERAL', 'MV-SC', 'MV-TGST']);
    expect(status.rules.some((x) => x.code === 'MV-GREEN-6')).toBe(false);
    expect(status.rules.find((x) => x.code === 'MV-SC')?.nature).toBe('commercial');
    expect(status.note).toMatch(/Not confirmed by a qualified adviser/);
  });

  it('another organization cannot read or use tax rules by id', async () => {
    const { o } = await resort();
    const rule = (await o.run((tx, r) => r.listTaxRules(tx, { jurisdiction: 'MV' })))[0];
    const other = await newOrg(t);
    await expect(other.run((tx, r) => r.getTaxRule(tx, rule?.id as string))).rejects.toThrow(/not found/);
    expect(await other.run((tx, r) => r.listTaxRules(tx))).toEqual([]);
    await expect(
      other.run((tx, r) =>
        r.computeTaxes(tx, {
          propertyId: other.propertyId,
          lines: [
            {
              lineId: 'x',
              chargeCode: 'R',
              taxCategory: 'accommodation',
              amount: { amountMinor: 1, currency: 'USD' },
              serviceDate: '2027-01-01',
            },
          ],
          ruleVersionIds: [rule?.versions[0]?.id as string],
        }),
      ),
    ).rejects.toThrow(/do not exist/);
    expect(sum([{ amountMinor: 0 }])).toBe(0);
  });
});
