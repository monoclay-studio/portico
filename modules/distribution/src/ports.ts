/**
 * What distribution needs from other modules (ADR-0003). Bound in apps/api/src/composition.ts; tests bind real
 * providers or strict fakes. Every port call carries the property the caller authorized (ADR-0015 rule 2); scope
 * parameters are REQUIRED (BS3-3). Distribution never reads another module's tables.
 */
import type { TxContext } from '@portico/db';
import type { DateRange, LocalDate } from '@portico/kernel';
import type { EffectiveRestrictionInput } from './domain/ari';
import type { ChannelBookingPayload } from './domain/revisions';

export interface PlatformPort {
  /** Property facts for computation (time zone, currency, business date). */
  getProperty(
    tx: TxContext,
    propertyId: string,
  ): Promise<{ id: string; timezone: string; baseCurrency: string; businessDate: LocalDate }>;
  /** System of record per data domain (ADR-0014). */
  getDataAuthority(
    tx: TxContext,
    propertyId: string,
    domain: 'availability' | 'rates' | 'reservations',
  ): Promise<{ authority: 'portico' | 'external'; systemName: string | null }>;
}

export interface InventoryPort {
  listUnitTypes(
    tx: TxContext,
    propertyId: string,
  ): Promise<Array<{ id: string; code: string; name: string; sellable: boolean }>>;
  /** What may be published per unit type and night (inventory's `sellable`: never negative). */
  sellable(
    tx: TxContext,
    input: { propertyId: string; unitTypeIds: string[]; range: DateRange },
  ): Promise<Array<{ unitTypeId: string; date: LocalDate; sellable: number }>>;
  /** Provisional hold for an unmapped channel booking (DST-R10); throws when the units are not available. */
  createHold(
    tx: TxContext,
    input: {
      propertyId: string;
      unitTypeId: string;
      nights: DateRange;
      quantity: number;
      expiresAt: Date;
      ref: { type: string; id: string };
    },
  ): Promise<{ holdId: string }>;
  releaseHold(tx: TxContext, input: { propertyId: string; holdId: string; reason: string }): Promise<void>;
}

export interface RatesPort {
  listRatePlans(
    tx: TxContext,
    propertyId: string,
  ): Promise<
    Array<{
      id: string;
      code: string;
      name: string;
      currency: string;
      status: string;
      /** Channels allowed to sell the plan (null = every channel). */
      channels: string[] | null;
    }>
  >;
  /** Price (base occupancy) and effective restrictions per night — rates computes them, distribution publishes. */
  ariValues(
    tx: TxContext,
    input: { propertyId: string; ratePlanId: string; unitTypeId: string; range: DateRange },
  ): Promise<
    Array<{
      date: LocalDate;
      price: { amountMinor: number; currency: string } | null;
      restrictions: EffectiveRestrictionInput;
    }>
  >;
}

export interface IngestResult {
  outcome: 'created' | 'modified' | 'cancelled' | 'duplicate' | 'conflict' | 'stale' | 'needs_review';
  bookingId?: string;
  note?: string;
}

export interface ReservationsPort {
  /**
   * reservations.ingestChannelBooking (domain map). Runs in distribution's transaction: when it returns, the
   * booking change is part of the same commit as the revision's outcome and the acknowledgement that follows.
   */
  ingestChannelBooking(
    tx: TxContext,
    input: { connectionId: string; externalId: string; revision: number; payload: ChannelBookingPayload },
  ): Promise<IngestResult>;
}

/** Encrypted secret storage (bound to the integration module's secret store). */
export interface SecretsPort {
  put(tx: TxContext, value: string): Promise<string>;
  get(tx: TxContext, ref: string): Promise<string>;
  destroy(tx: TxContext, ref: string): Promise<void>;
}

/**
 * Live-scope gate (platform activation scope, G-04). Called before a LIVE organization activates a production
 * channel connection or publishes to it. Until platform's scope enforcement is bound, the composition root binds a
 * stub that refuses: no live channel connection exists without the owner's explicit authorization (CLAUDE.md §1).
 */
export interface LiveScopePort {
  assertLiveChannelAllowed(tx: TxContext, input: { propertyId: string; connectionId: string }): Promise<void>;
}

export interface DistributionPorts {
  platform: PlatformPort;
  inventory: InventoryPort;
  rates: RatesPort;
  reservations: ReservationsPort;
  secrets: SecretsPort;
  liveScope: LiveScopePort;
}
