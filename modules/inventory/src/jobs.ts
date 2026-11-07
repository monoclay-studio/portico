import { type PorticoDatabase, type ScheduledJob, sql, withTenantTx } from '@portico/db';
import { addDays, newId, systemContext, type TenantEnvironment } from '@portico/kernel';
import type { InventoryService } from './service';

const BATCH = 200;

async function forEachTenant(
  database: PorticoDatabase,
  tenantIds: readonly string[],
  process: string,
  fn: (ctx: ReturnType<typeof systemContext>) => Promise<void>,
): Promise<void> {
  for (const tenantId of tenantIds) {
    const env = await sql<{ e: TenantEnvironment | null }>`
      select platform.tenant_environment(${tenantId}::uuid) as e`.execute(database.kysely);
    const environment = env.rows[0]?.e;
    if (!environment) continue; // closed or unknown organization
    await fn(systemContext(tenantId, process, environment, newId()));
  }
}

/**
 * Periodic jobs contributed by inventory (registered in Composition.jobs, run by apps/worker). Organizations with
 * work are found through reviewed SECURITY DEFINER routing functions that return tenant ids only; all work then
 * happens inside each organization's RLS-scoped transaction with a system context.
 *  - inventory.expireDue (60 s): releases expired holds (INV-R16, `inventory.hold.expired` once per hold) and lapsed
 *    overbooking allowances, opening conflicts for nights left sold beyond authorization (INV-I03).
 *  - inventory.checkLedger (hourly): INV-I02 consistency check from yesterday on; discrepancies are reported, never
 *    auto-corrected.
 */
export function createInventoryJobs(inventory: InventoryService): ScheduledJob[] {
  return [
    {
      name: 'inventory.expireDue',
      intervalSeconds: 60,
      async run(database, now) {
        const { rows } = await sql<{ tenant_id: string }>`
          select tenant_id from inventory.tenants_with_due_expiries(${now}, 500)`.execute(database.kysely);
        await forEachTenant(
          database,
          rows.map((r) => r.tenant_id),
          'inventory.expireDue',
          async (ctx) => {
            for (let i = 0; i < 50; i++) {
              const { expired } = await withTenantTx(database, ctx, (tx) =>
                inventory.expireDueHolds(tx, { limit: BATCH }),
              );
              if (expired < BATCH) break;
            }
            for (let i = 0; i < 50; i++) {
              const { expired } = await withTenantTx(database, ctx, (tx) =>
                inventory.expireDueAllowances(tx, { limit: BATCH }),
              );
              if (expired < BATCH) break;
            }
          },
        );
      },
    },
    {
      name: 'inventory.checkLedger',
      intervalSeconds: 3600,
      async run(database, now) {
        const fromNight = addDays(now.toISOString().slice(0, 10), -1);
        const { rows } = await sql<{ tenant_id: string }>`
          select tenant_id from inventory.tenants_with_ledger_since(${fromNight}::date, 5000)`.execute(
          database.kysely,
        );
        await forEachTenant(
          database,
          rows.map((r) => r.tenant_id),
          'inventory.checkLedger',
          async (ctx) => {
            await withTenantTx(database, ctx, (tx) => inventory.checkLedgerConsistency(tx, { fromNight }));
          },
        );
      },
    },
  ];
}
