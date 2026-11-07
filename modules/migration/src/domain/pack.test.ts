import { describe, expect, it } from 'vitest';
import { sampleGuesthousePack, sampleSmbExport, TEMPLATE_HEADERS } from '../sources/templates';
import { kindFromName, mapColumns, type TableKind } from './columns';
import { parseCsv, toCsv } from './csv';
import { buildPack, type PackTable } from './pack';
import { checkQuality, recordId } from './quality';
import type { DepositRecord, GuestRecord, ReservationRecord, SourceRecord } from './records';

const BD = '2026-12-01';

function tables(pack: Record<string, string[][]>, overrides: Record<string, string[]> = {}): PackTable[] {
  return Object.entries(pack).map(([name, rows]) => {
    const headers = overrides[name] ?? (TEMPLATE_HEADERS[name] as string[]);
    const t = parseCsv(toCsv(headers, rows));
    const kind = kindFromName(name) as TableKind;
    return {
      name: `${name}.csv`,
      kind,
      table: t,
      columns: mapColumns(kind, t.headers).columns,
      spreadsheet: false,
    };
  });
}

const byKey = (recs: SourceRecord[], c: string, k: string) =>
  recs.find((r) => r.dataClass === c && r.key === k);

describe('building canonical records from the guesthouse template pack', () => {
  const out = buildPack(tables(sampleGuesthousePack(BD)), { defaultCurrency: 'USD' });

  it('reads every row into exactly one record, without problems', () => {
    const counts: Record<string, number> = {};
    for (const r of out.records) counts[r.dataClass] = (counts[r.dataClass] ?? 0) + 1;
    expect(counts).toEqual({
      unit_type: 3,
      unit: 6,
      rate_plan: 2,
      guest: 6,
      reservation: 8,
      deposit: 2,
      in_house_balance: 1,
      ar_open_item: 2,
    });
    expect(out.records.flatMap((r) => r.problems)).toEqual([]);
    expect(out.unknownStatuses).toEqual([]);
  });
  it('keeps the source’s agreed amounts and taxes in minor units (never recomputed)', () => {
    const r = byKey(out.records, 'reservation', 'CN1001')?.payload as ReservationRecord;
    expect(r).toMatchObject({
      status: 'confirmed',
      arrival: '2026-12-04',
      departure: '2026-12-07',
      roomTotalMinor: 36000,
      totalMinor: 43920,
      taxInclusive: false,
      channel: { code: 'Booking.com', bookingId: 'BDC-4471002' },
      guarantee: 'deposit',
    });
    expect(r.taxes).toEqual([
      { code: 'TGST', name: 'T-GST', amountMinor: 6120 },
      { code: 'GREEN', name: 'Green Tax', amountMinor: 1800 },
    ]);
    expect(r.nightly).toEqual([
      { date: '2026-12-04', amountMinor: 12000 },
      { date: '2026-12-05', amountMinor: 12000 },
      { date: '2026-12-06', amountMinor: 12000 },
    ]);
    const incl = byKey(out.records, 'reservation', 'CN1008')?.payload as ReservationRecord;
    expect(incl).toMatchObject({ taxInclusive: true, roomTotalMinor: 40000, totalMinor: 40000 });
    expect((byKey(out.records, 'reservation', 'CN1004')?.payload as ReservationRecord).status).toBe(
      'in_house',
    );
    expect((byKey(out.records, 'reservation', 'CN1007')?.payload as ReservationRecord).status).toBe(
      'no_show',
    );
  });
  it('carries the tax already declared on deposits and the source’s control totals', () => {
    expect((byKey(out.records, 'deposit', 'CN1001')?.payload as DepositRecord).taxDeclared).toEqual([
      { code: 'TGST', name: 'T-GST', amountMinor: 1453 },
    ]);
    expect(out.controlTotals).toContainEqual({
      dataClass: 'deposit',
      currency: 'USD',
      count: 2,
      amountMinor: 30000,
    });
  });
});

describe('problems are reported per record, never guessed', () => {
  const base = sampleGuesthousePack(BD);
  it('totals that do not add up, nightly prices that miss a night, inverted dates and unknown statuses', () => {
    const pack = {
      ...base,
      reservations: [
        [
          'X1',
          'Confirmed',
          '2026-12-10',
          '2026-12-12',
          'DBL',
          '',
          '',
          'A B',
          '1',
          '0',
          '',
          'USD',
          '100.00',
          '17.00',
          '',
          '',
          'no',
          '118.00',
          '',
          '',
          '',
        ],
        [
          'X2',
          'Confirmed',
          '2026-12-10',
          '2026-12-09',
          'DBL',
          '',
          '',
          'A B',
          '1',
          '0',
          '',
          'USD',
          '100.00',
          '',
          '',
          '',
          'no',
          '',
          '',
          '',
          '',
        ],
        [
          'X3',
          'Waitlisted',
          '2026-12-10',
          '2026-12-12',
          'DBL',
          '',
          '',
          'A B',
          '1',
          '0',
          '',
          'USD',
          '100.00',
          '',
          '',
          '',
          'no',
          '',
          '',
          '',
          '',
        ],
        [
          'X4',
          'Confirmed',
          '2026-12-10',
          '2026-12-13',
          'DBL',
          '',
          '',
          'A B',
          '1',
          '0',
          '',
          'USD',
          '300.00',
          '',
          '',
          '',
          'no',
          '',
          '',
          '',
          '',
        ],
        [
          'X5',
          'Confirmed',
          '2026-12-10',
          '2026-12-11',
          'DBL',
          '',
          '',
          'A B',
          '1',
          '0',
          '',
          'USD',
          '1.250',
          '',
          '',
          '',
          'no',
          '',
          '',
          '',
          '',
        ],
      ],
      reservation_nights: [
        ['X4', '2026-12-10', '100.00'],
        ['X4', '2026-12-11', '100.00'],
      ],
    };
    const out = buildPack(tables(pack), { defaultCurrency: 'USD' });
    const codes = (k: string) => byKey(out.records, 'reservation', k)?.problems.map((p) => p.code);
    expect(codes('X1')).toEqual(['total_mismatch']);
    expect(codes('X2')).toEqual(['dates_inverted']);
    expect(codes('X3')).toEqual(['status_unmapped']);
    expect(codes('X4')).toEqual(['nightly_incomplete']);
    expect(codes('X5')).toContain('amount_ambiguous_separator');
    expect(out.unknownStatuses).toEqual(['waitlisted']);
    // a reviewed vocabulary decision imports it
    const decided = buildPack(tables(pack), {
      defaultCurrency: 'USD',
      statusMap: { waitlisted: 'tentative' },
    });
    expect(byKey(decided.records, 'reservation', 'X3')?.problems).toEqual([]);
  });
  it('masked names block the record; masked contacts are dropped with a warning', () => {
    const pack = {
      ...base,
      guests: [
        ['M1', 'J*****', 'S****', 'j***@example.com', '+960 *** **12', 'MV', '', '', ''],
        ['M2', 'Ann', 'Lee', 'j***@example.com', '', 'MV', '', '', ''],
      ],
    };
    const out = buildPack(tables(pack), { defaultCurrency: 'USD' });
    expect(byKey(out.records, 'guest', 'M1')?.problems.map((p) => [p.code, p.severity])).toContainEqual([
      'masked_identity',
      'blocking',
    ]);
    const m2 = byKey(out.records, 'guest', 'M2');
    expect(m2?.problems.map((p) => [p.code, p.severity])).toEqual([['masked_contact', 'warning']]);
    expect((m2?.payload as GuestRecord).email).toBeNull();
  });
  it('a folio whose charges minus payments differ from its balance is a finance problem', () => {
    const out = buildPack(
      tables({ ...base, in_house_balances: [['CN1004', '1', '640.00', '300.00', '345.00', 'USD']] }),
      {
        defaultCurrency: 'USD',
      },
    );
    expect(byKey(out.records, 'in_house_balance', 'CN1004#1')?.problems.map((p) => p.code)).toEqual([
      'folio_not_balancing',
    ]);
  });
});

describe('SMB export (assumed Little Hotelier layout): guests derived from reservation rows', () => {
  it('derives one guest per person (by email), DD/MM dates, statuses', () => {
    const file = sampleSmbExport(BD);
    const t = parseCsv(file.content);
    const hints = {
      'Booking Reference': 'confirmation',
      'Check In': 'arrival',
      'Check Out': 'departure',
      'Room Type': 'unit_type_code',
      'Guest First Name': 'guest_given_name',
      'Guest Last Name': 'guest_family_name',
      'Total Room Charges': 'room_total',
      'Channel Booking ID': 'channel_booking_id',
    };
    const columns = mapColumns('reservations', t.headers, hints).columns;
    const out = buildPack(
      [{ name: file.name, kind: 'reservations', table: t, columns, spreadsheet: false }],
      {
        defaultCurrency: 'USD',
        dateOrder: 'dmy',
      },
    );
    const res = out.records.filter((r) => r.dataClass === 'reservation');
    expect(res).toHaveLength(6);
    expect(res.flatMap((r) => r.problems)).toEqual([]);
    const guests = out.records
      .filter((r) => r.dataClass === 'guest')
      .map((g) => g.key)
      .sort();
    expect(guests).toEqual([
      'email:hana.i@example.test',
      'email:lena.v@example.test',
      'email:omar.s@example.test',
      'email:paolo.r@example.test',
    ]);
    const p = byKey(out.records, 'reservation', 'LH-2002')?.payload as ReservationRecord;
    expect(p).toMatchObject({
      status: 'in_house',
      arrival: '2026-11-30',
      guestKey: 'email:paolo.r@example.test',
    });
    expect(p.taxes).toEqual([{ code: 'TAX', name: 'Taxes (as stated by the source)', amountMinor: 8840 }]);
  });
});

describe('quality checks (M2)', () => {
  const records = buildPack(tables(sampleGuesthousePack(BD)), { defaultCurrency: 'USD' }).records;
  const ctx = {
    businessDate: BD,
    knownUnitTypes: new Set(['DBL', 'TWN', 'FAM']),
    unitsPerType: new Map([
      ['DBL', 3],
      ['TWN', 2],
      ['FAM', 1],
    ]),
  };
  it('the sample pack has only the expected duplicate-profile warnings', () => {
    const f = checkQuality(records, ctx);
    expect([...f.keys()].sort()).toEqual(['guest:G002', 'guest:G006']);
    expect(f.get('guest:G002')?.[0]).toMatchObject({
      code: 'possible_duplicate_profile',
      severity: 'warning',
    });
  });
  it('finds duplicate channel bookings, double-assigned units, overbooking, orphan and mismatched money', () => {
    const extra: SourceRecord[] = [
      ...records,
      {
        dataClass: 'reservation',
        key: 'DUP',
        payload: {
          ...((records.find((r) => r.key === 'CN1001')?.payload ?? {}) as ReservationRecord),
          guarantee: 'none',
        },
        origin: { file: 'x', row: 1 },
        problems: [],
      },
      {
        dataClass: 'deposit',
        key: 'NOPE',
        payload: { bookingKey: 'NOPE', amountMinor: 100, currency: 'USD', taxDeclared: [], receivedOn: null },
        origin: { file: 'x', row: 2 },
        problems: [],
      },
      {
        dataClass: 'deposit',
        key: 'CN1002',
        payload: {
          bookingKey: 'CN1002',
          amountMinor: 100,
          currency: 'EUR',
          taxDeclared: [],
          receivedOn: null,
        },
        origin: { file: 'x', row: 3 },
        problems: [],
      },
    ];
    const f = checkQuality(extra, { ...ctx, unitsPerType: new Map([['DBL', 1]]) });
    const codes = (id: string) => (f.get(id) ?? []).map((p) => p.code);
    expect(codes(recordId('reservation', 'DUP'))).toEqual(
      expect.arrayContaining(['duplicate_channel_booking', 'unit_double_assigned', 'overbooked_in_source']),
    );
    expect(codes(recordId('reservation', 'CN1001'))).toContain('duplicate_channel_booking');
    expect(codes(recordId('deposit', 'NOPE'))).toEqual(['deposit_without_booking']);
    expect(codes(recordId('deposit', 'CN1002'))).toEqual(['deposit_currency_mismatch']);
  });
  it('future stays already over, in-house dates outside today, unmapped unit types, prepaid without a deposit', () => {
    const r = (key: string, p: Partial<ReservationRecord>): SourceRecord => ({
      dataClass: 'reservation',
      key,
      payload: { ...((records.find((x) => x.key === 'CN1003')?.payload ?? {}) as ReservationRecord), ...p },
      origin: { file: 'x', row: 1 },
      problems: [],
    });
    const f = checkQuality(
      [
        r('PAST', { status: 'confirmed', arrival: '2026-11-20', departure: '2026-11-22' }),
        r('INH', { status: 'in_house', arrival: '2026-12-03', departure: '2026-12-05' }),
        r('UT', { unitTypeCode: 'VILLA' }),
        r('PRE', { guarantee: 'deposit' }),
      ],
      ctx,
    );
    expect(f.get('reservation:PAST')?.map((p) => p.code)).toEqual(['future_stay_in_past']);
    expect(f.get('reservation:INH')?.map((p) => p.code)).toEqual([
      'in_house_dates',
      'in_house_without_balance',
    ]);
    expect(f.get('reservation:UT')?.map((p) => p.code)).toEqual(['unit_type_unmapped']);
    expect(f.get('reservation:PRE')?.map((p) => p.code)).toEqual(['prepaid_without_deposit']);
  });
});
