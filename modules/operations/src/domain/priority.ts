import type { TaskKind, TaskPriority } from './model';

/**
 * Housekeeping priority: which unit to clean first. Explainable — every point comes with a reason code that the
 * board and the mobile app show ("Arrival due soon · VIP · Early check-in").
 */
export type PriorityReason =
  | 'guest_waiting'
  | 'arrival_due_soon'
  | 'early_check_in'
  | 'arrival_today'
  | 'vip'
  | 'guest_departed'
  | 'failed_inspection';

export interface ArrivalContext {
  /** Expected arrival time at the unit (ETA, or the property's check-in time on the arrival date). */
  expectedAt: Date | null;
  vip: boolean;
  earlyCheckIn: boolean;
  /** The arrival is on the service date being planned. */
  today: boolean;
  guestWaiting?: boolean;
}

export interface PriorityInput {
  kind: TaskKind;
  now: Date;
  arrival: ArrivalContext | null;
  /** For departure cleans: the guest has checked out (unit can be cleaned now). */
  departed?: boolean;
  arrivalSoonMinutes: number;
}

export interface PriorityResult {
  priority: TaskPriority;
  score: number;
  reasons: PriorityReason[];
}

const BASE: Partial<Record<TaskKind, number>> = {
  reclean: 30,
  departure_clean: 15,
  vacant_clean: 10,
  inspection: 15,
  stayover: 8,
  turndown: 4,
  deep_clean: 4,
};

export function bucket(score: number): TaskPriority {
  if (score >= 80) return 'urgent';
  if (score >= 50) return 'high';
  if (score >= 15) return 'normal';
  return 'low';
}

export function housekeepingPriority(input: PriorityInput): PriorityResult {
  let score = BASE[input.kind] ?? 0;
  const reasons: PriorityReason[] = [];
  if (input.kind === 'reclean') reasons.push('failed_inspection');
  // Arrival urgency only matters for work that makes the unit ready for the next guest.
  const readinessWork =
    input.kind === 'departure_clean' ||
    input.kind === 'vacant_clean' ||
    input.kind === 'reclean' ||
    input.kind === 'inspection' ||
    input.kind === 'deep_clean';
  const a = input.arrival;
  if (a && readinessWork && a.today) {
    if (a.guestWaiting) {
      score += 50;
      reasons.push('guest_waiting');
    }
    const soon =
      a.expectedAt !== null &&
      a.expectedAt.getTime() - input.now.getTime() <= input.arrivalSoonMinutes * 60_000;
    if (soon) {
      score += 30;
      reasons.push('arrival_due_soon');
    } else {
      score += 15;
      reasons.push('arrival_today');
    }
    if (a.earlyCheckIn) {
      score += 20;
      reasons.push('early_check_in');
    }
    if (a.vip) {
      score += 15;
      reasons.push('vip');
    }
  } else if (a?.vip && (input.kind === 'stayover' || input.kind === 'turndown')) {
    score += 15;
    reasons.push('vip');
  }
  if (input.kind === 'departure_clean' && input.departed) {
    score += 5;
    reasons.push('guest_departed');
  }
  return { priority: bucket(score), score, reasons };
}

export const PRIORITY_REASON_LABELS: Record<PriorityReason, string> = {
  guest_waiting: 'Guest waiting',
  arrival_due_soon: 'Arrival due soon',
  early_check_in: 'Early check-in',
  arrival_today: 'Arrival today',
  vip: 'VIP',
  guest_departed: 'Guest departed',
  failed_inspection: 'Failed inspection',
};
