/**
 * Restriction evaluation (pure). Restrictions are stored per scope (rate plan | all plans) × (unit type | all
 * types) × date. For a plan and unit type the effective value of each kind is the MOST RESTRICTIVE value among
 * the applicable scopes. Derived plans take each kind either from their parent (inherited, recursively) or from
 * their own rows — an explicit, visible choice per kind (RAT-R04).
 */
import { diffDays, eachNight, type LocalDate } from '@portico/kernel';
import type { RestrictionKind, RestrictionValues, Violation } from '../contracts';

export interface RestrictionRow {
  ratePlanId: string | null;
  unitTypeId: string | null;
  date: LocalDate;
  values: RestrictionValues;
}

export type EffectiveValue = { value: number | boolean; source: { ratePlanId: string | null; unitTypeId: string | null } };
export type EffectiveRestrictions = Partial<Record<RestrictionKind, EffectiveValue>>;

const MAX_KINDS: RestrictionKind[] = ['minLos', 'minLosThrough', 'minAdvanceDays'];
const MIN_KINDS: RestrictionKind[] = ['maxLos', 'maxAdvanceDays', 'salesLimit'];
const BOOL_KINDS: RestrictionKind[] = ['closed', 'closedToArrival', 'closedToDeparture'];

export interface PlanChainLink {
  id: string;
  /** Kinds this plan takes from its parent (ignored for the base plan). */
  inheritedKinds: readonly RestrictionKind[];
}

/** Which plan's own rows define `kind` for the last plan of `chain` (root first). */
export function ownerPlanForKind(chain: readonly PlanChainLink[], kind: RestrictionKind): string {
  // A sales limit counts the plan's OWN sales, so it is never inherited.
  if (kind === 'salesLimit') return (chain[chain.length - 1] as PlanChainLink).id;
  for (let i = chain.length - 1; i > 0; i--) {
    const link = chain[i] as PlanChainLink;
    if (!link.inheritedKinds.includes(kind)) return link.id;
  }
  return (chain[0] as PlanChainLink).id;
}

function moreRestrictive(kind: RestrictionKind, a: EffectiveValue | undefined, b: EffectiveValue): EffectiveValue {
  if (!a) return b;
  if (BOOL_KINDS.includes(kind)) return a.value ? a : b;
  if (MAX_KINDS.includes(kind)) return (b.value as number) > (a.value as number) ? b : a;
  return (b.value as number) < (a.value as number) ? b : a;
}

export function effectiveRestrictions(
  rows: readonly RestrictionRow[],
  chain: readonly PlanChainLink[],
  unitTypeId: string,
): Map<LocalDate, EffectiveRestrictions> {
  const owners = new Map<RestrictionKind, string>();
  for (const k of [...BOOL_KINDS, ...MAX_KINDS, ...MIN_KINDS]) owners.set(k, ownerPlanForKind(chain, k));
  const out = new Map<LocalDate, EffectiveRestrictions>();
  for (const row of rows) {
    if (row.unitTypeId !== null && row.unitTypeId !== unitTypeId) continue;
    const cell = out.get(row.date) ?? {};
    for (const [k, v] of Object.entries(row.values) as Array<[RestrictionKind, number | boolean | null | undefined]>) {
      if (v === null || v === undefined) continue;
      if (BOOL_KINDS.includes(k) && v === false) continue;
      if (row.ratePlanId !== null && row.ratePlanId !== owners.get(k)) continue;
      cell[k] = moreRestrictive(k, cell[k], { value: v, source: { ratePlanId: row.ratePlanId, unitTypeId: row.unitTypeId } });
    }
    out.set(row.date, cell);
  }
  return out;
}

function v(
  kind: Violation['kind'],
  date: LocalDate | null,
  message: string,
  e: EffectiveValue | undefined,
  actual: number | null = null,
): Violation {
  return {
    kind,
    date,
    message,
    required: e && typeof e.value === 'number' ? e.value : null,
    actual,
    overridable: true,
    source: e?.source ?? null,
  };
}

export interface RestrictionCheck {
  arrival: LocalDate;
  departure: LocalDate;
  bookingDate: LocalDate;
  effective: Map<LocalDate, EffectiveRestrictions>;
  /** Stays already sold on the plan per night (for sales limits). */
  sold?: Map<LocalDate, number>;
  quantity?: number;
}

/** Every violated restriction, each with night, kind and a plain-language reason (RAT-R09). */
export function evaluateRestrictions(c: RestrictionCheck): Violation[] {
  const out: Violation[] = [];
  const nights = eachNight({ from: c.arrival, to: c.departure });
  const los = nights.length;
  const advance = diffDays(c.bookingDate, c.arrival);
  const arr = c.effective.get(c.arrival) ?? {};
  if (arr.closedToArrival?.value) out.push(v('closed_to_arrival', c.arrival, `Arrival on ${c.arrival} is not allowed (closed to arrival).`, arr.closedToArrival));
  if (arr.minLos && los < (arr.minLos.value as number))
    out.push(v('min_los', c.arrival, `Arriving on ${c.arrival} requires at least ${arr.minLos.value} nights; this stay has ${los}.`, arr.minLos, los));
  if (arr.maxLos && los > (arr.maxLos.value as number))
    out.push(v('max_los', c.arrival, `Arriving on ${c.arrival} allows at most ${arr.maxLos.value} nights; this stay has ${los}.`, arr.maxLos, los));
  if (arr.minAdvanceDays && advance < (arr.minAdvanceDays.value as number))
    out.push(
      v('min_advance', c.arrival, `This rate must be booked at least ${arr.minAdvanceDays.value} days before arrival; it is ${advance} days.`, arr.minAdvanceDays, advance),
    );
  if (arr.maxAdvanceDays && advance > (arr.maxAdvanceDays.value as number))
    out.push(
      v('max_advance', c.arrival, `This rate can be booked at most ${arr.maxAdvanceDays.value} days before arrival; it is ${advance} days.`, arr.maxAdvanceDays, advance),
    );
  for (const d of nights) {
    const e = c.effective.get(d) ?? {};
    if (e.closed?.value) out.push(v('closed', d, `The night of ${d} is closed for sale.`, e.closed));
    if (e.minLosThrough && los < (e.minLosThrough.value as number))
      out.push(v('min_los_through', d, `Stays including the night of ${d} require at least ${e.minLosThrough.value} nights; this stay has ${los}.`, e.minLosThrough, los));
    if (e.salesLimit) {
      const sold = c.sold?.get(d) ?? 0;
      const qty = c.quantity ?? 1;
      if (sold + qty > (e.salesLimit.value as number))
        out.push(v('sales_limit', d, `The sales limit of ${e.salesLimit.value} for the night of ${d} is reached (${sold} sold).`, e.salesLimit, sold));
    }
  }
  const dep = c.effective.get(c.departure) ?? {};
  if (dep.closedToDeparture?.value)
    out.push(v('closed_to_departure', c.departure, `Departure on ${c.departure} is not allowed (closed to departure).`, dep.closedToDeparture));
  return out;
}

/** Most-restrictive merge of explicit values for display (calendar grid). */
export function mergeValues(a: RestrictionValues, b: RestrictionValues): RestrictionValues {
  const out: RestrictionValues = { ...a };
  for (const [k, val] of Object.entries(b) as Array<[keyof RestrictionValues, unknown]>) {
    if (val === undefined) continue;
    (out as Record<string, unknown>)[k] = val;
  }
  return out;
}
