create schema platform;

-- An organization (tenant) — the software customer and the hard isolation boundary.
create table platform.tenants (
  id                    uuid primary key,
  tenant_id             uuid generated always as (id) stored,
  name                  text not null,
  slug                  text not null unique,
  environment           text not null check (environment in ('live', 'trial', 'sandbox', 'training', 'demo')),
  live_tenant_id        uuid,            -- trial/training/sandbox organizations point at their live organization (if any)
  status                text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  plan_code             text not null,
  default_locale        text not null default 'en',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  version               int not null default 1
);
select core.enable_tenant_isolation('platform.tenants');

create table platform.legal_entities (
  id                    uuid primary key,
  tenant_id             uuid not null,
  name                  text not null,
  legal_name            text not null,
  registration_number   text,
  tax_id                text,
  country_code          char(2) not null,
  base_currency         char(3) not null,
  address               jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  version               int not null default 1
);
select core.enable_tenant_isolation('platform.legal_entities');

create table platform.brands (
  id         uuid primary key,
  tenant_id  uuid not null,
  code       text not null,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
select core.enable_tenant_isolation('platform.brands');

create table platform.regions (
  id               uuid primary key,
  tenant_id        uuid not null,
  code             text not null,
  name             text not null,
  parent_region_id uuid references platform.regions(id),
  created_at       timestamptz not null default now(),
  unique (tenant_id, code)
);
select core.enable_tenant_isolation('platform.regions');

create table platform.properties (
  id                  uuid primary key,
  tenant_id           uuid not null,
  code                text not null,
  name                text not null,
  profile             text not null check (profile in ('guesthouse', 'boutique_hotel', 'hotel', 'resort', 'serviced_apartments', 'hostel')),
  legal_entity_id     uuid not null references platform.legal_entities(id),
  brand_id            uuid references platform.brands(id),
  region_id           uuid references platform.regions(id),
  country_code        char(2) not null,
  timezone            text not null,
  base_currency       char(3) not null,
  -- Jurisdiction-relevant classification used by tax & fee rules (e.g. Maldives island type, room count band).
  classification      jsonb not null default '{}',
  business_date       date not null,
  -- setup → pilot (controlled, narrow scope) → active (separately approved production activation) → inactive
  status              text not null default 'setup' check (status in ('setup', 'pilot', 'active', 'inactive')),
  check_in_time       time not null default '14:00',
  check_out_time      time not null default '12:00',
  address             jsonb not null default '{}',
  contact             jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             int not null default 1,
  unique (tenant_id, code)
);
select core.enable_tenant_isolation('platform.properties');

-- Business date history: one row per advance, never updated.
create table platform.business_date_log (
  id             uuid primary key,
  tenant_id      uuid not null,
  property_id    uuid not null references platform.properties(id),
  from_date      date not null,
  to_date        date not null,
  advanced_at    timestamptz not null,
  advanced_by    text not null,
  day_close_run_id uuid,
  unique (property_id, from_date)
);
select core.enable_tenant_isolation('platform.business_date_log');

create table platform.departments (
  id          uuid primary key,
  tenant_id   uuid not null,
  property_id uuid not null references platform.properties(id),
  code        text not null,
  name        text not null,
  kind        text not null,
  created_at  timestamptz not null default now(),
  unique (property_id, code)
);
select core.enable_tenant_isolation('platform.departments');

-- Central policies with local overrides. scope_type 'organization' has scope_id = tenant id.
create table platform.policies (
  id          uuid primary key,
  tenant_id   uuid not null,
  key         text not null,
  scope_type  text not null check (scope_type in ('organization', 'brand', 'region', 'property')),
  scope_id    uuid not null,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  text not null,
  version     int not null default 1,
  unique (tenant_id, key, scope_type, scope_id)
);
select core.enable_tenant_isolation('platform.policies');

-- Per-organization entitlement overrides on top of the plan's defaults.
create table platform.entitlement_overrides (
  tenant_id   uuid not null,
  feature     text not null,
  enabled     boolean,
  limit_value int,
  reason      text not null,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, feature)
);
select core.enable_tenant_isolation('platform.entitlement_overrides');

-- Data authority: which system is the system of record for each data domain at a property (adoption brief §2).
-- No row = Portico is authoritative ('portico', 'exclusive').
create table platform.data_authority (
  id             uuid primary key,
  tenant_id      uuid not null,
  property_id    uuid not null references platform.properties(id),
  domain         text not null check (domain in ('reservations', 'availability', 'rates', 'guestProfiles', 'charges',
                                                 'payments', 'roomStatus', 'maintenance', 'accounting')),
  authority      text not null check (authority in ('portico', 'external')),
  connection_id  uuid,              -- integration connection when authority = 'external'
  system_name    text,              -- human label, e.g. 'OPERA PMS 5.6 (on-site)'
  -- exclusive: only the authority writes; forward: Portico actions are forwarded to the authority and become
  -- effective when acknowledged; read_only: Portico shows the data but offers no write actions.
  write_mode     text not null check (write_mode in ('exclusive', 'forward', 'read_only')),
  effective_from timestamptz not null,
  updated_by     text not null,
  reason         text not null,
  version        int not null default 1,
  unique (property_id, domain),
  check ((authority = 'external') = (connection_id is not null) or authority = 'external')
);
select core.enable_tenant_isolation('platform.data_authority');

create trigger touch before update on platform.tenants for each row execute function core.touch_updated_at();
create trigger touch before update on platform.legal_entities for each row execute function core.touch_updated_at();
create trigger touch before update on platform.properties for each row execute function core.touch_updated_at();

select core.apply_standard_grants('platform');
select core.make_append_only('platform.business_date_log');

-- Cross-tenant routing directory: minimal metadata needed before a tenant context exists (sign-in, background
-- consumers). Not RLS-protected, therefore NOT granted to the app role; read only via the functions below.
create table platform.tenant_directory (
  id          uuid primary key,
  slug        text not null,
  name        text not null,
  environment text not null,
  status      text not null
);
revoke all on platform.tenant_directory from portico_app;

create or replace function platform.sync_tenant_directory() returns trigger
  language plpgsql security definer set search_path = platform, pg_temp as $$
begin
  insert into platform.tenant_directory (id, slug, name, environment, status)
    values (new.id, new.slug, new.name, new.environment, new.status)
    on conflict (id) do update set slug = excluded.slug, name = excluded.name,
      environment = excluded.environment, status = excluded.status;
  return new;
end $$;
create trigger sync_directory after insert or update on platform.tenants
  for each row execute function platform.sync_tenant_directory();

create or replace function platform.tenant_environment(p_tenant_id uuid) returns text
  language sql stable security definer set search_path = platform, pg_temp
  as $$ select environment from platform.tenant_directory where id = p_tenant_id and status <> 'closed' $$;

create or replace function platform.tenant_summaries(p_tenant_ids uuid[])
  returns table (id uuid, slug text, name text, environment text, status text)
  language sql stable security definer set search_path = platform, pg_temp
  as $$ select id, slug, name, environment, status from platform.tenant_directory where id = any(p_tenant_ids) $$;

revoke execute on function platform.tenant_environment(uuid), platform.tenant_summaries(uuid[]),
  platform.sync_tenant_directory() from public;
grant execute on function platform.tenant_environment(uuid), platform.tenant_summaries(uuid[]) to portico_app;
