import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations, formatViolations } from '../test/axe';
import { renderUi } from '../test/render';
import { isProblemDetails, type ProblemDetails } from './problem';
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
    const { container } = renderUi(<ProblemAlert problem={conflict} onRetry={onRetry} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('An identical request is still being processed');
    expect(alert).toHaveTextContent(conflict.correlationId);
    expect(alert).toHaveTextContent(/safe to try again/);
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
    expect(screen.getByRole('alert')).toHaveTextContent(/will fail the same way/);
  });

  it('recognises problem+json bodies', () => {
    expect(isProblemDetails(conflict)).toBe(true);
    expect(isProblemDetails({ message: 'nope' })).toBe(false);
  });
});
