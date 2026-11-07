import type { Selectable, TxContext } from '@portico/db';
import {
  BusinessRuleError,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
  VersionConflictError,
} from '@portico/kernel';
import type { checklistTemplate, InspectionInput, InspectionResult, Readiness } from '../contracts';
import { type ChecklistItemDefinition, evaluateInspection } from '../domain/inspection';
import { CLEANING_KINDS } from '../domain/model';
import type { InspectionsTable } from '../tables';
import {
  actorKey,
  actorName,
  type Deps,
  db,
  feedMark,
  iso,
  loadSettings,
  pgUniqueViolation,
  requireAny,
  type TaskRow,
  UNIT_READ_PERMISSIONS,
} from './internal';
import { arrivalContext, housekeepingPriorityFor, insertTask, taskView, transitionTask } from './tasks';
import { loadUnit, unitView, writeRoomStatus } from './units';

type ChecklistTemplateView = typeof checklistTemplate._output;

export async function createChecklistTemplate(
  _d: Deps,
  tx: TxContext,
  propertyId: string,
  input: {
    code: string;
    name: string;
    purpose: 'unit' | 'public_area' | 'return_to_service' | 'asset';
    items: ChecklistItemDefinition[];
  },
): Promise<ChecklistTemplateView> {
  requirePermission(tx, 'operations.housekeeping.inspect', { propertyId });
  const codes = new Set<string>();
  for (const i of input.items) {
    if (codes.has(i.code))
      throw new ValidationError('duplicate_checklist_item', `Item code ${i.code} is used twice.`);
    codes.add(i.code);
  }
  const id = newId(tx.now.getTime());
  try {
    const row = await db(tx)
      .insertInto('operations.checklist_templates')
      .values({
        id,
        tenant_id: tx.tenantId,
        property_id: propertyId,
        code: input.code,
        name: input.name,
        purpose: input.purpose,
        items: JSON.stringify(input.items),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx.audit({
      action: 'operations.checklist.create',
      target: { type: 'checklist', id },
      propertyId,
      after: input,
    });
    return toTemplate(row);
  } catch (err) {
    if (pgUniqueViolation(err))
      throw new ValidationError(
        'checklist_code_taken',
        `A checklist with code ${input.code} already exists.`,
      );
    throw err;
  }
}

function toTemplate(row: {
  id: string;
  property_id: string;
  code: string;
  name: string;
  purpose: string;
  items: unknown;
  active: boolean;
  version: number;
}): ChecklistTemplateView {
  return {
    id: row.id,
    propertyId: row.property_id,
    code: row.code,
    name: row.name,
    purpose: row.purpose,
    items: row.items as ChecklistTemplateView['items'],
    active: row.active,
    version: row.version,
  };
}

export async function listChecklistTemplates(
  _d: Deps,
  tx: TxContext,
  propertyId: string,
): Promise<ChecklistTemplateView[]> {
  requireAny(tx, UNIT_READ_PERMISSIONS, propertyId);
  const rows = await db(tx)
    .selectFrom('operations.checklist_templates')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('active', '=', true)
    .orderBy('code')
    .execute();
  return rows.map(toTemplate);
}

export function toInspectionView(row: Selectable<InspectionsTable>) {
  const inspector = row.inspector as { displayName?: string; userId?: string; process?: string };
  return {
    id: row.id,
    propertyId: row.property_id,
    unitId: row.unit_id,
    result: row.result as 'passed' | 'failed',
    reasons: (row.failure_reasons as Array<{ label: string; note: string | null }>).map((f) =>
      f.note ? `${f.label}: ${f.note}` : f.label,
    ),
    items: row.items as Array<Record<string, unknown>>,
    checklistCode: row.checklist_code,
    inspector: inspector.displayName ?? inspector.userId ?? inspector.process ?? row.inspector_key,
    inspectedAt: new Date(row.inspected_at).toISOString(),
    recleanTaskId: row.reclean_task_id,
    affectedStayId: row.affected_stay_id,
    workOrderId: row.work_order_id,
  };
}

export interface InspectionMeta {
  expectedUnitVersion?: number;
  source?: 'staff' | 'mobile_sync';
  clientInspectedAt?: Date | null;
}

/**
 * Record an inspection (pass/fail with checklist reasons). A failure sets the unit to failed_inspection,
 * re-tasks the attendant who cleaned it with an urgent re-clean, and emits `operations.inspection.failed` naming
 * the affected arriving stay with the expected-ready estimate, so the front desk learns before the guest
 * reaches reception (scenario 7).
 */
export async function recordInspection(
  d: Deps,
  tx: TxContext,
  unitId: string,
  input: InspectionInput,
  meta: InspectionMeta = {},
): Promise<InspectionResult> {
  const unit = await loadUnit(tx, unitId, { forUpdate: true });
  requirePermission(tx, 'operations.housekeeping.inspect', { propertyId: unit.property_id });
  if (meta.expectedUnitVersion !== undefined && unit.version !== meta.expectedUnitVersion) {
    throw new VersionConflictError('unit', unit.id, meta.expectedUnitVersion, unit.version);
  }
  if (unit.occupancy === 'occupied') {
    throw new BusinessRuleError(
      'unit_occupied',
      `Unit ${unit.unit_number} is occupied by an in-house guest. Inspect it after the guest departs.`,
    );
  }
  const settings = await loadSettings(d, tx, unit.property_id);
  let template: { items: ChecklistItemDefinition[]; code: string; version: number } | null = null;
  if (input.checklistCode) {
    const t = await db(tx)
      .selectFrom('operations.checklist_templates')
      .select(['items', 'code', 'version'])
      .where('property_id', '=', unit.property_id)
      .where('code', '=', input.checklistCode)
      .where('active', '=', true)
      .executeTakeFirst();
    if (!t) throw new NotFoundError('checklist', input.checklistCode);
    template = { items: t.items as ChecklistItemDefinition[], code: t.code, version: t.version };
  }
  const evaluation = evaluateInspection({
    template: template?.items ?? null,
    items: (input.items ?? []).map((i) => ({
      code: i.code,
      result: i.result,
      note: i.note ?? null,
      photoRefs: i.photoRefs ?? [],
    })),
    adHocFailureReasons: input.failureReasons ?? [],
    maxMinorFailures: settings.inspection.maxMinorFailures,
  });
  const inspectionId = newId(tx.now.getTime());
  const passed = evaluation.result === 'passed';

  // The cleaning this inspection judges: the most recent finished cleaning of the unit.
  const lastCleaning = await db(tx)
    .selectFrom('operations.tasks')
    .selectAll()
    .where('unit_id', '=', unit.id)
    .where('kind', 'in', [...CLEANING_KINDS])
    .where('status', '=', 'done')
    .orderBy('done_at', 'desc')
    .executeTakeFirst();
  const arrival = await arrivalContext(d, tx, unit.property_id, unit.id);

  // 1. Unit condition (authority-aware: forwarded when an external PMS owns room status).
  const write = await writeRoomStatus(
    d,
    tx,
    unit,
    { condition: passed ? 'inspected' : 'failed_inspection' },
    {
      reason: passed ? 'Inspection passed' : `Inspection failed: ${evaluation.reasons.join('; ')}`,
      source: 'inspection',
      clientOccurredAt: meta.clientInspectedAt ?? null,
      extra: {
        last_inspected_at: tx.now,
        last_inspection_id: inspectionId,
        last_inspection_result: evaluation.result,
      },
    },
  );

  // 2. Close the inspection task this result belongs to.
  const inspectionTask = input.taskId
    ? await db(tx)
        .selectFrom('operations.tasks')
        .selectAll()
        .where('id', '=', input.taskId)
        .executeTakeFirst()
    : await db(tx)
        .selectFrom('operations.tasks')
        .selectAll()
        .where('unit_id', '=', unit.id)
        .where('kind', '=', 'inspection')
        .where('status', 'in', ['open', 'in_progress', 'blocked'])
        .orderBy('created_at')
        .executeTakeFirst();
  if (input.taskId && (!inspectionTask || inspectionTask.unit_id !== unit.id)) {
    throw new ValidationError('task_unit_mismatch', 'The inspection task does not belong to this unit.');
  }
  if (inspectionTask && ['open', 'in_progress', 'blocked'].includes(inspectionTask.status)) {
    await transitionTask(
      d,
      tx,
      inspectionTask.id,
      { to: 'done', reason: `Inspection ${evaluation.result}` },
      {
        internal: true,
        source: meta.source === 'mobile_sync' ? 'mobile_sync' : 'inspection',
      },
    );
  }

  // 3. Pass → the cleaning is verified. Fail → urgent re-clean for the attendant who cleaned it.
  let reclean: TaskRow | null = null;
  if (passed) {
    if (lastCleaning) {
      await transitionTask(
        d,
        tx,
        lastCleaning.id,
        { to: 'verified', reason: 'Inspection passed' },
        {
          internal: true,
          source: 'inspection',
        },
      );
    }
  } else {
    const pr = await housekeepingPriorityFor(d, tx, {
      propertyId: unit.property_id,
      unitId: unit.id,
      kind: 'reclean',
    });
    const r = await insertTask(d, tx, {
      propertyId: unit.property_id,
      kind: 'reclean',
      title: `Re-clean · ${unit.unit_number}`,
      description: evaluation.reasons.join('\n'),
      unitId: unit.id,
      stayId: arrival?.stayId ?? null,
      parentTaskId: lastCleaning?.id ?? null,
      // Assigned straight back to the attendant who cleaned it; the supervisor can reassign.
      assigneeUserId: lastCleaning?.assignee_user_id ?? null,
      assigneeName: lastCleaning?.assignee_name ?? null,
      priority: pr.priority,
      priorityScore: pr.score,
      priorityReasons: pr.reasons,
      serviceDate: lastCleaning?.service_date ?? null,
      refs: [{ type: 'inspection', id: inspectionId }],
      source: 'inspection',
      dedupeKey: `reclean:${inspectionId}`,
    });
    reclean = r.row;
  }

  // 4. Maintenance return-to-service waits for this inspection.
  let workOrderId: string | null = null;
  if (unit.block_work_order_id) {
    workOrderId = unit.block_work_order_id;
    if (passed) {
      await db(tx)
        .updateTable('operations.work_orders')
        .set({
          return_to_service_status: 'ready',
          feed_xid: feedMark(),
          version: (eb) => eb('version', '+', 1),
        })
        .where('id', '=', workOrderId)
        .where('return_to_service_status', '=', 'awaiting_inspection')
        .execute();
    }
  }

  // 5. The immutable inspection record.
  const row = await db(tx)
    .insertInto('operations.inspections')
    .values({
      id: inspectionId,
      tenant_id: tx.tenantId,
      property_id: unit.property_id,
      unit_id: unit.id,
      task_id: inspectionTask?.id ?? null,
      checklist_code: template?.code ?? null,
      checklist_version: template?.version ?? null,
      items: JSON.stringify(evaluation.items),
      result: evaluation.result,
      failure_reasons: JSON.stringify(evaluation.failures),
      notes: input.notes ?? null,
      inspector: JSON.stringify(tx.actor),
      inspector_key: actorKey(tx),
      inspected_at: tx.now,
      client_inspected_at:
        meta.clientInspectedAt ?? (input.clientInspectedAt ? new Date(input.clientInspectedAt) : null),
      cleaned_by_user_id: lastCleaning?.assignee_user_id ?? null,
      reclean_task_id: reclean?.id ?? null,
      affected_stay_id: arrival?.stayId ?? null,
      work_order_id: workOrderId,
      created_at: tx.now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const current = await loadUnit(tx, unit.id);
  const readiness = current.readiness as Readiness;
  await tx.audit({
    action: `operations.inspection.${evaluation.result}`,
    target: { type: 'unit', id: unit.id },
    propertyId: unit.property_id,
    reason: evaluation.reasons.join('; ') || null,
    before: { condition: unit.condition },
    after: {
      inspectionId,
      result: evaluation.result,
      recleanTaskId: reclean?.id ?? null,
      pending: write.pending,
    },
  });
  await tx.emit({
    type: passed ? 'operations.inspection.passed' : 'operations.inspection.failed',
    propertyId: unit.property_id,
    aggregate: { type: 'unit', id: unit.id },
    payload: {
      inspectionId,
      unitId: unit.id,
      unitNumber: unit.unit_number,
      result: evaluation.result,
      reasons: evaluation.reasons,
      inspector: actorName(tx),
      recleanTaskId: reclean?.id ?? null,
      recleanAssigneeUserId: reclean?.assignee_user_id ?? null,
      recleanAssigneeName: reclean?.assignee_name ?? null,
      affectedStay: arrival ? { stayId: arrival.stayId, eta: iso(arrival.eta), vip: arrival.ctx.vip } : null,
      ready: readiness.ready,
      expectedReadyAt: readiness.expectedReadyAt,
      pendingExternalConfirmation: write.pending,
    },
  });
  return {
    inspection: toInspectionView(row),
    unit: await unitView(d, tx, current),
    recleanTask: reclean ? await taskView(tx, reclean) : null,
    pending: write.pending,
  };
}
