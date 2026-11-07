import type { TxContext, TxEventSubscription } from '@portico/db';
import {
  BusinessRuleError,
  type EntityRef,
  isLocalDate,
  type LocalDate,
  type Money,
  ValidationError,
} from '@portico/kernel';
import { CHARGE_GROUPS, type ChargeGroup } from '../domain/types';
import type { FinancePorts } from '../ports';
import * as allowances from './allowances';
import * as billingRules from './billing-rules';
import * as cashier from './cashier';
import * as deposits from './deposits';
import * as fiscal from './fiscal';
import * as folios from './folios';
import * as ledgerPort from './ledger-port';
import * as payouts from './payouts';
import type { ProvidedTaxLineInput } from './postings';
import * as postings from './postings';
import * as receivables from './receivables';
import * as reports from './reports';
import * as setup from './setup';
import { type Deps, delegated, ensureChart } from './support';

type Rest<F> = F extends (tx: TxContext, deps: Deps, ...args: infer A) => infer R
  ? (tx: TxContext, ...args: A) => R
  : never;

function bind<F extends (tx: TxContext, deps: Deps, ...args: never[]) => unknown>(deps: Deps, f: F): Rest<F> {
  return ((tx: TxContext, ...args: never[]) => f(tx, deps, ...args)) as Rest<F>;
}

/**
 * The finance service: every command and query, bound to its ports. Functions check finance permissions for
 * the actor in `tx`; see `financeProvider` for calls made by other modules inside their own commands.
 */
export function createFinance(ports: FinancePorts) {
  const deps: Deps = { ports };
  return {
    // ── provider contract (docs/architecture/domain-map.md § finance) ──
    openFolio: bind(deps, folios.openFolio),
    postCharge: bind(deps, postings.postCharge),
    recordPayment: bind(deps, postings.recordPayment),
    recordRefund: bind(deps, postings.recordRefund),
    recordDeposit: bind(deps, deposits.recordDeposit),
    applyDeposits: bind(deps, deposits.applyDeposits),
    recordPayout: bind(deps, payouts.recordPayout),
    recordPaymentAdjustment: bind(deps, ledgerPort.recordPaymentAdjustment),
    recordDisputeMovement: bind(deps, ledgerPort.recordDisputeMovement),
    recordSettlementFees: bind(deps, ledgerPort.recordSettlementFees),
    markPaymentVerified: ledgerPort.markPaymentVerified,
    describeTarget: ledgerPort.describeTarget,
    assertTargetInScope: bind(deps, ledgerPort.assertTargetInScope),
    assertPropertyScope: bind(deps, ledgerPort.assertPropertyScope),
    getPropertyLegalEntity: async (tx: TxContext, propertyId: string) =>
      (await ports.platform.getProperty(tx, propertyId)).legalEntityId,
    getFolioBalance: folios.getFolioBalance,
    listFolios: folios.listFolios,
    getUnbalancedItems: bind(deps, reports.getUnbalancedItems),
    // ── folios ──
    getFolio: folios.getFolio,
    settleFolio: folios.settleFolio,
    closeFolio: folios.closeFolio,
    voidFolio: folios.voidFolio,
    markOwnerDeparted: folios.markOwnerDeparted,
    clearOwnerDeparture: folios.clearOwnerDeparture,
    // ── postings ──
    adjustPosting: bind(deps, postings.adjustPosting),
    reverseEntry: bind(deps, postings.reverseEntry),
    transferPostings: bind(deps, postings.transferPostings),
    collectPayment: bind(deps, postings.collectPayment),
    // ── billing rules ──
    createBillingRule: bind(deps, billingRules.createBillingRule),
    updateBillingRule: bind(deps, billingRules.updateBillingRule),
    deactivateBillingRule: bind(deps, billingRules.deactivateBillingRule),
    listBillingRules: billingRules.listBillingRules,
    mergeBillingRules: bind(deps, billingRules.mergeBillingRules),
    previewRouting: billingRules.previewRouting,
    // ── deposits & allowances ──
    refundDeposit: bind(deps, deposits.refundDeposit),
    forfeitDeposit: bind(deps, deposits.forfeitDeposit),
    getDeposits: deposits.getDeposits,
    importOpeningDeposits: bind(deps, deposits.importOpeningDeposits),
    grantAllowance: bind(deps, allowances.grantAllowance),
    closeAllowances: bind(deps, allowances.closeAllowances),
    listAllowances: allowances.listAllowances,
    // ── fiscal documents ──
    createFiscalSeries: bind(deps, fiscal.createFiscalSeries),
    listFiscalSeries: fiscal.listFiscalSeries,
    issueInvoice: bind(deps, fiscal.issueInvoice),
    issueCreditNote: bind(deps, fiscal.issueCreditNote),
    getDocument: fiscal.getDocument,
    listDocuments: fiscal.listDocuments,
    renderDocumentPdf: fiscal.renderDocumentPdf,
    verifyFiscalLedger: fiscal.verifyFiscalLedger,
    // ── receivables ──
    createReceivablesAccount: bind(deps, receivables.createReceivablesAccount),
    updateReceivablesAccount: receivables.updateReceivablesAccount,
    getReceivablesAccount: receivables.getReceivablesAccount,
    listReceivablesAccounts: receivables.listReceivablesAccounts,
    listReceivablesItems: receivables.listReceivablesItems,
    transferToReceivables: bind(deps, receivables.transferToReceivables),
    recordReceivablesPayment: bind(deps, receivables.recordReceivablesPayment),
    allocateReceivablesPayment: receivables.allocateReceivablesPayment,
    receivablesAging: receivables.receivablesAging,
    // ── cashier ──
    openCashierSession: bind(deps, cashier.openCashierSession),
    closeCashierSession: bind(deps, cashier.closeCashierSession),
    getCashierSession: bind(deps, cashier.getCashierSession),
    listOpenCashierSessions: bind(deps, cashier.listOpenCashierSessions),
    recordPaidOut: bind(deps, cashier.recordPaidOut),
    // ── setup, FX ──
    listAccounts: bind(deps, setup.listAccounts),
    createAccount: bind(deps, setup.createAccount),
    createChargeCode: bind(deps, setup.createChargeCode),
    updateChargeCode: bind(deps, setup.updateChargeCode),
    listChargeCodes: setup.listChargeCodes,
    seedDefaultChargeCodes: setup.seedDefaultChargeCodes,
    recordFxRate: bind(deps, setup.recordFxRate),
    listFxRates: setup.listFxRates,
    recordFxSettlement: bind(deps, payouts.recordFxSettlement),
    // ── reports, checks, retention ──
    trialBalance: bind(deps, reports.trialBalance),
    dailyRevenue: bind(deps, reports.dailyRevenue),
    integrityReport: bind(deps, reports.integrityReport),
    greenTaxReport: bind(deps, reports.greenTaxReport),
    listExceptions: reports.listExceptions,
    resolveException: reports.resolveException,
    invoicesOverdueForIssue: reports.invoicesOverdueForIssue,
    placeLegalHold: reports.placeLegalHold,
    releaseLegalHold: reports.releaseLegalHold,
    retentionStatus: reports.retentionStatus,
    ensureChart,
    getBusinessDateFor: (tx: TxContext, propertyId: string) => ports.platform.getBusinessDate(tx, propertyId),
  };
}

export type FinanceService = ReturnType<typeof createFinance>;

/** Finance permissions a calling module's command implies when it uses finance inside the same transaction. */
export const PROVIDER_DELEGATION: Record<string, readonly string[]> = {
  // reservations opens folios, posts room/package charges, applies deposits, marks departures
  reservations: [
    'finance.folio.manage',
    'finance.folio.read',
    'finance.posting.create',
    'finance.billingRule.manage',
  ],
  // payments records provider-confirmed money movements only
  payments: ['finance.folio.read', 'finance.posting.create', 'finance.ledger.manage'],
  // day-close posts nightly charges, closes allowance periods and reads checks
  dayClose: ['finance.folio.read', 'finance.posting.create', 'finance.report.read'],
  // resort outlets post charges
  resort: ['finance.folio.read', 'finance.posting.create'],
};

/** The property (and legal entity) the calling module authorized for its command (ADR-0015 §2). */
export interface ProviderScope {
  propertyId: string;
  legalEntityId?: string;
}

/**
 * The provider surface for another module (bound in the composition root). The calling module has already
 * authorized its own command at a property (e.g. reservations.stay.checkIn at P) and passes that scope; finance
 * grants the finance permissions the command implies AT THAT PROPERTY ONLY (ADR-0015), so a folio, booking deposit
 * or rule of another property is refused. Finance still enforces data authority, invariants, idempotency and audit
 * (the real actor is recorded). Sensitive finance actions (corrections, credit notes, write-offs) are never
 * delegated.
 */
export function financeProvider(service: FinanceService, caller: keyof typeof PROVIDER_DELEGATION) {
  const perms = PROVIDER_DELEGATION[caller] ?? [];
  const d = async (tx: TxContext, scope: ProviderScope): Promise<TxContext> => {
    if (scope.legalEntityId)
      await service.assertPropertyScope(tx, { ...scope, legalEntityId: scope.legalEntityId });
    return delegated(tx, perms, scope.propertyId);
  };
  type S = FinanceService;
  return {
    openFolio: async (tx: TxContext, scope: ProviderScope, input: Parameters<S['openFolio']>[1]) =>
      service.openFolio(await d(tx, scope), input),
    postCharge: async (tx: TxContext, scope: ProviderScope, input: Parameters<S['postCharge']>[1]) =>
      service.postCharge(await d(tx, scope), input),
    recordPayment: async (tx: TxContext, scope: ProviderScope, input: Parameters<S['recordPayment']>[1]) =>
      service.recordPayment(await d(tx, scope), input),
    recordRefund: async (tx: TxContext, scope: ProviderScope, input: Parameters<S['recordRefund']>[1]) =>
      service.recordRefund(await d(tx, scope), input),
    recordDeposit: async (tx: TxContext, scope: ProviderScope, input: Parameters<S['recordDeposit']>[1]) => {
      await service.assertTargetInScope(
        tx,
        { type: 'booking', id: input.bookingId },
        await entityScope(tx, scope),
      );
      return service.recordDeposit(await d(tx, scope), { ...input, propertyId: scope.propertyId });
    },
    applyDeposits: async (tx: TxContext, scope: ProviderScope, input: Parameters<S['applyDeposits']>[1]) =>
      service.applyDeposits(await d(tx, scope), input),
    recordPaymentAdjustment: async (
      tx: TxContext,
      scope: ProviderScope,
      input: Parameters<S['recordPaymentAdjustment']>[1],
    ) => service.recordPaymentAdjustment(await d(tx, scope), input),
    recordDisputeMovement: async (
      tx: TxContext,
      scope: ProviderScope,
      input: Parameters<S['recordDisputeMovement']>[1],
    ) => service.recordDisputeMovement(await d(tx, scope), input),
    recordPayout: async (tx: TxContext, scope: ProviderScope, input: Parameters<S['recordPayout']>[1]) =>
      service.recordPayout(await d(tx, scope), input),
    markPaymentVerified: async (
      tx: TxContext,
      scope: ProviderScope,
      input: Parameters<S['markPaymentVerified']>[1],
    ) => service.markPaymentVerified(await d(tx, scope), { ...input, scope: await entityScope(tx, scope) }),
    getFolioBalance: async (tx: TxContext, scope: ProviderScope, folioId: string) =>
      service.getFolioBalance(await d(tx, scope), folioId),
    listFolios: async (tx: TxContext, scope: ProviderScope, input: Parameters<S['listFolios']>[1]) =>
      service.listFolios(await d(tx, scope), input),
    getUnbalancedItems: async (tx: TxContext, scope: ProviderScope, businessDate: LocalDate) =>
      service.getUnbalancedItems(await d(tx, scope), { propertyId: scope.propertyId, businessDate }),
    markOwnerDeparted: async (
      tx: TxContext,
      scope: ProviderScope,
      input: Parameters<S['markOwnerDeparted']>[1],
    ) => service.markOwnerDeparted(await d(tx, scope), { ...input, propertyId: scope.propertyId }),
    grantAllowance: async (tx: TxContext, scope: ProviderScope, input: Parameters<S['grantAllowance']>[1]) =>
      service.grantAllowance(await d(tx, scope), { ...input, propertyId: scope.propertyId }),
    closeAllowances: async (
      tx: TxContext,
      scope: ProviderScope,
      input: Parameters<S['closeAllowances']>[1],
    ) => service.closeAllowances(await d(tx, scope), input),
    createBillingRule: async (
      tx: TxContext,
      scope: ProviderScope,
      input: Parameters<S['createBillingRule']>[1],
    ) => service.createBillingRule(await d(tx, scope), { ...input, propertyId: scope.propertyId }),
  };

  async function entityScope(
    tx: TxContext,
    scope: ProviderScope,
  ): Promise<{ propertyId: string; legalEntityId: string }> {
    return {
      propertyId: scope.propertyId,
      legalEntityId: scope.legalEntityId ?? (await service.getPropertyLegalEntity(tx, scope.propertyId)),
    };
  }
}

type LedgerMethod = 'card' | 'virtual_card' | 'payment_link' | 'external_terminal' | 'cash' | 'bank_transfer';
type Verification = 'provider_confirmed' | 'recorded_unverified' | 'recorded_verified';
/** Payments' clearing reference: one clearing account per provider (and provider account). */
type ClearingRef = {
  provider: 'simulator' | 'stripe_connect' | 'external_terminal' | 'cash' | 'bank_transfer';
  accountId: string | null;
};
type LedgerScope = { propertyId: string; legalEntityId: string };

/** Finance provider key for a clearing ref ('stripe_connect_acct_123' → account `card_clearing:stripe_connect_acct_123`). */
function clearingProvider(c: ClearingRef): string {
  return c.accountId ? `${c.provider}_${c.accountId}` : c.provider;
}
function clearingMethod(c: ClearingRef, method: LedgerMethod): LedgerMethod {
  if (c.provider === 'cash') return 'cash';
  if (c.provider === 'bank_transfer') return 'bank_transfer';
  return method === 'cash' || method === 'bank_transfer' ? 'card' : method;
}

/**
 * The exact `LedgerPort` the payments module declares (modules/payments/src/ports.ts), so the composition root
 * binds `ledger: financeLedgerForPayments(finance)`. Every money call carries the scope payments authorized
 * (ADR-0015): finance grants its posting permissions at that property only and refuses a folio or booking of
 * another property or legal entity before anything moves. Payments calls only after the provider confirmed (or a
 * Route D payment is recorded), inside its own transaction and savepoint. Cash recorded without an open cashier
 * session is posted and flagged instead of refused. Deposits have no folio posting: their `postingId` carries the
 * journal entry id.
 */
export function financeLedgerForPayments(service: FinanceService) {
  const perms = PROVIDER_DELEGATION.payments ?? [];
  /** Property-scoped delegation; `null` = legal-entity operations only (payouts, disputes). */
  const d = (tx: TxContext, propertyId: string | null) => delegated(tx, perms, propertyId);
  const scope = (s: LedgerScope) => ({ propertyId: s.propertyId, legalEntityId: s.legalEntityId });
  return {
    describeTarget: (tx: TxContext, ref: { type: 'folio' | 'booking'; id: string }) =>
      service.describeTarget(d(tx, null), ref),
    async recordPayment(
      tx: TxContext,
      input: LedgerScope & {
        folioId: string;
        amount: Money;
        paymentRef: EntityRef;
        method: LedgerMethod;
        idempotencyKey: string;
        verification: Verification;
        clearing: ClearingRef;
      },
    ): Promise<{ postingId: string }> {
      const t = d(tx, input.propertyId);
      await service.assertTargetInScope(t, { type: 'folio', id: input.folioId }, scope(input));
      const r = await service.recordPayment(t, {
        folioId: input.folioId,
        amount: input.amount,
        paymentRef: input.paymentRef,
        method: clearingMethod(input.clearing, input.method),
        provider: clearingProvider(input.clearing),
        idempotencyKey: input.idempotencyKey,
        verification: input.verification,
        cashWithoutSession: 'flag',
      });
      return { postingId: r.postingId };
    },
    async recordDeposit(
      tx: TxContext,
      input: LedgerScope & {
        bookingId: string;
        amount: Money;
        paymentRef: EntityRef;
        idempotencyKey: string;
        method: LedgerMethod;
        verification: Verification;
        clearing: ClearingRef;
      },
    ): Promise<{ postingId: string }> {
      const t = d(tx, input.propertyId);
      await service.assertTargetInScope(t, { type: 'booking', id: input.bookingId }, scope(input));
      const r = await service.recordDeposit(t, {
        bookingId: input.bookingId,
        amount: input.amount,
        paymentRef: input.paymentRef,
        idempotencyKey: input.idempotencyKey,
        propertyId: input.propertyId,
        method: clearingMethod(input.clearing, input.method),
        provider: clearingProvider(input.clearing),
        verification: input.verification,
        cashWithoutSession: 'flag',
      });
      return { postingId: r.entryId };
    },
    async recordRefund(
      tx: TxContext,
      input: LedgerScope & {
        folioId: string | null;
        bookingId: string | null;
        amount: Money;
        refundRef: EntityRef;
        originalPaymentRef: EntityRef;
        idempotencyKey: string;
        clearing: ClearingRef;
      },
    ): Promise<{ postingId: string }> {
      const t = d(tx, input.propertyId);
      const common = {
        amount: input.amount,
        refundRef: input.refundRef,
        originalPaymentRef: input.originalPaymentRef,
        idempotencyKey: input.idempotencyKey,
        cashWithoutSession: 'flag' as const,
      };
      if (input.folioId) {
        await service.assertTargetInScope(t, { type: 'folio', id: input.folioId }, scope(input));
        return {
          postingId: (await service.recordRefund(t, { folioId: input.folioId, ...common })).postingId,
        };
      }
      if (!input.bookingId)
        throw new ValidationError(
          'target_required',
          'A refund needs the folio or booking of the original payment.',
        );
      await service.assertTargetInScope(t, { type: 'booking', id: input.bookingId }, scope(input));
      // Deposit still held → deposit refund; already applied to a folio → refund on that folio.
      const held = await service.getDeposits(t, input.bookingId);
      if (held && held.balance.amountMinor >= input.amount.amountMinor) {
        const r = await service.refundDeposit(t, { bookingId: input.bookingId, ...common });
        return { postingId: r.entryId };
      }
      const applied = [...(held?.movements ?? [])].reverse().find((m) => m.kind === 'applied' && m.folioId);
      if (!applied?.folioId) {
        throw new BusinessRuleError(
          'deposit_insufficient',
          'The deposit held for this booking is smaller than the refund and was not applied to a folio.',
        );
      }
      return {
        postingId: (await service.recordRefund(t, { folioId: applied.folioId, ...common })).postingId,
      };
    },
    async recordPayout(
      tx: TxContext,
      input: {
        legalEntityId: string;
        payoutRef: EntityRef;
        gross: Money;
        fees: Money;
        net: Money;
        currency: string;
        clearing: ClearingRef;
        idempotencyKey: string;
      },
    ): Promise<{ journalEntryId: string }> {
      const { clearing, ...rest } = input;
      const r = await service.recordPayout(d(tx, null), { ...rest, provider: clearingProvider(clearing) });
      return { journalEntryId: r.entryId };
    },
    async recordPaymentAdjustment(
      tx: TxContext,
      input: LedgerScope & {
        folioId: string | null;
        bookingId: string | null;
        amount: Money;
        paymentRef: EntityRef;
        adjustmentRef: EntityRef;
        reason: string;
        idempotencyKey: string;
        clearing: ClearingRef;
      },
    ): Promise<{ postingId: string }> {
      const t = d(tx, input.propertyId);
      const target = input.folioId
        ? { type: 'folio' as const, id: input.folioId }
        : { type: 'booking' as const, id: input.bookingId ?? '' };
      if (!input.folioId && !input.bookingId)
        throw new ValidationError(
          'target_required',
          'An adjustment needs the folio or booking of the payment.',
        );
      await service.assertTargetInScope(t, target, scope(input));
      const { clearing: _c, propertyId: _p, legalEntityId: _l, ...rest } = input;
      return { postingId: (await service.recordPaymentAdjustment(t, rest)).postingId };
    },
    async recordDisputeMovement(
      tx: TxContext,
      input: {
        legalEntityId: string;
        paymentRef: EntityRef;
        disputeRef: EntityRef;
        amount: Money;
        kind: 'debit' | 'reversal';
        clearing: ClearingRef;
        idempotencyKey: string;
      },
    ): Promise<{ journalEntryId: string }> {
      const { clearing, ...rest } = input;
      const r = await service.recordDisputeMovement(d(tx, null), {
        ...rest,
        provider: clearingProvider(clearing),
      });
      return { journalEntryId: r.journalEntryId };
    },
    async markPaymentVerified(
      tx: TxContext,
      input: LedgerScope & { paymentRef: EntityRef; evidenceRef: EntityRef; idempotencyKey: string },
    ): Promise<void> {
      await service.markPaymentVerified(d(tx, input.propertyId), {
        paymentRef: input.paymentRef,
        evidenceRef: input.evidenceRef,
        idempotencyKey: input.idempotencyKey,
        scope: scope(input),
      });
    },
    async recordSettlementFees(
      tx: TxContext,
      input: LedgerScope & {
        statementRef: EntityRef;
        amount: Money;
        clearing: ClearingRef;
        idempotencyKey: string;
      },
    ): Promise<{ journalEntryId: string }> {
      const t = d(tx, input.propertyId);
      await service.assertPropertyScope(t, scope(input));
      const r = await service.recordSettlementFees(t, {
        legalEntityId: input.legalEntityId,
        statementRef: input.statementRef,
        amount: input.amount,
        provider: clearingProvider(input.clearing),
        idempotencyKey: input.idempotencyKey,
      });
      return { journalEntryId: r.journalEntryId };
    },
  };
}

/** Reservations' payer reference (modules/reservations/src/ports.ts `PayerRef`). */
type ReservationsPayer = { type: 'profile' | 'company' | 'agency' | 'house'; id: string };
/** Reservations' `TaxLine` (taxes it already knows, e.g. a channel's prepaid total). */
type ReservationsTaxLine = {
  code: string;
  name: string;
  kind: 'tax' | 'fee';
  amount: Money;
  ruleVersionId?: string;
  basis?: 'percentage' | 'banded' | 'per_person_night' | 'per_unit_night' | 'per_stay' | 'fixed_per_charge';
};

/**
 * A reservations tax line → finance's provided tax line. Quantity-based lines (Green Tax) are levies outside the GST
 * base; a value-based `fee` is a service charge inside it; the rest is tax. The code names the tax account and must
 * already exist in the chart (`tax:<code>`), or the posting is refused.
 */
export function fromReservationsTaxLine(t: ReservationsTaxLine): ProvidedTaxLineInput {
  const quantityBased = t.basis !== undefined && t.basis !== 'percentage' && t.basis !== 'banded';
  return {
    ruleId: t.code,
    ruleVersionId: t.ruleVersionId ?? `provided:${t.code}`,
    name: t.name,
    accountKey: t.code,
    amount: t.amount,
    kind: quantityBased ? 'fee' : t.kind === 'fee' ? 'service_charge' : 'tax',
  };
}

/**
 * The `FinancePort` the reservations module declares (modules/reservations/src/ports.ts), for direct binding:
 * `finance: financeForReservations(finance)`. Calls that carry `propertyId` are delegated at that property only
 * (ADR-0015); the others act on records reservations already resolved (their property is checked against the
 * caller's own finance scope when reservations adds `propertyId` — contract change requested). Payers come as ids:
 * the payer directory names them, otherwise the folio keeps a flagged placeholder and a live tax invoice asks for
 * the buyer's name. Booking-level fees open a booking folio when the booking has none.
 */
export function financeForReservations(service: FinanceService) {
  const perms = PROVIDER_DELEGATION.reservations ?? [];
  const d = (tx: TxContext, propertyId?: string) => delegated(tx, perms, propertyId);
  const payerType = (t: ReservationsPayer['type']): 'guest' | 'company' | 'agency' | 'house' =>
    t === 'profile' ? 'guest' : t;
  const toReservationsPayer = (p: { type: string; id?: string }): ReservationsPayer => ({
    type: p.type === 'company' || p.type === 'agency' || p.type === 'house' ? p.type : 'profile',
    id: p.id ?? '',
  });
  const ruleOwner = (o: EntityRef) => {
    if (o.type !== 'stay' && o.type !== 'booking' && o.type !== 'group') {
      throw new ValidationError('invalid_rule_owner', 'Billing rules belong to a stay, booking or group.');
    }
    return { type: o.type, id: o.id } as { type: 'stay' | 'booking' | 'group'; id: string };
  };
  const chargeTarget = (o: EntityRef) => {
    if (o.type !== 'stay' && o.type !== 'booking' && o.type !== 'group') {
      throw new ValidationError(
        'invalid_charge_target',
        `Charges are posted to a stay, booking or group (or a folio), not to a ${o.type}.`,
      );
    }
    return { type: o.type, id: o.id } as { type: 'stay' | 'booking' | 'group'; id: string };
  };
  const folioOwner = (o: EntityRef) => {
    if (!['stay', 'booking', 'group', 'company', 'house'].includes(o.type)) {
      throw new ValidationError(
        'invalid_folio_owner',
        'A folio belongs to a stay, booking, group, company or house account.',
      );
    }
    return o as { type: 'stay' | 'booking' | 'group' | 'company' | 'house'; id: string };
  };
  const groups = (list: string[]): ChargeGroup[] => {
    const unknown = list.filter((g) => !(CHARGE_GROUPS as readonly string[]).includes(g));
    if (unknown.length) {
      throw new ValidationError(
        'unknown_charge_group',
        `Unknown charge group(s): ${unknown.join(', ')}. Use one of: ${CHARGE_GROUPS.join(', ')}.`,
        { unknown },
      );
    }
    return list as ChargeGroup[];
  };
  return {
    async openFolio(
      tx: TxContext,
      input: { propertyId: string; owner: EntityRef; payer: ReservationsPayer; label?: string },
    ): Promise<{ folioId: string }> {
      const type = payerType(input.payer.type);
      return service.openFolio(d(tx, input.propertyId), {
        propertyId: input.propertyId,
        owner: folioOwner(input.owner),
        payer: { type, ...(type === 'house' || !input.payer.id ? {} : { id: input.payer.id }) },
        ...(input.label ? { label: input.label } : {}),
      });
    },
    async postCharge(
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
        taxLines?: ReservationsTaxLine[];
        reason?: string;
      },
    ): Promise<{ postingIds: string[]; folioId: string }> {
      const t = d(tx, input.propertyId);
      const target = input.target ? chargeTarget(input.target) : undefined;
      // A booking-level fee (e.g. cancellation of a booking that never checked in) gets a booking folio.
      if (target?.type === 'booking' && !input.folioId) {
        const existing = await service.listFolios(t, { owner: target });
        if (!existing.length) {
          await service.openFolio(t, {
            propertyId: input.propertyId,
            owner: target,
            payer: { type: 'guest' },
            label: 'Booking charges',
          });
        }
      }
      const { target: _t, taxLines, ...rest } = input;
      const r = await service.postCharge(t, {
        ...rest,
        ...(target ? { target } : {}),
        ...(taxLines ? { taxLines: taxLines.map(fromReservationsTaxLine) } : {}),
      });
      return { postingIds: r.postingIds, folioId: r.folioId };
    },
    async recordDeposit(
      tx: TxContext,
      input: {
        bookingId: string;
        amount: Money;
        paymentRef: EntityRef;
        idempotencyKey: string;
        propertyId?: string;
      },
    ): Promise<void> {
      await service.recordDeposit(d(tx, input.propertyId), input);
    },
    async applyDeposits(
      tx: TxContext,
      input: { bookingId: string; toFolioId: string; propertyId?: string },
    ): Promise<{ applied: Money } | undefined> {
      const r = await service.applyDeposits(d(tx, input.propertyId), {
        bookingId: input.bookingId,
        toFolioId: input.toFolioId,
      });
      return r.entryId ? { applied: r.applied } : undefined;
    },
    async getFolioBalance(
      tx: TxContext,
      folioId: string,
    ): Promise<{ folioId: string; balance: Money; status: string }> {
      const f = await service.getFolio(d(tx), folioId);
      return { folioId, balance: f.balance, status: f.status.folio };
    },
    async listFolios(
      tx: TxContext,
      input: { owner: EntityRef; propertyId?: string },
    ): Promise<
      Array<{
        folioId: string;
        owner: EntityRef;
        payer: ReservationsPayer;
        label?: string;
        isDefault: boolean;
        status: 'open' | 'settled';
        balance: Money;
      }>
    > {
      const folios = await service.listFolios(d(tx, input.propertyId), { owner: folioOwner(input.owner) });
      return folios
        .filter((f) => f.status.folio !== 'voided')
        .map((f) => ({
          folioId: f.id,
          owner: f.attachedTo,
          payer: toReservationsPayer(f.payer),
          ...(f.label ? { label: f.label } : {}),
          isDefault: f.isDefault,
          status: f.status.folio === 'open' ? ('open' as const) : ('settled' as const),
          balance: f.balance,
        }));
    },
    async setBillingRules(
      tx: TxContext,
      input: {
        owner: EntityRef;
        propertyId?: string;
        rules: Array<{
          destinationFolioId: string;
          chargeCodeGroups: string[];
          serviceDates?: { from: LocalDate; to: LocalDate };
          cap?: { kind: 'per_night' | 'per_stay'; amount: Money };
          source: 'manual' | 'company_default' | 'rate_plan' | 'group' | 'package';
        }>;
      },
    ): Promise<{ ruleIds: string[] }> {
      const r = await service.mergeBillingRules(d(tx, input.propertyId), {
        owner: ruleOwner(input.owner),
        rules: input.rules.map((rule) => ({
          destinationFolioId: rule.destinationFolioId,
          label: `${rule.source.replace('_', ' ')}: ${rule.chargeCodeGroups.join(', ') || 'all charges'}`,
          selector: {
            chargeGroups: groups(rule.chargeCodeGroups),
            ...(rule.serviceDates
              ? { serviceDateFrom: rule.serviceDates.from, serviceDateTo: rule.serviceDates.to }
              : {}),
          },
          cap: rule.cap
            ? {
                kind: rule.cap.kind,
                amountMinor: rule.cap.amount.amountMinor,
                currency: rule.cap.amount.currency,
              }
            : null,
          source: rule.source,
        })),
      });
      return { ruleIds: r.ruleIds };
    },
    async getDepositBalance(tx: TxContext, input: { bookingId: string }): Promise<Money | null> {
      return (await service.getDeposits(d(tx), input.bookingId))?.balance ?? null;
    },
  };
}

/** Event consumers: departure from reservations closes per-stay allowance periods and enables late-charge handling. */
export function financeSubscriptions(service: FinanceService, ports: FinancePorts): TxEventSubscription[] {
  return [
    {
      consumer: 'finance.stay-departure',
      types: ['reservations.stay.checkedOut'],
      async handle(tx, event) {
        const p = event.payload as Record<string, unknown>;
        const stayId = typeof p.stayId === 'string' ? p.stayId : event.aggregate.id;
        const propertyId = typeof p.propertyId === 'string' ? p.propertyId : event.propertyId;
        if (!propertyId) return;
        const candidate = p.businessDate ?? p.departureDate;
        const departedOn: LocalDate = isLocalDate(candidate)
          ? candidate
          : await ports.platform.getBusinessDate(tx, propertyId);
        await service.markOwnerDeparted(tx, { propertyId, owner: { type: 'stay', id: stayId }, departedOn });
        await service.closeAllowances(tx, { stayId, upTo: '9999-12-31' });
      },
    },
  ];
}
