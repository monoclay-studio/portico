import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations, formatViolations } from '../test/axe';
import { renderUi } from '../test/render';
import { ChangePreview } from './change-preview';
import { classifyConflict, reapplyPatch } from './conflict';
import { ConflictDialog } from './conflict-dialog';
import { StepTracker } from './step-tracker';

const original = {
  name: 'Azure Atoll Resort',
  checkInTime: '14:00',
  checkOutTime: '12:00',
  timezone: 'Indian/Maldives',
};
const latest = { ...original, checkInTime: '15:00', name: 'Azure Atoll Resort & Spa' };
const mine = { checkInTime: '13:00', checkOutTime: '11:00', name: 'Azure Atoll Resort & Spa' };
const keys = ['name', 'checkInTime', 'checkOutTime', 'timezone'] as const;

describe('classifyConflict', () => {
  it('separates both-changed, mine-only, theirs-only and identical changes', () => {
    const rows = classifyConflict(original, mine, latest, keys);
    expect(Object.fromEntries(rows.map((r) => [r.key, r.kind]))).toEqual({
      name: 'same', // both made the same change: no conflict
      checkInTime: 'both',
      checkOutTime: 'mine',
      timezone: 'same',
    });
  });

  it('re-applies only selected fields that I changed', () => {
    const rows = classifyConflict(original, mine, latest, keys);
    expect(reapplyPatch(rows, new Set(['checkInTime', 'checkOutTime', 'timezone']))).toEqual({
      checkInTime: '13:00',
      checkOutTime: '11:00',
    });
    expect(reapplyPatch(rows, new Set(['checkOutTime']))).toEqual({ checkOutTime: '11:00' });
  });

  it('treats a field the other user changed and I did not touch as theirs', () => {
    const rows = classifyConflict(original, { checkOutTime: '11:00' }, latest, keys);
    expect(rows.find((r) => r.key === 'checkInTime')?.kind).toBe('theirs');
  });
});

describe('ConflictDialog', () => {
  it('shows yours vs saved, lets the user drop a change and re-applies the rest', async () => {
    const onReapply = vi.fn();
    const rows = classifyConflict(original, mine, latest, keys).map((r) => ({ ...r, label: r.key }));
    renderUi(
      <ConflictDialog
        open
        onOpenChange={() => {}}
        entity="property"
        rows={rows}
        expectedVersion={3}
        currentVersion={4}
        onReapply={onReapply}
        onDiscard={() => {}}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Someone else changed this property' });
    expect(dialog).toHaveTextContent('You edited version 3; the saved version is now 4.');
    const both = dialog.querySelector('[data-conflict="both"]') as HTMLElement;
    expect(within(both).getByText('13:00')).toBeInTheDocument();
    expect(within(both).getByText('15:00')).toBeInTheDocument();
    expect(within(both).getByText('Both changed')).toBeInTheDocument();
    await userEvent.click(within(both).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Re-apply 1 change(s)' }));
    expect(onReapply).toHaveBeenCalledWith(['checkOutTime']);
    const v = await axeViolations(document.body);
    expect(v, formatViolations(v)).toEqual([]);
  });
});

describe('ChangePreview', () => {
  const sections = [
    {
      kind: 'availability' as const,
      rows: [
        { label: 'Water Villa · 14 Nov', before: '2 available', after: '1 available', delta: '−1' },
        {
          label: 'Water Villa · 15 Nov',
          before: '1 available',
          after: '0 available',
          delta: '−1',
          attention: 'warning' as const,
        },
      ],
    },
    {
      kind: 'price' as const,
      rows: [{ label: 'Room total', before: '$3,200.00', after: '$4,800.00', delta: '+$1,600.00' }],
    },
    {
      kind: 'deposits' as const,
      rows: [{ label: 'Deposit held', before: '$960.00', after: '$960.00', changed: false }],
    },
  ];

  it('shows before/after per section and commits only on confirm', async () => {
    const onConfirm = vi.fn();
    const { container } = renderUi(
      <ChangePreview
        title="Extend stay by 2 nights"
        sections={sections}
        onConfirm={onConfirm}
        onBack={() => {}}
      />,
    );
    expect(container.querySelectorAll('[data-preview-section]')).toHaveLength(3);
    expect(screen.getByText('No change')).toBeInTheDocument();
    expect(screen.getByText('+$1,600.00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    const v = await axeViolations(container);
    expect(v, formatViolations(v)).toEqual([]);
  });

  it('blocks confirming a stale preview and offers a refresh', async () => {
    const onRefresh = vi.fn();
    renderUi(
      <ChangePreview
        title="Move"
        sections={sections}
        stale
        onRefresh={onRefresh}
        onConfirm={() => {}}
        onBack={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Confirm change' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
    expect(onRefresh).toHaveBeenCalled();
  });
});

describe('StepTracker', () => {
  it('shows which steps completed, which failed and why, and offers resume', async () => {
    const onResume = vi.fn();
    const { container } = renderUi(
      <StepTracker
        title="Check-in"
        onResume={onResume}
        steps={[
          { id: 'id', label: 'Verify identity', status: 'done' },
          {
            id: 'guarantee',
            label: 'Secure payment',
            status: 'pending_verification',
            detail: 'Card authorization sent 10:58',
          },
          { id: 'key', label: 'Issue key', status: 'failed', error: 'Door lock system did not answer.' },
          { id: 'welcome', label: 'Send welcome message', status: 'pending' },
        ]}
      />,
    );
    expect(screen.getByText('1 of 4 steps complete')).toBeInTheDocument();
    expect(screen.getByText('Door lock system did not answer.')).toBeInTheDocument();
    expect(screen.getByText('Pending verification')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalled();
    const v = await axeViolations(container);
    expect(v, formatViolations(v)).toEqual([]);
  });
});
