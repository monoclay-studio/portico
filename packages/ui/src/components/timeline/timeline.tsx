import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronLeft, ChevronRight, Wrench } from 'lucide-react';
import { type KeyboardEvent, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { addDays, dateSeries, type LocalDate, toUtcDate } from '../../lib/dates';
import { formatLocalDate } from '../../lib/format';
import { useUi } from '../../provider';
import { fmt } from '../../strings';
import { Button } from '../button';
import {
  buildRows,
  itemsAt,
  type PlacedItem,
  placeItems,
  type TimelineItem,
  type TimelineUnit,
} from './layout';

export interface TimelineProps {
  label: string;
  units: readonly TimelineUnit[];
  items: readonly TimelineItem[];
  /** First night shown. */
  from: LocalDate;
  days?: number;
  /** Property business date (highlighted). */
  today?: LocalDate | undefined;
  onRangeChange?: (from: LocalDate) => void;
  onItemActivate?: (item: TimelineItem) => void;
  /** Enter on an empty night (e.g. start a walk-in booking). */
  onCellActivate?: (unit: TimelineUnit, date: LocalDate) => void;
  cellWidth?: number;
  rowHeight?: number;
  maxHeight?: string;
  /** Mark non-working days (configurable per property; not assumed). */
  isWeekend?: (date: LocalDate) => boolean;
  /** Labels for stay statuses/blocks used in announcements. */
  describeItem?: (item: TimelineItem) => string;
}

const LABEL_WIDTH = 168;
const GROUP_HEIGHT = 28;

function barClass(p: PlacedItem): string {
  const it = p.item;
  if (it.kind === 'block') {
    return 'pt-hatch [--pt-hatch-a:var(--pt-bar-block)] [--pt-hatch-b:var(--pt-bar-block-stripe)] border border-danger-line text-danger-fg';
  }
  if (it.kind === 'hold')
    return 'border-2 border-dashed border-[var(--pt-bar-hold-line)] bg-pending-bg text-pending-fg';
  switch (it.stayStatus) {
    case 'in_house':
      return 'bg-[var(--pt-bar-inhouse)] text-[var(--pt-bar-inhouse-fg)] border border-transparent';
    case 'departed':
      return 'bg-[var(--pt-bar-departed)] text-ink-muted border border-line';
    case 'no_show':
      return 'border border-danger-line bg-danger-bg text-danger-fg line-through';
    case 'waitlisted':
      return 'border border-dashed border-pending-line bg-surface text-pending-fg';
    default:
      return 'bg-[var(--pt-bar-expected)] text-ink border border-[var(--pt-bar-expected-line)] border-s-4';
  }
}

/**
 * Units × nights grid with bars for stays, unit blocks and holds. Rows are virtualized (hundreds of units),
 * overlapping items get separate lanes so conflicts stay visible, and the grid is fully keyboard operable:
 * arrows move by night/unit (mirrored in RTL), PageUp/PageDown move 10 units, Home/End jump to the range
 * ends, Enter opens what occupies the night (or starts something on an empty night).
 */
export function Timeline({
  label,
  units,
  items,
  from,
  days = 21,
  today,
  onRangeChange,
  onItemActivate,
  onCellActivate,
  cellWidth = 44,
  rowHeight = 36,
  maxHeight = '70vh',
  isWeekend,
  describeItem,
}: TimelineProps) {
  const { strings, locale, dir } = useUi();
  const s = strings.timeline;
  const dates = useMemo(() => dateSeries(from, days), [from, days]);
  const rows = useMemo(() => buildRows(units), [units]);
  const placed = useMemo(() => placeItems(items, from, days), [items, from, days]);
  const placedByUnit = useMemo(() => {
    const m = new Map<string, PlacedItem[]>();
    for (const p of placed) m.set(p.item.unitId, [...(m.get(p.item.unitId) ?? []), p]);
    return m;
  }, [placed]);
  const unitRowIndex = useMemo(() => {
    const m: number[] = [];
    rows.forEach((r, i) => {
      if (r.type === 'unit') m[r.unitIndex] = i;
    });
    return m;
  }, [rows]);
  const [active, setActive] = useState({ unit: 0, day: Math.max(0, today ? dates.indexOf(today) : 0) });
  const focusPending = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const hintId = useId();

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.type === 'group' ? GROUP_HEIGHT : rowHeight),
    overscan: 8,
    initialRect: { width: 1200, height: 600 },
  });

  useLayoutEffect(() => {
    if (!focusPending.current) return;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${active.unit}:${active.day}"]`);
    if (el) {
      el.focus({ preventScroll: false });
      focusPending.current = false;
    }
  });

  const describe = (it: TimelineItem) => {
    if (describeItem) return describeItem(it);
    const kind = s.kinds[it.kind];
    const st = it.stayStatus
      ? strings.status.stay[it.stayStatus]
      : it.blockKind
        ? it.blockKind.replace(/_/g, ' ')
        : '';
    return [kind, it.label, st, ...(it.flags ?? [])].filter(Boolean).join(', ');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const rtl = dir === 'rtl';
    let { unit, day } = active;
    switch (e.key) {
      case 'ArrowRight':
        day += rtl ? -1 : 1;
        break;
      case 'ArrowLeft':
        day += rtl ? 1 : -1;
        break;
      case 'ArrowDown':
        unit += 1;
        break;
      case 'ArrowUp':
        unit -= 1;
        break;
      case 'PageDown':
        unit += 10;
        break;
      case 'PageUp':
        unit -= 10;
        break;
      case 'Home':
        day = 0;
        if (e.ctrlKey || e.metaKey) unit = 0;
        break;
      case 'End':
        day = days - 1;
        if (e.ctrlKey || e.metaKey) unit = units.length - 1;
        break;
      case 'Enter':
      case ' ': {
        const u = units[active.unit];
        const d = dates[active.day];
        if (!u || !d) return;
        e.preventDefault();
        const hit = itemsAt(items, u.id, d);
        if (hit[0]) onItemActivate?.(hit[0]);
        else onCellActivate?.(u, d);
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    unit = Math.max(0, Math.min(units.length - 1, unit));
    day = Math.max(0, Math.min(days - 1, day));
    focusPending.current = true;
    setActive({ unit, day });
    const rowIndex = unitRowIndex[unit];
    if (rowIndex !== undefined) virtualizer.scrollToIndex(rowIndex, { align: 'auto' });
  };

  const width = LABEL_WIDTH + days * cellWidth;
  const virtualItems = virtualizer.getVirtualItems();
  const activeRendered = virtualItems.some((vi) => rows[vi.index]?.unitIndex === active.unit);
  // Keep the grid reachable with Tab when the active unit is scrolled out of the rendered window.
  const focusUnit = activeRendered
    ? active.unit
    : (virtualItems.map((v) => rows[v.index]).find((x) => x?.type === 'unit')?.unitIndex ?? 0);
  const fmtDay = (d: LocalDate) => ({
    dow: new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(toUtcDate(d)),
    num: new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' }).format(toUtcDate(d)),
    month: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(toUtcDate(d)),
  });

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {onRangeChange && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            icon={dir === 'rtl' ? <ChevronRight /> : <ChevronLeft />}
            onClick={() => onRangeChange(addDays(from, -7))}
          >
            {s.previous}
          </Button>
          {today && (
            <Button size="sm" variant="ghost" onClick={() => onRangeChange(addDays(today, -2))}>
              {s.today}
            </Button>
          )}
          <Button
            size="sm"
            icon={dir === 'rtl' ? <ChevronLeft /> : <ChevronRight />}
            onClick={() => onRangeChange(addDays(from, 7))}
          >
            {s.next}
          </Button>
          <span className="text-sm text-ink-muted">
            {formatLocalDate(from, locale, 'short')} –{' '}
            {formatLocalDate(addDays(from, days - 1), locale, 'medium')}
          </span>
        </div>
      )}
      <p id={hintId} className="pt-sr-only">
        {s.keyboardHint}
      </p>
      <div
        ref={gridRef}
        role="grid"
        aria-label={label}
        aria-describedby={hintId}
        aria-rowcount={units.length + 1}
        aria-colcount={days + 1}
        onKeyDown={onKeyDown}
        className="min-w-0 overflow-hidden rounded-md border border-line bg-surface"
      >
        <div ref={scrollRef} data-scroller className="overflow-auto" style={{ maxHeight }}>
          <div style={{ width }} className="relative">
            {/* Header */}
            <div
              role="row"
              aria-rowindex={1}
              className="sticky top-0 z-20 flex border-b border-line bg-surface-muted"
            >
              <div
                role="columnheader"
                className="sticky start-0 z-10 flex items-end border-e border-line bg-surface-muted px-3 py-1.5 text-xs font-semibold text-ink-muted"
                style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH }}
              >
                {s.unit}
              </div>
              {dates.map((d) => {
                const f = fmtDay(d);
                const isToday = d === today;
                return (
                  <div
                    key={d}
                    role="columnheader"
                    aria-label={formatLocalDate(d, locale, 'long')}
                    className={cn(
                      'pt-tabular flex flex-col items-center justify-center border-e border-line py-1 text-center text-[0.6875rem] leading-tight',
                      isToday ? 'bg-accent text-on-accent font-semibold' : 'text-ink-muted',
                      !isToday && isWeekend?.(d) && 'bg-surface-hover',
                    )}
                    style={{ width: cellWidth, minWidth: cellWidth }}
                  >
                    <span aria-hidden>{f.dow}</span>
                    <span aria-hidden className="text-sm font-semibold">
                      {f.num}
                    </span>
                    {(f.num === '1' || d === from) && (
                      <span aria-hidden className="text-[0.625rem] uppercase">
                        {f.month}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Body */}
            <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {virtualItems.map((vi) => {
                const r = rows[vi.index];
                if (!r) return null;
                if (r.type === 'group') {
                  return (
                    <div
                      key={r.key}
                      role="row"
                      className="absolute inset-x-0 flex items-center border-b border-line bg-surface-muted"
                      style={{ height: GROUP_HEIGHT, transform: `translateY(${vi.start}px)` }}
                    >
                      <div
                        role="rowheader"
                        aria-colspan={days + 1}
                        className="sticky start-0 px-3 text-xs font-semibold uppercase tracking-wide text-ink-muted"
                      >
                        {r.group} <span className="font-normal normal-case">({r.count})</span>
                      </div>
                    </div>
                  );
                }
                const unit = r.unit as TimelineUnit;
                const unitPlaced = placedByUnit.get(unit.id) ?? [];
                const lanes = Math.max(1, ...unitPlaced.map((p) => p.lane + 1));
                const laneHeight = (rowHeight - 6) / lanes;
                return (
                  <div
                    key={r.key}
                    role="row"
                    aria-rowindex={r.unitIndex + 2}
                    className="absolute inset-x-0 flex border-b border-line"
                    style={{ height: rowHeight, transform: `translateY(${vi.start}px)` }}
                  >
                    <div
                      role="rowheader"
                      className="sticky start-0 z-10 flex flex-col justify-center border-e border-line bg-surface px-3"
                      style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH }}
                    >
                      <span className="truncate text-sm font-medium">{unit.label}</span>
                      {unit.sublabel && (
                        <span className="truncate text-[0.6875rem] text-ink-muted">{unit.sublabel}</span>
                      )}
                    </div>
                    {dates.map((d, di) => {
                      const hit = itemsAt(items, unit.id, d);
                      const content = hit.length ? hit.map(describe).join('; ') : s.free;
                      const isActive = focusUnit === r.unitIndex && active.day === di;
                      return (
                        <div
                          key={d}
                          role="gridcell"
                          data-cell={`${r.unitIndex}:${di}`}
                          data-focus-inset
                          tabIndex={isActive ? 0 : -1}
                          aria-label={fmt(s.cellLabel, {
                            unit: unit.label,
                            date: formatLocalDate(d, locale, 'medium'),
                            content,
                          })}
                          onFocus={() => setActive({ unit: r.unitIndex, day: di })}
                          onClick={() => {
                            setActive({ unit: r.unitIndex, day: di });
                            if (hit[0]) onItemActivate?.(hit[0]);
                            else onCellActivate?.(unit, d);
                          }}
                          className={cn(
                            'border-e border-line',
                            d === today && 'bg-accent-soft',
                            d !== today && isWeekend?.(d) && 'bg-surface-muted',
                          )}
                          style={{ width: cellWidth, minWidth: cellWidth }}
                        />
                      );
                    })}
                    {unitPlaced.map((p) => (
                      <div
                        key={p.item.id}
                        aria-hidden
                        data-item-id={p.item.id}
                        data-kind={p.item.kind}
                        title={describe(p.item)}
                        onClick={() => onItemActivate?.(p.item)}
                        className={cn(
                          'absolute flex cursor-pointer items-center gap-1 overflow-hidden px-1.5 text-[0.75rem] font-medium shadow-sm',
                          barClass(p),
                          p.clippedStart ? 'rounded-e-md' : 'rounded-s-md',
                          p.clippedEnd ? '' : 'rounded-e-md',
                          p.clippedStart && p.clippedEnd && 'rounded-none',
                          p.item.alert && 'ring-2 ring-danger-solid',
                        )}
                        style={{
                          insetInlineStart:
                            LABEL_WIDTH + p.start * cellWidth + (p.clippedStart ? 0 : cellWidth * 0.35),
                          width:
                            p.span * cellWidth -
                            (p.clippedStart ? 0 : cellWidth * 0.35) +
                            (p.clippedEnd ? 0 : cellWidth * 0.3) -
                            2,
                          top: 3 + p.lane * laneHeight,
                          height: laneHeight - 2,
                        }}
                      >
                        {p.item.kind === 'block' && <Wrench className="size-3 shrink-0" />}
                        <span className="truncate">{p.item.label}</span>
                        {p.item.flags?.map((f) => (
                          <span
                            key={f}
                            className="shrink-0 rounded-sm bg-black/10 px-1 text-[0.625rem] uppercase"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
