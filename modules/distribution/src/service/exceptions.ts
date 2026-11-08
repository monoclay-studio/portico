/**
 * Distribution exceptions (plain-language problem, business impact, responsible party, next step) and
 * discrepancies (Portico vs channel). An open problem is raised once (dedupe key); repeats count occurrences and can
 * only raise severity. Exceptions this module raises for a transient condition are RESOLVED by the module itself
 * when the condition clears (they are recomputed, never frozen).
 */
import { sql, type TxContext } from '@portico/db';
import { BusinessRuleError, NotFoundError, newId, VersionConflictError } from '@portico/kernel';
import type { ExceptionView } from '../contracts';
import { DISTRIBUTION_EVENTS as E } from '../events';
import { P, RECORD } from '../manifest';
import { actorKey, db, iso, json, loadConnection, requireOnConnection } from './common';

export interface RaiseInput {
  connectionId: string;
  propertyId: string;
  code: string;
  dedupeKey: string;
  severity: 'urgent' | 'routine';
  problem: string;
  businessImpact: string;
  responsibleParty: 'hotel' | 'monoclay' | 'vendor';
  nextStep: string;
  refs?: Array<{ type: string; id: string }>;
}

/**
 * Raise (or count) an exception. `standing: true` is for a CONDITION re-evaluated on every pass (publication
 * blocked, hub refused for this environment): it is written once when the condition starts and nothing is written
 * while it stays open — the exception records the state change, not every pass that observes it (P1-1).
 */
export async function raiseException(
  tx: TxContext,
  input: RaiseInput,
  opts: { standing?: boolean } = {},
): Promise<{ id: string; created: boolean }> {
  if (opts.standing) {
    // A plain read (no row lock: FOR UPDATE would itself write the tuple on every pass).
    const open = await db(tx)
      .selectFrom('distribution.exceptions')
      .select('id')
      .where('connection_id', '=', input.connectionId)
      .where('dedupe_key', '=', input.dedupeKey)
      .where('status', '=', 'open')
      .executeTakeFirst();
    if (open) return { id: open.id, created: false };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await db(tx)
      .selectFrom('distribution.exceptions')
      .selectAll()
      .where('connection_id', '=', input.connectionId)
      .where('dedupe_key', '=', input.dedupeKey)
      .where('status', '=', 'open')
      .forUpdate()
      .executeTakeFirst();
    if (existing && opts.standing) return { id: existing.id, created: false };
    if (existing) {
      await db(tx)
        .updateTable('distribution.exceptions')
        .set({
          occurrences: sql`occurrences + 1`,
          last_seen_at: tx.now,
          severity: existing.severity === 'urgent' || input.severity === 'urgent' ? 'urgent' : 'routine',
          problem: input.problem,
          business_impact: input.businessImpact,
          next_step: input.nextStep,
          version: sql`version + 1`,
        })
        .where('id', '=', existing.id)
        .execute();
      return { id: existing.id, created: false };
    }
    const id = newId(tx.now.getTime());
    const inserted = await db(tx)
      .insertInto('distribution.exceptions')
      .values({
        id,
        tenant_id: tx.tenantId,
        connection_id: input.connectionId,
        property_id: input.propertyId,
        code: input.code,
        dedupe_key: input.dedupeKey,
        severity: input.severity,
        problem: input.problem,
        business_impact: input.businessImpact,
        responsible_party: input.responsibleParty,
        next_step: input.nextStep,
        refs: json(input.refs ?? []),
        status: 'open',
        occurrences: 1,
        first_seen_at: tx.now,
        last_seen_at: tx.now,
        resolved_at: null,
        resolved_by: null,
        resolution: null,
      })
      .onConflict((oc) => oc.doNothing())
      .returning('id')
      .executeTakeFirst();
    if (inserted) {
      await tx.audit({
        action: 'distribution.exception.raised',
        target: { type: RECORD.exception, id },
        propertyId: input.propertyId,
        after: { code: input.code, severity: input.severity },
      });
      return { id, created: true };
    }
  }
  throw new Error('raiseException: could not insert or find the open exception');
}

/** Close open exceptions whose condition cleared (system resolution). Matches the exact key or a `prefix*`. */
export async function autoResolve(
  tx: TxContext,
  connectionId: string,
  key: string,
  resolution: string,
): Promise<number> {
  let q = db(tx)
    .updateTable('distribution.exceptions')
    .set({
      status: 'resolved',
      resolved_at: tx.now,
      resolved_by: 'system:distribution',
      resolution,
      version: sql`version + 1`,
    })
    .where('connection_id', '=', connectionId)
    .where('status', '=', 'open');
  q = key.endsWith('*')
    ? q.where('dedupe_key', 'like', `${key.slice(0, -1)}%`)
    : q.where('dedupe_key', '=', key);
  const res = await q.executeTakeFirst();
  return Number(res.numUpdatedRows ?? 0);
}

export function exceptionView(
  tx: TxContext,
  r: {
    id: string;
    connection_id: string;
    property_id: string;
    code: string;
    severity: 'urgent' | 'routine';
    problem: string;
    business_impact: string;
    responsible_party: 'hotel' | 'monoclay' | 'vendor';
    next_step: string;
    status: 'open' | 'resolved';
    occurrences: number;
    first_seen_at: Date;
    last_seen_at: Date;
    resolution: string | null;
    refs: unknown;
    version: number;
  },
): ExceptionView {
  const canResolve = tx.authz.can(P.discrepancyResolve, { propertyId: r.property_id });
  return {
    id: r.id,
    connectionId: r.connection_id,
    propertyId: r.property_id,
    code: r.code,
    severity: r.severity,
    problem: r.problem,
    businessImpact: r.business_impact,
    responsibleParty: r.responsible_party,
    nextStep: r.next_step,
    status: { exception: r.status, severity: r.severity },
    occurrences: r.occurrences,
    firstSeenAt: iso(r.first_seen_at) as string,
    lastSeenAt: iso(r.last_seen_at) as string,
    resolution: r.resolution,
    allowedActions: [
      {
        action: 'resolve',
        label: 'Mark resolved',
        enabled: r.status === 'open' && canResolve,
        ...(r.status !== 'open'
          ? { reason: 'Already resolved.' }
          : !canResolve
            ? { reason: 'Needs permission to resolve distribution problems.' }
            : {}),
      },
    ],
    links: [
      { rel: 'connection', type: RECORD.connection, id: r.connection_id },
      ...((Array.isArray(r.refs) ? r.refs : []) as Array<{ type: string; id: string }>).map((x) => ({
        rel: 'related',
        type: x.type,
        id: x.id,
      })),
    ],
    version: r.version,
  };
}

export async function listExceptions(
  tx: TxContext,
  q: { connectionId: string; status?: 'open' | 'resolved' },
): Promise<ExceptionView[]> {
  const conn = await loadConnection(tx, q.connectionId);
  requireOnConnection(tx, conn, P.channelRead);
  let query = db(tx)
    .selectFrom('distribution.exceptions')
    .selectAll()
    .where('connection_id', '=', conn.id)
    .orderBy('last_seen_at', 'desc')
    .limit(500);
  if (q.status) query = query.where('status', '=', q.status);
  return (await query.execute()).map((r) => exceptionView(tx, r));
}

export async function resolveException(
  tx: TxContext,
  id: string,
  expectedVersion: number,
  resolution: string,
): Promise<ExceptionView> {
  const row = await db(tx)
    .selectFrom('distribution.exceptions')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw new NotFoundError('distribution_exception', id);
  requireOnConnection(tx, row, P.discrepancyResolve);
  if (row.version !== expectedVersion) {
    throw new VersionConflictError('distribution_exception', id, expectedVersion, row.version);
  }
  if (row.status !== 'open')
    throw new BusinessRuleError('exception_not_open', 'This problem is already resolved.');
  const updated = await db(tx)
    .updateTable('distribution.exceptions')
    .set({
      status: 'resolved',
      resolved_at: tx.now,
      resolved_by: actorKey(tx),
      resolution,
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'distribution.exception.resolved',
    target: { type: RECORD.exception, id },
    propertyId: row.property_id,
    before: { status: row.status },
    after: { status: 'resolved' },
    reason: resolution,
  });
  return exceptionView(tx, updated);
}

// ───────────────────────────── discrepancies ─────────────────────────────

export async function raiseDiscrepancy(
  tx: TxContext,
  input: {
    connectionId: string;
    propertyId: string;
    kind: 'availability' | 'rate' | 'reservation' | 'mapping' | 'field_loss' | 'price';
    dedupeKey: string;
    summary: string;
    refs?: Array<{ type: string; id: string }>;
    detail?: Record<string, unknown>;
  },
): Promise<{ id: string; created: boolean }> {
  const existing = await db(tx)
    .selectFrom('distribution.discrepancies')
    .select(['id'])
    .where('connection_id', '=', input.connectionId)
    .where('dedupe_key', '=', input.dedupeKey)
    .where('status', 'in', ['open', 'investigating'])
    .executeTakeFirst();
  if (existing) return { id: existing.id, created: false };
  const id = newId(tx.now.getTime());
  const row = await db(tx)
    .insertInto('distribution.discrepancies')
    .values({
      id,
      tenant_id: tx.tenantId,
      connection_id: input.connectionId,
      property_id: input.propertyId,
      kind: input.kind,
      dedupe_key: input.dedupeKey,
      summary: input.summary,
      refs: json(input.refs ?? []),
      detail: json(input.detail ?? {}),
      status: 'open',
      owner_user_id: null,
      detected_at: tx.now,
      resolved_at: null,
      resolved_by: null,
      resolution: null,
    })
    .onConflict((oc) => oc.doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!row) return { id, created: false };
  await tx.emit({
    type: E.discrepancyDetected,
    propertyId: input.propertyId,
    aggregate: { type: RECORD.discrepancy, id },
    aggregateVersion: 1,
    payload: {
      discrepancyId: id,
      connectionId: input.connectionId,
      propertyId: input.propertyId,
      kind: input.kind,
    },
  });
  return { id, created: true };
}

export async function autoResolveDiscrepancies(
  tx: TxContext,
  connectionId: string,
  keyPrefix: string,
  resolution: string,
  keep: ReadonlySet<string> = new Set(),
): Promise<number> {
  const open = await db(tx)
    .selectFrom('distribution.discrepancies')
    .select(['id', 'dedupe_key', 'property_id', 'kind', 'version'])
    .where('connection_id', '=', connectionId)
    .where('status', 'in', ['open', 'investigating'])
    .where('dedupe_key', 'like', `${keyPrefix}%`)
    .execute();
  let n = 0;
  for (const d of open) {
    if (keep.has(d.dedupe_key)) continue;
    await db(tx)
      .updateTable('distribution.discrepancies')
      .set({
        status: 'resolved',
        resolved_at: tx.now,
        resolved_by: 'system:distribution',
        resolution,
        version: sql`version + 1`,
      })
      .where('id', '=', d.id)
      .execute();
    await tx.emit({
      type: E.discrepancyResolved,
      propertyId: d.property_id,
      aggregate: { type: RECORD.discrepancy, id: d.id },
      aggregateVersion: d.version + 1,
      payload: { discrepancyId: d.id, connectionId, propertyId: d.property_id, kind: d.kind },
    });
    n++;
  }
  return n;
}

/**
 * The hub refused the API key (any call: ARI, acknowledgement, feed, verification). One rule for every path:
 * publication and acknowledgements stop for THIS connection only, and one urgent exception says what to do (E04).
 */
export async function markCredentialsInvalid(
  tx: TxContext,
  conn: { id: string; property_id: string },
  message: string,
): Promise<void> {
  await db(tx)
    .updateTable('distribution.connections')
    .set({ credential_state: 'invalid' })
    .where('id', '=', conn.id)
    .execute();
  await raiseException(tx, {
    connectionId: conn.id,
    propertyId: conn.property_id,
    code: 'credentials_invalid',
    dedupeKey: 'credentials_invalid',
    severity: 'urgent',
    problem: message,
    businessImpact:
      'Availability and rates are NOT reaching this channel and new bookings are not acknowledged (other channels are unaffected). Changes are kept and sent once the key works; bookings stay at the hub.',
    responsibleParty: 'hotel',
    nextStep:
      'Check at the hub whether the API key was revoked or the property access removed, then enter a valid key in the connection (Replace key) and verify it.',
  });
}
