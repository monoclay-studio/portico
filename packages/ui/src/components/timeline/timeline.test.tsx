import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations, formatViolations } from '../../test/axe';
import { renderUi } from '../../test/render';
import { buildRows, itemsAt, placeItems, type TimelineItem, type TimelineUnit } from './layout';
import { Timeline } from './timeline';

const units: TimelineUnit[] = [
  { id: 'bv101', label: 'Beach Villa 101', group: 'Beach Villa' },
  { id: 'bv102', label: 'Beach Villa 102', group: 'Beach Villa' },
  { id: 'wv201', label: 'Water Villa 201', group: 'Water Villa' },
];
const items: TimelineItem[] = [
  {
    id: 's1',
    unitId: 'bv101',
    kind: 'stay',
    from: '2026-11-05',
    to: '2026-11-09',
    label: 'Laurent',
    stayStatus: 'in_house',
  },
  {
    id: 's2',
    unitId: 'bv101',
    kind: 'stay',
    from: '2026-11-09',
    to: '2026-11-12',
    label: 'Zhang',
    stayStatus: 'expected',
  },
  {
    id: 'b1',
    unitId: 'wv201',
    kind: 'block',
    from: '2026-11-07',
    to: '2026-11-08',
    label: 'AC repair',
    blockKind: 'out_of_order',
  },
  { id: 'h1', unitId: 'bv102', kind: 'hold', from: '2026-11-08', to: '2026-11-10', label: 'Quote Q-1182' },
  // Overlap on purpose (inventory conflict must stay visible).
  {
    id: 's3',
    unitId: 'bv102',
    kind: 'stay',
    from: '2026-11-09',
    to: '2026-11-11',
    label: 'Mehta',
    stayStatus: 'expected',
  },
];

describe('timeline layout', () => {
  it('places half-open night ranges and clips at the visible range', () => {
    const placed = placeItems(items, '2026-11-07', 7);
    const s1 = placed.find((p) => p.item.id === 's1');
    expect(s1).toMatchObject({ start: 0, span: 2, clippedStart: true, clippedEnd: false });
    const s2 = placed.find((p) => p.item.id === 's2');
    expect(s2).toMatchObject({ start: 2, span: 3, clippedStart: false, clippedEnd: false });
    expect(placeItems(items, '2026-11-20', 7)).toHaveLength(0);
  });

  it('back-to-back stays share a lane; overlapping items get separate lanes', () => {
    const placed = placeItems(items, '2026-11-07', 7);
    expect(placed.find((p) => p.item.id === 's2')?.lane).toBe(0);
    expect(placed.find((p) => p.item.id === 'h1')?.lane).toBe(0);
    expect(placed.find((p) => p.item.id === 's3')?.lane).toBe(1);
  });

  it('finds what occupies a night (departure day is not a night)', () => {
    expect(itemsAt(items, 'bv101', '2026-11-08').map((i) => i.id)).toEqual(['s1']);
    expect(itemsAt(items, 'bv101', '2026-11-09').map((i) => i.id)).toEqual(['s2']);
  });

  it('groups units under headings', () => {
    expect(buildRows(units).map((r) => r.type)).toEqual(['group', 'unit', 'unit', 'group', 'unit']);
  });
});

describe('Timeline', () => {
  const renderTimeline = (props: Partial<Parameters<typeof Timeline>[0]> = {}, dir: 'ltr' | 'rtl' = 'ltr') =>
    renderUi(
      <Timeline
        label="Reservations timeline"
        units={units}
        items={items}
        from="2026-11-07"
        days={7}
        today="2026-11-07"
        {...props}
      />,
      { dir },
    );

  it('announces each night with what occupies it', () => {
    renderTimeline();
    expect(
      screen.getByRole('gridcell', { name: /Beach Villa 101, Sat, Nov 7, 2026: Stay, Laurent, In house/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('gridcell', { name: /Water Villa 201, Sat, Nov 7, 2026: Block, AC repair/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('gridcell', { name: /Beach Villa 102, Sat, Nov 7, 2026: free/ }),
    ).toBeInTheDocument();
  });

  it('moves by night and unit with arrows and opens the item with Enter', () => {
    const onItemActivate = vi.fn();
    const onCellActivate = vi.fn();
    renderTimeline({ onItemActivate, onCellActivate });
    const start = document.querySelector('[data-cell="0:0"]') as HTMLElement;
    expect(start).toHaveAttribute('tabindex', '0');
    act(() => start.focus());
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
    expect(document.activeElement).toHaveAttribute('data-cell', '0:2');
    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' });
    expect(onItemActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 's2' }));
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' });
    expect(onCellActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 'bv102' }), '2026-11-07');
  });

  it('mirrors arrows in RTL', () => {
    renderTimeline({}, 'rtl');
    const start = document.querySelector('[data-cell="0:0"]') as HTMLElement;
    act(() => start.focus());
    fireEvent.keyDown(start, { key: 'ArrowLeft' });
    expect(document.activeElement).toHaveAttribute('data-cell', '0:1');
  });

  it('virtualizes hundreds of units', () => {
    const many: TimelineUnit[] = Array.from({ length: 400 }, (_, i) => ({
      id: `u${i}`,
      label: `Villa ${i + 1}`,
      group: i < 200 ? 'Beach Villa' : 'Water Villa',
    }));
    renderUi(<Timeline label="Big" units={many} items={[]} from="2026-11-07" days={14} />);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '401');
    expect(screen.getAllByRole('rowheader').length).toBeLessThan(60);
  });

  it('has no axe violations', async () => {
    const { container } = renderTimeline();
    const v = await axeViolations(container);
    expect(v, formatViolations(v)).toEqual([]);
  });
});
