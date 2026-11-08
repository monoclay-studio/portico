/**
 * Extracts: every read of the source is an append-only extract holding what was read (parsed tables of a file pack,
 * or the simulator's records). Source records are MATERIALIZED from extracts with the current plan (status
 * vocabulary, date order), so reviewing a mapping never needs a re-upload, and the same files always give the same
 * records (MG-01). Change capture compares each extract with the previous state by content hash (phase M6).
 */
import { type PorticoDatabase, sql, type TxContext, withTenantTx } from '@portico/db';
import { BusinessRuleError, canonicalJson, newId, type RequestContext, sha256Hex } from '@portico/kernel';
import type { ColumnMatch, TableKind } from '../domain/columns';
import type { Table } from '../domain/csv';
import { type Delta, diffSnapshots, type SnapshotEntry } from '../domain/delta';
import type { MigrationPlan } from '../domain/mapping';
import { buildPack, type PackTable } from '../domain/pack';
import { RERUN_ON_NEW_EXTRACT, type StepKey } from '../domain/pipeline';
import {
  type BookingStatus,
  type ControlTotal,
  contentHash,
  DATA_CLASSES,
  type DataClass,
  type SourceRecord,
} from '../domain/records';
import { findCardNumbers, findCardNumbersInValue, hasCardNumber } from '../domain/sensitive';
import { sourceAdapter } from '../sources/adapters';
import { CardDataInFileError, readPack, type TableReview, type UploadedFile } from '../sources/files';
import { recordsFromSimulator } from '../sources/simulator';
import { actorKey, assertOpen, db, type Job, loadJobFor, type MigrationDeps, saveJob } from './context';

export type ExtractKind = 'initial' | 'delta' | 'sync' | 'final' | 'sweep';

/** What an extract stores: the parsed tables of a file pack, or records read from a system. */
type StoredSource =
  | {
      type: 'tables';
      tables: Array<{
        name: string;
        kind: TableKind;
        spreadsheet: boolean;
        headers: string[];
        rows: string[][];
        columns: ColumnMatch[];
        checksum: string;
      }>;
    }
  | { type: 'records'; name: string; records: SourceRecord[]; controlTotals: ControlTotal[] };

export interface StoredExtract {
  seq: number;
  kind: ExtractKind;
  source: StoredSource;
  classes: DataClass[];
}

const KIND_CLASSES: Record<TableKind, DataClass | null> = {
  unit_types: 'unit_type',
  units: 'unit',
  rate_plans: 'rate_plan',
  guests: 'guest',
  reservations: 'reservation',
  reservation_nights: null,
  deposits: 'deposit',
  in_house_balances: 'in_house_balance',
  ar_open_items: 'ar_open_item',
  control_totals: null,
};

function classesOf(source: StoredSource): DataClass[] {
  if (source.type === 'records') return [...new Set(source.records.map((r) => r.dataClass))];
  const set = new Set<DataClass>();
  for (const t of source.tables) {
    const c = KIND_CLASSES[t.kind];
    if (c) set.add(c);
    // SMB exports carry guests on reservation rows.
    if (t.kind === 'reservations' && !source.tables.some((x) => x.kind === 'guests')) set.add('guest');
  }
  return [...set];
}

export function statusMapOf(plan: MigrationPlan): Record<string, BookingStatus> {
  const out: Record<string, BookingStatus> = {};
  for (const s of plan.statuses) if (s.status) out[s.sourceWord] = s.status;
  return out;
}

/** Records and control totals of an extract under the current plan (pure). */
export function materialize(
  extract: StoredExtract,
  plan: MigrationPlan,
): {
  records: SourceRecord[];
  controlTotals: ControlTotal[];
  ambiguousDateColumns: string[];
  unknownStatuses: string[];
} {
  if (extract.source.type === 'records')
    return {
      records: extract.source.records,
      controlTotals: extract.source.controlTotals,
      ambiguousDateColumns: [],
      unknownStatuses: [],
    };
  const tables: PackTable[] = extract.source.tables.map((t) => ({
    name: t.name,
    kind: t.kind,
    spreadsheet: t.spreadsheet,
    columns: t.columns,
    table: { headers: t.headers, rows: t.rows, delimiter: ',' } satisfies Table,
  }));
  return buildPack(tables, {
    defaultCurrency: plan.defaultCurrency,
    dateOrder: plan.dateOrder,
    statusMap: statusMapOf(plan),
  });
}

/** Extracts with their content (purged extracts — after the retention period — are skipped). */
export async function loadExtracts(tx: TxContext, jobId: string): Promise<StoredExtract[]> {
  const rows = await db(tx)
    .selectFrom('migration.extracts as e')
    .innerJoin('migration.extract_payloads as p', (j) =>
      j.onRef('p.job_id', '=', 'e.job_id').onRef('p.seq', '=', 'e.seq'),
    )
    .select(['e.seq', 'e.kind', 'p.content'])
    .where('e.job_id', '=', jobId)
    .orderBy('e.seq')
    .execute();
  return rows.map((r) => {
    const source = r.content as StoredSource;
    return { seq: r.seq, kind: r.kind, source, classes: classesOf(source) };
  });
}

function fileSummary(source: StoredSource) {
  return source.type === 'tables'
    ? source.tables.map((t) => ({ name: t.name, kind: t.kind, rows: t.rows.length, checksum: t.checksum }))
    : [{ name: source.name, kind: 'records', rows: source.records.length, checksum: '' }];
}

function keyOf(r: { dataClass: string; key: string }) {
  return `${r.dataClass}:${r.key}`;
}

/**
 * Upsert the materialized records of an extract as the current source state. Records of the classes this extract
 * covers that it no longer contains are marked missing (never deleted in Portico). Returns the change set.
 */
export async function applyToSourceState(
  tx: TxContext,
  job: Job,
  seq: number,
  classes: readonly DataClass[],
  records: readonly SourceRecord[],
): Promise<Delta> {
  const before = await db(tx)
    .selectFrom('migration.source_records')
    .select(['data_class', 'source_key', 'content_hash'])
    .where('job_id', '=', job.id)
    .where('missing_since', 'is', null)
    .where('data_class', 'in', classes.length ? [...classes] : ['__none__'])
    .execute();
  // One record per (class, key): the first occurrence; quality checks report conflicting duplicates.
  const unique = new Map<string, SourceRecord>();
  for (const r of records) if (!unique.has(keyOf(r))) unique.set(keyOf(r), r);
  const next: SnapshotEntry[] = [];
  const rows = [...unique.values()].map((r) => {
    const hash = contentHash(r.payload ?? r.raw ?? null);
    next.push({ dataClass: r.dataClass, key: r.key, hash });
    return {
      tenant_id: tx.tenantId,
      job_id: job.id,
      data_class: r.dataClass,
      source_key: r.key,
      content_hash: hash,
      payload: r.payload === null ? null : JSON.stringify(r.payload),
      raw: r.raw ? JSON.stringify(r.raw) : null,
      origin: JSON.stringify(r.origin),
      problems: JSON.stringify(r.problems),
      first_extract: seq,
      last_extract: seq,
      changed_extract: seq,
      missing_since: null,
    };
  });
  for (let i = 0; i < rows.length; i += 500) {
    await db(tx)
      .insertInto('migration.source_records')
      .values(rows.slice(i, i + 500))
      .onConflict((oc) =>
        oc.columns(['job_id', 'data_class', 'source_key']).doUpdateSet({
          payload: sql`excluded.payload`,
          raw: sql`excluded.raw`,
          origin: sql`excluded.origin`,
          problems: sql`excluded.problems`,
          last_extract: sql`excluded.last_extract`,
          changed_extract: sql`case when migration.source_records.content_hash = excluded.content_hash
                                 and migration.source_records.missing_since is null
                                then migration.source_records.changed_extract else excluded.changed_extract end`,
          content_hash: sql`excluded.content_hash`,
          missing_since: null,
        }),
      )
      .execute();
  }
  const present = new Set(rows.map((r) => `${r.data_class}:${r.source_key}`));
  const gone = before.filter((b) => !present.has(`${b.data_class}:${b.source_key}`));
  for (const g of gone)
    await db(tx)
      .updateTable('migration.source_records')
      .set({ missing_since: seq })
      .where('job_id', '=', job.id)
      .where('data_class', '=', g.data_class)
      .where('source_key', '=', g.source_key)
      .execute();
  return diffSnapshots(
    before.map((b) => ({ dataClass: b.data_class as DataClass, key: b.source_key, hash: b.content_hash })),
    next,
  );
}

/**
 * The last guard before anything read from a source is written (MG-02): every text of the extract — table names,
 * headers and cells of a file pack; every value and field name a system sent (simulator, rehearsal copy, future
 * connectors) — is scanned with the kernel card-number detector. Files were scanned already when they were read;
 * this choke point covers every other path into `extract_payloads`.
 */
export function assertNoCardData(source: StoredSource): void {
  const where: string[] = [];
  if (source.type === 'tables') {
    source.tables.forEach((t, ti) => {
      const label = hasCardNumber(t.name) ? `table ${ti + 1}` : t.name;
      if (label !== t.name) where.push(`${label} (name)`);
      for (const f of findCardNumbers(t.headers, t.rows))
        where.push(f.row === 0 ? `${label}, header ${f.column}` : `${label}, row ${f.row}, ${f.column}`);
    });
  } else {
    if (hasCardNumber(source.name)) where.push('source name');
    findCardNumbersInValue(source.records, 'records', where);
    findCardNumbersInValue(source.controlTotals, 'controlTotals', where);
  }
  if (where.length > 0)
    throw new BusinessRuleError(
      'card_data_in_source',
      `The source sent what looks like a payment card number (${where.slice(0, 5).join('; ')}). Nothing from this read was stored. Remove card numbers in the source system (guarantees are re-collected from guests), then read it again.`,
      { findings: where.slice(0, 20) },
    );
}

/** Store a new extract and update the source state. Steps that depend on the data run again. */
export async function storeExtract(
  tx: TxContext,
  job: Job,
  input: { kind: ExtractKind; source: StoredSource },
): Promise<{ job: Job; seq: number; delta: Delta; counts: Record<string, number> }> {
  const last = await db(tx)
    .selectFrom('migration.extracts')
    .select((eb) => eb.fn.max('seq').as('seq'))
    .where('job_id', '=', job.id)
    .executeTakeFirst();
  assertNoCardData(input.source);
  const seq = Number(last?.seq ?? 0) + 1;
  const classes = classesOf(input.source);
  const extract: StoredExtract = { seq, kind: input.kind, source: input.source, classes };
  const m = materialize(extract, job.plan);
  const counts: Record<string, number> = {};
  for (const c of DATA_CLASSES) {
    const n = m.records.filter((r) => r.dataClass === c).length;
    if (n) counts[c] = n;
  }
  const delta = await applyToSourceState(tx, job, seq, classes, m.records);
  const fingerprint = sha256Hex(
    canonicalJson({
      records: m.records.map((r) => [r.dataClass, r.key, contentHash(r.payload ?? r.raw ?? null)]).sort(),
      control: m.controlTotals,
    }),
  ).slice(0, 32);
  await db(tx)
    .insertInto('migration.extracts')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      job_id: job.id,
      seq,
      kind: input.kind,
      files: JSON.stringify(fileSummary(input.source)),
      counts: JSON.stringify(counts),
      control_totals: JSON.stringify(m.controlTotals),
      delta: JSON.stringify({
        added: delta.added.length,
        changed: delta.changed.length,
        removed: delta.removed.length,
      }),
      fingerprint,
      taken_by: actorKey(tx),
      taken_at: tx.now,
    })
    .execute();
  await db(tx)
    .insertInto('migration.extract_payloads')
    .values({ tenant_id: tx.tenantId, job_id: job.id, seq, content: JSON.stringify(input.source) })
    .execute();
  let next = job;
  if (input.kind === 'initial' || input.kind === 'delta') {
    const steps = { ...job.steps };
    for (const s of RERUN_ON_NEW_EXTRACT)
      if (steps[s as StepKey] !== 'pending') steps[s as StepKey] = 'pending';
    // A rehearsed job that receives new data is no longer certified for it.
    next = await saveJob(tx, job, {
      steps,
      ...(job.purpose === 'rehearsal' && job.certificate ? { certificate: null } : {}),
      ...(job.state === 'rehearsed' ? { state: 'in_progress' as const } : {}),
    });
  }
  await tx.audit({
    action: 'migration.extract.take',
    target: { type: 'migration_job', id: job.id },
    propertyId: job.propertyId,
    after: {
      seq,
      kind: input.kind,
      counts,
      delta: { added: delta.added.length, changed: delta.changed.length, removed: delta.removed.length },
    },
  });
  await tx.emit({
    type: 'migration.extract.taken',
    propertyId: job.propertyId,
    aggregate: { type: 'migration_job', id: job.id },
    payload: { jobId: job.id, seq, kind: input.kind, counts },
  });
  return { job: next, seq, delta, counts };
}

/** Re-materialize every extract after a plan decision that changes parsing (statuses, date order). */
export async function rematerialize(tx: TxContext, job: Job): Promise<void> {
  const extracts = await loadExtracts(tx, job.id);
  for (const e of extracts) {
    const m = materialize(e, job.plan);
    await applyToSourceState(tx, job, e.seq, e.classes, m.records);
  }
}

function extractKindFor(job: Job, hasExtract: boolean): ExtractKind {
  if (!hasExtract) return 'initial';
  if (job.state === 'frozen') return 'final';
  if (job.state === 'switched' || job.state === 'rollback_window') return 'sweep';
  if (job.state === 'in_sync') return 'sync';
  return 'delta';
}

export interface UploadOutcome {
  stored: boolean;
  extractSeq: number | null;
  review: TableReview[];
  counts: Record<string, number>;
  delta: { added: number; changed: number; removed: number } | null;
}

/**
 * Upload a file pack. Card numbers anywhere refuse the whole upload and nothing is stored (the refusal is audited in
 * its own transaction, with positions only). When column detection is unsure, nothing is stored until a person
 * confirms the detection (or sends corrections).
 */
export async function uploadFiles(
  database: PorticoDatabase,
  _deps: MigrationDeps,
  ctx: RequestContext,
  jobId: string,
  input: { files: UploadedFile[]; confirmDetection?: boolean | undefined; preview?: boolean },
  opts: { kind?: ExtractKind } = {},
): Promise<UploadOutcome> {
  const job0 = await withTenantTx(database, ctx, (tx) => loadJobFor(tx, jobId, 'migration.job.manage'));
  const adapter = sourceAdapter(job0.sourceAdapter);
  if (!adapter) throw new BusinessRuleError('unknown_source', `Unknown source ${job0.sourceAdapter}.`);
  let pack: ReturnType<typeof readPack>;
  try {
    pack = readPack(input.files, adapter);
  } catch (err) {
    if (err instanceof CardDataInFileError) {
      await withTenantTx(database, ctx, (tx) =>
        tx.audit({
          action: 'migration.upload.refusedCardData',
          target: { type: 'migration_job', id: jobId },
          propertyId: job0.propertyId,
          reason: 'A file contained what looks like a payment card number; nothing was stored.',
          metadata: {
            files: input.files.map((f) => (hasCardNumber(f.name) ? '(file name withheld)' : f.name)),
            findings: err.details?.findings ?? [],
          },
        }),
      );
    }
    throw err;
  }
  const counts = (records: SourceRecord[]) => {
    const out: Record<string, number> = {};
    for (const r of records) out[r.dataClass] = (out[r.dataClass] ?? 0) + 1;
    return out;
  };
  const needs = pack.review.some((r) => r.needsConfirmation);
  if (input.preview || (needs && !input.confirmDetection)) {
    const m = buildPack(pack.tables, {
      defaultCurrency: job0.plan.defaultCurrency,
      dateOrder: job0.plan.dateOrder,
      statusMap: statusMapOf(job0.plan),
    });
    return { stored: false, extractSeq: null, review: pack.review, counts: counts(m.records), delta: null };
  }
  if (pack.review.some((r) => r.missingRequired.length > 0))
    throw new BusinessRuleError(
      'required_columns_missing',
      `Some required columns were not found: ${pack.review
        .filter((r) => r.missingRequired.length)
        .map((r) => `${r.name} (${r.missingRequired.join(', ')})`)
        .join('; ')}. Rename the columns or send column corrections, then upload again.`,
      { review: pack.review },
    );
  return withTenantTx(database, ctx, async (tx) => {
    const job = await loadJobFor(tx, jobId, 'migration.job.manage', { lock: true });
    assertOpen(job);
    const hasExtract = !!(await db(tx)
      .selectFrom('migration.extracts')
      .select('seq')
      .where('job_id', '=', job.id)
      .executeTakeFirst());
    const kind = opts.kind ?? extractKindFor(job, hasExtract);
    const stored = await storeExtract(tx, job, {
      kind,
      source: {
        type: 'tables',
        tables: pack.tables.map((t) => ({
          name: t.name,
          kind: t.kind,
          spreadsheet: t.spreadsheet,
          headers: t.table.headers,
          rows: t.table.rows,
          columns: t.columns,
          checksum: sha256Hex(canonicalJson([t.table.headers, t.table.rows])).slice(0, 32),
        })),
      },
    });
    return {
      stored: true,
      extractSeq: stored.seq,
      review: pack.review,
      counts: stored.counts,
      delta: {
        added: stored.delta.added.length,
        changed: stored.delta.changed.length,
        removed: stored.delta.removed.length,
      },
    };
  });
}

/** Read the simulator (integration's simulated PMS) into a new extract. Refused in live organizations. */
export async function extractFromSimulator(
  tx: TxContext,
  deps: MigrationDeps,
  job: Job,
  kind: ExtractKind,
): Promise<{ job: Job; seq: number; delta: Delta }> {
  if (tx.environment === 'live')
    throw new BusinessRuleError(
      'simulator_not_in_live',
      'The PMS simulator is never a source in a live organization. Use a real export or connection.',
    );
  if (!job.sourceRef)
    throw new BusinessRuleError('simulator_account_missing', 'This migration has no simulator account.');
  const snapshot = await deps.ports.simulator.snapshot(tx, job.sourceRef);
  const records = recordsFromSimulator(snapshot);
  const stored = await storeExtract(tx, job, {
    kind,
    source: { type: 'records', name: `simulator:${job.sourceRef}`, records, controlTotals: [] },
  });
  return { job: stored.job, seq: stored.seq, delta: stored.delta };
}
