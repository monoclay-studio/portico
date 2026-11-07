import type { TxContext } from '@portico/db';
import { type LocalDate, NotFoundError, newId, requirePermission, ValidationError } from '@portico/kernel';
import type { AssignmentSuggestions, Attendant, Section, TaskView } from '../contracts';
import { planHousekeepingDay } from '../domain/day-plan';
import {
  HOUSEKEEPING_KINDS,
  type Occupancy,
  type SectionKind,
  type TaskKind,
  type UnitCondition,
} from '../domain/model';
import { suggestAssignments as suggest, type WorkloadAttendant, type WorkloadTask } from '../domain/workload';
import {
  type Deps,
  db,
  loadSettings,
  pgUniqueViolation,
  propertyFacts,
  requireAny,
  UNIT_READ_PERMISSIONS,
} from './internal';
import { assignTask, housekeepingPriorityFor, insertTask, loadTask, taskView } from './tasks';

const P = {
  configure: 'operations.unit.configure',
  assign: 'operations.housekeeping.assign',
  read: 'operations.unit.read',
} as const;

// ───────────────────────────── Sections ─────────────────────────────

export async function createSection(
  _d: Deps,
  tx: TxContext,
  propertyId: string,
  input: { code: string; name: string; kind: SectionKind; parentCode?: string; sortOrder?: number },
): Promise<Section> {
  requirePermission(tx, P.configure, { propertyId });
  let parentId: string | null = null;
  if (input.parentCode) {
    const parent = await db(tx)
      .selectFrom('operations.sections')
      .select('id')
      .where('property_id', '=', propertyId)
      .where('code', '=', input.parentCode)
      .executeTakeFirst();
    if (!parent)
      throw new ValidationError('unknown_section', `Parent section "${input.parentCode}" does not exist.`, {
        parentCode: input.parentCode,
      });
    parentId = parent.id;
  }
  const id = newId(tx.now.getTime());
  try {
    const row = await db(tx)
      .insertInto('operations.sections')
      .values({
        id,
        tenant_id: tx.tenantId,
        property_id: propertyId,
        code: input.code,
        name: input.name,
        kind: input.kind,
        parent_id: parentId,
        sort_order: input.sortOrder ?? 0,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx.audit({
      action: 'operations.section.create',
      target: { type: 'section', id },
      propertyId,
      after: input,
    });
    return {
      id: row.id,
      propertyId,
      code: row.code,
      name: row.name,
      kind: row.kind,
      parentId: row.parent_id,
      sortOrder: row.sort_order,
    };
  } catch (err) {
    if (pgUniqueViolation(err))
      throw new ValidationError(
        'section_code_taken',
        `Section code ${input.code} is already used at this property.`,
      );
    throw err;
  }
}

export async function listSections(_d: Deps, tx: TxContext, propertyId: string): Promise<Section[]> {
  requireAny(tx, UNIT_READ_PERMISSIONS, propertyId);
  const rows = await db(tx)
    .selectFrom('operations.sections')
    .selectAll()
    .where('property_id', '=', propertyId)
    .orderBy('sort_order')
    .orderBy('code')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    propertyId,
    code: r.code,
    name: r.name,
    kind: r.kind,
    parentId: r.parent_id,
    sortOrder: r.sort_order,
  }));
}

// ───────────────────────────── Attendants (roster) ─────────────────────────────

function toAttendant(r: {
  id: string;
  property_id: string;
  user_id: string;
  display_name: string;
  home_section_ids: string[];
  daily_credit_capacity: number;
  active: boolean;
  version: number;
}): Attendant {
  return {
    id: r.id,
    propertyId: r.property_id,
    userId: r.user_id,
    displayName: r.display_name,
    homeSectionIds: r.home_section_ids,
    dailyCreditCapacity: r.daily_credit_capacity,
    active: r.active,
    version: r.version,
  };
}

export async function upsertAttendant(
  _d: Deps,
  tx: TxContext,
  propertyId: string,
  input: { userId: string; displayName: string; homeSectionCodes: string[]; dailyCreditCapacity: number },
): Promise<Attendant> {
  requirePermission(tx, P.configure, { propertyId });
  const sections = input.homeSectionCodes.length
    ? await db(tx)
        .selectFrom('operations.sections')
        .select(['id', 'code'])
        .where('property_id', '=', propertyId)
        .where('code', 'in', input.homeSectionCodes)
        .execute()
    : [];
  const missing = input.homeSectionCodes.filter((c) => !sections.some((s) => s.code === c));
  if (missing.length)
    throw new ValidationError('unknown_section', `Unknown sections: ${missing.join(', ')}.`, { missing });
  const values = {
    display_name: input.displayName,
    home_section_ids: sections.map((s) => s.id),
    daily_credit_capacity: input.dailyCreditCapacity,
    active: true,
  };
  const row = await db(tx)
    .insertInto('operations.attendants')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      property_id: propertyId,
      user_id: input.userId,
      ...values,
    })
    .onConflict((oc) =>
      oc
        .columns(['tenant_id', 'property_id', 'user_id'])
        .doUpdateSet({ ...values, version: (eb) => eb('operations.attendants.version', '+', 1) }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'operations.attendant.upsert',
    target: { type: 'attendant', id: row.id },
    propertyId,
    after: input,
  });
  return toAttendant(row);
}

export async function listAttendants(_d: Deps, tx: TxContext, propertyId: string): Promise<Attendant[]> {
  requireAny(tx, UNIT_READ_PERMISSIONS, propertyId);
  const rows = await db(tx)
    .selectFrom('operations.attendants')
    .selectAll()
    .where('property_id', '=', propertyId)
    .orderBy('display_name')
    .execute();
  return rows.map(toAttendant);
}

// ───────────────────────────── Day plan ─────────────────────────────

/**
 * Generate the housekeeping tasks a service date needs (departure cleans, stayovers, turndowns, vacant cleans,
 * arrival inspections). Idempotent: every task has a business key, so re-running the plan creates only what is
 * missing. Units with an open task of the same purpose are not given a second one.
 */
export async function generateDayPlan(
  d: Deps,
  tx: TxContext,
  propertyId: string,
  input: { date?: LocalDate },
): Promise<{ propertyId: string; date: LocalDate; created: TaskView[]; alreadyPlanned: number }> {
  requirePermission(tx, P.assign, { propertyId });
  const facts = await propertyFacts(d, tx, propertyId);
  const date = input.date ?? facts.businessDate;
  const settings = await loadSettings(d, tx, propertyId);
  const units = await db(tx)
    .selectFrom('operations.unit_status')
    .select(['id', 'unit_number', 'condition', 'occupancy', 'block_kind', 'block_from', 'block_to'])
    .where('property_id', '=', propertyId)
    .where('active', '=', true)
    .execute();
  const stays = await db(tx)
    .selectFrom('operations.stay_projection')
    .select(['id', 'unit_id', 'arrival', 'departure', 'status'])
    .where('property_id', '=', propertyId)
    .where('arrival', '<=', date)
    .where('departure', '>=', date)
    .where('status', 'in', ['expected', 'in_house', 'departed'])
    .execute();
  const planned = planHousekeepingDay({
    date,
    units: units.map((u) => ({
      id: u.id,
      number: u.unit_number,
      condition: u.condition as UnitCondition,
      occupancy: u.occupancy as Occupancy,
      blocked: !!u.block_kind && !!u.block_from && !!u.block_to && u.block_from <= date && date < u.block_to,
    })),
    stays: stays.map((s) => ({
      id: s.id,
      unitId: s.unit_id,
      arrival: s.arrival,
      departure: s.departure,
      status: s.status as 'expected',
    })),
    turndownEnabled: settings.turndownEnabled,
    requireInspection: settings.readinessCondition === 'inspected',
  });
  const open = await db(tx)
    .selectFrom('operations.tasks')
    .select(['unit_id', 'kind'])
    .where('property_id', '=', propertyId)
    .where('status', 'in', ['open', 'in_progress', 'blocked'])
    .where('kind', 'in', [...HOUSEKEEPING_KINDS])
    .execute();
  const openKey = new Set(open.map((t) => `${t.unit_id}:${purpose(t.kind as TaskKind)}`));
  const created: TaskView[] = [];
  let already = 0;
  for (const p of planned) {
    // Vacant cleans and inspections are skipped when the unit already has open work of the same purpose.
    if (
      (p.kind === 'vacant_clean' || p.kind === 'inspection') &&
      openKey.has(`${p.unitId}:${purpose(p.kind)}`)
    ) {
      already++;
      continue;
    }
    const pr = await housekeepingPriorityFor(d, tx, {
      propertyId,
      unitId: p.unitId,
      kind: p.kind,
      departed:
        p.kind === 'departure_clean' && stays.some((s) => s.id === p.stayId && s.status === 'departed'),
    });
    const { row, created: isNew } = await insertTask(d, tx, {
      propertyId,
      kind: p.kind,
      title: p.title,
      unitId: p.unitId,
      stayId: p.stayId,
      priority: pr.priority,
      priorityScore: pr.score,
      priorityReasons: pr.reasons,
      serviceDate: date,
      source: 'day_plan',
      dedupeKey: p.dedupeKey,
    });
    if (isNew) {
      created.push(await taskView(tx, row));
      openKey.add(`${p.unitId}:${purpose(p.kind)}`);
    } else already++;
  }
  if (settings.turndownEnabled) {
    for (const p of planned.filter((x) => x.kind === 'turndown')) {
      await db(tx)
        .updateTable('operations.unit_status')
        .set({ turndown: 'pending' })
        .where('id', '=', p.unitId)
        .where('turndown', 'in', ['not_required', 'done'])
        .execute();
    }
  }
  await tx.audit({
    action: 'operations.housekeeping.plan',
    target: { type: 'property', id: propertyId },
    propertyId,
    after: { date, created: created.length, alreadyPlanned: already },
  });
  return { propertyId, date, created, alreadyPlanned: already };
}

function purpose(kind: TaskKind): string {
  return kind === 'departure_clean' || kind === 'vacant_clean' || kind === 'reclean' ? 'clean' : kind;
}

// ───────────────────────────── Assignment suggestions ─────────────────────────────

/**
 * Suggest attendants for the unassigned housekeeping tasks of a service date, balancing credits by section /
 * island zone. Every suggestion explains itself; a supervisor applies (or edits) them with applyAssignments.
 */
export async function suggestAssignments(
  d: Deps,
  tx: TxContext,
  propertyId: string,
  input: { date?: LocalDate },
): Promise<AssignmentSuggestions> {
  requirePermission(tx, P.assign, { propertyId });
  const date = input.date ?? (await propertyFacts(d, tx, propertyId)).businessDate;
  const sections = await db(tx)
    .selectFrom('operations.sections')
    .select(['id', 'name', 'parent_id'])
    .where('property_id', '=', propertyId)
    .execute();
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const tasks = await db(tx)
    .selectFrom('operations.tasks as t')
    .leftJoin('operations.unit_status as u', 'u.id', 't.unit_id')
    .select([
      't.id',
      't.kind',
      't.credits',
      't.priority_score',
      't.assignee_user_id',
      't.status',
      't.version',
      'u.unit_number',
      'u.section_id',
    ])
    .where('t.property_id', '=', propertyId)
    .where('t.kind', 'in', [...HOUSEKEEPING_KINDS])
    .where('t.status', 'in', ['open', 'in_progress', 'blocked'])
    .where((eb) => eb.or([eb('t.service_date', '=', date), eb('t.service_date', 'is', null)]))
    .execute();
  const attendants = await db(tx)
    .selectFrom('operations.attendants')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('active', '=', true)
    .execute();
  const unassigned = tasks.filter((t) => !t.assignee_user_id);
  const workloadAttendants: WorkloadAttendant[] = attendants.map((a) => {
    const mine = tasks.filter((t) => t.assignee_user_id === a.user_id);
    return {
      id: a.id,
      name: a.display_name,
      homeSectionIds: a.home_section_ids,
      homeZoneIds: a.home_section_ids
        .map((s) => sectionById.get(s)?.parent_id)
        .filter((x): x is string => !!x),
      capacity: a.daily_credit_capacity,
      assignedCredits: mine.reduce((sum, t) => sum + t.credits, 0),
      activeSectionIds: mine.map((t) => t.section_id).filter((x): x is string => !!x),
    };
  });
  const workloadTasks: WorkloadTask[] = unassigned.map((t) => ({
    id: t.id,
    unitNumber: t.unit_number,
    sectionId: t.section_id,
    zoneId: t.section_id ? (sectionById.get(t.section_id)?.parent_id ?? null) : null,
    sectionName: t.section_id ? (sectionById.get(t.section_id)?.name ?? null) : null,
    credits: t.credits,
    priorityScore: t.priority_score,
  }));
  const result = suggest(workloadTasks, workloadAttendants);
  const taskById = new Map(unassigned.map((t) => [t.id, t]));
  const userByAttendant = new Map(attendants.map((a) => [a.id, a.user_id]));
  return {
    propertyId,
    date,
    suggestions: result.suggestions.map((s) => {
      const t = taskById.get(s.taskId);
      return {
        taskId: s.taskId,
        unitNumber: t?.unit_number ?? null,
        kind: (t?.kind ?? 'general') as TaskKind,
        credits: t?.credits ?? 0,
        attendantId: s.attendantId,
        attendantUserId: userByAttendant.get(s.attendantId) ?? '',
        attendantName: s.attendantName,
        explanation: s.explanation,
        alternatives: s.alternatives.map((a) => ({
          attendantId: a.attendantId,
          attendantName: a.attendantName,
          score: a.score,
          factors: a.factors,
        })),
        taskVersion: t?.version ?? 0,
      };
    }),
    unassigned: result.unassigned,
    workload: result.workload,
  };
}

/** Apply (possibly edited) assignments. Each task is checked against the version the supervisor saw. */
export async function applyAssignments(
  d: Deps,
  tx: TxContext,
  propertyId: string,
  input: {
    assignments: Array<{ taskId: string; expectedVersion: number; attendantId: string }>;
    reason?: string;
  },
) {
  requirePermission(tx, P.assign, { propertyId });
  const applied: TaskView[] = [];
  const conflicts: Array<{ taskId: string; code: string; message: string; currentVersion: number }> = [];
  for (const a of input.assignments) {
    const attendant = await db(tx)
      .selectFrom('operations.attendants')
      .selectAll()
      .where('id', '=', a.attendantId)
      .where('property_id', '=', propertyId)
      .executeTakeFirst();
    if (!attendant) throw new NotFoundError('attendant', a.attendantId);
    const task = await loadTask(tx, a.taskId);
    if (task.property_id !== propertyId) throw new NotFoundError('task', a.taskId);
    if (task.version !== a.expectedVersion) {
      conflicts.push({
        taskId: a.taskId,
        code: 'version_conflict',
        message: `The task changed since the suggestion was made (now ${task.status}${task.assignee_name ? `, assigned to ${task.assignee_name}` : ''}). Refresh the suggestions.`,
        currentVersion: task.version,
      });
      continue;
    }
    applied.push(
      await assignTask(
        d,
        tx,
        a.taskId,
        {
          assigneeUserId: attendant.user_id,
          assigneeName: attendant.display_name,
          ...(input.reason ? { reason: input.reason } : {}),
        },
        { expectedVersion: a.expectedVersion },
      ),
    );
  }
  return { applied, conflicts };
}
