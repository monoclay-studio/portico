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
      -- Reviewed exceptions: owner-run SECURITY DEFINER dispatcher functions must fan out across tenants.
      'core.outbox', 'core.event_deliveries'
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

\echo '== check 6: financial integrity hook (finance module contract)'
-- The finance module must provide finance.verify_trial_balance(): raises if any tenant's ledger does not sum to
-- zero or a folio balance differs from its ledger projection. Until that module exists this check is SKIPPED and
-- the drill report says so — it is never reported as passed.
do $$
begin
  if to_regprocedure('finance.verify_trial_balance()') is null then
    raise notice 'SKIPPED: finance.verify_trial_balance() not present (finance module not built yet)';
  else
    perform finance.verify_trial_balance();
    raise notice 'trial balance verified';
  end if;
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
