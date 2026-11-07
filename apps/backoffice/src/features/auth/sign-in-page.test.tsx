import { UiProvider } from '@portico/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { api } from '../../api';
import { ApiError } from '../../api/errors';
import { sessionStore } from '../../api/session';
import '../../i18n';
import { SignInPage } from './sign-in-page';

// jsdom has no scrolling; the router restores scroll positions on navigation.
window.scrollTo = (() => {}) as typeof window.scrollTo;

const ORG = { id: '0190f5d2-6c1b-7000-8000-000000000002', name: 'Azure Atoll', environment: 'live' };
const OTHER = {
  id: '0190f5d2-6c1b-7000-8000-000000000003',
  name: 'Azure Atoll (training)',
  environment: 'training',
};
const ok = <T,>(data: T) => ({ data, version: undefined, correlationId: 'c' });
const problem = (status: number, code: string, details?: Record<string, unknown>) =>
  new ApiError({
    type: 'about:blank',
    title: 'x',
    status,
    code,
    detail: 'server wording',
    retryable: false,
    correlationId: 'srv-9',
    ...(details ? { details } : {}),
  });

/** The real sign-in page on a minimal router (same search schema as the app). */
async function renderSignIn() {
  const root = createRootRoute({ component: Outlet });
  const signIn = createRoute({
    getParentRoute: () => root,
    path: '/sign-in',
    validateSearch: z.object({
      redirect: z.string().optional(),
      reason: z.enum(['expired', 'signed_out']).optional(),
    }),
    component: SignInPage,
  });
  const home = createRoute({ getParentRoute: () => root, path: '/', component: () => <h1>Home</h1> });
  const router = createRouter({
    routeTree: root.addChildren([signIn, home]),
    history: createMemoryHistory({ initialEntries: ['/sign-in'] }),
  });
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <UiProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </UiProvider>,
  );
  await screen.findByRole('heading', { name: 'Sign in' });
  return router;
}

async function enterPassword(email = 'gm@hotel.mv') {
  await userEvent.type(screen.getByLabelText(/Work email/), email);
  await userEvent.type(screen.getByLabelText(/^Password/), 'pw-1');
  await userEvent.keyboard('{Enter}');
}

afterEach(() => {
  vi.restoreAllMocks();
  sessionStore.reset();
});

describe('sign-in page', () => {
  it('password → organization → code → signed in', async () => {
    const login = vi
      .spyOn(api, 'login')
      .mockResolvedValueOnce(ok({ status: 'select_organization' as const, organizations: [ORG, OTHER] }))
      .mockResolvedValueOnce(
        ok({
          status: 'mfa_required' as const,
          challengeToken: `pmc.${ORG.id}.abc`,
          expiresAt: '2026-11-07T18:05:00.000Z',
          methods: ['totp' as const, 'recovery_code' as const],
          organization: ORG,
        }),
      );
    vi.spyOn(api, 'loginSecondStep').mockResolvedValue(
      ok({
        status: 'signed_in' as const,
        token: 'pts.t.1',
        expiresAt: '2099-01-01T00:00:00.000Z',
        userId: '0190f5d2-6c1b-7000-8000-000000000001',
        organization: ORG,
      }),
    );
    const router = await renderSignIn();
    await enterPassword();
    await screen.findByRole('heading', { name: 'Choose an organization' });
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(login).toHaveBeenLastCalledWith({
      email: 'gm@hotel.mv',
      password: 'pw-1',
      organizationId: ORG.id,
    });
    await screen.findByRole('heading', { name: 'Enter your sign-in code' });
    expect(screen.getByLabelText(/6-digit code/)).toHaveFocus();
    await userEvent.keyboard('123456{Enter}');
    await screen.findByRole('heading', { name: 'Home' });
    expect(router.state.location.pathname).toBe('/');
    expect(sessionStore.get()?.token).toBe('pts.t.1');
  });

  it('an expired code step goes back to the password, says why, and keeps the chosen organization', async () => {
    const login = vi.spyOn(api, 'login').mockResolvedValue(
      ok({
        status: 'mfa_required' as const,
        challengeToken: `pmc.${OTHER.id}.abc`,
        expiresAt: '2026-11-07T18:05:00.000Z',
        methods: ['totp' as const, 'recovery_code' as const],
        organization: OTHER,
      }),
    );
    vi.spyOn(api, 'loginSecondStep').mockRejectedValue(
      problem(401, 'unauthenticated', { reason: 'challenge_expired' }),
    );
    await renderSignIn();
    await enterPassword();
    await screen.findByRole('heading', { name: 'Enter your sign-in code' });
    await userEvent.keyboard('123456{Enter}');
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.getByRole('status')).toHaveTextContent('Enter your password again to continue');
    expect(screen.getByLabelText(/Work email/)).toHaveValue('gm@hotel.mv');
    expect(screen.getByLabelText(/^Password/)).toHaveValue('');
    expect(screen.getByLabelText(/^Password/)).toHaveFocus();
    await userEvent.keyboard('pw-1{Enter}');
    expect(login).toHaveBeenLastCalledWith({
      email: 'gm@hotel.mv',
      password: 'pw-1',
      organizationId: OTHER.id,
    });
  });

  it('a person without two-step verification is signed in and offered the set-up; "Not now" continues', async () => {
    vi.spyOn(api, 'login').mockResolvedValue(
      ok({
        status: 'signed_in' as const,
        token: 'pts.t.2',
        expiresAt: '2099-01-01T00:00:00.000Z',
        userId: '0190f5d2-6c1b-7000-8000-000000000001',
        organization: ORG,
      }),
    );
    await renderSignIn();
    await enterPassword();
    await screen.findByRole('heading', { name: 'Protect your account with two-step verification' });
    expect(sessionStore.get()?.token).toBe('pts.t.2');
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await screen.findByRole('heading', { name: 'Home' });
  });

  it('an organization that requires its company account says so, with the next step', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(problem(401, 'sso_required', { organizationId: ORG.id }));
    await renderSignIn();
    await enterPassword();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your organization signs in with its company account');
    expect(alert).toHaveTextContent('ask your Portico administrator');
    expect(alert).not.toHaveTextContent('Email or password not recognised');
  });

  it('a wrong password keeps the existing explanation', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(problem(401, 'unauthenticated'));
    await renderSignIn();
    await enterPassword();
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password not recognised');
  });
});
