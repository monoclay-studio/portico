/**
 * Inclusions, allowances and meal plans (pure, RAT-R13..R16). An inclusion is either allocated out of the
 * night price ("included" — revenue split) or charged on top ("added"). Allowances additionally carry an
 * entitlement (monetary or quantity per night/stay) that finance consumes and closes with the remainder policy.
 */
import { addDays, Decimal, type LocalDate, type Occupancy } from '@portico/kernel';
import type { AllowanceEntitlement, InclusionSnapshot, Violation } from '../contracts';
import type { ChildAgeBand } from './pricing';

export interface InclusionOccurrence {
  inclusion: InclusionSnapshot;
  serviceDate: LocalDate;
  /** The night the occurrence belongs to (allocation source for included components). */
  nightDate: LocalDate;
  quantity: number;
  amountMinor: number;
}

export interface InclusionOutcome {
  /** Included allocations per night. */
  included: Map<LocalDate, InclusionOccurrence[]>;
  added: InclusionOccurrence[];
  allowances: AllowanceEntitlement[];
  violations: Violation[];
}

function occurrences(inc: InclusionSnapshot, nights: readonly LocalDate[], departure: LocalDate): Array<{ serviceDate: LocalDate; nightDate: LocalDate }> {
  const first = nights[0] as LocalDate;
  const last = nights[nights.length - 1] as LocalDate;
  let out: Array<{ serviceDate: LocalDate; nightDate: LocalDate }>;
  switch (inc.rhythm.kind) {
    case 'nightly':
      out = nights.map((d) => ({ serviceDate: d, nightDate: d }));
      break;
    case 'arrival':
      out = [{ serviceDate: first, nightDate: first }];
      break;
    case 'departure':
      out = [{ serviceDate: departure, nightDate: last }];
      break;
    case 'days_of_stay': {
      const wanted = inc.rhythm.nights;
      out = nights.filter((_, i) => wanted.includes(i + 1)).map((d) => ({ serviceDate: d, nightDate: d }));
      break;
    }
  }
  return inc.basis === 'per_stay' ? out.slice(0, 1) : out;
}

function childrenInBands(occ: Occupancy, bands: readonly ChildAgeBand[]): Array<{ age: number; band: string | null }> {
  const maxAge = bands.reduce((m, b) => Math.max(m, b.maxAge), -1);
  return occ.childrenAges
    .filter((a) => a <= maxAge)
    .map((age) => ({ age, band: bands.find((b) => age >= b.minAge && age <= b.maxAge)?.code ?? null }));
}

function quantityFor(inc: InclusionSnapshot, occ: Occupancy, bands: readonly ChildAgeBand[]): number {
  const children = childrenInBands(occ, bands).length;
  const adults = occ.adults + (occ.childrenAges.length - children);
  switch (inc.basis) {
    case 'per_unit':
    case 'per_stay':
      return 1;
    case 'per_person':
      return adults + children;
    case 'per_adult':
      return adults;
    case 'per_child':
      return children;
  }
}

function amountFor(inc: InclusionSnapshot, occ: Occupancy, bands: readonly ChildAgeBand[], nightAmountMinor: number, quantity: number): number {
  const p = inc.pricing;
  if (p.kind === 'percent_of_night') {
    return new Decimal(nightAmountMinor).mul(p.percent).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  }
  if (inc.basis === 'per_child' && p.childBandAmountsMinor) {
    return childrenInBands(occ, bands).reduce((s, c) => s + (p.childBandAmountsMinor?.[c.band ?? ''] ?? p.amountMinor), 0);
  }
  return p.amountMinor * quantity;
}

export function computeInclusions(input: {
  inclusions: readonly InclusionSnapshot[];
  nights: ReadonlyArray<{ date: LocalDate; amountMinor: number }>;
  departure: LocalDate;
  occupancy: Occupancy;
  bands: readonly ChildAgeBand[];
  currency: string;
}): InclusionOutcome {
  const nightDates = input.nights.map((n) => n.date);
  const nightAmount = new Map(input.nights.map((n) => [n.date, n.amountMinor]));
  const included = new Map<LocalDate, InclusionOccurrence[]>();
  const added: InclusionOccurrence[] = [];
  const allowances: AllowanceEntitlement[] = [];
  const violations: Violation[] = [];
  if (nightDates.length === 0) return { included, added, allowances, violations };
  for (const inc of input.inclusions) {
    const quantity = quantityFor(inc, input.occupancy, input.bands);
    for (const o of occurrences(inc, nightDates, input.departure)) {
      if (quantity === 0 && inc.pricing.kind === 'fixed') continue;
      const amountMinor = amountFor(inc, input.occupancy, input.bands, nightAmount.get(o.nightDate) ?? 0, quantity);
      const occ: InclusionOccurrence = { inclusion: inc, ...o, quantity, amountMinor };
      if (inc.priceMode === 'included') included.set(o.nightDate, [...(included.get(o.nightDate) ?? []), occ]);
      else added.push(occ);
    }
    if (inc.kind === 'allowance' && inc.allowance) {
      const a = inc.allowance;
      const persons = a.perPerson ? input.occupancy.adults + input.occupancy.childrenAges.length : 1;
      const first = nightDates[0] as LocalDate;
      const periods =
        a.period === 'per_night'
          ? nightDates.map((d) => ({ periodKey: d, from: d, to: addDays(d, 1) }))
          : [{ periodKey: 'stay', from: first, to: input.departure }];
      allowances.push({
        inclusionId: inc.id,
        code: inc.code,
        name: inc.name,
        terms: a,
        periods: periods.map((p) => ({
          ...p,
          amount: a.kind === 'monetary' ? { amountMinor: (a.amountMinor ?? 0) * persons, currency: input.currency } : null,
          quantity: a.kind === 'quantity' ? (a.quantity ?? 0) * persons : null,
        })),
      });
    }
  }
  for (const [date, occs] of included) {
    const allocated = occs.reduce((s, o) => s + o.amountMinor, 0);
    const night = nightAmount.get(date) ?? 0;
    if (allocated > night) {
      violations.push({
        kind: 'inclusion_exceeds_price',
        date,
        message: `Included items (${occs.map((o) => o.inclusion.code).join(', ')}) are worth more than the night price on ${date}. Raise the price or reduce the inclusion allocation.`,
        required: allocated,
        actual: night,
        overridable: false,
        source: null,
      });
    }
  }
  return { included, added, allowances, violations };
}
