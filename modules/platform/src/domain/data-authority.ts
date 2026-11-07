/**
 * Data authority rules (ADR-0014; docs/adoption/source-of-truth-matrix.md §3, §6; gaps G-01, G-02, G-06).
 * Pure functions — the service applies them.
 */
export const DATA_DOMAINS = [
  'reservations',
  'availability',
  'rates',
  'guestProfiles',
  'charges',
  'payments',
  'roomStatus',
  'maintenance',
  'accounting',
  'guestCommunications',
] as const;
export type Domain = (typeof DATA_DOMAINS)[number];

export type Authority = 'portico' | 'external';
export type WriteMode = 'exclusive' | 'forward' | 'read_only';

/**
 * Exactly three combinations are meaningful (G-01):
 *  portico/exclusive · external/read_only · external/forward. external/exclusive is rejected.
 */
export function authorityCombinationProblem(a: {
  authority: Authority;
  writeMode: WriteMode;
  connectionId?: string | null | undefined;
}): { code: string; message: string } | null {
  if (a.authority === 'portico') {
    if (a.writeMode !== 'exclusive')
      return {
        code: 'invalid_write_mode',
        message: 'When Portico is the system of record its write mode is exclusive.',
      };
    if (a.connectionId)
      return {
        code: 'connection_not_allowed',
        message:
          'Portico as system of record is not linked to a connection. Remove the connection reference.',
      };
    return null;
  }
  if (!a.connectionId)
    return {
      code: 'connection_required',
      message: 'An external system of record must be linked to an integration connection.',
    };
  if (a.writeMode === 'exclusive')
    return {
      code: 'invalid_write_mode',
      message: 'Use read-only or forward for an external system of record.',
    };
  return null;
}

/** Domains whose authority change needs a second person's approval (CR-10). */
export const SECOND_APPROVER_DOMAINS: readonly Domain[] = [
  'charges',
  'payments',
  'accounting',
  'availability',
];

export function needsSecondApprover(domains: readonly Domain[]): boolean {
  return domains.some((d) => SECOND_APPROVER_DOMAINS.includes(d));
}

/** Authority transition (G-02): planned → frozen → effective | cancelled. */
export type TransitionStatus = 'planned' | 'frozen' | 'effective' | 'cancelled';

const NEXT: Record<TransitionStatus, readonly TransitionStatus[]> = {
  planned: ['frozen', 'cancelled'],
  frozen: ['effective', 'cancelled'],
  effective: [],
  cancelled: [],
};

export function canMoveTransition(from: TransitionStatus, to: TransitionStatus): boolean {
  return NEXT[from].includes(to);
}

/** Freeze length bounds (source-of-truth-matrix §6.1 T-5: ≤ 60 min typical, ≤ 3 h for larger cutovers). */
export const FREEZE_MINUTES = { min: 1, max: 24 * 60 } as const;
