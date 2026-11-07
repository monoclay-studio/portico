import {
  addDays,
  BusinessRuleError,
  type DateRange,
  eachNight,
  type LocalDate,
  type Occupancy,
  ValidationError,
} from '@portico/kernel';

/**
 * Stay segments partition a stay's nights (RES-R03 / RES-I01): each has a unit type, rate plan, occupancy,
 * agreed terms and (optionally) an assigned unit. Split stays and room moves create segments.
 */
export interface SegmentState {
  from: LocalDate;
  to: LocalDate;
  unitTypeId: string;
  ratePlanId: string;
  occupancy: Occupancy;
  termsSnapshotId: string;
  unitId: string | null;
}

/** How a target segment gets its agreed terms. */
export type SegmentPricing =
  | { kind: 'keep'; termsSnapshotId: string }
  | {
      kind: 'reprice';
      baseTermsSnapshotId: string;
      typeChange?: 'keep_agreed' | 'difference' | 'reprice';
    };

export interface TargetSegment {
  from: LocalDate;
  to: LocalDate;
  unitTypeId: string;
  ratePlanId: string;
  occupancy: Occupancy;
  unitId: string | null;
  pricing: SegmentPricing;
}

export type ExtraNightsPlan =
  | { strategy: 'keep_unit' }
  | { strategy: 'move_extra_nights'; unitId: string }
  | { strategy: 'move_whole_stay'; unitId: string }
  | {
      strategy: 'change_type_extra';
      unitTypeId: string;
      unitId: string | null;
      typeChange: 'keep_agreed' | 'difference' | 'reprice';
    };

export type StayChange =
  | { kind: 'dates'; arrival: LocalDate; departure: LocalDate; extraNights?: ExtraNightsPlan }
  | {
      kind: 'unit_type';
      unitTypeId: string;
      fromDate: LocalDate;
      ratePlanId?: string;
      unitId?: string | null;
      typeChange: 'keep_agreed' | 'difference' | 'reprice';
    }
  | { kind: 'rate_plan'; ratePlanId: string; fromDate: LocalDate }
  | { kind: 'occupancy'; occupancy: Occupancy; fromDate: LocalDate }
  | {
      kind: 'move';
      unitId: string;
      unitTypeId: string;
      fromDate: LocalDate;
      typeChange: 'keep_agreed' | 'difference' | 'reprice';
    };

export function sortSegments<T extends { from: LocalDate }>(segments: readonly T[]): T[] {
  return [...segments].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/** RES-I01: segments are non-overlapping, contiguous and exactly cover [arrival, departure). */
export function assertSegmentsCover(
  arrival: LocalDate,
  departure: LocalDate,
  segments: ReadonlyArray<{ from: LocalDate; to: LocalDate }>,
): void {
  if (departure <= arrival) {
    throw new ValidationError(
      'invalid_date_range',
      `Departure (${departure}) must be after arrival (${arrival}).`,
    );
  }
  const sorted = sortSegments(segments);
  let cursor = arrival;
  for (const s of sorted) {
    if (s.to <= s.from) {
      throw new ValidationError('invalid_segment', `A stay segment ${s.from}→${s.to} has no nights.`);
    }
    if (s.from !== cursor) {
      throw new ValidationError(
        'segments_not_contiguous',
        `Stay segments must cover every night exactly once; expected a segment starting ${cursor} but found ${s.from}.`,
        { expected: cursor, found: s.from },
      );
    }
    cursor = s.to;
  }
  if (cursor !== departure) {
    throw new ValidationError(
      'segments_not_covering',
      `Stay segments end on ${cursor} but the stay departs ${departure}.`,
      { end: cursor, departure },
    );
  }
}

/** Split the segment containing `date` so that a segment starts exactly at `date`. */
export function splitAt<T extends { from: LocalDate; to: LocalDate }>(
  segments: readonly T[],
  date: LocalDate,
): T[] {
  const out: T[] = [];
  for (const s of sortSegments(segments)) {
    if (date > s.from && date < s.to) {
      out.push({ ...s, to: date }, { ...s, from: date });
    } else out.push(s);
  }
  return out;
}

function sameOccupancy(a: Occupancy, b: Occupancy): boolean {
  return a.adults === b.adults && a.childrenAges.join(',') === b.childrenAges.join(',');
}

function samePricing(a: SegmentPricing, b: SegmentPricing): boolean {
  if (a.kind === 'keep' && b.kind === 'keep') return a.termsSnapshotId === b.termsSnapshotId;
  if (a.kind === 'reprice' && b.kind === 'reprice')
    return a.baseTermsSnapshotId === b.baseTermsSnapshotId && a.typeChange === b.typeChange;
  return false;
}

/** Merge adjacent segments that are identical in every respect (normal form). */
export function normalizeTargets(segments: readonly TargetSegment[]): TargetSegment[] {
  const out: TargetSegment[] = [];
  for (const s of sortSegments(segments)) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.to === s.from &&
      prev.unitTypeId === s.unitTypeId &&
      prev.ratePlanId === s.ratePlanId &&
      prev.unitId === s.unitId &&
      sameOccupancy(prev.occupancy, s.occupancy) &&
      samePricing(prev.pricing, s.pricing)
    ) {
      prev.to = s.to;
    } else out.push({ ...s, occupancy: { ...s.occupancy, childrenAges: [...s.occupancy.childrenAges] } });
  }
  return out;
}

const keep = (s: SegmentState): TargetSegment => ({
  from: s.from,
  to: s.to,
  unitTypeId: s.unitTypeId,
  ratePlanId: s.ratePlanId,
  occupancy: s.occupancy,
  unitId: s.unitId,
  pricing: { kind: 'keep', termsSnapshotId: s.termsSnapshotId },
});

export interface PlanContext {
  /** Stay status: in-house stays cannot change nights before the business date. */
  inHouse: boolean;
  businessDate: LocalDate;
}

function assertChangeable(fromDate: LocalDate, arrival: LocalDate, departure: LocalDate, ctx: PlanContext) {
  if (fromDate < arrival || fromDate >= departure) {
    throw new ValidationError(
      'change_date_outside_stay',
      `The change must start on a night of the stay (${arrival} to ${addDays(departure, -1)}).`,
      { fromDate, arrival, departure },
    );
  }
  if (ctx.inHouse && fromDate < ctx.businessDate) {
    throw new BusinessRuleError(
      'past_nights_immutable',
      `Nights before the business date (${ctx.businessDate}) have already been charged and cannot be changed. Start the change on ${ctx.businessDate} or later.`,
      { fromDate, businessDate: ctx.businessDate },
    );
  }
}

/**
 * Plan the target segments for a change (pure). Agreed nights keep their terms; nights that gain a different type,
 * rate plan or occupancy, or that are new, are re-priced against the agreed terms by rates.priceChange.
 */
export function planStayChange(
  current: readonly SegmentState[],
  stay: { arrival: LocalDate; departure: LocalDate },
  change: StayChange,
  ctx: PlanContext,
): TargetSegment[] {
  const segments = sortSegments(current);
  assertSegmentsCover(stay.arrival, stay.departure, segments);
  switch (change.kind) {
    case 'dates':
      return planDates(segments, stay, change, ctx);
    case 'unit_type': {
      assertChangeable(change.fromDate, stay.arrival, stay.departure, ctx);
      return normalizeTargets(
        splitAt(segments, change.fromDate).map((s) =>
          s.from >= change.fromDate
            ? {
                ...keep(s),
                unitTypeId: change.unitTypeId,
                ratePlanId: change.ratePlanId ?? s.ratePlanId,
                unitId: change.unitId === undefined ? null : change.unitId,
                pricing: {
                  kind: 'reprice',
                  baseTermsSnapshotId: s.termsSnapshotId,
                  typeChange: change.typeChange,
                },
              }
            : keep(s),
        ),
      );
    }
    case 'rate_plan': {
      assertChangeable(change.fromDate, stay.arrival, stay.departure, ctx);
      return normalizeTargets(
        splitAt(segments, change.fromDate).map((s) =>
          s.from >= change.fromDate && s.ratePlanId !== change.ratePlanId
            ? {
                ...keep(s),
                ratePlanId: change.ratePlanId,
                pricing: { kind: 'reprice', baseTermsSnapshotId: s.termsSnapshotId },
              }
            : keep(s),
        ),
      );
    }
    case 'occupancy': {
      assertChangeable(change.fromDate, stay.arrival, stay.departure, ctx);
      return normalizeTargets(
        splitAt(segments, change.fromDate).map((s) =>
          s.from >= change.fromDate && !sameOccupancy(s.occupancy, change.occupancy)
            ? {
                ...keep(s),
                occupancy: change.occupancy,
                pricing: { kind: 'reprice', baseTermsSnapshotId: s.termsSnapshotId },
              }
            : keep(s),
        ),
      );
    }
    case 'move': {
      assertChangeable(change.fromDate, stay.arrival, stay.departure, ctx);
      return normalizeTargets(
        splitAt(segments, change.fromDate).map((s) => {
          if (s.from < change.fromDate) return keep(s);
          if (s.unitTypeId === change.unitTypeId) return { ...keep(s), unitId: change.unitId };
          return {
            ...keep(s),
            unitId: change.unitId,
            unitTypeId: change.unitTypeId,
            pricing: {
              kind: 'reprice',
              baseTermsSnapshotId: s.termsSnapshotId,
              typeChange: change.typeChange,
            },
          };
        }),
      );
    }
  }
}

function planDates(
  segments: SegmentState[],
  stay: { arrival: LocalDate; departure: LocalDate },
  change: Extract<StayChange, { kind: 'dates' }>,
  ctx: PlanContext,
): TargetSegment[] {
  const { arrival, departure } = change;
  if (departure <= arrival) {
    throw new ValidationError(
      'invalid_date_range',
      `Departure (${departure}) must be after arrival (${arrival}).`,
    );
  }
  if (ctx.inHouse && arrival !== stay.arrival) {
    throw new BusinessRuleError(
      'arrival_immutable_in_house',
      'The guest has already checked in, so the arrival date cannot change. Change the departure instead.',
    );
  }
  if (ctx.inHouse && departure < ctx.businessDate) {
    throw new BusinessRuleError(
      'departure_before_business_date',
      `An in-house stay cannot depart before the current business date (${ctx.businessDate}).`,
    );
  }
  const plan = change.extraNights ?? { strategy: 'keep_unit' };
  const last = segments[segments.length - 1] as SegmentState;
  // Assign every target night to an existing segment (by index) or to the extra-nights segment (-1).
  const nights = eachNight({ from: arrival, to: departure });
  const pieces: Array<{ segIndex: number; target: TargetSegment }> = [];
  const gained = new Set<number>();
  for (const night of nights) {
    const next = addDays(night, 1);
    let segIndex = segments.findIndex((s) => night >= s.from && night < s.to);
    if (segIndex < 0) {
      if (night < stay.arrival) segIndex = 0;
      else if (plan.strategy === 'move_extra_nights' || plan.strategy === 'change_type_extra') segIndex = -1;
      else segIndex = segments.length - 1;
      if (segIndex >= 0) gained.add(segIndex);
    }
    if (segIndex === -1) {
      pieces.push({
        segIndex,
        target: {
          from: night,
          to: next,
          unitTypeId: plan.strategy === 'change_type_extra' ? plan.unitTypeId : last.unitTypeId,
          ratePlanId: last.ratePlanId,
          occupancy: last.occupancy,
          unitId:
            plan.strategy === 'change_type_extra' || plan.strategy === 'move_extra_nights'
              ? plan.unitId
              : null,
          pricing: {
            kind: 'reprice',
            baseTermsSnapshotId: last.termsSnapshotId,
            ...(plan.strategy === 'change_type_extra' ? { typeChange: plan.typeChange } : {}),
          },
        },
      });
      continue;
    }
    const seg = segments[segIndex] as SegmentState;
    pieces.push({ segIndex, target: { ...keep(seg), from: night, to: next } });
  }
  // A segment that gained nights is re-priced as a whole: priceChange keeps agreed nights at agreed prices and
  // prices only the new nights by policy (RAT-R29).
  const targets = pieces.map(({ segIndex, target }) =>
    segIndex >= 0 && gained.has(segIndex) && target.pricing.kind === 'keep'
      ? {
          ...target,
          pricing: { kind: 'reprice', baseTermsSnapshotId: target.pricing.termsSnapshotId } as SegmentPricing,
        }
      : target,
  );
  const unitPlan =
    plan.strategy === 'move_whole_stay' ? targets.map((t) => ({ ...t, unitId: plan.unitId })) : targets;
  return normalizeTargets(unitPlan);
}

// ───────────────────────────── inventory & assignment plans ─────────────────────────────

/** Contiguous half-open ranges from a set of nights. */
export function toRanges(nights: readonly LocalDate[]): DateRange[] {
  const sorted = [...new Set(nights)].sort();
  const out: DateRange[] = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.to === n) out[out.length - 1] = { from: prev.from, to: addDays(n, 1) };
    else out.push({ from: n, to: addDays(n, 1) });
  }
  return out;
}

function nightMap<T>(
  segments: ReadonlyArray<{ from: LocalDate; to: LocalDate }>,
  pick: (s: never) => T,
): Map<LocalDate, T> {
  const m = new Map<LocalDate, T>();
  for (const s of segments) for (const n of eachNight({ from: s.from, to: s.to })) m.set(n, pick(s as never));
  return m;
}

export type InventoryOp =
  | { op: 'release'; nights: DateRange }
  | {
      op: 'change';
      from: { unitTypeId: string; nights: DateRange };
      to: { unitTypeId: string; nights: DateRange };
    }
  | { op: 'consume'; unitTypeId: string; nights: DateRange };

/** Inventory operations turning the current consumption into the target consumption (one ref = the stay). */
export function planInventory(
  current: ReadonlyArray<{ from: LocalDate; to: LocalDate; unitTypeId: string }>,
  target: ReadonlyArray<{ from: LocalDate; to: LocalDate; unitTypeId: string }>,
): InventoryOp[] {
  const cur = nightMap<string>(current, (s: { unitTypeId: string }) => s.unitTypeId);
  const tgt = nightMap<string>(target, (s: { unitTypeId: string }) => s.unitTypeId);
  const ops: InventoryOp[] = [];
  const removed = [...cur.keys()].filter((n) => !tgt.has(n));
  for (const r of toRanges(removed)) ops.push({ op: 'release', nights: r });
  const retyped = new Map<string, LocalDate[]>();
  for (const [n, t] of cur) {
    const to = tgt.get(n);
    if (to !== undefined && to !== t) {
      const key = `${t}→${to}`;
      retyped.set(key, [...(retyped.get(key) ?? []), n]);
    }
  }
  for (const [key, nights] of retyped) {
    const [fromType, toType] = key.split('→') as [string, string];
    for (const r of toRanges(nights)) {
      ops.push({
        op: 'change',
        from: { unitTypeId: fromType, nights: r },
        to: { unitTypeId: toType, nights: r },
      });
    }
  }
  const added = new Map<string, LocalDate[]>();
  for (const [n, t] of tgt) if (!cur.has(n)) added.set(t, [...(added.get(t) ?? []), n]);
  for (const [unitTypeId, nights] of added)
    for (const r of toRanges(nights)) ops.push({ op: 'consume', unitTypeId, nights: r });
  return ops;
}

/** New demand per (unit type, night) the target needs beyond what the stay already consumes. */
export function newDemand(
  current: ReadonlyArray<{ from: LocalDate; to: LocalDate; unitTypeId: string }>,
  target: ReadonlyArray<{ from: LocalDate; to: LocalDate; unitTypeId: string }>,
): Array<{ unitTypeId: string; date: LocalDate }> {
  const cur = nightMap<string>(current, (s: { unitTypeId: string }) => s.unitTypeId);
  const out: Array<{ unitTypeId: string; date: LocalDate }> = [];
  for (const s of target) {
    for (const n of eachNight({ from: s.from, to: s.to })) {
      if (cur.get(n) !== s.unitTypeId) out.push({ unitTypeId: s.unitTypeId, date: n });
    }
  }
  return out;
}

export type AssignmentOp =
  | { op: 'unassign'; nights: DateRange }
  | { op: 'assign'; unitId: string; nights: DateRange };

/** Assignment operations turning current unit assignments into target ones (unassign first, then assign). */
export function planAssignments(
  current: ReadonlyArray<{ from: LocalDate; to: LocalDate; unitId: string | null }>,
  target: ReadonlyArray<{ from: LocalDate; to: LocalDate; unitId: string | null }>,
): AssignmentOp[] {
  const cur = nightMap<string | null>(current, (s: { unitId: string | null }) => s.unitId);
  const tgt = nightMap<string | null>(target, (s: { unitId: string | null }) => s.unitId);
  const ops: AssignmentOp[] = [];
  const unassign: LocalDate[] = [];
  for (const [n, u] of cur) if (u !== null && tgt.get(n) !== u) unassign.push(n);
  for (const r of toRanges(unassign)) ops.push({ op: 'unassign', nights: r });
  const assign = new Map<string, LocalDate[]>();
  for (const [n, u] of tgt) if (u !== null && cur.get(n) !== u) assign.set(u, [...(assign.get(u) ?? []), n]);
  for (const [unitId, nights] of assign)
    for (const r of toRanges(nights)) ops.push({ op: 'assign', unitId, nights: r });
  return ops;
}

/** Nights of the target that have a unit assigned which the stay does not already hold. */
export function newAssignments(
  current: ReadonlyArray<{ from: LocalDate; to: LocalDate; unitId: string | null }>,
  target: ReadonlyArray<{ from: LocalDate; to: LocalDate; unitId: string | null }>,
): Array<{ unitId: string; nights: DateRange }> {
  return planAssignments(current, target)
    .filter((o): o is Extract<AssignmentOp, { op: 'assign' }> => o.op === 'assign')
    .map((o) => ({ unitId: o.unitId, nights: o.nights }));
}

/** Nights of the target whose unit type is known but no unit is assigned although one was before. */
export function unitForNight(
  segments: ReadonlyArray<{ from: LocalDate; to: LocalDate; unitId: string | null }>,
  night: LocalDate,
): string | null {
  return segments.find((s) => night >= s.from && night < s.to)?.unitId ?? null;
}
