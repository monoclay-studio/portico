-- Portico restore verification. Run with psql -v ON_ERROR_STOP=1 against a RESTORED copy (never production).
-- A backup only counts once a restore of it passes these checks (readiness brief §17).
--
-- Fails (non-zero psql exit) when an invariant is broken; prints evidence rows otherwise.
-- Allow-lists are explicit on purpose: a new table that weakens isolation fails the drill until reviewed.

\echo '== check 1: migrations present'
do $$
declare n int;
begin
  select count(*) into n from core.schema_migrations;
  if n = 0 then raise exception 'DRILL FAIL: core.schema_migrations is empty'; end if;
  raise notice 'migrations applied: %', n;
end $$;

\echo '== check 2: every tenant-owned table has RLS enabled (and forced unless allow-listed)'
do $$
declare r record; bad text := '';
begin
  for r in
    select n.nspname as s, c.relname as t, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
     where c.relkind in ('r', 'p')
       and n.nspname not in ('pg_catalog', 'information_schema')
  loop
    if not r.enabled then
      -- Allowed only for cross-tenant directory tables the application role cannot touch at all (they are read
      -- through reviewed SECURITY DEFINER functions, ADR-0002).
      if has_table_privilege('portico_app', format('%I.%I', r.s, r.t), 'SELECT, INSERT, UPDATE, DELETE') then
        bad := bad || format(' %I.%I(rls disabled but accessible to portico_app)', r.s, r.t);
      else
        raise notice 'directory table without RLS, not accessible to portico_app: %.%', r.s, r.t;
      end if;
    elsif not r.forced and format('%I.%I', r.s, r.t) not in (
      -- Reviewed exceptions: owner-run SECURITY DEFINER dispatcher/scheduler functions must scan across tenants.
      -- RLS still applies to portico_app on these tables (only the owner is exempt).
      'core.outbox', 'core.event_deliveries', 'integration.tenant_schedule'
    ) then
      bad := bad || format(' %I.%I(rls not forced)', r.s, r.t);
    end if;
  end loop;
  if bad <> '' then raise exception 'DRILL FAIL: tenant isolation weakened:%', bad; end if;
end $$;

\echo '== check 2b: every tenant-owned table carries exactly the standard tenant policy'
-- RLS switched on proves nothing if a policy says USING (true). Each tenant-owned table must have exactly one policy,
-- `tenant_isolation`, permissive, for all commands and all roles, whose USING and WITH CHECK are exactly
-- (tenant_id = core.current_tenant_id()). Exact comparison: "… OR true" defeats a substring match.
do $$
declare bad text;
begin
  select string_agg(t, ' ' order by t) into bad from (
    select format('%s(%s)', c.oid::regclass, coalesce(p.polname, 'no policy')) as t
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      left join pg_policy p on p.polrelid = c.oid
     where c.relkind in ('r', 'p') and c.relrowsecurity
       and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
       and (p.polname is null
            or p.polname <> 'tenant_isolation' or not p.polpermissive or p.polcmd <> '*' or p.polroles <> '{0}'
            or pg_get_expr(p.polqual, p.polrelid) is distinct from '(tenant_id = core.current_tenant_id())'
            or pg_get_expr(p.polwithcheck, p.polrelid) is distinct from '(tenant_id = core.current_tenant_id())')
  ) x;
  if bad is not null then raise exception 'DRILL FAIL: non-standard tenant policy: %', bad; end if;
end $$;

\echo '== check 2c: policies on tables without tenant_id are reviewed (exact expressions)'
do $$
declare bad text;
begin
  select string_agg(format('%s.%s', c.oid::regclass, p.polname), ', ' order by 1) into bad
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
     and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
     and (c.oid::regclass::text, p.polname, p.polcmd::text,
          coalesce(regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\s+', ' ', 'g'), '-'),
          coalesce(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '\s+', ' ', 'g'), '-')) not in (
       -- identity (global person records; reviewed in the identity steward reviews, ADR-0017)
       ('identity.users', 'member_visible', 'r', '(EXISTS ( SELECT 1 FROM identity.memberships m WHERE (m.user_id = users.id)))', '-'),
       ('identity.users', 'member_update', 'w', '(EXISTS ( SELECT 1 FROM identity.memberships m WHERE (m.user_id = users.id)))', '-'),
       ('identity.users', 'insert_any', 'a', '-', 'true'),
       ('identity.mfa_factors', 'member_only', '*', '(EXISTS ( SELECT 1 FROM identity.memberships m WHERE (m.user_id = mfa_factors.user_id)))', '(EXISTS ( SELECT 1 FROM identity.memberships m WHERE (m.user_id = mfa_factors.user_id)))'),
       ('identity.mfa_recovery_codes', 'member_only', '*', '(EXISTS ( SELECT 1 FROM identity.memberships m WHERE (m.user_id = mfa_recovery_codes.user_id)))', '(EXISTS ( SELECT 1 FROM identity.memberships m WHERE (m.user_id = mfa_recovery_codes.user_id)))'));
  if bad is not null then raise exception 'DRILL FAIL: unreviewed policies on non-tenant tables: %', bad; end if;
end $$;

\echo '== check 3: tables WITHOUT row-level security are not readable or writable by any login group (app, worker)'
do $$
declare r record; g text; bad text := '';
begin
  foreach g in array array['portico_app', 'portico_worker'] loop
    continue when not exists (select 1 from pg_roles where rolname = g);
    for r in
      select n.nspname as s, c.relname as t
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r', 'p') and not c.relrowsecurity
         and n.nspname not in ('pg_catalog', 'information_schema', 'public')
         and n.nspname not like 'pg\_%'
    loop
      if format('%I.%I', r.s, r.t) not in ('core.schema_migrations')
         and has_table_privilege(g, format('%I.%I', r.s, r.t), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') then
        bad := bad || format(' %s→%I.%I', g, r.s, r.t);
      end if;
    end loop;
  end loop;
  if bad <> '' then raise exception 'DRILL FAIL: login groups can reach non-RLS tables:%', bad; end if;
end $$;

\echo '== check 4: no Portico role is privileged'
do $$
declare bad text;
begin
  select string_agg(rolname, ', ') into bad
    from pg_roles
   where rolname like 'portico\_%' and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb);
  if bad is not null then raise exception 'DRILL FAIL: privileged Portico roles: %', bad; end if;
end $$;

\echo '== check 5: audit log is append-only for every login group (app, worker)'
do $$
declare g text;
begin
  if to_regclass('core.audit_log') is null then raise exception 'DRILL FAIL: core.audit_log missing'; end if;
  foreach g in array array['portico_app', 'portico_worker'] loop
    continue when not exists (select 1 from pg_roles where rolname = g);
    if has_table_privilege(g, 'core.audit_log', 'UPDATE')
       or has_table_privilege(g, 'core.audit_log', 'DELETE')
       or has_table_privilege(g, 'core.audit_log', 'TRUNCATE') then
      raise exception 'DRILL FAIL: % can modify core.audit_log', g;
    end if;
  end loop;
end $$;

\echo '== check 6: financial integrity (every journal entry balances, per currency and in functional currency)'
-- Preferred: a finance-owned finance.verify_trial_balance() (requested from the finance module; it can also prove
-- folio balances = ledger projection). Until it exists, the drill checks the ledger invariant finance enforces at
-- commit (finance.assert_entry_balanced): Σ amount_minor per (entry, currency) = 0 and Σ functional_amount_minor per
-- entry = 0. A per-entry balance implies every tenant's trial balance sums to zero.
do $$
declare
  entries bigint;
  bad text;
begin
  if to_regprocedure('finance.verify_trial_balance()') is not null then
    perform finance.verify_trial_balance();
    raise notice 'trial balance verified by finance.verify_trial_balance()';
  elsif to_regclass('finance.journal_lines') is null then
    raise notice 'SKIPPED: no finance ledger in this database';
  else
    select count(distinct entry_id) into entries from finance.journal_lines;
    select string_agg(format('%s (%s)', entry_id, why), ', ') into bad from (
      select entry_id, 'currency ' || currency || ' off by ' || sum(amount_minor) as why
        from finance.journal_lines group by entry_id, currency having sum(amount_minor) <> 0
      union all
      select entry_id, 'functional off by ' || sum(functional_amount_minor)
        from finance.journal_lines group by entry_id having sum(functional_amount_minor) <> 0
      limit 20) x;
    if bad is not null then raise exception 'DRILL FAIL: unbalanced journal entries: %', bad; end if;
    raise notice 'ledger balanced: % journal entries checked (folio projection check pending finance.verify_trial_balance())', entries;
  end if;
end $$;

\echo '== check 7: SECURITY DEFINER functions reachable by login groups are exactly the reviewed ones'
-- The lists below are generated from infra/db/bootstrap-roles.mjs and compared by
-- infra/db/definer-lists.test.mjs (review P3-9): edit the module, then copy the lines it prints.
-- BEGIN GENERATED app_definers
create temporary table drill_app_definers (fn text primary key) on commit preserve rows;
insert into drill_app_definers values
  ('identity.login_lookup(text)'), ('identity.record_login_result(uuid,boolean)'), ('identity.ensure_user(uuid,text)'),
  ('identity.record_login_attempt(text,text,boolean,integer)'), ('identity.credential_epoch_for_email(text)'),
  ('identity.credential_summary(uuid)'), ('identity.first_email_verification(uuid,timestamp with time zone)'),
  ('identity.lock_person(uuid)'), ('identity.memberships_elsewhere(uuid,uuid)'), ('identity.pending_invitations(uuid)'),
  ('identity.revoke_sessions_everywhere(uuid,text)'), ('identity.claim_verified_domain(text,uuid,timestamp with time zone)'),
  ('identity.release_verified_domain(text,uuid)'), ('identity.verified_domain_holder(text)'),
  ('identity.record_domain_check(uuid,text,boolean,timestamp with time zone)'),
  ('identity.raise_platform_alert(uuid,text,text,jsonb,text)'), ('identity.list_platform_alerts(integer)'),
  ('identity.deposit_simulated_message(uuid,uuid,text,text,text,text,text)'), ('identity.read_dev_mailbox(text,integer)'),
  ('platform.tenant_environment(uuid)'), ('platform.tenant_summaries(uuid[])'),
  ('payments.route_webhook(text,text,boolean)');
-- END GENERATED app_definers
-- BEGIN GENERATED worker_only_definers
create temporary table drill_worker_definers (fn text primary key) on commit preserve rows;
insert into drill_worker_definers values
  ('core.claim_unfanned_events(integer)'), ('core.record_fanout(uuid,text[])'), ('core.claim_deliveries(integer,integer)'),
  ('core.record_delivery_failure(uuid,text,text,integer)'), ('core.claim_job(text,integer,integer)'),
  ('core.finish_job(text,boolean,text)'), ('core.purge_expired_idempotency_keys(integer)'),
  ('payments.tenants_for_jobs()'), ('integration.claim_due_tenants(integer,integer)'),
  ('inventory.tenants_with_due_expiries(timestamp with time zone,integer)'),
  ('inventory.tenants_with_ledger_since(date,integer)'), ('operations.job_properties()'),
  ('guests.tenants_with_expired_documents(date)'), ('guests.tenants_with_active_profiles()'),
  ('reservations.due_booking_expiries(timestamp with time zone)'), ('identity.purge_login_attempts(integer,integer)'),
  ('identity.purge_orphan_sso_links()'), ('identity.sso_domains_due(timestamp with time zone)');
-- END GENERATED worker_only_definers
do $$
declare g text; bad text := '';
begin
  foreach g in array array['portico_app', 'portico_worker'] loop
    if not exists (select 1 from pg_roles where rolname = g) then
      raise exception 'DRILL FAIL: role % missing — the role model was not restored', g;
    end if;
    select bad || coalesce(' ' || g || '→' || string_agg(p.oid::regprocedure::text, ', ' order by 1), '') into bad
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.prosecdef
       and p.prorettype <> 'trigger'::regtype
       and n.nspname not in ('pg_catalog', 'information_schema', 'public') and n.nspname not like 'pg\_%'
       and has_function_privilege(g, p.oid, 'execute')
       and p.oid::regprocedure::text not in (select fn from drill_app_definers)
       and (g = 'portico_app' or p.oid::regprocedure::text not in (select fn from drill_worker_definers));
  end loop;
  if bad <> '' then raise exception 'DRILL FAIL: unreviewed SECURITY DEFINER functions reachable by a login group:%', bad; end if;
  raise notice 'definer functions: app and worker reach only the reviewed lists';
end $$;

\echo '== evidence: latest committed activity (compare with the restore point to measure data loss)'
select 'core.audit_log' as source, max(occurred_at) as latest from core.audit_log
union all
select 'core.outbox', max(created_at) from core.outbox;

\echo '== evidence: row counts per Portico table'
select n.nspname || '.' || c.relname as table_name,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as rows
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'r' and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
 order by 1;

\echo 'DRILL CHECKS PASSED'
