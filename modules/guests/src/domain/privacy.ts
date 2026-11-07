/**
 * Data-subject requests (spec GUE-R17/R18, invariant GUE-I06). Pure planning of what erasure does to each data
 * category, so the plan can be previewed, tested and reported.
 */

export type ErasureAction = 'anonymize' | 'delete' | 'redact' | 'retain_minimal' | 'retain_pseudonymous';

export interface ErasurePlanItem {
  category: string;
  action: ErasureAction;
  why: string;
}

/**
 * The erasure plan for a guest profile. Fiscal/financial references (stay refs, folio links, revenue history)
 * are retained under the pseudonymous profile id because finance must keep fiscal records for their statutory
 * period (research 04 §C1; Q44). Consent history is kept as minimal evidence of what was (not) permitted.
 */
export const ERASURE_PLAN: readonly ErasurePlanItem[] = [
  { category: 'profile.names', action: 'anonymize', why: 'Replaced by an irreversible token' },
  { category: 'profile.dateOfBirth', action: 'delete', why: 'Not needed after erasure' },
  { category: 'profile.tags', action: 'delete', why: 'May describe the person' },
  {
    category: 'profile.nationality',
    action: 'retain_minimal',
    why: 'Kept only as an aggregate statistics attribute',
  },
  { category: 'contactPoints', action: 'delete', why: 'Direct identifiers' },
  { category: 'identityDocuments', action: 'delete', why: 'Direct identifiers' },
  { category: 'specialNeeds', action: 'delete', why: 'Sensitive data' },
  { category: 'preferences', action: 'delete', why: 'Personal data' },
  { category: 'alerts', action: 'delete', why: 'Personal data' },
  { category: 'notes', action: 'redact', why: 'Text removed; the fact a note existed remains for audit' },
  { category: 'relationships', action: 'delete', why: 'Links to other people' },
  { category: 'companyContacts', action: 'delete', why: 'Links to companies as a person' },
  {
    category: 'consents',
    action: 'retain_minimal',
    why: 'Purpose, state and date kept as evidence; free-text evidence removed',
  },
  {
    category: 'stayHistory',
    action: 'retain_pseudonymous',
    why: 'Stay and folio references and revenue are needed for fiscal retention; no name remains',
  },
  {
    category: 'idempotencyResponses',
    action: 'redact',
    why: 'Stored API responses that mention the person are replaced by an erased marker (replays answer 410)',
  },
  {
    category: 'mergeRecords',
    action: 'redact',
    why: 'Pre-merge snapshots contain personal data; the merge becomes irreversible',
  },
];

/** Irreversible display token for an anonymized profile — derived from nothing personal. */
export function anonymizedName(profileId: string): string {
  return `Anonymized guest ${profileId.slice(-8)}`;
}

export type PrivacyRequestStatus = 'received' | 'in_progress' | 'completed' | 'rejected' | 'on_hold';
