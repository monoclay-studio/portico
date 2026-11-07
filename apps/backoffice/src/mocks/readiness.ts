import type { ReadinessCheck, ReadinessView } from './contracts';

/**
 * Arrival readiness (RES-R35 / OPS-R04) for the simulator. The real computation belongs to reservations +
 * operations; this mirrors the documented rule so the board behaves realistically:
 *   ready   ⇔ no check is blocking or unknown ("attention" items are shown but do not stop check-in);
 *   blocker = the first blocking check in operational priority order, else the first unknown one
 *             (an unknown outcome — e.g. a payment pending verification — is never treated as fine).
 */
export const CHECK_PRIORITY: ReadinessCheck['key'][] = [
  'unit_assigned',
  'unit_condition',
  'guarantee',
  'documents',
  'transfer',
  'requests',
];

const OWNER_BY_CHECK: Record<ReadinessCheck['key'], string> = {
  unit_assigned: 'Front desk',
  unit_condition: 'Housekeeping',
  guarantee: 'Front desk',
  documents: 'Front desk',
  transfer: 'Transfers desk',
  requests: 'Guest relations',
};

export function computeReadiness(checks: readonly ReadinessCheck[]): ReadinessView {
  const ordered = [...checks].sort((a, b) => CHECK_PRIORITY.indexOf(a.key) - CHECK_PRIORITY.indexOf(b.key));
  const blocking =
    ordered.find((c) => c.status === 'blocking') ?? ordered.find((c) => c.status === 'unknown');
  return {
    ready: !blocking,
    checks: ordered,
    blockingReason: blocking
      ? { key: blocking.key, message: blocking.message, owner: OWNER_BY_CHECK[blocking.key] }
      : null,
  };
}
