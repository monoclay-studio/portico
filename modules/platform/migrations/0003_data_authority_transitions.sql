-- Data authority hardening (docs/adoption/gap-assessment.md G-01, G-02, G-06, G-07;
-- docs/adoption/source-of-truth-matrix.md §3 and §6).

-- G-06: tenth governed domain `guestCommunications`. G-07: the constraint now matches the service rule exactly.
-- The 0001 checks were unnamed; drop them by definition so this works whatever names Postgres generated.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'platform.data_authority'::regclass and contype = 'c'
       and (pg_get_constraintdef(oid) ilike '%connection_id%' or pg_get_constraintdef(oid) ilike '%reservations%')
  loop
    execute format('alter table platform.data_authority drop constraint %I', c.conname);
  end loop;
end $$;

alter table platform.data_authority
  add constraint data_authority_domain_check check (domain in ('reservations', 'availability', 'rates',
    'guestProfiles', 'charges', 'payments', 'roomStatus', 'maintenance', 'accounting', 'guestCommunications')),
  add constraint data_authority_connection_check check (
    (authority = 'portico' and connection_id is null) or (authority = 'external' and connection_id is not null)),
  -- G-01: external + exclusive is meaningless (read_only already says "only the other system writes").
  add constraint data_authority_write_mode_combination_check check (
    (authority = 'portico' and write_mode = 'exclusive') or (authority = 'external' and write_mode in ('read_only', 'forward')));
-- connection_id references integration.connections once that module exists; no cross-module FK (module boundary).

-- G-02: version history, one row per version. Append-only except that the open row's effective_to is set once,
-- when the next version takes over.
create table platform.data_authority_history (
  id              uuid primary key,
  tenant_id       uuid not null,
  property_id     uuid not null references platform.properties(id),
  domain          text not null,
  version         int not null,
  authority       text not null,
  connection_id   uuid,
  system_name     text,
  write_mode      text not null,
  effective_from  timestamptz not null,
  effective_to    timestamptz,
  changed_by      text not null,
  approved_by     text,
  reason          text not null,
  transition_id   uuid,
  unique (property_id, domain, version)
);
create unique index data_authority_history_open_idx on platform.data_authority_history (property_id, domain)
  where effective_to is null;
select core.enable_tenant_isolation('platform.data_authority_history');

create or replace function platform.data_authority_history_guard() returns trigger
  language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'platform.data_authority_history is append-only' using errcode = 'P0001';
  end if;
  if old.effective_to is not null or new.effective_to is null
     or (to_jsonb(new) - 'effective_to') <> (to_jsonb(old) - 'effective_to') then
    raise exception 'platform.data_authority_history is append-only: only closing the current version is allowed'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger append_only before update or delete on platform.data_authority_history
  for each row execute function platform.data_authority_history_guard();

-- Existing explicit authorities become version rows (fresh databases have none).
insert into platform.data_authority_history (id, tenant_id, property_id, domain, version, authority, connection_id,
                                             system_name, write_mode, effective_from, changed_by, reason)
  select gen_random_uuid(), tenant_id, property_id, domain, version, authority, connection_id, system_name, write_mode,
         effective_from, updated_by, reason
    from platform.data_authority;

-- G-02: authority transitions planned → frozen → effective | cancelled (one transaction may move several domains).
create table platform.data_authority_transitions (
  id                 uuid primary key,
  tenant_id          uuid not null,
  property_id        uuid not null references platform.properties(id),
  changes            jsonb not null,           -- [{ domain, authority, connectionId, systemName, writeMode }]
  status             text not null check (status in ('planned', 'frozen', 'effective', 'cancelled')),
  reason             text not null,
  rollback_criteria  text,
  planned_start_at   timestamptz,
  freeze_minutes     int not null check (freeze_minutes between 1 and 1440),
  approval_required  boolean not null,
  planned_by         text not null,
  planned_at         timestamptz not null,
  approved_by        text,
  approved_at        timestamptz,
  frozen_at          timestamptz,
  expected_end_at    timestamptz,
  effective_at       timestamptz,
  cancelled_at       timestamptz,
  cancelled_by       text,
  cancel_reason      text,
  version            int not null default 1
);
select core.enable_tenant_isolation('platform.data_authority_transitions');

-- At most one open (planned or frozen) transition per property and domain.
create table platform.data_authority_transition_domains (
  tenant_id      uuid not null,
  transition_id  uuid not null references platform.data_authority_transitions(id),
  property_id    uuid not null references platform.properties(id),
  domain         text not null,
  open           boolean not null default true,
  primary key (transition_id, domain)
);
create unique index data_authority_transition_open_idx on platform.data_authority_transition_domains
  (property_id, domain) where open;
select core.enable_tenant_isolation('platform.data_authority_transition_domains');

select core.apply_standard_grants('platform');
revoke all on platform.tenant_directory from portico_app;
