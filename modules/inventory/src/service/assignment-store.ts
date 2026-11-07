import { pgCode, sql, type TxContext, withSavepoint } from '@portico/db';
import { addDays, type DateRange, type EntityRef, newId } from '@portico/kernel';
import { earlierDate, intersectRanges, laterDate, subtractRange } from '../domain/ranges';
import { type AssignmentConflictDetail, UnitAssignmentConflictError } from '../errors';
import { type AssignmentRow, loadAssignments, loadUnits, type UnitLite } from './occupancy';

export interface PlaceAssignmentInput {
  propertyId: string;
  unit: UnitLite;
  ref: EntityRef;
  range: DateRange;
  locked: boolean;
  lockReason: string | null;
  upgrade: AssignmentRow['upgrade'];
  createdBy: string;
}

export async function componentsOf(tx: TxContext, compositeUnitId: string): Promise<UnitLite[]> {
  const { rows } = await sql<{ id: string }>`
    select component_unit_id as id from inventory.composite_components
    where composite_unit_id = ${compositeUnitId} order by component_unit_id`.execute(tx.db);
  return loadUnits(tx, { ids: rows.map((r) => r.id) });
}

/** Other refs' assignments on the units over the range — what blocks an assignment. */
export async function assignmentConflicts(
  tx: TxContext,
  units: readonly UnitLite[],
  range: DateRange,
  ref: EntityRef,
): Promise<AssignmentConflictDetail[]> {
  const byId = new Map(units.map((u) => [u.id, u]));
  const rows = await loadAssignments(tx, { unitIds: units.map((u) => u.id), span: range });
  return rows
    .filter((a) => !(a.ref.type === ref.type && a.ref.id === ref.id))
    .map((a) => ({
      ref: a.ref,
      unitId: a.unitId,
      unitNumber: byId.get(a.unitId)?.number ?? a.unitId,
      nights: intersectRanges(a.nights, range) ?? a.nights,
    }));
}

async function insertRows(
  tx: TxContext,
  input: PlaceAssignmentInput,
  components: readonly UnitLite[],
  range: DateRange,
): Promise<string> {
  const parentId = newId();
  const rows = [
    { id: parentId, unit: input.unit, parent: null as string | null },
    ...components.map((c) => ({ id: newId(), unit: c, parent: parentId as string | null })),
  ];
  for (const r of rows) {
    await sql`
      insert into inventory.assignments (id, tenant_id, property_id, unit_id, unit_type_id, ref_type, ref_id, nights,
                                         locked, lock_reason, upgrade, parent_assignment_id, created_by, created_at)
      values (${r.id}, ${tx.tenantId}, ${input.propertyId}, ${r.unit.id}, ${r.unit.unitTypeId}, ${input.ref.type},
              ${input.ref.id}, daterange(${range.from}::date, ${range.to}::date, '[)'), ${input.locked},
              ${input.lockReason}, ${input.upgrade ? JSON.stringify(input.upgrade) : null}::jsonb, ${r.parent},
              ${input.createdBy}, ${tx.now})`.execute(tx.db);
  }
  return parentId;
}

/**
 * Insert a (top-level) assignment and, for composite units, one child row per component with the same ref and
 * nights (INV-I06). Adjacent assignments of the same ref to the same unit are merged, so an extension keeps one
 * continuous assignment. The exclusion constraints are the final guarantee; a violation is reported as
 * UnitAssignmentConflictError with the conflicting refs.
 */
export async function placeAssignment(tx: TxContext, input: PlaceAssignmentInput): Promise<string> {
  const components = input.unit.isComposite ? await componentsOf(tx, input.unit.id) : [];
  let range = { ...input.range };
  const adjacent = (
    await loadAssignments(tx, {
      ref: input.ref,
      unitIds: [input.unit.id],
      topLevelOnly: true,
      span: { from: addDays(range.from, -1), to: addDays(range.to, 1) },
      forUpdate: true,
    })
  ).filter(
    (a) =>
      (a.nights.to === range.from || a.nights.from === range.to) &&
      a.locked === input.locked &&
      JSON.stringify(a.upgrade) === JSON.stringify(input.upgrade),
  );
  for (const a of adjacent) {
    range = {
      from: earlierDate(a.nights.from, range.from),
      to: laterDate(a.nights.to, range.to),
    };
    await sql`delete from inventory.assignments where id = ${a.id}`.execute(tx.db);
  }
  try {
    return await withSavepoint(tx, 'inv_assign', () => insertRows(tx, input, components, range));
  } catch (err) {
    if (pgCode(err) !== '23P01') throw err;
    const conflicts = await assignmentConflicts(tx, [input.unit, ...components], range, input.ref);
    throw new UnitAssignmentConflictError(input.unit.number, conflicts);
  }
}

export interface TrimmedAssignment {
  assignment: AssignmentRow;
  /** The part removed from the assignment. */
  removed: DateRange;
}

/**
 * Remove a ref's top-level assignments (and their component rows) for the given nights, or entirely when `range`
 * is null. Parts outside the range are kept with the same unit and attributes.
 */
export async function trimAssignments(
  tx: TxContext,
  ref: EntityRef,
  range: DateRange | null,
  filter: { unitTypeIds?: readonly string[] } = {},
): Promise<TrimmedAssignment[]> {
  let rows = await loadAssignments(tx, {
    ref,
    topLevelOnly: true,
    ...(range ? { span: range } : {}),
    forUpdate: true,
  });
  if (filter.unitTypeIds) rows = rows.filter((a) => filter.unitTypeIds?.includes(a.unitTypeId));
  const out: TrimmedAssignment[] = [];
  for (const a of rows) {
    const removed = range ? intersectRanges(a.nights, range) : a.nights;
    if (!removed) continue;
    await sql`delete from inventory.assignments where id = ${a.id}`.execute(tx.db);
    const keep = range ? subtractRange(a.nights, range) : [];
    if (keep.length > 0) {
      const [unit] = await loadUnits(tx, { ids: [a.unitId] });
      if (unit) {
        const components = unit.isComposite ? await componentsOf(tx, unit.id) : [];
        for (const k of keep) {
          await insertRows(
            tx,
            {
              propertyId: a.propertyId,
              unit,
              ref: a.ref,
              range: k,
              locked: a.locked,
              lockReason: a.lockReason,
              upgrade: a.upgrade,
              createdBy: a.createdBy,
            },
            components,
            k,
          );
        }
      }
    }
    out.push({ assignment: a, removed });
  }
  return out;
}
