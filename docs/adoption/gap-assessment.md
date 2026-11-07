# Integration and adoption gap assessment

> Deliverable 1 of the adoption brief (`docs/product/adoption-integration-brief.md` §15).
> Status date: 2026-11-07. Owner: Integration & Adoption lead.
> Evidence labels are defined in [README.md](README.md#evidence-labels).

## 1. Purpose

This assessment compares what exists in the repository today with what the adoption brief requires. It tells
the rest of the team which foundations are reusable, which are missing, and which gaps are internal
(we can build them) versus external (we need a vendor, a hotel or the owner).

The bottom line: **the foundation has the right three primitives** (data authority, environments with an
effect policy, and provenance labels), but **nothing that connects to, imports from, or evaluates against
a real hotel system exists yet**. Every integration and migration capability is at readiness **R1 (planned)**.

## 2. What exists now (inspected 2026-11-07)

| Area | What is implemented | Where | Reusable for adoption? |
|---|---|---|---|
| Organizations and environments | `platform.tenants.environment` ∈ `live`, `trial`, `sandbox`, `training`, `demo`; `live_tenant_id` links a trial/training/sandbox organization to its live organization | `modules/platform/migrations/0001_platform.sql` | Yes: trial is a separate organization, so trial data is isolated by RLS. |
| External-effect policy | `assertExternalEffectAllowed(ctx, effect)` with modes `live`/`sandbox`/`simulate`/`blocked` for 10 effects, per environment | `packages/kernel/src/environment.ts` | Yes: the backbone of evaluation safety. Gaps G-03, G-04. |
| Provenance type | `Provenance = live / simulated / copied / delayed / incomplete / external` | `packages/kernel/src/context.ts` | Yes: a type only, no rendering or freshness rules yet (G-05). |
| Data authority | `platform.data_authority` per property and domain (9 domains), `authority` portico/external, `write_mode` exclusive/forward/read_only, `assertWritable`, `setDataAuthority` with audit and event `platform.dataAuthority.changed` | `modules/platform/src/service.ts` | Yes: the backbone of the source-of-truth matrix. Gaps G-01, G-02, G-06. |
| Property lifecycle | `platform.properties.status` ∈ `setup`, `pilot`, `active`, `inactive` | platform migration | Yes: maps to pilot and production activation. Not yet linked to effects (G-04). |
| Central policies with local overrides | `platform.policies`, `resolvePolicy`, `previewPolicyChange` (shows affected and overridden properties) | platform service | Yes: central integration policies (rollout requirements §4). |
| Plans and entitlements | Four editions, every one built on the full PMS core; limits on properties/units/users | `modules/platform/src/domain/plans.ts` | Partly: no packaging for standalone (connected-mode) modules (G-14). |
| Identity and API clients | Users, memberships, scoped roles, sessions, `identity.api_clients` (hashed secret, permission list, property list, expiry) | `modules/identity/migrations/0001_identity.sql` | Partly: fine for a hotel's own scripts; no partner apps, OAuth consent or cross-organization app registry (G-12). |
| Platform rails | Transactional outbox, idempotency store, optimistic concurrency, append-only audit, RLS tenant transactions | `packages/db/src/*` | Yes: exchange log, outbound operations and replay protection should be built on these rails. |
| Integration module | Listed in the domain map (wave 2) with connectors, import jobs, reconciliation, export | `docs/architecture/domain-map.md` | **Not started.** No tables, contracts or code. |
| Sample data (D8) | Decided: Maldives guesthouse, ~120-villa resort, 3-property group | `docs/product/decisions.md` | **Not built.** Needed for the demo stage. |

## 3. Top gaps (ranked by effect on the adoption ambition)

| # | Gap | Why it matters | Type | Resolution |
|---|---|---|---|---|
| 1 | No integration module (connections, credentials, mappings, exchange log, exceptions, health) | Nothing can connect, so no adoption path except a manual full migration works | Internal | Build per [connection-lifecycle-and-health-spec.md](connection-lifecycle-and-health-spec.md); module spec lives in `docs/specs/integration.md` (product/specs agent) |
| 2 | No import job engine or reconciliation | Trials with the hotel's own data and every migration depend on it | Internal | [migration-acceptance-criteria.md](migration-acceptance-criteria.md) |
| 3 | No external access yet to any hotel system API (OHIP, Mews, Cloudbeds, Channex production, POS, locks) | All connected-mode modules stop at R3/R4 until access is granted | External | [roadmap.md](roadmap.md) critical path; Q61 |
| 4 | Effect policy is per environment only; the pilot stage has no narrower scope | A live-environment pilot would allow every effect for every property | Internal | G-04 below; activation scope in the lifecycle spec |
| 5 | Data authority cannot express a transition (cutover freeze) and keeps no version history | Moving authority during migration can create a window where two systems write | Internal | G-02; [source-of-truth-matrix.md](source-of-truth-matrix.md) §6 |
| 6 | No demo dataset or simulators (PMS, channel, POS, payment, lock) | Stage 1 of evaluation cannot exist; integration tests cannot exercise failure cases | Internal | [evaluation-and-trial.md](evaluation-and-trial.md) §3 |
| 7 | Maldives-specific provider usage is unverified (which PMS, POS, accounting, payment acquirers hotels actually use) | Priority tiers rest on assumptions | External (discovery) | Q64; [integration-coverage-matrix.md](integration-coverage-matrix.md) §2 |
| 8 | Standalone modules have no commercial packaging | Path A and B offers cannot be sold or limited | Owner decision | Q60 |
| 9 | No partner/app model (OAuth consent, scopes per property, sandbox org for partners) | Ecosystem brief §13 cannot start | Internal | [ecosystem-and-developer-experience.md](ecosystem-and-developer-experience.md) |
| 10 | Local (on-site) connector does not exist and its support obligation is undecided | Door locks, legacy POS and OPERA 5.x cannot connect | Internal + owner | [rollout-requirements.md](rollout-requirements.md) §5; Q62 |

## 4. Gap table by brief section

Columns: **Exists** = implemented now; **Gap** = what is missing; **Where resolved** = the document in this
folder that specifies the answer (implementation is then tracked in `docs/readiness/readiness-register.md`).

| Brief § | Requirement (short) | Exists | Gap | Where resolved |
|---|---|---|---|---|
| 1 | Easiest to evaluate, integrate, adopt; measurable | Brief and principles only | No baselines, no targets, no measurement plan | [success-metrics.md](success-metrics.md) |
| 2 | Three adoption paths; documented module dependencies; one controlling system per domain | Data authority table, `assertWritable` | No module dependency catalogue; no per-path authority presets; `guestCommunications` not governed; transition protocol missing | [adoption-paths.md](adoption-paths.md), [source-of-truth-matrix.md](source-of-truth-matrix.md) |
| 3 | Distinct evaluation stages; labeling; no accidental effects; reset/export/delete; carry-forward | Environments, effect policy, provenance type | No pilot scope; no trial lifecycle (expiry, reset, delete); no carry-forward rules; no UI labels | [evaluation-and-trial.md](evaluation-and-trial.md) |
| 4 | Show value with the hotel's own operation; discrepancies, not silent correction | Nothing | Comparison reports, discrepancy workflow, configuration "what-if" validation | [evaluation-and-trial.md](evaluation-and-trial.md) §7 |
| 5 | Maintained catalogue, prioritized by real customers; no logo counting | Research files 01–04 | No provider × workflow catalogue; Maldives usage unverified | [integration-coverage-matrix.md](integration-coverage-matrix.md) |
| 6 | Workflow-level definitions; read/create/update/receive-changes; sync mode; unsupported behavior | Nothing | Workflow catalogue | [integration-coverage-matrix.md](integration-coverage-matrix.md) §3 |
| 7 | 9-step setup journey, mapping suggestions, preserved progress, actionable errors | Nothing | Whole journey | [connection-lifecycle-and-health-spec.md](connection-lifecycle-and-health-spec.md) §2–§5 |
| 8 | Business meaning preserved; duplicates, lost updates, outages; no blind replay | Idempotency store, outbox, optimistic concurrency | Exchange log, ordering rules, outbound-operation verification, replay policy | [connection-lifecycle-and-health-spec.md](connection-lifecycle-and-health-spec.md) §8–§9 |
| 9 | One integration management area for property and corporate | Nothing | Integration console, urgent vs routine separation, safe pause/disconnect/rotate/replace | [connection-lifecycle-and-health-spec.md](connection-lifecycle-and-health-spec.md) §6–§7 |
| 10 | Migration as product capability | Nothing | Feasibility, mapping, quality, rehearsal, reconciliation, cutover, rollback, archive | [migration-acceptance-criteria.md](migration-acceptance-criteria.md) |
| 11 | Small-property simplicity and enterprise control | Policies with overrides and preview; brand/region/legal-entity structure; scoped roles | Templates, bulk setup, rollout groups, separation of duties for integrations, cost allocation, enterprise SSO (planned in identity) | [rollout-requirements.md](rollout-requirements.md) |
| 12 | Cloud first; explicit local connectors; outage behavior | Cloud-only architecture | Local connector product, supported environments, responsibilities | [rollout-requirements.md](rollout-requirements.md) §5–§6 |
| 13 | Extensible ecosystem | `identity.api_clients` (hotel-own clients) | Partner apps, consent, sandbox orgs, versioning, change notices, removal | [ecosystem-and-developer-experience.md](ecosystem-and-developer-experience.md) |
| 14 | Baselines and testable targets | Nothing | All 12 metrics | [success-metrics.md](success-metrics.md) |
| 15 | Prioritize representative setups; separate internal vs external | Nothing | Roadmap | [roadmap.md](roadmap.md) |

## 5. Findings in the implemented foundation (recommended changes)

These are engineering findings, not owner questions. Each should become an ADR in `docs/adr/` owned by the
architecture steward. None requires rebuilding working functionality; all are additive.

### G-01 — `write_mode = 'exclusive'` with an external authority is ambiguous

`assertWritable` treats an external authority with `exclusive` exactly like `read_only` (both throw
`external_system_of_record`). The comment in the migration says "exclusive: only the authority writes", which,
for an external authority, is what `read_only` already expresses.

**Recommendation:** use exactly three combinations and reject the fourth in `setDataAuthority`:

| authority | write_mode | Meaning in plain English |
|---|---|---|
| portico | exclusive | Portico is the system of record. External systems may only change this information through Portico's API (subject to its rules). |
| external | read_only | The other system is the system of record. Portico shows a copy labeled `external` with the last-sync time and offers no write actions. |
| external | forward | The other system is the system of record. Portico offers the action, sends it, and shows it as **pending** until the other system confirms. |
| external | exclusive | **Reject** with "Use read-only or forward for an external system of record." |

### G-02 — No authority transition state and no version history

`setDataAuthority` overwrites the row (`effective_from` is replaced). Audit records the before/after, but there
is no queryable history and no state for "neither system may write while authority moves".

**Recommendation:** add `platform.data_authority_history` (append-only, one row per version with
`effective_from`/`effective_to`) and a transition record with states `planned → frozen → effective` (or
`cancelled`). While `frozen`, `assertWritable` returns a dedicated error `authority_transition_in_progress`
with the expected end time, and the integration queues inbound changes for replay after the switch
(protocol in [source-of-truth-matrix.md](source-of-truth-matrix.md) §6).

### G-03 — `integration.read` is `live` for every trial connection

The trial policy allows `integration.read: live`, which is correct only for connections the hotel has
authorized as read-only. The policy itself cannot know that.

**Recommendation:** the integration module must additionally require, before any read in a trial
organization, that the connection's approved scope contains only read workflows and that its credential was
issued for read-only use where the vendor supports such scopes. Where a vendor cannot issue read-only
credentials, the connection is labeled "vendor credential permits writes; Portico blocks them" so the hotel
understands the residual risk.

### G-04 — No pilot scope: the effect policy ignores property status

A pilot runs in the `live` environment, where every effect is `live`. The brief requires a pilot with
"narrowly defined permissions and scope".

**Recommendation:** add an **activation scope** check after the environment check: an effect is allowed in
`live` only if the property's approved activation scope includes it (per connection and workflow). Property
status `setup` permits no live external effects except approved `integration.read`; `pilot` permits only the
effects listed in the approved pilot scope; `active` permits the approved production scope. Specified in
[evaluation-and-trial.md](evaluation-and-trial.md) §6 and
[connection-lifecycle-and-health-spec.md](connection-lifecycle-and-health-spec.md) §2 (step 8) and §11.

### G-05 — Provenance has no freshness rule

`Provenance` exists as a type. Nothing decides when `external` becomes `delayed`, or when a list is
`incomplete`.

**Recommendation:** every connected workflow declares a freshness target (e.g. reservations 2 minutes, room
status 1 minute; see [success-metrics.md](success-metrics.md) M-09). Data older than the target is shown as
`delayed` with its age; a stream with a detected gap (missing sequence, failed reconciliation) is shown as
`incomplete` until reconciled.

### G-06 — Missing governed domain: automated guest communications

The brief requires preventing "duplicate or contradictory replies from different departments". When a hotel
keeps an external messaging tool alongside Portico (or migrates away from one), two systems could send the
same pre-arrival message.

**Recommendation:** add a tenth domain `guestCommunications` (who sends automated and transactional guest
messages for a property). Rules in [source-of-truth-matrix.md](source-of-truth-matrix.md) §3.

### G-07 — Database constraint does not match the service rule

The check `((authority = 'external') = (connection_id is not null) or authority = 'external')` allows an
external authority without a connection; only the service prevents it. Not harmful today, but a future direct
insert (migration script, support tool) could create an authority with no connection. **Recommendation:** in
a new migration, replace it with `(authority = 'portico' and connection_id is null) or (authority =
'external' and connection_id is not null)` and add the foreign key once `integration.connections` exists.

### G-08 — Documentation drift

- `CLAUDE.md` rule 12 says `assertExternalEffectAllowed` comes from `@portico/db`; it is exported from
  `@portico/kernel` (`packages/kernel/src/environment.ts`).
- `docs/product/glossary.md` lists only `live`, `training` and `demo` environments; the code also has `trial`
  and `sandbox`. Proposed glossary additions are in [README.md](README.md#proposed-glossary-additions).

### G-09 to G-14 — Missing capabilities (not defects; planned work)

| # | Missing capability | Specified in |
|---|---|---|
| G-09 | `integration` module: connections, credential references, workflow activations, mappings, exchange log, outbound operations, exceptions, health, console | [connection-lifecycle-and-health-spec.md](connection-lifecycle-and-health-spec.md) |
| G-10 | Import engine, reconciliation reports, cutover journal | [migration-acceptance-criteria.md](migration-acceptance-criteria.md) |
| G-11 | Demo dataset (D8) and simulators (hub, PMS, POS, payment, lock, messaging) | [evaluation-and-trial.md](evaluation-and-trial.md) §3 |
| G-12 | Partner app model: OAuth consent per organization/property, cross-organization app registry, partner sandboxes. `identity.api_clients` covers only a hotel's own clients | [ecosystem-and-developer-experience.md](ecosystem-and-developer-experience.md) |
| G-13 | Local connector (on-site software) | [rollout-requirements.md](rollout-requirements.md) §5 |
| G-14 | Packaging for standalone modules: every edition in `plans.ts` is built on the full PMS core, and `limits.properties = 1` on Essentials would block a 3-property group adopting only housekeeping | Q60; `docs/product/editions.md` (product agent) |

## 6. Gaps that are external (cannot be closed by engineering alone)

| Dependency | Needed for | Current state | Owner | What proceeds meanwhile |
|---|---|---|---|---|
| Channex production access and PMS certification | Distribution in RS-1, RS-2 | Planning baseline only (owner brief §5) | Monoclay + Channex | Channel simulator; Channex staging (free per owner brief §5, to re-verify) |
| Oracle OHIP partner access for OPERA Cloud | RS-3 connected mode | Not applied (Q61) | Owner | OPERA simulator built from public OHIP docs |
| OPERA 5.x on-premise interface rights (OXI/OWS or other) | RS-3 variant, OPERA 5 migrations | Unconfirmed | Owner + Oracle | File-based migration path |
| POS vendor interface (e.g. Oracle Simphony, Shiji Infrasys) | RS-2 | Unconfirmed | Owner + vendor + hotel | POS simulator; manual posting fallback |
| Door-lock vendor SDK/licensing (ASSA ABLOY Vingcard, Salto, dormakaba) | RS-2 key issuance | Unconfirmed | Owner + vendor + hotel | Manual alternative: encode in lock vendor's own software |
| Payment acquiring for Maldivian legal entities | RS-1, RS-2 guest payments | Q2 open | Owner | Payment simulator; "external terminal" recording |
| WhatsApp Business Platform sender approval | Messaging (all setups) | Unconfirmed | Hotel (sender identity) + Monoclay (provider account) | Email channel; simulator |
| A named pilot hotel | Every level above R6 | None (D8) | Owner | Everything up to R4 |
| Network access to vendor documentation hosts in research sessions | Verifying vendor claims | Blocked in this session (e.g. `channex.io`, `developer.xero.com`, earlier `docs.mews.com`, `docs.oracle.com`) | Orchestrator / environment settings | Claims stay labeled unconfirmed |

## 7. What this assessment does not cover

- Product and module gaps unrelated to integration (front desk, finance depth): `docs/product/` and
  `docs/specs/` (product strategy agent).
- External dependency register, provider costs, certification and market matrices:
  `docs/readiness/dependency-register.md`, `docs/readiness/certification-matrix.md`,
  `docs/readiness/market-matrix.md` (operational readiness agent). This folder references them and does
  not duplicate them.
