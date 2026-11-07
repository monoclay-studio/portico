import type { ReactNode } from 'react';

/**
 * Pure table model: filtering, sorting, column visibility and saved views. No React state here so it can be
 * unit-tested exhaustively and reused by server-backed tables later.
 */
export type CellValue = string | number | boolean | null | undefined;

export interface ColumnDef<Row> {
  id: string;
  header: string;
  /** Value used for sorting, filtering and as default cell text. */
  accessor: (row: Row) => CellValue;
  /** Custom cell renderer (badges, links). Defaults to the accessor value. */
  cell?: (row: Row) => ReactNode;
  sortable?: boolean;
  /** Filter control in the toolbar: free text (contains) or a select of distinct values. */
  filter?: 'text' | 'select';
  /** Labels for select filter values (defaults to the raw value). */
  filterOptions?: ReadonlyArray<{ value: string; label: string }>;
  /** CSS grid track, e.g. '10rem' or 'minmax(12rem, 2fr)'. */
  width?: string;
  align?: 'start' | 'end' | 'center';
  /** Can the user hide this column? (identity columns should not be hideable) */
  hideable?: boolean;
  /** Custom comparator on accessor values. */
  compare?: (a: CellValue, b: CellValue) => number;
  /** Extra text the quick filter matches (codes, flags, blocker messages) beyond the accessor value. */
  searchText?: (row: Row) => string;
  /**
   * 1 = essential … 5 = nice to have. When the table is too narrow, the lowest-priority columns are hidden first
   * (with a visible "n columns hidden" note) instead of scrolling sideways. Default 3; identity columns are never
   * auto-hidden.
   */
  priority?: number;
}

export type SortDirection = 'asc' | 'desc';

export interface TableViewState {
  sort: { columnId: string; direction: SortDirection } | null;
  /** Column filters by column id. Text = contains (case-insensitive); select = exact match. */
  filters: Record<string, string>;
  /** Global quick filter across visible columns. */
  search: string;
  hidden: string[];
}

export interface SavedView {
  id: string;
  name: string;
  state: TableViewState;
  /** Shipped by the product (cannot be deleted). */
  builtIn?: boolean;
}

export const EMPTY_VIEW_STATE: TableViewState = { sort: null, filters: {}, search: '', hidden: [] };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function compareValues(a: CellValue, b: CellValue): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1; // empties last regardless of direction handled by caller
  if (bEmpty) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

function textOf(v: CellValue): string {
  return v === null || v === undefined ? '' : String(v).toLowerCase();
}

export function applyView<Row>(
  rows: readonly Row[],
  columns: readonly ColumnDef<Row>[],
  state: TableViewState,
): Row[] {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const activeFilters = Object.entries(state.filters).filter(([id, v]) => v !== '' && byId.has(id));
  const search = state.search.trim().toLowerCase();
  const searchCols = columns.filter((c) => !state.hidden.includes(c.id));
  let out = rows.filter((row) => {
    for (const [id, value] of activeFilters) {
      const col = byId.get(id) as ColumnDef<Row>;
      const v = col.accessor(row);
      if (col.filter === 'select') {
        if (String(v ?? '') !== value) return false;
      } else if (!textOf(v).includes(value.toLowerCase())) return false;
    }
    if (search) {
      const words = search.split(/\s+/);
      const hay = searchCols
        .map((c) => `${textOf(c.accessor(row))} ${c.searchText ? c.searchText(row).toLowerCase() : ''}`)
        .join(' ');
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const sortCol = state.sort ? byId.get(state.sort.columnId) : undefined;
  if (state.sort && sortCol) {
    const dir = state.sort.direction === 'asc' ? 1 : -1;
    const cmp = sortCol.compare ?? compareValues;
    // Stable sort; empty values always last.
    out = out
      .map((row, i) => ({ row, i, v: sortCol.accessor(row) }))
      .sort((x, y) => {
        const xe = x.v === null || x.v === undefined || x.v === '';
        const ye = y.v === null || y.v === undefined || y.v === '';
        if (xe !== ye) return xe ? 1 : -1;
        return cmp(x.v, y.v) * dir || x.i - y.i;
      })
      .map((x) => x.row);
  }
  return out;
}

/** Cycle: none → asc → desc → none. */
export function nextSort(current: TableViewState['sort'], columnId: string): TableViewState['sort'] {
  if (!current || current.columnId !== columnId) return { columnId, direction: 'asc' };
  if (current.direction === 'asc') return { columnId, direction: 'desc' };
  return null;
}

export function visibleColumns<Row>(
  columns: readonly ColumnDef<Row>[],
  hidden: readonly string[],
): ColumnDef<Row>[] {
  return columns.filter((c) => c.hideable === false || !hidden.includes(c.id));
}

export function toggleHidden(hidden: readonly string[], columnId: string): string[] {
  return hidden.includes(columnId) ? hidden.filter((h) => h !== columnId) : [...hidden, columnId];
}

export function distinctValues<Row>(
  rows: readonly Row[],
  col: ColumnDef<Row>,
): Array<{ value: string; label: string }> {
  if (col.filterOptions) return [...col.filterOptions];
  const set = new Set<string>();
  for (const r of rows) {
    const v = col.accessor(r);
    if (v !== null && v !== undefined && v !== '') set.add(String(v));
  }
  return [...set].sort(collator.compare).map((value) => ({ value, label: value }));
}

export function sameViewState(a: TableViewState, b: TableViewState): boolean {
  const norm = (s: TableViewState) =>
    JSON.stringify({
      sort: s.sort,
      filters: Object.fromEntries(
        Object.entries(s.filters)
          .filter(([, v]) => v !== '')
          .sort(),
      ),
      search: s.search.trim(),
      hidden: [...s.hidden].sort(),
    });
  return norm(a) === norm(b);
}

/** Keyboard navigation within a grid of `rowCount` body rows (+ header row at -1) and `colCount` columns. */
export function moveCell(
  cell: { row: number; col: number },
  key: string,
  bounds: { rowCount: number; colCount: number; pageSize: number; rtl: boolean; ctrl: boolean },
): { row: number; col: number } | null {
  const { rowCount, colCount, pageSize, rtl, ctrl } = bounds;
  const clampRow = (r: number) => Math.max(-1, Math.min(rowCount - 1, r));
  const clampCol = (c: number) => Math.max(0, Math.min(colCount - 1, c));
  switch (key) {
    case 'ArrowDown':
      return { row: clampRow(cell.row + 1), col: cell.col };
    case 'ArrowUp':
      return { row: clampRow(cell.row - 1), col: cell.col };
    case 'ArrowRight':
      return { row: cell.row, col: clampCol(cell.col + (rtl ? -1 : 1)) };
    case 'ArrowLeft':
      return { row: cell.row, col: clampCol(cell.col + (rtl ? 1 : -1)) };
    case 'Home':
      return ctrl ? { row: rowCount > 0 ? 0 : -1, col: 0 } : { row: cell.row, col: 0 };
    case 'End':
      return ctrl ? { row: rowCount - 1, col: colCount - 1 } : { row: cell.row, col: colCount - 1 };
    case 'PageDown':
      return { row: clampRow(cell.row + pageSize), col: cell.col };
    case 'PageUp':
      return { row: clampRow(cell.row - pageSize), col: cell.col };
    default:
      return null;
  }
}

/** Approximate minimum width in px of a grid track ('10rem', 'minmax(12rem, 2fr)', '96px'). */
export function trackMinPx(width: string | undefined, remPx = 16): number {
  const w = width ?? 'minmax(8rem, 1fr)';
  const m = /^minmax\(\s*([\d.]+)(rem|px)/.exec(w) ?? /^([\d.]+)(rem|px)/.exec(w);
  if (!m) return 8 * remPx;
  const n = Number(m[1]);
  return m[2] === 'rem' ? n * remPx : n;
}

/**
 * Which columns fit in `available` px: hide the lowest-priority hideable columns first (stable for equal
 * priority: later columns go first). Returns the ids to hide automatically.
 */
export function autoHiddenColumns<Row>(
  columns: readonly ColumnDef<Row>[],
  available: number,
  reservedPx = 0,
): string[] {
  let total = reservedPx + columns.reduce((n, c) => n + trackMinPx(c.width), 0);
  if (total <= available) return [];
  const candidates = columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.hideable !== false)
    .sort((a, b) => (b.c.priority ?? 3) - (a.c.priority ?? 3) || b.i - a.i);
  const hidden: string[] = [];
  for (const { c } of candidates) {
    if (total <= available) break;
    if ((c.priority ?? 3) <= 1) break;
    hidden.push(c.id);
    total -= trackMinPx(c.width);
  }
  return hidden;
}
