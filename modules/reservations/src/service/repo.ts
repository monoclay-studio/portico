import { type Selectable, sql, type TxContext } from '@portico/db';
import {
  addDays,
  type LocalDate,
  type Money,
  NotFoundError,
  newId,
  requirePermission,
  zero,
} from '@portico/kernel';
import type { Booking, Stay } from '../contracts';
import { diffValues } from '../domain/diff';
import type { SegmentState } from '../domain/segments';
import type { BookingStatus, StayStatus } from '../domain/status';
import { addTotals, type RangeTotals, rangeTotals, snapshotHash, zeroTotals } from '../domain/terms';
import { BookingVersionConflictError } from '../errors';
import { RESERVATIONS_PERMISSIONS as P } from '../manifest';
import type { TermsSnapshot } from '../ports';
import type { BookingsTable, OccupantsTable, StaysTable } from '../tables';
import { actorKey, actorName, db, json, parseNights } from './context';

export type BookingRow = Selectable<BookingsTable>;
export type StayRow = Selectable<StaysTable>;
export type OccupantRow = Selectable<OccupantsTable>;

export interface SegmentRecord extends SegmentState {
  id: string;
}

export interface StayRecord {
  row: StayRow;
  segments: SegmentRecord[];
  occupants: OccupantRow[];
}

export interface BookingRecord {
  row: BookingRow;
  stays: StayRecord[];
}

// ───────────────────────────── loading ─────────────────────────────

export async function loadBookingRow(
  tx: TxContext,
  bookingId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<BookingRow> {
  let q = db(tx).selectFrom('reservations.bookings').selectAll().where('id', '=', bookingId);
  if (opts.forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw new NotFoundError('booking', bookingId);
  return row;
}

export async function loadStayRecords(tx: TxContext, stayRows: StayRow[]): Promise<StayRecord[]> {
  if (stayRows.length === 0) return [];
  const ids = stayRows.map((s) => s.id);
  const segs = await db(tx)
    .selectFrom('reservations.stay_segments')
    .selectAll()
    .where('stay_id', 'in', ids)
    .execute();
  const occ = await db(tx)
    .selectFrom('reservations.occupants')
    .selectAll()
    .where('stay_id', 'in', ids)
    .execute();
  return stayRows.map((row) => ({
    row,
    segments: segs
      .filter((s) => s.stay_id === row.id)
      .map((s) => {
        const n = parseNights(s.nights);
        return {
          id: s.id,
          from: n.from,
          to: n.to,
          unitTypeId: s.unit_type_id,
          ratePlanId: s.rate_plan_id,
          occupancy: { adults: s.adults, childrenAges: s.children_ages },
          termsSnapshotId: s.terms_snapshot_id,
          unitId: s.unit_id,
        };
      })
      .sort((a, b) => (a.from < b.from ? -1 : 1)),
    occupants: occ
      .filter((o) => o.stay_id === row.id)
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || (a.id < b.id ? -1 : 1)),
  }));
}

export async function loadBooking(
  tx: TxContext,
  bookingId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<BookingRecord> {
  const row = await loadBookingRow(tx, bookingId, opts);
  const stayRows = await db(tx)
    .selectFrom('reservations.stays')
    .selectAll()
    .where('booking_id', '=', bookingId)
    .orderBy('position')
    .execute();
  return { row, stays: await loadStayRecords(tx, stayRows) };
}

export async function loadStay(tx: TxContext, stayId: string): Promise<StayRecord> {
  const row = await db(tx)
    .selectFrom('reservations.stays')
    .selectAll()
    .where('id', '=', stayId)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('stay', stayId);
  const [rec] = await loadStayRecords(tx, [row]);
  return rec as StayRecord;
}

/** Load a booking the actor may read (permission scoped to the booking's property). */
export async function readableBooking(tx: TxContext, bookingId: string): Promise<BookingRecord> {
  const rec = await loadBooking(tx, bookingId);
  requirePermission(tx, P.bookingRead, { propertyId: rec.row.property_id });
  return rec;
}

export async function loadSnapshots(
  tx: TxContext,
  ids: readonly string[],
): Promise<Map<string, TermsSnapshot>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db(tx)
    .selectFrom('reservations.terms_snapshots')
    .select(['id', 'document'])
    .where('id', 'in', unique)
    .execute();
  return new Map(rows.map((r) => [r.id, r.document as TermsSnapshot]));
}

export function snapshotOf(map: Map<string, TermsSnapshot>, id: string): TermsSnapshot {
  const s = map.get(id);
  if (!s) throw new NotFoundError('terms_snapshot', id);
  return s;
}

// ───────────────────────────── writing ─────────────────────────────

export async function insertSnapshot(
  tx: TxContext,
  input: {
    stayId: string;
    document: TermsSnapshot;
    acceptedVia: 'booking' | 'change' | 'channel' | 'import' | 'quote';
    supersedesId?: string | null;
    changePreview?: string | null;
  },
): Promise<string> {
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('reservations.terms_snapshots')
    .values({
      id,
      tenant_id: tx.tenantId,
      stay_id: input.stayId,
      document: json(input.document),
      hash: snapshotHash(input.document),
      price_source: input.document.priceSource,
      accepted_via: input.acceptedVia,
      accepted_at: tx.now,
      accepted_by: actorKey(tx),
      supersedes_id: input.supersedesId ?? null,
      change_preview: input.changePreview ?? null,
    })
    .execute();
  return id;
}

export async function replaceSegments(
  tx: TxContext,
  stayId: string,
  segments: ReadonlyArray<Omit<SegmentState, never>>,
): Promise<void> {
  await db(tx).deleteFrom('reservations.stay_segments').where('stay_id', '=', stayId).execute();
  for (const s of segments) {
    await db(tx)
      .insertInto('reservations.stay_segments')
      .values({
        id: newId(tx.now.getTime()),
        tenant_id: tx.tenantId,
        stay_id: stayId,
        nights: sql<string>`daterange(${s.from}::date, ${s.to}::date, '[)')`,
        unit_type_id: s.unitTypeId,
        rate_plan_id: s.ratePlanId,
        adults: s.occupancy.adults,
        children_ages: [...s.occupancy.childrenAges],
        terms_snapshot_id: s.termsSnapshotId,
        unit_id: s.unitId,
      })
      .execute();
  }
}

export async function updateStay(
  tx: TxContext,
  stayId: string,
  patch: Partial<{
    status: StayStatus;
    arrival: LocalDate;
    departure: LocalDate;
    hold_id: string | null;
    eta: string | null;
    etd: string | null;
    arrival_details: string;
    requests: string;
    notes: string | null;
    waitlist: string | null;
    early_check_in: string | null;
    late_check_out: string | null;
    no_show: string | null;
    checked_in_at: Date | null;
    checked_out_at: Date | null;
  }>,
): Promise<void> {
  await db(tx)
    .updateTable('reservations.stays')
    .set({ ...patch, updated_at: tx.now, version: sql`version + 1` })
    .where('id', '=', stayId)
    .execute();
}

// ───────────────────────────── versions & concurrency (S14) ─────────────────────────────

/** Comparable state of a booking for "what changed" diffs. */
export function bookingState(rec: BookingRecord): Record<string, unknown> {
  const b = rec.row;
  return {
    status: b.status,
    marketSegment: b.market_segment,
    notes: b.notes,
    specialRequests: b.special_requests,
    tags: b.tags,
    ownerId: b.owner_id,
    optionDate: b.option_date,
    guarantee: b.guarantee,
    externalRefs: b.external_refs,
    stays: rec.stays.map((s) => ({
      id: s.row.id,
      status: s.row.status,
      arrival: s.row.arrival,
      departure: s.row.departure,
      eta: s.row.eta,
      requests: s.row.requests,
      segments: s.segments.map((g) => ({
        from: g.from,
        to: g.to,
        unitTypeId: g.unitTypeId,
        ratePlanId: g.ratePlanId,
        occupancy: g.occupancy,
        unitId: g.unitId,
      })),
    })),
  };
}

async function versionConflict(tx: TxContext, bookingId: string, expected: number, current: number) {
  const rows = await db(tx)
    .selectFrom('reservations.booking_versions')
    .selectAll()
    .where('booking_id', '=', bookingId)
    .where('version', '>=', expected)
    .orderBy('version')
    .execute();
  const base = rows.find((r) => r.version === expected);
  const latest = rows[rows.length - 1];
  const changes = base && latest ? diffValues(base.state, latest.state) : [];
  return new BookingVersionConflictError({
    bookingId,
    expectedVersion: expected,
    currentVersion: current,
    changes,
    changedBy: rows
      .filter((r) => r.version > expected)
      .map((r) => ({
        version: r.version,
        actor: r.actor_name,
        action: r.action,
        at: r.changed_at.toISOString(),
      })),
  });
}

/**
 * Lock the booking row and check the caller's version (If-Match). Done BEFORE any work so that a stale edit never
 * causes side effects. Concurrent commands on one booking serialize on this lock.
 */
export async function lockBooking(
  tx: TxContext,
  bookingId: string,
  expectedVersion: number | null,
): Promise<BookingRow> {
  const row = await loadBookingRow(tx, bookingId, { forUpdate: true });
  if (expectedVersion !== null && row.version !== expectedVersion) {
    throw await versionConflict(tx, bookingId, expectedVersion, row.version);
  }
  return row;
}

/** Bump the booking version after a change (caller holds the row lock) and record the new state. */
export async function bumpBooking(
  tx: TxContext,
  bookingId: string,
  action: string,
  patch: Partial<{
    status: BookingStatus;
    hold_expires_at: Date | null;
    cancellation: string | null;
    option_date: string | null;
  }> = {},
): Promise<BookingRecord> {
  await db(tx)
    .updateTable('reservations.bookings')
    .set({ ...patch, updated_at: tx.now, version: sql`version + 1` })
    .where('id', '=', bookingId)
    .execute();
  const rec = await loadBooking(tx, bookingId);
  await recordVersion(tx, rec, action);
  return rec;
}

export async function recordVersion(tx: TxContext, rec: BookingRecord, action: string): Promise<void> {
  await db(tx)
    .insertInto('reservations.booking_versions')
    .values({
      tenant_id: tx.tenantId,
      booking_id: rec.row.id,
      version: rec.row.version,
      state: json(bookingState(rec)),
      action,
      actor_key: actorKey(tx),
      actor_name: actorName(tx),
      changed_at: tx.now,
    })
    .execute();
}

// ───────────────────────────── views ─────────────────────────────

export function stayTotals(
  stay: StayRecord,
  snapshots: Map<string, TermsSnapshot>,
  currency: string,
): RangeTotals {
  if (stay.segments.length === 0) return zeroTotals(currency);
  return addTotals(
    currency,
    stay.segments.map((s) =>
      rangeTotals(snapshotOf(snapshots, s.termsSnapshotId), { from: s.from, to: s.to }),
    ),
  );
}

/** Unit for the "current" night: the business date for in-house stays, else the arrival night. */
export function currentUnit(stay: StayRecord, businessDate?: LocalDate): string | null {
  const night =
    stay.row.status === 'in_house' && businessDate && businessDate >= stay.row.arrival
      ? businessDate < stay.row.departure
        ? businessDate
        : addDays(stay.row.departure, -1)
      : stay.row.arrival;
  return stay.segments.find((s) => night >= s.from && night < s.to)?.unitId ?? null;
}

const ACTIVE_FOR_TOTALS: ReadonlySet<string> = new Set(['expected', 'in_house', 'departed']);

export function toStayView(
  stay: StayRecord,
  snapshots: Map<string, TermsSnapshot>,
  currency: string,
  businessDate?: LocalDate,
  bookingStatus = 'confirmed',
): Stay {
  const r = stay.row;
  const first = stay.segments.find((s) => s.from <= r.arrival) ?? stay.segments[0];
  return {
    id: r.id,
    bookingId: r.booking_id,
    propertyId: r.property_id,
    status: { stay: r.status as Stay['status']['stay'], booking: bookingStatus as Stay['status']['booking'] },
    commercialType: r.commercial_type as Stay['commercialType'],
    arrival: r.arrival,
    departure: r.departure,
    unitTypeId: first?.unitTypeId ?? '',
    ratePlanId: first?.ratePlanId ?? '',
    occupancy: first ? occ(first.occupancy) : { adults: 1, childrenAges: [] },
    unitId: currentUnit(stay, businessDate),
    blockId: r.block_id,
    segments: stay.segments.map((s) => ({
      id: s.id,
      from: s.from,
      to: s.to,
      unitTypeId: s.unitTypeId,
      ratePlanId: s.ratePlanId,
      occupancy: occ(s.occupancy),
      termsSnapshotId: s.termsSnapshotId,
      unitId: s.unitId,
    })),
    occupants: stay.occupants.map((o) => ({
      id: o.id,
      profileId: o.profile_id,
      name: o.name,
      kind: o.kind as 'adult' | 'child',
      ageAtArrival: o.age_at_arrival,
      primary: o.is_primary,
    })),
    requests: (r.requests ?? []) as Stay['requests'],
    eta: r.eta,
    etd: r.etd,
    arrivalDetails: (r.arrival_details ?? {}) as Record<string, unknown>,
    waitlist: (r.waitlist ?? null) as Stay['waitlist'],
    totals: stayTotals(stay, snapshots, currency),
    checkedInAt: r.checked_in_at?.toISOString() ?? null,
    checkedOutAt: r.checked_out_at?.toISOString() ?? null,
    version: r.version,
    allowedActions: [],
    issues: [],
    links: [],
  };
}

export async function toBookingView(
  tx: TxContext,
  rec: BookingRecord,
  businessDate?: LocalDate,
): Promise<Booking> {
  const b = rec.row;
  const snapshots = await loadSnapshots(
    tx,
    rec.stays.flatMap((s) => s.segments.map((g) => g.termsSnapshotId)),
  );
  const stays = rec.stays.map((s) => toStayView(s, snapshots, b.currency, businessDate, b.status));
  const forwarded = await db(tx)
    .selectFrom('reservations.forwarded_changes')
    .select(['id', 'kind', 'status', 'system_name', 'created_at'])
    .where('booking_id', '=', b.id)
    .where('status', '=', 'pending')
    .execute();
  const counted = stays.filter((s) => ACTIVE_FOR_TOTALS.has(s.status.stay));
  const totals = addTotals(
    b.currency,
    counted.map((s) => s.totals),
  );
  const guarantee = (b.guarantee ?? { kind: 'none' }) as Booking['guarantee'];
  return {
    id: b.id,
    propertyId: b.property_id,
    code: b.code,
    status: { booking: b.status as Booking['status']['booking'] },
    booker: {
      kind: b.booker_kind as Booking['booker']['kind'],
      profileId: b.booker_profile_id,
      companyId: b.company_id,
      agencyId: b.agency_id,
      name: b.booker_name,
    },
    source: b.source as Booking['source'],
    channelConnectionId: b.channel_connection_id,
    externalRefs: (b.external_refs ?? {}) as Record<string, string>,
    marketSegment: b.market_segment,
    commission: (b.commission ?? null) as Booking['commission'],
    guarantee,
    depositRequirement: (b.deposit_requirement ?? null) as Booking['depositRequirement'],
    optionDate: b.option_date,
    holdExpiresAt: b.hold_expires_at?.toISOString() ?? null,
    ownerId: b.owner_id,
    notes: b.notes,
    specialRequests: (b.special_requests ?? []) as string[],
    tags: b.tags,
    currency: b.currency,
    totals,
    stays,
    pendingForwardedChanges: forwarded.map((f) => ({
      id: f.id,
      kind: f.kind,
      status: f.status as 'pending',
      systemName: f.system_name,
      createdAt: f.created_at.toISOString(),
    })),
    createdAt: b.created_at.toISOString(),
    updatedAt: b.updated_at.toISOString(),
    version: b.version,
    allowedActions: [],
    issues: [],
    links: [],
  };
}

/** Contracts use mutable arrays; domain values are readonly. */
export function occ(o: { adults: number; childrenAges: readonly number[] }): {
  adults: number;
  childrenAges: number[];
} {
  return { adults: o.adults, childrenAges: [...o.childrenAges] };
}

export function moneyOrZero(m: Money | null | undefined, currency: string): Money {
  return m ?? zero(currency);
}
