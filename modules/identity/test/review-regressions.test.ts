/**
 * Regression tests for the steward review of feat/identity-platform-enterprise
 * (docs/orchestration/reviews/review-identity-plus.md) and ADR-0017. Each test replays a proof-of-concept attack
 * from the review and asserts that it is now REFUSED.
 */
import { withTenantTx } from '@portico/db';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identity, isExplainingAuthorizer, outboxNotifier, readDevMailbox } from '../src';
import { base32Decode, hotp, timeStep } from '../src/domain/totp';
import {
  authenticate,
  type Harness,
  harness,
  nextTotp,
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

const inDays = (d: number) => new Date(h.clock.now().getTime() + d * 86_400_000);

describe('P0-1: another organization cannot take over a person through their password', () => {
  it('a trial-org admin cannot reset the global password of a live-org GM (path A)', async () => {
    const live = await org(h, { name: 'Live resort' });
    const victim = await live.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const trial = await org(h, { name: 'Attacker trial', environment: 'trial' });
    const attacker = await trial.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const a = await signInWithMfa(h, attacker.email);

    // Inviting the victim's email only creates an INVITATION, and its link goes to the victim alone.
    const sentBefore = h.sent.length;
    const inv = await trial.tx(
      (tx) => identity.inviteMember(tx, h.ports, { email: victim.email, displayName: 'v', roles: [] }),
      a.ctx,
    );
    expect(inv.userId).toBe(victim.userId);
    expect(inv.delivery).toEqual({ mode: 'simulated' });
    expect(JSON.stringify(inv)).not.toMatch(/inv\.|prt\./);
    expect(h.sent.slice(sentBefore).map((m) => m.to)).toEqual([victim.email]);
    expect((await trial.tx((tx) => identity.getMember(tx, victim.userId), a.ctx)).status).toBe('invited');

    // The admin-sent reset is refused: the person also works elsewhere.
    await expect(
      trial.tx((tx) => identity.sendPasswordResetForMember(tx, h.ports, victim.userId), a.ctx),
    ).rejects.toMatchObject({ code: 'person_shared_with_other_organization' });
    expect(h.sent.length).toBe(sentBefore + 1); // no reset link was produced at all

    // The victim's own password still works for the live organization.
    const res = await identity.login(h.t.db, { email: victim.email, password: PASSWORD });
    expect(res.status).toBe('signed_in'); // only one ACTIVE organization: the live one
  });

  it('a live-org admin cannot set the first password of a person provisioned elsewhere (path B)', async () => {
    const live = await org(h, { name: 'Victim resort' });
    const victimEmail = `scim-${Date.now()}@victim.mv`;
    const created = await live.tx((tx) =>
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
    expect(created.status).toBe('invited'); // brand-new person, no credentials until they accept (rule 12)
    const other = await org(h, { name: 'Other live org' });
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
    ).rejects.toMatchObject({ code: 'password_not_allowed' });
    await expect(
      identity.login(h.t.db, { email: victimEmail, password: 'attacker-chosen-password' }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('createUser never adds an existing person as an ACTIVE member without their consent', async () => {
    const live = await org(h, { name: 'Live resort 3' });
    const victim = await live.member([{ roleKey: 'front_desk', scopeType: 'organization' }]);
    const other = await org(h, { name: 'Other org' });
    const admin = await other.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const a = await signInWithMfa(h, admin.email);
    const r = await other.tx(
      (tx) => identity.createUser(tx, { email: victim.email, displayName: 'x', roles: [] }),
      a.ctx,
    );
    expect(r).toMatchObject({ userId: victim.userId, status: 'invited' });
    expect(JSON.stringify(r)).not.toMatch(/inv\.|prt\./);
    // The person is not dropped into the other organization: sign-in still goes straight to their own.
    const lr = await identity.login(h.t.db, { email: victim.email, password: PASSWORD });
    expect(lr.status).toBe('signed_in');
    // They can see and accept the invitation themselves.
    const v = await signIn(h, victim.email);
    expect((await identity.listMyInvitations(h.t.db, v.ctx.actor)).map((i) => i.organizationId)).toContain(
      other.tenantId,
    );
  });

  it('an invitation link cannot be used to set a password for someone who already has one', async () => {
    const home = await org(h);
    const victim = await home.member([]);
    const trial = await org(h, { environment: 'trial' });
    await trial.tx((tx) =>
      identity.inviteMember(tx, h.ports, { email: victim.email, displayName: 'v', roles: [] }),
    );
    const link = h.sent.at(-1)?.link as string;
    const token = decodeURIComponent(link.split('token=')[1] as string);
    // Whoever holds the link must know the person's CURRENT password; it is never replaced here.
    await expect(
      identity.acceptInvitation(h.t.db, h.ports, { token, password: 'attacker-chosen-password' }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect((await identity.login(h.t.db, { email: victim.email, password: PASSWORD })).status).toBe(
      'signed_in',
    );
    await identity.acceptInvitation(h.t.db, h.ports, { token, password: PASSWORD });
    const both = await identity.login(h.t.db, { email: victim.email, password: PASSWORD });
    expect(both.status).toBe('select_organization');
  });
});

describe('P0-2: another organization cannot strip or replace a person’s MFA', () => {
  it('a trial-org admin cannot reset the MFA of a live-org member (an invitation counts as shared)', async () => {
    const live = await org(h, { name: 'Live resort 2' });
    const victim = await live.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    await signInWithMfa(h, victim.email);
    const trial = await org(h, { name: 'Attacker trial 2', environment: 'trial' });
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

  it('a session alone cannot replace an enrolled authenticator (proof of the existing factor)', async () => {
    const o = await org(h);
    const m = await o.member([]);
    const s = await signInWithMfa(h, m.email);
    const attempt = await o.tx((tx) => identity.enrolTotp(tx, h.ports, {}), s.ctx);
    expect(attempt).toMatchObject({ ok: false, error: { code: 'proof_required' } });
    const withPassword = await o.tx(
      (tx) => identity.enrolTotp(tx, h.ports, { currentPassword: PASSWORD }),
      s.ctx,
    );
    expect(withPassword).toMatchObject({ ok: false, error: { code: 'proof_required' } });
    const codes = await o.tx((tx) => identity.regenerateRecoveryCodes(tx, h.ports, {}), s.ctx);
    expect(codes).toMatchObject({ ok: false, error: { code: 'proof_required' } });
  });
});

describe('P1-2: no sensitive permission without MFA, even in the enrolment grace', () => {
  it('a brand-new org_admin cannot use sensitive permissions with a password only', async () => {
    const o = await org(h);
    const admin = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const s = await signIn(h, admin.email);
    expect(s.ctx.authz.can('identity.role.assign')).toBe(false);
    expect(s.ctx.authz.can('identity.sso.manage')).toBe(false);
    expect(s.ctx.authz.can('identity.user.read')).toBe(true);
    const mfa = await signInWithMfa(h, admin.email);
    expect(mfa.ctx.authz.can('identity.role.assign')).toBe(true);
  });
});

describe('P1-3: API keys are bounded', () => {
  it('no identity administration or "*" in keys; sensitive keys expire within 90 days', async () => {
    const o = await org(h);
    const admin = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const a = await signInWithMfa(h, admin.email);
    for (const permissions of [['*'], ['identity.role.assign'], ['identity.*']])
      await expect(
        o.tx((tx) => identity.issueApiClient(tx, h.ports, { name: 'k', permissions }), a.ctx),
      ).rejects.toMatchObject({ code: 'permission_not_allowed_in_keys' });
    await expect(
      o.tx(
        (tx) =>
          identity.issueApiClient(tx, h.ports, { name: 'k', permissions: ['platform.property.activate'] }),
        a.ctx,
      ),
    ).rejects.toMatchObject({ code: 'expiry_required' });
    await expect(
      o.tx(
        (tx) =>
          identity.issueApiClient(tx, h.ports, {
            name: 'k',
            permissions: ['platform.property.activate'],
            expiresAt: inDays(120),
          }),
        a.ctx,
      ),
    ).rejects.toMatchObject({ code: 'expiry_required' });
    const scim = await o.tx(
      (tx) =>
        identity.issueApiClient(tx, h.ports, {
          name: 'Entra provisioning',
          permissions: ['identity.scim.provision'],
          expiresAt: inDays(60),
        }),
      a.ctx,
    );
    expect(scim.token).toMatch(/^ptk\./);
  });

  it('a sensitive key needs a recent step-up when it is issued', async () => {
    const o = await org(h);
    const admin = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const a = await signInWithMfa(h, admin.email);
    h.clock.advance(20 * 60_000); // the step-up window (15 min) has passed
    const stale = await authenticate(h, a.token);
    if (!stale || !isExplainingAuthorizer(stale.authz)) throw new Error('session lost');
    // Issuing keys is itself sensitive: refused (HTTP translates this to mfa_required)…
    await expect(
      o.tx(
        (tx) =>
          identity.issueApiClient(tx, h.ports, {
            name: 'k',
            permissions: ['platform.property.read'],
          }),
        stale,
      ),
    ).rejects.toMatchObject({ code: 'forbidden', details: { permission: 'identity.apiClient.manage' } });
    expect(stale.authz.explainDenial('identity.apiClient.manage')).toBe('mfa_required');
    // …and works again right after a step-up.
    await o.tx((tx) => identity.stepUp(tx, h.ports, { code: nextTotp(h, a.secret) }), stale);
    const fresh = await authenticate(h, a.token);
    if (!fresh) throw new Error('session lost');
    const key = await o.tx(
      (tx) =>
        identity.issueApiClient(tx, h.ports, {
          name: 'k',
          permissions: ['platform.property.activate'],
          expiresAt: inDays(30),
        }),
      fresh,
    );
    expect(key.clientId).toBeTruthy();
  });

  it('keys stop working when their creator is suspended or resets their password', async () => {
    const o = await org(h);
    const admin = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]); // another admin remains
    const a = await signInWithMfa(h, admin.email);
    const key = await o.tx(
      (tx) => identity.issueApiClient(tx, h.ports, { name: 'k', permissions: ['platform.property.read'] }),
      a.ctx,
    );
    expect(await identity.authenticateToken(h.t.db, key.token, h.ports)).not.toBeNull();
    await o.tx((tx) => identity.suspendMember(tx, admin.userId, 'investigation'));
    expect(await identity.authenticateToken(h.t.db, key.token, h.ports)).toBeNull();

    const other = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const b = await signInWithMfa(h, other.email);
    const key2 = await o.tx(
      (tx) => identity.issueApiClient(tx, h.ports, { name: 'k2', permissions: ['platform.property.read'] }),
      b.ctx,
    );
    await identity.requestPasswordReset(h.t.db, h.ports, { email: other.email });
    const resetLink = h.sent.at(-1)?.link ?? '';
    const token = decodeURIComponent(resetLink.split('token=')[1] as string);
    await identity.completePasswordReset(h.t.db, { token, newPassword: 'a brand new passphrase' });
    expect(await identity.authenticateToken(h.t.db, key2.token, h.ports)).toBeNull();
  });
});

describe('P1-4: separation of duties compares people', () => {
  const scope = {
    effects: [{ effect: 'integration.read' as const }],
    workflows: ['operations.housekeepingBoard'],
    modules: ['operations'],
    startsOn: '2026-11-01',
    endsOn: '2027-01-31',
    successCriteria: 'x',
    rollbackPlan: 'y',
  };

  it('an API client cannot approve, and cannot be used to approve its own issuer’s request', async () => {
    const o = await org(h);
    const p = await o.property('SOD1');
    const admin = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const s = await signInWithMfa(h, admin.email);
    const req = await o.tx(
      (tx) => platform.requestStatusChange(tx, {}, p.id, { toStatus: 'pilot', reason: 'pilot', scope }),
      s.ctx,
    );
    const client = await o.tx(
      (tx) =>
        identity.issueApiClient(tx, h.ports, {
          name: 'my bot',
          permissions: ['platform.property.activate', 'platform.property.read', 'platform.property.update'],
          expiresAt: inDays(30),
        }),
      s.ctx,
    );
    const botCtx = await authenticate(h, client.token);
    if (!botCtx) throw new Error('bot did not authenticate');
    await expect(
      o.tx((tx) => platform.approveActivationRequest(tx, {}, req.id), botCtx),
    ).rejects.toMatchObject({ code: 'human_approval_required' });

    // The bot files a request; its issuer cannot approve it (same responsible person).
    await o.tx((tx) => platform.cancelActivationRequest(tx, req.id, { note: 'redo' }), s.ctx);
    const viaBot = await o.tx(
      (tx) => platform.requestStatusChange(tx, {}, p.id, { toStatus: 'pilot', reason: 'pilot', scope }),
      botCtx,
    );
    await expect(
      o.tx((tx) => platform.approveActivationRequest(tx, {}, viaBot.id), s.ctx),
    ).rejects.toMatchObject({ code: 'segregation_of_duties' });
  });
});

describe('P1-5: break-glass cannot be self-granted and leaves no durable privilege', () => {
  async function securityOfficer() {
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
    return { o, admin, a, officer, s };
  }

  it('identity.security.manage alone cannot designate oneself or grant a role one does not hold', async () => {
    const { o, admin, officer, s } = await securityOfficer();
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

  it('during emergency access no API key, role grant or policy change can be made', async () => {
    const { o, a } = await securityOfficer();
    const desk = await o.member([]);
    const pol = await o.tx((tx) => identity.getSecurityPolicy(tx), a.ctx);
    await o.tx(
      (tx) => identity.updateSecurityPolicy(tx, pol.version, { breakGlassUserIds: [desk.userId] }),
      a.ctx,
    );
    const alerts = await o.tx((tx) => identity.listSecurityAlerts(tx));
    expect(alerts.map((x) => x.rule)).toContain('break_glass_designation_changed');
    const d = await signInWithMfa(h, desk.email);
    await o.tx(
      (tx) =>
        identity.startElevation(tx, h.ports, {
          reason: 'Night manager unreachable, guest locked out',
          durationMinutes: 60,
        }),
      d.ctx,
    );
    const elevated = await authenticate(h, d.token);
    if (!elevated) throw new Error('no session');
    await expect(
      o.tx(
        (tx) =>
          identity.issueApiClient(tx, h.ports, {
            name: 'forever',
            permissions: ['platform.property.read'],
            expiresAt: inDays(30),
          }),
        elevated,
      ),
    ).rejects.toMatchObject({ code: 'not_during_emergency_access' });
    await expect(
      o.tx(
        (tx) =>
          identity.assignRole(tx, { userId: desk.userId, roleKey: 'read_only', scopeType: 'organization' }),
        elevated,
      ),
    ).rejects.toMatchObject({ code: 'not_during_emergency_access' });
    const pol2 = await o.tx((tx) => identity.getSecurityPolicy(tx));
    await expect(
      o.tx((tx) => identity.updateSecurityPolicy(tx, pol2.version, { mfaStepUpWindowMinutes: 60 }), elevated),
    ).rejects.toMatchObject({ code: 'not_during_emergency_access' });
  });

  it('emergency access widens permissions the person already holds at one property (P2-10 on main)', async () => {
    const o = await org(h);
    const p1 = await o.property('EW1');
    const p2 = await o.property('EW2');
    const desk = await o.member([{ roleKey: 'front_desk', scopeType: 'property', scopeId: p1.id }]);
    await o.tx((tx) => identity.updateSecurityPolicy(tx, 0, { breakGlassUserIds: [desk.userId] }));
    const d = await signInWithMfa(h, desk.email);
    expect(d.ctx.authz.can('reservations.stay.checkIn', { propertyId: p2.id })).toBe(false);
    await o.tx(
      (tx) =>
        identity.startElevation(tx, h.ports, {
          reason: 'Covering the other resort tonight, manager unreachable',
          durationMinutes: 30,
        }),
      d.ctx,
    );
    const elevated = await authenticate(h, d.token);
    expect(elevated?.authz.can('reservations.stay.checkIn', { propertyId: p2.id })).toBe(true);
    expect(elevated?.authz.propertyScope('reservations.stay.checkIn')).toBe('all');
  });
});

describe('P1-6: power is ordered and the last administrator stays', () => {
  it('a lower-privileged role assigner cannot revoke an administrator’s role', async () => {
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
    const member = await o.tx((tx) => identity.getMember(tx, admin.userId), a.ctx);
    const orgAdmin = member.assignments.find((x) => x.roleKey === 'org_admin');
    if (!orgAdmin) throw new Error('missing assignment');
    await expect(
      o.tx((tx) => identity.revokeAssignment(tx, orgAdmin.assignmentId, 'bye', h.ports), c.ctx),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      o.tx((tx) => identity.suspendMember(tx, admin.userId, 'bye', h.ports), c.ctx),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const after = await authenticate(h, a.token);
    expect(after?.authz.can('identity.role.assign')).toBe(true);
  });

  it('no change may remove the organization’s last administrator', async () => {
    const o = await org(h);
    const admin = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const member = await o.tx((tx) => identity.getMember(tx, admin.userId));
    const assignmentId = member.assignments[0]?.assignmentId as string;
    await expect(o.tx((tx) => identity.revokeAssignment(tx, assignmentId, 'cleanup'))).rejects.toMatchObject({
      code: 'last_administrator',
    });
    await expect(o.tx((tx) => identity.suspendMember(tx, admin.userId, 'x'))).rejects.toMatchObject({
      code: 'last_administrator',
    });
    await expect(o.tx((tx) => identity.removeMember(tx, admin.userId, 'x'))).rejects.toMatchObject({
      code: 'last_administrator',
    });
  });
});

describe('P1-7: second-factor failures are counted per person across challenges', () => {
  it('wrong codes over fresh challenges delay, then lock, and alert the person and the admins', async () => {
    const o = await org(h);
    const m = await o.member([{ roleKey: 'front_desk', scopeType: 'organization' }]);
    const { secret } = await signInWithMfa(h, m.email);
    const sentBefore = h.sent.length;
    const outcomes: string[] = [];
    let failures = 0;
    while (failures < 10) {
      const r = await identity.login(h.t.db, { email: m.email, password: PASSWORD });
      if (r.status !== 'mfa_required') throw new Error(r.status);
      const err = await identity
        .completeMfaChallenge(h.t.db, h.ports, { challengeToken: r.challengeToken, code: '000000' })
        .catch((e: { code: string }) => e.code);
      outcomes.push(err as string);
      if (err === 'second_factor_locked') h.clock.advance(2 * 60_000);
      else failures++;
    }
    // After 5 failures in a row the person is delayed, whatever challenge they use.
    expect(outcomes).toContain('second_factor_locked');
    // After 10 the correct code is refused too for 15 minutes, and an alert is raised.
    const r = await identity.login(h.t.db, { email: m.email, password: PASSWORD });
    if (r.status !== 'mfa_required') throw new Error(r.status);
    await expect(
      identity.completeMfaChallenge(h.t.db, h.ports, {
        challengeToken: r.challengeToken,
        code: nextTotp(h, secret),
      }),
    ).rejects.toMatchObject({ code: 'second_factor_locked', status: 429 });
    const alerts = await o.tx((tx) => identity.listSecurityAlerts(tx));
    expect(alerts.find((a) => a.rule === 'mfa_bruteforce_suspected')).toMatchObject({ severity: 'high' });
    expect(h.sent.slice(sentBefore).map((x) => x.to)).toContain(m.email);
    // A success resets the counter once the lock is over.
    h.clock.advance(16 * 60_000);
    const ok = await identity.login(h.t.db, { email: m.email, password: PASSWORD });
    if (ok.status !== 'mfa_required') throw new Error(ok.status);
    const done = await identity.completeMfaChallenge(h.t.db, h.ports, {
      challengeToken: ok.challengeToken,
      code: nextTotp(h, secret),
    });
    expect(done.status).toBe('signed_in');
    const u = await h.t.admin.kysely
      .selectFrom('identity.users')
      .select('mfa_failed_attempts')
      .where('id', '=', m.userId)
      .executeTakeFirstOrThrow();
    expect(u.mfa_failed_attempts).toBe(0);
  });
});

describe('P2-13: concurrent replay of the same TOTP code or recovery code', () => {
  it('two parallel challenges with the same code: exactly one signs in', async () => {
    const o = await org(h);
    const m = await o.member([{ roleKey: 'front_desk', scopeType: 'organization' }]);
    const s = await signIn(h, m.email);
    const started = await o.tx((tx) => identity.enrolTotp(tx, h.ports, { currentPassword: PASSWORD }), s.ctx);
    if (!started.ok) throw started.error;
    const secret = base32Decode(started.value.secret);
    const confirmed = await o.tx(
      (tx) => identity.confirmTotp(tx, h.ports, { code: hotp(secret, timeStep(h.clock.now()) - 1) }),
      s.ctx,
    );
    if (!confirmed.ok) throw confirmed.error;
    const conf = confirmed.value;
    const code = hotp(secret, timeStep(h.clock.now()));
    const c1 = await identity.login(h.t.db, { email: m.email, password: PASSWORD });
    const c2 = await identity.login(h.t.db, { email: m.email, password: PASSWORD });
    if (c1.status !== 'mfa_required' || c2.status !== 'mfa_required') throw new Error('x');
    const r = await Promise.allSettled([
      identity.completeMfaChallenge(h.t.db, h.ports, { challengeToken: c1.challengeToken, code }),
      identity.completeMfaChallenge(h.t.db, h.ports, { challengeToken: c2.challengeToken, code }),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rc = conf.recoveryCodes[0] as string;
    const c3 = await identity.login(h.t.db, { email: m.email, password: PASSWORD });
    const c4 = await identity.login(h.t.db, { email: m.email, password: PASSWORD });
    if (c3.status !== 'mfa_required' || c4.status !== 'mfa_required') throw new Error('x');
    const r2 = await Promise.allSettled([
      identity.completeMfaChallenge(h.t.db, h.ports, { challengeToken: c3.challengeToken, recoveryCode: rc }),
      identity.completeMfaChallenge(h.t.db, h.ports, { challengeToken: c4.challengeToken, recoveryCode: rc }),
    ]);
    expect(r2.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  });
});

describe('P2-14 / ADR-0017 §3: staff messages', () => {
  it('live messages are reported as queued; simulated ones land in the operator mailbox, link encrypted', async () => {
    const notifier = outboxNotifier(h.ports.cipher);
    const live = await org(h);
    const queued = await live.tx((tx) =>
      notifier.send(tx, { kind: 'staff.invitation', to: 'q@lagoon.mv', subject: 's', body: 'b', link: 'x' }),
    );
    expect(queued).toEqual({ mode: 'queued' });
    const trial = await org(h, { environment: 'trial' });
    const recipient = `mailbox-${Date.now()}@lagoon.mv`;
    const link = 'https://app.portico.test/accept-invitation?token=inv.x.y';
    const simulated = await trial.tx((tx) =>
      notifier.send(tx, { kind: 'staff.invitation', to: recipient, subject: 's', body: 'b', link }),
    );
    expect(simulated).toEqual({ mode: 'simulated' });
    const raw = await h.t.admin.kysely
      .selectFrom('identity.dev_mailbox' as never)
      .selectAll()
      .execute();
    expect(JSON.stringify(raw)).not.toContain('token=inv.x.y');
    const mailbox = await readDevMailbox(h.t.db, h.ports.cipher, recipient);
    expect(mailbox).toMatchObject([{ organizationId: trial.tenantId, link }]);
    // The application role cannot read the mailbox table directly.
    await expect(
      withTenantTx(h.t.db, trial.ctx, (tx) =>
        tx.db
          .selectFrom('identity.dev_mailbox' as never)
          .selectAll()
          .execute(),
      ),
    ).rejects.toBeTruthy();
  });
});

describe('P2-15: reserved role keys', () => {
  it('custom roles cannot take a system template key or the portico_ prefix', async () => {
    const o = await org(h);
    for (const key of ['general_manager', 'portico_auditor'])
      await expect(
        o.tx((tx) =>
          identity.createRole(tx, h.ports, { key, name: 'x', permissions: ['platform.property.read'] }),
        ),
      ).rejects.toMatchObject({ code: 'reserved_role_key' });
  });
});
