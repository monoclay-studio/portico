/**
 * Stop-sell (DST-R07, PAR-DST-017/018). A manual stop-sell closes a unit type (or every unit type) on one channel
 * for a date range. Stop-sell PROTECTION closes the last `threshold` units of every unit type on a connection while
 * it is degraded or failing, so a channel that cannot be kept up to date cannot sell the last villa twice; it is
 * released after the connection has been healthy for the cool-down. Both are logged, audited, visible in the channel
 * calendar (reason) and emitted as events; applying or releasing either one re-publishes the affected nights.
 */
import { sql, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  NotFoundError,
  newId,
  ValidationError,
  VersionConflictError,
} from '@portico/kernel';
import { DISTRIBUTION_EVENTS as E } from '../events';
import { P, RECORD } from '../manifest';
import { affectedProducts, markDirty, windowFor } from './ari-dirty';
import {
  actorKey,
  type ConnectionRow,
  type DistributionDeps,
  db,
  iso,
  loadConnection,
  requireOnConnection,
  settingsOf,
} from './common';

type StopSellRow = Awaited<ReturnType<typeof loadStopSell>>;

async function loadStopSell(tx: TxContext, id: string, forUpdate = false) {
  let q = db(tx).selectFrom('distribution.stop_sells').selectAll().where('id', '=', id);
  if (forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw new NotFoundError('stop_sell', id);
  return row;
}

export function stopSellView(r: StopSellRow) {
  return {
    id: r.id,
    connectionId: r.connection_id,
    source: r.source,
    unitTypeId: r.unit_type_id,
    from: r.range_from,
    to: r.range_to,
    threshold: r.threshold,
    reason: r.reason,
    status: { stopSell: r.status, source: r.source },
    createdAt: iso(r.created_at) as string,
    releasedAt: iso(r.released_at),
    version: r.version,
  };
}

async function republish(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
  unitTypeId: string | null,
  range: { from: string; to: string },
) {
  const products = await affectedProducts(
    tx,
    conn.id,
    'availability',
    unitTypeId ? [unitTypeId] : [null],
    [],
  );
  await markDirty(tx, deps, conn, { kind: 'availability', products, ranges: [range] });
}

export async function createStopSell(
  tx: TxContext,
  deps: DistributionDeps,
  connectionId: string,
  input: { unitTypeId: string | null; from: string; to: string; reason: string },
) {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.stopSellManage);
  if (input.from >= input.to)
    throw new ValidationError('invalid_date_range', 'The end date must be after the start date.');
  if (input.unitTypeId) {
    const types = await deps.ports.inventory.listUnitTypes(tx, conn.property_id);
    if (!types.some((t) => t.id === input.unitTypeId)) throw new NotFoundError('unit_type', input.unitTypeId);
  }
  const id = newId(tx.now.getTime());
  const row = await db(tx)
    .insertInto('distribution.stop_sells')
    .values({
      id,
      tenant_id: tx.tenantId,
      connection_id: conn.id,
      property_id: conn.property_id,
      source: 'manual',
      unit_type_id: input.unitTypeId,
      range_from: input.from,
      range_to: input.to,
      threshold: null,
      reason: input.reason,
      status: 'active',
      created_by: actorKey(tx),
      created_at: tx.now,
      released_by: null,
      released_at: null,
      release_reason: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await republish(tx, deps, conn, input.unitTypeId, { from: input.from, to: input.to });
  await tx.audit({
    action: 'distribution.stopSell.applied',
    target: { type: RECORD.stopSell, id },
    propertyId: conn.property_id,
    after: stopSellView(row),
    reason: input.reason,
  });
  await tx.emit({
    type: E.stopSellApplied,
    propertyId: conn.property_id,
    aggregate: { type: RECORD.stopSell, id },
    aggregateVersion: 1,
    payload: { stopSellId: id, connectionId: conn.id, propertyId: conn.property_id, source: 'manual' },
  });
  return stopSellView(row);
}

async function release(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
  row: StopSellRow,
  reason: string,
  by: string,
) {
  const updated = await db(tx)
    .updateTable('distribution.stop_sells')
    .set({
      status: 'released',
      released_at: tx.now,
      released_by: by,
      release_reason: reason,
      version: sql`version + 1`,
    })
    .where('id', '=', row.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await republish(tx, deps, conn, row.unit_type_id, { from: row.range_from, to: row.range_to });
  await tx.audit({
    action: 'distribution.stopSell.released',
    target: { type: RECORD.stopSell, id: row.id },
    propertyId: conn.property_id,
    before: { status: 'active' },
    after: { status: 'released' },
    reason,
  });
  await tx.emit({
    type: E.stopSellReleased,
    propertyId: conn.property_id,
    aggregate: { type: RECORD.stopSell, id: row.id },
    aggregateVersion: updated.version,
    payload: { stopSellId: row.id, connectionId: conn.id, propertyId: conn.property_id, source: row.source },
  });
  return stopSellView(updated);
}

/** Release a manual stop-sell or the automatic protection (a person decides; protection may come back if still degraded). */
export async function releaseStopSell(
  tx: TxContext,
  deps: DistributionDeps,
  id: string,
  expectedVersion: number,
  reason: string,
) {
  const row = await loadStopSell(tx, id, true);
  const conn = await loadConnection(tx, row.connection_id);
  requireOnConnection(tx, conn, P.stopSellManage);
  if (row.version !== expectedVersion)
    throw new VersionConflictError('stop_sell', id, expectedVersion, row.version);
  if (row.status !== 'active')
    throw new BusinessRuleError('stop_sell_not_active', 'This stop-sell was already released.');
  return release(tx, deps, conn, row, reason, actorKey(tx));
}

export async function activeProtection(tx: TxContext, connectionId: string) {
  return db(tx)
    .selectFrom('distribution.stop_sells')
    .selectAll()
    .where('connection_id', '=', connectionId)
    .where('source', '=', 'protection')
    .where('status', '=', 'active')
    .executeTakeFirst();
}

export async function applyProtection(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
  reason: string,
) {
  const s = settingsOf(conn).stopSellProtection;
  const window = await windowFor(tx, deps, conn);
  const id = newId(tx.now.getTime());
  const row = await db(tx)
    .insertInto('distribution.stop_sells')
    .values({
      id,
      tenant_id: tx.tenantId,
      connection_id: conn.id,
      property_id: conn.property_id,
      source: 'protection',
      unit_type_id: null,
      range_from: window.from,
      range_to: window.to,
      threshold: s.threshold,
      reason: `Stop-sell protection: the connection is not keeping the channel up to date (${reason}). The last ${s.threshold} unit(s) of each unit type are closed on this channel until it has been healthy for ${s.cooldownMinutes} minutes.`,
      status: 'active',
      created_by: 'system:distribution',
      created_at: tx.now,
      released_by: null,
      released_at: null,
      release_reason: null,
    })
    .onConflict((oc) => oc.doNothing())
    .returningAll()
    .executeTakeFirst();
  if (!row) return null;
  await republish(tx, deps, conn, null, window);
  await tx.audit({
    action: 'distribution.stopSell.applied',
    target: { type: RECORD.stopSell, id },
    propertyId: conn.property_id,
    after: stopSellView(row),
    reason: row.reason,
  });
  await tx.emit({
    type: E.stopSellApplied,
    propertyId: conn.property_id,
    aggregate: { type: RECORD.stopSell, id },
    aggregateVersion: 1,
    payload: { stopSellId: id, connectionId: conn.id, propertyId: conn.property_id, source: 'protection' },
  });
  return stopSellView(row);
}

export async function releaseProtection(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
  reason: string,
) {
  const row = await activeProtection(tx, conn.id);
  if (!row) return null;
  const locked = await loadStopSell(tx, row.id, true);
  if (locked.status !== 'active') return null;
  return release(tx, deps, conn, locked, reason, 'system:distribution');
}

export async function listStopSells(
  tx: TxContext,
  connectionId: string,
  q: { status?: 'active' | 'released' } = {},
) {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.channelRead);
  let query = db(tx)
    .selectFrom('distribution.stop_sells')
    .selectAll()
    .where('connection_id', '=', conn.id)
    .orderBy('created_at', 'desc')
    .limit(200);
  if (q.status) query = query.where('status', '=', q.status);
  return (await query.execute()).map(stopSellView);
}
