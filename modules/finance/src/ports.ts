import type { TxContext } from '@portico/db';
import type { LocalDate, Money } from '@portico/kernel';

/**
 * What finance needs from other modules. Bound in apps/api/src/composition.ts; tests bind fakes.
 * Dependency direction (domain map): finance ─► platform, rates (tax engine). Payments is NOT called
 * synchronously for money movement — only to request a collection follow-up (DB-only, no provider call).
 */

export interface FinanceProperty {
  id: string;
  name: string;
  legalEntityId: string;
  baseCurrency: string;
  timezone: string;
}

export interface FinanceLegalEntity {
  id: string;
  name: string;
  legalName: string;
  taxId?: string;
  registrationNumber?: string;
  countryCode: string;
  baseCurrency: string;
  address?: Record<string, string>;
}

export type DataDomain = 'charges' | 'accounting' | 'payments';

export interface PlatformPort {
  /** Routing metadata only (legal entity, currency) — callers must not require property read permission. */
  getProperty(tx: TxContext, propertyId: string): Promise<FinanceProperty>;
  getBusinessDate(tx: TxContext, propertyId: string): Promise<LocalDate>;
  getLegalEntity(tx: TxContext, legalEntityId: string): Promise<FinanceLegalEntity>;
  /** Throws `external_system_of_record` when another system is authoritative in read-only mode. */
  assertWritable(tx: TxContext, propertyId: string, domain: DataDomain): Promise<'portico' | 'forward'>;
}

/**
 * The tax engine is `rates` (single tax computation for everything, RAT-R23). These types mirror rates' published
 * provider contract (`modules/rates/src/contracts.ts`: chargeLine, computeTaxesInput, taxLine, taxComputation,
 * rulePackStatus) so the composition root binds `rates.computeTaxesDetailed` / `rates.getRulePackStatus`
 * directly. Only the fields finance sends or reads are declared.
 */
export interface RatesChargeLine {
  lineId: string;
  chargeCode: string;
  /** Rates' tax category (finance charge code `tax_group`), e.g. accommodation, food_beverage, spa. */
  taxCategory: string;
  amount: Money;
  /** Integer ≥ 1. */
  quantity?: number;
  serviceDate: LocalDate;
  taxInclusion?: { mode: 'exclusive' } | { mode: 'inclusive' };
  nights?: number;
  occupancy?: { adults: number; childrenAges: number[] };
  /** Tax point already fixed for this amount (e.g. a deposit taxed at payment) — ADR-0016 §4. */
  taxPointDate?: LocalDate;
  adjustment?: 'supply' | 'reversal' | 'price_adjustment';
}

export interface RatesComputeTaxesInput {
  propertyId: string;
  lines: RatesChargeLine[];
  occupancy?: { adults: number; childrenAges: number[] };
}

export interface RatesTaxLine {
  lineId: string;
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  ruleVersionId: string;
  /** tax = statutory tax or levy; fee = fee/service charge. */
  category: 'tax' | 'fee';
  nature: 'statutory' | 'commercial';
  basis: 'percentage' | 'banded' | 'per_person_night' | 'per_unit_night' | 'per_stay' | 'fixed_per_charge';
  base: Money | null;
  ratePercent: string | null;
  quantity: { persons: number; exemptPersons: number; nights: number; units: number } | null;
  fixedAmount: { value: string; currency: string } | null;
  amount: Money;
  /** e.g. 'tax.tgst', 'tax.green_tax', 'fee.service_charge'. */
  ledgerMappingKey: string;
  taxPointDate: LocalDate;
}

export interface RatesTaxComputation {
  lines: Array<{ lineId: string; net: Money; taxes: RatesTaxLine[] }>;
}

export interface TaxPort {
  computeTaxesDetailed(tx: TxContext, input: RatesComputeTaxesInput): Promise<RatesTaxComputation>;
  /** Whether every tax rule in force at the property is verified (live fiscal issuance gate, RAT-R26). */
  getRulePackStatus(tx: TxContext, propertyId: string): Promise<{ verified: boolean; note?: string }>;
}

export interface CollectionRequest {
  propertyId: string;
  folioId: string;
  amount: Money;
  reason: 'late_charge';
  ref: { type: string; id: string };
  idempotencyKey: string;
}

export interface PaymentsPort {
  /**
   * Ask payments to arrange collection (MIT charge on card on file if the agreed terms allow, otherwise a
   * payment request). Records intent only, in the same transaction; any provider call happens later through
   * payments' provider-operation journal. Returns 'unavailable' when payments is not connected.
   */
  requestCollection(
    tx: TxContext,
    input: CollectionRequest,
  ): Promise<{ status: 'requested' | 'not_possible' | 'unavailable'; detail?: string }>;
}

export interface FinancePorts {
  platform: PlatformPort;
  tax: TaxPort;
  payments: PaymentsPort;
}
