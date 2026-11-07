/**
 * Payment requests (links): "paid" only when the underlying payment succeeded; partial payments; expiry.
 * OTA virtual cards: charged for exactly the card amount from the activation date (property-local), retried on
 * funding delay, never charged twice; a final failure raises an owned task.
 */
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, type Org, postings, setupOrg, startHarness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

async function createRequest(org: Org, amountMinor: number, ref = { type: 'booking' as const, id: newId() }) {
  const svc = h.module.service;
  const r = await org.tx((tx) =>
    svc.tx.createPaymentRequest(tx, {
      propertyId: org.propertyId,
      payer: { type: 'guest_profile', id: newId(), name: 'Aisha Ibrahim', email: 'aisha@example.invalid' },
      amount: { amountMinor, currency: 'USD' },
      purpose: 'deposit',
      description: 'Deposit 30% — Beach Villa',
      ref,
      expiresAt: new Date(h.clock.now().getTime() + 3 * 86_400_000).toISOString(),
      businessKey: newId(),
    }),
  );
  await svc.ensurePaymentLink(org.ctx, r.id);
  return svc.view.request(org.ctx, r.id);
}

describe('payment requests', () => {
  it('is paid only when provider-confirmed payments cover the amount', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const req = await createRequest(org, 126_000);
    expect(req).toMatchObject({ status: { paymentRequest: 'open', link: 'created' }, mode: 'simulate' });
    expect(req.link.url).toMatch(/^https:\/\/pay\.simulator\.portico\.invalid\//);
    expect(req.presentation).toMatchObject({ label: 'Waiting for the guest', confirmed: false });
    expect(await postings(h, org)).toHaveLength(0);

    // Guest pays part, then the rest (signed provider events → link payments).
    await svc.simulateRequestPayment(org.ctx, req.id, 26_000);
    await svc.deliverSimulatorWebhooks(org.ctx, org.simAccountId);
    let r = await svc.view.request(org.ctx, req.id);
    expect(r).toMatchObject({ status: { paymentRequest: 'partially_paid' }, paidMinor: 26_000 });
    await svc.simulateRequestPayment(org.ctx, req.id, 100_000);
    await svc.deliverSimulatorWebhooks(org.ctx, org.simAccountId);
    r = await svc.view.request(org.ctx, req.id);
    expect(r).toMatchObject({ status: { paymentRequest: 'paid' }, paidMinor: 126_000 });
    const deposits = await postings(h, org, 'deposit');
    expect(deposits.map((d) => d.amount_minor).sort((a, b) => a - b)).toEqual([26_000, 100_000]);
    const status = await org.tx((tx) => svc.tx.getPaymentStatus(tx, req.ref));
    expect(status.payments.every((p) => p.method === 'payment_link' && p.status.payment === 'succeeded')).toBe(true);
  });

  it('expires unpaid requests and can be cancelled with If-Match semantics', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const a = await createRequest(org, 5_000);
    const b = await createRequest(org, 6_000);
    const cancelled = await org.tx((tx) => svc.tx.cancelPaymentRequest(tx, b.id, b.version, 'Guest paid cash'));
    expect(cancelled.status.paymentRequest).toBe('cancelled');
    expect(cancelled.allowedActions.find((x) => x.action === 'cancel')).toMatchObject({ enabled: false });
    h.clock.advance(4 * 86_400_000);
    await svc.runReconciliation(org.ctx, { propertyId: org.propertyId });
    expect((await svc.view.request(org.ctx, a.id)).status.paymentRequest).toBe('expired');
  });
});

describe('OTA virtual cards', () => {
  async function registerVcc(org: Org, token: string, activationDate: string, amountMinor = 210_000) {
    return org.tx((tx) =>
      h.module.service.tx.registerVirtualCard(tx, {
        propertyId: org.propertyId,
        accountId: org.simAccountId,
        vaultToken: token,
        brand: 'mastercard',
        last4: '5100',
        bookingId: newId(),
        channel: 'booking_com',
        channelReference: `BDC-${newId().slice(-8)}`,
        amount: { amountMinor, currency: 'USD' },
        activationDate,
        expiresOn: '2026-12-31',
      }),
    );
  }

  it('charges exactly the card amount on the activation date (property-local), retrying funding delays', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    // Clock: 2026-11-07T08:00Z = 13:00 in the Maldives. Activation tomorrow.
    h.clock.set('2026-11-07T08:00:00Z');
    const vcc = await registerVcc(org, 'sim_vcc_funding_delay', '2026-11-08');
    expect(vcc.status).toBe('scheduled');
    let run = await svc.runDueVirtualCards(org.ctx, { propertyId: org.propertyId });
    expect(run.started).toBe(0);
    expect(run.skipped[0]?.reason).toMatch(/activates on 2026-11-08/);

    // 19:30Z on the 7th = 00:30 on the 8th in Malé: active in property-local time.
    h.clock.set('2026-11-07T19:30:00Z');
    run = await svc.runDueVirtualCards(org.ctx, { propertyId: org.propertyId });
    expect(run.started).toBe(1);
    let v = await org.tx((tx) => svc.tx.getVirtualCard(tx, vcc.id));
    expect(v).toMatchObject({ status: 'funding_retry', attempts: 1, lastFailure: { code: 'vcc_not_funded' } });
    // Not due yet → nothing happens.
    expect((await svc.runDueVirtualCards(org.ctx, { propertyId: org.propertyId })).started).toBe(0);
    h.clock.advance(6 * 3_600_000);
    await svc.runDueVirtualCards(org.ctx, { propertyId: org.propertyId });
    h.clock.advance(12 * 3_600_000);
    await svc.runDueVirtualCards(org.ctx, { propertyId: org.propertyId });
    v = await org.tx((tx) => svc.tx.getVirtualCard(tx, vcc.id));
    expect(v).toMatchObject({ status: 'charged', attempts: 3 });
    const deposits = await postings(h, org, 'deposit');
    expect(deposits).toEqual([expect.objectContaining({ amount_minor: 210_000 })]);
    // Never twice.
    h.clock.advance(48 * 3_600_000);
    expect((await svc.runDueVirtualCards(org.ctx, { propertyId: org.propertyId })).started).toBe(0);
    expect(await postings(h, org, 'deposit')).toHaveLength(1);
  });

  it('gives up on a hard decline with an owned task, and registration is idempotent per channel reference', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    h.clock.set('2026-11-10T08:00:00Z');
    const vcc = await registerVcc(org, 'pm_card_visa_chargeDeclined', '2026-11-10');
    const again = await org.tx((tx) =>
      svc.tx.registerVirtualCard(tx, {
        propertyId: org.propertyId,
        accountId: org.simAccountId,
        vaultToken: 'pm_card_visa_chargeDeclined',
        bookingId: vcc.bookingId,
        channel: 'booking_com',
        channelReference: vcc.channelReference,
        amount: vcc.amount,
        activationDate: '2026-11-10',
      }),
    );
    expect(again.id).toBe(vcc.id);
    await svc.runDueVirtualCards(org.ctx, { propertyId: org.propertyId });
    const v = await org.tx((tx) => svc.tx.getVirtualCard(tx, vcc.id));
    expect(v.status).toBe('failed');
    const ex = await org.tx((tx) => svc.tx.listExceptions(tx, { propertyId: org.propertyId, status: 'open' }));
    expect(ex.find((e) => e.kind === 'vcc_charge_failed')).toMatchObject({ owner: { id: 'reservations' } });
  });
});
