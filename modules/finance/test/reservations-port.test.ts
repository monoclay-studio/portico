import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { financeForReservations } from '../src';
import { assertLedgerIntegrity, type Harness, setupOrg, startHarness, usd } from './helpers';

/** The FinancePort as the reservations module declares it (bound directly in the composition root). */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.t.drop());

describe('reservations → finance port', () => {
  it('opens folios, replaces billing rules as a set, posts, applies deposits and lists balances', async () => {
    const org = await setupOrg(h);
    const port = financeForReservations(h.finance);
    const agent = org.as(['reservations.booking.create']); // no finance permissions of its own
    const bookingId = newId();
    const stayId = newId();
    const bookingFolio = await org.run(
      (tx) =>
        port.openFolio(tx, {
          propertyId: org.propertyId,
          owner: { type: 'booking', id: bookingId },
          payer: { type: 'profile', id: newId(), name: 'Lena Fischer' },
        }),
      agent,
    );
    const guest = await org.run(
      (tx) =>
        port.openFolio(tx, {
          propertyId: org.propertyId,
          owner: { type: 'stay', id: stayId },
          payer: { type: 'profile', id: newId() },
        }),
      agent,
    );
    const company = await org.run(
      (tx) =>
        port.openFolio(tx, {
          propertyId: org.propertyId,
          owner: { type: 'stay', id: stayId },
          payer: { type: 'company', id: newId() },
          label: 'Acme accommodation',
        }),
      agent,
    );
    const set = () =>
      org.run(
        (tx) =>
          port.setBillingRules(tx, {
            owner: { type: 'stay', id: stayId },
            rules: [
              {
                destinationFolioId: company.folioId,
                chargeCodeGroups: ['room'],
                cap: { kind: 'per_night', amount: usd(20000) },
                source: 'company_default',
              },
            ],
          }),
        agent,
      );
    await set();
    const second = await set(); // replacing the set is not a conflict with the previous version
    expect(second.ruleIds).toHaveLength(1);
    await expect(
      org.run(
        (tx) =>
          port.setBillingRules(tx, {
            owner: { type: 'stay', id: stayId },
            rules: [
              { destinationFolioId: company.folioId, chargeCodeGroups: ['room'], source: 'manual' },
              { destinationFolioId: guest.folioId, chargeCodeGroups: ['room'], source: 'manual' },
            ],
          }),
        agent,
      ),
    ).rejects.toThrow(/same charges/);
    await org.run(
      (tx) =>
        port.postCharge(tx, {
          propertyId: org.propertyId,
          target: { type: 'stay', id: stayId },
          chargeCode: 'ROOM',
          amount: usd(20000),
          serviceDate: '2026-11-07',
          description: 'Room',
          sourceRef: { type: 'stay', id: stayId },
          idempotencyKey: `room:${stayId}:2026-11-07`,
        }),
      agent,
    );
    await org.run(
      (tx) =>
        port.recordDeposit(tx, {
          bookingId,
          amount: usd(11700),
          paymentRef: { type: 'payment', id: newId() },
          idempotencyKey: `dep:${bookingId}`,
        }),
      agent,
    );
    expect(await org.run((tx) => port.getDepositBalance(tx, { bookingId }), agent)).toEqual(usd(11700));
    expect(
      await org.run((tx) => port.applyDeposits(tx, { bookingId, toFolioId: guest.folioId }), agent),
    ).toEqual({ applied: usd(11700) });
    expect(
      await org.run((tx) => port.applyDeposits(tx, { bookingId, toFolioId: guest.folioId }), agent),
    ).toBeUndefined();
    const folios = await org.run((tx) => port.listFolios(tx, { owner: { type: 'stay', id: stayId } }), agent);
    expect(folios.map((f) => [f.label ?? null, f.isDefault, f.balance.amountMinor])).toEqual([
      [null, true, 25740 - 20000 - 11700],
      ['Acme accommodation', false, 20000],
    ]);
    expect((await org.run((tx) => port.getFolioBalance(tx, bookingFolio.folioId), agent)).status).toBe(
      'open',
    );
    await assertLedgerIntegrity(h, org);
  });
});
