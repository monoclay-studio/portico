/**
 * Realistic Maldives demo rates (demo / training environments and tests). All amounts are SAMPLE DATA for a
 * fictitious guesthouse and resort, never product configuration. Tax rules come from the MV template pack.
 */
import type { TxContext } from '@portico/db';
import { addDays, BusinessRuleError, type LocalDate } from '@portico/kernel';
import type { RatesPorts, RatesUnitType } from './ports';
import type { RatesService } from './service';

const usd = (major: number) => Math.round(major * 100);

export interface SeededRates {
  propertyId: string;
  ratePlans: Record<string, string>;
  inclusions: Record<string, string>;
  packages: Record<string, string>;
  policies: Record<string, string>;
  promotions: Record<string, string>;
}

async function activate(rates: RatesService, tx: TxContext, id: string) {
  const p = await rates.getRatePlan(tx, id);
  await rates.changeRatePlanStatus(tx, id, p.version, { status: 'active', reason: 'demo seed' });
}

/** Guesthouse: B&B (base) and half board (derived +USD 30), flexible 7-day policy, two seasons. */
export async function seedGuesthouseRates(
  rates: RatesService,
  tx: TxContext,
  input: { propertyId: string; unitTypes: readonly RatesUnitType[]; from: LocalDate; days?: number },
): Promise<SeededRates> {
  const { propertyId } = input;
  const to = addDays(input.from, input.days ?? 365);
  const flex = await rates.createPolicy(tx, {
    kind: 'cancellation',
    propertyId,
    code: 'FLEX7',
    name: 'Flexible — free until 7 days before arrival',
    structure: { tiers: [{ from: { kind: 'days_before_arrival', days: 7 }, penalty: { kind: 'first_night' } }], noShow: { kind: 'first_night' } },
  });
  const card = await rates.createPolicy(tx, { kind: 'guarantee', propertyId, code: 'CARD', name: 'Card guarantee', structure: { accepted: ['card'], holdUntil: '18:00' } });
  const breakfast = await rates.createInclusion(tx, {
    propertyId,
    code: 'BRKF',
    name: 'Breakfast',
    kind: 'component',
    chargeCode: 'FB_BREAKFAST',
    taxCategory: 'food_beverage',
    pricing: { kind: 'fixed', amountMinor: usd(8), childBandAmountsMinor: { infant: 0, child: usd(4), teen: usd(8) } },
    basis: 'per_person',
    rhythm: { kind: 'nightly' },
    priceMode: 'included',
    fulfilmentOutlets: ['guesthouse-cafe'],
  });
  const dinner = await rates.createInclusion(tx, {
    propertyId,
    code: 'DINNER',
    name: 'Dinner',
    kind: 'component',
    chargeCode: 'FB_DINNER',
    taxCategory: 'food_beverage',
    pricing: { kind: 'fixed', amountMinor: usd(15) },
    basis: 'per_adult',
    rhythm: { kind: 'nightly' },
    priceMode: 'included',
    fulfilmentOutlets: ['guesthouse-cafe'],
  });
  const bb = await rates.createPackage(tx, { propertyId, code: 'BB', name: 'Bed & breakfast', mealPlanCode: 'BB', inclusionIds: [breakfast.id] });
  const hb = await rates.createPackage(tx, { propertyId, code: 'HB', name: 'Half board', mealPlanCode: 'HB', inclusionIds: [breakfast.id, dinner.id] });
  const bbPlan = await rates.createRatePlan(tx, {
    propertyId,
    code: 'BB',
    name: 'Bed & breakfast',
    mealPlan: 'BB',
    packageIds: [bb.id],
    cancellationPolicyId: flex.id,
    guaranteePolicyId: card.id,
    marketSegment: 'leisure',
  });
  const hbPlan = await rates.createRatePlan(tx, {
    propertyId,
    code: 'HB',
    name: 'Half board',
    mealPlan: 'HB',
    derivation: { parentRatePlanId: bbPlan.id, adjustment: { kind: 'amount', amountMinor: usd(30) }, rounding: { incrementMinor: 100, mode: 'half_up' } },
    inherit: { packages: false },
    packageIds: [hb.id],
    marketSegment: 'leisure',
  });
  for (const [i, ut] of input.unitTypes.entries()) {
    const low = 65 + i * 20;
    const set = (base: number) => ({
      baseOccupancy: 2,
      baseAmountMinor: usd(base),
      singleAmountMinor: usd(base - 10),
      extraAdultMinor: usd(20),
      childAmountsMinor: { infant: 0, child: usd(10), teen: usd(15) },
    });
    await rates.applyPriceUpdate(tx, { propertyId, ratePlanId: bbPlan.id, unitTypeIds: [ut.id], ranges: [{ from: input.from, to }], set: set(low), reason: 'demo: low season' });
    // High season: December to mid-April (sample).
    const highRanges = seasonRanges(input.from, to, [
      ['12-01', '04-15'],
    ]);
    if (highRanges.length > 0)
      await rates.applyPriceUpdate(tx, { propertyId, ratePlanId: bbPlan.id, unitTypeIds: [ut.id], ranges: highRanges, set: set(low + 25), reason: 'demo: high season' });
  }
  await activate(rates, tx, bbPlan.id);
  await activate(rates, tx, hbPlan.id);
  return {
    propertyId,
    ratePlans: { BB: bbPlan.id, HB: hbPlan.id },
    inclusions: { BRKF: breakfast.id, DINNER: dinner.id },
    packages: { BB: bb.id, HB: hb.id },
    policies: { FLEX7: flex.id, CARD: card.id },
    promotions: {},
  };
}

/**
 * Resort: seasonal BAR (B&B), derived non-refundable −10%, all-inclusive package (dining allowance + seaplane
 * transfers) derived from BAR, honeymoon promotion (promo code) and a stay-7-pay-6 promotion.
 */
export async function seedResortRates(
  rates: RatesService,
  tx: TxContext,
  input: { propertyId: string; unitTypes: readonly RatesUnitType[]; from: LocalDate; days?: number },
): Promise<SeededRates> {
  const { propertyId } = input;
  const to = addDays(input.from, input.days ?? 365);
  const flex = await rates.createPolicy(tx, {
    kind: 'cancellation',
    propertyId,
    code: 'FLEX21',
    name: 'Flexible — free until 21 days before arrival',
    structure: {
      tiers: [
        { from: { kind: 'days_before_arrival', days: 21 }, penalty: { kind: 'nights', nights: 3 } },
        { from: { kind: 'days_before_arrival', days: 7 }, penalty: { kind: 'percent_of_stay', percent: '100' } },
      ],
      noShow: { kind: 'percent_of_stay', percent: '100' },
      earlyDeparture: { kind: 'percent_of_stay', percent: '100' },
    },
  });
  const nonRef = await rates.createPolicy(tx, {
    kind: 'cancellation',
    propertyId,
    code: 'NONREF',
    name: 'Non-refundable',
    structure: { tiers: [{ from: { kind: 'at_booking' }, penalty: { kind: 'percent_of_stay', percent: '100' } }], noShow: { kind: 'percent_of_stay', percent: '100' } },
  });
  const guarantee = await rates.createPolicy(tx, { kind: 'guarantee', propertyId, code: 'CARD-DEP', name: 'Card or deposit', structure: { accepted: ['card', 'deposit', 'agency'] } });
  const deposit = await rates.createPolicy(tx, {
    kind: 'deposit',
    propertyId,
    code: 'DEP30',
    name: '30% at booking, balance 30 days before arrival',
    structure: {
      items: [
        { kind: 'deposit', amount: { basis: 'percent', percent: '30' }, due: { anchor: 'booking', offsetDays: 0 }, method: 'payment_request' },
        { kind: 'balance', amount: { basis: 'remaining' }, due: { anchor: 'arrival', offsetDays: -30 }, method: 'payment_request', onOverdue: { action: 'task' } },
      ],
    },
  });
  const prepaid = await rates.createPolicy(tx, {
    kind: 'deposit',
    propertyId,
    code: 'PREPAID',
    name: 'Full prepayment at booking',
    structure: { items: [{ kind: 'deposit', amount: { basis: 'remaining' }, due: { anchor: 'booking', offsetDays: 0 }, method: 'payment_request' }] },
  });
  const inc = async (body: Record<string, unknown>) => rates.createInclusion(tx, { propertyId, fulfilmentOutlets: [], ...body });
  const breakfast = await inc({
    code: 'BRKF',
    name: 'Breakfast',
    kind: 'component',
    chargeCode: 'FB_BREAKFAST',
    taxCategory: 'food_beverage',
    pricing: { kind: 'fixed', amountMinor: usd(35), childBandAmountsMinor: { infant: 0, child: usd(18), teen: usd(35) } },
    basis: 'per_person',
    rhythm: { kind: 'nightly' },
    priceMode: 'included',
    fulfilmentOutlets: ['reef-restaurant'],
  });
  const aiBoard = await inc({
    code: 'AI_BOARD',
    name: 'All-inclusive meals and house beverages',
    kind: 'component',
    chargeCode: 'FB_ALLINCLUSIVE',
    taxCategory: 'food_beverage',
    pricing: { kind: 'fixed', amountMinor: usd(160) },
    basis: 'per_adult',
    rhythm: { kind: 'nightly' },
    priceMode: 'included',
    fulfilmentOutlets: ['reef-restaurant', 'sunset-bar'],
  });
  const dining = await inc({
    code: 'DINE_CREDIT',
    name: 'Dining credit (à la carte / premium)',
    kind: 'allowance',
    chargeCode: 'ALLOWANCE_DINING',
    taxCategory: 'food_beverage',
    pricing: { kind: 'fixed', amountMinor: usd(50) },
    basis: 'per_adult',
    rhythm: { kind: 'nightly' },
    priceMode: 'included',
    fulfilmentOutlets: ['teppanyaki', 'overwater-grill'],
    allowance: {
      kind: 'monetary',
      amountMinor: usd(50),
      period: 'per_night',
      perPerson: true,
      eligibleChargeCodes: ['FB_ALACARTE', 'FB_WINE'],
      eligibleOutlets: ['teppanyaki', 'overwater-grill'],
      excludedChargeCodes: ['FB_PREMIUM_WINE'],
      remainderPolicy: 'forfeit',
      breakageChargeCode: 'ALLOWANCE_BREAKAGE',
    },
  });
  const seaplaneIn = await inc({
    code: 'SEAPLANE_IN',
    name: 'Seaplane transfer (arrival)',
    kind: 'component',
    chargeCode: 'TRANSFER_SEAPLANE',
    taxCategory: 'transfer',
    pricing: { kind: 'fixed', amountMinor: usd(375) },
    basis: 'per_person',
    rhythm: { kind: 'arrival' },
    priceMode: 'included',
    fulfilmentOutlets: ['transfer-desk'],
  });
  const seaplaneOut = await inc({
    code: 'SEAPLANE_OUT',
    name: 'Seaplane transfer (departure)',
    kind: 'component',
    chargeCode: 'TRANSFER_SEAPLANE',
    taxCategory: 'transfer',
    pricing: { kind: 'fixed', amountMinor: usd(375) },
    basis: 'per_person',
    rhythm: { kind: 'departure' },
    priceMode: 'included',
    fulfilmentOutlets: ['transfer-desk'],
  });
  const sunset = await inc({
    code: 'SUNSET_CRUISE',
    name: 'Sunset dolphin cruise for two',
    kind: 'component',
    chargeCode: 'ACTIVITY_EXCURSION',
    taxCategory: 'activity',
    pricing: { kind: 'fixed', amountMinor: usd(180) },
    basis: 'per_stay',
    rhythm: { kind: 'days_of_stay', nights: [2] },
    priceMode: 'added',
    fulfilmentOutlets: ['dive-centre'],
  });
  const bbPkg = await rates.createPackage(tx, { propertyId, code: 'BB', name: 'Bed & breakfast', mealPlanCode: 'BB', inclusionIds: [breakfast.id] });
  const aiPkg = await rates.createPackage(tx, {
    propertyId,
    code: 'AI',
    name: 'All inclusive with dining credit and seaplane transfers',
    mealPlanCode: 'AI',
    inclusionIds: [aiBoard.id, dining.id, seaplaneIn.id, seaplaneOut.id],
  });
  const honeyPkg = await rates.createPackage(tx, { propertyId, code: 'HONEYMOON', name: 'Honeymoon extras', inclusionIds: [sunset.id] });
  const bar = await rates.createRatePlan(tx, {
    propertyId,
    code: 'BAR',
    name: 'Best available rate — bed & breakfast',
    mealPlan: 'BB',
    packageIds: [bbPkg.id],
    cancellationPolicyId: flex.id,
    guaranteePolicyId: guarantee.id,
    depositPolicyId: deposit.id,
    marketSegment: 'leisure',
  });
  const nr = await rates.createRatePlan(tx, {
    propertyId,
    code: 'BAR-NR',
    name: 'Non-refundable — bed & breakfast (−10%)',
    mealPlan: 'BB',
    derivation: { parentRatePlanId: bar.id, adjustment: { kind: 'percent', percent: '-10' }, rounding: { incrementMinor: 100, mode: 'half_up' } },
    inherit: { cancellationPolicy: false, depositPolicy: false },
    cancellationPolicyId: nonRef.id,
    depositPolicyId: prepaid.id,
    marketSegment: 'leisure',
  });
  const ai = await rates.createRatePlan(tx, {
    propertyId,
    code: 'AI',
    name: 'All inclusive — dining credit and seaplane transfers',
    mealPlan: 'AI',
    derivation: {
      parentRatePlanId: bar.id,
      adjustment: { kind: 'amount', amountMinor: usd(1150) },
      rounding: { incrementMinor: 100, mode: 'half_up' },
    },
    inherit: { packages: false },
    packageIds: [aiPkg.id],
    marketSegment: 'leisure',
  });
  // Seasonal BAR (sample prices, USD per villa per night for 2 adults).
  const seasons: Array<{ name: string; ranges: Array<[string, string]>; base: number[] }> = [
    { name: 'low', ranges: [['01-01', '12-31']], base: [650, 950] },
    { name: 'high', ranges: [['11-01', '04-30']], base: [900, 1300] },
    { name: 'peak', ranges: [['12-20', '01-10']], base: [1400, 1900] },
  ];
  for (const season of seasons) {
    const ranges = season.name === 'low' ? [{ from: input.from, to }] : seasonRanges(input.from, to, season.ranges.map(([a, b]) => [a, b]));
    if (ranges.length === 0) continue;
    for (const [i, ut] of input.unitTypes.entries()) {
      const base = season.base[Math.min(i, season.base.length - 1)] as number;
      await rates.applyPriceUpdate(tx, {
        propertyId,
        ratePlanId: bar.id,
        unitTypeIds: [ut.id],
        ranges,
        set: {
          baseOccupancy: 2,
          baseAmountMinor: usd(base),
          singleAmountMinor: usd(base * 0.9),
          extraAdultMinor: usd(250),
          childAmountsMinor: { infant: 0, child: usd(120), teen: usd(200) },
        },
        reason: `demo: ${season.name} season`,
      });
    }
    if (season.name === 'peak') {
      await rates.applyRestrictionUpdate(tx, { propertyId, ratePlanId: null, unitTypeIds: [null], ranges, set: { minLos: 5 }, reason: 'demo: festive minimum stay' });
    }
  }
  const honeymoon = await rates.createPromotion(tx, {
    propertyId,
    code: 'HONEYMOON',
    name: 'Honeymoon — 15% off, 4+ nights',
    discount: { kind: 'percent', percent: '15' },
    conditions: { promoCode: 'HONEYMOON', minNights: 4, ratePlanIds: [bar.id, ai.id] },
    combinability: 'exclusive',
  });
  const stay7 = await rates.createPromotion(tx, {
    propertyId,
    code: 'STAY7PAY6',
    name: 'Stay 7, pay 6',
    discount: { kind: 'free_nights', stayNights: 7, freeNights: 1, which: 'cheapest' },
    conditions: { minNights: 7, ratePlanIds: [bar.id, ai.id] },
    combinability: 'exclusive',
  });
  // Honeymoon extras are sold on a dedicated plan derived from AI (same price, sunset cruise added).
  const honeyPlan = await rates.createRatePlan(tx, {
    propertyId,
    code: 'AI-HONEY',
    name: 'All inclusive honeymoon (sunset cruise)',
    mealPlan: 'AI',
    derivation: { parentRatePlanId: ai.id, adjustment: { kind: 'amount', amountMinor: 0 }, rounding: { incrementMinor: 100, mode: 'half_up' } },
    packageIds: [honeyPkg.id],
    eligibility: { minAdults: 2, maxAdults: 2, maxChildren: 0 },
    marketSegment: 'leisure',
  });
  for (const id of [bar.id, nr.id, ai.id, honeyPlan.id]) await activate(rates, tx, id);
  return {
    propertyId,
    ratePlans: { BAR: bar.id, 'BAR-NR': nr.id, AI: ai.id, 'AI-HONEY': honeyPlan.id },
    inclusions: {
      BRKF: breakfast.id,
      AI_BOARD: aiBoard.id,
      DINE_CREDIT: dining.id,
      SEAPLANE_IN: seaplaneIn.id,
      SEAPLANE_OUT: seaplaneOut.id,
      SUNSET_CRUISE: sunset.id,
    },
    packages: { BB: bbPkg.id, AI: aiPkg.id, HONEYMOON: honeyPkg.id },
    policies: { FLEX21: flex.id, NONREF: nonRef.id, 'CARD-DEP': guarantee.id, DEP30: deposit.id, PREPAID: prepaid.id },
    promotions: { HONEYMOON: honeymoon.id, STAY7PAY6: stay7.id },
  };
}

/** Recurring month-day windows ('MM-DD' inclusive, may wrap the year) clipped to [from, to). */
export function seasonRanges(from: LocalDate, to: LocalDate, windows: ReadonlyArray<readonly [string, string]>) {
  const out: Array<{ from: LocalDate; to: LocalDate }> = [];
  const startYear = Number(from.slice(0, 4)) - 1;
  const endYear = Number(to.slice(0, 4));
  for (let y = startYear; y <= endYear; y++) {
    for (const [a, b] of windows) {
      const start = `${y}-${a}`;
      const end = addDays(b < a ? `${y + 1}-${b}` : `${y}-${b}`, 1);
      const s = start < from ? from : start;
      const e = end > to ? to : end;
      if (s < e) out.push({ from: s, to: e });
    }
  }
  return out;
}

/**
 * DemoSeedStep-compatible function for apps/api/src/seed/demo.ts: installs the MV tax pack and seeds each
 * property by profile. Needs the inventory port (`listUnitTypes`) to find the property's unit types.
 */
export function createRatesDemoSeed(rates: RatesService, ports: RatesPorts) {
  return async (tx: TxContext, org: { properties: ReadonlyArray<{ id: string; profile: string }> }): Promise<void> => {
    if (!ports.listUnitTypes) {
      throw new BusinessRuleError(
        'rates_demo_needs_inventory',
        'The rates demo seed needs unit types from inventory: bind RatesPorts.listUnitTypes in the composition root (and run the inventory seed first).',
      );
    }
    await rates.installTaxTemplate(tx, { template: 'MV', propertyIds: null });
    for (const p of org.properties) {
      const unitTypes = await ports.listUnitTypes(tx, p.id);
      if (unitTypes.length === 0) continue;
      const from = ports.getBusinessDate ? await ports.getBusinessDate(tx, p.id) : tx.now.toISOString().slice(0, 10);
      if (p.profile === 'resort') await seedResortRates(rates, tx, { propertyId: p.id, unitTypes, from });
      else await seedGuesthouseRates(rates, tx, { propertyId: p.id, unitTypes, from });
    }
  };
}
