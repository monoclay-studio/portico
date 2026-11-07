import { allocate, BusinessRuleError, money } from '@portico/kernel';

/**
 * Split a charge's components (net + each tax line) across destinations whose gross amounts are given, so that:
 *  - every destination's components sum exactly to its gross amount (row sums),
 *  - every component is fully distributed (column sums),
 *  - no cell has the opposite sign of the charge (no negative tax on a positive charge),
 *  - the distribution is proportional up to one minor unit per cell.
 * Component 0 is the net amount (absorbs rounding). Amounts share one currency and one sign.
 */
export function splitComponents(components: readonly number[], destinationGross: readonly number[]): number[][] {
  const gross = components.reduce((s, c) => s + c, 0);
  const destTotal = destinationGross.reduce((s, c) => s + c, 0);
  if (gross !== destTotal) {
    throw new BusinessRuleError(
      'split_mismatch',
      `Split amounts (${destTotal}) must add up to the charge total (${gross}).`,
    );
  }
  if (destinationGross.length === 0) return [];
  if (destinationGross.length === 1) return [[...components]];
  const sign = gross < 0 ? -1 : 1;
  const comps = components.map((c) => c * sign);
  const dests = destinationGross.map((d) => d * sign);
  if (comps.some((c) => c < 0) || dests.some((d) => d < 0)) {
    throw new BusinessRuleError(
      'mixed_sign_split',
      'A charge whose parts have different signs cannot be split automatically. Split it manually.',
    );
  }
  const rows = dests.map(() => comps.map(() => 0));
  if (gross === 0) return rows;
  // Taxes (components 1..n) allocated proportionally per column; net = row remainder.
  for (let j = 1; j < comps.length; j++) {
    const parts = allocate(money(comps[j] ?? 0, 'XXX'), dests);
    parts.forEach((p, i) => {
      const row = rows[i];
      if (row) row[j] = p.amountMinor;
    });
  }
  rows.forEach((row, i) => {
    row[0] = (dests[i] ?? 0) - row.slice(1).reduce((s, v) => s + v, 0);
  });
  // Fix-up: a row whose net went negative (tiny allocations) borrows tax units from rows with positive net.
  for (let guard = 0; guard < 10_000; guard++) {
    const i = rows.findIndex((r) => (r[0] ?? 0) < 0);
    if (i < 0) break;
    const row = rows[i] as number[];
    const j = row.findIndex((v, k) => k > 0 && v > 0);
    const k = rows.findIndex((r, idx) => idx !== i && (r[0] ?? 0) > 0);
    if (j < 0 || k < 0) break;
    const other = rows[k] as number[];
    row[j] = (row[j] ?? 0) - 1;
    row[0] = (row[0] ?? 0) + 1;
    other[j] = (other[j] ?? 0) + 1;
    other[0] = (other[0] ?? 0) - 1;
  }
  return rows.map((r) => r.map((v) => v * sign));
}

/**
 * Allocate `total` across components in proportion to `weights` (used when converting a charge's components to
 * another currency). Weights must not mix signs; the result carries the sign of `total` and sums to it exactly.
 */
export function proportional(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  if (weights.some((w) => w > 0) && weights.some((w) => w < 0)) {
    throw new BusinessRuleError('mixed_sign_split', 'Components with different signs cannot be converted together.');
  }
  const abs = weights.map((w) => Math.abs(w));
  if (abs.every((w) => w === 0)) return weights.map((_, i) => (i === 0 ? total : 0));
  const sign = total < 0 ? -1 : 1;
  return allocate(money(Math.abs(total), 'XXX'), abs).map((p) => p.amountMinor * sign);
}
