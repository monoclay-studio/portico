/**
 * What to publish for a set of cells: availability from inventory, prices and restrictions from rates (never
 * computed here), then stop-sell closures, then channel codes from the mappings. Shared by the message builder and
 * the channel calendar, so the calendar's "expected" value is exactly what the next message would send.
 */
import type { TxContext } from '@portico/db';
import type { DateRange, LocalDate } from '@portico/kernel';
import type { AvailabilityRun, RestrictionRun } from '../adapters/channex/wire';
import {
  type AriCell,
  type AriKind,
  type AvailabilityValue,
  compressRuns,
  publishedAvailability,
  type RestrictionValue,
  restrictionValueFrom,
} from '../domain/ari';
import { eachDate, normalizeRanges } from '../domain/ranges';
import { activeMappings, type Product } from './ari-dirty';
import { type ConnectionRow, type DistributionDeps, db, settingsOf } from './common';

export interface BuiltCell extends AriCell {
  channelId: string;
}

export interface ProductRanges {
  product: Product;
  ranges: DateRange[];
}

function span(ranges: readonly DateRange[]): DateRange | null {
  const n = normalizeRanges(ranges);
  const first = n[0];
  const last = n[n.length - 1];
  return first && last ? { from: first.from, to: last.to } : null;
}

export async function activeStopSells(tx: TxContext, connectionId: string) {
  return db(tx)
    .selectFrom('distribution.stop_sells')
    .selectAll()
    .where('connection_id', '=', connectionId)
    .where('status', '=', 'active')
    .execute();
}

export async function buildCells(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
  kind: AriKind,
  wanted: readonly ProductRanges[],
): Promise<{ cells: BuiltCell[]; dropped: number }> {
  const m = await activeMappings(tx, conn.id);
  const roomOf = new Map(m.rooms.map((r) => [r.unit_type_id, r.channel_room_type_id]));
  const rateOf = new Map(m.rates.map((r) => [`${r.unit_type_id}|${r.rate_plan_id}`, r.channel_rate_plan_id]));
  const cells: BuiltCell[] = [];
  let dropped = 0;
  if (kind === 'availability') {
    const stops = await activeStopSells(tx, conn.id);
    const protection = stops.find((s) => s.source === 'protection') ?? null;
    const manual = stops.filter((s) => s.source === 'manual');
    const mapped = wanted.filter((w) => roomOf.has(w.product.unitTypeId));
    dropped += wanted
      .filter((w) => !roomOf.has(w.product.unitTypeId))
      .reduce((n, w) => n + eachDate(w.ranges).length, 0);
    const all = span(mapped.flatMap((w) => w.ranges));
    if (!all || mapped.length === 0) return { cells, dropped };
    const rows = await deps.ports.inventory.sellable(tx, {
      propertyId: conn.property_id,
      unitTypeIds: [...new Set(mapped.map((w) => w.product.unitTypeId))],
      range: all,
    });
    const sellable = new Map(rows.map((r) => [`${r.unitTypeId}|${r.date}`, r.sellable]));
    for (const w of mapped) {
      const channelId = roomOf.get(w.product.unitTypeId) as string;
      for (const date of eachDate(w.ranges)) {
        const manualClosed = manual.some(
          (s) =>
            (s.unit_type_id === null || s.unit_type_id === w.product.unitTypeId) &&
            date >= s.range_from &&
            date < s.range_to,
        );
        const v = publishedAvailability(sellable.get(`${w.product.unitTypeId}|${date}`) ?? 0, {
          manual: manualClosed,
          protectionThreshold: protection
            ? (protection.threshold ?? settingsOf(conn).stopSellProtection.threshold)
            : null,
        });
        cells.push({
          unitTypeId: w.product.unitTypeId,
          ratePlanId: null,
          date,
          value: v.value,
          ...(v.reason ? { reason: v.reason } : {}),
          channelId,
        });
      }
    }
    return { cells, dropped };
  }
  for (const w of wanted) {
    const rp = w.product.ratePlanId;
    const channelId = rp ? rateOf.get(`${w.product.unitTypeId}|${rp}`) : undefined;
    const s = span(w.ranges);
    if (!rp || !channelId || !s) {
      dropped += eachDate(w.ranges).length;
      continue;
    }
    const values = await deps.ports.rates.ariValues(tx, {
      propertyId: conn.property_id,
      ratePlanId: rp,
      unitTypeId: w.product.unitTypeId,
      range: s,
    });
    const byDate = new Map(values.map((v) => [v.date, v]));
    for (const date of eachDate(w.ranges)) {
      const v = byDate.get(date);
      const built = restrictionValueFrom(v?.price ?? null, v?.restrictions ?? {});
      cells.push({
        unitTypeId: w.product.unitTypeId,
        ratePlanId: rp,
        date,
        value: built.value,
        ...(built.reason ? { reason: built.reason } : {}),
        channelId,
      });
    }
  }
  return { cells, dropped };
}

export interface WireBatch {
  availability: AvailabilityRun[];
  restrictions: RestrictionRun[];
  /** For each wire value (same order), the cells it covers — maps a partial refusal back to cells. */
  valueCells: number[][];
}

/** Pack cells into hub values: per channel code, consecutive nights with equal values become one range. */
export function packCells(kind: AriKind, cells: readonly BuiltCell[]): WireBatch {
  const out: WireBatch = { availability: [], restrictions: [], valueCells: [] };
  const byChannel = new Map<string, number[]>();
  cells.forEach((c, i) => {
    const list = byChannel.get(c.channelId) ?? [];
    list.push(i);
    byChannel.set(c.channelId, list);
  });
  for (const [channelId, idx] of [...byChannel.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const runs = compressRuns(
      idx.map((i) => ({ date: (cells[i] as BuiltCell).date, value: (cells[i] as BuiltCell).value })),
    );
    for (const run of runs) {
      const covered = idx.filter((i) => {
        const d = (cells[i] as BuiltCell).date;
        return d >= run.from && d < run.to;
      });
      out.valueCells.push(covered);
      if (kind === 'availability') {
        out.availability.push({
          channelRoomTypeId: channelId,
          run: { ...run, value: run.value as AvailabilityValue },
        });
      } else {
        out.restrictions.push({
          channelRatePlanId: channelId,
          run: { ...run, value: run.value as RestrictionValue },
        });
      }
    }
  }
  return out;
}

export const cellKey = (c: { unitTypeId: string; ratePlanId: string | null; date: LocalDate }) =>
  `${c.unitTypeId}|${c.ratePlanId ?? ''}|${c.date}`;
