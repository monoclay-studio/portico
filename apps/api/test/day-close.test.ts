/**
 * Day Close over HTTP through the composed app (real platform, identity, reservations, finance, inventory,
 * operations, integration and payments bindings; stubs where a provider function is missing — README § Contract
 * requests): readiness, start with Idempotency-Key (a retry returns the same run), ETag / If-Match, problem+json,
 * the day report, policy, global search and record history.
 */
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiHarness, signedInOrg, startApi } from './helpers';

let h: ApiHarness;
beforeAll(async () => {
  h = await startApi();
});
afterAll(async () => h?.close());

async function setup() {
  const org = await signedInOrg(h, 'Hiyani Guesthouse');
  const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
    h.app.inject({
      method: 'POST',
      url,
      headers: { ...org.auth, 'idempotency-key': newId(), ...headers },
      payload: payload as object,
    });
  const le = await post('/v1/legal-entities', {
    name: 'Hiyani',
    legalName: 'Hiyani Guesthouse Pvt Ltd',
    taxId: 'GST-77',
    countryCode: 'MV',
    baseCurrency: 'USD',
    address: { line1: 'Maafushi' },
  });
  const prop = await post('/v1/properties', {
    code: `H${newId().slice(-5).toUpperCase()}`,
    name: 'Hiyani Guesthouse',
    profile: 'guesthouse',
    legalEntityId: le.json().id,
    countryCode: 'MV',
    timezone: 'Indian/Maldives',
    baseCurrency: 'USD',
    businessDate: '2026-11-07',
  });
  expect(prop.statusCode).toBe(201);
  return { ...org, post, propertyId: prop.json().id as string };
}

describe('Day Close over HTTP', () => {
  it('readiness, start (idempotent), run with ETag, resume needs If-Match, report, policy, search, history', async () => {
    const org = await setup();
    const ready = await h.app.inject({
      method: 'GET',
      url: `/v1/day-close/properties/${org.propertyId}/readiness`,
      headers: org.auth,
    });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ businessDate: '2026-11-07', canClose: true, blocking: [] });

    // Start without an Idempotency-Key: refused, explained.
    const noKey = await h.app.inject({
      method: 'POST',
      url: `/v1/day-close/properties/${org.propertyId}/runs`,
      headers: org.auth,
      payload: {},
    });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(noKey.json().code).toBe('idempotency_key_required');

    const key = newId();
    const start = await org.post(
      `/v1/day-close/properties/${org.propertyId}/runs`,
      {},
      { 'idempotency-key': key },
    );
    expect(start.statusCode).toBe(201);
    const run = start.json();
    expect(run.runStatus).toBe('completed');
    expect(run.steps).toHaveLength(9);
    expect(start.headers.etag).toBe(`W/"${run.version}"`);
    // A retried start (same key) returns the same run, never a second one.
    const retry = await org.post(
      `/v1/day-close/properties/${org.propertyId}/runs`,
      {},
      { 'idempotency-key': key },
    );
    expect(retry.json().id).toBe(run.id);

    const prop = await h.app.inject({
      method: 'GET',
      url: `/v1/properties/${org.propertyId}`,
      headers: org.auth,
    });
    expect(prop.json().businessDate).toBe('2026-11-08');

    const get = await h.app.inject({ method: 'GET', url: `/v1/day-close/runs/${run.id}`, headers: org.auth });
    expect(get.statusCode).toBe(200);
    expect(get.headers.etag).toBe(`W/"${get.json().version}"`);
    const resume = await h.app.inject({
      method: 'POST',
      url: `/v1/day-close/runs/${run.id}/resume`,
      headers: org.auth,
      payload: {},
    });
    expect(resume.statusCode).toBe(400);
    expect(resume.json().code).toBe('if_match_required');
    const resume2 = await h.app.inject({
      method: 'POST',
      url: `/v1/day-close/runs/${run.id}/resume`,
      headers: { ...org.auth, 'if-match': get.headers.etag as string },
      payload: {},
    });
    expect(resume2.statusCode).toBe(422);
    expect(resume2.json().code).toBe('run_not_active');

    const report = await h.app.inject({
      method: 'GET',
      url: `/v1/day-close/properties/${org.propertyId}/days/2026-11-07/report`,
      headers: org.auth,
    });
    expect(report.statusCode).toBe(200);
    expect(report.json().pack.trialBalance.balanced).toBe(true);

    const policy = await h.app.inject({
      method: 'GET',
      url: `/v1/day-close/properties/${org.propertyId}/policy`,
      headers: org.auth,
    });
    expect(policy.statusCode).toBe(200);
    const put = await h.app.inject({
      method: 'PUT',
      url: `/v1/day-close/properties/${org.propertyId}/policy`,
      headers: { ...org.auth, 'if-match': policy.headers.etag as string },
      payload: {
        policy: { schedule: { enabled: true, localTime: '23:30', autoContinue: true } },
        reason: 'Guesthouse closes itself at 23:30',
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().policy.schedule).toEqual({ enabled: true, localTime: '23:30', autoContinue: true });
    const stale = await h.app.inject({
      method: 'PUT',
      url: `/v1/day-close/properties/${org.propertyId}/policy`,
      headers: { ...org.auth, 'if-match': policy.headers.etag as string },
      payload: { policy: {}, reason: 'stale' },
    });
    expect(stale.statusCode).toBe(409);

    const search = await h.app.inject({ method: 'GET', url: '/v1/search?q=2026-11-07', headers: org.auth });
    expect(search.statusCode).toBe(200);
    expect(JSON.stringify(search.json())).toContain(run.id);
    const history = await h.app.inject({
      method: 'GET',
      url: `/v1/records/day_close_run/${run.id}/history`,
      headers: org.auth,
    });
    expect(history.statusCode).toBe(200);
    expect(JSON.stringify(history.json())).toContain('dayClose.run.complete');

    const missing = await h.app.inject({
      method: 'GET',
      url: `/v1/day-close/runs/${newId()}`,
      headers: org.auth,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toMatch(/application\/problem\+json/);
  });

  it('another organization cannot read the run or the readiness of a property it does not have', async () => {
    const a = await setup();
    const b = await signedInOrg(h, 'Other Org');
    const start = await a.post(`/v1/day-close/properties/${a.propertyId}/runs`, {});
    const runId = start.json().id as string;
    const read = await h.app.inject({ method: 'GET', url: `/v1/day-close/runs/${runId}`, headers: b.auth });
    expect(read.statusCode).toBe(404);
    const ready = await h.app.inject({
      method: 'GET',
      url: `/v1/day-close/properties/${a.propertyId}/readiness`,
      headers: b.auth,
    });
    expect([403, 404]).toContain(ready.statusCode);
  });
});
