/**
 * What a rehearsal certificate binds (R-P1-2). "Rehearsed twice with zero differences" is only true for the cutover
 * if the cutover imports exactly what was rehearsed: the same plan (`planFingerprint`) AND the same data and
 * decisions (`dataFingerprint`). Both sides — the live job and its rehearsal in the trial organization — compute the
 * data fingerprint the same way from their own state, so a new export, a sync or a decision after the rehearsal makes
 * the certificate stale and the gate refuses until the rehearsal runs again. The binding applies to production
 * cutovers: a drill (rehearsal job) cuts over inside its own trial/sandbox organization — the drill IS the
 * rehearsal of the cutover, and its verify step reconciles whatever the final capture brought. Pure.
 */
import { canonicalJson, sha256Hex } from '@portico/kernel';
import type { ControlTotal } from './records';

export interface DataFingerprintInput {
  /** The current source state: one entry per (class, key) with the record's content hash. */
  records: ReadonlyArray<{ dataClass: string; key: string; hash: string }>;
  controlTotals: readonly ControlTotal[];
  /** People's decisions on exceptions (import as is, excluded, accepted as loss, deferred). */
  decisions: ReadonlyArray<{ dataClass: string; sourceKey: string; code: string; outcome: string }>;
}

const sorted = (rows: unknown[][]) =>
  rows.map((r) => JSON.stringify(r)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

export function dataFingerprint(input: DataFingerprintInput): string {
  return sha256Hex(
    canonicalJson({
      records: sorted(input.records.map((r) => [r.dataClass, r.key, r.hash])),
      control: sorted(input.controlTotals.map((t) => [t.dataClass, t.currency, t.count, t.amountMinor])),
      decisions: sorted(input.decisions.map((d) => [d.dataClass, d.sourceKey, d.code, d.outcome])),
    }),
  ).slice(0, 32);
}

export interface CertificateFacts {
  planFingerprint: string;
  dataFingerprint: string;
  exact: boolean;
  certifiedAt: string | null;
}

/** Read the certificate facts from a stored certificate (older certificates without a data fingerprint never match). */
export function certificateFacts(stored: unknown): CertificateFacts | null {
  if (!stored || typeof stored !== 'object') return null;
  const c = stored as Record<string, unknown>;
  return {
    planFingerprint: typeof c.planFingerprint === 'string' ? c.planFingerprint : '',
    dataFingerprint: typeof c.dataFingerprint === 'string' ? c.dataFingerprint : '',
    exact: c.exact === true,
    certifiedAt: typeof c.certifiedAt === 'string' ? c.certifiedAt : null,
  };
}

/** Why a certificate does not cover what would be cut over now, or `null` when it does. */
export function certificateGap(
  cert: CertificateFacts | null,
  current: { planFingerprint: string; dataFingerprint: string },
  opts: { bindData?: boolean } = {},
): { code: string; message: string } | null {
  if (!cert?.certifiedAt)
    return {
      code: 'no_rehearsal',
      message: 'No accepted rehearsal: two consecutive exact reconciliations are required.',
    };
  if (!cert.exact)
    return { code: 'rehearsal_not_exact', message: 'The last rehearsal did not reconcile exactly.' };
  if (cert.planFingerprint !== current.planFingerprint)
    return {
      code: 'plan_changed_since_rehearsal',
      message:
        'The mapping changed after the rehearsal. Rehearse again so the cutover runs exactly what was rehearsed.',
    };
  if (opts.bindData !== false && cert.dataFingerprint !== current.dataFingerprint)
    return {
      code: 'rehearsal_stale_data',
      message:
        'The data or the decisions changed after the rehearsal (a new export, a sync or a decision on an exception). Rehearse again so the cutover imports exactly what was rehearsed and reconciled.',
    };
  return null;
}
