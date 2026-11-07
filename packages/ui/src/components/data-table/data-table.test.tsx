import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations, formatViolations } from '../../test/axe';
import { renderUi } from '../../test/render';
import { DataTable } from './data-table';
import type { ColumnDef, SavedView } from './model';

interface Unit {
  id: string;
  name: string;
  type: string;
  floor: number;
}
const types = ['Beach Villa', 'Water Villa', 'Sunset Water Villa'];
const make = (n: number): Unit[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `u${i}`,
    name: `Villa ${String(i + 1).padStart(4, '0')}`,
    type: types[i % 3] as string,
    floor: i % 7,
  }));
const columns: ColumnDef<Unit>[] = [
  { id: 'name', header: 'Villa', accessor: (u) => u.name, hideable: false },
  { id: 'type', header: 'Type', accessor: (u) => u.type, filter: 'select' },
  { id: 'floor', header: 'Zone', accessor: (u) => u.floor, align: 'end' },
];
const views: SavedView[] = [
  {
    id: 'all',
    name: 'All villas',
    builtIn: true,
    state: { sort: null, filters: {}, search: '', hidden: [] },
  },
  {
    id: 'water',
    name: 'Water villas by zone',
    builtIn: true,
    state: {
      sort: { columnId: 'floor', direction: 'desc' },
      filters: { type: 'Water Villa' },
      search: '',
      hidden: ['type'],
    },
  },
];

describe('DataTable', () => {
  it('virtualizes thousands of rows while announcing the full row count', () => {
    renderUi(<DataTable label="Units" columns={columns} rows={make(5000)} getRowId={(u) => u.id} />);
    const grid = screen.getByRole('grid', { name: 'Units' });
    expect(grid).toHaveAttribute('aria-rowcount', '5001');
    const rendered = within(grid).getAllByRole('row').length - 1;
    expect(rendered).toBeGreaterThan(5);
    expect(rendered).toBeLessThan(80);
    expect(screen.getByText('5000 of 5000 rows')).toBeInTheDocument();
  });

  it('sorts from the column header and exposes aria-sort', async () => {
    renderUi(<DataTable label="Units" columns={columns} rows={make(20)} getRowId={(u) => u.id} />);
    const header = screen.getByRole('columnheader', { name: /Villa/ });
    expect(header).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(header);
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(header);
    expect(header).toHaveAttribute('aria-sort', 'descending');
    const firstCell = screen.getAllByRole('row')[1]?.querySelector('[role="gridcell"]');
    expect(firstCell).toHaveTextContent('Villa 0020');
  });

  it('filters with quick search and switches saved views (filters, sort and hidden columns)', async () => {
    renderUi(
      <DataTable label="Units" columns={columns} rows={make(30)} getRowId={(u) => u.id} views={views} />,
    );
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter rows' }), '0007');
    expect(screen.getByText('1 of 30 rows')).toBeInTheDocument();
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Filter rows' }));
    await userEvent.click(screen.getByRole('button', { name: /Views: All villas/ }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Water villas by zone' }));
    expect(screen.getByText('10 of 30 rows')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Type/ })).toBeNull();
    expect(screen.getByRole('columnheader', { name: /Zone/ })).toHaveAttribute('aria-sort', 'descending');
  });

  it('saves the current view through the callback', async () => {
    const onSaveView = vi.fn();
    renderUi(
      <DataTable
        label="Units"
        columns={columns}
        rows={make(10)}
        getRowId={(u) => u.id}
        views={views}
        onSaveView={onSaveView}
      />,
    );
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter rows' }), 'Villa 000');
    await userEvent.click(screen.getByRole('button', { name: /Views: All villas \*/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Save current view/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'View name' }), 'Single digits{Enter}');
    expect(onSaveView).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Single digits',
        state: expect.objectContaining({ search: 'Villa 000' }),
      }),
    );
  });

  it('hides columns from the column menu (identity columns stay)', async () => {
    renderUi(<DataTable label="Units" columns={columns} rows={make(5)} getRowId={(u) => u.id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Villa' })).toBeNull();
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Zone' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('columnheader', { name: /Zone/ })).toBeNull();
  });

  it('is keyboard operable: arrows move focus, Enter activates the row', async () => {
    const onRowActivate = vi.fn();
    renderUi(
      <DataTable
        label="Units"
        columns={columns}
        rows={make(10)}
        getRowId={(u) => u.id}
        onRowActivate={onRowActivate}
      />,
    );
    const grid = screen.getByRole('grid');
    const first = grid.querySelector('[data-cell="0:0"]') as HTMLElement;
    expect(first).toHaveAttribute('tabindex', '0');
    act(() => first.focus());
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
    expect(document.activeElement).toHaveAttribute('data-cell', '1:1');
    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' });
    expect(onRowActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }));
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
    expect(document.activeElement).toHaveAttribute('role', 'columnheader');
    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' });
    expect(document.activeElement).toHaveAttribute('aria-sort', 'ascending');
  });

  it('mirrors horizontal arrows in RTL', () => {
    renderUi(<DataTable label="Units" columns={columns} rows={make(3)} getRowId={(u) => u.id} />, {
      dir: 'rtl',
    });
    const first = screen.getByRole('grid').querySelector('[data-cell="0:0"]') as HTMLElement;
    act(() => first.focus());
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(document.activeElement).toHaveAttribute('data-cell', '0:1');
  });

  it('has no axe violations', async () => {
    const { container } = renderUi(
      <DataTable label="Units" columns={columns} rows={make(8)} getRowId={(u) => u.id} views={views} />,
    );
    const v = await axeViolations(container);
    expect(v, formatViolations(v)).toEqual([]);
  });
});
