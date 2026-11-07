/**
 * Price computation for one rate plan × unit type × night (pure).
 *
 * Derived plans are applied PER PRICE PARAMETER (base, single, extra adult, each child band, each occupancy
 * override), each rounded once to the derivation's increment. The occupancy-resolved price is then computed
 * from the derived parameters. Storing the derived parameters in the agreed terms lets an occupancy change be
 * repriced from the agreement without reading current configuration (RAT-R29).
 */
import { Decimal, type Occupancy } from '@portico/kernel';
import type { Adjustment, OccupancyPricing, PriceRounding } from '../contracts';
import { DerivationError } from './errors';

export interface ChildAgeBand {
  code: string;
  minAge: number;
  maxAge: number;
}

/** Product default when a property has not configured bands (policy `rates.childAgeBands`). */
export const DEFAULT_CHILD_AGE_BANDS: readonly ChildAgeBand[] = [
  { code: 'infant', minAge: 0, maxAge: 1 },
  { code: 'child', minAge: 2, maxAge: 11 },
  { code: 'teen', minAge: 12, maxAge: 17 },
];

const MODES = {
  half_up: Decimal.ROUND_HALF_UP,
  half_even: Decimal.ROUND_HALF_EVEN,
  down: Decimal.ROUND_DOWN,
  up: Decimal.ROUND_UP,
} as const;

/** Round minor units to a multiple of `incrementMinor` (single rounding). */
export function roundToIncrement(value: Decimal, rounding: PriceRounding): number {
  const inc = new Decimal(rounding.incrementMinor);
  return value.div(inc).toDecimalPlaces(0, MODES[rounding.mode]).mul(inc).toNumber();
}

/** Apply one derivation adjustment to an amount. Negative results are floored at zero. */
export function applyAdjustment(amountMinor: number, adj: Adjustment, rounding: PriceRounding): number {
  const exact =
    adj.kind === 'percent'
      ? new Decimal(amountMinor).mul(new Decimal(100).plus(adj.percent)).div(100)
      : new Decimal(amountMinor).plus(adj.amountMinor);
  return Math.max(0, roundToIncrement(exact, rounding));
}

export interface DerivationStep {
  ratePlanId: string;
  adjustment: Adjustment;
  rounding: PriceRounding;
  unitTypeAdjustments: Record<string, Adjustment>;
}

/**
 * Adjust every price parameter. A percent adjustment scales all of them; an amount adjustment is a per
 * unit-night surcharge/discount, so it changes the unit prices (base, single, occupancy overrides) but not the
 * per-person extra-adult and child amounts.
 */
export function adjustParams(p: OccupancyPricing, adj: Adjustment, rounding: PriceRounding): OccupancyPricing {
  const f = (n: number) => applyAdjustment(n, adj, rounding);
  const perPerson = (n: number) => (adj.kind === 'percent' ? f(n) : n);
  const mapValues = (r: Record<string, number>, g: (n: number) => number) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, g(v)]));
  return {
    baseOccupancy: p.baseOccupancy,
    baseAmountMinor: f(p.baseAmountMinor),
    singleAmountMinor: p.singleAmountMinor === null ? null : f(p.singleAmountMinor),
    extraAdultMinor: p.extraAdultMinor === null ? null : perPerson(p.extraAdultMinor),
    childAmountsMinor: mapValues(p.childAmountsMinor, perPerson),
    occupancyAmountsMinor: mapValues(p.occupancyAmountsMinor, f),
  };
}

export function deriveParams(p: OccupancyPricing, step: DerivationStep, unitTypeId: string): OccupancyPricing {
  return adjustParams(p, step.unitTypeAdjustments[unitTypeId] ?? step.adjustment, step.rounding);
}

/** Root (base plan) parameters → the parameters of the last plan in `steps` (root first). */
export function resolveDerivedParams(
  root: OccupancyPricing,
  steps: readonly DerivationStep[],
  unitTypeId: string,
): OccupancyPricing {
  return steps.reduce((p, s) => deriveParams(p, s, unitTypeId), root);
}

export type OccupancyPriceResult =
  | { ok: true; amountMinor: number; adultsPriced: number; childBands: string[] }
  | { ok: false; kind: 'no_price' | 'no_child_price'; message: string };

/**
 * Price for an occupancy: adult part (occupancy override → single → base → base + extra adults) plus one
 * child-band amount per child. Children older than every band count as adults. Never guesses: a missing
 * extra-adult or child-band amount makes the night unsellable for that occupancy with an explanation.
 */
export function priceForOccupancy(
  p: OccupancyPricing,
  occ: Occupancy,
  bands: readonly ChildAgeBand[],
): OccupancyPriceResult {
  const maxBandAge = bands.reduce((m, b) => Math.max(m, b.maxAge), -1);
  let adults = occ.adults;
  let childTotal = 0;
  const childBands: string[] = [];
  for (const age of occ.childrenAges) {
    if (age > maxBandAge) {
      adults++;
      continue;
    }
    const band = bands.find((b) => age >= b.minAge && age <= b.maxAge);
    if (!band) {
      return {
        ok: false,
        kind: 'no_child_price',
        message: `No child age band covers age ${age}. Configure the property's child age bands.`,
      };
    }
    const amount = p.childAmountsMinor[band.code];
    if (amount === undefined) {
      return {
        ok: false,
        kind: 'no_child_price',
        message: `No price for a child aged ${age} (band "${band.code}"). Set the child amount (0 if children stay free).`,
      };
    }
    childTotal += amount;
    childBands.push(band.code);
  }
  let adultPart: number;
  const override = p.occupancyAmountsMinor[String(adults)];
  if (override !== undefined) adultPart = override;
  else if (adults === 1 && p.singleAmountMinor !== null) adultPart = p.singleAmountMinor;
  else if (adults <= p.baseOccupancy) adultPart = p.baseAmountMinor;
  else if (p.extraAdultMinor !== null) adultPart = p.baseAmountMinor + (adults - p.baseOccupancy) * p.extraAdultMinor;
  else {
    return {
      ok: false,
      kind: 'no_price',
      message: `No price for ${adults} adults: the price covers ${p.baseOccupancy} and has no extra-adult amount.`,
    };
  }
  return { ok: true, amountMinor: adultPart + childTotal, adultsPriced: adults, childBands };
}

// ───────────────────────────── Derivation graph ─────────────────────────────

export const MAX_DERIVATION_DEPTH = 3;

/**
 * Validate setting `planId`'s parent to `newParentId` (null = make it a base plan): no cycles, and no plan in the
 * affected subtree deeper than MAX_DERIVATION_DEPTH (base = depth 1).
 */
export function validateDerivationGraph(
  plans: ReadonlyArray<{ id: string; parentId: string | null; code: string }>,
  planId: string,
  newParentId: string | null,
): void {
  const parentOf = new Map(plans.map((p) => [p.id, p.parentId]));
  const codeOf = new Map(plans.map((p) => [p.id, p.code]));
  parentOf.set(planId, newParentId);
  if (newParentId !== null && !parentOf.has(newParentId)) {
    throw new DerivationError('parent_plan_not_found', 'The parent rate plan does not exist at this property.');
  }
  // Depth of the new parent chain (cycle-safe walk).
  const depthOf = (id: string): number => {
    const seen = new Set<string>();
    let d = 1;
    let cur = parentOf.get(id) ?? null;
    seen.add(id);
    while (cur !== null) {
      if (seen.has(cur)) {
        throw new DerivationError(
          'derivation_cycle',
          `Rate plan ${codeOf.get(planId) ?? planId} cannot derive from ${codeOf.get(newParentId ?? '') ?? newParentId}: it would derive from itself. Choose a parent that is not one of its derived plans.`,
          { planId, parentId: newParentId },
        );
      }
      seen.add(cur);
      d++;
      cur = parentOf.get(cur) ?? null;
    }
    return d;
  };
  const children = new Map<string, string[]>();
  for (const [id, parent] of parentOf) if (parent) children.set(parent, [...(children.get(parent) ?? []), id]);
  const stack = [planId];
  while (stack.length) {
    const id = stack.pop() as string;
    if (depthOf(id) > MAX_DERIVATION_DEPTH) {
      throw new DerivationError(
        'derivation_too_deep',
        `Derived plans may be at most ${MAX_DERIVATION_DEPTH - 1} levels below a base plan (base + ${MAX_DERIVATION_DEPTH - 1}). ${codeOf.get(id) ?? id} would be deeper. Derive from a plan closer to the base plan instead.`,
        { planId: id },
      );
    }
    stack.push(...(children.get(id) ?? []));
  }
}

/** Chain from the root base plan to `planId` (root first). */
export function ancestry<T extends { id: string; parentId: string | null }>(plans: readonly T[], planId: string): T[] {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const chain: T[] = [];
  let cur = byId.get(planId);
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur.id)) throw new DerivationError('derivation_cycle', 'Rate plan derivation contains a cycle.');
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
}

/** Every plan deriving (directly or indirectly) from `planId`. */
export function descendants<T extends { id: string; parentId: string | null }>(plans: readonly T[], planId: string): T[] {
  const out: T[] = [];
  const queue = [planId];
  while (queue.length) {
    const id = queue.shift() as string;
    for (const p of plans) {
      if (p.parentId === id && !out.includes(p)) {
        out.push(p);
        queue.push(p.id);
      }
    }
  }
  return out;
}
