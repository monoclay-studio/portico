# ADR-0007: Payments: hotel is merchant; provider-agnostic; provider-operation journal

**Status:** Accepted · **Date:** 2026-11-07

## Context

Owner decision D2 + readiness brief §7–8: the hotel's legal entity is merchant of record; Monoclay must not hold guest funds; Stripe availability for Maldivian entities is unverified (Q2).

## Decision

A provider-agnostic payment domain (payment accounts per legal entity, tokenized methods, authorizations, captures, refunds, disputes, payouts) with adapters: a full simulator (default; demo/trial/training), Stripe Connect **direct charges** on the hotel's connected account, and later Adyen / local acquirers / bring-your-own. Every provider call is journaled (intent → call with idempotency key → outcome). Unknown outcomes are `pending_verification` and resolved by reconciliation (provider lookup + webhooks), never guessed. The ledger is only updated on provider-confirmed outcomes.

## Consequences

Monoclay stays a technology platform; hotels can bring their own processor; scenarios 5 and 6 are structurally handled. PCI: hosted fields only; OTA virtual cards via a PCI vault/proxy (to be selected).
