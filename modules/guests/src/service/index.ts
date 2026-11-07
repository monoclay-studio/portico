/**
 * The guests application service, bound to its ports. Every function takes the command's TxContext first —
 * other modules call the provider functions (domain map § guests) inside their own transaction.
 */
import type { TxContext } from '@portico/db';
import type { EntityRef } from '@portico/kernel';
import type {
  AlertInput,
  CompanyInput,
  CompanyUpdate,
  ContactPointInput,
  CreateProfileInput,
  DocumentInput,
  NoteInput,
  PreferenceInput,
  PrivacyRequestInput,
  RelationshipInput,
  SearchQuery,
  SpecialNeedInput,
  UpdateProfileInput,
} from '../contracts';
import type { ConsentPurpose } from '../domain/consent';
import type { PostMergeOwner } from '../domain/merge';
import type { GuestsPorts } from '../ports';
import * as companies from './companies';
import * as consent from './consent';
import * as documents from './documents';
import * as duplicates from './duplicates';
import * as history from './history';
import * as merge from './merge';
import * as privacy from './privacy';
import * as profiles from './profiles';
import * as search from './search';

export type { StayHistoryInput } from './history';
export type { MirroredProfileInput, PossibleDuplicate, ProfileInput } from './profiles';

export function createGuestsService(ports: GuestsPorts) {
  return {
    ports,
    // ── Provider contract (docs/architecture/domain-map.md § guests) ──
    resolveProfile: (
      tx: TxContext,
      input: profiles.ProfileInput,
      opts?: { matchStrategy?: 'exact_only' | 'suggest' | 'create_new' },
    ) => profiles.resolveProfile(tx, ports, input, opts),
    getProfile: (tx: TxContext, profileId: string, opts?: { propertyId?: string | null }) =>
      profiles.getProfile(tx, ports, profileId, opts),
    getCompany: (tx: TxContext, companyId: string) => companies.getCompany(tx, companyId),
    recordStayHistory: (tx: TxContext, input: history.StayHistoryInput) =>
      history.recordStayHistory(tx, ports, input),
    mergeProfiles: (
      tx: TxContext,
      input: {
        survivorId: string;
        mergedId: string;
        reason: string;
        fieldChoices?: Record<string, 'survivor' | 'merged'>;
      },
    ) => merge.mergeProfiles(tx, ports, input),
    unmergeProfiles: (
      tx: TxContext,
      input: {
        mergeId: string;
        reason: string;
        assignments?: Array<{ kind: string; id: string; owner: PostMergeOwner }>;
      },
    ) => merge.unmergeProfiles(tx, ports, input),
    // ── Additive provider functions (spec §6 proposed contract changes) ──
    getRecognitionSummary: (tx: TxContext, input: { profileId: string; propertyId: string }) =>
      history.getRecognitionSummary(tx, ports, input),
    getConsent: (
      tx: TxContext,
      input: { profileId: string; legalEntityId: string; purpose: ConsentPurpose; propertyId?: string },
    ) => consent.getConsent(tx, ports, input),
    searchProfiles: (tx: TxContext, query: SearchQuery) => search.searchProfiles(tx, ports, query),
    recordReferenceRepoints: (
      tx: TxContext,
      input: { mergeId: string; module: string; references: Array<EntityRef & { field?: string | null }> },
    ) => merge.recordReferenceRepoints(tx, input),
    upsertMirroredProfile: (tx: TxContext, input: profiles.MirroredProfileInput) =>
      profiles.upsertMirroredProfile(tx, ports, input),

    // ── Profiles ──
    createProfile: (tx: TxContext, input: CreateProfileInput) => profiles.createProfile(tx, ports, input),
    updateProfile: (tx: TxContext, id: string, expectedVersion: number, patch: UpdateProfileInput) =>
      profiles.updateProfile(tx, ports, id, expectedVersion, patch),
    addContactPoint: (tx: TxContext, profileId: string, input: ContactPointInput & { propertyId?: string }) =>
      profiles.addContactPoint(tx, ports, profileId, input),
    verifyContactPoint: (
      tx: TxContext,
      contactPointId: string,
      input: { method: string; propertyId?: string },
    ) => profiles.verifyContactPoint(tx, ports, contactPointId, input),
    removeContactPoint: (
      tx: TxContext,
      contactPointId: string,
      opts?: { propertyId?: string; reason?: string },
    ) => profiles.removeContactPoint(tx, ports, contactPointId, opts),
    addPreference: (tx: TxContext, profileId: string, input: PreferenceInput & { propertyId?: string }) =>
      profiles.addPreference(tx, ports, profileId, input),
    updatePreference: (
      tx: TxContext,
      preferenceId: string,
      expectedVersion: number,
      input: { value: string; propertyId?: string },
    ) => profiles.updatePreference(tx, ports, preferenceId, expectedVersion, input),
    removePreference: (tx: TxContext, preferenceId: string, opts?: { propertyId?: string }) =>
      profiles.removePreference(tx, ports, preferenceId, opts),
    addAlert: (tx: TxContext, profileId: string, input: AlertInput) =>
      profiles.addAlert(tx, ports, profileId, input),
    resolveAlert: (
      tx: TxContext,
      alertId: string,
      expectedVersion: number,
      opts?: { propertyId?: string; reason?: string },
    ) => profiles.resolveAlert(tx, ports, alertId, expectedVersion, opts),
    addNote: (tx: TxContext, profileId: string, input: NoteInput) =>
      profiles.addNote(tx, ports, profileId, input),
    reviseNote: (tx: TxContext, noteId: string, input: { body: string }) =>
      profiles.reviseNote(tx, ports, noteId, input),
    addRelationship: (tx: TxContext, profileId: string, input: RelationshipInput & { propertyId?: string }) =>
      profiles.addRelationship(tx, ports, profileId, input),
    addSpecialNeed: (tx: TxContext, profileId: string, input: SpecialNeedInput) =>
      profiles.addSpecialNeed(tx, ports, profileId, input),
    readSpecialNeed: (tx: TxContext, specialNeedId: string, reason: string) =>
      profiles.readSpecialNeed(tx, ports, specialNeedId, reason),
    setLegalHold: (tx: TxContext, profileId: string, input: { hold: boolean; reason: string }) =>
      profiles.setLegalHold(tx, ports, profileId, input),
    getStayHistory: (tx: TxContext, profileId: string, opts?: { propertyId?: string | null }) =>
      history.getStayHistory(tx, ports, profileId, opts),

    // ── Consent ──
    recordConsent: (tx: TxContext, profileId: string, input: Parameters<typeof consent.recordConsent>[3]) =>
      consent.recordConsent(tx, ports, profileId, input),
    consentHistory: (tx: TxContext, profileId: string) => consent.consentHistory(tx, ports, profileId),

    // ── Identity documents ──
    addDocument: (tx: TxContext, profileId: string, input: DocumentInput) =>
      documents.addDocument(tx, ports, profileId, input),
    revealDocument: (tx: TxContext, documentId: string, reason: string) =>
      documents.revealDocument(tx, ports, documentId, reason),
    deleteDocument: (tx: TxContext, documentId: string, reason: string) =>
      documents.deleteDocument(tx, ports, documentId, reason),
    purgeExpiredDocuments: (tx: TxContext, opts?: { asOf?: string }) =>
      documents.purgeExpiredDocuments(tx, opts),

    // ── Duplicates & merges ──
    detectDuplicates: (tx: TxContext, profileId: string) =>
      duplicates.detectDuplicates(tx, profileId, 'scan'),
    listDuplicates: (
      tx: TxContext,
      opts?: { status?: 'open' | 'merged' | 'dismissed'; limit?: number; propertyId?: string },
    ) => duplicates.listDuplicates(tx, ports, opts),
    dismissDuplicate: (tx: TxContext, candidateId: string, reason: string) =>
      duplicates.dismissDuplicate(tx, ports, candidateId, reason),
    scanDuplicates: (tx: TxContext, opts?: { afterId?: string; batch?: number }) =>
      duplicates.scanDuplicates(tx, opts),
    previewMerge: (
      tx: TxContext,
      input: { survivorId: string; mergedId: string; fieldChoices?: Record<string, 'survivor' | 'merged'> },
    ) => merge.previewMerge(tx, ports, input),
    getMerge: (tx: TxContext, mergeId: string) => merge.getMerge(tx, ports, mergeId),
    listMergesForProfile: (tx: TxContext, profileId: string) =>
      merge.listMergesForProfile(tx, ports, profileId),
    previewUnmerge: (tx: TxContext, mergeId: string) => merge.previewUnmerge(tx, ports, mergeId),
    snapshotProfile: (tx: TxContext, profileId: string) => merge.snapshotProfile(tx, profileId),

    // ── Companies & agencies ──
    createCompany: (tx: TxContext, input: CompanyInput) => companies.createCompany(tx, ports, input),
    listCompanies: (tx: TxContext, opts?: Parameters<typeof companies.listCompanies>[1]) =>
      companies.listCompanies(tx, opts),
    updateCompany: (tx: TxContext, companyId: string, expectedVersion: number, patch: CompanyUpdate) =>
      companies.updateCompany(tx, ports, companyId, expectedVersion, patch),
    addCompanyContact: (
      tx: TxContext,
      companyId: string,
      input: { profileId: string; role: 'primary' | 'booker' | 'billing' | 'travel_manager' | 'other' },
    ) => companies.addCompanyContact(tx, ports, companyId, input),
    removeCompanyContact: (tx: TxContext, contactId: string) => companies.removeCompanyContact(tx, contactId),

    // ── Privacy (data-subject requests) ──
    submitPrivacyRequest: (tx: TxContext, input: PrivacyRequestInput) =>
      privacy.submitPrivacyRequest(tx, ports, input),
    exportProfile: (tx: TxContext, input: PrivacyRequestInput) => privacy.exportProfile(tx, ports, input),
    eraseProfile: (tx: TxContext, input: PrivacyRequestInput) => privacy.eraseProfile(tx, ports, input),
    getPrivacyRequest: (tx: TxContext, id: string) => privacy.getPrivacyRequest(tx, ports, id),
    downloadExport: (tx: TxContext, requestId: string) => privacy.downloadExport(tx, ports, requestId),
  };
}

export type GuestsService = ReturnType<typeof createGuestsService>;
