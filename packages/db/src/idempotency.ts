import {
  actorId,
  canonicalJson,
  DomainError,
  IdempotencyConflictError,
  type RequestContext,
  sha256Hex,
} from '@portico/kernel';
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
 * How a response is kept for replay WITHOUT storing personal data (idempotency records outlive erasure requests).
 * `store` reduces the response to what a replay needs — ids and status, never names, contacts or free text — and
 * `rebuild` re-reads the current record on replay, inside the replaying caller's transaction, so a replay honours
 * erasure, later changes and the caller's current permissions. Use it for every endpoint whose response contains
 * personal data.
 */
export interface ReplayPlan<T, S> {
  store(body: T): S;
  rebuild(tx: TxContext, stored: S): Promise<T>;
}

/** Stored form of a replay-plan response. */
interface StoredRef {
  $replay: 1;
  ref: unknown;
}
/** Stored form of a response erased because it referenced an erased data subject. */
interface StoredErased {
  $erased: true;
}

function isStoredRef(v: unknown): v is StoredRef {
  return typeof v === 'object' && v !== null && (v as { $replay?: unknown }).$replay === 1;
}
function isStoredErased(v: unknown): v is StoredErased {
  return typeof v === 'object' && v !== null && (v as { $erased?: unknown }).$erased === true;
}

export class IdempotentResponseErasedError extends DomainError {
  constructor() {
    super(
      'idempotent_response_erased',
      'The stored result of this request was removed because it referred to a person whose data has since been erased. The request is not repeated; look up the current state of the record instead.',
      { status: 410 },
    );
  }
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
export async function runIdempotent<T, S = unknown>(
  database: PorticoDatabase,
  ctx: RequestContext,
  idem: { scope: string; key: string; request: unknown },
  fn: (tx: TxContext) => Promise<{ status: number; body: T }>,
  opts?: TxOptions & { replay?: ReplayPlan<T, S> },
): Promise<IdempotentResult<T>> {
  if (!idem.key || idem.key.length > 200) {
    throw new IdempotencyConflictError('Idempotency-Key must be between 1 and 200 characters.');
  }
  const requestHash = sha256Hex(canonicalJson(idem.request ?? null));
  const actorKey = `${ctx.actor.kind}:${actorId(ctx.actor)}`;
  return withTenantTx(
    database,
    ctx,
    async (tx) => {
      const inserted = await tx.db
        .insertInto('core.idempotency_keys')
        .values({
          tenant_id: ctx.tenantId,
          scope: idem.scope,
          key: idem.key,
          request_hash: requestHash,
          actor_key: actorKey,
        })
        .onConflict((oc) => oc.doNothing())
        .returning('key')
        .executeTakeFirst();

      if (!inserted) {
        // FOR SHARE: a replay racing an erasure that is redacting this row waits for it, then sees the redaction.
        const existing = await tx.db
          .selectFrom('core.idempotency_keys')
          .select(['request_hash', 'response_status', 'response_body', 'actor_key'])
          .where('tenant_id', '=', ctx.tenantId)
          .where('scope', '=', idem.scope)
          .where('key', '=', idem.key)
          .forShare()
          .executeTakeFirstOrThrow();
        if (existing.actor_key && existing.actor_key !== actorKey) {
          throw new IdempotencyConflictError(
            'This Idempotency-Key was used by a different user or integration. Use a new key for your request.',
          );
        }
        const stored: unknown = existing.response_body;
        // Checked before the request hash: once erased, every body answers 410, so the stored hash cannot be used
        // to confirm a guess of the erased person's data (409 vs 410).
        if (isStoredErased(stored)) throw new IdempotentResponseErasedError();
        if (existing.request_hash !== requestHash) {
          throw new IdempotencyConflictError(
            'This Idempotency-Key was already used for a different request. Use a new key for a new request.',
          );
        }
        if (isStoredRef(stored)) {
          if (!opts?.replay) {
            throw new DomainError(
              'idempotent_replay_unavailable',
              'This request was recorded with a replay plan that this endpoint no longer provides. Look up the current state of the record instead of retrying.',
              { status: 409 },
            );
          }
          return {
            status: existing.response_status as number,
            body: await opts.replay.rebuild(tx, stored.ref as S),
            replayed: true,
          };
        }
        return {
          status: existing.response_status as number,
          body: stored as T,
          replayed: true,
        };
      }

      const result = await fn(tx);
      const toStore: unknown = opts?.replay
        ? ({ $replay: 1, ref: opts.replay.store(result.body) } satisfies StoredRef)
        : (result.body ?? null);
      await tx.db
        .updateTable('core.idempotency_keys')
        .set({
          response_status: result.status,
          response_body: JSON.stringify(toStore),
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

/**
 * Erasure support: replace every stored response of this organization that CONTAINS one of the given identifiers
 * as a whole JSON string value with an erased marker; a later replay answers 410 instead of returning personal data.
 *
 * `identifiers` MUST identify the data subject exactly — profile ids, normalized emails, E.164 phone numbers.
 * Never free text (names, addresses, notes) and never numbers as typed: matching is on whole string values
 * (case-insensitive), not substrings, so "Maldives" cannot hit "Indian/Maldives" and "+9607771234" cannot hit
 * "+96077712345" or the number 17771234. Values shorter than 6 characters are ignored.
 * `keep`: identifiers of OTHER subjects whose records must stay (e.g. a guest on legal hold who shares an email):
 * a response containing any of them is not touched. Returns the number of records redacted.
 */
export async function redactIdempotencyResponses(
  tx: TxContext,
  input: { identifiers: readonly string[]; keep?: readonly string[] },
): Promise<number> {
  const ids = [...new Set(input.identifiers.map((m) => m.toLowerCase()).filter((m) => m.length >= 6))];
  if (ids.length === 0) return 0;
  const keep = [...new Set((input.keep ?? []).map((m) => m.toLowerCase()))];
  const { rows } = await sql<{ n: number }>`
    with hit as (
      update core.idempotency_keys k
         set response_body = '{"$erased": true}'::jsonb,
             request_hash = 'erased'
       where k.tenant_id = ${tx.tenantId}
         and k.response_body is not null
         and not (k.response_body ? '$erased')
         -- cheap pre-filter, then the exact whole-value test decides
         and exists (select 1 from unnest(${ids}::text[]) m where position(m in lower(k.response_body::text)) > 0)
         and exists (
           select 1 from jsonb_path_query(k.response_body, 'lax $.** ? (@.type() == "string")') v
           where lower(v #>> '{}') = any(${ids}::text[]))
         and not exists (
           select 1 from jsonb_path_query(k.response_body, 'lax $.** ? (@.type() == "string")') v
           where lower(v #>> '{}') = any(${keep}::text[]))
      returning 1)
    select count(*)::int as n from hit`.execute(tx.db);
  return rows[0]?.n ?? 0;
}
