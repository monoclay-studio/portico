/**
 * Duplicate detection (GUE-R10): exact keys + pg_trgm fuzzy pre-filter in SQL, scoring in the pure domain.
 */
import { sql, type TxContext } from '@portico/db';
import { BusinessRuleError, NotFoundError, newId, requirePermission } from '@portico/kernel';
import type { z } from 'zod';
import type { duplicateCandidateView } from '../contracts';
import {
  type MatchResult,
  type MatchSubject,
  orderedPair,
  QUEUE_THRESHOLD,
  scoreMatch,
  shouldReopenDismissed,
} from '../domain/duplicates';
import type { GuestsPorts } from '../ports';
import { actorKey, db, iso, requireVisibleProfile, resolveAccess, visibilitySql } from './internal';

export type DuplicateCandidate = z.infer<typeof duplicateCandidateView>;

/** Load match subjects (names, DOB, nationality, high-confidence contacts, document hashes) in one batch. */
export async function loadSubjects(
  tx: TxContext,
  ids: readonly string[],
): Promise<Map<string, MatchSubject>> {
  const out = new Map<string, MatchSubject>();
  if (ids.length === 0) return out;
  const profiles = await db(tx)
    .selectFrom('guests.profiles')
    .select(['id', 'search_name', 'search_name_native', 'date_of_birth', 'nationality'])
    .where('id', 'in', [...ids])
    .execute();
  for (const p of profiles) {
    out.set(p.id, {
      id: p.id,
      names: { searchName: p.search_name, searchNameNative: p.search_name_native },
      dateOfBirth: p.date_of_birth,
      nationality: p.nationality,
      emails: [],
      phones: [],
      documentHashes: [],
    });
  }
  const contacts = await db(tx)
    .selectFrom('guests.contact_points')
    .select(['profile_id', 'kind', 'normalized'])
    .where('profile_id', 'in', [...ids])
    .where('low_confidence', '=', false)
    .where('normalized', 'is not', null)
    .execute();
  for (const c of contacts) {
    const s = out.get(c.profile_id);
    if (!s || !c.normalized) continue;
    if (c.kind === 'email') (s.emails as string[]).push(c.normalized);
    else if (c.kind === 'phone' || c.kind === 'whatsapp') (s.phones as string[]).push(c.normalized);
  }
  const docs = await db(tx)
    .selectFrom('guests.identity_documents')
    .select(['profile_id', 'number_hash'])
    .where('profile_id', 'in', [...ids])
    .execute();
  for (const d of docs) (out.get(d.profile_id)?.documentHashes as string[] | undefined)?.push(d.number_hash);
  return out;
}

/** Candidate ids for a subject: exact contact/document keys or trigram-similar names (GIN-indexed). */
export async function candidateIds(tx: TxContext, s: MatchSubject, limit = 50): Promise<string[]> {
  const keys = [...s.emails, ...s.phones];
  const { rows } = await sql<{ id: string }>`
    select p.id from guests.profiles p
    where p.tenant_id = ${tx.tenantId} and p.status = 'active' and p.id <> ${s.id}
      and (
        p.id in (select c.profile_id from guests.contact_points c
                 where c.tenant_id = ${tx.tenantId} and not c.low_confidence and c.normalized = any(${keys}::text[]))
        or p.id in (select d.profile_id from guests.identity_documents d
                    where d.tenant_id = ${tx.tenantId} and d.number_hash = any(${[...s.documentHashes]}::text[]))
        or (${s.names.searchName} <> '' and p.search_name % ${s.names.searchName})
        or (${s.names.searchNameNative}::text is not null and p.search_name_native % ${s.names.searchNameNative})
      )
    limit ${limit}`.execute(tx.db);
  return rows.map((r) => r.id);
}

export interface ScoredCandidate extends MatchResult {
  profileId: string;
}

/** Score a subject against existing profiles (does not persist). */
export async function scoreAgainstExisting(tx: TxContext, subject: MatchSubject): Promise<ScoredCandidate[]> {
  const ids = await candidateIds(tx, subject);
  const subjects = await loadSubjects(tx, ids);
  const out: ScoredCandidate[] = [];
  for (const id of ids) {
    const other = subjects.get(id);
    if (!other) continue;
    const r = scoreMatch(subject, other);
    if (r.score > 0) out.push({ ...r, profileId: id });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Run detection for one profile and record queue-worthy pairs (GUE-R10). Dismissed pairs are re-opened only for a
 * new exact key; merged pairs are never re-proposed. Returns every scored candidate (for suggestions).
 */
export async function detectDuplicates(
  tx: TxContext,
  profileId: string,
  detectedBy: 'on_create' | 'on_update' | 'scan',
): Promise<ScoredCandidate[]> {
  const subject = (await loadSubjects(tx, [profileId])).get(profileId);
  if (!subject) return [];
  const scored = await scoreAgainstExisting(tx, subject);
  for (const c of scored) {
    if (c.score < QUEUE_THRESHOLD) continue;
    const [a, b] = orderedPair(profileId, c.profileId);
    const existing = await db(tx)
      .selectFrom('guests.duplicate_candidates')
      .selectAll()
      .where('profile_a_id', '=', a)
      .where('profile_b_id', '=', b)
      .forUpdate()
      .executeTakeFirst();
    if (!existing) {
      const id = newId(tx.now.getTime());
      await db(tx)
        .insertInto('guests.duplicate_candidates')
        .values({
          id,
          tenant_id: tx.tenantId,
          profile_a_id: a,
          profile_b_id: b,
          score: c.score,
          reasons: JSON.stringify(c.reasons),
          exact_keys: c.exactKeys,
          detected_by: detectedBy,
          detected_at: tx.now,
        })
        .execute();
      await tx.emit({
        type: 'guests.duplicate.detected',
        aggregate: { type: 'duplicate_candidate', id },
        payload: { candidateId: id, profileIds: [a, b], score: c.score },
      });
    } else if (existing.status === 'open') {
      await db(tx)
        .updateTable('guests.duplicate_candidates')
        .set({
          score: c.score,
          reasons: JSON.stringify(c.reasons),
          exact_keys: [...new Set([...existing.exact_keys, ...c.exactKeys])],
          version: sql`version + 1`,
        })
        .where('id', '=', existing.id)
        .execute();
    } else if (existing.status === 'dismissed' && shouldReopenDismissed(existing.exact_keys, c)) {
      await db(tx)
        .updateTable('guests.duplicate_candidates')
        .set({
          status: 'open',
          score: c.score,
          reasons: JSON.stringify(c.reasons),
          exact_keys: [...new Set([...existing.exact_keys, ...c.exactKeys])],
          resolved_at: null,
          resolved_by: null,
          resolution_reason: `Re-opened: new exact match (previously dismissed: ${existing.resolution_reason ?? ''})`,
          detected_by: detectedBy,
          detected_at: tx.now,
          version: sql`version + 1`,
        })
        .where('id', '=', existing.id)
        .execute();
    }
  }
  return scored;
}

function toCandidate(r: {
  id: string;
  profile_a_id: string;
  profile_b_id: string;
  score: string;
  reasons: unknown;
  status: 'open' | 'merged' | 'dismissed';
  detected_by: string;
  detected_at: Date;
  resolution_reason: string | null;
  merge_id: string | null;
  version: number;
}): DuplicateCandidate {
  return {
    id: r.id,
    profileAId: r.profile_a_id,
    profileBId: r.profile_b_id,
    score: Number(r.score),
    reasons: r.reasons as DuplicateCandidate['reasons'],
    status: r.status,
    detectedBy: r.detected_by,
    detectedAt: iso(r.detected_at) as string,
    resolutionReason: r.resolution_reason,
    mergeId: r.merge_id,
    version: r.version,
  };
}

/** Review queue — only pairs where the reviewer can see BOTH profiles in full. */
export async function listDuplicates(
  tx: TxContext,
  ports: GuestsPorts,
  opts: { status?: 'open' | 'merged' | 'dismissed'; limit?: number; propertyId?: string } = {},
): Promise<DuplicateCandidate[]> {
  requirePermission(
    tx,
    'guests.profile.merge',
    opts.propertyId ? { propertyId: opts.propertyId } : undefined,
  );
  const access = await resolveAccess(tx, ports, { propertyId: opts.propertyId ?? null });
  const fullOnly = { ...access, sharedViewing: false };
  const { rows } = await sql<Parameters<typeof toCandidate>[0]>`
    select d.* from guests.duplicate_candidates d
      join guests.profiles a on a.id = d.profile_a_id
      join guests.profiles b on b.id = d.profile_b_id
    where d.status = ${opts.status ?? 'open'}
      and ${visibilitySql(fullOnly, 'a')} and ${visibilitySql(fullOnly, 'b')}
    order by d.score desc, d.detected_at
    limit ${opts.limit ?? 50}`.execute(tx.db);
  return rows.map(toCandidate);
}

export async function dismissDuplicate(
  tx: TxContext,
  ports: GuestsPorts,
  candidateId: string,
  reason: string,
): Promise<DuplicateCandidate> {
  requirePermission(tx, 'guests.profile.merge');
  const existing = await db(tx)
    .selectFrom('guests.duplicate_candidates')
    .selectAll()
    .where('id', '=', candidateId)
    .forUpdate()
    .executeTakeFirst();
  if (!existing) throw new NotFoundError('duplicate_candidate', candidateId);
  // The reviewer must see both profiles in full (same rule as the queue).
  const access = await resolveAccess(tx, ports);
  const fullOnly = { ...access, sharedViewing: false };
  for (const id of [existing.profile_a_id, existing.profile_b_id]) {
    await requireVisibleProfile(tx, ports, id, { access: fullOnly }).catch(() => {
      throw new NotFoundError('duplicate_candidate', candidateId);
    });
  }
  if (existing.status !== 'open') {
    throw new BusinessRuleError(
      'duplicate_not_open',
      `This duplicate suggestion is already ${existing.status}. Refresh the queue.`,
      { status: existing.status },
    );
  }
  const row = await db(tx)
    .updateTable('guests.duplicate_candidates')
    .set({
      status: 'dismissed',
      resolved_at: tx.now,
      resolved_by: actorKey(tx),
      resolution_reason: reason,
      version: sql`version + 1`,
    })
    .where('id', '=', candidateId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'guests.duplicate.dismiss',
    target: { type: 'duplicate_candidate', id: candidateId },
    reason,
    metadata: { profileIds: [existing.profile_a_id, existing.profile_b_id], score: Number(existing.score) },
  });
  return toCandidate(row);
}

/**
 * Nightly / on-demand scan over all active profiles (GUE-R10 "and nightly"). Bounded per call; returns the
 * cursor to continue from. Scheduling it is the worker's job (not wired in wave 1).
 */
export async function scanDuplicates(
  tx: TxContext,
  opts: { afterId?: string; batch?: number } = {},
): Promise<{ scanned: number; nextAfterId: string | null }> {
  requirePermission(tx, 'guests.profile.merge');
  let q = db(tx)
    .selectFrom('guests.profiles')
    .select('id')
    .where('status', '=', 'active')
    .orderBy('id')
    .limit(opts.batch ?? 200);
  if (opts.afterId) q = q.where('id', '>', opts.afterId);
  const ids = (await q.execute()).map((r) => r.id);
  for (const id of ids) await detectDuplicates(tx, id, 'scan');
  return {
    scanned: ids.length,
    nextAfterId: ids.length === (opts.batch ?? 200) ? (ids.at(-1) ?? null) : null,
  };
}
