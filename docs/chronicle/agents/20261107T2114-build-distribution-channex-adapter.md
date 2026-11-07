# Agent run: Build distribution + Channex adapter

- Started: 2026-11-07T21:14:50.867Z · last activity: 2026-11-07T22:27:58.523Z
- Turns: 252 · tool uses: 260 · output tokens: 459,482
- Type: general-purpose

## Brief (2026-11-07T21:14:50.867Z)

````text
You are the module owner for **distribution** in Portico, a cloud hospitality management platform: a TypeScript modular monolith at /home/user/portico. Your mandate (docs/orchestration/operating-model.md) is to make this module 3x–10x better than anything on the market: measured, not claimed.

The owner's direction: make Portico **Channex-ready**. Their requirements, verbatim:
- "ARI Engine: Your PMS must actively track and batch availability, rate, and restriction (ARI) changes (no heavy database polling loops)."
- "Outbox & Queue: A stable queue system that batches updates into Channex API calls while respecting their 20 ARI/minute rate limits."
- "Webhook Endpoint: A live endpoint in your PMS configured to receive, parse, and durably save booking delivery revisions."
- "Acknowledge Flow: A functioning mechanism that sends back booking confirmations/acknowledgments to Channex once received."

Read first:
- CLAUDE.md, especially the non-negotiable rules 1–17;
- docs/orchestration/module-agent-playbook.md;
- docs/quality/playbooks/module-builder-self-check.md (the latest version, v4). It is mandatory: § 5 invariant closure, and a test per sibling entry point;
- docs/specs/distribution.md, the full spec. It includes a Channex readiness note at § 3.2;
- docs/strategy/modules/distribution.md, your 10x brief;
- docs/parity/ for any distribution rows;
- docs/architecture/domain-map.md;
- docs/research/04-connectivity-payments-compliance.md (the channel-manager sections) and docs/research/05-digest.md (distribution items);
- ADRs 0003, 0004, 0010, 0014 and 0015.

Your worktree is /home/user/wt/distribution, on branch feat/distribution-channex, created from main. Create modules/distribution as a new module with its own `distribution` schema, following the pattern of the existing modules. Wire it in apps/api/src/composition.ts and apps/worker. Commit locally after each meaningful step, with Conventional Commits. Never push, and never amend, reset or rebase a pushed checkpoint commit. Postgres is at postgres://postgres@127.0.0.1:5432/postgres; use PORTICO_TEST_DB_PREFIX=w2_dist.

Build, simulator-first (roadmap principle: every external effect simulator-first):
1. **ARI engine.**
   - Consume `inventory.availability.changed`, `rates.prices.changed` and `rates.restrictions.changed` events via the outbox. NO polling loops.
   - Coalesce deltas per (connection, channel room, channel rate, date range); merge overlapping and adjacent ranges.
   - Run a full resync on connect, nightly over 400 days, and on demand. It must be non-destructive.
   - Keep last-acknowledged channel state per cell (DST-R06), and detect discrepancies.
   - Prices come from rates and availability from inventory. Never compute them here.
2. **Outbox queue and rate limiting.**
   - A per-connection token bucket, default 20 ARI requests per minute (configuration per connection).
   - While waiting for budget, keep merging so a burst becomes a few large calls.
   - Idempotent message ids, and acceptance recorded per message.
   - Rejection classification: a payload error means no retry, plus an exception with a plain-language fix. A transient error means backoff 5 s → 10 s → 20 s → 40 s, then every 1 min for at least 30 min, then an urgent exception.
   - Stop-sell protection (DST-R07).
   - No publication when an external system is authoritative for `availability` (DST-I05, data authority).
   - Environment safety: non-live environments go to the simulator or Channex staging only, through `assertExternalEffectAllowed`.
3. **Booking-revision webhook.**
   - A public endpoint for Channex booking-revision notifications.
   - Authenticate by a verified secret or signature. If Channex's actual mechanism is unconfirmed in our research, say so and make it pluggable.
   - Parse and durably store each revision immutably, keyed by (connection, channel booking id, revision).
   - Per-property ordered processing.
   - Out-of-order handling: park orphans, re-process, and raise an urgent exception after 15 min (DST-R09).
   - A recovery pull of revisions not acknowledged, in case a webhook is missed.
   - Duplicates are acknowledged and logged, never applied twice.
4. **Acknowledgement flow.** Acknowledge back to Channex ONLY after `reservations.ingestChannelBooking` (or the existing reservations channel-ingestion entry point; check its contract) has committed (DST-I02). Retry the ack until it is accepted. Never ack a revision that failed to apply; it goes to an exception with a recovery path.
5. **Channex adapter behind a port, plus an exact Channex API simulator.**
   - Use the existing integration module's connector framework where it fits: connections, secrets, safeFetch, exchange log, inbound handlers (`ports.inbound`).
   - Fault injection in the simulator: 429 rate limiting, 5xx, timeouts, duplicate and out-of-order deliveries, revisions for unknown bookings, partial acceptance.
   - Encode only Channex API facts that are verifiable. Where our research doesn't confirm an endpoint or field shape, mark the adapter field `unverified` in code comments and the README, and keep it in one mapping file.
   - Do NOT call the real Channex. Staging tests (R4) need the owner's staging key, so stop at R3 and say exactly what the staging run would check.
6. **Mappings, health and records.**
   - Product mapping between unit types and rate plans and channel codes.
   - A distribution health record: last successful push, oldest unacknowledged message, queue depth, budget use.
   - The universal record contract (status, allowedActions, issues, owner, links), the search provider, permissions in the manifest, role templates (revenue manager, reservations) and a demo seed with a simulated Channex connection.
7. **Proof.**
   - Implement scenario S02 (channel ingestion) and S20 parts that are now possible, following docs/scenarios/README.md and docs/quality/playbooks/scenario-tests.md (latest).
   - Prove the rate limit holds under bursts, ARI coalescing, ordering, exactly-once ingestion and ack-after-commit with concurrency tests.
   - A parity file docs/parity/distribution.md, with every `tested` row quoting its asserting test.

Before reporting, the gates on a tree merged with main:
`pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2`
Check exit codes.

Reply with:
- what is built, by owner requirement 1–4;
- the self-check tables, including § 5 invariant closure with each test shown failing without its fix;
- what is unverified about Channex's API;
- exactly what the staging test (R4) will check once the owner provides a Channex staging key.

A steward review will follow.
````

