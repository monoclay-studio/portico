import { sql, type TxContext } from '@portico/db';
import type { LocalDate } from '@portico/kernel';
import { INVENTORY_EVENTS } from '../events';

export interface LedgerDiscrepancy {
  propertyId: string;
  unitTypeId: string;
  night: LocalDate;
  sold: number;
  consumed: number;
  held: number;
  activeHolds: number;
}

/**
 * INV-I02 consistency check: for every ledger row from `fromNight`, `sold` must equal Σ consumption and `held` must
 * equal Σ active holds (incl. component quantities of combined-unit holds). Nothing is corrected automatically —
 * selling continues on the ledger values — but every discrepancy is reported as an urgent
 * `inventory.ledger.inconsistent` event and an audit entry, so a person investigates (EC-INV-029).
 */
export async function checkLedgerConsistency(
  tx: TxContext,
  opts: { fromNight: LocalDate; report?: boolean },
): Promise<LedgerDiscrepancy[]> {
  const { rows } = await sql<{
    property_id: string;
    unit_type_id: string;
    night: string;
    sold: number;
    consumed: number;
    held: number;
    holds: number;
  }>`
    select l.property_id, l.unit_type_id, l.night::text as night, l.sold,
           coalesce((select sum(c.quantity) from inventory.consumptions c
                      where c.unit_type_id = l.unit_type_id and c.night = l.night), 0)::int as consumed,
           l.held,
           (coalesce((select sum(h.quantity) from inventory.holds h
                       where h.status = 'active' and h.unit_type_id = l.unit_type_id and h.nights @> l.night), 0)
          + coalesce((select sum((e->>'quantity')::int) from inventory.holds h,
                             jsonb_array_elements(h.component_quantities) e
                       where h.status = 'active' and (e->>'unitTypeId')::uuid = l.unit_type_id
                         and h.nights @> l.night), 0))::int as holds
    from inventory.ledger l
    where l.night >= ${opts.fromNight}::date
    order by l.property_id, l.unit_type_id, l.night`.execute(tx.db);
  const bad = rows
    .filter((r) => r.sold !== r.consumed || r.held !== r.holds)
    .map((r) => ({
      propertyId: r.property_id,
      unitTypeId: r.unit_type_id,
      night: r.night,
      sold: r.sold,
      consumed: r.consumed,
      held: r.held,
      activeHolds: r.holds,
    }));
  if (opts.report !== false) {
    const byProperty = new Map<string, LedgerDiscrepancy[]>();
    for (const d of bad) byProperty.set(d.propertyId, [...(byProperty.get(d.propertyId) ?? []), d]);
    for (const [propertyId, list] of byProperty) {
      await tx.audit({
        action: 'inventory.ledger.inconsistencyDetected',
        target: { type: 'unitType', id: list[0]?.unitTypeId as string },
        propertyId,
        after: { discrepancies: list.slice(0, 100), total: list.length },
      });
      await tx.emit({
        type: INVENTORY_EVENTS.ledgerInconsistent,
        propertyId,
        aggregate: { type: 'property', id: propertyId },
        payload: { propertyId, severity: 'urgent', discrepancies: list.slice(0, 100), total: list.length },
      });
    }
  }
  return bad;
}
