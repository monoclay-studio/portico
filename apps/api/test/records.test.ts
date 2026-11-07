import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiHarness, signedInOrg, startApi } from './helpers';

let h: ApiHarness;
beforeAll(async () => {
  h = await startApi();
});
afterAll(async () => h?.close());

async function makeProperty(auth: Record<string, string>, code: string, name: string) {
  const le = await h.app.inject({
    method: 'POST',
    url: '/v1/legal-entities',
    headers: { ...auth, 'idempotency-key': newId() },
    payload: { name: 'LE', legalName: 'LE Pvt Ltd', countryCode: 'MV', baseCurrency: 'USD' },
  });
  const p = await h.app.inject({
    method: 'POST',
    url: '/v1/properties',
    headers: { ...auth, 'idempotency-key': newId() },
    payload: {
      code,
      name,
      profile: 'resort',
      legalEntityId: le.json().id,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      businessDate: '2026-11-07',
    },
  });
  return p.json();
}

describe('global search and record history (experience architecture)', () => {
  it('finds records across modules, permission-aware, with routes for the UI', async () => {
    const { auth } = await signedInOrg(h);
    await makeProperty(auth, 'LAG', 'Lagoon Retreat');
    const other = await signedInOrg(h, 'Other org');
    await makeProperty(other.auth, 'LAX', 'Lagoon Secret');

    const res = await h.app.inject({ method: 'GET', url: '/v1/search?q=lagoon', headers: auth });
    expect(res.statusCode).toBe(200);
    const titles = res.json().items.map((i: { title: string }) => i.title);
    expect(titles).toContain('Lagoon Retreat');
    expect(titles).not.toContain('Lagoon Secret'); // other organization never appears
    expect(res.json().items[0]).toMatchObject({ type: 'property', label: 'Property' });
    expect(res.json().items[0].route).toMatch(/^\/settings\/properties\//);
  });

  it('returns one history timeline for a record, and hides other organizations’ records', async () => {
    const { auth } = await signedInOrg(h);
    const p = await makeProperty(auth, 'HIS', 'History Island');
    await h.app.inject({
      method: 'PATCH',
      url: `/v1/properties/${p.id}`,
      headers: { ...auth, 'if-match': 'W/"1"' },
      payload: { name: 'History Island Resort' },
    });
    const hist = await h.app.inject({
      method: 'GET',
      url: `/v1/records/property/${p.id}/history`,
      headers: auth,
    });
    expect(hist.statusCode).toBe(200);
    expect(hist.json().items.map((i: { action: string }) => i.action)).toEqual([
      'platform.property.create',
      'platform.property.update',
    ]);

    const intruder = await signedInOrg(h, 'Intruder');
    const denied = await h.app.inject({
      method: 'GET',
      url: `/v1/records/property/${p.id}/history`,
      headers: intruder.auth,
    });
    expect(denied.statusCode).toBe(404);

    const summary = await h.app.inject({
      method: 'GET',
      url: `/v1/records/property/${p.id}/summary`,
      headers: auth,
    });
    expect(summary.json()).toMatchObject({ title: 'History Island Resort', subtitle: 'HIS · resort' });
  });
});
