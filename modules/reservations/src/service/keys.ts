import type { TxContext } from '@portico/db';
import { assertExternalEffectAllowed, DomainError } from '@portico/kernel';
import type { AccessPort, KeyOperationResult } from '../ports';
import { type Deps, isModuleUnavailable } from './context';
import { raiseIssue } from './issues';

/**
 * Key operations outside the check-in/check-out workflows (room moves, extensions, no-shows, cancellations).
 * The result is always returned to the caller and shown; an `unavailable` lock system becomes an urgent issue
 * telling the desk exactly what to do on the lock console — never a silent success.
 */
export async function keyOperation(
  deps: Deps,
  tx: TxContext,
  input: {
    propertyId: string;
    stayId: string;
    bookingId: string;
    action: 'move' | 'extend' | 'cancel';
    describe: string;
    /** For stays that never checked in (no-show, cancellation): no keys can exist unless pre-issued, so an
     *  unavailable key system is recorded in the result but does not raise a manual-action item. */
    quietIfUnavailable?: boolean;
    run: (access: AccessPort) => Promise<KeyOperationResult>;
  },
): Promise<KeyOperationResult> {
  let result: KeyOperationResult;
  try {
    result = await input.run(deps.ports.access);
  } catch (err) {
    if (
      !isModuleUnavailable(err) &&
      !(err instanceof DomainError && err.code === 'effect_blocked_in_environment')
    )
      throw err;
    result = { status: 'unavailable', keyRefs: [], message: 'The key system is not available.' };
  }
  // `pending` is the normal two-phase answer (executed after commit); only an unavailable lock system needs staff.
  if (result.status === 'unavailable' && !input.quietIfUnavailable) {
    await raiseIssue(tx, {
      propertyId: input.propertyId,
      kind: 'keys_manual_action',
      severity: result.status === 'unavailable' ? 'urgent' : 'routine',
      bookingId: input.bookingId,
      stayId: input.stayId,
      dedupeKey: `keys:${input.action}:${input.stayId}`,
      message:
        result.status === 'unavailable'
          ? `The key system is unavailable: ${input.describe} on the lock console, then resolve this item.`
          : `Key ${input.action} is pending confirmation from the key system: ${input.describe}. Check it completed.`,
      details: { action: input.action, result },
    });
  }
  return result;
}

/**
 * Fallback AccessPort until the `access` module is bound (orchestrator). Honors environment safety: non-live
 * environments get `simulated` results; in live, no lock system is connected, so every operation is `unavailable`
 * and staff record the manual fallback.
 */
export function environmentAccessAdapter(): AccessPort {
  const outcome = (tx: TxContext, live: KeyOperationResult, simulatedRef: string): KeyOperationResult => {
    const mode = assertExternalEffectAllowed(tx, 'access.key');
    if (mode === 'simulate' || mode === 'sandbox') {
      return {
        status: 'simulated',
        keyRefs: [simulatedRef],
        message: `Simulated (${tx.environment} environment): no real key.`,
      };
    }
    return live;
  };
  const unavailable: KeyOperationResult = {
    status: 'unavailable',
    keyRefs: [],
    message: 'No door-lock system is connected to Portico yet. Use the lock console and confirm here.',
  };
  return {
    async issueKeys(tx, input) {
      return outcome(tx, unavailable, `sim-key:${input.idempotencyKey}`);
    },
    async extendKeys(tx, input) {
      return outcome(tx, unavailable, `sim-key:${input.idempotencyKey}`);
    },
    async moveKeys(tx, input) {
      return outcome(tx, unavailable, `sim-key:${input.idempotencyKey}`);
    },
    async cancelKeys(tx, input) {
      const r = outcome(tx, unavailable, `sim-key:${input.idempotencyKey}`);
      return r.status === 'simulated' ? { ...r, keyRefs: [] } : r;
    },
  };
}
