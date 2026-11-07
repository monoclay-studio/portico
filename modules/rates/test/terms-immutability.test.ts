/**
 * Brief §5 ("a subsequent rate or tax configuration change must not silently rewrite historical agreements"),
 * spec RAT-I03/I04 and E08, readiness brief §19 ("tax or rate changes affecting future versus historical records").
 */
import { canonicalJson, newId } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Offer,
  postingPlan,
  seedResortRates,
  type TermsSnapshot,
  termsSnapshot,
  verifyTerms,
} from '../src';
import { newOrg, startDb, sum, unitTypes } from './harness';

let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

describe('agreed terms survive every later configuration change (E08)', () => {
  it('rate, restriction, policy, promotion, inclusion and tax changes after booking leave the agreement and its postings unchanged', async () => {
    const o = await newOrg(t);
    const uts = unitTypes();
    const beach = uts[0]?.id as string;
    const seeded = await o.run(async (tx, r) => {
      await r.installTaxTemplate(tx, { template: 'MV' });
      return seedResortRates(r, tx, {
        propertyId: o.propertyId,
        unitTypes: uts,
        from: '2026-11-07',
        days: 400,
      });
    });
    const quote = await o.run((tx, r) =>
      r.quoteDetailed(tx, {
        propertyId: o.propertyId,
        nights: { from: '2027-02-10', to: '2027-02-14' },
        occupancy: { adults: 2, childrenAges: [] },
        promoCode: 'HONEYMOON',
        bookingDate: '2026-11-07',
        ratePlanIds: [seeded.ratePlans.AI as string],
        unitTypeIds: [beach],
      }),
    );
    const offer = quote.offers[0] as Offer;
    expect(offer.bookable).toBe(true);
    // Reservations persists the snapshot as JSON (jsonb); simulate that boundary.
    const persisted = JSON.stringify(offer.terms);
    const stayId = newId();
    const postingsBefore = postingPlan(offer.terms, stayId);

    // ── Change everything an agreement depends on ──
    await o.run(async (tx, r) => {
      const plans = await r.listRatePlans(tx, { propertyId: o.propertyId });
      const bar = plans.find((p) => p.code === 'BAR');
      const ai = plans.find((p) => p.code === 'AI');
      await r.applyPriceUpdate(tx, {
        propertyId: o.propertyId,
        ratePlanId: bar?.id as string,
        unitTypeIds: [beach],
        ranges: [{ from: '2027-02-01', to: '2027-03-01' }],
        adjust: { kind: 'percent', percent: '50' },
        reason: 'post-booking rate rise',
      });
      await r.updateRatePlan(tx, ai?.id as string, ai?.version as number, {
        derivation: {
          parentRatePlanId: bar?.id as string,
          adjustment: { kind: 'amount', amountMinor: 200_000 },
        },
      });
      await r.applyRestrictionUpdate(tx, {
        propertyId: o.propertyId,
        ratePlanId: null,
        unitTypeIds: [null],
        ranges: [{ from: '2027-02-10', to: '2027-02-14' }],
        set: { closed: true },
      });
      const policies = await r.listPolicies(tx, o.propertyId);
      const flex = policies.find((p) => p.code === 'FLEX21');
      await r.updatePolicy(tx, flex?.id as string, flex?.version as number, {
        structure: {
          tiers: [{ from: { kind: 'at_booking' }, penalty: { kind: 'percent_of_stay', percent: '100' } }],
        },
      });
      const promos = await r.listPromotions(tx, o.propertyId);
      const honey = promos.find((p) => p.code === 'HONEYMOON');
      await r.updatePromotion(tx, honey?.id as string, honey?.version as number, { status: 'paused' });
      const incs = await r.listInclusions(tx, o.propertyId);
      const board = incs.find((i) => i.code === 'AI_BOARD');
      await r.updateInclusion(tx, board?.id as string, board?.version as number, {
        pricing: { kind: 'fixed', amountMinor: 25_000 },
      });
      // TGST rises to 18% from 2027-02-12 — in the middle of the agreed stay.
      const tgst = (await r.listTaxRules(tx, { jurisdiction: 'MV' })).find((x) => x.code === 'MV-TGST');
      const withV3 = await r.addTaxRuleVersion(tx, tgst?.id as string, {
        effectiveFrom: '2027-02-12',
        definition: {
          kind: 'percentage',
          ratePercent: '18',
          base: { includeNet: true, includeRuleCodes: ['MV-SC'] },
          appliesTo: {
            taxCategories: [
              'accommodation',
              'food_beverage',
              'transfer',
              'spa',
              'activity',
              'retail',
              'other_service',
            ],
            excludeOutletKinds: ['general_sector'],
          },
        },
        sources: [
          {
            url: 'https://example.gov/hypothetical-tgst-change',
            title: 'Hypothetical rate change (test only)',
          },
        ],
      });
      const v3 = withV3.versions.find((v) => v.versionNo === 3)?.id as string;
      const report = await r.previewTaxRuleActivation(tx, v3);
      expect(report.closes[0]).toMatchObject({ effectiveToBefore: null, effectiveToAfter: '2027-02-12' });
      await r.activateTaxRuleVersion(tx, v3, {
        reason: 'test: tax change mid-stay',
        acknowledgeReport: true,
      });
    });

    // ── The agreement is unchanged and still verifies ──
    const reloaded: TermsSnapshot = termsSnapshot.parse(JSON.parse(persisted));
    expect(verifyTerms(reloaded)).toBe(true);
    expect(reloaded.hash).toBe(offer.terms.hash);
    expect(canonicalJson(reloaded)).toBe(canonicalJson(JSON.parse(persisted)));
    // Posting every night needs only the snapshot: identical charges after all the changes.
    expect(postingPlan(reloaded, stayId)).toEqual(postingsBefore);
    expect(sum(postingsBefore.map((p) => p.amount))).toBe(offer.totals.net.amountMinor);
    expect(reloaded.policies.cancellation?.code).toBe('FLEX21');
    expect(reloaded.policies.cancellation?.structure.tiers).toHaveLength(2);
    expect(reloaded.nights[0]?.promotions[0]?.code).toBe('HONEYMOON');

    // A new quote for the same stay reflects the new configuration (closed nights, new prices).
    const fresh = await o.run((tx, r) =>
      r.quoteDetailed(tx, {
        propertyId: o.propertyId,
        nights: { from: '2027-02-10', to: '2027-02-14' },
        occupancy: { adults: 2, childrenAges: [] },
        promoCode: 'HONEYMOON',
        bookingDate: '2026-11-08',
        ratePlanIds: [seeded.ratePlans.AI as string],
        unitTypeIds: [beach],
      }),
    );
    expect(fresh.offers[0]?.bookable).toBe(false);
    expect(fresh.offers[0]?.restrictionViolations.map((v) => v.kind)).toContain('closed');
    expect(fresh.offers[0]?.nightly[0]?.amount.amountMinor).not.toBe(reloaded.nights[0]?.amount.amountMinor);

    // ── Taxes: historical vs future records ──
    const lines = postingsBefore.map((p) => ({
      lineId: p.idempotencyKey,
      chargeCode: p.chargeCode,
      taxCategory: p.taxCategory,
      amount: p.amount,
      quantity: p.quantity,
      serviceDate: p.serviceDate,
      taxInclusion: p.taxInclusion,
      occupancy: { adults: p.occupancy.adults, childrenAges: [...p.occupancy.childrenAges] },
      nightIndex: p.nightIndex,
    }));
    const stayContext = {
      stayNights: reloaded.stay.nights,
      arrival: reloaded.stay.arrival,
      bookingDate: reloaded.bookingDate,
    };
    // (a) Historical: recomputing with the rule versions recorded at quote time reproduces the quoted taxes exactly.
    const pinned = await o.run((tx, r) =>
      r.computeTaxesDetailed(tx, {
        propertyId: o.propertyId,
        lines,
        stayContext,
        ruleVersionIds: reloaded.taxes.ruleVersionIds,
      }),
    );
    const quotedTaxTotal = reloaded.totals.taxes.amountMinor + reloaded.totals.fees.amountMinor;
    expect(pinned.totals.taxes.amountMinor + pinned.totals.fees.amountMinor).toBe(quotedTaxTotal);
    // (b) Future postings follow each rule's tax point: supplies on/after 2027-02-12 use the new 18% version,
    //     earlier nights keep 17%; agreed PRICES are unchanged either way (exclusive plan: the tax line changes).
    const atPosting = await o.run((tx, r) =>
      r.computeTaxesDetailed(tx, { propertyId: o.propertyId, lines, stayContext }),
    );
    const tgstRate = (date: string) =>
      atPosting.lines
        .filter((l) => l.lineId.includes(date))
        .flatMap((l) => l.taxes)
        .find((x) => x.ruleCode === 'MV-TGST')?.ratePercent;
    expect(tgstRate('2027-02-11')).toBe('17');
    expect(tgstRate('2027-02-12')).toBe('18');
    expect(atPosting.totals.net.amountMinor).toBe(reloaded.totals.net.amountMinor);
    expect(atPosting.totals.taxes.amountMinor).toBeGreaterThan(pinned.totals.taxes.amountMinor);
    // (c) An amount whose time of supply was fixed by an earlier payment (deposit at booking) is not re-taxed.
    const prepaid = await o.run((tx, r) =>
      r.computeTaxesDetailed(tx, { propertyId: o.propertyId, lines, stayContext, paymentDate: '2026-11-07' }),
    );
    expect(
      prepaid.lines
        .flatMap((l) => l.taxes)
        .filter((x) => x.ruleCode === 'MV-TGST')
        .every((x) => x.ratePercent === '17'),
    ).toBe(true);

    // ── A change preview on the old agreement keeps agreed nights at agreed prices ──
    const preview = await o.run((tx, r) => r.priceChange(tx, { terms: reloaded, change: {} }));
    expect(preview.nights.every((n) => n.source === 'agreed' && n.difference.amountMinor === 0)).toBe(true);
    expect(preview.after.net.amountMinor).toBe(reloaded.totals.net.amountMinor);
  });
});
