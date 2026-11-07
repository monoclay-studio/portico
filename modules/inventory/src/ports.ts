import type { TxContext } from '@portico/db';
import type { LocalDate } from '@portico/kernel';

/** Data domains inventory reads the system of record for (ADR-0014). */
export type InventoryDataDomain = 'availability' | 'reservations' | 'maintenance';

export interface DataAuthorityView {
  authority: 'portico' | 'external';
  connectionId: string | null;
  systemName: string | null;
  writeMode: 'exclusive' | 'forward' | 'read_only';
}

/** What inventory needs from `platform` (bound in apps/api/src/composition.ts). */
export interface PlatformPort {
  /** Throws NotFound when the property does not exist in this organization (used to validate property ids). */
  getBusinessDate(tx: TxContext, propertyId: string): Promise<LocalDate>;
  getDataAuthority(
    tx: TxContext,
    propertyId: string,
    domain: InventoryDataDomain,
  ): Promise<DataAuthorityView>;
  /**
   * Guard before writing in an authority-governed domain: 'portico' = write directly, 'forward' = the change must
   * be sent to the external system of record; throws `external_system_of_record` when read-only here.
   */
  assertWritable(
    tx: TxContext,
    propertyId: string,
    domain: InventoryDataDomain,
  ): Promise<'portico' | 'forward'>;
  /** Plan limit (e.g. `limits.units`); null = unlimited. */
  getLimit(tx: TxContext, limitKey: string): Promise<number | null>;
  /** Policy value with inheritance (property → region → brand → organization → default). */
  resolvePolicy<T>(tx: TxContext, propertyId: string, key: string, defaultValue: T): Promise<{ value: T }>;
}

export interface InventoryPorts {
  platform: PlatformPort;
}
