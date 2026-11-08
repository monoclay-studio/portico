/**
 * R-P1-3 regression tests (steward review fix round 1): reconciliation is two-sided. The PoCs in
 * `docs/orchestration/reviews/migration-poc/zz-review-domain.test.ts.txt` › "R-P1-3" are inverted here.
 */
import { describe, expect, it } from 'vitest';
import { type LedgerEntry, type PorticoReadBack, reconcile } from './reconcile';
import type { ReservationRecord, SourceRecord } from './records';

const BD = '2026-12-01';
const payload: ReservationRecord = {
  status: 'departed',
  sourceStatus: 'departed',
  arrival: '2026-11-03',
  departure: '2026-11-05',
  unitTypeCode: 'DBL',
  unitNumber: null,
  guestKey: null,
  guestName: 'A B',
  adults: 2,
  children: 0,
  ratePlanCode: null,
  currency: 'USD',
  nightly: null,
  roomTotalMinor: 20000,
  taxes: [],
  taxInclusive: false,
  totalMinor: 20000,
  channel: null,
  guarantee: 'none',
};
const res = (key: string): SourceRecord => ({
  dataClass: 'reservation',
  key,
  payload,
  origin: { file: 'r.csv', row: 1 },
  problems: [],
});
const readBack = (sourceKey: string, bookingId: string, sourceSystem = 'pack:') => ({
  sourceSystem,
  sourceKey,
  bookingId,
  status: 'departed',
  arrival: '2026-11-03',
  departure: '2026-11-05',
  unitTypeId: 'ut-dbl',
  currency: 'USD',
  roomTotalMinor: 20000,
  taxTotalMinor: 0,
  totalMinor: 20000,
  nightly: null,
});
const portico = (over: Partial<PorticoReadBack>): PorticoReadBack => ({
  unitTypes: [{ code: 'DBL', id: 'ut-dbl' }],
  units: [],
  existingGuestIds: new Set(),
  reservations: [],
  sold: [],
  deposits: [],
  inHouse: [],
  receivables: [],
  unavailable: [],
  ...over,
});
const ledger: LedgerEntry[] = [{ dataClass: 'reservation', key: 'H1', state: 'imported', targetId: 'b1' }];
const base = {
  records: [res('H1')],
  ledger,
  controlTotals: [{ dataClass: 'reservation' as const, currency: null, count: 1, amountMinor: null }],
  businessDate: BD,
  scope: new Set(['reservation'] as const),
  unitTypeIdByCode: new Map([['DBL', 'ut-dbl']]),
  sourceSystem: 'pack:',
};
const codes = (r: ReturnType<typeof reconcile>) =>
  r.differences.filter((d) => !d.explained).map((d) => d.measure);

describe('R-P1-3 reconciliation counts the Portico side independently', () => {
  it('control: one booking in, one booking held → exact', () => {
    expect(reconcile({ ...base, portico: portico({ reservations: [readBack('H1', 'b1')] }) }).exact).toBe(
      true,
    );
  });

  it('two bookings held for one source booking (a duplicate) → not exact, duplicate_in_portico', () => {
    const r = reconcile({
      ...base,
      portico: portico({ reservations: [readBack('H1', 'b1'), readBack('H1', 'b2')] }),
    });
    expect(r.exact).toBe(false);
    expect(codes(r)).toContain('duplicate_in_portico');
    expect(r.differences.find((d) => d.measure === 'duplicate_in_portico')).toMatchObject({
      key: 'H1',
      portico: '2',
    });
  });

  it('a booking the source never had (re-keyed copy) → not exact, extra_in_portico; counts compare both sides', () => {
    const r = reconcile({
      ...base,
      portico: portico({ reservations: [readBack('H1', 'b1'), readBack('00H1', 'b9')] }),
    });
    expect(r.exact).toBe(false);
    expect(codes(r)).toContain('extra_in_portico');
    expect(r.measures.find((m) => m.measure.startsWith('count departed'))).toMatchObject({
      source: 1,
      portico: 2,
    });
  });

  it('the source control total says 1 reservation, Portico holds 2: the control count is compared', () => {
    const r = reconcile({
      ...base,
      portico: portico({ reservations: [readBack('H1', 'b1'), readBack('H1', 'b2')] }),
    });
    expect(r.controlTotals.filter((c) => c.dataClass === 'reservation')).toEqual([
      expect.objectContaining({
        kind: 'count',
        reported: 1,
        sourceDetail: 1,
        portico: 2,
        unexplainedMinor: -1,
      }),
    ]);
    expect(codes(r)).toContain('control_count');
  });

  it('the export holds fewer rows than the source reports → control_count_source', () => {
    const r = reconcile({
      ...base,
      controlTotals: [{ dataClass: 'reservation', currency: null, count: 2, amountMinor: null }],
      portico: portico({ reservations: [readBack('H1', 'b1')] }),
    });
    expect(codes(r)).toEqual(expect.arrayContaining(['control_count_source', 'control_count']));
  });

  it("another migration's copy of the property's bookings is a difference (two migrations of one property)", () => {
    const r = reconcile({
      ...base,
      portico: portico({ reservations: [readBack('H1', 'b1'), readBack('H1', 'b7', 'littlehotelier.csv:')] }),
    });
    expect(codes(r)).toContain('other_source_in_portico');
    // the other source's booking is not counted as this source's
    expect(r.measures.find((m) => m.measure.startsWith('count departed'))).toMatchObject({
      source: 1,
      portico: 1,
    });
  });

  it('money: Portico holds a deposit no source item accounts for → extra_in_portico; totals summed over the read-back', () => {
    const r = reconcile({
      ...base,
      scope: new Set(['reservation', 'deposit'] as const),
      controlTotals: [],
      portico: portico({
        reservations: [readBack('H1', 'b1')],
        deposits: [{ bookingId: 'b1', amountMinor: 50000, currency: 'USD' }],
      }),
    });
    expect(r.exact).toBe(false);
    expect(
      r.differences.find((d) => d.measure === 'extra_in_portico' && d.dataClass === 'deposit'),
    ).toMatchObject({
      key: 'b1',
      portico: '50000',
    });
    expect(r.measures.find((m) => m.dataClass === 'deposit' && m.measure === 'total held')).toMatchObject({
      source: 0,
      portico: 50000,
    });
  });
});
