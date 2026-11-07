import { type PorticoDatabase, sql, type TxContext, withTenantTx } from '@portico/db';
import {
  canonicalJson,
  DomainError,
  type RequestContext,
  requirePermission,
  sha256Hex,
  ValidationError,
} from '@portico/kernel';
import type {
  Changes,
  SyncBatchInput,
  SyncBatchResult,
  SyncMutation,
  SyncMutationResult,
  TaskView,
  UnitStatusView,
} from '../contracts';
import { syncBatchInput } from '../contracts';
import {
  BatchChain,
  type ChangeSinceBase,
  type ConflictExplanation,
  clampClientTime,
  explainTaskConflict,
  explainUnitConflict,
} from '../domain/sync';
import { recordInspection } from './inspections';
import { actorKey, actorUserId, type Deps, db, loadSettings, toTaskView, toUnitView } from './internal';
import { recordLostFound } from './lost-found';
import { commentTask, loadTask, taskView, transitionTask } from './tasks';
import { loadUnit, reportOccupancy, setCondition, setDnd, setTurndown, unitView } from './units';

type Outcome = 'applied' | 'pending' | 'conflict' | 'rejected';
interface SideEffect {
  unitId: string;
  before: number;
  after: number;
}
type Processed = { result: SyncMutationResult; sideEffects: SideEffect[] };

function entityOf(m: SyncMutation): { type: 'unit' | 'task'; id: string } | null {
  if ('unitId' in m) return { type: 'unit', id: m.unitId };
  if ('taskId' in m) return { type: 'task', id: m.taskId };
  return null;
}

function baseOf(m: SyncMutation): number | null {
  return 'baseVersion' in m ? m.baseVersion : null;
}

/**
 * Apply a batch of offline mutations from the staff app (scenario 13). Each mutation is processed in its own
 * transaction together with its dedupe record, so:
 *  - a retried mutation (same client mutation id) is never applied twice — its stored outcome is returned;
 *  - a mutation based on an outdated version is rejected with what changed and by whom — never applied silently;
 *  - one rejected mutation does not undo the others.
 * The response carries the authoritative state of every record the batch touched.
 */
export async function applySyncBatch(
  d: Deps,
  database: PorticoDatabase,
  ctx: RequestContext,
  rawInput: SyncBatchInput,
): Promise<SyncBatchResult> {
  const input = syncBatchInput.parse(rawInput);
  const chain = new BatchChain();
  const results: SyncMutationResult[] = [];
  const touchedUnits = new Set<string>();
  const touchedTasks = new Set<string>();
  for (const m of input.mutations) {
    const entity = entityOf(m);
    const key = entity ? `${entity.type}:${entity.id}` : null;
    if (entity?.type === 'unit') touchedUnits.add(entity.id);
    if (entity?.type === 'task') touchedTasks.add(entity.id);
    let result: SyncMutationResult;
    let sideEffects: SideEffect[] = [];
    try {
      const processed = await withTenantTx(database, ctx, (tx) =>
        processMutation(d, tx, input, m, chain, key),
      );
      result = processed.result;
      sideEffects = processed.sideEffects;
    } catch (err) {
      // Unexpected failure: nothing (including the dedupe record) was committed; the device may retry as is.
      result = {
        clientMutationId: m.clientMutationId,
        op: m.op,
        status: 'rejected',
        code: err instanceof DomainError ? err.code : 'internal_error',
        message:
          err instanceof DomainError
            ? err.message
            : 'The server could not process this change right now. Nothing was applied; it will be retried automatically.',
        entity,
        baseVersion: baseOf(m),
        resultVersion: null,
        conflict: null,
      };
    }
    if (result.entity?.type === 'task' && result.entity.id) touchedTasks.add(result.entity.id);
    if (key) {
      const status = result.status === 'duplicate' ? (result.originalStatus ?? 'applied') : result.status;
      chain.record(key, {
        clientMutationId: m.clientMutationId,
        clientBase: baseOf(m),
        outcome: status,
        resultVersion: result.resultVersion,
      });
    }
    // A task change made by this device may also have moved its unit (e.g. cleaning → clean): later unit
    // mutations in the batch that were built on the unit version before it chain onto the new version.
    for (const se of sideEffects) {
      touchedUnits.add(se.unitId);
      chain.record(`unit:${se.unitId}`, {
        clientMutationId: m.clientMutationId,
        clientBase: se.before,
        outcome: 'applied',
        resultVersion: se.after,
      });
    }
    results.push(result);
  }
  return withTenantTx(database, ctx, async (tx) => {
    const units: UnitStatusView[] = [];
    for (const id of touchedUnits) {
      const row = await db(tx)
        .selectFrom('operations.unit_status')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (row && row.property_id === input.propertyId) units.push(await unitView(tx, row));
    }
    const tasks: TaskView[] = [];
    for (const id of touchedTasks) {
      const row = await db(tx)
        .selectFrom('operations.tasks')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (row && row.property_id === input.propertyId) tasks.push(await taskView(tx, row));
    }
    return { results, units, tasks, serverTime: tx.now.toISOString() };
  });
}

async function processMutation(
  d: Deps,
  tx: TxContext,
  input: { propertyId: string; deviceId: string },
  m: SyncMutation,
  chain: BatchChain,
  key: string | null,
): Promise<Processed> {
  const entity = entityOf(m);
  const requestHash = sha256Hex(canonicalJson(m));
  const base = baseOf(m);
  const reply = (
    r: Partial<SyncMutationResult> & Pick<SyncMutationResult, 'status'>,
  ): SyncMutationResult => ({
    clientMutationId: m.clientMutationId,
    op: m.op,
    code: null,
    message: null,
    entity,
    baseVersion: base,
    resultVersion: null,
    conflict: null,
    ...r,
  });

  // 1. Already processed? Return the stored outcome; never re-apply.
  const existing = await db(tx)
    .selectFrom('operations.sync_mutations')
    .selectAll()
    .where('client_mutation_id', '=', m.clientMutationId)
    .executeTakeFirst();
  if (existing) return duplicateOf(existing, requestHash, tx, reply);

  // 2. Built on an earlier change of this batch that was not applied → skip (not recorded, may be re-sent).
  const resolved = key ? chain.resolve(key, base) : ({ kind: 'evaluate', base } as const);
  if (resolved.kind === 'skip') {
    return {
      result: reply({
        status: 'skipped',
        code: 'earlier_change_rejected',
        message: `Not applied: it depends on an earlier change from this device (${resolved.dependsOn}) that was not applied. Review the current state and repeat it if still needed.`,
      }),
      sideEffects: [],
    };
  }
  const effectiveBase = resolved.base;

  // 3. Claim the mutation id (a concurrent duplicate waits here, then replays our stored outcome).
  const claimed = await db(tx)
    .insertInto('operations.sync_mutations')
    .values({
      tenant_id: tx.tenantId,
      client_mutation_id: m.clientMutationId,
      device_id: input.deviceId,
      actor_key: actorKey(tx),
      request_hash: requestHash,
      property_id: input.propertyId,
      entity_type: entity?.type ?? 'lost_found_item',
      entity_id: entity?.id ?? null,
      op: m.op,
      outcome: 'rejected',
      base_version: base,
      result_version: null,
      result: JSON.stringify({}),
      client_occurred_at: new Date(m.clientTimestamp),
      processed_at: tx.now,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'client_mutation_id']).doNothing())
    .returning('client_mutation_id')
    .executeTakeFirst();
  if (!claimed) {
    const row = await db(tx)
      .selectFrom('operations.sync_mutations')
      .selectAll()
      .where('client_mutation_id', '=', m.clientMutationId)
      .executeTakeFirstOrThrow();
    return duplicateOf(row, requestHash, tx, reply);
  }

  const settings = await loadSettings(d, tx, input.propertyId);
  const clientAt = clampClientTime(new Date(m.clientTimestamp), tx.now, settings.sync.maxClockSkewMinutes);

  let result: SyncMutationResult;
  const unitOfTask =
    'taskId' in m
      ? ((
          await db(tx)
            .selectFrom('operations.tasks')
            .select('unit_id')
            .where('id', '=', m.taskId)
            .executeTakeFirst()
        )?.unit_id ?? null)
      : null;
  const unitVersion = async () =>
    unitOfTask
      ? ((
          await db(tx)
            .selectFrom('operations.unit_status')
            .select('version')
            .where('id', '=', unitOfTask)
            .executeTakeFirst()
        )?.version ?? null)
      : null;
  const before = await unitVersion();
  let sideEffects: SideEffect[] = [];
  await sql`savepoint sync_mutation`.execute(tx.db);
  try {
    result = await evaluateAndApply(d, tx, input.propertyId, m, effectiveBase, clientAt, reply);
    const after = await unitVersion();
    if (unitOfTask && before !== null && after !== null && after !== before && result.status === 'applied') {
      sideEffects = [{ unitId: unitOfTask, before, after }];
    }
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    await sql`rollback to savepoint sync_mutation`.execute(tx.db);
    result = reply({
      status: err.status === 409 ? 'conflict' : 'rejected',
      code: err.code,
      message: err.message,
    });
    if (err.status === 409 && entity) result.conflict = await conflictDetails(tx, entity, effectiveBase);
  }
  await db(tx)
    .updateTable('operations.sync_mutations')
    .set({
      outcome: result.status as Outcome,
      result_version: result.resultVersion,
      result: JSON.stringify({ ...result, _sideEffects: sideEffects }),
    })
    .where('client_mutation_id', '=', m.clientMutationId)
    .execute();
  return { result, sideEffects };
}

function duplicateOf(
  row: { actor_key: string; request_hash: string; result: unknown; outcome: string },
  requestHash: string,
  tx: TxContext,
  reply: (r: Partial<SyncMutationResult> & Pick<SyncMutationResult, 'status'>) => SyncMutationResult,
): Processed {
  if (row.actor_key !== actorKey(tx) || row.request_hash !== requestHash) {
    return {
      result: reply({
        status: 'rejected',
        code: 'mutation_id_reused',
        message:
          'This client mutation id was already used for a different change. The device must generate a new id per change.',
      }),
      sideEffects: [],
    };
  }
  const { _sideEffects, ...stored } = row.result as SyncMutationResult & { _sideEffects?: SideEffect[] };
  return {
    result: {
      ...stored,
      status: 'duplicate',
      originalStatus: stored.status as Exclude<SyncMutationResult['status'], 'duplicate'>,
    },
    sideEffects: _sideEffects ?? [],
  };
}

async function conflictDetails(
  tx: TxContext,
  entity: { type: 'unit' | 'task'; id: string },
  base: number | null,
): Promise<SyncMutationResult['conflict']> {
  if (entity.type === 'unit') {
    const row = await db(tx)
      .selectFrom('operations.unit_status')
      .select('version')
      .where('id', '=', entity.id)
      .executeTakeFirst();
    if (!row) return null;
    return {
      currentVersion: row.version,
      changesSinceYourVersion: await unitChangesSince(tx, entity.id, base ?? 0),
    };
  }
  const row = await db(tx)
    .selectFrom('operations.tasks')
    .select('version')
    .where('id', '=', entity.id)
    .executeTakeFirst();
  if (!row) return null;
  return {
    currentVersion: row.version,
    changesSinceYourVersion: await taskChangesSince(tx, entity.id, base ?? 0),
  };
}

function actorText(actor: unknown, fallback: string): string {
  const a = actor as { displayName?: string; userId?: string; process?: string };
  return a.displayName ?? a.userId ?? a.process ?? fallback;
}

async function unitChangesSince(tx: TxContext, unitId: string, base: number): Promise<ChangeSinceBase[]> {
  const rows = await db(tx)
    .selectFrom('operations.unit_status_log')
    .selectAll()
    .where('unit_id', '=', unitId)
    .where('version_after', '>', base)
    .orderBy('occurred_at')
    .orderBy('id')
    .execute();
  return rows.map((r) => ({
    field: r.field,
    from: r.from_value,
    to: r.to_value,
    by: actorText(r.actor, r.actor_key),
    at: new Date(r.occurred_at).toISOString(),
    version: r.version_after,
  }));
}

async function taskChangesSince(tx: TxContext, taskId: string, base: number): Promise<ChangeSinceBase[]> {
  const rows = await db(tx)
    .selectFrom('operations.task_activity')
    .selectAll()
    .where('task_id', '=', taskId)
    .where('task_version', '>', base)
    .where('kind', 'in', ['status_changed', 'assigned'])
    .orderBy('occurred_at')
    .orderBy('id')
    .execute();
  return rows.map((r) => ({
    field: r.kind === 'assigned' ? 'assignee' : 'status',
    from: r.from_value,
    to: r.to_value,
    by: actorText(r.actor, r.actor_key),
    at: new Date(r.occurred_at).toISOString(),
    version: r.task_version,
  }));
}

async function evaluateAndApply(
  d: Deps,
  tx: TxContext,
  propertyId: string,
  m: SyncMutation,
  base: number | null,
  clientAt: Date,
  reply: (r: Partial<SyncMutationResult> & Pick<SyncMutationResult, 'status'>) => SyncMutationResult,
): Promise<SyncMutationResult> {
  // Version check with an explanation of what changed (stale mutations are never applied).
  if ('unitId' in m) {
    const unit = await loadUnit(tx, m.unitId, { forUpdate: true });
    if (unit.property_id !== propertyId)
      throw new ValidationError('property_mismatch', 'This unit belongs to another property.');
    if (noChange(m, unit)) {
      return reply({
        status: 'applied',
        noChange: true,
        resultVersion: unit.version,
        message: 'Already in the requested state.',
      });
    }
    if (base !== null && unit.version !== base) {
      const changes = await unitChangesSince(tx, unit.id, base);
      const blockActive = !!unit.block_kind;
      const why: ConflictExplanation = explainUnitConflict({
        current: {
          condition: unit.condition,
          blockActive,
          lastInspectionResult: unit.last_inspection_result,
        },
        changes,
      });
      return reply({
        status: 'conflict',
        code: why.code,
        message: why.message,
        conflict: { currentVersion: unit.version, changesSinceYourVersion: why.changesSinceYourVersion },
      });
    }
  }
  if ('taskId' in m && m.op === 'task.transition') {
    const task = await loadTask(tx, m.taskId, { forUpdate: true });
    if (task.property_id !== propertyId)
      throw new ValidationError('property_mismatch', 'This task belongs to another property.');
    if (task.status === m.to) {
      return reply({
        status: 'applied',
        noChange: true,
        resultVersion: task.version,
        message: 'Already in the requested state.',
      });
    }
    if (base !== null && task.version !== base) {
      const changes = await taskChangesSince(tx, task.id, base);
      const why = explainTaskConflict({
        actorUserId: actorUserId(tx),
        current: {
          status: task.status,
          assigneeUserId: task.assignee_user_id,
          assigneeName: task.assignee_name,
          doneBy: task.done_by,
        },
        changes,
      });
      return reply({
        status: 'conflict',
        code: why.code,
        message: why.message,
        conflict: { currentVersion: task.version, changesSinceYourVersion: why.changesSinceYourVersion },
      });
    }
  }
  const meta = {
    expectedVersion: base ?? undefined,
    source: 'mobile_sync' as const,
    clientOccurredAt: clientAt,
  };
  switch (m.op) {
    case 'unit.setCondition': {
      const r = await setCondition(
        d,
        tx,
        m.unitId,
        { condition: m.condition, ...(m.reason ? { reason: m.reason } : {}) },
        metaFor(meta),
      );
      return reply({ status: r.pending ? 'pending' : 'applied', resultVersion: r.unit.version });
    }
    case 'unit.setDnd': {
      const r = await setDnd(d, tx, m.unitId, { dnd: m.dnd }, metaFor(meta));
      return reply({ status: r.pending ? 'pending' : 'applied', resultVersion: r.unit.version });
    }
    case 'unit.reportOccupancy': {
      const r = await reportOccupancy(
        d,
        tx,
        m.unitId,
        { observed: m.observed, ...(m.note ? { note: m.note } : {}) },
        metaFor(meta),
      );
      return reply({ status: r.pending ? 'pending' : 'applied', resultVersion: r.unit.version });
    }
    case 'unit.setTurndown': {
      const r = await setTurndown(d, tx, m.unitId, { status: m.status }, metaFor(meta));
      return reply({ status: r.pending ? 'pending' : 'applied', resultVersion: r.unit.version });
    }
    case 'task.transition': {
      const t = await transitionTask(
        d,
        tx,
        m.taskId,
        { to: m.to, ...(m.reason ? { reason: m.reason } : {}) },
        { expectedVersion: base ?? undefined, source: 'mobile_sync', clientOccurredAt: clientAt },
      );
      return reply({ status: 'applied', resultVersion: t.version });
    }
    case 'task.comment': {
      const task = await loadTask(tx, m.taskId);
      if (task.property_id !== propertyId)
        throw new ValidationError('property_mismatch', 'This task belongs to another property.');
      const t = await commentTask(
        d,
        tx,
        m.taskId,
        { text: m.text ?? '', attachments: m.attachments ?? [] },
        {
          source: 'mobile_sync',
          clientOccurredAt: clientAt,
        },
      );
      return reply({ status: 'applied', resultVersion: t.version });
    }
    case 'inspection.record': {
      const r = await recordInspection(d, tx, m.unitId, m.inspection, {
        expectedUnitVersion: base ?? undefined,
        source: 'mobile_sync',
        clientInspectedAt: clientAt,
      });
      return reply({ status: r.pending ? 'pending' : 'applied', resultVersion: r.unit.version });
    }
    case 'lostFound.record': {
      const item = await recordLostFound(d, tx, { ...m.item, propertyId }, { source: 'mobile_sync' });
      return reply({
        status: 'applied',
        entity: { type: 'lost_found_item', id: item.id },
        resultVersion: item.version,
      });
    }
  }
}

function metaFor(meta: {
  expectedVersion: number | undefined;
  source: 'mobile_sync';
  clientOccurredAt: Date;
}) {
  // Unit commands require a version: an offline unit change without one is never applied blindly.
  if (meta.expectedVersion === undefined)
    throw new ValidationError(
      'base_version_required',
      'Offline unit changes must include the version the device last saw.',
    );
  return {
    expectedVersion: meta.expectedVersion,
    source: meta.source,
    clientOccurredAt: meta.clientOccurredAt,
  };
}

function noChange(m: SyncMutation, unit: { condition: string; dnd: boolean; turndown: string }): boolean {
  switch (m.op) {
    case 'unit.setCondition':
      return unit.condition === m.condition;
    case 'unit.setDnd':
      return unit.dnd === m.dnd;
    case 'unit.setTurndown':
      return unit.turndown === m.status;
    default:
      return false;
  }
}

// ───────────────────────────── Delta pull ─────────────────────────────

interface Cursor {
  /** Snapshot-xmin floor of this pull sequence: rows with feed_xid >= floor are (re)sent. */
  f: string;
  /** Floor for the NEXT sequence (xmin captured on the first page). */
  n: string;
  /** Per-table paging position [feed_xid, id] within this sequence. */
  u?: [string, string] | null;
  t?: [string, string] | null;
  w?: [string, string] | null;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if (!/^\d+$/.test(c.f) || !/^\d+$/.test(c.n)) throw new Error('bad');
    return c;
  } catch {
    throw new ValidationError(
      'invalid_cursor',
      'The sync cursor is not valid. Start a full sync without a cursor.',
    );
  }
}

/**
 * Changes since a cursor for the staff app (units, tasks, work orders). Correct under concurrency: the cursor is
 * the reader's snapshot xmin, so changes committed later by transactions that were running during the previous
 * pull are always delivered (possibly twice — clients upsert by version).
 */
export async function pullChanges(
  _d: Deps,
  tx: TxContext,
  q: { propertyId: string; cursor?: string; limit: number },
): Promise<Changes> {
  requirePermission(tx, 'operations.unit.read', { propertyId: q.propertyId });
  const prior = decodeCursor(q.cursor);
  const { rows } = await sql<{
    xmin: string;
  }>`select pg_snapshot_xmin(pg_current_snapshot())::text as xmin`.execute(tx.db);
  const xminNow = rows[0]?.xmin ?? '0';
  const cur: Cursor = prior ?? { f: '0', n: xminNow };
  if (prior && !prior.u && !prior.t && !prior.w) cur.n = xminNow; // a new sequence starts at this pull
  const limit = q.limit;
  const after = (pos: [string, string] | null | undefined) =>
    pos
      ? sql<boolean>`(feed_xid, id) > (${pos[0]}::xid8, ${pos[1]}::uuid)`
      : sql<boolean>`feed_xid >= ${cur.f}::xid8`;
  const unitRows = await db(tx)
    .selectFrom('operations.unit_status')
    .selectAll()
    .select(sql<string>`feed_xid::text`.as('xid'))
    .where('property_id', '=', q.propertyId)
    .where(after(cur.u))
    .orderBy(sql`feed_xid`)
    .orderBy('id')
    .limit(limit + 1)
    .execute();
  const taskRows = await db(tx)
    .selectFrom('operations.tasks')
    .selectAll()
    .select(sql<string>`feed_xid::text`.as('xid'))
    .where('property_id', '=', q.propertyId)
    .where(after(cur.t))
    .orderBy(sql`feed_xid`)
    .orderBy('id')
    .limit(limit + 1)
    .execute();
  const woRows = await db(tx)
    .selectFrom('operations.work_orders')
    .select(['id', 'number', 'unit_id', 'task_id', 'version'])
    .select(sql<string>`feed_xid::text`.as('xid'))
    .where('property_id', '=', q.propertyId)
    .where(after(cur.w))
    .orderBy(sql`feed_xid`)
    .orderBy('id')
    .limit(limit + 1)
    .execute();
  const hasMore = unitRows.length > limit || taskRows.length > limit || woRows.length > limit;
  const u = unitRows.slice(0, limit);
  const t = taskRows.slice(0, limit);
  const w = woRows.slice(0, limit);
  const last = <T extends { xid: string; id: string }>(
    list: T[],
    prev: [string, string] | null | undefined,
  ) => {
    const x = list[list.length - 1];
    return x ? ([x.xid, x.id] as [string, string]) : (prev ?? null);
  };
  const next: Cursor = hasMore
    ? { f: cur.f, n: cur.n, u: last(u, cur.u), t: last(t, cur.t), w: last(w, cur.w) }
    : { f: cur.n, n: cur.n };
  const sections = await db(tx)
    .selectFrom('operations.sections')
    .select(['id', 'name'])
    .where('property_id', '=', q.propertyId)
    .execute();
  const sectionName = new Map(sections.map((s) => [s.id, s.name]));
  const taskUnitIds = [...new Set(t.map((r) => r.unit_id).filter((x): x is string => !!x))];
  const unitNumbers = new Map(
    taskUnitIds.length
      ? (
          await db(tx)
            .selectFrom('operations.unit_status')
            .select(['id', 'unit_number'])
            .where('id', 'in', taskUnitIds)
            .execute()
        ).map((r) => [r.id, r.unit_number] as const)
      : [],
  );
  return {
    units: u.map((r) =>
      toUnitView(r, { sectionName: r.section_id ? (sectionName.get(r.section_id) ?? null) : null }),
    ),
    tasks: t.map((r) => toTaskView(r, tx.now, r.unit_id ? (unitNumbers.get(r.unit_id) ?? null) : null)),
    workOrders: w.map((r) => ({
      id: r.id,
      number: r.number,
      unitId: r.unit_id,
      taskId: r.task_id,
      version: r.version,
    })),
    cursor: encodeCursor(next),
    hasMore,
    serverTime: tx.now.toISOString(),
  };
}
