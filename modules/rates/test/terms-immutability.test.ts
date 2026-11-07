/**
 * Brief §5 ("a subsequent rate or tax configuration change must not silently rewrite historical agreements"),
 * spec RAT-I03/I04 and E08, readiness brief §19 ("tax or rate changes affecting future versus historical records").
 */
import { canonicalJson, newId } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Offer,
  postingChargeLines,
  postingPlan,
  seedResortRates,
  type TermsSnapshot,
  termsSnapshot,
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
      const v3 = withV3.versions.find((v) => v.status === 'draft')?.id as string;
      const report = await r.previewTaxRuleActivation(tx, v3);
      expect(report.closes[0]).toMatchObject({ effectiveToBefore: null, effectiveToAfter: '2027-02-12' });
      await r.activateTaxRuleVersion(tx, v3, {
        reason: 'test: tax change mid-stay',
        acknowledgeReport: true,
      });
      // The hotel raises its service charge to 12% from 2027-02-01 (a commercial, hotel-set rule).
      const scRule = (await r.listTaxRules(tx, { jurisdiction: 'MV' })).find((x) => x.code === 'MV-SC');
      const withSc12 = await r.addTaxRuleVersion(tx, scRule?.id as string, {
        effectiveFrom: '2027-02-01',
        definition: {
          kind: 'percentage',
          ratePercent: '12',
          appliesTo: { taxCategories: ['accommodation', 'food_beverage'] },
        },
        sources: [
          { url: 'https://example.com/hotel-service-charge-notice', title: 'Hotel notice (test only)' },
        ],
      });
      const sc12 = withSc12.versions.find((v) => v.status === 'draft')?.id as string;
      const scReport = await r.previewTaxRuleActivation(tx, sc12);
      expect(scReport.impact[0]).toMatch(/agreed stays keep the version recorded in their terms/);
      await r.activateTaxRuleVersion(tx, sc12, {
        reason: 'test: service charge change',
        acknowledgeReport: true,
      });
    });

    // ── The agreement is unchanged and still verifies ──
    const reloaded: TermsSnapshot = termsSnapshot.parse(JSON.parse(persisted));
    expect(o.rates.verifyTerms(JSON.parse(persisted))).toBe(true);
    expect(reloaded.seal).toBe(offer.terms.seal);
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
    // The posting lines carry the agreement's commercial rule versions (service charge stays as agreed).
    const lines = postingChargeLines(reloaded, stayId);
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
    // (c) A stay paid in full at booking fixed its time of supply: nothing is re-taxed.
    const prepaid = await o.run((tx, r) =>
      r.computeTaxesDetailed(tx, {
        propertyId: o.propertyId,
        lines,
        stayContext,
        fullPaymentDate: '2026-11-07',
      }),
    );
    expect(
      prepaid.lines
        .flatMap((l) => l.taxes)
        .filter((x) => x.ruleCode === 'MV-TGST')
        .every((x) => x.ratePercent === '17'),
    ).toBe(true);
    // (d) A 30% deposit paid at booking fixes TGST for that part only; Green Tax is charged once (R-08).
    const room12 = lines.find((l) => l.lineId.startsWith('room:') && l.serviceDate === '2027-02-12');
    if (!room12) throw new Error('room line');
    const deposit = Math.round(room12.amount.amountMinor * 0.3);
    const split = await o.run((tx, r) =>
      r.computeTaxesDetailed(tx, {
        propertyId: o.propertyId,
        lines: [{ ...room12, taxPointSplits: [{ amountMinor: deposit, taxPointDate: '2026-11-07' }] }],
        stayContext,
      }),
    );
    const splitTaxes = split.lines[0]?.taxes ?? [];
    expect(splitTaxes.filter((x) => x.ruleCode === 'MV-TGST').map((x) => x.ratePercent)).toEqual([
      '17',
      '18',
    ]);
    expect(splitTaxes.filter((x) => x.ruleCode === 'MV-GREEN-12')).toHaveLength(1);
    expect(split.lines[0]?.net.amountMinor).toBe(room12.amount.amountMinor);

    // (e) R-01: the hotel raised its service charge to 12% after booking. Agreed nights keep 10%; a charge
    //     outside the agreement (minibar on the same day) gets 12%.
    const sc = atPosting.lines.flatMap((l) => l.taxes).filter((x) => x.ruleCode === 'MV-SC');
    expect(sc.length).toBeGreaterThan(0);
    expect(sc.every((x) => x.ratePercent === '10' && x.nature === 'commercial')).toBe(true);
    const agreedGross = reloaded.nights.reduce((a, n) => a + n.gross.amountMinor, 0);
    const pinnedTgst = (date: string) =>
      pinned.lines.filter((l) => l.lineId.includes(date)).reduce((a, l) => a + l.gross.amountMinor, 0);
    expect(['2027-02-10', '2027-02-11'].map(pinnedTgst)).toEqual(
      ['2027-02-10', '2027-02-11'].map((d) =>
        atPosting.lines.filter((l) => l.lineId.includes(d)).reduce((a, l) => a + l.gross.amountMinor, 0),
      ),
    );
    expect(agreedGross).toBe(reloaded.totals.gross.amountMinor);
    const minibar = await o.run((tx, r) =>
      r.computeTaxes(tx, {
        propertyId: o.propertyId,
        lines: [
          {
            lineId: 'minibar-1',
            chargeCode: 'FB_MINIBAR',
            taxCategory: 'food_beverage',
            amount: { amountMinor: 5_000, currency: 'USD' },
            serviceDate: '2027-02-12',
          },
        ],
      }),
    );
    expect(minibar.find((x) => x.ruleCode === 'MV-SC')?.ratePercent).toBe('12');

    // ── A change preview on the old agreement keeps agreed nights at agreed prices ──
    const preview = await o.run((tx, r) => r.priceChange(tx, { terms: reloaded, change: {} }));
    expect(preview.nightly.every((n) => n.source === 'agreed' && n.difference.amountMinor === 0)).toBe(true);
    expect(preview.after.net.amountMinor).toBe(reloaded.totals.net.amountMinor);

    // ── Pausing the plan the stay was booked on changes nothing agreed (PAR-RAT-022) ──
    await o.run(async (tx, r) => {
      const ai = await r.getRatePlan(tx, seeded.ratePlans.AI as string);
      await r.changeRatePlanStatus(tx, ai.id, ai.version, { status: 'paused', reason: 'test: pause' });
    });
    expect(o.rates.verifyTerms(JSON.parse(persisted))).toBe(true);
    const shortened = await o.run((tx, r) =>
      r.priceChange(tx, { terms: reloaded, change: { nights: { from: '2027-02-10', to: '2027-02-13' } } }),
    );
    const kept = shortened.nightly.filter((n) => n.source === 'agreed');
    expect(kept).toHaveLength(3);
    expect(kept.every((n) => n.difference.amountMinor === 0)).toBe(true);
  });
});
