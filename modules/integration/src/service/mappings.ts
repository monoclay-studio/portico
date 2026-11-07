/**
 * Mappings between external codes and Portico records, with suggestions, mandatory review for ambiguous and
 * financially significant mappings, versions and audit (adoption brief §7; spec INT-R10..R14).
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
  NotFoundError,
  newId,
  type RequestContext,
  sha256Hex,
  ValidationError,
} from '@portico/kernel';
import type { ConnectorDefinition, ExternalEntity } from '../connectors/sdk';
import type {
  ConnectionScope,
  ConnectionState,
  Mapping,
  MappingIssue,
  MappingKind,
  MappingSet,
  ReviewMappingInput,
} from '../contracts';
import {
  type InternalCandidate,
  type Suggestion,
  statusCandidates,
  suggestMappings as suggestEngine,
} from '../domain/mapping-suggest';
import { canTransition, stateAfterMappingChange } from '../domain/setup-journey';
import { FINANCIALLY_SIGNIFICANT_KINDS, MAPPING_KIND_LABELS, type StatusDomain } from '../domain/vocabulary';
import { P } from '../manifest';
import { ModuleUnavailableError } from '../ports';
import type { MappingsTable } from '../tables';
import {
  actorKey,
  assertVersion,
  type ConnectionRow,
  db,
  type IntegrationDeps,
  loadConnection,
  parseScope,
  readableProperties,
  readsWorkflow,
  recordStep,
  registered,
  requireOnConnection,
  transition,
} from './common';
import { asConnectorError, explainConnectorError, prepareCall } from './runtime';
import { connectionView, mappingView } from './views';

type MappingRow = Selectable<MappingsTable>;

/** Kinds a connection's scope needs mapped (always including properties). */
export function requiredKinds(def: ConnectorDefinition, scope: ConnectionScope): Set<MappingKind> {
  const kinds = new Set<MappingKind>(['property']);
  for (const s of scope.workflows) {
    const w = def.workflows.find((x) => x.workflow === s.workflow);
    if (!w || !readsWorkflow(s.operations)) continue;
    for (const f of w.mappedFields) kinds.add(f.kind);
  }
  return kinds;
}

export function issuesFor(rows: readonly MappingRow[]): MappingIssue[] {
  const issues: MappingIssue[] = [];
  for (const r of rows) {
    const label = MAPPING_KIND_LABELS[r.kind as MappingKind];
    if (r.status === 'unmapped') {
      const providerIssue = ((r.reasons as Mapping['reasons']) ?? []).find(
        (x) => x.code === 'provider_unavailable',
      );
      issues.push({
        code: providerIssue ? 'provider_unavailable' : 'unmapped',
        severity: 'blocking',
        kind: r.kind as MappingKind,
        message: providerIssue
          ? providerIssue.message
          : `The ${label} "${r.external_label}" (${r.external_id}) is not mapped. Choose the matching Portico ${label} or mark it as not used.`,
        mappingId: r.id,
      });
    } else if (r.status === 'suggested' && r.requires_review && !r.reviewed) {
      issues.push({
        code: r.financially_significant ? 'financial_review_required' : 'review_required',
        severity: 'blocking',
        kind: r.kind as MappingKind,
        message: `${label[0]?.toUpperCase()}${label.slice(1)} "${r.external_label}" → "${r.internal_label ?? '?'}" needs review: ${r.review_reason ?? 'please confirm'}`,
        mappingId: r.id,
      });
    }
  }
  return issues;
}

export async function mappingRows(tx: TxContext, connectionId: string): Promise<MappingRow[]> {
  return db(tx)
    .selectFrom('integration.mappings')
    .selectAll()
    .where('connection_id', '=', connectionId)
    .orderBy('kind')
    .orderBy('external_id')
    .execute();
}

export function summarize(rows: readonly MappingRow[]): MappingSet['summary'] {
  const reviewedSuggestions = rows.filter((r) => r.reviewed && r.suggested_internal_id !== null);
  const unchanged = reviewedSuggestions.filter(
    (r) => r.status === 'confirmed' && r.internal_id === r.suggested_internal_id,
  );
  return {
    total: rows.length,
    confirmed: rows.filter((r) => r.status === 'confirmed').length,
    awaitingReview: rows.filter((r) => r.status === 'suggested').length,
    unmapped: rows.filter((r) => r.status === 'unmapped').length,
    ignored: rows.filter((r) => r.status === 'ignored').length,
    autoConfirmed: rows.filter((r) => r.auto_confirmed).length,
    suggestionAccuracy:
      reviewedSuggestions.length === 0
        ? null
        : Math.round((unchanged.length / reviewedSuggestions.length) * 1000) / 1000,
  };
}

export async function getMappingSet(tx: TxContext, connectionId: string): Promise<MappingSet> {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.connectionRead, 'any');
  const rows = (await mappingRows(tx, connectionId)).filter((r) => mappingReadable(tx, conn, r));
  return {
    items: rows.map((r) => mappingView(r, { tx, conn })),
    issues: issuesFor(rows),
    summary: summarize(rows),
  };
}

/**
 * F12: a reader scoped to some of a connection's properties sees those properties' mappings and the shared status
 * code lists, not other properties' rows.
 */
function mappingReadable(
  tx: TxContext,
  conn: { property_ids: string[] },
  r: { kind: string; property_id: string | null; internal_id: string | null },
): boolean {
  const scope = readableProperties(tx, conn, P.connectionRead);
  if (scope.all || r.kind === 'status') return true;
  if (r.kind === 'property') return r.internal_id !== null && scope.propertyIds.includes(r.internal_id);
  return r.property_id !== null && scope.propertyIds.includes(r.property_id);
}

/** Fingerprint of the current mapping decisions: activation refuses a preview made with other mappings. */
export function fingerprintOf(rows: readonly MappingRow[]): string {
  return sha256Hex(
    rows
      .map((r) => `${r.kind}|${r.external_id}|${r.internal_id ?? ''}|${r.status}|${r.reviewed ? 1 : 0}`)
      .sort()
      .join('\n'),
  );
}

async function recordVersion(
  tx: TxContext,
  row: MappingRow,
  change: string,
  reason: string | null,
): Promise<void> {
  await db(tx)
    .insertInto('integration.mapping_versions')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      mapping_id: row.id,
      connection_id: row.connection_id,
      version: row.version,
      internal_id: row.internal_id,
      status: row.status,
      reviewed: row.reviewed,
      confidence: row.confidence,
      change,
      reason,
      actor_key: actorKey(tx),
      changed_at: tx.now,
    })
    .execute();
}

/** Candidate Portico records for a kind, or a provider-unavailable explanation. */
async function candidatesFor(
  tx: TxContext,
  deps: IntegrationDeps,
  conn: ConnectionRow,
  kind: MappingKind,
  propertyId: string | null,
  statusDomain: StatusDomain | undefined,
): Promise<{ candidates: InternalCandidate[] } | { unavailable: string }> {
  if (kind === 'status') return { candidates: statusDomain ? statusCandidates(statusDomain) : [] };
  if (kind === 'property') {
    const props = await Promise.all(conn.property_ids.map((id) => deps.ports.platform.getProperty(tx, id)));
    return {
      candidates: props.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        attributes: { currency: p.baseCurrency, timezone: p.timezone },
      })),
    };
  }
  if (!propertyId) {
    return {
      unavailable: `Map the property first: Portico ${MAPPING_KIND_LABELS[kind]} records belong to a property.`,
    };
  }
  try {
    return { candidates: await deps.ports.catalog.listCandidates(tx, { kind, propertyId }) };
  } catch (err) {
    if (err instanceof ModuleUnavailableError) return { unavailable: err.message };
    throw err;
  }
}

async function upsertSuggestion(
  tx: TxContext,
  conn: ConnectionRow,
  entity: ExternalEntity,
  propertyId: string | null,
  s: Suggestion | { unavailable: string },
): Promise<void> {
  const existing = await db(tx)
    .selectFrom('integration.mappings')
    .selectAll()
    .where('connection_id', '=', conn.id)
    .where('kind', '=', entity.kind)
    .where('external_id', '=', entity.externalId)
    .forUpdate()
    .executeTakeFirst();
  const financial = FINANCIALLY_SIGNIFICANT_KINDS.has(entity.kind);
  const base = {
    external_label: entity.label,
    external_attrs: JSON.stringify({ ...entity.attributes, ...(entity.code ? { code: entity.code } : {}) }),
    property_id: propertyId,
  };
  const values =
    'unavailable' in s
      ? {
          ...base,
          internal_id: null,
          internal_label: null,
          suggested_internal_id: null,
          status: 'unmapped' as const,
          confidence: null,
          reasons: JSON.stringify([{ code: 'provider_unavailable', message: s.unavailable }]),
          alternatives: JSON.stringify([]),
          financially_significant: financial,
          requires_review: true,
          review_reason: s.unavailable,
          auto_confirmed: false,
        }
      : {
          ...base,
          internal_id: s.internalId,
          internal_label: s.internalLabel,
          suggested_internal_id: s.internalId,
          status: s.status,
          confidence: s.confidence,
          reasons: JSON.stringify(s.reasons),
          alternatives: JSON.stringify(s.alternatives),
          financially_significant: s.financiallySignificant,
          requires_review: s.requiresReview,
          review_reason: s.reviewReason,
          auto_confirmed: s.autoConfirmed,
        };
  if (existing) {
    // Human decisions are never overwritten by a new suggestion run.
    if (existing.reviewed || existing.status === 'ignored') {
      await db(tx).updateTable('integration.mappings').set(base).where('id', '=', existing.id).execute();
      return;
    }
    const row = await db(tx)
      .updateTable('integration.mappings')
      .set({ ...values, version: sql`version + 1` })
      .where('id', '=', existing.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    if (row.internal_id !== existing.internal_id || row.status !== existing.status) {
      await recordVersion(tx, row, row.auto_confirmed ? 'auto_confirmed' : 'suggested', null);
    }
    return;
  }
  const row = await db(tx)
    .insertInto('integration.mappings')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      connection_id: conn.id,
      kind: entity.kind,
      external_id: entity.externalId,
      reviewed: false,
      ...values,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await recordVersion(tx, row, row.auto_confirmed ? 'auto_confirmed' : 'suggested', null);
}

/**
 * Step 4: discover the external system's codes and suggest mappings. Repeatable: confirmed (reviewed) and
 * ignored mappings are kept; everything else is re-suggested.
 */
export async function suggestConnectionMappings(
  database: PorticoDatabase,
  deps: IntegrationDeps,
  ctx: RequestContext,
  connectionId: string,
  expectedVersion: number | undefined,
): Promise<MappingSet & { connection: Awaited<ReturnType<typeof connectionView>> }> {
  const prepared = await withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, connectionId);
    requireOnConnection(tx, conn, P.connectionManage);
    assertVersion(conn, expectedVersion);
    if (!canTransition('suggestMappings', conn.state as ConnectionState)) {
      throw new BusinessRuleError(
        'step_not_available',
        `Mappings can be suggested once access is authorized (the connection is ${conn.state}).`,
      );
    }
    return { conn, call: await prepareCall(tx, deps, conn, { kind: 'read', workflow: 'discovery' }) };
  });
  const def = prepared.call.reg.definition;
  let entities: ExternalEntity[];
  try {
    entities = await prepared.call.adapter.discover(prepared.call.actx);
  } catch (err) {
    const ce = asConnectorError(err, 'read');
    await withTenantTx(database, ctx, (tx) =>
      recordStep(tx, prepared.conn, {
        step: 4,
        action: 'suggestMappings',
        outcome: 'failed',
        from: prepared.conn.state,
        to: prepared.conn.state,
        detail: { kind: ce.kind, message: ce.message },
      }),
    );
    throw explainConnectorError(
      prepared.conn.name,
      ce,
      'Mappings cannot be suggested until the codes can be read.',
    );
  }
  return withTenantTx(database, ctx, async (tx) => {
    let conn = await loadConnection(tx, connectionId, { forUpdate: true });
    assertVersion(conn, prepared.conn.version);
    const scope = parseScope(conn.scope);
    const kinds = requiredKinds(def, scope);
    const relevant = entities.filter((e) => kinds.has(e.kind));

    // 1. Properties first: other kinds are looked up within the mapped Portico property.
    const propertyEntities = relevant.filter((e) => e.kind === 'property');
    const propCands = await candidatesFor(tx, deps, conn, 'property', null, undefined);
    const existingRows = await mappingRows(tx, conn.id);
    const propSuggestions =
      'candidates' in propCands ? suggestEngine(propertyEntities.map(toItem), propCands.candidates, {}) : [];
    for (const [i, e] of propertyEntities.entries()) {
      const s = propSuggestions[i];
      if (s) await upsertSuggestion(tx, conn, e, s.internalId, s);
    }
    const afterProps = await mappingRows(tx, conn.id);
    const propertyMap = new Map(
      afterProps
        .filter((r) => r.kind === 'property' && r.internal_id)
        .map((r) => [r.external_id, r.internal_id as string]),
    );

    // 2. Other kinds, grouped by (kind, property, status domain).
    const groups = new Map<string, ExternalEntity[]>();
    for (const e of relevant) {
      if (e.kind === 'property') continue;
      const key = `${e.kind}|${e.propertyExternalId ?? ''}|${e.statusDomain ?? ''}`;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    const order: MappingKind[] = [
      'unitType',
      'unit',
      'ratePlan',
      'outlet',
      'chargeCode',
      'taxRule',
      'ledgerAccount',
      'status',
    ];
    const sortedGroups = [...groups.entries()].sort(
      (a, b) => order.indexOf(a[1][0]?.kind as MappingKind) - order.indexOf(b[1][0]?.kind as MappingKind),
    );
    for (const [, list] of sortedGroups) {
      const first = list[0] as ExternalEntity;
      const propertyId =
        first.kind === 'status'
          ? null
          : first.propertyExternalId
            ? (propertyMap.get(first.propertyExternalId) ?? null)
            : conn.property_ids.length === 1
              ? (conn.property_ids[0] ?? null)
              : null;
      const cands = await candidatesFor(tx, deps, conn, first.kind, propertyId, first.statusDomain);
      if ('unavailable' in cands) {
        for (const e of list) await upsertSuggestion(tx, conn, e, propertyId, cands);
        continue;
      }
      const current = await mappingRows(tx, conn.id);
      const unitTypeMap = new Map(
        current
          .filter((r) => r.kind === 'unitType' && r.internal_id)
          .map((r) => [r.external_id, r.internal_id as string]),
      );
      const taken = new Map(
        current
          .filter((r) => r.kind === first.kind && r.reviewed && r.status === 'confirmed' && r.internal_id)
          .map((r) => [r.internal_id as string, r.external_id]),
      );
      const suggestions = suggestEngine(list.map(toItem), cands.candidates, { unitTypeMap, taken });
      for (const [i, e] of list.entries()) {
        const s = suggestions[i];
        if (s) await upsertSuggestion(tx, conn, e, propertyId, s);
      }
    }

    const rows = await mappingRows(tx, conn.id);
    const summary = summarize(rows);
    conn = await transition(tx, conn, 'suggestMappings', {
      ...(conn.state === 'authorized' ? {} : { targetState: 'mappings_suggested' }),
      detail: { discovered: relevant.length, ...summary },
    });
    await tx.audit({
      action: 'integration.mapping.suggest',
      target: { type: 'integration_connection', id: conn.id },
      after: { discovered: relevant.length, before: existingRows.length, ...summary },
    });
    await tx.emit({
      type: 'integration.mapping.changed',
      aggregate: { type: 'integration_connection', id: conn.id },
      payload: { connectionId: conn.id, change: 'suggested', summary },
    });
    return {
      items: rows.map((r) => mappingView(r, { tx, conn })),
      issues: issuesFor(rows),
      summary,
      connection: await connectionView(tx, deps, conn),
    };
  });
}

function toItem(e: ExternalEntity) {
  return {
    kind: e.kind,
    externalId: e.externalId,
    ...(e.code ? { code: e.code } : {}),
    label: e.label,
    attributes: e.attributes,
  };
}

/** Validate that an internal id is a real Portico record of the right kind before mapping to it. */
async function assertValidTarget(
  tx: TxContext,
  deps: IntegrationDeps,
  conn: ConnectionRow,
  row: MappingRow,
  internalId: string,
): Promise<string> {
  const statusDomain = (row.external_id.includes(':') ? row.external_id.split(':')[0] : undefined) as
    | StatusDomain
    | undefined;
  const cands = await candidatesFor(tx, deps, conn, row.kind as MappingKind, row.property_id, statusDomain);
  if ('unavailable' in cands) {
    throw new BusinessRuleError('mapping_target_unverifiable', cands.unavailable);
  }
  const hit = cands.candidates.find((c) => c.id === internalId);
  if (!hit) {
    throw new ValidationError(
      'mapping_target_not_found',
      `"${internalId}" is not a Portico ${MAPPING_KIND_LABELS[row.kind as MappingKind]} available for this connection. Choose one from the suggestions or alternatives.`,
    );
  }
  return hit.name;
}

/** A person confirms, overrides, ignores or resets one mapping. */
export async function reviewMapping(
  tx: TxContext,
  deps: IntegrationDeps,
  mappingId: string,
  expectedVersion: number,
  input: ReviewMappingInput,
): Promise<{ mapping: Mapping; connectionState: string }> {
  const row = await db(tx)
    .selectFrom('integration.mappings')
    .selectAll()
    .where('id', '=', mappingId)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('mapping', mappingId);
  const conn = await loadConnection(tx, row.connection_id, { forUpdate: true });
  requireOnConnection(tx, conn, P.mappingReview);
  if (row.financially_significant) requireOnConnection(tx, conn, P.mappingReviewFinancial);
  if (conn.state === 'disconnected') {
    throw new BusinessRuleError(
      'connection_disconnected',
      'This connection is disconnected; its mappings are kept for history only.',
    );
  }
  let set: Partial<Record<keyof MappingsTable, unknown>>;
  let change: string;
  switch (input.decision) {
    case 'confirm': {
      const target = input.internalId ?? row.internal_id;
      if (!target) {
        throw new ValidationError(
          'mapping_target_required',
          'There is no suggestion to confirm. Choose the Portico record to map to.',
        );
      }
      const label = await assertValidTarget(tx, deps, conn, row, target);
      set = { internal_id: target, internal_label: label, status: 'confirmed' };
      change = target === row.suggested_internal_id ? 'confirmed' : 'overridden';
      break;
    }
    case 'override': {
      if (!input.internalId) {
        throw new ValidationError('mapping_target_required', 'Choose the Portico record to map to.');
      }
      const label = await assertValidTarget(tx, deps, conn, row, input.internalId);
      set = { internal_id: input.internalId, internal_label: label, status: 'confirmed' };
      change = 'overridden';
      break;
    }
    case 'ignore':
      set = { internal_id: null, internal_label: null, status: 'ignored' };
      change = 'ignored';
      break;
    case 'reset':
      set = {
        internal_id: row.suggested_internal_id,
        status: row.suggested_internal_id ? 'suggested' : 'unmapped',
        reviewed: false,
        reviewed_by: null,
        reviewed_at: null,
      };
      change = 'reset';
      break;
  }
  const reviewedSet =
    input.decision === 'reset' ? {} : { reviewed: true, reviewed_by: actorKey(tx), reviewed_at: tx.now };
  const updated = await db(tx)
    .updateTable('integration.mappings')
    .set({
      ...(set as Record<string, unknown>),
      ...reviewedSet,
      auto_confirmed: false,
      version: sql`version + 1`,
    })
    .where('id', '=', row.id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!updated) return explainVersionMiss('mapping', row.id, expectedVersion, async () => row.version);
  await recordVersion(tx, updated, change, input.reason ?? null);
  await tx.audit({
    action: `integration.mapping.${input.decision}`,
    target: { type: 'integration_mapping', id: row.id },
    propertyId: row.property_id,
    reason: input.reason ?? null,
    before: { internalId: row.internal_id, status: row.status, reviewed: row.reviewed },
    after: { internalId: updated.internal_id, status: updated.status, reviewed: updated.reviewed },
    metadata: {
      kind: row.kind,
      externalId: row.external_id,
      financiallySignificant: row.financially_significant,
    },
  });
  await tx.emit({
    type: 'integration.mapping.changed',
    propertyId: row.property_id,
    aggregate: { type: 'integration_connection', id: conn.id },
    payload: {
      connectionId: conn.id,
      mappingId: row.id,
      kind: row.kind,
      externalId: row.external_id,
      change,
      internalId: updated.internal_id,
    },
  });
  // A validation or preview made with other mappings is no longer valid.
  let state = conn.state;
  const fallback = stateAfterMappingChange(conn.state as ConnectionState);
  if (fallback !== conn.state) {
    const moved = await transition(tx, conn, 'reopen', {
      reopenTo: fallback,
      detail: { reason: 'Mappings changed after validation; validation and preview must be repeated.' },
    });
    state = moved.state;
  }
  return {
    mapping: mappingView(updated, { tx, conn: { property_ids: conn.property_ids, state } }),
    connectionState: state,
  };
}

export async function mappingHistory(tx: TxContext, mappingId: string) {
  const row = await db(tx)
    .selectFrom('integration.mappings')
    .select(['connection_id', 'kind', 'property_id', 'internal_id'])
    .where('id', '=', mappingId)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('mapping', mappingId);
  const conn = await loadConnection(tx, row.connection_id);
  requireOnConnection(tx, conn, P.connectionRead, 'any');
  if (!mappingReadable(tx, conn, row)) throw new NotFoundError('mapping', mappingId);
  const rows = await db(tx)
    .selectFrom('integration.mapping_versions')
    .selectAll()
    .where('mapping_id', '=', mappingId)
    .orderBy('changed_at')
    .orderBy('version')
    .execute();
  return rows.map((r) => ({
    version: r.version,
    internalId: r.internal_id,
    status: r.status,
    reviewed: r.reviewed,
    confidence: r.confidence === null ? null : Number(r.confidence),
    change: r.change,
    reason: r.reason,
    actor: r.actor_key,
    changedAt: new Date(r.changed_at).toISOString(),
  }));
}

/** Domain-map provider: the confirmed Portico record for an external code (null when not confirmed). */
export async function getMapping(
  tx: TxContext,
  input: { connectionId: string; kind: MappingKind; externalId: string },
): Promise<{ internalId: string; reviewed: boolean } | null> {
  const row = await db(tx)
    .selectFrom('integration.mappings')
    .select(['internal_id', 'reviewed', 'status'])
    .where('connection_id', '=', input.connectionId)
    .where('kind', '=', input.kind)
    .where('external_id', '=', input.externalId)
    .executeTakeFirst();
  if (row?.status !== 'confirmed' || !row.internal_id) return null;
  return { internalId: row.internal_id, reviewed: row.reviewed };
}

/** A code seen at runtime that has no mapping yet becomes an `unmapped` row for review (INT-R12). */
export async function ensureUnmappedRow(
  tx: TxContext,
  conn: ConnectionRow,
  input: { kind: MappingKind; externalId: string; label: string; propertyId: string | null },
): Promise<void> {
  const inserted = await db(tx)
    .insertInto('integration.mappings')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      connection_id: conn.id,
      kind: input.kind,
      external_id: input.externalId,
      external_label: input.label,
      external_attrs: JSON.stringify({ firstSeenAt: tx.now.toISOString() }),
      property_id: input.propertyId,
      internal_id: null,
      internal_label: null,
      suggested_internal_id: null,
      status: 'unmapped',
      confidence: null,
      reasons: JSON.stringify([
        { code: 'seen_after_activation', message: `First seen in a message from ${conn.name}.` },
      ]),
      alternatives: JSON.stringify([]),
      financially_significant: FINANCIALLY_SIGNIFICANT_KINDS.has(input.kind),
      requires_review: true,
      review_reason: 'A new code appeared after activation; nothing using it is applied until it is mapped.',
      reviewed: false,
      auto_confirmed: false,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'connection_id', 'kind', 'external_id']).doNothing())
    .returningAll()
    .executeTakeFirst();
  if (inserted) await recordVersion(tx, inserted, 'discovered', null);
}

export { registered };
