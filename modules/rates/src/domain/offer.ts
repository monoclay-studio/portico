/**
 * Offer assembly (pure, RAT-R27/R28). Night prices flow: base plan price → derivation chain (per parameter) →
 * occupancy → promotions → inclusion allocation (revenue split) → tax & fee engine → totals → policies →
 * self-contained TermsSnapshot. The same `assemble` is used for fresh quotes and for repricing agreed terms, so
 * a re-priced agreement is computed exactly like a new one.
 */
import { Decimal, diffDays, eachNight, type LocalDate, type Occupancy } from '@portico/kernel';
import type {
  AddedComponent,
  AllowanceEntitlement,
  CancellationStructure,
  ChargeLine,
  Commission,
  DepositStructure,
  Eligibility,
  GuaranteeStructure,
  InclusionSnapshot,
  NightPrice,
  OccupancyPricing,
  Offer,
  OfferPolicies,
  PriceComponent,
  PromotionDiscount,
  PromotionEffect,
  TaxInclusion,
  TaxSummaryLine,
  TermsSnapshot,
  Totals,
  Violation,
} from '../contracts';
import { TERMS_SCHEMA_VERSION } from '../contracts';
import { computeInclusions } from './inclusions';
import {
  instantiateSchedule,
  renderCancellationText,
  renderDepositText,
  renderGuaranteeText,
  resolveCancellationTiers,
} from './policies';
import { type ChildAgeBand, type DerivationStep, priceForOccupancy, resolveDerivedParams } from './pricing';
import { applyPromotions, type PromotionCandidate, type PromotionContext } from './promotions';
import { type Classification, computeTaxesPure, type LoadedTaxRule } from './tax-engine';
import { sealTerms } from './terms-hash';

export interface PropertyContext {
  id: string;
  timezone: string;
  checkInTime: string;
  classification: Classification;
}

export interface PlanMeta {
  id: string;
  code: string;
  name: string;
  version: number;
  currency: string;
  mealPlan: string;
  roomChargeCode: string;
  marketSegment: string | null;
  taxInclusion: TaxInclusion;
  commission: Commission | null;
  chain: Array<{ id: string; code: string; version: number }>;
}

export interface PolicySnapshot<T> {
  id: string;
  code: string;
  name: string;
  version: number;
  structure: T;
}

export interface PlanPolicies {
  cancellation: PolicySnapshot<CancellationStructure> | null;
  guarantee: PolicySnapshot<GuaranteeStructure> | null;
  deposit: PolicySnapshot<DepositStructure> | null;
}

export interface NightDraft {
  date: LocalDate;
  params: OccupancyPricing;
  baseAmountMinor: number;
  effects: PromotionEffect[];
  amountMinor: number;
}

// ───────────────────────────── Eligibility ─────────────────────────────

export function checkEligibility(
  plan: { status: string; eligibility: Eligibility },
  req: { channelId?: string | undefined; companyId?: string | undefined; occupancy: Occupancy; bookingDate: LocalDate; arrival: LocalDate; departure: LocalDate },
): Violation[] {
  const out: Violation[] = [];
  const v = (kind: Violation['kind'], message: string, date: LocalDate | null = null): Violation => ({
    kind,
    date,
    message,
    required: null,
    actual: null,
    overridable: false,
    source: null,
  });
  const e = plan.eligibility;
  if (plan.status !== 'active') out.push(v('plan_not_active', `This rate plan is ${plan.status} and cannot be sold.`));
  if (e.channels && !e.channels.includes(req.channelId ?? 'direct'))
    out.push(v('not_eligible_channel', `This rate plan is not sold through ${req.channelId ?? 'direct bookings'}.`));
  if (e.companyIds && (!req.companyId || !e.companyIds.includes(req.companyId)))
    out.push(v('not_eligible_company', 'This is a negotiated rate for specific companies or agencies only.'));
  const guests = req.occupancy.adults + req.occupancy.childrenAges.length;
  if (e.minAdults !== undefined && req.occupancy.adults < e.minAdults)
    out.push(v('occupancy_not_allowed', `This rate requires at least ${e.minAdults} adults.`));
  if (e.maxAdults !== undefined && req.occupancy.adults > e.maxAdults)
    out.push(v('occupancy_not_allowed', `This rate allows at most ${e.maxAdults} adults.`));
  if (e.maxChildren !== undefined && req.occupancy.childrenAges.length > e.maxChildren)
    out.push(v('occupancy_not_allowed', `This rate allows at most ${e.maxChildren} children.`));
  if (e.maxGuests !== undefined && guests > e.maxGuests)
    out.push(v('occupancy_not_allowed', `This rate allows at most ${e.maxGuests} guests.`));
  if ((e.sellDates?.from && req.bookingDate < e.sellDates.from) || (e.sellDates?.to && req.bookingDate > e.sellDates.to))
    out.push(v('outside_sell_dates', `This rate can only be booked between ${e.sellDates?.from ?? 'any date'} and ${e.sellDates?.to ?? 'any date'}.`));
  for (const d of eachNight({ from: req.arrival, to: req.departure })) {
    if ((e.stayDates?.from && d < e.stayDates.from) || (e.stayDates?.to && d > e.stayDates.to)) {
      out.push(v('outside_stay_dates', `The night of ${d} is outside this rate's stay dates.`, d));
    }
  }
  return out;
}

// ───────────────────────────── Night pricing from configuration ─────────────────────────────

export function priceNights(input: {
  nights: readonly LocalDate[];
  rootPrices: ReadonlyMap<LocalDate, OccupancyPricing>;
  steps: readonly DerivationStep[];
  unitTypeId: string;
  ratePlanId: string;
  occupancy: Occupancy;
  bands: readonly ChildAgeBand[];
  promotions: readonly PromotionCandidate[];
  promotionContext: PromotionContext;
  currency: string;
}): { drafts: NightDraft[]; violations: Violation[]; chosen: PromotionCandidate[] } {
  const violations: Violation[] = [];
  const priced: Array<{ date: LocalDate; params: OccupancyPricing; baseAmountMinor: number }> = [];
  for (const date of input.nights) {
    const root = input.rootPrices.get(date);
    if (!root) {
      violations.push({
        kind: 'no_price',
        date,
        message: `There is no price for the night of ${date}. Set a price in the rate calendar.`,
        required: null,
        actual: null,
        overridable: false,
        source: { ratePlanId: input.ratePlanId, unitTypeId: input.unitTypeId },
      });
      continue;
    }
    const params = resolveDerivedParams(root, input.steps, input.unitTypeId);
    const r = priceForOccupancy(params, input.occupancy, input.bands);
    if (!r.ok) {
      violations.push({
        kind: r.kind,
        date,
        message: r.message,
        required: null,
        actual: null,
        overridable: false,
        source: { ratePlanId: input.ratePlanId, unitTypeId: input.unitTypeId },
      });
      continue;
    }
    priced.push({ date, params, baseAmountMinor: r.amountMinor });
  }
  const promo = applyPromotions(
    input.promotions,
    input.promotionContext,
    priced.map((p) => ({ date: p.date, amountMinor: p.baseAmountMinor })),
  );
  const drafts = priced.map((p) => ({
    date: p.date,
    params: p.params,
    baseAmountMinor: p.baseAmountMinor,
    effects: (promo.effects.get(p.date) ?? []).map(({ discountMinor, ...e }) => ({
      ...e,
      discount: { amountMinor: discountMinor, currency: input.currency },
    })),
    amountMinor: promo.amounts.get(p.date) ?? p.baseAmountMinor,
  }));
  return { drafts, violations, chosen: promo.chosen };
}

// ───────────────────────────── Assembly ─────────────────────────────

export interface AssembleInput {
  property: PropertyContext;
  plan: PlanMeta;
  unitTypeId: string;
  arrival: LocalDate;
  departure: LocalDate;
  bookingDate: LocalDate;
  occupancy: Occupancy;
  bands: readonly ChildAgeBand[];
  drafts: readonly NightDraft[];
  inclusions: readonly InclusionSnapshot[];
  promotions: ReadonlyArray<{ id: string; version: number; code: string; name: string; discount: PromotionDiscount }>;
  policies: PlanPolicies;
  taxRules: readonly LoadedTaxRule[];
  meta: {
    quoteId: string;
    quotedAt: string;
    configVector: string;
    priceSource: TermsSnapshot['priceSource'];
    restrictionOverride: TermsSnapshot['restrictionOverride'];
    supersedesHash: string | null;
  };
}

export interface Assembled {
  nightly: NightPrice[];
  added: AddedComponent[];
  allowances: AllowanceEntitlement[];
  includedInclusions: Offer['inclusions']['included'];
  taxesAndFees: TaxSummaryLine[];
  totals: Totals;
  policies: OfferPolicies;
  commission: TermsSnapshot['commission'];
  violations: Violation[];
  unverifiedTaxRules: string[];
  terms: TermsSnapshot;
}

const m = (amountMinor: number, currency: string) => ({ amountMinor, currency });

export function assemble(input: AssembleInput): Assembled {
  const cur = input.plan.currency;
  const nights = input.drafts;
  const occ = { adults: input.occupancy.adults, childrenAges: [...input.occupancy.childrenAges] };
  const stayNights = diffDays(input.arrival, input.departure);
  const nightIndex = new Map(eachNight({ from: input.arrival, to: input.departure }).map((d, i) => [d, i]));
  const inc = computeInclusions({
    inclusions: input.inclusions,
    nights: nights.map((n) => ({ date: n.date, amountMinor: n.amountMinor })),
    departure: input.departure,
    occupancy: input.occupancy,
    bands: input.bands,
    currency: cur,
  });

  // Charge lines: one per night component, one per added occurrence.
  const lines: ChargeLine[] = [];
  const nightComponents = new Map<LocalDate, Array<PriceComponent & { lineId: string }>>();
  for (const n of nights) {
    const included = inc.included.get(n.date) ?? [];
    const allocated = included.reduce((s, o) => s + o.amountMinor, 0);
    const comps: Array<PriceComponent & { lineId: string }> = [
      {
        lineId: `n:${n.date}:room`,
        kind: 'room',
        inclusionId: null,
        code: 'ROOM',
        chargeCode: input.plan.roomChargeCode,
        taxCategory: 'accommodation',
        amount: m(n.amountMinor - allocated, cur),
      },
      ...included.map((o) => ({
        lineId: `n:${n.date}:${o.inclusion.code}`,
        kind: o.inclusion.kind === 'allowance' ? ('allowance' as const) : ('inclusion' as const),
        inclusionId: o.inclusion.id,
        code: o.inclusion.code,
        chargeCode: o.inclusion.chargeCode,
        taxCategory: o.inclusion.taxCategory,
        amount: m(o.amountMinor, cur),
      })),
    ];
    nightComponents.set(n.date, comps);
    const serviceDates = new Map(included.map((o) => [o.inclusion.code, o.serviceDate]));
    for (const c of comps) {
      lines.push({
        lineId: c.lineId,
        chargeCode: c.chargeCode,
        taxCategory: c.taxCategory,
        amount: c.amount,
        quantity: 1,
        serviceDate: c.kind === 'room' ? n.date : (serviceDates.get(c.code) ?? n.date),
        taxInclusion: input.plan.taxInclusion,
        nights: 1,
        units: 1,
        occupancy: occ,
        nightIndex: nightIndex.get(n.date) ?? 0,
      });
    }
  }
  const addedLineIds: string[] = [];
  inc.added.forEach((o, i) => {
    const lineId = `a:${o.inclusion.code}:${o.serviceDate}:${i}`;
    addedLineIds.push(lineId);
    lines.push({
      lineId,
      chargeCode: o.inclusion.chargeCode,
      taxCategory: o.inclusion.taxCategory,
      amount: m(o.amountMinor, cur),
      quantity: o.quantity,
      serviceDate: o.serviceDate,
      taxInclusion: input.plan.taxInclusion,
      nights: 1,
      units: 1,
      occupancy: occ,
      nightIndex: nightIndex.get(o.nightDate) ?? 0,
    });
  });

  const tax =
    lines.length > 0
      ? computeTaxesPure(input.taxRules, lines, {
          classification: input.property.classification,
          occupancy: input.occupancy,
          stayContext: { stayNights, arrival: input.arrival, bookingDate: input.bookingDate },
        })
      : null;
  const byLine = new Map((tax?.lines ?? []).map((l) => [l.lineId, l]));

  const nightly: NightPrice[] = nights.map((n) => {
    const comps = nightComponents.get(n.date) ?? [];
    const results = comps.map((c) => byLine.get(c.lineId));
    return {
      date: n.date,
      baseAmount: m(n.baseAmountMinor, cur),
      promotions: n.effects,
      amount: m(n.amountMinor, cur),
      components: comps.map(({ lineId: _lineId, ...c }) => c),
      occupancyPricing: n.params,
      taxes: results.flatMap((r) => r?.taxes ?? []),
      net: m(results.reduce((s, r) => s + (r?.net.amountMinor ?? 0), 0), cur),
      gross: m(results.reduce((s, r) => s + (r?.gross.amountMinor ?? 0), 0), cur),
    };
  });
  const added: AddedComponent[] = inc.added.map((o, i) => {
    const r = byLine.get(addedLineIds[i] as string);
    return {
      inclusionId: o.inclusion.id,
      code: o.inclusion.code,
      name: o.inclusion.name,
      chargeCode: o.inclusion.chargeCode,
      taxCategory: o.inclusion.taxCategory,
      serviceDate: o.serviceDate,
      nightDate: o.nightDate,
      quantity: o.quantity,
      amount: m(o.amountMinor, cur),
      taxes: r?.taxes ?? [],
      net: r?.net ?? m(0, cur),
      gross: r?.gross ?? m(0, cur),
    };
  });

  const totals: Totals = tax
    ? { ...tax.totals, allInTotal: tax.totals.gross }
    : { net: m(0, cur), taxes: m(0, cur), fees: m(0, cur), gross: m(0, cur), allInTotal: m(0, cur) };

  const summary = new Map<string, TaxSummaryLine>();
  for (const t of (tax?.lines ?? []).flatMap((l) => l.taxes)) {
    const s = summary.get(t.ruleId);
    if (s) {
      s.amount = m(s.amount.amountMinor + t.amount.amountMinor, cur);
      if (!s.ruleVersionIds.includes(t.ruleVersionId)) s.ruleVersionIds.push(t.ruleVersionId);
      s.inclusive = s.inclusive || t.inclusive;
      if (t.verificationStatus === 'unverified') s.verificationStatus = 'unverified';
    } else {
      summary.set(t.ruleId, {
        ruleId: t.ruleId,
        ruleCode: t.ruleCode,
        ruleName: t.ruleName,
        category: t.category,
        inclusive: t.inclusive,
        ruleVersionIds: [t.ruleVersionId],
        amount: t.amount,
        verificationStatus: t.verificationStatus,
      });
    }
  }
  const taxesAndFees = [...summary.values()];

  const timing = { arrival: input.arrival, timeZone: input.property.timezone, checkInTime: input.property.checkInTime };
  const p = input.policies;
  const policies: OfferPolicies = {
    cancellation: p.cancellation
      ? {
          id: p.cancellation.id,
          code: p.cancellation.code,
          name: p.cancellation.name,
          version: p.cancellation.version,
          structure: p.cancellation.structure,
          text: renderCancellationText(p.cancellation.structure, cur),
          tiers: resolveCancellationTiers(p.cancellation.structure, timing, cur),
        }
      : null,
    guarantee: p.guarantee
      ? {
          id: p.guarantee.id,
          code: p.guarantee.code,
          name: p.guarantee.name,
          version: p.guarantee.version,
          structure: p.guarantee.structure,
          text: renderGuaranteeText(p.guarantee.structure),
        }
      : null,
    deposit: p.deposit
      ? {
          id: p.deposit.id,
          code: p.deposit.code,
          name: p.deposit.name,
          version: p.deposit.version,
          structure: p.deposit.structure,
          text: renderDepositText(p.deposit.structure, cur),
          schedule: instantiateSchedule(p.deposit.structure, {
            bookingDate: input.bookingDate,
            arrival: input.arrival,
            departure: input.departure,
            nightsGrossMinor: nightly.map((n) => n.gross.amountMinor),
            totalGrossMinor: totals.gross.amountMinor,
            currency: cur,
          }),
        }
      : null,
  };

  let commission: TermsSnapshot['commission'] = null;
  if (input.plan.commission) {
    const c = input.plan.commission;
    const roomNet = nightly.reduce(
      (s, n) => s + (byLine.get(`n:${n.date}:room`)?.net.amountMinor ?? 0),
      0,
    );
    const base = c.base === 'room_net' ? roomNet : c.base === 'stay_net' ? totals.net.amountMinor : totals.gross.amountMinor;
    const pct = c.percent ? new Decimal(base).mul(c.percent).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber() : 0;
    commission = { ...c, amount: m(pct + (c.amountPerNightMinor ?? 0) * nights.length, cur) };
  }

  const includedInclusions = input.inclusions
    .filter((i) => i.priceMode === 'included')
    .map((i) => ({ inclusionId: i.id, code: i.code, name: i.name, priceMode: i.priceMode }));

  const terms = sealTerms({
    schemaVersion: TERMS_SCHEMA_VERSION,
    kind: 'portico.rates.terms',
    quoteId: input.meta.quoteId,
    quotedAt: input.meta.quotedAt,
    configVector: input.meta.configVector,
    propertyId: input.property.id,
    propertyTimezone: input.property.timezone,
    checkInTime: input.property.checkInTime,
    currency: cur,
    priceSource: input.meta.priceSource,
    ratePlan: {
      id: input.plan.id,
      code: input.plan.code,
      name: input.plan.name,
      version: input.plan.version,
      mealPlan: input.plan.mealPlan,
      roomChargeCode: input.plan.roomChargeCode,
      marketSegment: input.plan.marketSegment,
      derivationChain: input.plan.chain,
    },
    unitTypeId: input.unitTypeId,
    stay: { arrival: input.arrival, departure: input.departure, nights: stayNights },
    bookingDate: input.bookingDate,
    occupancy: { adults: input.occupancy.adults, childrenAges: [...input.occupancy.childrenAges] },
    childAgeBands: input.bands.map((b) => ({ ...b })),
    taxInclusion: input.plan.taxInclusion,
    nights: nightly,
    addedComponents: added,
    allowances: inc.allowances,
    inclusions: input.inclusions.map((i) => ({
      id: i.id,
      version: i.version,
      code: i.code,
      name: i.name,
      kind: i.kind,
      chargeCode: i.chargeCode,
      taxCategory: i.taxCategory,
      pricing: i.pricing,
      basis: i.basis,
      rhythm: i.rhythm,
      priceMode: i.priceMode,
      fulfilmentOutlets: [...i.fulfilmentOutlets],
      allowance: i.allowance,
    })),
    promotions: input.promotions.map((x) => ({ id: x.id, version: x.version, code: x.code, name: x.name, discount: x.discount })),
    policies,
    commission,
    taxes: { summary: taxesAndFees, ruleVersionIds: tax?.ruleVersionIds ?? [] },
    totals,
    restrictionOverride: input.meta.restrictionOverride,
    supersedesHash: input.meta.supersedesHash,
  });

  return {
    nightly,
    added,
    allowances: inc.allowances,
    includedInclusions,
    taxesAndFees,
    totals,
    policies,
    commission,
    violations: inc.violations,
    unverifiedTaxRules: [...new Set(taxesAndFees.filter((t) => t.verificationStatus === 'unverified').map((t) => t.ruleCode))],
    terms,
  };
}

/** Combine assembly with violations into an Offer (override moves overridable violations aside). */
export function toOffer(
  a: Assembled,
  input: { unitTypeId: string; plan: PlanMeta; violations: Violation[]; override: boolean },
): Offer {
  const all = [...input.violations, ...a.violations];
  const overridden = input.override ? all.filter((v) => v.overridable) : [];
  const remaining = input.override ? all.filter((v) => !v.overridable) : all;
  return {
    unitTypeId: input.unitTypeId,
    ratePlanId: input.plan.id,
    ratePlanCode: input.plan.code,
    ratePlanName: input.plan.name,
    mealPlan: input.plan.mealPlan,
    currency: input.plan.currency,
    bookable: remaining.length === 0,
    nightly: a.nightly,
    inclusions: { included: a.includedInclusions, added: a.added, allowances: a.allowances },
    taxesAndFees: a.taxesAndFees,
    totals: a.totals,
    policies: a.policies,
    commission: a.commission,
    restrictionViolations: remaining,
    overriddenViolations: overridden,
    unverifiedTaxRules: a.unverifiedTaxRules,
    terms: a.terms,
  };
}

