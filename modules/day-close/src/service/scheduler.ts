/**
 * Scheduler (DCL-R05, DCL-R09): fires a property's scheduled close at its local time (DST-safe), continues
 * automatically when nothing blocks, re-checks blocked auto-close runs, resumes crashed auto-close runs, and retries
 * transient failures 3 × 5 minutes — never integrity failures.
 */
import { type PorticoDatabase, withTenantTx } from '@portico/db';
import { addDays, DomainError, newId, type RequestContext } from '@portico/kernel';
import { POLICY_KEY, resolvePolicyValue } from '../domain/policy';
import { scheduledInstant } from '../domain/schedule';
import { actorKey, type Deps, db, json } from './context';
import { executeRun } from './engine';
import { createRun } from './runs';

/** Fire a due schedule for a property (system context). Returns the run id started or found, if any. */
export async function fireSchedule(
  deps: Deps,
  database: PorticoDatabase,
  ctx: RequestContext,
  propertyId: string,
): Promise<string | null> {
  const started = await withTenantTx(database, ctx, async (tx) => {
    const sched = await db(tx)
      .selectFrom('day_close.schedules')
      .selectAll()
      .where('property_id', '=', propertyId)
      .forUpdate()
      .executeTakeFirst();
    if (!sched?.enabled || !sched.next_due_at || (sched.next_due_at as Date).getTime() > tx.now.getTime())
      return null;
    const property = await deps.ports.platform.getProperty(tx, propertyId);
    const raw = await deps.ports.platform.resolvePolicy(tx, propertyId, POLICY_KEY);
    const policy = resolvePolicyValue(raw.value, raw.source).policy;
    const log = async (event: 'fired' | 'fire_refused', detail: Record<string, unknown>) =>
      db(tx)
        .insertInto('day_close.schedule_log')
        .values({
          id: newId(),
          tenant_id: tx.tenantId,
          property_id: propertyId,
          event,
          business_date: property.businessDate,
          detail: json(detail),
          actor: actorKey(tx),
          created_at: tx.now,
        })
        .execute();
    if (sched.skip_date === property.businessDate) {
      await db(tx)
        .updateTable('day_close.schedules')
        .set({
          next_due_at: scheduledInstant(addDays(property.businessDate, 1), sched.local_time, sched.timezone),
          version: sched.version + 1,
          updated_at: tx.now,
        })
        .where('property_id', '=', propertyId)
        .execute();
      return null;
    }
    try {
      const { run } = await createRun(deps, tx, { propertyId, trigger: 'schedule' });
      await db(tx)
        .updateTable('day_close.schedules')
        .set({
          // The next close is the next business date's; a run that does not finish keeps being retried by resume.
          next_due_at: scheduledInstant(addDays(property.businessDate, 1), sched.local_time, sched.timezone),
          version: sched.version + 1,
          updated_at: tx.now,
        })
        .where('property_id', '=', propertyId)
        .execute();
      if (run.trigger === 'schedule' && !run.auto_continue && policy.schedule.autoContinue) {
        await db(tx)
          .updateTable('day_close.runs')
          .set({ auto_continue: true })
          .where('id', '=', run.id)
          .execute();
      }
      await log('fired', { runId: run.id, scheduledFor: (sched.next_due_at as Date).toISOString() });
      return run.id;
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      await db(tx)
        .updateTable('day_close.schedules')
        .set({
          next_due_at: new Date(tx.now.getTime() + 5 * 60_000),
          version: sched.version + 1,
          updated_at: tx.now,
        })
        .where('property_id', '=', propertyId)
        .execute();
      await log('fire_refused', { code: err.code, message: err.message });
      return null;
    }
  });
  if (started) await executeRun(deps, database, ctx, started);
  return started;
}

/** Continue a run the worker found due: crashed (lease expired), blocked with auto-continue, or due for a retry. */
export async function autoResume(
  deps: Deps,
  database: PorticoDatabase,
  ctx: RequestContext,
  runId: string,
): Promise<void> {
  await executeRun(deps, database, ctx, runId);
}
