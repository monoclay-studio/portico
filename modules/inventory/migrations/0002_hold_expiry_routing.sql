-- Hold sweeper routing (INV-R16). Returns ONLY organization ids that have expired, still-active holds (routing
-- metadata, never business data); the sweeper then releases them inside each organization's RLS-scoped
-- transaction with a system context. Reviewed SECURITY DEFINER pattern as in core.claim_unfanned_events.
create or replace function inventory.tenants_with_expired_holds(p_now timestamptz, p_limit int)
  returns table (tenant_id uuid)
  language sql stable security definer set search_path = inventory, pg_temp as $$
    select h.tenant_id from inventory.holds h
     where h.status = 'active' and h.expires_at <= p_now
     group by h.tenant_id
     order by min(h.expires_at)
     limit p_limit
$$;

revoke execute on function inventory.tenants_with_expired_holds(timestamptz, int) from public;
grant execute on function inventory.tenants_with_expired_holds(timestamptz, int) to portico_app;
