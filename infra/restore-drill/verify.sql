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

\echo '== check 3: tables WITHOUT row-level security are not readable by the application role'
do $$
declare r record; bad text := '';
begin
  for r in
    select n.nspname as s, c.relname as t
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and not c.relrowsecurity
       and n.nspname not in ('pg_catalog', 'information_schema', 'public')
       and n.nspname not like 'pg\_%'
  loop
    if has_table_privilege('portico_app', format('%I.%I', r.s, r.t), 'SELECT')
       and format('%I.%I', r.s, r.t) not in ('core.schema_migrations') then
      bad := bad || format(' %I.%I', r.s, r.t);
    end if;
  end loop;
  if bad <> '' then raise exception 'DRILL FAIL: app role can read non-RLS tables:%', bad; end if;
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

\echo '== check 5: audit log is append-only for the application role'
do $$
begin
  if to_regclass('core.audit_log') is null then raise exception 'DRILL FAIL: core.audit_log missing'; end if;
  if has_table_privilege('portico_app', 'core.audit_log', 'UPDATE')
     or has_table_privilege('portico_app', 'core.audit_log', 'DELETE')
     or has_table_privilege('portico_app', 'core.audit_log', 'TRUNCATE') then
    raise exception 'DRILL FAIL: portico_app can modify core.audit_log';
  end if;
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

\echo '== check 7: cross-tenant routing functions are not callable by request handlers (portico_app)'
-- Reviewed SECURITY DEFINER functions portico_app may execute (sign-in, tenant lookups, the public payments webhook
-- route). Keep in sync with APP_DEFINER_FUNCTIONS / ROUTING_FUNCTIONS.workerAndApp in infra/db/bootstrap-roles.mjs.
do $$
declare bad text;
begin
  if not exists (select 1 from pg_roles where rolname = 'portico_app') then
    raise notice 'SKIPPED: no portico_app role'; return;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef
     and p.prorettype <> 'trigger'::regtype
     and n.nspname not in ('pg_catalog', 'information_schema', 'public') and n.nspname not like 'pg\_%'
     and has_function_privilege('portico_app', p.oid, 'execute')
     and p.oid::regprocedure::text not in (
       'identity.login_lookup(text)', 'identity.record_login_result(uuid,boolean)', 'identity.ensure_user(uuid,text)',
       'platform.tenant_environment(uuid)', 'platform.tenant_summaries(uuid[])',
       'payments.route_webhook(text,text,boolean)');
  if bad is not null then raise exception 'DRILL FAIL: portico_app can execute unreviewed SECURITY DEFINER functions: %', bad; end if;
  raise notice 'routing functions restricted to portico_worker';
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
