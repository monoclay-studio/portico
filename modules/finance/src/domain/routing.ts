import { addDays, BusinessRuleError, Decimal, type LocalDate, ValidationError } from '@portico/kernel';
import type { ChargeGroup, RuleCap, RuleSelector } from './types';

/**
 * Billing-rule routing ("who pays for what").
 *
 * Resolution is by SPECIFICITY, never by a user-ranked priority list (legal caution, OPEN_QUESTIONS Q40):
 *  - a rule's selector denotes a set of (charge code, service date) pairs;
 *  - two rules on the same owner may overlap only if one set strictly contains the other ("nested"); the
 *    smaller (more specific) rule then wins for the charges both select;
 *  - identical or partially overlapping selectors are configuration errors rejected at save time;
 *  - a charge selected by no rule goes to the owner's default folio; a capped rule's overflow also goes to
 *    the default folio.
 * Because every pair of rules matching one charge is nested, the matching rules form a chain and the most
 * specific rule is unique — the outcome is deterministic and explainable.
 */

export interface RoutingRule {
  id: string;
  label: string;
  destinationFolioId: string;
  selector: RuleSelector;
  cap: RuleCap | null;
}

export interface ChargeToRoute {
  chargeCode: string;
  chargeGroup: ChargeGroup;
  serviceDate: LocalDate;
  /** Gross amount (incl. taxes), signed, minor units of the routing currency. */
  grossMinor: number;
}

export interface RouteAllocation {
  folioId: string;
  ruleId: string | null;
  grossMinor: number;
  explanation: string;
}

export type GroupOf = (chargeCode: string) => ChargeGroup | undefined;

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export function dayOfWeek(d: LocalDate): number {
  return new Date(`${d}T00:00:00Z`).getUTCDay();
}

function dows(s: RuleSelector): number[] {
  return s.daysOfWeek && s.daysOfWeek.length > 0 ? [...new Set(s.daysOfWeek)].sort() : [...ALL_DAYS];
}

function chargesAll(s: RuleSelector): boolean {
  return (s.chargeCodes?.length ?? 0) === 0 && (s.chargeGroups?.length ?? 0) === 0;
}

/** Validate a selector's shape (not overlaps). */
export function validateSelector(s: RuleSelector): void {
  for (const d of s.daysOfWeek ?? []) {
    if (!Number.isInteger(d) || d < 0 || d > 6) {
      throw new ValidationError('invalid_days_of_week', 'Days of week are numbers 0 (Sunday) to 6 (Saturday).');
    }
  }
  if (s.serviceDateFrom && s.serviceDateTo && s.serviceDateTo <= s.serviceDateFrom) {
    throw new ValidationError(
      'invalid_date_range',
      `The rule's end date (${s.serviceDateTo}) must be after its start date (${s.serviceDateFrom}).`,
    );
  }
  if (normalizedDates(s) === null) {
    throw new ValidationError(
      'rule_never_matches',
      'This rule can never match: none of its days of the week fall within its date range. Widen the dates or days.',
    );
  }
}

/** Date range trimmed so both ends fall on a selected weekday; null when the selector matches no date. */
function normalizedDates(s: RuleSelector): { from?: LocalDate; to?: LocalDate; dows: number[] } | null {
  const days = dows(s);
  let from = s.serviceDateFrom;
  let to = s.serviceDateTo;
  if (from) {
    let steps = 0;
    while (!days.includes(dayOfWeek(from)) && steps < 7) {
      from = addDays(from, 1);
      steps++;
    }
    if (steps >= 7) return null;
  }
  if (to) {
    let steps = 0;
    while (!days.includes(dayOfWeek(addDays(to, -1))) && steps < 7) {
      to = addDays(to, -1);
      steps++;
    }
    if (steps >= 7) return null;
  }
  if (from && to && to <= from) return null;
  // Effective weekdays: for a short bounded range, only weekdays that actually occur.
  let effective = days;
  if (from && to) {
    const present = new Set<number>();
    for (let d = from, i = 0; d < to && i < 7; d = addDays(d, 1), i++) present.add(dayOfWeek(d));
    effective = days.filter((x) => present.has(x));
  }
  return { ...(from ? { from } : {}), ...(to ? { to } : {}), dows: effective };
}

export function selectorMatches(s: RuleSelector, charge: Pick<ChargeToRoute, 'chargeCode' | 'chargeGroup' | 'serviceDate'>): boolean {
  if (!chargesAll(s)) {
    const byCode = s.chargeCodes?.includes(charge.chargeCode) ?? false;
    const byGroup = s.chargeGroups?.includes(charge.chargeGroup) ?? false;
    if (!byCode && !byGroup) return false;
  }
  if (s.serviceDateFrom && charge.serviceDate < s.serviceDateFrom) return false;
  if (s.serviceDateTo && charge.serviceDate >= s.serviceDateTo) return false;
  return dows(s).includes(dayOfWeek(charge.serviceDate));
}

function chargeSubset(a: RuleSelector, b: RuleSelector, groupOf: GroupOf): boolean {
  if (chargesAll(b)) return true;
  if (chargesAll(a)) return false;
  const bCodes = new Set(b.chargeCodes ?? []);
  const bGroups = new Set<string>(b.chargeGroups ?? []);
  for (const g of a.chargeGroups ?? []) if (!bGroups.has(g)) return false;
  for (const c of a.chargeCodes ?? []) {
    const g = groupOf(c);
    if (!bCodes.has(c) && !(g && bGroups.has(g))) return false;
  }
  return true;
}

function chargeOverlap(a: RuleSelector, b: RuleSelector, groupOf: GroupOf): boolean {
  if (chargesAll(a) || chargesAll(b)) return true;
  const aCodes = a.chargeCodes ?? [];
  const bCodes = b.chargeCodes ?? [];
  const aGroups = new Set<string>(a.chargeGroups ?? []);
  const bGroups = new Set<string>(b.chargeGroups ?? []);
  if ([...aGroups].some((g) => bGroups.has(g))) return true;
  if (aCodes.some((c) => bCodes.includes(c))) return true;
  if (aCodes.some((c) => bGroups.has(groupOf(c) ?? ''))) return true;
  if (bCodes.some((c) => aGroups.has(groupOf(c) ?? ''))) return true;
  return false;
}

function dateSubset(a: RuleSelector, b: RuleSelector): boolean {
  const na = normalizedDates(a);
  const nb = normalizedDates(b);
  if (!na) return true; // empty set is a subset of anything
  if (!nb) return false;
  if (nb.from && (!na.from || na.from < nb.from)) return false;
  if (nb.to && (!na.to || na.to > nb.to)) return false;
  const bDays = dows(b);
  return na.dows.every((d) => bDays.includes(d));
}

function dateOverlap(a: RuleSelector, b: RuleSelector): boolean {
  const na = normalizedDates(a);
  const nb = normalizedDates(b);
  if (!na || !nb) return false;
  const from = [na.from, nb.from].filter((x): x is string => !!x).sort().pop();
  const to = [na.to, nb.to].filter((x): x is string => !!x).sort()[0];
  if (from && to && to <= from) return false;
  const common = dows(a).filter((d) => dows(b).includes(d));
  if (common.length === 0) return false;
  if (from && to) {
    for (let d = from, i = 0; d < to && i < 7; d = addDays(d, 1), i++) {
      if (common.includes(dayOfWeek(d))) return true;
    }
    return false;
  }
  return true;
}

/** True when every charge `a` selects is also selected by `b`. */
export function isSubset(a: RuleSelector, b: RuleSelector, groupOf: GroupOf): boolean {
  return chargeSubset(a, b, groupOf) && dateSubset(a, b);
}

export function overlaps(a: RuleSelector, b: RuleSelector, groupOf: GroupOf): boolean {
  return chargeOverlap(a, b, groupOf) && dateOverlap(a, b);
}

export type OverlapVerdict = 'disjoint' | 'more_specific' | 'less_specific' | 'identical' | 'partial';

/** How selector `a` relates to `b`. 'identical' and 'partial' overlaps are configuration errors. */
export function compareSelectors(a: RuleSelector, b: RuleSelector, groupOf: GroupOf): OverlapVerdict {
  if (!overlaps(a, b, groupOf)) return 'disjoint';
  const ab = isSubset(a, b, groupOf);
  const ba = isSubset(b, a, groupOf);
  if (ab && ba) return 'identical';
  if (ab) return 'more_specific';
  if (ba) return 'less_specific';
  return 'partial';
}

export interface RuleConflict {
  ruleId: string;
  label: string;
  verdict: 'identical' | 'partial';
}

/** Conflicts of a candidate rule against the owner's other active rules (empty = can be saved). */
export function findConflicts(
  candidate: Pick<RoutingRule, 'id' | 'selector'>,
  others: readonly Pick<RoutingRule, 'id' | 'label' | 'selector'>[],
  groupOf: GroupOf,
): RuleConflict[] {
  const out: RuleConflict[] = [];
  for (const o of others) {
    if (o.id === candidate.id) continue;
    const v = compareSelectors(candidate.selector, o.selector, groupOf);
    if (v === 'identical' || v === 'partial') out.push({ ruleId: o.id, label: o.label, verdict: v });
  }
  return out;
}

/** Validate a complete rule set (e.g. a proposed replacement) — throws a configuration error on any tie. */
export function assertRuleSetConsistent(rules: readonly RoutingRule[], groupOf: GroupOf): void {
  for (const r of rules) {
    validateSelector(r.selector);
    const conflicts = findConflicts(r, rules, groupOf);
    const first = conflicts[0];
    if (first) {
      throw new BusinessRuleError(
        'billing_rule_conflict',
        first.verdict === 'identical'
          ? `Rules "${r.label}" and "${first.label}" select exactly the same charges, so it is unclear who pays. Remove one of them or narrow one to specific charge codes or dates.`
          : `Rules "${r.label}" and "${first.label}" partly overlap (some charges match both, but neither rule is fully inside the other). Narrow the dates or charge codes of one rule so that one is entirely within the other or they do not overlap.`,
        { ruleId: r.id, conflictsWith: conflicts },
      );
    }
  }
}

/** The matching rules ordered from most to least specific (all pairwise nested by construction). */
export function matchingChain(
  rules: readonly RoutingRule[],
  charge: ChargeToRoute,
  groupOf: GroupOf,
): RoutingRule[] {
  const matching = rules.filter((r) => selectorMatches(r.selector, charge));
  const chain = [...matching].sort((a, b) => {
    const ab = isSubset(a.selector, b.selector, groupOf);
    const ba = isSubset(b.selector, a.selector, groupOf);
    if (ab && !ba) return -1;
    if (ba && !ab) return 1;
    return 0;
  });
  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1];
    const cur = chain[i];
    if (prev && cur && !isSubset(prev.selector, cur.selector, groupOf)) {
      throw new BusinessRuleError(
        'billing_rule_conflict',
        `Billing rules "${prev.label}" and "${cur.label}" both match this charge but neither is more specific. Fix the rules before posting; the charge was not posted.`,
        { rules: [prev.id, cur.id] },
      );
    }
  }
  return chain;
}

/** Period key for cap usage: the service date for per-night caps, 'stay' for per-stay caps. */
export function capPeriodKey(cap: RuleCap, serviceDate: LocalDate): string | null {
  if (cap.kind === 'per_night') return serviceDate;
  if (cap.kind === 'per_stay') return 'stay';
  return null;
}

/**
 * Route one charge. `usedMinor(ruleId, periodKey)` returns the gross already routed through a capped rule in
 * the cap's period (including earlier charges in the same batch, which the caller accumulates).
 */
export function routeCharge(
  rules: readonly RoutingRule[],
  charge: ChargeToRoute,
  defaultFolioId: string,
  groupOf: GroupOf,
  usedMinor: (ruleId: string, periodKey: string) => number,
): RouteAllocation[] {
  const chain = matchingChain(rules, charge, groupOf);
  const winner = chain[0];
  if (!winner) {
    return [
      { folioId: defaultFolioId, ruleId: null, grossMinor: charge.grossMinor, explanation: 'No billing rule matches — default folio' },
    ];
  }
  const cap = winner.cap;
  if (!cap || charge.grossMinor <= 0) {
    return [
      {
        folioId: winner.destinationFolioId,
        ruleId: winner.id,
        grossMinor: charge.grossMinor,
        explanation: `Rule "${winner.label}"`,
      },
    ];
  }
  let routed: number;
  let why: string;
  if (cap.kind === 'percent') {
    routed = new Decimal(charge.grossMinor).mul(cap.percent).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
    routed = Math.min(Math.max(routed, 0), charge.grossMinor);
    why = `Rule "${winner.label}" (${cap.percent}% of each charge)`;
  } else {
    const key = capPeriodKey(cap, charge.serviceDate) as string;
    const remaining = Math.max(0, cap.amountMinor - usedMinor(winner.id, key));
    routed = Math.min(remaining, charge.grossMinor);
    why = `Rule "${winner.label}" (limit ${cap.amountMinor} ${cap.currency} ${cap.kind === 'per_night' ? 'per night' : 'per stay'}, ${remaining} remaining)`;
  }
  const out: RouteAllocation[] = [];
  if (routed > 0) out.push({ folioId: winner.destinationFolioId, ruleId: winner.id, grossMinor: routed, explanation: why });
  const overflow = charge.grossMinor - routed;
  if (overflow > 0) {
    // Kept as a separate allocation (ruleId null) so cap usage only ever counts what the rule paid.
    out.push({
      folioId: defaultFolioId,
      ruleId: null,
      grossMinor: overflow,
      explanation: `Above the limit of rule "${winner.label}" — default folio`,
    });
  }
  return out;
}

export interface PreviewCharge extends ChargeToRoute {
  ref?: string;
}

/** Route a batch of hypothetical charges in order, accumulating cap usage (for "who pays for what" previews). */
export function routeBatch(
  rules: readonly RoutingRule[],
  charges: readonly PreviewCharge[],
  defaultFolioId: string,
  groupOf: GroupOf,
  initialUsed: (ruleId: string, periodKey: string) => number,
): Array<{ charge: PreviewCharge; allocations: RouteAllocation[] }> {
  const extra = new Map<string, number>();
  const used = (ruleId: string, key: string) => initialUsed(ruleId, key) + (extra.get(`${ruleId}|${key}`) ?? 0);
  return charges.map((charge) => {
    const allocations = routeCharge(rules, charge, defaultFolioId, groupOf, used);
    for (const a of allocations) {
      const rule = rules.find((r) => r.id === a.ruleId);
      if (rule?.cap) {
        const key = capPeriodKey(rule.cap, charge.serviceDate);
        if (key) extra.set(`${rule.id}|${key}`, (extra.get(`${rule.id}|${key}`) ?? 0) + a.grossMinor);
      }
    }
    return { charge, allocations };
  });
}
