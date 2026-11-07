/**
 * Reversible profile merge — pure decision logic (spec GUE-R11..R13, invariants GUE-I01..I03).
 */
import { DomainError } from '@portico/kernel';

/** Scalar profile fields that a merge may take from either side. */
export const MERGEABLE_FIELDS = [
  'title',
  'given_name',
  'middle_name',
  'family_name',
  'native_given_name',
  'native_family_name',
  'native_script',
  'preferred_name',
  'language',
  'nationality',
  'date_of_birth',
  'vip_level',
] as const;
export type MergeableField = (typeof MERGEABLE_FIELDS)[number];

export type FieldSource = 'survivor' | 'merged';
export type FieldChoices = Partial<Record<MergeableField, FieldSource>>;

export type ScalarRecord = Record<MergeableField, string | null>;

export interface FieldDecision {
  field: MergeableField;
  survivorValue: string | null;
  mergedValue: string | null;
  chosen: FieldSource;
  /** Value the survivor ends up with. */
  value: string | null;
  /** True when the survivor's value changes. */
  changes: boolean;
  /** Why this side was chosen. */
  rule: 'explicit' | 'survivor_has_value' | 'fill_empty' | 'identical';
}

/** VIP levels are ordered by recognition — a merge never downgrades recognition implicitly. */
const VIP_ORDER = ['none', 'returning', 'vip1', 'vip2', 'vip3', 'vip4', 'vvip'];

/**
 * Default rule: keep the survivor's value; fill gaps from the merged profile; for VIP keep the higher level.
 * Callers may choose per field (the merge wizard). Tags/lists are unioned by moving child records.
 */
export function decideFields(
  survivor: ScalarRecord,
  merged: ScalarRecord,
  choices: FieldChoices = {},
): FieldDecision[] {
  return MERGEABLE_FIELDS.map((field) => {
    const s = survivor[field];
    const m = merged[field];
    let chosen: FieldSource;
    let rule: FieldDecision['rule'];
    const explicit = choices[field];
    if (explicit) {
      chosen = explicit;
      rule = 'explicit';
    } else if (s === m) {
      chosen = 'survivor';
      rule = 'identical';
    } else if (field === 'vip_level' && s !== null && m !== null) {
      chosen = VIP_ORDER.indexOf(m) > VIP_ORDER.indexOf(s) ? 'merged' : 'survivor';
      rule = chosen === 'merged' ? 'fill_empty' : 'survivor_has_value';
    } else if (s === null && m !== null) {
      chosen = 'merged';
      rule = 'fill_empty';
    } else {
      chosen = 'survivor';
      rule = 'survivor_has_value';
    }
    const value = chosen === 'survivor' ? s : m;
    return { field, survivorValue: s, mergedValue: m, chosen, value, changes: value !== s, rule };
  });
}

/**
 * On unmerge, a survivor field changed by the merge is restored only if nobody changed it since; otherwise the
 * newer value is kept and reported for review.
 */
export function planFieldRestore(
  decisions: readonly FieldDecision[],
  current: ScalarRecord,
): {
  restore: Array<{ field: MergeableField; value: string | null }>;
  conflicts: Array<{ field: MergeableField; mergeValue: string | null; currentValue: string | null }>;
} {
  const restore: Array<{ field: MergeableField; value: string | null }> = [];
  const conflicts: Array<{ field: MergeableField; mergeValue: string | null; currentValue: string | null }> =
    [];
  for (const d of decisions) {
    if (!d.changes) continue;
    if (current[d.field] === d.value) restore.push({ field: d.field, value: d.survivorValue });
    else conflicts.push({ field: d.field, mergeValue: d.value, currentValue: current[d.field] });
  }
  return { restore, conflicts };
}

/**
 * Follow `merged_into` links to the active survivor (GUE-I01/I13). Throws on a cycle or an over-long chain —
 * both indicate corrupted data and must never be silently resolved.
 */
export function followMergeChain(
  start: string,
  lookup: (id: string) => { status: string; mergedInto: string | null } | undefined,
  maxDepth = 32,
): { id: string; path: string[] } {
  const path: string[] = [start];
  let current = start;
  for (let i = 0; i < maxDepth; i++) {
    const row = lookup(current);
    if (!row) return { id: current, path };
    if (row.status !== 'merged' || !row.mergedInto) return { id: current, path };
    if (path.includes(row.mergedInto)) throw chainCorrupt(start, `a cycle at profile ${row.mergedInto}`);
    current = row.mergedInto;
    path.push(current);
  }
  throw chainCorrupt(start, `more than ${maxDepth} links`);
}

function chainCorrupt(start: string, what: string): DomainError {
  return new DomainError(
    'merge_chain_corrupt',
    `The merge history of profile ${start} is inconsistent (${what}). Nothing was changed; contact support so the merge records can be repaired.`,
    { status: 500, details: { profileId: start } },
  );
}

/** Consent conflict on merge: the most recent statement by the guest wins (a later withdrawal is never lost). */
export function newerConsentWins(
  survivor: { changedAt: Date },
  merged: { changedAt: Date },
): 'survivor' | 'merged' {
  return merged.changedAt.getTime() > survivor.changedAt.getTime() ? 'merged' : 'survivor';
}

export type PostMergeOwner = 'survivor' | 'restored';

/**
 * Suggested owner for a record attached to the survivor AFTER the merge (unmerge review, GUE-R12):
 *  - a record created by a caller that still referenced the merged profile id belongs to the restored profile;
 *  - a contact value that existed on the merged profile before the merge belongs to it;
 *  - otherwise the survivor keeps it.
 */
export function suggestPostMergeOwner(
  item: {
    requestedProfileId?: string | null;
    normalizedContact?: string | null;
    documentHash?: string | null;
  },
  merged: { id: string; contactValues: readonly string[]; documentHashes?: readonly string[] },
): { owner: PostMergeOwner; reason: string } {
  if (item.requestedProfileId && item.requestedProfileId === merged.id) {
    return { owner: 'restored', reason: 'Recorded against the merged profile’s original id' };
  }
  if (item.documentHash && (merged.documentHashes ?? []).includes(item.documentHash)) {
    return { owner: 'restored', reason: 'Same identity document as the merged profile before the merge' };
  }
  if (item.normalizedContact && merged.contactValues.includes(item.normalizedContact)) {
    return { owner: 'restored', reason: 'Matches a contact of the merged profile before the merge' };
  }
  return { owner: 'survivor', reason: 'No identifier links it to the merged profile' };
}
