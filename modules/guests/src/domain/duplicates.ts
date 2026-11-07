/**
 * Duplicate scoring (spec GUE-R10). Exact keys (high-confidence email, E.164 phone, identity-document hash) and
 * fuzzy evidence (name similarity across scripts, date of birth, nationality) combine into a score in [0, 1]
 * with human-readable reasons. Never decides a merge — it only ranks candidates for staff review.
 *
 * Design choices (precision over recall — a wrong merge is worse than a missed one):
 *  - a shared email/phone with a clearly different name is a family member or assistant, not a duplicate;
 *  - two people with the same common name and DIFFERENT dates of birth are different people;
 *  - matching name alone is only "possible" and never enough for the review queue without corroboration,
 *    except for an exact (score 1.0) name match where neither record has a conflicting attribute.
 */
import { type NameKeys, nameSimilarity } from './names';

export interface MatchSubject {
  id: string;
  names: NameKeys;
  dateOfBirth: string | null;
  nationality: string | null;
  /** High-confidence normalized emails (never proxy emails). */
  emails: readonly string[];
  /** E.164 phones. */
  phones: readonly string[];
  /** Keyed hashes of identity-document number + issuing country. */
  documentHashes: readonly string[];
}

export type MatchReasonCode =
  | 'document_exact'
  | 'email_exact'
  | 'phone_exact'
  | 'name_exact'
  | 'name_similar'
  | 'name_different'
  | 'dob_match'
  | 'dob_conflict'
  | 'nationality_match'
  | 'nationality_conflict';

export interface MatchReason {
  code: MatchReasonCode;
  /** Plain-language explanation for the review queue (no personal values). */
  detail: string;
}

export interface MatchResult {
  score: number;
  band: 'high' | 'medium' | 'low' | 'none';
  reasons: MatchReason[];
  /** Exact keys that matched (by kind) — used to re-open dismissed pairs only when a NEW exact key appears. */
  exactKeys: string[];
  nameSimilarity: number;
}

/** Candidates at or above this score enter the review queue. */
export const QUEUE_THRESHOLD = 0.6;
export const HIGH_THRESHOLD = 0.85;

const intersect = (a: readonly string[], b: readonly string[]) => a.filter((x) => b.includes(x));
const round2 = (n: number) => Math.round(n * 100) / 100;

export function scoreMatch(a: MatchSubject, b: MatchSubject): MatchResult {
  const reasons: MatchReason[] = [];
  const exactKeys: string[] = [];
  const sim = nameSimilarity(a.names, b.names);

  const docs = intersect(a.documentHashes, b.documentHashes);
  const emails = intersect(a.emails, b.emails);
  const phones = intersect(a.phones, b.phones);
  for (const d of docs) exactKeys.push(`document:${d}`);
  for (const e of emails) exactKeys.push(`email:${e}`);
  for (const p of phones) exactKeys.push(`phone:${p}`);
  if (docs.length)
    reasons.push({ code: 'document_exact', detail: 'Same identity document number and country' });
  if (emails.length) reasons.push({ code: 'email_exact', detail: 'Same email address' });
  if (phones.length) reasons.push({ code: 'phone_exact', detail: 'Same phone number (E.164)' });

  if (sim >= 0.999) reasons.push({ code: 'name_exact', detail: 'Same name' });
  else if (sim >= 0.5)
    reasons.push({ code: 'name_similar', detail: `Similar name (similarity ${round2(sim).toFixed(2)})` });
  else reasons.push({ code: 'name_different', detail: 'Names differ' });

  let dob = 0;
  if (a.dateOfBirth && b.dateOfBirth) {
    if (a.dateOfBirth === b.dateOfBirth) {
      dob = 1;
      reasons.push({ code: 'dob_match', detail: 'Same date of birth' });
    } else {
      dob = -1;
      reasons.push({ code: 'dob_conflict', detail: 'Different dates of birth' });
    }
  }
  let nat = 0;
  if (a.nationality && b.nationality) {
    if (a.nationality === b.nationality) {
      nat = 1;
      reasons.push({ code: 'nationality_match', detail: 'Same nationality' });
    } else {
      nat = -1;
      reasons.push({ code: 'nationality_conflict', detail: 'Different nationalities' });
    }
  }

  let score: number;
  if (docs.length) {
    // Same passport: the same person unless the name is completely different (data-entry error).
    score = sim >= 0.3 ? 0.97 : 0.7;
  } else if (emails.length || phones.length) {
    const key = emails.length && phones.length ? 0.6 : 0.5;
    if (sim < 0.4) {
      // Shared family / assistant contact: show as low evidence only.
      score = 0.3;
    } else {
      score = key + 0.35 * sim;
      if (dob === 1) score += 0.1;
      if (nat === 1) score += 0.03;
    }
    if (dob === -1) score = Math.min(score, 0.45);
  } else {
    // Fuzzy only.
    if (sim < 0.5) score = 0;
    else {
      score = sim >= 0.999 ? 0.5 : sim >= 0.8 ? 0.42 : sim >= 0.65 ? 0.3 : 0.15;
      if (dob === 1) score += 0.38;
      if (nat === 1) score += 0.1;
      if (nat === -1) score -= 0.15;
      if (dob === -1) score = Math.min(score, 0.2);
      // An exact name with no conflicting attribute and some corroboration reaches the queue.
      if (sim >= 0.999 && dob === 0 && nat === 1) score = Math.max(score, QUEUE_THRESHOLD);
    }
  }
  score = round2(Math.max(0, Math.min(1, score)));
  const band =
    score >= HIGH_THRESHOLD ? 'high' : score >= QUEUE_THRESHOLD ? 'medium' : score > 0 ? 'low' : 'none';
  return { score, band, reasons, exactKeys, nameSimilarity: round2(sim) };
}

/** Canonical pair ordering so a pair is stored once regardless of which side triggered detection. */
export function orderedPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

/**
 * A dismissed pair is proposed again only when an exact key matches that was not known at dismissal
 * (spec §4: "dismissed pairs are not re-proposed unless a new exact key matches").
 */
export function shouldReopenDismissed(knownExactKeys: readonly string[], result: MatchResult): boolean {
  return result.exactKeys.some((k) => !knownExactKeys.includes(k)) && result.score >= QUEUE_THRESHOLD;
}

/**
 * Exact-only resolution (channel / import ingestion, spec GUE-R09): reuse an existing profile only when an exact
 * key matches AND the name is compatible AND nothing conflicts. Returns false for family members sharing a contact.
 */
export function isSafeExactReuse(result: MatchResult): boolean {
  if (result.exactKeys.length === 0) return false;
  if (result.nameSimilarity < 0.75) return false;
  return !result.reasons.some((r) => r.code === 'dob_conflict');
}
