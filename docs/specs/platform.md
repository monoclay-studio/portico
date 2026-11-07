# Spec: platform

Status: Draft v1 · 2026-11-07 · Wave 0 → 1 · Schema `platform` · Prefix `PLT`

## 1. Purpose

`platform` is the root of every other module's world: *who* the organization is, *which* environment we are in,
*what* properties, legal entities, owners, departments and outlets exist, *what* the organization is entitled
to use, *which* policy value applies to a property and why, and *what business date* a property is on. It is
the module that lets one product serve a 6-room guesthouse and a multi-brand group without either seeing the
other's complexity.

## 2. Scope and non-goals

**In scope:** organizations (tenants), environments, brands, regions, properties (profile, classification,
timezone, currencies, business date, lifecycle), legal entities, owners and unit ownership shares, departments,
outlets, plans/editions/entitlements/limits/usage meters, policies with inheritance and local overrides, feature
visibility, environment-safety gate for external effects, configuration templates and property cloning.

**Non-goals:** staff users and permissions (`identity`); Monoclay's SaaS invoices and subscriptions (`billing`
reads plans from here but owns money); chart of accounts and invoice series (`finance`, keyed by legal entity);
unit types and units (`inventory`); owner statements (`finance`, LATER). Platform never stores guest data.

## 3. Capabilities

### 3.1 Organizations and environments

- **PLT-R01** [MUST] An organization is the tenant: the hard isolation boundary for data and money. Every
  tenant-owned row in every module carries `tenant_id`; RLS is enabled and forced (architecture rule 4).
- **PLT-R02** [MUST] Each organization has exactly one `live` environment and may have `training` and `demo`
  environments. Each environment is a **separate tenant** linked by `environmentGroupId`; they never share rows,
  sequences, payment accounts or credentials. `limits.environments` bounds how many non-live environments exist.
- **PLT-R03** [MUST] Every environment carries `kind ∈ {live, training, demo, sandbox}` and the UI shows a
  persistent, non-dismissable environment banner (colour + text) for every kind except `live`.
- **PLT-R04** [MUST] `assertExternalEffectAllowed(ctx, effect)` (architecture rule 12) is implemented here.
  Effects: `card_charge`, `card_refund`, `guest_message`, `channel_publish`, `government_submission`,
  `fiscal_submission`, `paid_ai`, `production_key_issue`, `payout_instruction`. Matrix:

  | effect \ env | live | training | demo | sandbox |
  |---|---|---|---|---|
  | card_charge / card_refund | allowed if a live payment account is configured | simulator | simulator | provider sandbox only |
  | guest_message | allowed if sender verified and consent rules pass | redirect to staff inbox | blocked (logged) | provider sandbox / blocked |
  | channel_publish | allowed if connection is `live` | simulator | simulator | provider sandbox |
  | government / fiscal submission | allowed only with explicit owner authorization flag per property | blocked | blocked | provider test endpoint |
  | paid_ai | allowed under usage cap | blocked unless cap > 0 | blocked | blocked |

  The function returns `{ mode: 'live' | 'simulated' | 'sandbox' | 'blocked', reason }`; adapters must honour
  the mode, and results produced in a non-live mode carry the `simulated`/`sandbox` trust marker
  (`docs/product/ux-principles.md` §3).
- **PLT-R05** [MUST] Training environments are created by cloning live *configuration* (never guest, payment or
  financial data) plus generated sample data. Demo environments are created from the Maldives sample datasets
  (decision D8: guesthouse, ~120-villa resort, 3-property group).
- **PLT-R06** [MUST] Organization status: `active`, `restricted`, `read_only`, `closed`. Status changes require
  a Monoclay operator action with reason; `read_only` and `closed` never take effect for a property with
  in-house guests without 30 days' recorded notice (operations must not stop mid-stay). Data export stays
  available in every status until deletion (brief §16).

### 3.2 Portfolio structure

- **PLT-R07** [MUST] Hierarchy: Organization → optional Brands → optional Regions (nestable, max depth 4) →
  Properties. A property belongs to at most one brand and at most one leaf region. Multi-level hierarchy is
  `portfolio.hierarchy`; without it an organization has a flat list of properties (policy levels collapse to
  organization → property).
- **PLT-R08** [MUST] Moving a property between brands/regions is an audited, previewed operation showing which
  inherited policy values change as a result.
- **PLT-R09** [MUST] `limits.properties` is enforced when a property moves to `live` (draft and test properties
  do not count), with an explanatory error naming the limit and the edition.

### 3.3 Properties

- **PLT-R10** [MUST] Property attributes: name, short code (unique per organization), profile, classification,
  timezone (IANA), base currency, accepted currencies, operating legal entity (effective-dated), address/
  atoll/island, check-in and check-out default times, unit noun defaults (e.g. "Villa", "Room", "Bed"),
  languages, business date.
- **PLT-R11** [MUST] **Property profile** ∈ `guesthouse`, `boutique_hotel`, `full_service_hotel`, `resort`,
  `serviced_apartments`, `hostel` (see `docs/product/editions.md` §4; glossary refinement proposed). The
  profile supplies **policy defaults** and **feature visibility defaults**; it never grants entitlements.
  Changing profile is previewed (lists which defaults and visible features change) and never deletes data.
- **PLT-R12** [MUST] **Classification** is a tax-relevant, effective-dated attribute (Maldives: `resort`,
  `integrated_resort`, `tourist_vessel`, `uninhabited_island_hotel`, `inhabited_island_guesthouse` with declared
  room count). Tax rules (`rates`) reference classification, never profile.
- **PLT-R13** [MUST] Property lifecycle `draft → test → live → archived` (§4.2). `test` behaves like live for
  configuration validation but external effects are `sandbox`/`simulated`. Go-live runs a readiness checklist
  supplied by modules (e.g. distribution mapping completeness, tax pack verified, payment account configured)
  and shows blockers vs warnings.
- **PLT-R14** [SHOULD] Clone a property's configuration (unit types, rate structure, policies, charge codes,
  departments, outlets — never units' operational state, guests or money) into a new `draft` property.
- **PLT-R15** [MUST] Property-scoped **business date** (§3.8).

### 3.4 Legal entities and owners

- **PLT-R16** [MUST] Legal entity: legal name, trading name, country, tax registration numbers (e.g. Maldives
  TIN / TGST registration), base (functional) currency, registered address, fiscal settings reference. A
  property has exactly one operating legal entity for any instant; changes are effective-dated with a cut-over
  business date and never rewrite history (finance keys ledgers by legal entity).
- **PLT-R17** [SHOULD] Owners and unit ownership: an owner (person or company) holds an effective-dated share
  (basis points, total per unit-period ≤ 10000) of one or more units. Used by `finance` owner accounting
  (`finance.ownerAccounting`, LATER).

### 3.5 Departments and outlets

- **PLT-R18** [MUST] Departments per property from a template by profile (Front Office, Reservations,
  Housekeeping, Engineering, F&B, Finance, Guest Relations, Recreation, Transport). Departments own tasks and
  conversations; each has an escalation contact role.
- **PLT-R19** [MUST] Outlets per property: kind (`restaurant`, `bar`, `spa`, `dive_center`, `excursions`,
  `boutique`, `transfer_desk`, `in_villa_dining`, `other`), operating hours, default charge codes (finance),
  default revenue department, and whether it accepts room-charge postings.

### 3.6 Plans, entitlements, limits, usage

- **PLT-R20** [MUST] Each organization has a plan = one edition (`essentials`, `professional`, `resort`,
  `enterprise`) + zero or more add-ons + contract overrides. Entitlements resolve to feature keys (boolean) and
  limits (numeric). Prices are **not** stored here (Q3; `billing` owns prices as configuration).
- **PLT-R21** [MUST] Entitlements are evaluated server-side for every gated command and query
  (`EntitlementError`, code `feature_not_enabled`, message names the feature and who can enable it).
- **PLT-R22** [MUST] Some entitlements are per property (e.g. `resort.transfers` add-on for one property of a
  group). Resolution: property-level grant ∪ organization-level grant.
- **PLT-R23** [MUST] **Downgrade never deletes data.** When an entitlement is removed, existing records of that
  feature become read-only and remain in exports and reports; open operational commitments (e.g. future
  transfers) stay visible with a banner explaining the change.
- **PLT-R24** [MUST] Usage meters (`usage.messages`, `usage.aiCredits`) record metered events per organization
  and property with a **hard cap** and separate **notification thresholds**. Reaching a hard cap blocks only
  the metered effect (e.g. paid AI), returns `usage_cap_reached` with recovery text, and never blocks
  reservations, payments, check-in/out or Day Close (readiness §14, §16; evidence E14).

### 3.7 Policies, inheritance and local overrides

- **PLT-R25** [MUST] A **policy catalog** is registered by modules: key (e.g. `reservations.checkIn.requireInspected`),
  type (JSON-schema), default, allowed levels (`organization`, `brand`, `region`, `property`), lockable flag,
  sensitivity, description, owning module.
- **PLT-R26** [MUST] Resolution order (most specific wins unless locked): `default` → `profile` → `organization`
  → `brand` → `region` (outermost to innermost) → `property`. `resolvePolicy` returns the value **and its
  source**. A property value differing from the inherited value is a **local override** and is always labelled
  as such in the UI, with the inherited value shown beside it.
- **PLT-R27** [MUST] A higher level may **lock** a lockable policy (`portfolio.policies`): lower levels cannot
  set a value; existing lower-level overrides are reported, not silently deleted. Applying a lock offers, per
  overriding property, *keep override (exempt)* or *remove override*; exemptions are recorded with reason.
- **PLT-R28** [MUST] **Portfolio change preview** (brief §13): before saving any policy value at
  organization/brand/region level, show the list of affected properties partitioned into *will change*,
  *unchanged because overridden locally*, *unchanged because value already equal*, and *exempt*. Saving
  requires the preview's `previewToken` (stale previews are rejected with 409 and recomputed). Not gated: the
  preview is a safety feature in every edition.
- **PLT-R29** [MUST] Every policy value change is versioned (who, when, reason, before/after, effective from).
  Policies may be **scheduled** (effective at a future instant or business date) — `portfolio.policies`.
- **PLT-R30** [MUST] **Override report**: per policy and per property, all local overrides with age, author
  and reason; filterable; exportable. Available in all editions for organizations with ≥ 2 properties.

### 3.8 Business date

- **PLT-R31** [MUST] Each property has a business date (`LocalDate`). It starts at the property's local
  calendar date at go-live and changes **only** via `advanceBusinessDate(tx, propertyId, expected)`, called only
  by `day-close`. The call is optimistic: `expected` must equal the current value, else `VersionConflictError`.
- **PLT-R32** [MUST] Advancing from D to D+1 is rejected if the property's local time is before
  `dayClose.earliestStartLocalTime` on D (policy, default `22:00`). The business date may lag the calendar date;
  a lag of ≥ 1 full day raises an exception visible to managers.
- **PLT-R33** [MUST] Business date advance does not log anyone out and does not block other commands. A command
  reads the business date inside its transaction; postings are stamped with the business date current at commit.

### 3.9 Feature visibility (progressive disclosure)

- **PLT-R34** [MUST] `isFeatureVisible(propertyId, featureKey)` = entitlement granted **and** visibility policy
  `ui.features.<featureKey>.visible` resolved true (profile supplies defaults; admins can reveal or hide per
  property). Hidden features disappear from navigation, forms, command palette and search but their data, if
  any exists, stays reachable from records that reference it.

### 3.10 Configuration templates and import

- **PLT-R35** [SHOULD] Property setup wizard by profile: minimal path (guesthouse: 8 steps; resort: guided
  sections) producing a valid `test` property; each step saves; resumable.
- **PLT-R36** [SHOULD] Configuration export/import as versioned JSON (used by clone, templates and migration
  tooling in `integration`).

## 4. Entities and states

### 4.1 Core entities

`organization(id, name, status, environment_group_id, kind, plan_id, created_at)` ·
`brand(id, name)` · `region(id, parent_region_id?, name)` ·
`property(id, code, name, profile, timezone, base_currency, accepted_currencies[], brand_id?, region_id?,
lifecycle, business_date, version)` · `property_classification(property_id, classification, room_count?,
valid_from, valid_to?)` · `property_operator(property_id, legal_entity_id, valid_from_business_date,
valid_to_business_date?)` · `legal_entity(id, legal_name, country, tax_ids jsonb, base_currency, version)` ·
`owner(id, kind, name, contact)` · `unit_ownership(unit_id, owner_id, share_bp, valid_from, valid_to?)` ·
`department(id, property_id, code, name, escalation_role_id?)` · `outlet(id, property_id, code, kind, name,
accepts_room_charge, default_charge_code?)` · `plan(id, edition, addons[], overrides jsonb)` ·
`entitlement_grant(scope: org|property, scope_id, key, value)` · `usage_counter(key, period, scope, used, cap,
notify_at[])` · `policy_definition(key, schema, default, levels[], lockable, module)` · `policy_value(key, level,
level_id, value, locked, exempt_reason?, effective_from, version, author, reason)`.

### 4.2 State machines

**Organization status**

| from \ to | active | restricted | read_only | closed |
|---|---|---|---|---|
| active | — | operator + reason | operator + reason + notice | — |
| restricted | operator | — | operator + notice | — |
| read_only | operator | — | — | operator + export window elapsed |
| closed | — | — | — | — |

`restricted`: admin banners only, no functional loss. `read_only`: no new bookings/postings; check-out and
payment collection for in-house stays remain allowed; exports allowed.

**Property lifecycle**: `draft → test` (setup validation passes) · `test → live` (go-live checklist, no
blockers, `limits.properties` not exceeded, explicit confirmation by a user with `platform.property.goLive` ⚑) ·
`test → draft` (allowed) · `live → archived` (no in-house stays, no future confirmed stays, all folios settled or
transferred; archived is read-only) · `archived → live` (operator only). `live → test`/`draft` is forbidden.

**Business date**: monotonic `D → D+1` only; no skips (advancing over several days requires several Day
Close runs, each producing its own statistics snapshot).

## 5. Invariants

- **PLT-I01** No row is readable or writable outside its tenant: every tenant-owned table has `tenant_id NOT NULL`,
  RLS enabled **and forced**; a query with a mismatched tenant context returns zero rows (test S17).
- **PLT-I02** Environments of one organization never share a `tenant_id`; no foreign key crosses tenants.
- **PLT-I03** A property has exactly one operating legal entity for every business date ≥ its go-live date
  (no gaps, no overlaps — exclusion constraint on `property_operator`).
- **PLT-I04** A property's business date never decreases and changes by exactly +1 day per advance.
- **PLT-I05** `resolvePolicy` is deterministic: the same inputs and policy versions return the same value and source.
- **PLT-I06** A locked policy has no non-exempt lower-level value in effect.
- **PLT-I07** Count of `live` properties ≤ `limits.properties` at the instant of any go-live.
- **PLT-I08** Unit ownership shares for any unit and instant sum to ≤ 10000 bp.
- **PLT-I09** For every external effect performed by an adapter there is an audit/log record of the
  `assertExternalEffectAllowed` decision; in non-live environments no effect is performed in `live` mode.
- **PLT-I10** Removing an entitlement never deletes or mutates feature data (only access mode changes).

## 6. Cross-module interactions

Provider contract (domain map): `getProperty`, `getBusinessDate`, `advanceBusinessDate`, `getLegalEntity`,
`hasEntitlement`, `resolvePolicy`. Consumers: every module. Platform calls `identity.authorize` for its own
commands only. Platform depends on no other module (it is the root of the dependency graph).

### Proposed contract changes

1. `hasEntitlement(tx, feature, opts?: { propertyId?: Uuid })` — property-scoped add-ons (PLT-R22). Additive.
2. `resolvePolicy` result `source` adds `'profile'` (PLT-R26). Additive to the union.
3. New: `getLimit(tx, key, opts?) : Promise<number | 'unlimited'>`.
4. New: `isFeatureVisible(tx, propertyId, featureKey): Promise<boolean>` (PLT-R34).
5. New: `recordUsage(tx, { meter, quantity, propertyId?, ref }): Promise<{ allowed: boolean; remaining }>` (PLT-R24).
6. New: `assertExternalEffectAllowed(ctx, effect): Promise<EffectDecision>` lives in `@portico/db` per CLAUDE.md
   but reads environment kind and authorization flags owned here — expose `getEnvironment(tx)`.
7. New: `getPropertyAt(tx, propertyId, businessDate)` returning classification and operating legal entity
   effective on that date (finance and rates need historical values).

## 7. Events

Emitted: `platform.property.businessDateAdvanced {propertyId, from, to}` · `platform.policy.changed {key, level,
levelId, before, after, affectedPropertyIds}` · proposed: `platform.property.lifecycleChanged`,
`platform.entitlement.changed {key, scope, granted}`, `platform.usage.thresholdReached {meter, scope, percent}`,
`platform.property.operatorChanged`.
Consumed: none (root module).

## 8. Permissions

`platform.organization.read` (org) · `platform.organization.manage` ⚑ (org) · `platform.property.read` ·
`platform.property.manage` · `platform.property.goLive` ⚑ · `platform.property.archive` ⚑ ·
`platform.legalEntity.manage` ⚑ (org) · `platform.owner.manage` ⚑ (org) · `platform.department.manage` ·
`platform.outlet.manage` · `platform.policy.read` · `platform.policy.manageProperty` ⚑ ·
`platform.policy.managePortfolio` ⚑ (org) · `platform.policy.lock` ⚑ (org) · `platform.plan.read` (org) ·
`platform.usage.manageCaps` ⚑ (org) · `platform.environment.manage` ⚑ (org).

## 9. UX surfaces

- **Property settings** with a left index by area; every policy row shows value, source badge
  (`default`/`profile`/`organization`/`brand`/`region`/`property`), "local override" label and a reset action.
- **Portfolio policy editor** with the mandatory change preview (PLT-R28) and override report (PLT-R30).
- **Go-live checklist** listing blockers and warnings contributed by modules, each linking to its fix.
- **Plan & usage page**: edition, add-ons, limits with current use, usage meters with caps and notifications.
- **Environment banner** (PLT-R03) and environment switcher (live ⇄ training) that never carries a session's
  unsaved work across environments.

## 10. Proof scenarios and evidence

| ID | Platform must demonstrate |
|---|---|
| S16 | Organization-level policy change previewed across 3 properties, one with a local override (stays unchanged and is reported), one exempt from a lock; the change history shows actor/reason; properties' resolved values and sources are correct afterwards. |
| S17 | Tenant isolation at the database layer: a forged tenant context or guessed IDs return 404/0 rows for every module's tables (platform supplies the tenant context and RLS policy helpers). |
| E09 | Property scope data (property lists, business dates, settings) is invisible to a user without that property in scope. |
| E13 | Organization status changes (`restricted`, `read_only`) behave as specified and keep in-house operations and export available. |
| E14 | Usage cap reached for `usage.aiCredits`/`usage.messages`: metered effect blocked with recovery text; reservations/payments/Day Close unaffected. |
| S09 (supporting) | `advanceBusinessDate` is optimistic; a duplicate advance attempt fails cleanly. |

## 11. Maldives specifics

- Timezone `Indian/Maldives` (UTC+5, no daylight saving). Business date logic must still be DST-safe for other
  markets (readiness §17).
- Base currency is usually USD for resorts and often USD for guesthouses; MVR is an accepted currency for cash
  and local guests. Legal-entity functional currency may differ from property base currency (finance handles FX).
- Classification drives Green Tax rate (research 04: $12 resorts, integrated resorts, tourist vessels,
  uninhabited-island properties and inhabited-island properties > 50 rooms; $6 for ≤ 50 rooms on inhabited
  islands). Room count is part of the classification record.
- Address model includes atoll and island; departments template for resorts adds Recreation, Transport and
  Marine; outlets include `dive_center`, `excursions`, `in_villa_dining`.

## 12. Competitive inspirations

- Configure-once portfolio with visible overrides and drift reports — Shiji Daylight (research 01 §5.2, §5.6).
  Improved: change preview partitions affected properties; locks never silently delete overrides.
- Never an irreversible global switch — anti-pattern from OPERA profile sharing (research 01 §2.4, §8).
- Property clone / test / set-live / archive lifecycle — Apaleo (research 02 §3.3.1, §3.6).
- Tier gating on configuration counts is an anti-pattern — Mews Pro limits (research 02 §2.8 item 5); our
  limits are properties and units only, never rates, connections or data history.

## 13. Open questions

Q3 (edition prices), Q4 (region). Product decisions taken here: business date earliest-start default 22:00;
max region depth 4; staff accounts are never limited (rationale in editions.md §3).
