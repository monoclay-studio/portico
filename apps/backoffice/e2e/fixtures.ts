import { type APIRequestContext, test as base, expect, type Page } from '@playwright/test';
import { WEB_URL } from '../playwright.config';
import { answerWithDemoCode } from './demo-authenticator';

export { DEMO_TOTP_SECRET } from './demo-authenticator';
export const DIRECTOR = 'group.director@demo-azure-atoll.demo.portico.invalid';
export const FRONT_DESK = 'front.desk.agent@demo-azure-atoll.demo.portico.invalid';
export const PASSWORD = 'portico-demo-2026'; // demo environment only (printed by seed:demo)
export const DEMO_ORG = 'Azure Atoll Collection (demo)';
export const TRAINING_ORG = 'Azure Atoll Collection (training)';

export interface ApiSession {
  token: string;
  expiresAt: string;
  userId: string;
  organization: { id: string; name: string; environment: string };
  organizations: Array<{ id: string; name: string; environment: string }>;
}

type LoginAnswer =
  | {
      status: 'signed_in';
      token: string;
      expiresAt: string;
      userId: string;
      organization: ApiSession['organization'];
    }
  | { status: 'select_organization'; organizations: ApiSession['organizations'] }
  | { status: 'mfa_required'; challengeToken: string; organization: ApiSession['organization'] };

/**
 * Sign in over the API (login is rate-limited, so tests reuse one session per organization): password, organization,
 * then the code step answered with the demo authenticator (ADR-0017 rule 16 — demo users have two-step verification,
 * so their sensitive permissions work).
 */
export async function apiSignIn(
  request: APIRequestContext,
  orgName = DEMO_ORG,
  email = DIRECTOR,
): Promise<ApiSession> {
  const first = await request.post('/v1/auth/login', { data: { email, password: PASSWORD } });
  expect(first.ok(), await first.text()).toBeTruthy();
  let answer = (await first.json()) as LoginAnswer;
  const organizations =
    answer.status === 'select_organization' ? answer.organizations : [answer.organization];
  const org = organizations.find((o) => o.name === orgName);
  if (!org) throw new Error(`Organization ${orgName} not seeded`);
  if (answer.status === 'select_organization') {
    const second = await request.post('/v1/auth/login', {
      data: { email, password: PASSWORD, organizationId: org.id },
    });
    expect(second.ok(), await second.text()).toBeTruthy();
    answer = (await second.json()) as LoginAnswer;
  }
  if (answer.status === 'mfa_required') {
    const { challengeToken } = answer;
    let signedIn: LoginAnswer | null = null;
    await answerWithDemoCode(email, async (code) => {
      const r = await request.post('/v1/auth/login/mfa', { data: { challengeToken, code } });
      const body = (await r.json()) as LoginAnswer & { details?: { reason?: string } };
      if (r.ok()) {
        signedIn = body;
        return 'ok';
      }
      if (body.details?.reason === 'invalid_code') return 'wrong_code';
      throw new Error(`The sign-in code step failed: ${JSON.stringify(body)}`);
    });
    answer = signedIn as unknown as LoginAnswer;
  }
  if (answer.status !== 'signed_in') throw new Error(`Expected to be signed in, got ${answer.status}`);
  const { token, expiresAt, userId, organization } = answer;
  return { token, expiresAt, userId, organization, organizations };
}

/**
 * Answer the sign-in code step in the browser with the demo authenticator, like a person reading their phone. A code
 * this run cannot know was used (an earlier run) is refused at the field; the next one is tried.
 */
export async function enterSignInCode(page: Page, email: string) {
  await expect(page.getByRole('heading', { name: 'Enter your sign-in code' })).toBeVisible();
  const field = page.getByLabel('6-digit code');
  await expect(field).toBeFocused();
  await answerWithDemoCode(email, async (code) => {
    await field.fill(code);
    await field.press('Enter');
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (!new URL(page.url()).pathname.startsWith('/sign-in')) return 'ok';
      if (await page.getByText('That code is not right').isVisible()) return 'wrong_code';
      await page.waitForTimeout(100);
    }
    throw new Error('The sign-in code step neither signed in nor explained a wrong code');
  });
}

/** Start the page already signed in (sessionStorage is per tab, so it is injected before the app loads). */
export async function startSignedIn(
  page: Page,
  s: ApiSession,
  prefs: { theme?: 'light' | 'dark'; locale?: string } = {},
) {
  await page.addInitScript(
    ([session, orgs, theme, locale]) => {
      sessionStorage.setItem('portico.session.v1', session as string);
      sessionStorage.setItem('portico.orgChoices.v1', orgs as string);
      localStorage.setItem(
        `portico.learning.${JSON.parse(session as string).userId}`,
        JSON.stringify({ lessons: [], events: [], checklistDismissed: true }),
      );
      if (theme) localStorage.setItem('portico.theme', theme as string);
      else localStorage.removeItem('portico.theme');
      if (locale) localStorage.setItem('portico.locale', locale as string);
      else localStorage.removeItem('portico.locale');
    },
    [
      JSON.stringify({
        token: s.token,
        expiresAt: s.expiresAt,
        userId: s.userId,
        organization: s.organization,
      }),
      JSON.stringify(s.organizations),
      prefs.theme ?? null,
      prefs.locale ?? null,
    ] as const,
  );
}

export const test = base.extend<object, { demo: ApiSession; training: ApiSession }>({
  demo: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext({ baseURL: WEB_URL });
      await use(await apiSignIn(request, DEMO_ORG));
      await request.dispose();
    },
    { scope: 'worker' },
  ],
  training: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext({ baseURL: WEB_URL });
      await use(await apiSignIn(request, TRAINING_ORG));
      await request.dispose();
    },
    { scope: 'worker' },
  ],
});

export { expect };

export async function apiGet<T>(
  request: APIRequestContext,
  s: ApiSession,
  path: string,
): Promise<{ body: T; etag: string | undefined }> {
  const r = await request.get(`/v1${path}`, { headers: { authorization: `Bearer ${s.token}` } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return { body: (await r.json()) as T, etag: r.headers().etag };
}
