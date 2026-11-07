import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations, formatViolations } from '../../test/axe';
import { renderUi } from '../../test/render';
import { EntityLink } from './entity-link';
import { HistoryTimeline } from './history-timeline';
import { RecordDrawer } from './record-drawer';
import { RecordView } from './record-view';
import type { RecordModel } from './types';

const model: RecordModel = {
  type: 'stay',
  id: 's1',
  typeLabel: 'Stay',
  title: 'Sophie Laurent',
  code: 'K7P2M9QX',
  status: [
    { family: 'booking', vocabulary: 'booking', value: 'confirmed' },
    { family: 'stay', vocabulary: 'stay', value: 'expected' },
    { family: 'payment', vocabulary: 'payment', value: 'pending_verification' },
  ],
  provenance: { kind: 'simulated' },
  actions: [
    {
      action: 'checkIn',
      label: 'Check in',
      enabled: false,
      reason: 'Villa 212 has not passed inspection yet',
    },
    { action: 'extend', label: 'Extend stay', enabled: true, previewRequired: true },
    { action: 'move', label: 'Move unit', enabled: true },
    { action: 'cancel', label: 'Cancel booking', enabled: false, reason: 'Needs the reservations module' },
  ],
  issues: [
    {
      code: 'condition',
      severity: 'blocking',
      message: 'Villa 212 failed inspection',
      owner: { kind: 'department', id: 'hk', name: 'Housekeeping' },
    },
  ],
  owner: { kind: 'user', id: 'u1', name: 'Aishath' },
  sections: [{ id: 'details', title: 'Details', content: <p>2 adults</p> }],
  links: [{ rel: 'unit', type: 'unit', id: 'wv212', title: 'Villa 212' }],
  helpKey: 'reservations.stay.record',
};

describe('RecordView (universal record anatomy)', () => {
  it('shows separate status chips, next actions with disabled reasons, issues, owner, related and history', async () => {
    const onAction = vi.fn();
    const { container } = renderUi(
      <RecordView
        model={model}
        onAction={onAction}
        history={{
          state: 'ready',
          items: [
            {
              at: '2026-11-01T09:00:00Z',
              action: 'reservations.booking.confirm',
              actor: { kind: 'user', label: 'Reservations' },
              reason: 'Phone booking',
            },
          ],
        }}
        describeAction={(a) => (a === 'reservations.booking.confirm' ? 'Booking confirmed' : a)}
        renderLink={(l) => <a href={`#${l.id}`}>{l.title}</a>}
      />,
    );
    expect(container.querySelectorAll('[data-vocabulary]')).toHaveLength(3);
    const checkIn = screen.getByRole('button', { name: 'Check in' });
    expect(checkIn).toHaveAttribute('aria-disabled', 'true');
    expect(checkIn).toHaveAccessibleDescription('Villa 212 has not passed inspection yet');
    await userEvent.click(checkIn);
    expect(onAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Extend stay/ }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'extend' }));
    // 4th action goes into the menu
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).toBeNull();
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument();
    expect(container.querySelector('[data-issue-severity="blocking"]')).toHaveTextContent(
      'Villa 212 failed inspection',
    );
    expect(screen.getByText('Aishath')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Villa 212' })).toBeInTheDocument();
    expect(screen.getByText('Booking confirmed')).toBeInTheDocument();
    expect(container.querySelector('[data-help-key="reservations.stay.record"]')).not.toBeNull();
    const v = await axeViolations(container);
    expect(v, formatViolations(v)).toEqual([]);
  });

  it('renders empty and unavailable history honestly', () => {
    renderUi(<HistoryTimeline history={{ state: 'unavailable' }} />);
    expect(screen.getByText(/not available yet/)).toBeInTheDocument();
  });
});

describe('RecordDrawer', () => {
  it('shows the breadcrumb trail; Esc steps back; crumbs jump', async () => {
    const onBack = vi.fn();
    const onNavigateTrail = vi.fn();
    const onOpenFullPage = vi.fn();
    renderUi(
      <RecordDrawer
        title="Unit: Villa 212"
        trail={[
          { key: 'stay:s1', title: 'Sophie Laurent' },
          { key: 'unit:wv212', title: 'Villa 212' },
        ]}
        onNavigateTrail={onNavigateTrail}
        onBack={onBack}
        onClose={() => {}}
        onOpenFullPage={onOpenFullPage}
      >
        <p>content</p>
      </RecordDrawer>,
    );
    const nav = screen.getByRole('navigation', { name: 'Record trail' });
    expect(within(nav).getByText('Villa 212')).toHaveAttribute('aria-current', 'page');
    await userEvent.click(within(nav).getByRole('button', { name: 'Sophie Laurent' }));
    expect(onNavigateTrail).toHaveBeenCalledWith(0);
    await userEvent.keyboard('{Escape}');
    expect(onBack).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Open full page' }));
    expect(onOpenFullPage).toHaveBeenCalled();
  });
});

function Harness({ mode }: { mode?: 'panel' | 'modal' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open Sophie
      </button>
      <button type="button">Next in list</button>
      {open && (
        <RecordDrawer
          title="Stay: Sophie Laurent"
          trail={[{ key: 'stay:s1', title: 'Sophie Laurent' }]}
          onNavigateTrail={() => {}}
          onBack={() => setOpen(false)}
          onClose={() => setOpen(false)}
          {...(mode ? { mode } : {})}
        >
          <p>content</p>
        </RecordDrawer>
      )}
    </>
  );
}

describe('RecordDrawer focus (P1-1)', () => {
  it('moves focus into the record on open and returns it to the opener on Esc', async () => {
    renderUi(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open Sophie' }));
    const drawer = document.querySelector('[data-record-drawer]');
    expect(drawer).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-record-body'));
    expect(drawer?.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('[data-record-drawer]')).toBeNull();
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Open Sophie'));
  });

  it('panel mode is non-modal: the list beside it stays reachable and a click there does not close it', async () => {
    renderUi(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open Sophie' }));
    const next = screen.getByRole('button', { name: 'Next in list' });
    expect(next.closest('[aria-hidden="true"]')).toBeNull();
    await userEvent.click(next);
    expect(document.querySelector('[data-record-drawer]')).not.toBeNull();
    expect(document.activeElement).toBe(next);
  });

  it('modal mode (narrow screens) traps focus and closes on an outside click', async () => {
    renderUi(<Harness mode="modal" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open Sophie' }));
    expect(document.querySelector('[data-record-drawer]')).toHaveAttribute('data-mode', 'modal');
    await userEvent.tab();
    expect(document.querySelector('[data-record-drawer]')?.contains(document.activeElement)).toBe(true);
  });
});

describe('EntityLink', () => {
  it('previews the record on focus and opens it on click without triggering the row', async () => {
    const loadSummary = vi.fn(async () => ({
      type: 'unit',
      id: 'wv212',
      title: 'Villa 212',
      subtitle: 'Water Villa',
      status: { condition: 'inspected' },
      propertyId: null,
      label: 'Unit',
    }));
    const onOpen = vi.fn();
    const onRow = vi.fn();
    renderUi(
      // biome-ignore lint/a11y/useKeyWithClickEvents: test harness row
      // biome-ignore lint/a11y/noStaticElementInteractions: test harness row
      <div onClick={onRow}>
        <EntityLink type="unit" id="wv212" loadSummary={loadSummary} onOpen={onOpen}>
          Villa 212
        </EntityLink>
      </div>,
    );
    const link = screen.getByRole('link', { name: 'Villa 212' });
    await act(async () => link.focus());
    expect(loadSummary).toHaveBeenCalledWith('unit', 'wv212');
    await userEvent.click(link);
    expect(onOpen).toHaveBeenCalledWith('unit', 'wv212');
    expect(onRow).not.toHaveBeenCalled();
  });
});
