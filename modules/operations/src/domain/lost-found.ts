import { addDays, BusinessRuleError, type LocalDate } from '@portico/kernel';
import { label } from './conditions';
import type { LostFoundStatus } from './model';

const TRANSITIONS: Record<LostFoundStatus, readonly LostFoundStatus[]> = {
  stored: ['matched', 'released', 'disposed'],
  matched: ['stored', 'released', 'disposed'],
  released: [],
  disposed: [],
};

export function assertLostFoundTransition(from: LostFoundStatus, to: LostFoundStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new BusinessRuleError(
      'invalid_lost_found_transition',
      TRANSITIONS[from].length
        ? `An item that is ${label(from)} cannot become ${label(to)}.`
        : `This item was already ${label(from)}; its record is final.`,
      { from, to },
    );
  }
}

export function retentionUntil(
  foundOn: LocalDate,
  highValue: boolean,
  policy: { retentionDays: number; highValueRetentionDays: number },
): LocalDate {
  return addDays(foundOn, highValue ? policy.highValueRetentionDays : policy.retentionDays);
}

/** Disposing of an item before its retention period ends needs an explicit reason (recorded in audit). */
export function assertDisposalAllowed(
  today: LocalDate,
  retention: LocalDate,
  reason: string | null | undefined,
): void {
  if (today < retention && !reason?.trim()) {
    throw new BusinessRuleError(
      'retention_period_active',
      `This item must be kept until ${retention}. To dispose of it earlier, give a reason (e.g. perishable, hazardous).`,
      { retentionUntil: retention },
    );
  }
}
