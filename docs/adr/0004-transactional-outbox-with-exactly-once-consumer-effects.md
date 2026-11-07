# ADR-0004: Transactional outbox with exactly-once consumer effects

**Status:** Accepted · **Date:** 2026-11-07

## Context

Other modules and external systems must react to changes (checkout → dirty room; rate change → channel push) without losing or duplicating reactions, even across crashes.

## Decision

Events are inserted into `core.outbox` in the same transaction as the state change. The worker fans out to per-consumer delivery rows and processes them with leases (SKIP LOCKED); each consumer's handler runs in a tenant transaction that also marks its delivery done. Failures retry with exponential backoff and become `dead` after a limit, visible for operators.

## Consequences

No dual-write problem; at-least-once delivery with exactly-once database effects. External side effects in consumers must still be idempotent (provider idempotency keys).
