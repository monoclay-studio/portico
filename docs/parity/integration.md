# Parity matrix and edge cases: integration

Module: `integration` (connector catalogue, setup journey, credentials, mappings, exchange, forwarding, health,
exceptions, safe lifecycle, partner webhooks, simulators; wave 2 migration and data export). Spec:
`docs/specs/integration.md` (Draft v1, prefix INT) with `docs/adoption/connection-lifecycle-and-health-spec.md`.
Researched and statused 2026-11-07 by the parity-ops researcher against **`modules/integration` on `main`** (README
checkpoint: wave 1 complete plus steward review fixes F1–F29; no known failing tests).

**Baseline:** OPERA Cloud 26.3 *Exchange / Interfaces* administration (external systems, business events, data value
mappings, exports and scheduled exports, outbound monitoring, property interfaces and interface logs, data import) and
Oracle Hospitality Integration Platform (OHIP: streaming, events, replay, errors). **Modern additions:** Mews
Connector API (authentication, certification, events, deprecations, marketplace), Apaleo (webhooks, OAuth consent and
scopes, API versioning and rate limits, store certification, MCP server), Cloudbeds API webhooks, SiteMinder Exchange
(SMX) and pmsXchange. Our research: R01 §2.4/§2.6 (OHIP), R02 §2.4/§2.8 (Mews), §3.3/§3.6 (Apaleo), R03 §4.3, §6.3,
§9, §11 (SiteMinder, Guesty, channel mechanics, onboarding/migration), R04 A7–A9 (standards, hubs, safe testing),
R05 digest #1–#9, #17, #21–#25 and `05-market-deep-dive/11-one-button-migration.md`. Portico terms in the Capability
column (connection, workflow, mapping, exchange, forwarding, data authority, provenance).

**Status and tests:** paths in the Test column are relative to `modules/integration/` unless they start with `apps/`
or `modules/`. A row is `tested` only when a test on `main` **asserts** the row (parity playbook v2, PR2-1): the Test cell quotes
each asserting line as `file:line` with what it proves. `building` = part of the row is asserted and the "partial:"
note says what is missing (also used where the proof runs only against a fake provider, pattern AP-51); `built` =
implemented without an asserting test. All connectors are at most
readiness R3: only the PMS simulator, CSV files and outbound webhooks are built; no vendor sandbox (R4) has been used.
**Evidence:** a source marked "search-located" under *Sources* was found by web search but its host blocks direct
fetches from this environment — facts resting only on it are unverified. Priorities: P0 compete/pilot, P1
full-service/resort/group expectation, P2 differentiator or rare.

## Capabilities

### 1. Catalogue and connector definitions

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-INT-001 | Connector catalogue that shows, per system and per workflow, what Portico can read, write and receive as changes, with technical readiness and external approval as separate columns | SiteMinder [SMX: certified PMS/app pairs][sm-smx] · Apaleo [store certification][apaleo-store] · Mews [marketplace size (press)][mews-mkt] · verified 2026-11-07 (SiteMinder, Mews search-located, unverified) | P0 | tested | integration.md INT-R01–R03 | src/connectors/registry.test.ts:30 (no connector above R3); test/setup-journey.test.ts:325 (planned workflows unverified); test/setup-journey.test.ts:329 (no certification implied) |
| PAR-INT-002 | Unsupported operations explicit (read-only PMS, missing workflow) and refused at compatibility review with the reason | OPERA [external systems configuration][op-extsys] · R02 §2.8 (Mews: unclear partner capability) · verified 2026-11-07 | P0 | tested | integration.md INT-R04 | test/setup-journey.test.ts:48 (unsupported workflow refused at compatibility); test/environment-safety.test.ts:34 (write workflows refused in trial) |
| PAR-INT-003 | Costs, prerequisites, vendor-side steps and support contact shown before connecting (dated, or "quote required") | Mews [certification and partner costs][mews-cert] · R05 digest #5–#6 (OHIP Data API SKU, per-call cost) · verified 2026-11-07 | P1 | built | integration.md INT-R01 | — `ConnectorDefinition` carries costs and steps; no test asserts their display |
| PAR-INT-004 | Vendor notices (API deprecations, certificate or contract deadlines) tracked per connection and escalated as the deadline nears | Mews [Connector API deprecations][mews-deprec] · Apaleo [API versioning][apaleo-versioning] · R05 digest #18 · verified 2026-11-07 | P1 | tested | integration.md INT-R21 | src/domain/health-webhooks.test.ts:187 (urgent within a week) |
| PAR-INT-005 | Connector SDK that partners can use to build and certify their own connectors | Mews [certification][mews-cert] · Apaleo [store certification][apaleo-store] · verified 2026-11-07 | P2 | building | integration.md INT-R01 (internal SDK) | src/connectors/registry.test.ts — partial: SDK is internal; no partner-facing build/certify path |

### 2. Setup journey

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-INT-006 | Guided, resumable setup journey (select → compatibility → authorize → mappings → issues → validation → preview → activate → monitor) with who and when per step | R03 §11 (onboarding by project manager), R05 digest #35 (multi-year chain rollouts) · OPERA [external systems][op-extsys] · verified 2026-11-07 | P0 | tested | integration.md INT-R06 | test/setup-journey.test.ts:272 (every step with actor and time); src/domain/setup-journey.test.ts:38 (steps can be repeated (resumable)) |
| PAR-INT-007 | Setup steps assigned to named people (IT, revenue, finance) with reminders; idle setups flagged as abandoned | assumption (adoption lifecycle spec §2.3) | P1 | specified | integration.md INT-R06; connection-lifecycle-and-health-spec.md §2.3 | — |
| PAR-INT-008 | Scope stored as data and reviewed per workflow before credentials are entered | Apaleo [OAuth scopes][apaleo-scopes] · R05 digest #4 (OHIP module-level scopes) · verified 2026-11-07 | P0 | tested | integration.md INT-R07 | test/setup-journey.test.ts:54 (per-workflow compatibility report); test/setup-journey.test.ts:53 (scope reviewed before authorization) |
| PAR-INT-009 | Validation run against the real system (sample reads, no-effect calls) required before activation; any later mapping change invalidates it | OPERA [synchronizing business events][op-syncbe] · verified 2026-11-07 | P0 | tested | integration.md INT-R06 | test/setup-journey.test.ts:176 (validation run); test/setup-journey.test.ts:212 (activation blocked without current validation); src/domain/setup-journey.test.ts:67 (mapping change invalidates validation) |
| PAR-INT-010 | Validation depth: counts, round-trip check, financial recompute, timing, named acknowledgement of warnings | assumption (R05 digest #24: duplicated revenue after a CRS–PMS switch) | P1 | building | integration.md INT-R06 step 6 | test/setup-journey.test.ts — partial: count, round-trip, financial recompute and timing checks not built (README F15) |
| PAR-INT-011 | Activation preview: workflows that start, data-authority domains that move, what staff will see | R02 §3.6 (Apaleo self-serve connect) · assumption for preview depth | P0 | tested | integration.md INT-R06 step 7; ADR-0014 | test/setup-journey.test.ts:184 (authority changes previewed); test/setup-journey.test.ts:192 (impact summary) |
| PAR-INT-012 | Second approval before a connection takes over money or availability (charges, payments, accounting, availability) | assumption (separation of duties; R04 B7 correctness) | P0 | tested | integration.md INT-R06, F9; platform.md | test/authority.test.ts:24 (charges need a second approval); test/authority.test.ts:31 (transition planned, not applied) |
| PAR-INT-013 | Scope change on an active connection re-runs the affected validation and preview steps | assumption | P1 | specified | integration.md INT-R07 | — (README F15: not built) |

### 3. Credentials

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-INT-014 | Credentials envelope-encrypted, never returned after entry, never in logs, audit, events or AI context | Mews [Connector API authentication][mews-auth] · OPERA [interface users][op-ifcusers] · verified 2026-11-07 | P0 | tested | integration.md INT-R08, INT-I06 | test/setup-journey.test.ts:84 (encrypted); test/setup-journey.test.ts:88 (not in audit); apps/api/test/integration.test.ts:183 (never returned) |
| PAR-INT-015 | Expiry tracked with reminders (30/7/1 days), suspension at expiry and recovery by rotation without losing mappings | assumption (R05 digest #3: OHIP streaming reconnect ≤ 24 h) | P0 | tested | integration.md INT-R08 | test/credentials.test.ts:54 (routine reminder); test/credentials.test.ts:59 (urgent near expiry); test/credentials.test.ts:84 (suspended at expiry); test/credentials.test.ts:119 (recovered by rotation) |
| PAR-INT-016 | Zero-downtime rotation; a failed rotation changes nothing | Apaleo [OAuth consent and scopes][apaleo-consent] · assumption | P1 | tested | integration.md INT-R08, INT-R09 | test/credentials.test.ts:146 (zero-downtime preview); test/credentials.test.ts:152 (still monitoring after rotation); test/credentials.test.ts:109 (bad rotation changes nothing) |
| PAR-INT-017 | Vendor-side scopes recorded; a write-capable credential in a trial is labelled and every write blocked | R05 digest #4 (OPERA chain admin approves each connection, separate Sensitive Data Access) | P0 | tested | integration.md INT-I07 | test/environment-safety.test.ts:48 (write-capable credential labelled); test/environment-safety.test.ts:63 (every write blocked); test/environment-safety.test.ts:93 (vendor scopes recorded) |

### 4. Mappings

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-INT-018 | Mapping suggestions with confidence and reasons for property, unit type, unit, rate plan, outlet, charge code, tax rule, ledger account and status | OPERA [data value mappings][op-dvm] · R03 §4.3 (SiteMinder mapping completeness counters) · verified 2026-11-07 | P0 | tested | integration.md INT-R10 | src/domain/mapping-suggest.test.ts:49 (confidence and reasons); test/setup-journey.test.ts:95 (unit type); test/setup-journey.test.ts:97 (status); test/setup-journey.test.ts:105 (charge code) |
| PAR-INT-019 | Mappings for payment method, market segment, source, department and staff user | OPERA [data value mappings][op-dvm] · verified 2026-11-07 | P0 | specified | integration.md INT-R10 | — (README: not yet built) |
| PAR-INT-020 | Financially significant mappings (charge code, tax rule, ledger account, payment method) always need a person with finance review permission | assumption (R01 §3.7 transaction codes drive ledgers) | P0 | tested | integration.md INT-R11, INT-I05 | src/domain/mapping-suggest.test.ts:75 (always needs review); test/setup-journey.test.ts:144 (reviewer without finance permission refused) |
| PAR-INT-021 | Exact non-financial matches confirmed automatically with an explanation; ambiguous or low-confidence ones queued for review; never guessed | R03 §9.2 (wrong mappings cause overbookings) | P0 | tested | integration.md INT-R11 | src/domain/mapping-suggest.test.ts:48 (exact non-financial auto-confirmed); src/domain/mapping-suggest.test.ts:60 (ambiguous queued); src/domain/mapping-suggest.test.ts:83 (never guessed) |
| PAR-INT-022 | Many-to-one status mappings (several external codes mean "dirty") | OPERA [synchronizing room status][op-syncrs] · verified 2026-11-07 | P1 | tested | integration.md INT-R10 | src/domain/mapping-suggest.test.ts:110 (many-to-one statuses) |
| PAR-INT-023 | Mapping versions with audit; a change lists the records it already affected | OPERA [data value mappings][op-dvm] · verified 2026-11-07 | P1 | building | integration.md INT-R13 | src/domain/setup-journey.test.ts (change invalidates validation) — partial: "affected records" listing not built |
| PAR-INT-024 | Mapping suggestion accuracy measured per connection (accepted unchanged) | assumption (spec §3.9 target ≥ 80%) | P2 | built | integration.md INT-R14 | — `summary.suggestionAccuracy`; no test |
| PAR-INT-025 | Records with unmapped references held (never dropped), one exception raised, applied once the mapping exists | R03 §4.3 (SiteMinder manual queue for unmapped bookings) | P0 | tested | integration.md INT-R12, INT-I02 | test/scenario-s02-inbound-faults.test.ts:193 (held); test/scenario-s02-inbound-faults.test.ts:198 (one exception); test/scenario-s02-inbound-faults.test.ts:217 (applied once mapped) |

### 5. Exchange, ordering and forwarding

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-INT-026 | Exchange log per message (workflow, direction, external ref and revision, outcome, retries); payloads only for technical permission | OPERA [outbound monitoring][op-outmon] · [property interface logs][op-ifclogs] · verified 2026-11-07 | P0 | tested | integration.md INT-R15 | test/isolation-permissions.test.ts:187 (staff see plain English); test/isolation-permissions.test.ts:196 (technical detail with permission); test/scenario-s02-inbound-faults.test.ts:71 (exchange log outcomes) |
| PAR-INT-027 | Inbound exactly once and in order: duplicates acknowledged and logged, older revisions stored as stale, also under concurrency | OHIP [streaming FAQ][ohip-faq] · R03 §9.2 (out-of-order OTA revisions) · verified 2026-11-07 | P0 | tested | integration.md INT-R16, INT-I01 | test/scenario-s02-inbound-faults.test.ts:50 (duplicates once); test/scenario-s02-inbound-faults.test.ts:117 (stale not applied); test/concurrency.test.ts:102 (concurrent (Promise.all): newer wins) |
| PAR-INT-028 | Revision gaps detected; data labelled `incomplete` until a reconciliation run | OHIP [streaming FAQ][ohip-faq] · verified 2026-11-07 | P0 | tested | integration.md INT-R16, INT-R22 | test/scenario-s02-inbound-faults.test.ts:166 (incomplete); test/scenario-s02-inbound-faults.test.ts:181 (cleared by reconciliation) |
| PAR-INT-029 | Recovery after an outage: "re-request since T" and nightly full-window reconciliation, none duplicated | OHIP [replay][ohip-faq] · R03 §4.3 (SiteMinder resend/flush tools) · verified 2026-11-07 | P0 | building | integration.md INT-R17 (E03) | test/jobs.test.ts (periodic syncs) — partial: vendor cursors and nightly full-window reconciliation not built |
| PAR-INT-030 | Sync runs (periodic, manual, file, reconciliation) with counts and manual trigger | OPERA [synchronizing business events][op-syncbe] · verified 2026-11-07 | P0 | tested | integration.md INT-R17 | test/jobs.test.ts:37 (periodic run); test/scenario-s02-inbound-faults.test.ts:174 (reconciliation run); test/credentials.test.ts:136 (manual run) |
| PAR-INT-031 | Owning module applies inbound records in the same transaction; the vendor is acknowledged only after commit; rejections become exceptions | R03 §4 (SiteMinder: acknowledge only after commit) | P0 | building | integration.md INT-R16, §6 (handler port) | test/concurrency.test.ts "reject, hold and throw are recorded as integration exceptions" — partial: no owning module binds a handler yet (records stored as `accepted`) |
| PAR-INT-032 | Forwarding changes to the external system of record with a business idempotency key; outcomes acknowledged, rejected or unknown | OPERA [business events][op-busevents] · Mews [Connector API events][mews-events] · verified 2026-11-07 | P0 | tested | integration.md INT-R18, INT-I03 | test/scenario-s20-integration-outage.test.ts:55 (same key, one command); test/scenario-s20-integration-outage.test.ts:143 (acknowledged); test/scenario-s20-integration-outage.test.ts:261 (rejected) |
| PAR-INT-033 | No blind replay: after an outage, pause or reconnection, money and inventory commands wait for a person to revalidate | R03 §6.3 (Guesty resync incidents) · R01 §2.6 · assumption for revalidation | P0 | tested | integration.md INT-R19, INT-I03 | test/scenario-s20-integration-outage.test.ts:139 (held for a person on recovery); test/concurrency.test.ts:371 (in-flight send across pause + resume) |
| PAR-INT-034 | Unknown outcome (timeout) verified with the vendor by idempotency key before any resend | R04 B7 (idempotency for payment APIs) | P0 | tested | integration.md INT-R18 | test/scenario-s20-integration-outage.test.ts:236 (verified, not resent); test/scenario-s20-integration-outage.test.ts:220 (one charge at the vendor) |
| PAR-INT-035 | Queued state-setting commands coalesced to the newest per record | R03 §9.1 (ARI coalescing) | P1 | tested | integration.md INT-R19 | src/domain/exchange-rules.test.ts:223 (newest per record kept) |
| PAR-INT-036 | Backoff schedule and circuit breaker; an outage stops the batch (no retry storm) | OHIP [errors][ohip-errors] · verified 2026-11-07 | P0 | tested | integration.md INT-R18, INT-R21 | src/domain/exchange-rules.test.ts:178 (backoff schedule); src/domain/health-webhooks.test.ts:79 (circuit breaker); test/scenario-s20-integration-outage.test.ts:87 (outage stops the run) |
| PAR-INT-037 | Translation layer: identifiers, currencies never converted, UTC + property zone, business dates from the source, tax inclusive/exclusive declared per workflow | OPERA [data value mappings][op-dvm] · verified 2026-11-07 | P0 | building | integration.md INT-R20 | test/scenario-s02-inbound-faults.test.ts "amounts in another currency are held, never converted" — partial: tax-treatment declaration not built |
| PAR-INT-038 | Vendor rate limits respected (e.g. OHIP 50 rps per gateway shared by all the hotel's integrations), with a per-tenant time budget per scheduler tick | R05 digest #3 · Apaleo [rate limiting][apaleo-ratelimit] · verified 2026-11-07 | P1 | missing | — (README: no per-tenant budget) | — |
| PAR-INT-039 | Asynchronous bulk extraction jobs for large windows (OHIP async: 94-day windows, 30-minute spacing, 1,000-record sync cap) | R05 digest #2 | P1 | missing | — (INT-R29/R30 do not name it) | — |

### 6. Health, provenance and exceptions

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-INT-040 | Health per connection and per workflow against a freshness target: healthy, delayed, degraded, failing, paused | OPERA [property and fiscal interface monitoring][op-ifcmon] · R03 §9.3 (distribution health console) · verified 2026-11-07 | P0 | tested | integration.md INT-R21, INT-I08 | src/domain/health-webhooks.test.ts:69 (delayed beyond T); src/domain/health-webhooks.test.ts:71 (failing beyond 3T); test/scenario-s20-integration-outage.test.ts:122 (down in the outage) |
| PAR-INT-041 | Provenance on data (`external` with last sync, `delayed` with age, `incomplete`, `simulated`) | assumption (vision: honest readiness; no competitor documents it) | P0 | tested | integration.md INT-R22; CLAUDE.md §4.16 | src/domain/health-webhooks.test.ts:112 (delayed with age); src/domain/health-webhooks.test.ts:118 (incomplete); test/environment-safety.test.ts:101 (simulated) |
| PAR-INT-042 | Exceptions in plain language: problem, business impact, responsible party, next step; deduplicated; owned by a person or department; in "My work" | OPERA [outbound monitoring][op-outmon] · verified 2026-11-07 | P0 | tested | integration.md INT-R23 | test/scenario-s02-inbound-faults.test.ts:199 (deduplicated, responsible party); test/scenario-s02-inbound-faults.test.ts:201 (next step); test/isolation-permissions.test.ts:223 (department owner in My work) |
| PAR-INT-043 | Staff notified of urgent integration exceptions (push/email to the owner) | assumption | P1 | specified | integration.md INT-R23 | — (README: notifications not built) |
| PAR-INT-044 | Impact statement per hotel function when a connection degrades ("check-ins at Kandu cannot read arrivals") | assumption | P0 | tested | integration.md INT-R21 | src/domain/exchange-rules.test.ts:267 (effect per hotel function); test/scenario-s20-integration-outage.test.ts:98 (impact names properties) |
| PAR-INT-045 | Property and portfolio integration views with urgent band above routine items | R03 §9.3 · assumption for portfolio | P1 | building | integration.md INT-R24 | src/domain/health-webhooks.test.ts (urgent vs routine) — partial: API only, no screens |

### 7. Safe lifecycle

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-INT-046 | Pause and resume with impact preview; resume treated as a reconnection under the no-replay rules | assumption (adoption brief §9) | P0 | tested | integration.md INT-R09 | test/scenario-s20-integration-outage.test.ts:277 (impact previewed); test/scenario-s20-integration-outage.test.ts:296 (paused holds work); test/scenario-s20-integration-outage.test.ts:305 (resume = reconnection rules) |
| PAR-INT-047 | Disconnect refused while the connection is a system of record; uncertain actions kept pending verification | assumption | P0 | tested | integration.md INT-R09, INT-I04 | test/setup-journey.test.ts:296 (disconnect refused while system of record); test/concurrency.test.ts:416 (uncertain kept pending) |
| PAR-INT-048 | Replace a connection (vendor swap) with shadow comparison before cut-over | R03 §11 (shadow-mode connections) | P1 | building | integration.md INT-R09 | — `replace` built — partial: no shadow comparison (README F15) |
| PAR-INT-049 | Change of system of record per domain as a planned transition; records received during the freeze applied after it | assumption (ADR-0014) | P0 | tested | integration.md INT-R06, F9/F15 | test/authority.test.ts:122 (held during the switch); test/authority.test.ts:140 (applied once after the switch) |
| PAR-INT-050 | One domain never governed by two connections | assumption | P0 | tested | integration.md INT-I04 | test/setup-journey.test.ts:310 (second connection refused) |

### 8. Webhooks, public API and partners

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-INT-051 | Self-serve webhook subscriptions with event-type wildcards and property filters | Apaleo [webhooks][apaleo-webhooks] · Cloudbeds [webhooks API][cb-webhooks] · OPERA [business events][op-busevents] · R02 §2.8 (Mews support-gated) · verified 2026-11-07 (Cloudbeds search-located, unverified) | P0 | tested | integration.md INT-R26 | test/webhooks.test.ts:61 (pattern and property filter delivery); test/webhooks.test.ts:64 (event type); src/domain/health-webhooks.test.ts:247 (wildcards) |
| PAR-INT-052 | Thin signed events (HMAC with timestamp), secret rotation with an overlap where both secrets verify | Apaleo [webhooks][apaleo-webhooks] · verified 2026-11-07 | P0 | tested | integration.md INT-R26 | test/webhooks.test.ts:65 (thin event); src/domain/health-webhooks.test.ts:229 (both secrets verify during rotation) |
| PAR-INT-053 | Delivery retries with backoff (~26 h), dead state, endpoint auto-disable, delivery log | OHIP [events][ohip-events] · verified 2026-11-07 | P0 | tested | integration.md INT-R26 | test/webhooks.test.ts:113 (10 attempts then dead); test/webhooks.test.ts:120 (endpoint auto-disabled); test/webhooks.test.ts:78 (delivery log) |
| PAR-INT-054 | Replay of a delivery or a time range (up to 7 days) | OHIP [7-day replay][ohip-faq] · verified 2026-11-07 | P1 | tested | integration.md INT-R26 | test/webhooks.test.ts:134 (single replay); test/webhooks.test.ts:148 (range replay) |
| PAR-INT-055 | Public event catalogue covering bookings, stays, folios, payments, profiles, tasks, work orders and inventory | OPERA [business events][op-busevents] · Mews [events][mews-events] · verified 2026-11-07 | P1 | building | integration.md INT-R26 | src/domain/health-webhooks.test.ts (event patterns and the public catalogue) — partial: 11 public types; no payments, profiles, tasks or work orders |
| PAR-INT-056 | Outbound calls safe against SSRF (public https only, pinned DNS, no redirects) | assumption (security baseline) | P0 | tested | integration.md INT-R26 (F1) | src/net/address-policy.test.ts:126 (zero connections to blocked destinations); src/net/address-policy.test.ts:39 (blocked ranges) |
| PAR-INT-057 | Versioned public REST API (`/v1`) with OpenAPI generated from contracts | Apaleo [API versioning][apaleo-versioning] · Mews [Connector API auth][mews-auth] · verified 2026-11-07 | P0 | tested | CLAUDE.md §4.10 | apps/api/test/api.test.ts:47 (OpenAPI served); apps/api/test/integration.test.ts:91 (integration routes in OpenAPI) |
| PAR-INT-058 | Published rate limits, deprecation policy and changelog for the public API | Apaleo [rate limiting][apaleo-ratelimit] · Mews [deprecations][mews-deprec] · R05 digest #18 · verified 2026-11-07 | P1 | missing | — | — |
| PAR-INT-059 | Partner apps: registration, scopes as permission keys, per-organization consent screen, revocation | Apaleo [consent screen][apaleo-consent] · [scopes][apaleo-scopes] · R05 digest #4 (OPERA chain-admin approval) · verified 2026-11-07 | P1 | specified | integration.md INT-R27; identity.md IDN-R17 | — (not built) |
| PAR-INT-060 | Partner sandbox, certification path and test data | Mews [certification][mews-cert] · Apaleo [store certification][apaleo-store] · SiteMinder [SMX certification][sm-smx] · verified 2026-11-07 (SiteMinder search-located, unverified) | P1 | missing | — (environments exist; no partner programme) | — |
| PAR-INT-061 | App marketplace listing for partners | Mews [1,000+ marketplace integrations (press)][mews-mkt] · Apaleo [store][apaleo-store] · Cloudbeds [API and marketplace][cb-webhooks] · verified 2026-11-07 (Mews, Cloudbeds search-located, unverified) | P2 | missing | — | — |
| PAR-INT-062 | Durable event stream with replay for high-volume partners | OHIP [streaming API][ohip-stream] · verified 2026-11-07 | P2 | deferred | integration.md INT-R28 [LATER] | — |
| PAR-INT-063 | AI agent access (MCP server) mirroring public API scopes, dry-run for money tools | Apaleo [AI integrations / MCP][apaleo-ai] · [first PMS MCP server (press)][apaleo-mcp] · R05 digest #21 · verified 2026-11-07 (Apaleo search-located, unverified) | P2 | deferred | integration.md INT-R28 [LATER]; ai.md | — |
| PAR-INT-064 | Bulk export API (async, JSONL, incremental windows, ledger entries) for analytics and exit | R05 digest #17 (Mews Exports API) · OPERA [exports][op-exports] · verified 2026-11-07 | P1 | specified | integration.md INT-R34 (wave 2) | — |
| PAR-INT-065 | Channel and app hub connectivity (SMX / pmsXchange style) on the same framework | SiteMinder [SMX][sm-smx] · [pmsXchange][sm-pmsx] · search-located 2026-11-07, unverified | P1 | specified | integration.md §2 (distribution builds on it); distribution.md | — |

### 9. Files, on-site systems and legacy interfaces

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-INT-066 | CSV import and export (reservations, room status, accounting journals), idempotent, formula-injection safe; exports labelled `exported`, never "synced" | OPERA [exports][op-exports] · verified 2026-11-07 | P0 | tested | integration.md INT-R05 | test/file-csv.test.ts:128 (idempotent re-import); test/file-csv.test.ts:190 (formula neutralised); test/file-csv.test.ts:192 (exported, never synced) |
| PAR-INT-067 | XLSX import and an inbound HTTP receiver for systems that push | assumption | P1 | specified | integration.md INT-R05 | — (README: not built) |
| PAR-INT-068 | Scheduled exports to SFTP/HTTPS (e.g. at Day Close) with delivery status | OPERA [scheduled exports][op-schedexport] · R05 digest #8 (OPERA 5 file exports) · verified 2026-11-07 | P1 | missing | — | — |
| PAR-INT-069 | On-site connector agent for systems that cannot reach the cloud (on-prem PMS, lock servers, POS) with heartbeat and version | OPERA [property interface control][op-pic] · verified 2026-11-07 | P1 | specified | integration.md INT-R25 [SHOULD] | — |
| PAR-INT-070 | Legacy hotel-interface protocols (FIAS-style link for locks, PBX, Wi-Fi, minibar) through the on-site agent | OPERA [property interfaces][op-pifc] · journey coverage §1.4 (Wi-Fi gateways sync room + last name over FIAS) · verified 2026-11-07 | P1 | missing | — (INT-R25 names no protocol) | — |
| PAR-INT-071 | Property configuration export and copy (configuration shell) for multi-property rollout | OPERA [configuration shells][op-cfgshell] · verified 2026-11-07 | P2 | missing | — (platform PLT-R41 covers guided setup) | — |

### 10. Simulators and environment safety

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-INT-072 | PMS simulator with realistic data and fault injection (delay, duplicates, reordering, outage, credential expiry, timeout, refusal, read-only keys) | R04 A9 (building safely without partner access) | P0 | tested | integration.md INT-R05 | test/scenario-s02-inbound-faults.test.ts:59 (duplicates and reordering); test/scenario-s20-integration-outage.test.ts:224 (timeout); test/credentials.test.ts:84 (credential expiry) |
| PAR-INT-073 | Trial connections read-only: write workflows refused, forwarding blocked, partner webhooks recorded as blocked | assumption (adoption brief staged evaluation) | P0 | tested | integration.md INT-I07 | test/environment-safety.test.ts:63 (no writes from a trial); test/webhooks.test.ts:246 (partner webhook blocked) |
| PAR-INT-074 | Simulators never used in live organizations; demo exchanges labelled simulated | assumption | P0 | tested | integration.md INT-R05, INT-I07 | apps/api/test/integration.test.ts:70 (live org refuses simulator); test/environment-safety.test.ts:109 (never a system of record in live) |

### 11. Migration and exit (wave 2)

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-INT-075 | Source assessment: what the old system can export (legally, technically), access route, estimated effort and cost | R05 digest #1, #6–#9; 05-market-deep-dive/11 §3 | P0 | specified | integration.md INT-R29 | — |
| PAR-INT-076 | Import pipeline: upload/connect → preview → mapping → quality report → trial import → reconciliation → acceptance | OPERA [data import][op-dataimport] · R03 §3.5 (Cloudbeds paid, partial import) · verified 2026-11-07 | P0 | specified | integration.md INT-R30 | — |
| PAR-INT-077 | Every reservation status imported (cancelled, no-show, checked-out) for history and statistics | R05 digest #22 (Cloudbeds excludes cancelled/no-show) | P1 | missing | — (INT-R30/R31 do not say "every status") | — |
| PAR-INT-078 | Unsupported or ambiguous financial data never silently discarded or converted | R05 digest #24 (duplicated revenue after a switch) | P0 | specified | integration.md INT-R31 | — |
| PAR-INT-079 | Opening balances through migration suspense accounts with a reconciliation report that sums exactly | OPERA [data import: ledgers][op-dataimport] · verified 2026-11-07 | P0 | specified | integration.md INT-R32, INT-I09 | — |
| PAR-INT-080 | Cutover plan with per-domain authority switch times, final capture, rollback with post-cutover export | R05 digest #7 (OXI initial cutover resync order) | P0 | specified | integration.md INT-R33 | — |
| PAR-INT-081 | Duplicate profiles scored and reviewed before import ("archive, don't import" stale profiles) | R05 digest §2 (guests row) | P1 | specified | integration.md INT-R30; guests.md GUE-R10 | — |
| PAR-INT-082 | Complete organization data export (exit) in documented formats, per-profile export for privacy | R05 digest #23 (Little Hotelier 365-day export limit) · R03 §3.5 (access ends at deactivation) | P1 | specified | integration.md INT-R34 | — |
| PAR-INT-083 | Migration and history archive included (not a paid add-on); usage costs of source APIs shown before incurred | R05 digest #22, §2 billing row (Cloudbeds import paid; Oracle archive sold separately) | P2 | missing | — (commercial: owner question Q143) | — |

### 12. Permissions, privacy and search

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-INT-084 | Granular permissions: manage, activate (separate), credentials, mapping review, financial review, technical read, webhooks, simulator | OPERA [interface users][op-ifcusers] · verified 2026-11-07 | P0 | tested | integration.md §8 | test/setup-journey.test.ts:242 (activate separate from manage); test/isolation-permissions.test.ts:85 (manage scoped by property); test/webhooks.test.ts:223 (webhook permission) |
| PAR-INT-085 | Multi-property connections: readers of one property see only that property's rows | assumption | P0 | tested | integration.md §8 (F12) | test/isolation-permissions.test.ts:157 (reader of one property sees its rows); test/isolation-permissions.test.ts:161 (exceptions filtered) |
| PAR-INT-086 | Personal data in payloads redacted after settlement; per-guest erasure reaches integration payloads | R04 C1 (GDPR) | P1 | building | integration.md §3.8 | test/retention.test.ts (inbound payloads and files) — partial: outbound payloads not redacted; no per-guest erasure path |
| PAR-INT-087 | Global search and record contract for connections and open exceptions | assumption | P1 | built | domain-map § Universal record contract | — `integrationSearch` built; no test |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-INT-001 | The PMS sends the same reservation twice, then a modification and a cancellation | Exactly one effect per revision; duplicates acknowledged and logged as `duplicate` (S02) | P0 | tested | test/scenario-s02-inbound-faults.test.ts:50 (one effect per revision); test/scenario-s02-inbound-faults.test.ts:67 (applied events) |
| EC-INT-002 | An older revision arrives after a newer one | Stored as `stale`, never applied; the exchange log shows both | P0 | tested | test/scenario-s02-inbound-faults.test.ts:117 (stale); test/scenario-s02-inbound-faults.test.ts:122 (only newer applied) |
| EC-INT-003 | Older and newer revisions of a brand-new record are ingested concurrently | The newer one wins regardless of commit order (guarded watermark) | P0 | tested | test/concurrency.test.ts:103 (concurrent ingestion (Promise.all)) |
| EC-INT-004 | Two staff click "re-process held records" at the same moment | Each held record applied exactly once | P0 | tested | test/concurrency.test.ts:145 (applied once under concurrent reprocessing) |
| EC-INT-005 | A reservation arrives for a room type nobody mapped | Held, one exception for the mapping owner, applied automatically once mapped; never guessed | P0 | tested | test/scenario-s02-inbound-faults.test.ts:198 (one exception); test/scenario-s02-inbound-faults.test.ts:217 (applied once mapped) |
| EC-INT-006 | Inbound amounts are in EUR for a USD property | Held with an exception; never converted silently | P0 | tested | test/scenario-s02-inbound-faults.test.ts:237 (held, never converted) |
| EC-INT-007 | Messages arrive later than the freshness target (island link slow) | Data labelled `delayed` with its age, even right after a sync | P0 | tested | test/scenario-s02-inbound-faults.test.ts:145 (labelled delayed); src/domain/health-webhooks.test.ts:82 (late messages → delayed) |
| EC-INT-008 | Revision 7 never arrives but 8 does (sequential source) | Data labelled `incomplete` until a reconciliation run fills the gap | P0 | tested | test/scenario-s02-inbound-faults.test.ts:158 (gap detected); test/scenario-s02-inbound-faults.test.ts:181 (cleared by reconciliation) |
| EC-INT-009 | Vendor outage during the morning check-out rush (S20) | Health degraded → down with impact text; money and inventory actions held; state commands coalesced; nothing replayed blindly on recovery | P0 | tested | test/scenario-s20-integration-outage.test.ts:98 (impact text); test/scenario-s20-integration-outage.test.ts:122 (degraded → down); test/scenario-s20-integration-outage.test.ts:139 (no blind replay) |
| EC-INT-010 | A room charge is sent, the call times out | Outcome `pending verification`; vendor asked by idempotency key before any resend; no double charge (CL-07) | P0 | tested | test/scenario-s20-integration-outage.test.ts:236 (verified before resend); test/scenario-s20-integration-outage.test.ts:220 (one charge) |
| EC-INT-011 | The PMS refuses a forwarded charge | `rejected` is final; urgent exception "NOT on the guest's bill" with next step | P0 | tested | test/scenario-s20-integration-outage.test.ts:262 (final and explained) |
| EC-INT-012 | A manager pauses and resumes while a charge is in flight | The send completes or is held; it cannot escape revalidation on resume | P0 | tested | test/concurrency.test.ts:371 (held for revalidation); test/concurrency.test.ts:366 (deadline shorter than lease) |
| EC-INT-013 | Disconnect requested while a charge's outcome is uncertain | Charge stays `pending verification` with an urgent `uncertain_after_disconnect` exception; a person confirms applied or cancels | P0 | tested | test/concurrency.test.ts:416 (kept pending); test/concurrency.test.ts:427 (urgent exception) |
| EC-INT-014 | Two workers dispatch the outbound queue at the same moment | A money command is sent once | P0 | tested | test/concurrency.test.ts:315 (two concurrent dispatches (Promise.all) send once) |
| EC-INT-015 | A credential expires in 30, 7 and 1 days, then expires | Routine then urgent reminders; suspended at expiry; rotation recovers without losing mappings | P0 | tested | test/credentials.test.ts:59 (routine then urgent); test/credentials.test.ts:84 (suspended); test/credentials.test.ts:119 (recovered by rotation) |
| EC-INT-016 | The hotel revokes Portico's access at the vendor (E04) | One urgent exception (no retry storm); affected workflows stop; re-authorization resumes with mappings intact | P0 | tested | test/credentials.test.ts:92 (one urgent exception); test/credentials.test.ts:94 (next step) |
| EC-INT-017 | Credentials rotated while healthy; a rotation attempt fails | Zero downtime; a failed rotation changes nothing | P1 | tested | test/credentials.test.ts:146 (zero downtime); test/credentials.test.ts:109 (failed rotation changes nothing) |
| EC-INT-018 | A second connection tries to govern reservations already governed by another | Refused with the name of the governing connection | P0 | tested | test/setup-journey.test.ts:310 (takeover refused) |
| EC-INT-019 | Activation would move charges to the external PMS | A platform authority transition is planned and needs a second manager; nothing half-activated if transitions are unavailable | P0 | tested | test/authority.test.ts:30 (transition planned); test/authority.test.ts:76 (nothing half-activated) |
| EC-INT-020 | Records arrive while the system of record is being switched | Held during the freeze and applied after the platform reports the switch | P0 | tested | test/authority.test.ts:122 (held during freeze); test/authority.test.ts:140 (applied after the switch) |
| EC-INT-021 | A trial organization tries a write workflow, forwarding or a partner webhook | Refused at compatibility; outbound blocked by environment policy; webhooks recorded as `blocked` | P0 | tested | test/environment-safety.test.ts:34 (write workflow refused); test/webhooks.test.ts:246 (webhook blocked) |
| EC-INT-022 | Someone tries to make the PMS simulator the system of record in a live organization | Refused (`simulator_not_in_live`) | P0 | tested | apps/api/test/integration.test.ts:70 (refused over HTTP) |
| EC-INT-023 | A partner endpoint fails for a day | Retries ≈ 25.9 h, then dead; endpoint auto-disabled; deliveries replayable later | P0 | tested | test/webhooks.test.ts:113 (retries then dead); src/domain/health-webhooks.test.ts:236 (schedule spans about a day); test/webhooks.test.ts:134 (replayable) |
| EC-INT-024 | A webhook URL resolves to a private or metadata address (DNS rebinding, IPv4-mapped IPv6, trailing dot) | Zero connections; refused at subscription and at send | P0 | tested | src/net/address-policy.test.ts:126 (zero connections) |
| EC-INT-025 | Webhook secret rotated while deliveries are in flight | Both secrets verify during the overlap; partners never see a signature gap | P1 | tested | src/domain/health-webhooks.test.ts:228 (both secrets verify); test/webhooks.test.ts:173 (overlap window) |
| EC-INT-026 | A captured webhook is replayed 10 minutes later by an attacker | Signature check rejects timestamps older than 300 s; partners dedupe by event id | P1 | tested | src/domain/health-webhooks.test.ts:215 (old timestamp rejected) |
| EC-INT-027 | The same problem is raised concurrently by two workers | One exception row with two occurrences | P1 | tested | test/concurrency.test.ts:271 (one row, two occurrences (Promise.allSettled)) |
| EC-INT-028 | The owning module rejects, holds or throws on an inbound record | Integration exception raised; record kept; never acknowledged as applied | P0 | tested | test/concurrency.test.ts:476 (reject); test/concurrency.test.ts:478 (throw); test/concurrency.test.ts:483 (exceptions raised) |
| EC-INT-029 | A connection covers two properties; a manager of one reads exceptions | Sees only rows of their property; rows with no property only for readers of every property | P0 | tested | test/isolation-permissions.test.ts:157 (only own property's rows) |
| EC-INT-030 | A mapping is corrected after 40 records used it | Validation and preview invalidated; affected records listed for review | P1 | building | src/domain/setup-journey.test.ts — partial: affected-records list not built |
| EC-INT-031 | A CSV cell contains `=HYPERLINK(...)` | Neutralised on export and import (formula injection) | P1 | tested | src/domain/exchange-rules.test.ts:248 (formula neutralised on export) |
| EC-INT-032 | The same CSV is imported twice, or an older file concurrently with a newer one | Idempotent; the older file never overwrites newer data | P0 | tested | test/file-csv.test.ts:128 (re-import idempotent); test/concurrency.test.ts:234 (older file never overwrites (Promise.allSettled)) |
| EC-INT-033 | A modification arrives for a booking Portico never received | Held and the full record fetched from the source before applying | P0 | building | — partial: applied with a gap flag instead of held and fetched (README CL-05) |
| EC-INT-034 | The vendor announces an API version shutdown in 30 days | Vendor notice routine, urgent within a week of the deadline, owner assigned | P1 | tested | src/domain/health-webhooks.test.ts:187 (urgent within a week) |
| EC-INT-035 | Another integration exhausts the hotel's shared vendor rate budget (e.g. OHIP 50 rps per gateway) | Back off on 429 with a `delayed` label and an exception naming the shared limit; no data loss; no hot loop | P1 | missing | — |
| EC-INT-036 | Vendor clock is ahead of Portico's | Latency never negative; freshness computed from receipt time | P1 | tested | src/domain/exchange-rules.test.ts:87 (never negative latency) |
| EC-INT-037 | API and worker processes run separately | Both see the same simulator and queue state; background work runs once per interval in each tenant's context | P1 | tested | test/jobs.test.ts:60 (worker sees the same simulator); test/jobs.test.ts:42 (next run scheduled once) |
| EC-INT-038 | A settled inbound payload with guest data is 30 days old | Payload redacted; identifiers and hashes kept for audit | P1 | tested | test/retention.test.ts:68 (payload redacted); test/retention.test.ts:74 (file purged, hash kept) |
| EC-INT-039 | A guest's erasure request covers data held in integration payloads and outbound commands | Erasure reaches integration storage (redact by guest reference) or the request lists what remains and why | P1 | missing | — |
| EC-INT-040 | The on-site agent on an island loses its link for 6 hours | Queue kept on site; data labelled `delayed`; on recovery risky commands revalidated, not replayed | P1 | specified | — (INT-R25, INT-R19) |
| EC-INT-041 | Migration: imported deposits differ from the old system's ledger for 3 bookings (S18/E12) | Reported per booking in the reconciliation; nothing balanced silently; acceptance blocked until resolved | P0 | specified | — (INT-R32, INT-I09) |
| EC-INT-042 | Migration: a CRS and the PMS both deliver the same bookings after a switch | External-id uniqueness and duplicate detection prevent double bookings and doubled revenue (R05 #24) | P0 | specified | — (INT-R16, INT-R31) |
| EC-INT-043 | A paused connection is resumed after three days | Treated as a reconnection: queued state commands coalesced; money and inventory commands need revalidation | P0 | tested | test/scenario-s20-integration-outage.test.ts:305 (risky command revalidated after resume); src/domain/exchange-rules.test.ts:223 (state commands coalesced) |
| EC-INT-044 | Activation attempted with a passed validation from before the latest mapping change | Refused: validation and preview must follow the last mapping change (CL-03) | P0 | tested | test/setup-journey.test.ts:225 (activation refused with an outdated preview) |

## Edge cases from the failure-class sweep (playbook v2)

Classes from `docs/quality/patterns.md` groups A–D that apply to this module and are not already covered by a
row above; the class is named in brackets. Classes already covered by earlier rows, and classes that do not
apply (with the reason), are listed in `gaps-ops.md` § Failure-class sweep.

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-INT-045 | [AP-02] A query forgets the tenant filter on an integration table | RLS returns no row of another tenant for every integration table | P0 | building | test/isolation-permissions.test.ts:57 (raw query sees no other tenant) — partial: not driven by information_schema for every table |
| EC-INT-046 | [AP-03] A second organization registers the same PMS account id, hotel code or webhook endpoint | Refused or proof of ownership required; inbound routing on that identifier resolves to exactly one tenant | P0 | missing | — |
| EC-INT-047 | [AP-04] A caller supplies a weaker effect class than the connector declares for a write | The stricter class wins; callers can only make it stricter | P0 | tested | src/domain/exchange-rules.test.ts:182 (never weaker) |
| EC-INT-048 | [AP-05] Every integration route is called by a user with no integration grants | Each refuses before reading | P0 | building | — partial: by-id and list refusals tested (test/isolation-permissions.test.ts); no enumeration of every route |
| EC-INT-049 | [AP-06] Integration code checks a permission key its manifest does not register | The catalogue test fails | P0 | tested | apps/api/test/permission-catalog.test.ts:28 (catalogue complete) |
| EC-INT-050 | [AP-10] The manager who planned a charges authority transition approves it, or approves through their own API key | Refused: a different human must approve | P0 | building | — built (feat/identity-platform-enterprise@abbd5e9): test/review-regressions.test.ts "P1-4" — platform approval path not on main |
| EC-INT-051 | [AP-15] A webhook subscription create is replayed with the same Idempotency-Key | The signing secret is shown once; the replay returns the subscription without it | P0 | tested | apps/api/test/integration.test.ts:258 (secret not in the replay) |
| EC-INT-052 | [AP-19] A trial organization becomes live while outbound commands are queued | Each command re-checks the environment at execution and is refused (`environment_changed`) until re-approved | P0 | missing | — |
| EC-INT-053 | [AP-24] A PMS sends tax-inclusive charge amounts while the workflow assumes exclusive | Records held until the workflow declares its tax treatment; never posted with a guessed tax base | P0 | missing | — (tax-treatment declaration not built, INT-R20) |
| EC-INT-054 | [AP-29] A setup journey sits idle for 90 days | A job marks it abandoned and tells the owner; no reminder depends on someone opening it | P2 | missing | — (README: abandonment not built) |
| EC-INT-055 | [AP-32] The PMS sends a reservation that checked out last month (late or historical) | Applied or held with an exception; never a retry loop | P1 | specified | — (INT-I02; not asserted) |
| EC-INT-056 | [AP-35] A connector performs an operation it never declared | Classified as money on money domains and inventory elsewhere (fails closed) | P0 | tested | src/connectors/registry.test.ts:48 (undeclared → money); src/connectors/registry.test.ts:51 (undeclared → inventory) |
| EC-INT-057 | [AP-37] The database transaction rolls back after the vendor was called | Adapter calls run outside the transaction; the vendor is acknowledged only after commit; a rolled-back record is never reported as applied | P0 | building | test/concurrency.test.ts:476 (handler rejection never acknowledged as applied) — partial: rollback after an outbound call not asserted |
| EC-INT-058 | [AP-40 / AP-41] A scope includes charges but finance catalogs are stubs in this deployment | Setup stops at mapping review with `provider_unavailable` explained; never guesses a mapping | P0 | tested | apps/api/test/integration.test.ts:211 (blocked with explanation) |
| EC-INT-059 | [AP-44] A mapped unit type is archived after the mapping was confirmed | Records referencing it are held with an exception; never applied to an archived target | P1 | missing | — |

<!-- sources (generated from a verified registry; do not edit by hand) -->

## Sources

Registry checked 2026-11-07. **Opened** = the page was fetched from this environment. **Search-located** = found by web search; the host blocks direct fetches here, so the fact is unverified until re-checked. Press releases and trade press are vendor claims, not verified behaviour.

- [Apaleo — AI integrations (MCP server, ~260 tools, OAuth)][apaleo-ai] (opened)
- [Apaleo — API rate limiting][apaleo-ratelimit] (opened)
- [Apaleo — API scopes][apaleo-scopes] (opened)
- [Apaleo — API versioning][apaleo-versioning] (opened)
- [Apaleo — Certify your app (Apaleo Store)][apaleo-store] (opened)
- [Apaleo — First PMS MCP server (press)][apaleo-mcp] (search-located)
- [Apaleo — OAuth — review consent screen][apaleo-consent] (opened)
- [Apaleo — Webhooks overview][apaleo-webhooks] (opened)
- [Cloudbeds — API reference — webhooks][cb-webhooks] (search-located)
- [Mews — Connector API — Authentication][mews-auth] (opened)
- [Mews — Connector API — Certification][mews-cert] (opened)
- [Mews — Connector API — Deprecations][mews-deprec] (opened)
- [Mews — Connector API — Events][mews-events] (opened)
- [Mews — Mews surpasses 1,000 Marketplace integrations (press)][mews-mkt] (search-located)
- [OPERA Cloud 26.3 — About Data Import (profiles, reservations, rooms management, Track It, ledgers)][op-dataimport] (opened)
- [OPERA Cloud 26.3 — Configuring Business Events][op-busevents] (opened)
- [OPERA Cloud 26.3 — Configuring Data Value Mappings][op-dvm] (opened)
- [OPERA Cloud 26.3 — Configuring External Systems][op-extsys] (opened)
- [OPERA Cloud 26.3 — Configuring Property Interface (rights, postings, room status, encoder workstations)][op-pifc] (opened)
- [OPERA Cloud 26.3 — Exporting Property Configuration Shells][op-cfgshell] (opened)
- [OPERA Cloud 26.3 — Exports][op-exports] (opened)
- [OPERA Cloud 26.3 — Managing Interface Users][op-ifcusers] (opened)
- [OPERA Cloud 26.3 — Managing Scheduled Exports][op-schedexport] (opened)
- [OPERA Cloud 26.3 — Property Interface Control][op-pic] (opened)
- [OPERA Cloud 26.3 — Property and Fiscal Interface Monitoring][op-ifcmon] (opened)
- [OPERA Cloud 26.3 — Synchronizing Business Events][op-syncbe] (opened)
- [OPERA Cloud 26.3 — Synchronizing Room Status][op-syncrs] (opened)
- [OPERA Cloud 26.3 — Using Outbound Monitoring][op-outmon] (opened)
- [OPERA Cloud 26.3 — Viewing Property Interface Logs][op-ifclogs] (opened)
- [Oracle OHIP — Connecting to the Streaming API][ohip-stream] (opened)
- [Oracle OHIP — Errors][ohip-errors] (opened)
- [Oracle OHIP — Streaming FAQ (7-day event retention and replay)][ohip-faq] (opened)
- [Oracle OHIP — Working with Events in the Developer Portal][ohip-events] (opened)
- [SiteMinder — SiteMinder Exchange (SMX) — developer documentation][sm-smx] (search-located)
- [SiteMinder — pmsXchange — developer documentation][sm-pmsx] (search-located)

[apaleo-ai]: https://apaleo.dev/guides/ai/overview.html
[apaleo-consent]: https://apaleo.dev/guides/oauth-connection/review-consent-screen.html
[apaleo-mcp]: https://hoteltechreport.com/news/apaleo-becomes-first-property-management-platform-to-launch-mcp-server-bridging-ai-agents-with-hotel-systems
[apaleo-ratelimit]: https://apaleo.dev/guides/api/rate-limiting.html
[apaleo-scopes]: https://apaleo.dev/guides/api/scopes.html
[apaleo-store]: https://apaleo.dev/guides/apaleo-store/certify-your-app.html
[apaleo-versioning]: https://apaleo.dev/guides/api/versioning.html
[apaleo-webhooks]: https://apaleo.dev/guides/webhook/overview.html
[cb-webhooks]: https://developers.cloudbeds.com/reference/webhooks
[mews-auth]: https://docs.mews.com/connector-api/guidelines/authentication
[mews-cert]: https://docs.mews.com/connector-api/your-journey/certification
[mews-deprec]: https://docs.mews.com/connector-api/deprecations
[mews-events]: https://docs.mews.com/connector-api/events
[mews-mkt]: https://www.mews.com/en/press/mews-surpasses-1000-marketplace-integrations-with-hospitalitys-biggest-app-store
[ohip-errors]: https://docs.oracle.com/en/industries/hospitality/integration-platform/ohipu/c_errors.htm
[ohip-events]: https://docs.oracle.com/en/industries/hospitality/integration-platform/ohipu/t_working_with_events_in_developer_portal.htm
[ohip-faq]: https://docs.oracle.com/en/industries/hospitality/integration-platform/stmig/c_faqs.htm
[ohip-stream]: https://docs.oracle.com/en/industries/hospitality/integration-platform/ohipu/t_connecting_to_the_streaming_api.htm
[op-busevents]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_interfaces_configuring_business_events.htm
[op-cfgshell]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_toolbox_exporting_property_configuration_shells.htm
[op-dataimport]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_system_setup-importing_data.htm
[op-dvm]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_interfaces_managing_data_value_mappings.htm
[op-exports]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/ch_exports.htm
[op-extsys]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_interfaces_configuring_external_systems.htm
[op-ifclogs]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_interfaces_viewing_property_interface_logs.htm
[op-ifcmon]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_interfaces_property_and_fiscal_interface_monitoring.htm
[op-ifcusers]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_role_manager_managing_interface_users.htm
[op-outmon]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_toolbox_using_outbound_monitoring.htm
[op-pic]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_property_interface_control.htm
[op-pifc]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_interfaces_configuring_property_interfaces.htm
[op-schedexport]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_scheduled_exports.htm
[op-syncbe]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_toolbox_utilities_synchronization_synchronizing_business_events.htm
[op-syncrs]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_toolbox_synchronizing_room_status.htm
[sm-pmsx]: https://developer.siteminder.com/siteminder-apis/pms-rms/introduction/pmsxchange
[sm-smx]: https://developer.siteminder.com/siteminder-apis/apps/introduction/siteminder-exchange
