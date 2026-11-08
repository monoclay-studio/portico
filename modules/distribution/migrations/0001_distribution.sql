-- Distribution (docs/specs/distribution.md): channel connections to a hub (Channex first), product mapping, the ARI
-- engine (dirty set → coalesced messages → per-connection budget → last-acknowledged channel state), the inbound
-- booking-revision log with ordered processing, parking and acknowledgement after commit, stop-sell, discrepancies,
-- exceptions and the simulated hub. Every tenant-owned table: tenant_id + RLS (forced) + grants.
create schema if not exists distribution;

---------------------------------------------------------------------------------------------------------
-- Channel connections: one Portico property ↔ one hub property. `target` is where publication goes; it is
-- fixed at creation from the organization's environment and re-checked against the environment policy at every
-- external call (live → production, sandbox → staging, demo/trial/training → simulator).
---------------------------------------------------------------------------------------------------------
create table distribution.connections (
  id                    uuid primary key,
  tenant_id             uuid not null,
  property_id           uuid not null,
  hub                   text not null check (hub in ('channex')),
  name                  text not null check (length(name) between 1 and 120),
  status                text not null check (status in ('setup', 'active', 'paused', 'disconnected')),
  target                text not null check (target in ('simulator', 'staging', 'production')),
  external_property_id  text not null check (length(external_property_id) between 1 and 100),
  -- Reference into the secret store (never the key itself).
  credential_ref        text,
  credential_state      text not null default 'unverified'
                        check (credential_state in ('unverified', 'valid', 'invalid')),
  -- Public routing id in the webhook URL, and the SHA-256 of the shared secret Channex sends back in a header.
  webhook_endpoint_id   uuid not null unique,
  webhook_secret_hash   text not null,
  -- Encrypted copy (secret store reference) to register the header at the hub and to verify HMAC signatures.
  webhook_secret_ref    text not null,
  webhook_registered_at timestamptz,
  webhook_verifier      text not null default 'header_secret'
                        check (webhook_verifier in ('header_secret', 'hmac_sha256')),
  channel_code          text not null default 'ota',
  settings              jsonb not null,
  health                text not null default 'healthy',
  health_reason         text,
  health_changed_at     timestamptz,
  last_push_at          timestamptz,
  last_revision_at      timestamptz,
  -- A recovery pull found revisions the hub never notified (missed webhooks): health is degraded for a while.
  inbound_gap_at        timestamptz,
  last_feed_pull_at     timestamptz,
  next_feed_pull_at     timestamptz,
  last_full_sync_at     timestamptz,
  next_full_sync_at     timestamptz,
  activated_at          timestamptz,
  -- First successful Verify: proof that a key for this hub property worked (P2-6). Only a proven connection holds
  -- the global claim on a production hub property; it keeps it until disconnected (a key rotation re-verifies).
  verified_at           timestamptz,
  created_by            text not null,
  created_at            timestamptz not null,
  updated_at            timestamptz not null,
  version               int not null default 1
);
create unique index connections_property_hub_uq on distribution.connections (tenant_id, property_id, hub)
  where status <> 'disconnected';
create unique index connections_external_uq on distribution.connections (tenant_id, hub, external_property_id)
  where status <> 'disconnected';
select core.enable_tenant_isolation('distribution.connections');

---------------------------------------------------------------------------------------------------------
-- Product mapping (DST-R02). Availability is per channel room type (unit type ↔ room type, 1:1 while active);
-- rates and restrictions are per channel rate plan (unit type × rate plan ↔ rate plan, 1:1 while active).
---------------------------------------------------------------------------------------------------------
create table distribution.room_mappings (
  id                    uuid primary key,
  tenant_id             uuid not null,
  connection_id         uuid not null references distribution.connections(id),
  unit_type_id          uuid not null,
  channel_room_type_id  text not null check (length(channel_room_type_id) between 1 and 100),
  status                text not null check (status in ('active', 'retired')),
  created_by            text not null,
  created_at            timestamptz not null,
  retired_at            timestamptz,
  version               int not null default 1
);
create unique index room_mappings_unit_uq on distribution.room_mappings (tenant_id, connection_id, unit_type_id)
  where status = 'active';
create unique index room_mappings_channel_uq on distribution.room_mappings (tenant_id, connection_id, channel_room_type_id)
  where status = 'active';
select core.enable_tenant_isolation('distribution.room_mappings');

create table distribution.rate_mappings (
  id                    uuid primary key,
  tenant_id             uuid not null,
  connection_id         uuid not null references distribution.connections(id),
  unit_type_id          uuid not null,
  rate_plan_id          uuid not null,
  channel_rate_plan_id  text not null check (length(channel_rate_plan_id) between 1 and 100),
  status                text not null check (status in ('active', 'retired')),
  created_by            text not null,
  created_at            timestamptz not null,
  retired_at            timestamptz,
  version               int not null default 1
);
create unique index rate_mappings_product_uq on distribution.rate_mappings (tenant_id, connection_id, unit_type_id, rate_plan_id)
  where status = 'active';
create unique index rate_mappings_channel_uq on distribution.rate_mappings (tenant_id, connection_id, channel_rate_plan_id)
  where status = 'active';
select core.enable_tenant_isolation('distribution.rate_mappings');

---------------------------------------------------------------------------------------------------------
-- ARI engine. The DIRTY SET holds which cells changed (never values): one row per (connection, kind, unit
-- type, rate plan) with merged, disjoint, non-adjacent half-open ranges. Values are read from inventory and rates
-- when a message is built, so only the latest state per cell is ever sent.
---------------------------------------------------------------------------------------------------------
create table distribution.ari_dirty (
  id                    uuid primary key,
  tenant_id             uuid not null,
  connection_id         uuid not null references distribution.connections(id),
  kind                  text not null check (kind in ('availability', 'restrictions')),
  unit_type_id          uuid not null,
  rate_plan_id          uuid,
  ranges                jsonb not null,
  merged_deltas         int not null,
  first_dirty_at        timestamptz not null,
  updated_at            timestamptz not null,
  check ((kind = 'availability') = (rate_plan_id is null))
);
create unique index ari_dirty_key_uq on distribution.ari_dirty
  (tenant_id, connection_id, kind, unit_type_id, rate_plan_id) nulls not distinct;
select core.enable_tenant_isolation('distribution.ari_dirty');

-- One hub request = one message. Its id is the idempotent message id (stable across retries); at most ONE open
-- message per (connection, kind): later changes are absorbed into it on its next attempt instead of queuing.
create table distribution.ari_messages (
  id                    uuid primary key,
  seq                   bigint generated always as identity,
  tenant_id             uuid not null,
  connection_id         uuid not null references distribution.connections(id),
  property_id           uuid not null,
  kind                  text not null check (kind in ('availability', 'restrictions')),
  trigger               text not null check (trigger in ('delta', 'resync', 'protection')),
  -- pending_verification: the hub answered 2xx in a shape Portico does not recognise (P2-3): nothing is assumed
  -- accepted; its cells show "pending verification" until a later recognised acceptance covers them.
  status                text not null check (status in ('queued', 'sending', 'accepted', 'partially_accepted',
                                                         'rejected', 'failed_transient', 'superseded',
                                                         'pending_verification')),
  cells                 jsonb not null,
  payload               jsonb not null,
  cell_count            int not null,
  value_count           int not null,
  coalesced_deltas      int not null default 0,
  -- The oldest Portico change this message carries (freshness: how long the channel has been behind).
  oldest_change_at      timestamptz not null,
  attempts              int not null default 0,
  lease_token           uuid,
  lease_until           timestamptz,
  next_attempt_at       timestamptz,
  first_failed_at       timestamptz,
  sent_at               timestamptz,
  accepted_at           timestamptz,
  last_error_class      text,
  last_error            text,
  rejected_cells        jsonb,
  provenance            text not null check (provenance in ('live', 'sandbox', 'simulated')),
  created_at            timestamptz not null,
  updated_at            timestamptz not null,
  version               int not null default 1
);
create unique index ari_messages_open_uq on distribution.ari_messages (tenant_id, connection_id, kind)
  where status in ('queued', 'sending', 'failed_transient');
create index ari_messages_conn_idx on distribution.ari_messages (tenant_id, connection_id, created_at desc);
select core.enable_tenant_isolation('distribution.ari_messages');

-- Per-connection ARI budget (sliding window: each slot returns 60 s after use, so never more than `limit` calls in
-- ANY 60-second window — a continuous-refill bucket of the same size would allow up to twice that).
create table distribution.ari_budget (
  tenant_id             uuid not null,
  connection_id         uuid not null references distribution.connections(id),
  kind                  text not null check (kind in ('availability', 'restrictions')),
  sends                 timestamptz[] not null default '{}',
  paused_until          timestamptz,
  primary key (tenant_id, connection_id, kind)
);
select core.enable_tenant_isolation('distribution.ari_budget');

-- Last-acknowledged channel state per cell (DST-R06, DST-I04): exactly the values of the last accepted message.
create table distribution.channel_state (
  tenant_id             uuid not null,
  connection_id         uuid not null references distribution.connections(id),
  kind                  text not null check (kind in ('availability', 'restrictions')),
  unit_type_id          uuid not null,
  rate_plan_id          uuid,
  stay_date             date not null,
  last_acked            jsonb not null,
  acked_message_id      uuid not null,
  acked_message_seq     bigint not null,
  acked_at              timestamptz not null
);
create unique index channel_state_cell_uq on distribution.channel_state
  (tenant_id, connection_id, kind, unit_type_id, rate_plan_id, stay_date) nulls not distinct;
select core.enable_tenant_isolation('distribution.channel_state');

-- Full resync requests (on connect, nightly, on demand). Non-destructive: they only re-send current values.
create table distribution.resync_runs (
  id                    uuid primary key,
  tenant_id             uuid not null,
  connection_id         uuid not null references distribution.connections(id),
  trigger               text not null check (trigger in ('connect', 'nightly', 'on_demand', 'resume', 'authority')),
  range_from            date not null,
  range_to              date not null,
  products_marked       int not null,
  requested_by          text not null,
  created_at            timestamptz not null
);
select core.enable_tenant_isolation('distribution.resync_runs');
select core.make_append_only('distribution.resync_runs');

-- Stop-sell: manual closures and automatic protection (DST-R07). Active rows change what is published.
create table distribution.stop_sells (
  id                    uuid primary key,
  tenant_id             uuid not null,
  connection_id         uuid not null references distribution.connections(id),
  property_id           uuid not null,
  source                text not null check (source in ('manual', 'protection')),
  unit_type_id          uuid,
  range_from            date not null,
  range_to              date not null,
  threshold             int,
  reason                text not null,
  status                text not null check (status in ('active', 'released')),
  created_by            text not null,
  created_at            timestamptz not null,
  released_by           text,
  released_at           timestamptz,
  release_reason        text,
  version               int not null default 1,
  check (range_from < range_to)
);
create unique index stop_sells_protection_uq on distribution.stop_sells (tenant_id, connection_id)
  where source = 'protection' and status = 'active';
select core.enable_tenant_isolation('distribution.stop_sells');

---------------------------------------------------------------------------------------------------------
-- Inbound booking revisions (DST-R08). The revision itself is IMMUTABLE (append-only), keyed by
-- (connection, channel booking id, revision id). Processing and acknowledgement state live beside it.
---------------------------------------------------------------------------------------------------------
create table distribution.inbound_revisions (
  id                    uuid primary key,
  tenant_id             uuid not null,
  connection_id         uuid not null references distribution.connections(id),
  property_id           uuid not null,
  channel_booking_id    text not null check (length(channel_booking_id) between 1 and 200),
  revision_id           text not null check (length(revision_id) between 1 and 200),
  -- Order within the booking (P1-2): the hub's ordinal when it gives one, the hub's timestamp in microseconds
  -- (UTC; null when absent or unreadable), lifecycle rank (new 0 < modified 1 < cancelled 2), then arrival.
  hub_sequence          bigint,
  hub_micros            bigint,
  lifecycle_rank        smallint not null check (lifecycle_rank in (0, 1, 2)),
  arrival_seq           bigint generated always as identity,
  channel_status        text not null check (channel_status in ('new', 'modified', 'cancelled')),
  payload               jsonb not null,
  payload_hash          text not null,
  received_via          text not null check (received_via in ('webhook', 'feed', 'recovery')),
  received_at           timestamptz not null,
  unique (tenant_id, connection_id, channel_booking_id, revision_id)
);
create index inbound_revisions_booking_idx on distribution.inbound_revisions
  (tenant_id, connection_id, channel_booking_id);
select core.enable_tenant_isolation('distribution.inbound_revisions');
select core.make_append_only('distribution.inbound_revisions');

create table distribution.revision_processing (
  revision_row_id       uuid primary key references distribution.inbound_revisions(id),
  tenant_id             uuid not null,
  connection_id         uuid not null references distribution.connections(id),
  property_id           uuid not null,
  channel_booking_id    text not null,
  -- Arrival order (copied from inbound_revisions.arrival_seq): the processing queue is first-in first-out; order
  -- within a booking is decided per booking (orderWithinBooking).
  arrival_seq           bigint not null,
  -- The number given to reservations when applied: strictly increasing per booking in the order Portico applies.
  apply_seq             int,
  state                 text not null check (state in ('received', 'applied', 'duplicate', 'stale', 'parked',
                                                        'rejected', 'failed')),
  park_reason           text check (park_reason in ('orphan', 'unmapped')),
  outcome               text,
  booking_id            uuid,
  note                  text,
  attempts              int not null default 0,
  next_attempt_at       timestamptz,
  first_failed_at       timestamptz,
  last_error            text,
  parked_since          timestamptz,
  escalated_at          timestamptz,
  hold_ids              jsonb not null default '[]',
  ack_state             text not null check (ack_state in ('not_due', 'pending', 'sending', 'acked', 'failed')),
  ack_attempts          int not null default 0,
  ack_next_at           timestamptz,
  ack_first_failed_at   timestamptz,
  ack_lease_token       uuid,
  ack_lease_until       timestamptz,
  acked_at              timestamptz,
  processed_at          timestamptz,
  resolved_by           text,
  updated_at            timestamptz not null,
  version               int not null default 1,
  -- DST-I02 at rest: an acknowledgement is only ever due for a revision whose outcome is final.
  check (ack_state = 'not_due' or state in ('applied', 'duplicate', 'stale', 'rejected'))
);
create index revision_processing_due_idx on distribution.revision_processing (tenant_id, property_id, state, next_attempt_at);
create index revision_processing_ack_idx on distribution.revision_processing (tenant_id, ack_state, ack_next_at);
create index revision_processing_booking_idx on distribution.revision_processing
  (tenant_id, connection_id, channel_booking_id);
select core.enable_tenant_isolation('distribution.revision_processing');

-- Webhook requests refused for a wrong or missing token (P2-5): ONE aggregated row per connection, never a row per
-- request (refused requests cost a bounded amount of storage; the in-memory guard answers 429 past its limit).
create table distribution.webhook_rejections (
  connection_id         uuid primary key references distribution.connections(id),
  tenant_id             uuid not null,
  rejected_total        bigint not null default 0,
  first_rejected_at     timestamptz not null,
  last_rejected_at      timestamptz not null
);
select core.enable_tenant_isolation('distribution.webhook_rejections');

-- Every authenticated delivery (webhook, feed pull, recovery), including duplicates: append-only. Unauthenticated
-- webhook requests are NOT logged here (webhook_rejections).
create table distribution.inbound_deliveries (
  id                    uuid primary key,
  tenant_id             uuid not null,
  connection_id         uuid not null references distribution.connections(id),
  revision_row_id       uuid,
  via                   text not null check (via in ('webhook', 'feed', 'recovery')),
  outcome               text not null check (outcome in ('stored', 'duplicate', 'conflict', 'notification',
                                                          'unauthenticated', 'property_mismatch', 'unparseable')),
  detail                jsonb,
  received_at           timestamptz not null
);
create index inbound_deliveries_conn_idx on distribution.inbound_deliveries (tenant_id, connection_id, received_at desc);
select core.enable_tenant_isolation('distribution.inbound_deliveries');
select core.make_append_only('distribution.inbound_deliveries');

---------------------------------------------------------------------------------------------------------
-- Exchange log (every hub call, append-only), exceptions (plain-language problems with a next step) and
-- discrepancies (Portico vs channel).
---------------------------------------------------------------------------------------------------------
create table distribution.exchange_log (
  id                    uuid primary key,
  tenant_id             uuid not null,
  connection_id         uuid not null references distribution.connections(id),
  direction             text not null check (direction in ('outbound', 'inbound')),
  operation             text not null,
  ref                   text,
  http_status           int,
  outcome               text not null,
  duration_ms           int,
  detail                jsonb,
  provenance            text not null check (provenance in ('live', 'sandbox', 'simulated')),
  occurred_at           timestamptz not null
);
create index exchange_log_conn_idx on distribution.exchange_log (tenant_id, connection_id, occurred_at desc);
select core.enable_tenant_isolation('distribution.exchange_log');
select core.make_append_only('distribution.exchange_log');

create table distribution.exceptions (
  id                    uuid primary key,
  tenant_id             uuid not null,
  connection_id         uuid not null references distribution.connections(id),
  property_id           uuid not null,
  code                  text not null,
  dedupe_key            text not null,
  severity              text not null check (severity in ('urgent', 'routine')),
  problem               text not null,
  business_impact       text not null,
  responsible_party     text not null check (responsible_party in ('hotel', 'monoclay', 'vendor')),
  next_step             text not null,
  refs                  jsonb not null default '[]',
  status                text not null check (status in ('open', 'resolved')),
  occurrences           int not null default 1,
  first_seen_at         timestamptz not null,
  last_seen_at          timestamptz not null,
  resolved_at           timestamptz,
  resolved_by           text,
  resolution            text,
  version               int not null default 1
);
create unique index exceptions_open_uq on distribution.exceptions (tenant_id, connection_id, dedupe_key)
  where status = 'open';
create index exceptions_status_idx on distribution.exceptions (tenant_id, status, severity);
select core.enable_tenant_isolation('distribution.exceptions');

create table distribution.discrepancies (
  id                    uuid primary key,
  tenant_id             uuid not null,
  connection_id         uuid not null references distribution.connections(id),
  property_id           uuid not null,
  kind                  text not null check (kind in ('availability', 'rate', 'reservation', 'mapping', 'field_loss', 'price')),
  dedupe_key            text not null,
  summary               text not null,
  refs                  jsonb not null default '[]',
  detail                jsonb not null default '{}',
  status                text not null check (status in ('open', 'investigating', 'resolved', 'accepted')),
  owner_user_id         uuid,
  detected_at           timestamptz not null,
  resolved_at           timestamptz,
  resolved_by           text,
  resolution            text,
  version               int not null default 1
);
create unique index discrepancies_open_uq on distribution.discrepancies (tenant_id, connection_id, dedupe_key)
  where status in ('open', 'investigating');
select core.enable_tenant_isolation('distribution.discrepancies');

---------------------------------------------------------------------------------------------------------
-- Simulated hub (an exact Channex API simulator, persisted so the API and the worker share it).
---------------------------------------------------------------------------------------------------------
create table distribution.sim_hubs (
  id                    text primary key,
  tenant_id             uuid not null,
  state                 jsonb not null,
  updated_at            timestamptz not null
);
select core.enable_tenant_isolation('distribution.sim_hubs');

---------------------------------------------------------------------------------------------------------
-- Scheduler index: when each organization next has distribution work due (event-driven: writers pull it
-- earlier; the job only wakes organizations that are due — it never scans source data).
---------------------------------------------------------------------------------------------------------
create table distribution.tenant_schedule (
  tenant_id             uuid primary key,
  next_due_at           timestamptz not null,
  lease_until           timestamptz
);
-- RLS enabled but not forced: tenants write their own row; the claim function (owner) reads across tenants.
alter table distribution.tenant_schedule enable row level security;
create policy tenant_isolation on distribution.tenant_schedule
  using (tenant_id = core.current_tenant_id()) with check (tenant_id = core.current_tenant_id());

---------------------------------------------------------------------------------------------------------
-- Webhook routing directory: maps the public endpoint id to its organization WITHOUT exposing tenant data.
-- Not readable by the application role; kept in sync by a trigger; read only through route_webhook().
-- A production hub property can be CLAIMED by one connection across all organizations, and only by proof of
-- control (P2-6): a connection claims it at its first successful Verify; an unproven connection never blocks one.
---------------------------------------------------------------------------------------------------------
create table distribution.webhook_directory (
  endpoint_id           uuid primary key,
  tenant_id             uuid not null,
  connection_id         uuid not null unique,
  hub                   text not null,
  external_property_id  text not null,
  target                text not null,
  active                boolean not null,
  claimed               boolean not null default false
);
create unique index webhook_directory_production_uq on distribution.webhook_directory (hub, external_property_id)
  where claimed and target = 'production';

create or replace function distribution.sync_webhook_directory() returns trigger
  language plpgsql security definer set search_path = distribution, pg_temp as $$
begin
  insert into distribution.webhook_directory (endpoint_id, tenant_id, connection_id, hub, external_property_id, target,
                                             active, claimed)
    values (new.webhook_endpoint_id, new.tenant_id, new.id, new.hub, new.external_property_id, new.target,
            new.status <> 'disconnected', new.status <> 'disconnected' and new.verified_at is not null)
    on conflict (connection_id) do update
      set endpoint_id = excluded.endpoint_id, external_property_id = excluded.external_property_id,
          target = excluded.target, active = excluded.active, claimed = excluded.claimed;
  return new;
end $$;
create trigger sync_webhook_directory after insert or update on distribution.connections
  for each row execute function distribution.sync_webhook_directory();

create or replace function distribution.route_webhook(p_endpoint_id uuid)
  returns table (tenant_id uuid, connection_id uuid, environment text)
  language sql stable security definer set search_path = distribution, pg_temp as $$
    select d.tenant_id, d.connection_id, e.env
      from distribution.webhook_directory d
      cross join lateral (select platform.tenant_environment(d.tenant_id) as env) e
     where d.endpoint_id = p_endpoint_id
       and d.active
       and e.env is not null
$$;

-- Whether ANOTHER connection (any organization) holds the proven claim on this hub property. Reveals one bit, only
-- for the caller's own connection's hub property; used to refuse Verify before any hub call (P2-6).
create or replace function distribution.hub_property_claimed_elsewhere(p_connection_id uuid)
  returns boolean
  language sql stable security definer set search_path = distribution, pg_temp as $$
    select exists (
      select 1
        from distribution.webhook_directory mine
        join distribution.webhook_directory other
          on other.hub = mine.hub and other.external_property_id = mine.external_property_id
         and other.target = mine.target and other.connection_id <> mine.connection_id
       where mine.connection_id = p_connection_id
         and mine.tenant_id = core.current_tenant_id()
         and mine.target = 'production'
         and other.claimed)
$$;

create or replace function distribution.claim_due_tenants(p_now timestamptz, p_limit int, p_lease_seconds int)
  returns table (tenant_id uuid, environment text)
  language sql security definer set search_path = distribution, pg_temp as $$
    with claimed as (
      update distribution.tenant_schedule s
         set lease_until = p_now + make_interval(secs => p_lease_seconds)
       where s.tenant_id in (
         select x.tenant_id from distribution.tenant_schedule x
          where x.next_due_at <= p_now
            and (x.lease_until is null or x.lease_until < p_now)
          order by x.next_due_at
          limit p_limit
          for update skip locked)
      returning s.tenant_id)
    select c.tenant_id, platform.tenant_environment(c.tenant_id) from claimed c
$$;

select core.apply_standard_grants('distribution');
revoke all on distribution.webhook_directory from portico_app;
revoke execute on function distribution.sync_webhook_directory() from public, portico_app;
revoke execute on function distribution.route_webhook(uuid) from public;
revoke execute on function distribution.claim_due_tenants(timestamptz, int, int) from public;
revoke execute on function distribution.hub_property_claimed_elsewhere(uuid) from public;
grant execute on function distribution.hub_property_claimed_elsewhere(uuid) to portico_app;
grant execute on function distribution.route_webhook(uuid) to portico_app;
grant execute on function distribution.claim_due_tenants(timestamptz, int, int) to portico_app;
