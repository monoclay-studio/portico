# ADR-0006: Money and time representation

**Status:** Accepted · **Date:** 2026-11-07

## Context

Hotel finance mixes currencies, taxes and several kinds of dates; floating point and implicit time zones cause silent errors.

## Decision

Money is `{ amountMinor: integer, currency }` (ISO-4217 exponents). Tax/proration math uses `decimal.js` and rounds once per documented rule; allocation uses largest-remainder. Dates are `LocalDate` strings; stays are half-open night ranges; Postgres DATE is parsed as a string; every financial record distinguishes business date, service/stay date, revenue date and `occurred_at` timestamp. FX conversions require explicit rates and record them.

## Consequences

Exact, auditable arithmetic. Developers must use kernel helpers, never `number` math on major units.
