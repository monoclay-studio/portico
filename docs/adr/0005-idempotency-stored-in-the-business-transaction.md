# ADR-0005: Idempotency stored in the business transaction

**Status:** Accepted · **Date:** 2026-11-07

## Context

Retries after timeouts must never duplicate bookings, charges, refunds, invoices or journal entries (brief §9, scenarios 5–6).

## Decision

Mutating endpoints require `Idempotency-Key`. `runIdempotent` inserts the key row in the same transaction as the command; concurrent duplicates block on it and replay the stored response; failures roll the key back so a retry executes cleanly; reusing a key with a different body is rejected. Money-moving operations additionally use deterministic business keys enforced by unique constraints (e.g. `room-charge:{stayId}:{night}`).

## Consequences

Exactly-once database effects for retried HTTP commands; simple client contract.
