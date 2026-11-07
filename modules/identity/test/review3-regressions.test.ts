/**
 * Regressions for the THIRD steward review (docs/orchestration/reviews/review-identity-plus-3.md). Each test replays a
 * proof-of-concept attack W-1 … W-6 and asserts that it is now REFUSED.
 */
import { sql } from '@portico/db';
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identity, ssoDomainRecheckJob } from '../src';
import { base32Decode, totp } from '../src/domain/totp';
import type { OidcHttpClient } from '../src/ports';
import { fakeIdp } from './fake-idp';
import { authenticate, type Harness, harness, invitationToken, org, signIn, signInWithMfa } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => h?.t.drop());

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
/** An organization with SSO (allow-list only) and JIT; `admins` → org_admin, `staff` → read_only. */
async function ssoOrg(name: string, domain: string) {
  const issuer = `https://idp-${newId().slice(-8)}.${domain}`;
  const idp = await idpFor(issuer);
  const o = await org(h, { name });
  await o.tx((tx) =>
    identity.configureSso(tx, h.ports, {
      displayName: name,
      issuer,
      clientId: 'c',
      clientSecret: 'secret-secret',
      allowedEmailDomains: [domain],
    }),
  );
  await o.tx((tx) =>
    identity.setGroupRoleMappings(tx, h.ports, [
      { group: 'admins', roleKey: 'org_admin', scopeType: 'organization' },
      { group: 'staff', roleKey: 'read_only', scopeType: 'organization' },
    ]),
  );
  return { o, idp, issuer };
}
async function verifyDomain(o: Awaited<ReturnType<typeof org>>, domain: string) {
  const claim = await o.tx((tx) => identity.addSsoDomain(tx, domain));
  txt.set(claim.txtRecord.name, [claim.txtRecord.value]);
  return { claim, verified: await identity.verifySsoDomain(h.t.db, o.ctx, h.ports, domain) };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * W-1's TEST-ONLY timing trigger: widens the real window of a first verification (argon2 + the wipe, ~50-100 ms in
 * production) to 1.5 s so the interleaving is deterministic. It changes timing only, never logic.
 */
async function withSlowFirstVerification<T>(fn: () => Promise<T>): Promise<T> {
  await sql`create or replace function identity.zz_slow_verify() returns trigger language plpgsql as $$
    begin
      if old.email_verified_at is null and new.email_verified_at is not null then perform pg_sleep(1.5); end if;
      return new;
    end $$`.execute(h.t.admin.kysely);
  await sql`create trigger zz_slow_verify after update on identity.users
    for each row execute function identity.zz_slow_verify()`.execute(h.t.admin.kysely);
  try {
    return await fn();
  } finally {
    await sql`drop trigger zz_slow_verify on identity.users`.execute(h.t.admin.kysely);
  }
}

/** The attacker org mints the GM's identity through its own SSO and keeps an active factor A and a pending factor P. */
async function ghostWithPendingFactor(domain: string) {
  const gmEmail = `gm@${domain}`;
  const { o: x, idp } = await ssoOrg('Attacker org', domain);
  const ghost = await ssoSignIn(idp, x.tenantId, { sub: 'ghost', email: gmEmail, groups: ['staff'] });
  const g = await authenticate(h, ghost.token);
  if (!g) throw new Error('no ctx');
  const a = await x.tx((tx) => identity.enrolTotp(tx, h.ports, {}), g);
  if (!a.ok) throw a.error;
  const ca = await x.tx(
    (tx) => identity.confirmTotp(tx, h.ports, { code: totp(base32Decode(a.value.secret), h.clock.now()) }),
    g,
  );
  if (!ca.ok) throw ca.error;
  const p = await x.tx(
    (tx) => identity.enrolTotp(tx, h.ports, { recoveryCode: ca.value.recoveryCodes[0] as string }),
    g,
  );
  if (!p.ok) throw p.error;
  return { x, idp, gmEmail, ghost, pSecret: base32Decode(p.value.secret) };
}

async function hotelInvitesGm(gmEmail: string) {
  const hotel = await org(h, { name: 'Real hotel (live)' });
  const hotelAdmin = await hotel.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
  const ha = await signInWithMfa(h, hotelAdmin.email);
  await hotel.tx(
    (tx) =>
      identity.inviteMember(tx, h.ports, {
        email: gmEmail,
        displayName: 'General manager',
        roles: [{ roleKey: 'org_admin', scopeType: 'organization' }],
      }),
    ha.ctx,
  );
  return { hotel, ha, token: invitationToken(h, gmEmail) };
}

async function activeFactors(email: string) {
  return h.t.admin.kysely
    .selectFrom('identity.mfa_factors as f')
    .innerJoin('identity.users as u', 'u.id', 'f.user_id')
    .select(['f.id', 'f.credential_epoch', 'u.credential_epoch as user_epoch'])
    .where('u.email', '=', email)
    .where('f.status', '=', 'active')
    .execute();
}

// ───────────────────────────── R3-P1-1 (W-1) ─────────────────────────────

describe('R3-P1-1 / W-1: nothing in flight survives the first-verification wipe', () => {
  it('a factor confirmation racing the GM’s first verification is refused; the GM keeps a clean identity', async () => {
    const domain = `resort${newId().slice(-6)}.mv`;
    const { x, ghost, gmEmail, pSecret } = await ghostWithPendingFactor(domain);
    const { hotel, token } = await hotelInvitesGm(gmEmail);
    const [accepted, confirmed] = await withSlowFirstVerification(async () => {
      const gmAccept = identity.acceptInvitation(h.t.db, h.ports, {
        token,
        password: 'the-real-gm-password',
      });
      await sleep(400);
      const g2 = await authenticate(h, ghost.token); // the wipe has not committed yet
      expect(g2).not.toBeNull();
      const confirm = x.tx(
        (tx) => identity.confirmTotp(tx, h.ports, { code: totp(pSecret, h.clock.now()) }),
        g2 as NonNullable<typeof g2>,
      );
      return Promise.allSettled([gmAccept, confirm]);
    });
    expect(accepted.status).toBe('fulfilled');
    // The attacker's confirmation waited for the person's row lock, then found its session from an older epoch.
    expect(confirmed.status === 'rejected' || (confirmed.status === 'fulfilled' && !confirmed.value.ok)).toBe(
      true,
    );
    expect(await activeFactors(gmEmail)).toHaveLength(0);
    const gm = await identity.login(h.t.db, {
      email: gmEmail,
      password: 'the-real-gm-password',
      organizationId: hotel.tenantId,
    });
    expect(gm.status).toBe('signed_in'); // no factor the GM never had
    expect(await authenticate(h, ghost.token)).toBeNull();
  }, 30_000);

  it('reverse order: a factor confirmed before the wipe is wiped by it', async () => {
    const domain = `resort${newId().slice(-6)}.mv`;
    const { x, ghost, gmEmail, pSecret } = await ghostWithPendingFactor(domain);
    const g = await authenticate(h, ghost.token);
    if (!g) throw new Error('no ctx');
    const confirmed = await x.tx(
      (tx) => identity.confirmTotp(tx, h.ports, { code: totp(pSecret, h.clock.now()) }),
      g,
    );
    expect(confirmed.ok).toBe(true);
    const { hotel, token } = await hotelInvitesGm(gmEmail);
    await identity.acceptInvitation(h.t.db, h.ports, { token, password: 'the-real-gm-password' });
    expect(await activeFactors(gmEmail)).toHaveLength(0);
    const gm = await identity.login(h.t.db, {
      email: gmEmail,
      password: 'the-real-gm-password',
      organizationId: hotel.tenantId,
    });
    expect(gm.status).toBe('signed_in');
  });

  it('sibling: an SSO sign-in racing the wipe leaves no session and no link for the attacker', async () => {
    const domain = `resort${newId().slice(-6)}.mv`;
    const { x, idp, gmEmail } = await ghostWithPendingFactor(domain);
    const { token } = await hotelInvitesGm(gmEmail);
    const [accepted, signedIn] = await withSlowFirstVerification(async () => {
      const gmAccept = identity.acceptInvitation(h.t.db, h.ports, {
        token,
        password: 'the-real-gm-password',
      });
      await sleep(400);
      const sso = ssoSignIn(idp, x.tenantId, { sub: 'ghost', email: gmEmail, groups: ['staff'] });
      return Promise.allSettled([gmAccept, sso]);
    });
    expect(accepted.status).toBe('fulfilled');
    expect(signedIn.status).toBe('rejected');
    const links = await h.t.admin.kysely
      .selectFrom('identity.sso_identities as s')
      .innerJoin('identity.users as u', 'u.id', 's.user_id')
      .select('s.id')
      .where('u.email', '=', gmEmail)
      .execute();
    expect(links).toHaveLength(0);
  }, 30_000);
});

// ───────────────────────────── R3-P1-2 (W-2) ─────────────────────────────

describe('R3-P1-2 / W-2: every SSO setting that decides who signs in or which roles it grants is a root change', () => {
  it('an SSO manager cannot re-point the groups claim, JIT provisioning or the client id; the display name is fine', async () => {
    const domain = `lagoon${newId().slice(-6)}.mv`;
    const { o, issuer } = await ssoOrg('Resort W2', domain);
    const root = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }], `owner@${domain}`);
    const r = await signInWithMfa(h, root.email);
    await o.tx(
      (tx) =>
        identity.createRole(tx, h.ports, {
          key: 'sso_admin',
          name: 'SSO administrator',
          permissions: ['identity.sso.manage', 'identity.user.read'],
        }),
      r.ctx,
    );
    const itEmail = `it-${newId().slice(-6)}@${domain}`;
    await o.member([{ roleKey: 'sso_admin', scopeType: 'organization' }], itEmail);
    const s = await signInWithMfa(h, itEmail);
    const base = { displayName: 'Resort W2', issuer, clientId: 'c', allowedEmailDomains: [domain] };
    for (const change of [
      { groupsClaim: 'nickname' },
      { jitProvisioning: false },
      { clientId: 'other-app' },
    ]) {
      const conn = await o.tx((tx) => identity.getSsoConnection(tx), s.ctx);
      await expect(
        o.tx((tx) => identity.configureSso(tx, h.ports, { ...base, ...change }, conn?.version), s.ctx),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    const conn = await o.tx((tx) => identity.getSsoConnection(tx), s.ctx);
    const renamed = await o.tx(
      (tx) => identity.configureSso(tx, h.ports, { ...base, displayName: 'Resort sign-in' }, conn?.version),
      s.ctx,
    );
    expect(renamed.displayName).toBe('Resort sign-in');
    expect(renamed.groupsClaim).toBe('groups');
  });
});

// ───────────────────────────── R3-P2-1 (W-3) ─────────────────────────────

describe('R3-P2-1 / W-3: removing a group mapping needs the same power as creating it', () => {
  it('an SSO manager cannot delete the mapping that makes someone org_admin', async () => {
    const domain = `reef${newId().slice(-6)}.mv`;
    const { o, idp } = await ssoOrg('Resort W3', domain);
    const root = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const r = await signInWithMfa(h, root.email);
    await o.tx(
      (tx) =>
        identity.createRole(tx, h.ports, {
          key: 'sso_admin',
          name: 'SSO administrator',
          permissions: ['identity.sso.manage', 'identity.user.read'],
        }),
      r.ctx,
    );
    const boss = await ssoSignIn(idp, o.tenantId, {
      sub: 'boss',
      email: `boss@${domain}`,
      groups: ['admins'],
      amr: ['mfa'],
    });
    expect((await authenticate(h, boss.token))?.authz.can('identity.role.assign')).toBe(true);
    const itMember = await o.member([{ roleKey: 'sso_admin', scopeType: 'organization' }]);
    const s = await signInWithMfa(h, itMember.email);
    await expect(o.tx((tx) => identity.setGroupRoleMappings(tx, h.ports, []), s.ctx)).rejects.toMatchObject({
      code: 'forbidden',
    });
    // Keeping the powerful mapping while removing only the one the manager could grant would be fine; dropping it is not.
    await expect(
      o.tx(
        (tx) =>
          identity.setGroupRoleMappings(tx, h.ports, [
            { group: 'staff', roleKey: 'read_only', scopeType: 'organization' },
          ]),
        s.ctx,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const again = await ssoSignIn(idp, o.tenantId, {
      sub: 'boss',
      email: `boss@${domain}`,
      groups: ['admins'],
      amr: ['mfa'],
    });
    expect((await authenticate(h, again.token))?.authz.can('identity.role.assign')).toBe(true);
  });
});

// ───────────────────────────── R3-P2-3 (W-5) ─────────────────────────────

describe('R3-P2-3 / W-5: an SSO-only member of an SSO-required organization can always re-link', () => {
  it('after a first verification elsewhere wipes the link, the person re-links from a password session in any organization', async () => {
    const domain = `isle${newId().slice(-6)}.mv`;
    const email = `pat@${domain}`;
    const { o: a, idp } = await ssoOrg('Org A (SSO required)', domain);
    await ssoSignIn(idp, a.tenantId, { sub: 'p', email, groups: ['staff'] });
    await sql`update identity.sso_connections set sso_required = true where tenant_id = ${a.tenantId}::uuid`.execute(
      h.t.admin.kysely,
    );
    const b = await org(h, { name: 'Org B' });
    await b.tx((tx) => identity.inviteMember(tx, h.ports, { email, displayName: 'Pat', roles: [] }));
    await identity.acceptInvitation(h.t.db, h.ports, {
      token: invitationToken(h, email),
      password: 'pats-own-password',
    });
    await expect(ssoSignIn(idp, a.tenantId, { sub: 'p', email, groups: ['staff'] })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    // Recovery: Pat proves their credentials in B and links A's identity provider account to themselves.
    const pb = await identity.login(h.t.db, {
      email,
      password: 'pats-own-password',
      organizationId: b.tenantId,
    });
    if (pb.status !== 'signed_in') throw new Error(pb.status);
    const bCtx = await authenticate(h, pb.token);
    if (!bCtx) throw new Error('no session in B');
    const start = await identity.startSsoLink(h.t.db, h.ports, bCtx, a.tenantId);
    const { code, state } = idp.authorize(start.authorizationUrl, {
      email_verified: true,
      sub: 'p',
      email,
      groups: ['staff'],
    });
    const linked = await identity.completeSsoLogin(h.t.db, h.ports, {
      state,
      code,
      browserBinding: start.browserBinding,
    });
    expect(linked.organization.id).toBe(a.tenantId);
    // From now on plain SSO works again.
    const again = await ssoSignIn(idp, a.tenantId, { sub: 'p', email, groups: ['staff'] });
    expect(again.userId).toBe(linked.userId);
    // Nobody can use the cross-organization link start for an organization they do not belong to.
    const stranger = await org(h, { name: 'Unrelated' });
    await expect(identity.startSsoLink(h.t.db, h.ports, bCtx, stranger.tenantId)).rejects.toBeTruthy();
  });
});

// ───────────────────────────── R3-P3-1 (W-6) ─────────────────────────────

describe('R3-P3-1 / W-6: the orphan-link purge is tenant-correct', () => {
  it('a link without a membership in its own organization is purged even if the person belongs elsewhere', async () => {
    const domain = `cay${newId().slice(-6)}.mv`;
    const { o: x, idp } = await ssoOrg('Org X', domain);
    const s = await ssoSignIn(idp, x.tenantId, { sub: 'z', email: `zoe@${domain}`, groups: ['staff'] });
    const y = await org(h, { name: 'Org Y' });
    await y.tx((tx) =>
      identity.inviteMember(tx, h.ports, { email: `zoe@${domain}`, displayName: 'Zoe', roles: [] }),
    );
    await sql`delete from identity.role_assignments where tenant_id = ${x.tenantId}::uuid and user_id = ${s.userId}::uuid`.execute(
      h.t.admin.kysely,
    );
    await sql`delete from identity.memberships where tenant_id = ${x.tenantId}::uuid and user_id = ${s.userId}::uuid`.execute(
      h.t.admin.kysely,
    );
    // Run as the application role (the job's role), not as the test superuser.
    await sql`select identity.purge_orphan_sso_links()`.execute(h.t.db.kysely);
    const left = await h.t.admin.kysely
      .selectFrom('identity.sso_identities')
      .select('id')
      .where('tenant_id', '=', x.tenantId)
      .where('user_id', '=', s.userId)
      .execute();
    expect(left).toHaveLength(0);
  });
});

// ───────────────────────────── P3s ─────────────────────────────

describe('R3-P3-3 / R3-P3-4: simulated links do not verify; the issuer is bound to the login', () => {
  it('accepting a simulated (non-live) invitation does not mark the email verified', async () => {
    const trial = await org(h, { environment: 'trial' });
    const email = `trial-${newId().slice(-6)}@lagoon.mv`;
    await trial.tx((tx) => identity.inviteMember(tx, h.ports, { email, displayName: 't', roles: [] }));
    await identity.acceptInvitation(h.t.db, h.ports, {
      token: invitationToken(h, email),
      password: 'trial-password-1',
    });
    const u = await h.t.admin.kysely
      .selectFrom('identity.users')
      .select('email_verified_at')
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    expect(u.email_verified_at).toBeNull();
    const s = await signIn(h, email).catch(() => null);
    if (s) expect(await identity.listMyInvitations(h.t.db, s.ctx.actor)).toEqual([]);
  });

  it('a login started before an issuer change cannot finish against the new issuer', async () => {
    const domain = `iss${newId().slice(-6)}.mv`;
    const { o, idp } = await ssoOrg('Issuer org', domain);
    const start = await identity.startSsoLogin(h.t.db, h.ports, { organizationId: o.tenantId });
    const { code, state } = idp.authorize(start.authorizationUrl, {
      email_verified: true,
      sub: 'i1',
      email: `i1@${domain}`,
      groups: ['staff'],
    });
    const newIssuer = `https://idp-${newId().slice(-8)}.${domain}`;
    await idpFor(newIssuer);
    const conn = await o.tx((tx) => identity.getSsoConnection(tx));
    await o.tx((tx) =>
      identity.configureSso(
        tx,
        h.ports,
        { displayName: 'x', issuer: newIssuer, clientId: 'c', allowedEmailDomains: [domain] },
        conn?.version,
      ),
    );
    await expect(
      identity.completeSsoLogin(h.t.db, h.ports, { state, code, browserBinding: start.browserBinding }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

// ───────────────────────────── R3-P2-2 (W-4) — last: moves the clock ─────────────────────────────

describe('R3-P2-2 / W-4: domain verification is exclusive, re-checked live, and lapses', () => {
  it('a second organization cannot hold a verified domain', async () => {
    const domain = `atoll${newId().slice(-6)}.mv`;
    const { o: x } = await ssoOrg('First verifier', domain);
    await verifyDomain(x, domain);
    const { o: y } = await ssoOrg('Second claimant', domain);
    const claim = await y.tx((tx) => identity.addSsoDomain(tx, domain));
    txt.set(claim.txtRecord.name, [...(txt.get(claim.txtRecord.name) ?? []), claim.txtRecord.value]);
    await expect(identity.verifySsoDomain(h.t.db, y.ctx, h.ports, domain)).rejects.toMatchObject({
      code: 'domain_held_by_another_organization',
    });
  });

  it('a stale verification cannot verify a newly invited person or accept their invitation', async () => {
    const domain = `atoll${newId().slice(-6)}.mv`;
    const { o: x, idp } = await ssoOrg('Former management company', domain);
    const { claim } = await verifyDomain(x, domain);
    txt.delete(claim.txtRecord.name); // DNS control lost
    const hotel = await org(h, { name: 'Hotel (live)' });
    const email = `newhire-${newId().slice(-6)}@${domain}`;
    await hotel.tx((tx) =>
      identity.inviteMember(tx, h.ports, {
        email,
        displayName: 'New finance manager',
        roles: [{ roleKey: 'org_admin', scopeType: 'organization' }],
      }),
    );
    const realToken = invitationToken(h, email);
    await expect(ssoSignIn(idp, x.tenantId, { sub: 'nh', email, groups: ['staff'] })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect((await x.tx((tx) => identity.listSsoDomains(tx)))[0]?.verified).toBe(false);
    // The real person's own link still works.
    const accepted = await identity.acceptInvitation(h.t.db, h.ports, {
      token: realToken,
      password: 'my-own-password-1',
    });
    expect(accepted.organizationId).toBe(hotel.tenantId);
  });

  it('the scheduled re-check ends a verification whose DNS record is gone', async () => {
    const domain = `atoll${newId().slice(-6)}.mv`;
    const { o } = await ssoOrg('Rechecked org', domain);
    const { claim } = await verifyDomain(o, domain);
    txt.delete(claim.txtRecord.name);
    h.clock.advance(2 * 86_400_000);
    await ssoDomainRecheckJob(async (name) => txt.get(name) ?? []).run(h.t.db, h.clock.now());
    expect((await o.tx((tx) => identity.listSsoDomains(tx)))[0]?.verified).toBe(false);
    const alerts = await o.tx((tx) => identity.listSecurityAlerts(tx));
    expect(alerts.some((a) => a.summary.includes(domain))).toBe(true);
  });
});
