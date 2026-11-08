-- Integration-step re-review #5 (ADR-0015 Amendment 4, R5-P1-1): the cancellation penalty recorded on the stay it
-- applies to (as `no_show` records the no-show penalty), so a fee charged to a card rests on that recorded fact.
alter table reservations.stays add column cancellation jsonb;
