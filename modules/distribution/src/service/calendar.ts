/**
 * Channel calendar (DST-R06): per cell, what Portico would publish now beside what the channel last acknowledged,
 * with the sync state. The discrepancy check turns unexplained differences into discrepancies and re-pushes them
 * (EC-DST-011); it runs before every nightly resync and on demand.
 */
import type { TxContext } from '@portico/db';
import { addDays, type DateRange, diffDays, ValidationError } from '@portico/kernel';
import type { CalendarCell } from '../contracts';
import { type AriKind, type CellValue, compareCell } from '../domain/ari';
import { normalizeRanges, rangesFromDates } from '../domain/ranges';
import { P } from '../manifest';
import { activeMappings, markDirty, type Product, windowFor } from './ari-dirty';
import type { StoredCell } from './ari-dispatch';
import { buildCells, cellKey } from './ari-values';
import {
  type ConnectionRow,
  type DistributionDeps,
  db,
  iso,
  loadConnection,
  requireOnConnection,
} from './common';
import { autoResolveDiscrepancies, raiseDiscrepancy } from './exceptions';

const MAX_CALENDAR_NIGHTS = 62;

async function computeCells(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
  kind: AriKind,
  range: DateRange,
  unitTypeId?: string,
): Promise<CalendarCell[]> {
  const m = await activeMappings(tx, conn.id);
  const products: Product[] =
    kind === 'availability'
      ? m.rooms.map((r) => ({ unitTypeId: r.unit_type_id, ratePlanId: null }))
      : m.rates.map((r) => ({ unitTypeId: r.unit_type_id, ratePlanId: r.rate_plan_id }));
  const wanted = products
    .filter((p) => !unitTypeId || p.unitTypeId === unitTypeId)
    .map((product) => ({ product, ranges: [range] }));
  const built = await buildCells(tx, deps, conn, kind, wanted);
  const [acked, dirty, messages] = await Promise.all([
    db(tx)
      .selectFrom('distribution.channel_state')
      .selectAll()
      .where('connection_id', '=', conn.id)
      .where('kind', '=', kind)
      .where('stay_date', '>=', range.from)
      .where('stay_date', '<', range.to)
      .execute(),
    db(tx)
      .selectFrom('distribution.ari_dirty')
      .select(['unit_type_id', 'rate_plan_id', 'ranges'])
      .where('connection_id', '=', conn.id)
      .where('kind', '=', kind)
      .execute(),
    db(tx)
      .selectFrom('distribution.ari_messages')
      .select(['seq', 'status', 'cells', 'rejected_cells'])
      .where('connection_id', '=', conn.id)
      .where('kind', '=', kind)
      .where((eb) =>
        eb.or([
          eb('status', 'in', ['queued', 'sending', 'failed_transient']),
          eb('rejected_cells', 'is not', null),
        ]),
      )
      .orderBy('seq', 'desc')
      .limit(200)
      .execute(),
  ]);
  const ackedBy = new Map(
    acked.map((a) => [
      cellKey({ unitTypeId: a.unit_type_id, ratePlanId: a.rate_plan_id, date: a.stay_date }),
      a,
    ]),
  );
  const pending = new Set<string>();
  for (const d of dirty) {
    for (const r of normalizeRanges(d.ranges as DateRange[])) {
      for (let x = r.from; x < r.to; x = addDays(x, 1)) {
        pending.add(cellKey({ unitTypeId: d.unit_type_id, ratePlanId: d.rate_plan_id, date: x }));
      }
    }
  }
  const rejectedSeq = new Map<string, number>();
  for (const msg of messages) {
    if (['queued', 'sending', 'failed_transient'].includes(msg.status)) {
      for (const c of msg.cells as StoredCell[])
        pending.add(cellKey({ unitTypeId: c.u, ratePlanId: c.r, date: c.d }));
    }
    for (const c of (msg.rejected_cells ?? []) as StoredCell[]) {
      const k = cellKey({ unitTypeId: c.u, ratePlanId: c.r, date: c.d });
      if (!rejectedSeq.has(k)) rejectedSeq.set(k, msg.seq);
    }
  }
  return built.cells.map((c) => {
    const k = cellKey(c);
    const a = ackedBy.get(k);
    const rej = rejectedSeq.get(k);
    const rejected = rej !== undefined && (!a || a.acked_message_seq < rej);
    return {
      kind,
      unitTypeId: c.unitTypeId,
      ratePlanId: c.ratePlanId,
      date: c.date,
      expected: c.value,
      acked: (a?.last_acked as CellValue | undefined) ?? null,
      ackedAt: iso(a?.acked_at ?? null),
      state: compareCell({
        expected: c.value,
        acked: (a?.last_acked as CellValue | undefined) ?? null,
        pending: pending.has(k),
        rejected,
      }),
      reason: c.reason ?? null,
    };
  });
}

export async function getChannelCalendar(
  tx: TxContext,
  deps: DistributionDeps,
  connectionId: string,
  q: { from: string; to: string; kind?: AriKind; unitTypeId?: string },
): Promise<CalendarCell[]> {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.channelRead);
  if (q.from >= q.to)
    throw new ValidationError('invalid_date_range', 'The end date must be after the start date.');
  if (diffDays(q.from, q.to) > MAX_CALENDAR_NIGHTS) {
    throw new ValidationError(
      'calendar_range_too_long',
      `Show at most ${MAX_CALENDAR_NIGHTS} nights at a time.`,
    );
  }
  const kinds: AriKind[] = q.kind ? [q.kind] : ['availability', 'restrictions'];
  const out: CalendarCell[] = [];
  for (const kind of kinds)
    out.push(...(await computeCells(tx, deps, conn, kind, { from: q.from, to: q.to }, q.unitTypeId)));
  return out;
}

/**
 * Differences no queued work explains become discrepancies (one per product) and are re-pushed. Discrepancies
 * whose products are back in sync are resolved by the check itself.
 */
export async function checkDiscrepancies(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
  range?: DateRange,
): Promise<{ differing: number; discrepancies: number }> {
  const window = range ?? (await windowFor(tx, deps, conn));
  const keep = new Set<string>();
  let differing = 0;
  let created = 0;
  for (const kind of ['availability', 'restrictions'] as const) {
    const byProduct = new Map<string, { product: Product; dates: string[] }>();
    for (let from = window.from; from < window.to; from = addDays(from, MAX_CALENDAR_NIGHTS)) {
      const chunkEnd = addDays(from, MAX_CALENDAR_NIGHTS);
      const to = [chunkEnd, window.to].sort()[0] as string; // earlier of two ISO dates
      for (const c of await computeCells(tx, deps, conn, kind, { from, to })) {
        if (c.state !== 'differs') continue;
        differing++;
        const k = `${c.unitTypeId}|${c.ratePlanId ?? ''}`;
        const cur = byProduct.get(k) ?? {
          product: { unitTypeId: c.unitTypeId, ratePlanId: c.ratePlanId },
          dates: [],
        };
        cur.dates.push(c.date);
        byProduct.set(k, cur);
      }
    }
    for (const [k, v] of byProduct) {
      const dedupeKey = `ari_drift:${kind}:${k}`;
      keep.add(dedupeKey);
      const r = await raiseDiscrepancy(tx, {
        connectionId: conn.id,
        propertyId: conn.property_id,
        kind: kind === 'availability' ? 'availability' : 'rate',
        dedupeKey,
        summary: `${v.dates.length} night(s) of ${kind} differ from what the channel last acknowledged (from ${v.dates[0]}). Portico re-sends them.`,
        detail: {
          unitTypeId: v.product.unitTypeId,
          ratePlanId: v.product.ratePlanId,
          firstDates: v.dates.slice(0, 20),
        },
      });
      if (r.created) created++;
      await markDirty(tx, deps, conn, { kind, products: [v.product], ranges: rangesFromDates(v.dates) });
    }
  }
  await autoResolveDiscrepancies(
    tx,
    conn.id,
    'ari_drift:',
    'The channel acknowledged the current values.',
    keep,
  );
  return { differing, discrepancies: created };
}

export async function runDiscrepancyCheck(tx: TxContext, deps: DistributionDeps, connectionId: string) {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.ariResync);
  return checkDiscrepancies(tx, deps, conn);
}
