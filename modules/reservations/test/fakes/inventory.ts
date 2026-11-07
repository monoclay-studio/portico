import { sql, type TxContext } from '@portico/db';
import {
  addDays,
  BusinessRuleError,
  type DateRange,
  DomainError,
  type EntityRef,
  eachNight,
  type LocalDate,
  NotFoundError,
  newId,
} from '@portico/kernel';
import type {
  AvailabilityCell,
  InventoryPort,
  UnitCandidate,
  UnitSummary,
  UnitTypeSummary,
} from '../../src/ports';

/**
 * High-fidelity fake of the inventory module (InventoryPort), Postgres-backed in a test-only schema so it shares the
 * command's transaction and has REAL concurrency semantics:
 *  - consume locks the (unit type, night) rows FOR UPDATE in deterministic order and applies guarded counters —
 *    two concurrent sales of the last unit give exactly one success (S01);
 *  - consumption is keyed by (ref, type, night) → re-applying is idempotent;
 *  - assignments are protected by an exclusion constraint and a pre-check under a unit row lock;
 *  - holds expire lazily; `onShortfall: 'record_conflict'` commits and records conflicts (INV-R11).
 * Error codes match what reservations expects from the real module: `inventory_unavailable`
 * (details.shortNights) and `unit_assignment_conflict` (details.conflicts).
 */
export class FakeInventory implements InventoryPort {
  calls: Array<{ op: string; input: unknown }> = [];

  // ── test setup ──
  async seed(
    tx: TxContext,
    input: {
      propertyId: string;
      from: LocalDate;
      to: LocalDate;
      types: Array<{ code: string; name: string; rank: number; maxOccupancy: number; units: string[] }>;
    },
  ): Promise<{ types: Record<string, string>; units: Record<string, string> }> {
    const types: Record<string, string> = {};
    const units: Record<string, string> = {};
    for (const t of input.types) {
      const id = newId();
      types[t.code] = id;
      await sql`insert into fake_inventory.unit_types values (${id}, ${tx.tenantId}, ${input.propertyId}, ${t.code}, ${t.name}, ${t.rank}, ${t.maxOccupancy})`.execute(
        tx.db,
      );
      for (const u of t.units) {
        const uid = newId();
        units[u] = uid;
        await sql`insert into fake_inventory.units values (${uid}, ${tx.tenantId}, ${input.propertyId}, ${id}, ${u})`.execute(
          tx.db,
        );
      }
      for (const night of eachNight({ from: input.from, to: input.to })) {
        await sql`insert into fake_inventory.cells (tenant_id, property_id, unit_type_id, night, capacity)
                  values (${tx.tenantId}, ${input.propertyId}, ${id}, ${night}::date, ${t.units.length})`.execute(
          tx.db,
        );
      }
    }
    return { types, units };
  }

  // ── port ──
  private async lockCells(tx: TxContext, unitTypeId: string, nights: DateRange) {
    // Lazily release expired holds touching these cells (INV-I09), then lock in (type, night) order.
    const expired = await sql<{ id: string; from_date: string; to_date: string; quantity: number }>`
      update fake_inventory.holds set status = 'expired'
       where unit_type_id = ${unitTypeId} and status = 'active' and expires_at <= ${tx.now}
         and from_date < ${nights.to}::date and to_date > ${nights.from}::date
       returning id, from_date::text, to_date::text, quantity`.execute(tx.db);
    for (const h of expired.rows) {
      await sql`update fake_inventory.cells set held = held - ${h.quantity}
                 where unit_type_id = ${unitTypeId} and night >= ${h.from_date}::date and night < ${h.to_date}::date`.execute(
        tx.db,
      );
    }
    const { rows } = await sql<{
      night: string;
      capacity: number;
      out_of_order: number;
      sold: number;
      held: number;
      overbooking: number;
    }>`
      select night::text, capacity, out_of_order, sold, held, overbooking from fake_inventory.cells
       where unit_type_id = ${unitTypeId} and night >= ${nights.from}::date and night < ${nights.to}::date
       order by unit_type_id, night for update`.execute(tx.db);
    return new Map(rows.map((r) => [r.night, r]));
  }

  async consume(
    tx: TxContext,
    input: Parameters<InventoryPort['consume']>[1],
  ): Promise<{ conflictIds?: string[] } | undefined> {
    this.calls.push({ op: 'consume', input });
    const cells = await this.lockCells(tx, input.unitTypeId, input.nights);
    const existing = await sql<{ night: string }>`
      select night::text from fake_inventory.consumption
       where ref_type = ${input.ref.type} and ref_id = ${input.ref.id} and unit_type_id = ${input.unitTypeId}
         and night >= ${input.nights.from}::date and night < ${input.nights.to}::date`.execute(tx.db);
    const already = new Set(existing.rows.map((r) => r.night));
    const nights = eachNight(input.nights).filter((n) => !already.has(n));
    const short: Array<{ date: LocalDate; available: number }> = [];
    for (const n of nights) {
      const c = cells.get(n);
      const available = c ? c.capacity - c.out_of_order - c.sold - c.held + c.overbooking : 0;
      if (available < input.quantity) short.push({ date: n, available });
    }
    const conflictIds: string[] = [];
    if (short.length) {
      if (input.overbooking) {
        for (const s of short) {
          await sql`update fake_inventory.cells set overbooking = overbooking + ${input.quantity - s.available}
                     where unit_type_id = ${input.unitTypeId} and night = ${s.date}::date`.execute(tx.db);
        }
      } else if (input.onShortfall === 'record_conflict') {
        for (const s of short) {
          const id = newId();
          conflictIds.push(id);
          await sql`insert into fake_inventory.conflicts values (${id}, ${tx.tenantId}, ${input.unitTypeId}, ${s.date}::date,
                    ${input.quantity - s.available}, ${input.ref.type}, ${input.ref.id})`.execute(tx.db);
        }
      } else {
        throw new DomainError(
          'inventory_unavailable',
          `Not available on ${short.map((s) => s.date).join(', ')}.`,
          {
            status: 409,
            details: { shortNights: short },
          },
        );
      }
    }
    for (const n of nights) {
      if (!cells.has(n)) {
        await sql`insert into fake_inventory.cells (tenant_id, property_id, unit_type_id, night, capacity)
                  values (${tx.tenantId}, ${input.propertyId}, ${input.unitTypeId}, ${n}::date, 0)`.execute(
          tx.db,
        );
      }
      await sql`update fake_inventory.cells set sold = sold + ${input.quantity}
                 where unit_type_id = ${input.unitTypeId} and night = ${n}::date`.execute(tx.db);
      await sql`insert into fake_inventory.consumption values (${tx.tenantId}, ${input.ref.type}, ${input.ref.id},
                ${input.unitTypeId}, ${n}::date, ${input.quantity}, ${tx.now})`.execute(tx.db);
    }
    return conflictIds.length ? { conflictIds } : undefined;
  }

  async release(tx: TxContext, input: { ref: EntityRef; nights?: DateRange }): Promise<void> {
    this.calls.push({ op: 'release', input });
    const from = input.nights?.from ?? '0001-01-01';
    const to = input.nights?.to ?? '9999-12-31';
    const { rows } = await sql<{ unit_type_id: string; night: string; quantity: number }>`
      delete from fake_inventory.consumption
       where ref_type = ${input.ref.type} and ref_id = ${input.ref.id} and night >= ${from}::date and night < ${to}::date
       returning unit_type_id, night::text, quantity`.execute(tx.db);
    for (const r of rows.sort((a, b) => (a.unit_type_id + a.night < b.unit_type_id + b.night ? -1 : 1))) {
      await sql`update fake_inventory.cells set sold = sold - ${r.quantity}
                 where unit_type_id = ${r.unit_type_id} and night = ${r.night}::date`.execute(tx.db);
    }
    const holds = await sql<{ unit_type_id: string; from_date: string; to_date: string; quantity: number }>`
      update fake_inventory.holds set status = 'released'
       where ref_type = ${input.ref.type} and ref_id = ${input.ref.id} and status = 'active'
       returning unit_type_id, from_date::text, to_date::text, quantity`.execute(tx.db);
    for (const h of holds.rows) {
      await sql`update fake_inventory.cells set held = held - ${h.quantity}
                 where unit_type_id = ${h.unit_type_id} and night >= ${h.from_date}::date and night < ${h.to_date}::date`.execute(
        tx.db,
      );
    }
  }

  async changeConsumption(
    tx: TxContext,
    input: Parameters<InventoryPort['changeConsumption']>[1],
  ): Promise<void> {
    this.calls.push({ op: 'changeConsumption', input });
    // Atomic within the caller's transaction: if the new consumption is short, the throw rolls everything back.
    const { rows } = await sql<{ propertyId: string }>`
      select property_id as "propertyId" from fake_inventory.unit_types where id = ${input.to.unitTypeId}`.execute(
      tx.db,
    );
    await sql`delete from fake_inventory.consumption where ref_type = ${input.ref.type} and ref_id = ${input.ref.id}
               and unit_type_id = ${input.from.unitTypeId} and night >= ${input.from.nights.from}::date
               and night < ${input.from.nights.to}::date`.execute(tx.db);
    await sql`update fake_inventory.cells set sold = sold - 1 where unit_type_id = ${input.from.unitTypeId}
               and night >= ${input.from.nights.from}::date and night < ${input.from.nights.to}::date`.execute(
      tx.db,
    );
    await this.consume(tx, {
      propertyId: rows[0]?.propertyId ?? '',
      unitTypeId: input.to.unitTypeId,
      nights: input.to.nights,
      quantity: 1,
      ref: input.ref,
    });
  }

  async createHold(
    tx: TxContext,
    input: Parameters<InventoryPort['createHold']>[1],
  ): Promise<{ holdId: string }> {
    this.calls.push({ op: 'createHold', input });
    const cells = await this.lockCells(tx, input.unitTypeId, input.nights);
    const short = eachNight(input.nights).filter((n) => {
      const c = cells.get(n);
      return !c || c.capacity - c.out_of_order - c.sold - c.held + c.overbooking < input.quantity;
    });
    if (short.length) {
      throw new DomainError('inventory_unavailable', 'Not available to hold.', {
        status: 409,
        details: { shortNights: short.map((date) => ({ date, available: 0 })) },
      });
    }
    const id = newId();
    await sql`insert into fake_inventory.holds values (${id}, ${tx.tenantId}, ${input.unitTypeId}, ${input.nights.from}::date,
              ${input.nights.to}::date, ${input.quantity}, ${input.expiresAt}, ${input.ref.type}, ${input.ref.id}, 'active')`.execute(
      tx.db,
    );
    await sql`update fake_inventory.cells set held = held + ${input.quantity} where unit_type_id = ${input.unitTypeId}
               and night >= ${input.nights.from}::date and night < ${input.nights.to}::date`.execute(tx.db);
    return { holdId: id };
  }

  async convertHold(tx: TxContext, input: { holdId: string; ref: EntityRef }): Promise<void> {
    this.calls.push({ op: 'convertHold', input });
    const { rows } = await sql<{
      unit_type_id: string;
      from_date: string;
      to_date: string;
      quantity: number;
      status: string;
      expires_at: Date;
    }>`
      select unit_type_id, from_date::text, to_date::text, quantity, status, expires_at from fake_inventory.holds
       where id = ${input.holdId} for update`.execute(tx.db);
    const h = rows[0];
    if (!h || h.status !== 'active' || h.expires_at.getTime() <= tx.now.getTime()) {
      throw new BusinessRuleError('hold_expired', 'The hold has expired or was released.');
    }
    await sql`update fake_inventory.holds set status = 'converted' where id = ${input.holdId}`.execute(tx.db);
    await sql`update fake_inventory.cells set held = held - ${h.quantity}, sold = sold + ${h.quantity}
               where unit_type_id = ${h.unit_type_id} and night >= ${h.from_date}::date and night < ${h.to_date}::date`.execute(
      tx.db,
    );
    for (const n of eachNight({ from: h.from_date, to: h.to_date })) {
      await sql`insert into fake_inventory.consumption values (${tx.tenantId}, ${input.ref.type}, ${input.ref.id},
                ${h.unit_type_id}, ${n}::date, ${h.quantity}, ${tx.now})`.execute(tx.db);
    }
  }

  async assignUnit(
    tx: TxContext,
    input: { unitId: string; ref: EntityRef; nights: DateRange },
  ): Promise<void> {
    this.calls.push({ op: 'assignUnit', input });
    await sql`select id from fake_inventory.units where id = ${input.unitId} for update`.execute(tx.db);
    const { rows } = await sql<{ ref_type: string; ref_id: string }>`
      select ref_type, ref_id from fake_inventory.assignments
       where unit_id = ${input.unitId} and nights && daterange(${input.nights.from}::date, ${input.nights.to}::date, '[)')`.execute(
      tx.db,
    );
    if (rows.length) {
      throw new DomainError(
        'unit_assignment_conflict',
        'The unit is already assigned for some of these nights.',
        {
          status: 409,
          details: { conflicts: rows.map((r) => ({ type: r.ref_type, id: r.ref_id })) },
        },
      );
    }
    await sql`insert into fake_inventory.assignments values (${newId()}, ${tx.tenantId}, ${input.unitId}, ${input.ref.type},
              ${input.ref.id}, daterange(${input.nights.from}::date, ${input.nights.to}::date, '[)'))`.execute(
      tx.db,
    );
  }

  async unassignUnit(tx: TxContext, input: { ref: EntityRef; nights?: DateRange }): Promise<void> {
    this.calls.push({ op: 'unassignUnit', input });
    const { rows } = await sql<{ id: string; unit_id: string; from: string; to: string }>`
      delete from fake_inventory.assignments where ref_type = ${input.ref.type} and ref_id = ${input.ref.id}
      returning id, unit_id, lower(nights)::text as from, upper(nights)::text as to`.execute(tx.db);
    if (!input.nights) return;
    const cut = input.nights;
    for (const a of rows) {
      const pieces: DateRange[] = [];
      if (a.from < cut.from) pieces.push({ from: a.from, to: a.to < cut.from ? a.to : cut.from });
      if (a.to > cut.to) pieces.push({ from: a.from > cut.to ? a.from : cut.to, to: a.to });
      for (const p of pieces) {
        await sql`insert into fake_inventory.assignments values (${newId()}, ${tx.tenantId}, ${a.unit_id}, ${input.ref.type},
                  ${input.ref.id}, daterange(${p.from}::date, ${p.to}::date, '[)'))`.execute(tx.db);
      }
    }
  }

  async findAssignableUnits(
    tx: TxContext,
    input: { propertyId: string; unitTypeId: string; nights: DateRange },
  ): Promise<UnitCandidate[]> {
    const units = await sql<{ id: string; name: string; unit_type_id: string }>`
      select id, name, unit_type_id from fake_inventory.units where property_id = ${input.propertyId}
       and unit_type_id = ${input.unitTypeId} order by name`.execute(tx.db);
    const out: UnitCandidate[] = [];
    for (const u of units.rows) {
      const { rows } = await sql<{ ref_type: string; ref_id: string }>`
        select ref_type, ref_id from fake_inventory.assignments where unit_id = ${u.id}
         and nights && daterange(${input.nights.from}::date, ${input.nights.to}::date, '[)')`.execute(tx.db);
      out.push({
        unitId: u.id,
        name: u.name,
        unitTypeId: u.unit_type_id,
        assignable: rows.length === 0,
        ...(rows.length
          ? {
              reason: `assigned to ${rows.map((r) => `${r.ref_type} ${r.ref_id}`).join(', ')}`,
              conflictingRefs: rows.map((r) => ({ type: r.ref_type, id: r.ref_id })),
            }
          : {}),
      });
    }
    return out;
  }

  async getAvailability(
    tx: TxContext,
    input: { propertyId: string; unitTypeIds?: string[]; range: DateRange },
  ): Promise<AvailabilityCell[]> {
    const { rows } = await sql<{
      unit_type_id: string;
      night: string;
      capacity: number;
      out_of_order: number;
      sold: number;
      held: number;
      overbooking: number;
    }>`
      select unit_type_id, night::text, capacity, out_of_order, sold, held, overbooking from fake_inventory.cells
       where property_id = ${input.propertyId} and night >= ${input.range.from}::date and night < ${input.range.to}::date
       order by unit_type_id, night`.execute(tx.db);
    return rows
      .filter((r) => !input.unitTypeIds || input.unitTypeIds.includes(r.unit_type_id))
      .map((r) => ({
        unitTypeId: r.unit_type_id,
        date: r.night,
        capacity: r.capacity,
        outOfOrder: r.out_of_order,
        sold: r.sold,
        held: r.held,
        overbookingAllowance: r.overbooking,
        available: r.capacity - r.out_of_order - r.sold - r.held + r.overbooking,
      }));
  }

  async explainAvailability(
    tx: TxContext,
    input: { propertyId: string; unitTypeId: string; date: LocalDate },
  ) {
    const cells = await this.getAvailability(tx, {
      propertyId: input.propertyId,
      unitTypeIds: [input.unitTypeId],
      range: { from: input.date, to: addDays(input.date, 1) },
    });
    const { rows } = await sql<{ ref_type: string; ref_id: string; quantity: number; consumed_at: Date }>`
      select ref_type, ref_id, quantity, consumed_at from fake_inventory.consumption
       where unit_type_id = ${input.unitTypeId} and night = ${input.date}::date order by consumed_at`.execute(
      tx.db,
    );
    return {
      unitTypeId: input.unitTypeId,
      date: input.date,
      available: cells[0]?.available ?? 0,
      consumers: rows.map((r) => ({
        ref: { type: r.ref_type, id: r.ref_id },
        quantity: r.quantity,
        consumedAt: r.consumed_at.toISOString(),
      })),
    };
  }

  async getUnit(tx: TxContext, unitId: string): Promise<UnitSummary> {
    const { rows } = await sql<{ id: string; property_id: string; unit_type_id: string; name: string }>`
      select id, property_id, unit_type_id, name from fake_inventory.units where id = ${unitId}`.execute(
      tx.db,
    );
    const r = rows[0];
    if (!r) throw new NotFoundError('unit', unitId);
    return { id: r.id, propertyId: r.property_id, unitTypeId: r.unit_type_id, name: r.name };
  }

  async listUnits(tx: TxContext, input: { propertyId: string }): Promise<UnitSummary[]> {
    const { rows } = await sql<{ id: string; property_id: string; unit_type_id: string; name: string }>`
      select id, property_id, unit_type_id, name from fake_inventory.units where property_id = ${input.propertyId} order by name`.execute(
      tx.db,
    );
    return rows.map((r) => ({
      id: r.id,
      propertyId: r.property_id,
      unitTypeId: r.unit_type_id,
      name: r.name,
    }));
  }

  async listUnitTypes(tx: TxContext, input: { propertyId: string }): Promise<UnitTypeSummary[]> {
    const { rows } = await sql<{
      id: string;
      property_id: string;
      code: string;
      name: string;
      rank: number;
      max_occupancy: number;
    }>`
      select id, property_id, code, name, rank, max_occupancy from fake_inventory.unit_types where property_id = ${input.propertyId} order by rank`.execute(
      tx.db,
    );
    return rows.map((r) => ({
      id: r.id,
      propertyId: r.property_id,
      code: r.code,
      name: r.name,
      rank: r.rank,
      maxOccupancy: r.max_occupancy,
    }));
  }

  // ── test inspection helpers ──
  async consumptionOf(tx: TxContext, ref: EntityRef): Promise<Array<{ unitTypeId: string; night: string }>> {
    const { rows } = await sql<{ unit_type_id: string; night: string }>`
      select unit_type_id, night::text from fake_inventory.consumption where ref_type = ${ref.type} and ref_id = ${ref.id} order by night`.execute(
      tx.db,
    );
    return rows.map((r) => ({ unitTypeId: r.unit_type_id, night: r.night }));
  }

  async assignmentsOf(
    tx: TxContext,
    ref: EntityRef,
  ): Promise<Array<{ unitId: string; from: string; to: string }>> {
    const { rows } = await sql<{ unit_id: string; from: string; to: string }>`
      select unit_id, lower(nights)::text as from, upper(nights)::text as to from fake_inventory.assignments
       where ref_type = ${ref.type} and ref_id = ${ref.id} order by lower(nights)`.execute(tx.db);
    return rows.map((r) => ({ unitId: r.unit_id, from: r.from, to: r.to }));
  }

  async conflicts(tx: TxContext): Promise<Array<{ unitTypeId: string; night: string; refId: string }>> {
    const { rows } = await sql<{ unit_type_id: string; night: string; ref_id: string }>`
      select unit_type_id, night::text, ref_id from fake_inventory.conflicts order by night`.execute(tx.db);
    return rows.map((r) => ({ unitTypeId: r.unit_type_id, night: r.night, refId: r.ref_id }));
  }
}
