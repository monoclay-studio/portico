import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  advanceBusinessDate,
  assertLedgerIntegrity,
  type Harness,
  openStay,
  setupOrg,
  startHarness,
  usd,
} from './helpers';

/**
 * S19 — A guest's bill combines a package (room + daily dining allowance), allowance consumption with overuse
 * and breakage, different taxes (service charge inside the TGST base, Green Tax per guest-day outside it, a
 * child under 2 exempt) and partial payments in two currencies. Folio, journal, tax reports, invoice and trial
 * balance reconcile to the minor unit.
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.t.drop());

describe('S19: packages, allowances, different taxes and partial payments reconcile', () => {
  it('reconciles folio, journal, tax reports, invoice and trial balance', async () => {
    const org = await setupOrg(h);
    const { stayId, guestFolioId } = await openStay(h, org, { guest: 'The Haddad family' });
    const occupancy = { adults: 2, childrenAges: [1] };
    const night = async (date: string) => {
      await org.run((tx) =>
        h.finance.postCharge(tx, {
          propertyId: org.propertyId,
          target: { type: 'stay', id: stayId },
          chargeCode: 'ROOM',
          amount: usd(30000),
          quantity: 1,
          serviceDate: date,
          description: 'Beach villa — half board package (room)',
          sourceRef: { type: 'stay', id: stayId },
          idempotencyKey: `room:${stayId}:${date}`,
          occupancy,
        }),
      );
      await org.run((tx) =>
        h.finance.grantAllowance(tx, {
          propertyId: org.propertyId,
          stayId,
          folioId: guestFolioId,
          definitionRef: 'hb-dining-credit',
          label: 'Dining credit',
          period: { night: date },
          amount: usd(10000),
          chargeCode: 'ALLOW',
          eligibleTags: ['dining'],
          coversTaxes: true,
          unusedPolicy: 'forfeit',
          idempotencyKey: `inclusion:${stayId}:dining:${date}`,
        }),
      );
    };
    const outlet = (code: string, amount: number, date: string, key: string) =>
      org.run((tx) =>
        h.finance.postCharge(tx, {
          propertyId: org.propertyId,
          target: { type: 'stay', id: stayId },
          chargeCode: code,
          amount: usd(amount),
          serviceDate: date,
          description: code,
          sourceRef: { type: 'pos_check', id: key },
          idempotencyKey: `pos:${key}:${stayId}`,
          allowanceRef: 'auto',
        }),
      );

    // Night 1
    await night('2026-11-07');
    const dinner = await outlet('FOOD', 8000, '2026-11-07', 'dinner-1'); // 102.96 gross; allowance covers 100.00
    expect(dinner.allowanceUsage).toEqual(usd(10000));
    const spa = await outlet('SPA', 5000, '2026-11-07', 'spa-1'); // not eligible for the dining credit
    expect(spa.allowanceUsage).toBeNull();
    await org.run((tx) =>
      h.finance.recordPayment(tx, {
        folioId: guestFolioId,
        amount: usd(20000),
        paymentRef: { type: 'payment', id: newId() },
        method: 'card',
        provider: 'simulator',
        idempotencyKey: `pay1:${stayId}`,
      }),
    );
    expect((await org.run((tx) => h.finance.getFolio(tx, guestFolioId))).balance.amountMinor).toBe(37741);
    const closed1 = await org.run((tx) => h.finance.closeAllowances(tx, { stayId, upTo: '2026-11-08' }));
    expect(closed1.closed.map((c) => c.remaining.amountMinor)).toEqual([0]);

    // Night 2
    await advanceBusinessDate(org, '2026-11-07');
    await night('2026-11-08');
    const lunch = await outlet('FOOD', 4000, '2026-11-08', 'lunch-2'); // 51.48 fully covered, 48.52 left
    expect(lunch.allowanceUsage).toEqual(usd(5148));
    // Partial payment in MVR cash at the desk (explicit rate, cashier session).
    await org.run((tx) =>
      h.finance.recordFxRate(tx, {
        legalEntityId: org.legalEntityId,
        businessDate: '2026-11-08',
        fromCurrency: 'USD',
        toCurrency: 'MVR',
        rate: '15.42',
        source: 'MMA',
      }),
    );
    const session = await org.run((tx) =>
      h.finance.openCashierSession(tx, { propertyId: org.propertyId, openingFloats: { MVR: 50000 } }),
    );
    await org.run((tx) =>
      h.finance.collectPayment(tx, {
        folioId: guestFolioId,
        tenders: [{ method: 'cash', amount: { amountMinor: 154200, currency: 'MVR' } }],
        idempotencyKey: `cash:${stayId}`,
      }),
    );
    // Check-out: unused dining credit is forfeited to breakage revenue (not to the guest's bill).
    const closed2 = await org.run((tx) => h.finance.closeAllowances(tx, { stayId, upTo: '2026-11-09' }));
    expect(closed2.closed.map((c) => c.remaining.amountMinor)).toEqual([4852]);
    const before = await org.run((tx) => h.finance.getFolio(tx, guestFolioId));
    expect(before.balance.amountMinor).toBe(78751);
    await org.run((tx) =>
      h.finance.recordPayment(tx, {
        folioId: guestFolioId,
        amount: before.balance,
        paymentRef: { type: 'payment', id: newId() },
        method: 'card',
        provider: 'simulator',
        idempotencyKey: `pay2:${stayId}`,
      }),
    );

    // Invoice: value before tax (incl. service charge), tax charged, Green Tax stated separately, total.
    const invoice = await org.run((tx) =>
      h.finance.issueInvoice(tx, { folioId: guestFolioId, idempotencyKey: `inv:${stayId}` }),
    );
    expect(invoice.snapshot.totals).toEqual({
      valueBeforeTaxMinor: 97000 + 7700,
      serviceChargeMinor: 7700,
      taxChargedMinor: 14399,
      leviesMinor: 4800,
      outsideTaxBaseMinor: 0,
      totalMinor: 123899,
      settlementsMinor: -123899,
      balanceDueMinor: 0,
    });
    expect(invoice.snapshot.taxSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Green Tax', category: 'levy', amountMinor: 4800 }),
      ]),
    );

    // Folio = Σ postings = guest-ledger sub-account = 0 after settlement.
    const folio = await org.run(async (tx) =>
      h.finance.settleFolio(tx, guestFolioId, (await h.finance.getFolio(tx, guestFolioId)).version),
    );
    expect(folio.balance.amountMinor).toBe(0);

    // Tax reports reconcile with the invoice and the ledger.
    const days = await Promise.all(
      ['2026-11-07', '2026-11-08'].map((d) =>
        org.run((tx) => h.finance.dailyRevenue(tx, { propertyId: org.propertyId, businessDate: d })),
      ),
    );
    const taxBy = (code: string) =>
      days
        .flatMap((d) => d.taxes)
        .filter((t) => t.accountCode === code)
        .reduce((s, t) => s + t.amountMinor, 0);
    expect(taxBy('2200')).toBe(14399); // TGST
    expect(taxBy('2210')).toBe(4800); // Green Tax
    expect(taxBy('2220')).toBe(7700); // service charge
    const revenue = days.flatMap((d) => d.byChargeCode);
    expect(revenue.filter((r) => r.chargeCode === 'ROOM').reduce((s, r) => s + r.netMinor, 0)).toBe(60000);
    const green = await org.run((tx) =>
      h.finance.greenTaxReport(tx, { legalEntityId: org.legalEntityId, month: '2026-11' }),
    );
    expect(green.rows).toEqual([
      expect.objectContaining({
        rateCategory: 'mv.green_tax.12usd',
        guestDays: 4,
        exemptGuestDays: 2,
        amountMinor: 4800,
      }),
    ]);

    const tb = await org.run((tx) => h.finance.trialBalance(tx, { legalEntityId: org.legalEntityId }));
    expect(tb.balanced).toBe(true);
    const bal = (key: string) => tb.accounts.find((a) => a.systemKey === key)?.balanceMinor ?? 0;
    expect(bal('revenue:breakage')).toBe(-4852);
    expect(bal('allowance_clearing')).toBe(0);
    expect(bal('guest_ledger')).toBe(0);
    expect(bal('cash')).toBe(10000); // MVR 1,542.00 at 15.42 in USD
    await assertLedgerIntegrity(h, org);

    // Cash drawer: expected = float + cash taken; blind count balances.
    const closedSession = await org.run((tx) =>
      h.finance.closeCashierSession(tx, {
        sessionId: session.id,
        expectedVersion: session.version,
        counted: { MVR: 204200 },
      }),
    );
    expect(closedSession.status).toEqual({ session: 'closed', count: 'balanced' });
    // Per-method reconciliation summary: cash per currency, and the card payment taken during the session.
    expect(closedSession.byMethod).toEqual(
      expect.arrayContaining([
        { method: 'cash', currency: 'MVR', totalMinor: 154200, count: 1 },
        { method: 'card:simulator', currency: 'USD', totalMinor: 78751, count: 1 },
      ]),
    );
  });
});
