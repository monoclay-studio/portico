/**
 * Offline sync rules for the staff mobile app (scenario 13). Pure decisions; the service applies them.
 *
 *  - Every mutation carries a client mutation id (dedupe), a client timestamp and the base version of the
 *    record the user saw. A mutation whose base version is no longer current is REJECTED with an explanation of
 *    what changed — never applied silently over someone else's change.
 *  - Mutations in one batch that touch the same record form a chain: a later mutation built on the same base
 *    as an earlier, applied one is evaluated against the version that earlier mutation produced. If an earlier
 *    link was rejected, later links built on it are skipped (they assumed a state that never happened).
 */

export interface ChainLink {
  clientMutationId: string;
  clientBase: number | null;
  outcome: 'applied' | 'pending' | 'conflict' | 'rejected' | 'skipped';
  resultVersion: number | null;
}

export class BatchChain {
  private readonly links = new Map<string, ChainLink[]>();

  /**
   * Base version to compare against the server for a mutation on `entityKey`, or a skip decision. Links are
   * followed in batch order: a link built on the current base moves the base to the version it produced, so
   * chains of several changes (and side effects on the same record) resolve to the latest produced version.
   * `clientBase` of a link is the EFFECTIVE base it was evaluated against.
   */
  resolve(
    entityKey: string,
    baseVersion: number | null,
  ): { kind: 'evaluate'; base: number | null } | { kind: 'skip'; dependsOn: string } {
    let base = baseVersion;
    for (const link of this.links.get(entityKey) ?? []) {
      const applied = link.outcome === 'applied' || link.outcome === 'pending';
      if (link.clientBase === base) {
        if (!applied) return { kind: 'skip', dependsOn: link.clientMutationId };
        base = link.resultVersion ?? base;
      }
    }
    return { kind: 'evaluate', base };
  }

  record(entityKey: string, link: ChainLink): void {
    const chain = this.links.get(entityKey) ?? [];
    chain.push(link);
    this.links.set(entityKey, chain);
  }
}

export interface ChangeSinceBase {
  field: string;
  from: string | null;
  to: string | null;
  by: string;
  at: string;
  version: number;
}

export type ConflictCode =
  | 'task_reassigned'
  | 'task_cancelled'
  | 'task_already_completed'
  | 'unit_already_inspected'
  | 'unit_blocked'
  | 'stale_version'
  | 'earlier_change_rejected';

export interface ConflictExplanation {
  code: ConflictCode;
  message: string;
  changesSinceYourVersion: ChangeSinceBase[];
}

export function explainTaskConflict(input: {
  actorUserId: string | null;
  current: {
    status: string;
    assigneeUserId: string | null;
    assigneeName: string | null;
    doneBy: string | null;
  };
  changes: ChangeSinceBase[];
}): ConflictExplanation {
  const { current, changes } = input;
  const reassigned = changes.find((c) => c.field === 'assignee');
  if (current.status === 'cancelled') {
    return {
      code: 'task_cancelled',
      message: 'This task was cancelled while you were offline. Your update was not applied.',
      changesSinceYourVersion: changes,
    };
  }
  if (reassigned && current.assigneeUserId !== input.actorUserId) {
    return {
      code: 'task_reassigned',
      message: `This task was reassigned to ${current.assigneeName ?? 'someone else'} by ${reassigned.by} while you were offline. Your update was not applied — check with your supervisor before continuing.`,
      changesSinceYourVersion: changes,
    };
  }
  if (current.status === 'done' || current.status === 'verified') {
    return {
      code: 'task_already_completed',
      message: `This task was already completed${current.doneBy ? ` by ${current.doneBy}` : ''}. Your update was not applied.`,
      changesSinceYourVersion: changes,
    };
  }
  return staleVersion(changes);
}

export function explainUnitConflict(input: {
  current: { condition: string; blockActive: boolean; lastInspectionResult: string | null };
  changes: ChangeSinceBase[];
}): ConflictExplanation {
  const inspected = [...input.changes]
    .reverse()
    .find((c) => c.field === 'condition' && (c.to === 'inspected' || c.to === 'failed_inspection'));
  if (inspected) {
    return {
      code: 'unit_already_inspected',
      message: `The unit was ${inspected.to === 'inspected' ? 'inspected and passed' : 'inspected and failed'} by ${inspected.by} at ${inspected.at} while you were offline. Your update was not applied — the inspection result stands.`,
      changesSinceYourVersion: input.changes,
    };
  }
  if (input.current.blockActive) {
    return {
      code: 'unit_blocked',
      message:
        'The unit was taken out of order or out of service while you were offline. Your update was not applied.',
      changesSinceYourVersion: input.changes,
    };
  }
  return staleVersion(input.changes);
}

function staleVersion(changes: ChangeSinceBase[]): ConflictExplanation {
  const who = [...new Set(changes.map((c) => c.by))];
  return {
    code: 'stale_version',
    message: `This record was changed${who.length ? ` by ${who.join(', ')}` : ''} after your device last synced. Your update was not applied — review the current state and repeat it if it is still needed.`,
    changesSinceYourVersion: changes,
  };
}

/** Client clocks drift: a timestamp in the future beyond the tolerated skew is clamped to server time. */
export function clampClientTime(clientAt: Date, serverNow: Date, maxSkewMinutes: number): Date {
  const limit = serverNow.getTime() + maxSkewMinutes * 60_000;
  return clientAt.getTime() > limit ? new Date(serverNow) : clientAt;
}
