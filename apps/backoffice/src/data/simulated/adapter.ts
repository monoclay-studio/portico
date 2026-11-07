/**
 * SIMULATED adapters for every workspace domain. The simulator's output is parsed with the REAL module schemas
 * (reservations `deskList`/`frontDeskRow`, operations `board`) and the app's own view schemas, so it cannot
 * drift from the contracts silently; simulator failures become problem+json like any API error.
 */
import type { LocalDate } from '@portico/ui';
import { ApiError } from '../../api/errors';
import { board, deskList } from '../contracts';
import type { PropertyContext } from '../property';
import type { Sourced, WorkspaceSources } from '../sources';
import {
  overviewView,
  stayChangePreview,
  stayRecordView,
  timelineView,
  unitRecordView,
  workItem,
} from '../views';
import {
  boardFor,
  commitExtension,
  deskListFor,
  overviewFor,
  type PropertySimulation,
  previewExtension,
  SimulatedProblem,
  simulateProperty,
  stayRecord,
  timelineFor,
  unitRecord,
  workItemsFor,
} from './maldives';

export function createSimulatedSources(
  opts: { latencyMs?: number; now?: () => Date } = {},
): WorkspaceSources {
  const sims = new Map<string, PropertySimulation>();
  const now = opts.now ?? (() => new Date());
  const latency = opts.latencyMs ?? 180;
  const sim = (p: PropertyContext) => {
    const key = `${p.id}:${p.businessDate}`;
    let s = sims.get(key);
    if (!s) {
      s = simulateProperty(p, now());
      sims.set(key, s);
    }
    return s;
  };
  /** Same failure shape as the API: problem+json carried by an ApiError. */
  const run = async <T>(produce: () => T): Promise<Sourced<T>> => {
    if (latency > 0) await new Promise((r) => setTimeout(r, latency));
    try {
      return { data: produce(), provenance: { kind: 'simulated', generatedAt: now().toISOString() } };
    } catch (e) {
      if (e instanceof SimulatedProblem)
        throw new ApiError({
          type: `about:blank#${e.code}`,
          title: e.status === 404 ? 'Not found' : 'This change cannot be made',
          status: e.status,
          code: e.code,
          detail: e.message,
          retryable: false,
          correlationId: `sim-${Date.now().toString(36)}`,
        });
      throw e;
    }
  };
  return {
    frontDesk: { list: (p, kind) => run(() => deskList.parse(deskListFor(sim(p), kind))) },
    housekeeping: { board: (p) => run(() => board.parse(boardFor(sim(p)))) },
    timeline: {
      timeline: (p, from, days) =>
        run(() => timelineView.parse(timelineFor(sim(p), from as LocalDate, days))),
    },
    stayChanges: {
      previewExtension: (p, stayId, nights) =>
        run(() => stayChangePreview.parse(previewExtension(sim(p), stayId, nights, now()))),
      commitExtension: (p, input) => run(() => commitExtension(sim(p), input.stayId, input.nights)),
    },
    records: {
      stay: (p, id) => run(() => stayRecordView.nullable().parse(stayRecord(sim(p), id))),
      unit: (p, id) => run(() => unitRecordView.nullable().parse(unitRecord(sim(p), id))),
    },
    work: {
      myWork: (p) => run(() => workItem.array().parse(workItemsFor(sim(p)))),
      overview: (p) => run(() => overviewView.parse(overviewFor(sim(p)))),
    },
  };
}
