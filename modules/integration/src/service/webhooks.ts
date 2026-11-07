/**
 * Partner webhooks (webhooks.outbound; spec INT-R26): self-serve subscriptions with topic wildcards and property
 * filters, THIN signed events, retries with backoff, endpoint disable after repeated failures, signing-secret
 * rotation with overlap, and replay of a delivery (or a time range) by an administrator.
 *
 * Environment safety: every delivery is gated by the `integration.write` policy — trial organizations never send
 * (deliveries are recorded as blocked), demo/training record them as simulated, sandbox and live send.
 */
import {
  explainVersionMiss,
  type PorticoDatabase,
  type Selectable,
  sql,
  type TxContext,
  withTenantTx,
} from '@portico/db';
import {
  BusinessRuleError,
  type DomainEvent,
  effectMode,
  NotFoundError,
  newId,
  type RequestContext,
  randomToken,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { WebhookDelivery, WebhookSubscription, WebhookSubscriptionInput } from '../contracts';
import {
  checkEndpointUrl,
  DELIVERY_TIMEOUT_MS,
  DISABLE_AFTER_CONSECUTIVE_FAILURES,
  invalidPatterns,
  isPublicEventType,
  isSuccessStatus,
  matchesEventType,
  nextRetryDelay,
  PUBLIC_WEBHOOK_EVENTS,
  SIGNATURE_HEADER,
  signatureHeader,
} from '../domain/webhooks';
import { P } from '../manifest';
import { OutboundBlockedError } from '../net/address-policy';
import { vetDestination } from '../net/safe-fetch';
import type { WebhookDeliveriesTable, WebhookSubscriptionsTable } from '../tables';
import { actorKey, db, type IntegrationDeps, iso, scheduleTenant } from './common';

type SubRow = Selectable<WebhookSubscriptionsTable>;
type DeliveryRow = Selectable<WebhookDeliveriesTable>;

const REPLAY_WINDOW_DAYS = 7;

function toSubscription(r: SubRow): WebhookSubscription {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    eventTypes: r.event_types,
    propertyIds: r.property_ids,
    apiClientId: r.api_client_id,
    status: r.status,
    disabledReason: r.disabled_reason,
    disabledAt: iso(r.disabled_at),
    consecutiveFailures: r.consecutive_failures,
    lastSuccessAt: iso(r.last_success_at),
    createdAt: new Date(r.created_at).toISOString(),
    version: r.version,
  };
}

function toDelivery(r: DeliveryRow): WebhookDelivery {
  return {
    id: r.id,
    subscriptionId: r.subscription_id,
    eventId: r.event_id,
    eventType: r.event_type,
    propertyId: r.property_id,
    status: r.status,
    attempts: r.attempts,
    nextAttemptAt: r.status === 'pending' || r.status === 'failed' ? iso(r.next_attempt_at) : null,
    lastAttemptAt: iso(r.last_attempt_at),
    lastResponseStatus: r.last_response_status,
    lastError: r.last_error,
    replayOf: r.replay_of,
    createdAt: new Date(r.created_at).toISOString(),
    completedAt: iso(r.completed_at),
  };
}

export function generateSigningSecret(): string {
  return `whsec_${randomToken(32)}`;
}

async function validateTarget(
  deps: IntegrationDeps,
  url: string,
  eventTypes: readonly string[],
): Promise<void> {
  const check = checkEndpointUrl(url, { allowedPorts: deps.net.allowedPorts });
  if (!check.ok) throw new ValidationError('invalid_webhook_url', check.reason);
  // Early feedback: a name that resolves to a private address is refused now. A name that does not resolve yet is
  // accepted; every delivery re-checks (safeFetch), so this is not the security boundary.
  try {
    await vetDestination(url, { allowedPorts: deps.net.allowedPorts, resolver: deps.net.resolver });
  } catch (err) {
    if (err instanceof OutboundBlockedError) throw new ValidationError('invalid_webhook_url', err.message);
  }
  const invalid = invalidPatterns(eventTypes);
  if (invalid.length > 0) {
    throw new ValidationError(
      'unknown_event_types',
      `These event types are not available to partners: ${invalid.join(', ')}. See GET /v1/integration/webhook-event-types.`,
      { invalid },
    );
  }
}

async function loadSub(tx: TxContext, id: string): Promise<SubRow> {
  const r = await db(tx)
    .selectFrom('integration.webhook_subscriptions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!r) throw new NotFoundError('webhook_subscription', id);
  return r;
}

export async function createSubscription(
  tx: TxContext,
  deps: IntegrationDeps,
  input: WebhookSubscriptionInput,
): Promise<WebhookSubscription & { signingSecret: string }> {
  requirePermission(tx, P.webhookManage);
  await validateTarget(deps, input.url, input.eventTypes);
  for (const p of input.propertyIds) await deps.ports.platform.getProperty(tx, p);
  const secret = generateSigningSecret();
  const secretRef = await deps.secrets.put(tx, { purpose: 'webhook_signing', value: secret });
  const id = newId(tx.now.getTime());
  let row: SubRow;
  try {
    row = await db(tx)
      .insertInto('integration.webhook_subscriptions')
      .values({
        id,
        tenant_id: tx.tenantId,
        name: input.name,
        url: input.url,
        event_types: input.eventTypes,
        property_ids: input.propertyIds,
        secret_ref: secretRef,
        previous_secret_ref: null,
        previous_secret_expires_at: null,
        api_client_id: input.apiClientId ?? null,
        status: 'active',
        disabled_reason: null,
        disabled_at: null,
        last_success_at: null,
        created_at: tx.now,
        created_by: actorKey(tx),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new ValidationError(
        'webhook_name_taken',
        `A webhook subscription named "${input.name}" already exists.`,
      );
    }
    throw err;
  }
  await tx.audit({
    action: 'integration.webhook.create',
    target: { type: 'integration_webhook_subscription', id },
    after: {
      name: input.name,
      url: input.url,
      eventTypes: input.eventTypes,
      propertyIds: input.propertyIds,
      signingSecret: '[stored encrypted; shown once]',
    },
  });
  return { ...toSubscription(row), signingSecret: secret };
}

export async function listSubscriptions(tx: TxContext): Promise<WebhookSubscription[]> {
  requirePermission(tx, P.webhookManage);
  const rows = await db(tx)
    .selectFrom('integration.webhook_subscriptions')
    .selectAll()
    .orderBy('name')
    .execute();
  return rows.map(toSubscription);
}

export async function getSubscription(tx: TxContext, id: string): Promise<WebhookSubscription> {
  requirePermission(tx, P.webhookManage);
  return toSubscription(await loadSub(tx, id));
}

export async function updateSubscription(
  tx: TxContext,
  deps: IntegrationDeps,
  id: string,
  expectedVersion: number,
  patch: {
    status?: 'active' | 'disabled' | undefined;
    eventTypes?: string[] | undefined;
    url?: string | undefined;
  },
): Promise<WebhookSubscription> {
  requirePermission(tx, P.webhookManage);
  const before = await loadSub(tx, id);
  await validateTarget(deps, patch.url ?? before.url, patch.eventTypes ?? before.event_types);
  const reEnable = patch.status === 'active' && before.status === 'disabled';
  const row = await db(tx)
    .updateTable('integration.webhook_subscriptions')
    .set({
      ...(patch.url ? { url: patch.url } : {}),
      ...(patch.eventTypes ? { event_types: patch.eventTypes } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.status === 'disabled'
        ? { disabled_reason: 'Disabled by an administrator', disabled_at: tx.now }
        : {}),
      ...(reEnable ? { disabled_reason: null, disabled_at: null, consecutive_failures: 0 } : {}),
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row)
    return explainVersionMiss('webhook_subscription', id, expectedVersion, async () => before.version);
  if (reEnable) {
    // Deliveries waiting while the endpoint was disabled resume now.
    await db(tx)
      .updateTable('integration.webhook_deliveries')
      .set({ next_attempt_at: tx.now })
      .where('subscription_id', '=', id)
      .where('status', 'in', ['pending', 'failed'])
      .execute();
    await scheduleTenant(tx, tx.now);
  }
  await tx.audit({
    action: 'integration.webhook.update',
    target: { type: 'integration_webhook_subscription', id },
    before: { url: before.url, eventTypes: before.event_types, status: before.status },
    after: { url: row.url, eventTypes: row.event_types, status: row.status },
  });
  return toSubscription(row);
}

/** New signing secret; the previous one keeps signing (second signature) during the overlap. */
export async function rotateSigningSecret(
  tx: TxContext,
  deps: IntegrationDeps,
  id: string,
  expectedVersion: number,
  overlapHours: number,
): Promise<{ signingSecret: string; previousValidUntil: string | null }> {
  requirePermission(tx, P.webhookManage);
  const sub = await loadSub(tx, id);
  if (sub.previous_secret_ref) await deps.secrets.destroy(tx, sub.previous_secret_ref);
  const secret = generateSigningSecret();
  const ref = await deps.secrets.put(tx, { purpose: 'webhook_signing', value: secret });
  const until = overlapHours > 0 ? new Date(tx.now.getTime() + overlapHours * 3_600_000) : null;
  if (!until) await deps.secrets.destroy(tx, sub.secret_ref);
  const row = await db(tx)
    .updateTable('integration.webhook_subscriptions')
    .set({
      secret_ref: ref,
      previous_secret_ref: until ? sub.secret_ref : null,
      previous_secret_expires_at: until,
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returning('id')
    .executeTakeFirst();
  if (!row) return explainVersionMiss('webhook_subscription', id, expectedVersion, async () => sub.version);
  await tx.audit({
    action: 'integration.webhook.rotateSecret',
    target: { type: 'integration_webhook_subscription', id },
    after: { previousValidUntil: until?.toISOString() ?? null, signingSecret: '[rotated; shown once]' },
  });
  return { signingSecret: secret, previousValidUntil: until ? until.toISOString() : null };
}

/** Thin payload: identifiers and time only. Partners fetch details with their own permissions. */
export function thinPayload(
  event: Pick<DomainEvent, 'id' | 'type' | 'occurredAt' | 'propertyId' | 'aggregate' | 'version' | 'payload'>,
) {
  const data: Record<string, unknown> = {};
  if (event.type === 'integration.connection.statusChanged') {
    const p = event.payload as { state?: unknown; health?: unknown };
    data.state = p.state ?? null;
    data.health = p.health ?? null;
  }
  return {
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt,
    propertyId: event.propertyId,
    subject: { type: event.aggregate.type, id: event.aggregate.id },
    schemaVersion: event.version,
    data,
  };
}

/** Outbox consumer: create one delivery per matching active subscription (exactly once per event). */
export async function fanOutEvent(tx: TxContext, event: DomainEvent): Promise<number> {
  if (!isPublicEventType(event.type)) return 0;
  const subs = await db(tx)
    .selectFrom('integration.webhook_subscriptions')
    .selectAll()
    .where('status', '=', 'active')
    .execute();
  let n = 0;
  for (const s of subs) {
    if (!s.event_types.some((p) => matchesEventType(p, event.type))) continue;
    if (s.property_ids.length > 0 && (!event.propertyId || !s.property_ids.includes(event.propertyId)))
      continue;
    const inserted = await db(tx)
      .insertInto('integration.webhook_deliveries')
      .values({
        id: newId(tx.now.getTime()),
        tenant_id: tx.tenantId,
        subscription_id: s.id,
        event_id: event.id,
        event_type: event.type,
        property_id: event.propertyId,
        payload: JSON.stringify(thinPayload(event)),
        status: 'pending',
        next_attempt_at: tx.now,
        lease_until: null,
        last_attempt_at: null,
        last_response_status: null,
        last_error: null,
        replay_of: null,
        requested_by: null,
        created_at: tx.now,
        completed_at: null,
      })
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'subscription_id', 'event_id']).where('replay_of', 'is', null).doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
    if (inserted) n++;
  }
  if (n > 0) await scheduleTenant(tx, tx.now);
  return n;
}

export async function sendTestEvent(tx: TxContext, id: string): Promise<WebhookDelivery> {
  requirePermission(tx, P.webhookManage);
  const sub = await loadSub(tx, id);
  if (sub.status !== 'active')
    throw new BusinessRuleError('webhook_disabled', 'Re-enable the endpoint before sending a test event.');
  const eventId = newId(tx.now.getTime());
  const row = await db(tx)
    .insertInto('integration.webhook_deliveries')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      subscription_id: id,
      event_id: eventId,
      event_type: 'integration.webhook.test',
      property_id: null,
      payload: JSON.stringify({
        id: eventId,
        type: 'integration.webhook.test',
        occurredAt: tx.now.toISOString(),
        propertyId: null,
        subject: { type: 'integration_webhook_subscription', id },
        schemaVersion: 1,
        data: {},
      }),
      status: 'pending',
      next_attempt_at: tx.now,
      lease_until: null,
      last_attempt_at: null,
      last_response_status: null,
      last_error: null,
      replay_of: null,
      requested_by: actorKey(tx),
      created_at: tx.now,
      completed_at: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await scheduleTenant(tx, tx.now);
  return toDelivery(row);
}

export async function listDeliveries(
  tx: TxContext,
  subscriptionId: string,
  status?: WebhookDelivery['status'],
): Promise<WebhookDelivery[]> {
  requirePermission(tx, P.webhookManage);
  await loadSub(tx, subscriptionId);
  let q = db(tx)
    .selectFrom('integration.webhook_deliveries')
    .selectAll()
    .where('subscription_id', '=', subscriptionId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(200);
  if (status) q = q.where('status', '=', status);
  return (await q.execute()).map(toDelivery);
}

async function createReplay(tx: TxContext, original: DeliveryRow, reason: string): Promise<DeliveryRow> {
  const row = await db(tx)
    .insertInto('integration.webhook_deliveries')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      subscription_id: original.subscription_id,
      event_id: original.event_id,
      event_type: original.event_type,
      property_id: original.property_id,
      payload: JSON.stringify(original.payload),
      status: 'pending',
      next_attempt_at: tx.now,
      lease_until: null,
      last_attempt_at: null,
      last_response_status: null,
      last_error: null,
      replay_of: original.replay_of ?? original.id,
      requested_by: actorKey(tx),
      created_at: tx.now,
      completed_at: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'integration.webhook.replay',
    target: { type: 'integration_webhook_delivery', id: row.id },
    reason,
    metadata: { replayOf: original.id, eventId: original.event_id, eventType: original.event_type },
  });
  return row;
}

/** Admin replay of one delivery (same event id, so partners can deduplicate). */
export async function replayDelivery(
  tx: TxContext,
  deliveryId: string,
  reason: string,
): Promise<WebhookDelivery> {
  requirePermission(tx, P.webhookManage);
  const original = await db(tx)
    .selectFrom('integration.webhook_deliveries')
    .selectAll()
    .where('id', '=', deliveryId)
    .executeTakeFirst();
  if (!original) throw new NotFoundError('webhook_delivery', deliveryId);
  const sub = await loadSub(tx, original.subscription_id);
  if (sub.status !== 'active') {
    throw new BusinessRuleError(
      'webhook_disabled',
      `The endpoint is disabled (${sub.disabled_reason ?? 'by an administrator'}). Re-enable it before replaying.`,
    );
  }
  const row = await createReplay(tx, original, reason);
  await scheduleTenant(tx, tx.now);
  return toDelivery(row);
}

/** Replay every original delivery of a subscription in a time range (at most 7 days back). */
export async function replayRange(
  tx: TxContext,
  subscriptionId: string,
  input: { from: string; to: string; reason: string },
): Promise<{ replayed: number }> {
  requirePermission(tx, P.webhookManage);
  const sub = await loadSub(tx, subscriptionId);
  if (sub.status !== 'active')
    throw new BusinessRuleError('webhook_disabled', 'Re-enable the endpoint before replaying.');
  const from = new Date(input.from);
  const to = new Date(input.to);
  const earliest = new Date(tx.now.getTime() - REPLAY_WINDOW_DAYS * 86_400_000);
  if (from < earliest)
    throw new ValidationError(
      'replay_window',
      `Replays go back at most ${REPLAY_WINDOW_DAYS} days (from ${earliest.toISOString()}).`,
    );
  if (to <= from) throw new ValidationError('replay_range', '"to" must be after "from".');
  const originals = await db(tx)
    .selectFrom('integration.webhook_deliveries')
    .selectAll()
    .where('subscription_id', '=', subscriptionId)
    .where('replay_of', 'is', null)
    .where('created_at', '>=', from)
    .where('created_at', '<', to)
    .orderBy('created_at')
    .limit(1000)
    .execute();
  for (const o of originals) await createReplay(tx, o, input.reason);
  if (originals.length > 0) await scheduleTenant(tx, tx.now);
  return { replayed: originals.length };
}

/** Deliver due webhooks for the context's organization (worker job; also callable from tests). */
export async function deliverDueWebhooks(
  database: PorticoDatabase,
  deps: IntegrationDeps,
  ctx: RequestContext,
  opts: { limit?: number } = {},
): Promise<{ attempted: number; succeeded: number; failed: number; blocked: number; simulated: number }> {
  const out = { attempted: 0, succeeded: 0, failed: 0, blocked: 0, simulated: 0 };
  const mode = effectMode(ctx, 'integration.write');
  const claimed = await withTenantTx(database, ctx, async (tx) => {
    const due = await db(tx)
      .selectFrom('integration.webhook_deliveries as d')
      .innerJoin('integration.webhook_subscriptions as s', 's.id', 'd.subscription_id')
      .selectAll('d')
      .select(['s.url', 's.secret_ref', 's.previous_secret_ref', 's.previous_secret_expires_at'])
      .where('d.status', 'in', ['pending', 'failed'])
      .where('d.next_attempt_at', '<=', tx.now)
      .where('s.status', '=', 'active')
      .where((eb) => eb.or([eb('d.lease_until', 'is', null), eb('d.lease_until', '<', tx.now)]))
      .orderBy('d.next_attempt_at')
      .limit(opts.limit ?? 50)
      .forUpdate('d')
      .skipLocked()
      .execute();
    const items = [];
    for (const d of due) {
      await db(tx)
        .updateTable('integration.webhook_deliveries')
        .set({
          lease_until: new Date(tx.now.getTime() + 60_000),
          attempts: sql`attempts + 1`,
          version: sql`version + 1`,
        })
        .where('id', '=', d.id)
        .execute();
      const secrets = [await deps.secrets.get(tx, d.secret_ref)];
      if (
        d.previous_secret_ref &&
        d.previous_secret_expires_at &&
        new Date(d.previous_secret_expires_at) > tx.now
      ) {
        secrets.push(await deps.secrets.get(tx, d.previous_secret_ref));
      }
      items.push({ ...d, attempts: d.attempts + 1, secrets, now: tx.now });
    }
    return items;
  });

  for (const d of claimed) {
    out.attempted++;
    let result: {
      outcome: 'succeeded' | 'failed' | 'blocked' | 'simulated';
      status: number | null;
      error: string | null;
      durationMs: number;
    };
    const started = Date.now();
    if (mode === 'blocked') {
      result = {
        outcome: 'blocked',
        status: null,
        error: `Not sent: partner notifications are disabled in the ${ctx.environment} environment so that nothing real happens.`,
        durationMs: 0,
      };
    } else if (mode === 'simulate') {
      result = { outcome: 'simulated', status: null, error: null, durationMs: 0 };
    } else {
      const body = JSON.stringify(d.payload);
      const t = Math.floor(d.now.getTime() / 1000);
      const header = signatureHeader(d.secrets, t, body);
      try {
        const res = await deps.transport.post({
          url: d.url,
          body,
          timeoutMs: DELIVERY_TIMEOUT_MS,
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Portico-Webhooks/1',
            'portico-event-id': d.event_id,
            'portico-event-type': d.event_type,
            'portico-delivery-id': d.id,
            'portico-delivery-attempt': String(d.attempts),
            [SIGNATURE_HEADER]: header,
          },
        });
        result = isSuccessStatus(res.status)
          ? { outcome: 'succeeded', status: res.status, error: null, durationMs: Date.now() - started }
          : {
              outcome: 'failed',
              status: res.status,
              error: `Endpoint answered HTTP ${res.status}.`,
              durationMs: Date.now() - started,
            };
      } catch (err) {
        result = {
          outcome: 'failed',
          status: null,
          error: err instanceof Error ? err.message.slice(0, 500) : String(err),
          durationMs: Date.now() - started,
        };
      }
    }
    await withTenantTx(database, ctx, async (tx) => {
      await db(tx)
        .insertInto('integration.webhook_attempts')
        .values({
          id: newId(tx.now.getTime()),
          tenant_id: tx.tenantId,
          delivery_id: d.id,
          attempt_no: d.attempts,
          attempted_at: tx.now,
          outcome: result.outcome,
          response_status: result.status,
          duration_ms: result.durationMs,
          error: result.error,
        })
        .execute();
      if (result.outcome !== 'failed') {
        await db(tx)
          .updateTable('integration.webhook_deliveries')
          .set({
            status: result.outcome,
            last_attempt_at: tx.now,
            last_response_status: result.status,
            last_error: result.error,
            completed_at: tx.now,
            lease_until: null,
            version: sql`version + 1`,
          })
          .where('id', '=', d.id)
          .execute();
        if (result.outcome === 'succeeded') {
          await db(tx)
            .updateTable('integration.webhook_subscriptions')
            .set({ consecutive_failures: 0, last_success_at: tx.now })
            .where('id', '=', d.subscription_id)
            .execute();
        }
        out[result.outcome]++;
        return;
      }
      out.failed++;
      const delay = nextRetryDelay(d.attempts);
      await db(tx)
        .updateTable('integration.webhook_deliveries')
        .set({
          status: delay === null ? 'dead' : 'failed',
          next_attempt_at: delay === null ? tx.now : new Date(tx.now.getTime() + delay * 1000),
          last_attempt_at: tx.now,
          last_response_status: result.status,
          last_error: result.error,
          completed_at: delay === null ? tx.now : null,
          lease_until: null,
          version: sql`version + 1`,
        })
        .where('id', '=', d.id)
        .execute();
      if (delay !== null) await scheduleTenant(tx, new Date(tx.now.getTime() + delay * 1000));
      else {
        await tx.emit({
          type: 'integration.webhookDelivery.failed',
          propertyId: d.property_id,
          aggregate: { type: 'integration_webhook_delivery', id: d.id },
          payload: {
            deliveryId: d.id,
            subscriptionId: d.subscription_id,
            eventId: d.event_id,
            attempts: d.attempts,
          },
        });
      }
      const sub = await db(tx)
        .updateTable('integration.webhook_subscriptions')
        .set({ consecutive_failures: sql`consecutive_failures + 1` })
        .where('id', '=', d.subscription_id)
        .returning(['consecutive_failures', 'status', 'name'])
        .executeTakeFirstOrThrow();
      if (sub.status === 'active' && sub.consecutive_failures >= DISABLE_AFTER_CONSECUTIVE_FAILURES) {
        await db(tx)
          .updateTable('integration.webhook_subscriptions')
          .set({
            status: 'disabled',
            disabled_at: tx.now,
            disabled_reason: `Disabled automatically after ${sub.consecutive_failures} failed attempts in a row. Fix the endpoint, re-enable it, then replay what was missed.`,
            version: sql`version + 1`,
          })
          .where('id', '=', d.subscription_id)
          .execute();
        await tx.audit({
          action: 'integration.webhook.autoDisable',
          target: { type: 'integration_webhook_subscription', id: d.subscription_id },
          reason: `${sub.consecutive_failures} consecutive failures`,
        });
      }
    });
  }
  return out;
}

export function publicEventTypes() {
  return PUBLIC_WEBHOOK_EVENTS;
}
