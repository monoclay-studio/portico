/**
 * Payment card number (PAN) detection — pure, no IO, one implementation for every boundary that must refuse card
 * data (file imports, provider payloads, free-text fields). Portico never stores raw card numbers (CLAUDE.md §5).
 *
 * ## The rule
 *
 * A text contains a card number when a sequence of digits that can be read from it **at any offset**, ignoring the
 * separators between digits, passes the Luhn check and (in the default `issuer` mode) starts with an issuer prefix
 * at a length that issuer uses. Concretely:
 *
 * 1. Every code point is normalised with NFKC (full-width `４`, circled `①`, superscript `¹`, mathematical digits …)
 *    and any remaining Unicode decimal digit (`\p{Nd}`: Arabic-Indic, Devanagari, Thai …) counts as its value.
 * 2. Digits stay in one number across **separators**: every character that is not a letter, not a digit and not
 *    `+` — spaces of any width or count (U+00A0, U+2007, U+202F …), tabs and line breaks, `.` `-` `/` `,` `_`
 *    and other punctuation and symbols, combining marks, and invisible format characters (zero-width space, soft
 *    hyphen). A **letter**, a non-decimal numeral or a **`+`** ends the number (`+` starts a phone number; card
 *    numbers are never written with one).
 * 3. Inside each such digit run a window of every allowed length slides over every offset, so neighbouring digits
 *    never hide a card number (`room 12 4111…`, `4111 1111 1111 1111 12/27`, `…1111 1227 cvv`).
 * 4. Numbers in exponent form (`4.111111111111111E15`, how spreadsheets write long numbers) are expanded first.
 * 5. Spreadsheet precision loss: a number (the whole text, or one in exponent form) of 16–19 integer digits, whose
 *    digits after the 15th are zeros, with at least 14 significant digits and an issuer prefix for that length, is
 *    reported **without** the Luhn check — a spreadsheet keeps 15 significant digits, the lost digit is the check
 *    digit, and it can be recomputed, so the value still identifies the card. (`4.1E+15` is not reported.)
 *
 * ## Modes
 *
 * - `issuer` (default): Luhn + issuer prefix + that issuer's lengths (`CARD_ISSUERS`), 14–19 digits. Legacy 12- and
 *   13-digit lengths (13-digit Visa, 12/13-digit Maestro) are not reported in this mode: 13-digit international
 *   mobile numbers (+49 15…, +43 6…, +62 8…, often stored without the `+` in spreadsheets) pass Luhn one time in
 *   ten, so reporting that length would refuse almost every real guest list.
 * - `luhn`: any Luhn-valid sequence of 12–19 digits not starting with 0 — for fields that must never hold a long
 *   number at all.
 *
 * ## Documented false positives (accepted; the caller names the position, never the value, and the person removes it)
 *
 * - About one random digit sequence in ten passes Luhn; so a long reference (OTA, bank, voucher) of 14–19 digits
 *   with an issuer prefix is reported about one time in ten.
 * - Digits of *different* numbers in the same text join when only separators stand between them: `0151 2345678 /
 *   030 1234567` or `450.00 / 520.00 / 380.00 / 410.00` can be reported. Put such values in separate fields or
 *   separate them with words.
 * - A whole-text 16–19-digit number ending in zeros, with 14+ significant digits and an issuer prefix, is reported
 *   by rule 5.
 *
 * ## Documented false negatives (deliberate)
 *
 * - Legacy 12/13-digit lengths in `issuer` mode (reported in `luhn` mode).
 * - Digits interleaved with letters (`4111x1111x…`), numbers written as words, and partially masked numbers
 *   (`4111 11** **** 1111` — a masked number is not a card number).
 *
 * Findings carry the position and the scheme, never the digits.
 */

export type CardScheme =
  | 'visa'
  | 'mastercard'
  | 'amex'
  | 'diners'
  | 'discover'
  | 'jcb'
  | 'unionpay'
  | 'maestro'
  | 'rupay'
  | 'mir'
  | 'troy'
  | 'uatp'
  | 'verve';

interface IssuerRule {
  scheme: CardScheme;
  /** Inclusive prefix range; both ends have the same number of digits. */
  from: string;
  to: string;
  lengths: readonly number[];
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/**
 * Issuer prefixes (IIN ranges) and the PAN lengths each issues, as published in the schemes' public BIN guidance
 * (summarised; detection only — never used to route or validate payments). Order does not matter.
 */
export const CARD_ISSUERS: readonly IssuerRule[] = [
  { scheme: 'visa', from: '4', to: '4', lengths: [16, 19] },
  { scheme: 'mastercard', from: '51', to: '55', lengths: [16] },
  { scheme: 'mastercard', from: '2221', to: '2720', lengths: [16] },
  { scheme: 'amex', from: '34', to: '34', lengths: [15] },
  { scheme: 'amex', from: '37', to: '37', lengths: [15] },
  { scheme: 'diners', from: '300', to: '305', lengths: range(14, 19) },
  { scheme: 'diners', from: '3095', to: '3095', lengths: range(14, 19) },
  { scheme: 'diners', from: '36', to: '36', lengths: range(14, 19) },
  { scheme: 'diners', from: '38', to: '39', lengths: range(16, 19) },
  { scheme: 'jcb', from: '3528', to: '3589', lengths: range(16, 19) },
  { scheme: 'discover', from: '6011', to: '6011', lengths: range(16, 19) },
  { scheme: 'discover', from: '644', to: '649', lengths: range(16, 19) },
  { scheme: 'discover', from: '65', to: '65', lengths: range(16, 19) },
  { scheme: 'unionpay', from: '62', to: '62', lengths: range(16, 19) },
  { scheme: 'unionpay', from: '81', to: '81', lengths: range(16, 19) },
  { scheme: 'maestro', from: '50', to: '50', lengths: range(14, 19) },
  { scheme: 'maestro', from: '56', to: '69', lengths: range(14, 19) },
  { scheme: 'rupay', from: '60', to: '60', lengths: [16] },
  { scheme: 'rupay', from: '82', to: '82', lengths: [16] },
  { scheme: 'rupay', from: '508', to: '508', lengths: [16] },
  { scheme: 'mir', from: '2200', to: '2204', lengths: range(16, 19) },
  { scheme: 'troy', from: '9792', to: '9792', lengths: [16] },
  { scheme: 'uatp', from: '1', to: '1', lengths: [15] },
  { scheme: 'verve', from: '506099', to: '506198', lengths: [16, 18, 19] },
];

export type PanMatchMode = 'issuer' | 'luhn';

export interface PanScanOptions {
  /** `issuer` (default) or `luhn` — see the module comment. */
  mode?: PanMatchMode;
}

export interface PanFinding {
  /** The issuer whose prefix and length match; `null` in `luhn` mode when no issuer matches. */
  scheme: CardScheme | null;
  /** Number of digits of the card number found. */
  length: number;
  /** How it was written: digits only, digits with separators, exponent form, or a spreadsheet-rounded number. */
  form: 'contiguous' | 'separated' | 'exponent' | 'precision_loss';
  /** UTF-16 offsets in the input text of the first character and one past the last character of the finding. */
  start: number;
  end: number;
}

/** Shortest and longest lengths reported per mode. */
export const PAN_LENGTHS: Readonly<Record<PanMatchMode, { min: number; max: number }>> = {
  issuer: { min: 14, max: 19 },
  luhn: { min: 12, max: 19 },
};

/** Luhn checksum over an ASCII digit string. */
export function luhnValid(digits: string): boolean {
  if (digits.length === 0) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** The issuer whose prefix range and length match an ASCII digit string (no Luhn check), or `null`. */
export function cardIssuer(digits: string): CardScheme | null {
  if (!/^\d+$/.test(digits)) return null;
  return issuerAt(digits, 0, digits.length);
}

/** True when an ASCII digit string is a card number (Luhn + issuer prefix + length in `issuer` mode). */
export function isCardNumber(digits: string, options: PanScanOptions = {}): boolean {
  if (!/^\d+$/.test(digits)) return false;
  return checkWindow(digits, 0, digits.length, luhnSums(digits), options.mode ?? 'issuer') !== undefined;
}

// ─────────────────────────────────────── tokenising ───────────────────────────────────────

type Token = { kind: 'digit'; value: number } | { kind: 'break' } | { kind: 'sep'; ch: string };

const ND = /\p{Nd}/u;
const WORDISH = /[\p{L}\p{N}]/u;
const tokenCache = new Map<number, Token[]>();

/** Value of a Unicode decimal digit: Nd characters are encoded in contiguous runs of ten, 0 to 9 (Unicode policy). */
function decimalValue(cp: number): number {
  if (cp >= 48 && cp <= 57) return cp - 48;
  let k = 0;
  while (k < 100 && ND.test(String.fromCodePoint(cp - k - 1))) k++;
  return k % 10;
}

function tokensOf(cp: number): Token[] {
  if (cp < 128) {
    if (cp >= 48 && cp <= 57) return [{ kind: 'digit', value: cp - 48 }];
    if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || cp === 43) return [{ kind: 'break' }];
    return [{ kind: 'sep', ch: String.fromCharCode(cp) }];
  }
  const cached = tokenCache.get(cp);
  if (cached) return cached;
  const out: Token[] = [];
  for (const ch of String.fromCodePoint(cp).normalize('NFKC')) {
    const c = ch.codePointAt(0) as number;
    if (c < 128) out.push(...tokensOf(c));
    else if (ND.test(ch)) out.push({ kind: 'digit', value: decimalValue(c) });
    else if (WORDISH.test(ch)) out.push({ kind: 'break' });
    else out.push({ kind: 'sep', ch });
  }
  if (tokenCache.size < 4096) tokenCache.set(cp, out);
  return out;
}

interface Run {
  digits: string;
  /** Original offsets of each digit's source character. */
  starts: number[];
  ends: number[];
  /** True when a separator stands between digit i-1 and digit i. */
  gapBefore: boolean[];
}

interface Mapped {
  runs: Run[];
  /** The normalised text (digits as ASCII, letters kept, `+` kept, separators kept) for numeric-form checks. */
  text: string;
  textStarts: number[];
  textEnds: number[];
}

function mapText(input: string): Mapped {
  const runs: Run[] = [];
  let run: Run = { digits: '', starts: [], ends: [], gapBefore: [] };
  let gap = false;
  let text = '';
  const textStarts: number[] = [];
  const textEnds: number[] = [];
  const flush = () => {
    if (run.digits.length > 0) runs.push(run);
    run = { digits: '', starts: [], ends: [], gapBefore: [] };
    gap = false;
  };
  for (let i = 0; i < input.length; ) {
    const cp = input.codePointAt(i) as number;
    const next = i + (cp > 0xffff ? 2 : 1);
    for (const t of tokensOf(cp)) {
      let ch: string;
      if (t.kind === 'digit') {
        ch = String.fromCharCode(48 + t.value);
        run.digits += ch;
        run.starts.push(i);
        run.ends.push(next);
        run.gapBefore.push(gap && run.digits.length > 1);
        gap = false;
      } else if (t.kind === 'break') {
        flush();
        const raw = cp < 128 ? String.fromCharCode(cp) : String.fromCodePoint(cp).normalize('NFKC');
        ch = raw.length === 1 ? raw : 'x';
      } else {
        if (run.digits.length > 0) gap = true;
        ch = t.ch;
      }
      for (let u = 0; u < ch.length; u++) {
        textStarts.push(i);
        textEnds.push(next);
      }
      text += ch;
    }
    i = next;
  }
  flush();
  return { runs, text, textStarts, textEnds };
}

// ─────────────────────────────────────── matching ───────────────────────────────────────

/**
 * Prefix sums for O(1) Luhn over any window: `a[k]` doubles digits at even indexes, `b[k]` at odd indexes. In a
 * window ending at `end` (exclusive) the digits doubled are those whose index has the parity of `end`.
 */
function luhnSums(digits: string): { a: Int32Array; b: Int32Array } {
  const n = digits.length;
  const a = new Int32Array(n + 1);
  const b = new Int32Array(n + 1);
  for (let j = 0; j < n; j++) {
    const d = digits.charCodeAt(j) - 48;
    const dd = d * 2 > 9 ? d * 2 - 9 : d * 2;
    a[j + 1] = (a[j] as number) + (j % 2 === 0 ? dd : d);
    b[j + 1] = (b[j] as number) + (j % 2 === 1 ? dd : d);
  }
  return { a, b };
}

function windowLuhn(sums: { a: Int32Array; b: Int32Array }, start: number, end: number): boolean {
  const arr = end % 2 === 0 ? sums.a : sums.b;
  return ((arr[end] as number) - (arr[start] as number)) % 10 === 0;
}

interface CompiledRule {
  scheme: CardScheme;
  prefixLength: number;
  from: number;
  to: number;
  /** Bit n set = length n allowed. */
  lengths: number;
}

const COMPILED: readonly CompiledRule[] = CARD_ISSUERS.map((r) => ({
  scheme: r.scheme,
  prefixLength: r.from.length,
  from: Number(r.from),
  to: Number(r.to),
  lengths: r.lengths.reduce((m, n) => m | (1 << n), 0),
}));

/** Numeric value of the first 1…6 digits at `start` (index = prefix length). */
function prefixes(digits: string, start: number): number[] {
  const out = [0];
  let v = 0;
  for (let k = 0; k < 6 && start + k < digits.length; k++) {
    v = v * 10 + (digits.charCodeAt(start + k) - 48);
    out.push(v);
  }
  return out;
}

function issuerAt(
  digits: string,
  start: number,
  length: number,
  pre = prefixes(digits, start),
): CardScheme | null {
  for (const r of COMPILED) {
    if ((r.lengths & (1 << length)) === 0) continue;
    const p = pre[r.prefixLength];
    if (p !== undefined && p >= r.from && p <= r.to) return r.scheme;
  }
  return null;
}

/** Bitmask of the lengths any issuer allows for the prefix at `start`. */
function issuerLengths(pre: number[]): number {
  let mask = 0;
  for (const r of COMPILED) {
    const p = pre[r.prefixLength];
    if (p !== undefined && p >= r.from && p <= r.to) mask |= r.lengths;
  }
  return mask;
}

/** `undefined` = not a card; otherwise the scheme (`null` allowed in `luhn` mode). */
function checkWindow(
  digits: string,
  start: number,
  length: number,
  sums: { a: Int32Array; b: Int32Array },
  mode: PanMatchMode,
): CardScheme | null | undefined {
  const { min, max } = PAN_LENGTHS[mode];
  if (length < min || length > max || digits.charCodeAt(start) === 48) return undefined;
  const scheme = issuerAt(digits, start, length);
  if (mode === 'issuer' && scheme === null) return undefined;
  if (!windowLuhn(sums, start, start + length)) return undefined;
  return scheme;
}

/** First window (earliest offset, then shortest length) of a digit string that is a card number. */
function scanDigits(
  digits: string,
  mode: PanMatchMode,
): { start: number; length: number; scheme: CardScheme | null } | null {
  const { min, max } = PAN_LENGTHS[mode];
  if (digits.length < min) return null;
  const sums = luhnSums(digits);
  for (let start = 0; start + min <= digits.length; start++) {
    if (digits.charCodeAt(start) === 48) continue;
    const pre = prefixes(digits, start);
    const allowed = mode === 'issuer' ? issuerLengths(pre) : -1;
    if (allowed === 0) continue;
    for (let length = min; length <= max && start + length <= digits.length; length++) {
      if ((allowed & (1 << length)) === 0) continue;
      if (!windowLuhn(sums, start, start + length)) continue;
      return { start, length, scheme: issuerAt(digits, start, length, pre) };
    }
  }
  return null;
}

/** Spreadsheet rounding (rule 5): 16–19 integer digits, zeros after the 15th, issuer prefix for that length. */
function precisionLoss(intDigits: string, mode: PanMatchMode): CardScheme | undefined {
  const n = intDigits.length;
  if (n < 16 || n > 19 || !/^0+$/.test(intDigits.slice(15))) return undefined;
  if (intDigits.replace(/0+$/, '').length < PAN_LENGTHS[mode].min) return undefined;
  return issuerAt(intDigits, 0, n) ?? undefined;
}

function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) return false;
  return true;
}

const EXPONENT = /([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d{1,3})/g;
const WHOLE_NUMBER = /^\s*[+-]?(\d+)(?:\.0*)?\s*$/;

function expandExponent(intPart: string, frac: string, exp: number): string | null {
  if (exp < 0 || exp > 40) return null;
  const all = intPart + frac;
  const intLen = intPart.length + exp;
  const digits = intLen <= all.length ? all.slice(0, intLen) : all + '0'.repeat(intLen - all.length);
  return digits.replace(/^0+/, '');
}

/**
 * The first card number in a text, or `null`. See the module comment for the rule, the modes and the documented
 * false positives / negatives.
 */
export function findPan(text: string, options: PanScanOptions = {}): PanFinding | null {
  const mode = options.mode ?? 'issuer';
  const { min } = PAN_LENGTHS[mode];
  // Fast exit: ASCII text with fewer digits than the shortest card number.
  if (isAscii(text)) {
    let n = 0;
    for (let i = 0; i < text.length && n < min; i++) {
      const c = text.charCodeAt(i);
      if (c >= 48 && c <= 57) n++;
    }
    if (n < min) return null;
  }
  const mapped = mapText(text);
  for (const run of mapped.runs) {
    const hit = scanDigits(run.digits, mode);
    if (!hit) continue;
    let separated = false;
    for (let j = hit.start + 1; j < hit.start + hit.length; j++) if (run.gapBefore[j]) separated = true;
    return {
      scheme: hit.scheme,
      length: hit.length,
      form: separated ? 'separated' : 'contiguous',
      start: run.starts[hit.start] as number,
      end: run.ends[hit.start + hit.length - 1] as number,
    };
  }
  const at = (from: number, to: number) => ({
    start: mapped.textStarts[from] ?? 0,
    end: mapped.textEnds[to - 1] ?? text.length,
  });
  for (const m of mapped.text.matchAll(EXPONENT)) {
    const digits = expandExponent(m[2] as string, m[3] ?? '', Number(m[4]));
    if (!digits) continue;
    const index = m.index ?? 0;
    const hit = scanDigits(digits, mode);
    if (hit) {
      return { scheme: hit.scheme, length: hit.length, form: 'exponent', ...at(index, index + m[0].length) };
    }
    const lost = precisionLoss(digits, mode);
    if (lost !== undefined) {
      return {
        scheme: lost,
        length: digits.length,
        form: 'precision_loss',
        ...at(index, index + m[0].length),
      };
    }
  }
  const whole = WHOLE_NUMBER.exec(mapped.text);
  if (whole) {
    const digits = (whole[1] as string).replace(/^0+/, '');
    const lost = precisionLoss(digits, mode);
    if (lost !== undefined) {
      return { scheme: lost, length: digits.length, form: 'precision_loss', start: 0, end: text.length };
    }
  }
  return null;
}

/** True when the text contains a card number (see `findPan`). */
export function containsPan(text: string, options: PanScanOptions = {}): boolean {
  return findPan(text, options) !== null;
}
