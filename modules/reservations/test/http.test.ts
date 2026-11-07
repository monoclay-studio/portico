import { createServer, type PorticoApp } from '@portico/http';
import { newId, staticAuthorizer } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reservationsHttp } from '../src/routes';
import { type Org, setupOrg, startDb } from './helpers';

/** HTTP contract: Zod validation, Idempotency-Key, ETag / If-Match, problem+json that explains recovery. */
let t: TestDatabase;
let org: Org;
let app: PorticoApp;
/** Stable user ids per test user (idempotency keys are bound to the actor). */
const userIds = new Map<string, string>();
beforeAll(async () => {
  t = await startDb();
  org = await setupOrg(t);
  app = await createServer({
    logger: false,
    rateLimit: false,
    openApi: { title: 'test', version: '1' },
    modules: [reservationsHttp({ database: t.db, service: org.svc })],
    authenticator: {
      async authenticate(req) {
        const name = req.headers['x-test-user'];
        if (typeof name !== 'string') return null;
        const grants =
          name === 'reader'
            ? [{ permission: 'reservations.booking.read', propertyIds: [org.propertyId] }]
            : [{ permission: '*', propertyIds: 'all' as const }];
        return {
          tenantId: org.tenantId,
          environment: 'live',
          actor: {
            kind: 'user',
            userId: userIds.get(name) ?? (userIds.set(name, newId()).get(name) as string),
            displayName: name,
          },
          authz: staticAuthorizer(grants),
        };
      },
    },
  });
});
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

const as = (user: string, extra: Record<string, string> = {}) => ({ 'x-test-user': user, ...extra });

describe('reservations HTTP API', () => {
  it('creates bookings idempotently and serves ETags', async () => {
    const payload = org.booking();
    const noKey = await app.inject({ method: 'POST', url: '/v1/bookings', headers: as('Aishath'), payload });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json()).toMatchObject({ code: 'idempotency_key_required' });
    const key = newId();
    const first = await app.inject({
      method: 'POST',
      url: '/v1/bookings',
      headers: as('Aishath', { 'idempotency-key': key }),
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(first.headers.etag).toBe('W/"1"');
    const retry = await app.inject({
      method: 'POST',
      url: '/v1/bookings',
      headers: as('Aishath', { 'idempotency-key': key }),
      payload,
    });
    expect(retry.json().id).toBe(first.json().id);
    const list = await app.inject({
      method: 'GET',
      url: `/v1/bookings?propertyId=${org.propertyId}`,
      headers: as('Aishath'),
    });
    expect(list.json().items).toHaveLength(1);
    const get = await app.inject({
      method: 'GET',
      url: `/v1/bookings/${first.json().id}`,
      headers: as('reader'),
    });
    expect(get.statusCode).toBe(200);
    expect(get.headers.etag).toBe('W/"1"');
    expect(get.json().stays[0].allowedActions.length).toBeGreaterThan(0);
  });

  it('returns 409 problem+json with what changed for a stale If-Match (S14), and 400 without If-Match', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/bookings',
      headers: as('Aishath', { 'idempotency-key': newId() }),
      payload: org.booking({}, { arrival: '2026-12-20', departure: '2026-12-22' }),
    });
    const id = created.json().id;
    const etag = created.headers.etag as string;
    const noMatch = await app.inject({
      method: 'PATCH',
      url: `/v1/bookings/${id}`,
      headers: as('Aishath'),
      payload: { notes: 'x' },
    });
    expect(noMatch.json()).toMatchObject({ code: 'if_match_required' });
    const a = await app.inject({
      method: 'PATCH',
      url: `/v1/bookings/${id}`,
      headers: as('Aishath', { 'if-match': etag }),
      payload: { notes: 'VIP arrival' },
    });
    expect(a.statusCode).toBe(200);
    expect(a.headers.etag).toBe('W/"2"');
    const b = await app.inject({
      method: 'PATCH',
      url: `/v1/bookings/${id}`,
      headers: as('Ibrahim', { 'if-match': etag }),
      payload: { tags: ['honeymoon'] },
    });
    expect(b.statusCode).toBe(409);
    expect(b.headers['content-type']).toContain('application/problem+json');
    expect(b.json()).toMatchObject({
      code: 'version_conflict',
      detail: expect.stringMatching(/changed by Aishath.*apply your edit again/),
      details: { currentVersion: 2, changes: [{ path: 'notes', from: null, to: 'VIP arrival' }] },
    });
  });

  it('previews and commits changes; a stale commit answers 409 preview_stale with a fresh preview', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/bookings',
      headers: as('Aishath', { 'idempotency-key': newId() }),
      payload: org.booking({}, { arrival: '2026-12-24', departure: '2026-12-26' }),
    });
    const stayId = created.json().stays[0].id;
    const preview = await app.inject({
      method: 'POST',
      url: '/v1/reservations/changes/preview',
      headers: as('Aishath'),
      payload: { kind: 'dates', stayId, arrival: '2026-12-24', departure: '2026-12-27' },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ feasible: true, kind: 'dates' });
    const token = preview.json().token;
    org.fakes.rates.setBase(org.propertyId, org.plans.bar, org.types.beach, 31_000);
    const stale = await app.inject({
      method: 'POST',
      url: '/v1/reservations/changes/commit',
      headers: as('Aishath', { 'idempotency-key': newId() }),
      payload: { previewToken: token },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: 'preview_stale',
      details: { freshPreview: { feasible: true } },
    });
    const fresh = stale.json().details.freshPreview.token;
    const key = newId();
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/reservations/changes/commit',
      headers: as('Aishath', { 'idempotency-key': key }),
      payload: { previewToken: fresh },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().booking.stays[0].departure).toBe('2026-12-27');
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/reservations/changes/commit',
      headers: as('Aishath', { 'idempotency-key': key }),
      payload: { previewToken: fresh },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().booking.version).toBe(ok.json().booking.version);
    org.fakes.rates.setBase(org.propertyId, org.plans.bar, org.types.beach, 30_000);
  });

  it('runs check-in, front-desk lists and channel ingestion over HTTP; denies writes without permission', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/bookings',
      headers: as('Aishath', { 'idempotency-key': newId() }),
      payload: org.booking({}, { unitId: org.units.V103 }),
    });
    const stayId = created.json().stays[0].id;
    const forbidden = await app.inject({
      method: 'POST',
      url: `/v1/stays/${stayId}/check-in`,
      headers: as('reader'),
      payload: {},
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().detail).toMatch(/reservations.stay.checkIn/);
    const checkIn = await app.inject({
      method: 'POST',
      url: `/v1/stays/${stayId}/check-in`,
      headers: as('Aishath'),
      payload: { registration: { identityVerified: true } },
    });
    expect(checkIn.statusCode).toBe(200);
    expect(checkIn.json().run.status).toBe('completed');
    const run = await app.inject({
      method: 'GET',
      url: `/v1/stays/${stayId}/check-in`,
      headers: as('reader'),
    });
    expect(run.json().summary.remaining).toEqual([]);
    const arrivals = await app.inject({
      method: 'GET',
      url: `/v1/front-desk/arrivals?propertyId=${org.propertyId}`,
      headers: as('reader'),
    });
    expect(arrivals.statusCode).toBe(200);
    const inHouse = await app.inject({
      method: 'GET',
      url: `/v1/front-desk/in-house?propertyId=${org.propertyId}`,
      headers: as('reader'),
    });
    expect(inHouse.json().items.map((r: { stayId: string }) => r.stayId)).toContain(stayId);
    const ingest = {
      connectionId: newId(),
      externalId: 'HTTP-1',
      revision: 1,
      payload: {
        status: 'confirmed',
        propertyId: org.propertyId,
        currency: 'USD',
        booker: { lastName: 'Bennett' },
        rooms: [
          {
            roomRef: 'R1',
            unitTypeId: org.types.overwater,
            ratePlanId: org.plans.bar,
            arrival: '2026-12-28',
            departure: '2026-12-29',
            adults: 2,
            guests: [],
            nightlyPrices: [{ date: '2026-12-28', amountMinor: 50_000 }],
          },
        ],
        guarantee: { kind: 'prepaid_channel' },
      },
    };
    const r1 = await app.inject({
      method: 'POST',
      url: '/v1/channel-bookings',
      headers: as('Channel hub'),
      payload: ingest,
    });
    const r2 = await app.inject({
      method: 'POST',
      url: '/v1/channel-bookings',
      headers: as('Channel hub'),
      payload: ingest,
    });
    expect([r1.json().outcome, r2.json().outcome]).toEqual(['created', 'duplicate']);
    const spec = await app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(Object.keys(spec.json().paths)).toEqual(
      expect.arrayContaining([
        '/v1/bookings',
        '/v1/reservations/changes/preview',
        '/v1/front-desk/arrivals',
        '/v1/handovers',
      ]),
    );
  });

  it('validates input with an explanation', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/bookings',
      headers: as('Aishath', { 'idempotency-key': newId() }),
      payload: { ...org.booking(), stays: [] },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('validation_failed');
  });
});
