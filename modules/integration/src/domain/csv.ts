/**
 * RFC 4180 CSV parsing and writing for the file-based connector. Handles quoted fields, escaped quotes,
 * embedded commas and newlines, CRLF/LF and a UTF-8 BOM. Pure logic — no IO.
 */

export class CsvError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
  }
}

export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let i = 0;
  while (i < input.length) {
    const c = input[i] as string;
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (c === '\n') line++;
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      if (field.length > 0)
        throw new CsvError(`Unexpected quote inside an unquoted field on line ${line}.`, line);
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (c === '\r' && input[i + 1] === '\n') i++;
      i++;
      line++;
      continue;
    }
    field += c;
    i++;
  }
  if (inQuotes) throw new CsvError(`A quoted field is not closed (started before line ${line}).`, line);
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** Parse with a header row into records keyed by trimmed header names. */
export function parseCsvRecords(text: string): { headers: string[]; records: Array<Record<string, string>> } {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) return { headers: [], records: [] };
  const headers = header.map((h) => h.trim());
  const records = rows.slice(1).map((r, idx) => {
    if (r.length !== headers.length) {
      throw new CsvError(
        `Row ${idx + 2} has ${r.length} columns but the header has ${headers.length}. Check for missing or extra commas.`,
        idx + 2,
      );
    }
    return Object.fromEntries(headers.map((h, j) => [h, r[j] ?? '']));
  });
  return { headers, records };
}

function escapeField(value: string): string {
  // Neutralize spreadsheet formula injection for values that will be opened in spreadsheet software.
  const safe = /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function writeCsv(
  headers: readonly string[],
  rows: ReadonlyArray<Record<string, string | number | null>>,
): string {
  const lines = [headers.map(escapeField).join(',')];
  for (const r of rows) {
    lines.push(
      headers.map((h) => escapeField(r[h] === null || r[h] === undefined ? '' : String(r[h]))).join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
