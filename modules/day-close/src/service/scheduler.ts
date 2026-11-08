/**
 * Scheduler (DCL-R05, DCL-R09): fires a property's scheduled close at its local time (DST-safe), continues
 * automatically when nothing blocks, re-checks blocked auto-close runs, resumes crashed auto-close runs, and retries
 * transient failures 3 × 5 minutes — never integrity failures.
 */
import { type PorticoDatabase, withTenantTx } from '@portico/db';
import {
  addDays,
  assertExternalEffectAllowed,
  DomainError,
  newId,
  type RequestContext,
} from '@portico/kernel';
import { POLICY_KEY, resolvePolicyValue } from '../domain/policy';
import { scheduledInstant } from '../domain/schedule';
import { DAY_CLOSE_EVENTS } from '../events';
import { actorKey, type Deps, db, json } from './context';
import { executeRun } from './engine';
import { closeIssue, upsertIssue } from './repo';
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
    const log = async (event: 'fired' | 'fire_refused' | 'adopted_run', detail: Record<string, unknown>) =>
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
      const { run, alreadyActive } = await createRun(deps, tx, { propertyId, trigger: 'schedule' });
      // The next close is the next business date's. While this date's run is still open past that time, re-check
      // hourly instead of firing every minute (review P3-1); resume keeps retrying the open run meanwhile.
      const nextClose = scheduledInstant(addDays(run.business_date, 1), sched.local_time, sched.timezone);
      const hourLater = new Date(tx.now.getTime() + 60 * 60_000);
      await db(tx)
        .updateTable('day_close.schedules')
        .set({
          next_due_at: nextClose.getTime() > tx.now.getTime() ? nextClose : hourLater,
          version: sched.version + 1,
          updated_at: tx.now,
        })
        .where('property_id', '=', propertyId)
        .execute();
      if (!run.auto_continue && policy.schedule.autoContinue) {
        // A run someone created first (e.g. by hand without executing) is adopted by the schedule (review P3-9):
        // the guesthouse auto-close does not silently turn into a manual run.
        await db(tx)
          .updateTable('day_close.runs')
          .set({ auto_continue: true })
          .where('id', '=', run.id)
          .execute();
        if (alreadyActive && run.trigger !== 'schedule')
          await log('adopted_run', { runId: run.id, trigger: run.trigger });
      }
      await closeIssue(
        tx,
        `close_not_started:${propertyId}:${property.businessDate}`,
        'The scheduled close started',
      );
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
      // Said after the first refusal, not only logged (review P2-7): the close is retried every 5 minutes.
      await upsertIssue(tx, {
        propertyId,
        businessDate: property.businessDate,
        runId: null,
        code: 'close_not_started',
        severity: 'warning',
        dedupeKey: `close_not_started:${propertyId}:${property.businessDate}`,
        ref: { type: 'property', id: propertyId },
        message: `The scheduled Day Close for ${property.businessDate} could not start: ${err.message} It is retried every 5 minutes; fix the cause or start it by hand.`,
        owner: { kind: 'department', id: 'night_audit' },
        details: { code: err.code },
      });
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

/**
 * Dead-man's switch (review P2-7): a property whose scheduled close is long overdue (the schedule's next due time is
 * past by more than the grace, or a run has been open for three times the grace) gets a `close_overdue` follow-up and a
 * notification request to the duty roles. Run by its own job, independent of the scheduler job's success.
 */
export async function raiseOverdue(
  deps: Deps,
  database: PorticoDatabase,
  ctx: RequestContext,
  propertyId: string,
  graceMs: number,
): Promise<boolean> {
  return withTenantTx(database, ctx, async (tx) => {
    const property = await deps.ports.platform.getProperty(tx, propertyId);
    const dedupeKey = `close_overdue:${propertyId}:${property.businessDate}`;
    const existing = await db(tx)
      .selectFrom('day_close.issues')
      .select('id')
      .where('dedupe_key', '=', dedupeKey)
      .executeTakeFirst();
    if (existing) return false;
    const active = await db(tx)
      .selectFrom('day_close.runs')
      .select(['id', 'status', 'version', 'property_id', 'business_date'])
      .where('property_id', '=', propertyId)
      .where('status', 'in', ['preflight', 'blocked', 'running', 'failed'])
      .executeTakeFirst();
    await upsertIssue(tx, {
      propertyId,
      businessDate: property.businessDate,
      runId: active?.id ?? null,
      code: 'close_overdue',
      severity: 'warning',
      dedupeKey,
      ref: active ? { type: 'day_close_run', id: active.id } : { type: 'property', id: propertyId },
      message: active
        ? `Day Close for ${active.business_date} has been ${active.status} for more than ${Math.round((graceMs * 3) / 3_600_000)} hours. Postings keep landing on ${property.businessDate} until it finishes: open the run and settle what stops it.`
        : `The scheduled Day Close for ${property.businessDate} has not run (more than ${Math.round(graceMs / 3_600_000)} hours late). Postings keep landing on ${property.businessDate}: start Day Close, or check the schedule and the worker.`,
      owner: { kind: 'department', id: 'night_audit' },
      details: { runId: active?.id ?? null, status: active?.status ?? null },
    });
    const mode = assertExternalEffectAllowed(tx, 'message.staff');
    await tx.emit({
      type: DAY_CLOSE_EVENTS.closeOverdue,
      propertyId,
      aggregate: { type: 'property', id: propertyId },
      payload: {
        propertyId,
        businessDate: property.businessDate,
        runId: active?.id ?? null,
        notification: { roles: ['night_audit', 'front_office_manager', 'general_manager'], mode },
      },
    });
    return true;
  });
}
