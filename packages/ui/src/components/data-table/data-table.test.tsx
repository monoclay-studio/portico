import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations, formatViolations } from '../../test/axe';
import { renderUi } from '../../test/render';
import { DataTable, type DataTableHandle } from './data-table';
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

  it('selects with x, Shift+x and Shift+click; the bulk bar acts on exactly the selected rows', () => {
    const bulk = vi.fn();
    renderUi(
      <DataTable
        label="Units"
        columns={columns}
        rows={make(10)}
        getRowId={(u) => u.id}
        selectable
        bulkActions={(sel, clear) => (
          <button
            type="button"
            onClick={() => {
              bulk(sel.map((u) => u.id));
              clear();
            }}
          >
            Export selected
          </button>
        )}
      />,
    );
    const grid = screen.getByRole('grid');
    expect(grid).toHaveAttribute('aria-multiselectable', 'true');
    expect(screen.queryByRole('region', { name: 'Actions for selected rows' })).toBeNull();
    const first = grid.querySelector('[data-cell="0:0"]') as HTMLElement;
    act(() => first.focus());
    fireEvent.keyDown(first, { key: 'x' });
    fireEvent.keyDown(document.activeElement as Element, { key: 'j' });
    fireEvent.keyDown(document.activeElement as Element, { key: 'j' });
    expect(document.activeElement).toHaveAttribute('data-cell', '2:0');
    fireEvent.keyDown(document.activeElement as Element, { key: 'x', shiftKey: true });
    const bar = screen.getByRole('region', { name: 'Actions for selected rows' });
    expect(bar).toHaveTextContent('3 selected');
    expect(grid.querySelector('[data-row-id="u1"]')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(grid.querySelector('[data-row-id="u5"]') as Element, { shiftKey: true });
    expect(bar).toHaveTextContent('6 selected');
    fireEvent.click(within(bar).getByRole('button', { name: 'Export selected' }));
    expect(bulk).toHaveBeenCalledWith(['u0', 'u1', 'u2', 'u3', 'u4', 'u5']);
    expect(screen.queryByRole('region', { name: 'Actions for selected rows' })).toBeNull();
  });

  it('select-all selects only the rows shown by the current filter', async () => {
    renderUi(<DataTable label="Units" columns={columns} rows={make(9)} getRowId={(u) => u.id} selectable />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter rows' }), 'Sunset');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all shown rows' }));
    expect(screen.getByRole('region', { name: 'Actions for selected rows' })).toHaveTextContent('3 selected');
  });

  it('e runs the row primary action; with a record open, j/k open the next row (one key, no clicks)', () => {
    const onRowPrimaryAction = vi.fn();
    const onRowActivate = vi.fn();
    renderUi(
      <DataTable
        label="Units"
        columns={columns}
        rows={make(5)}
        getRowId={(u) => u.id}
        onRowActivate={onRowActivate}
        onRowPrimaryAction={onRowPrimaryAction}
        openRowId="u0"
        followActive
      />,
    );
    const grid = screen.getByRole('grid');
    expect(grid.querySelector('[data-row-id="u0"]')).toHaveAttribute('aria-current', 'true');
    const first = grid.querySelector('[data-cell="0:0"]') as HTMLElement;
    act(() => first.focus());
    fireEvent.keyDown(first, { key: 'e' });
    expect(onRowPrimaryAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'u0' }));
    fireEvent.keyDown(document.activeElement as Element, { key: 'j' });
    expect(onRowActivate).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'u1' }));
    // Modified keys are left to the browser / app (Ctrl+J etc.).
    fireEvent.keyDown(document.activeElement as Element, { key: 'j', ctrlKey: true });
    expect(onRowActivate).toHaveBeenCalledTimes(1);
  });

  it('can be driven from outside (the open record panel) through its handle', () => {
    const onRowActivate = vi.fn();
    const handle = createRef<DataTableHandle>();
    renderUi(
      <DataTable
        label="Units"
        columns={columns}
        rows={make(5)}
        getRowId={(u) => u.id}
        onRowActivate={onRowActivate}
        openRowId="u0"
        followActive
        handleRef={handle}
      />,
    );
    act(() => handle.current?.move(1));
    expect(onRowActivate).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'u1' }));
    act(() => handle.current?.setFilter('type', 'Water Villa'));
    expect(screen.getByText('2 of 5 rows')).toBeInTheDocument();
    act(() => handle.current?.clearFilters());
    expect(screen.getByText('5 of 5 rows')).toBeInTheDocument();
  });

  it('has no axe violations with selection and a selected row', async () => {
    const { container } = renderUi(
      <DataTable
        label="Units"
        columns={columns}
        rows={make(4)}
        getRowId={(u) => u.id}
        selectable
        bulkActions={() => <button type="button">Export</button>}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Villa 0001' }));
    const v = await axeViolations(container);
    expect(v, formatViolations(v)).toEqual([]);
  });
});
