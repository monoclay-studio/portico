import { sql, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  type DateRange,
  type EntityRef,
  ForbiddenError,
  type LocalDate,
  NotFoundError,
  newId,
  ValidationError,
} from '@portico/kernel';
import type { Hold } from '../contracts';
import { nightsOfRange, nightsToRuns, spanOf } from '../domain/ranges';
import { InventoryUnavailableError } from '../errors';
import { INVENTORY_EVENTS } from '../events';
import { INVENTORY_PERMISSIONS } from '../manifest';
import { placeAssignment } from './assignment-store';
import { type ConsumeResult, consumeNights, pickCompositeUnit } from './consumption';
import {
  actorKey,
  assertQuantity,
  assertRef,
  assertUuid,
  type Deps,
  guardAvailabilityWrite,
  idb,
  iso,
  isoRequired,
  type WriteOptions,
} from './context';
import { LedgerSession, nightsOf, requireType } from './ledger';
import { loadUnits } from './occupancy';

/** Absolute ceiling for a hold (group options can be long). Beyond this, book tentatively. */
export const MAX_HOLD_DAYS = 180;
/** Policy key (platform policies, inheritable) for how long a hold may last without extra permission. */
export const HOLD_POLICY_KEY = 'inventory.hold.maxDays';
const DEFAULT_POLICY_MAX_DAYS = 14;

/**
 * INV-R15/R17: holds up to the property's policy maximum (default 14 days, spec "tentative option up to 14 days")
 * need nothing more; longer holds (up to the 180-day ceiling) need `inventory.availability.manage`.
 */
async function assertHoldDuration(
  deps: Deps,
  tx: TxContext,
  propertyId: string,
  expiresAt: Date,
): Promise<void> {
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= tx.now.getTime()) {
    throw new ValidationError('invalid_hold_expiry', 'A hold must expire in the future.');
  }
  const ms = expiresAt.getTime() - tx.now.getTime();
  if (ms > MAX_HOLD_DAYS * 86_400_000) {
    throw new ValidationError(
      'hold_too_long',
      `Holds can last at most ${MAX_HOLD_DAYS} days. Make a tentative booking with an option date instead.`,
    );
  }
  const policy = await deps.ports.platform.resolvePolicy<number>(
    tx,
    propertyId,
    HOLD_POLICY_KEY,
    DEFAULT_POLICY_MAX_DAYS,
  );
  const maxDays =
    typeof policy.value === 'number' && policy.value > 0 ? policy.value : DEFAULT_POLICY_MAX_DAYS;
  if (ms > maxDays * 86_400_000 && !tx.authz.can(INVENTORY_PERMISSIONS.availabilityManage, { propertyId })) {
    throw new ForbiddenError(INVENTORY_PERMISSIONS.availabilityManage, {
      propertyId,
      policyMaxDays: maxDays,
    });
  }
}

interface HoldSqlRow {
  id: string;
  property_id: string;
  unit_type_id: string;
  from: string;
  to: string;
  quantity: number;
  component_quantities: Array<{ unitTypeId: string; quantity: number }>;
  ref_type: string;
  ref_id: string;
  status: Hold['status'];
  expires_at: Date;
  created_by: string;
  created_at: Date;
  closed_at: Date | null;
  close_reason: string | null;
  converted_ref_type: string | null;
  converted_ref_id: string | null;
  version: number;
}

const HOLD_COLUMNS = sql`id, property_id, unit_type_id, lower(nights)::text as from, upper(nights)::text as to,
  quantity, component_quantities, ref_type, ref_id, status, expires_at, created_by, created_at, closed_at,
  close_reason, converted_ref_type, converted_ref_id, version`;

export function toHold(r: HoldSqlRow): Hold {
  return {
    id: r.id,
    propertyId: r.property_id,
    unitTypeId: r.unit_type_id,
    nights: { from: r.from, to: r.to },
    quantity: r.quantity,
    ref: { type: r.ref_type, id: r.ref_id },
    status: r.status,
    expiresAt: isoRequired(r.expires_at),
    createdBy: r.created_by,
    createdAt: isoRequired(r.created_at),
    closedAt: iso(r.closed_at),
    closeReason: r.close_reason,
    version: r.version,
  };
}

async function loadHold(tx: TxContext, holdId: string, forUpdate = false): Promise<HoldSqlRow> {
  assertUuid(holdId, 'inventory_hold');
  const { rows } = await sql<HoldSqlRow>`select ${HOLD_COLUMNS} from inventory.holds where id = ${holdId}
    ${forUpdate ? sql`for update` : sql``}`.execute(tx.db);
  const row = rows[0];
  if (!row) throw new NotFoundError('inventory_hold', holdId);
  return row;
}

export async function getHold(tx: TxContext, holdId: string): Promise<Hold> {
  return toHold(await loadHold(tx, holdId));
}

/** Active, unexpired holds touching a cell (for explanations). */
export async function listActiveHolds(
  tx: TxContext,
  filter: { propertyId: string; unitTypeId?: string; span: DateRange },
): Promise<Hold[]> {
  const { rows } = await sql<HoldSqlRow>`
    select ${HOLD_COLUMNS} from inventory.holds
    where property_id = ${filter.propertyId} and status = 'active' and expires_at > ${tx.now}
      and nights && daterange(${filter.span.from}::date, ${filter.span.to}::date, '[)')
      ${filter.unitTypeId ? sql`and (unit_type_id = ${filter.unitTypeId} or exists (select 1 from jsonb_array_elements(component_quantities) e where (e->>'unitTypeId')::uuid = ${filter.unitTypeId}::uuid))` : sql``}
    order by expires_at`.execute(tx.db);
  return rows.map(toHold);
}

export interface CreateHoldInput {
  propertyId: string;
  unitTypeId: string;
  nights: DateRange;
  quantity: number;
  expiresAt: Date | string;
  ref: EntityRef;
}

/**
 * Temporarily claim inventory (quote, cart, tentative option). Counts in `held` until converted, released or
 * expired. A hold on a composite type also holds k units of each component type, so component sales can never
 * make it unconvertible.
 */
export async function createHold(
  deps: Deps,
  tx: TxContext,
  input: CreateHoldInput,
  opts: WriteOptions = {},
): Promise<{ holdId: string; expiresAt: string }> {
  const ref = assertRef(input.ref);
  const quantity = assertQuantity(input.quantity);
  const nights = nightsOfRange(input.nights);
  const expiresAt = new Date(input.expiresAt);
  const type = await requireType(tx, input.unitTypeId, input.propertyId);
  await assertHoldDuration(deps, tx, input.propertyId, expiresAt);
  if (type.status === 'archived') {
    throw new BusinessRuleError('unit_type_archived', `${type.name} is archived and can no longer be sold.`);
  }
  await guardAvailabilityWrite(tx, deps, input.propertyId, opts.origin);
  const session = await LedgerSession.open(
    tx,
    input.propertyId,
    nights.map((night) => ({ unitTypeId: type.id, night })),
  );
  const st = session.composites.get(type.id);
  let available: Array<{ date: LocalDate; available: number }>;
  if (st) {
    const state = await session.compositeState(type.id, nights);
    available = nights.map((n) => ({ date: n, available: state.get(n)?.availability.available ?? 0 }));
  } else {
    available = nights.map((n) => ({ date: n, available: session.available(type.id, n) }));
  }
  const short = available.filter((x) => x.available < quantity);
  if (short.length > 0) {
    throw new InventoryUnavailableError({
      unitTypeId: type.id,
      unitTypeName: type.name,
      requested: quantity,
      shortNights: short,
    });
  }
  const components = st
    ? [...st.perType].map(([unitTypeId, k]) => ({ unitTypeId, quantity: k * quantity }))
    : [];
  for (const n of nights) {
    session.adjust(type.id, n, { held: quantity });
    for (const c of components) session.adjust(c.unitTypeId, n, { held: c.quantity });
  }
  const holdId = newId();
  await sql`
    insert into inventory.holds (id, tenant_id, property_id, unit_type_id, nights, quantity, component_quantities,
                                 ref_type, ref_id, status, expires_at, created_by, created_at)
    values (${holdId}, ${tx.tenantId}, ${input.propertyId}, ${type.id},
            daterange(${input.nights.from}::date, ${input.nights.to}::date, '[)'), ${quantity},
            ${JSON.stringify(components)}::jsonb, ${ref.type}, ${ref.id}, 'active', ${expiresAt}, ${actorKey(tx)},
            ${tx.now})`.execute(tx.db);
  await session.finish({ kind: 'hold', ref });
  return { holdId, expiresAt: expiresAt.toISOString() };
}

/**
 * Turn a hold into consumption for `ref` (hold → booking). Net availability does not change. An expired hold is
 * released first and the conversion is tried as a fresh sale, which fails clearly if the inventory is gone.
 */
export async function convertHold(
  deps: Deps,
  tx: TxContext,
  input: { holdId: string; ref: EntityRef },
  opts: WriteOptions = {},
): Promise<ConsumeResult & { holdId: string }> {
  const ref = assertRef(input.ref);
  const hold = await loadHold(tx, input.holdId);
  if (hold.status === 'converted') {
    if (hold.converted_ref_type === ref.type && hold.converted_ref_id === ref.id) {
      return {
        holdId: hold.id,
        applied: false,
        nights: [],
        overbookingAllowanceIds: [],
        conflictIds: [],
        assignedUnitId: null,
      };
    }
    throw new BusinessRuleError(
      'hold_already_converted',
      'This hold was already converted into another booking. Check availability and book again.',
      { holdId: hold.id },
    );
  }
  if (hold.status === 'released') {
    throw new BusinessRuleError(
      'hold_not_active',
      `This hold was released at ${iso(hold.closed_at)}. Check availability and book again.`,
      { holdId: hold.id, status: hold.status },
    );
  }
  // An expired hold (already released lazily by another command) continues below: the booking is tried as a fresh
  // sale under lock and fails with a clear "hold expired and the unit was sold" if the inventory is gone.
  const type = await requireType(tx, hold.unit_type_id);
  const nights = nightsOf(hold.from, hold.to);
  await guardAvailabilityWrite(tx, deps, hold.property_id, opts.origin);
  const session = await LedgerSession.open(
    tx,
    hold.property_id,
    nights.map((night) => ({ unitTypeId: type.id, night })),
  );
  const locked = await loadHold(tx, hold.id, true);
  // Decide on the status as it is under the lock: a concurrent conversion or release that committed while we
  // waited must never turn this call into a second sale (one hold → at most one booking).
  if (locked.status === 'converted') {
    if (locked.converted_ref_type === ref.type && locked.converted_ref_id === ref.id) {
      return {
        holdId: hold.id,
        applied: false,
        nights: [],
        overbookingAllowanceIds: [],
        conflictIds: [],
        assignedUnitId: null,
      };
    }
    throw new BusinessRuleError(
      'hold_already_converted',
      'This hold was already converted into another booking. Check availability and book again.',
      { holdId: hold.id },
    );
  }
  if (locked.status === 'released') {
    throw new BusinessRuleError(
      'hold_not_active',
      `This hold was released at ${iso(locked.closed_at)}. Check availability and book again.`,
      { holdId: hold.id, status: locked.status },
    );
  }
  const already = await idb(tx)
    .selectFrom('inventory.consumptions')
    .select('night')
    .where('ref_type', '=', ref.type)
    .where('ref_id', '=', ref.id)
    .where('unit_type_id', '=', type.id)
    .where('night', 'in', nights)
    .execute();
  if (already.length > 0) {
    throw new ConflictError(
      'consumption_mismatch',
      `${ref.type} ${ref.id} already consumes ${type.name} on ${already.map((a) => a.night).join(', ')}; a hold cannot be converted onto nights the booking already holds. Release the hold instead.`,
      { ref, holdId: hold.id },
    );
  }
  if (locked.status === 'expired') {
    // Expired while we were locking (lazy expiry, INV-I09): try a fresh sale of the same inventory.
    try {
      const r = await consumeNights(deps, tx, {
        propertyId: hold.property_id,
        type,
        nights,
        quantity: hold.quantity,
        ref,
        kind: 'stay',
        overbooking: undefined,
        onShortfall: 'reject',
        causeKind: 'consumption',
      });
      return { ...r, holdId: hold.id };
    } catch (err) {
      if (err instanceof InventoryUnavailableError) {
        throw new InventoryUnavailableError({
          unitTypeId: type.id,
          unitTypeName: type.name,
          requested: hold.quantity,
          shortNights: err.shortNights,
          reason: 'hold_expired_sold',
        });
      }
      throw err;
    }
  }

  const st = session.composites.get(type.id);
  let assignedUnitId: string | null = null;
  if (st) {
    if (hold.quantity !== 1) {
      throw new BusinessRuleError(
        'composite_quantity_one',
        `${type.name} is sold one per stay; convert this hold with quantity 1 per ref.`,
      );
    }
    const unit = await pickCompositeUnit(tx, session, type.id, nights, ref);
    if (!unit) {
      throw new InventoryUnavailableError({
        unitTypeId: type.id,
        unitTypeName: type.name,
        requested: 1,
        shortNights: [],
        reason: 'hold_not_convertible',
      });
    }
    assignedUnitId = unit.unit.id;
  }
  const rows: Array<{ unitTypeId: string; night: LocalDate; quantity: number; parent: string | null }> = [];
  for (const n of nights) {
    session.adjust(type.id, n, { held: -hold.quantity, sold: hold.quantity });
    rows.push({ unitTypeId: type.id, night: n, quantity: hold.quantity, parent: null });
    for (const c of hold.component_quantities) {
      session.adjust(c.unitTypeId, n, { held: -c.quantity, sold: c.quantity });
      rows.push({ unitTypeId: c.unitTypeId, night: n, quantity: c.quantity, parent: type.id });
    }
  }
  await idb(tx)
    .insertInto('inventory.consumptions')
    .values(
      rows.map((r) => ({
        id: newId(),
        tenant_id: tx.tenantId,
        property_id: hold.property_id,
        ref_type: ref.type,
        ref_id: ref.id,
        unit_type_id: r.unitTypeId,
        night: r.night,
        quantity: r.quantity,
        kind: r.parent ? ('composite_component' as const) : ('stay' as const),
        parent_unit_type_id: r.parent,
        hold_id: hold.id,
        overbooking_allowance_id: null,
        created_at: tx.now,
      })),
    )
    .execute();
  if (assignedUnitId) {
    const [unit] = await loadUnits(tx, { ids: [assignedUnitId] });
    if (unit) {
      for (const run of nightsToRuns(nights)) {
        await placeAssignment(tx, {
          propertyId: hold.property_id,
          unit,
          ref,
          range: run,
          locked: false,
          lockReason: null,
          upgrade: null,
          createdBy: actorKey(tx),
        });
      }
      session.touchComposite(type.id, nights);
    }
  }
  await sql`update inventory.holds set status = 'converted', closed_at = ${tx.now}, close_reason = 'Converted',
              converted_ref_type = ${ref.type}, converted_ref_id = ${ref.id}, version = version + 1
            where id = ${hold.id}`.execute(tx.db);
  const conflicts = await session.finish({ kind: 'consumption', ref });
  if (assignedUnitId) {
    await tx.emit({
      type: INVENTORY_EVENTS.assignmentChanged,
      propertyId: hold.property_id,
      aggregate: { type: ref.type, id: ref.id },
      payload: {
        propertyId: hold.property_id,
        ref,
        change: 'assigned',
        unitId: assignedUnitId,
        previousUnitIds: [],
        nights: spanOf(nights),
      },
    });
  }
  return {
    holdId: hold.id,
    applied: true,
    nights,
    overbookingAllowanceIds: [],
    conflictIds: conflicts.created,
    assignedUnitId,
  };
}

/** Release a hold before it expires (quote abandoned, option declined). Idempotent. */
export async function releaseHold(
  deps: Deps,
  tx: TxContext,
  input: { holdId: string; reason?: string },
  opts: WriteOptions = {},
): Promise<{ released: boolean }> {
  const hold = await loadHold(tx, input.holdId);
  if (hold.status !== 'active') return { released: false };
  await guardAvailabilityWrite(tx, deps, hold.property_id, opts.origin);
  const nights = nightsOf(hold.from, hold.to);
  const session = await LedgerSession.open(
    tx,
    hold.property_id,
    nights.map((night) => ({ unitTypeId: hold.unit_type_id, night })),
  );
  const locked = await loadHold(tx, hold.id, true);
  if (locked.status !== 'active') return { released: false };
  for (const n of nights) {
    session.adjust(hold.unit_type_id, n, { held: -hold.quantity });
    for (const c of hold.component_quantities) session.adjust(c.unitTypeId, n, { held: -c.quantity });
  }
  await sql`update inventory.holds set status = 'released', closed_at = ${tx.now},
              close_reason = ${input.reason ?? 'Released'}, version = version + 1 where id = ${hold.id}`.execute(
    tx.db,
  );
  await session.finish({ kind: 'hold_closed', ref: { type: hold.ref_type, id: hold.ref_id } });
  return { released: true };
}

/** Move a hold's expiry (e.g. extend a tentative option). Only active, unexpired holds can be extended. */
export async function extendHold(
  deps: Deps,
  tx: TxContext,
  input: { holdId: string; expiresAt: Date | string },
  opts: WriteOptions = {},
): Promise<Hold> {
  const hold = await loadHold(tx, input.holdId, true);
  await guardAvailabilityWrite(tx, deps, hold.property_id, opts.origin);
  const expiresAt = new Date(input.expiresAt);
  if (hold.status !== 'active' || hold.expires_at.getTime() <= tx.now.getTime()) {
    throw new BusinessRuleError(
      'hold_not_active',
      'This hold is no longer active (it expired, was released or converted). Create a new hold if inventory is still available.',
      { holdId: hold.id },
    );
  }
  await assertHoldDuration(deps, tx, hold.property_id, expiresAt);
  await sql`update inventory.holds set expires_at = ${expiresAt}, version = version + 1 where id = ${hold.id}`.execute(
    tx.db,
  );
  await tx.audit({
    action: 'inventory.hold.extend',
    target: { type: 'inventoryHold', id: hold.id },
    propertyId: hold.property_id,
    before: { expiresAt: isoRequired(hold.expires_at) },
    after: { expiresAt: expiresAt.toISOString() },
  });
  return getHold(tx, hold.id);
}

/**
 * Sweeper (INV-R16): release holds that expired, in this organization. Lazy expiry already guarantees expired
 * holds never block a sale; this keeps the grid tidy and emits `inventory.hold.expired` promptly.
 */
export async function expireDueHolds(
  _deps: Deps,
  tx: TxContext,
  opts: { limit?: number } = {},
): Promise<{ expired: number }> {
  const { rows } = await sql<{
    id: string;
    property_id: string;
    unit_type_id: string;
    from: string;
    to: string;
  }>`
    select id, property_id, unit_type_id, lower(nights)::text as from, upper(nights)::text as to
    from inventory.holds where status = 'active' and expires_at <= ${tx.now}
    order by expires_at limit ${opts.limit ?? 100}`.execute(tx.db);
  let expired = 0;
  for (const h of rows) {
    await LedgerSession.open(
      tx,
      h.property_id,
      nightsOf(h.from, h.to).map((night) => ({ unitTypeId: h.unit_type_id, night })),
    );
    const after = await loadHold(tx, h.id);
    if (after.status === 'expired') expired++;
  }
  return { expired };
}

/**
 * Sweeper (INV-I03): expire overbooking allowances that lapsed in this organization. Opening the ledger session on
 * their cells expires them and reconciles conflicts, so a night left sold beyond authorization gets its open
 * conflict (owner, causes, event) even if nobody touches it.
 */
export async function expireDueAllowances(
  _deps: Deps,
  tx: TxContext,
  opts: { limit?: number } = {},
): Promise<{ expired: number }> {
  const { rows } = await sql<{ id: string; property_id: string; unit_type_id: string; night: string }>`
    select id, property_id, unit_type_id, night::text as night from inventory.overbooking_allowances
    where status = 'active' and expires_at is not null and expires_at <= ${tx.now}
    order by property_id, unit_type_id, night limit ${opts.limit ?? 500}`.execute(tx.db);
  const byProperty = new Map<string, Array<{ unitTypeId: string; night: string }>>();
  for (const r of rows) {
    byProperty.set(r.property_id, [
      ...(byProperty.get(r.property_id) ?? []),
      { unitTypeId: r.unit_type_id, night: r.night },
    ]);
  }
  for (const [propertyId, cells] of byProperty) await LedgerSession.open(tx, propertyId, cells);
  const { rows: left } = await sql<{ n: number }>`
    select count(*)::int as n from inventory.overbooking_allowances
    where id = any(${rows.map((r) => r.id)}::uuid[]) and status = 'expired'`.execute(tx.db);
  return { expired: left[0]?.n ?? 0 };
}
