/**
 * Configuration bundles (adoption brief §11 "reusable configuration templates, bulk setup and validation";
 * PLT-R15/R42; trial carry-forward, evaluation-and-trial.md §9).
 *
 * A bundle is versioned JSON: sections contributed by modules, each a list of items keyed by a portable business
 * key (codes, names — never database ids, which differ between properties and organizations). Applying a bundle
 * is always previewed first: per property and section, the plan lists what would be created, updated, left
 * unchanged, preserved as a local difference, or is in conflict. Bundles never delete anything.
 */
export const BUNDLE_FORMAT_VERSION = 1;

export interface BundleItem {
  key: string;
  value: Record<string, unknown>;
}

export interface BundleSection {
  schemaVersion: number;
  items: BundleItem[];
}

export interface BundleContent {
  formatVersion: number;
  sections: Record<string, BundleSection>;
}

/**
 * `preserve_local`: only add what is missing; existing items that differ are kept and reported as local
 * differences. `overwrite`: make included items match the bundle (still never deletes items not in the bundle).
 */
export type ApplyMode = 'preserve_local' | 'overwrite';

export type ItemAction = 'create' | 'update' | 'unchanged' | 'local_preserved' | 'conflict';

export interface PlannedItem {
  key: string;
  action: ItemAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** Why (for conflict and local_preserved). */
  note?: string;
}

export interface SectionPlan {
  section: string;
  items: PlannedItem[];
}

/** Deterministic deep equality on JSON values (key order independent). */
export function sameJson(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v ?? null);
}

/**
 * Plan one section for one property. `current` is the target's existing items (by key); `conflicts` are
 * section-specific validation problems found by the section provider for given keys (e.g. a referenced legal
 * entity does not exist in the target organization).
 */
export function planSection(input: {
  section: string;
  source: readonly BundleItem[];
  current: ReadonlyMap<string, Record<string, unknown>>;
  mode: ApplyMode;
  conflicts?: ReadonlyMap<string, string>;
}): SectionPlan {
  const items: PlannedItem[] = [];
  for (const s of input.source) {
    const conflict = input.conflicts?.get(s.key);
    const before = input.current.get(s.key) ?? null;
    if (conflict) {
      items.push({ key: s.key, action: 'conflict', before, after: s.value, note: conflict });
      continue;
    }
    if (!before) items.push({ key: s.key, action: 'create', before: null, after: s.value });
    else if (sameJson(pickKeys(before, s.value), s.value))
      items.push({ key: s.key, action: 'unchanged', before, after: before });
    else if (input.mode === 'preserve_local')
      items.push({
        key: s.key,
        action: 'local_preserved',
        before,
        after: before,
        note: 'The property has its own value; it is kept (apply with overwrite to replace it).',
      });
    else items.push({ key: s.key, action: 'update', before, after: { ...before, ...s.value } });
  }
  return { section: input.section, items };
}

/** Compare only the fields the bundle carries (targets may hold extra, property-specific fields). */
function pickKeys(obj: Record<string, unknown>, like: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(like).map((k) => [k, obj[k]]));
}

export function planSummary(plans: ReadonlyArray<{ propertyId: string; sections: readonly SectionPlan[] }>) {
  const count = (a: ItemAction) =>
    plans.reduce(
      (n, p) => n + p.sections.reduce((m, s) => m + s.items.filter((i) => i.action === a).length, 0),
      0,
    );
  return {
    properties: plans.length,
    create: count('create'),
    update: count('update'),
    unchanged: count('unchanged'),
    localPreserved: count('local_preserved'),
    conflicts: count('conflict'),
  };
}

/**
 * What may move from a trial to production (evaluation-and-trial.md §9). Section providers declare
 * `carryForward`; these data classes never move whatever a provider says.
 */
export const NEVER_CARRIED_FORWARD = [
  'reservations',
  'guests',
  'folios',
  'payments',
  'deposits',
  'credentials',
  'users',
  'simulatedTransactions',
  'simulatedMessages',
] as const;

export function isCarryForwardAllowed(sectionKey: string, providerAllows: boolean): boolean {
  const lower = sectionKey.toLowerCase();
  if (NEVER_CARRIED_FORWARD.some((n) => lower.split('.').includes(n.toLowerCase()))) return false;
  return providerAllows;
}

/** Separation of duties for configuration rollouts (adoption brief §11). */
export type SeparationOfDuties = 'portfolio_changes' | 'all_changes' | 'off';

export function approvalRequired(
  policy: SeparationOfDuties,
  targetCount: number,
  viaRolloutGroup: boolean,
): boolean {
  if (policy === 'off') return false;
  if (policy === 'all_changes') return true;
  return targetCount > 1 || viaRolloutGroup;
}
