/**
 * What migration needs from other modules (ADR-0003). Bound ONLY in apps/api/src/composition.ts; tests bind real
 * providers where they exist on main and strict fakes for the requested contracts. Migration never reads another
 * module's tables.
 *
 * ADR-0015: migration authorizes the user's intent (`migration.*` at the property) for the whole business action;
 * port calls carry that property scope; providers enforce integrity, their invariants and their data authority.
 *
 * Contract requests (MIG-CR-n) are listed in modules/migration/FOUNDATION_REQUESTS.md: they name the provider
 * functions migration needs that do not exist on main yet. Until they do, composition binds `unavailable` stubs
 * and the pipeline stops at that class with an honest, blocking exception — it never pretends.
 */
import type { TxContext } from '@portico/db';
import { DomainError, type LocalDate, type TenantEnvironment } from '@portico/kernel';
import type { BookingStatus, Guarantee, TaxAmount } from './domain/records';

/** Domains a migration moves to Portico at cutover (a subset of platform's DataDomain; ADR-0014). */
export type MigratedDomain =
  | 'reservations'
  | 'availability'
  | 'rates'
  | 'guestProfiles'
  | 'charges'
  | 'payments'
  | 'accounting'
  | 'roomStatus';
export const DEFAULT_MIGRATED_DOMAINS: readonly MigratedDomain[] = [
  'reservations',
  'availability',
  'rates',
  'guestProfiles',
  'charges',
  'payments',
  'accounting',
  'roomStatus',
];

// ───────────────────────────── platform (on main) ─────────────────────────────

export interface PropertyFacts {
  id: string;
  name: string;
  timezone: string;
  baseCurrency: string;
  businessDate: LocalDate;
  status: 'setup' | 'pilot' | 'active' | 'inactive';
}

export interface AuthorityView {
  authority: 'portico' | 'external';
  connectionId: string | null;
  systemName: string | null;
  writeMode: 'exclusive' | 'forward' | 'read_only';
}

export interface TransitionView {
  id: string;
  status: 'planned' | 'frozen' | 'effective' | 'cancelled';
  approvalRequired: boolean;
  approvedBy: string | null;
  plannedBy: string;
}

export interface PlatformPort {
  getProperty(tx: TxContext, propertyId: string): Promise<PropertyFacts>;
  getDataAuthority(tx: TxContext, propertyId: string, domain: MigratedDomain): Promise<AuthorityView>;
  /** Declare the source the system of record before cutover (restricting: read-only in Portico). */
  declareExternalAuthority(
    tx: TxContext,
    input: {
      propertyId: string;
      domain: MigratedDomain;
      systemName: string;
      connectionId: string;
      reason: string;
    },
  ): Promise<void>;
  planTransition(
    tx: TxContext,
    input: {
      propertyId: string;
      changes: Array<{
        domain: MigratedDomain;
        authority: 'portico' | 'external';
        writeMode: 'exclusive' | 'read_only';
        systemName?: string;
        connectionId?: string;
      }>;
      reason: string;
      rollbackCriteria: string;
      freezeMinutes: number;
      plannedStartAt?: Date;
    },
  ): Promise<TransitionView>;
  getTransition(tx: TxContext, propertyId: string, transitionId: string): Promise<TransitionView | null>;
  /** The second person's approval — runs with the APPROVER's own permissions (platform.dataAuthority.manage). */
  approveTransition(tx: TxContext, transitionId: string, note?: string): Promise<TransitionView>;
  freezeTransition(tx: TxContext, transitionId: string): Promise<TransitionView>;
  completeTransition(tx: TxContext, transitionId: string): Promise<TransitionView>;
  cancelTransition(tx: TxContext, transitionId: string, reason: string): Promise<void>;
  /** Activation-scope check (G-04): a pilot property must have migration in its approved scope. */
  assertWorkflowInScope(tx: TxContext, propertyId: string, workflow: string): Promise<void>;
  /** In a trial organization: the live organization it belongs to (null for a prospect's trial). */
  trialSourceOrganization(tx: TxContext): Promise<{ organizationId: string | null; status: string } | null>;
  /** Trial banner: "Data copied <time>" (platform.recordTrialImport). */
  recordTrialImport(
    tx: TxContext,
    input: { sourceSystem: string; copiedAt: Date; recordCounts: Record<string, number> },
  ): Promise<void>;
}

// ───────────────────────────── inventory (on main) ─────────────────────────────

export interface InventoryPort {
  listUnitTypes(
    tx: TxContext,
    propertyId: string,
  ): Promise<Array<{ id: string; code: string; name: string }>>;
  createUnitType(
    tx: TxContext,
    propertyId: string,
    input: { code: string; name: string; maxOccupancy: number; baseOccupancy: number },
  ): Promise<{ id: string }>;
  listUnits(
    tx: TxContext,
    propertyId: string,
  ): Promise<Array<{ id: string; number: string; unitTypeId: string }>>;
  createUnit(
    tx: TxContext,
    propertyId: string,
    input: { unitTypeId: string; number: string; name?: string; inInventoryFrom?: LocalDate },
  ): Promise<{ id: string }>;
  /** Units sold per unit type and night (availability ledger) — reconciliation read-back. */
  sold(
    tx: TxContext,
    input: { propertyId: string; from: LocalDate; to: LocalDate },
  ): Promise<Array<{ unitTypeId: string; date: LocalDate; sold: number }>>;
}

// ───────────────────────────── rates (on main) ─────────────────────────────

export interface RatesPort {
  listRatePlans(
    tx: TxContext,
    propertyId: string,
  ): Promise<Array<{ id: string; code: string; name: string }>>;
}

// ───────────────────────────── guests (on main: resolveProfile; MIG-CR-2 requested) ─────────────────────────────

export interface ImportProfileInput {
  propertyId: string;
  sourceSystem: string;
  sourceKey: string;
  givenName: string | null;
  familyName: string;
  email: string | null;
  phone: string | null;
  nationality: string | null;
  dateOfBirth: LocalDate | null;
  language: string | null;
}

export interface GuestsPort {
  /** Find-or-create (never merges); returns scored possible duplicates for the review list. */
  importProfile(
    tx: TxContext,
    input: ImportProfileInput,
  ): Promise<{
    profileId: string;
    created: boolean;
    possibleDuplicates: Array<{ profileId: string; score: number; band: string; reasons: string[] }>;
  }>;
  /** Which of these profile ids exist (reconciliation read-back). */
  existing(tx: TxContext, input: { propertyId: string; profileIds: string[] }): Promise<string[]>;
}

// ───────────────────────────── reservations (MIG-CR-1 requested) ─────────────────────────────

export interface MigratedBookingInput {
  propertyId: string;
  sourceSystem: string;
  /** Source identifier (confirmation number): the import is keyed by (property, sourceSystem, sourceKey). */
  sourceKey: string;
  /** Content hash of the source record: same version → `unchanged`, never a second booking. */
  sourceVersion: string;
  status: BookingStatus;
  arrival: LocalDate;
  departure: LocalDate;
  unitTypeId: string;
  unitId: string | null;
  adults: number;
  children: number;
  guestProfileId: string | null;
  guestName: string;
  channel: { code: string; bookingId: string } | null;
  /**
   * Agreed terms AS THE SOURCE STATES THEM (CLAUDE.md §5): stored verbatim as the terms snapshot; taxes are the
   * source's amounts and are never recomputed (no double tax). `nightly` is null when the source gave only totals.
   */
  terms: {
    currency: string;
    ratePlanCode: string | null;
    nightly: Array<{ date: LocalDate; amountMinor: number }> | null;
    roomTotalMinor: number;
    taxes: TaxAmount[];
    taxInclusive: boolean;
    totalMinor: number;
    guarantee: Guarantee;
  };
}

export interface MigratedBookingResult {
  bookingId: string;
  outcome: 'created' | 'updated' | 'unchanged';
  /** Inventory conflicts recorded because the night was already full (imports never fail on shortfall). */
  inventoryConflictIds: string[];
}

export interface ImportedBookingView {
  /** The migration source (ledger namespace) that imported it. */
  sourceSystem: string;
  sourceKey: string;
  bookingId: string;
  status: string;
  arrival: LocalDate;
  departure: LocalDate;
  unitTypeId: string;
  currency: string;
  roomTotalMinor: number;
  taxTotalMinor: number;
  totalMinor: number;
  nightly: Array<{ date: LocalDate; amountMinor: number }> | null;
}

export interface ReservationsPort {
  /**
   * MIG-CR-1. Create or update a booking from a migration source. Idempotent on (property, sourceSystem,
   * sourceKey). Active statuses (confirmed, tentative, in_house) consume inventory exactly once (record_conflict on
   * shortfall); history statuses (departed, cancelled, no_show) never consume it.
   */
  importBooking(tx: TxContext, input: MigratedBookingInput): Promise<MigratedBookingResult>;
  /**
   * MIG-CR-1. What reservations holds from migration sources at the property (reconciliation read-back). Without
   * `sourceSystem` it returns every migrated booking at the property, whichever source imported it, so the report
   * sees duplicates and other migrations' copies (R-P1-3, R-P1-7).
   */
  listImported(
    tx: TxContext,
    input: { propertyId: string; sourceSystem?: string },
  ): Promise<ImportedBookingView[]>;
}

// ───────────────────────────── finance (deposits on main; MIG-CR-3/4 requested) ─────────────────────────────

export interface OpeningDepositsInput {
  propertyId: string;
  importRef: string;
  currency: string;
  providedClosingMinor: number;
  items: Array<{
    bookingId: string;
    externalRef: string;
    amountMinor: number;
    declaredTaxes: Array<{ accountKey: string; name: string; amountMinor: number }>;
  }>;
}

export interface OpeningImportOutcome {
  status: 'reconciled' | 'difference';
  importedCount: number;
  importedTotalMinor: number;
  differenceMinor: number;
  rejected: Array<{ row: number; bookingId: string; reason: string }>;
}

export interface FinancePort {
  /** On main (finance.importOpeningDeposits, S18): deposits through migration suspense, tax already declared. */
  importOpeningDeposits(tx: TxContext, input: OpeningDepositsInput): Promise<OpeningImportOutcome>;
  /** Deposit balance per booking (finance.getDeposits) — reconciliation read-back. */
  depositBalances(
    tx: TxContext,
    input: { propertyId: string; bookingIds: string[] },
  ): Promise<Array<{ bookingId: string; amountMinor: number; currency: string }>>;
  /** Tax accounts of the property's legal entity (mapping suggestions for declared taxes). */
  taxAccountKeys(tx: TxContext, propertyId: string): Promise<string[]>;
  /** MIG-CR-3. Open folio balances of in-house stays as opening balances through migration suspense. */
  importOpeningFolioBalances(
    tx: TxContext,
    input: {
      propertyId: string;
      importRef: string;
      items: Array<{
        bookingId: string;
        folioRef: string;
        balanceMinor: number;
        currency: string;
        externalRef: string;
      }>;
    },
  ): Promise<{ importedCount: number; rejected: Array<{ bookingId: string; reason: string }> }>;
  folioOpeningBalances(
    tx: TxContext,
    input: { propertyId: string; bookingIds: string[] },
  ): Promise<Array<{ bookingId: string; folioRef: string; balanceMinor: number; currency: string }>>;
  /** MIG-CR-4. Receivables open items (with aging dates) as opening balances. */
  importOpeningReceivables(
    tx: TxContext,
    input: {
      propertyId: string;
      importRef: string;
      items: Array<{
        accountCode: string;
        accountName: string;
        invoiceRef: string;
        invoiceDate: LocalDate;
        dueDate: LocalDate | null;
        openMinor: number;
        currency: string;
      }>;
    },
  ): Promise<{ importedCount: number; rejected: Array<{ invoiceRef: string; reason: string }> }>;
  receivableOpenItems(
    tx: TxContext,
    input: { propertyId: string },
  ): Promise<Array<{ accountCode: string; invoiceRef: string; openMinor: number; currency: string }>>;
}

// ───────────────────────────── payments (MIG-CR-5 requested) ─────────────────────────────

export interface CardRecollectionPort {
  /**
   * MIG-CR-5. Ask the guest for a new card for a migrated booking whose guarantee card stayed at the previous
   * provider (Q142 default). Never moves card data. Simulated outside live.
   */
  request(
    tx: TxContext,
    input: { propertyId: string; bookingId: string; guestProfileId: string | null; idempotencyKey: string },
  ): Promise<{ status: 'requested' | 'simulated'; reference: string }>;
}

// ───────────────────────────── integration: the PMS simulator as a source (on main) ─────────────────────────────

/**
 * The system process every migration write runs as at the providers (composition binds the write ports with the
 * actor `{ kind: 'system', process: MIGRATION_PROCESS }`). The cutover journal recognises the migration's own
 * writes by this server-issued actor (R-P2-3).
 */
export const MIGRATION_PROCESS = 'migration';

export interface SimulatorSnapshot {
  accountId: string;
  property: {
    code: string;
    name: string;
    currency: string;
    timezone: string;
    roomTypes: Array<{ code: string; name: string; maxOccupancy: number }>;
    rooms: Array<{ number: string; roomTypeCode: string }>;
    ratePlans: Array<{ code: string; name: string }>;
  };
  reservations: Array<{
    reservationId: string;
    revision: number;
    status: string;
    arrival: LocalDate;
    departure: LocalDate;
    roomTypeCode: string;
    ratePlanCode: string;
    guestName: string;
    adults: number;
    totalMinor: number;
    currency: string;
  }>;
}

export interface SimulatorSourcePort {
  snapshot(tx: TxContext, accountId: string): Promise<SimulatorSnapshot>;
}

// ───────────────────────────── cross-organization rehearsal (composition: same module, trial tenant) ─────────────

export interface RehearsalRequest {
  trialOrganizationId: string;
  trialPropertyId: string;
  liveJobId: string;
  sourceAdapter: string;
  sourceSystem: string;
  plan: unknown;
  extract: { seq: number; records: unknown[]; controlTotals: unknown[] };
  /** Exception decisions of the live job, applied to the rehearsal so it imports exactly what the cutover will. */
  decisions: Array<{
    dataClass: string;
    sourceKey: string;
    code: string;
    outcome: string;
    resolution: string | null;
  }>;
}

export interface RehearsalEvidence {
  organizationId: string;
  jobId: string;
  planFingerprint: string;
  extractFingerprint: string;
  /** The data and decisions the trial certified (`dataFingerprint`); the live gate compares it with its own. */
  dataFingerprint: string;
  exact: boolean;
  reports: Array<{ seq: number; fingerprint: string; exact: boolean; generatedAt: string }>;
  certifiedAt: string | null;
}

export interface RehearsalPort {
  /**
   * Run (or re-run) a rehearsal of a live job's plan and extract inside its linked trial organization and return
   * the evidence. Refused unless the trial organization belongs to the calling live organization.
   */
  rehearse(tx: TxContext, input: RehearsalRequest): Promise<RehearsalEvidence>;
  evidence(
    tx: TxContext,
    input: { trialOrganizationId: string; liveJobId: string },
  ): Promise<RehearsalEvidence | null>;
  /**
   * The live job ended (completed, rolled back, cancelled, failed): its rehearsal copy in the trial organization ends
   * with it, so the same retention purge reaches it (R-P1-6). Idempotent.
   */
  close(
    tx: TxContext,
    input: { trialOrganizationId: string; liveJobId: string; outcome: 'completed' | 'cancelled' },
  ): Promise<void>;
}

export interface MigrationPorts {
  platform: PlatformPort;
  inventory: InventoryPort;
  rates: RatesPort;
  guests: GuestsPort;
  reservations: ReservationsPort;
  finance: FinancePort;
  cards: CardRecollectionPort;
  simulator: SimulatorSourcePort;
  rehearsal: RehearsalPort;
}

/** A provider that is not available on this server (contract requested): a clear, retryable refusal. */
export class ProviderUnavailableError extends DomainError {
  constructor(provider: string, operation: string, request: string) {
    super(
      'migration_provider_unavailable',
      `${provider} cannot ${operation} on this server yet (${request}). The migration keeps everything it has done and waits here; nothing is shown as migrated until it can be reconciled.`,
      { status: 503, retryable: true, details: { provider, operation, request } },
    );
  }
}

export function environmentAllowsRehearsal(environment: TenantEnvironment): boolean {
  return environment !== 'live';
}
