/**
 * R-P1-5 key normalisation and R-P2-5 multi-room bookings (steward review fix round 1).
 */
import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './csv';
import { buildPack, type PackTable } from './pack';
import { checkAgainstImported } from './quality';
import { normalizeSourceKey, type ReservationRecord, type SourceRecord } from './records';

describe('normalizeSourceKey (R-P1-5): one key per identifier, whatever the spelling', () => {
  it.each([
    ['CN1003', 'CN1003'],
    ['cn1003', 'CN1003'],
    ['  CN1003 ', 'CN1003'],
    ['ＣＮ１００３', 'CN1003'],
    ['cn  1003', 'CN 1003'],
    ['00123', '123'],
    ['123.0', '123'],
    ['0', '0'],
    ['000', '0'],
    ['1.23E+16', '12300000000000000'],
    ['1.23e16', '12300000000000000'],
    ['CN-0012', 'CN-0012'],
    ['BDC-4471002', 'BDC-4471002'],
  ])('%s → %s', (raw, key) => {
    expect(normalizeSourceKey(raw)).toBe(key);
  });
});

const HEADERS = [
  'confirmation',
  'status',
  'arrival',
  'departure',
  'unit_type_code',
  'unit_number',
  'guest_name',
  'room_total',
];
function pack(rows: string[][], extra: PackTable[] = []) {
  const t = parseCsv(toCsv(HEADERS, rows));
  const table: PackTable = {
    name: 'reservations.csv',
    kind: 'reservations',
    table: t,
    spreadsheet: false,
    columns: t.headers.map((h, i) => ({ header: h, field: h, index: i, confidence: 1 })) as never,
  };
  return buildPack([table, ...extra], { defaultCurrency: 'USD' });
}
const row = (conf: string, type = 'DBL', unit = '', total = '100.00') => [
  conf,
  'Confirmed',
  '2026-12-03',
  '2026-12-05',
  type,
  unit,
  'A B',
  total,
];

describe('rows sharing a confirmation (R-P2-5 multi-room; R-P1-5 attack)', () => {
  it('two rows written identically are two rooms of one booking — both kept, keyed by line, grouped', () => {
    const p = pack([row('CN9', 'TWN', '', '120.00'), row('CN9', 'DBL', '', '100.00')]);
    const res = p.records.filter((r) => r.dataClass === 'reservation');
    expect(res.map((r) => r.key)).toEqual(['CN9/2', 'CN9/1']);
    expect(res.map((r) => (r.payload as ReservationRecord).group)).toEqual([
      { ref: 'CN9', line: 2, lines: 2 },
      { ref: 'CN9', line: 1, lines: 2 },
    ]);
    expect(res.every((r) => r.problems.length === 0)).toBe(true);
  });

  it('line keys do not depend on the order of the rows in the export', () => {
    const a = pack([row('CN9', 'TWN'), row('CN9', 'DBL')]);
    const b = pack([row('CN9', 'DBL'), row('CN9', 'TWN')]);
    const keyed = (p: ReturnType<typeof pack>) =>
      Object.fromEntries(p.records.map((r) => [r.key, (r.payload as ReservationRecord).unitTypeCode]));
    expect(keyed(a)).toEqual(keyed(b));
  });

  it('two identical rooms (same type, no room number) are both kept — never collapsed into one', () => {
    const p = pack([row('CN7'), row('CN7')]);
    expect(
      p.records
        .filter((r) => r.dataClass === 'reservation')
        .map((r) => r.key)
        .sort(),
    ).toEqual(['CN7/1', 'CN7/2']);
  });

  it('a deposit of a multi-room booking attaches to room 1', () => {
    const d = parseCsv(toCsv(['confirmation', 'amount', 'currency'], [['cn9', '50.00', 'USD']]));
    const deposits: PackTable = {
      name: 'deposits.csv',
      kind: 'deposits',
      table: d,
      spreadsheet: false,
      columns: d.headers.map((h, i) => ({ header: h, field: h, index: i, confidence: 1 })) as never,
    };
    const p = pack([row('CN9', 'TWN'), row('CN9', 'DBL')], [deposits]);
    const dep = p.records.find((r) => r.dataClass === 'deposit');
    expect(dep?.key).toBe('CN9');
    expect((dep?.payload as { bookingKey: string }).bookingKey).toBe('CN9/1');
  });

  it('attack: 0012 and 12 (different bookings that normalise alike) raise duplicate_key_conflict, never merge', () => {
    const p = pack([row('0012'), row('12', 'TWN')]);
    const res = p.records.filter((r) => r.dataClass === 'reservation');
    expect(res.map((r) => r.key)).toEqual(['12', '12']);
    for (const r of res) expect(r.problems.map((x) => x.code)).toContain('duplicate_key_conflict');
  });

  it('cn1003 and CN1003 across two exports are the same key (a re-saved export is not a new booking)', () => {
    expect(pack([row('cn1003')]).records[0]?.key).toBe(pack([row('CN1003')]).records[0]?.key);
  });
});

describe('checkAgainstImported (R-P1-5): a re-keyed copy of an imported booking is never imported automatically', () => {
  const rec = (key: string, p: Partial<ReservationRecord>): SourceRecord => ({
    dataClass: 'reservation',
    key,
    payload: {
      status: 'confirmed',
      sourceStatus: 'Confirmed',
      arrival: '2026-12-03',
      departure: '2026-12-05',
      unitTypeCode: 'DBL',
      unitNumber: null,
      guestKey: 'G1',
      guestName: 'A B',
      adults: 2,
      children: 0,
      ratePlanCode: null,
      currency: 'USD',
      nightly: null,
      roomTotalMinor: 100,
      taxes: [],
      taxInclusive: false,
      totalMinor: 100,
      channel: null,
      guarantee: 'none',
      ...p,
    },
    origin: { file: 'f', row: 1 },
    problems: [],
  });

  it('same channel booking id → rekeyed_channel_booking', () => {
    const f = checkAgainstImported(
      [rec('CN1001-R', { channel: { code: 'Booking.com', bookingId: 'bdc-4471002' } })],
      [rec('CN1001', { channel: { code: 'booking.com', bookingId: 'BDC-4471002' } })],
    );
    expect(f.get('reservation:CN1001-R')?.map((p) => p.code)).toEqual(['rekeyed_channel_booking']);
  });

  it('same guest, dates and unit type → possible_duplicate_booking', () => {
    const f = checkAgainstImported([rec('CN2002-X', {})], [rec('CN2002', {})]);
    expect(f.get('reservation:CN2002-X')?.map((p) => p.code)).toEqual(['possible_duplicate_booking']);
  });

  it('a different stay, or another room of the same multi-room booking, is not flagged', () => {
    expect(
      checkAgainstImported([rec('CN3', { arrival: '2026-12-10', departure: '2026-12-12' })], [rec('CN2', {})])
        .size,
    ).toBe(0);
    const g = (line: number) => ({ group: { ref: 'CN9', line, lines: 3 } });
    expect(checkAgainstImported([rec('CN9/3', g(3))], [rec('CN9/1', g(1))]).size).toBe(0);
    expect(checkAgainstImported([rec('CN2', {})], [rec('CN2', {})]).size).toBe(0);
  });
});
