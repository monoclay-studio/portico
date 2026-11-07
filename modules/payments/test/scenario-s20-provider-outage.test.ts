/**
 * Scenario s20 (payments part, brief §17): "A payment integration goes unavailable during a busy shift."
 * Staff see a clear "card payments unavailable" state with safe alternatives (cash, payment link later, manual
 * authorization / recorded terminal payment); nothing shows success that did not happen; the breaker state is
 * visible via API; on recovery work resumes without blind replays and nothing is charged twice.
 */
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMethod, type Harness, type Org, postings, setControls, setupOrg, startHarness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

function charge(org: Org, methodId: string, folioId: string, amountMinor = 10_000) {
  return h.module.service.chargeNow(org.ctx, {
    propertyId: org.propertyId,
    methodId,
    amount: { amountMinor, currency: 'USD' },
    ref: { type: 'folio', id: folioId },
    businessKey: newId(),
  });
}

describe('scenario s20: card payments go down during a busy shift', () => {
  it('fails safe, shows the outage with alternatives, and resumes without double charges', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const methodId = await addMethod(h, org);
    await setControls(h, org, { outage: 'refuse' });

    // Three guests at the desk: each attempt fails honestly ("nothing was charged").
    for (let i = 0; i < 3; i++) {
      const p = await charge(org, methodId, newId());
      expect(p.status.payment).toBe('failed');
      expect(p.decline?.message).toMatch(/Nothing was charged/);
      expect(p.presentation.confirmed).toBe(true);
    }
    expect(await postings(h, org)).toHaveLength(0);

    // The breaker is now open: the API shows it, and new card attempts are refused BEFORE anything is created.
    const health = await org.tx((tx) => svc.tx.accountHealth(tx, org.simAccountId));
    expect(health).toMatchObject({ state: 'open', cardPaymentsAvailable: false });
    expect(health.message).toMatch(/Card payments unavailable/);
    expect(health.actions.map((a) => a.key)).toEqual([
      'accept_cash',
      'send_payment_link_later',
      'record_manual_authorization',
      'record_terminal_payment',
    ]);
    const blocked = charge(org, methodId, newId());
    await expect(blocked).rejects.toMatchObject({ code: 'card_payments_unavailable', status: 503 });
    await expect(blocked).rejects.toThrow(/Nothing was charged/);
    const status = await org.tx((tx) => svc.tx.paymentsStatus(tx, org.propertyId));
    expect(status.cardPaymentsAvailable).toBe(false);
    expect(status.banner).toMatch(/Card payments unavailable/);
    const exceptions = await org.tx((tx) => svc.tx.listExceptions(tx, { status: 'open' }));
    expect(exceptions.map((e) => e.kind)).toContain('provider_unavailable');

    // Alternative 1: cash — recorded and posted immediately, labeled as recorded (not provider-verified).
    const folioCash = newId();
    const cash = await org.tx((tx) =>
      svc.tx.recordPayment(tx, {
        propertyId: org.propertyId,
        method: 'cash',
        amount: { amountMinor: 10_000, currency: 'USD' },
        ref: { type: 'folio', id: folioCash },
        reference: 'RCPT-0001',
        receivedAt: h.clock.now().toISOString(),
        businessKey: newId(),
      }),
    );
    const cashView = await svc.view.payment(org.ctx, cash.id);
    expect(cashView).toMatchObject({ status: { payment: 'recorded_unverified' }, providerVerified: false });

    // Alternative 2: manual authorization taken on the hotel's own terminal (a hold, not a payment).
    const manual = await org.tx((tx) =>
      svc.tx.recordAuthorization(tx, {
        propertyId: org.propertyId,
        accountId: org.terminalAccountId,
        amount: { amountMinor: 50_000, currency: 'USD' },
        ref: { type: 'stay', id: newId() },
        approvalCode: 'AP-77812',
        cardLast4: '1881',
        businessKey: newId(),
      }),
    );
    const manualView = await svc.view.authorization(org.ctx, manual.id);
    expect(manualView).toMatchObject({ status: { authorization: 'authorized' }, mode: 'recorded' });
    expect(manualView.presentation).toMatchObject({ tone: 'recorded', confirmed: false });

    // Alternative 3: a payment link to be paid later — created now, link pending until the provider is back.
    const folioLink = newId();
    const req = await org.tx((tx) =>
      svc.tx.createPaymentRequest(tx, {
        propertyId: org.propertyId,
        payer: { type: 'other', name: 'Mr Kurt Weber', email: 'kurt@example.invalid' },
        amount: { amountMinor: 10_000, currency: 'USD' },
        purpose: 'balance',
        ref: { type: 'folio', id: folioLink },
        expiresAt: new Date(h.clock.now().getTime() + 2 * 86_400_000).toISOString(),
        businessKey: newId(),
      }),
    );
    await svc.ensurePaymentLink(org.ctx, req.id);
    let reqView = await svc.view.request(org.ctx, req.id);
    expect(reqView.status).toMatchObject({ paymentRequest: 'open', link: 'pending' });
    expect(reqView.issues.map((i) => i.code)).toContain('link_not_created');

    // The provider comes back. After the cool-down, the next call is a probe; success closes the breaker.
    await setControls(h, org, {});
    h.clock.advance(61_000);
    expect((await org.tx((tx) => svc.tx.accountHealth(tx, org.simAccountId))).state).toBe('half_open');
    const recovered = await charge(org, methodId, newId());
    expect(recovered.status.payment).toBe('succeeded');
    const closed = await org.tx((tx) => svc.tx.accountHealth(tx, org.simAccountId));
    expect(closed).toMatchObject({ state: 'closed', cardPaymentsAvailable: true, actions: [] });
    const open = await org.tx((tx) => svc.tx.listExceptions(tx, { status: 'open' }));
    expect(open.map((e) => e.kind)).not.toContain('provider_unavailable');

    // Reconciliation creates the pending link; nothing that failed during the outage is replayed.
    await svc.runReconciliation(org.ctx, { propertyId: org.propertyId });
    reqView = await svc.view.request(org.ctx, req.id);
    expect(reqView.status.link).toBe('created');
    const ledger = await postings(h, org, 'payment');
    // The cash payment + the one successful card payment after recovery. The failed attempts never post.
    expect(ledger).toHaveLength(2);
  });

  it('timeouts during an outage become pending verification and are only ever resolved by lookup', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const methodId = await addMethod(h, org);
    await setControls(h, org, { outage: 'timeout' });
    const p = await charge(org, methodId, newId());
    expect(p.status.payment).toBe('pending_verification');
    // Still down: lookups cannot tell; it stays pending (never guessed).
    await svc.checkNow(org.ctx, { type: 'payment', id: p.id });
    expect((await svc.view.payment(org.ctx, p.id)).status.payment).toBe('pending_verification');
    // Provider back; it has no record of the request. Before the grace period that is not conclusive…
    await setControls(h, org, {});
    await svc.checkNow(org.ctx, { type: 'payment', id: p.id });
    expect((await svc.view.payment(org.ctx, p.id)).status.payment).toBe('pending_verification');
    // …after it, one "not found" is still not conclusive (provider search can lag): it must be confirmed ≥ 1 h later.
    h.clock.advance(16 * 60_000);
    await svc.checkNow(org.ctx, { type: 'payment', id: p.id });
    expect((await svc.view.payment(org.ctx, p.id)).status.payment).toBe('pending_verification');
    // Confirmed absence is a provider-confirmed failure: nothing was charged; the request is NOT re-sent.
    h.clock.advance(61 * 60_000);
    await svc.checkNow(org.ctx, { type: 'payment', id: p.id });
    const final = await svc.view.payment(org.ctx, p.id);
    expect(final.status.payment).toBe('failed');
    expect(final.decline?.code).toBe('not_received_by_provider');
    const history = await org.tx((tx) =>
      svc.tx.operationHistory(tx, { type: 'payment', id: p.id, propertyId: org.propertyId }),
    );
    expect(history[0]?.attempts).toBe(1);
    expect(await postings(h, org)).toHaveLength(0);
  });

  it('an intent that could not be sent in time is cancelled, never sent late', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const methodId = await addMethod(h, org);
    const s = await org.tx((tx) =>
      svc.tx.charge(tx, {
        propertyId: org.propertyId,
        methodId,
        amount: { amountMinor: 7_000, currency: 'USD' },
        ref: { type: 'folio', id: newId() },
        businessKey: newId(),
      }),
    );
    h.clock.advance(20 * 60_000); // the worker was down for 20 minutes
    await svc.execute(org.ctx, s.operationId as string);
    const p = await svc.view.payment(org.ctx, s.id);
    expect(p.status.payment).toBe('failed');
    expect(p.decline?.code).toBe('expired_before_sending');
    expect(p.decline?.message).toMatch(/Nothing was charged/);
  });
});
