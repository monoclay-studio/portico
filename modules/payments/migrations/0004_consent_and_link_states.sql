-- Integration-step re-review #4 (R4-P2-1, R4-P2-2, R4-P3-4; ADR-0015 Amendment 3).
--
-- * `no_show` is a charge purpose (no-show and cancellation fees), matching the mandate purpose.
-- * A payment link can answer "already paid" when Portico asks the provider to stop it (`completed`): the replacement
--   waits until that payment is recorded. `link_status_at` dates every link-status change, so a link the provider
--   never confirms as stopped is raised to an owner after a deadline (and retried oldest first).
alter table payments.payments drop constraint if exists payments_purpose_check;
alter table payments.payments
  add constraint payments_purpose_check
    check (purpose in ('deposit', 'balance', 'incidentals', 'no_show', 'custom'));
alter table payments.payment_requests drop constraint if exists payment_requests_link_status_check;
alter table payments.payment_requests
  add constraint payment_requests_link_status_check
    check (link_status in ('pending', 'created', 'failed', 'unknown', 'deactivating', 'completed', 'deactivated'));
alter table payments.payment_requests add column link_status_at timestamptz;
create index payment_requests_retiring_idx on payments.payment_requests (tenant_id, link_status_at)
  where link_status in ('deactivating', 'completed');
