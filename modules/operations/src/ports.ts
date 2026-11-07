import type { TxContext } from '@portico/db';
import type { DateRange, LocalDate } from '@portico/kernel';
import type { EntityRef } from './domain/model';

/**
 * What operations needs from other modules. Bound in apps/api/src/composition.ts; tests bind fakes.
 * Dependency direction (domain-map): operations ─► inventory (unit blocks), platform. Operations never calls
 * reservations synchronously — stays reach it through events (see events.ts) to keep the graph acyclic.
 */

export type OperationsDataDomain = 'roomStatus' | 'maintenance';

export interface PlatformPort {
  /** Property facts needed for business-date and time-of-day logic. Read with system scope by the adapter. */
  getProperty(
    tx: TxContext,
    propertyId: string,
  ): Promise<{ id: string; timezone: string; businessDate: LocalDate; checkInTime: string }>;
  /** platform.assertWritable — 'portico' (write now) | 'forward' (send to the external system of record). */
  assertWritable(
    tx: TxContext,
    propertyId: string,
    domain: OperationsDataDomain,
  ): Promise<'portico' | 'forward'>;
  getDataAuthority(
    tx: TxContext,
    propertyId: string,
    domain: OperationsDataDomain,
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

export interface InventoryUnitSummary {
  id: string;
  number: string;
  unitTypeId: string | null;
  unitTypeCode: string | null;
  locationPath: string | null;
  features: string[];
  active: boolean;
}

export interface InventoryPort {
  /** inventory.blockUnit — never fails for sold-out nights; returns the stays assigned to the unit on those nights. */
  blockUnit(
    tx: TxContext,
    input: {
      unitId: string;
      nights: DateRange;
      kind: 'out_of_order' | 'out_of_service';
      reason: string;
      sourceRef?: EntityRef;
    },
  ): Promise<{ blockId: string; affectedAssignments: Array<{ ref: EntityRef; nights: DateRange }> }>;
  releaseBlock(tx: TxContext, input: { blockId: string }): Promise<void>;
  /** Unit catalog (inventory.listUnits) used to mirror units into operations. */
  listUnits(tx: TxContext, input: { propertyId: string }): Promise<InventoryUnitSummary[]>;
}

export interface OperationsPorts {
  platform: PlatformPort;
  inventory: InventoryPort;
}
