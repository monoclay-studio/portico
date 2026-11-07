import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations, formatViolations } from '../test/axe';
import { renderUi } from '../test/render';
import { FilterChips } from './filter-chips';
import { KpiTile } from './kpi-tile';
import { SegmentedBar } from './segmented-bar';
import { SmallMultiples } from './small-multiples';

describe('KpiTile', () => {
  it('shows value, the counts behind it, a named comparison, a definition and drills in', async () => {
    const onOpen = vi.fn();
    const { container } = renderUi(
      <KpiTile
        label="Occupancy tonight"
        value="80%"
        ratio={0.8}
        counts={{ numerator: 96, denominator: 120, unit: 'villas' }}
        delta={{ label: '+4 pts', direction: 'up', goodWhen: 'up', period: 'same night last week' }}
        definition="Units with a stay covering tonight ÷ sellable units."
        onOpen={onOpen}
      />,
    );
    expect(screen.getByText('96 of 120 villas')).toBeInTheDocument();
    expect(screen.getAllByText(/same night last week/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'About Occupancy tonight' }));
    expect(await screen.findByText(/sellable units/)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    // Accessible name = metric + the visible content (label in name, WCAG 2.5.3).
    await userEvent.click(
      screen.getByRole('button', { name: /^Occupancy tonight:\s?80%.*96 of 120 villas/ }),
    );
    expect(onOpen).toHaveBeenCalled();
    const v = await axeViolations(container);
    expect(v, formatViolations(v)).toEqual([]);
  });

  it('colours a delta by whether the direction is good, and says so in text', () => {
    renderUi(
      <KpiTile
        label="Open exceptions"
        value="8"
        definition="Unresolved exceptions"
        delta={{ label: '+3', direction: 'up', goodWhen: 'down', period: 'yesterday' }}
      />,
    );
    const delta = screen.getByText('+3');
    expect(delta.className).toContain('text-danger-fg');
    expect(delta).toHaveTextContent('up +3 vs yesterday');
  });
});

describe('SegmentedBar', () => {
  it('names every part with amount and share and drills in', async () => {
    const onSelect = vi.fn();
    const { container } = renderUi(
      <SegmentedBar
        label="Arrival readiness"
        unit="arrivals"
        onSelect={onSelect}
        segments={[
          { id: 'ready', label: 'Ready', value: 9, kind: 'good' },
          { id: 'blocked', label: 'Blocked', value: 3, kind: 'critical' },
          { id: 'none', label: 'Unknown', value: 0, kind: 'neutral' },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Blocked: 3 of 12 arrivals (25%)' }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'blocked' }));
    // zero parts draw nothing but stay in the legend
    expect(screen.queryByRole('button', { name: /Unknown/ })).toBeNull();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    const v = await axeViolations(container);
    expect(v, formatViolations(v)).toEqual([]);
  });
});

describe('SmallMultiples', () => {
  const series = [
    {
      id: 'wv',
      label: 'Water Villa',
      points: [
        { x: '7', xLabel: '7 Nov', value: 0.9 },
        { x: '8', xLabel: '8 Nov', value: 0.5 },
      ],
    },
    {
      id: 'bv',
      label: 'Beach Villa',
      points: [
        { x: '7', xLabel: '7 Nov', value: 0.4 },
        { x: '8', xLabel: '8 Nov', value: 0.6 },
      ],
    },
  ];
  const format = (v: number) => `${Math.round(v * 100)}%`;
  it('reads each column with the keyboard', async () => {
    renderUi(<SmallMultiples label="Occupancy" series={series} max={1} format={format} />);
    const group = screen.getByRole('group', { name: 'Water Villa' });
    await userEvent.click(group);
    group.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('8 Nov · 50%')).toBeInTheDocument();
  });
  it('offers a table view with every value', () => {
    renderUi(<SmallMultiples label="Occupancy" series={series} max={1} format={format} showTable />);
    expect(screen.getByRole('table', { name: 'Occupancy' })).toHaveTextContent('Beach Villa40%60%');
  });
});

describe('FilterChips', () => {
  it('removes filters one by one and shows the saved view', async () => {
    const onRemove = vi.fn();
    renderUi(
      <FilterChips
        viewName="Blocked first"
        modified
        chips={[{ id: 'r', label: 'Readiness: Not ready', onRemove }]}
      />,
    );
    expect(screen.getByText('Blocked first')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter Readiness: Not ready' }));
    expect(onRemove).toHaveBeenCalled();
  });
});
