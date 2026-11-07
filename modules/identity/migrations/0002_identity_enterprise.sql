-- Identity wave 1: MFA, step-up, SSO (OIDC), SCIM, custom roles, staff lifecycle, support access,
-- break-glass and suspicious-activity signals. See modules/identity/README.md.

---------------------------------------------------------------------------------------------------------
-- Extensions of wave-0 tables
---------------------------------------------------------------------------------------------------------
alter table identity.sessions
  add column credential_epoch int not null default 0,  -- the person's credential epoch when the session began
  add column mfa_verified_at timestamptz,
  add column auth_method     text not null default 'password' check (auth_method in ('password', 'sso')),
  add column idp_mfa         boolean not null default false,
  add column mfa_failures    int not null default 0,
  add column revoked_by      text;
create index sessions_user_idx on identity.sessions (tenant_id, user_id) where revoked_at is null;

-- ADR-0017 §8: the MFA enrolment grace is anchored to the person's FIRST activation anywhere (rehire, re-invitation
-- or SCIM cycling cannot restart it), and second-factor failures are counted per person across challenges.
alter table identity.users
  add column first_activated_at   timestamptz,
  add column mfa_failed_attempts  int not null default 0,
  add column mfa_locked_until     timestamptz,
  -- ADR-0017 amendment 1 (rules 12-13): set only when the person completes an emailed link (invitation, reset) or
  -- signs in through an identity provider whose email domain the organization verified. Null = email_unverified.
  add column email_verified_at    timestamptz,
  -- Review R3-P1-1: incremented by the first email verification; every factor, recovery code, SSO link, session and
  -- MFA challenge carries the epoch it was created in, and rows from an older epoch are ignored.
  add column credential_epoch     int not null default 0;
-- R3-P3-2: only fictitious seeded identities count as verified; any other existing password may have been chosen by an
-- organization (wave-0 createUser) and must be replaced through an emailed link.
update identity.users set email_verified_at = created_at
 where password_hash is not null
   and (lower(email) like '%@portico.invalid' or lower(email) like '%.portico.invalid');

alter table identity.memberships
  add column activated_at    timestamptz,
  add column external_id     text,
  add column provisioned_by  text not null default 'manual' check (provisioned_by in ('manual', 'invitation', 'sso', 'scim')),
  add column status_reason   text,
  add column removed_at      timestamptz;
update identity.memberships set activated_at = created_at where status <> 'invited' and activated_at is null;
update identity.users u set first_activated_at = (select min(m.created_at) from identity.memberships m
                                                    where m.user_id = u.id and m.status <> 'invited');
create unique index memberships_external_id_idx on identity.memberships (tenant_id, external_id) where external_id is not null;

alter table identity.role_assignments
  add column source         text not null default 'manual' check (source in ('manual', 'sso', 'scim', 'transfer')),
  add column source_ref     text,
  add column revoked_by     text,
  add column revoke_reason  text;

alter table identity.roles
  add column template_key  text,
  add column archived_at   timestamptz,
  add column updated_at    timestamptz not null default now();

---------------------------------------------------------------------------------------------------------
-- MFA (user-level credentials; visible to a tenant only for its own members, like identity.users)
---------------------------------------------------------------------------------------------------------
create table identity.mfa_factors (
  id              uuid primary key,
  user_id         uuid not null references identity.users(id),
  kind            text not null check (kind in ('totp')),
  status          text not null check (status in ('pending', 'active', 'disabled')),
  secret_enc      text not null,          -- field-encrypted (AAD = factor id)
  last_used_step  bigint,                 -- replay protection: a time step is accepted at most once
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz,
  disabled_at     timestamptz,
  confirm_failures int not null default 0,  -- wrong codes while confirming a pending factor (capped)
  credential_epoch int not null default 0,
  version         int not null default 1
);
create unique index mfa_factors_one_active_idx on identity.mfa_factors (user_id, kind) where status = 'active';
create unique index mfa_factors_one_pending_idx on identity.mfa_factors (user_id, kind) where status = 'pending';

create table identity.mfa_recovery_codes (
  id          uuid primary key,
  user_id     uuid not null references identity.users(id),
  code_hash   text not null,
  created_at  timestamptz not null default now(),
  used_at     timestamptz,
  revoked_at  timestamptz,           -- replaced by new codes or MFA disabled (distinct from "used")
  credential_epoch int not null default 0,
  unique (user_id, code_hash)
);

do $$
declare t text;
begin
  foreach t in array array['identity.mfa_factors', 'identity.mfa_recovery_codes'] loop
    execute format('alter table %s enable row level security', t);
    execute format('alter table %s force row level security', t);
    execute format($p$create policy member_only on %s
      using (exists (select 1 from identity.memberships m where m.user_id = %s.user_id))
      with check (exists (select 1 from identity.memberships m where m.user_id = %s.user_id))$p$,
      t, t, t);
  end loop;
end $$;

-- Second-factor challenge issued by password sign-in for an MFA-enrolled member (pmc.<tenant>.<secret>).
create table identity.mfa_challenges (
  id           uuid primary key,
  tenant_id    uuid not null,
  user_id      uuid not null references identity.users(id),
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  attempts     int not null default 0,
  credential_epoch int not null default 0,  -- the epoch the password was checked in
  consumed_at  timestamptz,
  ip           text,
  user_agent   text,
  created_at   timestamptz not null default now()
);
select core.enable_tenant_isolation('identity.mfa_challenges');

---------------------------------------------------------------------------------------------------------
-- Organization security policy (one row per organization; absent row = defaults)
---------------------------------------------------------------------------------------------------------
create table identity.organization_security (
  tenant_id                    uuid primary key,
  mfa_step_up_window_minutes   int not null default 15 check (mfa_step_up_window_minutes between 1 and 720),
  mfa_grace_period_hours       int not null default 72 check (mfa_grace_period_hours between 0 and 72),
  require_mfa_for_all          boolean not null default false,
  support_access_approval      text not null default 'always_required'
                               check (support_access_approval in ('always_required', 'auto_approve_read_only')),
  support_max_minutes          int not null default 240 check (support_max_minutes between 15 and 1440),
  break_glass_user_ids         uuid[] not null default '{}',
  break_glass_role_key         text not null default 'org_admin',
  break_glass_max_minutes      int not null default 240 check (break_glass_max_minutes between 15 and 240),
  updated_at                   timestamptz not null default now(),
  updated_by                   text not null,
  version                      int not null default 1
);
select core.enable_tenant_isolation('identity.organization_security');

---------------------------------------------------------------------------------------------------------
-- Staff lifecycle tokens: invitations and password resets (inv./prt.<tenant>.<secret>, stored hashed)
---------------------------------------------------------------------------------------------------------
create table identity.credential_tokens (
  id           uuid primary key,
  tenant_id    uuid not null,
  user_id      uuid not null references identity.users(id),
  kind         text not null check (kind in ('invitation', 'password_reset')),
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  revoked_at   timestamptz,
  created_by   text not null,
  -- R3-P3-3: how the link was delivered; only a link actually sent to the person (`queued`) proves their email.
  delivery_mode text,
  created_at   timestamptz not null default now()
);
create index credential_tokens_user_idx on identity.credential_tokens (tenant_id, user_id, kind);
select core.enable_tenant_isolation('identity.credential_tokens');

---------------------------------------------------------------------------------------------------------
-- Enterprise SSO (OIDC) — one connection per organization
---------------------------------------------------------------------------------------------------------
create table identity.sso_connections (
  id                          uuid primary key,
  tenant_id                   uuid not null unique,
  protocol                    text not null default 'oidc' check (protocol in ('oidc')),
  display_name                text not null,
  issuer                      text not null,
  client_id                   text not null,
  client_secret_ref           text not null,     -- SecretStore reference; the secret itself never lives here
  token_endpoint_auth_method  text not null default 'client_secret_basic'
                              check (token_endpoint_auth_method in ('client_secret_basic', 'client_secret_post')),
  authorization_endpoint      text not null,
  token_endpoint              text not null,
  jwks_uri                    text not null,
  scopes                      text[] not null default '{openid,email,profile}',
  allowed_email_domains       text[] not null,
  groups_claim                text not null default 'groups',
  jit_provisioning            boolean not null default true,
  trust_idp_mfa               boolean not null default false,
  sso_required                boolean not null default false,
  sso_exempt_user_ids         uuid[] not null default '{}',
  status                      text not null default 'active' check (status in ('active', 'disabled')),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  updated_by                  text not null,
  version                     int not null default 1,
  check (cardinality(allowed_email_domains) > 0),
  check (cardinality(sso_exempt_user_ids) <= 3)
);
select core.enable_tenant_isolation('identity.sso_connections');

-- Group → role rules shared by OIDC (groups claim), SCIM (group membership) and, later, SAML.
create table identity.group_role_mappings (
  id          uuid primary key,
  tenant_id   uuid not null,
  group_name  text not null,
  role_id     uuid not null references identity.roles(id),
  scope_type  text not null check (scope_type in ('organization', 'brand', 'region', 'property')),
  scope_id    uuid,
  created_at  timestamptz not null default now(),
  created_by  text not null,
  check ((scope_type = 'organization') = (scope_id is null))
);
create unique index group_role_mappings_uniq on identity.group_role_mappings
  (tenant_id, lower(group_name), role_id, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'));
select core.enable_tenant_isolation('identity.group_role_mappings');

-- Authorization-code + PKCE login attempts (state = <tenant>.<secret>, stored hashed).
create table identity.sso_login_states (
  id                  uuid primary key,
  tenant_id           uuid not null,
  state_hash          text not null unique,
  binding_hash        text not null,     -- hash of a secret the starting browser keeps; required at the callback
  nonce               text not null,
  code_verifier_enc   text not null,
  redirect_uri        text not null,
  link_user_id        uuid,              -- ADR-0017 rule 15: set when a signed-in member proves they own the IdP account
  issuer              text,              -- R3-P3-4: the issuer the login started with; the callback must match it
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  consumed_at         timestamptz
);
select core.enable_tenant_isolation('identity.sso_login_states');

-- Default SecretStore adapter: field-encrypted values in the organization's own rows (KMS-backed cipher in
-- production). Replaceable by AWS Secrets Manager without changing callers.
create table identity.secret_values (
  tenant_id   uuid not null,
  ref         text not null,
  ciphertext  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, ref)
);
select core.enable_tenant_isolation('identity.secret_values');

-- ADR-0017 §5: after the first link, SSO sign-in matches on (issuer, sub), never on the mutable email claim.
create table identity.sso_identities (
  id          uuid primary key,
  tenant_id   uuid not null,
  issuer      text not null,
  subject     text not null,
  user_id     uuid not null references identity.users(id),
  email_at_link text not null,
  linked_at   timestamptz not null,
  credential_epoch int not null default 0,
  unique (tenant_id, issuer, subject)
);
create index sso_identities_user_idx on identity.sso_identities (tenant_id, user_id);
select core.enable_tenant_isolation('identity.sso_identities');

-- ADR-0017 §5: an organization may link EXISTING global users of an email domain only after proving it owns the
-- domain (DNS TXT record `_portico-verification.<domain>` = `portico-verify=<token>`).
create table identity.sso_domains (
  id                  uuid primary key,
  tenant_id           uuid not null,
  domain              text not null,
  verification_token  text not null,
  verified_at         timestamptz,
  checked_at          timestamptz,       -- R3-P2-2: last time the TXT record was seen; verification lapses after 30 days
  created_at          timestamptz not null default now(),
  created_by          text not null,
  unique (tenant_id, domain)
);
select core.enable_tenant_isolation('identity.sso_domains');

---------------------------------------------------------------------------------------------------------
-- SCIM groups
---------------------------------------------------------------------------------------------------------
create table identity.scim_groups (
  id            uuid primary key,
  tenant_id     uuid not null,
  display_name  text not null,
  external_id   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       int not null default 1
);
create unique index scim_groups_name_idx on identity.scim_groups (tenant_id, lower(display_name));
select core.enable_tenant_isolation('identity.scim_groups');

create table identity.scim_group_members (
  tenant_id  uuid not null,
  group_id   uuid not null references identity.scim_groups(id) on delete cascade,
  user_id    uuid not null references identity.users(id),
  added_at   timestamptz not null default now(),
  primary key (group_id, user_id)
);
select core.enable_tenant_isolation('identity.scim_group_members');

---------------------------------------------------------------------------------------------------------
-- Monoclay support access (no standing access; time-boxed, reasoned, visible to the customer)
---------------------------------------------------------------------------------------------------------
create table identity.support_sessions (
  id                  uuid primary key,
  tenant_id           uuid not null,
  operator_id         uuid not null,
  operator_name       text not null,
  reason              text not null check (length(reason) >= 10),
  ticket_ref          text not null,
  access_scope        text not null check (access_scope in ('read_only', 'read_write')),
  property_ids        uuid[],
  duration_minutes    int not null check (duration_minutes between 15 and 1440),
  status              text not null check (status in ('pending_approval', 'active', 'declined', 'ended', 'revoked')),
  token_hash          text not null unique,
  requested_at        timestamptz not null,
  approved_by         text,
  approved_at         timestamptz,
  approval_mode       text check (approval_mode in ('customer', 'policy_auto_read_only')),
  starts_at           timestamptz,
  ends_at             timestamptz,
  ended_at            timestamptz,
  ended_by            text,
  end_reason          text,
  version             int not null default 1,
  check ((status in ('active', 'ended', 'revoked')) = (starts_at is not null) or status = 'revoked')
);
create index support_sessions_tenant_idx on identity.support_sessions (tenant_id, requested_at desc);
select core.enable_tenant_isolation('identity.support_sessions');

create table identity.support_access_log (
  id                  uuid primary key,
  tenant_id           uuid not null,
  support_session_id  uuid not null references identity.support_sessions(id),
  occurred_at         timestamptz not null,
  method              text not null,
  path                text not null
);
create index support_access_log_session_idx on identity.support_access_log (tenant_id, support_session_id, occurred_at);
select core.enable_tenant_isolation('identity.support_access_log');

---------------------------------------------------------------------------------------------------------
-- Break-glass emergency elevation
---------------------------------------------------------------------------------------------------------
create table identity.elevations (
  id              uuid primary key,
  tenant_id       uuid not null,
  user_id         uuid not null references identity.users(id),
  session_id      uuid not null references identity.sessions(id),
  role_id         uuid not null references identity.roles(id),
  reason          text not null check (length(reason) >= 20),
  started_at      timestamptz not null,
  ends_at         timestamptz not null,
  ended_at        timestamptz,
  ended_reason    text,
  review_status   text not null default 'pending' check (review_status in ('pending', 'reviewed')),
  reviewed_by     text,
  reviewed_at     timestamptz,
  review_notes    text,
  version         int not null default 1,
  check (ends_at > started_at and ends_at <= started_at + interval '4 hours')
);
create unique index elevations_session_idx on identity.elevations (session_id) where ended_at is null;
select core.enable_tenant_isolation('identity.elevations');

---------------------------------------------------------------------------------------------------------
-- Security signals
---------------------------------------------------------------------------------------------------------
create table identity.security_alerts (
  id              uuid primary key,
  tenant_id       uuid not null,
  rule            text not null,
  severity        text not null check (severity in ('low', 'medium', 'high')),
  subject_user_id uuid,
  summary         text not null,
  details         jsonb not null default '{}',
  occurred_at     timestamptz not null,
  dedupe_key      text not null,
  acknowledged_by text,
  acknowledged_at timestamptz,
  unique (tenant_id, dedupe_key)
);
create index security_alerts_tenant_idx on identity.security_alerts (tenant_id, occurred_at desc);
select core.enable_tenant_isolation('identity.security_alerts');

create table identity.sign_in_locations (
  tenant_id     uuid not null,
  user_id       uuid not null references identity.users(id),
  country_code  text not null,
  first_seen_at timestamptz not null,
  last_seen_at  timestamptz not null,
  primary key (tenant_id, user_id, country_code)
);
select core.enable_tenant_isolation('identity.sign_in_locations');

create table identity.export_activity (
  id            uuid primary key,
  tenant_id     uuid not null,
  actor_key     text not null,
  resource      text not null,
  record_count  int not null check (record_count >= 0),
  property_id   uuid,
  occurred_at   timestamptz not null
);
create index export_activity_actor_idx on identity.export_activity (tenant_id, actor_key, occurred_at);
select core.enable_tenant_isolation('identity.export_activity');

-- Pre-authentication sign-in attempts (no tenant is known yet). Not RLS-protected, therefore NOT granted to the
-- app role; written and summarised only through the SECURITY DEFINER function below. Emails are stored hashed.
create table identity.login_attempts (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  ip           text not null,
  email_hash   text not null,
  success      boolean not null
);
create index login_attempts_ip_idx on identity.login_attempts (ip, occurred_at);

-- Platform-level (Monoclay) security alerts that belong to no organization, e.g. credential stuffing from an IP.
create table identity.platform_security_alerts (
  id           uuid primary key,
  rule         text not null,
  subject      text not null,
  details      jsonb not null default '{}',
  occurred_at  timestamptz not null default now(),
  dedupe_key   text not null unique
);

create trigger touch before update on identity.sso_connections for each row execute function core.touch_updated_at();
create trigger touch before update on identity.organization_security for each row execute function core.touch_updated_at();
create trigger touch before update on identity.roles for each row execute function core.touch_updated_at();
create trigger touch before update on identity.scim_groups for each row execute function core.touch_updated_at();
create trigger touch before update on identity.secret_values for each row execute function core.touch_updated_at();

select core.apply_standard_grants('identity');
revoke all on identity.user_tenants, identity.login_attempts, identity.platform_security_alerts from portico_app;
select core.make_append_only('identity.support_access_log');
select core.make_append_only('identity.export_activity');

---------------------------------------------------------------------------------------------------------
-- SECURITY DEFINER functions (reviewed): pre-auth signals and cross-organization session revocation
---------------------------------------------------------------------------------------------------------

-- Record a sign-in attempt and return the failure statistics for this IP within the window.
create or replace function identity.record_login_attempt(p_ip text, p_email_hash text, p_success boolean,
                                                         p_window_minutes int)
  returns table (failures int, distinct_accounts int)
  language plpgsql security definer set search_path = identity, pg_temp as $$
begin
  insert into identity.login_attempts (ip, email_hash, success) values (p_ip, p_email_hash, p_success);
  return query
    select count(*)::int, count(distinct a.email_hash)::int
      from identity.login_attempts a
     where a.ip = p_ip and not a.success
       and a.occurred_at > now() - make_interval(mins => p_window_minutes);
end $$;

create or replace function identity.raise_platform_alert(p_id uuid, p_rule text, p_subject text, p_details jsonb,
                                                         p_dedupe_key text)
  returns boolean
  language plpgsql security definer set search_path = identity, pg_temp as $$
declare inserted boolean;
begin
  insert into identity.platform_security_alerts (id, rule, subject, details, dedupe_key)
    values (p_id, p_rule, p_subject, p_details, p_dedupe_key)
    on conflict (dedupe_key) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

-- Operator console only (the API checks the operator principal before calling).
create or replace function identity.list_platform_alerts(p_limit int)
  returns table (id uuid, rule text, subject text, details jsonb, occurred_at timestamptz)
  language sql stable security definer set search_path = identity, pg_temp as $$
    select id, rule, subject, details, occurred_at from identity.platform_security_alerts
     order by occurred_at desc limit least(p_limit, 500)
$$;

-- Revoke a person's sessions in EVERY organization (password reset / credential compromise). Sessions are
-- tenant-isolated with forced RLS, so the function visits each of the person's organizations by setting the
-- tenant for the statement and restores the caller's tenant afterwards.
create or replace function identity.revoke_sessions_everywhere(p_user_id uuid, p_reason text)
  returns int
  language plpgsql security definer set search_path = identity, pg_temp as $$
declare
  previous text := current_setting('app.tenant_id', true);
  t uuid;
  n int := 0;
  c int;
begin
  for t in select ut.tenant_id from identity.user_tenants ut where ut.user_id = p_user_id loop
    perform set_config('app.tenant_id', t::text, true);
    update identity.sessions set revoked_at = now(), revoked_reason = p_reason
     where user_id = p_user_id and revoked_at is null;
    get diagnostics c = row_count;
    n := n + c;
    -- ADR-0017 §9: API keys issued by the person stop working when their credential is reset.
    update identity.api_clients set status = 'revoked' where created_by = p_user_id::text and status = 'active';
  end loop;
  perform set_config('app.tenant_id', coalesce(previous, ''), true);
  return n;
end $$;

-- ADR-0017 §1: how many memberships (ANY status) a person has OUTSIDE the given organization. An organization may
-- reset a person's credentials only when this is 0. Returns a count, never which organizations.
create or replace function identity.memberships_elsewhere(p_user_id uuid, p_tenant_id uuid) returns int
  language sql stable security definer set search_path = identity, pg_temp as $$
    select count(*)::int from identity.user_tenants where user_id = p_user_id and tenant_id <> p_tenant_id
$$;

-- ADR-0017 §8: record the person's first activation anywhere (grace anchor). Runs as definer because the person's
-- other organizations are invisible to the caller.
create or replace function identity.mark_first_activation() returns trigger
  language plpgsql security definer set search_path = identity, pg_temp as $$
begin
  if new.status = 'active' then
    update identity.users set first_activated_at = coalesce(first_activated_at, now()) where id = new.user_id;
  end if;
  return new;
end $$;
create trigger mark_first_activation after insert or update of status on identity.memberships
  for each row execute function identity.mark_first_activation();

-- Developer / operator mailbox for SIMULATED staff messages from non-live organizations (ADR-0017 §3): credential
-- links never go back to the admin who triggered them. Not tenant data; app role has no direct access.
create table identity.dev_mailbox (
  id          uuid primary key,
  tenant_id   uuid not null,
  recipient   text not null,
  kind        text not null,
  subject     text not null,
  body        text not null,
  link_enc    text,
  created_at  timestamptz not null default now()
);
create index dev_mailbox_recipient_idx on identity.dev_mailbox (lower(recipient), created_at desc);
revoke all on identity.dev_mailbox from portico_app;

create or replace function identity.deposit_simulated_message(p_id uuid, p_tenant_id uuid, p_recipient text,
  p_kind text, p_subject text, p_body text, p_link_enc text) returns void
  language sql security definer set search_path = identity, pg_temp as $$
    insert into identity.dev_mailbox (id, tenant_id, recipient, kind, subject, body, link_enc)
    values (p_id, p_tenant_id, p_recipient, p_kind, p_subject, p_body, p_link_enc)
$$;
create or replace function identity.read_dev_mailbox(p_recipient text, p_limit int)
  returns table (id uuid, tenant_id uuid, kind text, subject text, body text, link_enc text, created_at timestamptz)
  language sql stable security definer set search_path = identity, pg_temp as $$
    select id, tenant_id, kind, subject, body, link_enc, created_at from identity.dev_mailbox
     where lower(recipient) = lower(p_recipient) order by created_at desc limit least(p_limit, 50)
$$;

-- Retention: pre-authentication sign-in attempts are only needed for the detection window (keep 48 h by default).
create or replace function identity.purge_login_attempts(p_keep_hours int, p_batch int) returns int
  language plpgsql security definer set search_path = identity, pg_temp as $$
declare n int;
begin
  delete from identity.login_attempts
   where id in (select id from identity.login_attempts
                 where occurred_at < now() - make_interval(hours => p_keep_hours) limit p_batch);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function identity.purge_login_attempts(int, int) from public;
grant execute on function identity.purge_login_attempts(int, int) to portico_app;

-- ADR-0017 amendment 1, rule 12: the first time a person proves control of their email (an emailed link, or an IdP
-- whose domain the organization verified), every credential that existed before is wiped: password, MFA factors,
-- recovery codes, SSO links, sessions and the API keys they issued, in every organization. Returns true only for the
-- first verification. Factors, links and sessions are tenant-guarded, so each organization is visited in turn.
create or replace function identity.first_email_verification(p_user_id uuid, p_now timestamptz) returns boolean
  language plpgsql security definer set search_path = identity, pg_temp as $$
declare
  previous text := current_setting('app.tenant_id', true);
  t uuid;
  c int;
begin
  update identity.users
     set email_verified_at = p_now, password_hash = null, failed_logins = 0, locked_until = null,
         mfa_failed_attempts = 0, mfa_locked_until = null, credential_epoch = credential_epoch + 1
   where id = p_user_id and email_verified_at is null;
  get diagnostics c = row_count;
  if c = 0 then return false; end if;
  for t in select ut.tenant_id from identity.user_tenants ut where ut.user_id = p_user_id loop
    perform set_config('app.tenant_id', t::text, true);
    update identity.mfa_factors set status = 'disabled', disabled_at = p_now
     where user_id = p_user_id and status in ('active', 'pending');
    update identity.mfa_recovery_codes set revoked_at = p_now
     where user_id = p_user_id and used_at is null and revoked_at is null;
    -- R3-P3-1: explicit tenant predicates (correct even when the owner bypasses row-level security).
    delete from identity.sso_identities where tenant_id = t and user_id = p_user_id;
    update identity.sessions set revoked_at = p_now, revoked_reason = 'email_verified'
     where tenant_id = t and user_id = p_user_id and revoked_at is null;
    update identity.api_clients set status = 'revoked'
     where tenant_id = t and created_by = p_user_id::text and status = 'active';
  end loop;
  perform set_config('app.tenant_id', coalesce(previous, ''), true);
  return true;
end $$;

-- Review R3-P1-1: lock the person's row BEFORE reading any credential state. Every path that creates or activates a
-- credential calls this first, so it either finishes before a first-verification wipe or starts after it and sees the
-- new epoch.
create or replace function identity.lock_person(p_user_id uuid)
  returns table (email_verified boolean, credential_epoch int)
  language sql security definer set search_path = identity, pg_temp as $$
    select u.email_verified_at is not null, u.credential_epoch from identity.users u where u.id = p_user_id for update
$$;

-- The credential epoch of the person with this email, read BEFORE the password hash at sign-in (R3-P1-1).
create or replace function identity.credential_epoch_for_email(p_email text) returns int
  language sql stable security definer set search_path = identity, pg_temp as $$
    select credential_epoch from identity.users where lower(email) = lower(p_email)
$$;

-- What credentials a person holds anywhere (ADR-0017 rule 14: the first-password decision depends on credentials,
-- never on memberships). Counts only; never says where.
create or replace function identity.credential_summary(p_user_id uuid)
  returns table (email_verified boolean, has_password boolean, has_factor boolean, sso_links int)
  language plpgsql security definer set search_path = identity, pg_temp as $$
declare
  previous text := current_setting('app.tenant_id', true);
  t uuid;
  links int := 0;
  c int;
  factor boolean := false;
begin
  for t in select ut.tenant_id from identity.user_tenants ut where ut.user_id = p_user_id loop
    perform set_config('app.tenant_id', t::text, true);
    select count(*) into c from identity.sso_identities s join identity.users u on u.id = s.user_id
     where s.tenant_id = t and s.user_id = p_user_id and s.credential_epoch = u.credential_epoch;
    links := links + c;
    factor := factor or exists (select 1 from identity.mfa_factors f join identity.users u on u.id = f.user_id
                                  where f.user_id = p_user_id and f.status = 'active'
                                    and f.credential_epoch = u.credential_epoch);
  end loop;
  perform set_config('app.tenant_id', coalesce(previous, ''), true);
  return query select u.email_verified_at is not null, u.password_hash is not null, factor, links
                 from identity.users u where u.id = p_user_id;
end $$;

-- ADR-0017 rule 15 / review R2-P1-3: an SSO link whose person has no membership in the linking organization is an
-- orphan (left by a removal); purge them. Visits each organization that has members.
create or replace function identity.purge_orphan_sso_links() returns int
  language plpgsql security definer set search_path = identity, pg_temp as $$
declare
  previous text := current_setting('app.tenant_id', true);
  t uuid;
  n int := 0;
  c int;
begin
  for t in select distinct ut.tenant_id from identity.user_tenants ut loop
    perform set_config('app.tenant_id', t::text, true);
    delete from identity.sso_identities s
     where s.tenant_id = t
       and not exists (select 1 from identity.memberships m
                        where m.tenant_id = s.tenant_id and m.user_id = s.user_id
                          and m.status in ('active', 'invited', 'suspended'));
    get diagnostics c = row_count;
    n := n + c;
  end loop;
  perform set_config('app.tenant_id', coalesce(previous, ''), true);
  return n;
end $$;
-- Review R3-P2-2: a verified email domain is an email-verification authority, so at most ONE organization holds it.
-- First verified wins; a second organization needs the first to release it, or Monoclay support.
create table identity.verified_domains (
  domain       text primary key,
  tenant_id    uuid not null,
  verified_at  timestamptz not null
);
revoke all on identity.verified_domains from portico_app;

create or replace function identity.claim_verified_domain(p_domain text, p_tenant_id uuid, p_now timestamptz)
  returns boolean
  language plpgsql security definer set search_path = identity, pg_temp as $$
declare holder uuid;
begin
  insert into identity.verified_domains (domain, tenant_id, verified_at) values (lower(p_domain), p_tenant_id, p_now)
    on conflict (domain) do nothing;
  select tenant_id into holder from identity.verified_domains where domain = lower(p_domain);
  return holder = p_tenant_id;
end $$;

create or replace function identity.release_verified_domain(p_domain text, p_tenant_id uuid) returns void
  language sql security definer set search_path = identity, pg_temp as $$
    delete from identity.verified_domains where domain = lower(p_domain) and tenant_id = p_tenant_id
$$;

create or replace function identity.verified_domain_holder(p_domain text) returns uuid
  language sql stable security definer set search_path = identity, pg_temp as $$
    select tenant_id from identity.verified_domains where domain = lower(p_domain)
$$;

-- Scheduled re-check (R3-P2-2): verified domains whose TXT record was last seen before p_before, in every organization.
create or replace function identity.sso_domains_due(p_before timestamptz)
  returns table (tenant_id uuid, domain text, verification_token text)
  language plpgsql security definer set search_path = identity, pg_temp as $$
declare
  previous text := current_setting('app.tenant_id', true);
  t uuid;
begin
  -- Every verified domain is in the cross-organization registry, so it lists exactly the organizations to visit.
  for t in select distinct v.tenant_id from identity.verified_domains v loop
    perform set_config('app.tenant_id', t::text, true);
    return query select d.tenant_id, d.domain, d.verification_token from identity.sso_domains d
                  where d.tenant_id = t and d.verified_at is not null
                    and (d.checked_at is null or d.checked_at < p_before);
  end loop;
  perform set_config('app.tenant_id', coalesce(previous, ''), true);
end $$;

create or replace function identity.record_domain_check(p_tenant_id uuid, p_domain text, p_ok boolean,
  p_now timestamptz) returns void
  language plpgsql security definer set search_path = identity, pg_temp as $$
declare previous text := current_setting('app.tenant_id', true);
begin
  perform set_config('app.tenant_id', p_tenant_id::text, true);
  if p_ok then
    update identity.sso_domains set checked_at = p_now where tenant_id = p_tenant_id and domain = p_domain;
  else
    update identity.sso_domains set verified_at = null, checked_at = p_now
     where tenant_id = p_tenant_id and domain = p_domain;
    delete from identity.verified_domains where domain = lower(p_domain) and tenant_id = p_tenant_id;
  end if;
  perform set_config('app.tenant_id', coalesce(previous, ''), true);
end $$;

revoke execute on function identity.first_email_verification(uuid, timestamptz),
  identity.credential_summary(uuid), identity.purge_orphan_sso_links(), identity.lock_person(uuid),
  identity.credential_epoch_for_email(text), identity.claim_verified_domain(text, uuid, timestamptz),
  identity.release_verified_domain(text, uuid), identity.sso_domains_due(timestamptz),
  identity.record_domain_check(uuid, text, boolean, timestamptz), identity.verified_domain_holder(text) from public;
grant execute on function identity.first_email_verification(uuid, timestamptz),
  identity.credential_summary(uuid), identity.purge_orphan_sso_links(), identity.lock_person(uuid),
  identity.credential_epoch_for_email(text), identity.claim_verified_domain(text, uuid, timestamptz),
  identity.release_verified_domain(text, uuid), identity.sso_domains_due(timestamptz),
  identity.record_domain_check(uuid, text, boolean, timestamptz), identity.verified_domain_holder(text) to portico_app;

-- Pending invitations of a person across organizations (the person lists and accepts them while signed in).
create or replace function identity.pending_invitations(p_user_id uuid) returns setof uuid
  language sql stable security definer set search_path = identity, pg_temp as $$
    select tenant_id from identity.user_tenants where user_id = p_user_id and status = 'invited'
$$;
revoke execute on function identity.pending_invitations(uuid) from public;
grant execute on function identity.pending_invitations(uuid) to portico_app;

revoke execute on function identity.memberships_elsewhere(uuid, uuid), identity.mark_first_activation(),
  identity.deposit_simulated_message(uuid, uuid, text, text, text, text, text), identity.read_dev_mailbox(text, int)
  from public;
grant execute on function identity.memberships_elsewhere(uuid, uuid),
  identity.deposit_simulated_message(uuid, uuid, text, text, text, text, text), identity.read_dev_mailbox(text, int)
  to portico_app;

revoke execute on function identity.record_login_attempt(text, text, boolean, int),
  identity.raise_platform_alert(uuid, text, text, jsonb, text), identity.list_platform_alerts(int),
  identity.revoke_sessions_everywhere(uuid, text) from public;
grant execute on function identity.record_login_attempt(text, text, boolean, int),
  identity.raise_platform_alert(uuid, text, text, jsonb, text), identity.list_platform_alerts(int),
  identity.revoke_sessions_everywhere(uuid, text) to portico_app;
