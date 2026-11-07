/**
 * The single tax & fee engine (RAT-R22..R24). Pure: no IO, no clock. Every tax, levy and service charge in
 * Portico — quotes, room postings, outlet charges, transfers — is computed here from effective-dated rule
 * DATA (never constants in code).
 *
 * Rounding rule (documented, single rounding per rule per line):
 *  - Exclusive lines: rules are evaluated in compounding order. Each rule's amount is computed exactly with
 *    Decimal from its base and rounded ONCE to the line currency's minor unit with the rule's rounding mode.
 *    A compounding base uses the already-rounded amounts of the rules it includes (as printed on a bill:
 *    "TGST 17% on 110.00").
 *  - Inclusive lines (amount includes some or all rules): the exact net is solved from the compounding chain
 *    (each rule is affine in the net), rounded half-up to a minor unit, the included rules are then evaluated
 *    exactly as for an exclusive line, and the residue (amount − net − Σ included rules, usually 0 or ±1 minor
 *    unit) is assigned to the NET. Therefore net + Σ included = amount exactly.
 *  - Line gross = net + Σ all rule amounts, exactly. Totals are sums of line values (never recomputed).
 */
import { currencyExponent, Decimal, type LocalDate, type Occupancy } from '@portico/kernel';
import type {
  ChargeLine,
  ClassificationCondition,
  ClassificationPredicate,
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
}

export type Classification = Record<string, string | number | boolean>;

export interface TaxEngineContext {
  classification: Classification;
  occupancy?: Occupancy | undefined;
  stayContext?: { stayNights: number; arrival?: LocalDate | undefined; bookingDate?: LocalDate | undefined } | undefined;
  invoiceDate?: LocalDate | undefined;
  paymentDate?: LocalDate | undefined;
  fxRates?: readonly FxRate[];
  exemptionCertificates?: ReadonlyArray<{ ruleCode: string; reference: string; validFrom: LocalDate; validTo: LocalDate }>;
}

const ROUNDING = { half_up: Decimal.ROUND_HALF_UP, half_even: Decimal.ROUND_HALF_EVEN } as const;

// ───────────────────────────── Version selection ─────────────────────────────

export function versionEffectiveOn(versions: readonly TaxRuleVersionData[], date: LocalDate): TaxRuleVersionData | undefined {
  return versions.find(
    (v) => (v.effectiveFrom === null || v.effectiveFrom <= date) && (v.effectiveTo === null || date < v.effectiveTo),
  );
}

/**
 * The date that selects a rule's version. A line's fixed `taxPointDate` wins (amount already taxed, e.g. a
 * deposit at payment). Otherwise by policy; when the deciding date is not known yet (a quote has no invoice or
 * payment), the service date is used as the estimate and reported on the tax line.
 */
export function taxPointDate(
  policy: TaxPointPolicy,
  line: Pick<ChargeLine, 'serviceDate' | 'taxPointDate'>,
  ctx: Pick<TaxEngineContext, 'stayContext' | 'invoiceDate' | 'paymentDate'>,
): LocalDate {
  if (line.taxPointDate) return line.taxPointDate;
  if (policy === 'booking_date') return ctx.stayContext?.bookingDate ?? line.serviceDate;
  if (policy === 'invoice_date') return ctx.invoiceDate ?? line.serviceDate;
  if (policy === 'time_of_supply') {
    const known = [ctx.invoiceDate, ctx.paymentDate].filter((d): d is LocalDate => !!d).sort();
    return known[0] ?? line.serviceDate;
  }
  return line.serviceDate;
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
export function evalClassification(p: ClassificationPredicate | undefined, cls: Classification): { result: Tri; missing: string[] } {
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
}

function applicableRules(
  rules: readonly LoadedTaxRule[],
  line: ChargeLine,
  ctx: TaxEngineContext,
  exemptionsApplied: Array<{ ruleCode: string; reference: string }>,
): Applicable[] {
  const out: Applicable[] = [];
  for (const { rule, versions } of rules) {
    const pointDate = taxPointDate(rule.taxPointPolicy, line, ctx);
    const version = versionEffectiveOn(versions, pointDate);
    if (!version) continue;
    const def = version.definition;
    if (!def.appliesTo.taxCategories.includes(line.taxCategory)) continue;
    if (def.appliesTo.outletKinds && (!line.outletKind || !def.appliesTo.outletKinds.includes(line.outletKind)))
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
        (c) => c.ruleCode === rule.code && c.validFrom <= pointDate && pointDate <= c.validTo,
      );
      if (cert) {
        exemptionsApplied.push({ ruleCode: rule.code, reference: cert.reference });
        continue;
      }
    }
    out.push({ rule, version, def, pointDate });
  }
  return orderForCompounding(out);
}

/** Dependencies (base.includeRuleCodes) first; ties by sequence then code. Cycles are configuration errors. */
export function orderForCompounding<T extends { rule: Pick<TaxRuleHeader, 'code' | 'sequence'>; def: Pick<TaxRuleDefinition, 'base'> }>(
  items: readonly T[],
): T[] {
  const byCode = new Map(items.map((i) => [i.rule.code, i]));
  const sorted = [...items].sort((a, b) => a.rule.sequence - b.rule.sequence || a.rule.code.localeCompare(b.rule.code));
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
  /** Fixed total in minor units of the line currency (exact, unrounded) for fixed kinds. */
  fixedMinor: Decimal | null;
  /** Rate as a fraction for percentage rules. */
  rate: Decimal | null;
  /** Bands for banded rules: thresholds in line-currency minor units per unit-night. */
  bands: Array<{ upToMinor: Decimal | null; rate: Decimal }> | null;
  capMinor: Decimal | null;
  quantity: { persons: number; nights: number; units: number } | null;
}

function toLineMinor(amount: { value: string; currency: string }, lineCurrency: string, fx: readonly FxRate[], ruleCode: string): Decimal {
  const major = new Decimal(amount.value);
  if (amount.currency === lineCurrency) return major.mul(new Decimal(10).pow(currencyExponent(lineCurrency)));
  const rate = fx.find((r) => r.from === amount.currency && r.to === lineCurrency);
  if (!rate) {
    throw new TaxConfigurationError(
      'fx_rate_required',
      `Tax rule ${ruleCode} is a fixed ${amount.currency} amount but the charge is in ${lineCurrency}. Provide the ${amount.currency}→${lineCurrency} exchange rate for the business date.`,
      { ruleCode, from: amount.currency, to: lineCurrency },
    );
  }
  return major.mul(new Decimal(rate.rate)).mul(new Decimal(10).pow(currencyExponent(lineCurrency)));
}

function personsFor(def: TaxRuleDefinition, occ: Occupancy): number {
  const under = def.persons?.exemptChildrenUnderAge;
  const children = under === undefined ? occ.childrenAges.length : occ.childrenAges.filter((a) => a >= under).length;
  return occ.adults + children;
}

function includedSet(inclusion: TaxInclusion, a: Applicable): boolean {
  switch (inclusion.mode) {
    case 'exclusive':
      return false;
    case 'inclusive':
      return true;
    case 'rules':
      return inclusion.includedRuleCodes.includes(a.rule.code);
    case 'rule_default':
      return a.def.inclusiveDefault;
  }
}

function prepare(a: Applicable, line: ChargeLine, ctx: TaxEngineContext): Prepared {
  const fx = ctx.fxRates ?? [];
  const cur = line.amount.currency;
  const def = a.def;
  const nights = line.nights;
  const units = line.units;
  let fixedMinor: Decimal | null = null;
  let quantity: Prepared['quantity'] = null;
  if (def.kind === 'per_person_night') {
    const occ = line.occupancy ?? ctx.occupancy;
    if (!occ) {
      throw new TaxConfigurationError(
        'tax_occupancy_required',
        `Tax rule ${a.rule.code} is charged per person per night. Provide the occupancy (adults and children's ages) for this charge.`,
        { ruleCode: a.rule.code },
      );
    }
    const persons = personsFor(def, occ);
    quantity = { persons, nights, units };
    fixedMinor = toLineMinor(def.amount as { value: string; currency: string }, cur, fx, a.rule.code).mul(persons).mul(nights);
  } else if (def.kind === 'per_unit_night') {
    quantity = { persons: 0, nights, units };
    fixedMinor = toLineMinor(def.amount as { value: string; currency: string }, cur, fx, a.rule.code).mul(units).mul(nights);
  } else if (def.kind === 'per_stay') {
    quantity = { persons: 0, nights: 1, units };
    fixedMinor = toLineMinor(def.amount as { value: string; currency: string }, cur, fx, a.rule.code).mul(units);
  } else if (def.kind === 'fixed_per_charge') {
    quantity = { persons: 0, nights: 0, units: line.quantity };
    fixedMinor = toLineMinor(def.amount as { value: string; currency: string }, cur, fx, a.rule.code).mul(line.quantity);
  }
  const rate = def.kind === 'percentage' ? new Decimal(def.ratePercent as string).div(100) : null;
  const bands =
    def.kind === 'banded'
      ? (def.bands ?? []).map((b) => ({
          upToMinor: b.upToPerUnitNight ? toLineMinor(b.upToPerUnitNight, cur, fx, a.rule.code) : null,
          rate: new Decimal(b.ratePercent).div(100),
        }))
      : null;
  const capMinor = def.caps?.maxAmountPerLine ? toLineMinor(def.caps.maxAmountPerLine, cur, fx, a.rule.code) : null;
  return { ...a, included: includedSet(line.taxInclusion, a), fixedMinor, rate, bands, capMinor, quantity };
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

/** Evaluate rules on a known net, using rounded amounts of earlier rules in compounding bases. */
function evaluate(
  prepared: readonly Prepared[],
  net: Decimal,
  line: ChargeLine,
  amounts: Map<string, Decimal>,
  bases: Map<string, Decimal>,
): void {
  for (const p of prepared) {
    let amount: Decimal;
    if (p.fixedMinor !== null) {
      amount = roundRule(p, p.fixedMinor);
      bases.set(p.rule.code, net);
    } else {
      let base = p.def.base.includeNet ? net : new Decimal(0);
      for (const code of p.def.base.includeRuleCodes) base = base.plus(amounts.get(code) ?? 0);
      const rate = p.rate ?? bandRate(p, net, line);
      amount = roundRule(p, base.mul(rate));
      bases.set(p.rule.code, base);
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
      // Band consistency: the solved net must fall in every chosen band.
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
  if (!Number.isSafeInteger(n)) throw new TaxConfigurationError('amount_out_of_range', `Amount ${n} is out of range.`, {});
  return { amountMinor: n === 0 ? 0 : n, currency };
}

/** Compute taxes for one line. */
export function computeLine(rules: readonly LoadedTaxRule[], line: ChargeLine, ctx: TaxEngineContext): LineTaxResult {
  const exemptionsApplied: Array<{ ruleCode: string; reference: string }> = [];
  const applicable = applicableRules(rules, line, ctx, exemptionsApplied);
  const prepared = applicable.map((a) => prepare(a, line, ctx));
  const cur = line.amount.currency;
  const sign = line.amount.amountMinor < 0 ? -1 : 1;
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
  const bases = new Map<string, Decimal>();
  let net: Decimal;
  let residue = new Decimal(0);
  if (included.length === 0) {
    net = absAmount;
  } else {
    const exactNet = solveInclusiveNet(included, absAmount, line);
    if (exactNet.isNegative()) {
      throw new TaxConfigurationError(
        'inclusive_amount_below_fixed_taxes',
        `Line ${line.lineId}: the tax-inclusive amount is smaller than the fixed taxes and fees it must include. Raise the price or quote it tax-exclusive.`,
        { lineId: line.lineId },
      );
    }
    const n0 = exactNet.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    evaluate(included, n0, line, amounts, bases);
    let sumIncluded = new Decimal(0);
    for (const p of included) sumIncluded = sumIncluded.plus(amounts.get(p.rule.code) as Decimal);
    residue = absAmount.minus(n0).minus(sumIncluded);
    net = n0.plus(residue);
  }
  evaluate(excluded, net, line, amounts, bases);

  const taxes: TaxLine[] = prepared.map((p) => ({
    lineId: line.lineId,
    ruleId: p.rule.id,
    ruleCode: p.rule.code,
    ruleName: p.rule.name,
    ruleVersionId: p.version.id,
    category: p.rule.category,
    kind: p.def.kind,
    inclusive: p.included,
    base: money((bases.get(p.rule.code) as Decimal).mul(sign), cur),
    ratePercent:
      p.rate !== null
        ? p.rate.mul(100).toString()
        : p.bands !== null
          ? bandRate(p, net, line).mul(100).toString()
          : null,
    quantity: p.quantity,
    amount: money((amounts.get(p.rule.code) as Decimal).mul(sign), cur),
    ledgerMappingKey: p.rule.ledgerMappingKey,
    verificationStatus: p.version.verificationStatus,
    taxPointDate: p.pointDate,
  }));
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
      throw new TaxConfigurationError('duplicate_line_id', `Line id ${l.lineId} is used twice. Line ids must be unique.`, {});
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
