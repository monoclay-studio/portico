import { sql, type TxContext } from '@portico/db';
import type { DateRange, EntityRef, LocalDate } from '@portico/kernel';
import { rangeContainsNight } from '../domain/ranges';

/** Lightweight unit row used by inventory computations. */
export interface UnitLite {
  id: string;
  propertyId: string;
  unitTypeId: string;
  number: string;
  name: string | null;
  building: string | null;
  floor: string | null;
  zone: string | null;
  features: string[];
  sortOrder: number;
  status: 'active' | 'inactive' | 'retired';
  inInventoryFrom: LocalDate;
  inInventoryTo: LocalDate | null;
  isComposite: boolean;
}

interface UnitSqlRow {
  id: string;
  property_id: string;
  unit_type_id: string;
  number: string;
  name: string | null;
  building: string | null;
  floor: string | null;
  zone: string | null;
  features: string[];
  sort_order: number;
  status: 'active' | 'inactive' | 'retired';
  in_inventory_from: string;
  in_inventory_to: string | null;
  is_composite: boolean;
}

const UNIT_COLUMNS = sql`u.id, u.property_id, u.unit_type_id, u.number, u.name, u.building, u.floor, u.zone, u.features,
  u.sort_order, u.status, u.in_inventory_from::text as in_inventory_from, u.in_inventory_to::text as in_inventory_to,
  u.is_composite`;

function toUnitLite(r: UnitSqlRow): UnitLite {
  return {
    id: r.id,
    propertyId: r.property_id,
    unitTypeId: r.unit_type_id,
    number: r.number,
    name: r.name,
    building: r.building,
    floor: r.floor,
    zone: r.zone,
    features: r.features,
    sortOrder: r.sort_order,
    status: r.status,
    inInventoryFrom: r.in_inventory_from,
    inInventoryTo: r.in_inventory_to,
    isComposite: r.is_composite,
  };
}

export async function loadUnits(
  tx: TxContext,
  filter: { ids?: readonly string[]; unitTypeIds?: readonly string[]; propertyId?: string },
): Promise<UnitLite[]> {
  if ((filter.ids && filter.ids.length === 0) || (filter.unitTypeIds && filter.unitTypeIds.length === 0))
    return [];
  const { rows } = await sql<UnitSqlRow>`
    select ${UNIT_COLUMNS} from inventory.units u
    where true
      ${filter.ids ? sql`and u.id = any(${[...filter.ids]}::uuid[])` : sql``}
      ${filter.unitTypeIds ? sql`and u.unit_type_id = any(${[...filter.unitTypeIds]}::uuid[])` : sql``}
      ${filter.propertyId ? sql`and u.property_id = ${filter.propertyId}` : sql``}
    order by u.sort_order, u.number`.execute(tx.db);
  return rows.map(toUnitLite);
}

/** Lock unit rows in id order (global lock order: unit types → ledger cells → holds → units). */
export async function lockUnits(tx: TxContext, unitIds: readonly string[]): Promise<void> {
  if (unitIds.length === 0) return;
  await sql`select id from inventory.units where id = any(${[...new Set(unitIds)]}::uuid[])
            order by id for no key update`.execute(tx.db);
}

export function unitActiveOn(u: UnitLite, night: LocalDate): boolean {
  return (
    u.status === 'active' &&
    u.inInventoryFrom <= night &&
    (u.inInventoryTo === null || night < u.inInventoryTo)
  );
}

export interface AssignmentRow {
  id: string;
  propertyId: string;
  unitId: string;
  unitTypeId: string;
  ref: EntityRef;
  nights: DateRange;
  locked: boolean;
  lockReason: string | null;
  upgrade: { fromUnitTypeId: string; reason: string; chargeable: boolean } | null;
  parentId: string | null;
  createdBy: string;
  createdAt: Date;
}

interface AssignmentSqlRow {
  id: string;
  property_id: string;
  unit_id: string;
  unit_type_id: string;
  ref_type: string;
  ref_id: string;
  from: string;
  to: string;
  locked: boolean;
  lock_reason: string | null;
  upgrade: AssignmentRow['upgrade'];
  parent_assignment_id: string | null;
  created_by: string;
  created_at: Date;
}

export async function loadAssignments(
  tx: TxContext,
  filter: {
    unitIds?: readonly string[];
    propertyId?: string;
    ref?: EntityRef;
    span?: DateRange;
    topLevelOnly?: boolean;
    forUpdate?: boolean;
  },
): Promise<AssignmentRow[]> {
  if (filter.unitIds && filter.unitIds.length === 0) return [];
  const { rows } = await sql<AssignmentSqlRow>`
    select a.id, a.property_id, a.unit_id, a.unit_type_id, a.ref_type, a.ref_id,
           lower(a.nights)::text as from, upper(a.nights)::text as to, a.locked, a.lock_reason, a.upgrade,
           a.parent_assignment_id, a.created_by, a.created_at
    from inventory.assignments a
    where true
      ${filter.unitIds ? sql`and a.unit_id = any(${[...filter.unitIds]}::uuid[])` : sql``}
      ${filter.propertyId ? sql`and a.property_id = ${filter.propertyId}` : sql``}
      ${filter.ref ? sql`and a.ref_type = ${filter.ref.type} and a.ref_id = ${filter.ref.id}` : sql``}
      ${filter.span ? sql`and a.nights && daterange(${filter.span.from}::date, ${filter.span.to}::date, '[)')` : sql``}
      ${filter.topLevelOnly ? sql`and a.parent_assignment_id is null` : sql``}
    order by lower(a.nights), a.id
    ${filter.forUpdate ? sql`for update` : sql``}`.execute(tx.db);
  return rows.map((r) => ({
    id: r.id,
    propertyId: r.property_id,
    unitId: r.unit_id,
    unitTypeId: r.unit_type_id,
    ref: { type: r.ref_type, id: r.ref_id },
    nights: { from: r.from, to: r.to },
    locked: r.locked,
    lockReason: r.lock_reason,
    upgrade: r.upgrade,
    parentId: r.parent_assignment_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
  }));
}

export interface BlockRow {
  id: string;
  propertyId: string;
  unitId: string;
  unitTypeId: string;
  kind: 'out_of_order' | 'out_of_service' | 'house_use';
  /** Nights in force. */
  nights: DateRange;
  reason: string;
}

export async function loadActiveBlocks(
  tx: TxContext,
  filter: { unitIds?: readonly string[]; propertyId?: string; span: DateRange },
): Promise<BlockRow[]> {
  if (filter.unitIds && filter.unitIds.length === 0) return [];
  const { rows } = await sql<{
    id: string;
    property_id: string;
    unit_id: string;
    unit_type_id: string;
    kind: BlockRow['kind'];
    from: string;
    to: string;
    reason: string;
  }>`
    select b.id, b.property_id, b.unit_id, b.unit_type_id, b.kind,
           lower(b.effective_nights)::text as from, upper(b.effective_nights)::text as to, b.reason
    from inventory.unit_blocks b
    where not isempty(b.effective_nights)
      and b.effective_nights && daterange(${filter.span.from}::date, ${filter.span.to}::date, '[)')
      ${filter.unitIds ? sql`and b.unit_id = any(${[...filter.unitIds]}::uuid[])` : sql``}
      ${filter.propertyId ? sql`and b.property_id = ${filter.propertyId}` : sql``}
    order by lower(b.effective_nights)`.execute(tx.db);
  return rows.map((r) => ({
    id: r.id,
    propertyId: r.property_id,
    unitId: r.unit_id,
    unitTypeId: r.unit_type_id,
    kind: r.kind,
    nights: { from: r.from, to: r.to },
    reason: r.reason,
  }));
}

/** Per-unit index of assignments and blocks for night lookups. */
export class OccupancyIndex {
  private readonly assignments = new Map<string, AssignmentRow[]>();
  private readonly blocks = new Map<string, BlockRow[]>();

  constructor(assignments: readonly AssignmentRow[], blocks: readonly BlockRow[]) {
    for (const a of assignments) {
      const list = this.assignments.get(a.unitId) ?? [];
      list.push(a);
      this.assignments.set(a.unitId, list);
    }
    for (const b of blocks) {
      const list = this.blocks.get(b.unitId) ?? [];
      list.push(b);
      this.blocks.set(b.unitId, list);
    }
  }

  assignmentOn(unitId: string, night: LocalDate, ignoreRef?: EntityRef): AssignmentRow | undefined {
    return this.assignments
      .get(unitId)
      ?.find(
        (a) =>
          rangeContainsNight(a.nights, night) &&
          !(ignoreRef && a.ref.type === ignoreRef.type && a.ref.id === ignoreRef.id),
      );
  }

  blockOn(unitId: string, night: LocalDate): BlockRow | undefined {
    return this.blocks.get(unitId)?.find((b) => rangeContainsNight(b.nights, night));
  }

  assignmentsOf(unitId: string): readonly AssignmentRow[] {
    return this.assignments.get(unitId) ?? [];
  }

  blocksOf(unitId: string): readonly BlockRow[] {
    return this.blocks.get(unitId) ?? [];
  }
}

export async function loadOccupancy(
  tx: TxContext,
  unitIds: readonly string[],
  span: DateRange,
): Promise<OccupancyIndex> {
  const [assignments, blocks] = await Promise.all([
    loadAssignments(tx, { unitIds, span }),
    loadActiveBlocks(tx, { unitIds, span }),
  ]);
  return new OccupancyIndex(assignments, blocks);
}

// ───────────────────────────── Composite structures ─────────────────────────────

export interface CompositeUnitInfo {
  unit: UnitLite;
  components: UnitLite[];
}

export interface CompositeStructure {
  unitTypeId: string;
  /** component unit type id → number of components of that type per composite unit (k_T) */
  perType: Map<string, number>;
  units: CompositeUnitInfo[];
}

export async function loadCompositeStructures(
  tx: TxContext,
  compositeTypeIds: readonly string[],
): Promise<Map<string, CompositeStructure>> {
  const out = new Map<string, CompositeStructure>();
  if (compositeTypeIds.length === 0) return out;
  const composites = await loadUnits(tx, { unitTypeIds: compositeTypeIds });
  const { rows: links } = await sql<{ composite_unit_id: string; component_unit_id: string }>`
    select composite_unit_id, component_unit_id from inventory.composite_components
    where composite_unit_type_id = any(${[...compositeTypeIds]}::uuid[])`.execute(tx.db);
  const components = await loadUnits(tx, { ids: [...new Set(links.map((l) => l.component_unit_id))] });
  const byId = new Map(components.map((u) => [u.id, u]));
  for (const typeId of compositeTypeIds) {
    out.set(typeId, { unitTypeId: typeId, perType: new Map(), units: [] });
  }
  for (const c of composites) {
    const s = out.get(c.unitTypeId);
    if (!s) continue;
    const comps = links
      .filter((l) => l.composite_unit_id === c.id)
      .map((l) => byId.get(l.component_unit_id))
      .filter((u): u is UnitLite => u !== undefined)
      .sort((a, b) => a.id.localeCompare(b.id));
    s.units.push({ unit: c, components: comps });
    if (s.perType.size === 0) {
      for (const comp of comps) s.perType.set(comp.unitTypeId, (s.perType.get(comp.unitTypeId) ?? 0) + 1);
    }
  }
  return out;
}

/** Composite types that contain any of the given units as components. */
export async function compositeTypesContainingUnits(
  tx: TxContext,
  unitIds: readonly string[],
): Promise<string[]> {
  if (unitIds.length === 0) return [];
  const { rows } = await sql<{ id: string }>`
    select distinct composite_unit_type_id as id from inventory.composite_components
    where component_unit_id = any(${[...unitIds]}::uuid[])`.execute(tx.db);
  return rows.map((r) => r.id);
}

/** Composite types that have components of any of the given unit types. */
export async function compositeTypesContainingTypes(
  tx: TxContext,
  unitTypeIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (unitTypeIds.length === 0) return out;
  const { rows } = await sql<{ composite: string; component: string }>`
    select distinct composite_unit_type_id as composite, component_unit_type_id as component
    from inventory.composite_components
    where component_unit_type_id = any(${[...unitTypeIds]}::uuid[])`.execute(tx.db);
  for (const r of rows) out.set(r.component, [...(out.get(r.component) ?? []), r.composite]);
  return out;
}

export interface CompositeNight {
  totalUnits: number;
  freeUnitIds: string[];
  /** Composite units assigned (top-level) on the night. */
  assignedUnits: number;
}

/** A composite unit is free on a night when it and all its components are active, unassigned and unblocked. */
export function compositeNight(
  s: CompositeStructure,
  night: LocalDate,
  occ: OccupancyIndex,
  ignoreRef?: EntityRef,
): CompositeNight {
  let total = 0;
  let assigned = 0;
  const free: string[] = [];
  for (const { unit, components } of s.units) {
    if (!unitActiveOn(unit, night)) continue;
    total++;
    const own = occ.assignmentOn(unit.id, night);
    if (own && own.parentId === null) assigned++;
    const all = [unit, ...components];
    const usable =
      components.every((c) => unitActiveOn(c, night)) &&
      all.every((u) => !occ.assignmentOn(u.id, night, ignoreRef) && !occ.blockOn(u.id, night));
    if (usable) free.push(unit.id);
  }
  return { totalUnits: total, freeUnitIds: free, assignedUnits: assigned };
}
