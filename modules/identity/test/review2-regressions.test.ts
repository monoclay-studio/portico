/**
 * Regressions for the SECOND steward review (docs/orchestration/reviews/review-identity-plus-2.md) and ADR-0017
 * amendment 1 (rules 12-15). Each test replays a proof-of-concept attack from that review (N-1 … N-9) and asserts that
 * it is now REFUSED.
 */
import { newId } from '@portico/kernel';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identity } from '../src';
import { base32Decode, totp } from '../src/domain/totp';
import type { OidcHttpClient } from '../src/ports';
import { fakeIdp } from './fake-idp';
import {
  acceptInvitationFor,
  authenticate,
  type Harness,
  harness,
  invitationToken,
  org,
  PASSWORD,
  signIn,
  signInWithMfa,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => h?.t.drop());

const ATTACKER_PW = 'attacker-chosen-password';

// ───────────────────────────── SSO plumbing (several fake identity providers) ─────────────────────────────

type Idp = Awaited<ReturnType<typeof fakeIdp>>;
const idps = new Map<string, Idp>();
const router: OidcHttpClient = {
  getJson: (url) => {
    for (const [iss, idp] of idps) if (url.startsWith(iss)) return idp.http.getJson(url);
    throw new Error(`no idp for ${url}`);
  },
  postForm: (url, form, headers) => {
    for (const [iss, idp] of idps) if (url.startsWith(iss)) return idp.http.postForm(url, form, headers);
    throw new Error(`no idp for ${url}`);
  },
};
const txt = new Map<string, string[]>();
async function idpFor(issuer: string) {
  const idp = await fakeIdp(issuer, 'c', 'secret-secret');
  idps.set(issuer, idp);
  h.ports.oidcHttp = router;
  h.ports.dnsTxt = async (name) => txt.get(name) ?? [];
  return idp;
}
async function ssoSignIn(idp: Idp, organizationId: string, claims: Record<string, unknown>) {
  const start = await identity.startSsoLogin(h.t.db, h.ports, { organizationId });
  const { code, state } = idp.authorize(start.authorizationUrl, { email_verified: true, ...claims });
  return identity.completeSsoLogin(h.t.db, h.ports, { state, code, browserBinding: start.browserBinding });
}
async function ssoOrg(name: string, issuer: string, domains: string[], groups = ['staff']) {
  const o = await org(h, { name });
  await o.tx((tx) =>
    identity.configureSso(tx, h.ports, {
      displayName: name,
      issuer,
      clientId: 'c',
      clientSecret: 'secret-secret',
      allowedEmailDomains: domains,
    }),
  );
  await o.tx((tx) =>
    identity.setGroupRoleMappings(
      tx,
      h.ports,
      groups.map((g) => ({
        group: g,
        roleKey: g === 'admins' ? 'org_admin' : 'read_only',
        scopeType: 'organization' as const,
      })),
    ),
  );
  return o;
}
async function verifyDomain(o: Awaited<ReturnType<typeof org>>, domain: string) {
  const claim = await o.tx((tx) => identity.addSsoDomain(tx, domain));
  txt.set(claim.txtRecord.name, [claim.txtRecord.value]);
  await identity.verifySsoDomain(h.t.db, o.ctx, h.ports, domain);
}
const failures = async (tenantId: string) =>
  (
    await h.t.admin.kysely
      .selectFrom('core.audit_log')
      .select('reason')
      .where('tenant_id', '=', tenantId)
      .where('action', '=', 'identity.sso.loginFailed')
      .execute()
  ).map((r) => r.reason);

// ───────────────────────────── R2-P0-1 (rules 12-13) ─────────────────────────────

describe('R2-P0-1 / N-1: no organization can pre-register a person’s credentials', () => {
  it('createUser refuses a password; the pre-created identity has no sign-in; the real GM sets their own password from the link', async () => {
    const victimEmail = `gm-${newId().slice(-8)}@resort-victim.mv`;
    const trial = await org(h, { name: 'Attacker trial', environment: 'trial' });
    const attackerAdmin = await trial.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const a = await signInWithMfa(h, attackerAdmin.email);
    await expect(
      trial.tx(
        (tx) =>
          identity.createUser(tx, {
            email: victimEmail,
            displayName: 'GM',
            initialPassword: ATTACKER_PW,
            roles: [],
          } as Parameters<typeof identity.createUser>[1]),
        a.ctx,
      ),
    ).rejects.toMatchObject({ code: 'password_not_allowed' });
    const pre = await trial.tx(
      (tx) => identity.createUser(tx, { email: victimEmail, displayName: 'GM', roles: [] }, h.ports),
      a.ctx,
    );
    expect(pre.status).toBe('invited');
    await expect(identity.login(h.t.db, { email: victimEmail, password: ATTACKER_PW })).rejects.toMatchObject(
      { code: 'unauthenticated' },
    );

    const live = await org(h, { name: 'Real resort (live)' });
    const liveAdmin = await live.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const la = await signInWithMfa(h, liveAdmin.email);
    await live.tx(
      (tx) =>
        identity.inviteMember(tx, h.ports, {
          email: victimEmail,
          displayName: 'General manager',
          roles: [{ roleKey: 'org_admin', scopeType: 'organization' }],
        }),
      la.ctx,
    );
    // The link reaches only the GM; they choose their own password.
    await identity.acceptInvitation(h.t.db, h.ports, {
      token: invitationToken(h, victimEmail),
      password: 'the-real-gm-password',
    });
    const gm = await identity.login(h.t.db, {
      email: victimEmail,
      password: 'the-real-gm-password',
      organizationId: live.tenantId,
    });
    expect(gm.status).toBe('signed_in'); // no factor anyone else registered
  });

  it('an attacker IdP’s ghost identity (with a TOTP it enrolled) can neither see nor accept invitations, and the real person’s first link wipes it', async () => {
    const domain = `resort${newId().slice(-6)}.mv`;
    const email = `gm@${domain}`;
    const issuer = `https://idp-${newId().slice(-6)}.attacker.test`;
    const idp = await idpFor(issuer);
    const attacker = await ssoOrg('Attacker SSO org', issuer, [domain]); // allow-list only, never verified
    const ghost = await ssoSignIn(idp, attacker.tenantId, {
      sub: 'ghost',
      email,
      groups: ['staff'],
      amr: ['mfa'],
    });
    const ghostCtx = await authenticate(h, ghost.token);
    if (!ghostCtx) throw new Error('no ghost session');
    const enrol = await attacker.tx((tx) => identity.enrolTotp(tx, h.ports, {}), ghostCtx);
    if (!enrol.ok) throw enrol.error;
    const attackerSecret = base32Decode(enrol.value.secret);
    const confirmed = await attacker.tx(
      (tx) => identity.confirmTotp(tx, h.ports, { code: totp(attackerSecret, h.clock.now()) }),
      ghostCtx,
    );
    expect(confirmed.ok).toBe(true);

    const live = await org(h, { name: 'Real resort' });
    await live.tx((tx) =>
      identity.inviteMember(tx, h.ports, {
        email,
        displayName: 'GM',
        roles: [{ roleKey: 'org_admin', scopeType: 'organization' }],
      }),
    );
    // Rule 13: an identity whose email nobody proved sees no invitation and cannot accept one in-app.
    const ghostNow = await authenticate(h, ghost.token);
    if (!ghostNow) throw new Error('ghost session lost early');
    expect(await identity.listMyInvitations(h.t.db, ghostNow.actor)).toEqual([]);
    await expect(
      identity.acceptMembershipAsSelf(h.t.db, ghostNow.actor, live.tenantId),
    ).rejects.toMatchObject({
      code: 'email_not_verified',
    });
    // The real GM follows the emailed link: the first verification wipes the ghost's factor, link and sessions.
    await acceptInvitationFor(h, email, 'the-real-gm-password');
    expect(await authenticate(h, ghost.token)).toBeNull();
    const gm = await identity.login(h.t.db, {
      email,
      password: 'the-real-gm-password',
      organizationId: live.tenantId,
    });
    expect(gm.status).toBe('signed_in'); // the attacker's authenticator is gone
    // The attacker's IdP cannot sign in as the GM again.
    await expect(
      ssoSignIn(idp, attacker.tenantId, { sub: 'ghost', email, groups: ['staff'], amr: ['mfa'] }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(await failures(attacker.tenantId)).toContain('existing_credentials_require_proof');
  });

  it('N-1b: the resort’s own verified-domain SSO verifies the GM and wipes anything another organization set before', async () => {
    const domain = `resort${newId().slice(-6)}.mv`;
    const email = `gm@${domain}`;
    const attackerIssuer = `https://idp-${newId().slice(-6)}.attacker.test`;
    const attackerIdp = await idpFor(attackerIssuer);
    const attacker = await ssoOrg('Attacker SSO org B', attackerIssuer, [domain]);
    const ghost = await ssoSignIn(attackerIdp, attacker.tenantId, { sub: 'ghost', email, groups: ['staff'] });
    const ghostCtx = await authenticate(h, ghost.token);
    if (!ghostCtx) throw new Error('no ghost session');
    const enrol = await attacker.tx((tx) => identity.enrolTotp(tx, h.ports, {}), ghostCtx);
    if (!enrol.ok) throw enrol.error;
    await attacker.tx(
      (tx) =>
        identity.confirmTotp(tx, h.ports, { code: totp(base32Decode(enrol.value.secret), h.clock.now()) }),
      ghostCtx,
    );

    const resortIssuer = `https://login.${domain}`;
    const resortIdp = await idpFor(resortIssuer);
    const resort = await ssoOrg('Resort with SSO', resortIssuer, [domain], ['admins']);
    await resort.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    await verifyDomain(resort, domain);
    const gm = await ssoSignIn(resortIdp, resort.tenantId, {
      sub: 'gm-1',
      email,
      groups: ['admins'],
      amr: ['mfa'],
    });
    expect(gm.organization.id).toBe(resort.tenantId);
    const status = await resort.tx((tx) => identity.mfaStatus(tx, gm.userId));
    expect(status.enrolled).toBe(false); // the attacker's authenticator did not survive the verification
    expect(await authenticate(h, ghost.token)).toBeNull();
    await expect(
      ssoSignIn(attackerIdp, attacker.tenantId, { sub: 'ghost', email, groups: ['staff'] }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('demo seeding sets passwords only in a demo organization, for *.portico.invalid addresses', async () => {
    const live = await org(h);
    await expect(
      live.tx((tx) =>
        identity.seedDemoMember(tx, {
          email: `x-${newId().slice(-6)}@demo.portico.invalid`,
          displayName: 'x',
          password: PASSWORD,
          roles: [],
        }),
      ),
    ).rejects.toMatchObject({ code: 'password_not_allowed' });
    const demo = await org(h, { environment: 'trial' });
    await expect(
      demo.tx((tx) =>
        identity.seedDemoMember(tx, {
          email: 'gm@real-hotel.mv',
          displayName: 'x',
          password: PASSWORD,
          roles: [],
        }),
      ),
    ).rejects.toMatchObject({ code: 'password_not_allowed' });
  });
});

// ───────────────────────────── R2-P1-1 (rule 15) ─────────────────────────────

describe('R2-P1-1 / N-2: SSO root settings are root changes', () => {
  it('identity.sso.manage alone cannot repoint the issuer; an issuer change resets domains, alerts admins, and never links credentialed members', async () => {
    const o = await org(h, { name: 'Resort N2' });
    const adminEmail = `owner-${newId().slice(-6)}@lagoon.mv`;
    const admin = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }], adminEmail);
    const ad = await signInWithMfa(h, admin.email);
    await o.tx(
      (tx) =>
        identity.createRole(tx, h.ports, {
          key: 'sso_admin',
          name: 'SSO administrator',
          permissions: ['identity.sso.manage', 'identity.user.read'],
        }),
      ad.ctx,
    );
    const itStaff = await o.member([{ roleKey: 'sso_admin', scopeType: 'organization' }]);
    const s = await signInWithMfa(h, itStaff.email);
    const rogueIssuer = `https://idp-${newId().slice(-6)}.insider.test`;
    const rogue = await idpFor(rogueIssuer);
    const config = {
      displayName: 'New IdP',
      issuer: rogueIssuer,
      clientId: 'c',
      clientSecret: 'secret-secret',
      allowedEmailDomains: ['lagoon.mv'],
    };
    await expect(o.tx((tx) => identity.configureSso(tx, h.ports, config), s.ctx)).rejects.toMatchObject({
      code: 'forbidden',
    });
    // Even a full administrator's issuer change cannot be used to sign in as a member who has credentials.
    const firstIssuer = `https://login-${newId().slice(-6)}.lagoon.test`;
    await idpFor(firstIssuer);
    await o.tx((tx) => identity.configureSso(tx, h.ports, { ...config, issuer: firstIssuer }), ad.ctx);
    await verifyDomain(o, 'lagoon.mv');
    const conn = await o.tx((tx) => identity.getSsoConnection(tx));
    const sentBefore = h.sent.length;
    await o.tx(
      (tx) => identity.configureSso(tx, h.ports, config, conn?.version),
      (await authenticate(h, ad.token)) ?? ad.ctx,
    );
    expect((await o.tx((tx) => identity.listSsoDomains(tx)))[0]?.verified).toBe(false); // re-confirm
    expect((await o.tx((tx) => identity.listSecurityAlerts(tx))).map((x) => x.rule)).toContain(
      'sso_root_change',
    );
    expect(h.sent.slice(sentBefore).some((m) => m.kind === 'staff.securityAlert')).toBe(true);
    await expect(
      ssoSignIn(rogue, o.tenantId, { sub: 'anything', email: adminEmail, amr: ['mfa'] }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(await failures(o.tenantId)).toContain('existing_credentials_require_proof');
  });

  it('requiring SSO is a root change', async () => {
    const issuer = `https://login-${newId().slice(-6)}.lagoon.test`;
    await idpFor(issuer);
    const o = await ssoOrg('Resort N2b', issuer, ['lagoon.mv']);
    const admin = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const ad = await signInWithMfa(h, admin.email);
    await o.tx(
      (tx) =>
        identity.createRole(tx, h.ports, {
          key: 'sso_admin',
          name: 'SSO administrator',
          permissions: ['identity.sso.manage', 'identity.user.read'],
        }),
      ad.ctx,
    );
    const itStaff = await o.member([{ roleKey: 'sso_admin', scopeType: 'organization' }]);
    const s = await signInWithMfa(h, itStaff.email);
    await expect(
      o.tx(
        (tx) => identity.setSsoEnforcement(tx, { ssoRequired: true, exemptUserIds: [itStaff.userId] }),
        s.ctx,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

// ───────────────────────────── R2-P1-2 (rule 14) ─────────────────────────────

describe('R2-P1-2 / N-5: no organization can block a person from joining another', () => {
  it('a griefer’s earlier invitation does not stop the real link from setting the first password', async () => {
    const email = `newhire-${newId().slice(-8)}@resort-victim.mv`;
    const trial = await org(h, { name: 'Griefer trial', environment: 'trial' });
    await trial.tx((tx) => identity.inviteMember(tx, h.ports, { email, displayName: 'x', roles: [] }));
    const live = await org(h, { name: 'Real resort N5' });
    await live.tx((tx) =>
      identity.inviteMember(tx, h.ports, {
        email,
        displayName: 'New hire',
        roles: [{ roleKey: 'read_only', scopeType: 'organization' }],
      }),
    );
    await identity.acceptInvitation(h.t.db, h.ports, {
      token: invitationToken(h, email),
      password: 'a-good-new-password',
    });
    const s = await identity.login(h.t.db, {
      email,
      password: 'a-good-new-password',
      organizationId: live.tenantId,
    });
    expect(s.status).toBe('signed_in');
  });

  it('"forgot password" reaches a person who only holds invitations', async () => {
    const email = `invited-only-${newId().slice(-8)}@resort.mv`;
    const live = await org(h, { name: 'Inviting resort' });
    await live.tx((tx) => identity.inviteMember(tx, h.ports, { email, displayName: 'x', roles: [] }));
    const before = h.sent.length;
    await identity.requestPasswordReset(h.t.db, h.ports, { email });
    expect(h.sent.slice(before).map((m) => [m.kind, m.to])).toEqual([['staff.passwordReset', email]]);
  });
});

// ───────────────────────────── R2-P1-3 (rule 15) ─────────────────────────────

describe('R2-P1-3 / N-7: an SSO link created before the person exists cannot bypass the verified-domain gate', () => {
  it('a refused JIT persists neither user nor link; later the attacker IdP still cannot activate the real person', async () => {
    const domain = `hotel${newId().slice(-6)}.mv`;
    const email = `gm@${domain}`;
    const issuer = `https://idp-${newId().slice(-6)}.attacker.test`;
    const idp = await idpFor(issuer);
    const attacker = await ssoOrg('Attacker SSO org N7', issuer, [domain]);
    await expect(
      ssoSignIn(idp, attacker.tenantId, { sub: 'pre-link', email, groups: ['none'] }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    const ghost = await h.t.admin.kysely
      .selectFrom('identity.users')
      .select('id')
      .where('email', '=', email)
      .executeTakeFirst();
    expect(ghost).toBeUndefined();
    const links = await h.t.admin.kysely
      .selectFrom('identity.sso_identities')
      .select('id')
      .where('tenant_id', '=', attacker.tenantId)
      .execute();
    expect(links).toHaveLength(0);
    expect(await failures(attacker.tenantId)).toContain('no_mapped_group');

    const hotel = await org(h, { name: 'Real hotel N7' });
    await hotel.tx((tx) =>
      identity.inviteMember(tx, h.ports, {
        email,
        displayName: 'GM',
        roles: [{ roleKey: 'org_admin', scopeType: 'organization' }],
      }),
    );
    await acceptInvitationFor(h, email, 'the-real-gm-password');
    await expect(
      ssoSignIn(idp, attacker.tenantId, { sub: 'pre-link', email, groups: ['staff'] }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    const users = await attacker.tx((tx) => identity.listUsers(tx));
    expect(users.map((u) => u.email)).not.toContain(email);
  });

  it('the verified-domain check also runs when an EXISTING link would activate a membership', async () => {
    const domain = `crew${newId().slice(-6)}.mv`;
    const email = `chef@${domain}`;
    const issuer = `https://idp-${newId().slice(-6)}.crew.test`;
    const idp = await idpFor(issuer);
    const o = await ssoOrg('Unverified SSO org', issuer, [domain]);
    // A brand-new person is JIT-provisioned (sole organization: allowed without a verified domain).
    const first = await ssoSignIn(idp, o.tenantId, { sub: 'chef', email, groups: ['staff'] });
    // Removed, and meanwhile they join another organization through its emailed invitation.
    await o.tx((tx) => identity.removeMember(tx, first.userId, 'left'));
    const other = await org(h, { name: 'Other employer' });
    await other.tx((tx) => identity.inviteMember(tx, h.ports, { email, displayName: 'Chef', roles: [] }));
    await acceptInvitationFor(h, email, 'chef-own-password-1');
    // Re-provisioning through the old IdP account is refused: the person works elsewhere and the domain is unverified.
    await o.tx((tx) => identity.inviteMember(tx, h.ports, { email, displayName: 'Chef', roles: [] }));
    await expect(ssoSignIn(idp, o.tenantId, { sub: 'chef', email, groups: ['staff'] })).rejects.toMatchObject(
      {
        code: 'unauthenticated',
      },
    );
  });
});

// ───────────────────────────── R2-P2-1 ─────────────────────────────

describe('R2-P2-1 / N-4: the per-person second-factor limit holds under concurrency', () => {
  it('a concurrent burst of wrong codes is cut off after five', async () => {
    const o = await org(h, { name: 'Race org' });
    const m = await o.member([{ roleKey: 'front_desk', scopeType: 'organization' }]);
    await signInWithMfa(h, m.email);
    const N = 8;
    const challenges: string[] = [];
    for (let i = 0; i < N; i++) {
      const r = await identity.login(h.t.db, { email: m.email, password: PASSWORD });
      if (r.status !== 'mfa_required') throw new Error(r.status);
      challenges.push(r.challengeToken);
    }
    const results = await Promise.allSettled(
      challenges.map((challengeToken) =>
        identity.completeMfaChallenge(h.t.db, h.ports, { challengeToken, code: '000000' }),
      ),
    );
    const codes = results.map((r) => (r.status === 'rejected' ? (r.reason as { code?: string }).code : 'ok'));
    expect(codes.filter((c) => c === 'unauthenticated').length).toBeLessThanOrEqual(5);
    expect(codes).toContain('second_factor_locked');
    const { mfa_failed_attempts } = await h.t.admin.kysely
      .selectFrom('identity.users')
      .select('mfa_failed_attempts')
      .where('id', '=', m.userId)
      .executeTakeFirstOrThrow();
    expect(mfa_failed_attempts).toBeLessThanOrEqual(5);
  });
});

// ───────────────────────────── R2-P2-2 ─────────────────────────────

describe('R2-P2-2 / N-6: transferMember is power-ordered and property-scoped', () => {
  it('a role assigner scoped to property Y cannot strip a manager of property X by "transferring" them', async () => {
    const o = await org(h, { name: 'Group N6' });
    const X = await o.property(`X${newId().slice(-4)}`);
    const Y = await o.property(`Y${newId().slice(-4)}`);
    const admin = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const ad = await signInWithMfa(h, admin.email);
    await o.tx(
      (tx) =>
        identity.createRole(tx, h.ports, {
          key: 'prop_mgr',
          name: 'Property manager',
          permissions: ['platform.property.read', 'platform.property.update'],
        }),
      ad.ctx,
    );
    await o.tx(
      (tx) =>
        identity.createRole(tx, h.ports, {
          key: 'y_admin',
          name: 'Property Y staff admin',
          permissions: [
            'identity.role.assign',
            'identity.user.read',
            'platform.property.read',
            'platform.property.update',
          ],
        }),
      ad.ctx,
    );
    const managerX = await o.member([{ roleKey: 'prop_mgr', scopeType: 'property', scopeId: X.id }]);
    const actor = await o.member([{ roleKey: 'y_admin', scopeType: 'property', scopeId: Y.id }]);
    const s = await signInWithMfa(h, actor.email);
    await expect(
      o.tx(
        (tx) =>
          identity.transferMember(tx, h.ports, {
            userId: managerX.userId,
            fromPropertyId: X.id,
            toPropertyId: Y.id,
            reason: 'moved',
          }),
        s.ctx,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const after = await o.tx((tx) => identity.getMember(tx, managerX.userId));
    expect(after.assignments.some((a) => a.scopeId === X.id)).toBe(true);
    // Nobody transfers themselves.
    await expect(
      o.tx(
        (tx) =>
          identity.transferMember(tx, h.ports, {
            userId: admin.userId,
            fromPropertyId: X.id,
            toPropertyId: Y.id,
            reason: 'self',
          }),
        ad.ctx,
      ),
    ).rejects.toMatchObject({ code: 'segregation_of_duties' });
  });
});

// ───────────────────────────── R2-P2-3 ─────────────────────────────

describe('R2-P2-3 / N-8: group reconciliation never removes the last administrator', () => {
  it('SSO: a sign-in without the admin group keeps the only administrator and raises a high alert', async () => {
    const domain = `solo${newId().slice(-6)}.mv`;
    const issuer = `https://login.${domain}`;
    const idp = await idpFor(issuer);
    const o = await ssoOrg('SSO-only org', issuer, [domain], ['admins', 'staff']);
    const first = await ssoSignIn(idp, o.tenantId, {
      sub: 'boss',
      email: `boss@${domain}`,
      groups: ['admins'],
      amr: ['mfa'],
    });
    expect((await authenticate(h, first.token))?.authz.can('identity.role.assign')).toBe(true);
    const second = await ssoSignIn(idp, o.tenantId, {
      sub: 'boss',
      email: `boss@${domain}`,
      groups: ['staff'],
      amr: ['mfa'],
    });
    expect((await authenticate(h, second.token))?.authz.can('identity.role.assign')).toBe(true);
    const alerts = await o.tx((tx) => identity.listSecurityAlerts(tx));
    expect(alerts.find((a) => a.rule === 'last_administrator_kept')).toMatchObject({ severity: 'high' });
  });

  it('SCIM: removing the only administrator from the mapped group keeps the role', async () => {
    const o = await org(h, { name: 'SCIM-only org' });
    await o.tx((tx) =>
      identity.setGroupRoleMappings(tx, h.ports, [
        { group: 'Admins', roleKey: 'org_admin', scopeType: 'organization' },
      ]),
    );
    const { token } = await o.tx((tx) =>
      identity.createApiClient(tx, { name: 'IdP provisioning', permissions: ['identity.scim.provision'] }),
    );
    const scim = await authenticate(h, token);
    if (!scim) throw new Error('no SCIM client');
    const base = 'https://api.portico.test/v1/scim/v2';
    const u = await o.tx(
      (tx) => identity.scimCreateUser(tx, h.ports, base, { userName: `it-${newId().slice(-6)}@lagoon.mv` }),
      scim,
    );
    const group = await o.tx(
      (tx) =>
        identity.scimCreateGroup(tx, h.ports, base, { displayName: 'Admins', members: [{ value: u.id }] }),
      scim,
    );
    await o.tx(
      (tx) =>
        identity.scimPatchGroup(tx, h.ports, base, group.id, [
          { op: 'remove', path: `members[value eq "${u.id}"]` },
        ]),
      scim,
    );
    const member = await o.tx((tx) => identity.getMember(tx, u.id));
    expect(member.assignments.map((a) => a.roleKey)).toContain('org_admin');
  });
});

// ───────────────────────────── R2-P2-4 ─────────────────────────────

describe('R2-P2-4 / N-9: an administrator cannot mint a second identity to satisfy separation of duties', () => {
  it('the account they create has no password they know; it cannot sign in, let alone approve', async () => {
    const o = await org(h, { name: 'SoD org' });
    const p = await o.property(`S${newId().slice(-5)}`);
    const admin = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const a = await signInWithMfa(h, admin.email);
    await o.tx(
      (tx) =>
        platform.requestStatusChange(tx, {}, p.id, {
          toStatus: 'pilot',
          reason: 'pilot',
          scope: {
            effects: [{ effect: 'integration.read' }],
            workflows: ['operations.housekeepingBoard'],
            modules: ['operations'],
            startsOn: '2026-11-01',
            endsOn: '2027-01-31',
            successCriteria: 'x',
            rollbackPlan: 'y',
          },
        }),
      a.ctx,
    );
    const puppetEmail = `second-${newId().slice(-6)}@lagoon.mv`;
    await expect(
      o.tx(
        (tx) =>
          identity.createUser(tx, {
            email: puppetEmail,
            displayName: 'Deputy',
            initialPassword: PASSWORD,
            roles: [{ roleKey: 'org_admin', scopeType: 'organization' }],
          } as Parameters<typeof identity.createUser>[1]),
        a.ctx,
      ),
    ).rejects.toMatchObject({ code: 'password_not_allowed' });
    await o.tx(
      (tx) =>
        identity.createUser(
          tx,
          {
            email: puppetEmail,
            displayName: 'Deputy',
            roles: [{ roleKey: 'org_admin', scopeType: 'organization' }],
          },
          h.ports,
        ),
      a.ctx,
    );
    await expect(signIn(h, puppetEmail)).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

// ───────────────────────────── Cheap P3s ─────────────────────────────

describe('R2-P3: invitations expire, confirmation is capped, bindings checked first, one email parser, no disclosure', () => {
  // SSO first: the fake IdP signs with real time, and the tests below move the clock forward.
  it('P3-8: a wrong browser binding does not burn the real login; P3-4: a malformed email is refused', async () => {
    const domain = `bind${newId().slice(-6)}.mv`;
    const issuer = `https://login.${domain}`;
    const idp = await idpFor(issuer);
    const o = await ssoOrg('Binding org', issuer, [domain]);
    const start = await identity.startSsoLogin(h.t.db, h.ports, { organizationId: o.tenantId });
    const { code, state } = idp.authorize(start.authorizationUrl, {
      email_verified: true,
      sub: 'b1',
      email: `b1@${domain}`,
      groups: ['staff'],
    });
    await expect(
      identity.completeSsoLogin(h.t.db, h.ports, { state, code, browserBinding: 'stolen-elsewhere-xx' }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    const ok = await identity.completeSsoLogin(h.t.db, h.ports, {
      state,
      code,
      browserBinding: start.browserBinding,
    });
    expect(ok.status).toBe('signed_in');
    await expect(
      ssoSignIn(idp, o.tenantId, { sub: 'b2', email: `x@evil.mv@${domain}`, groups: ['staff'] }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(await failures(o.tenantId)).toContain('email_or_subject_missing');
  });

  it('P3-3: an expired invitation is neither listed nor accepted in-app', async () => {
    const home = await org(h);
    const person = await home.member([]);
    const s = await signIn(h, person.email);
    const other = await org(h, { name: 'Late inviter' });
    await other.tx((tx) =>
      identity.inviteMember(tx, h.ports, { email: person.email, displayName: 'x', roles: [] }),
    );
    expect((await identity.listMyInvitations(h.t.db, s.ctx.actor)).map((i) => i.organizationId)).toContain(
      other.tenantId,
    );
    h.clock.advance(8 * 86_400_000);
    const fresh = await signIn(h, person.email);
    expect(await identity.listMyInvitations(h.t.db, fresh.ctx.actor)).toEqual([]);
    await expect(
      identity.acceptMembershipAsSelf(h.t.db, fresh.ctx.actor, other.tenantId),
    ).rejects.toMatchObject({
      code: 'invitation_expired',
    });
  });

  it('P3-2: five wrong confirmation codes discard the pending authenticator', async () => {
    const o = await org(h);
    const m = await o.member([]);
    const s = await signIn(h, m.email);
    const started = await o.tx((tx) => identity.enrolTotp(tx, h.ports, { currentPassword: PASSWORD }), s.ctx);
    if (!started.ok) throw started.error;
    for (let i = 0; i < 5; i++) {
      const r = await o.tx((tx) => identity.confirmTotp(tx, h.ports, { code: '000000' }), s.ctx);
      expect(r.ok).toBe(false);
      h.clock.advance(2 * 60_000); // past the per-person delay
    }
    const right = totp(base32Decode(started.value.secret), h.clock.now());
    await expect(
      o.tx((tx) => identity.confirmTotp(tx, h.ports, { code: right }), s.ctx),
    ).rejects.toMatchObject({
      code: 'no_pending_enrolment',
    });
  });

  it('P3-6: an invited person’s credentials are not shown to the inviting organization', async () => {
    const home = await org(h);
    const person = await home.member([]);
    await signInWithMfa(h, person.email);
    const other = await org(h);
    await other.tx((tx) =>
      identity.inviteMember(tx, h.ports, { email: person.email, displayName: 'x', roles: [] }),
    );
    const detail = await other.tx((tx) => identity.getMember(tx, person.userId));
    expect(detail.mfa).toBeNull();
    // and the answer looks the same for a brand-new email
    const fresh = await other.tx((tx) =>
      identity.createUser(
        tx,
        { email: `n-${newId().slice(-6)}@lagoon.mv`, displayName: 'n', roles: [] },
        h.ports,
      ),
    );
    const third = await org(h);
    const existing = await third.tx((tx) =>
      identity.createUser(tx, { email: person.email, displayName: 'e', roles: [] }, h.ports),
    );
    expect(Object.keys(fresh).sort()).toEqual(Object.keys(existing).sort());
    expect(fresh.status).toBe(existing.status);
  });
});
