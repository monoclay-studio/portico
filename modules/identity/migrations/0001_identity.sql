create schema identity;

-- A person who can sign in. Global (a person may work for several organizations), but visible to a tenant
-- only when they hold a membership in it.
create table identity.users (
  id                 uuid primary key,
  email              text not null,
  password_hash      text,
  status             text not null default 'active' check (status in ('active', 'locked', 'disabled')),
  failed_logins      int not null default 0,
  locked_until       timestamptz,
  mfa_secret_enc     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index users_email_idx on identity.users (lower(email));

create table identity.memberships (
  id                  uuid primary key,
  tenant_id           uuid not null,
  user_id             uuid not null references identity.users(id),
  display_name        text not null,
  job_title           text,
  status              text not null default 'active' check (status in ('invited', 'active', 'suspended', 'removed')),
  default_property_id uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             int not null default 1,
  unique (tenant_id, user_id)
);
select core.enable_tenant_isolation('identity.memberships');

alter table identity.users enable row level security;
-- Not FORCEd: the owner-run SECURITY DEFINER sign-in functions must read it; the app role is still subject to RLS.
create policy member_visible on identity.users for select
  using (exists (select 1 from identity.memberships m where m.user_id = users.id));
create policy member_update on identity.users for update
  using (exists (select 1 from identity.memberships m where m.user_id = users.id));
create policy insert_any on identity.users for insert with check (true);

create table identity.roles (
  id           uuid primary key,
  tenant_id    uuid not null,
  key          text not null,
  name         text not null,
  description  text not null default '',
  permissions  text[] not null,
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  version      int not null default 1,
  unique (tenant_id, key)
);
select core.enable_tenant_isolation('identity.roles');

create table identity.role_assignments (
  id          uuid primary key,
  tenant_id   uuid not null,
  user_id     uuid not null references identity.users(id),
  role_id     uuid not null references identity.roles(id),
  scope_type  text not null check (scope_type in ('organization', 'brand', 'region', 'property')),
  scope_id    uuid,
  starts_at   timestamptz,
  ends_at     timestamptz,
  granted_by  text not null,
  reason      text,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  check ((scope_type = 'organization') = (scope_id is null))
);
create index role_assignments_user_idx on identity.role_assignments (tenant_id, user_id) where revoked_at is null;
select core.enable_tenant_isolation('identity.role_assignments');

create table identity.sessions (
  id             uuid primary key,
  tenant_id      uuid not null,
  user_id        uuid not null references identity.users(id),
  token_hash     text not null unique,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  idle_expires_at timestamptz not null,
  last_seen_at   timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_reason text,
  mfa_verified   boolean not null default false,
  ip             text,
  user_agent     text
);
select core.enable_tenant_isolation('identity.sessions');

create table identity.api_clients (
  id            uuid primary key,
  tenant_id     uuid not null,
  name          text not null,
  secret_hash   text not null,
  permissions   text[] not null,
  property_ids  uuid[],
  status        text not null default 'active' check (status in ('active', 'revoked')),
  created_by    text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz,
  last_used_at  timestamptz
);
select core.enable_tenant_isolation('identity.api_clients');

-- Cross-tenant directory of which organizations a user belongs to (no RLS; not granted to the app role).
create table identity.user_tenants (
  user_id   uuid not null,
  tenant_id uuid not null,
  status    text not null,
  primary key (user_id, tenant_id)
);

create or replace function identity.sync_user_tenants() returns trigger
  language plpgsql security definer set search_path = identity, pg_temp as $$
begin
  insert into identity.user_tenants (user_id, tenant_id, status) values (new.user_id, new.tenant_id, new.status)
    on conflict (user_id, tenant_id) do update set status = excluded.status;
  return new;
end $$;
create trigger sync_user_tenants after insert or update on identity.memberships
  for each row execute function identity.sync_user_tenants();

create trigger touch before update on identity.users for each row execute function core.touch_updated_at();
create trigger touch before update on identity.memberships for each row execute function core.touch_updated_at();

select core.apply_standard_grants('identity');
revoke all on identity.user_tenants from portico_app;

-- Sign-in lookup by email (before any tenant context exists). Returns credentials and active memberships only.
create or replace function identity.login_lookup(p_email text)
  returns table (user_id uuid, password_hash text, status text, locked_until timestamptz, tenant_ids uuid[])
  language sql stable security definer set search_path = identity, pg_temp as $$
    select u.id, u.password_hash, u.status, u.locked_until,
           coalesce(array_agg(ut.tenant_id) filter (where ut.status = 'active'), '{}')
      from identity.users u
      left join identity.user_tenants ut on ut.user_id = u.id
     where lower(u.email) = lower(p_email)
     group by u.id
$$;

create or replace function identity.record_login_result(p_user_id uuid, p_success boolean) returns void
  language plpgsql security definer set search_path = identity, pg_temp as $$
begin
  if p_success then
    update identity.users set failed_logins = 0, locked_until = null where id = p_user_id;
  else
    update identity.users
       set failed_logins = failed_logins + 1,
           locked_until = case when failed_logins + 1 >= 10 then now() + interval '15 minutes' else locked_until end
     where id = p_user_id;
  end if;
end $$;

-- Find or create a user by email without revealing anything about other organizations.
create or replace function identity.ensure_user(p_id uuid, p_email text) returns uuid
  language plpgsql security definer set search_path = identity, pg_temp as $$
declare existing uuid;
begin
  select id into existing from identity.users where lower(email) = lower(p_email);
  if existing is not null then return existing; end if;
  insert into identity.users (id, email) values (p_id, p_email);
  return p_id;
end $$;

revoke execute on function identity.login_lookup(text), identity.record_login_result(uuid, boolean),
  identity.ensure_user(uuid, text), identity.sync_user_tenants() from public;
grant execute on function identity.login_lookup(text), identity.record_login_result(uuid, boolean),
  identity.ensure_user(uuid, text) to portico_app;
