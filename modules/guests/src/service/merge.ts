/**
 * Reversible profile merge and unmerge (spec GUE-R11..R13, invariants GUE-I01..I03, scenario S15).
 *
 * A merge record keeps: full pre-merge snapshots of both profiles and every child row, the field decisions,
 * the exact list of child rows moved (by table), survivor rows changed (before/after), and — reported by other
 * modules — every external reference re-pointed. Unmerge uses exactly that record, so a mistaken merge is
 * reversed precisely; records created after the merge are listed for review with a suggested owner.
 */
import { sql, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  type EntityRef,
  ForbiddenError,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { z } from 'zod';
import type { mergePreview, mergeView, unmergePreview } from '../contracts';
import { orderedPair, scoreMatch } from '../domain/duplicates';
import {
  decideFields,
  type FieldChoices,
  type FieldDecision,
  MERGEABLE_FIELDS,
  type MergeableField,
  newerConsentWins,
  type PostMergeOwner,
  planFieldRestore,
  type ScalarRecord,
  suggestPostMergeOwner,
} from '../domain/merge';
import { nameKeys } from '../domain/names';
import type { GuestsPorts } from '../ports';
import type { ProfilesTable } from '../tables';
import { recomputeDocumentRetention } from './documents';
import { hashExactKeys, loadSubjects } from './duplicates';
import {
  actorKey,
  db,
  forwardingUnavailable,
  iso,
  linkedPropertyIds,
  loadProfileRow,
  type ProfileRow,
  requireVisibleProfile,
  resolveAccess,
} from './internal';

export type MergePreview = z.infer<typeof mergePreview>;
export type MergeView = z.infer<typeof mergeView>;
export type UnmergePreview = z.infer<typeof unmergePreview>;

// ───────────────────────────── Child tables ─────────────────────────────

interface ChildSpec {
  key: string;
  table: string;
  /** Column holding the profile id. */
  owner: string;
  /** Row identity column. */
  idColumn: string;
  /** Business key for conflicts with the survivor's rows (null = never conflicts). */
  conflictKey: ((r: Record<string, unknown>) => string) | null;
  /** Rows that must not move (would become self-references). */
  skip?: (r: Record<string, unknown>, survivorId: string) => boolean;
}

const s = (v: unknown) => String(v ?? '').toLowerCase();

export const CHILD_SPECS: readonly ChildSpec[] = [
  {
    key: 'contact_points',
    table: 'guests.contact_points',
    owner: 'profile_id',
    idColumn: 'id',
    conflictKey: (r) => `${r.kind}|${r.normalized ?? s(r.value)}`,
  },
  {
    key: 'preferences',
    table: 'guests.preferences',
    owner: 'profile_id',
    idColumn: 'id',
    conflictKey: (r) => `${s(r.category)}|${s(r.value)}|${r.scope_property_id ?? ''}`,
  },
  { key: 'alerts', table: 'guests.alerts', owner: 'profile_id', idColumn: 'id', conflictKey: null },
  { key: 'notes', table: 'guests.notes', owner: 'profile_id', idColumn: 'id', conflictKey: null },
  {
    key: 'identity_documents',
    table: 'guests.identity_documents',
    owner: 'profile_id',
    idColumn: 'id',
    conflictKey: (r) => String(r.number_hash),
  },
  {
    key: 'special_needs',
    table: 'guests.special_needs',
    owner: 'profile_id',
    idColumn: 'id',
    conflictKey: null,
  },
  {
    key: 'consents',
    table: 'guests.consents',
    owner: 'profile_id',
    idColumn: 'id',
    conflictKey: (r) => `${r.legal_entity_id}|${r.purpose}`,
  },
  {
    key: 'stay_history',
    table: 'guests.stay_history',
    owner: 'profile_id',
    idColumn: 'id',
    conflictKey: (r) => `${r.stay_id}|${r.role}`,
  },
  {
    key: 'company_contacts',
    table: 'guests.company_contacts',
    owner: 'profile_id',
    idColumn: 'id',
    conflictKey: (r) => `${r.company_id}|${r.role}`,
  },
  {
    key: 'relationships_out',
    table: 'guests.relationships',
    owner: 'profile_id',
    idColumn: 'id',
    conflictKey: (r) => `${r.related_profile_id}|${r.kind}`,
    skip: (r, survivorId) => r.related_profile_id === survivorId,
  },
  {
    key: 'relationships_in',
    table: 'guests.relationships',
    owner: 'related_profile_id',
    idColumn: 'id',
    conflictKey: (r) => `${r.profile_id}|${r.kind}`,
    skip: (r, survivorId) => r.profile_id === survivorId,
  },
  {
    key: 'profile_properties',
    table: 'guests.profile_properties',
    owner: 'profile_id',
    idColumn: 'property_id',
    conflictKey: (r) => String(r.property_id),
  },
];

type Row = Record<string, unknown>;
export interface ProfileSnapshot {
  profile: Row;
  children: Record<string, Row[]>;
}

const table = (t: string) => sql.table(t);
const col = (alias: string, c: string) => sql.ref(`${alias}.${c}`);

async function childRows(tx: TxContext, spec: ChildSpec, profileId: string): Promise<Row[]> {
  const { rows } = await sql<{ rows: Row[] }>`
    select coalesce(jsonb_agg(to_jsonb(t) order by ${col('t', spec.idColumn)}), '[]'::jsonb) as rows
    from ${table(spec.table)} as t where ${col('t', spec.owner)} = ${profileId}`.execute(tx.db);
  return rows[0]?.rows ?? [];
}

/** Full snapshot of a profile and every child row, as stored (JSON produced by Postgres). */
export async function snapshotProfile(tx: TxContext, profileId: string): Promise<ProfileSnapshot> {
  const { rows } = await sql<{
    p: Row;
  }>`select to_jsonb(p) as p from guests.profiles p where p.id = ${profileId}`.execute(tx.db);
  const profile = rows[0]?.p;
  if (!profile) throw new NotFoundError('guest_profile', profileId);
  const children: Record<string, Row[]> = {};
  for (const spec of CHILD_SPECS) children[spec.key] = await childRows(tx, spec, profileId);
  return { profile, children };
}

async function moveRows(
  tx: TxContext,
  spec: ChildSpec,
  ids: readonly string[],
  from: string,
  to: string,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { rows } = await sql<{ k: string }>`
    update ${table(spec.table)} as t set ${sql.ref(spec.owner)} = ${to}
    where ${col('t', spec.idColumn)} = any(${[...ids]}::uuid[]) and ${col('t', spec.owner)} = ${from}
    returning ${col('t', spec.idColumn)}::text as k`.execute(tx.db);
  return rows.map((r) => r.k);
}

// ───────────────────────────── Guards ─────────────────────────────

function scalars(row: ProfileRow | Row): ScalarRecord {
  const r = row as Record<string, unknown>;
  return Object.fromEntries(
    MERGEABLE_FIELDS.map((f) => [f, r[f] === undefined || r[f] === null ? null : String(r[f])]),
  ) as ScalarRecord;
}

/** Merge/unmerge permission must cover a property where each profile is known (or be organization-wide). */
function requireOnProfiles(tx: TxContext, permission: string, linkSets: readonly string[][]): void {
  if (!tx.authz.can(permission)) throw new ForbiddenError(permission);
  const scope = tx.authz.propertyScope(permission);
  if (scope === 'all') return;
  for (const links of linkSets) {
    if (!links.some((p) => scope.includes(p))) throw new ForbiddenError(permission);
  }
}

async function assertMergeAllowedByAuthority(
  tx: TxContext,
  ports: GuestsPorts,
  rows: ProfileRow[],
): Promise<void> {
  const mirrored = await db(tx)
    .selectFrom('guests.external_refs')
    .select(['entity_id', 'system_name'])
    .where('entity_type', '=', 'profile')
    .where(
      'entity_id',
      'in',
      rows.map((r) => r.id),
    )
    .execute();
  if (mirrored.length > 0) {
    throw new BusinessRuleError(
      'merge_in_system_of_record',
      `One of these profiles is mirrored from ${mirrored[0]?.system_name}. Merge duplicates in that system (it is the system of record); Portico will follow after the next sync.`,
      { mirroredProfileIds: mirrored.map((m) => m.entity_id) },
    );
  }
  for (const r of rows) {
    const mode = await ports.platform.assertWritable(tx, r.home_property_id, 'guestProfiles');
    if (mode === 'forward') throw forwardingUnavailable();
  }
}

// ───────────────────────────── Preview ─────────────────────────────

interface MergePlan {
  decisions: FieldDecision[];
  move: Record<string, string[]>;
  keep: Record<string, string[]>;
  /** Survivor rows to update because the merged row's version is better (verified contact, newer consent). */
  survivorUpdates: Array<{ table: string; id: string; before: Row; after: Row }>;
}

function planMerge(survivor: ProfileSnapshot, merged: ProfileSnapshot, choices: FieldChoices): MergePlan {
  const decisions = decideFields(scalars(survivor.profile), scalars(merged.profile), choices);
  const move: Record<string, string[]> = {};
  const keep: Record<string, string[]> = {};
  const survivorUpdates: MergePlan['survivorUpdates'] = [];
  const survivorId = String(survivor.profile.id);
  for (const spec of CHILD_SPECS) {
    const mine = survivor.children[spec.key] ?? [];
    const theirs = merged.children[spec.key] ?? [];
    const byKey = new Map(spec.conflictKey ? mine.map((r) => [spec.conflictKey?.(r) ?? '', r]) : []);
    move[spec.key] = [];
    keep[spec.key] = [];
    for (const r of theirs) {
      const rid = String(r[spec.idColumn]);
      if (spec.skip?.(r, survivorId)) {
        keep[spec.key]?.push(rid);
        continue;
      }
      const clash = spec.conflictKey ? byKey.get(spec.conflictKey(r)) : undefined;
      if (!clash) {
        move[spec.key]?.push(rid);
        continue;
      }
      keep[spec.key]?.push(rid);
      if (spec.key === 'contact_points' && r.verified === true && clash.verified !== true) {
        survivorUpdates.push({
          table: spec.table,
          id: String(clash.id),
          before: {
            verified: clash.verified,
            verified_at: clash.verified_at,
            verification_method: clash.verification_method,
          },
          after: { verified: true, verified_at: r.verified_at, verification_method: r.verification_method },
        });
      }
      if (
        spec.key === 'consents' &&
        newerConsentWins(
          { changedAt: new Date(String(clash.changed_at)) },
          { changedAt: new Date(String(r.changed_at)) },
        ) === 'merged' &&
        (r.state !== clash.state || JSON.stringify(r.evidence) !== JSON.stringify(clash.evidence))
      ) {
        survivorUpdates.push({
          table: spec.table,
          id: String(clash.id),
          before: {
            state: clash.state,
            source: clash.source,
            evidence: clash.evidence,
            changed_at: clash.changed_at,
          },
          after: { state: r.state, source: r.source, evidence: r.evidence, changed_at: r.changed_at },
        });
      }
    }
  }
  return { decisions, move, keep, survivorUpdates };
}

async function loadPair(
  tx: TxContext,
  ports: GuestsPorts,
  survivorId: string,
  mergedId: string,
  lock: boolean,
) {
  if (survivorId === mergedId) {
    throw new ValidationError('same_profile', 'Choose two different profiles to merge.');
  }
  // Both must be fully visible to the reviewer (never merge what you cannot fully see).
  const access = await resolveAccess(tx, ports);
  const fullAccess = { ...access, sharedViewing: false };
  const a = await requireVisibleProfile(tx, ports, survivorId, { access: fullAccess });
  const b = await requireVisibleProfile(tx, ports, mergedId, { access: fullAccess });
  if (a.resolvedFrom || b.resolvedFrom) {
    throw new BusinessRuleError(
      'profile_already_merged',
      'One of these profiles was already merged. Open the surviving profile and merge from there.',
      { survivorId: a.row.id, mergedId: b.row.id },
    );
  }
  for (const vp of [a, b]) {
    if (vp.row.status !== 'active') {
      throw new BusinessRuleError(
        'profile_not_active',
        `Profile ${vp.row.id} is ${vp.row.status} and cannot be merged.`,
        { profileId: vp.row.id, status: vp.row.status },
      );
    }
  }
  requireOnProfiles(tx, 'guests.profile.merge', [a.links, b.links]);
  if (lock) {
    // Deterministic lock order prevents deadlocks between concurrent merges of overlapping pairs.
    const [first, second] = orderedPair(survivorId, mergedId);
    await loadProfileRow(tx, first, { forUpdate: true });
    await loadProfileRow(tx, second, { forUpdate: true });
  }
  const survivor = (await loadProfileRow(tx, survivorId)) as ProfileRow;
  const merged = (await loadProfileRow(tx, mergedId)) as ProfileRow;
  if (survivor.status !== 'active' || merged.status !== 'active') {
    throw new ConflictError(
      'profile_changed',
      'One of the profiles changed while you were reviewing. Refresh and try again.',
    );
  }
  return { survivor, merged };
}

async function referenceCounts(
  tx: TxContext,
  ports: GuestsPorts,
  profileId: string,
): Promise<MergePreview['references']> {
  const out: MergePreview['references'] = [];
  for (const c of ports.referenceCounters ?? []) {
    try {
      out.push({ module: c.module, count: await c.countReferences(tx, profileId), status: 'counted' });
    } catch {
      out.push({ module: c.module, count: null, status: 'unavailable' });
    }
  }
  return out;
}

/** Preview the merge result and its impact before committing (UX: previews before consequences). */
export async function previewMerge(
  tx: TxContext,
  ports: GuestsPorts,
  input: { survivorId: string; mergedId: string; fieldChoices?: Record<string, 'survivor' | 'merged'> },
): Promise<MergePreview> {
  const choices = validateChoices(input.fieldChoices);
  const { survivor, merged } = await loadPair(tx, ports, input.survivorId, input.mergedId, false);
  const plan = planMerge(
    await snapshotProfile(tx, survivor.id),
    await snapshotProfile(tx, merged.id),
    choices,
  );
  const warnings: string[] = [];
  if (survivor.date_of_birth && merged.date_of_birth && survivor.date_of_birth !== merged.date_of_birth) {
    warnings.push('The profiles have different dates of birth — make sure they are the same person.');
  }
  if (merged.legal_hold)
    warnings.push('The merged profile is under legal hold; the hold moves to the survivor.');
  if ((ports.referenceCounters ?? []).length === 0) {
    warnings.push(
      'Reference counts from other modules are not connected yet; they re-point by event after the merge.',
    );
  }
  return {
    survivorId: survivor.id,
    mergedId: merged.id,
    fields: plan.decisions.map(({ value: _value, ...d }) => d),
    children: Object.fromEntries(
      CHILD_SPECS.map((c) => [
        c.key,
        { move: plan.move[c.key]?.length ?? 0, keepOnMerged: plan.keep[c.key]?.length ?? 0 },
      ]),
    ),
    references: await referenceCounts(tx, ports, merged.id),
    warnings,
  };
}

function validateChoices(raw: Record<string, 'survivor' | 'merged'> | undefined): FieldChoices {
  const out: FieldChoices = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    const field = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`) as MergeableField;
    if (!(MERGEABLE_FIELDS as readonly string[]).includes(field)) {
      throw new ValidationError('unknown_field', `"${k}" is not a field that can be chosen in a merge.`, {
        field: k,
      });
    }
    out[field] = v;
  }
  return out;
}

// ───────────────────────────── Merge ─────────────────────────────

/** Provider (domain map): reversible merge. Emits guests.profile.merged for other modules to re-point. */
export async function mergeProfiles(
  tx: TxContext,
  ports: GuestsPorts,
  input: {
    survivorId: string;
    mergedId: string;
    reason: string;
    fieldChoices?: Record<string, 'survivor' | 'merged'>;
  },
): Promise<{ mergeId: string }> {
  const choices = validateChoices(input.fieldChoices);
  const { survivor, merged } = await loadPair(tx, ports, input.survivorId, input.mergedId, true);
  await assertMergeAllowedByAuthority(tx, ports, [survivor, merged]);

  const snapSurvivor = await snapshotProfile(tx, survivor.id);
  const snapMerged = await snapshotProfile(tx, merged.id);
  const plan = planMerge(snapSurvivor, snapMerged, choices);
  const mergeId = newId(tx.now.getTime());

  // 1. Survivor scalars.
  const changes = plan.decisions.filter((d) => d.changes);
  if (changes.length > 0 || merged.legal_hold) {
    const set: Partial<Record<keyof ProfilesTable, unknown>> = {};
    for (const d of changes) set[d.field] = d.value;
    const nextNames = { ...scalars(survivor), ...Object.fromEntries(changes.map((d) => [d.field, d.value])) };
    const keys = nameKeys({
      givenName: nextNames.given_name,
      middleName: nextNames.middle_name,
      familyName: nextNames.family_name ?? survivor.family_name,
      nativeGivenName: nextNames.native_given_name,
      nativeFamilyName: nextNames.native_family_name,
    });
    await db(tx)
      .updateTable('guests.profiles')
      .set({
        ...(set as Record<string, string | null>),
        search_name: keys.searchName,
        search_name_native: keys.searchNameNative,
        ...(merged.legal_hold ? { legal_hold: true } : {}),
      })
      .where('id', '=', survivor.id)
      .execute();
  }
  await db(tx)
    .updateTable('guests.profiles')
    .set({ version: sql`version + 1` })
    .where('id', '=', survivor.id)
    .execute();

  // 2. Survivor child rows that take the better value from the merged side (recorded for exact reversal).
  for (const u of plan.survivorUpdates) await applyRowValues(tx, u.table, u.id, u.after);

  // 3. Move child rows (the exact ids are recorded).
  const moved: Record<string, string[]> = {};
  for (const spec of CHILD_SPECS) {
    moved[spec.key] = await moveRows(tx, spec, plan.move[spec.key] ?? [], merged.id, survivor.id);
  }

  // 4. The merged profile is never deleted: status merged → survivor.
  await db(tx)
    .updateTable('guests.profiles')
    .set({ status: 'merged', merged_into: survivor.id, version: sql`version + 1` })
    .where('id', '=', merged.id)
    .execute();

  // 5. Close the duplicate suggestion for this pair (if any).
  const [a, b] = orderedPair(survivor.id, merged.id);
  await db(tx)
    .updateTable('guests.duplicate_candidates')
    .set({
      status: 'merged',
      merge_id: mergeId,
      resolved_at: tx.now,
      resolved_by: actorKey(tx),
      resolution_reason: input.reason,
      version: sql`version + 1`,
    })
    .where('profile_a_id', '=', a)
    .where('profile_b_id', '=', b)
    .execute();

  // 6. The merge record.
  await db(tx)
    .insertInto('guests.merges')
    .values({
      id: mergeId,
      tenant_id: tx.tenantId,
      survivor_id: survivor.id,
      merged_id: merged.id,
      reason: input.reason,
      snapshot: JSON.stringify({ survivor: snapSurvivor, merged: snapMerged }),
      decisions: JSON.stringify(plan.decisions),
      moved: JSON.stringify(moved),
      survivor_updates: JSON.stringify(plan.survivorUpdates),
      merged_at: tx.now,
      merged_by: actorKey(tx),
    })
    .execute();

  const movedCounts = Object.fromEntries(Object.entries(moved).map(([k, v]) => [k, v.length]));
  for (const target of [survivor.id, merged.id]) {
    await tx.audit({
      action: 'guests.profile.merge',
      target: { type: 'guest_profile', id: target },
      reason: input.reason,
      before: { status: 'active' },
      after: target === merged.id ? { status: 'merged', mergedInto: survivor.id } : { status: 'active' },
      metadata: {
        mergeId,
        survivorId: survivor.id,
        mergedId: merged.id,
        fieldsTaken: changes.map((d) => ({ field: d.field, from: d.chosen, rule: d.rule })),
        moved: movedCounts,
      },
    });
  }
  await tx.emit({
    type: 'guests.profile.merged',
    aggregate: { type: 'guest_profile', id: survivor.id },
    payload: { mergeId, survivorId: survivor.id, mergedId: merged.id },
  });
  return { mergeId };
}

async function applyRowValues(tx: TxContext, tableName: string, id: string, values: Row): Promise<void> {
  const entries = Object.entries(values);
  if (entries.length === 0) return;
  const sets = sql.join(
    entries.map(([k, v]) =>
      k === 'evidence'
        ? sql`${sql.ref(k)} = ${JSON.stringify(v ?? {})}::jsonb`
        : sql`${sql.ref(k)} = ${v as string}`,
    ),
  );
  await sql`update ${table(tableName)} set ${sets} where id = ${id}`.execute(tx.db);
}

/**
 * Provider for consumers of guests.profile.merged: record the references a module re-pointed so an unmerge can
 * restore exactly those (GUE-I03). Idempotent.
 */
export async function recordReferenceRepoints(
  tx: TxContext,
  input: { mergeId: string; module: string; references: Array<EntityRef & { field?: string | null }> },
): Promise<{ recorded: number }> {
  // Called by other modules' consumers of guests.profile.merged, which run as system processes.
  if (tx.actor.kind !== 'system') {
    throw new ForbiddenError('guests.profile.merge', {
      reason: 'Only event consumers record re-pointed references',
    });
  }
  const merge = await db(tx)
    .selectFrom('guests.merges')
    .select(['id', 'status'])
    .where('id', '=', input.mergeId)
    .executeTakeFirst();
  if (!merge) throw new NotFoundError('merge', input.mergeId);
  if (merge.status !== 'active') {
    throw new BusinessRuleError(
      'merge_not_active',
      `Merge ${input.mergeId} is ${merge.status}; references must not be re-pointed to its survivor any more.`,
      { status: merge.status },
    );
  }
  let recorded = 0;
  for (const r of input.references) {
    const res = await db(tx)
      .insertInto('guests.merge_reference_repoints')
      .values({
        id: newId(tx.now.getTime()),
        tenant_id: tx.tenantId,
        merge_id: input.mergeId,
        module: input.module,
        ref_type: r.type,
        ref_id: r.id,
        field: r.field ?? null,
        recorded_at: tx.now,
      })
      .onConflict((oc) => oc.doNothing())
      .returning('id')
      .executeTakeFirst();
    if (res) recorded++;
  }
  return { recorded };
}

// ───────────────────────────── Unmerge ─────────────────────────────

interface StoredMerge {
  id: string;
  survivor_id: string;
  merged_id: string;
  status: 'active' | 'reversed' | 'erased';
  snapshot: { survivor: ProfileSnapshot; merged: ProfileSnapshot } | null;
  decisions: FieldDecision[];
  moved: Record<string, string[]>;
  survivor_updates: MergePlan['survivorUpdates'];
  merged_at: Date;
}

async function loadMerge(tx: TxContext, mergeId: string, lock = false): Promise<StoredMerge> {
  let q = db(tx).selectFrom('guests.merges').selectAll().where('id', '=', mergeId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw new NotFoundError('merge', mergeId);
  return row as unknown as StoredMerge;
}

interface PostMergeCandidate {
  kind: string;
  id: string;
  summary: string;
  createdAt: string;
  suggestedOwner: PostMergeOwner;
  reason: string;
  ref?: EntityRef;
}

/** Records attached to the survivor after the merge (not in its snapshot, not moved by the merge). */
async function postMergeItems(tx: TxContext, merge: StoredMerge): Promise<PostMergeCandidate[]> {
  const snap = merge.snapshot;
  if (!snap) return [];
  const mergedContacts = (snap.merged.children.contact_points ?? [])
    .map((c) => String(c.normalized ?? ''))
    .filter(Boolean);
  const mergedDocs = (snap.merged.children.identity_documents ?? []).map((d) => String(d.number_hash));
  const out: PostMergeCandidate[] = [];
  for (const spec of CHILD_SPECS) {
    if (spec.key === 'profile_properties') continue; // derived from stays; re-linked after reassignment
    const known = new Set([
      ...(snap.survivor.children[spec.key] ?? []).map((r) => String(r[spec.idColumn])),
      ...(merge.moved[spec.key] ?? []),
    ]);
    const current = await childRows(tx, spec, merge.survivor_id);
    for (const r of current) {
      const id = String(r[spec.idColumn]);
      if (known.has(id)) continue;
      const suggestion = suggestPostMergeOwner(
        {
          requestedProfileId: (r.requested_profile_id as string | null | undefined) ?? null,
          normalizedContact: spec.key === 'contact_points' ? ((r.normalized as string | null) ?? null) : null,
          documentHash: spec.key === 'identity_documents' ? ((r.number_hash as string | null) ?? null) : null,
        },
        { id: merge.merged_id, contactValues: mergedContacts, documentHashes: mergedDocs },
      );
      out.push({
        kind: spec.key,
        id,
        summary: summarize(spec.key, r),
        createdAt: new Date(String(r.created_at)).toISOString(),
        suggestedOwner: suggestion.owner,
        reason: suggestion.reason,
        ...(spec.key === 'stay_history' ? { ref: { type: 'stay', id: String(r.stay_id) } } : {}),
      });
    }
  }
  return out;
}

function summarize(kind: string, r: Row): string {
  switch (kind) {
    case 'stay_history':
      return `Stay ${r.stay_id} (${r.role}) at property ${r.property_id}, ${r.arrival} → ${r.departure}`;
    case 'contact_points':
      return `${r.kind} contact (${r.verified ? 'verified' : 'unverified'})`;
    case 'notes':
      return `Note (${r.visibility})`;
    case 'alerts':
      return `Alert (${r.severity})`;
    case 'preferences':
      return `Preference: ${r.category}`;
    case 'identity_documents':
      return `Identity document (${r.doc_type}, ${r.issuing_country})`;
    case 'consents':
      return `Consent ${r.purpose}: ${r.state}`;
    case 'company_contacts':
      return `Company contact (${r.role})`;
    default:
      return kind.replace(/_/g, ' ');
  }
}

async function unmergeBlock(tx: TxContext, merge: StoredMerge): Promise<string | null> {
  if (merge.status === 'reversed') return 'This merge was already reversed.';
  if (merge.status === 'erased')
    return 'The surviving profile was erased on request; this merge can no longer be reversed.';
  const survivor = await loadProfileRow(tx, merge.survivor_id);
  if (survivor?.status === 'merged') {
    const later = await db(tx)
      .selectFrom('guests.merges')
      .select('id')
      .where('merged_id', '=', merge.survivor_id)
      .where('status', '=', 'active')
      .executeTakeFirst();
    return `The surviving profile was itself merged later (merge ${later?.id ?? 'unknown'}). Reverse that merge first.`;
  }
  if (survivor?.status === 'anonymized')
    return 'The surviving profile was anonymized; the merge cannot be reversed.';
  const merged = await loadProfileRow(tx, merge.merged_id);
  if (merged?.status !== 'merged' || merged.merged_into !== merge.survivor_id) {
    return 'The merged profile is no longer linked to this survivor; the merge record is inconsistent. Contact support.';
  }
  return null;
}

async function repointCounts(tx: TxContext, mergeId: string): Promise<Record<string, number>> {
  const rows = await db(tx)
    .selectFrom('guests.merge_reference_repoints')
    .select(['module', sql<number>`count(*)::int`.as('n')])
    .where('merge_id', '=', mergeId)
    .groupBy('module')
    .execute();
  return Object.fromEntries(rows.map((r) => [r.module, r.n]));
}

async function requireMergeAccess(tx: TxContext, ports: GuestsPorts, merge: StoredMerge, permission: string) {
  // Both profiles must be visible to the reviewer; 404 otherwise.
  const access = await resolveAccess(tx, ports);
  if (!access.readAll) {
    const ls = await linkedPropertyIds(tx, merge.survivor_id);
    const lm = await linkedPropertyIds(tx, merge.merged_id);
    const snapLinks = (merge.snapshot?.merged.children.profile_properties ?? []).map((r) =>
      String(r.property_id),
    );
    const visible = (links: string[]) => links.some((p) => access.readPropertyIds.includes(p));
    if (!visible(ls) || !(visible(lm) || visible(snapLinks))) throw new NotFoundError('merge', merge.id);
    requireOnProfiles(tx, permission, [ls, [...lm, ...snapLinks]]);
  } else {
    requirePermission(tx, permission);
  }
}

export async function getMerge(tx: TxContext, ports: GuestsPorts, mergeId: string): Promise<MergeView> {
  const merge = await loadMerge(tx, mergeId);
  await requireMergeAccess(tx, ports, merge, 'guests.profile.read');
  const row = await db(tx)
    .selectFrom('guests.merges')
    .selectAll()
    .where('id', '=', mergeId)
    .executeTakeFirstOrThrow();
  return {
    id: row.id,
    survivorId: row.survivor_id,
    mergedId: row.merged_id,
    status: row.status,
    reason: row.reason,
    mergedAt: iso(row.merged_at) as string,
    mergedBy: row.merged_by,
    reversedAt: iso(row.reversed_at),
    reversedBy: row.reversed_by,
    reverseReason: row.reverse_reason,
    moved: Object.fromEntries(
      Object.entries(row.moved as Record<string, string[]>).map(([k, v]) => [k, v.length]),
    ),
    referencesRepointed: await repointCounts(tx, mergeId),
    unmergeResult: row.unmerge_result ?? null,
    version: row.version,
  };
}

export async function listMergesForProfile(
  tx: TxContext,
  ports: GuestsPorts,
  profileId: string,
): Promise<MergeView[]> {
  const vp = await requireVisibleProfile(tx, ports, profileId);
  const rows = await db(tx)
    .selectFrom('guests.merges')
    .select('id')
    .where((eb) => eb.or([eb('survivor_id', '=', vp.row.id), eb('merged_id', '=', vp.row.id)]))
    .orderBy('merged_at', 'desc')
    .execute();
  const out: MergeView[] = [];
  for (const r of rows) out.push(await getMerge(tx, ports, r.id));
  return out;
}

export async function previewUnmerge(
  tx: TxContext,
  ports: GuestsPorts,
  mergeId: string,
): Promise<UnmergePreview> {
  const merge = await loadMerge(tx, mergeId);
  await requireMergeAccess(tx, ports, merge, 'guests.profile.unmerge');
  const blocked = await unmergeBlock(tx, merge);
  const survivor = await loadProfileRow(tx, merge.survivor_id);
  const fields = survivor
    ? planFieldRestore(merge.decisions, scalars(survivor))
    : { restore: [], conflicts: [] };
  return {
    mergeId,
    canUnmerge: blocked === null,
    blockedReason: blocked,
    postMergeItems: blocked ? [] : (await postMergeItems(tx, merge)).map(({ ref: _ref, ...i }) => i),
    fieldRestores: fields.restore.map((r) => ({ field: r.field, restoreTo: r.value })),
    fieldConflicts: fields.conflicts,
    referencesToRestore: await repointCounts(tx, mergeId),
  };
}

/**
 * Provider (domain map): reverse a merge (GUE-R12). Restores the merged profile from its snapshot, moves back
 * exactly the rows the merge moved, reverts survivor rows the merge changed (unless changed since), assigns
 * post-merge records per the reviewed assignments (default: suggested owner), and emits
 * guests.profile.unmerged with the exact references each module must restore.
 */
export async function unmergeProfiles(
  tx: TxContext,
  ports: GuestsPorts,
  input: {
    mergeId: string;
    reason: string;
    assignments?: Array<{ kind: string; id: string; owner: PostMergeOwner }>;
  },
): Promise<{ restoredId: string; survivorId: string; reassigned: number; conflicts: unknown[] }> {
  const merge = await loadMerge(tx, input.mergeId, true);
  await requireMergeAccess(tx, ports, merge, 'guests.profile.unmerge');
  const blocked = await unmergeBlock(tx, merge);
  if (blocked) throw new BusinessRuleError('unmerge_not_possible', blocked, { mergeId: merge.id });
  const [first, second] = orderedPair(merge.survivor_id, merge.merged_id);
  await loadProfileRow(tx, first, { forUpdate: true });
  await loadProfileRow(tx, second, { forUpdate: true });
  const snap = merge.snapshot;
  if (!snap) throw new BusinessRuleError('unmerge_not_possible', 'The merge snapshot is missing.', {});

  const items = await postMergeItems(tx, merge);
  const assigned = new Map((input.assignments ?? []).map((a) => [`${a.kind}:${a.id}`, a.owner]));
  for (const key of assigned.keys()) {
    if (!items.some((i) => `${i.kind}:${i.id}` === key)) {
      throw new ValidationError(
        'unknown_post_merge_item',
        `Assignment ${key} does not match a record added after the merge. Refresh the unmerge preview.`,
        { item: key },
      );
    }
  }
  const conflicts: unknown[] = [];

  // 1. Move back exactly what the merge moved.
  const restoredCounts: Record<string, number> = {};
  for (const spec of CHILD_SPECS) {
    const ids = merge.moved[spec.key] ?? [];
    const back = await moveRows(tx, spec, ids, merge.survivor_id, merge.merged_id);
    restoredCounts[spec.key] = back.length;
    const missing = ids.filter((i) => !back.includes(i));
    if (missing.length) conflicts.push({ kind: spec.key, missing, note: 'Removed or moved since the merge' });
  }

  // 2. Revert survivor rows the merge changed — only if unchanged since.
  for (const u of merge.survivor_updates) {
    const { rows } =
      await sql<Row>`select to_jsonb(t) as r from ${table(u.table)} t where t.id = ${u.id}`.execute(tx.db);
    const current = (rows[0] as { r?: Row } | undefined)?.r;
    if (!current) continue;
    const untouched = Object.entries(u.after).every(
      ([k, v]) => JSON.stringify(current[k]) === JSON.stringify(v),
    );
    if (untouched) await applyRowValues(tx, u.table, u.id, u.before);
    else conflicts.push({ kind: u.table, id: u.id, note: 'Changed after the merge; newer value kept' });
  }

  // 3. Post-merge records → reviewed owner (default: suggestion).
  const reassignedRefs: EntityRef[] = [];
  let reassigned = 0;
  for (const item of items) {
    const owner = assigned.get(`${item.kind}:${item.id}`) ?? item.suggestedOwner;
    if (owner !== 'restored') continue;
    const spec = CHILD_SPECS.find((c) => c.key === item.kind);
    if (!spec) continue;
    try {
      await sql`savepoint unmerge_item`.execute(tx.db);
      const done = await moveRows(tx, spec, [item.id], merge.survivor_id, merge.merged_id);
      await sql`release savepoint unmerge_item`.execute(tx.db);
      if (done.length) {
        reassigned++;
        if (item.ref) reassignedRefs.push(item.ref);
      }
    } catch {
      await sql`rollback to savepoint unmerge_item`.execute(tx.db);
      conflicts.push({
        kind: item.kind,
        id: item.id,
        note: 'Already present on the restored profile; kept on survivor',
      });
    }
  }

  // 4. Survivor scalar fields changed by the merge — restored unless edited since.
  const survivor = (await loadProfileRow(tx, merge.survivor_id)) as ProfileRow;
  const fieldPlan = planFieldRestore(merge.decisions, scalars(survivor));
  const snapSurvivor = snap.survivor.profile;
  const survivorSet: Record<string, unknown> = {};
  for (const r of fieldPlan.restore) survivorSet[r.field] = r.value;
  if (fieldPlan.restore.length > 0) {
    const next = { ...scalars(survivor), ...survivorSet } as ScalarRecord;
    const keys = nameKeys({
      givenName: next.given_name,
      middleName: next.middle_name,
      familyName: next.family_name ?? survivor.family_name,
      nativeGivenName: next.native_given_name,
      nativeFamilyName: next.native_family_name,
    });
    survivorSet.search_name = keys.searchName;
    survivorSet.search_name_native = keys.searchNameNative;
  }
  if (survivor.legal_hold && snapSurvivor.legal_hold === false) survivorSet.legal_hold = false;
  await db(tx)
    .updateTable('guests.profiles')
    .set({ ...(survivorSet as Record<string, string | null>), version: sql`version + 1` })
    .where('id', '=', merge.survivor_id)
    .execute();
  for (const c of fieldPlan.conflicts)
    conflicts.push({ kind: 'field', ...c, note: 'Edited after the merge; newer value kept' });

  // 5. Restore the merged profile exactly from its snapshot.
  const mp = snap.merged.profile;
  await db(tx)
    .updateTable('guests.profiles')
    .set({
      status: 'active',
      merged_into: null,
      ...(Object.fromEntries(MERGEABLE_FIELDS.map((f) => [f, (mp[f] as string | null) ?? null])) as Record<
        string,
        string | null
      >),
      family_name: String(mp.family_name),
      search_name: String(mp.search_name),
      search_name_native: (mp.search_name_native as string | null) ?? null,
      tags: (mp.tags as string[]) ?? [],
      important_dates: JSON.stringify(mp.important_dates ?? []),
      legal_hold: mp.legal_hold === true,
      version: sql`version + 1`,
    })
    .where('id', '=', merge.merged_id)
    .execute();

  // 6. Re-link properties from stays (post-merge stays may have moved) and recompute document retention from
  //    each guest's own stays.
  for (const pid of [merge.survivor_id, merge.merged_id]) {
    await recomputeDocumentRetention(tx, ports, pid);
    await sql`insert into guests.profile_properties (tenant_id, profile_id, property_id, first_seen_at, source)
      select distinct ${tx.tenantId}::uuid, profile_id, property_id, ${tx.now}::timestamptz, 'stay'
      from guests.stay_history where profile_id = ${pid}
      on conflict do nothing`.execute(tx.db);
  }

  // 7. The pair is a known non-duplicate from now on.
  const [a, b] = orderedPair(merge.survivor_id, merge.merged_id);
  const subjects = await loadSubjects(tx, [a, b]);
  const sa = subjects.get(a);
  const sb = subjects.get(b);
  const score = sa && sb ? scoreMatch(sa, sb) : null;
  await db(tx)
    .insertInto('guests.duplicate_candidates')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      profile_a_id: a,
      profile_b_id: b,
      score: score?.score ?? 0,
      reasons: JSON.stringify(score?.reasons ?? []),
      exact_keys: hashExactKeys(ports, score?.exactKeys ?? []),
      status: 'dismissed',
      detected_by: 'unmerge',
      detected_at: tx.now,
      resolved_at: tx.now,
      resolved_by: actorKey(tx),
      resolution_reason: `Unmerged: ${input.reason}`,
      merge_id: merge.id,
    })
    .onConflict((oc) =>
      oc.columns(['profile_a_id', 'profile_b_id']).doUpdateSet({
        status: 'dismissed',
        resolved_at: tx.now,
        resolved_by: actorKey(tx),
        resolution_reason: `Unmerged: ${input.reason}`,
        exact_keys: hashExactKeys(ports, score?.exactKeys ?? []),
        version: sql`guests.duplicate_candidates.version + 1`,
      }),
    )
    .execute();

  // 8. Close the merge record.
  const refs = await db(tx)
    .selectFrom('guests.merge_reference_repoints')
    .select(['module', 'ref_type', 'ref_id', 'field'])
    .where('merge_id', '=', merge.id)
    .orderBy('recorded_at')
    .execute();
  const referencesToRestore: Record<string, Array<EntityRef & { field?: string | null }>> = {};
  for (const r of refs) {
    const list = referencesToRestore[r.module] ?? [];
    list.push({ type: r.ref_type, id: r.ref_id, field: r.field });
    referencesToRestore[r.module] = list;
  }
  const result = { restoredCounts, reassigned, reassignedRefs, conflicts };
  await db(tx)
    .updateTable('guests.merges')
    .set({
      status: 'reversed',
      reversed_at: tx.now,
      reversed_by: actorKey(tx),
      reverse_reason: input.reason,
      unmerge_result: JSON.stringify(result),
      version: sql`version + 1`,
    })
    .where('id', '=', merge.id)
    .execute();

  for (const target of [merge.survivor_id, merge.merged_id]) {
    await tx.audit({
      action: 'guests.profile.unmerge',
      target: { type: 'guest_profile', id: target },
      reason: input.reason,
      before:
        target === merge.merged_id
          ? { status: 'merged', mergedInto: merge.survivor_id }
          : { status: 'active' },
      after: { status: 'active' },
      metadata: { mergeId: merge.id, restoredCounts, reassigned, conflicts: conflicts.length },
    });
  }
  await tx.emit({
    type: 'guests.profile.unmerged',
    aggregate: { type: 'guest_profile', id: merge.merged_id },
    payload: {
      mergeId: merge.id,
      restoredId: merge.merged_id,
      survivorId: merge.survivor_id,
      referencesToRestore,
      reassigned: reassignedRefs,
    },
  });
  return { restoredId: merge.merged_id, survivorId: merge.survivor_id, reassigned, conflicts };
}
