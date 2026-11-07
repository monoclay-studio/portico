import { type ScheduledJob, sql } from '@portico/db';
import { newId, systemContext, type TenantEnvironment } from '@portico/kernel';
import type { DayCloseService } from './service';

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
  ];
}
