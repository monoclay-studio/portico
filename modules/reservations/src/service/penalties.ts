import type { LocalDate, Money } from '@portico/kernel';
import { add, zero } from '@portico/kernel';
import type { PenaltyEvent, TermsSnapshot } from '../ports';
import type { Deps } from './context';

export interface PenaltyOutcome {
  amount: Money;
  description: string;
}

/**
 * The agreed charge for removing nights (cancellation, early departure) or for a no-show, evaluated by RATES
 * (`evaluateCancellationPenalty`, review R-03) — reservations holds no penalty arithmetic of its own.
 * A stay can carry several agreements (e.g. an extension agreed later): each agreement's terms govern its own
 * nights and the charges add up. A no-show is governed by the agreement of the arrival night.
 */
export function agreedPenalty(
  deps: Deps,
  input: {
    event: PenaltyEvent;
    at: Date;
    currency: string;
    parts: ReadonlyArray<{ terms: TermsSnapshot; nights: readonly LocalDate[] }>;
  },
): PenaltyOutcome {
  const parts = input.parts.filter((p) => p.nights.length > 0);
  const governing = input.event === 'no_show' ? parts.slice(0, 1) : parts;
  let amount = zero(input.currency);
  const descriptions: string[] = [];
  for (const part of governing) {
    const e = deps.ports.rates.evaluateCancellationPenalty(part.terms, input.at, {
      event: input.event,
      nights: [...part.nights].sort(),
    });
    amount = add(amount, e.amount);
    if (e.amount.amountMinor > 0 || descriptions.length === 0) descriptions.push(e.description);
  }
  return { amount, description: descriptions.join(' ') || 'No charge under the agreed terms.' };
}
