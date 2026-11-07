import { sql, type TxContext } from '@portico/db';
import {
  type DateRange,
  type EntityRef,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import { RESERVATIONS_EVENTS as E } from '../events';
import { RESERVATIONS_PERMISSIONS as P } from '../manifest';
import { actorKey, type Deps, db, json, parseNights } from './context';
import { emitReservationEvent } from './event-payload';
import type { StayRecord } from './repo';

export interface IssueInput {
  propertyId: string;
  kind: string;
  severity: 'urgent' | 'routine';
  bookingId?: string | null;
  stayId?: string | null;
  /** One OPEN issue per dedupe key (re-raising is a no-op). */
  dedupeKey: string;
  message: string;
  ownerId?: string | null;
  details?: Record<string, unknown>;
}

/** Record an exception for the desk / Day Close / handover. Idempotent per open dedupe key. */
export async function raiseIssue(tx: TxContext, input: IssueInput): Promise<string> {
  const id = newId(tx.now.getTime());
  const { rows } = await sql<{ id: string }>`
    insert into reservations.issues
      (id, tenant_id, property_id, kind, severity, booking_id, stay_id, dedupe_key, message, owner_id, details, created_at)
    values (${id}, ${tx.tenantId}, ${input.propertyId}, ${input.kind}, ${input.severity}, ${input.bookingId ?? null},
            ${input.stayId ?? null}, ${input.dedupeKey}, ${input.message}, ${input.ownerId ?? null},
            ${json(input.details ?? {})}::jsonb, ${tx.now})
    on conflict (tenant_id, dedupe_key) where status = 'open' do nothing
    returning id`.execute(tx.db);
  if (rows[0]) return rows[0].id;
  const existing = await db(tx)
    .selectFrom('reservations.issues')
    .select('id')
    .where('dedupe_key', '=', input.dedupeKey)
    .where('status', '=', 'open')
    .executeTakeFirstOrThrow();
  return existing.id;
}

export async function resolveIssue(
  tx: TxContext,
  input: { issueId: string; resolution: string },
): Promise<void> {
  const row = await db(tx)
    .selectFrom('reservations.issues')
    .selectAll()
    .where('id', '=', input.issueId)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('issue', input.issueId);
  requirePermission(tx, P.bookingUpdate, { propertyId: row.property_id });
  if (row.status === 'resolved') return;
  await db(tx)
    .updateTable('reservations.issues')
    .set({
      status: 'resolved',
      resolved_at: tx.now,
      resolved_by: actorKey(tx),
      resolution: input.resolution,
      version: sql`version + 1`,
    })
    .where('id', '=', input.issueId)
    .execute();
  await tx.audit({
    action: 'reservations.issue.resolve',
    target: { type: 'issue', id: input.issueId },
    propertyId: row.property_id,
    reason: input.resolution,
  });
}

export async function listIssues(tx: TxContext, input: { propertyId: string; status?: 'open' | 'resolved' }) {
  requirePermission(tx, P.bookingRead, { propertyId: input.propertyId });
  const rows = await db(tx)
    .selectFrom('reservations.issues')
    .selectAll()
    .where('property_id', '=', input.propertyId)
    .where('status', '=', input.status ?? 'open')
    .orderBy('created_at', 'desc')
    .limit(500)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    propertyId: r.property_id,
    kind: r.kind,
    severity: r.severity as 'urgent' | 'routine',
    bookingId: r.booking_id,
    stayId: r.stay_id,
    message: r.message,
    ownerId: r.owner_id,
    status: r.status as 'open' | 'resolved',
    details: (r.details ?? {}) as Record<string, unknown>,
    createdAt: r.created_at.toISOString(),
  }));
}

// ───────────────────────────── relocation (RES-R34) ─────────────────────────────

export interface RelocationOption {
  kind: 'same_type_other_unit' | 'upgrade' | 'other_type' | 'external_hotel';
  label: string;
  unitId: string | null;
  unitTypeId: string | null;
}

/** Ranked relocation options: another unit of the same type, a higher-ranked type, then an external hotel. */
export async function relocationOptions(
  deps: Deps,
  tx: TxContext,
  input: { propertyId: string; unitTypeId: string; nights: DateRange; excludeUnitIds?: string[] },
): Promise<RelocationOption[]> {
  const { inventory } = deps.ports;
  const options: RelocationOption[] = [];
  const same = await inventory.findAssignableUnits(tx, {
    propertyId: input.propertyId,
    unitTypeId: input.unitTypeId,
    nights: input.nights,
  });
  for (const c of same
    .filter((u) => u.assignable && !(input.excludeUnitIds ?? []).includes(u.unitId))
    .slice(0, 3)) {
    options.push({
      kind: 'same_type_other_unit',
      label: `Move to ${c.name}`,
      unitId: c.unitId,
      unitTypeId: c.unitTypeId,
    });
  }
  const types = await inventory.listUnitTypes(tx, { propertyId: input.propertyId });
  const current = types.find((t) => t.id === input.unitTypeId);
  const others = types
    .filter((t) => t.id !== input.unitTypeId)
    .sort((a, b) => (current ? Math.abs(a.rank - current.rank) - Math.abs(b.rank - current.rank) : 0));
  for (const t of others) {
    const units = await inventory.findAssignableUnits(tx, {
      propertyId: input.propertyId,
      unitTypeId: t.id,
      nights: input.nights,
    });
    const u = units.find((x) => x.assignable);
    if (!u) continue;
    const upgrade = current ? t.rank > current.rank : false;
    options.push({
      kind: upgrade ? 'upgrade' : 'other_type',
      label: `${upgrade ? 'Upgrade' : 'Move'} to ${t.name} (${u.name})`,
      unitId: u.unitId,
      unitTypeId: t.id,
    });
    if (options.length >= 6) break;
  }
  options.push({
    kind: 'external_hotel',
    label: 'Relocate to another hotel (arrange externally)',
    unitId: null,
    unitTypeId: null,
  });
  return options;
}

/** Open a relocation case for a stay affected by an inventory conflict or a unit block. Idempotent per cause. */
export async function openRelocationCase(
  deps: Deps,
  tx: TxContext,
  input: {
    stay: StayRecord;
    cause: 'inventory_conflict' | 'out_of_order' | 'assignment_conflict';
    nights: DateRange;
    causeRef?: EntityRef | Record<string, unknown>;
    ownerId?: string | null;
  },
): Promise<string> {
  const stay = input.stay;
  const seg =
    stay.segments.find((s) => input.nights.from >= s.from && input.nights.from < s.to) ?? stay.segments[0];
  const options = seg
    ? await relocationOptions(deps, tx, {
        propertyId: stay.row.property_id,
        unitTypeId: seg.unitTypeId,
        nights: input.nights,
        excludeUnitIds: seg.unitId ? [seg.unitId] : [],
      })
    : [];
  const id = newId(tx.now.getTime());
  const { rows } = await sql<{ id: string }>`
    insert into reservations.relocation_cases
      (id, tenant_id, property_id, stay_id, booking_id, cause, cause_ref, nights, options, owner_id, created_at, updated_at)
    values (${id}, ${tx.tenantId}, ${stay.row.property_id}, ${stay.row.id}, ${stay.row.booking_id}, ${input.cause},
            ${json(input.causeRef ?? null)}::jsonb, daterange(${input.nights.from}::date, ${input.nights.to}::date, '[)'),
            ${json(options)}::jsonb, ${input.ownerId ?? null}, ${tx.now}, ${tx.now})
    on conflict (tenant_id, stay_id, cause) where status in ('open', 'option_selected') do nothing
    returning id`.execute(tx.db);
  if (!rows[0]) {
    const existing = await db(tx)
      .selectFrom('reservations.relocation_cases')
      .select('id')
      .where('stay_id', '=', stay.row.id)
      .where('cause', '=', input.cause)
      .where('status', 'in', ['open', 'option_selected'])
      .executeTakeFirstOrThrow();
    return existing.id;
  }
  await tx.audit({
    action: 'reservations.relocation.open',
    target: { type: 'relocation_case', id },
    propertyId: stay.row.property_id,
    after: { stayId: stay.row.id, cause: input.cause, nights: input.nights, options: options.length },
  });
  await emitReservationEvent(tx, {
    type: E.stayRelocationRequired,
    propertyId: stay.row.property_id,
    aggregate: { type: 'stay', id: stay.row.id },
    payload: {
      stayId: stay.row.id,
      bookingId: stay.row.booking_id,
      relocationCaseId: id,
      cause: input.cause,
      nights: input.nights,
    },
  });
  return id;
}

export async function listRelocationCases(tx: TxContext, input: { propertyId: string; status?: string }) {
  requirePermission(tx, P.bookingRead, { propertyId: input.propertyId });
  let q = db(tx)
    .selectFrom('reservations.relocation_cases')
    .selectAll()
    .where('property_id', '=', input.propertyId)
    .orderBy('created_at', 'desc');
  q = input.status
    ? q.where('status', '=', input.status)
    : q.where('status', 'in', ['open', 'option_selected']);
  const rows = await q.execute();
  return rows.map((r) => ({
    id: r.id,
    propertyId: r.property_id,
    stayId: r.stay_id,
    bookingId: r.booking_id,
    cause: r.cause,
    nights: parseNights(r.nights),
    options: (r.options ?? []) as RelocationOption[],
    status: r.status as 'open' | 'option_selected' | 'completed' | 'cancelled',
    ownerId: r.owner_id,
    createdAt: r.created_at.toISOString(),
    version: r.version,
  }));
}

/** Close a relocation case after the chosen option was carried out (e.g. a committed move preview). */
export async function resolveRelocationCase(
  tx: TxContext,
  input: { caseId: string; outcome: 'completed' | 'cancelled'; note: string; selectedOption?: number },
): Promise<void> {
  const row = await db(tx)
    .selectFrom('reservations.relocation_cases')
    .selectAll()
    .where('id', '=', input.caseId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw new NotFoundError('relocation_case', input.caseId);
  requirePermission(tx, P.relocationManage, { propertyId: row.property_id });
  if (row.status === 'completed' || row.status === 'cancelled') {
    throw new ValidationError('relocation_closed', `This relocation case is already ${row.status}.`);
  }
  const options = (row.options ?? []) as RelocationOption[];
  const selected = input.selectedOption !== undefined ? (options[input.selectedOption] ?? null) : null;
  await db(tx)
    .updateTable('reservations.relocation_cases')
    .set({
      status: input.outcome,
      selected: json(selected ? { ...selected, note: input.note } : { note: input.note }),
      resolved_at: tx.now,
      updated_at: tx.now,
      version: sql`version + 1`,
    })
    .where('id', '=', input.caseId)
    .execute();
  await tx.audit({
    action: `reservations.relocation.${input.outcome}`,
    target: { type: 'relocation_case', id: input.caseId },
    propertyId: row.property_id,
    reason: input.note,
    after: { selected },
  });
}
