import type { LocalDate } from '@portico/kernel';
import type { Occupancy, TaskKind, UnitCondition } from './model';

/** Housekeeping day plan: which tasks a service date needs, from units and the stays that use them. */

export interface PlanUnit {
  id: string;
  number: string;
  condition: UnitCondition;
  occupancy: Occupancy;
  blocked: boolean;
}

export interface PlanStay {
  id: string;
  unitId: string | null;
  arrival: LocalDate;
  departure: LocalDate;
  status: 'expected' | 'in_house' | 'departed' | 'cancelled' | 'no_show';
}

export interface PlannedTask {
  kind: TaskKind;
  unitId: string;
  stayId: string | null;
  dedupeKey: string;
  title: string;
}

export function dedupeKeyFor(
  kind: TaskKind,
  ids: { unitId: string; stayId?: string | null; date: LocalDate },
) {
  switch (kind) {
    case 'departure_clean':
      return ids.stayId ? `departure_clean:${ids.stayId}` : `departure_clean:${ids.unitId}:${ids.date}`;
    case 'stayover':
    case 'turndown':
      return `${kind}:${ids.stayId ?? ids.unitId}:${ids.date}`;
    default:
      return `${kind}:${ids.unitId}:${ids.date}`;
  }
}

export function planHousekeepingDay(input: {
  date: LocalDate;
  units: readonly PlanUnit[];
  stays: readonly PlanStay[];
  turndownEnabled: boolean;
  requireInspection: boolean;
}): PlannedTask[] {
  const { date } = input;
  const units = new Map(input.units.map((u) => [u.id, u]));
  const out: PlannedTask[] = [];
  const departing = new Set<string>();
  const arriving = new Set<string>();
  for (const s of input.stays) {
    if (!s.unitId) continue;
    const u = units.get(s.unitId);
    if (!u) continue;
    if (s.departure === date && (s.status === 'in_house' || s.status === 'departed')) {
      departing.add(u.id);
      out.push({
        kind: 'departure_clean',
        unitId: u.id,
        stayId: s.id,
        dedupeKey: dedupeKeyFor('departure_clean', { unitId: u.id, stayId: s.id, date }),
        title: `Departure clean · ${u.number}`,
      });
    }
    if (s.status === 'in_house' && s.arrival < date && s.departure > date) {
      out.push({
        kind: 'stayover',
        unitId: u.id,
        stayId: s.id,
        dedupeKey: dedupeKeyFor('stayover', { unitId: u.id, stayId: s.id, date }),
        title: `Stayover service · ${u.number}`,
      });
    }
    const inHouseTonight =
      (s.status === 'in_house' || (s.status === 'expected' && s.arrival === date)) &&
      s.arrival <= date &&
      s.departure > date;
    if (input.turndownEnabled && inHouseTonight) {
      out.push({
        kind: 'turndown',
        unitId: u.id,
        stayId: s.id,
        dedupeKey: dedupeKeyFor('turndown', { unitId: u.id, stayId: s.id, date }),
        title: `Turndown · ${u.number}`,
      });
    }
    if (s.status === 'expected' && s.arrival === date) arriving.add(u.id);
  }
  for (const u of input.units) {
    if (u.blocked || departing.has(u.id) || u.occupancy === 'occupied') continue;
    if (u.condition === 'dirty' || u.condition === 'failed_inspection') {
      out.push({
        kind: 'vacant_clean',
        unitId: u.id,
        stayId: null,
        dedupeKey: dedupeKeyFor('vacant_clean', { unitId: u.id, date }),
        title: `Clean vacant unit · ${u.number}`,
      });
    } else if (input.requireInspection && u.condition === 'clean' && arriving.has(u.id)) {
      out.push({
        kind: 'inspection',
        unitId: u.id,
        stayId: null,
        dedupeKey: dedupeKeyFor('inspection', { unitId: u.id, date }),
        title: `Inspect for arrival · ${u.number}`,
      });
    }
  }
  return out;
}
