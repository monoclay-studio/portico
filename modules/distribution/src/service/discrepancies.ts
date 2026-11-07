/** Discrepancy list and staff resolution (open → investigating → resolved | accepted). */
import { sql, type TxContext } from '@portico/db';
import { BusinessRuleError, NotFoundError, VersionConflictError } from '@portico/kernel';
import { DISTRIBUTION_EVENTS as E } from '../events';
import { P, RECORD } from '../manifest';
import { actorKey, db, iso, loadConnection, requireOnConnection } from './common';

type Row = Awaited<ReturnType<typeof loadRow>>;

async function loadRow(tx: TxContext, id: string, forUpdate = false) {
  let q = db(tx).selectFrom('distribution.discrepancies').selectAll().where('id', '=', id);
  if (forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw new NotFoundError('channel_discrepancy', id);
  return row;
}

export function discrepancyView(tx: TxContext, r: Row) {
  const can = tx.authz.can(P.discrepancyResolve, { propertyId: r.property_id });
  const open = r.status === 'open' || r.status === 'investigating';
  const act = (action: string, label: string) => ({
    action,
    label,
    enabled: open && can,
    ...(!open
      ? { reason: 'Already closed.' }
      : !can
        ? { reason: 'Needs permission to resolve discrepancies.' }
        : {}),
  });
  return {
    id: r.id,
    connectionId: r.connection_id,
    propertyId: r.property_id,
    kind: r.kind,
    summary: r.summary,
    detail: r.detail,
    status: { discrepancy: r.status },
    detectedAt: iso(r.detected_at) as string,
    resolution: r.resolution,
    allowedActions: [
      act('investigate', 'Investigating'),
      act('resolve', 'Resolved'),
      act('accept', 'Accept (explained)'),
    ],
    links: [
      { rel: 'connection', type: RECORD.connection, id: r.connection_id },
      ...((Array.isArray(r.refs) ? r.refs : []) as Array<{ type: string; id: string }>).map((x) => ({
        rel: 'related',
        type: x.type,
        id: x.id,
      })),
    ],
    version: r.version,
  };
}

export async function listDiscrepancies(tx: TxContext, connectionId: string) {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.channelRead);
  const rows = await db(tx)
    .selectFrom('distribution.discrepancies')
    .selectAll()
    .where('connection_id', '=', conn.id)
    .orderBy('detected_at', 'desc')
    .limit(500)
    .execute();
  return rows.map((r) => discrepancyView(tx, r));
}

export async function resolveDiscrepancy(
  tx: TxContext,
  id: string,
  expectedVersion: number,
  input: { status: 'investigating' | 'resolved' | 'accepted'; resolution: string },
) {
  const row = await loadRow(tx, id, true);
  requireOnConnection(tx, row, P.discrepancyResolve);
  if (row.version !== expectedVersion)
    throw new VersionConflictError('channel_discrepancy', id, expectedVersion, row.version);
  if (row.status === 'resolved' || row.status === 'accepted') {
    throw new BusinessRuleError('discrepancy_closed', 'This discrepancy is already closed.');
  }
  const closing = input.status !== 'investigating';
  const updated = await db(tx)
    .updateTable('distribution.discrepancies')
    .set({
      status: input.status,
      resolution: input.resolution,
      ...(closing
        ? { resolved_at: tx.now, resolved_by: actorKey(tx) }
        : { owner_user_id: tx.actor.kind === 'user' ? tx.actor.userId : null }),
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: `distribution.discrepancy.${input.status}`,
    target: { type: RECORD.discrepancy, id },
    propertyId: row.property_id,
    before: { status: row.status },
    after: { status: input.status },
    reason: input.resolution,
  });
  if (closing) {
    await tx.emit({
      type: E.discrepancyResolved,
      propertyId: row.property_id,
      aggregate: { type: RECORD.discrepancy, id },
      aggregateVersion: updated.version,
      payload: {
        discrepancyId: id,
        connectionId: row.connection_id,
        propertyId: row.property_id,
        kind: row.kind,
      },
    });
  }
  return discrepancyView(tx, updated);
}
