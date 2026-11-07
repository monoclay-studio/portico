-- Platform wave 1: entitlement grants (add-ons, Connect packs), owners and unit ownership, outlets, configuration
-- bundles with staged rollout and approval, trial environments, property activation with approved scope.
-- See modules/platform/README.md.

---------------------------------------------------------------------------------------------------------
-- Entitlement grants: add-ons and Connect module packs, organization- or property-scoped (PLT-R20/R22)
---------------------------------------------------------------------------------------------------------
create table platform.entitlement_grants (
  id             uuid primary key,
  tenant_id      uuid not null,
  kind           text not null check (kind in ('add_on', 'pack')),
  key            text not null,
  property_id    uuid references platform.properties(id),
  reason         text not null,
  granted_by     text not null,
  granted_at     timestamptz not null,
  revoked_at     timestamptz,
  revoked_by     text,
  revoke_reason  text
);
create unique index entitlement_grants_active_idx on platform.entitlement_grants
  (tenant_id, kind, key, coalesce(property_id, '00000000-0000-0000-0000-000000000000'))
  where revoked_at is null;
select core.enable_tenant_isolation('platform.entitlement_grants');

---------------------------------------------------------------------------------------------------------
-- Owners and unit ownership (brief §2: individual owners with separate accounting). No bank data stored.
---------------------------------------------------------------------------------------------------------
create table platform.owners (
  id                  uuid primary key,
  tenant_id           uuid not null,
  reference           text not null,
  kind                text not null check (kind in ('person', 'company')),
  display_name        text not null,
  legal_name          text,
  tax_id              text,
  country_code        char(2),
  email               text,
  phone               text,
  -- Opaque reference to where payout details are held (finance payout account or SecretStore entry) and a
  -- non-sensitive hint ("BML ••••1234"). Bank account numbers never enter this table.
  payout_account_ref  text,
  payout_hint         text,
  status              text not null default 'active' check (status in ('active', 'archived')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             int not null default 1,
  unique (tenant_id, reference)
);
select core.enable_tenant_isolation('platform.owners');

create table platform.unit_ownership (
  id              uuid primary key,
  tenant_id       uuid not null,
  owner_id        uuid not null references platform.owners(id),
  property_id     uuid not null references platform.properties(id),
  unit_id         uuid not null,        -- inventory unit, referenced by id only (module boundary)
  share_bps       int not null check (share_bps between 1 and 10000),
  effective_from  date not null,
  effective_to    date,                 -- exclusive; null = open-ended
  created_at      timestamptz not null default now(),
  created_by      text not null,
  ended_at        timestamptz,
  ended_by        text,
  end_reason      text,
  check (effective_to is null or effective_to > effective_from),
  -- One owner holds at most one share row per unit for any date.
  exclude using gist (owner_id with =, unit_id with =, daterange(effective_from, effective_to, '[)') with &&)
);
create index unit_ownership_unit_idx on platform.unit_ownership (tenant_id, unit_id, effective_from);
select core.enable_tenant_isolation('platform.unit_ownership');

---------------------------------------------------------------------------------------------------------
-- Outlets (PLT-R19)
---------------------------------------------------------------------------------------------------------
create table platform.outlets (
  id                       uuid primary key,
  tenant_id                uuid not null,
  property_id              uuid not null references platform.properties(id),
  code                     text not null,
  name                     text not null,
  kind                     text not null check (kind in ('restaurant', 'bar', 'cafe', 'spa', 'dive_center', 'water_sports',
                             'excursions', 'boutique', 'transfer_desk', 'minibar', 'in_room_dining', 'laundry',
                             'kids_club', 'other')),
  legal_entity_id          uuid not null references platform.legal_entities(id),
  default_charge_code_key  text,          -- finance charge code, referenced by key
  opening_hours            jsonb not null default '[]',
  accepts_room_charge      boolean not null default false,
  status                   text not null default 'active' check (status in ('active', 'archived')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  version                  int not null default 1,
  unique (property_id, code)
);
select core.enable_tenant_isolation('platform.outlets');

---------------------------------------------------------------------------------------------------------
-- Configuration bundles, rollout groups and approved configuration changes (adoption brief §11)
---------------------------------------------------------------------------------------------------------
create table platform.configuration_bundles (
  id                  uuid primary key,
  tenant_id           uuid not null,
  name                text not null,
  version             int not null,
  description         text,
  source_kind         text not null check (source_kind in ('property', 'trial', 'upload')),
  source_ref          text,
  source_property_id  uuid,
  content             jsonb not null,
  checksum            text not null,
  created_by          text not null,
  created_at          timestamptz not null,
  unique (tenant_id, name, version)
);
select core.enable_tenant_isolation('platform.configuration_bundles');

create table platform.rollout_groups (
  id          uuid primary key,
  tenant_id   uuid not null,
  key         text not null,
  name        text not null,
  stage       text not null check (stage in ('pilot', 'wave1', 'wave2', 'wave3', 'wave4', 'final')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     int not null default 1,
  unique (tenant_id, key)
);
select core.enable_tenant_isolation('platform.rollout_groups');

create table platform.rollout_group_members (
  tenant_id    uuid not null,
  group_id     uuid not null references platform.rollout_groups(id) on delete cascade,
  property_id  uuid not null references platform.properties(id),
  added_at     timestamptz not null default now(),
  primary key (group_id, property_id),
  unique (tenant_id, property_id)        -- a property belongs to at most one rollout group
);
select core.enable_tenant_isolation('platform.rollout_group_members');

create table platform.configuration_changes (
  id                    uuid primary key,
  tenant_id             uuid not null,
  bundle_id             uuid not null references platform.configuration_bundles(id),
  rollout_group_id      uuid references platform.rollout_groups(id),
  target_property_ids   uuid[] not null,
  sections              text[] not null,
  mode                  text not null check (mode in ('preserve_local', 'overwrite')),
  status                text not null check (status in ('pending_approval', 'approved', 'applied', 'rejected', 'cancelled')),
  approval_required     boolean not null,
  plan                  jsonb not null,
  plan_hash             text not null,
  summary               jsonb not null,
  prepared_by           text not null,
  prepared_at           timestamptz not null,
  approved_by           text,
  approved_at           timestamptz,
  decision_note         text,
  applied_by            text,
  applied_at            timestamptz,
  version               int not null default 1,
  check (cardinality(target_property_ids) > 0)
);
create index configuration_changes_tenant_idx on platform.configuration_changes (tenant_id, prepared_at desc);
select core.enable_tenant_isolation('platform.configuration_changes');

---------------------------------------------------------------------------------------------------------
-- Environments: links from an organization to its trial/training/sandbox organizations, and the trial record
---------------------------------------------------------------------------------------------------------
create table platform.environment_links (
  id                uuid primary key,
  tenant_id         uuid not null,          -- the live (or prospect's) organization
  linked_tenant_id  uuid not null,          -- the trial/training/sandbox organization (another tenant; no FK)
  environment       text not null check (environment in ('trial', 'training', 'sandbox')),
  name              text not null,
  created_by        text not null,
  created_at        timestamptz not null,
  status            text not null default 'active' check (status in ('active', 'closed')),
  unique (tenant_id, linked_tenant_id)
);
select core.enable_tenant_isolation('platform.environment_links');

create table platform.trial_lifecycle (
  tenant_id          uuid primary key,      -- the trial organization itself
  source_tenant_id   uuid,                  -- live organization, if the hotel is already a customer
  prospect_name      text,
  created_by         text not null,
  created_at         timestamptz not null,
  status             text not null default 'active' check (status in ('active', 'closed')),
  reset_count        int not null default 0,
  last_reset_at      timestamptz,
  closed_at          timestamptz,
  closed_by          text,
  close_reason       text,
  deletion_due_at    timestamptz,
  legal_hold         boolean not null default false,
  version            int not null default 1,
  check (source_tenant_id is not null or prospect_name is not null)
);
select core.enable_tenant_isolation('platform.trial_lifecycle');

create table platform.trial_imports (
  id             uuid primary key,
  tenant_id      uuid not null,
  source_system  text not null,
  copied_at      timestamptz not null,
  record_counts  jsonb not null default '{}',
  recorded_by    text not null,
  recorded_at    timestamptz not null
);
select core.enable_tenant_isolation('platform.trial_imports');

---------------------------------------------------------------------------------------------------------
-- Property activation: requests (approved by a different person), versioned scopes, status history
---------------------------------------------------------------------------------------------------------
create table platform.activation_requests (
  id             uuid primary key,
  tenant_id      uuid not null,
  property_id    uuid not null references platform.properties(id),
  kind           text not null check (kind in ('status_change', 'scope_change')),
  from_status    text not null,
  to_status      text check (to_status in ('setup', 'pilot', 'active', 'inactive')),
  scope_stage    text check (scope_stage in ('pilot', 'production')),
  scope_content  jsonb,
  reason         text not null,
  checklist      jsonb not null default '[]',
  status         text not null check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by   text not null,
  requested_at   timestamptz not null,
  decided_by     text,
  decided_at     timestamptz,
  decision_note  text,
  version        int not null default 1,
  check ((kind = 'status_change') = (to_status is not null)),
  check ((scope_stage is null) = (scope_content is null))
);
create unique index activation_requests_one_pending_idx on platform.activation_requests (property_id)
  where status = 'pending';
select core.enable_tenant_isolation('platform.activation_requests');

create table platform.activation_scopes (
  id           uuid primary key,
  tenant_id    uuid not null,
  property_id  uuid not null references platform.properties(id),
  stage        text not null check (stage in ('pilot', 'production')),
  version      int not null,
  content      jsonb not null,
  request_id   uuid references platform.activation_requests(id),
  approved_by  text not null,
  approved_at  timestamptz not null,
  unique (property_id, stage, version)
);
select core.enable_tenant_isolation('platform.activation_scopes');

create table platform.property_status_history (
  id            uuid primary key,
  tenant_id     uuid not null,
  property_id   uuid not null references platform.properties(id),
  from_status   text not null,
  to_status     text not null,
  request_id    uuid references platform.activation_requests(id),
  requested_by  text not null,
  approved_by   text,
  reason        text not null,
  changed_at    timestamptz not null
);
select core.enable_tenant_isolation('platform.property_status_history');

create trigger touch before update on platform.owners for each row execute function core.touch_updated_at();
create trigger touch before update on platform.outlets for each row execute function core.touch_updated_at();
create trigger touch before update on platform.rollout_groups for each row execute function core.touch_updated_at();

select core.apply_standard_grants('platform');
revoke all on platform.tenant_directory from portico_app;
select core.make_append_only('platform.configuration_bundles');
select core.make_append_only('platform.activation_scopes');
select core.make_append_only('platform.property_status_history');
select core.make_append_only('platform.trial_imports');
