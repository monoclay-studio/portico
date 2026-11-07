-- Events carry the version of the aggregate they describe, so consumers can ignore stale/out-of-order deliveries
-- (e.g. a late `checkedIn` arriving after `checkedOut`). Null for events whose aggregate is not versioned.
alter table core.outbox add column aggregate_version int;
