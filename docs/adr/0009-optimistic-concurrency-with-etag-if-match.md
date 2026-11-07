# ADR-0009: Optimistic concurrency with ETag / If-Match

**Status:** Accepted · **Date:** 2026-11-07

## Context

Two users editing the same reservation must not silently overwrite each other (scenario 14).

## Decision

Mutable aggregates carry `version`. GET returns `ETag: W/"<version>"`; PATCH/PUT require `If-Match`; conditional updates check `version`; mismatch → 409 `version_conflict` with the current version so the UI can show both changes and let the user re-apply.

## Consequences

No lost updates; no long-held locks; UX must implement the conflict screen.
