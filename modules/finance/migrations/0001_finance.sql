-- Finance: double-entry ledger (source of truth for money), folios and postings (projections), charge codes,
-- billing rules, deposits, allowances, receivables, fiscal documents, cashier sessions, FX rates.
-- ADR-0008. Money is integer minor units. Posted financial rows are append-only; corrections are new entries.
create schema finance;

---------------------------------------------------------------------------------------------------------
-- Chart of accounts (per legal entity)
---------------------------------------------------------------------------------------------------------
create table finance.accounts (
  id               uuid primary key,
  tenant_id        uuid not null,
  legal_entity_id  uuid not null,
  code             text not null,
  name             text not null,
  type             text not null check (type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  -- Stable key used by posting logic (e.g. 'guest_ledger', 'revenue:room', 'tax:tgst', 'card_clearing:stripe').
  system_key       text,
  -- Functional currency of the owning legal entity (lines carry their own transaction currency).
  functional_currency char(3) not null,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  version          int not null default 1,
  unique (tenant_id, legal_entity_id, code),
  unique (id, legal_entity_id)
);
create unique index accounts_system_key_uq on finance.accounts (tenant_id, legal_entity_id, system_key)
  where system_key is not null;
select core.enable_tenant_isolation('finance.accounts');

---------------------------------------------------------------------------------------------------------
-- Charge codes (per property)
---------------------------------------------------------------------------------------------------------
create table finance.charge_codes (
  id                 uuid primary key,
  tenant_id          uuid not null,
  property_id        uuid not null,
  code               text not null,
  name               text not null,
  -- The group is immutable after creation: billing-rule overlap analysis depends on it.
  charge_group       text not null check (charge_group in ('room', 'package', 'food', 'beverage', 'spa', 'activity',
                       'transfer', 'retail', 'minibar', 'fee', 'penalty', 'misc', 'allowance', 'gratuity')),
  revenue_account_id uuid,
  tax_group          text,            -- consumed by the tax engine (rates); null = never taxed
  department         text,
  allowance_tags     text[] not null default '{}',
  restricted         boolean not null default false,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            int not null default 1,
  unique (tenant_id, property_id, code)
);
select core.enable_tenant_isolation('finance.charge_codes');

---------------------------------------------------------------------------------------------------------
-- FX rates (explicit, per legal entity, per business date)
---------------------------------------------------------------------------------------------------------
create table finance.fx_rates (
  id               uuid primary key,
  tenant_id        uuid not null,
  legal_entity_id  uuid not null,
  business_date    date not null,
  from_currency    char(3) not null,
  to_currency      char(3) not null,
  rate             numeric(24, 12) not null check (rate > 0),   -- units of `to` per 1 unit of `from`
  source           text not null,
  entered_by       text not null,
  created_at       timestamptz not null default now(),
  check (from_currency <> to_currency),
  unique (tenant_id, legal_entity_id, business_date, from_currency, to_currency)
);
select core.enable_tenant_isolation('finance.fx_rates');

---------------------------------------------------------------------------------------------------------
-- Folios (bills per payer). Balances are projections of postings / journal lines.
---------------------------------------------------------------------------------------------------------
create table finance.folios (
  id               uuid primary key,
  tenant_id        uuid not null,
  property_id      uuid not null,
  legal_entity_id  uuid not null,
  owner_type       text not null check (owner_type in ('stay', 'booking', 'group', 'company', 'house')),
  owner_id         uuid not null,
  payer_type       text not null check (payer_type in ('guest', 'company', 'agency', 'house')),
  payer_id         uuid,
  payer_name       text not null,
  label            text,
  currency         char(3) not null,
  is_default       boolean not null default false,
  -- open → settled (zero balance) → closed; settled → open (reopen: late charge / correction); open → voided
  status           text not null default 'open' check (status in ('open', 'settled', 'closed', 'voided')),
  reopen_count     int not null default 0,
  reopened_reason  text,
  supplementary_of uuid references finance.folios(id),
  post_departure   boolean not null default false,
  opened_at        timestamptz not null,
  settled_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          int not null default 1,
  unique (id, legal_entity_id)
);
create unique index folios_one_default_per_owner on finance.folios (tenant_id, owner_type, owner_id) where is_default;
create index folios_owner_idx on finance.folios (tenant_id, owner_type, owner_id);
create index folios_property_status_idx on finance.folios (tenant_id, property_id, status);
select core.enable_tenant_isolation('finance.folios');

-- Owners (stays/bookings) that have departed — maintained from reservations (event or direct call).
create table finance.owner_departures (
  tenant_id      uuid not null,
  owner_type     text not null,
  owner_id       uuid not null,
  property_id    uuid not null,
  departed_on    date not null,
  recorded_at    timestamptz not null,
  primary key (tenant_id, owner_type, owner_id)
);
select core.enable_tenant_isolation('finance.owner_departures');

---------------------------------------------------------------------------------------------------------
-- Cashier sessions (needed before postings reference them)
---------------------------------------------------------------------------------------------------------
create table finance.cashier_sessions (
  id               uuid primary key,
  tenant_id        uuid not null,
  property_id      uuid not null,
  legal_entity_id  uuid not null,
  user_key         text not null,       -- actor key of the cashier
  cashier_name     text not null,
  status           text not null default 'open' check (status in ('open', 'closed')),
  opened_at        timestamptz not null,
  opened_business_date date not null,
  opening_floats   jsonb not null default '{}',   -- { "USD": 20000, "MVR": 150000 } (minor units)
  closed_at        timestamptz,
  counted          jsonb,
  expected         jsonb,
  variance         jsonb,
  close_note       text,
  version          int not null default 1
);
create unique index cashier_one_open_session on finance.cashier_sessions (tenant_id, property_id, user_key)
  where status = 'open';
select core.enable_tenant_isolation('finance.cashier_sessions');

---------------------------------------------------------------------------------------------------------
-- Journal (append-only, balanced per entry per currency and in functional currency)
---------------------------------------------------------------------------------------------------------
create table finance.journal_entries (
  id                      uuid primary key,
  tenant_id               uuid not null,
  legal_entity_id         uuid not null,
  property_id             uuid,
  entry_type              text not null check (entry_type in ('charge', 'payment', 'refund', 'deposit', 'deposit_application',
                            'deposit_refund', 'deposit_forfeit', 'transfer', 'adjustment', 'allowance_grant',
                            'allowance_close', 'payout', 'fx_settlement', 'cash_variance', 'paid_out',
                            'receivables_transfer', 'receivables_payment', 'write_off', 'opening_balance')),
  business_date           date not null,
  occurred_at             timestamptz not null,
  idempotency_key         text not null,
  request_hash            text not null,
  source_type             text,
  source_id               text,
  reverses_entry_id       uuid references finance.journal_entries(id),
  corrects_entry_id       uuid references finance.journal_entries(id),
  relates_to_business_date date,
  same_day_correction     boolean not null default false,
  reason_code             text,
  description             text not null,
  actor                   jsonb not null,
  actor_key               text not null,
  correlation_id          text not null,
  txid                    bigint not null default txid_current(),
  created_at              timestamptz not null default clock_timestamp(),
  unique (tenant_id, idempotency_key),
  unique (id, legal_entity_id)
);
-- A full reversal can happen at most once per entry.
create unique index journal_entries_reversal_once on finance.journal_entries (reverses_entry_id) where reverses_entry_id is not null;
create index journal_entries_le_date_idx on finance.journal_entries (tenant_id, legal_entity_id, business_date);
create index journal_entries_property_date_idx on finance.journal_entries (tenant_id, property_id, business_date);
select core.enable_tenant_isolation('finance.journal_entries');

create table finance.postings (
  id                  uuid primary key,
  tenant_id           uuid not null,
  entry_id            uuid not null,
  legal_entity_id     uuid not null,
  property_id         uuid not null,
  folio_id            uuid not null,
  kind                text not null check (kind in ('charge', 'tax', 'allowance_usage', 'payment', 'refund',
                        'deposit_application', 'transfer_in', 'transfer_out', 'adjustment', 'write_off',
                        'paid_out', 'receivables_transfer', 'allowance_return', 'opening_balance')),
  -- Signed, in folio currency: positive = payer owes more; negative = payer owes less.
  amount_minor        bigint not null,
  currency            char(3) not null,
  original_amount_minor bigint,
  original_currency   char(3),
  fx_rate_id          uuid references finance.fx_rates(id),
  charge_code_id      uuid references finance.charge_codes(id),
  charge_code         text,
  tax_rule_id         text,
  tax_rule_version_id text,
  tax_name            text,
  tax_kind            text check (tax_kind in ('tax', 'fee', 'service_charge')),
  -- Units the tax was computed on (e.g. guest-days for Green Tax), exempt units and rate category (reporting).
  tax_units           numeric(18, 4),
  tax_exempt_units    numeric(18, 4),
  tax_rate_category   text,
  tax_rate            text,
  quantity            numeric(18, 4),
  unit_price_minor    bigint,
  description         text not null,
  service_date        date,
  revenue_date        date,
  business_date       date not null,
  parent_posting_id   uuid references finance.postings(id),
  corrects_posting_id uuid references finance.postings(id),
  transfer_peer_id    uuid,
  billing_rule_id     uuid,
  allowance_instance_id uuid,
  -- The account on the other side of the guest ledger for this posting (revenue, tax, clearing…); used to
  -- reverse exactly what was posted.
  counter_account_id  uuid,
  payment_ref_type    text,
  payment_ref_id      text,
  payment_method      text,
  cashier_session_id  uuid references finance.cashier_sessions(id),
  source_type         text,
  source_id           text,
  post_departure      boolean not null default false,
  created_at          timestamptz not null default clock_timestamp(),
  foreign key (entry_id, legal_entity_id) references finance.journal_entries (id, legal_entity_id),
  foreign key (folio_id, legal_entity_id) references finance.folios (id, legal_entity_id)
);
create index postings_folio_idx on finance.postings (folio_id, created_at);
create index postings_entry_idx on finance.postings (entry_id);
create index postings_rule_idx on finance.postings (billing_rule_id, service_date) where billing_rule_id is not null;
create index postings_payment_ref_idx on finance.postings (tenant_id, payment_ref_type, payment_ref_id) where payment_ref_id is not null;
create index postings_corrects_idx on finance.postings (corrects_posting_id) where corrects_posting_id is not null;
create index postings_session_idx on finance.postings (cashier_session_id) where cashier_session_id is not null;
select core.enable_tenant_isolation('finance.postings');

create table finance.journal_lines (
  id                       uuid primary key,
  tenant_id                uuid not null,
  entry_id                 uuid not null,
  legal_entity_id          uuid not null,
  line_no                  int not null,
  account_id               uuid not null,
  -- Sub-ledger: folio (guest ledger), booking deposit, receivables account, cashier session.
  sub_ledger_type          text check (sub_ledger_type in ('folio', 'booking_deposit', 'receivables_account', 'cashier_session', 'allowance')),
  sub_ledger_id            uuid,
  -- Signed: positive = debit, negative = credit. Transaction currency.
  amount_minor             bigint not null,
  currency                 char(3) not null,
  functional_amount_minor  bigint not null,
  functional_currency      char(3) not null,
  fx_rate_id               uuid references finance.fx_rates(id),
  posting_id               uuid references finance.postings(id),
  charge_code              text,
  service_date             date,
  revenue_date             date,
  memo                     text,
  unique (entry_id, line_no),
  foreign key (entry_id, legal_entity_id) references finance.journal_entries (id, legal_entity_id),
  foreign key (account_id, legal_entity_id) references finance.accounts (id, legal_entity_id),
  check ((sub_ledger_type is null) = (sub_ledger_id is null))
);
create index journal_lines_account_idx on finance.journal_lines (account_id);
create index journal_lines_sub_ledger_idx on finance.journal_lines (sub_ledger_type, sub_ledger_id);
create unique index journal_lines_posting_uq on finance.journal_lines (posting_id) where posting_id is not null;
select core.enable_tenant_isolation('finance.journal_lines');

-- Balance check, deferred to commit: Σ amount per currency = 0, Σ functional = 0, ≥ 2 lines, and every posting
-- of the entry is mirrored by exactly one guest-ledger line on the same folio with the same amount.
create or replace function finance.assert_entry_balanced(p_entry_id uuid) returns void
  language plpgsql as $$
declare
  n_lines int;
  bad record;
begin
  select count(*) into n_lines from finance.journal_lines where entry_id = p_entry_id;
  if n_lines < 2 then
    raise exception 'Journal entry % has % line(s); a balanced entry needs at least two.', p_entry_id, n_lines
      using errcode = '23514';
  end if;
  select currency, sum(amount_minor) as total into bad from finance.journal_lines
    where entry_id = p_entry_id group by currency having sum(amount_minor) <> 0 limit 1;
  if found then
    raise exception 'Journal entry % is unbalanced in %: debits and credits differ by % minor units.',
      p_entry_id, bad.currency, bad.total using errcode = '23514';
  end if;
  select sum(functional_amount_minor) as total into bad from finance.journal_lines where entry_id = p_entry_id
    having sum(functional_amount_minor) <> 0;
  if found then
    raise exception 'Journal entry % is unbalanced in functional currency by % minor units.', p_entry_id, bad.total
      using errcode = '23514';
  end if;
  select p.id into bad from finance.postings p
    where p.entry_id = p_entry_id
      and not exists (select 1 from finance.journal_lines l
                      where l.posting_id = p.id and l.entry_id = p_entry_id and l.sub_ledger_type = 'folio'
                        and l.sub_ledger_id = p.folio_id and l.amount_minor = p.amount_minor
                        and l.currency = p.currency)
    limit 1;
  if found then
    raise exception 'Posting % is not mirrored by a matching guest-ledger journal line.', bad.id using errcode = '23514';
  end if;
end $$;

create or replace function finance.check_entry_trigger() returns trigger
  language plpgsql as $$
begin
  perform finance.assert_entry_balanced(new.id);
  return null;
end $$;

create or replace function finance.check_line_trigger() returns trigger
  language plpgsql as $$
declare
  entry_txid bigint;
begin
  select txid into entry_txid from finance.journal_entries where id = new.entry_id;
  if entry_txid is distinct from txid_current() then
    raise exception 'Lines can only be added to journal entry % in the transaction that created it. Record a new entry instead.',
      new.entry_id using errcode = 'P0001';
  end if;
  perform finance.assert_entry_balanced(new.entry_id);
  return null;
end $$;

create or replace function finance.check_posting_trigger() returns trigger
  language plpgsql as $$
declare
  entry_txid bigint;
begin
  select txid into entry_txid from finance.journal_entries where id = new.entry_id;
  if entry_txid is distinct from txid_current() then
    raise exception 'Postings can only be added to journal entry % in the transaction that created it.',
      new.entry_id using errcode = 'P0001';
  end if;
  return null;
end $$;

create constraint trigger entry_balanced after insert on finance.journal_entries
  deferrable initially deferred for each row execute function finance.check_entry_trigger();
create constraint trigger line_balanced after insert on finance.journal_lines
  deferrable initially deferred for each row execute function finance.check_line_trigger();
create constraint trigger posting_in_entry_tx after insert on finance.postings
  deferrable initially deferred for each row execute function finance.check_posting_trigger();

---------------------------------------------------------------------------------------------------------
-- Billing rules (who pays for what). Deterministic specificity: the most specific matching rule wins;
-- overlapping rules that are not strictly nested are rejected at save time. There is no user-ranked priority.
---------------------------------------------------------------------------------------------------------
create table finance.billing_rules (
  id                   uuid primary key,
  tenant_id            uuid not null,
  property_id          uuid not null,
  owner_type           text not null check (owner_type in ('stay', 'booking', 'group')),
  owner_id             uuid not null,
  destination_folio_id uuid not null references finance.folios(id),
  label                text not null,
  selector             jsonb not null,
  cap                  jsonb,
  source               text not null default 'manual' check (source in ('manual', 'company_default', 'rate_plan', 'group', 'package')),
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  version              int not null default 1
);
create index billing_rules_owner_idx on finance.billing_rules (tenant_id, owner_type, owner_id) where active;
select core.enable_tenant_isolation('finance.billing_rules');

---------------------------------------------------------------------------------------------------------
-- Deposits (liability per booking)
---------------------------------------------------------------------------------------------------------
create table finance.deposit_accounts (
  id               uuid primary key,
  tenant_id        uuid not null,
  legal_entity_id  uuid not null,
  property_id      uuid not null,
  booking_id       uuid not null,
  currency         char(3) not null,
  balance_minor    bigint not null default 0 check (balance_minor >= 0),
  -- Tax already declared on the remaining balance (time of supply = receipt of the deposit), per tax account key.
  declared_tax     jsonb not null default '{}',
  version          int not null default 1,
  unique (tenant_id, booking_id)
);
select core.enable_tenant_isolation('finance.deposit_accounts');

create table finance.deposit_movements (
  id               uuid primary key,
  tenant_id        uuid not null,
  deposit_account_id uuid not null references finance.deposit_accounts(id),
  booking_id       uuid not null,
  kind             text not null check (kind in ('received', 'applied', 'refunded', 'forfeited', 'opening_balance')),
  amount_minor     bigint not null,      -- signed effect on the deposit balance
  currency         char(3) not null,
  entry_id         uuid not null references finance.journal_entries(id),
  folio_id         uuid references finance.folios(id),
  payment_ref_type text,
  payment_ref_id   text,
  -- Tax declared (+) or released (−) by this movement: [{ accountKey, ruleId, ruleVersionId, name, rate, amountMinor }]
  taxes            jsonb not null default '[]',
  business_date    date not null,
  created_at       timestamptz not null default clock_timestamp()
);
create index deposit_movements_booking_idx on finance.deposit_movements (tenant_id, booking_id);
select core.enable_tenant_isolation('finance.deposit_movements');

---------------------------------------------------------------------------------------------------------
-- Allowances (entitlements tracked to consumption)
---------------------------------------------------------------------------------------------------------
create table finance.allowance_instances (
  id               uuid primary key,
  tenant_id        uuid not null,
  property_id      uuid not null,
  legal_entity_id  uuid not null,
  stay_id          uuid not null,
  folio_id         uuid not null references finance.folios(id),
  definition_ref   text not null,
  label            text not null,
  period_key       text not null,          -- a night 'YYYY-MM-DD' or 'stay'
  valid_from       date not null,
  valid_to         date not null,          -- exclusive
  eligible_charge_codes text[] not null default '{}',
  eligible_groups  text[] not null default '{}',
  eligible_tags    text[] not null default '{}',
  covers_taxes     boolean not null default true,
  unused_policy    text not null check (unused_policy in ('forfeit', 'carry_forward', 'credit_back')),
  currency         char(3) not null,
  granted_minor    bigint not null check (granted_minor > 0),
  used_minor       bigint not null default 0,
  status           text not null default 'active' check (status in ('active', 'consumed', 'closed', 'cancelled')),
  grant_entry_id   uuid not null references finance.journal_entries(id),
  close_entry_id   uuid references finance.journal_entries(id),
  carried_to_id    uuid references finance.allowance_instances(id),
  carried_from_id  uuid references finance.allowance_instances(id),
  version          int not null default 1,
  check (used_minor >= 0 and used_minor <= granted_minor),
  unique (tenant_id, stay_id, definition_ref, period_key)
);
create index allowance_stay_idx on finance.allowance_instances (tenant_id, stay_id, status);
select core.enable_tenant_isolation('finance.allowance_instances');

---------------------------------------------------------------------------------------------------------
-- Receivables (city ledger)
---------------------------------------------------------------------------------------------------------
create table finance.receivables_accounts (
  id                 uuid primary key,
  tenant_id          uuid not null,
  legal_entity_id    uuid not null,
  company_id         uuid not null,
  kind               text not null check (kind in ('company', 'agency')),
  name               text not null,
  currency           char(3) not null,
  terms_days         int not null check (terms_days >= 0 and terms_days <= 365),
  credit_limit_minor bigint check (credit_limit_minor is null or credit_limit_minor >= 0),
  credit_limit_mode  text not null default 'block' check (credit_limit_mode in ('block', 'warn')),
  status             text not null default 'active' check (status in ('active', 'on_hold', 'closed')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            int not null default 1,
  unique (tenant_id, legal_entity_id, company_id)
);
select core.enable_tenant_isolation('finance.receivables_accounts');

create table finance.receivables_items (
  id                 uuid primary key,
  tenant_id          uuid not null,
  account_id         uuid not null references finance.receivables_accounts(id),
  kind               text not null check (kind in ('invoice', 'payment', 'credit_note', 'write_off', 'opening_balance')),
  amount_minor       bigint not null,       -- signed: positive = owed by the company
  currency           char(3) not null,
  business_date      date not null,
  due_date           date,
  document_id        uuid,
  folio_id           uuid references finance.folios(id),
  entry_id           uuid not null references finance.journal_entries(id),
  reference          text,
  created_at         timestamptz not null default clock_timestamp()
);
create index receivables_items_account_idx on finance.receivables_items (account_id, business_date);
select core.enable_tenant_isolation('finance.receivables_items');

create table finance.receivables_allocations (
  id                 uuid primary key,
  tenant_id          uuid not null,
  account_id         uuid not null references finance.receivables_accounts(id),
  debit_item_id      uuid not null references finance.receivables_items(id),
  credit_item_id     uuid not null references finance.receivables_items(id),
  amount_minor       bigint not null check (amount_minor > 0),
  business_date      date not null,
  created_at         timestamptz not null default clock_timestamp()
);
create index receivables_alloc_debit_idx on finance.receivables_allocations (debit_item_id);
create index receivables_alloc_credit_idx on finance.receivables_allocations (credit_item_id);
select core.enable_tenant_isolation('finance.receivables_allocations');

---------------------------------------------------------------------------------------------------------
-- Fiscal documents: invoices and credit notes, gapless per series, hash-chained per legal entity, immutable.
---------------------------------------------------------------------------------------------------------
create table finance.fiscal_series (
  id               uuid primary key,
  tenant_id        uuid not null,
  legal_entity_id  uuid not null,
  property_id      uuid,
  kind             text not null check (kind in ('invoice', 'credit_note')),
  prefix           text not null,
  next_number      int not null default 1 check (next_number >= 1),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  version          int not null default 1,
  unique (tenant_id, legal_entity_id, kind, prefix)
);
select core.enable_tenant_isolation('finance.fiscal_series');

create table finance.fiscal_chains (
  tenant_id        uuid not null,
  legal_entity_id  uuid not null,
  last_hash        text not null,
  document_count   int not null default 0,
  primary key (tenant_id, legal_entity_id)
);
select core.enable_tenant_isolation('finance.fiscal_chains');

create table finance.fiscal_documents (
  id                   uuid primary key,
  tenant_id            uuid not null,
  legal_entity_id      uuid not null,
  property_id          uuid not null,
  series_id            uuid not null references finance.fiscal_series(id),
  number               int not null,
  document_number      text not null,
  kind                 text not null check (kind in ('invoice', 'credit_note')),
  folio_id             uuid not null references finance.folios(id),
  original_document_id uuid references finance.fiscal_documents(id),
  credit_mode          text check (credit_mode in ('cancel', 'adjust')),
  currency             char(3) not null,
  total_minor          bigint not null,
  snapshot             jsonb not null,
  business_date        date not null,
  issued_at            timestamptz not null,
  idempotency_key      text not null,
  request_hash         text not null,
  chain_position       int not null,
  previous_hash        text not null,
  hash                 text not null,
  issued_by            text not null,
  -- Retention: at least 5 years after the end of the tax year (Maldives Tax Administration Act); legal holds extend.
  retain_until         date not null,
  created_at           timestamptz not null default clock_timestamp(),
  unique (series_id, number),
  unique (tenant_id, idempotency_key),
  unique (tenant_id, legal_entity_id, chain_position)
);
create index fiscal_documents_folio_idx on finance.fiscal_documents (folio_id);
select core.enable_tenant_isolation('finance.fiscal_documents');

-- Postings included on an issued invoice are locked to it (mutable lock table: a cancelling credit note
-- releases the lock so the postings can be invoiced again; the documents themselves never change).
create table finance.posting_document_locks (
  tenant_id     uuid not null,
  posting_id    uuid primary key references finance.postings(id),
  document_id   uuid not null references finance.fiscal_documents(id)
);
create index posting_locks_document_idx on finance.posting_document_locks (document_id);
select core.enable_tenant_isolation('finance.posting_document_locks');

-- Legal holds extend retention of a legal entity's financial records beyond the statutory minimum.
create table finance.legal_holds (
  id               uuid primary key,
  tenant_id        uuid not null,
  legal_entity_id  uuid not null,
  reason           text not null,
  placed_by        text not null,
  placed_at        timestamptz not null,
  released_by      text,
  released_at      timestamptz,
  release_reason   text,
  version          int not null default 1
);
create index legal_holds_le_idx on finance.legal_holds (tenant_id, legal_entity_id) where released_at is null;
select core.enable_tenant_isolation('finance.legal_holds');

---------------------------------------------------------------------------------------------------------
-- Cash movements per cashier session (append-only)
---------------------------------------------------------------------------------------------------------
create table finance.cash_movements (
  id               uuid primary key,
  tenant_id        uuid not null,
  session_id       uuid not null references finance.cashier_sessions(id),
  kind             text not null check (kind in ('payment', 'refund', 'paid_out', 'variance')),
  amount_minor     bigint not null,       -- signed effect on the drawer
  currency         char(3) not null,
  entry_id         uuid references finance.journal_entries(id),
  posting_id       uuid references finance.postings(id),
  reference        text,
  created_at       timestamptz not null default clock_timestamp()
);
create index cash_movements_session_idx on finance.cash_movements (session_id);
select core.enable_tenant_isolation('finance.cash_movements');

---------------------------------------------------------------------------------------------------------
-- Opening balance imports (migration; scenario 18)
---------------------------------------------------------------------------------------------------------
create table finance.opening_balance_imports (
  id                    uuid primary key,
  tenant_id             uuid not null,
  legal_entity_id       uuid not null,
  property_id           uuid not null,
  import_ref            text not null,
  kind                  text not null check (kind in ('deposits')),
  currency              char(3) not null,
  provided_closing_minor bigint not null,
  imported_total_minor  bigint not null,
  difference_minor      bigint not null,
  status                text not null check (status in ('reconciled', 'difference')),
  entry_id              uuid references finance.journal_entries(id),
  report                jsonb not null,
  business_date         date not null,
  created_at            timestamptz not null default clock_timestamp(),
  unique (tenant_id, import_ref)
);
select core.enable_tenant_isolation('finance.opening_balance_imports');

---------------------------------------------------------------------------------------------------------
-- Finance exceptions (Day Close / dashboards): late charges, collection follow-ups, credit limit warnings…
---------------------------------------------------------------------------------------------------------
create table finance.exceptions (
  id               uuid primary key,
  tenant_id        uuid not null,
  property_id      uuid not null,
  kind             text not null,
  severity         text not null check (severity in ('urgent', 'routine')),
  ref_type         text not null,
  ref_id           text not null,
  message          text not null,
  details          jsonb not null default '{}',
  status           text not null default 'open' check (status in ('open', 'resolved')),
  business_date    date not null,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolution       text,
  version          int not null default 1
);
create unique index exceptions_open_uq on finance.exceptions (tenant_id, kind, ref_type, ref_id) where status = 'open';
create index exceptions_property_idx on finance.exceptions (tenant_id, property_id, status);
select core.enable_tenant_isolation('finance.exceptions');

create trigger touch before update on finance.charge_codes for each row execute function core.touch_updated_at();
create trigger touch before update on finance.folios for each row execute function core.touch_updated_at();
create trigger touch before update on finance.billing_rules for each row execute function core.touch_updated_at();
create trigger touch before update on finance.receivables_accounts for each row execute function core.touch_updated_at();

select core.apply_standard_grants('finance');

-- Financial and history records are append-only (grants + trigger).
select core.make_append_only('finance.journal_entries');
select core.make_append_only('finance.journal_lines');
select core.make_append_only('finance.postings');
select core.make_append_only('finance.deposit_movements');
select core.make_append_only('finance.receivables_items');
select core.make_append_only('finance.receivables_allocations');
select core.make_append_only('finance.fiscal_documents');
select core.make_append_only('finance.cash_movements');
select core.make_append_only('finance.opening_balance_imports');
select core.make_append_only('finance.fx_rates');
-- Mutable aggregates must never be deleted (only state transitions).
revoke delete on finance.folios, finance.accounts, finance.charge_codes, finance.deposit_accounts,
  finance.allowance_instances, finance.receivables_accounts, finance.fiscal_series, finance.fiscal_chains,
  finance.cashier_sessions, finance.billing_rules, finance.exceptions, finance.legal_holds from portico_app;
-- Series numbering may only move forward.
create or replace function finance.series_forward_only() returns trigger
  language plpgsql as $$
begin
  if new.next_number < old.next_number then
    raise exception 'Fiscal series numbers can only move forward.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger forward_only before update on finance.fiscal_series for each row execute function finance.series_forward_only();
