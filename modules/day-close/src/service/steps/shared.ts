import type { PorticoDatabase, TxContext } from '@portico/db';
import type { RequestContext } from '@portico/kernel';
import type { DayClosePolicy, ReadinessItem, StepKey } from '../../contracts';
import { type FailureRecord, LeaseLostError } from '../../domain/errors';
import type { DayCloseProperty } from '../../ports';
import { type Deps, type EngineHooks, SimulatedCrash } from '../context';
import type { RunRow } from '../repo';

/** Everything a step needs. `inTx` opens a transaction that first renews the executor's lease. */
export interface StepContext {
  deps: Deps;
  database: PorticoDatabase;
  ctx: RequestContext;
  run: RunRow;
  property: DayCloseProperty;
  policy: DayClosePolicy;
  owner: string;
  hooks: EngineHooks;
  inTx<T>(fn: (tx: TxContext) => Promise<T>): Promise<T>;
}

export type StepOutcome =
  | { status: 'completed'; total?: number | null; detail?: Record<string, unknown>; persisted?: boolean }
  | { status: 'skipped'; detail: Record<string, unknown> }
  | { status: 'failed'; error: FailureRecord; total?: number | null; detail?: Record<string, unknown> }
  | { status: 'blocked'; blockers: ReadinessItem[]; detail?: Record<string, unknown> };

export type StepFn = (s: StepContext) => Promise<StepOutcome>;

/** Crashes and lost leases are never recorded as item failures: they mean "this process stops now". */
export function isFatal(err: unknown): boolean {
  return err instanceof SimulatedCrash || err instanceof LeaseLostError;
}

/** Item keys of overrides recorded for a step's failed items (`item:{step}:{itemKey}`). */
export function itemOverrideKey(step: StepKey, item: string): string {
  return `item:${step}:${item}`;
}
