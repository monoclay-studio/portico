/**
 * Regression tests from the steward review (fix round 1): hostile and sloppy files. Each test is a PoC from
 * `docs/orchestration/reviews/migration-poc/zz-review-domain.test.ts.txt` inverted — it fails on 45be8b9.
 *
 * R-P0-1: card numbers written in ordinary ways must refuse the upload, wherever they are in the file.
 */
import { describe, expect, it } from 'vitest';
import { toCsv } from '../domain/csv';
import { findCardNumbers } from '../domain/sensitive';
import { zip } from '../domain/xlsx';
import { assertNoCardData } from '../service/extract';
import { sourceAdapter } from './adapters';
import { readPack } from './files';
import { recordsFromSimulator } from './simulator';

const PAN = '4111111111111111';
const fullWidth = (s: string) => s.replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d)));
const adapter = (() => {
  const a = sourceAdapter('portico.pack.v1');
  if (!a) throw new Error('adapter');
  return a;
})();

const RES_HEADERS = [
  'confirmation',
  'status',
  'arrival',
  'departure',
  'unit_type_code',
  'guest_name',
  'room_total',
  'notes',
];
const resCsv = (notes: string, headers = RES_HEADERS) =>
  toCsv(headers, [['CN1', 'Confirmed', '2026-12-03', '2026-12-05', 'DBL', 'A B', '100.00', notes]]);

describe('R-P0-1 every spelling from the review refuses the cell', () => {
  const scan = (cell: string) => findCardNumbers(['notes'], [[cell]]).length;

  it.each([
    ['plain', PAN],
    ['single spaces', '4111 1111 1111 1111'],
    ['dashes', '4111-1111-1111-1111'],
    ['followed by expiry', '4111 1111 1111 1111 12/27'],
    ['followed by expiry and a note', 'Visa 4111111111111111 1227 cvv in safe'],
    ['preceded by a room number', 'room 12 4111111111111111'],
    ['preceded by a digit', '2 4111-1111-1111-1111'],
    ['double spaces', '4111  1111  1111  1111'],
    ['dots', '4111.1111.1111.1111'],
    ['no-break spaces', '4111 1111 1111 1111'],
    ['spaced dashes', '4111 - 1111 - 1111 - 1111'],
    ['full-width digits', fullWidth(PAN)],
    ['spreadsheet exponent form', '4.111111111111111E15'],
    ['spreadsheet rounding (check digit lost)', '4111111111111110'],
  ])('%s', (_label, cell) => {
    expect(scan(cell)).toBe(1);
  });

  it('a card number in a header cell is found and the header is not echoed', () => {
    expect(findCardNumbers([PAN], [['x']])).toEqual([{ row: 0, column: 'column 1' }]);
  });
});

function workbook(parts: { workbook?: string; shared?: string; sheet: string }): string {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const entries = [
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        parts.workbook ??
          `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="reservations" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        `<Relationships><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
    },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(parts.sheet) },
  ];
  if (parts.shared) entries.push({ name: 'xl/sharedStrings.xml', data: Buffer.from(parts.shared) });
  return zip(entries).toString('base64');
}

const inline = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
const headerRow = `<row r="1">${RES_HEADERS.map((h, i) => inline(`${String.fromCharCode(65 + i)}1`, h)).join('')}</row>`;
const dataRow = (notesCell: string) =>
  `<row r="2">${['CN1', 'Confirmed', '2026-12-03', '2026-12-05', 'DBL', 'A B', '100.00']
    .map((v, i) => inline(`${String.fromCharCode(65 + i)}2`, v))
    .join('')}${notesCell}</row>`;

describe('R-P0-1 the whole upload path (readPack) refuses such files, so nothing is stored', () => {
  const refused = (files: Parameters<typeof readPack>[0]) => {
    try {
      readPack(files, adapter);
      return null;
    } catch (err) {
      return err as { code: string; message: string; details?: { findings: unknown[] } };
    }
  };

  it('a CSV cell with the PAN followed by its expiry', () => {
    const err = refused([{ name: 'reservations.csv', content: resCsv('card 4111 1111 1111 1111 12/27') }]);
    expect(err).toMatchObject({ code: 'card_data_in_file' });
    expect(err?.message).toMatch(/reservations\.csv, row 1, column "notes"/);
    expect(err?.message).toMatch(/not a card number/);
    expect(JSON.stringify(err)).not.toContain('4111');
  });

  it('a CSV header cell', () => {
    const headers = [...RES_HEADERS.slice(0, 7), `notes ${PAN}`];
    const err = refused([{ name: 'reservations.csv', content: resCsv('ok', headers) }]);
    expect(err).toMatchObject({ code: 'card_data_in_file' });
    expect(err?.message).toMatch(/header row, column 8/);
    expect(JSON.stringify(err)).not.toContain('4111');
  });

  it('a file name, which is not echoed', () => {
    const err = refused([{ name: `${PAN}.csv`, content: resCsv('ok') }]);
    expect(err).toMatchObject({ code: 'card_data_in_file' });
    expect(JSON.stringify(err)).not.toContain('4111');
  });

  it('an XLSX shared string, even one no cell references', () => {
    const shared = `<sst><si><t>reservations</t></si><si><t>card ${PAN}</t></si></sst>`;
    const content = workbook({
      shared,
      sheet: `<worksheet><sheetData>${headerRow}${dataRow('')}</sheetData></worksheet>`,
    });
    expect(refused([{ name: 'export.xlsx', content, encoding: 'base64' }])).toMatchObject({
      code: 'card_data_in_file',
      message: expect.stringMatching(/shared strings/),
    });
  });

  it('an XLSX sheet name', () => {
    const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const content = workbook({
      workbook: `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="reservations" sheetId="1" r:id="rId1"/><sheet name="4111 1111 1111 1111" sheetId="2" r:id="rId9"/></sheets></workbook>`,
      sheet: `<worksheet><sheetData>${headerRow}${dataRow('')}</sheetData></worksheet>`,
    });
    const err = refused([{ name: 'export.xlsx', content, encoding: 'base64' }]);
    expect(err).toMatchObject({ code: 'card_data_in_file', message: expect.stringMatching(/sheet name/) });
    expect(JSON.stringify(err)).not.toContain('4111');
  });

  it('an XLSX numeric cell rounded by the spreadsheet, and one in exponent form', () => {
    for (const v of ['4111111111111110', '4.111111111111111E15', '4.11111111111111E+15']) {
      const content = workbook({
        sheet: `<worksheet><sheetData>${headerRow}${dataRow(`<c r="H2"><v>${v}</v></c>`)}</sheetData></worksheet>`,
      });
      expect(refused([{ name: 'export.xlsx', content, encoding: 'base64' }]), v).toMatchObject({
        code: 'card_data_in_file',
      });
    }
  });
});

describe('R-P0-1 sibling paths: anything a system sends is scanned before it is stored', () => {
  it('a simulator snapshot with a card number in a guest field is refused at the storage choke point', () => {
    const records = recordsFromSimulator({
      accountId: 'acc',
      property: {
        code: 'P',
        name: 'P',
        currency: 'USD',
        timezone: 'Indian/Maldives',
        roomTypes: [{ code: 'dbl', name: 'Double', maxOccupancy: 2 }],
        rooms: [],
        ratePlans: [],
      },
      reservations: [
        {
          reservationId: 'R1',
          revision: 1,
          status: 'CNF',
          arrival: '2026-12-03',
          departure: '2026-12-05',
          roomTypeCode: 'dbl',
          ratePlanCode: 'BAR',
          guestName: `A B card ${PAN}`,
          adults: 2,
          totalMinor: 20000,
          currency: 'USD',
        },
      ],
    });
    expect(() =>
      assertNoCardData({ type: 'records', name: 'simulator:acc', records, controlTotals: [] }),
    ).toThrow(expect.objectContaining({ code: 'card_data_in_source' }));
  });

  it('a rehearsal copy or connector extract with a card number in a raw field name is refused', () => {
    expect(() =>
      assertNoCardData({
        type: 'records',
        name: 'rehearsal',
        records: [
          {
            dataClass: 'guest',
            key: 'G1',
            payload: null,
            raw: { '4111-1111-1111-1111': 'x' },
            origin: { file: 'f', row: 1 },
            problems: [],
          },
        ],
        controlTotals: [],
      }),
    ).toThrow(expect.objectContaining({ code: 'card_data_in_source' }));
  });

  it('a file-pack extract stored by another path (seed, bridge) is scanned too', () => {
    expect(() =>
      assertNoCardData({
        type: 'tables',
        tables: [
          {
            name: 'r.csv',
            kind: 'reservations',
            spreadsheet: false,
            headers: ['notes'],
            rows: [['4111  1111  1111  1111']],
            columns: [],
            checksum: '',
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'card_data_in_source' }));
  });
});
