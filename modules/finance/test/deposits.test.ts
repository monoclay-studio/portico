import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLedgerIntegrity, type Harness, setupOrg, startHarness, usd } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.t.drop());

async function newFolio(org: Awaited<ReturnType<typeof setupOrg>>, bookingId: string) {
  return (
    await org.run((tx) =>
      h.finance.openFolio(tx, {
        propertyId: org.propertyId,
        owner: { type: 'booking', id: bookingId },
        payer: { type: 'guest', name: 'Deposit guest' },
      }),
    )
  ).folioId;
}

describe('deposits (liability, time of supply)', () => {
  it('is a liability with tax declared on receipt, released (not re-declared) when applied', async () => {
    const org = await setupOrg(h);
    const bookingId = newId();
    h.bookings.set(bookingId, { propertyId: org.propertyId, status: 'confirmed' }); // known to reservations
    const folioId = await newFolio(org, bookingId);
    const dep = await org.run((tx) =>
      h.finance.recordDeposit(tx, {
        bookingId,
        amount: usd(117000),
        paymentRef: { type: 'payment', id: newId() },
        method: 'card',
        provider: 'simulator',
        idempotencyKey: `dep:${bookingId}`,
      }),
    );
    // 1,170.00 incl. 17% TGST → 170.00 tax declared now.
    expect(dep).toMatchObject({ balance: usd(117000), taxDeclared: usd(17000), replayed: false });
    const tb = await org.run((tx) => h.finance.trialBalance(tx, { legalEntityId: org.legalEntityId }));
    const bal = (k: string) => tb.accounts.find((a) => a.systemKey === k)?.balanceMinor ?? 0;
    expect(bal('deposits_held')).toBe(-117000);
    expect(bal('tax:tgst')).toBe(-17000);
    expect(tb.accounts.filter((a) => a.type === 'revenue').every((a) => a.balanceMinor === 0)).toBe(true);
    // Retry is harmless.
    expect(
      (
        await org.run((tx) =>
          h.finance.recordDeposit(tx, {
            bookingId,
            amount: usd(117000),
            paymentRef: { type: 'payment', id: 'second-deposit' },
            method: 'card',
            provider: 'simulator',
            idempotencyKey: `dep:${bookingId}:other`,
          }),
        )
      ).balance.amountMinor,
    ).toBe(234000);

    // Apply 1,170.00 to the folio at check-in; the stay's charges will carry TGST, so the deposit's TGST is released.
    const applied = await org.run((tx) =>
      h.finance.applyDeposits(tx, { bookingId, toFolioId: folioId, amountMinor: 117000 }),
    );
    expect(applied.applied).toEqual(usd(117000));
    const tb2 = await org.run((tx) => h.finance.trialBalance(tx, { legalEntityId: org.legalEntityId }));
    const bal2 = (k: string) => tb2.accounts.find((a) => a.systemKey === k)?.balanceMinor ?? 0;
    expect(bal2('tax:tgst')).toBe(-17000); // 34,000 declared on two deposits − 17,000 released
    expect(bal2('deposit_tax_declared')).toBe(17000);
    const folio = await org.run((tx) => h.finance.getFolio(tx, folioId));
    expect(folio.balance.amountMinor).toBe(-117000);
    // Re-applying after the balance is used up is a no-op.
    const again = await org.run((tx) =>
      h.finance.applyDeposits(tx, { bookingId, toFolioId: folioId, amountMinor: 999999 }),
    );
    expect(again.applied.amountMinor).toBe(117000); // the remaining second deposit
    expect(
      (await org.run((tx) => h.finance.applyDeposits(tx, { bookingId, toFolioId: folioId }))).entryId,
    ).toBeNull();
    await assertLedgerIntegrity(h, org);
  });

  it('keeps the prepaid part at the rate in force when it was paid (no re-rating after a rate change)', async () => {
    const org = await setupOrg(h);
    const bookingId = newId();
    h.bookings.set(bookingId, { propertyId: org.propertyId, status: 'confirmed' }); // known to reservations
    const folioId = await newFolio(org, bookingId);
    h.tax.tgstRate = () => '16';
    try {
      await org.run((tx) =>
        h.finance.recordDeposit(tx, {
          bookingId,
          amount: usd(116000),
          paymentRef: { type: 'payment', id: newId() },
          idempotencyKey: `dep:${bookingId}`,
        }),
      );
    } finally {
      h.tax.tgstRate = () => '17';
    }
    // TGST rises to 17% before arrival: the prepaid 1,160.00 keeps the 16% declared at receipt (160.00); at 17%
    // the same prepaid amount would carry 168.55, so 8.55 is credited back as a tax line.
    const res = await org.run((tx) => h.finance.applyDeposits(tx, { bookingId, toFolioId: folioId }));
    const folio = await org.run((tx) => h.finance.getFolio(tx, folioId));
    expect(folio.postings.map((p) => [p.kind, p.amount.amountMinor])).toEqual([
      ['deposit_application', -116000],
      ['adjustment', -855],
    ]);
    expect(res.postingIds).toHaveLength(2);
    await assertLedgerIntegrity(h, org);
  });

  it('refunds release the declared tax; forfeiture keeps it due and books only the net as revenue', async () => {
    const org = await setupOrg(h);
    const bookingId = newId();
    h.bookings.set(bookingId, { propertyId: org.propertyId, status: 'confirmed' }); // known to reservations
    await newFolio(org, bookingId);
    await org.run((tx) =>
      h.finance.recordDeposit(tx, {
        bookingId,
        amount: usd(117000),
        paymentRef: { type: 'payment', id: newId() },
        idempotencyKey: `d:${bookingId}`,
      }),
    );
    await org.run((tx) =>
      h.finance.refundDeposit(tx, {
        bookingId,
        amount: usd(58500),
        refundRef: { type: 'refund', id: newId() },
        idempotencyKey: `r:${bookingId}`,
      }),
    );
    await expect(
      org.run((tx) =>
        h.finance.refundDeposit(tx, {
          bookingId,
          amount: usd(60000),
          refundRef: { type: 'refund', id: newId() },
          idempotencyKey: `r2:${bookingId}`,
        }),
      ),
    ).rejects.toThrow(/Only 58500/);
    const forfeit = await org.run((tx) =>
      h.finance.forfeitDeposit(tx, {
        bookingId,
        chargeCode: 'CXL',
        reason: 'Cancelled inside the 14-day window',
        idempotencyKey: `f:${bookingId}`,
      }),
    );
    expect(forfeit.balance.amountMinor).toBe(0);
    const tb = await org.run((tx) => h.finance.trialBalance(tx, { legalEntityId: org.legalEntityId }));
    const bal = (k: string) => tb.accounts.find((a) => a.systemKey === k)?.balanceMinor ?? 0;
    expect(bal('revenue:penalty')).toBe(-50000); // 585.00 − 85.00 tax
    expect(bal('tax:tgst')).toBe(-8500);
    expect(bal('deposit_tax_declared')).toBe(0);
    expect(bal('deposits_held')).toBe(0);
    await assertLedgerIntegrity(h, org);
  });
});
