/**
 * Information exchange: inbound message store (dedupe + ordering + translation through mappings), sync runs
 * (periodic / manual / reconciliation / file), the exchange log, and the outbound command queue with
 * idempotency keys, verification of unknown outcomes and NO blind replay after reconnection (adoption brief §8;
 * connection lifecycle spec §8–§9; INT-R15..R20).
 */
import {
  explainVersionMiss,
  type PorticoDatabase,
  type Selectable,
  sql,
  type TxContext,
  withTenantTx,
} from '@portico/db';
import {
  BusinessRuleError,
  canonicalJson,
  type EntityRef,
  IdempotencyConflictError,
  NotFoundError,
  newId,
  type RequestContext,
  sha256Hex,
  ValidationError,
} from '@portico/kernel';
import {
  type ConnectorDefinition,
  ConnectorError,
  type InboundRecord,
  type WorkflowDefinition,
} from '../connectors/sdk';
import type {
  ConnectionState,
  EffectClass,
  ExchangeEntry,
  ExchangeProvenance,
  MappingKind,
  OutboundCommand,
  SyncRun,
} from '../contracts';
import { buildImpact, workflowInfo } from '../domain/impact';
import { decideOrdering, sortForProcessing } from '../domain/inbound-ordering';
import {
  afterNegativeLookup,
  backoffSeconds,
  INTERRUPTION_THRESHOLD,
  isRisky,
  MONEY_STALENESS_HOURS,
  mustRevalidateOnReconnect,
  outcomeOfFailure,
  sendGate,
  stricterEffect,
  supersededStateCommands,
} from '../domain/outbound-policy';
import { isOperational } from '../domain/setup-journey';
import { MAPPING_KIND_LABELS } from '../domain/vocabulary';
import { P } from '../manifest';
import type { PropertyInfo } from '../ports';
import type { MappingsTable, OutboundCommandsTable, SyncRunsTable } from '../tables';
import {
  actorKey,
  type ConnectionRow,
  canOnConnection,
  db,
  gateEffect,
  type IntegrationDeps,
  iso,
  loadConnection,
  parseScope,
  provenanceOf,
  readsWorkflow,
  recordStep,
  registered,
  requireOnConnection,
  scheduleTenant,
  scopeWorkflow,
  transition,
  writesWorkflow,
} from './common';
import { autoResolveExceptions, raiseException } from './exceptions';
import { refreshHealth } from './health';
import { ensureUnmappedRow, reviewMapping } from './mappings';
import {
  asConnectorError,
  errorClassOf,
  explainConnectorError,
  prepareCall,
  responsibleFor,
} from './runtime';

export interface Counts {
  received: number;
  applied: number;
  duplicates: number;
  stale: number;
  held: number;
  rejected: number;
  sent: number;
  exported: number;
}
const emptyCounts = (): Counts => ({
  received: 0,
  applied: 0,
  duplicates: 0,
  stale: 0,
  held: 0,
  rejected: 0,
  sent: 0,
  exported: 0,
});

// ───────────────────────────── Exchange log ─────────────────────────────

const OUTCOMES = new Set([
  'succeeded',
  'failed',
  'duplicate',
  'stale',
  'held',
  'rejected',
  'unknown',
  'simulated',
  'blocked',
  'exported',
]);

export interface RecordExchangeInput {
  connectionId: string;
  workflow: string;
  direction: 'inbound' | 'outbound';
  externalRef?: string | null;
  outcome: string;
  detail?: Record<string, unknown> | null;
  summary?: string;
  operation?: string | null;
  idempotencyKey?: string | null;
  latencyMs?: number | null;
  errorClass?: 'transient' | 'permanent' | 'mapping' | 'data' | 'auth' | 'rate_limited' | null;
  propertyId?: string | null;
  syncRunId?: string | null;
  provenance: ExchangeProvenance;
}

/** Append one exchange to the log (domain-map provider `recordExchange`, with provenance resolved by caller). */
export async function recordExchange(
  tx: TxContext,
  input: RecordExchangeInput,
): Promise<{ exchangeId: string }> {
  if (!OUTCOMES.has(input.outcome)) {
    throw new ValidationError(
      'invalid_outcome',
      `Exchange outcome "${input.outcome}" is not one of ${[...OUTCOMES].join(', ')}.`,
    );
  }
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('integration.exchange_log')
    .values({
      id,
      tenant_id: tx.tenantId,
      connection_id: input.connectionId,
      property_id: input.propertyId ?? null,
      workflow: input.workflow,
      direction: input.direction,
      operation: input.operation ?? null,
      external_ref: input.externalRef ?? null,
      idempotency_key: input.idempotencyKey ?? null,
      outcome: input.outcome,
      latency_ms: input.latencyMs ?? null,
      error_class: input.errorClass ?? null,
      summary:
        input.summary ??
        `${input.direction === 'inbound' ? 'Received' : 'Sent'} ${input.workflow}: ${input.outcome}`,
      detail: input.detail ? JSON.stringify(input.detail) : null,
      provenance: input.provenance,
      sync_run_id: input.syncRunId ?? null,
      occurred_at: tx.now,
    })
    .execute();
  return { exchangeId: id };
}

export async function listExchanges(
  tx: TxContext,
  connectionId: string,
  q: { limit: number; workflow?: string },
): Promise<ExchangeEntry[]> {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.connectionRead, 'any');
  const technical = canOnConnection(tx, conn, P.technicalRead);
  let query = db(tx)
    .selectFrom('integration.exchange_log')
    .selectAll()
    .where('connection_id', '=', connectionId)
    .orderBy('occurred_at', 'desc')
    .orderBy('id', 'desc')
    .limit(q.limit);
  if (q.workflow) query = query.where('workflow', '=', q.workflow);
  const rows = await query.execute();
  return rows.map((r) => ({
    id: r.id,
    connectionId: r.connection_id,
    propertyId: r.property_id,
    workflow: r.workflow,
    direction: r.direction,
    operation: r.operation,
    externalRef: r.external_ref,
    idempotencyKey: r.idempotency_key,
    outcome: r.outcome,
    latencyMs: r.latency_ms,
    summary: r.summary,
    provenance: r.provenance as ExchangeProvenance,
    occurredAt: new Date(r.occurred_at).toISOString(),
    ...(technical ? { detail: (r.detail as Record<string, unknown> | null) ?? null } : {}),
  }));
}

// ───────────────────────────── Translation (business meaning) ─────────────────────────────

type LookupRow = Pick<
  Selectable<MappingsTable>,
  'kind' | 'external_id' | 'internal_id' | 'status' | 'external_label'
>;

export async function loadLookup(tx: TxContext, connectionId: string): Promise<Map<string, LookupRow>> {
  const rows = await db(tx)
    .selectFrom('integration.mappings')
    .select(['kind', 'external_id', 'internal_id', 'status', 'external_label'])
    .where('connection_id', '=', connectionId)
    .execute();
  return new Map(rows.map((r) => [`${r.kind}|${r.external_id}`, r]));
}

export interface MissingCode {
  kind: MappingKind;
  externalId: string;
  label: string;
}

export type Translation =
  | { ok: true; propertyId: string; canonical: Record<string, unknown> }
  | {
      ok: false;
      status: 'held_mapping' | 'held_validation' | 'rejected';
      reason: string;
      propertyId: string | null;
      missing: MissingCode[];
    };

/**
 * Translate an external record into Portico terms through confirmed mappings. Never guesses: a code that is not
 * confirmed holds the record (INT-R12); a currency different from the property's is held, never converted.
 */
export function translateRecord(
  wf: WorkflowDefinition,
  record: InboundRecord,
  lookup: ReadonlyMap<string, LookupRow>,
  properties: ReadonlyMap<string, PropertyInfo>,
  provenance: ExchangeProvenance,
): Translation {
  const missing: MissingCode[] = [];
  let propertyId: string | null = null;
  const prop = record.propertyExternalId ? lookup.get(`property|${record.propertyExternalId}`) : undefined;
  if (!record.propertyExternalId || !prop || prop.status !== 'confirmed' || !prop.internal_id) {
    if (record.propertyExternalId) {
      missing.push({
        kind: 'property',
        externalId: record.propertyExternalId,
        label: record.propertyExternalId,
      });
    }
    return {
      ok: false,
      status: record.propertyExternalId ? 'held_mapping' : 'held_validation',
      reason: record.propertyExternalId
        ? `Property "${record.propertyExternalId}" is not linked to a Portico property.`
        : 'The record does not say which property it belongs to.',
      propertyId: null,
      missing,
    };
  }
  propertyId = prop.internal_id;
  const property = properties.get(propertyId);
  if (!property) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'The record belongs to a property outside this connection’s approved scope.',
      propertyId,
      missing,
    };
  }
  const mapped: Record<string, { externalCode: string; internalId: string }> = {};
  const problems: string[] = [];
  for (const f of wf.mappedFields) {
    if (f.kind === 'property') continue;
    const raw = record.payload[f.field];
    if (raw === undefined || raw === null || raw === '') {
      if (f.required) problems.push(`the ${f.field} field is empty`);
      continue;
    }
    const code = String(raw);
    const key = f.statusDomain ? `${f.statusDomain}:${code}` : code;
    const m = lookup.get(`${f.kind}|${key}`);
    if (m && m.status === 'confirmed' && m.internal_id) {
      mapped[f.field] = { externalCode: code, internalId: m.internal_id };
      continue;
    }
    if (m && m.status === 'ignored' && !f.required) continue;
    if (f.required || m === undefined || m.status !== 'ignored') {
      if (f.required) missing.push({ kind: f.kind, externalId: key, label: m?.external_label ?? code });
      else if (!m) missing.push({ kind: f.kind, externalId: key, label: code });
    }
  }
  if (problems.length > 0) {
    return {
      ok: false,
      status: 'held_validation',
      reason: `Incomplete record: ${problems.join('; ')}.`,
      propertyId,
      missing,
    };
  }
  const requiredMissing = missing.filter((mc) =>
    wf.mappedFields.some((f) => f.kind === mc.kind && f.required),
  );
  if (requiredMissing.length > 0) {
    return {
      ok: false,
      status: 'held_mapping',
      reason: `Uses ${requiredMissing
        .map(
          (mc) =>
            `${MAPPING_KIND_LABELS[mc.kind]} "${mc.externalId.includes(':') ? mc.externalId.split(':')[1] : mc.externalId}"`,
        )
        .join(', ')}, not yet linked to Portico.`,
      propertyId,
      missing,
    };
  }
  if (wf.currencyField) {
    const currency = record.payload[wf.currencyField];
    if (typeof currency === 'string' && currency !== property.baseCurrency) {
      return {
        ok: false,
        status: 'held_validation',
        reason: `Amounts are in ${currency} but ${property.name} uses ${property.baseCurrency}. Portico never converts currencies implicitly.`,
        propertyId,
        missing,
      };
    }
  }
  return {
    ok: true,
    propertyId,
    canonical: {
      workflow: record.workflow,
      externalId: record.externalId,
      revision: record.revision,
      propertyId,
      occurredAt: new Date(record.occurredAt).toISOString(),
      propertyTimezone: property.timezone,
      provenance,
      mapped,
      values: record.payload,
    },
  };
}

// ───────────────────────────── Inbound ingestion ─────────────────────────────

async function propertyInfos(
  tx: TxContext,
  deps: IntegrationDeps,
  conn: ConnectionRow,
): Promise<Map<string, PropertyInfo>> {
  const out = new Map<string, PropertyInfo>();
  for (const id of conn.property_ids) out.set(id, await deps.ports.platform.getProperty(tx, id));
  return out;
}

async function upsertWorkflowState(
  tx: TxContext,
  connectionId: string,
  workflow: string,
  set: Record<string, unknown>,
): Promise<void> {
  await db(tx)
    .insertInto('integration.workflow_state')
    .values({ tenant_id: tx.tenantId, connection_id: connectionId, workflow, ...(set as object) })
    .onConflict((oc) =>
      oc
        .columns(['connection_id', 'workflow'])
        .doUpdateSet({ ...(set as object), version: sql`integration.workflow_state.version + 1` }),
    )
    .execute();
}

const OUTCOME_OF_STATUS = {
  applied: 'succeeded',
  stale: 'stale',
  held_mapping: 'held',
  held_validation: 'held',
  rejected: 'rejected',
} as const;

async function applyMessage(
  tx: TxContext,
  conn: ConnectionRow,
  wf: WorkflowDefinition,
  record: { workflow: string; externalId: string; revision: string; revisionOrder: number },
  messageId: string,
  propertyId: string,
  canonical: Record<string, unknown>,
  provenance: ExchangeProvenance,
): Promise<void> {
  await db(tx)
    .insertInto('integration.external_records')
    .values({
      tenant_id: tx.tenantId,
      connection_id: conn.id,
      workflow: record.workflow,
      external_id: record.externalId,
      last_revision: record.revision,
      last_revision_order: record.revisionOrder,
      last_message_id: messageId,
      updated_at: tx.now,
    })
    .onConflict((oc) =>
      oc.columns(['connection_id', 'workflow', 'external_id']).doUpdateSet({
        last_revision: record.revision,
        last_revision_order: record.revisionOrder,
        last_message_id: messageId,
        updated_at: tx.now,
      }),
    )
    .execute();
  // Owning modules apply the change in their own transaction through the outbox (exactly once per event).
  await tx.emit({
    type: 'integration.inbound.applied',
    propertyId,
    aggregate: { type: 'integration_connection', id: conn.id },
    payload: {
      connectionId: conn.id,
      messageId,
      workflow: record.workflow,
      dataDomain: wf.dataDomain,
      externalId: record.externalId,
      revision: record.revision,
      provenance,
      canonical,
    },
  });
}

async function raiseHoldException(
  tx: TxContext,
  conn: ConnectionRow,
  wf: WorkflowDefinition,
  record: InboundRecord,
  t: Extract<Translation, { ok: false }>,
): Promise<void> {
  const info = workflowInfo(wf.workflow);
  const critical = info.critical;
  if (t.status === 'held_mapping' && t.missing.length > 0) {
    for (const mc of t.missing) {
      const kindLabel = MAPPING_KIND_LABELS[mc.kind];
      const code = mc.externalId.includes(':') ? mc.externalId.split(':')[1] : mc.externalId;
      await raiseException(tx, {
        connectionId: conn.id,
        workflow: wf.workflow,
        severity: critical ? 'urgent' : 'routine',
        code: 'unmapped_code',
        dedupeKey: `unmapped:${mc.kind}:${mc.externalId}`,
        propertyId: t.propertyId,
        problem: `${conn.name} sent the ${kindLabel} "${code}", which is not linked to a Portico ${kindLabel}.`,
        businessImpact: `${info.label} using "${code}" are saved but not applied in Portico (for example ${record.summary.toLowerCase()}).`,
        responsibleParty: 'hotel',
        nextStep: `Link "${code}" to a Portico ${kindLabel} in the connection's mappings. Held updates are applied automatically afterwards.`,
        relatedRefs: [{ type: `external.${wf.workflow}`, id: record.externalId }],
        technicalDetail: { externalId: record.externalId, revision: record.revision, missing: t.missing },
      });
    }
    return;
  }
  await raiseException(tx, {
    connectionId: conn.id,
    workflow: wf.workflow,
    severity: critical ? 'urgent' : 'routine',
    code: t.status === 'rejected' ? 'record_rejected' : 'record_held',
    dedupeKey: `${t.status}:${wf.workflow}:${record.externalId}`,
    propertyId: t.propertyId,
    problem: `${record.summary} from ${conn.name} could not be applied: ${t.reason}`,
    businessImpact:
      t.status === 'rejected'
        ? 'The update is recorded but not used in Portico.'
        : 'The update is saved and waits; Portico keeps the previous information meanwhile.',
    responsibleParty: 'hotel',
    nextStep:
      t.status === 'rejected'
        ? 'Check the connection’s property scope. If the property should be included, update the scope.'
        : `Correct the information in ${conn.name} (or the connection settings); the update is retried with the next exchange.`,
    relatedRefs: [{ type: `external.${wf.workflow}`, id: record.externalId }],
    technicalDetail: { externalId: record.externalId, revision: record.revision, reason: t.reason },
  });
}

/** Store and apply received records exactly once, in revision order, never overwriting newer information. */
export async function ingestRecords(
  tx: TxContext,
  deps: IntegrationDeps,
  conn: ConnectionRow,
  def: ConnectorDefinition,
  records: readonly InboundRecord[],
  opts: { syncRunId: string | null; provenance: ExchangeProvenance },
): Promise<Counts> {
  const counts = emptyCounts();
  const lookup = await loadLookup(tx, conn.id);
  const properties = await propertyInfos(tx, deps, conn);
  const scope = parseScope(conn.scope);
  const latencyByWorkflow = new Map<string, number>();
  for (const rec of sortForProcessing(records)) {
    counts.received++;
    const wf = def.workflows.find((w) => w.workflow === rec.workflow);
    const scoped = scopeWorkflow(scope, rec.workflow);
    const base = {
      connectionId: conn.id,
      workflow: rec.workflow,
      direction: 'inbound' as const,
      externalRef: `${rec.externalId}#${rec.revision}`,
      syncRunId: opts.syncRunId,
      provenance: opts.provenance,
    };
    if (!wf || !scoped || !readsWorkflow(scoped.operations)) {
      counts.rejected++;
      await recordExchange(tx, {
        ...base,
        outcome: 'rejected',
        errorClass: 'data',
        summary: `${rec.summary}: not part of this connection's approved scope; ignored.`,
      });
      continue;
    }
    const existing = await db(tx)
      .selectFrom('integration.inbound_messages')
      .select(['id'])
      .where('connection_id', '=', conn.id)
      .where('workflow', '=', rec.workflow)
      .where('external_id', '=', rec.externalId)
      .where('revision', '=', rec.revision)
      .executeTakeFirst();
    if (existing) {
      counts.duplicates++;
      await db(tx)
        .updateTable('integration.inbound_messages')
        .set({ duplicate_count: sql`duplicate_count + 1` })
        .where('id', '=', existing.id)
        .execute();
      await recordExchange(tx, {
        ...base,
        outcome: 'duplicate',
        summary: `${rec.summary}: duplicate delivery, no effect.`,
      });
      continue;
    }
    const watermark = await db(tx)
      .selectFrom('integration.external_records')
      .select(['last_revision', 'last_revision_order'])
      .where('connection_id', '=', conn.id)
      .where('workflow', '=', rec.workflow)
      .where('external_id', '=', rec.externalId)
      .forUpdate()
      .executeTakeFirst();
    const occurredAt = new Date(rec.occurredAt);
    const decision = decideOrdering(
      { revision: rec.revision, revisionOrder: rec.revisionOrder, occurredAt, receivedAt: tx.now },
      watermark
        ? { lastRevision: watermark.last_revision, lastRevisionOrder: Number(watermark.last_revision_order) }
        : null,
      { sequential: wf.sequentialRevisions, freshnessTargetSeconds: wf.freshnessTargetSeconds },
    );
    latencyByWorkflow.set(
      rec.workflow,
      Math.max(latencyByWorkflow.get(rec.workflow) ?? 0, decision.latencySeconds),
    );
    let status: keyof typeof OUTCOME_OF_STATUS;
    let holdReason: string | null = null;
    let propertyId: string | null = null;
    let canonical: Record<string, unknown> | null = null;
    let translation: Translation | null = null;
    if (decision.action === 'stale') {
      status = 'stale';
      holdReason = `A newer version (revision ${decision.newerRevision}) was already applied; this older one is recorded and ignored.`;
    } else {
      translation = translateRecord(wf, rec, lookup, properties, opts.provenance);
      if (!translation.ok) {
        status = translation.status;
        holdReason = translation.reason;
        propertyId = translation.propertyId;
      } else {
        propertyId = translation.propertyId;
        const frozen =
          wf.dataDomain !== null
            ? await deps.ports.transitions.activeTransition(tx, { propertyId, domain: wf.dataDomain })
            : null;
        if (frozen?.state === 'frozen') {
          status = 'held_validation';
          holdReason =
            'The system of record for this information is being switched; the update is queued and applied after the switch.';
        } else {
          status = 'applied';
          canonical = translation.canonical;
        }
      }
    }
    const id = newId(tx.now.getTime());
    const inserted = await db(tx)
      .insertInto('integration.inbound_messages')
      .values({
        id,
        tenant_id: tx.tenantId,
        connection_id: conn.id,
        property_id: propertyId,
        workflow: rec.workflow,
        external_id: rec.externalId,
        revision: rec.revision,
        revision_order: rec.revisionOrder,
        external_occurred_at: occurredAt,
        received_at: tx.now,
        payload: JSON.stringify(rec.payload),
        canonical: canonical ? JSON.stringify(canonical) : null,
        status,
        hold_reason: holdReason,
        gap_detected: decision.action === 'apply' && decision.gapDetected,
        delayed: decision.action === 'apply' && decision.delayed,
        sync_run_id: opts.syncRunId,
        processed_at: tx.now,
      })
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'connection_id', 'workflow', 'external_id', 'revision']).doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
    if (!inserted) {
      counts.duplicates++;
      await recordExchange(tx, {
        ...base,
        outcome: 'duplicate',
        summary: `${rec.summary}: duplicate delivery, no effect.`,
      });
      continue;
    }
    if (status === 'applied' && canonical && propertyId) {
      await applyMessage(tx, conn, wf, rec, id, propertyId, canonical, opts.provenance);
      counts.applied++;
      if (decision.action === 'apply' && decision.gapDetected) {
        await upsertWorkflowState(tx, conn.id, rec.workflow, {
          incomplete_since: sql`coalesce(integration.workflow_state.incomplete_since, ${tx.now})`,
          incomplete_reason: `A missed update was detected for ${rec.externalId} (jumped to revision ${rec.revision} from ${watermark?.last_revision ?? 'none'}).`,
        });
      }
    } else if (status === 'stale') {
      counts.stale++;
    } else if (status === 'rejected') {
      counts.rejected++;
    } else {
      counts.held++;
    }
    if (translation && !translation.ok) {
      for (const mc of translation.missing) {
        await ensureUnmappedRow(tx, conn, {
          kind: mc.kind,
          externalId: mc.externalId,
          label: mc.label,
          propertyId,
        });
      }
      await raiseHoldException(tx, conn, wf, rec, translation);
    }
    const delayedNote =
      decision.action === 'apply' && decision.delayed
        ? ` (arrived ${decision.latencySeconds}s after it happened)`
        : '';
    await recordExchange(tx, {
      ...base,
      propertyId,
      outcome: OUTCOME_OF_STATUS[status],
      errorClass:
        status === 'held_mapping'
          ? 'mapping'
          : status === 'held_validation' || status === 'rejected'
            ? 'data'
            : null,
      summary:
        status === 'applied'
          ? `${rec.summary}: applied${delayedNote}.`
          : status === 'stale'
            ? `${rec.summary}: older than what Portico already has; ignored.`
            : `${rec.summary}: held — ${holdReason}`,
      detail: {
        revision: rec.revision,
        revisionOrder: rec.revisionOrder,
        latencySeconds: decision.latencySeconds,
      },
    });
  }
  for (const [workflow, latency] of latencyByWorkflow) {
    await upsertWorkflowState(tx, conn.id, workflow, {
      last_message_latency_s: latency,
      last_applied_at: tx.now,
    });
  }
  return counts;
}

/** Re-try held records after mappings changed; resolves the matching exceptions once codes are linked. */
export async function reprocessHeld(
  tx: TxContext,
  deps: IntegrationDeps,
  conn: ConnectionRow,
): Promise<{ applied: number; stillHeld: number; stale: number }> {
  const def = registered(deps, conn.connector_key).definition;
  const provenance = provenanceOf(def, tx);
  const held = await db(tx)
    .selectFrom('integration.inbound_messages')
    .selectAll()
    .where('connection_id', '=', conn.id)
    .where('status', 'in', ['held_mapping', 'held_validation'])
    .orderBy('workflow')
    .orderBy('external_id')
    .orderBy('revision_order')
    .execute();
  const lookup = await loadLookup(tx, conn.id);
  const properties = await propertyInfos(tx, deps, conn);
  const result = { applied: 0, stillHeld: 0, stale: 0 };
  for (const m of held) {
    const wf = def.workflows.find((w) => w.workflow === m.workflow);
    if (!wf) continue;
    const payload = m.payload as Record<string, unknown>;
    const rec: InboundRecord = {
      workflow: m.workflow,
      externalId: m.external_id,
      revision: m.revision,
      revisionOrder: Number(m.revision_order),
      occurredAt: new Date(m.external_occurred_at).toISOString(),
      propertyExternalId: typeof payload.propertyCode === 'string' ? payload.propertyCode : null,
      payload,
      summary: `${workflowInfo(m.workflow).label} ${m.external_id}`,
    };
    const watermark = await db(tx)
      .selectFrom('integration.external_records')
      .select(['last_revision_order'])
      .where('connection_id', '=', conn.id)
      .where('workflow', '=', m.workflow)
      .where('external_id', '=', m.external_id)
      .forUpdate()
      .executeTakeFirst();
    if (watermark && Number(watermark.last_revision_order) >= rec.revisionOrder) {
      await db(tx)
        .updateTable('integration.inbound_messages')
        .set({
          status: 'stale',
          hold_reason: 'A newer version was applied meanwhile.',
          processed_at: tx.now,
          version: sql`version + 1`,
        })
        .where('id', '=', m.id)
        .execute();
      result.stale++;
      continue;
    }
    const t = translateRecord(wf, rec, lookup, properties, provenance);
    const frozen =
      t.ok && wf.dataDomain !== null
        ? await deps.ports.transitions.activeTransition(tx, {
            propertyId: t.propertyId,
            domain: wf.dataDomain,
          })
        : null;
    if (!t.ok || frozen?.state === 'frozen') {
      result.stillHeld++;
      continue;
    }
    await db(tx)
      .updateTable('integration.inbound_messages')
      .set({
        status: 'applied',
        canonical: JSON.stringify(t.canonical),
        property_id: t.propertyId,
        hold_reason: null,
        processed_at: tx.now,
        version: sql`version + 1`,
      })
      .where('id', '=', m.id)
      .execute();
    await applyMessage(tx, conn, wf, rec, m.id, t.propertyId, t.canonical, provenance);
    await recordExchange(tx, {
      connectionId: conn.id,
      workflow: m.workflow,
      direction: 'inbound',
      externalRef: `${m.external_id}#${m.revision}`,
      outcome: 'succeeded',
      propertyId: t.propertyId,
      summary: `${rec.summary} (revision ${m.revision}): applied after the hold was cleared.`,
      provenance,
    });
    result.applied++;
  }
  // Close "unmapped code" exceptions whose code is now linked.
  const open = await db(tx)
    .selectFrom('integration.exceptions')
    .select(['dedupe_key'])
    .where('connection_id', '=', conn.id)
    .where('code', '=', 'unmapped_code')
    .where('status', 'in', ['open', 'acknowledged'])
    .execute();
  for (const e of open) {
    const [, kind, ...rest] = e.dedupe_key.split(':');
    const m = lookup.get(`${kind}|${rest.join(':')}`);
    if (m && m.status === 'confirmed') {
      await autoResolveExceptions(
        tx,
        conn.id,
        [e.dedupe_key],
        'The code was linked; held updates were re-applied.',
      );
    }
  }
  return result;
}

/** Review a mapping and, for an operational connection, re-apply updates held for it. */
export async function reviewMappingAndReprocess(
  tx: TxContext,
  deps: IntegrationDeps,
  mappingId: string,
  expectedVersion: number,
  input: Parameters<typeof reviewMapping>[4],
) {
  const res = await reviewMapping(tx, deps, mappingId, expectedVersion, input);
  const conn = await loadConnection(tx, res.mapping.connectionId);
  const reprocessed =
    isOperational(conn.state as ConnectionState) || conn.state === 'paused'
      ? await reprocessHeld(tx, deps, conn)
      : null;
  return { ...res, reprocessed };
}

// ───────────────────────────── Workflow success / failure, interruption, reconnection ─────────────────────────────

export async function recordWorkflowSuccess(
  tx: TxContext,
  deps: IntegrationDeps,
  conn: ConnectionRow,
  workflow: string,
  opts: { latencyMs: number },
): Promise<ConnectionRow> {
  await upsertWorkflowState(tx, conn.id, workflow, {
    last_success_at: tx.now,
    last_attempt_at: tx.now,
    consecutive_failures: 0,
    last_latency_ms: opts.latencyMs,
  });
  let current = await loadConnection(tx, conn.id);
  if (current.interrupted_since) {
    const failing = await db(tx)
      .selectFrom('integration.workflow_state')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('connection_id', '=', conn.id)
      .where('consecutive_failures', '>', 0)
      .executeTakeFirstOrThrow();
    if (failing.n === 0) current = await onReconnected(tx, deps, current, 'the connection recovered');
  }
  if (current.state === 'active') {
    current = await transition(tx, current, 'confirmMonitoring', {
      detail: { reason: 'First successful exchange after activation; health is now monitored.' },
    });
  }
  return current;
}

export async function recordWorkflowFailure(
  tx: TxContext,
  deps: IntegrationDeps,
  conn: ConnectionRow,
  workflow: string,
  err: ConnectorError,
): Promise<ConnectionRow> {
  await upsertWorkflowState(tx, conn.id, workflow, {
    last_attempt_at: tx.now,
    last_failure_at: tx.now,
    last_failure_kind: err.kind,
    last_failure_reason: err.message,
    consecutive_failures: sql`coalesce(integration.workflow_state.consecutive_failures, 0) + 1`,
  });
  const state = await db(tx)
    .selectFrom('integration.workflow_state')
    .select(['consecutive_failures'])
    .where('connection_id', '=', conn.id)
    .where('workflow', '=', workflow)
    .executeTakeFirstOrThrow();
  let current = await loadConnection(tx, conn.id);
  const def = registered(deps, current.connector_key).definition;
  const scope = parseScope(current.scope);
  const impact = buildImpact({
    systemName: current.name,
    situation: 'interrupted',
    properties: [],
    workflows: scope.workflows,
  });
  if (err.kind === 'auth') {
    if (isOperational(current.state as ConnectionState)) {
      current = await transition(tx, current, 'fail', {
        patch: {
          resume_state: current.state,
          interrupted_since: current.interrupted_since ?? tx.now,
          interruption_reason: `${current.name} rejected Portico's credential`,
        },
        detail: { reason: err.message },
      });
    }
    await raiseException(tx, {
      connectionId: current.id,
      workflow: null,
      severity: 'urgent',
      code: 'credential_rejected',
      dedupeKey: 'credential_rejected',
      problem: `Portico can no longer exchange information with ${current.name}: ${err.message}`,
      businessImpact: `${impact.summary} Reads have stopped and actions are held (not sent, not lost).`,
      responsibleParty: 'hotel',
      nextStep: `Ask the ${def.name} administrator to renew Portico's access, then rotate the credential in Portico. Held work is checked before anything is sent.`,
      technicalDetail: { kind: err.kind, ...(err.vendorDetail ?? {}) },
    });
    return current;
  }
  if (state.consecutive_failures >= INTERRUPTION_THRESHOLD) {
    if (!current.interrupted_since) {
      current = await db(tx)
        .updateTable('integration.connections')
        .set({
          interrupted_since: tx.now,
          interruption_reason: err.message,
          version: sql`version + 1`,
        })
        .where('id', '=', current.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    }
    const info = workflowInfo(workflow);
    await raiseException(tx, {
      connectionId: current.id,
      workflow,
      severity: 'urgent',
      code: 'workflow_failing',
      dedupeKey: `workflow_failing:${workflow}`,
      problem: `Portico cannot exchange ${info.label.toLowerCase()} with ${current.name}: ${err.message}`,
      businessImpact:
        impact.hotelFunctions.find((h) => h.workflow === workflow)?.effect ??
        `${info.hotelFunction} information from ${current.name} is getting older.`,
      responsibleParty: responsibleFor(err.kind),
      nextStep: `Portico retries automatically with increasing pauses. Meanwhile work in ${current.name} directly; money and inventory actions will be held for your confirmation when it comes back.`,
      technicalDetail: { kind: err.kind, failures: state.consecutive_failures, ...(err.vendorDetail ?? {}) },
    });
  }
  return current;
}

/**
 * The connection is back (resume, recovery after an outage, credential renewed). State-setting commands are
 * coalesced to the newest per record; money / inventory commands queued before now are held for revalidation.
 */
export async function onReconnected(
  tx: TxContext,
  deps: IntegrationDeps,
  conn: ConnectionRow,
  reason: string,
): Promise<ConnectionRow> {
  const since = conn.interrupted_since ? new Date(conn.interrupted_since) : null;
  const updated = await db(tx)
    .updateTable('integration.connections')
    .set({
      interrupted_since: null,
      interruption_reason: null,
      last_reconnected_at: tx.now,
      version: sql`version + 1`,
    })
    .where('id', '=', conn.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  const commands = await db(tx)
    .selectFrom('integration.outbound_commands')
    .selectAll()
    .where('connection_id', '=', conn.id)
    .where('status', 'in', ['queued', 'pending_verification', 'sending'])
    .forUpdate()
    .execute();
  const supersede = supersededStateCommands(
    commands.map((c) => ({
      id: c.id,
      effectClass: c.effect_class,
      businessKey: c.business_key,
      enqueuedAt: new Date(c.enqueued_at),
      status: c.status,
    })),
  );
  if (supersede.length > 0) {
    await db(tx)
      .updateTable('integration.outbound_commands')
      .set({
        status: 'superseded',
        completed_at: tx.now,
        revalidation_reason:
          'Superseded by a newer state for the same record: only the latest is sent after reconnection.',
        lease_until: null,
        version: sql`version + 1`,
      })
      .where('id', 'in', supersede)
      .execute();
  }
  const def = registered(deps, conn.connector_key).definition;
  const risky = commands.filter(
    (c) =>
      !supersede.includes(c.id) &&
      mustRevalidateOnReconnect(
        {
          status: c.status,
          effectClass: c.effect_class,
          enqueuedAt: new Date(c.enqueued_at),
          attempts: c.attempts,
        },
        tx.now,
      ),
  );
  const refs: EntityRef[] = [];
  for (const c of risky) {
    const ageHours = (tx.now.getTime() - new Date(c.enqueued_at).getTime()) / 3_600_000;
    await db(tx)
      .updateTable('integration.outbound_commands')
      .set({
        status: 'needs_revalidation',
        verify_before_send: true,
        lease_until: null,
        revalidation_reason: `Queued while ${conn.name} was unreachable${since ? ` (since ${since.toISOString()})` : ''}. Check it is still right before resending${ageHours > MONEY_STALENESS_HOURS ? '; it is more than 24 hours old' : ''}.`,
        version: sql`version + 1`,
      })
      .where('id', '=', c.id)
      .execute();
    refs.push(
      c.source_ref ? (c.source_ref as EntityRef) : { type: 'integration_outbound_command', id: c.id },
    );
  }
  if (risky.length > 0) {
    await raiseException(tx, {
      connectionId: conn.id,
      workflow: null,
      severity: 'urgent',
      code: 'actions_need_revalidation',
      dedupeKey: 'actions_need_revalidation',
      problem: `${risky.length} money or inventory action${risky.length === 1 ? '' : 's'} for ${conn.name} were held when the connection came back.`,
      businessImpact:
        'They were not sent automatically, so no guest is charged twice and no sold room is reopened. Until decided, the affected records show as pending in Portico.',
      responsibleParty: 'hotel',
      nextStep: `Review each held action: resend (Portico first checks whether ${conn.name} already has it) or cancel.`,
      relatedRefs: refs,
    });
  }
  await autoResolveExceptions(
    tx,
    conn.id,
    ['workflow_failing:', 'credential_rejected'],
    `Connection restored at ${tx.now.toISOString()}.`,
  );
  await recordStep(tx, conn, {
    step: 0,
    action: 'reconnected',
    outcome: 'lifecycle',
    from: conn.state,
    to: updated.state,
    detail: { reason, heldForRevalidation: risky.length, superseded: supersede.length, connector: def.key },
  });
  await tx.audit({
    action: 'integration.connection.reconnected',
    target: { type: 'integration_connection', id: conn.id },
    reason,
    after: { heldForRevalidation: risky.map((c) => c.id), superseded: supersede },
  });
  return updated;
}

// ───────────────────────────── Sync runs ─────────────────────────────

function toSyncRun(r: Selectable<SyncRunsTable>): SyncRun {
  return {
    id: r.id,
    connectionId: r.connection_id,
    workflow: r.workflow,
    trigger: r.trigger,
    status: r.status,
    counts: { ...emptyCounts(), ...((r.counts as Partial<Counts>) ?? {}) },
    provenance: r.provenance as ExchangeProvenance,
    fileId: r.file_id,
    error: (r.error as Record<string, unknown> | null) ?? null,
    startedAt: new Date(r.started_at).toISOString(),
    finishedAt: iso(r.finished_at),
  };
}

export async function listSyncRuns(tx: TxContext, connectionId: string): Promise<SyncRun[]> {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.connectionRead, 'any');
  const rows = await db(tx)
    .selectFrom('integration.sync_runs')
    .selectAll()
    .where('connection_id', '=', connectionId)
    .orderBy('started_at', 'desc')
    .limit(100)
    .execute();
  return rows.map(toSyncRun);
}

function notActiveError(conn: ConnectionRow): BusinessRuleError {
  const hint: Record<string, string> = {
    paused: 'The connection is paused. Resume it first.',
    error: `${conn.name} rejected Portico's credential. Rotate the credential first.`,
    disconnected: 'The connection is disconnected.',
  };
  return new BusinessRuleError(
    'connection_not_active',
    hint[conn.state] ?? 'The connection is not active yet. Finish the setup journey and activate it first.',
    { state: conn.state },
  );
}

/**
 * Read changes from the external system for the connection's read workflows (periodic, manual, or a
 * reconciliation that re-reads recent records to recover missed updates). External calls run outside the
 * database transaction; records are acknowledged to the vendor only after Portico committed them.
 */
export async function runSync(
  database: PorticoDatabase,
  deps: IntegrationDeps,
  ctx: RequestContext,
  connectionId: string,
  opts: { trigger: 'periodic' | 'manual' | 'reconciliation'; workflow?: string },
): Promise<SyncRun> {
  const prep = await withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, connectionId);
    if (opts.trigger !== 'periodic') requireOnConnection(tx, conn, P.syncRunTrigger);
    if (!isOperational(conn.state as ConnectionState)) throw notActiveError(conn);
    const reg = registered(deps, conn.connector_key);
    const def = reg.definition;
    if (def.fileBased) {
      throw new BusinessRuleError(
        'file_based_connection',
        'This is a file exchange, not a live connection: it updates only when someone imports a file.',
      );
    }
    const scope = parseScope(conn.scope);
    const workflows = scope.workflows
      .filter((w) => readsWorkflow(w.operations))
      .map((w) => def.workflows.find((d) => d.workflow === w.workflow))
      .filter((w): w is WorkflowDefinition => !!w && w.sync !== 'file')
      .filter((w) => !opts.workflow || w.workflow === opts.workflow);
    if (workflows.length === 0) {
      throw new ValidationError(
        'no_workflow_to_sync',
        'There is no reading workflow in this connection’s approved scope to synchronize.',
      );
    }
    const call = await prepareCall(tx, deps, conn, {
      kind: 'read',
      workflow: workflows[0]?.workflow ?? 'sync',
    });
    const runId = newId(tx.now.getTime());
    await db(tx)
      .insertInto('integration.sync_runs')
      .values({
        id: runId,
        tenant_id: tx.tenantId,
        connection_id: conn.id,
        workflow: opts.workflow ?? null,
        trigger: opts.trigger,
        status: 'running',
        counts: JSON.stringify(emptyCounts()),
        file_id: null,
        provenance: provenanceOf(def, tx),
        error: null,
        started_at: tx.now,
        finished_at: null,
        actor_key: actorKey(tx),
      })
      .execute();
    return { conn, def, call, workflows, runId, provenance: provenanceOf(def, tx) };
  });

  const results: Array<{
    workflow: string;
    records: InboundRecord[];
    latencyMs: number;
    error: ConnectorError | null;
  }> = [];
  for (const wf of prep.workflows) {
    const started = Date.now();
    try {
      let records: InboundRecord[];
      if (opts.trigger === 'reconciliation' && prep.call.adapter.sample) {
        records = await prep.call.adapter.sample(prep.call.actx, { workflow: wf.workflow, limit: 500 });
      } else if (prep.call.adapter.pull) {
        records = (await prep.call.adapter.pull(prep.call.actx, { workflow: wf.workflow, cursor: null }))
          .records;
      } else {
        throw new ConnectorError('invalid', `${prep.def.name} cannot be read for ${wf.workflow}.`);
      }
      results.push({ workflow: wf.workflow, records, latencyMs: Date.now() - started, error: null });
    } catch (err) {
      results.push({
        workflow: wf.workflow,
        records: [],
        latencyMs: Date.now() - started,
        error: asConnectorError(err, 'read'),
      });
    }
  }

  const run = await withTenantTx(database, ctx, async (tx) => {
    let conn = await loadConnection(tx, connectionId);
    const total = emptyCounts();
    const errors: Array<{ workflow: string; kind: string; message: string }> = [];
    for (const r of results) {
      if (r.error) {
        errors.push({ workflow: r.workflow, kind: r.error.kind, message: r.error.message });
        await recordExchange(tx, {
          connectionId: conn.id,
          workflow: r.workflow,
          direction: 'inbound',
          outcome: 'failed',
          errorClass: errorClassOf(r.error.kind),
          latencyMs: r.latencyMs,
          summary: `Could not read ${workflowInfo(r.workflow).label.toLowerCase()} from ${conn.name}: ${r.error.message}`,
          detail: { kind: r.error.kind, ...(r.error.vendorDetail ?? {}) },
          syncRunId: prep.runId,
          provenance: prep.provenance,
        });
        conn = await recordWorkflowFailure(tx, deps, conn, r.workflow, r.error);
        continue;
      }
      const c = await ingestRecords(tx, deps, conn, prep.def, r.records, {
        syncRunId: prep.runId,
        provenance: prep.provenance,
      });
      for (const k of Object.keys(total) as Array<keyof Counts>) total[k] += c[k];
      conn = await recordWorkflowSuccess(tx, deps, conn, r.workflow, { latencyMs: r.latencyMs });
      if (opts.trigger === 'reconciliation') {
        await upsertWorkflowState(tx, conn.id, r.workflow, {
          incomplete_since: null,
          incomplete_reason: null,
        });
      }
    }
    const status =
      errors.length === 0 ? 'succeeded' : errors.length === results.length ? 'failed' : 'partial';
    const row = await db(tx)
      .updateTable('integration.sync_runs')
      .set({
        status,
        counts: JSON.stringify(total),
        error: errors.length > 0 ? JSON.stringify({ errors }) : null,
        finished_at: tx.now,
        version: sql`version + 1`,
      })
      .where('id', '=', prep.runId)
      .returningAll()
      .executeTakeFirstOrThrow();
    const interval = Math.min(...prep.workflows.map((w) => w.expectedIntervalSeconds ?? 300));
    const next = new Date(tx.now.getTime() + interval * 1000);
    await db(tx)
      .updateTable('integration.connections')
      .set({ next_sync_at: next })
      .where('id', '=', conn.id)
      .execute();
    await scheduleTenant(tx, next);
    await tx.emit({
      type: 'integration.syncRun.completed',
      aggregate: { type: 'integration_connection', id: conn.id },
      payload: { connectionId: conn.id, syncRunId: prep.runId, trigger: opts.trigger, status, counts: total },
    });
    await refreshHealth(tx, deps, conn);
    return row;
  });

  if (prep.call.adapter.acknowledge) {
    for (const r of results) {
      if (r.error || r.records.length === 0) continue;
      try {
        await prep.call.adapter.acknowledge(prep.call.actx, {
          workflow: r.workflow,
          records: r.records.map((x) => ({ externalId: x.externalId, revision: x.revision })),
        });
      } catch {
        // Unacknowledged records are delivered again and deduplicated.
      }
    }
  }
  return toSyncRun(run);
}

// ───────────────────────────── Files (file-based connector) ─────────────────────────────

export async function importFile(
  tx: TxContext,
  deps: IntegrationDeps,
  connectionId: string,
  input: { workflow: string; fileName: string; content: string },
): Promise<{ fileId: string; storedAsSample: boolean; syncRun: SyncRun | null }> {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.syncRunTrigger);
  const reg = registered(deps, conn.connector_key);
  const def = reg.definition;
  if (!def.fileBased || !reg.adapter?.parseFile) {
    throw new BusinessRuleError(
      'not_file_based',
      `${def.name} is not a file connection; it exchanges information directly.`,
    );
  }
  const wf = def.workflows.find(
    (w) => w.workflow === input.workflow && w.sync === 'file' && readsWorkflow(w.operations),
  );
  if (!wf)
    throw new ValidationError('unknown_workflow', `${def.name} cannot import "${input.workflow}" files.`);
  if (conn.state === 'disconnected') throw notActiveError(conn);
  const fileId = newId(tx.now.getTime());
  await db(tx)
    .insertInto('integration.files')
    .values({
      id: fileId,
      tenant_id: tx.tenantId,
      connection_id: conn.id,
      direction: 'import',
      workflow: input.workflow,
      name: input.fileName,
      content_type: 'text/csv',
      sha256: sha256Hex(input.content),
      size_bytes: Buffer.byteLength(input.content, 'utf8'),
      content: input.content,
      created_at: tx.now,
      actor_key: actorKey(tx),
    })
    .execute();
  // During setup a file is a SAMPLE for mapping and validation; it is not applied.
  if (!isOperational(conn.state as ConnectionState)) return { fileId, storedAsSample: true, syncRun: null };
  const provenance = provenanceOf(def, tx);
  const runId = newId(tx.now.getTime());
  let records: InboundRecord[] = [];
  let error: ConnectorError | null = null;
  try {
    records = reg.adapter.parseFile(input.workflow, input.content, input.fileName);
  } catch (err) {
    error = asConnectorError(err, 'read');
  }
  await db(tx)
    .insertInto('integration.sync_runs')
    .values({
      id: runId,
      tenant_id: tx.tenantId,
      connection_id: conn.id,
      workflow: input.workflow,
      trigger: 'file',
      status: 'running',
      counts: JSON.stringify(emptyCounts()),
      file_id: fileId,
      provenance,
      error: null,
      started_at: tx.now,
      finished_at: null,
      actor_key: actorKey(tx),
    })
    .execute();
  let counts = emptyCounts();
  if (error) {
    await recordExchange(tx, {
      connectionId: conn.id,
      workflow: input.workflow,
      direction: 'inbound',
      outcome: 'rejected',
      errorClass: 'data',
      summary: `File ${input.fileName} could not be read: ${error.message}`,
      syncRunId: runId,
      provenance,
    });
    await raiseException(tx, {
      connectionId: conn.id,
      workflow: input.workflow,
      severity: 'routine',
      code: 'file_unreadable',
      dedupeKey: `file_unreadable:${fileId}`,
      problem: `The file ${input.fileName} could not be imported: ${error.message}`,
      businessImpact: `Nothing from this file was applied; Portico still shows the previous import.`,
      responsibleParty: 'hotel',
      nextStep: 'Fix the file (columns and formats as described in the connector) and import it again.',
    });
  } else {
    counts = await ingestRecords(tx, deps, conn, def, records, { syncRunId: runId, provenance });
    await upsertWorkflowState(tx, conn.id, input.workflow, {
      last_success_at: tx.now,
      last_attempt_at: tx.now,
      consecutive_failures: 0,
    });
  }
  const row = await db(tx)
    .updateTable('integration.sync_runs')
    .set({
      status: error ? 'failed' : 'succeeded',
      counts: JSON.stringify(counts),
      error: error ? JSON.stringify({ kind: error.kind, message: error.message }) : null,
      finished_at: tx.now,
      version: sql`version + 1`,
    })
    .where('id', '=', runId)
    .returningAll()
    .executeTakeFirstOrThrow();
  if (!error && conn.state === 'active') {
    await transition(tx, conn, 'confirmMonitoring', {
      detail: { reason: 'First file imported after activation.' },
    });
  }
  await refreshHealth(tx, deps, await loadConnection(tx, conn.id));
  return { fileId, storedAsSample: false, syncRun: toSyncRun(row) };
}

/**
 * Export queued lines (e.g. journals) as a CSV file. Exported lines are marked "exported" — never "synced" or
 * "confirmed": Portico cannot know whether the other system imported the file.
 */
export async function exportFile(
  tx: TxContext,
  deps: IntegrationDeps,
  connectionId: string,
  input: { workflow: string },
): Promise<{
  fileId: string;
  name: string;
  contentType: string;
  content: string;
  rows: number;
  syncRunId: string;
  notice: string;
}> {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.syncRunTrigger);
  const reg = registered(deps, conn.connector_key);
  if (!reg.definition.fileBased || !reg.adapter?.renderFile) {
    throw new BusinessRuleError('not_file_based', `${reg.definition.name} is not a file connection.`);
  }
  if (!isOperational(conn.state as ConnectionState)) throw notActiveError(conn);
  const commands = await db(tx)
    .selectFrom('integration.outbound_commands')
    .selectAll()
    .where('connection_id', '=', conn.id)
    .where('workflow', '=', input.workflow)
    .where('status', '=', 'queued')
    .orderBy('enqueued_at')
    .forUpdate()
    .execute();
  const rendered = reg.adapter.renderFile(
    input.workflow,
    commands.map((c) => ({
      idempotencyKey: c.idempotency_key,
      operation: c.operation,
      payload: c.payload as Record<string, unknown>,
    })),
  );
  const fileId = newId(tx.now.getTime());
  const name = `${input.workflow}-${tx.now.toISOString().replace(/[:.]/g, '-')}${tx.environment === 'live' ? '' : `-${tx.environment.toUpperCase()}`}.${rendered.fileExtension}`;
  await db(tx)
    .insertInto('integration.files')
    .values({
      id: fileId,
      tenant_id: tx.tenantId,
      connection_id: conn.id,
      direction: 'export',
      workflow: input.workflow,
      name,
      content_type: rendered.contentType,
      sha256: sha256Hex(rendered.content),
      size_bytes: Buffer.byteLength(rendered.content, 'utf8'),
      content: rendered.content,
      created_at: tx.now,
      actor_key: actorKey(tx),
    })
    .execute();
  const runId = newId(tx.now.getTime());
  const provenance = provenanceOf(reg.definition, tx);
  await db(tx)
    .insertInto('integration.sync_runs')
    .values({
      id: runId,
      tenant_id: tx.tenantId,
      connection_id: conn.id,
      workflow: input.workflow,
      trigger: 'file',
      status: 'succeeded',
      counts: JSON.stringify({ ...emptyCounts(), exported: commands.length }),
      file_id: fileId,
      provenance,
      error: null,
      started_at: tx.now,
      finished_at: tx.now,
      actor_key: actorKey(tx),
    })
    .execute();
  if (commands.length > 0) {
    await db(tx)
      .updateTable('integration.outbound_commands')
      .set({
        status: 'exported',
        completed_at: tx.now,
        external_ref: `file:${fileId}`,
        version: sql`version + 1`,
      })
      .where(
        'id',
        'in',
        commands.map((c) => c.id),
      )
      .execute();
  }
  for (const c of commands) {
    await recordExchange(tx, {
      connectionId: conn.id,
      workflow: input.workflow,
      direction: 'outbound',
      operation: c.operation,
      idempotencyKey: c.idempotency_key,
      externalRef: `file:${fileId}`,
      outcome: 'exported',
      propertyId: c.property_id,
      summary: `Written to export file ${name} — not confirmed by the receiving system.`,
      syncRunId: runId,
      provenance,
    });
    await tx.emit({
      type: 'integration.outbound.exported',
      propertyId: c.property_id,
      aggregate: { type: 'integration_outbound_command', id: c.id },
      payload: {
        commandId: c.id,
        connectionId: conn.id,
        workflow: c.workflow,
        sourceRef: c.source_ref,
        fileId,
      },
    });
  }
  await tx.audit({
    action: 'integration.file.export',
    target: { type: 'integration_connection', id: conn.id },
    after: { fileId, name, rows: commands.length, workflow: input.workflow },
  });
  return {
    fileId,
    name,
    contentType: rendered.contentType,
    content: rendered.content,
    rows: commands.length,
    syncRunId: runId,
    notice:
      'File exchange — not a live connection. These lines are marked "exported", not confirmed. Importing this file twice into the other system will duplicate entries there.',
  };
}

// ───────────────────────────── Outbound commands ─────────────────────────────

function toCommand(r: Selectable<OutboundCommandsTable>): OutboundCommand {
  return {
    id: r.id,
    connectionId: r.connection_id,
    propertyId: r.property_id,
    workflow: r.workflow,
    operation: r.operation,
    idempotencyKey: r.idempotency_key,
    effectClass: r.effect_class,
    status: r.status,
    businessKey: r.business_key,
    attempts: r.attempts,
    externalRef: r.external_ref,
    sourceRef: (r.source_ref as EntityRef | null) ?? null,
    revalidationReason: r.revalidation_reason,
    lastError: (r.last_error as Record<string, unknown> | null) ?? null,
    enqueuedAt: new Date(r.enqueued_at).toISOString(),
    completedAt: iso(r.completed_at),
    version: r.version,
  };
}

export interface EnqueueOutboundInput {
  connectionId: string;
  propertyId: string | null;
  workflow: string;
  operation: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  sourceRef?: EntityRef;
  businessKey?: string;
  effectClassHint?: EffectClass;
}

/**
 * Queue an action for the external system (data authority `forward`, exports, pushes). Idempotent on the key:
 * the same key with the same payload returns the existing command; with another payload it is refused.
 */
export async function enqueueOutbound(
  tx: TxContext,
  deps: IntegrationDeps,
  input: EnqueueOutboundInput,
): Promise<{
  commandId: string;
  status: OutboundCommand['status'];
  effectClass: EffectClass;
  duplicate: boolean;
}> {
  const conn = await loadConnection(tx, input.connectionId);
  if (input.propertyId && !conn.property_ids.includes(input.propertyId)) {
    throw new BusinessRuleError('property_not_in_scope', 'This connection does not cover that property.');
  }
  const state = conn.state as ConnectionState;
  if (!isOperational(state) && state !== 'paused' && state !== 'error') {
    throw new BusinessRuleError(
      'connection_not_active',
      `${conn.name} is not active, so actions cannot be queued for it. Activate it first.`,
      { state },
    );
  }
  const reg = registered(deps, conn.connector_key);
  const def = reg.definition;
  const wf = def.workflows.find((w) => w.workflow === input.workflow);
  const scoped = scopeWorkflow(parseScope(conn.scope), input.workflow);
  if (!wf || !scoped || !writesWorkflow(scoped.operations)) {
    throw new BusinessRuleError(
      'workflow_not_in_scope',
      `${conn.name} is not approved to receive ${input.workflow} changes from Portico. Make the change in ${conn.name} directly, or extend the connection's scope.`,
      { workflow: input.workflow },
    );
  }
  // Environment safety at the point of intent: trial organizations can never queue writes (G-03, INT-I07).
  await gateEffect(tx, deps, def, {
    workflow: input.workflow,
    kind: 'write',
    connectionId: conn.id,
    propertyIds: input.propertyId ? [input.propertyId] : conn.property_ids,
  });
  const effectClass = stricterEffect(wf.effects[input.operation] ?? 'standard', input.effectClassHint);
  const id = newId(tx.now.getTime());
  const inserted = await db(tx)
    .insertInto('integration.outbound_commands')
    .values({
      id,
      tenant_id: tx.tenantId,
      connection_id: conn.id,
      property_id: input.propertyId,
      workflow: input.workflow,
      operation: input.operation,
      idempotency_key: input.idempotencyKey,
      business_key: input.businessKey ?? null,
      effect_class: effectClass,
      payload: JSON.stringify(input.payload),
      source_ref: input.sourceRef ? JSON.stringify(input.sourceRef) : null,
      status: 'queued',
      next_attempt_at: tx.now,
      lease_until: null,
      last_error: null,
      external_ref: null,
      revalidation_reason: null,
      revalidated_by: null,
      revalidated_at: null,
      enqueued_at: tx.now,
      completed_at: null,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'connection_id', 'idempotency_key']).doNothing())
    .returning(['id', 'status'])
    .executeTakeFirst();
  if (!inserted) {
    const existing = await db(tx)
      .selectFrom('integration.outbound_commands')
      .selectAll()
      .where('connection_id', '=', conn.id)
      .where('idempotency_key', '=', input.idempotencyKey)
      .executeTakeFirstOrThrow();
    if (
      canonicalJson(existing.payload) !== canonicalJson(input.payload) ||
      existing.operation !== input.operation
    ) {
      throw new IdempotencyConflictError(
        'This idempotency key was already used for a different action on this connection. Use a new key for a new action.',
      );
    }
    return {
      commandId: existing.id,
      status: existing.status,
      effectClass: existing.effect_class,
      duplicate: true,
    };
  }
  await scheduleTenant(tx, tx.now);
  return { commandId: id, status: 'queued', effectClass, duplicate: false };
}

export interface DispatchResult {
  attempted: number;
  acknowledged: number;
  verifiedAlreadyApplied: number;
  rejected: number;
  pendingVerification: number;
  heldForRevalidation: number;
  retrying: number;
}

/** Send due commands for one connection, applying the reconnection and verification rules. */
export async function dispatchOutbound(
  database: PorticoDatabase,
  deps: IntegrationDeps,
  ctx: RequestContext,
  connectionId: string,
  opts: { limit?: number; manual?: boolean } = {},
): Promise<DispatchResult> {
  const result: DispatchResult = {
    attempted: 0,
    acknowledged: 0,
    verifiedAlreadyApplied: 0,
    rejected: 0,
    pendingVerification: 0,
    heldForRevalidation: 0,
    retrying: 0,
  };
  const claim = await withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, connectionId);
    if (opts.manual) requireOnConnection(tx, conn, P.syncRunTrigger);
    const reg = registered(deps, conn.connector_key);
    if (!isOperational(conn.state as ConnectionState) || reg.definition.fileBased || !reg.adapter?.send)
      return null;
    // A send that crashed mid-flight has an unknown outcome.
    await db(tx)
      .updateTable('integration.outbound_commands')
      .set({
        status: 'pending_verification',
        verify_before_send: true,
        lease_until: null,
        version: sql`version + 1`,
      })
      .where('connection_id', '=', conn.id)
      .where('status', '=', 'sending')
      .where('lease_until', '<', tx.now)
      .execute();
    const due = await db(tx)
      .selectFrom('integration.outbound_commands')
      .selectAll()
      .where('connection_id', '=', conn.id)
      .where('status', 'in', ['queued', 'pending_verification'])
      .where('next_attempt_at', '<=', tx.now)
      .orderBy('enqueued_at')
      .limit(opts.limit ?? 20)
      .forUpdate()
      .skipLocked()
      .execute();
    const claimed: Array<Selectable<OutboundCommandsTable> & { verifyFirst: boolean }> = [];
    for (const c of due) {
      const gate = sendGate(
        {
          status: c.status,
          effectClass: c.effect_class,
          enqueuedAt: new Date(c.enqueued_at),
          attempts: c.attempts,
          verifyBeforeSend: c.verify_before_send,
        },
        { operational: true, interrupted: conn.interrupted_since !== null },
      );
      if (!gate.send) continue;
      const row = await db(tx)
        .updateTable('integration.outbound_commands')
        .set({
          status: 'sending',
          lease_until: new Date(tx.now.getTime() + 60_000),
          attempts: sql`attempts + 1`,
          version: sql`version + 1`,
        })
        .where('id', '=', c.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      claimed.push({ ...row, verifyFirst: gate.verifyFirst });
    }
    if (claimed.length === 0) return null;
    const call = await prepareCall(tx, deps, conn, {
      kind: 'write',
      workflow: claimed[0]?.workflow ?? 'outbound',
    });
    const propMaps = await db(tx)
      .selectFrom('integration.mappings')
      .select(['external_id', 'internal_id'])
      .where('connection_id', '=', conn.id)
      .where('kind', '=', 'property')
      .where('status', '=', 'confirmed')
      .execute();
    const extProperty = new Map(propMaps.map((m) => [m.internal_id as string, m.external_id]));
    return { conn, call, claimed, extProperty, provenance: provenanceOf(reg.definition, tx) };
  });
  if (!claim) return result;

  for (const c of claim.claimed) {
    result.attempted++;
    const req = {
      workflow: c.workflow,
      operation: c.operation,
      idempotencyKey: c.idempotency_key,
      propertyExternalId: c.property_id ? (claim.extProperty.get(c.property_id) ?? null) : null,
      payload: c.payload as Record<string, unknown>,
    };
    const started = Date.now();
    type Outcome =
      | { kind: 'ack'; externalRef: string; verified: boolean }
      | { kind: 'revalidate'; reason: string }
      | { kind: 'error'; err: ConnectorError };
    let outcome: Outcome | undefined;
    try {
      let send = true;
      if (c.verifyFirst) {
        if (claim.call.adapter.lookup) {
          const found = await claim.call.adapter.lookup(claim.call.actx, req);
          if (found.found) {
            outcome = { kind: 'ack', externalRef: found.externalRef ?? 'verified', verified: true };
            send = false;
          } else if (afterNegativeLookup(c.effect_class) === 'needs_revalidation' && !c.revalidated_at) {
            outcome = {
              kind: 'revalidate',
              reason: `${claim.conn.name} has no record of this action, but its outcome was uncertain. Confirm it is still needed before resending.`,
            };
            send = false;
          }
        } else if (isRisky(c.effect_class) && !c.revalidated_at) {
          outcome = {
            kind: 'revalidate',
            reason: `${claim.conn.name} cannot be asked whether it already applied this action. Check it there before resending.`,
          };
          send = false;
        }
      }
      if (send) {
        const res = await claim.call.adapter.send?.(claim.call.actx, req);
        outcome = { kind: 'ack', externalRef: res?.externalRef ?? 'sent', verified: false };
      }
    } catch (err) {
      outcome = { kind: 'error', err: asConnectorError(err, 'send') };
    }
    const latencyMs = Date.now() - started;
    const final: Outcome = outcome ?? {
      kind: 'error',
      err: new ConnectorError('timeout', 'No outcome recorded.'),
    };
    await withTenantTx(database, ctx, async (tx) => {
      let conn = await loadConnection(tx, connectionId);
      const base = {
        connectionId: conn.id,
        workflow: c.workflow,
        direction: 'outbound' as const,
        operation: c.operation,
        idempotencyKey: c.idempotency_key,
        propertyId: c.property_id,
        latencyMs,
        provenance: claim.provenance,
      };
      if (final.kind === 'ack') {
        await db(tx)
          .updateTable('integration.outbound_commands')
          .set({
            status: 'acknowledged',
            external_ref: final.externalRef,
            completed_at: tx.now,
            lease_until: null,
            last_error: null,
            version: sql`version + 1`,
          })
          .where('id', '=', c.id)
          .execute();
        await recordExchange(tx, {
          ...base,
          externalRef: final.externalRef,
          outcome: 'succeeded',
          summary: final.verified
            ? `${conn.name} already had this ${c.operation} (${final.externalRef}); verified and not sent again.`
            : `${c.workflow} ${c.operation} sent to ${conn.name} and confirmed (${final.externalRef}).`,
        });
        await tx.emit({
          type: 'integration.outbound.acknowledged',
          propertyId: c.property_id,
          aggregate: { type: 'integration_outbound_command', id: c.id },
          payload: {
            commandId: c.id,
            connectionId: conn.id,
            workflow: c.workflow,
            sourceRef: c.source_ref,
            externalRef: final.externalRef,
            verified: final.verified,
          },
        });
        if (final.verified) result.verifiedAlreadyApplied++;
        else result.acknowledged++;
        conn = await recordWorkflowSuccess(tx, deps, conn, c.workflow, { latencyMs });
      } else if (final.kind === 'revalidate') {
        await db(tx)
          .updateTable('integration.outbound_commands')
          .set({
            status: 'needs_revalidation',
            revalidation_reason: final.reason,
            lease_until: null,
            version: sql`version + 1`,
          })
          .where('id', '=', c.id)
          .execute();
        await recordExchange(tx, { ...base, outcome: 'held', summary: `Not sent: ${final.reason}` });
        await raiseException(tx, {
          connectionId: conn.id,
          workflow: c.workflow,
          severity: 'urgent',
          code: 'actions_need_revalidation',
          dedupeKey: 'actions_need_revalidation',
          problem: `An action for ${conn.name} has an uncertain outcome and was held.`,
          businessImpact:
            'It was not sent again automatically, so nothing is charged twice or reopened by mistake.',
          responsibleParty: 'hotel',
          nextStep: `Check ${conn.name}, then resend or cancel the held action.`,
          relatedRefs: [
            c.source_ref ? (c.source_ref as EntityRef) : { type: 'integration_outbound_command', id: c.id },
          ],
        });
        result.heldForRevalidation++;
      } else {
        const err = final.err;
        const fo = outcomeOfFailure(err.kind, c.attempts);
        if (fo.status === 'rejected') {
          await db(tx)
            .updateTable('integration.outbound_commands')
            .set({
              status: 'rejected',
              completed_at: tx.now,
              lease_until: null,
              last_error: JSON.stringify({ kind: err.kind, message: err.message }),
              version: sql`version + 1`,
            })
            .where('id', '=', c.id)
            .execute();
          await recordExchange(tx, {
            ...base,
            outcome: 'rejected',
            errorClass: errorClassOf(err.kind),
            summary: `${conn.name} refused: ${err.message}`,
            detail: err.vendorDetail ?? null,
          });
          const money = c.effect_class === 'money';
          await raiseException(tx, {
            connectionId: conn.id,
            workflow: c.workflow,
            severity: money || c.effect_class === 'inventory_reopen' ? 'urgent' : 'routine',
            code: 'action_rejected',
            dedupeKey: `action_rejected:${c.id}`,
            propertyId: c.property_id,
            problem: `${conn.name} refused a ${workflowInfo(c.workflow).label.toLowerCase()} ${c.operation} from Portico: ${err.message}`,
            businessImpact: money
              ? `The amount is recorded in Portico but is NOT on the guest's bill in ${conn.name}.`
              : `The change is recorded in Portico but not in ${conn.name}.`,
            responsibleParty: 'hotel',
            nextStep: `Fix the cause in ${conn.name} (for example reopen the bill), then repeat the action in Portico.`,
            relatedRefs: [
              c.source_ref ? (c.source_ref as EntityRef) : { type: 'integration_outbound_command', id: c.id },
            ],
            technicalDetail: { kind: err.kind, ...(err.vendorDetail ?? {}) },
          });
          await tx.emit({
            type: 'integration.outbound.rejected',
            propertyId: c.property_id,
            aggregate: { type: 'integration_outbound_command', id: c.id },
            payload: {
              commandId: c.id,
              connectionId: conn.id,
              workflow: c.workflow,
              sourceRef: c.source_ref,
              reason: err.message,
            },
          });
          result.rejected++;
        } else {
          const pending = fo.status === 'pending_verification';
          const retryIn = pending ? backoffSeconds(c.attempts) : fo.retryInSeconds;
          const next = new Date(tx.now.getTime() + retryIn * 1000);
          await db(tx)
            .updateTable('integration.outbound_commands')
            .set({
              status: pending ? 'pending_verification' : 'queued',
              verify_before_send: pending ? true : c.verify_before_send,
              next_attempt_at: next,
              lease_until: null,
              last_error: JSON.stringify({ kind: err.kind, message: err.message }),
              version: sql`version + 1`,
            })
            .where('id', '=', c.id)
            .execute();
          await recordExchange(tx, {
            ...base,
            outcome: pending ? 'unknown' : 'failed',
            errorClass: errorClassOf(err.kind),
            summary: pending
              ? `No answer from ${conn.name}: outcome unknown — pending verification, will be checked before any resend.`
              : `Not delivered to ${conn.name} (${err.message}); retry in ${retryIn}s with the same key.`,
          });
          await scheduleTenant(tx, next);
          if (pending) result.pendingVerification++;
          else result.retrying++;
          conn = await recordWorkflowFailure(tx, deps, conn, c.workflow, err);
        }
      }
      await refreshHealth(tx, deps, conn);
    });
  }
  return result;
}

export async function listOutbound(
  tx: TxContext,
  connectionId: string,
  status?: OutboundCommand['status'],
): Promise<OutboundCommand[]> {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.connectionRead, 'any');
  let q = db(tx)
    .selectFrom('integration.outbound_commands')
    .selectAll()
    .where('connection_id', '=', connectionId)
    .orderBy('enqueued_at', 'desc')
    .limit(500);
  if (status) q = q.where('status', '=', status);
  return (await q.execute()).map(toCommand);
}

/** A person decides on a held money / inventory action: resend (verified first) or cancel. */
export async function revalidateCommand(
  tx: TxContext,
  deps: IntegrationDeps,
  commandId: string,
  expectedVersion: number,
  input: { decision: 'resend' | 'cancel'; reason: string },
): Promise<OutboundCommand> {
  const cmd = await db(tx)
    .selectFrom('integration.outbound_commands')
    .selectAll()
    .where('id', '=', commandId)
    .executeTakeFirst();
  if (!cmd) throw new NotFoundError('outbound_command', commandId);
  const conn = await loadConnection(tx, cmd.connection_id);
  requireOnConnection(tx, conn, P.exceptionResolve);
  if (cmd.status !== 'needs_revalidation') {
    throw new BusinessRuleError(
      'not_held',
      `This action is ${cmd.status.replace(/_/g, ' ')}, not waiting for a decision.`,
    );
  }
  const row = await db(tx)
    .updateTable('integration.outbound_commands')
    .set(
      input.decision === 'resend'
        ? {
            status: 'queued',
            verify_before_send: true,
            next_attempt_at: tx.now,
            revalidated_by: actorKey(tx),
            revalidated_at: tx.now,
            version: sql`version + 1`,
          }
        : {
            status: 'cancelled',
            completed_at: tx.now,
            revalidated_by: actorKey(tx),
            revalidated_at: tx.now,
            version: sql`version + 1`,
          },
    )
    .where('id', '=', cmd.id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) return explainVersionMiss('outbound_command', cmd.id, expectedVersion, async () => cmd.version);
  await tx.audit({
    action: `integration.outbound.${input.decision === 'resend' ? 'revalidate' : 'cancel'}`,
    target: { type: 'integration_outbound_command', id: cmd.id },
    propertyId: cmd.property_id,
    reason: input.reason,
    before: { status: cmd.status },
    after: { status: row.status },
    metadata: {
      effectClass: cmd.effect_class,
      idempotencyKey: cmd.idempotency_key,
      sourceRef: cmd.source_ref,
    },
  });
  if (input.decision === 'cancel') {
    await tx.emit({
      type: 'integration.outbound.cancelled',
      propertyId: cmd.property_id,
      aggregate: { type: 'integration_outbound_command', id: cmd.id },
      payload: {
        commandId: cmd.id,
        connectionId: conn.id,
        workflow: cmd.workflow,
        sourceRef: cmd.source_ref,
        reason: input.reason,
      },
    });
  } else {
    await scheduleTenant(tx, tx.now);
  }
  const remaining = await db(tx)
    .selectFrom('integration.outbound_commands')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('connection_id', '=', conn.id)
    .where('status', '=', 'needs_revalidation')
    .executeTakeFirstOrThrow();
  if (remaining.n === 0) {
    await autoResolveExceptions(tx, conn.id, ['actions_need_revalidation'], 'Every held action was decided.');
  }
  await refreshHealth(tx, deps, conn);
  return toCommand(row);
}

export { explainConnectorError };
