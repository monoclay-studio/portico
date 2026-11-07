# ADR-0010: Environment safety for external effects

**Status:** Accepted · **Date:** 2026-11-07

## Context

Demo, trial and training must never charge cards, message guests, publish availability, write to a hotel's systems, issue keys or submit to governments (readiness brief §16, adoption brief §3).

## Decision

Organizations have an environment (`live`, `trial`, `sandbox`, `training`, `demo`). A central policy maps (environment × effect) → `live | sandbox | simulate | blocked`. Every adapter calls `assertExternalEffectAllowed(ctx, effect)` and uses the simulator or sandbox when told to. Results carry provenance so the UI labels them.

## Consequences

One reviewed policy instead of scattered flags; easy to audit.
