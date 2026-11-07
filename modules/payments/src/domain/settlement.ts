/**
 * Settlement / statement reconciliation for RECORDED payments (Route D: the hotel's own terminal or gateway,
 * cash deposits and bank transfers). Pure matching: given what staff recorded in Portico and what the
 * acquirer / bank statement says, decide which records are verified and which mismatches need an owner.
 *
 * Matching order (most specific first):
 *  1. reference / approval code (normalized) + currency, then amount must agree;
 *  2. otherwise amount + currency + card last 4 (if both present) + date within ±1 day, only if unique.
 * A record is matched at most once; already-verified records are never matched again.
 */
import { addDays, formatMoney, type LocalDate, money } from '@portico/kernel';
import { withinPeriod } from './schedule';

export interface RecordedItem {
  id: string;
  kind: 'payment' | 'refund';
  currency: string;
  /** Positive for payments, negative for refunds (statement sign convention). */
  amountMinor: number;
  reference: string | null;
  cardLast4: string | null;
  day: LocalDate; // property-local date the money moved
  alreadyVerified: boolean;
  /** Expected but not yet due (e.g. a bank transfer awaiting receipt): never reported as missing. */
  optional?: boolean;
}

export interface StatementLineInput {
  lineNo: number;
  day: LocalDate;
  currency: string;
  amountMinor: number;
  reference: string | null;
  approvalCode: string | null;
  cardLast4: string | null;
}

export type LineMatchStatus = 'matched' | 'unmatched' | 'amount_mismatch' | 'duplicate' | 'ambiguous';

export interface LineMatch {
  lineNo: number;
  status: LineMatchStatus;
  basis: 'reference' | 'amount_date' | null;
  itemId: string | null;
  itemKind: 'payment' | 'refund' | null;
  /** For amount mismatches: recorded − statement (minor units). */
  differenceMinor?: number;
}

export type SettlementIssueKind =
  | 'amount_mismatch'
  | 'missing_in_statement'
  | 'unrecorded_in_portico'
  | 'duplicate_in_statement'
  | 'duplicate_recorded'
  | 'ambiguous_match';

export interface SettlementIssue {
  kind: SettlementIssueKind;
  lineNo?: number;
  itemId?: string;
  itemKind?: 'payment' | 'refund';
  detail: string;
}

export interface SettlementResult {
  lines: LineMatch[];
  verifiedItemIds: string[];
  issues: SettlementIssue[];
}

export function normalizeReference(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const n = ref.replace(/[\s-]/g, '').toUpperCase();
  return n.length > 0 ? n : null;
}

function lineRefs(line: StatementLineInput): string[] {
  return [normalizeReference(line.reference), normalizeReference(line.approvalCode)].filter(
    (r): r is string => r !== null,
  );
}

export function matchSettlement(input: {
  items: readonly RecordedItem[];
  lines: readonly StatementLineInput[];
  period: { from: LocalDate; to: LocalDate };
}): SettlementResult {
  const issues: SettlementIssue[] = [];
  const results: LineMatch[] = [];
  const usedItems = new Set<string>();
  const verified: string[] = [];

  // Index recorded items by normalized reference; several items with one reference = duplicate recording.
  const byRef = new Map<string, RecordedItem[]>();
  for (const it of input.items) {
    const r = normalizeReference(it.reference);
    if (!r) continue;
    const list = byRef.get(r) ?? [];
    list.push(it);
    byRef.set(r, list);
  }
  for (const [ref, all] of byRef) {
    for (const kind of ['payment', 'refund'] as const) {
      const list = all.filter((i) => i.kind === kind);
      const open = list.filter((i) => !i.alreadyVerified);
      if (list.length > 1 && open.length > 0) {
        for (const it of open.slice(list.length - open.length === 0 ? 1 : 0)) {
          issues.push({
            kind: 'duplicate_recorded',
            itemId: it.id,
            itemKind: it.kind,
            detail: `Reference ${ref} was recorded ${list.length} times in Portico as a ${kind}.`,
          });
        }
      }
    }
  }

  // Duplicate lines inside the statement.
  const seenLineRefs = new Map<string, number>();

  for (const line of input.lines) {
    const refs = lineRefs(line);
    const dupOf = refs.map((r) => seenLineRefs.get(r)).find((n) => n !== undefined);
    for (const r of refs) if (!seenLineRefs.has(r)) seenLineRefs.set(r, line.lineNo);
    if (dupOf !== undefined) {
      results.push({ lineNo: line.lineNo, status: 'duplicate', basis: null, itemId: null, itemKind: null });
      issues.push({
        kind: 'duplicate_in_statement',
        lineNo: line.lineNo,
        detail: `Line ${line.lineNo} repeats the reference of line ${dupOf}.`,
      });
      continue;
    }

    // 1. Reference match.
    let refCandidates: RecordedItem[] = [];
    for (const r of refs) refCandidates = refCandidates.concat(byRef.get(r) ?? []);
    refCandidates = [...new Map(refCandidates.map((c) => [c.id, c])).values()].filter(
      (c) => c.currency === line.currency && Math.sign(c.amountMinor) === Math.sign(line.amountMinor),
    );
    if (refCandidates.length > 0) {
      if (refCandidates.every((c) => c.alreadyVerified)) {
        results.push({
          lineNo: line.lineNo,
          status: 'duplicate',
          basis: 'reference',
          itemId: null,
          itemKind: null,
        });
        issues.push({
          kind: 'duplicate_in_statement',
          lineNo: line.lineNo,
          detail: `Line ${line.lineNo} matches a record already verified by an earlier statement.`,
        });
        continue;
      }
      const open = refCandidates.filter((c) => !c.alreadyVerified && !usedItems.has(c.id));
      const exact = open.find((c) => c.amountMinor === line.amountMinor);
      if (exact) {
        usedItems.add(exact.id);
        verified.push(exact.id);
        results.push({
          lineNo: line.lineNo,
          status: 'matched',
          basis: 'reference',
          itemId: exact.id,
          itemKind: exact.kind,
        });
        continue;
      }
      const first = open[0];
      if (first) {
        usedItems.add(first.id);
        const diff = first.amountMinor - line.amountMinor;
        results.push({
          lineNo: line.lineNo,
          status: 'amount_mismatch',
          basis: 'reference',
          itemId: first.id,
          itemKind: first.kind,
          differenceMinor: diff,
        });
        issues.push({
          kind: 'amount_mismatch',
          lineNo: line.lineNo,
          itemId: first.id,
          itemKind: first.kind,
          detail: `Recorded ${formatMoney(money(first.amountMinor, line.currency))} but the statement shows ${formatMoney(money(line.amountMinor, line.currency))} for the same reference.`,
        });
        continue;
      }
    }

    // 2. Amount + date (+ last 4) fallback.
    const fallback = input.items.filter(
      (c) =>
        !c.alreadyVerified &&
        !usedItems.has(c.id) &&
        c.currency === line.currency &&
        c.amountMinor === line.amountMinor &&
        c.day >= addDays(line.day, -1) &&
        c.day <= addDays(line.day, 1) &&
        (!line.cardLast4 || !c.cardLast4 || c.cardLast4 === line.cardLast4) &&
        // Never use the fallback for items whose reference contradicts the line's reference.
        (refs.length === 0 || !normalizeReference(c.reference)),
    );
    if (fallback.length === 1) {
      const only = fallback[0] as RecordedItem;
      usedItems.add(only.id);
      verified.push(only.id);
      results.push({
        lineNo: line.lineNo,
        status: 'matched',
        basis: 'amount_date',
        itemId: only.id,
        itemKind: only.kind,
      });
      continue;
    }
    if (fallback.length > 1) {
      results.push({ lineNo: line.lineNo, status: 'ambiguous', basis: null, itemId: null, itemKind: null });
      issues.push({
        kind: 'ambiguous_match',
        lineNo: line.lineNo,
        detail: `Line ${line.lineNo} could match ${fallback.length} recorded items with the same amount and date; match it manually.`,
      });
      continue;
    }
    results.push({ lineNo: line.lineNo, status: 'unmatched', basis: null, itemId: null, itemKind: null });
    issues.push({
      kind: 'unrecorded_in_portico',
      lineNo: line.lineNo,
      detail: `Line ${line.lineNo} (${line.amountMinor} ${line.currency}, ${line.day}) has no matching record in Portico.`,
    });
  }

  // Recorded items in the statement period that the statement does not contain.
  for (const it of input.items) {
    if (it.alreadyVerified || it.optional || usedItems.has(it.id)) continue;
    if (!withinPeriod(it.day, input.period.from, input.period.to)) continue;
    issues.push({
      kind: 'missing_in_statement',
      itemId: it.id,
      itemKind: it.kind,
      detail: `Recorded on ${it.day} but not found in the statement for ${input.period.from}–${input.period.to}.`,
    });
  }

  return { lines: results, verifiedItemIds: verified, issues };
}
