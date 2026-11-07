import { explainVersionMiss, sql, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  type DateRange,
  type LocalDate,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { InventoryConflict, OverbookingAllowance, OverbookingAllowanceInput } from '../contracts';
import { availableOf } from '../domain/availability';
import { nightsOfRange } from '../domain/ranges';
import { INVENTORY_EVENTS } from '../events';
import { INVENTORY_PERMISSIONS } from '../manifest';
import type { ConflictsTable, OverbookingAllowancesTable } from '../tables';
import {
  actorKey,
  actorName,
  assertUuid,
  type ChangeOrigin,
  type Deps,
  guardAvailabilityWrite,
  idb,
  iso,
  isoRequired,
  requireAnyPermission,
} from './context';
import { LedgerSession, requireType } from './ledger';

type AllowanceRow = Omit<OverbookingAllowancesTable, 'status'> & { status: OverbookingAllowance['status'] };

export function toAllowance(r: AllowanceRow): OverbookingAllowance {
  return {
    id: r.id,
    propertyId: r.property_id,
    unitTypeId: r.unit_type_id,
    night: r.night,
    quantity: r.quantity,
    kind: r.kind,
    reason: r.reason,
    authorizedBy: r.authorized_by,
    enteredBy: r.entered_by,
    ref: r.ref_type && r.ref_id ? { type: r.ref_type, id: r.ref_id } : null,
    expiresAt: iso(r.expires_at),
    status: r.status,
    createdAt: isoRequired(r.created_at),
  };
}

/**
 * Set the standing authorized-overbooking allowance for a unit type over some nights (INV-R26). Sensitive: needs
 * inventory.overbooking.authorize, records who and why, and is labelled "authorized overbooking" everywhere, so it
 * is never confused with an inventory conflict. Lowering an allowance below what is already sold into it is
 * refused (resolve those sales first). Composite types cannot be overbooked (they are sold with a specific unit).
 */
export async function setOverbookingAllowance(
  deps: Deps,
  tx: TxContext,
  propertyId: string,
  input: OverbookingAllowanceInput,
  opts: { origin?: ChangeOrigin } = {},
): Promise<{ allowances: OverbookingAllowance[]; conflictsResolved: string[] }> {
  requirePermission(tx, INVENTORY_PERMISSIONS.overbookingAuthorize, { propertyId });
  const nights = nightsOfRange(input.nights, 400);
  const reason = input.reason?.trim() ?? '';
  if (reason.length < 3)
    throw new ValidationError('overbooking_reason_required', 'Say why overbooking is authorized.');
  if (!Number.isInteger(input.quantity) || input.quantity < 0 || input.quantity > 100) {
    throw new ValidationError('invalid_quantity', 'The allowance must be a whole number from 0 to 100.');
  }
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() <= tx.now.getTime()) {
    throw new ValidationError('invalid_expiry', 'The allowance must expire in the future (or not at all).');
  }
  const type = await requireType(tx, input.unitTypeId, propertyId);
  if (type.isComposite) {
    throw new BusinessRuleError(
      'composite_overbooking_not_permitted',
      `${type.name} combines several units and is sold with a specific unit, so it cannot be overbooked. Authorize overbooking on its component types instead.`,
    );
  }
  await guardAvailabilityWrite(tx, deps, propertyId, opts.origin);
  const session = await LedgerSession.open(
    tx,
    propertyId,
    nights.map((night) => ({ unitTypeId: type.id, night })),
  );
  const current = await idb(tx)
    .selectFrom('inventory.overbooking_allowances')
    .selectAll()
    .where('unit_type_id', '=', type.id)
    .where('night', 'in', nights)
    .where('kind', '=', 'standing')
    .where('status', '=', 'active')
    .forUpdate()
    .execute();
  const byNight = new Map(current.map((c) => [c.night, c]));
  const refused: Array<{ night: LocalDate; inUse: number }> = [];
  for (const night of nights) {
    const old = byNight.get(night)?.quantity ?? 0;
    const cell = session.get(type.id, night);
    if (input.quantity < old && availableOf(cell) - (old - input.quantity) < 0) {
      refused.push({ night, inUse: old - availableOf(cell) });
    }
  }
  if (refused.length > 0) {
    throw new BusinessRuleError(
      'allowance_in_use',
      `Overbooking already sold into this allowance on ${refused.map((r) => r.night).join(', ')}; lowering it would oversell those nights. Relocate or move those stays first.`,
      { refused },
    );
  }
  const created: OverbookingAllowance[] = [];
  for (const night of nights) {
    const old = byNight.get(night);
    if (old && old.quantity === input.quantity && old.reason === reason) continue;
    if (old) {
      await idb(tx)
        .updateTable('inventory.overbooking_allowances')
        .set({ status: 'superseded', closed_at: tx.now })
        .where('id', '=', old.id)
        .execute();
    }
    session.adjust(type.id, night, { overbookingAllowance: input.quantity - (old?.quantity ?? 0) });
    if (input.quantity > 0) {
      const row = await idb(tx)
        .insertInto('inventory.overbooking_allowances')
        .values({
          id: newId(),
          tenant_id: tx.tenantId,
          property_id: propertyId,
          unit_type_id: type.id,
          night,
          quantity: input.quantity,
          kind: 'standing',
          reason,
          authorized_by: actorName(tx),
          entered_by: actorKey(tx),
          ref_type: null,
          ref_id: null,
          expires_at: expiresAt,
          created_at: tx.now,
          closed_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      created.push(toAllowance(row));
    }
  }
  const conflicts = await session.finish({ kind: 'allowance_change', note: reason });
  await tx.audit({
    action: 'inventory.overbooking.setAllowance',
    target: { type: 'unitType', id: type.id },
    propertyId,
    reason,
    before: current.map((c) => ({ night: c.night, quantity: c.quantity, reason: c.reason })),
    after: { nights: input.nights, quantity: input.quantity, expiresAt: expiresAt?.toISOString() ?? null },
  });
  await tx.emit({
    type: INVENTORY_EVENTS.overbookingAuthorized,
    propertyId,
    aggregate: { type: 'unitType', id: type.id },
    payload: {
      propertyId,
      unitTypeId: type.id,
      nights: input.nights,
      quantity: input.quantity,
      kind: 'standing',
      authorizedBy: actorName(tx),
      reason,
    },
  });
  return { allowances: created, conflictsResolved: conflicts.resolved };
}

export async function listOverbookingAllowances(
  tx: TxContext,
  filter: { propertyId: string; range: DateRange; unitTypeId?: string; includeInactive?: boolean },
): Promise<OverbookingAllowance[]> {
  requireAnyPermission(
    tx,
    [INVENTORY_PERMISSIONS.availabilityRead, INVENTORY_PERMISSIONS.overbookingAuthorize],
    filter.propertyId,
  );
  nightsOfRange(filter.range, 400, 'range');
  let q = idb(tx)
    .selectFrom('inventory.overbooking_allowances')
    .selectAll()
    .where('property_id', '=', filter.propertyId)
    .where('night', '>=', filter.range.from)
    .where('night', '<', filter.range.to);
  if (filter.unitTypeId) q = q.where('unit_type_id', '=', filter.unitTypeId);
  if (!filter.includeInactive) q = q.where('status', '=', 'active');
  const rows = await q.orderBy('night').orderBy('created_at').execute();
  return rows.map((r) => toAllowance(r));
}

// ───────────────────────────── Inventory conflicts ─────────────────────────────

type ConflictRow = Omit<ConflictsTable, 'status' | 'version'> & {
  status: InventoryConflict['status'];
  version: number;
};

export function toConflict(r: ConflictRow): InventoryConflict {
  return {
    id: r.id,
    propertyId: r.property_id,
    unitTypeId: r.unit_type_id,
    night: r.night,
    shortfall: r.shortfall,
    maxShortfall: r.max_shortfall,
    causes: (r.causes as InventoryConflict['causes']) ?? [],
    status: r.status,
    ownerUserId: r.owner_user_id,
    resolution: r.resolution,
    detectedAt: isoRequired(r.detected_at),
    resolvedAt: iso(r.resolved_at),
    previousConflictId: r.previous_conflict_id,
    version: r.version,
  };
}

/** Inventory conflicts (oversold beyond authorization) for the conflict queue (INV-R27). */
export async function listConflicts(
  tx: TxContext,
  filter: {
    propertyId: string;
    status?: 'unresolved' | 'open' | 'resolving' | 'resolved' | 'all';
    range?: DateRange;
  },
): Promise<InventoryConflict[]> {
  requireAnyPermission(tx, [INVENTORY_PERMISSIONS.availabilityRead], filter.propertyId);
  let q = idb(tx).selectFrom('inventory.conflicts').selectAll().where('property_id', '=', filter.propertyId);
  const status = filter.status ?? 'unresolved';
  if (status === 'unresolved') q = q.where('status', '<>', 'resolved');
  else if (status !== 'all') q = q.where('status', '=', status);
  if (filter.range) q = q.where('night', '>=', filter.range.from).where('night', '<', filter.range.to);
  const rows = await q.orderBy('night').orderBy('detected_at').limit(1000).execute();
  return rows.map((r) => toConflict(r));
}

export async function getConflict(tx: TxContext, conflictId: string): Promise<InventoryConflict> {
  assertUuid(conflictId, 'inventory_conflict');
  const row = await idb(tx)
    .selectFrom('inventory.conflicts')
    .selectAll()
    .where('id', '=', conflictId)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('inventory_conflict', conflictId);
  requireAnyPermission(tx, [INVENTORY_PERMISSIONS.availabilityRead], row.property_id);
  return toConflict(row);
}

/** Take ownership of a conflict / mark it as being resolved. Resolution itself happens when the numbers fit. */
export async function updateConflict(
  tx: TxContext,
  conflictId: string,
  expectedVersion: number,
  patch: { status?: 'open' | 'resolving'; ownerUserId?: string | null },
): Promise<InventoryConflict> {
  const before = await getConflict(tx, conflictId);
  requirePermission(tx, INVENTORY_PERMISSIONS.availabilityManage, { propertyId: before.propertyId });
  if (before.status === 'resolved') {
    throw new BusinessRuleError(
      'conflict_resolved',
      'This conflict is already resolved. If the night is oversold again, a new conflict is opened automatically.',
    );
  }
  const row = await idb(tx)
    .updateTable('inventory.conflicts')
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.ownerUserId !== undefined ? { owner_user_id: patch.ownerUserId } : {}),
      version: sql`version + 1`,
    })
    .where('id', '=', conflictId)
    .where('version', '=', expectedVersion)
    .where('status', '<>', 'resolved')
    .returningAll()
    .executeTakeFirst();
  if (!row) {
    return explainVersionMiss(
      'inventory_conflict',
      conflictId,
      expectedVersion,
      async () => (await getConflict(tx, conflictId)).version,
    );
  }
  await tx.audit({
    action: 'inventory.conflict.update',
    target: { type: 'inventoryConflict', id: conflictId },
    propertyId: before.propertyId,
    before: { status: before.status, ownerUserId: before.ownerUserId },
    after: { status: row.status, ownerUserId: row.owner_user_id },
  });
  return toConflict(row);
}
