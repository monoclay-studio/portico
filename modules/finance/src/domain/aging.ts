import { diffDays, type LocalDate } from '@portico/kernel';

export type AgingBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'over_90';
export const AGING_BUCKETS: readonly AgingBucket[] = ['current', 'd1_30', 'd31_60', 'd61_90', 'over_90'];

/** Bucket of an open item by days past its due date on `asOf` (not yet due or due today = current). */
export function agingBucket(dueDate: LocalDate, asOf: LocalDate): AgingBucket {
  const overdue = diffDays(dueDate, asOf);
  if (overdue <= 0) return 'current';
  if (overdue <= 30) return 'd1_30';
  if (overdue <= 60) return 'd31_60';
  if (overdue <= 90) return 'd61_90';
  return 'over_90';
}

export interface OpenItem {
  id: string;
  dueDate: LocalDate | null;
  businessDate: LocalDate;
  /** Signed amount: positive = owed by the account holder. */
  amountMinor: number;
  /** Amount of this item settled by allocations as of the report date (same sign convention, absolute). */
  allocatedMinor: number;
}

export interface AgingSummary {
  buckets: Record<AgingBucket, number>;
  /** Unallocated credits (payments/credit notes not yet matched to invoices) — shown separately. */
  unallocatedCredits: number;
  /** Total balance = Σ buckets − unallocated credits. */
  balance: number;
}

/**
 * Aging as of a date. Debit items (invoices) are bucketed by due date on their open (unallocated) amount.
 * Credit items (payments) not yet allocated reduce the balance but are reported as unallocated credit.
 */
export function ageItems(items: readonly OpenItem[], asOf: LocalDate): AgingSummary {
  const buckets: Record<AgingBucket, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, over_90: 0 };
  let unallocatedCredits = 0;
  for (const it of items) {
    if (it.businessDate > asOf) continue;
    if (it.amountMinor > 0) {
      const open = it.amountMinor - it.allocatedMinor;
      if (open === 0) continue;
      buckets[agingBucket(it.dueDate ?? it.businessDate, asOf)] += open;
    } else if (it.amountMinor < 0) {
      unallocatedCredits += -it.amountMinor - it.allocatedMinor;
    }
  }
  const total = AGING_BUCKETS.reduce((s, b) => s + buckets[b], 0);
  return { buckets, unallocatedCredits, balance: total - unallocatedCredits };
}
