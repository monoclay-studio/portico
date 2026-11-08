-- Integration-step re-review #5 (ADR-0015 Amendment 4: consent inputs are facts).
--
-- * `cardholder_ref`: who the card was saved for when it was saved (`<owner_type>:<owner_id>`). A guest-profile merge
--   rewrites `owner_id`; the cardholder identity a guest acting for themselves is judged on never changes (R5-P3-2).
-- * `purpose_basis`: the server fact a payment's purpose rests on (for a no-show or cancellation fee, the stay whose
--   penalty reservations recorded), so what that fact still owes is counted (R5-P1-1).
alter table payments.payment_methods add column cardholder_ref text;
update payments.payment_methods
   set cardholder_ref = case when owner_type = 'guest_profile' and merged_from_owner_id is not null
                             then 'guest_profile:' || merged_from_owner_id
                             else owner_type || ':' || owner_id end;
alter table payments.payment_methods alter column cardholder_ref set not null;
alter table payments.payments add column purpose_basis text;
create index payments_purpose_basis_idx on payments.payments (tenant_id, purpose_basis)
  where purpose_basis is not null;
