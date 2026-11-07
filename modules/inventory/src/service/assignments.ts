import { sql, type TxContext, withSavepoint } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  type DateRange,
  type EntityRef,
  type LocalDate,
  NotFoundError,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { Assignment, UnitCandidate } from '../contracts';
import { intersectRanges, nightsOfRange, nightsToRuns, spanOf } from '../domain/ranges';
import { type CandidateFacts, type Exclusion, rankCandidates } from '../domain/ranking';
import { UnitAssignmentConflictError } from '../errors';
import { INVENTORY_EVENTS } from '../events';
import { INVENTORY_PERMISSIONS } from '../manifest';
import { assignmentConflicts, componentsOf, placeAssignment, trimAssignments } from './assignment-store';
import { changeConsumption } from './consumption';
import {
  actorKey,
  assertRef,
  type Deps,
  guardAvailabilityWrite,
  idb,
  isoRequired,
  requireAnyPermission,
  type WriteOptions,
} from './context';
import { LedgerSession, nightsOf, requireType } from './ledger';
import {
  type AssignmentRow,
  compositeTypesContainingUnits,
  loadActiveBlocks,
  loadAssignments,
  loadOccupancy,
  loadUnits,
  lockUnits,
  type UnitLite,
  unitActiveOn,
} from './occupancy';

export interface AssignUnitInput {
  unitId: string;
  ref: EntityRef;
  nights: DateRange;
  /** Keep automated assignment and optimization from moving this assignment (INV-R20). */
  locked?: boolean;
  lockReason?: string;
  /**
   * The unit is of a different type than the ref consumed: move the consumption to the unit's type in the same
   * transaction (INV-R19), so availability reflects the unit actually occupied.
   */
  upgrade?: { reason: string; chargeable: boolean };
  /** Move or replace a locked assignment of this ref (requires inventory.assignment.overrideLock). */
  overrideLock?: boolean;
  /**
   * Assign even though it leaves fewer free combined units (e.g. two-bedroom residences) than are held or sold for
   * these nights. The inventory conflict this opens is returned in `conflictsCreated`.
   */
  allowCompositeConflict?: boolean;
}

export interface AssignUnitResult {
  change: 'assigned' | 'moved' | 'unchanged';
  unitId: string;
  nights: DateRange;
  previousUnitIds: string[];
  upgradedFromUnitTypeIds: string[];
  /** Inventory conflicts opened by this assignment (only with `allowCompositeConflict`). */
  conflictsCreated: string[];
}

/**
 * Assign a specific unit to a ref for a night range (INV-R18). The database guarantees no unit is assigned twice
 * on a night; overlapping assignments of other refs are reported as UnitAssignmentConflictError listing them.
 * Re-assigning a ref that already has a unit on those nights moves it (atomically; locked assignments need
 * overrideLock). Out-of-order, out-of-service and house-use units are not assignable (INV-R21).
 */
export async function assignUnit(
  deps: Deps,
  tx: TxContext,
  input: AssignUnitInput,
  opts: WriteOptions = {},
): Promise<AssignUnitResult> {
  const ref = assertRef(input.ref);
  const nights = nightsOfRange(input.nights);
  const range = { from: input.nights.from, to: input.nights.to };
  const [unit] = await loadUnits(tx, { ids: [input.unitId] });
  if (!unit) throw new NotFoundError('unit', input.unitId);
  requirePermission(tx, INVENTORY_PERMISSIONS.assignmentManage, { propertyId: unit.propertyId });
  await guardAvailabilityWrite(tx, deps, unit.propertyId, opts.origin);
  if (input.locked && !input.lockReason?.trim()) {
    throw new ValidationError(
      'lock_reason_required',
      'Say why the assignment is locked (e.g. guest requested villa 214).',
    );
  }
  const inactive = nights.filter((n) => !unitActiveOn(unit, n));
  if (inactive.length > 0) {
    throw new BusinessRuleError(
      'unit_not_assignable',
      `Unit ${unit.number} is not in service (${unit.status}) on ${inactive[0]}${inactive.length > 1 ? ` and ${inactive.length - 1} more night(s)` : ''}. Choose another unit.`,
      { unitId: unit.id, reason: 'inactive', nights: inactive },
    );
  }

  // What the ref consumed on these nights decides whether the unit fits (or needs an upgrade).
  const consumed = await idb(tx)
    .selectFrom('inventory.consumptions')
    .select(['unit_type_id', 'night', 'quantity'])
    .where('ref_type', '=', ref.type)
    .where('ref_id', '=', ref.id)
    .where('night', 'in', nights)
    .where('kind', '<>', 'composite_component')
    .execute();
  const byNight = new Map(consumed.map((c) => [c.night, c]));
  const missing = nights.filter((n) => !byNight.has(n));
  if (missing.length > 0) {
    throw new BusinessRuleError(
      'assignment_without_consumption',
      `${ref.type} ${ref.id} has no inventory booked on ${missing.join(', ')}. Book (consume) those nights before assigning a unit.`,
      { ref, nights: missing },
    );
  }
  if (consumed.some((c) => c.quantity !== 1)) {
    throw new BusinessRuleError(
      'assignment_requires_single_unit',
      'Only refs that consume exactly one unit per night (stays) can be assigned a unit.',
      { ref },
    );
  }
  const mismatched = consumed.filter((c) => c.unit_type_id !== unit.unitTypeId);
  if (mismatched.length > 0 && !input.upgrade) {
    const unitType = await requireType(tx, unit.unitTypeId);
    const bookedType = await requireType(tx, mismatched[0]?.unit_type_id ?? '');
    throw new BusinessRuleError(
      'unit_type_mismatch',
      `Unit ${unit.number} is a ${unitType.name}, but the booking is for ${bookedType.name} on ${mismatched.map((m) => m.night).join(', ')}. Choose a ${bookedType.name}, or assign it as an upgrade (with a reason) so inventory moves to ${unitType.name}.`,
      { unitId: unit.id, unitTypeId: unit.unitTypeId, bookedUnitTypeId: bookedType.id },
    );
  }

  const existing = await loadAssignments(tx, { ref, topLevelOnly: true, span: range });
  const covered = nights.every((n) =>
    existing.some((a) => a.unitId === unit.id && n >= a.nights.from && n < a.nights.to),
  );
  if (
    covered &&
    mismatched.length === 0 &&
    (input.locked === undefined || existing.every((a) => a.locked === input.locked))
  ) {
    return {
      change: 'unchanged',
      unitId: unit.id,
      nights: range,
      previousUnitIds: [],
      upgradedFromUnitTypeIds: [],
      conflictsCreated: [],
    };
  }
  const lockedOthers = existing.filter((a) => a.locked && a.unitId !== unit.id);
  if (lockedOthers.length > 0) {
    if (!input.overrideLock) {
      throw new ConflictError(
        'assignment_locked',
        `This stay is locked to unit(s) ${await unitNumbers(
          tx,
          lockedOthers.map((a) => a.unitId),
        )} (${lockedOthers[0]?.lockReason}). Confirm the move to override the lock.`,
        {
          ref,
          lockedAssignments: lockedOthers.map((a) => ({
            unitId: a.unitId,
            nights: a.nights,
            reason: a.lockReason,
          })),
        },
      );
    }
    requirePermission(tx, INVENTORY_PERMISSIONS.assignmentOverrideLock, { propertyId: unit.propertyId });
  }

  const components = unit.isComposite ? await componentsOf(tx, unit.id) : [];
  const previousUnitIds = [...new Set(existing.map((a) => a.unitId).filter((id) => id !== unit.id))];
  // Lock up front, in global order: composite cells affected by the units involved, and cells an upgrade moves.
  const compositeTypes = new Set([
    ...(await compositeTypesContainingUnits(tx, [unit.id, ...previousUnitIds])),
    ...(unit.isComposite ? [unit.unitTypeId] : []),
  ]);
  const cells = [
    ...[...compositeTypes].flatMap((t) => nights.map((night) => ({ unitTypeId: t, night }))),
    ...mismatched.flatMap((m) => [
      { unitTypeId: m.unit_type_id, night: m.night },
      { unitTypeId: unit.unitTypeId, night: m.night },
    ]),
  ];
  if (cells.length > 0) await LedgerSession.open(tx, unit.propertyId, cells);

  return withSavepoint(tx, 'inv_assign_unit', async () => {
    const upgradedFrom = new Set<string>();
    if (mismatched.length > 0 && input.upgrade) {
      const byType = new Map<string, LocalDate[]>();
      for (const m of mismatched)
        byType.set(m.unit_type_id, [...(byType.get(m.unit_type_id) ?? []), m.night]);
      for (const [fromType, ns] of byType) {
        for (const run of nightsToRuns(ns)) {
          await changeConsumption(deps, tx, {
            ref,
            from: { unitTypeId: fromType, nights: run },
            to: { unitTypeId: unit.unitTypeId, nights: run },
            reason: 'upgrade',
            preferUnitId: unit.id,
          });
        }
        upgradedFrom.add(fromType);
      }
    }
    await lockUnits(tx, [unit.id, ...components.map((c) => c.id)]);
    await assertAssignable(tx, unit, components, range, ref);
    // What the combined units allow before the change (to detect holds/sales this assignment would break).
    const compositeSession =
      compositeTypes.size > 0
        ? await LedgerSession.open(
            tx,
            unit.propertyId,
            [...compositeTypes].flatMap((t) => nights.map((night) => ({ unitTypeId: t, night }))),
          )
        : null;
    const before = new Map<string, number>();
    if (compositeSession) {
      for (const t of compositeTypes) {
        for (const [n, st] of await compositeSession.compositeState(t, nights))
          before.set(`${t}|${n}`, st.availability.unitLimit);
      }
    }
    await trimAssignments(tx, ref, range);
    await placeAssignment(tx, {
      propertyId: unit.propertyId,
      unit,
      ref,
      range,
      locked: input.locked ?? existing.some((a) => a.unitId === unit.id && a.locked),
      lockReason: input.locked
        ? (input.lockReason ?? null)
        : (existing.find((a) => a.unitId === unit.id && a.locked)?.lockReason ?? null),
      upgrade:
        upgradedFrom.size > 0 && input.upgrade
          ? {
              fromUnitTypeId: [...upgradedFrom][0] as string,
              reason: input.upgrade.reason,
              chargeable: input.upgrade.chargeable,
            }
          : null,
      createdBy: actorKey(tx),
    });
    let conflictsCreated: string[] = [];
    if (compositeSession) {
      // INV-R07: a component villa given to an ordinary stay must not silently break a residence hold or sale.
      const broken: Array<{ unitTypeId: string; night: LocalDate; unitLimit: number }> = [];
      for (const t of compositeTypes) {
        for (const [n, st] of await compositeSession.compositeState(t, nights)) {
          const was = before.get(`${t}|${n}`) ?? 0;
          if (st.availability.unitLimit < 0 && st.availability.unitLimit < was) {
            broken.push({ unitTypeId: t, night: n, unitLimit: st.availability.unitLimit });
          }
        }
      }
      if (broken.length > 0 && !input.allowCompositeConflict) {
        const typeName = compositeSession.type(broken[0]?.unitTypeId as string).name;
        throw new BusinessRuleError(
          'composite_hold_at_risk',
          `Assigning unit ${unit.number} would leave too few free ${typeName} units for the holds or sales already made on ${[...new Set(broken.map((b) => b.night))].join(', ')} — that booking could no longer be honoured. Choose another unit (assignable units lists ones outside combined units first), or confirm to record an inventory conflict.`,
          { unitId: unit.id, broken },
        );
      }
      for (const t of compositeTypes) compositeSession.touchComposite(t, nights);
      conflictsCreated = (await compositeSession.finish({ kind: 'assignment', ref })).created;
    }
    const change = previousUnitIds.length > 0 ? 'moved' : 'assigned';
    await tx.audit({
      action: `inventory.assignment.${change === 'moved' ? 'move' : 'assign'}`,
      target: { type: ref.type, id: ref.id },
      propertyId: unit.propertyId,
      before:
        existing.length > 0
          ? existing.map((a) => ({ unitId: a.unitId, nights: a.nights, locked: a.locked }))
          : null,
      after: { unitId: unit.id, unitNumber: unit.number, nights: range, locked: input.locked ?? false },
      ...(input.upgrade ? { reason: input.upgrade.reason } : {}),
      metadata: input.overrideLock && lockedOthers.length > 0 ? { overrodeLock: true } : undefined,
    });
    await tx.emit({
      type: INVENTORY_EVENTS.assignmentChanged,
      propertyId: unit.propertyId,
      aggregate: { type: ref.type, id: ref.id },
      payload: { propertyId: unit.propertyId, ref, change, unitId: unit.id, previousUnitIds, nights: range },
    });
    return {
      change,
      unitId: unit.id,
      nights: range,
      previousUnitIds,
      upgradedFromUnitTypeIds: [...upgradedFrom],
      conflictsCreated,
    };
  });
}

async function unitNumbers(tx: TxContext, ids: readonly string[]): Promise<string> {
  const units = await loadUnits(tx, { ids: [...new Set(ids)] });
  return units.map((u) => u.number).join(', ');
}

/** Blocks and other refs' assignments make a unit unassignable; explain which and until when. */
async function assertAssignable(
  tx: TxContext,
  unit: UnitLite,
  components: readonly UnitLite[],
  range: DateRange,
  ref: EntityRef,
): Promise<void> {
  const all = [unit, ...components];
  const blocks = await loadActiveBlocks(tx, { unitIds: all.map((u) => u.id), span: range });
  if (blocks.length > 0) {
    const b = blocks[0];
    const blocked = all.find((u) => u.id === b?.unitId);
    const label =
      b?.kind === 'out_of_order'
        ? 'out of order'
        : b?.kind === 'out_of_service'
          ? 'out of service'
          : 'in house use';
    throw new BusinessRuleError(
      'unit_not_assignable',
      `Unit ${blocked?.number ?? unit.number} is ${label} (${b?.reason}) from ${b?.nights.from} until ${b?.nights.to}. Choose another unit or wait until the block is released.`,
      {
        unitId: unit.id,
        reason: b?.kind,
        blocks: blocks.map((x) => ({
          blockId: x.id,
          unitId: x.unitId,
          kind: x.kind,
          nights: x.nights,
          reason: x.reason,
        })),
      },
    );
  }
  const conflicts = await assignmentConflicts(tx, all, range, ref);
  if (conflicts.length > 0) throw new UnitAssignmentConflictError(unit.number, conflicts);
}

export interface UnassignUnitInput {
  ref: EntityRef;
  nights?: DateRange;
  overrideLock?: boolean;
  reason?: string;
}

/** Remove a ref's unit assignment for some or all nights (the consumption stays; the stay becomes unassigned). */
export async function unassignUnit(
  deps: Deps,
  tx: TxContext,
  input: UnassignUnitInput,
  opts: WriteOptions = {},
): Promise<{ unassigned: Array<{ unitId: string; nights: DateRange }> }> {
  const ref = assertRef(input.ref);
  const range = input.nights ? (spanOf(nightsOfRange(input.nights)) as DateRange) : null;
  const existing = await loadAssignments(tx, { ref, topLevelOnly: true, ...(range ? { span: range } : {}) });
  if (existing.length === 0) return { unassigned: [] };
  const propertyId = (existing[0] as AssignmentRow).propertyId;
  requirePermission(tx, INVENTORY_PERMISSIONS.assignmentManage, { propertyId });
  await guardAvailabilityWrite(tx, deps, propertyId, opts.origin);
  const compositeUnits = (await loadUnits(tx, { ids: existing.map((a) => a.unitId) })).filter(
    (u) => u.isComposite,
  );
  if (compositeUnits.length > 0) {
    throw new BusinessRuleError(
      'composite_must_stay_assigned',
      `${compositeUnits.map((u) => u.number).join(', ')} is a combined unit, sold together with its specific units, so the stay cannot be left unassigned. Move it to another combined unit (assign) or release the nights instead.`,
      { ref, unitIds: compositeUnits.map((u) => u.id) },
    );
  }
  if (existing.some((a) => a.locked)) {
    if (!input.overrideLock) {
      throw new ConflictError(
        'assignment_locked',
        `This stay is locked to its unit (${existing.find((a) => a.locked)?.lockReason}). Confirm to override the lock.`,
        { ref },
      );
    }
    requirePermission(tx, INVENTORY_PERMISSIONS.assignmentOverrideLock, { propertyId });
  }
  const compositeTypes = await compositeTypesContainingUnits(
    tx,
    existing.map((a) => a.unitId),
  );
  const nightsAffected = existing.flatMap((a) => {
    const r = range ? intersectRanges(a.nights, range) : a.nights;
    return r ? nightsOf(r.from, r.to) : [];
  });
  const cells = compositeTypes.flatMap((t) => nightsAffected.map((night) => ({ unitTypeId: t, night })));
  const session = cells.length > 0 ? await LedgerSession.open(tx, propertyId, cells) : null;
  const trimmed = await trimAssignments(tx, ref, range);
  if (session) {
    for (const t of compositeTypes) session.touchComposite(t, nightsAffected);
    await session.finish({ kind: 'assignment', ref });
  }
  await tx.audit({
    action: 'inventory.assignment.unassign',
    target: { type: ref.type, id: ref.id },
    propertyId,
    reason: input.reason ?? null,
    before: trimmed.map((t) => ({ unitId: t.assignment.unitId, nights: t.assignment.nights })),
    after: trimmed.map((t) => ({ unitId: t.assignment.unitId, removed: t.removed })),
  });
  for (const t of trimmed) {
    await tx.emit({
      type: INVENTORY_EVENTS.assignmentChanged,
      propertyId,
      aggregate: { type: ref.type, id: ref.id },
      payload: {
        propertyId,
        ref,
        change: 'unassigned',
        unitId: null,
        previousUnitIds: [t.assignment.unitId],
        nights: t.removed,
      },
    });
  }
  return { unassigned: trimmed.map((t) => ({ unitId: t.assignment.unitId, nights: t.removed })) };
}

// ───────────────────────────── Reads ─────────────────────────────

export async function listAssignments(
  tx: TxContext,
  filter: { propertyId: string; range: DateRange; unitId?: string; ref?: EntityRef },
): Promise<Assignment[]> {
  requireAnyPermission(
    tx,
    [
      INVENTORY_PERMISSIONS.unitRead,
      INVENTORY_PERMISSIONS.assignmentManage,
      INVENTORY_PERMISSIONS.availabilityRead,
    ],
    filter.propertyId,
  );
  nightsOfRange(filter.range, 400, 'range');
  const rows = await loadAssignments(tx, {
    propertyId: filter.propertyId,
    span: filter.range,
    ...(filter.unitId ? { unitIds: [filter.unitId] } : {}),
    ...(filter.ref ? { ref: filter.ref } : {}),
  });
  const parents = new Map<string, string>();
  const parentIds = [...new Set(rows.map((r) => r.parentId).filter((p): p is string => p !== null))];
  if (parentIds.length > 0) {
    const { rows: pr } = await sql<{ id: string; unit_id: string }>`
      select id, unit_id from inventory.assignments where id = any(${parentIds}::uuid[])`.execute(tx.db);
    for (const p of pr) parents.set(p.id, p.unit_id);
  }
  const units = new Map(
    (await loadUnits(tx, { ids: [...new Set(rows.map((r) => r.unitId))] })).map((u) => [u.id, u]),
  );
  return rows.map((r) =>
    toAssignment(r, units.get(r.unitId)?.number ?? '', r.parentId ? (parents.get(r.parentId) ?? null) : null),
  );
}

export function toAssignment(
  r: AssignmentRow,
  unitNumber: string,
  viaCompositeUnitId: string | null,
): Assignment {
  return {
    id: r.id,
    propertyId: r.propertyId,
    unitId: r.unitId,
    unitNumber,
    unitTypeId: r.unitTypeId,
    ref: r.ref,
    nights: r.nights,
    locked: r.locked,
    lockReason: r.lockReason,
    upgrade: r.upgrade,
    viaCompositeUnitId,
    createdBy: r.createdBy,
    createdAt: isoRequired(r.createdAt),
  };
}

export interface FindAssignableInput {
  propertyId: string;
  unitTypeId: string;
  nights: DateRange;
  /** Feature codes the guest asked for (ranking only, never exclusion). */
  features?: string[];
  /** The ref being placed: its own assignments do not count as conflicts. */
  ref?: EntityRef;
  /** Include units that cannot be assigned, with the reasons (default true). */
  includeUnavailable?: boolean;
}

type Facts = CandidateFacts & {
  unit: UnitLite;
  exclusionDetails: UnitCandidate['exclusions'];
  compositeUnitIds: string[];
};

/**
 * Units of a type that can take a ref for the nights, ranked, with reasons for every exclusion (INV-R08/R22).
 * Respects blocks, other assignments, composites (a combined unit needs every component free; a component used by
 * a combined sale is taken) and ranks standalone units ahead of components of combinable units.
 */
export async function findAssignableUnits(
  tx: TxContext,
  input: FindAssignableInput,
): Promise<UnitCandidate[]> {
  requireAnyPermission(
    tx,
    [INVENTORY_PERMISSIONS.unitRead, INVENTORY_PERMISSIONS.assignmentManage],
    input.propertyId,
  );
  const nights = nightsOfRange(input.nights);
  const range = { from: input.nights.from, to: input.nights.to };
  const type = await requireType(tx, input.unitTypeId, input.propertyId);
  const ref = input.ref ? assertRef(input.ref) : undefined;
  const units = (await loadUnits(tx, { unitTypeIds: [type.id] })).filter((u) => u.status !== 'retired');
  const componentsByComposite = new Map<string, UnitLite[]>();
  if (type.isComposite) {
    for (const u of units) componentsByComposite.set(u.id, await componentsOf(tx, u.id));
  }
  const allIds = [...units.map((u) => u.id), ...[...componentsByComposite.values()].flat().map((c) => c.id)];
  const occ = await loadOccupancy(tx, allIds, range);
  const { rows: memberships } = await sql<{ component_unit_id: string; composite_unit_id: string }>`
    select component_unit_id, composite_unit_id from inventory.composite_components
    where component_unit_id = any(${units.map((u) => u.id)}::uuid[])`.execute(tx.db);
  const isRef = (r: EntityRef) => ref !== undefined && r.type === ref.type && r.id === ref.id;
  const unitsById = new Map((await loadUnits(tx, { ids: allIds })).map((u) => [u.id, u]));
  const parentUnit = new Map<string, string>();
  const parentIds = [
    ...new Set(
      allIds
        .flatMap((id) => occ.assignmentsOf(id).map((a) => a.parentId))
        .filter((p): p is string => p !== null),
    ),
  ];
  if (parentIds.length > 0) {
    const { rows } = await sql<{ id: string; unit_id: string }>`
      select id, unit_id from inventory.assignments where id = any(${parentIds}::uuid[])`.execute(tx.db);
    for (const r of rows) parentUnit.set(r.id, r.unit_id);
    const missing = [...new Set(rows.map((r) => r.unit_id))].filter((id) => !unitsById.has(id));
    for (const u of await loadUnits(tx, { ids: missing })) unitsById.set(u.id, u);
  }

  const exclusionsFor = (u: UnitLite, asComponentOf?: UnitLite): UnitCandidate['exclusions'] => {
    const out: UnitCandidate['exclusions'] = [];
    const prefix = asComponentOf ? `Component ${u.number} of ${asComponentOf.number}: ` : '';
    const inactive = nights.filter((n) => !unitActiveOn(u, n));
    if (inactive.length > 0) {
      out.push({
        code: asComponentOf ? 'component_unavailable' : 'inactive',
        message: `${prefix}not in service (${u.status}) on ${inactive[0]}.`,
        ref: null,
        nights: null,
        blockId: null,
      });
    }
    for (const b of occ.blocksOf(u.id)) {
      const label =
        b.kind === 'out_of_order'
          ? 'Out of order'
          : b.kind === 'out_of_service'
            ? 'Out of service'
            : 'In house use';
      out.push({
        code: asComponentOf ? 'component_unavailable' : b.kind,
        message: `${prefix}${label}: ${b.reason} (until ${b.nights.to}).`,
        ref: null,
        nights: intersectRanges(b.nights, range),
        blockId: b.id,
      });
    }
    for (const a of occ.assignmentsOf(u.id)) {
      if (isRef(a.ref)) continue;
      const via = a.parentId ? unitsById.get(parentUnit.get(a.parentId) ?? '') : undefined;
      const overlap = intersectRanges(a.nights, range);
      out.push({
        code: asComponentOf ? 'component_unavailable' : via ? 'composite_in_use' : 'assigned',
        message: `${prefix}${via ? `part of ${via.number}, ` : ''}assigned to ${a.ref.type} ${a.ref.id} for nights ${overlap?.from} to ${overlap?.to} (departure).`,
        ref: a.ref,
        nights: overlap,
        blockId: null,
      });
    }
    return out;
  };

  const facts: Facts[] = units.map((u) => {
    let details = exclusionsFor(u);
    for (const c of componentsByComposite.get(u.id) ?? []) details = details.concat(exclusionsFor(c, u));
    const compositeUnitIds = memberships
      .filter((m) => m.component_unit_id === u.id)
      .map((m) => m.composite_unit_id);
    const exclusions: Exclusion[] = details.map((d) => ({ code: d.code, message: d.message }));
    return {
      unitId: u.id,
      number: u.number,
      sortOrder: u.sortOrder,
      features: u.features,
      exclusions,
      isComponent: compositeUnitIds.length > 0,
      currentForRef: ref ? occ.assignmentsOf(u.id).some((a) => isRef(a.ref)) : false,
      unit: u,
      exclusionDetails: details,
      compositeUnitIds,
    };
  });
  const ranked = rankCandidates(facts, {
    ...(input.features ? { requestedFeatures: input.features } : {}),
    compositeStay: type.isComposite,
  });
  return ranked
    .filter((r) => r.assignable || input.includeUnavailable !== false)
    .map((r) => ({
      unitId: r.facts.unit.id,
      number: r.facts.unit.number,
      name: r.facts.unit.name,
      unitTypeId: r.facts.unit.unitTypeId,
      location: { building: r.facts.unit.building, floor: r.facts.unit.floor, zone: r.facts.unit.zone },
      features: r.facts.unit.features,
      assignable: r.assignable,
      score: r.score,
      isComponent: r.facts.isComponent,
      isComposite: r.facts.unit.isComposite,
      compositeUnitIds: r.facts.compositeUnitIds,
      matchedFeatures: r.matchedFeatures,
      missingFeatures: r.missingFeatures,
      exclusions: r.facts.exclusionDetails,
      ranking: r.ranking,
    }));
}
