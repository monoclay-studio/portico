/**
 * What rates needs from other modules. Bound in apps/api/src/composition.ts; tests bind fakes.
 * Dependency direction (domain map): rates ─► platform (property, policies, data authority), rates ─► inventory
 * (unit types, read-only). Rates never calls reservations or finance (they call rates).
 */
import type { TxContext } from '@portico/db';
import type { LocalDate } from '@portico/kernel';

export interface RatesPropertyInfo {
  id: string;
  countryCode: string;
  timezone: string;
  baseCurrency: string;
  checkInTime: string;
  classification: Record<string, string | number | boolean>;
}

export interface RatesUnitType {
  id: string;
  code: string;
  name: string;
}

export interface RatesPorts {
  /**
   * Property facts used for pricing and taxes. The binding must not require `platform.property.read`: rates
   * performs its own permission checks (e.g. a channel quoting with `rates.quote.read` only).
   */
  getProperty(tx: TxContext, propertyId: string): Promise<RatesPropertyInfo>;
  /** platform.assertWritable for the `rates` data-authority domain. */
  assertWritable(tx: TxContext, propertyId: string, domain: 'rates'): Promise<'portico' | 'forward'>;
  /** platform.resolvePolicy (rates.childAgeBands, reservations.repricing.newNights, …). */
  resolvePolicy<T>(
    tx: TxContext,
    propertyId: string,
    key: string,
    defaultValue: T,
  ): Promise<{ value: T; source: string }>;
  /** Property business date (for "today" in quotes). */
  getBusinessDate?(tx: TxContext, propertyId: string): Promise<LocalDate>;
  /**
   * inventory.listUnitTypes — optional: when bound, price/restriction writes reject unknown unit types and the
   * demo seed can price the property's real unit types. Unbound until inventory merges (README).
   */
  listUnitTypes?(tx: TxContext, propertyId: string): Promise<RatesUnitType[]>;
  /**
   * The sales channel an authenticated API client sells through (integration/distribution binding). Unbound:
   * an API client sells as channel `api_client:<clientId>`. Channels can never choose another channel.
   */
  channelForApiClient?(tx: TxContext, clientId: string): Promise<string | null>;
  /**
   * guests.getCompany — verifies a company/agency id used for negotiated-rate eligibility. Unbound: staff-provided
   * ids are accepted as given (staff look the company up); non-staff callers can never name a company.
   */
  companyExists?(tx: TxContext, companyId: string): Promise<boolean>;
  /**
   * reservations/finance: agreements (stays, deposits) a tax rule version would affect, for the activation
   * report (RAT-R25). Unbound: the report says so and consumers react to `rates.taxRule.activated`.
   */
  affectedAgreements?(
    tx: TxContext,
    input: {
      ruleId: string;
      ruleCode: string;
      nature: 'statutory' | 'commercial';
      from: LocalDate | null;
      to: LocalDate | null;
    },
  ): Promise<{
    stays: number;
    deposits: number;
    items: Array<{ ref: { type: string; id: string }; note: string }>;
  }>;
}
