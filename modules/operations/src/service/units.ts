import { explainVersionMiss, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  type LocalDate,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
  VersionConflictError,
} from '@portico/kernel';
import type {
  ArrivalReadiness,
  Board,
  BoardQuery,
  Readiness,
  StatusForwardView,
  UnitChangeResult,
  UnitStatusView,
  UnitUpsertInput,
} from '../contracts';
import {
  assertManualConditionChange,
  assessReadiness,
  deriveDiscrepancy,
  type OpenUnitTask,
} from '../domain/conditions';
import {
  HOUSEKEEPING_KINDS,
  type ObservedOccupancy,
  type Occupancy,
  OPEN_TASK_STATUSES,
  type TaskKind,
  type TaskPriority,
  type TaskStatus,
  type TurndownStatus,
  type UnitCondition,
} from '../domain/model';
import { PRIORITY_RANK } from '../domain/tasks';
import {
  actorKey,
  actorName,
  type Deps,
  db,
  feedMark,
  iso,
  loadSettings,
  logUnit,
  propertyFacts,
  toUnitView,
  type UnitRow,
} from './internal';
import { setDndOnServiceTasks } from './tasks';

const P = {
  read: 'operations.unit.read',
  configure: 'operations.unit.configure',
  update: 'operations.housekeeping.update',
  external: 'operations.external.sync',
} as const;

// ───────────────────────────── Loading ─────────────────────────────

export async function loadUnit(
  tx: TxContext,
  unitId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<UnitRow> {
  let q = db(tx).selectFrom('operations.unit_status').selectAll().where('id', '=', unitId);
  if (opts.forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw new NotFoundError('unit', unitId);
  return row;
}

async function sectionName(tx: TxContext, sectionId: string | null): Promise<string | null> {
  if (!sectionId) return null;
  const s = await db(tx)
    .selectFrom('operations.sections')
    .select('name')
    .where('id', '=', sectionId)
    .executeTakeFirst();
  return s?.name ?? null;
}

export async function unitView(tx: TxContext, row: UnitRow, readiness?: Readiness): Promise<UnitStatusView> {
  return toUnitView(row, {
    sectionName: await sectionName(tx, row.section_id),
    ...(readiness ? { readiness } : {}),
  });
}

// ───────────────────────────── Catalog mirror ─────────────────────────────

/**
 * Mirror units into operations (from inventory, an integration mapping, or seed data). Existing units keep
 * their condition; catalog fields (number, type, section, features) are refreshed.
 */
export async function upsertUnits(
  d: Deps,
  tx: TxContext,
  propertyId: string,
  input: UnitUpsertInput,
): Promise<{ created: number; updated: number }> {
  requirePermission(tx, P.configure, { propertyId });
  const sections = await db(tx)
    .selectFrom('operations.sections')
    .select(['id', 'code'])
    .where('property_id', '=', propertyId)
    .execute();
  const sectionByCode = new Map(sections.map((s) => [s.code, s.id]));
  let created = 0;
  let updated = 0;
  for (const u of input.units) {
    let sectionId: string | null = null;
    if (u.sectionCode) {
      sectionId = sectionByCode.get(u.sectionCode) ?? null;
      if (!sectionId)
        throw new ValidationError(
          'unknown_section',
          `Section "${u.sectionCode}" does not exist at this property. Create it first.`,
          { sectionCode: u.sectionCode },
        );
    }
    const existing = await db(tx)
      .selectFrom('operations.unit_status')
      .select(['id', 'property_id'])
      .where('id', '=', u.unitId)
      .executeTakeFirst();
    if (existing && existing.property_id !== propertyId) {
      throw new ValidationError('unit_property_mismatch', `Unit ${u.number} belongs to another property.`, {
        unitId: u.unitId,
      });
    }
    if (existing) {
      await db(tx)
        .updateTable('operations.unit_status')
        .set({
          unit_number: u.number,
          unit_type_id: u.unitTypeId ?? null,
          unit_type_code: u.unitTypeCode ?? null,
          ...(u.sectionCode !== undefined ? { section_id: sectionId } : {}),
          floor: u.floor ?? null,
          location_path: u.locationPath ?? null,
          features: u.features ?? [],
          active: u.active ?? true,
          feed_xid: feedMark(),
          updated_at: tx.now,
        })
        .where('id', '=', u.unitId)
        .execute();
      updated++;
    } else {
      const condition = input.initialCondition ?? 'dirty';
      await db(tx)
        .insertInto('operations.unit_status')
        .values({
          id: u.unitId,
          tenant_id: tx.tenantId,
          property_id: propertyId,
          unit_number: u.number,
          unit_type_id: u.unitTypeId ?? null,
          unit_type_code: u.unitTypeCode ?? null,
          section_id: sectionId,
          floor: u.floor ?? null,
          location_path: u.locationPath ?? null,
          features: u.features ?? [],
          active: u.active ?? true,
          condition,
          condition_changed_at: tx.now,
          condition_changed_by: actorName(tx),
          last_cleaned_at: null,
          last_cleaned_by: null,
          last_inspected_at: condition === 'inspected' ? tx.now : null,
          last_inspection_id: null,
          last_inspection_result: null,
          ready_at: null,
          expected_ready_at: null,
          occupancy_stay_id: null,
          observed_occupancy: null,
          observed_at: null,
          observed_by: null,
          dnd_since: null,
          block_kind: null,
          block_id: null,
          block_from: null,
          block_to: null,
          block_reason: null,
          block_work_order_id: null,
          pending_forward_id: null,
          pending_change: null,
          external_synced_at: null,
          feed_xid: feedMark(),
        })
        .execute();
      created++;
    }
    await refreshReadiness(d, tx, u.unitId);
  }
  await tx.audit({
    action: 'operations.unit.upsertCatalog',
    target: { type: 'property', id: propertyId },
    propertyId,
    after: { created, updated, units: input.units.map((u) => u.number) },
  });
  return { created, updated };
}

export async function syncUnitsFromInventory(d: Deps, tx: TxContext, propertyId: string) {
  requirePermission(tx, P.configure, { propertyId });
  const units = await d.ports.inventory.listUnits(tx, { propertyId });
  if (!units.length) return { created: 0, updated: 0 };
  return upsertUnits(d, tx, propertyId, {
    units: units.map((u) => ({
      unitId: u.id,
      number: u.number,
      unitTypeId: u.unitTypeId,
      unitTypeCode: u.unitTypeCode,
      locationPath: u.locationPath,
      features: u.features,
      active: u.active,
    })),
  });
}

// ───────────────────────────── Readiness ─────────────────────────────

async function openUnitTasks(tx: TxContext, unitId: string): Promise<OpenUnitTask[]> {
  const rows = await db(tx)
    .selectFrom('operations.tasks')
    .select([
      'id',
      'kind',
      'status',
      'credits',
      'started_at',
      'assignee_user_id',
      'assignee_name',
      'priority_score',
      'created_at',
    ])
    .where('unit_id', '=', unitId)
    .where('status', 'in', [...OPEN_TASK_STATUSES])
    .where('kind', 'in', [...HOUSEKEEPING_KINDS])
    .orderBy('created_at')
    .execute();
  const out: OpenUnitTask[] = [];
  for (const r of rows) {
    let queueAheadCredits = 0;
    if (r.assignee_user_id && r.status !== 'in_progress') {
      const ahead = await db(tx)
        .selectFrom('operations.tasks')
        .select(['credits', 'status', 'priority_score', 'created_at'])
        .where('assignee_user_id', '=', r.assignee_user_id)
        .where('id', '!=', r.id)
        .where('status', 'in', ['open', 'in_progress'])
        .where('kind', 'in', [...HOUSEKEEPING_KINDS])
        .execute();
      queueAheadCredits = ahead
        .filter(
          (a) =>
            a.status === 'in_progress' ||
            a.priority_score > r.priority_score ||
            (a.priority_score === r.priority_score && new Date(a.created_at) < new Date(r.created_at)),
        )
        .reduce((sum, a) => sum + a.credits, 0);
    }
    out.push({
      id: r.id,
      kind: r.kind as TaskKind,
      status: r.status as TaskStatus,
      credits: r.credits,
      startedAt: r.started_at ? new Date(r.started_at) : null,
      assigneeName: r.assignee_name,
      queueAheadCredits,
    });
  }
  return out;
}

/** Fresh readiness assessment for a unit (reads its open tasks and last inspection). */
export async function computeReadiness(d: Deps, tx: TxContext, row: UnitRow): Promise<Readiness> {
  const settings = await loadSettings(d, tx, row.property_id);
  const facts = await propertyFacts(d, tx, row.property_id);
  let lastFailure: { reasons: string[]; inspectedAt: Date } | null = null;
  if (row.condition === 'failed_inspection' && row.last_inspection_id) {
    const insp = await db(tx)
      .selectFrom('operations.inspections')
      .select(['failure_reasons', 'inspected_at'])
      .where('id', '=', row.last_inspection_id)
      .executeTakeFirst();
    if (insp) {
      const reasons = (insp.failure_reasons as Array<{ label: string; note: string | null }>).map((f) =>
        f.note ? `${f.label}: ${f.note}` : f.label,
      );
      lastFailure = { reasons, inspectedAt: new Date(insp.inspected_at) };
    }
  }
  const a = assessReadiness({
    now: tx.now,
    date: facts.businessDate,
    condition: row.condition as UnitCondition,
    occupancy: row.occupancy as Occupancy,
    block:
      row.block_kind && row.block_from && row.block_to
        ? {
            kind: row.block_kind as 'out_of_order',
            from: row.block_from,
            to: row.block_to,
            reason: row.block_reason,
          }
        : null,
    pendingChange: row.pending_forward_id
      ? ((row.pending_change ?? {}) as { condition?: UnitCondition })
      : null,
    lastFailure,
    requiredCondition: settings.readinessCondition,
    openTasks: await openUnitTasks(tx, row.id),
    minutesPerCredit: settings.minutesPerCredit,
    inspectionMinutes: settings.inspectionMinutes,
  });
  const readyAt = a.ready ? (row.ready_at ? new Date(row.ready_at) : tx.now) : null;
  return {
    ready: a.ready,
    requiredCondition: settings.readinessCondition,
    reasons: a.reasons,
    readyAt: iso(readyAt),
    expectedReadyAt: iso(a.expectedReadyAt),
    estimateBasis: a.estimateBasis,
    assessedAt: tx.now.toISOString(),
  };
}

/**
 * Recompute and store the derived readiness of a unit. Derived data does NOT bump the unit's version (so an
 * offline device never gets a conflict because an estimate moved) but does advance the change feed.
 */
export async function refreshReadiness(d: Deps, tx: TxContext, unitId: string): Promise<UnitRow> {
  const row = await loadUnit(tx, unitId);
  const r = await computeReadiness(d, tx, row);
  return db(tx)
    .updateTable('operations.unit_status')
    .set({
      readiness: JSON.stringify(r),
      ready_at: r.readyAt ? new Date(r.readyAt) : null,
      expected_ready_at: r.expectedReadyAt ? new Date(r.expectedReadyAt) : null,
      feed_xid: feedMark(),
    })
    .where('id', '=', unitId)
    .returningAll()
    .executeTakeFirstOrThrow();
}

// ───────────────────────────── Writing room status ─────────────────────────────

export interface RoomStatusPatch {
  condition?: UnitCondition;
  dnd?: boolean;
  observedOccupancy?: ObservedOccupancy;
  turndown?: TurndownStatus;
}

export interface WriteMeta {
  reason?: string | null;
  source: 'staff' | 'mobile_sync' | 'event' | 'inspection' | 'task' | 'external' | 'forward_ack' | 'system';
  clientOccurredAt?: Date | null;
  expectedVersion?: number;
  /** Skip the data-authority check (event-driven facts, external sync, forward acknowledgements). */
  authorityChecked?: boolean;
  provenance?: 'live' | 'external';
  /** Extra columns written with the change (inspection results, block fields). */
  extra?: Partial<{
    last_inspected_at: Date;
    last_inspection_id: string;
    last_inspection_result: 'passed' | 'failed';
    external_synced_at: Date;
  }>;
}

function assertVersion(row: UnitRow, expected: number | undefined) {
  if (expected !== undefined && row.version !== expected) {
    throw new VersionConflictError('unit', row.id, expected, row.version);
  }
}

/**
 * The single writer for room-status fields (condition, DND, observed occupancy, turndown). Enforces data
 * authority (`roomStatus`): with an external system of record in forward mode the change is recorded as
 * PENDING and forwarded; it becomes effective only when acknowledged (ADR-0014).
 */
export async function writeRoomStatus(
  d: Deps,
  tx: TxContext,
  row: UnitRow,
  patch: RoomStatusPatch,
  meta: WriteMeta,
): Promise<{ row: UnitRow; pending: boolean; forwardId: string | null }> {
  assertVersion(row, meta.expectedVersion);
  if (!meta.authorityChecked) {
    const mode = await d.ports.platform.assertWritable(tx, row.property_id, 'roomStatus');
    if (mode === 'forward') return forwardRoomStatus(d, tx, row, patch, meta);
  }
  return applyRoomStatus(d, tx, row, patch, meta);
}

async function forwardRoomStatus(
  d: Deps,
  tx: TxContext,
  row: UnitRow,
  patch: RoomStatusPatch,
  meta: WriteMeta,
): Promise<{ row: UnitRow; pending: boolean; forwardId: string | null }> {
  const authority = await d.ports.platform.getDataAuthority(tx, row.property_id, 'roomStatus');
  // A newer request replaces an unacknowledged older one for the same unit (the system of record gets the latest).
  await db(tx)
    .updateTable('operations.status_forwards')
    .set({ status: 'superseded', resolved_at: tx.now, version: (eb) => eb('version', '+', 1) })
    .where('target_id', '=', row.id)
    .where('domain', '=', 'roomStatus')
    .where('status', '=', 'pending')
    .execute();
  const forwardId = newId(tx.now.getTime());
  const change = { ...patch, ...(meta.reason ? { reason: meta.reason } : {}) };
  await db(tx)
    .insertInto('operations.status_forwards')
    .values({
      id: forwardId,
      tenant_id: tx.tenantId,
      property_id: row.property_id,
      domain: 'roomStatus',
      connection_id: authority.connectionId,
      target_type: 'unit',
      target_id: row.id,
      change: JSON.stringify(change),
      requested_by: actorKey(tx),
      requested_at: tx.now,
      resolved_at: null,
      external_ref: null,
      rejection_reason: null,
    })
    .execute();
  const updated = await db(tx)
    .updateTable('operations.unit_status')
    .set({
      pending_forward_id: forwardId,
      pending_change: JSON.stringify({ ...change, requestedAt: tx.now.toISOString() }),
      version: (eb) => eb('version', '+', 1),
      feed_xid: feedMark(),
      updated_at: tx.now,
    })
    .where('id', '=', row.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'operations.roomStatus.forward',
    target: { type: 'unit', id: row.id },
    propertyId: row.property_id,
    reason: meta.reason ?? null,
    before: { condition: row.condition, dnd: row.dnd, turndown: row.turndown },
    after: { pending: change, forwardId, systemName: authority.systemName },
  });
  await tx.emit({
    type: 'operations.statusForward.requested',
    propertyId: row.property_id,
    aggregate: { type: 'unit', id: row.id },
    payload: {
      forwardId,
      domain: 'roomStatus',
      connectionId: authority.connectionId,
      unitId: row.id,
      unitNumber: row.unit_number,
      change,
    },
  });
  const refreshed = await refreshReadiness(d, tx, updated.id);
  return { row: refreshed, pending: true, forwardId };
}

async function applyRoomStatus(
  d: Deps,
  tx: TxContext,
  row: UnitRow,
  patch: RoomStatusPatch,
  meta: WriteMeta,
): Promise<{ row: UnitRow; pending: boolean; forwardId: string | null }> {
  const changes: Array<{ field: string; from: string | null; to: string | null }> = [];
  const set: Record<string, unknown> = {};
  if (patch.condition !== undefined && patch.condition !== row.condition) {
    changes.push({ field: 'condition', from: row.condition, to: patch.condition });
    set.condition = patch.condition;
    set.condition_changed_at = tx.now;
    set.condition_changed_by = actorName(tx);
    if (patch.condition === 'clean') {
      set.last_cleaned_at = tx.now;
      set.last_cleaned_by = actorName(tx);
    }
  }
  if (patch.dnd !== undefined && patch.dnd !== row.dnd) {
    changes.push({ field: 'dnd', from: String(row.dnd), to: String(patch.dnd) });
    set.dnd = patch.dnd;
    set.dnd_since = patch.dnd ? tx.now : null;
  }
  if (patch.turndown !== undefined && patch.turndown !== row.turndown) {
    changes.push({ field: 'turndown', from: row.turndown, to: patch.turndown });
    set.turndown = patch.turndown;
  }
  let discrepancy = row.discrepancy;
  if (patch.observedOccupancy !== undefined) {
    changes.push({ field: 'observed_occupancy', from: row.observed_occupancy, to: patch.observedOccupancy });
    set.observed_occupancy = patch.observedOccupancy;
    set.observed_at = tx.now;
    set.observed_by = actorName(tx);
    discrepancy = deriveDiscrepancy(row.occupancy as Occupancy, patch.observedOccupancy);
    set.discrepancy = discrepancy;
  }
  if (meta.extra) Object.assign(set, meta.extra);
  if (meta.provenance) set.provenance = meta.provenance;
  if (!changes.length && !meta.extra) return { row, pending: false, forwardId: null };
  const updated = await db(tx)
    .updateTable('operations.unit_status')
    .set({ ...set, version: (eb) => eb('version', '+', 1), feed_xid: feedMark(), updated_at: tx.now })
    .where('id', '=', row.id)
    .where('version', '=', row.version)
    .returningAll()
    .executeTakeFirst();
  if (!updated) {
    return explainVersionMiss('unit', row.id, row.version, async () => (await loadUnit(tx, row.id)).version);
  }
  for (const c of changes) {
    await logUnit(tx, row, {
      ...c,
      reason: meta.reason ?? null,
      source: meta.source,
      versionAfter: updated.version,
      clientOccurredAt: meta.clientOccurredAt ?? null,
    });
  }
  const refreshed = await refreshReadiness(d, tx, row.id);
  const condition = changes.find((c) => c.field === 'condition');
  if (condition) {
    const readiness = refreshed.readiness as Readiness;
    await tx.audit({
      action: 'operations.unit.conditionChange',
      target: { type: 'unit', id: row.id },
      propertyId: row.property_id,
      reason: meta.reason ?? null,
      before: { condition: row.condition },
      after: { condition: condition.to, source: meta.source },
    });
    await tx.emit({
      type: 'operations.unit.conditionChanged',
      propertyId: row.property_id,
      aggregate: { type: 'unit', id: row.id },
      payload: {
        unitId: row.id,
        unitNumber: row.unit_number,
        from: condition.from,
        to: condition.to,
        reason: meta.reason ?? null,
        source: meta.source,
        ready: readiness.ready,
        expectedReadyAt: readiness.expectedReadyAt,
      },
    });
  }
  if (discrepancy !== row.discrepancy && discrepancy !== 'none') {
    await tx.audit({
      action: 'operations.unit.discrepancyReported',
      target: { type: 'unit', id: row.id },
      propertyId: row.property_id,
      reason: meta.reason ?? null,
      before: { occupancy: row.occupancy, discrepancy: row.discrepancy },
      after: { observed: patch.observedOccupancy, discrepancy },
    });
    await tx.emit({
      type: 'operations.unit.discrepancyReported',
      propertyId: row.property_id,
      aggregate: { type: 'unit', id: row.id },
      payload: {
        unitId: row.id,
        unitNumber: row.unit_number,
        systemOccupancy: row.occupancy,
        observed: patch.observedOccupancy,
        discrepancy,
        stayId: row.occupancy_stay_id,
      },
    });
  }
  return { row: refreshed, pending: false, forwardId: null };
}

async function changeResult(
  tx: TxContext,
  r: { row: UnitRow; pending: boolean; forwardId: string | null },
): Promise<UnitChangeResult> {
  return { unit: await unitView(tx, r.row), pending: r.pending, forwardId: r.forwardId };
}

export interface StaffChangeMeta {
  expectedVersion: number;
  source?: 'staff' | 'mobile_sync';
  clientOccurredAt?: Date | null;
}

export async function setCondition(
  d: Deps,
  tx: TxContext,
  unitId: string,
  input: { condition: UnitCondition; reason?: string },
  meta: StaffChangeMeta,
): Promise<UnitChangeResult> {
  const row = await loadUnit(tx, unitId, { forUpdate: true });
  requirePermission(tx, P.update, { propertyId: row.property_id });
  assertVersion(row, meta.expectedVersion);
  assertManualConditionChange(row.condition as UnitCondition, input.condition);
  const r = await writeRoomStatus(
    d,
    tx,
    row,
    { condition: input.condition },
    {
      reason: input.reason ?? null,
      source: meta.source ?? 'staff',
      clientOccurredAt: meta.clientOccurredAt ?? null,
      expectedVersion: meta.expectedVersion,
    },
  );
  return changeResult(tx, r);
}

export async function setDnd(
  d: Deps,
  tx: TxContext,
  unitId: string,
  input: { dnd: boolean; reason?: string },
  meta: StaffChangeMeta,
): Promise<UnitChangeResult> {
  const row = await loadUnit(tx, unitId, { forUpdate: true });
  requirePermission(tx, P.update, { propertyId: row.property_id });
  assertVersion(row, meta.expectedVersion);
  if (row.dnd === input.dnd) {
    throw new BusinessRuleError(
      'dnd_unchanged',
      `Do-not-disturb is already ${input.dnd ? 'on' : 'off'} for this unit. Nothing was changed.`,
    );
  }
  const r = await writeRoomStatus(
    d,
    tx,
    row,
    { dnd: input.dnd },
    {
      reason: input.reason ?? null,
      source: meta.source ?? 'staff',
      clientOccurredAt: meta.clientOccurredAt ?? null,
      expectedVersion: meta.expectedVersion,
    },
  );
  // DND blocks in-room service: open stayover/turndown tasks for the unit are blocked (and unblocked again).
  if (!r.pending) await setDndOnServiceTasks(d, tx, row, input.dnd);
  return changeResult(tx, r);
}

export async function reportOccupancy(
  d: Deps,
  tx: TxContext,
  unitId: string,
  input: { observed: ObservedOccupancy; note?: string },
  meta: StaffChangeMeta,
): Promise<UnitChangeResult> {
  const row = await loadUnit(tx, unitId, { forUpdate: true });
  requirePermission(tx, P.update, { propertyId: row.property_id });
  const r = await writeRoomStatus(
    d,
    tx,
    row,
    { observedOccupancy: input.observed },
    {
      reason: input.note ?? null,
      source: meta.source ?? 'staff',
      clientOccurredAt: meta.clientOccurredAt ?? null,
      expectedVersion: meta.expectedVersion,
    },
  );
  return changeResult(tx, r);
}

export async function setTurndown(
  d: Deps,
  tx: TxContext,
  unitId: string,
  input: { status: TurndownStatus },
  meta: StaffChangeMeta,
): Promise<UnitChangeResult> {
  const row = await loadUnit(tx, unitId, { forUpdate: true });
  requirePermission(tx, P.update, { propertyId: row.property_id });
  const r = await writeRoomStatus(
    d,
    tx,
    row,
    { turndown: input.status },
    {
      source: meta.source ?? 'staff',
      clientOccurredAt: meta.clientOccurredAt ?? null,
      expectedVersion: meta.expectedVersion,
    },
  );
  return changeResult(tx, r);
}

/**
 * A system-originated condition change (checkout → dirty, room move, maintenance). When an external system is
 * the system of record for room status it produces these changes itself, so Portico does not write them.
 */
export async function systemConditionChange(
  d: Deps,
  tx: TxContext,
  row: UnitRow,
  condition: UnitCondition,
  reason: string,
): Promise<UnitRow> {
  if (row.condition === condition) return row;
  const authority = await d.ports.platform.getDataAuthority(tx, row.property_id, 'roomStatus');
  if (authority.authority === 'external') return row;
  const r = await applyRoomStatus(
    d,
    tx,
    row,
    { condition },
    { reason, source: 'event', authorityChecked: true },
  );
  return r.row;
}

// ───────────────────────────── Reads ─────────────────────────────

export async function getUnit(_d: Deps, tx: TxContext, unitId: string): Promise<UnitStatusView> {
  const row = await loadUnit(tx, unitId);
  requirePermission(tx, P.read, { propertyId: row.property_id });
  return unitView(tx, row);
}

/** Fresh readiness (computed now, not the stored snapshot). */
export async function getUnitReadiness(d: Deps, tx: TxContext, unitId: string): Promise<UnitStatusView> {
  const row = await loadUnit(tx, unitId);
  requirePermission(tx, P.read, { propertyId: row.property_id });
  return unitView(tx, row, await computeReadiness(d, tx, row));
}

/** Provider contract (domain-map): condition for one unit. Internal provider: the calling module authorizes. */
export async function getUnitCondition(d: Deps, tx: TxContext, unitId: string) {
  const row = await loadUnit(tx, unitId);
  const readiness = await computeReadiness(d, tx, row);
  return {
    unitId: row.id,
    condition: row.condition as UnitCondition,
    inspectedAt: iso(row.last_inspected_at),
    discrepancy: row.discrepancy === 'none' ? null : row.discrepancy,
    occupancy: row.occupancy as Occupancy,
    dnd: row.dnd,
    ready: readiness.ready,
    readiness,
    blocked: row.block_kind,
    provenance: row.provenance,
    pendingChange: row.pending_forward_id !== null,
  };
}

/** Provider contract (domain-map): conditions of every active unit at a property (stored readiness). */
export async function listUnitConditions(_d: Deps, tx: TxContext, input: { propertyId: string }) {
  const rows = await db(tx)
    .selectFrom('operations.unit_status')
    .selectAll()
    .where('property_id', '=', input.propertyId)
    .where('active', '=', true)
    .orderBy('unit_number')
    .execute();
  return rows.map((r) => {
    const v = toUnitView(r);
    return {
      unitId: v.unitId,
      unitNumber: v.unitNumber,
      condition: v.condition,
      inspectedAt: v.lastInspectedAt,
      discrepancy: v.discrepancy === 'none' ? null : v.discrepancy,
      occupancy: v.occupancy,
      dnd: v.dnd,
      ready: v.readiness.ready,
      expectedReadyAt: v.readiness.expectedReadyAt,
      blocked: v.block?.kind ?? null,
      provenance: v.provenance,
      pendingChange: v.pendingChange !== null,
    };
  });
}

export async function board(d: Deps, tx: TxContext, propertyId: string, q: BoardQuery): Promise<Board> {
  requirePermission(tx, P.read, { propertyId });
  const facts = await propertyFacts(d, tx, propertyId);
  const date = facts.businessDate;
  const [units, sections, stays, tasks] = await Promise.all([
    db(tx)
      .selectFrom('operations.unit_status')
      .selectAll()
      .where('property_id', '=', propertyId)
      .where('active', '=', true)
      .execute(),
    db(tx)
      .selectFrom('operations.sections')
      .select(['id', 'name', 'sort_order'])
      .where('property_id', '=', propertyId)
      .execute(),
    db(tx)
      .selectFrom('operations.stay_projection')
      .selectAll()
      .where('property_id', '=', propertyId)
      .where((eb) =>
        eb.or([
          eb.and([eb('arrival', '=', date), eb('status', '=', 'expected')]),
          eb.and([eb('departure', '=', date), eb('status', 'in', ['in_house', 'departed'])]),
        ]),
      )
      .execute(),
    db(tx)
      .selectFrom('operations.tasks')
      .select([
        'id',
        'unit_id',
        'kind',
        'status',
        'priority',
        'priority_reasons',
        'assignee_user_id',
        'assignee_name',
      ])
      .where('property_id', '=', propertyId)
      .where('status', 'in', [...OPEN_TASK_STATUSES])
      .where('unit_id', 'is not', null)
      .execute(),
  ]);
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const arrivalByUnit = new Map<string, (typeof stays)[number]>();
  const departureByUnit = new Map<string, (typeof stays)[number]>();
  for (const s of stays) {
    if (!s.unit_id) continue;
    if (s.arrival === date && s.status === 'expected') arrivalByUnit.set(s.unit_id, s);
    if (s.departure === date) departureByUnit.set(s.unit_id, s);
  }
  const tasksByUnit = new Map<string, typeof tasks>();
  for (const t of tasks) {
    if (!t.unit_id) continue;
    const list = tasksByUnit.get(t.unit_id) ?? [];
    list.push(t);
    tasksByUnit.set(t.unit_id, list);
  }
  const counts: Board['counts'] = {
    byCondition: {},
    byOccupancy: {},
    discrepancies: 0,
    dnd: 0,
    arrivalsNotReady: 0,
  };
  const rows: Board['rows'] = [];
  for (const u of units) {
    const view = toUnitView(u, {
      sectionName: u.section_id ? (sectionById.get(u.section_id)?.name ?? null) : null,
    });
    counts.byCondition[u.condition] = (counts.byCondition[u.condition] ?? 0) + 1;
    counts.byOccupancy[u.occupancy] = (counts.byOccupancy[u.occupancy] ?? 0) + 1;
    if (u.discrepancy !== 'none') counts.discrepancies++;
    if (u.dnd) counts.dnd++;
    const arrival = arrivalByUnit.get(u.id);
    if (arrival && !view.readiness.ready) counts.arrivalsNotReady++;
    const open = tasksByUnit.get(u.id) ?? [];
    let top: TaskPriority | null = null;
    const reasons = new Set<string>();
    for (const t of open) {
      if (!top || PRIORITY_RANK[t.priority as TaskPriority] > PRIORITY_RANK[top])
        top = t.priority as TaskPriority;
      for (const r of t.priority_reasons ?? []) reasons.add(r);
    }
    rows.push({
      unit: view,
      arrival: arrival
        ? {
            stayId: arrival.id,
            eta: iso(arrival.eta),
            vip: arrival.vip,
            earlyCheckIn: arrival.early_check_in,
            guestLabel: arrival.guest_label,
          }
        : null,
      departureToday: departureByUnit.get(u.id)
        ? { stayId: departureByUnit.get(u.id)?.id ?? '', status: departureByUnit.get(u.id)?.status ?? '' }
        : null,
      topPriority: top,
      priorityReasons: [...reasons],
      openTasks: open.map((t) => ({
        taskId: t.id,
        kind: t.kind as TaskKind,
        status: t.status as TaskStatus,
        priority: t.priority as TaskPriority,
        assigneeUserId: t.assignee_user_id,
        assigneeName: t.assignee_name,
      })),
    });
  }
  const filtered = rows.filter((r) => {
    const u = r.unit;
    if (q.condition && !q.condition.includes(u.condition)) return false;
    if (q.occupancy && u.occupancy !== q.occupancy) return false;
    if (q.sectionId && u.sectionId !== q.sectionId) return false;
    if (q.floor && u.floor !== q.floor) return false;
    if (q.discrepancy && u.discrepancy === 'none') return false;
    if (q.arrivalsOnly && !r.arrival) return false;
    if (q.priority && r.topPriority !== q.priority) return false;
    if (q.attendantUserId && !r.openTasks.some((t) => t.assigneeUserId === q.attendantUserId)) return false;
    return true;
  });
  filtered.sort((a, b) => {
    const pa = a.topPriority ? PRIORITY_RANK[a.topPriority] : -1;
    const pb = b.topPriority ? PRIORITY_RANK[b.topPriority] : -1;
    if (pa !== pb) return pb - pa;
    const sa = a.unit.sectionId ? (sectionById.get(a.unit.sectionId)?.sort_order ?? 0) : 999;
    const sb = b.unit.sectionId ? (sectionById.get(b.unit.sectionId)?.sort_order ?? 0) : 999;
    if (sa !== sb) return sa - sb;
    return a.unit.unitNumber.localeCompare(b.unit.unitNumber, undefined, { numeric: true });
  });
  return { propertyId, businessDate: date, generatedAt: tx.now.toISOString(), counts, rows: filtered };
}

/** Arrival readiness for the front desk (scenario 7): each arrival's unit, ready or not, why, and an ETA. */
export async function arrivalReadiness(
  d: Deps,
  tx: TxContext,
  propertyId: string,
  date?: LocalDate,
): Promise<ArrivalReadiness> {
  requirePermission(tx, P.read, { propertyId });
  const day = date ?? (await propertyFacts(d, tx, propertyId)).businessDate;
  const stays = await db(tx)
    .selectFrom('operations.stay_projection')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('arrival', '=', day)
    .where('status', '=', 'expected')
    .orderBy('eta')
    .execute();
  const items: ArrivalReadiness['items'] = [];
  for (const s of stays) {
    if (!s.unit_id) {
      items.push({
        stayId: s.id,
        unitId: null,
        unitNumber: null,
        eta: iso(s.eta),
        vip: s.vip,
        guestLabel: s.guest_label,
        readiness: null,
        blocker: 'No unit assigned yet.',
      });
      continue;
    }
    const row = await db(tx)
      .selectFrom('operations.unit_status')
      .selectAll()
      .where('id', '=', s.unit_id)
      .executeTakeFirst();
    if (!row) {
      items.push({
        stayId: s.id,
        unitId: s.unit_id,
        unitNumber: null,
        eta: iso(s.eta),
        vip: s.vip,
        guestLabel: s.guest_label,
        readiness: null,
        blocker: 'The assigned unit is not known to housekeeping (catalog not synchronised).',
      });
      continue;
    }
    const r = await computeReadiness(d, tx, row);
    items.push({
      stayId: s.id,
      unitId: row.id,
      unitNumber: row.unit_number,
      eta: iso(s.eta),
      vip: s.vip,
      guestLabel: s.guest_label,
      readiness: r,
      blocker: r.ready
        ? null
        : (r.reasons.find((x) => x.code !== 'pending_external_confirmation')?.message ?? null),
    });
  }
  return { propertyId, date: day, items };
}

// ───────────────────────────── Stay projection & occupancy ─────────────────────────────

export interface StayProjectionInput {
  stayId: string;
  propertyId: string;
  bookingId?: string | null;
  unitId?: string | null;
  arrival: LocalDate;
  departure: LocalDate;
  status: 'expected' | 'in_house' | 'departed' | 'cancelled' | 'no_show';
  guestProfileId?: string | null;
  guestLabel?: string | null;
  vip?: boolean;
  earlyCheckIn?: boolean;
  eta?: Date | null;
  source?: 'event' | 'external' | 'manual';
}

/** Upsert operations' read model of a stay and recompute physical occupancy of the units involved. */
export async function upsertStayProjection(
  d: Deps,
  tx: TxContext,
  input: StayProjectionInput,
): Promise<{ previousUnitId: string | null; previousStatus: string | null }> {
  const prev = await db(tx)
    .selectFrom('operations.stay_projection')
    .select([
      'unit_id',
      'status',
      'vip',
      'early_check_in',
      'eta',
      'guest_label',
      'guest_profile_id',
      'booking_id',
    ])
    .where('id', '=', input.stayId)
    .forUpdate()
    .executeTakeFirst();
  const values = {
    property_id: input.propertyId,
    booking_id: input.bookingId ?? prev?.booking_id ?? null,
    unit_id: input.unitId === undefined ? (prev?.unit_id ?? null) : input.unitId,
    arrival: input.arrival,
    departure: input.departure,
    status: input.status,
    guest_profile_id: input.guestProfileId ?? prev?.guest_profile_id ?? null,
    guest_label: input.guestLabel ?? prev?.guest_label ?? null,
    vip: input.vip ?? prev?.vip ?? false,
    early_check_in: input.earlyCheckIn ?? prev?.early_check_in ?? false,
    eta: input.eta === undefined ? (prev?.eta ?? null) : input.eta,
    source: input.source ?? 'event',
    updated_at: tx.now,
  };
  await db(tx)
    .insertInto('operations.stay_projection')
    .values({ id: input.stayId, tenant_id: tx.tenantId, ...values })
    .onConflict((oc) => oc.column('id').doUpdateSet(values))
    .execute();
  const units = new Set<string>();
  if (prev?.unit_id) units.add(prev.unit_id);
  if (values.unit_id) units.add(values.unit_id);
  for (const u of units) await recomputeOccupancy(d, tx, u);
  return { previousUnitId: prev?.unit_id ?? null, previousStatus: prev?.status ?? null };
}

/** Physical occupancy = an in-house stay is assigned to the unit. Derived; does not bump the unit version. */
export async function recomputeOccupancy(d: Deps, tx: TxContext, unitId: string): Promise<void> {
  const row = await db(tx)
    .selectFrom('operations.unit_status')
    .selectAll()
    .where('id', '=', unitId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) return; // unit not mirrored into operations (catalog not synchronised) — nothing to update
  const stay = await db(tx)
    .selectFrom('operations.stay_projection')
    .select('id')
    .where('unit_id', '=', unitId)
    .where('status', '=', 'in_house')
    .orderBy('arrival', 'desc')
    .executeTakeFirst();
  const occupancy: Occupancy = stay ? 'occupied' : 'vacant';
  const stayId = stay?.id ?? null;
  if (occupancy === row.occupancy && stayId === row.occupancy_stay_id) return;
  const discrepancy = deriveDiscrepancy(occupancy, row.observed_occupancy as ObservedOccupancy | null);
  await db(tx)
    .updateTable('operations.unit_status')
    .set({
      occupancy,
      occupancy_stay_id: stayId,
      // A new occupancy fact supersedes an older housekeeping observation only when the observation now agrees.
      discrepancy,
      feed_xid: feedMark(),
      updated_at: tx.now,
    })
    .where('id', '=', unitId)
    .execute();
  if (occupancy !== row.occupancy) {
    await logUnit(tx, row, {
      field: 'occupancy',
      from: row.occupancy,
      to: occupancy,
      source: 'event',
      versionAfter: row.version,
      metadata: { stayId },
    });
  }
  await refreshReadiness(d, tx, unitId);
}

// ───────────────────────────── Connected mode ─────────────────────────────

function toForwardView(r: {
  id: string;
  property_id: string;
  domain: string;
  connection_id: string | null;
  target_type: string;
  target_id: string;
  change: unknown;
  status: string;
  requested_at: Date;
  resolved_at: Date | null;
  external_ref: string | null;
  rejection_reason: string | null;
}): StatusForwardView {
  return {
    id: r.id,
    propertyId: r.property_id,
    domain: r.domain as StatusForwardView['domain'],
    connectionId: r.connection_id,
    targetType: r.target_type as StatusForwardView['targetType'],
    targetId: r.target_id,
    change: (r.change ?? {}) as Record<string, unknown>,
    status: r.status as StatusForwardView['status'],
    requestedAt: new Date(r.requested_at).toISOString(),
    resolvedAt: iso(r.resolved_at),
    externalRef: r.external_ref,
    rejectionReason: r.rejection_reason,
  };
}

export async function listForwards(
  _d: Deps,
  tx: TxContext,
  propertyId: string,
  status?: StatusForwardView['status'],
): Promise<StatusForwardView[]> {
  requirePermission(tx, P.read, { propertyId });
  let q = db(tx)
    .selectFrom('operations.status_forwards')
    .selectAll()
    .where('property_id', '=', propertyId)
    .orderBy('requested_at', 'desc')
    .limit(500);
  if (status) q = q.where('status', '=', status);
  return (await q.execute()).map(toForwardView);
}

/**
 * The external system of record acknowledged (or rejected) a forwarded change. Called by the integration
 * module after delivery. Only now does an acknowledged room-status change become effective in Portico.
 */
export async function acknowledgeForward(
  d: Deps,
  tx: TxContext,
  forwardId: string,
  input: { outcome: 'acknowledged' | 'rejected'; externalRef?: string; reason?: string },
): Promise<StatusForwardView> {
  const f = await db(tx)
    .selectFrom('operations.status_forwards')
    .selectAll()
    .where('id', '=', forwardId)
    .forUpdate()
    .executeTakeFirst();
  if (!f) throw new NotFoundError('status_forward', forwardId);
  requirePermission(tx, P.external, { propertyId: f.property_id });
  if (f.status !== 'pending') {
    throw new BusinessRuleError(
      'forward_not_pending',
      `This forwarded change is already ${f.status}. Nothing was changed.`,
      { status: f.status },
    );
  }
  if (input.outcome === 'rejected' && !input.reason?.trim()) {
    throw new ValidationError('reason_required', 'Give the reason the external system rejected the change.');
  }
  const updated = await db(tx)
    .updateTable('operations.status_forwards')
    .set({
      status: input.outcome,
      resolved_at: tx.now,
      external_ref: input.externalRef ?? null,
      rejection_reason: input.outcome === 'rejected' ? (input.reason ?? null) : null,
      version: (eb) => eb('version', '+', 1),
    })
    .where('id', '=', forwardId)
    .returningAll()
    .executeTakeFirstOrThrow();
  if (f.target_type === 'unit') {
    const row = await loadUnit(tx, f.target_id, { forUpdate: true });
    const isCurrent = row.pending_forward_id === f.id;
    let current = row;
    if (isCurrent) {
      current = await db(tx)
        .updateTable('operations.unit_status')
        .set({ pending_forward_id: null, pending_change: null, feed_xid: feedMark(), updated_at: tx.now })
        .where('id', '=', row.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    }
    if (input.outcome === 'acknowledged') {
      const change = (f.change ?? {}) as RoomStatusPatch & { reason?: string };
      const patch: RoomStatusPatch = {};
      if (change.condition) patch.condition = change.condition;
      if (change.dnd !== undefined) patch.dnd = change.dnd;
      if (change.observedOccupancy) patch.observedOccupancy = change.observedOccupancy;
      if (change.turndown) patch.turndown = change.turndown;
      await applyRoomStatus(d, tx, current, patch, {
        reason: change.reason ?? 'Confirmed by the system of record',
        source: 'forward_ack',
        authorityChecked: true,
        provenance: 'external',
        extra: { external_synced_at: tx.now },
      });
    } else {
      await refreshReadiness(d, tx, row.id);
    }
  }
  await tx.audit({
    action: `operations.statusForward.${input.outcome}`,
    target: { type: 'status_forward', id: f.id },
    propertyId: f.property_id,
    reason: input.reason ?? null,
    before: { status: f.status },
    after: { status: input.outcome, externalRef: input.externalRef ?? null },
  });
  await tx.emit({
    type:
      input.outcome === 'acknowledged'
        ? 'operations.statusForward.acknowledged'
        : 'operations.statusForward.rejected',
    propertyId: f.property_id,
    aggregate: { type: f.target_type, id: f.target_id },
    payload: { forwardId: f.id, domain: f.domain, targetId: f.target_id, reason: input.reason ?? null },
  });
  return toForwardView(updated);
}

/**
 * Inbound room status from the external system of record (connected mode mirror). Applied as `external`
 * provenance with the last-sync time. Refused while Portico itself is the system of record — two systems must
 * never silently fight over the same room status.
 */
export async function applyExternalRoomStatus(
  d: Deps,
  tx: TxContext,
  unitId: string,
  input: { condition?: UnitCondition; dnd?: boolean; observedAt: Date; connectionId: string },
): Promise<UnitStatusView> {
  const row = await loadUnit(tx, unitId, { forUpdate: true });
  requirePermission(tx, P.external, { propertyId: row.property_id });
  const authority = await d.ports.platform.getDataAuthority(tx, row.property_id, 'roomStatus');
  if (authority.authority !== 'external' || authority.connectionId !== input.connectionId) {
    throw new BusinessRuleError(
      'not_system_of_record',
      'This connection is not the system of record for room status at this property, so its updates are not applied. Change the data authority first if the external system should own room status.',
      { connectionId: input.connectionId, authority: authority.authority },
    );
  }
  if (row.external_synced_at && new Date(row.external_synced_at) > input.observedAt) {
    // Out-of-order delivery: an older observation never overwrites a newer one.
    return unitView(tx, row);
  }
  const r = await applyRoomStatus(
    d,
    tx,
    row,
    {
      ...(input.condition ? { condition: input.condition } : {}),
      ...(input.dnd !== undefined ? { dnd: input.dnd } : {}),
    },
    {
      reason: `Received from ${authority.systemName ?? 'the system of record'}`,
      source: 'external',
      authorityChecked: true,
      provenance: 'external',
      extra: { external_synced_at: input.observedAt },
    },
  );
  return unitView(tx, r.row);
}
