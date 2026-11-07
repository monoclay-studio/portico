import { sql, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  type DateRange,
  type EntityRef,
  type LocalDate,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
  VersionConflictError,
} from '@portico/kernel';
import type { AffectedAssignment, BlockKind, UnitBlock } from '../contracts';
import { describeRange, earlierDate, intersectRanges, laterDate, nightsOfRange } from '../domain/ranges';
import { INVENTORY_EVENTS } from '../events';
import { INVENTORY_PERMISSIONS } from '../manifest';
import {
  actorKey,
  assertRef,
  assertUuid,
  type ChangeOrigin,
  type Deps,
  guardAvailabilityWrite,
  guardDomainWrite,
  iso,
  isoRequired,
  requireAnyPermission,
} from './context';
import { LedgerSession, nightsOf } from './ledger';
import {
  compositeTypesContainingUnits,
  loadActiveBlocks,
  loadAssignments,
  loadUnits,
  lockUnits,
  type UnitLite,
} from './occupancy';

const KIND_LABEL: Record<BlockKind, string> = {
  out_of_order: 'out of order',
  out_of_service: 'out of service',
  house_use: 'in house use',
};

interface BlockSqlRow {
  id: string;
  property_id: string;
  unit_id: string;
  unit_type_id: string;
  kind: BlockKind;
  from: string;
  to: string;
  eff_from: string | null;
  eff_to: string | null;
  reason: string;
  source_ref_type: string | null;
  source_ref_id: string | null;
  status: 'active' | 'released';
  affected_assignments: AffectedAssignment[];
  created_by: string;
  created_at: Date;
  released_at: Date | null;
  released_by: string | null;
  release_reason: string | null;
  version: number;
}

const BLOCK_COLUMNS = sql`b.id, b.property_id, b.unit_id, b.unit_type_id, b.kind,
  lower(b.nights)::text as from, upper(b.nights)::text as to,
  lower(b.effective_nights)::text as eff_from, upper(b.effective_nights)::text as eff_to,
  b.reason, b.source_ref_type, b.source_ref_id, b.status, b.affected_assignments, b.created_by, b.created_at,
  b.released_at, b.released_by, b.release_reason, b.version`;

async function loadBlockRows(
  tx: TxContext,
  filter: {
    id?: string;
    propertyId?: string;
    unitId?: string;
    span?: DateRange;
    status?: 'active' | 'released';
  },
  forUpdate = false,
): Promise<BlockSqlRow[]> {
  const { rows } = await sql<BlockSqlRow>`
    select ${BLOCK_COLUMNS} from inventory.unit_blocks b
    where true
      ${filter.id ? sql`and b.id = ${filter.id}` : sql``}
      ${filter.propertyId ? sql`and b.property_id = ${filter.propertyId}` : sql``}
      ${filter.unitId ? sql`and b.unit_id = ${filter.unitId}` : sql``}
      ${filter.status ? sql`and b.status = ${filter.status}` : sql``}
      ${filter.span ? sql`and b.nights && daterange(${filter.span.from}::date, ${filter.span.to}::date, '[)')` : sql``}
    order by lower(b.nights), b.id
    ${forUpdate ? sql`for update` : sql``}`.execute(tx.db);
  return rows;
}

async function toBlocks(tx: TxContext, rows: readonly BlockSqlRow[]): Promise<UnitBlock[]> {
  if (rows.length === 0) return [];
  const units = new Map(
    (await loadUnits(tx, { ids: [...new Set(rows.map((r) => r.unit_id))] })).map((u) => [u.id, u]),
  );
  const out: UnitBlock[] = [];
  for (const r of rows) {
    const effective = r.eff_from && r.eff_to ? { from: r.eff_from, to: r.eff_to } : null;
    const outstanding: AffectedAssignment[] = [];
    if (effective && r.status === 'active') {
      const current = await loadAssignments(tx, { unitIds: [r.unit_id], span: effective });
      for (const a of current) {
        const overlap = intersectRanges(a.nights, effective);
        if (overlap)
          outstanding.push({ ref: a.ref, nights: overlap, unitId: a.unitId, viaCompositeUnitId: null });
      }
    }
    out.push({
      id: r.id,
      propertyId: r.property_id,
      unitId: r.unit_id,
      unitNumber: units.get(r.unit_id)?.number ?? '',
      unitTypeId: r.unit_type_id,
      kind: r.kind,
      nights: { from: r.from, to: r.to },
      effectiveNights: effective,
      reason: r.reason,
      sourceRef:
        r.source_ref_type && r.source_ref_id ? { type: r.source_ref_type, id: r.source_ref_id } : null,
      status: r.status,
      affectedAssignments: r.affected_assignments,
      outstandingAssignments: outstanding,
      createdBy: r.created_by,
      createdAt: isoRequired(r.created_at),
      releasedAt: iso(r.released_at),
      releasedBy: r.released_by,
      releaseReason: r.release_reason,
      version: r.version,
    });
  }
  return out;
}

export async function getBlock(tx: TxContext, blockId: string): Promise<UnitBlock> {
  assertUuid(blockId, 'unit_block');
  const [row] = await loadBlockRows(tx, { id: blockId });
  if (!row) throw new NotFoundError('unit_block', blockId);
  requireAnyPermission(
    tx,
    [INVENTORY_PERMISSIONS.unitRead, INVENTORY_PERMISSIONS.blockManage],
    row.property_id,
  );
  const [block] = await toBlocks(tx, [row]);
  return block as UnitBlock;
}

export async function listBlocks(
  tx: TxContext,
  filter: { propertyId: string; range: DateRange; unitId?: string; status?: 'active' | 'released' | 'all' },
): Promise<UnitBlock[]> {
  requireAnyPermission(
    tx,
    [INVENTORY_PERMISSIONS.unitRead, INVENTORY_PERMISSIONS.blockManage],
    filter.propertyId,
  );
  nightsOfRange(filter.range, 400, 'range');
  const rows = await loadBlockRows(tx, {
    propertyId: filter.propertyId,
    span: filter.range,
    ...(filter.unitId ? { unitId: filter.unitId } : {}),
    ...(filter.status && filter.status !== 'all' ? { status: filter.status } : {}),
  });
  return toBlocks(tx, rows);
}

export interface BlockUnitInput {
  unitId: string;
  nights: DateRange;
  kind: BlockKind;
  reason: string;
  /** What caused the block, e.g. { type: 'workOrder', id } from operations. */
  sourceRef?: EntityRef;
  /** When given (HTTP routes), the unit must belong to this property. */
  propertyId?: string;
}

export interface BlockUnitResult {
  blockId: string;
  block: UnitBlock;
  /** Stays assigned to the unit during the block — they need relocation (scenario 8). */
  affectedAssignments: AffectedAssignment[];
  /** Inventory conflicts opened because nights became oversold. */
  conflictsCreated: string[];
}

/**
 * Take a unit out of inventory for some nights (INV-R24). Never fails because nights are sold out — a broken unit
 * cannot be "unavailable to break" — instead it returns the affected assignments and records inventory conflicts
 * for nights that became oversold, so callers route the stays into relocation.
 *  - out_of_order: removes the unit from sellable capacity (out_of_order + 1) and from assignment
 *  - out_of_service: still counted as sellable but not assignable
 *  - house_use: consumes inventory (sold + 1, ref unitBlock) with no revenue; not assignable to stays
 */
export async function blockUnit(
  deps: Deps,
  tx: TxContext,
  input: BlockUnitInput,
  opts: { origin?: ChangeOrigin } = {},
): Promise<BlockUnitResult> {
  const nights = nightsOfRange(input.nights);
  const range = { from: input.nights.from, to: input.nights.to };
  const reason = input.reason?.trim() ?? '';
  if (reason.length < 3) {
    throw new ValidationError(
      'block_reason_required',
      'Say why the unit is blocked (e.g. "AC compressor failure").',
    );
  }
  const sourceRef = input.sourceRef ? assertRef(input.sourceRef, 'sourceRef') : null;
  const [unit] = await loadUnits(tx, { ids: [assertUuid(input.unitId, 'unit')] });
  if (!unit || (input.propertyId && unit.propertyId !== input.propertyId))
    throw new NotFoundError('unit', input.unitId);
  requirePermission(tx, INVENTORY_PERMISSIONS.blockManage, { propertyId: unit.propertyId });
  if (input.kind === 'house_use') {
    requirePermission(tx, INVENTORY_PERMISSIONS.houseUseCreate, { propertyId: unit.propertyId });
  }
  await guardAvailabilityWrite(tx, deps, unit.propertyId, opts.origin);
  if (input.kind !== 'house_use') {
    // Out of order / out of service are maintenance facts: refused (or forwarded) when maintenance is external.
    await guardDomainWrite(tx, deps, unit.propertyId, 'maintenance', opts.origin);
  }
  if (unit.isComposite) {
    throw new BusinessRuleError(
      'block_component_units',
      `${unit.number} combines several units. Block the physical units it is made of; the combined unit becomes unavailable automatically.`,
      { unitId: unit.id },
    );
  }
  if (unit.status !== 'active') {
    throw new BusinessRuleError(
      'unit_not_active',
      `Unit ${unit.number} is ${unit.status}; only active units can be blocked.`,
    );
  }
  const businessDate = await deps.ports.platform.getBusinessDate(tx, unit.propertyId);
  if (range.from < businessDate) {
    throw new ValidationError(
      'block_in_past',
      `A block cannot start before the current business date (${businessDate}); past nights are history. Start it on ${businessDate} or later.`,
      { businessDate },
    );
  }

  const compositeTypes = await compositeTypesContainingUnits(tx, [unit.id]);
  const session = await LedgerSession.open(tx, unit.propertyId, [
    ...nights.map((night) => ({ unitTypeId: unit.unitTypeId, night })),
    ...compositeTypes.flatMap((t) => nights.map((night) => ({ unitTypeId: t, night }))),
  ]);
  await lockUnits(tx, [unit.id]);
  const overlapping = await loadActiveBlocks(tx, { unitIds: [unit.id], span: range });
  if (overlapping.length > 0) {
    const b = overlapping[0];
    throw new ConflictError(
      'unit_already_blocked',
      `Unit ${unit.number} is already ${b ? KIND_LABEL[b.kind] : 'blocked'} (${b?.reason}) for ${b ? describeRange(b.nights) : 'some of these nights'}. Release or shorten that block first.`,
      {
        blocks: overlapping.map((x) => ({ blockId: x.id, kind: x.kind, nights: x.nights, reason: x.reason })),
      },
    );
  }

  const affected = await affectedAssignmentsOf(tx, unit, range);
  const blockId = newId();
  await sql`
    insert into inventory.unit_blocks (id, tenant_id, property_id, unit_id, unit_type_id, kind, nights,
                                       effective_nights, reason, source_ref_type, source_ref_id, status,
                                       affected_assignments, created_by, created_at)
    values (${blockId}, ${tx.tenantId}, ${unit.propertyId}, ${unit.id}, ${unit.unitTypeId}, ${input.kind},
            daterange(${range.from}::date, ${range.to}::date, '[)'), daterange(${range.from}::date, ${range.to}::date, '[)'),
            ${reason}, ${sourceRef?.type ?? null}, ${sourceRef?.id ?? null}, 'active',
            ${JSON.stringify(affected)}::jsonb, ${actorKey(tx)}, ${tx.now})`.execute(tx.db);
  if (input.kind === 'out_of_order') {
    for (const n of nights) session.adjust(unit.unitTypeId, n, { outOfOrder: 1 });
  } else if (input.kind === 'house_use') {
    for (const n of nights) session.adjust(unit.unitTypeId, n, { sold: 1 });
    for (const n of nights) {
      await sql`
        insert into inventory.consumptions (id, tenant_id, property_id, ref_type, ref_id, unit_type_id, night, quantity,
                                            kind, created_at)
        values (${newId()}, ${tx.tenantId}, ${unit.propertyId}, 'unitBlock', ${blockId}, ${unit.unitTypeId},
                ${n}::date, 1, 'house_use', ${tx.now})`.execute(tx.db);
    }
  }
  for (const t of compositeTypes) session.touchComposite(t, nights);
  const conflicts = await session.finish({
    kind: 'block',
    ref: { type: 'unitBlock', id: blockId },
    note: `Unit ${unit.number} ${KIND_LABEL[input.kind]}: ${reason}`,
  });

  const blockAudit = {
    blockId,
    unitId: unit.id,
    unitNumber: unit.number,
    kind: input.kind,
    nights: range,
    affectedAssignments: affected,
    conflictsCreated: conflicts.created,
  };
  // One entry on the block's own timeline and one on the unit's ("what happened to villa 214?").
  await tx.audit({
    action: 'inventory.unitBlock.create',
    target: { type: 'unitBlock', id: blockId },
    propertyId: unit.propertyId,
    reason,
    after: blockAudit,
  });
  await tx.audit({
    action: `inventory.unit.block.${input.kind}`,
    target: { type: 'unit', id: unit.id },
    propertyId: unit.propertyId,
    reason,
    after: blockAudit,
  });
  await tx.emit({
    type: INVENTORY_EVENTS.unitBlocked,
    propertyId: unit.propertyId,
    aggregate: { type: 'unit', id: unit.id },
    payload: {
      blockId,
      propertyId: unit.propertyId,
      unitId: unit.id,
      unitTypeId: unit.unitTypeId,
      kind: input.kind,
      nights: range,
      reason,
      sourceRef,
      affectedAssignments: affected,
      conflictsCreated: conflicts.created,
    },
  });
  const [row] = await loadBlockRows(tx, { id: blockId });
  const [block] = await toBlocks(tx, row ? [row] : []);
  return {
    blockId,
    block: block as UnitBlock,
    affectedAssignments: affected,
    conflictsCreated: conflicts.created,
  };
}

/** Assignments on the unit (incl. component rows of combined units) overlapping the range, grouped per ref. */
async function affectedAssignmentsOf(
  tx: TxContext,
  unit: UnitLite,
  range: DateRange,
): Promise<AffectedAssignment[]> {
  const rows = await loadAssignments(tx, { unitIds: [unit.id], span: range });
  const parentIds = rows.map((r) => r.parentId).filter((p): p is string => p !== null);
  const parentUnit = new Map<string, string>();
  if (parentIds.length > 0) {
    const { rows: pr } = await sql<{ id: string; unit_id: string }>`
      select id, unit_id from inventory.assignments where id = any(${parentIds}::uuid[])`.execute(tx.db);
    for (const p of pr) parentUnit.set(p.id, p.unit_id);
  }
  return rows.flatMap((a) => {
    const overlap = intersectRanges(a.nights, range);
    return overlap
      ? [
          {
            ref: a.ref,
            nights: overlap,
            unitId: a.unitId,
            viaCompositeUnitId: a.parentId ? (parentUnit.get(a.parentId) ?? null) : null,
          },
        ]
      : [];
  });
}

/**
 * Return a blocked unit to inventory (INV-R25) from the later of the block start and the current business date;
 * nights already in the past stay as history. Whether the unit may return to sale (work order done, inspected) is
 * decided by the caller (operations) before calling this. Idempotent.
 */
export async function releaseBlock(
  deps: Deps,
  tx: TxContext,
  input: { blockId: string; reason?: string; expectedVersion?: number },
  opts: { origin?: ChangeOrigin } = {},
): Promise<UnitBlock> {
  assertUuid(input.blockId, 'unit_block');
  const [row] = await loadBlockRows(tx, { id: input.blockId });
  if (!row) throw new NotFoundError('unit_block', input.blockId);
  requirePermission(tx, INVENTORY_PERMISSIONS.blockManage, { propertyId: row.property_id });
  if (input.expectedVersion !== undefined && input.expectedVersion !== row.version) {
    throw new VersionConflictError('unit_block', row.id, input.expectedVersion, row.version);
  }
  if (row.status === 'released') return getBlock(tx, row.id);
  await guardAvailabilityWrite(tx, deps, row.property_id, opts.origin);
  if (row.kind !== 'house_use') await guardDomainWrite(tx, deps, row.property_id, 'maintenance', opts.origin);
  const businessDate = await deps.ports.platform.getBusinessDate(tx, row.property_id);
  const effFrom = row.eff_from ?? row.from;
  const effTo = row.eff_to ?? row.from;
  const releaseFrom = laterDate(effFrom, businessDate);
  const released: LocalDate[] = releaseFrom < effTo ? nightsOf(releaseFrom, effTo) : [];
  const compositeTypes = await compositeTypesContainingUnits(tx, [row.unit_id]);
  const session = await LedgerSession.open(tx, row.property_id, [
    ...released.map((night) => ({ unitTypeId: row.unit_type_id, night })),
    ...compositeTypes.flatMap((t) => released.map((night) => ({ unitTypeId: t, night }))),
  ]);
  const [locked] = await loadBlockRows(tx, { id: row.id }, true);
  if (!locked || locked.status === 'released') return getBlock(tx, row.id);
  if (locked.version !== row.version)
    throw new VersionConflictError('unit_block', row.id, row.version, locked.version);

  if (row.kind === 'out_of_order') {
    for (const n of released) session.adjust(row.unit_type_id, n, { outOfOrder: -1 });
  } else if (row.kind === 'house_use' && released.length > 0) {
    for (const n of released) session.adjust(row.unit_type_id, n, { sold: -1 });
    await sql`delete from inventory.consumptions where ref_type = 'unitBlock' and ref_id = ${row.id}
                and night = any(${released}::date[])`.execute(tx.db);
  }
  const keepTo = earlierDate(releaseFrom, effTo);
  await sql`
    update inventory.unit_blocks
       set status = 'released',
           effective_nights = case when ${effFrom}::date < ${keepTo}::date
                                   then daterange(${effFrom}::date, ${keepTo}::date, '[)') else 'empty'::daterange end,
           released_at = ${tx.now}, released_by = ${actorKey(tx)}, release_reason = ${input.reason ?? null},
           version = version + 1
     where id = ${row.id}`.execute(tx.db);
  for (const t of compositeTypes) session.touchComposite(t, released);
  const conflicts = await session.finish({ kind: 'block_released', ref: { type: 'unitBlock', id: row.id } });
  const releasedRange = released.length > 0 ? { from: released[0] as string, to: effTo } : null;
  for (const target of [
    { type: 'unitBlock', id: row.id, action: 'inventory.unitBlock.release' },
    { type: 'unit', id: row.unit_id, action: 'inventory.unit.unblock' },
  ]) {
    await tx.audit({
      action: target.action,
      target: { type: target.type, id: target.id },
      propertyId: row.property_id,
      reason: input.reason ?? null,
      before: { blockId: row.id, kind: row.kind, nights: { from: effFrom, to: effTo } },
      after: { releasedNights: releasedRange, conflictsResolved: conflicts.resolved },
    });
  }
  await tx.emit({
    type: INVENTORY_EVENTS.unitUnblocked,
    propertyId: row.property_id,
    aggregate: { type: 'unit', id: row.unit_id },
    payload: {
      blockId: row.id,
      propertyId: row.property_id,
      unitId: row.unit_id,
      unitTypeId: row.unit_type_id,
      kind: row.kind,
      releasedNights: releasedRange,
    },
  });
  return getBlock(tx, row.id);
}
