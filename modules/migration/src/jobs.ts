/**
 * Background work: checklist reminders and closing rollback windows. Tenants are found through the module's
 * reviewed SECURITY DEFINER function (routing metadata only); the work runs inside each tenant with RLS.
 */
import { type PorticoDatabase, type ScheduledJob, sql, withTenantTx } from '@portico/db';
import { newId, systemContext, type TenantEnvironment } from '@portico/kernel';
import { remindOverdue } from './service/checklist';
import { db, saveJob, toJob } from './service/context';

export async function migrationHousekeeping(
  database: PorticoDatabase,
): Promise<{ reminders: number; completed: number }> {
  const { rows } = await sql<{ tenant_id: string; environment: string }>`
    select tenant_id, environment from migration.tenants_with_open_jobs(500)`.execute(database.kysely);
  let reminders = 0;
  let completed = 0;
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
    });
  }
  return { reminders, completed };
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
