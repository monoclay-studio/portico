-- rates: rate plans, prices (+history), restrictions (+history), promotions, inclusions, packages, policies
-- (+versions), tax & fee rules (effective-dated versions), plan sales ledger.
-- unit_type_id / property_id reference other modules by id only (no cross-schema foreign keys).
create schema rates;

---------------------------------------------------------------------------------------------------------
-- Policies (cancellation / guarantee / deposit) — versioned; every version kept for audit.
---------------------------------------------------------------------------------------------------------
create table rates.policies (
  id           uuid primary key,
  tenant_id    uuid not null,
  property_id  uuid not null,
  kind         text not null check (kind in ('cancellation', 'guarantee', 'deposit')),
  code         text not null,
  name         text not null,
  structure    jsonb not null,
  status       text not null default 'active' check (status in ('active', 'retired')),
  version      int  not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, property_id, code)
);
select core.enable_tenant_isolation('rates.policies');

create table rates.policy_versions (
  id          uuid primary key,
  tenant_id   uuid not null,
  policy_id   uuid not null references rates.policies(id),
  version     int  not null,
  name        text not null,
  structure   jsonb not null,
  changed_at  timestamptz not null,
  changed_by  text not null,
  unique (policy_id, version)
);
select core.enable_tenant_isolation('rates.policy_versions');

---------------------------------------------------------------------------------------------------------
-- Inclusions (components and allowances) and packages (bundles; meal plans are packages with a code).
---------------------------------------------------------------------------------------------------------
create table rates.inclusions (
  id                 uuid primary key,
  tenant_id          uuid not null,
  property_id        uuid not null,
  code               text not null,
  name               text not null,
  kind               text not null check (kind in ('component', 'allowance')),
  charge_code        text not null,
  tax_category       text not null,
  pricing            jsonb not null,
  basis              text not null check (basis in ('per_unit', 'per_person', 'per_adult', 'per_child', 'per_stay')),
  rhythm             jsonb not null,
  price_mode         text not null check (price_mode in ('included', 'added')),
  fulfilment_outlets text[] not null default '{}',
  outlet_kind        text,
  allowance          jsonb,
  status             text not null default 'active' check (status in ('active', 'retired')),
  version            int  not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, property_id, code),
  check ((kind = 'allowance') = (allowance is not null))
);
select core.enable_tenant_isolation('rates.inclusions');

create table rates.packages (
  id              uuid primary key,
  tenant_id       uuid not null,
  property_id     uuid not null,
  code            text not null,
  name            text not null,
  description     text,
  meal_plan_code  text,
  inclusion_ids   uuid[] not null,
  status          text not null default 'active' check (status in ('active', 'retired')),
  version         int  not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, property_id, code)
);
select core.enable_tenant_isolation('rates.packages');

---------------------------------------------------------------------------------------------------------
-- Rate plans (base and derived). Derivation depth ≤ 3 and acyclicity are enforced by the service under a
-- per-property advisory lock (graph-wide invariants cannot be expressed as row constraints).
---------------------------------------------------------------------------------------------------------
create table rates.rate_plans (
  id                     uuid primary key,
  tenant_id              uuid not null,
  property_id            uuid not null,
  code                   text not null,
  name                   text not null,
  description            text,
  currency               char(3) not null,
  parent_id              uuid references rates.rate_plans(id),
  derivation             jsonb,
  inherit                jsonb not null,
  meal_plan              text not null default 'RO',
  package_ids            uuid[] not null default '{}',
  cancellation_policy_id uuid references rates.policies(id),
  guarantee_policy_id    uuid references rates.policies(id),
  deposit_policy_id      uuid references rates.policies(id),
  eligibility            jsonb not null default '{}',
  commission             jsonb,
  tax_inclusion          jsonb not null default '{"mode":"exclusive"}',
  room_charge_code       text not null default 'ROOM',
  market_segment         text,
  status                 text not null default 'draft' check (status in ('draft', 'active', 'paused', 'retired')),
  version                int  not null default 1,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (tenant_id, property_id, code),
  check ((parent_id is null) = (derivation is null)),
  check (parent_id is null or parent_id <> id)
);
select core.enable_tenant_isolation('rates.rate_plans');
create index rate_plans_parent_idx on rates.rate_plans (parent_id);

---------------------------------------------------------------------------------------------------------
-- Prices: one row per (rate plan, unit type, night). Only base plans hold prices; derived plans compute.
-- Every change is versioned in price_history (append-only) and grouped in a change set (who / when / why).
---------------------------------------------------------------------------------------------------------
create table rates.change_sets (
  id            uuid primary key,
  tenant_id     uuid not null,
  property_id   uuid not null,
  kind          text not null check (kind in ('prices', 'restrictions')),
  rate_plan_id  uuid,
  actor         jsonb not null,
  actor_key     text not null,
  reason        text,
  summary       jsonb not null,
  created_at    timestamptz not null
);
select core.enable_tenant_isolation('rates.change_sets');

create table rates.prices (
  id                     uuid primary key,
  tenant_id              uuid not null,
  property_id            uuid not null,
  rate_plan_id           uuid not null references rates.rate_plans(id),
  unit_type_id           uuid not null,
  stay_date              date not null,
  currency               char(3) not null,
  base_occupancy         int not null check (base_occupancy between 1 and 20),
  base_amount_minor      bigint not null check (base_amount_minor >= 0),
  single_amount_minor    bigint check (single_amount_minor >= 0),
  extra_adult_minor      bigint check (extra_adult_minor >= 0),
  child_amounts_minor    jsonb not null default '{}',
  occupancy_amounts_minor jsonb not null default '{}',
  version                int not null default 1,
  change_set_id          uuid not null references rates.change_sets(id),
  updated_at             timestamptz not null,
  unique (tenant_id, rate_plan_id, unit_type_id, stay_date)
);
select core.enable_tenant_isolation('rates.prices');
create index prices_calendar_idx on rates.prices (tenant_id, property_id, stay_date);

create table rates.price_history (
  id            uuid primary key,
  tenant_id     uuid not null,
  property_id   uuid not null,
  change_set_id uuid not null references rates.change_sets(id),
  rate_plan_id  uuid not null,
  unit_type_id  uuid not null,
  stay_date     date not null,
  before        jsonb,
  after         jsonb not null,
  changed_at    timestamptz not null,
  changed_by    text not null
);
select core.enable_tenant_isolation('rates.price_history');
create index price_history_cell_idx on rates.price_history (tenant_id, rate_plan_id, unit_type_id, stay_date, changed_at);

---------------------------------------------------------------------------------------------------------
-- Restrictions per scope (rate plan | all plans) × (unit type | all types) × night.
---------------------------------------------------------------------------------------------------------
create table rates.restrictions (
  id                  uuid primary key,
  tenant_id           uuid not null,
  property_id         uuid not null,
  rate_plan_id        uuid references rates.rate_plans(id),
  unit_type_id        uuid,
  stay_date           date not null,
  closed              boolean,
  closed_to_arrival   boolean,
  closed_to_departure boolean,
  min_los             int check (min_los between 1 and 366),
  min_los_through     int check (min_los_through between 1 and 366),
  max_los             int check (max_los between 1 and 366),
  min_advance_days    int check (min_advance_days between 0 and 730),
  max_advance_days    int check (max_advance_days between 0 and 730),
  sales_limit         int check (sales_limit between 0 and 10000),
  version             int not null default 1,
  change_set_id       uuid not null references rates.change_sets(id),
  updated_at          timestamptz not null,
  constraint restrictions_scope_unique unique nulls not distinct (tenant_id, property_id, rate_plan_id, unit_type_id, stay_date)
);
select core.enable_tenant_isolation('rates.restrictions');
create index restrictions_calendar_idx on rates.restrictions (tenant_id, property_id, stay_date);

create table rates.restriction_history (
  id            uuid primary key,
  tenant_id     uuid not null,
  property_id   uuid not null,
  change_set_id uuid not null references rates.change_sets(id),
  rate_plan_id  uuid,
  unit_type_id  uuid,
  stay_date     date not null,
  before        jsonb,
  after         jsonb not null,
  changed_at    timestamptz not null,
  changed_by    text not null
);
select core.enable_tenant_isolation('rates.restriction_history');

---------------------------------------------------------------------------------------------------------
-- Promotions
---------------------------------------------------------------------------------------------------------
create table rates.promotions (
  id              uuid primary key,
  tenant_id       uuid not null,
  property_id     uuid not null,
  code            text not null,
  name            text not null,
  discount        jsonb not null,
  conditions      jsonb not null,
  combinability   text not null check (combinability in ('exclusive', 'stackable')),
  stackable_with  text[] not null default '{}',
  sequence        int not null default 100,
  status          text not null default 'active' check (status in ('active', 'paused', 'retired')),
  version         int not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, property_id, code)
);
select core.enable_tenant_isolation('rates.promotions');
create unique index promotions_code_idx on rates.promotions (tenant_id, property_id, upper(conditions->>'promoCode'))
  where conditions ? 'promoCode' and status <> 'retired';

---------------------------------------------------------------------------------------------------------
-- Tax & fee rules: DATA, effective-dated, cited, with verification status. Versions are immutable once
-- created (only status / closing date / activation evidence may change — enforced by column grants below).
-- At most one ACTIVE version of a rule is effective for any date (exclusion constraint, RAT-I06).
---------------------------------------------------------------------------------------------------------
create table rates.tax_rules (
  id                 uuid primary key,
  tenant_id          uuid not null,
  code               text not null,
  name               text not null,
  jurisdiction       text not null,
  category           text not null check (category in ('tax', 'fee')),
  -- statutory: follows its tax point at posting; commercial (hotel-set, e.g. service charge): agreed stays keep
  -- the version recorded in their terms.
  nature             text not null default 'statutory' check (nature in ('statutory', 'commercial')),
  property_ids       uuid[],
  tax_point_policy   text not null check (tax_point_policy in ('service_date', 'booking_date', 'invoice_date', 'time_of_supply')),
  ledger_mapping_key text not null,
  sequence           int not null default 100,
  status             text not null default 'active' check (status in ('active', 'retired')),
  template           text,
  version            int not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, code)
);
select core.enable_tenant_isolation('rates.tax_rules');

create table rates.tax_rule_versions (
  id                  uuid primary key,
  tenant_id           uuid not null,
  tax_rule_id         uuid not null references rates.tax_rules(id),
  version_no          int not null,
  status              text not null check (status in ('draft', 'active', 'withdrawn')),
  effective_from      date,
  effective_to        date,
  definition          jsonb not null,
  verification        jsonb not null,
  sources             jsonb not null,
  notes               text,
  created_at          timestamptz not null,
  created_by          text not null,
  activated_at        timestamptz,
  activated_by        text,
  activation_report   jsonb,
  unique (tax_rule_id, version_no),
  check (effective_from is null or effective_to is null or effective_to > effective_from),
  constraint tax_rule_versions_no_overlap exclude using gist (
    tax_rule_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  ) where (status = 'active')
);
select core.enable_tenant_isolation('rates.tax_rule_versions');

---------------------------------------------------------------------------------------------------------
-- Plan sales ledger (sales limits). Reservations records / releases consumption through the provider API.
---------------------------------------------------------------------------------------------------------
create table rates.plan_sales (
  id            uuid primary key,
  tenant_id     uuid not null,
  property_id   uuid not null,
  rate_plan_id  uuid not null references rates.rate_plans(id),
  unit_type_id  uuid not null,
  stay_date     date not null,
  ref_type      text not null,
  ref_id        text not null,
  quantity      int not null check (quantity > 0),
  created_at    timestamptz not null,
  released_at   timestamptz,
  unique (tenant_id, rate_plan_id, stay_date, ref_type, ref_id)
);
select core.enable_tenant_isolation('rates.plan_sales');
create index plan_sales_count_idx on rates.plan_sales (tenant_id, property_id, stay_date) where released_at is null;

select core.apply_standard_grants('rates');

-- History and evidence tables are append-only.
select core.make_append_only('rates.policy_versions');
select core.make_append_only('rates.change_sets');
select core.make_append_only('rates.price_history');
select core.make_append_only('rates.restriction_history');

-- Tax rule versions: never deleted; definition, dates of origin, citations and verification are immutable.
revoke update, delete, truncate on rates.tax_rule_versions from portico_app;
grant update (status, effective_to, activated_at, activated_by, activation_report) on rates.tax_rule_versions to portico_app;
-- Configuration rows are retired, never deleted (history and agreed terms refer to them).
revoke delete, truncate on rates.rate_plans, rates.policies, rates.inclusions, rates.packages, rates.promotions,
  rates.tax_rules, rates.plan_sales from portico_app;
