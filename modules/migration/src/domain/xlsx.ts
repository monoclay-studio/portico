/**
 * Minimal XLSX (Office Open XML spreadsheet) reader and writer — no dependency. Reads every worksheet into a
 * `Table` (first row = headers): shared strings, inline strings, numbers, booleans. Dates arrive as Excel serial
 * numbers and are converted by `normalize.ts` only in date columns. Limits: no ZIP64, no encryption, bounded
 * uncompressed size (zip-bomb guard). The writer produces the downloadable templates.
 */
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import { ValidationError } from '@portico/kernel';
import type { Table } from './csv';

export const XLSX_LIMITS = { maxEntries: 2000, maxUncompressed: 60 * 1024 * 1024, maxRatio: 200 };

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

function readZip(buf: Buffer): Map<string, Buffer> {
  // End of central directory: last 22 bytes (+ comment up to 64 KiB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) bad('The file is not a valid spreadsheet (no ZIP directory).');
  const entries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff) bad('Very large (ZIP64) workbooks are not supported.');
  if (entries > XLSX_LIMITS.maxEntries) bad('The workbook has too many parts.');
  const out = new Map<string, Buffer>();
  let p = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50)
      bad('The spreadsheet directory is damaged.');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 0x1) bad('Password-protected workbooks cannot be read.');
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50)
      bad('A spreadsheet part is damaged.');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compSize);
    total += size;
    if (total > XLSX_LIMITS.maxUncompressed || (compSize > 0 && size / compSize > XLSX_LIMITS.maxRatio))
      bad('The workbook expands to an unreasonable size.');
    if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue;
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: XLSX_LIMITS.maxUncompressed });
    else bad(`Compression method ${method} is not supported.`);
    out.set(name, data);
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function xmlText(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(Number.parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(Number.parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? xmlText(m[1] as string) : null;
}

/** Text of all <t> runs inside a fragment (shared string item or inline string). */
function runs(fragment: string): string {
  let s = '';
  for (const m of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += xmlText(m[1] as string);
  return s;
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    let next = 0;
    for (const cm of (rm[1] as string).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] as string;
      const inner = cm[2] ?? '';
      const ref = attr(attrs, 'r');
      const idx = ref ? columnIndex(ref) : next;
      next = idx + 1;
      const t = attr(attrs, 't');
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = '';
      if (t === 's') value = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') value = runs(inner);
      else if (t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (t === 'e') value = '';
      else value = v === undefined ? '' : xmlText(v);
      while (cells.length < idx) cells.push('');
      cells[idx] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/** Every worksheet of a workbook as a table, keyed by sheet name (workbook order). */
export function readXlsx(buf: Buffer): Map<string, Table> {
  if (!isZip(buf)) bad('The file is not an .xlsx workbook.');
  const parts = readZip(buf);
  const wb = parts.get('xl/workbook.xml')?.toString('utf8');
  if (!wb) bad('The workbook has no sheet list.');
  const rels = parts.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1] as string, 'Id');
    const target = attr(m[1] as string, 'Target');
    if (id && target) targets.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }
  const sharedXml = parts.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => runs(m[1] as string));
  const out = new Map<string, Table>();
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1] as string, 'name') ?? `Sheet${out.size + 1}`;
    const rid = attr(m[1] as string, 'r:id');
    const target = rid ? targets.get(rid) : undefined;
    const xml = target ? parts.get(`xl/${target}`)?.toString('utf8') : undefined;
    if (!xml) continue;
    const rows = sheetRows(xml, shared).filter((r) => r.some((c) => c.trim() !== ''));
    const [headers, ...data] = rows;
    if (!headers) continue;
    const width = headers.length;
    out.set(name, {
      headers: headers.map((h) => h.trim()),
      rows: data.map((r) => (r.length < width ? [...r, ...new Array(width - r.length).fill('')] : r)),
      delimiter: 'xlsx',
    });
  }
  if (out.size === 0) bad('The workbook has no readable sheets.');
  return out;
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
