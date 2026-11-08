/**
 * Sensitive-content guards that run BEFORE anything from a source file is stored.
 *
 * 1. Card numbers (MG-02, PCI): a primary account number in any cell, header, sheet name, workbook string or file
 *    name rejects the whole file, and in any value a system sends rejects that read. Detection is the kernel's
 *    `findPan` (one rule for every boundary). Portico never stores raw card numbers (CLAUDE.md §5); cards move only
 *    PSP-to-PSP (Q142).
 * 2. Masked values (DD11 F4; OPERA exports over insecure delivery, Little Hotelier after 180 days): masked or
 *    redacted personal data is detected and never imported as truth.
 * The findings carry positions only (row, column) — never the value itself.
 */

import { findPan } from '@portico/kernel';

export interface CellFinding {
  /** 1-based data row; 0 is the header row. */
  row: number;
  column: string;
}

/** True when a text holds a card number by the kernel rule (`findPan`, issuer mode — see its documentation). */
export function hasCardNumber(text: string): boolean {
  return findPan(text) !== null;
}

/**
 * Positions of cells (headers included, as row 0) that contain a card number. Every cell is scanned in full with
 * the kernel detector (any offset, any separators, any Unicode digits, exponent forms, spreadsheet rounding).
 */
export function findCardNumbers(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string>>,
): CellFinding[] {
  const findings: CellFinding[] = [];
  const columnName = (ci: number) => {
    const h = headers[ci];
    return h !== undefined && !hasCardNumber(h) ? h : `column ${ci + 1}`;
  };
  headers.forEach((h, ci) => {
    if (hasCardNumber(h)) findings.push({ row: 0, column: `column ${ci + 1}` });
  });
  rows.forEach((r, ri) => {
    r.forEach((cell, ci) => {
      if (hasCardNumber(cell)) findings.push({ row: ri + 1, column: columnName(ci) });
    });
  });
  return findings;
}

/**
 * Paths of every string, number and object key inside a value that holds a card number — the scan that runs on
 * whatever a system sends (simulator snapshot, rehearsal copy, future connectors) before it is stored. Paths use
 * indexes and field names; a field name that itself holds a card number is reported as `<field name>`.
 */
export function findCardNumbersInValue(value: unknown, path = '$', out: string[] = [], limit = 20): string[] {
  if (out.length >= limit) return out;
  if (typeof value === 'string') {
    if (hasCardNumber(value)) out.push(path);
  } else if (typeof value === 'number' || typeof value === 'bigint') {
    if (hasCardNumber(String(value))) out.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => {
      findCardNumbersInValue(v, `${path}[${i}]`, out, limit);
    });
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const name = hasCardNumber(k) ? '<field name>' : k;
      if (name !== k) out.push(`${path}.${name}`);
      findCardNumbersInValue(v, `${path}.${name}`, out, limit);
    }
  }
  return out;
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
