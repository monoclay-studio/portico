import { type ScheduledJob, sql, type TxEventSubscription } from '@portico/db';
import { newId, systemContext, type TenantEnvironment } from '@portico/kernel';
import { DAY_CLOSE_CONSUMES } from './events';
import { type DayCloseService, onStayEvent } from './service';

/** Grace after a scheduled close before the dead-man's switch speaks (review P2-7). */
export const OVERDUE_GRACE_MS = 2 * 60 * 60_000;

/**
 * `dayClose.scheduler` (every minute): finds due work through the module's reviewed SECURITY DEFINER routing
 * function `day_close.due_work(now)` — scheduled closes, crashed or blocked auto-close runs, failed runs due for an
 * automatic retry — and does it inside each tenant's own RLS transaction with a system context.
 */
export function dayCloseJobs(
  service: DayCloseService,
  opts: { onError?: (job: string, propertyId: string, err: unknown) => void } = {},
): ScheduledJob[] {
  return [
    {
      name: 'dayClose.scheduler',
      intervalSeconds: 60,
      leaseSeconds: 15 * 60,
      async run(database, now) {
        const { rows } = await sql<{
          tenant_id: string;
          property_id: string;
          run_id: string | null;
          kind: 'schedule' | 'resume';
        }>`select tenant_id, property_id, run_id, kind from day_close.due_work(${now})`.execute(
          database.kysely,
        );
        for (const r of rows) {
          try {
            const env = await sql<{
              e: string | null;
            }>`select platform.tenant_environment(${r.tenant_id}::uuid) as e`.execute(database.kysely);
            if (!env.rows[0]?.e) continue;
            const ctx = systemContext(
              r.tenant_id,
              'dayClose.scheduler',
              env.rows[0].e as TenantEnvironment,
              newId(),
            );
            if (r.kind === 'schedule') await service.fireSchedule(database, ctx, r.property_id);
            else if (r.run_id) await service.autoResume(database, ctx, r.run_id);
          } catch (err) {
            opts.onError?.('dayClose.scheduler', r.property_id, err);
          }
        }
      },
    },
    {
      // Dead-man's switch (review P2-7): independent of the scheduler job; finds closes long overdue through the
      // reviewed SECURITY DEFINER routing function and raises one follow-up + notification per property and date.
      name: 'dayClose.overdue',
      intervalSeconds: 15 * 60,
      leaseSeconds: 10 * 60,
      async run(database, now) {
        const { rows } = await sql<{ tenant_id: string; property_id: string }>`
          select tenant_id, property_id from day_close.overdue_closes(${now}, ${`${OVERDUE_GRACE_MS / 1000} seconds`}::interval)`.execute(
          database.kysely,
        );
        for (const r of rows) {
          try {
            const env = await sql<{
              e: string | null;
            }>`select platform.tenant_environment(${r.tenant_id}::uuid) as e`.execute(database.kysely);
            if (!env.rows[0]?.e) continue;
            const ctx = systemContext(
              r.tenant_id,
              'dayClose.overdue',
              env.rows[0].e as TenantEnvironment,
              newId(),
            );
            await service.raiseOverdue(database, ctx, r.property_id, OVERDUE_GRACE_MS);
          } catch (err) {
            opts.onError?.('dayClose.overdue', r.property_id, err);
          }
        }
      },
    },
  ];
}

/** Event consumers of day-close (bound in the composition root). */
export function dayCloseSubscriptions(): TxEventSubscription[] {
  return [{ consumer: 'dayClose.stayWatch', types: [...DAY_CLOSE_CONSUMES], handle: onStayEvent }];
}
