/**
 * Personal data minimisation (F18, INT-R15): raw vendor payloads and imported file contents can carry guest data.
 * Once a message is settled (applied, stale or rejected) and older than the retention period, its raw payload and
 * translated values are redacted; imported and exported file contents are purged. Identifiers, revisions, hashes,
 * the exchange log and audit stay, so the history remains explainable without the personal data.
 */
import { sql, type TxContext } from '@portico/db';
import { db } from './common';

export const RAW_PAYLOAD_RETENTION_DAYS = 30;
const BATCH = 1000;

export async function applyRetention(
  tx: TxContext,
  opts: { retentionDays?: number } = {},
): Promise<{ redactedMessages: number; purgedFiles: number }> {
  const cutoff = new Date(tx.now.getTime() - (opts.retentionDays ?? RAW_PAYLOAD_RETENTION_DAYS) * 86_400_000);
  const messages = await db(tx)
    .updateTable('integration.inbound_messages')
    .set({
      payload: sql`'{}'::jsonb`,
      canonical: null,
      redacted_at: tx.now,
      version: sql`version + 1`,
    })
    .where(
      'id',
      'in',
      db(tx)
        .selectFrom('integration.inbound_messages')
        .select('id')
        .where('redacted_at', 'is', null)
        .where('received_at', '<', cutoff)
        .where('status', 'in', ['applied', 'stale', 'rejected'])
        .limit(BATCH),
    )
    .executeTakeFirst();
  const files = await db(tx)
    .updateTable('integration.files')
    .set({ content: null, purged_at: tx.now })
    .where(
      'id',
      'in',
      db(tx)
        .selectFrom('integration.files')
        .select('id')
        .where('purged_at', 'is', null)
        .where('created_at', '<', cutoff)
        .limit(BATCH),
    )
    .executeTakeFirst();
  return {
    redactedMessages: Number(messages.numUpdatedRows),
    purgedFiles: Number(files.numUpdatedRows),
  };
}
