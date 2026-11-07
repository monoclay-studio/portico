# ADR-0014: Data authority (system of record) per data domain

**Status:** Accepted · **Date:** 2026-11-07

## Context

Adoption brief §2: hotels may keep their current PMS or other systems; competing systems must not independently modify the same information.

## Decision

`platform.data_authority` records, per property and domain, whether Portico or an external connection is authoritative and the write mode (`exclusive`, `forward`, `read_only`). Services call `platform.assertWritable` before writes. Forwarded changes become effective only when the external system acknowledges. Authority changes are audited and emitted as events.

## Consequences

Enables connect-alongside and replace-a-module adoption without split-brain data.
