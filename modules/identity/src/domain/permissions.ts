import type { PermissionDefinition } from '@portico/kernel';

/**
 * Permission catalog logic (pure). Keys are `<module>.<resource>.<action>`; role permission entries may be exact
 * keys or wildcards (`*`, `<module>.*`, `<module>.<resource>.*`) — the same matching rules as
 * `staticAuthorizer` in @portico/kernel.
 */

const KEY_RE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$/;

export function isWildcard(entry: string): boolean {
  return entry === '*' || entry.endsWith('.*');
}

/** True when the role entry (exact or wildcard) covers the permission key. */
export function entryCovers(entry: string, key: string): boolean {
  if (entry === '*') return true;
  if (entry.endsWith('.*')) return key.startsWith(entry.slice(0, -1));
  return entry === key;
}

export interface PermissionCatalogIndex {
  readonly all: readonly PermissionDefinition[];
  get(key: string): PermissionDefinition | undefined;
  /** Catalog permissions covered by a role entry. */
  expand(entry: string): PermissionDefinition[];
  /** Sensitive if the key is registered as sensitive, or (for wildcards) covers any sensitive permission. */
  isSensitive(keyOrEntry: string): boolean;
}

export function indexCatalog(defs: readonly PermissionDefinition[]): PermissionCatalogIndex {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const expand = (entry: string) => (isWildcard(entry) ? defs.filter((d) => entryCovers(entry, d.key)) : []);
  return {
    all: defs,
    get: (key) => byKey.get(key),
    expand: (entry) => {
      if (!isWildcard(entry)) {
        const d = byKey.get(entry);
        return d ? [d] : [];
      }
      return expand(entry);
    },
    isSensitive: (entry) => {
      if (!isWildcard(entry)) return byKey.get(entry)?.sensitive === true;
      return expand(entry).some((d) => d.sensitive === true);
    },
  };
}

export interface RolePermissionIssue {
  entry: string;
  problem: 'malformed' | 'unknown_permission' | 'wildcard_matches_nothing' | 'duplicate';
}

/**
 * Validate a role's permission entries against the registered catalog. Every exact key must be registered;
 * every wildcard must cover at least one registered permission (so a typo like `finanse.*` is caught).
 */
export function validateRolePermissions(
  entries: readonly string[],
  catalog: PermissionCatalogIndex,
): RolePermissionIssue[] {
  const issues: RolePermissionIssue[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry)) {
      issues.push({ entry, problem: 'duplicate' });
      continue;
    }
    seen.add(entry);
    if (entry !== '*' && !KEY_RE.test(entry.endsWith('.*') ? entry.slice(0, -2) : entry)) {
      issues.push({ entry, problem: 'malformed' });
      continue;
    }
    if (isWildcard(entry)) {
      if (catalog.expand(entry).length === 0) issues.push({ entry, problem: 'wildcard_matches_nothing' });
    } else if (!catalog.get(entry)) {
      issues.push({ entry, problem: 'unknown_permission' });
    }
  }
  return issues;
}

/** Effective (expanded) catalog permissions of a role, and which of them are sensitive. */
export function describeRolePermissions(
  entries: readonly string[],
  catalog: PermissionCatalogIndex,
): { effective: string[]; sensitive: string[] } {
  const effective = new Set<string>();
  for (const e of entries) for (const d of catalog.expand(e)) effective.add(d.key);
  const sorted = [...effective].sort();
  return { effective: sorted, sensitive: sorted.filter((k) => catalog.get(k)?.sensitive === true) };
}

/** Difference between two permission sets (expanded), for "23 staff gain X" previews. */
export function diffRolePermissions(
  before: readonly string[],
  after: readonly string[],
  catalog: PermissionCatalogIndex,
): { added: string[]; removed: string[]; addedSensitive: string[] } {
  const b = new Set(describeRolePermissions(before, catalog).effective);
  const a = new Set(describeRolePermissions(after, catalog).effective);
  const added = [...a].filter((k) => !b.has(k)).sort();
  const removed = [...b].filter((k) => !a.has(k)).sort();
  return { added, removed, addedSensitive: added.filter((k) => catalog.get(k)?.sensitive === true) };
}

/** Read-like permissions (`*.read`) — the only ones a read-only support session may use. */
export function isReadPermission(key: string): boolean {
  return key.endsWith('.read');
}

/** Group a catalog for role editors: module → resource → permissions. */
export function groupCatalog(defs: readonly PermissionDefinition[]) {
  const modules = new Map<string, PermissionDefinition[]>();
  for (const d of defs) {
    const mod = d.key.split('.')[0] ?? d.key;
    const list = modules.get(mod) ?? [];
    list.push(d);
    modules.set(mod, list);
  }
  return [...modules.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, permissions]) => ({
      module,
      wildcard: `${module}.*`,
      permissions: [...permissions].sort((x, y) => x.key.localeCompare(y.key)),
    }));
}
