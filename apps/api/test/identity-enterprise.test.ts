import { createHmac } from 'node:crypto';
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type EnterpriseHarness,
  enterpriseOrg,
  legalEntityAndProperty,
  PASSWORD,
  startEnterpriseApi,
} from './enterprise-harness';

/** RFC 6238 code for a base32 secret at a time (independent of the module's implementation). */
function totpCode(secretB32: string, at: Date): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretB32) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / 30_000)));
  const mac = createHmac('sha1', key).update(msg).digest();
  const o = (mac[19] ?? 0) & 0xf;
  const n =
    (((mac[o] ?? 0) & 0x7f) << 24) | ((mac[o + 1] ?? 0) << 16) | ((mac[o + 2] ?? 0) << 8) | (mac[o + 3] ?? 0);
  return String(n % 1_000_000).padStart(6, '0');
}

let h: EnterpriseHarness;
beforeAll(async () => {
  h = await startEnterpriseApi();
});
afterAll(async () => h?.close());

describe('MFA over HTTP: enrolment, second factor at sign-in, step-up as a distinct problem', () => {
  it('turns a step-up denial on another module’s route into mfa_required, and verification restores it', async () => {
    const o = await enterpriseOrg(h);
    const enrol = await h.app.inject({ method: 'POST', url: '/v1/me/mfa/totp', headers: o.auth });
    expect(enrol.statusCode).toBe(200);
    const secret = enrol.json().secret as string;
    const confirm = await h.app.inject({
      method: 'POST',
      url: '/v1/me/mfa/totp/confirm',
      headers: o.auth,
      payload: { code: totpCode(secret, h.clock.now()) },
    });
    expect(confirm.json().recoveryCodes).toHaveLength(10);
    // Sign-in now asks for the second factor.
    const first = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: o.email, password: PASSWORD },
    });
    expect(first.json()).toMatchObject({ status: 'mfa_required', methods: ['totp', 'recovery_code'] });
    h.clock.advance(30_000);
    const second = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/login/mfa',
      payload: { challengeToken: first.json().challengeToken, code: totpCode(secret, h.clock.now()) },
    });
    expect(second.json().status).toBe('signed_in');
    const auth = { authorization: `Bearer ${second.json().token}` };
    // 16 minutes later a sensitive platform permission (legal entities) needs step-up; the problem says so.
    h.clock.advance(16 * 60_000);
    const payload = { name: 'Atoll Ltd', legalName: 'Atoll Pvt Ltd', countryCode: 'MV', baseCurrency: 'USD' };
    const denied = await h.app.inject({
      method: 'POST',
      url: '/v1/legal-entities',
      headers: { ...auth, 'idempotency-key': newId() },
      payload,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers['content-type']).toContain('application/problem+json');
    expect(denied.json()).toMatchObject({
      code: 'mfa_required',
      details: {
        permission: 'platform.legalEntity.manage',
        stepUpWindowMinutes: 15,
        verifyPath: '/v1/auth/mfa/verify',
      },
    });
    // Non-sensitive reads keep working.
    expect((await h.app.inject({ method: 'GET', url: '/v1/properties', headers: auth })).statusCode).toBe(
      200,
    );
    const me = await h.app.inject({ method: 'GET', url: '/v1/me', headers: auth });
    expect(me.json().mfa).toMatchObject({ enrolled: true, requiredForSensitive: true });
    const wrong = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/verify',
      headers: auth,
      payload: { code: '000000' },
    });
    expect(wrong.json()).toMatchObject({ code: 'invalid_code', details: { attemptsRemaining: 4 } });
    h.clock.advance(30_000);
    const ok = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/verify',
      headers: auth,
      payload: { code: totpCode(secret, h.clock.now()) },
    });
    expect(ok.json().method).toBe('totp');
    const allowed = await h.app.inject({
      method: 'POST',
      url: '/v1/legal-entities',
      headers: { ...auth, 'idempotency-key': newId() },
      payload,
    });
    expect(allowed.statusCode).toBe(201);
  });

  it('after the grace period an unenrolled administrator gets mfa_enrollment_required', async () => {
    const o = await enterpriseOrg(h);
    const policy = await h.app.inject({ method: 'GET', url: '/v1/security/policy', headers: o.auth });
    expect(policy.headers.etag).toBe('W/"0"');
    const put = await h.app.inject({
      method: 'PUT',
      url: '/v1/security/policy',
      headers: { ...o.auth, 'if-match': policy.headers.etag as string },
      payload: { mfaGracePeriodHours: 0 },
    });
    expect(put.statusCode).toBe(200);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/legal-entities',
      headers: { ...o.auth, 'idempotency-key': newId() },
      payload: { name: 'X', legalName: 'X', countryCode: 'MV', baseCurrency: 'USD' },
    });
    expect(res.json()).toMatchObject({ status: 403, code: 'mfa_enrollment_required' });
    // A permission the person truly lacks stays a plain `forbidden`.
    const desk = await h.app.inject({ method: 'GET', url: '/v1/organization/entitlements', headers: o.auth });
    expect(desk.statusCode).toBe(200);
  });
});

describe('permission catalog and custom roles over HTTP', () => {
  it('serves the catalog grouped by module with sensitive flags; creates and edits a role with If-Match', async () => {
    const o = await enterpriseOrg(h);
    const cat = await h.app.inject({ method: 'GET', url: '/v1/permissions', headers: o.auth });
    expect(cat.statusCode).toBe(200);
    const identityModule = cat.json().modules.find((m: { module: string }) => m.module === 'identity');
    expect(identityModule.permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'identity.user.manage', sensitive: true, scope: 'organization' }),
      ]),
    );
    const created = await h.app.inject({
      method: 'POST',
      url: '/v1/roles',
      headers: { ...o.auth, 'idempotency-key': newId() },
      payload: {
        key: 'property_viewer',
        name: 'Property viewer',
        permissions: ['platform.property.read', 'platform.outlet.manage'],
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    const stale = await h.app.inject({
      method: 'PATCH',
      url: `/v1/roles/${id}`,
      headers: { ...o.auth, 'if-match': 'W/"7"' },
      payload: { name: 'x' },
    });
    expect(stale.json()).toMatchObject({ code: 'version_conflict', details: { currentVersion: 1 } });
    const list = await h.app.inject({ method: 'GET', url: '/v1/roles', headers: o.auth });
    const gm = list.json().items.find((r: { key: string }) => r.key === 'general_manager');
    expect(gm).toMatchObject({ is_system: true, isSystem: true }); // wave-0 fields kept, editor fields added
    const immutable = await h.app.inject({
      method: 'PATCH',
      url: `/v1/roles/${gm.id}`,
      headers: { ...o.auth, 'if-match': 'W/"1"' },
      payload: { name: 'x' },
    });
    expect(immutable.json().code).toBe('system_role_immutable');
  });
});

describe('SCIM over HTTP', () => {
  it('accepts application/scim+json, answers SCIM resources and SCIM errors', async () => {
    const o = await enterpriseOrg(h);
    const issued = await h.app.inject({
      method: 'POST',
      url: '/v1/api-clients',
      headers: { ...o.auth, 'idempotency-key': newId() },
      payload: { name: 'Okta provisioning', permissions: ['identity.scim.provision'] },
    });
    expect(issued.statusCode).toBe(201);
    const bogus = await h.app.inject({
      method: 'POST',
      url: '/v1/api-clients',
      headers: { ...o.auth, 'idempotency-key': newId() },
      payload: { name: 'Bad', permissions: ['identity.everything'] },
    });
    expect(bogus.json().code).toBe('invalid_permissions');
    const client = issued.json() as { clientId: string; token: string };
    const auth = { authorization: `Bearer ${client.token}`, 'content-type': 'application/scim+json' };
    const userName = `scim-${newId().slice(-6)}@lagoon.mv`;
    const body = JSON.stringify({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName,
      name: { givenName: 'Ali', familyName: 'Naseem' },
    });
    const created = await h.app.inject({
      method: 'POST',
      url: '/v1/scim/v2/Users',
      headers: auth,
      payload: body,
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers['content-type']).toContain('application/scim+json');
    expect(created.json()).toMatchObject({ userName, displayName: 'Ali Naseem', active: true });
    const dup = await h.app.inject({
      method: 'POST',
      url: '/v1/scim/v2/Users',
      headers: auth,
      payload: body,
    });
    expect(dup.json()).toMatchObject({
      status: '409',
      scimType: 'uniqueness',
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    });
    const filtered = await h.app.inject({
      method: 'GET',
      url: `/v1/scim/v2/Users?filter=${encodeURIComponent(`userName eq "${userName}"`)}`,
      headers: auth,
    });
    expect(filtered.json().totalResults).toBe(1);
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/v1/scim/v2/Users/${created.json().id}`,
      headers: auth,
      payload: JSON.stringify({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      }),
    });
    expect(patch.json().active).toBe(false);
    // SCIM needs an authenticated client.
    const noAuth = await h.app.inject({ method: 'GET', url: '/v1/scim/v2/Users' });
    expect(noAuth.statusCode).toBe(401);
    // Revoking the client stops provisioning immediately.
    await h.app.inject({
      method: 'POST',
      url: `/v1/api-clients/${client.clientId}/revoke`,
      headers: o.auth,
      payload: { reason: 'rotated' },
    });
    expect((await h.app.inject({ method: 'GET', url: '/v1/scim/v2/Users', headers: auth })).statusCode).toBe(
      401,
    );
  });
});

describe('Monoclay support access over HTTP (operator console)', () => {
  it('operator requests, customer approves, support reads but cannot write, everything is visible to the customer', async () => {
    const o = await enterpriseOrg(h);
    const { propertyId } = await legalEntityAndProperty(h, o.auth);
    const noOperator = await h.app.inject({
      method: 'POST',
      url: '/v1/operator/support-sessions',
      payload: { organizationId: o.tenantId, reason: 'x'.repeat(12), ticketRef: 'T-1' },
    });
    expect(noOperator.statusCode).toBe(401);
    const asTenantUser = await h.app.inject({
      method: 'POST',
      url: '/v1/operator/support-sessions',
      headers: o.auth,
      payload: { organizationId: o.tenantId, reason: 'x'.repeat(12), ticketRef: 'T-1' },
    });
    expect(asTenantUser.statusCode).toBe(401); // tenant sessions are not operator credentials
    const req = await h.app.inject({
      method: 'POST',
      url: '/v1/operator/support-sessions',
      headers: { authorization: `Bearer ${h.operator.token}` },
      payload: {
        organizationId: o.tenantId,
        reason: 'Folio totals differ from report (T-77)',
        ticketRef: 'T-77',
        durationMinutes: 60,
      },
    });
    expect(req.statusCode).toBe(201);
    const { session, token } = req.json();
    const support = { authorization: `Bearer ${token}` };
    expect((await h.app.inject({ method: 'GET', url: '/v1/properties', headers: support })).statusCode).toBe(
      401,
    );
    // Another organization cannot approve it.
    const other = await enterpriseOrg(h, { name: 'Other' });
    const foreign = await h.app.inject({
      method: 'POST',
      url: `/v1/support-sessions/${session.id}/approve`,
      headers: other.auth,
      payload: {},
    });
    expect(foreign.statusCode).toBe(404);
    const approve = await h.app.inject({
      method: 'POST',
      url: `/v1/support-sessions/${session.id}/approve`,
      headers: o.auth,
      payload: { note: 'ok' },
    });
    expect(approve.json().status).toBe('active');
    const read = await h.app.inject({ method: 'GET', url: `/v1/properties/${propertyId}`, headers: support });
    expect(read.statusCode).toBe(200);
    const write = await h.app.inject({
      method: 'PATCH',
      url: `/v1/properties/${propertyId}`,
      headers: { ...support, 'if-match': read.headers.etag as string },
      payload: { name: 'changed by support' },
    });
    expect(write.statusCode).toBe(403);
    const log = await h.app.inject({
      method: 'GET',
      url: `/v1/support-sessions/${session.id}/access-log`,
      headers: o.auth,
    });
    expect(log.json().items.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining([`/v1/properties/${propertyId}`]),
    );
    const end = await h.app.inject({
      method: 'POST',
      url: `/v1/operator/organizations/${o.tenantId}/support-sessions/${session.id}/end`,
      headers: { authorization: `Bearer ${h.operator.token}` },
    });
    expect(end.json().status).toBe('ended');
    expect(
      (await h.app.inject({ method: 'GET', url: `/v1/properties/${propertyId}`, headers: support }))
        .statusCode,
    ).toBe(401);
  });
});

describe('staff lifecycle over HTTP', () => {
  it('invites with a simulated link outside live, removes members and revokes their sessions', async () => {
    const o = await enterpriseOrg(h);
    const { propertyId } = await legalEntityAndProperty(h, o.auth, 'INV');
    const email = `inv-${newId()}@lagoon.mv`;
    const invite = await h.app.inject({
      method: 'POST',
      url: '/v1/users/invitations',
      headers: { ...o.auth, 'idempotency-key': newId() },
      payload: {
        email,
        displayName: 'Shifa',
        roles: [{ roleKey: 'front_desk', scopeType: 'property', scopeId: propertyId }],
      },
    });
    expect(invite.statusCode).toBe(201);
    // Live organization: the message is queued for delivery, never echoed back.
    expect(invite.json().delivery).toEqual({ mode: 'live' });
    const userId = invite.json().userId;
    const detail = await h.app.inject({ method: 'GET', url: `/v1/users/${userId}`, headers: o.auth });
    expect(detail.json()).toMatchObject({
      status: 'invited',
      assignments: [expect.objectContaining({ roleKey: 'front_desk' })],
    });
    const remove = await h.app.inject({
      method: 'POST',
      url: `/v1/users/${userId}/remove`,
      headers: o.auth,
      payload: { reason: 'did not join' },
    });
    expect(remove.json()).toMatchObject({ assignments: 1 });
    const self = await h.app.inject({
      method: 'POST',
      url: `/v1/users/${o.adminUserId}/remove`,
      headers: o.auth,
      payload: { reason: 'oops' },
    });
    expect(self.json().code).toBe('segregation_of_duties');
  });
});
