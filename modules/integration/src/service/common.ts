/** Shared helpers for integration services: loading, permissions, state transitions, effect gating, views. */
import { type Selectable, sql, type TxContext, typed } from '@portico/db';
import {
  actorId,
  assertExternalEffectAllowed,
  BusinessRuleError,
  canonicalJson,
  type ExternalEffect,
  ForbiddenError,
  NotFoundError,
  newId,
  type RequestContext,
  sha256Hex,
  VersionConflictError,
} from '@portico/kernel';
import type { PmsSimulatorHub } from '../connectors/pms-simulator';
import type {
  ConnectorDefinition,
  ConnectorRegistry,
  RegisteredConnector,
  WorkflowDefinition,
} from '../connectors/sdk';
import type { ConnectionScope, ConnectionState, ExchangeProvenance, IntegrationStatus } from '../contracts';
import {
  completedStep,
  type JourneyAction,
  JourneyTransitionError,
  nextState,
  stepOfAction,
} from '../domain/setup-journey';

const NEXT_HINT: Record<ConnectionState, string> = {
  selected: 'Next: review compatibility and choose the workflows.',
  compatibility_reviewed: 'Next: authorize access.',
  authorized: 'Next: review suggested mappings.',
  mappings_suggested: 'Next: resolve the flagged mapping issues.',
  issues_resolved: 'Next: run validation.',
  validated: 'Next: preview the expected behavior.',
  previewed: 'Next: activate the approved scope.',
  active: 'The connection is active.',
  monitoring: 'The connection is active and monitored.',
  paused: 'Resume the connection first.',
  disconnected: 'A disconnected connection cannot be changed; create a new connection.',
  error: 'Fix the credential problem (rotate the credential) first.',
};

import type { Resolver } from '../net/safe-fetch';
import type { IntegrationPorts } from '../ports';
import type { SecretStore } from '../secrets';
import type { ConnectionsTable, IntegrationDB } from '../tables';
import type { WebhookTransport } from './transport';

export const db = (tx: TxContext) => typed<IntegrationDB>(tx.db);

export interface IntegrationDeps {
  ports: IntegrationPorts;
  connectors: ConnectorRegistry;
  secrets: SecretStore;
  transport: WebhookTransport;
  simulators: { pms: PmsSimulatorHub };
  /** Outbound network policy: DNS resolver used for configuration-time checks, and the allowed ports. */
  net: { resolver: Resolver; allowedPorts: readonly number[] };
}

export type ConnectionRow = Selectable<ConnectionsTable>;

export function actorKey(ctx: Pick<RequestContext, 'actor'>): string {
  return `${ctx.actor.kind}:${actorId(ctx.actor)}`;
}

export async function loadConnection(
  tx: TxContext,
  id: string,
  opts: { forUpdate?: boolean } = {},
): Promise<ConnectionRow> {
  let q = db(tx).selectFrom('integration.connections').selectAll().where('id', '=', id);
  if (opts.forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw new NotFoundError('connection', id);
  return row;
}

/**
 * Permission on a connection. A connection may span several properties: managing it requires the permission
 * for EVERY property in scope ('all'); reading requires it for at least one ('any'). An organization-wide
 * connection (no properties) requires an organization-wide grant.
 */
export function requireOnConnection(
  ctx: Pick<RequestContext, 'authz'>,
  conn: { property_ids: string[] },
  permission: string,
  mode: 'any' | 'all' = 'all',
): void {
  if (conn.property_ids.length === 0) {
    if (ctx.authz.propertyScope(permission) !== 'all') throw new ForbiddenError(permission);
    return;
  }
  if (mode === 'any') {
    if (!conn.property_ids.some((p) => ctx.authz.can(permission, { propertyId: p }))) {
      throw new ForbiddenError(permission);
    }
    return;
  }
  for (const p of conn.property_ids) {
    if (!ctx.authz.can(permission, { propertyId: p }))
      throw new ForbiddenError(permission, { propertyId: p });
  }
}

/**
 * Which of a connection's rows a reader may see (F12): everything when they hold the permission for every property
 * of the connection, otherwise only rows of the properties they hold it for — never rows without a property.
 */
/** Never a property id: keeps an `in (...)` list non-empty when a reader holds no property. */
export const NO_PROPERTY = '00000000-0000-0000-0000-000000000000';

export function readableProperties(
  ctx: Pick<RequestContext, 'authz'>,
  conn: { property_ids: string[] },
  permission: string,
): { all: true } | { all: false; propertyIds: string[] } {
  if (ctx.authz.propertyScope(permission) === 'all') return { all: true };
  const ids = conn.property_ids.filter((p) => ctx.authz.can(permission, { propertyId: p }));
  if (conn.property_ids.length > 0 && ids.length === conn.property_ids.length) return { all: true };
  return { all: false, propertyIds: ids };
}

/** Whether one row of a connection (with its property, or none) is readable (F12). */
export function canReadRow(
  ctx: Pick<RequestContext, 'authz'>,
  conn: { property_ids: string[] },
  permission: string,
  rowPropertyId: string | null,
): boolean {
  const scope = readableProperties(ctx, conn, permission);
  return scope.all || (rowPropertyId !== null && scope.propertyIds.includes(rowPropertyId));
}

export function canOnConnection(
  ctx: Pick<RequestContext, 'authz'>,
  conn: { property_ids: string[] },
  permission: string,
): boolean {
  try {
    requireOnConnection(ctx, conn, permission, 'any');
    return true;
  } catch {
    return false;
  }
}

export function registered(deps: IntegrationDeps, key: string): RegisteredConnector {
  const r = deps.connectors.get(key);
  if (!r) throw new NotFoundError('connector', key);
  return r;
}

export function workflowDef(def: ConnectorDefinition, workflow: string): WorkflowDefinition {
  const w = def.workflows.find((x) => x.workflow === workflow);
  if (!w) {
    throw new BusinessRuleError(
      'unknown_workflow',
      `${def.name} has no "${workflow}" workflow. Choose one listed in the catalogue.`,
      { workflow, connector: def.key },
    );
  }
  return w;
}

export function parseScope(raw: unknown): ConnectionScope {
  const s = (raw ?? {}) as Partial<ConnectionScope>;
  return { workflows: s.workflows ?? [], authority: s.authority ?? [] };
}

export function scopeWorkflow(scope: ConnectionScope, workflow: string) {
  return scope.workflows.find((w) => w.workflow === workflow);
}

export function readsWorkflow(ops: readonly string[]): boolean {
  return ops.includes('read') || ops.includes('receive');
}
export function writesWorkflow(ops: readonly string[]): boolean {
  return ops.includes('create') || ops.includes('update');
}

export function provenanceOf(
  def: ConnectorDefinition,
  ctx: Pick<RequestContext, 'environment'>,
): ExchangeProvenance {
  if (def.isSimulator) return 'simulated';
  if (def.fileBased) return 'file';
  if (ctx.environment === 'sandbox') return 'sandbox';
  if (ctx.environment !== 'live') return 'simulated';
  return 'live';
}

/** Glossary "Integration status" (spec §4 mapping): supported → configured → tested → live, never collapsed. */
export function integrationStatusOf(
  def: ConnectorDefinition,
  state: ConnectionState,
  ctx: Pick<RequestContext, 'environment'>,
): IntegrationStatus {
  if (state === 'disconnected') return 'supported';
  const step = completedStep(state);
  if (state === 'active' || state === 'monitoring') {
    return ctx.environment === 'live' && !def.isSimulator && !def.fileBased ? 'live' : 'tested';
  }
  // Paused or suspended connections are not exchanging production data: never "live".
  if (state === 'paused' || state === 'error') return 'tested';
  if (step !== null && step >= 6) return 'tested';
  if (step !== null && step >= 5) return 'configured';
  return 'supported';
}

/**
 * Environment safety for every outbound call (ADR-0010): reads use `integration.read`; writes use
 * `channel.publish` for channel availability/rates and `integration.write` otherwise. A real connector never
 * runs in "simulate" mode (no simulator stands in for it), and in `live` the property's activation scope is
 * checked too (G-04) — except for simulators and files, which touch no real system.
 */
export async function gateEffect(
  tx: TxContext,
  deps: IntegrationDeps,
  def: ConnectorDefinition,
  input: { workflow: string; kind: 'read' | 'write'; connectionId: string; propertyIds: readonly string[] },
): Promise<'live' | 'sandbox' | 'simulate'> {
  const effect: ExternalEffect =
    input.kind === 'read'
      ? 'integration.read'
      : def.category === 'channel' && (input.workflow === 'availability' || input.workflow === 'rates')
        ? 'channel.publish'
        : 'integration.write';
  const mode = assertExternalEffectAllowed(tx, effect);
  if (def.isSimulator || def.fileBased) return mode;
  if (mode === 'simulate') {
    throw new BusinessRuleError(
      'real_system_not_contacted',
      `In the ${tx.environment} environment Portico never contacts real systems such as ${def.name}. Use the simulated PMS to try this workflow.`,
      { connector: def.key, environment: tx.environment },
    );
  }
  if (tx.environment === 'live') {
    for (const propertyId of input.propertyIds) {
      await deps.ports.activationScope.assertEffectInScope(tx, {
        propertyId,
        effect,
        workflow: input.workflow,
        connectionId: input.connectionId,
      });
    }
  }
  return mode;
}

export async function recordStep(
  tx: TxContext,
  conn: { id: string },
  input: {
    step: number;
    action: string;
    outcome: 'completed' | 'failed' | 'reopened' | 'lifecycle';
    from: string;
    to: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await db(tx)
    .insertInto('integration.connection_steps')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      connection_id: conn.id,
      step: input.step,
      action: input.action,
      outcome: input.outcome,
      state_from: input.from,
      state_to: input.to,
      detail: JSON.stringify(input.detail ?? {}),
      actor: JSON.stringify(tx.actor),
      actor_key: actorKey(tx),
      occurred_at: tx.now,
    })
    .execute();
}

export function assertVersion(conn: ConnectionRow, expected: number | undefined): void {
  if (expected !== undefined && conn.version !== expected) {
    throw new VersionConflictError('connection', conn.id, expected, conn.version);
  }
}

/**
 * Move a connection through the journey state machine (optimistic on version), record the step with actor and
 * time, and emit `integration.connection.statusChanged`.
 */
export async function transition(
  tx: TxContext,
  conn: ConnectionRow,
  action: JourneyAction,
  opts: {
    patch?: Partial<Record<keyof ConnectionsTable, unknown>>;
    detail?: Record<string, unknown>;
    reopenTo?: ConnectionState;
    stepOverride?: number;
    /** Keep or choose the resulting state (e.g. re-authorizing during setup keeps later progress). */
    targetState?: ConnectionState;
  } = {},
): Promise<ConnectionRow> {
  const from = conn.state as ConnectionState;
  let computed: ConnectionState;
  try {
    computed = nextState(action, from, {
      resumeState: (conn.resume_state as 'active' | 'monitoring' | null) ?? null,
      ...(opts.reopenTo ? { reopenTo: opts.reopenTo } : {}),
    });
  } catch (err) {
    if (err instanceof JourneyTransitionError) {
      throw new BusinessRuleError(
        'step_not_available',
        `This is not possible while the connection is "${from.replace(/_/g, ' ')}". ${NEXT_HINT[from]}`,
        { action, state: from },
      );
    }
    throw err;
  }
  const to = opts.targetState ?? computed;
  const updated = await db(tx)
    .updateTable('integration.connections')
    .set({
      ...(opts.patch as Record<string, unknown>),
      state: to,
      version: sql`version + 1`,
    })
    .where('id', '=', conn.id)
    .where('version', '=', conn.version)
    .returningAll()
    .executeTakeFirst();
  if (!updated) {
    const current = await loadConnection(tx, conn.id);
    throw new VersionConflictError('connection', conn.id, conn.version, current.version);
  }
  const step = opts.stepOverride ?? stepOfAction(action);
  await recordStep(tx, conn, {
    step,
    action,
    outcome: action === 'reopen' ? 'reopened' : step === 0 ? 'lifecycle' : 'completed',
    from,
    to,
    ...(opts.detail ? { detail: opts.detail } : {}),
  });
  if (from !== to) {
    await tx.emit({
      type: 'integration.connection.statusChanged',
      aggregate: { type: 'integration_connection', id: conn.id },
      payload: {
        connectionId: conn.id,
        propertyIds: conn.property_ids,
        state: { from, to },
        health: { from: conn.health_status, to: updated.health_status },
        reason: (opts.detail?.reason as string | undefined) ?? action,
      },
    });
  }
  return updated;
}

/** Make sure background jobs revisit this organization no later than `dueAt` (scheduler index). */
export async function scheduleTenant(tx: TxContext, dueAt: Date): Promise<void> {
  await sql`insert into integration.tenant_schedule (tenant_id, next_due_at)
            values (${tx.tenantId}::uuid, ${dueAt})
            on conflict (tenant_id) do update
              set next_due_at = least(integration.tenant_schedule.next_due_at, excluded.next_due_at)`.execute(
    tx.db,
  );
}

export function contentHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function systemName(conn: { name: string }, def: ConnectorDefinition): string {
  return `${conn.name} (${def.name})`;
}

export function iso(d: Date | string | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}
