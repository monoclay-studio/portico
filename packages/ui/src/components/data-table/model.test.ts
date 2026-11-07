import { describe, expect, it } from 'vitest';
import {
  applyView,
  type ColumnDef,
  EMPTY_VIEW_STATE,
  moveCell,
  nextSort,
  sameViewState,
  toggleHidden,
} from './model';

interface R {
  id: string;
  guest: string;
  villa: string | null;
  eta: number;
  status: string;
}
const rows: R[] = [
  { id: '1', guest: 'Sophie Laurent', villa: 'Water Villa 212', eta: 1055, status: 'ready' },
  { id: '2', guest: 'Wei Zhang', villa: null, eta: 930, status: 'blocked' },
  { id: '3', guest: 'Arjun Mehta', villa: 'Beach Villa 104', eta: 1530, status: 'ready' },
  { id: '4', guest: 'Elena Petrova', villa: 'Water Villa 210', eta: 1055, status: 'attention' },
];
const columns: ColumnDef<R>[] = [
  { id: 'guest', header: 'Guest', accessor: (r) => r.guest, hideable: false },
  { id: 'villa', header: 'Villa', accessor: (r) => r.villa, filter: 'text' },
  { id: 'eta', header: 'ETA', accessor: (r) => r.eta },
  { id: 'status', header: 'Readiness', accessor: (r) => r.status, filter: 'select' },
];

describe('table model', () => {
  it('sorts stably with empty values last in both directions', () => {
    const asc = applyView(rows, columns, {
      ...EMPTY_VIEW_STATE,
      sort: { columnId: 'villa', direction: 'asc' },
    });
    expect(asc.map((r) => r.id)).toEqual(['3', '4', '1', '2']);
    const desc = applyView(rows, columns, {
      ...EMPTY_VIEW_STATE,
      sort: { columnId: 'villa', direction: 'desc' },
    });
    expect(desc.map((r) => r.id)).toEqual(['1', '4', '3', '2']);
    const eta = applyView(rows, columns, {
      ...EMPTY_VIEW_STATE,
      sort: { columnId: 'eta', direction: 'asc' },
    });
    expect(eta.map((r) => r.id)).toEqual(['2', '1', '4', '3']); // 1 before 4: stable
  });

  it('combines select filters, text filters and multi-word quick search', () => {
    expect(
      applyView(rows, columns, { ...EMPTY_VIEW_STATE, filters: { status: 'ready' } }).map((r) => r.id),
    ).toEqual(['1', '3']);
    expect(
      applyView(rows, columns, { ...EMPTY_VIEW_STATE, filters: { villa: 'water' } }).map((r) => r.id),
    ).toEqual(['1', '4']);
    expect(applyView(rows, columns, { ...EMPTY_VIEW_STATE, search: 'villa elena' }).map((r) => r.id)).toEqual(
      ['4'],
    );
  });

  it('quick search ignores hidden columns', () => {
    expect(
      applyView(rows, columns, { ...EMPTY_VIEW_STATE, search: 'blocked', hidden: ['status'] }),
    ).toHaveLength(0);
  });

  it('cycles sort none → asc → desc → none and toggles visibility', () => {
    const a = nextSort(null, 'eta');
    const b = nextSort(a, 'eta');
    expect([a?.direction, b?.direction, nextSort(b, 'eta')]).toEqual(['asc', 'desc', null]);
    expect(nextSort(b, 'guest')).toEqual({ columnId: 'guest', direction: 'asc' });
    expect(toggleHidden(toggleHidden([], 'villa'), 'villa')).toEqual([]);
  });

  it('compares views ignoring empty filters and order', () => {
    expect(
      sameViewState(
        { ...EMPTY_VIEW_STATE, filters: { a: '' }, hidden: ['x', 'y'] },
        { ...EMPTY_VIEW_STATE, hidden: ['y', 'x'] },
      ),
    ).toBe(true);
  });

  it('moves the active cell within bounds, mirrored in RTL', () => {
    const b = { rowCount: 10, colCount: 4, pageSize: 5, rtl: false, ctrl: false };
    expect(moveCell({ row: 0, col: 0 }, 'ArrowUp', b)).toEqual({ row: -1, col: 0 }); // into the header
    expect(moveCell({ row: 9, col: 3 }, 'ArrowDown', b)).toEqual({ row: 9, col: 3 });
    expect(moveCell({ row: 2, col: 1 }, 'ArrowRight', b)).toEqual({ row: 2, col: 2 });
    expect(moveCell({ row: 2, col: 1 }, 'ArrowRight', { ...b, rtl: true })).toEqual({ row: 2, col: 0 });
    expect(moveCell({ row: 2, col: 1 }, 'PageDown', b)).toEqual({ row: 7, col: 1 });
    expect(moveCell({ row: 7, col: 2 }, 'End', { ...b, ctrl: true })).toEqual({ row: 9, col: 3 });
    expect(moveCell({ row: 2, col: 1 }, 'x', b)).toBeNull();
  });
});
