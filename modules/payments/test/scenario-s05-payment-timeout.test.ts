/**
 * Scenario s05 (brief §17): "A payment succeeds externally, but the screen times out before confirmation."
 * The UI must show PENDING VERIFICATION (never paid, never failed), a second charge is blocked, and
 * reconciliation later records exactly ONE successful payment and exactly ONE ledger posting.
 */
import { runDueJobs } from '@portico/db';
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMethod, deliverWebhooks, drain, type Harness, postings, setupOrg, startHarness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('scenario s05: payment succeeds at the provider but the response times out', () => {
  it('shows pending verification, blocks a second charge, and reconciliation records exactly one payment', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const methodId = await addMethod(h, org, 'sim_timeout_then_succeeded');
    const folioId = newId();
    const key = `charge-${newId()}`;
    const input = {
      propertyId: org.propertyId,
      methodId,
      amount: { amountMinor: 84_000, currency: 'USD' },
      ref: { type: 'folio' as const, id: folioId },
      initiator: 'customer' as const,
      businessKey: key,
    };

    // 1. The screen "times out": the provider took the money but we never got the answer.
    const first = await svc.chargeNow(org.ctx, input);
    expect(first.status.payment).toBe('pending_verification');
    expect(first.presentation).toMatchObject({ tone: 'pending', confirmed: false });
    expect(first.presentation.explanation).toMatch(/Do NOT charge again/);
    expect(first.providerVerified).toBe(false);
    expect(first.issues.map((i) => i.code)).toContain('pending_verification');
    expect(first.allowedActions.find((a) => a.action === 'checkStatus')?.enabled).toBe(true);
    expect(first.allowedActions.find((a) => a.action === 'refund')).toMatchObject({ enabled: false });
    expect(await postings(h, org)).toHaveLength(0); // nothing on the bill while unknown

    // 2. A colleague tries to charge again with a NEW attempt: blocked with an explanation.
    await expect(svc.chargeNow(org.ctx, { ...input, businessKey: `charge-${newId()}` })).rejects.toThrow(
      /still being verified[\s\S]*charge the guest twice/,
    );

    // 3. The guest-facing status for the folio says pending, not paid.
    const status = await org.tx((tx) => svc.tx.getPaymentStatus(tx, { type: 'folio', id: folioId }));
    expect(status.hasPendingVerification).toBe(true);
    expect(status.totals[0]).toMatchObject({ confirmedMinor: 0, pendingVerificationMinor: 84_000 });

    // 4. Reconciliation (provider lookup by idempotency key) resolves it: exactly one success.
    h.clock.advance(15_000);
    const run = await svc.runReconciliation(org.ctx, { propertyId: org.propertyId });
    expect(run.resolved).toBe(1);
    const resolved = await svc.view.payment(org.ctx, first.id);
    expect(resolved.status).toMatchObject({ payment: 'succeeded', ledger: 'posted' });
    expect(resolved.presentation).toMatchObject({
      label: 'Paid (simulated — no real money)',
      confirmed: true,
    });

    // 5. Retrying the original request (same key), re-running reconciliation and the provider's webhook all
    //    change nothing: still one payment, one posting.
    const retry = await svc.chargeNow(org.ctx, input);
    expect(retry.id).toBe(first.id);
    await svc.runReconciliation(org.ctx, { propertyId: org.propertyId });
    const delivered = await deliverWebhooks(h, org);
    expect(delivered.delivered).toBeGreaterThan(0);
    await drain(h);
    const ledger = await postings(h, org, 'payment');
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ amount_minor: 84_000, ref_id: folioId });
    const after = await org.tx((tx) => svc.tx.getPaymentStatus(tx, { type: 'folio', id: folioId }));
    expect(after.payments).toHaveLength(1);
    expect(after.totals[0]).toMatchObject({ confirmedMinor: 84_000, pendingVerificationMinor: 0 });

    // 6. The journal shows the single send, the timeout and the lookup that resolved it.
    const history = await org.tx((tx) =>
      svc.tx.operationHistory(tx, { type: 'payment', id: first.id, propertyId: org.propertyId }),
    );
    expect(history).toHaveLength(1);
    expect(history[0]?.attempts).toBe(1);
    expect(history[0]?.journal.map((j) => `${j.phase}:${j.status}`)).toEqual(
      expect.arrayContaining(['intent:sent', 'outcome:pending_verification', 'lookup:true']),
    );
  });

  it('when the provider did NOT take the money, verification records a failure and nothing is posted', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const methodId = await addMethod(h, org, 'sim_timeout_then_failed');
    const folioId = newId();
    const p = await svc.chargeNow(org.ctx, {
      propertyId: org.propertyId,
      methodId,
      amount: { amountMinor: 12_000, currency: 'USD' },
      ref: { type: 'folio', id: folioId },
      initiator: 'customer',
      businessKey: `k-${newId()}`,
    });
    expect(p.status.payment).toBe('pending_verification');
    await svc.checkNow(org.ctx, { type: 'payment', id: p.id });
    const after = await svc.view.payment(org.ctx, p.id);
    expect(after.status.payment).toBe('failed');
    expect(after.decline?.recovery).toBeTruthy();
    expect(await postings(h, org)).toHaveLength(0);
    // Now a new attempt is allowed again.
    const m2 = await addMethod(h, org, 'pm_card_visa');
    const ok = await svc.chargeNow(org.ctx, {
      propertyId: org.propertyId,
      methodId: m2,
      amount: { amountMinor: 12_000, currency: 'USD' },
      ref: { type: 'folio', id: folioId },
      initiator: 'customer',
      businessKey: `k-${newId()}`,
    });
    expect(ok.status.payment).toBe('succeeded');
    expect(await postings(h, org, 'payment')).toHaveLength(1);
  });

  it('the worker consumers alone resolve it (no staff action), exactly once', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const methodId = await addMethod(h, org, 'sim_timeout_then_succeeded');
    const folioId = newId();
    // Port call from another module inside ITS transaction: intent only; the worker sends it after commit.
    const payment = await org.tx((tx) =>
      svc.provider.charge(tx, {
        propertyId: org.propertyId,
        methodId,
        amount: { amountMinor: 5_000, currency: 'USD' },
        ref: { type: 'folio', id: folioId },
        idempotencyKey: `checkout:${folioId}`,
        initiator: 'customer',
      }),
    );
    expect(payment.status.payment).toBe('processing');
    await drain(h); // executor sends once → timeout → pending; reconciler looks it up → succeeded
    await drain(h);
    const final = await svc.view.payment(org.ctx, payment.id);
    expect(final.status.payment).toBe('succeeded');
    expect(await postings(h, org, 'payment')).toHaveLength(1);
  });

  it('the scheduled reconciliation job resolves it for every organization, without staff action', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const methodId = await addMethod(h, org, 'sim_timeout_then_succeeded');
    const p = await svc.chargeNow(org.ctx, {
      propertyId: org.propertyId,
      methodId,
      amount: { amountMinor: 9_900, currency: 'USD' },
      ref: { type: 'folio', id: newId() },
      initiator: 'customer',
      businessKey: newId(),
    });
    expect(p.status.payment).toBe('pending_verification');
    h.clock.advance(20_000);
    const ran = await runDueJobs(h.db, h.module.jobs);
    expect(ran).toContain('payments.reconcile');
    expect((await svc.view.payment(org.ctx, p.id)).status.payment).toBe('succeeded');
    expect(await postings(h, org, 'payment')).toHaveLength(1);
  });

  it('if finance refuses the posting, the confirmed payment stays true and is posted once on retry', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const methodId = await addMethod(h, org);
    h.ledger.failWith = 'Folio is closed for posting';
    const p = await svc.chargeNow(org.ctx, {
      propertyId: org.propertyId,
      methodId,
      amount: { amountMinor: 4_200, currency: 'USD' },
      ref: { type: 'folio', id: newId() },
      initiator: 'customer',
      businessKey: newId(),
    });
    expect(p.status).toMatchObject({ payment: 'succeeded', ledger: 'failed' });
    expect(p.issues.find((i) => i.code === 'ledger_not_posted')).toMatchObject({ severity: 'blocking' });
    const open = await org.tx((tx) => svc.tx.listExceptions(tx, { status: 'open' }));
    expect(open.find((e) => e.kind === 'ledger_posting_failed')).toMatchObject({ ownerRole: 'finance' });
    h.ledger.failWith = null;
    await svc.runReconciliation(org.ctx, { propertyId: org.propertyId });
    await svc.runReconciliation(org.ctx, { propertyId: org.propertyId });
    expect((await svc.view.payment(org.ctx, p.id)).status.ledger).toBe('posted');
    expect(await postings(h, org, 'payment')).toHaveLength(1);
    const after = await org.tx((tx) => svc.tx.listExceptions(tx, { status: 'open' }));
    expect(after.map((e) => e.kind)).not.toContain('ledger_posting_failed');
  });
});
