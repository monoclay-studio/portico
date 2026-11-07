/**
 * Webhook intake: signature-verified, deduplicated by provider event id, out-of-order safe (monotonic), unknown
 * events stored; disputes (evidence checklist + ledger via finance port) and payouts (payout ≠ revenue; failed
 * payouts flagged).
 */
import { sql, withTenantTx } from '@portico/db';
import { newId, systemContext } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STRIPE_SIGNATURE_HEADER } from '../src';
import { signatureHeader } from '../src/providers/signature';
import { processVerifiedWebhook } from '../src/service/webhooks';
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

async function webhookRows(org: Org) {
  const { rows } = await sql<{ provider_event_id: string; outcome: string; event_type: string }>`
    select provider_event_id, outcome, event_type from payments.webhook_events where tenant_id = ${org.tenantId}
    order by received_at`.execute(h.t.admin.kysely);
  return rows;
}

describe('simulator webhooks: duplicates and out-of-order delivery', () => {
  it('applies each event once and never moves a record backwards', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const methodId = await addMethod(h, org);
    const folio = { type: 'folio' as const, id: newId() };
    const a = await org.tx((tx) =>
      svc.tx.authorize(tx, {
        propertyId: org.propertyId,
        methodId,
        amount: { amountMinor: 30_000, currency: 'USD' },
        ref: folio,
        initiator: 'customer',
        businessKey: newId(),
      }),
    );
    await svc.settle(org.ctx, { type: 'authorization', id: a.id });
    const c1 = await org.tx((tx) =>
      svc.tx.capture(tx, {
        authorizationId: a.id,
        amount: { amountMinor: 10_000, currency: 'USD' },
        businessKey: newId(),
      }),
    );
    await svc.settle(org.ctx, { type: 'payment', id: c1.id });
    // The final capture times out: only the webhook can tell us it happened.
    await setControls(h, org, { scenarioOverrides: { capture: 'timeout_then_succeeded' } });
    const c2 = await org.tx((tx) => svc.tx.capture(tx, { authorizationId: a.id, businessKey: newId() }));
    await svc.settle(org.ctx, { type: 'payment', id: c2.id });
    expect((await svc.view.payment(org.ctx, c2.id)).status.payment).toBe('pending_verification');

    // Deliver everything newest-first and twice.
    await setControls(h, org, { duplicateWebhooks: true, outOfOrderWebhooks: true });
    const r = await deliverWebhooks(h, org);
    expect(r.delivered).toBe(6); // 3 events × 2
    expect(r.receipts.filter((x) => x.status === 'duplicate')).toHaveLength(3);
    expect(r.receipts[0]).toMatchObject({ status: 'processed', outcome: 'applied' }); // the newest resolves c2

    expect((await svc.view.payment(org.ctx, c2.id)).status.payment).toBe('succeeded');
    const auth = await svc.view.authorization(org.ctx, a.id);
    expect(auth).toMatchObject({ status: { authorization: 'captured' }, capturedMinor: 30_000 });
    const rows = await webhookRows(org);
    expect(rows).toHaveLength(3);
    // Older snapshots ("authorized") arriving after "succeeded" changed nothing.
    expect(
      rows.filter((x) => x.event_type === 'payment_intent.amount_capturable_updated').map((x) => x.outcome),
    ).not.toContain('applied');
    expect((await postings(h, org, 'payment')).map((p) => p.amount_minor).sort()).toEqual([10_000, 20_000]);
    const open = await org.tx((tx) => svc.tx.listExceptions(tx, { status: 'open' }));
    expect(open).toEqual([]);
  });

  it('opens a dispute with an evidence checklist and records the fund movements through finance', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const methodId = await addMethod(h, org, 'pm_card_createDispute');
    const p = await svc.chargeNow(org.ctx, {
      propertyId: org.propertyId,
      methodId,
      amount: { amountMinor: 60_000, currency: 'USD' },
      ref: { type: 'folio', id: newId() },
      initiator: 'customer',
      businessKey: newId(),
    });
    await deliverWebhooks(h, org);
    const disputes = await org.tx((tx) => svc.tx.listDisputes(tx, org.propertyId));
    expect(disputes).toHaveLength(1);
    const d = disputes[0];
    expect(d).toMatchObject({ paymentId: p.id, status: 'evidence_required', fundsWithdrawn: true });
    expect(d?.evidence.map((e) => e.key)).toEqual(
      expect.arrayContaining(['agreed_terms', 'registration_card', 'folio', 'stay_evidence']),
    );
    expect(await postings(h, org, 'dispute_debit')).toEqual([
      expect.objectContaining({ amount_minor: -60_000 }),
    ]);
    const ex = await org.tx((tx) => svc.tx.listExceptions(tx, { status: 'open' }));
    expect(ex.map((e) => e.kind)).toContain('dispute_opened');

    const updated = await org.tx((tx) =>
      svc.tx.updateDisputeEvidence(tx, d?.id as string, d?.version as number, [
        { key: 'folio', done: true, note: 'Exported' },
      ]),
    );
    expect(updated.evidence.find((e) => e.key === 'folio')).toMatchObject({ done: true, note: 'Exported' });
    await expect(
      org.tx((tx) =>
        svc.tx.updateDisputeEvidence(tx, d?.id as string, d?.version as number, [
          { key: 'folio', done: false },
        ]),
      ),
    ).rejects.toThrow(/changed by someone else/);

    // The hotel wins: the reversal is recorded once, even if the provider repeats the event.
    const won = {
      eventId: `sim_evt_${newId()}`,
      type: 'charge.dispute.closed',
      livemode: false,
      externalAccountId: 'n/a',
      createdAt: h.clock.now(),
      object: {
        kind: 'dispute' as const,
        providerRef: d?.providerDisputeId as string,
        paymentProviderRef: (await svc.view.payment(org.ctx, p.id)).providerRef as string,
        state: 'won' as const,
        amountMinor: 60_000,
        currency: 'USD',
        reason: 'fraudulent',
        evidenceDueBy: null,
        fundsWithdrawn: true,
      },
      payload: {},
    };
    const sys = systemContext(org.tenantId, 'test-webhook', 'demo', newId());
    await processVerifiedWebhook(h.module.service.deps, sys, org.simAccountId, 'simulator', won);
    await processVerifiedWebhook(h.module.service.deps, sys, org.simAccountId, 'simulator', {
      ...won,
      eventId: `sim_evt_${newId()}`,
    });
    expect(await postings(h, org, 'dispute_reversal')).toEqual([
      expect.objectContaining({ amount_minor: 60_000 }),
    ]);
    const after = await org.tx((tx) => svc.tx.getDispute(tx, d?.id as string));
    expect(after.status).toBe('won');
  });

  it('records payouts (never as revenue) and flags missing breakdowns and failed payouts', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const methodId = await addMethod(h, org);
    const p = await svc.chargeNow(org.ctx, {
      propertyId: org.propertyId,
      methodId,
      amount: { amountMinor: 10_000, currency: 'USD' },
      ref: { type: 'folio', id: newId() },
      initiator: 'customer',
      businessKey: newId(),
    });
    const account = await org.tx((tx) => svc.tx.getAccount(tx, org.simAccountId));
    const pa = {
      id: account.id,
      tenantId: org.tenantId,
      provider: 'simulator' as const,
      externalAccountId: account.externalAccountId,
      currencies: account.currencies,
      applicationFeeBps: null,
      statementDescriptor: null,
      simulatorControls: {},
    };
    await h.module.simulator.simulatePayout(pa, {
      payoutRef: 'sim_po_1',
      amountMinor: 9_680,
      currency: 'USD',
      state: 'paid',
      arrivalDate: '2026-11-09',
    });
    await deliverWebhooks(h, org);
    let open = await org.tx((tx) => svc.tx.listExceptions(tx, { status: 'open' }));
    expect(open.map((e) => e.kind)).toContain('payout_breakdown_missing');
    expect(await postings(h, org, 'payout')).toHaveLength(0); // never guessed

    const payout = await org.tx((tx) =>
      svc.tx.recordPayout(tx, {
        accountId: org.simAccountId,
        providerPayoutId: 'sim_po_1',
        currency: 'USD',
        grossMinor: 10_000,
        feesMinor: 320,
        netMinor: 9_680,
        arrivalDate: '2026-11-09',
        status: 'paid',
        paymentIds: [p.id],
        refundIds: [],
      }),
    );
    expect(payout).toMatchObject({ status: 'paid', ledger: { status: 'posted' }, itemCount: 1 });
    expect(await postings(h, org, 'payout')).toEqual([
      expect.objectContaining({
        amount_minor: 9_680,
        extra: expect.objectContaining({ gross: 10_000, fees: 320 }),
      }),
    ]);
    // Payout ≠ revenue: the payment posting is unchanged and still single.
    expect(await postings(h, org, 'payment')).toHaveLength(1);
    open = await org.tx((tx) => svc.tx.listExceptions(tx, { status: 'open' }));
    expect(open.map((e) => e.kind)).not.toContain('payout_breakdown_missing');

    await h.module.simulator.simulatePayout(
      { ...pa, simulatorControls: { settlementDelayDays: 5 } },
      {
        payoutRef: 'sim_po_2',
        amountMinor: 5_000,
        currency: 'USD',
        state: 'failed',
      },
    );
    await deliverWebhooks(h, org);
    // Delayed settlement: the provider's arrival date follows the account's settlement delay.
    const payouts = await org.tx((tx) => svc.tx.listPayouts(tx, org.simAccountId));
    expect(payouts.find((x) => x.providerPayoutId === 'sim_po_2')?.arrivalDate).toBe(
      new Date(h.clock.now().getTime() + 5 * 86_400_000).toISOString().slice(0, 10),
    );
    open = await org.tx((tx) => svc.tx.listExceptions(tx, { status: 'open' }));
    expect(open.find((e) => e.kind === 'payout_failed')).toMatchObject({
      severity: 'urgent',
      responsibleParty: 'hotel',
    });
  });
});

describe('Stripe Connect webhook intake (signature + routing), recorded fixtures only', () => {
  function stripeEvent(account: string, type: string, object: Record<string, unknown>, livemode = false) {
    return JSON.stringify({
      id: `evt_${newId().replace(/-/g, '')}`,
      object: 'event',
      type,
      livemode,
      account,
      created: Math.floor(h.clock.now().getTime() / 1000),
      data: { object },
    });
  }
  function signed(body: string, secret = h.secrets.webhookSecret) {
    return {
      [STRIPE_SIGNATURE_HEADER]: signatureHeader(secret, Math.floor(h.clock.now().getTime() / 1000), body),
    };
  }

  it('verifies the signature, routes to the sandbox organization, dedupes and stores unknown events', async () => {
    h.secrets.sandbox = 'sk_test_harnessOnly';
    const org = await setupOrg(h, 'sandbox');
    const svc = h.module.service;
    const acct = await org.tx((tx) =>
      svc.tx.createAccount(tx, {
        legalEntityId: org.legalEntityId,
        provider: 'stripe_connect',
        externalAccountId: 'acct_1TestHotelMv',
        displayName: 'Stripe (hotel connected account)',
        currencies: ['USD'],
      }),
    );
    expect(acct).toMatchObject({ status: 'pending', effectiveMode: 'sandbox' });

    const body = stripeEvent('acct_1TestHotelMv', 'account.updated', {
      id: 'acct_1TestHotelMv',
      charges_enabled: true,
      payouts_enabled: true,
      requirements: {},
    });
    await expect(
      svc.receiveStripeWebhook(body, { [STRIPE_SIGNATURE_HEADER]: 't=1,v1=deadbeef' }),
    ).rejects.toMatchObject({
      code: 'webhook_signature_invalid',
    });
    const ok = await svc.receiveStripeWebhook(body, signed(body));
    expect(ok).toMatchObject({ status: 'processed', outcome: 'applied' });
    expect(await svc.receiveStripeWebhook(body, signed(body))).toMatchObject({ status: 'duplicate' });
    expect((await org.tx((tx) => svc.tx.getAccount(tx, acct.id))).status).toBe('active');

    const unknown = stripeEvent('acct_1TestHotelMv', 'issuing_card.created', { id: 'ic_1' });
    expect(await svc.receiveStripeWebhook(unknown, signed(unknown))).toMatchObject({
      outcome: 'unknown_type',
    });

    // A live-mode event can never reach a sandbox organization (and is refused by the test-mode endpoint).
    const live = stripeEvent(
      'acct_1TestHotelMv',
      'account.updated',
      { id: 'acct_1TestHotelMv', charges_enabled: false },
      true,
    );
    await expect(svc.receiveStripeWebhook(live, signed(live))).rejects.toMatchObject({
      code: 'webhook_signature_invalid',
    });
    // An account no organization has connected is ignored (no tenant is touched).
    const stranger = stripeEvent('acct_1Unknown', 'account.updated', {
      id: 'acct_1Unknown',
      charges_enabled: true,
    });
    expect(await svc.receiveStripeWebhook(stranger, signed(stranger))).toMatchObject({ status: 'ignored' });
    expect(h.http.calls).toBe(0);

    const rows = await withTenantTx(h.db, org.ctx, (tx) =>
      tx.db.selectFrom('payments.webhook_events').selectAll().execute(),
    );
    expect(rows).toHaveLength(2);
    h.secrets.sandbox = null;
  });
});
