# ADR-0008: Double-entry ledger as the financial source of truth

**Status:** Accepted · **Date:** 2026-11-07

## Context

Folios, deposits, receivables, payments and exports must reconcile; posted records must be immutable with traceable corrections (brief §9–10).

## Decision

`finance` keeps a double-entry journal per legal entity (balanced entries, append-only). Folios, balances, AR aging and reports are projections. Deposits are liabilities until applied; authorizations never touch the ledger; payouts move money between clearing and bank accounts and never create revenue. Corrections are reversing/adjusting entries linked to the original.

## Consequences

Reconciliation by construction; slightly more modeling than a simple charges table.
