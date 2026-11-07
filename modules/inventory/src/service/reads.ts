import { sql, type TxContext } from '@portico/db';
import {
  addDays,
  type DateRange,
  isUuid,
  type LocalDate,
  NotFoundError,
  requirePermission,
} from '@portico/kernel';
import type { AvailabilityCell, AvailabilityExplanation, AvailabilityGrid } from '../contracts';
import {
  availableOf,
  type CellCounts,
  cellStatus,
  compositeAvailability,
  overbookingInUse,
  oversoldBy,
} from '../domain/availability';
import { explain } from '../domain/explain';
import { cellKey, MAX_READ_NIGHTS, nightsOfRange } from '../domain/ranges';
import { INVENTORY_PERMISSIONS } from '../manifest';
import type { DataAuthorityView } from '../ports';
import { type Deps, idb } from './context';
import { listActiveHolds } from './holds';
import { loadTypes, nightsOf, type TypeInfo } from './ledger';
import {
  type CompositeStructure,
  compositeNight,
  loadActiveBlocks,
  loadCompositeStructures,
  loadOccupancy,
  loadUnits,
  type UnitLite,
  unitActiveOn,
} from './occupancy';
import { toAllowance, toConflict } from './overbooking';

interface CellBuild {
  /** Requested unit types in display order. */
  order: string[];
  types: Map<string, TypeInfo>;
  composites: Map<string, CompositeStructure>;
  units: UnitLite[];
  cells: Map<string, AvailabilityCell>;
}

/**
 * Build availability cells from committed rows (strongly consistent with committed transactions; no cache).
 * Rows that do not exist yet mean "nothing happened on this night": capacity comes from the active units.
 * Holds and allowances that expired but were not yet swept are already excluded, exactly as a command would.
 */
async function buildCells(
  tx: TxContext,
  propertyId: string,
  requestedTypeIds: readonly string[] | null,
  nights: readonly LocalDate[],
): Promise<CellBuild> {
  const range: DateRange = { from: nights[0] as string, to: addDays(nights[nights.length - 1] as string, 1) };
  let typeIds: string[];
  if (requestedTypeIds) {
    typeIds = [...new Set(requestedTypeIds)];
    const invalid = typeIds.find((id) => !isUuid(id));
    if (invalid) throw new NotFoundError('unit_type', invalid);
  } else {
    const rows = await idb(tx)
      .selectFrom('inventory.unit_types')
      .select('id')
      .where('property_id', '=', propertyId)
      .where('status', '=', 'active')
      .orderBy('sort_order')
      .orderBy('code')
      .execute();
    typeIds = rows.map((r) => r.id);
  }
  const types = await loadTypes(tx, typeIds);
  for (const id of typeIds) {
    const t = types.get(id);
    if (!t || t.propertyId !== propertyId) throw new NotFoundError('unit_type', id);
  }
  const composites = await loadCompositeStructures(
    tx,
    typeIds.filter((id) => types.get(id)?.isComposite),
  );
  // Component types are needed to compute composite availability even if not requested.
  const componentTypeIds = [...composites.values()].flatMap((s) => [...s.perType.keys()]);
  const extra = componentTypeIds.filter((id) => !types.has(id));
  for (const [id, t] of await loadTypes(tx, extra)) types.set(id, t);
  const allTypeIds = [...types.keys()];

  const units = await loadUnits(tx, { unitTypeIds: allTypeIds });
  const ledger = await idb(tx)
    .selectFrom('inventory.ledger')
    .select(['unit_type_id', 'night', 'capacity', 'out_of_order', 'sold', 'held', 'overbooking_allowance'])
    .where(
      'unit_type_id',
      'in',
      allTypeIds.length > 0 ? allTypeIds : ['00000000-0000-0000-0000-000000000000'],
    )
    .where('night', '>=', range.from)
    .where('night', '<', range.to)
    .execute();
  const ledgerByKey = new Map(ledger.map((l) => [cellKey(l.unit_type_id, l.night), l]));
  const heldAdjust = new Map<string, number>();
  const { rows: expiredHolds } = await sql<{
    unit_type_id: string;
    from: string;
    to: string;
    quantity: number;
    component_quantities: Array<{ unitTypeId: string; quantity: number }>;
  }>`
    select unit_type_id, lower(nights)::text as from, upper(nights)::text as to, quantity, component_quantities
    from inventory.holds
    where property_id = ${propertyId} and status = 'active' and expires_at <= ${tx.now}
      and nights && daterange(${range.from}::date, ${range.to}::date, '[)')`.execute(tx.db);
  for (const h of expiredHolds) {
    for (const n of nightsOf(h.from, h.to)) {
      const k = cellKey(h.unit_type_id, n);
      heldAdjust.set(k, (heldAdjust.get(k) ?? 0) + h.quantity);
      for (const c of h.component_quantities) {
        const ck = cellKey(c.unitTypeId, n);
        heldAdjust.set(ck, (heldAdjust.get(ck) ?? 0) + c.quantity);
      }
    }
  }
  const { rows: expiredAllowances } = await sql<{ unit_type_id: string; night: string; quantity: number }>`
    select unit_type_id, night::text as night, quantity from inventory.overbooking_allowances
    where property_id = ${propertyId} and status = 'active' and expires_at is not null and expires_at <= ${tx.now}
      and night >= ${range.from}::date and night < ${range.to}::date`.execute(tx.db);
  const allowanceAdjust = new Map<string, number>();
  for (const a of expiredAllowances) {
    const k = cellKey(a.unit_type_id, a.night);
    allowanceAdjust.set(k, (allowanceAdjust.get(k) ?? 0) + a.quantity);
  }
  const blocks = await loadActiveBlocks(tx, { propertyId, span: range });
  const oos = new Map<string, number>();
  const houseUse = new Map<string, number>();
  for (const b of blocks) {
    if (b.kind === 'out_of_order') continue;
    for (const n of nightsOf(b.nights.from, b.nights.to)) {
      if (n < range.from || n >= range.to) continue;
      const target = b.kind === 'out_of_service' ? oos : houseUse;
      const k = cellKey(b.unitTypeId, n);
      target.set(k, (target.get(k) ?? 0) + 1);
    }
  }
  const { rows: conflicts } = await sql<{ id: string; unit_type_id: string; night: string }>`
    select id, unit_type_id, night::text as night from inventory.conflicts
    where property_id = ${propertyId} and status <> 'resolved'
      and night >= ${range.from}::date and night < ${range.to}::date`.execute(tx.db);
  const conflictByKey = new Map(conflicts.map((c) => [cellKey(c.unit_type_id, c.night), c.id]));

  const counts = new Map<string, CellCounts>();
  for (const t of allTypeIds) {
    const typeUnits = units.filter((u) => u.unitTypeId === t);
    for (const n of nights) {
      const k = cellKey(t, n);
      const l = ledgerByKey.get(k);
      counts.set(k, {
        capacity: l ? l.capacity : typeUnits.filter((u) => unitActiveOn(u, n)).length,
        outOfOrder: l?.out_of_order ?? 0,
        sold: l?.sold ?? 0,
        held: Math.max(0, (l?.held ?? 0) - (heldAdjust.get(k) ?? 0)),
        overbookingAllowance: Math.max(0, (l?.overbooking_allowance ?? 0) - (allowanceAdjust.get(k) ?? 0)),
      });
    }
  }

  let occupancy = null as Awaited<ReturnType<typeof loadOccupancy>> | null;
  if (composites.size > 0) {
    const ids = [...composites.values()].flatMap((s) =>
      s.units.flatMap((u) => [u.unit.id, ...u.components.map((c) => c.id)]),
    );
    occupancy = await loadOccupancy(tx, ids, range);
  }

  const cells = new Map<string, AvailabilityCell>();
  for (const t of allTypeIds) {
    const st = composites.get(t);
    for (const n of nights) {
      const k = cellKey(t, n);
      const c = counts.get(k) as CellCounts;
      let available = availableOf(c);
      let composite: AvailabilityCell['composite'] = null;
      let status = cellStatus(c, available);
      let over = oversoldBy(c);
      if (st && occupancy) {
        const night = compositeNight(st, n, occupancy);
        const unassignedSold = Math.max(0, c.sold - night.assignedUnits);
        const a = compositeAvailability({
          freeUnits: night.freeUnitIds.length,
          held: c.held,
          unassignedSold,
          components: [...st.perType].map(([ct, kk]) => ({
            unitTypeId: ct,
            perComposite: kk,
            available: availableOf(counts.get(cellKey(ct, n)) as CellCounts),
          })),
        });
        available = a.available;
        over = Math.max(0, -a.unitLimit);
        status =
          over > 0 ? 'oversold' : c.capacity === 0 ? 'closed' : available > 0 ? 'available' : 'sold_out';
        composite = {
          totalUnits: night.totalUnits,
          freeUnits: night.freeUnitIds.length,
          unassignedSold,
          unitLimit: a.unitLimit,
          componentLimit: a.componentLimit,
          limitingComponentTypeId: a.limitingComponentTypeId,
        };
      }
      cells.set(k, {
        unitTypeId: t,
        date: n,
        capacity: c.capacity,
        outOfOrder: c.outOfOrder,
        sold: c.sold,
        held: c.held,
        overbookingAllowance: c.overbookingAllowance,
        available,
        outOfService: oos.get(k) ?? 0,
        houseUse: houseUse.get(k) ?? 0,
        overbookingInUse: st ? 0 : overbookingInUse(c),
        oversoldBy: over,
        conflictId: conflictByKey.get(k) ?? null,
        status,
        composite,
      });
    }
  }
  return { order: typeIds, types, composites, units, cells };
}

/**
 * Availability grid by unit type × night with the full breakdown (INV-R29). Provider call (distribution,
 * reservations, day-close) and HTTP read.
 */
export async function getAvailability(
  _deps: Deps,
  tx: TxContext,
  input: { propertyId: string; unitTypeIds?: string[]; range: DateRange },
): Promise<AvailabilityCell[]> {
  requirePermission(tx, INVENTORY_PERMISSIONS.availabilityRead, { propertyId: input.propertyId });
  const nights = nightsOfRange(input.range, MAX_READ_NIGHTS, 'range');
  const requested = input.unitTypeIds && input.unitTypeIds.length > 0 ? input.unitTypeIds : null;
  const build = await buildCells(tx, input.propertyId, requested, nights);
  const out: AvailabilityCell[] = [];
  for (const t of build.order) {
    for (const n of nights) {
      const c = build.cells.get(cellKey(t, n));
      if (c) out.push(c);
    }
  }
  return out;
}

function provenanceOf(tx: TxContext, authority: DataAuthorityView): AvailabilityGrid['provenance'] {
  if (tx.environment === 'trial') return 'copied';
  return authority.authority === 'external' ? 'external' : 'live';
}

export async function getAvailabilityGrid(
  deps: Deps,
  tx: TxContext,
  input: { propertyId: string; unitTypeIds?: string[]; range: DateRange },
): Promise<AvailabilityGrid> {
  const cells = await getAvailability(deps, tx, input);
  const authority = await deps.ports.platform.getDataAuthority(tx, input.propertyId, 'availability');
  const typeIds = [...new Set(cells.map((c) => c.unitTypeId))];
  const typeRows =
    typeIds.length > 0
      ? await idb(tx)
          .selectFrom('inventory.unit_types')
          .select(['id', 'code', 'name', 'noun', 'is_composite', 'sort_order'])
          .where('id', 'in', typeIds)
          .orderBy('sort_order')
          .orderBy('code')
          .execute()
      : [];
  return {
    propertyId: input.propertyId,
    range: { from: input.range.from, to: input.range.to },
    generatedAt: tx.now.toISOString(),
    provenance: provenanceOf(tx, authority),
    authority: {
      authority: authority.authority,
      systemName: authority.systemName,
      writeMode: authority.writeMode,
    },
    unitTypes: typeRows.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      noun: t.noun,
      isComposite: t.is_composite,
    })),
    cells,
  };
}

/**
 * Why a unit type is available / unavailable / held / blocked / oversold on a night (INV-R28): the formula with
 * every term, the records behind each number, and sentences a desk agent can act on.
 */
export async function explainAvailability(
  deps: Deps,
  tx: TxContext,
  input: { propertyId: string; unitTypeId: string; date: LocalDate },
): Promise<AvailabilityExplanation> {
  requirePermission(tx, INVENTORY_PERMISSIONS.availabilityRead, { propertyId: input.propertyId });
  const [night] = nightsOfRange({ from: input.date, to: addDays(input.date, 1) }, 1, 'date');
  const date = night as LocalDate;
  const build = await buildCells(tx, input.propertyId, [input.unitTypeId], [date]);
  const type = build.types.get(input.unitTypeId) as TypeInfo;
  const cell = build.cells.get(cellKey(type.id, date)) as AvailabilityCell;
  const st = build.composites.get(type.id);
  const span = { from: date, to: addDays(date, 1) };

  // Units and their state on the night
  const typeUnits = build.units.filter((u) => u.unitTypeId === type.id);
  const componentUnits = st ? st.units.flatMap((u) => u.components) : [];
  const occ = await loadOccupancy(
    tx,
    [...typeUnits, ...componentUnits].map((u) => u.id),
    span,
  );
  const parentIds = [...typeUnits, ...componentUnits]
    .map((u) => occ.assignmentOn(u.id, date)?.parentId)
    .filter((p): p is string => typeof p === 'string');
  const parentUnit = new Map<string, string>();
  if (parentIds.length > 0) {
    const { rows } = await sql<{ id: string; unit_id: string }>`
      select id, unit_id from inventory.assignments where id = any(${parentIds}::uuid[])`.execute(tx.db);
    for (const r of rows) parentUnit.set(r.id, r.unit_id);
  }
  const units: AvailabilityExplanation['units'] = typeUnits.map((u) => {
    const base = {
      unitId: u.id,
      number: u.number,
      ref: null,
      viaCompositeUnitId: null,
      blockId: null,
      reason: null,
      until: null,
    };
    if (!unitActiveOn(u, date))
      return {
        ...base,
        state: 'inactive' as const,
        reason: `Unit is ${u.status} or outside its inventory dates.`,
      };
    const block = occ.blockOn(u.id, date);
    if (block)
      return { ...base, state: block.kind, blockId: block.id, reason: block.reason, until: block.nights.to };
    const a = occ.assignmentOn(u.id, date);
    if (a) {
      return {
        ...base,
        state: 'assigned' as const,
        ref: a.ref,
        viaCompositeUnitId: a.parentId ? (parentUnit.get(a.parentId) ?? null) : null,
      };
    }
    if (st) {
      const info = st.units.find((x) => x.unit.id === u.id);
      for (const c of info?.components ?? []) {
        const cb = occ.blockOn(c.id, date);
        if (cb)
          return {
            ...base,
            state: cb.kind,
            blockId: cb.id,
            reason: `Component ${c.number}: ${cb.reason}`,
            until: cb.nights.to,
          };
        const ca = occ.assignmentOn(c.id, date);
        if (ca)
          return {
            ...base,
            state: 'assigned' as const,
            ref: ca.ref,
            reason: `Component ${c.number} is assigned.`,
          };
        if (!unitActiveOn(c, date))
          return { ...base, state: 'inactive' as const, reason: `Component ${c.number} is not in service.` };
      }
    }
    return { ...base, state: 'free' as const };
  });

  const consumption = await idb(tx)
    .selectFrom('inventory.consumptions')
    .select(['ref_type', 'ref_id', 'quantity', 'kind'])
    .where('unit_type_id', '=', type.id)
    .where('night', '=', date)
    .orderBy('created_at')
    .execute();
  const holds = await listActiveHolds(tx, { propertyId: input.propertyId, unitTypeId: type.id, span });
  const allowances = (
    await idb(tx)
      .selectFrom('inventory.overbooking_allowances')
      .selectAll()
      .where('unit_type_id', '=', type.id)
      .where('night', '=', date)
      .where('status', '=', 'active')
      .execute()
  )
    .filter((a) => !a.expires_at || a.expires_at.getTime() > tx.now.getTime())
    .map((a) => toAllowance(a));
  const conflictRow = await idb(tx)
    .selectFrom('inventory.conflicts')
    .selectAll()
    .where('unit_type_id', '=', type.id)
    .where('night', '=', date)
    .where('status', '<>', 'resolved')
    .executeTakeFirst();
  const conflict = conflictRow ? toConflict(conflictRow) : null;

  const stayRefs = consumption.filter((c) => c.kind === 'stay');
  const assignedRefs = new Set(
    typeUnits
      .map((u) => occ.assignmentOn(u.id, date))
      .filter((a) => a !== undefined)
      .map((a) => `${a?.ref.type}:${a?.ref.id}`),
  );
  const sum = (kind: string) =>
    consumption.filter((c) => c.kind === kind).reduce((s, c) => s + c.quantity, 0);
  const blockFacts = (kind: 'out_of_order' | 'out_of_service' | 'house_use') =>
    units
      .filter((u) => u.state === kind && u.blockId && !u.reason?.startsWith('Component'))
      .map((u) => ({ number: u.number, reason: u.reason ?? '', until: u.until ?? '' }));

  const componentNotes: string[] = [];
  if (st && cell.composite) {
    for (const [ct, k] of st.perType) {
      const compCell = build.cells.get(cellKey(ct, date));
      const name = build.types.get(ct)?.name ?? ct;
      componentNotes.push(
        `${name}: ${compCell?.available ?? 0} available; each ${type.noun.toLowerCase()} needs ${k} → allows ${Math.floor((compCell?.available ?? 0) / k)}.`,
      );
    }
    for (const u of units.filter((x) => x.state !== 'free' && x.reason)) {
      componentNotes.push(`${type.noun} ${u.number}: ${u.reason}`);
    }
  }
  const text = explain({
    typeName: type.name,
    noun: type.noun,
    date,
    counts: {
      capacity: cell.capacity,
      outOfOrder: cell.outOfOrder,
      sold: cell.sold,
      held: cell.held,
      overbookingAllowance: cell.overbookingAllowance,
    },
    available: cell.available,
    inactiveUnits: units.filter((u) => u.state === 'inactive' && !u.reason?.startsWith('Component')).length,
    outOfOrder: blockFacts('out_of_order'),
    outOfService: blockFacts('out_of_service'),
    houseUse: blockFacts('house_use'),
    sold: {
      stays: stayRefs.reduce((s, c) => s + c.quantity, 0),
      assignedStays: stayRefs.filter((c) => assignedRefs.has(`${c.ref_type}:${c.ref_id}`)).length,
      houseUse: sum('house_use'),
      blockAllocations: sum('block_allocation'),
      compositeComponents: sum('composite_component'),
      imports: sum('import'),
    },
    holds: holds.map((h) => ({
      refLabel: `${h.ref.type} ${h.ref.id}`,
      quantity: h.quantity,
      expiresAt: h.expiresAt,
    })),
    allowances: allowances.map((a) => ({
      quantity: a.quantity,
      reason: a.reason,
      authorizedBy: a.authorizedBy,
      kind: a.kind,
    })),
    conflict: conflict
      ? { shortfall: conflict.shortfall, status: conflict.status, detectedAt: conflict.detectedAt }
      : null,
    composite: cell.composite
      ? {
          available: cell.available,
          unitLimit: cell.composite.unitLimit,
          componentLimit: cell.composite.componentLimit,
          limitingComponentTypeId: cell.composite.limitingComponentTypeId,
          totalUnits: cell.composite.totalUnits,
          freeUnits: cell.composite.freeUnits,
          componentNotes,
        }
      : null,
  });
  const authority = await deps.ports.platform.getDataAuthority(tx, input.propertyId, 'availability');
  const reasons = [...text.reasons];
  if (authority.authority === 'external') {
    reasons.unshift(
      `Availability at this property is managed in ${authority.systemName ?? 'an external system'} (system of record). Portico shows what it has received; changes must be made there.`,
    );
  }
  return {
    propertyId: input.propertyId,
    unitTypeId: type.id,
    unitTypeName: type.name,
    date,
    status: cell.status,
    headline: text.headline,
    formula: text.formula,
    available: cell.available,
    terms: {
      capacity: cell.capacity,
      outOfOrder: cell.outOfOrder,
      sold: cell.sold,
      held: cell.held,
      overbookingAllowance: cell.overbookingAllowance,
    },
    reasons,
    units,
    sold: consumption.map((c) => ({
      ref: { type: c.ref_type, id: c.ref_id },
      quantity: c.quantity,
      kind: c.kind,
    })),
    holds,
    allowances,
    conflict,
    composite: cell.composite,
    provenance: provenanceOf(tx, authority),
    authority: {
      authority: authority.authority,
      systemName: authority.systemName,
      writeMode: authority.writeMode,
    },
    generatedAt: tx.now.toISOString(),
  };
}
