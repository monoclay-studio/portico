-- TEST-ONLY schemas backing the high-fidelity fakes of InventoryPort and FinancePort. Postgres-backed so the
-- fakes share the command's transaction (rollback undoes their effects) and have REAL concurrency semantics
-- (row locks in deterministic order, guarded counters, exclusion constraint on assignments) — the same patterns
-- the real inventory module is specified to use (docs/architecture/overview.md "Concurrency patterns").
create schema fake_inventory;

create table fake_inventory.unit_types (
  id uuid primary key, tenant_id uuid not null, property_id uuid not null, code text not null, name text not null,
  rank int not null, max_occupancy int not null
);
create table fake_inventory.units (
  id uuid primary key, tenant_id uuid not null, property_id uuid not null, unit_type_id uuid not null, name text not null
);
create table fake_inventory.cells (
  tenant_id uuid not null, property_id uuid not null, unit_type_id uuid not null, night date not null,
  capacity int not null, out_of_order int not null default 0, sold int not null default 0, held int not null default 0,
  overbooking int not null default 0,
  primary key (tenant_id, unit_type_id, night)
);
create table fake_inventory.consumption (
  tenant_id uuid not null, ref_type text not null, ref_id text not null, unit_type_id uuid not null, night date not null,
  quantity int not null, consumed_at timestamptz not null,
  primary key (tenant_id, ref_type, ref_id, unit_type_id, night)
);
create table fake_inventory.holds (
  id uuid primary key, tenant_id uuid not null, unit_type_id uuid not null, from_date date not null, to_date date not null,
  quantity int not null, expires_at timestamptz not null, ref_type text not null, ref_id text not null,
  status text not null default 'active'
);
create table fake_inventory.assignments (
  id uuid primary key, tenant_id uuid not null, unit_id uuid not null, ref_type text not null, ref_id text not null,
  nights daterange not null,
  exclude using gist (unit_id with =, nights with &&)
);
create table fake_inventory.conflicts (
  id uuid primary key, tenant_id uuid not null, unit_type_id uuid not null, night date not null, shortfall int not null,
  ref_type text not null, ref_id text not null
);
select core.enable_tenant_isolation('fake_inventory.unit_types');
select core.enable_tenant_isolation('fake_inventory.units');
select core.enable_tenant_isolation('fake_inventory.cells');
select core.enable_tenant_isolation('fake_inventory.consumption');
select core.enable_tenant_isolation('fake_inventory.holds');
select core.enable_tenant_isolation('fake_inventory.assignments');
select core.enable_tenant_isolation('fake_inventory.conflicts');
select core.apply_standard_grants('fake_inventory');

create schema fake_finance;
create table fake_finance.folios (
  id uuid primary key, tenant_id uuid not null, property_id uuid not null, owner_type text not null, owner_id text not null,
  payer_type text not null, payer_id text not null, label text, is_default boolean not null, status text not null default 'open'
);
create table fake_finance.postings (
  id uuid primary key, tenant_id uuid not null, folio_id uuid not null, kind text not null, charge_code text,
  amount_minor bigint not null, currency char(3) not null, service_date date, description text,
  source_type text, source_id text, idempotency_key text not null,
  unique (tenant_id, idempotency_key)
);
create table fake_finance.deposits (
  id uuid primary key, tenant_id uuid not null, booking_id uuid not null, amount_minor bigint not null,
  currency char(3) not null, applied_to_folio uuid, idempotency_key text not null, unique (tenant_id, idempotency_key)
);
create table fake_finance.billing_rules (
  id uuid primary key, tenant_id uuid not null, owner_type text not null, owner_id text not null,
  destination_folio_id uuid not null, charge_code_groups text[] not null, from_date date, to_date date
);
select core.enable_tenant_isolation('fake_finance.folios');
select core.enable_tenant_isolation('fake_finance.postings');
select core.enable_tenant_isolation('fake_finance.deposits');
select core.enable_tenant_isolation('fake_finance.billing_rules');
select core.apply_standard_grants('fake_finance');
