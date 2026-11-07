# @portico/integration — connector framework (wave 1)

## Checkpoint

- **Done:** schema + migration, connector SDK and catalogue (3 built connectors + 4 honest planned entries), pure
  domain logic with unit tests, all services (9-step journey, credentials, mappings, exchange, outbound queue,
  health, exceptions, safe lifecycle operations, webhooks, scheduled job, simulators), universal record contract,
  search provider, HTTP routes, composition wiring, integration + HTTP end-to-end tests.
- **Steward review fix round (review-integration.md, "merge after fixes"):** F1 SSRF-safe `safeFetch`; F2/F4 no
  blind replay across pause/resume/replace/disconnect; F3 effect classes fail closed; F5 guarded watermark; F6
  synchronous inbound handler port; F7 persisted simulator shared by API and worker; F8 simulators never in live
  orgs; F9 second approval for charges/payments/accounting/availability + `pendingOperations`; P2s F11, F12, F13,
  F15, F18, F19, F23, F29. Probes 2–8 are regression tests (`test/concurrency.test.ts`).
- **Next (after merge / wave 2):** bind rates/finance catalogs, platform activation scope and authority transitions
  once identity-plus is on main; owning modules register inbound handlers; migration toolkit.
- **Known failing tests:** none.

## Purpose

Integration makes Portico easy to connect alongside a hotel's existing systems, evaluate safely and adopt step by
step (adoption brief §2, §5–§9, §12–§13). It is the `connection` behind every `external` data authority: it
describes what each connector can do **workflow by workflow**, guides staff through a resumable 9-step setup,
translates external codes through reviewed mappings, exchanges information exactly once and in order, never
replays money or inventory actions blindly, and reports health and exceptions in plain English.

Sources reconciled: `docs/specs/integration.md` (in-module behavior), `docs/architecture/domain-map.md`
(contracts), `docs/adoption/connection-lifecycle-and-health-spec.md`, `source-of-truth-matrix.md`,
`evaluation-and-trial.md`, `gap-assessment.md` (G-03, G-05 owned here), `docs/readiness/*`. Patterns adopted from
research: self-serve webhooks with wildcards/property filters, thin signed events, delivery log and replay
(research 02 §8, Apaleo; avoid support-gated registration, Mews); event replay window (research 01, OHIP);
acknowledgement only after commit, resend until acknowledged, backoff schedule and manual queue for unmapped
bookings (research 03 §4, SiteMinder).

## What is built

### Connectors (`GET /v1/integration/catalogue`)

| Key | What | Readiness (technical) | External approval | Notes |
|---|---|---|---|---|
| `pms.simulator` | Simulated PMS: reservations, rooms, room status, charges; faults: delay, duplicates, out-of-order, outage, credential expiry, command timeout/refusal, read-only keys | **R3** (simulator only) | not required | Never "live"; every exchange labeled `simulated`. State persisted in `integration.sim_accounts` (shared by API and worker; ≤ 5 accounts per organization, bounded queues). Refused in `live` organizations (`simulator_not_in_live`). |
| `file.csv` | CSV import (reservations, room status) and export (accounting journals) | **R3** | not required | "File exchange — not a live connection"; exports are `exported`, never "synced". Formula-injection safe. |
| `webhooks.outbound` | Partner webhooks: thin signed events, retries, auto-disable, replay, secret rotation | **R3** | not required | Set up via subscriptions, not the journey. |
| `channel.channex`, `pms.opera-cloud`, `accounting.erp`, `doorLock.encoders` | Planned entries | **R1** | not started | `connectable: false`; workflows `unverified`; costs dated or "quote required"; door locks flag the local connector. |

Each entry carries `implementation` (R-level + evidence) and `externalApproval` separately, plus a disclaimer that
the listing implies no vendor certification (CLAUDE.md §7).

### Capabilities vs spec (`docs/specs/integration.md`)

| Spec | Status | Where |
|---|---|---|
| INT-R01 ConnectorDefinition (vendor, products/versions, regions, access model, local connector, Zod credential schema, vendor-side steps, WorkflowCapability[], costs, readiness, approval, support, vendor notices) | built, R3 | `src/connectors/sdk.ts` |
| INT-R02/R03 workflow-level catalogue; file exchange labeled | built | `catalogue.ts`, `toSummary` |
| INT-R04 unsupported actions explicit (`whenUnavailable`, `unsupported` workflows, compatibility refusals) | built | `compatibilityReport` |
| INT-R05 wave-1 connectors | simulator, CSV import/export, webhooks built; XLSX import and inbound HTTP receiver **not built** | — |
| INT-R06 9-step journey, persisted, resumable, actor/time per step | built | `connections.ts`, `connection_steps` |
| INT-R07 scope as data; scope change re-runs later steps | built (re-review keeps a verified credential) | `reviewCompatibility` |
| INT-R08 credentials never plaintext; expiry; reminders 30/7/1 days; rotation | built | `credentials.ts`, `checkCredentialExpiry` |
| INT-R09 safe pause/disconnect/rotate/replace with impact preview; disconnect refused while system of record | built | `previewLifecycle` + actions |
| INT-R10/R11 suggestions with confidence + reasons; mandatory review (ambiguous, < 0.9, financial) | built for property, unitType, unit, ratePlan, outlet, chargeCode, taxRule, ledgerAccount, status; paymentMethod, marketSegment, source, department, staffUser **not yet** | `mapping-suggest.ts`, `mappings.ts` |
| INT-R12 unmapped records never dropped: held + exception + re-applied when mapped | built | `ingestRecords`, `reprocessHeld` |
| INT-R13 mapping versions + audit | built; "affected records" listing **not built** | `mapping_versions` |
| INT-R14 suggestion accuracy | built (`summary.suggestionAccuracy`) | `summarize` |
| INT-R15/R16 exchange log; inbound idempotency and ordering | built | `exchange_log`, `inbound_messages`, `external_records` |
| INT-R17 sync runs (periodic/manual/file/reconciliation) with counts | built; vendor cursors and nightly full-window reconciliation **partial** | `runSync` |
| INT-R18 forwarding with idempotency keys; acknowledged/rejected/unknown | built (`forward` = `enqueueOutbound`) | `exchange.ts` |
| INT-R19 no blind replay | built (rules below) | `outbound-policy.ts` |
| INT-R20 translation: identifiers, currencies (never converted), time (UTC + property zone), business dates (from source), statuses | built; tax inclusive/exclusive declaration **not yet** | `translateRecord` |
| INT-R21/R22 health per connection/workflow, freshness, provenance labels, impact | built | `domain/health.ts`, `service/health.ts` |
| INT-R23 exceptions (dedupe, owner user/department, resolve/ignore) | built; staff notifications **not built** | `exceptions.ts` |
| INT-R24 property and portfolio views, urgent vs routine | built (API) | `GET /integration/health` |
| INT-R25 local connector agents | **not built** (SHOULD); catalogue flags the need | — |
| INT-R26 webhooks (wildcards, property filters, thin events, HMAC + rotation, 10 attempts over ≈ 25.9 h, log, replay incl. 7-day range); every call through `safeFetch` | built | `webhooks.ts`, `net/` |
| INT-R27 partner apps (consent, scopes) | **not built** (SHOULD); a subscription may reference an identity API client | — |
| INT-R29–R34 migration, export | wave 2 | — |

### Setup states

States record the last completed step: `selected → compatibility_reviewed → authorized → mappings_suggested →
issues_resolved → validated → previewed → active → monitoring`, plus `paused`, `error`, `disconnected`. Mapping to
the adoption spec: `selecting/reviewing_compatibility = selected`, `awaiting_authorization =
compatibility_reviewed`, `mapping = authorized/mappings_suggested`, `ready = previewed`, `suspended /
credentials_invalid = error` (system-initiated on a rejected credential; recovered by rotation). `abandoned`
(90-day idle) and setup reminders are **not built**.

### Outbound address policy (SSRF, F1)

Every call to a customer- or partner-supplied URL goes through `safeFetch` (`src/net/`, Node built-ins only, ready
to move to a shared package): https only, no userinfo, DNS names only (no IP literals in any form, no trailing dot,
no single-label or `.local/.internal/...` names), allowed ports only (443 unless configured). The name is resolved
once, **every** address must be public unicast (IPv4 special ranges; IPv6 loopback, unique-local incl.
`fd00:ec2::254`, link/site-local, multicast; IPv4 embedded in mapped/compatible/NAT64/6to4/Teredo is decoded and
checked), and the socket is pinned to the vetted address (no rebinding window). Redirects are never followed;
DNS + connect + answer share one time budget. Subscriptions are vetted at configuration time as well.

### No blind replay (adoption §8; lifecycle spec §9)

- Effect classes come from the connector (callers can only make them stricter): `money`, `inventory_reopen`,
  `inventory`, `standard`. They **fail closed**: an operation the connector did not declare is `money` on
  charges/payments/accounting and `inventory` elsewhere; reservation create/update are `inventory`.
- A send in flight is never taken from under the sender: pause/resume, replace and disconnect mark it
  `hold_after_send`, and a non-confirmed completion is then held for a person. Adapter calls get a deadline (45 s)
  shorter than the send lease (60 s); a late answer never overwrites a decided action.
- Disconnect cancels only actions that never reached the system. Uncertain ones (timeout, in flight) stay
  `pending_verification` with an urgent `uncertain_after_disconnect` exception; a person records them as applied
  (`confirm_applied`) or cancels them.
- Unknown outcome (timeout) → `pending_verification`; never resent before asking the vendor by idempotency key.
  Found → acknowledged (verified); not found → standard resends with the same key, risky ones wait for a person.
- After ≥ 3 consecutive failures, a rejected credential or a pause, the connection is *interrupted*: risky commands
  are not sent. On reconnection (recovery, resume, rotation) every unfinished risky command becomes
  `needs_revalidation` (urgent exception); queued state-setting commands are coalesced to the newest per record
  (`superseded`). A person resends (verified first) or cancels (`integration.outbound.cancelled`).
- Refusals are final (`rejected`; urgent for money: "NOT on the guest's bill"). An outage stops the batch (no
  retry storm); backoff 5/10/20/40 s, then 60 s, then 5 min.

### Health and provenance (G-05)

Per workflow against its freshness target T (reservations 2 min, room status 1 min, charges 5 min): `healthy` ≤ T;
`delayed` ≤ 3T (data labeled `delayed` with `ageSeconds`); `degraded` on partial errors or held messages;
`failing` beyond 3T for a system-of-record workflow or with the circuit breaker open (10 failures). A detected
revision gap labels the data `incomplete` until a reconciliation run. File workflows have no time target and show
"File exchange — not a live connection". Connection overall: `healthy | degraded | down | paused |
not_monitored`; any failing workflow or invalid credential → `down`. Urgent vs routine follows lifecycle spec §6.4.

### Trial read-only guard (G-03)

In `trial`: compatibility refuses create/update and `forward`; validation fails on write scope; activation refuses
anything but read-only; `enqueueOutbound` is blocked by the environment policy (`integration.write`); partner
webhooks are recorded as `blocked`. Credentials record vendor scopes and `readOnlyAtVendor`; a write-capable (or
unstated) credential shows `trialWriteGuard`: "This credential would allow changes in <system>. Portico blocks all
writes from trials." Demo/training: exchanges simulated, webhooks `simulated`. A real connector is never called in
`simulate` mode and, in `live`, passes the activation-scope port first (simulators and files skip it).

## Invariants and the tests that prove them

| Invariant | Test |
|---|---|
| One effect per (connection, workflow, external id, revision); duplicates acknowledged and logged | `scenario-s02-inbound-faults` (S02, CL-04) |
| Older revisions never overwrite newer ones (`stale`), also under concurrent ingestion and concurrent CSV imports | `scenario-s02-inbound-faults`, `exchange-rules.test.ts`, `concurrency.test.ts` (PROBE-2, -7) |
| Held records applied exactly once under concurrent reprocessing | `concurrency.test.ts` (PROBE-3) |
| Inbound applied by the owning module in the same transaction; reject/hold/throw become exceptions | `concurrency.test.ts`, `setup-journey.test.ts` |
| No guest data in the outbox (thin `integration.inbound.applied`) | `setup-journey.test.ts` |
| A send in flight across pause + resume cannot escape revalidation; adapter deadline < lease | `concurrency.test.ts` (PROBE-5) |
| Disconnect never cancels an uncertain charge | `concurrency.test.ts` (PROBE-6) |
| Concurrent raises of one problem share a row | `concurrency.test.ts` (PROBE-8) |
| Charges/payments/accounting/availability move only with a second approval; pending work reported to platform | `authority.test.ts` |
| Records held during a change of system of record are applied after it | `authority.test.ts` |
| SSRF: no connection to blocked destinations (rebinding, mapped IPv6, trailing dot, ports) | `net/address-policy.test.ts` |
| Effect classes fail closed | `connectors/registry.test.ts` |
| Simulators never in live organizations; worker shares the API's simulator state | `environment-safety.test.ts`, `jobs.test.ts`, `apps/api/test/integration.test.ts` |
| Settled payloads and files redacted after retention | `retention.test.ts` |
| Unknown codes held, never guessed; re-applied once mapped; currencies never converted | `scenario-s02-inbound-faults` |
| Gap → `incomplete` until reconciliation; late delivery → `delayed` | `scenario-s02-inbound-faults`, `health-webhooks.test.ts` |
| Money / inventory actions never replayed after reconnection without revalidation (INT-I03, CL-06/07/08) | `scenario-s20-integration-outage`, `credentials.test.ts` |
| Unknown outcome verified before resend: no double charge | `scenario-s20` (CL-07) |
| Health never `healthy` beyond the freshness target (INT-I08) | `health-webhooks.test.ts` |
| Activation needs the latest passed validation and preview after the last mapping change (CL-03) | `setup-journey.test.ts` |
| Financial mappings need `integration.mapping.reviewFinancial` (INT-I05, CL-02) | `setup-journey.test.ts`, `mapping-suggest.test.ts` |
| A domain is never governed by two connections; disconnect refused while system of record (INT-I04, CL-10) | `setup-journey.test.ts` |
| Credentials never plaintext, never in responses, audit or history (INT-I06, CL-12) | `setup-journey`, `credentials`, `apps/api/test/integration.test.ts` |
| One urgent exception per rejected credential, no retry storm (CL-09) | `credentials.test.ts` |
| Zero-downtime rotation; failed rotation changes nothing (CL-11) | `credentials.test.ts` |
| Trial never writes (INT-I07, EV-02, EV-04) | `environment-safety.test.ts`, `webhooks.test.ts` |
| Tenant isolation (S17) and property scope, incl. rows of shared connections (F12) | `isolation-permissions.test.ts`, `apps/api/test/integration.test.ts` |
| Webhook HMAC, retries, dead, auto-disable, replay, rotation overlap | `webhooks.test.ts`, `health-webhooks.test.ts` |
| Background work once per interval, in each tenant's own context | `jobs.test.ts` |

Scenarios: `scenario-s02-inbound-faults.test.ts` (S02, integration part), `scenario-s20-integration-outage.test.ts`
(S20: outage mid-shift, degraded → down with impact, held actions). Full journey: `setup-journey.test.ts`.

## Permissions (spec §8)

`integration.catalogue.read` (org) · `integration.connection.read` · `integration.connection.manage` ⚑ ·
`integration.connection.activate` ⚑ (separate from manage: separation of duties) · `integration.credentials.manage` ⚑ ·
`integration.mapping.review` · `integration.mapping.reviewFinancial` ⚑ · `integration.exception.resolve` (also decides
held actions) · `integration.syncRun.trigger` · `integration.technical.read` ⚑ (payloads, vendor detail) ·
`integration.webhook.manage` ⚑ (org) · `integration.simulator.control` (org). Managing a multi-property connection
needs the permission for every property; reading the connection needs one, and its rows (exchanges, outbound
actions, exceptions, mappings) are filtered to the reader's properties — rows with no property only for readers of
every property. Health and sync runs are connection-level aggregates without record references and are visible to
any reader of the connection. Activation also needs `platform.dataAuthority.manage`.

## Universal record contract

Connections, mappings and exceptions return `status` (families: setup/health/integration; mapping/review;
exception/severity/responsibleParty), server-computed `allowedActions` with plain-language disabled reasons and
`previewRequired`, `issues`, `owner`, `links`. `recordTypes` are declared in the manifest (equal to audit target
types). `integrationSearch` (SearchProvider) covers connections and open exceptions, permission-aware. "My work":
`GET /v1/integration/my-work` / `listWorkItems` (exceptions owned by me or my departments, or unowned urgent ones I
can resolve); FR-6 proposes the shared inbox contract. Audit before/after never contains secrets.

## Events

Emitted: `integration.connection.statusChanged` (state and health; `aggregateVersion` = connection version on state
changes), `integration.exception.raised|resolved` (versioned), `integration.mapping.changed` (domain map); additive:
`integration.inbound.applied` (thin notification: ids, revision, `revisionOrder`, never guest data; versioned when
the revision fits), `integration.outbound.acknowledged|rejected|cancelled|exported`, `integration.syncRun.completed`,
`integration.credentials.expiring`, `integration.webhookDelivery.failed`.
Consumed: the public event types by the webhook fan-out consumer `integration.webhooks.fanout`;
`platform.dataAuthority.changed` and `platform.authorityTransition.completed` by `integration.authority.reprocess`
(applies records held while a system of record was being switched).

## Ports and binding status (`apps/api/src/composition.ts`)

| Port | Bound to | Status |
|---|---|---|
| `platform` (getProperty, get/setDataAuthority) | real `@portico/platform` | bound |
| `catalog` | unit types and units → `@portico/inventory` (system context scoped to the authorized property, ADR-0015); rate plans, tax rules → rates; charge codes, ledger accounts → finance; outlets → platform: `unavailableCatalog` (clear `module_unavailable` on the mapping rows) | partly bound |
| `inbound` (per workflow `applyInbound(tx, record)`; F6) | `{}` — owning modules register handlers (operations → roomStatus, reservations → reservations, finance → charges) | **owning modules bind**; until then records are stored in order as `accepted` and applied when bound |
| `activationScope` (G-04): platform `assertEffectInScope(tx, propertyId, effect, { connectionId, workflow })` | `unavailableActivationScope` (refuses live effects of real connectors) | **bind with identity-plus** |
| `transitions` (G-02): `activeTransition` ← platform `openTransitionFor` (status → state); `plan` ← `planAuthorityTransition(tx, propertyId, { changes, reason, freezeMinutes })` | `noAuthorityTransitions` | **bind with identity-plus** |
| platform `transitionGuard.pendingOperations` | `createIntegrationProvider(deps).pendingOperations` | **bind with identity-plus** |
| `secrets` | `localSecretStore(fieldCryptoFromEnv().cipher)` | bound (AWS store: FR-4) |
| `transport` / `net` | `safeWebhookTransport` / `systemResolver`, port 443 | bound |
| jobs, subscriptions | `integrationJobs(deps)`, `integrationSubscriptions(deps)` | bound |

Provider for other modules: `createIntegrationProvider(deps)` with the domain-map functions (`getConnection`,
`listConnections`, `getMapping`, `recordExchange`, `raiseException`, `resolveException`, `markHealthy`,
`markDegraded`) plus additive `forward`, `getFreshness`, `listWorkItems`, `pendingOperations`.

## Contract changes (to apply in `docs/architecture/domain-map.md`)

1. Additive provider functions: `forward` (spec proposal 2), `getFreshness` (proposal 3), `previewLifecycle`
   (proposal 4 `previewConnectionChange`), `listExceptions` (proposal 5), `listWorkItems`.
2. `raiseException` accepts optional `code`, `dedupeKey`, `relatedRefs`, `propertyId`, `technicalDetail`.
3. Inbound application uses the spec's **synchronous handler port** (steward decision F6): owning modules bind
   `ports.inbound[workflow].applyInbound(tx, record)` and apply the record in the same transaction (savepoint);
   the vendor is acknowledged only after commit; per-record ordering is enforced by the guarded watermark before
   the handler runs; a rejection, hold or failure becomes an integration exception and the record stays saved.
   `integration.inbound.applied` is now a thin notification only.
4. F9: activation never changes charges/payments/accounting/availability authority directly; it plans a platform
   authority transition (`transitions.plan`) that a second manager approves. `AuthorityChange` gains
   `requiresSecondApproval`. Provider `pendingOperations(tx, propertyId, domains)` implements platform's
   `AuthorityTransitionGuard`.
5. `revalidate` accepts `confirm_applied` (a person checked the system; used after a disconnect).
6. Connector SDK: `ackSemantics: 'none' | 'per-client' | 'shared-queue'` (a shared-queue acknowledgement is a write:
   blocked in trial); `AdapterContext.deadline`; effect class `inventory`.
7. The additive events listed above.

## Adoption modes

Present in every adoption path; owns no data-authority domain; it is the connection behind every `external`
authority (activation calls `platform.setDataAuthority`, or plans a transition for second-approval domains; a
frozen transition holds inbound changes, applied after it). Hard dependencies: platform (bound), identity
(authorization). Other modules depend on it for mirrors (inbound handler port), forwarding (`forward`) and
freshness (`getFreshness`).

## HTTP (`/v1/integration/…`)

Catalogue (`catalogue`, `catalogue/:key`, `webhook-event-types`); connections (list, create, get); journey
(`compatibility/preview`, `compatibility`, `authorize`, `mappings/suggest`, `mappings`, `mappings/:id/review`,
`mappings/:id/history`, `issues/resolve`, `validation-runs`, `activation-preview`, `activate`); lifecycle
(`lifecycle-preview?action=`, `pause`, `resume`, `disconnect`, `replace`, `credentials/rotate`, `credentials`,
`vendor-notices`); health (`connections/:id/health`, `health?propertyId=` for property and portfolio views); exchange
(`exchanges`, `sync-runs` GET/POST, `files/import`, `files/export`, `outbound`, `outbound/dispatch`,
`outbound/:id/revalidate`); exceptions (`exceptions`, `:id`, `assign`, `resolve`, `ignore`, `my-work`); webhooks
(`webhooks/subscriptions` CRUD, `rotate-secret`, `test`, `deliveries`, range `replay`, `deliveries/:id/replay`);
simulators (`simulators/pms`, faults, events). Creates require `Idempotency-Key`; versioned updates `If-Match`;
reads return `ETag`; errors are problem+json explaining problem, impact, responsible party and next step.

### Verifying webhook signatures (partners)

Header `Portico-Signature: t=<unix>,v1=<hex>[,v1=<hex>]` with `v1 = HMAC-SHA256(secret, "<t>.<raw body>")` (two
`v1` during a secret rotation). Reject unless one `v1` matches (constant time) and `|now − t| ≤ 300 s`.
Deduplicate on `Portico-Event-Id`; payloads are thin — fetch details with your own API permissions. Reference:
`verifySignature` in `src/domain/webhooks.ts`.

## Known gaps

- Real vendor connectors (OPERA/OHIP, Channex, POS, accounting, locks) are R1; nothing is sandbox-tested (R4).
- No owning module binds an inbound handler yet: received records are stored in order as `accepted` (never shown
  as applied) and applied when a handler is bound.
- In the API the rate-plan / tax-rule / charge-code / ledger-account / outlet catalogs are stubs until rates and
  finance merge, so the HTTP journey stops at mapping review in this deployment (module tests use fakes).
- Spec items not met (F15, tracked): INT-R07 scope change on an active connection; INT-R09 shadow comparison on
  replace; INT-R17 vendor cursors and nightly full-window reconciliation; INT-R05 XLSX import, inbound HTTP receiver,
  guests/units/balances import; CL-05 an unknown-entity modification is applied with a gap flag instead of held and
  fetched; validation count/round-trip/financial-recompute/timing checks and named acknowledgement of warnings;
  INT-R23 staff notifications; step assignment (lifecycle §2.3).
- Not built: local connector agent, partner apps/consent, setup reminders/abandonment, "affected records" on mapping
  change, usage and charges from provider reports, per-workflow tax-treatment declaration.
- Retention covers inbound payloads and files (30 days after settlement); outbound command payloads are not yet
  redacted, and there is no per-guest erasure request path (guests module to call).
- Background work bounds each adapter call (45 s) and webhook send (10 s); there is no overall per-tenant time
  budget per scheduler tick yet.
- The competitive parity file `docs/parity/integration.md` is produced by the parity workstream (`docs/parity-ops`);
  the invariants table above is this module's edge-case evidence for it.

## Open questions for the owner

None new. Vendor access, fees and approvals are tracked in `docs/readiness/dependency-register.md`; connecting a
trial to real systems remains behind Q61/Q64 (adoption docs).
