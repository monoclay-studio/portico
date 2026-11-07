/**
 * Value normalization for source exports: dates (ISO, D/M/Y, M/D/Y, 05-Dec-2026, Excel serials), money (decimal
 * strings in many locales → integer minor units, never rounded), booleans and booking-status vocabularies.
 * Ambiguity is reported, never guessed (acceptance criteria §1.3: never convert ambiguous financial information).
 */
import { currencyExponent, isLocalDate, type LocalDate } from '@portico/kernel';
import type { BookingStatus } from './records';

export type DateOrder = 'ymd' | 'dmy' | 'mdy';

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number): LocalDate | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return isLocalDate(iso) ? iso : null;
}

/** Excel's 1900 date system: serial 25569 = 1970-01-01. Only plausible operational dates are accepted. */
export function excelSerialToDate(serial: number): LocalDate | null {
  if (!Number.isInteger(serial) || serial < 29_221 || serial > 73_051) return null; // 1980..2099
  const d = new Date((serial - 25_569) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Which order the numeric dates of a column use: a part above 12 decides it. `null` when every value is
 * ambiguous (e.g. 03/04/2027) — the plan then needs a reviewed decision.
 */
export function detectDateOrder(values: readonly string[]): DateOrder | null {
  let dmy = false;
  let mdy = false;
  for (const v of values) {
    const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(v);
    if (!m) {
      if (/^\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(v)) return 'ymd';
      continue;
    }
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12) dmy = true;
    if (b > 12) mdy = true;
  }
  if (dmy && !mdy) return 'dmy';
  if (mdy && !dmy) return 'mdy';
  return null;
}

export type DateParse =
  | { ok: true; date: LocalDate }
  | { ok: false; reason: 'empty' | 'invalid' | 'ambiguous' };

export function parseDate(
  raw: string | null | undefined,
  opts: { order?: DateOrder | null; spreadsheet?: boolean } = {},
): DateParse {
  const v = (raw ?? '').trim();
  if (!v) return { ok: false, reason: 'empty' };
  if (opts.spreadsheet && /^\d{5}(\.\d+)?$/.test(v)) {
    const d = excelSerialToDate(Math.floor(Number(v)));
    return d ? { ok: true, date: d } : { ok: false, reason: 'invalid' };
  }
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(v);
  if (m) {
    const d = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return d ? { ok: true, date: d } : { ok: false, reason: 'invalid' };
  }
  m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})\.?[\s-](\d{4})(?:[T\s].*)?$/.exec(v);
  if (m) {
    const word = (m[2] as string).toLowerCase();
    const month = MONTHS[word] ?? MONTHS[word.slice(0, 4)] ?? MONTHS[word.slice(0, 3)];
    const d = month ? validDate(Number(m[3]), month, Number(m[1])) : null;
    return d ? { ok: true, date: d } : { ok: false, reason: 'invalid' };
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[T\s].*)?$/.exec(v);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    let order = opts.order ?? null;
    if (a > 12 && b <= 12) order = 'dmy';
    else if (b > 12 && a <= 12) order = 'mdy';
    else if (a === b) order = order ?? 'dmy';
    if (!order || order === 'ymd') return { ok: false, reason: 'ambiguous' };
    const d = order === 'dmy' ? validDate(y, b, a) : validDate(y, a, b);
    return d ? { ok: true, date: d } : { ok: false, reason: 'invalid' };
  }
  return { ok: false, reason: 'invalid' };
}

export type MoneyParse =
  | { ok: true; minor: number }
  | { ok: false; reason: 'empty' | 'invalid' | 'ambiguous_separator' | 'too_precise' };

/**
 * Parse a decimal amount as the source wrote it into integer minor units of `currency`. Accepts symbols, ISO codes,
 * spaces, thousands separators, `-` / trailing `-` / parentheses for negatives. More decimals than the currency has
 * is refused (never rounded); a separator that could be either thousands or decimal is refused.
 */
export function parseMoney(raw: string | null | undefined, currency: string): MoneyParse {
  let v = (raw ?? '').trim();
  if (!v) return { ok: false, reason: 'empty' };
  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1);
  }
  v = v.replace(/[A-Z]{3}/gi, '').replace(/[$€£¥₹]|Rf|MVR|Rs\.?/gi, '');
  v = v.replace(/[\s  ']/g, '');
  if (v.endsWith('-')) {
    negative = !negative;
    v = v.slice(0, -1);
  }
  if (v.startsWith('-')) {
    negative = !negative;
    v = v.slice(1);
  } else if (v.startsWith('+')) v = v.slice(1);
  if (!/^[\d.,]+$/.test(v) || !/\d/.test(v)) return { ok: false, reason: 'invalid' };
  const exp = currencyExponent(currency);
  const lastDot = v.lastIndexOf('.');
  const lastComma = v.lastIndexOf(',');
  let intPart: string;
  let frac = '';
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSep = lastDot > lastComma ? '.' : ',';
    const thousands = decimalSep === '.' ? ',' : '.';
    const idx = v.lastIndexOf(decimalSep);
    intPart = v.slice(0, idx).split(thousands).join('');
    frac = v.slice(idx + 1);
    if (intPart.includes(decimalSep)) return { ok: false, reason: 'invalid' };
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = v.split(sep);
    const tail = parts[parts.length - 1] as string;
    if (parts.length > 2) {
      // 1.250.000 or 1,250,000 — thousands separators only
      if (!parts.slice(1).every((p) => p.length === 3)) return { ok: false, reason: 'invalid' };
      intPart = parts.join('');
    } else if (tail.length === 3 && !/^0*$/.test(parts[0] as string)) {
      // "1,250" is thousands for a 2-decimal currency; "1.250" (or any 3-decimal currency) could be either.
      if (sep === ',' && exp !== 3) intPart = parts.join('');
      else return { ok: false, reason: 'ambiguous_separator' };
    } else {
      intPart = parts[0] as string;
      frac = tail;
    }
  } else {
    intPart = v;
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return { ok: false, reason: 'invalid' };
  if (frac.length > exp) {
    if (/^0*$/.test(frac.slice(exp))) frac = frac.slice(0, exp);
    else return { ok: false, reason: 'too_precise' };
  }
  const minorStr = `${intPart || '0'}${frac.padEnd(exp, '0')}`;
  const minor = Number(minorStr);
  if (!Number.isSafeInteger(minor)) return { ok: false, reason: 'invalid' };
  return { ok: true, minor: negative && minor !== 0 ? -minor : minor };
}

export function parseIntStrict(raw: string | null | undefined): number | null {
  const v = (raw ?? '').trim();
  if (!/^\d{1,4}$/.test(v)) return null;
  return Number(v);
}

export function parseBool(raw: string | null | undefined): boolean | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (['y', 'yes', 'true', '1', 'opt-in', 'opted in', 'subscribed'].includes(v)) return true;
  if (['n', 'no', 'false', '0', 'opt-out', 'opted out', 'unsubscribed'].includes(v)) return false;
  return null;
}

const STATUS_WORDS: Array<[BookingStatus, string[]]> = [
  [
    'confirmed',
    [
      'confirmed',
      'confirm',
      'cnf',
      'conf',
      'booked',
      'reserved',
      'new',
      'guaranteed',
      'definite',
      'due in',
      'duein',
    ],
  ],
  ['tentative', ['tentative', 'ten', 'provisional', 'option', 'unconfirmed', 'enquiry', 'inquiry']],
  [
    'in_house',
    [
      'in house',
      'inhouse',
      'in-house',
      'checked in',
      'checked-in',
      'checkedin',
      'arrived',
      'due out',
      'dueout',
      'pending checkout',
      'stayover',
      'occupied',
      'walk in',
      'walk-in',
      'walkin',
    ],
  ],
  ['departed', ['checked out', 'checked-out', 'checkedout', 'departed', 'completed', 'stayed']],
  ['cancelled', ['cancelled', 'canceled', 'cxl', 'cancel', 'cancellation']],
  ['no_show', ['no show', 'no-show', 'noshow', 'ns']],
];
const STATUS_INDEX = new Map<string, BookingStatus>(
  STATUS_WORDS.flatMap(([status, words]) => words.map((w) => [w, status] as const)),
);

/** Known booking-status words → normalized status; unknown words return null (a mapping decision is needed). */
export function normalizeStatus(raw: string): BookingStatus | null {
  const key = raw.trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');
  return STATUS_INDEX.get(key) ?? null;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v : null;
}

export function cleanText(raw: string | null | undefined, max = 200): string | null {
  const v = (raw ?? '').replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, max) : null;
}
