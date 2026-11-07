import { createHash } from 'node:crypto';
import { newId, randomToken } from '@portico/kernel';
import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identity } from '../src';
import type { OidcHttpClient } from '../src/ports';
import { authenticate, type Harness, harness, org, PASSWORD, signIn, signInWithMfa } from './harness';

/**
 * In-process fake OpenID provider: discovery, JWKS, and a token endpoint that checks client authentication and
 * PKCE before issuing an RS256 ID token. Keys are generated per test run; nothing listens on a port.
 */
async function fakeIdp(issuer: string, clientId: string, clientSecret: string) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const rogue = await generateKeyPair('RS256');
  const codes = new Map<
    string,
    { nonce: string; challenge: string; claims: Record<string, unknown>; rogue: boolean }
  >();
  const calls: string[] = [];
  const http: OidcHttpClient = {
    async getJson(url) {
      calls.push(`GET ${url}`);
      if (url === `${issuer}/.well-known/openid-configuration`)
        return {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        };
      if (url === `${issuer}/jwks`) return { keys: [jwk] };
      throw new Error(`unexpected ${url}`);
    },
    async postForm(url, form, headers = {}) {
      calls.push(`POST ${url}`);
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      if (url !== `${issuer}/token` || headers.authorization !== `Basic ${basic}`)
        return { status: 401, body: { error: 'invalid_client' } };
      const entry = codes.get(form.code ?? '');
      if (!entry) return { status: 400, body: { error: 'invalid_grant' } };
      codes.delete(form.code ?? '');
      const challenge = createHash('sha256')
        .update(form.code_verifier ?? '')
        .digest('base64url');
      if (challenge !== entry.challenge)
        return { status: 400, body: { error: 'invalid_grant', error_description: 'PKCE' } };
      const idToken = await new SignJWT({ nonce: entry.nonce, ...entry.claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(issuer)
        .setAudience(clientId)
        .setSubject(String(entry.claims.sub ?? entry.claims.email))
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(entry.rogue ? rogue.privateKey : privateKey);
      return { status: 200, body: { id_token: idToken, access_token: 'unused', token_type: 'Bearer' } };
    },
  };
  /** The browser leg: the person authenticates at the IdP, which redirects back with a code. */
  const authorize = (
    authorizationUrl: string,
    claims: Record<string, unknown>,
    opts: { rogue?: boolean } = {},
  ) => {
    const u = new URL(authorizationUrl);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('client_id')).toBe(clientId);
    const code = randomToken(16);
    codes.set(code, {
      nonce: u.searchParams.get('nonce') as string,
      challenge: u.searchParams.get('code_challenge') as string,
      claims,
      rogue: opts.rogue ?? false,
    });
    return { code, state: u.searchParams.get('state') as string };
  };
  return { http, authorize, calls };
}

let h: Harness;
let idp: Awaited<ReturnType<typeof fakeIdp>>;
const issuer = 'https://idp.lagoon.test';
beforeAll(async () => {
  idp = await fakeIdp(issuer, 'portico-client', 's3cret-from-idp');
  h = await harness({ oidcHttp: undefined });
  h.ports.oidcHttp = idp.http;
});
afterAll(async () => h?.t.drop());

async function ssoOrg() {
  const o = await org(h);
  const p = await o.property('SSO');
  await o.tx((tx) =>
    identity.configureSso(tx, h.ports, {
      displayName: 'Lagoon Entra ID',
      issuer,
      clientId: 'portico-client',
      clientSecret: 's3cret-from-idp',
      allowedEmailDomains: ['lagoon.mv'],
    }),
  );
  await o.tx((tx) =>
    identity.setGroupRoleMappings(tx, h.ports, [
      { group: 'PMS-FrontDesk', roleKey: 'front_desk', scopeType: 'property', scopeId: p.id },
      { group: 'PMS-Finance', roleKey: 'finance', scopeType: 'organization' },
    ]),
  );
  /** Claims default to a verified email; tests override `email_verified` and `sub` where they matter. */
  const ssoLogin = async (
    claims: Record<string, unknown>,
    opts: { rogue?: boolean; browserBinding?: string } = {},
  ) => {
    const start = await identity.startSsoLogin(h.t.db, h.ports, { organizationId: o.tenantId });
    const { code, state } = idp.authorize(start.authorizationUrl, { email_verified: true, ...claims }, opts);
    const browserBinding = opts.browserBinding ?? start.browserBinding;
    return {
      state,
      browserBinding: start.browserBinding,
      result: () => identity.completeSsoLogin(h.t.db, h.ports, { state, code, browserBinding }),
    };
  };
  return { o, p, ssoLogin };
}

describe('OIDC single sign-on (fake identity provider)', () => {
  it('keeps the client secret out of the connection row and in the encrypted secret store', async () => {
    const { o } = await ssoOrg();
    const conn = await o.tx((tx) => identity.getSsoConnection(tx));
    expect(conn).toMatchObject({ clientSecretSet: true, issuer, mappings: expect.any(Array) });
    const row = await h.t.admin.kysely
      .selectFrom('identity.sso_connections')
      .selectAll()
      .where('tenant_id', '=', o.tenantId)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(row)).not.toContain('s3cret-from-idp');
    const secret = await h.t.admin.kysely
      .selectFrom('identity.secret_values')
      .select('ciphertext')
      .where('ref', '=', row.client_secret_ref)
      .executeTakeFirstOrThrow();
    expect(secret.ciphertext).not.toContain('s3cret');
  });

  it('JIT-provisions with mapped roles, then reconciles roles on the next sign-in', async () => {
    const { o, p, ssoLogin } = await ssoOrg();
    const email = `aisha-${newId().slice(-6)}@lagoon.mv`;
    const first = await ssoLogin({
      email,
      email_verified: true,
      name: 'Aisha Ibrahim',
      groups: ['pms-frontdesk'],
    });
    const signedIn = await first.result();
    expect(signedIn.status).toBe('signed_in');
    let ctx = await authenticate(h, signedIn.token);
    expect(ctx?.authz.can('reservations.stay.checkIn', { propertyId: p.id })).toBe(true);
    expect(ctx?.authz.can('analytics.report.read', { propertyId: p.id })).toBe(false);
    const member = await o.tx((tx) => identity.getMember(tx, signedIn.userId));
    expect(member).toMatchObject({ provisionedBy: 'sso', displayName: 'Aisha Ibrahim', status: 'active' });
    // A manual grant is never touched by reconciliation.
    await o.tx((tx) =>
      identity.assignRole(tx, { userId: signedIn.userId, roleKey: 'read_only', scopeType: 'organization' }),
    );
    const second = await (await ssoLogin({ email, name: 'Aisha Ibrahim', groups: ['PMS-Finance'] })).result();
    ctx = await authenticate(h, second.token);
    expect(ctx?.authz.can('reservations.stay.checkIn', { propertyId: p.id })).toBe(false);
    expect(ctx?.authz.can('analytics.report.read', { propertyId: p.id })).toBe(true);
    const roles = (await o.tx((tx) => identity.getMember(tx, signedIn.userId))).assignments.map(
      (a) => `${a.roleKey}:${a.source}`,
    );
    expect(roles.sort()).toEqual(['finance:sso', 'read_only:manual']);
  });

  it('refuses foreign domains, unmapped newcomers, forged tokens and replayed state — and audits why', async () => {
    const { o, ssoLogin } = await ssoOrg();
    await expect(
      (await ssoLogin({ email: 'x@evil.mv', groups: ['PMS-Finance'] })).result(),
    ).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(
      (await ssoLogin({ email: `n-${newId()}@lagoon.mv`, groups: ['Marketing'] })).result(),
    ).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(
      (
        await ssoLogin({ email: `r-${newId()}@lagoon.mv`, groups: ['PMS-Finance'] }, { rogue: true })
      ).result(),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(
      (
        await ssoLogin({ email: `u-${newId()}@lagoon.mv`, email_verified: false, groups: ['PMS-Finance'] })
      ).result(),
    ).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    // P2-3: a (state, code) pair lifted from another browser (Referer, logs) is useless without its binding.
    await expect(
      (
        await ssoLogin(
          { email: `b-${newId()}@lagoon.mv`, groups: ['PMS-Finance'] },
          { browserBinding: 'someone-elses-browser' },
        )
      ).result(),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    const ok = await ssoLogin({ email: `ok-${newId()}@lagoon.mv`, groups: ['PMS-Finance'] });
    await ok.result();
    await expect(
      identity.completeSsoLogin(h.t.db, h.ports, {
        state: ok.state,
        code: 'replayed',
        browserBinding: ok.browserBinding,
      }),
    ).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    const reasons = await h.t.admin.kysely
      .selectFrom('core.audit_log')
      .select('reason')
      .where('tenant_id', '=', o.tenantId)
      .where('action', '=', 'identity.sso.loginFailed')
      .execute();
    expect(reasons.map((r) => r.reason)).toEqual([
      'email_domain_not_allowed',
      'no_mapped_group',
      'id_token_invalid',
      'email_not_verified',
      'browser_binding_mismatch',
      'invalid_or_expired_state',
    ]);
    // P3-5: refusals never store a non-member's email address in this organization's audit log.
    const details = await h.t.admin.kysely
      .selectFrom('core.audit_log')
      .select('metadata')
      .where('tenant_id', '=', o.tenantId)
      .where('action', '=', 'identity.sso.loginFailed')
      .execute();
    expect(JSON.stringify(details)).not.toMatch(/@(lagoon|evil)\.mv/);
  });

  it('SSO required: enabling needs an SSO session; password sign-in then stops for non-exempt members', async () => {
    const { o, ssoLogin } = await ssoOrg();
    const pwAdmin = await o.member(
      [{ roleKey: 'org_admin', scopeType: 'organization' }],
      `pw-${newId()}@lagoon.mv`,
    );
    const pw = await signInWithMfa(h, pwAdmin.email);
    const breakGlass = await o.member([], `exempt-${newId()}@lagoon.mv`);
    // P2-4: at least one account keeps password sign-in while SSO is required.
    await expect(
      o.tx((tx) => identity.setSsoEnforcement(tx, { ssoRequired: true, exemptUserIds: [] }), pw.ctx),
    ).rejects.toMatchObject({
      code: 'emergency_account_required',
    });
    await expect(
      o.tx(
        (tx) => identity.setSsoEnforcement(tx, { ssoRequired: true, exemptUserIds: [breakGlass.userId] }),
        pw.ctx,
      ),
    ).rejects.toMatchObject({
      code: 'sign_in_with_sso_first',
    });
    const ssoAdminEmail = `admin-${newId()}@lagoon.mv`;
    const viaSso = await (
      await ssoLogin({ email: ssoAdminEmail, groups: ['PMS-Finance'], amr: ['pwd', 'mfa'] })
    ).result();
    await o.tx((tx) =>
      identity.assignRole(tx, { userId: viaSso.userId, roleKey: 'org_admin', scopeType: 'organization' }),
    );
    const ssoCtx = await authenticate(h, viaSso.token);
    const res = await o.tx(
      (tx) => identity.setSsoEnforcement(tx, { ssoRequired: true, exemptUserIds: [breakGlass.userId] }),
      ssoCtx ?? undefined,
    );
    expect(res).toMatchObject({ ssoRequired: true, passwordSessionsRevoked: 1 });
    expect(await authenticate(h, pw.token)).toBeNull();
    await expect(identity.login(h.t.db, { email: pwAdmin.email, password: PASSWORD })).rejects.toMatchObject({
      code: 'sso_required',
    });
    expect((await identity.login(h.t.db, { email: breakGlass.email, password: PASSWORD })).status).toBe(
      'signed_in',
    );
  });

  it('identity-provider MFA (amr) counts as step-up for sensitive permissions', async () => {
    const { p, ssoLogin } = await ssoOrg();
    const s = await (
      await ssoLogin({ email: `mfa-${newId()}@lagoon.mv`, groups: ['PMS-Finance'], amr: ['pwd', 'mfa'] })
    ).result();
    const ctx = await authenticate(h, s.token);
    expect(ctx?.authz.can('platform.legalEntity.manage')).toBe(false); // not granted by finance role
    expect(ctx?.authz.can('finance.folio.read', { propertyId: p.id })).toBe(true);
  });
});

describe('SCIM 2.0 provisioning', () => {
  async function scimOrg(planCode = 'enterprise') {
    const o = await org(h, { planCode });
    const p = await o.property('SCIM');
    await o.tx((tx) =>
      identity.setGroupRoleMappings(tx, h.ports, [
        { group: 'Housekeeping', roleKey: 'housekeeping_attendant', scopeType: 'property', scopeId: p.id },
      ]),
    );
    const { token } = await o.tx((tx) =>
      identity.createApiClient(tx, {
        name: 'Entra ID provisioning',
        permissions: ['identity.scim.provision'],
      }),
    );
    const scimCtx = await authenticate(h, token);
    if (!scimCtx) throw new Error('SCIM client did not authenticate');
    return { o, p, scimCtx, base: 'https://api.portico.test/v1/scim/v2' };
  }

  it('creates, finds, deactivates, reactivates and deletes users', async () => {
    const { o, scimCtx, base } = await scimOrg();
    const email = `scim-${newId().slice(-6)}@lagoon.mv`;
    const created = await o.tx(
      (tx) =>
        identity.scimCreateUser(tx, h.ports, base, {
          userName: email,
          externalId: 'entra-123',
          name: { givenName: 'Hassan', familyName: 'Ali' },
        }),
      scimCtx,
    );
    expect(created).toMatchObject({
      userName: email,
      displayName: 'Hassan Ali',
      active: true,
      externalId: 'entra-123',
    });
    await expect(
      o.tx((tx) => identity.scimCreateUser(tx, h.ports, base, { userName: email }), scimCtx),
    ).rejects.toMatchObject({
      status: 409,
      scimType: 'uniqueness',
    });
    const found = await o.tx(
      (tx) => identity.scimListUsers(tx, h.ports, base, { filter: `userName eq "${email.toUpperCase()}"` }),
      scimCtx,
    );
    expect(found.totalResults).toBe(1);
    await expect(
      o.tx((tx) => identity.scimListUsers(tx, h.ports, base, { filter: 'userName co "x"' }), scimCtx),
    ).rejects.toMatchObject({ scimType: 'invalidFilter' });
    // Give the person a password session (e.g. they were invited earlier) to prove deactivation cuts it off.
    await o.tx((tx) =>
      identity.assignRole(tx, { userId: created.id, roleKey: 'read_only', scopeType: 'organization' }),
    );
    await h.t.admin.kysely
      .updateTable('identity.users')
      .set({ password_hash: await identity.hashPassword(PASSWORD) })
      .where('id', '=', created.id)
      .execute();
    const s = await signIn(h, email);
    const off = await o.tx(
      (tx) =>
        identity.scimPatchUser(tx, h.ports, base, created.id, [
          { op: 'Replace', path: 'active', value: 'False' },
        ]),
      scimCtx,
    );
    expect(off.active).toBe(false);
    expect(await authenticate(h, s.token)).toBeNull();
    const on = await o.tx(
      (tx) =>
        identity.scimPatchUser(tx, h.ports, base, created.id, [{ op: 'replace', value: { active: true } }]),
      scimCtx,
    );
    expect(on.active).toBe(true);
    await expect(
      o.tx(
        (tx) => identity.scimReplaceUser(tx, h.ports, base, created.id, { userName: 'other@lagoon.mv' }),
        scimCtx,
      ),
    ).rejects.toMatchObject({ scimType: 'mutability' });
    await o.tx((tx) => identity.scimDeleteUser(tx, h.ports, created.id), scimCtx);
    expect((await o.tx((tx) => identity.getMember(tx, created.id))).status).toBe('removed');
    await expect(
      o.tx((tx) => identity.scimGetUser(tx, h.ports, base, created.id), scimCtx),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('group membership drives roles through the same mappings as SSO', async () => {
    const { o, p, scimCtx, base } = await scimOrg();
    const u = await o.tx(
      (tx) => identity.scimCreateUser(tx, h.ports, base, { userName: `hk-${newId().slice(-6)}@lagoon.mv` }),
      scimCtx,
    );
    const group = await o.tx(
      (tx) =>
        identity.scimCreateGroup(tx, h.ports, base, {
          displayName: 'Housekeeping',
          members: [{ value: u.id }],
        }),
      scimCtx,
    );
    expect(group.members).toHaveLength(1);
    const roles = async () =>
      (await o.tx((tx) => identity.getMember(tx, u.id))).assignments.map(
        (a) => `${a.roleKey}:${a.scopeId}:${a.source}`,
      );
    expect(await roles()).toEqual([`housekeeping_attendant:${p.id}:scim`]);
    await o.tx(
      (tx) =>
        identity.scimPatchGroup(tx, h.ports, base, group.id, [
          { op: 'remove', path: `members[value eq "${u.id}"]` },
        ]),
      scimCtx,
    );
    expect(await roles()).toEqual([]);
    await o.tx(
      (tx) =>
        identity.scimPatchGroup(tx, h.ports, base, group.id, [
          { op: 'add', path: 'members', value: [{ value: u.id }] },
        ]),
      scimCtx,
    );
    expect(await roles()).toHaveLength(1);
    await o.tx((tx) => identity.scimDeleteGroup(tx, h.ports, group.id), scimCtx);
    expect(await roles()).toEqual([]);
  });

  it('requires the SCIM permission and the identity.scim entitlement', async () => {
    const { o, base } = await scimOrg();
    const { token } = await o.tx((tx) =>
      identity.createApiClient(tx, { name: 'other', permissions: ['identity.user.read'] }),
    );
    const ctx = await authenticate(h, token);
    await expect(
      o.tx((tx) => identity.scimListUsers(tx, h.ports, base, {}), ctx ?? undefined),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const resortOrg = await scimOrg('resort');
    await expect(
      resortOrg.o.tx((tx) => identity.scimListUsers(tx, h.ports, base, {}), resortOrg.scimCtx),
    ).rejects.toMatchObject({ code: 'feature_not_enabled' });
  });
});
