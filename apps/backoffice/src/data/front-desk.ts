/**
 * Front-desk row view: reservations' `frontDeskRow` (the authority for the stay) enriched with what operations
 * knows about the unit (condition, VIP flag on the arrival, who is cleaning it). Every enrichment is optional:
 * without the board the row still renders, with "—" where operations would have answered.
 */
import { diffDays } from '@portico/ui';
import type { BoardRow, DeskList, FrontDeskRow, OperationsBoard, ReadinessCheck } from './contracts';

/** Who acts on a blocker, by readiness check (department; a named person when operations assigned one). */
export type BlockerOwner = { department: 'front_desk' | 'housekeeping' | 'payments'; name: string | null };

export interface DeskRowView extends FrontDeskRow {
  nights: number;
  vip: boolean;
  unitCondition: string | null;
  unitTypeCode: string | null;
  /** The single thing to clear before check-in (expected stays only). */
  blocker: (ReadinessCheck & { owner: BlockerOwner }) | null;
  /** "Is the stay secured?" — the payment_secured readiness check (FD-03). Null when not composed. */
  secured: ReadinessCheck | null;
}

const DEPARTMENT_BY_CHECK: Record<string, BlockerOwner['department']> = {
  unit_assigned: 'front_desk',
  unit_ready: 'housekeeping',
  payment_secured: 'front_desk',
  registration: 'front_desk',
  requests: 'housekeeping',
};

export function composeDeskRows(desk: DeskList, board: OperationsBoard | null | undefined): DeskRowView[] {
  const byUnit = new Map<string, BoardRow>();
  for (const r of board?.rows ?? []) byUnit.set(r.unit.unitId, r);
  return desk.items.map((row) => {
    const unit = row.unitId ? byUnit.get(row.unitId) : undefined;
    const r = row.readiness;
    const key = r?.blockingReason?.key;
    const check = key ? (r?.checks.find((c) => c.key === key) ?? null) : null;
    const department = key ? (DEPARTMENT_BY_CHECK[key] ?? 'front_desk') : 'front_desk';
    const assignee = department === 'housekeeping' ? (unit?.openTasks[0]?.assigneeName ?? null) : null;
    return {
      ...row,
      nights: Math.max(0, diffDays(row.arrival, row.departure)),
      vip: unit?.arrival?.stayId === row.stayId ? unit.arrival.vip : false,
      unitCondition: unit?.unit.condition ?? null,
      unitTypeCode: unit?.unit.unitTypeCode ?? null,
      blocker: r?.blockingReason
        ? {
            key: r.blockingReason.key,
            message: r.blockingReason.message,
            status: check?.status ?? 'blocking',
            owner: { department, name: assignee },
          }
        : null,
      secured: r?.checks.find((c) => c.key === 'payment_secured') ?? null,
    };
  });
}

/** Readiness as the board shows it: an in-house stay is never "ready" (C3.2). */
export type DeskState = 'ready' | 'blocked' | 'checked_in' | 'in_house' | 'unknown';
export function deskState(r: DeskRowView): DeskState {
  if (r.stayStatus === 'in_house') return r.checkInRun?.status === 'completed' ? 'checked_in' : 'in_house';
  if (!r.readiness) return 'unknown';
  return r.readiness.ready ? 'ready' : 'blocked';
}
