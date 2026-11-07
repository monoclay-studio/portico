-- 1) Sweeper routing for everything that lapses (INV-R16 holds, INV-I03 overbooking allowances): organization ids
--    only (routing metadata). Replaces tenants_with_expired_holds from 0002.
drop function if exists inventory.tenants_with_expired_holds(timestamptz, int);

create or replace function inventory.tenants_with_due_expiries(p_now timestamptz, p_limit int)
  returns table (tenant_id uuid)
  language sql stable security definer set search_path = inventory, pg_temp as $$
    select d.tenant_id from (
      select h.tenant_id, min(h.expires_at) as due from inventory.holds h
       where h.status = 'active' and h.expires_at <= p_now group by h.tenant_id
      union all
      select a.tenant_id, min(a.expires_at) from inventory.overbooking_allowances a
       where a.status = 'active' and a.expires_at is not null and a.expires_at <= p_now group by a.tenant_id
    ) d
    group by d.tenant_id
    order by min(d.due)
    limit p_limit
$$;

revoke execute on function inventory.tenants_with_due_expiries(timestamptz, int) from public;
grant execute on function inventory.tenants_with_due_expiries(timestamptz, int) to portico_app;

-- 2) Sweeper routing for the ledger consistency check (INV-I02): organizations that have ledger rows from a night on.
create or replace function inventory.tenants_with_ledger_since(p_night date, p_limit int)
  returns table (tenant_id uuid)
  language sql stable security definer set search_path = inventory, pg_temp as $$
    select distinct l.tenant_id from inventory.ledger l where l.night >= p_night limit p_limit
$$;

revoke execute on function inventory.tenants_with_ledger_since(date, int) from public;
grant execute on function inventory.tenants_with_ledger_since(date, int) to portico_app;

-- 3) Connected mode: when the external system of record last applied its availability state here
--    (provenance `external` with last-sync time; without any sync the counts are labelled `incomplete`).
create table inventory.external_sync (
  tenant_id        uuid not null,
  property_id      uuid not null,
  connection_id    uuid not null,
  last_applied_at  timestamptz not null,
  operations       bigint not null default 0,
  primary key (tenant_id, property_id, connection_id)
);
select core.enable_tenant_isolation('inventory.external_sync');

select core.apply_standard_grants('inventory');
