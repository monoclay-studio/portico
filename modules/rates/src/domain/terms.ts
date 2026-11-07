/**
 * Agreed terms (TermsSnapshot) after booking (pure):
 *  - postingPlan: every charge line to post for the stay, computed ONLY from the snapshot (RAT-I03/I04);
 *  - reprice: change previews that keep agreed nights at agreed prices and price new nights by policy (RAT-R29).
 */
import { type DateRange, eachNight, type LocalDate, type Occupancy } from '@portico/kernel';
import type {
  CancellationStructure,
  DepositStructure,
  GuaranteeStructure,
  MoneyDto,
  RepricingResult,
  TaxInclusion,
  TermsSnapshot,
  Violation,
} from '../contracts';
import { assemble, type NightDraft, type PlanPolicies, type PropertyContext } from './offer';
import { instantiateSchedule, penaltyAmount, tierInForce, zonedInstant } from './policies';
import { priceForOccupancy } from './pricing';
import { reapplyEffects } from './promotions';
import type { LoadedTaxRule } from './tax-engine';

export { hashTerms, sealTerms, verifyTerms } from './terms-hash';

// ───────────────────────────── Posting plan ─────────────────────────────

export interface PostingLine {
  /** Deterministic business key for finance (FIN-R08): room:{stay}:{night} / inclusion:{stay}:{inclusion}:{night}. */
  idempotencyKey: string;
  kind: 'room' | 'inclusion' | 'allowance' | 'added';
  nightDate: LocalDate;
  serviceDate: LocalDate;
  chargeCode: string;
  taxCategory: string;
  amount: MoneyDto;
  quantity: number;
  inclusionId: string | null;
  taxInclusion: TaxInclusion;
  occupancy: Occupancy;
  nightIndex: number;
  stayNights: number;
}

/**
 * Every charge to post for an agreed stay, from the snapshot alone. Taxes are computed at posting time with
 * `computeTaxes` for each line's tax point (rule versions in force then), never from current prices.
 */
export function postingPlan(terms: TermsSnapshot, stayId: string): PostingLine[] {
  const index = new Map(terms.nights.map((n, i) => [n.date, i]));
  const common = {
    taxInclusion: terms.taxInclusion,
    occupancy: terms.occupancy,
    stayNights: terms.stay.nights,
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
        kind: c.kind,
        nightDate: n.date,
        serviceDate,
        chargeCode: c.chargeCode,
        taxCategory: c.taxCategory,
        amount: c.amount,
        quantity: 1,
        inclusionId: c.inclusionId,
        nightIndex: index.get(n.date) ?? 0,
      });
    }
  }
  for (const a of terms.addedComponents) {
    out.push({
      ...common,
      idempotencyKey: `inclusion:${stayId}:${a.inclusionId}:${a.nightDate}`,
      kind: 'added',
      nightDate: a.nightDate,
      serviceDate: a.serviceDate,
      chargeCode: a.chargeCode,
      taxCategory: a.taxCategory,
      amount: a.amount,
      quantity: a.quantity,
      inclusionId: a.inclusionId,
      nightIndex: index.get(a.nightDate) ?? 0,
    });
  }
  return out;
}

/**
 * Payment schedule for agreed terms (spec proposed contract `instantiatePaymentSchedule`): from the snapshot's
 * deposit policy and agreed totals only. `bookingDate` defaults to the agreement's booking date.
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
  /** Current-rate drafts for the (new) unit type, keyed by night, plus why missing nights could not be priced. */
  current: { drafts: ReadonlyMap<LocalDate, NightDraft>; violations: Violation[] } | null;
  /** Current-rate drafts for the agreed unit type (type change with `difference`). */
  currentAgreedType: ReadonlyMap<LocalDate, NightDraft> | null;
  changeAt: Date;
  property: PropertyContext;
  taxRules: readonly LoadedTaxRule[];
  meta: { quoteId: string; quotedAt: string; configVector: string };
}

type Source = RepricingResult['nights'][number]['source'];

const sameOccupancy = (a: Occupancy, b: Occupancy) =>
  a.adults === b.adults &&
  JSON.stringify([...a.childrenAges].sort()) === JSON.stringify([...b.childrenAges].sort());

function noPrice(date: LocalDate, message: string): Violation {
  return { kind: 'no_price', date, message, required: null, actual: null, overridable: false, source: null };
}

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

export function reprice(input: RepriceInput): RepricingResult {
  const t = input.terms;
  const cur = t.currency;
  const agreed = new Map(t.nights.map((n) => [n.date, n]));
  const occChanged = !sameOccupancy(input.occupancy, t.occupancy);
  const typeChanged = input.unitTypeId !== t.unitTypeId;
  const violations: Violation[] = [];
  const drafts: NightDraft[] = [];
  const sources = new Map<LocalDate, Source>();
  const newDates = eachNight(input.range);
  const agreedTotal = t.nights.reduce((s, n) => s + n.amount.amountMinor, 0);
  const average = t.nights.length > 0 ? Math.round(agreedTotal / t.nights.length) : 0;
  const firstParams = t.nights[0]?.occupancyPricing;
  let manualUsed = false;

  for (const d of newDates) {
    const a = agreed.get(d);
    if (a) {
      let draft: NightDraft = {
        date: d,
        params: a.occupancyPricing,
        baseAmountMinor: a.baseAmount.amountMinor,
        effects: a.promotions,
        amountMinor: a.amount.amountMinor,
      };
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
    const newSet = new Set(
      newDates.filter((d) => !agreed.has(d) || (typeChanged && input.typeChangePolicy === 'reprice')),
    );
    for (const v of input.current.violations) if (v.date === null || newSet.has(v.date)) violations.push(v);
  }

  // Removed nights: cancellation tier in force before arrival, early-departure penalty after.
  const removed = t.nights.filter((n) => !newDates.includes(n.date));
  const penalties: RepricingResult['penalties'] = [];
  const cancel = t.policies.cancellation;
  if (removed.length > 0 && cancel) {
    const arrivalInstant = zonedInstant(t.stay.arrival, t.checkInTime, t.propertyTimezone);
    const basisAmounts = removed.map((n) => ({
      amountMinor: cancel.structure.basis === 'net' ? n.net.amountMinor : n.gross.amountMinor,
    }));
    if (input.changeAt < arrivalInstant) {
      const tier = tierInForce(cancel.tiers, input.changeAt);
      if (tier && tier.penalty.kind !== 'none') {
        penalties.push({
          kind: 'cancellation',
          nights: removed.map((n) => n.date),
          amount: { amountMinor: penaltyAmount(tier.penalty, basisAmounts), currency: cur },
          description: tier.description,
        });
      }
    } else if (cancel.structure.earlyDeparture.kind !== 'none') {
      penalties.push({
        kind: 'early_departure',
        nights: removed.map((n) => n.date),
        amount: { amountMinor: penaltyAmount(cancel.structure.earlyDeparture, basisAmounts), currency: cur },
        description: 'Early departure penalty from the agreed cancellation policy.',
      });
    }
  }

  const assembled = assemble({
    property: input.property,
    plan: {
      id: t.ratePlan.id,
      code: t.ratePlan.code,
      name: t.ratePlan.name,
      version: t.ratePlan.version,
      currency: cur,
      mealPlan: t.ratePlan.mealPlan,
      roomChargeCode: t.ratePlan.roomChargeCode,
      marketSegment: t.ratePlan.marketSegment,
      taxInclusion: t.taxInclusion,
      commission: t.commission ? (({ amount: _amount, ...c }) => c)(t.commission) : null,
      chain: t.ratePlan.derivationChain,
    },
    unitTypeId: input.unitTypeId,
    arrival: input.range.from,
    departure: input.range.to,
    bookingDate: t.bookingDate,
    occupancy: input.occupancy,
    bands: t.childAgeBands,
    drafts,
    inclusions: t.inclusions,
    promotions: t.promotions,
    policies: plannedPolicies(t),
    taxRules: input.taxRules,
    meta: {
      ...input.meta,
      priceSource: manualUsed ? 'manual_override' : t.priceSource,
      restrictionOverride: t.restrictionOverride,
      supersedesHash: t.hash,
    },
  });

  const after = new Map(assembled.nightly.map((n) => [n.date, n]));
  const allDates = [...new Set([...t.nights.map((n) => n.date), ...newDates])].sort();
  const nights: RepricingResult['nights'] = allDates.map((d) => {
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
    nights,
    penalties,
    before: t.totals,
    after: assembled.totals,
    difference: {
      amountMinor: assembled.totals.gross.amountMinor - t.totals.gross.amountMinor,
      currency: cur,
    },
    violations: [...violations, ...assembled.violations],
    candidateTerms: assembled.terms,
  };
}
