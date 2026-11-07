-- Inventory: unit catalog, availability ledger, holds, assignments, unit blocks, authorized overbooking and
-- inventory conflicts. See modules/inventory/README.md for the model (incl. composite units).
-- No foreign keys into other schemas: property ids are references only (module extractability).
create schema inventory;

---------------------------------------------------------------------------------------------------------
-- Catalog
---------------------------------------------------------------------------------------------------------

-- Unit features catalog per property (sea_view, water_villa, private_pool, connecting, accessible, …).
create table inventory.features (
  id          uuid primary key,
  tenant_id   uuid not null,
  property_id uuid not null,
  code        text not null check (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  name        text not null check (length(name) between 1 and 120),
  category    text not null default 'general'
              check (category in ('view', 'location', 'layout', 'amenity', 'accessibility', 'general')),
  description text,
  status      text not null default 'active' check (status in ('active', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     int not null default 1,
  unique (tenant_id, property_id, code)
);
select core.enable_tenant_isolation('inventory.features');

-- The category that is sold and priced. Inventory is counted per unit type per night.
create table inventory.unit_types (
  id              uuid primary key,
  tenant_id       uuid not null,
  property_id     uuid not null,
  code            text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  name            text not null check (length(name) between 1 and 120),
  kind            text not null check (kind in ('room', 'villa', 'suite', 'apartment', 'bed', 'tent', 'pitch', 'other')),
  noun            text not null check (length(noun) between 1 and 40),
  description     text,
  base_occupancy  int not null check (base_occupancy >= 1),
  max_adults      int not null check (max_adults >= 1),
  max_children    int not null check (max_children >= 0),
  max_occupancy   int not null check (max_occupancy >= 1),
  bedding         text,
  size_sqm        int check (size_sqm is null or size_sqm > 0),
  rank            int not null default 0,
  sort_order      int not null default 0,
  sellable        boolean not null default true,
  -- A composite type is sold assignment-first: each sale assigns a composite unit and consumes its components.
  is_composite    boolean not null default false,
  features        text[] not null default '{}',
  status          text not null default 'active' check (status in ('active', 'archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         int not null default 1,
  unique (tenant_id, property_id, code),
  check (base_occupancy <= max_occupancy),
  check (max_adults <= max_occupancy),
  check (max_children <= max_occupancy),
  check (max_occupancy <= max_adults + max_children)
);
select core.enable_tenant_isolation('inventory.unit_types');
create index unit_types_property_idx on inventory.unit_types (property_id, sort_order);

-- A physical (or, for composite types, combined) accommodation unit.
create table inventory.units (
  id                      uuid primary key,
  tenant_id               uuid not null,
  property_id             uuid not null,
  unit_type_id            uuid not null references inventory.unit_types (id),
  number                  text not null check (length(number) between 1 and 20),
  name                    text,
  building                text,
  floor                   text,
  zone                    text,
  features                text[] not null default '{}',
  max_occupancy_override  int check (max_occupancy_override is null or max_occupancy_override >= 1),
  sort_order              int not null default 0,
  -- active units count in capacity for nights in [in_inventory_from, in_inventory_to)
  status                  text not null default 'active' check (status in ('active', 'inactive', 'retired')),
  in_inventory_from       date not null,
  in_inventory_to         date,
  is_composite            boolean not null default false,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  version                 int not null default 1,
  unique (tenant_id, property_id, number),
  check (in_inventory_to is null or in_inventory_to > in_inventory_from)
);
select core.enable_tenant_isolation('inventory.units');
create index units_type_idx on inventory.units (unit_type_id);
create index units_property_idx on inventory.units (property_id, sort_order, number);

-- Composite unit membership. A unit may be a component of at most one composite unit of a given composite type.
create table inventory.composite_components (
  tenant_id               uuid not null,
  composite_unit_id       uuid not null references inventory.units (id),
  composite_unit_type_id  uuid not null references inventory.unit_types (id),
  component_unit_id       uuid not null references inventory.units (id),
  component_unit_type_id  uuid not null references inventory.unit_types (id),
  primary key (composite_unit_id, component_unit_id),
  unique (composite_unit_type_id, component_unit_id),
  check (composite_unit_id <> component_unit_id)
);
select core.enable_tenant_isolation('inventory.composite_components');
create index composite_components_component_idx on inventory.composite_components (component_unit_id);
create index composite_components_component_type_idx on inventory.composite_components (component_unit_type_id);

---------------------------------------------------------------------------------------------------------
-- Availability ledger: one row per (unit type, night), created lazily by the first command touching it.
-- available = capacity − out_of_order − sold − held + overbooking_allowance  (glossary formula)
---------------------------------------------------------------------------------------------------------
create table inventory.ledger (
  tenant_id              uuid not null,
  property_id            uuid not null,
  unit_type_id           uuid not null references inventory.unit_types (id),
  night                  date not null,
  capacity               int not null check (capacity >= 0),
  out_of_order           int not null default 0 check (out_of_order >= 0),
  sold                   int not null default 0 check (sold >= 0),
  held                   int not null default 0 check (held >= 0),
  overbooking_allowance  int not null default 0 check (overbooking_allowance >= 0),
  version                int not null default 1,
  updated_at             timestamptz not null default now(),
  primary key (unit_type_id, night)
);
select core.enable_tenant_isolation('inventory.ledger');
create index ledger_property_night_idx on inventory.ledger (property_id, night);

-- Consumption per (ref, unit type, night). The unique key makes re-applying a consumption idempotent.
create table inventory.consumptions (
  id                        uuid primary key,
  tenant_id                 uuid not null,
  property_id               uuid not null,
  ref_type                  text not null check (length(ref_type) between 1 and 60),
  ref_id                    uuid not null,
  unit_type_id              uuid not null references inventory.unit_types (id),
  night                     date not null,
  quantity                  int not null check (quantity > 0),
  kind                      text not null
                            check (kind in ('stay', 'house_use', 'block_allocation', 'composite_component', 'import')),
  -- for composite_component rows: the composite unit type whose sale consumed this component
  parent_unit_type_id       uuid references inventory.unit_types (id),
  hold_id                   uuid,
  overbooking_allowance_id  uuid,
  created_at                timestamptz not null,
  unique (tenant_id, ref_type, ref_id, unit_type_id, night)
);
select core.enable_tenant_isolation('inventory.consumptions');
create index consumptions_cell_idx on inventory.consumptions (unit_type_id, night);
create index consumptions_ref_idx on inventory.consumptions (ref_type, ref_id);

-- Temporary claims with an expiry. Composite holds also hold k units on each component type.
create table inventory.holds (
  id                    uuid primary key,
  tenant_id             uuid not null,
  property_id           uuid not null,
  unit_type_id          uuid not null references inventory.unit_types (id),
  nights                daterange not null check (not isempty(nights) and lower_inc(nights) and not upper_inc(nights)),
  quantity              int not null check (quantity > 0),
  component_quantities  jsonb not null default '[]',
  ref_type              text not null,
  ref_id                uuid not null,
  status                text not null default 'active' check (status in ('active', 'converted', 'released', 'expired')),
  expires_at            timestamptz not null,
  created_by            text not null,
  created_at            timestamptz not null,
  closed_at             timestamptz,
  close_reason          text,
  converted_ref_type    text,
  converted_ref_id      uuid,
  version               int not null default 1,
  check ((status = 'active') = (closed_at is null))
);
select core.enable_tenant_isolation('inventory.holds');
create index holds_active_type_idx on inventory.holds using gist (unit_type_id, nights) where status = 'active';
create index holds_active_expiry_idx on inventory.holds (expires_at) where status = 'active';
create index holds_ref_idx on inventory.holds (ref_type, ref_id);

---------------------------------------------------------------------------------------------------------
-- Assignments: a specific unit for a ref over a half-open night range. The database guarantees that no unit
-- is assigned twice on one night, and that a ref occupies at most one (top-level) unit per night.
-- Composite assignments have child rows on every component unit (same ref and nights).
---------------------------------------------------------------------------------------------------------
create table inventory.assignments (
  id                    uuid primary key,
  tenant_id             uuid not null,
  property_id           uuid not null,
  unit_id               uuid not null references inventory.units (id),
  unit_type_id          uuid not null references inventory.unit_types (id),
  ref_type              text not null,
  ref_id                uuid not null,
  nights                daterange not null check (not isempty(nights) and lower_inc(nights) and not upper_inc(nights)),
  locked                boolean not null default false,
  lock_reason           text,
  upgrade               jsonb,
  parent_assignment_id  uuid references inventory.assignments (id) on delete cascade,
  created_by            text not null,
  created_at            timestamptz not null,
  check (not locked or lock_reason is not null),
  constraint assignments_no_unit_overlap exclude using gist (unit_id with =, nights with &&),
  constraint assignments_no_ref_overlap exclude using gist (ref_type with =, ref_id with =, nights with &&)
    where (parent_assignment_id is null)
);
select core.enable_tenant_isolation('inventory.assignments');
create index assignments_ref_idx on inventory.assignments (ref_type, ref_id);
create index assignments_property_nights_idx on inventory.assignments using gist (property_id, nights);

---------------------------------------------------------------------------------------------------------
-- Unit blocks: out_of_order (reduces capacity), out_of_service (not assignable, still counted),
-- house_use (consumes inventory, no revenue). `effective_nights` shrinks when a block is released early so the
-- nights already in the past keep their history.
---------------------------------------------------------------------------------------------------------
create table inventory.unit_blocks (
  id                    uuid primary key,
  tenant_id             uuid not null,
  property_id           uuid not null,
  unit_id               uuid not null references inventory.units (id),
  unit_type_id          uuid not null references inventory.unit_types (id),
  kind                  text not null check (kind in ('out_of_order', 'out_of_service', 'house_use')),
  nights                daterange not null check (not isempty(nights) and lower_inc(nights) and not upper_inc(nights)),
  effective_nights      daterange not null,
  reason                text not null check (length(reason) between 1 and 500),
  source_ref_type       text,
  source_ref_id         uuid,
  status                text not null default 'active' check (status in ('active', 'released')),
  affected_assignments  jsonb not null default '[]',
  created_by            text not null,
  created_at            timestamptz not null,
  released_at           timestamptz,
  released_by           text,
  release_reason        text,
  version               int not null default 1,
  check (effective_nights <@ nights or isempty(effective_nights)),
  constraint unit_blocks_no_overlap exclude using gist (unit_id with =, effective_nights with &&)
);
select core.enable_tenant_isolation('inventory.unit_blocks');
create index unit_blocks_property_idx on inventory.unit_blocks using gist (property_id, effective_nights);

---------------------------------------------------------------------------------------------------------
-- Authorized overbooking: explicit allowance per (unit type, night) with who and why.
-- standing = set by a manager in advance; ad_hoc = authorized for one sale (consume with overbooking).
---------------------------------------------------------------------------------------------------------
create table inventory.overbooking_allowances (
  id                  uuid primary key,
  tenant_id           uuid not null,
  property_id         uuid not null,
  unit_type_id        uuid not null references inventory.unit_types (id),
  night               date not null,
  quantity            int not null check (quantity > 0),
  kind                text not null check (kind in ('standing', 'ad_hoc')),
  reason              text not null check (length(reason) between 1 and 500),
  authorized_by       text not null,
  entered_by          text not null,
  ref_type            text,
  ref_id              uuid,
  expires_at          timestamptz,
  status              text not null default 'active' check (status in ('active', 'revoked', 'expired', 'superseded')),
  created_at          timestamptz not null,
  closed_at           timestamptz,
  check ((kind = 'ad_hoc') = (ref_id is not null))
);
select core.enable_tenant_isolation('inventory.overbooking_allowances');
create unique index overbooking_one_standing_idx on inventory.overbooking_allowances (unit_type_id, night)
  where kind = 'standing' and status = 'active';
create index overbooking_cell_idx on inventory.overbooking_allowances (unit_type_id, night) where status = 'active';
create index overbooking_ref_idx on inventory.overbooking_allowances (ref_type, ref_id) where ref_id is not null;

---------------------------------------------------------------------------------------------------------
-- Inventory conflicts: a cell oversold beyond its authorized allowance. Exactly one open conflict per cell.
---------------------------------------------------------------------------------------------------------
create table inventory.conflicts (
  id                    uuid primary key,
  tenant_id             uuid not null,
  property_id           uuid not null,
  unit_type_id          uuid not null references inventory.unit_types (id),
  night                 date not null,
  shortfall             int not null check (shortfall >= 0),
  max_shortfall         int not null check (max_shortfall > 0),
  causes                jsonb not null default '[]',
  status                text not null default 'open' check (status in ('open', 'resolving', 'resolved')),
  owner_user_id         uuid,
  resolution            text check (resolution in ('relocated', 'upgraded', 'moved_dates', 'cancelled',
                                                   'allowance_authorized', 'capacity_restored', 'other')),
  detected_at           timestamptz not null,
  resolved_at           timestamptz,
  previous_conflict_id  uuid references inventory.conflicts (id),
  version               int not null default 1,
  check ((status = 'resolved') = (resolved_at is not null)),
  check (status = 'resolved' or shortfall > 0)
);
select core.enable_tenant_isolation('inventory.conflicts');
create unique index conflicts_one_open_idx on inventory.conflicts (unit_type_id, night) where status <> 'resolved';
create index conflicts_property_idx on inventory.conflicts (property_id, status, night);

select core.apply_standard_grants('inventory');
