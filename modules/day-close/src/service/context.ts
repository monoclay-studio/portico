import { type PorticoDatabase, type TxContext, typed, withTenantTx } from '@portico/db';
import { actorId, actorLabel, type RequestContext } from '@portico/kernel';
import type { StepKey } from '../contracts';
import type { DayClosePorts } from '../ports';
import type { DayCloseDB } from '../tables';

export interface ServiceConfig {
  /** How long an executor's lease lasts without a heartbeat (a crashed process is presumed dead after it). */
  leaseMs: number;
  /** Identifies the code that executed a step (EC-DCL-031: recorded per execution). */
  codeVersion: string;
  /** Rounds of re-listing in-house stays at the end of the posting step (stays checked in meanwhile). */
  sweepRounds: number;
}

export const DEFAULT_CONFIG: ServiceConfig = {
  leaseMs: 2 * 60_000,
  codeVersion: 'day-close@1',
  sweepRounds: 3,
};

export interface Deps {
  ports: DayClosePorts;
  config: ServiceConfig;
}

/**
 * Test-only fault injection (never reachable over HTTP). `SimulatedCrash` thrown from a hook behaves like the
 * process dying at that point: the engine records nothing more, the open transaction rolls back, the lease stays
 * until it expires.
 */
export interface EngineHooks {
  beforeStep?(step: StepKey): Promise<void> | void;
  /** Inside the item's transaction, after its effects and before commit (crash mid-item). */
  insideItem?(step: StepKey, index: number): Promise<void> | void;
  /** After the item's transaction committed (crash between items). */
  afterItem?(step: StepKey, index: number): Promise<void> | void;
  /** After the step's completion committed (crash at a step boundary). */
  afterStep?(step: StepKey): Promise<void> | void;
}

export class SimulatedCrash extends Error {
  constructor(where: string) {
    super(`simulated process death at ${where}`);
    this.name = 'SimulatedCrash';
  }
}

export const db = (tx: TxContext) => typed<DayCloseDB>(tx.db);

export function actorKey(ctx: Pick<RequestContext, 'actor'>): string {
  return `${ctx.actor.kind}:${actorId(ctx.actor)}`;
}

export function actorName(ctx: Pick<RequestContext, 'actor'>): string {
  return actorLabel(ctx.actor);
}

export type Run = <T>(fn: (tx: TxContext) => Promise<T>) => Promise<T>;

export function runner(database: PorticoDatabase, ctx: RequestContext): Run {
  return (fn) => withTenantTx(database, ctx, fn);
}

export const json = (v: unknown) => JSON.stringify(v ?? null);
