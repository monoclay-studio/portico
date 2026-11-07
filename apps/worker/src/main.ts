/**
 * Background worker: outbox fan-out and delivery to event consumers (and, later, schedulers such as
 * Day Close and channel sync). Safe to run several replicas: claims use SKIP LOCKED leases.
 */
import { compose, loadConfig } from '@portico/api';
import {
  createDatabase,
  type DispatcherOptions,
  fanOut,
  processDeliveries,
  runDueJobs,
  sql,
} from '@portico/db';
import type { TenantEnvironment } from '@portico/kernel';

const config = loadConfig();
const database = createDatabase({
  connectionString: config.APP_DATABASE_URL,
  max: 10,
  applicationName: 'portico-worker',
});
const { subscriptions, jobs } = compose(database);

const environmentCache = new Map<string, { env: TenantEnvironment; at: number }>();
const options: DispatcherOptions = {
  subscriptions,
  environmentOf: async (tenantId) => {
    const hit = environmentCache.get(tenantId);
    if (hit && Date.now() - hit.at < 60_000) return hit.env;
    const { rows } = await sql<{
      e: TenantEnvironment;
    }>`select platform.tenant_environment(${tenantId}::uuid) as e`.execute(database.kysely);
    const env = rows[0]?.e ?? 'demo';
    environmentCache.set(tenantId, { env, at: Date.now() });
    return env;
  },
  onError: (err, d) =>
    console.error(JSON.stringify({ level: 'error', msg: 'event delivery failed', ...d, err: String(err) })),
};

let running = true;
process.on('SIGTERM', () => {
  running = false;
});
process.on('SIGINT', () => {
  running = false;
});

console.log(
  JSON.stringify({ level: 'info', msg: 'worker started', consumers: subscriptions.map((s) => s.consumer) }),
);
while (running) {
  try {
    const fanned = await fanOut(database, options);
    const processed = await processDeliveries(database, options);
    await runDueJobs(database, jobs, (job, err) =>
      console.error(JSON.stringify({ level: 'error', msg: 'job failed', job, err: String(err) })),
    );
    if (fanned === 0 && processed === 0) await new Promise((r) => setTimeout(r, 500));
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'worker loop error', err: String(err) }));
    await new Promise((r) => setTimeout(r, 2000));
  }
}
await database.close();
