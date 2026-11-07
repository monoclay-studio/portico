import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, Check, Columns3, Search, Trash2, X } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import {
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '../../lib/cn';
import { useUi } from '../../provider';
import { fmt } from '../../strings';
import { Button } from '../button';
import { type FilterChip, FilterChips } from '../filter-chips';
import { Input } from '../input';
import { Select } from '../select';
import {
  applyView,
  autoHiddenColumns,
  type ColumnDef,
  distinctValues,
  EMPTY_VIEW_STATE,
  moveCell,
  nextSort,
  type SavedView,
  sameViewState,
  type TableViewState,
  toggleHidden,
  visibleColumns,
} from './model';

/** Inside a grid cell, links and buttons are not separate tab stops (APG grid: one tab stop, Enter acts). */
export const GridCellContext = createContext(false);

export interface DataTableHandle {
  /** Move the active row by `delta` (j/k from outside the table, e.g. while a record panel has focus). */
  move(delta: number): void;
  /** Apply a column filter (e.g. from a stat tile); '' clears it. */
  setFilter(columnId: string, value: string): void;
  clearFilters(): void;
  focus(): void;
}

export interface DataTableProps<Row> {
  /** Accessible name of the grid (e.g. "Arrivals for Sat 7 Nov"). */
  label: string;
  columns: readonly ColumnDef<Row>[];
  rows: readonly Row[];
  getRowId: (row: Row) => string;
  /** Enter / click on a row: open it. */
  onRowActivate?: (row: Row) => void;
  /** `e` on a row: its primary action (ux-principles §7). */
  onRowPrimaryAction?: (row: Row) => void;
  /** Saved views: built-in + the user's own (persist them with onSaveView/onDeleteView). */
  views?: readonly SavedView[];
  initialViewId?: string;
  onSaveView?: (view: SavedView) => void;
  onDeleteView?: (id: string) => void;
  onStateChange?: (state: TableViewState) => void;
  /** Row height in px (fixed: required for virtualization). Defaults from density and `rowLines`. */
  rowHeight?: number;
  /** One-, two- or three-line rows; with density this picks the row height. */
  rowLines?: 1 | 2 | 3;
  /** Max height of the scrolling body (CSS length). */
  maxHeight?: string;
  /** Rendered when no rows match. */
  empty?: ReactNode;
  /** Extra toolbar content (actions). */
  toolbar?: ReactNode;
  /** Optional visual emphasis for rows (e.g. a blocker). Do not rely on it alone — include text in a cell. */
  rowClassName?: (row: Row) => string | undefined;
  /** The row whose record is open (aria-current). */
  openRowId?: string | null;
  /** When a record is open and the active row moves (j/k), open the new row too. */
  followActive?: boolean;
  /** Enables the selection column (checkbox, x / Space, Shift+click range, select all filtered). */
  selectable?: boolean;
  /** Bulk-action bar content for the selected rows (open a preview from here — never act silently). */
  bulkActions?: (selected: Row[], clear: () => void) => ReactNode;
  /** Stable help anchor for this table (`<module>.<screen>.<element>`). */
  helpKey?: string;
  handleRef?: Ref<DataTableHandle>;
}

const SELECT_COL_PX = 40;

/**
 * Data table for operational lists: sorting, column filters, quick search, column visibility, saved views,
 * selection with bulk actions, full keyboard navigation (WAI-ARIA grid; j/k, x, e, Enter) and row
 * virtualization for thousands of rows. Low-priority columns hide (visibly) before the table scrolls sideways.
 */
export function DataTable<Row>({
  label,
  columns,
  rows,
  getRowId,
  onRowActivate,
  onRowPrimaryAction,
  views = [],
  initialViewId,
  onSaveView,
  onDeleteView,
  onStateChange,
  rowHeight: rowHeightProp,
  rowLines = 1,
  maxHeight = '70vh',
  empty,
  toolbar,
  rowClassName,
  openRowId,
  followActive,
  selectable,
  bulkActions,
  helpKey,
  handleRef,
}: DataTableProps<Row>) {
  const { strings, dir, density } = useUi();
  const s = strings.dataTable;
  const coarse = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  const roomy = density === 'comfortable' || coarse;
  const rowHeight = rowHeightProp ?? [roomy ? 48 : 40, roomy ? 60 : 52, roomy ? 76 : 68][rowLines - 1] ?? 40;
  const initialView = views.find((v) => v.id === initialViewId) ?? views[0];
  const [viewId, setViewId] = useState<string | null>(initialView?.id ?? null);
  const [state, setState] = useState<TableViewState>(initialView?.state ?? EMPTY_VIEW_STATE);
  const [active, setActive] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const [savingName, setSavingName] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [width, setWidth] = useState<number | null>(null);
  const focusPending = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const gridId = useId();

  useEffect(() => onStateChange?.(state), [state, onStateChange]);

  // Measure the available width to hide low-priority columns rather than scroll sideways.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const userVisible = useMemo(() => visibleColumns(columns, state.hidden), [columns, state.hidden]);
  const autoHidden = useMemo(
    () => (width ? autoHiddenColumns(userVisible, width, selectable ? SELECT_COL_PX : 0) : []),
    [userVisible, width, selectable],
  );
  const cols = useMemo(
    () => userVisible.filter((c) => !autoHidden.includes(c.id)),
    [userVisible, autoHidden],
  );
  const shown = useMemo(() => applyView(rows, columns, state), [rows, columns, state]);
  const shownIds = useMemo(() => shown.map(getRowId), [shown, getRowId]);
  const currentView = views.find((v) => v.id === viewId);
  const modified = currentView
    ? !sameViewState(currentView.state, state)
    : !sameViewState(EMPTY_VIEW_STATE, state);
  const template = [
    selectable ? `${SELECT_COL_PX}px` : null,
    ...cols.map((c) => c.width ?? 'minmax(8rem, 1fr)'),
  ]
    .filter(Boolean)
    .join(' ');

  // Selection only ever contains rows that still exist.
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(rows.map(getRowId));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows, getRowId]);

  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    initialRect: { width: 1200, height: 600 },
  });

  useEffect(() => {
    setActive((a) => ({
      row: Math.min(a.row, Math.max(shown.length - 1, -1)),
      col: Math.min(a.col, Math.max(cols.length - 1, 0)),
    }));
  }, [shown.length, cols.length]);

  useLayoutEffect(() => {
    if (!focusPending.current) return;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${active.row}:${active.col}"]`);
    if (el) {
      el.focus({ preventScroll: active.row === -1 });
      focusPending.current = false;
    }
  });

  const update = useCallback((patch: Partial<TableViewState>) => setState((st) => ({ ...st, ...patch })), []);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectRange = (from: number, to: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
        const id = shownIds[i];
        if (id) next.add(id);
      }
      return next;
    });
  const clearSelection = () => setSelected(new Set());

  const goToRow = useCallback(
    (row: number, opts: { focus: boolean; activate: boolean }) => {
      const r = Math.max(0, Math.min(shown.length - 1, row));
      if (shown.length === 0) return;
      focusPending.current = opts.focus;
      setActive((a) => ({ row: r, col: a.row === -1 ? 0 : a.col }));
      virtualizer.scrollToIndex(r, { align: 'auto' });
      const target = shown[r];
      if (opts.activate && target && onRowActivate) onRowActivate(target);
    },
    [shown, virtualizer, onRowActivate],
  );

  useImperativeHandle(
    handleRef,
    () => ({
      move(delta) {
        const inGrid = Boolean(gridRef.current?.contains(document.activeElement));
        goToRow(Math.max(0, active.row) + delta, {
          focus: inGrid,
          activate: Boolean(followActive && openRowId),
        });
      },
      setFilter(columnId, value) {
        update({ filters: { ...state.filters, [columnId]: value } });
      },
      clearFilters() {
        update({ search: '', filters: {} });
      },
      focus() {
        focusPending.current = true;
        setActive((a) => ({ ...a }));
      },
    }),
    [goToRow, active.row, followActive, openRowId, update, state.filters],
  );

  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('input,select,textarea')) return;
    const pageSize = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / rowHeight) - 1);
    const key = e.key === 'j' ? 'ArrowDown' : e.key === 'k' ? 'ArrowUp' : e.key;
    if ((e.key === 'j' || e.key === 'k') && (e.ctrlKey || e.metaKey || e.altKey)) return;
    const next = moveCell(active, key, {
      rowCount: shown.length,
      colCount: cols.length,
      pageSize,
      rtl: dir === 'rtl',
      ctrl: e.ctrlKey || e.metaKey,
    });
    if (next) {
      e.preventDefault();
      focusPending.current = true;
      setActive(next);
      if (next.row >= 0) {
        virtualizer.scrollToIndex(next.row, { align: 'auto' });
        // With a record open beside the list, j/k (and ↑/↓) show the next record: one key, no clicks.
        const moved = shown[next.row];
        if (followActive && openRowId && moved && next.row !== active.row && onRowActivate)
          onRowActivate(moved);
      }
      return;
    }
    const row = active.row >= 0 ? shown[active.row] : undefined;
    if (active.row === -1 && (e.key === 'Enter' || e.key === ' ')) {
      const col = cols[active.col];
      if (col && col.sortable !== false) {
        e.preventDefault();
        update({ sort: nextSort(state.sort, col.id) });
      }
      return;
    }
    if (!row) return;
    if (e.key === 'Enter' && onRowActivate) {
      e.preventDefault();
      onRowActivate(row);
    } else if ((e.key === 'x' || e.key === ' ') && selectable) {
      e.preventDefault();
      if (e.shiftKey && anchor !== null) selectRange(anchor, active.row);
      else toggle(getRowId(row));
      setAnchor(active.row);
    } else if (e.key === 'e' && onRowPrimaryAction && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      onRowPrimaryAction(row);
    }
  };

  const virtualItems = virtualizer.getVirtualItems();
  // If the active row is scrolled out of the rendered window, keep the grid reachable with Tab via the header.
  const activeRendered = active.row === -1 || virtualItems.some((vi) => vi.index === active.row);

  const selectFilters = columns.filter((c) => c.filter === 'select');
  const textFilters = columns.filter((c) => c.filter === 'text');
  const anyFilter = state.search !== '' || Object.values(state.filters).some((v) => v !== '');
  const chips: FilterChip[] = [
    ...(state.search.trim()
      ? [{ id: 'search', label: `“${state.search.trim()}”`, onRemove: () => update({ search: '' }) }]
      : []),
    ...Object.entries(state.filters)
      .filter(([, v]) => v !== '')
      .map(([id, v]) => {
        const col = columns.find((c) => c.id === id);
        const label = col ? (distinctValues(rows, col).find((o) => o.value === v)?.label ?? v) : v;
        return {
          id,
          label: `${col?.header ?? id}: ${label}`,
          onRemove: () => update({ filters: { ...state.filters, [id]: '' } }),
        };
      }),
  ];
  const selectedRows = shown.filter((r) => selected.has(getRowId(r)));
  const allShownSelected = shown.length > 0 && selectedRows.length === shown.length;

  const onRowClick = (e: MouseEvent, row: Row, index: number) => {
    if (selectable && e.shiftKey && anchor !== null) {
      e.preventDefault();
      selectRange(anchor, index);
      setAnchor(index);
      return;
    }
    setActive((a) => ({ row: index, col: a.col }));
    onRowActivate?.(row);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2" data-help-key={helpKey}>
      <div
        className="flex flex-wrap items-end gap-2"
        role="toolbar"
        aria-label={`${label} — ${s.filterRows}`}
      >
        <div className="relative w-full sm:w-64">
          <Search
            aria-hidden
            className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle"
          />
          <Input
            type="search"
            aria-label={s.filterRows}
            aria-controls={gridId}
            placeholder={s.filterPlaceholder}
            value={state.search}
            onChange={(e) => update({ search: e.target.value })}
            className="ps-8"
          />
        </div>
        {selectFilters.map((c) => (
          <div key={c.id} className="w-full sm:w-44">
            <Select
              aria-label={fmt(s.filterColumn, { column: c.header })}
              value={state.filters[c.id] || '__all'}
              onValueChange={(v) => update({ filters: { ...state.filters, [c.id]: v === '__all' ? '' : v } })}
              options={[
                { value: '__all', label: `${c.header}: ${s.all}`, textValue: s.all },
                ...distinctValues(rows, c).map((o) => ({
                  value: o.value,
                  label: `${c.header}: ${o.label}`,
                  textValue: o.label,
                })),
              ]}
            />
          </div>
        ))}
        {textFilters.map((c) => (
          <div key={c.id} className="w-full sm:w-40">
            <Input
              aria-label={fmt(s.filterColumn, { column: c.header })}
              placeholder={c.header}
              value={state.filters[c.id] ?? ''}
              onChange={(e) => update({ filters: { ...state.filters, [c.id]: e.target.value } })}
            />
          </div>
        ))}
        {anyFilter && (
          <Button variant="ghost" size="sm" icon={<X />} onClick={() => update({ search: '', filters: {} })}>
            {s.clearFilters}
          </Button>
        )}
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {toolbar}
          <DropdownMenu.Root open={columnsMenuOpen} onOpenChange={setColumnsMenuOpen}>
            <DropdownMenu.Trigger asChild>
              <Button size="sm" icon={<Columns3 />}>
                {s.columns}
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="z-50 min-w-48 rounded-md border border-line bg-surface p-1 shadow-lg"
              >
                {columns
                  .filter((c) => c.hideable !== false)
                  .map((c) => (
                    <DropdownMenu.CheckboxItem
                      key={c.id}
                      checked={!state.hidden.includes(c.id)}
                      onCheckedChange={() => update({ hidden: toggleHidden(state.hidden, c.id) })}
                      onSelect={(e) => e.preventDefault()}
                      className="relative flex min-h-control-sm cursor-default items-center rounded-sm ps-7 pe-2 text-sm outline-none data-highlighted:bg-accent-soft"
                    >
                      <DropdownMenu.ItemIndicator className="absolute start-2 inline-flex">
                        <Check aria-hidden className="size-4 text-accent" />
                      </DropdownMenu.ItemIndicator>
                      {c.header}
                      {autoHidden.includes(c.id) && (
                        <span className="ms-2 text-xs text-ink-muted">{s.hiddenToFit}</span>
                      )}
                    </DropdownMenu.CheckboxItem>
                  ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          {(views.length > 0 || onSaveView) && (
            <DropdownMenu.Root onOpenChange={(o) => !o && setSavingName(null)}>
              <DropdownMenu.Trigger asChild>
                <Button size="sm" icon={<Bookmark />}>
                  {s.views}: {currentView?.name ?? s.defaultView}
                  {modified ? ' *' : ''}
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={4}
                  className="z-50 min-w-60 rounded-md border border-line bg-surface p-1 shadow-lg"
                >
                  <DropdownMenu.RadioGroup
                    value={viewId ?? ''}
                    onValueChange={(id) => {
                      const v = views.find((x) => x.id === id);
                      if (v) {
                        setViewId(v.id);
                        setState(v.state);
                      }
                    }}
                  >
                    {views.map((v) => (
                      <div key={v.id} className="flex items-center">
                        <DropdownMenu.RadioItem
                          value={v.id}
                          className="relative flex min-h-control-sm flex-1 cursor-default items-center rounded-sm ps-7 pe-2 text-sm outline-none data-highlighted:bg-accent-soft"
                        >
                          <DropdownMenu.ItemIndicator className="absolute start-2 inline-flex">
                            <Check aria-hidden className="size-4 text-accent" />
                          </DropdownMenu.ItemIndicator>
                          {v.name}
                        </DropdownMenu.RadioItem>
                        {!v.builtIn && onDeleteView && (
                          <DropdownMenu.Item
                            aria-label={fmt(s.deleteView, { name: v.name })}
                            onSelect={() => {
                              onDeleteView(v.id);
                              if (viewId === v.id) setViewId(null);
                            }}
                            className="inline-flex size-control-sm items-center justify-center rounded-sm text-ink-muted outline-none data-highlighted:bg-danger-bg data-highlighted:text-danger-fg"
                          >
                            <Trash2 aria-hidden className="size-4" />
                          </DropdownMenu.Item>
                        )}
                      </div>
                    ))}
                  </DropdownMenu.RadioGroup>
                  {onSaveView && (
                    <>
                      <DropdownMenu.Separator className="my-1 h-px bg-line" />
                      {savingName === null ? (
                        <DropdownMenu.Item
                          onSelect={(e) => {
                            e.preventDefault();
                            setSavingName('');
                          }}
                          className="flex min-h-control-sm cursor-default items-center rounded-sm px-2 text-sm outline-none data-highlighted:bg-accent-soft"
                        >
                          {s.saveView}…
                        </DropdownMenu.Item>
                      ) : (
                        <form
                          className="flex gap-1 p-1"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const name = savingName.trim();
                            if (!name) return;
                            const view: SavedView = { id: `view-${Date.now()}`, name, state };
                            onSaveView(view);
                            setViewId(view.id);
                            setSavingName(null);
                          }}
                        >
                          <Input
                            autoFocus
                            aria-label={s.viewName}
                            placeholder={s.viewName}
                            value={savingName}
                            onChange={(e) => setSavingName(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                          />
                          <Button type="submit" size="sm" variant="primary">
                            {s.save}
                          </Button>
                        </form>
                      )}
                    </>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <FilterChips
          chips={chips}
          viewName={currentView?.name}
          modified={modified}
          onClearAll={() => update({ search: '', filters: {} })}
        />
        {autoHidden.length > 0 && (
          <button
            type="button"
            data-hidden-columns={autoHidden.length}
            onClick={() => setColumnsMenuOpen(true)}
            className="min-h-7 rounded-full border border-dashed border-line-strong px-2.5 text-xs text-ink-muted hover:text-ink"
          >
            {fmt(autoHidden.length === 1 ? s.hiddenColumnsOne : s.hiddenColumns, {
              count: autoHidden.length,
            })}
          </button>
        )}
      </div>
      {selectable && selectedRows.length > 0 && (
        <section
          aria-label={s.bulkActions}
          data-bulk-bar
          className="flex flex-wrap items-center gap-2 rounded-md border border-accent-line bg-accent-soft px-3 py-2 text-sm"
        >
          <span className="pt-data text-ink" aria-live="polite">
            {fmt(s.selectedCount, { count: selectedRows.length })}
          </span>
          {bulkActions?.(selectedRows, clearSelection)}
          <Button size="sm" variant="ghost" icon={<X />} className="ms-auto" onClick={clearSelection}>
            {s.clearSelection}
          </Button>
        </section>
      )}

      <p className="pt-sr-only" id={`${gridId}-hint`}>
        {selectable ? s.keyboardHintSelectable : s.keyboardHint}
      </p>
      <div
        ref={gridRef}
        id={gridId}
        role="grid"
        aria-label={label}
        aria-describedby={`${gridId}-hint`}
        aria-rowcount={shown.length + 1}
        aria-colcount={cols.length + (selectable ? 1 : 0)}
        aria-multiselectable={selectable || undefined}
        onKeyDown={onGridKeyDown}
        className="min-w-0 overflow-hidden rounded-md border border-line bg-surface"
      >
        <div ref={scrollRef} data-scroller className="overflow-auto" style={{ maxHeight }}>
          <div role="rowgroup" className="sticky top-0 z-10">
            <div
              role="row"
              aria-rowindex={1}
              className="grid min-w-full border-b border-line bg-surface-muted"
              style={{ gridTemplateColumns: template }}
            >
              {selectable && (
                <div
                  role="columnheader"
                  className="sticky start-0 z-[1] flex items-center justify-center bg-surface-muted"
                >
                  <input
                    type="checkbox"
                    aria-label={s.selectAll}
                    className="size-4 accent-[var(--pt-accent)]"
                    checked={allShownSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selectedRows.length > 0 && !allShownSelected;
                    }}
                    onChange={() => (allShownSelected ? clearSelection() : setSelected(new Set(shownIds)))}
                  />
                </div>
              )}
              {cols.map((c, ci) => {
                const sorted = state.sort?.columnId === c.id ? state.sort.direction : null;
                const sortable = c.sortable !== false;
                const isActive = (active.row === -1 || !activeRendered) && active.col === ci;
                return (
                  <div
                    key={c.id}
                    role="columnheader"
                    aria-colindex={ci + 1 + (selectable ? 1 : 0)}
                    aria-sort={
                      sorted === 'asc'
                        ? 'ascending'
                        : sorted === 'desc'
                          ? 'descending'
                          : sortable
                            ? 'none'
                            : undefined
                    }
                    data-cell={`-1:${ci}`}
                    data-focus-inset
                    tabIndex={isActive ? 0 : -1}
                    onFocus={() => setActive({ row: -1, col: ci })}
                    onClick={() => sortable && update({ sort: nextSort(state.sort, c.id) })}
                    className={cn(
                      'flex items-center gap-1 px-3 py-2 text-xs font-semibold text-ink-muted select-none',
                      sortable && 'cursor-pointer hover:text-ink',
                      c.align === 'end' && 'justify-end text-end',
                      c.align === 'center' && 'justify-center',
                      ci === 0 && cn('sticky z-[1] bg-surface-muted', selectable ? 'start-10' : 'start-0'),
                    )}
                  >
                    <span className="truncate">{c.header}</span>
                    {sortable &&
                      (sorted === 'asc' ? (
                        <ArrowUp aria-hidden className="size-3.5 text-ink" />
                      ) : sorted === 'desc' ? (
                        <ArrowDown aria-hidden className="size-3.5 text-ink" />
                      ) : (
                        <ArrowUpDown aria-hidden className="size-3.5 opacity-40" />
                      ))}
                  </div>
                );
              })}
            </div>
          </div>
          <div role="rowgroup" className="relative min-w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualItems.map((vi) => {
              const row = shown[vi.index] as Row;
              const id = getRowId(row);
              const isSelected = selected.has(id);
              const isOpen = openRowId === id;
              return (
                <div
                  key={id}
                  role="row"
                  aria-rowindex={vi.index + 2}
                  aria-selected={selectable ? isSelected : undefined}
                  aria-current={isOpen ? 'true' : undefined}
                  data-row-id={id}
                  data-open={isOpen || undefined}
                  onClick={(e) => onRowClick(e, row, vi.index)}
                  className={cn(
                    'group absolute inset-x-0 grid min-w-full border-b border-line bg-surface',
                    onRowActivate && 'cursor-pointer hover:bg-surface-hover',
                    isSelected && 'bg-accent-soft',
                    isOpen && 'bg-accent-soft shadow-[inset_3px_0_0_var(--pt-accent)]',
                    rowClassName?.(row),
                  )}
                  style={{
                    gridTemplateColumns: template,
                    height: rowHeight,
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  {selectable && (
                    <div
                      role="gridcell"
                      className="sticky start-0 z-[1] flex items-center justify-center bg-inherit"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        tabIndex={-1}
                        aria-label={fmt(s.selectRow, { row: String(cols[0]?.accessor(row) ?? id) })}
                        className="size-4 accent-[var(--pt-accent)]"
                        checked={isSelected}
                        onChange={(e) => {
                          const native = e.nativeEvent as globalThis.MouseEvent;
                          if (native.shiftKey && anchor !== null) selectRange(anchor, vi.index);
                          else toggle(id);
                          setAnchor(vi.index);
                        }}
                      />
                    </div>
                  )}
                  {cols.map((c, ci) => {
                    const isActive = active.row === vi.index && active.col === ci;
                    return (
                      <div
                        key={c.id}
                        role="gridcell"
                        aria-colindex={ci + 1 + (selectable ? 1 : 0)}
                        data-cell={`${vi.index}:${ci}`}
                        data-focus-inset
                        tabIndex={isActive ? 0 : -1}
                        onFocus={() => setActive({ row: vi.index, col: ci })}
                        className={cn(
                          'flex min-w-0 items-center px-3 text-sm',
                          c.align === 'end' && 'justify-end text-end pt-tabular',
                          c.align === 'center' && 'justify-center',
                          ci === 0 && cn('sticky z-[1] bg-inherit', selectable ? 'start-10' : 'start-0'),
                        )}
                      >
                        <GridCellContext.Provider value={true}>
                          {c.cell ? (
                            c.cell(row)
                          ) : (
                            <span className="truncate">{String(c.accessor(row) ?? '—')}</span>
                          )}
                        </GridCellContext.Provider>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {shown.length === 0 && (
            <div className="p-4">{empty ?? <p className="text-sm text-ink-muted">{s.noRows}</p>}</div>
          )}
        </div>
      </div>
      <p className="text-xs text-ink-muted" aria-live="polite">
        {fmt(s.rowCount, { shown: shown.length, total: rows.length })}
      </p>
    </div>
  );
}
