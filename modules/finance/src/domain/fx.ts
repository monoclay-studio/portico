import { BusinessRuleError, Decimal, type LocalDate } from '@portico/kernel';

export interface StoredRate {
  id: string;
  businessDate: LocalDate;
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  source?: string;
}

/** Central-bank reference rates (e.g. Maldives Monetary Authority) are recorded with a source starting "MMA". */
export const isReferenceRate = (source: string | undefined) => !!source && /^mma\b/i.test(source);

/**
 * Maximum age of a rate used for conversion (ADR-0016 §3): 0 — a posting or invoice needs a rate for its own business
 * date. A missing rate blocks the action; an authorized user enters a reference (MMA) rate or a manual rate with its
 * source and a reason. Never a silent fallback to an older rate.
 */
export const MAX_RATE_AGE_DAYS = 0;

/**
 * Choose the rate to convert `from` → `to` on `date`: the latest rate on or before the date (direct, or the
 * inverse of the opposite pair), not older than `minDate` (services pass the date itself, MAX_RATE_AGE_DAYS = 0).
 * Returns the effective multiplier.
 */
export function pickRate(
  rates: readonly StoredRate[],
  from: string,
  to: string,
  date: LocalDate,
  minDate: LocalDate,
): { rateId: string; rate: Decimal; rateDate: LocalDate; inverted: boolean } {
  const candidates = rates
    .filter(
      (r) =>
        r.businessDate <= date &&
        r.businessDate >= minDate &&
        ((r.fromCurrency === from && r.toCurrency === to) ||
          (r.fromCurrency === to && r.toCurrency === from)),
    )
    .sort((a, b) => {
      if (a.businessDate !== b.businessDate) return a.businessDate < b.businessDate ? 1 : -1;
      // Same date: the hotel's operational rate before the reference rate, then direct before inverse.
      const ref = Number(isReferenceRate(a.source)) - Number(isReferenceRate(b.source));
      if (ref !== 0) return ref;
      return Number(b.fromCurrency === from) - Number(a.fromCurrency === from);
    });
  const best = candidates[0];
  if (!best) {
    throw new BusinessRuleError(
      'fx_rate_missing',
      `No exchange rate ${from}→${to} has been entered for ${date}. Enter the rate for this business date (the MMA reference rate, or a manual rate with its source and a reason) before amounts in ${from} can be posted. Older rates are never used automatically.`,
      { from, to, date },
    );
  }
  const inverted = best.fromCurrency !== from;
  const rate = inverted ? new Decimal(1).div(best.rate) : new Decimal(best.rate);
  return { rateId: best.id, rate, rateDate: best.businessDate, inverted };
}
