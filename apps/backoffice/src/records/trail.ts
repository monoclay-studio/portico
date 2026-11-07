/** The record drawer trail lives in the URL (`?record=stay:123,unit:9`) so it survives reloads and deep links. */
export interface TrailEntry {
  type: string;
  id: string;
}

export function parseTrail(value: string | undefined): TrailEntry[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => {
      const i = part.indexOf(':');
      return i > 0 ? { type: part.slice(0, i), id: part.slice(i + 1) } : null;
    })
    .filter((x): x is TrailEntry => x !== null && x.id.length > 0)
    .slice(-6);
}

export function formatTrail(trail: readonly TrailEntry[]): string | undefined {
  return trail.length ? trail.map((t) => `${t.type}:${t.id}`).join(',') : undefined;
}

/** Opening a record already in the trail jumps back to it instead of duplicating it. */
export function pushTrail(trail: readonly TrailEntry[], next: TrailEntry): TrailEntry[] {
  const existing = trail.findIndex((t) => t.type === next.type && t.id === next.id);
  if (existing >= 0) return trail.slice(0, existing + 1);
  return [...trail, next];
}
