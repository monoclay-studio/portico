/**
 * Agreed terms (TermsSnapshot) after booking — pure functions used by reservations, finance and Day Close:
 *  - postingPlan / postingChargeLines: every charge to post, from the snapshot ONLY (RAT-I03/I04); commercial
 *    rules (service charge) stay on the agreed versions;
 *  - evaluateCancellationPenalty: the penalty for cancelling / no-show / leaving early at an instant;
 *  - levyTrueUp: Green Tax for actual 24-hour blocks vs the agreed estimate (MIRA 12-hour check-out rule);
 *  - applyPriceOverride: manual price, complimentary and house-use agreements (levies kept);
 *  - reprice: change previews that keep agreed nights at agreed prices (RAT-R29).
 */
import {
  allocate,
  type DateRange,
  Decimal,
  eachNight,
  instantToZoned,
  type LocalDate,
  money,
  type Occupancy,
  ValidationError,
} from '@portico/kernel';
import type {
  CancellationStructure,
  ChargeLine,
  DepositStructure,
  GuaranteeStructure,
  InclusionSnapshot,
  MoneyDto,
  NightPrice,
  Penalty,
  PenaltyEvaluation,
  PriceOverrideRequest,
  PromotionDiscount,
  RepricingResult,
  TaxInclusion,
  TermsSnapshot,
  Violation,
} from '../contracts';
import { assemble, type NightDraft, type PlanMeta, type PlanPolicies, type PropertyContext } from './offer';
import { instantiateSchedule, penaltyAmount, tierInForce, zonedInstant } from './policies';
import { priceForOccupancy } from './pricing';
import { reapplyEffects } from './promotions';
import { type LoadedTaxRule, levyDays } from './tax-engine';

export { sealTerms, verifyTerms } from './terms-seal';

// ───────────────────────────── Posting plan ─────────────────────────────

export interface PostingLine {
  /** Deterministic business key for finance (FIN-R08): room:{stay}:{night} / inclusion:{stay}:{inclusion}:{night}. */
  idempotencyKey: string;
  kind: 'room' | 'inclusion' | 'allowance' | 'added';
  nightDate: LocalDate;
  serviceDate: LocalDate;
  chargeCode: string;
  taxCategory: string;
  outletKind: string | null;
  amount: MoneyDto;
  quantity: number;
  inclusionId: string | null;
  taxInclusion: TaxInclusion;
  occupancy: Occupancy;
  nightIndex: number;
  stayNights: number;
  bookingDate: LocalDate;
  /** Commercial rule versions of the agreement: pass as ChargeLine.agreedRuleVersionIds. */
  agreedRuleVersionIds: string[];
  /**
   * Additive (day-close review P0-1): what this line IS in the agreement, independent of the night it is allocated
   * to. A re-price that moves a line to another night (extension, shortening) keeps its `lineKey`, so a consumer
   * posting by `lineKey` never charges the same line twice and can see a line it has not posted yet.
   *  - nightly room / inclusion / allowance: the night is the occurrence → equal to `idempotencyKey`;
   *  - arrival / departure rhythm: once per stay → `inclusion:{stay}:{inclusion}:arrival|departure`;
   *  - days-of-stay rhythm: the n-th night of the stay → `inclusion:{stay}:{inclusion}:stay-night-{n}`.
   */
  lineKey: string;
  occurrence: { rhythm: 'nightly' | 'arrival' | 'departure' | 'days_of_stay'; stayNight: number };
}

/** Stable identity of a plan line (see `PostingLine.lineKey`). */
function lineIdentity(
  stayId: string,
  kind: 'room' | 'inclusion' | 'allowance' | 'added',
  inclusionId: string | null,
  rhythm: InclusionSnapshot['rhythm'] | undefined,
  nightDate: LocalDate,
  stayNight: number,
): { lineKey: string; occurrence: PostingLine['occurrence'] } {
  if (kind === 'room' || !inclusionId)
    return { lineKey: `room:${stayId}:${nightDate}`, occurrence: { rhythm: 'nightly', stayNight } };
  const r = rhythm?.kind ?? 'nightly';
  if (r === 'arrival' || r === 'departure')
    return { lineKey: `inclusion:${stayId}:${inclusionId}:${r}`, occurrence: { rhythm: r, stayNight } };
  if (r === 'days_of_stay')
    return {
      lineKey: `inclusion:${stayId}:${inclusionId}:stay-night-${stayNight}`,
      occurrence: { rhythm: r, stayNight },
    };
  return {
    lineKey: `inclusion:${stayId}:${inclusionId}:${nightDate}`,
    occurrence: { rhythm: 'nightly', stayNight },
  };
}

/**
 * Every charge to post for an agreed stay, from the snapshot alone. Statutory taxes are computed at posting with
 * `computeTaxes` by each rule's tax point; hotel-set (commercial) rules use the agreed versions only.
 */
export function postingPlan(terms: TermsSnapshot, stayId: string): PostingLine[] {
  const index = new Map(terms.nights.map((n, i) => [n.date, i]));
  const common = {
    taxInclusion: terms.taxInclusion,
    occupancy: terms.occupancy,
    stayNights: terms.stay.nights,
    bookingDate: terms.bookingDate,
    agreedRuleVersionIds: [...terms.taxes.commercialRuleVersionIds],
  };
  const out: PostingLine[] = [];
  for (const n of terms.nights) {
    for (const c of n.components) {
      const inclusion = c.inclusionId ? terms.inclusions.find((i) => i.id === c.inclusionId) : undefined;
      const serviceDate = inclusion?.rhythm.kind === 'departure' ? terms.stay.departure : n.date;
      out.push({
        ...common,
        idempotencyKey:
          c.kind === 'room' ? `room:${stayId}:${n.date}` : `inclusion:${stayId}:${c.inclusionId}:${n.date}`,
        ...lineIdentity(
          stayId,
          c.kind,
          c.inclusionId,
          inclusion?.rhythm,
          n.date,
          (index.get(n.date) ?? 0) + 1,
        ),
        kind: c.kind,
        nightDate: n.date,
        serviceDate,
        chargeCode: c.chargeCode,
        taxCategory: c.taxCategory,
        outletKind: c.outletKind,
        amount: c.amount,
        quantity: 1,
        inclusionId: c.inclusionId,
        nightIndex: index.get(n.date) ?? 0,
      });
    }
  }
  for (const a of terms.addedComponents) {
    const inclusion = terms.inclusions.find((i) => i.id === a.inclusionId);
    out.push({
      ...common,
      idempotencyKey: `inclusion:${stayId}:${a.inclusionId}:${a.nightDate}`,
      ...lineIdentity(
        stayId,
        'added',
        a.inclusionId,
        inclusion?.rhythm,
        a.nightDate,
        (index.get(a.nightDate) ?? 0) + 1,
      ),
      kind: 'added',
      nightDate: a.nightDate,
      serviceDate: a.serviceDate,
      chargeCode: a.chargeCode,
      taxCategory: a.taxCategory,
      outletKind: inclusion?.outletKind ?? null,
      amount: a.amount,
      quantity: a.quantity,
      inclusionId: a.inclusionId,
      nightIndex: index.get(a.nightDate) ?? 0,
    });
  }
  return out;
}

/** The posting plan as ready-to-use computeTaxes lines (lineId = the posting's idempotency key). */
export function postingChargeLines(terms: TermsSnapshot, stayId: string): ChargeLine[] {
  return postingPlan(terms, stayId).map((p) => ({
    lineId: p.idempotencyKey,
    chargeCode: p.chargeCode,
    taxCategory: p.taxCategory,
    amount: p.amount,
    quantity: p.quantity,
    serviceDate: p.serviceDate,
    taxInclusion: p.taxInclusion,
    nights: 1,
    units: 1,
    occupancy: { adults: p.occupancy.adults, childrenAges: [...p.occupancy.childrenAges] },
    nightIndex: p.nightIndex,
    agreedRuleVersionIds: p.agreedRuleVersionIds,
    levyOnly: false,
    ...(p.outletKind ? { outletKind: p.outletKind } : {}),
  }));
}

/**
 * Payment schedule for agreed terms: from the snapshot's deposit policy and agreed totals only.
 * `bookingDate` defaults to the agreement's booking date.
 */
export function instantiatePaymentSchedule(terms: TermsSnapshot, opts: { bookingDate?: LocalDate } = {}) {
  const deposit = terms.policies.deposit;
  if (!deposit) return [];
  return instantiateSchedule(deposit.structure, {
    bookingDate: opts.bookingDate ?? terms.bookingDate,
    arrival: terms.stay.arrival,
    departure: terms.stay.departure,
    nightsGrossMinor: terms.nights.map((n) => n.gross.amountMinor),
    totalGrossMinor: terms.totals.gross.amountMinor,
    currency: terms.currency,
  });
}

// ───────────────────────────── Penalties ─────────────────────────────

/** A night's amount on the policy's penalty basis (default: price + hotel fees, never statutory per-guest levies). */
export function penaltyBasisAmount(n: NightPrice, basis: CancellationStructure['basis']): number {
  if (basis === 'gross') return n.gross.amountMinor;
  if (basis === 'net') return n.net.amountMinor;
  return (
    n.net.amountMinor +
    n.taxes.filter((t) => t.nature === 'commercial').reduce((s, t) => s + t.amount.amountMinor, 0)
  );
}

/**
 * Penalty for cancelling (before arrival), not showing up, or leaving early, evaluated from the agreement
 * alone. `nights` = the nights given up (default: all nights; early departure: nights from the local date of `at`).
 */
export function evaluateCancellationPenalty(
  terms: TermsSnapshot,
  at: Date,
  opts: { event?: PenaltyEvaluation['event']; nights?: readonly LocalDate[] } = {},
): PenaltyEvaluation {
  const cur = terms.currency;
  const arrivalInstant = zonedInstant(terms.stay.arrival, terms.checkInTime, terms.propertyTimezone);
  const event = opts.event ?? (at < arrivalInstant ? 'cancellation' : 'early_departure');
  const localToday = instantToZoned(at, terms.propertyTimezone).date;
  const wanted = opts.nights
    ? new Set(opts.nights)
    : event === 'early_departure'
      ? new Set(terms.nights.filter((n) => n.date >= localToday).map((n) => n.date))
      : new Set(terms.nights.map((n) => n.date));
  const nights = terms.nights.filter((n) => wanted.has(n.date));
  const cancel = terms.policies.cancellation;
  const basis = cancel?.structure.basis ?? 'net_and_fees';
  const amounts = nights.map((n) => ({ amountMinor: penaltyBasisAmount(n, basis) }));
  let tier: PenaltyEvaluation['tier'] = null;
  let penalty: Penalty = { kind: 'none' };
  let description: string;
  if (!cancel) {
    description = 'The agreement has no cancellation policy: no penalty.';
  } else if (event === 'cancellation') {
    const inForce = tierInForce(cancel.tiers, at);
    if (inForce) {
      tier = { fromInstant: inForce.fromInstant, description: inForce.description };
      penalty = inForce.penalty;
      description = inForce.description;
    } else {
      description = 'Within the free cancellation period: no penalty.';
    }
  } else if (event === 'no_show') {
    penalty = cancel.structure.noShow;
    description = 'No-show penalty from the agreed cancellation policy.';
  } else {
    penalty = cancel.structure.earlyDeparture;
    description = 'Early departure penalty from the agreed cancellation policy.';
  }
  return {
    event,
    at: at.toISOString(),
    nights: nights.map((n) => n.date),
    tier,
    penalty,
    basisAmount: { amountMinor: amounts.reduce((s, a) => s + a.amountMinor, 0), currency: cur },
    amount: { amountMinor: penaltyAmount(penalty, amounts), currency: cur },
    description,
  };
}

// ───────────────────────────── Green Tax true-up ─────────────────────────────

/**
 * Per-guest-per-day levies (Green Tax) are estimated at one guest-day per agreed night. At check-out the actual
 * 24-hour blocks decide (MIRA: the check-out block counts at ≥ 12 hours). Returns the levy-only line to post the
 * difference (a `reversal` when fewer days were used than agreed) through computeTaxes.
 */
export function levyTrueUp(
  terms: TermsSnapshot,
  input: { checkInAt: Date; checkOutAt: Date; minHoursLastBlock?: number },
): {
  agreedDays: number;
  actualDays: number;
  deltaDays: number;
  lastBlockHours: number;
  line: ChargeLine | null;
} {
  const actual = levyDays(input.checkInAt, input.checkOutAt, input.minHoursLastBlock ?? 12);
  const agreedDays = terms.stay.nights;
  const delta = actual.days - agreedDays;
  const line: ChargeLine | null =
    delta === 0
      ? null
      : {
          lineId: `levy-true-up:${terms.seal.slice(-16)}`,
          chargeCode: terms.ratePlan.roomChargeCode,
          taxCategory: 'accommodation',
          amount: { amountMinor: 0, currency: terms.currency },
          quantity: 1,
          serviceDate: instantToZoned(input.checkOutAt, terms.propertyTimezone).date,
          taxInclusion: { mode: 'exclusive' },
          nights: Math.abs(delta),
          units: 1,
          occupancy: { adults: terms.occupancy.adults, childrenAges: [...terms.occupancy.childrenAges] },
          // Not the first night: per-stay rules are never charged again by a true-up.
          nightIndex: Math.max(1, terms.stay.nights),
          levyOnly: true,
          adjustment: delta < 0 ? 'reversal' : 'supply',
          agreedRuleVersionIds: [...terms.taxes.commercialRuleVersionIds],
        };
  return {
    agreedDays,
    actualDays: actual.days,
    deltaDays: delta,
    lastBlockHours: actual.lastBlockHours,
    line,
  };
}

// ───────────────────────────── Shared assembly from terms ─────────────────────────────

export function plannedPolicies(terms: TermsSnapshot): PlanPolicies {
  const p = terms.policies;
  const strip = <T>(x: { id: string; code: string; name: string; version: number; structure: T } | null) =>
    x ? { id: x.id, code: x.code, name: x.name, version: x.version, structure: x.structure } : null;
  return {
    cancellation: strip<CancellationStructure>(p.cancellation),
    guarantee: strip<GuaranteeStructure>(p.guarantee),
    deposit: strip<DepositStructure>(p.deposit),
  };
}

export function planMetaOf(terms: TermsSnapshot): PlanMeta {
  return {
    id: terms.ratePlan.id,
    code: terms.ratePlan.code,
    name: terms.ratePlan.name,
    version: terms.ratePlan.version,
    currency: terms.currency,
    mealPlan: terms.ratePlan.mealPlan,
    roomChargeCode: terms.ratePlan.roomChargeCode,
    marketSegment: terms.ratePlan.marketSegment,
    taxInclusion: terms.taxInclusion,
    commission: terms.commission
      ? (({ amount: _a, agencyCollects: _c, invoiceable: _i, ...c }) => c)(terms.commission)
      : null,
    chain: terms.ratePlan.derivationChain,
  };
}

const draftOf = (n: NightPrice): NightDraft => ({
  date: n.date,
  params: n.occupancyPricing,
  baseAmountMinor: n.baseAmount.amountMinor,
  effects: n.promotions,
  amountMinor: n.amount.amountMinor,
});

// ───────────────────────────── Price override, complimentary, house use ─────────────────────────────

/**
 * A new sealed agreement with overridden prices (RAT-R28 "price override details"). Complimentary and house-use
 * stays price every night and added item at 0; value-based taxes become 0 and per-guest levies (Green Tax) stay
 * due (MIRA FAQ: complimentary stays are taxable). The original seal and totals are kept in `priceOverride`.
 */
export function applyPriceOverride(input: {
  terms: TermsSnapshot;
  override: PriceOverrideRequest['override'];
  reason: string;
  by: string;
  at: string;
  property: PropertyContext;
  taxRules: readonly LoadedTaxRule[];
  meta: { quoteId: string; quotedAt: string; configVector: string; sealKey: string };
}): TermsSnapshot {
  const t = input.terms;
  const o = input.override;
  const drafts = t.nights.map(draftOf);
  // The agreed (pre-override) price stays the base, so included items shrink with the new price instead of
  // exceeding it (a complimentary night still delivers its breakfast, at a 0 revenue share).
  const setAmount = (d: NightDraft, amountMinor: number): NightDraft => ({
    ...d,
    baseAmountMinor: Math.max(d.baseAmountMinor, amountMinor),
    effects: [],
    amountMinor,
  });
  let priced: NightDraft[];
  let inclusions: readonly InclusionSnapshot[] = t.inclusions;
  if (o.kind === 'nightly') {
    for (const date of Object.keys(o.nightsMinor)) {
      if (!t.nights.some((n) => n.date === date)) {
        throw new ValidationError(
          'override_night_not_in_stay',
          `The night ${date} is not part of the agreed stay.`,
        );
      }
    }
    priced = drafts.map((d) => {
      const v = o.nightsMinor[d.date];
      return v !== undefined ? setAmount(d, v) : d;
    });
  } else if (o.kind === 'total') {
    const weights = drafts.map((d) => d.amountMinor);
    const ratios = weights.some((w) => w > 0) ? weights : drafts.map(() => 1);
    const shares = allocate(money(o.totalMinor, t.currency), ratios);
    priced = drafts.map((d, i) => setAmount(d, shares[i]?.amountMinor ?? 0));
  } else {
    priced = drafts.map((d) => setAmount(d, 0));
    inclusions = t.inclusions.map((i) =>
      i.priceMode === 'added' ? { ...i, pricing: { kind: 'fixed' as const, amountMinor: 0 } } : i,
    );
  }
  const assembled = assemble({
    property: input.property,
    plan: planMetaOf(t),
    unitTypeId: t.unitTypeId,
    arrival: t.stay.arrival,
    departure: t.stay.departure,
    bookingDate: t.bookingDate,
    occupancy: t.occupancy,
    bands: t.childAgeBands,
    drafts: priced,
    inclusions,
    promotions: o.kind === 'nightly' ? t.promotions : [],
    policies: plannedPolicies(t),
    taxRules: input.taxRules,
    agreedRuleVersionIds: t.taxes.commercialRuleVersionIds,
    meta: {
      quoteId: input.meta.quoteId,
      quotedAt: input.meta.quotedAt,
      configVector: input.meta.configVector,
      priceSource: o.kind === 'complimentary' || o.kind === 'house_use' ? o.kind : 'manual_override',
      restrictionOverride: t.restrictionOverride,
      priceOverride: {
        kind: o.kind,
        reason: input.reason,
        by: input.by,
        at: input.at,
        original: { seal: t.seal, totals: t.totals },
      },
      supersedesSeal: t.seal,
      sealKey: input.meta.sealKey,
    },
  });
  return assembled.terms;
}

// ───────────────────────────── Repricing ─────────────────────────────

export type NewNightsPolicy = 'current_rates' | 'agreed_average' | 'manual';
export type TypeChangePolicy = 'keep_agreed' | 'difference' | 'reprice';

export interface RepriceInput {
  terms: TermsSnapshot;
  range: DateRange;
  occupancy: Occupancy;
  unitTypeId: string;
  newNightsPolicy: NewNightsPolicy;
  typeChangePolicy: TypeChangePolicy;
  manualAmountsMinor?: Record<string, number> | undefined;
  /** Current-rate drafts for the (new) unit type / plan, keyed by night, plus why nights could not be priced. */
  current: { drafts: ReadonlyMap<LocalDate, NightDraft>; violations: Violation[] } | null;
  /** Current-rate drafts for the agreed unit type (type change with `difference`). */
  currentAgreedType: ReadonlyMap<LocalDate, NightDraft> | null;
  /**
   * Rate plan change: every night is priced from `current` (the new plan at current rates) and the new plan's
   * inclusions, policies and promotions form the new agreement.
   */
  newPlan?:
    | {
        plan: PlanMeta;
        inclusions: readonly InclusionSnapshot[];
        policies: PlanPolicies;
        promotions: ReadonlyArray<{
          id: string;
          version: number;
          code: string;
          name: string;
          discount: PromotionDiscount;
        }>;
      }
    | undefined;
  changeAt: Date;
  property: PropertyContext;
  taxRules: readonly LoadedTaxRule[];
  meta: { quoteId: string; quotedAt: string; configVector: string; sealKey: string };
}

type Source = RepricingResult['nightly'][number]['source'];

const sameOccupancy = (a: Occupancy, b: Occupancy) =>
  a.adults === b.adults &&
  JSON.stringify([...a.childrenAges].sort()) === JSON.stringify([...b.childrenAges].sort());

function noPrice(date: LocalDate, message: string): Violation {
  return { kind: 'no_price', date, message, required: null, actual: null, overridable: false, source: null };
}

export function reprice(input: RepriceInput): RepricingResult {
  const t = input.terms;
  const cur = t.currency;
  const agreed = new Map(t.nights.map((n) => [n.date, n]));
  const occChanged = !sameOccupancy(input.occupancy, t.occupancy);
  const typeChanged = input.unitTypeId !== t.unitTypeId;
  const planChanged = !!input.newPlan;
  const violations: Violation[] = [];
  const drafts: NightDraft[] = [];
  const sources = new Map<LocalDate, Source>();
  const newDates = eachNight(input.range);
  const agreedTotal = t.nights.reduce((s, n) => s + n.amount.amountMinor, 0);
  const average =
    t.nights.length > 0
      ? new Decimal(agreedTotal).div(t.nights.length).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
      : 0;
  const firstParams = t.nights[0]?.occupancyPricing;
  let manualUsed = false;

  for (const d of newDates) {
    const a = agreed.get(d);
    if (planChanged) {
      const cn = input.current?.drafts.get(d);
      if (!cn) {
        if (!input.current?.violations.some((v) => v.date === d))
          violations.push(noPrice(d, `There is no current price on the new rate plan for ${d}.`));
        continue;
      }
      drafts.push(cn);
      sources.set(d, 'plan_changed');
      continue;
    }
    if (a) {
      let draft = draftOf(a);
      let source: Source = 'agreed';
      if (occChanged) {
        const r = priceForOccupancy(a.occupancyPricing, input.occupancy, t.childAgeBands);
        if (!r.ok) {
          violations.push({ ...noPrice(d, r.message), kind: r.kind });
          continue;
        }
        const re = reapplyEffects(r.amountMinor, a.promotions);
        draft = {
          ...draft,
          baseAmountMinor: r.amountMinor,
          effects: a.promotions.map((e, i) => ({
            ...e,
            discount: { amountMinor: re.discounts[i] ?? 0, currency: cur },
          })),
          amountMinor: re.amountMinor,
        };
        source = 'occupancy_repriced';
      }
      if (typeChanged && input.typeChangePolicy !== 'keep_agreed') {
        const cn = input.current?.drafts.get(d);
        if (input.typeChangePolicy === 'reprice') {
          if (!cn) {
            violations.push(noPrice(d, `There is no current price for the new unit type on ${d}.`));
            continue;
          }
          draft = cn;
          source = 'type_repriced';
        } else {
          const co = input.currentAgreedType?.get(d);
          if (!cn || !co) {
            violations.push(
              noPrice(
                d,
                `The price difference between unit types cannot be computed for ${d} (missing current price).`,
              ),
            );
            continue;
          }
          const amount = Math.max(0, draft.amountMinor + cn.amountMinor - co.amountMinor);
          draft = {
            ...draft,
            params: cn.params,
            amountMinor: amount,
            baseAmountMinor: draft.baseAmountMinor + (amount - draft.amountMinor),
          };
          source = 'type_difference';
        }
      }
      drafts.push(draft);
      sources.set(d, source);
      continue;
    }
    // A night outside the agreement.
    if (input.newNightsPolicy === 'current_rates') {
      const cn = input.current?.drafts.get(d);
      if (!cn) {
        if (!input.current?.violations.some((v) => v.date === d))
          violations.push(noPrice(d, `There is no current price for the night of ${d}.`));
        continue;
      }
      drafts.push(cn);
      sources.set(d, 'current_rates');
    } else if (input.newNightsPolicy === 'agreed_average') {
      if (!firstParams) {
        violations.push(noPrice(d, 'The agreement has no nights to average.'));
        continue;
      }
      drafts.push({
        date: d,
        params: firstParams,
        baseAmountMinor: average,
        effects: [],
        amountMinor: average,
      });
      sources.set(d, 'agreed_average');
    } else {
      const amount = input.manualAmountsMinor?.[d];
      if (amount === undefined || !firstParams) {
        violations.push(noPrice(d, `Enter a manual price for the night of ${d}.`));
        continue;
      }
      manualUsed = true;
      drafts.push({
        date: d,
        params: firstParams,
        baseAmountMinor: amount,
        effects: [],
        amountMinor: amount,
      });
      sources.set(d, 'manual');
    }
  }
  if (input.current) {
    const repricedAll = planChanged || (typeChanged && input.typeChangePolicy === 'reprice');
    const newSet = new Set(newDates.filter((d) => !agreed.has(d) || repricedAll));
    for (const v of input.current.violations) if (v.date === null || newSet.has(v.date)) violations.push(v);
  }

  // Removed nights: cancellation tier in force before arrival, early-departure penalty after.
  const removed = t.nights.filter((n) => !newDates.includes(n.date)).map((n) => n.date);
  const penalties: RepricingResult['penalties'] = [];
  if (removed.length > 0 && t.policies.cancellation) {
    const p = evaluateCancellationPenalty(t, input.changeAt, { nights: removed });
    if (p.amount.amountMinor > 0) {
      penalties.push({
        kind: p.event === 'cancellation' ? 'cancellation' : 'early_departure',
        nights: p.nights,
        amount: p.amount,
        description: p.description,
      });
    }
  }

  const np = input.newPlan;
  const assembled = assemble({
    property: input.property,
    plan: np ? np.plan : planMetaOf(t),
    unitTypeId: input.unitTypeId,
    arrival: input.range.from,
    departure: input.range.to,
    bookingDate: t.bookingDate,
    occupancy: input.occupancy,
    bands: t.childAgeBands,
    drafts,
    inclusions: np ? np.inclusions : t.inclusions,
    promotions: np ? np.promotions : t.promotions,
    policies: np ? np.policies : plannedPolicies(t),
    taxRules: input.taxRules,
    // The same agreement continues: hotel-set fees stay on the agreed versions. A plan change is a new agreement.
    ...(np ? {} : { agreedRuleVersionIds: t.taxes.commercialRuleVersionIds }),
    meta: {
      quoteId: input.meta.quoteId,
      quotedAt: input.meta.quotedAt,
      configVector: input.meta.configVector,
      priceSource: manualUsed ? 'manual_override' : np ? 'portico_quote' : t.priceSource,
      restrictionOverride: t.restrictionOverride,
      priceOverride: np ? null : t.priceOverride,
      supersedesSeal: t.seal,
      sealKey: input.meta.sealKey,
    },
  });

  const after = new Map(assembled.nightly.map((n) => [n.date, n]));
  const allDates = [...new Set([...t.nights.map((n) => n.date), ...newDates])].sort();
  const nightly: RepricingResult['nightly'] = allDates.map((d) => {
    const before = agreed.get(d)?.amount ?? null;
    const aft = after.get(d)?.amount ?? null;
    return {
      date: d,
      before,
      after: aft,
      source: aft ? (sources.get(d) ?? 'agreed') : 'removed',
      difference: { amountMinor: (aft?.amountMinor ?? 0) - (before?.amountMinor ?? 0), currency: cur },
    };
  });
  return {
    nightly,
    penalties,
    before: t.totals,
    after: assembled.totals,
    difference: {
      amountMinor: assembled.totals.gross.amountMinor - t.totals.gross.amountMinor,
      currency: cur,
    },
    violations: [...violations, ...assembled.violations],
    terms: assembled.terms,
  };
}
