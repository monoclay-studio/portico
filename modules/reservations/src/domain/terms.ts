import {
  add,
  canonicalJson,
  type DateRange,
  Decimal,
  eachNight,
  type LocalDate,
  type Money,
  multiply,
  rangeContains,
  sha256Hex,
  sum,
  ValidationError,
  zero,
} from '@portico/kernel';
import type { CancellationPolicy, DepositItem, Penalty, TaxLine, TermsSnapshot } from '../ports';
import { deadlineBeforeArrival } from './time';

/** Content hash of agreed terms (excludes any embedded `hash`). Verifies immutability (RES-I04). */
export function snapshotHash(doc: TermsSnapshot): string {
  const { hash: _ignored, ...rest } = doc as TermsSnapshot & { hash?: unknown };
  return sha256Hex(canonicalJson(rest));
}

export interface RangeTotals {
  net: Money;
  taxes: Money;
  fees: Money;
  gross: Money;
}

/** Nightly lines of a snapshot that fall inside `range` (a segment's nights). */
export function nightlyLines(doc: TermsSnapshot, range: DateRange): TermsSnapshot['nights'] {
  return doc.nights.filter((n) => rangeContains(range, n.date));
}

/** Totals for the nights of `range` priced by `doc`. Every night of the range must be priced. */
export function rangeTotals(doc: TermsSnapshot, range: DateRange): RangeTotals {
  const lines = nightlyLines(doc, range);
  const priced = new Set(lines.map((l) => l.date));
  const missing = eachNight(range).filter((d) => !priced.has(d));
  if (missing.length) {
    throw new ValidationError(
      'terms_missing_nights',
      `The agreed terms do not price ${missing.join(', ')}. Re-price the stay before continuing.`,
      { missing },
    );
  }
  const c = doc.currency;
  const net = sum(
    c,
    lines.map((l) => l.net),
  );
  const taxes = sum(
    c,
    lines.flatMap((l) => l.taxes.filter((t) => t.kind === 'tax').map((t) => t.amount)),
  );
  const fees = sum(
    c,
    lines.flatMap((l) => l.taxes.filter((t) => t.kind === 'fee').map((t) => t.amount)),
  );
  return { net, taxes, fees, gross: add(net, taxes, fees) };
}

export function addTotals(currency: string, items: readonly RangeTotals[]): RangeTotals {
  return {
    net: sum(
      currency,
      items.map((i) => i.net),
    ),
    taxes: sum(
      currency,
      items.map((i) => i.taxes),
    ),
    fees: sum(
      currency,
      items.map((i) => i.fees),
    ),
    gross: sum(
      currency,
      items.map((i) => i.gross),
    ),
  };
}

export const zeroTotals = (currency: string): RangeTotals => ({
  net: zero(currency),
  taxes: zero(currency),
  fees: zero(currency),
  gross: zero(currency),
});

/**
 * Penalty amount. Base = agreed NET nightly prices in stay order (taxes on a penalty are computed by the tax
 * engine when finance posts it). Percentages round once, half-up.
 */
export function penaltyAmount(penalty: Penalty, nightlyNet: readonly Money[], currency: string): Money {
  const total = sum(currency, nightlyNet);
  switch (penalty.kind) {
    case 'none':
      return zero(currency);
    case 'nights':
      return sum(currency, nightlyNet.slice(0, Math.max(0, penalty.nights)));
    case 'first_night':
      return nightlyNet[0] ?? zero(currency);
    case 'percent_of_stay':
      if (penalty.percent < 0 || penalty.percent > 100) {
        throw new ValidationError('invalid_penalty', 'A penalty percentage must be between 0 and 100.');
      }
      return multiply(total, new Decimal(penalty.percent).div(100));
    case 'amount': {
      if (penalty.amount.currency !== currency) {
        throw new ValidationError(
          'currency_mismatch',
          `The penalty is in ${penalty.amount.currency} but the stay is priced in ${currency}.`,
        );
      }
      // Never charge more than the stay is worth.
      return penalty.amount.amountMinor > total.amountMinor ? total : penalty.amount;
    }
  }
}

export function describePenalty(penalty: Penalty): string {
  switch (penalty.kind) {
    case 'none':
      return 'no charge';
    case 'nights':
      return `${penalty.nights} night${penalty.nights === 1 ? '' : 's'}`;
    case 'first_night':
      return 'the first night';
    case 'percent_of_stay':
      return `${penalty.percent}% of the stay`;
    case 'amount':
      return `a fixed amount (${penalty.amount.amountMinor} ${penalty.amount.currency} minor units)`;
  }
}

export interface CancellationOutcome {
  amount: Money;
  /** Index of the applied tier, 'non_refundable', or null when cancellation is free. */
  tier: number | 'non_refundable' | null;
  /** When the applied tier started (property local deadline as an instant). */
  appliedSince: string | null;
  /** Until when cancelling is free (null when already past or non-refundable). */
  freeUntil: string | null;
  description: string;
}

/**
 * Cancellation penalty per agreed terms, evaluated at `at` against deadlines in the property's time zone
 * (RES-R20). The tier with the most recent deadline at or before `at` applies.
 */
export function cancellationPenalty(input: {
  policy: CancellationPolicy;
  arrival: LocalDate;
  timeZone: string;
  at: Date;
  nightlyNet: readonly Money[];
  currency: string;
}): CancellationOutcome {
  const { policy, arrival, timeZone, at, nightlyNet, currency } = input;
  if (policy.nonRefundable) {
    const penalty = policy.nonRefundablePenalty ?? { kind: 'percent_of_stay', percent: 100 };
    return {
      amount: penaltyAmount(penalty, nightlyNet, currency),
      tier: 'non_refundable',
      appliedSince: null,
      freeUntil: null,
      description: `Non-refundable rate: cancelling costs ${describePenalty(penalty)}.`,
    };
  }
  const tiers = policy.tiers.map((t, index) => ({
    index,
    tier: t,
    deadline: deadlineBeforeArrival(arrival, t.deadline.daysBeforeArrival, t.deadline.time, timeZone),
  }));
  const passed = tiers
    .filter((t) => t.deadline.getTime() <= at.getTime())
    .sort((a, b) => b.deadline.getTime() - a.deadline.getTime());
  const upcoming = tiers
    .filter((t) => t.deadline.getTime() > at.getTime())
    .sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
  const applied = passed[0];
  if (!applied) {
    const next = upcoming[0];
    return {
      amount: zero(currency),
      tier: null,
      appliedSince: null,
      freeUntil: next ? next.deadline.toISOString() : null,
      description: next
        ? `Free cancellation until ${next.deadline.toISOString()} (property local deadline).`
        : 'Free cancellation.',
    };
  }
  return {
    amount: penaltyAmount(applied.tier.penalty, nightlyNet, currency),
    tier: applied.index,
    appliedSince: applied.deadline.toISOString(),
    freeUntil: null,
    description: `Cancelled after the deadline of ${applied.deadline.toISOString()}: the agreed charge is ${describePenalty(applied.tier.penalty)}.`,
  };
}

/** Deposit required by the agreed deposit policy (sum of `deposit` items). */
export function requiredDeposit(
  items: readonly DepositItem[],
  totals: { gross: Money },
  nightlyGross: readonly Money[],
): Money {
  const currency = totals.gross.currency;
  let required = zero(currency);
  for (const item of items) {
    if (item.kind !== 'deposit') continue;
    switch (item.basis) {
      case 'percent':
        required = add(required, multiply(totals.gross, new Decimal(item.value ?? 0).div(100)));
        break;
      case 'nights':
        required = add(required, sum(currency, nightlyGross.slice(0, item.value ?? 0)));
        break;
      case 'amount':
        if (item.amount) required = add(required, item.amount);
        break;
      case 'remaining':
        required = totals.gross;
        break;
    }
  }
  return required.amountMinor > totals.gross.amountMinor ? totals.gross : required;
}

/** Nightly gross (net + taxes + fees) for each night of the range, in order. */
export function nightlyGross(doc: TermsSnapshot, range: DateRange): Money[] {
  return nightlyLines(doc, range)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((l) => add(l.net, ...l.taxes.map((t) => t.amount)));
}

const QUANTITY_BASED: ReadonlySet<string> = new Set([
  'per_person_night',
  'per_unit_night',
  'per_stay',
  'fixed_per_charge',
]);

/**
 * Does a tax/fee line still apply when the room is given for free? Quantity-based levies do (Maldives Green Tax is
 * due on complimentary stays — MIRA Green Tax FAQ, docs/readiness/maldives-tax-rules.md §5); value-based taxes follow
 * the zero value. When rates does not state the basis, a `fee` line is treated as a quantity-based levy and a `tax`
 * line as value-based (documented fallback; rates should always send `basis`).
 */
export function appliesWhenComplimentary(line: TaxLine): boolean {
  if (line.basis) return QUANTITY_BASED.has(line.basis);
  return line.kind === 'fee';
}

/**
 * Turn a priced snapshot into a complimentary / house-use snapshot: the room price becomes zero, value-based taxes
 * follow the zero value, quantity-based levies (Green Tax per person-night, under-2 exempt as computed by rates)
 * are kept and are posted to the stay's house folio. The original totals are kept for reporting.
 */
export function complimentarySnapshot(
  doc: TermsSnapshot,
  override: { kind: 'complimentary' | 'house_use'; reason: string; approvedBy: string },
): TermsSnapshot {
  const currency = doc.currency;
  const nights = doc.nights.map((n) => ({
    ...n,
    net: zero(currency),
    taxes: n.taxes.filter(appliesWhenComplimentary),
  }));
  const taxes = sum(
    currency,
    nights.flatMap((n) => n.taxes.filter((t) => t.kind === 'tax').map((t) => t.amount)),
  );
  const fees = sum(
    currency,
    nights.flatMap((n) => n.taxes.filter((t) => t.kind === 'fee').map((t) => t.amount)),
  );
  return {
    ...doc,
    priceSource: 'override',
    nights,
    totals: { net: zero(currency), taxes, fees, gross: add(taxes, fees) },
    override: { kind: override.kind, reason: override.reason, approvedBy: override.approvedBy },
    originalTotals: doc.totals,
  };
}
