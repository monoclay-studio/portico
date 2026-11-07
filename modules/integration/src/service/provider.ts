/**
 * The integration module's provider surface for OTHER modules, with the exact domain-map signatures
 * (docs/architecture/domain-map.md § integration), bound to this deployment's connectors and ports. Additive
 * functions (contract changes) are listed in the README.
 */
import type { TxContext } from '@portico/db';
import type { EntityRef } from '@portico/kernel';
import type {
  Connection,
  EffectClass,
  IntegrationException,
  MappingKind,
  ResponsibleParty,
  Severity,
} from '../contracts';
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
