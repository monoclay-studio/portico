# @portico/integration — connector framework (wave 1)

## Checkpoint

- **Done:** migration (`integration` schema), connector SDK + catalogue (pms.simulator, file.csv, webhooks.outbound,
  planned entries), domain logic with unit tests (journey, mapping suggestions, ordering, outbound policy, health,
  webhooks, CSV, impact), services (connections + 9-step journey, credentials via SecretStore, mappings, exchange
  pipeline, outbound queue with no-blind-replay, health, exceptions, lifecycle previews/actions, webhooks, jobs,
  simulators), universal record contract views, search provider, HTTP routes; integration tests: setup journey,
  S02 inbound faults, S20 outage/no-blind-replay.
- **In progress:** credentials and environment-safety tests (2 assertion fixes pending), then webhooks,
  isolation/permissions, file.csv tests, composition wiring + API e2e test, README, FOUNDATION_REQUESTS.
- **Known failing tests:** `test/credentials.test.ts` (reminder count expectation), `test/environment-safety.test.ts`
  (applied count expectation: 3 records incl. room status).
