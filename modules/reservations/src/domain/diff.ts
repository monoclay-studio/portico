/** Field-level differences between two JSON-like values (version conflicts, stale previews, channel revisions). */
export interface FieldChange {
  path: string;
  from: unknown;
  to: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function diffValues(before: unknown, after: unknown, path = ''): FieldChange[] {
  if (before === after) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const out: FieldChange[] = [];
    const n = Math.max(before.length, after.length);
    for (let i = 0; i < n; i++) out.push(...diffValues(before[i], after[i], `${path}[${i}]`));
    return out;
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) => diffValues(before[k], after[k], path ? `${path}.${k}` : k));
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  return [{ path: path || '$', from: before ?? null, to: after ?? null }];
}
