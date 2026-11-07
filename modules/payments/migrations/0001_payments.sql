-- Payments (ADR-0007): the hotel's legal entity is merchant of record; Monoclay never holds guest funds; the
-- domain is provider-agnostic; every provider call is journaled; unknown outcomes are pending_verification.
-- Portico NEVER stores card numbers or verification codes: no column here can hold them (see checks below and
-- the schema test in test/pci-schema.test.ts).
create schema payments;

---------------------------------------------------------------------------------------------------------
-- Payment accounts: a legal entity's account at a payment provider (or its own terminal/gateway, Route D).
---------------------------------------------------------------------------------------------------------
create table payments.accounts (
  id                   uuid primary key,
  tenant_id            uuid not null,
  legal_entity_id      uuid not null,             -- merchant of record (platform legal entity; id only)
  provider             text not null check (provider in ('simulator', 'stripe_connect', 'external_terminal')),
  external_account_id  text,                      -- e.g. Stripe connected account acct_…, terminal merchant id
  display_name         text not null,
  capabilities         jsonb not null default '[]',
  onboarding_status    text not null default 'not_started'
                         check (onboarding_status in ('not_started', 'in_progress', 'complete', 'not_applicable')),
  country_code         char(2),
  currencies           text[] not null,
  statement_descriptor text,
  status               text not null default 'pending' check (status in ('pending', 'active', 'restricted', 'disabled')),
  status_reason        text,
  application_fee_bps  int check (application_fee_bps is null or application_fee_bps between 0 and 1000),
  simulator_controls   jsonb not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  version              int not null default 1,
  unique (tenant_id, provider, external_account_id),
  check (provider <> 'stripe_connect' or external_account_id ~ '^acct_[A-Za-z0-9]+$'),
  check (cardinality(currencies) > 0)
);
select core.enable_tenant_isolation('payments.accounts');
create index accounts_legal_entity_idx on payments.accounts (tenant_id, legal_entity_id);

-- Circuit breaker per account (scenario s20): visible to staff; nothing is sent while open.
create table payments.account_health (
  account_id            uuid primary key references payments.accounts(id),
  tenant_id             uuid not null,
  state                 text not null default 'closed' check (state in ('closed', 'open', 'half_open')),
  consecutive_failures  int not null default 0,
  opened_at             timestamptz,
  probe_after           timestamptz,
  last_success_at       timestamptz,
  last_failure_at       timestamptz,
  last_error            text,
  updated_at            timestamptz not null default now()
);
select core.enable_tenant_isolation('payments.account_health');

---------------------------------------------------------------------------------------------------------
-- Payment methods: provider tokens only.
---------------------------------------------------------------------------------------------------------
create table payments.payment_methods (
  id                    uuid primary key,
  tenant_id             uuid not null,
  account_id            uuid not null references payments.accounts(id),
  property_id           uuid not null,             -- where it was captured (permission scope)
  kind                  text not null check (kind in ('card', 'virtual_card', 'wallet')),
  provider_token        text not null,             -- PSP payment-method id or PCI-vault alias. NEVER a PAN.
  provider_customer_ref text,
  brand                 text,
  last4                 char(4) check (last4 is null or last4 ~ '^[0-9]{4}$'),
  exp_month             smallint check (exp_month is null or exp_month between 1 and 12),
  exp_year              smallint check (exp_year is null or exp_year between 2000 and 2100),
  holder_name           text,
  owner_type            text not null check (owner_type in ('guest_profile', 'company', 'agency', 'booking')),
  owner_id              uuid not null,
  mit_agreement         boolean not null default false,
  mandate               jsonb not null default '{}',
  token_portability     text not null default 'provider_bound'
                          check (token_portability in ('provider_bound', 'network_token', 'vault_portable', 'unknown')),
  portability_note      text,
  status                text not null default 'active' check (status in ('active', 'detached', 'expired')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  version               int not null default 1,
  unique (tenant_id, account_id, provider_token),
  -- Defense in depth: anything shaped like a card number (12+ digits, optional spaces/dashes) is refused.
  check (provider_token !~ '^[0-9][0-9 -]{11,}$')
);
select core.enable_tenant_isolation('payments.payment_methods');
create index payment_methods_owner_idx on payments.payment_methods (tenant_id, owner_type, owner_id);

---------------------------------------------------------------------------------------------------------
-- Authorizations (funds reserved; NOT a payment; never posted to the ledger).
---------------------------------------------------------------------------------------------------------
create table payments.authorizations (
  id                 uuid primary key,
  tenant_id          uuid not null,
  property_id        uuid not null,
  legal_entity_id    uuid not null,
  account_id         uuid not null references payments.accounts(id),
  method_id          uuid references payments.payment_methods(id),
  ref_type           text not null,
  ref_id             uuid not null,
  business_key       text not null,
  currency           char(3) not null,
  amount_minor       bigint not null check (amount_minor > 0),
  captured_minor     bigint not null default 0 check (captured_minor >= 0),
  capture_reserved_minor bigint not null default 0 check (capture_reserved_minor >= 0),
  status             text not null check (status in ('processing', 'pending_verification', 'authorized',
                       'partially_captured', 'captured', 'voided', 'expired', 'failed')),
  mode               text not null check (mode in ('live', 'sandbox', 'simulate', 'recorded')),
  initiator          text not null default 'customer' check (initiator in ('customer', 'merchant')),
  provider_ref       text,
  external_reference text,                          -- approval code for recorded (Route D) authorizations
  expires_at         timestamptz,
  decline            jsonb,
  created_by         text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            int not null default 1,
  unique (tenant_id, business_key),
  check (captured_minor + capture_reserved_minor <= amount_minor)
);
select core.enable_tenant_isolation('payments.authorizations');
create index authorizations_ref_idx on payments.authorizations (tenant_id, ref_type, ref_id);
create index authorizations_status_idx on payments.authorizations (tenant_id, property_id, status);

---------------------------------------------------------------------------------------------------------
-- Payment requests (links). "paid" only from provider-confirmed payments.
---------------------------------------------------------------------------------------------------------
create table payments.payment_requests (
  id                uuid primary key,
  tenant_id         uuid not null,
  property_id       uuid not null,
  legal_entity_id   uuid not null,
  account_id        uuid not null references payments.accounts(id),
  business_key      text not null,
  payer             jsonb not null,
  currency          char(3) not null,
  amount_minor      bigint not null check (amount_minor > 0),
  paid_minor        bigint not null default 0 check (paid_minor >= 0),
  purpose           text not null check (purpose in ('deposit', 'balance', 'incidentals_preauth', 'custom')),
  description       text,
  ref_type          text not null check (ref_type in ('folio', 'booking')),
  ref_id            uuid not null,
  expires_at        timestamptz not null,
  status            text not null default 'open' check (status in ('open', 'partially_paid', 'paid', 'expired', 'cancelled')),
  mode              text not null check (mode in ('live', 'sandbox', 'simulate')),
  provider_link_ref text,
  link_url          text,
  link_status       text not null default 'pending' check (link_status in ('pending', 'created', 'failed', 'unknown')),
  cancelled_reason  text,
  created_by        text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           int not null default 1,
  unique (tenant_id, business_key)
);
select core.enable_tenant_isolation('payments.payment_requests');
create index payment_requests_ref_idx on payments.payment_requests (tenant_id, ref_type, ref_id);

---------------------------------------------------------------------------------------------------------
-- OTA virtual cards: metadata separate from the token (the token itself lives in the PCI vault/proxy).
---------------------------------------------------------------------------------------------------------
create table payments.virtual_cards (
  id                 uuid primary key,
  tenant_id          uuid not null,
  property_id        uuid not null,
  method_id          uuid not null references payments.payment_methods(id),
  booking_id         uuid not null,
  ref_type           text not null check (ref_type in ('folio', 'booking')),
  ref_id             uuid not null,
  channel            text not null,
  channel_reference  text not null,
  currency           char(3) not null,
  amount_minor       bigint not null check (amount_minor > 0),
  activation_date    date not null,                -- property-local date, per reservation
  expires_on         date,
  status             text not null default 'scheduled'
                       check (status in ('scheduled', 'charging', 'charged', 'funding_retry', 'failed', 'cancelled')),
  attempts           int not null default 0,
  next_attempt_at    timestamptz,
  last_failure       jsonb,
  charged_payment_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            int not null default 1,
  unique (tenant_id, channel, channel_reference)
);
select core.enable_tenant_isolation('payments.virtual_cards');

---------------------------------------------------------------------------------------------------------
-- Payments (funds collected or recorded) and refunds (separate objects referencing the payment).
---------------------------------------------------------------------------------------------------------
create table payments.payments (
  id                     uuid primary key,
  tenant_id              uuid not null,
  property_id            uuid not null,
  legal_entity_id        uuid not null,
  account_id             uuid references payments.accounts(id),
  method_id              uuid references payments.payment_methods(id),
  authorization_id       uuid references payments.authorizations(id),
  payment_request_id     uuid references payments.payment_requests(id),
  virtual_card_id        uuid references payments.virtual_cards(id),
  kind                   text not null check (kind in ('charge', 'capture', 'link', 'recorded')),
  method                 text not null check (method in ('card', 'virtual_card', 'payment_link', 'external_terminal',
                           'cash', 'bank_transfer')),
  initiator              text check (initiator in ('customer', 'merchant')),
  ref_type               text not null check (ref_type in ('folio', 'booking')),
  ref_id                 uuid not null,
  business_key           text not null,
  currency               char(3) not null,
  amount_minor           bigint not null check (amount_minor > 0),
  refunded_minor         bigint not null default 0 check (refunded_minor >= 0),
  refund_reserved_minor  bigint not null default 0 check (refund_reserved_minor >= 0),
  status                 text not null check (status in ('processing', 'pending_verification', 'succeeded', 'failed',
                           'recorded_unverified', 'recorded_verified')),
  mode                   text not null check (mode in ('live', 'sandbox', 'simulate', 'recorded')),
  provider_ref           text,
  external_reference     text,                      -- terminal approval code / bank reference / receipt number
  terminal_id            text,
  card_brand             text,
  card_last4             char(4) check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  received_at            timestamptz,               -- when the money was taken (recorded payments)
  decline                jsonb,
  ledger_status          text not null default 'not_required'
                           check (ledger_status in ('not_required', 'pending', 'posted', 'failed')),
  ledger_posting_id      text,
  ledger_error           text,
  payout_id              uuid,
  note                   text,
  created_by             text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  version                int not null default 1,
  unique (tenant_id, business_key),
  -- Σ refunds (succeeded + in flight) can never exceed what was collected (PAY-I03).
  check (refunded_minor + refund_reserved_minor <= amount_minor),
  check ((kind = 'recorded') = (mode = 'recorded'))
);
select core.enable_tenant_isolation('payments.payments');
create index payments_ref_idx on payments.payments (tenant_id, ref_type, ref_id);
create index payments_status_idx on payments.payments (tenant_id, property_id, status);
create index payments_ledger_idx on payments.payments (tenant_id, ledger_status) where ledger_status in ('pending', 'failed');

create table payments.refunds (
  id                 uuid primary key,
  tenant_id          uuid not null,
  property_id        uuid not null,
  payment_id         uuid not null references payments.payments(id),
  account_id         uuid references payments.accounts(id),
  business_key       text not null,
  currency           char(3) not null,
  amount_minor       bigint not null check (amount_minor > 0),
  reason             text not null,
  status             text not null check (status in ('processing', 'pending_verification', 'succeeded', 'failed',
                       'recorded_unverified', 'recorded_verified')),
  mode               text not null check (mode in ('live', 'sandbox', 'simulate', 'recorded')),
  provider_ref       text,
  external_reference text,
  failure            jsonb,
  ledger_status      text not null default 'not_required'
                       check (ledger_status in ('not_required', 'pending', 'posted', 'failed')),
  ledger_posting_id  text,
  ledger_error       text,
  created_by         text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            int not null default 1,
  unique (tenant_id, business_key)
);
select core.enable_tenant_isolation('payments.refunds');
create index refunds_payment_idx on payments.refunds (tenant_id, payment_id);

-- Corrections to recorded payments found by reconciliation: never an edit of the original (append-only).
create table payments.payment_adjustments (
  id                uuid primary key,
  tenant_id         uuid not null,
  property_id       uuid not null,
  payment_id        uuid not null references payments.payments(id),
  business_key      text not null,
  currency          char(3) not null,
  amount_minor      bigint not null check (amount_minor <> 0),   -- signed: negative reduces the recorded amount
  reason            text not null,
  exception_id      uuid,
  ledger_posting_id text not null,
  created_by        text not null,
  created_at        timestamptz not null default now(),
  unique (tenant_id, business_key)
);
select core.enable_tenant_isolation('payments.payment_adjustments');

---------------------------------------------------------------------------------------------------------
-- Provider-operation journal (ADR-0007): intent persisted BEFORE the call; outcome after.
---------------------------------------------------------------------------------------------------------
create table payments.provider_operations (
  id               uuid primary key,
  tenant_id        uuid not null,
  property_id      uuid not null,
  account_id       uuid not null references payments.accounts(id),
  kind             text not null check (kind in ('authorize', 'increment', 'capture', 'void', 'charge', 'refund')),
  target_type      text not null check (target_type in ('authorization', 'payment', 'refund')),
  target_id        uuid not null,
  authorization_id uuid,
  currency         char(3) not null,
  amount_minor     bigint not null check (amount_minor >= 0),
  idempotency_key  text not null,                 -- forwarded to the provider on the (single) send
  mode             text not null check (mode in ('live', 'sandbox', 'simulate')),
  status           text not null default 'pending'
                     check (status in ('pending', 'sent', 'succeeded', 'failed', 'pending_verification')),
  attempts         int not null default 0,
  provider_ref     text,
  outcome          jsonb,
  failure_code     text,
  failure_message  text,
  sent_at          timestamptz,
  completed_at     timestamptz,
  next_check_at    timestamptz,
  check_count      int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          int not null default 1,
  unique (tenant_id, idempotency_key)
);
select core.enable_tenant_isolation('payments.provider_operations');
create index provider_operations_unresolved_idx on payments.provider_operations (tenant_id, next_check_at)
  where status in ('sent', 'pending_verification');
create index provider_operations_target_idx on payments.provider_operations (tenant_id, target_type, target_id);
create index provider_operations_ref_idx on payments.provider_operations (tenant_id, provider_ref);

create table payments.operation_journal (
  id           uuid primary key,
  tenant_id    uuid not null,
  operation_id uuid not null references payments.provider_operations(id),
  attempt      int not null,
  phase        text not null check (phase in ('intent', 'outcome', 'lookup', 'webhook', 'short_circuit')),
  status       text not null,
  detail       jsonb not null default '{}',
  recorded_at  timestamptz not null
);
select core.enable_tenant_isolation('payments.operation_journal');
create index operation_journal_op_idx on payments.operation_journal (tenant_id, operation_id, recorded_at);

---------------------------------------------------------------------------------------------------------
-- Webhooks: deduplicated by provider event id; stored (no card data) for audit.
---------------------------------------------------------------------------------------------------------
create table payments.webhook_events (
  id                uuid primary key,
  tenant_id         uuid not null,
  account_id        uuid not null references payments.accounts(id),
  provider          text not null,
  provider_event_id text not null,
  event_type        text not null,
  object_kind       text not null,
  object_ref        text,
  livemode          boolean not null,
  payload           jsonb not null,
  received_at       timestamptz not null,
  outcome           text not null check (outcome in ('applied', 'no_change', 'stale', 'unknown_type', 'no_match')),
  outcome_detail    text,
  unique (tenant_id, provider, provider_event_id)
);
select core.enable_tenant_isolation('payments.webhook_events');

---------------------------------------------------------------------------------------------------------
-- Disputes, payouts, settlement statements.
---------------------------------------------------------------------------------------------------------
create table payments.disputes (
  id                  uuid primary key,
  tenant_id           uuid not null,
  property_id         uuid not null,
  payment_id          uuid not null references payments.payments(id),
  account_id          uuid not null references payments.accounts(id),
  provider_dispute_id text not null,
  currency            char(3) not null,
  amount_minor        bigint not null check (amount_minor > 0),
  reason              text not null,
  status              text not null check (status in ('opened', 'evidence_required', 'evidence_submitted', 'won',
                        'lost', 'accepted')),
  evidence_due_at     timestamptz,
  evidence            jsonb not null default '[]',
  funds_withdrawn     boolean not null default false,
  ledger_movements    jsonb not null default '[]',
  opened_at           timestamptz not null,
  closed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             int not null default 1,
  unique (tenant_id, account_id, provider_dispute_id)
);
select core.enable_tenant_isolation('payments.disputes');

create table payments.payouts (
  id                 uuid primary key,
  tenant_id          uuid not null,
  account_id         uuid not null references payments.accounts(id),
  legal_entity_id    uuid not null,
  provider_payout_id text not null,
  currency           char(3) not null,
  gross_minor        bigint,
  fees_minor         bigint check (fees_minor is null or fees_minor >= 0),
  net_minor          bigint not null,
  arrival_date       date,
  status             text not null check (status in ('in_transit', 'paid', 'failed')),
  failure_reason     text,
  source             text not null check (source in ('webhook', 'statement', 'manual')),
  ledger_status      text not null default 'not_required'
                       check (ledger_status in ('not_required', 'pending', 'posted', 'failed')),
  ledger_ref         text,
  ledger_error       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            int not null default 1,
  unique (tenant_id, account_id, provider_payout_id),
  check (gross_minor is null or fees_minor is null or gross_minor - fees_minor = net_minor)
);
select core.enable_tenant_isolation('payments.payouts');

create table payments.payout_items (
  id          uuid primary key,
  tenant_id   uuid not null,
  payout_id   uuid not null references payments.payouts(id),
  kind        text not null check (kind in ('payment', 'refund', 'fee', 'dispute', 'adjustment')),
  payment_id  uuid references payments.payments(id),
  refund_id   uuid references payments.refunds(id),
  amount_minor bigint not null,
  created_at  timestamptz not null default now(),
  unique (payout_id, payment_id),
  unique (payout_id, refund_id)
);
select core.enable_tenant_isolation('payments.payout_items');

create table payments.statements (
  id               uuid primary key,
  tenant_id        uuid not null,
  property_id      uuid not null,
  account_id       uuid references payments.accounts(id),
  source           text not null check (source in ('terminal_batch', 'acquirer_settlement', 'bank_statement',
                     'cash_deposit')),
  file_name        text not null,
  file_sha256      text not null,
  period_from      date not null,
  period_to        date not null,
  line_count       int not null,
  matched_count    int not null,
  exception_count  int not null,
  imported_by      text not null,
  imported_at      timestamptz not null,
  unique (tenant_id, file_sha256)
);
select core.enable_tenant_isolation('payments.statements');

create table payments.statement_lines (
  id                 uuid primary key,
  tenant_id          uuid not null,
  statement_id       uuid not null references payments.statements(id),
  line_no            int not null,
  occurred_on        date not null,
  currency           char(3) not null,
  amount_minor       bigint not null,               -- negative for refunds/reversals
  reference          text,
  approval_code      text,
  card_last4         char(4) check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  description        text,
  match_status       text not null check (match_status in ('matched', 'unmatched', 'amount_mismatch', 'duplicate',
                       'ambiguous')),
  match_basis        text,
  matched_payment_id uuid references payments.payments(id),
  matched_refund_id  uuid references payments.refunds(id),
  unique (statement_id, line_no)
);
select core.enable_tenant_isolation('payments.statement_lines');

---------------------------------------------------------------------------------------------------------
-- Payment exceptions: every mismatch has an owner and a next step.
---------------------------------------------------------------------------------------------------------
create table payments.exceptions (
  id                uuid primary key,
  tenant_id         uuid not null,
  property_id       uuid,
  kind              text not null,
  severity          text not null check (severity in ('urgent', 'routine')),
  problem           text not null,
  business_impact   text not null,
  next_step         text not null,
  owner_role        text not null,
  responsible_party text not null check (responsible_party in ('hotel', 'monoclay', 'provider')),
  assignee_user_id  uuid,
  ref_type          text,
  ref_id            uuid,
  dedupe_key        text not null,
  status            text not null default 'open' check (status in ('open', 'resolved')),
  resolution        text,
  resolved_by       text,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           int not null default 1,
  unique (tenant_id, dedupe_key)
);
select core.enable_tenant_isolation('payments.exceptions');
create index exceptions_open_idx on payments.exceptions (tenant_id, property_id, status);

---------------------------------------------------------------------------------------------------------
-- Simulator state ("the provider's side" for demo/trial/training and tests). Never used in live mode.
---------------------------------------------------------------------------------------------------------
create table payments.simulator_objects (
  tenant_id       uuid not null,
  account_id      uuid not null references payments.accounts(id),
  idempotency_key text not null,
  object_id       text not null,
  kind            text not null,
  status          text not null,
  currency        char(3) not null,
  amount_minor    bigint not null,
  data            jsonb not null default '{}',
  created_at      timestamptz not null,
  updated_at      timestamptz not null,
  primary key (tenant_id, account_id, idempotency_key),
  unique (tenant_id, object_id)
);
select core.enable_tenant_isolation('payments.simulator_objects');

create table payments.simulator_webhooks (
  id          uuid primary key,
  tenant_id   uuid not null,
  account_id  uuid not null references payments.accounts(id),
  seq         bigint generated always as identity,
  event_id    text not null,
  payload     jsonb not null,
  delivered   boolean not null default false,
  created_at  timestamptz not null
);
select core.enable_tenant_isolation('payments.simulator_webhooks');

create trigger touch before update on payments.accounts for each row execute function core.touch_updated_at();
create trigger touch before update on payments.payment_methods for each row execute function core.touch_updated_at();
create trigger touch before update on payments.authorizations for each row execute function core.touch_updated_at();
create trigger touch before update on payments.payments for each row execute function core.touch_updated_at();
create trigger touch before update on payments.refunds for each row execute function core.touch_updated_at();
create trigger touch before update on payments.provider_operations for each row execute function core.touch_updated_at();
create trigger touch before update on payments.payment_requests for each row execute function core.touch_updated_at();
create trigger touch before update on payments.virtual_cards for each row execute function core.touch_updated_at();
create trigger touch before update on payments.disputes for each row execute function core.touch_updated_at();
create trigger touch before update on payments.payouts for each row execute function core.touch_updated_at();
create trigger touch before update on payments.exceptions for each row execute function core.touch_updated_at();

select core.apply_standard_grants('payments');
select core.make_append_only('payments.operation_journal');
select core.make_append_only('payments.payment_adjustments');
select core.make_append_only('payments.payout_items');
select core.make_append_only('payments.statements');

---------------------------------------------------------------------------------------------------------
-- Webhook routing directory. Provider webhooks arrive before any tenant context exists; this directory holds
-- only routing metadata (provider + external account id → tenant + account) and is read solely through the
-- SECURITY DEFINER function below. Not granted to the app role.
---------------------------------------------------------------------------------------------------------
create table payments.account_directory (
  account_id          uuid primary key,
  tenant_id           uuid not null,
  provider            text not null,
  external_account_id text
);
create index account_directory_route_idx on payments.account_directory (provider, external_account_id);
revoke all on payments.account_directory from portico_app;

create or replace function payments.sync_account_directory() returns trigger
  language plpgsql security definer set search_path = payments, pg_temp as $$
begin
  insert into payments.account_directory (account_id, tenant_id, provider, external_account_id)
    values (new.id, new.tenant_id, new.provider, new.external_account_id)
    on conflict (account_id) do update set provider = excluded.provider,
      external_account_id = excluded.external_account_id;
  return new;
end $$;
create trigger sync_directory after insert or update on payments.accounts
  for each row execute function payments.sync_account_directory();

-- Routes a verified webhook to (tenant, account, environment). Live-mode events only reach live organizations;
-- test-mode events only reach sandbox organizations; simulator events only reach non-live organizations.
create or replace function payments.route_webhook(p_provider text, p_external_account_id text, p_livemode boolean)
  returns table (tenant_id uuid, account_id uuid, environment text)
  language sql stable security definer set search_path = payments, pg_temp as $$
    select d.tenant_id, d.account_id, e.env
      from payments.account_directory d
      cross join lateral (select platform.tenant_environment(d.tenant_id) as env) e
     where d.provider = p_provider
       and d.external_account_id = p_external_account_id
       and e.env is not null
       and case
             when p_provider = 'simulator' then e.env <> 'live'
             when p_livemode then e.env = 'live'
             else e.env = 'sandbox'
           end
$$;
revoke execute on function payments.route_webhook(text, text, boolean), payments.sync_account_directory() from public;
grant execute on function payments.route_webhook(text, text, boolean) to portico_app;
