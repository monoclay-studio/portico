import { sourcesFromManifests, withTenantTx } from '@portico/db';
import { newId, systemAuthorizer } from '@portico/kernel';
import { platform, platformManifest } from '@portico/platform';
import { createTestDatabase, type TestDatabase, testContext } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identity, identityManifest } from '../src';

let t: TestDatabase;
const ports = { propertyIdsInScope: platform.propertyIdsInScope };

beforeAll(async () => {
  t = await createTestDatabase(sourcesFromManifests([platformManifest, identityManifest]));
});
afterAll(async () => t?.drop());

async function org(name = 'Org') {
  const ctx = testContext();
  const slug = `org-${ctx.tenantId.slice(-12)}`;
  await withTenantTx(t.db, ctx, async (tx) => {
    await platform.provisionOrganization(tx, { name, slug, environment: 'live', planCode: 'enterprise' });
    await identity.seedSystemRoles(tx);
  });
  const le = await withTenantTx(t.db, ctx, (tx) =>
    platform.createLegalEntity(tx, { name, legalName: name, countryCode: 'MV', baseCurrency: 'USD' }),
  );
  const prop = (code: string) =>
    withTenantTx(t.db, ctx, (tx) =>
      platform.createProperty(tx, {
        code,
        name: code,
        profile: 'hotel',
        legalEntityId: le.id,
        countryCode: 'MV',
        timezone: 'Indian/Maldives',
        baseCurrency: 'USD',
        businessDate: '2026-11-07',
      }),
    );
  return { ctx, prop };
}

describe('sign-in and sessions', () => {
  it('signs in, authenticates the token with scoped permissions, and logs out', async () => {
    const { ctx, prop } = await org('Sunset Guesthouse');
    const p1 = await prop('P1');
    const p2 = await prop('P2');
    const email = `desk-${newId()}@example.mv`;
    await withTenantTx(t.db, ctx, (tx) =>
      identity.createUser(tx, {
        email,
        displayName: 'Aisha',
        initialPassword: 'correct horse battery',
        roles: [{ roleKey: 'front_desk', scopeType: 'property', scopeId: p1.id }],
      }),
    );
    const res = await identity.login(t.db, { email, password: 'correct horse battery' });
    expect(res.status).toBe('signed_in');
    if (res.status !== 'signed_in') return;
    const principal = await identity.authenticateToken(t.db, res.token, ports);
    expect(principal?.tenantId).toBe(ctx.tenantId);
    expect(principal?.authz.can('reservations.stay.checkIn', { propertyId: p1.id })).toBe(true);
    expect(principal?.authz.can('reservations.stay.checkIn', { propertyId: p2.id })).toBe(false);
    expect(principal?.authz.can('identity.user.manage')).toBe(false);

    const sessionId = principal?.actor.kind === 'user' ? principal.actor.sessionId : undefined;
    await withTenantTx(t.db, { ...ctx, authz: systemAuthorizer }, (tx) =>
      identity.revokeSession(tx, sessionId as string, 'logout'),
    );
    expect(await identity.authenticateToken(t.db, res.token, ports)).toBeNull();
  });

  it('gives the same error for unknown email and wrong password, and locks after repeated failures', async () => {
    const { ctx } = await org();
    const email = `lock-${newId()}@example.mv`;
    await withTenantTx(t.db, ctx, (tx) =>
      identity.createUser(tx, {
        email,
        displayName: 'L',
        initialPassword: 'a-very-long-password',
        roles: [],
      }),
    );
    const unknown = await identity
      .login(t.db, { email: `nobody-${newId()}@example.mv`, password: 'x' })
      .catch((e: Error) => e.message);
    const wrong = await identity.login(t.db, { email, password: 'nope' }).catch((e: Error) => e.message);
    expect(unknown).toBe(wrong);
    for (let i = 0; i < 9; i++) await identity.login(t.db, { email, password: 'nope' }).catch(() => {});
    await expect(identity.login(t.db, { email, password: 'a-very-long-password' })).rejects.toThrow(
      /Too many failed/,
    );
  });

  it('asks which organization when a person belongs to several, and never mixes them (scenario 17)', async () => {
    const a = await org('Org A');
    const b = await org('Org B');
    const email = `multi-${newId()}@example.mv`;
    await withTenantTx(t.db, a.ctx, (tx) =>
      identity.createUser(tx, {
        email,
        displayName: 'M',
        initialPassword: 'a-very-long-password',
        roles: [{ roleKey: 'org_admin', scopeType: 'organization' }],
      }),
    );
    // ADR-0017 §2: B can only INVITE an existing person; they accept while signed in as themselves.
    const added = await withTenantTx(t.db, b.ctx, (tx) =>
      identity.createUser(tx, { email, displayName: 'M', roles: [] }),
    );
    expect(added.status).toBe('invited');
    const onlyA = await identity.login(t.db, { email, password: 'a-very-long-password' });
    if (onlyA.status !== 'signed_in') throw new Error('expected sign-in to the only active organization');
    const self = await identity.authenticateToken(t.db, onlyA.token, ports);
    if (!self) throw new Error('expected principal');
    expect((await identity.listMyInvitations(t.db, self.actor)).map((i) => i.organizationId)).toEqual([
      b.ctx.tenantId,
    ]);
    await identity.acceptMembershipAsSelf(t.db, self.actor, b.ctx.tenantId);
    const choice = await identity.login(t.db, { email, password: 'a-very-long-password' });
    expect(choice.status).toBe('select_organization');
    const inB = await identity.login(t.db, {
      email,
      password: 'a-very-long-password',
      organizationId: b.ctx.tenantId,
    });
    if (inB.status !== 'signed_in') throw new Error('expected sign-in');
    const principal = await identity.authenticateToken(t.db, inB.token, ports);
    // Admin in A grants nothing in B.
    expect(principal?.authz.can('platform.property.read')).toBe(false);
    // A token whose tenant segment is swapped to A is rejected.
    const forged = inB.token.replace(b.ctx.tenantId, a.ctx.tenantId);
    expect(await identity.authenticateToken(t.db, forged, ports)).toBeNull();
  });

  it('suspending a member revokes sessions immediately (offboarding)', async () => {
    const { ctx } = await org();
    const email = `leaver-${newId()}@example.mv`;
    const { userId } = await withTenantTx(t.db, ctx, (tx) =>
      identity.createUser(tx, {
        email,
        displayName: 'Leaver',
        initialPassword: 'a-very-long-password',
        roles: [{ roleKey: 'read_only', scopeType: 'organization' }],
      }),
    );
    const res = await identity.login(t.db, { email, password: 'a-very-long-password' });
    if (res.status !== 'signed_in') throw new Error('expected sign-in');
    await withTenantTx(t.db, ctx, (tx) => identity.suspendMember(tx, userId, 'left the company'));
    expect(await identity.authenticateToken(t.db, res.token, ports)).toBeNull();
  });

  it('API clients are limited to their permissions and properties', async () => {
    const { ctx, prop } = await org();
    const p = await prop('API');
    const { token } = await withTenantTx(t.db, ctx, (tx) =>
      identity.createApiClient(tx, {
        name: 'POS bridge',
        permissions: ['finance.posting.create'],
        propertyIds: [p.id],
      }),
    );
    const principal = await identity.authenticateToken(t.db, token, ports);
    expect(principal?.actor.kind).toBe('api_client');
    expect(principal?.authz.can('finance.posting.create', { propertyId: p.id })).toBe(true);
    expect(principal?.authz.can('finance.posting.create', { propertyId: newId() })).toBe(false);
    expect(principal?.authz.can('reservations.booking.read', { propertyId: p.id })).toBe(false);
  });
});
