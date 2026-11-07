import { sourcesFromManifests } from '@portico/db';
import type { PorticoApp } from '@portico/http';
import { newId } from '@portico/kernel';
import { createTestDatabase, type TestDatabase } from '@portico/testing';
import { buildApp, MANIFESTS, provisionOrganization } from '../src';
import { totpCode } from './totp';

export interface ApiHarness {
  t: TestDatabase;
  app: PorticoApp;
  close(): Promise<void>;
}

export async function startApi(): Promise<ApiHarness> {
  const t = await createTestDatabase(sourcesFromManifests(MANIFESTS));
  const app = await buildApp({ database: t.db, logger: false, rateLimit: false });
  return {
    t,
    app,
    async close() {
      await app.close();
      await t.drop();
    },
  };
}

/**
 * Enrol an authenticator for the signed-in person over HTTP (proving the password, ADR-0017 §4). Sensitive (⚑)
 * permissions only take effect with MFA, so test administrators enrol right after signing in.
 */
export async function enrolMfa(
  app: PorticoApp,
  auth: Record<string, string>,
  password: string,
  now = new Date(),
) {
  const start = await app.inject({
    method: 'POST',
    url: '/v1/me/mfa/totp',
    headers: auth,
    payload: { currentPassword: password },
  });
  if (start.statusCode !== 200) throw new Error(`MFA enrolment failed: ${start.body}`);
  const secret = start.json().secret as string;
  const confirm = await app.inject({
    method: 'POST',
    url: '/v1/me/mfa/totp/confirm',
    headers: auth,
    payload: { code: totpCode(secret, now) },
  });
  if (confirm.statusCode !== 200) throw new Error(`MFA confirmation failed: ${confirm.body}`);
  return secret;
}

/** Provision an organization with an admin, sign in over HTTP and enrol MFA (so ⚑ permissions work). */
export async function signedInOrg(h: ApiHarness, name = 'Test Org', planCode = 'enterprise') {
  const email = `admin-${newId()}@example.mv`;
  const password = 'correct horse battery staple';
  const { tenantId } = await provisionOrganization(h.t.db, {
    name,
    slug: `org-${newId().slice(-12)}`,
    environment: 'live',
    planCode,
    admin: { email, displayName: 'Admin', password },
  });
  const res = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });
  const body = res.json();
  if (body.status !== 'signed_in') throw new Error(`login failed: ${res.body}`);
  const auth = { authorization: `Bearer ${body.token}` };
  await enrolMfa(h.app, auth, password);
  return { tenantId, token: body.token as string, auth };
}
