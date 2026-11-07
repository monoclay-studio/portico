import type { TxContext } from '@portico/db';
import type { DateRange, EntityRef, LocalDate } from '@portico/kernel';
import type {
  AvailabilityCell,
  AvailabilityExplanation,
  InventoryPort,
  UnitCandidate,
  UnitSummary,
  UnitTypeSummary,
} from '../ports';

/**
 * The inventory module's provider functions that reservations binds, described STRUCTURALLY (a module never
 * imports another module). The composition root passes the real `inventoryService`; TypeScript checks that it
 * fits this shape, so a drift in inventory's contract fails the build instead of a booking (review R-13).
 */
export interface InventoryProvider {
  consume(
    tx: TxContext,
    input: {
      propertyId: string;
      unitTypeId: string;
      nights: DateRange;
      quantity: number;
      ref: EntityRef;
      overbooking?: { authorizedBy: string; reason: string };
      onShortfall?: 'reject' | 'record_conflict';
    },
  ): Promise<{ conflictIds: string[]; assignedUnitId: string | null }>;
  release(tx: TxContext, input: { ref: EntityRef; nights?: DateRange }): Promise<unknown>;
  changeConsumption(
    tx: TxContext,
    input: {
      ref: EntityRef;
      from: { unitTypeId: string; nights: DateRange };
      to: { unitTypeId: string; nights: DateRange };
    },
  ): Promise<unknown>;
  createHold(
    tx: TxContext,
    input: {
      propertyId: string;
      unitTypeId: string;
      nights: DateRange;
      quantity: number;
      expiresAt: Date | string;
      ref: EntityRef;
    },
  ): Promise<{ holdId: string }>;
  convertHold(tx: TxContext, input: { holdId: string; ref: EntityRef }): Promise<unknown>;
  assignUnit(
    tx: TxContext,
    input: { unitId: string; ref: EntityRef; nights: DateRange; locked?: boolean; lockReason?: string },
  ): Promise<unknown>;
  unassignUnit(tx: TxContext, input: { ref: EntityRef; nights?: DateRange }): Promise<unknown>;
  findAssignableUnits(
    tx: TxContext,
    input: { propertyId: string; unitTypeId: string; nights: DateRange; ref?: EntityRef },
  ): Promise<
    Array<{
      unitId: string;
      number: string;
      name: string | null;
      unitTypeId: string;
      assignable: boolean;
      score: number;
      exclusions: Array<{ message: string; ref: EntityRef | null }>;
    }>
  >;
  getAvailability(
    tx: TxContext,
    input: { propertyId: string; unitTypeIds?: string[]; range: DateRange },
  ): Promise<AvailabilityCell[]>;
  explainAvailability(
    tx: TxContext,
    input: { propertyId: string; unitTypeId: string; date: LocalDate },
  ): Promise<{
    unitTypeId: string;
    date: LocalDate;
    available: number;
    sold: Array<{ ref: EntityRef; quantity: number; kind: string }>;
  }>;
  getUnit(
    tx: TxContext,
    id: string,
  ): Promise<{ id: string; propertyId: string; unitTypeId: string; number: string; name: string | null }>;
  listUnits(
    tx: TxContext,
    propertyId: string,
  ): Promise<
    Array<{ id: string; propertyId: string; unitTypeId: string; number: string; name: string | null }>
  >;
  listUnitTypes(
    tx: TxContext,
    propertyId: string,
  ): Promise<
    Array<{ id: string; propertyId: string; code: string; name: string; rank: number; maxOccupancy: number }>
  >;
}

/** Staff and guests know a unit by its number ("214"); a display name, when set, is shown instead. */
function unitSummary(u: {
  id: string;
  propertyId: string;
  unitTypeId: string;
  number: string;
  name: string | null;
}): UnitSummary {
  return { id: u.id, propertyId: u.propertyId, unitTypeId: u.unitTypeId, name: u.name ?? u.number };
}

/** Bind reservations' InventoryPort to the inventory module's provider functions (§4.1 of the steward review). */
export function inventoryPortFrom(p: InventoryProvider): InventoryPort {
  return {
    async consume(tx, input) {
      const r = await p.consume(tx, input);
      return { conflictIds: r.conflictIds, assignedUnitId: r.assignedUnitId };
    },
    async release(tx, input) {
      await p.release(tx, input);
    },
    async changeConsumption(tx, input) {
      await p.changeConsumption(tx, input);
    },
    async createHold(tx, input) {
      const r = await p.createHold(tx, input);
      return { holdId: r.holdId };
    },
    async convertHold(tx, input) {
      await p.convertHold(tx, input);
    },
    async assignUnit(tx, input) {
      await p.assignUnit(tx, input);
    },
    async unassignUnit(tx, input) {
      await p.unassignUnit(tx, input);
    },
    async findAssignableUnits(tx, input) {
      const candidates = await p.findAssignableUnits(tx, input);
      return candidates.map((c): UnitCandidate => {
        const reason = c.exclusions.map((e) => e.message).join('; ');
        const refs = c.exclusions.flatMap((e) => (e.ref ? [e.ref] : []));
        return {
          unitId: c.unitId,
          name: c.name ?? c.number,
          unitTypeId: c.unitTypeId,
          assignable: c.assignable,
          ...(reason ? { reason } : {}),
          ...(refs.length ? { conflictingRefs: refs } : {}),
          fitScore: c.score,
        };
      });
    },
    getAvailability: (tx, input) => p.getAvailability(tx, input),
    async explainAvailability(tx, input): Promise<AvailabilityExplanation> {
      const e = await p.explainAvailability(tx, input);
      return { unitTypeId: e.unitTypeId, date: e.date, available: e.available, sold: e.sold };
    },
    async getUnit(tx, unitId) {
      return unitSummary(await p.getUnit(tx, unitId));
    },
    async listUnits(tx, input) {
      return (await p.listUnits(tx, input.propertyId)).map(unitSummary);
    },
    async listUnitTypes(tx, input): Promise<UnitTypeSummary[]> {
      return (await p.listUnitTypes(tx, input.propertyId)).map((t) => ({
        id: t.id,
        propertyId: t.propertyId,
        code: t.code,
        name: t.name,
        rank: t.rank,
        maxOccupancy: t.maxOccupancy,
      }));
    },
  };
}
