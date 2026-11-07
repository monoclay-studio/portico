# Parity: platform (portfolio, property setup, policies, environments, multi-property)

Status: v1 · 2026-11-07 · Cluster `front` · Spec `docs/specs/platform.md` (PLT) · Code on `main`: `modules/platform`
(properties, legal entities, brands/regions, departments, business date, policies with preview, data authority,
plans/entitlements) plus foundation packages. Rows are `tested` only where a test on `main` exercises the behavior;
the test is named in the Test column.

**Baseline.** OPERA Cloud 26.3 *Enterprise Administration* (chain and property management, corporate information,
hubs, copying configuration to multiple properties, OPERA Controls and subscription matrices, flexible fields,
localized codes, chain scheduler), *Getting Started* (changing location in multi-property operations, enterprise
admin chain selection), *Toolbox → Managing Business Date* and *Exchange → Switching the Interface*. Modern rows
from the Mews multi-property concept (portfolios, chains, portfolio access tokens), Apaleo property lifecycle
(clone, set-live, reset, archive), Shiji Daylight (configure-once portfolio) and Stayntouch's auto-configurator.
Links opened (or found by web search where the vendor blocks direct fetch) on 2026-11-07. Capability column uses
Portico terms (organization, environment, brand, region, portfolio, property, policy, local override, data
authority, business date, entitlement).

## Capabilities

### 1. Organizations and environments

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PLT-001 | Organization as the hard isolation boundary (application authorization and database row-level security) | Mews [chains and enterprises](https://docs.mews.com/connector-api/concepts/multi-property.md) — verified 2026-11-07 | P0 | tested | PLT-R01, PLT-I01 | `packages/db/test/core.test.ts` "a tenant can never read or write another tenant’s rows"; `modules/platform/test/platform.test.ts` "another organization cannot see properties even by id"; `apps/api/test/api.test.ts` scenario 17 |
| PAR-PLT-002 | Live, trial, sandbox, training and demo environments as separate organizations | Apaleo test/live property lifecycle ([inventory API](https://api.apaleo.com/swagger/index.html)) · Mews BE [demo environment](https://docs.mews.com/booking-engine-guide/booking-engine-widget/use-cases/testing-in-demo-environment.md) — verified 2026-11-07 | P0 | specified | PLT-R02, PLT-I02 | — |
| PAR-PLT-003 | Demo environment with realistic Maldives sample organizations, clearly labelled | Mews demo environment ([guide](https://docs.mews.com/booking-engine-guide/booking-engine-widget/use-cases/testing-in-demo-environment.md)) — verified 2026-11-07 | P0 | tested | PLT-R06, decision D8 | `apps/api/test/demo-seed.test.ts` "seeds realistic Maldives demo organizations … labeled as demo" |
| PAR-PLT-004 | Persistent environment banner stating what a non-live environment can and cannot do | assumption | P0 | specified | PLT-R03 | — |
| PAR-PLT-005 | External effects (cards, messages, channels, government, keys) simulated or blocked outside live | Apaleo [reset test property](https://api.apaleo.com/swagger/index.html) — verified 2026-11-07 | P0 | tested | PLT-R04, PLT-I08 | `packages/kernel/src/context.test.ts` "never performs real effects outside live" |
| PAR-PLT-006 | Trial with an authorized copy of the hotel's data, read-only links, reset/export/delete, carry-forward manifest | Apaleo [property reset / set-live](https://api.apaleo.com/swagger/index.html) — verified 2026-11-07 | P0 | specified | PLT-R05 | — |
| PAR-PLT-007 | Training environment cloned from live configuration with generated data | Apaleo [clone property](https://api.apaleo.com/swagger/index.html) — verified 2026-11-07 | P1 | specified | PLT-R06 | — |
| PAR-PLT-008 | Sandbox environments for integrators with sample data | Mews [Channel Manager API environments](https://docs.mews.com/channel-manager-api/guidelines/environments.md) — verified 2026-11-07 | P1 | specified | PLT-R06 | — |
| PAR-PLT-009 | Organization suspension that still allows check-out, payment collection and export | assumption | P1 | specified | PLT-R07 | — |

### 2. Portfolio structure and multi-property work

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PLT-010 | Hierarchy organization → brands → nestable regions → properties | OPERA [Configuring Chain](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_configuring_chain.htm) · [Corporate Information — brands, divisions, business units](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_admin_configuring_corporate_information.htm) · Mews [portfolios](https://docs.mews.com/connector-api/concepts/multi-property.md) — verified 2026-11-07 | P1 | specified | PLT-R08 | — |
| PAR-PLT-011 | Extra corporate groupings (divisions, business units, operating units, hotel categories) | OPERA [Configuring Corporate Information](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_admin_configuring_corporate_information.htm) — verified 2026-11-07 | P2 | different | PLT-R08: brands plus nestable regions cover these groupings without separate code tables | — |
| PAR-PLT-012 | Work across properties in one session (switch property, multi-property lists) | OPERA [Changing Your Location in Central or Multi Property Operations](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_logging_into_a_hub_or_different_property.htm) · [Configuring Hubs](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_enterprise_configuring_hubs.htm) — verified 2026-11-07 | P1 | specified | PLT §6 `propertyIdsInScope`, identity scopes | — |
| PAR-PLT-013 | Central reservations office selling across properties | OPERA [Hubs](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_enterprise_configuring_hubs.htm) · [Alternate Property Availability](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_availability_viewing_alternate_property_availability.htm) — verified 2026-11-07 | P1 | deferred | RES §11 (`portfolio.centralReservations`, LATER) | — |
| PAR-PLT-014 | Move a property between brands/regions with preview of inherited changes | Shiji configure-once portfolio ([Daylight PMS](https://www.shijigroup.com/daylight-pms)) — verified 2026-11-07 (web search; vendor site blocks direct fetch) | P2 | specified | PLT-R09 | — |
| PAR-PLT-015 | Property count limit by plan with an explanatory error | Mews tier gating anti-pattern (research 02 §2.8) | P0 | tested | PLT-R10, PLT-I09 | `modules/platform/test/platform.test.ts` "creates properties scoped to the organization and enforces plan limits" |
| PAR-PLT-016 | API access across a portfolio with per-property scoping | Mews [Portfolio Access Tokens](https://docs.mews.com/connector-api/concepts/multi-property.md) — verified 2026-11-07 | P1 | specified | INT-R26–R27, PLT-R08 | — |

### 3. Properties

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PLT-017 | Create a property with legal entity, validated IANA time zone, base currency, profile, classification, business date | OPERA [Configuring Properties](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_configuring_properties.htm) · Apaleo [create property](https://api.apaleo.com/swagger/index.html) — verified 2026-11-07 | P0 | tested | PLT-R11 | `modules/platform/test/platform.test.ts` "creates properties …" and "rejects invalid time zones with a helpful message" |
| PAR-PLT-018 | Check-in/out times, languages, accepted currencies, address with atoll/island | OPERA [Configuring Properties](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_configuring_properties.htm) — verified 2026-11-07 | P0 | specified | PLT-R11 | — |
| PAR-PLT-019 | Property edits protected by optimistic concurrency | assumption (architecture rule 8) | P0 | tested | PLT-R11 (version) | `modules/platform/test/platform.test.ts` "detects concurrent edits with versions" |
| PAR-PLT-020 | Users see only the properties they are permitted to | OPERA [Role Manager](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_manage_roles.htm) — verified 2026-11-07 | P0 | tested | PLT-R08, identity | `modules/platform/test/platform.test.ts` "only lists properties the user may read" |
| PAR-PLT-021 | Property profile supplies defaults and visibility, never entitlements; change previewed | Stayntouch [auto-configurator](https://stayntouch.freshdesk.com/support/solutions/articles/24000093959-stayntouch-auto-configurator-tool) — verified 2026-11-07 (web search; vendor site blocks direct fetch) | P0 | specified | PLT-R12 | — |
| PAR-PLT-022 | Effective-dated tax classification (e.g. resort vs inhabited-island guesthouse) | OPERA [Property Types](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_configuring_property_types.htm) — verified 2026-11-07 | P0 | specified | PLT-R13 | — |
| PAR-PLT-023 | Property status setup → pilot → active → inactive with activation checklist | Apaleo [set-live / archive](https://api.apaleo.com/swagger/index.html) — verified 2026-11-07 | P0 | specified | PLT-R14 | — |
| PAR-PLT-024 | Pilot scope (modules, workflows, users, dates, success criteria) enforced | assumption (adoption brief §11) | P0 | specified | PLT-R14 | — |
| PAR-PLT-025 | Clone a property's configuration; bulk-create properties from a template | Apaleo [clone property](https://api.apaleo.com/swagger/index.html) · OPERA [Copying Configuration Codes to Multiple Properties](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_copying_configurations_to_multiple_properties.htm) — verified 2026-11-07 | P1 | specified | PLT-R15 | — |
| PAR-PLT-026 | Arrival points and transport modes catalog per property (airports, jetties, seaplane terminals) | OPERA [Configuring Airports](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_configuring_airports.htm) · [Configuring Transportation](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_configuring_transportation.htm) — verified 2026-11-07 | P1 | missing | — (RES-R39 uses free text) | — |
| PAR-PLT-027 | Property brochure for sales agents (details, amenities, attractions) | OPERA [Property Brochure](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_getting_started_property_brochure.htm) · [Property Details](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_configuring_property_details.htm) — verified 2026-11-07 | P2 | missing | — | — |
| PAR-PLT-028 | Seasonal property closure (no arrivals, sales closed, Day Close behaviour defined) | assumption (Maldives guesthouses close for renovation/off-season) | P2 | missing | — | — |

### 4. Legal entities, departments, outlets, owners

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PLT-029 | Legal entities with registration and tax ids; one operator per property per business date | Mews [chains define legal relationships](https://docs.mews.com/connector-api/concepts/multi-property.md) — verified 2026-11-07 | P0 | specified | PLT-R16, PLT-I03 | — |
| PAR-PLT-030 | Departments from a template by profile, with escalation roles | OPERA [Configuring Departments](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_enterprise_configuring_departments.htm) · Mews [departments](https://docs.mews.com/connector-api/operations/departments.md) — verified 2026-11-07 | P0 | specified | PLT-R18 | — |
| PAR-PLT-031 | Outlets with kind, hours, default charge codes, room-charge flag | Mews [outlets](https://docs.mews.com/connector-api/operations/outlets.md) — verified 2026-11-07 | P0 | specified | PLT-R19 | — |
| PAR-PLT-032 | Owners and effective-dated unit ownership shares | OPERA [Room Rotation — ownership](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_inventory_rr_viewing_room_ownership.htm) — verified 2026-11-07 | P2 | specified | PLT-R17 | — |

### 5. Plans, entitlements, usage

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PLT-033 | Server-side entitlement checks with explanatory errors | OPERA [Subscription Matrices](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/ch_feature_matrices.htm) — verified 2026-11-07 | P0 | specified | PLT-R21 | — |
| PAR-PLT-034 | Property-scoped add-ons | assumption | P1 | specified | PLT-R22 | — |
| PAR-PLT-035 | Downgrade never deletes data; features become read-only | assumption | P0 | specified | PLT-R23, PLT-I10 | — |
| PAR-PLT-036 | Usage meters with caps that stop only the metered effect | assumption | P1 | specified | PLT-R24 | — |
| PAR-PLT-037 | Plan and usage page showing included features and limits | OPERA [Subscription Matrices](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/ch_feature_matrices.htm) — verified 2026-11-07 | P1 | specified | PLT §9 | — |

### 6. Policies, inheritance and configuration management

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PLT-038 | Policy catalog registered by modules (schema, default, levels, lockable) | OPERA [Configuring OPERA Controls](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_configuring_opera_controls.htm) — verified 2026-11-07 | P0 | specified | PLT-R25 | — |
| PAR-PLT-039 | Resolution default → organization → brand → region → property with source and local-override label | Shiji global/regional/brand configuration ([Daylight PMS](https://www.shijigroup.com/daylight-pms)) — verified 2026-11-07 (web search; vendor site blocks direct fetch) | P0 | tested | PLT-R26 | `modules/platform/test/platform.test.ts` "previews affected properties and keeps local overrides" |
| PAR-PLT-040 | Portfolio change preview listing affected properties before saving | assumption (no competitor documents it) | P0 | tested | PLT-R28 | `modules/platform/test/platform.test.ts` "previews affected properties and keeps local overrides" |
| PAR-PLT-041 | Locks at a higher level with exemptions reported, never silently deleted | OPERA [Rate Code Protection](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_editing_rate_code_protection.htm) (central vs property ownership) — verified 2026-11-07 | P1 | specified | PLT-R27 | — |
| PAR-PLT-042 | Policy history, scheduled changes and staged rollout groups | OPERA [Changes Log](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_logs_viewing_changes_log_details.htm) — verified 2026-11-07 | P1 | specified | PLT-R29 | — |
| PAR-PLT-043 | Override report per policy and property | assumption | P1 | specified | PLT-R30 | — |
| PAR-PLT-044 | Copy configuration codes to many properties at once | OPERA [Copying Configuration Codes to Multiple Properties](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_copying_configurations_to_multiple_properties.htm) — verified 2026-11-07 | P1 | specified | PLT-R15, PLT-R42 | — |
| PAR-PLT-045 | Feature switches per property (OPERA Controls equivalent) | OPERA [About OPERA Controls](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/ch_opera_controls.htm) — verified 2026-11-07 | P0 | different | PLT-R25, PLT-R40: typed, inherited policies plus entitlement/profile visibility instead of hundreds of flat flags | — |
| PAR-PLT-046 | User-defined fields and screen customization | OPERA [UDF Groups and Values](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_admin_enterprise_udf_groups.htm) · [Page Composer](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_getting_started_page_composer.htm) — verified 2026-11-07 | P2 | missing | — | — |
| PAR-PLT-047 | Configuration export/import as versioned files | Apaleo clone (research 02 §3.6) | P1 | specified | PLT-R42 | — |
| PAR-PLT-048 | Configuration reports (all codes and settings per property) | OPERA [Configuration Reports](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_reports_configuration.htm) — verified 2026-11-07 | P2 | missing | — | — |
| PAR-PLT-049 | Localized descriptions of configuration codes | OPERA [Localized Code Descriptions](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_enterprise_configuring_localized_code_descriptions.htm) — verified 2026-11-07 | P2 | specified | INV-R01, RAT-R01 (localized names) | — |

### 7. Business date

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PLT-050 | Business date per property, advanced only by Day Close by exactly one day | OPERA [Managing Business Date](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_toolbox_managing_business_date.htm) — verified 2026-11-07 | P0 | tested | PLT-R31, PLT-I04 | `modules/platform/test/platform.test.ts` "advances exactly one day and refuses a duplicate advance" |
| PAR-PLT-051 | Earliest Day Close start time and lag exception | OPERA automatic EOD scheduler (research 01 §3.1) | P0 | specified | PLT-R32 | — |
| PAR-PLT-052 | Advancing never logs anyone out or blocks other work | OPERA global logout to roll the date (anti-pattern, research 01 §3.1) | P0 | specified | PLT-R33 | — |
| PAR-PLT-053 | Business date mirrored from an external PMS in connected mode | assumption | P1 | specified | PLT-R34 | — |
| PAR-PLT-054 | Property-local date calculation that is DST-safe | assumption | P0 | tested | PLT §11 | `packages/kernel/src/dates.test.ts` "computes local date in a property time zone" |

### 8. Data authority and adoption

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PLT-055 | One system of record per property per domain; writes allowed, forwarded or refused | OPERA [Switching the Interface](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_switching_interface.htm) · SiteMinder PMS-fed updates override manual ones ([help](https://help-platform.siteminder.com/en/articles/13211820-troubleshoot-stop-sell-issues)) — verified 2026-11-07 (web search; vendor site blocks direct fetch) | P0 | tested | PLT-R35, PLT-R36, PLT-I06–I07 | `modules/platform/test/platform.test.ts` "defaults to Portico, and blocks or forwards writes …" |
| PAR-PLT-056 | Authority change preview with module impact, open items and required reconciliation | assumption (no competitor documents it) | P0 | specified | PLT-R37 | — |
| PAR-PLT-057 | Coherence rules between domains validated on save | assumption | P0 | specified | PLT-R38 | — |
| PAR-PLT-058 | Data-authority matrix per property and portfolio view | assumption | P1 | specified | PLT-R39 | — |
| PAR-PLT-059 | Feature visibility combining entitlement, profile and authority | assumption | P0 | specified | PLT-R40 | — |
| PAR-PLT-060 | Guided setup by profile ending in a go-live checklist (≈ 8 steps for a guesthouse) | Stayntouch [auto-configurator](https://stayntouch.freshdesk.com/support/solutions/articles/24000093959-stayntouch-auto-configurator-tool) · RoomRaccoon 28-day onboarding (research 03 §5.2) — verified 2026-11-07 (web search; vendor site blocks direct fetch) | P0 | specified | PLT-R41 | — |

### 9. Cross-cutting foundation used by every module

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PLT-061 | Append-only audit of consequential actions | OPERA [Changes Log](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_logs_viewing_changes_log_details.htm) — verified 2026-11-07 | P0 | tested | architecture rule 9 | `packages/db/test/core.test.ts` "is append-only for the application role" |
| PAR-PLT-062 | Idempotent mutating endpoints (retries replay, never duplicate) | assumption (architecture rule 7) | P0 | tested | architecture rule 7 | `apps/api/test/api.test.ts` "requires idempotency keys for creates and replays retries without duplicating"; `packages/db/test/core.test.ts` idempotency suite |
| PAR-PLT-063 | Global search across records, permission-aware | OPERA [Using Search](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_search_screens.htm) — verified 2026-11-07 | P1 | tested | domain map (universal record contract) | `apps/api/test/records.test.ts` "finds records across modules, permission-aware, with routes for the UI" |
| PAR-PLT-064 | One history timeline per record | OPERA [Viewing Changes Log Details](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_logs_viewing_changes_log_details.htm) — verified 2026-11-07 | P1 | tested | domain map (universal record contract) | `apps/api/test/records.test.ts` "returns one history timeline for a record, and hides other organizations’ records" |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-PLT-001 | User of organization A requests a property of organization B by id | Not found (no existence leak); no row readable even with a guessed id | P0 | tested | `modules/platform/test/platform.test.ts` "another organization cannot see properties even by id"; `apps/api/test/api.test.ts` scenario 17 |
| EC-PLT-002 | Database access without a tenant context | Fails closed | P0 | tested | `packages/db/test/core.test.ts` "fails closed when no tenant is set" |
| EC-PLT-003 | Two Day Close runners try to advance the same business date | Exactly one advance; the second gets "already advanced" | P0 | tested | `modules/platform/test/platform.test.ts` "advances exactly one day and refuses a duplicate advance" |
| EC-PLT-004 | Advance attempted before the earliest start time (22:00 local) | Rejected naming the earliest time in property local time | P0 | specified | — |
| EC-PLT-005 | Business date lags the calendar by ≥ 1 day | Manager-visible exception; work continues on the business date | P0 | specified | — |
| EC-PLT-006 | Two admins edit the same property concurrently | Second gets "changed by someone else" with current version | P0 | tested | `modules/platform/test/platform.test.ts` "detects concurrent edits with versions" |
| EC-PLT-007 | Creating a second property on a one-property plan | Refused with the limit and edition named | P0 | tested | `modules/platform/test/platform.test.ts` "creates properties … enforces plan limits" |
| EC-PLT-008 | Invalid time zone ("Mars/Olympus") | Refused with guidance to use an IANA name | P1 | tested | `modules/platform/test/platform.test.ts` "rejects invalid time zones with a helpful message" |
| EC-PLT-009 | Brand-level policy change where one property has a local override | Preview lists the overridden property as unchanged; override kept and labelled | P0 | tested | `modules/platform/test/platform.test.ts` "previews affected properties and keeps local overrides" |
| EC-PLT-010 | Policy saved with a stale preview | `409` and recomputed preview | P0 | specified | — |
| EC-PLT-011 | Organization locks a policy while properties have overrides | Overrides listed; each kept as a recorded exemption or removed explicitly; never silently deleted | P1 | specified | — |
| EC-PLT-012 | Write in a domain whose authority is external read-only | Refused naming the system of record | P0 | tested | `modules/platform/test/platform.test.ts` "defaults to Portico, and blocks or forwards writes …" |
| EC-PLT-013 | Write in `forward` mode, external system rejects it | Change stays pending until acknowledged; rejection shown with the external reason; nothing shown as done | P0 | specified | — |
| EC-PLT-014 | Switching `availability` authority while blocking discrepancies are open | Refused until the reconciliation report has none | P0 | specified | — |
| EC-PLT-015 | Incoherent authority (availability external, reservations Portico) | Validation error explaining the rule | P0 | specified | — |
| EC-PLT-016 | The connection behind an external authority fails | Matrix shows degraded; forwarded writes queue as pending; never shown as synced | P0 | specified | — |
| EC-PLT-017 | Trial environment tries to charge a card, message a guest or publish to a channel | Blocked or simulated; results labelled simulated | P0 | tested | `packages/kernel/src/context.test.ts` "never performs real effects outside live" |
| EC-PLT-018 | Trial reset while staff are working in it | Confirmation lists what is replaced; reset is atomic; users see a banner and are returned to the trial home | P2 | missing | — |
| EC-PLT-019 | Hotel asks to delete its trial while retention obligations apply | Deletion scheduled or data minimized per retention rule (Q44); hotel told what remains and why | P1 | specified | — |
| EC-PLT-020 | Organization suspended with guests in house (E13) | New bookings and postings blocked; check-out, payment collection and export allowed | P1 | specified | — |
| EC-PLT-021 | Downgrade removes `groups.blocks` while definite blocks have future cut-offs | Data read-only, but contractual automation (cut-off releases, allotment releases) keeps running so inventory is not held forever | P1 | missing | — |
| EC-PLT-022 | Message usage cap reached (E14) | Only messaging stops with recovery text; reservations, payments, check-in/out and Day Close continue | P1 | specified | — |
| EC-PLT-023 | Profile changed from guesthouse to hotel | Previewed; nothing deleted; newly visible features listed | P1 | specified | — |
| EC-PLT-024 | Property re-classified mid-year (Green Tax tier changes) | Effective-dated history; nights before the change keep the old tier | P0 | specified | — |
| EC-PLT-025 | Property sold to a new operating legal entity from business date D | New entity from D; in-house folios crossing D settled or transferred per a cutover checklist; invoices after D use the new entity's series | P1 | missing | — |
| EC-PLT-026 | Property moved to another region | Preview of inherited values that change; audited | P2 | specified | — |
| EC-PLT-027 | Set a property inactive with future confirmed stays | Refused until stays and folios are resolved | P1 | specified | — |
| EC-PLT-028 | Pilot property: a workflow outside the pilot scope is attempted | Blocked with explanation naming the pilot scope | P0 | specified | — |
| EC-PLT-029 | Pilot succeeds at one property of a group | Sibling properties stay in their status; activation is per property | P0 | specified | — |
| EC-PLT-030 | Clone property configuration | Unit types, rate structures without prices in effect, policies, charge codes copied; never reservations, guests, money or credentials | P1 | specified | — |
| EC-PLT-031 | 23:30 UTC is already the next day in Malé (UTC+5) | Local date computed in the property time zone | P0 | tested | `packages/kernel/src/dates.test.ts` "computes local date in a property time zone" |
| EC-PLT-032 | Earliest Day Close time on a DST change day (non-Maldives property) | Computed in local time without double or skipped runs | P1 | specified | — |
| EC-PLT-033 | Property closed for a season | Business date handling defined (automatic quiet Day Close or documented pause) without false lag alarms; sales closed | P2 | missing | — |
| EC-PLT-034 | Organization with a single property | Brand/region levels hidden; policies resolve organization → property | P1 | specified | — |
| EC-PLT-035 | Application tries to update or delete an audit row | Refused by database grants | P0 | tested | `packages/db/test/core.test.ts` "is append-only for the application role" |
