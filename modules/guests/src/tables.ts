import type { ColumnType, Generated } from '@portico/db';

type Json = ColumnType<unknown, string, string>;
type JsonDefault = ColumnType<unknown, string | undefined, string>;
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface ProfilesTable {
  id: string;
  tenant_id: string;
  status: Generated<'active' | 'merged' | 'anonymized'>;
  merged_into: string | null;
  title: string | null;
  given_name: string | null;
  middle_name: string | null;
  family_name: string;
  native_given_name: string | null;
  native_family_name: string | null;
  native_script: string | null;
  preferred_name: string | null;
  search_name: string;
  search_name_native: string | null;
  language: string | null;
  nationality: string | null;
  date_of_birth: string | null;
  vip_level: string | null;
  tags: Generated<string[]>;
  important_dates: JsonDefault;
  home_property_id: string;
  provenance: Generated<'live' | 'copied' | 'external'>;
  source: JsonDefault;
  legal_hold: Generated<boolean>;
  anonymized_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface ProfilePropertiesTable {
  tenant_id: string;
  profile_id: string;
  property_id: string;
  first_seen_at: Timestamp;
  source: 'created' | 'stay' | 'resolved' | 'mirror' | 'merge' | 'manual';
}

export interface ContactPointsTable {
  id: string;
  tenant_id: string;
  profile_id: string;
  kind: 'email' | 'phone' | 'whatsapp' | 'address';
  value: string;
  normalized: string | null;
  label: string | null;
  is_primary: Generated<boolean>;
  verified: Generated<boolean>;
  verified_at: Date | null;
  verification_method: string | null;
  source: string;
  low_confidence: Generated<boolean>;
  requested_profile_id: string | null;
  created_at: Generated<Date>;
  version: Generated<number>;
}

export interface PreferencesTable {
  id: string;
  tenant_id: string;
  profile_id: string;
  category: string;
  value: string;
  scope_property_id: string | null;
  source: string;
  confirmed_at: Date | null;
  requested_profile_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface AlertsTable {
  id: string;
  tenant_id: string;
  profile_id: string;
  property_id: string | null;
  severity: 'info' | 'important' | 'critical';
  text: string;
  audience: Generated<string[]>;
  visibility: 'shared' | 'property_private';
  active_from: string | null;
  active_to: string | null;
  status: Generated<'active' | 'resolved'>;
  source: Generated<string>;
  requested_profile_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface NotesTable {
  id: string;
  tenant_id: string;
  profile_id: string;
  property_id: string | null;
  department: string | null;
  visibility: 'shared' | 'property_private' | 'department';
  body: string;
  author: Json;
  author_key: string;
  supersedes_id: string | null;
  superseded_at: Date | null;
  redacted_at: Date | null;
  requested_profile_id: string | null;
  created_at: Generated<Date>;
}

export interface RelationshipsTable {
  id: string;
  tenant_id: string;
  profile_id: string;
  related_profile_id: string;
  kind: string;
  note: string | null;
  created_at: Generated<Date>;
}

export interface IdentityDocumentsTable {
  id: string;
  tenant_id: string;
  profile_id: string;
  property_id: string;
  doc_type: 'passport' | 'national_id' | 'residence_permit' | 'driving_licence' | 'other';
  issuing_country: string;
  enc_payload: string;
  key_id: string;
  number_hash: string;
  last4_hash: string;
  expiry_date: string | null;
  image_ref: string | null;
  retain_until: string;
  requested_profile_id: string | null;
  created_at: Generated<Date>;
  created_by: string;
  version: Generated<number>;
}

export interface SpecialNeedsTable {
  id: string;
  tenant_id: string;
  profile_id: string;
  property_id: string;
  category: 'allergy' | 'medical' | 'mobility' | 'dietary_medical' | 'other';
  enc_detail: string;
  key_id: string;
  alert_id: string | null;
  guest_agreed_text: string | null;
  requested_profile_id: string | null;
  created_at: Generated<Date>;
  created_by: string;
  version: Generated<number>;
}

export interface ConsentsTable {
  id: string;
  tenant_id: string;
  profile_id: string;
  legal_entity_id: string;
  purpose: string;
  state: 'granted' | 'withdrawn' | 'unknown';
  source: string;
  evidence: JsonDefault;
  changed_at: Timestamp;
  requested_profile_id: string | null;
  created_at: Generated<Date>;
  version: Generated<number>;
}

export interface ConsentEventsTable {
  id: string;
  tenant_id: string;
  consent_id: string;
  legal_entity_id: string;
  purpose: string;
  state: string;
  source: string;
  evidence: JsonDefault;
  occurred_at: Timestamp;
  actor_key: string;
}

export interface CompaniesTable {
  id: string;
  tenant_id: string;
  kind: 'company' | 'agency';
  legal_name: string;
  trading_name: string | null;
  search_name: string;
  tax_id: string | null;
  iata_code: string | null;
  parent_company_id: string | null;
  status: Generated<'active' | 'on_hold' | 'inactive'>;
  default_market_segment: string | null;
  commission: JsonDefault;
  ar_account_ref: string | null;
  billing_address: JsonDefault;
  billing_email: string | null;
  notes: string | null;
  home_property_id: string | null;
  provenance: Generated<'live' | 'copied' | 'external'>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface CompanyContactsTable {
  id: string;
  tenant_id: string;
  company_id: string;
  profile_id: string;
  role: 'primary' | 'booker' | 'billing' | 'travel_manager' | 'other';
  created_at: Generated<Date>;
}

export interface StayHistoryTable {
  id: string;
  tenant_id: string;
  profile_id: string;
  stay_id: string;
  booking_id: string | null;
  property_id: string;
  role: 'occupant' | 'booker' | 'payer';
  arrival: string;
  departure: string;
  status: string;
  unit_type_id: string | null;
  rate_plan_id: string | null;
  company_id: string | null;
  revenue_minor: number | null;
  revenue_currency: string | null;
  revenue_provenance: Generated<'live' | 'incomplete' | 'copied' | 'external'>;
  requested_profile_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface ExternalRefsTable {
  id: string;
  tenant_id: string;
  entity_type: 'profile' | 'company';
  entity_id: string;
  connection_id: string;
  system_name: string;
  external_id: string;
  last_synced_at: Timestamp;
}

export interface DuplicateCandidatesTable {
  id: string;
  tenant_id: string;
  profile_a_id: string;
  profile_b_id: string;
  score: ColumnType<string, number | string, number | string>;
  reasons: Json;
  exact_keys: Generated<string[]>;
  status: Generated<'open' | 'merged' | 'dismissed'>;
  detected_by: string;
  detected_at: Timestamp;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution_reason: string | null;
  merge_id: string | null;
  version: Generated<number>;
}

export interface MergesTable {
  id: string;
  tenant_id: string;
  survivor_id: string;
  merged_id: string;
  status: Generated<'active' | 'reversed' | 'erased'>;
  reason: string;
  snapshot: Json;
  decisions: Json;
  moved: Json;
  survivor_updates: JsonDefault;
  merged_at: Timestamp;
  merged_by: string;
  reversed_at: Date | null;
  reversed_by: string | null;
  reverse_reason: string | null;
  unmerge_result: ColumnType<unknown, string | null | undefined, string | null>;
  version: Generated<number>;
}

export interface MergeReferenceRepointsTable {
  id: string;
  tenant_id: string;
  merge_id: string;
  module: string;
  ref_type: string;
  ref_id: string;
  field: string | null;
  recorded_at: Timestamp;
}

export interface PrivacyRequestsTable {
  id: string;
  tenant_id: string;
  kind: 'export' | 'erasure';
  profile_id: string;
  status: 'received' | 'in_progress' | 'completed' | 'rejected' | 'on_hold';
  reason: string;
  requested_by: string;
  received_at: Timestamp;
  completed_at: Date | null;
  rejection_reason: string | null;
  result: ColumnType<unknown, string | null | undefined, string | null>;
  version: Generated<number>;
}

export interface GuestsDB {
  'guests.profiles': ProfilesTable;
  'guests.profile_properties': ProfilePropertiesTable;
  'guests.contact_points': ContactPointsTable;
  'guests.preferences': PreferencesTable;
  'guests.alerts': AlertsTable;
  'guests.notes': NotesTable;
  'guests.relationships': RelationshipsTable;
  'guests.identity_documents': IdentityDocumentsTable;
  'guests.special_needs': SpecialNeedsTable;
  'guests.consents': ConsentsTable;
  'guests.consent_events': ConsentEventsTable;
  'guests.companies': CompaniesTable;
  'guests.company_contacts': CompanyContactsTable;
  'guests.stay_history': StayHistoryTable;
  'guests.external_refs': ExternalRefsTable;
  'guests.duplicate_candidates': DuplicateCandidatesTable;
  'guests.merges': MergesTable;
  'guests.merge_reference_repoints': MergeReferenceRepointsTable;
  'guests.privacy_requests': PrivacyRequestsTable;
}
