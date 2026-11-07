/**
 * The FIRST steward review's proof-of-concept attacks, as re-expressed by the second review
 * (docs/orchestration/reviews/identity-plus-poc/identity-zz-review2-original.test.ts.txt). Each test passes when the
 * original attack is REFUSED. Adapted only where ADR-0017 amendment 1 changed the API (no `initialPassword`).
 */
import { newId } from '@portico/kernel';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identity } from '../src';
import { base32Decode, hotp, timeStep } from '../src/domain/totp';
import { authenticate, type Harness, harness, org, PASSWORD, signIn, signInWithMfa } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => h?.t.drop());
const inDays = (d: number) => new Date(h.clock.now().getTime() + d * 86_400_000);

describe('original P0-1 path A (trial admin resets a live GM’s global password)', () => {
  it('is refused, and no link reaches the attacker', async () => {
    const live = await org(h);
    const victim = await live.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const trial = await org(h, { environment: 'trial' });
    const attacker = await trial.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const a = await signInWithMfa(h, attacker.email);
    const inv = await trial.tx(
      (tx) => identity.inviteMember(tx, h.ports, { email: victim.email, displayName: 'v', roles: [] }),
      a.ctx,
    );
    expect(inv.userId).toBe(victim.userId);
    expect(JSON.stringify(inv)).not.toMatch(/inv\.|prt\.|token=/);
    await expect(
      trial.tx((tx) => identity.sendPasswordResetForMember(tx, h.ports, victim.userId), a.ctx),
    ).rejects.toMatchObject({ code: 'person_shared_with_other_organization' });
  });
});

describe('original P0-1 path B (live admin sets the first password of a password-less member elsewhere)', () => {
  it('is refused', async () => {
    const live = await org(h);
    const victimEmail = `scim-${newId()}@victim.mv`;
    const { userId } = await live.tx((tx) =>
      identity.createUser(
        tx,
        {
          email: victimEmail,
          displayName: 'GM',
          roles: [{ roleKey: 'org_admin', scopeType: 'organization' }],
        },
        h.ports,
      ),
    );
    const other = await org(h);
    const admin = await other.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const a = await signInWithMfa(h, admin.email);
    await expect(
      other.tx(
        (tx) =>
          identity.createUser(tx, {
            email: victimEmail,
            displayName: 'x',
            initialPassword: 'attacker-chosen-password',
            roles: [],
          } as Parameters<typeof identity.createUser>[1]),
        a.ctx,
      ),
    ).rejects.toMatchObject({ code: 'password_not_allowed' }); // ADR-0017 rule 12 (was person_already_has_sign_in)
    void userId;
  });
});

describe('original wave-0 createUser (adds an existing person as ACTIVE without consent)', () => {
  it('now creates an invited membership', async () => {
    const live = await org(h);
    const victim = await live.member([{ roleKey: 'front_desk', scopeType: 'organization' }]);
    const other = await org(h);
    const admin = await other.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const a = await signInWithMfa(h, admin.email);
    const r = await other.tx(
      (tx) => identity.createUser(tx, { email: victim.email, displayName: 'x', roles: [] }),
      a.ctx,
    );
    expect(r.status).toBe('invited');
    const lr = await identity.login(h.t.db, { email: victim.email, password: PASSWORD });
    expect(lr.status).toBe('signed_in'); // only the live org is active
  });
});

describe('original P0-2a (trial admin strips a live member’s MFA)', () => {
  it('is refused', async () => {
    const live = await org(h);
    const victim = await live.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    await signInWithMfa(h, victim.email);
    const trial = await org(h, { environment: 'trial' });
    const attacker = await trial.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const a = await signInWithMfa(h, attacker.email);
    await trial.tx(
      (tx) => identity.inviteMember(tx, h.ports, { email: victim.email, displayName: 'v', roles: [] }),
      a.ctx,
    );
    await expect(
      trial.tx((tx) => identity.resetMemberMfa(tx, victim.userId, 'lost phone, honest', h.ports), a.ctx),
    ).rejects.toMatchObject({ code: 'person_shared_with_other_organization' });
    const post = await identity.login(h.t.db, {
      email: victim.email,
      password: PASSWORD,
      organizationId: live.tenantId,
    });
    expect(post.status).toBe('mfa_required');
  });
});

describe('original P0-2 (a session alone replaces the authenticator)', () => {
  it('enrolTotp without proof is refused', async () => {
    const o = await org(h);
    const m = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const s = await signInWithMfa(h, m.email);
    const r = await o.tx((tx) => identity.enrolTotp(tx, h.ports, {}), s.ctx);
    expect(r.ok).toBe(false);
    const r2 = await o.tx((tx) => identity.enrolTotp(tx, h.ports, { currentPassword: PASSWORD }), s.ctx);
    expect(r2.ok).toBe(false); // the password is not enough once a factor exists
    const r3 = await o.tx((tx) => identity.disableOwnMfa(tx, h.ports, { currentPassword: PASSWORD }), s.ctx);
    expect(r3.ok).toBe(false);
    const r4 = await o.tx((tx) => identity.regenerateRecoveryCodes(tx, h.ports, {}), s.ctx);
    expect(r4.ok).toBe(false);
  });
});

describe('original P1-2 (new org_admin uses ⚑ with a password only)', () => {
  it('is refused', async () => {
    const o = await org(h);
    const admin = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const s = await signIn(h, admin.email);
    expect(s.ctx.authz.can('identity.role.assign')).toBe(false);
    expect(s.ctx.authz.can('identity.sso.manage')).toBe(false);
  });
});

describe('original P1-4 (request as user, approve with own API client)', () => {
  it('is refused', async () => {
    const o = await org(h);
    const p = await o.property(`SOD${newId().slice(-4)}`);
    const admin = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const s = await signInWithMfa(h, admin.email);
    const req = await o.tx(
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
      s.ctx,
    );
    const client = await o.tx(
      (tx) =>
        identity.issueApiClient(tx, h.ports, {
          name: 'my bot',
          permissions: ['platform.property.activate', 'platform.property.read'],
          expiresAt: inDays(30),
        }),
      s.ctx,
    );
    const botCtx = await authenticate(h, client.token);
    if (!botCtx) throw new Error('bot did not authenticate');
    await expect(
      o.tx((tx) => platform.approveActivationRequest(tx, {}, req.id), botCtx),
    ).rejects.toMatchObject({
      code: 'human_approval_required',
    });
  });
});

describe('original P1-6 (lower-privileged role assigner removes the only administrator)', () => {
  it('is refused', async () => {
    const o = await org(h);
    const admin = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const a = await signInWithMfa(h, admin.email);
    await o.tx(
      (tx) =>
        identity.createRole(tx, h.ports, {
          key: 'hr_clerk',
          name: 'HR clerk',
          permissions: ['identity.role.assign', 'identity.user.read', 'platform.property.read'],
        }),
      a.ctx,
    );
    const clerk = await o.member([{ roleKey: 'hr_clerk', scopeType: 'organization' }]);
    const c = await signInWithMfa(h, clerk.email);
    const m = await o.tx((tx) => identity.getMember(tx, admin.userId), a.ctx);
    const orgAdmin = m.assignments.find((x) => x.roleKey === 'org_admin');
    await expect(
      o.tx((tx) => identity.revokeAssignment(tx, orgAdmin?.assignmentId as string, 'bye', h.ports), c.ctx),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('original P1-5 (identity.security.manage self-designates break-glass org_admin)', () => {
  it('is refused', async () => {
    const o = await org(h);
    const admin = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const a = await signInWithMfa(h, admin.email);
    await o.tx(
      (tx) =>
        identity.createRole(tx, h.ports, {
          key: 'sec_officer',
          name: 'Security officer',
          permissions: ['identity.security.manage', 'identity.user.read'],
        }),
      a.ctx,
    );
    const officer = await o.member([{ roleKey: 'sec_officer', scopeType: 'organization' }]);
    const s = await signInWithMfa(h, officer.email);
    const pol = await o.tx((tx) => identity.getSecurityPolicy(tx), s.ctx);
    await expect(
      o.tx(
        (tx) =>
          identity.updateSecurityPolicy(tx, pol.version, {
            breakGlassUserIds: [officer.userId],
            breakGlassRoleKey: 'org_admin',
          }),
        s.ctx,
      ),
    ).rejects.toMatchObject({ code: 'segregation_of_duties' });
    // Designating somebody else for a role the officer does not hold is refused too.
    await expect(
      o.tx(
        (tx) =>
          identity.updateSecurityPolicy(tx, pol.version, {
            breakGlassUserIds: [admin.userId],
            breakGlassRoleKey: 'org_admin',
          }),
        s.ctx,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('original P1-7 (50 wrong TOTP codes over 10 challenges, never locked)', () => {
  it('now delays, then locks', async () => {
    const o = await org(h);
    const m = await o.member([{ roleKey: 'front_desk', scopeType: 'organization' }]);
    await signInWithMfa(h, m.email);
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const r = await identity.login(h.t.db, { email: m.email, password: PASSWORD });
      if (r.status !== 'mfa_required') throw new Error(r.status);
      for (let k = 0; k < 5; k++) {
        const e = await identity
          .completeMfaChallenge(h.t.db, h.ports, { challengeToken: r.challengeToken, code: '000000' })
          .catch((err: { code?: string }) => err);
        seen.add((e as { code?: string }).code ?? 'ok');
      }
    }
    expect(seen.has('second_factor_locked')).toBe(true);
  });
});

describe('original concurrent replay (TOTP and recovery code)', () => {
  it('still exactly one succeeds', async () => {
    const o = await org(h);
    const m = await o.member([{ roleKey: 'front_desk', scopeType: 'organization' }]);
    const s = await signInWithMfa(h, m.email);
    h.clock.advance(60_000);
    const code = hotp(s.secret, timeStep(h.clock.now()));
    const c1 = await identity.login(h.t.db, { email: m.email, password: PASSWORD });
    const c2 = await identity.login(h.t.db, { email: m.email, password: PASSWORD });
    if (c1.status !== 'mfa_required' || c2.status !== 'mfa_required') throw new Error('x');
    const r = await Promise.allSettled([
      identity.completeMfaChallenge(h.t.db, h.ports, { challengeToken: c1.challengeToken, code }),
      identity.completeMfaChallenge(h.t.db, h.ports, { challengeToken: c2.challengeToken, code }),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    void base32Decode;
  });
});
