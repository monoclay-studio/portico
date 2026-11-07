/**
 * Universal record contract for inventory's primary records (domain-map § Universal record contract): status per
 * family, server-computed allowed actions with plain-language reasons, issues, owner and links. The UI, API,
 * integrations and the assistant all read the same truth from here.
 */
import { sql, type TxContext } from '@portico/db';
import {
  addDays,
  type LocalDate,
  type RecordAction,
  type RecordIssue,
  type RecordLink,
} from '@portico/kernel';
import type {
  InventoryConflict,
  InventoryConflictRecord,
  Unit,
  UnitBlock,
  UnitBlockPreview,
  UnitBlockRecord,
  UnitRecord,
  UnitType,
  UnitTypeRecord,
} from '../contracts';
import { nightsOfRange } from '../domain/ranges';
import { INVENTORY_PERMISSIONS as P } from '../manifest';
import { type BlockUnitInput, blockUnit } from './blocks';
import { type Deps, idb } from './context';
import { loadActiveBlocks, loadAssignments, loadUnits } from './occupancy';
import { getAvailability } from './reads';

const KIND_LABEL = {
  out_of_order: 'Out of order',
  out_of_service: 'Out of service',
  house_use: 'House use',
} as const;

function action(
  tx: TxContext,
  propertyId: string,
  spec: {
    action: string;
    label: string;
    permission: string | string[];
    disabledReason?: string | null;
    previewRequired?: boolean;
  },
): RecordAction {
  const perms = Array.isArray(spec.permission) ? spec.permission : [spec.permission];
  const permitted = perms.every((p) => tx.authz.can(p, { propertyId }));
  const reason = !permitted
    ? `You do not have permission to do this (${perms.join(' + ')}).`
    : (spec.disabledReason ?? undefined);
  return {
    action: spec.action,
    label: spec.label,
    enabled: permitted && !spec.disabledReason,
    ...(reason ? { reason } : {}),
    ...(spec.previewRequired ? { previewRequired: true } : {}),
  };
}

async function provenanceFor(deps: Deps, tx: TxContext, propertyId: string) {
  if (tx.environment === 'trial') return 'copied' as const;
  const a = await deps.ports.platform.getDataAuthority(tx, propertyId, 'availability');
  return a.authority === 'external' ? ('external' as const) : undefined;
}

// ───────────────────────────── Unit ─────────────────────────────

export async function unitRecord(deps: Deps, tx: TxContext, unit: Unit): Promise<UnitRecord> {
  const bd = await deps.ports.platform.getBusinessDate(tx, unit.propertyId);
  const tonight = { from: bd, to: addDays(bd, 1) };
  const ahead = { from: bd, to: addDays(bd, 366) };
  const [blocksTonight, upcomingBlocks, assignedTonight, futureAssignments] = await Promise.all([
    loadActiveBlocks(tx, { unitIds: [unit.id], span: tonight }),
    loadActiveBlocks(tx, { unitIds: [unit.id], span: ahead }),
    loadAssignments(tx, { unitIds: [unit.id], span: tonight }),
    loadAssignments(tx, { unitIds: [unit.id], span: ahead }),
  ]);
  const block = blocksTonight[0];
  const assignment = assignedTonight[0];
  const status: Record<string, string> = {
    lifecycle: unit.status,
    maintenance: block ? block.kind : 'in_service',
    assignment: assignment ? 'assigned' : 'unassigned',
  };
  const composite = unit.isComposite;
  const isComponentOfActive = unit.memberOfCompositeUnitIds.length > 0;
  const inactive = unit.status !== 'active';
  const futureCount = futureAssignments.filter((a) => a.nights.to > bd).length;
  const leaveReason = inactive
    ? `Unit ${unit.number} is already ${unit.status}.`
    : futureCount > 0
      ? `${futureCount} stay(s) are assigned to unit ${unit.number} from ${bd}; move them first.`
      : isComponentOfActive
        ? `Unit ${unit.number} is part of a combined unit; take that out of inventory first.`
        : null;
  const blockReason = composite
    ? `${unit.number} combines other units; block the physical units instead.`
    : inactive
      ? `Unit ${unit.number} is ${unit.status}.`
      : null;
  const allowedActions: RecordAction[] = [
    action(tx, unit.propertyId, {
      action: 'assign',
      label: 'Assign to a stay',
      permission: P.assignmentManage,
      disabledReason: inactive
        ? `Unit ${unit.number} is ${unit.status}.`
        : block
          ? `${KIND_LABEL[block.kind]} tonight: ${block.reason}.`
          : null,
    }),
    action(tx, unit.propertyId, {
      action: 'placeOutOfOrder',
      label: 'Put out of order',
      permission: P.blockManage,
      disabledReason: blockReason,
      previewRequired: true,
    }),
    action(tx, unit.propertyId, {
      action: 'placeOutOfService',
      label: 'Put out of service',
      permission: P.blockManage,
      disabledReason: blockReason,
      previewRequired: true,
    }),
    action(tx, unit.propertyId, {
      action: 'takeForHouseUse',
      label: 'Take for house use',
      permission: [P.blockManage, P.houseUseCreate],
      disabledReason: blockReason,
      previewRequired: true,
    }),
    action(tx, unit.propertyId, {
      action: 'releaseBlock',
      label: 'Return to service',
      permission: P.blockManage,
      disabledReason: upcomingBlocks.length === 0 ? 'No block is in force or scheduled.' : null,
    }),
    action(tx, unit.propertyId, {
      action: 'edit',
      label: 'Edit unit',
      permission: P.unitManage,
      disabledReason: unit.status === 'retired' ? 'Retired units cannot be edited.' : null,
    }),
    action(tx, unit.propertyId, {
      action: 'deactivate',
      label: 'Take out of inventory',
      permission: P.unitManage,
      disabledReason: leaveReason,
      previewRequired: true,
    }),
    action(tx, unit.propertyId, {
      action: 'viewAvailability',
      label: 'Explain availability',
      permission: P.availabilityRead,
    }),
  ];
  const issues: RecordIssue[] = [];
  for (const b of upcomingBlocks) {
    const inForce = b.nights.from <= bd;
    issues.push({
      code: `unit_${b.kind}`,
      severity: inForce ? 'warning' : 'info',
      message: `${KIND_LABEL[b.kind]}${inForce ? '' : ` from ${b.nights.from}`}: ${b.reason} (back on ${b.nights.to}).`,
      since: b.nights.from,
    });
    const stuck = futureAssignments.filter((a) => a.nights.from < b.nights.to && b.nights.from < a.nights.to);
    for (const a of stuck) {
      issues.push({
        code: 'assignment_needs_relocation',
        severity: 'blocking',
        message: `${a.ref.type} ${a.ref.id} is assigned to unit ${unit.number} during the ${KIND_LABEL[b.kind].toLowerCase()} block — relocate the guest.`,
      });
    }
  }
  if (inactive) {
    issues.push({
      code: 'unit_not_in_inventory',
      severity: 'info',
      message: `Unit ${unit.number} is ${unit.status} and not counted in availability.`,
    });
  }
  const links: RecordLink[] = [{ rel: 'unitType', type: 'unitType', id: unit.unitTypeId }];
  for (const id of unit.componentUnitIds) links.push({ rel: 'component', type: 'unit', id });
  for (const id of unit.memberOfCompositeUnitIds) links.push({ rel: 'partOf', type: 'unit', id });
  if (assignment) links.push({ rel: 'assignedTo', type: assignment.ref.type, id: assignment.ref.id });
  for (const b of upcomingBlocks)
    links.push({ rel: 'block', type: 'unitBlock', id: b.id, title: KIND_LABEL[b.kind] });
  const provenance = await provenanceFor(deps, tx, unit.propertyId);
  return {
    ...unit,
    status,
    statusAsOf: bd,
    allowedActions,
    issues,
    owner: null,
    links,
    ...(provenance ? { provenance } : {}),
  };
}

// ───────────────────────────── Unit type ─────────────────────────────

export async function unitTypeRecord(deps: Deps, tx: TxContext, type: UnitType): Promise<UnitTypeRecord> {
  const bd = await deps.ports.platform.getBusinessDate(tx, type.propertyId);
  const [units, conflicts, usedBy] = await Promise.all([
    idb(tx)
      .selectFrom('inventory.units')
      .select(['id', 'status'])
      .where('unit_type_id', '=', type.id)
      .execute(),
    idb(tx)
      .selectFrom('inventory.conflicts')
      .select(['night', 'shortfall', 'detected_at'])
      .where('unit_type_id', '=', type.id)
      .where('status', '<>', 'resolved')
      .where('night', '>=', bd)
      .orderBy('night')
      .execute(),
    sql<{ id: string }>`select distinct composite_unit_type_id as id from inventory.composite_components
      where component_unit_type_id = ${type.id}`.execute(tx.db),
  ]);
  const live = units.filter((u) => u.status !== 'retired').length;
  const allowedActions: RecordAction[] = [
    action(tx, type.propertyId, { action: 'edit', label: 'Edit unit type', permission: P.unitTypeManage }),
    action(tx, type.propertyId, {
      action: type.isComposite ? 'addCompositeUnit' : 'addUnit',
      label: type.isComposite ? 'Add combined unit' : 'Add unit',
      permission: P.unitManage,
      disabledReason: type.status === 'archived' ? 'This unit type is archived.' : null,
    }),
    action(tx, type.propertyId, {
      action: 'authorizeOverbooking',
      label: 'Authorize overbooking',
      permission: P.overbookingAuthorize,
      disabledReason: type.isComposite
        ? 'Combined units are sold with a specific unit and cannot be overbooked.'
        : null,
      previewRequired: true,
    }),
    action(tx, type.propertyId, {
      action: 'archive',
      label: 'Archive',
      permission: P.unitTypeManage,
      disabledReason:
        type.status === 'archived'
          ? 'Already archived.'
          : live > 0
            ? `${live} unit(s) still belong to this type; retire or re-home them first.`
            : null,
    }),
    action(tx, type.propertyId, {
      action: 'viewAvailability',
      label: 'Availability',
      permission: P.availabilityRead,
    }),
  ];
  const issues: RecordIssue[] = [];
  if (conflicts.length > 0) {
    issues.push({
      code: 'inventory_conflict',
      severity: 'blocking',
      message: `Oversold beyond authorization on ${conflicts.length} night(s) from ${conflicts[0]?.night} — relocate, upgrade or move stays, or authorize overbooking.`,
      since: conflicts[0]?.detected_at.toISOString(),
    });
  }
  if (live === 0 && type.status === 'active') {
    issues.push({ code: 'no_units', severity: 'info', message: 'No units yet — this type has no capacity.' });
  }
  const links: RecordLink[] = [
    ...(type.composition ?? []).map((c) => ({ rel: 'componentType', type: 'unitType', id: c.unitTypeId })),
    ...usedBy.rows.map((r) => ({ rel: 'usedByCompositeType', type: 'unitType', id: r.id })),
  ];
  const provenance = await provenanceFor(deps, tx, type.propertyId);
  return {
    ...type,
    status: { lifecycle: type.status },
    statusAsOf: bd,
    allowedActions,
    issues,
    owner: null,
    links,
    ...(provenance ? { provenance } : {}),
  };
}

// ───────────────────────────── Unit block ─────────────────────────────

export async function unitBlockRecord(deps: Deps, tx: TxContext, block: UnitBlock): Promise<UnitBlockRecord> {
  const bd = await deps.ports.platform.getBusinessDate(tx, block.propertyId);
  const eff = block.effectiveNights;
  const phase =
    block.status === 'released' && (!eff || eff.to <= bd)
      ? 'ended'
      : !eff || eff.to <= bd
        ? 'completed'
        : eff.from > bd
          ? 'scheduled'
          : 'in_effect';
  const allowedActions: RecordAction[] = [
    action(tx, block.propertyId, {
      action: 'release',
      label: 'Return to service',
      permission: P.blockManage,
      disabledReason:
        block.status === 'released'
          ? 'Already released.'
          : phase === 'completed'
            ? 'The block has already ended.'
            : null,
    }),
  ];
  const issues: RecordIssue[] = block.outstandingAssignments.map((a) => ({
    code: 'assignment_needs_relocation',
    severity: 'blocking' as const,
    message: `${a.ref.type} ${a.ref.id} is still assigned to unit ${block.unitNumber} for nights ${a.nights.from} to ${a.nights.to} — relocate the guest.`,
  }));
  const links: RecordLink[] = [
    { rel: 'unit', type: 'unit', id: block.unitId, title: block.unitNumber },
    { rel: 'unitType', type: 'unitType', id: block.unitTypeId },
    ...(block.sourceRef ? [{ rel: 'source', type: block.sourceRef.type, id: block.sourceRef.id }] : []),
    ...block.affectedAssignments.map((a) => ({ rel: 'affected', type: a.ref.type, id: a.ref.id })),
  ];
  return {
    ...block,
    status: { block: block.status, phase },
    statusAsOf: bd,
    allowedActions,
    issues,
    owner: null,
    links,
  };
}

// ───────────────────────────── Inventory conflict ─────────────────────────────

export async function conflictRecord(
  _deps: Deps,
  tx: TxContext,
  c: InventoryConflict,
): Promise<InventoryConflictRecord> {
  const open = c.status !== 'resolved';
  const allowedActions: RecordAction[] = [
    action(tx, c.propertyId, {
      action: 'takeOwnership',
      label: 'Take ownership',
      permission: P.availabilityManage,
      disabledReason: !open ? 'Resolved.' : null,
    }),
    action(tx, c.propertyId, {
      action: 'markResolving',
      label: 'Mark as being resolved',
      permission: P.availabilityManage,
      disabledReason: !open ? 'Resolved.' : c.status === 'resolving' ? 'Already being resolved.' : null,
    }),
    action(tx, c.propertyId, {
      action: 'authorizeOverbooking',
      label: 'Authorize overbooking for this night',
      permission: P.overbookingAuthorize,
      disabledReason: !open ? 'Resolved.' : null,
      previewRequired: true,
    }),
    action(tx, c.propertyId, {
      action: 'viewAvailability',
      label: 'Explain availability',
      permission: P.availabilityRead,
    }),
  ];
  const owner = c.ownerUserId ? { kind: 'user' as const, id: c.ownerUserId } : null;
  const issues: RecordIssue[] = open
    ? [
        {
          code: 'oversold',
          severity: 'blocking',
          message: `Oversold by ${c.shortfall} on the night of ${c.night} beyond authorized overbooking. Relocate, upgrade or move a stay, restore a unit to service, or authorize overbooking.`,
          since: c.detectedAt,
          ...(owner ? { owner } : {}),
        },
      ]
    : [];
  const seen = new Set<string>();
  const links: RecordLink[] = [{ rel: 'unitType', type: 'unitType', id: c.unitTypeId }];
  for (const cause of c.causes) {
    if (!cause.ref) continue;
    const key = `${cause.ref.type}:${cause.ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ rel: 'cause', type: cause.ref.type, id: cause.ref.id });
  }
  if (c.previousConflictId)
    links.push({ rel: 'previous', type: 'inventoryConflict', id: c.previousConflictId });
  return {
    ...c,
    status: { conflict: c.status },
    statusAsOf: c.night,
    allowedActions,
    issues,
    owner,
    links,
  };
}

// ───────────────────────────── Block preview ─────────────────────────────

class PreviewRollback extends Error {
  constructor(readonly result: UnitBlockPreview) {
    super('preview');
  }
}

/**
 * "What happens if this unit goes out of order?" — runs the real blockUnit inside a savepoint and rolls it back,
 * so the preview is computed by exactly the code that would commit (affected stays, nights that would oversell).
 */
export async function previewBlock(
  deps: Deps,
  tx: TxContext,
  input: BlockUnitInput,
): Promise<UnitBlockPreview> {
  const nights = nightsOfRange(input.nights);
  const sp = sql.raw('inv_block_preview');
  await sql`savepoint ${sp}`.execute(tx.db);
  try {
    const result = await blockUnit(deps, tx, input);
    const [unit] = await loadUnits(tx, { ids: [input.unitId] });
    const cells = unit
      ? await getAvailability(deps, tx, {
          propertyId: unit.propertyId,
          unitTypeIds: [unit.unitTypeId],
          range: { from: nights[0] as LocalDate, to: input.nights.to },
        }).catch(() => [])
      : [];
    const oversold = cells.filter((c) => c.oversoldBy > 0);
    throw new PreviewRollback({
      affectedAssignments: result.affectedAssignments,
      oversoldNights: oversold.map((c) => ({
        unitTypeId: c.unitTypeId,
        night: c.date,
        shortfall: c.oversoldBy,
      })),
      availabilityAfter: cells,
    });
  } catch (err) {
    await sql`rollback to savepoint ${sp}`.execute(tx.db);
    await sql`release savepoint ${sp}`.execute(tx.db);
    if (err instanceof PreviewRollback) return err.result;
    throw err;
  }
}
