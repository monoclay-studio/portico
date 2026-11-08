/**
 * How Day Close records a failure: stable code, plain message with the recovery, whether retrying can help.
 * Unknown errors are treated as transient (a crash, a timeout, a dropped connection): retrying a keyed effect is
 * safe. Integrity failures are never retried automatically (spec §13 product decision).
 */
import { DomainError } from '@portico/kernel';

export interface FailureRecord {
  code: string;
  message: string;
  retryable: boolean;
  integrity?: boolean;
  details?: Record<string, unknown>;
}

/**
 * 409s that heal on retry: someone else's concurrent change (re-read and retry) or the same request still running.
 * Every other 409 is a deterministic refusal — e.g. finance's `idempotency_conflict` (the key is held with other
 * content) never heals, so it is NOT retryable (review P0-2): the scheduler does not retry it in vain and a blocking
 * follow-up is raised at once.
 */
const RETRYABLE_CONFLICTS: ReadonlySet<string> = new Set([
  'version_conflict',
  'request_in_progress',
  'run_in_progress',
]);

/** PostgreSQL connection / crash classes that mean "the process or the database went away". */
const TRANSIENT_SQLSTATE = /^(08|57P|40001|40P01|53)/;

export function toFailure(err: unknown): FailureRecord {
  if (err instanceof DomainError) {
    return {
      code: err.code,
      message: err.message,
      retryable:
        err.retryable || err.status === 503 || (err.status === 409 && RETRYABLE_CONFLICTS.has(err.code)),
      ...(err.details ? { details: err.details } : {}),
    };
  }
  const sqlState =
    typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : '';
  if (sqlState === 'P0001') {
    return {
      code: 'invariant_violation',
      message: `The database refused a change that would break a Day Close rule: ${err instanceof Error ? err.message : String(err)}`,
      retryable: false,
    };
  }
  return {
    code: TRANSIENT_SQLSTATE.test(sqlState) ? 'database_unavailable' : 'unexpected_error',
    message:
      'Day Close stopped because of an unexpected technical problem. Everything completed so far is kept; resume to continue (nothing is repeated).',
    retryable: true,
  };
}

/** Thrown by the engine when another executor took over this run's lease (we were presumed dead). */
export class LeaseLostError extends DomainError {
  constructor(runId: string) {
    super(
      'run_lease_lost',
      'Another Day Close process took over this run, so this one stopped without changing anything more.',
      { status: 409, details: { runId } },
    );
  }
}
