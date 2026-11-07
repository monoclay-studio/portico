import { type APIRequestContext, test as base, expect, type Page } from '@playwright/test';

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

/** Sign in over the API (login is rate-limited, so tests reuse one session per organization). */
export async function apiSignIn(request: APIRequestContext, orgName = DEMO_ORG): Promise<ApiSession> {
  const first = await request.post('/v1/auth/login', { data: { email: DIRECTOR, password: PASSWORD } });
  expect(first.ok(), await first.text()).toBeTruthy();
  const choice = (await first.json()) as { status: string; organizations: ApiSession['organizations'] };
  const org = choice.organizations.find((o) => o.name === orgName);
  if (!org) throw new Error(`Organization ${orgName} not seeded`);
  const second = await request.post('/v1/auth/login', {
    data: { email: DIRECTOR, password: PASSWORD, organizationId: org.id },
  });
  const s = (await second.json()) as Omit<ApiSession, 'organizations'>;
  return { ...s, organizations: choice.organizations };
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
      const request = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:5180' });
      await use(await apiSignIn(request, DEMO_ORG));
      await request.dispose();
    },
    { scope: 'worker' },
  ],
  training: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:5180' });
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
