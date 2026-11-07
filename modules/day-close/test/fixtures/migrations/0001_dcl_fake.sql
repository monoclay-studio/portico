-- Test-only fixture (never shipped): a Postgres-backed stand-in for reservations' stays so that the fake is
-- transactional (a crashed transaction rolls a no-show back) and shared between processes (the SIGKILL test).
create schema dcl_fake;
create table dcl_fake.stays (
  id               uuid primary key,
  tenant_id        uuid not null,
  property_id      uuid not null,
  booking_id       uuid not null,
  status           text not null check (status in ('expected', 'in_house', 'checked_out', 'no_show', 'cancelled')),
  commercial_type  text not null default 'standard',
  arrival          date not null,
  departure        date not null,
  unit_type_id     uuid not null,
  rate_plan_id     uuid not null,
  occupancy        jsonb not null,
  segments         jsonb not null,
  eta              text,
  transfer         jsonb not null default '{}',
  no_show          jsonb,
  version          int not null default 1
);
select core.enable_tenant_isolation('dcl_fake.stays');
select core.apply_standard_grants('dcl_fake');
