/**
 * The integration module's provider surface for OTHER modules, with the exact domain-map signatures
 * (docs/architecture/domain-map.md § integration), bound to this deployment's connectors and ports. Additive
 * functions (contract changes) are listed in the README.
 */
import { sql, type TxContext } from '@portico/db';
import type { EntityRef } from '@portico/kernel';
import type {
  Connection,
  EffectClass,
  IntegrationException,
  MappingKind,
  ResponsibleParty,
  Severity,
} from '../contracts';
import { workflowInfo } from '../domain/impact';
import { db, type IntegrationDeps, loadConnection, parseScope, provenanceOf, registered } from './common';
import { getConnection, listConnections } from './connections';
import { listExceptions, raiseException, resolveException } from './exceptions';
import { enqueueOutbound, recordExchange } from './exchange';
import { markDegraded, markHealthy } from './health';
import { getMapping } from './mappings';
import { exceptionView } from './views';

export interface IntegrationProvider {
  getConnection(tx: TxContext, connectionId: string): Promise<Connection>;
  listConnections(tx: TxContext, q?: { propertyId?: string }): Promise<Connection[]>;
  getMapping(
    tx: TxContext,
    q: { connectionId: string; kind: MappingKind; externalId: string },
  ): Promise<{ internalId: string; reviewed: boolean } | null>;
  recordExchange(
    tx: TxContext,
    input: {
      connectionId: string;
      workflow: string;
      direction: 'inbound' | 'outbound';
      externalRef: string | null;
      outcome: string;
      detail?: Record<string, unknown> | null;
    },
  ): Promise<{ exchangeId: string }>;
  raiseException(
    tx: TxContext,
    input: {
      connectionId: string;
      workflow: string | null;
      severity: Severity;
      problem: string;
      businessImpact: string;
      responsibleParty: ResponsibleParty;
      nextStep: string;
      ref?: EntityRef;
      code?: string;
      dedupeKey?: string;
    },
  ): Promise<{ exceptionId: string }>;
  resolveException(tx: TxContext, input: { exceptionId: string; resolution: string }): Promise<void>;
  markHealthy(tx: TxContext, connectionId: string, at: Date): Promise<void>;
  markDegraded(tx: TxContext, connectionId: string, reason: string): Promise<void>;
  // ── additive (README "Contract changes") ──
  /** Spec "forward": queue an action for the external system of record; idempotent on the key. */
  forward(
    tx: TxContext,
    input: {
      connectionId: string;
      propertyId: string | null;
      workflow: string;
      operation: string;
      idempotencyKey: string;
      payload: Record<string, unknown>;
      sourceRef?: EntityRef;
      businessKey?: string;
      effectClassHint?: EffectClass;
    },
  ): Promise<{ commandId: string; status: string; effectClass: EffectClass; duplicate: boolean }>;
  /** Spec "getFreshness": how fresh information from a workflow is, for provenance labels (G-05). */
  getFreshness(
    tx: TxContext,
    input: { connectionId: string; workflow: string },
  ): Promise<{
    lastSuccessAt: string | null;
    ageSeconds: number | null;
    provenance: 'external' | 'simulated' | 'delayed' | 'incomplete';
  }>;
  /**
   * Platform `AuthorityTransitionGuard` (ST-08): forwarded or uncertain outbound actions at a property whose
   * workflow belongs to one of the domains. A transition cannot become effective while any is unsettled.
   */
  pendingOperations(
    tx: TxContext,
    propertyId: string,
    domains: readonly string[],
  ): Promise<Array<{ ref: string; description: string }>>;
  /** Integration exceptions for the cross-module "My work" inbox. */
  listWorkItems(
    tx: TxContext,
    input: { userId?: string; departmentIds?: string[] },
  ): Promise<IntegrationException[]>;
}

export function createIntegrationProvider(deps: IntegrationDeps): IntegrationProvider {
  return {
    getConnection: (tx, id) => getConnection(tx, deps, id),
    listConnections: (tx, q) => listConnections(tx, deps, q ?? {}),
    getMapping: (tx, q) => getMapping(tx, q),
    async recordExchange(tx, input) {
      const conn = await loadConnection(tx, input.connectionId);
      const def = registered(deps, conn.connector_key).definition;
      return recordExchange(tx, { ...input, provenance: provenanceOf(def, tx) });
    },
    raiseException: (tx, input) => raiseException(tx, input).then((r) => ({ exceptionId: r.exceptionId })),
    resolveException: (tx, input) => resolveException(tx, input).then(() => undefined),
    markHealthy: (tx, id, at) => markHealthy(tx, deps, id, at),
    markDegraded: (tx, id, reason) => markDegraded(tx, deps, id, reason),
    forward: (tx, input) => enqueueOutbound(tx, deps, input),
    async getFreshness(tx, input) {
      const conn = await loadConnection(tx, input.connectionId);
      const def = registered(deps, conn.connector_key).definition;
      const wf = def.workflows.find((w) => w.workflow === input.workflow);
      const st = await db(tx)
        .selectFrom('integration.workflow_state')
        .selectAll()
        .where('connection_id', '=', conn.id)
        .where('workflow', '=', input.workflow)
        .executeTakeFirst();
      const last = st?.last_success_at ? new Date(st.last_success_at) : null;
      const age = last ? Math.round((tx.now.getTime() - last.getTime()) / 1000) : null;
      const target =
        wf && (wf.sync === 'periodic' || wf.sync === 'realtime') ? wf.freshnessTargetSeconds : null;
      const scoped = parseScope(conn.scope).workflows.some((w) => w.workflow === input.workflow);
      const provenance = st?.incomplete_since
        ? 'incomplete'
        : !scoped ||
            conn.state === 'paused' ||
            conn.state === 'error' ||
            (target !== null && (age === null || age > target))
          ? 'delayed'
          : def.isSimulator
            ? 'simulated'
            : 'external';
      return { lastSuccessAt: last ? last.toISOString() : null, ageSeconds: age, provenance };
    },
    async pendingOperations(tx, propertyId, domains) {
      const rows = await db(tx)
        .selectFrom('integration.outbound_commands as c')
        .innerJoin('integration.connections as k', 'k.id', 'c.connection_id')
        .select(['c.id', 'c.workflow', 'c.operation', 'c.status', 'k.name', 'k.connector_key'])
        .where('c.status', 'in', ['queued', 'sending', 'pending_verification', 'needs_revalidation'])
        .where((eb) =>
          eb.or([
            eb('c.property_id', '=', propertyId),
            eb.and([
              eb('c.property_id', 'is', null),
              sql<boolean>`${propertyId}::uuid = any(k.property_ids)`,
            ]),
          ]),
        )
        .orderBy('c.enqueued_at')
        .limit(500)
        .execute();
      const wanted = new Set(domains);
      const out: Array<{ ref: string; description: string }> = [];
      for (const r of rows) {
        const reg = deps.connectors.get(r.connector_key);
        const domain = reg?.definition.workflows.find((w) => w.workflow === r.workflow)?.dataDomain ?? null;
        // A workflow with no known domain is reported too (fail closed).
        if (domain !== null && !wanted.has(domain)) continue;
        out.push({
          ref: `integration_outbound_command:${r.id}`,
          description: `${workflowInfo(r.workflow).label} ${r.operation} for ${r.name}: ${r.status.replace(/_/g, ' ')}`,
        });
      }
      return out;
    },
    async listWorkItems(tx, input) {
      const all = await listExceptions(tx, { status: 'unresolved' });
      const mine = all.filter(
        (e) =>
          (input.userId && e.ownerUserId === input.userId) ||
          (input.departmentIds && e.ownerDepartmentId && input.departmentIds.includes(e.ownerDepartmentId)) ||
          (!e.ownerUserId &&
            !e.ownerDepartmentId &&
            e.severity === 'urgent' &&
            e.allowedActions.some((a) => a.action === 'resolve' && a.enabled)),
      );
      return mine;
    },
  };
}

export { exceptionView };
