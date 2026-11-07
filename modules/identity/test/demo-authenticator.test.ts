/**
 * ADR-0017 amendment 2 (rule 16): demo organizations keep sensitive permissions usable because the demo seed enrols an
 * authenticator with a fixed, published demo secret for its fictitious users. That shortcut must be impossible
 * anywhere else: outside the `demo` environment, for a real address, for a non-system caller, or for someone who is
 * not a member of the demo organization.
 *
 * Also: the sign-in second step tells the person WHY a code was refused (wrong code with attempts left, or an
 * expired request that needs the password again), so the staff app can offer the right next step.
 */
import { withTenantTx } from '@portico/db';
import { newId, type RequestContext, systemAuthorizer } from '@portico/kernel';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identity } from '../src';
import { base32Decode, totp } from '../src/domain/totp';
import { authenticate, type Harness, harness, org, PASSWORD } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => h?.t.drop());

const DEMO_SECRET = 'PORTICODEMOAUTHENTICATORDEMOKEYS';

function systemCtx(tenantId: string, environment: RequestContext['environment']): RequestContext {
  return {
    tenantId,
    environment,
    actor: { kind: 'system', process: 'demo-seeder' },
    authz: systemAuthorizer,
    correlationId: newId(),
  };
}

/** A demo organization created the way the demo seed does it (system process, environment `demo`). */
async function demoOrg() {
  const ctx = systemCtx(newId(), 'demo');
  await withTenantTx(h.t.db, ctx, async (tx) => {
    await platform.provisionOrganization(tx, {
      id: ctx.tenantId,
      name: `Demo ${ctx.tenantId.slice(-6)}`,
      slug: `demo-${ctx.tenantId.slice(-12)}`,
      environment: 'demo',
      planCode: 'enterprise',
    });
    await identity.seedSystemRoles(tx);
  });
  const seedMember = (email: string, roleKey = 'org_admin') =>
    withTenantTx(h.t.db, ctx, (tx) =>
      identity.seedDemoMember(tx, {
        email,
        displayName: email.split('@')[0] as string,
        password: PASSWORD,
        roles: [{ roleKey, scopeType: 'organization' }],
      }),
    );
  return {
    ctx,
    seedMember,
    tx: <T>(fn: Parameters<typeof withTenantTx<T>>[2]) => withTenantTx(h.t.db, ctx, fn),
  };
}

const fictitious = () => `admin-${newId().slice(-8)}@demo-${newId().slice(-6)}.demo.portico.invalid`;

describe('rule 16: the fixed demo authenticator', () => {
  it('in a demo organization, a fictitious member gets the factor; sign-in then needs its code and ⚑ permissions work', async () => {
    const demo = await demoOrg();
    const email = fictitious();
    const { userId } = await demo.seedMember(email);
    const first = await demo.tx((tx) => identity.seedDemoTotp(tx, h.ports, { userId, secret: DEMO_SECRET }));
    // Idempotent: seeding again keeps the same factor.
    const again = await demo.tx((tx) => identity.seedDemoTotp(tx, h.ports, { userId, secret: DEMO_SECRET }));
    expect(again.factorId).toBe(first.factorId);

    const login = await identity.login(h.t.db, { email, password: PASSWORD });
    expect(login.status).toBe('mfa_required');
    if (login.status !== 'mfa_required') return;
    const done = await identity.completeMfaChallenge(h.t.db, h.ports, {
      challengeToken: login.challengeToken,
      code: totp(base32Decode(DEMO_SECRET), h.clock.now()),
    });
    const ctx = await authenticate(h, done.token);
    // A sensitive permission of the organization administrator is effective right after the verified sign-in.
    expect(ctx?.authz.can('identity.user.manage')).toBe(true);
  });

  it('is refused outside the demo environment, even for a fictitious address and a system process', async () => {
    for (const environment of ['live', 'trial', 'training', 'sandbox'] as const) {
      const o = await org(h, environment === 'live' || environment === 'trial' ? { environment } : {});
      // A fictitious person who really is a member (invited and accepted).
      const m = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }], fictitious());
      const ctx = systemCtx(o.tenantId, environment);
      await expect(
        withTenantTx(h.t.db, ctx, (tx) =>
          identity.seedDemoTotp(tx, h.ports, { userId: m.userId, secret: DEMO_SECRET }),
        ),
      ).rejects.toMatchObject({ code: 'demo_factor_not_allowed' });
      const factors = await h.t.admin.kysely
        .selectFrom('identity.mfa_factors')
        .select('id')
        .where('user_id', '=', m.userId)
        .execute();
      expect(factors).toHaveLength(0);
    }
  });

  it('a system context that merely CLAIMS demo is refused: the organization must be a demo organization in the database', async () => {
    const live = await org(h);
    const m = await live.member([{ roleKey: 'org_admin', scopeType: 'organization' }], fictitious());
    const claimsDemo = systemCtx(live.tenantId, 'demo');
    await expect(
      withTenantTx(h.t.db, claimsDemo, (tx) =>
        identity.seedDemoTotp(tx, h.ports, { userId: m.userId, secret: DEMO_SECRET }),
      ),
    ).rejects.toMatchObject({ code: 'demo_factor_not_allowed' });
    // The same check guards demo passwords (rule 12).
    await expect(
      withTenantTx(h.t.db, claimsDemo, (tx) =>
        identity.seedDemoMember(tx, { email: fictitious(), displayName: 'x', password: PASSWORD, roles: [] }),
      ),
    ).rejects.toMatchObject({ code: 'password_not_allowed' });
    const factors = await h.t.admin.kysely
      .selectFrom('identity.mfa_factors')
      .select('id')
      .where('user_id', '=', m.userId)
      .execute();
    expect(factors).toHaveLength(0);
  });

  it('is refused for a real email address, for a non-system caller, and for someone outside the demo organization', async () => {
    const demo = await demoOrg();
    // A real address cannot even be seeded as a demo member…
    await expect(demo.seedMember('gm@real-hotel.mv')).rejects.toMatchObject({ code: 'password_not_allowed' });
    // …and a real person who joined the demo organization by invitation cannot be given the fixed factor.
    const real = `gm-${newId().slice(-6)}@real-hotel.mv`;
    const { userId: realId } = await demo.tx((tx) =>
      identity.inviteMember(tx, h.ports, {
        email: real,
        displayName: 'Real GM',
        roles: [{ roleKey: 'org_admin', scopeType: 'organization' }],
      }),
    );
    await expect(
      demo.tx((tx) => identity.seedDemoTotp(tx, h.ports, { userId: realId, secret: DEMO_SECRET })),
    ).rejects.toMatchObject({ code: 'demo_factor_not_allowed' });

    // A signed-in user (even a demo administrator) cannot call it: only the system seeder.
    const email = fictitious();
    const { userId } = await demo.seedMember(email);
    const asUser: RequestContext = {
      ...demo.ctx,
      actor: { kind: 'user', userId, displayName: 'Demo admin' },
    };
    await expect(
      withTenantTx(h.t.db, asUser, (tx) =>
        identity.seedDemoTotp(tx, h.ports, { userId, secret: DEMO_SECRET }),
      ),
    ).rejects.toMatchObject({ code: 'demo_factor_not_allowed' });

    // A fictitious person of ANOTHER demo organization cannot be enrolled from this one.
    const other = await demoOrg();
    const { userId: outsider } = await other.seedMember(fictitious());
    await expect(
      demo.tx((tx) => identity.seedDemoTotp(tx, h.ports, { userId: outsider, secret: DEMO_SECRET })),
    ).rejects.toMatchObject({ code: 'demo_factor_not_allowed' });

    const factors = await h.t.admin.kysely
      .selectFrom('identity.mfa_factors')
      .select('id')
      .where('user_id', 'in', [realId, userId, outsider])
      .execute();
    expect(factors).toHaveLength(0);
  });
});

describe('sign-in second step explains a refused code', () => {
  it('wrong code → invalid_code with attempts left; used up or expired → challenge_expired (password again)', async () => {
    const demo = await demoOrg();
    const email = fictitious();
    const { userId } = await demo.seedMember(email);
    await demo.tx((tx) => identity.seedDemoTotp(tx, h.ports, { userId, secret: DEMO_SECRET }));
    const login = await identity.login(h.t.db, { email, password: PASSWORD });
    if (login.status !== 'mfa_required') throw new Error('expected the code step');
    const attempt = (code: string, token = login.challengeToken) =>
      identity.completeMfaChallenge(h.t.db, h.ports, { challengeToken: token, code });

    await expect(attempt('000000')).rejects.toMatchObject({
      code: 'unauthenticated',
      status: 401,
      details: { reason: 'invalid_code', attemptsRemaining: 4 },
    });
    await expect(attempt('000001')).rejects.toMatchObject({
      details: { reason: 'invalid_code', attemptsRemaining: 3 },
    });
    // The fifth wrong code uses the request up: the person must enter the password again.
    await attempt('000002').catch(() => {});
    await attempt('000003').catch(() => {});
    await expect(attempt('000004')).rejects.toMatchObject({
      details: { reason: 'challenge_expired', attemptsRemaining: 0 },
    });
    h.clock.advance(2 * 60_000); // past the per-person delay
    await expect(attempt(totp(base32Decode(DEMO_SECRET), h.clock.now()))).rejects.toMatchObject({
      details: { reason: 'challenge_expired' },
    });

    // An expired request (5 minutes) also asks for the password again, without counting a failure.
    const late = await identity.login(h.t.db, { email, password: PASSWORD });
    if (late.status !== 'mfa_required') throw new Error('expected the code step');
    h.clock.advance(6 * 60_000);
    await expect(
      attempt(totp(base32Decode(DEMO_SECRET), h.clock.now()), late.challengeToken),
    ).rejects.toMatchObject({ code: 'unauthenticated', details: { reason: 'challenge_expired' } });
    // A malformed request is treated the same way (nothing about the person is revealed).
    await expect(attempt('123456', 'pmc.not-a-tenant.x')).rejects.toMatchObject({
      details: { reason: 'challenge_expired' },
    });
  });

  it('too many wrong codes across requests → second_factor_locked (429) with the time to wait', async () => {
    const demo = await demoOrg();
    const email = fictitious();
    const { userId } = await demo.seedMember(email);
    await demo.tx((tx) => identity.seedDemoTotp(tx, h.ports, { userId, secret: DEMO_SECRET }));
    const login = await identity.login(h.t.db, { email, password: PASSWORD });
    if (login.status !== 'mfa_required') throw new Error('expected the code step');
    for (let i = 0; i < 5; i++)
      await identity
        .completeMfaChallenge(h.t.db, h.ports, { challengeToken: login.challengeToken, code: '111111' })
        .catch(() => {});
    const next = await identity.login(h.t.db, { email, password: PASSWORD });
    if (next.status !== 'mfa_required') throw new Error('expected the code step');
    const err = await identity
      .completeMfaChallenge(h.t.db, h.ports, {
        challengeToken: next.challengeToken,
        code: totp(base32Decode(DEMO_SECRET), h.clock.now()),
      })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'second_factor_locked', status: 429 });
    expect((err as { details: { retryAfter: string } }).details.retryAfter).toMatch(/^\d{4}-/);
  });
});
