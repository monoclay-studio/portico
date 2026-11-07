/**
 * Payments over HTTP through the real composition root. Its LedgerPort is finance (`financeLedgerForPayments`):
 * every confirmed payment is posted exactly once with the property, legal entity and clearing account; folios of
 * another property are refused before any money moves.
 */
import { createHmac } from 'node:crypto';
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiHarness, enrolMfa, provisionWithAdmin, startApi } from './helpers';

let h: ApiHarness;
beforeAll(async () => {
  h = await startApi();
});
afterAll(async () => h?.close());

async function demoOrg(name = 'Demo Resort') {
  const email = `admin-${newId()}@example.mv`;
  const password = 'correct horse battery staple';
  const { tenantId } = await provisionWithAdmin(
    h,
    {
      name,
      slug: `demo-${newId().slice(-12)}`,
      environment: 'demo',
      planCode: 'enterprise',
      admin: { email, displayName: 'Admin' },
    },
    password,
  );
  const login = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });
  const auth = { authorization: `Bearer ${login.json().token}` };
  // Sensitive (⚑) permissions such as legal entities and payment accounts need MFA (ADR-0017 §8).
  await enrolMfa(h.app, auth, password);
  const post = (url: string, payload: unknown, key: string | null = newId()) =>
    h.app.inject({
      method: 'POST',
      url,
      headers: { ...auth, ...(key ? { 'idempotency-key': key } : {}) },
      payload: payload as object,
    });
  const le = await post('/v1/legal-entities', {
    name: 'Azure',
    legalName: 'Azure Pvt Ltd',
    countryCode: 'MV',
    baseCurrency: 'USD',
  });
  const prop = await post('/v1/properties', {
    code: 'AZR',
    name: 'Azure Atoll Resort',
    profile: 'resort',
    legalEntityId: le.json().id,
    countryCode: 'MV',
    timezone: 'Indian/Maldives',
    baseCurrency: 'USD',
    businessDate: '2026-11-07',
  });
  const account = await post('/v1/payments/accounts', {
    legalEntityId: le.json().id,
    provider: 'simulator',
    displayName: 'Simulated cards',
    currencies: ['USD'],
  });
  expect(account.statusCode).toBe(201);
  const method = (token: string) =>
    post('/v1/payments/methods', {
      accountId: account.json().id,
      propertyId: prop.json().id,
      kind: 'card',
      providerToken: token,
      brand: 'visa',
      last4: '4242',
      owner: { type: 'guest_profile', id: newId() },
      // The cardholder's recorded card-on-file agreement: every staff use of a stored card is merchant-initiated (SW-PAY-4).
      mitAgreement: true,
      mandate: {
        termsVersion: 'card-on-file-2027-01',
        acceptedAt: new Date().toISOString(),
        channel: 'front_desk',
      },
    });
  /** A folio of this property (payments refuse unknown bookings and folios — review P1-1). */
  const folio = async () =>
    (
      await post('/v1/finance/folios', {
        propertyId: prop.json().id,
        owner: { type: 'stay', id: newId() },
        payer: { type: 'guest', name: 'Guest' },
      })
    ).json().id as string;
  return {
    tenantId,
    auth,
    post,
    folio,
    propertyId: prop.json().id as string,
    accountId: account.json().id as string,
    accountEtag: account.headers.etag as string,
    method,
  };
}

describe('payments API', () => {
  it('s05 over HTTP: 202 pending verification, retry-safe, second charge blocked, "check now" resolves', async () => {
    const org = await demoOrg();
    const m = await org.method('sim_timeout_then_succeeded');
    expect(m.statusCode).toBe(201);
    const bookingId = await org.folio();
    const body = {
      propertyId: org.propertyId,
      methodId: m.json().id,
      amount: { amountMinor: 84_000, currency: 'USD' },
      ref: { type: 'folio', id: bookingId },
    };
    const noKey = await org.post('/v1/payments/charges', body, null);
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().code).toBe('idempotency_key_required');

    const key = newId();
    const first = await org.post('/v1/payments/charges', body, key);
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({
      status: { payment: 'pending_verification' },
      presentation: { tone: 'pending', confirmed: false },
      provenance: 'simulated',
    });
    expect(first.headers.etag).toBeDefined();

    const blocked = await org.post('/v1/payments/charges', body);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.headers['content-type']).toContain('application/problem+json');
    expect(blocked.json()).toMatchObject({ code: 'payment_pending_verification' });
    expect(blocked.json().detail).toMatch(/charge the guest twice/);

    // The retry with the same key verifies with the provider and returns the SAME payment, now confirmed.
    const retry = await org.post('/v1/payments/charges', body, key);
    expect(retry.statusCode).toBe(201);
    expect(retry.json().id).toBe(first.json().id);
    // payments → finance: the confirmed payment is posted to the folio once.
    expect(retry.json().status).toMatchObject({ payment: 'succeeded', ledger: 'posted' });
    expect(retry.json().issues.map((i: { code: string }) => i.code)).not.toContain('ledger_not_posted');

    const check = await h.app.inject({
      method: 'POST',
      url: `/v1/payments/transactions/${first.json().id}/check`,
      headers: org.auth,
    });
    expect(check.statusCode).toBe(200);
    const status = await h.app.inject({
      method: 'GET',
      url: `/v1/payments/status-by-ref?refType=folio&refId=${bookingId}`,
      headers: org.auth,
    });
    expect(status.json().payments).toHaveLength(1);
    const history = await h.app.inject({
      method: 'GET',
      url: `/v1/payments/transactions/${first.json().id}/history`,
      headers: org.auth,
    });
    expect(history.json().items[0].attempts).toBe(1);
    const records = await h.app.inject({
      method: 'GET',
      url: `/v1/records/payment/${first.json().id}/history`,
      headers: org.auth,
    });
    expect(records.statusCode).toBe(200);
  });

  it('declines are 402 problems that explain the recovery; nothing looks successful', async () => {
    const org = await demoOrg();
    const m = await org.method('pm_card_visa_chargeDeclinedInsufficientFunds');
    const res = await org.post('/v1/payments/charges', {
      propertyId: org.propertyId,
      methodId: m.json().id,
      amount: { amountMinor: 1_000, currency: 'USD' },
      ref: { type: 'folio', id: await org.folio() },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({
      code: 'payment_declined',
      details: { payment: { status: { payment: 'failed' } } },
    });
    expect(res.json().detail).toMatch(/insufficient funds[\s\S]*payment link[\s\S]*Nothing was collected/);
  });

  it('folio collections post to finance; unknown and other-property folios are refused before money moves', async () => {
    const org = await demoOrg();
    const m = await org.method('pm_card_visa');
    const folio = await org.post('/v1/finance/folios', {
      propertyId: org.propertyId,
      owner: { type: 'stay', id: newId() },
      payer: { type: 'guest', name: 'Nadia Rasheed' },
    });
    expect(folio.statusCode).toBe(201);
    const charge = (propertyId: string, folioId: string) =>
      org.post('/v1/payments/charges', {
        propertyId,
        methodId: m.json().id,
        amount: { amountMinor: 1_000, currency: 'USD' },
        ref: { type: 'folio', id: folioId },
      });
    const ok = await charge(org.propertyId, folio.json().id);
    expect(ok.statusCode).toBe(201);
    expect(ok.json().status).toMatchObject({ payment: 'succeeded', ledger: 'posted' });
    const read = await h.app.inject({
      method: 'GET',
      url: `/v1/finance/folios/${folio.json().id}`,
      headers: org.auth,
    });
    expect(read.json().balance).toEqual({ amountMinor: -1_000, currency: 'USD' });

    // Nobody can place an unknown folio: refused, nothing recorded.
    const unknownId = newId();
    const unknown = await charge(org.propertyId, unknownId);
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json().code).toBe('ledger_target_unknown');
    const none = await h.app.inject({
      method: 'GET',
      url: `/v1/payments/status-by-ref?refType=folio&refId=${unknownId}`,
      headers: org.auth,
    });
    expect(none.json()).toMatchObject({ status: 'none', payments: [] });

    // A folio of another property (and legal entity) of the same organization is refused (P0-1, ADR-0015).
    const le2 = await org.post('/v1/legal-entities', {
      name: 'Sister',
      legalName: 'Sister Pvt Ltd',
      countryCode: 'MV',
      baseCurrency: 'USD',
    });
    const p2 = await org.post('/v1/properties', {
      code: 'SIS',
      name: 'Sister Island',
      profile: 'resort',
      legalEntityId: le2.json().id,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      businessDate: '2026-11-07',
    });
    const otherFolio = await org.post('/v1/finance/folios', {
      propertyId: p2.json().id,
      owner: { type: 'stay', id: newId() },
      payer: { type: 'guest', name: 'Other guest' },
    });
    expect(otherFolio.statusCode).toBe(201);
    const cross = await charge(org.propertyId, otherFolio.json().id);
    expect(cross.statusCode).toBe(422);
    expect(cross.json().code).toBe('ledger_target_other_property');
    const otherRead = await h.app.inject({
      method: 'GET',
      url: `/v1/finance/folios/${otherFolio.json().id}`,
      headers: org.auth,
    });
    expect(otherRead.json().balance).toEqual({ amountMinor: 0, currency: 'USD' });
  });

  it('card numbers are refused at the boundary', async () => {
    const org = await demoOrg();
    const res = await org.post('/v1/payments/methods', {
      accountId: org.accountId,
      propertyId: org.propertyId,
      kind: 'card',
      providerToken: '4242424242424242',
      owner: { type: 'guest_profile', id: newId() },
      mitAgreement: false,
    });
    expect(res.statusCode).toBe(400);
    const extra = await org.post('/v1/payments/methods', {
      accountId: org.accountId,
      propertyId: org.propertyId,
      kind: 'card',
      providerToken: 'pm_card_visa',
      cvc: '123',
      owner: { type: 'guest_profile', id: newId() },
      mitAgreement: false,
    });
    expect(extra.statusCode).toBe(400);
  });

  it('s20 over HTTP: provider outage → 503 with safe alternatives; status endpoint shows the banner', async () => {
    const org = await demoOrg();
    const m = await org.method('pm_card_visa');
    const ctl = await h.app.inject({
      method: 'PUT',
      url: `/v1/payments/accounts/${org.accountId}/simulator-controls`,
      headers: org.auth,
      payload: { outage: 'refuse' },
    });
    expect(ctl.statusCode).toBe(400);
    expect(ctl.json().code).toBe('if_match_required');
    const ok = await h.app.inject({
      method: 'PUT',
      url: `/v1/payments/accounts/${org.accountId}/simulator-controls`,
      headers: { ...org.auth, 'if-match': org.accountEtag },
      payload: { outage: 'refuse' },
    });
    expect(ok.statusCode).toBe(200);
    const outageFolio = await org.folio();
    const charge = () =>
      org.post('/v1/payments/charges', {
        propertyId: org.propertyId,
        methodId: m.json().id,
        amount: { amountMinor: 1_000, currency: 'USD' },
        ref: { type: 'folio', id: outageFolio },
      });
    for (let i = 0; i < 3; i++) expect((await charge()).statusCode).toBe(402);
    const down = await charge();
    expect(down.statusCode).toBe(503);
    expect(down.json()).toMatchObject({ code: 'card_payments_unavailable', retryable: true });
    expect(down.json().details.actions.map((a: { key: string }) => a.key)).toContain(
      'record_manual_authorization',
    );
    const status = await h.app.inject({
      method: 'GET',
      url: `/v1/payments/status?propertyId=${org.propertyId}`,
      headers: org.auth,
    });
    expect(status.json()).toMatchObject({
      cardPaymentsAvailable: false,
      banner: expect.stringMatching(/unavailable/),
    });
    const health = await h.app.inject({
      method: 'GET',
      url: `/v1/payments/accounts/${org.accountId}/health`,
      headers: org.auth,
    });
    expect(health.json()).toMatchObject({ state: 'open', cardPaymentsAvailable: false });
  });

  it('another organization cannot see or refund a payment, even with its id', async () => {
    const victim = await demoOrg('Victim');
    const m = await victim.method('pm_card_visa');
    const paid = await victim.post('/v1/payments/charges', {
      propertyId: victim.propertyId,
      methodId: m.json().id,
      amount: { amountMinor: 1_000, currency: 'USD' },
      ref: { type: 'folio', id: await victim.folio() },
    });
    expect(paid.statusCode).toBe(201);
    const attacker = await demoOrg('Attacker');
    const read = await h.app.inject({
      method: 'GET',
      url: `/v1/payments/transactions/${paid.json().id}`,
      headers: attacker.auth,
    });
    expect(read.statusCode).toBe(404);
    const refund = await attacker.post('/v1/payments/refunds', {
      paymentId: paid.json().id,
      amount: { amountMinor: 1_000, currency: 'USD' },
      reason: 'steal',
    });
    expect(refund.statusCode).toBe(404);
    const search = await h.app.inject({
      method: 'GET',
      url: '/v1/search?q=4242%2010.00',
      headers: attacker.auth,
    });
    expect(search.json().items ?? []).toEqual([]);
    const own = await h.app.inject({ method: 'GET', url: '/v1/search?q=4242%2010.00', headers: victim.auth });
    expect(JSON.stringify(own.json())).toContain(paid.json().id);
  });

  it('the public Stripe webhook endpoint verifies signatures on the raw body', async () => {
    const unconfigured = await h.app.inject({
      method: 'POST',
      url: '/v1/payments/webhooks/stripe',
      headers: { 'content-type': 'application/json' },
      payload: '{"id":"evt_1"}',
    });
    expect(unconfigured.statusCode).toBe(503);
    process.env.PAYMENTS_STRIPE_SECRET_KEY_TEST = 'sk_test_apiFixture';
    process.env.PAYMENTS_STRIPE_WEBHOOK_SECRETS_TEST = 'whsec_apiFixture';
    try {
      const body = JSON.stringify({
        id: 'evt_api_1',
        type: 'account.updated',
        livemode: false,
        account: 'acct_1Nobody',
        created: Math.floor(Date.now() / 1000),
        data: { object: { charges_enabled: true } },
      });
      const bad = await h.app.inject({
        method: 'POST',
        url: '/v1/payments/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=00' },
        payload: body,
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().code).toBe('webhook_signature_invalid');
      const t = Math.floor(Date.now() / 1000);
      const sig = createHmac('sha256', 'whsec_apiFixture').update(`${t}.${body}`).digest('hex');
      const ok = await h.app.inject({
        method: 'POST',
        url: '/v1/payments/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` },
        payload: body,
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ received: true, status: 'ignored' });
    } finally {
      delete process.env.PAYMENTS_STRIPE_SECRET_KEY_TEST;
      delete process.env.PAYMENTS_STRIPE_WEBHOOK_SECRETS_TEST;
    }
  });
});
