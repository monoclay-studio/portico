/**
 * The single tax & fee engine (RAT-R22..R24). Pure: no IO, no clock. Every tax, levy and service charge in
 * Portico — quotes, room postings, outlet charges, transfers — is computed here from effective-dated rule
 * DATA (never constants in code).
 *
 * Rounding rule (documented, single rounding per rule per line part):
 *  - Exclusive lines: rules are evaluated in compounding order. Each rule's amount is computed exactly with
 *    Decimal from its base and rounded ONCE to the line currency's minor unit with the rule's rounding mode.
 *    A compounding base uses the already-rounded amounts of the rules it includes (as printed on a bill:
 *    "TGST 17% on 110.00").
 *  - Inclusive lines: the exact net is solved from the compounding chain (each rule is affine in the net),
 *    rounded half-up, the included rules are evaluated as for an exclusive line, and the residue
 *    (amount − net − Σ included, ≤ 1 minor unit per included rule) is assigned to the NET; the displayed bases
 *    use the final net. Therefore net + Σ included = amount exactly.
 *  - `inclusive` mode includes VALUE-BASED rules only; quantity-based levies (per person / unit / stay / charge,
 *    e.g. Green Tax) are always added on top unless a line names them explicitly (`rules` mode). A free or
 *    complimentary night therefore never fails and still carries its per-guest levies.
 *  - Lines with `taxPointSplits` (e.g. a deposit taxed at payment): value-based rules round once per part;
 *    quantity-based levies are computed once for the whole line.
 *  - Line gross = net + Σ all rule amounts, exactly. Totals are sums of line values (never recomputed).
 *
 * Statutory vs commercial: statutory rules follow their tax point. Commercial (hotel-set) rules — service
 * charge, resort fees — are part of an agreement: a line posted under agreed terms (`agreedRuleVersionIds`) uses
 * exactly the agreed versions, so a later service-charge change never re-prices an agreed stay.
 */
import { currencyExponent, Decimal, type LocalDate, type Occupancy, ValidationError } from '@portico/kernel';
import type {
  ChargeLine,
  ClassificationCondition,
  ClassificationPredicate,
  FixedAmount,
  FxRate,
  LineTaxResult,
  TaxComputation,
  TaxInclusion,
  TaxLine,
  TaxPointPolicy,
  TaxRuleDefinition,
  VerificationStatus,
} from '../contracts';
import { TaxConfigurationError } from './errors';

export interface TaxRuleHeader {
  id: string;
  code: string;
  name: string;
  category: 'tax' | 'fee';
  nature: 'statutory' | 'commercial';
  taxPointPolicy: TaxPointPolicy;
  ledgerMappingKey: string;
  sequence: number;
}

export interface TaxRuleVersionData {
  id: string;
  effectiveFrom: LocalDate | null;
  effectiveTo: LocalDate | null;
  definition: TaxRuleDefinition;
  verificationStatus: VerificationStatus;
}

export interface LoadedTaxRule {
  rule: TaxRuleHeader;
  versions: TaxRuleVersionData[];
  /**
   * Versions pinned by id (audit recompute): chosen by start date only. A later activation that CLOSES a pinned
   * version (sets its effective_to) therefore never changes a historical recomputation (RAT-I05).
   */
  pinned?: boolean;
}

export type Classification = Record<string, string | number | boolean>;

export interface TaxEngineContext {
  classification: Classification;
  occupancy?: Occupancy | undefined;
  stayContext?:
    | { stayNights: number; arrival?: LocalDate | undefined; bookingDate?: LocalDate | undefined }
    | undefined;
  invoiceDate?: LocalDate | undefined;
  /** A payment covering every line in full (time of supply). Partial payments use ChargeLine.taxPointSplits. */
  fullPaymentDate?: LocalDate | undefined;
  /** Quote estimate of the invoice date (e.g. departure) when no invoice or payment exists yet. */
  expectedInvoiceDate?: LocalDate | undefined;
  fxRates?: readonly FxRate[];
  exemptionCertificates?: ReadonlyArray<{
    ruleCode: string;
    reference: string;
    validFrom: LocalDate;
    validTo: LocalDate;
  }>;
}

const ROUNDING = { half_up: Decimal.ROUND_HALF_UP, half_even: Decimal.ROUND_HALF_EVEN } as const;
const QUANTITY_KINDS = new Set(['per_person_night', 'per_unit_night', 'per_stay', 'fixed_per_charge']);
export const isQuantityBased = (kind: string) => QUANTITY_KINDS.has(kind);

// ───────────────────────────── Version selection ─────────────────────────────

export function versionEffectiveOn(
  versions: readonly TaxRuleVersionData[],
  date: LocalDate,
): TaxRuleVersionData | undefined {
  return versions.find(
    (v) =>
      (v.effectiveFrom === null || v.effectiveFrom <= date) &&
      (v.effectiveTo === null || date < v.effectiveTo),
  );
}

/** Pinned versions: the latest start on or before the date (end dates ignored). */
export function pinnedVersionOn(
  versions: readonly TaxRuleVersionData[],
  date: LocalDate,
): TaxRuleVersionData | undefined {
  let best: TaxRuleVersionData | undefined;
  for (const v of versions) {
    if (v.effectiveFrom !== null && v.effectiveFrom > date) continue;
    if (!best || (best.effectiveFrom ?? '') < (v.effectiveFrom ?? '')) best = v;
  }
  return best;
}

/**
 * The date that selects a rule's version, and whether it is an estimate. A line's fixed `taxPointDate` wins.
 * Otherwise by policy; when the deciding date is not known yet (a quote has no invoice or payment), the expected
 * invoice date (or the service date) is used and the tax line is flagged `estimated`.
 */
export function taxPointDate(
  policy: TaxPointPolicy,
  line: Pick<ChargeLine, 'serviceDate' | 'taxPointDate'>,
  ctx: Pick<TaxEngineContext, 'stayContext' | 'invoiceDate' | 'fullPaymentDate' | 'expectedInvoiceDate'>,
): { date: LocalDate; estimated: boolean } {
  if (line.taxPointDate) return { date: line.taxPointDate, estimated: false };
  const estimate = { date: ctx.expectedInvoiceDate ?? line.serviceDate, estimated: true };
  switch (policy) {
    case 'service_date':
      return { date: line.serviceDate, estimated: false };
    case 'booking_date':
      return ctx.stayContext?.bookingDate
        ? { date: ctx.stayContext.bookingDate, estimated: false }
        : { date: line.serviceDate, estimated: true };
    case 'invoice_date':
      return ctx.invoiceDate ? { date: ctx.invoiceDate, estimated: false } : estimate;
    case 'time_of_supply': {
      const known = [ctx.invoiceDate, ctx.fullPaymentDate].filter((d): d is LocalDate => !!d).sort();
      return known[0] ? { date: known[0], estimated: false } : estimate;
    }
  }
}

// ───────────────────────────── Applicability ─────────────────────────────

type Tri = true | false | 'unknown';

function evalCondition(c: ClassificationCondition, cls: Classification): Tri {
  if (!(c.key in cls)) return 'unknown';
  const v = cls[c.key];
  if (c.equals !== undefined && v !== c.equals) return false;
  if (c.in !== undefined && !c.in.includes(v as string | number | boolean)) return false;
  if (c.min !== undefined && !(typeof v === 'number' && v >= c.min)) return false;
  if (c.max !== undefined && !(typeof v === 'number' && v <= c.max)) return false;
  return true;
}

/** Three-valued: a missing classification key is 'unknown' unless the result is decided without it. */
export function evalClassification(
  p: ClassificationPredicate | undefined,
  cls: Classification,
): { result: Tri; missing: string[] } {
  if (!p) return { result: true, missing: [] };
  const missing: string[] = [];
  let all: Tri = true;
  for (const c of p.all ?? []) {
    const r = evalCondition(c, cls);
    if (r === 'unknown') missing.push(c.key);
    if (r === false) all = false;
    else if (r === 'unknown' && all === true) all = 'unknown';
  }
  let any: Tri = true;
  if (p.any && p.any.length > 0) {
    any = false;
    for (const c of p.any) {
      const r = evalCondition(c, cls);
      if (r === 'unknown') missing.push(c.key);
      if (r === true) any = true;
      else if (r === 'unknown' && any === false) any = 'unknown';
    }
  }
  if (all === false || any === false) return { result: false, missing: [] };
  if (all === 'unknown' || any === 'unknown') return { result: 'unknown', missing: [...new Set(missing)] };
  return { result: true, missing: [] };
}

interface Applicable {
  rule: TaxRuleHeader;
  version: TaxRuleVersionData;
  def: TaxRuleDefinition;
  pointDate: LocalDate;
  estimated: boolean;
}

type Adjustment = 'supply' | 'reversal' | 'price_adjustment';
const adjustmentOf = (line: ChargeLine): Adjustment =>
  line.adjustment ?? (line.amount.amountMinor < 0 ? 'price_adjustment' : 'supply');

function applicableRules(
  rules: readonly LoadedTaxRule[],
  line: ChargeLine,
  ctx: TaxEngineContext,
  exemptionsApplied: Array<{ ruleCode: string; reference: string }>,
  scope: { valueBased: boolean; quantityBased: boolean },
): Applicable[] {
  const out: Applicable[] = [];
  const adjustment = adjustmentOf(line);
  for (const { rule, versions, pinned } of rules) {
    const tp = taxPointDate(rule.taxPointPolicy, line, ctx);
    let version: TaxRuleVersionData | undefined;
    if (rule.nature === 'commercial' && line.agreedRuleVersionIds) {
      // Posted under agreed terms: only the agreed version of a hotel-set rule applies (never a later one).
      const agreed = versions.filter((v) => line.agreedRuleVersionIds?.includes(v.id));
      if (agreed.length === 0) continue;
      version = pinnedVersionOn(agreed, line.serviceDate) ?? agreed[0];
    } else {
      version = pinned ? pinnedVersionOn(versions, tp.date) : versionEffectiveOn(versions, tp.date);
    }
    if (!version) continue;
    const def = version.definition;
    const quantity = isQuantityBased(def.kind);
    if (quantity ? !scope.quantityBased : !scope.valueBased) continue;
    if (!quantity && line.levyOnly) continue;
    // A price rebate does not change how many guests stayed: per-guest levies are not touched.
    if (quantity && adjustment === 'price_adjustment') continue;
    if (!def.appliesTo.taxCategories.includes(line.taxCategory)) continue;
    if (
      def.appliesTo.outletKinds &&
      (!line.outletKind || !def.appliesTo.outletKinds.includes(line.outletKind))
    )
      continue;
    if (line.outletKind && def.appliesTo.excludeOutletKinds?.includes(line.outletKind)) continue;
    const cls = evalClassification(def.appliesTo.classification, ctx.classification);
    if (cls.result === 'unknown') {
      throw new TaxConfigurationError(
        'tax_classification_missing',
        `Tax rule ${rule.code} depends on the property classification ${cls.missing.join(', ')}, which is not set. Set it in the property settings so the rule can be applied correctly.`,
        { ruleCode: rule.code, missing: cls.missing },
      );
    }
    if (!cls.result) continue;
    const stayRange = def.appliesTo.stayNights;
    const longStay = def.exemptions.find((e) => e.kind === 'stay_nights_over');
    if (stayRange || longStay) {
      const n = ctx.stayContext?.stayNights;
      if (n === undefined) {
        throw new TaxConfigurationError(
          'tax_stay_context_required',
          `Tax rule ${rule.code} depends on the length of stay. Provide stayContext.stayNights for this charge.`,
          { ruleCode: rule.code },
        );
      }
      if (stayRange?.min !== undefined && n < stayRange.min) continue;
      if (stayRange?.max !== undefined && n > stayRange.max) continue;
      if (longStay && longStay.kind === 'stay_nights_over' && n > longStay.nights) continue;
    }
    if (def.caps?.maxNights !== undefined) {
      if (line.nightIndex === undefined) {
        throw new TaxConfigurationError(
          'tax_night_index_required',
          `Tax rule ${rule.code} applies only to the first ${def.caps.maxNights} nights of a stay. Provide nightIndex for this charge.`,
          { ruleCode: rule.code },
        );
      }
      if (line.nightIndex >= def.caps.maxNights) continue;
    }
    if (def.kind === 'per_stay' && line.nightIndex !== undefined && line.nightIndex !== 0) continue;
    if (def.exemptions.some((e) => e.kind === 'certificate')) {
      const cert = (ctx.exemptionCertificates ?? []).find(
        (c) => c.ruleCode === rule.code && c.validFrom <= tp.date && tp.date <= c.validTo,
      );
      if (cert) {
        exemptionsApplied.push({ ruleCode: rule.code, reference: cert.reference });
        continue;
      }
    }
    out.push({ rule, version, def, pointDate: tp.date, estimated: tp.estimated });
  }
  return orderForCompounding(out);
}

/** Dependencies (base.includeRuleCodes) first; ties by sequence then code. Cycles are configuration errors. */
export function orderForCompounding<
  T extends { rule: Pick<TaxRuleHeader, 'code' | 'sequence'>; def: Pick<TaxRuleDefinition, 'base'> },
>(items: readonly T[]): T[] {
  const byCode = new Map(items.map((i) => [i.rule.code, i]));
  const sorted = [...items].sort(
    (a, b) => a.rule.sequence - b.rule.sequence || a.rule.code.localeCompare(b.rule.code),
  );
  const done = new Set<string>();
  const out: T[] = [];
  const visit = (i: T, stack: string[]) => {
    if (done.has(i.rule.code)) return;
    if (stack.includes(i.rule.code)) {
      throw new TaxConfigurationError(
        'tax_compounding_cycle',
        `Tax rules form a compounding cycle (${[...stack, i.rule.code].join(' → ')}). Remove one of the base references.`,
        { cycle: [...stack, i.rule.code] },
      );
    }
    for (const dep of i.def.base.includeRuleCodes) {
      const d = byCode.get(dep);
      if (d) visit(d, [...stack, i.rule.code]);
    }
    done.add(i.rule.code);
    out.push(i);
  };
  for (const i of sorted) visit(i, []);
  return out;
}

// ───────────────────────────── Preparation (exact quantities) ─────────────────────────────

interface Prepared extends Applicable {
  included: boolean;
  /** Fixed total in minor units of the line currency (exact, unrounded) for quantity-based kinds. */
  fixedMinor: Decimal | null;
  fixedAmount: FixedAmount | null;
  fx: FxRate | null;
  /** Rate as a fraction for percentage rules. */
  rate: Decimal | null;
  /** Bands for banded rules: thresholds in line-currency minor units per unit-night. */
  bands: Array<{ upToMinor: Decimal | null; rate: Decimal }> | null;
  capMinor: Decimal | null;
  quantity: { persons: number; exemptPersons: number; nights: number; units: number } | null;
}

function toLineMinor(
  amount: FixedAmount,
  lineCurrency: string,
  fx: readonly FxRate[],
  ruleCode: string,
  pointDate: LocalDate,
): { minor: Decimal; fx: FxRate | null } {
  const scale = new Decimal(10).pow(currencyExponent(lineCurrency));
  const major = new Decimal(amount.value);
  if (amount.currency === lineCurrency) return { minor: major.mul(scale), fx: null };
  const pair = fx.filter((r) => r.from === amount.currency && r.to === lineCurrency);
  const rate = pair.find((r) => r.asOf === pointDate) ?? pair.find((r) => r.asOf === undefined);
  if (!rate) {
    if (pair.length > 0) {
      throw new TaxConfigurationError(
        'fx_rate_date_mismatch',
        `Tax rule ${ruleCode} needs the ${amount.currency}→${lineCurrency} rate for its tax point ${pointDate}; the rates provided are for other dates (${pair.map((r) => r.asOf).join(', ')}).`,
        { ruleCode, taxPointDate: pointDate },
      );
    }
    throw new TaxConfigurationError(
      'fx_rate_required',
      `Tax rule ${ruleCode} is a fixed ${amount.currency} amount but the charge is in ${lineCurrency}. Provide the ${amount.currency}→${lineCurrency} exchange rate (with its source and date) for the tax point.`,
      { ruleCode, from: amount.currency, to: lineCurrency },
    );
  }
  return { minor: major.mul(new Decimal(rate.rate)).mul(scale), fx: rate };
}

function personsFor(def: TaxRuleDefinition, occ: Occupancy): { persons: number; exempt: number } {
  const under = def.persons?.exemptChildrenUnderAge;
  const exempt = under === undefined ? 0 : occ.childrenAges.filter((a) => a < under).length;
  return { persons: occ.adults + occ.childrenAges.length - exempt, exempt };
}

function includedSet(inclusion: TaxInclusion, a: Applicable): boolean {
  switch (inclusion.mode) {
    case 'exclusive':
      return false;
    case 'inclusive':
      // Value-based rules only: quantity-based levies are added on top (never backed out of a price).
      return !isQuantityBased(a.def.kind);
    case 'rules':
      return inclusion.includedRuleCodes.includes(a.rule.code);
    case 'rule_default':
      return a.def.inclusiveDefault && !isQuantityBased(a.def.kind);
  }
}

function prepare(a: Applicable, line: ChargeLine, ctx: TaxEngineContext): Prepared {
  const fxRates = ctx.fxRates ?? [];
  const cur = line.amount.currency;
  const def = a.def;
  const nights = line.nights;
  const units = line.units;
  let fixedMinor: Decimal | null = null;
  let fx: FxRate | null = null;
  let quantity: Prepared['quantity'] = null;
  const fixed = () => {
    const r = toLineMinor(def.amount as FixedAmount, cur, fxRates, a.rule.code, a.pointDate);
    fx = r.fx;
    return r.minor;
  };
  if (def.kind === 'per_person_night') {
    const occ = line.occupancy ?? ctx.occupancy;
    if (!occ) {
      throw new TaxConfigurationError(
        'tax_occupancy_required',
        `Tax rule ${a.rule.code} is charged per person per night. Provide the occupancy (adults and children's ages) for this charge.`,
        { ruleCode: a.rule.code },
      );
    }
    const p = personsFor(def, occ);
    quantity = { persons: p.persons, exemptPersons: p.exempt, nights, units };
    fixedMinor = fixed().mul(p.persons).mul(nights);
  } else if (def.kind === 'per_unit_night') {
    quantity = { persons: 0, exemptPersons: 0, nights, units };
    fixedMinor = fixed().mul(units).mul(nights);
  } else if (def.kind === 'per_stay') {
    quantity = { persons: 0, exemptPersons: 0, nights: 1, units };
    fixedMinor = fixed().mul(units);
  } else if (def.kind === 'fixed_per_charge') {
    quantity = { persons: 0, exemptPersons: 0, nights: 0, units: line.quantity };
    fixedMinor = fixed().mul(line.quantity);
  }
  const rate = def.kind === 'percentage' ? new Decimal(def.ratePercent as string).div(100) : null;
  const bands =
    def.kind === 'banded'
      ? (def.bands ?? []).map((b) => ({
          upToMinor: b.upToPerUnitNight
            ? toLineMinor(b.upToPerUnitNight, cur, fxRates, a.rule.code, a.pointDate).minor
            : null,
          rate: new Decimal(b.ratePercent).div(100),
        }))
      : null;
  const capMinor = def.caps?.maxAmountPerLine
    ? toLineMinor(def.caps.maxAmountPerLine, cur, fxRates, a.rule.code, a.pointDate).minor
    : null;
  return {
    ...a,
    included: includedSet(line.taxInclusion, a),
    fixedMinor,
    fixedAmount: fixedMinor !== null ? (def.amount as FixedAmount) : null,
    fx,
    rate,
    bands,
    capMinor,
    quantity,
  };
}

function bandRate(p: Prepared, netMinor: Decimal, line: ChargeLine): Decimal {
  const perUnitNight = netMinor.div(line.units * line.nights);
  for (const b of p.bands ?? []) if (b.upToMinor === null || perUnitNight.lte(b.upToMinor)) return b.rate;
  const last = p.bands?.[p.bands.length - 1];
  return last ? last.rate : new Decimal(0);
}

// ───────────────────────────── Evaluation ─────────────────────────────

function roundRule(p: Prepared, exact: Decimal): Decimal {
  return exact.toDecimalPlaces(0, ROUNDING[p.def.rounding.mode]);
}

function baseOf(p: Prepared, net: Decimal, amounts: ReadonlyMap<string, Decimal>): Decimal {
  let base = p.def.base.includeNet ? net : new Decimal(0);
  for (const code of p.def.base.includeRuleCodes) base = base.plus(amounts.get(code) ?? 0);
  return base;
}

/** Evaluate rules on a known net, using rounded amounts of earlier rules in compounding bases. */
function evaluate(
  prepared: readonly Prepared[],
  net: Decimal,
  line: ChargeLine,
  amounts: Map<string, Decimal>,
): void {
  for (const p of prepared) {
    let amount: Decimal;
    if (p.fixedMinor !== null) {
      amount = roundRule(p, p.fixedMinor);
    } else {
      const rate = p.rate ?? bandRate(p, net, line);
      amount = roundRule(p, baseOf(p, net, amounts).mul(rate));
    }
    if (p.capMinor !== null) {
      const cap = roundRule(p, p.capMinor);
      if (amount.gt(cap)) amount = cap;
    }
    amounts.set(p.rule.code, amount);
  }
}

/**
 * Solve the exact net for an inclusive amount: every included rule is affine in the net (a·net + b), so
 * amount = net·(1 + Σa) + Σb. Caps and bands are handled by fixing / enumerating and re-solving.
 */
function solveInclusiveNet(included: readonly Prepared[], gross: Decimal, line: ChargeLine): Decimal {
  const banded = included.filter((p) => p.bands !== null);
  const choices: Array<Map<string, number>> = [new Map()];
  for (const b of banded) {
    const next: Array<Map<string, number>> = [];
    for (const c of choices)
      for (let i = 0; i < (b.bands?.length ?? 0); i++) next.push(new Map([...c, [b.rule.code, i]]));
    choices.splice(0, choices.length, ...next);
  }
  for (const choice of choices) {
    const capped = new Set<string>();
    for (let iter = 0; iter <= included.length; iter++) {
      const coeff = new Map<string, { a: Decimal; b: Decimal }>();
      let sumA = new Decimal(0);
      let sumB = new Decimal(0);
      for (const p of included) {
        let a = new Decimal(0);
        let b = new Decimal(0);
        if (capped.has(p.rule.code) && p.capMinor !== null) {
          b = p.capMinor;
        } else if (p.fixedMinor !== null) {
          b = p.fixedMinor;
        } else {
          const rate = p.rate ?? (p.bands?.[choice.get(p.rule.code) ?? 0]?.rate as Decimal);
          let baseA = new Decimal(p.def.base.includeNet ? 1 : 0);
          let baseB = new Decimal(0);
          for (const code of p.def.base.includeRuleCodes) {
            const c = coeff.get(code);
            if (c) {
              baseA = baseA.plus(c.a);
              baseB = baseB.plus(c.b);
            }
          }
          a = rate.mul(baseA);
          b = rate.mul(baseB);
        }
        coeff.set(p.rule.code, { a, b });
        sumA = sumA.plus(a);
        sumB = sumB.plus(b);
      }
      const net = gross.minus(sumB).div(sumA.plus(1));
      let newlyCapped = false;
      for (const p of included) {
        const c = coeff.get(p.rule.code);
        if (p.capMinor !== null && c && !capped.has(p.rule.code) && c.a.mul(net).plus(c.b).gt(p.capMinor)) {
          capped.add(p.rule.code);
          newlyCapped = true;
        }
      }
      if (newlyCapped) continue;
      const consistent = banded.every((p) => {
        const idx = choice.get(p.rule.code) ?? 0;
        const perUnitNight = net.div(line.units * line.nights);
        const upper = p.bands?.[idx]?.upToMinor ?? null;
        const lower = idx > 0 ? (p.bands?.[idx - 1]?.upToMinor ?? null) : null;
        return (upper === null || perUnitNight.lte(upper)) && (lower === null || perUnitNight.gt(lower));
      });
      if (consistent) return net;
      break;
    }
  }
  throw new TaxConfigurationError(
    'inclusive_price_in_band_gap',
    `The tax-inclusive amount on line ${line.lineId} cannot be produced by any tax band (it falls in the gap where the rate changes). Adjust the price or quote it tax-exclusive.`,
    { lineId: line.lineId },
  );
}

function money(amountMinor: Decimal | number, currency: string) {
  const n = typeof amountMinor === 'number' ? amountMinor : amountMinor.toNumber();
  if (!Number.isSafeInteger(n))
    throw new TaxConfigurationError('amount_out_of_range', `Amount ${n} is out of range.`, {});
  return { amountMinor: n === 0 ? 0 : n, currency };
}

/** One line (or one tax-point part of a line), restricted to value- and/or quantity-based rules. */
function computeSingle(
  rules: readonly LoadedTaxRule[],
  line: ChargeLine,
  ctx: TaxEngineContext,
  scope: { valueBased: boolean; quantityBased: boolean },
): LineTaxResult {
  const exemptionsApplied: Array<{ ruleCode: string; reference: string }> = [];
  const applicable = applicableRules(rules, line, ctx, exemptionsApplied, scope);
  const prepared = applicable.map((a) => prepare(a, line, ctx));
  // inclusive / rule_default: a rule included in the price pulls the rules its base compounds on into the price
  // too (e.g. a levy that a percentage tax is computed on). `rules` mode stays exactly as listed.
  if (line.taxInclusion.mode === 'inclusive' || line.taxInclusion.mode === 'rule_default') {
    const byCode = new Map(prepared.map((p) => [p.rule.code, p]));
    for (let changed = true; changed; ) {
      changed = false;
      for (const p of prepared) {
        if (!p.included) continue;
        for (const code of p.def.base.includeRuleCodes) {
          const dep = byCode.get(code);
          if (dep && !dep.included) {
            dep.included = true;
            changed = true;
          }
        }
      }
    }
  }
  const cur = line.amount.currency;
  const adjustment = adjustmentOf(line);
  const sign = adjustment === 'reversal' || line.amount.amountMinor < 0 ? -1 : 1;
  const absAmount = new Decimal(Math.abs(line.amount.amountMinor));

  const included = prepared.filter((p) => p.included);
  const excluded = prepared.filter((p) => !p.included);
  const excludedCodes = new Set(excluded.map((p) => p.rule.code));
  for (const p of included) {
    const bad = p.def.base.includeRuleCodes.find((c) => excludedCodes.has(c));
    if (bad) {
      throw new TaxConfigurationError(
        'inconsistent_tax_inclusion',
        `Line ${line.lineId}: ${p.rule.code} is included in the price but its base includes ${bad}, which is not. Include both or neither.`,
        { lineId: line.lineId, rule: p.rule.code, dependsOn: bad },
      );
    }
  }

  const amounts = new Map<string, Decimal>();
  let net: Decimal;
  let residue = new Decimal(0);
  if (included.length === 0) {
    net = absAmount;
  } else {
    const exactNet = solveInclusiveNet(included, absAmount, line);
    if (exactNet.isNegative()) {
      throw new TaxConfigurationError(
        'inclusive_amount_below_fixed_taxes',
        `Line ${line.lineId}: the tax-inclusive amount is smaller than the fixed taxes and fees it must include. Raise the price, or include only value-based taxes (inclusive mode) so levies are added on top.`,
        { lineId: line.lineId },
      );
    }
    const n0 = exactNet.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    evaluate(included, n0, line, amounts);
    let sumIncluded = new Decimal(0);
    for (const p of included) sumIncluded = sumIncluded.plus(amounts.get(p.rule.code) as Decimal);
    residue = absAmount.minus(n0).minus(sumIncluded);
    net = n0.plus(residue);
  }
  evaluate(excluded, net, line, amounts);

  const taxes: TaxLine[] = prepared.map((p) => {
    const quantityBased = p.fixedMinor !== null;
    return {
      lineId: line.lineId,
      ruleId: p.rule.id,
      ruleCode: p.rule.code,
      ruleName: p.rule.name,
      ruleVersionId: p.version.id,
      category: p.rule.category,
      nature: p.rule.nature,
      basis: p.def.kind,
      inclusive: p.included,
      // Displayed bases use the final net (after the inclusive residue).
      base: quantityBased ? null : money(baseOf(p, net, amounts).mul(sign), cur),
      ratePercent:
        p.rate !== null
          ? p.rate.mul(100).toString()
          : p.bands !== null
            ? bandRate(p, net, line).mul(100).toString()
            : null,
      quantity: p.quantity,
      fixedAmount: p.fixedAmount,
      fx: p.fx,
      amount: money((amounts.get(p.rule.code) as Decimal).mul(sign), cur),
      ledgerMappingKey: p.rule.ledgerMappingKey,
      verificationStatus: p.version.verificationStatus,
      taxPointDate: p.pointDate,
      estimated: p.estimated,
    };
  });
  const netMoney = money(net.mul(sign), cur);
  const gross = taxes.reduce((s, t) => s + t.amount.amountMinor, netMoney.amountMinor);
  return {
    lineId: line.lineId,
    net: netMoney,
    taxes,
    gross: money(gross, cur),
    roundingResidueMinor: residue.mul(sign).toNumber() || 0,
    exemptionsApplied,
  };
}

/** A line whose amount is partly taxed already (deposit parts with their own tax points). */
function computeSplitLine(
  rules: readonly LoadedTaxRule[],
  line: ChargeLine,
  ctx: TaxEngineContext,
): LineTaxResult {
  const splits = line.taxPointSplits ?? [];
  const total = line.amount.amountMinor;
  const fixedPart = splits.reduce((s, x) => s + x.amountMinor, 0);
  if (total < 0 || fixedPart > total || line.adjustment === 'reversal') {
    throw new ValidationError(
      'invalid_tax_point_splits',
      `Line ${line.lineId}: the parts with a fixed tax point (${fixedPart}) must not exceed the line amount (${total}), and only supplies can be split.`,
      { lineId: line.lineId },
    );
  }
  const { taxPointSplits: _splits, ...whole } = line;
  const parts: Array<{ amountMinor: number; taxPointDate?: LocalDate }> = [
    ...splits,
    ...(total - fixedPart > 0 ? [{ amountMinor: total - fixedPart }] : []),
  ];
  const valueResults = parts.map((part) => {
    const sub: ChargeLine = {
      ...whole,
      amount: { amountMinor: part.amountMinor, currency: line.amount.currency },
    };
    if (part.taxPointDate) sub.taxPointDate = part.taxPointDate;
    return computeSingle(rules, sub, ctx, { valueBased: true, quantityBased: false });
  });
  const levies = computeSingle(rules, whole, ctx, { valueBased: false, quantityBased: true });
  if (levies.taxes.some((t) => t.inclusive)) {
    throw new TaxConfigurationError(
      'split_with_included_levies',
      `Line ${line.lineId}: a line with tax-point parts cannot include per-guest or fixed levies in its price. Add them on top.`,
      { lineId: line.lineId },
    );
  }
  const cur = line.amount.currency;
  const net = valueResults.reduce((s, r) => s + r.net.amountMinor, 0);
  const taxes = [...valueResults.flatMap((r) => r.taxes), ...levies.taxes];
  const exemptions = [...valueResults.flatMap((r) => r.exemptionsApplied), ...levies.exemptionsApplied];
  return {
    lineId: line.lineId,
    net: money(net, cur),
    taxes,
    gross: money(
      taxes.reduce((s, t) => s + t.amount.amountMinor, net),
      cur,
    ),
    roundingResidueMinor: valueResults.reduce((s, r) => s + r.roundingResidueMinor, 0),
    exemptionsApplied: exemptions.filter(
      (e, i) => exemptions.findIndex((x) => x.ruleCode === e.ruleCode) === i,
    ),
  };
}

/** Compute taxes for one line. */
export function computeLine(
  rules: readonly LoadedTaxRule[],
  line: ChargeLine,
  ctx: TaxEngineContext,
): LineTaxResult {
  if (line.taxPointSplits && line.taxPointSplits.length > 0) return computeSplitLine(rules, line, ctx);
  return computeSingle(rules, line, ctx, { valueBased: true, quantityBased: true });
}

/** Compute taxes for many lines. All lines must share one currency (totals are in it). */
export function computeTaxesPure(
  rules: readonly LoadedTaxRule[],
  lines: readonly ChargeLine[],
  ctx: TaxEngineContext,
): TaxComputation {
  const currency = lines[0]?.amount.currency ?? 'USD';
  if (lines.some((l) => l.amount.currency !== currency)) {
    throw new TaxConfigurationError(
      'mixed_currencies',
      'All charge lines in one tax computation must use the same currency. Split the request by currency.',
      {},
    );
  }
  const ids = new Set<string>();
  for (const l of lines) {
    if (ids.has(l.lineId))
      throw new TaxConfigurationError(
        'duplicate_line_id',
        `Line id ${l.lineId} is used twice. Line ids must be unique.`,
        {},
      );
    ids.add(l.lineId);
  }
  const results = lines.map((l) => computeLine(rules, l, ctx));
  let net = 0;
  let taxes = 0;
  let fees = 0;
  const versionIds = new Set<string>();
  for (const r of results) {
    net += r.net.amountMinor;
    for (const t of r.taxes) {
      if (t.category === 'tax') taxes += t.amount.amountMinor;
      else fees += t.amount.amountMinor;
      versionIds.add(t.ruleVersionId);
    }
  }
  return {
    lines: results,
    totals: {
      net: money(net, currency),
      taxes: money(taxes, currency),
      fees: money(fees, currency),
      gross: money(net + taxes + fees, currency),
    },
    ruleVersionIds: [...versionIds].sort(),
  };
}

// ───────────────────────────── Green Tax 24-hour blocks ─────────────────────────────

/**
 * Guest-days for a per-guest-per-day levy charged in 24-hour blocks from actual check-in (MIRA Green Tax FAQ):
 * every full block counts, and the final (check-out) block counts when at least `minHoursLastBlock` hours were
 * spent in it. Day use (< 24 h) counts one day only when it reaches the threshold — adviser to confirm (README).
 */
export function levyDays(
  checkInAt: Date,
  checkOutAt: Date,
  minHoursLastBlock = 12,
): { days: number; fullBlocks: number; lastBlockHours: number } {
  const ms = checkOutAt.getTime() - checkInAt.getTime();
  if (!(ms > 0)) {
    throw new ValidationError('invalid_stay_times', 'Check-out must be after check-in to count levy days.');
  }
  const hours = ms / 3_600_000;
  const fullBlocks = Math.floor(hours / 24);
  const lastBlockHours = Math.round((hours - fullBlocks * 24) * 100) / 100;
  return { days: fullBlocks + (lastBlockHours >= minHoursLastBlock ? 1 : 0), fullBlocks, lastBlockHours };
}
