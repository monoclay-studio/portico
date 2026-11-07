-- Operations: unit condition & occupancy (housekeeping view of each unit), housekeeping tasks and assignments,
-- inspections, generic tasks with SLA escalation, service requests, maintenance work orders, assets, preventive
-- schedules, lost & found, offline sync dedupe and forwarded room-status changes (connected mode).
-- Change feed for the offline staff app: every write stamps `feed_xid = pg_current_xact_id()`. A delta pull
-- returns rows with feed_xid >= the reader's previous snapshot xmin, so a change committed late by a
-- long-running transaction can never be skipped (at-least-once, clients upsert by version).
-- No foreign keys into other schemas: unit, stay, guest, department and user ids are references only.
create schema operations;

---------------------------------------------------------------------------------------------------------
-- Sections (island zones, jetties, buildings, floors) used for housekeeping workload and boards
---------------------------------------------------------------------------------------------------------
create table operations.sections (
  id          uuid primary key,
  tenant_id   uuid not null,
  property_id uuid not null,
  code        text not null,
  name        text not null,
  kind        text not null check (kind in ('island_zone', 'jetty', 'building', 'wing', 'floor', 'section')),
  parent_id   uuid references operations.sections(id),
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  version     int  not null default 1,
  unique (tenant_id, property_id, code)
);
select core.enable_tenant_isolation('operations.sections');

---------------------------------------------------------------------------------------------------------
-- Unit status: one row per unit (id = inventory unit id). Condition and physical occupancy are SEPARATE fields.
---------------------------------------------------------------------------------------------------------
create table operations.unit_status (
  id                      uuid primary key,          -- inventory unit id (reference, no FK)
  tenant_id               uuid not null,
  property_id             uuid not null,
  unit_number             text not null,
  unit_type_id            uuid,
  unit_type_code          text,
  section_id              uuid references operations.sections(id),
  floor                   text,
  location_path           text,
  features                text[] not null default '{}',
  active                  boolean not null default true,
  condition               text not null check (condition in ('dirty', 'cleaning', 'clean', 'inspected', 'failed_inspection')),
  condition_changed_at    timestamptz not null,
  condition_changed_by    text not null,
  -- physical occupancy derived from in-house stays (stay projection)
  occupancy               text not null default 'vacant' check (occupancy in ('vacant', 'occupied')),
  occupancy_stay_id       uuid,
  -- what housekeeping physically observed, and the resulting discrepancy (never auto-corrected)
  observed_occupancy      text check (observed_occupancy in ('vacant', 'occupied', 'occupied_no_luggage')),
  observed_at             timestamptz,
  observed_by             text,
  discrepancy             text not null default 'none' check (discrepancy in ('none', 'skip', 'sleep', 'occupied_no_luggage')),
  dnd                     boolean not null default false,
  dnd_since               timestamptz,
  turndown                text not null default 'not_required' check (turndown in ('not_required', 'pending', 'done', 'declined')),
  -- readiness for the next arrival
  ready_at                timestamptz,
  expected_ready_at       timestamptz,
  readiness               jsonb not null default '{}',
  last_cleaned_at         timestamptz,
  last_cleaned_by         text,
  last_inspected_at       timestamptz,
  last_inspection_id      uuid,
  last_inspection_result  text check (last_inspection_result in ('passed', 'failed')),
  -- inventory block (out of order / out of service) mirrored from inventory
  block_kind              text check (block_kind in ('out_of_order', 'out_of_service', 'house_use')),
  block_id                uuid,
  block_from              date,
  block_to                date,
  block_reason            text,
  block_work_order_id     uuid,
  -- connected mode: a change forwarded to the external system of record and not yet acknowledged
  pending_forward_id      uuid,
  pending_change          jsonb,
  provenance              text not null default 'live' check (provenance in ('live', 'external', 'copied', 'simulated')),
  external_synced_at      timestamptz,
  feed_xid                xid8 not null default pg_current_xact_id(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  version                 int not null default 1,
  unique (tenant_id, property_id, unit_number)
);
select core.enable_tenant_isolation('operations.unit_status');
create index unit_status_property_idx on operations.unit_status (tenant_id, property_id, condition);
create index unit_status_feed_idx on operations.unit_status (tenant_id, property_id, feed_xid, id);

-- Append-only history of condition / occupancy-report / DND changes (who, when, why, from which source).
create table operations.unit_status_log (
  id                 uuid primary key,
  tenant_id          uuid not null,
  property_id        uuid not null,
  unit_id            uuid not null,
  field              text not null check (field in ('condition', 'observed_occupancy', 'dnd', 'turndown', 'occupancy', 'block')),
  from_value         text,
  to_value           text,
  reason             text,
  source             text not null check (source in ('staff', 'mobile_sync', 'event', 'inspection', 'task', 'external', 'forward_ack', 'system')),
  version_after      int not null,
  actor              jsonb not null,
  actor_key          text not null,
  occurred_at        timestamptz not null,
  client_occurred_at timestamptz,
  metadata           jsonb
);
select core.enable_tenant_isolation('operations.unit_status_log');
select core.make_append_only('operations.unit_status_log');
create index unit_status_log_unit_idx on operations.unit_status_log (tenant_id, unit_id, occurred_at);

---------------------------------------------------------------------------------------------------------
-- Stay projection: operations' read model of stays that occupy or will occupy units (fed by reservations
-- events or by an external PMS feed). Operations never calls reservations synchronously (no cycle).
---------------------------------------------------------------------------------------------------------
create table operations.stay_projection (
  id                uuid primary key,              -- stay id (reference)
  tenant_id         uuid not null,
  property_id       uuid not null,
  booking_id        uuid,
  unit_id           uuid,
  arrival           date not null,
  departure         date not null,
  status            text not null check (status in ('expected', 'in_house', 'departed', 'cancelled', 'no_show')),
  guest_profile_id  uuid,
  guest_label       text,                            -- display label only (e.g. "Mr & Mrs Rasheed"), no other PII
  vip               boolean not null default false,
  early_check_in    boolean not null default false,
  eta               timestamptz,
  source            text not null default 'event' check (source in ('event', 'external', 'manual')),
  updated_at        timestamptz not null default now(),
  check (departure > arrival)
);
select core.enable_tenant_isolation('operations.stay_projection');
create index stay_projection_unit_idx on operations.stay_projection (tenant_id, unit_id, arrival);
create index stay_projection_arrival_idx on operations.stay_projection (tenant_id, property_id, arrival);

---------------------------------------------------------------------------------------------------------
-- Housekeeping roster (attendants) — workload capacity in credits per day and home sections.
---------------------------------------------------------------------------------------------------------
create table operations.attendants (
  id                    uuid primary key,
  tenant_id             uuid not null,
  property_id           uuid not null,
  user_id               uuid not null,             -- identity staff member (reference)
  display_name          text not null,
  home_section_ids      uuid[] not null default '{}',
  daily_credit_capacity int  not null check (daily_credit_capacity > 0),
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  version               int not null default 1,
  unique (tenant_id, property_id, user_id)
);
select core.enable_tenant_isolation('operations.attendants');

---------------------------------------------------------------------------------------------------------
-- Tasks: any unit of work (cleaning, inspection, service request, work order, guest commitment, general).
---------------------------------------------------------------------------------------------------------
create table operations.tasks (
  id                   uuid primary key,
  tenant_id            uuid not null,
  property_id          uuid not null,
  department_kind      text not null,               -- housekeeping, engineering, front_office, guest_services, …
  department_id        uuid,                         -- platform department (reference), when configured
  kind                 text not null check (kind in ('departure_clean', 'vacant_clean', 'stayover', 'turndown', 'deep_clean',
                                                     'inspection', 'reclean', 'service_request', 'work_order',
                                                     'guest_commitment', 'general')),
  title                text not null,
  description          text,
  status               text not null check (status in ('open', 'in_progress', 'blocked', 'done', 'verified', 'cancelled')),
  priority             text not null check (priority in ('low', 'normal', 'high', 'urgent')),
  priority_score       int  not null default 0,
  priority_reasons     text[] not null default '{}',
  unit_id              uuid,
  stay_id              uuid,
  guest_profile_id     uuid,
  parent_task_id       uuid references operations.tasks(id),
  refs                 jsonb not null default '[]',
  assignee_user_id     uuid,
  assignee_name        text,
  service_date         date,
  due_at               timestamptz,
  credits              int not null default 0 check (credits >= 0),
  blocked_reason       text,
  cancelled_reason     text,
  started_at           timestamptz,
  done_at              timestamptz,
  done_by              text,
  verified_at          timestamptz,
  verified_by          text,
  cancelled_at         timestamptz,
  escalation_path      jsonb not null default '[]',
  escalation_level     int not null default 0,
  next_escalation_at   timestamptz,
  last_escalated_at    timestamptz,
  source               text not null check (source in ('manual', 'event', 'day_plan', 'service_request', 'work_order', 'inspection', 'preventive', 'mobile_sync', 'system')),
  dedupe_key           text,
  created_by           text not null,
  created_at           timestamptz not null,
  updated_at           timestamptz not null,
  feed_xid             xid8 not null default pg_current_xact_id(),
  version              int not null default 1,
  unique (tenant_id, dedupe_key),
  check (status <> 'blocked' or blocked_reason is not null),
  check (status <> 'cancelled' or cancelled_reason is not null)
);
select core.enable_tenant_isolation('operations.tasks');
create index tasks_property_status_idx on operations.tasks (tenant_id, property_id, status, kind);
create index tasks_unit_idx on operations.tasks (tenant_id, unit_id, status);
create index tasks_assignee_idx on operations.tasks (tenant_id, assignee_user_id, status);
create index tasks_escalation_idx on operations.tasks (tenant_id, property_id, next_escalation_at)
  where next_escalation_at is not null;
create index tasks_feed_idx on operations.tasks (tenant_id, property_id, feed_xid, id);

-- Append-only task history: status changes, assignments, comments, attachments (object-store refs), escalations.
create table operations.task_activity (
  id                 uuid primary key,
  tenant_id          uuid not null,
  property_id        uuid not null,
  task_id            uuid not null references operations.tasks(id),
  kind               text not null check (kind in ('created', 'status_changed', 'assigned', 'comment', 'attachment',
                                                   'escalated', 'priority_changed', 'due_changed')),
  from_value         text,
  to_value           text,
  comment            text,
  attachments        jsonb,
  task_version       int not null,
  source             text not null,
  actor              jsonb not null,
  actor_key          text not null,
  occurred_at        timestamptz not null,
  client_occurred_at timestamptz
);
select core.enable_tenant_isolation('operations.task_activity');
select core.make_append_only('operations.task_activity');
create index task_activity_task_idx on operations.task_activity (tenant_id, task_id, occurred_at);

---------------------------------------------------------------------------------------------------------
-- Service requests (guest-originated). Fulfilled only when the backing task is done.
---------------------------------------------------------------------------------------------------------
create table operations.service_requests (
  id               uuid primary key,
  tenant_id        uuid not null,
  property_id      uuid not null,
  number           text not null,
  task_id          uuid not null references operations.tasks(id),
  stay_id          uuid,
  guest_profile_id uuid,
  unit_id          uuid,
  channel          text not null check (channel in ('desk', 'phone', 'guest_portal', 'messaging', 'in_person', 'other')),
  category         text not null,
  description      text not null,
  status           text not null check (status in ('open', 'in_progress', 'fulfilled', 'cancelled')),
  requested_at     timestamptz not null,
  fulfilled_at     timestamptz,
  created_at       timestamptz not null,
  version          int not null default 1,
  unique (tenant_id, number),
  unique (tenant_id, task_id)
);
select core.enable_tenant_isolation('operations.service_requests');
create index service_requests_property_idx on operations.service_requests (tenant_id, property_id, status);

---------------------------------------------------------------------------------------------------------
-- Inspections: checklist templates and immutable inspection records.
---------------------------------------------------------------------------------------------------------
create table operations.checklist_templates (
  id           uuid primary key,
  tenant_id    uuid not null,
  property_id  uuid not null,
  code         text not null,
  name         text not null,
  purpose      text not null check (purpose in ('unit', 'public_area', 'return_to_service', 'asset')),
  items        jsonb not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  version      int not null default 1,
  unique (tenant_id, property_id, code)
);
select core.enable_tenant_isolation('operations.checklist_templates');

create table operations.inspections (
  id                   uuid primary key,
  tenant_id            uuid not null,
  property_id          uuid not null,
  unit_id              uuid not null,
  task_id              uuid,
  checklist_code       text,
  checklist_version    int,
  items                jsonb not null,
  result               text not null check (result in ('passed', 'failed')),
  failure_reasons      jsonb not null default '[]',
  notes                text,
  inspector            jsonb not null,
  inspector_key        text not null,
  inspected_at         timestamptz not null,
  client_inspected_at  timestamptz,
  cleaned_by_user_id   uuid,
  reclean_task_id      uuid,
  affected_stay_id     uuid,
  work_order_id        uuid,
  created_at           timestamptz not null
);
select core.enable_tenant_isolation('operations.inspections');
select core.make_append_only('operations.inspections');
create index inspections_unit_idx on operations.inspections (tenant_id, unit_id, inspected_at);

---------------------------------------------------------------------------------------------------------
-- Maintenance: assets/locations, work orders, front-office resolution items, preventive schedules.
---------------------------------------------------------------------------------------------------------
create table operations.assets (
  id               uuid primary key,
  tenant_id        uuid not null,
  property_id      uuid not null,
  kind             text not null check (kind in ('unit', 'public_area', 'equipment')),
  code             text not null,
  name             text not null,
  category         text not null,                   -- e.g. villa, pool, ac_unit, ladder, generator, desalination
  unit_id          uuid,                             -- for unit assets and equipment installed in a unit
  parent_asset_id  uuid references operations.assets(id),
  section_id       uuid references operations.sections(id),
  location_path    text,
  manufacturer     text,
  model            text,
  serial_number    text,
  installed_on     date,
  status           text not null default 'active' check (status in ('active', 'retired')),
  created_at       timestamptz not null default now(),
  version          int not null default 1,
  unique (tenant_id, property_id, code)
);
select core.enable_tenant_isolation('operations.assets');
create unique index assets_unit_asset_uidx on operations.assets (tenant_id, unit_id) where kind = 'unit';
create index assets_category_idx on operations.assets (tenant_id, property_id, category);

create table operations.preventive_schedules (
  id                   uuid primary key,
  tenant_id            uuid not null,
  property_id          uuid not null,
  code                 text not null,
  title                text not null,
  description          text,
  asset_id             uuid references operations.assets(id),
  asset_category       text,
  fault_category       text not null,
  urgency              text not null check (urgency in ('low', 'normal', 'high', 'emergency')),
  interval_unit        text not null check (interval_unit in ('day', 'week', 'month')),
  interval_count       int  not null check (interval_count > 0),
  next_due_on          date not null,
  lead_days            int  not null default 0 check (lead_days >= 0),
  checklist_code       text,
  active               boolean not null default true,
  last_run_at          timestamptz,
  created_at           timestamptz not null default now(),
  version              int not null default 1,
  unique (tenant_id, property_id, code),
  check ((asset_id is not null) <> (asset_category is not null))
);
select core.enable_tenant_isolation('operations.preventive_schedules');

create table operations.work_orders (
  id                        uuid primary key,
  tenant_id                 uuid not null,
  property_id               uuid not null,
  number                    text not null,
  task_id                   uuid not null references operations.tasks(id),
  asset_id                  uuid references operations.assets(id),
  unit_id                   uuid,
  location_text             text,
  fault_category            text not null,
  urgency                   text not null check (urgency in ('low', 'normal', 'high', 'emergency')),
  photos                    jsonb not null default '[]',
  parts                     jsonb not null default '[]',
  resolution_note           text,
  completed_at              timestamptz,
  -- effect on sellable inventory
  block_kind                text check (block_kind in ('out_of_order', 'out_of_service')),
  block_from                date,
  block_to                  date,
  block_reason              text,
  block_id                  uuid,
  block_status              text not null default 'none' check (block_status in ('none', 'pending_forward', 'active', 'released')),
  return_to_service_status  text not null default 'not_applicable'
                              check (return_to_service_status in ('not_applicable', 'awaiting_completion', 'awaiting_inspection', 'ready', 'returned')),
  returned_to_service_at    timestamptz,
  preventive_schedule_id    uuid references operations.preventive_schedules(id),
  preventive_due_on         date,
  authority_state           text not null default 'effective' check (authority_state in ('effective', 'pending_forward')),
  reported_by               text not null,
  reported_via              text not null default 'staff' check (reported_via in ('staff', 'mobile_sync', 'preventive', 'guest', 'inspection')),
  created_at                timestamptz not null,
  feed_xid                  xid8 not null default pg_current_xact_id(),
  version                   int not null default 1,
  unique (tenant_id, number),
  unique (tenant_id, task_id)
);
select core.enable_tenant_isolation('operations.work_orders');
create index work_orders_asset_idx on operations.work_orders (tenant_id, asset_id, created_at);
create index work_orders_unit_idx on operations.work_orders (tenant_id, unit_id, created_at);
create index work_orders_feed_idx on operations.work_orders (tenant_id, property_id, feed_xid, id);

-- Stays affected by an out-of-order / out-of-service block: front office must resolve each one (scenario 8).
create table operations.resolution_items (
  id               uuid primary key,
  tenant_id        uuid not null,
  property_id      uuid not null,
  unit_id          uuid not null,
  block_id         uuid not null,
  work_order_id    uuid references operations.work_orders(id),
  ref_type         text not null,
  ref_id           uuid not null,
  nights_from      date not null,
  nights_to        date not null,
  status           text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution_note  text,
  resolved_by      text,
  resolved_at      timestamptz,
  created_at       timestamptz not null,
  version          int not null default 1,
  unique (tenant_id, block_id, ref_type, ref_id)
);
select core.enable_tenant_isolation('operations.resolution_items');
create index resolution_items_open_idx on operations.resolution_items (tenant_id, property_id, status);

---------------------------------------------------------------------------------------------------------
-- Lost & found
---------------------------------------------------------------------------------------------------------
create table operations.lost_found_items (
  id                       uuid primary key,
  tenant_id                uuid not null,
  property_id              uuid not null,
  number                   text not null,
  description              text not null,
  category                 text not null,
  high_value               boolean not null default false,
  found_at                 timestamptz not null,
  found_location           text not null,
  found_unit_id            uuid,
  finder                   text not null,
  finder_user_id           uuid,
  storage_location         text not null,
  photos                   jsonb not null default '[]',
  status                   text not null check (status in ('stored', 'matched', 'released', 'disposed')),
  matched_guest_profile_id uuid,
  matched_stay_id          uuid,
  matched_note             text,
  released_to              text,
  release_signature_ref    text,
  released_at              timestamptz,
  disposal_method          text check (disposal_method in ('donated', 'destroyed', 'handed_to_authorities', 'returned_to_finder')),
  disposal_signature_ref   text,
  disposal_reason          text,
  disposed_at              timestamptz,
  retention_until          date not null,
  created_at               timestamptz not null,
  version                  int not null default 1,
  unique (tenant_id, number),
  check (status <> 'released' or (released_to is not null and release_signature_ref is not null)),
  check (status <> 'disposed' or (disposal_method is not null and disposal_signature_ref is not null))
);
select core.enable_tenant_isolation('operations.lost_found_items');
create index lost_found_property_idx on operations.lost_found_items (tenant_id, property_id, status);

---------------------------------------------------------------------------------------------------------
-- Connected mode: room-status / maintenance changes forwarded to the external system of record. A change is
-- effective in Portico only once acknowledged (ADR-0014). Delivery is performed by the integration module.
---------------------------------------------------------------------------------------------------------
create table operations.status_forwards (
  id               uuid primary key,
  tenant_id        uuid not null,
  property_id      uuid not null,
  domain           text not null check (domain in ('roomStatus', 'maintenance')),
  connection_id    uuid,
  target_type      text not null check (target_type in ('unit', 'work_order')),
  target_id        uuid not null,
  change           jsonb not null,
  status           text not null default 'pending' check (status in ('pending', 'acknowledged', 'rejected', 'superseded')),
  requested_by     text not null,
  requested_at     timestamptz not null,
  resolved_at      timestamptz,
  external_ref     text,
  rejection_reason text,
  version          int not null default 1
);
select core.enable_tenant_isolation('operations.status_forwards');
create index status_forwards_pending_idx on operations.status_forwards (tenant_id, property_id, status);

---------------------------------------------------------------------------------------------------------
-- Offline sync: per-mutation dedupe with the stored outcome (written in the same transaction as the effect).
---------------------------------------------------------------------------------------------------------
create table operations.sync_mutations (
  tenant_id           uuid not null,
  client_mutation_id  text not null,
  device_id           text not null,
  actor_key           text not null,
  request_hash        text not null,
  property_id         uuid not null,
  entity_type         text not null,
  entity_id           uuid,
  op                  text not null,
  outcome             text not null check (outcome in ('applied', 'pending', 'conflict', 'rejected')),
  base_version        int,
  result_version      int,
  result              jsonb not null,
  client_occurred_at  timestamptz not null,
  processed_at        timestamptz not null,
  primary key (tenant_id, client_mutation_id)
);
select core.enable_tenant_isolation('operations.sync_mutations');

select core.apply_standard_grants('operations');
-- Append-only tables lose update/delete again after the standard grants.
select core.make_append_only('operations.unit_status_log');
select core.make_append_only('operations.task_activity');
select core.make_append_only('operations.inspections');
