import { sourcesFromManifests } from '@portico/db';
import type { PorticoApp } from '@portico/http';
import { newId } from '@portico/kernel';
import { createTestDatabase, type TestDatabase } from '@portico/testing';
import { buildApp, MANIFESTS, provisionOrganization } from '../src';

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

/** Provision an organization with an admin and sign in over HTTP. */
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
  return { tenantId, token: body.token as string, auth };
}
