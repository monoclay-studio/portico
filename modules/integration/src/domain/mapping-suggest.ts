/**
 * Mapping suggestion engine (adoption brief §7: "Suggest mappings for properties, rooms, rates, outlets, taxes,
 * accounts, and statuses. Require review for ambiguous or financially significant mappings.").
 *
 * Signals, strongest first: exact code, known alias (statuses), exact name, name similarity after expanding
 * common hospitality abbreviations, and structural hints (matching attributes such as max occupancy, the unit's
 * already-mapped unit type, currency). Every suggestion explains itself with reasons and lists alternatives.
 * Pure logic — no IO.
 */
import type { MappingKind } from '../contracts';
import {
  ABBREVIATIONS,
  FINANCIALLY_SIGNIFICANT_KINDS,
  MAPPING_KIND_LABELS,
  ONE_TO_ONE_KINDS,
  STATUS_VOCABULARIES,
  type StatusDomain,
} from './vocabulary';

export type AttributeValue = string | number | boolean | null;

export interface ExternalItem {
  kind: MappingKind;
  externalId: string;
  /** The code compared with Portico codes (defaults to externalId; e.g. "101" for unit "LGN-101"). */
  code?: string;
  label: string;
  attributes?: Record<string, AttributeValue>;
}

export interface InternalCandidate {
  id: string;
  code?: string | null;
  name: string;
  attributes?: Record<string, AttributeValue>;
  /** Alternative spellings (status vocabularies). */
  aliases?: readonly string[];
}

export interface SuggestionContext {
  /** Confirmed unit-type mappings (external unit type id → internal unit type id), for unit suggestions. */
  unitTypeMap?: ReadonlyMap<string, string>;
  /** Internal ids already taken by other confirmed mappings of a one-to-one kind (internal id → external id). */
  taken?: ReadonlyMap<string, string>;
}

export interface Reason {
  code: string;
  message: string;
}

export interface Suggestion {
  kind: MappingKind;
  externalId: string;
  internalId: string | null;
  internalLabel: string | null;
  confidence: number;
  reasons: Reason[];
  alternatives: Array<{ internalId: string; label: string; confidence: number }>;
  financiallySignificant: boolean;
  requiresReview: boolean;
  reviewReason: string | null;
  status: 'confirmed' | 'suggested' | 'unmapped';
  autoConfirmed: boolean;
}

export const AUTO_CONFIRM_THRESHOLD = 0.9;
export const MIN_SUGGESTION = 0.5;
export const AMBIGUITY_MARGIN = 0.05;

const STOP_WORDS = new Set(['the', 'a', 'an', 'with', 'and', 'of', 'w']);
/** Abbreviations that are also ordinary words: expanded only when written as an all-caps code ("BAR", not "Bar"). */
const AMBIGUOUS_ABBREVIATIONS = new Set([
  'bar',
  'rest',
  'sc',
  'gt',
  'sp',
  'pl',
  'sup',
  'ro',
  'ai',
  'tw',
  'bb',
  'hb',
  'fb',
  'rack',
  'corp',
  'mb',
]);

/** Lowercase, strip accents and punctuation, expand abbreviations, drop stop words. */
export function normalizeTokens(input: string): string[] {
  const base = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim();
  if (!base) return [];
  const out: string[] = [];
  for (const raw of base.split(' ')) {
    const token = raw.toLowerCase();
    const isCode = raw === raw.toUpperCase() && /[A-Z]/.test(raw);
    const expanded = AMBIGUOUS_ABBREVIATIONS.has(token) && !isCode ? undefined : ABBREVIATIONS[token];
    for (const t of (expanded ?? token).split(' ')) if (t && !STOP_WORDS.has(t)) out.push(t);
  }
  return out;
}

export function normalizeCode(code: string): string {
  return code
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice coefficient over character bigrams (0..1). */
export function diceSimilarity(a: string, b: string): number {
  if (a === b) return a.length > 0 ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

/** Name similarity on normalized tokens: average of bigram Dice and token-set Jaccard. */
export function nameSimilarity(a: string, b: string): number {
  const ta = normalizeTokens(a);
  const tb = normalizeTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const dice = diceSimilarity(ta.join(''), tb.join(''));
  const sa = new Set(ta);
  const sb = new Set(tb);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const jaccard = inter / (sa.size + sb.size - inter);
  return (dice + jaccard) / 2;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const pct = (n: number) => `${Math.round(n * 100)}%`;

interface Scored {
  candidate: InternalCandidate;
  score: number;
  reasons: Reason[];
}

const NUMERIC_HINTS = ['maxOccupancy', 'unitCount', 'beds', 'floor'] as const;

function scoreCandidate(ext: ExternalItem, cand: InternalCandidate, ctx: SuggestionContext): Scored {
  const reasons: Reason[] = [];
  let score = 0;
  const rawCode = ext.code ?? ext.externalId;
  const extCode = normalizeCode(rawCode);
  const candCode = cand.code ? normalizeCode(cand.code) : '';

  if (candCode && extCode && extCode === candCode) {
    score = 0.97;
    reasons.push({ code: 'code_exact', message: `Codes match exactly (${rawCode} = ${cand.code}).` });
  }

  if (cand.aliases && score < 0.95) {
    const extForms = new Set([extCode, normalizeCode(ext.label), ext.label.toLowerCase().trim()]);
    const hit = cand.aliases.find((a) => extForms.has(a) || extForms.has(normalizeCode(a)));
    if (hit || extForms.has(normalizeCode(cand.id)) || extForms.has(normalizeCode(cand.name))) {
      score = Math.max(score, 0.95);
      reasons.push({
        code: 'known_alias',
        message: `"${rawCode}" is a common way of writing "${cand.name}".`,
      });
    }
  }

  const extName = normalizeTokens(ext.label).join(' ');
  const candName = normalizeTokens(cand.name).join(' ');
  if (extName && extName === candName && score < 0.93) {
    score = Math.max(score, 0.93);
    reasons.push({ code: 'name_exact', message: `Names match ("${ext.label}" = "${cand.name}").` });
  } else if (score < 0.9) {
    const viaLabel = nameSimilarity(ext.label, cand.name);
    const viaCode = nameSimilarity(rawCode, cand.name);
    const sim = Math.max(viaLabel, viaCode);
    if (sim >= 0.35) {
      const s = 0.3 + 0.55 * sim;
      if (s > score) {
        score = s;
        reasons.push({
          code: viaCode > viaLabel ? 'abbreviation' : 'name_similar',
          message:
            viaCode > viaLabel
              ? `The code "${rawCode}" reads like "${cand.name}" (${pct(sim)} similar after expanding abbreviations).`
              : `Names are similar: "${ext.label}" and "${cand.name}" (${pct(sim)}).`,
        });
      }
    }
  }

  // Structural hints adjust an existing signal; they never create a match on their own.
  if (score > 0) {
    const ea = ext.attributes ?? {};
    const ca = cand.attributes ?? {};
    for (const key of NUMERIC_HINTS) {
      const ev = ea[key];
      const cv = ca[key];
      if (typeof ev === 'number' && typeof cv === 'number') {
        if (ev === cv) {
          score += 0.04;
          reasons.push({ code: 'attribute_match', message: `Both have ${key} ${ev}.` });
        } else {
          score -= 0.06;
          reasons.push({ code: 'attribute_differs', message: `${key} differs (${ev} vs ${cv}).` });
        }
      }
    }
    if (typeof ea.currency === 'string' && typeof ca.currency === 'string' && ea.currency !== ca.currency) {
      score -= 0.25;
      reasons.push({
        code: 'currency_differs',
        message: `Currencies differ (${ea.currency} vs ${ca.currency}).`,
      });
    }
    const extUnitType = ea.unitTypeExternalId;
    if (ext.kind === 'unit' && typeof extUnitType === 'string' && ctx.unitTypeMap) {
      const mappedType = ctx.unitTypeMap.get(extUnitType);
      if (mappedType && typeof ca.unitTypeId === 'string') {
        if (mappedType === ca.unitTypeId) {
          score += 0.08;
          reasons.push({
            code: 'same_unit_type',
            message: 'Its unit type is already mapped to this unit’s type.',
          });
        } else {
          score -= 0.3;
          reasons.push({
            code: 'different_unit_type',
            message: 'Its unit type is mapped to a different Portico unit type.',
          });
        }
      }
    }
  }
  return { candidate: cand, score: Math.max(0, Math.min(0.99, score)), reasons };
}

/** Suggest one mapping per external item. */
export function suggestMappings(
  externals: readonly ExternalItem[],
  candidates: readonly InternalCandidate[],
  ctx: SuggestionContext = {},
): Suggestion[] {
  const results = externals.map((ext) => suggestOne(ext, candidates, ctx));
  return applyOneToOne(results, externals);
}

function suggestOne(
  ext: ExternalItem,
  candidates: readonly InternalCandidate[],
  ctx: SuggestionContext,
): Suggestion {
  const financial = FINANCIALLY_SIGNIFICANT_KINDS.has(ext.kind);
  const kindLabel = MAPPING_KIND_LABELS[ext.kind];
  const scored = candidates
    .map((c) => scoreCandidate(ext, c, ctx))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name));
  const top = scored[0];
  const second = scored[1];
  const alternatives = scored
    .slice(1, 4)
    .map((s) => ({ internalId: s.candidate.id, label: s.candidate.name, confidence: round3(s.score) }));

  if (!top || top.score < MIN_SUGGESTION) {
    return {
      kind: ext.kind,
      externalId: ext.externalId,
      internalId: null,
      internalLabel: null,
      confidence: top ? round3(top.score) : 0,
      reasons: [
        {
          code: 'no_match',
          message:
            candidates.length === 0
              ? `Portico has no ${kindLabel} records to compare with yet.`
              : `No Portico ${kindLabel} looks like "${ext.label}". Choose one, or mark it as not used.`,
        },
      ],
      alternatives: scored
        .slice(0, 3)
        .map((s) => ({ internalId: s.candidate.id, label: s.candidate.name, confidence: round3(s.score) })),
      financiallySignificant: financial,
      requiresReview: true,
      reviewReason: 'No suggestion: a person must choose the matching record or mark it as not used.',
      status: 'unmapped',
      autoConfirmed: false,
    };
  }

  const reasons = [...top.reasons];
  let reviewReason: string | null = null;
  const takenBy = ctx.taken?.get(top.candidate.id);
  if (takenBy && takenBy !== ext.externalId && ONE_TO_ONE_KINDS.has(ext.kind)) {
    reasons.push({
      code: 'already_mapped',
      message: `"${top.candidate.name}" is already mapped to external ${kindLabel} "${takenBy}".`,
    });
    reviewReason = `"${top.candidate.name}" is already used by another mapping; confirm which external ${kindLabel} it belongs to.`;
  }
  const ambiguous = second !== undefined && top.score - second.score < AMBIGUITY_MARGIN;
  if (!reviewReason && ambiguous && second) {
    reviewReason = `Ambiguous: "${top.candidate.name}" (${pct(top.score)}) and "${second.candidate.name}" (${pct(second.score)}) look equally likely.`;
    reasons.push({ code: 'ambiguous', message: reviewReason });
  }
  if (!reviewReason && financial) {
    reviewReason = `Financially significant: a ${kindLabel} decides how money is posted, so a person must confirm it.`;
  }
  if (!reviewReason && top.score < AUTO_CONFIRM_THRESHOLD) {
    reviewReason = `Confidence ${pct(top.score)} is below ${pct(AUTO_CONFIRM_THRESHOLD)}; please check it.`;
  }
  const requiresReview = reviewReason !== null;
  return {
    kind: ext.kind,
    externalId: ext.externalId,
    internalId: top.candidate.id,
    internalLabel: top.candidate.name,
    confidence: round3(top.score),
    reasons,
    alternatives,
    financiallySignificant: financial,
    requiresReview,
    reviewReason,
    status: requiresReview ? 'suggested' : 'confirmed',
    autoConfirmed: !requiresReview,
  };
}

/** Two external records suggested onto the same Portico record (one-to-one kinds) both need review. */
function applyOneToOne(results: Suggestion[], externals: readonly ExternalItem[]): Suggestion[] {
  const byInternal = new Map<string, number[]>();
  results.forEach((r, i) => {
    if (!r.internalId || !ONE_TO_ONE_KINDS.has(r.kind)) return;
    const list = byInternal.get(r.internalId) ?? [];
    list.push(i);
    byInternal.set(r.internalId, list);
  });
  for (const [, idxs] of byInternal) {
    if (idxs.length < 2) continue;
    const names = idxs.map((i) => externals[i]?.externalId ?? '?').join(', ');
    for (const i of idxs) {
      const r = results[i];
      if (!r) continue;
      const message = `External records ${names} all point to "${r.internalLabel}"; each ${MAPPING_KIND_LABELS[r.kind]} needs its own match.`;
      r.reasons.push({ code: 'duplicate_target', message });
      r.requiresReview = true;
      r.reviewReason = message;
      r.status = 'suggested';
      r.autoConfirmed = false;
    }
  }
  return results;
}

/** Internal candidates for `status` mappings come from Portico's own vocabularies. */
export function statusCandidates(domain: StatusDomain): InternalCandidate[] {
  return STATUS_VOCABULARIES[domain].map((v) => ({
    id: v.value,
    code: v.value,
    name: v.label,
    aliases: v.aliases,
  }));
}
