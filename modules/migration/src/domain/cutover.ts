/**
 * Cutover rules: the seven irreducible human steps (DD11 §6.2), the production gate, freeze measurement and the
 * rollback window (acceptance criteria §9). Pure.
 */
import type { TenantEnvironment } from '@portico/kernel';
import { type CertificateFacts, certificateGap } from './certificate';
import type { Purpose } from './pipeline';

/** TARGETS (DD11 §7; to be validated with a real hotel and source). */
export const FREEZE_TARGET_MINUTES = 15;
export const ROLLBACK_WINDOW_HOURS = 48;
/** Checklist items waiting past their due time are reminded at most this often. */
export const REMINDER_INTERVAL_HOURS = 24;

export const CHECKLIST_KEYS = [
  'data_authorization',
  'source_access',
  'card_transfer',
  'opening_balances',
  'channel_switch',
  'cutover_window',
  'staff_acceptance',
] as const;
export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];

export interface ChecklistDefinition {
  key: ChecklistKey;
  title: string;
  /** Why a person must do it — shown so the step is never hidden or faked. */
  why: string;
  ownerRole: string;
  /** How it completes: by a person with evidence, or derived from facts Portico observed. */
  completion: 'person' | 'observed';
  permission: string;
  /** Days after the job starts by which it is due (reminders after that). */
  dueAfterDays: number;
}

export const CHECKLIST: readonly ChecklistDefinition[] = [
  {
    key: 'data_authorization',
    title: 'Sign the data authorization',
    why: "Only the hotel's legal entity can authorize access to and processing of its data (data processing terms).",
    ownerRole: 'General manager or owner',
    completion: 'person',
    permission: 'migration.checklist.complete',
    dueAfterDays: 1,
  },
  {
    key: 'source_access',
    title: 'Give access to the current system',
    why: 'The current vendor requires the hotel to approve access, run the export or issue a key. Portico confirms it when the data can actually be read.',
    ownerRole: 'Hotel IT or general manager',
    completion: 'observed',
    permission: 'migration.job.manage',
    dueAfterDays: 1,
  },
  {
    key: 'card_transfer',
    title: 'Decide how stored cards move',
    why: 'Only payment providers can move stored cards, provider to provider. By default guests are asked again for a card (re-collection) and no card data is handled by Portico.',
    ownerRole: 'Finance controller',
    completion: 'person',
    permission: 'migration.finance.signoff',
    dueAfterDays: 2,
  },
  {
    key: 'opening_balances',
    title: 'Confirm the opening balances',
    why: 'Deposits, open folios and receivables are accounting judgements with legal responsibility. Portico prepares the reconciliation and the list of unclear items.',
    ownerRole: 'Finance controller',
    completion: 'person',
    permission: 'migration.finance.signoff',
    dueAfterDays: 2,
  },
  {
    key: 'channel_switch',
    title: 'Authorize the channel and interface switch',
    why: 'Disconnecting the old channel manager and re-pointing OTAs, POS and locks depend on contracts with those vendors; some OTAs require the hotel to confirm in their extranet.',
    ownerRole: 'Revenue manager',
    completion: 'person',
    permission: 'migration.checklist.complete',
    dueAfterDays: 3,
  },
  {
    key: 'cutover_window',
    title: 'Choose the cutover time',
    why: 'An operational decision: the best time is usually after the old system’s end of day, with few arrivals.',
    ownerRole: 'General manager',
    completion: 'person',
    permission: 'migration.cutover.execute',
    dueAfterDays: 3,
  },
  {
    key: 'staff_acceptance',
    title: 'Staff acceptance on the migrated data',
    why: 'Department heads confirm arrivals, check-in, posting, payment and check-out on the rehearsed copy. This is staff validation, recorded separately from automated checks.',
    ownerRole: 'Department heads',
    completion: 'person',
    permission: 'migration.staff.accept',
    dueAfterDays: 3,
  },
];

export interface GateInput {
  purpose: Purpose;
  environment: TenantEnvironment;
  checklist: ReadonlyArray<{ key: ChecklistKey; status: 'waiting' | 'done' | 'not_applicable' }>;
  /** The rehearsal certificate (plan + data + decisions it covers). */
  certificate: CertificateFacts | null;
  planFingerprint: string;
  /** Fingerprint of the data and decisions that would be cut over now (`dataFingerprint`). */
  dataFingerprint: string;
  /** Opening money: what finance confirmed (checklist evidence) and what would be posted now. */
  money?: { confirmed: string | null; current: string };
  authorization: { planFingerprint: string; grantedBy: string; expiresAt: Date } | null;
  jobCreatedBy: string;
  transition: { status: string; approved: boolean } | null;
  openBlockingExceptions: number;
  /** Records in the final capture that would not be imported and carry no decision (verdict "exception"). */
  finalExtractBlocking: number;
  now: Date;
}

export interface GateResult {
  passed: boolean;
  blockers: Array<{ code: string; message: string }>;
}

/** Everything that must be true before Portico becomes the system of record (no cutover with open blockers). */
export function evaluateCutoverGate(g: GateInput): GateResult {
  const blockers: GateResult['blockers'] = [];
  const add = (code: string, message: string) => blockers.push({ code, message });
  if (g.purpose === 'production' && g.environment !== 'live')
    add('not_live', 'A production cutover runs only in the live organization.');
  if (g.purpose === 'rehearsal' && g.environment === 'live')
    add('drill_in_live', 'A cutover drill never runs in the live organization.');
  const gap = certificateGap(
    g.certificate,
    { planFingerprint: g.planFingerprint, dataFingerprint: g.dataFingerprint },
    // Production imports into live only what was rehearsed; a drill's own cutover is the rehearsal.
    { bindData: g.purpose === 'production' },
  );
  if (gap) add(gap.code, gap.message);
  if (g.purpose === 'production') {
    const openingDone = g.checklist.some((c) => c.key === 'opening_balances' && c.status === 'done');
    if (openingDone && g.money && g.money.confirmed !== g.money.current)
      add(
        'opening_balances_stale',
        'The opening money changed after finance confirmed it. Finance confirms the opening balances again.',
      );
    for (const item of CHECKLIST)
      if (!g.checklist.some((c) => c.key === item.key && c.status !== 'waiting'))
        add(`checklist_${item.key}`, `Waiting for: ${item.title} (${item.ownerRole}).`);
    if (!g.authorization)
      add(
        'production_authorization_missing',
        'A production migration needs a recorded authorization by an authorized person other than the one who started it.',
      );
    else {
      if (g.authorization.grantedBy === g.jobCreatedBy)
        add(
          'authorization_same_person',
          'The authorization must come from a different person than the job’s creator.',
        );
      if (g.authorization.planFingerprint !== g.planFingerprint)
        add(
          'authorization_plan_changed',
          'The plan changed after it was authorized. Authorize the current plan again.',
        );
      if (g.authorization.expiresAt.getTime() <= g.now.getTime())
        add('authorization_expired', 'The production authorization has expired. Authorize again.');
    }
  }
  if (!g.transition)
    add('no_transition', 'The switch of system of record has not been planned (choose the cutover time).');
  else if (!g.transition.approved)
    add('transition_not_approved', 'The switch of system of record needs approval by a second person.');
  else if (g.transition.status !== 'planned' && g.transition.status !== 'frozen')
    add('transition_not_open', `The planned switch is ${g.transition.status}. Plan the cutover again.`);
  if (g.openBlockingExceptions > 0)
    add('open_blocking_exceptions', `${g.openBlockingExceptions} blocking exception(s) are still open.`);
  if (g.finalExtractBlocking > 0)
    add(
      'final_capture_blocking',
      `${g.finalExtractBlocking} record(s) in the final capture have blocking problems and no decision. Correct them in the source, or decide them (import as is where allowed, exclude, accept as loss, or defer to after the cutover).`,
    );
  return { passed: blockers.length === 0, blockers };
}

/** Measured freeze: from the moment the source was frozen until Portico opened for staff. */
export function freezeMinutes(frozenAt: Date, openedAt: Date): number {
  return Math.round(((openedAt.getTime() - frozenAt.getTime()) / 60_000) * 100) / 100;
}

export function rollbackWindowEnds(switchedAt: Date, hours = ROLLBACK_WINDOW_HOURS): Date {
  return new Date(switchedAt.getTime() + hours * 3_600_000);
}

export function inRollbackWindow(switchedAt: Date | null, endsAt: Date | null, now: Date): boolean {
  return (
    !!switchedAt && !!endsAt && now.getTime() >= switchedAt.getTime() && now.getTime() < endsAt.getTime()
  );
}
