/**
 * Health views (property and portfolio), persistence of the connection's health status with events, credential
 * expiry reminders, and the domain-map provider functions markHealthy / markDegraded.
 */
import { sql, type TxContext } from '@portico/db';
import type { ConnectionHealth, ConnectionState, PortfolioHealth } from '../contracts';
import { CREDENTIAL_REMINDER_DAYS, computeHealth, type HealthResult } from '../domain/health';
import { buildImpact } from '../domain/impact';
import { isOperational } from '../domain/setup-journey';
import { P } from '../manifest';
import {
  type ConnectionRow,
  canOnConnection,
  db,
  type IntegrationDeps,
  iso,
  loadConnection,
  parseScope,
  provenanceOf,
  readsWorkflow,
  registered,
  requireOnConnection,
} from './common';
import { raiseException } from './exceptions';

const DAY_MS = 86_400_000;

async function healthInputs(tx: TxContext, deps: IntegrationDeps, conn: ConnectionRow) {
  const def = registered(deps, conn.connector_key).definition;
  const scope = parseScope(conn.scope);
  const states = await db(tx)
    .selectFrom('integration.workflow_state')
    .selectAll()
    .where('connection_id', '=', conn.id)
    .execute();
  const held = await db(tx)
    .selectFrom('integration.inbound_messages')
    .select(['workflow', sql<number>`count(*)::int`.as('n')])
    .where('connection_id', '=', conn.id)
    .where('status', 'in', ['held_mapping', 'held_validation'])
    .groupBy('workflow')
    .execute();
  const cred = await db(tx)
    .selectFrom('integration.credentials')
    .select(['expires_at'])
    .where('connection_id', '=', conn.id)
    .where('status', '=', 'active')
    .executeTakeFirst();
  const mappingCounts = await db(tx)
    .selectFrom('integration.mappings')
    .select(['status', sql<number>`count(*)::int`.as('n')])
    .where('connection_id', '=', conn.id)
    .where('status', 'in', ['suggested', 'unmapped'])
    .groupBy('status')
    .execute();
  const outbound = await db(tx)
    .selectFrom('integration.outbound_commands')
    .select(['status', sql<number>`count(*)::int`.as('n')])
    .where('connection_id', '=', conn.id)
    .where('status', 'in', ['queued', 'sending', 'pending_verification', 'needs_revalidation'])
    .groupBy('status')
    .execute();
  const exceptions = await db(tx)
    .selectFrom('integration.exceptions')
    .select(['severity', 'code', 'problem', 'next_step', 'responsible_party', 'workflow'])
    .where('connection_id', '=', conn.id)
    .where('status', 'in', ['open', 'acknowledged'])
    // These are already represented by computed signals.
    .where('code', 'not in', [
      'workflow_failing',
      'credential_rejected',
      'actions_need_revalidation',
      'credential_expiring',
      'credential_expired',
    ])
    .orderBy('last_seen_at', 'desc')
    .limit(20)
    .execute();
  const notices = await db(tx)
    .selectFrom('integration.vendor_notices')
    .selectAll()
    .where('connection_id', '=', conn.id)
    .where('status', '=', 'open')
    .execute();
  const usage = await db(tx)
    .selectFrom('integration.exchange_log')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('connection_id', '=', conn.id)
    .where('occurred_at', '>', new Date(tx.now.getTime() - DAY_MS))
    .executeTakeFirstOrThrow();
  const sorDomains = new Set(scope.authority.map((a) => a.domain));
  const byStatus = (rows: Array<{ status: string; n: number }>, s: string) =>
    rows.find((r) => r.status === s)?.n ?? 0;
  const credentialRejected = conn.state === 'error';
  const workflows = scope.workflows
    .map((s) => {
      const w = def.workflows.find((d) => d.workflow === s.workflow);
      if (!w) return null;
      const st = states.find((x) => x.workflow === s.workflow);
      return {
        workflow: w.workflow,
        sync: w.sync,
        operations: s.operations,
        freshnessTargetSeconds: readsWorkflow(s.operations) ? w.freshnessTargetSeconds : null,
        expectedIntervalSeconds: w.expectedIntervalSeconds,
        feedsSystemOfRecord: w.dataDomain !== null && sorDomains.has(w.dataDomain),
        lastSuccessAt: st?.last_success_at ? new Date(st.last_success_at) : null,
        lastFailureKind: st?.last_failure_kind ?? null,
        lastFailureReason: st?.last_failure_reason ?? null,
        consecutiveFailures: st?.consecutive_failures ?? 0,
        lastMessageLatencySeconds: st?.last_message_latency_s ?? null,
        incompleteSince: st?.incomplete_since ? new Date(st.incomplete_since) : null,
        incompleteReason: st?.incomplete_reason ?? null,
        heldMessages: held.find((h) => h.workflow === w.workflow)?.n ?? 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const result = computeHealth({
    now: tx.now,
    state: conn.state as ConnectionState,
    systemName: conn.name,
    baseProvenance: def.isSimulator ? 'simulated' : 'external',
    activatedAt: conn.activated_at ? new Date(conn.activated_at) : null,
    interruptedSince: conn.interrupted_since ? new Date(conn.interrupted_since) : null,
    interruptionReason: conn.interruption_reason,
    workflows,
    credential: {
      required: def.credentialSchema !== null,
      present: cred !== undefined,
      expiresAt: cred?.expires_at ? new Date(cred.expires_at) : null,
      rejected: credentialRejected,
    },
    mappingProblems: {
      awaitingReview: byStatus(mappingCounts, 'suggested'),
      unmapped: byStatus(mappingCounts, 'unmapped'),
    },
    outbound: {
      queued: byStatus(outbound, 'queued') + byStatus(outbound, 'sending'),
      pendingVerification: byStatus(outbound, 'pending_verification'),
      needsRevalidation: byStatus(outbound, 'needs_revalidation'),
    },
    openExceptions: exceptions.map((e) => ({
      severity: e.severity,
      code: e.code,
      problem: e.problem,
      nextStep: e.next_step,
      responsibleParty: e.responsible_party,
      workflow: e.workflow,
    })),
    vendorNotices: [
      ...def.vendorNotices,
      ...notices.map((n) => ({
        title: n.title,
        requiredAction: n.required_action,
        dueDate: n.due_date,
        responsibleParty: n.responsible_party,
      })),
    ],
  });
  return { def, scope, result, notices, usage: usage.n, outbound, mappingCounts, held, cred, byStatus };
}

async function impactFor(
  tx: TxContext,
  deps: IntegrationDeps,
  conn: ConnectionRow,
  result: HealthResult,
): Promise<ConnectionHealth['impact']> {
  if (result.overall === 'healthy' || result.overall === 'not_monitored') return null;
  const scope = parseScope(conn.scope);
  const affected =
    result.overall === 'paused' || result.overall === 'down'
      ? scope.workflows
      : scope.workflows.filter((w) =>
          result.workflows.some(
            (h) => h.workflow === w.workflow && h.status !== 'healthy' && h.status !== 'unknown',
          ),
        );
  const visible = conn.property_ids.filter((p) => tx.authz.can(P.connectionRead, { propertyId: p }));
  const properties = await Promise.all(
    visible.map(async (id) => {
      try {
        const p = await deps.ports.platform.getProperty(tx, id);
        return { id, name: p.name };
      } catch {
        return { id, name: 'Property' };
      }
    }),
  );
  return buildImpact({
    systemName: conn.name,
    situation: result.overall === 'paused' ? 'paused' : 'interrupted',
    properties,
    workflows: affected.length > 0 ? affected : scope.workflows,
  });
}

export async function getConnectionHealth(
  tx: TxContext,
  deps: IntegrationDeps,
  connectionId: string,
): Promise<ConnectionHealth> {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.connectionRead, 'any');
  return healthView(tx, deps, conn);
}

async function healthView(
  tx: TxContext,
  deps: IntegrationDeps,
  conn: ConnectionRow,
): Promise<ConnectionHealth> {
  const { def, result, notices, usage, cred, byStatus, outbound, mappingCounts, held } = await healthInputs(
    tx,
    deps,
    conn,
  );
  const openCounts = await db(tx)
    .selectFrom('integration.exceptions')
    .select(['severity', sql<number>`count(*)::int`.as('n')])
    .where('connection_id', '=', conn.id)
    .where('status', 'in', ['open', 'acknowledged'])
    .groupBy('severity')
    .execute();
  return {
    connectionId: conn.id,
    connectionName: conn.name,
    connectorName: def.name,
    state: conn.state as ConnectionState,
    overall: result.overall,
    worstWorkflowStatus: result.worstWorkflowStatus,
    credentialStatus: result.credentialStatus,
    exchangeProvenance: provenanceOf(def, tx),
    urgent: result.urgent,
    routine: result.routine,
    workflows: result.workflows,
    credential: { expiresAt: iso(cred?.expires_at), daysToExpiry: result.daysToExpiry },
    mappingProblems: {
      awaitingReview: byStatus(mappingCounts, 'suggested'),
      unmapped: byStatus(mappingCounts, 'unmapped'),
      heldMessages: held.reduce((s, h) => s + h.n, 0),
    },
    outbound: {
      queued: byStatus(outbound, 'queued') + byStatus(outbound, 'sending'),
      pendingVerification: byStatus(outbound, 'pending_verification'),
      needsRevalidation: byStatus(outbound, 'needs_revalidation'),
    },
    openExceptions: {
      urgent: openCounts.find((c) => c.severity === 'urgent')?.n ?? 0,
      routine: openCounts.find((c) => c.severity === 'routine')?.n ?? 0,
    },
    vendorNotices: notices.map((n) => ({
      id: n.id,
      title: n.title,
      requiredAction: n.required_action,
      dueDate: n.due_date,
    })),
    impact: await impactFor(tx, deps, conn, result),
    usage: { exchangesLast24h: usage, costNotes: def.costNotes },
    support: {
      vendor: def.support.vendor,
      escalation: def.support.escalation,
      ownerUserId: conn.owner_user_id,
    },
    recoveryActions: result.recoveryActions,
    checkedAt: tx.now.toISOString(),
  };
}

/** Recompute and persist the health status; emits statusChanged when it changes. */
export async function refreshHealth(
  tx: TxContext,
  deps: IntegrationDeps,
  connOrId: ConnectionRow | string,
): Promise<ConnectionHealth['overall']> {
  const conn = await loadConnection(tx, typeof connOrId === 'string' ? connOrId : connOrId.id);
  const { result } = await healthInputs(tx, deps, conn);
  if (result.overall !== conn.health_status || result.reason !== conn.health_reason) {
    await db(tx)
      .updateTable('integration.connections')
      .set({ health_status: result.overall, health_reason: result.reason, health_changed_at: tx.now })
      .where('id', '=', conn.id)
      .execute();
    if (result.overall !== conn.health_status) {
      await tx.emit({
        type: 'integration.connection.statusChanged',
        aggregate: { type: 'integration_connection', id: conn.id },
        payload: {
          connectionId: conn.id,
          propertyIds: conn.property_ids,
          state: { from: conn.state, to: conn.state },
          health: { from: conn.health_status, to: result.overall },
          reason: result.reason,
        },
      });
    }
  }
  return result.overall;
}

export async function portfolioHealth(
  tx: TxContext,
  deps: IntegrationDeps,
  q: { propertyId?: string },
): Promise<PortfolioHealth> {
  let query = db(tx)
    .selectFrom('integration.connections')
    .selectAll()
    .where('state', '<>', 'disconnected')
    .orderBy('name');
  if (q.propertyId) query = query.where(sql<boolean>`${q.propertyId}::uuid = any(property_ids)`);
  const rows = (await query.execute()).filter((c) => canOnConnection(tx, c, P.connectionRead));
  const totals = { connections: 0, healthy: 0, degraded: 0, down: 0, paused: 0, notMonitored: 0 };
  const urgent: PortfolioHealth['urgent'] = [];
  const connections: PortfolioHealth['connections'] = [];
  for (const c of rows) {
    const { result, def } = await healthInputs(tx, deps, c);
    totals.connections++;
    if (result.overall === 'not_monitored') totals.notMonitored++;
    else totals[result.overall]++;
    for (const s of result.urgent) urgent.push({ ...s, connectionId: c.id, connectionName: c.name });
    connections.push({
      connectionId: c.id,
      name: c.name,
      connectorName: def.name,
      propertyIds: c.property_ids,
      overall: result.overall,
      urgentCount: result.urgent.length,
      routineCount: result.routine.length,
    });
  }
  const rank = { down: 0, degraded: 1, paused: 2, healthy: 3, not_monitored: 4 } as const;
  connections.sort((a, b) => rank[a.overall] - rank[b.overall] || a.name.localeCompare(b.name));
  return { totals, urgent, connections, checkedAt: tx.now.toISOString() };
}

/** Domain-map provider: another module reports a healthy exchange it performed on this connection. */
export async function markHealthy(
  tx: TxContext,
  deps: IntegrationDeps,
  connectionId: string,
  at: Date,
): Promise<void> {
  const conn = await loadConnection(tx, connectionId);
  await db(tx)
    .updateTable('integration.connections')
    .set({
      health_status: isOperational(conn.state as ConnectionState) ? 'healthy' : conn.health_status,
      health_reason: null,
      health_changed_at: at,
    })
    .where('id', '=', connectionId)
    .execute();
  await refreshHealth(tx, deps, connectionId);
}

/** Domain-map provider: another module reports a problem on this connection. */
export async function markDegraded(
  tx: TxContext,
  deps: IntegrationDeps,
  connectionId: string,
  reason: string,
): Promise<void> {
  const conn = await loadConnection(tx, connectionId);
  await raiseException(tx, {
    connectionId,
    workflow: null,
    severity: 'urgent',
    code: 'reported_degraded',
    dedupeKey: `reported_degraded:${reason.slice(0, 80)}`,
    problem: `${conn.name} has a problem: ${reason}`,
    businessImpact: 'Information exchanged with this system may be delayed or incomplete.',
    responsibleParty: 'monoclay',
    nextStep: 'Monoclay support investigates; the connection keeps retrying meanwhile.',
  });
  await refreshHealth(tx, deps, connectionId);
}

/** Credential reminders at 30, 7 and 1 day(s) (routine, routine, urgent) and an urgent exception at expiry. */
export async function checkCredentialExpiry(tx: TxContext, conn: ConnectionRow): Promise<void> {
  const cred = await db(tx)
    .selectFrom('integration.credentials')
    .select(['id', 'expires_at'])
    .where('connection_id', '=', conn.id)
    .where('status', '=', 'active')
    .executeTakeFirst();
  if (!cred?.expires_at || conn.state === 'disconnected') return;
  const ms = new Date(cred.expires_at).getTime() - tx.now.getTime();
  const days = Math.floor(ms / DAY_MS);
  if (ms <= 0) {
    await raiseException(tx, {
      connectionId: conn.id,
      workflow: null,
      severity: 'urgent',
      code: 'credential_expired',
      dedupeKey: `credential_expired:${cred.id}`,
      problem: `The credential Portico uses for ${conn.name} expired on ${new Date(cred.expires_at).toISOString().slice(0, 10)}.`,
      businessImpact: `Portico cannot exchange information with ${conn.name}; information shown from it is getting older and actions are held.`,
      responsibleParty: 'hotel',
      nextStep: `Get a new credential from ${conn.name} and rotate it in Portico. Held work is checked before anything is sent.`,
    });
    return;
  }
  const threshold = [1, 7, CREDENTIAL_REMINDER_DAYS].find((t) => days < t);
  if (threshold === undefined) return;
  const created = await raiseException(tx, {
    connectionId: conn.id,
    workflow: null,
    severity: threshold === 1 ? 'urgent' : 'routine',
    code: 'credential_expiring',
    dedupeKey: `credential_expiring:${cred.id}:${threshold}`,
    problem: `The credential Portico uses for ${conn.name} expires in ${Math.max(0, days)} day${days === 1 ? '' : 's'}.`,
    businessImpact: `On ${new Date(cred.expires_at).toISOString().slice(0, 10)} the connection stops working unless the credential is renewed.`,
    responsibleParty: 'hotel',
    nextStep: `Request a new credential from ${conn.name} and rotate it in Portico before it expires (no interruption).`,
  });
  if (created.created) {
    await tx.emit({
      type: 'integration.credentials.expiring',
      aggregate: { type: 'integration_connection', id: conn.id },
      payload: { connectionId: conn.id, expiresAt: new Date(cred.expires_at).toISOString(), daysLeft: days },
    });
  }
}

export { healthView };
