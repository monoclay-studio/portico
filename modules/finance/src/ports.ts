import type { TxContext } from '@portico/db';
import type { LocalDate, Money, Occupancy } from '@portico/kernel';

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

/** A charge line sent to the tax engine (rates.computeTaxes). */
export interface TaxChargeLine {
  lineId: string;
  chargeCode: string;
  chargeGroup: string;
  taxGroup: string;
  /** Inclusive = the amount already contains the taxes (decompose); exclusive = taxes are added. */
  priceMode: 'inclusive' | 'exclusive';
  amount: Money;
  quantity: number;
  serviceDate: LocalDate;
}

/** One computed tax, levy or service charge for a line. */
export interface TaxLine {
  lineId: string;
  ruleId: string;
  ruleVersionId: string;
  name: string;
  kind: 'tax' | 'fee' | 'service_charge';
  /** Ledger mapping key from the rule (e.g. 'tgst', 'green_tax', 'service_charge'). */
  accountKey: string;
  rate?: string;
  base: Money;
  amount: Money;
  /** Units the amount was computed on (e.g. guest-days for a per-person-per-day levy). */
  units?: number;
  /** Units exempted (e.g. children under 2 for Green Tax). */
  exemptUnits?: number;
  /** Reporting category of the rate (e.g. 'mv.green_tax.12usd'). */
  rateCategory?: string;
}

export interface TaxComputation {
  /** Per line: the net amount (equal to the input for exclusive prices) and its tax lines. */
  lines: Array<{ lineId: string; net: Money; taxes: TaxLine[] }>;
}

export interface TaxPort {
  computeTaxes(
    tx: TxContext,
    input: {
      propertyId: string;
      lines: TaxChargeLine[];
      occupancy?: Occupancy;
      stayContext?: { stayId?: string; nights?: number };
    },
  ): Promise<TaxComputation>;
  /** Whether every tax rule applicable at the property is verified (live fiscal issuance gate, RAT-R26). */
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
