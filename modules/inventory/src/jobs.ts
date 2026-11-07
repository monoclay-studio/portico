import { type PorticoDatabase, type ScheduledJob, sql, withTenantTx } from '@portico/db';
import { newId, systemContext, type TenantEnvironment } from '@portico/kernel';
import type { InventoryService } from './service';

const BATCH = 200;

/**
 * Periodic jobs contributed by inventory (registered in Composition.jobs, run by apps/worker):
 *  - inventory.expireHolds (every 60 s, INV-R16): releases expired holds in every organization that has some and
 *    emits `inventory.hold.expired` once per hold. Lazy expiry inside commands already guarantees an expired hold
 *    never blocks a sale; this keeps the grid tidy and the events prompt.
 */
export function createInventoryJobs(inventory: InventoryService): ScheduledJob[] {
  return [
    {
      name: 'inventory.expireHolds',
      intervalSeconds: 60,
      async run(database: PorticoDatabase, now: Date) {
        const { rows } = await sql<{ tenant_id: string }>`
          select tenant_id from inventory.tenants_with_expired_holds(${now}, 500)`.execute(database.kysely);
        for (const { tenant_id: tenantId } of rows) {
          const env = await sql<{ e: TenantEnvironment | null }>`
            select platform.tenant_environment(${tenantId}::uuid) as e`.execute(database.kysely);
          const environment = env.rows[0]?.e;
          if (!environment) continue; // closed or unknown organization
          const ctx = systemContext(tenantId, 'inventory.expireHolds', environment, newId());
          for (let i = 0; i < 50; i++) {
            const { expired } = await withTenantTx(database, ctx, (tx) =>
              inventory.expireDueHolds(tx, { limit: BATCH }),
            );
            if (expired < BATCH) break;
          }
        }
      },
    },
  ];
}
