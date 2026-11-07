/**
 * Personal data held by a migration: the source's extracts and record payloads. They exist to rehearse, reconcile and
 * cut over; once the migration has ended (completed, rolled back or cancelled) they are purged after a retention
 * period, keeping only keys, hashes, counts, fingerprints and the reports (no personal data). Guests' data-subject
 * export can include what a migration still holds about a profile (personal-data contributor).
 */
import type { TxContext } from '@portico/db';
import { sql } from '@portico/db';
import type { GuestRecord, ReservationRecord } from '../domain/records';
import { db, type Job } from './context';

/** Days after a migration ends before its source data is purged (default; Q63-style retention, see README). */
export const RETENTION_DAYS_AFTER_END = 30;

export async function purgeSourceData(
  tx: TxContext,
  job: Job,
): Promise<{ payloads: number; records: number }> {
  const payloads = await db(tx)
    .deleteFrom('migration.extract_payloads')
    .where('job_id', '=', job.id)
    .executeTakeFirst();
  const records = await db(tx)
    .updateTable('migration.source_records')
    .set({ payload: null, raw: null, origin: sql`jsonb_build_object('file', origin->>'file')` })
    .where('job_id', '=', job.id)
    .executeTakeFirst();
  await db(tx).updateTable('migration.jobs').set({ purged_at: tx.now }).where('id', '=', job.id).execute();
  await tx.audit({
    action: 'migration.sourceData.purge',
    target: { type: 'migration_job', id: job.id },
    propertyId: job.propertyId,
    reason: `Retention: ${RETENTION_DAYS_AFTER_END} days after the migration ended.`,
    after: { payloads: Number(payloads.numDeletedRows), records: Number(records.numUpdatedRows) },
  });
  return { payloads: Number(payloads.numDeletedRows), records: Number(records.numUpdatedRows) };
}

/** What migrations still hold about a guest profile (for the guest's data export). Runs in guests' transaction. */
export const migrationPersonalData = {
  module: 'migration',
  async collect(tx: TxContext, profileId: string): Promise<unknown> {
    const links = await db(tx)
      .selectFrom('migration.import_ledger')
      .select(['source_key', 'last_job_id', 'source_system'])
      .where('data_class', '=', 'guest')
      .where('target_id', '=', profileId)
      .execute();
    if (links.length === 0) return null;
    const out: Array<{
      jobId: string;
      source: string;
      sourceKey: string;
      profile: unknown;
      reservations: unknown[];
    }> = [];
    for (const l of links) {
      const guest = await db(tx)
        .selectFrom('migration.source_records')
        .select(['payload'])
        .where('job_id', '=', l.last_job_id)
        .where('data_class', '=', 'guest')
        .where('source_key', '=', l.source_key)
        .executeTakeFirst();
      const reservations = await db(tx)
        .selectFrom('migration.source_records')
        .select(['source_key', 'payload'])
        .where('job_id', '=', l.last_job_id)
        .where('data_class', '=', 'reservation')
        .where(sql<boolean>`payload ->> 'guestKey' = ${l.source_key}`)
        .execute();
      out.push({
        jobId: l.last_job_id,
        source: l.source_system,
        sourceKey: l.source_key,
        profile: (guest?.payload ?? null) as GuestRecord | null,
        reservations: reservations.map((r) => ({
          sourceKey: r.source_key,
          ...(r.payload as ReservationRecord | null),
        })),
      });
    }
    return { migrations: out };
  },
};
