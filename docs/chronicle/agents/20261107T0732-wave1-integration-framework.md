# Agent run: Wave1: integration framework

- Started: 2026-11-07T07:32:35.598Z · last activity: 2026-11-07T12:15:14.162Z
- Turns: 754 · tool uses: 409 · output tokens: 1,715,438
- Type: general-purpose

## Brief (2026-11-07T07:32:35.598Z)

````text
You are the engineer for Portico's **integration** module (wave 1) — the connector framework that makes Portico "the easiest platform to integrate, evaluate and adopt" (read docs/product/adoption-integration-brief.md in full; it is your primary brief, especially §2, §5–§9, §12–§13). First read the shared playbook at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/wave1-playbook.md and follow it exactly.

Your worktree: /home/user/wt/integration (branch feat/integration-core). Test DB prefix: PORTICO_TEST_DB_PREFIX=w1_integration. Module path: modules/integration (package @portico/integration, schema `integration`). Spec: /home/user/wt/product/docs/specs/integration.md (may appear later — re-check). Also check /home/user/wt/adoption/docs/adoption/ (a docs agent is writing the connection lifecycle & health spec there now; reconcile before finishing).

Build (provider contract in docs/architecture/domain-map.md § integration):
- Connector SDK in code: ConnectorDefinition { key, category (pms, channel, pos, accounting, payments, doorLock, rms, crm, messaging, spaActivities, transport, procurement, identity, fiscal, dataPlatform, file), vendor, products & versions, regions, access model (public API / partner program / on-prem interface / file), local connector required?, credential schema (Zod), vendor-side setup steps (plain English), WorkflowCapability[] (workflow, operations read/create/update/receive, sync realtime/periodic/manual/file, status supported/limited/unsupported/unverified, limitations), cost notes ("quote required" when unknown), implementation status per CLAUDE.md §7 }. A catalogue API listing connectors with honest statuses — never imply certification.
- Reference connectors: (1) `pms.simulator` — a simulated external PMS (reservations, rooms, room status, charges) with controllable faults (delay, duplicates, out-of-order, outage, credential expiry) to prove connect-alongside flows; (2) `file.csv` — file-based import/export connector (clearly labeled file-based, never "live"); (3) `webhooks.outbound` — partner webhook delivery with HMAC signatures, retries/backoff, replay of a delivery by an admin, endpoint disable after repeated failures.
- Connections: per organization with property scope; the 9-step setup journey as a persisted state machine (selected → compatibility_reviewed → authorized → mappings_suggested → issues_resolved → validated → previewed → active → monitoring; plus paused, disconnected, error), progress preserved, each step with actor/time. Activation sets platform data authority for the domains the connection governs (platform.setDataAuthority — real platform exists on main) with a clear scope summary and impact preview.
- Credentials: never plaintext — stored via a SecretStore port (dev: kernel localFieldCipher with key from env; prod: AWS Secrets Manager/KMS — document), expiry dates, rotation flow, "credential expiring" health signal.
- Mappings: kinds property, unitType, unit, ratePlan, outlet, chargeCode, taxRule, ledgerAccount, status; suggestion engine (name/code similarity, structural hints) with confidence and reasons; financially significant or ambiguous mappings REQUIRE human review before activation; mapping versions and audit.
- Exchange log (inbound/outbound, workflow, external ref, idempotency key, outcome, latency) and sync runs (periodic/manual/file) with counts; inbound message store with dedupe (connection, external id, revision) and ordering rules; outbound command queue with idempotency keys that NEVER blindly replays money-moving or inventory-reopening actions after reconnection — they require revalidation (brief §8).
- Health: last successful exchange per workflow, current delay vs expected, failed/incomplete workflows, mapping problems, credential expiry, vendor-required changes; overall status (healthy/degraded/down/paused) with URGENT vs ROUTINE separation; impact statement listing affected properties and hotel functions.
- Exceptions: problem, business impact, responsible party (hotel/monoclay/vendor), next step, related records, owner, resolution — plain English, no payload dumps for staff (technical detail available to admins).
- Safe pause / disconnect / credential rotation / provider replacement with an impact preview of which hotel functions are affected before acting.
- Environment safety: every outbound call gated by assertExternalEffectAllowed (integration.read / integration.write / channel.publish); trial organizations can read but never write to real systems.
- HTTP routes for catalogue, connections & setup steps, mappings (suggest/review), validation runs, preview, activation, health dashboard (property and portfolio views), exceptions, pause/resume/disconnect/rotate, webhook subscriptions & deliveries. Permissions e.g. integration.connection.read, integration.connection.manage (sensitive), integration.mapping.review, integration.exception.manage, integration.webhook.manage.

Tests: full setup journey on pms.simulator incl. a required review of an ambiguous mapping; duplicate/out-of-order/delayed inbound messages; outage → health degraded with impact; reconnection does not replay a money-moving command without revalidation; credential expiry signal; trial org cannot write; webhook HMAC + retries + replay; isolation/permissions.
````

## Follow-up message (2026-11-07T11:13:05.909Z)

````text
The coordinator sent a message while you were working:
Orchestrator: the usage limit has reset. Continue exactly where you stopped (you were wiring the module into the composition root; check `git status`, your last commit and README Checkpoint; uncommitted work is still in the worktree). Commit after each meaningful step. Postgres was restarted and is up. When finished, deliver your final report as originally specified.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T11:40:31.207Z)

````text
The coordinator sent a message while you were working:
Orchestrator: steward verdict on feat/integration-core @8f95d16 — "merge after fixes": P0 1, P1 8, P2 10, P3 10. Full report: /home/user/portico/docs/orchestration/reviews/review-integration.md; probes in /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-integration-copy/modules/integration/test/zz-review-concurrency.test.ts and zz-review-ssrf.test.ts — turn the failing ones into regression tests.
Fix:
- F1 (P0) SSRF: implement a `safeFetch` (resolve-and-pin DNS at send time; block loopback, private, link-local, CGNAT, multicast, IPv4-mapped/compat IPv6, metadata 169.254.169.254/fd00:ec2::254 and unique-local ranges; reject literal-IP tricks and trailing-dot hostnames; allowed ports only (443, plus explicit config); no redirects to blocked targets; timeouts) and use it for every outbound call including the production transport. Remove the misleading DNS-rebinding comment. Structure it so the orchestrator can later extract it into a shared package.
- F2: pause/resume must never let an in-flight completion overwrite `needs_revalidation`; adapter calls need a deadline shorter than the lease.
- F3: effect classes must FAIL CLOSED — undeclared operations are money/inventory-class until declared; reservation create/update are not `standard` (INT-R19).
- F4: disconnect must not turn a vendor-held uncertain charge into `cancelled` (keep it pending verification with an exception).
- F5: guarded watermark upsert so an older revision can never overwrite a newer one under concurrent ingestion (incl. two CSV imports).
- F6 DECISION: replace `integration.inbound.applied` with the spec's synchronous handler port — owning modules register workflow handlers that apply the record in the SAME transaction (e.g. operations' `applyExternalRoomStatus`); acknowledge the vendor only after apply; per-record ordering; no guest PII in the outbox; failures surface as integration exceptions, never silent dead letters.
- F7: the worker must use the same connector registry/state as the API (no empty simulator flipping connections to error / false urgent exceptions).
- F8: a live organization must not be able to make the in-memory simulator a system of record (simulators only in demo/trial/training/sandbox).
- F9: adapt to identity-plus platform changes: money/availability domains need an authority transition with second approval (`second_approval_required`) — route activation through it; provide the `pendingOperations` count platform expects (see /home/user/wt/identity-plus/modules/platform README).
- Cheap P2s incl. F11 (concurrent exception raise), F12 (property-scoped reads on shared connections), F15 (24 h retry window; reprocess records held during authority switch), F18 (erasable PII outside append-only tables), F13 (vendor acknowledge classified as a write in trial).
Also: use main's `aggregateVersion` on your events and @portico/db pgCode/withSavepoint; follow ADR-0015 (docs/adr/0015 on main). Then `git merge --no-edit main`, lint/typecheck/tests, commit, report back briefly.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T11:56:45.336Z)

````text
This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

<system-reminder>
<tools-used-before-summary>Bash, Edit, Read, SubagentHandback, Write</tools-used-before-summary>
</system-reminder>
Summary:
1. Primary Request and Intent:
   - Original task: build Portico's **integration** module (wave 1) in worktree `/home/user/wt/integration` (branch `feat/integration-core`, test DB prefix `PORTICO_TEST_DB_PREFIX=w1_integration`, package `@portico/integration`, schema `integration`), following the playbook at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/wave1-playbook.md. It is the connector framework: SDK + catalogue, pms.simulator, file.csv, webhooks.outbound, connections with the 9-step journey, credentials via SecretStore, mappings, exchange log, sync runs, inbound dedupe/ordering, outbound queue with no blind replay, health, exceptions, safe lifecycle ops, environment safety, HTTP routes, tests. This was completed and reported via SubagentHandback (commit 8f95d16).
   - **Current request (steward review, "merge after fixes")** from the orchestrator. Full report: /home/user/portico/docs/orchestration/reviews/review-integration.md. Probes: /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-integration-copy/modules/integration/test/zz-review-concurrency.test.ts and zz-review-ssrf.test.ts ("turn the failing ones into regression tests"). Required fixes:
     - **F1 (P0) SSRF:** implement `safeFetch` (resolve-and-pin DNS at send time; block loopback, private, link-local, CGNAT, multicast, IPv4-mapped/compat IPv6, metadata 169.254.169.254/fd00:ec2::254 and unique-local ranges; reject literal-IP tricks and trailing-dot hostnames; allowed ports only (443, plus explicit config); no redirects to blocked targets; timeouts). Use it for every outbound call including the production transport. Remove the misleading DNS-rebinding comment. Structure it for later extraction into a shared package.
     - **F2:** pause/resume must never let an in-flight completion overwrite `needs_revalidation`; adapter calls need a deadline shorter than the lease.
     - **F3:** effect classes FAIL CLOSED. Undeclared operations are money/inventory-class until declared; reservation create/update are not `standard`.
     - **F4:** disconnect must not turn a vendor-held uncertain charge into `cancelled` (keep it pending verification with an exception).
     - **F5:** guarded watermark upsert so an older revision never overwrites a newer one under concurrent ingestion (including two CSV imports).
     - **F6 DECISION:** replace `integration.inbound.applied` with the spec's synchronous handler port. Owning modules register workflow handlers that apply the record in the SAME transaction; acknowledge the vendor only after apply; per-record ordering; no guest PII in the outbox; failures surface as integration exceptions.
     - **F7:** the worker must share the API's simulator state.
     - **F8:** a live org must not make the simulator a system of record (simulators only in demo/trial/training/sandbox).
     - **F9:** adapt to identity-plus platform. `setDataAuthority` throws `second_approval_required` for charges/payments/accounting/availability (user actor) and `authority_transition_open`. Route activation through a second-approval flow and provide `pendingOperations` (platform's `AuthorityTransitionGuard.pendingOperations(tx, propertyId, domains): Promise<Array<{ref, description}>>`). See /home/user/wt/identity-plus/modules/platform README.
     - **Cheap P2s:** F11 (concurrent exception raise), F12 (property-scoped reads on shared connections), F15 (24 h retry window; reprocess records held during an authority switch), F18 (erasable PII outside append-only tables), F13 (vendor acknowledge classified as a write in trial).
     - Also: use main's `aggregateVersion` on events and @portico/db `pgCode`/`withSavepoint`; follow ADR-0015. Then `git merge --no-edit main`, lint/typecheck/tests, commit, **report back briefly**.

2. Key Technical Concepts:
   - Modular monolith (TypeScript/Node 22, Fastify, Kysely, Postgres 16 RLS forced), ports and adapters, composition root, transactional outbox, idempotency (`runIdempotent`), ETag/If-Match, problem+json.
   - Environment safety: `assertExternalEffectAllowed`/`effectMode` from @portico/kernel (`integration.read`, `integration.write`, `channel.publish`); trial blocks writes.
   - Data authority via `platform.setDataAuthority`/`getDataAuthority`.
   - ADR-0015: the entry module authorizes intent and property scope; port calls carry the scope; providers enforce integrity; use `withSavepoint` around port calls.
   - Universal record contract: status per family, allowedActions, issues, owner, links; recordTypes; SearchProvider.
   - Foundation `ScheduledJob`/`runDueJobs`/`CORE_JOBS`; `Composition.jobs`, `services`, `demoSeedSteps`.
   - `fieldCryptoFromEnv()` (kernel) for the local SecretStore.
   - `DomainEvent.aggregateVersion` (32-bit int column); `pgCode`, `withSavepoint(tx, name, fn)` in @portico/db.
   - SSRF: resolve-and-pin with an `https.request` custom `lookup`; IPv6-embedded IPv4 decoding (mapped, compatible, NAT64, 6to4, Teredo).
   - No blind replay: effect classes standard/money/inventory/inventory_reopen; verify before resend; `needs_revalidation`; `hold_after_send`.
   - Handler port: savepoint-applied inbound records; `accepted` status when no handler is bound.

3. Files and Code Sections (main ones touched in the fix round):
   - **apps/api/src/composition.ts:**
     - Merged inventory and guests with integration. MANIFESTS: platform, identity, inventory, guests, integration.
     - Integration block: `notYetBound = unavailableCatalog({ratePlan:'rates', taxRule:'rates', chargeCode:'finance', ledgerAccount:'finance', outlet:'platform (outlets)'})`.
     - Catalog binding: unitType/unit come from `inventoryService.listUnitTypes(asSystem(tx), propertyId)` / `listUnits` (mapped to `{id, code, name, attributes}`).
     - `inbound: {}`, `activationScope: unavailableActivationScope`, `transitions: noAuthorityTransitions`.
     - `connectors: createConnectorRegistry({ pmsSimulator: pmsSimulators })` with `pmsSimulators = new PmsSimulatorHub(database)`.
     - `secrets: localSecretStore(fieldCrypto.cipher, fieldCrypto.keySource)`, `transport: safeWebhookTransport({ resolver: systemResolver, allowedPorts: [443] })`, `net: { resolver: systemResolver, allowedPorts: [443] }`.
     - `jobs: [...CORE_JOBS, ...createInventoryJobs(inventoryService), ...guestsJobs(guestsService), ...integrationJobs(integrationDeps)]`; `subscriptions: [...integrationSubscriptions()]`; integrationSearch is in searchProviders.
   - **apps/api/package.json:** depends on both `@portico/integration` and `@portico/inventory`.
   - **modules/integration/src/net/address-policy.ts (new, pure):**
     - `ipBlockReason(ip)`, `parseIpv6`.
     - `checkOutboundUrl(raw, {allowedPorts})` → `{ok, url, hostname, port}` or `{ok:false, code, reason}`. Rejects non-https, userinfo, IP literals, trailing dot, single-label names, localhost/.local/.internal and similar, and disallowed ports.
     - `vetAddresses(hostname, addresses)` throws `OutboundBlockedError`.
   - **modules/integration/src/net/safe-fetch.ts (new):**
     - `Resolver` type, `systemResolver` (dns lookup all:true).
     - `vetDestination(raw, {allowedPorts, resolver})`.
     - `safeFetch(raw, {method, headers, body, timeoutMs, signal, resolver, allowedPorts})`: resolves once, vets every address, pins via a custom `lookup` (handles `all`), `agent:false`, `servername`, no redirects, total timeout, discards the body.
     - `OutboundTimeoutError`.
   - **src/net/address-policy.test.ts:** all bypass strings rejected; public addresses allowed; zero connections to a 127.0.0.1 listener for resolver→127.0.0.1, mixed answers, mapped literals, `localhost.`, disallowed port.
   - **src/service/transport.ts:** `safeWebhookTransport({resolver, allowedPorts})` replaces `fetchWebhookTransport`.
   - **src/domain/webhooks.ts:** `checkEndpointUrl(raw, policy)` delegates to `checkOutboundUrl`; false rebinding comment removed.
   - **src/service/webhooks.ts:** async `validateTarget(deps, url, eventTypes)` with best-effort `vetDestination`; `updateSubscription(tx, deps, id, ...)` (routes updated).
   - **src/service/common.ts:**
     - `IntegrationDeps` adds `net: { resolver: Resolver; allowedPorts: readonly number[] }`.
     - `integrationStatusOf` returns live only for active/monitoring (paused/error → 'tested').
   - **src/contracts.ts:**
     - `effectClass = z.enum(['standard','money','inventory','inventory_reopen'])`.
     - `connectorSummary.provenance: z.enum(['external','simulated','file'])`.
     - `syncRun.counts.accepted` added.
   - **src/domain/outbound-policy.ts:**
     - `RISKY_CLASSES` includes 'inventory'; RANK standard 0, inventory 1, inventory_reopen 2, money 3.
     - New `effectOf(declared, operation, dataDomain)`: declared, else 'money' for charges/payments/accounting, else 'inventory'.
   - **src/connectors/sdk.ts:**
     - `provenance: 'external'|'simulated'|'file'`.
     - New `ackSemantics: 'none'|'per-client'|'shared-queue'` (simulator 'per-client'; file, webhooks and planned entries 'none').
     - `AdapterContext.deadline?: Date`.
   - **src/connectors/registry.test.ts (new):** invariants (declared effects, ≤R3, simulator simulated, file sync) and effectOf fail-closed tests. The registry is created with `new PmsSimulatorHub({} as never)`.
   - **src/connectors/pms-simulator.ts:**
     - Persisted. `SIM_LIMITS = {accountsPerOrganization:5, queue:2000, history:500, applied:1000}`.
     - `SimState` JSON with `toState()`/`fromState()`; keys stored as sha256 hashes.
     - `PmsSimulatorHub(database)` with `run(tenantId, accountId, fn, {write, tx?})`: row lock; saves state even if fn throws; rethrows outside the tx. Also `createAccount(tenantId, {property, keyExpiresAt, readOnlyKey, seedAt, tx})` (cap check) and `get(tenantId, accountId, tx?)`.
     - `SimulatorAccountNotFound`; `SimAccountHandle` async methods: createReservation, modifyReservation, cancelReservation, setRoomStatus, postCharge, setFaults, getFaults, issueKey, acknowledge, pendingCount, appliedCommands.
     - The adapter uses `call(ctx, fn, write)`; reservations effects are `{create:'inventory', update:'inventory', cancel:'inventory_reopen'}`.
   - **src/service/simulators.ts:** rewritten async; `assertSimulatorsAllowed(tx)` throws `simulator_not_in_live` in live.
   - **src/service/connections.ts:**
     - createConnection calls `assertSimulatorsAllowed` for simulators.
     - Compatibility adds blocking `simulator_authority_in_live`.
     - activate calls `assertSimulatorsAllowed`.
   - **migrations/0001_integration.sql:**
     - Added `integration.sim_accounts` (tenant_id, account_id text, state jsonb, created_at, updated_at; PK (tenant_id, account_id); tenant isolation).
     - effect_class check includes 'inventory'.
     - inbound_messages status includes 'accepted'; `redacted_at` added.
     - outbound_commands `hold_after_send boolean not null default false`.
   - **src/tables.ts:** `SimAccountsTable`; status unions updated; `redacted_at`, `hold_after_send`, effect_class 'inventory'.
   - **src/ports.ts:** added `InboundRecordForHandler`, `InboundHandlerResult`, `InboundHandler`, and `IntegrationPorts.inbound: Partial<Record<string, InboundHandler>>`.
   - **src/service/exchange.ts (major):**
     - `Counts.accepted`; `OUTCOME_OF_STATUS` includes accepted.
     - `ApplyNotCompleted` sentinel.
     - `claimRevision()` is a guarded upsert: `.doUpdateSet(...).where('integration.external_records.last_revision_order','<',revisionOrder)` returning `last_message_id`.
     - `applyThroughHandler()` runs in `withSavepoint(tx,'integration_apply',...)`: claim → handler or 'accepted'. Handler throws → held_validation with the party monoclay.
     - `notifyApplied()` is the thin event: aggregate `integration_external_record`, aggregateVersion only if 0 < revisionOrder ≤ 2147483647, payload without canonical/PII, plus revisionOrder.
     - `IngestResult extends Counts { acknowledge }`. Out-of-scope records are not stored or acknowledged. The message is inserted first, then applied, then the status updated.
     - `reprocessHeld()` uses forUpdate/skipLocked and status-guarded updates; it applies 'accepted' rows when a handler exists and they are still the watermark.
     - runSync collects `acks` and acknowledges only stored records; `ackAllowed` uses `effectMode(tx,'integration.write')` for shared-queue connectors.
     - F2: `SEND_LEASE_MS=60_000`, `SEND_BUDGET_MS=45_000`, `withDeadline()`, and `actx` with the deadline for lookup/send. Finalisation first reads the row FOR UPDATE: a late non-ack result is ignored if the status isn't 'sending'. If `hold_after_send` is set and the command is risky, it goes to needs_revalidation; on a disconnected connection, uncertain commands become pending_verification and definite failures become cancelled (with the cancelled event), and an exception is raised.
   - **src/service/exceptions.ts:** insert wrapped in `withSavepoint(tx, 'integration_raise_exception', ...)`; retries on `pgCode(err) === '23505'`.
   - **test/harness.ts:**
     - `new PmsSimulatorHub(t.db)`; `await h.hub.createAccount`.
     - Fake resolver: `internal.partner.example.com` → 10.1.2.3, `*.example.com` → 93.184.216.34, otherwise ENOTFOUND.
     - `inbound` fake handlers for reservations, roomStatus and charges (`h.applied`, `h.handlerMode` apply/reject/hold/throw).
     - setupOrg defaults to 'sandbox'.
   - **Tests updated:**
     - setup-journey checks `h.applied` and that the outbox has no 'Sample' (PII).
     - environment-safety: the live test asserts `simulator_not_in_live`; the trial-ctx test uses a sandbox org.
     - jobs.test.ts adds PROBE-10.
     - All simulator calls are awaited.
   - **Commits in this round:** f956b54 (merge), 62396dc (F1), 56d3fb1 (F3/F17), 00f88e3 (F7/F8/F14). The F6/F5/F11/F2 work is uncommitted.

4. Errors and fixes:
   - Merge conflicts (composition, package.json, lockfile): resolved by combining both blocks and `git checkout --theirs pnpm-lock.yaml` followed by `pnpm install`.
   - The registry invariant failed for the webhooks workflow (`create` had no effect class): added `effects: { create: 'standard' }`.
   - Simulator API went async: regex-added `await`. The first regex excluded the `(` lookbehind, so a second pass wrapped `(await account.appliedCommands())` and `pendingCount`.
   - Python edit asserted on the index.ts export order: re-ran with the correct snippet.
   - `aggregate_version` int overflow ("value 1793588400000 is out of range for type integer"): set aggregateVersion only when it fits int32; put revisionOrder in the payload.
   - Setup-journey test read the removed canonical payload: switched to `h.applied`.
   - API e2e test now fails because inventory is bound (expects an "inventory not connected" message): still pending (change to the rates message, and use a sandbox org because of F8).

5. Problem Solving:
   - Earlier work fixed many issues (fixed-clock ordering via seq columns, VALUES self-reference in the upsert, dispatch outage storm, etc.).
   - The current round reproduces and fixes the steward findings.
   - Test status: after F6 and before F11/F2, `test/` had 158 passing; unit tests had 126 passing. F2 typechecks but is not yet tested.

6. All user messages:
   - The original task assignment (integration module wave 1, playbook path, worktree, prefix, spec paths, the build list, tests list, final report via SubagentHandback).
   - Orchestrator: merge main (flaky DB fix, boundary guardrail, readiness docs, demo seeder). No reply needed.
   - Orchestrator: adoption specs on main; reconcile; G-03 (trial read-only guard with label "vendor credential permits writes; Portico blocks them") and G-05 (freshness targets; delayed/incomplete provenance per workflow); define ports for activation scope (`assertEffectInScope`) and authority transitions.
   - Orchestrator: universal record contract (status, allowedActions, issues, owner, links; "My work" inbox; recordTypes; SearchProvider; "Never put credentials/secrets in audit before/after").
   - Orchestrator: CHECKPOINT (README "## Checkpoint" section; commit "wip(<module>): checkpoint").
   - Orchestrator: usage limit reset; continue; commit after each meaningful step; deliver the final report as originally specified.
   - Orchestrator: main has `fieldCryptoFromEnv()`; bind the SecretStore's dev implementation to it in the composition root instead of a module-specific env var.
   - Orchestrator (current): steward verdict on feat/integration-core @8f95d16, "merge after fixes", with F1–F9 + cheap P2s (F11, F12, F15, F18, F13), aggregateVersion, pgCode/withSavepoint, ADR-0015; then `git merge --no-edit main`, lint/typecheck/tests, commit, report back briefly. The full text is quoted in Primary Request above.
   - Security constraints to preserve: no secrets in code, tests, fixtures or logs; never put credentials/secrets in audit before/after; never push; don't modify packages/kernel, db, http, testing, other modules, CLAUDE.md or docs outside the module (foundation needs go in FOUNDATION_REQUESTS.md); trial orgs never write to real systems; never drop databases you did not create; never activate live connections/paid contracts.

7. Pending Tasks:
   - Finish F2:
     - In `onReconnected` (exchange.ts), `replace` and `disconnect` (connections.ts), do not change the status of `sending` rows with a live lease (`lease_until > now`); set `hold_after_send = true` (risky). Expired-lease `sending` rows are treated as uncertain.
     - Add a PROBE-5 regression test.
   - F4: disconnect keeps uncertain commands (pending_verification, sending, last_error kind 'timeout') as `pending_verification` with an urgent `uncertain_after_disconnect` exception, and cancels only never-sent or definitely-failed ones. Fix the preview warnings per status. Add a PROBE-6 regression test.
   - F9:
     - Add an `awaiting_approval` second-approver step (or an equivalent) for scopes containing charges, payments, accounting or availability, with a different approver who holds `integration.connection.activate`. After approval, call platform setDataAuthority as a system actor, and check `authority_transition_open`.
     - Provide `pendingOperations(tx, propertyId, domains)` in the provider (from outbound_commands in queued/sending/pending_verification/needs_revalidation, filtered by workflow dataDomain).
     - Document the port name mapping (`openTransitionFor` status→state; `assertEffectInScope(tx, propertyId, effect, {connectionId, workflow})`) in the README.
   - F12: property-scoped reads (exchanges, outbound, exceptions, mappings, sync runs, health). Rows with a null property are visible only to users with every property; status mappings are allowed.
   - F15: webhook retry schedule ≥ 24 h (e.g. [60, 300, 900, 1800, 3600, 7200, 14400, 28800, 36000]; adjust MAX_DELIVERY_ATTEMPTS and DISABLE_AFTER_CONSECUTIVE_FAILURES, e.g. 15; update tests). Add a consumer for `platform.dataAuthority.changed` → `reprocessHeld` for connections covering that property.
   - F18: remove `make_append_only` on `integration.files`; add a retention job that redacts old inbound payloads (`redacted_at`) and purges old file content.
   - F19: compute the signature `t` just before `post`; per-delivery lease.
   - F23: mask the query string and userinfo of webhook URLs in audit.
   - F29: make `confirmMonitoring` idempotent (no VersionConflict on concurrent first imports).
   - Add `aggregateVersion` to other events (statusChanged with connection version, etc.).
   - Regression tests from the probes: PROBE-2 (concurrent older revision for a new record), PROBE-3 (concurrent reprocessHeld), PROBE-5, PROBE-6, PROBE-7 (concurrent CSV imports), PROBE-8 (concurrent raiseException). Also handler reject/hold/throw tests, the accepted → applied-when-bound test, and the F20 not-acknowledged test.
   - Update the API e2e test (apps/api/test/integration.test.ts): provision a sandbox org (simulators are refused in live) and expect a rates/finance unavailable message, since inventory is now bound.
   - Update README (contract changes: handler port replaces the event; thin event; F9 decisions; ports and bindings; FR-1 resolved; FR-5 done) and FOUNDATION_REQUESTS.
   - `git merge --no-edit main`; `pnpm lint`, `pnpm typecheck`, `pnpm --filter @portico/integration test`, `pnpm --filter @portico/api test`; biome format; commit; report back briefly to the orchestrator via SubagentHandback.

8. Current Work:
   I was implementing **F2** in `modules/integration/src/service/exchange.ts`. I had just applied, and typechecked, the guarded finalisation in `dispatchOutbound`: read the row `forUpdate`; ignore late non-ack results when `cur.status !== 'sending'`; handle `cur.hold_after_send && isRisky(c.effect_class)`, which sets `needs_revalidation` (or, when disconnected, `pending_verification`/`cancelled`) and raises an `actions_need_revalidation` or `uncertain_after_disconnect` exception. I had also added `SEND_LEASE_MS`/`SEND_BUDGET_MS`/`withDeadline` and `actx.deadline`, plus the migration column `hold_after_send` and its tables typing. The last command ran `npx tsc -p tsconfig.json` with no errors. Uncommitted changes: F6 handler port, F5 guarded watermark, F20, F21, F13 ackSemantics, F18 `redacted_at` column, F11 savepoint, and the F2 finaliser.

9. Optional Next Step:
   Continue F2 by updating `onReconnected` (exchange.ts), and `replace`/`disconnect` (connections.ts), so they do not overwrite `sending` rows with a live lease but set `hold_after_send = true`. Then implement F4 (disconnect keeps uncertain commands as `pending_verification` with an urgent exception, and splits the preview wording per status). Run the tests, add the PROBE-5 and PROBE-6 regression tests, and commit, per the orchestrator's instruction: "F2: pause/resume must never let an in-flight completion overwrite `needs_revalidation`; adapter calls need a deadline shorter than the lease" and "F4: disconnect must not turn a vendor-held uncertain charge into `cancelled` (keep it pending verification with an exception)." Then proceed through the remaining pending tasks (F9, F12, F15, F18, F19, F23, F29, aggregateVersion, probe regressions, API e2e fix, README), merge main, run all gates, commit, and report back briefly.

If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /root/.claude/projects/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/subagents/agent-ac1e034148f1ad77c.jsonl
Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.
````

## Report (2026-11-07T11:19:27.764Z)

````text
## Integration module (wave 1): finished

The connector framework is built and committed on `feat/integration-core` in `/home/user/wt/integration`. Nothing is pushed. All gates pass: `pnpm lint` (including the module-boundary check), `pnpm typecheck`, `@portico/integration` (93 tests in 13 files) and `@portico/api` (14 tests, including a new HTTP end-to-end test). I merged main several times and adopted the new foundation conventions: `ScheduledJob`, the universal record contract, `SearchProvider`, `recordTypes`, and `fieldCryptoFromEnv` for the secret store.

**What's built** (`modules/integration`)
- **Connector SDK and catalogue.** Three working connectors, all at R3 (tested internally only):
  - `pms.simulator`: a fake PMS with switchable faults (delay, duplicates, out-of-order, outage, expired key, command timeout or refusal, read-only keys).
  - `file.csv`: import and export, always labelled "not a live connection".
  - `webhooks.outbound`: partner webhooks.
  - Four planned entries are listed honestly at R1: Channex, OPERA Cloud via OHIP, accounting/ERP, door locks. They can't be connected, their workflows are marked unverified, and costs are dated or "quote required".
- **The 9-step setup journey** as a stored state machine, recording who did each step and when. A setup can be resumed, and a step can be repeated. Activation sets the system of record through the real `platform.setDataAuthority`.
- **Credentials** are only stored encrypted, have expiry and rotation, and raise reminders at 30, 7 and 1 days.
- **Mappings** are suggested with a confidence and reasons. Ambiguous or money-related ones must be reviewed by a person, and every change is versioned.
- **Exchange:**
  - Every message and action is logged, and sync runs record counts.
  - Incoming records are applied once and in order, or held, never guessed.
  - Outgoing actions carry idempotency keys and are never blindly replayed after a reconnection.
- **Health and exceptions:**
  - Health is measured per workflow against a freshness target, labelling data delayed or incomplete (G-05), with urgent problems separated from routine ones.
  - Each exception gives the problem, impact, responsible party and next step in plain English.
- **Safe operations:** pause, resume, disconnect, replace provider and rotate credential, each with an impact preview first. Disconnect is refused while the connection is the system of record.
- **Trial read-only guard (G-03):** trial organisations can only read, and a credential that could write is flagged.
- **Partner webhooks:** signed with HMAC, retried on a schedule, endpoint disabled after repeated failures, replay of one delivery or a time range, signing-secret rotation.
- Also: HTTP routes, the record contract with server-computed allowed actions, search, a "my work" list, and a scheduled background job.

**Scenarios proven**
- Full journey on the simulator, including a required review of an ambiguous room-type mapping.
- **S02:** duplicate, reordered and late messages give exactly one effect per revision, and a missed revision is marked incomplete until reconciled.
- **S20:** an outage turns health degraded, then down, with the affected hotel functions listed. After reconnection, charges and cancellations wait for a person, and repeated room-status updates collapse to the latest.
- A charge whose outcome was unknown is checked with the vendor and not sent twice.
- Credential expiry and suspension, then rotation.
- A trial organisation cannot write.
- Webhook behaviour, tenant isolation and permissions.

**Contract changes** (to be added to `docs/architecture/domain-map.md`)
- New provider functions: `forward`, `getFreshness`, `previewLifecycle`, `listExceptions`, `listWorkItems`.
- `raiseException` takes extra optional fields (`code`, `dedupeKey`, …).
- Owning modules receive incoming records through an `integration.inbound.applied` event instead of the spec's `registerWorkflowHandler` port.
- New events for outbound results, completed sync runs, expiring credentials and failed webhook deliveries.

**Ports you need to bind at merge** (currently stubs in `composition.ts`)
- Inventory, rates and finance record lists, used for mapping suggestions. Until these are bound, the HTTP journey stops at mapping review with a clear "module not connected" message; the module tests use fakes and complete the journey.
- Platform activation scope (G-04): the stub refuses all live writes to real systems.
- Authority transitions (G-02): the stub reports none in progress.

**Foundation requests** (`FOUNDATION_REQUESTS.md`)
- FR-1: `platform.dataAuthority.manage` is checked by platform but not registered in its manifest, so only org admins can activate a connection.
- FR-2: the two platform port bindings above.
- FR-3: tighten the data-authority constraint.
- FR-4: an AWS Secrets Manager secret store for production.
- FR-5: protection against webhook endpoints that resolve to private addresses (DNS rebinding).
- FR-6: a shared "my work" inbox contract.

**Risks and gaps**
- No real vendor connector exists, so nothing is sandbox-tested (R4).
- No module consumes `integration.inbound.applied` yet, so "applied" currently means "accepted and published".
- The simulated PMS lives in memory and resets on restart.
- The spec's SHOULD items are not built: local on-site connector, partner apps, XLSX import, setup reminders.
- `docs/parity/integration.md` doesn't exist yet. It belongs to the parity workstream, and the module can't pass the parity gate without it.

Details are in `/home/user/wt/integration/modules/integration/README.md`.

````

## Report (2026-11-07T12:15:14.013Z)

````text
All the required review fixes are done on `feat/integration-core` (worktree /home/user/wt/integration, head 9489056, not pushed). Main is merged in, and lint, typecheck, `@portico/integration` (173 tests) and `@portico/api` (35 tests) all pass.

**Fixes:**
- **F1 (P0, SSRF):** every outbound call now goes through `safeFetch` in `src/net/`. It resolves the name once, refuses unless every address is public (including IPv4 hidden in IPv6 addresses, cloud metadata addresses, IP literals, trailing dots, internal names and unlisted ports), pins the connection to the checked address, never follows redirects and has a time budget. The production webhook transport uses it, and the misleading DNS-rebinding comment is gone. It only uses Node built-ins, so it can move to a shared package unchanged.
- **F2:** pause/resume, replace and disconnect no longer take over a send that is still in flight. They set `hold_after_send`, and a completion without confirmation is held for a person. Adapter calls get a 45 s deadline against a 60 s lease, and a late answer never overwrites a decided action.
- **F3:** effect classes fail closed. An undeclared operation counts as money on money domains and inventory elsewhere; reservation create/update are inventory-class.
- **F4:** disconnect only cancels actions that never reached the vendor. Uncertain ones stay `pending_verification` with an urgent `uncertain_after_disconnect` exception. A person settles them with a new revalidate decision, `confirm_applied`, or with `cancel`.
- **F5:** the revision watermark is a guarded upsert, so an older revision never wins, including between two concurrent CSV imports.
- **F6:** owning modules register synchronous handlers (`ports.inbound[workflow].applyInbound`) that apply in the same transaction. The vendor is acknowledged only after that. When no handler is bound, records are kept in order as `accepted` and applied once one is bound. `integration.inbound.applied` is now a thin event with no guest data.
- **F7:** simulator state is stored in `integration.sim_accounts`, so the API and the worker share it.
- **F8:** simulators are refused in live organizations (`simulator_not_in_live`).
- **F9:**
  - Activation never moves charges, payments, accounting or availability directly. It plans a platform authority transition through a new optional `transitions.plan` port, and a second manager approves it there. The preview flags these changes.
  - If `plan` is not bound and platform refuses with `second_approval_required`, the person gets a clear explanation and nothing is activated.
  - The provider now has `pendingOperations(tx, propertyId, domains)` for platform's transition guard.
- **P2s:**
  - F11: concurrent raises of the same exception share one row.
  - F12: on shared connections, exchanges, outbound actions, exceptions and mappings are filtered to the reader's properties.
  - F13: acknowledging a shared vendor queue counts as a write, so it is blocked in trial.
  - F15: webhook retries now span about 25.9 h (10 attempts). Records held during an authority switch are reprocessed when the switch takes effect.
  - F18: `integration.files` is no longer append-only, and a 30-day retention job redacts settled payloads and file contents.
  - F19: the signature time is taken just before sending, each delivery in a batch gets its own lease, and a guard stops two workers recording the same attempt.
  - F23: webhook URLs are masked in audit.
  - F29: moving to monitoring after the first exchange happens once, even when two imports finish together.
- **Also:**
  - Connection status, exception and outbound outcome events carry `aggregateVersion`.
  - The exception and connection fixes use `pgCode` and `withSavepoint` from `@portico/db`.
  - Catalog reads follow ADR-0015.
  - Probes 2–8 are now regression tests in `test/concurrency.test.ts`. New tests also cover authority, retention and property scope.
  - The `simulator_not_in_live` check is covered in `environment-safety.test.ts` and the API test.

**Merge of main:** I resolved the composition conflict so operations, rates and integration are all wired. I also bound the rate-plan mapping catalog to rates, so the API test now expects unit types and rate plans as unmapped codes from the real modules. That test runs the journey in a sandbox organization and checks that a live one is refused.

**Still to do when identity-plus is on main:** bind platform's `openTransitionFor`, `planAuthorityTransition`, `assertEffectInScope`, and `transitionGuard` → `pendingOperations`. Until then, activation sets these domains directly on main's platform, which has no second-approval rule yet. The exact snippet is in `modules/integration/FOUNDATION_REQUESTS.md` FR-2, and the binding comment is in `apps/api/src/composition.ts`. The README lists the spec items still open from F15 and the gaps that remain: outbound command payloads are not yet redacted, and there is no per-tenant time budget per scheduler run.
````

