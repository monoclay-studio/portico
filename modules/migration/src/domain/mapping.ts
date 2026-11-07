/**
 * Mapping suggestions for the migration plan (INT-R10/R11 rules, applied to migration): unit types are created from
 * the source definition or mapped to an existing Portico unit type; rate plans are only ever SUGGESTED (agreed
 * prices of migrated bookings come from the source; Portico never invents prices); tax codes on deposits map to
 * finance tax accounts and always need a finance review; unknown status words and ambiguous date orders need a
 * decision. Every suggestion carries a confidence and the reasons for it.
 */
import { canonicalJson, sha256Hex } from '@portico/kernel';
import type { DateOrder } from './normalize';
import type { BookingStatus, DataClass } from './records';

export const REVIEW_THRESHOLD = 0.9;

export interface Candidate {
  id: string;
  code: string;
  name: string;
}

export interface UnitTypeDecision {
  sourceCode: string;
  sourceName: string;
  action: 'create' | 'map';
  /** Code of the Portico unit type (existing when mapped, to be created when `create`). */
  targetCode: string;
  targetId: string | null;
  confidence: number;
  reasons: string[];
  reviewedBy: string | null;
}

export interface RatePlanDecision {
  sourceCode: string;
  sourceName: string;
  action: 'map' | 'not_in_portico';
  targetCode: string | null;
  targetId: string | null;
  confidence: number;
  reasons: string[];
  reviewedBy: string | null;
}

export interface StatusDecision {
  sourceWord: string;
  status: BookingStatus | null;
  reviewedBy: string | null;
}

export interface TaxAccountDecision {
  sourceCode: string;
  /** Finance tax account key (e.g. 'tgst'). Financially significant: always needs a finance review. */
  accountKey: string | null;
  confidence: number;
  reviewedBy: string | null;
}

export interface MigrationPlan {
  scope: DataClass[];
  defaultCurrency: string;
  unitTypes: UnitTypeDecision[];
  ratePlans: RatePlanDecision[];
  statuses: StatusDecision[];
  taxAccounts: TaxAccountDecision[];
  dateOrder: DateOrder | null;
  dateOrderReviewedBy: string | null;
  ambiguousDateColumns: string[];
}

export const emptyPlan = (defaultCurrency: string, scope: DataClass[]): MigrationPlan => ({
  scope,
  defaultCurrency,
  unitTypes: [],
  ratePlans: [],
  statuses: [],
  taxAccounts: [],
  dateOrder: null,
  dateOrderReviewedBy: null,
  ambiguousDateColumns: [],
});

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(norm(a).split(' ').filter(Boolean));
  const tb = new Set(norm(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  const inter = [...ta].filter((t) => tb.has(t)).length;
  return inter / (ta.size + tb.size - inter);
}

/** Best existing candidate for a source code/name, with confidence and reasons. */
export function bestMatch(
  source: { code: string; name: string },
  candidates: readonly Candidate[],
): { candidate: Candidate; confidence: number; reasons: string[] } | null {
  let best: { candidate: Candidate; confidence: number; reasons: string[] } | null = null;
  for (const c of candidates) {
    let confidence = 0;
    const reasons: string[] = [];
    if (c.code.toUpperCase() === source.code.toUpperCase()) {
      confidence = 0.95;
      reasons.push(`Same code (${c.code})`);
      if (norm(c.name) === norm(source.name)) {
        confidence = 1;
        reasons.push('Same name');
      }
    } else if (norm(c.name) === norm(source.name)) {
      confidence = 0.9;
      reasons.push(`Same name ("${c.name}")`);
    } else {
      const sim = tokenSimilarity(c.name, source.name);
      if (sim >= 0.5) {
        confidence = Math.round(sim * 0.8 * 100) / 100;
        reasons.push(`Similar name ("${c.name}", ${Math.round(sim * 100)}% of words in common)`);
      }
    }
    if (confidence > 0 && (!best || confidence > best.confidence))
      best = { candidate: c, confidence, reasons };
  }
  return best;
}

/** A valid Portico unit-type code from a source code or name ("Garden View" → GARDEN-VIEW; 1–20 chars). */
export function toUnitTypeCode(source: string): string {
  const c = source
    .toUpperCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
  return /^[A-Z0-9]/.test(c) ? c : `T${c}`.slice(0, 20);
}

/** Suggest unit-type decisions: map to an existing unit type when one matches, otherwise create from the source. */
export function suggestUnitTypes(
  source: ReadonlyArray<{ code: string; name: string }>,
  existing: readonly Candidate[],
  previous: readonly UnitTypeDecision[] = [],
): UnitTypeDecision[] {
  return source.map((s) => {
    const kept = previous.find((p) => p.sourceCode === s.code && p.reviewedBy);
    if (kept) return kept;
    const m = bestMatch(s, existing);
    if (m && m.confidence >= 0.5)
      return {
        sourceCode: s.code,
        sourceName: s.name,
        action: 'map',
        targetCode: m.candidate.code,
        targetId: m.candidate.id,
        confidence: m.confidence,
        reasons: m.reasons,
        reviewedBy: null,
      };
    const code = toUnitTypeCode(s.code);
    const taken = existing.some((c) => c.code.toUpperCase() === code);
    return {
      sourceCode: s.code,
      sourceName: s.name,
      action: 'create',
      targetCode: code,
      targetId: null,
      confidence: taken ? 0.5 : 1,
      reasons: [
        taken
          ? `Portico already has a different unit type with code ${code}: confirm before creating`
          : `No Portico unit type matches: ${code} is created from the source definition`,
      ],
      reviewedBy: null,
    };
  });
}

/** Rate plans are suggestions only: matched to an existing plan, or "not in Portico" (prices are never invented). */
export function suggestRatePlans(
  source: ReadonlyArray<{ code: string; name: string }>,
  existing: readonly Candidate[],
  previous: readonly RatePlanDecision[] = [],
): RatePlanDecision[] {
  return source.map((s) => {
    const kept = previous.find((p) => p.sourceCode === s.code && p.reviewedBy);
    if (kept) return kept;
    const m = bestMatch(s, existing);
    if (m && m.confidence >= 0.5)
      return {
        sourceCode: s.code,
        sourceName: s.name,
        action: 'map',
        targetCode: m.candidate.code,
        targetId: m.candidate.id,
        confidence: m.confidence,
        reasons: m.reasons,
        reviewedBy: null,
      };
    return {
      sourceCode: s.code,
      sourceName: s.name,
      action: 'not_in_portico',
      targetCode: null,
      targetId: null,
      confidence: 1,
      reasons: [
        'No Portico rate plan matches. Migrated bookings keep the source code and their agreed prices; create the plan in Rates for new bookings (no prices are copied or invented).',
      ],
      reviewedBy: null,
    };
  });
}

const TAX_GUESS: Record<string, string> = {
  TGST: 'tgst',
  GST: 'gst',
  GREEN: 'green_tax',
  SVC: 'service_charge',
};

export function suggestTaxAccounts(
  codes: readonly string[],
  accounts: readonly string[],
  previous: readonly TaxAccountDecision[] = [],
): TaxAccountDecision[] {
  return [...new Set(codes)].map((code) => {
    const kept = previous.find((p) => p.sourceCode === code && p.reviewedBy);
    if (kept) return kept;
    const guess = TAX_GUESS[code.toUpperCase()] ?? code.toLowerCase();
    const found = accounts.includes(guess) ? guess : null;
    return { sourceCode: code, accountKey: found, confidence: found ? 0.9 : 0, reviewedBy: null };
  });
}

export interface PlanReviewItem {
  kind: 'unitType' | 'ratePlan' | 'status' | 'taxAccount' | 'dateOrder';
  ref: string;
  reason: string;
  /** Financially significant: only a finance reviewer may decide it (INT-R11). */
  financial: boolean;
}

/** Decisions that still need a person before import (low confidence, unknown, financial). */
export function pendingReview(plan: MigrationPlan): PlanReviewItem[] {
  const out: PlanReviewItem[] = [];
  for (const u of plan.unitTypes)
    if (!u.reviewedBy && u.confidence < REVIEW_THRESHOLD)
      out.push({ kind: 'unitType', ref: u.sourceCode, reason: u.reasons.join('; '), financial: false });
  for (const r of plan.ratePlans)
    if (!r.reviewedBy && r.confidence < REVIEW_THRESHOLD)
      out.push({ kind: 'ratePlan', ref: r.sourceCode, reason: r.reasons.join('; '), financial: false });
  for (const s of plan.statuses)
    if (!s.status)
      out.push({
        kind: 'status',
        ref: s.sourceWord,
        reason: `The source status "${s.sourceWord}" is not known. Choose the Portico status it means.`,
        financial: false,
      });
  for (const t of plan.taxAccounts)
    if (!t.reviewedBy)
      out.push({
        kind: 'taxAccount',
        ref: t.sourceCode,
        reason: `Tax ${t.sourceCode} declared by the previous system must be mapped to a finance tax account by finance.`,
        financial: true,
      });
  if (plan.ambiguousDateColumns.length > 0 && !plan.dateOrderReviewedBy)
    out.push({
      kind: 'dateOrder',
      ref: plan.ambiguousDateColumns.join(', '),
      reason: 'Numeric dates in these columns could be day/month or month/day. Confirm the order.',
      financial: false,
    });
  return out;
}

/**
 * Fingerprint of the decisions (property-independent: target CODES, not ids), so a rehearsal in a trial
 * organization and the production cutover can be proven to run the same plan.
 */
export function planFingerprint(plan: MigrationPlan): string {
  return sha256Hex(
    canonicalJson({
      scope: [...plan.scope].sort(),
      currency: plan.defaultCurrency,
      unitTypes: plan.unitTypes.map((u) => [u.sourceCode, u.action, u.targetCode]).sort(),
      ratePlans: plan.ratePlans.map((r) => [r.sourceCode, r.action, r.targetCode]).sort(),
      statuses: plan.statuses.map((s) => [s.sourceWord, s.status]).sort(),
      taxAccounts: plan.taxAccounts.map((t) => [t.sourceCode, t.accountKey]).sort(),
      dateOrder: plan.dateOrder,
    }),
  ).slice(0, 32);
}
