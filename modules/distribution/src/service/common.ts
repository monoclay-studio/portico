/** Shared helpers for distribution services: deps, loading, permissions, environment gating, scheduling, logs. */
import { type Selectable, sql, type TxContext, typed } from '@portico/db';
import {
  actorId,
  assertExternalEffectAllowed,
  DomainError,
  NotFoundError,
  newId,
  requirePermission,
  type TenantEnvironment,
} from '@portico/kernel';
import type { ChannexSimulatorHub } from '../adapters/channex/simulator-hub';
import type { HubAdapter, HubCallContext, HubMode } from '../adapters/hub';
import { type ConnectionSettings, connectionSettings, DEFAULT_SETTINGS } from '../contracts';
import type { DistributionPorts } from '../ports';
import type { ConnectionsTable, DistributionDB } from '../tables';

export interface DistributionConfig {
  /** Public base URL of the API (webhook callback URLs), e.g. https://api.portico.app. */
  publicApiBaseUrl: string;
  /** Hub calls stop waiting after this long (shorter than the lease, so a late answer never races a retry). */
  callDeadlineMs: number;
  /** A claimed send is owned by its sender for this long. */
  leaseMs: number;
  /**
   * The clock the ARI budget is accounted on (P2-2). `database`: the database's `clock_timestamp()`, read under the
   * budget row lock — ONE clock every worker shares, so a worker whose clock is ahead or behind can neither erase
   * nor double-spend slots. `transaction`: the transaction's clock (tests that simulate time with a fixed clock).
   */
  budgetClock: 'database' | 'transaction';
}

export const DEFAULT_CONFIG: DistributionConfig = {
  publicApiBaseUrl: 'http://localhost:4000',
  callDeadlineMs: 45_000,
  leaseMs: 60_000,
  budgetClock: 'database',
};

/** Now, on the budget's clock (call it while holding the budget row lock, so the instant is after the wait). */
export async function budgetNow(tx: TxContext, deps: Pick<DistributionDeps, 'config'>): Promise<Date> {
  if (deps.config.budgetClock === 'transaction') return tx.now;
  const r = await sql<{ now: Date }>`select clock_timestamp() as now`.execute(tx.db);
  return new Date(r.rows[0]?.now ?? tx.now);
}

export interface DistributionDeps {
  ports: DistributionPorts;
  hub: HubAdapter;
  simulator: ChannexSimulatorHub;
  config: DistributionConfig;
}

export const db = (tx: TxContext) => typed<DistributionDB>(tx.db);
export const json = (v: unknown) => JSON.stringify(v);
export type ConnectionRow = Selectable<ConnectionsTable>;

export function actorKey(tx: Pick<TxContext, 'actor'>): string {
  return `${tx.actor.kind}:${actorId(tx.actor)}`;
}

export const iso = (d: Date | string | null | undefined): string | null =>
  d === null || d === undefined ? null : new Date(d).toISOString();

export async function loadConnection(
  tx: TxContext,
  id: string,
  opts: { forUpdate?: boolean } = {},
): Promise<ConnectionRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError('channel_connection', id);
  let q = db(tx).selectFrom('distribution.connections').selectAll().where('id', '=', id);
  if (opts.forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw new NotFoundError('channel_connection', id);
  return row;
}

/** Permission on the connection's property (the record's own scope, never the caller's claim). */
export function requireOnConnection(
  tx: TxContext,
  conn: Pick<ConnectionRow, 'property_id'>,
  permission: string,
) {
  requirePermission(tx, permission, { propertyId: conn.property_id });
}

export function settingsOf(conn: Pick<ConnectionRow, 'settings'>): ConnectionSettings {
  const parsed = connectionSettings.safeParse(conn.settings ?? {});
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export function targetForEnvironment(env: TenantEnvironment): ConnectionRow['target'] {
  return env === 'live' ? 'production' : env === 'sandbox' ? 'staging' : 'simulator';
}

export function provenanceOfTarget(target: ConnectionRow['target']): 'live' | 'sandbox' | 'simulated' {
  return target === 'production' ? 'live' : target === 'staging' ? 'sandbox' : 'simulated';
}

const MODE_TARGET: Record<HubMode, ConnectionRow['target']> = {
  live: 'production',
  sandbox: 'staging',
  simulate: 'simulator',
};

/**
 * Environment safety (CLAUDE.md rule 12, ADR-0010), re-checked at EVERY hub call: the organization's environment
 * decides the mode, and the connection's recorded target must match it — a simulator connection never reaches a real
 * hub and a production connection is never used outside a live organization.
 */
export function hubModeFor(tx: Pick<TxContext, 'environment'>, conn: Pick<ConnectionRow, 'target'>): HubMode {
  const mode = assertExternalEffectAllowed(tx, 'channel.publish');
  if (MODE_TARGET[mode] !== conn.target) {
    throw new DomainError(
      'hub_target_not_allowed',
      `This connection points at the ${conn.target} hub, but a ${tx.environment} organization may only reach the ${MODE_TARGET[mode]}. Nothing was sent. Create a connection for the right environment.`,
      {
        status: 409,
        details: { target: conn.target, environment: tx.environment, allowed: MODE_TARGET[mode] },
      },
    );
  }
  return mode;
}

/** Everything an adapter call needs; the key is read from the secret store at call time and never logged. */
export async function hubContext(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
): Promise<HubCallContext> {
  const mode = hubModeFor(tx, conn);
  if (mode === 'live')
    await deps.ports.liveScope.assertLiveChannelAllowed(tx, {
      propertyId: conn.property_id,
      connectionId: conn.id,
    });
  if (!conn.credential_ref) {
    throw new DomainError(
      'hub_credential_missing',
      'This connection has no API key. Add the hub API key to continue.',
      {
        status: 409,
      },
    );
  }
  return {
    tenantId: tx.tenantId,
    mode,
    apiKey: await deps.ports.secrets.get(tx, conn.credential_ref),
    externalPropertyId: conn.external_property_id,
    deadline: new Date(tx.now.getTime() + deps.config.callDeadlineMs),
  };
}

/**
 * Why no hub call can make progress for this connection right now, or null (P1-1). Work waiting on such a condition
 * contributes NO due instant to the scheduler: it waits on a person or on another system, and the transition that
 * removes the condition pulls the schedule (verify / replace key → `scheduleTenant`). Conditions that change outside
 * this module (the organization's environment, the live-scope grant) are re-checked at the organization's
 * 15-minute ceiling wake, never every tick. Reads only; never calls the hub.
 */
export async function hubBlocker(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
): Promise<{ code: string; message: string } | null> {
  if (conn.credential_state === 'invalid')
    return { code: 'credentials_invalid', message: 'The hub refused the API key.' };
  // A replaced key is proven against THIS connection's hub property (Verify) before any hub work uses it (P2-6).
  if (conn.credential_state === 'unverified')
    return {
      code: 'credentials_unverified',
      message: 'The API key has not been verified for this hub property yet.',
    };
  try {
    const mode = hubModeFor(tx, conn);
    if (mode === 'live')
      await deps.ports.liveScope.assertLiveChannelAllowed(tx, {
        propertyId: conn.property_id,
        connectionId: conn.id,
      });
  } catch (err) {
    if (err instanceof DomainError) return { code: err.code, message: err.message };
    throw err;
  }
  if (!conn.credential_ref)
    return {
      code: 'hub_credential_missing',
      message: 'This connection has no API key. Add the hub API key to continue.',
    };
  return null;
}

/** Pull the organization's next scheduler wake-up earlier (never later). */
export async function scheduleTenant(tx: TxContext, at: Date): Promise<void> {
  await sql`insert into distribution.tenant_schedule (tenant_id, next_due_at, lease_until)
            values (${tx.tenantId}::uuid, ${at}, null)
            on conflict (tenant_id) do update
              set next_due_at = least(distribution.tenant_schedule.next_due_at, excluded.next_due_at)`.execute(
    tx.db,
  );
}

export async function recordExchange(
  tx: TxContext,
  input: {
    connectionId: string;
    direction: 'outbound' | 'inbound';
    operation: string;
    ref?: string | null;
    httpStatus?: number | null;
    outcome: string;
    durationMs?: number | null;
    detail?: Record<string, unknown> | null;
    provenance: 'live' | 'sandbox' | 'simulated';
  },
): Promise<void> {
  await db(tx)
    .insertInto('distribution.exchange_log')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      connection_id: input.connectionId,
      direction: input.direction,
      operation: input.operation,
      ref: input.ref ?? null,
      http_status: input.httpStatus ?? null,
      outcome: input.outcome,
      duration_ms: input.durationMs ?? null,
      detail: input.detail ? json(input.detail) : null,
      provenance: input.provenance,
      occurred_at: tx.now,
    })
    .execute();
}

/** Serialize work on one property's inbound queue (per-property ordered processing). */
export async function lockPropertyInbound(tx: TxContext, propertyId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext(${`distribution.inbound:${tx.tenantId}:${propertyId}`}))`.execute(
    tx.db,
  );
}

/** Serialize ARI work for one connection and kind (dirty-set writers vs. the message builder). */
export async function lockAri(tx: TxContext, connectionId: string, kind: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext(${`distribution.ari:${connectionId}:${kind}`}))`.execute(
    tx.db,
  );
}
