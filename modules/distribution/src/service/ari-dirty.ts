/**
 * The ARI dirty set (change capture). Writers only record WHICH cells changed — per (connection, kind, unit type,
 * rate plan) as merged ranges — never values. Merging happens under the per-connection-and-kind lock, so any
 * number of concurrent changes over overlapping or adjacent nights collapse into one normalized range set.
 */
import type { TxContext } from '@portico/db';
import type { DateRange } from '@portico/kernel';
import { newId } from '@portico/kernel';
import { type AriKind, publicationWindow } from '../domain/ari';
import { clipRanges, countNights, mergeRanges, normalizeRanges } from '../domain/ranges';
import {
  type ConnectionRow,
  type DistributionDeps,
  db,
  json,
  lockAri,
  scheduleTenant,
  settingsOf,
} from './common';

export interface Product {
  unitTypeId: string;
  ratePlanId: string | null;
}

export async function activeMappings(tx: TxContext, connectionId: string) {
  const [rooms, rates] = await Promise.all([
    db(tx)
      .selectFrom('distribution.room_mappings')
      .selectAll()
      .where('connection_id', '=', connectionId)
      .where('status', '=', 'active')
      .execute(),
    db(tx)
      .selectFrom('distribution.rate_mappings')
      .selectAll()
      .where('connection_id', '=', connectionId)
      .where('status', '=', 'active')
      .execute(),
  ]);
  return { rooms, rates };
}

/**
 * Mapped products affected by a change. `null` in the lists means "every" (rates' all-plans / all-types scopes).
 * Availability is per unit type (room mapping); restrictions per unit type × rate plan (rate mapping).
 */
export async function affectedProducts(
  tx: TxContext,
  connectionId: string,
  kind: AriKind,
  unitTypeIds: ReadonlyArray<string | null>,
  ratePlanIds: ReadonlyArray<string | null>,
): Promise<Product[]> {
  const m = await activeMappings(tx, connectionId);
  const allTypes = unitTypeIds.length === 0 || unitTypeIds.includes(null);
  const types = new Set(unitTypeIds.filter((x): x is string => x !== null));
  if (kind === 'availability') {
    return m.rooms
      .filter((r) => allTypes || types.has(r.unit_type_id))
      .map((r) => ({ unitTypeId: r.unit_type_id, ratePlanId: null }));
  }
  const allPlans = ratePlanIds.length === 0 || ratePlanIds.includes(null);
  const plans = new Set(ratePlanIds.filter((x): x is string => x !== null));
  return m.rates
    .filter((r) => (allTypes || types.has(r.unit_type_id)) && (allPlans || plans.has(r.rate_plan_id)))
    .map((r) => ({ unitTypeId: r.unit_type_id, ratePlanId: r.rate_plan_id }));
}

/** Publication window for a connection (business date + horizon). */
export async function windowFor(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
): Promise<DateRange> {
  const property = await deps.ports.platform.getProperty(tx, conn.property_id);
  return publicationWindow(property.businessDate, settingsOf(conn).horizonDays);
}

/** Record changed cells for one connection. Returns the number of nights marked (after clipping to the window). */
export async function markDirty(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
  input: { kind: AriKind; products: readonly Product[]; ranges: readonly DateRange[] },
): Promise<number> {
  if (input.products.length === 0) return 0;
  const window = await windowFor(tx, deps, conn);
  const ranges = clipRanges(normalizeRanges(input.ranges), window);
  if (ranges.length === 0) return 0;
  await lockAri(tx, conn.id, input.kind);
  let marked = 0;
  for (const p of input.products) {
    const ratePlanId = input.kind === 'availability' ? null : p.ratePlanId;
    let q = db(tx)
      .selectFrom('distribution.ari_dirty')
      .selectAll()
      .where('connection_id', '=', conn.id)
      .where('kind', '=', input.kind)
      .where('unit_type_id', '=', p.unitTypeId);
    q = ratePlanId === null ? q.where('rate_plan_id', 'is', null) : q.where('rate_plan_id', '=', ratePlanId);
    const existing = await q.executeTakeFirst();
    if (existing) {
      const merged = mergeRanges(existing.ranges as DateRange[], ranges);
      await db(tx)
        .updateTable('distribution.ari_dirty')
        .set({ ranges: json(merged), merged_deltas: existing.merged_deltas + 1, updated_at: tx.now })
        .where('id', '=', existing.id)
        .execute();
    } else {
      await db(tx)
        .insertInto('distribution.ari_dirty')
        .values({
          id: newId(tx.now.getTime()),
          tenant_id: tx.tenantId,
          connection_id: conn.id,
          kind: input.kind,
          unit_type_id: p.unitTypeId,
          rate_plan_id: ratePlanId,
          ranges: json(ranges),
          merged_deltas: 1,
          first_dirty_at: tx.now,
          updated_at: tx.now,
        })
        .execute();
    }
    marked += countNights(ranges);
  }
  await scheduleTenant(tx, tx.now);
  return marked;
}

/** Connections of a property that publish (or will publish when resumed). */
export async function publishingConnections(tx: TxContext, propertyId: string): Promise<ConnectionRow[]> {
  return db(tx)
    .selectFrom('distribution.connections')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('status', 'in', ['active', 'paused'])
    .execute();
}

/** Change capture for one property: every publishing connection, every mapped product the change touches. */
export async function markPropertyDirty(
  tx: TxContext,
  deps: DistributionDeps,
  input: {
    propertyId: string;
    kind: AriKind;
    unitTypeIds: ReadonlyArray<string | null>;
    ratePlanIds: ReadonlyArray<string | null>;
    ranges: readonly DateRange[];
  },
): Promise<number> {
  let n = 0;
  for (const conn of await publishingConnections(tx, input.propertyId)) {
    const products = await affectedProducts(tx, conn.id, input.kind, input.unitTypeIds, input.ratePlanIds);
    n += await markDirty(tx, deps, conn, { kind: input.kind, products, ranges: input.ranges });
  }
  return n;
}
