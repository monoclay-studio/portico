import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { financeLedgerForPayments } from '../src';
import {
  addProperty,
  assertLedgerIntegrity,
  type Harness,
  openStay,
  setupOrg,
  startHarness,
  usd,
} from './helpers';

/** The LedgerPort exactly as the payments module declares it (bound directly in the composition root). */
const terminal = { provider: 'external_terminal', accountId: null } as const;
const link = { provider: 'simulator', accountId: null } as const;
const simulator = { provider: 'simulator', accountId: null } as const;
const scope = (org: { propertyId: string; legalEntityId: string }) => ({
  propertyId: org.propertyId,
  legalEntityId: org.legalEntityId,
});

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
      ...scope(org),
      clearing: terminal,
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
          ...scope(org),
          clearing: { provider: 'cash', accountId: null },
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
          ...scope(org),
          clearing: terminal,
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
          ...scope(org),
          clearing: terminal,
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
    h.bookings.set(bookingId, { propertyId: org.propertyId, status: 'confirmed' }); // known to reservations
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
          ...scope(org),
          clearing: link,
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
        ...scope(org),
        clearing: link,
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
        ...scope(org),
        clearing: link,
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
        ...scope(org),
        clearing: link,
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
          ...scope(org),
          clearing: link,
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
        ...scope(org),
        clearing: simulator,
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
        clearing: simulator,
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
        clearing: simulator,
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
        clearing: simulator,
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
        clearing: simulator,
        idempotencyKey: 'payout:po_9',
      }),
    );
    expect(payout.journalEntryId).toBeTruthy();
    const tb = await org.run((tx) => h.finance.trialBalance(tx, { legalEntityId: org.legalEntityId }));
    const bal = (k: string) => tb.accounts.find((a) => a.systemKey === k)?.balanceMinor ?? 0;
    expect(bal('disputed_funds')).toBe(0);
    expect(bal('card_clearing:simulator')).toBe(0);
    expect(bal('bank')).toBe(29400);
    expect(tb.accounts.filter((a) => a.type === 'revenue').every((a) => a.balanceMinor === 0)).toBe(true);
    expect((await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId))).balance).toEqual(usd(-30000));
  });

  it('refuses targets of another property or legal entity before anything moves (ADR-0015)', async () => {
    const org = await setupOrg(h);
    const s = await openStay(h, org);
    const sister = await addProperty(h, org);
    const otherEntity = await addProperty(h, org, { newLegalEntity: true });
    // Re-review #3: a folio's description also says whose folio it is and who pays it (payments' family and consent).
    expect(await org.run((tx) => ledger.describeTarget(tx, { type: 'folio', id: s.guestFolioId }))).toEqual({
      ...scope(org),
      owner: { type: 'stay', id: s.stayId },
      payer: expect.objectContaining({ type: 'guest' }),
    });
    expect(await org.run((tx) => ledger.describeTarget(tx, { type: 'booking', id: newId() }))).toBeNull();
    const pay = (sc: { propertyId: string; legalEntityId: string }) =>
      org.run((tx) =>
        ledger.recordPayment(tx, {
          ...sc,
          clearing: simulator,
          folioId: s.guestFolioId,
          amount: usd(1000),
          paymentRef: { type: 'payment', id: newId() },
          method: 'card',
          idempotencyKey: `p:${newId()}`,
          verification: 'provider_confirmed',
        }),
      );
    await expect(pay(sister)).rejects.toMatchObject({ code: 'scope_mismatch' });
    await expect(
      pay({ propertyId: org.propertyId, legalEntityId: otherEntity.legalEntityId }),
    ).rejects.toMatchObject({
      code: 'scope_mismatch',
    });
    // The booking's owner comes from reservations (review P1-1): a deposit from the sister property is refused, the
    // first deposit no longer "binds" anything, and a booking nobody knows is refused before anything moves.
    const bookingId = newId();
    h.bookings.set(bookingId, { propertyId: org.propertyId, status: 'confirmed' });
    const deposit = (sc: { propertyId: string; legalEntityId: string }) =>
      org.run((tx) =>
        ledger.recordDeposit(tx, {
          ...sc,
          clearing: simulator,
          bookingId,
          amount: usd(5000),
          paymentRef: { type: 'payment', id: newId() },
          idempotencyKey: `d:${newId()}`,
          method: 'payment_link',
          verification: 'provider_confirmed',
        }),
      );
    await expect(
      deposit({ propertyId: sister.propertyId, legalEntityId: otherEntity.legalEntityId }),
    ).rejects.toMatchObject({
      code: 'scope_mismatch',
    });
    await deposit(scope(org));
    expect(await org.run((tx) => ledger.describeTarget(tx, { type: 'booking', id: bookingId }))).toEqual(
      scope(org),
    );
    await expect(deposit(sister)).rejects.toMatchObject({ code: 'scope_mismatch' });
    const ghost = newId();
    await expect(
      org.run((tx) =>
        ledger.recordDeposit(tx, {
          ...scope(org),
          clearing: simulator,
          bookingId: ghost,
          amount: usd(5000),
          paymentRef: { type: 'payment', id: newId() },
          idempotencyKey: `g:${ghost}`,
          method: 'payment_link',
          verification: 'provider_confirmed',
        }),
      ),
    ).rejects.toMatchObject({ code: 'ledger_target_unknown' });
    expect(await org.run((tx) => ledger.describeTarget(tx, { type: 'booking', id: ghost }))).toBeNull();
    await expect(
      org.run((tx) =>
        ledger.recordSettlementFees(tx, {
          propertyId: org.propertyId,
          legalEntityId: otherEntity.legalEntityId,
          statementRef: { type: 'statement', id: newId() },
          amount: usd(100),
          clearing: simulator,
          idempotencyKey: `fees:${newId()}`,
        }),
      ),
    ).rejects.toMatchObject({ code: 'scope_mismatch' });
    expect((await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId))).postings).toHaveLength(0);
  });

  it('Route D: a statement match verifies a recorded payment without altering the posting', async () => {
    const org = await setupOrg(h);
    const s = await openStay(h, org);
    const paymentRef = { type: 'payment', id: newId() };
    await org.run((tx) =>
      ledger.recordPayment(tx, {
        ...scope(org),
        clearing: terminal,
        folioId: s.guestFolioId,
        amount: usd(25000),
        paymentRef,
        method: 'external_terminal',
        idempotencyKey: `p:${paymentRef.id}`,
        verification: 'recorded_unverified',
      }),
    );
    const before = await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId));
    expect(before.issues.map((i) => i.code)).toContain('payments_awaiting_verification');
    const checks = () =>
      org.run((tx) =>
        h.finance.getUnbalancedItems(tx, { propertyId: org.propertyId, businessDate: '2026-11-07' }),
      );
    expect((await checks()).map((i) => i.code)).toContain('payments_awaiting_verification');
    // Another property cannot verify it.
    const sister = await addProperty(h, org);
    await expect(
      org.run((tx) =>
        ledger.markPaymentVerified(tx, {
          ...sister,
          paymentRef,
          evidenceRef: { type: 'statement_line', id: newId() },
          idempotencyKey: `v:${newId()}`,
        }),
      ),
    ).rejects.toMatchObject({ code: 'scope_mismatch' });
    const verify = {
      ...scope(org),
      paymentRef,
      evidenceRef: { type: 'statement_line', id: newId() },
      idempotencyKey: `verify:${paymentRef.id}`,
    };
    await org.run((tx) => ledger.markPaymentVerified(tx, verify));
    await org.run((tx) => ledger.markPaymentVerified(tx, verify)); // replay
    const after = await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId));
    expect(after.issues.map((i) => i.code)).not.toContain('payments_awaiting_verification');
    expect(after.postings.map((p) => [p.id, p.amount.amountMinor, p.paymentVerification])).toEqual([
      [before.postings[0]?.id, -25000, 'recorded_verified'],
    ]);
    expect((await checks()).map((i) => i.code)).not.toContain('payments_awaiting_verification');
    await expect(
      org.run((tx) =>
        ledger.markPaymentVerified(tx, {
          ...scope(org),
          paymentRef: { type: 'payment', id: newId() },
          evidenceRef: { type: 'statement_line', id: newId() },
          idempotencyKey: `v:${newId()}`,
        }),
      ),
    ).rejects.toMatchObject({ code: 'payment_not_found' });
  });

  it('keeps one clearing account per acquirer account and books settlement fees as an expense', async () => {
    const org = await setupOrg(h);
    const s = await openStay(h, org);
    const acquirer = { provider: 'stripe_connect', accountId: 'acct_1' } as const;
    await org.run((tx) =>
      ledger.recordPayment(tx, {
        ...scope(org),
        clearing: acquirer,
        folioId: s.guestFolioId,
        amount: usd(40000),
        paymentRef: { type: 'payment', id: newId() },
        method: 'card',
        idempotencyKey: `p:${s.stayId}`,
        verification: 'provider_confirmed',
      }),
    );
    const fees = {
      ...scope(org),
      statementRef: { type: 'statement', id: newId() },
      amount: usd(1160),
      clearing: acquirer,
      idempotencyKey: `fees:${s.stayId}`,
    };
    const a = await org.run((tx) => ledger.recordSettlementFees(tx, fees));
    const b = await org.run((tx) => ledger.recordSettlementFees(tx, fees));
    expect(b.journalEntryId).toBe(a.journalEntryId);
    const tb = await org.run((tx) => h.finance.trialBalance(tx, { legalEntityId: org.legalEntityId }));
    const bal = (k: string) => tb.accounts.find((x) => x.systemKey === k)?.balanceMinor ?? 0;
    expect(bal('card_clearing:stripe_connect_acct_1')).toBe(40000 - 1160);
    expect(bal('payment_fees')).toBe(1160);
    expect(bal('card_clearing')).toBe(0);
    await assertLedgerIntegrity(h, org);
  });

  it('counts negative payment adjustments in the refund ceiling', async () => {
    const org = await setupOrg(h);
    const s = await openStay(h, org);
    const paymentRef = { type: 'payment', id: newId() };
    await org.run((tx) =>
      ledger.recordPayment(tx, {
        ...scope(org),
        clearing: terminal,
        folioId: s.guestFolioId,
        amount: usd(10000),
        paymentRef,
        method: 'external_terminal',
        idempotencyKey: `p:${paymentRef.id}`,
        verification: 'recorded_unverified',
      }),
    );
    await org.run((tx) =>
      ledger.recordPaymentAdjustment(tx, {
        ...scope(org),
        clearing: terminal,
        folioId: s.guestFolioId,
        bookingId: null,
        amount: usd(-500),
        paymentRef,
        adjustmentRef: { type: 'payment_adjustment', id: newId() },
        reason: 'Terminal batch shows 95.00',
        idempotencyKey: `adj:${paymentRef.id}`,
      }),
    );
    const refund = (amountMinor: number) =>
      org.run((tx) =>
        ledger.recordRefund(tx, {
          ...scope(org),
          clearing: terminal,
          folioId: s.guestFolioId,
          bookingId: null,
          amount: usd(amountMinor),
          refundRef: { type: 'refund', id: newId() },
          originalPaymentRef: paymentRef,
          idempotencyKey: `r:${newId()}`,
        }),
      );
    await expect(refund(9600)).rejects.toThrow(/can still be refunded/);
    await refund(9500);
    await expect(refund(1)).rejects.toThrow(/can still be refunded/);
    expect((await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId))).balance).toEqual(usd(0));
    await assertLedgerIntegrity(h, org);
  });
});
