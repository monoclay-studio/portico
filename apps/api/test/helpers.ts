import { sourcesFromManifests } from '@portico/db';
import type { PorticoApp } from '@portico/http';
import { outboxNotifier, readDevMailbox } from '@portico/identity';
import { fieldCryptoFromEnv, newId } from '@portico/kernel';
import { createTestDatabase, type TestDatabase } from '@portico/testing';
import { buildApp, MANIFESTS, type ProvisionInput, provisionOrganization } from '../src';
import { totpCode } from './totp';

/** The development field key the composition uses in tests (no PORTICO_FIELD_KEY set). */
const testCipher = fieldCryptoFromEnv({}).cipher;

/**
 * TEST-ONLY (never reachable over HTTP): the latest invitation token emailed to `email` — read from the developer
 * mailbox (non-live organizations) or decrypted from the queued staff message (live organizations), exactly what
 * the person would find in their inbox.
 */
export async function invitationTokenFor(t: TestDatabase, email: string): Promise<string> {
  const mailbox = await readDevMailbox(t.db, testCipher, email);
  let link = mailbox.find((m) => m.kind === 'staff.invitation' && m.link)?.link ?? undefined;
  if (!link) {
    const rows = await t.admin.kysely
      .selectFrom('core.outbox')
      .select(['aggregate_id', 'payload'])
      .where('type', '=', 'identity.staffMessage.requested')
      .orderBy('created_at', 'desc')
      .execute();
    for (const r of rows) {
      const p = r.payload as { to?: string; kind?: string; linkEnc?: string };
      if (p.to === email && p.kind === 'staff.invitation' && p.linkEnc) {
        link = testCipher.decrypt(p.linkEnc, `staff-message:${r.aggregate_id}`);
        break;
      }
    }
  }
  if (!link) throw new Error(`no invitation for ${email}`);
  return decodeURIComponent(link.split('token=')[1] as string);
}

/** TEST-ONLY: the invited person follows their link and chooses (or proves) their password over HTTP. */
export async function acceptInvitationOverHttp(
  h: { t: TestDatabase; app: PorticoApp },
  email: string,
  password: string,
) {
  const token = await invitationTokenFor(h.t, email);
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/auth/invitations/accept',
    payload: { token, password },
  });
  if (res.statusCode !== 200) throw new Error(`accept failed: ${res.body}`);
  return res.json() as { organizationId: string; userId: string };
}

/**
 * TEST-ONLY: provision an organization the way the operator does (ADR-0017 rule 12: the first administrator is
 * invited by email) and have the administrator accept with `password`.
 */
export async function provisionWithAdmin(
  h: { t: TestDatabase; app: PorticoApp },
  input: ProvisionInput,
  password: string,
) {
  const res = await provisionOrganization(h.t.db, input, 'test', {
    notifier: outboxNotifier(testCipher),
    config: { appBaseUrl: 'http://localhost:5173' },
  });
  await acceptInvitationOverHttp(h, input.admin.email, password);
  return res;
}

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
  const { tenantId } = await provisionWithAdmin(
    h,
    {
      name,
      slug: `org-${newId().slice(-12)}`,
      environment: 'live',
      planCode,
      admin: { email, displayName: 'Admin' },
    },
    password,
  );
  const res = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });
  const body = res.json();
  if (body.status !== 'signed_in') throw new Error(`login failed: ${res.body}`);
  const auth = { authorization: `Bearer ${body.token}` };
  await enrolMfa(h.app, auth, password);
  return { tenantId, token: body.token as string, auth };
}
