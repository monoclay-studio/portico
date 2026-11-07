# Steward review — `feat/integration-core` (module `integration`)

Reviewed: worktree `/home/user/wt/integration` at `8f95d16` (62 files, +18 114 lines). Nothing in the worktree was modified.
Experiments ran in `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-integration-copy`, an exact `git archive` of HEAD.
Probe tests (not part of the branch) are in that copy at `modules/integration/test/zz-review-concurrency.test.ts` and `zz-review-ssrf.test.ts`.

## Verdict: **merge after fixes**

The module is large, careful and mostly well-built. The catalogue is honest. Credentials stay out of responses and audit. Tenant isolation is tested. The 9-step journey is persisted and resumable. The S20 path for held money and inventory actions is real. But the review found:

- one P0: webhook SSRF;
- four P1 correctness holes, each reproduced with concurrent or real-topology tests:
  - a race that lets a money command escape revalidation after a reconnection;
  - an ordering race where an older revision overwrites a newer one;
  - effect classes that fail open;
  - disconnect turning an uncertain charge into "cancelled".
- a demo topology that breaks the simulator connection as soon as the worker runs;
- an event design for "applied" that doesn't guarantee "applied means applied".

All of these can be fixed locally with modest changes. Required before merge: F1–F5 and F7–F8. F6 and F9 can merge with documented decisions, but they must be settled before any module consumes inbound data or before identity-plus merges.

Counts: **P0 1 · P1 8 · P2 10 · P3 10**

## Command results

All commands ran in the copy with `PORTICO_TEST_DB_PREFIX=review_integration*` against local Postgres 16.

| Command | Result |
|---|---|
| `pnpm install` | ok (lockfile up to date) |
| `pnpm lint` | **pass**: biome checked 153 files, "Module boundaries OK (3 modules checked)" |
| `pnpm typecheck` | **pass**: 9/9 tasks |
| `pnpm --filter @portico/integration test` | **pass**: 13 files, 93 tests |
| `pnpm --filter @portico/api test` | **pass**: 4 files, 14 tests |
| Branch + main code changes (`git diff HEAD...main` applied; merge-tree clean), api + platform tests | **pass**: api 15 tests incl. the new `permission-catalog.test.ts`; platform 9 tests. FR-1 is resolved by `8d58366`. |
| `node tools/parity-report.mjs --gate integration` | **fail**: "No parity file for module "integration" — a module cannot pass the gate without one." No `integration.md` exists in `/home/user/wt/parity-ops/docs/parity/`; `gaps-ops.md` lists it as "remaining". |
| Review probes (`zz-review-concurrency.test.ts`) | 2 controls pass (PROBE-1 same-revision concurrent ingest, PROBE-4 concurrent dispatch). **8 probes fail**, i.e. the bugs are reproduced: PROBE-2, 3, 5, 6, 7, 8, 9, 10. Output is quoted under each finding. |

## Findings (ranked)

| ID | Sev | Where | Problem | Why it matters | Fix |
|---|---|---|---|---|---|
| F1 | **P0** | `src/domain/webhooks.ts:116-161`, `src/service/transport.ts:222-241`, `src/service/webhooks.ts:563` | **SSRF.** (1) The subscription-time validator has literal bypasses. Probe output: `https://[::ffff:127.0.0.1]/`, `https://[::ffff:169.254.169.254]/`, `https://[::ffff:10.0.0.1]/`, `https://[64:ff9b::a9fe:a9fe]/`, `https://[fe90::1]/` (fe80::/10 is only prefix-matched as `fe80`), `https://[fec0::1]/`, `https://localhost./` (trailing dot) and arbitrary ports (`:6379`) are all `{"ok":true}`. (2) No check at send time. `fetchWebhookTransport` does a plain `fetch`, so any DNS name that resolves (or rebinds) to a private, loopback, link-local or metadata address is contacted from the worker. Examples: attacker DNS, `*.nip.io`, split-horizon internal names, VPC endpoints. (3) The comment at `webhooks.ts:114` claims "DNS rebinding is handled at delivery time by the transport". It is not. | Any customer org admin with `integration.webhook.manage` in a live or sandbox org can make Portico's worker open TLS connections to arbitrary internal hosts and ports, on demand via `/test` and replay. The stored `last_response_status` and attempt outcome give a status oracle, and `dns rebinding + TLS session tickets` ("TLS poison") attacks are possible. HTTPS-only with certificate validation limits the impact but does not remove it. (The sandbox has no IPv6 or external DNS, so live reachability could not be demonstrated here; the validator acceptance is proven.) | (a) Put a shared `safeOutboundFetch` in a shared package (webhooks now; every future connector, comms and payments callback later). It should use an undici `Agent({ connect: { lookup } })` whose lookup resolves all addresses, rejects the request if **any** address is in a denied range, and pins the socket to the vetted IP (no check-then-connect TOCTOU). Denied: IPv4 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4. IPv6 ::/128, ::1, fc00::/7, fe80::/10, fec0::/10, ff00::/8, 100::/64, 2001:db8::/32. Decode the embedded IPv4 for ::ffff:0:0/96, ::/96, 64:ff9b::/96, 64:ff9b:1::/48, 2002::/16 and 2001::/32 and check it too. (b) At subscription time: strip a trailing dot before suffix checks, reject IP-literal hosts outright (require DNS names), allow port 443 only (8443 optional), and run the same resolver check for early feedback. (c) Keep `redirect: 'manual'` and add a connect timeout. (d) In infra (orchestrator): put the worker's outbound traffic behind an egress proxy or deny RFC1918 and link-local egress in its security group, and set the IMDSv2 hop limit to 1. (e) Tests: unit tests for every bypass string above, plus a test with a local listener on 127.0.0.1 that proves zero connections for mapped, trailing-dot and stub-DNS→127.0.0.1 URLs. (f) Fix the false comment. FR-5 must become a merge blocker, not a known gap. |
| F2 | P1 | `src/service/exchange.ts:996-997` (onReconnected takes `sending`), `:1895-1909` / `:2017-2029` (finalisation updates guarded only by `id`), `:1752` and `:1788` (60 s lease, no adapter deadline); also `connections.ts:1378` (disconnect) and `replace` | **Never-blind-replay is broken by a race.** A money command is in flight. Meanwhile a reconnection happens: resume, rotation, or recovery. `onReconnected` marks the command `needs_revalidation` with `verify_before_send=true`. Then the in-flight send finishes, and its finalisation overwrites the row unconditionally. **PROBE-5** output: `afterResume: needs_revalidation/verify=true` → `afterInflight: queued/verify=false` → the next dispatch sends it with `revalidated_at:null`, `sentToVendor:1`. A second path exists: adapter calls have no deadline. A send slower than the 60 s lease is flipped to `pending_verification` by the next dispatcher while still in flight. If a person then resends after a negative lookup, the charge goes out twice. | This breaks INT-I03, INT-R19 and lifecycle spec §9 ("reconnecting never blindly replays") under a realistic interleaving: a dispatch is in flight while a manager pauses and resumes during a vendor incident. | Finalisation must be conditional: `where status='sending' and version = claimed.version`. If 0 rows, re-read the row and reconcile: an `ack` still records the acknowledgement; anything else must not resurrect the command. `onReconnected`, `replace` and `disconnect` must not touch `sending` rows whose lease is live. Mark them `reconnect_pending` and let the finaliser apply the hold. Add `deadline`/`AbortSignal` to `AdapterContext` and enforce `deadline < lease − margin`. Keep PROBE-5 as a regression test. |
| F3 | P1 | `src/service/exchange.ts:1653`; `src/connectors/pms-simulator.ts:557` | **Effect classes fail open.** `wf.effects[op] ?? 'standard'` means any undeclared operation is `standard`: auto-resent after a negative lookup, never held on reconnect. **PROBE-9:** `charges` + operation `post` → `standard`. Separately, reservation `create`/`update` are declared `standard` although they consume or change inventory. The taxonomy has no inventory-consuming class (only `inventory_reopen`). | INT-R19 ("money or change inventory/**reservations** are re-validated") and lifecycle §9 class I. A caller's typo silently removes double-charge protection. | Reject operations not declared by the workflow (`unknown_operation`). Default by `dataDomain`: charges, payments and accounting → `money`; reservations and availability → inventory. Add `inventory_consume` (or rename to `inventory`) and class reservation create/update/cancel as risky. Add a test asserting every declared write operation of every connector has an explicit class. |
| F4 | P1 | `src/service/connections.ts:1366-1378`, warning at `:1191` | **Disconnect turns an uncertain charge into "cancelled".** `pending_verification`/`sending` commands, which may already be applied at the vendor, become `cancelled` and emit `integration.outbound.cancelled`. **PROBE-6:** `{"status":"cancelled","cancelledEvents":1,"warnings":["1 queued action(s) will be cancelled for review, never sent."],"vendorHasIt":1}`. | Finance (the consumer) reverses "pending in PMS", but the PMS has the charge. That is a money mismatch. The preview text "never sent" is false. Breaks CLAUDE.md §5 ("uncertain outcomes are pending verification, resolved by reconciliation"). | Make disconnect a blocker while `pending_verification` or `sending` exist ("verify N uncertain actions first"). Or resolve them by lookup before revoking credentials, and on failure keep them as `unknown_after_disconnect` with an urgent exception, never `cancelled`. Fix the preview wording per status. |
| F5 | P1 | `src/service/exchange.ts:421-438` (unguarded `onConflict…doUpdateSet`), `:568-575` (watermark `FOR UPDATE` finds no row for a new record) | **Inbound ordering breaks under concurrency.** For a record not seen before, two concurrent ingestions both "apply". The later-committing older revision then overwrites the watermark. **PROBE-2** (direct): watermark `"1"`, events `["2","1"]`. **PROBE-7** (public service, two concurrent CSV imports, Tuesday then Monday file): watermark `2026-11-02…`, events `[Tue, Mon]`. That contradicts the CSV connector's own promise that an older file never overwrites newer data. | INT-R16/INT-I01 ("older revisions never overwrite newer ones") holds only sequentially. A future push receiver (vendor webhooks) will make this common. | Guarded upsert: `doUpdateSet(...).where('integration.external_records.last_revision_order', '<', revisionOrder)` with `returning`. If nothing is returned, record the message as `stale` and skip the apply. Or take `pg_advisory_xact_lock(hashtext(connection‖workflow‖externalId))` before reading the watermark. Keep PROBE-2 and PROBE-7 as tests. |
| F6 | P1 | `src/service/exchange.ts:440-456`; README "Contract changes" item 3 | **`integration.inbound.applied` (event) instead of the spec's handler port.** "Applied" here means "accepted and published". (1) The vendor is acknowledged before any owning module applied anything. (2) The outbox has no per-aggregate ordering: deliveries are claimed by `next_attempt_at` and retries back off, so a failed revision N is overtaken by N+1. Integration itself can also emit out of order (F5). (3) A consumer that keeps failing goes `dead` after 12 attempts (`core.record_delivery_failure`). That failure is invisible in the integration console, while the exchange log says "applied". This is a silent drop (INT-I02, brief "never silently dropped"). (4) A consumer cannot reject back: operations' `applyExternalRoomStatus` throws `not_system_of_record`. (5) The canonical payload with guest names sits in `core.outbox`, where DELETE is revoked, so it can never be erased. (6) Consumers must dedupe by `messageId`, not event id. PROBE-3 produced two events for one message. | Answers focus (f): the **handler port is better for "applied means applied"**. Port inversion through the composition root (ADR-0003) does not create a cycle, so the README's argument against it does not hold. | Add `InboundHandlerPort { applyInbound(tx, canonical): applied(ref) \| rejected(reason, party, nextStep) \| held(reason) }`, called per record inside `ingestRecords` under a SAVEPOINT. Store the outcome in `inbound_messages` and `exchange_log`, raise an exception on rejected/held, and advance the watermark only on applied. With no handler bound, status is `accepted` (shown as "received, not yet applied in Portico"); replay from `inbound_messages` when a handler is bound. Keep a **thin** `integration.inbound.applied` notification (ids + revision, no PII) for analytics and webhooks. The operations worktree's `applyExternalRoomStatus(d, tx, unitId, {condition, dnd, observedAt, connectionId})` already has this synchronous shape. |
| F7 | P1 | `apps/api/src/composition.ts:61`; `apps/worker/src/main.ts:22` (`compose(database)` again) | **The simulator is split across processes.** The worker builds its own empty `PmsSimulatorHub`. Its first periodic sync (`next_sync_at = activation time`) gets "account does not exist", classed as `auth`. The connection goes to `error`, health `down`, with an urgent hotel-facing "credential rejected" exception. **PROBE-10:** `{"state":"error","health":{"status":"down"},"exceptions":[["credential_rejected","urgent","hotel",…]]}`. Multiple API replicas and restarts have the same problem. | The deployed demo, trial and evaluation story (adoption stages 1–3) breaks seconds after activation, and staff are told their credential is wrong. The README only mentions "per API process". | Persist simulator state in Postgres: a tenant-isolated `integration_sim` table set (accounts, keys, queue, applied commands), still clearly "external". Until then, have the worker skip simulator connections, and classify "account unknown in this process" as `outage`, never `auth`. Also cap accounts per tenant (see F14). |
| F8 | P1 | `src/service/connections.ts:377` (only a warning), `:976-1000` (`applyAuthority`); S20 test activates `FULL_SCOPE` (charges/reservations `forward`) on a simulator in a **live** org | **A live organization can make an in-memory simulator the system of record** for charges, reservations or room status. Real postings would then be "forwarded" to a fake that resets on restart. | Rules 15/16 and §7 ("a simulator is never a working integration"). Money correctness in production: Portico refuses direct postings because "the system of record is Lagoon PMS (Simulated PMS)". | In `live`, refuse `authority` entries for `isSimulator` connectors (allow read-only mirroring without authority, or only for properties in `setup` status). Add a test. |
| F9 | P1 | `src/service/connections.ts:988`; `ports.ts:75-80` | **Contract mismatches with the platform provider in `/home/user/wt/identity-plus`.** (1) Its `setDataAuthority` throws `second_approval_required` for `charges`, `payments`, `accounting` and `availability` when the actor is a user, and `authority_transition_open` when a transition is open. Activation and replacement of any connection with such authority (the branch's own S20/FULL_SCOPE) will fail once it merges. (2) Platform expects integration to provide `AuthorityTransitionGuard.pendingOperations(tx, propertyId, domains)` (ST-08); integration does not. (3) Platform has `openTransitionFor` returning `{id, status, …}`, while integration's port expects `activeTransition → {id, state}`. (4) No `assertEffectInScope` exists in platform for the `ActivationScopePort`. | Merge-order breakage, and RR-05/CR-10 separation of duties is not modelled: the same user can preview and activate money workflows. | Activation of governed-domain authority should go through platform transitions: plan → approve (second person) → effective, with integration activation in the same tx. Or add an `awaiting_approval` state with a different approver, plus the RR-06 single-approver safeguard. Implement `pendingOperations` from `outbound_commands`. Adapt the port names in the composition root. Record all of this in the README "Contract changes". |
| F10 | P2 | `docs/parity/integration.md` (missing) | The parity gate fails, so by CLAUDE.md §7 the module cannot be declared complete. The README checkpoint says "Done … all gates green". | Overclaim of completeness. | Coordinate with parity-ops. Matrix rows likely missing vs competitors: vendor push receiver; OAuth/consent apps (INT-R27); non-destructive "re-read range / re-push range / re-request since T" (SiteMinder); mapping completeness counters and bulk mapping import/export; mapping templates across properties (RR-07); usage metering; event stream (OHIP); sandbox org for partners; shadow-mode replacement. |
| F11 | P2 | `src/service/exceptions.ts:79-108` | **Dedupe retry inside an aborted transaction.** After a `23505` the code `continue`s in the same Postgres transaction. **PROBE-8:** the second concurrent raise fails with `current transaction is aborted, commands ignored until end of transaction block`. | Two syncs (job plus "sync now") hitting the same unmapped code or outage both raise `workflow_failing` or `unmapped_code`. One whole sync transaction then rolls back, and its `sync_runs` row stays `running` forever. | Use `insert … on conflict (tenant_id, connection_id, dedupe_key) where status in ('open','acknowledged') do nothing returning id`, then fall back to an update. Or use a savepoint. |
| F12 | P2 | Reads use `requireOnConnection(…,'any')`: `exchange.ts:189` (exchanges), `:1112` (sync runs), `:2057` (outbound), `exceptions.ts:231`/`listExceptions` (:259-263), `health.ts:204`, `mappings.ts:133` | **Property-scope leak inside a tenant.** For a connection spanning properties A and B, a user scoped to A sees B's exchange summaries (reservation and room refs), exceptions, outbound commands and mappings. | CLAUDE.md §6 "permission checks … with property scope; deny by default". | Filter rows by `property_id ∈ propertyIdsInScope(connectionRead)`, plus rows with a null property only for users with every property of the connection. Add a test. |
| F13 | P2 | `src/service/exchange.ts:1296-1306`; SDK `acknowledge` | **Trial: the vendor `acknowledge` call is a vendor-side mutation** (it consumes the external queue) but runs under the `integration.read` gate. In a trial with a read-only connection to a shared feed, this can take messages away from the hotel's live consumer. | Evaluation §4.3: "No write to any hotel system, ever, from a trial". | The SDK should declare `ackSemantics: 'none' \| 'per-client' \| 'shared-queue'`. Refuse `shared-queue` connectors in trial or use non-consuming cursor reads. Gate acks with a declared effect. |
| F14 | P2 | `src/service/simulators.ts:18`; `PmsSimulatorHub` | Simulator accounts are unbounded in shared API memory, created by any org with `integration.simulator.control`. | Cross-tenant availability (DoS). | Cap accounts per tenant and queue length per account. Persist them (F7). |
| F15 | P2 | Several | **Spec MUSTs only partly met:** INT-R26 retries total 80 460 s ≈ 22.4 h < required ≥ 24 h (`domain/webhooks.ts:13`). INT-R07: scope cannot change on an active connection (`setup-journey.ts:77-85` excludes active/monitoring). INT-R09: no shadow comparison on replace. INT-R17: cursor always `null`, reconciliation = last 500 samples, no range tools or nightly window. INT-R05: no XLSX, inbound HTTP receiver, or guests/units/balances import. CL-05: an unknown-entity modification is applied with a gap flag, not held and fetched. Validation (lifecycle §4) lacks count, round-trip, financial-recompute and timing checks, and warnings are not acknowledged by a named person. Messages `held_validation` because of a frozen authority transition are **never reprocessed** (only `reviewMappingAndReprocess` calls `reprocessHeld`), against source-of-truth T-7. INT-R23: no staff notifications. Step assignment (lifecycle §2.3) is not built. | Most are documented in the README "Known gaps", except the 24 h window, the active scope change, the transition reprocessing and CL-05. | Fix the 24 h schedule now. Consume `platform.dataAuthority.changed` and re-run `reprocessHeld` when a transition becomes effective. Track the rest in the README with spec IDs. |
| F16 | P2 | `docs/architecture/domain-map.md` (unchanged); `docs/readiness/readiness-register.md:70`; `service/provider.ts:76-84`; README "Permissions"; `domain/webhooks.ts:114` | **Contract and doc hygiene.** (1) The domain map was not updated in the same commit (rule 1 of "Rules for changing a contract"). (2) The readiness register still shows the connector framework at R1, while the catalogue claims R3 for three connectors. (3) `getFreshness(tx,{connectionId, workflow})` deviates from spec proposal 3 `{propertyId, workflow}`, which is what callers know, without being listed as a deviation. (4) Events are `integration.outbound.*` where the spec says `forward.*`. (5) The README still says FR-1 is pending. (6) The false rebinding comment (F1). | The register is the "single source of truth" (CLAUDE.md §7). | Update the domain map and register rows (R3, with evidence: test files and date). Add a `getFreshness` overload by property and domain. Reconcile the event names in the spec or the code. |
| F17 | P2 | `connectors/catalogue.ts:67,112`; `service/common.ts:154-180` | **Catalogue and status honesty nits.** Planned R1 entries and the webhooks connector carry `provenance: 'live'`; by rule 16, data from another system is `external`. `integrationStatusOf` returns `live` for a real connector that is `paused` or in `error`. Workflow ids `charges` and `keys` drift from INT-R02 (`posCharges`/`folioBalances`, `doorKeys`). | The UI may render a "live" badge next to OPERA (R1). No entry exceeds R3, the file connector is never `live`, and planned entries are not connectable, so focus (d) otherwise passes. | Use `external` (or `null` for planned entries). Return `live` only for `active`/`monitoring`. Align the workflow ids. Add a registry invariant test: level ≤ R3 without R4 evidence; simulator → `simulated`; `fileBased` → sync `file`. |
| F18 | P2 | `migrations/0001_integration.sql:233-248,294-317,501`; outbox payload | **No erasure path for raw guest PII:** `inbound_messages.payload` and `canonical`, `integration.files.content` (made **append-only**, so it can never be deleted), and the canonical payload in `core.outbox` (DELETE revoked). | Guest privacy requests (guests module) cannot be honoured. "PII minimized" (INT-R15) is not done. | Don't make `files` append-only (keep a hash and a metadata log append-only instead). Add a retention or redaction job. Thin events (F6). |
| F19 | P2 | `service/jobs.ts:36-60`, `service/webhooks.ts:516-560` | No deadline on adapter calls, so one tenant's hung vendor blocks `integration.dueWork` for the 20-tenant batch (lease 300 s). Webhook batches of 50 × 10 s outrun the 60 s delivery lease, causing duplicate claims and an `attempt_no` unique clash. The signature `t` is taken at claim time and can be more than 300 s stale when sent late in a slow batch, so partners reject valid deliveries. | Noisy neighbour; avoidable partner failures. | Per-call deadlines; a per-tenant time budget; claim one delivery per transaction or size the lease to the batch; compute `t` just before `post`. |
| F20 | P3 | `service/exchange.ts:536-545` | Records outside the approved scope are logged `rejected`, then **acknowledged** to the vendor without being stored or raising an exception. | INT-I02. | Store them (`rejected`) or don't acknowledge them. |
| F21 | P3 | `service/exchange.ts:785-797` | The `reprocessHeld` update has no `status in (held…)` guard. **PROBE-3:** two concurrent direct calls produced events `["1","1"]`. The HTTP path is serialized by `reviewMapping`'s connection `FOR UPDATE`, so this is latent. | Defensive exactly-once. | `where status in ('held_mapping','held_validation')` and check rows affected. |
| F22 | P3 | `service/webhooks.ts:249-253`; `service/credentials.ts:56` | Secrets are destroyed before the optimistic version check or commit. Harmless with the in-DB local store, but with the planned AWS store (FR-4) the destroy would happen outside the transaction. | Future data loss of the current secret. | Destroy after commit (outbox job or post-commit hook). |
| F23 | P3 | `service/webhooks.ts:159-169,230-235` | Webhook URLs, which partners sometimes use to carry tokens, are written in clear to audit before/after and shown in record history. | Domain map: "never write secrets into audit". | Mask the query string and userinfo in audit and history. |
| F24 | P3 | `service/health.ts` (`toISOString().slice(0,10)`) | Exception text shows UTC dates, not property-local ones. | Lifecycle §10 says property local time. | Format with the property's time zone. |
| F25 | P3 | `routes.ts` (`/subscriptions/:id/test` has no Idempotency-Key); `createSubscription` | Test sends are not idempotent. Webhook subscriptions can be created in trial or demo, although the kernel policy says `credentials.production` (webhooks issued to third parties) is blocked there. Deliveries are blocked or simulated, so there is no leak. | Policy alignment. | Require a key; assert `credentials.production` (or label subscriptions "simulated only") outside live and sandbox. |
| F26 | P3 | README invariants table | CL-12 ("log scanning test") is claimed, but only responses and history are checked. | Evidence overclaim. | Add a pino capture test during authorize, rotate and failing calls. |
| F27 | P3 | `service/jobs.ts:121-123` | Calls `platform.tenant_environment()` in SQL directly. identity and the worker do the same. | Boundary drift. | Route it through a port, or document it as a sanctioned foundation function. |
| F28 | P3 | `service/exchange.ts:114-125` | Exchange outcome vocabulary (`succeeded`/`held`) drifts from INT-R15 (`applied`/`parked`). | Glossary consistency. | Align, or document. |
| F29 | P3 | `service/exchange.ts:1415-1419` | Two concurrent first file imports after activation: the second fails with `VersionConflictError` from `confirmMonitoring` (seen while building PROBE-7). | A harmless conflict surfaces to staff. | Make `confirmMonitoring` idempotent: conditional update, ignore when already `monitoring`. |

## Focus areas

**(a) Security of outbound calls.** SSRF is F1, and yes, the module must block private, link-local and metadata IPs at send time.

HMAC signing is sound:
- `t.<raw body>` is signed with HMAC-SHA256;
- verification is constant-time with a 300 s tolerance;
- two `v1` signatures are sent during a rotation overlap;
- secrets are `whsec_`+32 random bytes, stored encrypted with AAD binding tenant, id and purpose;
- the secret is shown once and not stored in the idempotency replay (replay returns a placeholder; tested over HTTP).

Fix the timestamp staleness (F19). The secret store's `get` trusts the stored `purpose` rather than the expected one (minor).

Credentials never appear in responses, audit or step history (tested over HTTP); adapter error messages are passed through, so the SDK should state "never include credentials in `message`/`vendorDetail`".

No real connector makes HTTP calls yet. The SDK should expose `ctx.http` (the safe fetch with a deadline) and the boundary lint should forbid raw `fetch` in connectors.

**(b) Exactly-once and no blind replay.**

Inbound:
- the same revision delivered concurrently: **held** (PROBE-1);
- different revisions of a new record concurrently: **broken** (F5, PROBE-2 and PROBE-7);
- duplicated reprocessing: latent (F21);
- exception dedupe under concurrency aborts the transaction (F11).

Outbound:
- concurrent dispatch is safe (PROBE-4: one send);
- in-flight send vs reconnection: **broken** (F2, PROBE-5);
- disconnect with uncertain money: **wrong** (F4, PROBE-6);
- undeclared operations fail open (F3, PROBE-9).

**(c) Trial orgs never write.** Enforced at five layers:
- compatibility refuses write operations and `forward`;
- validation fails on write scope;
- activation refuses write scope;
- `enqueueOutbound` calls `gateEffect`, which raises `effect_blocked_in_environment`;
- dispatch's `prepareCall('write')` is gated the same way, and webhooks are recorded `blocked`.

These are tested in `environment-safety.test.ts` and `webhooks.test.ts`. Gaps: the vendor `acknowledge` is unclassified (F13), and blocked attempts are not audited (EV-02 asks for an audit record).

**(d) Catalogue honesty.** Passes on the main points:
- no connector above R3;
- planned entries are R1, not connectable, with `unverified` workflows, costs marked "quote required" or dated, and approval `not_started`;
- a disclaimer is attached;
- the file connector is never `live` (`integrationStatusOf`, "File exchange — not a live connection", provenance `file`; tested).

Nits are in F17. The register is stale (F16).

**(e) The 9-step journey against `connection-lifecycle-and-health-spec.md` §2.**

| Step | Status |
|---|---|
| 1 Select | Built. Missing: the "not listed" request form, and the product/version picker (the connection stores no `product_version`). |
| 2 Compatibility | Built, with per-workflow blocking checks and warnings, costs, prerequisites, vendor steps, an `acknowledged` flag and trial blocks. |
| 3 Authorize | API-key entry with a harmless test call, scopes and `readOnlyAtVendor`. Re-authorizing keeps later progress. No OAuth or vendor-ticket tracker (no connector needs one yet). |
| 4 Mappings | Confidence and reasons; financial kinds plus `ratePlan` always need review. Missing kinds are documented. No per-step assignment. |
| 5 Issues | Built. |
| 6 Validation | Partial (F15). |
| 7 Preview | Built: sample-based expected behaviour, impact, authority diff, hashed preview. |
| 8 Activate | Separate ⚑ permission and the latest validation/preview fingerprint (CL-03). There is no approval step and no `awaiting_approval` state (RR-05/CR-10; F9). |
| 9 Monitor | `confirmMonitoring` runs on the first success. |

`abandoned` and the reminders are not built (documented). The state names differ from the spec, and the mapping is documented in the README.

**(f) Event vs handler port.** The handler port is better for "applied means applied". Reasoning and design are in F6.

## Spec coverage summary (`docs/specs/integration.md`)

**Met:** INT-R01 (missing: a PII/card data-category field and a last-verified date), R02 (id drift, F17), R03 (API), R06 (mostly), R08, R10 (partial kinds), R11, R12 (except transition-held records), R13 (affected records not listed), R14, R15, R18, R21 and R22 (usage/charges missing), R24 (API). Invariants I04, I05, I06 and I08 are tested.

**Partial or failing:**

| Item | Gap |
|---|---|
| INT-R05 | XLSX, inbound receiver, guest/unit/balance imports |
| INT-R07 | Scope change on an active connection |
| INT-R09 | Shadow replacement |
| INT-R16 | Concurrency (F5) |
| INT-R17 | Cursors, ranges, nightly reconciliation |
| INT-R19 | F2, F3 |
| INT-R20 | Tax treatment |
| INT-R23 | Notifications, handover |
| INT-R26 | 24 h retry window; SSRF |
| INT-I01 | F5, F21 |
| INT-I02 | F6, F20 |
| INT-I03 | F2, F3 |
| INT-I07 | Acknowledge (F13) |

**Not built (SHOULD):** R25, R27. **Wave 2:** R29–R34.

**Lifecycle acceptance tests:**
- met: CL-02, 03, 04, 06, 07, 09, 10;
- partial: CL-01, 08, 11, 12;
- not built: CL-05, CL-13.

**Source-of-truth acceptance tests:** ST-03 met; ST-08 needs `pendingOperations` (F9).

## Scenario-claim assessment

- **S02** (`scenario-s02-inbound-faults.test.ts`) demonstrates integration's part for sequential deliveries: one stored effect per revision, `stale`, `delayed`, gap → `incomplete` → reconciliation clears it, unknown codes held and re-applied, currency never converted. It does not demonstrate the resulting reservation state (no consumer exists). The README is honest about this. It does not cover concurrent delivery (F5).
- **S20** (`scenario-s20-integration-outage.test.ts`) demonstrates the outage end to end:
  - health degraded → failing/down with `delayed` provenance;
  - impact text and responsible party;
  - risky actions held while interrupted;
  - coalescing of room status;
  - revalidate or cancel by a permitted person;
  - verify-before-resend (CL-07);
  - a final refusal explained.

  It is a genuine sequential scenario. Two caveats: it activates a simulator as the system of record in a *live* org (F8), and its invariant does not hold under the race in F2.
- The journey (`setup-journey.test.ts`) and environment safety tests are credible.

## Cross-module notes for the orchestrator

1. **Platform (identity-plus):** see F9.
   - `setDataAuthority` will reject integration activation for charges, payments, accounting and availability. Decide whether activation goes through the transition protocol or gets an integration-side two-person approval that calls platform as a system actor.
   - Integration must provide `AuthorityTransitionGuard.pendingOperations`.
   - Bind `activeTransition` to `openTransitionFor` (field `status` → `state`).
   - `ActivationScopePort.assertEffectInScope` has no provider yet; `platform.activation_scopes` content needs an effect/workflow shape.
2. **Operations:**
   - It exposes a synchronous `applyExternalRoomStatus(unitId, {condition, dnd, observedAt, connectionId})`, which supports the handler-port decision (F6).
   - It keeps its own `operations.status_forwards` queue and `acknowledgeForward` route. Wire `integration.outbound.acknowledged|rejected|cancelled` with `sourceRef {type:'status_forward'}` to it in the composition root, so there is one "pending in PMS" truth per record.
   - Operations' `observedAt` ordering is a second ordering mechanism. It is fine as defence in depth, but don't rely on it to fix F5.
3. **Shared code candidates:**
   - a safe outbound HTTP client with SSRF protection and deadlines (webhooks, connectors, comms, payments callbacks);
   - a `WorkItemProvider` for "My work" (FR-6);
   - the guarded "claim → external call → conditional finalise" pattern used by `integration.outbound_commands`, webhook deliveries and `payments.provider_operations`. These should share one helper with version-guarded finalisation, which would have prevented F2.
4. **Infra:** add egress controls for the worker (F1d), and decide where simulators live in a multi-process deployment (F7).
5. **FR-1** is resolved on main (`8d58366`); the merge is clean and tests pass. FR-4 (AWS secrets) should adopt post-commit destroy (F22).
