-- guests: guest profiles, companies & agencies, contacts, preferences, alerts, notes, consent, identity documents
-- (field-encrypted), stay history projection, duplicates, reversible merges, privacy requests.
-- No foreign keys into other schemas: property, legal-entity, stay and folio ids are plain references.
create schema guests;

---------------------------------------------------------------------------------------------------------
-- Profiles (organization-wide; visibility per property is decided by links + sharing policy)
---------------------------------------------------------------------------------------------------------
create table guests.profiles (
  id                  uuid primary key,
  tenant_id           uuid not null,
  status              text not null default 'active' check (status in ('active', 'merged', 'anonymized')),
  merged_into         uuid references guests.profiles(id),
  title               text,
  given_name          text,
  middle_name         text,
  family_name         text not null,
  native_given_name   text,
  native_family_name  text,
  native_script       text,
  preferred_name      text,
  -- Matching keys (normalized; see src/domain/names.ts). Trigram-indexed for search and fuzzy duplicates.
  search_name         text not null,
  search_name_native  text,
  language            text,
  nationality         char(2),
  date_of_birth       date,
  vip_level           text,
  tags                text[] not null default '{}',
  important_dates     jsonb not null default '[]',
  -- Property where the profile originated; the data-authority check for identity edits runs against it.
  home_property_id    uuid not null,
  -- live | copied (trial) | external (mirrored from another system of record)
  provenance          text not null default 'live' check (provenance in ('live', 'copied', 'external')),
  source              jsonb not null default '{}',
  legal_hold          boolean not null default false,
  anonymized_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             int not null default 1,
  check ((status = 'merged') = (merged_into is not null)),
  check (merged_into is null or merged_into <> id)
);
create index profiles_search_name_trgm on guests.profiles using gin (search_name gin_trgm_ops);
create index profiles_search_native_trgm on guests.profiles using gin (search_name_native gin_trgm_ops);
create index profiles_merged_into_idx on guests.profiles (merged_into) where merged_into is not null;
create index profiles_dob_idx on guests.profiles (tenant_id, date_of_birth) where date_of_birth is not null;
select core.enable_tenant_isolation('guests.profiles');

-- Properties at which a profile is known (created, booked, stayed). Drives property-level visibility.
create table guests.profile_properties (
  tenant_id     uuid not null,
  profile_id    uuid not null references guests.profiles(id),
  property_id   uuid not null,
  first_seen_at timestamptz not null,
  source        text not null check (source in ('created', 'stay', 'resolved', 'mirror', 'merge', 'manual')),
  primary key (profile_id, property_id)
);
create index profile_properties_property_idx on guests.profile_properties (tenant_id, property_id);
select core.enable_tenant_isolation('guests.profile_properties');

create table guests.contact_points (
  id                  uuid primary key,
  tenant_id           uuid not null,
  profile_id          uuid not null references guests.profiles(id),
  kind                text not null check (kind in ('email', 'phone', 'whatsapp', 'address')),
  value               text not null,
  -- Normalized match key (lower-cased email / E.164 phone). NULL when it cannot be normalized safely.
  normalized          text,
  label               text,
  is_primary          boolean not null default false,
  verified            boolean not null default false,
  verified_at         timestamptz,
  verification_method text,
  source              text not null,
  -- OTA proxy emails and unparseable phones: stored, shown, never used as exact match keys.
  low_confidence      boolean not null default false,
  requested_profile_id uuid,
  created_at          timestamptz not null default now(),
  version             int not null default 1
);
create unique index contact_points_unique on guests.contact_points (profile_id, kind, coalesce(normalized, lower(value)));
create index contact_points_match_idx on guests.contact_points (tenant_id, normalized) where not low_confidence;
select core.enable_tenant_isolation('guests.contact_points');

create table guests.preferences (
  id                uuid primary key,
  tenant_id         uuid not null,
  profile_id        uuid not null references guests.profiles(id),
  category          text not null,
  value             text not null,
  -- NULL = applies at all properties; otherwise only at that property (and not shared).
  scope_property_id uuid,
  source            text not null,
  confirmed_at      timestamptz,
  requested_profile_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           int not null default 1
);
create index preferences_profile_idx on guests.preferences (profile_id);
select core.enable_tenant_isolation('guests.preferences');

create table guests.alerts (
  id            uuid primary key,
  tenant_id     uuid not null,
  profile_id    uuid not null references guests.profiles(id),
  property_id   uuid,
  severity      text not null check (severity in ('info', 'important', 'critical')),
  text          text not null,
  audience      text[] not null default '{}',
  visibility    text not null check (visibility in ('shared', 'property_private')),
  active_from   date,
  active_to     date,
  status        text not null default 'active' check (status in ('active', 'resolved')),
  source        text not null default 'staff',
  requested_profile_id uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       int not null default 1,
  check (visibility = 'shared' or property_id is not null),
  check (active_to is null or active_from is null or active_to >= active_from)
);
create index alerts_profile_idx on guests.alerts (profile_id);
select core.enable_tenant_isolation('guests.alerts');

-- Notes are never edited in place: a revision is a new row that supersedes the old one (history visible).
create table guests.notes (
  id            uuid primary key,
  tenant_id     uuid not null,
  profile_id    uuid not null references guests.profiles(id),
  property_id   uuid,
  department    text,
  visibility    text not null check (visibility in ('shared', 'property_private', 'department')),
  body          text not null,
  author        jsonb not null,
  author_key    text not null,
  supersedes_id uuid references guests.notes(id),
  superseded_at timestamptz,
  redacted_at   timestamptz,
  requested_profile_id uuid,
  created_at    timestamptz not null default now(),
  check (visibility = 'shared' or property_id is not null),
  check (visibility <> 'department' or department is not null)
);
create index notes_profile_idx on guests.notes (profile_id);
select core.enable_tenant_isolation('guests.notes');

-- Guard: note content is immutable. Only re-pointing (merge/unmerge), superseding and erasure redaction may change.
create or replace function guests.guard_note_update() returns trigger
  language plpgsql as $$
begin
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.author <> old.author
     or new.created_at <> old.created_at or new.visibility <> old.visibility
     or new.property_id is distinct from old.property_id
     or new.supersedes_id is distinct from old.supersedes_id then
    raise exception 'guests.notes rows are immutable; write a revision instead' using errcode = 'P0001';
  end if;
  if new.body <> old.body and (new.redacted_at is null or new.body <> '[redacted]') then
    raise exception 'guests.notes body can only change by erasure redaction' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger guard_note_update before update on guests.notes
  for each row execute function guests.guard_note_update();
create or replace function guests.reject_note_delete() returns trigger
  language plpgsql as $$
begin
  raise exception 'guests.notes rows cannot be deleted; erasure redacts them' using errcode = 'P0001';
end $$;
create trigger reject_note_delete before delete on guests.notes
  for each row execute function guests.reject_note_delete();

create table guests.relationships (
  id                 uuid primary key,
  tenant_id          uuid not null,
  profile_id         uuid not null references guests.profiles(id),
  related_profile_id uuid not null references guests.profiles(id),
  kind               text not null check (kind in ('spouse', 'partner', 'child', 'parent', 'sibling', 'assistant',
                                                   'employer_contact', 'travel_companion', 'other')),
  note               text,
  created_at         timestamptz not null default now(),
  unique (profile_id, related_profile_id, kind),
  check (profile_id <> related_profile_id)
);
create index relationships_related_idx on guests.relationships (related_profile_id);
select core.enable_tenant_isolation('guests.relationships');

---------------------------------------------------------------------------------------------------------
-- Sensitive data: identity documents and special needs (field-encrypted via the FieldCipher port)
---------------------------------------------------------------------------------------------------------
create table guests.identity_documents (
  id               uuid primary key,
  tenant_id        uuid not null,
  profile_id       uuid not null references guests.profiles(id),
  property_id      uuid not null,      -- captured at; never shared to other properties (Q46)
  doc_type         text not null check (doc_type in ('passport', 'national_id', 'residence_permit', 'driving_licence', 'other')),
  issuing_country  char(2) not null,
  -- Envelope-encrypted JSON {number, surname?, givenNames?, nationality?, dateOfBirth?, issueDate?}.
  -- AAD binds the ciphertext to tenant + row id.
  enc_payload      text not null,
  key_id           text not null,
  -- Keyed blind indexes (HMAC); never the number itself (GUE-I04).
  number_hash      text not null,
  last4_hash       text not null,
  expiry_date      date,
  image_ref        text,
  retain_until     date not null,
  requested_profile_id uuid,
  created_at       timestamptz not null default now(),
  created_by       text not null,
  version          int not null default 1,
  unique (profile_id, number_hash)
);
create index identity_documents_hash_idx on guests.identity_documents (tenant_id, number_hash);
create index identity_documents_last4_idx on guests.identity_documents (tenant_id, last4_hash);
create index identity_documents_retention_idx on guests.identity_documents (tenant_id, retain_until);
select core.enable_tenant_isolation('guests.identity_documents');

create table guests.special_needs (
  id                 uuid primary key,
  tenant_id          uuid not null,
  profile_id         uuid not null references guests.profiles(id),
  property_id        uuid not null,
  category           text not null check (category in ('allergy', 'medical', 'mobility', 'dietary_medical', 'other')),
  enc_detail         text not null,
  key_id             text not null,
  alert_id           uuid references guests.alerts(id),
  guest_agreed_text  text,
  requested_profile_id uuid,
  created_at         timestamptz not null default now(),
  created_by         text not null,
  version            int not null default 1
);
create index special_needs_profile_idx on guests.special_needs (profile_id);
select core.enable_tenant_isolation('guests.special_needs');

---------------------------------------------------------------------------------------------------------
-- Consent per purpose per legal entity (+ append-only evidence history)
---------------------------------------------------------------------------------------------------------
create table guests.consents (
  id              uuid primary key,
  tenant_id       uuid not null,
  profile_id      uuid not null references guests.profiles(id),
  legal_entity_id uuid not null,
  purpose         text not null check (purpose in ('marketing_email', 'marketing_sms', 'marketing_whatsapp',
                                                   'profiling', 'cross_property_sharing')),
  state           text not null check (state in ('granted', 'withdrawn', 'unknown')),
  source          text not null,
  -- Minimal evidence only: {textVersion, channel, capturedAt}. Free text (e.g. an IP or ticket reference) is kept
  -- in evidence_reference, which erasure clears.
  evidence        jsonb not null default '{}',
  evidence_reference text,
  changed_at      timestamptz not null,
  requested_profile_id uuid,
  created_at      timestamptz not null default now(),
  version         int not null default 1,
  unique (profile_id, legal_entity_id, purpose)
);
create index consents_purpose_idx on guests.consents (tenant_id, purpose, state);
select core.enable_tenant_isolation('guests.consents');

create table guests.consent_events (
  id              uuid primary key,
  tenant_id       uuid not null,
  consent_id      uuid not null references guests.consents(id),
  legal_entity_id uuid not null,
  purpose         text not null,
  state           text not null,
  source          text not null,
  evidence        jsonb not null default '{}',   -- minimal: {textVersion, channel, capturedAt}
  reference       text,                          -- free text; the only column erasure may clear
  occurred_at     timestamptz not null,
  actor_key       text not null
);
create index consent_events_consent_idx on guests.consent_events (consent_id, occurred_at);
select core.enable_tenant_isolation('guests.consent_events');

-- Consent evidence history is append-only except for erasure clearing the free-text reference.
create or replace function guests.guard_consent_event_update() returns trigger
  language plpgsql as $$
begin
  if new.reference is not null
     or (to_jsonb(new) - 'reference') is distinct from (to_jsonb(old) - 'reference') then
    raise exception 'guests.consent_events is append-only; only erasure may clear the reference'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger guard_consent_event_update before update on guests.consent_events
  for each row execute function guests.guard_consent_event_update();
create trigger reject_consent_event_delete before delete on guests.consent_events
  for each row execute function core.reject_mutation();

---------------------------------------------------------------------------------------------------------
-- Companies and travel agents (kind = agency) + contacts
---------------------------------------------------------------------------------------------------------
create table guests.companies (
  id                     uuid primary key,
  tenant_id              uuid not null,
  kind                   text not null check (kind in ('company', 'agency')),
  legal_name             text not null,
  trading_name           text,
  search_name            text not null,
  tax_id                 text,
  iata_code              text,
  parent_company_id      uuid references guests.companies(id),
  status                 text not null default 'active' check (status in ('active', 'on_hold', 'inactive')),
  default_market_segment text,
  commission             jsonb not null default '{"model":"none"}',
  ar_account_ref         uuid,           -- finance receivables account (reference only)
  billing_address        jsonb not null default '{}',
  billing_email          text,
  notes                  text,
  home_property_id       uuid,
  provenance             text not null default 'live' check (provenance in ('live', 'copied', 'external')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  version                int not null default 1,
  check (parent_company_id is null or parent_company_id <> id)
);
create unique index companies_tax_id_unique on guests.companies (tenant_id, upper(tax_id)) where tax_id is not null;
create unique index companies_iata_unique on guests.companies (tenant_id, iata_code) where iata_code is not null;
create index companies_search_trgm on guests.companies using gin (search_name gin_trgm_ops);
select core.enable_tenant_isolation('guests.companies');

create table guests.company_contacts (
  id          uuid primary key,
  tenant_id   uuid not null,
  company_id  uuid not null references guests.companies(id),
  profile_id  uuid not null references guests.profiles(id),
  role        text not null check (role in ('primary', 'booker', 'billing', 'travel_manager', 'other')),
  created_at  timestamptz not null default now(),
  unique (company_id, profile_id, role)
);
create index company_contacts_profile_idx on guests.company_contacts (profile_id);
select core.enable_tenant_isolation('guests.company_contacts');

---------------------------------------------------------------------------------------------------------
-- Stay history projection (fed by reservations via recordStayHistory)
---------------------------------------------------------------------------------------------------------
create table guests.stay_history (
  id                  uuid primary key,
  tenant_id           uuid not null,
  profile_id          uuid not null references guests.profiles(id),
  stay_id             uuid not null,
  booking_id          uuid,
  property_id         uuid not null,
  role                text not null check (role in ('occupant', 'booker', 'payer')),
  arrival             date not null,
  departure           date not null,
  status              text not null,
  unit_type_id        uuid,
  rate_plan_id        uuid,
  company_id          uuid,
  -- Spend placeholder until finance feeds revenue: integer minor units + ISO currency.
  revenue_minor       bigint,
  revenue_currency    char(3),
  revenue_provenance  text not null default 'incomplete' check (revenue_provenance in ('live', 'incomplete', 'copied', 'external')),
  requested_profile_id uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             int not null default 1,
  unique (profile_id, stay_id, role),
  check (departure > arrival),
  check ((revenue_minor is null) = (revenue_currency is null))
);
create index stay_history_profile_idx on guests.stay_history (profile_id, arrival desc);
create index stay_history_stay_idx on guests.stay_history (tenant_id, stay_id);
select core.enable_tenant_isolation('guests.stay_history');

---------------------------------------------------------------------------------------------------------
-- Connected mode: mirror mapping to an external system of record
---------------------------------------------------------------------------------------------------------
create table guests.external_refs (
  id             uuid primary key,
  tenant_id      uuid not null,
  entity_type    text not null check (entity_type in ('profile', 'company')),
  entity_id      uuid not null,
  connection_id  uuid not null,
  system_name    text not null,
  external_id    text not null,
  last_synced_at timestamptz not null,
  unique (tenant_id, connection_id, entity_type, external_id)
);
create index external_refs_entity_idx on guests.external_refs (entity_id);
select core.enable_tenant_isolation('guests.external_refs');

---------------------------------------------------------------------------------------------------------
-- Duplicates and reversible merges
---------------------------------------------------------------------------------------------------------
create table guests.duplicate_candidates (
  id             uuid primary key,
  tenant_id      uuid not null,
  profile_a_id   uuid not null references guests.profiles(id),
  profile_b_id   uuid not null references guests.profiles(id),
  score          numeric(3, 2) not null check (score >= 0 and score <= 1),
  reasons        jsonb not null,
  -- Matched exact keys as keyed blind-index hashes (`email:<hmac>`), never plaintext values.
  exact_keys     text[] not null default '{}',
  status         text not null default 'open' check (status in ('open', 'merged', 'dismissed')),
  detected_by    text not null,
  detected_at    timestamptz not null,
  resolved_at    timestamptz,
  resolved_by    text,
  resolution_reason text,
  merge_id       uuid,
  version        int not null default 1,
  unique (profile_a_id, profile_b_id),
  check (profile_a_id < profile_b_id)
);
create index duplicate_candidates_open_idx on guests.duplicate_candidates (tenant_id, status, score desc);
select core.enable_tenant_isolation('guests.duplicate_candidates');

create table guests.merges (
  id               uuid primary key,
  tenant_id        uuid not null,
  survivor_id      uuid not null references guests.profiles(id),
  merged_id        uuid not null references guests.profiles(id),
  -- active → reversed (unmerge) | erased (survivor anonymized: snapshots redacted, no longer reversible)
  status           text not null default 'active' check (status in ('active', 'reversed', 'erased')),
  reason           text not null,
  -- Full pre-merge snapshots of both profiles and every child row (GUE-I02).
  snapshot         jsonb not null,
  decisions        jsonb not null,
  -- Child rows moved from merged → survivor, by table: {"contact_points": [ids], ...}
  moved            jsonb not null,
  -- Survivor child rows updated by the merge, with before/after for exact reversal.
  survivor_updates jsonb not null default '[]',
  merged_at        timestamptz not null,
  merged_by        text not null,
  reversed_at      timestamptz,
  reversed_by      text,
  reverse_reason   text,
  unmerge_result   jsonb,
  version          int not null default 1,
  check (survivor_id <> merged_id)
);
create index merges_survivor_idx on guests.merges (survivor_id, status);
create index merges_merged_idx on guests.merges (merged_id, status);
-- At most one active merge per merged profile.
create unique index merges_one_active_per_merged on guests.merges (merged_id) where status = 'active';
select core.enable_tenant_isolation('guests.merges');

-- References in OTHER modules re-pointed because of a merge (GUE-I03). Reported by consumers of
-- guests.profile.merged; replayed to them in guests.profile.unmerged. Append-only.
create table guests.merge_reference_repoints (
  id           uuid primary key,
  tenant_id    uuid not null,
  merge_id     uuid not null references guests.merges(id),
  module       text not null,
  ref_type     text not null,
  ref_id       text not null,
  field        text,
  recorded_at  timestamptz not null,
  -- Idempotent re-delivery even when field is null.
  unique nulls not distinct (merge_id, module, ref_type, ref_id, field)
);
select core.enable_tenant_isolation('guests.merge_reference_repoints');

---------------------------------------------------------------------------------------------------------
-- Data-subject (privacy) requests
---------------------------------------------------------------------------------------------------------
create table guests.privacy_requests (
  id             uuid primary key,
  tenant_id      uuid not null,
  kind           text not null check (kind in ('export', 'erasure')),
  profile_id     uuid not null references guests.profiles(id),
  status         text not null check (status in ('received', 'in_progress', 'completed', 'rejected', 'on_hold')),
  reason         text not null,
  requested_by   text not null,
  received_at    timestamptz not null,
  completed_at   timestamptz,
  rejection_reason text,
  result         jsonb,
  version        int not null default 1
);
create index privacy_requests_profile_idx on guests.privacy_requests (profile_id);
select core.enable_tenant_isolation('guests.privacy_requests');

create trigger touch before update on guests.profiles for each row execute function core.touch_updated_at();
create trigger touch before update on guests.preferences for each row execute function core.touch_updated_at();
create trigger touch before update on guests.alerts for each row execute function core.touch_updated_at();
create trigger touch before update on guests.companies for each row execute function core.touch_updated_at();
create trigger touch before update on guests.stay_history for each row execute function core.touch_updated_at();

---------------------------------------------------------------------------------------------------------
-- Scheduled-job tenant discovery (routing metadata only — tenant ids, never business data). SECURITY DEFINER:
-- the owner (migration role) must bypass RLS; the job then works inside each tenant's RLS-scoped transaction.
---------------------------------------------------------------------------------------------------------
create or replace function guests.tenants_with_expired_documents(p_as_of date) returns table (tenant_id uuid)
  language sql stable security definer set search_path = guests, pg_temp as $$
    select distinct d.tenant_id from guests.identity_documents d where d.retain_until < p_as_of
$$;
create or replace function guests.tenants_with_active_profiles() returns table (tenant_id uuid)
  language sql stable security definer set search_path = guests, pg_temp as $$
    select distinct p.tenant_id from guests.profiles p where p.status = 'active'
$$;

select core.apply_standard_grants('guests');
revoke execute on function guests.tenants_with_expired_documents(date), guests.tenants_with_active_profiles()
  from public;
grant execute on function guests.tenants_with_expired_documents(date), guests.tenants_with_active_profiles()
  to portico_app;
revoke update, delete, truncate on guests.consent_events from portico_app;
grant update (reference) on guests.consent_events to portico_app;
select core.make_append_only('guests.merge_reference_repoints');
-- Notes: deletes are never allowed (redaction instead); updates are restricted by guard_note_update.
revoke delete, truncate on guests.notes from portico_app;
