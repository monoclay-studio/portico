import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identity, isExplainingAuthorizer } from '../src';
import { base32Decode, totp } from '../src/domain/totp';
import { authenticate, type Harness, harness, org, PASSWORD, signIn } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => h?.t.drop());

/** Enrol TOTP for a signed-in member; returns the secret and recovery codes. */
async function enrol(o: Awaited<ReturnType<typeof org>>, ctx: Parameters<typeof o.tx>[1]) {
  const { secret, otpauthUri } = await o.tx((tx) => identity.enrolTotp(tx, h.ports), ctx);
  expect(otpauthUri).toMatch(/^otpauth:\/\/totp\/Portico:/);
  const code = totp(base32Decode(secret), h.clock.now());
  const { recoveryCodes } = await o.tx((tx) => identity.confirmTotp(tx, h.ports, { code }), ctx);
  return { secret: base32Decode(secret), recoveryCodes };
}

const nextCode = (secret: Buffer) => {
  h.clock.advance(30_000); // a fresh time step (codes are single-use)
  return totp(secret, h.clock.now());
};

describe('TOTP enrolment and sign-in second factor', () => {
  it('enrols, stores only ciphertext, and then requires the second factor at sign-in', async () => {
    const o = await org(h);
    const m = await o.member([{ roleKey: 'front_desk', scopeType: 'organization' }]);
    const s = await signIn(h, m.email);
    const { secret, recoveryCodes } = await enrol(o, s.ctx);
    expect(recoveryCodes).toHaveLength(10);
    const stored = await h.t.admin.kysely
      .selectFrom('identity.mfa_factors')
      .select(['secret_enc', 'status'])
      .where('user_id', '=', m.userId)
      .where('status', '=', 'active')
      .executeTakeFirstOrThrow();
    expect(stored.secret_enc).toMatch(/^v1\.test\./);

    const login = await identity.login(h.t.db, { email: m.email, password: PASSWORD });
    expect(login.status).toBe('mfa_required');
    if (login.status !== 'mfa_required') return;
    await expect(
      identity.completeMfaChallenge(h.t.db, h.ports, {
        challengeToken: login.challengeToken,
        code: '000000',
      }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    const code = nextCode(secret);
    const done = await identity.completeMfaChallenge(h.t.db, h.ports, {
      challengeToken: login.challengeToken,
      code,
    });
    expect(done.status).toBe('signed_in');
    // The challenge is single-use, and the same code cannot be replayed on a new challenge.
    await expect(
      identity.completeMfaChallenge(h.t.db, h.ports, { challengeToken: login.challengeToken, code }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    const again = await identity.login(h.t.db, { email: m.email, password: PASSWORD });
    if (again.status !== 'mfa_required') throw new Error('expected challenge');
    await expect(
      identity.completeMfaChallenge(h.t.db, h.ports, { challengeToken: again.challengeToken, code }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    // A recovery code works exactly once.
    const rc = recoveryCodes[0] as string;
    await identity.completeMfaChallenge(h.t.db, h.ports, {
      challengeToken: again.challengeToken,
      recoveryCode: rc,
    });
    const third = await identity.login(h.t.db, { email: m.email, password: PASSWORD });
    if (third.status !== 'mfa_required') throw new Error('expected challenge');
    await expect(
      identity.completeMfaChallenge(h.t.db, h.ports, {
        challengeToken: third.challengeToken,
        recoveryCode: rc,
      }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    const status = await o.tx((tx) => identity.mfaStatus(tx, m.userId));
    expect(status).toMatchObject({ enrolled: true, recoveryCodesRemaining: 9 });
  });

  it('locks a challenge after 5 wrong codes', async () => {
    const o = await org(h);
    const m = await o.member([]);
    const s = await signIn(h, m.email);
    const { secret } = await enrol(o, s.ctx);
    const login = await identity.login(h.t.db, { email: m.email, password: PASSWORD });
    if (login.status !== 'mfa_required') throw new Error('expected challenge');
    for (let i = 0; i < 5; i++)
      await identity
        .completeMfaChallenge(h.t.db, h.ports, { challengeToken: login.challengeToken, code: '123456' })
        .catch(() => {});
    await expect(
      identity.completeMfaChallenge(h.t.db, h.ports, {
        challengeToken: login.challengeToken,
        code: nextCode(secret),
      }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

describe('central step-up enforcement in the authorizer', () => {
  it('sensitive permissions need a recent verification; non-sensitive ones never do', async () => {
    const o = await org(h);
    const p = await o.property('SU1');
    const m = await o.member([{ roleKey: 'general_manager', scopeType: 'property', scopeId: p.id }]);
    const s = await signIn(h, m.email);
    const { secret } = await enrol(o, s.ctx);
    // Enrolment verified the session just now: the sensitive permission is effective.
    let ctx = await authenticate(h, s.token);
    expect(ctx?.authz.can('platform.businessDate.advance', { propertyId: p.id })).toBe(true);
    // 16 minutes later the step-up window (15) has passed.
    h.clock.advance(16 * 60_000);
    ctx = await authenticate(h, s.token);
    if (!ctx || !isExplainingAuthorizer(ctx.authz)) throw new Error('expected explaining authorizer');
    expect(ctx.authz.can('platform.businessDate.advance', { propertyId: p.id })).toBe(false);
    expect(ctx.authz.explainDenial('platform.businessDate.advance', { propertyId: p.id })).toBe(
      'mfa_required',
    );
    expect(ctx.authz.can('platform.property.update', { propertyId: p.id })).toBe(true); // not sensitive
    expect(ctx.authz.explainDenial('identity.user.manage')).toBeNull(); // not granted at all
    // A wrong code counts; a right one restores the sensitive permission.
    const bad = await o.tx((tx) => identity.stepUp(tx, h.ports, { code: '999999' }), ctx);
    expect(bad).toMatchObject({ ok: false, attemptsRemaining: 4 });
    const good = await o.tx((tx) => identity.stepUp(tx, h.ports, { code: nextCode(secret) }), ctx);
    expect(good.ok).toBe(true);
    ctx = await authenticate(h, s.token);
    expect(ctx?.authz.can('platform.businessDate.advance', { propertyId: p.id })).toBe(true);
  });

  it('after the enrolment grace period an unenrolled member loses sensitive permissions only', async () => {
    const o = await org(h);
    const p = await o.property('SU2');
    const m = await o.member([{ roleKey: 'general_manager', scopeType: 'property', scopeId: p.id }]);
    const s = await signIn(h, m.email);
    expect(s.ctx.authz.can('platform.businessDate.advance', { propertyId: p.id })).toBe(true); // within grace
    await o.tx((tx) => identity.updateSecurityPolicy(tx, 0, { mfaGracePeriodHours: 0 }));
    const ctx = await authenticate(h, s.token);
    if (!ctx || !isExplainingAuthorizer(ctx.authz)) throw new Error('expected explaining authorizer');
    expect(ctx.authz.can('platform.businessDate.advance', { propertyId: p.id })).toBe(false);
    expect(ctx.authz.explainDenial('platform.businessDate.advance', { propertyId: p.id })).toBe(
      'mfa_enrollment_required',
    );
    expect(ctx.authz.propertyScope('platform.businessDate.advance')).toEqual([]);
    expect(ctx.authz.can('platform.property.read', { propertyId: p.id })).toBe(true);
    // Policy: require MFA for everyone.
    const pol = await o.tx((tx) => identity.getSecurityPolicy(tx));
    await o.tx((tx) => identity.updateSecurityPolicy(tx, pol.version, { requireMfaForAll: true }));
    const strict = await authenticate(h, s.token);
    expect(strict?.authz.can('platform.property.read', { propertyId: p.id })).toBe(false);
  });

  it('five wrong step-up codes sign the session out', async () => {
    const o = await org(h);
    const m = await o.member([]);
    const s = await signIn(h, m.email);
    await enrol(o, s.ctx);
    for (let i = 0; i < 4; i++) await o.tx((tx) => identity.stepUp(tx, h.ports, { code: '111111' }), s.ctx);
    const last = await o.tx((tx) => identity.stepUp(tx, h.ports, { code: '111111' }), s.ctx);
    expect(last).toMatchObject({ ok: false, sessionRevoked: true });
    expect(await authenticate(h, s.token)).toBeNull();
  });

  it('re-enrolment and disabling need a recent verification', async () => {
    const o = await org(h);
    const m = await o.member([]);
    const s = await signIn(h, m.email);
    await enrol(o, s.ctx);
    h.clock.advance(20 * 60_000);
    await expect(o.tx((tx) => identity.enrolTotp(tx, h.ports), s.ctx)).rejects.toMatchObject({
      code: 'mfa_required',
    });
    await expect(o.tx((tx) => identity.disableOwnMfa(tx), s.ctx)).rejects.toMatchObject({
      code: 'mfa_required',
    });
  });
});

describe('administrator MFA reset (lost device)', () => {
  it('resets a single-organization member and refuses when the sign-in is shared', async () => {
    const a = await org(h);
    const b = await org(h);
    const m = await a.member([]);
    const s = await signIn(h, m.email);
    await enrol(a, s.ctx);
    await a.tx((tx) => identity.resetMemberMfa(tx, m.userId, 'lost phone, identity checked by GM'));
    expect((await a.tx((tx) => identity.mfaStatus(tx, m.userId))).enrolled).toBe(false);
    expect(await authenticate(h, s.token)).toBeNull();

    const shared = await a.member([], `shared-${newId()}@lagoon.mv`);
    await b.tx((tx) => identity.createUser(tx, { email: shared.email, displayName: 'S', roles: [] }));
    await expect(a.tx((tx) => identity.resetMemberMfa(tx, shared.userId, 'x'))).rejects.toMatchObject({
      code: 'mfa_reset_requires_support',
    });
  });
});
