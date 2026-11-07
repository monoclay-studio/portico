import { BusinessRuleError, Decimal, type LocalDate } from '@portico/kernel';

export interface StoredRate {
  id: string;
  businessDate: LocalDate;
  fromCurrency: string;
  toCurrency: string;
  rate: string;
}

/** Maximum age of a rate used for conversion; older rates require a new entry. */
export const MAX_RATE_AGE_DAYS = 7;

/**
 * Choose the rate to convert `from` → `to` on `date`: the latest rate on or before the date (direct, or the
 * inverse of the opposite pair), not older than MAX_RATE_AGE_DAYS. Returns the effective multiplier.
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
        ((r.fromCurrency === from && r.toCurrency === to) || (r.fromCurrency === to && r.toCurrency === from)),
    )
    .sort((a, b) =>
      a.businessDate === b.businessDate
        ? Number(b.fromCurrency === from) - Number(a.fromCurrency === from)
        : a.businessDate < b.businessDate
          ? 1
          : -1,
    );
  const best = candidates[0];
  if (!best) {
    throw new BusinessRuleError(
      'fx_rate_missing',
      `No exchange rate ${from}→${to} has been entered for ${date} (or the previous ${MAX_RATE_AGE_DAYS} days). A finance user must enter today's rate before amounts in ${from} can be posted.`,
      { from, to, date },
    );
  }
  const inverted = best.fromCurrency !== from;
  const rate = inverted ? new Decimal(1).div(best.rate) : new Decimal(best.rate);
  return { rateId: best.id, rate, rateDate: best.businessDate, inverted };
}
