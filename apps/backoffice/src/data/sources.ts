/**
 * Workspace data sources: ONE source per domain, each typed only with module contracts (src/data/contracts.ts)
 * or view models the app owns (src/data/views.ts). Binding a live module means writing one adapter for its
 * domain and changing its row in `bindWorkspaceSources` — screens do not change, and the provenance shown on
 * screen comes from what the source returns (never hard-coded).
 *
 * Simulated sources are bound ONLY outside live organizations (demo, trial, training, sandbox). In a live
 * organization a domain without a live source is `not_connected`, and its screen says so plainly.
 */
import type { ProblemDetails, Provenance as ProvenanceKind } from '@portico/ui';
import type { DeskList, DeskListKind, OperationsBoard } from './contracts';
import type { PropertyContext } from './property';
import type {
  OverviewView,
  StayChangePreview,
  StayRecordView,
  TimelineView,
  UnitRecordView,
  WorkItem,
} from './views';

export interface SourceProvenance {
  kind: ProvenanceKind;
  /** When a simulated payload was generated. */
  generatedAt?: string;
  /** External system of record, for `external`. */
  system?: string;
  lastSyncedAt?: string;
}

export interface Sourced<T> {
  data: T;
  provenance: SourceProvenance;
}

export interface FrontDeskSource {
  /** reservations GET /v1/front-desk/{arrivals|departures|in-house}?propertyId= */
  list(p: PropertyContext, kind: DeskListKind): Promise<Sourced<DeskList>>;
}
export interface HousekeepingSource {
  /** operations GET /v1/properties/:propertyId/housekeeping/board */
  board(p: PropertyContext): Promise<Sourced<OperationsBoard>>;
}
export interface TimelineSource {
  timeline(p: PropertyContext, from: string, days: number): Promise<Sourced<TimelineView>>;
}
export interface StayChangeSource {
  previewExtension(p: PropertyContext, stayId: string, nights: number): Promise<Sourced<StayChangePreview>>;
  /** Commits a previewed change. The idempotency key is per user intent (one confirm = one key). */
  commitExtension(
    p: PropertyContext,
    input: { previewToken: string; stayId: string; nights: number; idempotencyKey: string },
  ): Promise<Sourced<{ stayId: string; departure: string }>>;
}
export interface RecordSource {
  stay(p: PropertyContext, stayId: string): Promise<Sourced<StayRecordView | null>>;
  unit(p: PropertyContext, unitId: string): Promise<Sourced<UnitRecordView | null>>;
}
export interface WorkSource {
  myWork(p: PropertyContext): Promise<Sourced<WorkItem[]>>;
  overview(p: PropertyContext): Promise<Sourced<OverviewView>>;
}

export interface WorkspaceSources {
  frontDesk: FrontDeskSource;
  housekeeping: HousekeepingSource;
  timeline: TimelineSource;
  stayChanges: StayChangeSource;
  records: RecordSource;
  work: WorkSource;
}
export type DomainId = keyof WorkspaceSources;
export type BindingMode = 'live' | 'simulated' | 'not_connected';

export interface Bound {
  sources: Partial<WorkspaceSources>;
  modes: Record<DomainId, BindingMode>;
}

export const DOMAINS: readonly DomainId[] = [
  'frontDesk',
  'housekeeping',
  'timeline',
  'stayChanges',
  'records',
  'work',
];

/**
 * The simulator is loaded only when a non-live organization first asks for data (its own chunk), so live
 * organizations never download it.
 */
let simulatorModule: Promise<WorkspaceSources> | null = null;
const loadSimulator = () => {
  simulatorModule ??= import('./simulated/adapter').then((m) => m.createSimulatedSources());
  return simulatorModule;
};
type AsyncMethods<T> = { [K in keyof T]: T[K] };
function lazyDomain<D extends DomainId>(domain: D): WorkspaceSources[D] {
  return new Proxy({} as AsyncMethods<WorkspaceSources[D]>, {
    get:
      (_t, method: string) =>
      async (...args: unknown[]) => {
        const sources = await loadSimulator();
        const target = sources[domain] as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
        const fn = target[method];
        if (!fn) throw new Error(`Unknown ${domain} method ${method}`);
        return fn(...args);
      },
  }) as WorkspaceSources[D];
}
const simulatedSources = (): WorkspaceSources => ({
  frontDesk: lazyDomain('frontDesk'),
  housekeeping: lazyDomain('housekeeping'),
  timeline: lazyDomain('timeline'),
  stayChanges: lazyDomain('stayChanges'),
  records: lazyDomain('records'),
  work: lazyDomain('work'),
});
let simulated: WorkspaceSources | null = null;

/** Any environment other than exactly 'live' may use simulated data (fail closed for live). */
export function bindWorkspaceSources(environment: string | null | undefined): Bound {
  const allowSimulation = Boolean(environment) && environment !== 'live';
  const sources: Partial<WorkspaceSources> = {};
  const modes = {} as Record<DomainId, BindingMode>;
  for (const d of DOMAINS) {
    // No domain has a live adapter yet (reservations' ports to rates/finance are still stubbed).
    if (allowSimulation) {
      simulated ??= simulatedSources();
      Object.assign(sources, { [d]: simulated[d] });
      modes[d] = 'simulated';
    } else modes[d] = 'not_connected';
  }
  return { sources, modes };
}

/** Errors from any source are problem+json (simulated sources map their own failures). */
export type SourceProblem = ProblemDetails;
