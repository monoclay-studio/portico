/**
 * RFC 4180 CSV reader for migration packs: quoted fields, doubled quotes, embedded line breaks, UTF-8 BOM, CRLF,
 * and delimiter detection (comma, semicolon, tab, pipe — spreadsheet exports in many locales use `;`).
 * Pure; bounded so a hostile file cannot exhaust memory.
 */
import { ValidationError } from '@portico/kernel';

export interface Table {
  headers: string[];
  /** Data rows (header excluded). Short rows are padded with ''; extra cells are kept. */
  rows: string[][];
  delimiter: string;
}

export const CSV_LIMITS = { maxBytes: 20 * 1024 * 1024, maxRows: 200_000, maxColumns: 200, maxCell: 10_000 };

const CANDIDATES = [',', ';', '\t', '|'] as const;

/** Pick the delimiter that splits the first (header) line into the most stable number of columns. */
export function detectDelimiter(text: string): string {
  const firstLines = text.split(/\r?\n/).slice(0, 5);
  let best: string = ',';
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const counts = firstLines.filter((l) => l.length > 0).map((l) => splitOutsideQuotes(l, d));
    if (counts.length === 0) continue;
    const first = counts[0] ?? 0;
    if (first < 2) continue;
    const consistent = counts.every((c) => c === first);
    const score = first * (consistent ? 2 : 1);
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function splitOutsideQuotes(line: string, d: string): number {
  let n = 1;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === d && !quoted) n++;
  }
  return n;
}

export function parseCsv(input: string, opts: { delimiter?: string } = {}): Table {
  if (input.length > CSV_LIMITS.maxBytes)
    throw new ValidationError(
      'file_too_large',
      `This file is larger than ${CSV_LIMITS.maxBytes / 1024 / 1024} MB. Split it (for example by arrival year) and upload the parts.`,
    );
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const d = opts.delimiter ?? detectDelimiter(text);
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const pushCell = () => {
    if (cell.length > CSV_LIMITS.maxCell)
      throw new ValidationError(
        'cell_too_long',
        `Row ${records.length + 1} has a cell longer than ${CSV_LIMITS.maxCell} characters. Check that quotes are balanced in the export.`,
      );
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    if (row.length > CSV_LIMITS.maxColumns)
      throw new ValidationError(
        'too_many_columns',
        `Row ${records.length + 1} has more than ${CSV_LIMITS.maxColumns} columns.`,
      );
    if (!(row.length === 1 && row[0] === '')) records.push(row);
    if (records.length > CSV_LIMITS.maxRows + 1)
      throw new ValidationError(
        'too_many_rows',
        `This file has more than ${CSV_LIMITS.maxRows} rows. Split it and upload the parts.`,
      );
    row = [];
  };
  while (i < text.length) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell.length === 0) {
      quoted = true;
      i++;
      continue;
    }
    if (ch === d) {
      pushCell();
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  if (quoted)
    throw new ValidationError(
      'unbalanced_quotes',
      'A quoted cell is never closed. Re-export the file (or open and save it again as CSV) and upload it again.',
    );
  if (cell.length > 0 || row.length > 0) pushRow();
  const [headers, ...rows] = records;
  if (!headers) throw new ValidationError('empty_file', 'The file is empty.');
  const width = headers.length;
  return {
    headers: headers.map((h) => h.trim()),
    rows: rows.map((r) => (r.length < width ? [...r, ...new Array(width - r.length).fill('')] : r)),
    delimiter: d,
  };
}

/** Render rows as CSV (templates and the rollback worklist). Cells that could run as formulas are quoted. */
export function toCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string>>): string {
  const esc = (v: string) => {
    // A cell that a spreadsheet would run as a formula is neutralized; plain negative numbers are kept as numbers.
    const safe = /^[=+\-@\t\r]/.test(v) && !/^-\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
    return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
}
