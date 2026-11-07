-- Integration-step re-review (R2-P2-1, ADR-0015 Amendment 1) and fix sweep (SW-PAY-4): a saved card's facts are
-- server facts, never client claims.
--
-- * `entry_channel` is now DERIVED by the server: `hosted_entry` only when the guest saved the card themselves
--   (guest actor, self-service), `vault` for channel virtual cards, `staff_entry` for a card staff saved, `import`
--   for migrated tokens. The channel the client declared is kept for information only (`declared_entry_channel`).
-- * Whether the guest is present (customer-initiated) is no longer inferred from how or when a card was saved: only a
--   guest acting for themselves is customer-initiated; every use by staff is merchant-initiated and needs the
--   cardholder's recorded mandate (collect.ts `deriveInitiator`).
-- * `merged_from_owner_id`: when guest profiles are merged, cards follow the surviving profile; the original owner
--   is kept so an unmerge gives the card back.
alter table payments.payment_methods drop constraint if exists payment_methods_entry_channel_check;
alter table payments.payment_methods
  add constraint payment_methods_entry_channel_check
    check (entry_channel in ('hosted_entry', 'terminal', 'vault', 'import', 'staff_entry'));
alter table payments.payment_methods
  add column declared_entry_channel text,
  add column merged_from_owner_id uuid;
create index payment_methods_merged_from_idx on payments.payment_methods (tenant_id, merged_from_owner_id)
  where merged_from_owner_id is not null;
