import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
