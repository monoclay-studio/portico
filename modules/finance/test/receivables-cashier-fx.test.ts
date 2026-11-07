import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertLedgerIntegrity,
  type Harness,
  type Org,
  openStay,
  setupOrg,
  startHarness,
  usd,
} from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.t.drop());

async function chargedFolio(org: Org, amount: number, payer = 'Sun Travel DMC') {
  const s = await openStay(h, org, { guest: payer });
  await org.run(
    (tx) =>
      h.finance.postCharge(tx, {
        propertyId: org.propertyId,
        folioId: s.guestFolioId,
        chargeCode: 'MISC',
        amount: usd(amount),
        serviceDate: '2026-11-07',
        description: 'Stay',
        sourceRef: { type: 't', id: s.stayId },
        idempotencyKey: `c:${s.stayId}`,
        taxMode: 'provided',
        taxLines: [],
      }),
    { ...org.ctx, actor: { kind: 'system', process: 'test' } },
  );
  return s;
}

describe('receivables (city ledger)', () => {
  it('enforces credit limits (block with override, or warn), allocates payments and ages by due date', async () => {
    const org = await setupOrg(h);
    const acct = await org.run((tx) =>
      h.finance.createReceivablesAccount(tx, {
        legalEntityId: org.legalEntityId,
        companyId: newId(),
        kind: 'agency',
        name: 'Sun Travel DMC',
        currency: 'USD',
        termsDays: 30,
        creditLimitMinor: 100000,
        creditLimitMode: 'block',
      }),
    );
    const a = await chargedFolio(org, 80000);
    const b = await chargedFolio(org, 50000);
    const t1 = await org.run((tx) =>
      h.finance.transferToReceivables(tx, {
        folioId: a.guestFolioId,
        receivablesAccountId: acct.id,
        idempotencyKey: `ar:${a.stayId}`,
      }),
    );
    expect(t1.creditWarning).toBeNull();
    // Over the limit: blocked without override, and the override needs its own permission.
    await expect(
      org.run((tx) =>
        h.finance.transferToReceivables(tx, {
          folioId: b.guestFolioId,
          receivablesAccountId: acct.id,
          idempotencyKey: `ar:${b.stayId}`,
        }),
      ),
    ).rejects.toThrow(/credit limit/);
    await expect(
      org.run(
        (tx) =>
          h.finance.transferToReceivables(tx, {
            folioId: b.guestFolioId,
            receivablesAccountId: acct.id,
            overrideCreditLimit: true,
            idempotencyKey: `ar2:${b.stayId}`,
          }),
        org.as(['finance.folio.settleToReceivables', 'finance.invoice.issue']),
      ),
    ).rejects.toThrow(/finance\.creditLimit\.override/);
    const t2 = await org.run((tx) =>
      h.finance.transferToReceivables(tx, {
        folioId: b.guestFolioId,
        receivablesAccountId: acct.id,
        overrideCreditLimit: true,
        idempotencyKey: `ar3:${b.stayId}`,
      }),
    );
    expect(t2.creditWarning).toMatch(/Approved by override/);
    const account = await org.run((tx) => h.finance.getReceivablesAccount(tx, acct.id));
    expect(account).toMatchObject({
      balance: usd(130000),
      status: { account: 'active', credit: 'over_limit' },
    });
    expect(account.issues.map((i) => i.code)).toContain('over_credit_limit');

    // Payment of 1,000.00 by bank transfer: 800.00 allocated to the first invoice, 200.00 left unallocated.
    const items = await org.run((tx) => h.finance.listReceivablesItems(tx, acct.id));
    const pay = await org.run((tx) =>
      h.finance.recordReceivablesPayment(tx, {
        accountId: acct.id,
        amount: usd(100000),
        method: 'bank_transfer',
        reference: 'SWIFT 8812',
        allocations: [{ itemId: items[0]?.id as string, amountMinor: 80000 }],
        idempotencyKey: `arpay:${acct.id}`,
      }),
    );
    expect(pay.unallocated).toEqual(usd(20000));
    const aging = await org.run((tx) =>
      h.finance.receivablesAging(tx, { legalEntityId: org.legalEntityId, asOf: '2027-01-10' }),
    );
    expect(aging.accounts[0]).toMatchObject({
      buckets: { current: 0, d1_30: 0, d31_60: 50000, d61_90: 0, over_90: 0 },
      unallocatedCredits: 20000,
      balance: 30000,
    });
    // Over-allocation is refused.
    await expect(
      org.run((tx) =>
        h.finance.allocateReceivablesPayment(tx, {
          accountId: acct.id,
          paymentItemId: pay.itemId,
          allocations: [{ itemId: items[1]?.id as string, amountMinor: 30000 }],
        }),
      ),
    ).rejects.toThrow(/exceed/);
    await assertLedgerIntegrity(h, org);
  });

  it('a warn-mode limit lets the transfer through and raises a routine exception', async () => {
    const org = await setupOrg(h);
    const acct = await org.run((tx) =>
      h.finance.createReceivablesAccount(tx, {
        legalEntityId: org.legalEntityId,
        companyId: newId(),
        kind: 'company',
        name: 'Atoll Telecom',
        currency: 'USD',
        termsDays: 15,
        creditLimitMinor: 1000,
        creditLimitMode: 'warn',
      }),
    );
    const a = await chargedFolio(org, 5000);
    const t = await org.run((tx) =>
      h.finance.transferToReceivables(tx, {
        folioId: a.guestFolioId,
        receivablesAccountId: acct.id,
        idempotencyKey: `w:${a.stayId}`,
      }),
    );
    expect(t.creditWarning).toMatch(/advisory/);
    const ex = await org.run((tx) => h.finance.listExceptions(tx, { propertyId: org.propertyId }));
    expect(ex.map((e) => e.kind)).toContain('credit_limit_exceeded');
  });
});

describe('cashier sessions', () => {
  it('requires an open session for cash, posts variance to over/short at a blind close, and handles paid-outs', async () => {
    const org = await setupOrg(h);
    const s = await chargedFolio(org, 30000, 'Walk-in guest');
    await expect(
      org.run((tx) =>
        h.finance.collectPayment(tx, {
          folioId: s.guestFolioId,
          tenders: [{ method: 'cash', amount: usd(10000) }],
          idempotencyKey: 'c0',
        }),
      ),
    ).rejects.toThrow(/open cashier session/);
    const session = await org.run((tx) =>
      h.finance.openCashierSession(tx, { propertyId: org.propertyId, openingFloats: { USD: 20000 } }),
    );
    await expect(
      org.run((tx) =>
        h.finance.openCashierSession(tx, { propertyId: org.propertyId, openingFloats: { USD: 0 } }),
      ),
    ).rejects.toThrow(/already have an open cashier session/);
    // Split tender: cash + bank transfer.
    const paid = await org.run((tx) =>
      h.finance.collectPayment(tx, {
        folioId: s.guestFolioId,
        tenders: [
          { method: 'cash', amount: usd(10000) },
          { method: 'bank_transfer', amount: usd(5000), reference: 'BML 4471' },
        ],
        idempotencyKey: 'c1',
      }),
    );
    expect(paid.balance).toEqual(usd(15000));
    await org.run((tx) =>
      h.finance.recordPaidOut(tx, {
        sessionId: session.id,
        folioId: s.guestFolioId,
        amount: usd(2000),
        description: 'Taxi fare advanced to guest',
        idempotencyKey: 'po1',
      }),
    );
    const open = await org.run((tx) => h.finance.getCashierSession(tx, session.id));
    expect(open.expected).toEqual({ USD: 28000 });
    const closed = await org.run((tx) =>
      h.finance.closeCashierSession(tx, {
        sessionId: session.id,
        expectedVersion: open.version,
        counted: { USD: 27500 },
        note: 'short 5.00',
      }),
    );
    expect(closed).toMatchObject({ status: { session: 'closed', count: 'short' }, variance: { USD: -500 } });
    const tb = await org.run((tx) => h.finance.trialBalance(tx, { legalEntityId: org.legalEntityId }));
    expect(tb.accounts.find((a) => a.systemKey === 'cash_over_short')?.balanceMinor).toBe(500);
    expect(tb.accounts.find((a) => a.systemKey === 'cash')?.balanceMinor).toBe(10000 - 2000 - 500);
    expect((await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId))).balance).toEqual(usd(17000));
    await assertLedgerIntegrity(h, org);
  });
});

describe('payments, refunds, payouts and FX', () => {
  it('records refunds as linked postings, never more than paid, and payouts never touch revenue', async () => {
    const org = await setupOrg(h);
    const s = await chargedFolio(org, 50000, 'Card guest');
    const paymentRef = { type: 'payment', id: newId() };
    const pay = await org.run((tx) =>
      h.finance.recordPayment(tx, {
        folioId: s.guestFolioId,
        amount: usd(50000),
        paymentRef,
        method: 'card',
        provider: 'stripe',
        idempotencyKey: `p:${s.stayId}`,
      }),
    );
    const refundRef = { type: 'refund', id: newId() };
    const refund = () =>
      org.run((tx) =>
        h.finance.recordRefund(tx, {
          folioId: s.guestFolioId,
          amount: usd(20000),
          refundRef,
          originalPaymentRef: paymentRef,
          idempotencyKey: `r:${s.stayId}`,
        }),
      );
    const r1 = await refund();
    const r2 = await refund(); // retried after an interruption (S06)
    expect(r2).toMatchObject({ replayed: true, postingId: r1.postingId });
    await expect(
      org.run((tx) =>
        h.finance.recordRefund(tx, {
          folioId: s.guestFolioId,
          amount: usd(40000),
          refundRef: { type: 'refund', id: newId() },
          originalPaymentRef: paymentRef,
          idempotencyKey: `r2:${s.stayId}`,
        }),
      ),
    ).rejects.toThrow(/Only 30000/);
    const folio = await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId));
    expect(folio.postings.find((p) => p.id === pay.postingId)?.amount).toEqual(usd(-50000));
    expect(folio.postings.find((p) => p.id === r1.postingId)).toMatchObject({
      kind: 'refund',
      correctsPostingId: pay.postingId,
    });
    const payout = await org.run((tx) =>
      h.finance.recordPayout(tx, {
        legalEntityId: org.legalEntityId,
        payoutRef: { type: 'payout', id: 'po_1' },
        gross: usd(30000),
        fees: usd(900),
        net: usd(29100),
        currency: 'USD',
        provider: 'stripe',
        idempotencyKey: 'payout:po_1',
      }),
    );
    expect(
      (
        await org.run((tx) =>
          h.finance.recordPayout(tx, {
            legalEntityId: org.legalEntityId,
            payoutRef: { type: 'payout', id: 'po_1' },
            gross: usd(30000),
            fees: usd(900),
            net: usd(29100),
            currency: 'USD',
            provider: 'stripe',
            idempotencyKey: 'payout:po_1',
          }),
        )
      ).entryId,
    ).toBe(payout.entryId);
    const tb = await org.run((tx) => h.finance.trialBalance(tx, { legalEntityId: org.legalEntityId }));
    const bal = (k: string) => tb.accounts.find((a) => a.systemKey === k)?.balanceMinor ?? 0;
    expect(bal('card_clearing:stripe')).toBe(0);
    expect(bal('bank')).toBe(29100);
    expect(bal('payment_fees')).toBe(900);
    expect(bal('revenue:misc')).toBe(-50000); // only the original charge; the payout created no revenue
    await assertLedgerIntegrity(h, org);
  });

  it('converts foreign-currency charges and payments explicitly and realizes FX differences on settlement', async () => {
    const org = await setupOrg(h);
    await org.run((tx) =>
      h.finance.recordFxRate(tx, {
        legalEntityId: org.legalEntityId,
        businessDate: '2026-11-07',
        fromCurrency: 'USD',
        toCurrency: 'MVR',
        rate: '15.42',
        source: 'MMA',
      }),
    );
    const s = await openStay(h, org);
    // An MVR boutique charge on a USD folio: 154.20 MVR = 10.00 USD net (+ 17% TGST on goods).
    const c = await org.run((tx) =>
      h.finance.postCharge(tx, {
        propertyId: org.propertyId,
        folioId: s.guestFolioId,
        chargeCode: 'RETAIL',
        amount: { amountMinor: 15420, currency: 'MVR' },
        serviceDate: '2026-11-07',
        description: 'Local crafts',
        sourceRef: { type: 't', id: 'r' },
        idempotencyKey: `fx:${s.stayId}`,
      }),
    );
    const folio = await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId));
    expect(folio.balance).toEqual(usd(1170));
    expect(folio.postings.find((p) => p.id === c.postingIds[0])?.originalAmount).toEqual({
      amountMinor: 15420,
      currency: 'MVR',
    });
    // MVR cash taken (session) then sold to the bank at a better rate: realized FX gain.
    await org.run((tx) =>
      h.finance.openCashierSession(tx, { propertyId: org.propertyId, openingFloats: {} }),
    );
    await org.run((tx) =>
      h.finance.collectPayment(tx, {
        folioId: s.guestFolioId,
        tenders: [{ method: 'cash', amount: { amountMinor: 18041, currency: 'MVR' } }],
        idempotencyKey: 'mvr-cash',
      }),
    );
    expect((await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId))).balance).toEqual(usd(0));
    const settle = await org.run((tx) =>
      h.finance.recordFxSettlement(tx, {
        legalEntityId: org.legalEntityId,
        fromAccountKey: 'cash',
        amount: { amountMinor: 18041, currency: 'MVR' },
        settled: usd(1180),
        reference: 'Bank exchange slip 77',
        idempotencyKey: 'fxs1',
      }),
    );
    expect(settle.gainLossMinor).toBe(10); // carried 11.70 USD, received 11.80 USD
    const tb = await org.run((tx) => h.finance.trialBalance(tx, { legalEntityId: org.legalEntityId }));
    expect(tb.balanced).toBe(true);
    expect(tb.accounts.find((a) => a.systemKey === 'fx_gain_loss')?.balanceMinor).toBe(-10);
    await assertLedgerIntegrity(h, org);
    await expect(
      org.run((tx) =>
        h.finance.postCharge(tx, {
          propertyId: org.propertyId,
          folioId: s.guestFolioId,
          chargeCode: 'RETAIL',
          amount: { amountMinor: 1000, currency: 'EUR' },
          serviceDate: '2026-11-07',
          description: 'EUR item',
          sourceRef: { type: 't', id: 'e' },
          idempotencyKey: `eur:${s.stayId}`,
        }),
      ),
    ).rejects.toThrow(/No exchange rate EUR→USD/);
  });
});
