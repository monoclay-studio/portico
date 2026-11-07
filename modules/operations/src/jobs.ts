import { type PorticoDatabase, type ScheduledJob, sql, withTenantTx } from '@portico/db';
import { newId, systemContext, type TenantEnvironment } from '@portico/kernel';
import type { OperationsPorts } from './ports';
import { createOperationsService } from './service';

async function jobProperties(database: PorticoDatabase) {
  const { rows } = await sql<{ tenant_id: string; property_id: string; environment: string | null }>`
    select p.tenant_id, p.property_id, platform.tenant_environment(p.tenant_id) as environment
      from operations.job_properties() p`.execute(database.kysely);
  // Closed organizations have no environment any more: nothing to do for them.
  return rows.filter((r) => r.environment !== null);
}

/**
 * Periodic operations jobs (registered in the composition root, run by apps/worker via runDueJobs):
 *  - SLA escalation + DND welfare checks every minute;
 *  - preventive-maintenance work-order generation hourly (each property's own business date decides what is due).
 * Each property is processed in its own tenant transaction with a system context; one property failing never
 * blocks the others (the error is reported and retried on the next run).
 */
export function operationsJobs(
  ports: OperationsPorts,
  opts: { onError?: (job: string, propertyId: string, err: unknown) => void } = {},
): ScheduledJob[] {
  const ops = createOperationsService(ports);
  const perProperty =
    (
      name: string,
      fn: (tx: Parameters<typeof ops.runEscalations>[0], propertyId: string) => Promise<unknown>,
    ) =>
    async (database: PorticoDatabase) => {
      for (const p of await jobProperties(database)) {
        const ctx = systemContext(p.tenant_id, name, p.environment as TenantEnvironment, newId());
        try {
          await withTenantTx(database, ctx, (tx) => fn(tx, p.property_id));
        } catch (err) {
          opts.onError?.(name, p.property_id, err);
        }
      }
    };
  return [
    {
      name: 'operations.escalations',
      intervalSeconds: 60,
      run: perProperty('operations.escalations', (tx, propertyId) => ops.runEscalations(tx, propertyId)),
    },
    {
      name: 'operations.preventiveMaintenance',
      intervalSeconds: 3600,
      run: perProperty('operations.preventiveMaintenance', (tx, propertyId) =>
        ops.runPreventiveSchedules(tx, propertyId, undefined),
      ),
    },
  ];
}
