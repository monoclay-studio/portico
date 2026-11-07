/**
 * Current source state, the import ledger and exceptions — shared by the pipeline steps.
 */
import type { TxContext } from '@portico/db';
import { newId, requirePermission } from '@portico/kernel';
import type { LedgerEntry } from '../domain/reconcile';
import { type DataClass, FINANCIAL_CLASSES, type Problem, type SourceRecord } from '../domain/records';
import type { RecordState } from '../vocabulary';
import { actorKey, db, type Job } from './context';

/**
 * The ledger namespace of a job's source: the adapter (plus the simulator account). Every job that reads the same
 * source into the same property continues the same ledger, so a second "Move to Portico", a retry or a delta sync
 * can never create a second copy of a record.
 */
export function ledgerNamespace(job: Pick<Job, 'sourceAdapter' | 'sourceRef'>): string {
  return job.sourceRef ? `${job.sourceAdapter}:${job.sourceRef}` : job.sourceAdapter;
}

export async function loadSourceRecords(tx: TxContext, jobId: string): Promise<SourceRecord[]> {
  const rows = await db(tx)
    .selectFrom('migration.source_records')
    .select(['data_class', 'source_key', 'payload', 'raw', 'origin', 'problems', 'quality'])
    .where('job_id', '=', jobId)
    .where('missing_since', 'is', null)
    .execute();
  return rows.map((r) => {
    const problems = [...((r.problems ?? []) as Problem[])];
    for (const q of (r.quality ?? []) as Problem[])
      if (!problems.some((p) => p.code === q.code)) problems.push(q);
    return {
      dataClass: r.data_class as DataClass,
      key: r.source_key,
      payload: r.payload,
      ...(r.raw ? { raw: r.raw as Record<string, string> } : {}),
      origin: r.origin as SourceRecord['origin'],
      problems,
    } as SourceRecord;
  });
}

/** Parsing problems only (without the last validation's quality findings). */
export async function loadParsedRecords(tx: TxContext, jobId: string): Promise<SourceRecord[]> {
  const rows = await db(tx)
    .selectFrom('migration.source_records')
    .select(['data_class', 'source_key', 'payload', 'raw', 'origin', 'problems'])
    .where('job_id', '=', jobId)
    .where('missing_since', 'is', null)
    .execute();
  return rows.map(
    (r) =>
      ({
        dataClass: r.data_class as DataClass,
        key: r.source_key,
        payload: r.payload,
        ...(r.raw ? { raw: r.raw as Record<string, string> } : {}),
        origin: r.origin as SourceRecord['origin'],
        problems: (r.problems ?? []) as Problem[],
      }) as SourceRecord,
  );
}

export async function sourceHashes(tx: TxContext, jobId: string): Promise<Map<string, string>> {
  const rows = await db(tx)
    .selectFrom('migration.source_records')
    .select(['data_class', 'source_key', 'content_hash'])
    .where('job_id', '=', jobId)
    .where('missing_since', 'is', null)
    .execute();
  return new Map(rows.map((r) => [`${r.data_class}:${r.source_key}`, r.content_hash]));
}

export interface LedgerRow extends LedgerEntry {
  importedHash: string | null;
  reason: string | null;
}

export async function loadLedger(tx: TxContext, job: Job): Promise<Map<string, LedgerRow>> {
  requirePermission(tx, 'migration.job.read', { propertyId: job.propertyId });
  const rows = await db(tx)
    .selectFrom('migration.import_ledger')
    .select(['data_class', 'source_key', 'state', 'target_id', 'imported_hash', 'reason'])
    .where('property_id', '=', job.propertyId)
    .where('source_system', '=', ledgerNamespace(job))
    .execute();
  return new Map(
    rows.map((r) => [
      `${r.data_class}:${r.source_key}`,
      {
        dataClass: r.data_class as DataClass,
        key: r.source_key,
        state: r.state as RecordState,
        targetId: r.target_id,
        importedHash: r.imported_hash,
        reason: r.reason,
      },
    ]),
  );
}

/**
 * Record the outcome for one source record. The unique (property, source, class, key) constraint makes this the
 * single place where "exactly once" is enforced: a concurrent or repeated writer updates the same row.
 */
export async function setLedger(
  tx: TxContext,
  job: Job,
  entry: {
    dataClass: DataClass;
    key: string;
    state: RecordState;
    targetType?: string | null;
    targetId?: string | null;
    importedHash?: string | null;
    reason?: string | null;
  },
): Promise<void> {
  const imported = entry.state === 'imported' || entry.state === 'merged';
  await db(tx)
    .insertInto('migration.import_ledger')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      property_id: job.propertyId,
      source_system: ledgerNamespace(job),
      data_class: entry.dataClass,
      source_key: entry.key,
      state: entry.state,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      imported_hash: entry.importedHash ?? null,
      first_job_id: job.id,
      last_job_id: job.id,
      reason: entry.reason ?? null,
      imported_at: imported ? tx.now : null,
      updated_at: tx.now,
    })
    .onConflict((oc) =>
      oc
        .columns(['tenant_id', 'property_id', 'source_system', 'data_class', 'source_key'])
        .doUpdateSet((eb) => ({
          state: entry.state,
          // A target, once created, is never forgotten (re-imports update it; they never create another).
          target_type:
            entry.targetType === undefined ? eb.ref('migration.import_ledger.target_type') : entry.targetType,
          target_id:
            entry.targetId === undefined || entry.targetId === null
              ? eb.ref('migration.import_ledger.target_id')
              : entry.targetId,
          imported_hash:
            entry.importedHash === undefined
              ? eb.ref('migration.import_ledger.imported_hash')
              : entry.importedHash,
          last_job_id: job.id,
          reason: entry.reason ?? null,
          imported_at: imported ? tx.now : eb.ref('migration.import_ledger.imported_at'),
          updated_at: tx.now,
          version: eb('migration.import_ledger.version', '+', 1),
        })),
    )
    .execute();
}

export const OWNER_FOR: Record<DataClass, string> = {
  unit_type: 'Migration lead',
  unit: 'Migration lead',
  rate_plan: 'Revenue manager',
  guest: 'Front office manager',
  reservation: 'Reservations manager',
  deposit: 'Finance controller',
  in_house_balance: 'Finance controller',
  ar_open_item: 'Finance controller',
};

/** Problems on non-financial records whose decision is a money decision (finance owns and closes them). */
export const FINANCIAL_CODES: ReadonlySet<string> = new Set([
  'prepaid_without_deposit',
  'in_house_without_balance',
  'total_mismatch',
  'nightly_total_mismatch',
]);

/** Open (or refresh) an exception; deduplicated per job, class, record and problem code (repeat count). */
export async function raiseException(
  tx: TxContext,
  job: Job,
  e: {
    dataClass: DataClass;
    key: string | null;
    code: string;
    severity: 'blocking' | 'warning';
    problem: string;
    impact?: string;
    proposedResolution?: string;
    ownerRole?: string;
    financial?: boolean;
  },
): Promise<void> {
  const financial = e.financial ?? (FINANCIAL_CLASSES.has(e.dataClass) || FINANCIAL_CODES.has(e.code));
  const impact =
    e.impact ??
    (e.severity === 'blocking'
      ? 'This record is not imported until the exception is resolved; the cutover waits for it.'
      : 'Imported; listed for review.');
  const proposed =
    e.proposedResolution ??
    (e.severity === 'blocking'
      ? 'Correct it in the source and upload a new export, or decide it here (import as is, exclude, accept as loss).'
      : 'Review and close it, or correct it in the source.');
  await db(tx)
    .insertInto('migration.exceptions')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      job_id: job.id,
      property_id: job.propertyId,
      data_class: e.dataClass,
      source_key: e.key ?? '',
      code: e.code,
      severity: e.severity,
      financial,
      problem: e.problem,
      impact,
      proposed_resolution: proposed,
      owner_role: e.ownerRole ?? (financial ? 'Finance controller' : OWNER_FOR[e.dataClass]),
      owner_user_id: null,
      due_at: new Date(tx.now.getTime() + (e.severity === 'blocking' ? 1 : 3) * 86_400_000),
      status: 'open',
      outcome: null,
      resolution: null,
      closed_by: null,
      closed_at: null,
      first_seen_at: tx.now,
      last_seen_at: tx.now,
    })
    .onConflict((oc) =>
      oc.columns(['job_id', 'data_class', 'source_key', 'code']).doUpdateSet((eb) => ({
        problem: e.problem,
        severity: e.severity,
        last_seen_at: tx.now,
        repeat_count: eb('migration.exceptions.repeat_count', '+', 1),
        // A problem seen again after it was closed as corrected re-opens; decisions (import as is, excluded, loss,
        // deferred) are kept — re-validation never undoes a person's decision.
        status: eb
          .case()
          .when(eb('migration.exceptions.outcome', '=', 'corrected'))
          .then('open')
          .else(eb.ref('migration.exceptions.status'))
          .end(),
        outcome: eb
          .case()
          .when(eb('migration.exceptions.outcome', '=', 'corrected'))
          .then(null)
          .else(eb.ref('migration.exceptions.outcome'))
          .end(),
        closed_at: eb
          .case()
          .when(eb('migration.exceptions.outcome', '=', 'corrected'))
          .then(null)
          .else(eb.ref('migration.exceptions.closed_at'))
          .end(),
        version: eb('migration.exceptions.version', '+', 1),
      })),
    )
    .execute();
}

/** Close exceptions of a job whose problem is no longer present (corrected in the source). */
export async function closeCorrected(
  tx: TxContext,
  job: Job,
  stillPresent: ReadonlySet<string>,
  codes: { prefix?: string; only?: ReadonlySet<string> } = {},
): Promise<number> {
  const open = await db(tx)
    .selectFrom('migration.exceptions')
    .select(['id', 'data_class', 'source_key', 'code'])
    .where('job_id', '=', job.id)
    .where('status', 'in', ['open', 'in_progress'])
    .execute();
  let closed = 0;
  for (const o of open) {
    if (codes.only && !codes.only.has(o.code)) continue;
    if (codes.prefix && !o.code.startsWith(codes.prefix)) continue;
    if (stillPresent.has(`${o.data_class}:${o.source_key}:${o.code}`)) continue;
    await db(tx)
      .updateTable('migration.exceptions')
      .set((eb) => ({
        status: 'resolved',
        outcome: 'corrected',
        resolution: 'No longer present in the latest data (corrected in the source).',
        closed_by: actorKey(tx),
        closed_at: tx.now,
        version: eb('version', '+', 1),
      }))
      .where('id', '=', o.id)
      .execute();
    closed++;
  }
  return closed;
}

export type ExceptionDecision = { status: string; outcome: string | null; severity: string };

/** Decisions per record and problem code: `${class}:${key}` → code → decision. */
export async function exceptionDecisions(
  tx: TxContext,
  jobId: string,
): Promise<Map<string, Map<string, ExceptionDecision>>> {
  const rows = await db(tx)
    .selectFrom('migration.exceptions')
    .select(['data_class', 'source_key', 'code', 'status', 'severity', 'outcome'])
    .where('job_id', '=', jobId)
    .execute();
  const out = new Map<string, Map<string, ExceptionDecision>>();
  for (const r of rows) {
    const k = `${r.data_class}:${r.source_key}`;
    const cur = out.get(k) ?? new Map<string, ExceptionDecision>();
    cur.set(r.code, { status: r.status, outcome: r.outcome, severity: r.severity });
    out.set(k, cur);
  }
  return out;
}

/** Blocking problem codes a person may decide to import as is (never ambiguous money, dates or masked data). */
export const IMPORT_AS_IS_ALLOWED: ReadonlySet<string> = new Set([
  'prepaid_without_deposit',
  'in_house_without_balance',
]);

/**
 * Whether a record may be imported now, given its problems and the decisions on its exceptions:
 * 'import' | 'exception' (blocked, waiting) | 'excluded' (by decision: excluded or accepted as loss).
 */
export function importability(
  record: { problems: readonly Problem[]; payload: unknown },
  decisions: Map<string, ExceptionDecision> | undefined,
): { verdict: 'import' | 'exception' | 'excluded'; reason: string | null } {
  if (record.payload === null) {
    const d = [...(decisions?.values() ?? [])].find(
      (x) => x.outcome === 'excluded' || x.outcome === 'accepted_as_loss',
    );
    return d
      ? { verdict: 'excluded', reason: `Excluded by decision (${d.outcome})` }
      : { verdict: 'exception', reason: 'The row could not be read' };
  }
  for (const p of record.problems) {
    if (p.severity !== 'blocking') continue;
    const d = decisions?.get(p.code);
    if (d?.outcome === 'excluded' || d?.outcome === 'accepted_as_loss')
      return { verdict: 'excluded', reason: `Excluded by decision (${d.outcome.replace(/_/g, ' ')})` };
  }
  for (const p of record.problems) {
    if (p.severity !== 'blocking') continue;
    const d = decisions?.get(p.code);
    if (d?.outcome === 'import_as_is' && IMPORT_AS_IS_ALLOWED.has(p.code)) continue;
    return { verdict: 'exception', reason: p.message };
  }
  return { verdict: 'import', reason: null };
}

export async function countOpenBlocking(tx: TxContext, jobId: string): Promise<number> {
  const row = await db(tx)
    .selectFrom('migration.exceptions')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('job_id', '=', jobId)
    .where('severity', '=', 'blocking')
    .where('status', 'in', ['open', 'in_progress'])
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}
