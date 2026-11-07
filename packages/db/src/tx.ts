import { actorId, type DomainEvent, type EmitEventInput, newId, type RequestContext } from '@portico/kernel';
import { sql, type Transaction } from 'kysely';
import type { AnyDB, PorticoDatabase } from './database';

export interface AuditEntry {
  action: string; // e.g. 'reservations.stay.checkIn'
  target: { type: string; id: string };
  propertyId?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

/** Everything a command needs: identity, tenant, the open transaction, outbox, audit and a stable clock. */
export interface TxContext extends RequestContext {
  readonly db: Transaction<AnyDB>;
  /** Fixed for the whole transaction so all records share one timestamp. */
  readonly now: Date;
  emit<T extends Record<string, unknown>>(event: EmitEventInput<T>): Promise<DomainEvent<T>>;
  audit(entry: AuditEntry): Promise<void>;
  /** Run after a successful commit (never on rollback). For non-critical notifications only. */
  afterCommit(fn: () => Promise<void> | void): void;
}

export type IsolationLevel = 'read committed' | 'repeatable read' | 'serializable';

export interface TxOptions {
  isolation?: IsolationLevel;
  /** Retries on serialization failure / deadlock. The callback must be free of non-DB side effects. */
  retries?: number;
}

const RETRYABLE_SQLSTATES = new Set(['40001', '40P01']);

function sqlState(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

/**
 * Run `fn` inside one database transaction bound to the context's tenant. Row Level Security makes every
 * other tenant's rows invisible to the statements in `fn`, regardless of application bugs.
 */
export async function withTenantTx<T>(
  database: PorticoDatabase,
  ctx: RequestContext,
  fn: (tx: TxContext) => Promise<T>,
  opts: TxOptions = {},
): Promise<T> {
  const maxAttempts = 1 + (opts.retries ?? 2);
  for (let attempt = 1; ; attempt++) {
    const after: Array<() => Promise<void> | void> = [];
    try {
      const result = await database.kysely
        .transaction()
        .setIsolationLevel(opts.isolation ?? 'read committed')
        .execute(async (trx) => {
          await sql`select set_config('app.tenant_id', ${ctx.tenantId}, true),
                           set_config('app.actor', ${actorId(ctx.actor)}, true),
                           set_config('app.correlation_id', ${ctx.correlationId}, true)`.execute(trx);
          const tx = createTxContext(database, ctx, trx, after);
          return fn(tx);
        });
      for (const hook of after) {
        try {
          await hook();
        } catch (err) {
          console.error('afterCommit hook failed', err);
        }
      }
      return result;
    } catch (err) {
      const state = sqlState(err);
      if (state && RETRYABLE_SQLSTATES.has(state) && attempt < maxAttempts) continue;
      throw err;
    }
  }
}

function createTxContext(
  database: PorticoDatabase,
  ctx: RequestContext,
  trx: Transaction<AnyDB>,
  after: Array<() => Promise<void> | void>,
): TxContext {
  const now = database.clock.now();
  return {
    ...ctx,
    db: trx,
    now,
    async emit<T extends Record<string, unknown>>(input: EmitEventInput<T>): Promise<DomainEvent<T>> {
      const event: DomainEvent<T> = {
        id: newId(now.getTime()),
        type: input.type,
        tenantId: ctx.tenantId,
        propertyId: input.propertyId ?? null,
        aggregate: input.aggregate,
        occurredAt: now.toISOString(),
        actor: ctx.actor,
        correlationId: ctx.correlationId,
        version: input.version ?? 1,
        payload: input.payload,
      };
      await trx
        .insertInto('core.outbox')
        .values({
          id: event.id,
          tenant_id: event.tenantId,
          type: event.type,
          property_id: event.propertyId,
          aggregate_type: event.aggregate.type,
          aggregate_id: event.aggregate.id,
          payload: JSON.stringify(event.payload),
          actor: JSON.stringify(event.actor),
          correlation_id: event.correlationId,
          version: event.version,
          occurred_at: now,
        })
        .execute();
      return event;
    },
    async audit(entry: AuditEntry): Promise<void> {
      await trx
        .insertInto('core.audit_log')
        .values({
          id: newId(now.getTime()),
          tenant_id: ctx.tenantId,
          property_id: entry.propertyId ?? null,
          occurred_at: now,
          actor: JSON.stringify(ctx.actor),
          actor_key: `${ctx.actor.kind}:${actorId(ctx.actor)}`,
          action: entry.action,
          target_type: entry.target.type,
          target_id: entry.target.id,
          reason: entry.reason ?? null,
          before: entry.before === undefined ? null : JSON.stringify(entry.before),
          after: entry.after === undefined ? null : JSON.stringify(entry.after),
          metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
          correlation_id: ctx.correlationId,
        })
        .execute();
    },
    afterCommit(fn) {
      after.push(fn);
    },
  };
}
