import { canonicalJson, IdempotencyConflictError, type RequestContext, sha256Hex } from '@portico/kernel';
import { sql } from 'kysely';
import type { PorticoDatabase } from './database';
import { type TxContext, type TxOptions, withTenantTx } from './tx';

export interface IdempotentResult<T> {
  status: number;
  body: T;
  /** True when this is a stored response from an earlier identical request. */
  replayed: boolean;
}

/**
 * Exactly-once command execution for retried requests.
 *
 * The idempotency record is written in the SAME transaction as the command's effects:
 *  - first request: row inserted (uncommitted), command runs, response stored, all committed together;
 *  - concurrent duplicate: blocks on the row until the first commits, then replays its stored response;
 *  - if the first request fails/rolls back, the row disappears and a retry executes normally.
 * A key reused with a different request body is rejected.
 */
export async function runIdempotent<T>(
  database: PorticoDatabase,
  ctx: RequestContext,
  idem: { scope: string; key: string; request: unknown },
  fn: (tx: TxContext) => Promise<{ status: number; body: T }>,
  opts?: TxOptions,
): Promise<IdempotentResult<T>> {
  if (!idem.key || idem.key.length > 200) {
    throw new IdempotencyConflictError('Idempotency-Key must be between 1 and 200 characters.');
  }
  const requestHash = sha256Hex(canonicalJson(idem.request ?? null));
  return withTenantTx(
    database,
    ctx,
    async (tx) => {
      const inserted = await tx.db
        .insertInto('core.idempotency_keys')
        .values({ tenant_id: ctx.tenantId, scope: idem.scope, key: idem.key, request_hash: requestHash })
        .onConflict((oc) => oc.doNothing())
        .returning('key')
        .executeTakeFirst();

      if (!inserted) {
        const existing = await tx.db
          .selectFrom('core.idempotency_keys')
          .select(['request_hash', 'response_status', 'response_body'])
          .where('tenant_id', '=', ctx.tenantId)
          .where('scope', '=', idem.scope)
          .where('key', '=', idem.key)
          .executeTakeFirstOrThrow();
        if (existing.request_hash !== requestHash) {
          throw new IdempotencyConflictError(
            'This Idempotency-Key was already used for a different request. Use a new key for a new request.',
          );
        }
        return {
          status: existing.response_status as number,
          body: existing.response_body as T,
          replayed: true,
        };
      }

      const result = await fn(tx);
      await tx.db
        .updateTable('core.idempotency_keys')
        .set({
          response_status: result.status,
          response_body: JSON.stringify(result.body ?? null),
          completed_at: sql`clock_timestamp()`,
        })
        .where('tenant_id', '=', ctx.tenantId)
        .where('scope', '=', idem.scope)
        .where('key', '=', idem.key)
        .execute();
      return { ...result, replayed: false };
    },
    opts,
  );
}
