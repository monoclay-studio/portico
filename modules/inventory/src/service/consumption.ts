import { sql, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  type DateRange,
  type EntityRef,
  type LocalDate,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import { adHocAllowanceNeeded, type ConflictCauseKind, diffConsumption } from '../domain/availability';
import { type CellRef, cellKey, nightsOfRange, nightsToRuns, spanOf } from '../domain/ranges';
import { compareUnitNumbers } from '../domain/ranking';
import { InventoryUnavailableError } from '../errors';
import { INVENTORY_EVENTS } from '../events';
import { INVENTORY_PERMISSIONS } from '../manifest';
import { placeAssignment, type TrimmedAssignment, trimAssignments } from './assignment-store';
import { actorKey, actorName, assertQuantity, assertRef, type Deps, idb, withSavepoint } from './context';
import { LedgerSession, nightsOf, requireType, type TypeInfo } from './ledger';
import {
  type CompositeUnitInfo,
  compositeNight,
  compositeTypesContainingUnits,
  loadAssignments,
  loadOccupancy,
  lockUnits,
} from './occupancy';

export type ConsumptionKind = 'stay' | 'block_allocation' | 'import';

export interface ConsumeInput {
  propertyId: string;
  unitTypeId: string;
  nights: DateRange;
  quantity: number;
  ref: EntityRef;
  /** Sell beyond availability as authorized overbooking (requires inventory.overbooking.authorize). */
  overbooking?: { authorizedBy: string; reason: string };
  /**
   * 'reject' (default): throw InventoryUnavailableError when short. 'record_conflict': commit anyway and record an
   * inventory conflict — only for channel ingestion, imports and administrative restores (INV-R11).
   */
  onShortfall?: 'reject' | 'record_conflict';
  kind?: ConsumptionKind;
  /** Composite types only: the composite unit to assign if it is free. */
  preferUnitId?: string;
}

export interface ConsumeResult {
  /** False when the same consumption already existed (idempotent re-application, INV-R14). */
  applied: boolean;
  nights: LocalDate[];
  overbookingAllowanceIds: string[];
  /** Inventory conflicts opened by this consumption (onShortfall: record_conflict). */
  conflictIds: string[];
  /** Composite types: the composite unit assigned (null for other types or when recorded as a conflict). */
  assignedUnitId: string | null;
}

interface ConsumeNightsArgs {
  propertyId: string;
  type: TypeInfo;
  nights: LocalDate[];
  quantity: number;
  ref: EntityRef;
  kind: ConsumptionKind;
  overbooking: ConsumeInput['overbooking'];
  onShortfall: 'reject' | 'record_conflict';
  preferUnitId?: string;
  causeKind: ConflictCauseKind;
  holdId?: string;
}

/**
 * Consume inventory for a ref (stay, block allocation, import) on every night or none (INV-R10, INV-I05).
 * Authorization: this is a provider call made inside the caller's command (e.g. reservations confirming a booking),
 * so the caller's own permission and data-authority checks apply; inventory does not re-check them.
 */
export async function consume(deps: Deps, tx: TxContext, input: ConsumeInput): Promise<ConsumeResult> {
  const ref = assertRef(input.ref);
  const quantity = assertQuantity(input.quantity);
  const nights = nightsOfRange(input.nights);
  const type = await requireType(tx, input.unitTypeId, input.propertyId);
  if (type.status === 'archived') {
    throw new BusinessRuleError(
      'unit_type_archived',
      `${type.name} is archived and can no longer be sold. Choose another unit type.`,
      { unitTypeId: type.id },
    );
  }
  return consumeNights(deps, tx, {
    propertyId: input.propertyId,
    type,
    nights,
    quantity,
    ref,
    kind: input.kind ?? 'stay',
    overbooking: input.overbooking,
    onShortfall: input.onShortfall ?? 'reject',
    ...(input.preferUnitId ? { preferUnitId: input.preferUnitId } : {}),
    causeKind: 'consumption',
  });
}

export async function consumeNights(deps: Deps, tx: TxContext, a: ConsumeNightsArgs): Promise<ConsumeResult> {
  void deps;
  const session = await LedgerSession.open(
    tx,
    a.propertyId,
    a.nights.map((night) => ({ unitTypeId: a.type.id, night })),
  );
  const existing = await idb(tx)
    .selectFrom('inventory.consumptions')
    .select(['night', 'quantity'])
    .where('ref_type', '=', a.ref.type)
    .where('ref_id', '=', a.ref.id)
    .where('unit_type_id', '=', a.type.id)
    .where('night', 'in', a.nights)
    .execute();
  const mismatch = existing.find((e) => e.quantity !== a.quantity);
  if (mismatch) {
    throw new ConflictError(
      'consumption_mismatch',
      `${a.ref.type} ${a.ref.id} already consumes ${mismatch.quantity} ${a.type.name} on ${mismatch.night}. Use changeConsumption to change quantities or dates.`,
      { ref: a.ref, unitTypeId: a.type.id, night: mismatch.night, existingQuantity: mismatch.quantity },
    );
  }
  const already = new Set(existing.map((e) => e.night));
  const nights = a.nights.filter((n) => !already.has(n));
  const empty: ConsumeResult = {
    applied: false,
    nights: [],
    overbookingAllowanceIds: [],
    conflictIds: [],
    assignedUnitId: null,
  };
  if (nights.length === 0) return empty;
  if (a.type.isComposite) return consumeComposite(tx, session, a, nights);

  const short = nights
    .map((night) => ({ date: night, available: session.available(a.type.id, night) }))
    .filter((s) => s.available < a.quantity);
  const allowanceByNight = new Map<LocalDate, string>();
  if (short.length > 0) {
    if (a.overbooking) {
      requirePermission(tx, INVENTORY_PERMISSIONS.overbookingAuthorize, { propertyId: a.propertyId });
      const reason = a.overbooking.reason?.trim() ?? '';
      if (reason.length < 3 || !a.overbooking.authorizedBy) {
        throw new ValidationError(
          'overbooking_reason_required',
          'Authorized overbooking needs who authorized it and why (at least a few words).',
        );
      }
      for (const s of short) {
        const id = newId();
        const quantity = adHocAllowanceNeeded(s.available, a.quantity);
        await idb(tx)
          .insertInto('inventory.overbooking_allowances')
          .values({
            id,
            tenant_id: tx.tenantId,
            property_id: a.propertyId,
            unit_type_id: a.type.id,
            night: s.date,
            quantity,
            kind: 'ad_hoc',
            reason,
            authorized_by: a.overbooking.authorizedBy,
            entered_by: actorKey(tx),
            ref_type: a.ref.type,
            ref_id: a.ref.id,
            expires_at: null,
            created_at: tx.now,
            closed_at: null,
          })
          .execute();
        session.adjust(a.type.id, s.date, { overbookingAllowance: quantity });
        allowanceByNight.set(s.date, id);
      }
    } else if (a.onShortfall !== 'record_conflict') {
      throw new InventoryUnavailableError({
        unitTypeId: a.type.id,
        unitTypeName: a.type.name,
        requested: a.quantity,
        shortNights: short,
      });
    }
  }

  for (const night of nights) session.adjust(a.type.id, night, { sold: a.quantity });
  await idb(tx)
    .insertInto('inventory.consumptions')
    .values(
      nights.map((night) => ({
        id: newId(),
        tenant_id: tx.tenantId,
        property_id: a.propertyId,
        ref_type: a.ref.type,
        ref_id: a.ref.id,
        unit_type_id: a.type.id,
        night,
        quantity: a.quantity,
        kind: a.kind,
        parent_unit_type_id: null,
        hold_id: a.holdId ?? null,
        overbooking_allowance_id: allowanceByNight.get(night) ?? null,
        created_at: tx.now,
      })),
    )
    .execute();
  const conflicts = await session.finish({ kind: a.causeKind, ref: a.ref });

  if (allowanceByNight.size > 0) {
    const nightsOver = [...allowanceByNight.keys()].sort();
    await tx.audit({
      action: 'inventory.overbooking.authorizeForSale',
      target: { type: a.ref.type, id: a.ref.id },
      propertyId: a.propertyId,
      reason: a.overbooking?.reason ?? null,
      after: { unitTypeId: a.type.id, nights: nightsOver, authorizedBy: a.overbooking?.authorizedBy },
    });
    await tx.emit({
      type: INVENTORY_EVENTS.overbookingAuthorized,
      propertyId: a.propertyId,
      aggregate: { type: 'unitType', id: a.type.id },
      payload: {
        propertyId: a.propertyId,
        unitTypeId: a.type.id,
        nights: nightsOver,
        kind: 'ad_hoc',
        ref: a.ref,
        authorizedBy: a.overbooking?.authorizedBy ?? null,
        reason: a.overbooking?.reason ?? null,
      },
    });
  }
  if (short.length > 0 && a.onShortfall === 'record_conflict' && !a.overbooking) {
    await tx.audit({
      action: 'inventory.consumption.recordedWithConflict',
      target: { type: a.ref.type, id: a.ref.id },
      propertyId: a.propertyId,
      after: { unitTypeId: a.type.id, shortNights: short, conflictIds: conflicts.created },
    });
  }
  return {
    applied: true,
    nights,
    overbookingAllowanceIds: [...allowanceByNight.values()],
    conflictIds: conflicts.created,
    assignedUnitId: null,
  };
}

/** Composite types are sold assignment-first (INV-R06): a specific composite unit is assigned in the same command. */
async function consumeComposite(
  tx: TxContext,
  session: LedgerSession,
  a: ConsumeNightsArgs,
  nights: LocalDate[],
): Promise<ConsumeResult> {
  if (a.quantity !== 1) {
    throw new ValidationError(
      'composite_quantity_one',
      `${a.type.name} is a combined unit and is sold one per stay. Consume each one with its own ref.`,
      { unitTypeId: a.type.id },
    );
  }
  const st = session.composites.get(a.type.id);
  if (!st) throw new Error('inventory: composite structure not loaded');
  const recordConflict = a.onShortfall === 'record_conflict';
  const state = await session.compositeState(a.type.id, nights);
  const short = nights
    .map((night) => ({ date: night, available: state.get(night)?.availability.available ?? 0 }))
    .filter((s) => s.available < 1);
  if (short.length > 0 && !recordConflict) {
    throw new InventoryUnavailableError({
      unitTypeId: a.type.id,
      unitTypeName: a.type.name,
      requested: 1,
      shortNights: short,
      ...(a.overbooking ? { reason: 'composite_overbooking_not_permitted' as const } : {}),
    });
  }

  const chosen = await pickCompositeUnit(tx, session, a.type.id, nights, a.ref, a.preferUnitId);
  const span = spanOf(nights) as DateRange;
  if (!chosen && !recordConflict) {
    throw new InventoryUnavailableError({
      unitTypeId: a.type.id,
      unitTypeName: a.type.name,
      requested: 1,
      shortNights: nights
        .filter((n) => (state.get(n)?.freeUnitIds.length ?? 0) === 0)
        .map((n) => ({ date: n, available: 0 })),
      reason: 'no_single_unit',
    });
  }

  const rows: Array<{
    unitTypeId: string;
    night: LocalDate;
    quantity: number;
    kind: ConsumptionKind | 'composite_component';
    parent: string | null;
  }> = [];
  for (const night of nights) {
    session.adjust(a.type.id, night, { sold: 1 });
    rows.push({ unitTypeId: a.type.id, night, quantity: 1, kind: a.kind, parent: null });
    for (const [t, k] of st.perType) {
      session.adjust(t, night, { sold: k });
      rows.push({ unitTypeId: t, night, quantity: k, kind: 'composite_component', parent: a.type.id });
    }
  }
  await idb(tx)
    .insertInto('inventory.consumptions')
    .values(
      rows.map((r) => ({
        id: newId(),
        tenant_id: tx.tenantId,
        property_id: a.propertyId,
        ref_type: a.ref.type,
        ref_id: a.ref.id,
        unit_type_id: r.unitTypeId,
        night: r.night,
        quantity: r.quantity,
        kind: r.kind,
        parent_unit_type_id: r.parent,
        hold_id: a.holdId ?? null,
        overbooking_allowance_id: null,
        created_at: tx.now,
      })),
    )
    .execute();
  if (chosen) {
    for (const run of nightsToRuns(nights)) {
      await placeAssignment(tx, {
        propertyId: a.propertyId,
        unit: chosen.unit,
        ref: a.ref,
        range: run,
        locked: false,
        lockReason: null,
        upgrade: null,
        createdBy: actorKey(tx),
      });
    }
  }
  session.touchComposite(a.type.id, nights);
  const conflicts = await session.finish({ kind: a.causeKind, ref: a.ref });
  if (chosen) {
    await tx.emit({
      type: INVENTORY_EVENTS.assignmentChanged,
      propertyId: a.propertyId,
      aggregate: { type: a.ref.type, id: a.ref.id },
      payload: {
        propertyId: a.propertyId,
        ref: a.ref,
        change: 'assigned',
        unitId: chosen.unit.id,
        previousUnitIds: [],
        nights: span,
      },
    });
  }
  if (short.length > 0 || !chosen) {
    await tx.audit({
      action: 'inventory.consumption.recordedWithConflict',
      target: { type: a.ref.type, id: a.ref.id },
      propertyId: a.propertyId,
      after: {
        unitTypeId: a.type.id,
        shortNights: short,
        unassigned: !chosen,
        conflictIds: conflicts.created,
      },
    });
  }
  return {
    applied: true,
    nights,
    overbookingAllowanceIds: [],
    conflictIds: conflicts.created,
    assignedUnitId: chosen?.unit.id ?? null,
  };
}

/**
 * Pick a composite unit free on every night (it and all its components unassigned and unblocked), preferring the
 * requested unit and the unit the ref already occupies. Candidate units are locked and re-checked before use.
 */
export async function pickCompositeUnit(
  tx: TxContext,
  session: LedgerSession,
  compositeTypeId: string,
  nights: readonly LocalDate[],
  ref: EntityRef,
  preferUnitId?: string,
): Promise<CompositeUnitInfo | null> {
  const st = session.composites.get(compositeTypeId);
  if (!st) return null;
  const state = await session.compositeState(compositeTypeId, nights);
  const own = await loadAssignments(tx, { ref, topLevelOnly: true });
  const ownUnits = new Set(own.map((x) => x.unitId));
  const candidates = [...st.units].sort(
    (x, y) =>
      rankPreferred(y, preferUnitId, ownUnits) - rankPreferred(x, preferUnitId, ownUnits) ||
      x.unit.sortOrder - y.unit.sortOrder ||
      compareUnitNumbers(x.unit.number, y.unit.number),
  );
  const span = spanOf([...nights]) as DateRange;
  for (const cand of candidates) {
    if (!nights.every((n) => state.get(n)?.freeUnitIds.includes(cand.unit.id))) continue;
    const ids = [cand.unit.id, ...cand.components.map((c) => c.id)];
    await lockUnits(tx, ids);
    const fresh = await loadOccupancy(tx, ids, span);
    const one = { ...st, units: [cand] };
    if (nights.every((n) => compositeNight(one, n, fresh).freeUnitIds.length === 1)) return cand;
  }
  return null;
}

function rankPreferred(c: CompositeUnitInfo, preferUnitId: string | undefined, own: Set<string>): number {
  return (c.unit.id === preferUnitId ? 2 : 0) + (own.has(c.unit.id) ? 1 : 0);
}

// ───────────────────────────── Release ─────────────────────────────

export interface ReleaseInput {
  ref: EntityRef;
  /** Release only these nights; omit to release everything the ref holds (consumption and holds). */
  nights?: DateRange;
}

export interface ReleaseResult {
  releasedCells: Array<{ unitTypeId: string; night: LocalDate; quantity: number }>;
  holdsReleased: string[];
  unassigned: Array<{ unitId: string; nights: DateRange }>;
  conflictsResolved: string[];
}

/** Release all or part of a ref's inventory (cancellation, shortening). Its unit assignments go with it. */
export async function release(deps: Deps, tx: TxContext, input: ReleaseInput): Promise<ReleaseResult> {
  const ref = assertRef(input.ref);
  const range = input.nights ? toRange(nightsOfRange(input.nights)) : null;
  return releaseInternal(deps, tx, ref, { range, cells: null, includeHolds: range === null }, 'release');
}

interface ReleaseSelector {
  range: DateRange | null;
  /** Specific (unit type, night) cells to release (changeConsumption). */
  cells: CellRef[] | null;
  includeHolds: boolean;
}

async function releaseInternal(
  _deps: Deps,
  tx: TxContext,
  ref: EntityRef,
  sel: ReleaseSelector,
  causeKind: ConflictCauseKind,
): Promise<ReleaseResult> {
  const cellKeys = sel.cells ? new Set(sel.cells.map((c) => cellKey(c.unitTypeId, c.night))) : null;
  const inScope = (unitTypeId: string, night: LocalDate, parent?: string | null) =>
    cellKeys
      ? cellKeys.has(cellKey(unitTypeId, night)) || (parent ? cellKeys.has(cellKey(parent, night)) : false)
      : !sel.range || (night >= sel.range.from && night < sel.range.to);

  const rows = (
    await idb(tx)
      .selectFrom('inventory.consumptions')
      .select(['id', 'property_id', 'unit_type_id', 'night', 'quantity', 'parent_unit_type_id'])
      .where('ref_type', '=', ref.type)
      .where('ref_id', '=', ref.id)
      .execute()
  ).filter((r) => inScope(r.unit_type_id, r.night, r.parent_unit_type_id));
  const allowances = (
    await idb(tx)
      .selectFrom('inventory.overbooking_allowances')
      .select(['id', 'property_id', 'unit_type_id', 'night', 'quantity'])
      .where('ref_type', '=', ref.type)
      .where('ref_id', '=', ref.id)
      .where('status', '=', 'active')
      .execute()
  ).filter((r) => inScope(r.unit_type_id, r.night));
  const { rows: holds } = sel.includeHolds
    ? await sql<{
        id: string;
        property_id: string;
        unit_type_id: string;
        from: string;
        to: string;
        quantity: number;
        component_quantities: Array<{ unitTypeId: string; quantity: number }>;
      }>`select id, property_id, unit_type_id, lower(nights)::text as from, upper(nights)::text as to, quantity,
                component_quantities
         from inventory.holds where ref_type = ${ref.type} and ref_id = ${ref.id} and status = 'active'`.execute(
        tx.db,
      )
    : { rows: [] };

  // Assignments that will be trimmed, and composite types whose free units change as a result.
  const trimPlan = sel.cells
    ? runsByType(sel.cells)
    : [{ unitTypeId: null as string | null, range: sel.range }];
  const assignments = (await loadAssignments(tx, { ref, topLevelOnly: true })).filter((x) =>
    trimPlan.some(
      (p) =>
        (p.unitTypeId === null || p.unitTypeId === x.unitTypeId) &&
        (!p.range || (x.nights.from < p.range.to && p.range.from < x.nights.to)),
    ),
  );
  const empty: ReleaseResult = {
    releasedCells: [],
    holdsReleased: [],
    unassigned: [],
    conflictsResolved: [],
  };
  if (rows.length === 0 && holds.length === 0 && allowances.length === 0 && assignments.length === 0)
    return empty;

  const propertyIds = new Set([
    ...rows.map((r) => r.property_id),
    ...holds.map((h) => h.property_id),
    ...assignments.map((x) => x.propertyId),
  ]);
  const result: ReleaseResult = {
    releasedCells: [],
    holdsReleased: [],
    unassigned: [],
    conflictsResolved: [],
  };
  for (const propertyId of [...propertyIds].sort()) {
    const pRows = rows.filter((r) => r.property_id === propertyId);
    const pHolds = holds.filter((h) => h.property_id === propertyId);
    const pAllow = allowances.filter((x) => x.property_id === propertyId);
    const pAssign = assignments.filter((x) => x.propertyId === propertyId);
    const touchedComposite: CellRef[] = [];
    for (const x of pAssign) {
      const types = await compositeTypesContainingUnits(tx, [x.unitId]);
      for (const t of types)
        for (const n of nightsOf(x.nights.from, x.nights.to))
          touchedComposite.push({ unitTypeId: t, night: n });
    }
    const targets: CellRef[] = [
      ...pRows.map((r) => ({ unitTypeId: r.unit_type_id, night: r.night })),
      ...pAllow.map((r) => ({ unitTypeId: r.unit_type_id, night: r.night })),
      ...pHolds.flatMap((h) =>
        [h.unit_type_id, ...h.component_quantities.map((c) => c.unitTypeId)].flatMap((t) =>
          nightsOf(h.from, h.to).map((n) => ({ unitTypeId: t, night: n })),
        ),
      ),
      ...touchedComposite,
    ];
    const session = await LedgerSession.open(tx, propertyId, targets);
    for (const r of pRows) session.adjust(r.unit_type_id, r.night, { sold: -r.quantity });
    if (pRows.length > 0) {
      await idb(tx)
        .deleteFrom('inventory.consumptions')
        .where(
          'id',
          'in',
          pRows.map((r) => r.id),
        )
        .execute();
    }
    for (const x of pAllow) {
      session.adjust(x.unit_type_id, x.night, { overbookingAllowance: -x.quantity });
      await idb(tx)
        .updateTable('inventory.overbooking_allowances')
        .set({ status: 'revoked', closed_at: tx.now })
        .where('id', '=', x.id)
        .execute();
    }
    for (const h of pHolds) {
      const nights = nightsOf(h.from, h.to);
      for (const n of nights) {
        session.adjust(h.unit_type_id, n, { held: -h.quantity });
        for (const c of h.component_quantities) session.adjust(c.unitTypeId, n, { held: -c.quantity });
      }
      await sql`update inventory.holds set status = 'released', closed_at = ${tx.now},
                  close_reason = ${'Released with its ref'}, version = version + 1 where id = ${h.id}`.execute(
        tx.db,
      );
      result.holdsReleased.push(h.id);
    }
    let trimmed: TrimmedAssignment[] = [];
    if (pAssign.length > 0) {
      for (const p of trimPlan) {
        trimmed = trimmed.concat(
          await trimAssignments(tx, ref, p.range, p.unitTypeId ? { unitTypeIds: [p.unitTypeId] } : {}),
        );
      }
    }
    for (const c of touchedComposite) session.touchComposite(c.unitTypeId, [c.night]);
    const conflicts = await session.finish({ kind: causeKind, ref });
    result.conflictsResolved.push(...conflicts.resolved);
    result.releasedCells.push(
      ...pRows.map((r) => ({ unitTypeId: r.unit_type_id, night: r.night, quantity: r.quantity })),
    );
    for (const t of trimmed) {
      result.unassigned.push({ unitId: t.assignment.unitId, nights: t.removed });
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
  }
  return result;
}

function runsByType(
  cells: readonly CellRef[],
): Array<{ unitTypeId: string | null; range: DateRange | null }> {
  const byType = new Map<string, LocalDate[]>();
  for (const c of cells) byType.set(c.unitTypeId, [...(byType.get(c.unitTypeId) ?? []), c.night]);
  return [...byType].flatMap(([t, nights]) =>
    nightsToRuns(nights).map((range) => ({ unitTypeId: t, range })),
  );
}

function toRange(nights: LocalDate[]): DateRange {
  return spanOf(nights) as DateRange;
}

// ───────────────────────────── Change ─────────────────────────────

export interface ChangeConsumptionInput {
  ref: EntityRef;
  from: { unitTypeId: string; nights: DateRange };
  to: { unitTypeId: string; nights: DateRange; quantity?: number };
  overbooking?: ConsumeInput['overbooking'];
  onShortfall?: 'reject' | 'record_conflict';
  /** Why: drives the resolution recorded on conflicts this change resolves. */
  reason?: 'dates' | 'unit_type' | 'upgrade' | 'relocation';
  /** Composite target types: the composite unit to assign if free (default: the one the ref occupies). */
  preferUnitId?: string;
}

export interface ChangeConsumptionResult {
  changed: boolean;
  added: Array<{ unitTypeId: string; night: LocalDate; quantity: number }>;
  removed: Array<{ unitTypeId: string; night: LocalDate; quantity: number }>;
  kept: Array<{ unitTypeId: string; night: LocalDate; quantity: number }>;
  conflictIds: string[];
  assignedUnitId: string | null;
}

/**
 * Atomically move a ref's consumption between unit types and/or dates (INV-R12): unchanged nights are kept (with
 * their unit assignment), removed nights are released, new nights are consumed under the same guards as `consume`.
 * If any new night is short, nothing changes and the original consumption stays intact (savepoint), even when the
 * caller catches the error and continues its transaction.
 */
export async function changeConsumption(
  deps: Deps,
  tx: TxContext,
  input: ChangeConsumptionInput,
): Promise<ChangeConsumptionResult> {
  const ref = assertRef(input.ref);
  const fromNights = nightsOfRange(input.from.nights, undefined, 'from.nights');
  const toNights = nightsOfRange(input.to.nights, undefined, 'to.nights');
  const fromType = await requireType(tx, input.from.unitTypeId);
  const toType = await requireType(tx, input.to.unitTypeId, fromType.propertyId);
  if (toType.status === 'archived' && toType.id !== fromType.id) {
    throw new BusinessRuleError(
      'unit_type_archived',
      `${toType.name} is archived and can no longer be sold.`,
    );
  }
  const current = await idb(tx)
    .selectFrom('inventory.consumptions')
    .select(['unit_type_id', 'night', 'quantity', 'kind'])
    .where('ref_type', '=', ref.type)
    .where('ref_id', '=', ref.id)
    .where('unit_type_id', '=', fromType.id)
    .where('night', 'in', fromNights)
    .where('kind', '<>', 'composite_component')
    .execute();
  if (current.length !== fromNights.length) {
    const have = new Set(current.map((c) => c.night));
    throw new BusinessRuleError(
      'consumption_not_found',
      `${ref.type} ${ref.id} does not consume ${fromType.name} on ${fromNights.filter((n) => !have.has(n)).join(', ')}. Check the current booking before changing it.`,
      { ref, unitTypeId: fromType.id },
    );
  }
  const quantities = new Set(current.map((c) => c.quantity));
  if (quantities.size !== 1) {
    throw new BusinessRuleError(
      'consumption_quantity_varies',
      'The quantity differs between nights of this range; change the nights in separate steps.',
    );
  }
  const q = [...quantities][0] as number;
  const kind = (current[0]?.kind ?? 'stay') as ConsumptionKind;
  const toQuantity = input.to.quantity === undefined ? q : assertQuantity(input.to.quantity);
  const diff = diffConsumption(
    current.map((c) => ({ unitTypeId: c.unit_type_id, night: c.night, quantity: c.quantity })),
    toNights.map((night) => ({ unitTypeId: toType.id, night, quantity: toQuantity })),
  );
  const result: ChangeConsumptionResult = {
    changed: diff.add.length > 0 || diff.remove.length > 0,
    added: diff.add,
    removed: diff.remove,
    kept: diff.keep,
    conflictIds: [],
    assignedUnitId: null,
  };
  if (!result.changed) return result;

  const causeKind: ConflictCauseKind =
    input.reason === 'upgrade'
      ? 'upgrade'
      : input.reason === 'relocation'
        ? 'assignment'
        : 'consumption_change';
  // Lock every affected cell up front, in global order, so the release and consume steps cannot deadlock with
  // another change moving inventory the other way.
  const own = await loadAssignments(tx, { ref, topLevelOnly: true });
  const compositeCells: CellRef[] = [];
  for (const x of own) {
    for (const t of await compositeTypesContainingUnits(tx, [x.unitId]))
      for (const n of nightsOf(x.nights.from, x.nights.to)) compositeCells.push({ unitTypeId: t, night: n });
  }
  await LedgerSession.open(tx, fromType.propertyId, [
    ...diff.remove.map((c) => ({ unitTypeId: c.unitTypeId, night: c.night })),
    ...diff.add.map((c) => ({ unitTypeId: c.unitTypeId, night: c.night })),
    ...compositeCells,
  ]);
  const preferUnitId =
    input.preferUnitId ??
    (toType.isComposite ? own.find((x) => x.unitTypeId === toType.id)?.unitId : undefined);

  return withSavepoint(tx, 'inv_change_consumption', async () => {
    if (diff.remove.length > 0) {
      await releaseInternal(
        deps,
        tx,
        ref,
        {
          range: null,
          cells: diff.remove.map((c) => ({ unitTypeId: c.unitTypeId, night: c.night })),
          includeHolds: false,
        },
        causeKind,
      );
    }
    if (diff.add.length > 0) {
      const consumed = await consumeNights(deps, tx, {
        propertyId: fromType.propertyId,
        type: toType,
        nights: diff.add.map((c) => c.night),
        quantity: toQuantity,
        ref,
        kind,
        overbooking: input.overbooking,
        onShortfall: input.onShortfall ?? 'reject',
        ...(preferUnitId ? { preferUnitId } : {}),
        causeKind,
      });
      result.conflictIds = consumed.conflictIds;
      result.assignedUnitId = consumed.assignedUnitId;
    }
    return result;
  });
}

// ───────────────────────────── Transfer ─────────────────────────────

export interface TransferConsumptionInput {
  from: EntityRef;
  to: EntityRef;
  unitTypeId: string;
  nights: DateRange;
  quantity: number;
  kind?: ConsumptionKind;
}

/**
 * Move consumption between refs without changing availability (INV-R13), e.g. a group block allocation picked
 * up by a stay. Composite types are not transferable (they are sold with a specific unit).
 */
export async function transferConsumption(
  _deps: Deps,
  tx: TxContext,
  input: TransferConsumptionInput,
): Promise<{ nights: LocalDate[] }> {
  const from = assertRef(input.from, 'from');
  const to = assertRef(input.to, 'to');
  const quantity = assertQuantity(input.quantity);
  const nights = nightsOfRange(input.nights);
  const type = await requireType(tx, input.unitTypeId);
  if (type.isComposite) {
    throw new BusinessRuleError(
      'composite_not_transferable',
      `${type.name} is sold with a specific unit and cannot be transferred between refs; release and consume instead.`,
    );
  }
  await LedgerSession.open(
    tx,
    type.propertyId,
    nights.map((night) => ({ unitTypeId: type.id, night })),
  );
  const rows = await idb(tx)
    .selectFrom('inventory.consumptions')
    .select(['id', 'night', 'quantity', 'kind'])
    .where('ref_type', '=', from.type)
    .where('ref_id', '=', from.id)
    .where('unit_type_id', '=', type.id)
    .where('night', 'in', nights)
    .execute();
  const byNight = new Map(rows.map((r) => [r.night, r]));
  const missing = nights.filter((n) => (byNight.get(n)?.quantity ?? 0) < quantity);
  if (missing.length > 0) {
    throw new BusinessRuleError(
      'transfer_exceeds_consumption',
      `${from.type} ${from.id} does not hold ${quantity} ${type.name} on ${missing.join(', ')}; nothing was transferred.`,
      { from, unitTypeId: type.id, nights: missing },
    );
  }
  for (const night of nights) {
    const r = byNight.get(night);
    if (!r) continue;
    if (r.quantity === quantity)
      await idb(tx).deleteFrom('inventory.consumptions').where('id', '=', r.id).execute();
    else
      await idb(tx)
        .updateTable('inventory.consumptions')
        .set({ quantity: r.quantity - quantity })
        .where('id', '=', r.id)
        .execute();
    await sql`
      insert into inventory.consumptions (id, tenant_id, property_id, ref_type, ref_id, unit_type_id, night, quantity,
                                          kind, created_at)
      values (${newId()}, ${tx.tenantId}, ${type.propertyId}, ${to.type}, ${to.id}, ${type.id}, ${night}::date,
              ${quantity}, ${input.kind ?? 'stay'}, ${tx.now})
      on conflict (tenant_id, ref_type, ref_id, unit_type_id, night)
      do update set quantity = inventory.consumptions.quantity + excluded.quantity`.execute(tx.db);
  }
  await tx.audit({
    action: 'inventory.consumption.transfer',
    target: { type: to.type, id: to.id },
    propertyId: type.propertyId,
    after: { from, to, unitTypeId: type.id, nights, quantity, by: actorName(tx) },
  });
  return { nights };
}
