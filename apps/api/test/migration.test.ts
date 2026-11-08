/**
 * Migration over HTTP, through the real composition root: "Move to Portico" with Idempotency-Key, upload with
 * column detection, card data refused, the pipeline running on the real platform / inventory / guests / finance /
 * rates and stopping HONESTLY where a requested provider is not on this server yet (reservations' migration import,
 * MIG-CR-1), ETag / If-Match on mapping review, problem+json, search, record history, isolation.
 */
import { newId } from '@portico/kernel';
import { sampleGuesthouseFiles, writeZip as zip } from '@portico/migration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiHarness, enrolMfa, provisionWithAdmin, signedInOrg, startApi } from './helpers';

let h: ApiHarness;
beforeAll(async () => {
  h = await startApi();
});
afterAll(async () => h?.close());

async function signedIn(environment: 'live' | 'sandbox') {
  if (environment === 'live') return signedInOrg(h, 'Coral Nest');
  const email = `admin-${newId()}@example.mv`;
  const password = 'correct horse battery staple';
  await provisionWithAdmin(
    h,
    {
      name: 'Coral Nest sandbox',
      slug: `org-${newId().slice(-12)}`,
      environment,
      planCode: 'enterprise',
      admin: { email, displayName: 'Admin' },
    },
    password,
  );
  const res = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });
  const auth = { authorization: `Bearer ${res.json().token}` };
  await enrolMfa(h.app, auth, password);
  return { auth };
}

async function makeProperty(auth: Record<string, string>) {
  const le = await h.app.inject({
    method: 'POST',
    url: '/v1/legal-entities',
    headers: { ...auth, 'idempotency-key': newId() },
    payload: { name: 'Coral Nest', legalName: 'Coral Nest Pvt Ltd', countryCode: 'MV', baseCurrency: 'USD' },
  });
  const p = await h.app.inject({
    method: 'POST',
    url: '/v1/properties',
    headers: { ...auth, 'idempotency-key': newId() },
    payload: {
      code: `CN${newId().slice(-4).toUpperCase()}`,
      name: 'Coral Nest Guesthouse',
      profile: 'guesthouse',
      legalEntityId: le.json().id,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      businessDate: '2026-12-01',
    },
  });
  return p.json().id as string;
}

describe('migration API', () => {
  it('lists sources (vendor layouts labelled unverified) and serves the templates', async () => {
    const { auth } = await signedIn('live');
    const s = await h.app.inject({ method: 'GET', url: '/v1/migration/sources', headers: auth });
    expect(s.statusCode).toBe(200);
    const items = s.json().items as Array<{ key: string; verification: string }>;
    expect(items.find((i) => i.key === 'portico.pack.v1')?.verification).toBe('verified');
    expect(
      items
        .filter((i) => ['littlehotelier.csv', 'cloudbeds.csv', 'ezee.csv'].includes(i.key))
        .every((i) => i.verification === 'unverified'),
    ).toBe(true);
    const t = await h.app.inject({ method: 'GET', url: '/v1/migration/templates', headers: auth });
    expect(t.json().files.map((f: { name: string }) => f.name)).toContain('reservations.csv');
    expect(t.json().workbook.base64.length).toBeGreaterThan(100);
  });

  it('Move to Portico over HTTP: runs on the real providers and waits honestly for the reservations import', async () => {
    const { auth } = await signedIn('sandbox');
    const propertyId = await makeProperty(auth);
    const body = { propertyId, sourceAdapter: 'portico.pack.v1', sourceSystem: 'Coral Nest spreadsheets' };
    const noKey = await h.app.inject({
      method: 'POST',
      url: '/v1/migration/jobs',
      headers: auth,
      payload: body,
    });
    expect(noKey.statusCode).toBe(400);
    const key = newId();
    const created = await h.app.inject({
      method: 'POST',
      url: '/v1/migration/jobs',
      headers: { ...auth, 'idempotency-key': key },
      payload: body,
    });
    expect(created.statusCode).toBe(201);
    const retry = await h.app.inject({
      method: 'POST',
      url: '/v1/migration/jobs',
      headers: { ...auth, 'idempotency-key': key },
      payload: body,
    });
    expect(retry.json().id).toBe(created.json().id);
    const id = created.json().id as string;
    const second = await h.app.inject({
      method: 'POST',
      url: '/v1/migration/jobs',
      headers: { ...auth, 'idempotency-key': newId() },
      payload: body,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: 'migration_already_open', details: { jobId: id } });

    const files = sampleGuesthouseFiles('2026-12-01');
    const preview = await h.app.inject({
      method: 'POST',
      url: `/v1/migration/jobs/${id}/uploads/preview`,
      headers: auth,
      payload: { files },
    });
    expect(preview.json()).toMatchObject({ stored: false, counts: { reservation: 8 } });
    const up = await h.app.inject({
      method: 'POST',
      url: `/v1/migration/jobs/${id}/uploads`,
      headers: { ...auth, 'idempotency-key': newId() },
      payload: { files },
    });
    expect(up.statusCode).toBe(200);
    expect(up.json()).toMatchObject({ stored: true, extractSeq: 1 });

    let run = await h.app.inject({ method: 'POST', url: `/v1/migration/jobs/${id}/run`, headers: auth });
    expect(run.statusCode).toBe(200);
    expect(run.json().executed.at(-1)).toMatchObject({ step: 'map', status: 'waiting' });
    const job = await h.app.inject({ method: 'GET', url: `/v1/migration/jobs/${id}`, headers: auth });
    const etag = job.headers.etag as string;
    expect(job.json().pendingReview).toEqual([
      expect.objectContaining({ kind: 'taxAccount', financial: true }),
    ]);
    const stale = await h.app.inject({
      method: 'PATCH',
      url: `/v1/migration/jobs/${id}/mapping`,
      headers: { ...auth, 'if-match': '"999"' },
      payload: { taxAccounts: [{ sourceCode: 'TGST', accountKey: 'tgst' }] },
    });
    expect(stale.statusCode).toBe(409);
    const reviewed = await h.app.inject({
      method: 'PATCH',
      url: `/v1/migration/jobs/${id}/mapping`,
      headers: { ...auth, 'if-match': etag },
      payload: { taxAccounts: [{ sourceCode: 'TGST', accountKey: 'tgst' }] },
    });
    expect(reviewed.statusCode).toBe(200);
    run = await h.app.inject({ method: 'POST', url: `/v1/migration/jobs/${id}/run`, headers: auth });
    const steps = run.json().executed as Array<{ step: string; status: string; detail: string }>;
    expect(steps.map((s) => `${s.step}:${s.status}`)).toEqual([
      'map:succeeded',
      'validate:succeeded',
      'rehearse:waiting',
    ]);
    expect(steps.at(-1)?.detail).toMatch(
      /Not available on this server yet: reservation.*provider contract requested/,
    );
    // Real providers did their part: unit types, units and guest profiles exist; nothing is called migrated.
    const ledger = await h.app.inject({
      method: 'GET',
      url: `/v1/migration/jobs/${id}/ledger`,
      headers: auth,
    });
    const states: Record<string, number> = {};
    for (const e of ledger.json().items as Array<{ dataClass: string; state: string }>)
      states[`${e.dataClass}:${e.state}`] = (states[`${e.dataClass}:${e.state}`] ?? 0) + 1;
    expect(states).toMatchObject({
      'unit_type:imported': 3,
      'unit:imported': 6,
      'guest:imported': 6,
      'reservation:pending': 8,
    });
    const units = await h.app.inject({
      method: 'GET',
      url: `/v1/properties/${propertyId}/units`,
      headers: auth,
    });
    expect(units.statusCode).toBe(200);
    expect((units.json().items as unknown[]).length).toBe(6);
    const ex = await h.app.inject({
      method: 'GET',
      url: `/v1/migration/jobs/${id}/exceptions`,
      headers: auth,
    });
    expect(ex.json().items).toContainEqual(
      expect.objectContaining({
        code: 'provider_unavailable',
        severity: 'blocking',
        ownerRole: 'Monoclay onboarding lead',
      }),
    );
    const view = (
      await h.app.inject({ method: 'GET', url: `/v1/migration/jobs/${id}`, headers: auth })
    ).json();
    expect(view.status).toMatchObject({
      migration: 'waiting',
      rehearsal: 'not_certified',
      cutover: 'not_planned',
    });
    expect(view.issues.map((i: { code: string }) => i.code)).toContain('blocking_exceptions');

    const search = await h.app.inject({
      method: 'GET',
      url: '/v1/search?q=Coral%20Nest%20spreadsheets',
      headers: auth,
    });
    expect(
      search
        .json()
        .items.some((i: { type: string; id: string }) => i.type === 'migration_job' && i.id === id),
    ).toBe(true);
    const history = await h.app.inject({
      method: 'GET',
      url: `/v1/records/migration_job/${id}/history`,
      headers: auth,
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().items.map((i: { action: string }) => i.action)).toContain('migration.job.create');
  });

  it('R-P1-1: the review crash workbook (939 bytes) is a plain 400 refusal on preview, and the server keeps serving', async () => {
    const { auth } = await signedIn('live');
    const propertyId = await makeProperty(auth);
    const created = await h.app.inject({
      method: 'POST',
      url: '/v1/migration/jobs',
      headers: { ...auth, 'idempotency-key': newId() },
      payload: { propertyId, sourceAdapter: 'portico.pack.v1', sourceSystem: 'Sheets' },
    });
    const id = created.json().id as string;
    const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const rows = Array.from(
      { length: 40 },
      (_, i) => `<row r="${i + 1}"><c r="ZZZZZ${i + 1}" t="inlineStr"><is><t>x</t></is></c></row>`,
    ).join('');
    const wb = zip([
      {
        name: 'xl/workbook.xml',
        data: Buffer.from(
          `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="reservations" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        ),
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: Buffer.from(
          `<Relationships><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
        ),
      },
      {
        name: 'xl/worksheets/sheet1.xml',
        data: Buffer.from(`<worksheet><sheetData>${rows}</sheetData></worksheet>`),
      },
    ]);
    expect(wb.length).toBeLessThan(1000);
    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/migration/jobs/${id}/uploads/preview`,
      headers: auth,
      payload: { files: [{ name: 'export.xlsx', content: wb.toString('base64'), encoding: 'base64' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'unreadable_spreadsheet' });
    const again = await h.app.inject({ method: 'GET', url: `/v1/migration/jobs/${id}`, headers: auth });
    expect(again.statusCode).toBe(200);
  });

  it('refuses a file containing a card number (problem+json, nothing stored) and isolates organizations', async () => {
    const { auth } = await signedIn('live');
    const propertyId = await makeProperty(auth);
    const created = await h.app.inject({
      method: 'POST',
      url: '/v1/migration/jobs',
      headers: { ...auth, 'idempotency-key': newId() },
      payload: { propertyId, sourceAdapter: 'portico.pack.v1', sourceSystem: 'Sheets' },
    });
    const id = created.json().id as string;
    const files = [{ name: 'guests.csv', content: 'guest_id,last_name,phone\nG1,Doe,5555 5555 5555 4444\n' }];
    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/migration/jobs/${id}/uploads`,
      headers: { ...auth, 'idempotency-key': newId() },
      payload: { files },
    });
    expect(res.statusCode).toBe(422);
    expect(res.headers['content-type']).toMatch(/problem\+json/);
    expect(res.json()).toMatchObject({ code: 'card_data_in_file' });
    expect(res.body).not.toContain('4444');
    const other = await signedIn('live');
    const peek = await h.app.inject({ method: 'GET', url: `/v1/migration/jobs/${id}`, headers: other.auth });
    expect(peek.statusCode).toBe(404);
    const simLive = await h.app.inject({
      method: 'POST',
      url: '/v1/migration/jobs',
      headers: { ...auth, 'idempotency-key': newId() },
      payload: { propertyId, sourceAdapter: 'pms.simulator', sourceSystem: 'Sim', sourceRef: 'sim-x' },
    });
    expect(simLive.json().code).toBe('simulator_not_in_live');
  });
});
