/**
 * Connections and the 9-step setup journey (adoption brief §7; connection lifecycle spec §2): select →
 * compatibility → authorize → mappings → issues → validation → preview → activation (sets data authority) →
 * monitoring. Plus safe pause / resume / disconnect / credential rotation / provider replacement, each with an
 * impact preview of the hotel functions affected (brief §9).
 */
import { type PorticoDatabase, sql, type TxContext, withTenantTx } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  DomainError,
  type EntityRef,
  NotFoundError,
  newId,
  type RequestContext,
  ValidationError,
} from '@portico/kernel';
import type { ConnectorDefinition, CredentialCheck, InboundRecord } from '../connectors/sdk';
import { toSummary } from '../connectors/sdk';
import type {
  ActivationPreview,
  AuthorityChange,
  CompatibilityReport,
  Connection,
  ConnectionScope,
  ConnectionState,
  CreateConnectionInput,
  DataDomain,
  LifecycleAction,
  LifecyclePreview,
  ValidationRun,
} from '../contracts';
import { buildImpact, domainLabel, explainAuthorityChange, workflowInfo } from '../domain/impact';
import { canTransition, completedStep, isOperational } from '../domain/setup-journey';
import { P } from '../manifest';
import type { DataAuthorityView, PropertyInfo } from '../ports';
import {
  actorKey,
  assertVersion,
  type ConnectionRow,
  contentHash,
  db,
  type IntegrationDeps,
  loadConnection,
  parseScope,
  provenanceOf,
  readsWorkflow,
  recordStep,
  registered,
  requireOnConnection,
  scheduleTenant,
  systemName,
  transition,
  writesWorkflow,
} from './common';
import { loadActiveCredential, revokeCredentials, storeCredential, validateCredential } from './credentials';
import { autoResolveExceptions, raiseException } from './exceptions';
import { loadLookup, onReconnected, translateRecord } from './exchange';
import { refreshHealth } from './health';
import { fingerprintOf, issuesFor, mappingRows } from './mappings';
import { asConnectorError, explainConnectorError, prepareCall } from './runtime';
import { assertSimulatorsAllowed } from './simulators';
import { connectionView } from './views';

// ───────────────────────────── Create, read, list ─────────────────────────────

export async function createConnection(
  tx: TxContext,
  deps: IntegrationDeps,
  input: CreateConnectionInput,
): Promise<Connection> {
  const reg = registered(deps, input.connectorKey);
  if (reg.definition.setupPath !== 'connection' || !reg.adapter) {
    throw new BusinessRuleError(
      'connector_not_available',
      reg.definition.setupPath === 'webhook_subscriptions'
        ? `${reg.definition.name} is set up through webhook subscriptions, not a connection.`
        : `${reg.definition.name} is listed so you can see what is planned, but it is not built yet (${reg.definition.implementation.label}). Keep using your current process for it.`,
      { connectorKey: input.connectorKey },
    );
  }
  const propertyIds = [...new Set(input.propertyIds)];
  requireOnConnection(tx, { property_ids: propertyIds }, P.connectionManage);
  if (reg.definition.isSimulator) assertSimulatorsAllowed(tx);
  for (const id of propertyIds) await deps.ports.platform.getProperty(tx, id);
  const id = newId(tx.now.getTime());
  let row: ConnectionRow;
  try {
    row = await db(tx)
      .insertInto('integration.connections')
      .values({
        id,
        tenant_id: tx.tenantId,
        connector_key: input.connectorKey,
        name: input.name,
        property_ids: propertyIds,
        state: 'selected',
        resume_state: null,
        scope: JSON.stringify({ workflows: [], authority: [] }),
        compatibility: null,
        health_reason: null,
        health_changed_at: null,
        interrupted_since: null,
        interruption_reason: null,
        last_reconnected_at: null,
        activated_at: null,
        activated_by: null,
        activated_preview_id: null,
        replaces_connection_id: null,
        replaced_by_connection_id: null,
        owner_user_id: input.ownerUserId ?? null,
        last_error: null,
        next_sync_at: null,
        created_by: actorKey(tx),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new ConflictError(
        'connection_name_taken',
        `A connection named "${input.name}" already exists. Choose another name.`,
      );
    }
    throw err;
  }
  await recordStep(tx, row, {
    step: 1,
    action: 'select',
    outcome: 'completed',
    from: 'selected',
    to: 'selected',
    detail: { connectorKey: input.connectorKey },
  });
  await tx.audit({
    action: 'integration.connection.create',
    target: { type: 'integration_connection', id },
    after: { connectorKey: input.connectorKey, name: input.name, propertyIds },
  });
  await tx.emit({
    type: 'integration.connection.statusChanged',
    aggregate: { type: 'integration_connection', id },
    payload: {
      connectionId: id,
      propertyIds,
      state: { from: null, to: 'selected' },
      health: { from: null, to: 'not_monitored' },
      reason: 'created',
    },
  });
  return connectionView(tx, deps, row);
}

export async function getConnection(tx: TxContext, deps: IntegrationDeps, id: string): Promise<Connection> {
  const row = await loadConnection(tx, id);
  requireOnConnection(tx, row, P.connectionRead, 'any');
  return connectionView(tx, deps, row);
}

export async function listConnections(
  tx: TxContext,
  deps: IntegrationDeps,
  q: { propertyId?: string },
): Promise<Connection[]> {
  let query = db(tx).selectFrom('integration.connections').selectAll().orderBy('created_at', 'desc');
  if (q.propertyId) query = query.where(sql<boolean>`${q.propertyId}::uuid = any(property_ids)`);
  const rows = await query.execute();
  const out: Connection[] = [];
  for (const r of rows) {
    if (
      r.property_ids.length === 0
        ? tx.authz.propertyScope(P.connectionRead) !== 'all'
        : !r.property_ids.some((p) => tx.authz.can(P.connectionRead, { propertyId: p }))
    )
      continue;
    out.push(await connectionView(tx, deps, r));
  }
  return out;
}

// ───────────────────────────── Step 2: compatibility ─────────────────────────────

async function propertiesOf(
  tx: TxContext,
  deps: IntegrationDeps,
  conn: { property_ids: string[] },
): Promise<PropertyInfo[]> {
  return Promise.all(conn.property_ids.map((id) => deps.ports.platform.getProperty(tx, id)));
}

/** Authority rows that would conflict: the domain is already governed by ANOTHER live connection. */
async function authorityConflicts(
  tx: TxContext,
  deps: IntegrationDeps,
  conn: ConnectionRow,
  scope: ConnectionScope,
  opts: { allowFrom?: string } = {},
): Promise<string[]> {
  const out: string[] = [];
  for (const propertyId of conn.property_ids) {
    for (const a of scope.authority) {
      const current = await deps.ports.platform.getDataAuthority(tx, propertyId, a.domain);
      if (
        current.authority === 'external' &&
        current.connectionId &&
        current.connectionId !== conn.id &&
        current.connectionId !== opts.allowFrom
      ) {
        const other = await db(tx)
          .selectFrom('integration.connections')
          .select(['name', 'state'])
          .where('id', '=', current.connectionId)
          .executeTakeFirst();
        if (other?.state !== 'disconnected') {
          out.push(
            `${domainLabel(a.domain)[0]?.toUpperCase()}${domainLabel(a.domain).slice(1)} are already controlled by ${current.systemName ?? other?.name ?? 'another connection'}. Two systems must not change the same information: replace that connection instead.`,
          );
        }
      }
      const transitionInProgress = await deps.ports.transitions.activeTransition(tx, {
        propertyId,
        domain: a.domain,
      });
      if (transitionInProgress) {
        out.push(
          `A change of system of record for ${domainLabel(a.domain)} is in progress (${transitionInProgress.state}). Finish or cancel it first.`,
        );
      }
    }
  }
  return out;
}

export async function compatibilityReport(
  tx: TxContext,
  deps: IntegrationDeps,
  conn: ConnectionRow,
  scope: ConnectionScope,
): Promise<CompatibilityReport> {
  const def = registered(deps, conn.connector_key).definition;
  const summary = toSummary(registered(deps, conn.connector_key));
  const checks: CompatibilityReport['checks'] = [];
  const trial = tx.environment === 'trial';
  if (scope.workflows.length === 0) {
    checks.push({
      code: 'no_workflow',
      outcome: 'blocking',
      message: 'Choose at least one workflow.',
      responsibleParty: 'hotel',
    });
  }
  for (const s of scope.workflows) {
    const w = def.workflows.find((x) => x.workflow === s.workflow);
    if (!w) {
      checks.push({
        code: 'unknown_workflow',
        outcome: 'blocking',
        message: `${def.name} has no "${s.workflow}" workflow.`,
        responsibleParty: null,
      });
      continue;
    }
    if (w.status === 'unsupported' || w.status === 'unverified') {
      checks.push({
        code: 'workflow_unavailable',
        outcome: 'blocking',
        message: `${w.label}: ${w.status === 'unsupported' ? 'not offered' : 'not verified yet'} — ${w.whenUnavailable}`,
        responsibleParty: null,
      });
    }
    const unsupported = s.operations.filter((op) => !w.operations.includes(op));
    if (unsupported.length > 0) {
      checks.push({
        code: 'operation_unsupported',
        outcome: 'blocking',
        message: `${w.label}: ${def.name} cannot ${unsupported.join(' / ')} through Portico.`,
        responsibleParty: null,
      });
    }
    if (w.status === 'limited') {
      checks.push({
        code: 'workflow_limited',
        outcome: 'warning',
        message: `${w.label} is limited: ${w.limitations.join(' ')}`,
        responsibleParty: null,
      });
    }
    if (w.sync === 'file') {
      checks.push({
        code: 'file_exchange',
        outcome: 'warning',
        message: `${w.label}: file exchange — not a live connection. Information is only as current as the last file.`,
        responsibleParty: 'hotel',
      });
    }
    if (trial && writesWorkflow(s.operations)) {
      checks.push({
        code: 'trial_read_only',
        outcome: 'blocking',
        message: `${w.label}: a trial organization can only READ from your systems. Remove create/update.`,
        responsibleParty: 'hotel',
      });
    }
  }
  for (const a of scope.authority) {
    const g = def.governableDomains.find((x) => x.domain === a.domain);
    if (!g?.writeModes.includes(a.writeMode)) {
      checks.push({
        code: 'authority_unsupported',
        outcome: 'blocking',
        message: `${def.name} cannot be the system of record for ${domainLabel(a.domain)} in "${a.writeMode}" mode.`,
        responsibleParty: null,
      });
      continue;
    }
    const wfs = scope.workflows.filter(
      (s) => def.workflows.find((w) => w.workflow === s.workflow)?.dataDomain === a.domain,
    );
    if (!wfs.some((s) => readsWorkflow(s.operations))) {
      checks.push({
        code: 'authority_needs_read',
        outcome: 'blocking',
        message: `To mirror ${domainLabel(a.domain)} from ${def.name}, include a reading workflow for them.`,
        responsibleParty: 'hotel',
      });
    }
    if (a.writeMode === 'forward' && !wfs.some((s) => writesWorkflow(s.operations))) {
      checks.push({
        code: 'forward_needs_write',
        outcome: 'blocking',
        message: `Forwarding ${domainLabel(a.domain)} needs a workflow that creates or updates them in ${def.name}.`,
        responsibleParty: 'hotel',
      });
    }
    if (trial && a.writeMode === 'forward') {
      checks.push({
        code: 'trial_read_only',
        outcome: 'blocking',
        message: 'A trial organization can only mirror (read-only); forwarding writes is not allowed.',
        responsibleParty: 'hotel',
      });
    }
  }
  const domains = new Set(scope.authority.map((a) => a.domain));
  if (domains.has('availability') && !domains.has('reservations')) {
    checks.push({
      code: 'authority_coherence',
      outcome: 'blocking',
      message:
        'If availability is controlled by another system, reservations must be too (otherwise both systems would sell the same rooms).',
      responsibleParty: 'hotel',
    });
  }
  const properties = await propertiesOf(tx, deps, conn);
  if (!def.regions.includes('global')) {
    for (const p of properties) {
      if (!def.regions.includes(p.countryCode)) {
        checks.push({
          code: 'region',
          outcome: 'warning',
          message: `${def.name} is not listed for ${p.countryCode} (${p.name}). Check with the vendor.`,
          responsibleParty: 'vendor',
        });
      }
    }
  }
  if (def.localConnectorRequired) {
    checks.push({
      code: 'local_connector',
      outcome: 'warning',
      message: def.localConnectorNote ?? 'An on-site connector is required.',
      responsibleParty: 'hotel',
    });
  }
  for (const c of await authorityConflicts(tx, deps, conn, scope)) {
    checks.push({ code: 'authority_conflict', outcome: 'blocking', message: c, responsibleParty: 'hotel' });
  }
  if (def.isSimulator && tx.environment === 'live' && scope.authority.length > 0) {
    checks.push({
      code: 'simulator_authority_in_live',
      outcome: 'blocking',
      message: 'A simulated system can never be the system of record in a live organization.',
      responsibleParty: null,
    });
  }
  if (def.isSimulator) {
    checks.push({
      code: 'simulator',
      outcome: 'warning',
      message: 'This is a simulated system: everything exchanged is fictional and labeled "simulated".',
      responsibleParty: null,
    });
  }
  const environmentNote =
    tx.environment === 'trial'
      ? 'Trial organization: Portico can read from your systems through an approved read-only connection but will never write to them.'
      : tx.environment === 'live'
        ? 'Live organization: activation changes which system staff must use for the selected information.'
        : `${tx.environment} organization: exchanges are simulated; no real system is contacted.`;
  return {
    connectorKey: def.key,
    supportedWorkflows: summary.workflows,
    selected: scope,
    checks,
    prerequisites: def.prerequisites,
    vendorSetupSteps: def.vendorSetupSteps,
    costNotes: def.costNotes,
    localConnectorRequired: def.localConnectorRequired,
    environmentNote,
  };
}

export async function previewCompatibility(
  tx: TxContext,
  deps: IntegrationDeps,
  id: string,
  scope: ConnectionScope,
) {
  const conn = await loadConnection(tx, id);
  requireOnConnection(tx, conn, P.connectionRead, 'any');
  return compatibilityReport(tx, deps, conn, scope);
}

export async function reviewCompatibility(
  tx: TxContext,
  deps: IntegrationDeps,
  id: string,
  expectedVersion: number,
  scope: ConnectionScope,
): Promise<{ connection: Connection; report: CompatibilityReport }> {
  const conn = await loadConnection(tx, id, { forUpdate: true });
  requireOnConnection(tx, conn, P.connectionManage);
  assertVersion(conn, expectedVersion);
  const report = await compatibilityReport(tx, deps, conn, scope);
  const blocking = report.checks.filter((c) => c.outcome === 'blocking');
  if (blocking.length > 0) {
    throw new BusinessRuleError(
      'compatibility_blocked',
      `This scope cannot be used: ${blocking.map((b) => b.message).join(' ')}`,
      { checks: blocking },
    );
  }
  const step = completedStep(conn.state as ConnectionState) ?? 0;
  const hasCredential = (await loadActiveCredential(tx, deps, conn.id)) !== null;
  // A scope change re-runs the later steps; an existing verified credential is kept (no need to redo step 3).
  const target: ConnectionState = step >= 3 && hasCredential ? 'authorized' : 'compatibility_reviewed';
  const moved = await transition(tx, conn, 'reviewCompatibility', {
    targetState: target,
    patch: { scope: JSON.stringify(scope), compatibility: JSON.stringify(report) },
    detail: { scope, warnings: report.checks.filter((c) => c.outcome === 'warning').map((c) => c.code) },
  });
  await tx.audit({
    action: 'integration.connection.reviewCompatibility',
    target: { type: 'integration_connection', id },
    before: { scope: parseScope(conn.scope) },
    after: { scope },
  });
  return { connection: await connectionView(tx, deps, moved), report };
}

// ───────────────────────────── Step 3: authorize ─────────────────────────────

export async function authorize(
  database: PorticoDatabase,
  deps: IntegrationDeps,
  ctx: RequestContext,
  id: string,
  expectedVersion: number,
  input: { credentials: Record<string, unknown>; label: string; expiresAt?: string | undefined },
): Promise<Connection> {
  const prep = await withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, id);
    requireOnConnection(tx, conn, P.connectionManage);
    requireOnConnection(tx, conn, P.credentialsManage);
    assertVersion(conn, expectedVersion);
    if (!canTransition('authorize', conn.state as ConnectionState)) {
      throw new BusinessRuleError(
        'step_not_available',
        'Review compatibility first (step 2), then authorize access.',
      );
    }
    const def = registered(deps, conn.connector_key).definition;
    const value = validateCredential(def, input.credentials);
    const call = await prepareCall(tx, deps, conn, {
      kind: 'read',
      workflow: 'authorization',
      credentialOverride: value,
    });
    return { conn, def, value, call };
  });
  let check: CredentialCheck;
  try {
    check = await prep.call.adapter.testCredentials(prep.call.actx);
  } catch (err) {
    const ce = asConnectorError(err, 'read');
    await withTenantTx(database, ctx, async (tx) => {
      await recordStep(tx, prep.conn, {
        step: 3,
        action: 'authorize',
        outcome: 'failed',
        from: prep.conn.state,
        to: prep.conn.state,
        detail: { kind: ce.kind, message: ce.message },
      });
      await db(tx)
        .updateTable('integration.connections')
        .set({
          last_error: JSON.stringify({
            step: 3,
            kind: ce.kind,
            message: ce.message,
            at: tx.now.toISOString(),
          }),
        })
        .where('id', '=', id)
        .execute();
    });
    throw explainConnectorError(prep.conn.name, ce, 'Nothing was stored; the setup progress so far is kept.');
  }
  return withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, id, { forUpdate: true });
    assertVersion(conn, prep.conn.version);
    const stored = await storeCredential(tx, deps, {
      connectionId: id,
      value: prep.value,
      label: input.label,
      expiresAt: input.expiresAt,
      check,
    });
    const step = completedStep(conn.state as ConnectionState) ?? 0;
    // Re-authorizing later in the setup keeps mappings and decisions (spec §2.3): only step 3 is redone.
    const moved = await transition(tx, conn, 'authorize', {
      ...(step > 3 ? { targetState: conn.state as ConnectionState } : {}),
      patch: { last_error: null },
      detail: {
        accountLabel: check.accountLabel,
        scopes: check.scopes,
        readOnlyAtVendor: check.readOnly,
        expiresAt: stored.expires_at,
      },
    });
    await tx.audit({
      action: 'integration.connection.authorize',
      target: { type: 'integration_connection', id },
      after: {
        credentialId: stored.id,
        accountLabel: check.accountLabel,
        scopes: check.scopes,
        readOnlyAtVendor: check.readOnly,
        expiresAt: stored.expires_at,
        store: stored.store_kind,
      },
    });
    return connectionView(tx, deps, moved);
  });
}

// ───────────────────────────── Step 5: resolve issues ─────────────────────────────

export async function resolveIssues(
  tx: TxContext,
  deps: IntegrationDeps,
  id: string,
  expectedVersion: number,
): Promise<Connection> {
  const conn = await loadConnection(tx, id, { forUpdate: true });
  requireOnConnection(tx, conn, P.connectionManage);
  assertVersion(conn, expectedVersion);
  const rows = await mappingRows(tx, id);
  const issues = issuesFor(rows).filter((i) => i.severity === 'blocking');
  if (issues.length > 0) {
    await recordStep(tx, conn, {
      step: 5,
      action: 'resolveIssues',
      outcome: 'failed',
      from: conn.state,
      to: conn.state,
      detail: { blocking: issues.length },
    });
    throw new BusinessRuleError(
      'blocking_issues',
      `${issues.length} issue${issues.length === 1 ? '' : 's'} must be resolved first: ${issues
        .slice(0, 5)
        .map((i) => i.message)
        .join(' ')}${issues.length > 5 ? ' …' : ''}`,
      { issues },
    );
  }
  const moved = await transition(tx, conn, 'resolveIssues', { detail: { mappings: rows.length } });
  return connectionView(tx, deps, moved);
}

// ───────────────────────────── Step 6: validation ─────────────────────────────

export async function runValidation(
  database: PorticoDatabase,
  deps: IntegrationDeps,
  ctx: RequestContext,
  id: string,
  expectedVersion: number,
): Promise<ValidationRun> {
  const prep = await withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, id);
    requireOnConnection(tx, conn, P.connectionManage);
    assertVersion(conn, expectedVersion);
    if (!canTransition('validate', conn.state as ConnectionState)) {
      throw new BusinessRuleError(
        'step_not_available',
        'Resolve the flagged issues (step 5) before running validation.',
      );
    }
    const call = await prepareCall(tx, deps, conn, { kind: 'read', workflow: 'validation' });
    return { conn, call, startedAt: tx.now };
  });
  const def = prep.call.reg.definition;
  const scope = parseScope(prep.conn.scope);
  const checks: ValidationRun['checks'] = [];
  let credentialOk = true;
  try {
    await prep.call.adapter.testCredentials(prep.call.actx);
    checks.push({
      code: 'credential',
      outcome: 'passed',
      message: `${prep.conn.name} accepted Portico's credential.`,
      workflow: null,
      responsibleParty: null,
      nextStep: null,
    });
  } catch (err) {
    credentialOk = false;
    const ce = asConnectorError(err, 'read');
    checks.push({
      code: 'credential',
      outcome: 'failed',
      message: `${prep.conn.name} refused the credential: ${ce.message}`,
      workflow: null,
      responsibleParty: 'hotel',
      nextStep: 'Authorize again with a valid credential (step 3).',
    });
  }
  const samples = new Map<string, InboundRecord[]>();
  if (credentialOk) {
    for (const s of scope.workflows.filter((w) => readsWorkflow(w.operations))) {
      try {
        samples.set(
          s.workflow,
          prep.call.adapter.sample
            ? await prep.call.adapter.sample(prep.call.actx, { workflow: s.workflow, limit: 20 })
            : [],
        );
      } catch (err) {
        const ce = asConnectorError(err, 'read');
        checks.push({
          code: 'sample_read',
          outcome: 'failed',
          message: `Could not read sample ${workflowInfo(s.workflow).label.toLowerCase()}: ${ce.message}`,
          workflow: s.workflow,
          responsibleParty: 'vendor',
          nextStep: 'Try again; if it continues, contact the vendor.',
        });
      }
    }
  }
  return withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, id, { forUpdate: true });
    assertVersion(conn, prep.conn.version);
    const rows = await mappingRows(tx, id);
    const blocking = issuesFor(rows).filter((i) => i.severity === 'blocking');
    checks.push(
      blocking.length === 0
        ? {
            code: 'mappings_complete',
            outcome: 'passed',
            message: `All ${rows.length} mappings are confirmed or excluded.`,
            workflow: null,
            responsibleParty: null,
            nextStep: null,
          }
        : {
            code: 'mappings_complete',
            outcome: 'failed',
            message: `${blocking.length} mapping issue(s) remain open.`,
            workflow: null,
            responsibleParty: 'hotel',
            nextStep: 'Resolve the mapping issues (step 5).',
          },
    );
    const lookup = await loadLookup(tx, id);
    const properties = new Map((await propertiesOf(tx, deps, conn)).map((p) => [p.id, p]));
    const provenance = provenanceOf(def, tx);
    for (const [workflow, recs] of samples) {
      const wf = def.workflows.find((w) => w.workflow === workflow);
      if (!wf) continue;
      const results = recs.map((r) => translateRecord(wf, r, lookup, properties, provenance));
      const held = results.filter((t) => !t.ok);
      if (recs.length === 0) {
        checks.push({
          code: 'sample',
          outcome: 'warning',
          message: `${wf.label}: no sample records available yet, so translation could not be checked.`,
          workflow,
          responsibleParty: null,
          nextStep: null,
        });
      } else if (held.length === 0) {
        checks.push({
          code: 'sample',
          outcome: 'passed',
          message: `${wf.label}: all ${recs.length} sample records translate with the confirmed mappings.`,
          workflow,
          responsibleParty: null,
          nextStep: null,
        });
      } else {
        const reasons = [...new Set(held.map((h) => (h.ok ? '' : h.reason)))].slice(0, 3).join(' ');
        checks.push({
          code: 'sample',
          outcome: 'failed',
          message: `${wf.label}: ${held.length} of ${recs.length} sample records would be held. ${reasons}`,
          workflow,
          responsibleParty: 'hotel',
          nextStep: 'Fix the mappings or the data in the other system, then validate again.',
        });
      }
    }
    for (const s of scope.workflows.filter((w) => writesWorkflow(w.operations))) {
      const canWrite = def.fileBased ? !!prep.call.adapter.renderFile : !!prep.call.adapter.send;
      checks.push(
        canWrite
          ? {
              code: 'write_path',
              outcome: 'passed',
              message: `${workflowInfo(s.workflow).label}: Portico can send changes${def.fileBased ? ' as export files' : ''}.`,
              workflow: s.workflow,
              responsibleParty: null,
              nextStep: null,
            }
          : {
              code: 'write_path',
              outcome: 'failed',
              message: `${workflowInfo(s.workflow).label}: this connector cannot send changes.`,
              workflow: s.workflow,
              responsibleParty: null,
              nextStep: 'Remove create/update from the scope.',
            },
      );
      if (tx.environment === 'trial') {
        checks.push({
          code: 'trial_read_only',
          outcome: 'failed',
          message: 'Trial organizations cannot write to hotel systems (G-03).',
          workflow: s.workflow,
          responsibleParty: 'hotel',
          nextStep: 'Remove create/update from the scope.',
        });
      }
    }
    const cred = await loadActiveCredential(tx, deps, id);
    if (tx.environment === 'trial' && cred && cred.row.read_only_at_vendor !== true && def.credentialSchema) {
      checks.push({
        code: 'credential_scope',
        outcome: 'warning',
        message: `This credential would allow changes in ${conn.name}. Portico blocks all writes from trials.`,
        workflow: null,
        responsibleParty: 'hotel',
        nextStep: 'Where the vendor offers it, issue a read-only credential instead.',
      });
    }
    const status = checks.some((c) => c.outcome === 'failed') ? 'failed' : 'passed';
    const runId = newId(tx.now.getTime());
    await db(tx)
      .insertInto('integration.validation_runs')
      .values({
        id: runId,
        tenant_id: tx.tenantId,
        connection_id: id,
        status,
        checks: JSON.stringify(checks),
        mapping_fingerprint: fingerprintOf(rows),
        provenance,
        started_at: prep.startedAt,
        finished_at: tx.now,
        actor_key: actorKey(tx),
      })
      .execute();
    if (status === 'passed') {
      await transition(tx, conn, 'validate', { detail: { validationRunId: runId } });
    } else {
      await recordStep(tx, conn, {
        step: 6,
        action: 'validate',
        outcome: 'failed',
        from: conn.state,
        to: conn.state,
        detail: { validationRunId: runId },
      });
    }
    return {
      id: runId,
      connectionId: id,
      status,
      checks,
      provenance,
      startedAt: prep.startedAt.toISOString(),
      finishedAt: tx.now.toISOString(),
    };
  });
}

async function latestValidation(tx: TxContext, connectionId: string) {
  return db(tx)
    .selectFrom('integration.validation_runs')
    .selectAll()
    .where('connection_id', '=', connectionId)
    .orderBy('seq', 'desc')
    .limit(1)
    .executeTakeFirst();
}

// ───────────────────────────── Step 7: preview ─────────────────────────────

async function authorityChangesFor(
  tx: TxContext,
  deps: IntegrationDeps,
  conn: ConnectionRow,
  def: ConnectorDefinition,
  scope: ConnectionScope,
  properties: PropertyInfo[],
): Promise<AuthorityChange[]> {
  const out: AuthorityChange[] = [];
  for (const p of properties) {
    for (const a of scope.authority) {
      const before = await deps.ports.platform.getDataAuthority(tx, p.id, a.domain);
      out.push({
        propertyId: p.id,
        propertyName: p.name,
        domain: a.domain,
        before: { authority: before.authority, writeMode: before.writeMode, systemName: before.systemName },
        after: { authority: 'external', writeMode: a.writeMode, systemName: systemName(conn, def) },
        explanation: explainAuthorityChange(
          a.domain,
          { authority: 'external', writeMode: a.writeMode },
          conn.name,
        ),
      });
    }
  }
  return out;
}

export async function previewActivation(
  database: PorticoDatabase,
  deps: IntegrationDeps,
  ctx: RequestContext,
  id: string,
  expectedVersion: number,
): Promise<ActivationPreview> {
  const prep = await withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, id);
    requireOnConnection(tx, conn, P.connectionManage);
    assertVersion(conn, expectedVersion);
    if (!canTransition('preview', conn.state as ConnectionState)) {
      throw new BusinessRuleError(
        'step_not_available',
        'Run validation successfully (step 6) before previewing.',
      );
    }
    const rows = await mappingRows(tx, id);
    const last = await latestValidation(tx, id);
    if (last?.status !== 'passed' || last.mapping_fingerprint !== fingerprintOf(rows)) {
      throw new BusinessRuleError(
        'validation_outdated',
        'The last validation did not pass or was made before the latest mapping change. Run validation again.',
      );
    }
    return { conn, call: await prepareCall(tx, deps, conn, { kind: 'read', workflow: 'preview' }) };
  });
  const def = prep.call.reg.definition;
  const scope = parseScope(prep.conn.scope);
  const samples = new Map<string, InboundRecord[]>();
  for (const s of scope.workflows.filter((w) => readsWorkflow(w.operations))) {
    try {
      samples.set(
        s.workflow,
        prep.call.adapter.sample
          ? await prep.call.adapter.sample(prep.call.actx, { workflow: s.workflow, limit: 5 })
          : [],
      );
    } catch {
      samples.set(s.workflow, []);
    }
  }
  return withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, id, { forUpdate: true });
    assertVersion(conn, prep.conn.version);
    const properties = await propertiesOf(tx, deps, conn);
    const lookup = await loadLookup(tx, id);
    const propMap = new Map(properties.map((p) => [p.id, p]));
    const provenance = provenanceOf(def, tx);
    const expectedBehavior: ActivationPreview['expectedBehavior'] = [];
    for (const [workflow, recs] of samples) {
      const wf = def.workflows.find((w) => w.workflow === workflow);
      if (!wf) continue;
      for (const r of recs) {
        const t = translateRecord(wf, r, lookup, propMap, provenance);
        expectedBehavior.push({
          workflow,
          externalId: r.externalId,
          description: r.summary,
          outcome: t.ok ? 'would_apply' : 'would_hold',
          reason: t.ok ? null : t.reason,
        });
      }
    }
    const authorityChanges = await authorityChangesFor(tx, deps, conn, def, scope, properties);
    const forwardDomains = new Set(
      scope.authority.filter((a) => a.writeMode === 'forward').map((a) => a.domain),
    );
    const impact = buildImpact({
      systemName: conn.name,
      situation: 'activation',
      properties: properties.map((p) => ({ id: p.id, name: p.name })),
      workflows: scope.workflows,
      forwardDomains,
      fileBased: def.fileBased,
    });
    const warnings: string[] = [];
    if (def.isSimulator)
      warnings.push('Simulated system: exchanged information is fictional and labeled "simulated".');
    if (def.fileBased)
      warnings.push(
        'File exchange — not a live connection: information is only as current as the last file.',
      );
    for (const c of authorityChanges) {
      if (c.before.authority === 'portico')
        warnings.push(
          `At ${c.propertyName}, staff must stop changing ${domainLabel(c.domain)} in Portico${c.after.writeMode === 'forward' ? ' directly; Portico will forward changes instead' : ''}.`,
        );
    }
    const unchanged = def.workflows.filter((w) => !scope.workflows.some((s) => s.workflow === w.workflow));
    for (const w of unchanged)
      warnings.push(`Portico will not exchange ${w.label.toLowerCase()} with ${conn.name}.`);
    const workflows = scope.workflows.map((s) => ({
      workflow: s.workflow,
      operations: s.operations,
      sync: def.workflows.find((w) => w.workflow === s.workflow)?.sync ?? 'manual',
    }));
    const scopeSummary = `${conn.name} for ${properties.map((p) => p.name).join(', ') || 'the organization'}: ${workflows
      .map((w) => `${workflowInfo(w.workflow).label} (${w.operations.join('/')}, ${w.sync})`)
      .join(
        '; ',
      )}. System of record: ${scope.authority.map((a) => `${domainLabel(a.domain)} → ${conn.name} (${a.writeMode})`).join('; ') || 'unchanged'}.`;
    const content = {
      connectionId: id,
      provenance,
      scopeSummary,
      workflows,
      authorityChanges,
      expectedBehavior,
      impact,
      warnings,
    };
    const hash = contentHash(content);
    const previewId = newId(tx.now.getTime());
    const rows = await mappingRows(tx, id);
    await db(tx)
      .insertInto('integration.previews')
      .values({
        id: previewId,
        tenant_id: tx.tenantId,
        connection_id: id,
        kind: 'activation',
        content: JSON.stringify(content),
        content_hash: hash,
        mapping_fingerprint: fingerprintOf(rows),
        created_at: tx.now,
        actor_key: actorKey(tx),
      })
      .execute();
    await transition(tx, conn, 'preview', { detail: { previewId } });
    return { id: previewId, hash, createdAt: tx.now.toISOString(), ...content };
  });
}

// ───────────────────────────── Step 8: activation ─────────────────────────────

async function applyAuthority(
  tx: TxContext,
  deps: IntegrationDeps,
  conn: ConnectionRow,
  def: ConnectorDefinition,
  scope: ConnectionScope,
  reason: string,
): Promise<DataAuthorityView[]> {
  const out: DataAuthorityView[] = [];
  for (const propertyId of conn.property_ids) {
    for (const a of scope.authority) {
      out.push(
        await deps.ports.platform.setDataAuthority(tx, {
          propertyId,
          domain: a.domain,
          authority: 'external',
          connectionId: conn.id,
          systemName: systemName(conn, def),
          writeMode: a.writeMode,
          reason,
        }),
      );
    }
  }
  return out;
}

export async function activate(
  tx: TxContext,
  deps: IntegrationDeps,
  id: string,
  expectedVersion: number,
  input: { previewId: string; previewHash: string },
  opts: { replacing?: ConnectionRow } = {},
): Promise<Connection> {
  const conn = await loadConnection(tx, id, { forUpdate: true });
  requireOnConnection(tx, conn, P.connectionActivate);
  assertVersion(conn, expectedVersion);
  if (conn.state !== 'previewed') {
    throw new BusinessRuleError(
      'step_not_available',
      'Preview the expected behavior (step 7) before activating.',
    );
  }
  const def = registered(deps, conn.connector_key).definition;
  const scope = parseScope(conn.scope);
  const preview = await db(tx)
    .selectFrom('integration.previews')
    .selectAll()
    .where('connection_id', '=', id)
    .where('kind', '=', 'activation')
    .orderBy('seq', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!preview || preview.id !== input.previewId || preview.content_hash !== input.previewHash) {
    throw new ConflictError(
      'preview_outdated',
      'This is not the latest preview of this connection. Open the latest preview, review it and activate from there.',
    );
  }
  const rows = await mappingRows(tx, id);
  const fp = fingerprintOf(rows);
  const validation = await latestValidation(tx, id);
  if (
    preview.mapping_fingerprint !== fp ||
    !validation ||
    validation.status !== 'passed' ||
    validation.mapping_fingerprint !== fp
  ) {
    throw new ConflictError(
      'validation_outdated',
      'Mappings changed after validation or preview. Validate and preview again before activating.',
    );
  }
  if (def.isSimulator) assertSimulatorsAllowed(tx);
  if (
    tx.environment === 'trial' &&
    (scope.workflows.some((w) => writesWorkflow(w.operations)) ||
      scope.authority.some((a) => a.writeMode === 'forward'))
  ) {
    throw new BusinessRuleError(
      'trial_read_only',
      'A trial organization can only activate read-only workflows (G-03). Remove create/update and forwarding from the scope.',
    );
  }
  const conflicts = await authorityConflicts(
    tx,
    deps,
    conn,
    scope,
    opts.replacing ? { allowFrom: opts.replacing.id } : {},
  );
  if (conflicts.length > 0) {
    throw new BusinessRuleError('authority_conflict', conflicts.join(' '), { conflicts });
  }
  const authority = await applyAuthority(
    tx,
    deps,
    conn,
    def,
    scope,
    opts.replacing ? `Replaces ${opts.replacing.name}` : `Activated connection ${conn.name}`,
  );
  const moved = await transition(tx, conn, 'activate', {
    patch: {
      activated_at: tx.now,
      activated_by: actorKey(tx),
      activated_preview_id: preview.id,
      resume_state: 'active',
      next_sync_at: tx.now,
      ...(opts.replacing ? { replaces_connection_id: opts.replacing.id } : {}),
    },
    detail: {
      previewId: preview.id,
      authority: authority.map((a) => ({ domain: a.domain, writeMode: a.writeMode })),
    },
  });
  for (const s of scope.workflows) {
    await db(tx)
      .insertInto('integration.workflow_state')
      .values({ tenant_id: tx.tenantId, connection_id: id, workflow: s.workflow })
      .onConflict((oc) => oc.columns(['connection_id', 'workflow']).doNothing())
      .execute();
  }
  await scheduleTenant(tx, tx.now);
  await tx.audit({
    action: 'integration.connection.activate',
    target: { type: 'integration_connection', id },
    after: { scope, previewId: preview.id, authority },
  });
  await refreshHealth(tx, deps, moved);
  return connectionView(tx, deps, await loadConnection(tx, id));
}

// ───────────────────────────── Lifecycle: previews ─────────────────────────────

async function backlogOf(tx: TxContext, connectionId: string) {
  const rows = await db(tx)
    .selectFrom('integration.outbound_commands')
    .select(['status', 'effect_class', sql<number>`count(*)::int`.as('n')])
    .where('connection_id', '=', connectionId)
    .where('status', 'in', ['queued', 'sending', 'pending_verification', 'needs_revalidation'])
    .groupBy(['status', 'effect_class'])
    .execute();
  const sum = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((s, r) => s + r.n, 0);
  return {
    queued: sum((r) => r.status === 'queued' || r.status === 'sending'),
    pendingVerification: sum((r) => r.status === 'pending_verification'),
    needsRevalidation: sum((r) => r.status === 'needs_revalidation'),
    moneyOrInventory: sum((r) => r.effect_class !== 'standard'),
  };
}

/** Domains for which this connection is currently the system of record (any property). */
async function governedDomains(
  tx: TxContext,
  deps: IntegrationDeps,
  conn: ConnectionRow,
): Promise<Array<{ propertyId: string; domain: DataDomain }>> {
  const def = registered(deps, conn.connector_key).definition;
  const out: Array<{ propertyId: string; domain: DataDomain }> = [];
  for (const propertyId of conn.property_ids) {
    for (const g of def.governableDomains) {
      const a = await deps.ports.platform.getDataAuthority(tx, propertyId, g.domain);
      if (a.authority === 'external' && a.connectionId === conn.id)
        out.push({ propertyId, domain: g.domain });
    }
  }
  return out;
}

export async function previewLifecycle(
  tx: TxContext,
  deps: IntegrationDeps,
  id: string,
  action: LifecycleAction,
  opts: { replacementConnectionId?: string } = {},
): Promise<LifecyclePreview & { blockers: string[] }> {
  const conn = await loadConnection(tx, id);
  requireOnConnection(tx, conn, P.connectionManage);
  const def = registered(deps, conn.connector_key).definition;
  const scope = parseScope(conn.scope);
  const properties = await propertiesOf(tx, deps, conn);
  const backlog = await backlogOf(tx, id);
  const blockers: string[] = [];
  const warnings: string[] = [];
  let authorityChanges: AuthorityChange[] = [];
  let situation: Parameters<typeof buildImpact>[0]['situation'];
  let replacementName: string | undefined;
  switch (action) {
    case 'pause':
      situation = 'paused';
      if (!canTransition('pause', conn.state as ConnectionState))
        blockers.push(`Only an active connection can be paused (it is ${conn.state}).`);
      warnings.push(
        'Information from this system will be labeled delayed as it ages. Nothing is lost: actions are held, not dropped.',
      );
      break;
    case 'resume':
      situation = 'resume';
      if (conn.state !== 'paused') blockers.push('The connection is not paused.');
      if (backlog.moneyOrInventory > 0)
        warnings.push(
          `${backlog.moneyOrInventory} money or inventory action(s) will wait for your confirmation before anything is sent.`,
        );
      break;
    case 'disconnect': {
      situation = 'disconnected';
      const governed = await governedDomains(tx, deps, conn);
      if (governed.length > 0) {
        blockers.push(
          `${conn.name} is the system of record for ${[...new Set(governed.map((g) => domainLabel(g.domain)))].join(', ')}. Move that responsibility first (replace the provider, or change the system of record through a data-authority transition — docs/adoption/source-of-truth-matrix.md §6), then disconnect.`,
        );
      }
      const split = splitOnDisconnect(
        await db(tx)
          .selectFrom('integration.outbound_commands')
          .select(['id', 'status', 'lease_until', 'last_error'])
          .where('connection_id', '=', id)
          .where('status', 'in', ['queued', 'sending', 'pending_verification', 'needs_revalidation'])
          .execute(),
        tx.now,
      );
      if (split.cancel.length > 0) {
        warnings.push(
          `${split.cancel.length} action(s) that never reached ${conn.name} will be cancelled, never sent.`,
        );
      }
      const unsettled = split.uncertain.length + split.inFlight.length;
      if (unsettled > 0) {
        warnings.push(
          `${unsettled} action(s) have an unknown outcome: ${conn.name} may already have applied them. They stay pending verification until a person checks ${conn.name}; they are not cancelled.`,
        );
      }
      warnings.push('The credential is revoked and destroyed. The exchange history is kept.');
      break;
    }
    case 'rotate':
      situation = 'credential_rotation';
      if (conn.state === 'disconnected') blockers.push('The connection is disconnected.');
      break;
    case 'replace': {
      situation = 'replacement';
      if (!opts.replacementConnectionId) {
        blockers.push('Choose the replacement connection.');
        break;
      }
      const repl = await loadConnection(tx, opts.replacementConnectionId);
      replacementName = repl.name;
      requireOnConnection(tx, repl, P.connectionActivate);
      if (repl.state !== 'previewed')
        blockers.push(
          `The replacement ${repl.name} must finish setup up to the preview (step 7) first; it is ${repl.state}.`,
        );
      if (!isOperational(conn.state as ConnectionState) && conn.state !== 'paused' && conn.state !== 'error')
        blockers.push('Only an active, paused or suspended connection can be replaced.');
      const replDef = registered(deps, repl.connector_key).definition;
      authorityChanges = await authorityChangesFor(
        tx,
        deps,
        repl,
        replDef,
        parseScope(repl.scope),
        await propertiesOf(tx, deps, repl),
      );
      warnings.push(
        `${conn.name} is paused (not deleted) after the switch, so its history stays available until you disconnect it.`,
      );
      break;
    }
  }
  const impact = buildImpact({
    systemName: conn.name,
    situation,
    properties: properties.map((p) => ({ id: p.id, name: p.name })),
    workflows: scope.workflows,
    fileBased: def.fileBased,
    ...(replacementName ? { replacementName } : {}),
  });
  const content = {
    connectionId: id,
    action,
    impact,
    authorityChanges,
    backlog,
    warnings,
    blockers,
    replacementConnectionId: opts.replacementConnectionId ?? null,
  };
  const hash = contentHash(content);
  const previewId = newId(tx.now.getTime());
  await db(tx)
    .insertInto('integration.previews')
    .values({
      id: previewId,
      tenant_id: tx.tenantId,
      connection_id: id,
      kind: action,
      content: JSON.stringify(content),
      content_hash: hash,
      mapping_fingerprint: null,
      created_at: tx.now,
      actor_key: actorKey(tx),
    })
    .execute();
  return {
    id: previewId,
    connectionId: id,
    action,
    hash,
    impact,
    authorityChanges,
    backlog,
    warnings,
    blockers,
    createdAt: tx.now.toISOString(),
  };
}

/** The impact must not have changed since the person reviewed it. */
async function confirmPreview(
  tx: TxContext,
  deps: IntegrationDeps,
  id: string,
  action: LifecycleAction,
  hash: string | undefined,
  opts: { replacementConnectionId?: string } = {},
): Promise<LifecyclePreview & { blockers: string[] }> {
  const fresh = await previewLifecycle(tx, deps, id, action, opts);
  if (fresh.blockers.length > 0) {
    throw new BusinessRuleError(`${action}_blocked`, fresh.blockers.join(' '), { blockers: fresh.blockers });
  }
  if (hash !== undefined && hash !== fresh.hash) {
    throw new ConflictError(
      'impact_changed',
      'The impact of this action changed since you reviewed it. Review the new preview and confirm again.',
      { preview: fresh },
    );
  }
  return fresh;
}

// ───────────────────────────── Lifecycle: actions ─────────────────────────────

export async function pause(
  tx: TxContext,
  deps: IntegrationDeps,
  id: string,
  expectedVersion: number,
  input: { reason: string; previewHash?: string | undefined },
): Promise<Connection> {
  const conn = await loadConnection(tx, id, { forUpdate: true });
  assertVersion(conn, expectedVersion);
  const preview = await confirmPreview(tx, deps, id, 'pause', input.previewHash);
  const moved = await transition(tx, conn, 'pause', {
    patch: {
      resume_state: conn.state === 'error' ? conn.resume_state : conn.state,
      interrupted_since: conn.interrupted_since ?? tx.now,
      interruption_reason: `Paused: ${input.reason}`,
    },
    detail: { reason: input.reason, previewId: preview.id },
  });
  await tx.audit({
    action: 'integration.connection.pause',
    target: { type: 'integration_connection', id },
    reason: input.reason,
    after: { impact: preview.impact },
  });
  await refreshHealth(tx, deps, moved);
  return connectionView(tx, deps, await loadConnection(tx, id));
}

export async function resume(
  tx: TxContext,
  deps: IntegrationDeps,
  id: string,
  expectedVersion: number,
  input: { reason?: string | undefined; previewHash?: string | undefined },
): Promise<Connection> {
  const conn = await loadConnection(tx, id, { forUpdate: true });
  assertVersion(conn, expectedVersion);
  const preview = await confirmPreview(tx, deps, id, 'resume', input.previewHash);
  let moved = await transition(tx, conn, 'resume', {
    patch: { next_sync_at: tx.now },
    detail: { reason: input.reason ?? 'resumed', previewId: preview.id },
  });
  // Resuming is a reconnection: nothing that moves money or reopens inventory is replayed blindly.
  moved = await onReconnected(tx, deps, moved, 'resumed after a pause');
  await scheduleTenant(tx, tx.now);
  await tx.audit({
    action: 'integration.connection.resume',
    target: { type: 'integration_connection', id },
    reason: input.reason ?? null,
  });
  await refreshHealth(tx, deps, moved);
  return connectionView(tx, deps, await loadConnection(tx, id));
}

/** Which open outbound actions a disconnect may cancel, and which must stay pending verification (F4). */
export function splitOnDisconnect<
  C extends { id: string; status: string; lease_until: Date | string | null; last_error: unknown },
>(rows: readonly C[], now: Date): { cancel: C[]; uncertain: C[]; inFlight: C[] } {
  const out = { cancel: [] as C[], uncertain: [] as C[], inFlight: [] as C[] };
  for (const c of rows) {
    if (c.status === 'sending') {
      if (c.lease_until && new Date(c.lease_until) > now) out.inFlight.push(c);
      else out.uncertain.push(c); // the sender stopped mid-call: the outcome is unknown
    } else if (c.status === 'pending_verification' || lastErrorKind(c.last_error) === 'timeout') {
      out.uncertain.push(c);
    } else {
      out.cancel.push(c); // never sent, or definitely not applied
    }
  }
  return out;
}

function lastErrorKind(raw: unknown): string | null {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const kind = v && typeof v === 'object' ? (v as { kind?: unknown }).kind : undefined;
  return typeof kind === 'string' ? kind : null;
}

export async function disconnect(
  tx: TxContext,
  deps: IntegrationDeps,
  id: string,
  expectedVersion: number,
  input: { reason: string; previewHash: string },
): Promise<Connection> {
  const conn = await loadConnection(tx, id, { forUpdate: true });
  assertVersion(conn, expectedVersion);
  const preview = await confirmPreview(tx, deps, id, 'disconnect', input.previewHash);
  // F4: only actions that certainly never reached the system are cancelled. An action whose outcome is unknown
  // (the system may HAVE it, e.g. a charge on the guest's bill) stays pending verification for a person to settle;
  // a send still in flight is left to its completion, which holds it the same way.
  const open = await db(tx)
    .selectFrom('integration.outbound_commands')
    .select(['id', 'status', 'lease_until', 'last_error', 'workflow', 'property_id', 'source_ref'])
    .where('connection_id', '=', id)
    .where('status', 'in', ['queued', 'sending', 'pending_verification', 'needs_revalidation'])
    .forUpdate()
    .execute();
  const split = splitOnDisconnect(open, tx.now);
  if (split.inFlight.length > 0) {
    await db(tx)
      .updateTable('integration.outbound_commands')
      .set({ hold_after_send: true, version: sql`version + 1` })
      .where(
        'id',
        'in',
        split.inFlight.map((c) => c.id),
      )
      .execute();
  }
  if (split.uncertain.length > 0) {
    await db(tx)
      .updateTable('integration.outbound_commands')
      .set({
        status: 'pending_verification',
        verify_before_send: true,
        lease_until: null,
        revalidation_reason: `${conn.name} was disconnected (${input.reason}) while the outcome of this action was unknown. Check whether ${conn.name} has it.`,
        version: sql`version + 1`,
      })
      .where(
        'id',
        'in',
        split.uncertain.map((c) => c.id),
      )
      .execute();
  }
  const cancelled =
    split.cancel.length === 0
      ? []
      : await db(tx)
          .updateTable('integration.outbound_commands')
          .set({
            status: 'cancelled',
            completed_at: tx.now,
            revalidation_reason: `Connection disconnected: ${input.reason}`,
            lease_until: null,
            version: sql`version + 1`,
          })
          .where(
            'id',
            'in',
            split.cancel.map((c) => c.id),
          )
          .returning(['id', 'workflow', 'property_id', 'source_ref'])
          .execute();
  for (const c of cancelled) {
    await tx.emit({
      type: 'integration.outbound.cancelled',
      propertyId: c.property_id,
      aggregate: { type: 'integration_outbound_command', id: c.id },
      payload: {
        commandId: c.id,
        connectionId: id,
        workflow: c.workflow,
        sourceRef: c.source_ref,
        reason: 'connection disconnected',
      },
    });
  }
  const revoked = await revokeCredentials(tx, deps, id);
  const moved = await transition(tx, conn, 'disconnect', {
    patch: {
      health_status: 'not_monitored',
      health_reason: 'Disconnected',
      next_sync_at: null,
      interrupted_since: null,
    },
    detail: {
      reason: input.reason,
      previewId: preview.id,
      cancelledActions: cancelled.length,
      uncertainActions: split.uncertain.length + split.inFlight.length,
      revokedCredentials: revoked,
    },
  });
  await autoResolveExceptions(tx, id, [''], `Connection disconnected: ${input.reason}`);
  const unsettled = [...split.uncertain, ...split.inFlight];
  if (unsettled.length > 0) {
    await raiseException(tx, {
      connectionId: id,
      workflow: null,
      severity: 'urgent',
      code: 'uncertain_after_disconnect',
      dedupeKey: 'uncertain_after_disconnect',
      problem: `${unsettled.length} action${unsettled.length === 1 ? '' : 's'} sent to ${conn.name} had an unknown outcome when it was disconnected.`,
      businessImpact: `${conn.name} may have applied ${unsettled.length === 1 ? 'it' : 'them'} (for example a charge already on the guest's bill). ${unsettled.length === 1 ? 'It is' : 'They are'} shown as pending verification — never as done or cancelled — until a person checks.`,
      responsibleParty: 'hotel',
      nextStep: `Check each action in ${conn.name}: record it as applied if it is there, otherwise cancel it here and re-enter it in the system that now handles it.`,
      relatedRefs: unsettled.map((c) =>
        c.source_ref ? (c.source_ref as EntityRef) : { type: 'integration_outbound_command', id: c.id },
      ),
    });
  }
  await tx.audit({
    action: 'integration.connection.disconnect',
    target: { type: 'integration_connection', id },
    reason: input.reason,
    after: {
      cancelledActions: cancelled.map((c) => c.id),
      pendingVerification: unsettled.map((c) => c.id),
      revokedCredentials: revoked,
    },
  });
  return connectionView(tx, deps, moved);
}

/** Replace a provider: the validated replacement takes over authority; the old one is paused (not deleted). */
export async function replace(
  tx: TxContext,
  deps: IntegrationDeps,
  id: string,
  expectedVersion: number,
  input: { replacementConnectionId: string; reason: string; previewHash: string },
): Promise<{ replaced: Connection; replacement: Connection }> {
  const conn = await loadConnection(tx, id, { forUpdate: true });
  assertVersion(conn, expectedVersion);
  const preview = await confirmPreview(tx, deps, id, 'replace', input.previewHash, {
    replacementConnectionId: input.replacementConnectionId,
  });
  const repl = await loadConnection(tx, input.replacementConnectionId, { forUpdate: true });
  const replPreview = await db(tx)
    .selectFrom('integration.previews')
    .select(['id', 'content_hash'])
    .where('connection_id', '=', repl.id)
    .where('kind', '=', 'activation')
    .orderBy('seq', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!replPreview) throw new NotFoundError('activation_preview', repl.id);
  const replacement = await activate(
    tx,
    deps,
    repl.id,
    repl.version,
    { previewId: replPreview.id, previewHash: replPreview.content_hash },
    { replacing: conn },
  );
  // A send still in flight (live lease) is left to its completion, which holds it the same way (F2).
  await db(tx)
    .updateTable('integration.outbound_commands')
    .set({ hold_after_send: true, version: sql`version + 1` })
    .where('connection_id', '=', id)
    .where('status', '=', 'sending')
    .where('lease_until', '>', tx.now)
    .execute();
  const held = await db(tx)
    .updateTable('integration.outbound_commands')
    .set({
      status: 'needs_revalidation',
      verify_before_send: true,
      revalidation_reason: `Provider replaced by ${repl.name}; held for review, never moved automatically.`,
      lease_until: null,
      version: sql`version + 1`,
    })
    .where('connection_id', '=', id)
    .where((eb) =>
      eb.or([
        eb('status', 'in', ['queued', 'pending_verification']),
        eb.and([
          eb('status', '=', 'sending'),
          eb.or([eb('lease_until', 'is', null), eb('lease_until', '<=', tx.now)]),
        ]),
      ]),
    )
    .returning('id')
    .execute();
  let current = await loadConnection(tx, id);
  if (current.state !== 'paused') {
    current = await transition(tx, current, 'pause', {
      patch: {
        resume_state: current.state === 'error' ? current.resume_state : current.state,
        replaced_by_connection_id: repl.id,
        interrupted_since: current.interrupted_since ?? tx.now,
        interruption_reason: `Replaced by ${repl.name}`,
      },
      detail: { reason: input.reason, replacedBy: repl.id, previewId: preview.id, heldActions: held.length },
    });
  } else {
    current = await db(tx)
      .updateTable('integration.connections')
      .set({ replaced_by_connection_id: repl.id, version: sql`version + 1` })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
  await tx.audit({
    action: 'integration.connection.replace',
    target: { type: 'integration_connection', id },
    reason: input.reason,
    after: { replacementConnectionId: repl.id, heldActions: held.map((h) => h.id) },
  });
  await refreshHealth(tx, deps, current);
  return { replaced: await connectionView(tx, deps, current), replacement };
}

/** Zero-downtime credential rotation: the new credential is tested first; the old one is retired only after. */
export async function rotateCredential(
  database: PorticoDatabase,
  deps: IntegrationDeps,
  ctx: RequestContext,
  id: string,
  expectedVersion: number,
  input: {
    credentials: Record<string, unknown>;
    label: string;
    expiresAt?: string | undefined;
    reason?: string | undefined;
  },
): Promise<Connection> {
  const prep = await withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, id);
    requireOnConnection(tx, conn, P.credentialsManage);
    assertVersion(conn, expectedVersion);
    if (conn.state === 'disconnected')
      throw new BusinessRuleError(
        'connection_disconnected',
        'A disconnected connection has no credentials to rotate.',
      );
    const def = registered(deps, conn.connector_key).definition;
    if (!def.credentialSchema)
      throw new ValidationError('no_credentials', `${def.name} does not use credentials.`);
    const value = validateCredential(def, input.credentials);
    return {
      conn,
      value,
      call: await prepareCall(tx, deps, conn, {
        kind: 'read',
        workflow: 'authorization',
        credentialOverride: value,
      }),
    };
  });
  let check: CredentialCheck;
  try {
    check = await prep.call.adapter.testCredentials(prep.call.actx);
  } catch (err) {
    const ce = asConnectorError(err, 'read');
    await withTenantTx(database, ctx, (tx) =>
      recordStep(tx, prep.conn, {
        step: 0,
        action: 'rotateCredential',
        outcome: 'failed',
        from: prep.conn.state,
        to: prep.conn.state,
        detail: { kind: ce.kind, message: ce.message },
      }),
    );
    throw explainConnectorError(
      prep.conn.name,
      ce,
      'Nothing changed: the current credential is still in use.',
    );
  }
  return withTenantTx(database, ctx, async (tx) => {
    let conn = await loadConnection(tx, id, { forUpdate: true });
    assertVersion(conn, prep.conn.version);
    const stored = await storeCredential(tx, deps, {
      connectionId: id,
      value: prep.value,
      label: input.label,
      expiresAt: input.expiresAt,
      check,
    });
    await recordStep(tx, conn, {
      step: 0,
      action: 'rotateCredential',
      outcome: 'lifecycle',
      from: conn.state,
      to: conn.state,
      detail: { credentialId: stored.id, expiresAt: stored.expires_at },
    });
    if (conn.state === 'error') {
      conn = await transition(tx, conn, 'recover', { detail: { reason: 'Credential renewed' } });
    }
    if (conn.interrupted_since && conn.state !== 'paused') {
      conn = await onReconnected(tx, deps, conn, 'the credential was renewed');
    }
    await autoResolveExceptions(
      tx,
      id,
      ['credential_rejected', 'credential_expir'],
      'A new credential was added.',
    );
    await tx.audit({
      action: 'integration.credential.rotate',
      target: { type: 'integration_connection', id },
      reason: input.reason ?? null,
      after: { credentialId: stored.id, expiresAt: stored.expires_at, readOnlyAtVendor: check.readOnly },
    });
    await refreshHealth(tx, deps, conn);
    return connectionView(tx, deps, await loadConnection(tx, id));
  });
}

// ───────────────────────────── Vendor-required changes ─────────────────────────────

export async function recordVendorNotice(
  tx: TxContext,
  deps: IntegrationDeps,
  id: string,
  input: {
    title: string;
    requiredAction: string;
    responsibleParty: 'hotel' | 'monoclay' | 'vendor';
    dueDate?: string | undefined;
  },
): Promise<{ id: string }> {
  const conn = await loadConnection(tx, id);
  requireOnConnection(tx, conn, P.connectionManage);
  const noticeId = newId(tx.now.getTime());
  await db(tx)
    .insertInto('integration.vendor_notices')
    .values({
      id: noticeId,
      tenant_id: tx.tenantId,
      connection_id: id,
      title: input.title,
      required_action: input.requiredAction,
      responsible_party: input.responsibleParty,
      due_date: input.dueDate ?? null,
      status: 'open',
      created_at: tx.now,
      actor_key: actorKey(tx),
    })
    .execute();
  await tx.audit({
    action: 'integration.vendorNotice.record',
    target: { type: 'integration_connection', id },
    after: input,
  });
  await refreshHealth(tx, deps, conn);
  return { id: noticeId };
}

export async function completeVendorNotice(
  tx: TxContext,
  deps: IntegrationDeps,
  connectionId: string,
  noticeId: string,
): Promise<void> {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.connectionManage);
  const res = await db(tx)
    .updateTable('integration.vendor_notices')
    .set({ status: 'done', version: sql`version + 1` })
    .where('id', '=', noticeId)
    .where('connection_id', '=', connectionId)
    .executeTakeFirst();
  if (Number(res.numUpdatedRows) === 0) throw new NotFoundError('vendor_notice', noticeId);
  await tx.audit({
    action: 'integration.vendorNotice.complete',
    target: { type: 'integration_connection', id: connectionId },
    metadata: { noticeId },
  });
  await refreshHealth(tx, deps, conn);
}

export { DomainError };
