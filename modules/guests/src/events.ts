/**
 * Events emitted by the guests module. Payloads never carry personal values (names, contacts, documents) —
 * only ids, field names and states — so the outbox and every consumer's copy stay free of PII.
 */
import type { EntityRef } from '@portico/kernel';

export const GUEST_EVENTS = {
  profileCreated: 'guests.profile.created',
  profileUpdated: 'guests.profile.updated',
  profileMerged: 'guests.profile.merged',
  profileUnmerged: 'guests.profile.unmerged',
  profileAnonymized: 'guests.profile.anonymized',
  consentChanged: 'guests.consent.changed',
  alertRaised: 'guests.alert.raised',
  companyCreated: 'guests.company.created',
  companyUpdated: 'guests.company.updated',
  companyStatusChanged: 'guests.company.statusChanged',
  duplicateDetected: 'guests.duplicate.detected',
} as const;

export interface ProfileCreatedPayload extends Record<string, unknown> {
  profileId: string;
  propertyId: string;
  provenance: 'live' | 'copied' | 'external';
}

export interface ProfileUpdatedPayload extends Record<string, unknown> {
  profileId: string;
  changedFields: string[];
}

/**
 * Consumers holding profile ids re-point references from `mergedId` to `survivorId` (idempotent by mergeId)
 * and report what they re-pointed with `recordReferenceRepoints` so an unmerge can restore exactly those.
 */
export interface ProfileMergedPayload extends Record<string, unknown> {
  mergeId: string;
  survivorId: string;
  mergedId: string;
}

/**
 * Consumers restore exactly the references listed for their module in `referencesToRestore` back to
 * `restoredId`, and re-point `reassigned` (records created after the merge that staff assigned to the restored
 * profile during unmerge review).
 */
export interface ProfileUnmergedPayload extends Record<string, unknown> {
  mergeId: string;
  restoredId: string;
  survivorId: string;
  referencesToRestore: Record<string, Array<EntityRef & { field?: string | null }>>;
  reassigned: EntityRef[];
}

export interface ProfileAnonymizedPayload extends Record<string, unknown> {
  profileId: string;
  privacyRequestId: string;
  /** Profiles merged into this one that were anonymized with it. */
  alsoAnonymized: string[];
}

export interface ConsentChangedPayload extends Record<string, unknown> {
  profileId: string;
  legalEntityId: string;
  purpose: string;
  state: 'granted' | 'withdrawn' | 'unknown';
}
