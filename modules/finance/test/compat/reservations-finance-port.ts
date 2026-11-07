/**
 * VERBATIM copy of the reservations module's finance shapes and `FinancePort` (modules/reservations/src/ports.ts,
 * reservations worktree, 2026-11-07), so finance's adapter is type-checked against its consumer. When reservations
 * changes its port, refresh this copy; `port-compat.test.ts` then fails to compile until the adapter follows.
 */
import type { TxContext } from '@portico/db';
import type { DateRange, EntityRef, LocalDate, Money } from '@portico/kernel';

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
