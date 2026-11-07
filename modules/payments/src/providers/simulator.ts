/**
 * SimulatorProvider — the default provider for demo, trial and training organizations and for tests.
 *
 * It behaves like a real PSP with idempotency keys, webhooks and lookups, and its "provider side" state is
 * persisted (payments.simulator_objects) so the API and the worker see the same simulated provider. It uses
 * ONLY simulator test tokens (`sim_…`) or Stripe's public test PaymentMethod ids (`pm_card_…`); it never
 * receives card numbers. Deterministic scenarios are chosen by the test token or by account-level controls:
 *
 *   approve · decline (with reason code) · soft decline · timeout-then-succeeded · timeout-then-failed ·
 *   provider outage (refuse | timeout) · duplicate webhooks · out-of-order webhooks · delayed settlement ·
 *   dispute · VCC funding delay.
 */
import { type PorticoDatabase, sql, type TxContext, typed, withTenantTx } from '@portico/db';
import { type Money, newId, randomToken, systemContext } from '@portico/kernel';
import type { PaymentsDB } from '../tables';
import {
  type CallBase,
  type Capability,
  type LookupCall,
  type LookupResult,
  type PaymentCall,
  type PaymentLinkCall,
  type PaymentLinkOutcome,
  type PaymentProvider,
  type ProviderAccount,
  type ProviderMode,
  type ProviderOutcome,
  type VerifiedWebhook,
  type WebhookObject,
  WebhookSignatureError,
} from './provider';
import { signatureHeader, verifySignature } from './signature';

export const SIMULATOR_SIGNATURE_HEADER = 'portico-simulator-signature';

export type SimScenario =
  | { kind: 'approve' }
  | { kind: 'decline'; code: string }
  | { kind: 'timeout_then_succeeded' }
  | { kind: 'timeout_then_failed'; code: string }
  | { kind: 'dispute' }
  | { kind: 'vcc_funding_delay'; failures: number };

export interface SimulatorTestToken {
  token: string;
  brand: string;
  last4: string;
  scenario: SimScenario;
  description: string;
}

/**
 * Approved TEST instruments. `pm_card_*` are Stripe's documented public test PaymentMethod ids (no card data);
 * `sim_*` are Portico simulator tokens for scenarios Stripe test cards cannot express (timeouts, funding delay).
 */
export const SIMULATOR_TEST_TOKENS: readonly SimulatorTestToken[] = [
  {
    token: 'pm_card_visa',
    brand: 'visa',
    last4: '4242',
    scenario: { kind: 'approve' },
    description: 'Approves.',
  },
  {
    token: 'pm_card_mastercard',
    brand: 'mastercard',
    last4: '4444',
    scenario: { kind: 'approve' },
    description: 'Approves.',
  },
  {
    token: 'pm_card_amex',
    brand: 'amex',
    last4: '8431',
    scenario: { kind: 'approve' },
    description: 'Approves.',
  },
  {
    token: 'pm_card_visa_chargeDeclined',
    brand: 'visa',
    last4: '0002',
    scenario: { kind: 'decline', code: 'generic_decline' },
    description: 'Declined by the issuer without a reason.',
  },
  {
    token: 'pm_card_visa_chargeDeclinedInsufficientFunds',
    brand: 'visa',
    last4: '9995',
    scenario: { kind: 'decline', code: 'insufficient_funds' },
    description: 'Declined: insufficient funds.',
  },
  {
    token: 'pm_card_chargeDeclinedExpiredCard',
    brand: 'visa',
    last4: '0069',
    scenario: { kind: 'decline', code: 'expired_card' },
    description: 'Declined: expired card.',
  },
  {
    token: 'pm_card_chargeDeclinedStolenCard',
    brand: 'visa',
    last4: '9979',
    scenario: { kind: 'decline', code: 'stolen_card' },
    description: 'Declined: the card cannot be used.',
  },
  {
    token: 'pm_card_authenticationRequired',
    brand: 'visa',
    last4: '3184',
    scenario: { kind: 'decline', code: 'authentication_required' },
    description: 'Soft decline: the guest must authenticate (3-D Secure).',
  },
  {
    token: 'sim_soft_decline_try_again_later',
    brand: 'visa',
    last4: '1111',
    scenario: { kind: 'decline', code: 'try_again_later' },
    description: 'Soft decline: temporary network issue.',
  },
  {
    token: 'sim_timeout_then_succeeded',
    brand: 'visa',
    last4: '2222',
    scenario: { kind: 'timeout_then_succeeded' },
    description: 'The call times out, but the provider DID collect the money (scenario s05).',
  },
  {
    token: 'sim_timeout_then_failed',
    brand: 'visa',
    last4: '3333',
    scenario: { kind: 'timeout_then_failed', code: 'processing_error' },
    description: 'The call times out and the provider did NOT collect the money.',
  },
  {
    token: 'pm_card_createDispute',
    brand: 'visa',
    last4: '0259',
    scenario: { kind: 'dispute' },
    description: 'Approves, then the cardholder disputes the payment.',
  },
  {
    token: 'sim_vcc_funding_delay',
    brand: 'mastercard',
    last4: '5100',
    scenario: { kind: 'vcc_funding_delay', failures: 2 },
    description: 'Virtual card declines as not yet funded twice, then approves.',
  },
];

const TOKEN_INDEX = new Map(SIMULATOR_TEST_TOKENS.map((t) => [t.token, t]));

export function isSimulatorTestToken(token: string): boolean {
  return TOKEN_INDEX.has(token);
}

export function scenarioForToken(token: string): SimScenario | undefined {
  return TOKEN_INDEX.get(token)?.scenario;
}

/** Account-level overrides (tests / demo presenter). Parsed from SimulatorControls.scenarioOverrides. */
type Overrides = Partial<
  Record<'authorize' | 'charge' | 'capture' | 'refund' | 'increment' | 'void', string>
>;

function parseScenario(s: string | undefined): SimScenario | undefined {
  if (!s) return undefined;
  if (s === 'approve') return { kind: 'approve' };
  if (s === 'timeout_then_succeeded') return { kind: 'timeout_then_succeeded' };
  if (s === 'timeout_then_failed') return { kind: 'timeout_then_failed', code: 'processing_error' };
  if (s.startsWith('decline:')) return { kind: 'decline', code: s.slice('decline:'.length) };
  return undefined;
}

interface StoredObject {
  object_id: string;
  kind: string;
  status: string;
  currency: string;
  amount_minor: number;
  data: Record<string, unknown>;
}

const CAPABILITIES: readonly Capability[] = [
  'hostedCardEntry',
  'authorize',
  'incrementalAuthorize',
  'capture',
  'partialCapture',
  'multiCapture',
  'void',
  'charge',
  'refund',
  'partialRefund',
  'paymentLinks',
  'webhooks',
  'payoutReports',
  'disputes',
  'lookup',
];

export class SimulatorProvider implements PaymentProvider {
  readonly kind = 'simulator' as const;
  readonly capabilities = CAPABILITIES;

  constructor(
    private readonly database: PorticoDatabase,
    private readonly signingSecret: string,
    readonly mode: ProviderMode = 'simulate',
  ) {}

  private now(): Date {
    return this.database.clock.now();
  }

  private tx<T>(account: ProviderAccount, fn: (tx: TxContext) => Promise<T>): Promise<T> {
    const ctx = systemContext(account.tenantId, 'payments-simulator', 'demo', newId());
    return withTenantTx(this.database, ctx, fn);
  }

  private db(tx: TxContext) {
    return typed<PaymentsDB>(tx.db);
  }

  private async find(
    tx: TxContext,
    account: ProviderAccount,
    key: string,
  ): Promise<StoredObject | undefined> {
    return this.db(tx)
      .selectFrom('payments.simulator_objects')
      .select(['object_id', 'kind', 'status', 'currency', 'amount_minor', 'data'])
      .where('account_id', '=', account.id)
      .where('idempotency_key', '=', key)
      .executeTakeFirst() as Promise<StoredObject | undefined>;
  }

  private async findById(tx: TxContext, objectId: string): Promise<StoredObject | undefined> {
    return this.db(tx)
      .selectFrom('payments.simulator_objects')
      .select(['object_id', 'kind', 'status', 'currency', 'amount_minor', 'data'])
      .where('object_id', '=', objectId)
      .forUpdate()
      .executeTakeFirst() as Promise<StoredObject | undefined>;
  }

  private async insert(
    tx: TxContext,
    account: ProviderAccount,
    key: string,
    obj: Omit<StoredObject, 'object_id'> & { object_id?: string },
  ): Promise<string> {
    const objectId = obj.object_id ?? `sim_${obj.kind}_${randomToken(9).replace(/[^A-Za-z0-9]/g, 'x')}`;
    await this.db(tx)
      .insertInto('payments.simulator_objects')
      .values({
        tenant_id: account.tenantId,
        account_id: account.id,
        idempotency_key: key,
        object_id: objectId,
        kind: obj.kind,
        status: obj.status,
        currency: obj.currency,
        amount_minor: obj.amount_minor,
        data: JSON.stringify(obj.data),
        created_at: this.now(),
        updated_at: this.now(),
      })
      .execute();
    return objectId;
  }

  private async update(tx: TxContext, objectId: string, status: string, data: Record<string, unknown>) {
    await this.db(tx)
      .updateTable('payments.simulator_objects')
      .set({ status, data: JSON.stringify(data), updated_at: this.now() })
      .where('object_id', '=', objectId)
      .execute();
  }

  private async queueEvent(tx: TxContext, account: ProviderAccount, type: string, object: WebhookObject) {
    const eventId = `sim_evt_${newId()}`;
    const payload = {
      id: eventId,
      type,
      livemode: false,
      account: account.externalAccountId,
      created: Math.floor(this.now().getTime() / 1000),
      data: { object },
    };
    await this.db(tx)
      .insertInto('payments.simulator_webhooks')
      .values({
        id: newId(),
        tenant_id: account.tenantId,
        account_id: account.id,
        event_id: eventId,
        payload: JSON.stringify(payload),
        delivered: false,
        created_at: this.now(),
      })
      .execute();
  }

  /** Outage control: returns an outcome when the simulated provider is down, else null. */
  private outage(account: ProviderAccount): ProviderOutcome | null {
    const o = account.simulatorControls.outage;
    if (o === 'refuse')
      return { kind: 'unavailable', reason: 'simulated provider outage: connection refused' };
    if (o === 'timeout') return { kind: 'unknown', reason: 'simulated provider outage: request timed out' };
    return null;
  }

  private scenarioFor(account: ProviderAccount, kind: keyof Overrides, token?: string): SimScenario {
    const overrides = (account.simulatorControls as { scenarioOverrides?: Overrides }).scenarioOverrides;
    return (
      parseScenario(overrides?.[kind]) ?? (token ? scenarioForToken(token) : undefined) ?? { kind: 'approve' }
    );
  }

  private replay(existing: StoredObject): ProviderOutcome {
    return existing.data.outcome as ProviderOutcome;
  }

  private paymentObject(
    piId: string,
    pi: Record<string, unknown>,
    currency: string,
    operationId: string | null,
  ): WebhookObject {
    return {
      kind: 'payment',
      providerRef: piId,
      state: pi.state as 'authorized' | 'succeeded' | 'failed' | 'canceled' | 'processing',
      amountMinor: Number(pi.amount),
      amountCapturableMinor: Number(pi.capturable ?? 0),
      amountReceivedMinor: Number(pi.received ?? 0),
      currency,
      operationId,
      decline: (pi.decline as { code: string } | undefined) ?? null,
    };
  }

  // ───────────────────────── payment intents (authorize / charge) ─────────────────────────

  private async createIntent(
    account: ProviderAccount,
    call: PaymentCall,
    manualCapture: boolean,
  ): Promise<ProviderOutcome> {
    const down = this.outage(account);
    if (down) return down;
    if (!account.currencies.includes(call.amount.currency)) {
      return { kind: 'declined', decline: { code: 'currency_not_supported' } };
    }
    return this.tx(account, async (tx) => {
      const existing = await this.find(tx, account, call.idempotencyKey);
      if (existing) return this.replay(existing);
      let scenario = this.scenarioFor(account, manualCapture ? 'authorize' : 'charge', call.methodToken);
      if (scenario.kind === 'vcc_funding_delay') {
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from payments.simulator_objects
           where account_id = ${account.id} and kind = 'pi' and data->>'token' = ${call.methodToken}`.execute(
          tx.db,
        );
        scenario =
          (rows[0]?.n ?? 0) < scenario.failures
            ? { kind: 'decline', code: 'vcc_not_funded' }
            : { kind: 'approve' };
      }
      const approve =
        scenario.kind === 'approve' ||
        scenario.kind === 'dispute' ||
        scenario.kind === 'timeout_then_succeeded';
      const declineCode =
        scenario.kind === 'decline'
          ? scenario.code
          : scenario.kind === 'timeout_then_failed'
            ? scenario.code
            : null;
      const amount = call.amount.amountMinor;
      const pi: Record<string, unknown> = {
        token: call.methodToken,
        operationId: call.operationId,
        amount,
        capturable: approve && manualCapture ? amount : 0,
        received: approve && !manualCapture ? amount : 0,
        refunded: 0,
        state: approve ? (manualCapture ? 'authorized' : 'succeeded') : 'failed',
        manualCapture,
        ...(declineCode ? { decline: { code: declineCode } } : {}),
      };
      const piId = `sim_pi_${randomToken(12).replace(/[^A-Za-z0-9]/g, 'x')}`;
      const expiresAt = new Date(this.now().getTime() + 7 * 86_400_000);
      const finalOutcome: ProviderOutcome = approve
        ? {
            kind: 'succeeded',
            providerRef: piId,
            amountMinor: amount,
            ...(manualCapture ? { remainingAuthorizedMinor: amount, expiresAt } : {}),
            networkTransactionId: `sim_ntid_${piId.slice(-8)}`,
          }
        : { kind: 'declined', providerRef: piId, decline: { code: declineCode ?? 'generic_decline' } };
      pi.outcome = finalOutcome;
      await this.insert(tx, account, call.idempotencyKey, {
        object_id: piId,
        kind: 'pi',
        status: String(pi.state),
        currency: call.amount.currency,
        amount_minor: amount,
        data: pi,
      });
      const type = approve
        ? manualCapture
          ? 'payment_intent.amount_capturable_updated'
          : 'payment_intent.succeeded'
        : 'payment_intent.payment_failed';
      await this.queueEvent(
        tx,
        account,
        type,
        this.paymentObject(piId, pi, call.amount.currency, call.operationId),
      );
      if (scenario.kind === 'dispute' && approve) {
        await this.queueEvent(tx, account, 'charge.dispute.created', {
          kind: 'dispute',
          providerRef: `sim_dp_${piId.slice(-10)}`,
          paymentProviderRef: piId,
          state: 'evidence_required',
          amountMinor: amount,
          currency: call.amount.currency,
          reason: 'fraudulent',
          evidenceDueBy: new Date(this.now().getTime() + 7 * 86_400_000),
          fundsWithdrawn: true,
        });
      }
      if (scenario.kind === 'timeout_then_succeeded' || scenario.kind === 'timeout_then_failed') {
        return { kind: 'unknown', reason: 'simulated timeout: the response never arrived' };
      }
      return finalOutcome;
    });
  }

  authorize(account: ProviderAccount, call: PaymentCall): Promise<ProviderOutcome> {
    return this.createIntent(account, call, true);
  }

  charge(account: ProviderAccount, call: PaymentCall): Promise<ProviderOutcome> {
    return this.createIntent(account, call, false);
  }

  // ───────────────────────── operations on an existing intent ─────────────────────────

  private async onIntent(
    account: ProviderAccount,
    call: CallBase,
    kind: keyof Overrides,
    piId: string,
    act: (
      pi: Record<string, unknown>,
      objectId: string,
    ) => {
      outcome: ProviderOutcome;
      pi?: Record<string, unknown>;
      eventType?: string;
      extra?: WebhookObject;
    },
  ): Promise<ProviderOutcome> {
    const down = this.outage(account);
    if (down) return down;
    return this.tx(account, async (tx) => {
      const existing = await this.find(tx, account, call.idempotencyKey);
      if (existing) return this.replay(existing);
      const piObj = await this.findById(tx, piId);
      if (!piObj) return { kind: 'failed', code: 'resource_missing', message: `No such object ${piId}` };
      const objectId = `sim_${kind === 'refund' ? 're' : 'op'}_${randomToken(9).replace(/[^A-Za-z0-9]/g, 'x')}`;
      const store = (outcome: ProviderOutcome) =>
        this.insert(tx, account, call.idempotencyKey, {
          object_id: objectId,
          kind: kind === 'refund' ? 'refund' : 'op',
          status: outcome.kind === 'succeeded' ? 'succeeded' : 'failed',
          currency: piObj.currency,
          amount_minor: outcome.kind === 'succeeded' ? outcome.amountMinor : 0,
          data: { opKind: kind, piId, outcome, operationId: call.operationId },
        });
      const scenario = this.scenarioFor(account, kind);
      if (scenario.kind === 'decline' || scenario.kind === 'timeout_then_failed') {
        // The provider did not apply the operation; a timeout hides that answer from the caller.
        await store({ kind: 'declined', providerRef: piId, decline: { code: scenario.code } });
        return scenario.kind === 'decline'
          ? { kind: 'declined', providerRef: piId, decline: { code: scenario.code } }
          : { kind: 'unknown', reason: 'simulated timeout: the response never arrived' };
      }
      const result = act({ ...piObj.data }, objectId);
      await store(result.outcome);
      if (result.outcome.kind === 'succeeded') {
        if (result.pi) {
          await this.update(tx, piId, String(result.pi.state), { ...result.pi, outcome: piObj.data.outcome });
          if (result.eventType) {
            await this.queueEvent(
              tx,
              account,
              result.eventType,
              this.paymentObject(piId, result.pi, piObj.currency, call.operationId),
            );
          }
        }
        if (result.extra) await this.queueEvent(tx, account, 'refund.updated', result.extra);
      }
      if (scenario.kind === 'timeout_then_succeeded') {
        return { kind: 'unknown', reason: 'simulated timeout: the response never arrived' };
      }
      return result.outcome;
    });
  }

  incrementAuthorization(
    account: ProviderAccount,
    call: CallBase & { providerRef: string; newTotal: Money },
  ): Promise<ProviderOutcome> {
    return this.onIntent(account, call, 'increment', call.providerRef, (pi) => {
      if (pi.state !== 'authorized') {
        return {
          outcome: { kind: 'failed', code: 'invalid_state', message: 'The authorization is no longer open.' },
        };
      }
      const captured = Number(pi.received ?? 0);
      const next = {
        ...pi,
        amount: call.newTotal.amountMinor,
        capturable: call.newTotal.amountMinor - captured,
      };
      return {
        outcome: {
          kind: 'succeeded',
          providerRef: call.providerRef,
          amountMinor: call.newTotal.amountMinor,
          remainingAuthorizedMinor: call.newTotal.amountMinor - captured,
        },
        pi: next,
        eventType: 'payment_intent.amount_capturable_updated',
      };
    });
  }

  capture(
    account: ProviderAccount,
    call: CallBase & { providerRef: string; amount: Money; applicationFeeMinor: number | null },
  ): Promise<ProviderOutcome> {
    return this.onIntent(account, call, 'capture', call.providerRef, (pi) => {
      const capturable = Number(pi.capturable ?? 0);
      if (pi.state !== 'authorized' || call.amount.amountMinor > capturable) {
        return {
          outcome: {
            kind: 'failed',
            code: 'amount_too_large',
            message: 'The capture exceeds the amount still held on the card.',
          },
        };
      }
      const remaining = capturable - call.amount.amountMinor;
      const next = {
        ...pi,
        capturable: remaining,
        received: Number(pi.received ?? 0) + call.amount.amountMinor,
        state: remaining > 0 ? 'authorized' : 'succeeded',
      };
      return {
        outcome: {
          kind: 'succeeded',
          providerRef: call.providerRef,
          amountMinor: call.amount.amountMinor,
          remainingAuthorizedMinor: remaining,
        },
        pi: next,
        eventType: remaining > 0 ? 'payment_intent.amount_capturable_updated' : 'payment_intent.succeeded',
      };
    });
  }

  void(account: ProviderAccount, call: CallBase & { providerRef: string }): Promise<ProviderOutcome> {
    return this.onIntent(account, call, 'void', call.providerRef, (pi) => {
      if (pi.state !== 'authorized') {
        return {
          outcome: { kind: 'failed', code: 'invalid_state', message: 'The authorization is no longer open.' },
        };
      }
      const next = { ...pi, capturable: 0, state: Number(pi.received ?? 0) > 0 ? 'succeeded' : 'canceled' };
      return {
        outcome: {
          kind: 'succeeded',
          providerRef: call.providerRef,
          amountMinor: 0,
          remainingAuthorizedMinor: 0,
        },
        pi: next,
        eventType: 'payment_intent.canceled',
      };
    });
  }

  refund(
    account: ProviderAccount,
    call: CallBase & { paymentProviderRef: string; amount: Money; reason: string },
  ): Promise<ProviderOutcome> {
    return this.onIntent(account, call, 'refund', call.paymentProviderRef, (pi, refundId) => {
      const refundable = Number(pi.received ?? 0) - Number(pi.refunded ?? 0);
      if (call.amount.amountMinor > refundable) {
        return {
          outcome: {
            kind: 'failed',
            code: 'amount_too_large',
            message: 'The refund exceeds the amount still refundable on this payment.',
          },
        };
      }
      const next = { ...pi, refunded: Number(pi.refunded ?? 0) + call.amount.amountMinor };
      return {
        outcome: { kind: 'succeeded', providerRef: refundId, amountMinor: call.amount.amountMinor },
        pi: next,
        extra: {
          kind: 'refund',
          providerRef: refundId,
          paymentProviderRef: call.paymentProviderRef,
          state: 'succeeded',
          amountMinor: call.amount.amountMinor,
          currency: call.amount.currency,
          operationId: call.operationId,
        },
      };
    });
  }

  async lookup(account: ProviderAccount, call: LookupCall): Promise<LookupResult> {
    const down = this.outage(account);
    if (down) return { found: 'unknown', reason: 'simulated provider outage' };
    return this.tx(account, async (tx) => {
      const existing = await this.find(tx, account, call.idempotencyKey);
      if (!existing) return { found: false };
      const outcome = existing.data.outcome as ProviderOutcome;
      if (outcome.kind === 'succeeded' || outcome.kind === 'declined' || outcome.kind === 'failed') {
        return { found: true, outcome };
      }
      return { found: 'unknown', reason: 'object in an intermediate state' };
    });
  }

  async createPaymentLink(account: ProviderAccount, call: PaymentLinkCall): Promise<PaymentLinkOutcome> {
    const down = this.outage(account);
    if (down) return { kind: 'unknown', reason: 'simulated provider outage' };
    return this.tx(account, async (tx) => {
      const existing = await this.find(tx, account, call.idempotencyKey);
      if (existing) return existing.data.outcome as PaymentLinkOutcome;
      const linkRef = `sim_link_${randomToken(9).replace(/[^A-Za-z0-9]/g, 'x')}`;
      const outcome: PaymentLinkOutcome = {
        kind: 'created',
        linkRef,
        url: `https://pay.simulator.portico.invalid/l/${linkRef}`,
      };
      await this.insert(tx, account, call.idempotencyKey, {
        object_id: linkRef,
        kind: 'link',
        status: 'open',
        currency: call.amount.currency,
        amount_minor: call.amount.amountMinor,
        data: { outcome, requestId: call.requestId, expiresAt: call.expiresAt.toISOString() },
      });
      return outcome;
    });
  }

  parseWebhook(rawBody: string, headers: Record<string, string | undefined>, now: Date): VerifiedWebhook {
    verifySignature(headers[SIMULATOR_SIGNATURE_HEADER], rawBody, [this.signingSecret], now);
    let parsed: {
      id?: unknown;
      type?: unknown;
      livemode?: unknown;
      account?: unknown;
      created?: unknown;
      data?: { object?: unknown };
    };
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new WebhookSignatureError('Body is not JSON.');
    }
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.type !== 'string' ||
      typeof parsed.account !== 'string'
    ) {
      throw new WebhookSignatureError('Malformed simulator event.');
    }
    const object = reviveObject(parsed.data?.object);
    return {
      eventId: parsed.id,
      type: parsed.type,
      livemode: false,
      externalAccountId: parsed.account,
      createdAt: new Date(Number(parsed.created ?? 0) * 1000),
      object,
      payload: parsed,
    };
  }

  // ───────────────────────── simulator-only helpers (demo controls, tests) ─────────────────────────

  /**
   * Take queued webhook events for an account, signed as the provider would send them. Honors the
   * duplicate / out-of-order controls.
   */
  async drainWebhooks(
    account: ProviderAccount,
  ): Promise<Array<{ rawBody: string; headers: Record<string, string> }>> {
    const rows = await this.tx(account, async (tx) => {
      const pending = await this.db(tx)
        .selectFrom('payments.simulator_webhooks')
        .select(['id', 'payload'])
        .where('account_id', '=', account.id)
        .where('delivered', '=', false)
        .orderBy('seq')
        .forUpdate()
        .execute();
      if (pending.length > 0) {
        await this.db(tx)
          .updateTable('payments.simulator_webhooks')
          .set({ delivered: true })
          .where(
            'id',
            'in',
            pending.map((p) => p.id),
          )
          .execute();
      }
      return pending;
    });
    let ordered = rows.map((r) => JSON.stringify(r.payload));
    if (account.simulatorControls.outOfOrderWebhooks) ordered = ordered.reverse();
    if (account.simulatorControls.duplicateWebhooks) ordered = ordered.flatMap((b) => [b, b]);
    const t = Math.floor(this.now().getTime() / 1000);
    return ordered.map((rawBody) => ({
      rawBody,
      headers: { [SIMULATOR_SIGNATURE_HEADER]: signatureHeader(this.signingSecret, t, rawBody) },
    }));
  }

  /** A delivery that failed on the receiving side is delivered again on the next drain (like a real PSP). */
  async requeue(account: ProviderAccount, eventId: string): Promise<void> {
    await this.tx(account, (tx) =>
      this.db(tx)
        .updateTable('payments.simulator_webhooks')
        .set({ delivered: false })
        .where('account_id', '=', account.id)
        .where('event_id', '=', eventId)
        .execute(),
    );
  }

  /** Event backstop: every event the simulated provider produced after the cursor (delivered or not). */
  async listEvents(
    account: ProviderAccount,
    opts: { after: string | null; since: Date },
  ): Promise<{ events: VerifiedWebhook[]; cursor: string | null }> {
    const rows = await this.tx(account, (tx) => {
      let q = this.db(tx)
        .selectFrom('payments.simulator_webhooks')
        .select(['seq', 'payload'])
        .where('account_id', '=', account.id)
        .orderBy('seq')
        .limit(500);
      if (opts.after) q = q.where('seq', '>', Number(opts.after));
      else q = q.where('created_at', '>=', opts.since);
      return q.execute();
    });
    const events = rows.map((r) => {
      const p = r.payload as {
        id: string;
        type: string;
        account: string;
        created: number;
        data?: { object?: unknown };
      };
      return {
        eventId: p.id,
        type: p.type,
        livemode: false,
        externalAccountId: p.account,
        createdAt: new Date(Number(p.created) * 1000),
        object: reviveObject(p.data?.object),
        payload: p,
      };
    });
    const last = rows[rows.length - 1];
    return { events, cursor: last ? String(last.seq) : opts.after };
  }

  /** The guest pays a simulated payment link (demo / tests). Queues a signed completion event. */
  async simulateLinkPayment(
    account: ProviderAccount,
    linkRef: string,
    amountMinor?: number,
  ): Promise<string> {
    return this.tx(account, async (tx) => {
      const link = await this.findById(tx, linkRef);
      if (link?.kind !== 'link') throw new Error(`No simulated payment link ${linkRef}`);
      const amount = amountMinor ?? link.amount_minor;
      const piId = `sim_pi_${randomToken(12).replace(/[^A-Za-z0-9]/g, 'x')}`;
      await this.insert(tx, account, `link-payment:${linkRef}:${newId()}`, {
        object_id: piId,
        kind: 'pi',
        status: 'succeeded',
        currency: link.currency,
        amount_minor: amount,
        data: {
          state: 'succeeded',
          amount,
          received: amount,
          capturable: 0,
          refunded: 0,
          linkRef,
          outcome: { kind: 'succeeded', providerRef: piId, amountMinor: amount },
        },
      });
      await this.queueEvent(tx, account, 'checkout.session.completed', {
        kind: 'payment_link',
        providerRef: linkRef,
        requestId: (link.data.requestId as string | undefined) ?? null,
        paymentProviderRef: piId,
        state: 'completed',
        amountMinor: amount,
        currency: link.currency,
      });
      return piId;
    });
  }

  /** Queue a payout event (demo / tests). Delayed settlement is expressed through `arrivalDate`. */
  async simulatePayout(
    account: ProviderAccount,
    input: {
      payoutRef: string;
      amountMinor: number;
      currency: string;
      state: 'in_transit' | 'paid' | 'failed';
      /** Defaults to today + the account's `settlementDelayDays` control (delayed settlement scenario). */
      arrivalDate?: string;
    },
  ): Promise<void> {
    const delayDays = account.simulatorControls.settlementDelayDays ?? 2;
    const arrivalDate =
      input.arrivalDate ?? new Date(this.now().getTime() + delayDays * 86_400_000).toISOString().slice(0, 10);
    await this.tx(account, (tx) =>
      this.queueEvent(tx, account, `payout.${input.state}`, {
        kind: 'payout',
        providerRef: input.payoutRef,
        state: input.state,
        amountMinor: input.amountMinor,
        currency: input.currency,
        arrivalDate,
        failureCode: input.state === 'failed' ? 'account_closed' : null,
      }),
    );
  }
}

function reviveObject(raw: unknown): WebhookObject {
  if (!raw || typeof raw !== 'object') return { kind: 'unknown', rawType: 'missing' };
  const o = raw as Record<string, unknown>;
  if (o.kind === 'dispute') {
    return {
      ...(o as WebhookObject & { kind: 'dispute' }),
      evidenceDueBy: o.evidenceDueBy ? new Date(String(o.evidenceDueBy)) : null,
    };
  }
  if (
    o.kind === 'payment' ||
    o.kind === 'refund' ||
    o.kind === 'payout' ||
    o.kind === 'payment_link' ||
    o.kind === 'account'
  ) {
    return o as unknown as WebhookObject;
  }
  return { kind: 'unknown', rawType: String(o.kind ?? 'unknown') };
}
