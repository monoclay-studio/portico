/**
 * The fake rates module's penalty and complimentary rules — moved OUT of reservations (review R-02/R-03): rates owns
 * them (`evaluateCancellationPenalty`, `complimentaryTerms`). Semantics follow rates' canonical contract: tiers
 * resolved in the property time zone, penalty basis `gross` by default (night price + value-based hotel fees, no
 * statutory taxes or per-person levies) or `net`; percentages round once, half-up; a fixed amount never exceeds
 * the basis.
 */
import {
  add,
  Decimal,
  type LocalDate,
  type Money,
  multiply,
  sum,
  ValidationError,
  zero,
} from '@portico/kernel';
import { describePenalty } from '../../src/domain/terms';
import { deadlineBeforeArrival } from '../../src/domain/time';
import type { Penalty, PenaltyEvaluation, PenaltyEvent, TaxLine, TermsSnapshot } from '../../src/ports';

const QUANTITY_BASED: ReadonlySet<string> = new Set([
  'per_person_night',
  'per_unit_night',
  'per_stay',
  'fixed_per_charge',
]);

/** Quantity-based levies (Green Tax per person-night) still apply to a complimentary stay; value-based taxes don't. */
export function quantityBased(line: TaxLine): boolean {
  if (!line.basis) throw new Error('fake rates: every tax line carries its basis');
  return QUANTITY_BASED.has(line.basis);
}

export function penaltyAmount(penalty: Penalty, nightly: readonly Money[], currency: string): Money {
  const total = sum(currency, nightly);
  switch (penalty.kind) {
    case 'none':
      return zero(currency);
    case 'nights':
      return sum(currency, nightly.slice(0, Math.max(0, penalty.nights)));
    case 'first_night':
      return nightly[0] ?? zero(currency);
    case 'percent_of_stay':
      if (penalty.percent < 0 || penalty.percent > 100) {
        throw new ValidationError('invalid_penalty', 'A penalty percentage must be between 0 and 100.');
      }
      return multiply(total, new Decimal(penalty.percent).div(100));
    case 'amount':
      if (penalty.amount.currency !== currency) {
        throw new ValidationError(
          'currency_mismatch',
          `The penalty is in ${penalty.amount.currency} but the stay is priced in ${currency}.`,
        );
      }
      return penalty.amount.amountMinor > total.amountMinor ? total : penalty.amount;
  }
}

function timeZoneOf(terms: TermsSnapshot): string {
  const tz = terms.propertyTimezone;
  if (typeof tz !== 'string') throw new Error('fake rates: terms carry propertyTimezone');
  return tz;
}

function arrivalOf(terms: TermsSnapshot): LocalDate {
  const stay = terms.stay as { arrival?: LocalDate } | undefined;
  const first = [...terms.nights].map((n) => n.date).sort()[0];
  const arrival = stay?.arrival ?? first;
  if (!arrival) throw new Error('fake rates: terms without nights');
  return arrival;
}

/** rates.evaluateCancellationPenalty (pure). */
export function evaluatePenalty(
  terms: TermsSnapshot,
  at: Date,
  opts: { event: PenaltyEvent; nights: LocalDate[] },
): PenaltyEvaluation {
  const c = terms.currency;
  const policy = terms.policies.cancellation;
  const basis = policy.basis ?? 'gross';
  const nightly = terms.nights
    .filter((n) => opts.nights.includes(n.date))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((n) =>
      basis === 'net'
        ? n.net
        : add(n.net, ...n.taxes.filter((t) => t.kind === 'fee' && !quantityBased(t)).map((t) => t.amount)),
    );
  const basisAmount = sum(c, nightly);
  const result = (
    penalty: Penalty,
    tier: PenaltyEvaluation['tier'],
    description: string,
  ): PenaltyEvaluation => ({
    event: opts.event,
    at: at.toISOString(),
    nights: [...opts.nights],
    tier,
    penalty,
    basisAmount,
    amount: penaltyAmount(penalty, nightly, c),
    description,
  });
  if (opts.event === 'no_show') {
    return result(policy.noShow, null, `No-show: the agreed charge is ${describePenalty(policy.noShow)}.`);
  }
  if (opts.event === 'early_departure') {
    const p = policy.earlyDeparture ?? { kind: 'none' };
    return result(p, null, `Early departure: the agreed charge is ${describePenalty(p)}.`);
  }
  if (policy.nonRefundable) {
    const p = policy.nonRefundablePenalty ?? { kind: 'percent_of_stay', percent: 100 };
    return result(
      p,
      { fromInstant: null, description: 'Non-refundable' },
      `Non-refundable rate: cancelling costs ${describePenalty(p)}.`,
    );
  }
  const tz = timeZoneOf(terms);
  const arrival = arrivalOf(terms);
  const tiers = policy.tiers
    .map((t) => ({
      tier: t,
      from: deadlineBeforeArrival(arrival, t.deadline.daysBeforeArrival, t.deadline.time, tz),
    }))
    .sort((a, b) => b.from.getTime() - a.from.getTime());
  const applied = tiers.find((t) => t.from.getTime() <= at.getTime());
  if (!applied) {
    const next = [...tiers].reverse().find((t) => t.from.getTime() > at.getTime());
    return result(
      { kind: 'none' },
      null,
      next
        ? `Free cancellation until ${next.from.toISOString()} (property local deadline).`
        : 'Free cancellation.',
    );
  }
  return result(
    applied.tier.penalty,
    { fromInstant: applied.from.toISOString(), description: describePenalty(applied.tier.penalty) },
    `Cancelled after the deadline of ${applied.from.toISOString()}: the agreed charge is ${describePenalty(applied.tier.penalty)}.`,
  );
}

/** rates.complimentaryTerms: price zero, value-based taxes follow, quantity-based levies kept, re-issued terms. */
export function complimentary(
  terms: TermsSnapshot,
  input: { kind: 'complimentary' | 'house_use'; reason: string; by: string; at: string },
): TermsSnapshot {
  const c = terms.currency;
  const nights = terms.nights.map((n) => ({ ...n, net: zero(c), taxes: n.taxes.filter(quantityBased) }));
  const taxes = sum(
    c,
    nights.flatMap((n) => n.taxes.filter((t) => t.kind === 'tax').map((t) => t.amount)),
  );
  const fees = sum(
    c,
    nights.flatMap((n) => n.taxes.filter((t) => t.kind === 'fee').map((t) => t.amount)),
  );
  return {
    ...terms,
    priceSource: input.kind,
    nights,
    totals: { net: zero(c), taxes, fees, gross: add(taxes, fees) },
    priceOverride: {
      kind: input.kind,
      reason: input.reason,
      by: input.by,
      at: input.at,
      original: { totals: terms.totals },
    },
  };
}
