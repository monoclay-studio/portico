import {
  type DomainEvent,
  type EventSubscription,
  type RequestContext,
  systemAuthorizer,
  type TenantEnvironment,
} from '@portico/kernel';
import { sql } from 'kysely';
import type { PorticoDatabase } from './database';
import { type TxContext, withTenantTx } from './tx';

/**
 * A consumer handler runs INSIDE a tenant transaction; marking the delivery done happens in the same
 * transaction, so a handler's database effects are applied exactly once even if the worker crashes.
 */
export interface TxEventSubscription extends Omit<EventSubscription, 'handle'> {
  handle(tx: TxContext, event: DomainEvent): Promise<void>;
}

export interface DispatcherOptions {
  subscriptions: readonly TxEventSubscription[];
  /** Resolve a tenant's environment so consumers inherit environment safety rules. */
  environmentOf: (tenantId: string) => Promise<TenantEnvironment>;
  batchSize?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
  onError?: (err: unknown, delivery: { eventId: string; consumer: string }) => void;
}

function matches(sub: { types: string[] }, type: string): boolean {
  return sub.types.some(
    (t) => t === type || t === '*' || (t.endsWith('.*') && type.startsWith(t.slice(0, -1))),
  );
}

/** Assign new outbox events to their consumers. Returns the number of events fanned out. */
export async function fanOut(database: PorticoDatabase, opts: DispatcherOptions): Promise<number> {
  return database.kysely.transaction().execute(async (trx) => {
    const { rows } = await sql<{ id: string; tenant_id: string; type: string }>`
      select * from core.claim_unfanned_events(${opts.batchSize ?? 200})`.execute(trx);
    for (const e of rows) {
      const consumers = opts.subscriptions.filter((s) => matches(s, e.type)).map((s) => s.consumer);
      await sql`select core.record_fanout(${e.id}::uuid, ${consumers}::text[])`.execute(trx);
    }
    return rows.length;
  });
}

/** Claim due deliveries and run their handlers. Returns the number of deliveries attempted. */
export async function processDeliveries(database: PorticoDatabase, opts: DispatcherOptions): Promise<number> {
  const { rows } = await sql<{ event_id: string; consumer: string; tenant_id: string; attempts: number }>`
    select * from core.claim_deliveries(${opts.batchSize ?? 50}, ${opts.leaseSeconds ?? 60})`.execute(
    database.kysely,
  );
  const byConsumer = new Map(opts.subscriptions.map((s) => [s.consumer, s]));
  for (const d of rows) {
    const sub = byConsumer.get(d.consumer);
    const environment = await opts.environmentOf(d.tenant_id);
    const ctx: RequestContext = {
      tenantId: d.tenant_id,
      environment,
      actor: { kind: 'system', process: `consumer:${d.consumer}` },
      authz: systemAuthorizer,
      correlationId: d.event_id,
    };
    try {
      await withTenantTx(database, ctx, async (tx) => {
        const row = await tx.db
          .selectFrom('core.outbox')
          .selectAll()
          .where('id', '=', d.event_id)
          .executeTakeFirstOrThrow();
        const event: DomainEvent = {
          id: row.id,
          type: row.type,
          tenantId: row.tenant_id,
          propertyId: row.property_id,
          aggregate: { type: row.aggregate_type, id: row.aggregate_id },
          occurredAt: new Date(row.occurred_at).toISOString(),
          actor: row.actor,
          correlationId: row.correlation_id,
          version: row.version,
          payload: row.payload,
        };
        if (sub) await sub.handle(tx, event);
        await tx.db
          .updateTable('core.event_deliveries')
          .set({ status: 'done', processed_at: sql`clock_timestamp()`, locked_until: null, last_error: null })
          .where('event_id', '=', d.event_id)
          .where('consumer', '=', d.consumer)
          .execute();
      });
    } catch (err) {
      opts.onError?.(err, { eventId: d.event_id, consumer: d.consumer });
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      await sql`select core.record_delivery_failure(${d.event_id}::uuid, ${d.consumer}, ${message}, ${opts.maxAttempts ?? 12})`.execute(
        database.kysely,
      );
    }
  }
  return rows.length;
}

/** Process everything currently pending (tests and scenario harness). Bounded to avoid infinite loops. */
export async function drainOutbox(
  database: PorticoDatabase,
  opts: DispatcherOptions,
  maxRounds = 50,
): Promise<void> {
  for (let i = 0; i < maxRounds; i++) {
    const fanned = await fanOut(database, opts);
    const processed = await processDeliveries(database, opts);
    if (fanned === 0 && processed === 0) return;
  }
  throw new Error(
    'drainOutbox: events kept being produced after many rounds (possible event loop between consumers)',
  );
}
