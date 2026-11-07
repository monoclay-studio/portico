/**
 * Regression tests for the steward review of feat/payments-core (docs/orchestration/reviews/review-payments.md).
 * Each test reproduces a finding (several adapted from the reviewer's experiments E1–E6) and proves the fix.
 */
import { sql, withTenantTx } from '@portico/db';
import { newId, systemContext } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordPaymentInput, refundInput, STRIPE_SIGNATURE_HEADER } from '../src';
import { signatureHeader } from '../src/providers/signature';
import { processVerifiedWebhook } from '../src/service/webhooks';
import {
  addMethod,
  type Harness,
  type Org,
  postings,
  setupOrg,
  startHarness,
  stripeAccount,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

async function paidCharge(org: Org, amountMinor = 100_000, folioId = newId()) {
  const methodId = await addMethod(h, org, 'pm_card_visa');
  const p = await h.module.service.chargeNow(org.ctx, {
    propertyId: org.propertyId,
    methodId,
    amount: { amountMinor, currency: 'USD' },
    ref: { type: 'folio', id: folioId },
    businessKey: `pay-${newId()}`,
  });
  expect(p.status.payment).toBe('succeeded');
  return p;
}

function recordTerminal(org: Org, reference: string, extra: Record<string, unknown> = {}) {
  return org.tx((tx) =>
    h.module.service.tx.recordPayment(tx, {
      propertyId: org.propertyId,
      method: 'external_terminal',
      accountId: org.terminalAccountId,
      amount: { amountMinor: 25_000, currency: 'USD' },
      ref: { type: 'folio', id: newId() },
      reference,
      terminalId: 'TID-1',
      receivedAt: h.clock.now().toISOString(),
      businessKey: newId(),
      ...extra,
    }),
  );
}

describe('P0-1: a collection can only post to a folio/booking of the caller’s property and legal entity', () => {
  it('refuses a folio of another property (and of another legal entity) before any money moves', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const foreignFolio = newId();
    h.ledger.owners.set(foreignFolio, { propertyId: org.otherPropertyId, legalEntityId: org.legalEntityId });
    const otherEntityFolio = newId();
    h.ledger.owners.set(otherEntityFolio, { propertyId: org.propertyId, legalEntityId: newId() });
    const methodId = await addMethod(h, org);
    const desk = org.as([
      'payments.payment.collect',
      'payments.externalRecord.create',
      'payments.paymentRequest.create',
      'payments.vcc.manage',
    ]);
    const charge = (folio: string) =>
      svc.chargeNow(desk, {
        propertyId: org.propertyId,
        methodId,
        amount: { amountMinor: 77_700, currency: 'USD' },
        ref: { type: 'folio', id: folio },
        businessKey: newId(),
      });
    await expect(charge(foreignFolio)).rejects.toMatchObject({ code: 'ledger_target_other_property' });
    await expect(charge(otherEntityFolio)).rejects.toMatchObject({ code: 'wrong_merchant_of_record' });
    await expect(
      withTenantTx(h.db, desk, (tx) =>
        svc.tx.recordPayment(tx, {
          propertyId: org.propertyId,
          method: 'cash',
          amount: { amountMinor: 77_700, currency: 'USD' },
          ref: { type: 'folio', id: foreignFolio },
          reference: 'RCPT-X',
          receivedAt: h.clock.now().toISOString(),
          businessKey: newId(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'ledger_target_other_property' });
    await expect(
      withTenantTx(h.db, desk, (tx) =>
        svc.tx.createPaymentRequest(tx, {
          propertyId: org.propertyId,
          payer: { type: 'other', name: 'Guest' },
          amount: { amountMinor: 1_000, currency: 'USD' },
          purpose: 'balance',
          ref: { type: 'folio', id: foreignFolio },
          expiresAt: new Date(h.clock.now().getTime() + 86_400_000).toISOString(),
          businessKey: newId(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'ledger_target_other_property' });
    const foreignBooking = newId();
    h.ledger.owners.set(foreignBooking, { propertyId: org.otherPropertyId, legalEntityId: org.legalEntityId });
    await expect(
      withTenantTx(h.db, desk, (tx) =>
        svc.tx.registerVirtualCard(tx, {
          propertyId: org.propertyId,
          accountId: org.simAccountId,
          vaultToken: 'sim_vcc_funding_delay',
          bookingId: foreignBooking,
          channel: 'booking_com',
          channelReference: `BDC-${newId().slice(-6)}`,
          amount: { amountMinor: 1_000, currency: 'USD' },
          activationDate: '2026-11-07',
        }),
      ),
    ).rejects.toMatchObject({ code: 'ledger_target_other_property' });
    // An unknown folio cannot be collected against at all (the money would appear on no bill).
    const unknownFolio = newId();
    h.ledger.unknown.add(unknownFolio);
    await expect(charge(unknownFolio)).rejects.toMatchObject({ code: 'ledger_target_unknown' });
    expect(await postings(h, org)).toEqual([]);
  });

  it('a capture into a foreign folio is refused, and every posting carries property + legal entity', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const methodId = await addMethod(h, org);
    const auth = await org.tx((tx) =>
      svc.tx.authorize(tx, {
        propertyId: org.propertyId,
        methodId,
        amount: { amountMinor: 10_000, currency: 'USD' },
        ref: { type: 'stay', id: newId() },
        businessKey: newId(),
      }),
    );
    await svc.settle(org.ctx, { type: 'authorization', id: auth.id });
    const foreign = newId();
    h.ledger.owners.set(foreign, { propertyId: org.otherPropertyId, legalEntityId: org.legalEntityId });
    await expect(
      org.tx((tx) =>
        svc.tx.capture(tx, { authorizationId: auth.id, ledgerRef: { type: 'folio', id: foreign }, businessKey: newId() }),
      ),
    ).rejects.toMatchObject({ code: 'ledger_target_other_property' });
    const own = newId();
    const c = await org.tx((tx) =>
      svc.tx.capture(tx, { authorizationId: auth.id, ledgerRef: { type: 'folio', id: own }, businessKey: newId() }),
    );
    await svc.settle(org.ctx, { type: 'payment', id: c.id });
    const [posting] = await postings(h, org, 'payment');
    expect(posting?.extra).toMatchObject({
      propertyId: org.propertyId,
      legalEntityId: org.legalEntityId,
      clearing: { provider: 'simulator', accountId: org.simAccountId },
    });
  });
});

describe('P0-2: provider accounts belong to exactly one organization; status and fees are not tenant-controlled', () => {
  it('cannot claim a connected account by id; a second organization cannot link it; routing is unambiguous', async () => {
    h.secrets.sandbox = 'sk_test_harnessOnly';
    const victim = await setupOrg(h, 'sandbox');
    const attacker = await setupOrg(h, 'sandbox');
    await expect(
      attacker.tx((tx) =>
        h.module.service.tx.createAccount(tx, {
          legalEntityId: attacker.legalEntityId,
          provider: 'stripe_connect',
          externalAccountId: 'acct_1SharedVictim',
          displayName: 'Stripe',
          currencies: ['USD'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'stripe_account_link_required' });
    const victimAccount = await stripeAccount(h, victim, 'acct_1SharedVictim', false);
    await expect(stripeAccount(h, attacker, 'acct_1SharedVictim', false)).rejects.toMatchObject({
      code: 'provider_account_claimed',
    });
    const { rows } = await sql<{ tenant_id: string }>`
      select tenant_id from payments.route_webhook('stripe_connect', 'acct_1SharedVictim', false)`.execute(h.db.kysely);
    expect(rows.map((r) => r.tenant_id)).toEqual([victim.tenantId]);
    // A tenant admin cannot activate the Stripe account (only Stripe can) — disabling it is allowed.
    const acc = await victim.tx((tx) => h.module.service.tx.getAccount(tx, victimAccount));
    await expect(
      victim.tx((tx) => h.module.service.tx.updateAccount(tx, acc.id, acc.version, { status: 'active' })),
    ).rejects.toMatchObject({ code: 'provider_controlled_status' });
    // The platform fee is not part of the tenant API at all, and operator-only in the service.
    const { accountUpdate } = await import('../src/contracts');
    expect(accountUpdate.safeParse({ applicationFeeBps: 1000 }).success).toBe(false);
    await expect(
      victim.tx((tx) =>
        h.module.service.operator.setApplicationFee(tx, { accountId: acc.id, applicationFeeBps: 1000, approvedBy: 'me' }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    // Stripe's account.updated activates it — routed to the victim only.
    const body = JSON.stringify({
      id: `evt_${newId().replace(/-/g, '')}`,
      type: 'account.updated',
      livemode: false,
      account: 'acct_1SharedVictim',
      created: Math.floor(h.clock.now().getTime() / 1000),
      data: { object: { charges_enabled: true, payouts_enabled: true, requirements: {} } },
    });
    const t = Math.floor(h.clock.now().getTime() / 1000);
    await h.module.service.receiveStripeWebhook(body, {
      [STRIPE_SIGNATURE_HEADER]: signatureHeader(h.secrets.webhookSecret, t, body),
    });
    expect((await victim.tx((tx) => h.module.service.tx.getAccount(tx, victimAccount))).status).toBe('active');
    h.secrets.sandbox = null;
  });
});

describe('P0-3: a webhook whose processing fails is never lost', () => {
  it('is processed again on redelivery (reviewer E5b)', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const p = await paidCharge(org, 60_000);
    await sql`create table if not exists public.zz_fail_once (n int);
      insert into public.zz_fail_once values (1);
      create or replace function public.zz_fail() returns trigger language plpgsql security definer as $$
      begin if exists (select 1 from public.zz_fail_once) then delete from public.zz_fail_once;
        raise exception 'simulated transient failure' using errcode = '40P01'; end if; return new; end $$;
      create trigger zz_fail before insert on payments.disputes for each row execute function public.zz_fail();`.execute(
      h.t.admin.kysely,
    );
    const ev = {
      eventId: `sim_evt_${newId()}`,
      type: 'charge.dispute.created',
      livemode: false,
      externalAccountId: 'n/a',
      createdAt: h.clock.now(),
      object: {
        kind: 'dispute' as const,
        providerRef: `dp_${newId()}`,
        paymentProviderRef: p.providerRef as string,
        state: 'evidence_required' as const,
        amountMinor: 60_000,
        currency: 'USD',
        reason: 'fraudulent',
        evidenceDueBy: null,
        fundsWithdrawn: true,
      },
      payload: {},
    };
    const sys = systemContext(org.tenantId, 'test-webhook', 'demo', newId());
    await expect(processVerifiedWebhook(svc.deps, sys, org.simAccountId, 'simulator', ev)).rejects.toThrow(
      /transient failure/,
    );
    await sql`drop trigger zz_fail on payments.disputes`.execute(h.t.admin.kysely);
    const retry = await processVerifiedWebhook(svc.deps, sys, org.simAccountId, 'simulator', ev);
    expect(retry).toMatchObject({ status: 'processed', outcome: 'applied' });
    expect(await org.tx((tx) => svc.tx.listDisputes(tx, org.propertyId))).toHaveLength(1);
    // Now it is a duplicate.
    expect(await processVerifiedWebhook(svc.deps, sys, org.simAccountId, 'simulator', ev)).toMatchObject({
      status: 'duplicate',
    });
  });

  it('the event backstop applies provider events that were never delivered', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const methodId = await addMethod(h, org, 'pm_card_createDispute');
    await svc.chargeNow(org.ctx, {
      propertyId: org.propertyId,
      methodId,
      amount: { amountMinor: 30_000, currency: 'USD' },
      ref: { type: 'folio', id: newId() },
      businessKey: newId(),
    });
    // No webhook delivery at all: the dispute would be invisible…
    expect(await org.tx((tx) => svc.tx.listDisputes(tx, org.propertyId))).toHaveLength(0);
    const run = await svc.runEventBackstop(org.ctx);
    expect(run.applied).toBeGreaterThan(0);
    expect(await org.tx((tx) => svc.tx.listDisputes(tx, org.propertyId))).toHaveLength(1);
    // …and running it again changes nothing (cursor + dedupe).
    expect((await svc.runEventBackstop(org.ctx)).applied).toBe(0);
  });
});

describe('P1-1: one collection in flight per folio — genuinely concurrent', () => {
  it('two desks charging the same folio at the same moment: exactly one collection', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const methodId = await addMethod(h, org);
    const folio = { type: 'folio' as const, id: newId() };
    const start = (k: string) =>
      withTenantTx(h.db, org.ctx, async (tx) => {
        const s = await svc.tx.charge(tx, {
          propertyId: org.propertyId,
          methodId,
          amount: { amountMinor: 84_000, currency: 'USD' },
          ref: folio,
          businessKey: k,
        });
        await sql`select pg_sleep(0.15)`.execute(tx.db); // keep both transactions open together
        return s;
      });
    const results = await Promise.allSettled([start('A'), start('B'), start('C')]);
    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ id: string }>[];
    const errs = results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.code);
    expect(ok).toHaveLength(1);
    expect(errs.every((c) => c === 'payment_pending_verification')).toBe(true);
    await svc.settle(org.ctx, { type: 'payment', id: ok[0]?.value.id as string });
    expect(await postings(h, org, 'payment')).toHaveLength(1);
  });
});

describe('P1-2: a payment request owns its purpose on a reference', () => {
  it('a paid deposit link blocks a desk charge for the same deposit (reviewer E2b) unless staff give a reason', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const booking = { type: 'booking' as const, id: newId() };
    const req = await org.tx((tx) =>
      svc.tx.createPaymentRequest(tx, {
        propertyId: org.propertyId,
        payer: { type: 'other', name: 'Guest' },
        amount: { amountMinor: 50_000, currency: 'USD' },
        purpose: 'deposit',
        ref: booking,
        expiresAt: new Date(h.clock.now().getTime() + 86_400_000).toISOString(),
        businessKey: newId(),
      }),
    );
    await svc.ensurePaymentLink(org.ctx, req.id);
    await svc.simulateRequestPayment(org.ctx, req.id);
    await svc.deliverSimulatorWebhooks(org.ctx, org.simAccountId);
    const methodId = await addMethod(h, org);
    const deskCharge = (extra: Record<string, unknown> = {}) =>
      svc.chargeNow(org.ctx, {
        propertyId: org.propertyId,
        methodId,
        amount: { amountMinor: 50_000, currency: 'USD' },
        ref: booking,
        businessKey: newId(),
        ...extra,
      });
    await expect(deskCharge()).rejects.toMatchObject({ code: 'collection_owned_by_payment_request' });
    expect(await postings(h, org, 'deposit')).toHaveLength(1);
    const second = await deskCharge({ separateCollection: { reason: 'Second villa added; separate deposit' } });
    expect(second.status.payment).toBe('succeeded');
    // And a new deposit link for the same booking is refused while the deposit is already collected.
    await expect(
      org.tx((tx) =>
        svc.tx.createPaymentRequest(tx, {
          propertyId: org.propertyId,
          payer: { type: 'other', name: 'Guest' },
          amount: { amountMinor: 50_000, currency: 'USD' },
          purpose: 'deposit',
          ref: booking,
          expiresAt: new Date(h.clock.now().getTime() + 86_400_000).toISOString(),
          businessKey: newId(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'collection_already_in_progress' });
  });
});

describe('P1-3: Route D duplicates are database facts', () => {
  it('the same approval code recorded concurrently: exactly one record; an audited override allows a real repeat', async () => {
    const org = await setupOrg(h);
    const both = await Promise.allSettled([recordTerminal(org, 'APPR-778899'), recordTerminal(org, 'APPR-778899')]);
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((both.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.code).toBe('duplicate_reference');
    expect(await postings(h, org, 'payment')).toHaveLength(1);
    await recordTerminal(org, 'APPR-778899', { duplicateOverride: { reason: 'Bank reuses 6-digit codes; second card' } });
    expect(await postings(h, org, 'payment')).toHaveLength(2);
    // A different terminal (or another day) is not a duplicate.
    await recordTerminal(org, 'APPR-778899', { terminalId: 'TID-2' });
    expect(await postings(h, org, 'payment')).toHaveLength(3);
  });
});

describe('P1-4: refunds respect corrections', () => {
  it('cannot refund more than the corrected amount (reviewer E3b)', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const rec = await org.tx((tx) =>
      svc.tx.recordPayment(tx, {
        propertyId: org.propertyId,
        method: 'external_terminal',
        accountId: org.terminalAccountId,
        amount: { amountMinor: 100_000, currency: 'USD' },
        ref: { type: 'folio', id: newId() },
        reference: `APPR-${newId().slice(-6)}`,
        receivedAt: h.clock.now().toISOString(),
        businessKey: newId(),
      }),
    );
    await org.tx((tx) =>
      svc.tx.adjustRecordedPayment(tx, {
        paymentId: rec.id,
        amount: { amountMinor: -60_000, currency: 'USD' },
        reason: 'Statement shows 400.00',
        businessKey: newId(),
      }),
    );
    const refund = (amountMinor: number) =>
      org.tx((tx) =>
        svc.tx.recordRefund(tx, {
          paymentId: rec.id,
          amount: { amountMinor, currency: 'USD' },
          reason: 'Refund',
          reference: `RF-${newId().slice(-4)}`,
          businessKey: newId(),
        }),
      );
    await expect(refund(100_000)).rejects.toMatchObject({ code: 'refund_exceeds_refundable' });
    await refund(40_000);
    const v = await svc.view.payment(org.ctx, rec.id);
    expect(v).toMatchObject({ adjustedMinor: -60_000, refundedMinor: 40_000, refundableMinor: 0 });
  });
});

describe('P1-5/P1-6/P1-7/P1-9: Route D and deposits reach finance correctly', () => {
  it('deposits carry the property; statement verification and acquirer fees reach finance; bank receipts need confirmation', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    // P1-5: first deposit on a booking carries propertyId + legal entity.
    const booking = newId();
    const methodId = await addMethod(h, org);
    await svc.chargeNow(org.ctx, {
      propertyId: org.propertyId,
      methodId,
      amount: { amountMinor: 30_000, currency: 'USD' },
      ref: { type: 'booking', id: booking },
      businessKey: newId(),
    });
    expect((await postings(h, org, 'deposit'))[0]?.extra).toMatchObject({
      propertyId: org.propertyId,
      legalEntityId: org.legalEntityId,
    });
    // P1-9 + P1-6: a net-of-fee acquirer settlement verifies on GROSS, posts fees as an expense, tells finance.
    const t = await recordTerminal(org, 'AP-FEE-1');
    const res = await org.tx((tx) =>
      svc.tx.importStatement(tx, {
        propertyId: org.propertyId,
        accountId: org.terminalAccountId,
        source: 'acquirer_settlement',
        fileName: 'bml-net.csv',
        periodFrom: '2026-11-07',
        periodTo: '2026-11-07',
        csv: 'date,gross,fee,net,currency,approval_code\n2026-11-07,250.00,5.00,245.00,USD,AP-FEE-1\n',
      }),
    );
    expect(res).toMatchObject({ matchedCount: 1, exceptionCount: 0, feesMinor: 500 });
    expect((await svc.view.payment(org.ctx, t.id)).status.payment).toBe('recorded_verified');
    expect(await postings(h, org, 'verified')).toEqual([
      expect.objectContaining({ idempotency_key: `payments:verified:payment:${t.id}` }),
    ]);
    expect(await postings(h, org, 'fees')).toEqual([expect.objectContaining({ amount_minor: 500 })]);
    // P1-7: an expected bank transfer needs the sensitive confirmation permission; then it posts once.
    const bt = await org.tx((tx) =>
      svc.tx.recordPayment(tx, {
        propertyId: org.propertyId,
        method: 'bank_transfer',
        amount: { amountMinor: 90_000, currency: 'USD' },
        ref: { type: 'folio', id: newId() },
        reference: 'TT-77',
        receivedAt: h.clock.now().toISOString(),
        businessKey: newId(),
      }),
    );
    expect((await svc.view.payment(org.ctx, bt.id)).status.payment).toBe('awaiting_receipt');
    const desk = org.as(['payments.payment.collect', 'payments.externalRecord.create']);
    await expect(
      withTenantTx(h.db, desk, (tx) => svc.tx.confirmBankTransfer(tx, { paymentId: bt.id, bankReference: 'BML-123' })),
    ).rejects.toMatchObject({ status: 403 });
    const before = (await postings(h, org, 'payment')).length;
    await org.tx((tx) => svc.tx.confirmBankTransfer(tx, { paymentId: bt.id, bankReference: 'BML-123' }));
    await org.tx((tx) => svc.tx.confirmBankTransfer(tx, { paymentId: bt.id, bankReference: 'BML-123' }));
    expect((await svc.view.payment(org.ctx, bt.id)).status.payment).toBe('recorded_verified');
    expect((await postings(h, org, 'payment')).length).toBe(before + 1);
  });

  it('cash is verified against the day’s deposit total, not one line per guest (P2-12)', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    for (const [amount, ref] of [
      [10_000, 'R-1'],
      [5_000, 'R-2'],
    ] as const) {
      await org.tx((tx) =>
        svc.tx.recordPayment(tx, {
          propertyId: org.propertyId,
          method: 'cash',
          amount: { amountMinor: amount, currency: 'USD' },
          ref: { type: 'folio', id: newId() },
          reference: ref,
          receivedAt: h.clock.now().toISOString(),
          businessKey: newId(),
        }),
      );
    }
    const res = await org.tx((tx) =>
      svc.tx.importStatement(tx, {
        propertyId: org.propertyId,
        source: 'cash_deposit',
        fileName: 'cash-deposit-0711.csv',
        periodFrom: '2026-11-07',
        periodTo: '2026-11-07',
        csv: 'date,amount,currency,reference\n2026-11-07,150.00,USD,DEP-0711\n',
      }),
    );
    expect(res).toMatchObject({ matchedCount: 2, exceptionCount: 0 });
  });
});

describe('P1-11: an intent recorded in one environment is never sent in another', () => {
  it('trial → live conversion with a pending simulated intent: nothing is sent', async () => {
    const org = await setupOrg(h, 'trial');
    const svc = h.module.service;
    const methodId = await addMethod(h, org);
    const s = await org.tx((tx) =>
      svc.tx.charge(tx, {
        propertyId: org.propertyId,
        methodId,
        amount: { amountMinor: 5_000, currency: 'USD' },
        ref: { type: 'folio', id: newId() },
        businessKey: newId(),
      }),
    );
    await sql`update platform.tenants set environment = 'live' where id = ${org.tenantId}`.execute(h.t.admin.kysely);
    const liveCtx = { ...org.ctx, environment: 'live' as const };
    await svc.execute(liveCtx, s.operationId as string);
    const p = await svc.view.payment(liveCtx, s.id);
    expect(p.status.payment).toBe('failed');
    expect(p.decline?.code).toBe('environment_changed');
    expect(h.http.calls).toBe(0);
  });
});

describe('P2 fixes', () => {
  it('P2-1: a recurring ledger failure reopens the exception staff resolved (reviewer E6)', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    h.ledger.failWith = 'finance down';
    const p = await paidCharge(org, 10_000);
    const [ex] = (await org.tx((tx) => svc.tx.listExceptions(tx, { status: 'open' }))).filter(
      (e) => e.kind === 'ledger_posting_failed',
    );
    await org.tx((tx) => svc.tx.resolveException(tx, ex?.id as string, ex?.version as number, 'looked at it'));
    h.clock.advance(61_000);
    await svc.runReconciliation(org.ctx);
    const open = (await org.tx((tx) => svc.tx.listExceptions(tx, { status: 'open' }))).filter(
      (e) => e.kind === 'ledger_posting_failed',
    );
    expect(open.map((e) => e.ref?.id)).toEqual([p.id]);
    h.ledger.failWith = null;
  });

  it('P2-2/P2-3: saving a token twice returns the same method; a reused key with different content is refused', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    expect(await addMethod(h, org, 'pm_card_visa')).toBe(await addMethod(h, org, 'pm_card_visa'));
    const p = await paidCharge(org, 50_000);
    const key = `refund-${newId()}`;
    const same = await Promise.all(
      [1, 2, 3].map(() =>
        org.tx((tx) =>
          svc.provider.refund(tx, {
            paymentId: p.id,
            amount: { amountMinor: 10_000, currency: 'USD' },
            reason: 'race',
            idempotencyKey: key,
          }),
        ),
      ),
    );
    expect(new Set(same.map((r) => r.id)).size).toBe(1);
    await expect(
      org.tx((tx) =>
        svc.provider.refund(tx, {
          paymentId: p.id,
          amount: { amountMinor: 20_000, currency: 'USD' },
          reason: 'different',
          idempotencyKey: key,
        }),
      ),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('P2-6: card numbers are refused in every free-text field and in statement files', async () => {
    expect(
      refundInput.safeParse({ paymentId: newId(), amount: { amountMinor: 1, currency: 'USD' }, reason: 'card 4242 4242 4242 4242' })
        .success,
    ).toBe(false);
    expect(
      recordPaymentInput.safeParse({
        propertyId: newId(),
        method: 'cash',
        amount: { amountMinor: 1, currency: 'USD' },
        ref: { type: 'folio', id: newId() },
        reference: 'R-1',
        receivedAt: new Date(0).toISOString(),
        note: 'guest card 4000056655665556',
      }).success,
    ).toBe(false);
    const org = await setupOrg(h);
    await expect(
      org.tx((tx) =>
        h.module.service.tx.importStatement(tx, {
          propertyId: org.propertyId,
          source: 'bank_statement',
          fileName: 'x.csv',
          periodFrom: '2026-11-07',
          periodTo: '2026-11-07',
          csv: 'date,amount,currency,description\n2026-11-07,1.00,USD,card 4242424242424242\n',
        }),
      ),
    ).rejects.toThrow(/card number/);
  });

  it('P2-9: a disputed payment cannot be refunded as well', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const methodId = await addMethod(h, org, 'pm_card_createDispute');
    const p = await svc.chargeNow(org.ctx, {
      propertyId: org.propertyId,
      methodId,
      amount: { amountMinor: 20_000, currency: 'USD' },
      ref: { type: 'folio', id: newId() },
      businessKey: newId(),
    });
    await svc.deliverSimulatorWebhooks(org.ctx, org.simAccountId);
    await expect(
      org.tx((tx) =>
        svc.tx.refund(tx, { paymentId: p.id, amount: { amountMinor: 20_000, currency: 'USD' }, reason: 'x', businessKey: newId() }),
      ),
    ).rejects.toMatchObject({ code: 'payment_disputed' });
  });
});
