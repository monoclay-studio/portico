/**
 * Pure helpers for optimistic-concurrency conflicts (HTTP 409 `version_conflict`, ADR-0009). Given what the
 * user started from (`original`), what they want (`mine`) and what is saved now (`latest`), classify each field
 * so the ConflictDialog can show "yours vs theirs" and re-apply only what the user chooses.
 */
export type ConflictKind = 'both' | 'mine' | 'theirs' | 'same';

export interface ConflictRowModel<K extends string = string> {
  key: K;
  kind: ConflictKind;
  original: unknown;
  mine: unknown;
  theirs: unknown;
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function classifyConflict<T extends Record<string, unknown>, K extends keyof T & string>(
  original: T,
  mine: Partial<T>,
  latest: T,
  keys: readonly K[],
): ConflictRowModel<K>[] {
  return keys.map((key) => {
    const o = original[key];
    const t = latest[key];
    const mineChanged = key in mine && !equal(mine[key], o);
    const theirsChanged = !equal(t, o);
    const m = key in mine ? mine[key] : o;
    let kind: ConflictKind = 'same';
    if (mineChanged && theirsChanged) kind = equal(m, t) ? 'same' : 'both';
    else if (mineChanged) kind = 'mine';
    else if (theirsChanged) kind = 'theirs';
    return { key, kind, original: o, mine: m, theirs: t };
  });
}

/** The patch to send on re-apply: my value for each selected field that I changed. */
export function reapplyPatch<T extends Record<string, unknown>>(
  rows: readonly ConflictRowModel[],
  selected: ReadonlySet<string>,
): Partial<T> {
  const patch: Record<string, unknown> = {};
  for (const r of rows) {
    if ((r.kind === 'mine' || r.kind === 'both') && selected.has(r.key)) patch[r.key] = r.mine;
  }
  return patch as Partial<T>;
}
