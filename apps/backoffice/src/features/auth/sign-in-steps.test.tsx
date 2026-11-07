import { UiProvider } from '@portico/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type SecondStep } from '../../api';
import { ApiError } from '../../api/errors';
import '../../i18n';
import { CodeStep } from './code-step';
import { SetupStep } from './setup-step';
import {
  normalizeAuthenticatorCode,
  normalizeRecoveryCode,
  secondStepFailure,
  secondsUntil,
} from './sign-in-problems';

const problem = (status: number, code: string, details?: Record<string, unknown>) =>
  new ApiError({
    type: `https://docs.portico.app/errors/${code}`,
    title: 'x',
    status,
    code,
    detail: 'server wording',
    retryable: false,
    correlationId: 'srv-1',
    ...(details ? { details } : {}),
  });

const signedIn = {
  status: 'signed_in' as const,
  token: 'pts.t.x',
  expiresAt: '2026-11-07T20:00:00.000Z',
  userId: '0190f5d2-6c1b-7000-8000-000000000001',
  organization: { id: '0190f5d2-6c1b-7000-8000-000000000002', name: 'Azure Atoll', environment: 'demo' },
};

const step: SecondStep = {
  status: 'mfa_required',
  challengeToken: 'pmc.0190f5d2-6c1b-7000-8000-000000000002.abc',
  expiresAt: '2026-11-07T18:05:00.000Z',
  methods: ['totp', 'recovery_code'],
  organization: { id: '0190f5d2-6c1b-7000-8000-000000000002', name: 'Azure Atoll', environment: 'live' },
};

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <UiProvider>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </UiProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('sign-in problems (pure)', () => {
  it('maps the server answers to the next step', () => {
    expect(
      secondStepFailure(problem(401, 'unauthenticated', { reason: 'invalid_code', attemptsRemaining: 2 })),
    ).toEqual({ kind: 'wrong_code', triesLeft: 2 });
    expect(secondStepFailure(problem(401, 'unauthenticated', { reason: 'challenge_expired' }))).toEqual({
      kind: 'expired',
    });
    // An older server without a reason: any 401 on the code step means "enter your password again".
    expect(secondStepFailure(problem(401, 'unauthenticated'))).toEqual({ kind: 'expired' });
    const until = '2026-11-07T18:10:00.000Z';
    expect(secondStepFailure(problem(429, 'second_factor_locked', { retryAfter: until }))).toEqual({
      kind: 'locked',
      until: new Date(until),
    });
    expect(secondStepFailure(problem(503, 'service_unavailable'))).toEqual({ kind: 'other' });
    expect(secondStepFailure(new Error('boom'))).toEqual({ kind: 'other' });
  });

  it('normalizes what people type', () => {
    expect(normalizeAuthenticatorCode('123 456')).toBe('123456');
    expect(normalizeAuthenticatorCode('12345')).toBeNull();
    expect(normalizeAuthenticatorCode('12a456')).toBeNull();
    expect(normalizeRecoveryCode('7k3qw px9mb')).toBe('7K3QW-PX9MB');
    expect(normalizeRecoveryCode('7K3QW-PX9M')).toBeNull();
    expect(secondsUntil(new Date(10_500), new Date(0))).toBe(11);
    expect(secondsUntil(new Date(0), new Date(10_000))).toBe(0);
  });
});

describe('second sign-in step', () => {
  it('is keyboard-first: the code field has focus and Enter verifies', async () => {
    const call = vi
      .spyOn(api, 'loginSecondStep')
      .mockResolvedValue({ data: signedIn, version: undefined, correlationId: 'c' });
    const onSignedIn = vi.fn();
    wrap(<CodeStep step={step} onSignedIn={onSignedIn} onRestart={vi.fn()} />);
    const field = screen.getByLabelText(/6-digit code/);
    expect(field).toHaveFocus();
    await userEvent.keyboard('123 456{Enter}');
    expect(call).toHaveBeenCalledWith({ challengeToken: step.challengeToken, code: '123456' });
    expect(onSignedIn).toHaveBeenCalledWith(signedIn);
  });

  it('explains a wrong code at the field with the tries left, and keeps the person on the step', async () => {
    vi.spyOn(api, 'loginSecondStep').mockRejectedValue(
      problem(401, 'unauthenticated', { reason: 'invalid_code', attemptsRemaining: 3 }),
    );
    const onRestart = vi.fn();
    wrap(<CodeStep step={step} onSignedIn={vi.fn()} onRestart={onRestart} />);
    await userEvent.keyboard('000000{Enter}');
    expect(await screen.findByText(/That code is not right\. .*3 more tries/)).toBeInTheDocument();
    expect(screen.getByLabelText(/6-digit code/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/6-digit code/)).toHaveFocus();
    expect(onRestart).not.toHaveBeenCalled();
    // A malformed code is caught before it costs a try.
    await userEvent.clear(screen.getByLabelText(/6-digit code/));
    await userEvent.keyboard('12{Enter}');
    expect(screen.getByText('Enter the 6 digits shown in your authenticator app.')).toBeInTheDocument();
    expect(api.loginSecondStep).toHaveBeenCalledTimes(1);
  });

  it('an expired sign-in goes back to the password step', async () => {
    vi.spyOn(api, 'loginSecondStep').mockRejectedValue(
      problem(401, 'unauthenticated', { reason: 'challenge_expired' }),
    );
    const onRestart = vi.fn();
    wrap(<CodeStep step={step} onSignedIn={vi.fn()} onRestart={onRestart} />);
    await userEvent.keyboard('123456{Enter}');
    await vi.waitFor(() => expect(onRestart).toHaveBeenCalledWith('expired'));
  });

  it('too many wrong codes: says until when, counts down, and blocks Verify meanwhile', async () => {
    const until = new Date(Date.now() + 61_000);
    vi.spyOn(api, 'loginSecondStep').mockRejectedValue(
      problem(429, 'second_factor_locked', { retryAfter: until.toISOString() }),
    );
    wrap(<CodeStep step={step} onSignedIn={vi.fn()} onRestart={vi.fn()} />);
    await userEvent.keyboard('123456{Enter}');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Too many wrong codes');
    expect(alert).toHaveTextContent(/codes are paused until/);
    expect(alert).toHaveTextContent(/You can try again in (60|61) s\./);
    expect(alert).toHaveTextContent('Reference');
    expect(screen.getByRole('button', { name: 'Verify and sign in' })).toBeDisabled();
  });

  it('offers a recovery code instead, and sends it as a recovery code', async () => {
    const call = vi
      .spyOn(api, 'loginSecondStep')
      .mockResolvedValue({ data: signedIn, version: undefined, correlationId: 'c' });
    wrap(<CodeStep step={step} onSignedIn={vi.fn()} onRestart={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    expect(screen.getByLabelText(/Recovery code/)).toHaveFocus();
    await userEvent.keyboard('7k3qw px9mb{Enter}');
    expect(call).toHaveBeenCalledWith({ challengeToken: step.challengeToken, recoveryCode: '7K3QW-PX9MB' });
    expect(screen.getByRole('button', { name: 'Use the authenticator app instead' })).toBeInTheDocument();
  });

  it('a demo organization says where the demo code comes from', () => {
    wrap(
      <CodeStep
        step={{ ...step, organization: { ...step.organization, environment: 'demo' } }}
        onSignedIn={vi.fn()}
        onRestart={vi.fn()}
      />,
    );
    expect(screen.getByText(/demo authenticator secret/)).toBeInTheDocument();
  });

  it('"Start again" returns to the password step', async () => {
    const onRestart = vi.fn();
    wrap(<CodeStep step={step} onSignedIn={vi.fn()} onRestart={onRestart} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(onRestart).toHaveBeenCalledWith('user');
  });
});

describe('two-step verification set-up after a password sign-in', () => {
  beforeEach(() => {
    vi.spyOn(api, 'startAuthenticatorSetup').mockResolvedValue({
      data: {
        factorId: '0190f5d2-6c1b-7000-8000-000000000009',
        secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        otpauthUri: 'otpauth://totp/Portico:a%40b.mv?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Portico',
      },
      version: undefined,
      correlationId: 'c',
    });
  });

  it('offer → key and first code (wrong, then right) → recovery codes → into the app', async () => {
    const confirm = vi
      .spyOn(api, 'confirmAuthenticatorSetup')
      .mockRejectedValueOnce(problem(400, 'invalid_code'))
      .mockResolvedValueOnce({
        data: { recoveryCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'] },
        version: undefined,
        correlationId: 'c',
      });
    const onDone = vi.fn();
    wrap(<SetupStep password="pw-just-typed" onDone={onDone} />);
    expect(screen.getByRole('button', { name: 'Set up now' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(api.startAuthenticatorSetup).toHaveBeenCalledWith({ currentPassword: 'pw-just-typed' });
    expect(await screen.findByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    expect(screen.getByLabelText(/Enter the 6-digit code/)).toHaveFocus();
    await userEvent.keyboard('111111{Enter}');
    expect(await screen.findByText(/That code is not right/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/Enter the 6-digit code/));
    await userEvent.keyboard('222222{Enter}');
    expect(confirm).toHaveBeenLastCalledWith('222222');
    expect(await screen.findByRole('status')).toHaveTextContent('Two-step verification is on');
    expect(screen.getByRole('list', { name: 'Save your recovery codes' })).toHaveTextContent('AAAAA-BBBBB');
    await userEvent.click(screen.getByRole('button', { name: 'I have saved them — continue' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('a discarded set-up offers to start again with a new key', async () => {
    vi.spyOn(api, 'confirmAuthenticatorSetup').mockRejectedValue(
      problem(400, 'invalid_code', { setupDiscarded: true }),
    );
    wrap(<SetupStep password="pw" onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up now' }));
    await screen.findByLabelText(/Enter the 6-digit code/);
    await userEvent.keyboard('111111{Enter}');
    const again = await screen.findByRole('button', { name: 'Start the set-up again' });
    await act(async () => {
      await userEvent.click(again);
    });
    expect(api.startAuthenticatorSetup).toHaveBeenCalledTimes(2);
  });

  it('"Not now" continues into the app without setting anything up', async () => {
    const onDone = vi.fn();
    wrap(<SetupStep password="pw" onDone={onDone} />);
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onDone).toHaveBeenCalled();
    expect(api.startAuthenticatorSetup).not.toHaveBeenCalled();
  });
});
