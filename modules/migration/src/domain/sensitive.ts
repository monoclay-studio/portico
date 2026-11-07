/**
 * Sensitive-content guards that run BEFORE anything from a source file is stored.
 *
 * 1. Card numbers (MG-02, PCI): a primary account number in any cell rejects the whole file. Portico never stores
 *    raw card numbers (CLAUDE.md §5); cards move only PSP-to-PSP (Q142).
 * 2. Masked values (DD11 F4; OPERA exports over insecure delivery, Little Hotelier after 180 days): masked or
 *    redacted personal data is detected and never imported as truth.
 * The findings carry positions only (row, column) — never the value itself.
 */

/** Luhn checksum over a digit string. */
export function luhnValid(digits: string): boolean {
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

/** Issuer ranges and lengths of the major card schemes (keeps OTA references from tripping the guard). */
export function looksLikeCardNumber(digits: string): boolean {
  const n = digits.length;
  if (n < 13 || n > 19 || !luhnValid(digits)) return false;
  const p2 = Number(digits.slice(0, 2));
  const p3 = Number(digits.slice(0, 3));
  const p4 = Number(digits.slice(0, 4));
  if (digits.startsWith('4')) return n === 13 || n === 16 || n === 19; // Visa
  if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) return n === 16; // Mastercard
  if (p2 === 34 || p2 === 37) return n === 15; // American Express
  if (p4 === 6011 || p2 === 65 || (p3 >= 644 && p3 <= 649)) return n >= 16; // Discover
  if (p4 >= 3528 && p4 <= 3589) return n >= 16; // JCB
  if ((p3 >= 300 && p3 <= 305) || p2 === 36 || p2 === 38) return n >= 14; // Diners
  if (p2 === 62) return n >= 16; // UnionPay
  return false;
}

const CARD_CANDIDATE = /(?:\d[ -]?){12,18}\d/g;

export interface CellFinding {
  /** 1-based data row (the header is row 0). */
  row: number;
  column: string;
}

/** Positions of cells that contain something that looks like a card number. */
export function findCardNumbers(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string>>) {
  const findings: CellFinding[] = [];
  rows.forEach((r, ri) => {
    r.forEach((cell, ci) => {
      if (cell.length < 13) return;
      for (const m of cell.matchAll(CARD_CANDIDATE)) {
        const digits = m[0].replace(/[ -]/g, '');
        if (looksLikeCardNumber(digits)) {
          findings.push({ row: ri + 1, column: headers[ci] ?? `column ${ci + 1}` });
          return;
        }
      }
    });
  });
  return findings;
}

const MASK_RUN = /[*•#]{2,}|X{3,}|x{4,}/;
const REDACTION_WORD =
  /^\s*(redacted|hidden|masked|anonymi[sz]ed|removed|gdpr|withheld|not available|n\/a|xxx+)\s*$/i;

/** True when a personal-data value has been masked or redacted by the exporting system. */
export function isMasked(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  if (v.length === 0) return false;
  if (REDACTION_WORD.test(v)) return true;
  if (MASK_RUN.test(v)) return true;
  // Email whose local part or domain is masked (j*****@example.com, john@*****)
  if (v.includes('@') && /\*/.test(v)) return true;
  return false;
}

/** Share of records with at least one masked identity field above which the whole export is refused. */
export const MASKED_FILE_THRESHOLD = 0.2;
