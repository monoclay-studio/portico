/**
 * Background work per organization: periodic syncs, outbound dispatch, webhook delivery, credential expiry
 * reminders and health refresh. Organizations with due work are found through the scheduler index
 * (`integration.claim_due_tenants`, routing metadata only); all work then runs inside the tenant's own
 * RLS-scoped transactions with the tenant's environment (so environment safety applies to background jobs too).
 */
import { type PorticoDatabase, type ScheduledJob, sql, withTenantTx } from '@portico/db';
import { newId, type RequestContext, systemContext, type TenantEnvironment } from '@portico/kernel';
import type { ConnectionState } from '../contracts';
import { isOperational } from '../domain/setup-journey';
import { db, type IntegrationDeps, registered } from './common';
import { dispatchOutbound, runSync } from './exchange';
import { checkCredentialExpiry, refreshHealth } from './health';
import { applyRetention } from './retention';
import { deliverDueWebhooks } from './webhooks';

export interface TenantWorkResult {
  syncs: number;
  dispatched: number;
  webhooks: number;
  errors: string[];
  nextDueAt: string;
}

const HEALTH_INTERVAL_MS = 15 * 60_000;

export async function runTenantWork(
  database: PorticoDatabase,
  deps: IntegrationDeps,
  ctx: RequestContext,
): Promise<TenantWorkResult> {
  const res: TenantWorkResult = { syncs: 0, dispatched: 0, webhooks: 0, errors: [], nextDueAt: '' };
  const connections = await withTenantTx(database, ctx, (tx) =>
    db(tx).selectFrom('integration.connections').selectAll().where('state', '<>', 'disconnected').execute(),
  );
  const now = database.clock.now();
  for (const c of connections) {
    const def = registered(deps, c.connector_key).definition;
    if (!isOperational(c.state as ConnectionState)) continue;
    if (!def.fileBased && c.next_sync_at && new Date(c.next_sync_at) <= now) {
      try {
        await runSync(database, deps, ctx, c.id, { trigger: 'periodic' });
        res.syncs++;
      } catch (err) {
        res.errors.push(`sync ${c.id}: ${err instanceof Error ? err.message : String(err)}`);
        await withTenantTx(database, ctx, (tx) =>
          db(tx)
            .updateTable('integration.connections')
            .set({ next_sync_at: new Date(tx.now.getTime() + 300_000) })
            .where('id', '=', c.id)
            .execute(),
        );
      }
    }
    try {
      const d = await dispatchOutbound(database, deps, ctx, c.id);
      res.dispatched += d.attempted;
    } catch (err) {
      res.errors.push(`dispatch ${c.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  try {
    res.webhooks = (await deliverDueWebhooks(database, deps, ctx)).attempted;
  } catch (err) {
    res.errors.push(`webhooks: ${err instanceof Error ? err.message : String(err)}`);
  }
  const next = await withTenantTx(database, ctx, async (tx) => {
    await applyRetention(tx);
    for (const c of await db(tx)
      .selectFrom('integration.connections')
      .selectAll()
      .where('state', '<>', 'disconnected')
      .execute()) {
      await checkCredentialExpiry(tx, c);
      await refreshHealth(tx, deps, c);
    }
    const candidates: Date[] = [new Date(tx.now.getTime() + HEALTH_INTERVAL_MS)];
    const sync = await db(tx)
      .selectFrom('integration.connections')
      .select(sql<Date | null>`min(next_sync_at)`.as('at'))
      .where('state', 'in', ['active', 'monitoring'])
      .executeTakeFirst();
    const outbound = await db(tx)
      .selectFrom('integration.outbound_commands')
      .select(sql<Date | null>`min(next_attempt_at)`.as('at'))
      .where('status', 'in', ['queued', 'pending_verification'])
      .executeTakeFirst();
    const hooks = await db(tx)
      .selectFrom('integration.webhook_deliveries')
      .select(sql<Date | null>`min(next_attempt_at)`.as('at'))
      .where('status', 'in', ['pending', 'failed'])
      .executeTakeFirst();
    for (const r of [sync, outbound, hooks]) if (r?.at) candidates.push(new Date(r.at));
    const nextDue = new Date(
      Math.max(tx.now.getTime() + 1000, Math.min(...candidates.map((d) => d.getTime()))),
    );
    await sql`insert into integration.tenant_schedule (tenant_id, next_due_at, lease_until)
              values (${tx.tenantId}::uuid, ${nextDue}, null)
              on conflict (tenant_id) do update set next_due_at = excluded.next_due_at, lease_until = null`.execute(
      tx.db,
    );
    return nextDue;
  });
  res.nextDueAt = next.toISOString();
  return res;
}

/**
 * Scheduled job for apps/worker (`ScheduledJob` from @portico/db, run once per interval across replicas):
 * claims organizations with due integration work through the scheduler index and runs it in each organization's
 * own context and environment.
 */
export function integrationJobs(
  deps: IntegrationDeps,
  opts: { batch?: number; onError?: (tenantId: string, err: unknown) => void } = {},
): ScheduledJob[] {
  return [
    {
      name: 'integration.dueWork',
      intervalSeconds: 10,
      leaseSeconds: 300,
      async run(database) {
        const { rows } = await sql<{ tenant_id: string; environment: TenantEnvironment | null }>`
          select d.tenant_id, platform.tenant_environment(d.tenant_id) as environment
            from integration.claim_due_tenants(${opts.batch ?? 20}, 300) d`.execute(database.kysely);
        for (const r of rows) {
          if (!r.environment) continue; // closed organization
          try {
            await runTenantWork(
              database,
              deps,
              systemContext(r.tenant_id, 'integration-scheduler', r.environment, newId()),
            );
          } catch (err) {
            opts.onError?.(r.tenant_id, err);
          }
        }
      },
    },
  ];
}
