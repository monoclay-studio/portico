/**
 * SIMULATED data source for the role workspaces (front desk, housekeeping, reservations timeline).
 * Isolated here so nothing else in the app knows data is mocked: screens talk to the `WorkspaceDataSource`
 * interface (src/data/sources.ts) and render the provenance that comes back with every payload.
 */
import type { LocalDate } from '@portico/ui';
import {
  type ArrivalRow,
  arrivalRow,
  type HousekeepingRow,
  housekeepingRow,
  type Sourced,
  type StayChangePreview,
  stayChangePreview,
  type TimelineView,
  timelineView,
} from './contracts';
import {
  arrivalsFor,
  commitExtension,
  housekeepingFor,
  type PropertySimulation,
  previewExtension,
  type SimProperty,
  type SimStayDetail,
  type SimToday,
  type SimUnitDetail,
  SimulatedProblem,
  type SimWorkItem,
  simulateProperty,
  stayDetail,
  timelineFor,
  todayFor,
  unitDetail,
  workItemsFor,
} from './maldives';

export interface WorkspaceDataSource {
  readonly mode: 'simulated' | 'live';
  arrivals(p: SimProperty): Promise<Sourced<ArrivalRow[]>>;
  housekeeping(p: SimProperty): Promise<Sourced<HousekeepingRow[]>>;
  timeline(p: SimProperty, from: LocalDate, days: number): Promise<Sourced<TimelineView>>;
  previewExtension(p: SimProperty, stayId: string, nights: number): Promise<Sourced<StayChangePreview>>;
  commitExtension(
    p: SimProperty,
    previewToken: string,
    stayId: string,
    nights: number,
  ): Promise<Sourced<{ stayId: string; departure: LocalDate }>>;
  stay(p: SimProperty, stayId: string): Promise<Sourced<SimStayDetail | null>>;
  unit(p: SimProperty, unitId: string): Promise<Sourced<SimUnitDetail | null>>;
  myWork(p: SimProperty): Promise<Sourced<SimWorkItem[]>>;
  today(p: SimProperty): Promise<Sourced<SimToday>>;
}

const SOURCE = 'Simulator — module not yet connected (wave 1)';

export function createSimulatedSource(
  opts: { latencyMs?: number; now?: () => Date } = {},
): WorkspaceDataSource {
  const sims = new Map<string, PropertySimulation>();
  const now = opts.now ?? (() => new Date());
  const latency = opts.latencyMs ?? 180;
  const sim = (p: SimProperty) => {
    const key = `${p.id}:${p.businessDate}`;
    let s = sims.get(key);
    if (!s) {
      s = simulateProperty(p, now());
      sims.set(key, s);
    }
    return s;
  };
  const wrap = async <T>(data: T): Promise<Sourced<T>> => {
    if (latency > 0) await new Promise((r) => setTimeout(r, latency));
    return { data, provenance: 'simulated', generatedAt: now().toISOString(), source: SOURCE };
  };
  return {
    mode: 'simulated',
    arrivals: (p) => wrap(arrivalRow.array().parse(arrivalsFor(sim(p)))),
    housekeeping: (p) => wrap(housekeepingRow.array().parse(housekeepingFor(sim(p)))),
    timeline: (p, from, days) => wrap(timelineView.parse(timelineFor(sim(p), from, days))),
    previewExtension: (p, stayId, nights) =>
      wrap(stayChangePreview.parse(previewExtension(sim(p), stayId, nights, now()))),
    stay: (p, id) => wrap(stayDetail(sim(p), id)),
    unit: (p, id) => wrap(unitDetail(sim(p), id)),
    myWork: (p) => wrap(workItemsFor(sim(p))),
    today: (p) => wrap(todayFor(sim(p))),
    async commitExtension(p, _token, stayId, nights) {
      try {
        const s = commitExtension(sim(p), stayId, nights);
        return wrap({ stayId: s.id, departure: s.to });
      } catch (e) {
        if (e instanceof SimulatedProblem) {
          if (latency > 0) await new Promise((r) => setTimeout(r, latency));
          throw e;
        }
        throw e;
      }
    },
  };
}

export type { SimStayDetail, SimToday, SimUnitDetail, SimWorkItem };
export { SimulatedProblem };
