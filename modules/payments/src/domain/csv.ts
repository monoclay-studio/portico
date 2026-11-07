/**
 * Settlement statement CSV parsing (file-based import, clearly labeled as such). Expected header (case- and
 * order-insensitive): date, amount, currency, reference [, approval_code, last4, type, description].
 * Amounts are decimal MAJOR units ("840.00", "-120.50"); they are converted to minor units exactly, never via
 * floating point. Refund lines are negative, or positive with type=refund.
 */
import { BusinessRuleError, currencyExponent, isLocalDate, type LocalDate, ValidationError } from '@portico/kernel';

export interface ParsedStatementLine {
  lineNo: number;
  day: LocalDate;
  currency: string;
  amountMinor: number;
  reference: string | null;
  approvalCode: string | null;
  cardLast4: string | null;
  description: string | null;
}

/** RFC 4180-style record splitting: quotes, escaped quotes, commas and newlines inside quotes. */
export function parseCsvRecords(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (inQuotes) throw new ValidationError('csv_unterminated_quote', 'The file has an unterminated quoted field.');
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim().length > 0));
}

/** Exact decimal-string → minor units. Rejects more decimals than the currency allows. */
export function majorToMinor(value: string, currency: string): number {
  const v = value.trim().replace(/,/g, '');
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(v);
  if (!m) throw new ValidationError('invalid_amount', `"${value}" is not a valid amount.`);
  const exp = currencyExponent(currency);
  const frac = m[3] ?? '';
  if (frac.length > exp) {
    throw new ValidationError(
      'invalid_amount',
      `"${value}" has more decimal places than ${currency} allows (${exp}).`,
    );
  }
  const digits = `${m[2]}${frac.padEnd(exp, '0')}`;
  const n = Number(digits);
  if (!Number.isSafeInteger(n)) throw new ValidationError('invalid_amount', `"${value}" is too large.`);
  return m[1] ? -n : n;
}

const REQUIRED = ['date', 'amount', 'currency'] as const;

export function parseStatementCsv(text: string, opts: { maxLines?: number } = {}): ParsedStatementLine[] {
  const records = parseCsvRecords(text);
  const header = records[0]?.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  if (!header) throw new ValidationError('csv_empty', 'The statement file is empty.');
  for (const r of REQUIRED) {
    if (!header.includes(r)) {
      throw new ValidationError(
        'csv_missing_column',
        `The statement file has no "${r}" column. Expected columns: date, amount, currency, reference (and optionally approval_code, last4, type, description).`,
        { column: r },
      );
    }
  }
  const col = (name: string) => header.indexOf(name);
  const max = opts.maxLines ?? 20_000;
  if (records.length - 1 > max) {
    throw new BusinessRuleError('csv_too_large', `The file has more than ${max} lines; split it by date range.`);
  }
  const out: ParsedStatementLine[] = [];
  for (let i = 1; i < records.length; i++) {
    const r = records[i] as string[];
    const lineNo = i;
    const get = (name: string) => {
      const idx = col(name);
      if (idx < 0) return null;
      const v = (r[idx] ?? '').trim();
      return v.length > 0 ? v : null;
    };
    const day = get('date');
    if (!day || !isLocalDate(day)) {
      throw new ValidationError('csv_invalid_date', `Line ${lineNo}: date must be YYYY-MM-DD (got "${day ?? ''}").`, {
        lineNo,
      });
    }
    const currency = (get('currency') ?? '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ValidationError('csv_invalid_currency', `Line ${lineNo}: currency must be a 3-letter ISO code.`, {
        lineNo,
      });
    }
    let amountMinor: number;
    try {
      amountMinor = majorToMinor(get('amount') ?? '', currency);
    } catch (err) {
      throw new ValidationError('csv_invalid_amount', `Line ${lineNo}: ${(err as Error).message}`, { lineNo });
    }
    const type = (get('type') ?? '').toLowerCase();
    if ((type === 'refund' || type === 'reversal') && amountMinor > 0) amountMinor = -amountMinor;
    if (amountMinor === 0) {
      throw new ValidationError('csv_zero_amount', `Line ${lineNo}: amount cannot be zero.`, { lineNo });
    }
    const last4 = get('last4') ?? get('card_last4');
    if (last4 && !/^\d{4}$/.test(last4)) {
      throw new ValidationError(
        'csv_invalid_last4',
        `Line ${lineNo}: last4 must be exactly 4 digits. Never put full card numbers in statement files.`,
        { lineNo },
      );
    }
    out.push({
      lineNo,
      day,
      currency,
      amountMinor,
      reference: get('reference'),
      approvalCode: get('approval_code'),
      cardLast4: last4,
      description: get('description'),
    });
  }
  if (out.length === 0) throw new ValidationError('csv_no_lines', 'The statement file has a header but no lines.');
  return out;
}
