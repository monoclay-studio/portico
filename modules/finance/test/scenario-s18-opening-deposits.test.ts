import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLedgerIntegrity, type Harness, setupOrg, startHarness, usd } from './helpers';

/**
 * S18 (groundwork) — Imported deposits disagree with the previous system's closing balance. The import posts
 * opening balances through migration suspense, rejects invalid rows with reasons, reports the difference against
 * the provided closing balance and raises an exception. Nothing is balanced silently.
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.t.drop());

describe('S18: imported deposits vs the previous system closing balance', () => {
  it('reports the difference and the rejected rows; never plugs the gap', async () => {
    const org = await setupOrg(h);
    const [b1, b2, b3] = [newId(), newId(), newId()];
    // S18 migration order: the bookings are migrated into reservations first (review R2-P1-3).
    for (const b of [b1, b2, b3]) h.bookings.set(b, { propertyId: org.propertyId, status: 'confirmed' });
    const input = {
      propertyId: org.propertyId,
      importRef: `opera-deposits-2026-11-06-${org.tenantId.slice(-6)}`,
      currency: 'USD',
      providedClosingMinor: 250000, // previous system says 2,500.00
      items: [
        { bookingId: b1, externalRef: 'OPERA-1001', amountMinor: 100000 },
        { bookingId: b2, externalRef: 'OPERA-1002', amountMinor: 120000 },
        { bookingId: b2, externalRef: 'OPERA-1002-dup', amountMinor: 120000 },
        { bookingId: b3, externalRef: 'OPERA-1003', amountMinor: -5000 },
      ],
      idempotencyKey: 'import-1',
    };
    const report = await org.run((tx) => h.finance.importOpeningDeposits(tx, input));
    expect(report).toMatchObject({
      status: 'difference',
      importedCount: 2,
      importedTotalMinor: 220000,
      providedClosingMinor: 250000,
      differenceMinor: 30000,
      suspenseBalanceMinor: 220000,
    });
    expect(report.rejected.map((r) => r.row)).toEqual([3, 4]);
    expect(report.explanation).toMatch(/Nothing was adjusted automatically/);
    // Re-running the same import returns the same report and posts nothing again.
    expect(await org.run((tx) => h.finance.importOpeningDeposits(tx, input))).toEqual(report);
    const deposits = await org.run((tx) => h.finance.getDeposits(tx, b1));
    expect(deposits?.balance.amountMinor).toBe(100000);
    const exceptions = await org.run((tx) => h.finance.listExceptions(tx, { propertyId: org.propertyId }));
    expect(exceptions).toEqual([
      expect.objectContaining({ kind: 'opening_balance_difference', severity: 'urgent' }),
    ]);
    const checks = await org.run((tx) =>
      h.finance.getUnbalancedItems(tx, { propertyId: org.propertyId, businessDate: '2026-11-07' }),
    );
    expect(checks.map((c) => c.code)).toEqual(
      expect.arrayContaining(['exception:opening_balance_difference', 'suspense_balance']),
    );
    await assertLedgerIntegrity(h, org);

    // Imported deposits behave like any deposit: applied at check-in.
    const folio = await org.run((tx) =>
      h.finance.openFolio(tx, {
        propertyId: org.propertyId,
        owner: { type: 'stay', id: newId() },
        payer: { type: 'guest', name: 'Imported guest' },
      }),
    );
    const applied = await org.run((tx) =>
      h.finance.applyDeposits(tx, { bookingId: b1, toFolioId: folio.folioId }),
    );
    expect(applied.applied.amountMinor).toBe(100000);
    await assertLedgerIntegrity(h, org);
  });

  it('a matching import is reconciled', async () => {
    const org = await setupOrg(h);
    const booking = newId();
    h.bookings.set(booking, { propertyId: org.propertyId, status: 'confirmed' });
    const report = await org.run((tx) =>
      h.finance.importOpeningDeposits(tx, {
        propertyId: org.propertyId,
        importRef: `csv-${org.tenantId}`,
        currency: 'USD',
        providedClosingMinor: 5000,
        items: [{ bookingId: booking, amountMinor: 5000 }],
        idempotencyKey: 'k',
      }),
    );
    expect(report.status).toBe('reconciled');
  });

  it('requires the opening-balance import permission', async () => {
    const org = await setupOrg(h);
    await expect(
      org.run(
        (tx) =>
          h.finance.importOpeningDeposits(tx, {
            propertyId: org.propertyId,
            importRef: 'x',
            currency: 'USD',
            providedClosingMinor: 1,
            items: [{ bookingId: newId(), amountMinor: 1 }],
            idempotencyKey: 'k',
          }),
        org.as(['finance.posting.create']),
      ),
    ).rejects.toThrow(/permission/);
  });

  it('migrated deposits keep the tax the previous system declared, so prepaid stays are not taxed twice (F-09)', async () => {
    const org = await setupOrg(h);
    const [b1, b2] = [newId(), newId()];
    for (const b of [b1, b2]) h.bookings.set(b, { propertyId: org.propertyId, status: 'confirmed' });
    const report = await org.run((tx) =>
      h.finance.importOpeningDeposits(tx, {
        propertyId: org.propertyId,
        importRef: `opera-tax-${org.tenantId.slice(-6)}`,
        currency: 'USD',
        providedClosingMinor: 117000,
        items: [
          {
            bookingId: b1,
            amountMinor: 117000,
            declaredTaxes: [{ accountKey: 'TGST', name: 'TGST', rate: '17%', amountMinor: 17000 }],
          },
          {
            bookingId: b2,
            amountMinor: 5000,
            declaredTaxes: [{ accountKey: 'vat_unknown', name: 'VAT', amountMinor: 500 }],
          },
        ],
        idempotencyKey: 'k',
      }),
    );
    expect(report.status).toBe('difference'); // the unknown tax account row is rejected with a reason
    expect(report.rejected).toEqual([
      expect.objectContaining({ row: 2, reason: expect.stringMatching(/vat_unknown/) }),
    ]);
    const folio = await org.run((tx) =>
      h.finance.openFolio(tx, {
        propertyId: org.propertyId,
        owner: { type: 'stay', id: newId() },
        payer: { type: 'guest', name: 'Migrated guest' },
      }),
    );
    await org.run((tx) =>
      h.finance.postCharge(tx, {
        propertyId: org.propertyId,
        folioId: folio.folioId,
        chargeCode: 'ROOM',
        amount: usd(100000),
        serviceDate: '2026-11-07',
        description: 'Room',
        sourceRef: { type: 'stay', id: folio.folioId },
        idempotencyKey: `room:${folio.folioId}`,
      }),
    );
    await org.run((tx) => h.finance.applyDeposits(tx, { bookingId: b1, toFolioId: folio.folioId }));
    const tb = await org.run((tx) => h.finance.trialBalance(tx, { legalEntityId: org.legalEntityId }));
    const bal = (k: string) => tb.accounts.find((a) => a.systemKey === k)?.balanceMinor ?? 0;
    // Charges carry TGST 18,700 (17% of 1,100.00); 17,000 was declared by the previous system → 1,700 due here.
    expect(bal('tax:tgst')).toBe(-1700);
    expect(bal('deposit_tax_declared')).toBe(0);
    expect((await org.run((tx) => h.finance.getFolio(tx, folio.folioId))).balance).toEqual(
      usd(128700 - 117000),
    );
    await assertLedgerIntegrity(h, org);
  });
});
