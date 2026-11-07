/**
 * Inventory's PORT surface (ADR-0015) — what other modules bind in the composition root (reservations, operations,
 * groups, distribution …), instead of calling the service with system scope.
 *
 *  - The calling module authorized the user's intent and property scope. Every function receives that `propertyId`.
 *  - Inventory does NOT re-check its own permission keys for that user: they are granted at that property only
 *    (kernel `delegateAtProperty`). Checks for a record of another property still fail.
 *  - Inventory verifies that every referenced record (unit, block, hold, unit type, the ref's consumption) belongs
 *    to `propertyId` (`scope_mismatch` otherwise), and enforces its invariants and data authority as usual.
 *  - Sensitive effects stay explicit (ADR-0015 §5): overbooking needs the `overbooking` argument the caller checked;
 *    overriding a locked assignment and house-use blocks are NOT delegated (the user needs inventory's own keys).
 *  - Inventory's HTTP routes keep inventory's own permissions (they call the service, not this surface).
 */
import { sql, type TxContext } from '@portico/db';
import { DomainError, delegateAtProperty, type EntityRef, NotFoundError } from '@portico/kernel';
import { INVENTORY_PERMISSIONS } from './manifest';
import type { InventoryService } from './service';
import type { AssignUnitInput, UnassignUnitInput } from './service/assignments';
import type { BlockUnitInput } from './service/blocks';
import type { ChangeConsumptionInput, ConsumeInput, ReleaseInput } from './service/consumption';
import type { CreateHoldInput } from './service/holds';

/** Inventory keys a port call implies once the caller authorized its own command at the property. */
export const INVENTORY_PORT_DELEGATION: readonly string[] = [
  INVENTORY_PERMISSIONS.availabilityRead,
  INVENTORY_PERMISSIONS.unitRead,
  INVENTORY_PERMISSIONS.assignmentManage,
  INVENTORY_PERMISSIONS.blockManage,
];

type Scoped<T> = T & { propertyId: string };

function scopeMismatch(kind: string, id: string, propertyId: string, actual: string): DomainError {
  return new DomainError(
    'scope_mismatch',
    `This ${kind} belongs to another property, so it cannot be changed from here. Open it at its own property.`,
    { status: 403, details: { kind, id, propertyId, recordPropertyId: actual } },
  );
}

async function propertyOf(
  tx: TxContext,
  table: 'units' | 'unit_blocks' | 'holds' | 'unit_types',
  id: string,
): Promise<string | null> {
  const r = await sql<{ property_id: string }>`
    select property_id from ${sql.table(`inventory.${table}`)} where id = ${id}::uuid`.execute(tx.db);
  return r.rows[0]?.property_id ?? null;
}

async function verify(
  tx: TxContext,
  table: 'units' | 'unit_blocks' | 'holds' | 'unit_types',
  kind: string,
  id: string,
  propertyId: string,
): Promise<void> {
  const actual = await propertyOf(tx, table, id);
  if (actual === null) throw new NotFoundError(kind, id);
  if (actual !== propertyId) throw scopeMismatch(kind, id, propertyId, actual);
}

/** Every property where the ref holds consumption, holds or assignments must be the caller's property. */
async function verifyRef(tx: TxContext, ref: EntityRef, propertyId: string): Promise<void> {
  const r = await sql<{ property_id: string }>`
    select property_id from inventory.consumptions where ref_type = ${ref.type} and ref_id = ${ref.id}
    union select property_id from inventory.holds where ref_type = ${ref.type} and ref_id = ${ref.id}
    union select u.property_id from inventory.assignments a join inventory.units u on u.id = a.unit_id
      where a.ref_type = ${ref.type} and a.ref_id = ${ref.id}`.execute(tx.db);
  const other = r.rows.find((x) => x.property_id !== propertyId);
  if (other) throw scopeMismatch(ref.type, ref.id, propertyId, other.property_id);
}

export function inventoryProvider(service: InventoryService) {
  const at = (tx: TxContext, propertyId: string) =>
    delegateAtProperty(tx, INVENTORY_PORT_DELEGATION, propertyId);
  const withOverbooking = (tx: TxContext, propertyId: string, explicit: boolean) =>
    delegateAtProperty(
      tx,
      explicit
        ? [...INVENTORY_PORT_DELEGATION, INVENTORY_PERMISSIONS.overbookingAuthorize]
        : INVENTORY_PORT_DELEGATION,
      propertyId,
    );
  return {
    consume: (tx: TxContext, input: ConsumeInput) =>
      service.consume(withOverbooking(tx, input.propertyId, Boolean(input.overbooking)), input),
    async release(tx: TxContext, input: Scoped<ReleaseInput>) {
      const { propertyId, ...rest } = input;
      await verifyRef(tx, rest.ref, propertyId);
      return service.release(at(tx, propertyId), rest);
    },
    async changeConsumption(tx: TxContext, input: Scoped<ChangeConsumptionInput>) {
      const { propertyId, ...rest } = input;
      await verify(tx, 'unit_types', 'unit_type', rest.from.unitTypeId, propertyId);
      await verify(tx, 'unit_types', 'unit_type', rest.to.unitTypeId, propertyId);
      await verifyRef(tx, rest.ref, propertyId);
      return service.changeConsumption(withOverbooking(tx, propertyId, Boolean(rest.overbooking)), rest);
    },
    createHold: (tx: TxContext, input: CreateHoldInput) =>
      service.createHold(at(tx, input.propertyId), input),
    async convertHold(tx: TxContext, input: { holdId: string; ref: EntityRef; propertyId: string }) {
      await verify(tx, 'holds', 'hold', input.holdId, input.propertyId);
      return service.convertHold(at(tx, input.propertyId), { holdId: input.holdId, ref: input.ref });
    },
    async assignUnit(tx: TxContext, input: Scoped<AssignUnitInput>) {
      const { propertyId, ...rest } = input;
      await verify(tx, 'units', 'unit', rest.unitId, propertyId);
      await verifyRef(tx, rest.ref, propertyId);
      return service.assignUnit(at(tx, propertyId), rest);
    },
    async unassignUnit(tx: TxContext, input: Scoped<UnassignUnitInput>) {
      const { propertyId, ...rest } = input;
      await verifyRef(tx, rest.ref, propertyId);
      return service.unassignUnit(at(tx, propertyId), rest);
    },
    findAssignableUnits: (tx: TxContext, input: Parameters<InventoryService['findAssignableUnits']>[1]) =>
      service.findAssignableUnits(at(tx, input.propertyId), input),
    getAvailability: (tx: TxContext, input: Parameters<InventoryService['getAvailability']>[1]) =>
      service.getAvailability(at(tx, input.propertyId), input),
    explainAvailability: (tx: TxContext, input: Parameters<InventoryService['explainAvailability']>[1]) =>
      service.explainAvailability(at(tx, input.propertyId), input),
    async getUnit(tx: TxContext, unitId: string, scope: { propertyId: string }) {
      await verify(tx, 'units', 'unit', unitId, scope.propertyId);
      return service.getUnit(at(tx, scope.propertyId), unitId);
    },
    listUnits: (tx: TxContext, propertyId: string, filter?: Parameters<InventoryService['listUnits']>[2]) =>
      service.listUnits(at(tx, propertyId), propertyId, filter),
    listUnitTypes: (tx: TxContext, propertyId: string) =>
      service.listUnitTypes(at(tx, propertyId), propertyId),
    /** Out of order / out of service for a unit of `propertyId` (house-use blocks keep inventory's own key). */
    blockUnit: (
      tx: TxContext,
      input: Scoped<BlockUnitInput>,
      opts?: Parameters<InventoryService['blockUnit']>[2],
    ) => service.blockUnit(at(tx, input.propertyId), input, opts),
    async releaseBlock(
      tx: TxContext,
      input: { blockId: string; reason?: string; expectedVersion?: number; propertyId: string },
      opts?: Parameters<InventoryService['releaseBlock']>[2],
    ) {
      const { propertyId, ...rest } = input;
      await verify(tx, 'unit_blocks', 'unit_block', rest.blockId, propertyId);
      return service.releaseBlock(at(tx, propertyId), rest, opts);
    },
  };
}

export type InventoryProviderApi = ReturnType<typeof inventoryProvider>;
