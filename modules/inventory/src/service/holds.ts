import { sql, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  type DateRange,
  type EntityRef,
  type LocalDate,
  NotFoundError,
  newId,
  ValidationError,
} from '@portico/kernel';
import type { Hold } from '../contracts';
import { nightsOfRange, nightsToRuns, spanOf } from '../domain/ranges';
import { InventoryUnavailableError } from '../errors';
import { INVENTORY_EVENTS } from '../events';
import { placeAssignment } from './assignment-store';
import { type ConsumeResult, consumeNights, pickCompositeUnit } from './consumption';
import { actorKey, assertQuantity, assertRef, assertUuid, type Deps, idb, iso, isoRequired } from './context';
import { LedgerSession, nightsOf, requireType } from './ledger';
import { loadUnits } from './occupancy';

/** Longest hold (group options can be long; quotes and carts are minutes). Beyond this, book tentatively. */
export const MAX_HOLD_DAYS = 180;

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
  _deps: Deps,
  tx: TxContext,
  input: CreateHoldInput,
): Promise<{ holdId: string; expiresAt: string }> {
  const ref = assertRef(input.ref);
  const quantity = assertQuantity(input.quantity);
  const nights = nightsOfRange(input.nights);
  const expiresAt = new Date(input.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= tx.now.getTime()) {
    throw new ValidationError('invalid_hold_expiry', 'A hold must expire in the future.');
  }
  if (expiresAt.getTime() - tx.now.getTime() > MAX_HOLD_DAYS * 86_400_000) {
    throw new ValidationError(
      'hold_too_long',
      `Holds can last at most ${MAX_HOLD_DAYS} days. Make a tentative booking with an option date instead.`,
    );
  }
  const type = await requireType(tx, input.unitTypeId, input.propertyId);
  if (type.status === 'archived') {
    throw new BusinessRuleError('unit_type_archived', `${type.name} is archived and can no longer be sold.`);
  }
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
  if (hold.status !== 'active') {
    throw new BusinessRuleError(
      'hold_not_active',
      `This hold was ${hold.status} at ${iso(hold.closed_at)}. Check availability and book again.`,
      { holdId: hold.id, status: hold.status },
    );
  }
  const type = await requireType(tx, hold.unit_type_id);
  const nights = nightsOf(hold.from, hold.to);
  const session = await LedgerSession.open(
    tx,
    hold.property_id,
    nights.map((night) => ({ unitTypeId: type.id, night })),
  );
  const locked = await loadHold(tx, hold.id, true);
  if (locked.status !== 'active') {
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
          reason: 'hold_not_convertible',
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
  _deps: Deps,
  tx: TxContext,
  input: { holdId: string; reason?: string },
): Promise<{ released: boolean }> {
  const hold = await loadHold(tx, input.holdId);
  if (hold.status !== 'active') return { released: false };
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
  _deps: Deps,
  tx: TxContext,
  input: { holdId: string; expiresAt: Date | string },
): Promise<Hold> {
  const hold = await loadHold(tx, input.holdId, true);
  const expiresAt = new Date(input.expiresAt);
  if (hold.status !== 'active' || hold.expires_at.getTime() <= tx.now.getTime()) {
    throw new BusinessRuleError(
      'hold_not_active',
      'This hold is no longer active (it expired, was released or converted). Create a new hold if inventory is still available.',
      { holdId: hold.id },
    );
  }
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= tx.now.getTime()) {
    throw new ValidationError('invalid_hold_expiry', 'A hold must expire in the future.');
  }
  if (expiresAt.getTime() - tx.now.getTime() > MAX_HOLD_DAYS * 86_400_000) {
    throw new ValidationError('hold_too_long', `Holds can last at most ${MAX_HOLD_DAYS} days.`);
  }
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
