/**
 * Change capture between two extracts of the same source (phase M6): by content hash per (class, key). Sources
 * without change timestamps (CSV, report packs) are re-extracted in full and compared — that is the delta.
 */
import type { DataClass } from './records';

export interface SnapshotEntry {
  dataClass: DataClass;
  key: string;
  hash: string;
}

export interface Delta {
  added: SnapshotEntry[];
  changed: SnapshotEntry[];
  /** Present before, absent now (a cancelled or purged record in the source): never deleted in Portico. */
  removed: SnapshotEntry[];
  unchanged: number;
}

export function diffSnapshots(before: readonly SnapshotEntry[], after: readonly SnapshotEntry[]): Delta {
  const id = (e: SnapshotEntry) => `${e.dataClass}:${e.key}`;
  const prev = new Map(before.map((e) => [id(e), e]));
  const next = new Map(after.map((e) => [id(e), e]));
  const added: SnapshotEntry[] = [];
  const changed: SnapshotEntry[] = [];
  const removed: SnapshotEntry[] = [];
  let unchanged = 0;
  for (const [k, e] of next) {
    const p = prev.get(k);
    if (!p) added.push(e);
    else if (p.hash !== e.hash) changed.push(e);
    else unchanged++;
  }
  for (const [k, e] of prev) if (!next.has(k)) removed.push(e);
  return { added, changed, removed, unchanged };
}

export const deltaSize = (d: Delta) => d.added.length + d.changed.length + d.removed.length;
