/**
 * Ordering and dedupe rules for messages received from external systems (adoption brief §8: "clear behavior for
 * delayed messages, missing events, conflicting edits"; brief §11: duplicates, delayed messages, missed-message
 * recovery).
 *
 *  - Same (connection, workflow, external id, revision) again → DUPLICATE: stored once, no second effect.
 *  - Revision order ≤ the newest applied revision → STALE: an older version arriving late never overwrites a
 *    newer one (messages are full replacements of the external record, newest wins).
 *  - Sequential sources whose revision jumps by more than one → applied, GAP flagged (updates may be missing;
 *    a reconciliation fetch is requested).
 *  - Delivered later than the workflow's freshness target → applied, DELAYED flagged (health shows the delay).
 * Pure logic — no IO.
 */

export interface Watermark {
  lastRevision: string;
  lastRevisionOrder: number;
}

export interface IncomingRevision {
  revision: string;
  revisionOrder: number;
  occurredAt: Date;
  receivedAt: Date;
}

export type OrderingDecision =
  | { action: 'apply'; gapDetected: boolean; delayed: boolean; latencySeconds: number }
  | { action: 'stale'; latencySeconds: number; newerRevision: string };

export function decideOrdering(
  incoming: IncomingRevision,
  watermark: Watermark | null,
  opts: { sequential: boolean; freshnessTargetSeconds: number | null },
): OrderingDecision {
  const latencySeconds = Math.max(
    0,
    Math.round((incoming.receivedAt.getTime() - incoming.occurredAt.getTime()) / 1000),
  );
  if (watermark && incoming.revisionOrder <= watermark.lastRevisionOrder) {
    return { action: 'stale', latencySeconds, newerRevision: watermark.lastRevision };
  }
  const gapDetected =
    opts.sequential && watermark !== null && incoming.revisionOrder > watermark.lastRevisionOrder + 1;
  const delayed = opts.freshnessTargetSeconds !== null && latencySeconds > opts.freshnessTargetSeconds;
  return { action: 'apply', gapDetected, delayed, latencySeconds };
}

/**
 * Within one batch, process messages per external record in revision order so that a batch delivered out of
 * order still ends at the newest revision, and earlier revisions in the same batch are recorded (as applied,
 * then superseded) rather than reported as stale.
 */
export function sortForProcessing<T extends { workflow: string; externalId: string; revisionOrder: number }>(
  records: readonly T[],
): T[] {
  return [...records].sort(
    (a, b) =>
      a.workflow.localeCompare(b.workflow) ||
      a.externalId.localeCompare(b.externalId) ||
      a.revisionOrder - b.revisionOrder,
  );
}

/** Parse a revision into an orderable number: integers as-is, ISO timestamps as epoch milliseconds. */
export function revisionOrderOf(revision: string): number | null {
  if (/^\d{1,15}$/.test(revision)) return Number(revision);
  const t = Date.parse(revision);
  return Number.isNaN(t) ? null : t;
}
