import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemo } from '../src/seed/demo';
import { type ApiHarness, signedInOrg, startApi } from './helpers';

let h: ApiHarness;
beforeAll(async () => {
  h = await startApi();
});
afterAll(async () => h?.close());

type Headers = Record<string, string>;

async function property(auth: Headers, code = 'AZR') {
  const le = await h.app.inject({
    method: 'POST',
    url: '/v1/legal-entities',
    headers: { ...auth, 'idempotency-key': newId() },
    payload: {
      name: 'Azure Atoll',
      legalName: 'Azure Atoll Pvt Ltd',
      countryCode: 'MV',
      baseCurrency: 'USD',
    },
  });
  const prop = await h.app.inject({
    method: 'POST',
    url: '/v1/properties',
    headers: { ...auth, 'idempotency-key': newId() },
    payload: {
      code,
      name: 'Azure Atoll Resort',
      profile: 'resort',
      legalEntityId: le.json().id,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      businessDate: '2026-11-07',
    },
  });
  expect(prop.statusCode).toBe(201);
  return prop.json().id as string;
}

async function post(auth: Headers, url: string, payload: unknown, extra: Headers = {}) {
  return h.app.inject({
    method: 'POST',
    url,
    headers: { ...auth, 'idempotency-key': newId(), ...extra },
    payload: payload as object,
  });
}

async function villas(auth: Headers, propertyId: string, count = 3) {
  await post(auth, `/v1/properties/${propertyId}/unit-features`, {
    code: 'water_villa',
    name: 'Over water',
    category: 'location',
  });
  const type = await post(auth, `/v1/properties/${propertyId}/unit-types`, {
    code: 'WV',
    name: 'Water Villa',
    kind: 'villa',
    baseOccupancy: 2,
    maxAdults: 2,
    maxChildren: 1,
    maxOccupancy: 3,
    features: ['water_villa'],
  });
  expect(type.statusCode).toBe(201);
  const units: string[] = [];
  for (let i = 1; i <= count; i++) {
    const u = await post(auth, `/v1/properties/${propertyId}/units`, {
      unitTypeId: type.json().id,
      number: `W40${i}`,
      location: { building: 'Jetty A' },
      features: ['water_villa'],
    });
    expect(u.statusCode).toBe(201);
    units.push(u.json().id);
  }
  return { typeId: type.json().id as string, units };
}

describe('inventory HTTP API', () => {
  it('configures unit types and units with idempotent creates, ETags and If-Match', async () => {
    const { auth } = await signedInOrg(h);
    const propertyId = await property(auth);
    const { typeId } = await villas(auth, propertyId, 2);
    const key = newId();
    const body = { unitTypeId: typeId, number: 'W499' };
    const first = await post(auth, `/v1/properties/${propertyId}/units`, body, { 'idempotency-key': key });
    const retry = await post(auth, `/v1/properties/${propertyId}/units`, body, { 'idempotency-key': key });
    expect(first.statusCode).toBe(201);
    expect(retry.json().id).toBe(first.json().id);
    const list = await h.app.inject({
      method: 'GET',
      url: `/v1/properties/${propertyId}/units`,
      headers: auth,
    });
    expect(list.json().items).toHaveLength(3);

    const get = await h.app.inject({ method: 'GET', url: `/v1/unit-types/${typeId}`, headers: auth });
    expect(get.headers.etag).toBe('W/"1"');
    const noIfMatch = await h.app.inject({
      method: 'PATCH',
      url: `/v1/unit-types/${typeId}`,
      headers: auth,
      payload: { name: 'X' },
    });
    expect(noIfMatch.statusCode).toBe(400);
    const ok = await h.app.inject({
      method: 'PATCH',
      url: `/v1/unit-types/${typeId}`,
      headers: { ...auth, 'if-match': 'W/"1"' },
      payload: { name: 'Water Villa (renovated)' },
    });
    expect(ok.statusCode).toBe(200);
    const stale = await h.app.inject({
      method: 'PATCH',
      url: `/v1/unit-types/${typeId}`,
      headers: { ...auth, 'if-match': 'W/"1"' },
      payload: { name: 'Lost update' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'version_conflict', details: { currentVersion: 2 } });
  });

  it('returns unit records with status families, allowed actions with reasons, issues and links', async () => {
    const { auth } = await signedInOrg(h);
    const propertyId = await property(auth);
    const { typeId, units } = await villas(auth, propertyId, 2);
    const block = await post(auth, `/v1/properties/${propertyId}/unit-blocks`, {
      unitId: units[0],
      nights: { from: '2026-11-07', to: '2026-11-10' },
      kind: 'out_of_order',
      reason: 'Ladder repair',
    });
    expect(block.statusCode).toBe(201);
    const unit = await h.app.inject({ method: 'GET', url: `/v1/units/${units[0]}`, headers: auth });
    expect(unit.statusCode).toBe(200);
    const r = unit.json();
    expect(r.status).toEqual({ lifecycle: 'active', maintenance: 'out_of_order', assignment: 'unassigned' });
    expect(r.statusAsOf).toBe('2026-11-07');
    expect(r.allowedActions.find((a: { action: string }) => a.action === 'assign')).toMatchObject({
      enabled: false,
      reason: 'Out of order tonight: Ladder repair.',
    });
    expect(r.allowedActions.find((a: { action: string }) => a.action === 'placeOutOfOrder')).toMatchObject({
      enabled: true,
      previewRequired: true,
    });
    expect(r.issues[0]).toMatchObject({ code: 'unit_out_of_order', severity: 'warning' });
    expect(r.links).toContainEqual({ rel: 'unitType', type: 'unitType', id: typeId });
    const blockRecord = await h.app.inject({
      method: 'GET',
      url: `/v1/unit-blocks/${block.json().block.id}`,
      headers: auth,
    });
    expect(blockRecord.json().status).toEqual({ block: 'active', phase: 'in_effect' });
  });

  it('serves the availability grid and explanations, previews and places blocks, releases with If-Match', async () => {
    const { auth } = await signedInOrg(h);
    const propertyId = await property(auth);
    const { typeId, units } = await villas(auth, propertyId, 2);
    const grid = await h.app.inject({
      method: 'GET',
      url: `/v1/properties/${propertyId}/availability?from=2026-11-10&to=2026-11-12&unitTypeIds=${typeId}`,
      headers: auth,
    });
    expect(grid.statusCode).toBe(200);
    expect(grid.json()).toMatchObject({ provenance: 'live', authority: { authority: 'portico' } });
    expect(grid.json().cells).toHaveLength(2);
    expect(grid.json().cells[0]).toMatchObject({ capacity: 2, available: 2, status: 'available' });

    const preview = await post(auth, `/v1/properties/${propertyId}/unit-blocks/preview`, {
      unitId: units[1],
      nights: { from: '2026-11-10', to: '2026-11-12' },
      kind: 'out_of_order',
      reason: 'Hammock net replacement',
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().availabilityAfter[0]).toMatchObject({ outOfOrder: 1, available: 1 });
    // the preview committed nothing
    const still = await h.app.inject({
      method: 'GET',
      url: `/v1/properties/${propertyId}/availability?from=2026-11-10&to=2026-11-11`,
      headers: auth,
    });
    expect(still.json().cells[0].outOfOrder).toBe(0);

    const placed = await post(auth, `/v1/properties/${propertyId}/unit-blocks`, {
      unitId: units[1],
      nights: { from: '2026-11-10', to: '2026-11-12' },
      kind: 'out_of_order',
      reason: 'Hammock net replacement',
    });
    expect(placed.statusCode).toBe(201);
    const why = await h.app.inject({
      method: 'GET',
      url: `/v1/properties/${propertyId}/availability/explanation?unitTypeId=${typeId}&date=2026-11-10`,
      headers: auth,
    });
    expect(why.json().reasons.join(' ')).toContain('Hammock net replacement');
    const blockId = placed.json().block.id;
    const release = await h.app.inject({
      method: 'POST',
      url: `/v1/unit-blocks/${blockId}/release`,
      headers: { ...auth, 'idempotency-key': newId(), 'if-match': 'W/"1"' },
      payload: { reason: 'Done early' },
    });
    expect(release.statusCode).toBe(200);
    expect(release.json()).toMatchObject({ status: { block: 'released' }, releaseReason: 'Done early' });

    const history = await h.app.inject({
      method: 'GET',
      url: `/v1/records/unitBlock/${blockId}/history`,
      headers: auth,
    });
    expect(history.json().items.map((i: { action: string }) => i.action)).toEqual([
      'inventory.unitBlock.create',
      'inventory.unitBlock.release',
    ]);
  });

  it('authorizes overbooking and lists conflicts with problem+json on validation errors', async () => {
    const { auth } = await signedInOrg(h);
    const propertyId = await property(auth);
    const { typeId } = await villas(auth, propertyId, 1);
    const ob = await post(auth, `/v1/properties/${propertyId}/overbooking-allowances`, {
      unitTypeId: typeId,
      nights: { from: '2026-12-24', to: '2026-12-26' },
      quantity: 1,
      reason: 'Festive season no-show history',
    });
    expect(ob.statusCode).toBe(201);
    expect(ob.json().allowances).toHaveLength(2);
    const grid = await h.app.inject({
      method: 'GET',
      url: `/v1/properties/${propertyId}/availability?from=2026-12-24&to=2026-12-25`,
      headers: auth,
    });
    expect(grid.json().cells[0]).toMatchObject({ overbookingAllowance: 1, available: 2 });
    const bad = await post(auth, `/v1/properties/${propertyId}/overbooking-allowances`, {
      unitTypeId: typeId,
      nights: { from: '2026-12-26', to: '2026-12-24' },
      quantity: 1,
      reason: 'Backwards',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.headers['content-type']).toContain('application/problem+json');
    expect(bad.json().code).toBe('invalid_night_range');
    const conflicts = await h.app.inject({
      method: 'GET',
      url: `/v1/properties/${propertyId}/inventory-conflicts`,
      headers: auth,
    });
    expect(conflicts.json().items).toEqual([]);
  });

  it('finds units in global search, previews them, and isolates organizations', async () => {
    const a = await signedInOrg(h, 'Org A');
    const b = await signedInOrg(h, 'Org B');
    const propertyId = await property(a.auth);
    const { units } = await villas(a.auth, propertyId, 2);
    const search = await h.app.inject({ method: 'GET', url: '/v1/search?q=W40', headers: a.auth });
    expect(search.statusCode).toBe(200);
    expect(search.json().items.filter((i: { type: string }) => i.type === 'unit')).toHaveLength(2);
    const summary = await h.app.inject({
      method: 'GET',
      url: `/v1/records/unit/${units[0]}/summary`,
      headers: a.auth,
    });
    expect(summary.json()).toMatchObject({ type: 'unit', title: 'Water Villa W401' });

    // Another organization cannot see or touch these records, even with the ids.
    expect(
      (await h.app.inject({ method: 'GET', url: `/v1/units/${units[0]}`, headers: b.auth })).statusCode,
    ).toBe(404);
    expect(
      (await h.app.inject({ method: 'GET', url: '/v1/search?q=W40', headers: b.auth })).json().items,
    ).toEqual([]);
    const foreignBlock = await post(b.auth, `/v1/properties/${propertyId}/unit-blocks`, {
      unitId: units[0],
      nights: { from: '2026-11-10', to: '2026-11-11' },
      kind: 'out_of_order',
      reason: 'Should not work',
    });
    expect(foreignBlock.statusCode).toBe(404);
    const grid = await h.app.inject({
      method: 'GET',
      url: `/v1/properties/${propertyId}/availability?from=2026-11-10&to=2026-11-11`,
      headers: b.auth,
    });
    expect(grid.json().cells).toEqual([]);
  });

  it('seeds realistic Maldives demo inventory through the registered demo seed step', async () => {
    {
      const orgs = await seedDemo(h.t.db, { businessDate: '2026-11-07' });
      const guesthouse = orgs[0];
      const group = orgs[1];
      const admin = async (email: string | undefined) => {
        const login = await h.app.inject({
          method: 'POST',
          url: '/v1/auth/login',
          payload: { email, password: 'portico-demo-2026' },
        });
        return { authorization: `Bearer ${login.json().token}` };
      };
      const gh = await admin(guesthouse?.users[0]?.email);
      const ghUnits = await h.app.inject({
        method: 'GET',
        url: `/v1/properties/${guesthouse?.properties[0]?.id}/units`,
        headers: gh,
      });
      expect(ghUnits.json().items).toHaveLength(12);
      const grp = await admin(group?.users[0]?.email);
      const resort = group?.properties.find((p) => p.profile === 'resort');
      const resortUnits = (
        await h.app.inject({ method: 'GET', url: `/v1/properties/${resort?.id}/units`, headers: grp })
      ).json().items as Array<{ isComposite: boolean; componentUnitIds: string[] }>;
      expect(resortUnits.filter((u) => !u.isComposite)).toHaveLength(120);
      expect(resortUnits.filter((u) => u.isComposite).map((u) => u.componentUnitIds.length)).toEqual([2, 2]);
      const grid = await h.app.inject({
        method: 'GET',
        url: `/v1/properties/${resort?.id}/availability?from=2026-11-07&to=2026-11-08`,
        headers: grp,
      });
      const cells = grid.json().cells as Array<{ capacity: number; outOfOrder: number; composite: unknown }>;
      expect(cells.reduce((s, c) => s + (c.composite ? 0 : c.capacity), 0)).toBe(120);
      expect(cells.reduce((s, c) => s + c.outOfOrder, 0)).toBe(1);
      expect(grid.json().houseTotals[0]).toMatchObject({ capacity: 120, outOfOrder: 1 });
    }
  });
});
