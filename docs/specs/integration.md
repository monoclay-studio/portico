# Spec: integration

Status: Draft v1 · 2026-11-07 · **Wave 1 (connector framework)** / Wave 2 (migration, data export) ·
Schema `integration` · Prefix `INT`
Contract: `docs/architecture/domain-map.md` § integration (on `main`); ADR-0014 (data authority).

## 1. Purpose

Integration makes Portico the easiest platform to connect, evaluate and adopt (adoption brief §1). It lets a hotel
keep systems it likes, connect them in a guided journey that ordinary staff can finish, see exactly what each
connection does (workflow by workflow, not logo by logo), trust that nothing is duplicated, lost or silently
overwritten, and recover safely when a vendor, credential or network fails. Later it turns migration into an
inspectable, rehearsable, reconciled product.

## 2. Scope and non-goals

**In scope (wave 1):** connector SDK and registry, integration **catalogue** with workflow-level capabilities,
connection lifecycle and the **9-step setup journey**, encrypted credentials and expiry, **mappings** with
suggestions and review, exchange log, sync runs, forwarding of changes when an external system is authoritative,
connection health, integration exceptions, safe pause/disconnect/rotate/replace, local (on-site) connector agents,
outbound webhooks for partners, partner app registration (with identity API clients), simulators.
**Wave 2:** migration (import jobs, rehearsal, reconciliation, cutover, rollback planning), historical archive,
data export (exit), durable event stream.

**Non-goals:** domain logic of the data being exchanged (each module owns its meaning; connectors translate);
channel-manager semantics (ARI coalescing, OTA revisions — `distribution` builds on this framework); payment
provider adapters (`payments` owns them; integration supplies PCI proxy connections for OTA card data); the
provider coverage matrix and adoption deliverables (`docs/adoption/`, produced separately).

## 3. Capabilities

### 3.1 Connector SDK and catalogue

- **INT-R01** [MUST] Every connector is a `ConnectorDefinition` registered in code: vendor, product, supported
  versions, regions, category, **workflow capabilities** (`WorkflowCapability {workflow, operations: read | create |
  update | receive, sync: realtime | periodic | manual | file, status: supported | limited | unsupported |
  unverified, limitations[]}`), required credentials and authorization flow, vendor-side prerequisites (with
  responsible party), costs (who pays; amounts or **"quote required" / "unconfirmed"** — never shown as zero),
  local-agent requirement, data categories handled (PII yes/no; card data **never**), support owner and escalation,
  readiness level on the R1–R9 scale with technical and external-approval columns, evidence links, last verified
  date.
- **INT-R02** [MUST] Workflow identifiers (stable): `reservations`, `availability`, `rates`, `restrictions`,
  `guestProfiles`, `roomStatus`, `maintenance`, `posCharges` (room-charge eligibility, guest lookup, charge posting,
  corrections, taxes, tips, outlet attribution), `folioBalances`, `payments`, `journals`, `invoices`, `creditNotes`,
  `receivables`, `settlements`, `doorKeys`, `guestMessages`, `reviews`, `transfers`, `activities`, `businessDate`,
  `staffUsers`, `fiscal`, `guestRegistration`, `dataExport`. Workflows map to data-authority domains where one exists.
- **INT-R03** [MUST] The catalogue UI (all editions) shows, per connector and workflow, what Portico can **read**,
  **create**, **update** and **receive**, how (live / periodic every N min / manual / file), limitations, costs,
  prerequisites and readiness — a file export is labelled "File exchange — not a live connection" (adoption §6).
- **INT-R04** [MUST] Unsupported actions are explicit: when a workflow lacks an operation (e.g. PMS read-only), every
  Portico screen that would perform it explains the limitation and the manual alternative.
- **INT-R05** [MUST] Wave-1 connectors: **PMS simulator** (realistic Maldives data; failure injection: delays,
  duplicates, reorder, missing events, credential expiry, outages, vendor rejection), **generic CSV/XLSX file import**
  (guests, units, reservations, balances), **generic webhook/HTTP** receiver for partners, **accounting journal
  file export** (CSV with account mapping), and the framework hooks used by `distribution` (Channex hub, OTA
  simulator) and `payments` (PCI proxy). Real vendor PMS/POS connectors are prioritized from `docs/adoption/`
  coverage matrix; each starts at R1 until evidence exists.

### 3.2 Connection lifecycle and the setup journey

- **INT-R06** [MUST] Setup journey (adoption brief §7), persisted step by step and resumable by anyone with
  permission; each step shows its owner (hotel / Monoclay / vendor) and blocking items:
  1. **Select system** (search catalogue; "not listed" → request form with workflow needs).
  2. **Review compatibility, permissions, prerequisites and charges** — per workflow, with the data-authority
     options this connector supports (e.g. "can be system of record for reservations: read-only mirror only").
  3. **Authorize access** — OAuth consent, API key entry (masked, encrypted), or vendor approval request with
     tracking; credentials validated with a harmless call.
  4. **Review suggested mappings** (INT-R10).
  5. **Resolve flagged issues** — exceptions list with problem, business impact, responsible party, next step.
  6. **Run validation** — dry run: read a representative sample, transform, report counts, rejects and
     discrepancies; for write workflows, a sandbox or no-effect validation call where the vendor allows.
  7. **Preview expected behavior** — plain-language statement per workflow and the proposed data-authority
     matrix ("Every 2 minutes Portico reads new and changed reservations from <PMS> for Lagoon Resort. Room status
     changes made in Portico update <PMS> within 1 minute. Portico will not change rates in <PMS>.").
  8. **Activate approved scope** — selected workflows × properties × directions, effective time; requires
     `integration.connection.activate` ⚑; applies data-authority changes through `platform.setDataAuthority` in the
     same transaction; in `trial` only read workflows can activate.
  9. **Monitor health** — lands on the connection's health page.
- **INT-R07** [MUST] Connection states (§4) with scope stored as data; scope changes re-run steps 6–8 for the changed
  part only.
- **INT-R08** [MUST] Credentials are envelope-encrypted, never returned by the API after entry, never logged; expiry
  tracked with reminders (30/7/1 days) and an urgent exception at expiry; rotation with overlap where the vendor
  supports two valid credentials.
- **INT-R09** [MUST] **Safe pause, disconnect, rotate, replace** (adoption §9): each shows an impact preview first
  ("Pausing stops room-status updates to <PMS>: the front desk will see stale statuses for Lagoon Resort").
  Disconnect is refused while the connection is a system of record until authority is moved (platform preview +
  reconciliation). Replacement runs the new connection read-only in parallel ("shadow"), compares, then cuts over.

### 3.3 Mappings

- **INT-R10** [MUST] Mapping kinds: `property`, `unitType`, `unit`, `ratePlan`, `outlet`, `chargeCode`, `taxRule`,
  `ledgerAccount`, `status` (reservation/room status code sets), `paymentMethod`, `marketSegment`, `source`,
  `department`, `staffUser`. Suggestions come from exact code match, normalized name similarity, structural cues
  (counts per unit type, price levels) and previous reviewed mappings in the organization; each has a confidence
  and an explanation.
- **INT-R11** [MUST] **Financially significant** kinds (`chargeCode`, `taxRule`, `ledgerAccount`, `paymentMethod`)
  and any suggestion below the confidence threshold (default 0.9) require explicit review by a user with the
  relevant finance or configuration permission; accepted-without-review is impossible for them.
- **INT-R12** [MUST] Inbound records with unmapped references are **never silently dropped**: they are parked or
  stored with provenance `incomplete` and an exception naming the missing mapping and the records waiting on it;
  fixing the mapping re-processes them.
- **INT-R13** [MUST] Mappings are versioned; changing a mapping that already produced records shows the affected
  records and offers re-processing only for non-financial data (financial records are corrected by their module's
  correction flow, never rewritten).
- **INT-R14** [MUST] Measure mapping suggestion quality: per connection, share of suggestions accepted unchanged
  (adoption brief §14 metric).

### 3.4 Exchange, sync runs and forwarding

- **INT-R15** [MUST] **Exchange log** per record/message: connection, workflow, direction, external ref and version,
  outcome (`applied`, `duplicate`, `stale`, `parked`, `rejected`, `failed`), error class (`transient`, `permanent`,
  `mapping`, `data`, `auth`, `rate_limited`), timestamps (received, applied, acknowledged), retries, redacted
  payload reference (no card data, PII minimized), correlation to the Portico record.
- **INT-R16** [MUST] Inbound idempotency on `(connectionId, workflow, externalId, externalVersion | contentHash)`;
  out-of-order versions are stored as `stale` and not applied; per-aggregate ordering for inbound and outbound.
- **INT-R17** [MUST] **Sync runs** for periodic/manual/file workflows: cursor/watermark, counts (read, created,
  updated, unchanged, parked, failed), duration, result; delta by default, scheduled **full reconciliation reads**
  (e.g. nightly 400-day window for reservations) to self-heal drift; non-destructive tools: "re-read range",
  "re-push range", "re-request since T".
- **INT-R18** [MUST] **Forwarding** (data authority `forward`): module commands produce outbound commands with
  deterministic idempotency keys; states `queued → sent → acknowledged | rejected | unknown`; the originating
  record shows "pending in <system>" until acknowledged; `rejected` shows the vendor's reason translated to plain
  language and raises an exception; `unknown` triggers a read-back to resolve.
- **INT-R19** [MUST] **No blind replay**: after an outage, queued outbound commands that move money or change
  inventory/reservations are **re-validated** against current state (still needed? already applied by read-back?
  superseded?) before sending; others are sent in order. Reconnect never re-opens sold inventory or charges twice
  (adoption §8).
- **INT-R20** [MUST] Translation layer per connector handles identifiers, currencies, timezones, business dates,
  tax treatment (inclusive/exclusive), unit classification, transaction codes and status vocabularies through
  mappings and declared rules — never through ad-hoc code paths outside the connector.

### 3.5 Health and exceptions

- **INT-R21** [MUST] Health per connection and per workflow: `healthy | delayed | degraded | failing | paused |
  credentials_expiring | credentials_invalid | disconnected`; last successful exchange; current delay vs the
  workflow's **freshness SLA**; queue depth; oldest unacknowledged item; 24 h error rate; mapping problems;
  credential expiry; vendor-required changes (deprecations with dates); affected properties and **operational
  impact** text; recovery actions; usage and charges where available; support owner and escalation path.
- **INT-R22** [MUST] Data from a workflow beyond its freshness SLA is labelled `delayed` (with age) on every screen
  that shows it (CLAUDE.md rule 16). A failing connection never appears as synced.
- **INT-R23** [MUST] Exceptions (contract `raiseException`): severity `urgent | routine`, problem, business impact,
  responsible party (`hotel | monoclay | vendor`), next step, ref; deduplicated (repeat count), assignable,
  acknowledged/resolved with resolution; urgent ones notify property duty roles and appear in handover.
- **INT-R24** [MUST] **Integration management area** for property staff and a **portfolio view** for corporate
  teams: routine status separated from urgent problems; filters by property, category, workflow, severity.

### 3.6 Local connectors

- **INT-R25** [SHOULD] On-site agent for systems that cannot reach the cloud (legacy on-prem PMS, lock encoders):
  registration, heartbeat, version and update channel, supported OS/environments, installation responsibility,
  and documented outage behavior (what keeps working on site and in the cloud) shown in the catalogue (adoption §12).

### 3.7 Partner platform

- **INT-R26** [MUST] Outbound **webhooks** (`api.public`): self-serve subscriptions with topic wildcards and property
  filters, thin events (type, ids, version) + fetch, HMAC signatures with rotation, retries with backoff ≥ 24 h,
  delivery log, manual and range replay (7 days).
- **INT-R27** [SHOULD] Partner apps: registration, scopes as permission keys, consent screen per organization,
  sandbox organizations with representative sample data, change notices, production approval proportionate to
  risk, listing that shows demonstrated capabilities with readiness level (no implied certification), removal of
  unsafe or unsupported apps (adoption §13).
- **INT-R28** [LATER] Durable event stream with replay (`api.eventStream`); MCP server for AI agents with the same
  permission model.

### 3.8 Migration and data export (wave 2)

- **INT-R29** [MUST, wave 2] **Source assessment** before committing: what the source can export (legally and
  technically), vendor fees, access restrictions, historical limits, non-portable payment tokens — recorded per
  migration with owner sign-off.
- **INT-R30** [MUST, wave 2] Import job pipeline: upload/connect → preview → mapping (reusing INT-R10) → quality
  checks and duplicate detection (guests via `guests`) → **trial import** into a trial organization →
  reconciliation reports (reservations, deposits, open folios/balances, receivables, inventory) comparing source
  totals to imported totals → exception list with owners → re-run until accepted → staff acceptance sign-off →
  final change capture (delta) → cutover.
- **INT-R31** [MUST, wave 2] Never silently discard unsupported records or convert ambiguous financial data: such
  records go to the exception list or the **historical archive** (read-only, searchable, clearly labelled).
- **INT-R32** [MUST, wave 2] Opening balances import through migration suspense accounts in `finance`; differences
  against the source's closing balance are listed per booking/account (S18, E12).
- **INT-R33** [MUST, wave 2] Cutover plan with authoritative-system switch times per domain, handling of bookings
  arriving during cutover (channels paused or dual-captured), and **rollback that accounts for post-cutover
  activity** (export of Portico-created/changed records since cutover in a source-importable format + replay
  checklist); restoring a backup alone is never the plan (readiness §18, adoption §10).
- **INT-R34** [MUST, wave 2] **Data export (exit)**: complete organization export (all modules) in documented formats,
  available in every status until deletion; per-profile export for privacy requests (`guests`).

### 3.9 Targets (to be validated — adoption brief §14)

TARGETS, not claims; measured with the PMS simulator and later with pilot hotels:
time from catalogue selection to first successful **read-only** sync (simulator PMS) ≤ 30 min of hotel staff time;
≥ 80% of unit-type and rate-plan mapping suggestions accepted unchanged; realtime workflows p95 delay ≤ 60 s,
periodic workflows ≤ their interval + 60 s; recovery after a 1-hour vendor outage to `healthy` ≤ 15 min with zero
duplicate records; migration rehearsal for a 120-villa resort ≤ 1 working day elapsed.

## 4. Entities and states

`connector_definition` (code registry, versioned, mirrored to a table for catalogue queries) ·
`connection(id, property_ids[], connector_code, connector_version, status, scope jsonb, setup_step, setup_state jsonb,
owner_user_id, version)` · `credential(connection_id, enc_payload, kind, expires_at?, rotated_at)` ·
`mapping(connection_id, kind, external_id, external_label, internal_id?, confidence, suggested_by, reviewed_by?,
reviewed_at?, financially_significant, version)` · `exchange(id, connection_id, workflow, direction, external_ref,
external_version, outcome, error_class?, received_at, applied_at?, acked_at?, retries, payload_ref)` ·
`sync_run(id, connection_id, workflow, kind delta|full|manual|file, cursor_from, cursor_to, counts jsonb, status)` ·
`outbound_command(id, connection_id, workflow, aggregate_ref, idempotency_key UNIQUE, payload, status, attempts,
last_error?)` · `exception(id, connection_id, workflow, severity, problem, business_impact, responsible_party,
next_step, ref?, status, count, assignee?)` · `health_snapshot(connection_id, workflow, state, last_success_at,
delay_seconds, queue_depth, error_rate)` · `agent(id, connection_id, version, last_heartbeat)` ·
`webhook_subscription`, `webhook_delivery` · wave 2: `import_job`, `import_record`, `reconciliation_report`,
`archive_item`, `export_job`.

**Glossary "Integration status" mapping:** `supported` = a connector definition exists for the workflow; `configured` =
setup journey completed through step 5 for a property; `tested` = step 6 validation passed (sandbox or no-effect
calls); `live` = connection `active` in a `live` organization exchanging production data. These are never collapsed and
are reported alongside the R1–R9 readiness level.

**Connection:** `draft → authorizing → mapping → validating → ready → active` (setup steps 1–8) ·
`active ⇄ paused` (with impact preview) · `active → degraded → active` (automatic by health) ·
`active|paused → credentials_invalid → authorizing` (re-authorize) · `active|paused → disconnecting → disconnected`
(requires no system-of-record authority; terminal; data and logs retained per policy). Any setup state may return to
an earlier step; progress is never lost.

**Outbound command:** `queued → sent → acknowledged | rejected | unknown` · `unknown → acknowledged | rejected`
(read-back) · `queued → revalidating → queued | cancelled` (after outage; INT-R19) · `rejected → queued` (manual
retry after fix, new attempt same key).

**Exception:** `open → acknowledged → resolved` · `open → resolved` · `open|acknowledged → ignored` (reason,
routine only).

**Import job (wave 2):** `draft → previewed → mapped → trial_imported → reconciled → accepted → final_capture →
cut_over` · any → `abandoned` · `cut_over → rolled_back` (with post-cutover export).

## 5. Invariants

- **INT-I01** An inbound external record version is applied at most once; replays are `duplicate` (S02, E02).
- **INT-I02** No inbound record is dropped: each exchange ends `applied`, `duplicate`, `stale`, `parked`, `rejected` or
  `failed`, and every non-applied, non-duplicate outcome has an open exception or a documented auto-retry.
- **INT-I03** An outbound command is sent with the same idempotency key on every attempt; money- or inventory-moving
  commands are never sent after an outage without passing re-validation.
- **INT-I04** A connection cannot be `disconnected` while referenced by a data-authority row as `external`.
- **INT-I05** Financially significant mappings used by any applied record were reviewed by a permitted user.
- **INT-I06** Credentials never appear in API responses, logs, events, exports or AI context.
- **INT-I07** In `trial`, no outbound command runs (`integration.write` blocked); in demo/training all exchanges are
  simulated and labelled.
- **INT-I08** Health never reports `healthy` for a workflow whose last success is older than its freshness SLA.
- **INT-I09** (wave 2) Reconciliation reports sum exactly to imported records; any difference is an exception.

## 6. Cross-module interactions

Provider contract (domain map on main): `getConnection`, `listConnections`, `getMapping`, `recordExchange`,
`raiseException`, `resolveException`, `markHealthy`, `markDegraded`. Proposed additions below. Calls `platform`
(properties, data authority, environment), `identity` (API clients, authorization). Module **inbound handlers** are
registered by owning modules (e.g. `reservations` registers the `reservations` mirror handler, `operations` registers
`roomStatus`), so integration never writes other modules' tables. Consumers: every module that forwards or mirrors;
`distribution` builds channel connections on this framework; `analytics` reads health facts.

### Proposed contract changes

1. `registerWorkflowHandler(workflow, { applyInbound(tx, record), buildOutbound(tx, command) })` per module (port).
2. `forward(tx, { propertyId, domain, workflow, aggregateRef, payload, idempotencyKey })` returning
   `{ commandId, status: 'queued' }` — used by modules when `assertWritable` returns `'forward'`.
3. `getFreshness(tx, { propertyId, workflow })` → `{ lastSuccessAt, delaySeconds, provenance: 'external'|'delayed' }`.
4. `previewConnectionChange(tx, { connectionId, action: 'pause'|'disconnect'|'scope', ... })` impact statements.
5. `listExceptions(tx, { propertyId, severity? })` in the common exception shape (shared with Day Close/handover).

## 7. Events

Domain map: `integration.connection.statusChanged`, `integration.exception.raised|resolved`,
`integration.mapping.changed`. Proposed: `integration.syncRun.completed`, `integration.forward.acknowledged|rejected`,
`integration.credentials.expiring`, `integration.webhookDelivery.failed`, `integration.import.reconciled` (wave 2).
Consumed: `platform.dataAuthority.changed`, module events that trigger outbound workflows (e.g.
`operations.unit.conditionChanged` → `roomStatus` push), `identity.membership.removed` (revoke partner access).

## 8. Permissions

`integration.catalogue.read` · `integration.connection.read` · `integration.connection.manage` ⚑ ·
`integration.connection.activate` ⚑ · `integration.credentials.manage` ⚑ · `integration.mapping.review` ·
`integration.mapping.reviewFinancial` ⚑ · `integration.exception.resolve` · `integration.syncRun.trigger` ·
`integration.webhook.manage` ⚑ (org) · `integration.app.manage` ⚑ (org) · `integration.import.run` ⚑ (wave 2) ·
`integration.export.run` ⚑ (org).

## 9. UX surfaces

Catalogue (workflow matrix per system, costs, prerequisites, readiness); Setup journey (stepper with saved progress,
owner per step, plain-language errors with impact/responsible party/next step — never raw payloads for hotel
staff); Mapping review (side-by-side, confidence chips, "needs finance review" badges, bulk accept for
high-confidence non-financial items); Connection health (per workflow tiles, timelines of delay, recovery buttons);
Integration management area and portfolio view (urgent band above routine list); Exchange log for technical users
(payload view redacted, permission-gated). Wave 2: Migration workspace (assessment, runs, reconciliation, sign-off,
cutover checklist).

## 10. Proof scenarios and evidence

| ID | Integration must demonstrate |
|---|---|
| S02 / E02 | Duplicate, delayed, reordered inbound records → one effect; stale versions stored, not applied. |
| S20 | Connection outage mid-shift: health `failing`, `delayed` labels, impact text, queued outbound re-validated on recovery. |
| E03 | Missing bookings recovered after an outage via "re-request since T" / full reconciliation read; none duplicated. |
| E04 | Expired credentials and revoked hotel authorization: urgent exception, affected workflows paused, re-authorize journey resumes without losing mappings. |
| E13 | Vendor suspends API access: impact preview, authority domains flagged, manual fallbacks shown. |
| S18 / E12 | (wave 2) Migration deposit mismatch reported per booking; nothing balanced silently. |
| A01–A07 | Adoption evidence (`docs/scenarios/README.md` §3): trial isolation, read-only connection, module-only adoption, authority switch, setup journey resume and mapping accuracy, no blind replay, pilot scope. |

## 11. Maldives specifics

Maldivian resorts commonly run established on-premise or hosted PMS and POS systems and separate accounting; the
first realistic adoption path is connected mode (housekeeping, messaging, transfers, reporting) with a read-only or
room-status-push PMS connection. Island connectivity makes freshness labelling and offline-tolerant agents important.
Which vendors to prioritize comes from the coverage matrix in `docs/adoption/` — no vendor is claimed as supported here.

## 12. Competitive inspirations

- Self-serve webhooks with wildcards/property filters and consent-screen apps — Apaleo (research 02 §3.3.1, §3.6);
  avoid support-gated registration — Mews (research 02 §2.8 item 1); avoid professional-services-gated streaming
  and NDA-gated APIs — OPERA OHIP, Agilysys (research 01 §2.4, §6.4, §8).
- 7-day event replay and field selection — OHIP (research 01 §2.6).
- Mapping completeness counters, delivery-timeout escalation, replay/flush tools, distribution health console —
  SiteMinder (research 03 §4.3, §9.3); non-destructive resync instead of "unlist/relist" — Guesty anti-pattern
  (research 03 §6.3).
- Migration factory and dual-run reconciliation; avoid data loss during migration — Shiji/Agilysys (research 01
  §5.2, §6.6); never charge for reservation import — Cloudbeds anti-pattern (research 03 §3.7).
- Shadow-mode channel connections before cut-over — research 03 §11.

## 13. Open questions

None for the owner in wave 1. Vendor access, fees and approvals per connector are tracked in the external dependency
register (readiness §3), not here.

## 14. Adoption modes

- **Standalone alongside an external PMS:** this module *is* the adoption mechanism; present in every path.
- **Hard dependencies:** `platform` (properties, data authority, environments), `identity` (API clients, consent).
- **Connected mode:** provides mirrors (inbound handlers), forwarding (outbound commands), freshness/provenance, and
  exceptions for every other module.
- **Data-authority domains:** owns none; it is the `connection` behind every `external` authority and enforces the
  write mode on the wire.
- **Trial:** read-only connections only; trial import (wave 2) creates the trial organization's copied data.
