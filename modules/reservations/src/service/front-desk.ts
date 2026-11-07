import type { TxContext } from '@portico/db';
import { type LocalDate, type Money, requirePermission, sum } from '@portico/kernel';
import type { FrontDeskRow } from '../contracts';
import { composeReadiness } from '../domain/readiness';
import { type StepState, summarize } from '../domain/workflow';
import { RESERVATIONS_PERMISSIONS as P } from '../manifest';
import { type GuaranteeKind, type PaymentStatusValue, paymentReadiness, type UnitCondition } from '../ports';
import { type Deps, db, isModuleUnavailable, MONEY_NOT_SHOWN, policy, seesMoney } from './context';
import { currentUnit, loadSnapshots, loadStayRecords, occ, type StayRecord, snapshotOf } from './repo';

/**
 * Front-desk lists (RES-R35). Each row keeps booking status, stay status, unit condition, payment status and
 * availability-derived facts in SEPARATE fields; readiness is a composition with one blocking reason.
 */
async function rows(
  tx: TxContext,
  propertyId: string,
  where: (s: StayRecord) => boolean,
  statuses: string[],
) {
  const stayRows = await db(tx)
    .selectFrom('reservations.stays')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('status', 'in', statuses)
    .orderBy('arrival')
    .orderBy('id')
    .limit(2000)
    .execute();
  return (await loadStayRecords(tx, stayRows)).filter(where);
}

async function safely<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isModuleUnavailable(err)) return fallback;
    throw err;
  }
}

async function baseRow(
  deps: Deps,
  tx: TxContext,
  stay: StayRecord,
  businessDate: LocalDate,
): Promise<FrontDeskRow> {
  const booking = await db(tx)
    .selectFrom('reservations.bookings')
    .select(['id', 'code', 'status', 'booker_name'])
    .where('id', '=', stay.row.booking_id)
    .executeTakeFirstOrThrow();
  const unitId = currentUnit(stay, businessDate);
  const unitName = unitId
    ? await safely(
        async () =>
          (await deps.ports.inventory.getUnit(tx, unitId, { propertyId: stay.row.property_id })).name,
        null,
      )
    : null;
  const run = await db(tx)
    .selectFrom('reservations.workflow_runs')
    .select(['status', 'steps'])
    .where('stay_id', '=', stay.row.id)
    .where('kind', '=', 'check_in')
    .orderBy('started_at', 'desc')
    .executeTakeFirst();
  const primary = stay.occupants.find((o) => o.is_primary);
  const seg = stay.segments.find((s) => s.from <= stay.row.arrival) ?? stay.segments[0];
  const flags: string[] = [];
  if (stay.row.arrival === businessDate) flags.push('arriving_today');
  if (stay.row.departure === businessDate) flags.push('departing_today');
  if (stay.row.status === 'in_house' && businessDate > stay.row.departure) flags.push('overstay');
  if (stay.row.status === 'expected' && stay.row.arrival < businessDate) flags.push('late_arrival');
  if (stay.row.commercial_type !== 'standard') flags.push(stay.row.commercial_type);
  if (stay.row.early_check_in) flags.push('early_check_in');
  if (stay.row.late_check_out) flags.push('late_check_out');
  if (run?.status === 'in_progress') flags.push('check_in_in_progress');
  return {
    stayId: stay.row.id,
    bookingId: booking.id,
    bookingCode: booking.code,
    bookingStatus: booking.status as FrontDeskRow['bookingStatus'],
    stayStatus: stay.row.status as FrontDeskRow['stayStatus'],
    guestName: primary?.name ?? booking.booker_name,
    arrival: stay.row.arrival,
    departure: stay.row.departure,
    unitTypeId: seg?.unitTypeId ?? '',
    unitId,
    unitName,
    eta: stay.row.eta,
    occupancy: seg ? occ(seg.occupancy) : { adults: 1, childrenAges: [] },
    flags,
    readiness: null,
    balance: null,
    checkInRun: run ? { status: run.status, remaining: summarize(run.steps as StepState[]).remaining } : null,
  };
}

/** Arrivals for a business date with readiness and the single blocking reason per arrival (vision 07:30). */
export async function listArrivals(
  deps: Deps,
  tx: TxContext,
  input: { propertyId: string; date?: LocalDate },
) {
  requirePermission(tx, P.bookingRead, { propertyId: input.propertyId });
  const businessDate = await deps.ports.platform.getBusinessDate(tx, input.propertyId);
  const date = input.date ?? businessDate;
  const required = await policy<UnitCondition>(
    deps,
    tx,
    input.propertyId,
    'reservations.checkIn.requiredCondition',
    'inspected',
  );
  const stays = await rows(
    tx,
    input.propertyId,
    (s) =>
      s.row.arrival === date ||
      (s.row.status === 'expected' && s.row.arrival < date && date === businessDate),
    ['expected', 'in_house'],
  );
  const out: FrontDeskRow[] = [];
  for (const stay of stays.filter((s) => s.row.status === 'expected' || s.row.arrival === date)) {
    const row = await baseRow(deps, tx, stay, date);
    if (stay.row.status === 'expected') {
      const booking = await db(tx)
        .selectFrom('reservations.bookings')
        .select(['guarantee'])
        .where('id', '=', stay.row.booking_id)
        .executeTakeFirstOrThrow();
      const guarantee = (booking.guarantee ?? { kind: 'none' }) as { kind: GuaranteeKind };
      const snaps = await loadSnapshots(
        tx,
        stay.segments.map((s) => s.termsSnapshotId),
      );
      const first = stay.segments[0] ? snapshotOf(snaps, stay.segments[0].termsSnapshotId) : null;
      const guaranteeRequired =
        stay.row.commercial_type === 'standard' &&
        (first?.policies.guarantee.required ?? []).some((k) => k !== 'none');
      const condition: UnitCondition | 'unknown' | null = row.unitId
        ? await safely(
            async () => (await deps.ports.operations.getUnitCondition(tx, row.unitId as string)).condition,
            'unknown' as const,
          )
        : null;
      // UX FD-15 (review P2-1): roles without money permissions never trigger a payments read for this board.
      const money = seesMoney(tx, input.propertyId);
      const read = (ref: { type: string; id: string }) =>
        safely(
          async () =>
            paymentReadiness(
              await deps.ports.payments.getPaymentStatus(tx, ref, { propertyId: stay.row.property_id }),
            ),
          'unknown' as const,
        );
      const stayPay = money ? await read({ type: 'stay', id: stay.row.id }) : ('unknown' as const);
      const bookingPay = money
        ? await read({ type: 'booking', id: stay.row.booking_id })
        : ('unknown' as const);
      const rank: Array<PaymentStatusValue | 'unknown'> = [
        'paid',
        'partially_paid',
        'authorized',
        'pending_verification',
        'failed',
        'refunded',
        'unknown',
        'none',
      ];
      const paymentStatus =
        [stayPay, bookingPay].sort((a, b) => rank.indexOf(a) - rank.indexOf(b))[0] ?? 'none';
      const primary = stay.occupants.find((o) => o.is_primary);
      const requests = (stay.row.requests ?? []) as Array<{ status: string }>;
      row.readiness = composeReadiness({
        assignedUnitId: row.unitId,
        unitName: row.unitName,
        unitCondition: condition,
        requiredCondition: required,
        guaranteeKind: stay.row.commercial_type === 'standard' ? guarantee.kind : 'company',
        guaranteeRequired,
        paymentStatus,
        ...(money ? {} : { paymentRedacted: MONEY_NOT_SHOWN }),
        registrationComplete: Boolean(primary?.name),
        openRequests: requests.filter((r) => r.status === 'open').length,
      });
      if (!money) row.redacted = true;
    }
    out.push(row);
  }
  return {
    date,
    businessDate,
    items: out,
    counts: { total: out.length, ready: out.filter((r) => r.readiness?.ready).length },
  };
}

async function staysBalance(
  deps: Deps,
  tx: TxContext,
  stay: StayRecord,
  currency: string,
): Promise<Money | null> {
  return safely(async () => {
    const folios = await deps.ports.finance.listFolios(tx, {
      propertyId: stay.row.property_id,
      owner: { type: 'stay', id: stay.row.id },
    });
    return sum(
      currency,
      folios.map((f) => f.balance),
    );
  }, null);
}

/** Departures for a date (incl. overstays) with balances per stay from finance. */
export async function listDepartures(
  deps: Deps,
  tx: TxContext,
  input: { propertyId: string; date?: LocalDate },
) {
  requirePermission(tx, P.bookingRead, { propertyId: input.propertyId });
  const businessDate = await deps.ports.platform.getBusinessDate(tx, input.propertyId);
  const date = input.date ?? businessDate;
  const stays = await rows(tx, input.propertyId, (s) => s.row.departure <= date, ['in_house']);
  const out: FrontDeskRow[] = [];
  for (const stay of stays) {
    const row = await baseRow(deps, tx, stay, date);
    const b = await db(tx)
      .selectFrom('reservations.bookings')
      .select(['currency'])
      .where('id', '=', stay.row.booking_id)
      .executeTakeFirstOrThrow();
    if (seesMoney(tx, input.propertyId)) row.balance = await staysBalance(deps, tx, stay, b.currency);
    else row.redacted = true;
    out.push(row);
  }
  return {
    date,
    businessDate,
    items: out,
    counts: { total: out.length, withBalance: out.filter((r) => (r.balance?.amountMinor ?? 0) !== 0).length },
  };
}

/** In-house list with derived flags (departing today, overstay). */
export async function listInHouse(
  deps: Deps,
  tx: TxContext,
  input: { propertyId: string; date?: LocalDate },
) {
  requirePermission(tx, P.bookingRead, { propertyId: input.propertyId });
  const businessDate = await deps.ports.platform.getBusinessDate(tx, input.propertyId);
  const date = input.date ?? businessDate;
  const stays = await rows(tx, input.propertyId, () => true, ['in_house']);
  const out: FrontDeskRow[] = [];
  for (const stay of stays) out.push(await baseRow(deps, tx, stay, date));
  return { date, businessDate, items: out, counts: { total: out.length } };
}
