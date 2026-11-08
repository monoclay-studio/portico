/**
 * The run lease: one runner per job at a time (pipeline runs and the post-switch sweep). The import is also protected
 * by the job row lock and the ledger, so even a broken lease cannot duplicate records; the lease keeps "already
 * running" true for the person and is renewed per import chunk so a long import never outlives it (R-P3-12).
 */
import { type PorticoDatabase, sql, type TxContext, withTenantTx } from '@portico/db';
import { ConflictError, type RequestContext } from '@portico/kernel';
import { P } from '../manifest';
import { assertOpen, db, type Job, loadJobFor } from './context';

export const LEASE_MS = 10 * 60_000;

export async function acquireLease(
  database: PorticoDatabase,
  ctx: RequestContext,
  jobId: string,
): Promise<Job> {
  return withTenantTx(database, ctx, async (tx) => {
    const job = await loadJobFor(tx, jobId, P.manage, { lock: true });
    assertOpen(job);
    if (job.runningUntil && job.runningUntil.getTime() > tx.now.getTime())
      throw new ConflictError(
        'migration_running',
        'This migration is already running (started by another request). Wait for it to finish; its progress is on the migration page.',
        { runningUntil: job.runningUntil.toISOString() },
      );
    await db(tx)
      .updateTable('migration.jobs')
      .set({
        running_until: new Date(tx.now.getTime() + LEASE_MS),
        running_by: ctx.correlationId,
        run_correlations: sql`array_append(run_correlations, ${ctx.correlationId}::text)`,
      })
      .where('id', '=', jobId)
      .execute();
    return job;
  });
}

/** Extend the lease held by this runner (called inside each import chunk's transaction). */
export async function renewLease(tx: TxContext, jobId: string, holder: string): Promise<void> {
  await db(tx)
    .updateTable('migration.jobs')
    .set({ running_until: new Date(tx.now.getTime() + LEASE_MS) })
    .where('id', '=', jobId)
    .where('running_by', '=', holder)
    .execute();
}

export async function releaseLease(database: PorticoDatabase, ctx: RequestContext, jobId: string) {
  await withTenantTx(database, ctx, (tx) =>
    db(tx)
      .updateTable('migration.jobs')
      .set({ running_until: null, running_by: null })
      .where('id', '=', jobId)
      .where('running_by', '=', ctx.correlationId)
      .execute(),
  );
}
