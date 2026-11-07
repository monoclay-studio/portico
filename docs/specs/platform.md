# Spec: platform

Status: Draft v2 · 2026-11-07 · Wave 0 → 1 · Schema `platform` · Prefix `PLT`
Aligned with the foundation on `main` (commit 02f4e14: `modules/platform`, `packages/kernel/src/environment.ts`).

## 1. Purpose

`platform` is the root of every other module's world: *who* the organization is, *which* environment we are in,
*what* properties, legal entities, owners, departments and outlets exist, *what* the organization is entitled
to use, *which* policy value applies to a property and why, *which system is the system of record* for each data
domain, and *what business date* a property is on. It is what lets one product serve a 6-room guesthouse, a hotel
that keeps its existing PMS and adopts one Portico module, and a multi-brand group.

## 2. Scope and non-goals

**In scope:** organizations (tenants), environments (`live`, `trial`, `sandbox`, `training`, `demo`), brands,
regions, properties (profile, classification, timezone, currencies, business date, status), legal entities,
owners and unit ownership shares, departments, outlets, plans/editions/entitlements/limits/usage meters, policies
with inheritance and local overrides, feature visibility, **data authority** per property per domain,
configuration templates and property cloning.

**Non-goals:** staff users and permissions (`identity`); connections, mappings and sync (`integration` — platform
only records *which* connection is authoritative); Monoclay's SaaS invoices (`billing`); chart of accounts and
invoice series (`finance`); unit types and units (`inventory`); owner statements (`finance`, LATER).

## 3. Capabilities

### 3.1 Organizations and environments

- **PLT-R01** [MUST] An organization is the tenant: the hard isolation boundary for data and money. Every
  tenant-owned row in every module carries `tenant_id`; RLS is enabled and forced (architecture rule 4).
- **PLT-R02** [MUST] Each organization row has one `environment ∈ {live, trial, sandbox, training, demo}`. A hotel
  company's live, trial, training and demo environments are **separate organizations (tenants)** linked by an
  environment group; they never share rows, sequences, payment accounts or credentials.
- **PLT-R03** [MUST] Every non-live environment shows a persistent, non-dismissable banner naming the environment
  and what it can and cannot do ("Trial — copy of Lagoon Guesthouse data as of 3 Nov 14:20; read-only link to
  your PMS; nothing you do here reaches guests, cards, channels or your PMS").
- **PLT-R04** [MUST] Environment safety uses the kernel policy `effectMode(ctx, effect)` /
  `assertExternalEffectAllowed(ctx, effect)` (`packages/kernel/src/environment.ts`), effects `payment.charge`,
  `message.guest`, `message.staff`, `channel.publish`, `government.submit`, `ai.inference`,
  `credentials.production`, `access.key`, `integration.read`, `integration.write`; modes `live | sandbox |
  simulate | blocked`. In `live`, effects are additionally subject to configuration (connection active,
  sender verified, owner authorization flag for `government.submit` per property). Results produced in a
  non-live mode carry the provenance `simulated` (or `sandbox`) (CLAUDE.md rule 16).
- **PLT-R05** [MUST] **Trial environment** (adoption brief §3): an isolated organization holding an **authorized
  copy** of one hotel's data (imported via `integration`), optionally with **read-only** connections to the
  hotel's real systems (`integration.read` = live, `integration.write` = blocked). Trial data carries provenance
  `copied` with the copy timestamp. Trials can be **reset** (re-copy), **exported** and **deleted** by the hotel
  (subject to retention obligations, Q44). A **carry-forward manifest** lists which configuration may be promoted
  to live (unit types, units, rate structures without prices in effect, policies, charge codes, departments,
  outlets, mappings reviewed in trial) and which never moves (reservations, guests, money, credentials).
- **PLT-R06** [MUST] Training environments clone live **configuration** plus generated sample data; demo
  environments load the Maldives sample datasets (decision D8). Sandbox environments serve integrators.
- **PLT-R07** [MUST] Organization status `active | suspended | closed` (as implemented). `suspended` is set only
  by a Monoclay operator with reason and ≥ 30 days' recorded notice when properties have in-house guests; while
  suspended, creating new bookings and postings is blocked, but check-out, payment collection for existing
  stays and **data export** remain available. `closed` starts the export-then-deletion schedule (brief §16).

### 3.2 Portfolio structure

- **PLT-R08** [MUST] Hierarchy: Organization → optional Brands → optional Regions (nestable, max depth 4) →
  Properties. Multi-level hierarchy and brand/region policy levels are `portfolio.policies`; without it the
  organization has a flat list of properties and policy levels collapse to organization → property.
- **PLT-R09** [MUST] Moving a property between brands/regions is audited and previewed (which inherited policy
  values change).
- **PLT-R10** [MUST] `limits.properties` counts properties in status `pilot` or `active`; exceeding it at
  activation returns an explanatory error naming the limit and edition.

### 3.3 Properties

- **PLT-R11** [MUST] Property attributes (as implemented, plus): code, name, profile, legal entity, brand/region,
  country, timezone (IANA), base currency, accepted currencies, classification (jurisdiction key/values), business
  date, check-in/out times, unit noun defaults, languages, address (atoll/island for the Maldives), version.
- **PLT-R12** [MUST] **Property profile** ∈ `guesthouse`, `boutique_hotel`, `hotel` (full-service hotel),
  `resort`, `serviced_apartments`, `hostel`. The profile supplies policy and feature-visibility defaults
  (`docs/product/editions.md` §6); it never grants entitlements; changing it is previewed and deletes nothing.
- **PLT-R13** [MUST] **Classification** is the tax-relevant attribute (e.g. `mv.establishmentType`,
  `mv.inhabitedIsland`, `mv.roomCount`); tax rules reference classification, never profile. Changes are
  effective-dated (proposed: history table) so historical tax computations stay reproducible.
- **PLT-R14** [MUST] **Property status** `setup → pilot → active → inactive` (§4.2). `pilot` = controlled live
  operation with an explicit **pilot scope** (enabled workflows/modules, permitted users, data-authority settings,
  start/end dates, success criteria) recorded on the property. Activation (`pilot → active` or `setup → active`)
  runs a readiness checklist contributed by modules (tax pack verified, payment account configured, mappings
  complete, connections healthy, staff trained flag) and shows blockers vs warnings. **Activation is per
  property**: a successful pilot at one property never activates another (adoption brief §11).
- **PLT-R15** [SHOULD] Clone a property's configuration into a new `setup` property; bulk-create properties from
  a template with validation report (enterprise rollout, adoption brief §11).

### 3.4 Legal entities and owners

- **PLT-R16** [MUST] Legal entity: name, legal name, registration number, tax id, country, base (functional)
  currency, address. A property has exactly one operating legal entity at any time; changes are effective-dated
  by business date and never rewrite history (finance keys ledgers by legal entity).
- **PLT-R17** [SHOULD] Owners and effective-dated unit ownership shares (basis points; ≤ 10000 per unit-period)
  for owner accounting (`owners.accounting`, LATER).

### 3.5 Departments and outlets

- **PLT-R18** [MUST] Departments per property from a template by profile; departments own tasks and
  conversations and have an escalation role.
- **PLT-R19** [MUST] Outlets per property: kind (`restaurant`, `bar`, `spa`, `dive_center`, `excursions`,
  `boutique`, `transfer_desk`, `in_villa_dining`, `other`), hours, default charge codes, accepts-room-charge flag.

### 3.6 Plans, entitlements, limits, usage

- **PLT-R20** [MUST] Each organization has a plan (`essentials`, `professional`, `resort`, `enterprise`, and the
  proposed `connect` plan for module-only adoption) + add-ons + contract overrides, resolving to feature keys and
  limits. Canonical keys: `docs/product/editions.md` (which also lists required changes to
  `modules/platform/src/domain/plans.ts`). Prices are not stored here (Q3).
- **PLT-R21** [MUST] Entitlements are checked server-side (`requireEntitlement` → `EntitlementError`
  `feature_not_enabled`).
- **PLT-R22** [MUST] Property-scoped add-ons (e.g. `resort.transfers` for one property of a group).
- **PLT-R23** [MUST] **Downgrade never deletes data**; features become read-only with an explanatory banner.
- **PLT-R24** [MUST] Usage meters (`usage.messages`, `usage.aiCredits`) with hard caps distinct from notification
  thresholds; reaching a cap blocks only the metered effect (`usage_cap_reached` with recovery text) and never
  reservations, payments, check-in/out or Day Close (E14).

### 3.7 Policies, inheritance and local overrides

- **PLT-R25** [MUST] Policy catalog registered by modules (key, schema, default, allowed levels, lockable,
  sensitivity, owning module).
- **PLT-R26** [MUST] Resolution (as implemented): `default → organization → brand → region → property`, returning
  value, source and `isLocalOverride`. Proposed: a `profile` layer between `default` and `organization`.
- **PLT-R27** [MUST] Locks (`portfolio.policies`): a higher level can lock a lockable policy; existing overrides are
  reported and either kept as recorded exemptions or removed — never silently deleted.
- **PLT-R28** [MUST] **Portfolio change preview** before saving any organization/brand/region value (implemented as
  `previewPolicyChange`): affected properties partitioned into *will change*, *unchanged — local override*,
  *unchanged — already equal*, *exempt*. Never gated. Saving with a stale preview → 409 and recompute.
- **PLT-R29** [MUST] Policy history (who, when, reason, before/after, effective from); scheduled changes and
  staged rollout groups (`portfolio.policies`; adoption brief §11 "controlled changes that do not disrupt an
  entire portfolio").
- **PLT-R30** [MUST] Override report per policy and property (all editions with ≥ 2 properties).

### 3.8 Business date

- **PLT-R31** [MUST] Business date per property changes only via `advanceBusinessDate(tx, propertyId, expected)`
  (permission `platform.businessDate.advance`), called by `day-close`; optimistic on `expected`.
- **PLT-R32** [MUST] Advance from D to D+1 is rejected before `dayClose.earliestStartLocalTime` on D (policy,
  default `22:00`); a lag ≥ 1 day raises a manager-visible exception.
- **PLT-R33** [MUST] Advancing never logs anyone out or blocks other commands; postings take the business date
  current at commit.
- **PLT-R34** [MUST] When `reservations` authority is external (connected mode), policy
  `platform.businessDate.source = external` makes the business date **mirror** the external system's (received by
  `integration` with provenance `external`); Day Close is then disabled for that property.

### 3.9 Data authority (system of record)

- **PLT-R35** [MUST] For each property and domain (`reservations`, `availability`, `rates`, `guestProfiles`,
  `charges`, `payments`, `roomStatus`, `maintenance`, `accounting`) exactly one authority: `portico` (write mode
  `exclusive`) or `external` (a connection from `integration`, write mode `forward` or `read_only`). Default:
  `portico/exclusive` (as implemented: `getDataAuthority`, `listDataAuthority`, `setDataAuthority`).
- **PLT-R36** [MUST] Every module write in a governed domain calls `assertWritable(tx, propertyId, domain)` →
  `'portico'` (write locally), `'forward'` (send through `integration`; the change is **pending** until the external
  system acknowledges, then becomes effective; rejection is shown with the external reason), or throws
  `external_system_of_record` naming the system to use.
- **PLT-R37** [MUST] Changing authority (`platform.dataAuthority.manage` ⚑) requires a **preview** listing affected
  functions per module (each module contributes "what stops/starts working here"), affected open items (e.g.
  future reservations, unsynced room statuses), and the cutover steps (final change capture, reconciliation run).
  Moving `reservations` or `availability` between authorities requires a reconciliation report with no unresolved
  blocking discrepancies (no two systems controlling live inventory — readiness §6).
- **PLT-R38** [MUST] Coherence rules (validated on save): `availability` external ⇒ `reservations` external;
  `charges` external ⇒ Portico folios disabled for that property; `payments` external ⇒ Portico payment
  collection disabled except payment links explicitly forwarded; `roomStatus` and `maintenance` may differ from
  `reservations`.
- **PLT-R39** [MUST] Data-authority matrix screen per property and a portfolio view (which system is authoritative
  per domain per property) — the **source-of-truth responsibility matrix** made live (adoption brief §2, §15).

### 3.10 Feature visibility

- **PLT-R40** [MUST] `isFeatureVisible(propertyId, featureKey)` = entitlement **and** visibility policy
  `ui.features.<key>.visible` (profile defaults) **and** the module is usable under the property's data authority
  (e.g. folios hidden when `charges` is external).

### 3.11 Guided setup

- **PLT-R41** [SHOULD] Property setup wizard by profile: minimal path for a guesthouse (≈ 8 steps: property,
  legal entity, units, rates and meal plans, taxes, payments, channels, staff), guided sections for a resort; every
  step saves and is resumable; ends in a valid `setup` property with a go-live checklist (adoption brief §11
  "useful defaults, guided setup").
- **PLT-R42** [SHOULD] Configuration export/import as versioned JSON (used by clone, templates, trial carry-forward and
  migration tooling).

## 4. Entities and states

### 4.1 Entities (implemented tables in `modules/platform/migrations/0001_platform.sql`, plus proposals)

`organizations(id, name, slug, environment, status, plan_code, default_locale)` · `legal_entities` · `brands` ·
`regions(parent)` · `properties(…, profile, classification jsonb, business_date, status, version)` · `departments` ·
`policies` · `data_authority(property_id, domain, authority, connection_id, system_name, write_mode,
effective_from, reason, version)` · `tenant_directory` (environment lookup). Proposed additions:
`property_classification_history`, `property_pilot_scope(property_id, scope jsonb, starts, ends, criteria)`,
`outlets`, `owners`, `unit_ownership`, `entitlement_grants(scope, key)`, `usage_counters`, `environment_groups`,
`trial_manifest(trial_tenant_id, source, copied_at, carry_forward jsonb)`.

### 4.2 State machines

**Organization:** `active ⇄ suspended` (operator, reason, notice) · `active|suspended → closed` (terminal after
export window).

**Property status:** `setup → pilot` (pilot scope defined; checklist for pilot scope passes) · `setup → active` ·
`pilot → active` (full activation checklist; explicit confirmation by `platform.property.activate` ⚑) ·
`pilot → setup` (pilot stopped; data retained, live effects stop) · `active → inactive` (no in-house or future
confirmed stays, folios settled/transferred; read-only) · `inactive → active` (operator only). `active → setup` is
forbidden.

**Data authority (per property × domain):** `portico/exclusive ⇄ external/read_only ⇄ external/forward`; every
change is a versioned row change with reason and emits `platform.dataAuthority.changed`.

**Business date:** monotonic `D → D+1` only (or mirrored from external when the source policy is `external`).

## 5. Invariants

- **PLT-I01** No row is readable or writable outside its tenant (RLS forced; S17).
- **PLT-I02** Environments of one company never share a tenant id; no foreign key crosses tenants.
- **PLT-I03** A property has exactly one operating legal entity for every business date.
- **PLT-I04** Business date never decreases; Portico-advanced dates change by exactly +1 day.
- **PLT-I05** `resolvePolicy` is deterministic for the same inputs and policy versions.
- **PLT-I06** Exactly one authority row (explicit or default) per property × domain; an `external` authority
  always references a connection; `portico` always has write mode `exclusive`.
- **PLT-I07** No module write succeeds in a domain whose authority is `external/read_only` (integration test per
  module: every governed write path calls `assertWritable`).
- **PLT-I08** In `trial`, no effect other than `integration.read` runs in `live` mode; `integration.write`,
  `government.submit`, `credentials.production` are blocked (kernel test exists).
- **PLT-I09** Count of `pilot`+`active` properties ≤ `limits.properties`.
- **PLT-I10** Removing an entitlement never deletes or mutates feature data.

## 6. Cross-module interactions

Provider (domain map + implemented): `getProperty`, `listProperties`, `getBusinessDate`, `advanceBusinessDate`,
`getLegalEntity`, `hasEntitlement`, `requireEntitlement`, `getLimit`, `resolvePolicy`, `previewPolicyChange`,
`setPolicy`, `propertyIdsInScope`, `getDataAuthority`, `listDataAuthority`, `assertWritable`, `setDataAuthority`.
Consumers: every module. Platform depends on no module; `integration` registers connections that platform
references by id only.

### Proposed contract changes

1. `hasEntitlement(tx, feature, opts?: { propertyId })` for property-scoped add-ons.
2. `resolvePolicy` source adds `'profile'`.
3. New `isFeatureVisible(tx, propertyId, featureKey)`; `recordUsage(tx, { meter, quantity, propertyId?, ref })`.
4. New `getPropertyAt(tx, propertyId, businessDate)` (classification and operator effective then).
5. New `previewDataAuthorityChange(tx, { propertyId, domain, to })` aggregating module impact statements via a
   registered `DataAuthorityImpactProvider` port per module.
6. New `getPilotScope(tx, propertyId)`; `assertInPilotScope(tx, propertyId, workflow)` for pilot-limited workflows.
7. Domain map should list `platform.dataAuthority.changed` (already emitted by the implementation).

## 7. Events

Emitted: `platform.property.businessDateAdvanced` · `platform.policy.changed` · `platform.dataAuthority.changed`
(implemented) · proposed: `platform.property.statusChanged`, `platform.entitlement.changed`,
`platform.usage.thresholdReached`, `platform.property.operatorChanged`, `platform.trial.reset`.
Consumed: `integration.connection.statusChanged` (proposed) — to flag authorities pointing at a paused or failed
connection in the authority matrix.

## 8. Permissions

Implemented: `platform.organization.manage` ⚑ (org) · `platform.legalEntity.manage` ⚑ (org) ·
`platform.property.read` · `platform.property.create` ⚑ (org) · `platform.property.update` ·
`platform.department.manage` · `platform.businessDate.advance` ⚑ · `platform.policy.manage` ⚑ (org) ·
`platform.policy.override` · `platform.dataAuthority.manage` ⚑ (used by service; add to manifest).
Proposed: `platform.property.activate` ⚑ · `platform.property.deactivate` ⚑ · `platform.outlet.manage` ·
`platform.policy.lock` ⚑ (org) · `platform.plan.read` (org) · `platform.usage.manageCaps` ⚑ (org) ·
`platform.trial.manage` ⚑ (org) · `platform.owner.manage` ⚑ (org).

## 9. UX surfaces

Property settings with source badges and "local override" labels; portfolio policy editor with mandatory change
preview and override report; **data-authority matrix** (domains × systems, write mode, connection health dot,
"what changes if I switch" preview); activation checklist and pilot-scope editor; plan & usage page;
environment banner; trial home ("what this trial contains, copied when, what is read-only, reset/export/delete").

## 10. Proof scenarios and evidence

| ID | Platform must demonstrate |
|---|---|
| S16 | Org-level policy change previewed across 3 properties (one local override unchanged and reported, one exempt under lock); history and resolved values correct afterwards. |
| S17 | Tenant isolation at the DB layer for every module (implemented e2e test extends to new modules). |
| S20 (supporting) | A connection failure marks authorities that depend on it as degraded in the matrix; writes in `forward` mode queue as pending, never shown as done. |
| E09 | Property-scoped data invisible without property scope. |
| E13 | `suspended` organization: new bookings blocked, check-out/payment/export work. |
| E14 | Usage cap reached: only the metered effect stops. |
| A01–A04 | Adoption evidence (see `docs/scenarios/README.md` §3): trial isolation, read-only connection, data-authority switch with reconciliation, pilot scope enforcement. |

## 11. Maldives specifics

Timezone `Indian/Maldives` (UTC+5, no DST; logic remains DST-safe). Base currency usually USD; MVR accepted.
Classification drives Green Tax ($12 vs $6 per person-night, research 04). Address includes atoll and island.
Resort department template adds Recreation, Transport, Marine. Many resorts run an incumbent PMS and would adopt
Portico first in connected mode (housekeeping, communications, transfers, reporting) — data authority makes that
safe.

## 12. Competitive inspirations

Shiji configure-once portfolio with visible overrides (research 01 §5.2); OPERA irreversible switches as
anti-pattern (research 01 §8); Apaleo clone/test/live/archive lifecycle (research 02 §3.6); Mews tier gating on
configuration counts as anti-pattern (research 02 §2.8); SiteMinder/Cloudbeds dual-PMS hazard → explicit
single authority per domain (research 03 §3.3, §9.2 item 7).

## 13. Open questions

Q3 (prices), Q4 (region), Q44 (trial deletion vs retention). Product decisions: earliest Day Close start 22:00;
region depth 4; activation is always per property.

## 14. Adoption modes

- **Standalone alongside an external PMS:** always present — platform is required by every adoption path
  (connect alongside, replace selected capabilities, full migration).
- **Hard dependencies:** none (root module); `identity` for authorization.
- **Connected mode:** stores the data-authority matrix, mirrors business date when `reservations` is external
  (PLT-R34), hides features unusable under the current authorities (PLT-R40), and provides trial/pilot lifecycle.
- **Data-authority domains:** owns the authority registry for all nine domains; owns none of the domain data itself.
