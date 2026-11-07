import type { TxContext } from '@portico/db';
import type { DateRange, LocalDate } from '@portico/kernel';
import type { EntityRef } from './domain/model';

/**
 * What operations needs from other modules. Bound in apps/api/src/composition.ts; tests bind fakes.
 * Dependency direction (domain-map): operations ─► inventory (unit blocks), platform. Operations never calls
 * reservations synchronously — stays reach it through events (see events.ts) to keep the graph acyclic.
 */

export type OperationsDataDomain = 'roomStatus' | 'maintenance';
/** Domains operations reads the authority of (it writes only roomStatus and maintenance). */
export type ReadableDataDomain = OperationsDataDomain | 'availability';

export interface PlatformPort {
  /** Property facts needed for business-date and time-of-day logic. Read with system scope by the adapter. */
  getProperty(
    tx: TxContext,
    propertyId: string,
  ): Promise<{ id: string; timezone: string; businessDate: LocalDate; checkInTime: string; profile: string }>;
  /** platform.assertWritable — 'portico' (write now) | 'forward' (send to the external system of record). */
  assertWritable(
    tx: TxContext,
    propertyId: string,
    domain: OperationsDataDomain,
  ): Promise<'portico' | 'forward'>;
  getDataAuthority(
    tx: TxContext,
    propertyId: string,
    domain: ReadableDataDomain,
  ): Promise<{
    authority: 'portico' | 'external';
    connectionId: string | null;
    systemName: string | null;
    writeMode: 'exclusive' | 'forward' | 'read_only';
  }>;
  /** platform.resolvePolicy for `operations.settings` (partial object merged onto defaults by operations). */
  resolvePolicy(tx: TxContext, propertyId: string, key: string): Promise<unknown>;
  /** Departments configured at the property (to route tasks to a department id when one exists). */
  listDepartments(tx: TxContext, propertyId: string): Promise<Array<{ id: string; kind: string }>>;
}

/** Shape of inventory's `Unit` that operations reads (inventory branch `contracts.ts` → `unit`). */
export interface InventoryUnit {
  id: string;
  number: string;
  unitTypeId: string | null;
  location: { building: string | null; floor: string | null; zone: string | null } | null;
  features: string[];
  status: 'active' | 'inactive' | 'retired' | (string & {});
  /** Composite ("combined") units are not mirrored: housekeeping works on the physical component units. */
  isComposite?: boolean;
}

/**
 * Inventory provider functions as published by the inventory module (`createInventoryService`). Per ADR-0015 the
 * provider does not re-check its own permission keys on port calls; operations authorizes the user's intent
 * (`operations.maintenance.setInventoryImpact` at the property) before calling.
 */
export interface InventoryPort {
  /** Never fails for sold-out nights; refuses (DomainError) e.g. `unit_already_blocked`, `forwarding_not_available`. */
  /** `propertyId` (ADR-0015): the property operations authorized; inventory refuses a unit of another property. */
  blockUnit(
    tx: TxContext,
    input: {
      propertyId: string;
      unitId: string;
      nights: DateRange;
      kind: 'out_of_order' | 'out_of_service';
      reason: string;
      sourceRef?: EntityRef;
    },
  ): Promise<{ blockId: string; affectedAssignments: Array<{ ref: EntityRef; nights: DateRange }> }>;
  /** Returns the released block (unused by operations). */
  releaseBlock(tx: TxContext, input: { propertyId: string; blockId: string; reason?: string }): Promise<unknown>;
  listUnits(
    tx: TxContext,
    propertyId: string,
    filter?: { status?: 'active' | 'inactive' | 'retired' | 'all' },
  ): Promise<InventoryUnit[]>;
}

export interface OperationsPorts {
  platform: PlatformPort;
  inventory: InventoryPort;
}
