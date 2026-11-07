import type { LocalDate } from '@portico/kernel';
import type { ChargeGroup } from './types';

export type UnusedPolicy = 'forfeit' | 'carry_forward' | 'credit_back';

export interface AllowanceState {
  id: string;
  grantedMinor: number;
  usedMinor: number;
  coversTaxes: boolean;
  validFrom: LocalDate;
  validTo: LocalDate;
  eligibleChargeCodes: readonly string[];
  eligibleGroups: readonly string[];
  eligibleTags: readonly string[];
  status: 'active' | 'consumed' | 'closed' | 'cancelled';
}

/** Whether a charge may consume the allowance (empty eligibility lists = any charge). */
export function isEligible(
  a: AllowanceState,
  charge: { chargeCode: string; chargeGroup: ChargeGroup; tags: readonly string[]; serviceDate: LocalDate },
): boolean {
  if (a.status !== 'active') return false;
  if (charge.serviceDate < a.validFrom || charge.serviceDate >= a.validTo) return false;
  const any = a.eligibleChargeCodes.length === 0 && a.eligibleGroups.length === 0 && a.eligibleTags.length === 0;
  if (any) return true;
  return (
    a.eligibleChargeCodes.includes(charge.chargeCode) ||
    a.eligibleGroups.includes(charge.chargeGroup) ||
    charge.tags.some((t) => a.eligibleTags.includes(t))
  );
}

/** Usage credit for a (positive) charge: min(eligible amount, remaining). Overuse stays payable by the guest. */
export function usageFor(a: AllowanceState, charge: { netMinor: number; grossMinor: number }): number {
  const eligible = a.coversTaxes ? charge.grossMinor : charge.netMinor;
  if (eligible <= 0) return 0;
  return Math.max(0, Math.min(eligible, a.grantedMinor - a.usedMinor));
}

export type CloseOutcome =
  | { kind: 'none' }
  | { kind: 'forfeit'; amountMinor: number }
  | { kind: 'carry_forward'; amountMinor: number }
  | { kind: 'credit_back'; amountMinor: number };

/**
 * Unused-remainder policy hook at period end. Invariant (FIN-I11): breakage + carried + credited = granted − used.
 * `carry_forward` without a following period falls back to `fallback` (default forfeit).
 */
export function closeOutcome(
  a: Pick<AllowanceState, 'grantedMinor' | 'usedMinor'>,
  policy: UnusedPolicy,
  hasNextPeriod: boolean,
  fallback: Exclude<UnusedPolicy, 'carry_forward'> = 'forfeit',
): CloseOutcome {
  const remaining = a.grantedMinor - a.usedMinor;
  if (remaining <= 0) return { kind: 'none' };
  const effective = policy === 'carry_forward' && !hasNextPeriod ? fallback : policy;
  return { kind: effective, amountMinor: remaining };
}
