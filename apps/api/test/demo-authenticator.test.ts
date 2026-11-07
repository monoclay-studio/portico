/**
 * ADR-0017 rule 16 over HTTP: the demo seed's fixed authenticator keeps demo administrators' sensitive (⚑) permissions
 * usable, and the sign-in second step explains a refused code so the staff app can offer the right next step.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, DEMO_TOTP_SECRET, seedDemo } from '../src/seed/demo';
import { type ApiHarness, startApi } from './helpers';
import { totpCode } from './totp';

let h: ApiHarness;
beforeAll(async () => {
  h = await startApi();
});
afterAll(async () => h?.close());

const login = (email: string | undefined, organizationId: string | undefined) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email, password: DEMO_PASSWORD, organizationId },
  });
const second = (challengeToken: string, code: string) =>
  h.app.inject({ method: 'POST', url: '/v1/auth/login/mfa', payload: { challengeToken, code } });
const alerts = (token: string) =>
  h.app.inject({ method: 'GET', url: '/v1/security/alerts', headers: { authorization: `Bearer ${token}` } });

describe('demo organizations and sensitive permissions (rule 16)', () => {
  it('without it, the same demo administrator would lose ⚑ permissions (why rule 16 exists)', async () => {
    const orgs = await seedDemo(h.t.db, { businessDate: '2026-11-07', steps: [] });
    const admin = orgs[0]?.users.find((u) => u.role === 'org_admin');
    const res = await login(admin?.email, orgs[0]?.tenantId);
    expect(res.json()).toMatchObject({ status: 'signed_in' });
    const refused = await alerts(res.json().token);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'mfa_enrollment_required' });
  }, 120_000);

  it('with the demo authenticator, a demo administrator signs in with password + code and keeps ⚑ permissions', async () => {
    const orgs = await seedDemo(h.t.db, { businessDate: '2026-11-07', steps: [], authenticator: true });
    const admin = orgs[0]?.users.find((u) => u.role === 'org_admin');
    // Seeded again with the authenticator: the same fictitious person now holds the (global) demo factor.
    const first = await login(admin?.email, orgs[0]?.tenantId);
    expect(first.json()).toMatchObject({ status: 'mfa_required', organization: { environment: 'demo' } });
    const { challengeToken } = first.json() as { challengeToken: string };

    // A wrong code says so, with the attempts left (staff app: "try again").
    const wrong = await second(challengeToken, '000000');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toMatchObject({
      code: 'unauthenticated',
      details: { reason: 'invalid_code', attemptsRemaining: 4 },
    });

    const ok = await second(challengeToken, totpCode(DEMO_TOTP_SECRET, new Date()));
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'signed_in', organization: { environment: 'demo' } });
    const res = await alerts(ok.json().token);
    expect(res.statusCode, res.body).toBe(200);

    // The used request cannot be used again: the staff app goes back to the password step.
    const replay = await second(challengeToken, totpCode(DEMO_TOTP_SECRET, new Date(Date.now() + 30_000)));
    expect(replay.json()).toMatchObject({
      code: 'unauthenticated',
      details: { reason: 'challenge_expired' },
    });
  }, 120_000);
});
