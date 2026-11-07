# ADR-0001: TypeScript modular monolith

**Status:** Accepted · **Date:** 2026-11-07

## Context

We need to ship a broad product quickly with a small team (initially AI-assisted), while planning for large engineering, sales and marketing teams later. Microservices from day one would multiply operational cost and make cross-module transactions (booking = inventory + pricing + folio) hard to get right.

## Decision

One TypeScript codebase (Node 22, strict TS, pnpm workspaces, Turborepo) deployed as one API and one worker. Bounded contexts are packages under `modules/` with their own Postgres schema, public `index.ts`, ports for dependencies and no cross-module table access. Web apps share the Zod contracts.

## Consequences

Single language across API, web and mobile; transactional consistency across modules where business rules demand it; modules can be extracted into services later because boundaries and events already exist. Risk: boundary erosion — mitigated by the composition-root rule, review by the architecture steward, and (later) dependency-cruiser checks in CI.
