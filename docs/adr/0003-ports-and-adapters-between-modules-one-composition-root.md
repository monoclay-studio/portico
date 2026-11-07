# ADR-0003: Ports and adapters between modules; one composition root

**Status:** Accepted · **Date:** 2026-11-07

## Context

Modules must be built in parallel by different agents/teams and evolve independently.

## Decision

A module declares what it needs from others as TypeScript interfaces (`src/ports.ts`). `apps/api/src/composition.ts` binds ports to provider services. Tests bind ports to fakes. Contracts between modules are documented in `docs/architecture/domain-map.md` and changed there first.

## Consequences

Parallel development and testability; no hidden coupling. Slight boilerplate in the composition root.
