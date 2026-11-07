-- Core platform infrastructure owned by @portico/db: helpers, outbox, idempotency, audit.
create extension if not exists btree_gist;
create extension if not exists pg_trgm;

create schema if not exists core;

-- Current tenant from the transaction-local setting. NULL when unset → RLS fails closed (no rows visible,
-- inserts rejected).
create or replace function core.current_tenant_id() returns uuid
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- Standard grants for a module schema to the application role.
create or replace function core.apply_standard_grants(target_schema text) returns void
  language plpgsql as $$
begin
  execute format('grant usage on schema %I to portico_app', target_schema);
  execute format('grant select, insert, update, delete on all tables in schema %I to portico_app', target_schema);
  execute format('grant usage, select on all sequences in schema %I to portico_app', target_schema);
  execute format('grant execute on all functions in schema %I to portico_app', target_schema);
end $$;

-- Enable + force row-level security with the standard tenant policy. Every tenant-owned table calls this.
create or replace function core.enable_tenant_isolation(target regclass) returns void
  language plpgsql as $$
begin
  execute format('alter table %s enable row level security', target);
  execute format('alter table %s force row level security', target);
  execute format('drop policy if exists tenant_isolation on %s', target);
  execute format(
    'create policy tenant_isolation on %s using (tenant_id = core.current_tenant_id()) with check (tenant_id = core.current_tenant_id())',
    target);
end $$;

create or replace function core.reject_mutation() returns trigger
  language plpgsql as $$
begin
  raise exception 'Table %.% is append-only: % is not allowed. Record a correcting entry instead.',
    tg_table_schema, tg_table_name, tg_op using errcode = 'P0001';
end $$;

-- Make a table append-only for everyone (grants + trigger as defense in depth).
create or replace function core.make_append_only(target regclass) returns void
  language plpgsql as $$
begin
  execute format('revoke update, delete, truncate on %s from portico_app', target);
  execute format('drop trigger if exists append_only on %s', target);
  execute format('create trigger append_only before update or delete on %s for each row execute function core.reject_mutation()', target);
end $$;

-- Keep updated_at fresh.
create or replace function core.touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

---------------------------------------------------------------------------------------------------------
-- Transactional outbox
---------------------------------------------------------------------------------------------------------
create table core.outbox (
  id              uuid primary key,
  tenant_id       uuid not null,
  type            text not null,
  property_id     uuid,
  aggregate_type  text not null,
  aggregate_id    text not null,
  payload         jsonb not null,
  actor           jsonb not null,
  correlation_id  text not null,
  version         int  not null default 1,
  occurred_at     timestamptz not null,
  created_at      timestamptz not null default clock_timestamp(),
  fanned_out_at   timestamptz
);
create index outbox_unfanned_idx on core.outbox (created_at) where fanned_out_at is null;
create index outbox_tenant_type_idx on core.outbox (tenant_id, type, created_at);
-- RLS enabled but NOT forced: the owner (used only by reviewed SECURITY DEFINER functions) can fan out.
alter table core.outbox enable row level security;
create policy tenant_isolation on core.outbox
  using (tenant_id = core.current_tenant_id()) with check (tenant_id = core.current_tenant_id());

create table core.event_deliveries (
  event_id        uuid not null references core.outbox(id),
  consumer        text not null,
  tenant_id       uuid not null,
  status          text not null default 'pending' check (status in ('pending', 'done', 'failed', 'dead')),
  attempts        int  not null default 0,
  next_attempt_at timestamptz not null default clock_timestamp(),
  locked_until    timestamptz,
  last_error      text,
  processed_at    timestamptz,
  primary key (event_id, consumer)
);
create index event_deliveries_due_idx on core.event_deliveries (next_attempt_at) where status in ('pending', 'failed');
alter table core.event_deliveries enable row level security;
create policy tenant_isolation on core.event_deliveries
  using (tenant_id = core.current_tenant_id()) with check (tenant_id = core.current_tenant_id());

-- Cross-tenant dispatcher primitives. SECURITY DEFINER: run as owner, return only routing metadata.
create or replace function core.claim_unfanned_events(batch int)
  returns table (id uuid, tenant_id uuid, type text)
  language sql security definer set search_path = core, pg_temp as $$
    select o.id, o.tenant_id, o.type from core.outbox o
    where o.fanned_out_at is null
    order by o.created_at
    limit batch
    for update skip locked
$$;

create or replace function core.record_fanout(p_event_id uuid, p_consumers text[]) returns void
  language plpgsql security definer set search_path = core, pg_temp as $$
begin
  insert into core.event_deliveries (event_id, consumer, tenant_id)
    select o.id, c, o.tenant_id from core.outbox o, unnest(p_consumers) c where o.id = p_event_id
    on conflict do nothing;
  update core.outbox set fanned_out_at = clock_timestamp() where id = p_event_id;
end $$;

create or replace function core.claim_deliveries(batch int, lease_seconds int)
  returns table (event_id uuid, consumer text, tenant_id uuid, attempts int)
  language sql security definer set search_path = core, pg_temp as $$
    update core.event_deliveries d
       set locked_until = clock_timestamp() + make_interval(secs => lease_seconds),
           attempts = d.attempts + 1
     where (d.event_id, d.consumer) in (
       select x.event_id, x.consumer from core.event_deliveries x
        where x.status in ('pending', 'failed')
          and x.next_attempt_at <= clock_timestamp()
          and (x.locked_until is null or x.locked_until < clock_timestamp())
        order by x.next_attempt_at
        limit batch
        for update skip locked)
    returning d.event_id, d.consumer, d.tenant_id, d.attempts
$$;

create or replace function core.record_delivery_failure(p_event_id uuid, p_consumer text, p_error text, p_max_attempts int)
  returns void language sql security definer set search_path = core, pg_temp as $$
    update core.event_deliveries
       set status = case when attempts >= p_max_attempts then 'dead' else 'failed' end,
           last_error = left(p_error, 4000),
           locked_until = null,
           next_attempt_at = clock_timestamp() + make_interval(secs => least(3600, (2 ^ least(attempts, 12))::int))
     where event_id = p_event_id and consumer = p_consumer
$$;

---------------------------------------------------------------------------------------------------------
-- Idempotency (stored in the same transaction as the business effect)
---------------------------------------------------------------------------------------------------------
create table core.idempotency_keys (
  tenant_id       uuid not null,
  scope           text not null,
  key             text not null,
  request_hash    text not null,
  response_status int,
  response_body   jsonb,
  created_at      timestamptz not null default clock_timestamp(),
  completed_at    timestamptz,
  primary key (tenant_id, scope, key)
);
select core.enable_tenant_isolation('core.idempotency_keys');

---------------------------------------------------------------------------------------------------------
-- Audit log (append-only)
---------------------------------------------------------------------------------------------------------
create table core.audit_log (
  id             uuid primary key,
  tenant_id      uuid not null,
  property_id    uuid,
  occurred_at    timestamptz not null,
  actor          jsonb not null,
  actor_key      text not null,
  action         text not null,
  target_type    text not null,
  target_id      text not null,
  reason         text,
  before         jsonb,
  after          jsonb,
  metadata       jsonb,
  correlation_id text not null
);
create index audit_log_target_idx on core.audit_log (tenant_id, target_type, target_id, occurred_at);
create index audit_log_actor_idx on core.audit_log (tenant_id, actor_key, occurred_at);
select core.enable_tenant_isolation('core.audit_log');

-- Grants: tables to the app role; DDL helpers are NOT executable by the app role.
grant usage on schema core to portico_app;
grant select, insert, update, delete on all tables in schema core to portico_app;
revoke delete, truncate on core.outbox from portico_app;
revoke execute on all functions in schema core from public;
grant execute on function
  core.current_tenant_id(),
  core.claim_unfanned_events(int),
  core.record_fanout(uuid, text[]),
  core.claim_deliveries(int, int),
  core.record_delivery_failure(uuid, text, text, int)
to portico_app;
select core.make_append_only('core.audit_log');
