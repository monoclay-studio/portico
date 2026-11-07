/**
 * What Day Close needs from other modules (docs/architecture/domain-map.md: day-close ─► reservations, finance,
 * payments, inventory, operations, platform; plus rates' pure posting plan and integration's exceptions/export).
 * Bound in apps/api/src/composition.ts; tests bind real providers where they exist and strict fakes otherwise.
 *
 * ADR-0015: Day Close authorizes the user's intent (dayClose.run.* at the property) and passes that property as a
 * REQUIRED scope on every call (BS3-3: no optional scope). Providers enforce integrity (record belongs to the
 * property), their invariants and data authority. Advancing the business date is the exception on purpose: it is
 * called with the acting user's own context, so platform checks `platform.businessDate.advance` on that user.
 */
import type { TxContext } from '@portico/db';
import type { LocalDate, Money, Occupancy } from '@portico/kernel';

/** The data-authority domains Day Close reads (a subset of platform's vocabulary, type-checked at binding). */
export type DayCloseDomain = 'reservations' | 'charges' | 'accounting';

export interface DayCloseProperty {
  id: string;
  name: string;
  profile: string;
  timezone: string;
  legalEntityId: string;
  baseCurrency: string;
  businessDate: LocalDate;
}

export interface PlatformPort {
  /** Property facts for computation (system read; Day Close already authorized the property). */
  getProperty(tx: TxContext, propertyId: string): Promise<DayCloseProperty>;
  getBusinessDate(tx: TxContext, propertyId: string): Promise<LocalDate>;
  /**
   * platform.advanceBusinessDate(expected = D). Called with the ACTING USER's context: platform checks
   * `platform.businessDate.advance` (sensitive). Optimistic: throws `business_date_mismatch` when not D.
   */
  advanceBusinessDate(
    tx: TxContext,
    input: { propertyId: string; expected: LocalDate; dayCloseRunId: string },
  ): Promise<LocalDate>;
  /** Raw policy value with its source (Day Close validates it; an invalid value never widens anything). */
  resolvePolicy(tx: TxContext, propertyId: string, key: string): Promise<{ value: unknown; source: string }>;
  /** Property-level policy override; Day Close authorized `dayClose.policy.manage` first. */
  setPropertyPolicy(
    tx: TxContext,
    input: { propertyId: string; key: string; value: unknown; reason: string },
  ): Promise<void>;
  getDataAuthority(
    tx: TxContext,
    propertyId: string,
    domain: DayCloseDomain,
  ): Promise<{ authority: 'portico' | 'external'; systemName: string | null }>;
  /** Entitlement `core.dayClose` (every edition except module-only Connect plans). */
  hasEntitlement(tx: TxContext, feature: string, propertyId: string): Promise<boolean>;
  /** Properties of the organization (for the portfolio board; Day Close filters by its own permission). */
  listProperties(
    tx: TxContext,
  ): Promise<Array<{ id: string; name: string; businessDate: LocalDate; timezone: string }>>;
  /** Departments of the property (owners of readiness items are resolved by department kind). */
  listDepartments(
    tx: TxContext,
    propertyId: string,
  ): Promise<Array<{ id: string; kind: string; name: string }>>;
}

// ───────────────────────────── reservations ─────────────────────────────

/** One in-house stay for one night, with the stored (sealed) agreed terms of the segment covering that night. */
export interface StayNight {
  stayId: string;
  bookingId: string;
  propertyId: string;
  night: LocalDate;
  arrival: LocalDate;
  departure: LocalDate;
  commercialType: 'standard' | 'complimentary' | 'house_use';
  unitId: string | null;
  unitTypeId: string;
  ratePlanId: string;
  occupancy: Occupancy;
  /** Opaque to Day Close: rates verifies the seal and derives the posting plan from it. */
  terms: unknown;
}

/** An expected arrival or a due departure (no names: Day Close records hold ids only). */
export interface DueStay {
  stayId: string;
  bookingId: string;
  propertyId: string;
  status: string;
  arrival: LocalDate;
  departure: LocalDate;
  commercialType: string;
  unitId: string | null;
  eta: string | null;
  /** Transfer details (seaplane / speedboat): scheduled vs estimated arrival instants (ISO). */
  transfer: { mode: string | null; scheduledAt: string | null; estimatedAt: string | null };
}

export interface NoShowOutcome {
  stayId: string;
  penalty: Money;
  penaltyPostingIds: string[];
  replayed: boolean;
}

export interface ReservationsPort {
  listInHouseStaysForNight(
    tx: TxContext,
    input: { propertyId: string; date: LocalDate },
  ): Promise<StayNight[]>;
  listDueArrivals(tx: TxContext, input: { propertyId: string; date: LocalDate }): Promise<DueStay[]>;
  listDueDepartures(tx: TxContext, input: { propertyId: string; date: LocalDate }): Promise<DueStay[]>;
  /**
   * markNoShow (idempotent by business identity). The fee comes from the agreed terms through rates'
   * cancellation evaluation and is posted by reservations to the stay's folio (finance key
   * `penalty:no_show:{stayId}`). The adapter refuses a stay of another property.
   */
  markNoShow(
    tx: TxContext,
    input: { propertyId: string; stayId: string; idempotencyKey: string },
  ): Promise<NoShowOutcome>;
}

// ───────────────────────────── rates (pure posting plan) ─────────────────────────────

export type TaxInclusionMode = 'exclusive' | 'inclusive' | 'rules' | 'rule_default';

/** Rates' `PostingLine` (the fields Day Close reads; structurally checked against rates at binding). */
export interface PostingLine {
  idempotencyKey: string;
  kind: 'room' | 'inclusion' | 'allowance' | 'added';
  nightDate: LocalDate;
  serviceDate: LocalDate;
  chargeCode: string;
  taxCategory: string;
  amount: Money;
  quantity: number;
  inclusionId: string | null;
  taxInclusion: { mode: TaxInclusionMode };
  occupancy: Occupancy;
  agreedRuleVersionIds: string[];
}

/** Allowance entitlement terms of an inclusion (from the agreed terms). */
export interface AllowanceEntitlement {
  inclusionId: string;
  code: string;
  name: string;
  kind: 'monetary' | 'quantity';
  period: 'per_night' | 'per_stay';
  eligibleChargeCodes: string[];
  remainderPolicy: 'forfeit' | 'carry_within_stay';
}

export interface RatesPort {
  /** True when the stored terms carry a valid seal made with this server's key. */
  verifyTerms(terms: unknown): boolean;
  /** Every charge of the agreement from the terms alone (keys room:{stay}:{night}, inclusion:{stay}:{inc}:{night}). */
  postingPlan(terms: unknown, stayId: string): PostingLine[];
  /** Allowance entitlements of the agreement. */
  allowances(terms: unknown): AllowanceEntitlement[];
}

// ───────────────────────────── finance ─────────────────────────────

/** The property Day Close authorized (finance grants its delegated permissions at this property only). */
export interface FinanceScope {
  propertyId: string;
}

export interface FinancePostChargeInput {
  propertyId: string;
  target: { type: 'stay'; id: string };
  chargeCode: string;
  amount: Money;
  quantity: number;
  priceMode: 'inclusive' | 'exclusive';
  serviceDate: LocalDate;
  revenueDate?: LocalDate;
  description: string;
  sourceRef: { type: string; id: string };
  idempotencyKey: string;
  taxMode: 'compute';
  reason?: string;
  occupancy: Occupancy;
  agreedRuleVersionIds?: string[];
}

export interface FinanceGrantAllowanceInput {
  propertyId: string;
  stayId: string;
  folioId: string;
  definitionRef: string;
  label: string;
  period: { night: LocalDate };
  amount: Money;
  chargeCode: string;
  eligibleChargeCodes?: string[];
  coversTaxes: boolean;
  unusedPolicy: 'forfeit' | 'carry_forward';
  idempotencyKey: string;
}

export interface UnbalancedItem {
  code: string;
  severity: string;
  ref: { type: string; id: string } | null;
  message: string;
  details?: Record<string, unknown>;
}

export interface IntegrityResult {
  ok: boolean;
  checks: Array<{ check: string; ok: boolean; expectedMinor: number; actualMinor: number; detail: string }>;
}

export interface TrialBalanceResult {
  functionalCurrency: string;
  balanced: boolean;
  totalDebitMinor: number;
  totalCreditMinor: number;
  accounts: Array<{ code: string; name: string; type: string; debitMinor: number; creditMinor: number }>;
}

export interface DailyRevenueResult {
  currency: string;
  byChargeCode: Array<{ chargeCode: string; netMinor: number }>;
  totalRevenueMinor: number;
  taxes: Array<{ accountCode: string; name: string; amountMinor: number }>;
  restatements: Array<{ entryId: string; relatesTo: string; reason: string | null; amountMinor: number }>;
}

export interface FinancePort {
  postCharge(
    tx: TxContext,
    scope: FinanceScope,
    input: FinancePostChargeInput,
  ): Promise<{ entryId: string; postingIds: string[]; folioId: string; replayed: boolean }>;
  /** The stay's default folio (where nightly allowances are granted). */
  defaultFolio(tx: TxContext, scope: FinanceScope, stayId: string): Promise<{ folioId: string } | null>;
  grantAllowance(
    tx: TxContext,
    scope: FinanceScope,
    input: FinanceGrantAllowanceInput,
  ): Promise<{ instanceId: string; entryId: string; replayed: boolean }>;
  closeAllowances(
    tx: TxContext,
    scope: FinanceScope,
    input: { stayId: string; upTo: LocalDate; departureDate: LocalDate },
  ): Promise<{ closed: number }>;
  getUnbalancedItems(tx: TxContext, scope: FinanceScope, businessDate: LocalDate): Promise<UnbalancedItem[]>;
  /** FIN-I02 trial balance balanced + FIN-I14 control accounts = sub-ledgers, for the property's legal entity. */
  integrityReport(tx: TxContext, scope: FinanceScope): Promise<IntegrityResult>;
  trialBalance(tx: TxContext, scope: FinanceScope, input: { asOf: LocalDate }): Promise<TrialBalanceResult>;
  dailyRevenue(
    tx: TxContext,
    scope: FinanceScope,
    input: { businessDate: LocalDate },
  ): Promise<DailyRevenueResult>;
}

// ───────────────────────────── payments ─────────────────────────────

export interface PaymentsPort {
  listUnresolved(
    tx: TxContext,
    input: { propertyId: string },
  ): Promise<{
    pendingVerification: Array<{
      type: string;
      id: string;
      amountMinor: number;
      currency: string;
      since: string;
    }>;
    recordedUnverified: number;
    ledgerPending: number;
    openExceptions: number;
  }>;
  /**
   * CONTRACT REQUEST (payments): collect the agreed no-show fee from the booking's AGREED guarantee only
   * (ADR-0015 Amendment 1: supplied by the cardholder for this booking, the booking's channel card, or a recorded
   * mandate covering `no_show`). Payments decides the card and the initiator; Day Close never picks a card.
   * `not_agreed` = no agreed guarantee: Day Close raises a follow-up for a person with payment rights.
   */
  collectAgreedNoShowFee(
    tx: TxContext,
    input: { propertyId: string; bookingId: string; stayId: string; amount: Money; idempotencyKey: string },
  ): Promise<{
    outcome: 'requested' | 'not_agreed' | 'pending_verification';
    paymentId: string | null;
    reason: string | null;
    mode: string | null;
  }>;
  /** CONTRACT REQUEST (payments): schedule authorization renewals and VCC charges due (no charge runs here). */
  scheduleDueCollections(
    tx: TxContext,
    input: { propertyId: string; businessDate: LocalDate },
  ): Promise<{ renewalsScheduled: number; vccChargesScheduled: number }>;
}

// ───────────────────────────── inventory / operations / integration ─────────────────────────────

export interface AvailabilityCellLite {
  unitTypeId: string;
  date: LocalDate;
  capacity: number;
  outOfOrder: number;
  sold: number;
  houseUse: number;
  composite: boolean;
}

export interface InventoryPort {
  getAvailability(
    tx: TxContext,
    input: { propertyId: string; date: LocalDate },
  ): Promise<AvailabilityCellLite[]>;
  /** INV-I02 for the property from `fromNight` (read only: Day Close reports, inventory's job alarms). */
  checkLedgerConsistency(
    tx: TxContext,
    input: { propertyId: string; fromNight: LocalDate },
  ): Promise<Array<{ unitTypeId: string; night: LocalDate; sold: number; consumed: number }>>;
  listUnits(tx: TxContext, input: { propertyId: string }): Promise<Array<{ id: string; number: string }>>;
}

export interface OperationsPort {
  listUnitConditions(
    tx: TxContext,
    input: { propertyId: string },
  ): Promise<
    Array<{ unitId: string; unitNumber: string; condition: string | null; discrepancy: string | null }>
  >;
}

export interface IntegrationPort {
  listOpenExceptions(
    tx: TxContext,
    input: { propertyId: string },
  ): Promise<
    Array<{
      id: string;
      severity: string;
      problem: string;
      nextStep: string;
      responsibleParty: string;
      workflow: string | null;
    }>
  >;
  /** CONTRACT REQUEST (integration): queue the accounting journal export of a closed date (idempotent). */
  queueJournalExport(
    tx: TxContext,
    input: { propertyId: string; businessDate: LocalDate; idempotencyKey: string },
  ): Promise<{ status: 'queued' | 'not_required'; exportId: string | null }>;
}

export interface DayClosePorts {
  platform: PlatformPort;
  reservations: ReservationsPort;
  rates: RatesPort;
  finance: FinancePort;
  payments: PaymentsPort;
  inventory: InventoryPort;
  operations: OperationsPort;
  integration: IntegrationPort;
}
