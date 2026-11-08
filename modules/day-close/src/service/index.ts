import type { PorticoDatabase, TxContext } from '@portico/db';
import type { LocalDate, RequestContext } from '@portico/kernel';
import type { NightDecisionInput } from '../contracts';
import type { DayClosePorts } from '../ports';
import { DEFAULT_CONFIG, type Deps, type EngineHooks, type ServiceConfig } from './context';
import * as decisions from './decisions';
import { executeRun } from './engine';
import * as policy from './policy';
import * as readiness from './readiness';
import * as reports from './reports';
import * as runs from './runs';
import * as scheduler from './scheduler';

/**
 * The day-close application service bound to its ports. Commands that span several transactions on purpose
 * (start/resume/execute: one transaction per item) take the database and the request context; the others take the
 * command's TxContext.
 */
export function createDayCloseService(ports: DayClosePorts, config: Partial<ServiceConfig> = {}) {
  const deps: Deps = { ports, config: { ...DEFAULT_CONFIG, ...config } };
  return {
    deps,
    // readiness (DCL-R01)
    getReadiness: (tx: TxContext, propertyId: string, opts: { businessDate?: LocalDate } = {}) =>
      readiness.getReadiness(deps, tx, propertyId, opts),
    // runs (DCL-R02..R06)
    createRun: (tx: TxContext, input: runs.StartInput) => runs.createRun(deps, tx, input),
    startRun: (
      database: PorticoDatabase,
      ctx: RequestContext,
      input: runs.StartInput & { execute?: boolean; hooks?: EngineHooks },
    ) => runs.startRun(deps, database, ctx, input),
    resumeRun: (
      database: PorticoDatabase,
      ctx: RequestContext,
      runId: string,
      expectedVersion: number,
      opts: { hooks?: EngineHooks } = {},
    ) => runs.resumeRun(deps, database, ctx, runId, expectedVersion, opts),
    executeRun: (
      database: PorticoDatabase,
      ctx: RequestContext,
      runId: string,
      opts: { hooks?: EngineHooks } = {},
    ) => executeRun(deps, database, ctx, runId, opts),
    cancelRun: (tx: TxContext, runId: string, expectedVersion: number, reason: string) =>
      runs.cancelRun(deps, tx, runId, expectedVersion, reason),
    overrideItem: (tx: TxContext, runId: string, input: { itemKey: string; reason: string }) =>
      runs.overrideItem(deps, tx, runId, input),
    getRun: (tx: TxContext, runId: string) => runs.getRun(deps, tx, runId),
    listRuns: (tx: TxContext, propertyId: string, q: { from?: LocalDate; to?: LocalDate; limit: number }) =>
      runs.listRuns(deps, tx, propertyId, q),
    listIssues: (tx: TxContext, propertyId: string, status: 'open' | 'resolved' = 'open') =>
      runs.listIssues(deps, tx, propertyId, status),
    resolveIssue: (tx: TxContext, issueId: string, expectedVersion: number, resolution: string) =>
      runs.resolveIssue(deps, tx, issueId, expectedVersion, resolution),
    // stay-night decisions (review P1-1)
    decideNight: (tx: TxContext, propertyId: string, input: NightDecisionInput) =>
      decisions.decideNight(deps, tx, propertyId, input),
    // reports (DCL-R07, R08)
    getReport: (tx: TxContext, propertyId: string, date: LocalDate) =>
      reports.getReport(deps, tx, propertyId, date),
    getFacts: (tx: TxContext, propertyId: string, date: LocalDate) =>
      reports.getFacts(deps, tx, propertyId, date),
    portfolio: (tx: TxContext) => reports.portfolio(deps, tx),
    // policy and schedule (DCL-R05)
    getPolicy: (tx: TxContext, propertyId: string) => policy.getPolicy(deps, tx, propertyId),
    updatePolicy: (
      tx: TxContext,
      propertyId: string,
      input: Parameters<typeof policy.updatePolicy>[3],
      expectedVersion: number,
    ) => policy.updatePolicy(deps, tx, propertyId, input, expectedVersion),
    skipToday: (tx: TxContext, propertyId: string, reason: string) =>
      policy.skipToday(deps, tx, propertyId, reason),
    fireSchedule: (database: PorticoDatabase, ctx: RequestContext, propertyId: string) =>
      scheduler.fireSchedule(deps, database, ctx, propertyId),
    autoResume: (database: PorticoDatabase, ctx: RequestContext, runId: string) =>
      scheduler.autoResume(deps, database, ctx, runId),
    raiseOverdue: (database: PorticoDatabase, ctx: RequestContext, propertyId: string, graceMs: number) =>
      scheduler.raiseOverdue(deps, database, ctx, propertyId, graceMs),
  };
}

export type DayCloseService = ReturnType<typeof createDayCloseService>;
export { type EngineHooks, type ServiceConfig, SimulatedCrash } from './context';
export { onStayEvent } from './decisions';
export type { StartInput } from './runs';
