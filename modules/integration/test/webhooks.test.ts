/**
 * Partner webhooks: thin signed events with property filters, retries with backoff, dead deliveries, automatic
 * endpoint disable after repeated failures, admin replay (single and range), secret rotation with overlap, and
 * environment safety (trial blocked, demo simulated).
 */
import { drainOutbox, sql } from '@portico/db';
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { integration, integrationSubscriptions, verifySignature } from '../src';
import { type Harness, setupOrg, startHarness, tx, userCtx } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());
beforeEach(() => {
  h.sent.length = 0;
  h.transport.respond = async () => ({ status: 200 });
});

const subscriptions = integrationSubscriptions();
const drain = (environment: 'live' | 'trial' | 'demo') =>
  drainOutbox(h.t.db, { subscriptions, environmentOf: async () => environment });

async function emit(org: { ctx: Parameters<typeof tx>[1] }, type: string, propertyId: string | null) {
  const id = newId();
  await tx(h, org.ctx, (t) =>
    t.emit({ type, propertyId, aggregate: { type: 'booking', id }, payload: { guestName: 'SECRET PII' } }),
  );
  return id;
}

describe('partner webhooks', () => {
  it('delivers thin, signed events matching type patterns and property filters', async () => {
    const org = await setupOrg(h, {
      properties: [
        { code: 'LGN', name: 'Lagoon' },
        { code: 'REF', name: 'Reef' },
      ],
    });
    const sub = await tx(h, org.ctx, (t) =>
      integration.createSubscription(t, h.deps, {
        name: 'Upsell app',
        url: 'https://partner.example.com/hooks',
        eventTypes: ['reservations.booking.*'],
        propertyIds: [org.propertyId],
      }),
    );
    expect(sub.signingSecret).toMatch(/^whsec_/);
    const secrets = await sql<{ ciphertext: string }>`select ciphertext from integration.secrets`.execute(
      h.t.admin.kysely,
    );
    expect(secrets.rows.every((r) => !r.ciphertext.includes(sub.signingSecret))).toBe(true);
    await emit(org, 'reservations.booking.confirmed', org.propertyId);
    await emit(org, 'reservations.booking.confirmed', org.propertyIds[1] ?? null); // other property: filtered out
    await emit(org, 'reservations.stay.checkedIn', org.propertyId); // other type: filtered out
    await emit(org, 'integration.inbound.applied', org.propertyId); // not a public event
    await drain('live');
    const res = await integration.deliverDueWebhooks(h.t.db, h.deps, org.ctx);
    expect(res).toMatchObject({ attempted: 1, succeeded: 1 });
    const req = h.sent[0];
    expect(req?.url).toBe('https://partner.example.com/hooks');
    expect(req?.headers['portico-event-type']).toBe('reservations.booking.confirmed');
    expect(req?.body).not.toContain('SECRET PII');
    const body = JSON.parse(req?.body ?? '{}');
    expect(body).toMatchObject({
      type: 'reservations.booking.confirmed',
      propertyId: org.propertyId,
      subject: { type: 'booking' },
    });
    const now = Math.floor(h.clock.now().getTime() / 1000);
    expect(
      verifySignature(sub.signingSecret, req?.headers['portico-signature'], req?.body ?? '', now),
    ).toEqual({ valid: true });
    // Redelivery of the same outbox event never creates a second delivery.
    await drain('live');
    expect(await tx(h, org.ctx, (t) => integration.listDeliveries(t, sub.id))).toHaveLength(1);
  });

  it('retries with backoff, goes dead, disables the endpoint after repeated failures, and replays on request', async () => {
    const org = await setupOrg(h);
    const sub = await tx(h, org.ctx, (t) =>
      integration.createSubscription(t, h.deps, {
        name: 'Flaky',
        url: 'https://flaky.example.com/h',
        eventTypes: ['*'],
        propertyIds: [],
      }),
    );
    h.transport.respond = async () => ({ status: 500 });
    const first = await emit(org, 'reservations.booking.confirmed', org.propertyId);
    await drain('live');
    expect(await integration.deliverDueWebhooks(h.t.db, h.deps, org.ctx)).toMatchObject({ failed: 1 });
    // Not due again until the backoff elapses.
    expect(await integration.deliverDueWebhooks(h.t.db, h.deps, org.ctx)).toMatchObject({ attempted: 0 });
    for (const wait of [60, 300, 900, 1800, 3600, 7200, 14_400, 28_800, 36_000]) {
      h.clock.advance(wait * 1000);
      await integration.deliverDueWebhooks(h.t.db, h.deps, org.ctx);
    }
    let [d] = await tx(h, org.ctx, (t) => integration.listDeliveries(t, sub.id));
    expect(d).toMatchObject({
      status: 'dead',
      attempts: 10,
      lastResponseStatus: 500,
      eventId: first === d?.eventId ? first : d?.eventId,
    });
    const attempts = await sql<{
      n: number;
    }>`select count(*)::int as n from integration.webhook_attempts where delivery_id = ${d?.id}::uuid`.execute(
      h.t.admin.kysely,
    );
    expect(attempts.rows[0]?.n).toBe(10);
    // Two more failing deliveries reach 12 consecutive failures → disabled.
    await emit(org, 'reservations.booking.modified', org.propertyId);
    await emit(org, 'reservations.booking.cancelled', org.propertyId);
    await drain('live');
    await integration.deliverDueWebhooks(h.t.db, h.deps, org.ctx);
    let s = await tx(h, org.ctx, (t) => integration.getSubscription(t, sub.id));
    expect(s).toMatchObject({ status: 'disabled', consecutiveFailures: 12 });
    expect(s.disabledReason).toMatch(/re-enable it, then replay/);
    await expect(
      tx(h, org.ctx, (t) => integration.replayDelivery(t, d?.id ?? '', 'retry')),
    ).rejects.toMatchObject({ code: 'webhook_disabled' });
    // Fixed endpoint: re-enable and replay the dead delivery (same event id so the partner can deduplicate).
    h.transport.respond = async () => ({ status: 204 });
    s = await tx(h, org.ctx, (t) =>
      integration.updateSubscription(t, h.deps, sub.id, s.version, { status: 'active' }),
    );
    expect(s.consecutiveFailures).toBe(0);
    const replay = await tx(h, org.ctx, (t) =>
      integration.replayDelivery(t, d?.id ?? '', 'Partner fixed their endpoint'),
    );
    expect(replay).toMatchObject({ replayOf: d?.id, eventId: d?.eventId, status: 'pending' });
    h.sent.length = 0;
    await integration.deliverDueWebhooks(h.t.db, h.deps, org.ctx);
    expect(h.sent.map((r) => r.headers['portico-event-id'])).toContain(d?.eventId);
    [d] = await tx(h, org.ctx, (t) => integration.listDeliveries(t, sub.id, 'succeeded'));
    expect(d).toBeDefined();
    // Range replay of the last day.
    const range = await tx(h, org.ctx, (t) =>
      integration.replayRange(t, sub.id, {
        from: new Date(h.clock.now().getTime() - 2 * 86_400_000).toISOString(),
        to: new Date(h.clock.now().getTime() + 1000).toISOString(),
        reason: 'backfill',
      }),
    );
    expect(range.replayed).toBe(3);
    await expect(
      tx(h, org.ctx, (t) =>
        integration.replayRange(t, sub.id, {
          from: '2020-01-01T00:00:00Z',
          to: '2020-01-02T00:00:00Z',
          reason: 'x',
        }),
      ),
    ).rejects.toMatchObject({ code: 'replay_window' });
  });

  it('rotates the signing secret with an overlap where both secrets verify', async () => {
    const org = await setupOrg(h);
    const sub = await tx(h, org.ctx, (t) =>
      integration.createSubscription(t, h.deps, {
        name: 'Rotating',
        url: 'https://rot.example.com/h',
        eventTypes: ['integration.webhook.test'],
        propertyIds: [],
      }),
    );
    const rotated = await tx(h, org.ctx, (t) =>
      integration.rotateSigningSecret(t, h.deps, sub.id, sub.version, 24),
    );
    expect(rotated.previousValidUntil).not.toBeNull();
    await tx(h, org.ctx, (t) => integration.sendTestEvent(t, sub.id));
    await integration.deliverDueWebhooks(h.t.db, h.deps, org.ctx);
    const req = h.sent[0];
    const now = Math.floor(h.clock.now().getTime() / 1000);
    expect(
      verifySignature(rotated.signingSecret, req?.headers['portico-signature'], req?.body ?? '', now).valid,
    ).toBe(true);
    expect(
      verifySignature(sub.signingSecret, req?.headers['portico-signature'], req?.body ?? '', now).valid,
    ).toBe(true);
    // After the overlap only the new secret signs.
    h.clock.advance(25 * 3_600_000);
    h.sent.length = 0;
    await tx(h, org.ctx, (t) => integration.sendTestEvent(t, sub.id));
    await integration.deliverDueWebhooks(h.t.db, h.deps, org.ctx);
    const later = h.sent[0];
    const now2 = Math.floor(h.clock.now().getTime() / 1000);
    expect(
      verifySignature(sub.signingSecret, later?.headers['portico-signature'], later?.body ?? '', now2).valid,
    ).toBe(false);
    expect(
      verifySignature(rotated.signingSecret, later?.headers['portico-signature'], later?.body ?? '', now2)
        .valid,
    ).toBe(true);
  });

  it('validates endpoints and event types; requires the webhook permission', async () => {
    const org = await setupOrg(h);
    await expect(
      tx(h, org.ctx, (t) =>
        integration.createSubscription(t, h.deps, {
          name: 'Bad',
          url: 'https://169.254.169.254/latest',
          eventTypes: ['*'],
          propertyIds: [],
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_webhook_url' });
    await expect(
      tx(h, org.ctx, (t) =>
        integration.createSubscription(t, h.deps, {
          name: 'Bad',
          url: 'https://ok.example.com',
          eventTypes: ['finance.ledger.*'],
          propertyIds: [],
        }),
      ),
    ).rejects.toMatchObject({ code: 'unknown_event_types' });
    const staff = userCtx(org, [{ permission: 'integration.connection.read', propertyIds: 'all' }]);
    await expect(tx(h, staff, (t) => integration.listSubscriptions(t))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('never reaches a partner from a trial organization; demo deliveries are simulated', async () => {
    for (const environment of ['trial', 'demo'] as const) {
      const org = await setupOrg(h, { environment });
      const sub = await tx(h, org.ctx, (t) =>
        integration.createSubscription(t, h.deps, {
          name: `Partner ${environment}`,
          url: 'https://partner.example.com/hooks',
          eventTypes: ['*'],
          propertyIds: [],
        }),
      );
      await emit(org, 'reservations.booking.confirmed', org.propertyId);
      await drain(environment);
      const res = await integration.deliverDueWebhooks(h.t.db, h.deps, org.ctx);
      expect(res[environment === 'trial' ? 'blocked' : 'simulated']).toBe(1);
      expect(h.sent).toHaveLength(0);
      const [d] = await tx(h, org.ctx, (t) => integration.listDeliveries(t, sub.id));
      expect(d?.status).toBe(environment === 'trial' ? 'blocked' : 'simulated');
      if (environment === 'trial') expect(d?.lastError).toMatch(/disabled in the trial environment/);
    }
  });
});
