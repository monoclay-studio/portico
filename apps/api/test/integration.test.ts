/**
 * Integration module over HTTP (composition root wiring): catalogue, simulated PMS, connection setup with
 * Idempotency-Key / If-Match / ETag, unit types and units from inventory and rate plans from rates (unmapped codes
 * shown, never guessed), problem+json explanations, health, search, record history, webhooks, simulators refused in
 * live organizations, and tenant isolation.
 */
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionOrganization } from '../src';
import { type ApiHarness, enrolMfa, signedInOrg, startApi } from './helpers';

let h: ApiHarness;
beforeAll(async () => {
  h = await startApi();
});
afterAll(async () => h?.close());

async function makeProperty(auth: Record<string, string>) {
  const le = await h.app.inject({
    method: 'POST',
    url: '/v1/legal-entities',
    headers: { ...auth, 'idempotency-key': newId() },
    payload: { name: 'Lagoon', legalName: 'Lagoon Pvt Ltd', countryCode: 'MV', baseCurrency: 'USD' },
  });
  const p = await h.app.inject({
    method: 'POST',
    url: '/v1/properties',
    headers: { ...auth, 'idempotency-key': newId() },
    payload: {
      code: 'LGN',
      name: 'Lagoon Island Resort',
      profile: 'resort',
      legalEntityId: le.json().id,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      businessDate: '2026-11-07',
    },
  });
  return p.json().id as string;
}

/** Simulated systems exist only in demo, trial, training and sandbox organizations (F8). */
async function signedInSandboxOrg(name = 'Sandbox hotel') {
  const email = `admin-${newId()}@example.mv`;
  const password = 'correct horse battery staple';
  await provisionOrganization(h.t.db, {
    name,
    slug: `org-${newId().slice(-12)}`,
    environment: 'sandbox',
    planCode: 'enterprise',
    admin: { email, displayName: 'Admin', password },
  });
  const res = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });
  const body = res.json();
  if (body.status !== 'signed_in') throw new Error(`login failed: ${res.body}`);
  const auth = { authorization: `Bearer ${body.token}` };
  // Sensitive (⚑) permissions such as legal entities need MFA (ADR-0017 §8).
  await enrolMfa(h.app, auth, password);
  return { auth };
}

describe('integration API', () => {
  it('refuses a simulated PMS in a live organization', async () => {
    const { auth } = await signedInOrg(h);
    const sim = await h.app.inject({
      method: 'POST',
      url: '/v1/integration/simulators/pms',
      headers: auth,
      payload: { seed: true },
    });
    expect(sim.statusCode).toBe(422);
    expect(sim.json().code).toBe('simulator_not_in_live');
  });

  it('lists the catalogue honestly', async () => {
    const { auth } = await signedInOrg(h);
    const res = await h.app.inject({ method: 'GET', url: '/v1/integration/catalogue', headers: auth });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{
      key: string;
      connectable: boolean;
      implementation: { level: string };
    }>;
    expect(items.find((c) => c.key === 'pms.simulator')).toMatchObject({
      connectable: true,
      implementation: { level: 'R3' },
    });
    expect(items.find((c) => c.key === 'channel.channex')).toMatchObject({
      connectable: false,
      implementation: { level: 'R1' },
    });
    const spec = await h.app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(spec.json().paths['/v1/integration/connections/{id}/activate']).toBeDefined();
  });

  it('runs the setup journey over HTTP up to the honest limit of this deployment', async () => {
    const { auth } = await signedInSandboxOrg();
    const propertyId = await makeProperty(auth);
    const sim = await h.app.inject({
      method: 'POST',
      url: '/v1/integration/simulators/pms',
      headers: auth,
      payload: { seed: true },
    });
    expect(sim.statusCode).toBe(201);
    const { accountId, apiKey } = sim.json();

    const body = { connectorKey: 'pms.simulator', name: 'Lagoon PMS', propertyIds: [propertyId] };
    const noKey = await h.app.inject({
      method: 'POST',
      url: '/v1/integration/connections',
      headers: auth,
      payload: body,
    });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().code).toBe('idempotency_key_required');
    const key = newId();
    const created = await h.app.inject({
      method: 'POST',
      url: '/v1/integration/connections',
      headers: { ...auth, 'idempotency-key': key },
      payload: body,
    });
    expect(created.statusCode).toBe(201);
    const retry = await h.app.inject({
      method: 'POST',
      url: '/v1/integration/connections',
      headers: { ...auth, 'idempotency-key': key },
      payload: body,
    });
    expect(retry.json().id).toBe(created.json().id);
    const id = created.json().id as string;
    expect(created.json()).toMatchObject({
      state: 'selected',
      status: { setup: 'selected' },
      links: [{ rel: 'property', id: propertyId }],
    });

    const get = await h.app.inject({
      method: 'GET',
      url: `/v1/integration/connections/${id}`,
      headers: auth,
    });
    const etag = get.headers.etag as string;
    const scope = {
      workflows: [{ workflow: 'reservations', operations: ['read', 'receive'] }],
      authority: [{ domain: 'reservations', writeMode: 'read_only' }],
    };
    const noIfMatch = await h.app.inject({
      method: 'POST',
      url: `/v1/integration/connections/${id}/compatibility`,
      headers: auth,
      payload: { scope, acknowledged: true },
    });
    expect(noIfMatch.json().code).toBe('if_match_required');
    const compat = await h.app.inject({
      method: 'POST',
      url: `/v1/integration/connections/${id}/compatibility`,
      headers: { ...auth, 'if-match': etag },
      payload: { scope, acknowledged: true },
    });
    expect(compat.statusCode).toBe(200);
    const stale = await h.app.inject({
      method: 'POST',
      url: `/v1/integration/connections/${id}/compatibility`,
      headers: { ...auth, 'if-match': etag },
      payload: { scope, acknowledged: true },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('version_conflict');

    const auth1 = await h.app.inject({
      method: 'POST',
      url: `/v1/integration/connections/${id}/authorize`,
      headers: { ...auth, 'if-match': compat.headers.etag as string },
      payload: { credentials: { accountId, apiKey }, label: 'Simulator key' },
    });
    expect(auth1.statusCode).toBe(200);
    expect(JSON.stringify(auth1.json())).not.toContain(apiKey);
    const creds = await h.app.inject({
      method: 'GET',
      url: `/v1/integration/connections/${id}/credentials`,
      headers: auth,
    });
    expect(JSON.stringify(creds.json())).not.toContain(apiKey);

    const suggest = await h.app.inject({
      method: 'POST',
      url: `/v1/integration/connections/${id}/mappings/suggest`,
      headers: { ...auth, 'if-match': auth1.headers.etag as string },
    });
    expect(suggest.statusCode).toBe(200);
    const set = suggest.json();
    expect(set.items.find((m: { kind: string }) => m.kind === 'property')).toMatchObject({
      internalId: propertyId,
      autoConfirmed: true,
    });
    // Unit types come from inventory and rate plans from rates (both empty for this new property): the external
    // codes are shown as unmapped and blocking, never guessed.
    const issues = set.issues as Array<{ code: string; kind: string }>;
    expect(issues.filter((i) => i.code === 'provider_unavailable')).toEqual([]);
    expect(new Set(issues.filter((i) => i.code === 'unmapped').map((i) => i.kind))).toEqual(
      new Set(['unitType', 'ratePlan']),
    );

    const resolve = await h.app.inject({
      method: 'POST',
      url: `/v1/integration/connections/${id}/issues/resolve`,
      headers: { ...auth, 'if-match': suggest.headers.etag as string },
    });
    expect(resolve.statusCode).toBe(422);
    expect(resolve.headers['content-type']).toContain('application/problem+json');
    expect(resolve.json()).toMatchObject({ code: 'blocking_issues' });

    const health = await h.app.inject({ method: 'GET', url: '/v1/integration/health', headers: auth });
    expect(health.json().totals).toMatchObject({ connections: 1, notMonitored: 1 });
    const search = await h.app.inject({ method: 'GET', url: '/v1/search?q=Lagoon%20PMS', headers: auth });
    expect(search.json().items.map((x: { type: string }) => x.type)).toContain('integration_connection');
    const history = await h.app.inject({
      method: 'GET',
      url: `/v1/records/integration_connection/${id}/history`,
      headers: auth,
    });
    expect(history.statusCode).toBe(200);
    expect(JSON.stringify(history.json())).not.toContain(apiKey);

    // Another organization cannot see it.
    const other = await signedInOrg(h, 'Other hotel');
    const peek = await h.app.inject({
      method: 'GET',
      url: `/v1/integration/connections/${id}`,
      headers: other.auth,
    });
    expect(peek.statusCode).toBe(404);
  });

  it('creates a webhook subscription showing the signing secret once', async () => {
    const { auth } = await signedInOrg(h);
    const key = newId();
    const payload = {
      name: 'Partner',
      url: 'https://partner.example.com/hooks',
      eventTypes: ['reservations.*'],
    };
    const first = await h.app.inject({
      method: 'POST',
      url: '/v1/integration/webhooks/subscriptions',
      headers: { ...auth, 'idempotency-key': key },
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().signingSecret).toMatch(/^whsec_/);
    const replay = await h.app.inject({
      method: 'POST',
      url: '/v1/integration/webhooks/subscriptions',
      headers: { ...auth, 'idempotency-key': key },
      payload,
    });
    expect(replay.json().id).toBe(first.json().id);
    expect(replay.json().signingSecret).not.toMatch(/^whsec_/);
    const types = await h.app.inject({
      method: 'GET',
      url: '/v1/integration/webhook-event-types',
      headers: auth,
    });
    expect(types.json().items.length).toBeGreaterThan(5);
    const bad = await h.app.inject({
      method: 'POST',
      url: '/v1/integration/webhooks/subscriptions',
      headers: { ...auth, 'idempotency-key': newId() },
      payload: { ...payload, name: 'x', url: 'http://insecure.example.com' },
    });
    expect(bad.statusCode).toBe(400);
  });
});
