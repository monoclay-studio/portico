import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiHarness, signedInOrg, startApi } from './helpers';

let h: ApiHarness;
beforeAll(async () => {
  h = await startApi();
});
afterAll(async () => h?.close());

async function createLegalEntityAndProperty(auth: Record<string, string>, code = 'RES') {
  const le = await h.app.inject({
    method: 'POST',
    url: '/v1/legal-entities',
    headers: { ...auth, 'idempotency-key': newId() },
    payload: {
      name: 'Lagoon Resorts',
      legalName: 'Lagoon Resorts Pvt Ltd',
      countryCode: 'MV',
      baseCurrency: 'USD',
    },
  });
  expect(le.statusCode).toBe(201);
  const prop = await h.app.inject({
    method: 'POST',
    url: '/v1/properties',
    headers: { ...auth, 'idempotency-key': newId() },
    payload: {
      code,
      name: 'Lagoon Island Resort',
      profile: 'resort',
      legalEntityId: le.json().id,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      businessDate: '2026-11-07',
    },
  });
  expect(prop.statusCode).toBe(201);
  return prop;
}

describe('API foundation', () => {
  it('serves health checks and OpenAPI without authentication', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
    const spec = await h.app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(spec.json().paths['/v1/properties']).toBeDefined();
  });

  it('rejects unauthenticated requests with a problem+json explanation', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/v1/properties' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ code: 'unauthenticated' });
  });

  it('returns the signed-in user and their roles', async () => {
    const { auth, tenantId } = await signedInOrg(h);
    const me = await h.app.inject({ method: 'GET', url: '/v1/me', headers: auth });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      organizationId: tenantId,
      roles: [{ key: 'org_admin', scopeType: 'organization' }],
    });
  });

  it('validates input and explains what is wrong', async () => {
    const { auth } = await signedInOrg(h);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/legal-entities',
      headers: { ...auth, 'idempotency-key': newId() },
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation_failed');
    expect(res.json().errors.length).toBeGreaterThan(0);
  });

  it('requires idempotency keys for creates and replays retries without duplicating', async () => {
    const { auth } = await signedInOrg(h);
    const noKey = await h.app.inject({
      method: 'POST',
      url: '/v1/legal-entities',
      headers: auth,
      payload: { name: 'X', legalName: 'X', countryCode: 'MV', baseCurrency: 'USD' },
    });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().code).toBe('idempotency_key_required');

    const key = newId();
    const payload = { name: 'Once', legalName: 'Once Ltd', countryCode: 'MV', baseCurrency: 'USD' };
    const first = await h.app.inject({
      method: 'POST',
      url: '/v1/legal-entities',
      headers: { ...auth, 'idempotency-key': key },
      payload,
    });
    const retry = await h.app.inject({
      method: 'POST',
      url: '/v1/legal-entities',
      headers: { ...auth, 'idempotency-key': key },
      payload,
    });
    expect(retry.json().id).toBe(first.json().id);
    const list = await h.app.inject({ method: 'GET', url: '/v1/legal-entities', headers: auth });
    expect(list.json().items.filter((e: { name: string }) => e.name === 'Once')).toHaveLength(1);
  });

  it('detects concurrent edits with ETag / If-Match (scenario 14 foundation)', async () => {
    const { auth } = await signedInOrg(h);
    const prop = await createLegalEntityAndProperty(auth);
    const id = prop.json().id;
    const etag = prop.headers.etag as string;
    const a = await h.app.inject({
      method: 'PATCH',
      url: `/v1/properties/${id}`,
      headers: { ...auth, 'if-match': etag },
      payload: { name: 'Edited by A' },
    });
    expect(a.statusCode).toBe(200);
    const b = await h.app.inject({
      method: 'PATCH',
      url: `/v1/properties/${id}`,
      headers: { ...auth, 'if-match': etag },
      payload: { name: 'Edited by B' },
    });
    expect(b.statusCode).toBe(409);
    expect(b.json()).toMatchObject({ code: 'version_conflict', details: { currentVersion: 2 } });
  });
});

describe('scenario 17: a user tries to access another hotel customer’s records', () => {
  it('cannot read, list, or modify another organization’s property — even with its id', async () => {
    const victim = await signedInOrg(h, 'Victim Resort');
    const prop = await createLegalEntityAndProperty(victim.auth, 'VIC');
    const id = prop.json().id;
    const attacker = await signedInOrg(h, 'Other Hotel');

    const read = await h.app.inject({ method: 'GET', url: `/v1/properties/${id}`, headers: attacker.auth });
    expect(read.statusCode).toBe(404);
    const list = await h.app.inject({ method: 'GET', url: '/v1/properties', headers: attacker.auth });
    expect(list.json().items.map((p: { id: string }) => p.id)).not.toContain(id);
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/v1/properties/${id}`,
      headers: { ...attacker.auth, 'if-match': 'W/"1"' },
      payload: { name: 'pwned' },
    });
    expect(patch.statusCode).toBe(404);

    // The victim's record is unchanged.
    const check = await h.app.inject({ method: 'GET', url: `/v1/properties/${id}`, headers: victim.auth });
    expect(check.json().name).toBe('Lagoon Island Resort');
  });

  it('a token with a swapped organization id is rejected', async () => {
    const a = await signedInOrg(h, 'A');
    const b = await signedInOrg(h, 'B');
    const forged = a.token.replace(a.tenantId, b.tenantId);
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/properties',
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
