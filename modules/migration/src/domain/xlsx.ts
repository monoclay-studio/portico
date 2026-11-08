/**
 * Minimal XLSX (Office Open XML spreadsheet) reader and writer — no dependency. Reads every worksheet into a
 * `Table` (first row = headers): shared strings, inline strings, numbers, booleans. Dates arrive as Excel serial
 * numbers and are converted by `normalize.ts` only in date columns (the workbook's 1900/1904 date system travels
 * with the table). The writer produces the downloadable templates.
 *
 * Hostile files (R-P1-1): every quantity the file declares is untrusted. The reader enforces its own limits on what
 * it actually produces — inflated bytes across all parts (each part inflated with the remaining budget as its
 * output cap), compression ratio, declared size and CRC equal to what was inflated, no duplicate names, no
 * overlapping or out-of-range parts, only the parts a workbook needs are inflated (workbook, its relationships,
 * shared strings, referenced sheets), column index, rows per sheet, cells and characters per workbook, characters
 * per cell. XML is scanned with a forward-only cursor (no backtracking regular expressions over the sheet). Any
 * failure is a plain `unreadable_spreadsheet` refusal, never a crash.
 */
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import { DomainError, ValidationError } from '@portico/kernel';
import { CSV_LIMITS, type Table } from './csv';

export const XLSX_LIMITS = {
  /** Parts in the archive. */
  maxEntries: 2000,
  /** Bytes actually inflated across every part read. */
  maxUncompressed: 60 * 1024 * 1024,
  /** Inflated bytes per compressed byte, for parts larger than `ratioFloor`. */
  maxRatio: 200,
  ratioFloor: 1024 * 1024,
  maxSheets: 100,
  /** Same as CSV: columns per sheet (by column letter, not by cells present). */
  maxColumns: CSV_LIMITS.maxColumns,
  /** Same as CSV: data rows per sheet. */
  maxRows: CSV_LIMITS.maxRows,
  /** Cells produced per workbook, empty padding included (a shared string can be referenced a million times). */
  maxCells: 4_000_000,
  /** Characters produced per workbook (counted per cell, so repeated shared strings count every time). */
  maxChars: 60 * 1024 * 1024,
  maxCell: CSV_LIMITS.maxCell,
};

export interface ZipEntry {
  name: string;
  data: Buffer;
}

function bad(message: string): never {
  throw new ValidationError(
    'unreadable_spreadsheet',
    `${message} Save the workbook again as .xlsx (or export each sheet as CSV) and upload it again.`,
  );
}

export function isZip(buf: Buffer): boolean {
  return buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
}

interface CentralEntry {
  name: string;
  method: number;
  crc: number;
  compSize: number;
  size: number;
  local: number;
  dataStart: number;
}

/** Validated directory of an archive; parts are inflated on demand against one shared budget. */
class Archive {
  private readonly entries = new Map<string, CentralEntry>();
  private inflated = 0;

  constructor(private readonly buf: Buffer) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) bad('The file is not a valid spreadsheet (no ZIP directory).');
    const count = buf.readUInt16LE(eocd + 10);
    const cdSize = buf.readUInt32LE(eocd + 12);
    const cdOffset = buf.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOffset === 0xffffffff) bad('Very large (ZIP64) workbooks are not supported.');
    if (count > XLSX_LIMITS.maxEntries) bad('The workbook has too many parts.');
    if (cdOffset + cdSize > eocd) bad('The spreadsheet directory is damaged.');
    const list: CentralEntry[] = [];
    let p = cdOffset;
    for (let n = 0; n < count; n++) {
      if (p + 46 > eocd || buf.readUInt32LE(p) !== 0x02014b50) bad('The spreadsheet directory is damaged.');
      const flags = buf.readUInt16LE(p + 8);
      const method = buf.readUInt16LE(p + 10);
      const crc = buf.readUInt32LE(p + 16);
      const compSize = buf.readUInt32LE(p + 20);
      const size = buf.readUInt32LE(p + 24);
      const nameLen = buf.readUInt16LE(p + 28);
      const extraLen = buf.readUInt16LE(p + 30);
      const commentLen = buf.readUInt16LE(p + 32);
      const local = buf.readUInt32LE(p + 42);
      if (p + 46 + nameLen > eocd) bad('The spreadsheet directory is damaged.');
      const nameBytes = buf.subarray(p + 46, p + 46 + nameLen);
      const name = nameBytes.toString('utf8');
      p += 46 + nameLen + extraLen + commentLen;
      if (flags & 0x1) bad('Password-protected workbooks cannot be read.');
      if (this.entries.has(name)) bad('The workbook contains the same part twice.');
      if (local + 30 > cdOffset || buf.readUInt32LE(local) !== 0x04034b50)
        bad('A spreadsheet part is damaged.');
      const localNameLen = buf.readUInt16LE(local + 26);
      const localExtraLen = buf.readUInt16LE(local + 28);
      if (localNameLen !== nameLen || !buf.subarray(local + 30, local + 30 + nameLen).equals(nameBytes))
        bad('A spreadsheet part is damaged.');
      const dataStart = local + 30 + localNameLen + localExtraLen;
      if (dataStart + compSize > cdOffset) bad('A spreadsheet part is damaged.');
      const entry = { name, method, crc, compSize, size, local, dataStart };
      this.entries.set(name, entry);
      list.push(entry);
    }
    // Parts may not share or overlap bytes (one deflated stream referenced by many names is a zip bomb).
    list.sort((a, b) => a.local - b.local);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1] as CentralEntry;
      if ((list[i] as CentralEntry).local < prev.dataStart + prev.compSize)
        bad('The workbook has overlapping parts.');
    }
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Inflate one part, counting the bytes actually produced against the workbook budget. */
  read(name: string): Buffer | undefined {
    const e = this.entries.get(name);
    if (!e) return undefined;
    const remaining = XLSX_LIMITS.maxUncompressed - this.inflated;
    if (e.size > remaining) bad('The workbook expands to an unreasonable size.');
    const raw = this.buf.subarray(e.dataStart, e.dataStart + e.compSize);
    let data: Buffer;
    if (e.method === 0) data = Buffer.from(raw);
    else if (e.method === 8) {
      const ratioCap = Math.max(XLSX_LIMITS.ratioFloor, e.compSize * XLSX_LIMITS.maxRatio);
      const cap = Math.min(remaining, ratioCap, Math.max(e.size, 1));
      try {
        data = inflateRawSync(raw, { maxOutputLength: cap });
      } catch {
        bad(
          e.size > ratioCap
            ? 'The workbook expands to an unreasonable size.'
            : 'A spreadsheet part is damaged or larger than it declares.',
        );
      }
    } else bad(`Compression method ${e.method} is not supported.`);
    if (data.length !== e.size) bad('A spreadsheet part is damaged or larger than it declares.');
    if (data.length > XLSX_LIMITS.ratioFloor && data.length > e.compSize * XLSX_LIMITS.maxRatio)
      bad('The workbook expands to an unreasonable size.');
    if (crc32(data) >>> 0 !== e.crc >>> 0) bad('A spreadsheet part is damaged (checksum).');
    this.inflated += data.length;
    return data;
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function xmlText(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-z]{2,4});/g, (m, e: string) => {
    if (e.startsWith('#')) {
      const cp = e.startsWith('#x') ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '\ufffd';
    }
    return ENTITIES[e] ?? m;
  });
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? xmlText(m[1] as string) : null;
}

/** Forward-only element scanner: every step moves the cursor, so cost is linear in the XML length. */
interface Element {
  attrs: string;
  /** Inner XML ('' for a self-closing element). */
  inner: string;
}

function* elements(xml: string, tag: string, from = 0, to = xml.length): Generator<Element> {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let pos = from;
  while (pos < to) {
    const at = xml.indexOf(open, pos);
    if (at < 0 || at >= to) return;
    const after = xml.charCodeAt(at + open.length);
    // `<c` must not match `<col`; the next character ends the name.
    if (!(after === 32 || after === 62 || after === 47 || after === 9 || after === 10 || after === 13)) {
      pos = at + open.length;
      continue;
    }
    const gt = xml.indexOf('>', at);
    if (gt < 0 || gt >= to) bad('A sheet is damaged (unterminated element).');
    if (xml.charCodeAt(gt - 1) === 47) {
      yield { attrs: xml.slice(at + open.length, gt - 1), inner: '' };
      pos = gt + 1;
      continue;
    }
    const end = xml.indexOf(close, gt + 1);
    if (end < 0 || end + close.length > to) bad('A sheet is damaged (unterminated element).');
    yield { attrs: xml.slice(at + open.length, gt), inner: xml.slice(gt + 1, end) };
    pos = end + close.length;
  }
}

/** Text of the <t> runs of a shared string item or inline string (phonetic guides `<rPh>` excluded). */
function runs(fragment: string): string {
  const visible = fragment.includes('<rPh') ? fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '') : fragment;
  let s = '';
  for (const t of elements(visible, 't')) s += xmlText(t.inner);
  return s;
}

/** Zero-based column of a cell reference; refuses letters beyond the column limit (never allocates by it). */
function columnIndex(ref: string): number {
  let n = 0;
  let i = 0;
  for (; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
    if (n > XLSX_LIMITS.maxColumns)
      bad(`A sheet uses more than ${XLSX_LIMITS.maxColumns} columns (cell ${ref.slice(0, 8)}).`);
  }
  return i === 0 ? -1 : n - 1;
}

interface Budget {
  cells: number;
  chars: number;
}

function spend(budget: Budget, cells: number, chars: number) {
  budget.cells += cells;
  budget.chars += chars;
  if (budget.cells > XLSX_LIMITS.maxCells) bad(`The workbook holds more than ${XLSX_LIMITS.maxCells} cells.`);
  if (budget.chars > XLSX_LIMITS.maxChars) bad('The workbook holds more text than can be imported at once.');
}

function sheetRows(xml: string, shared: readonly string[], budget: Budget, sheet: string): string[][] {
  const rows: string[][] = [];
  const dataStart = xml.indexOf('<sheetData');
  if (dataStart < 0) return rows;
  for (const row of elements(xml, 'row', dataStart)) {
    if (rows.length > XLSX_LIMITS.maxRows)
      bad(`The sheet "${sheet}" has more than ${XLSX_LIMITS.maxRows} rows. Split it and upload the parts.`);
    const cells: string[] = [];
    let next = 0;
    for (const c of elements(row.inner, 'c')) {
      const ref = attr(c.attrs, 'r');
      const parsed = ref ? columnIndex(ref) : -1;
      const idx = parsed >= 0 ? parsed : next;
      if (idx >= XLSX_LIMITS.maxColumns) bad(`A sheet uses more than ${XLSX_LIMITS.maxColumns} columns.`);
      next = idx + 1;
      const t = attr(c.attrs, 't');
      const vAt = c.inner.indexOf('<v>');
      const v = vAt >= 0 ? c.inner.slice(vAt + 3, c.inner.indexOf('</v>', vAt)) : undefined;
      let value = '';
      if (t === 's') {
        const i = Number(v);
        value = Number.isInteger(i) && i >= 0 ? (shared[i] ?? '') : '';
      } else if (t === 'inlineStr') value = runs(c.inner);
      else if (t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (t === 'e') value = '';
      else value = v === undefined ? '' : xmlText(v);
      if (value.length > XLSX_LIMITS.maxCell)
        bad(`A cell in "${sheet}" holds more than ${XLSX_LIMITS.maxCell} characters.`);
      spend(budget, Math.max(1, idx + 1 - cells.length), value.length);
      while (cells.length < idx) cells.push('');
      cells[idx] = value;
    }
    rows.push(cells);
  }
  return rows;
}

export interface Workbook {
  /** Every worksheet with a header row, keyed by sheet name (workbook order). */
  sheets: Map<string, Table>;
  /** Every sheet name in the workbook (including empty sheets). */
  sheetNames: string[];
  /** Every shared string, referenced or not — scanned for card numbers like any cell. */
  sharedStrings: string[];
  /** The workbook counts dates from 1904 (Mac-origin workbooks): serial 0 = 1904-01-01. */
  date1904: boolean;
}

/** Every worksheet of a workbook as a table, keyed by sheet name (workbook order). */
export function readXlsx(buf: Buffer): Map<string, Table> {
  return readWorkbook(buf).sheets;
}

/** The workbook's tables plus every text it holds outside cells (sheet names, shared strings). */
export function readWorkbook(buf: Buffer): Workbook {
  if (!isZip(buf)) bad('The file is not an .xlsx workbook.');
  try {
    return parseWorkbook(new Archive(buf));
  } catch (err) {
    if (err instanceof DomainError) throw err;
    // Anything the parser did not anticipate is a refusal of this file, never a crash or a 500.
    bad('The workbook could not be read.');
  }
}

function parseWorkbook(parts: Archive): Workbook {
  const wb = parts.read('xl/workbook.xml')?.toString('utf8');
  if (!wb) bad('The workbook has no sheet list.');
  const rels = parts.read('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const targets = new Map<string, string>();
  for (const r of elements(rels, 'Relationship')) {
    const id = attr(r.attrs, 'Id');
    const target = attr(r.attrs, 'Target');
    if (id && target) targets.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }
  const pr = [...elements(wb, 'workbookPr')][0];
  const flag = pr ? attr(pr.attrs, 'date1904') : null;
  const date1904 = flag === '1' || flag === 'true';
  const sharedXml = parts.read('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  const shared: string[] = [];
  const budget: Budget = { cells: 0, chars: 0 };
  for (const si of elements(sharedXml, 'si')) {
    const text = runs(si.inner);
    if (text.length > XLSX_LIMITS.maxCell)
      bad(`A text in the workbook holds more than ${XLSX_LIMITS.maxCell} characters.`);
    shared.push(text);
    if (shared.length > XLSX_LIMITS.maxCells) bad('The workbook holds too many texts.');
  }
  const out = new Map<string, Table>();
  const sheetNames: string[] = [];
  const read = new Set<string>();
  for (const sh of elements(wb, 'sheet')) {
    if (sheetNames.length >= XLSX_LIMITS.maxSheets)
      bad(`The workbook has more than ${XLSX_LIMITS.maxSheets} sheets.`);
    const name = attr(sh.attrs, 'name') ?? `Sheet${sheetNames.length + 1}`;
    sheetNames.push(name);
    const rid = attr(sh.attrs, 'r:id');
    const target = rid ? targets.get(rid) : undefined;
    if (!target || read.has(target)) continue;
    read.add(target);
    const xml = parts.read(`xl/${target}`)?.toString('utf8');
    if (!xml) continue;
    const rows = sheetRows(xml, shared, budget, name).filter((r) => r.some((c) => c.trim() !== ''));
    const [headers, ...data] = rows;
    if (!headers) continue;
    const width = headers.length;
    spend(
      budget,
      data.reduce((n, r) => n + Math.max(0, width - r.length), 0),
      0,
    );
    const pad = (r: string[]) =>
      r.length < width ? [...r, ...new Array<string>(width - r.length).fill('')] : r;
    out.set(name, {
      headers: headers.map((h) => h.trim()),
      rows: data.map(pad),
      delimiter: 'xlsx',
      ...(date1904 ? { date1904: true } : {}),
    });
  }
  if (out.size === 0) bad('The workbook has no readable sheets.');
  return { sheets: out, sheetNames, sharedStrings: shared, date1904 };
}

// ───────────────────────────── writer (templates, tests) ─────────────────────────────

/** Build a ZIP archive (deflate) — the writer behind templates; exported for tests of the reader. */
export function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const comp = deflateRawSync(e.data);
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, comp);
    centrals.push(central, name);
    offset += local.length + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const escXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colName(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Build a workbook with one sheet per table (all cells as inline strings — templates never carry formulas). */
export function writeXlsx(sheets: Array<{ name: string; headers: string[]; rows: string[][] }>): Buffer {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const entries: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
          .map(
            (_s, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('')}</Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>${sheets
          .map((s, i) => `<sheet name="${escXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join('')}</sheets></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
          .map(
            (_s, i) =>
              `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('')}</Relationships>`,
      ),
    },
  ];
  sheets.forEach((s, i) => {
    const rows = [s.headers, ...s.rows]
      .map(
        (r, ri) =>
          `<row r="${ri + 1}">${r
            .map(
              (v, ci) =>
                `<c r="${colName(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`,
            )
            .join('')}</row>`,
      )
      .join('');
    entries.push({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><sheetData>${rows}</sheetData></worksheet>`,
      ),
    });
  });
  return zip(entries);
}
