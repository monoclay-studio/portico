/** ARI message history (acceptance recorded per message). */
import type { TxContext } from '@portico/db';
import { P } from '../manifest';
import { db, iso, loadConnection, requireOnConnection } from './common';

export async function listMessages(tx: TxContext, connectionId: string, limit = 100) {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.channelRead);
  const rows = await db(tx)
    .selectFrom('distribution.ari_messages')
    .selectAll()
    .where('connection_id', '=', conn.id)
    .orderBy('seq', 'desc')
    .limit(Math.min(limit, 500))
    .execute();
  return rows.map((m) => ({
    id: m.id,
    connectionId: m.connection_id,
    kind: m.kind,
    trigger: m.trigger,
    status: { message: m.status },
    cellCount: m.cell_count,
    valueCount: m.value_count,
    coalescedDeltas: m.coalesced_deltas,
    attempts: m.attempts,
    nextAttemptAt: iso(m.next_attempt_at),
    sentAt: iso(m.sent_at),
    acceptedAt: iso(m.accepted_at),
    lastError: m.last_error,
    provenance: m.provenance,
    createdAt: iso(m.created_at) as string,
  }));
}
