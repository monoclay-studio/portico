/**
 * Guest personal data in stored booking revisions (P2-7). Revisions are immutable evidence of what the channel
 * sent; the ONLY change ever made to them is the redaction of the guest's identity and free text, through the
 * reviewed database function `distribution.redact_revision_payloads` (a trigger refuses any other change). Ids,
 * statuses, stay dates, products, amounts and the payload hash stay, so redeliveries are still recognised (they are
 * compared by hash, never by re-hashing the stored payload).
 *
 * Paths: a privacy request (staff action, or `guests.profile.anonymized` once the lookup port is bound — FR-7) and
 * retention (daily: revisions whose stay ended more than `guestDataRetentionDays` ago, once settled).
 */
import { sql, type TxContext } from '@portico/db';
import { P, RECORD } from '../manifest';
import {
  type ConnectionRow,
  type DistributionDeps,
  db,
  loadConnection,
  requireOnConnection,
  settingsOf,
} from './common';

async function redact(
  tx: TxContext,
  ids: readonly string[],
  reason: 'erasure' | 'retention',
): Promise<number> {
  if (ids.length === 0) return 0;
  const r = await sql<{
    n: number;
  }>`select distribution.redact_revision_payloads(${ids as string[]}::uuid[], ${reason}) as n`.execute(tx.db);
  return r.rows[0]?.n ?? 0;
}

/** Erase the guest data of these channel bookings' revisions on one connection (privacy request). Idempotent. */
export async function eraseRevisionGuestData(
  tx: TxContext,
  _deps: DistributionDeps,
  connectionId: string,
  input: { channelBookingIds: readonly string[]; reason: string },
): Promise<{ redacted: number; revisions: number }> {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.guestDataErase);
  const rows = await db(tx)
    .selectFrom('distribution.inbound_revisions')
    .select('id')
    .where('connection_id', '=', conn.id)
    .where('channel_booking_id', 'in', [...input.channelBookingIds])
    .execute();
  const redacted = await redact(
    tx,
    rows.map((r) => r.id),
    'erasure',
  );
  await tx.audit({
    action: 'distribution.revision.guestDataErased',
    target: { type: RECORD.connection, id: conn.id },
    propertyId: conn.property_id,
    // No personal data in the audit: counts and the channel booking ids (channel references, not personal).
    after: { revisions: rows.length, redacted, channelBookingIds: [...input.channelBookingIds].slice(0, 50) },
    reason: input.reason,
  });
  return { redacted, revisions: rows.length };
}

/**
 * Retention (daily, with the nightly resync): settled revisions whose stay ended more than the retention period
 * before the property's business date. Revisions still being processed are never touched.
 */
export async function applyRetention(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
  opts: { batch?: number } = {},
): Promise<number> {
  const property = await deps.ports.platform.getProperty(tx, conn.property_id);
  const days = settingsOf(conn).guestDataRetentionDays;
  const rows = await sql<{ id: string }>`
    select r.id from distribution.inbound_revisions r
      join distribution.revision_processing p on p.revision_row_id = r.id
     where r.connection_id = ${conn.id}::uuid
       and r.redacted_at is null
       and p.state in ('applied', 'duplicate', 'stale', 'rejected')
       and p.ack_state in ('acked', 'not_due')
       and (select max((x->>'checkout')::date) from jsonb_array_elements(r.payload->'rooms') x)
           < (${property.businessDate}::date - ${days}::int)
     limit ${opts.batch ?? 500}`.execute(tx.db);
  return redact(
    tx,
    rows.rows.map((r) => r.id),
    'retention',
  );
}
