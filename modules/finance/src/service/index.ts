import type { TxContext, TxEventSubscription } from '@portico/db';
import {
  BusinessRuleError,
  type EntityRef,
  isLocalDate,
  type LocalDate,
  type Money,
  ValidationError,
} from '@portico/kernel';
import type { ChargeGroup } from '../domain/types';
import type { FinancePorts } from '../ports';
import * as allowances from './allowances';
import * as billingRules from './billing-rules';
import * as cashier from './cashier';
import * as deposits from './deposits';
import * as fiscal from './fiscal';
import * as folios from './folios';
import * as ledgerPort from './ledger-port';
import * as payouts from './payouts';
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

/**
 * The provider surface for another module (bound in the composition root). The calling module has already
 * authorized its own command (e.g. reservations.stay.checkIn); finance applies the finance permissions that
 * command implies, while still enforcing data authority, invariants, idempotency and audit (the real actor is
 * recorded). Sensitive finance actions (corrections, credit notes, write-offs) are never delegated.
 */
export function financeProvider(service: FinanceService, caller: keyof typeof PROVIDER_DELEGATION) {
  const perms = PROVIDER_DELEGATION[caller] ?? [];
  const d = (tx: TxContext) => delegated(tx, perms);
  return {
    openFolio: (tx: TxContext, input: Parameters<FinanceService['openFolio']>[1]) =>
      service.openFolio(d(tx), input),
    postCharge: (tx: TxContext, input: Parameters<FinanceService['postCharge']>[1]) =>
      service.postCharge(d(tx), input),
    recordPayment: (tx: TxContext, input: Parameters<FinanceService['recordPayment']>[1]) =>
      service.recordPayment(d(tx), input),
    recordRefund: (tx: TxContext, input: Parameters<FinanceService['recordRefund']>[1]) =>
      service.recordRefund(d(tx), input),
    recordDeposit: (tx: TxContext, input: Parameters<FinanceService['recordDeposit']>[1]) =>
      service.recordDeposit(d(tx), input),
    applyDeposits: (tx: TxContext, input: Parameters<FinanceService['applyDeposits']>[1]) =>
      service.applyDeposits(d(tx), input),
    recordPayout: (tx: TxContext, input: Parameters<FinanceService['recordPayout']>[1]) =>
      service.recordPayout(d(tx), input),
    getFolioBalance: (tx: TxContext, folioId: string) => service.getFolioBalance(d(tx), folioId),
    listFolios: (tx: TxContext, input: Parameters<FinanceService['listFolios']>[1]) =>
      service.listFolios(d(tx), input),
    getUnbalancedItems: (tx: TxContext, input: Parameters<FinanceService['getUnbalancedItems']>[1]) =>
      service.getUnbalancedItems(d(tx), input),
    markOwnerDeparted: (tx: TxContext, input: Parameters<FinanceService['markOwnerDeparted']>[1]) =>
      service.markOwnerDeparted(d(tx), input),
    grantAllowance: (tx: TxContext, input: Parameters<FinanceService['grantAllowance']>[1]) =>
      service.grantAllowance(d(tx), input),
    closeAllowances: (tx: TxContext, input: Parameters<FinanceService['closeAllowances']>[1]) =>
      service.closeAllowances(d(tx), input),
    createBillingRule: (tx: TxContext, input: Parameters<FinanceService['createBillingRule']>[1]) =>
      service.createBillingRule(d(tx), input),
  };
}

type LedgerMethod = 'card' | 'virtual_card' | 'payment_link' | 'external_terminal' | 'cash' | 'bank_transfer';
type Verification = 'provider_confirmed' | 'recorded_unverified' | 'recorded_verified';
/** Payments' clearing reference: one clearing account per provider (and provider account). */
type ClearingRef = { provider: 'simulator' | 'stripe_connect' | 'external_terminal' | 'cash' | 'bank_transfer'; accountId: string | null };
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
 * (ADR-0015): finance refuses a folio or booking of another property or legal entity before anything moves.
 * Payments calls only after the provider confirmed (or a Route D payment is recorded), inside its own transaction
 * and savepoint. Cash recorded without an open cashier session is posted and flagged instead of refused.
 * Deposits have no folio posting: their `postingId` carries the journal entry id.
 */
export function financeLedgerForPayments(service: FinanceService) {
  const d = (tx: TxContext) => delegated(tx, PROVIDER_DELEGATION.payments ?? []);
  const scope = (s: LedgerScope) => ({ propertyId: s.propertyId, legalEntityId: s.legalEntityId });
  return {
    describeTarget: (tx: TxContext, ref: { type: 'folio' | 'booking'; id: string }) => service.describeTarget(d(tx), ref),
    async recordPayment(
      tx: TxContext,
      input: LedgerScope & { folioId: string; amount: Money; paymentRef: EntityRef; method: LedgerMethod; idempotencyKey: string; verification: Verification; clearing: ClearingRef },
    ): Promise<{ postingId: string }> {
      await service.assertTargetInScope(d(tx), { type: 'folio', id: input.folioId }, scope(input));
      const r = await service.recordPayment(d(tx), {
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
      input: LedgerScope & { bookingId: string; amount: Money; paymentRef: EntityRef; idempotencyKey: string; method: LedgerMethod; verification: Verification; clearing: ClearingRef },
    ): Promise<{ postingId: string }> {
      await service.assertTargetInScope(d(tx), { type: 'booking', id: input.bookingId }, scope(input));
      const r = await service.recordDeposit(d(tx), {
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
      input: LedgerScope & { folioId: string | null; bookingId: string | null; amount: Money; refundRef: EntityRef; originalPaymentRef: EntityRef; idempotencyKey: string; clearing: ClearingRef },
    ): Promise<{ postingId: string }> {
      const common = { amount: input.amount, refundRef: input.refundRef, originalPaymentRef: input.originalPaymentRef, idempotencyKey: input.idempotencyKey, cashWithoutSession: 'flag' as const };
      if (input.folioId) {
        await service.assertTargetInScope(d(tx), { type: 'folio', id: input.folioId }, scope(input));
        return { postingId: (await service.recordRefund(d(tx), { folioId: input.folioId, ...common })).postingId };
      }
      if (!input.bookingId) throw new ValidationError('target_required', 'A refund needs the folio or booking of the original payment.');
      await service.assertTargetInScope(d(tx), { type: 'booking', id: input.bookingId }, scope(input));
      // Deposit still held → deposit refund; already applied to a folio → refund on that folio.
      const held = await service.getDeposits(d(tx), input.bookingId);
      if (held && held.balance.amountMinor >= input.amount.amountMinor) {
        const r = await service.refundDeposit(d(tx), { bookingId: input.bookingId, ...common });
        return { postingId: r.entryId };
      }
      const applied = [...(held?.movements ?? [])].reverse().find((m) => m.kind === 'applied' && m.folioId);
      if (!applied?.folioId) {
        throw new BusinessRuleError('deposit_insufficient', 'The deposit held for this booking is smaller than the refund and was not applied to a folio.');
      }
      return { postingId: (await service.recordRefund(d(tx), { folioId: applied.folioId, ...common })).postingId };
    },
    async recordPayout(
      tx: TxContext,
      input: { legalEntityId: string; payoutRef: EntityRef; gross: Money; fees: Money; net: Money; currency: string; clearing: ClearingRef; idempotencyKey: string },
    ): Promise<{ journalEntryId: string }> {
      const { clearing, ...rest } = input;
      return { journalEntryId: (await service.recordPayout(d(tx), { ...rest, provider: clearingProvider(clearing) })).entryId };
    },
    async recordPaymentAdjustment(
      tx: TxContext,
      input: LedgerScope & { folioId: string | null; bookingId: string | null; amount: Money; paymentRef: EntityRef; adjustmentRef: EntityRef; reason: string; idempotencyKey: string; clearing: ClearingRef },
    ): Promise<{ postingId: string }> {
      const target = input.folioId ? { type: 'folio' as const, id: input.folioId } : { type: 'booking' as const, id: input.bookingId ?? '' };
      await service.assertTargetInScope(d(tx), target, scope(input));
      const { clearing: _c, propertyId: _p, legalEntityId: _l, ...rest } = input;
      return { postingId: (await service.recordPaymentAdjustment(d(tx), rest)).postingId };
    },
    async recordDisputeMovement(
      tx: TxContext,
      input: { legalEntityId: string; paymentRef: EntityRef; disputeRef: EntityRef; amount: Money; kind: 'debit' | 'reversal'; clearing: ClearingRef; idempotencyKey: string },
    ): Promise<{ journalEntryId: string }> {
      const { clearing: _c, ...rest } = input;
      return { journalEntryId: (await service.recordDisputeMovement(d(tx), rest)).journalEntryId };
    },
    async markPaymentVerified(
      tx: TxContext,
      input: LedgerScope & { paymentRef: EntityRef; evidenceRef: EntityRef; idempotencyKey: string },
    ): Promise<void> {
      await service.markPaymentVerified(d(tx), {
        paymentRef: input.paymentRef,
        evidenceRef: input.evidenceRef,
        idempotencyKey: input.idempotencyKey,
        scope: scope(input),
      });
    },
    async recordSettlementFees(
      tx: TxContext,
      input: LedgerScope & { statementRef: EntityRef; amount: Money; clearing: ClearingRef; idempotencyKey: string },
    ): Promise<{ journalEntryId: string }> {
      await service.assertPropertyScope(d(tx), scope(input));
      const r = await service.recordSettlementFees(d(tx), {
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

/**
 * The `FinancePort` the reservations module declares (modules/reservations/src/ports.ts), for direct binding:
 * `finance: financeForReservations(finance)`. Payer names: reservations passes payer refs without names, so the
 * folio label (or a neutral default) is used until the guest/company name is supplied.
 */
export function financeForReservations(service: FinanceService) {
  const d = (tx: TxContext) => delegated(tx, PROVIDER_DELEGATION.reservations ?? []);
  const payerType = (t: string): 'guest' | 'company' | 'agency' | 'house' =>
    t === 'company' || t === 'agency' || t === 'house' ? t : 'guest';
  const ruleOwner = (o: EntityRef) => {
    if (o.type !== 'stay' && o.type !== 'booking' && o.type !== 'group') {
      throw new ValidationError('invalid_rule_owner', 'Billing rules belong to a stay, booking or group.');
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
  return {
    async openFolio(
      tx: TxContext,
      input: {
        propertyId: string;
        owner: EntityRef;
        payer: { type: string; id: string; name?: string };
        label?: string;
      },
    ) {
      const type = payerType(input.payer.type);
      const name =
        input.payer.name ??
        input.label ??
        (type === 'guest' ? 'Guest' : type === 'house' ? 'House account' : 'Company account');
      return service.openFolio(d(tx), {
        propertyId: input.propertyId,
        owner: folioOwner(input.owner),
        payer: { type, ...(type === 'house' ? {} : { id: input.payer.id }), name },
        ...(input.label ? { label: input.label } : {}),
      });
    },
    async postCharge(tx: TxContext, input: Parameters<FinanceService['postCharge']>[1]) {
      return service.postCharge(d(tx), input);
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
      await service.recordDeposit(d(tx), input);
    },
    async applyDeposits(tx: TxContext, input: { bookingId: string; toFolioId: string }) {
      const r = await service.applyDeposits(d(tx), input);
      return r.entryId ? { applied: r.applied } : undefined;
    },
    async getFolioBalance(tx: TxContext, folioId: string) {
      const f = await service.getFolio(d(tx), folioId);
      return { folioId, balance: f.balance, status: f.status.folio };
    },
    async listFolios(tx: TxContext, input: { owner: EntityRef }) {
      const folios = await service.listFolios(d(tx), { owner: folioOwner(input.owner) });
      return folios.map((f) => ({
        folioId: f.id,
        owner: f.attachedTo,
        payer: { type: f.payer.type === 'guest' ? 'profile' : f.payer.type, id: f.payer.id ?? '' },
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
        rules: Array<{
          destinationFolioId: string;
          chargeCodeGroups: string[];
          serviceDates?: { from: LocalDate; to: LocalDate };
          cap?: { kind: 'per_night' | 'per_stay'; amount: Money };
          source: 'manual' | 'company_default' | 'rate_plan' | 'group' | 'package';
        }>;
      },
    ) {
      return service.mergeBillingRules(d(tx), {
        owner: ruleOwner(input.owner),
        rules: input.rules.map((r) => ({
          destinationFolioId: r.destinationFolioId,
          label: `${r.source.replace('_', ' ')}: ${r.chargeCodeGroups.join(', ') || 'all charges'}`,
          selector: {
            chargeGroups: r.chargeCodeGroups as ChargeGroup[],
            ...(r.serviceDates
              ? { serviceDateFrom: r.serviceDates.from, serviceDateTo: r.serviceDates.to }
              : {}),
          },
          cap: r.cap
            ? { kind: r.cap.kind, amountMinor: r.cap.amount.amountMinor, currency: r.cap.amount.currency }
            : null,
          source: r.source,
        })),
      });
    },
    async getDepositBalance(tx: TxContext, input: { bookingId: string }): Promise<Money | null> {
      return (await service.getDeposits(d(tx), input.bookingId))?.balance ?? null;
    },
    markOwnerDeparted: (tx: TxContext, input: Parameters<FinanceService['markOwnerDeparted']>[1]) =>
      service.markOwnerDeparted(d(tx), input),
    grantAllowance: (tx: TxContext, input: Parameters<FinanceService['grantAllowance']>[1]) =>
      service.grantAllowance(d(tx), input),
    closeAllowances: (tx: TxContext, input: Parameters<FinanceService['closeAllowances']>[1]) =>
      service.closeAllowances(d(tx), input),
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
