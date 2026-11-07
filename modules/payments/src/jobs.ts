/**
 * Periodic payments jobs (run by apps/worker through `runDueJobs`, claimed once per interval across replicas):
 *  - reconcile: verify pending outcomes by provider lookup (never re-send), retry ledger postings, expire holds and
 *    requests, warn about holds about to expire, create pending payment links, escalate what stays unresolved;
 *  - virtual cards: charge OTA virtual cards whose activation date has arrived (property-local), with retries.
 * Tenants are found through the reviewed SECURITY DEFINER `payments.tenants_for_jobs()` (routing metadata only);
 * all work then runs inside tenant transactions with a system context.
 */
import { type PorticoDatabase, type ScheduledJob, sql } from '@portico/db';
import { newId, systemContext, type TenantEnvironment } from '@portico/kernel';
import type { PaymentsService } from './service';

async function tenants(database: PorticoDatabase) {
  const { rows } = await sql<{ tenant_id: string; environment: TenantEnvironment }>`
    select tenant_id, environment from payments.tenants_for_jobs()`.execute(database.kysely);
  return rows;
}

export function paymentsJobs(
  service: PaymentsService,
  opts: { onTenantError?: (job: string, tenantId: string, err: unknown) => void } = {},
): ScheduledJob[] {
  const forEachTenant =
    (job: string, fn: (ctx: ReturnType<typeof systemContext>) => Promise<unknown>) =>
    async (database: PorticoDatabase) => {
      for (const t of await tenants(database)) {
        try {
          await fn(systemContext(t.tenant_id, job, t.environment, newId()));
        } catch (err) {
          // One organization's failure never blocks the others; the job reports it.
          opts.onTenantError?.(job, t.tenant_id, err);
        }
      }
    };
  return [
    {
      name: 'payments.reconcile',
      intervalSeconds: 60,
      run: forEachTenant('payments.reconcile', (ctx) => service.runReconciliation(ctx)),
    },
    {
      name: 'payments.chargeDueVirtualCards',
      intervalSeconds: 900,
      run: forEachTenant('payments.chargeDueVirtualCards', (ctx) => service.runDueVirtualCards(ctx)),
    },
  ];
}
