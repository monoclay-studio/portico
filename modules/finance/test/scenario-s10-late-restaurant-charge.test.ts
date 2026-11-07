import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { financeSubscriptions } from '../src';
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
 * S10 — A restaurant charge arrives after the guest checked out. Finance accepts it on the stay: a settled
 * folio is reopened; an invoiced folio keeps its invoice and the charge goes to a supplementary folio for the
 * same payer; either way the charge is flagged post-departure, collection is requested from payments (card on
 * file) and the exception appears in Day Close checks. The guest ledger stays correct.
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.t.drop());

async function checkedOutStay(org: Awaited<ReturnType<typeof setupOrg>>, invoice: boolean) {
  const s = await openStay(h, org, { guest: 'Ms Larsen' });
  await org.run((tx) =>
    h.finance.postCharge(tx, {
      propertyId: org.propertyId,
      target: { type: 'stay', id: s.stayId },
      chargeCode: 'ROOM',
      amount: usd(30000),
      serviceDate: '2026-11-07',
      description: 'Room',
      sourceRef: { type: 'stay', id: s.stayId },
      idempotencyKey: `room:${s.stayId}`,
    }),
  );
  const f = await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId));
  await org.run((tx) =>
    h.finance.recordPayment(tx, {
      folioId: s.guestFolioId,
      amount: f.balance,
      paymentRef: { type: 'payment', id: newId() },
      method: 'card',
      provider: 'simulator',
      idempotencyKey: `pay:${s.stayId}`,
    }),
  );
  if (invoice)
    await org.run((tx) =>
      h.finance.issueInvoice(tx, { folioId: s.guestFolioId, idempotencyKey: `inv:${s.stayId}` }),
    );
  await org.run(async (tx) =>
    h.finance.settleFolio(tx, s.guestFolioId, (await h.finance.getFolio(tx, s.guestFolioId)).version),
  );
  // Check-out arrives as an event from reservations (consumer path).
  const [sub] = financeSubscriptions(h.finance, h.ports);
  await org.run((tx) =>
    (sub as NonNullable<typeof sub>).handle(tx, {
      id: newId(),
      type: 'reservations.stay.checkedOut',
      tenantId: org.tenantId,
      propertyId: org.propertyId,
      aggregate: { type: 'stay', id: s.stayId },
      aggregateVersion: null,
      occurredAt: new Date().toISOString(),
      actor: { kind: 'system', process: 'test' },
      correlationId: newId(),
      version: 1,
      payload: { stayId: s.stayId, propertyId: org.propertyId, businessDate: '2026-11-07' },
    }),
  );
  return s;
}

// The outlet's POS integration posts (an API client, not a staff member).
const lateDinner = (org: Awaited<ReturnType<typeof setupOrg>>, stayId: string) =>
  org.run(
    (tx) =>
      h.finance.postCharge(tx, {
        propertyId: org.propertyId,
        target: { type: 'stay', id: stayId },
        chargeCode: 'FOOD',
        amount: usd(6000),
        serviceDate: '2026-11-07',
        description: 'Sunset Grill — check 4411',
        sourceRef: { type: 'pos_check', id: '4411' },
        idempotencyKey: `pos:grill:4411:${stayId}`,
      }),
    {
      ...org.ctx,
      actor: { kind: 'api_client', clientId: 'pos-sunset-grill', displayName: 'Sunset Grill POS' },
    },
  );

describe('S10: late restaurant charge after check-out', () => {
  it('reopens a settled (not invoiced) folio, flags it and requests collection', async () => {
    const org = await setupOrg(h);
    const s = await checkedOutStay(org, false);
    await advanceBusinessDate(org, '2026-11-07');
    const res = await lateDinner(org, s.stayId);
    expect(res.folioId).toBe(s.guestFolioId);
    const f = await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId));
    expect(f.status.folio).toBe('open');
    expect(f.reopenedReason).toBe('late_charge');
    expect(f.reopenCount).toBe(1);
    expect(f.postDeparture).toBe(true);
    expect(f.balance.amountMinor).toBe(7722); // 60.00 + 10% SC + 17% TGST
    expect(
      f.postings
        .filter((p) => p.postDeparture)
        .map((p) => p.kind)
        .sort(),
    ).toEqual(['charge', 'tax', 'tax']);
    expect(f.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['late_charge', 'departed_with_balance']),
    );
    expect(h.collections.filter((c) => c.folioId === s.guestFolioId)).toEqual([
      expect.objectContaining({
        reason: 'late_charge',
        amount: usd(7722),
        idempotencyKey: `pos:grill:4411:${s.stayId}:collect:${s.guestFolioId}`,
      }),
    ]);
    // A retried POS delivery changes nothing.
    expect((await lateDinner(org, s.stayId)).replayed).toBe(true);
    const checks = await org.run((tx) =>
      h.finance.getUnbalancedItems(tx, { propertyId: org.propertyId, businessDate: '2026-11-08' }),
    );
    expect(checks.map((c) => c.code)).toEqual(
      expect.arrayContaining(['departed_with_balance', 'exception:late_charge']),
    );
    await assertLedgerIntegrity(h, org);
  });

  it('keeps an issued invoice intact and posts to a supplementary folio for the same payer', async () => {
    const org = await setupOrg(h);
    const s = await checkedOutStay(org, true);
    const before = await org.run((tx) => h.finance.listDocuments(tx, s.guestFolioId));
    const res = await lateDinner(org, s.stayId);
    expect(res.folioId).not.toBe(s.guestFolioId);
    const supp = await org.run((tx) => h.finance.getFolio(tx, res.folioId));
    expect(supp).toMatchObject({
      supplementaryOf: s.guestFolioId,
      payer: { name: 'Ms Larsen' },
      postDeparture: true,
      balance: usd(7722),
    });
    const original = await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId));
    expect(original.status).toMatchObject({ folio: 'settled', balance: 'zero', invoicing: 'invoiced' });
    const after = await org.run((tx) => h.finance.listDocuments(tx, s.guestFolioId));
    expect(after.map((d) => d.hash)).toEqual(before.map((d) => d.hash));
    const verify = await org.run((tx) => h.finance.verifyFiscalLedger(tx, org.legalEntityId));
    expect(verify.ok).toBe(true);
    expect(h.collections.some((c) => c.folioId === res.folioId)).toBe(true);
    // The supplementary folio gets its own invoice once paid.
    await org.run((tx) =>
      h.finance.recordPayment(tx, {
        folioId: res.folioId,
        amount: usd(7722),
        paymentRef: { type: 'payment', id: newId() },
        method: 'card',
        provider: 'simulator',
        idempotencyKey: `late-pay:${s.stayId}`,
      }),
    );
    const inv = await org.run((tx) =>
      h.finance.issueInvoice(tx, { folioId: res.folioId, idempotencyKey: `late-inv:${s.stayId}` }),
    );
    expect(inv.total.amountMinor).toBe(7722);
    await assertLedgerIntegrity(h, org);
  });

  it('a staff member posting a late charge with an earlier service date must give a reason', async () => {
    const org = await setupOrg(h);
    const s = await checkedOutStay(org, false);
    await advanceBusinessDate(org, '2026-11-07');
    const staff = org.as(['finance.posting.create']);
    await expect(
      org.run(
        (tx) =>
          h.finance.postCharge(tx, {
            propertyId: org.propertyId,
            target: { type: 'stay', id: s.stayId },
            chargeCode: 'MINIBAR',
            amount: usd(1500),
            serviceDate: '2026-11-07',
            description: 'Minibar found at inspection',
            sourceRef: { type: 't', id: 'm' },
            idempotencyKey: `mb:${s.stayId}`,
          }),
        staff,
      ),
    ).rejects.toThrow(/Add a reason/);
    const ok = await org.run(
      (tx) =>
        h.finance.postCharge(tx, {
          propertyId: org.propertyId,
          target: { type: 'stay', id: s.stayId },
          chargeCode: 'MINIBAR',
          amount: usd(1500),
          serviceDate: '2026-11-07',
          description: 'Minibar found at inspection',
          reason: 'Found by housekeeping after departure',
          sourceRef: { type: 't', id: 'm' },
          idempotencyKey: `mb:${s.stayId}`,
        }),
      staff,
    );
    expect(ok.replayed).toBe(false);
  });
});
