import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { financeLedgerForPayments } from '../src';
import { assertLedgerIntegrity, type Harness, openStay, setupOrg, startHarness, usd } from './helpers';

/** The LedgerPort exactly as the payments module declares it (bound directly in the composition root). */
let h: Harness;
let ledger: ReturnType<typeof financeLedgerForPayments>;
beforeAll(async () => {
  h = await startHarness();
  ledger = financeLedgerForPayments(h.finance);
});
afterAll(async () => h?.t.drop());

describe('payments → finance LedgerPort', () => {
  it('records confirmed and recorded payments, flags unverified ones and cash without a session; replays retries', async () => {
    const org = await setupOrg(h);
    // Payments runs as the cashier who has no finance permissions of their own.
    const cashier = org.as(['payments.payment.collect']);
    const s = await openStay(h, org);
    const card = {
      folioId: s.guestFolioId,
      amount: usd(10000),
      paymentRef: { type: 'payment', id: newId() },
      method: 'external_terminal' as const,
      idempotencyKey: `payments:payment:${newId()}`,
      verification: 'recorded_unverified' as const,
    };
    const a = await org.run((tx) => ledger.recordPayment(tx, card), cashier);
    const b = await org.run((tx) => ledger.recordPayment(tx, card), cashier);
    expect(b.postingId).toBe(a.postingId);
    await org.run(
      (tx) =>
        ledger.recordPayment(tx, {
          folioId: s.guestFolioId,
          amount: usd(5000),
          paymentRef: { type: 'payment', id: newId() },
          method: 'cash',
          idempotencyKey: `cash:${s.stayId}`,
          verification: 'recorded_unverified',
        }),
      cashier,
    );
    const folio = await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId));
    expect(folio.balance).toEqual(usd(-15000));
    expect(folio.postings.map((p) => p.paymentVerification)).toEqual([
      'recorded_unverified',
      'recorded_unverified',
    ]);
    expect(folio.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['payments_awaiting_verification', 'cash_without_session']),
    );

    // Reconciliation finds the terminal payment was 99.00, not 100.00: linked correction.
    await org.run(
      (tx) =>
        ledger.recordPaymentAdjustment(tx, {
          folioId: s.guestFolioId,
          bookingId: null,
          amount: usd(-100),
          paymentRef: card.paymentRef,
          adjustmentRef: { type: 'payment_adjustment', id: newId() },
          reason: 'Statement shows 99.00',
          idempotencyKey: `adj:${s.stayId}`,
        }),
      cashier,
    );
    expect((await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId))).balance).toEqual(usd(-14900));

    // Refund part of the card payment (folio refund linked to the original payment).
    const refund = await org.run(
      (tx) =>
        ledger.recordRefund(tx, {
          folioId: s.guestFolioId,
          bookingId: null,
          amount: usd(2000),
          refundRef: { type: 'refund', id: newId() },
          originalPaymentRef: card.paymentRef,
          idempotencyKey: `ref:${s.stayId}`,
        }),
      cashier,
    );
    expect(refund.postingId).toBeTruthy();
    await assertLedgerIntegrity(h, org);
  });

  it('records deposits, refunds held deposits and refunds applied deposits on the folio', async () => {
    const org = await setupOrg(h);
    const bookingId = newId();
    const folio = await org.run((tx) =>
      h.finance.openFolio(tx, {
        propertyId: org.propertyId,
        owner: { type: 'booking', id: bookingId },
        payer: { type: 'guest', name: 'Booker' },
      }),
    );
    const dep1 = { type: 'payment', id: newId() };
    const dep2 = { type: 'payment', id: newId() };
    for (const [ref, amt] of [
      [dep1, 117000],
      [dep2, 58500],
    ] as const) {
      await org.run((tx) =>
        ledger.recordDeposit(tx, {
          bookingId,
          amount: usd(amt),
          paymentRef: ref,
          idempotencyKey: `dep:${ref.id}`,
          method: 'payment_link',
          verification: 'provider_confirmed',
        }),
      );
    }
    // Refund while held: deposit refund (card clearing credited; tax declared on it released).
    await org.run((tx) =>
      ledger.recordRefund(tx, {
        folioId: null,
        bookingId,
        amount: usd(58500),
        refundRef: { type: 'refund', id: newId() },
        originalPaymentRef: dep2,
        idempotencyKey: `r1:${bookingId}`,
      }),
    );
    expect((await org.run((tx) => h.finance.getDeposits(tx, bookingId)))?.balance).toEqual(usd(117000));
    // A recorded deposit found too high by 10.00 at reconciliation.
    await org.run((tx) =>
      ledger.recordPaymentAdjustment(tx, {
        folioId: null,
        bookingId,
        amount: usd(-1000),
        paymentRef: dep1,
        adjustmentRef: { type: 'payment_adjustment', id: newId() },
        reason: 'Statement',
        idempotencyKey: `a1:${bookingId}`,
      }),
    );
    // Applied at check-in, then refunded: the refund lands on the folio that received the deposit.
    await org.run((tx) => h.finance.applyDeposits(tx, { bookingId, toFolioId: folio.folioId }));
    await org.run((tx) =>
      ledger.recordRefund(tx, {
        folioId: null,
        bookingId,
        amount: usd(20000),
        refundRef: { type: 'refund', id: newId() },
        originalPaymentRef: dep1,
        idempotencyKey: `r2:${bookingId}`,
      }),
    );
    const f = await org.run((tx) => h.finance.getFolio(tx, folio.folioId));
    expect(f.postings.map((p) => [p.kind, p.amount.amountMinor])).toEqual([
      ['deposit_application', -116000],
      ['refund', 20000],
    ]);
    await expect(
      org.run((tx) =>
        ledger.recordRefund(tx, {
          folioId: null,
          bookingId,
          amount: usd(100000),
          refundRef: { type: 'refund', id: newId() },
          originalPaymentRef: dep1,
          idempotencyKey: `r3:${bookingId}`,
        }),
      ),
    ).rejects.toThrow(/can still be refunded/);
    await assertLedgerIntegrity(h, org);
  });

  it('records payouts and dispute movements without touching revenue or the bill', async () => {
    const org = await setupOrg(h);
    const s = await openStay(h, org);
    const paymentRef = { type: 'payment', id: newId() };
    await org.run((tx) =>
      ledger.recordPayment(tx, {
        folioId: s.guestFolioId,
        amount: usd(30000),
        paymentRef,
        method: 'card',
        idempotencyKey: `p:${s.stayId}`,
        verification: 'provider_confirmed',
      }),
    );
    const dispute = { type: 'dispute', id: newId() };
    const debit = await org.run((tx) =>
      ledger.recordDisputeMovement(tx, {
        legalEntityId: org.legalEntityId,
        paymentRef,
        disputeRef: dispute,
        amount: usd(30000),
        kind: 'debit',
        idempotencyKey: `d:${dispute.id}`,
      }),
    );
    const again = await org.run((tx) =>
      ledger.recordDisputeMovement(tx, {
        legalEntityId: org.legalEntityId,
        paymentRef,
        disputeRef: dispute,
        amount: usd(30000),
        kind: 'debit',
        idempotencyKey: `d:${dispute.id}`,
      }),
    );
    expect(again.journalEntryId).toBe(debit.journalEntryId);
    await org.run((tx) =>
      ledger.recordDisputeMovement(tx, {
        legalEntityId: org.legalEntityId,
        paymentRef,
        disputeRef: dispute,
        amount: usd(30000),
        kind: 'reversal',
        idempotencyKey: `d:${dispute.id}:r`,
      }),
    );
    const payout = await org.run((tx) =>
      ledger.recordPayout(tx, {
        legalEntityId: org.legalEntityId,
        payoutRef: { type: 'payout', id: 'po_9' },
        gross: usd(30000),
        fees: usd(600),
        net: usd(29400),
        currency: 'USD',
        idempotencyKey: 'payout:po_9',
      }),
    );
    expect(payout.journalEntryId).toBeTruthy();
    const tb = await org.run((tx) => h.finance.trialBalance(tx, { legalEntityId: org.legalEntityId }));
    const bal = (k: string) => tb.accounts.find((a) => a.systemKey === k)?.balanceMinor ?? 0;
    expect(bal('disputed_funds')).toBe(0);
    expect(bal('card_clearing')).toBe(0);
    expect(bal('bank')).toBe(29400);
    expect(tb.accounts.filter((a) => a.type === 'revenue').every((a) => a.balanceMinor === 0)).toBe(true);
    expect((await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId))).balance).toEqual(usd(-30000));
  });
});
