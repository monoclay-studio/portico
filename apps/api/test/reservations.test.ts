import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiHarness, signedInOrg, startApi } from './helpers';

/**
 * Reservations wired into the real composition root. Inventory, rates, guests, finance, payments and operations
 * are wave-1 modules bound by the orchestrator at merge; until then reservations answers honestly (503
 * module_not_available) instead of pretending. Full behaviour is proven in modules/reservations/test.
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

  it('lists (empty) bookings and front desk, and says plainly when a provider module is not installed yet', async () => {
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
    expect(quote.statusCode).toBe(503);
    expect(quote.json()).toMatchObject({
      code: 'module_not_available',
      retryable: true,
      detail: expect.stringMatching(/rates module, which is not connected yet/),
    });
    const search = await h.app.inject({ method: 'GET', url: '/v1/search?q=ABCDEFGH', headers: auth });
    expect(search.statusCode).toBe(200);
  });
});
