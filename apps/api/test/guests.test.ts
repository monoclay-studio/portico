/**
 * Guests HTTP end-to-end: contracts, Idempotency-Key replay, ETag / If-Match, problem+json, permission-aware
 * search, audited document reveal, merge → unmerge over HTTP, global search / record history, privacy export and
 * cross-organization isolation.
 */
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiHarness, signedInOrg, startApi } from './helpers';

let h: ApiHarness;
beforeAll(async () => {
  h = await startApi();
});
afterAll(async () => h?.close());

async function orgWithProperty(name = 'Lagoon Resorts') {
  const org = await signedInOrg(h, name);
  const le = await h.app.inject({
    method: 'POST',
    url: '/v1/legal-entities',
    headers: { ...org.auth, 'idempotency-key': newId() },
    payload: { name, legalName: `${name} Pvt Ltd`, countryCode: 'MV', baseCurrency: 'USD' },
  });
  const prop = await h.app.inject({
    method: 'POST',
    url: '/v1/properties',
    headers: { ...org.auth, 'idempotency-key': newId() },
    payload: {
      code: `R${newId().slice(-5).toUpperCase()}`,
      name: `${name} Island`,
      profile: 'resort',
      legalEntityId: le.json().id,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      businessDate: '2026-11-07',
    },
  });
  expect(prop.statusCode).toBe(201);
  return { ...org, propertyId: prop.json().id as string };
}

const post = (url: string, auth: Record<string, string>, payload: unknown, key: string | null = newId()) =>
  h.app.inject({
    method: 'POST',
    url,
    headers: { ...auth, ...(key ? { 'idempotency-key': key } : {}) },
    payload: payload as object,
  });

describe('guests over HTTP', () => {
  it('creates profiles idempotently and returns the universal record contract', async () => {
    const org = await orgWithProperty();
    const payload = {
      propertyId: org.propertyId,
      nativeGivenName: 'Анна',
      nativeFamilyName: 'Смирнова',
      language: 'ru',
      contactPoints: [{ kind: 'email', value: 'anna.smirnova@guest.example' }],
    };
    const noKey = await post('/v1/guests/profiles', org.auth, payload, null);
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().code).toBe('idempotency_key_required');
    const key = newId();
    const first = await post('/v1/guests/profiles', org.auth, payload, key);
    expect(first.statusCode).toBe(201);
    const retry = await post('/v1/guests/profiles', org.auth, payload, key);
    expect(retry.json().profile.id).toBe(first.json().profile.id);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    const body = first.json();
    expect(body.profile).toMatchObject({
      givenName: 'Anna',
      familyName: 'Smirnova',
      status: { profile: 'active', privacy: 'normal' },
      allowedActions: expect.arrayContaining([expect.objectContaining({ action: 'edit', enabled: true })]),
    });
    expect(first.headers.etag).toBe(`W/"${body.profile.version}"`);
  });

  it('validates input with an explanation and enforces If-Match on updates', async () => {
    const org = await orgWithProperty();
    const bad = await post('/v1/guests/profiles', org.auth, {
      propertyId: org.propertyId,
      nationality: 'Russia',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('validation_failed');
    const created = await post('/v1/guests/profiles', org.auth, {
      propertyId: org.propertyId,
      givenName: 'Lukas',
      familyName: 'Müller',
    });
    const id = created.json().profile.id;
    const get = await h.app.inject({ method: 'GET', url: `/v1/guests/profiles/${id}`, headers: org.auth });
    const etag = get.headers.etag as string;
    const noMatch = await h.app.inject({
      method: 'PATCH',
      url: `/v1/guests/profiles/${id}`,
      headers: org.auth,
      payload: { vipLevel: 'vip1' },
    });
    expect(noMatch.json().code).toBe('if_match_required');
    const ok = await h.app.inject({
      method: 'PATCH',
      url: `/v1/guests/profiles/${id}`,
      headers: { ...org.auth, 'if-match': etag },
      payload: { vipLevel: 'vip1' },
    });
    expect(ok.statusCode).toBe(200);
    const stale = await h.app.inject({
      method: 'PATCH',
      url: `/v1/guests/profiles/${id}`,
      headers: { ...org.auth, 'if-match': etag },
      payload: { vipLevel: 'vip2' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.headers['content-type']).toContain('application/problem+json');
    expect(stale.json()).toMatchObject({
      code: 'version_conflict',
      details: { currentVersion: ok.json().version },
    });
  });

  it('search, document reveal (audited, no-store) and global search / history', async () => {
    const org = await orgWithProperty();
    const created = await post('/v1/guests/profiles', org.auth, {
      propertyId: org.propertyId,
      givenName: 'Wei',
      familyName: 'Wang',
      nativeGivenName: '伟',
      nativeFamilyName: '王',
      contactPoints: [{ kind: 'phone', value: '+86 138 0013 8000' }],
    });
    const id = created.json().profile.id;
    const search = await h.app.inject({
      method: 'GET',
      url: `/v1/guests/search?q=${encodeURIComponent('王伟')}`,
      headers: org.auth,
    });
    expect(search.json().items.map((i: { profileId: string }) => i.profileId)).toContain(id);
    const doc = await post(`/v1/guests/profiles/${id}/documents`, org.auth, {
      propertyId: org.propertyId,
      type: 'passport',
      issuingCountry: 'CN',
      number: 'E12345678',
    });
    expect(doc.statusCode).toBe(201);
    const reveal = await h.app.inject({
      method: 'POST',
      url: `/v1/guests/documents/${doc.json().documentId}/reveal`,
      headers: org.auth,
      payload: { reason: 'Immigration form' },
    });
    expect(reveal.statusCode).toBe(200);
    expect(reveal.headers['cache-control']).toBe('no-store');
    expect(reveal.json().number).toBe('E12345678');
    const global = await h.app.inject({ method: 'GET', url: '/v1/search?q=Wang%20Wei', headers: org.auth });
    expect(global.json().items).toContainEqual(
      expect.objectContaining({ type: 'guest_profile', id, label: 'Guest', route: `/guests/profiles/${id}` }),
    );
    const history = await h.app.inject({
      method: 'GET',
      url: `/v1/records/guest_profile/${id}/history`,
      headers: org.auth,
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().items.map((i: { action: string }) => i.action)).toContain('guests.profile.create');
    expect(history.body).not.toContain('E12345678');
  });

  it('merge and unmerge over HTTP (scenario S15 path)', async () => {
    const org = await orgWithProperty();
    const mk = async (dob: string, nat: string) =>
      (
        await post('/v1/guests/profiles', org.auth, {
          propertyId: org.propertyId,
          givenName: 'Ahmed',
          familyName: 'Ali',
          dateOfBirth: dob,
          nationality: nat,
          matchStrategy: 'create_new',
        })
      ).json().profile.id as string;
    const a = await mk('1980-03-01', 'AE');
    const b = await mk('1992-11-20', 'SA');
    const preview = await h.app.inject({
      method: 'POST',
      url: '/v1/guests/merges/preview',
      headers: org.auth,
      payload: { survivorId: a, mergedId: b },
    });
    expect(preview.json().warnings.join(' ')).toMatch(/different dates of birth/);
    const merge = await post('/v1/guests/merges', org.auth, {
      survivorId: a,
      mergedId: b,
      reason: 'Assumed same guest',
    });
    expect(merge.statusCode).toBe(201);
    const mergeId = merge.json().id;
    const resolved = await h.app.inject({
      method: 'GET',
      url: `/v1/guests/profiles/${b}`,
      headers: org.auth,
    });
    expect(resolved.json()).toMatchObject({ id: a, resolvedFrom: [b] });
    const up = await h.app.inject({
      method: 'GET',
      url: `/v1/guests/merges/${mergeId}/unmerge-preview`,
      headers: org.auth,
    });
    expect(up.json()).toMatchObject({ canUnmerge: true });
    const unmerge = await post(`/v1/guests/merges/${mergeId}/unmerge`, org.auth, {
      reason: 'Different guests',
    });
    expect(unmerge.statusCode).toBe(200);
    expect(unmerge.json()).toMatchObject({ status: 'reversed' });
    const back = await h.app.inject({ method: 'GET', url: `/v1/guests/profiles/${b}`, headers: org.auth });
    expect(back.json()).toMatchObject({ id: b, nationality: 'SA' });
  });

  it('privacy export is a request record; the data is downloaded separately and never stored', async () => {
    const org = await orgWithProperty();
    const id = (
      await post('/v1/guests/profiles', org.auth, {
        propertyId: org.propertyId,
        givenName: 'Priya',
        familyName: 'Sharma',
      })
    ).json().profile.id;
    const req = await post('/v1/guests/privacy-requests', org.auth, {
      kind: 'export',
      profileId: id,
      reason: 'Access request',
    });
    expect(req.statusCode).toBe(201);
    expect(req.body).not.toContain('Priya');
    const dl = await h.app.inject({
      method: 'GET',
      url: `/v1/guests/privacy-requests/${req.json().id}/export`,
      headers: org.auth,
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.json().profile.givenName).toBe('Priya');
    expect(dl.headers['cache-control']).toBe('no-store');
  });

  it('scenario S17: another organization cannot read, search or modify a guest — even with the id', async () => {
    const victim = await orgWithProperty('Victim Resort');
    const attacker = await orgWithProperty('Other Hotel');
    const id = (
      await post('/v1/guests/profiles', victim.auth, {
        propertyId: victim.propertyId,
        givenName: 'Victoria',
        familyName: 'Stone',
        contactPoints: [{ kind: 'email', value: 'victoria.stone@guest.example' }],
      })
    ).json().profile.id;
    const read = await h.app.inject({
      method: 'GET',
      url: `/v1/guests/profiles/${id}`,
      headers: attacker.auth,
    });
    expect(read.statusCode).toBe(404);
    const search = await h.app.inject({
      method: 'GET',
      url: '/v1/guests/search?q=victoria.stone%40guest.example',
      headers: attacker.auth,
    });
    expect(search.json().items).toHaveLength(0);
    const global = await h.app.inject({
      method: 'GET',
      url: '/v1/search?q=Victoria%20Stone',
      headers: attacker.auth,
    });
    expect(global.json().items.filter((i: { id: string }) => i.id === id)).toHaveLength(0);
    const note = await post(`/v1/guests/profiles/${id}/notes`, attacker.auth, {
      visibility: 'shared',
      body: 'pwned',
    });
    expect(note.statusCode).toBe(404);
    const summary = await h.app.inject({
      method: 'GET',
      url: `/v1/records/guest_profile/${id}/summary`,
      headers: attacker.auth,
    });
    expect(summary.statusCode).toBe(404);
  });
});
