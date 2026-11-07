import { explainVersionMiss, type Selectable, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  type LocalDate,
  NotFoundError,
  newId,
  newReferenceCode,
  requirePermission,
  ValidationError,
  VersionConflictError,
} from '@portico/kernel';
import type {
  AssetView,
  BlockRequestInput,
  PreventiveScheduleView,
  ResolutionItemView,
  WorkOrderInput,
  WorkOrderView,
} from '../contracts';
import { checkReturnToService } from '../domain/inspection';
import type { IntervalUnit, Urgency } from '../domain/model';
import { dueOccurrences } from '../domain/preventive';
import { priorityForUrgency } from '../domain/tasks';
import type { AssetsTable, PreventiveSchedulesTable, ResolutionItemsTable, WorkOrdersTable } from '../tables';
import { toInspectionView } from './inspections';
import {
  actorKey,
  actorName,
  type Deps,
  db,
  feedMark,
  iso,
  loadSettings,
  logUnit,
  pgUniqueViolation,
  propertyFacts,
  requireAny,
} from './internal';
import { insertTask, loadTask, taskView, transitionTask } from './tasks';
import { loadUnit, refreshReadiness, systemConditionChange } from './units';

const P = {
  report: 'operations.maintenance.report',
  manage: 'operations.maintenance.manage',
  read: 'operations.unit.read',
} as const;

type Part = WorkOrderView['parts'][number];
type Photo = WorkOrderView['photos'][number];

// ───────────────────────────── Assets ─────────────────────────────

function toAsset(r: Selectable<AssetsTable>): AssetView {
  return {
    id: r.id,
    propertyId: r.property_id,
    kind: r.kind as AssetView['kind'],
    code: r.code,
    name: r.name,
    category: r.category,
    unitId: r.unit_id,
    parentAssetId: r.parent_asset_id,
    sectionId: r.section_id,
    locationPath: r.location_path,
    manufacturer: r.manufacturer,
    model: r.model,
    serialNumber: r.serial_number,
    installedOn: r.installed_on,
    status: r.status as AssetView['status'],
    version: r.version,
  };
}

async function sectionIdByCode(tx: TxContext, propertyId: string, code?: string): Promise<string | null> {
  if (!code) return null;
  const s = await db(tx)
    .selectFrom('operations.sections')
    .select('id')
    .where('property_id', '=', propertyId)
    .where('code', '=', code)
    .executeTakeFirst();
  if (!s) throw new ValidationError('unknown_section', `Section "${code}" does not exist at this property.`);
  return s.id;
}

async function assetIdByCode(tx: TxContext, propertyId: string, code?: string): Promise<string | null> {
  if (!code) return null;
  const a = await db(tx)
    .selectFrom('operations.assets')
    .select('id')
    .where('property_id', '=', propertyId)
    .where('code', '=', code)
    .executeTakeFirst();
  if (!a) throw new ValidationError('unknown_asset', `Asset "${code}" does not exist at this property.`);
  return a.id;
}

export async function createAsset(
  _d: Deps,
  tx: TxContext,
  propertyId: string,
  input: {
    kind: AssetView['kind'];
    code: string;
    name: string;
    category: string;
    unitId?: string;
    parentAssetCode?: string;
    sectionCode?: string;
    locationPath?: string;
    manufacturer?: string;
    model?: string;
    serialNumber?: string;
    installedOn?: LocalDate;
  },
): Promise<AssetView> {
  requirePermission(tx, P.manage, { propertyId });
  if (input.kind === 'unit' && !input.unitId)
    throw new ValidationError('unit_required', 'A unit asset must reference the unit it represents.');
  if (input.unitId) {
    const u = await loadUnit(tx, input.unitId);
    if (u.property_id !== propertyId)
      throw new ValidationError('property_mismatch', 'The unit belongs to another property.');
  }
  const id = newId(tx.now.getTime());
  try {
    const row = await db(tx)
      .insertInto('operations.assets')
      .values({
        id,
        tenant_id: tx.tenantId,
        property_id: propertyId,
        kind: input.kind,
        code: input.code,
        name: input.name,
        category: input.category,
        unit_id: input.unitId ?? null,
        parent_asset_id: await assetIdByCode(tx, propertyId, input.parentAssetCode),
        section_id: await sectionIdByCode(tx, propertyId, input.sectionCode),
        location_path: input.locationPath ?? null,
        manufacturer: input.manufacturer ?? null,
        model: input.model ?? null,
        serial_number: input.serialNumber ?? null,
        installed_on: input.installedOn ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx.audit({
      action: 'operations.asset.create',
      target: { type: 'asset', id },
      propertyId,
      after: input,
    });
    return toAsset(row);
  } catch (err) {
    if (pgUniqueViolation(err))
      throw new ValidationError(
        'asset_exists',
        `An asset with code ${input.code} (or a unit asset for this unit) already exists at this property.`,
      );
    throw err;
  }
}

export async function updateAsset(
  _d: Deps,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  patch: {
    name?: string;
    category?: string;
    locationPath?: string;
    manufacturer?: string;
    model?: string;
    serialNumber?: string;
    installedOn?: LocalDate;
    sectionCode?: string;
    status?: 'active' | 'retired';
  },
): Promise<AssetView> {
  const before = await loadAsset(tx, id);
  requirePermission(tx, P.manage, { propertyId: before.property_id });
  const row = await db(tx)
    .updateTable('operations.assets')
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.locationPath !== undefined ? { location_path: patch.locationPath } : {}),
      ...(patch.manufacturer !== undefined ? { manufacturer: patch.manufacturer } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.serialNumber !== undefined ? { serial_number: patch.serialNumber } : {}),
      ...(patch.installedOn !== undefined ? { installed_on: patch.installedOn } : {}),
      ...(patch.sectionCode !== undefined
        ? { section_id: await sectionIdByCode(tx, before.property_id, patch.sectionCode) }
        : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      version: expectedVersion + 1,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row)
    return explainVersionMiss('asset', id, expectedVersion, async () => (await loadAsset(tx, id)).version);
  await tx.audit({
    action: 'operations.asset.update',
    target: { type: 'asset', id },
    propertyId: before.property_id,
    before: toAsset(before),
    after: toAsset(row),
  });
  return toAsset(row);
}

async function loadAsset(tx: TxContext, id: string) {
  const row = await db(tx)
    .selectFrom('operations.assets')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('asset', id);
  return row;
}

export async function getAsset(_d: Deps, tx: TxContext, id: string): Promise<AssetView> {
  const row = await loadAsset(tx, id);
  requireAny(tx, [P.read, P.manage], row.property_id);
  return toAsset(row);
}

export async function listAssets(
  _d: Deps,
  tx: TxContext,
  propertyId: string,
  q: { category?: string; kind?: string } = {},
): Promise<AssetView[]> {
  requireAny(tx, [P.read, P.manage], propertyId);
  let query = db(tx)
    .selectFrom('operations.assets')
    .selectAll()
    .where('property_id', '=', propertyId)
    .orderBy('code');
  if (q.category) query = query.where('category', '=', q.category);
  if (q.kind) query = query.where('kind', '=', q.kind);
  return (await query.execute()).map(toAsset);
}

/** Work history of an asset: its work orders (and, for unit assets, the unit's inspections). */
export async function assetHistory(_d: Deps, tx: TxContext, id: string) {
  const asset = await loadAsset(tx, id);
  requireAny(tx, [P.read, P.manage], asset.property_id);
  const orders = await db(tx)
    .selectFrom('operations.work_orders')
    .selectAll()
    .where((eb) =>
      asset.unit_id && asset.kind === 'unit'
        ? eb.or([eb('asset_id', '=', id), eb('unit_id', '=', asset.unit_id)])
        : eb('asset_id', '=', id),
    )
    .orderBy('created_at', 'desc')
    .limit(200)
    .execute();
  const inspections =
    asset.kind === 'unit' && asset.unit_id
      ? await db(tx)
          .selectFrom('operations.inspections')
          .selectAll()
          .where('unit_id', '=', asset.unit_id)
          .orderBy('inspected_at', 'desc')
          .limit(100)
          .execute()
      : [];
  const workOrders: WorkOrderView[] = [];
  for (const o of orders) workOrders.push(await workOrderView(tx, o));
  return { asset: toAsset(asset), workOrders, inspections: inspections.map(toInspectionView) };
}

// ───────────────────────────── Work orders ─────────────────────────────

async function loadWorkOrder(tx: TxContext, id: string, opts: { forUpdate?: boolean } = {}) {
  let q = db(tx).selectFrom('operations.work_orders').selectAll().where('id', '=', id);
  if (opts.forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw new NotFoundError('work_order', id);
  return row;
}

function toResolutionItem(
  r: Selectable<ResolutionItemsTable>,
  unitNumber: string | null,
): ResolutionItemView {
  return {
    id: r.id,
    propertyId: r.property_id,
    unitId: r.unit_id,
    unitNumber,
    blockId: r.block_id,
    workOrderId: r.work_order_id,
    ref: { type: r.ref_type, id: r.ref_id },
    nights: { from: r.nights_from, to: r.nights_to },
    status: r.status as ResolutionItemView['status'],
    resolutionNote: r.resolution_note,
    resolvedAt: iso(r.resolved_at),
    version: r.version,
  };
}

export async function workOrderView(tx: TxContext, row: Selectable<WorkOrdersTable>): Promise<WorkOrderView> {
  const task = await taskView(tx, await loadTask(tx, row.task_id));
  const items = await db(tx)
    .selectFrom('operations.resolution_items')
    .selectAll()
    .where('work_order_id', '=', row.id)
    .orderBy('nights_from')
    .execute();
  return {
    id: row.id,
    propertyId: row.property_id,
    number: row.number,
    assetId: row.asset_id,
    unitId: row.unit_id,
    locationText: row.location_text,
    faultCategory: row.fault_category,
    urgency: row.urgency as Urgency,
    photos: (row.photos ?? []) as Photo[],
    parts: (row.parts ?? []) as Part[],
    resolutionNote: row.resolution_note,
    completedAt: iso(row.completed_at),
    block: {
      status: row.block_status as WorkOrderView['block']['status'],
      kind: row.block_kind as WorkOrderView['block']['kind'],
      from: row.block_from,
      to: row.block_to,
      reason: row.block_reason,
      blockId: row.block_id,
    },
    returnToService: row.return_to_service_status as WorkOrderView['returnToService'],
    returnedToServiceAt: iso(row.returned_to_service_at),
    preventiveScheduleId: row.preventive_schedule_id,
    preventiveDueOn: row.preventive_due_on,
    authorityState: row.authority_state as WorkOrderView['authorityState'],
    reportedVia: row.reported_via,
    task,
    resolutionItems: items.map((i) => toResolutionItem(i, task.unitNumber)),
    version: row.version,
  };
}

async function recordForward(
  d: Deps,
  tx: TxContext,
  propertyId: string,
  targetId: string,
  change: Record<string, unknown>,
): Promise<string> {
  const authority = await d.ports.platform.getDataAuthority(tx, propertyId, 'maintenance');
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('operations.status_forwards')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: propertyId,
      domain: 'maintenance',
      connection_id: authority.connectionId,
      target_type: 'work_order',
      target_id: targetId,
      change: JSON.stringify(change),
      requested_by: actorKey(tx),
      requested_at: tx.now,
      resolved_at: null,
      external_ref: null,
      rejection_reason: null,
    })
    .execute();
  await tx.emit({
    type: 'operations.statusForward.requested',
    propertyId,
    aggregate: { type: 'work_order', id: targetId },
    payload: {
      forwardId: id,
      domain: 'maintenance',
      connectionId: authority.connectionId,
      workOrderId: targetId,
      change,
    },
  });
  return id;
}

interface NewWorkOrder {
  propertyId: string;
  assetId?: string | null;
  unitId?: string | null;
  locationText?: string | null;
  title: string;
  description?: string | null;
  faultCategory: string;
  urgency: Urgency;
  photos?: Photo[];
  assigneeUserId?: string | null;
  assigneeName?: string | null;
  dueAt?: Date | null;
  reportedVia: 'staff' | 'mobile_sync' | 'preventive' | 'guest' | 'inspection';
  preventive?: { scheduleId: string; dueOn: LocalDate };
  dedupeKey?: string;
}

async function insertWorkOrder(
  d: Deps,
  tx: TxContext,
  input: NewWorkOrder,
): Promise<{ row: Selectable<WorkOrdersTable>; created: boolean }> {
  let unitId = input.unitId ?? null;
  if (input.assetId) {
    const asset = await loadAsset(tx, input.assetId);
    if (asset.property_id !== input.propertyId)
      throw new ValidationError('property_mismatch', 'The asset belongs to another property.');
    unitId = unitId ?? asset.unit_id;
  }
  if (unitId) {
    const u = await loadUnit(tx, unitId);
    if (u.property_id !== input.propertyId)
      throw new ValidationError('property_mismatch', 'The unit belongs to another property.');
  }
  if (!unitId && !input.assetId && !input.locationText) {
    throw new ValidationError(
      'location_required',
      'Say where the fault is: a unit, an asset or a location description.',
    );
  }
  // Data authority for maintenance: forwarded when an external maintenance system / PMS owns work orders.
  const mode = await d.ports.platform.assertWritable(tx, input.propertyId, 'maintenance');
  const settings = await loadSettings(d, tx, input.propertyId);
  const dueAt =
    input.dueAt ?? new Date(tx.now.getTime() + settings.workOrderResolutionMinutes[input.urgency] * 60_000);
  const { row: task, created } = await insertTask(d, tx, {
    propertyId: input.propertyId,
    kind: 'work_order',
    title: input.title,
    description: input.description ?? null,
    departmentKind: 'engineering',
    priority: priorityForUrgency(input.urgency),
    unitId,
    assigneeUserId: input.assigneeUserId ?? null,
    assigneeName: input.assigneeName ?? null,
    dueAt,
    refs: input.assetId ? [{ type: 'asset', id: input.assetId }] : [],
    source: input.preventive ? 'preventive' : 'work_order',
    dedupeKey: input.dedupeKey ?? null,
  });
  if (!created) {
    const existing = await db(tx)
      .selectFrom('operations.work_orders')
      .selectAll()
      .where('task_id', '=', task.id)
      .executeTakeFirst();
    if (existing) return { row: existing, created: false };
  }
  const id = newId(tx.now.getTime());
  const row = await db(tx)
    .insertInto('operations.work_orders')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      number: newReferenceCode('WO'),
      task_id: task.id,
      asset_id: input.assetId ?? null,
      unit_id: unitId,
      location_text: input.locationText ?? null,
      fault_category: input.faultCategory,
      urgency: input.urgency,
      photos: JSON.stringify(input.photos ?? []),
      parts: JSON.stringify([]),
      resolution_note: null,
      completed_at: null,
      block_kind: null,
      block_from: null,
      block_to: null,
      block_reason: null,
      block_id: null,
      returned_to_service_at: null,
      preventive_schedule_id: input.preventive?.scheduleId ?? null,
      preventive_due_on: input.preventive?.dueOn ?? null,
      authority_state: mode === 'forward' ? 'pending_forward' : 'effective',
      reported_by: actorName(tx),
      reported_via: input.reportedVia,
      created_at: tx.now,
      feed_xid: feedMark(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  if (mode === 'forward') {
    await recordForward(d, tx, input.propertyId, id, {
      action: 'create',
      number: row.number,
      title: input.title,
      faultCategory: input.faultCategory,
      urgency: input.urgency,
      unitId,
      assetId: input.assetId ?? null,
    });
  }
  await tx.audit({
    action: 'operations.workOrder.create',
    target: { type: 'work_order', id },
    propertyId: input.propertyId,
    after: {
      number: row.number,
      title: input.title,
      urgency: input.urgency,
      unitId,
      assetId: input.assetId ?? null,
    },
  });
  await tx.emit({
    type: 'operations.workOrder.created',
    propertyId: input.propertyId,
    aggregate: { type: 'workOrder', id },
    payload: {
      workOrderId: id,
      number: row.number,
      taskId: task.id,
      unitId,
      assetId: input.assetId ?? null,
      faultCategory: input.faultCategory,
      urgency: input.urgency,
      preventiveScheduleId: input.preventive?.scheduleId ?? null,
      authorityState: row.authority_state,
    },
  });
  return { row, created: true };
}

export async function createWorkOrder(
  d: Deps,
  tx: TxContext,
  input: WorkOrderInput,
  meta: { source?: 'staff' | 'mobile_sync' } = {},
): Promise<WorkOrderView> {
  if (input.block) requirePermission(tx, P.manage, { propertyId: input.propertyId });
  else requireAny(tx, [P.report, P.manage], input.propertyId);
  const { row } = await insertWorkOrder(d, tx, {
    propertyId: input.propertyId,
    assetId: input.assetId ?? null,
    unitId: input.unitId ?? null,
    locationText: input.locationText ?? null,
    title: input.title,
    description: input.description ?? null,
    faultCategory: input.faultCategory,
    urgency: (input.urgency ?? 'normal') as Urgency,
    photos: (input.photos ?? []) as Photo[],
    assigneeUserId: input.assigneeUserId ?? null,
    assigneeName: input.assigneeName ?? null,
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    reportedVia: meta.source ?? 'staff',
  });
  if (input.block) return requestUnitBlock(d, tx, row.id, input.block);
  return workOrderView(tx, row);
}

export async function getWorkOrder(_d: Deps, tx: TxContext, id: string): Promise<WorkOrderView> {
  const row = await loadWorkOrder(tx, id);
  requireAny(tx, [P.read, P.report, P.manage], row.property_id);
  return workOrderView(tx, row);
}

export async function listWorkOrders(
  _d: Deps,
  tx: TxContext,
  q: { propertyId: string; open?: boolean; assetId?: string; unitId?: string; limit: number },
): Promise<WorkOrderView[]> {
  requireAny(tx, [P.read, P.report, P.manage], q.propertyId);
  let query = db(tx)
    .selectFrom('operations.work_orders as w')
    .innerJoin('operations.tasks as t', 't.id', 'w.task_id')
    .selectAll('w')
    .where('w.property_id', '=', q.propertyId)
    .orderBy('w.created_at', 'desc')
    .limit(q.limit);
  if (q.open) query = query.where('t.status', 'in', ['open', 'in_progress', 'blocked']);
  if (q.assetId) query = query.where('w.asset_id', '=', q.assetId);
  if (q.unitId) query = query.where('w.unit_id', '=', q.unitId);
  const rows = await query.execute();
  const out: WorkOrderView[] = [];
  for (const r of rows) out.push(await workOrderView(tx, r));
  return out;
}

function assertWoVersion(row: Selectable<WorkOrdersTable>, expected: number | undefined) {
  if (expected !== undefined && row.version !== expected)
    throw new VersionConflictError('work_order', row.id, expected, row.version);
}

/**
 * Take the work order's unit out of order / out of service through inventory. Inventory never refuses a broken
 * unit because nights are sold; it returns the stays assigned to the unit, which become front-office
 * "resolution required" items (scenario 8).
 */
export async function requestUnitBlock(
  d: Deps,
  tx: TxContext,
  workOrderId: string,
  input: BlockRequestInput,
  meta: { expectedVersion?: number } = {},
): Promise<WorkOrderView> {
  const wo = await loadWorkOrder(tx, workOrderId, { forUpdate: true });
  requirePermission(tx, P.manage, { propertyId: wo.property_id });
  assertWoVersion(wo, meta.expectedVersion);
  if (!wo.unit_id)
    throw new ValidationError(
      'unit_required',
      'Only a work order on a unit can take that unit out of inventory.',
    );
  if (wo.block_status === 'active' || wo.block_status === 'pending_forward') {
    throw new BusinessRuleError(
      'block_already_requested',
      `Unit is already ${wo.block_status === 'active' ? 'blocked' : 'awaiting a block confirmation'} for this work order (${wo.block_from} → ${wo.block_to}).`,
    );
  }
  if (input.to <= input.from)
    throw new ValidationError(
      'invalid_date_range',
      `The block must end after it starts (${input.from} → ${input.to}).`,
    );
  const mode = await d.ports.platform.assertWritable(tx, wo.property_id, 'maintenance');
  if (mode === 'forward') {
    await recordForward(d, tx, wo.property_id, wo.id, {
      action: 'block',
      unitId: wo.unit_id,
      kind: input.kind,
      from: input.from,
      to: input.to,
      reason: input.reason,
    });
    const row = await db(tx)
      .updateTable('operations.work_orders')
      .set({
        block_kind: input.kind,
        block_from: input.from,
        block_to: input.to,
        block_reason: input.reason,
        block_status: 'pending_forward',
        feed_xid: feedMark(),
        version: wo.version + 1,
      })
      .where('id', '=', wo.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx.audit({
      action: 'operations.workOrder.blockForwarded',
      target: { type: 'work_order', id: wo.id },
      propertyId: wo.property_id,
      reason: input.reason,
      after: input,
    });
    return workOrderView(tx, row);
  }
  const res = await d.ports.inventory.blockUnit(tx, {
    unitId: wo.unit_id,
    nights: { from: input.from, to: input.to },
    kind: input.kind,
    reason: input.reason,
    sourceRef: { type: 'workOrder', id: wo.id },
  });
  const row = await db(tx)
    .updateTable('operations.work_orders')
    .set({
      block_kind: input.kind,
      block_from: input.from,
      block_to: input.to,
      block_reason: input.reason,
      block_id: res.blockId,
      block_status: 'active',
      return_to_service_status: wo.completed_at ? 'awaiting_inspection' : 'awaiting_completion',
      feed_xid: feedMark(),
      version: wo.version + 1,
    })
    .where('id', '=', wo.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await mirrorUnitBlock(d, tx, {
    unitId: wo.unit_id,
    blockId: res.blockId,
    kind: input.kind,
    from: input.from,
    to: input.to,
    reason: input.reason,
    workOrderId: wo.id,
  });
  const items = await recordResolutionItems(d, tx, {
    propertyId: wo.property_id,
    unitId: wo.unit_id,
    blockId: res.blockId,
    workOrderId: wo.id,
    affected: res.affectedAssignments,
  });
  await tx.audit({
    action: 'operations.workOrder.block',
    target: { type: 'work_order', id: wo.id },
    propertyId: wo.property_id,
    reason: input.reason,
    after: { ...input, blockId: res.blockId, affected: res.affectedAssignments.length },
  });
  await tx.emit({
    type: 'operations.workOrder.unitBlocked',
    propertyId: wo.property_id,
    aggregate: { type: 'workOrder', id: wo.id },
    payload: {
      workOrderId: wo.id,
      unitId: wo.unit_id,
      blockId: res.blockId,
      kind: input.kind,
      nights: { from: input.from, to: input.to },
      affectedAssignments: res.affectedAssignments,
      resolutionItemIds: items.map((i) => i.id),
    },
  });
  return workOrderView(tx, row);
}

/** Mirror an inventory block onto the unit (idempotent on block id). */
export async function mirrorUnitBlock(
  d: Deps,
  tx: TxContext,
  b: {
    unitId: string;
    blockId: string;
    kind: 'out_of_order' | 'out_of_service' | 'house_use';
    from: LocalDate;
    to: LocalDate;
    reason: string | null;
    workOrderId: string | null;
  },
): Promise<void> {
  const unit = await db(tx)
    .selectFrom('operations.unit_status')
    .selectAll()
    .where('id', '=', b.unitId)
    .forUpdate()
    .executeTakeFirst();
  if (!unit) return;
  if (unit.block_id === b.blockId) return;
  const updated = await db(tx)
    .updateTable('operations.unit_status')
    .set({
      block_kind: b.kind,
      block_id: b.blockId,
      block_from: b.from,
      block_to: b.to,
      block_reason: b.reason,
      block_work_order_id: b.workOrderId ?? unit.block_work_order_id,
      version: unit.version + 1,
      feed_xid: feedMark(),
      updated_at: tx.now,
    })
    .where('id', '=', unit.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await logUnit(tx, unit, {
    field: 'block',
    from: unit.block_kind,
    to: `${b.kind} ${b.from}→${b.to}`,
    reason: b.reason,
    source: b.workOrderId ? 'staff' : 'event',
    versionAfter: updated.version,
    metadata: { blockId: b.blockId, workOrderId: b.workOrderId },
  });
  await refreshReadiness(d, tx, unit.id);
}

export async function clearUnitBlock(
  d: Deps,
  tx: TxContext,
  unitId: string,
  blockId: string,
  reason: string,
) {
  const unit = await db(tx)
    .selectFrom('operations.unit_status')
    .selectAll()
    .where('id', '=', unitId)
    .forUpdate()
    .executeTakeFirst();
  if (!unit || unit.block_id !== blockId) return;
  const updated = await db(tx)
    .updateTable('operations.unit_status')
    .set({
      block_kind: null,
      block_id: null,
      block_from: null,
      block_to: null,
      block_reason: null,
      block_work_order_id: null,
      version: unit.version + 1,
      feed_xid: feedMark(),
      updated_at: tx.now,
    })
    .where('id', '=', unit.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await logUnit(tx, unit, {
    field: 'block',
    from: unit.block_kind,
    to: null,
    reason,
    source: 'staff',
    versionAfter: updated.version,
    metadata: { blockId },
  });
  await refreshReadiness(d, tx, unit.id);
}

export async function recordResolutionItems(
  _d: Deps,
  tx: TxContext,
  input: {
    propertyId: string;
    unitId: string;
    blockId: string;
    workOrderId: string | null;
    affected: Array<{ ref: { type: string; id: string }; nights: { from: LocalDate; to: LocalDate } }>;
  },
): Promise<Array<Selectable<ResolutionItemsTable>>> {
  const out: Array<Selectable<ResolutionItemsTable>> = [];
  for (const a of input.affected) {
    const row = await db(tx)
      .insertInto('operations.resolution_items')
      .values({
        id: newId(tx.now.getTime()),
        tenant_id: tx.tenantId,
        property_id: input.propertyId,
        unit_id: input.unitId,
        block_id: input.blockId,
        work_order_id: input.workOrderId,
        ref_type: a.ref.type,
        ref_id: a.ref.id,
        nights_from: a.nights.from,
        nights_to: a.nights.to,
        resolution_note: null,
        resolved_by: null,
        resolved_at: null,
        created_at: tx.now,
      })
      .onConflict((oc) => oc.columns(['tenant_id', 'block_id', 'ref_type', 'ref_id']).doNothing())
      .returningAll()
      .executeTakeFirst();
    if (row) out.push(row);
  }
  if (out.length) {
    await tx.emit({
      type: 'operations.resolution.required',
      propertyId: input.propertyId,
      aggregate: { type: 'unit', id: input.unitId },
      payload: {
        unitId: input.unitId,
        blockId: input.blockId,
        workOrderId: input.workOrderId,
        items: out.map((r) => ({
          resolutionItemId: r.id,
          ref: { type: r.ref_type, id: r.ref_id },
          nights: { from: r.nights_from, to: r.nights_to },
        })),
      },
    });
  }
  return out;
}

export async function listResolutionItems(
  _d: Deps,
  tx: TxContext,
  propertyId: string,
  status: 'open' | 'resolved' | 'dismissed' | undefined,
): Promise<ResolutionItemView[]> {
  requirePermission(tx, P.read, { propertyId });
  let q = db(tx)
    .selectFrom('operations.resolution_items as r')
    .leftJoin('operations.unit_status as u', 'u.id', 'r.unit_id')
    .selectAll('r')
    .select('u.unit_number')
    .where('r.property_id', '=', propertyId)
    .orderBy('r.nights_from')
    .limit(500);
  if (status) q = q.where('r.status', '=', status);
  return (await q.execute()).map((r) => toResolutionItem(r, r.unit_number ?? null));
}

/** Front office records how an affected stay was resolved (moved, relocated, upgraded, dates changed…). */
export async function resolveResolutionItem(
  _d: Deps,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  input: { status: 'resolved' | 'dismissed'; note: string },
): Promise<ResolutionItemView> {
  const item = await db(tx)
    .selectFrom('operations.resolution_items')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!item) throw new NotFoundError('resolution_item', id);
  requireAny(tx, ['operations.task.manage', P.manage], item.property_id);
  if (item.status !== 'open')
    throw new BusinessRuleError('resolution_item_closed', `This item is already ${item.status}.`, {
      status: item.status,
    });
  const row = await db(tx)
    .updateTable('operations.resolution_items')
    .set({
      status: input.status,
      resolution_note: input.note,
      resolved_by: actorName(tx),
      resolved_at: tx.now,
      version: expectedVersion + 1,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) throw new VersionConflictError('resolution_item', id, expectedVersion, item.version);
  await tx.audit({
    action: `operations.resolutionItem.${input.status}`,
    target: { type: 'resolution_item', id },
    propertyId: item.property_id,
    reason: input.note,
    before: { status: item.status },
    after: { status: input.status },
  });
  return toResolutionItem(row, null);
}

export async function addWorkOrderParts(
  _d: Deps,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  parts: Part[],
): Promise<WorkOrderView> {
  const wo = await loadWorkOrder(tx, id, { forUpdate: true });
  requirePermission(tx, P.manage, { propertyId: wo.property_id });
  assertWoVersion(wo, expectedVersion);
  const row = await db(tx)
    .updateTable('operations.work_orders')
    .set({
      parts: JSON.stringify([...((wo.parts ?? []) as Part[]), ...parts]),
      version: wo.version + 1,
      feed_xid: feedMark(),
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'operations.workOrder.parts',
    target: { type: 'work_order', id },
    propertyId: wo.property_id,
    after: parts,
  });
  return workOrderView(tx, row);
}

export async function addWorkOrderPhotos(
  _d: Deps,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  photos: Photo[],
): Promise<WorkOrderView> {
  const wo = await loadWorkOrder(tx, id, { forUpdate: true });
  requireAny(tx, [P.report, P.manage], wo.property_id);
  assertWoVersion(wo, expectedVersion);
  const row = await db(tx)
    .updateTable('operations.work_orders')
    .set({
      photos: JSON.stringify([...((wo.photos ?? []) as Photo[]), ...photos]),
      version: wo.version + 1,
      feed_xid: feedMark(),
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'operations.workOrder.photos',
    target: { type: 'work_order', id },
    propertyId: wo.property_id,
    after: photos,
  });
  return workOrderView(tx, row);
}

/**
 * Record the repair. When the unit is blocked, it does NOT return to sale here: it is set dirty for cleaning
 * (policy) and must pass an inspection; return to service is a separate, checked step.
 */
export async function completeWorkOrder(
  d: Deps,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  input: { resolutionNote: string; parts?: Part[] },
): Promise<WorkOrderView> {
  const wo = await loadWorkOrder(tx, id, { forUpdate: true });
  requirePermission(tx, P.manage, { propertyId: wo.property_id });
  assertWoVersion(wo, expectedVersion);
  if (wo.completed_at)
    throw new BusinessRuleError('work_order_completed', `Work order ${wo.number} is already completed.`);
  const task = await loadTask(tx, wo.task_id);
  if (task.status === 'cancelled')
    throw new BusinessRuleError('work_order_cancelled', 'This work order was cancelled.');
  if (task.status !== 'done' && task.status !== 'verified') {
    await transitionTask(
      d,
      tx,
      task.id,
      { to: 'done', reason: 'Work order completed' },
      { internal: true, source: 'work_order' },
    );
  }
  const settings = await loadSettings(d, tx, wo.property_id);
  const blocked = wo.block_status === 'active' || wo.block_status === 'pending_forward';
  const rts = blocked
    ? settings.returnToService.requireInspection
      ? 'awaiting_inspection'
      : 'ready'
    : 'not_applicable';
  const row = await db(tx)
    .updateTable('operations.work_orders')
    .set({
      resolution_note: input.resolutionNote,
      parts: JSON.stringify([...((wo.parts ?? []) as Part[]), ...(input.parts ?? [])]),
      completed_at: tx.now,
      return_to_service_status: rts,
      version: wo.version + 1,
      feed_xid: feedMark(),
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  if (blocked && wo.unit_id) {
    const unit = await loadUnit(tx, wo.unit_id, { forUpdate: true });
    const facts = await propertyFacts(d, tx, wo.property_id);
    const rs = settings.returnToService;
    if (rs.requireCleaning) {
      await systemConditionChange(
        d,
        tx,
        unit,
        'dirty',
        `Maintenance completed (${wo.number}) — clean before return to service`,
      );
      await insertTask(d, tx, {
        propertyId: wo.property_id,
        kind: 'vacant_clean',
        title: `Clean after maintenance · ${unit.unit_number}`,
        unitId: unit.id,
        serviceDate: facts.businessDate,
        refs: [{ type: 'workOrder', id: wo.id }],
        source: 'work_order',
        dedupeKey: `vacant_clean:wo:${wo.id}`,
      });
    }
    if (rs.requireInspection && !(rs.requireCleaning && settings.inspectionAfterCleaning)) {
      await insertTask(d, tx, {
        propertyId: wo.property_id,
        kind: 'inspection',
        title: `Return-to-service inspection · ${unit.unit_number}`,
        unitId: unit.id,
        serviceDate: facts.businessDate,
        refs: [{ type: 'workOrder', id: wo.id }],
        source: 'work_order',
        dedupeKey: `inspection:wo:${wo.id}`,
      });
    }
  }
  await tx.audit({
    action: 'operations.workOrder.complete',
    target: { type: 'work_order', id },
    propertyId: wo.property_id,
    after: { resolutionNote: input.resolutionNote, returnToService: rts },
  });
  await tx.emit({
    type: 'operations.workOrder.completed',
    propertyId: wo.property_id,
    aggregate: { type: 'workOrder', id },
    payload: {
      workOrderId: id,
      number: wo.number,
      unitId: wo.unit_id,
      assetId: wo.asset_id,
      returnToService: rts,
      blockId: wo.block_id,
    },
  });
  return workOrderView(tx, row);
}

/**
 * Return the unit to sale: requires the work order completed AND a passed inspection after the repair
 * (configurable policy). Releases the inventory block only when every condition holds.
 */
export async function returnToService(
  d: Deps,
  tx: TxContext,
  id: string,
  expectedVersion: number,
): Promise<WorkOrderView> {
  const wo = await loadWorkOrder(tx, id, { forUpdate: true });
  requirePermission(tx, P.manage, { propertyId: wo.property_id });
  assertWoVersion(wo, expectedVersion);
  const settings = await loadSettings(d, tx, wo.property_id);
  const lastPass = wo.unit_id
    ? await db(tx)
        .selectFrom('operations.inspections')
        .select('inspected_at')
        .where('unit_id', '=', wo.unit_id)
        .where('result', '=', 'passed')
        .orderBy('inspected_at', 'desc')
        .executeTakeFirst()
    : undefined;
  const check = checkReturnToService({
    policy: settings.returnToService,
    workOrderCompletedAt: wo.completed_at ? new Date(wo.completed_at) : null,
    lastPassedInspectionAt: lastPass ? new Date(lastPass.inspected_at) : null,
    blockActive: wo.block_status === 'active',
  });
  if (!check.allowed) {
    throw new BusinessRuleError(
      'return_to_service_blocked',
      `Unit cannot return to service yet: ${check.missing.map((m) => m.message).join(' ')}`,
      { missing: check.missing },
    );
  }
  const mode = await d.ports.platform.assertWritable(tx, wo.property_id, 'maintenance');
  if (mode === 'forward') {
    await recordForward(d, tx, wo.property_id, wo.id, {
      action: 'release',
      blockId: wo.block_id,
      unitId: wo.unit_id,
    });
  } else if (wo.block_id) {
    await d.ports.inventory.releaseBlock(tx, { blockId: wo.block_id });
  }
  const row = await db(tx)
    .updateTable('operations.work_orders')
    .set({
      block_status: mode === 'forward' ? 'pending_forward' : 'released',
      return_to_service_status: mode === 'forward' ? 'ready' : 'returned',
      returned_to_service_at: mode === 'forward' ? null : tx.now,
      version: wo.version + 1,
      feed_xid: feedMark(),
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  if (mode !== 'forward' && wo.unit_id && wo.block_id) {
    await clearUnitBlock(d, tx, wo.unit_id, wo.block_id, `Returned to service (${wo.number})`);
  }
  await tx.audit({
    action: 'operations.workOrder.returnToService',
    target: { type: 'work_order', id },
    propertyId: wo.property_id,
    before: { blockStatus: wo.block_status },
    after: { blockStatus: row.block_status, forwarded: mode === 'forward' },
  });
  await tx.emit({
    type: 'operations.workOrder.returnedToService',
    propertyId: wo.property_id,
    aggregate: { type: 'workOrder', id },
    payload: {
      workOrderId: id,
      unitId: wo.unit_id,
      blockId: wo.block_id,
      pendingExternalConfirmation: mode === 'forward',
    },
  });
  return workOrderView(tx, row);
}

// ───────────────────────────── Preventive maintenance ─────────────────────────────

function toSchedule(r: Selectable<PreventiveSchedulesTable>): PreventiveScheduleView {
  return {
    id: r.id,
    propertyId: r.property_id,
    code: r.code,
    title: r.title,
    assetId: r.asset_id,
    assetCategory: r.asset_category,
    faultCategory: r.fault_category,
    urgency: r.urgency as Urgency,
    intervalUnit: r.interval_unit as IntervalUnit,
    intervalCount: r.interval_count,
    nextDueOn: r.next_due_on,
    leadDays: r.lead_days,
    active: r.active,
    lastRunAt: iso(r.last_run_at),
    version: r.version,
  };
}

export async function createPreventiveSchedule(
  _d: Deps,
  tx: TxContext,
  propertyId: string,
  input: {
    code: string;
    title: string;
    description?: string;
    assetId?: string;
    assetCategory?: string;
    faultCategory: string;
    urgency: Urgency;
    intervalUnit: IntervalUnit;
    intervalCount: number;
    firstDueOn: LocalDate;
    leadDays: number;
    checklistCode?: string;
  },
): Promise<PreventiveScheduleView> {
  requirePermission(tx, P.manage, { propertyId });
  if (!!input.assetId === !!input.assetCategory) {
    throw new ValidationError(
      'schedule_target_required',
      'A preventive schedule targets either one asset or every asset of a category — give exactly one.',
    );
  }
  if (input.assetId) {
    const a = await loadAsset(tx, input.assetId);
    if (a.property_id !== propertyId)
      throw new ValidationError('property_mismatch', 'The asset belongs to another property.');
  }
  const id = newId(tx.now.getTime());
  try {
    const row = await db(tx)
      .insertInto('operations.preventive_schedules')
      .values({
        id,
        tenant_id: tx.tenantId,
        property_id: propertyId,
        code: input.code,
        title: input.title,
        description: input.description ?? null,
        asset_id: input.assetId ?? null,
        asset_category: input.assetCategory ?? null,
        fault_category: input.faultCategory,
        urgency: input.urgency,
        interval_unit: input.intervalUnit,
        interval_count: input.intervalCount,
        next_due_on: input.firstDueOn,
        lead_days: input.leadDays,
        checklist_code: input.checklistCode ?? null,
        last_run_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx.audit({
      action: 'operations.preventive.create',
      target: { type: 'preventive_schedule', id },
      propertyId,
      after: input,
    });
    return toSchedule(row);
  } catch (err) {
    if (pgUniqueViolation(err))
      throw new ValidationError(
        'schedule_code_taken',
        `A preventive schedule with code ${input.code} already exists.`,
      );
    throw err;
  }
}

export async function listPreventiveSchedules(
  _d: Deps,
  tx: TxContext,
  propertyId: string,
): Promise<PreventiveScheduleView[]> {
  requireAny(tx, [P.read, P.manage], propertyId);
  const rows = await db(tx)
    .selectFrom('operations.preventive_schedules')
    .selectAll()
    .where('property_id', '=', propertyId)
    .orderBy('next_due_on')
    .execute();
  return rows.map(toSchedule);
}

/**
 * Generate preventive work orders that are due (lead days ahead) — one per occurrence per target asset.
 * Idempotent per (schedule, asset, due date): a re-run never duplicates work orders.
 */
export async function runPreventiveSchedules(d: Deps, tx: TxContext, propertyId: string, asOf?: LocalDate) {
  requirePermission(tx, P.manage, { propertyId });
  const day = asOf ?? (await propertyFacts(d, tx, propertyId)).businessDate;
  const schedules = await db(tx)
    .selectFrom('operations.preventive_schedules')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('active', '=', true)
    .forUpdate()
    .execute();
  const created: Array<{ workOrderId: string; number: string; scheduleCode: string; dueOn: LocalDate }> = [];
  let already = 0;
  let skipped = 0;
  for (const s of schedules) {
    const due = dueOccurrences({
      nextDueOn: s.next_due_on,
      unit: s.interval_unit as IntervalUnit,
      count: s.interval_count,
      asOf: day,
      leadDays: s.lead_days,
    });
    if (!due.occurrences.length) continue;
    skipped += due.skipped;
    const assets = s.asset_id
      ? [await loadAsset(tx, s.asset_id)]
      : await db(tx)
          .selectFrom('operations.assets')
          .selectAll()
          .where('property_id', '=', propertyId)
          .where('category', '=', s.asset_category ?? '')
          .where('status', '=', 'active')
          .orderBy('code')
          .execute();
    for (const dueOn of due.occurrences) {
      for (const a of assets) {
        const r = await insertWorkOrder(d, tx, {
          propertyId,
          assetId: a.id,
          title: `${s.title} · ${a.name}`,
          description: s.description,
          faultCategory: s.fault_category,
          urgency: s.urgency as Urgency,
          dueAt: new Date(`${dueOn}T23:59:00Z`),
          reportedVia: 'preventive',
          preventive: { scheduleId: s.id, dueOn },
          dedupeKey: `preventive:${s.id}:${a.id}:${dueOn}`,
        });
        if (r.created)
          created.push({ workOrderId: r.row.id, number: r.row.number, scheduleCode: s.code, dueOn });
        else already++;
      }
    }
    await db(tx)
      .updateTable('operations.preventive_schedules')
      .set({ next_due_on: due.nextDueOn, last_run_at: tx.now, version: s.version + 1 })
      .where('id', '=', s.id)
      .execute();
  }
  await tx.audit({
    action: 'operations.preventive.run',
    target: { type: 'property', id: propertyId },
    propertyId,
    after: { asOf: day, created: created.length, alreadyGenerated: already, skipped },
  });
  return { asOf: day, created, alreadyGenerated: already, skippedOccurrences: skipped };
}
