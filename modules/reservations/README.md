# @portico/reservations

## Checkpoint

- **Done:** migration (15 tables, RLS, append-only history), ports per domain map (+ AccessPort key lifecycle),
  pure domain (status machines, segment planner, terms/penalties in property time zone, readiness, workflows,
  channel diff, allowed actions), services (bookings, previews/commit with stale recovery, check-in/out workflows,
  front desk, handover, relocation, channel ingestion, data authority forwarding, universal record contract,
  search provider, demo seed), HTTP routes, composition wiring. 133 module tests green (unit + integration +
  scenarios S01/S02/S03/S04/S14 + interrupted check-in + HTTP).
- **In progress:** apps/api reservations test; README (full), FOUNDATION_REQUESTS.md.
- **Next steps:** run `pnpm lint && pnpm typecheck && pnpm --filter @portico/api test`; write full README sections
  (capabilities, invariants→tests, contract changes, gaps, owner questions); re-check spec.
- **Known failing tests:** none.
