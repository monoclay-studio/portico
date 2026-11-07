import type { TxContext } from '@portico/db';
import type { LocalDate, RecordIssue, RecordLink } from '@portico/kernel';
import type { Booking, Stay } from '../contracts';
import { bookingActions, stayActions } from '../domain/actions';
import { conditionMeets } from '../domain/readiness';
import type { BookingStatus, StayStatus } from '../domain/status';
import { RESERVATIONS_PERMISSIONS as P } from '../manifest';
import type { UnitCondition } from '../ports';
import { type Deps, db, isModuleUnavailable, policy } from './context';
import { type BookingRecord, currentUnit, type StayRecord, toBookingView } from './repo';

async function safely<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isModuleUnavailable(err)) return fallback;
    throw err;
  }
}

const ISSUE_SEVERITY: Record<string, RecordIssue['severity']> = {
  urgent: 'blocking',
  routine: 'warning',
};

async function stayExtras(
  deps: Deps,
  tx: TxContext,
  stay: StayRecord,
  view: Stay,
  ctx: {
    bookingStatus: BookingStatus;
    businessDate: LocalDate;
    requiredCondition: UnitCondition;
    ownerId: string | null;
  },
): Promise<Stay> {
  const propertyId = stay.row.property_id;
  const can = (p: string) => tx.authz.can(p, { propertyId });
  const status = stay.row.status as StayStatus;
  const active = status === 'expected' || status === 'in_house';
  const unitId = currentUnit(stay, ctx.businessDate);
  const unitName = unitId
    ? await safely(async () => (await deps.ports.inventory.getUnit(tx, unitId)).name, null)
    : null;
  const condition: UnitCondition | null =
    unitId && active
      ? await safely(async () => (await deps.ports.operations.getUnitCondition(tx, unitId)).condition, null)
      : null;
  const payment = active
    ? await safely(
        async () =>
          (await deps.ports.payments.getPaymentStatus(tx, { type: 'stay', id: stay.row.id })).status,
        null,
      )
    : null;
  const runs = await db(tx)
    .selectFrom('reservations.workflow_runs')
    .select(['kind', 'status', 'steps'])
    .where('stay_id', '=', stay.row.id)
    .where('status', '=', 'in_progress')
    .execute();
  const issues: RecordIssue[] = [];
  const owner = ctx.ownerId ? { kind: 'user' as const, id: ctx.ownerId } : undefined;
  if (status === 'expected' && !unitId && stay.row.arrival <= ctx.businessDate) {
    issues.push({
      code: 'unit_unassigned',
      severity: 'blocking',
      message: 'Arriving today without an assigned unit.',
    });
  }
  if (
    status === 'expected' &&
    unitId &&
    condition &&
    !conditionMeets(condition, ctx.requiredCondition) &&
    stay.row.arrival <= ctx.businessDate
  ) {
    issues.push({
      code: 'unit_not_ready',
      severity: 'blocking',
      message: `${unitName ?? 'The unit'} is ${condition.replace('_', ' ')} (needs to be ${ctx.requiredCondition}).`,
    });
  }
  if (payment === 'pending_verification') {
    issues.push({
      code: 'payment_pending_verification',
      severity: 'warning',
      message: 'A payment outcome is pending verification; do not take payment again.',
    });
  }
  if (status === 'in_house' && ctx.businessDate > stay.row.departure) {
    issues.push({
      code: 'overstay',
      severity: 'blocking',
      message: `Was due to depart on ${stay.row.departure}.`,
    });
  }
  for (const run of runs) {
    const steps = run.steps as Array<{ key: string; status: string; message: string | null }>;
    const failed = steps.find((s) => s.status === 'failed');
    const pending = steps.filter((s) => s.status === 'pending' || s.status === 'failed').map((s) => s.key);
    issues.push({
      code: run.kind === 'check_in' ? 'check_in_incomplete' : 'check_out_incomplete',
      severity: failed ? 'blocking' : 'info',
      message: `${run.kind === 'check_in' ? 'Check-in' : 'Check-out'} in progress; remaining: ${pending.join(', ')}${failed?.message ? ` — ${failed.message}` : ''}`,
    });
  }
  const relocations = await db(tx)
    .selectFrom('reservations.relocation_cases')
    .select(['id', 'cause', 'created_at', 'owner_id'])
    .where('stay_id', '=', stay.row.id)
    .where('status', 'in', ['open', 'option_selected'])
    .execute();
  for (const r of relocations) {
    issues.push({
      code: 'relocation_required',
      severity: 'blocking',
      message: `Relocation required (${r.cause.replace('_', ' ')}): choose an option in the relocation case.`,
      since: r.created_at.toISOString(),
      ...(r.owner_id ? { owner: { kind: 'user' as const, id: r.owner_id } } : {}),
    });
  }
  const openIssues = await db(tx)
    .selectFrom('reservations.issues')
    .select(['kind', 'severity', 'message', 'created_at', 'owner_id'])
    .where('stay_id', '=', stay.row.id)
    .where('status', '=', 'open')
    .execute();
  for (const i of openIssues) {
    issues.push({
      code: i.kind,
      severity: ISSUE_SEVERITY[i.severity] ?? 'warning',
      message: i.message,
      since: i.created_at.toISOString(),
      ...(i.owner_id ? { owner: { kind: 'user' as const, id: i.owner_id } } : {}),
    });
  }
  const links: RecordLink[] = [{ rel: 'booking', type: 'booking', id: stay.row.booking_id }];
  for (const o of stay.occupants) {
    if (o.profile_id)
      links.push({
        rel: o.is_primary ? 'guest' : 'occupant',
        type: 'guest_profile',
        id: o.profile_id,
        ...(o.name ? { title: o.name } : {}),
      });
  }
  if (unitId) links.push({ rel: 'unit', type: 'unit', id: unitId, ...(unitName ? { title: unitName } : {}) });
  const folios = await safely(
    () => deps.ports.finance.listFolios(tx, { owner: { type: 'stay', id: stay.row.id } }),
    [],
  );
  for (const f of folios)
    links.push({ rel: 'folio', type: 'folio', id: f.folioId, ...(f.label ? { title: f.label } : {}) });
  for (const r of relocations) links.push({ rel: 'relocation', type: 'relocation_case', id: r.id });
  if (stay.row.block_id) links.push({ rel: 'block', type: 'block', id: stay.row.block_id });

  const allowedActions = stayActions({
    stayStatus: status,
    bookingStatus: ctx.bookingStatus,
    arrival: stay.row.arrival,
    departure: stay.row.departure,
    businessDate: ctx.businessDate,
    unitAssigned: unitId !== null,
    unitName,
    unitReady: condition === null ? null : conditionMeets(condition, ctx.requiredCondition),
    unitCondition: condition,
    checkInInProgress: runs.some((r) => r.kind === 'check_in'),
    checkOutInProgress: runs.some((r) => r.kind === 'check_out'),
    can: (p) =>
      can(
        {
          checkIn: P.stayCheckIn,
          checkOut: P.stayCheckOut,
          move: P.stayMove,
          update: P.bookingUpdate,
          cancel: P.bookingCancel,
          noShow: P.stayNoShow,
          waitlist: P.waitlistManage,
        }[p],
      ),
  });
  return {
    ...view,
    status: {
      ...view.status,
      ...(payment ? { payment } : {}),
      ...(condition ? { unitCondition: condition } : {}),
    },
    allowedActions,
    issues,
    ...(owner ? { owner } : {}),
    links,
    provenance: tx.environment === 'demo' || tx.environment === 'training' ? 'simulated' : 'live',
  };
}

/** Booking as a universal record: status families, allowed actions with reasons, issues, owner, links. */
export async function bookingRecord(deps: Deps, tx: TxContext, rec: BookingRecord): Promise<Booking> {
  const propertyId = rec.row.property_id;
  const businessDate = await deps.ports.platform.getBusinessDate(tx, propertyId);
  const view = await toBookingView(tx, rec, businessDate);
  const requiredCondition = await policy<UnitCondition>(
    deps,
    tx,
    propertyId,
    'reservations.checkIn.requiredCondition',
    'inspected',
  );
  const stays: Stay[] = [];
  for (const [i, s] of rec.stays.entries()) {
    stays.push(
      await stayExtras(deps, tx, s, view.stays[i] as Stay, {
        bookingStatus: rec.row.status as BookingStatus,
        businessDate,
        requiredCondition,
        ownerId: rec.row.owner_id,
      }),
    );
  }
  const can = (p: string) => tx.authz.can(p, { propertyId });
  const payment = await safely(
    async () => (await deps.ports.payments.getPaymentStatus(tx, { type: 'booking', id: rec.row.id })).status,
    null,
  );
  const issues: RecordIssue[] = [];
  const bookingIssues = await db(tx)
    .selectFrom('reservations.issues')
    .select(['kind', 'severity', 'message', 'created_at', 'owner_id'])
    .where('booking_id', '=', rec.row.id)
    .where('stay_id', 'is', null)
    .where('status', '=', 'open')
    .execute();
  for (const i of bookingIssues) {
    issues.push({
      code: i.kind,
      severity: ISSUE_SEVERITY[i.severity] ?? 'warning',
      message: i.message,
      since: i.created_at.toISOString(),
      ...(i.owner_id ? { owner: { kind: 'user' as const, id: i.owner_id } } : {}),
    });
  }
  for (const s of stays)
    for (const i of s.issues)
      issues.push({ ...i, message: `${i.message} (stay ${s.arrival}→${s.departure})` });
  if (rec.row.status === 'tentative' && rec.row.option_date && rec.row.option_date <= businessDate) {
    issues.push({
      code: 'option_date_reached',
      severity: 'warning',
      message: `The option date (${rec.row.option_date}) has been reached: confirm or release.`,
    });
  }
  if (rec.row.status === 'held' && rec.row.hold_expires_at) {
    issues.push({
      code: 'hold_expiring',
      severity: rec.row.hold_expires_at.getTime() <= tx.now.getTime() ? 'blocking' : 'info',
      message: `Inventory is held until ${rec.row.hold_expires_at.toISOString()}.`,
    });
  }
  for (const f of view.pendingForwardedChanges) {
    issues.push({
      code: 'pending_external_confirmation',
      severity: 'info',
      message: `${f.kind} sent to ${f.systemName ?? 'the system of record'} — waiting for confirmation.`,
      since: f.createdAt,
    });
  }
  const links: RecordLink[] = [];
  if (rec.row.booker_profile_id)
    links.push({
      rel: 'booker',
      type: 'guest_profile',
      id: rec.row.booker_profile_id,
      ...(rec.row.booker_name ? { title: rec.row.booker_name } : {}),
    });
  if (rec.row.company_id) links.push({ rel: 'company', type: 'company', id: rec.row.company_id });
  if (rec.row.agency_id) links.push({ rel: 'agency', type: 'company', id: rec.row.agency_id });
  for (const s of stays)
    links.push({ rel: 'stay', type: 'stay', id: s.id, title: `${s.arrival} → ${s.departure}` });
  const statuses = rec.stays.map((s) => s.row.status);
  return {
    ...view,
    status: { ...view.status, ...(payment ? { payment } : {}) },
    stays,
    allowedActions: bookingActions({
      status: rec.row.status as BookingStatus,
      hasActiveStays: statuses.some((s) => ['expected', 'waitlisted'].includes(s)),
      hasInHouseStays: statuses.includes('in_house'),
      can: (p) => can({ create: P.bookingCreate, update: P.bookingUpdate, cancel: P.bookingCancel }[p]),
    }),
    issues,
    ...(rec.row.owner_id ? { owner: { kind: 'user' as const, id: rec.row.owner_id } } : {}),
    links,
    provenance: tx.environment === 'demo' || tx.environment === 'training' ? 'simulated' : 'live',
  };
}

/** A single stay as a universal record (GET /stays/:id). */
export async function stayRecordView(
  deps: Deps,
  tx: TxContext,
  rec: BookingRecord,
  stayId: string,
): Promise<Stay> {
  const booking = await bookingRecord(deps, tx, rec);
  const stay = booking.stays.find((s) => s.id === stayId);
  if (!stay) throw new Error(`stay ${stayId} not in booking ${rec.row.id}`);
  return stay;
}
