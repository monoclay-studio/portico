/**
 * HTTP-level regressions from the steward review (docs/orchestration/reviews/review-identity-plus.md) and
 * ADR-0017: consent for existing people, no credential links in responses (simulated messages go to the operator
 * mailbox), idempotent trial creation with a limit, operator console off in production, and per-IP limits that a
 * client cannot dodge with X-Forwarded-For.
 */
import { createHash, randomBytes } from 'node:crypto';
import { sourcesFromManifests } from '@portico/db';
import { createServer } from '@portico/http';
import { fixedClock, newId, randomToken } from '@portico/kernel';
import { createTestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compose, MANIFESTS } from '../src';
import {
  type EnterpriseHarness,
  enterpriseOrg,
  login,
  PASSWORD,
  startEnterpriseApi,
} from './enterprise-harness';

let h: EnterpriseHarness;
beforeAll(async () => {
  h = await startEnterpriseApi();
});
afterAll(async () => h?.close());

const operator = () => ({ authorization: `Bearer ${h.operator.token}` });

describe('ADR-0017 §2–3 over HTTP: consent and credential links', () => {
  it('adding an existing person creates an invitation they accept while signed in as themselves', async () => {
    const a = await enterpriseOrg(h, { name: 'Org A' });
    const b = await enterpriseOrg(h, { name: 'Org B' });
    const created = await h.app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: { ...a.auth, 'idempotency-key': newId() },
      payload: { email: b.email, displayName: 'Consultant', roles: [] },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      userId: b.adminUserId,
      status: 'invited',
      delivery: { mode: 'queued' },
    });
    expect(created.body).not.toMatch(/inv\.|prt\./);
    // Setting a password for an existing person is refused outright.
    const withPassword = await h.app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: { ...a.auth, 'idempotency-key': newId() },
      payload: { email: b.email, displayName: 'x', initialPassword: 'attacker-chosen-password', roles: [] },
    });
    expect(withPassword.json().code).toMatch(/already_member|person_already_has_sign_in/);
    // An admin-sent reset or MFA reset is refused: the person works elsewhere too.
    const reset = await h.app.inject({
      method: 'POST',
      url: `/v1/users/${b.adminUserId}/password-reset`,
      headers: a.auth,
    });
    expect(reset.json()).toMatchObject({ status: 422, code: 'person_shared_with_other_organization' });
    // The person sees the invitation in their own account and accepts it.
    const mine = await h.app.inject({ method: 'GET', url: '/v1/me/invitations', headers: b.auth });
    expect(mine.json().items).toEqual([
      expect.objectContaining({ organizationId: a.tenantId, name: 'Org A' }),
    ]);
    const accept = await h.app.inject({
      method: 'POST',
      url: `/v1/me/invitations/${a.tenantId}/accept`,
      headers: b.auth,
    });
    expect(accept.json()).toEqual({ organizationId: a.tenantId, userId: b.adminUserId });
    const choice = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: b.email, password: PASSWORD },
    });
    expect(choice.json().status).toMatch(/select_organization|mfa_required/);
  });

  it('simulated messages from a trial land in the operator mailbox, never in the admin’s response', async () => {
    const live = await enterpriseOrg(h, { name: 'Live hotel' });
    const key = newId();
    const createTrial = (idempotencyKey: string, name = 'Evaluation') =>
      h.app.inject({
        method: 'POST',
        url: '/v1/environments/trials',
        headers: { ...live.auth, 'idempotency-key': idempotencyKey },
        payload: { name },
      });
    const trial = await createTrial(key);
    expect(trial.statusCode).toBe(201);
    // P2-7: a retry with the same key replays the first trial instead of creating a second one.
    const retry = await createTrial(key);
    expect(retry.json().organizationId).toBe(trial.json().organizationId);
    const trialOrg = trial.json().organizationId as string;
    // The requester joined the trial directly (their own request); sign in there and invite someone.
    const trialAuth = await login(h, live.email, trialOrg);
    const recipient = `new-${newId()}@lagoon.mv`;
    const invite = await h.app.inject({
      method: 'POST',
      url: '/v1/users/invitations',
      headers: { ...trialAuth, 'idempotency-key': newId() },
      payload: { email: recipient, displayName: 'New colleague', roles: [] },
    });
    expect(invite.statusCode).toBe(201);
    expect(invite.json().delivery).toEqual({ mode: 'simulated' });
    expect(invite.body).not.toContain('accept-invitation');
    const stored = await h.t.admin.kysely
      .selectFrom('core.idempotency_keys')
      .select('response_body')
      .where('tenant_id', '=', trialOrg)
      .execute();
    expect(JSON.stringify(stored)).not.toContain('inv.');
    const mailbox = await h.app.inject({
      method: 'GET',
      url: `/v1/operator/mailbox?recipient=${encodeURIComponent(recipient)}`,
      headers: operator(),
    });
    expect(mailbox.statusCode).toBe(200);
    expect(mailbox.json().items).toEqual([
      expect.objectContaining({
        organizationId: trialOrg,
        kind: 'staff.invitation',
        link: expect.stringContaining('token=inv.'),
      }),
    ]);
    // P3-10: at most three open trials per live organization.
    expect((await createTrial(newId(), 'Second')).statusCode).toBe(201);
    expect((await createTrial(newId(), 'Third')).statusCode).toBe(201);
    const fourth = await createTrial(newId(), 'Fourth');
    expect(fourth.json()).toMatchObject({ status: 422, code: 'trial_limit_reached' });
  });
});

describe('P2-17: the operator console is off in production', () => {
  it('refuses operator tokens when NODE_ENV=production', async () => {
    const t = await createTestDatabase(sourcesFromManifests(MANIFESTS), { clock: fixedClock(new Date()) });
    const token = `pto.${newId()}.${randomToken(32)}`;
    const env = {
      NODE_ENV: 'production',
      PORTICO_FIELD_KEY: randomBytes(32).toString('base64'),
      PORTICO_BLIND_INDEX_KEY: randomBytes(32).toString('base64'),
      PORTICO_OPERATORS: JSON.stringify([
        {
          id: newId(),
          name: 'Operator',
          email: 'ops@monoclay.test',
          tokenSha256: createHash('sha256').update(token).digest('hex'),
        },
      ]),
    };
    const c = compose(t.db, { env });
    const app = await createServer({
      authenticator: c.authenticator,
      modules: c.httpModules,
      logger: false,
      rateLimit: false,
    });
    try {
      for (const [method, url] of [
        ['GET', '/v1/operator/security-alerts'],
        ['GET', '/v1/operator/mailbox?recipient=a%40b.mv'],
      ] as const) {
        const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` } });
        expect(res.json()).toMatchObject({ status: 403, code: 'operator_console_disabled' });
      }
    } finally {
      await app.close();
      await t.drop();
    }
  }, 60_000);
});

describe('P1-7 / ADR-0017 §11: per-IP limits key on the real client address', () => {
  it('rotating X-Forwarded-For from an untrusted client does not escape the sign-in limit', async () => {
    const t = await createTestDatabase(sourcesFromManifests(MANIFESTS), { clock: fixedClock(new Date()) });
    const c = compose(t.db, { env: { NODE_ENV: 'test' } });
    const app = await createServer({ authenticator: c.authenticator, modules: c.httpModules, logger: false });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 30; i++) {
        const r = await app.inject({
          method: 'POST',
          url: '/v1/auth/login',
          headers: { 'x-forwarded-for': `203.0.113.${i}` },
          payload: { email: 'nobody@lagoon.mv', password: 'x'.repeat(12) },
        });
        codes.push(r.statusCode);
      }
      expect(codes.filter((s) => s === 429).length).toBeGreaterThan(0);
    } finally {
      await app.close();
      await t.drop();
    }
  }, 60_000);
});
