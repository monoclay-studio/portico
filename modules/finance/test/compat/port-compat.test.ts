import { describe, expect, it } from 'vitest';
import {
  createFinance,
  type FinancePorts,
  financeForReservations,
  financeLedgerForPayments,
  unavailableFinancePorts,
} from '../../src';
import type { LedgerPort } from './payments-ledger-port';
import type { FinancePort } from './reservations-finance-port';

/**
 * Compile-time regression for the steward's adapter probe (review-finance §1, typecheck/compat.ts): the adapters
 * the composition root binds must satisfy the ports their consumers declare, method by method with strict function
 * variance. `pnpm typecheck` fails when they drift; the runtime test only proves the bindings are complete.
 */
const platform = {} as FinancePorts['platform']; // never called: bindings only
type Fn<T> = T extends (...a: infer A) => infer R ? (...a: A) => R : never;

function bindings() {
  const finance = createFinance({ platform, ...unavailableFinancePorts() });
  const pay = financeLedgerForPayments(finance);
  const res = financeForReservations(finance);
  const ledger: LedgerPort = pay;
  const reservations: FinancePort = res;
  const payments: { [K in keyof LedgerPort]: Fn<LedgerPort[K]> } = {
    describeTarget: pay.describeTarget,
    recordPayment: pay.recordPayment,
    recordDeposit: pay.recordDeposit,
    recordRefund: pay.recordRefund,
    recordPayout: pay.recordPayout,
    recordPaymentAdjustment: pay.recordPaymentAdjustment,
    recordDisputeMovement: pay.recordDisputeMovement,
    markPaymentVerified: pay.markPaymentVerified,
    recordSettlementFees: pay.recordSettlementFees,
  };
  const forReservations: { [K in keyof FinancePort]: Fn<FinancePort[K]> } = {
    openFolio: res.openFolio,
    postCharge: res.postCharge,
    recordDeposit: res.recordDeposit,
    applyDeposits: res.applyDeposits,
    getFolioBalance: res.getFolioBalance,
    listFolios: res.listFolios,
    setBillingRules: res.setBillingRules,
    getDepositBalance: res.getDepositBalance,
  };
  return { ledger, reservations, payments, forReservations };
}

describe('adapters satisfy their consumers’ ports', () => {
  it('binds every method of the payments LedgerPort and the reservations FinancePort', () => {
    const b = bindings();
    expect(Object.values(b.payments).every((f) => typeof f === 'function')).toBe(true);
    expect(Object.values(b.forReservations).every((f) => typeof f === 'function')).toBe(true);
  });
});
