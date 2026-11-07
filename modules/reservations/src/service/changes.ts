import { type PorticoDatabase, type TxContext, withTenantTx } from '@portico/db';
import {
  add,
  addDays,
  BusinessRuleError,
  canonicalJson,
  type DateRange,
  DomainError,
  diffDays,
  type EntityRef,
  eachNight,
  type LocalDate,
  type Money,
  NotFoundError,
  newId,
  type RequestContext,
  requirePermission,
  sha256Hex,
  subtract,
  sum,
  ValidationError,
  zero,
} from '@portico/kernel';
import type { Booking, ChangePreview, ChangeRequest } from '../contracts';
import { diffValues } from '../domain/diff';
import {
  type AssignmentOp,
  type InventoryOp,
  newAssignments,
  newDemand,
  normalizeTargets,
  planAssignments,
  planInventory,
  planStayChange,
  type StayChange,
  splitAt,
  type TargetSegment,
} from '../domain/segments';
import {
  assertStayTransition,
  type BookingStatus,
  bookingShouldComplete,
  type StayStatus,
} from '../domain/status';
import {
  addTotals,
  cancellationPenalty,
  nightlyGross,
  penaltyAmount,
  rangeTotals,
  requiredDeposit,
  zeroTotals,
} from '../domain/terms';
import { PreviewStaleError } from '../errors';
import { RESERVATIONS_EVENTS as E } from '../events';
import { RESERVATIONS_PERMISSIONS as P } from '../manifest';
import {
  type AvailabilityCell,
  assignmentConflicts,
  inventoryShortfall,
  type KeyOperationResult,
  type TermsSnapshot,
} from '../ports';
import { type ForwardedResult, guardAuthority } from './authority';
import {
  assertCommercialPermissions,
  createBookingInternal,
  insertStayWithInventory,
  type PricedStay,
  priceStay,
} from './bookings';
import {
  actorKey,
  actorName,
  type Deps,
  db,
  isModuleUnavailable,
  json,
  policy,
  propertyInfo,
} from './context';
import { emitReservationEvent } from './event-payload';
import { raiseIssue } from './issues';
import { keyOperation } from './keys';
import { bookingRecord } from './record';
import {
  type BookingRecord,
  bumpBooking,
  insertSnapshot,
  loadBooking,
  loadSnapshots,
  loadStay,
  lockBooking,
  occ,
  replaceSegments,
  type StayRecord,
  snapshotOf,
  updateStay,
} from './repo';

type StayEffect = ChangePreview['stays'][number];
type NightEffect = StayEffect['nights'][number];
type PreviewCore = Omit<ChangePreview, 'alternatives'>;

interface PricedTarget extends TargetSegment {
  terms: TermsSnapshot;
}

interface StayPlan {
  stay: StayRecord;
  mode: 'modify' | 'cancel' | 'time_request' | 'none';
  targets: PricedTarget[];
  arrival: LocalDate;
  departure: LocalDate;
  inventoryOps: InventoryOp[];
  assignmentOps: AssignmentOp[];
  newStatus: StayStatus | null;
  roomMove: {
    fromUnitId: string | null;
    toUnitId: string;
    fromDate: LocalDate;
    reason: string;
    chargeable: boolean;
  } | null;
  timeRequest: { kind: 'early_check_in' | 'late_check_out'; time: string; fee: Money | null } | null;
}

interface Charge {
  stayId: string | null;
  kind: string;
  chargeCode: string;
  amount: Money;
  description: string;
  serviceDate: LocalDate;
  idempotencyKey: string;
  waived: boolean;
}

interface Plan {
  request: ChangeRequest;
  propertyId: string;
  booking: BookingRecord | null;
  currency: string;
  stayPlans: StayPlan[];
  newStays: PricedStay[];
  bookingStatusAfter: BookingStatus | null;
  charges: Charge[];
  view: Omit<PreviewCore, 'token' | 'expiresAt' | 'fingerprint'>;
  alternatives: Array<{ id: string; label: string; description: string; request: ChangeRequest }>;
}

interface Ctx {
  deps: Deps;
  tx: TxContext;
  propertyId: string;
  timezone: string;
  businessDate: LocalDate;
  currency: string;
}

// ───────────────────────────── helpers ─────────────────────────────

const ref = (stayId: string): EntityRef => ({ type: 'stay', id: stayId });
const consumes = (status: string) => status === 'tentative' || status === 'confirmed';

function nightNet(
  targets: ReadonlyArray<{ from: LocalDate; to: LocalDate; terms: TermsSnapshot }>,
  date: LocalDate,
) {
  const t = targets.find((x) => date >= x.from && date < x.to);
  return t?.terms.nights.find((n) => n.date === date)?.net ?? null;
}

function totalsOf(
  currency: string,
  targets: ReadonlyArray<{ from: LocalDate; to: LocalDate; terms: TermsSnapshot }>,
) {
  return targets.length
    ? addTotals(
        currency,
        targets.map((t) => rangeTotals(t.terms, { from: t.from, to: t.to })),
      )
    : zeroTotals(currency);
}

function inclusionNames(targets: ReadonlyArray<{ terms: TermsSnapshot }>): string[] {
  return [...new Set(targets.flatMap((t) => t.terms.inclusions.map((i) => i.name)))].sort();
}

function depositFor(
  currency: string,
  targets: ReadonlyArray<{ from: LocalDate; to: LocalDate; terms: TermsSnapshot }>,
): Money {
  const first = targets[0];
  if (!first) return zero(currency);
  const totals = totalsOf(currency, targets);
  const gross = targets.flatMap((t) => nightlyGross(t.terms, { from: t.from, to: t.to }));
  return requiredDeposit(first.terms.policies.deposit.items, totals, gross);
}

/** Agreed charges not yet posted by Day Close: every night for expected stays, from the business date in house. */
function unpostedGross(
  currency: string,
  targets: ReadonlyArray<{ from: LocalDate; to: LocalDate; terms: TermsSnapshot }>,
  fromDate: LocalDate,
): Money {
  return sum(
    currency,
    targets.flatMap((t) => {
      const from = t.from > fromDate ? t.from : fromDate;
      return from < t.to ? nightlyGross(t.terms, { from, to: t.to }) : [];
    }),
  );
}

async function currentTargets(tx: TxContext, stay: StayRecord): Promise<PricedTarget[]> {
  const snaps = await loadSnapshots(
    tx,
    stay.segments.map((s) => s.termsSnapshotId),
  );
  return stay.segments.map((s) => ({
    from: s.from,
    to: s.to,
    unitTypeId: s.unitTypeId,
    ratePlanId: s.ratePlanId,
    occupancy: s.occupancy,
    unitId: s.unitId,
    pricing: { kind: 'keep', termsSnapshotId: s.termsSnapshotId },
    terms: snapshotOf(snaps, s.termsSnapshotId),
  }));
}

async function availabilityFor(
  c: Ctx,
  demand: ReadonlyArray<{ unitTypeId: string; date: LocalDate }>,
): Promise<Map<string, AvailabilityCell>> {
  const out = new Map<string, AvailabilityCell>();
  if (demand.length === 0) return out;
  const dates = demand.map((d) => d.date).sort();
  const range = { from: dates[0] as string, to: addDays(dates[dates.length - 1] as string, 1) };
  const cells = await c.deps.ports.inventory.getAvailability(c.tx, {
    propertyId: c.propertyId,
    unitTypeIds: [...new Set(demand.map((d) => d.unitTypeId))],
    range,
  });
  for (const cell of cells) out.set(`${cell.unitTypeId}|${cell.date}`, cell);
  return out;
}

function whyShort(cell: AvailabilityCell | undefined): string {
  if (!cell) return 'No inventory is configured for this unit type and night.';
  return `Sold out: capacity ${cell.capacity}, out of order ${cell.outOfOrder}, sold ${cell.sold}, held ${cell.held}, authorized overbooking ${cell.overbookingAllowance}.`;
}

/** Per-night effects (before/after price, availability for new demand). */
function nightEffects(
  before: PricedTarget[],
  after: PricedTarget[],
  cells: Map<string, AvailabilityCell>,
  demandCount: Map<string, number>,
): NightEffect[] {
  const dates = new Set<LocalDate>();
  for (const t of [...before, ...after]) for (const d of eachNight({ from: t.from, to: t.to })) dates.add(d);
  return [...dates].sort().map((date) => {
    const b = before.find((t) => date >= t.from && date < t.to);
    const a = after.find((t) => date >= t.from && date < t.to);
    const bNet = nightNet(before, date);
    const aNet = nightNet(after, date);
    const key = a ? `${a.unitTypeId}|${date}` : '';
    const needed = demandCount.get(key) ?? 0;
    const cell = cells.get(key);
    const availability =
      a && needed > 0
        ? {
            available: cell?.available ?? 0,
            sufficient: (cell?.available ?? 0) >= needed,
            ...((cell?.available ?? 0) >= needed ? {} : { why: whyShort(cell) }),
          }
        : null;
    const status: NightEffect['status'] = !b
      ? 'added'
      : !a
        ? 'removed'
        : b.unitTypeId !== a.unitTypeId
          ? 'retyped'
          : bNet && aNet && bNet.amountMinor !== aNet.amountMinor
            ? 'repriced'
            : 'kept';
    return {
      date,
      unitTypeId: a?.unitTypeId ?? b?.unitTypeId ?? null,
      before: bNet,
      after: aNet,
      status,
      availability,
    };
  });
}

function stayLabel(stay: StayRecord | null, index: number): string {
  if (!stay) return `New stay ${index + 1}`;
  const primary = stay.occupants.find((o) => o.is_primary)?.name;
  return primary ? `Stay of ${primary}` : `Stay ${index + 1}`;
}

function shape(arrival: LocalDate, departure: LocalDate, seg?: PricedTarget) {
  if (!seg) return null;
  return {
    arrival,
    departure,
    unitTypeId: seg.unitTypeId,
    ratePlanId: seg.ratePlanId,
    occupancy: occ(seg.occupancy),
    unitId: seg.unitId,
  };
}

// ───────────────────────────── planning ─────────────────────────────

async function context(deps: Deps, tx: TxContext, propertyId: string, currency?: string): Promise<Ctx> {
  const p = await propertyInfo(deps, tx, propertyId);
  return {
    deps,
    tx,
    propertyId,
    timezone: p.timezone,
    businessDate: p.businessDate,
    currency: currency ?? p.baseCurrency,
  };
}

function assertPermission(tx: TxContext, propertyId: string, request: ChangeRequest): void {
  switch (request.kind) {
    case 'new_booking':
      requirePermission(tx, P.bookingCreate, { propertyId });
      assertCommercialPermissions(tx, propertyId, request.booking.stays);
      if (request.booking.overbooking) requirePermission(tx, P.bookingOverbook, { propertyId });
      return;
    case 'move':
      requirePermission(tx, P.stayMove, { propertyId });
      return;
    case 'cancel_stay':
    case 'cancel_booking':
      requirePermission(tx, P.bookingCancel, { propertyId });
      if (request.waive) requirePermission(tx, P.bookingWaivePenalty, { propertyId });
      return;
    case 'add_stay':
      requirePermission(tx, P.bookingUpdate, { propertyId });
      assertCommercialPermissions(tx, propertyId, [request.stay]);
      return;
    case 'waitlist_extension':
      requirePermission(tx, P.waitlistManage, { propertyId });
      return;
    default:
      requirePermission(tx, P.bookingUpdate, { propertyId });
  }
}

async function resolveTarget(_deps: Deps, tx: TxContext, request: ChangeRequest) {
  if (request.kind === 'new_booking')
    return { propertyId: request.booking.propertyId, booking: null, stayId: null };
  if (request.kind === 'add_stay' || request.kind === 'cancel_booking') {
    const booking = await loadBooking(tx, request.bookingId);
    return { propertyId: booking.row.property_id, booking, stayId: null };
  }
  const stay = await loadStay(tx, request.stayId);
  const booking = await loadBooking(tx, stay.row.booking_id);
  return { propertyId: booking.row.property_id, booking, stayId: stay.row.id };
}

function emptyPlan(stay: StayRecord, targets: PricedTarget[]): StayPlan {
  return {
    stay,
    mode: 'none',
    targets,
    arrival: stay.row.arrival,
    departure: stay.row.departure,
    inventoryOps: [],
    assignmentOps: [],
    newStatus: null,
    roomMove: null,
    timeRequest: null,
  };
}

/** Penalty for nights removed from a stay: cancellation tiers before arrival, early departure once in house. */
function removalPenalty(
  c: Ctx,
  stay: StayRecord,
  before: PricedTarget[],
  removed: LocalDate[],
  waived: boolean,
): Charge | null {
  if (removed.length === 0 || stay.row.commercial_type !== 'standard') return null;
  const first = before[0];
  if (!first) return null;
  const nets = removed
    .sort()
    .map((d) => nightNet(before, d))
    .filter((m): m is Money => m !== null);
  const inHouse = stay.row.status === 'in_house';
  const policyDoc = first.terms.policies.cancellation;
  const amount = inHouse
    ? penaltyAmount(policyDoc.earlyDeparture ?? { kind: 'none' }, nets, c.currency)
    : cancellationPenalty({
        policy: policyDoc,
        arrival: stay.row.arrival,
        timeZone: c.timezone,
        at: c.tx.now,
        nightlyNet: nets,
        currency: c.currency,
      }).amount;
  if (amount.amountMinor === 0) return null;
  const kind = inHouse ? 'early_departure' : 'partial_cancellation';
  return {
    stayId: stay.row.id,
    kind,
    chargeCode: inHouse ? 'EARLY_DEPARTURE' : 'CANCEL_FEE',
    amount,
    description: inHouse
      ? `Early departure charge per agreed terms (${removed.length} night${removed.length === 1 ? '' : 's'} released)`
      : `Charge for cancelling ${removed.length} night${removed.length === 1 ? '' : 's'} per agreed cancellation terms`,
    serviceDate: c.businessDate,
    idempotencyKey: `penalty:${kind}:${stay.row.id}:${removed.sort()[0]}`,
    waived,
  };
}

async function planModification(
  c: Ctx,
  booking: BookingRecord,
  stay: StayRecord,
  request: Extract<ChangeRequest, { kind: 'dates' | 'unit_type' | 'rate_plan' | 'occupancy' | 'move' }>,
): Promise<{ plan: StayPlan; charges: Charge[]; warnings: string[] }> {
  const { deps, tx } = c;
  if (!['expected', 'in_house'].includes(stay.row.status)) {
    throw new BusinessRuleError(
      'stay_not_changeable',
      `This stay is ${stay.row.status.replace('_', ' ')}; only expected or in-house stays can be changed.`,
    );
  }
  if (!['quoted', 'tentative', 'confirmed'].includes(booking.row.status)) {
    throw new BusinessRuleError(
      'booking_not_changeable',
      booking.row.status === 'held'
        ? 'This booking is on a temporary hold. Confirm it (or let the hold go) before changing it.'
        : `A ${booking.row.status} booking cannot be changed.`,
    );
  }
  const inHouse = stay.row.status === 'in_house';
  const defaultFrom = inHouse && c.businessDate > stay.row.arrival ? c.businessDate : stay.row.arrival;
  const typeChangePolicy = await policy<'keep_agreed' | 'difference' | 'reprice'>(
    deps,
    tx,
    c.propertyId,
    'reservations.repricing.typeChange',
    'difference',
  );
  let change: StayChange;
  let roomMove: StayPlan['roomMove'] = null;
  switch (request.kind) {
    case 'dates':
      change = {
        kind: 'dates',
        arrival: request.arrival,
        departure: request.departure,
        ...(request.extraNights
          ? {
              extraNights:
                request.extraNights.strategy === 'move_whole_stay'
                  ? { strategy: 'move_whole_stay', unitId: request.extraNights.unitId }
                  : request.extraNights,
            }
          : {}),
      };
      break;
    case 'unit_type':
      change = {
        kind: 'unit_type',
        unitTypeId: request.unitTypeId,
        fromDate: request.fromDate ?? defaultFrom,
        ...(request.ratePlanId ? { ratePlanId: request.ratePlanId } : {}),
        unitId: request.unitId ?? null,
        typeChange: request.typeChange ?? typeChangePolicy,
      };
      break;
    case 'rate_plan':
      change = {
        kind: 'rate_plan',
        ratePlanId: request.ratePlanId,
        fromDate: request.fromDate ?? defaultFrom,
      };
      break;
    case 'occupancy':
      change = { kind: 'occupancy', occupancy: request.occupancy, fromDate: request.fromDate ?? defaultFrom };
      break;
    case 'move': {
      const unit = await deps.ports.inventory.getUnit(tx, request.unitId);
      const fromDate = request.fromDate ?? defaultFrom;
      change = {
        kind: 'move',
        unitId: unit.id,
        unitTypeId: unit.unitTypeId,
        fromDate,
        typeChange: request.chargeable ? typeChangePolicy : 'keep_agreed',
      };
      const fromUnit = stay.segments.find((s) => fromDate >= s.from && fromDate < s.to)?.unitId ?? null;
      roomMove = {
        fromUnitId: fromUnit,
        toUnitId: unit.id,
        fromDate,
        reason: request.reason,
        chargeable: request.chargeable,
      };
      break;
    }
  }
  let targets = planStayChange(stay.segments, stay.row, change, { inHouse, businessDate: c.businessDate });
  // move_whole_stay for an in-house stay can only move the nights from the business date on.
  if (request.kind === 'dates' && request.extraNights?.strategy === 'move_whole_stay' && inHouse) {
    const unitId = request.extraNights.unitId;
    targets = normalizeTargets(
      splitAt(targets, defaultFrom).map((t) =>
        t.from < defaultFrom
          ? { ...t, unitId: stay.segments.find((s) => t.from >= s.from && t.from < s.to)?.unitId ?? t.unitId }
          : { ...t, unitId },
      ),
    );
  }
  const before = await currentTargets(tx, stay);
  const priced: PricedTarget[] = [];
  for (const t of targets) {
    if (t.pricing.kind === 'keep') {
      const snap = before.find(
        (b) =>
          b.pricing.kind === 'keep' &&
          b.pricing.termsSnapshotId === (t.pricing as { termsSnapshotId: string }).termsSnapshotId,
      );
      if (!snap) throw new NotFoundError('terms_snapshot', t.pricing.termsSnapshotId);
      priced.push({ ...t, terms: snap.terms });
      continue;
    }
    const base = before.find(
      (b) =>
        b.pricing.kind === 'keep' &&
        b.pricing.termsSnapshotId === (t.pricing as { baseTermsSnapshotId: string }).baseTermsSnapshotId,
    );
    if (!base) throw new NotFoundError('terms_snapshot', t.pricing.baseTermsSnapshotId);
    const repriced = await deps.ports.rates.priceChange(tx, {
      terms: base.terms,
      change: {
        nights: { from: t.from, to: t.to },
        unitTypeId: t.unitTypeId,
        ratePlanId: t.ratePlanId,
        occupancy: t.occupancy,
        ...(t.pricing.typeChange ? { typeChange: t.pricing.typeChange } : {}),
        asOf: c.businessDate,
      },
    });
    priced.push({ ...t, terms: repriced.terms });
  }
  const arrival = priced[0]?.from ?? stay.row.arrival;
  const departure = priced[priced.length - 1]?.to ?? stay.row.departure;
  const charges: Charge[] = [];
  const warnings: string[] = [];
  const removed = eachNight({ from: stay.row.arrival, to: stay.row.departure }).filter(
    (d) => d < arrival || d >= departure,
  );
  const penalty = removalPenalty(c, stay, before, removed, false);
  if (penalty) charges.push(penalty);
  if (roomMove && roomMove.fromUnitId === roomMove.toUnitId) {
    throw new ValidationError('same_unit', 'The stay is already in this unit for these nights.');
  }
  return {
    plan: {
      stay,
      mode: 'modify',
      targets: priced,
      arrival,
      departure,
      inventoryOps: consumes(booking.row.status) ? planInventory(stay.segments, priced) : [],
      assignmentOps: planAssignments(stay.segments, priced),
      newStatus: null,
      roomMove,
      timeRequest: null,
    },
    charges,
    warnings,
  };
}

async function planTimeRequest(
  c: Ctx,
  booking: BookingRecord,
  stay: StayRecord,
  request: Extract<ChangeRequest, { kind: 'early_check_in' | 'late_check_out' }>,
): Promise<{ plan: StayPlan; charges: Charge[]; warnings: string[] }> {
  const { deps, tx } = c;
  if (!['expected', 'in_house'].includes(stay.row.status)) {
    throw new BusinessRuleError('stay_not_changeable', `A ${stay.row.status} stay cannot request this.`);
  }
  const before = await currentTargets(tx, stay);
  const early = request.kind === 'early_check_in';
  const feePolicy = await policy<{ amountMinor: number } | null>(
    deps,
    tx,
    c.propertyId,
    early ? 'reservations.earlyCheckIn.fee' : 'reservations.lateCheckOut.fee',
    null,
  );
  const fee =
    feePolicy && feePolicy.amountMinor > 0
      ? { amountMinor: feePolicy.amountMinor, currency: c.currency }
      : null;
  const warnings: string[] = [];
  const unitNight = early ? stay.row.arrival : addDays(stay.row.departure, -1);
  const unitId = stay.segments.find((s) => unitNight >= s.from && unitNight < s.to)?.unitId ?? null;
  const seg = stay.segments.find((s) => unitNight >= s.from && unitNight < s.to);
  if (!unitId || !seg) {
    warnings.push('No unit is assigned yet: approval depends on which unit is assigned later.');
  } else {
    const probe = early
      ? { from: addDays(stay.row.arrival, -1), to: stay.row.arrival }
      : { from: stay.row.departure, to: addDays(stay.row.departure, 1) };
    const candidates = await deps.ports.inventory.findAssignableUnits(tx, {
      propertyId: c.propertyId,
      unitTypeId: seg.unitTypeId,
      nights: probe,
    });
    const mine = candidates.find((u) => u.unitId === unitId);
    if (mine && !mine.assignable) {
      warnings.push(
        early
          ? `The unit is occupied the night before arrival (${mine.reason ?? 'another stay'}); early check-in depends on that departure and cleaning.`
          : `Another stay is assigned to this unit from ${stay.row.departure} (${mine.reason ?? 'next arrival'}); a late check-out shortens its preparation time.`,
      );
    }
  }
  const charges: Charge[] = fee
    ? [
        {
          stayId: stay.row.id,
          kind: request.kind,
          chargeCode: early ? 'EARLY_CHECK_IN' : 'LATE_CHECK_OUT',
          amount: fee,
          description: `${early ? 'Early check-in' : 'Late check-out'} at ${request.time}`,
          serviceDate: early ? stay.row.arrival : stay.row.departure,
          idempotencyKey: `fee:${stay.row.id}:${request.kind}`,
          waived: false,
        },
      ]
    : [];
  void booking;
  return {
    plan: {
      ...emptyPlan(stay, before),
      mode: 'time_request',
      timeRequest: { kind: request.kind, time: request.time, fee },
    },
    charges,
    warnings,
  };
}

async function planCancellation(
  c: Ctx,
  booking: BookingRecord,
  stays: StayRecord[],
  waive: { reason: string } | undefined,
): Promise<{ plans: StayPlan[]; charges: Charge[] }> {
  const plans: StayPlan[] = [];
  const charges: Charge[] = [];
  for (const stay of stays) {
    const before = await currentTargets(c.tx, stay);
    if (stay.row.status === 'in_house') {
      throw new BusinessRuleError(
        'stay_in_house',
        'A guest who is in house cannot be cancelled. Shorten the stay or check the guest out instead.',
        { stayId: stay.row.id },
      );
    }
    if (!['expected', 'waitlisted'].includes(stay.row.status)) {
      plans.push(emptyPlan(stay, before));
      continue;
    }
    assertStayTransition(stay.row.status as StayStatus, 'cancelled');
    if (
      stay.row.status === 'expected' &&
      consumes(booking.row.status) &&
      stay.row.commercial_type === 'standard'
    ) {
      const first = before[0];
      if (first) {
        const nets = eachNight({ from: stay.row.arrival, to: stay.row.departure })
          .map((d) => nightNet(before, d))
          .filter((m): m is Money => m !== null);
        const outcome = cancellationPenalty({
          policy: first.terms.policies.cancellation,
          arrival: stay.row.arrival,
          timeZone: c.timezone,
          at: c.tx.now,
          nightlyNet: nets,
          currency: c.currency,
        });
        if (outcome.amount.amountMinor > 0) {
          charges.push({
            stayId: stay.row.id,
            kind: 'cancellation',
            chargeCode: 'CANCEL_FEE',
            amount: outcome.amount,
            description: outcome.description,
            serviceDate: c.businessDate,
            idempotencyKey: `penalty:cancellation:${stay.row.id}`,
            waived: waive !== undefined,
          });
        }
      }
    }
    plans.push({
      ...emptyPlan(stay, []),
      mode: 'cancel',
      targets: [],
      inventoryOps:
        stay.row.status === 'expected'
          ? [{ op: 'release', nights: { from: stay.row.arrival, to: stay.row.departure } }]
          : [],
      assignmentOps: stay.segments.some((s) => s.unitId)
        ? [{ op: 'unassign', nights: { from: stay.row.arrival, to: stay.row.departure } }]
        : [],
      newStatus: 'cancelled',
    });
  }
  return { plans, charges };
}

async function stayEffect(
  c: Ctx,
  sp: StayPlan,
  index: number,
  cells: Map<string, AvailabilityCell>,
  demand: Map<string, number>,
  blockers: Array<{ code: string; message: string }>,
): Promise<StayEffect> {
  const { deps, tx } = c;
  const stay = sp.stay;
  const before = await currentTargets(tx, stay);
  const after = sp.mode === 'cancel' ? [] : sp.targets;
  const nights = nightEffects(before, after, cells, demand);
  for (const n of nights) {
    if (n.availability && !n.availability.sufficient) {
      blockers.push({ code: 'unavailable', message: `${n.date}: ${n.availability.why ?? 'not available'}` });
    }
  }
  // Assignment effects: are the units the target needs actually free?
  let assignment: StayEffect['assignment'] = {
    status: before.some((b) => b.unitId) ? 'unchanged' : 'none',
    unitId: before.find((b) => b.unitId)?.unitId ?? null,
    message: before.some((b) => b.unitId) ? 'Unit assignment unchanged.' : 'No unit assigned yet.',
    conflictingRefs: [],
  };
  if (sp.mode === 'cancel') {
    assignment = before.some((b) => b.unitId)
      ? { status: 'released', unitId: null, message: 'The assigned unit is released.', conflictingRefs: [] }
      : assignment;
  } else if (sp.mode === 'modify') {
    const wanted = newAssignments(stay.segments, after);
    for (const w of wanted) {
      const seg = after.find((t) => w.nights.from >= t.from && w.nights.from < t.to);
      if (!seg) continue;
      const candidates = await deps.ports.inventory.findAssignableUnits(tx, {
        propertyId: c.propertyId,
        unitTypeId: seg.unitTypeId,
        nights: w.nights,
      });
      const cand = candidates.find((u) => u.unitId === w.unitId);
      const conflicts = (cand?.conflictingRefs ?? []).filter(
        (r) => !(r.type === 'stay' && r.id === stay.row.id),
      );
      if (!cand?.assignable) {
        assignment = {
          status: 'conflict',
          unitId: w.unitId,
          message: `${cand?.name ?? 'The unit'} is not free ${w.nights.from} to ${w.nights.to}: ${cand?.reason ?? 'unavailable'}.`,
          conflictingRefs: conflicts,
        };
        blockers.push({ code: 'assigned_unit_taken', message: assignment.message });
        break;
      }
      assignment = {
        status: sp.roomMove || before.some((b) => b.unitId && b.unitId !== w.unitId) ? 'moved' : 'kept',
        unitId: w.unitId,
        message: `${cand.name} is free for ${w.nights.from} to ${w.nights.to}.`,
        conflictingRefs: [],
      };
    }
    if (wanted.length === 0) {
      const releases = sp.assignmentOps.filter((o) => o.op === 'unassign');
      if (releases.length && !after.some((t) => t.unitId)) {
        assignment = {
          status: 'needs_assignment',
          unitId: null,
          message: 'The new unit type needs a unit to be assigned before arrival.',
          conflictingRefs: [],
        };
      }
    }
    // Occupancy must fit the unit type.
    const types = await deps.ports.inventory.listUnitTypes(tx, { propertyId: c.propertyId });
    for (const t of after) {
      const type = types.find((x) => x.id === t.unitTypeId);
      const guests = t.occupancy.adults + t.occupancy.childrenAges.length;
      if (type && guests > type.maxOccupancy) {
        blockers.push({
          code: 'occupancy_exceeds_unit_type',
          message: `${type.name} sleeps at most ${type.maxOccupancy}; this stay has ${guests} guests.`,
        });
      }
    }
  }
  const lastBefore = before[0];
  const firstAfter = after[0];
  return {
    stayId: stay.row.id,
    label: stayLabel(stay, index),
    before: shape(stay.row.arrival, stay.row.departure, lastBefore),
    after: sp.mode === 'cancel' ? null : shape(sp.arrival, sp.departure, firstAfter),
    nights,
    totals: { before: totalsOf(c.currency, before), after: totalsOf(c.currency, after) },
    inclusions: { before: inclusionNames(before), after: inclusionNames(after) },
    assignment,
  };
}

async function folioBalances(
  c: Ctx,
  stays: StayRecord[],
): Promise<{ balance: Money; held: Money | null; note: string | null }> {
  const { finance } = c.deps.ports;
  try {
    const balances: Money[] = [];
    for (const s of stays) {
      const folios = await finance.listFolios(c.tx, { owner: ref(s.row.id) });
      for (const f of folios) balances.push(f.balance);
    }
    const bookingId = stays[0]?.row.booking_id;
    const held = bookingId ? await finance.getDepositBalance(c.tx, { bookingId }) : null;
    return { balance: sum(c.currency, balances), held, note: null };
  } catch (err) {
    if (!isModuleUnavailable(err)) throw err;
    return {
      balance: zero(c.currency),
      held: null,
      note: 'Finance is not available: posted charges and deposits are not included.',
    };
  }
}

/** Build the full plan + preview view for a request (pure reads; no writes). */
async function buildPlan(
  deps: Deps,
  tx: TxContext,
  request: ChangeRequest,
  opts: { trusted?: boolean } = {},
): Promise<Plan> {
  const target = await resolveTarget(deps, tx, request);
  if (!opts.trusted) assertPermission(tx, target.propertyId, request);
  const c = await context(deps, tx, target.propertyId, target.booking?.row.currency);
  const blockers: Array<{ code: string; message: string }> = [];
  const warnings: string[] = [];
  const stayPlans: StayPlan[] = [];
  let charges: Charge[] = [];
  let newStays: PricedStay[] = [];
  let bookingStatusAfter: BookingStatus | null = null;
  const booking = target.booking;

  switch (request.kind) {
    case 'new_booking': {
      const input = request.booking;
      newStays = [];
      for (const stay of input.stays) {
        newStays.push(
          await priceStay(deps, tx, {
            propertyId: input.propertyId,
            stay,
            companyId: input.companyId,
            bookingDate: c.businessDate,
          }),
        );
      }
      c.currency = newStays[0]?.terms.currency ?? c.currency;
      break;
    }
    case 'add_stay': {
      if (!booking) throw new NotFoundError('booking', request.bookingId);
      if (!['quoted', 'tentative', 'confirmed'].includes(booking.row.status)) {
        throw new BusinessRuleError(
          'booking_not_changeable',
          `A ${booking.row.status} booking cannot get new stays.`,
        );
      }
      newStays = [
        await priceStay(deps, tx, {
          propertyId: c.propertyId,
          stay: request.stay,
          companyId: booking.row.company_id ?? undefined,
          bookingDate: c.businessDate,
        }),
      ];
      break;
    }
    case 'cancel_booking': {
      if (!booking) throw new NotFoundError('booking', request.bookingId);
      const res = await planCancellation(c, booking, booking.stays, request.waive);
      stayPlans.push(...res.plans);
      charges = res.charges;
      bookingStatusAfter = ['inquiry', 'quoted'].includes(booking.row.status) ? 'declined' : 'cancelled';
      break;
    }
    case 'cancel_stay': {
      if (!booking) throw new NotFoundError('booking', 'unknown');
      const stay = booking.stays.find((s) => s.row.id === request.stayId) as StayRecord;
      const res = await planCancellation(c, booking, [stay], request.waive);
      stayPlans.push(...res.plans);
      charges = res.charges;
      const othersActive = booking.stays.some(
        (s) => s.row.id !== stay.row.id && ['expected', 'in_house', 'waitlisted'].includes(s.row.status),
      );
      if (!othersActive)
        bookingStatusAfter = ['inquiry', 'quoted'].includes(booking.row.status) ? 'declined' : 'cancelled';
      break;
    }
    case 'early_check_in':
    case 'late_check_out': {
      if (!booking) throw new NotFoundError('booking', 'unknown');
      const stay = booking.stays.find((s) => s.row.id === request.stayId) as StayRecord;
      const res = await planTimeRequest(c, booking, stay, request);
      stayPlans.push(res.plan);
      charges = res.charges;
      warnings.push(...res.warnings);
      break;
    }
    case 'waitlist_extension': {
      if (!booking) throw new NotFoundError('booking', 'unknown');
      const stay = booking.stays.find((s) => s.row.id === request.stayId) as StayRecord;
      if (request.departure <= stay.row.departure) {
        throw new ValidationError(
          'not_an_extension',
          'The requested departure must be later than the current one.',
        );
      }
      stayPlans.push(emptyPlan(stay, await currentTargets(tx, stay)));
      warnings.push(
        `The extension to ${request.departure} is put on the waitlist; nothing changes now. The owner is told when it becomes available.`,
      );
      break;
    }
    default: {
      if (!booking) throw new NotFoundError('booking', 'unknown');
      const stay = booking.stays.find((s) => s.row.id === request.stayId) as StayRecord;
      const res = await planModification(c, booking, stay, request);
      stayPlans.push(res.plan);
      charges = res.charges;
      warnings.push(...res.warnings);
    }
  }

  // Availability for every (unit type, night) the change newly needs.
  const demandList: Array<{ unitTypeId: string; date: LocalDate }> = [];
  for (const sp of stayPlans)
    if (sp.mode === 'modify' && sp.inventoryOps.length)
      demandList.push(...newDemand(sp.stay.segments, sp.targets));
  const newStaysConsume =
    request.kind === 'new_booking'
      ? ['tentative', 'confirm', 'hold'].includes(request.booking.intent)
      : booking !== null && (consumes(booking.row.status) || booking.row.status === 'held');
  for (const ns of newStays) {
    if (ns.input.waitlist || !newStaysConsume) continue;
    for (const d of eachNight({ from: ns.input.arrival, to: ns.input.departure }))
      demandList.push({ unitTypeId: ns.input.unitTypeId, date: d });
  }
  const cells = await availabilityFor(c, demandList);
  const demandCount = new Map<string, number>();
  for (const d of demandList)
    demandCount.set(`${d.unitTypeId}|${d.date}`, (demandCount.get(`${d.unitTypeId}|${d.date}`) ?? 0) + 1);

  const effects: StayEffect[] = [];
  for (const [i, sp] of stayPlans.entries())
    effects.push(await stayEffect(c, sp, i, cells, demandCount, blockers));
  for (const [i, ns] of newStays.entries()) {
    const after: PricedTarget[] = [
      {
        from: ns.input.arrival,
        to: ns.input.departure,
        unitTypeId: ns.input.unitTypeId,
        ratePlanId: ns.input.ratePlanId,
        occupancy: ns.input.occupancy,
        unitId: ns.input.unitId ?? null,
        pricing: { kind: 'keep', termsSnapshotId: 'new' },
        terms: ns.terms,
      },
    ];
    const nights = nightEffects(
      [],
      after,
      cells,
      newStaysConsume && !ns.input.waitlist ? demandCount : new Map(),
    );
    const overbook = request.kind === 'new_booking' && request.booking.overbooking;
    for (const n of nights) {
      if (n.availability && !n.availability.sufficient) {
        if (overbook) warnings.push(`${n.date}: sold beyond availability as authorized overbooking.`);
        else
          blockers.push({
            code: 'unavailable',
            message: `${n.date}: ${n.availability.why ?? 'not available'}`,
          });
      }
    }
    effects.push({
      stayId: null,
      label: stayLabel(null, i),
      before: null,
      after: {
        arrival: ns.input.arrival,
        departure: ns.input.departure,
        unitTypeId: ns.input.unitTypeId,
        ratePlanId: ns.input.ratePlanId,
        occupancy: ns.input.occupancy,
        unitId: ns.input.unitId ?? null,
      },
      nights,
      totals: { before: zeroTotals(c.currency), after: totalsOf(c.currency, after) },
      inclusions: { before: [], after: inclusionNames(after) },
      assignment: {
        status: ns.input.unitId ? 'kept' : 'none',
        unitId: ns.input.unitId ?? null,
        message: ns.input.unitId ? 'Unit requested.' : 'No unit assigned yet.',
        conflictingRefs: [],
      },
    });
  }

  // Money: totals, taxes, deposits, projected balance — per stay, then summed.
  const perStay: Array<{ before: PricedTarget[]; after: PricedTarget[]; unpostedFrom: LocalDate }> = [];
  const counted = (st: string) => ['expected', 'in_house', 'departed'].includes(st);
  const unpostedFrom = (s: StayRecord) =>
    s.row.status === 'in_house' && c.businessDate > s.row.arrival
      ? c.businessDate
      : s.row.status === 'departed'
        ? s.row.departure
        : s.row.arrival;
  for (const s of booking ? booking.stays : []) {
    const cur = await currentTargets(tx, s);
    const sp = stayPlans.find((p) => p.stay.row.id === s.row.id);
    const after = !counted(s.row.status)
      ? []
      : !sp
        ? cur
        : sp.mode === 'modify'
          ? sp.targets
          : sp.mode === 'cancel'
            ? []
            : cur;
    perStay.push({ before: counted(s.row.status) ? cur : [], after, unpostedFrom: unpostedFrom(s) });
  }
  for (const ns of newStays) {
    if (ns.input.waitlist) continue;
    perStay.push({
      before: [],
      after: [
        {
          from: ns.input.arrival,
          to: ns.input.departure,
          unitTypeId: ns.input.unitTypeId,
          ratePlanId: ns.input.ratePlanId,
          occupancy: ns.input.occupancy,
          unitId: null,
          pricing: { kind: 'keep', termsSnapshotId: 'new' },
          terms: ns.terms,
        },
      ],
      unpostedFrom: ns.input.arrival,
    });
  }
  const before = totalsOf(
    c.currency,
    perStay.flatMap((p) => p.before),
  );
  const after = totalsOf(
    c.currency,
    perStay.flatMap((p) => p.after),
  );
  const chargeTotal = sum(
    c.currency,
    charges.filter((ch) => !ch.waived).map((ch) => ch.amount),
  );
  const fin = booking
    ? await folioBalances(c, booking.stays)
    : { balance: zero(c.currency), held: null, note: null };
  if (fin.note) warnings.push(fin.note);
  const held = fin.held;
  const heldAmount = held ?? zero(c.currency);
  const requiredBefore = sum(
    c.currency,
    perStay.map((p) => depositFor(c.currency, p.before)),
  );
  const requiredAfter = sum(
    c.currency,
    perStay.map((p) => depositFor(c.currency, p.after)),
  );
  const additionalDue =
    requiredAfter.amountMinor > heldAmount.amountMinor
      ? subtract(requiredAfter, heldAmount)
      : zero(c.currency);
  const unpostedBefore = sum(
    c.currency,
    perStay.map((p) => unpostedGross(c.currency, p.before, p.unpostedFrom)),
  );
  const unpostedAfter = sum(
    c.currency,
    perStay.map((p) => unpostedGross(c.currency, p.after, p.unpostedFrom)),
  );
  const projectedBefore = subtract(add(fin.balance, unpostedBefore), heldAmount);
  const projectedAfter = subtract(add(fin.balance, unpostedAfter, chargeTotal), heldAmount);

  // Alternatives (S03): when an extension hits a taken unit, offer fully previewed alternatives.
  const alternatives =
    request.kind === 'dates' && blockers.some((b) => b.code === 'assigned_unit_taken') && booking
      ? await extensionAlternatives(c, booking, request)
      : request.kind === 'new_booking' && blockers.some((b) => b.code === 'unavailable')
        ? await newBookingAlternatives(c, request)
        : [];

  const feasible = blockers.length === 0;
  const view: Plan['view'] = {
    kind: request.kind,
    bookingId: booking?.row.id ?? null,
    bookingVersion: booking?.row.version ?? null,
    currency: c.currency,
    feasible,
    blockers: dedupeBlockers(blockers),
    warnings,
    stays: effects,
    totals: { before: before.gross, after: after.gross, difference: subtract(after.gross, before.gross) },
    taxes: { before: add(before.taxes, before.fees), after: add(after.taxes, after.fees) },
    penalties: charges
      .filter((ch) => ch.kind.includes('cancel') || ch.kind.includes('departure'))
      .map((ch) => ({
        stayId: ch.stayId,
        kind: ch.kind,
        amount: ch.amount,
        description: ch.description,
        waived: ch.waived,
      })),
    fees: charges
      .filter((ch) => !(ch.kind.includes('cancel') || ch.kind.includes('departure')))
      .map((ch) => ({ kind: ch.kind, amount: ch.amount, description: ch.description })),
    deposits: { requiredBefore, requiredAfter, held, additionalDue },
    balance: {
      projectedBefore,
      projectedAfter,
      basis:
        'Folio balances now, plus agreed charges not yet posted (from the business date for in-house stays), plus penalties and fees of this change, minus deposits held. Excludes future incidental charges.',
    },
    provenance: tx.environment === 'demo' || tx.environment === 'training' ? 'simulated' : 'live',
  };
  return {
    request,
    propertyId: c.propertyId,
    booking,
    currency: c.currency,
    stayPlans,
    newStays,
    bookingStatusAfter,
    charges,
    view,
    alternatives,
  };
}

function dedupeBlockers(blockers: Array<{ code: string; message: string }>) {
  const seen = new Set<string>();
  return blockers.filter((b) => {
    const k = `${b.code}|${b.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function extensionAlternatives(
  c: Ctx,
  booking: BookingRecord,
  request: Extract<ChangeRequest, { kind: 'dates' }>,
): Promise<Plan['alternatives']> {
  const { inventory } = c.deps.ports;
  const stay = booking.stays.find((s) => s.row.id === request.stayId) as StayRecord;
  const last = stay.segments[stay.segments.length - 1];
  if (!last) return [];
  const extra: DateRange | null =
    request.departure > stay.row.departure
      ? { from: stay.row.departure, to: request.departure }
      : request.arrival < stay.row.arrival
        ? { from: request.arrival, to: stay.row.arrival }
        : null;
  if (!extra) return [];
  const out: Plan['alternatives'] = [];
  const currentUnit = last.unitId;
  const sameType = await inventory.findAssignableUnits(c.tx, {
    propertyId: c.propertyId,
    unitTypeId: last.unitTypeId,
    nights: extra,
  });
  const forExtra = sameType.find((u) => u.assignable && u.unitId !== currentUnit);
  if (forExtra) {
    out.push({
      id: `move_extra_nights:${forExtra.unitId}`,
      label: `Move to ${forExtra.name} for the extra nights`,
      description: `Stay in the current unit until ${stay.row.departure}, then move to ${forExtra.name} (same unit type) for ${diffDays(extra.from, extra.to)} night(s).`,
      request: { ...request, extraNights: { strategy: 'move_extra_nights', unitId: forExtra.unitId } },
    });
  }
  const inHouse = stay.row.status === 'in_house';
  const moveFrom = inHouse && c.businessDate > stay.row.arrival ? c.businessDate : request.arrival;
  const whole = await inventory.findAssignableUnits(c.tx, {
    propertyId: c.propertyId,
    unitTypeId: last.unitTypeId,
    nights: { from: moveFrom, to: request.departure },
  });
  const wholeUnit = whole.find((u) => u.assignable && u.unitId !== currentUnit);
  if (wholeUnit) {
    out.push({
      id: `move_whole_stay:${wholeUnit.unitId}`,
      label: `Move the stay to ${wholeUnit.name}`,
      description: `${wholeUnit.name} (same unit type) is free from ${moveFrom} to ${request.departure}, so the guest moves once and keeps one unit for the rest of the stay.`,
      request: { ...request, extraNights: { strategy: 'move_whole_stay', unitId: wholeUnit.unitId } },
    });
  }
  const types = await inventory.listUnitTypes(c.tx, { propertyId: c.propertyId });
  const current = types.find((t) => t.id === last.unitTypeId);
  const others = types
    .filter((t) => t.id !== last.unitTypeId)
    .filter((t) => !current || t.rank >= current.rank)
    .sort((a, b) => a.rank - b.rank); // nearest upgrade first
  for (const t of others) {
    const units = await inventory.findAssignableUnits(c.tx, {
      propertyId: c.propertyId,
      unitTypeId: t.id,
      nights: extra,
    });
    const u = units.find((x) => x.assignable);
    if (!u) continue;
    out.push({
      id: `upgrade:${t.id}:${u.unitId}`,
      label: `Upgrade to ${t.name} (${u.name}) for the extra nights`,
      description: `Chargeable: the extra nights are priced for ${t.name}.`,
      request: {
        ...request,
        extraNights: {
          strategy: 'change_type_extra',
          unitTypeId: t.id,
          unitId: u.unitId,
          typeChange: 'difference',
        },
      },
    });
    out.push({
      id: `upgrade_complimentary:${t.id}:${u.unitId}`,
      label: `Complimentary upgrade to ${t.name} (${u.name}) for the extra nights`,
      description: `The extra nights are charged at the agreed ${current?.name ?? 'current'} price.`,
      request: {
        ...request,
        extraNights: {
          strategy: 'change_type_extra',
          unitTypeId: t.id,
          unitId: u.unitId,
          typeChange: 'keep_agreed',
        },
      },
    });
    break;
  }
  out.push({
    id: 'waitlist_extension',
    label: 'Waitlist the extension',
    description: 'Keep the current dates and tell the owner as soon as the extra nights become available.',
    request: { kind: 'waitlist_extension', stayId: stay.row.id, departure: request.departure },
  });
  return out;
}

async function newBookingAlternatives(
  c: Ctx,
  request: Extract<ChangeRequest, { kind: 'new_booking' }>,
): Promise<Plan['alternatives']> {
  const stays = request.booking.stays;
  if (stays.length !== 1) return [];
  const s = stays[0] as (typeof stays)[number];
  const types = await c.deps.ports.inventory.listUnitTypes(c.tx, { propertyId: c.propertyId });
  const cells = await c.deps.ports.inventory.getAvailability(c.tx, {
    propertyId: c.propertyId,
    unitTypeIds: types.map((t) => t.id),
    range: { from: s.arrival, to: s.departure },
  });
  const out: Plan['alternatives'] = [];
  for (const t of types) {
    if (t.id === s.unitTypeId) continue;
    const nights = eachNight({ from: s.arrival, to: s.departure });
    if (!nights.every((d) => (cells.find((x) => x.unitTypeId === t.id && x.date === d)?.available ?? 0) >= 1))
      continue;
    out.push({
      id: `unit_type:${t.id}`,
      label: `${t.name} is available`,
      description: `Same dates and rate plan in ${t.name}.`,
      request: {
        ...request,
        booking: { ...request.booking, stays: [{ ...s, unitTypeId: t.id, unitId: undefined }] },
      },
    });
    if (out.length >= 3) break;
  }
  return out;
}

// ───────────────────────────── preview persistence ─────────────────────────────

function fingerprintOf(view: Plan['view']): string {
  const material = {
    feasible: view.feasible,
    blockers: view.blockers,
    stays: view.stays,
    totals: view.totals,
    taxes: view.taxes,
    penalties: view.penalties,
    fees: view.fees,
    deposits: view.deposits,
    balance: { projectedBefore: view.balance.projectedBefore, projectedAfter: view.balance.projectedAfter },
    bookingVersion: view.bookingVersion,
  };
  return sha256Hex(canonicalJson(material));
}

async function persistPreview(
  deps: Deps,
  tx: TxContext,
  plan: Plan,
  parentToken: string | null,
): Promise<PreviewCore> {
  const token = newId(tx.now.getTime());
  const expiresAt = new Date(tx.now.getTime() + deps.config.previewTtlMinutes * 60_000);
  const fingerprint = fingerprintOf(plan.view);
  const core: PreviewCore = { token, expiresAt: expiresAt.toISOString(), fingerprint, ...plan.view };
  await db(tx)
    .insertInto('reservations.change_previews')
    .values({
      token,
      tenant_id: tx.tenantId,
      property_id: plan.propertyId,
      booking_id: plan.booking?.row.id ?? null,
      booking_version: plan.booking?.row.version ?? null,
      kind: plan.request.kind,
      request: json(plan.request),
      result: json(core),
      fingerprint,
      created_by: actorKey(tx),
      created_at: tx.now,
      expires_at: expiresAt,
      parent_token: parentToken,
    })
    .execute();
  return core;
}

/** Compute and persist a change preview (with fully previewed alternatives where relevant). */
export async function previewChange(
  deps: Deps,
  tx: TxContext,
  request: ChangeRequest,
): Promise<ChangePreview> {
  const plan = await buildPlan(deps, tx, request);
  const core = await persistPreview(deps, tx, plan, null);
  const alternatives: ChangePreview['alternatives'] = [];
  for (const alt of plan.alternatives) {
    try {
      const altPlan = await buildPlan(deps, tx, alt.request);
      if (!altPlan.view.feasible) continue;
      alternatives.push({
        id: alt.id,
        label: alt.label,
        description: alt.description,
        preview: await persistPreview(deps, tx, altPlan, core.token),
      });
    } catch (err) {
      // An alternative that cannot even be priced (e.g. rate plan not sold for that type) is simply not offered.
      if (err instanceof DomainError && err.status < 500 && !(err.cause instanceof Error)) continue;
      throw err;
    }
  }
  const preview: ChangePreview = { ...core, alternatives };
  await db(tx)
    .updateTable('reservations.change_previews')
    .set({ result: json(preview) })
    .where('token', '=', core.token)
    .execute();
  return preview;
}

// ───────────────────────────── commit ─────────────────────────────

export interface CommitResult {
  kind: string;
  previewToken: string;
  bookingId: string;
  booking: Booking;
  /** Key operations caused by the change (room move, extension, cancellation) and their real outcome. */
  keys: KeyEffect[];
}

export interface KeyEffect {
  stayId: string;
  action: 'move' | 'extend' | 'cancel';
  result: KeyOperationResult;
}

class StaleSignal extends PreviewStaleError {}

/**
 * Commit exactly what the user saw (RES-I07). Throws PreviewStaleError (without a fresh preview) when anything
 * changed — use `commitChangeSafely` to get the fresh preview and explanation.
 */
export async function commitChange(
  deps: Deps,
  tx: TxContext,
  input: { previewToken: string },
): Promise<CommitResult | ForwardedResult> {
  const row = await db(tx)
    .selectFrom('reservations.change_previews')
    .selectAll()
    .where('token', '=', input.previewToken)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw new NotFoundError('change_preview', input.previewToken);
  if (row.status === 'committed') {
    throw new BusinessRuleError(
      'preview_already_committed',
      'This change was already committed. Reload the booking to see it; preview again for a further change.',
    );
  }
  const request = row.request as ChangeRequest;
  if (row.expires_at.getTime() < tx.now.getTime()) {
    throw new StaleSignal({ reason: 'This preview has expired.', freshPreview: null, differences: [] });
  }
  if (row.booking_id) {
    const locked = await lockBooking(tx, row.booking_id, null);
    if (locked.version !== row.booking_version) {
      throw new StaleSignal({
        reason: 'The booking was changed by someone else after this preview was made.',
        freshPreview: null,
        differences: [],
      });
    }
  }
  const plan = await buildPlan(deps, tx, request);
  if (fingerprintOf(plan.view) !== row.fingerprint) {
    throw new StaleSignal({
      reason: 'Availability, prices or penalties changed since this preview was made.',
      freshPreview: null,
      differences: [],
    });
  }
  if (!plan.view.feasible) {
    throw new BusinessRuleError(
      'change_not_feasible',
      `This change cannot be committed: ${plan.view.blockers.map((b) => b.message).join(' ')} Choose one of the alternatives or adjust the request.`,
      { blockers: plan.view.blockers },
    );
  }
  const forwarded = await guardAuthority(deps, tx, {
    propertyId: plan.propertyId,
    kind: request.kind,
    payload: request,
    bookingId: plan.booking?.row.id ?? null,
    stayId: 'stayId' in request ? request.stayId : null,
  });
  if (forwarded) {
    await db(tx)
      .updateTable('reservations.change_previews')
      .set({ status: 'committed', committed_at: tx.now })
      .where('token', '=', row.token)
      .execute();
    return forwarded;
  }
  const { bookingId, keys } = await applyPlan(deps, tx, plan, row.token);
  await db(tx)
    .updateTable('reservations.change_previews')
    .set({ status: 'committed', committed_at: tx.now })
    .where('token', '=', row.token)
    .execute();
  const rec = await loadBooking(tx, bookingId);
  return {
    kind: request.kind,
    previewToken: row.token,
    bookingId,
    booking: await bookingRecord(deps, tx, rec),
    keys,
  };
}

async function applyPlan(
  deps: Deps,
  tx: TxContext,
  plan: Plan,
  token: string,
): Promise<{ bookingId: string; keys: KeyEffect[] }> {
  const { inventory, finance } = deps.ports;
  const request = plan.request;
  if (request.kind === 'new_booking') {
    const { booking } = await createBookingInternal(deps, tx, request.booking, {
      priced: plan.newStays,
      previewToken: token,
    });
    return { bookingId: booking.row.id, keys: [] };
  }
  const keys: KeyEffect[] = [];
  const booking = plan.booking as BookingRecord;
  const before = booking;
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  for (const sp of plan.stayPlans) {
    const stayRef = ref(sp.stay.row.id);
    if (sp.mode === 'modify') {
      const segments = [];
      for (const t of sp.targets) {
        let snapshotId: string;
        if (t.pricing.kind === 'keep') snapshotId = t.pricing.termsSnapshotId;
        else {
          snapshotId = await insertSnapshot(tx, {
            stayId: sp.stay.row.id,
            document: t.terms,
            acceptedVia: 'change',
            supersedesId: t.pricing.baseTermsSnapshotId,
            changePreview: token,
          });
        }
        segments.push({ ...t, termsSnapshotId: snapshotId });
      }
      for (const op of sp.inventoryOps) {
        if (op.op === 'release') await inventory.release(tx, { ref: stayRef, nights: op.nights });
      }
      for (const op of sp.inventoryOps) {
        if (op.op === 'change')
          await inventory.changeConsumption(tx, { ref: stayRef, from: op.from, to: op.to });
        if (op.op === 'consume')
          await inventory.consume(tx, {
            propertyId: plan.propertyId,
            unitTypeId: op.unitTypeId,
            nights: op.nights,
            quantity: 1,
            ref: stayRef,
          });
      }
      for (const op of sp.assignmentOps)
        if (op.op === 'unassign') await inventory.unassignUnit(tx, { ref: stayRef, nights: op.nights });
      for (const op of sp.assignmentOps)
        if (op.op === 'assign')
          await inventory.assignUnit(tx, { unitId: op.unitId, ref: stayRef, nights: op.nights });
      await replaceSegments(tx, sp.stay.row.id, segments);
      await updateStay(tx, sp.stay.row.id, { arrival: sp.arrival, departure: sp.departure });
      if (sp.roomMove) {
        await db(tx)
          .insertInto('reservations.room_moves')
          .values({
            id: newId(tx.now.getTime()),
            tenant_id: tx.tenantId,
            stay_id: sp.stay.row.id,
            from_unit_id: sp.roomMove.fromUnitId,
            to_unit_id: sp.roomMove.toUnitId,
            from_date: sp.roomMove.fromDate,
            reason: sp.roomMove.reason,
            chargeable: sp.roomMove.chargeable,
            moved_at: tx.now,
            moved_by: actorKey(tx),
          })
          .execute();
        events.push({
          type: E.stayMoved,
          payload: { stayId: sp.stay.row.id, bookingId: booking.row.id, ...sp.roomMove },
        });
      } else {
        const fromUnit = sp.stay.segments.find((s) => s.unitId)?.unitId ?? null;
        const toUnit = segments.find((s) => s.unitId && s.unitId !== fromUnit)?.unitId ?? null;
        if (toUnit && fromUnit) {
          const fromDate = segments.find((s) => s.unitId === toUnit)?.from ?? sp.arrival;
          events.push({
            type: E.stayMoved,
            payload: {
              stayId: sp.stay.row.id,
              bookingId: booking.row.id,
              fromUnitId: fromUnit,
              toUnitId: toUnit,
              fromDate,
              reason: request.kind,
            },
          });
        }
      }
      if (sp.departure > sp.stay.row.departure || sp.arrival < sp.stay.row.arrival) {
        events.push({
          type: E.stayExtended,
          payload: {
            stayId: sp.stay.row.id,
            bookingId: booking.row.id,
            from: { arrival: sp.stay.row.arrival, departure: sp.stay.row.departure },
            to: { arrival: sp.arrival, departure: sp.departure },
          },
        });
      }
      if (sp.departure < sp.stay.row.departure || sp.arrival > sp.stay.row.arrival) {
        events.push({
          type: E.stayShortened,
          payload: {
            stayId: sp.stay.row.id,
            bookingId: booking.row.id,
            from: { arrival: sp.stay.row.arrival, departure: sp.stay.row.departure },
            to: { arrival: sp.arrival, departure: sp.departure },
          },
        });
      }
    } else if (sp.mode === 'cancel') {
      for (const op of sp.inventoryOps)
        if (op.op === 'release') await inventory.release(tx, { ref: stayRef });
      if (sp.stay.row.hold_id) await inventory.release(tx, { ref: stayRef });
      for (const op of sp.assignmentOps)
        if (op.op === 'unassign') await inventory.unassignUnit(tx, { ref: stayRef });
      await updateStay(tx, sp.stay.row.id, { status: 'cancelled', hold_id: null });
    } else if (sp.mode === 'time_request' && sp.timeRequest) {
      const value = json({
        time: sp.timeRequest.time,
        fee: sp.timeRequest.fee,
        approvedBy: actorName(tx),
        approvedAt: tx.now.toISOString(),
      });
      await updateStay(
        tx,
        sp.stay.row.id,
        sp.timeRequest.kind === 'early_check_in' ? { early_check_in: value } : { late_check_out: value },
      );
    }
  }
  if (request.kind === 'waitlist_extension') {
    const stay = booking.stays.find((s) => s.row.id === request.stayId) as StayRecord;
    await raiseIssue(tx, {
      propertyId: plan.propertyId,
      kind: 'extension_waitlisted',
      severity: 'routine',
      bookingId: booking.row.id,
      stayId: stay.row.id,
      dedupeKey: `extension:${stay.row.id}:${request.departure}`,
      message: `Extension to ${request.departure} is waitlisted for booking ${booking.row.code}.`,
      ownerId: booking.row.owner_id,
      details: {
        requestedDeparture: request.departure,
        unitTypeId: stay.segments[stay.segments.length - 1]?.unitTypeId,
      },
    });
  }
  for (const ns of plan.newStays) {
    await insertStayWithInventory(deps, tx, {
      bookingId: booking.row.id,
      propertyId: plan.propertyId,
      bookingStatus: booking.row.status as BookingStatus,
      priced: ns,
      waitlisted: ns.input.waitlist !== undefined,
      defaultWaitlistExpiry: ns.input.arrival,
      exactProfileMatch: false,
      holdExpiresAt: booking.row.hold_expires_at,
      acceptedVia: booking.row.status === 'quoted' ? 'quote' : 'booking',
      previewToken: token,
      overbooking: null,
      onShortfall: null,
    });
  }
  // Penalties and fees are posted to the stay (finance billing rules choose the folio). Deterministic keys.
  for (const ch of plan.charges) {
    if (ch.waived || ch.amount.amountMinor === 0) continue;
    await finance.postCharge(tx, {
      propertyId: plan.propertyId,
      target: ch.stayId ? ref(ch.stayId) : { type: 'booking', id: booking.row.id },
      chargeCode: ch.chargeCode,
      amount: ch.amount,
      serviceDate: ch.serviceDate,
      description: `${ch.description} (booking ${booking.row.code})`,
      sourceRef: ch.stayId ? ref(ch.stayId) : { type: 'booking', id: booking.row.id },
      idempotencyKey: ch.idempotencyKey,
      taxMode: 'compute',
    });
  }
  const afterStays = await loadBooking(tx, booking.row.id);
  let status = plan.bookingStatusAfter;
  if (
    !status &&
    bookingShouldComplete(
      booking.row.status as BookingStatus,
      afterStays.stays.map((s) => s.row.status as StayStatus),
    )
  ) {
    status = 'completed';
  }
  const cancellation =
    status === 'cancelled' || status === 'declined'
      ? json({
          at: tx.now.toISOString(),
          by: actorName(tx),
          reason: request.kind === 'cancel_booking' ? request.reason : 'all stays cancelled',
          penalties: plan.charges.map((ch) => ({ stayId: ch.stayId, amount: ch.amount, waived: ch.waived })),
          depositHeld: plan.view.deposits.held,
          waiveReason: 'waive' in request && request.waive ? request.waive.reason : null,
        })
      : undefined;
  await bumpBooking(tx, booking.row.id, `change:${request.kind}`, {
    ...(status ? { status } : {}),
    ...(cancellation ? { cancellation } : {}),
    ...(status === 'cancelled' || status === 'declined' ? { hold_expires_at: null } : {}),
  });
  await tx.audit({
    action: `reservations.change.${request.kind}`,
    target: { type: 'booking', id: booking.row.id },
    propertyId: plan.propertyId,
    reason:
      'waive' in request && request.waive
        ? request.waive.reason
        : request.kind === 'cancel_booking'
          ? request.reason
          : null,
    before: { version: before.row.version, totals: plan.view.totals.before },
    after: { totals: plan.view.totals.after, penalties: plan.view.penalties, fees: plan.view.fees },
    metadata: { previewToken: token, request },
  });
  for (const ev of events) {
    await emitReservationEvent(tx, {
      type: ev.type,
      propertyId: plan.propertyId,
      aggregate: { type: 'stay', id: String(ev.payload.stayId) },
      payload: ev.payload,
    });
  }
  // Keys follow the stay (access module): moves re-encode, extensions/shortenings change validity, cancellations
  // deactivate. Only in-house stays can hold keys; results are returned and shown, never assumed.
  const businessDate = (await propertyInfo(deps, tx, plan.propertyId)).businessDate;
  for (const sp of plan.stayPlans) {
    const stayId = sp.stay.row.id;
    const common = { propertyId: plan.propertyId, stayId, bookingId: booking.row.id };
    if (sp.mode === 'modify' && sp.stay.row.status === 'in_house') {
      const night = businessDate < sp.departure ? businessDate : addDays(sp.departure, -1);
      const fromUnit = sp.stay.segments.find((s) => night >= s.from && night < s.to)?.unitId ?? null;
      const toUnit = sp.targets.find((t) => night >= t.from && night < t.to)?.unitId ?? null;
      if (fromUnit && toUnit && fromUnit !== toUnit) {
        const result = await keyOperation(deps, tx, {
          ...common,
          action: 'move',
          describe: `re-encode keys from the old unit to the new unit for booking ${booking.row.code}`,
          run: (access) =>
            access.moveKeys(tx, {
              stayId,
              fromUnitId: fromUnit,
              toUnitId: toUnit,
              validFrom: night,
              validTo: sp.departure,
              idempotencyKey: `move:${token}:${stayId}`,
            }),
        });
        keys.push({ stayId, action: 'move', result });
      }
      if (sp.departure !== sp.stay.row.departure) {
        const result = await keyOperation(deps, tx, {
          ...common,
          action: 'extend',
          describe: `set key validity to ${sp.departure} for booking ${booking.row.code}`,
          run: (access) =>
            access.extendKeys(tx, {
              stayId,
              validTo: sp.departure,
              idempotencyKey: `extend:${token}:${stayId}`,
            }),
        });
        keys.push({ stayId, action: 'extend', result });
      }
    }
    if (sp.mode === 'cancel') {
      const result = await keyOperation(deps, tx, {
        ...common,
        action: 'cancel',
        quietIfUnavailable: true,
        describe: `deactivate any pre-arrival keys for booking ${booking.row.code}`,
        run: (access) =>
          access.cancelKeys(tx, {
            stayId,
            reason: 'cancellation',
            idempotencyKey: `cancel:${token}:${stayId}`,
          }),
      });
      keys.push({ stayId, action: 'cancel', result });
    }
  }
  const bookingPayload = {
    bookingId: booking.row.id,
    code: booking.row.code,
    change: request.kind,
    previewToken: token,
  };
  if (status === 'cancelled' || status === 'declined') {
    await emitReservationEvent(tx, {
      type: E.bookingCancelled,
      propertyId: plan.propertyId,
      aggregate: { type: 'booking', id: booking.row.id },
      payload: {
        ...bookingPayload,
        status,
        penalties: plan.view.penalties,
        depositHeld: plan.view.deposits.held,
      },
    });
  } else {
    await emitReservationEvent(tx, {
      type: E.bookingModified,
      propertyId: plan.propertyId,
      aggregate: { type: 'booking', id: booking.row.id },
      payload: bookingPayload,
    });
  }
  return { bookingId: booking.row.id, keys };
}

/**
 * Apply a change without a user preview — ONLY for trusted system callers whose authority was checked at their own
 * entry point (channel ingestion: the channel already decided the change and confirmed it to the guest). The same
 * planning, pricing and penalty rules apply; nothing is skipped except the preview/commit round trip.
 */
export async function applyChangeDirect(
  deps: Deps,
  tx: TxContext,
  request: ChangeRequest,
  reference: string,
): Promise<{ bookingId: string; keys: KeyEffect[] }> {
  const plan = await buildPlan(deps, tx, request, { trusted: true });
  if (!plan.view.feasible) {
    throw new BusinessRuleError(
      'change_not_feasible',
      `This change cannot be applied: ${plan.view.blockers.map((b) => b.message).join(' ')}`,
      { blockers: plan.view.blockers },
    );
  }
  return applyPlan(deps, tx, plan, reference);
}

// ───────────────────────────── stale recovery (S01) ─────────────────────────────

/** Who sold the short nights (from the inventory explanation + our own records). */
async function explainShortfall(
  deps: Deps,
  tx: TxContext,
  preview: ChangePreview,
  propertyId: string,
): Promise<string[]> {
  const out: string[] = [];
  const short = new Map<string, { unitTypeId: string; date: string }>();
  for (const s of preview.stays) {
    for (const n of s.nights) {
      if (n.availability && !n.availability.sufficient && n.unitTypeId)
        short.set(`${n.unitTypeId}|${n.date}`, { unitTypeId: n.unitTypeId, date: n.date });
    }
  }
  for (const { unitTypeId, date } of [...short.values()].slice(0, 5)) {
    const explanation = await deps.ports.inventory.explainAvailability(tx, { propertyId, unitTypeId, date });
    const lastSale = [...explanation.consumers].sort((a, b) => (a.consumedAt < b.consumedAt ? 1 : -1))[0];
    if (!lastSale) continue;
    if (lastSale.ref.type !== 'stay') {
      out.push(`${date}: the last unit was taken by ${lastSale.ref.type} ${lastSale.ref.id}.`);
      continue;
    }
    const stay = await db(tx)
      .selectFrom('reservations.stays')
      .select(['booking_id'])
      .where('id', '=', lastSale.ref.id)
      .executeTakeFirst();
    if (!stay) continue;
    const b = await db(tx)
      .selectFrom('reservations.bookings')
      .select(['code'])
      .where('id', '=', stay.booking_id)
      .executeTakeFirstOrThrow();
    const version = await db(tx)
      .selectFrom('reservations.booking_versions')
      .select(['actor_name', 'changed_at'])
      .where('booking_id', '=', stay.booking_id)
      .where('changed_at', '<=', new Date(lastSale.consumedAt))
      .orderBy('changed_at', 'desc')
      .executeTakeFirst();
    const seconds = Math.max(0, Math.round((tx.now.getTime() - Date.parse(lastSale.consumedAt)) / 1000));
    out.push(
      `${date}: sold ${seconds} second${seconds === 1 ? '' : 's'} ago by ${version?.actor_name ?? 'another user'}, booking ${b.code}.`,
    );
  }
  return out;
}

/**
 * Commit with recovery: if the preview went stale (detected before writing) or inventory/assignment changed under
 * us (detected while writing — the transaction rolls back), compute and persist a FRESH preview in a new
 * transaction and answer 409 `preview_stale` with it, the differences, and who took the inventory.
 */
export async function commitChangeSafely(
  deps: Deps,
  database: PorticoDatabase,
  ctx: RequestContext,
  input: { previewToken: string },
  run: <T>(fn: (tx: TxContext) => Promise<T>) => Promise<T> = (fn) => withTenantTx(database, ctx, fn),
): Promise<CommitResult | ForwardedResult> {
  try {
    return await run((tx) => commitChange(deps, tx, input));
  } catch (err) {
    const reason =
      err instanceof StaleSignal
        ? (err.details?.reason as string)
        : inventoryShortfall(err)
          ? 'The inventory you previewed was sold to someone else a moment ago.'
          : assignmentConflicts(err)
            ? 'The unit you previewed was assigned to another stay a moment ago.'
            : null;
    if (reason === null) throw err;
    const fresh = await withTenantTx(database, ctx, async (tx) => {
      const old = await db(tx)
        .selectFrom('reservations.change_previews')
        .select(['request', 'result', 'property_id'])
        .where('token', '=', input.previewToken)
        .executeTakeFirstOrThrow();
      await db(tx)
        .updateTable('reservations.change_previews')
        .set({ status: 'stale' })
        .where('token', '=', input.previewToken)
        .where('status', '=', 'open')
        .execute();
      const preview = await previewChange(deps, tx, old.request as ChangeRequest);
      const oldView = old.result as ChangePreview;
      const strip = (p: ChangePreview) => ({
        feasible: p.feasible,
        blockers: p.blockers,
        stays: p.stays,
        totals: p.totals,
        penalties: p.penalties,
        fees: p.fees,
        deposits: p.deposits,
        balance: p.balance,
      });
      return {
        preview,
        differences: diffValues(strip(oldView), strip(preview)),
        explanation: await explainShortfall(deps, tx, preview, old.property_id),
      };
    });
    throw new PreviewStaleError({
      reason,
      freshPreview: fresh.preview,
      differences: fresh.differences,
      explanation: fresh.explanation,
    });
  }
}
