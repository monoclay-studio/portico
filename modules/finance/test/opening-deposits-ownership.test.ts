import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { financeLedgerForPayments } from '../src';
import { addProperty, type Harness, setupOrg, startHarness, usd } from './helpers';

/**
 * Integration-step re-review R2-P1-3: a deposit account exists for a booking only when reservations confirms the
 * booking belongs to the account's property (and legal entity) — on EVERY path that creates one — and the predicate
 * payments asks before charging is the very one finance applies when posting (no "charged but not posted").
 */
let h: Harness;
let ledger: ReturnType<typeof financeLedgerForPayments>;
beforeAll(async () => {
  h = await startHarness();
  ledger = financeLedgerForPayments(h.finance);
});
afterAll(async () => h?.t.drop());

const importRows = (
  propertyId: string,
  items: Array<{ bookingId: string; amountMinor: number; legacyNotMigrated?: true }>,
) => ({
  propertyId,
  importRef: `legacy-${newId()}`,
  currency: 'USD',
  providedClosingMinor: items.reduce((s, i) => s + i.amountMinor, 0),
  items,
  idempotencyKey: `imp:${newId()}`,
});

describe('R2-P1-3 — opening deposits ask reservations who owns the booking', () => {
  it("PoC flipped: another property's finance user cannot import a deposit for this property's booking", async () => {
    const org = await setupOrg(h);
    const other = await addProperty(h, org);
    const kanduBooking = newId();
    h.bookings.set(kanduBooking, { propertyId: org.propertyId, status: 'confirmed' });
    const hiyaniFinance = org.as(['finance.openingBalance.import', 'finance.folio.read'], [other.propertyId]);
    const report = await org.run(
      (tx) =>
        h.finance.importOpeningDeposits(
          tx,
          importRows(other.propertyId, [{ bookingId: kanduBooking, amountMinor: 100 }]),
        ),
      hiyaniFinance,
    );
    expect(report.importedCount).toBe(0);
    expect(report.rejected).toEqual([
      expect.objectContaining({ row: 1, reason: expect.stringMatching(/another property/) }),
    ]);
    expect(await org.run((tx) => h.finance.getDeposits(tx, kanduBooking))).toBeNull();
    // Kandu's own deposit is then usable: the predicate payments asks first agrees with the posting.
    await org.run((tx) =>
      ledger.assertTargetUsable(
        tx,
        { type: 'booking', id: kanduBooking },
        {
          propertyId: org.propertyId,
          legalEntityId: org.legalEntityId,
        },
      ),
    );
  });

  it('a booking that exists nowhere is rejected unless flagged legacy; a legacy balance takes no new money', async () => {
    const org = await setupOrg(h);
    const [ghost, legacy] = [newId(), newId()];
    const report = await org.run((tx) =>
      h.finance.importOpeningDeposits(
        tx,
        importRows(org.propertyId, [
          { bookingId: ghost, amountMinor: 100 },
          { bookingId: legacy, amountMinor: 5000, legacyNotMigrated: true },
        ]),
      ),
    );
    expect(report).toMatchObject({ importedCount: 1, legacyCount: 1 });
    expect(report.rejected).toEqual([
      expect.objectContaining({ row: 1, reason: expect.stringMatching(/legacyNotMigrated/) }),
    ]);
    // New money for the legacy booking is refused by the one predicate (payments' pre-check and the posting).
    const scope = { propertyId: org.propertyId, legalEntityId: org.legalEntityId };
    await expect(
      org.run((tx) => ledger.assertTargetUsable(tx, { type: 'booking', id: legacy }, scope)),
    ).rejects.toMatchObject({ code: 'ledger_target_unknown' });
    await expect(
      org.run((tx) =>
        ledger.recordDeposit(tx, {
          ...scope,
          bookingId: legacy,
          amount: usd(100),
          paymentRef: { type: 'payment', id: newId() },
          idempotencyKey: `dep:${newId()}`,
          method: 'card',
          verification: 'provider_confirmed',
          clearing: { provider: 'simulator', accountId: null },
        }),
      ),
    ).rejects.toMatchObject({ code: 'ledger_target_unknown' });
    // …but it can still be paid back (money out of an imported balance).
    const refund = await org.run((tx) =>
      ledger.recordRefund(tx, {
        ...scope,
        folioId: null,
        bookingId: legacy,
        amount: usd(1000),
        refundRef: { type: 'refund', id: newId() },
        originalPaymentRef: { type: 'opening_balance', id: legacy },
        idempotencyKey: `ref:${newId()}`,
        clearing: { provider: 'bank_transfer', accountId: null },
      }),
    );
    expect(refund.postingId).toBeTruthy();
  });

  it('sibling: a deposit held at another property blocks new money at the booking’s own property (pre-check = posting)', async () => {
    const org = await setupOrg(h);
    const other = await addProperty(h, org);
    const booking = newId();
    // Created while the booking still belonged to the other property (data repair / move), then reservations moved it.
    h.bookings.set(booking, { propertyId: other.propertyId, status: 'confirmed' });
    await org.run((tx) =>
      h.finance.importOpeningDeposits(
        tx,
        importRows(other.propertyId, [{ bookingId: booking, amountMinor: 100 }]),
      ),
    );
    h.bookings.set(booking, { propertyId: org.propertyId, status: 'confirmed' });
    const scope = { propertyId: org.propertyId, legalEntityId: org.legalEntityId };
    await expect(
      org.run((tx) => ledger.assertTargetUsable(tx, { type: 'booking', id: booking }, scope)),
    ).rejects.toMatchObject({ code: 'deposit_account_conflict' });
    await expect(
      org.run((tx) =>
        h.finance.recordDeposit(tx, {
          bookingId: booking,
          propertyId: org.propertyId,
          amount: usd(100),
          paymentRef: { type: 'payment', id: newId() },
          idempotencyKey: `dep:${newId()}`,
        }),
      ),
    ).rejects.toMatchObject({ code: 'deposit_account_conflict' });
  });
});
