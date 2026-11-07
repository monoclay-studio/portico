import { createHash } from 'node:crypto';
import { sourcesFromManifests } from '@portico/db';
import { createServer, type PorticoApp } from '@portico/http';
import type { IdentityPorts } from '@portico/identity';
import { fixedClock, newId, randomToken } from '@portico/kernel';
import { createTestDatabase, type TestDatabase } from '@portico/testing';
import { compose, MANIFESTS } from '../src';
import { acceptInvitationOverHttp, enrolMfa, provisionWithAdmin } from './helpers';
import { totpCode } from './totp';

export interface EnterpriseHarness {
  t: TestDatabase;
  app: PorticoApp;
  clock: ReturnType<typeof fixedClock>;
  operator: { id: string; token: string };
  close(): Promise<void>;
}

/** API on a test database with a controllable clock, a configured Monoclay operator and optional port overrides. */
export async function startEnterpriseApi(identity: Partial<IdentityPorts> = {}): Promise<EnterpriseHarness> {
  const clock = fixedClock(new Date());
  const t = await createTestDatabase(sourcesFromManifests(MANIFESTS), { clock });
  const operatorId = newId();
  const token = `pto.${operatorId}.${randomToken(32)}`;
  const env = {
    NODE_ENV: 'test',
    PORTICO_OPERATORS: JSON.stringify([
      {
        id: operatorId,
        name: 'Test operator',
        email: 'ops@monoclay.test',
        tokenSha256: createHash('sha256').update(token).digest('hex'),
      },
    ]),
  };
  const c = compose(t.db, { env, identity });
  const app = await createServer({
    authenticator: c.authenticator,
    modules: c.httpModules,
    logger: false,
    rateLimit: false,
    openApi: { title: 'Portico API', version: '1.0.0' },
  });
  return {
    t,
    app,
    clock,
    operator: { id: operatorId, token },
    async close() {
      await app.close();
      await t.drop();
    },
  };
}

export const PASSWORD = 'correct horse battery staple';

/** Provision an organization with an admin, sign in over HTTP, and return helpers for more members. */
export async function enterpriseOrg(
  h: EnterpriseHarness,
  opts: { planCode?: string; name?: string; environment?: 'live' | 'trial'; mfa?: boolean } = {},
) {
  const email = `admin-${newId()}@lagoon.mv`;
  const { tenantId, adminUserId } = await provisionWithAdmin(
    h,
    {
      name: opts.name ?? 'Lagoon Collection',
      slug: `org-${newId().slice(-12)}`,
      environment: opts.environment ?? 'live',
      planCode: opts.planCode ?? 'enterprise',
      admin: { email, displayName: 'Admin' },
    },
    PASSWORD,
  );
  // Administrators enrol MFA so their sensitive (⚑) permissions work; `mfa: false` keeps a fresh, unenrolled one.
  const auth = opts.mfa === false ? await login(h, email) : await loginWithMfa(h, email);
  /** Add a second administrator (for separation-of-duties flows) and sign them in. */
  const addAdmin = async () => {
    const e = `admin2-${newId()}@lagoon.mv`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: { ...auth, 'idempotency-key': newId() },
      payload: {
        email: e,
        displayName: 'Second admin',
        roles: [{ roleKey: 'org_admin', scopeType: 'organization' }],
      },
    });
    if (res.statusCode !== 201) throw new Error(`create admin failed: ${res.body}`);
    // ADR-0017 rule 12: the new administrator accepts from their own email and chooses their password.
    await acceptInvitationOverHttp(h, e, PASSWORD);
    return { userId: res.json().userId as string, email: e, auth: await loginWithMfa(h, e) };
  };
  return { tenantId, adminUserId, email, auth, addAdmin };
}

/** Authenticator secrets of people enrolled through these helpers (test-only "phones"). */
const authenticators = new Map<string, string>();

/** Sign in over HTTP; a person with an authenticator answers the second-factor challenge with a fresh code. */
export async function login(h: EnterpriseHarness, email: string, organizationId?: string) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email, password: PASSWORD, ...(organizationId ? { organizationId } : {}) },
  });
  let body = res.json();
  const secret = authenticators.get(email);
  if (body.status === 'mfa_required' && secret) {
    h.clock.advance(30_000); // a fresh time step: codes are single-use
    const second = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/login/mfa',
      payload: { challengeToken: body.challengeToken, code: totpCode(secret, h.clock.now()) },
    });
    body = second.json();
  }
  if (body.status !== 'signed_in') throw new Error(`login failed: ${JSON.stringify(body)}`);
  return { authorization: `Bearer ${body.token}` };
}

/** Sign in and make sure the person has an authenticator, so sensitive (⚑) permissions are effective. */
export async function loginWithMfa(h: EnterpriseHarness, email: string, organizationId?: string) {
  const auth = await login(h, email, organizationId);
  if (!authenticators.has(email))
    authenticators.set(email, await enrolMfa(h.app, auth, PASSWORD, h.clock.now()));
  return auth;
}

/** The test authenticator of a person enrolled through these helpers. */
export function authenticatorOf(email: string): string | undefined {
  return authenticators.get(email);
}

export async function legalEntityAndProperty(
  h: EnterpriseHarness,
  auth: Record<string, string>,
  code = 'LGN',
) {
  const le = await h.app.inject({
    method: 'POST',
    url: '/v1/legal-entities',
    headers: { ...auth, 'idempotency-key': newId() },
    payload: { name: 'Lagoon Ltd', legalName: 'Lagoon Pvt Ltd', countryCode: 'MV', baseCurrency: 'USD' },
  });
  if (le.statusCode !== 201) throw new Error(`legal entity failed: ${le.body}`);
  const prop = await h.app.inject({
    method: 'POST',
    url: '/v1/properties',
    headers: { ...auth, 'idempotency-key': newId() },
    payload: {
      code,
      name: `Lagoon ${code}`,
      profile: 'resort',
      legalEntityId: le.json().id,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      businessDate: '2026-11-07',
    },
  });
  if (prop.statusCode !== 201) throw new Error(`property failed: ${prop.body}`);
  return { legalEntityId: le.json().id as string, propertyId: prop.json().id as string };
}
