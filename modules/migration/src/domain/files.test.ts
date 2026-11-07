import { describe, expect, it } from 'vitest';
import { detectTable, kindFromName, mapColumns } from './columns';
import { detectDelimiter, parseCsv, toCsv } from './csv';
import { findCardNumbers, isMasked, looksLikeCardNumber, luhnValid } from './sensitive';
import { readXlsx, writeXlsx, zip } from './xlsx';

describe('CSV reader', () => {
  it('reads quoted cells, doubled quotes, embedded line breaks, CRLF and a BOM', () => {
    const t = parseCsv('﻿a,b,c\r\n"1,5","say ""hi""","line\nbreak"\r\n2,,x\r\n');
    expect(t.headers).toEqual(['a', 'b', 'c']);
    expect(t.rows).toEqual([
      ['1,5', 'say "hi"', 'line\nbreak'],
      ['2', '', 'x'],
    ]);
  });
  it('detects ; and tab delimiters used by spreadsheet exports in many locales', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(parseCsv('a;b\n"x;y";2').rows).toEqual([['x;y', '2']]);
  });
  it('pads short rows and refuses unbalanced quotes with a recovery hint', () => {
    expect(parseCsv('a,b,c\n1').rows).toEqual([['1', '', '']]);
    expect(() => parseCsv('a,b\n"1,2')).toThrow(/never closed/);
    expect(() => parseCsv('')).toThrow(/empty/);
  });
  it('writes CSV that a spreadsheet cannot run as a formula, keeping negative amounts numeric', () => {
    const out = toCsv(['x', 'y'], [['=SUM(A1)', '-120.00'], ['a,b', '@cmd']]);
    expect(out).toBe(`x,y\n'=SUM(A1),-120.00\n"a,b",'@cmd`);
    expect(parseCsv(out).rows[0]).toEqual(["'=SUM(A1)", '-120.00']);
  });
});

describe('XLSX reader', () => {
  it('round-trips a workbook with several sheets (inline strings)', () => {
    const buf = writeXlsx([
      { name: 'units', headers: ['number', 'unit_type_code'], rows: [['101', 'DBL'], ['102', 'DBL']] },
      { name: 'Reservations & more', headers: ['confirmation', 'status'], rows: [['A<1>', 'Confirmed']] },
    ]);
    const sheets = readXlsx(buf);
    expect([...sheets.keys()]).toEqual(['units', 'Reservations & more']);
    expect(sheets.get('units')?.rows).toEqual([
      ['101', 'DBL'],
      ['102', 'DBL'],
    ]);
    expect(sheets.get('Reservations & more')?.rows[0]).toEqual(['A<1>', 'Confirmed']);
  });
  it('reads shared strings, numbers, booleans and sparse cells (as Excel writes them)', () => {
    const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const buf = zip([
      {
        name: 'xl/workbook.xml',
        data: Buffer.from(`<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="R" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/></Relationships>'),
      },
      {
        name: 'xl/sharedStrings.xml',
        data: Buffer.from('<sst><si><t>confirmation</t></si><si><r><t>arr</t></r><r><t>ival</t></r></si><si><t>CN&amp;1</t></si></sst>'),
      },
      {
        name: 'xl/worksheets/sheet1.xml',
        data: Buffer.from(
          `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="b"><v>1</v></c><c r="C2"><v>46000</v></c></row></sheetData></worksheet>`,
        ),
      },
    ]);
    const t = readXlsx(buf).get('R');
    expect(t?.headers).toEqual(['confirmation', '', 'arrival']);
    expect(t?.rows).toEqual([['CN&1', 'TRUE', '46000']]);
  });
  it('refuses files that are not workbooks and zip bombs', () => {
    expect(() => readXlsx(Buffer.from('not a zip at all'))).toThrow(/not an .xlsx/);
    const bomb = zip([{ name: 'xl/workbook.xml', data: Buffer.alloc(5_000_000, 0x20) }]);
    expect(() => readXlsx(bomb)).toThrow(/unreasonable size/);
  });
});

describe('card numbers and masked values (MG-02, DD11 F4)', () => {
  it('Luhn and scheme ranges', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
    expect(looksLikeCardNumber('4111111111111111')).toBe(true);
    expect(looksLikeCardNumber('5555555555554444')).toBe(true);
    expect(looksLikeCardNumber('378282246310005')).toBe(true);
    // Luhn-valid but no card scheme (an OTA itinerary number starting with 7)
    expect(looksLikeCardNumber('7000000000000002')).toBe(false);
  });
  it('finds a card number with spaces or dashes in any cell, reporting position only', () => {
    const f = findCardNumbers(['ref', 'notes'], [['CN1', 'card 4111-1111-1111-1111 exp 12/29'], ['CN2', 'BDC-4471002']]);
    expect(f).toEqual([{ row: 1, column: 'notes' }]);
    expect(JSON.stringify(f)).not.toContain('4111');
    expect(findCardNumbers(['phone'], [['+960 777 0101'], ['5555 5555 5555 4444']])).toEqual([{ row: 2, column: 'phone' }]);
  });
  it('detects masked and redacted personal data, never plain names', () => {
    for (const v of ['XXXXXXXX', 'J*****n', 'j*****@example.com', 'john@*****', '+960 *** **12', 'REDACTED', 'Anonymised', '••••'])
      expect(isMasked(v), v).toBe(true);
    for (const v of ['Rasheed', "O'Connor", 'Max', 'aisha@example.test', '+960 777 0101', '', null]) expect(isMasked(v), String(v)).toBe(false);
  });
});

describe('column auto-detection', () => {
  it('maps vendor headers to fields and recognizes the table', () => {
    const d = detectTable(['Reservation ID', 'Booking Status', 'Check-in', 'Check-out', 'Room Type', 'Currency', 'Room Revenue', 'Guest Name']);
    expect(d.kind).toBe('reservations');
    expect(d.missingRequired).toEqual([]);
    expect(Object.fromEntries(d.columns.map((c) => [c.field, c.header]))).toMatchObject({
      confirmation: 'Reservation ID',
      status: 'Booking Status',
      arrival: 'Check-in',
      departure: 'Check-out',
      unit_type_code: 'Room Type',
      room_total: 'Room Revenue',
    });
  });
  it('reports missing required fields and lets a person override a header', () => {
    const d = mapColumns('deposits', ['Booking', 'Held']);
    expect(d.missingRequired).toEqual(['confirmation', 'amount', 'currency']);
    const o = mapColumns('deposits', ['Booking', 'Held', 'CCY'], { Booking: 'confirmation', Held: 'amount', CCY: 'currency' });
    expect(o.missingRequired).toEqual([]);
    expect(o.confidence).toBe(1);
  });
  it('guesses the table from file and sheet names', () => {
    expect(kindFromName('reservation_nights.csv')).toBe('reservation_nights');
    expect(kindFromName('In-house balances.xlsx')).toBe('in_house_balances');
    expect(kindFromName('units.csv')).toBe('units');
    expect(kindFromName('Room types')).toBe('unit_types');
    expect(kindFromName('control_totals.csv')).toBe('control_totals');
    expect(kindFromName('whatever.csv')).toBeNull();
  });
});
