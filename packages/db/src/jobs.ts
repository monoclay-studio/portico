import { sql } from 'kysely';
import type { PorticoDatabase } from './database';

/**
 * A periodic background job (hold expiry, reconciliation, retention purges, escalations, Day Close scheduling…).
 * Jobs are claimed atomically in `core.job_runs`, so with several worker replicas each job runs once per interval.
 * A job that needs per-tenant work must find tenants through its own module's reviewed SECURITY DEFINER function
 * and then act inside `withTenantTx` with a system context — never by bypassing RLS for business data.
 */
export interface ScheduledJob {
  /** Unique, stable name, e.g. 'inventory.expireHolds'. */
  name: string;
  intervalSeconds: number;
  /** After this long a 'running' claim is considered crashed and may be re-claimed. Default 10 × interval, ≥ 5 min. */
  leaseSeconds?: number;
  run(database: PorticoDatabase, now: Date): Promise<void>;
}

export async function runDueJobs(
  database: PorticoDatabase,
  jobs: readonly ScheduledJob[],
  onError?: (job: string, err: unknown) => void,
): Promise<string[]> {
  const ran: string[] = [];
  for (const job of jobs) {
    const lease = job.leaseSeconds ?? Math.max(300, job.intervalSeconds * 10);
    const { rows } = await sql<{
      claimed: boolean;
    }>`select core.claim_job(${job.name}, ${job.intervalSeconds}, ${lease}) as claimed`.execute(
      database.kysely,
    );
    if (!rows[0]?.claimed) continue;
    try {
      await job.run(database, database.clock.now());
      await sql`select core.finish_job(${job.name}, true, null)`.execute(database.kysely);
      ran.push(job.name);
    } catch (err) {
      onError?.(job.name, err);
      await sql`select core.finish_job(${job.name}, false, ${err instanceof Error ? err.message : String(err)})`.execute(
        database.kysely,
      );
    }
  }
  return ran;
}

/** Foundation jobs owned by @portico/db. */
export const CORE_JOBS: readonly ScheduledJob[] = [
  {
    name: 'core.purgeExpiredIdempotencyKeys',
    intervalSeconds: 3600,
    async run(database) {
      for (let i = 0; i < 100; i++) {
        const { rows } = await sql<{
          n: number;
        }>`select core.purge_expired_idempotency_keys(5000) as n`.execute(database.kysely);
        if (!rows[0] || rows[0].n < 5000) return;
      }
    },
  },
];
