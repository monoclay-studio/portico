/**
 * Integration exceptions: problem, business impact, responsible party, next step, related records, owner and
 * resolution — in plain English for staff (connection lifecycle spec §10). Technical detail is stored separately
 * and shown only to users with integration.technical.read. The same problem is raised once while open; repeats
 * increase its occurrence count.
 */
import { explainVersionMiss, type Selectable, sql, type TxContext } from '@portico/db';
import { BusinessRuleError, type EntityRef, NotFoundError, newId, sha256Hex } from '@portico/kernel';
import type { IntegrationException, ResponsibleParty, Severity } from '../contracts';
import { P } from '../manifest';
import type { ExceptionsTable } from '../tables';
import { actorKey, canOnConnection, db, loadConnection, requireOnConnection } from './common';
import { exceptionView } from './views';

export interface RaiseExceptionInput {
  connectionId: string;
  workflow: string | null;
  severity: Severity;
  problem: string;
  businessImpact: string;
  responsibleParty: ResponsibleParty;
  nextStep: string;
  ref?: EntityRef;
  relatedRefs?: EntityRef[];
  code?: string;
  dedupeKey?: string;
  propertyId?: string | null;
  technicalDetail?: Record<string, unknown>;
}

function toView(
  r: Selectable<ExceptionsTable>,
  conn: { property_ids: string[] },
  tx: TxContext,
): IntegrationException {
  return exceptionView(r, { tx, conn });
}

/** Domain-map provider: raise (or re-count) an integration exception. */
export async function raiseException(
  tx: TxContext,
  input: RaiseExceptionInput,
): Promise<{ exceptionId: string; created: boolean }> {
  const conn = await loadConnection(tx, input.connectionId);
  const code = input.code ?? 'reported';
  const dedupeKey =
    input.dedupeKey ?? `${code}:${input.workflow ?? ''}:${sha256Hex(input.problem).slice(0, 16)}`;
  const refs = [...(input.ref ? [input.ref] : []), ...(input.relatedRefs ?? [])];
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await db(tx)
      .selectFrom('integration.exceptions')
      .selectAll()
      .where('connection_id', '=', conn.id)
      .where('dedupe_key', '=', dedupeKey)
      .where('status', 'in', ['open', 'acknowledged'])
      .forUpdate()
      .executeTakeFirst();
    if (existing) {
      const mergedRefs = [...(existing.related_refs as EntityRef[])];
      for (const r of refs)
        if (!mergedRefs.some((m) => m.type === r.type && m.id === r.id)) mergedRefs.push(r);
      await db(tx)
        .updateTable('integration.exceptions')
        .set({
          occurrences: sql`occurrences + 1`,
          last_seen_at: tx.now,
          severity: existing.severity === 'urgent' || input.severity === 'urgent' ? 'urgent' : 'routine',
          problem: input.problem,
          business_impact: input.businessImpact,
          next_step: input.nextStep,
          related_refs: JSON.stringify(mergedRefs.slice(-50)),
          ...(input.technicalDetail ? { technical_detail: JSON.stringify(input.technicalDetail) } : {}),
          version: sql`version + 1`,
        })
        .where('id', '=', existing.id)
        .execute();
      return { exceptionId: existing.id, created: false };
    }
    const id = newId(tx.now.getTime());
    try {
      await db(tx)
        .insertInto('integration.exceptions')
        .values({
          id,
          tenant_id: tx.tenantId,
          connection_id: conn.id,
          property_id:
            input.propertyId ?? (conn.property_ids.length === 1 ? (conn.property_ids[0] ?? null) : null),
          workflow: input.workflow,
          severity: input.severity,
          code,
          dedupe_key: dedupeKey,
          problem: input.problem,
          business_impact: input.businessImpact,
          responsible_party: input.responsibleParty,
          next_step: input.nextStep,
          related_refs: JSON.stringify(refs),
          technical_detail: input.technicalDetail ? JSON.stringify(input.technicalDetail) : null,
          owner_user_id: null,
          owner_department_id: null,
          status: 'open',
          first_seen_at: tx.now,
          last_seen_at: tx.now,
        })
        .execute();
    } catch (err) {
      if ((err as { code?: string }).code === '23505' && attempt === 0) continue;
      throw err;
    }
    await tx.emit({
      type: 'integration.exception.raised',
      propertyId: input.propertyId ?? null,
      aggregate: { type: 'integration_exception', id },
      payload: {
        exceptionId: id,
        connectionId: conn.id,
        workflow: input.workflow,
        severity: input.severity,
        code,
        problem: input.problem,
        responsibleParty: input.responsibleParty,
      },
    });
    return { exceptionId: id, created: true };
  }
  throw new Error('raiseException: unreachable');
}

async function loadException(tx: TxContext, id: string) {
  const row = await db(tx)
    .selectFrom('integration.exceptions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('integration_exception', id);
  return row;
}

/** Domain-map provider: resolve an exception with a resolution note. */
export async function resolveException(
  tx: TxContext,
  input: { exceptionId: string; resolution: string; expectedVersion?: number },
): Promise<IntegrationException> {
  const ex = await loadException(tx, input.exceptionId);
  const conn = await loadConnection(tx, ex.connection_id);
  requireOnConnection(tx, conn, P.exceptionResolve);
  if (ex.status === 'resolved' || ex.status === 'ignored') {
    throw new BusinessRuleError('exception_closed', `This exception was already ${ex.status}.`);
  }
  let q = db(tx)
    .updateTable('integration.exceptions')
    .set({
      status: 'resolved',
      resolution: input.resolution,
      resolved_by: actorKey(tx),
      resolved_at: tx.now,
      version: sql`version + 1`,
    })
    .where('id', '=', ex.id);
  if (input.expectedVersion !== undefined) q = q.where('version', '=', input.expectedVersion);
  const row = await q.returningAll().executeTakeFirst();
  if (!row) {
    return explainVersionMiss(
      'integration_exception',
      ex.id,
      input.expectedVersion ?? ex.version,
      async () => (await loadException(tx, ex.id)).version,
    );
  }
  await tx.audit({
    action: 'integration.exception.resolve',
    target: { type: 'integration_exception', id: ex.id },
    propertyId: ex.property_id,
    reason: input.resolution,
    before: { status: ex.status },
    after: { status: 'resolved' },
  });
  await tx.emit({
    type: 'integration.exception.resolved',
    propertyId: ex.property_id,
    aggregate: { type: 'integration_exception', id: ex.id },
    payload: {
      exceptionId: ex.id,
      connectionId: ex.connection_id,
      resolution: input.resolution,
      automatic: false,
    },
  });
  return toView(row, conn, tx);
}

/** System recovery: resolve open exceptions whose dedupe key starts with a prefix (e.g. an outage that ended). */
export async function autoResolveExceptions(
  tx: TxContext,
  connectionId: string,
  dedupePrefixes: readonly string[],
  resolution: string,
): Promise<number> {
  let n = 0;
  for (const prefix of dedupePrefixes) {
    const rows = await db(tx)
      .updateTable('integration.exceptions')
      .set({
        status: 'resolved',
        resolution,
        resolved_by: 'system:integration',
        resolved_at: tx.now,
        version: sql`version + 1`,
      })
      .where('connection_id', '=', connectionId)
      .where('status', 'in', ['open', 'acknowledged'])
      .where('dedupe_key', 'like', `${prefix}%`)
      .returning(['id', 'property_id'])
      .execute();
    for (const r of rows) {
      n++;
      await tx.emit({
        type: 'integration.exception.resolved',
        propertyId: r.property_id,
        aggregate: { type: 'integration_exception', id: r.id },
        payload: { exceptionId: r.id, connectionId, resolution, automatic: true },
      });
    }
  }
  return n;
}

export async function getException(tx: TxContext, id: string): Promise<IntegrationException> {
  const ex = await loadException(tx, id);
  const conn = await loadConnection(tx, ex.connection_id);
  requireOnConnection(tx, conn, P.connectionRead, 'any');
  return toView(ex, conn, tx);
}

export async function listExceptions(
  tx: TxContext,
  q: {
    connectionId?: string;
    propertyId?: string;
    status: 'open' | 'acknowledged' | 'resolved' | 'ignored' | 'unresolved';
    severity?: Severity;
  },
): Promise<IntegrationException[]> {
  let query = db(tx)
    .selectFrom('integration.exceptions as e')
    .innerJoin('integration.connections as c', 'c.id', 'e.connection_id')
    .selectAll('e')
    .select(['c.property_ids as conn_property_ids'])
    .orderBy('e.severity', 'desc')
    .orderBy('e.last_seen_at', 'desc')
    .limit(500);
  if (q.connectionId) query = query.where('e.connection_id', '=', q.connectionId);
  if (q.propertyId) query = query.where(sql<boolean>`${q.propertyId}::uuid = any(c.property_ids)`);
  if (q.status === 'unresolved') query = query.where('e.status', 'in', ['open', 'acknowledged']);
  else query = query.where('e.status', '=', q.status);
  if (q.severity) query = query.where('e.severity', '=', q.severity);
  const rows = await query.execute();
  const out: IntegrationException[] = [];
  for (const r of rows) {
    const conn = { property_ids: r.conn_property_ids };
    if (!canOnConnection(tx, conn, P.connectionRead)) continue;
    if (q.propertyId && !tx.authz.can(P.connectionRead, { propertyId: q.propertyId })) continue;
    out.push(toView(r, conn, tx));
  }
  return out;
}

export async function assignException(
  tx: TxContext,
  input: {
    exceptionId: string;
    ownerUserId?: string | null;
    ownerDepartmentId?: string | null;
    expectedVersion: number;
  },
): Promise<IntegrationException> {
  const ex = await loadException(tx, input.exceptionId);
  const conn = await loadConnection(tx, ex.connection_id);
  requireOnConnection(tx, conn, P.exceptionResolve);
  const row = await db(tx)
    .updateTable('integration.exceptions')
    .set({
      owner_user_id: input.ownerUserId ?? null,
      owner_department_id: input.ownerDepartmentId ?? null,
      status: ex.status === 'open' ? 'acknowledged' : ex.status,
      version: sql`version + 1`,
    })
    .where('id', '=', ex.id)
    .where('version', '=', input.expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row)
    return explainVersionMiss('integration_exception', ex.id, input.expectedVersion, async () => ex.version);
  await tx.audit({
    action: 'integration.exception.assign',
    target: { type: 'integration_exception', id: ex.id },
    propertyId: ex.property_id,
    before: { ownerUserId: ex.owner_user_id, ownerDepartmentId: ex.owner_department_id, status: ex.status },
    after: { ownerUserId: row.owner_user_id, ownerDepartmentId: row.owner_department_id, status: row.status },
  });
  return toView(row, conn, tx);
}

/** Routine exceptions may be ignored with a reason; urgent ones must be resolved. */
export async function ignoreException(
  tx: TxContext,
  input: { exceptionId: string; reason: string; expectedVersion: number },
): Promise<IntegrationException> {
  const ex = await loadException(tx, input.exceptionId);
  const conn = await loadConnection(tx, ex.connection_id);
  requireOnConnection(tx, conn, P.exceptionResolve);
  if (ex.severity === 'urgent') {
    throw new BusinessRuleError(
      'urgent_exception_cannot_be_ignored',
      'Urgent exceptions affect guests, inventory or money and must be resolved, not ignored. Resolve it with a note explaining what was done.',
    );
  }
  if (ex.status === 'resolved' || ex.status === 'ignored') {
    throw new BusinessRuleError('exception_closed', `This exception was already ${ex.status}.`);
  }
  const row = await db(tx)
    .updateTable('integration.exceptions')
    .set({
      status: 'ignored',
      resolution: input.reason,
      resolved_by: actorKey(tx),
      resolved_at: tx.now,
      version: sql`version + 1`,
    })
    .where('id', '=', ex.id)
    .where('version', '=', input.expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row)
    return explainVersionMiss('integration_exception', ex.id, input.expectedVersion, async () => ex.version);
  await tx.audit({
    action: 'integration.exception.ignore',
    target: { type: 'integration_exception', id: ex.id },
    propertyId: ex.property_id,
    reason: input.reason,
  });
  return toView(row, conn, tx);
}
