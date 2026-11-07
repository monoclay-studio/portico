import { Decimal } from 'decimal.js';
import { ValidationError } from './errors';

export { Decimal };

/** Integer minor units + ISO 4217 currency. Never use floats for money. */
export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

const EXPONENT_OVERRIDES: Record<string, number> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  CLF: 4,
  UYW: 4,
};

export function currencyExponent(currency: string): number {
  assertCurrency(currency);
  return EXPONENT_OVERRIDES[currency] ?? 2;
}

export function assertCurrency(currency: string): void {
  if (!/^[A-Z]{3}$/.test(currency))
    throw new ValidationError('invalid_currency', `"${currency}" is not an ISO 4217 currency code.`);
}

export function money(amountMinor: number, currency: string): Money {
  assertCurrency(currency);
  if (!Number.isSafeInteger(amountMinor)) {
    throw new ValidationError(
      'invalid_amount',
      `Money amounts must be whole minor units (got ${amountMinor}).`,
    );
  }
  return Object.freeze({ amountMinor, currency });
}

export const zero = (currency: string): Money => money(0, currency);

export type RoundingMode = 'half_up' | 'half_even' | 'down' | 'up';
const DECIMAL_ROUNDING: Record<RoundingMode, Decimal.Rounding> = {
  half_up: Decimal.ROUND_HALF_UP,
  half_even: Decimal.ROUND_HALF_EVEN,
  down: Decimal.ROUND_DOWN,
  up: Decimal.ROUND_UP,
};

/** Convert a major-unit decimal (e.g. "123.45") to Money, rounding once with the given rule. */
export function fromMajor(
  amount: Decimal.Value,
  currency: string,
  rounding: RoundingMode = 'half_up',
): Money {
  const exp = currencyExponent(currency);
  const minor = new Decimal(amount)
    .mul(new Decimal(10).pow(exp))
    .toDecimalPlaces(0, DECIMAL_ROUNDING[rounding]);
  return money(minor.toNumber(), currency);
}

export function toMajor(m: Money): Decimal {
  return new Decimal(m.amountMinor).div(new Decimal(10).pow(currencyExponent(m.currency)));
}

/** Round an arbitrary-precision minor-unit Decimal to Money. */
export function roundMinor(
  minor: Decimal.Value,
  currency: string,
  rounding: RoundingMode = 'half_up',
): Money {
  return money(new Decimal(minor).toDecimalPlaces(0, DECIMAL_ROUNDING[rounding]).toNumber(), currency);
}

function same(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new ValidationError(
      'currency_mismatch',
      `Cannot combine ${a.currency} and ${b.currency} without an explicit exchange rate.`,
    );
  }
}

export function add(a: Money, ...rest: Money[]): Money {
  let total = a.amountMinor;
  for (const m of rest) {
    same(a, m);
    total += m.amountMinor;
  }
  return money(total, a.currency);
}

export function sum(currency: string, items: readonly Money[]): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency));
}

export function subtract(a: Money, b: Money): Money {
  same(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export const negate = (a: Money): Money => money(-a.amountMinor, a.currency);
export const isZero = (a: Money): boolean => a.amountMinor === 0;
export const isNegative = (a: Money): boolean => a.amountMinor < 0;
export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  same(a, b);
  return a.amountMinor === b.amountMinor ? 0 : a.amountMinor < b.amountMinor ? -1 : 1;
}

/** Multiply by a decimal factor (e.g. percentage) with a single rounding. */
export function multiply(a: Money, factor: Decimal.Value, rounding: RoundingMode = 'half_up'): Money {
  return roundMinor(new Decimal(a.amountMinor).mul(factor), a.currency, rounding);
}

/**
 * Split an amount by ratios without creating or losing minor units (largest-remainder method).
 * allocate(money(1000,'USD'), [1,1,1]) → 334, 333, 333.
 */
export function allocate(a: Money, ratios: readonly number[]): Money[] {
  if (ratios.length === 0) throw new ValidationError('invalid_allocation', 'At least one ratio is required.');
  const total = ratios.reduce((s, r) => s + r, 0);
  if (total <= 0 || ratios.some((r) => r < 0)) {
    throw new ValidationError('invalid_allocation', 'Ratios must be non-negative and sum to more than zero.');
  }
  const sign = a.amountMinor < 0 ? -1 : 1;
  const abs = Math.abs(a.amountMinor);
  const raw = ratios.map((r) => new Decimal(abs).mul(r).div(total));
  const floors = raw.map((d) => d.floor().toNumber());
  let remainder = abs - floors.reduce((s, f) => s + f, 0);
  const order = raw
    .map((d, i) => ({ i, frac: d.minus(d.floor()).toNumber() }))
    .sort((x, y) => y.frac - x.frac || x.i - y.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    remainder--;
  }
  return floors.map((f) => money(sign * f, a.currency));
}

/** Explicit FX conversion. Rate = units of `to` per 1 unit of `from` (major units). */
export function convert(
  a: Money,
  to: string,
  rate: Decimal.Value,
  rounding: RoundingMode = 'half_up',
): Money {
  const major = toMajor(a).mul(rate);
  return fromMajor(major, to, rounding);
}

export function formatMoney(m: Money, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(
    toMajor(m).toNumber(),
  );
}
