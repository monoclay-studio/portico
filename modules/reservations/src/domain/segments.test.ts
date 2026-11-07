import { describe, expect, it } from 'vitest';
import {
  assertSegmentsCover,
  newDemand,
  normalizeTargets,
  planAssignments,
  planInventory,
  planStayChange,
  type SegmentState,
  splitAt,
  toRanges,
} from './segments';

const occ = { adults: 2, childrenAges: [] as number[] };
const seg = (from: string, to: string, extra: Partial<SegmentState> = {}): SegmentState => ({
  from,
  to,
  unitTypeId: 'beach',
  ratePlanId: 'bar',
  occupancy: occ,
  termsSnapshotId: 'T1',
  unitId: 'V214',
  ...extra,
});
const stay = { arrival: '2026-12-10', departure: '2026-12-13' };
const expected = { inHouse: false, businessDate: '2026-12-01' };

describe('segments cover the stay exactly (RES-I01)', () => {
  it('accepts contiguous, exact coverage', () => {
    expect(() =>
      assertSegmentsCover('2026-12-10', '2026-12-13', [
        seg('2026-12-10', '2026-12-11'),
        seg('2026-12-11', '2026-12-13'),
      ]),
    ).not.toThrow();
  });
  it('rejects gaps, overlaps, short coverage and empty segments', () => {
    expect(() =>
      assertSegmentsCover('2026-12-10', '2026-12-13', [
        seg('2026-12-10', '2026-12-11'),
        seg('2026-12-12', '2026-12-13'),
      ]),
    ).toThrow(/cover every night/);
    expect(() =>
      assertSegmentsCover('2026-12-10', '2026-12-13', [
        seg('2026-12-10', '2026-12-12'),
        seg('2026-12-11', '2026-12-13'),
      ]),
    ).toThrow(/cover every night/);
    expect(() => assertSegmentsCover('2026-12-10', '2026-12-13', [seg('2026-12-10', '2026-12-12')])).toThrow(
      /departs 2026-12-13/,
    );
    expect(() =>
      assertSegmentsCover('2026-12-10', '2026-12-13', [
        seg('2026-12-10', '2026-12-10'),
        seg('2026-12-10', '2026-12-13'),
      ]),
    ).toThrow(/no nights/);
  });
  it('splits a segment at a date and merges identical neighbours back', () => {
    const split = splitAt([seg('2026-12-10', '2026-12-13')], '2026-12-12');
    expect(split.map((s) => [s.from, s.to])).toEqual([
      ['2026-12-10', '2026-12-12'],
      ['2026-12-12', '2026-12-13'],
    ]);
    expect(splitAt([seg('2026-12-10', '2026-12-13')], '2026-12-10')).toHaveLength(1);
    const merged = normalizeTargets(
      split.map((s) => ({ ...s, pricing: { kind: 'keep' as const, termsSnapshotId: 'T1' } })),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.to).toBe('2026-12-13');
  });
});

describe('date changes (extend / shorten / shift)', () => {
  it('extension keeps agreed terms and re-prices the segment that gains nights', () => {
    const t = planStayChange(
      [seg('2026-12-10', '2026-12-13')],
      stay,
      { kind: 'dates', arrival: '2026-12-10', departure: '2026-12-15' },
      expected,
    );
    expect(t).toEqual([
      expect.objectContaining({
        from: '2026-12-10',
        to: '2026-12-15',
        unitId: 'V214',
        pricing: { kind: 'reprice', baseTermsSnapshotId: 'T1' },
      }),
    ]);
  });

  it('shortening keeps the agreed terms untouched', () => {
    const t = planStayChange(
      [seg('2026-12-10', '2026-12-13')],
      stay,
      { kind: 'dates', arrival: '2026-12-10', departure: '2026-12-12' },
      expected,
    );
    expect(t).toEqual([
      expect.objectContaining({
        from: '2026-12-10',
        to: '2026-12-12',
        pricing: { kind: 'keep', termsSnapshotId: 'T1' },
      }),
    ]);
  });

  it('S03 option (a): extra nights in another unit of the same type create a new segment', () => {
    const t = planStayChange(
      [seg('2026-12-10', '2026-12-13')],
      stay,
      {
        kind: 'dates',
        arrival: '2026-12-10',
        departure: '2026-12-15',
        extraNights: { strategy: 'move_extra_nights', unitId: 'V215' },
      },
      expected,
    );
    expect(t.map((x) => [x.from, x.to, x.unitId, x.pricing.kind])).toEqual([
      ['2026-12-10', '2026-12-13', 'V214', 'keep'],
      ['2026-12-13', '2026-12-15', 'V215', 'reprice'],
    ]);
  });

  it('S03 option (b): move the whole stay to a unit free for the full period', () => {
    const t = planStayChange(
      [seg('2026-12-10', '2026-12-13')],
      stay,
      {
        kind: 'dates',
        arrival: '2026-12-10',
        departure: '2026-12-15',
        extraNights: { strategy: 'move_whole_stay', unitId: 'V300' },
      },
      expected,
    );
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({
      from: '2026-12-10',
      to: '2026-12-15',
      unitId: 'V300',
      pricing: { kind: 'reprice' },
    });
  });

  it('S03 option (c): another unit type for the extra nights with the type-change policy', () => {
    const t = planStayChange(
      [seg('2026-12-10', '2026-12-13')],
      stay,
      {
        kind: 'dates',
        arrival: '2026-12-10',
        departure: '2026-12-14',
        extraNights: {
          strategy: 'change_type_extra',
          unitTypeId: 'overwater',
          unitId: 'W01',
          typeChange: 'keep_agreed',
        },
      },
      expected,
    );
    expect(t[1]).toMatchObject({
      from: '2026-12-13',
      to: '2026-12-14',
      unitTypeId: 'overwater',
      unitId: 'W01',
      pricing: { kind: 'reprice', typeChange: 'keep_agreed' },
    });
  });

  it('early arrival extends the first segment backwards', () => {
    const t = planStayChange(
      [
        seg('2026-12-10', '2026-12-12', { termsSnapshotId: 'A' }),
        seg('2026-12-12', '2026-12-13', { termsSnapshotId: 'B', unitId: 'V215' }),
      ],
      stay,
      {
        kind: 'dates',
        arrival: '2026-12-09',
        departure: '2026-12-13',
      },
      expected,
    );
    expect(t.map((x) => [x.from, x.to, x.pricing.kind])).toEqual([
      ['2026-12-09', '2026-12-12', 'reprice'],
      ['2026-12-12', '2026-12-13', 'keep'],
    ]);
  });

  it('in-house stays cannot move arrival or depart before the business date', () => {
    const inHouse = { inHouse: true, businessDate: '2026-12-11' };
    expect(() =>
      planStayChange(
        [seg('2026-12-10', '2026-12-13')],
        stay,
        { kind: 'dates', arrival: '2026-12-09', departure: '2026-12-13' },
        inHouse,
      ),
    ).toThrow(/arrival date cannot change/);
    expect(() =>
      planStayChange(
        [seg('2026-12-10', '2026-12-13')],
        stay,
        { kind: 'dates', arrival: '2026-12-10', departure: '2026-12-10' },
        inHouse,
      ),
    ).toThrow(/after arrival/);
  });
});

describe('type, rate plan, occupancy and unit moves', () => {
  it('a split stay changes the unit type from a date and re-prices only those nights', () => {
    const t = planStayChange(
      [seg('2026-12-10', '2026-12-13')],
      stay,
      { kind: 'unit_type', unitTypeId: 'overwater', fromDate: '2026-12-12', typeChange: 'difference' },
      expected,
    );
    expect(t.map((x) => [x.from, x.to, x.unitTypeId, x.unitId, x.pricing.kind])).toEqual([
      ['2026-12-10', '2026-12-12', 'beach', 'V214', 'keep'],
      ['2026-12-12', '2026-12-13', 'overwater', null, 'reprice'],
    ]);
  });

  it('a room move to the same type keeps agreed terms; to another type re-prices', () => {
    const same = planStayChange(
      [seg('2026-12-10', '2026-12-13')],
      stay,
      {
        kind: 'move',
        unitId: 'V215',
        unitTypeId: 'beach',
        fromDate: '2026-12-11',
        typeChange: 'keep_agreed',
      },
      expected,
    );
    expect(same.map((x) => [x.from, x.unitId, x.pricing.kind])).toEqual([
      ['2026-12-10', 'V214', 'keep'],
      ['2026-12-11', 'V215', 'keep'],
    ]);
    const upgrade = planStayChange(
      [seg('2026-12-10', '2026-12-13')],
      stay,
      {
        kind: 'move',
        unitId: 'W01',
        unitTypeId: 'overwater',
        fromDate: '2026-12-10',
        typeChange: 'keep_agreed',
      },
      expected,
    );
    expect(upgrade).toEqual([
      expect.objectContaining({
        unitTypeId: 'overwater',
        unitId: 'W01',
        pricing: { kind: 'reprice', baseTermsSnapshotId: 'T1', typeChange: 'keep_agreed' },
      }),
    ]);
  });

  it('occupancy and rate plan changes re-price from the change date only', () => {
    const t = planStayChange(
      [seg('2026-12-10', '2026-12-13')],
      stay,
      { kind: 'occupancy', occupancy: { adults: 2, childrenAges: [6] }, fromDate: '2026-12-11' },
      expected,
    );
    expect(t.map((x) => [x.from, x.occupancy.childrenAges, x.pricing.kind])).toEqual([
      ['2026-12-10', [], 'keep'],
      ['2026-12-11', [6], 'reprice'],
    ]);
    const unchanged = planStayChange(
      [seg('2026-12-10', '2026-12-13')],
      stay,
      { kind: 'rate_plan', ratePlanId: 'bar', fromDate: '2026-12-10' },
      expected,
    );
    expect(unchanged[0]?.pricing.kind).toBe('keep');
  });

  it('refuses to change nights already charged for an in-house stay', () => {
    expect(() =>
      planStayChange(
        [seg('2026-12-10', '2026-12-13')],
        stay,
        {
          kind: 'move',
          unitId: 'V215',
          unitTypeId: 'beach',
          fromDate: '2026-12-10',
          typeChange: 'keep_agreed',
        },
        { inHouse: true, businessDate: '2026-12-11' },
      ),
    ).toThrow(/already been charged/);
    expect(() =>
      planStayChange(
        [seg('2026-12-10', '2026-12-13')],
        stay,
        { kind: 'rate_plan', ratePlanId: 'x', fromDate: '2026-12-13' },
        expected,
      ),
    ).toThrow(/night of the stay/);
  });
});

describe('inventory and assignment plans', () => {
  it('turns segment changes into release / change / consume operations', () => {
    const ops = planInventory(
      [seg('2026-12-10', '2026-12-13')],
      [seg('2026-12-11', '2026-12-12'), seg('2026-12-12', '2026-12-15', { unitTypeId: 'overwater' })],
    );
    expect(ops).toEqual([
      { op: 'release', nights: { from: '2026-12-10', to: '2026-12-11' } },
      {
        op: 'change',
        from: { unitTypeId: 'beach', nights: { from: '2026-12-12', to: '2026-12-13' } },
        to: { unitTypeId: 'overwater', nights: { from: '2026-12-12', to: '2026-12-13' } },
      },
      { op: 'consume', unitTypeId: 'overwater', nights: { from: '2026-12-13', to: '2026-12-15' } },
    ]);
  });

  it('reports new demand per (type, night) beyond what the stay already holds', () => {
    expect(newDemand([seg('2026-12-10', '2026-12-13')], [seg('2026-12-10', '2026-12-14')])).toEqual([
      { unitTypeId: 'beach', date: '2026-12-13' },
    ]);
  });

  it('unassigns first, then assigns new units per contiguous run', () => {
    const ops = planAssignments(
      [seg('2026-12-10', '2026-12-13')],
      [seg('2026-12-10', '2026-12-12'), seg('2026-12-12', '2026-12-14', { unitId: 'V215' })],
    );
    expect(ops).toEqual([
      { op: 'unassign', nights: { from: '2026-12-12', to: '2026-12-13' } },
      { op: 'assign', unitId: 'V215', nights: { from: '2026-12-12', to: '2026-12-14' } },
    ]);
  });

  it('builds contiguous ranges', () => {
    expect(toRanges(['2026-12-12', '2026-12-10', '2026-12-11', '2026-12-14'])).toEqual([
      { from: '2026-12-10', to: '2026-12-13' },
      { from: '2026-12-14', to: '2026-12-15' },
    ]);
  });
});
