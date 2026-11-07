-- TEST-ONLY schema backing the strict fake of reservations.ingestChannelBooking. Postgres-backed so the fake runs
-- in distribution's transaction (a rollback undoes it) with real uniqueness and locking semantics.
create schema fake_res;
create table fake_res.bookings (
  id uuid primary key,
  tenant_id uuid not null,
  connection_id uuid not null,
  external_id text not null,
  status text not null,
  nights int not null,
  unique (tenant_id, connection_id, external_id)
);
create table fake_res.revisions (
  tenant_id uuid not null,
  connection_id uuid not null,
  external_id text not null,
  revision bigint not null,
  outcome text not null,
  applied boolean not null,
  booking_id uuid,
  payload jsonb not null,
  unique (tenant_id, connection_id, external_id, revision)
);
select core.enable_tenant_isolation('fake_res.bookings');
select core.enable_tenant_isolation('fake_res.revisions');
select core.apply_standard_grants('fake_res');
