-- Integration module: connector framework (connections, 9-step setup journey, encrypted credentials, mappings
-- with suggestions + review, exchange log, sync runs, inbound message store, outbound command queue, health,
-- exceptions, vendor notices) and partner webhooks (subscriptions, deliveries, attempts).
-- Rules: every table is tenant-isolated (RLS forced) except the scheduler index (see bottom); history tables are
-- append-only; no foreign keys into other modules' schemas (property ids are references only).
create schema if not exists integration;

---------------------------------------------------------------------------------------------------------
-- Connections and the setup journey
---------------------------------------------------------------------------------------------------------
create table integration.connections (
  id                       uuid primary key,
  tenant_id                uuid not null,
  connector_key            text not null,
  name                     text not null,
  -- Property scope. Empty array = organization-wide connection (requires an organization-wide grant).
  property_ids             uuid[] not null default '{}',
  -- The 9-step journey plus lifecycle states.
  state                    text not null check (state in (
                             'selected', 'compatibility_reviewed', 'authorized', 'mappings_suggested',
                             'issues_resolved', 'validated', 'previewed', 'active', 'monitoring',
                             'paused', 'disconnected', 'error')),
  -- State to return to on resume (active|monitoring) or after an error is cleared.
  resume_state             text,
  -- Approved scope: workflows (with operations) and the data-authority plan per domain.
  scope                    jsonb not null default '{"workflows": [], "authority": []}',
  compatibility            jsonb,
  health_status            text not null default 'not_monitored'
                             check (health_status in ('not_monitored', 'healthy', 'degraded', 'down', 'paused')),
  health_reason            text,
  health_changed_at        timestamptz,
  -- Interruption tracking: while set, money-moving / inventory-reopening commands are not sent, and on
  -- reconnection the backlog is held for revalidation (adoption brief §8).
  interrupted_since        timestamptz,
  interruption_reason      text,
  last_reconnected_at      timestamptz,
  activated_at             timestamptz,
  activated_by             text,
  activated_preview_id     uuid,
  replaces_connection_id   uuid,
  replaced_by_connection_id uuid,
  owner_user_id            uuid,
  last_error               jsonb,
  next_sync_at             timestamptz,
  created_at               timestamptz not null default now(),
  created_by               text not null,
  updated_at               timestamptz not null default now(),
  version                  int not null default 1,
  check (resume_state is null or resume_state in ('active', 'monitoring'))
);
-- Business identity: a live (not disconnected) connection name is unique in the organization.
create unique index connections_name_uq on integration.connections (tenant_id, lower(name)) where state <> 'disconnected';
create index connections_state_idx on integration.connections (tenant_id, state);
create index connections_properties_idx on integration.connections using gin (property_ids);
select core.enable_tenant_isolation('integration.connections');
create trigger touch before update on integration.connections for each row execute function core.touch_updated_at();

-- Every step and lifecycle transition, with actor and time (append-only). Progress is preserved here.
create table integration.connection_steps (
  -- Monotonic order (several rows can share a timestamp within one transaction).
  seq                 bigint generated always as identity,
  id            uuid primary key,
  tenant_id     uuid not null,
  connection_id uuid not null references integration.connections(id),
  step          int not null check (step between 0 and 9),   -- 0 = lifecycle action (pause, resume, …)
  action        text not null,
  outcome       text not null check (outcome in ('completed', 'failed', 'reopened', 'lifecycle')),
  state_from    text not null,
  state_to      text not null,
  detail        jsonb not null default '{}',
  actor         jsonb not null,
  actor_key     text not null,
  occurred_at   timestamptz not null
);
create index connection_steps_conn_idx on integration.connection_steps (connection_id, occurred_at);
select core.enable_tenant_isolation('integration.connection_steps');

---------------------------------------------------------------------------------------------------------
-- Credentials (never plaintext) and the local SecretStore backing table (development / test only)
---------------------------------------------------------------------------------------------------------
create table integration.secrets (
  id          uuid primary key,
  tenant_id   uuid not null,
  purpose     text not null,           -- 'connection_credential' | 'webhook_signing'
  ciphertext  text not null,           -- AES-256-GCM envelope, AAD binds tenant + secret id
  key_id      text not null,
  created_at  timestamptz not null default now()
);
select core.enable_tenant_isolation('integration.secrets');

create table integration.credentials (
  id             uuid primary key,
  tenant_id      uuid not null,
  connection_id  uuid not null references integration.connections(id),
  secret_ref     text,                 -- SecretStore reference; null once destroyed (crypto-shredded)
  store_kind     text not null,
  label          text not null,
  status         text not null check (status in ('active', 'superseded', 'revoked')),
  expires_at     timestamptz,
  verified_at    timestamptz,
  account_label  text,
  -- What the vendor granted (G-03): scopes as reported, and whether the credential itself is read-only at the
  -- vendor (null = the vendor does not say). Trial connections with a write-capable credential are labeled.
  scopes_granted text[],
  read_only_at_vendor boolean,
  rotated_from   uuid references integration.credentials(id),
  created_at     timestamptz not null,
  created_by     text not null,
  superseded_at  timestamptz,
  version        int not null default 1
);
create unique index credentials_one_active_uq on integration.credentials (connection_id) where status = 'active';
select core.enable_tenant_isolation('integration.credentials');

---------------------------------------------------------------------------------------------------------
-- Mappings (current) and their version history
---------------------------------------------------------------------------------------------------------
create table integration.mappings (
  id                      uuid primary key,
  tenant_id               uuid not null,
  connection_id           uuid not null references integration.connections(id),
  kind                    text not null check (kind in ('property', 'unitType', 'unit', 'ratePlan', 'outlet',
                            'chargeCode', 'taxRule', 'ledgerAccount', 'status')),
  external_id             text not null,
  external_label          text not null,
  external_attrs          jsonb not null default '{}',
  property_id             uuid,
  internal_id             text,        -- uuid of a Portico record, or a vocabulary value for kind = status
  internal_label          text,
  -- What the engine first proposed, kept to measure suggestion accuracy (adoption brief §14, INT-R14).
  suggested_internal_id   text,
  status                  text not null check (status in ('suggested', 'confirmed', 'unmapped', 'ignored')),
  confidence              numeric(4, 3),
  reasons                 jsonb not null default '[]',
  alternatives            jsonb not null default '[]',
  financially_significant boolean not null default false,
  requires_review         boolean not null default false,
  review_reason           text,
  reviewed                boolean not null default false,
  reviewed_by             text,
  reviewed_at             timestamptz,
  auto_confirmed          boolean not null default false,
  updated_at              timestamptz not null default now(),
  version                 int not null default 1,
  unique (tenant_id, connection_id, kind, external_id),
  check (status not in ('confirmed') or internal_id is not null),
  -- A mapping that needs review is never 'confirmed' without a reviewer.
  check (not (status = 'confirmed' and requires_review and not reviewed))
);
create index mappings_conn_idx on integration.mappings (connection_id, kind);
select core.enable_tenant_isolation('integration.mappings');
create trigger touch before update on integration.mappings for each row execute function core.touch_updated_at();

create table integration.mapping_versions (
  id             uuid primary key,
  tenant_id      uuid not null,
  mapping_id     uuid not null references integration.mappings(id),
  connection_id  uuid not null,
  version        int not null,
  internal_id    text,
  status         text not null,
  reviewed       boolean not null,
  confidence     numeric(4, 3),
  change         text not null,        -- 'suggested' | 'confirmed' | 'overridden' | 'ignored' | 'reset' | 'auto_confirmed'
  reason         text,
  actor_key      text not null,
  changed_at     timestamptz not null,
  unique (mapping_id, version)
);
select core.enable_tenant_isolation('integration.mapping_versions');

---------------------------------------------------------------------------------------------------------
-- Validation runs and previews (step 6 and 7)
---------------------------------------------------------------------------------------------------------
create table integration.validation_runs (
  -- Monotonic order (several rows can share a timestamp within one transaction).
  seq                 bigint generated always as identity,
  id                  uuid primary key,
  tenant_id           uuid not null,
  connection_id       uuid not null references integration.connections(id),
  status              text not null check (status in ('passed', 'failed')),
  checks              jsonb not null,
  mapping_fingerprint text not null,
  provenance          text not null,
  started_at          timestamptz not null,
  finished_at         timestamptz not null,
  actor_key           text not null
);
select core.enable_tenant_isolation('integration.validation_runs');

create table integration.previews (
  -- Monotonic order (several rows can share a timestamp within one transaction).
  seq                 bigint generated always as identity,
  id                  uuid primary key,
  tenant_id           uuid not null,
  connection_id       uuid not null references integration.connections(id),
  kind                text not null check (kind in ('activation', 'pause', 'resume', 'disconnect', 'rotate', 'replace')),
  content             jsonb not null,
  content_hash        text not null,
  mapping_fingerprint text,
  created_at          timestamptz not null,
  actor_key           text not null
);
create index previews_conn_idx on integration.previews (connection_id, created_at);
select core.enable_tenant_isolation('integration.previews');

---------------------------------------------------------------------------------------------------------
-- Exchange: per-workflow state, exchange log, sync runs, files, inbound store, external watermarks
---------------------------------------------------------------------------------------------------------
create table integration.workflow_state (
  tenant_id               uuid not null,
  connection_id           uuid not null references integration.connections(id),
  workflow                text not null,
  last_success_at         timestamptz,
  last_attempt_at         timestamptz,
  last_failure_at         timestamptz,
  last_failure_kind       text,
  last_failure_reason     text,
  consecutive_failures    int not null default 0,
  last_latency_ms         int,
  last_message_latency_s  int,
  last_applied_at         timestamptz,
  -- G-05: a detected gap (missing revision, failed reconciliation) makes the stream `incomplete` until a
  -- reconciliation run clears it.
  incomplete_since        timestamptz,
  incomplete_reason       text,
  cursor                  text,
  version                 int not null default 1,
  primary key (connection_id, workflow)
);
select core.enable_tenant_isolation('integration.workflow_state');

create table integration.files (
  seq            bigint generated always as identity,
  id             uuid primary key,
  tenant_id      uuid not null,
  connection_id  uuid not null references integration.connections(id),
  direction      text not null check (direction in ('import', 'export')),
  workflow       text not null,
  name           text not null,
  content_type   text not null,
  sha256         text not null,
  size_bytes     int not null check (size_bytes <= 5242880),
  content        text not null,
  created_at     timestamptz not null,
  actor_key      text not null
);
select core.enable_tenant_isolation('integration.files');

create table integration.sync_runs (
  id             uuid primary key,
  tenant_id      uuid not null,
  connection_id  uuid not null references integration.connections(id),
  workflow       text,
  trigger        text not null check (trigger in ('periodic', 'manual', 'file', 'reconciliation')),
  status         text not null check (status in ('running', 'succeeded', 'partial', 'failed')),
  counts         jsonb not null default '{}',
  file_id        uuid references integration.files(id),
  provenance     text not null,
  error          jsonb,
  started_at     timestamptz not null,
  finished_at    timestamptz,
  actor_key      text not null,
  version        int not null default 1
);
create index sync_runs_conn_idx on integration.sync_runs (connection_id, started_at desc);
select core.enable_tenant_isolation('integration.sync_runs');

create table integration.exchange_log (
  seq              bigint generated always as identity,
  id               uuid primary key,
  tenant_id        uuid not null,
  connection_id    uuid not null references integration.connections(id),
  property_id      uuid,
  workflow         text not null,
  direction        text not null check (direction in ('inbound', 'outbound')),
  operation        text,
  external_ref     text,
  idempotency_key  text,
  outcome          text not null check (outcome in ('succeeded', 'failed', 'duplicate', 'stale', 'held',
                     'rejected', 'unknown', 'simulated', 'blocked', 'exported')),
  latency_ms       int,
  error_class      text check (error_class in ('transient', 'permanent', 'mapping', 'data', 'auth', 'rate_limited')),
  summary          text not null,
  detail           jsonb,              -- technical detail: shown only with integration.technical.read
  provenance       text not null,
  sync_run_id      uuid references integration.sync_runs(id),
  occurred_at      timestamptz not null
);
create index exchange_log_conn_idx on integration.exchange_log (connection_id, occurred_at desc);
create index exchange_log_ref_idx on integration.exchange_log (connection_id, external_ref);
select core.enable_tenant_isolation('integration.exchange_log');

create table integration.inbound_messages (
  id                    uuid primary key,
  tenant_id             uuid not null,
  connection_id         uuid not null references integration.connections(id),
  property_id           uuid,
  workflow              text not null,
  external_id           text not null,
  revision              text not null,
  revision_order        numeric not null,
  external_occurred_at  timestamptz not null,
  received_at           timestamptz not null,
  payload               jsonb not null,
  canonical             jsonb,
  status                text not null check (status in ('applied', 'stale', 'held_mapping', 'held_validation', 'rejected')),
  hold_reason           text,
  gap_detected          boolean not null default false,
  delayed               boolean not null default false,
  duplicate_count       int not null default 0,
  sync_run_id           uuid references integration.sync_runs(id),
  processed_at          timestamptz,
  version               int not null default 1,
  -- Dedupe: the same (connection, workflow, external id, revision) is stored once, whatever the vendor resends.
  unique (tenant_id, connection_id, workflow, external_id, revision)
);
create index inbound_held_idx on integration.inbound_messages (connection_id, status) where status in ('held_mapping', 'held_validation');
select core.enable_tenant_isolation('integration.inbound_messages');

-- Ordering watermark per external record: the newest revision applied. Older revisions arriving later are stale.
create table integration.external_records (
  tenant_id            uuid not null,
  connection_id        uuid not null references integration.connections(id),
  workflow             text not null,
  external_id          text not null,
  last_revision        text not null,
  last_revision_order  numeric not null,
  last_message_id      uuid not null,
  updated_at           timestamptz not null,
  primary key (connection_id, workflow, external_id)
);
select core.enable_tenant_isolation('integration.external_records');

---------------------------------------------------------------------------------------------------------
-- Outbound command queue
---------------------------------------------------------------------------------------------------------
create table integration.outbound_commands (
  id                   uuid primary key,
  tenant_id            uuid not null,
  connection_id        uuid not null references integration.connections(id),
  property_id          uuid,
  workflow             text not null,
  operation            text not null,
  idempotency_key      text not null,
  -- The record the command sets (e.g. roomStatus:LGN-101). State-setting commands for the same business key are
  -- coalesced on reconnection: only the newest is sent (connection lifecycle spec §9, class S).
  business_key         text,
  effect_class         text not null check (effect_class in ('standard', 'money', 'inventory_reopen')),
  payload              jsonb not null,
  source_ref           jsonb,
  status               text not null check (status in ('queued', 'sending', 'acknowledged', 'rejected',
                         'pending_verification', 'needs_revalidation', 'cancelled', 'superseded', 'exported')),
  attempts             int not null default 0,
  next_attempt_at      timestamptz not null,
  lease_until          timestamptz,
  verify_before_send   boolean not null default false,
  last_error           jsonb,
  external_ref         text,
  revalidation_reason  text,
  revalidated_by       text,
  revalidated_at       timestamptz,
  enqueued_at          timestamptz not null,
  completed_at         timestamptz,
  version              int not null default 1,
  -- A business action is queued once: retries of the caller reuse the same idempotency key.
  unique (tenant_id, connection_id, idempotency_key)
);
create index outbound_due_idx on integration.outbound_commands (connection_id, status, next_attempt_at);
select core.enable_tenant_isolation('integration.outbound_commands');

---------------------------------------------------------------------------------------------------------
-- Exceptions and vendor-required changes
---------------------------------------------------------------------------------------------------------
create table integration.exceptions (
  id                 uuid primary key,
  tenant_id          uuid not null,
  connection_id      uuid not null references integration.connections(id),
  property_id        uuid,
  workflow           text,
  severity           text not null check (severity in ('urgent', 'routine')),
  code               text not null,
  dedupe_key         text not null,
  problem            text not null,
  business_impact    text not null,
  responsible_party  text not null check (responsible_party in ('hotel', 'monoclay', 'vendor')),
  next_step          text not null,
  related_refs       jsonb not null default '[]',
  technical_detail   jsonb,
  -- Owner for the cross-module "My work" inbox: a person, or a department (platform department id).
  owner_user_id      uuid,
  owner_department_id uuid,
  status             text not null check (status in ('open', 'acknowledged', 'resolved', 'ignored')),
  resolution         text,
  resolved_by        text,
  resolved_at        timestamptz,
  occurrences        int not null default 1,
  first_seen_at      timestamptz not null,
  last_seen_at       timestamptz not null,
  version            int not null default 1
);
-- The same problem is raised once while open (occurrences count instead of duplicate rows).
create unique index exceptions_open_uq on integration.exceptions (tenant_id, connection_id, dedupe_key) where status in ('open', 'acknowledged');
create index exceptions_status_idx on integration.exceptions (tenant_id, status, severity);
select core.enable_tenant_isolation('integration.exceptions');

create table integration.vendor_notices (
  id                 uuid primary key,
  tenant_id          uuid not null,
  connection_id      uuid not null references integration.connections(id),
  title              text not null,
  required_action    text not null,
  responsible_party  text not null check (responsible_party in ('hotel', 'monoclay', 'vendor')),
  due_date           date,
  status             text not null check (status in ('open', 'done')),
  created_at         timestamptz not null,
  actor_key          text not null,
  version            int not null default 1
);
select core.enable_tenant_isolation('integration.vendor_notices');

---------------------------------------------------------------------------------------------------------
-- Partner webhooks
---------------------------------------------------------------------------------------------------------
create table integration.webhook_subscriptions (
  id                    uuid primary key,
  tenant_id             uuid not null,
  name                  text not null,
  url                   text not null check (url like 'https://%'),
  event_types           text[] not null check (cardinality(event_types) > 0),
  property_ids          uuid[] not null default '{}',   -- empty = all properties
  secret_ref            text not null,
  -- Signing-secret rotation: during the overlap both secrets sign every delivery (two v1 signatures).
  previous_secret_ref   text,
  previous_secret_expires_at timestamptz,
  api_client_id         uuid,
  status                text not null check (status in ('active', 'disabled')),
  disabled_reason       text,
  disabled_at           timestamptz,
  consecutive_failures  int not null default 0,
  last_success_at       timestamptz,
  created_at            timestamptz not null,
  created_by            text not null,
  updated_at            timestamptz not null default now(),
  version               int not null default 1
);
create unique index webhook_subscriptions_name_uq on integration.webhook_subscriptions (tenant_id, lower(name));
select core.enable_tenant_isolation('integration.webhook_subscriptions');
create trigger touch before update on integration.webhook_subscriptions for each row execute function core.touch_updated_at();

create table integration.webhook_deliveries (
  id                    uuid primary key,
  tenant_id             uuid not null,
  subscription_id       uuid not null references integration.webhook_subscriptions(id),
  event_id              uuid not null,
  event_type            text not null,
  property_id           uuid,
  payload               jsonb not null,
  status                text not null check (status in ('pending', 'succeeded', 'failed', 'dead', 'blocked',
                          'simulated', 'cancelled')),
  attempts              int not null default 0,
  next_attempt_at       timestamptz not null,
  lease_until           timestamptz,
  last_attempt_at       timestamptz,
  last_response_status  int,
  last_error            text,
  replay_of             uuid references integration.webhook_deliveries(id),
  requested_by          text,
  created_at            timestamptz not null,
  completed_at          timestamptz,
  version               int not null default 1
);
-- One original delivery per subscription and event (event fan-out is retried by the outbox); replays are extra rows.
create unique index webhook_deliveries_event_uq on integration.webhook_deliveries (tenant_id, subscription_id, event_id) where replay_of is null;
create index webhook_deliveries_due_idx on integration.webhook_deliveries (status, next_attempt_at);
select core.enable_tenant_isolation('integration.webhook_deliveries');

create table integration.webhook_attempts (
  id              uuid primary key,
  tenant_id       uuid not null,
  delivery_id     uuid not null references integration.webhook_deliveries(id),
  attempt_no      int not null,
  attempted_at    timestamptz not null,
  outcome         text not null check (outcome in ('succeeded', 'failed', 'blocked', 'simulated')),
  response_status int,
  duration_ms     int,
  error           text,
  unique (delivery_id, attempt_no)
);
select core.enable_tenant_isolation('integration.webhook_attempts');

---------------------------------------------------------------------------------------------------------
-- Append-only history and grants
---------------------------------------------------------------------------------------------------------
select core.apply_standard_grants('integration');
select core.make_append_only('integration.connection_steps');
select core.make_append_only('integration.mapping_versions');
select core.make_append_only('integration.validation_runs');
select core.make_append_only('integration.previews');
select core.make_append_only('integration.exchange_log');
select core.make_append_only('integration.files');
select core.make_append_only('integration.webhook_attempts');

---------------------------------------------------------------------------------------------------------
-- Scheduler index: which organizations have integration work due (webhook deliveries, outbound commands,
-- periodic syncs, health checks). Background jobs need to find tenants before a tenant context exists, so — like
-- core.outbox — RLS is ENABLED but NOT forced: the app role sees only its own tenant's row; the reviewed SECURITY
-- DEFINER function below (running as the table owner) returns routing metadata only (tenant ids), never data.
---------------------------------------------------------------------------------------------------------
create table integration.tenant_schedule (
  tenant_id    uuid primary key,
  next_due_at  timestamptz not null,
  lease_until  timestamptz
);
alter table integration.tenant_schedule enable row level security;
create policy tenant_isolation on integration.tenant_schedule
  using (tenant_id = core.current_tenant_id()) with check (tenant_id = core.current_tenant_id());
grant select, insert, update, delete on integration.tenant_schedule to portico_app;

create or replace function integration.claim_due_tenants(p_limit int, p_lease_seconds int)
  returns table (tenant_id uuid)
  language sql security definer set search_path = integration, pg_temp as $$
    update integration.tenant_schedule s
       set lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds)
     where s.tenant_id in (
       select x.tenant_id from integration.tenant_schedule x
        where x.next_due_at <= clock_timestamp()
          and (x.lease_until is null or x.lease_until < clock_timestamp())
        order by x.next_due_at
        limit p_limit
        for update skip locked)
    returning s.tenant_id
$$;
revoke execute on function integration.claim_due_tenants(int, int) from public;
grant execute on function integration.claim_due_tenants(int, int) to portico_app;
