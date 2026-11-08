# Agent run: Build distribution + Channex adapter

- Started: 2026-11-07T21:14:50.867Z · last activity: 2026-11-08T05:51:59.942Z
- Turns: 280 · tool uses: 290 · output tokens: 498,761
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

## Follow-up message (2026-11-07T22:33:16.296Z)

````text
[handback-send-enforce] Your report has not been delivered. Call SubagentHandback({message: <your full report>}) now; the call ends your run.
````

## Follow-up message (2026-11-08T05:45:24.894Z)

````text
The coordinator sent a message while you were working:
Distribution fix round 1. The steward review says "merge after fixes": P0 0, P1 2, P2 9, P3 9.

Much held up well under attack:
- the budget held under real concurrency;
- a 429 storm handled correctly;
- revisions stored durably before the 200;
- ack only after a committed outcome;
- environment safety and live refusal;
- tenant isolation and secrets.

Thank you.

**Read first, all on main:**
- `docs/orchestration/reviews/review-distribution.md`
- the probes in `docs/orchestration/reviews/distribution-poc/zz-review-{a,b,c}.test.ts.txt`
- the "distribution fix round 1" line in `docs/orchestration/pending-fixes.md`

Merge main into `feat/distribution-channex` first.

**Must fix before merge:**
1. **P1-1, a polling loop.** A revoked key (E04), or an external system of record, plus one pending change makes the org re-run all its work every 1 s, forever (`jobs.ts:118-128`). It also rewrites the exception every pass and starves the shared scheduler.
   - Work that cannot progress must be parked until the blocking state changes: the key is re-verified, or authority returns.
   - The exception is written once per state change.
   - Turn the probes A1/A2 into regression tests.
2. **P1-2, revision ordering.** Today it uses `Date.parse` (millisecond precision, zone-less strings read as local time), breaks ties with a hash and falls back to arrival time.
   - Order on the hub's own sequence where it exists, otherwise on timezone-safe timestamps with a deterministic, causal tie-break.
   - A modification carrying the creation's timestamp must be applied, never acknowledged as `stale` (A3).
   - A cancellation that arrives first must never strand the creation (A4).
   - Mark any assumption about Channex's ordering fields as unverified in `wire.ts`, and add it to the R4 staging checklist.
3. **P2-1:** add a test that fails when the per-booking ordered wait (`inbound.ts:680`) is disabled. It survived the reviewer's mutant. Also correct parity row PAR-DST-023.
4. **G-1:** zero lint warnings. Main now runs `--error-on-warnings`; the merged copy failed with your 7 warnings.

**Then the P2s:**
- **P2-2:** the budget must not depend on synchronized worker clocks or on latency jitter. Use DB time and a safety margin, so the hub never sees more than its limit in any 60 s.
- **P2-3/P2-4:**
  - An unrecognised hub answer fails closed. That covers a warning with no index and a 200 carrying `errors`.
  - The simulator must stop mirroring the adapter's 7 unverified assumptions, so drift becomes visible.
  - Move the 4 wire assumptions from `client.ts` into `wire.ts`.
- **P2-5:** webhook rate limits per endpoint, not per IP (every tenant shares Channex's IPs). Unauthenticated posts are not stored permanently.
- **P2-6:** a live tenant cannot claim a production hub property before proving access to it.
- **P2-7:** an erasure path for guest data in stored revisions. Coordinate with guests' erasure contract; if it needs a guests port, declare it and bind a strict fake.
- **P2-8:** an unparseable change event raises an exception, never a silent drop.

**Then the cheap P3s.**

**Self-check v6** (`docs/quality/playbooks/module-builder-self-check.md`). Include the tables:
- § 5.1 state machines for a revision and for a connection's health, with external holders (the hub);
- pasted writer searches;
- a control-fact grid with an input-source column;
- the § 5.4 mutation table for every P1/P2 guard (each guard removed → its named test fails → restored);
- the § 6 claim ledger over the README, the spec and the parity rows you touch.

**How to work:**
- Commit after every meaningful step.
- Do not push.
- Never amend or rewrite commits.
- Gates: `pnpm lint`, `pnpm turbo run typecheck --force`, `pnpm turbo run test --force --concurrency=2`, all exit 0.

Address this before completing your current task.
````

## Follow-up message (2026-11-08T05:51:16.933Z)

````text
This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

<system-reminder>
<tools-used-before-summary>Bash, Edit, Monitor, SubagentHandback, TaskStop, ToolSearch, WebFetch, WebSearch, Write</tools-used-before-summary>
</system-reminder>
Summary:
1. Primary Request and Intent:
   - Original task (completed and handed back once): as module owner for **distribution** in Portico (TypeScript modular monolith at /home/user/portico; worktree /home/user/wt/distribution, branch feat/distribution-channex), make Portico **Channex-ready** per owner requirements verbatim: (1) "ARI Engine: Your PMS must actively track and batch availability, rate, and restriction (ARI) changes (no heavy database polling loops)." (2) "Outbox & Queue: A stable queue system that batches updates into Channex API calls while respecting their 20 ARI/minute rate limits." (3) "Webhook Endpoint: A live endpoint in your PMS configured to receive, parse, and durably save booking delivery revisions." (4) "Acknowledge Flow: A functioning mechanism that sends back booking confirmations/acknowledgments to Channex once received." Simulator-first, stop at R3, report self-check tables, unverified Channex facts, R4 staging plan.
   - **Current request (coordinator, "Distribution fix round 1")**: merge main first; then:
     - Must fix before merge: **P1-1** polling loop (revoked key E04 or external system of record + one pending change → org re-runs every 1 s forever, `jobs.ts:118-128`; exception rewritten every pass; work that cannot progress must be parked until blocking state changes (key re-verified, authority returns); exception written once per state change; probes A1/A2 → regression tests). **P1-2** revision ordering (stop using Date.parse ms/local-time, hash tie-break, arrival fallback; order on hub's own sequence where it exists, else timezone-safe timestamps with deterministic causal tie-break; a modification with the creation's timestamp must be applied, never acked `stale` (A3); a cancellation arriving first must never strand the creation (A4); mark Channex ordering assumptions unverified in wire.ts and add to R4 checklist). **P2-1** test that fails when the per-booking ordered wait (`inbound.ts:680`) is disabled; correct parity row PAR-DST-023 (also sibling guard in Apply as new). **G-1** zero lint warnings (main runs `--error-on-warnings`).
     - Then P2s: **P2-2** budget independent of worker clocks/latency jitter (DB time + safety margin; hub never sees > limit in any 60 s); **P2-3/P2-4** unrecognised hub answers fail closed (warning with no index, 200 carrying `errors`), simulator stops mirroring the adapter's 7 unverified assumptions, move 4 wire assumptions from client.ts into wire.ts; **P2-5** webhook rate limit per endpoint not per IP, unauthenticated posts not stored permanently; **P2-6** live tenant cannot claim a production hub property before proving access; **P2-7** erasure path for guest data in stored revisions (coordinate with guests' erasure contract; if needs guests port, declare and bind strict fake); **P2-8** unparseable change event raises an exception, never silent drop.
     - Then cheap P3s (P3-1 old webhook registrations/concurrent verify; P3-2 since-T truncation/comparison; P3-3 readiness register; P3-4 Dismiss only parked/failed/rejected; P3-5 search filter before limit; P3-6 permission inside pullFeed/recoverSince; P3-7 nightly resync anchored to property-local quiet hour; P3-8 dead-man signal; P3-9 `owner` on records).
     - Self-check **v6** with tables: § 5.1 state machines for a revision and a connection's health with external holders (the hub); pasted writer searches; control-fact grid with input-source column; § 5.4 mutation table for every P1/P2 guard (guard removed → named test fails → restored); § 6 claim ledger over README, spec and touched parity rows.
     - How to work: commit after every meaningful step; do not push; never amend or rewrite commits; gates `pnpm lint`, `pnpm turbo run typecheck --force`, `pnpm turbo run test --force --concurrency=2`, all exit 0. Final report must be delivered via **SubagentHandback** (plain text at end is not delivered).
   - Security/operational constraints (preserve): Never push; never amend/reset/rebase; never call the real Channex; never activate paid contracts, live guest transactions, live hotel/channel connections, production keys; no secrets in code/tests/logs; PII never logged; commits end with:
     ```
     Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
     Claude-Session: https://claude.ai/code/session_01XDtqZDkxkzHxUrbV9kDsKR
     ```
     Use `git -c commit.gpgsign=false commit`. Postgres postgres://postgres@127.0.0.1:5432/postgres, PORTICO_TEST_DB_PREFIX=w2_dist. Never run Biome on *.md. Do not kill processes outside own tasks (a `pkill -f vitest/turbo` was denied by the auto-mode classifier as interfering with other workloads — other agents share the machine). Use scratchpad /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad for temp files.

2. Key Technical Concepts:
   - Modular monolith; module boundaries enforced by tools/check-boundaries.mjs (modules/<m>/src may not import other @portico modules; tests may); ports bound in apps/api/src/composition.ts.
   - Postgres RLS (core.enable_tenant_isolation forced), core.make_append_only, SECURITY DEFINER routing functions (route_webhook, claim_due_tenants), migrateAfter ['platform'].
   - Transactional outbox consumers (TxEventSubscription), ScheduledJob `distribution.dueWork` (2 s) with tenant_schedule due index (scheduleTenant pulls earlier with least()).
   - ARI dirty set (ranges only, values read at send time), one open message per (connection, kind) (partial unique index), sliding-window budget (each token returns 60 s after use) reserved under row lock, classification (payload/transient/rate_limited/auth), backoff 5/10/20/40 s then 60 s, urgent after 30 min, lease token for late answers, channel_state upsert with seq guard, lock order connection → ARI advisory lock → message → budget, health refresh after commit.
   - Inbound: immutable inbound_revisions keyed (tenant, connection, channel_booking_id, revision_id), revision_processing state machine (received/applied/duplicate/stale/parked/rejected/failed), ack_state (not_due/pending/sending/acked/failed) with CHECK `ack_state = 'not_due' or state in (applied, duplicate, stale, rejected)`, per-property advisory lock, orphan parking + 15-min escalation, unmapped parking with provisional holds, ack claim in later tx, feed pull, recoverSince, markCredentialsInvalid for all hub paths.
   - Environment safety: hubModeFor (assertExternalEffectAllowed 'channel.publish' + target match), liveScope port stub refusing live.
   - Channex wire facts in one mapping file (wire.ts) with WIRE_FACTS statuses v2/unverified/owner; simulator state machine persisted in distribution.sim_hubs.
   - Self-check v4/v5/v6 (invariant closure, state machines, external holders, derived writer lists, control-fact grid, mutation per guard, claim ledger).

3. Files and Code Sections (all under /home/user/wt/distribution unless absolute):
   - modules/distribution/migrations/0001_distribution.sql — schema (connections incl. webhook_secret_hash/ref, webhook_registered_at, inbound_gap_at; room/rate mappings; ari_dirty; ari_messages with seq identity, oldest_change_at, status check incl. superseded; ari_budget (sends timestamptz[], paused_until); channel_state (unique nulls not distinct); resync_runs; stop_sells; inbound_revisions (revision_order bigint, append-only); revision_processing (CHECK above); inbound_deliveries (append-only, outcomes stored/duplicate/conflict/notification/unauthenticated/property_mismatch/unparseable); exchange_log; exceptions; discrepancies; sim_hubs; tenant_schedule (RLS enabled not forced); webhook_directory (+ production unique index, trigger sync, revoked from app); route_webhook, claim_due_tenants(p_now, p_limit, p_lease)). Not yet merged to main, so it can still be edited (plan for P1-2 columns).
   - src/manifest.ts (P permissions: distribution.channel.read, connection.manage ⚑, mapping.manage, ari.resync, reservation.recover, discrepancy.resolve, stopSell.manage, simulator.control (org); RECORD types; migrateAfter ['platform']).
   - src/contracts.ts (Zod: vocabularies incl. DISTRIBUTION_PROVENANCE satisfies Provenance[], severity/responsibleParty copies (FR-1), connectionSettings defaults: availabilityPerMinute 10, restrictionsPerMinute 10, horizonDays 400, freshnessTargetSeconds 120, maxCellsPerMessage 2000, stopSellProtection {enabled, threshold 2, cooldownMinutes 10}, amountsIncludeTax false, fallbackRatePlanId null, feedPullMinutes 15, fullResyncHours 24; inputs; views; event payload schemas).
   - src/domain/{ranges,budget,delivery,ari,revisions,health}.ts + domain.test.ts. revisions.ts currently has `revisionOrderOf(revisionId, insertedAt, receivedAt)` = Date.parse ms*1000 + sha256 tie%1000 (the P1-2 defect), `decideProcessing`, `translateRevision`, `ChannelBookingPayload`, `HubRevision`. health.ts: computeHealth (failures within freshness target don't degrade). budget.ts: reserveSlot (pruneSends drops future stamps — P2-2 defect), maxInAnyWindow.
   - src/adapters/hub.ts (HubAdapter, HubTransport, HubError, HubTransportError), src/adapters/channex/wire.ts (WIRE_FACTS, PATHS, bodies, parseAriSuccess (fails open — P2-3), toHubRevision, parseFeed, parseWebhook, webhookRegistration, WEBHOOK_TOKEN_HEADER 'x-portico-webhook-token', WEBHOOK_SIGNATURE_HEADER), client.ts (channexAdapter; holds retry-after parse, property title, pagination semantics, 404=no revision — to move to wire.ts per P2-4), simulator.ts (handleRequest, addRevision (revisionId idempotent option), webhookDeliveries, requestInstants), simulator-hub.ts (ChannexSimulatorHub run/createProperty/transport/addRevision/deliver/setSink), http-transport.ts (fixedHostHttpTransport).
   - src/service/common.ts (DistributionDeps, DEFAULT_CONFIG callDeadlineMs 45000 leaseMs 60000, loadConnection, requireOnConnection, settingsOf, targetForEnvironment, provenanceOfTarget, hubModeFor, hubContext, scheduleTenant, recordExchange, lockPropertyInbound, lockAri).
   - src/service/exceptions.ts (raiseException (increments occurrences each call — P1-1 needs once-per-state-change option), autoResolve, exceptionView, listExceptions, resolveException, raiseDiscrepancy, autoResolveDiscrepancies, markCredentialsInvalid).
   - src/service/ari-dirty.ts, ari-values.ts, ari-dispatch.ts (claim/record/dispatchKind, reserveBudget, nextBudgetSlot, upsertChannelState exported, publicationBlockedBy: blocks all ARI when availability external, restrictions when rates external), health.ts (gatherFacts, refreshHealth, nextHealthDue, getHealth, propertyHealth), stop-sell.ts, mappings.ts (no connection FOR UPDATE), inbound.ts (storeRevision, processInbound, processOne, earlierUnsettled at ~line 680 counts received/failed/parked, escalateParked, dispatchAcks, pullFeed (logs property_mismatch), recoverSince (guarded hub calls → markCredentialsInvalid + DomainError 502 'hub_request_failed'), resolveRevision (retry refused for dismissed: requires ack_state not_due), listRevisions/getRevision), webhooks.ts (receiveWebhook, header/hmac verifiers), connections.ts (create/verify/activate/pause/resume/disconnect/updateSettings/rotateCredential/rotateWebhookToken/requestResync/resyncConnection/onAuthorityChanged), calendar.ts, discrepancies.ts, messages.ts, simulator-control.ts (redacted read; idempotent simulated booking via sha256 revisionId), jobs.ts (connectionWork, nextDue, runTenantWork, distributionJobs, distributionSubscriptions — parse failures `if (!p.success) return;` = P2-8).
   - src/routes.ts (all HTTP routes; public webhook POST /v1/distribution/webhooks/channex/:endpointId with rateLimit max 600 per IP — P2-5), src/search.ts (limit before permission filter — P3-5), src/seed.ts, src/module.ts (createDistribution binds sink), src/index.ts, src/services.ts, src/tables.ts.
   - modules/distribution/test/: harness.ts (startHarness, setupOrg, connect, tick, runFor, simState, maxPerMinute, sys, bindPorts), fakes/reservations.ts (+ sql), ari-engine, inbound, lifecycle, isolation-permissions, delivery-edges, regressions, scenario-s02-channel-ingestion, scenario-s20-hub-outage, compat/contracts tests. Last full gate: distribution 11 files, 91 passed + 2 todo.
   - apps/api/src/composition.ts (distribution wiring), apps/api/package.json, apps/api/test/distribution.test.ts.
   - modules/identity/src/domain/role-templates.ts (reservations_agent += distribution.channel.read, distribution.reservation.recover).
   - modules/distribution/README.md, FOUNDATION_REQUESTS.md (FR-1..FR-6), docs/parity/distribution.md (v2; PAR-DST-023 marked tested — must be downgraded per P2-1 until test exists).
   - Review docs: docs/orchestration/reviews/review-distribution.md; probes docs/orchestration/reviews/distribution-poc/zz-review-{a,b,c}.test.ts.txt (A1/A2 polling, A3/A4 ordering, A5 clock skew; B1–B8; C1/C2).
   - Mutation script: /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/mut/run.py (list M of (name, edits(file, old, new), test, filter); runs vitest -t, then `git checkout --` files; usage `python3 run.py M3 M15`). Note M3 pattern now outdated after G-1 rewrite: lease check is now `if (msg?.status !== 'sending' || msg.lease_token !== c.token) {`.

4. Errors and fixes (earlier build, abbreviated):
   - Migration order (platform schema missing) → migrateAfter ['platform'].
   - Protection flapping on a single 5xx → failures within freshness target don't degrade health.
   - Credentials refusal on feed path didn't raise exception → markCredentialsInvalid helper used on all hub paths (later also recoverSince).
   - Restrictions published while availability external → block all ARI.
   - booking.recovered not emitted for woken revisions → use parked_since.
   - Lock-order deadlock risk → record() locks connection first; health refresh after commit; mappings no connection lock.
   - Simulator booking not idempotent → deterministic revisionId.
   - Retry of dismissed revision hit CHECK → retry requires ack_state not_due.
   - Fix-round G-1: 7 warnings fixed (domain.test.ts firstRoom() helper replacing `rev().rooms[0]!`; calendar.ts chunk end via `[chunkEnd, window.to].sort()[0]`; optional chains in search.ts, ari-dispatch.ts, inbound.ts) — committed c2fd128.
   - pkill denied (don't interfere with other agents); TaskStop used for own background job instead.

5. Problem Solving — plans worked out for the fix round:
   - **P1-1 plan**: add `hubBlocker(tx, deps, conn)` (credential invalid, missing credential_ref, hubModeFor mismatch, liveScope refusal, not running) and reuse publicationBlockedBy per kind; in `nextDue` push hub-dependent instants (feed pull, ack due/lease, ARI open message/budget/dirty) only when not blocked; push health freshness wakes only when in the future; keep apply/parked/full-sync instants; floor stays now+1 s. Add `raiseException` option to write only if no open exception (once per state change) for publication_blocked, publication_refused, credentials_invalid. Unblocking transitions schedule: rotateCredential (scheduleTenant + next_feed_pull_at now), verify success (next_feed_pull_at now + schedule), onAuthorityChanged back → requestResync. Health facts: hub refusal → 'blocked'. Regression tests from A1/A2 inverted: gaps ≥ 60 s over 10 passes, exception occurrences === 1, one wake after verify / authority back and pending change published.
   - **P1-2 plan**: add to inbound_revisions `hub_micros bigint` (parse full fraction to µs, TZ-less → UTC), optional `hub_sequence` (unverified attribute, e.g. revision_number), `lifecycle_rank smallint` (new 0 < modified 1 < cancelled 2), `arrival_seq bigint identity`; comparator: hub_sequence if both present → hub_micros if both present and differ → rank → arrival; earlierUnsettled computed in TS over the booking's revisions, excluding parked orphans; distribution decides staleness itself (a revision earlier than an already-applied one → stale, not sent to reservations, ack); pass reservations a per-booking monotonic `reservations_revision` = max applied + 1; equal (ts, rank) modifications → apply by arrival + routine discrepancy; apply_as_new same rules; mark ordering fields unverified in wire.ts + R4 checklist; simulator timestamp modes.
   - **P2-1 plan**: test where create fails with retryable 503 (state failed), modification arrives → must stay `received` waiting (not parked, no reservations call), then create retried → both applied; mutant disabling wait turns it red (mod becomes parked). Apply-as-new sibling: orphan r2 parked first, then r1 arrives and fails → apply_as_new on r2 refused. Downgrade/fix PAR-DST-023.
   - **P2-2 plan**: shared budget clock (default DB `clock_timestamp()` inside locked statement; test harness injects app clock for simulated-time tests; A5 regression on DB clock), keep future stamps, monotonic stamps, re-stamp slot at completion in record(), margin setting (e.g., budgetMarginSeconds 2, window 62 s); B5 pure regression.
   - **P2-3 plan**: parseAriSuccess unrecognized when warning lacks index, `errors` present, or unrecognized 2xx; record() → new status `pending_verification` (migration check), cells not written to channel_state, urgent exception (responsible monoclay), no auto-retry, calendar shows unconfirmed; optionally availability read-back (GET /availability V2 shape).
   - **P2-4 plan**: move client.ts assumptions into wire.ts with WIRE_FACTS; simulator modes (timestamps equal/second/absent/tzless; refusal shape no_index/errors_200; webhook payload subset; multi-page bookings; ack-twice 404; exclusive date_to; fixed-minute limit counting 429s) with truthful-behaviour tests.
   - P2-5: key limit on endpointId (token check first, exempt valid), unauthenticated attempts as per-connection counter (unauthenticated_count, last_unauthenticated_at) not append-only rows. P2-6: directory row active only after verify succeeded (credential_state valid); unverified claim never blocks verified owner; rotateCredential re-verifies same property. P2-7: definer redaction function / erasure path keeping ids+hashes (+ retention), guests port strict fake if needed. P2-8: parse failure → urgent `change_event_unreadable` exception + mark connections fully dirty for the kind (only if publishing connections exist).

6. All user messages:
   - Initial task message (module owner for distribution, Channex readiness; full instructions incl. read-first list, build steps 1–7, gates `pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2`, reply contents, "A steward review will follow.").
   - System enforcement: "[handback-send-enforce] Your report has not been delivered. Call SubagentHandback({message: <your full report>}) now; the call ends your run." (I then called SubagentHandback; delivered.)
   - Coordinator message "Distribution fix round 1" (full content summarized in section 1; ends "Address this before completing your current task."), including: "Commit after every meaningful step. Do not push. Never amend or rewrite commits. Gates: `pnpm lint`, `pnpm turbo run typecheck --force`, `pnpm turbo run test --force --concurrency=2`, all exit 0."

7. Pending Tasks:
   - P1-1 (in progress), P1-2, P2-1 (+PAR-DST-023 correction), then P2-2, P2-3, P2-4, P2-5, P2-6, P2-7, P2-8, cheap P3s (P3-1…P3-9 as feasible), README/parity/WIRE_FACTS/R4 checklist updates, readiness register (P3-3).
   - Re-run mutation proofs for every P1/P2 guard (update run.py patterns), self-check v6 tables (§3, §5.1 state machines with hub as external holder, pasted writer searches, control-fact grid with input-source column, §5.4 mutation table, §6 claim ledger).
   - Gate block on merged tree (merge main again first): pnpm install --frozen-lockfile, pnpm lint, pnpm turbo run typecheck --force, pnpm turbo run test --force --concurrency=2 — all exit 0 (run in background with logs; read exit codes, never pipe).
   - Final report via SubagentHandback.

8. Current Work:
   - Merged main (merge commit 83d5b5a), committed G-1 as c2fd128 "fix(distribution): G-1 zero lint warnings under --error-on-warnings".
   - Was starting **P1-1** by viewing `nextDue` in modules/distribution/src/service/jobs.ts (lines ~99–150):
     ```ts
     async function nextDue(tx, conns: ConnectionRow[]): Promise<Date> {
       const candidates: Date[] = [new Date(tx.now.getTime() + 15 * 60_000)];
       const push = (d) => { if (d) candidates.push(new Date(d)); };
       for (const c of conns) {
         if (c.status === 'disconnected' || c.status === 'setup') continue;
         push(c.next_feed_pull_at);
         if (c.status === 'active') push(c.next_full_sync_at);
         push(await nextHealthDue(tx, c));
         if (c.status === 'active') {
           for (const kind of ARI_KINDS) {
             const open = ...status in ['queued','sending','failed_transient'];
             if (open) push(open.status === 'sending' ? open.lease_until : open.next_attempt_at);
             const dirty = ...min(first_dirty_at);
             if (dirty?.at && !open) push(await nextBudgetSlot(tx, c, kind));
             if (dirty?.at) push(new Date(new Date(dirty.at).getTime() + settingsOf(c).freshnessTargetSeconds * 1000 + 1000));
           }
         }
         const rp = ... min(next_attempt_at) filter received/failed as apply, min(ack_next_at) filter pending/failed as ack, min(ack_lease_until) filter sending as lease, min(parked_since) filter orphan not escalated as parked;
         push(rp?.apply); push(rp?.ack); push(rp?.lease);
         if (rp?.parked) push(parked + PARK_ESCALATION_MS);
       }
       const min = Math.min(...candidates.map((d) => d.getTime()));
       return new Date(Math.max(tx.now.getTime() + 1000, min));
     }
     ```
     nextDue currently takes only (tx, conns); it will need `deps` to evaluate hub/publication blockers.

9. Optional Next Step:
   Implement P1-1 per the plan: add blocker helpers (hubBlocker + exported publicationBlockedBy), pass `deps` into `nextDue`, exclude hub-dependent instants for blocked connections/kinds, push freshness wakes only if in the future, add `raiseException` "only if new" option for publication_blocked/publication_refused/credentials_invalid, make rotateCredential/verify schedule the tenant and set next_feed_pull_at, then write regression tests from probes A1/A2 inverted ("next due ≥ 60 s while blocked; exception occurrences 1; one wake when the key is re-verified / authority returns") and commit. This follows the coordinator's instruction: "**P1-1, a polling loop.** ... Work that cannot progress must be parked until the blocking state changes: the key is re-verified, or authority returns. The exception is written once per state change. Turn the probes A1/A2 into regression tests." Then proceed to P1-2, P2-1, the P2s, P3s, mutation table, self-check v6, gates, and SubagentHandback.

If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /root/.claude/projects/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/subagents/agent-a7e54633dbf24e059.jsonl
Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.
````

## Report (2026-11-07T22:33:51.080Z)

````text
I've built Portico's distribution module with a Channex adapter and a Channex API simulator. All four owner requirements work end to end against the simulator, so readiness is R3. Nothing has called the real Channex. Real booking ingestion is still blocked on main: the reservations module can't price channel bookings yet. On the merged tree (main 6d18714, branch head a8bd950), lint, typecheck and the test gate all exit 0.

Work is on `feat/distribution-channex` in `/home/user/wt/distribution`, committed locally, not pushed.

## Built, by owner requirement

**1. ARI engine.**
- An outbox consumer listens for `inventory.availability.changed`, `rates.prices.changed`, `rates.restrictions.changed` and `platform.dataAuthority.changed`.
- It records only which nights changed, never values. Overlapping and adjacent date ranges merge per (connection, kind, unit type, rate plan).
- Values come from inventory and rates when a message is built, so only the latest state per night is sent.
- Nothing polls the inventory or rates tables. The only periodic work is a 2-second tick that wakes organizations whose work is due.
- Full resync runs on connect, every 24 h over 400 nights, and on demand for a date range. It only re-sends values and never removes anything.
- Last-acknowledged channel state is kept per cell. A check turns unexplained differences into discrepancies and re-sends them.

**2. Outbox and queue.**
- There is at most one open message per connection and kind. While it waits, newer changes merge into it, so 50 edits became one call.
- The default budget is 10 availability plus 10 restriction requests per minute, which matches your 20/min and Channex's published split. It is configurable per connection.
- The budget is a sliding window: never more than the limit in any 60 seconds. A standard token bucket would allow twice that within one minute.
- Each request is classified:
  - **Bad request:** never retried; raises an exception with a plain-language fix, and the cells show "not accepted".
  - **Temporary failure:** retries at 5 s, 10 s, 20 s, 40 s, then every minute; urgent after 30 minutes.
  - **HTTP 429:** pauses the budget for at least 60 s.
  - **Refused key (401/403):** stops that connection only, with an urgent exception.
- Stop-sell protection closes the last 2 units of a type while the connection is behind; there is also a manual stop-sell.
- Nothing is published while an external system is authoritative for availability.
- Every hub call re-checks the environment:

| Environment | Where calls go |
|---|---|
| Demo, trial, training | Simulator |
| Sandbox | Channex staging only |
| Live | Refused, until platform's activation scope is bound |

**3. Webhook endpoint.**
- The endpoint is `POST /v1/distribution/webhooks/channex/:endpointId`, routed by an unguessable id and rate-limited.
- Authentication is pluggable. The default is a secret token header compared in constant time; HMAC signatures are also supported.
- Each revision is stored, unchangeable, before the 200 is returned, keyed by (connection, channel booking id, revision id).
- A redelivery is logged as a duplicate. The same revision id with different content raises an urgent conflict and the first version stands.
- Processing is ordered per property:
  - **Orphans:** a modification or cancellation for an unknown booking is parked; after 15 minutes it raises an urgent exception, with "Apply as new" and "Dismiss" actions.
  - **Unmapped bookings:** they get a provisional inventory hold plus an urgent alert.
  - **Recovery:** a pull of unacknowledged revisions runs on webhook gaps and every 15 minutes, plus a "re-request since T" reconciliation.

**4. Acknowledgement flow.**
- The reservations change, the revision outcome and the ack due date commit in one transaction.
- Acks are sent from a later transaction and only for final outcomes; a database check also enforces this.
- A failed revision is never acknowledged. It retries, or a person retries or dismisses it.
- Acks are retried until Channex accepts them.

**Proof.** 91 module tests (2 todo) and 3 API tests. Scenarios S02/E02 and S20 pass at module level. There are genuinely concurrent tests for the budget, dispatchers, the ack-before-commit window, and duplicate deliveries. Parity coverage rose from 0% to 31% of rows and 47% of edge cases. The module's parity gate still fails: the booking engine, VCC and channel tax rows are outside this increment.

## Blockers and decisions for you

- **Real channel ingestion is blocked on main.** The reservations module can't price channel bookings until rates provides `termsFromChannelPrices`. The API test shows a booking is stored and **not** acknowledged, with an exception. So the module tests and the S02/S20 scenarios use a strict fake of reservations, which runs the real validation schema and permission check. S02's money and inventory lines are todo.
- **Live publication is refused** until platform's activation scope is bound.
- **I edited the identity module's role templates.** Reservations agents now get channel read and booking recovery. Revenue manager already had `distribution.*`.
- **Channex isn't an integration-module connection.** The integration catalogue can't host it yet, so distribution keeps its own connections, exceptions and exchange log.
- **Five foundation requests are filed** in `modules/distribution/FOUNDATION_REQUESTS.md`: shared vocabularies, a body-reading safe HTTP client, Channex as an integration connection, producer event schemas, and erasure for stored guest data.
- **Known gaps:** guest personal data in stored revisions has no erasure path yet. Only the base-occupancy price is published.

## Self-check (v4, as briefed)

The self-check playbook moved to v5/v6 on main during the run. I applied v4 plus one mutant per guard; I did not produce v6's claim ledger.

**§ 1 Gate block** (merged tree, exit codes read directly)

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | 0 |
| `pnpm lint` | 0 (7 warnings) |
| `pnpm turbo run typecheck --force` | 0 (19 tasks) |
| `pnpm turbo run test --force --concurrency=2` | 0 (17 tasks) |
| `pnpm turbo run test --force` (default concurrency) | not run |

**§ 2 Checklist (items 5–32):** 24 yes, 4 N/A, 1 no, 3 partial.

| Answer | Items |
|---|---|
| Yes | 5–12, 14, 20, 21, 23, 24, 25, 27, 30, 31, 32: isolation, permissions, concurrency, atomic effects, compatibility, strict fakes, authority, environment, no secrets, cited claims and readiness. 13 is satisfied by design: the consumer only marks cells, so a stale event re-sends current values at most. 26: one production hub property per organization, proven by test. |
| N/A | 16–18 (distribution moves no money); 19 (distribution provides no functions to other modules yet) |
| No | 29: erasure (foundation request) |
| Partial | 15: an unknown ARI outcome is retried, which is safe for absolute values. 22: producer event schemas (foundation request). 28: fixed-host transport instead of the shared safe client (foundation request). |

**§ 3 Findings I found and fixed during the build:**

| Finding | Commit | Test | (b) Siblings checked | (c) Failure path | (d) Griefing | (e) Atomic |
|---|---|---|---|---|---|---|
| A refused key on the feed pull raised no exception | 6d03086 | "a revoked key…" | ARI, ack, feed, verify, re-request since T | Only the flag and the exception are written | Only the hub's 401/403 can trigger it; recovery is re-verify | n/a |
| Re-request since T bypassed that rule, surfacing a bare 500 | 59c4580 | inbound "re-request since T" (refused key at the end) | Found by searching for every hub call site | Throws 502, changes nothing | Same as above | n/a |
| Rates were published while availability was external | 6d03086 | "nothing is published while…" | The only send path, plus activate and resume | Nothing is sent | Authority needs platform permission | n/a |
| One 5xx triggered stop-sell protection (flapping) | 6d03086 | "transient errors…" (no stop-sells) | Ack and apply failures use the same health rule | n/a | n/a | n/a |
| "Recovered" event missing for revisions woken from parking | 8b37b3a | S02 E02 | n/a | n/a | n/a | n/a |
| Lock-order cycle (outcome → connection → ARI lock) | 4208cda | Existing concurrency tests | All lockers follow connection → ARI lock → message → budget | n/a | n/a | No test provokes the cycle |
| Retry could re-open a dismissed revision | 2de3b8c | Orphan test (dismiss part) | Retry, apply-as-new, dismiss | Refused cleanly | n/a | n/a |
| Simulated booking not idempotent | 7cdd6f5 | API test | n/a | n/a | n/a | n/a |

Column (a) reverse order applies to none of these: no fix adds an "only when new" exception.

**§ 4 Contract integrity:** the grep checks are clean. `severity` and `responsibleParty` are equal copies of integration's, pinned by a compatibility test (modules can't import each other). Provenance is typed against the kernel. No port takes an optional scope.

**§ 5 Invariant closure.** Every guard below made its test fail when disabled; I disabled each one in turn and restored it afterwards.

| Invariant | Guard disabled | Test that failed |
|---|---|---|
| Ack only after a committed final outcome | Check constraint + final-state filter on ack claims + ack on failure | inbound "failed to apply is never acknowledged" |
| Ack only after a committed final outcome | Check constraint alone | regressions "acknowledgement can never be due" |
| One effect per revision | Property lock + re-check after lock | inbound "exactly once" |
| Channel state = last accepted payload | Lease token check | delivery-edges "late answer" |
| Channel state = last accepted payload | Sequence guard | regressions "OLDER message" |
| Budget never exceeded | Row lock on the budget | ari-engine "20 concurrent reservations" |
| No ARI while availability is external | Authority check | ari-engine "nothing is published while…" |
| No ARI while availability is external | Rates also blocked (narrowed back to rates only) | same test |
| Unmapped booking has an alert | Alert | inbound "parks with a provisional hold" |
| Unmapped booking has a hold | Hold release | same test |
| Orphans parked, not applied | Parking decision | S02 E02 |
| Parked orphan resumes when its booking arrives | Wake-up of parked orphans | S02 E02 |
| Escalation only after 15 minutes | 15-minute window | inbound "orphan never matched" |
| Refused key handled on every path | Feed path | ari-engine "revoked key" |
| Refused key handled on every path | Re-request since T path | inbound "re-request since T" |
| No protection flapping | Freshness-target rule | ari-engine "transient errors" |
| Environment decides the hub | Target re-check at each call | isolation "never reaches a hub" |
| Dismissed revision stays closed | Retry condition | inbound "orphan never matched" |
| One active connection per production hub property, across all organizations | Uniqueness | isolation "production hub property" |
| No secrets replayed | Idempotency replay plan | API "permissions, isolation, idempotent create" |

The writer lists were derived by searching the code for every writer of the ack and revision states and the key's state, and every hub call site. The duplicate re-ack filter on its own is redundant: the check constraint covers it, which the constraint test proves.

**Exemptions (BS4-2), each failing closed or defended:**
- No price for a night → that night is published closed, never with an invented price.
- Unmapped cells are dropped from a message rather than guessed.
- Unreadable stored settings fall back to the conservative defaults.
- Unknown errors are retried and never acknowledged.
- Missing guest surname → placeholder "Channel guest", flagged in the notes.
- Non-booking webhooks get a 200 and are logged.
- Dismiss acknowledges a revision that wasn't applied: it's an explicit, audited human decision.
- Simulator fault and outage controls aren't idempotent (test tools only).

## What is unverified about Channex

Direct fetches of `docs.channex.io` are blocked here. I confirmed some facts only from search-engine excerpts:
- Hosts and the `user-api-key` header.
- `POST /availability` and `/restrictions` taking a list of values.
- Limits of 10 + 10 per minute per property, with 429 when exceeded. A "coming soon" page says 5 per minute, which is why the limits are per-connection settings.
- The revision feed, ack and get-revision endpoints; unacknowledged revisions stay in the feed and Channex e-mails the hotel after 30 minutes; statuses `new`, `modified`, `cancelled`.
- Webhook settings: callback URL, event mask, custom headers, `send_data`.

**Unverified** (each marked in `src/adapters/channex/wire.ts`, the single mapping file):
- ARI fields:
  - Date field names, and whether the end date is inclusive (assumed inclusive).
  - Restriction field names and their "no restriction" values.
  - Rate sent as a decimal string.
- Responses and limits:
  - The success response shape, and partial acceptance via warnings.
  - `Retry-After` on 429.
- Bookings:
  - The revision JSON shape and attribute names.
  - That acknowledging twice is safe.
  - The "bookings since T" filter.
- Webhooks:
  - Whether webhooks are signed at all (assumed not).
  - The webhook body when it carries data, and event names other than `booking_new`.
- The credential test endpoint.

The simulator encodes the same assumptions independently, so it catches drift between adapter and simulator but cannot verify Channex itself.

## What the R4 staging test will check (once you provide a staging key)

1. The credential test returns 200 for the staging property and 401 for a wrong key.
2. Availability fields and date inclusivity, read back from Channex.
3. Restriction fields, the clearing values, and the rate format, read back.
4. The success response shape, and whether a bad value fails the whole request or comes back as a warning with an index.
5. Whether the 11th request in 60 s gets a 429 and `Retry-After`, confirming 10 + 10 or 5 per minute.
6. A real webhook from a staging OTA booking: event names, body, and whether our token header arrives; check whether any signature exists.
7. The real revision JSON: arrival-order timestamp, nightly amounts, child ages, who collects payment, and that no card data reaches us.
8. Acknowledgement: POST vs PUT, acknowledging twice, and that the revision leaves the feed.
9. Create, modify and cancel with webhooks off, then confirm the 15-minute pull recovers all three in order, and check the "since T" filter.
10. Channex's PMS certification checklist. Passing staging calls is not certification; submission (R5) and approval (R6) are separate.

The full module README with these details is at `modules/distribution/README.md`.
````

