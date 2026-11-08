/**
 * R-P1-1 regression tests (steward review fix round 1): the XLSX reader is safe on hostile files. The PoCs in
 * `docs/orchestration/reviews/migration-poc/zz-review-{domain,xlsx-oom}.test.ts.txt` are inverted here — each one
 * crashed, hung or accepted the file on 45be8b9.
 */
import { randomBytes } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readWorkbook, readXlsx, XLSX_LIMITS, zip } from './xlsx';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WORKBOOK = `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="reservations" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const RELS = `<Relationships><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

function sheetWorkbook(sheetXml: string, extra: Array<{ name: string; data: Buffer }> = []): Buffer {
  return zip([
    { name: 'xl/workbook.xml', data: Buffer.from(WORKBOOK) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(RELS) },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml) },
    ...extra,
  ]);
}

const refusal = (buf: Buffer): { code?: string; message?: string; name?: string } | null => {
  try {
    readXlsx(buf);
    return null;
  } catch (err) {
    return err as { code?: string; message?: string; name?: string };
  }
};

function withLimits<T>(patch: Partial<typeof XLSX_LIMITS>, fn: () => T): T {
  const saved = { ...XLSX_LIMITS };
  Object.assign(XLSX_LIMITS, patch);
  try {
    return fn();
  } finally {
    Object.assign(XLSX_LIMITS, saved);
  }
}

/** Raw archive builder for malformed directories: locals and centrals are given explicitly. */
function rawZip(
  locals: Array<{ name: string; data: Buffer }>,
  centrals: Array<{ name: string; localIndex: number; size?: number; crc?: number; comp?: number }>,
): Buffer {
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  const meta: Array<{ comp: number; size: number; crc: number }> = [];
  let offset = 0;
  for (const l of locals) {
    const name = Buffer.from(l.name);
    const comp = deflateRawSync(l.data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc32(l.data), 14);
    h.writeUInt32LE(comp.length, 18);
    h.writeUInt32LE(l.data.length, 22);
    h.writeUInt16LE(name.length, 26);
    offsets.push(offset);
    meta.push({ comp: comp.length, size: l.data.length, crc: crc32(l.data) });
    parts.push(h, name, comp);
    offset += 30 + name.length + comp.length;
  }
  const cds: Buffer[] = [];
  for (const c of centrals) {
    const m = meta[c.localIndex] as { comp: number; size: number; crc: number };
    const name = Buffer.from((locals[c.localIndex] as { name: string }).name);
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(8, 10);
    h.writeUInt32LE(c.crc ?? m.crc, 16);
    h.writeUInt32LE(c.comp ?? m.comp, 20);
    h.writeUInt32LE(c.size ?? m.size, 24);
    h.writeUInt16LE(name.length, 28);
    h.writeUInt32LE(offsets[c.localIndex] as number, 42);
    cds.push(h, name);
  }
  const cd = Buffer.concat(cds);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

describe('R-P1-1 column references are bounded before anything is allocated', () => {
  it('one cell at column AAAAA (index 475,254) is refused — the same width CSV refuses', () => {
    const wb = sheetWorkbook(
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>confirmation</t></is></c><c r="AAAAA1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>',
    );
    expect(wb.length).toBeLessThan(1000);
    expect(refusal(wb)).toMatchObject({
      code: 'unreadable_spreadsheet',
      message: expect.stringMatching(/more than 200 columns/),
    });
  });

  it.each([
    ['ZZZZZ', 40],
    ['ZZZZZZ', 1],
    ['XFD', 1],
  ])(
    'the review crash workbook (%s × %i rows) is refused in milliseconds, never an out-of-memory abort',
    (col, n) => {
      const rows = Array.from(
        { length: n },
        (_, i) => `<row r="${i + 1}"><c r="${col}${i + 1}" t="inlineStr"><is><t>x</t></is></c></row>`,
      ).join('');
      const wb = sheetWorkbook(`<worksheet><sheetData>${rows}</sheetData></worksheet>`);
      const t0 = Date.now();
      expect(refusal(wb)).toMatchObject({ code: 'unreadable_spreadsheet' });
      expect(Date.now() - t0).toBeLessThan(500);
    },
  );

  it('200 columns are read; 201 are refused', () => {
    const cells = (n: number) =>
      Array.from({ length: n }, (_, i) => `<c t="inlineStr"><is><t>h${i}</t></is></c>`).join('');
    expect(
      readXlsx(sheetWorkbook(`<worksheet><sheetData><row>${cells(200)}</row></sheetData></worksheet>`)).get(
        'reservations',
      )?.headers,
    ).toHaveLength(200);
    expect(
      refusal(sheetWorkbook(`<worksheet><sheetData><row>${cells(201)}</row></sheetData></worksheet>`)),
    ).toMatchObject({ code: 'unreadable_spreadsheet' });
  });
});

describe('R-P1-1 declared zip sizes are never trusted', () => {
  it('directory entries that share one deflated part (declared size 0) are refused as overlapping', () => {
    // The review PoC: one 8 MiB part (deflates to ~8 KiB) referenced by 6 directory entries declaring size 0.
    const big = Buffer.alloc(8 * 1024 * 1024, 0x20);
    const bomb = rawZip(
      [{ name: 'xl/p0.xml', data: big }],
      Array.from({ length: 6 }, () => ({ name: 'x', localIndex: 0, size: 0 })),
    );
    expect(bomb.length).toBeLessThan(64 * 1024);
    const before = process.memoryUsage().arrayBuffers;
    expect(refusal(bomb)).toMatchObject({ code: 'unreadable_spreadsheet' });
    expect((process.memoryUsage().arrayBuffers - before) / 1024 / 1024).toBeLessThan(20);
  });

  it('two names pointing at the same bytes are refused (overlap) even with honest sizes', () => {
    const wb = rawZip(
      [{ name: 'xl/workbook.xml', data: Buffer.from(WORKBOOK) }],
      [
        { name: 'xl/workbook.xml', localIndex: 0 },
        { name: 'xl/workbook.xml', localIndex: 0 },
      ],
    );
    expect(refusal(wb)).toMatchObject({ code: 'unreadable_spreadsheet' });
  });

  it('a part whose declared compressed size spans the next part is refused as overlapping', () => {
    const wb = rawZip(
      [
        { name: 'xl/workbook.xml', data: Buffer.from(WORKBOOK) },
        { name: 'xl/media/noise.bin', data: randomBytes(4000) },
      ],
      [
        { name: 'xl/workbook.xml', localIndex: 0, comp: 1000 },
        { name: 'xl/media/noise.bin', localIndex: 1 },
      ],
    );
    expect(refusal(wb)).toMatchObject({ message: expect.stringMatching(/overlapping parts/) });
  });

  it('a part that inflates to more than it declares is refused, and only the declared bytes are produced', () => {
    const wb = rawZip(
      [
        { name: 'xl/workbook.xml', data: Buffer.from(WORKBOOK + ' '.repeat(500_000)) },
        { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(RELS) },
      ],
      [
        { name: 'xl/workbook.xml', localIndex: 0, size: 10 },
        { name: 'xl/_rels/workbook.xml.rels', localIndex: 1 },
      ],
    );
    expect(refusal(wb)).toMatchObject({
      code: 'unreadable_spreadsheet',
      message: expect.stringMatching(/larger than it declares/),
    });
  });

  it('a part whose checksum does not match is refused', () => {
    const wb = rawZip(
      [
        { name: 'xl/workbook.xml', data: Buffer.from(WORKBOOK) },
        { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(RELS) },
      ],
      [
        { name: 'xl/workbook.xml', localIndex: 0, crc: 12345 },
        { name: 'xl/_rels/workbook.xml.rels', localIndex: 1 },
      ],
    );
    expect(refusal(wb)).toMatchObject({
      code: 'unreadable_spreadsheet',
      message: expect.stringMatching(/checksum/),
    });
  });

  it('total inflated bytes across parts are capped by what is actually produced', () => {
    // Each part is modest and honest; together they exceed the (lowered) workbook budget.
    const sheet = `<worksheet><sheetData><row><c t="inlineStr"><is><t>a</t></is></c></row></sheetData></worksheet>${' '.repeat(40_000)}`;
    const wb = sheetWorkbook(sheet, [
      { name: 'xl/sharedStrings.xml', data: Buffer.from(`<sst>${' '.repeat(40_000)}</sst>`) },
    ]);
    expect(withLimits({ maxUncompressed: 60_000 }, () => refusal(wb))).toMatchObject({
      message: expect.stringMatching(/unreasonable size/),
    });
    expect(withLimits({ maxUncompressed: 200_000 }, () => refusal(wb))).toBeNull();
  });

  it('parts nobody needs (images, styles) are never inflated', () => {
    const junk = { name: 'xl/media/image1.xml', data: Buffer.alloc(9 * 1024 * 1024, 0x20) };
    const wb = sheetWorkbook(
      '<worksheet><sheetData><row><c t="inlineStr"><is><t>a</t></is></c></row></sheetData></worksheet>',
      [junk],
    );
    expect(refusal(wb)).toBeNull();
  });

  it('a highly compressed part is refused before it is inflated in full (ratio cap)', () => {
    const bomb = zip([{ name: 'xl/workbook.xml', data: Buffer.alloc(5_000_000, 0x20) }]);
    expect(refusal(bomb)).toMatchObject({ message: expect.stringMatching(/unreasonable size/) });
  });
});

describe('R-P1-1 rows, cells and characters are capped on what is produced', () => {
  const rowsXml = (n: number) =>
    Array.from({ length: n }, (_, i) => `<row><c t="inlineStr"><is><t>r${i}</t></is></c></row>`).join('');

  it('rows per sheet', () => {
    const wb = sheetWorkbook(`<worksheet><sheetData>${rowsXml(8)}</sheetData></worksheet>`);
    expect(withLimits({ maxRows: 7 }, () => refusal(wb))).toBeNull(); // header + 7 rows
    expect(withLimits({ maxRows: 6 }, () => refusal(wb))).toMatchObject({
      message: expect.stringMatching(/more than 6 rows/),
    });
  });

  it('a shared string referenced many times counts every cell and every character', () => {
    const shared = `<sst><si><t>${'x'.repeat(1000)}</t></si></sst>`;
    const rows = Array.from(
      { length: 50 },
      () => '<row><c t="s"><v>0</v></c><c t="s"><v>0</v></c></row>',
    ).join('');
    const wb = sheetWorkbook(`<worksheet><sheetData>${rows}</sheetData></worksheet>`, [
      { name: 'xl/sharedStrings.xml', data: Buffer.from(shared) },
    ]);
    expect(wb.length).toBeLessThan(2000);
    expect(withLimits({ maxChars: 50_000 }, () => refusal(wb))).toMatchObject({
      message: expect.stringMatching(/more text/),
    });
    expect(withLimits({ maxCells: 60 }, () => refusal(wb))).toMatchObject({
      message: expect.stringMatching(/more than 60 cells/),
    });
    expect(refusal(wb)).toBeNull();
  });

  it('a cell longer than the CSV cell limit is refused', () => {
    const wb = sheetWorkbook(
      `<worksheet><sheetData><row><c t="inlineStr"><is><t>${'y'.repeat(10_001)}</t></is></c></row></sheetData></worksheet>`,
    );
    expect(refusal(wb)).toMatchObject({ message: expect.stringMatching(/more than 10000 characters/) });
  });
});

describe('R-P1-1 malformed XML is a refusal, in linear time', () => {
  it('a megabyte of unterminated <row> elements is refused quickly (no backtracking scan)', () => {
    const wb = sheetWorkbook(`<worksheet><sheetData>${'<row r="1">'.repeat(100_000)}`);
    const t0 = Date.now();
    expect(refusal(wb)).toMatchObject({ code: 'unreadable_spreadsheet' });
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('invalid character references become U+FFFD instead of throwing a RangeError', () => {
    const wb = sheetWorkbook(
      '<worksheet><sheetData><row><c t="inlineStr"><is><t>a&#x110000;b&#0;c</t></is></c></row></sheetData></worksheet>',
    );
    expect(readXlsx(wb).get('reservations')?.headers).toEqual(['a�b�c']);
  });

  it('a damaged directory is a plain refusal', () => {
    const good = sheetWorkbook('<worksheet><sheetData></sheetData></worksheet>');
    const damaged = Buffer.from(good);
    damaged.writeUInt32LE(0xdeadbeef, damaged.length - 22 + 16); // central directory offset out of range
    expect(refusal(damaged)).toMatchObject({ code: 'unreadable_spreadsheet' });
  });

  it('phonetic guides are not read as cell text; the 1904 date system is reported', () => {
    const wb = zip([
      {
        name: 'xl/workbook.xml',
        data: Buffer.from(
          `<workbook xmlns="${NS}" xmlns:r="${REL}"><workbookPr date1904="1"/><sheets><sheet name="reservations" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        ),
      },
      { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(RELS) },
      {
        name: 'xl/sharedStrings.xml',
        data: Buffer.from('<sst><si><r><t>山田</t></r><rPh sb="0" eb="2"><t>ヤマダ</t></rPh></si></sst>'),
      },
      {
        name: 'xl/worksheets/sheet1.xml',
        data: Buffer.from('<worksheet><sheetData><row><c t="s"><v>0</v></c></row></sheetData></worksheet>'),
      },
    ]);
    const book = readWorkbook(wb);
    expect(book.sheets.get('reservations')?.headers).toEqual(['山田']);
    expect(book.date1904).toBe(true);
    expect(book.sheets.get('reservations')?.date1904).toBe(true);
  });
});
