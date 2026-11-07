import { StatusBadge, UiProvider } from '@portico/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './error-boundary';

let explode = true;
function Fragile() {
  if (explode) throw new Error('Cannot read properties of undefined (reading "checks")');
  return <p>Recovered</p>;
}

describe('P1-3: a failing part never takes the screen down', () => {
  it('contains a render failure, explains it without raw exception text, and recovers on Try again', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      explode = true;
      render(
        <UiProvider>
          <nav>Navigation still works</nav>
          <ErrorBoundary where="record">
            <Fragile />
          </ErrorBoundary>
        </UiProvider>,
      );
      expect(screen.getByText('Navigation still works')).toBeInTheDocument();
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('This screen ran into a problem');
      expect(alert).not.toHaveTextContent('Cannot read properties');
      expect(alert).not.toHaveTextContent('client:record');
      explode = false;
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(screen.getByText('Recovered')).toBeInTheDocument();
    } finally {
      err.mockRestore();
    }
  });

  it('a status value from a newer server renders as a neutral chip instead of crashing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      render(
        <UiProvider>
          <ErrorBoundary where="record">
            <StatusBadge vocabulary="stay" value="checked_in_pending_id" />
          </ErrorBoundary>
        </UiProvider>,
      );
      expect(screen.queryByRole('alert')).toBeNull();
      expect(document.querySelector('[data-unknown-status]')).toHaveTextContent('Checked in pending id');
    } finally {
      warn.mockRestore();
    }
  });
});
