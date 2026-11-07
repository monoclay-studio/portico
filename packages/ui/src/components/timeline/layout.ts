import { addDays, diffDays, type LocalDate } from '../../lib/dates';
import type { StayStatus } from '../status-badge';

/**
 * Pure layout for the units × nights timeline. A bar covers nights [from, to) — the departure date itself is
 * not a night, so a stay 10 → 13 occupies columns 10, 11, 12.
 */
export interface TimelineUnit {
  id: string;
  label: string;
  /** Group heading (usually the unit type or location). */
  group: string;
  /** Secondary text (e.g. condition), shown under the label. */
  sublabel?: string;
}

export type TimelineItemKind = 'stay' | 'block' | 'hold';

export interface TimelineItem {
  id: string;
  unitId: string;
  kind: TimelineItemKind;
  from: LocalDate;
  /** Exclusive end (departure / block end). */
  to: LocalDate;
  label: string;
  stayStatus?: StayStatus;
  blockKind?: 'out_of_order' | 'out_of_service' | 'house_use';
  /** Shown on the bar and announced: e.g. "VIP", "Balance due", "Unit locked". */
  flags?: string[];
  /** Highlight for something needing attention (also announced via flags). */
  alert?: boolean;
}

export interface PlacedItem {
  item: TimelineItem;
  /** Column index of the first visible night (0-based, within the range). */
  start: number;
  /** Number of visible nights. */
  span: number;
  /** The bar continues before / after the visible range. */
  clippedStart: boolean;
  clippedEnd: boolean;
  /** Vertical lane when items in the same unit overlap (conflicts/overbooking must stay visible). */
  lane: number;
}

function laterOf(a: LocalDate, b: LocalDate): LocalDate {
  return a > b ? a : b;
}

export function placeItems(items: readonly TimelineItem[], from: LocalDate, days: number): PlacedItem[] {
  const end = addDays(from, days);
  const placed: PlacedItem[] = [];
  const byUnit = new Map<string, TimelineItem[]>();
  for (const it of items) {
    if (it.to <= from || it.from >= end || it.to <= it.from) continue;
    const list = byUnit.get(it.unitId) ?? [];
    list.push(it);
    byUnit.set(it.unitId, list);
  }
  for (const list of byUnit.values()) {
    list.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1));
    const laneEnds: LocalDate[] = [];
    for (const it of list) {
      let lane = laneEnds.findIndex((e) => e <= it.from);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(it.to);
      } else laneEnds[lane] = it.to;
      // LocalDate strings compare lexicographically; Math.min/max would coerce them to NaN.
      const visFrom = it.from < from ? from : it.from;
      const visTo = laterOf(end, it.to) === it.to ? end : it.to;
      placed.push({
        item: it,
        start: diffDays(from, visFrom),
        span: diffDays(visFrom, visTo),
        clippedStart: it.from < from,
        clippedEnd: it.to > end,
        lane,
      });
    }
  }
  return placed;
}

/** Items that cover night `date` in `unitId`. */
export function itemsAt(items: readonly TimelineItem[], unitId: string, date: LocalDate): TimelineItem[] {
  return items.filter((it) => it.unitId === unitId && it.from <= date && date < it.to);
}

export interface TimelineRowModel {
  type: 'group' | 'unit';
  key: string;
  group: string;
  unit?: TimelineUnit;
  /** Index among unit rows (for keyboard navigation), -1 for group rows. */
  unitIndex: number;
  count?: number;
}

/** Flatten units into group header rows + unit rows, keeping the input order of groups and units. */
export function buildRows(units: readonly TimelineUnit[]): TimelineRowModel[] {
  const rows: TimelineRowModel[] = [];
  const counts = new Map<string, number>();
  for (const u of units) counts.set(u.group, (counts.get(u.group) ?? 0) + 1);
  let current: string | null = null;
  let unitIndex = 0;
  for (const u of units) {
    if (u.group !== current) {
      current = u.group;
      rows.push({
        type: 'group',
        key: `g:${u.group}`,
        group: u.group,
        unitIndex: -1,
        count: counts.get(u.group) ?? 0,
      });
    }
    rows.push({ type: 'unit', key: `u:${u.id}`, group: u.group, unit: u, unitIndex: unitIndex++ });
  }
  return rows;
}
