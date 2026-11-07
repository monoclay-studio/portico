/**
 * Readiness list (DCL-R01) as pure functions: stable item keys (what an override names), the delayed-transfer rule
 * for arrivals (EC-DCL-010), ordering and the one-sentence summary the auditor reads first.
 */
import type { ReadinessItem } from '../contracts';

export function itemKey(source: string, code: string, ref: { type: string; id: string } | null): string {
  return `${source}:${code}:${ref ? `${ref.type}:${ref.id}` : '-'}`;
}

/**
 * An expected arrival counts as "transfer delayed" when its recorded estimate is later than its schedule, or
 * later than now (the guest is still on the way). Such an arrival is never marked no-show automatically.
 */
export function transferDelayed(
  transfer: { scheduledAt: string | null; estimatedAt: string | null },
  eta: string | null,
  now: Date,
): boolean {
  const est = transfer.estimatedAt ? Date.parse(transfer.estimatedAt) : Number.NaN;
  const sched = transfer.scheduledAt ? Date.parse(transfer.scheduledAt) : Number.NaN;
  if (!Number.isNaN(est) && !Number.isNaN(sched) && est > sched) return true;
  if (!Number.isNaN(est) && est > now.getTime()) return true;
  if (eta && /^\d{4}-\d{2}-\d{2}T/.test(eta)) {
    const e = Date.parse(eta);
    if (!Number.isNaN(e) && e > now.getTime()) return true;
  }
  return false;
}

const SEVERITY_RANK = { blocking: 0, warning: 1, info: 2 } as const;

export function sortItems(items: ReadinessItem[]): ReadinessItem[] {
  return [...items].sort(
    (a, b) =>
      Number(b.blocking) - Number(a.blocking) ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.code.localeCompare(b.code) ||
      a.key.localeCompare(b.key),
  );
}

export function summarize(
  counts: { blocking: number; warning: number; info: number },
  unavailable: number,
): string {
  const missing =
    unavailable > 0
      ? ` ${unavailable} check${unavailable === 1 ? '' : 's'} could not run (shown below).`
      : '';
  if (counts.blocking === 0) {
    const w =
      counts.warning === 0 ? 'nothing open' : `${counts.warning} warning${counts.warning === 1 ? '' : 's'}`;
    return `Ready to close: ${w}.${missing}`;
  }
  return `${counts.blocking} thing${counts.blocking === 1 ? '' : 's'} to settle before today can close${
    counts.warning ? `, ${counts.warning} warning${counts.warning === 1 ? '' : 's'}` : ''
  }.${missing}`;
}
