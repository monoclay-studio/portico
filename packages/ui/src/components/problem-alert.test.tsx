import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations, formatViolations } from '../test/axe';
import { renderUi } from '../test/render';
import { isProblemDetails, networkProblem, type ProblemDetails } from './problem';
import { ProblemAlert } from './problem-alert';

const conflict: ProblemDetails = {
  type: 'https://docs.portico.app/errors/request_in_progress',
  title: 'Conflict',
  status: 409,
  code: 'request_in_progress',
  detail:
    'An identical request is still being processed. Wait a moment and check the result before trying again.',
  retryable: true,
  correlationId: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
};

describe('ProblemAlert', () => {
  it('shows what happened, how to recover, and the reference id', async () => {
    const onRetry = vi.fn();
    const { container } = renderUi(
      <ProblemAlert
        problem={{ ...conflict, safeToRetry: true, retryBasis: 'idempotency_key' }}
        onRetry={onRetry}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('An identical request is still being processed');
    expect(alert).toHaveTextContent(conflict.correlationId);
    expect(alert).toHaveTextContent(/Trying again is safe: this request carries a key/);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    const v = await axeViolations(container);
    expect(v, formatViolations(v)).toEqual([]);
  });

  it('offers no retry for non-retryable problems and lists field errors', () => {
    renderUi(
      <ProblemAlert
        problem={{
          ...conflict,
          status: 400,
          code: 'validation_failed',
          title: 'Invalid request',
          detail: 'Some fields are missing or invalid. Correct the highlighted fields and try again.',
          retryable: false,
          errors: [{ path: '/countryCode', message: 'Use a two-letter ISO country code, e.g. MV' }],
        }}
        onRetry={() => {}}
        fieldLabel={(p) => (p === '/countryCode' ? 'Country' : p)}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Country: Use a two-letter ISO country code');
    expect(screen.getByRole('alert')).not.toHaveTextContent(/Trying again is safe/);
  });

  it('shows a lost connection on a save as pending verification, never as failed, and offers no blind retry', async () => {
    const { container } = renderUi(
      <ProblemAlert
        problem={networkProblem(
          'client-abc',
          'We could not confirm whether this was saved. Check the record before trying again.',
          { title: 'Not confirmed yet', outcomeUnknown: true, safeToRetry: false },
        )}
        onRetry={() => {}}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-outcome', 'unknown');
    expect(alert.className).toContain('bg-pending-bg');
    expect(alert.className).not.toContain('danger');
    expect(alert).toHaveTextContent('We could not confirm whether this was saved');
    expect(alert).not.toHaveTextContent(/nothing was sent/i);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    // Client-generated references mean nothing to support: hidden.
    expect(alert).not.toHaveTextContent('client-abc');
    const v = await axeViolations(container);
    expect(v, formatViolations(v)).toEqual([]);
  });

  it('a read that timed out may be retried, and says why that is safe', () => {
    renderUi(
      <ProblemAlert
        problem={networkProblem('client-def', 'The server took too long to answer.', {
          code: 'request_timeout',
          safeToRetry: true,
          retryBasis: 'read',
        })}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Trying again is safe: it only reloads information.');
  });

  it('recognises problem+json bodies', () => {
    expect(isProblemDetails(conflict)).toBe(true);
    expect(isProblemDetails({ message: 'nope' })).toBe(false);
  });
});
