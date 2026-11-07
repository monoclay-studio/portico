/**
 * SW-GUE-1 regression (fix re-attack sweep): after a guest is erased, no stored idempotent response may still hold
 * their personal data, and replaying any earlier request must not return it. One test per sibling entry point
 * (every guests endpoint that stores an idempotent response), plus merge-then-erasure, export-after-erasure,
 * global search and response caching. The sweep's PoC is the first test.
 */
import { sql } from '@portico/db';
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiHarness, signedInOrg, startApi } from './helpers';

let h: ApiHarness;
beforeAll(async () => {
  h = await startApi();
});
afterAll(async () => h?.close());

const PII =
  /Quilla|Erasemeplease|erasemeplease|1981-02-03|\+9607771234|777 1234|Buckwheat|lagoon villa|Shellfish|QX123456/;

async function orgWithProperty() {
  const org = await signedInOrg(h, 'Sweep Resorts');
  const le = await h.app.inject({
    method: 'POST',
    url: '/v1/legal-entities',
    headers: { ...org.auth, 'idempotency-key': newId() },
    payload: { name: 'Sweep', legalName: 'Sweep Pvt Ltd', countryCode: 'MV', baseCurrency: 'USD' },
  });
  const prop = await h.app.inject({
    method: 'POST',
    url: '/v1/properties',
    headers: { ...org.auth, 'idempotency-key': newId() },
    payload: {
      code: `S${newId().slice(-5).toUpperCase()}`,
      name: 'Sweep Island',
      profile: 'resort',
      legalEntityId: le.json().id,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      businessDate: '2026-11-07',
    },
  });
  return { ...org, propertyId: prop.json().id as string };
}

type Org = Awaited<ReturnType<typeof orgWithProperty>>;
interface Sent {
  name: string;
  url: string;
  key: string;
  payload: Record<string, unknown>;
}

/** Send a POST with an Idempotency-Key and remember it so it can be replayed later. */
function sender(org: Org) {
  const sent: Sent[] = [];
  const post = async (name: string, url: string, payload: Record<string, unknown>) => {
    const key = newId();
    const res = await h.app.inject({
      method: 'POST',
      url,
      headers: { ...org.auth, 'idempotency-key': key },
      payload,
    });
    expect(res.statusCode, `${name}: ${res.body}`).toBeLessThan(300);
    sent.push({ name, url, key, payload });
    return res;
  };
  const replay = (s: Sent) =>
    h.app.inject({
      method: 'POST',
      url: s.url,
      headers: { ...org.auth, 'idempotency-key': s.key },
      payload: s.payload,
    });
  return { sent, post, replay };
}

async function storedResponses(tenantId: string) {
  const { rows } = await sql<{ scope: string; body: string }>`
    select scope, coalesce(response_body::text, '') as body from core.idempotency_keys
    where tenant_id = ${tenantId}`.execute(h.t.admin.kysely);
  return rows;
}

async function coreDump(tenantId: string): Promise<string> {
  const parts: string[] = [];
  for (const table of ['core.idempotency_keys', 'core.outbox', 'core.event_deliveries', 'core.audit_log']) {
    const data = await h.t.admin.kysely
      .selectFrom(table)
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .execute();
    parts.push(JSON.stringify(data));
  }
  return parts.join('\n');
}

async function createGuest(org: Org, post: ReturnType<typeof sender>['post']) {
  const res = await post('create profile', '/v1/guests/profiles', {
    propertyId: org.propertyId,
    givenName: 'Quilla',
    familyName: 'Erasemeplease',
    dateOfBirth: '1981-02-03',
    matchStrategy: 'create_new',
    contactPoints: [{ kind: 'email', value: 'quilla.erasemeplease@guest.example' }],
  });
  return res.json().profile.id as string;
}

async function erase(org: Org, profileId: string) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/guests/privacy-requests',
    headers: { ...org.auth, 'idempotency-key': newId() },
    payload: { kind: 'erasure', profileId, reason: 'Erasure request' },
  });
  expect(res.statusCode).toBe(201);
  expect(res.json().status).toBe('completed');
}

describe('SW-GUE-1: erasure vs stored idempotent responses', () => {
  it('PoC: no stored response holds the erased guest, and a replay of the create returns 410', async () => {
    const org = await orgWithProperty();
    const s = sender(org);
    const profileId = await createGuest(org, s.post);
    // Even BEFORE erasure the store holds ids only (replay plan), never the name or date of birth.
    expect((await storedResponses(org.tenantId)).filter((r) => PII.test(r.body))).toEqual([]);
    await erase(org, profileId);
    expect((await storedResponses(org.tenantId)).filter((r) => PII.test(r.body))).toEqual([]);
    const replay = await s.replay(s.sent[0] as Sent);
    expect(replay.statusCode).toBe(410);
    expect(replay.json().code).toBe('idempotent_response_erased');
    expect(replay.body).not.toMatch(PII);
  });

  it('every sibling entry point: stores no personal data and replays without it after erasure', async () => {
    const org = await orgWithProperty();
    const s = sender(org);
    const id = await createGuest(org, s.post);
    const other = (
      await s.post('create other profile', '/v1/guests/profiles', {
        propertyId: org.propertyId,
        givenName: 'Thabo',
        familyName: 'Nkosi',
        matchStrategy: 'create_new',
      })
    ).json().profile.id as string;
    await s.post('add contact point', `/v1/guests/profiles/${id}/contact-points`, {
      kind: 'phone',
      value: '777 1234',
    });
    await s.post('add preference', `/v1/guests/profiles/${id}/preferences`, {
      category: 'pillow',
      value: 'Buckwheat',
    });
    await s.post('raise alert', `/v1/guests/profiles/${id}/alerts`, {
      propertyId: org.propertyId,
      severity: 'critical',
      text: 'Shellfish allergy',
      visibility: 'shared',
    });
    const note = await s.post('add note', `/v1/guests/profiles/${id}/notes`, {
      visibility: 'shared',
      body: 'Prefers the lagoon villa',
    });
    await s.post('revise note', `/v1/guests/notes/${note.json().noteId}/revisions`, {
      body: 'Prefers the lagoon villa, upstairs',
    });
    await s.post('add relationship', `/v1/guests/profiles/${id}/relationships`, {
      relatedProfileId: other,
      kind: 'spouse',
    });
    await s.post('record consent', `/v1/guests/profiles/${id}/consents`, {
      propertyId: org.propertyId,
      purpose: 'marketing_email',
      state: 'granted',
      source: 'booking_engine',
      evidence: { textVersion: 'v1', channel: 'web', reference: 'Quilla said yes' },
    });
    await s.post('capture document', `/v1/guests/profiles/${id}/documents`, {
      propertyId: org.propertyId,
      type: 'passport',
      issuingCountry: 'MV',
      number: 'QX123456',
    });
    await s.post('add special need', `/v1/guests/profiles/${id}/special-needs`, {
      propertyId: org.propertyId,
      category: 'allergy',
      detail: 'Shellfish anaphylaxis',
    });
    const company = await s.post('create company', '/v1/guests/companies', {
      kind: 'company',
      legalName: 'Sweep Diving Co (fictitious)',
    });
    await s.post('add company contact', `/v1/guests/companies/${company.json().id}/contacts`, {
      profileId: id,
      role: 'booker',
    });
    const merge = await s.post('merge', '/v1/guests/merges', {
      survivorId: id,
      mergedId: other,
      reason: 'Quilla dup?',
    });
    await s.post('unmerge', `/v1/guests/merges/${merge.json().id}/unmerge`, { reason: 'Not Quilla' });
    await s.post('export request', '/v1/guests/privacy-requests', {
      kind: 'export',
      profileId: id,
      reason: 'Access',
    });

    expect((await storedResponses(org.tenantId)).filter((r) => PII.test(r.body)).map((r) => r.scope)).toEqual(
      [],
    );
    await erase(org, id);
    const dump = await coreDump(org.tenantId);
    const m = dump.match(PII);
    expect(m ? dump.slice(Math.max(0, (m.index ?? 0) - 300), (m.index ?? 0) + 60) : null).toBeNull();

    for (const sent of s.sent) {
      const r = await s.replay(sent);
      expect(r.body, sent.name).not.toMatch(PII);
      // Records about the erased guest are gone (410); unrelated records (another guest, the company, the
      // merge record, the export request) are rebuilt from their current — erased-safe — state.
      expect([200, 201, 410], `${sent.name}: ${r.statusCode} ${r.body}`).toContain(r.statusCode);
    }
    const byName = Object.fromEntries(
      await Promise.all(s.sent.map(async (x) => [x.name, (await s.replay(x)).statusCode] as const)),
    );
    expect(byName).toMatchObject({
      'create profile': 410,
      'add contact point': 410,
      'add preference': 410,
      'raise alert': 410,
      'add note': 410,
      'revise note': 410,
      'add relationship': 410,
      'record consent': 410,
      'capture document': 410,
      'add special need': 410,
      'create other profile': 201, // a different person: unaffected
      'create company': 201,
      'add company contact': 201,
      merge: 201,
      unmerge: 200,
      'export request': 201,
    });
  });

  it('merge then erasure: the merged-in profile’s create and the merge replay carry no personal data', async () => {
    const org = await orgWithProperty();
    const s = sender(org);
    const survivor = await createGuest(org, s.post);
    const merged = (
      await s.post('create duplicate', '/v1/guests/profiles', {
        propertyId: org.propertyId,
        givenName: 'Quilla',
        familyName: 'Erasemeplease',
        dateOfBirth: '1981-02-03',
        matchStrategy: 'create_new',
      })
    ).json().profile.id as string;
    await s.post('merge', '/v1/guests/merges', {
      survivorId: survivor,
      mergedId: merged,
      reason: 'Same guest',
    });
    await erase(org, survivor);
    expect(await coreDump(org.tenantId)).not.toMatch(PII);
    const replays = await Promise.all(s.sent.map((x) => s.replay(x)));
    for (const r of replays) expect(r.body).not.toMatch(PII);
    expect(replays.map((r) => r.statusCode)).toEqual([410, 410, 201]);
    expect(replays[2]?.json()).toMatchObject({ status: 'erased', reason: '[redacted]' });
  });

  it('an export requested before erasure no longer yields personal data; search finds nothing', async () => {
    const org = await orgWithProperty();
    const s = sender(org);
    const id = await createGuest(org, s.post);
    const exp = await s.post('export', '/v1/guests/privacy-requests', {
      kind: 'export',
      profileId: id,
      reason: 'Access',
    });
    await erase(org, id);
    const dl = await h.app.inject({
      method: 'GET',
      url: `/v1/guests/privacy-requests/${exp.json().id}/export`,
      headers: org.auth,
    });
    expect(dl.body).not.toMatch(PII);
    for (const url of ['/v1/guests/search?q=Erasemeplease', '/v1/search?q=Erasemeplease']) {
      const r = await h.app.inject({ method: 'GET', url, headers: org.auth });
      expect(r.json().items, url).toEqual([]);
    }
  });

  it('guest responses are never cacheable by browsers or intermediaries', async () => {
    const org = await orgWithProperty();
    const s = sender(org);
    const id = await createGuest(org, s.post);
    const get = await h.app.inject({ method: 'GET', url: `/v1/guests/profiles/${id}`, headers: org.auth });
    expect(get.headers['cache-control']).toBe('private, no-store');
    const search = await h.app.inject({
      method: 'GET',
      url: '/v1/guests/search?q=Quilla',
      headers: org.auth,
    });
    expect(search.headers['cache-control']).toBe('private, no-store');
  });
});
