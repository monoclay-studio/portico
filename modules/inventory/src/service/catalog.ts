import {
  explainVersionMiss,
  pgCode,
  pgConstraint,
  type Selectable,
  sql,
  type TxContext,
  withSavepoint,
} from '@portico/db';
import {
  addDays,
  BusinessRuleError,
  ConflictError,
  type LocalDate,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type {
  CompositeUnitInput,
  Feature,
  FeatureInput,
  Unit,
  UnitInput,
  UnitType,
  UnitTypeInput,
  UnitTypeUpdate,
  UnitUpdate,
} from '../contracts';
import { INVENTORY_EVENTS } from '../events';
import { INVENTORY_PERMISSIONS } from '../manifest';
import type { FeaturesTable, UnitsTable, UnitTypesTable } from '../tables';
import {
  assertUuid,
  type ChangeOrigin,
  DEFAULT_NOUNS,
  type Deps,
  guardAvailabilityWrite,
  idb,
  requireAnyPermission,
} from './context';
import { LedgerSession } from './ledger';
import { loadAssignments, loadCompositeStructures, loadUnits } from './occupancy';

type Row<T> = Selectable<T>;

const READ_PERMISSIONS = [
  INVENTORY_PERMISSIONS.unitRead,
  INVENTORY_PERMISSIONS.availabilityRead,
  INVENTORY_PERMISSIONS.assignmentManage,
] as const;

// ───────────────────────────── Features ─────────────────────────────

function toFeature(r: Row<FeaturesTable>): Feature {
  return {
    id: r.id,
    propertyId: r.property_id,
    code: r.code,
    name: r.name,
    category: r.category,
    description: r.description,
    status: r.status,
    version: r.version,
  };
}

export async function createFeature(
  deps: Deps,
  tx: TxContext,
  propertyId: string,
  input: FeatureInput,
  opts: { origin?: ChangeOrigin } = {},
): Promise<Feature> {
  requirePermission(tx, INVENTORY_PERMISSIONS.unitTypeManage, { propertyId });
  await deps.ports.platform.getBusinessDate(tx, propertyId);
  await guardAvailabilityWrite(tx, deps, propertyId, opts.origin);
  try {
    const row = await idb(tx)
      .insertInto('inventory.features')
      .values({
        id: newId(),
        tenant_id: tx.tenantId,
        property_id: propertyId,
        code: input.code,
        name: input.name,
        category: input.category ?? 'general',
        description: input.description ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx.audit({
      action: 'inventory.feature.create',
      target: { type: 'unitFeature', id: row.id },
      propertyId,
      after: input,
    });
    return toFeature(row);
  } catch (err) {
    if (pgCode(err) === '23505') {
      throw new ConflictError(
        'feature_code_taken',
        `A feature with code "${input.code}" already exists at this property.`,
      );
    }
    throw err;
  }
}

export async function updateFeature(
  deps: Deps,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  patch: {
    name?: string;
    category?: Feature['category'];
    description?: string | null;
    status?: Feature['status'];
  },
): Promise<Feature> {
  assertUuid(id, 'unit_feature');
  const before = await idb(tx)
    .selectFrom('inventory.features')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('unit_feature', id);
  requirePermission(tx, INVENTORY_PERMISSIONS.unitTypeManage, { propertyId: before.property_id });
  await guardAvailabilityWrite(tx, deps, before.property_id);
  const row = await idb(tx)
    .updateTable('inventory.features')
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updated_at: tx.now,
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) return explainVersionMiss('unit_feature', id, expectedVersion, async () => before.version);
  await tx.audit({
    action: 'inventory.feature.update',
    target: { type: 'unitFeature', id },
    propertyId: before.property_id,
    before: toFeature(before),
    after: toFeature(row),
  });
  return toFeature(row);
}

export async function listFeatures(
  tx: TxContext,
  propertyId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<Feature[]> {
  requireAnyPermission(tx, READ_PERMISSIONS, propertyId);
  let q = idb(tx).selectFrom('inventory.features').selectAll().where('property_id', '=', propertyId);
  if (!opts.includeArchived) q = q.where('status', '=', 'active');
  const rows = await q.orderBy('category').orderBy('name').execute();
  return rows.map(toFeature);
}

async function assertFeatures(
  tx: TxContext,
  propertyId: string,
  codes: readonly string[] | undefined,
): Promise<void> {
  if (!codes || codes.length === 0) return;
  const unique = [...new Set(codes)];
  const known = await idb(tx)
    .selectFrom('inventory.features')
    .select('code')
    .where('property_id', '=', propertyId)
    .where('status', '=', 'active')
    .where('code', 'in', unique)
    .execute();
  const have = new Set(known.map((k) => k.code));
  const missing = unique.filter((c) => !have.has(c));
  if (missing.length > 0) {
    throw new ValidationError(
      'unknown_feature',
      `These features are not in the property's feature catalog: ${missing.join(', ')}. Add them to the catalog first.`,
      { missing },
    );
  }
}

// ───────────────────────────── Unit types ─────────────────────────────

async function toUnitTypes(tx: TxContext, rows: ReadonlyArray<Row<UnitTypesTable>>): Promise<UnitType[]> {
  const structures = await loadCompositeStructures(
    tx,
    rows.filter((r) => r.is_composite).map((r) => r.id),
  );
  return rows.map((r) => {
    const st = structures.get(r.id);
    return {
      id: r.id,
      propertyId: r.property_id,
      code: r.code,
      name: r.name,
      kind: r.kind,
      noun: r.noun,
      description: r.description,
      baseOccupancy: r.base_occupancy,
      maxAdults: r.max_adults,
      maxChildren: r.max_children,
      maxOccupancy: r.max_occupancy,
      bedding: r.bedding,
      sizeSqm: r.size_sqm,
      rank: r.rank,
      sortOrder: r.sort_order,
      sellable: r.sellable,
      isComposite: r.is_composite,
      features: r.features,
      status: r.status,
      composition: r.is_composite
        ? [...(st?.perType ?? new Map<string, number>())].map(([unitTypeId, perComposite]) => ({
            unitTypeId,
            perComposite,
          }))
        : null,
      version: r.version,
    };
  });
}

function occupancyError(err: unknown): never {
  if (pgCode(err) === '23514') {
    throw new ValidationError(
      'invalid_occupancy',
      'Occupancy limits do not fit together: base occupancy, max adults and max children must each be at most the max occupancy, and the max occupancy at most adults + children.',
      { constraint: pgConstraint(err) },
    );
  }
  throw err;
}

export async function createUnitType(
  deps: Deps,
  tx: TxContext,
  propertyId: string,
  input: UnitTypeInput,
  opts: { origin?: ChangeOrigin } = {},
): Promise<UnitType> {
  requirePermission(tx, INVENTORY_PERMISSIONS.unitTypeManage, { propertyId });
  await deps.ports.platform.getBusinessDate(tx, propertyId);
  await guardAvailabilityWrite(tx, deps, propertyId, opts.origin);
  await assertFeatures(tx, propertyId, input.features);
  const id = newId();
  let row: Row<UnitTypesTable>;
  try {
    row = await idb(tx)
      .insertInto('inventory.unit_types')
      .values({
        id,
        tenant_id: tx.tenantId,
        property_id: propertyId,
        code: input.code,
        name: input.name,
        kind: input.kind,
        noun: input.noun ?? DEFAULT_NOUNS[input.kind] ?? 'Unit',
        description: input.description ?? null,
        base_occupancy: input.baseOccupancy,
        max_adults: input.maxAdults,
        max_children: input.maxChildren,
        max_occupancy: input.maxOccupancy,
        bedding: input.bedding ?? null,
        size_sqm: input.sizeSqm ?? null,
        rank: input.rank ?? 0,
        sort_order: input.sortOrder ?? 0,
        sellable: input.sellable ?? true,
        is_composite: input.isComposite ?? false,
        features: [...new Set(input.features ?? [])],
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (err) {
    if (pgCode(err) === '23505') {
      throw new ConflictError(
        'unit_type_code_taken',
        `Unit type code ${input.code} is already used at this property.`,
      );
    }
    occupancyError(err);
  }
  const [dto] = await toUnitTypes(tx, [row]);
  await tx.audit({
    action: 'inventory.unitType.create',
    target: { type: 'unitType', id },
    propertyId,
    after: dto,
  });
  await tx.emit({
    type: INVENTORY_EVENTS.unitTypeChanged,
    propertyId,
    aggregate: { type: 'unitType', id },
    aggregateVersion: row.version,
    payload: { propertyId, unitTypeId: id, change: 'created' },
  });
  return dto as UnitType;
}

export async function getUnitType(tx: TxContext, id: string): Promise<UnitType> {
  assertUuid(id, 'unit_type');
  const row = await idb(tx)
    .selectFrom('inventory.unit_types')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('unit_type', id);
  requireAnyPermission(tx, READ_PERMISSIONS, row.property_id);
  const [dto] = await toUnitTypes(tx, [row]);
  return dto as UnitType;
}

export async function listUnitTypes(
  tx: TxContext,
  propertyId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<UnitType[]> {
  requireAnyPermission(tx, READ_PERMISSIONS, propertyId);
  let q = idb(tx).selectFrom('inventory.unit_types').selectAll().where('property_id', '=', propertyId);
  if (!opts.includeArchived) q = q.where('status', '=', 'active');
  const rows = await q.orderBy('sort_order').orderBy('rank').orderBy('code').execute();
  return toUnitTypes(tx, rows);
}

export async function updateUnitType(
  deps: Deps,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  patch: UnitTypeUpdate,
  opts: { origin?: ChangeOrigin } = {},
): Promise<UnitType> {
  assertUuid(id, 'unit_type');
  const before = await idb(tx)
    .selectFrom('inventory.unit_types')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('unit_type', id);
  requirePermission(tx, INVENTORY_PERMISSIONS.unitTypeManage, { propertyId: before.property_id });
  await guardAvailabilityWrite(tx, deps, before.property_id, opts.origin);
  await assertFeatures(tx, before.property_id, patch.features);
  if (patch.status === 'archived' && before.status !== 'archived') {
    const live = await idb(tx)
      .selectFrom('inventory.units')
      .select('id')
      .where('unit_type_id', '=', id)
      .where('status', '<>', 'retired')
      .executeTakeFirst();
    if (live) {
      throw new BusinessRuleError(
        'unit_type_has_units',
        `${before.name} still has units. Retire or re-home its units before archiving the type.`,
      );
    }
  }
  let row: Row<UnitTypesTable> | undefined;
  try {
    row = await idb(tx)
      .updateTable('inventory.unit_types')
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.noun !== undefined ? { noun: patch.noun } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.baseOccupancy !== undefined ? { base_occupancy: patch.baseOccupancy } : {}),
        ...(patch.maxAdults !== undefined ? { max_adults: patch.maxAdults } : {}),
        ...(patch.maxChildren !== undefined ? { max_children: patch.maxChildren } : {}),
        ...(patch.maxOccupancy !== undefined ? { max_occupancy: patch.maxOccupancy } : {}),
        ...(patch.bedding !== undefined ? { bedding: patch.bedding } : {}),
        ...(patch.sizeSqm !== undefined ? { size_sqm: patch.sizeSqm } : {}),
        ...(patch.rank !== undefined ? { rank: patch.rank } : {}),
        ...(patch.sortOrder !== undefined ? { sort_order: patch.sortOrder } : {}),
        ...(patch.sellable !== undefined ? { sellable: patch.sellable } : {}),
        ...(patch.features !== undefined ? { features: [...new Set(patch.features)] } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        updated_at: tx.now,
        version: sql`version + 1`,
      })
      .where('id', '=', id)
      .where('version', '=', expectedVersion)
      .returningAll()
      .executeTakeFirst();
  } catch (err) {
    occupancyError(err);
  }
  if (!row) return explainVersionMiss('unit_type', id, expectedVersion, async () => before.version);
  const [beforeDto] = await toUnitTypes(tx, [before]);
  const [dto] = await toUnitTypes(tx, [row]);
  await tx.audit({
    action: 'inventory.unitType.update',
    target: { type: 'unitType', id },
    propertyId: before.property_id,
    before: beforeDto,
    after: dto,
  });
  await tx.emit({
    type: INVENTORY_EVENTS.unitTypeChanged,
    propertyId: before.property_id,
    aggregate: { type: 'unitType', id },
    aggregateVersion: row.version,
    payload: { propertyId: before.property_id, unitTypeId: id, change: 'updated' },
  });
  return dto as UnitType;
}

// ───────────────────────────── Units ─────────────────────────────

async function toUnits(tx: TxContext, rows: ReadonlyArray<Row<UnitsTable>>): Promise<Unit[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const { rows: links } = await sql<{ composite_unit_id: string; component_unit_id: string }>`
    select composite_unit_id, component_unit_id from inventory.composite_components
    where composite_unit_id = any(${ids}::uuid[]) or component_unit_id = any(${ids}::uuid[])
    order by component_unit_id`.execute(tx.db);
  return rows.map((r) => ({
    id: r.id,
    propertyId: r.property_id,
    unitTypeId: r.unit_type_id,
    number: r.number,
    name: r.name,
    location: { building: r.building, floor: r.floor, zone: r.zone },
    features: r.features,
    maxOccupancyOverride: r.max_occupancy_override,
    sortOrder: r.sort_order,
    status: r.status,
    inInventoryFrom: r.in_inventory_from,
    inInventoryTo: r.in_inventory_to,
    isComposite: r.is_composite,
    componentUnitIds: links.filter((l) => l.composite_unit_id === r.id).map((l) => l.component_unit_id),
    memberOfCompositeUnitIds: links
      .filter((l) => l.component_unit_id === r.id)
      .map((l) => l.composite_unit_id),
    notes: r.notes,
    version: r.version,
  }));
}

async function loadUnitRow(tx: TxContext, id: string): Promise<Row<UnitsTable>> {
  assertUuid(id, 'unit');
  const row = await idb(tx).selectFrom('inventory.units').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw new NotFoundError('unit', id);
  return row;
}

/** Lock unit types exclusively: capacity changes serialize with sales of those types (which lock FOR SHARE). */
async function lockTypesForCapacityChange(tx: TxContext, typeIds: readonly string[]): Promise<void> {
  await sql`select id from inventory.unit_types where id = any(${[...new Set(typeIds)].sort()}::uuid[])
            order by id for update`.execute(tx.db);
}

/**
 * Recompute ledger capacity for existing rows of the types from `fromNight` on (past nights keep their history),
 * after units were added, retired or re-dated. Nights that become oversold get an inventory conflict.
 */
async function recomputeCapacity(
  tx: TxContext,
  propertyId: string,
  typeIds: readonly string[],
  fromNight: LocalDate,
): Promise<void> {
  await lockTypesForCapacityChange(tx, typeIds);
  const { rows } = await sql<{ unit_type_id: string; night: string; capacity: number }>`
    select l.unit_type_id, l.night::text as night,
      (select count(*)::int from inventory.units u
        where u.unit_type_id = l.unit_type_id and u.status = 'active'
          and u.in_inventory_from <= l.night and (u.in_inventory_to is null or l.night < u.in_inventory_to)) as capacity
    from inventory.ledger l
    where l.unit_type_id = any(${[...typeIds]}::uuid[]) and l.night >= ${fromNight}::date
    order by l.unit_type_id, l.night`.execute(tx.db);
  if (rows.length === 0) return;
  const session = await LedgerSession.open(
    tx,
    propertyId,
    rows.map((r) => ({ unitTypeId: r.unit_type_id, night: r.night })),
  );
  for (const r of rows) {
    const cell = session.get(r.unit_type_id, r.night);
    if (cell.capacity !== r.capacity)
      session.adjust(r.unit_type_id, r.night, { capacity: r.capacity - cell.capacity });
  }
  await session.finish({ kind: 'capacity_change' });
}

async function assertUnitLimit(deps: Deps, tx: TxContext): Promise<void> {
  const limit = await deps.ports.platform.getLimit(tx, 'limits.units');
  if (limit === null) return;
  // Serialize concurrent unit creation within the organization so the limit cannot be exceeded by a race.
  await sql`select pg_advisory_xact_lock(hashtext(${`inventory.units.limit:${tx.tenantId}`}))`.execute(tx.db);
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from inventory.units where is_composite = false and status <> 'retired'`.execute(
    tx.db,
  );
  if ((rows[0]?.n ?? 0) >= limit) {
    throw new BusinessRuleError(
      'plan_limit_reached',
      `Your plan allows ${limit} units across the organization. Retire unused units or upgrade the plan to add more.`,
      { limit: 'limits.units', value: limit },
    );
  }
}

function unitValues(
  tx: TxContext,
  propertyId: string,
  input: UnitInput,
  bd: LocalDate,
  isComposite: boolean,
) {
  return {
    id: newId(),
    tenant_id: tx.tenantId,
    property_id: propertyId,
    unit_type_id: input.unitTypeId,
    number: input.number,
    name: input.name ?? null,
    building: input.location?.building ?? null,
    floor: input.location?.floor ?? null,
    zone: input.location?.zone ?? null,
    features: [...new Set(input.features ?? [])],
    max_occupancy_override: input.maxOccupancyOverride ?? null,
    sort_order: input.sortOrder ?? 0,
    in_inventory_from: input.inInventoryFrom ?? bd,
    is_composite: isComposite,
    notes: input.notes ?? null,
  };
}

/** Create a physical unit. Enforces the plan's `limits.units` (physical units, not combined ones). */
export async function createUnit(
  deps: Deps,
  tx: TxContext,
  propertyId: string,
  input: UnitInput,
  opts: { origin?: ChangeOrigin } = {},
): Promise<Unit> {
  requirePermission(tx, INVENTORY_PERMISSIONS.unitManage, { propertyId });
  const bd = await deps.ports.platform.getBusinessDate(tx, propertyId);
  await guardAvailabilityWrite(tx, deps, propertyId, opts.origin);
  const type = await idb(tx)
    .selectFrom('inventory.unit_types')
    .select(['id', 'name', 'is_composite', 'status', 'property_id'])
    .where('id', '=', assertUuid(input.unitTypeId, 'unit_type'))
    .executeTakeFirst();
  if (!type || type.property_id !== propertyId) throw new NotFoundError('unit_type', input.unitTypeId);
  if (type.is_composite) {
    throw new BusinessRuleError(
      'use_composite_unit',
      `${type.name} combines other units; create it as a composite unit by listing its component units.`,
    );
  }
  if (type.status === 'archived')
    throw new BusinessRuleError('unit_type_archived', `${type.name} is archived.`);
  await assertFeatures(tx, propertyId, input.features);
  await assertUnitLimit(deps, tx);
  await lockTypesForCapacityChange(tx, [type.id]);
  const values = unitValues(tx, propertyId, input, bd, false);
  try {
    await idb(tx).insertInto('inventory.units').values(values).execute();
  } catch (err) {
    if (pgCode(err) === '23505') {
      throw new ConflictError(
        'unit_number_taken',
        `Unit number ${input.number} is already used at this property.`,
      );
    }
    throw err;
  }
  await recomputeCapacity(tx, propertyId, [type.id], bd);
  const unit = await getUnit(tx, values.id);
  await tx.audit({
    action: 'inventory.unit.create',
    target: { type: 'unit', id: unit.id },
    propertyId,
    after: unit,
  });
  await tx.emit({
    type: INVENTORY_EVENTS.unitChanged,
    propertyId,
    aggregate: { type: 'unit', id: unit.id },
    aggregateVersion: unit.version,
    payload: { propertyId, unitId: unit.id, unitTypeId: unit.unitTypeId, change: 'created' },
  });
  return unit;
}

/**
 * Create a composite unit (connecting rooms, a two-bedroom residence) from existing units. Every composite unit of
 * a composite type combines the same mix of component types, so composite availability is well defined (INV-R07).
 */
export async function createCompositeUnit(
  deps: Deps,
  tx: TxContext,
  propertyId: string,
  input: CompositeUnitInput,
  opts: { origin?: ChangeOrigin } = {},
): Promise<Unit> {
  requirePermission(tx, INVENTORY_PERMISSIONS.unitManage, { propertyId });
  const bd = await deps.ports.platform.getBusinessDate(tx, propertyId);
  await guardAvailabilityWrite(tx, deps, propertyId, opts.origin);
  const type = await idb(tx)
    .selectFrom('inventory.unit_types')
    .select(['id', 'name', 'is_composite', 'status', 'property_id'])
    .where('id', '=', assertUuid(input.unitTypeId, 'unit_type'))
    .executeTakeFirst();
  if (!type || type.property_id !== propertyId) throw new NotFoundError('unit_type', input.unitTypeId);
  if (!type.is_composite) {
    throw new BusinessRuleError(
      'not_a_composite_type',
      `${type.name} is not a composite unit type. Create a composite type (isComposite) for combined units.`,
    );
  }
  const ids = [...new Set(input.componentUnitIds)];
  if (ids.length < 2 || ids.length !== input.componentUnitIds.length) {
    throw new ValidationError(
      'invalid_components',
      'A composite unit combines at least two different units.',
    );
  }
  const components = await loadUnits(tx, { ids });
  const bad = ids.filter((id) => {
    const u = components.find((c) => c.id === id);
    return !u || u.propertyId !== propertyId || u.isComposite || u.status !== 'active';
  });
  if (bad.length > 0) {
    throw new ValidationError(
      'invalid_components',
      'Components must be active, non-composite units of this property.',
      { invalidUnitIds: bad },
    );
  }
  // Lock the composite type first so two concurrent creations cannot store different component mixes.
  await lockTypesForCapacityChange(tx, [type.id]);
  const mix = new Map<string, number>();
  for (const c of components) mix.set(c.unitTypeId, (mix.get(c.unitTypeId) ?? 0) + 1);
  const existing = (await loadCompositeStructures(tx, [type.id])).get(type.id);
  if (existing && existing.units.length > 0) {
    const same =
      existing.perType.size === mix.size && [...mix].every(([t, k]) => existing.perType.get(t) === k);
    if (!same) {
      throw new ValidationError(
        'composite_mix_mismatch',
        `Every ${type.name} must combine the same mix of unit types as the existing ones. Create a separate composite type for a different combination.`,
      );
    }
  }
  await assertFeatures(tx, propertyId, input.features);
  const values = unitValues(tx, propertyId, input, bd, true);
  try {
    await idb(tx).insertInto('inventory.units').values(values).execute();
    await idb(tx)
      .insertInto('inventory.composite_components')
      .values(
        components.map((c) => ({
          tenant_id: tx.tenantId,
          composite_unit_id: values.id,
          composite_unit_type_id: type.id,
          component_unit_id: c.id,
          component_unit_type_id: c.unitTypeId,
        })),
      )
      .execute();
  } catch (err) {
    if (pgCode(err) === '23505') {
      throw new ConflictError(
        pgConstraint(err)?.includes('composite_components')
          ? 'component_already_combined'
          : 'unit_number_taken',
        pgConstraint(err)?.includes('composite_components')
          ? `One of these units is already part of another ${type.name}.`
          : `Unit number ${input.number} is already used at this property.`,
      );
    }
    throw err;
  }
  await recomputeCapacity(tx, propertyId, [type.id], bd);
  const unit = await getUnit(tx, values.id);
  await tx.audit({
    action: 'inventory.compositeUnit.create',
    target: { type: 'unit', id: unit.id },
    propertyId,
    after: unit,
  });
  await tx.emit({
    type: INVENTORY_EVENTS.unitChanged,
    propertyId,
    aggregate: { type: 'unit', id: unit.id },
    aggregateVersion: unit.version,
    payload: { propertyId, unitId: unit.id, unitTypeId: unit.unitTypeId, change: 'created' },
  });
  return unit;
}

export async function getUnit(tx: TxContext, id: string): Promise<Unit> {
  const row = await loadUnitRow(tx, id);
  requireAnyPermission(tx, READ_PERMISSIONS, row.property_id);
  const [unit] = await toUnits(tx, [row]);
  return unit as Unit;
}

export async function listUnits(
  tx: TxContext,
  propertyId: string,
  filter: { unitTypeId?: string; status?: Unit['status'] | 'all' } = {},
): Promise<Unit[]> {
  requireAnyPermission(tx, READ_PERMISSIONS, propertyId);
  let q = idb(tx).selectFrom('inventory.units').selectAll().where('property_id', '=', propertyId);
  if (filter.unitTypeId) q = q.where('unit_type_id', '=', filter.unitTypeId);
  if (filter.status && filter.status !== 'all') q = q.where('status', '=', filter.status);
  const rows = await q.orderBy('sort_order').orderBy('number').execute();
  return toUnits(tx, rows);
}

interface LeaveCheck {
  cutoff: LocalDate;
  affectedAssignments: Array<{
    ref: { type: string; id: string };
    nights: { from: LocalDate; to: LocalDate };
  }>;
  refusal: BusinessRuleError | null;
}

/** Stays assigned to a unit from the night it would leave inventory, and whether that blocks the change. */
async function leaveCheck(
  tx: TxContext,
  before: Row<UnitsTable>,
  patch: UnitUpdate,
  bd: LocalDate,
): Promise<LeaveCheck> {
  const cutoff =
    patch.status !== undefined && patch.status !== 'active'
      ? bd
      : patch.inInventoryTo && patch.inInventoryTo > bd
        ? patch.inInventoryTo
        : bd;
  const future = (
    await loadAssignments(tx, { unitIds: [before.id], span: { from: cutoff, to: '9999-12-31' } })
  ).filter((a) => a.nights.to > cutoff);
  const affectedAssignments = future.map((a) => ({ ref: a.ref, nights: a.nights }));
  if (future.length > 0) {
    return {
      cutoff,
      affectedAssignments,
      refusal: new BusinessRuleError(
        'unit_has_future_assignments',
        `Unit ${before.number} is assigned to ${future.length} stay(s) on or after ${cutoff}. Move them to other units first.`,
        { assignments: affectedAssignments },
      ),
    };
  }
  const { rows: memberOf } = await sql<{ number: string }>`
    select u.number from inventory.composite_components cc join inventory.units u on u.id = cc.composite_unit_id
    where cc.component_unit_id = ${before.id} and u.status = 'active'`.execute(tx.db);
  if (memberOf.length > 0) {
    return {
      cutoff,
      affectedAssignments,
      refusal: new BusinessRuleError(
        'unit_is_component',
        `Unit ${before.number} is part of ${memberOf.map((m) => m.number).join(', ')}. Take the combined unit out of inventory first.`,
      ),
    };
  }
  return { cutoff, affectedAssignments, refusal: null };
}

export interface UnitChangePreview {
  /** Whether `updateUnit` with this patch would be accepted now. */
  allowed: boolean;
  /** Why not, in plain language (stays still assigned, part of a combined unit). */
  reason: string | null;
  /** Stays assigned to the unit from the night it leaves inventory: they must be moved first. */
  affectedAssignments: LeaveCheck['affectedAssignments'];
  /** Nights (within a year from the business date) that would be oversold beyond authorization after the change. */
  oversoldNights: Array<{ unitTypeId: string; night: LocalDate; shortfall: number }>;
}

class PreviewRollback extends Error {
  constructor(readonly oversold: UnitChangePreview['oversoldNights']) {
    super('preview');
  }
}

/**
 * Preview taking a unit out of (or back into) inventory before committing (PAR-INV-011): the stays that would need a
 * new unit and the nights that would become oversold. The capacity effect is computed by the real code path inside a
 * savepoint that is always rolled back.
 */
export async function previewUnitChange(
  deps: Deps,
  tx: TxContext,
  id: string,
  patch: Pick<UnitUpdate, 'status' | 'inInventoryTo'>,
): Promise<UnitChangePreview> {
  const before = await loadUnitRow(tx, id);
  requirePermission(tx, INVENTORY_PERMISSIONS.unitManage, { propertyId: before.property_id });
  const bd = await deps.ports.platform.getBusinessDate(tx, before.property_id);
  const check = await leaveCheck(tx, before, patch, bd);
  let oversold: UnitChangePreview['oversoldNights'] = [];
  try {
    await withSavepoint(tx, 'inv_unit_change_preview', async () => {
      await lockTypesForCapacityChange(tx, [before.unit_type_id]);
      await idb(tx)
        .updateTable('inventory.units')
        .set({
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.inInventoryTo !== undefined ? { in_inventory_to: patch.inInventoryTo } : {}),
        })
        .where('id', '=', id)
        .execute();
      await recomputeCapacity(tx, before.property_id, [before.unit_type_id], bd);
      const { rows } = await sql<{ unit_type_id: string; night: string; available: number }>`
        select l.unit_type_id, l.night::text as night,
               (l.capacity - l.out_of_order - l.sold - l.held + l.overbooking_allowance)::int as available
        from inventory.ledger l
        where l.unit_type_id = ${before.unit_type_id} and l.night >= ${bd}::date and l.night < ${addDays(bd, 366)}::date
          and l.capacity - l.out_of_order - l.sold - l.held + l.overbooking_allowance < 0
        order by l.night`.execute(tx.db);
      throw new PreviewRollback(
        rows.map((r) => ({ unitTypeId: r.unit_type_id, night: r.night, shortfall: -r.available })),
      );
    });
  } catch (err) {
    if (!(err instanceof PreviewRollback)) throw err;
    oversold = err.oversold;
  }
  return {
    allowed: check.refusal === null,
    reason: check.refusal?.message ?? null,
    affectedAssignments: check.affectedAssignments,
    oversoldNights: oversold,
  };
}

/**
 * Edit a unit. Taking a unit out of inventory (inactive/retired or an end date) is refused while stays are
 * assigned to it on later nights — they are listed so they can be moved first (nothing is moved silently).
 */
export async function updateUnit(
  deps: Deps,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  patch: UnitUpdate,
  opts: { origin?: ChangeOrigin } = {},
): Promise<Unit> {
  const before = await loadUnitRow(tx, id);
  requirePermission(tx, INVENTORY_PERMISSIONS.unitManage, { propertyId: before.property_id });
  await guardAvailabilityWrite(tx, deps, before.property_id, opts.origin);
  if (before.version !== expectedVersion) {
    return explainVersionMiss('unit', id, expectedVersion, async () => before.version);
  }
  await assertFeatures(tx, before.property_id, patch.features);
  const bd = await deps.ports.platform.getBusinessDate(tx, before.property_id);
  if (before.status === 'retired' && patch.status && patch.status !== 'retired') {
    throw new BusinessRuleError(
      'unit_retired',
      `Unit ${before.number} is retired; retired units cannot return. Create a new unit.`,
    );
  }
  if (patch.inInventoryTo && patch.inInventoryTo <= before.in_inventory_from) {
    throw new ValidationError(
      'invalid_inventory_dates',
      'The end date must be after the date the unit entered inventory.',
    );
  }
  const leaving =
    (patch.status !== undefined && patch.status !== 'active' && before.status === 'active') ||
    (patch.inInventoryTo !== undefined &&
      patch.inInventoryTo !== null &&
      patch.inInventoryTo !== before.in_inventory_to);
  const capacityAffecting =
    leaving ||
    (patch.status !== undefined && patch.status !== before.status) ||
    patch.inInventoryTo !== undefined;
  if (leaving) {
    const check = await leaveCheck(tx, before, patch, bd);
    if (check.refusal) throw check.refusal;
  }
  if (capacityAffecting) await lockTypesForCapacityChange(tx, [before.unit_type_id]);
  const row = await idb(tx)
    .updateTable('inventory.units')
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.location?.building !== undefined ? { building: patch.location.building } : {}),
      ...(patch.location?.floor !== undefined ? { floor: patch.location.floor } : {}),
      ...(patch.location?.zone !== undefined ? { zone: patch.location.zone } : {}),
      ...(patch.features !== undefined ? { features: [...new Set(patch.features)] } : {}),
      ...(patch.maxOccupancyOverride !== undefined
        ? { max_occupancy_override: patch.maxOccupancyOverride }
        : {}),
      ...(patch.sortOrder !== undefined ? { sort_order: patch.sortOrder } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.inInventoryTo !== undefined ? { in_inventory_to: patch.inInventoryTo } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      updated_at: tx.now,
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returning('id')
    .executeTakeFirst();
  if (!row)
    return explainVersionMiss('unit', id, expectedVersion, async () => (await loadUnitRow(tx, id)).version);
  if (capacityAffecting) await recomputeCapacity(tx, before.property_id, [before.unit_type_id], bd);
  const [beforeDto] = await toUnits(tx, [before]);
  const after = await getUnit(tx, id);
  await tx.audit({
    action: 'inventory.unit.update',
    target: { type: 'unit', id },
    propertyId: before.property_id,
    before: beforeDto,
    after,
  });
  await tx.emit({
    type: INVENTORY_EVENTS.unitChanged,
    propertyId: before.property_id,
    aggregate: { type: 'unit', id },
    aggregateVersion: after.version,
    payload: {
      propertyId: before.property_id,
      unitId: id,
      unitTypeId: before.unit_type_id,
      change: 'updated',
    },
  });
  return after;
}
