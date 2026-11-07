/**
 * What reservations needs from other modules. Shapes follow docs/architecture/domain-map.md; where the domain
 * map leaves a shape open (`{...}`) or a module spec proposes an additive change, the choice is documented here
 * and in README.md ("Contract changes / assumptions"). The composition root binds these to real providers;
 * tests bind them to high-fidelity fakes (test/fakes).
 */
import type { TxContext } from '@portico/db';
import {
  type DateRange,
  DomainError,
  type EntityRef,
  type LocalDate,
  type Money,
  type Occupancy,
} from '@portico/kernel';

// ───────────────────────────── Shared shapes ─────────────────────────────

export interface TaxLine {
  code: string;
  name: string;
  kind: 'tax' | 'fee';
  amount: Money;
  ruleVersionId?: string;
  /**
   * How the rule computes (rates RAT-R22 kinds). Value-based lines (`percentage`, `banded`) follow the price;
   * quantity-based lines (`per_person_night`, `per_unit_night`, `per_stay`, `fixed_per_charge`) do not — e.g.
   * Maldives Green Tax is due on complimentary stays too (MIRA Green Tax FAQ, docs/readiness/maldives-tax-rules.md §5).
   */
  basis?: 'percentage' | 'banded' | 'per_person_night' | 'per_unit_night' | 'per_stay' | 'fixed_per_charge';
}

/** Penalty shape inside agreed terms (rates spec RAT-R18). */
export type Penalty =
  | { kind: 'none' }
  | { kind: 'nights'; nights: number }
  | { kind: 'percent_of_stay'; percent: number }
  | { kind: 'amount'; amount: Money }
  | { kind: 'first_night' };

export interface CancellationTier {
  /** The tier applies from (arrival − daysBeforeArrival) at `time` (property local time) onwards. */
  deadline: { daysBeforeArrival: number; time: string };
  penalty: Penalty;
}

export interface CancellationPolicy {
  /** True when the booking was non-refundable at booking time (full penalty from booking). */
  nonRefundable?: boolean;
  nonRefundablePenalty?: Penalty;
  tiers: CancellationTier[];
  noShow: Penalty;
  earlyDeparture?: Penalty;
  text?: string;
}

export type GuaranteeKind = 'none' | 'card' | 'deposit' | 'company' | 'agency' | 'prepaid_channel';

export interface DepositItem {
  kind: 'deposit' | 'preauthorization' | 'balance';
  basis: 'percent' | 'nights' | 'amount' | 'remaining';
  /** percent (0–100) or number of nights, depending on basis. */
  value?: number;
  amount?: Money;
  due?: { anchor: 'booking' | 'arrival' | 'departure'; offsetDays: number };
}

/**
 * Agreed terms. Owned by `rates` (versioned JSON, `schemaVersion`). Reservations persists it immutably and
 * reads ONLY the fields declared here (nightly lines, totals, policies). Unknown fields are preserved verbatim.
 */
export interface TermsSnapshot {
  schemaVersion: number;
  propertyId: string;
  ratePlanId: string;
  ratePlanVersion?: number;
  unitTypeId: string;
  occupancy: Occupancy;
  currency: string;
  priceSource: 'portico' | 'channel' | 'override';
  nights: Array<{
    date: LocalDate;
    net: Money;
    taxes: TaxLine[];
    inclusions?: Array<{ code: string; name: string; amount?: Money }>;
  }>;
  inclusions: Array<{ code: string; name: string }>;
  totals: { net: Money; taxes: Money; fees: Money; gross: Money };
  policies: {
    cancellation: CancellationPolicy;
    guarantee: { required: GuaranteeKind[]; releaseTime?: string };
    deposit: { items: DepositItem[] };
  };
  commission?: { kind: 'percent' | 'net_rate'; percent?: number };
  override?: {
    kind: 'complimentary' | 'house_use' | 'manual' | 'channel';
    reason: string;
    approvedBy?: string;
  };
  quotedAt: string;
  configVector?: string;
  [extra: string]: unknown;
}

// ───────────────────────────── inventory ─────────────────────────────

export interface AvailabilityCell {
  unitTypeId: string;
  date: LocalDate;
  capacity: number;
  outOfOrder: number;
  sold: number;
  held: number;
  overbookingAllowance: number;
  available: number;
}

/** Subset of inventory's explainAvailability result that reservations reads (real shape: `sold[]`). */
export interface AvailabilityExplanation {
  unitTypeId: string;
  date: LocalDate;
  available: number;
  sold: Array<{ ref: EntityRef; quantity: number; kind?: string }>;
}

export interface UnitCandidate {
  unitId: string;
  name: string;
  unitTypeId: string;
  assignable: boolean;
  /** Why the unit cannot be assigned for the requested nights (assigned to another stay, blocked…). */
  reason?: string;
  conflictingRefs?: EntityRef[];
  fitScore?: number;
}

export interface UnitTypeSummary {
  id: string;
  propertyId: string;
  code: string;
  name: string;
  /** Higher rank = more premium (used to label upgrade/downgrade alternatives). */
  rank: number;
  maxOccupancy: number;
}

export interface UnitSummary {
  id: string;
  propertyId: string;
  unitTypeId: string;
  name: string;
}

export interface InventoryPort {
  /**
   * Throws an error with code `inventory_unavailable` and `details.shortNights` when short (unless
   * `onShortfall: 'record_conflict'`, inventory spec INV-R11, in which case it commits and returns the
   * inventory conflicts it recorded).
   */
  consume(
    tx: TxContext,
    input: {
      propertyId: string;
      unitTypeId: string;
      nights: DateRange;
      quantity: number;
      ref: EntityRef;
      overbooking?: { authorizedBy: string; reason: string };
      onShortfall?: 'reject' | 'record_conflict';
    },
  ): Promise<{ conflictIds?: string[]; assignedUnitId?: string | null } | undefined>;
  release(tx: TxContext, input: { ref: EntityRef; nights?: DateRange }): Promise<void>;
  /** Atomically replace the ref's consumption of `from` with `to` (type and/or nights). */
  changeConsumption(
    tx: TxContext,
    input: {
      ref: EntityRef;
      from: { unitTypeId: string; nights: DateRange };
      to: { unitTypeId: string; nights: DateRange };
    },
  ): Promise<void>;
  createHold(
    tx: TxContext,
    input: {
      propertyId: string;
      unitTypeId: string;
      nights: DateRange;
      quantity: number;
      expiresAt: Date;
      ref: EntityRef;
    },
  ): Promise<{ holdId: string }>;
  convertHold(tx: TxContext, input: { holdId: string; ref: EntityRef }): Promise<void>;
  /** Throws code `unit_assignment_conflict` with `details.conflicts: EntityRef[]` on overlap. */
  assignUnit(
    tx: TxContext,
    input: { unitId: string; ref: EntityRef; nights: DateRange; locked?: boolean },
  ): Promise<void>;
  unassignUnit(tx: TxContext, input: { ref: EntityRef; nights?: DateRange }): Promise<void>;
  /** `ref`: the stay being placed — its own assignments are not conflicts. */
  findAssignableUnits(
    tx: TxContext,
    input: { propertyId: string; unitTypeId: string; nights: DateRange; ref?: EntityRef },
  ): Promise<UnitCandidate[]>;
  getAvailability(
    tx: TxContext,
    input: { propertyId: string; unitTypeIds?: string[]; range: DateRange },
  ): Promise<AvailabilityCell[]>;
  explainAvailability(
    tx: TxContext,
    input: { propertyId: string; unitTypeId: string; date: LocalDate },
  ): Promise<AvailabilityExplanation>;
  getUnit(tx: TxContext, unitId: string): Promise<UnitSummary>;
  listUnits(tx: TxContext, input: { propertyId: string }): Promise<UnitSummary[]>;
  listUnitTypes(tx: TxContext, input: { propertyId: string }): Promise<UnitTypeSummary[]>;
}

// ───────────────────────────── rates ─────────────────────────────

export interface Offer {
  unitTypeId: string;
  ratePlanId: string;
  ratePlanName?: string;
  nightly: Array<{ date: LocalDate; amount: Money }>;
  inclusions: Array<{ code: string; name: string }>;
  taxesAndFees: TaxLine[];
  totals: { net: Money; taxes: Money; fees: Money; gross: Money };
  policies: TermsSnapshot['policies'];
  restrictionViolations: Array<{ code: string; message: string }>;
  terms: TermsSnapshot;
}

export interface QuoteRequest {
  propertyId: string;
  nights: DateRange;
  occupancy: Occupancy;
  unitTypeIds?: string[];
  ratePlanIds?: string[];
  channelId?: string;
  companyId?: string;
  promoCode?: string;
  bookingDate?: LocalDate;
}

/** Target state of one stay segment, priced against the agreed terms (rates spec RAT-R29). */
export interface StayChangeRequest {
  nights: DateRange;
  unitTypeId: string;
  ratePlanId: string;
  occupancy: Occupancy;
  /** `reservations.repricing.typeChange` policy outcome for unit-type changes. */
  typeChange?: 'keep_agreed' | 'difference' | 'reprice';
  /** Business date the change is evaluated at (removed past nights are not repriced). */
  asOf: LocalDate;
}

export interface RepricingResult {
  nightly: Array<{ date: LocalDate; before: Money | null; after: Money | null }>;
  penalties: Array<{ kind: string; amount: Money; description: string }>;
  /** Candidate snapshot covering exactly `change.nights`. Persisted by reservations only on commit. */
  terms: TermsSnapshot;
}

export interface RatesPort {
  quote(tx: TxContext, input: QuoteRequest): Promise<Offer[]>;
  /**
   * Agreed terms for prices received from a channel (RES-R33; rates README gap "termsFromChannelPrice"). Rates owns
   * the tax engine: it decomposes tax-inclusive amounts and computes every tax and levy (incl. per-person Green Tax)
   * for the received prices. `base` (Portico's own quote, when the plan is mapped) supplies the policies.
   * Reservations never writes agreed terms with taxes dropped.
   */
  termsFromChannelPrices(
    tx: TxContext,
    input: {
      propertyId: string;
      unitTypeId: string;
      ratePlanId: string;
      occupancy: Occupancy;
      currency: string;
      nights: Array<{ date: LocalDate; amount: Money }>;
      amountsIncludeTax: boolean;
      base: TermsSnapshot | null;
      channelRef: { connectionId: string; externalId: string; roomRef: string };
    },
  ): Promise<TermsSnapshot>;
  priceChange(
    tx: TxContext,
    input: { terms: TermsSnapshot; change: StayChangeRequest },
  ): Promise<RepricingResult>;
  /**
   * Sales limits (RAT-R08): count a stay's nights against the limits of its plan and unit type, in the caller's
   * transaction. Idempotent per ref, plan and night. Throws BusinessRuleError `sales_limit_reached` when full.
   */
  recordPlanSale(
    tx: TxContext,
    input: {
      propertyId: string;
      ratePlanId: string;
      unitTypeId: string;
      nights: DateRange;
      quantity?: number;
      ref: EntityRef;
    },
  ): Promise<void>;
  /** Release a stay's plan sales (all, or only `nights`). */
  releasePlanSale(tx: TxContext, input: { ref: EntityRef; nights?: DateRange }): Promise<void>;
}

// ───────────────────────────── guests ─────────────────────────────

/**
 * Guests provider's `ProfileInput` (modules/guests: createProfileInput minus matchStrategy, + documentHash).
 * `propertyId` = where the guest is being recorded (data authority + visibility). Reservations maps its own simple
 * booking-form fields to this shape in `service/guests.ts`.
 */
export interface GuestProfileInput {
  propertyId: string;
  title?: string;
  givenName?: string;
  middleName?: string;
  familyName?: string;
  nativeGivenName?: string;
  nativeFamilyName?: string;
  preferredName?: string;
  language?: string;
  nationality?: string;
  dateOfBirth?: LocalDate;
  contactPoints?: Array<{
    kind: 'email' | 'phone' | 'whatsapp' | 'address';
    value: string;
    isPrimary?: boolean;
    verified?: boolean;
    /** e.g. 'channel' — channel proxy addresses are stored as low-confidence by guests. */
    source?: string;
  }>;
  source?: { kind: string; ref?: string };
  documentHash?: string;
}

/** Reference re-pointed by a consumer of guests.profile.merged (reported back for an exact unmerge). */
export type RepointedReference = EntityRef & { field?: string | null };

export interface GuestsPort {
  resolveProfile(
    tx: TxContext,
    input: GuestProfileInput,
    opts?: { matchStrategy?: 'exact_only' | 'suggest' | 'create_new' },
  ): Promise<{ profileId: string; created: boolean; possibleDuplicates: string[] }>;
  recordStayHistory(
    tx: TxContext,
    input: {
      profileId: string;
      stayRef: EntityRef;
      propertyId: string;
      bookingId?: string | null;
      role?: 'occupant' | 'booker' | 'payer';
      arrival: LocalDate;
      departure: LocalDate;
      status: string;
      unitTypeId?: string | null;
      ratePlanId?: string | null;
      companyId?: string | null;
    },
  ): Promise<void>;
  /** GUE-I03: report which references this module re-pointed for a merge, so an unmerge restores exactly those. */
  recordReferenceRepoints(
    tx: TxContext,
    input: { mergeId: string; module: string; references: RepointedReference[] },
  ): Promise<{ recorded: number }>;
}

// ───────────────────────────── finance ─────────────────────────────

export interface PayerRef {
  type: 'profile' | 'company' | 'agency' | 'house';
  id: string;
}

export interface FolioSummary {
  folioId: string;
  owner: EntityRef;
  payer: PayerRef;
  label?: string;
  isDefault: boolean;
  status: 'open' | 'settled';
  balance: Money;
}

export interface BillingRuleInput {
  destinationFolioId: string;
  /** Charge-code groups (finance FIN-R12), e.g. room, package, food, beverage, spa, misc. */
  chargeCodeGroups: string[];
  serviceDates?: DateRange;
  cap?: { kind: 'per_night' | 'per_stay'; amount: Money };
  source: 'manual' | 'company_default' | 'rate_plan' | 'group' | 'package';
}

export interface FinancePort {
  openFolio(
    tx: TxContext,
    input: { propertyId: string; owner: EntityRef; payer: PayerRef; label?: string },
  ): Promise<{ folioId: string }>;
  postCharge(
    tx: TxContext,
    input: {
      propertyId: string;
      folioId?: string;
      target?: EntityRef;
      chargeCode: string;
      amount: Money;
      quantity?: number;
      serviceDate: LocalDate;
      description: string;
      sourceRef: EntityRef;
      idempotencyKey: string;
      taxMode?: 'compute' | 'provided';
      taxLines?: TaxLine[];
      /** Required by finance when a user posts with a service date before the business date. */
      reason?: string;
    },
  ): Promise<{ postingIds: string[]; folioId: string }>;
  recordDeposit(
    tx: TxContext,
    input: { bookingId: string; amount: Money; paymentRef: EntityRef; idempotencyKey: string },
  ): Promise<void>;
  applyDeposits(
    tx: TxContext,
    input: { bookingId: string; toFolioId: string },
  ): Promise<{ applied: Money } | undefined>;
  getFolioBalance(
    tx: TxContext,
    folioId: string,
  ): Promise<{ folioId: string; balance: Money; status: string }>;
  listFolios(tx: TxContext, input: { owner: EntityRef }): Promise<FolioSummary[]>;
  /** Finance spec proposed contract change #3 (who pays for what). */
  setBillingRules(
    tx: TxContext,
    input: { owner: EntityRef; rules: BillingRuleInput[] },
  ): Promise<{ ruleIds: string[] }>;
  /** Proposed additive: deposits held (liability) for a booking, for change previews. */
  getDepositBalance(tx: TxContext, input: { bookingId: string }): Promise<Money | null>;
}

// ───────────────────────────── payments ─────────────────────────────

/**
 * Payments contract (aligned with the payments module's provider functions, R-11). Payments is TWO-PHASE: a
 * provider function called inside our transaction records the intent and returns `processing`; the provider call
 * runs after commit (and, durably, from payments' own outbox consumer). Reservations therefore never treats the
 * return value of `authorize` as the outcome: the guarantee step reads `getPaymentStatus` first, every time, and
 * never authorizes again while an authorization is processing, pending verification or authorized.
 */
export type AuthorizationState =
  | 'processing'
  | 'pending_verification'
  | 'authorized'
  | 'partially_captured'
  | 'captured'
  | 'voided'
  | 'expired'
  | 'failed';

/** Payments' explanation of a decline (never card data). */
export interface PaymentDecline {
  code: string;
  category: string;
  message: string;
  recovery: string;
  retryable: boolean;
}

/** The part of payments' `Authorization` view reservations reads (the real view carries more). */
export interface AuthorizationView {
  id: string;
  /** The tokenized payment method authorized (null for recorded terminal authorizations). */
  methodId: string | null;
  ref: { type: string; id: string };
  amount: { amountMinor: number; currency: string };
  /** Per-family status map (universal record contract); reservations reads the `authorization` family. */
  status: Record<string, string>;
  mode: 'live' | 'sandbox' | 'simulate' | 'recorded';
  decline: PaymentDecline | null;
}

/** payments' one-word summary for a business reference (read FIRST by the guarantee step). */
export type PaymentSummaryStatus =
  | 'none'
  | 'pending_verification'
  | 'authorized'
  | 'partially_paid'
  | 'paid'
  | 'refunded';

/** The part of payments' `PaymentStatusSummary` reservations reads. */
export interface PaymentStatusView {
  ref: { type: string; id: string };
  status: PaymentSummaryStatus;
  /** True while any payment/authorization/refund on the reference is processing or pending verification. */
  pendingVerification: boolean;
  authorizedMinor: number;
  capturedMinor: number;
  authorizations: AuthorizationView[];
}

/**
 * What reservations shows about payment readiness: payments' summary, plus `failed` when nothing is held and the
 * latest authorization was declined, and `unknown` when payments could not be read.
 */
export type PaymentStatusValue = PaymentSummaryStatus | 'failed';

export interface PaymentsPort {
  getPaymentStatus(tx: TxContext, ref: { type: string; id: string }): Promise<PaymentStatusView>;
  createPaymentRequest(
    tx: TxContext,
    input: {
      propertyId: string;
      payer: {
        type: 'guest_profile' | 'company' | 'agency' | 'other';
        id?: string;
        name: string;
        email?: string;
      };
      amount: { amountMinor: number; currency: string };
      purpose: 'deposit' | 'balance' | 'incidentals_preauth' | 'custom';
      ref: { type: 'folio' | 'booking'; id: string };
      expiresAt: Date | string;
      idempotencyKey: string;
      description?: string;
    },
  ): Promise<{ id: string; status: Record<string, string> }>;
  /** Records the intent and returns `processing`; the provider call happens after commit. */
  authorize(
    tx: TxContext,
    input: {
      propertyId: string;
      methodId: string;
      amount: { amountMinor: number; currency: string };
      ref: { type: string; id: string };
      idempotencyKey: string;
    },
  ): Promise<AuthorizationView>;
}

/** The `authorization` family of an authorization's status map ('unknown' if payments did not send one). */
export function authorizationState(a: Pick<AuthorizationView, 'status'>): AuthorizationState | 'unknown' {
  const s = a.status.authorization;
  const known: readonly string[] = [
    'processing',
    'pending_verification',
    'authorized',
    'partially_captured',
    'captured',
    'voided',
    'expired',
    'failed',
  ];
  return s && known.includes(s) ? (s as AuthorizationState) : 'unknown';
}

/** Reservations' payment readiness value for a reference (see `PaymentStatusValue`). */
export function paymentReadiness(view: PaymentStatusView): PaymentStatusValue {
  if (view.status !== 'none' && view.status !== 'refunded') return view.status;
  const latest = view.authorizations[view.authorizations.length - 1];
  return latest && authorizationState(latest) === 'failed' ? 'failed' : view.status;
}

// ───────────────────────────── operations ─────────────────────────────

export type UnitCondition = 'dirty' | 'cleaning' | 'clean' | 'inspected' | 'failed_inspection';

export interface OperationsPort {
  getUnitCondition(
    tx: TxContext,
    unitId: string,
  ): Promise<{ condition: UnitCondition; inspectedAt?: string; discrepancy?: string }>;
  createTask(
    tx: TxContext,
    input: {
      propertyId: string;
      departmentId?: string;
      kind: string;
      title: string;
      ref?: EntityRef;
      dueAt?: string;
      priority: 'low' | 'normal' | 'high' | 'urgent';
    },
  ): Promise<{ taskId: string }>;
}

// ───────────────────────────── platform ─────────────────────────────

export interface PropertyInfo {
  id: string;
  name: string;
  timezone: string;
  baseCurrency: string;
  legalEntityId: string;
  businessDate: LocalDate;
  checkInTime: string;
  checkOutTime: string;
}

export type DataDomain =
  | 'reservations'
  | 'availability'
  | 'rates'
  | 'guestProfiles'
  | 'charges'
  | 'payments'
  | 'roomStatus'
  | 'maintenance'
  | 'accounting';

export interface PlatformPort {
  /** Property configuration needed for computation (time zone, currency); not a user-facing read. */
  getProperty(tx: TxContext, propertyId: string): Promise<PropertyInfo>;
  getBusinessDate(tx: TxContext, propertyId: string): Promise<LocalDate>;
  assertWritable(tx: TxContext, propertyId: string, domain: DataDomain): Promise<'portico' | 'forward'>;
  getDataAuthority(
    tx: TxContext,
    propertyId: string,
    domain: DataDomain,
  ): Promise<{ authority: 'portico' | 'external'; connectionId: string | null; systemName: string | null }>;
  resolvePolicy<T>(
    tx: TxContext,
    propertyId: string,
    key: string,
    defaultValue: T,
  ): Promise<{ value: T; source: string }>;
}

// ───────────────────────────── access (keys) ─────────────────────────────

export type KeyKind = 'card' | 'wristband' | 'mobile';

/**
 * Outcome of a key operation from the `access` module (door locks, encoders, RFID wristbands, mobile keys).
 *  - issued / cancelled: the lock system confirmed it.
 *  - pending: accepted by the lock system, not yet confirmed (resume reads it again with the same key).
 *  - unavailable: the lock system is down or not connected — staff must use the lock console and confirm a
 *    manual fallback; reservations NEVER treats this as silently done.
 *  - simulated: non-live environment (environment safety); nothing real happened.
 */
export interface KeyOperationResult {
  status: 'issued' | 'cancelled' | 'pending' | 'unavailable' | 'simulated';
  keyRefs: string[];
  message?: string;
}

/**
 * Provided by the `access` module (bound by the orchestrator). Every adapter calls assertExternalEffectAllowed.
 * TWO-PHASE (ADR-0007 pattern, review R-09): a call made inside the caller's transaction only RECORDS the operation
 * (keyed by idempotencyKey) and returns `pending` — or, for a repeated key, the settled result. The lock system is
 * contacted only AFTER COMMIT, so a rolled-back command never leaves keys encoded, moved or cancelled. Callers
 * resume by calling again with the same idempotency key.
 */
export interface AccessPort {
  issueKeys(
    tx: TxContext,
    input: {
      stayId: string;
      unitId: string;
      validFrom: LocalDate;
      validTo: LocalDate;
      count: number;
      kind: KeyKind;
      idempotencyKey: string;
    },
  ): Promise<KeyOperationResult>;
  /** Stay extended: keys stay valid until the new departure. */
  extendKeys(
    tx: TxContext,
    input: { stayId: string; validTo: LocalDate; idempotencyKey: string },
  ): Promise<KeyOperationResult>;
  /** Room move: cancel keys for the old unit, issue for the new one. */
  moveKeys(
    tx: TxContext,
    input: {
      stayId: string;
      fromUnitId: string;
      toUnitId: string;
      validFrom: LocalDate;
      validTo: LocalDate;
      idempotencyKey: string;
    },
  ): Promise<KeyOperationResult>;
  /** Check-out, no-show or cancellation. */
  cancelKeys(
    tx: TxContext,
    input: { stayId: string; reason: 'check_out' | 'no_show' | 'cancellation'; idempotencyKey: string },
  ): Promise<KeyOperationResult>;
}

export interface ReservationsPorts {
  inventory: InventoryPort;
  rates: RatesPort;
  guests: GuestsPort;
  finance: FinancePort;
  payments: PaymentsPort;
  operations: OperationsPort;
  platform: PlatformPort;
  access: AccessPort;
}

// ───────────────────────────── error recognition ─────────────────────────────

/** Short nights from an inventory "unavailable" error (code `inventory_unavailable`), else null. */
export function inventoryShortfall(err: unknown): Array<{ date: LocalDate; available: number }> | null {
  if (!(err instanceof DomainError)) return null;
  if (err.code !== 'inventory_unavailable' && err.name !== 'InventoryUnavailableError') return null;
  const short = err.details?.shortNights;
  return Array.isArray(short) ? (short as Array<{ date: LocalDate; available: number }>) : [];
}

/**
 * Conflicting refs from an inventory assignment-overlap error (code `unit_assignment_conflict`), else null. Real
 * inventory: instance `.conflicts: EntityRef[]`, `details.conflicts: [{ ref, unitId, unitNumber, nights }]`.
 */
export function assignmentConflicts(err: unknown): EntityRef[] | null {
  if (!(err instanceof DomainError)) return null;
  if (err.code !== 'unit_assignment_conflict' && err.name !== 'UnitAssignmentConflictError') return null;
  const own = (err as DomainError & { conflicts?: unknown }).conflicts;
  if (Array.isArray(own)) return own as EntityRef[];
  const c = err.details?.conflicts;
  if (!Array.isArray(c)) return [];
  return c.map((x) => (x as { ref?: EntityRef }).ref ?? (x as EntityRef));
}

/** A port stub for a provider module that is not wired yet (bound by the orchestrator at merge). */
export function unavailablePort<T extends object>(module: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      return async () => {
        throw new DomainError(
          'module_not_available',
          `The ${module} module is not available in this installation yet, so this action (${String(prop)}) cannot run. It will work once ${module} is enabled.`,
          { status: 503, retryable: true, details: { module, operation: String(prop) } },
        );
      };
    },
  });
}
