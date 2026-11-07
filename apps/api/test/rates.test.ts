import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiHarness, signedInOrg, startApi } from './helpers';

let h: ApiHarness;
beforeAll(async () => {
  h = await startApi();
});
afterAll(async () => h?.close());

type Auth = Record<string, string>;
const post = (auth: Auth, url: string, payload: unknown, extra: Record<string, string> = {}) =>
  h.app.inject({
    method: 'POST',
    url,
    headers: { ...auth, 'idempotency-key': newId(), ...extra },
    payload: payload as object,
  });

async function resortOrg() {
  const org = await signedInOrg(h, 'Rates Resort');
  const le = await post(org.auth, '/v1/legal-entities', {
    name: 'Lagoon',
    legalName: 'Lagoon Pvt Ltd',
    countryCode: 'MV',
    baseCurrency: 'USD',
  });
  const prop = await post(org.auth, '/v1/properties', {
    code: 'LAG',
    name: 'Lagoon Resort',
    profile: 'resort',
    legalEntityId: le.json().id,
    countryCode: 'MV',
    timezone: 'Indian/Maldives',
    baseCurrency: 'USD',
    businessDate: '2026-11-07',
    classification: {
      'mv.establishmentType': 'resort',
      'mv.inhabitedIsland': false,
      'mv.registeredRooms': 80,
    },
  });
  expect(prop.statusCode).toBe(201);
  return { ...org, propertyId: prop.json().id as string };
}

describe('rates over HTTP', () => {
  it('configures a plan, previews and applies prices, activates, quotes and reprices — with idempotency and ETags', async () => {
    const o = await resortOrg();
    const install = await post(o.auth, '/v1/tax-templates/install', { template: 'MV' });
    expect(install.statusCode).toBe(200);
    expect(install.json().installed).toContain('MV-TGST');

    const policy = await post(o.auth, '/v1/rate-policies', {
      kind: 'cancellation',
      propertyId: o.propertyId,
      code: 'FLEX14',
      name: 'Flexible 14 days',
      structure: {
        tiers: [{ from: { kind: 'days_before_arrival', days: 14 }, penalty: { kind: 'first_night' } }],
      },
    });
    expect(policy.statusCode).toBe(201);
    expect(policy.json().text).toMatch(/From 14 days before arrival/);

    const createKey = newId();
    const planBody = {
      propertyId: o.propertyId,
      code: 'BAR',
      name: 'Best available',
      cancellationPolicyId: policy.json().id,
    };
    const plan = await post(o.auth, '/v1/rate-plans', planBody, { 'idempotency-key': createKey });
    expect(plan.statusCode).toBe(201);
    expect(plan.headers.etag).toBe('W/"1"');
    expect(plan.json()).toMatchObject({ status: { ratePlan: 'draft' }, kind: 'base' });
    expect(plan.json().allowedActions.find((a: { action: string }) => a.action === 'activate')).toMatchObject(
      { enabled: false },
    );
    const replay = await post(o.auth, '/v1/rate-plans', planBody, { 'idempotency-key': createKey });
    expect(replay.json().id).toBe(plan.json().id);

    const unitTypeId = newId();
    const update = {
      propertyId: o.propertyId,
      ratePlanId: plan.json().id,
      unitTypeIds: [unitTypeId],
      ranges: [{ from: '2026-12-01', to: '2027-01-01' }],
      set: { baseOccupancy: 2, baseAmountMinor: 80_000, extraAdultMinor: 15_000 },
    };
    const preview = await h.app.inject({
      method: 'POST',
      url: '/v1/rate-calendar/prices/preview',
      headers: o.auth,
      payload: update,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().summary).toMatchObject({ cells: 31, nights: 31 });
    const noKey = await h.app.inject({
      method: 'POST',
      url: '/v1/rate-calendar/prices',
      headers: o.auth,
      payload: update,
    });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().code).toBe('idempotency_key_required');
    const applied = await post(o.auth, '/v1/rate-calendar/prices', update);
    expect(applied.statusCode).toBe(200);
    expect(applied.json().changeSetId).toBeTruthy();

    const stale = await h.app.inject({
      method: 'POST',
      url: `/v1/rate-plans/${plan.json().id}/status`,
      headers: { ...o.auth, 'if-match': 'W/"0"' },
      payload: { status: 'active' },
    });
    expect(stale.statusCode).toBe(409);
    const activated = await h.app.inject({
      method: 'POST',
      url: `/v1/rate-plans/${plan.json().id}/status`,
      headers: { ...o.auth, 'if-match': plan.headers.etag as string },
      payload: { status: 'active', reason: 'launch' },
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().status).toEqual({ ratePlan: 'active' });

    const calendar = await h.app.inject({
      method: 'GET',
      url: `/v1/rate-plans/${plan.json().id}/calendar?from=2026-12-01&to=2026-12-03`,
      headers: o.auth,
    });
    expect(calendar.json().cells).toHaveLength(2);

    const quote = await h.app.inject({
      method: 'POST',
      url: '/v1/quotes',
      headers: o.auth,
      payload: {
        propertyId: o.propertyId,
        nights: { from: '2026-12-10', to: '2026-12-13' },
        occupancy: { adults: 2 },
        bookingDate: '2026-11-07',
      },
    });
    expect(quote.statusCode).toBe(200);
    const offer = quote.json().offers[0];
    expect(offer).toMatchObject({ ratePlanCode: 'BAR', bookable: true, unitTypeId });
    expect(offer.totals.net.amountMinor).toBe(240_000);
    expect(
      offer.totals.net.amountMinor + offer.totals.taxes.amountMinor + offer.totals.fees.amountMinor,
    ).toBe(offer.totals.gross.amountMinor);

    const reprice = await h.app.inject({
      method: 'POST',
      url: '/v1/quotes/reprice',
      headers: o.auth,
      payload: { terms: offer.terms, change: { nights: { from: '2026-12-10', to: '2026-12-14' } } },
    });
    expect(reprice.statusCode).toBe(200);
    expect(reprice.json().nightly.map((n: { source: string }) => n.source)).toEqual([
      'agreed',
      'agreed',
      'agreed',
      'current_rates',
    ]);

    const penalty = await h.app.inject({
      method: 'POST',
      url: '/v1/terms/penalty',
      headers: o.auth,
      payload: { terms: offer.terms, at: '2026-12-05T00:00:00Z' },
    });
    expect(penalty.statusCode).toBe(200);
    expect(penalty.json()).toMatchObject({ event: 'cancellation', penalty: { kind: 'first_night' } });
    const forged = await h.app.inject({
      method: 'POST',
      url: '/v1/terms/penalty',
      headers: o.auth,
      payload: { terms: { ...offer.terms, currency: 'EUR' } },
    });
    expect(forged.statusCode).toBe(400);
    expect(forged.json().code).toBe('terms_seal_invalid');
    const pack = await h.app.inject({
      method: 'GET',
      url: `/v1/tax-rule-packs/${o.propertyId}`,
      headers: o.auth,
    });
    expect(pack.statusCode).toBe(200);
    expect(pack.json()).toMatchObject({ verified: false, jurisdiction: 'MV' });

    const taxes = await h.app.inject({
      method: 'POST',
      url: '/v1/tax-calculations',
      headers: o.auth,
      payload: {
        propertyId: o.propertyId,
        lines: [
          {
            lineId: 'spa-1',
            chargeCode: 'SPA',
            taxCategory: 'spa',
            amount: { amountMinor: 20_000, currency: 'USD' },
            serviceDate: '2026-12-11',
          },
        ],
      },
    });
    expect(taxes.statusCode).toBe(200);
    expect(taxes.json().lines[0].taxes.map((x: { ruleCode: string }) => x.ruleCode)).toEqual(['MV-TGST']);

    const search = await h.app.inject({ method: 'GET', url: '/v1/search?q=BAR', headers: o.auth });
    expect(search.json().items.find((x: { type: string }) => x.type === 'rate_plan')).toMatchObject({
      id: plan.json().id,
      label: 'Rate plan',
    });
    const history = await h.app.inject({
      method: 'GET',
      url: `/v1/records/rate_plan/${plan.json().id}/history`,
      headers: o.auth,
    });
    expect(history.statusCode).toBe(200);
    expect(JSON.stringify(history.json())).toMatch(/rates.ratePlan.status/);
  });

  it('explains business-rule refusals as problem+json with recovery, and isolates organizations', async () => {
    const o = await resortOrg();
    const plan = await post(o.auth, '/v1/rate-plans', { propertyId: o.propertyId, code: 'BAR', name: 'BAR' });
    const derived = await post(o.auth, '/v1/rate-plans', {
      propertyId: o.propertyId,
      code: 'NR',
      name: 'NR',
      derivation: { parentRatePlanId: plan.json().id, adjustment: { kind: 'percent', percent: '-10' } },
    });
    const refused = await post(o.auth, '/v1/rate-calendar/prices', {
      propertyId: o.propertyId,
      ratePlanId: derived.json().id,
      unitTypeIds: [newId()],
      ranges: [{ from: '2026-12-01', to: '2026-12-02' }],
      set: { baseOccupancy: 2, baseAmountMinor: 1 },
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.headers['content-type']).toContain('application/problem+json');
    expect(refused.json()).toMatchObject({
      code: 'derived_plan_prices_computed',
      detail: expect.stringMatching(/Change the parent's prices/),
    });

    const attacker = await signedInOrg(h, 'Other');
    const read = await h.app.inject({
      method: 'GET',
      url: `/v1/rate-plans/${plan.json().id}`,
      headers: attacker.auth,
    });
    expect(read.statusCode).toBe(404);
    const list = await h.app.inject({
      method: 'GET',
      url: `/v1/rate-plans?propertyId=${o.propertyId}`,
      headers: attacker.auth,
    });
    expect(list.json().items).toEqual([]);
    const quote = await h.app.inject({
      method: 'POST',
      url: '/v1/quotes',
      headers: attacker.auth,
      payload: {
        propertyId: o.propertyId,
        nights: { from: '2026-12-10', to: '2026-12-11' },
        occupancy: { adults: 2 },
      },
    });
    expect(quote.statusCode).toBe(404);
  });
});
