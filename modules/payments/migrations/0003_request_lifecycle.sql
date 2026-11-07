-- Integration-step re-review #3 (R3-P1-1, R3-P2-1; ADR-0015 Amendment 2).
--
-- * A payment link is externally writable: it can be paid at the provider until the provider confirms it is
--   deactivated. A request Portico replaces, closes or cancels keeps its link reference with `link_status`
--   `deactivating` until the provider confirms (`deactivated`); a replacement link is created only after that.
-- * `family_booking_id`: the booking a request's reference belongs to (the booking itself, one of its stays, or a
--   folio of one of them), so the double-collection guard treats a booking and its folios as one family.
alter table payments.payment_requests drop constraint if exists payment_requests_link_status_check;
alter table payments.payment_requests
  add constraint payment_requests_link_status_check
    check (link_status in ('pending', 'created', 'failed', 'unknown', 'deactivating', 'deactivated'));
alter table payments.payment_requests add column family_booking_id uuid;
create index payment_requests_family_idx on payments.payment_requests (tenant_id, family_booking_id)
  where family_booking_id is not null;
