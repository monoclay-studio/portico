/**
 * Background work: checklist reminders and closing rollback windows. Tenants are found through the module's
 * reviewed SECURITY DEFINER function (routing metadata only); the work runs inside each tenant with RLS.
 */
import { type PorticoDatabase, type ScheduledJob, sql, withTenantTx } from '@portico/db';
import { newId, systemContext, type TenantEnvironment } from '@portico/kernel';
import { remindOverdue } from './service/checklist';
import { db, saveJob, toJob } from './service/context';
import { purgeSourceData, RETENTION_DAYS_AFTER_END } from './service/privacy';

export async function migrationHousekeeping(
  database: PorticoDatabase,
): Promise<{ reminders: number; completed: number; purged: number }> {
  const { rows } = await sql<{ tenant_id: string; environment: string }>`
    select tenant_id, environment from migration.tenants_with_open_jobs(500)`.execute(database.kysely);
  let reminders = 0;
  let completed = 0;
  let purged = 0;
  for (const t of rows) {
    const ctx = systemContext(
      t.tenant_id,
      'migration-housekeeping',
      t.environment as TenantEnvironment,
      newId(),
    );
    await withTenantTx(database, ctx, async (tx) => {
      const jobs = await db(tx)
        .selectFrom('migration.jobs')
        .selectAll()
        .where('state', 'not in', ['completed', 'rolled_back', 'cancelled', 'failed'])
        .forUpdate()
        .execute();
      for (const row of jobs) {
        const job = toJob(row);
        reminders += await remindOverdue(tx, job);
        if (
          job.state === 'rollback_window' &&
          job.rollbackWindowEndsAt &&
          job.rollbackWindowEndsAt <= tx.now
        ) {
          await saveJob(tx, job, {
            state: 'completed',
            steps: { ...job.steps, rollback_window: 'succeeded' },
          });
          await tx.audit({
            action: 'migration.job.complete',
            target: { type: 'migration_job', id: job.id },
            propertyId: job.propertyId,
            reason: 'The rollback window closed.',
          });
          await tx.emit({
            type: 'migration.job.completed',
            propertyId: job.propertyId,
            aggregate: { type: 'migration_job', id: job.id },
            payload: { jobId: job.id },
          });
          completed++;
        }
      }
      // Personal data of ended migrations is purged after the retention period (keys, hashes and reports stay).
      const ended = await db(tx)
        .selectFrom('migration.jobs')
        .selectAll()
        .where('state', 'in', ['completed', 'rolled_back', 'cancelled'])
        .where('purged_at', 'is', null)
        .where('updated_at', '<', new Date(tx.now.getTime() - RETENTION_DAYS_AFTER_END * 86_400_000))
        .execute();
      for (const row of ended) {
        await purgeSourceData(tx, toJob(row));
        purged++;
      }
    });
  }
  return { reminders, completed, purged };
}

export function migrationJobs(): ScheduledJob[] {
  return [
    {
      name: 'migration.housekeeping',
      intervalSeconds: 900,
      async run(database) {
        await migrationHousekeeping(database);
      },
    },
  ];
}
