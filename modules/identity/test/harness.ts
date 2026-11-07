import { createHash } from 'node:crypto';
import { sourcesFromManifests, withTenantTx } from '@portico/db';
import {
  fixedClock,
  localFieldCipher,
  newId,
  type PermissionDefinition,
  type RequestContext,
} from '@portico/kernel';
import { platform, platformManifest } from '@portico/platform';
import { createTestDatabase, type TestDatabase, testContext } from '@portico/testing';
import { fieldEncryptedSecretStore, identity, identityManifest } from '../src';
import type { IdentityPorts, Notifier, StaffMessage } from '../src/ports';

export const PASSWORD = 'correct horse battery staple';

export interface Harness {
  t: TestDatabase;
  clock: ReturnType<typeof fixedClock>;
  ports: IdentityPorts;
  sent: StaffMessage[];
  catalog: PermissionDefinition[];
}

/** A database with platform + identity, a controllable clock, and identity ports bound to fakes. */
export async function harness(extra: Partial<IdentityPorts> = {}): Promise<Harness> {
  const clock = fixedClock(new Date());
  const t = await createTestDatabase(sourcesFromManifests([platformManifest, identityManifest]), { clock });
  const cipher = localFieldCipher(Buffer.from('identity-test-key').toString('base64'), 'test');
  const sent: StaffMessage[] = [];
  const notifier: Notifier = {
    async send(tx, message) {
      sent.push(message);
      return tx.environment === 'live' ? { mode: 'live' } : { mode: 'simulate', simulated: message };
    },
  };
  const catalog = [...platformManifest.permissions, ...identityManifest.permissions];
  const ports: IdentityPorts = {
    propertyIdsInScope: platform.propertyIdsInScope,
    permissionCatalog: () => catalog,
    cipher,
    secrets: fieldEncryptedSecretStore(cipher),
    notifier,
    hasEntitlement: (tx, f) => platform.hasEntitlement(tx, f),
    organizationName: async (tx) => (await platform.getOrganization(tx)).name,
    assertPropertyExists: async (tx, id) => {
      await platform.getPropertyFacts(tx, id);
    },
    config: {
      appBaseUrl: 'https://app.portico.test',
      ssoRedirectUri: 'https://app.portico.test/auth/sso/callback',
    },
    ...extra,
  };
  return { t, clock, ports, sent, catalog };
}

/** Organization with system roles, one legal entity and a property factory. */
export async function org(
  h: Harness,
  opts: { name?: string; planCode?: string; environment?: 'live' | 'trial' } = {},
) {
  const ctx = testContext({ environment: opts.environment ?? 'live' });
  const name = opts.name ?? `Org ${ctx.tenantId.slice(-6)}`;
  await withTenantTx(h.t.db, ctx, async (tx) => {
    await platform.provisionOrganization(tx, {
      name,
      slug: `org-${ctx.tenantId.slice(-12)}`,
      environment: opts.environment ?? 'live',
      planCode: opts.planCode ?? 'enterprise',
    });
    await identity.seedSystemRoles(tx);
  });
  const le = await withTenantTx(h.t.db, ctx, (tx) =>
    platform.createLegalEntity(tx, { name, legalName: name, countryCode: 'MV', baseCurrency: 'USD' }),
  );
  const property = (code: string) =>
    withTenantTx(h.t.db, ctx, (tx) =>
      platform.createProperty(tx, {
        code,
        name: code,
        profile: 'resort',
        legalEntityId: le.id,
        countryCode: 'MV',
        timezone: 'Indian/Maldives',
        baseCurrency: 'USD',
        businessDate: '2026-11-07',
      }),
    );
  /** Create a member with a password and roles (as the system). */
  const member = async (
    roles: Array<{ roleKey: string; scopeType: 'organization' | 'property'; scopeId?: string }>,
    email = `m-${newId()}@lagoon.mv`,
  ) => {
    const { userId } = await withTenantTx(h.t.db, ctx, (tx) =>
      identity.createUser(tx, {
        email,
        displayName: email.split('@')[0] as string,
        initialPassword: PASSWORD,
        roles,
      }),
    );
    return { userId, email };
  };
  const tx = <T>(fn: Parameters<typeof withTenantTx<T>>[2], as: RequestContext = ctx) =>
    withTenantTx(h.t.db, as, fn);
  return { ctx, tenantId: ctx.tenantId, name, le, property, member, tx };
}

/** Sign in with a password and return the authenticated principal. */
export async function signIn(h: Harness, email: string, organizationId?: string) {
  const res = await identity.login(h.t.db, {
    email,
    password: PASSWORD,
    ...(organizationId ? { organizationId } : {}),
  });
  if (res.status !== 'signed_in') throw new Error(`expected signed_in, got ${res.status}`);
  const principal = await identity.authenticateToken(h.t.db, res.token, h.ports);
  if (!principal) throw new Error('token did not authenticate');
  return { token: res.token, principal, ctx: principalContext(principal) };
}

export function principalContext(
  p: NonNullable<Awaited<ReturnType<typeof identity.authenticateToken>>>,
): RequestContext {
  return {
    tenantId: p.tenantId,
    environment: p.environment,
    actor: p.actor,
    authz: p.authz,
    correlationId: newId(),
  };
}

export async function authenticate(h: Harness, token: string) {
  const p = await identity.authenticateToken(h.t.db, token, h.ports);
  return p ? principalContext(p) : null;
}

export function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}
