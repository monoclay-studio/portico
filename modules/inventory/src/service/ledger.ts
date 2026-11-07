import { sql, type TxContext } from '@portico/db';
import { type EntityRef, eachNight, isUuid, type LocalDate, NotFoundError, newId } from '@portico/kernel';
import {
  availableOf,
  type CellCounts,
  type CompositeAvailability,
  type ConflictCauseKind,
  compositeAvailability,
  conflictAction,
  resolutionFor,
} from '../domain/availability';
import { type CellRef, cellKey, compareCells, lockOrder, spanOf } from '../domain/ranges';
import { INVENTORY_EVENTS } from '../events';
import { actorName, isoRequired } from './context';
import {
  type CompositeNight,
  type CompositeStructure,
  compositeNight,
  compositeTypesContainingTypes,
  loadCompositeStructures,
  loadOccupancy,
  type OccupancyIndex,
} from './occupancy';

export interface TypeInfo {
  id: string;
  propertyId: string;
  code: string;
  name: string;
  noun: string;
  isComposite: boolean;
  status: 'active' | 'archived';
}

export interface LockedCell extends CellCounts {
  unitTypeId: string;
  night: LocalDate;
  version: number;
  dirty: boolean;
}

export interface ChangeCause {
  kind: ConflictCauseKind;
  ref?: EntityRef | null;
  note?: string | null;
}

export interface CompositeCellState extends CompositeNight {
  availability: CompositeAvailability;
  unassignedSold: number;
}

export async function loadTypes(tx: TxContext, ids: readonly string[]): Promise<Map<string, TypeInfo>> {
  const out = new Map<string, TypeInfo>();
  ids = ids.filter((id) => isUuid(id));
  if (ids.length === 0) return out;
  const { rows } = await sql<{
    id: string;
    property_id: string;
    code: string;
    name: string;
    noun: string;
    is_composite: boolean;
    status: 'active' | 'archived';
  }>`select id, property_id, code, name, noun, is_composite, status from inventory.unit_types
     where id = any(${[...new Set(ids)]}::uuid[])`.execute(tx.db);
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      propertyId: r.property_id,
      code: r.code,
      name: r.name,
      noun: r.noun,
      isComposite: r.is_composite,
      status: r.status,
    });
  }
  return out;
}

/** Load one unit type and check it belongs to the property (NotFound otherwise — never leak other properties). */
export async function requireType(tx: TxContext, unitTypeId: string, propertyId?: string): Promise<TypeInfo> {
  const t = (await loadTypes(tx, [unitTypeId])).get(unitTypeId);
  if (!t || (propertyId && t.propertyId !== propertyId)) throw new NotFoundError('unit_type', unitTypeId);
  return t;
}

interface ExpiredHoldRow {
  id: string;
  unit_type_id: string;
  ref_type: string;
  ref_id: string;
  from: string;
  to: string;
  quantity: number;
  component_quantities: Array<{ unitTypeId: string; quantity: number }>;
}

/**
 * A command's view of the availability ledger. `open` locks every affected (unit type, night) row in the global
 * order (unit types FOR SHARE → ledger rows FOR UPDATE ascending by (unitTypeId, night)), lazily expires holds and
 * overbooking allowances on those rows, and then lets the command compute on locked numbers. Writes happen in
 * `finish`, which also keeps inventory-conflict records in step with the numbers (INV-I03) and emits coalescible
 * `inventory.availability.changed` events.
 */
export class LedgerSession {
  readonly cells = new Map<string, LockedCell>();
  readonly types = new Map<string, TypeInfo>();
  readonly composites = new Map<string, CompositeStructure>();
  private readonly touched = new Map<string, Set<LocalDate>>();
  private occupancyCache: { key: string; index: OccupancyIndex } | null = null;

  private constructor(
    readonly tx: TxContext,
    readonly propertyId: string,
  ) {}

  static async open(tx: TxContext, propertyId: string, targets: readonly CellRef[]): Promise<LedgerSession> {
    const s = new LedgerSession(tx, propertyId);
    let cells = lockOrder(targets);
    // Unit types (and composite structures, whose component cells must be locked too)
    await s.addTypes(cells.map((c) => c.unitTypeId));
    cells = s.expandComposites(cells);

    // Expired holds overlapping the cells: lock every cell they occupy so they can be released consistently.
    const expired = await s.findExpiredHolds(cells);
    for (const h of expired) {
      const nights = nightsOf(h.from, h.to);
      cells.push(...nights.map((night) => ({ unitTypeId: h.unit_type_id, night })));
      for (const c of h.component_quantities)
        cells.push(...nights.map((night) => ({ unitTypeId: c.unitTypeId, night })));
    }
    await s.addTypes(cells.map((c) => c.unitTypeId));
    cells = lockOrder(s.expandComposites(cells));
    if (cells.length === 0) return s;

    const typeIds = [...new Set(cells.map((c) => c.unitTypeId))].sort();
    // 1) unit types FOR SHARE — serializes with capacity changes (unit created/retired), which take FOR UPDATE
    await sql`select id from inventory.unit_types where id = any(${typeIds}::uuid[]) order by id for share`.execute(
      tx.db,
    );
    // 2) create missing ledger rows (capacity from active units), in lock order
    const ut = cells.map((c) => c.unitTypeId);
    const nt = cells.map((c) => c.night);
    await sql`
      insert into inventory.ledger (tenant_id, property_id, unit_type_id, night, capacity)
      select ${tx.tenantId}::uuid, ${propertyId}::uuid, t.unit_type_id, t.night,
        (select count(*)::int from inventory.units u
          where u.unit_type_id = t.unit_type_id and u.status = 'active'
            and u.in_inventory_from <= t.night and (u.in_inventory_to is null or t.night < u.in_inventory_to))
      from unnest(${ut}::uuid[], ${nt}::date[]) as t(unit_type_id, night)
      order by t.unit_type_id, t.night
      on conflict (unit_type_id, night) do nothing`.execute(tx.db);
    // 3) lock ledger rows in deterministic order
    const { rows } = await sql<{
      unit_type_id: string;
      night: string;
      capacity: number;
      out_of_order: number;
      sold: number;
      held: number;
      overbooking_allowance: number;
      version: number;
    }>`
      select l.unit_type_id, l.night::text as night, l.capacity, l.out_of_order, l.sold, l.held,
             l.overbooking_allowance, l.version
      from inventory.ledger l
      join unnest(${ut}::uuid[], ${nt}::date[]) as t(unit_type_id, night)
        on l.unit_type_id = t.unit_type_id and l.night = t.night
      order by l.unit_type_id, l.night
      for update of l`.execute(tx.db);
    for (const r of rows) {
      s.cells.set(cellKey(r.unit_type_id, r.night), {
        unitTypeId: r.unit_type_id,
        night: r.night,
        capacity: r.capacity,
        outOfOrder: r.out_of_order,
        sold: r.sold,
        held: r.held,
        overbookingAllowance: r.overbooking_allowance,
        version: r.version,
        dirty: false,
      });
    }
    // 4) lazily release expired holds and allowances on the locked rows (INV-I09), then start clean
    const holdsExpired = await s.expireHolds(expired.map((h) => h.id));
    const allowancesExpired = await s.expireAllowances();
    if (allowancesExpired > 0) {
      // A lapsed allowance can leave sales beyond authorization: reconcile opens the conflict (INV-I03).
      await s.finish({ kind: 'allowance_change', note: 'Authorized overbooking expired' });
    } else if (holdsExpired > 0) {
      await s.finish({ kind: 'hold_closed', note: 'Expired holds released' });
    }
    return s;
  }

  private async addTypes(ids: readonly string[]): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => !this.types.has(id));
    if (missing.length === 0) return;
    const loaded = await loadTypes(this.tx, missing);
    for (const id of missing) {
      const t = loaded.get(id);
      if (!t || t.propertyId !== this.propertyId) throw new NotFoundError('unit_type', id);
      this.types.set(id, t);
    }
    const composite = missing.filter((id) => this.types.get(id)?.isComposite);
    if (composite.length > 0) {
      const structures = await loadCompositeStructures(this.tx, composite);
      for (const [id, st] of structures) this.composites.set(id, st);
      await this.addTypes([...structures.values()].flatMap((st) => [...st.perType.keys()]));
    }
  }

  private expandComposites(cells: CellRef[]): CellRef[] {
    const out = [...cells];
    for (const c of cells) {
      const st = this.composites.get(c.unitTypeId);
      if (!st) continue;
      for (const t of st.perType.keys()) out.push({ unitTypeId: t, night: c.night });
    }
    return out;
  }

  private async findExpiredHolds(cells: readonly CellRef[]): Promise<ExpiredHoldRow[]> {
    if (cells.length === 0) return [];
    const types = [...new Set(cells.map((c) => c.unitTypeId))];
    const span = spanOf(cells.map((c) => c.night));
    if (!span) return [];
    const { rows } = await sql<ExpiredHoldRow>`
      select h.id, h.unit_type_id, h.ref_type, h.ref_id, lower(h.nights)::text as from, upper(h.nights)::text as to,
             h.quantity, h.component_quantities
      from inventory.holds h
      where h.status = 'active' and h.expires_at <= ${this.tx.now}
        and h.nights && daterange(${span.from}::date, ${span.to}::date, '[)')
        and (h.unit_type_id = any(${types}::uuid[])
             or exists (select 1 from jsonb_array_elements(h.component_quantities) e
                        where (e->>'unitTypeId')::uuid = any(${types}::uuid[])))`.execute(this.tx.db);
    const keys = new Set(cells.map((c) => cellKey(c.unitTypeId, c.night)));
    return rows.filter((h) => {
      const typesOfHold = [h.unit_type_id, ...h.component_quantities.map((c) => c.unitTypeId)];
      return nightsOf(h.from, h.to).some((n) => typesOfHold.some((t) => keys.has(cellKey(t, n))));
    });
  }

  private async expireHolds(candidateIds: readonly string[]): Promise<number> {
    if (candidateIds.length === 0) return 0;
    const { rows } = await sql<ExpiredHoldRow>`
      select h.id, h.unit_type_id, h.ref_type, h.ref_id, lower(h.nights)::text as from, upper(h.nights)::text as to,
             h.quantity, h.component_quantities
      from inventory.holds h
      where h.id = any(${[...candidateIds]}::uuid[]) and h.status = 'active' and h.expires_at <= ${this.tx.now}
      order by h.id for update`.execute(this.tx.db);
    let n = 0;
    for (const h of rows) {
      const nights = nightsOf(h.from, h.to);
      const parts = [
        { unitTypeId: h.unit_type_id, quantity: h.quantity },
        ...h.component_quantities.map((c) => ({ unitTypeId: c.unitTypeId, quantity: c.quantity })),
      ];
      if (!parts.every((p) => nights.every((night) => this.has(p.unitTypeId, night)))) continue;
      for (const p of parts)
        for (const night of nights) this.adjust(p.unitTypeId, night, { held: -p.quantity });
      await sql`update inventory.holds set status = 'expired', closed_at = ${this.tx.now},
                  close_reason = 'Expired', version = version + 1 where id = ${h.id}`.execute(this.tx.db);
      await this.tx.emit({
        type: INVENTORY_EVENTS.holdExpired,
        propertyId: this.propertyId,
        aggregate: { type: 'inventoryHold', id: h.id },
        payload: {
          holdId: h.id,
          propertyId: this.propertyId,
          unitTypeId: h.unit_type_id,
          ref: { type: h.ref_type, id: h.ref_id },
          nights: { from: h.from, to: h.to },
        },
      });
      n++;
    }
    return n;
  }

  private async expireAllowances(): Promise<number> {
    const keys = [...this.cells.values()];
    if (keys.length === 0) return 0;
    const { rows } = await sql<{ id: string; unit_type_id: string; night: string; quantity: number }>`
      select a.id, a.unit_type_id, a.night::text as night, a.quantity
      from inventory.overbooking_allowances a
      join unnest(${keys.map((c) => c.unitTypeId)}::uuid[], ${keys.map((c) => c.night)}::date[]) as t(unit_type_id, night)
        on a.unit_type_id = t.unit_type_id and a.night = t.night
      where a.status = 'active' and a.expires_at is not null and a.expires_at <= ${this.tx.now}
      order by a.id for update of a`.execute(this.tx.db);
    for (const a of rows) {
      this.adjust(a.unit_type_id, a.night, { overbookingAllowance: -a.quantity });
      await sql`update inventory.overbooking_allowances set status = 'expired', closed_at = ${this.tx.now}
                where id = ${a.id}`.execute(this.tx.db);
    }
    return rows.length;
  }

  has(unitTypeId: string, night: LocalDate): boolean {
    return this.cells.has(cellKey(unitTypeId, night));
  }

  get(unitTypeId: string, night: LocalDate): LockedCell {
    const c = this.cells.get(cellKey(unitTypeId, night));
    if (!c) throw new Error(`inventory: ledger cell ${unitTypeId}/${night} was not locked by this command`);
    return c;
  }

  type(unitTypeId: string): TypeInfo {
    const t = this.types.get(unitTypeId);
    if (!t) throw new NotFoundError('unit_type', unitTypeId);
    return t;
  }

  /** Glossary formula on the locked row (non-composite types). */
  available(unitTypeId: string, night: LocalDate): number {
    return availableOf(this.get(unitTypeId, night));
  }

  adjust(unitTypeId: string, night: LocalDate, delta: Partial<CellCounts>): void {
    const c = this.get(unitTypeId, night);
    c.capacity += delta.capacity ?? 0;
    c.outOfOrder += delta.outOfOrder ?? 0;
    c.sold += delta.sold ?? 0;
    c.held += delta.held ?? 0;
    c.overbookingAllowance += delta.overbookingAllowance ?? 0;
    c.dirty = true;
  }

  /** Mark composite cells whose state changed through assignments or blocks (not through counters). */
  touchComposite(unitTypeId: string, nights: readonly LocalDate[]): void {
    if (!this.composites.has(unitTypeId)) return;
    const set = this.touched.get(unitTypeId) ?? new Set<LocalDate>();
    for (const n of nights) set.add(n);
    this.touched.set(unitTypeId, set);
  }

  /** Assignments and blocks of composite units and their components over the nights (fresh read). */
  async occupancyFor(
    unitTypeId: string,
    nights: readonly LocalDate[],
    fresh = false,
  ): Promise<OccupancyIndex> {
    const st = this.composites.get(unitTypeId);
    const span = spanOf(nights);
    if (!st || !span) return loadOccupancy(this.tx, [], { from: '2000-01-01', to: '2000-01-02' });
    const key = `${unitTypeId}|${span.from}|${span.to}`;
    if (!fresh && this.occupancyCache?.key === key) return this.occupancyCache.index;
    const unitIds = st.units.flatMap((u) => [u.unit.id, ...u.components.map((c) => c.id)]);
    const index = await loadOccupancy(this.tx, unitIds, span);
    this.occupancyCache = { key, index };
    return index;
  }

  /** INV-R07 composite availability per night, on locked counters and current assignments/blocks. */
  async compositeState(
    unitTypeId: string,
    nights: readonly LocalDate[],
    opts: { ignoreRef?: EntityRef; fresh?: boolean } = {},
  ): Promise<Map<LocalDate, CompositeCellState>> {
    const st = this.composites.get(unitTypeId);
    const out = new Map<LocalDate, CompositeCellState>();
    if (!st) return out;
    const occ = await this.occupancyFor(unitTypeId, nights, opts.fresh ?? true);
    for (const night of nights) {
      const n = compositeNight(st, night, occ, opts.ignoreRef);
      const cell = this.get(unitTypeId, night);
      const unassignedSold = Math.max(0, cell.sold - n.assignedUnits);
      const availability = compositeAvailability({
        freeUnits: n.freeUnitIds.length,
        held: cell.held,
        unassignedSold,
        components: [...st.perType].map(([t, k]) => ({
          unitTypeId: t,
          perComposite: k,
          available: this.available(t, night),
        })),
      });
      out.set(night, { ...n, availability, unassignedSold });
    }
    return out;
  }

  /** Write changed rows, reconcile inventory conflicts and emit availability events. */
  async finish(cause: ChangeCause): Promise<{ created: string[]; resolved: string[] }> {
    const dirty = [...this.cells.values()].filter((c) => c.dirty).sort(compareCells);
    await this.flush(dirty);
    const result = await this.reconcileConflicts(dirty, cause);
    await this.emitAvailabilityChanged(dirty, cause);
    for (const c of dirty) c.dirty = false;
    this.touched.clear();
    return result;
  }

  private async flush(dirty: readonly LockedCell[]): Promise<void> {
    if (dirty.length === 0) return;
    const res = await sql`
      update inventory.ledger l
         set capacity = v.capacity, out_of_order = v.ooo, sold = v.sold, held = v.held,
             overbooking_allowance = v.allowance, version = l.version + 1, updated_at = ${this.tx.now}
      from unnest(${dirty.map((c) => c.unitTypeId)}::uuid[], ${dirty.map((c) => c.night)}::date[],
                  ${dirty.map((c) => c.capacity)}::int[], ${dirty.map((c) => c.outOfOrder)}::int[],
                  ${dirty.map((c) => c.sold)}::int[], ${dirty.map((c) => c.held)}::int[],
                  ${dirty.map((c) => c.overbookingAllowance)}::int[], ${dirty.map((c) => c.version)}::int[])
        as v(unit_type_id, night, capacity, ooo, sold, held, allowance, version)
      where l.unit_type_id = v.unit_type_id and l.night = v.night and l.version = v.version`.execute(
      this.tx.db,
    );
    if (Number(res.numAffectedRows ?? 0) !== dirty.length) {
      throw new Error(
        'inventory: ledger rows changed while locked — aborting to keep availability consistent',
      );
    }
    for (const c of dirty) c.version += 1;
  }

  private async reconcileConflicts(
    dirty: readonly LockedCell[],
    cause: ChangeCause,
  ): Promise<{ created: string[]; resolved: string[] }> {
    const candidates = new Map<string, { unitTypeId: string; night: LocalDate; available: number }>();
    for (const c of dirty) {
      if (this.composites.has(c.unitTypeId)) continue;
      candidates.set(cellKey(c.unitTypeId, c.night), {
        unitTypeId: c.unitTypeId,
        night: c.night,
        available: availableOf(c),
      });
    }
    // Composite cells: a conflict means the composite units cannot honour their holds and sales.
    const compositeNights = new Map<string, Set<LocalDate>>();
    for (const c of dirty) {
      if (!this.composites.has(c.unitTypeId)) continue;
      compositeNights.set(c.unitTypeId, (compositeNights.get(c.unitTypeId) ?? new Set()).add(c.night));
    }
    for (const [t, nights] of this.touched) {
      const set = compositeNights.get(t) ?? new Set<LocalDate>();
      for (const n of nights) if (this.has(t, n)) set.add(n);
      compositeNights.set(t, set);
    }
    for (const [t, nights] of compositeNights) {
      const state = await this.compositeState(t, [...nights].sort(), { fresh: true });
      for (const [night, s] of state)
        candidates.set(cellKey(t, night), { unitTypeId: t, night, available: s.availability.unitLimit });
    }
    if (candidates.size === 0) return { created: [], resolved: [] };

    const list = [...candidates.values()];
    const { rows: open } = await sql<{
      id: string;
      unit_type_id: string;
      night: string;
      max_shortfall: number;
    }>`
      select c.id, c.unit_type_id, c.night::text as night, c.max_shortfall
      from inventory.conflicts c
      join unnest(${list.map((c) => c.unitTypeId)}::uuid[], ${list.map((c) => c.night)}::date[]) as t(unit_type_id, night)
        on c.unit_type_id = t.unit_type_id and c.night = t.night
      where c.status <> 'resolved'
      for update of c`.execute(this.tx.db);
    const openByKey = new Map(open.map((o) => [cellKey(o.unit_type_id, o.night), o]));
    const causeJson = {
      at: isoRequired(this.tx.now),
      kind: cause.kind,
      by: actorName(this.tx),
      ref: cause.ref ?? null,
      note: cause.note ?? null,
    };
    const created: string[] = [];
    const resolved: string[] = [];
    for (const c of list) {
      const existing = openByKey.get(cellKey(c.unitTypeId, c.night));
      const action = conflictAction(existing !== undefined, c.available);
      const shortfall = -c.available;
      if (action === 'open') {
        const id = newId();
        await sql`
          insert into inventory.conflicts (id, tenant_id, property_id, unit_type_id, night, shortfall, max_shortfall,
                                           causes, status, detected_at, previous_conflict_id)
          values (${id}, ${this.tx.tenantId}, ${this.propertyId}, ${c.unitTypeId}, ${c.night}::date, ${shortfall},
                  ${shortfall}, ${JSON.stringify([causeJson])}::jsonb, 'open', ${this.tx.now},
                  (select p.id from inventory.conflicts p where p.unit_type_id = ${c.unitTypeId}
                     and p.night = ${c.night}::date and p.status = 'resolved' order by p.resolved_at desc limit 1))`.execute(
          this.tx.db,
        );
        created.push(id);
        await this.tx.audit({
          action: 'inventory.conflict.detect',
          target: { type: 'inventoryConflict', id },
          propertyId: this.propertyId,
          after: { unitTypeId: c.unitTypeId, night: c.night, shortfall, cause: causeJson },
        });
        await this.tx.emit({
          type: INVENTORY_EVENTS.conflictDetected,
          propertyId: this.propertyId,
          aggregate: { type: 'inventoryConflict', id },
          payload: {
            conflictId: id,
            propertyId: this.propertyId,
            unitTypeId: c.unitTypeId,
            night: c.night,
            shortfall,
          },
        });
      } else if (action === 'update' && existing) {
        await sql`
          update inventory.conflicts
             set shortfall = ${shortfall}, max_shortfall = greatest(max_shortfall, ${shortfall}),
                 causes = (case when jsonb_array_length(causes) >= 50 then causes - 0 else causes end)
                          || ${JSON.stringify([causeJson])}::jsonb,
                 version = version + 1
           where id = ${existing.id}`.execute(this.tx.db);
      } else if (action === 'resolve' && existing) {
        const resolution = resolutionFor(cause.kind);
        await sql`
          update inventory.conflicts
             set status = 'resolved', shortfall = 0, resolution = ${resolution}, resolved_at = ${this.tx.now},
                 causes = causes || ${JSON.stringify([causeJson])}::jsonb, version = version + 1
           where id = ${existing.id}`.execute(this.tx.db);
        resolved.push(existing.id);
        await this.tx.audit({
          action: 'inventory.conflict.resolve',
          target: { type: 'inventoryConflict', id: existing.id },
          propertyId: this.propertyId,
          after: { resolution, cause: causeJson },
        });
        await this.tx.emit({
          type: INVENTORY_EVENTS.conflictResolved,
          propertyId: this.propertyId,
          aggregate: { type: 'inventoryConflict', id: existing.id },
          payload: {
            conflictId: existing.id,
            propertyId: this.propertyId,
            unitTypeId: c.unitTypeId,
            night: c.night,
            shortfall: 0,
            resolution,
          },
        });
      }
    }
    return { created, resolved };
  }

  private async emitAvailabilityChanged(dirty: readonly LockedCell[], cause: ChangeCause): Promise<void> {
    const byType = new Map<string, Set<LocalDate>>();
    const add = (t: string, n: LocalDate) => byType.set(t, (byType.get(t) ?? new Set()).add(n));
    for (const c of dirty) add(c.unitTypeId, c.night);
    for (const [t, nights] of this.touched) for (const n of nights) add(t, n);
    if (byType.size === 0) return;
    // Selling a component type changes the availability of composite types built from it.
    const dependents = await compositeTypesContainingTypes(this.tx, [...byType.keys()]);
    for (const [component, composites] of dependents) {
      const nights = byType.get(component);
      if (!nights) continue;
      for (const comp of composites) for (const n of nights) add(comp, n);
    }
    for (const [unitTypeId, nights] of [...byType].sort(([a], [b]) => a.localeCompare(b))) {
      const range = spanOf([...nights]);
      if (!range) continue;
      await this.tx.emit({
        type: INVENTORY_EVENTS.availabilityChanged,
        propertyId: this.propertyId,
        aggregate: { type: 'unitType', id: unitTypeId },
        payload: {
          propertyId: this.propertyId,
          unitTypeId,
          range,
          coalesceKey: `inventory.availability:${unitTypeId}`,
          cause: cause.kind,
        },
      });
    }
  }
}

export function nightsOf(from: LocalDate, to: LocalDate): LocalDate[] {
  return from < to ? eachNight({ from, to }) : [];
}

export type { CellRef };
