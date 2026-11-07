import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, Check, Columns3, Search, Trash2, X } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '../../lib/cn';
import { useUi } from '../../provider';
import { fmt } from '../../strings';
import { Button } from '../button';
import { Input } from '../input';
import { Select } from '../select';
import {
  applyView,
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

export interface DataTableProps<Row> {
  /** Accessible name of the grid (e.g. "Arrivals for Sat 7 Nov"). */
  label: string;
  columns: readonly ColumnDef<Row>[];
  rows: readonly Row[];
  getRowId: (row: Row) => string;
  /** Enter / double-click / click on a row. */
  onRowActivate?: (row: Row) => void;
  /** Saved views: built-in + the user's own (persist them with onSaveView/onDeleteView). */
  views?: readonly SavedView[];
  initialViewId?: string;
  onSaveView?: (view: SavedView) => void;
  onDeleteView?: (id: string) => void;
  /** Row height in px (fixed: required for virtualization). Defaults from density and `rowLines`. */
  rowHeight?: number;
  /** One- or two-line rows; with density this picks the row height (compact 40/52, comfortable 48/60). */
  rowLines?: 1 | 2;
  /** Max height of the scrolling body (CSS length). */
  maxHeight?: string;
  /** Rendered when no rows match. */
  empty?: ReactNode;
  /** Extra toolbar content (provenance badge, actions). */
  toolbar?: ReactNode;
  /** Optional visual emphasis for rows (e.g. a blocker). Do not rely on it alone — include text in a cell. */
  rowClassName?: (row: Row) => string | undefined;
  selectedRowId?: string | null;
}

/**
 * Data table for operational lists: sorting, column filters, quick search, column visibility, saved views,
 * full keyboard navigation (WAI-ARIA grid) and row virtualization for thousands of rows.
 */
export function DataTable<Row>({
  label,
  columns,
  rows,
  getRowId,
  onRowActivate,
  views = [],
  initialViewId,
  onSaveView,
  onDeleteView,
  rowHeight: rowHeightProp,
  rowLines = 1,
  maxHeight = '70vh',
  empty,
  toolbar,
  rowClassName,
  selectedRowId,
}: DataTableProps<Row>) {
  const { strings, dir, density } = useUi();
  const s = strings.dataTable;
  const coarse = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  const rowHeight =
    rowHeightProp ?? (density === 'comfortable' || coarse ? (rowLines === 2 ? 60 : 48) : rowLines === 2 ? 52 : 40);
  const initialView = views.find((v) => v.id === initialViewId) ?? views[0];
  const [viewId, setViewId] = useState<string | null>(initialView?.id ?? null);
  const [state, setState] = useState<TableViewState>(initialView?.state ?? EMPTY_VIEW_STATE);
  const [active, setActive] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const [savingName, setSavingName] = useState<string | null>(null);
  const focusPending = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const gridId = useId();

  const cols = useMemo(() => visibleColumns(columns, state.hidden), [columns, state.hidden]);
  const shown = useMemo(() => applyView(rows, columns, state), [rows, columns, state]);
  const currentView = views.find((v) => v.id === viewId);
  const modified = currentView
    ? !sameViewState(currentView.state, state)
    : !sameViewState(EMPTY_VIEW_STATE, state);
  const template = cols.map((c) => c.width ?? 'minmax(8rem, 1fr)').join(' ');

  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    initialRect: { width: 1200, height: 600 },
  });

  // Keep the active cell within bounds when filters change.
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

  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('input,select,textarea')) return;
    const pageSize = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / rowHeight) - 1);
    const next = moveCell(active, e.key, {
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
      if (next.row >= 0) virtualizer.scrollToIndex(next.row, { align: 'auto' });
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (active.row === -1) {
        const col = cols[active.col];
        if (col && col.sortable !== false) {
          e.preventDefault();
          update({ sort: nextSort(state.sort, col.id) });
        }
      } else if (e.key === 'Enter' && onRowActivate) {
        const row = shown[active.row];
        if (row) {
          e.preventDefault();
          onRowActivate(row);
        }
      }
    }
  };

  const virtualItems = virtualizer.getVirtualItems();
  // If the active row is scrolled out of the rendered window, keep the grid reachable with Tab via the header.
  const activeRendered = active.row === -1 || virtualItems.some((vi) => vi.index === active.row);

  const selectFilters = columns.filter((c) => c.filter === 'select');
  const textFilters = columns.filter((c) => c.filter === 'text');
  const anyFilter = state.search !== '' || Object.values(state.filters).some((v) => v !== '');

  return (
    <div className="flex min-w-0 flex-col gap-2">
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
          <DropdownMenu.Root>
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

      <p className="pt-sr-only" id={`${gridId}-hint`}>
        {s.keyboardHint}
      </p>
      <div
        ref={gridRef}
        id={gridId}
        role="grid"
        aria-label={label}
        aria-describedby={`${gridId}-hint`}
        aria-rowcount={shown.length + 1}
        aria-colcount={cols.length}
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
              {cols.map((c, ci) => {
                const sorted = state.sort?.columnId === c.id ? state.sort.direction : null;
                const sortable = c.sortable !== false;
                const isActive = (active.row === -1 || !activeRendered) && active.col === ci;
                return (
                  <div
                    key={c.id}
                    role="columnheader"
                    aria-colindex={ci + 1}
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
              return (
                <div
                  key={id}
                  role="row"
                  aria-rowindex={vi.index + 2}
                  aria-selected={selectedRowId !== undefined ? selectedRowId === id : undefined}
                  data-row-id={id}
                  onClick={() => onRowActivate?.(row)}
                  className={cn(
                    'absolute inset-x-0 grid min-w-full border-b border-line',
                    onRowActivate && 'cursor-pointer hover:bg-surface-hover',
                    selectedRowId === id && 'bg-accent-soft',
                    rowClassName?.(row),
                  )}
                  style={{
                    gridTemplateColumns: template,
                    height: rowHeight,
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  {cols.map((c, ci) => {
                    const isActive = active.row === vi.index && active.col === ci;
                    return (
                      <div
                        key={c.id}
                        role="gridcell"
                        aria-colindex={ci + 1}
                        data-cell={`${vi.index}:${ci}`}
                        data-focus-inset
                        tabIndex={isActive ? 0 : -1}
                        onFocus={() => setActive({ row: vi.index, col: ci })}
                        className={cn(
                          'flex min-w-0 items-center px-3 text-sm',
                          c.align === 'end' && 'justify-end text-end pt-tabular',
                          c.align === 'center' && 'justify-center',
                        )}
                      >
                        {c.cell ? (
                          c.cell(row)
                        ) : (
                          <span className="truncate">{String(c.accessor(row) ?? '—')}</span>
                        )}
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
