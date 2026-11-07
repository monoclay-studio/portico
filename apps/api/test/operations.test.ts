/**
 * Operations over HTTP: problem+json errors with recovery, Idempotency-Key on creates, ETag/If-Match on
 * versioned records, the universal record contract, offline sync, global search and record history,
 * and tenant isolation through the real authentication stack.
 */
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiHarness, signedInOrg, startApi } from './helpers';

let h: ApiHarness;
beforeAll(async () => {
  h = await startApi();
});
afterAll(async () => h?.close());

async function resort(auth: Record<string, string>, code: string) {
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
  const propertyId = prop.json().id as string;
  const post = (url: string, payload: unknown) =>
    h.app.inject({
      method: 'POST',
      url,
      headers: { ...auth, 'idempotency-key': newId() },
      payload: payload as object,
    });
  expect(
    (
      await post(`/v1/operations/properties/${propertyId}/sections`, {
        code: 'JA',
        name: 'Jetty A',
        kind: 'jetty',
      })
    ).statusCode,
  ).toBe(201);
  const unitId = newId();
  const units = await post(`/v1/operations/properties/${propertyId}/units`, {
    units: [{ unitId, number: 'A101', sectionCode: 'JA', unitTypeCode: 'WATER-VILLA' }],
  });
  expect(units.json()).toEqual({ created: 1, updated: 0 });
  return { propertyId, unitId, post };
}

describe('operations HTTP API', () => {
  it('serves the board and unit records with the universal record contract and ETags', async () => {
    const { auth } = await signedInOrg(h);
    const { propertyId, unitId } = await resort(auth, 'OPS1');
    const board = await h.app.inject({
      method: 'GET',
      url: `/v1/operations/properties/${propertyId}/board`,
      headers: auth,
    });
    expect(board.statusCode).toBe(200);
    expect(board.json().rows[0].unit).toMatchObject({
      unitNumber: 'A101',
      condition: 'dirty',
      occupancy: 'vacant',
    });
    const unit = await h.app.inject({ method: 'GET', url: `/v1/operations/units/${unitId}`, headers: auth });
    expect(unit.headers.etag).toBe('W/"1"');
    expect(unit.json()).toMatchObject({
      status: { condition: 'dirty', occupancy: 'vacant', readiness: 'not_ready' },
      allowedActions: expect.arrayContaining([
        expect.objectContaining({ action: 'startCleaning', enabled: true }),
        expect.objectContaining({ action: 'returnToService', enabled: false, reason: expect.any(String) }),
      ]),
      owner: { kind: 'department' },
      links: [expect.objectContaining({ rel: 'unit', id: unitId })],
    });

    // If-Match is required, stale versions get 409 with the current version.
    const noMatch = await h.app.inject({
      method: 'POST',
      url: `/v1/operations/units/${unitId}/condition`,
      headers: auth,
      payload: { condition: 'cleaning' },
    });
    expect(noMatch.statusCode).toBe(400);
    expect(noMatch.json().code).toBe('if_match_required');
    const ok = await h.app.inject({
      method: 'POST',
      url: `/v1/operations/units/${unitId}/condition`,
      headers: { ...auth, 'if-match': 'W/"1"' },
      payload: { condition: 'cleaning' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers.etag).toBe('W/"2"');
    expect(ok.json()).toMatchObject({ pending: false, unit: { condition: 'cleaning' } });
    const stale = await h.app.inject({
      method: 'POST',
      url: `/v1/operations/units/${unitId}/condition`,
      headers: { ...auth, 'if-match': 'W/"1"' },
      payload: { condition: 'clean' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.headers['content-type']).toContain('application/problem+json');
    expect(stale.json()).toMatchObject({ code: 'version_conflict', details: { currentVersion: 2 } });
    const invalid = await h.app.inject({
      method: 'POST',
      url: `/v1/operations/units/${unitId}/condition`,
      headers: { ...auth, 'if-match': 'W/"2"' },
      payload: { condition: 'inspected' },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({
      code: 'inspection_required',
      detail: expect.stringContaining('inspection'),
    });
  });

  it('service requests: idempotent create, done only through the task, search and history', async () => {
    const { auth } = await signedInOrg(h);
    const { propertyId, unitId } = await resort(auth, 'OPS2');
    const payload = {
      propertyId,
      unitId,
      channel: 'phone',
      category: 'Amenities',
      description: 'Baby cot for tonight',
    };
    const missingKey = await h.app.inject({
      method: 'POST',
      url: '/v1/operations/service-requests',
      headers: auth,
      payload,
    });
    expect(missingKey.json().code).toBe('idempotency_key_required');
    const key = newId();
    const first = await h.app.inject({
      method: 'POST',
      url: '/v1/operations/service-requests',
      headers: { ...auth, 'idempotency-key': key },
      payload,
    });
    const retry = await h.app.inject({
      method: 'POST',
      url: '/v1/operations/service-requests',
      headers: { ...auth, 'idempotency-key': key },
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(retry.json().id).toBe(first.json().id);
    const sr = first.json();
    expect(sr.status).toEqual({ serviceRequest: 'open', task: 'open', sla: 'on_track' });
    const list = await h.app.inject({
      method: 'GET',
      url: `/v1/operations/service-requests?propertyId=${propertyId}`,
      headers: auth,
    });
    expect(list.json().items).toHaveLength(1);

    const done = await h.app.inject({
      method: 'POST',
      url: `/v1/operations/tasks/${sr.task.id}/transitions`,
      headers: { ...auth, 'if-match': `W/"${sr.task.version}"` },
      payload: { to: 'done' },
    });
    expect(done.statusCode).toBe(200);
    const after = await h.app.inject({
      method: 'GET',
      url: `/v1/operations/service-requests/${sr.id}`,
      headers: auth,
    });
    expect(after.json().status.serviceRequest).toBe('fulfilled');

    const search = await h.app.inject({ method: 'GET', url: `/v1/search?q=${sr.number}`, headers: auth });
    expect(search.statusCode).toBe(200);
    expect(search.json().items[0]).toMatchObject({
      type: 'service_request',
      id: sr.id,
      label: 'Service request',
    });
    const history = await h.app.inject({
      method: 'GET',
      url: `/v1/records/task/${sr.task.id}/history`,
      headers: auth,
    });
    expect(history.statusCode).toBe(200);
    expect(JSON.stringify(history.json())).toContain('operations.task.transition');
  });

  it('offline sync batch and delta pull over HTTP; inventory-dependent actions explain they are unavailable', async () => {
    const { auth } = await signedInOrg(h);
    const { propertyId, unitId, post } = await resort(auth, 'OPS3');
    const pull = await h.app.inject({
      method: 'GET',
      url: `/v1/operations/sync/changes?propertyId=${propertyId}`,
      headers: auth,
    });
    expect(pull.statusCode).toBe(200);
    const cursor = pull.json().cursor as string;
    const sync = await h.app.inject({
      method: 'POST',
      url: '/v1/operations/sync/mutations',
      headers: auth,
      payload: {
        propertyId,
        deviceId: 'ipad-1',
        mutations: [
          {
            clientMutationId: `m-${newId()}`,
            clientTimestamp: new Date().toISOString(),
            op: 'unit.setCondition',
            unitId,
            baseVersion: 1,
            condition: 'clean',
          },
        ],
      },
    });
    expect(sync.statusCode).toBe(200);
    expect(sync.json().results[0]).toMatchObject({ status: 'applied', resultVersion: 2 });
    const delta = await h.app.inject({
      method: 'GET',
      url: `/v1/operations/sync/changes?propertyId=${propertyId}&cursor=${encodeURIComponent(cursor)}`,
      headers: auth,
    });
    expect(delta.json().units.map((u: { condition: string }) => u.condition)).toEqual(['clean']);

    // Taking a unit out of order needs inventory, which is not bound in this build: the fault report is kept
    // (ADR-0015 §6) with the refusal and the next step — never lost, never shown as blocked.
    const wo = await post('/v1/operations/work-orders', {
      propertyId,
      unitId,
      title: 'AC leaking',
      faultCategory: 'hvac',
      urgency: 'high',
      block: { kind: 'out_of_order', from: '2026-11-07', to: '2026-11-08', reason: 'AC leak' },
    });
    expect(wo.statusCode).toBe(201);
    expect(wo.json().block).toMatchObject({ status: 'refused', refusal: { code: 'module_unavailable' } });
    expect(wo.json().issues.map((i: { code: string }) => i.code)).toContain('block_refused');
    const plain = await post('/v1/operations/work-orders', {
      propertyId,
      unitId,
      title: 'Squeaky door',
      faultCategory: 'carpentry',
    });
    expect(plain.statusCode).toBe(201);
    expect(
      plain.json().allowedActions.find((a: { action: string }) => a.action === 'takeOutOfOrder'),
    ).toBeDefined();
  });

  it('another organization cannot reach operations records (scenario 17)', async () => {
    const victim = await signedInOrg(h, 'Victim');
    const { unitId, propertyId } = await resort(victim.auth, 'OPS4');
    const attacker = await signedInOrg(h, 'Attacker');
    const read = await h.app.inject({
      method: 'GET',
      url: `/v1/operations/units/${unitId}`,
      headers: attacker.auth,
    });
    expect(read.statusCode).toBe(404);
    const write = await h.app.inject({
      method: 'POST',
      url: `/v1/operations/units/${unitId}/condition`,
      headers: { ...attacker.auth, 'if-match': 'W/"1"' },
      payload: { condition: 'cleaning' },
    });
    expect(write.statusCode).toBe(404);
    const tasks = await h.app.inject({
      method: 'GET',
      url: `/v1/operations/tasks?propertyId=${propertyId}`,
      headers: attacker.auth,
    });
    expect(tasks.json().items).toEqual([]);
    const spec = await h.app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(spec.json().paths['/v1/operations/sync/mutations']).toBeDefined();
  });
});
