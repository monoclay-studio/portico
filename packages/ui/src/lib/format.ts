import { type LocalDate, toUtcDate } from './dates';

/**
 * Formatting helpers. Money is integer minor units + ISO currency (never floats in storage or math); conversion
 * to a display string happens only here, using the currency's own minor-unit digits from Intl.
 */
export interface MoneyValue {
  amountMinor: number;
  currency: string;
}

export function currencyDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/**
 * Money with its ISO code ("USD 1,234.50", ux-principles §2): several currencies (USD, MVR) are in play at once,
 * so a bare "$" is ambiguous.
 */
export function formatMoney(
  money: MoneyValue,
  locale = 'en',
  opts: { signDisplay?: 'auto' | 'always' | 'exceptZero'; display?: 'code' | 'symbol' } = {},
): string {
  const digits = currencyDigits(money.currency);
  const major = money.amountMinor / 10 ** digits;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: opts.signDisplay ?? 'auto',
    currencyDisplay: opts.display ?? 'code',
  }).format(major);
}

export function formatLocalDate(
  date: LocalDate,
  locale = 'en',
  style: 'short' | 'medium' | 'long' = 'medium',
): string {
  const opts: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { day: 'numeric', month: 'short' }
      : style === 'medium'
        ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
        : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(toUtcDate(date));
}

/** "3 min ago", "in 2 h" — relative to `now` (pass the clock in; never read the wall clock implicitly in tests). */
export function formatRelative(iso: string, now: Date, locale = 'en'): string {
  const diffSec = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86_400), 'day');
}

/** Time of day in the property's time zone, e.g. 10:55. */
export function formatTime(iso: string, timeZone: string, locale = 'en'): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(iso));
}
