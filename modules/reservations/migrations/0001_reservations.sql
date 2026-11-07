-- Reservations: bookings, stays, segments, occupants, agreed terms, change previews, check-in/out workflows,
-- channel revisions, relocation cases, issues, handover, forwarded changes (data authority).
-- No foreign keys into other modules' schemas: unit types, units, rate plans, profiles, properties and
-- folios are referenced by id only (modules stay extractable).
create schema reservations;

---------------------------------------------------------------------------------------------------------
-- Bookings (aggregate root; version = optimistic concurrency token for the booking and all its stays)
---------------------------------------------------------------------------------------------------------
create table reservations.bookings (
  id                     uuid primary key,
  tenant_id              uuid not null,
  property_id            uuid not null,
  code                   text not null check (code ~ '^[2-9A-HJKMNP-TV-Z]{8}$'),
  status                 text not null check (status in ('inquiry', 'quoted', 'held', 'tentative', 'confirmed',
                                                         'cancelled', 'declined', 'expired', 'completed')),
  booker_kind            text not null check (booker_kind in ('profile', 'company', 'agency', 'channel')),
  booker_profile_id      uuid,
  booker_name            text,
  company_id             uuid,
  agency_id              uuid,
  source                 text not null check (source in ('direct_phone', 'direct_email', 'walk_in', 'booking_engine',
                                                         'channel', 'agency', 'company', 'group', 'import')),
  channel_connection_id  uuid,
  channel_external_id    text,
  external_refs          jsonb not null default '{}',
  market_segment         text not null,
  commission             jsonb,
  guarantee              jsonb not null default '{"kind":"none"}',
  deposit_requirement    jsonb,
  billing                jsonb,
  option_date            date,
  hold_expires_at        timestamptz,
  owner_id               uuid,
  notes                  text,
  special_requests       jsonb not null default '[]',
  tags                   text[] not null default '{}',
  currency               char(3) not null,
  property_timezone      text not null,      -- copied from platform at creation: event instants (ETA) without a lookup
  cancellation           jsonb,
  created_by             text not null,
  created_by_name        text not null,
  created_at             timestamptz not null,
  updated_at             timestamptz not null,
  version                int not null default 1,
  unique (tenant_id, code),
  unique (tenant_id, id)
);
-- One booking per channel booking id per connection (RES-I06 at booking level).
create unique index bookings_channel_external_uq on reservations.bookings (tenant_id, channel_connection_id, channel_external_id)
  where channel_connection_id is not null and channel_external_id is not null;
create index bookings_property_idx on reservations.bookings (tenant_id, property_id, id desc);
select core.enable_tenant_isolation('reservations.bookings');

-- Booking state per version (for 409 diffs: "what changed and who changed it" — scenario S14). Append-only.
create table reservations.booking_versions (
  tenant_id    uuid not null,
  booking_id   uuid not null references reservations.bookings (id),
  version      int not null,
  state        jsonb not null,
  action       text not null,
  actor_key    text not null,
  actor_name   text not null,
  changed_at   timestamptz not null,
  primary key (tenant_id, booking_id, version)
);
select core.enable_tenant_isolation('reservations.booking_versions');
select core.make_append_only('reservations.booking_versions');

---------------------------------------------------------------------------------------------------------
-- Stays, segments, occupants
---------------------------------------------------------------------------------------------------------
create table reservations.stays (
  id                 uuid primary key,
  tenant_id          uuid not null,
  property_id        uuid not null,
  booking_id         uuid not null references reservations.bookings (id),
  position           int not null,          -- order of the stay within its booking (as entered)
  status             text not null check (status in ('expected', 'in_house', 'departed', 'cancelled', 'no_show', 'waitlisted')),
  commercial_type    text not null default 'standard' check (commercial_type in ('standard', 'complimentary', 'house_use')),
  commercial_reason  text,
  arrival            date not null,
  departure          date not null,
  block_id           uuid,               -- groups (wave 2): nullable block reference
  hold_id            text,               -- inventory hold while the booking is 'held'
  eta                text,
  etd                text,
  arrival_details    jsonb not null default '{}',
  requests           jsonb not null default '[]',
  notes              text,
  waitlist           jsonb,
  early_check_in     jsonb,
  late_check_out     jsonb,
  no_show            jsonb,
  checked_in_at      timestamptz,
  checked_out_at     timestamptz,
  created_at         timestamptz not null,
  updated_at         timestamptz not null,
  version            int not null default 1,
  check (departure > arrival),
  check (commercial_type = 'standard' or commercial_reason is not null)
);
create unique index stays_booking_position_uq on reservations.stays (tenant_id, booking_id, position);
create index stays_arrival_idx on reservations.stays (tenant_id, property_id, arrival);
create index stays_departure_idx on reservations.stays (tenant_id, property_id, departure);
create index stays_status_idx on reservations.stays (tenant_id, property_id, status);
select core.enable_tenant_isolation('reservations.stays');

-- Segments partition a stay's nights (RES-I01). The exclusion constraint makes overlap impossible; contiguity
-- and coverage are checked by the domain on every write.
create table reservations.stay_segments (
  id                 uuid primary key,
  tenant_id          uuid not null,
  stay_id            uuid not null references reservations.stays (id) on delete cascade,
  nights             daterange not null check (not isempty(nights) and lower_inc(nights) and not upper_inc(nights)),
  unit_type_id       uuid not null,
  rate_plan_id       uuid not null,
  adults             int not null check (adults >= 1),
  children_ages      int[] not null default '{}',
  terms_snapshot_id  uuid not null,
  unit_id            uuid,
  exclude using gist (stay_id with =, nights with &&)
);
create index stay_segments_unit_idx on reservations.stay_segments (tenant_id, unit_id) where unit_id is not null;
select core.enable_tenant_isolation('reservations.stay_segments');

create table reservations.occupants (
  id               uuid primary key,
  tenant_id        uuid not null,
  stay_id          uuid not null references reservations.stays (id) on delete cascade,
  position         int not null,          -- order as entered (primary first)
  profile_id       uuid,
  name             text,
  kind             text not null check (kind in ('adult', 'child')),
  age_at_arrival   int check (age_at_arrival is null or age_at_arrival between 0 and 17),
  is_primary       boolean not null default false
);
create unique index occupants_one_primary on reservations.occupants (stay_id) where is_primary;
create index occupants_profile_idx on reservations.occupants (tenant_id, profile_id);
select core.enable_tenant_isolation('reservations.occupants');

-- Agreed terms (RES-I04): immutable; a re-priced segment references a NEW snapshot that supersedes the old.
create table reservations.terms_snapshots (
  id             uuid primary key,
  tenant_id      uuid not null,
  stay_id        uuid not null references reservations.stays (id),
  document       jsonb not null,
  hash           text not null,
  price_source   text not null check (price_source in ('portico', 'channel', 'override')),
  accepted_via   text not null check (accepted_via in ('booking', 'change', 'channel', 'import', 'quote')),
  accepted_at    timestamptz not null,
  accepted_by    text not null,
  supersedes_id  uuid references reservations.terms_snapshots (id),
  change_preview uuid
);
create index terms_snapshots_stay_idx on reservations.terms_snapshots (tenant_id, stay_id);
select core.enable_tenant_isolation('reservations.terms_snapshots');
select core.make_append_only('reservations.terms_snapshots');

-- Room moves and other unit changes as history (who moved whom, why, when). Append-only.
create table reservations.room_moves (
  id            uuid primary key,
  tenant_id     uuid not null,
  stay_id       uuid not null references reservations.stays (id),
  from_unit_id  uuid,
  to_unit_id    uuid,
  from_date     date not null,
  reason        text not null,
  chargeable    boolean not null default false,
  moved_at      timestamptz not null,
  moved_by      text not null
);
select core.enable_tenant_isolation('reservations.room_moves');
select core.make_append_only('reservations.room_moves');

---------------------------------------------------------------------------------------------------------
-- Change previews (RES-R11/R12): the token binds the booking version and a fingerprint of every previewed
-- amount, availability and penalty. Commit recomputes and refuses if anything differs (RES-I07).
---------------------------------------------------------------------------------------------------------
create table reservations.change_previews (
  token           uuid primary key,
  tenant_id       uuid not null,
  property_id     uuid not null,
  booking_id      uuid,
  booking_version int,
  kind            text not null,
  request         jsonb not null,
  result          jsonb not null,
  fingerprint     text not null,
  status          text not null default 'open' check (status in ('open', 'committed', 'stale', 'expired', 'superseded')),
  created_by      text not null,
  created_at      timestamptz not null,
  expires_at      timestamptz not null,
  committed_at    timestamptz,
  parent_token    uuid
);
create index change_previews_booking_idx on reservations.change_previews (tenant_id, booking_id);
select core.enable_tenant_isolation('reservations.change_previews');

---------------------------------------------------------------------------------------------------------
-- Check-in / check-out workflow runs (RES-R24..R27): persisted step results, resumable.
---------------------------------------------------------------------------------------------------------
create table reservations.workflow_runs (
  id            uuid primary key,
  tenant_id     uuid not null,
  property_id   uuid not null,
  stay_id       uuid not null references reservations.stays (id),
  kind          text not null check (kind in ('check_in', 'check_out')),
  status        text not null check (status in ('in_progress', 'completed', 'abandoned')),
  steps         jsonb not null,
  started_by    text not null,
  started_at    timestamptz not null,
  updated_at    timestamptz not null,
  completed_at  timestamptz,
  version       int not null default 1
);
-- At most one active run per stay and kind.
create unique index workflow_runs_active_uq on reservations.workflow_runs (tenant_id, stay_id, kind)
  where status = 'in_progress';
select core.enable_tenant_isolation('reservations.workflow_runs');

---------------------------------------------------------------------------------------------------------
-- Channel revisions (RES-R30/R31, RES-I06): idempotent on (connection, external id, revision). Append-only.
---------------------------------------------------------------------------------------------------------
create table reservations.channel_revisions (
  id             uuid primary key,
  tenant_id      uuid not null,
  connection_id  uuid not null,
  external_id    text not null,
  revision       bigint not null,
  payload_hash   text not null,
  payload        jsonb not null,
  outcome        text not null check (outcome in ('created', 'modified', 'cancelled', 'conflict', 'stale', 'needs_review')),
  applied        boolean not null,
  booking_id     uuid,
  diff           jsonb,
  field_losses   jsonb,
  note           text,
  received_at    timestamptz not null,
  unique (tenant_id, connection_id, external_id, revision)
);
select core.enable_tenant_isolation('reservations.channel_revisions');
select core.make_append_only('reservations.channel_revisions');

---------------------------------------------------------------------------------------------------------
-- Issues (reservations exceptions: field-loss review, payment follow-up, waitlist availability, rate
-- discrepancy, option expiring…) and relocation cases (RES-R34).
---------------------------------------------------------------------------------------------------------
create table reservations.issues (
  id           uuid primary key,
  tenant_id    uuid not null,
  property_id  uuid not null,
  kind         text not null,
  severity     text not null check (severity in ('urgent', 'routine')),
  booking_id   uuid,
  stay_id      uuid,
  dedupe_key   text not null,
  message      text not null,
  owner_id     uuid,
  status       text not null default 'open' check (status in ('open', 'resolved')),
  details      jsonb not null default '{}',
  created_at   timestamptz not null,
  resolved_at  timestamptz,
  resolved_by  text,
  resolution   text,
  version      int not null default 1
);
create unique index issues_open_dedupe_uq on reservations.issues (tenant_id, dedupe_key) where status = 'open';
create index issues_property_idx on reservations.issues (tenant_id, property_id, status);
select core.enable_tenant_isolation('reservations.issues');

create table reservations.relocation_cases (
  id           uuid primary key,
  tenant_id    uuid not null,
  property_id  uuid not null,
  stay_id      uuid not null references reservations.stays (id),
  booking_id   uuid not null references reservations.bookings (id),
  cause        text not null check (cause in ('inventory_conflict', 'out_of_order', 'assignment_conflict')),
  cause_ref    jsonb,
  nights       daterange not null,
  options      jsonb not null default '[]',
  status       text not null default 'open' check (status in ('open', 'option_selected', 'completed', 'cancelled')),
  selected     jsonb,
  owner_id     uuid,
  created_at   timestamptz not null,
  updated_at   timestamptz not null,
  resolved_at  timestamptz,
  version      int not null default 1
);
create unique index relocation_open_uq on reservations.relocation_cases (tenant_id, stay_id, cause)
  where status in ('open', 'option_selected');
select core.enable_tenant_isolation('reservations.relocation_cases');

---------------------------------------------------------------------------------------------------------
-- Shift handover (RES-R37, RES-I10): items persist until resolved; handovers snapshot what was handed over.
---------------------------------------------------------------------------------------------------------
create table reservations.handover_items (
  id           uuid primary key,
  tenant_id    uuid not null,
  property_id  uuid not null,
  department   text not null,
  kind         text not null check (kind in ('task', 'financial_exception', 'guest_commitment', 'note')),
  title        text not null,
  detail       text,
  ref          jsonb,
  owner_id     uuid not null,
  owner_name   text,
  due_at       timestamptz,
  status       text not null default 'open' check (status in ('open', 'resolved')),
  created_by   text not null,
  created_at   timestamptz not null,
  resolved_at  timestamptz,
  resolved_by  text,
  resolution   text,
  version      int not null default 1
);
create index handover_items_open_idx on reservations.handover_items (tenant_id, property_id, department, status);
select core.enable_tenant_isolation('reservations.handover_items');

create table reservations.handovers (
  id                 uuid primary key,
  tenant_id          uuid not null,
  property_id        uuid not null,
  department         text not null,
  shift_label        text not null,
  status             text not null check (status in ('published', 'acknowledged')),
  notes              text,
  items              jsonb not null,
  published_by       text not null,
  published_by_name  text not null,
  published_at       timestamptz not null,
  acknowledged_by    text,
  acknowledged_by_name text,
  acknowledged_at    timestamptz,
  version            int not null default 1
);
create index handovers_property_idx on reservations.handovers (tenant_id, property_id, department, published_at desc);
select core.enable_tenant_isolation('reservations.handovers');

---------------------------------------------------------------------------------------------------------
-- Forwarded changes (ADR-0014 data authority, write_mode 'forward'): a change Portico must send to the
-- external system of record. Not effective until the external system acknowledges it.
---------------------------------------------------------------------------------------------------------
create table reservations.forwarded_changes (
  id               uuid primary key,
  tenant_id        uuid not null,
  property_id      uuid not null,
  booking_id       uuid,
  stay_id          uuid,
  kind             text not null,
  connection_id    uuid,
  system_name      text,
  payload          jsonb not null,
  status           text not null default 'pending' check (status in ('pending', 'acknowledged', 'rejected')),
  dedupe_key       text not null,          -- the same pending instruction is forwarded once (R-08)
  external_ref     text,
  detail           text,
  created_by       text not null,
  created_at       timestamptz not null,
  resolved_at      timestamptz,
  version          int not null default 1
);
create index forwarded_changes_pending_idx on reservations.forwarded_changes (tenant_id, property_id, status);
create unique index forwarded_changes_dedupe_uq on reservations.forwarded_changes (tenant_id, dedupe_key)
  where status = 'pending';
select core.enable_tenant_isolation('reservations.forwarded_changes');

---------------------------------------------------------------------------------------------------------
-- Routing metadata for the booking-expiry job (reviewed SECURITY DEFINER; returns ids only, no business data):
-- properties with held bookings whose hold expired, or tentative bookings at/after their option date (the job
-- re-checks against each property's business date inside the tenant transaction).
---------------------------------------------------------------------------------------------------------
create or replace function reservations.due_booking_expiries(p_now timestamptz)
  returns table (tenant_id uuid, property_id uuid)
  language sql stable security definer set search_path = reservations, pg_temp as $$
    select distinct b.tenant_id, b.property_id from reservations.bookings b
     where (b.status = 'held' and b.hold_expires_at <= p_now)
        or (b.status = 'tentative' and b.option_date is not null and b.option_date <= (p_now at time zone 'UTC')::date + 1)
$$;
revoke execute on function reservations.due_booking_expiries(timestamptz) from public;

select core.apply_standard_grants('reservations');
