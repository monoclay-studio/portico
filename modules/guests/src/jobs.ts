/**
 * Scheduled jobs (apps/worker via Composition.jobs): identity-document retention purge (GUE-R19) and the nightly
 * duplicate scan (GUE-R10). Tenants are discovered through the module's reviewed SECURITY DEFINER functions
 * (tenant ids only); all work then runs inside each tenant's RLS-scoped transaction with a system context.
 */
import { type PorticoDatabase, type ScheduledJob, sql, withTenantTx } from '@portico/db';
import { newId, systemContext, type TenantEnvironment } from '@portico/kernel';
import type { GuestsService } from './service';

async function environmentOf(database: PorticoDatabase, tenantId: string): Promise<TenantEnvironment | null> {
  const { rows } = await sql<{ environment: string | null }>`
    select platform.tenant_environment(${tenantId}::uuid) as environment`.execute(database.kysely);
  return (rows[0]?.environment as TenantEnvironment | null | undefined) ?? null;
}

export function guestsJobs(service: GuestsService): ScheduledJob[] {
  return [
    {
      name: 'guests.purgeExpiredDocuments',
      intervalSeconds: 24 * 3600,
      async run(database, now) {
        const asOf = now.toISOString().slice(0, 10);
        const { rows } = await sql<{ tenant_id: string }>`
          select tenant_id from guests.tenants_with_expired_documents(${asOf}::date)`.execute(
          database.kysely,
        );
        for (const { tenant_id } of rows) {
          const environment = await environmentOf(database, tenant_id);
          if (!environment) continue; // closed organization
          const ctx = systemContext(tenant_id, 'guests.purgeExpiredDocuments', environment, newId());
          await withTenantTx(database, ctx, (tx) => service.purgeExpiredDocuments(tx, { asOf }));
        }
      },
    },
    {
      name: 'guests.scanDuplicates',
      intervalSeconds: 24 * 3600,
      leaseSeconds: 6 * 3600,
      async run(database) {
        const { rows } = await sql<{ tenant_id: string }>`
          select tenant_id from guests.tenants_with_active_profiles()`.execute(database.kysely);
        for (const { tenant_id } of rows) {
          const environment = await environmentOf(database, tenant_id);
          if (!environment) continue;
          // One short transaction per batch (cursor), so a large organization never holds a long transaction.
          let afterId: string | undefined;
          for (let i = 0; i < 10_000; i++) {
            const ctx = systemContext(tenant_id, 'guests.scanDuplicates', environment, newId());
            const res = await withTenantTx(database, ctx, (tx) =>
              service.scanDuplicates(tx, { batch: 200, ...(afterId ? { afterId } : {}) }),
            );
            if (!res.nextAfterId) break;
            afterId = res.nextAfterId;
          }
        }
      },
    },
  ];
}
