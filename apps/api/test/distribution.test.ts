/**
 * Distribution over HTTP through the REAL composition root: the demo seed's simulated Channex connection (fully
 * mapped, active), the worker's work for that organization, the public booking-revision webhook, permissions,
 * tenant isolation, idempotent replays without secrets — and the honest limit of this deployment: the real
 * reservations module cannot price channel bookings yet (its rates port is not bound on main), so a received booking
 * is stored, NOT acknowledged, and shown as "not applied" with an exception (blocked-by-binding, README).
 */
import { drainOutbox, sql } from '@portico/db';
import { runTenantWork, webhookDeliveries } from '@portico/distribution';
import { newId, systemContext } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compose } from '../src';
import { DEMO_PASSWORD, DEMO_TOTP_SECRET, type DemoOrganization, seedDemo } from '../src/seed/demo';
import { type ApiHarness, startApi } from './helpers';
import { totpCode } from './totp';

let h: ApiHarness;
let orgs: DemoOrganization[];
beforeAll(async () => {
  h = await startApi();
  orgs = await seedDemo(h.t.db, { businessDate: '2026-11-07', authenticator: true });
}, 180_000);
afterAll(async () => h?.close());

const sessions = new Map<string, { authorization: string }>();
/** Sign in once per person (a TOTP code cannot be used twice). */
async function signIn(org: DemoOrganization, role: string) {
  const cached = sessions.get(`${org.tenantId}:${role}`);
  if (cached) return cached;
  const user = org.users.find((u) => u.role === role);
  const first = await h.app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email: user?.email, password: DEMO_PASSWORD, organizationId: org.tenantId },
  });
  let token = first.json().token as string | undefined;
  if (first.json().status === 'mfa_required') {
    const ok = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/login/mfa',
      payload: { challengeToken: first.json().challengeToken, code: totpCode(DEMO_TOTP_SECRET, new Date()) },
    });
    token = ok.json().token;
  }
  const auth = { authorization: `Bearer ${token}` };
  sessions.set(`${org.tenantId}:${role}`, auth);
  return auth;
}

/** What apps/worker does for this organization: consume events, then run its due distribution work. */
async function workerPass(org: DemoOrganization) {
  const c = compose(h.t.db);
  await drainOutbox(h.t.db, {
    subscriptions: c.subscriptions.filter((s) => s.consumer.startsWith('distribution.')),
    environmentOf: async () => 'demo',
  });
  return runTenantWork(
    h.t.db,
    c.services.distribution.deps,
    systemContext(org.tenantId, 'test-worker', 'demo', newId()),
  );
}

describe('distribution API (composition root)', () => {
  it('the demo resort has a simulated, mapped, active Channex connection; the worker publishes its calendar', async () => {
    const azure = orgs[1] as DemoOrganization;
    const resort = azure.properties.find(
      (p) => p.profile === 'resort',
    ) as DemoOrganization['properties'][number];
    const auth = await signIn(azure, 'revenue_manager');
    const list = await h.app.inject({
      method: 'GET',
      url: `/v1/distribution/connections?propertyId=${resort.id}`,
      headers: auth,
    });
    expect(list.statusCode, list.body).toBe(200);
    const conn = list.json().items[0];
    expect(conn).toMatchObject({
      status: { connection: 'active' },
      target: 'simulator',
      provenance: 'simulated',
    });
    const completeness = await h.app.inject({
      method: 'GET',
      url: `/v1/distribution/connections/${conn.id}/completeness`,
      headers: auth,
    });
    expect(completeness.json()).toMatchObject({ complete: true });
    const work = await workerPass(azure);
    expect(work.errors).toEqual([]);
    expect(work.sent).toBeGreaterThanOrEqual(2);
    const health = await h.app.inject({
      method: 'GET',
      url: `/v1/distribution/connections/${conn.id}/health`,
      headers: auth,
    });
    expect(health.json()).toMatchObject({ health: 'connected', banner: null, provenance: 'simulated' });
    const cal = await h.app.inject({
      method: 'GET',
      url: `/v1/distribution/connections/${conn.id}/calendar?from=2026-11-10&to=2026-11-12&kind=availability`,
      headers: auth,
    });
    expect(cal.statusCode, cal.body).toBe(200);
    expect(cal.json().items.length).toBeGreaterThan(0);
    expect(cal.json().items.every((c: { state: string }) => c.state === 'in_sync')).toBe(true);
    const sim = await h.app.inject({
      method: 'GET',
      url: `/v1/distribution/connections/${conn.id}/simulator`,
      headers: auth,
    });
    expect(sim.statusCode, sim.body).toBe(200);
    expect(sim.json().apiKey).toBe('***'); // simulator secrets are never returned
    expect(Object.values(sim.json().webhook.headers)).toEqual(['***']);
  });

  it('a channel booking reaches the public webhook, is stored, and — real reservations cannot apply it on main — is NOT acknowledged', async () => {
    const azure = orgs[1] as DemoOrganization;
    const resort = azure.properties.find(
      (p) => p.profile === 'resort',
    ) as DemoOrganization['properties'][number];
    const auth = await signIn(azure, 'revenue_manager');
    const conn = (
      await h.app.inject({
        method: 'GET',
        url: `/v1/distribution/connections?propertyId=${resort.id}`,
        headers: auth,
      })
    ).json().items[0];
    const sim = (
      await h.app.inject({
        method: 'GET',
        url: `/v1/distribution/connections/${conn.id}/simulator`,
        headers: auth,
      })
    ).json();
    const room = sim.ratePlans[0];
    const nightly = { '2026-12-10': '450.00', '2026-12-11': '450.00' };
    // Over the real public route: the simulated hub's request, with the token Channex would send.
    const { rows } = await sql<{
      state: { webhook: { headers: Record<string, string>; callbackUrl: string } };
    }>`
      select state from distribution.sim_hubs where id = ${conn.externalPropertyId}`.execute(
      h.t.admin.kysely,
    );
    const hook = rows[0]?.state.webhook;
    const simKey = newId();
    const book = await h.app.inject({
      method: 'POST',
      url: `/v1/distribution/connections/${conn.id}/simulator/bookings`,
      headers: { ...auth, 'idempotency-key': simKey },
      payload: {
        status: 'new',
        rooms: [
          {
            roomTypeId: room.roomTypeId,
            ratePlanId: room.id,
            checkin: '2026-12-10',
            checkout: '2026-12-12',
            adults: 2,
            nightly,
          },
        ],
        deliver: { webhook: false },
      },
    });
    expect(book.statusCode, book.body).toBe(200);
    // Idempotent simulator control: the same key names the same simulated revision.
    const again = await h.app.inject({
      method: 'POST',
      url: `/v1/distribution/connections/${conn.id}/simulator/bookings`,
      headers: { ...auth, 'idempotency-key': simKey },
      payload: {
        status: 'new',
        rooms: [
          {
            roomTypeId: room.roomTypeId,
            ratePlanId: room.id,
            checkin: '2026-12-10',
            checkout: '2026-12-12',
            adults: 2,
            nightly,
          },
        ],
        deliver: { webhook: false },
      },
    });
    expect(again.json().revisionId).toBe(book.json().revisionId);
    const state = (
      await sql<{
        state: never;
      }>`select state from distribution.sim_hubs where id = ${conn.externalPropertyId}`.execute(
        h.t.admin.kysely,
      )
    ).rows[0]?.state;
    const [delivery] = webhookDeliveries(state as never, [book.json().revisionId]);
    const url = `/v1/distribution/webhooks/channex/${conn.webhook.url.split('/').pop()}`;
    expect(hook?.callbackUrl.endsWith(url)).toBe(true);
    const refused = await h.app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', 'x-portico-webhook-token': 'nope' },
      payload: delivery?.rawBody,
    });
    expect(refused.statusCode).toBe(401);
    const res = await h.app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', ...hook?.headers },
      payload: delivery?.rawBody,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ received: true, outcome: 'stored' });
    await workerPass(azure);
    const revs = await h.app.inject({
      method: 'GET',
      url: `/v1/distribution/connections/${conn.id}/revisions`,
      headers: auth,
    });
    const rev = revs.json().items[0];
    expect(rev).toMatchObject({
      status: { revision: 'failed', ack: 'not_due' },
      lastError: expect.stringMatching(/not connected/i),
    });
    const exc = await h.app.inject({
      method: 'GET',
      url: `/v1/distribution/connections/${conn.id}/exceptions?status=open`,
      headers: auth,
    });
    expect(exc.json().items.find((e: { code: string }) => e.code === 'booking_not_applied')).toBeDefined();
    const after = (
      await sql<{
        state: { revisions: Array<{ id: string; acked: boolean }> };
      }>`select state from distribution.sim_hubs where id = ${conn.externalPropertyId}`.execute(
        h.t.admin.kysely,
      )
    ).rows[0]?.state;
    expect(after?.revisions.find((r) => r.id === book.json().revisionId)?.acked).toBe(false);
  });

  it('permissions, isolation, idempotent create without replaying the webhook token', async () => {
    const azure = orgs[1] as DemoOrganization;
    const coral = orgs[0] as DemoOrganization;
    const resort = azure.properties.find(
      (p) => p.profile === 'resort',
    ) as DemoOrganization['properties'][number];
    const rm = await signIn(azure, 'revenue_manager');
    const conn = (
      await h.app.inject({
        method: 'GET',
        url: `/v1/distribution/connections?propertyId=${resort.id}`,
        headers: rm,
      })
    ).json().items[0];
    const housekeeping = await signIn(azure, 'housekeeping_attendant');
    const denied = await h.app.inject({
      method: 'GET',
      url: `/v1/distribution/connections/${conn.id}`,
      headers: housekeeping,
    });
    expect(denied.statusCode).toBe(403);
    const otherOrg = await signIn(coral, 'org_admin');
    const hidden = await h.app.inject({
      method: 'GET',
      url: `/v1/distribution/connections/${conn.id}`,
      headers: otherOrg,
    });
    expect(hidden.statusCode).toBe(404);
    const etag = (
      await h.app.inject({ method: 'GET', url: `/v1/distribution/connections/${conn.id}`, headers: rm })
    ).headers.etag;
    expect(etag).toMatch(/^W\/"\d+"$/);
    const noIfMatch = await h.app.inject({
      method: 'POST',
      url: `/v1/distribution/connections/${conn.id}/pause`,
      headers: rm,
      payload: {},
    });
    expect(noIfMatch.json().code).toBe('if_match_required');
    // Create on another property: the token is shown once; a replay of the same request does not show it again.
    const hotel = azure.properties.find(
      (p) => p.profile !== 'resort',
    ) as DemoOrganization['properties'][number];
    const key = newId();
    const create = () =>
      h.app.inject({
        method: 'POST',
        url: '/v1/distribution/connections',
        headers: { ...rm, 'idempotency-key': key },
        payload: {
          propertyId: hotel.id,
          name: 'Channex (simulated)',
          simulator: { roomTypes: ['A'], ratePlans: [] },
        },
      });
    const first = await create();
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().webhookToken).toMatch(/.{20,}/);
    const replay = await create();
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toMatchObject({
      connection: { id: first.json().connection.id },
      webhookToken: null,
    });
    const stored = await sql<{ n: number }>`select count(*)::int as n from core.idempotency_keys
      where response_body::text like ${`%${first.json().webhookToken}%`}`.execute(h.t.admin.kysely);
    expect(stored.rows[0]?.n).toBe(0);
    const audit = await sql<{ n: number }>`select count(*)::int as n from core.audit_log
      where coalesce(after::text, '') || coalesce(before::text, '') like ${`%${first.json().webhookToken}%`}`.execute(
      h.t.admin.kysely,
    );
    expect(audit.rows[0]?.n).toBe(0);
    const spec = await h.app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(spec.json().paths['/v1/distribution/webhooks/channex/{endpointId}']).toBeDefined();
  });
});
