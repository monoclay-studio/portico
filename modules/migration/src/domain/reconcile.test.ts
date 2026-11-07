import { describe, expect, it } from 'vitest';
import {
  evaluateCutoverGate,
  freezeMinutes,
  type GateInput,
  inRollbackWindow,
  rollbackWindowEnds,
} from './cutover';
import { diffSnapshots } from './delta';
import {
  emptyPlan,
  pendingReview,
  planFingerprint,
  suggestRatePlans,
  suggestUnitTypes,
  toUnitTypeCode,
} from './mapping';
import { initialSteps, resumePoint } from './pipeline';
import { agingBucket, type LedgerEntry, type PorticoReadBack, reconcile } from './reconcile';
import type { ReservationRecord, SourceRecord } from './records';

const BD = '2026-12-01';
const res = (key: string, p: Partial<ReservationRecord> = {}): SourceRecord => ({
  dataClass: 'reservation',
  key,
  payload: {
    status: 'confirmed',
    sourceStatus: 'Confirmed',
    arrival: '2026-12-03',
    departure: '2026-12-05',
    unitTypeCode: 'DBL',
    unitNumber: null,
    guestKey: null,
    guestName: 'A B',
    adults: 2,
    children: 0,
    ratePlanCode: null,
    currency: 'USD',
    nightly: [
      { date: '2026-12-03', amountMinor: 10000 },
      { date: '2026-12-04', amountMinor: 10000 },
    ],
    roomTotalMinor: 20000,
    taxes: [{ code: 'TGST', name: 'T-GST', amountMinor: 3400 }],
    taxInclusive: false,
    totalMinor: 23400,
    channel: null,
    guarantee: 'deposit',
    ...p,
  },
  origin: { file: 'r.csv', row: 1 },
  problems: [],
});
const dep = (key: string, amount: number): SourceRecord => ({
  dataClass: 'deposit',
  key,
  payload: { bookingKey: key, amountMinor: amount, currency: 'USD', taxDeclared: [], receivedOn: null },
  origin: { file: 'd.csv', row: 1 },
  problems: [],
});
const imported = (dataClass: LedgerEntry['dataClass'], key: string, targetId: string): LedgerEntry => ({
  dataClass,
  key,
  state: 'imported',
  targetId,
});

function portico(over: Partial<PorticoReadBack> = {}): PorticoReadBack {
  return {
    unitTypes: [{ code: 'DBL', id: 'ut-dbl' }],
    units: [],
    existingGuestIds: new Set(),
    reservations: [
      {
        sourceKey: 'R1',
        bookingId: 'b1',
        status: 'confirmed',
        arrival: '2026-12-03',
        departure: '2026-12-05',
        unitTypeId: 'ut-dbl',
        currency: 'USD',
        roomTotalMinor: 20000,
        taxTotalMinor: 3400,
        totalMinor: 23400,
        nightly: [
          { date: '2026-12-03', amountMinor: 10000 },
          { date: '2026-12-04', amountMinor: 10000 },
        ],
      },
    ],
    sold: [
      { unitTypeId: 'ut-dbl', date: '2026-12-03', sold: 1 },
      { unitTypeId: 'ut-dbl', date: '2026-12-04', sold: 1 },
    ],
    deposits: [{ bookingId: 'b1', amountMinor: 5000, currency: 'USD' }],
    inHouse: [],
    receivables: [],
    unavailable: [],
    ...over,
  };
}

function input(over: Partial<Parameters<typeof reconcile>[0]> = {}) {
  return {
    records: [res('R1'), dep('R1', 5000)],
    ledger: [imported('reservation', 'R1', 'b1'), imported('deposit', 'R1', 'b1')],
    controlTotals: [{ dataClass: 'deposit' as const, currency: 'USD', count: 1, amountMinor: 5000 }],
    portico: portico(),
    businessDate: BD,
    scope: new Set(['reservation', 'deposit'] as const),
    unitTypeIdByCode: new Map([['DBL', 'ut-dbl']]),
    ...over,
  };
}

describe('reconciliation (M4): exact, or every difference listed', () => {
  it('is exact when Portico holds what the source holds, to the minor unit', () => {
    const r = reconcile(input());
    expect(r.differences).toEqual([]);
    expect(r.exact).toBe(true);
    expect(r.controlTotals).toEqual([
      {
        dataClass: 'deposit',
        currency: 'USD',
        reported: 5000,
        sourceDetail: 5000,
        portico: 5000,
        excluded: 0,
        unexplainedMinor: 0,
      },
    ]);
  });
  it('S18: a deposit 1 minor unit off the source’s closing balance is not exact and is never plugged', () => {
    const r = reconcile(
      input({ controlTotals: [{ dataClass: 'deposit', currency: 'USD', count: 1, amountMinor: 5001 }] }),
    );
    expect(r.exact).toBe(false);
    expect(r.differences).toEqual([
      expect.objectContaining({ dataClass: 'deposit', measure: 'closing_balance', explained: false }),
    ]);
    expect(r.controlTotals[0]?.unexplainedMinor).toBe(1);
  });
  it('a deposit held back by an open exception is a listed exclusion; the closing balance still agrees', () => {
    const r = reconcile(
      input({
        records: [res('R1'), dep('R1', 5000), res('R2'), dep('R2', 700)],
        ledger: [
          imported('reservation', 'R1', 'b1'),
          imported('deposit', 'R1', 'b1'),
          { dataClass: 'reservation', key: 'R2', state: 'exception', targetId: null },
          { dataClass: 'deposit', key: 'R2', state: 'exception', targetId: null },
        ],
        controlTotals: [{ dataClass: 'deposit', currency: 'USD', count: 2, amountMinor: 5700 }],
      }),
    );
    expect(r.controlTotals[0]).toMatchObject({ excluded: 700, unexplainedMinor: 0 });
    expect(r.differences.filter((d) => !d.explained)).toEqual([]);
    expect(r.exact).toBe(true);
    expect(r.accounting.find((a) => a.dataClass === 'reservation')?.states).toMatchObject({
      imported: 1,
      exception: 1,
    });
  });
  it('reservation amounts, statuses, revenue per stay date and room nights are compared per booking', () => {
    const r = reconcile(
      input({
        portico: portico({
          reservations: [
            {
              ...portico().reservations[0],
              taxTotalMinor: 3401,
              totalMinor: 23401,
            } as PorticoReadBack['reservations'][number],
          ],
          sold: [{ unitTypeId: 'ut-dbl', date: '2026-12-03', sold: 2 }],
        }),
      }),
    );
    expect(r.exact).toBe(false);
    const m = r.differences.map((d) => d.measure);
    expect(m).toEqual(
      expect.arrayContaining(['tax_total', 'total', 'room_nights 2026-12-03', 'room_nights 2026-12-04']),
    );
  });
  it('a record with no outcome, a pending record or a provider that cannot read back is never "reconciled"', () => {
    expect(reconcile(input({ ledger: [imported('deposit', 'R1', 'b1')] })).exact).toBe(false);
    const pending = reconcile(
      input({
        ledger: [
          { ...imported('reservation', 'R1', 'b1'), state: 'pending' },
          imported('deposit', 'R1', 'b1'),
        ],
      }),
    );
    expect(pending.differences.some((d) => d.measure === 'pending')).toBe(true);
    const unavailable = reconcile(input({ portico: portico({ unavailable: ['reservation'] }) }));
    expect(unavailable.exact).toBe(false);
    expect(unavailable.differences[0]?.measure).toBe('read_back');
  });
  it('a record imported earlier but no longer in the source is a difference (never silently kept)', () => {
    const r = reconcile(input({ records: [dep('R1', 5000)] }));
    expect(r.exact).toBe(false);
    expect(r.differences).toContainEqual(
      expect.objectContaining({ dataClass: 'reservation', key: 'R1', measure: 'missing_in_source' }),
    );
  });
  it('the fingerprint is stable for identical results and changes with any difference', () => {
    expect(reconcile(input()).fingerprint).toBe(reconcile(input()).fingerprint);
    expect(reconcile(input()).fingerprint).not.toBe(
      reconcile(
        input({ controlTotals: [{ dataClass: 'deposit', currency: 'USD', count: 1, amountMinor: 5001 }] }),
      ).fingerprint,
    );
  });
  it('aging buckets by due date against the business date', () => {
    expect(agingBucket('2026-12-05', BD)).toBe('current');
    expect(agingBucket('2026-11-01', BD)).toBe('1-30');
    expect(agingBucket('2026-10-15', BD)).toBe('31-60');
    expect(agingBucket('2026-10-01', BD)).toBe('61-90');
    expect(agingBucket('2026-08-01', BD)).toBe('90+');
  });
});

describe('mapping suggestions', () => {
  it('maps to an existing unit type by code or name, otherwise creates a valid code from the source', () => {
    const s = suggestUnitTypes(
      [
        { code: 'DBL', name: 'Double' },
        { code: 'SEA VIEW', name: 'Sea View' },
        { code: 'FAM', name: 'Family Suite' },
      ],
      [
        { id: 'a', code: 'DBL', name: 'Double' },
        { id: 'b', code: 'FS', name: 'Family suite' },
      ],
    );
    expect(s.map((d) => [d.sourceCode, d.action, d.targetCode, d.confidence])).toEqual([
      ['DBL', 'map', 'DBL', 1],
      ['SEA VIEW', 'create', 'SEA-VIEW', 1],
      ['FAM', 'map', 'FS', 0.9],
    ]);
    expect(toUnitTypeCode('Garden View (Deluxe)')).toBe('GARDEN-VIEW-DELUXE');
  });
  it('rate plans are only suggested: never created and never priced', () => {
    const r = suggestRatePlans([{ code: 'NRF', name: 'Non refundable' }], []);
    expect(r[0]).toMatchObject({ action: 'not_in_portico', targetId: null });
    expect(r[0]?.reasons[0]).toMatch(/no prices are copied or invented/);
  });
  it('pending review: low confidence, unknown statuses, ambiguous dates and every tax mapping (finance)', () => {
    const plan = {
      ...emptyPlan('USD', ['reservation']),
      unitTypes: suggestUnitTypes(
        [{ code: 'FAM', name: 'Family suite room' }],
        [{ id: 'b', code: 'FS', name: 'Family suite' }],
      ),
      statuses: [{ sourceWord: 'waitlisted', status: null, reviewedBy: null }],
      taxAccounts: [{ sourceCode: 'TGST', accountKey: 'tgst', confidence: 0.9, reviewedBy: null }],
      ambiguousDateColumns: ['r.csv:arrival'],
    };
    expect(pendingReview(plan).map((p) => [p.kind, p.financial])).toEqual([
      ['unitType', false],
      ['status', false],
      ['taxAccount', true],
      ['dateOrder', false],
    ]);
  });
  it('the plan fingerprint ignores Portico ids (a trial rehearsal and the live cutover run the same plan)', () => {
    const base = { ...emptyPlan('USD', ['reservation']) };
    const a = {
      ...base,
      unitTypes: suggestUnitTypes(
        [{ code: 'DBL', name: 'Double' }],
        [{ id: 'trial-id', code: 'DBL', name: 'Double' }],
      ),
    };
    const b = {
      ...base,
      unitTypes: suggestUnitTypes(
        [{ code: 'DBL', name: 'Double' }],
        [{ id: 'live-id', code: 'DBL', name: 'Double' }],
      ),
    };
    expect(planFingerprint(a)).toBe(planFingerprint(b));
    expect(planFingerprint(a)).not.toBe(planFingerprint({ ...a, dateOrder: 'dmy' }));
  });
});

describe('cutover gate, freeze and window', () => {
  const AUTH = { planFingerprint: 'P', grantedBy: 'user:b', expiresAt: new Date('2026-12-02T00:00:00Z') };
  const ok: GateInput = {
    purpose: 'production',
    environment: 'live',
    checklist: (
      [
        'data_authorization',
        'source_access',
        'card_transfer',
        'opening_balances',
        'channel_switch',
        'cutover_window',
        'staff_acceptance',
      ] as const
    ).map((key) => ({ key, status: 'done' as const })),
    certificate: { planFingerprint: 'P', exact: true },
    planFingerprint: 'P',
    authorization: AUTH,
    jobCreatedBy: 'user:a',
    transition: { status: 'planned', approved: true },
    openBlockingExceptions: 0,
    finalExtractBlocking: 0,
    now: new Date('2026-12-01T00:00:00Z'),
  };
  const codes = (g: Partial<GateInput>) => evaluateCutoverGate({ ...ok, ...g }).blockers.map((b) => b.code);
  it('passes only when every gate holds', () => {
    expect(evaluateCutoverGate(ok)).toEqual({ passed: true, blockers: [] });
  });
  it('lists each blocker in plain language', () => {
    expect(codes({ environment: 'trial' })).toEqual(['not_live']);
    expect(codes({ certificate: null })).toEqual(['no_rehearsal']);
    expect(codes({ planFingerprint: 'Q', authorization: { ...AUTH, planFingerprint: 'Q' } })).toEqual([
      'plan_changed_since_rehearsal',
    ]);
    expect(codes({ authorization: null })).toEqual(['production_authorization_missing']);
    expect(codes({ authorization: { ...AUTH, grantedBy: 'user:a' } })).toEqual(['authorization_same_person']);
    expect(codes({ now: new Date('2026-12-03T00:00:00Z') })).toEqual(['authorization_expired']);
    expect(codes({ transition: { status: 'planned', approved: false } })).toEqual([
      'transition_not_approved',
    ]);
    expect(codes({ openBlockingExceptions: 2, finalExtractBlocking: 1 })).toEqual([
      'open_blocking_exceptions',
      'final_capture_blocking',
    ]);
    expect(codes({ checklist: ok.checklist.filter((c) => c.key !== 'staff_acceptance') })).toEqual([
      'checklist_staff_acceptance',
    ]);
    // a drill needs no checklist or authorization, but never runs in live
    expect(
      codes({ purpose: 'rehearsal', environment: 'sandbox', authorization: null, checklist: [] }),
    ).toEqual([]);
    expect(codes({ purpose: 'rehearsal', environment: 'live', authorization: null, checklist: [] })).toEqual([
      'drill_in_live',
    ]);
  });
  it('freeze minutes and the rollback window', () => {
    expect(freezeMinutes(new Date('2026-12-01T10:00:00Z'), new Date('2026-12-01T10:12:30Z'))).toBe(12.5);
    const end = rollbackWindowEnds(new Date('2026-12-01T10:00:00Z'));
    expect(end.toISOString()).toBe('2026-12-03T10:00:00.000Z');
    expect(inRollbackWindow(new Date('2026-12-01T10:00:00Z'), end, new Date('2026-12-03T09:59:59Z'))).toBe(
      true,
    );
    expect(inRollbackWindow(new Date('2026-12-01T10:00:00Z'), end, end)).toBe(false);
  });
  it('resume point and delta detection', () => {
    const s = initialSteps();
    expect(resumePoint(s)).toBe('discover');
    expect(resumePoint({ ...s, discover: 'succeeded', extract: 'succeeded', map: 'waiting' })).toBe('map');
    const d = diffSnapshots(
      [
        { dataClass: 'reservation', key: 'A', hash: '1' },
        { dataClass: 'reservation', key: 'B', hash: '1' },
      ],
      [
        { dataClass: 'reservation', key: 'A', hash: '2' },
        { dataClass: 'reservation', key: 'C', hash: '1' },
      ],
    );
    expect([
      d.added.map((x) => x.key),
      d.changed.map((x) => x.key),
      d.removed.map((x) => x.key),
      d.unchanged,
    ]).toEqual([['C'], ['A'], ['B'], 0]);
  });
});
