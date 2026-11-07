/**
 * StripeConnectProvider against RECORDED / MOCK responses only (shapes from Stripe's public API reference).
 * Never calls Stripe: the HTTP client is a fake that records requests and replays canned responses.
 */
import { describe, expect, it } from 'vitest';
import type { HttpClient, HttpRequest, HttpResponse } from './http-client';
import { HttpTransportError } from './http-client';
import type { ProviderAccount } from './provider';
import { WebhookSignatureError } from './provider';
import { signatureHeader } from './signature';
import {
  classifyError,
  formEncode,
  normalizeStripeObject,
  STRIPE_SIGNATURE_HEADER,
  StripeConnectProvider,
} from './stripe-connect';

const account: ProviderAccount = {
  id: '018f0000-0000-7000-8000-000000000001',
  tenantId: '018f0000-0000-7000-8000-000000000002',
  provider: 'stripe_connect',
  externalAccountId: 'acct_1HotelMaldives',
  currencies: ['USD'],
  applicationFeeBps: 50,
  statementDescriptor: 'AZURE ATOLL',
  simulatorControls: {},
};

function fakeHttp(responses: Array<HttpResponse | Error>): HttpClient & { requests: HttpRequest[] } {
  const requests: HttpRequest[] = [];
  return {
    requests,
    async send(req) {
      requests.push(req);
      const r = responses.shift();
      if (!r) throw new Error('no canned response');
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

const json = (status: number, body: unknown): HttpResponse => ({ status, body: JSON.stringify(body) });

const PI_REQUIRES_CAPTURE = {
  id: 'pi_3PabcHotel',
  object: 'payment_intent',
  status: 'requires_capture',
  amount: 50_000,
  amount_capturable: 50_000,
  amount_received: 0,
  currency: 'usd',
  livemode: false,
  metadata: { portico_operation_id: 'op-1' },
  latest_charge: {
    id: 'ch_1',
    payment_method_details: { card: { capture_before: 1_794_000_000, network_transaction_id: 'NTID123' } },
  },
};

function provider(http: HttpClient, mode: 'sandbox' | 'live' = 'sandbox') {
  return new StripeConnectProvider({
    mode,
    secretKey: mode === 'sandbox' ? 'sk_test_fixture' : 'sk_live_fixture',
    webhookSecrets: ['whsec_fixture'],
    http,
  });
}

const call = {
  operationId: 'op-1',
  idempotencyKey: 'portico-authorize-op-1',
  amount: { amountMinor: 50_000, currency: 'USD' },
  methodToken: 'pm_card_visa',
  customerRef: 'cus_123',
  initiator: 'customer' as const,
  networkTransactionId: null,
  description: null,
};

describe('StripeConnectProvider requests', () => {
  it('authorizes as a direct charge on the connected account with manual capture and the persisted key', async () => {
    const http = fakeHttp([json(200, PI_REQUIRES_CAPTURE)]);
    const out = await provider(http).authorize(account, call);
    expect(out).toMatchObject({
      kind: 'succeeded',
      providerRef: 'pi_3PabcHotel',
      remainingAuthorizedMinor: 50_000,
      networkTransactionId: 'NTID123',
    });
    expect(out.kind === 'succeeded' && out.expiresAt?.getTime()).toBe(1_794_000_000_000);
    const req = http.requests[0] as HttpRequest;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://api.stripe.com/v1/payment_intents');
    expect(req.headers).toMatchObject({
      'stripe-account': 'acct_1HotelMaldives', // direct charge: the hotel is the merchant of record
      'idempotency-key': 'portico-authorize-op-1',
      authorization: 'Bearer sk_test_fixture',
    });
    const body = new URLSearchParams(req.body);
    expect(body.get('capture_method')).toBe('manual');
    expect(body.get('confirm')).toBe('true');
    expect(body.get('currency')).toBe('usd');
    expect(body.get('metadata[portico_operation_id]')).toBe('op-1');
    expect(body.get('payment_method_options[card][request_extended_authorization]')).toBe('if_available');
    expect(body.has('application_fee_amount')).toBe(false); // fee only on collection
    expect(body.has('transfer_data[destination]')).toBe(false); // never a destination charge
    expect(body.has('on_behalf_of')).toBe(false);
  });

  it('charges with the optional platform application fee and flags merchant-initiated charges off-session', async () => {
    const http = fakeHttp([
      json(200, { ...PI_REQUIRES_CAPTURE, status: 'succeeded', amount_received: 50_000 }),
    ]);
    const out = await provider(http).charge(account, {
      ...call,
      initiator: 'merchant',
      applicationFeeMinor: 250,
    });
    expect(out).toMatchObject({ kind: 'succeeded', amountMinor: 50_000 });
    const body = new URLSearchParams(http.requests[0]?.body);
    expect(body.get('capture_method')).toBe('automatic');
    expect(body.get('application_fee_amount')).toBe('250');
    expect(body.get('off_session')).toBe('true');
  });

  it('captures, increments, voids and refunds against the intent', async () => {
    const http = fakeHttp([
      json(200, {
        ...PI_REQUIRES_CAPTURE,
        status: 'succeeded',
        amount_capturable: 0,
        amount_received: 30_000,
      }),
      json(200, { ...PI_REQUIRES_CAPTURE, amount: 70_000, amount_capturable: 70_000 }),
      json(200, { ...PI_REQUIRES_CAPTURE, status: 'canceled', amount_capturable: 0 }),
      json(200, {
        id: 're_1',
        object: 'refund',
        status: 'succeeded',
        amount: 1_000,
        currency: 'usd',
        payment_intent: 'pi_3PabcHotel',
      }),
    ]);
    const p = provider(http);
    const base = { operationId: 'op-2', idempotencyKey: 'k2' };
    expect(
      await p.capture(account, {
        ...base,
        providerRef: 'pi_3PabcHotel',
        amount: { amountMinor: 30_000, currency: 'USD' },
        applicationFeeMinor: 150,
      }),
    ).toMatchObject({ kind: 'succeeded', amountMinor: 30_000, remainingAuthorizedMinor: 0 });
    expect(http.requests[0]?.url).toBe('https://api.stripe.com/v1/payment_intents/pi_3PabcHotel/capture');
    expect(new URLSearchParams(http.requests[0]?.body).get('amount_to_capture')).toBe('30000');
    expect(
      await p.incrementAuthorization(account, {
        ...base,
        providerRef: 'pi_3PabcHotel',
        newTotal: { amountMinor: 70_000, currency: 'USD' },
      }),
    ).toMatchObject({ kind: 'succeeded', amountMinor: 70_000 });
    expect(http.requests[1]?.url).toMatch(/increment_authorization$/);
    expect(await p.void(account, { ...base, providerRef: 'pi_3PabcHotel' })).toMatchObject({
      kind: 'succeeded',
    });
    expect(http.requests[2]?.url).toMatch(/\/cancel$/);
    expect(
      await p.refund(account, {
        ...base,
        paymentProviderRef: 'pi_3PabcHotel',
        amount: { amountMinor: 1_000, currency: 'USD' },
        reason: 'x',
      }),
    ).toMatchObject({ kind: 'succeeded', providerRef: 're_1' });
    expect(new URLSearchParams(http.requests[3]?.body).get('payment_intent')).toBe('pi_3PabcHotel');
  });
});

describe('StripeConnectProvider outcomes are never guessed', () => {
  it('maps card declines with decline codes', async () => {
    const http = fakeHttp([
      json(402, {
        error: {
          type: 'card_error',
          code: 'card_declined',
          decline_code: 'insufficient_funds',
          message: 'Your card has insufficient funds.',
          payment_intent: { id: 'pi_declined' },
        },
      }),
    ]);
    expect(await provider(http).authorize(account, call)).toEqual({
      kind: 'declined',
      providerRef: 'pi_declined',
      decline: { code: 'insufficient_funds', providerMessage: 'Your card has insufficient funds.' },
    });
  });

  it('treats timeouts, network errors and 5xx as UNKNOWN; connection refused as not executed', async () => {
    const p = provider(
      fakeHttp([
        new HttpTransportError('timeout', 'timed out'),
        new HttpTransportError('network', 'reset'),
        json(500, { error: { type: 'api_error' } }),
        json(409, { error: { type: 'invalid_request_error' } }),
        new HttpTransportError('connect', 'ECONNREFUSED'),
      ]),
    );
    expect((await p.charge(account, { ...call, applicationFeeMinor: null })).kind).toBe('unknown');
    expect((await p.charge(account, { ...call, applicationFeeMinor: null })).kind).toBe('unknown');
    expect((await p.charge(account, { ...call, applicationFeeMinor: null })).kind).toBe('unknown');
    expect((await p.charge(account, { ...call, applicationFeeMinor: null })).kind).toBe('unknown');
    expect((await p.charge(account, { ...call, applicationFeeMinor: null })).kind).toBe('unavailable');
  });

  it('classifies definitive refusals', () => {
    expect(classifyError(401, {})).toMatchObject({ kind: 'failed', code: 'provider_not_configured' });
    expect(classifyError(403, {})).toMatchObject({ kind: 'failed', code: 'account_restricted' });
    expect(classifyError(404, {})).toMatchObject({ kind: 'failed', code: 'resource_missing' });
    expect(classifyError(429, {})).toMatchObject({ kind: 'failed', code: 'try_again_later' });
    expect(classifyError(400, { type: 'idempotency_error' })).toMatchObject({ code: 'idempotency_conflict' });
    expect(classifyError(400, { type: 'invalid_request_error', message: 'bad' })).toMatchObject({
      code: 'invalid_request',
    });
  });

  it('treats processing and requires_action correctly', async () => {
    const http = fakeHttp([
      json(200, { ...PI_REQUIRES_CAPTURE, status: 'processing' }),
      json(200, { ...PI_REQUIRES_CAPTURE, status: 'requires_action' }),
    ]);
    const p = provider(http);
    expect((await p.charge(account, { ...call, applicationFeeMinor: null })).kind).toBe('unknown');
    expect(await p.charge(account, { ...call, applicationFeeMinor: null })).toMatchObject({
      kind: 'declined',
      decline: { code: 'authentication_required' },
    });
  });

  it('refuses a response from the other mode', async () => {
    const http = fakeHttp([json(200, { ...PI_REQUIRES_CAPTURE, livemode: true })]);
    expect(await provider(http).authorize(account, call)).toMatchObject({
      kind: 'failed',
      code: 'environment_mismatch',
    });
  });

  it('refuses keys of the wrong mode before any request', () => {
    expect(
      () =>
        new StripeConnectProvider({
          mode: 'sandbox',
          secretKey: 'sk_live_x',
          webhookSecrets: [],
          http: fakeHttp([]),
        }),
    ).toThrow(/TEST keys/);
    expect(
      () =>
        new StripeConnectProvider({
          mode: 'live',
          secretKey: 'sk_test_x',
          webhookSecrets: [],
          http: fakeHttp([]),
        }),
    ).toThrow(/LIVE key/);
  });
});

describe('StripeConnectProvider lookups', () => {
  it('finds an intent by operation metadata when the call timed out before returning an id', async () => {
    const http = fakeHttp([
      json(200, {
        object: 'search_result',
        data: [{ ...PI_REQUIRES_CAPTURE, status: 'succeeded', amount_received: 50_000 }],
      }),
    ]);
    const r = await provider(http).lookup(account, {
      operationId: 'op-1',
      kind: 'charge',
      idempotencyKey: 'k',
      providerRef: null,
      parentProviderRef: null,
      amountMinor: 50_000,
    });
    expect(r).toMatchObject({ found: true, outcome: { kind: 'succeeded', providerRef: 'pi_3PabcHotel' } });
    expect(http.requests[0]?.method).toBe('GET');
    expect(decodeURIComponent(http.requests[0]?.url ?? '')).toContain(
      "metadata['portico_operation_id']:'op-1'",
    );
  });

  it('reports not-found and unknown honestly', async () => {
    const http = fakeHttp([
      json(200, { data: [] }),
      json(404, { error: { type: 'invalid_request_error' } }),
      new HttpTransportError('timeout', 't'),
    ]);
    const p = provider(http);
    const base = {
      operationId: 'op',
      kind: 'charge' as const,
      idempotencyKey: 'k',
      parentProviderRef: null,
      amountMinor: 1,
    };
    expect(await p.lookup(account, { ...base, providerRef: null })).toEqual({ found: false });
    expect(await p.lookup(account, { ...base, providerRef: 'pi_missing' })).toEqual({ found: false });
    expect((await p.lookup(account, { ...base, providerRef: 'pi_x' })).found).toBe('unknown');
  });

  it('finds a refund by operation metadata on the payment intent', async () => {
    const http = fakeHttp([
      json(200, {
        data: [
          {
            id: 're_other',
            object: 'refund',
            status: 'succeeded',
            amount: 1,
            currency: 'usd',
            metadata: { portico_operation_id: 'x' },
          },
          {
            id: 're_mine',
            object: 'refund',
            status: 'succeeded',
            amount: 500,
            currency: 'usd',
            metadata: { portico_operation_id: 'op-r' },
          },
        ],
      }),
    ]);
    const r = await provider(http).lookup(account, {
      operationId: 'op-r',
      kind: 'refund',
      idempotencyKey: 'k',
      providerRef: null,
      parentProviderRef: 'pi_1',
      amountMinor: 500,
    });
    expect(r).toMatchObject({ found: true, outcome: { providerRef: 're_mine', amountMinor: 500 } });
  });
});

describe('Stripe webhooks', () => {
  const now = new Date('2026-11-07T10:00:00Z');
  const t = Math.floor(now.getTime() / 1000);
  const event = (type: string, object: Record<string, unknown>, livemode = false) =>
    JSON.stringify({
      id: 'evt_1',
      type,
      livemode,
      account: 'acct_1HotelMaldives',
      created: t,
      data: { object },
    });

  it('verifies signatures (constant-time, tolerance window) and normalizes objects', () => {
    const p = provider(fakeHttp([]));
    const body = event('payment_intent.succeeded', {
      ...PI_REQUIRES_CAPTURE,
      status: 'succeeded',
      amount_received: 50_000,
    });
    const ok = p.parseWebhook(
      body,
      { [STRIPE_SIGNATURE_HEADER]: signatureHeader('whsec_fixture', t, body) },
      now,
    );
    expect(ok).toMatchObject({
      eventId: 'evt_1',
      externalAccountId: 'acct_1HotelMaldives',
      object: {
        kind: 'payment',
        state: 'succeeded',
        amountReceivedMinor: 50_000,
        currency: 'USD',
        operationId: 'op-1',
      },
    });
    expect(() =>
      p.parseWebhook(body, { [STRIPE_SIGNATURE_HEADER]: signatureHeader('whsec_wrong', t, body) }, now),
    ).toThrow(WebhookSignatureError);
    expect(() =>
      p.parseWebhook(
        body,
        { [STRIPE_SIGNATURE_HEADER]: signatureHeader('whsec_fixture', t - 3600, body) },
        now,
      ),
    ).toThrow(/tolerance/);
    expect(() =>
      p.parseWebhook(
        `${body} `,
        { [STRIPE_SIGNATURE_HEADER]: signatureHeader('whsec_fixture', t, body) },
        now,
      ),
    ).toThrow(/does not match/);
    const live = event('payment_intent.succeeded', PI_REQUIRES_CAPTURE, true);
    expect(() =>
      p.parseWebhook(live, { [STRIPE_SIGNATURE_HEADER]: signatureHeader('whsec_fixture', t, live) }, now),
    ).toThrow(/mode does not match/);
  });

  it('normalizes refunds, disputes, payouts, checkout sessions, accounts and unknown events', () => {
    expect(
      normalizeStripeObject('charge.refund.updated', {
        id: 're_1',
        status: 'failed',
        amount: 5,
        currency: 'usd',
        payment_intent: 'pi_1',
      }),
    ).toMatchObject({
      kind: 'refund',
      state: 'failed',
    });
    expect(
      normalizeStripeObject('charge.dispute.created', {
        id: 'dp_1',
        status: 'needs_response',
        amount: 100,
        currency: 'usd',
        payment_intent: 'pi_1',
        reason: 'fraudulent',
        evidence_details: { due_by: t },
        balance_transactions: [{ id: 'txn_1' }],
      }),
    ).toMatchObject({
      kind: 'dispute',
      state: 'evidence_required',
      fundsWithdrawn: true,
      evidenceDueBy: now,
    });
    expect(
      normalizeStripeObject('payout.failed', {
        id: 'po_1',
        status: 'failed',
        amount: 10,
        currency: 'usd',
        failure_code: 'account_closed',
        arrival_date: t,
      }),
    ).toMatchObject({
      kind: 'payout',
      state: 'failed',
      arrivalDate: '2026-11-07',
      failureCode: 'account_closed',
    });
    expect(
      normalizeStripeObject('checkout.session.completed', {
        id: 'cs_1',
        payment_status: 'paid',
        amount_total: 100,
        currency: 'usd',
        payment_intent: 'pi_9',
        metadata: { portico_payment_request_id: 'req-1' },
      }),
    ).toMatchObject({
      kind: 'payment_link',
      state: 'completed',
      requestId: 'req-1',
      paymentProviderRef: 'pi_9',
    });
    expect(
      normalizeStripeObject('account.updated', {
        charges_enabled: false,
        requirements: { disabled_reason: 'requirements.past_due' },
      }),
    ).toEqual({
      kind: 'account',
      chargesEnabled: false,
      payoutsEnabled: false,
      disabledReason: 'requirements.past_due',
    });
    expect(normalizeStripeObject('issuing_card.created', {})).toEqual({
      kind: 'unknown',
      rawType: 'issuing_card.created',
    });
  });
});

describe('form encoding', () => {
  it('uses Stripe bracket notation and skips undefined values', () => {
    expect(
      decodeURIComponent(
        formEncode({
          a: 1,
          b: undefined,
          metadata: { x: 'y' },
          list: ['card'],
          items: [{ q: 1, p: { c: 'usd' } }],
        }),
      ),
    ).toBe('a=1&metadata[x]=y&list[]=card&items[0][q]=1&items[0][p][c]=usd');
  });
});

describe('StripeConnectProvider payment links (re-review #4 R4-P3-5)', () => {
  const linkCall = {
    operationId: 'req-1',
    idempotencyKey: 'portico-link-req-1',
    amount: { amountMinor: 23_400, currency: 'USD' },
    description: 'Charges posted after departure',
    expiresAt: new Date('2027-03-19T10:00:00Z'),
    requestId: 'req-1',
    now: new Date('2027-03-12T10:00:00Z'),
  };

  it('caps the Checkout Session lifetime below Stripe’s 24 hours, whatever the request’s expiry', async () => {
    const http = fakeHttp([json(200, { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' })]);
    const out = await provider(http).createPaymentLink(account, linkCall);
    expect(out).toEqual({ kind: 'created', linkRef: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const body = new URLSearchParams(http.requests[0]?.body ?? '');
    const expiresAt = Number(body.get('expires_at'));
    expect(expiresAt * 1000 - linkCall.now.getTime()).toBe(23 * 3_600_000);
  });

  it('deactivates a link by expiring its session; "complete" is already paid; errors are read back', async () => {
    const off = { operationId: 'req-1', idempotencyKey: 'portico-link-off-req-1', linkRef: 'cs_test_1' };
    // expire → expired
    let http = fakeHttp([json(200, { id: 'cs_test_1', status: 'expired' })]);
    expect(await provider(http).deactivatePaymentLink(account, off)).toEqual({ kind: 'deactivated' });
    expect(http.requests[0]?.url).toMatch(/\/v1\/checkout\/sessions\/cs_test_1\/expire$/);
    expect(http.requests[0]?.headers?.['idempotency-key']).toBe('portico-link-off-req-1');
    // expire refused because the session completed → read it → already paid
    http = fakeHttp([
      json(400, { error: { type: 'invalid_request_error', code: 'checkout_session_complete', message: 'complete' } }),
      json(200, { id: 'cs_test_1', status: 'complete' }),
    ]);
    expect(await provider(http).deactivatePaymentLink(account, off)).toEqual({ kind: 'already_completed' });
    // expire refused because it already expired → read it → deactivated
    http = fakeHttp([
      json(400, { error: { type: 'invalid_request_error', message: 'already expired' } }),
      json(200, { id: 'cs_test_1', status: 'expired' }),
    ]);
    expect(await provider(http).deactivatePaymentLink(account, off)).toEqual({ kind: 'deactivated' });
    // the provider does not answer → unknown (Portico keeps the link "possibly payable")
    http = fakeHttp([new HttpTransportError('timeout', 'timed out')]);
    expect((await provider(http).deactivatePaymentLink(account, off)).kind).toBe('unknown');
  });
});
