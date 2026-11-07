// Public API contracts for the guests module. No server-only imports: web apps import this file.
import { z } from 'zod';

const countryCode = z.string().regex(/^[A-Z]{2}$/, 'Use a two-letter ISO country code, e.g. MV');
const languageTag = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Use a BCP 47 language tag, e.g. ru or zh-Hans');
const shortText = z.string().trim().min(1).max(200);
const nameText = z.string().trim().min(1).max(120);
const isoDateTime = z.string();

export const profileStatus = z.enum(['active', 'merged', 'anonymized']);
export const provenance = z.enum(['live', 'copied', 'external']);
export const contactKind = z.enum(['email', 'phone', 'whatsapp', 'address']);
export const consentPurpose = z.enum([
  'marketing_email',
  'marketing_sms',
  'marketing_whatsapp',
  'profiling',
  'cross_property_sharing',
]);
export const consentState = z.enum(['granted', 'withdrawn', 'unknown']);
export const documentType = z.enum([
  'passport',
  'national_id',
  'residence_permit',
  'driving_licence',
  'other',
]);
export const alertSeverity = z.enum(['info', 'important', 'critical']);
export const relationshipKind = z.enum([
  'spouse',
  'partner',
  'child',
  'parent',
  'sibling',
  'assistant',
  'employer_contact',
  'travel_companion',
  'other',
]);
export const stayRole = z.enum(['occupant', 'booker', 'payer']);
export const companyKind = z.enum(['company', 'agency']);
export const companyStatus = z.enum(['active', 'on_hold', 'inactive']);
export const companyContactRole = z.enum(['primary', 'booker', 'billing', 'travel_manager', 'other']);
export const matchStrategy = z.enum(['exact_only', 'suggest', 'create_new']);

export const importantDate = z.object({
  kind: z.enum(['anniversary', 'honeymoon', 'birthday_celebration', 'other']),
  date: z.iso.date(),
  note: z.string().max(200).optional(),
});

// ───────────────────────────── Inputs ─────────────────────────────

export const contactPointInput = z.object({
  kind: contactKind,
  value: z.string().trim().min(1).max(300),
  label: z.string().max(40).optional(),
  isPrimary: z.boolean().optional(),
  verified: z.boolean().optional(),
  verificationMethod: z.string().max(60).optional(),
  source: z.string().max(60).optional(),
});
export type ContactPointInput = z.infer<typeof contactPointInput>;

const profileFields = {
  title: z.string().max(40).optional(),
  givenName: nameText.optional(),
  middleName: nameText.optional(),
  familyName: nameText,
  nativeGivenName: nameText.optional(),
  nativeFamilyName: nameText.optional(),
  preferredName: nameText.optional(),
  language: languageTag.optional(),
  nationality: countryCode.optional(),
  dateOfBirth: z.iso.date().optional(),
  vipLevel: z.string().max(20).optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  importantDates: z.array(importantDate).max(20).optional(),
};

export const createProfileInput = z.object({
  /** Property where the profile is being created (data-authority check, visibility link). */
  propertyId: z.uuid(),
  ...profileFields,
  /** Native-script names may be given without a Latin transliteration only for Cyrillic (auto ICAO). */
  familyName: nameText.optional(),
  contactPoints: z.array(contactPointInput).max(20).optional(),
  source: z.object({ kind: z.string().max(40), ref: z.string().max(200).optional() }).optional(),
  matchStrategy: matchStrategy.optional(),
});
export type CreateProfileInput = z.infer<typeof createProfileInput>;

export const updateProfileInput = z
  .object({
    title: z.string().max(40).nullable(),
    givenName: nameText.nullable(),
    middleName: nameText.nullable(),
    familyName: nameText,
    nativeGivenName: nameText.nullable(),
    nativeFamilyName: nameText.nullable(),
    preferredName: nameText.nullable(),
    language: languageTag.nullable(),
    nationality: countryCode.nullable(),
    dateOfBirth: z.iso.date().nullable(),
    vipLevel: z.string().max(20).nullable(),
    tags: z.array(z.string().max(40)).max(30),
    importantDates: z.array(importantDate).max(20),
    /** The property the editor is working at (data-authority check). Defaults to the profile's home property. */
    propertyId: z.uuid(),
  })
  .partial();
export type UpdateProfileInput = z.infer<typeof updateProfileInput>;

export const preferenceInput = z.object({
  category: z.string().trim().min(1).max(60),
  value: z.string().trim().min(1).max(300),
  scopePropertyId: z.uuid().optional(),
  source: z.string().max(60).optional(),
});
export type PreferenceInput = z.infer<typeof preferenceInput>;

export const alertInput = z.object({
  propertyId: z.uuid().optional(),
  severity: alertSeverity,
  text: z.string().trim().min(1).max(500),
  audience: z.array(z.string().max(40)).max(20).optional(),
  visibility: z.enum(['shared', 'property_private']),
  activeFrom: z.iso.date().optional(),
  activeTo: z.iso.date().optional(),
});
export type AlertInput = z.infer<typeof alertInput>;

export const noteInput = z.object({
  propertyId: z.uuid().optional(),
  visibility: z.enum(['shared', 'property_private', 'department']),
  department: z.string().max(60).optional(),
  body: z.string().trim().min(1).max(4000),
});
export type NoteInput = z.infer<typeof noteInput>;

export const relationshipInput = z.object({
  relatedProfileId: z.uuid(),
  kind: relationshipKind,
  note: z.string().max(200).optional(),
});
export type RelationshipInput = z.infer<typeof relationshipInput>;

export const consentEvidence = z.object({
  textVersion: z.string().max(100).optional(),
  channel: z.string().max(60).optional(),
  capturedAt: z.string().max(40).optional(),
  reference: z.string().max(200).optional(),
});
export const consentInput = z.object({
  /** Consent is per legal entity; give it directly or via the property it operates. */
  legalEntityId: z.uuid().optional(),
  propertyId: z.uuid().optional(),
  purpose: consentPurpose,
  state: consentState,
  source: z.string().trim().min(1).max(60),
  evidence: consentEvidence.default({}),
});
export type ConsentInput = z.infer<typeof consentInput>;

export const documentInput = z.object({
  propertyId: z.uuid(),
  type: documentType,
  issuingCountry: countryCode,
  number: z.string().trim().min(3).max(40),
  expiryDate: z.iso.date().optional(),
  issueDate: z.iso.date().optional(),
  surname: z.string().max(120).optional(),
  givenNames: z.string().max(120).optional(),
  nationality: countryCode.optional(),
  dateOfBirth: z.iso.date().optional(),
  imageRef: z.string().max(500).optional(),
});
export type DocumentInput = z.infer<typeof documentInput>;

export const revealInput = z.object({
  reason: z.string().trim().min(3).max(300),
});

export const specialNeedInput = z.object({
  propertyId: z.uuid(),
  category: z.enum(['allergy', 'medical', 'mobility', 'dietary_medical', 'other']),
  detail: z.string().trim().min(1).max(2000),
  /** What the guest agreed may be shown operationally (becomes an alert). Omit to keep it private. */
  guestAgreedAlertText: z.string().trim().min(1).max(300).optional(),
  alertSeverity: alertSeverity.optional(),
  audience: z.array(z.string().max(40)).max(20).optional(),
});
export type SpecialNeedInput = z.infer<typeof specialNeedInput>;

export const searchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  kind: z.enum(['auto', 'name', 'email', 'phone', 'company', 'document']).default('auto'),
  propertyId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type SearchQuery = z.infer<typeof searchQuery>;

export const fieldChoices = z.record(z.string(), z.enum(['survivor', 'merged']));
export const mergeInput = z.object({
  survivorId: z.uuid(),
  mergedId: z.uuid(),
  reason: z.string().trim().min(3).max(500),
  fieldChoices: fieldChoices.optional(),
});
export type MergeInput = z.infer<typeof mergeInput>;

export const postMergeAssignment = z.object({
  kind: z.string().max(40),
  id: z.uuid(),
  owner: z.enum(['survivor', 'restored']),
});
export const unmergeInput = z.object({
  reason: z.string().trim().min(3).max(500),
  assignments: z.array(postMergeAssignment).max(500).optional(),
});
export type UnmergeInput = z.infer<typeof unmergeInput>;

export const dismissInput = z.object({ reason: z.string().trim().min(3).max(300) });

export const commissionTerms = z.object({
  model: z.enum(['percent_of_room', 'percent_of_total', 'net_rate', 'none']),
  basisPoints: z.number().int().optional(),
  reference: z.string().max(200).optional(),
});

export const companyInput = z.object({
  kind: companyKind,
  legalName: shortText,
  tradingName: shortText.optional(),
  taxId: z.string().trim().min(1).max(60).optional(),
  iataCode: z.string().trim().max(20).optional(),
  parentCompanyId: z.uuid().optional(),
  defaultMarketSegment: z.string().max(40).optional(),
  commission: commissionTerms.optional(),
  arAccountRef: z.uuid().optional(),
  billingAddress: z.record(z.string(), z.string().max(300)).optional(),
  billingEmail: z.email().optional(),
  notes: z.string().max(2000).optional(),
  propertyId: z.uuid().optional(),
});
export type CompanyInput = z.infer<typeof companyInput>;

export const companyUpdate = companyInput
  .omit({ kind: true, propertyId: true })
  .extend({
    status: companyStatus,
    tradingName: shortText.nullable(),
    taxId: z.string().trim().min(1).max(60).nullable(),
    iataCode: z.string().trim().max(20).nullable(),
    parentCompanyId: z.uuid().nullable(),
    arAccountRef: z.uuid().nullable(),
    billingEmail: z.email().nullable(),
  })
  .partial();
export type CompanyUpdate = z.infer<typeof companyUpdate>;

export const companyContactInput = z.object({ profileId: z.uuid(), role: companyContactRole });

export const privacyRequestInput = z.object({
  kind: z.enum(['export', 'erasure']),
  profileId: z.uuid(),
  reason: z.string().trim().min(3).max(500),
});
export type PrivacyRequestInput = z.infer<typeof privacyRequestInput>;

export const legalHoldInput = z.object({ hold: z.boolean(), reason: z.string().trim().min(3).max(300) });

// ───────────────────────────── Outputs ─────────────────────────────

// Universal record contract (docs/architecture/domain-map.md § Universal record contract; kernel records.ts).
export const recordAction = z.object({
  action: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  reason: z.string().optional(),
  previewRequired: z.boolean().optional(),
});
export const recordOwner = z.object({
  kind: z.enum(['user', 'department']),
  id: z.string(),
  name: z.string().optional(),
});
export const recordIssue = z.object({
  code: z.string(),
  severity: z.enum(['blocking', 'warning', 'info']),
  message: z.string(),
  owner: recordOwner.optional(),
  since: z.string().optional(),
});
export const recordLink = z.object({
  rel: z.string(),
  type: z.string(),
  id: z.string(),
  title: z.string().optional(),
});
const recordContract = {
  allowedActions: z.array(recordAction),
  issues: z.array(recordIssue),
  owner: recordOwner.optional(),
  links: z.array(recordLink),
};

export const contactPointView = z.object({
  id: z.uuid(),
  kind: contactKind,
  value: z.string(),
  normalized: z.string().nullable(),
  label: z.string().nullable(),
  isPrimary: z.boolean(),
  verified: z.boolean(),
  verifiedAt: isoDateTime.nullable(),
  source: z.string(),
  lowConfidence: z.boolean(),
});
export const preferenceView = z.object({
  id: z.uuid(),
  category: z.string(),
  value: z.string(),
  scopePropertyId: z.uuid().nullable(),
  source: z.string(),
  confirmedAt: isoDateTime.nullable(),
  version: z.number().int(),
});
export const alertView = z.object({
  id: z.uuid(),
  severity: alertSeverity,
  text: z.string(),
  audience: z.array(z.string()),
  visibility: z.enum(['shared', 'property_private']),
  propertyId: z.uuid().nullable(),
  activeFrom: z.string().nullable(),
  activeTo: z.string().nullable(),
  status: z.enum(['active', 'resolved']),
  version: z.number().int(),
});
export const noteView = z.object({
  id: z.uuid(),
  body: z.string(),
  visibility: z.enum(['shared', 'property_private', 'department']),
  propertyId: z.uuid().nullable(),
  department: z.string().nullable(),
  author: z.string(),
  createdAt: isoDateTime,
  supersedesId: z.uuid().nullable(),
  superseded: z.boolean(),
  redacted: z.boolean(),
});
export const consentView = z.object({
  legalEntityId: z.uuid(),
  purpose: consentPurpose,
  state: consentState,
  source: z.string(),
  changedAt: isoDateTime,
  legalBasis: z.enum(['consent', 'contract', 'legal_obligation', 'legitimate_interests']),
  mayProcess: z.boolean(),
});
export const documentView = z.object({
  id: z.uuid(),
  type: documentType,
  issuingCountry: z.string(),
  expiryDate: z.string().nullable(),
  expired: z.boolean(),
  propertyId: z.uuid(),
  /** Never the number — reveal it with guests.document.read (audited). */
  numberMasked: z.literal('••••••'),
  hasImage: z.boolean(),
  retainUntil: z.string(),
});
export const specialNeedView = z.object({
  id: z.uuid(),
  category: z.string(),
  propertyId: z.uuid(),
  guestAgreedText: z.string().nullable(),
  /** Detail is only returned by the audited sensitive read. */
  detailAvailable: z.boolean(),
});
export const relationshipView = z.object({
  id: z.uuid(),
  relatedProfileId: z.uuid(),
  kind: relationshipKind,
  direction: z.enum(['outgoing', 'incoming']),
});

export const guestProfile = z.object({
  id: z.uuid(),
  /** Separate status families (never merged into one field). */
  status: z.object({ profile: profileStatus, privacy: z.enum(['normal', 'legal_hold']) }),
  ...recordContract,
  /** Set when the requested id was merged: the chain of ids followed to reach this survivor. */
  resolvedFrom: z.array(z.uuid()).optional(),
  visibility: z.enum(['full', 'shared']),
  provenance,
  external: z.object({ systemName: z.string(), lastSyncedAt: isoDateTime }).nullable(),
  title: z.string().nullable(),
  givenName: z.string().nullable(),
  middleName: z.string().nullable(),
  familyName: z.string(),
  nativeGivenName: z.string().nullable(),
  nativeFamilyName: z.string().nullable(),
  nativeScript: z.string().nullable(),
  preferredName: z.string().nullable(),
  displayName: z.string(),
  language: z.string().nullable(),
  nationality: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  vipLevel: z.string().nullable(),
  tags: z.array(z.string()),
  importantDates: z.array(importantDate),
  homePropertyId: z.uuid(),
  knownAtPropertyIds: z.array(z.uuid()),
  legalHold: z.boolean(),
  contactPoints: z.array(contactPointView),
  preferences: z.array(preferenceView),
  alerts: z.array(alertView),
  notes: z.array(noteView),
  relationships: z.array(relationshipView),
  companies: z.array(z.object({ companyId: z.uuid(), role: companyContactRole })),
  consents: z.array(consentView),
  documents: z.array(documentView),
  specialNeeds: z.array(specialNeedView),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  version: z.number().int(),
});
export type GuestProfile = z.infer<typeof guestProfile>;

export const matchReason = z.object({ code: z.string(), detail: z.string() });
export const duplicateSuggestion = z.object({
  profileId: z.uuid(),
  score: z.number(),
  band: z.enum(['high', 'medium', 'low', 'none']),
  reasons: z.array(matchReason),
});

export const createProfileResult = z.object({
  profile: guestProfile,
  created: z.boolean(),
  possibleDuplicates: z.array(duplicateSuggestion),
});

export const searchResult = z.object({
  items: z.array(
    z.object({
      profileId: z.uuid(),
      displayName: z.string(),
      nativeName: z.string().nullable(),
      nationality: z.string().nullable(),
      dateOfBirth: z.string().nullable(),
      vipLevel: z.string().nullable(),
      primaryEmail: z.string().nullable(),
      primaryPhone: z.string().nullable(),
      visibility: z.enum(['full', 'shared']),
      matchedOn: z.string(),
      score: z.number(),
    }),
  ),
});
export type SearchResult = z.infer<typeof searchResult>;

export const duplicateCandidateView = z.object({
  id: z.uuid(),
  profileAId: z.uuid(),
  profileBId: z.uuid(),
  score: z.number(),
  reasons: z.array(matchReason),
  status: z.enum(['open', 'merged', 'dismissed']),
  detectedBy: z.string(),
  detectedAt: isoDateTime,
  resolutionReason: z.string().nullable(),
  mergeId: z.uuid().nullable(),
  version: z.number().int(),
});

export const fieldDecisionView = z.object({
  field: z.string(),
  survivorValue: z.string().nullable(),
  mergedValue: z.string().nullable(),
  chosen: z.enum(['survivor', 'merged']),
  changes: z.boolean(),
  rule: z.string(),
});

export const mergePreview = z.object({
  survivorId: z.uuid(),
  mergedId: z.uuid(),
  fields: z.array(fieldDecisionView),
  children: z.record(z.string(), z.object({ move: z.number().int(), keepOnMerged: z.number().int() })),
  references: z.array(
    z.object({
      module: z.string(),
      count: z.number().int().nullable(),
      status: z.enum(['counted', 'unavailable']),
    }),
  ),
  warnings: z.array(z.string()),
});

export const mergeView = z.object({
  id: z.uuid(),
  survivorId: z.uuid(),
  mergedId: z.uuid(),
  status: z.enum(['active', 'reversed', 'erased']),
  reason: z.string(),
  mergedAt: isoDateTime,
  mergedBy: z.string(),
  reversedAt: isoDateTime.nullable(),
  reversedBy: z.string().nullable(),
  reverseReason: z.string().nullable(),
  moved: z.record(z.string(), z.number().int()),
  referencesRepointed: z.record(z.string(), z.number().int()),
  unmergeResult: z.unknown().nullable(),
  version: z.number().int(),
});

export const postMergeItem = z.object({
  kind: z.string(),
  id: z.uuid(),
  summary: z.string(),
  createdAt: isoDateTime,
  suggestedOwner: z.enum(['survivor', 'restored']),
  reason: z.string(),
});
export const unmergePreview = z.object({
  mergeId: z.uuid(),
  canUnmerge: z.boolean(),
  blockedReason: z.string().nullable(),
  postMergeItems: z.array(postMergeItem),
  fieldRestores: z.array(z.object({ field: z.string(), restoreTo: z.string().nullable() })),
  fieldConflicts: z.array(
    z.object({ field: z.string(), mergeValue: z.string().nullable(), currentValue: z.string().nullable() }),
  ),
  referencesToRestore: z.record(z.string(), z.number().int()),
});

export const stayHistoryItem = z.object({
  stayId: z.uuid(),
  bookingId: z.uuid().nullable(),
  propertyId: z.uuid(),
  role: stayRole,
  arrival: z.string(),
  departure: z.string(),
  nights: z.number().int(),
  status: z.string(),
  unitTypeId: z.uuid().nullable(),
  ratePlanId: z.uuid().nullable(),
  companyId: z.uuid().nullable(),
  revenue: z.object({ amountMinor: z.number().int(), currency: z.string() }).nullable(),
  revenueProvenance: z.string(),
});
export const stayHistoryView = z.object({
  items: z.array(stayHistoryItem),
  summary: z.object({
    stays: z.number().int(),
    nights: z.number().int(),
    lastStay: z.object({ propertyId: z.uuid(), arrival: z.string(), departure: z.string() }).nullable(),
    spend: z.array(z.object({ currency: z.string(), amountMinor: z.number().int() })),
    spendProvenance: z.literal('incomplete'),
  }),
  communications: z.object({ status: z.enum(['connected', 'not_connected']), items: z.array(z.unknown()) }),
});

export const recognitionSummary = z.object({
  profileId: z.uuid(),
  displayName: z.string(),
  nativeName: z.string().nullable(),
  vipLevel: z.string().nullable(),
  returningGuest: z.boolean(),
  staysAtProperty: z.number().int(),
  staysInOrganization: z.number().int(),
  lastStay: z.object({ propertyId: z.uuid(), arrival: z.string(), departure: z.string() }).nullable(),
  criticalAlerts: z.array(z.object({ id: z.uuid(), text: z.string(), severity: alertSeverity })),
  keyPreferences: z.array(z.object({ category: z.string(), value: z.string() })),
  importantDates: z.array(importantDate),
  language: z.string().nullable(),
});

export const companyView = z.object({
  id: z.uuid(),
  status: z.object({ company: companyStatus }),
  ...recordContract,
  kind: companyKind,
  legalName: z.string(),
  tradingName: z.string().nullable(),
  taxId: z.string().nullable(),
  iataCode: z.string().nullable(),
  parentCompanyId: z.uuid().nullable(),
  defaultMarketSegment: z.string().nullable(),
  commission: commissionTerms,
  arAccountRef: z.uuid().nullable(),
  billingAddress: z.record(z.string(), z.string()),
  billingEmail: z.string().nullable(),
  notes: z.string().nullable(),
  provenance,
  contacts: z.array(z.object({ id: z.uuid(), profileId: z.uuid(), role: companyContactRole })),
  version: z.number().int(),
});
export type CompanyView = z.infer<typeof companyView>;

export const privacyRequestView = z.object({
  id: z.uuid(),
  kind: z.enum(['export', 'erasure']),
  profileId: z.uuid(),
  status: z.enum(['received', 'in_progress', 'completed', 'rejected', 'on_hold']),
  reason: z.string(),
  receivedAt: isoDateTime,
  completedAt: isoDateTime.nullable(),
  rejectionReason: z.string().nullable(),
  result: z.unknown().nullable(),
});

export const revealedDocument = z.object({
  id: z.uuid(),
  type: documentType,
  issuingCountry: z.string(),
  number: z.string(),
  expiryDate: z.string().nullable(),
  issueDate: z.string().nullable(),
  surname: z.string().nullable(),
  givenNames: z.string().nullable(),
  nationality: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
});
