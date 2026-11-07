import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiHarness, signedInOrg, startApi } from './helpers';

/**
 * Reservations wired into the real composition root over HTTP. Every port is bound to its real provider (the
 * end-to-end paths are proven in bindings.test.ts and scenarios/); full behaviour in modules/reservations/test.
 */
let h: ApiHarness;
beforeAll(async () => {
  h = await startApi();
});
afterAll(async () => h?.close());

async function property(auth: Record<string, string>) {
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
      code: 'RES',
      name: 'Reef Resort',
      profile: 'resort',
      legalEntityId: le.json().id,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      businessDate: '2026-12-10',
    },
  });
  return p.json().id as string;
}

describe('reservations in the API composition', () => {
  it('mounts the routes, requires authentication and documents them in OpenAPI', async () => {
    expect(
      (await h.app.inject({ method: 'GET', url: `/v1/bookings?propertyId=${newId()}` })).statusCode,
    ).toBe(401);
    const spec = await h.app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(Object.keys(spec.json().paths)).toEqual(
      expect.arrayContaining(['/v1/bookings', '/v1/reservations/changes/commit', '/v1/stays/{id}/check-in']),
    );
  });

  it('lists (empty) bookings and front desk, and quotes through the real rates module', async () => {
    const { auth } = await signedInOrg(h);
    const propertyId = await property(auth);
    const list = await h.app.inject({
      method: 'GET',
      url: `/v1/bookings?propertyId=${propertyId}`,
      headers: auth,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ items: [], nextCursor: null });
    const arrivals = await h.app.inject({
      method: 'GET',
      url: `/v1/front-desk/arrivals?propertyId=${propertyId}`,
      headers: auth,
    });
    expect(arrivals.json()).toMatchObject({ businessDate: '2026-12-10', items: [] });
    const quote = await h.app.inject({
      method: 'POST',
      url: '/v1/reservations/quotes',
      headers: auth,
      payload: {
        propertyId,
        arrival: '2026-12-12',
        departure: '2026-12-14',
        occupancy: { adults: 2, childrenAges: [] },
      },
    });
    // Rates is bound (ratesPortFrom): a property without rate plans has nothing to sell yet — an honest empty quote.
    expect(quote.statusCode).toBe(200);
    expect(quote.json()).toEqual({ offers: [] });
    const search = await h.app.inject({ method: 'GET', url: '/v1/search?q=ABCDEFGH', headers: auth });
    expect(search.statusCode).toBe(200);
  });
});
