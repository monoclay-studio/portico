/**
 * SSO regressions from the steward review (P0-2b, P1-8, P2-2) and ADR-0017 §4–5: an organization's identity
 * provider cannot claim people of a domain it has not proven it owns, sign-in is bound to (issuer, sub), and an
 * SSO session never counts as proof for a person's global credentials.
 */
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identity } from '../src';
import { fakeIdp } from './fake-idp';
import { authenticate, type Harness, harness, nextTotp, org, PASSWORD, signInWithMfa } from './harness';

let h: Harness;
let idp: Awaited<ReturnType<typeof fakeIdp>>;
const issuer = 'https://idp.attacker.test';
const txt = new Map<string, string[]>();
beforeAll(async () => {
  idp = await fakeIdp(issuer, 'c', 'secret-secret');
  h = await harness({ oidcHttp: undefined });
  h.ports.oidcHttp = idp.http;
  h.ports.dnsTxt = async (name) => txt.get(name) ?? [];
});
afterAll(async () => h?.t.drop());

async function ssoOrg(domains: string[]) {
  const o = await org(h);
  await o.tx((tx) =>
    identity.configureSso(tx, h.ports, {
      displayName: 'IdP',
      issuer,
      clientId: 'c',
      clientSecret: 'secret-secret',
      allowedEmailDomains: domains,
    }),
  );
  await o.tx((tx) =>
    identity.setGroupRoleMappings(tx, h.ports, [
      { group: 'g', roleKey: 'read_only', scopeType: 'organization' },
    ]),
  );
  const login = async (claims: Record<string, unknown>) => {
    const start = await identity.startSsoLogin(h.t.db, h.ports, { organizationId: o.tenantId });
    const { code, state } = idp.authorize(start.authorizationUrl, {
      email_verified: true,
      groups: ['g'],
      ...claims,
    });
    return identity.completeSsoLogin(h.t.db, h.ports, { state, code, browserBinding: start.browserBinding });
  };
  const failures = async () =>
    (
      await h.t.admin.kysely
        .selectFrom('core.audit_log')
        .select('reason')
        .where('tenant_id', '=', o.tenantId)
        .where('action', '=', 'identity.sso.loginFailed')
        .execute()
    ).map((r) => r.reason);
  return { o, login, failures };
}

describe('P0-2b: an organization’s SSO cannot assert another organization’s member', () => {
  it('without a verified domain the attacker’s IdP cannot sign in as (or rewrite the MFA of) a live-org admin', async () => {
    const live = await org(h, { name: 'Victim resort' });
    const victimEmail = `gm-${newId().slice(-6)}@victim.mv`;
    const victim = await live.member([{ roleKey: 'org_admin', scopeType: 'organization' }], victimEmail);
    const v = await signInWithMfa(h, victim.email);

    const attacker = await ssoOrg(['victim.mv']);
    await expect(
      attacker.login({ email: victimEmail, sub: `attacker-${newId()}`, amr: ['mfa'] }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(await attacker.failures()).toContain('existing_account_requires_verified_domain');

    // The attacker cannot prove the domain either: the TXT record lives in the victim's DNS.
    const claim = await attacker.o.tx((tx) => identity.addSsoDomain(tx, 'victim.mv'));
    expect(claim.txtRecord.name).toBe('_portico-verification.victim.mv');
    await expect(
      identity.verifySsoDomain(h.t.db, attacker.o.ctx, h.ports, 'victim.mv'),
    ).rejects.toMatchObject({ code: 'domain_not_verified' });

    // The victim's own authenticator still protects the live organization.
    const login = await identity.login(h.t.db, {
      email: victimEmail,
      password: PASSWORD,
      organizationId: live.tenantId,
    });
    if (login.status !== 'mfa_required') throw new Error(login.status);
    const ok = await identity.completeMfaChallenge(h.t.db, h.ports, {
      challengeToken: login.challengeToken,
      code: nextTotp(h, v.secret),
    });
    expect(ok.status).toBe('signed_in');
  });

  it('with a verified domain, the SSO session still cannot change the person’s global MFA', async () => {
    const domain = `hotel-${newId().slice(-6)}.mv`;
    const home = await org(h);
    const person = await home.member([], `chef@${domain}`);
    await signInWithMfa(h, person.email);
    const group = await ssoOrg([domain]);
    const claimed = await group.o.tx((tx) => identity.addSsoDomain(tx, domain));
    txt.set(claimed.txtRecord.name, [claimed.txtRecord.value]);
    expect((await identity.verifySsoDomain(h.t.db, group.o.ctx, h.ports, domain)).verified).toBe(true);
    const s = await group.login({ email: person.email, sub: `entra-${newId()}`, amr: ['mfa'] });
    expect(s.userId).toBe(person.userId);
    const ctx = await authenticate(h, s.token);
    if (!ctx) throw new Error('no session');
    // ADR-0017 §4: an organization's IdP never counts as proof for a global credential.
    const replace = await group.o.tx((tx) => identity.enrolTotp(tx, h.ports, {}), ctx);
    expect(replace).toMatchObject({ ok: false, error: { code: 'proof_required' } });
    const off = await group.o.tx((tx) => identity.disableOwnMfa(tx, h.ports, {}), ctx);
    expect(off).toMatchObject({ ok: false, error: { code: 'proof_required' } });
    // Nor can that organization reset it: the person works elsewhere too.
    await expect(
      group.o.tx((tx) => identity.resetMemberMfa(tx, person.userId, 'lost phone', h.ports)),
    ).rejects.toMatchObject({ code: 'person_shared_with_other_organization' });
  });
});

describe('P1-8: SSO identity is bound to (issuer, sub), not to the email claim', () => {
  it('a second IdP account that takes a member’s email cannot sign in as them; the first keeps its link', async () => {
    const domain = `crew-${newId().slice(-6)}.mv`;
    const g = await ssoOrg([domain]);
    const aisha = `aisha@${domain}`;
    const first = await g.login({ email: aisha, sub: 'S-1' });
    const admin = await g.login({ email: `admin@${domain}`, sub: 'S-ADMIN' });
    // An IdP user who can edit their own email attribute (nOAuth) claims Aisha's address.
    await expect(g.login({ email: aisha, sub: 'S-2' })).rejects.toMatchObject({ code: 'unauthenticated' });
    // Aisha's own account changes email: still Aisha (matched by sub)…
    const renamed = await g.login({ email: `aisha.ibrahim@${domain}`, sub: 'S-1' });
    expect(renamed.userId).toBe(first.userId);
    // …but it cannot become the admin by taking the admin's address.
    await expect(g.login({ email: `admin@${domain}`, sub: 'S-1' })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(admin.userId).not.toBe(first.userId);
    expect(await g.failures()).toEqual(
      expect.arrayContaining(['person_linked_to_another_subject', 'email_belongs_to_another_person']),
    );
  });

  it('refuses tokens without email_verified', async () => {
    const domain = `nv-${newId().slice(-6)}.mv`;
    const g = await ssoOrg([domain]);
    await expect(
      g.login({ email: `x@${domain}`, sub: 'S-x', email_verified: undefined }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(await g.failures()).toContain('email_not_verified');
  });
});

describe('P2-2: identity-provider addresses are vetted', () => {
  it('refuses local and non-https issuers unless local development is explicitly allowed', async () => {
    const o = await org(h);
    for (const bad of ['http://idp.lagoon.mv', 'https://localhost', 'http://127.0.0.1:8080'])
      await expect(
        o.tx((tx) =>
          identity.configureSso(tx, h.ports, {
            displayName: 'x',
            issuer: bad,
            clientId: 'c',
            clientSecret: 's',
            allowedEmailDomains: ['lagoon.mv'],
          }),
        ),
      ).rejects.toMatchObject({ code: 'insecure_url' });
  });
});
