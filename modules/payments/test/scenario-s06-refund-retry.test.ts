/**
 * Scenario s06 (brief §17): "A refund request is retried after an interruption." Refunds are separate records
 * referencing the payment; partial refunds are supported; a retry with the same key returns the same refund;
 * duplicate and out-of-order webhooks are processed once; there is exactly one refund posting; the original
 * payment and its posting are never altered.
 */
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMethod,
  deliverWebhooks,
  type Harness,
  type Org,
  postings,
  setControls,
  setupOrg,
  startHarness,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

async function paidCharge(org: Org, amountMinor = 100_000) {
  const methodId = await addMethod(h, org, 'pm_card_visa');
  const p = await h.module.service.chargeNow(org.ctx, {
    propertyId: org.propertyId,
    methodId,
    amount: { amountMinor, currency: 'USD' },
    ref: { type: 'folio', id: newId() },
    initiator: 'customer',
    businessKey: `pay-${newId()}`,
  });
  expect(p.status.payment).toBe('succeeded');
  return p;
}

async function refundNow(org: Org, paymentId: string, amountMinor: number, key: string) {
  const svc = h.module.service;
  const s = await org.tx((tx) =>
    svc.tx.refund(tx, {
      paymentId,
      amount: { amountMinor, currency: 'USD' },
      reason: 'Guest left early',
      businessKey: key,
    }),
  );
  await svc.settle(org.ctx, { type: 'refund', id: s.id }, { verifyPending: s.replayed });
  return svc.view.refund(org.ctx, s.id);
}

describe('scenario s06: a refund request is retried after an interruption', () => {
  it('retrying the interrupted refund returns the same refund and never refunds twice', async () => {
    const org = await setupOrg(h);
    const payment = await paidCharge(org);
    // The provider applies the refund but the response is lost (interruption).
    await setControls(h, org, { scenarioOverrides: { refund: 'timeout_then_succeeded' } });
    const key = `refund-${newId()}`;
    const first = await refundNow(org, payment.id, 30_000, key);
    expect(first.status.refund).toBe('pending_verification');
    expect(first.presentation.explanation).toMatch(/Do NOT refund again/);
    expect(await postings(h, org, 'refund')).toHaveLength(0);

    // Staff retry with the same key (e.g. the screen reloaded): same refund; verification finds it at the provider.
    await setControls(h, org, {});
    const retry = await refundNow(org, payment.id, 30_000, key);
    expect(retry.id).toBe(first.id);
    expect(retry.status).toMatchObject({ refund: 'succeeded', ledger: 'posted' });

    // Duplicate + out-of-order webhooks for everything that happened: processed once, no change.
    await setControls(h, org, { duplicateWebhooks: true, outOfOrderWebhooks: true });
    const delivery = await deliverWebhooks(h, org);
    expect(delivery.receipts.filter((r) => r.status === 'duplicate').length).toBeGreaterThan(0);

    const refunds = await postings(h, org, 'refund');
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.amount_minor).toBe(-30_000);
    // The original payment posting is untouched; the payment shows what was refunded.
    expect(await postings(h, org, 'payment')).toHaveLength(1);
    const p = await h.module.service.view.payment(org.ctx, payment.id);
    expect(p).toMatchObject({ refundedMinor: 30_000, refundableMinor: 70_000, amount: { amountMinor: 100_000 } });
    // Only ONE refund object exists at the provider (the simulator's side).
    const status = await org.tx((tx) => h.module.service.tx.getPaymentStatus(tx, p.ref));
    expect(status.refunds).toHaveLength(1);
  });

  it('two executors racing on the same interrupted refund intent send it to the provider once', async () => {
    const org = await setupOrg(h);
    const payment = await paidCharge(org, 50_000);
    const svc = h.module.service;
    const s = await org.tx((tx) =>
      svc.tx.refund(tx, { paymentId: payment.id, amount: { amountMinor: 50_000, currency: 'USD' }, reason: 'x', businessKey: newId() }),
    );
    // Crash after commit, then two recoveries at once (API retry + worker consumer).
    await Promise.all([svc.execute(org.ctx, s.operationId as string), svc.execute(org.ctx, s.operationId as string)]);
    const r = await svc.view.refund(org.ctx, s.id);
    expect(r.status.refund).toBe('succeeded');
    const history = await org.tx((tx) => svc.tx.operationHistory(tx, { type: 'refund', id: s.id, propertyId: org.propertyId }));
    expect(history[0]?.attempts).toBe(1);
    expect(await postings(h, org, 'refund')).toHaveLength(1);
  });

  it('supports partial refunds up to the collected amount, including in-flight refunds', async () => {
    const org = await setupOrg(h);
    const payment = await paidCharge(org, 10_000);
    const a = await refundNow(org, payment.id, 4_000, newId());
    const b = await refundNow(org, payment.id, 6_000, newId());
    expect([a.status.refund, b.status.refund]).toEqual(['succeeded', 'succeeded']);
    await expect(refundNow(org, payment.id, 1, newId())).rejects.toThrow(/can still be refunded/);
    const p = await h.module.service.view.payment(org.ctx, payment.id);
    expect(p.refundableMinor).toBe(0);
    expect(p.allowedActions.find((x) => x.action === 'refund')).toMatchObject({
      enabled: false,
      reason: expect.stringMatching(/fully refunded/),
    });
    expect(await postings(h, org, 'refund')).toHaveLength(2);
  });

  it('a refund that fails at the provider releases the reserved amount and posts nothing', async () => {
    const org = await setupOrg(h);
    const payment = await paidCharge(org, 10_000);
    await setControls(h, org, { scenarioOverrides: { refund: 'decline:charge_already_refunded' } });
    await expect(refundNow(org, payment.id, 10_000, newId())).resolves.toMatchObject({ status: { refund: 'failed' } });
    const p = await h.module.service.view.payment(org.ctx, payment.id);
    expect(p.refundableMinor).toBe(10_000);
    expect(await postings(h, org, 'refund')).toHaveLength(0);
  });

  it('refuses refunds of payments that are still pending verification', async () => {
    const org = await setupOrg(h);
    const methodId = await addMethod(h, org, 'sim_timeout_then_succeeded');
    const p = await h.module.service.chargeNow(org.ctx, {
      propertyId: org.propertyId,
      methodId,
      amount: { amountMinor: 1_000, currency: 'USD' },
      ref: { type: 'folio', id: newId() },
      initiator: 'customer',
      businessKey: newId(),
    });
    await expect(refundNow(org, p.id, 1_000, newId())).rejects.toThrow(/still being verified/);
  });
});
