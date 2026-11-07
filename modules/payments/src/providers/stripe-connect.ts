/**
 * StripeConnectProvider — Route A: Stripe Connect DIRECT charges on the hotel's connected account
 * (research 04 §B2: the connected account is the settlement merchant and disputes debit ITS balance; Monoclay
 * never holds guest funds). Every request carries `Stripe-Account: acct_…` and the operation's persisted
 * `Idempotency-Key`. Authorizations are PaymentIntents with `capture_method=manual`.
 *
 * Status: implemented against Stripe's documented HTTP API and unit-tested with recorded/mock responses ONLY.
 * It has never called Stripe (no keys exist). Readiness: R3 for the adapter code, NOT R4 (no sandbox test yet).
 *
 * Environment safety: constructed only by the provider registry after `assertExternalEffectAllowed`, and it
 * refuses a key whose mode does not match (`sandbox` → test keys only; `live` → live keys only).
 */
import { DomainError, type Money } from '@portico/kernel';
import { type HttpClient, type HttpResponse, HttpTransportError } from './http-client';
import type {
  CallBase,
  Capability,
  LookupCall,
  LookupResult,
  PaymentCall,
  PaymentLinkCall,
  PaymentLinkOutcome,
  PaymentProvider,
  ProviderAccount,
  ProviderOutcome,
  VerifiedWebhook,
  WebhookObject,
} from './provider';
import { WebhookSignatureError } from './provider';
import { verifySignature } from './signature';

export const STRIPE_API_BASE = 'https://api.stripe.com';
/** Pinned API version. Verify against the account's version before the first sandbox test (R4). */
export const STRIPE_API_VERSION = '2024-06-20';
export const STRIPE_SIGNATURE_HEADER = 'stripe-signature';

export interface StripeConnectOptions {
  mode: 'live' | 'sandbox';
  /** Monoclay's Connect PLATFORM key (never the SaaS-billing account key — CLAUDE.md §4.14). */
  secretKey: string;
  /** Connect webhook endpoint signing secrets (several during rotation). */
  webhookSecrets: readonly string[];
  http: HttpClient;
  timeoutMs?: number;
  apiVersion?: string;
  baseUrl?: string;
}

const CAPABILITIES: readonly Capability[] = [
  'hostedCardEntry',
  'authorize',
  'incrementalAuthorize',
  'capture',
  'partialCapture',
  'void',
  'charge',
  'refund',
  'partialRefund',
  'paymentLinks',
  'webhooks',
  'disputes',
  'lookup',
];

/** application/x-www-form-urlencoded with Stripe's bracket notation for nested objects and arrays. */
export function formEncode(params: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') parts.push(formEncode(item as Record<string, unknown>, `${key}[${i}]`));
        else parts.push(`${encodeURIComponent(`${key}[]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === 'object') {
      const nested = formEncode(v as Record<string, unknown>, key);
      if (nested) parts.push(nested);
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

interface StripeError {
  type?: string;
  code?: string;
  decline_code?: string;
  message?: string;
  payment_intent?: { id?: string };
}

interface StripePaymentIntent {
  id: string;
  object: 'payment_intent';
  status: string;
  amount: number;
  amount_capturable?: number;
  amount_received?: number;
  currency: string;
  livemode?: boolean;
  metadata?: Record<string, string>;
  last_payment_error?: StripeError | null;
  latest_charge?:
    | string
    | {
        payment_method_details?: {
          card?: { capture_before?: number; network_transaction_id?: string };
        };
      }
    | null;
}

interface StripeRefund {
  id: string;
  object: 'refund';
  status: string;
  amount: number;
  currency: string;
  payment_intent?: string | null;
  metadata?: Record<string, string>;
  failure_reason?: string | null;
}

type Parsed<T> = { ok: true; body: T } | { ok: false; outcome: ProviderOutcome };

export class StripeConnectProvider implements PaymentProvider {
  readonly kind = 'stripe_connect' as const;
  readonly capabilities = CAPABILITIES;
  readonly mode: 'live' | 'sandbox';
  private readonly timeoutMs: number;

  constructor(private readonly opts: StripeConnectOptions) {
    this.mode = opts.mode;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    const key = opts.secretKey;
    const isTest = /^(sk|rk)_test_/.test(key);
    const isLive = /^(sk|rk)_live_/.test(key);
    if (opts.mode === 'sandbox' && !isTest) {
      throw new DomainError(
        'stripe_key_mode_mismatch',
        'The sandbox environment may only use Stripe TEST keys. Nothing was sent to Stripe.',
        { status: 500 },
      );
    }
    if (opts.mode === 'live' && !isLive) {
      throw new DomainError(
        'stripe_key_mode_mismatch',
        'The live environment requires a Stripe LIVE key. Nothing was sent to Stripe.',
        { status: 500 },
      );
    }
  }

  private headers(account: ProviderAccount, idempotencyKey?: string): Record<string, string> {
    if (!account.externalAccountId) {
      throw new DomainError('stripe_account_missing', 'This payment account has no Stripe connected account id.');
    }
    return {
      authorization: `Bearer ${this.opts.secretKey}`,
      'stripe-account': account.externalAccountId,
      'stripe-version': this.opts.apiVersion ?? STRIPE_API_VERSION,
      'content-type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    };
  }

  private async request<T>(
    account: ProviderAccount,
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<Parsed<T>> {
    const base = this.opts.baseUrl ?? STRIPE_API_BASE;
    const encoded = formEncode(params);
    const url = method === 'GET' && encoded ? `${base}${path}?${encoded}` : `${base}${path}`;
    let res: HttpResponse;
    try {
      res = await this.opts.http.send({
        method,
        url,
        headers: this.headers(account, method === 'POST' ? idempotencyKey : undefined),
        ...(method === 'POST' ? { body: encoded } : {}),
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      if (err instanceof HttpTransportError) {
        return {
          ok: false,
          outcome:
            err.phase === 'connect'
              ? { kind: 'unavailable', reason: err.message }
              : { kind: 'unknown', reason: err.message },
        };
      }
      return { ok: false, outcome: { kind: 'unknown', reason: 'Unexpected transport failure.' } };
    }
    let body: unknown;
    try {
      body = res.body ? JSON.parse(res.body) : {};
    } catch {
      return { ok: false, outcome: { kind: 'unknown', reason: `Unreadable provider response (HTTP ${res.status}).` } };
    }
    if (res.status >= 200 && res.status < 300) {
      const lm = (body as { livemode?: unknown }).livemode;
      if (typeof lm === 'boolean' && lm !== (this.mode === 'live')) {
        return {
          ok: false,
          outcome: {
            kind: 'failed',
            code: 'environment_mismatch',
            message: 'Stripe answered in a different mode than this environment allows.',
          },
        };
      }
      return { ok: true, body: body as T };
    }
    const error = ((body as { error?: StripeError }).error ?? {}) as StripeError;
    return { ok: false, outcome: classifyError(res.status, error) };
  }

  private intentParams(account: ProviderAccount, call: PaymentCall, manual: boolean, fee: number | null) {
    const merchant = call.initiator === 'merchant';
    return {
      amount: call.amount.amountMinor,
      currency: call.amount.currency.toLowerCase(),
      payment_method: call.methodToken,
      customer: call.customerRef ?? undefined,
      confirm: true,
      capture_method: manual ? 'manual' : 'automatic',
      payment_method_types: ['card'],
      off_session: merchant ? true : undefined,
      description: call.description ?? undefined,
      statement_descriptor_suffix: account.statementDescriptor ?? undefined,
      application_fee_amount: fee ?? undefined,
      payment_method_options: manual ? { card: { request_extended_authorization: 'if_available' } } : undefined,
      metadata: { portico_operation_id: call.operationId },
      expand: ['latest_charge'],
    };
  }

  async authorize(account: ProviderAccount, call: PaymentCall): Promise<ProviderOutcome> {
    const r = await this.request<StripePaymentIntent>(
      account,
      'POST',
      '/v1/payment_intents',
      this.intentParams(account, call, true, null),
      call.idempotencyKey,
    );
    return r.ok ? intentOutcome(r.body, 'authorize', call.amount.amountMinor) : r.outcome;
  }

  async charge(account: ProviderAccount, call: PaymentCall & { applicationFeeMinor: number | null }) {
    const r = await this.request<StripePaymentIntent>(
      account,
      'POST',
      '/v1/payment_intents',
      this.intentParams(account, call, false, call.applicationFeeMinor),
      call.idempotencyKey,
    );
    return r.ok ? intentOutcome(r.body, 'charge', call.amount.amountMinor) : r.outcome;
  }

  async incrementAuthorization(account: ProviderAccount, call: CallBase & { providerRef: string; newTotal: Money }) {
    const r = await this.request<StripePaymentIntent>(
      account,
      'POST',
      `/v1/payment_intents/${encodeURIComponent(call.providerRef)}/increment_authorization`,
      { amount: call.newTotal.amountMinor, metadata: { portico_last_operation_id: call.operationId } },
      call.idempotencyKey,
    );
    return r.ok ? intentOutcome(r.body, 'increment', call.newTotal.amountMinor) : r.outcome;
  }

  async capture(
    account: ProviderAccount,
    call: CallBase & { providerRef: string; amount: Money; applicationFeeMinor: number | null },
  ) {
    const r = await this.request<StripePaymentIntent>(
      account,
      'POST',
      `/v1/payment_intents/${encodeURIComponent(call.providerRef)}/capture`,
      {
        amount_to_capture: call.amount.amountMinor,
        application_fee_amount: call.applicationFeeMinor ?? undefined,
        metadata: { portico_last_operation_id: call.operationId },
      },
      call.idempotencyKey,
    );
    return r.ok ? intentOutcome(r.body, 'capture', call.amount.amountMinor) : r.outcome;
  }

  async void(account: ProviderAccount, call: CallBase & { providerRef: string }) {
    const r = await this.request<StripePaymentIntent>(
      account,
      'POST',
      `/v1/payment_intents/${encodeURIComponent(call.providerRef)}/cancel`,
      { cancellation_reason: 'requested_by_customer' },
      call.idempotencyKey,
    );
    return r.ok ? intentOutcome(r.body, 'void', 0) : r.outcome;
  }

  async refund(account: ProviderAccount, call: CallBase & { paymentProviderRef: string; amount: Money; reason: string }) {
    const r = await this.request<StripeRefund>(
      account,
      'POST',
      '/v1/refunds',
      {
        payment_intent: call.paymentProviderRef,
        amount: call.amount.amountMinor,
        metadata: { portico_operation_id: call.operationId },
      },
      call.idempotencyKey,
    );
    return r.ok ? refundOutcome(r.body) : r.outcome;
  }

  async lookup(account: ProviderAccount, call: LookupCall): Promise<LookupResult> {
    if (call.kind === 'refund') return this.lookupRefund(account, call);
    let pi: StripePaymentIntent | null = null;
    const ref = call.kind === 'authorize' || call.kind === 'charge' ? call.providerRef : call.parentProviderRef;
    if (ref) {
      const r = await this.request<StripePaymentIntent>(account, 'GET', `/v1/payment_intents/${encodeURIComponent(ref)}`, {
        expand: ['latest_charge'],
      });
      if (!r.ok) return lookupFailure(r.outcome);
      pi = r.body;
    } else if (call.kind === 'authorize' || call.kind === 'charge') {
      const r = await this.request<{ data: StripePaymentIntent[] }>(account, 'GET', '/v1/payment_intents/search', {
        query: `metadata['portico_operation_id']:'${call.operationId}'`,
      });
      if (!r.ok) return lookupFailure(r.outcome);
      pi = r.body.data[0] ?? null;
    }
    if (!pi) return { found: false };
    return lookupFromIntent(pi, call);
  }

  private async lookupRefund(account: ProviderAccount, call: LookupCall): Promise<LookupResult> {
    if (call.providerRef) {
      const r = await this.request<StripeRefund>(account, 'GET', `/v1/refunds/${encodeURIComponent(call.providerRef)}`, {});
      if (!r.ok) return lookupFailure(r.outcome);
      return finalOrUnknown(refundOutcome(r.body));
    }
    if (!call.parentProviderRef) return { found: false };
    const r = await this.request<{ data: StripeRefund[] }>(account, 'GET', '/v1/refunds', {
      payment_intent: call.parentProviderRef,
      limit: 100,
    });
    if (!r.ok) return lookupFailure(r.outcome);
    const match = r.body.data.find((x) => x.metadata?.portico_operation_id === call.operationId);
    return match ? finalOrUnknown(refundOutcome(match)) : { found: false };
  }

  async createPaymentLink(account: ProviderAccount, call: PaymentLinkCall): Promise<PaymentLinkOutcome> {
    const r = await this.request<{ id: string; url: string | null }>(
      account,
      'POST',
      '/v1/checkout/sessions',
      {
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: call.amount.currency.toLowerCase(),
              unit_amount: call.amount.amountMinor,
              product_data: { name: call.description },
            },
          },
        ],
        expires_at: Math.floor(call.expiresAt.getTime() / 1000),
        metadata: { portico_payment_request_id: call.requestId },
        payment_intent_data: { metadata: { portico_payment_request_id: call.requestId } },
      },
      call.idempotencyKey,
    );
    if (!r.ok) {
      const o = r.outcome;
      if (o.kind === 'failed') return o;
      if (o.kind === 'declined') return { kind: 'failed', code: o.decline.code, message: 'Link creation declined.' };
      return { kind: 'unknown', reason: o.kind === 'unknown' || o.kind === 'unavailable' ? o.reason : 'unknown' };
    }
    if (!r.body.url) return { kind: 'failed', code: 'no_url', message: 'Stripe returned no hosted URL.' };
    return { kind: 'created', linkRef: r.body.id, url: r.body.url };
  }

  parseWebhook(rawBody: string, headers: Record<string, string | undefined>, now: Date): VerifiedWebhook {
    verifySignature(headers[STRIPE_SIGNATURE_HEADER], rawBody, this.opts.webhookSecrets, now);
    let event: {
      id?: unknown;
      type?: unknown;
      livemode?: unknown;
      account?: unknown;
      created?: unknown;
      data?: { object?: Record<string, unknown> };
    };
    try {
      event = JSON.parse(rawBody);
    } catch {
      throw new WebhookSignatureError('Body is not JSON.');
    }
    if (typeof event.id !== 'string' || typeof event.type !== 'string' || typeof event.livemode !== 'boolean') {
      throw new WebhookSignatureError('Malformed Stripe event.');
    }
    if (event.livemode !== (this.mode === 'live')) {
      throw new WebhookSignatureError('Event mode does not match this endpoint.');
    }
    return {
      eventId: event.id,
      type: event.type,
      livemode: event.livemode,
      externalAccountId: typeof event.account === 'string' ? event.account : '',
      createdAt: new Date(Number(event.created ?? 0) * 1000),
      object: normalizeStripeObject(event.type, event.data?.object ?? {}),
      payload: event,
    };
  }
}

// ───────────────────────── mapping helpers (exported for tests) ─────────────────────────

export function classifyError(status: number, error: StripeError): ProviderOutcome {
  if (status === 402 || error.type === 'card_error') {
    return {
      kind: 'declined',
      ...(error.payment_intent?.id ? { providerRef: error.payment_intent.id } : {}),
      decline: {
        code: error.decline_code ?? (error.code === 'card_declined' ? 'generic_decline' : (error.code ?? 'generic_decline')),
        ...(error.message ? { providerMessage: error.message } : {}),
      },
    };
  }
  if (status === 401) {
    return { kind: 'failed', code: 'provider_not_configured', message: 'Stripe rejected the platform credentials.' };
  }
  if (status === 403) {
    return { kind: 'failed', code: 'account_restricted', message: error.message ?? 'Stripe refused this operation.' };
  }
  if (status === 404) {
    return { kind: 'failed', code: 'resource_missing', message: error.message ?? 'No such object at Stripe.' };
  }
  if (status === 429) {
    return { kind: 'failed', code: 'try_again_later', message: 'Stripe rate-limited the request; it was not executed.' };
  }
  if (status === 409) {
    // Concurrent request with the same idempotency key is still running: its result is unknown to us.
    return { kind: 'unknown', reason: 'Stripe is still processing an identical request.' };
  }
  if (status >= 500) return { kind: 'unknown', reason: `Stripe returned HTTP ${status}.` };
  if (error.type === 'idempotency_error') {
    return {
      kind: 'failed',
      code: 'idempotency_conflict',
      message: 'Stripe saw this idempotency key with different parameters; nothing was executed.',
    };
  }
  return { kind: 'failed', code: 'invalid_request', message: error.message ?? `Stripe rejected the request (${status}).` };
}

function captureBefore(pi: StripePaymentIntent): Date | undefined {
  const lc = pi.latest_charge;
  const ts = lc && typeof lc === 'object' ? lc.payment_method_details?.card?.capture_before : undefined;
  return ts ? new Date(ts * 1000) : undefined;
}

function networkTxnId(pi: StripePaymentIntent): string | undefined {
  const lc = pi.latest_charge;
  return lc && typeof lc === 'object' ? lc.payment_method_details?.card?.network_transaction_id : undefined;
}

function declineFrom(pi: StripePaymentIntent): ProviderOutcome {
  const e = pi.last_payment_error ?? {};
  const code = pi.status === 'requires_action' ? 'authentication_required' : (e.decline_code ?? e.code ?? 'generic_decline');
  return {
    kind: 'declined',
    providerRef: pi.id,
    decline: { code: code === 'card_declined' ? 'generic_decline' : code, ...(e.message ? { providerMessage: e.message } : {}) },
  };
}

export function intentOutcome(
  pi: StripePaymentIntent,
  kind: 'authorize' | 'charge' | 'capture' | 'void' | 'increment',
  amountMinor: number,
): ProviderOutcome {
  const capturable = pi.amount_capturable ?? 0;
  const expiresAt = captureBefore(pi);
  const ntid = networkTxnId(pi);
  const ok = (amount: number, remaining?: number): ProviderOutcome => ({
    kind: 'succeeded',
    providerRef: pi.id,
    amountMinor: amount,
    ...(remaining !== undefined ? { remainingAuthorizedMinor: remaining } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(ntid ? { networkTransactionId: ntid } : {}),
  });
  switch (pi.status) {
    case 'requires_capture':
      if (kind === 'authorize') return ok(pi.amount, capturable);
      if (kind === 'increment') return ok(pi.amount, capturable);
      if (kind === 'capture') return ok(amountMinor, capturable);
      return { kind: 'unknown', reason: `PaymentIntent still requires capture after ${kind}.` };
    case 'succeeded':
      if (kind === 'capture') return ok(amountMinor, 0);
      if (kind === 'charge') return ok(pi.amount_received ?? pi.amount);
      if (kind === 'authorize') return ok(pi.amount, 0);
      return { kind: 'failed', code: 'invalid_state', message: 'The payment was already captured.' };
    case 'canceled':
      if (kind === 'void') return ok(0, 0);
      return { kind: 'failed', code: 'invalid_state', message: 'The authorization was released at Stripe.' };
    case 'processing':
      return { kind: 'unknown', reason: 'Stripe is still processing the payment.' };
    case 'requires_payment_method':
    case 'requires_action':
      return declineFrom(pi);
    default:
      return { kind: 'unknown', reason: `Unexpected PaymentIntent status ${pi.status}.` };
  }
}

export function refundOutcome(r: StripeRefund): ProviderOutcome {
  if (r.status === 'succeeded') return { kind: 'succeeded', providerRef: r.id, amountMinor: r.amount };
  if (r.status === 'failed' || r.status === 'canceled') {
    return { kind: 'declined', providerRef: r.id, decline: { code: r.failure_reason ?? 'refund_failed' } };
  }
  return { kind: 'unknown', reason: `Refund is ${r.status} at Stripe.` };
}

function finalOrUnknown(o: ProviderOutcome): LookupResult {
  if (o.kind === 'succeeded' || o.kind === 'declined' || o.kind === 'failed') return { found: true, outcome: o };
  return { found: 'unknown', reason: o.kind === 'unknown' || o.kind === 'unavailable' ? o.reason : 'unknown' };
}

function lookupFailure(o: ProviderOutcome): LookupResult {
  if (o.kind === 'failed' && o.code === 'resource_missing') return { found: false };
  const reason =
    o.kind === 'failed'
      ? o.message
      : o.kind === 'declined'
        ? o.decline.code
        : o.kind === 'unknown' || o.kind === 'unavailable'
          ? o.reason
          : 'unexpected success while looking up';
  return { found: 'unknown', reason };
}

export function lookupFromIntent(pi: StripePaymentIntent, call: LookupCall): LookupResult {
  switch (call.kind) {
    case 'authorize':
    case 'charge':
      return finalOrUnknown(intentOutcome(pi, call.kind, call.amountMinor));
    case 'capture':
      if ((pi.amount_received ?? 0) >= call.amountMinor && (pi.status === 'succeeded' || pi.status === 'requires_capture')) {
        return { found: true, outcome: { kind: 'succeeded', providerRef: pi.id, amountMinor: call.amountMinor, remainingAuthorizedMinor: pi.amount_capturable ?? 0 } };
      }
      return pi.status === 'processing' ? { found: 'unknown', reason: 'processing' } : { found: false };
    case 'void':
      return pi.status === 'canceled'
        ? { found: true, outcome: { kind: 'succeeded', providerRef: pi.id, amountMinor: 0, remainingAuthorizedMinor: 0 } }
        : { found: false };
    case 'increment':
      return pi.amount >= call.amountMinor
        ? { found: true, outcome: { kind: 'succeeded', providerRef: pi.id, amountMinor: pi.amount, remainingAuthorizedMinor: pi.amount_capturable ?? 0 } }
        : { found: false };
    default:
      return { found: false };
  }
}

function unixDate(v: unknown): string | null {
  return typeof v === 'number' ? new Date(v * 1000).toISOString().slice(0, 10) : null;
}

export function normalizeStripeObject(type: string, o: Record<string, unknown>): WebhookObject {
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  const meta = (o.metadata ?? {}) as Record<string, string>;
  if (type.startsWith('payment_intent.')) {
    const status = String(o.status);
    const state =
      status === 'requires_capture'
        ? 'authorized'
        : status === 'succeeded'
          ? 'succeeded'
          : status === 'canceled'
            ? 'canceled'
            : status === 'processing'
              ? 'processing'
              : 'failed';
    const e = (o.last_payment_error ?? null) as StripeError | null;
    return {
      kind: 'payment',
      providerRef: String(o.id),
      state,
      amountMinor: num(o.amount),
      amountCapturableMinor: num(o.amount_capturable),
      amountReceivedMinor: num(o.amount_received),
      currency: String(o.currency ?? '').toUpperCase(),
      operationId: meta.portico_operation_id ?? null,
      decline: e ? { code: e.decline_code ?? e.code ?? 'generic_decline' } : null,
    };
  }
  if (type.startsWith('refund.') || type === 'charge.refund.updated') {
    const status = String(o.status);
    return {
      kind: 'refund',
      providerRef: String(o.id),
      paymentProviderRef: str(o.payment_intent),
      state: status === 'succeeded' ? 'succeeded' : status === 'failed' || status === 'canceled' ? 'failed' : 'pending',
      amountMinor: num(o.amount),
      currency: String(o.currency ?? '').toUpperCase(),
      operationId: meta.portico_operation_id ?? null,
    };
  }
  if (type.startsWith('charge.dispute.')) {
    const status = String(o.status);
    const ed = (o.evidence_details ?? {}) as { due_by?: number };
    const state =
      status === 'won' || status === 'warning_closed'
        ? 'won'
        : status === 'lost'
          ? 'lost'
          : status === 'under_review' || status === 'warning_under_review'
            ? 'evidence_submitted'
            : 'evidence_required';
    return {
      kind: 'dispute',
      providerRef: String(o.id),
      paymentProviderRef: String(o.payment_intent ?? ''),
      state,
      amountMinor: num(o.amount),
      currency: String(o.currency ?? '').toUpperCase(),
      reason: String(o.reason ?? 'unknown'),
      evidenceDueBy: ed.due_by ? new Date(ed.due_by * 1000) : null,
      fundsWithdrawn:
        type === 'charge.dispute.funds_withdrawn' || (Array.isArray(o.balance_transactions) && o.balance_transactions.length > 0),
    };
  }
  if (type.startsWith('payout.')) {
    const status = String(o.status);
    return {
      kind: 'payout',
      providerRef: String(o.id),
      state: status === 'paid' ? 'paid' : status === 'failed' || status === 'canceled' ? 'failed' : 'in_transit',
      amountMinor: num(o.amount),
      currency: String(o.currency ?? '').toUpperCase(),
      arrivalDate: unixDate(o.arrival_date),
      failureCode: str(o.failure_code),
    };
  }
  if (type === 'checkout.session.completed' || type === 'checkout.session.expired') {
    return {
      kind: 'payment_link',
      providerRef: String(o.id),
      requestId: meta.portico_payment_request_id ?? null,
      paymentProviderRef: str(o.payment_intent),
      state: type === 'checkout.session.completed' && o.payment_status === 'paid' ? 'completed' : 'expired',
      amountMinor: num(o.amount_total),
      currency: String(o.currency ?? '').toUpperCase(),
    };
  }
  if (type === 'account.updated') {
    const req = (o.requirements ?? {}) as { disabled_reason?: string | null };
    return {
      kind: 'account',
      chargesEnabled: o.charges_enabled === true,
      payoutsEnabled: o.payouts_enabled === true,
      disabledReason: req.disabled_reason ?? null,
    };
  }
  return { kind: 'unknown', rawType: type };
}
