/**
 * Background work: checklist reminders, closing rollback windows, ending rehearsal copies whose live migration
 * ended, and the retention purge. Tenants are found through the module's reviewed SECURITY DEFINER function
 * (routing metadata only), paged by tenant id so every tenant is visited on every run (R-P2-7); the work runs inside
 * each tenant with RLS. One tenant's failure never stops the others: the run reports every failed tenant and ends
 * as failed, so `core.job_runs` records it and the age of the last successful run is what operations alarm on.
 */
import { type PorticoDatabase, type ScheduledJob, sql, type TxContext, withTenantTx } from '@portico/db';
import { newId, systemContext, type TenantEnvironment } from '@portico/kernel';
import { endMirror } from './rehearsal-bridge';
import { remindOverdue } from './service/checklist';
import { db, saveJob, toJob } from './service/context';
import { purgeSourceData, RETENTION_DAYS_AFTER_END } from './service/privacy';

const ENDED = ['completed', 'rolled_back', 'cancelled', 'failed'] as const;
const PAGE = 200;

export interface HousekeepingResult {
  tenants: number;
  reminders: number;
  completed: number;
  copiesEnded: number;
  purged: number;
  failedTenants: string[];
}

export class HousekeepingFailedError extends Error {
  constructor(readonly result: HousekeepingResult) {
    super(`Migration housekeeping failed for ${result.failedTenants.length} tenant(s).`);
  }
}

/** An organization that was closed (an ended trial): no retention reason is left for its migrations' source data. */
async function purgeClosedTenant(tx: TxContext, out: HousekeepingResult): Promise<void> {
  const jobs = await db(tx).selectFrom('migration.jobs').selectAll().where('purged_at', 'is', null).execute();
  for (const row of jobs) {
    await purgeSourceData(tx, toJob(row), 'The organization was closed.');
    out.purged++;
  }
}

async function housekeepTenant(tx: TxContext, out: HousekeepingResult): Promise<void> {
  const jobs = await db(tx)
    .selectFrom('migration.jobs')
    .selectAll()
    .where('state', 'not in', [...ENDED])
    .forUpdate()
    .execute();
  for (const row of jobs) {
    const job = toJob(row);
    // A rehearsal copy ends with its live migration — also when the live side no longer exists (R-P1-6).
    if (job.liveJobRef) {
      const { rows } = await sql<{ state: string }>`
        select migration.live_job_state(${job.liveJobRef.jobId}::uuid) as state`.execute(tx.db);
      const live = rows[0]?.state ?? 'missing';
      if (live === 'missing' || (ENDED as readonly string[]).includes(live)) {
        await endMirror(
          tx,
          job.liveJobRef.jobId,
          live === 'completed' ? 'completed' : 'cancelled',
          live === 'missing' ? 'The live migration no longer exists.' : `The live migration is ${live}.`,
        );
        out.copiesEnded++;
        // A copy whose live organization or job is gone has no retention reason left: purged at once.
        if (live === 'missing') {
          await purgeSourceData(tx, job, 'The live migration no longer exists.');
          out.purged++;
        }
        continue;
      }
    }
    out.reminders += await remindOverdue(tx, job);
    if (job.state === 'rollback_window' && job.rollbackWindowEndsAt && job.rollbackWindowEndsAt <= tx.now) {
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
      out.completed++;
    }
  }
  // Personal data of ended migrations (failed ones too) is purged after the retention period (keys, hashes and
  // reports stay).
  const ended = await db(tx)
    .selectFrom('migration.jobs')
    .selectAll()
    .where('state', 'in', [...ENDED])
    .where('purged_at', 'is', null)
    .where('updated_at', '<', new Date(tx.now.getTime() - RETENTION_DAYS_AFTER_END * 86_400_000))
    .execute();
  for (const row of ended) {
    await purgeSourceData(tx, toJob(row));
    out.purged++;
  }
}

export async function migrationHousekeeping(
  database: PorticoDatabase,
  opts: { page?: number } = {},
): Promise<HousekeepingResult> {
  const page = opts.page ?? PAGE;
  const out: HousekeepingResult = {
    tenants: 0,
    reminders: 0,
    completed: 0,
    copiesEnded: 0,
    purged: 0,
    failedTenants: [],
  };
  let after: string | null = null;
  for (;;) {
    const { rows } = await sql<{ tenant_id: string; environment: string; closed: boolean }>`
      select tenant_id, environment, closed from migration.tenants_with_open_jobs(${after}::uuid, ${page})`.execute(
      database.kysely,
    );
    for (const t of rows) {
      out.tenants++;
      const ctx = systemContext(
        t.tenant_id,
        'migration-housekeeping',
        t.environment as TenantEnvironment,
        newId(),
      );
      try {
        await withTenantTx(database, ctx, (tx) =>
          t.closed ? purgeClosedTenant(tx, out) : housekeepTenant(tx, out),
        );
      } catch {
        out.failedTenants.push(t.tenant_id);
      }
    }
    if (rows.length < page) break;
    after = (rows[rows.length - 1] as { tenant_id: string }).tenant_id;
  }
  return out;
}

export function migrationJobs(): ScheduledJob[] {
  return [
    {
      name: 'migration.housekeeping',
      intervalSeconds: 900,
      async run(database) {
        const result = await migrationHousekeeping(database);
        // Recorded as a failed run in core.job_runs (operations alarm on the age of the last success).
        if (result.failedTenants.length) throw new HousekeepingFailedError(result);
      },
    },
  ];
}
