# Readiness register

Single source of truth for the readiness of every capability and integration (CLAUDE.md §7; readiness brief §2).
Maintained by the orchestrating session; every change cites evidence. Last updated: 2026-11-08 (distribution rows: module agent, fix round 1 P3-3, pending orchestrator review).

**Scale (technical level):** R1 Planned · R2 Demonstrated with sample data · R3 Implemented and tested internally ·
R4 Tested against the provider's sandbox (integrations only) · R5 Submitted for required external approval ·
R6 Approved for the specific production scope · R7 Configured and validated for a particular hotel · R8 Operating
successfully in a controlled live pilot · R9 Supported for wider production use.

**Rules:**
- *Technical level* (R1–R4) and *external approval status* (R5–R6 and the approval itself) are separate columns — one
  never implies the other. *Hotel validation* (R7–R8 and staff workflow validation) is a separate column again.
- A simulator is never a working integration; an API call is never certification; a provider's certification is never
  ours.
- Evidence must state what was tested, where, when, by whom and the result. "—" means no evidence yet.
- Foundation items are left at R1 here; the orchestrator updates them when wave 0 merges with evidence.

External approval vocabulary: **Not required** · **Not started** · **Submitted** (date) · **Approved** (scope, date) ·
**Rejected**. Hotel validation vocabulary: **Not started** · **Staff-validated** (hotel, date) · **Configured for**
(hotel) · **Live pilot** (hotel, dates).

## 1. Foundation and platform

| Capability | Technical level | External approval status | Hotel validation | Evidence link |
|---|---|---|---|---|
| Kernel primitives (ids, Money, dates, errors, context, events) | R1 (in progress) | Not required | N/A | `packages/kernel/` |
| Database access, tenant transactions, RLS | R1 | Not required | N/A | — |
| Tenant isolation (app authz + RLS), incl. exports/search/integrations | R1 | Not required (pen test later) | N/A | — |
| Transactional outbox and idempotency | R1 | Not required | N/A | — |
| Audit trail (append-only) | R1 | Not required | N/A | — |
| Field-level encryption for identity documents | R1 | Not required | N/A | — |
| Environment safety (demo/training/sandbox; `assertExternalEffectAllowed`) | R1 | Not required | N/A | — |
| Organizations, brands, regions, properties, legal entities, business date | R1 | Not required | Not started | — |
| Policies with inheritance and local overrides | R1 | Not required | Not started | — |
| Editions and entitlements | R1 | Not required | N/A | — |
| Identity: users, MFA, roles, scoped permissions | R1 | Not required | Not started | — |
| SSO (SAML/OIDC) and SCIM | R1 | Not required | Not started | — |
| Support access controls and break-glass | R1 | Not required | Not started | — |

## 2. Product capabilities

| Capability | Technical level | External approval status | Hotel validation | Evidence link |
|---|---|---|---|---|
| Inventory: unit types, units, composite units, availability ledger, holds | R1 | Not required | Not started | — |
| Last-room concurrency (scenario 1) | R1 | Not required | Not started | — |
| Assignments, blocks (OOO/OOS/house use), authorized overbooking | R1 | Not required | Not started | — |
| Rates: plans, derived rates, restrictions, promotions, packages, meal plans | R1 | Not required | Not started | — |
| Quote engine and terms snapshots | R1 | Not required | Not started | — |
| Tax & fee engine (rules as effective-dated data) | R1 | Not required | Not started | — |
| Maldives tax pack: TGST 17% (from 2025-07-01), green tax $12/$6 by class, service charge rule | R1 | Rules partially validated (secondary-to-official sources, 2026-11-07); MIRA/adviser confirmation **not started** | Not started | `market-matrix.md` §2 |
| Guests: profiles, companies/agencies, duplicates, reversible merge, consent | R1 | Not required | Not started | — |
| Cross-property guest sharing controls | R1 | Not required | Not started | — |
| Reservations lifecycle, change previews, room moves, extensions | R1 | Not required | Not started | — |
| Front-desk views, check-in/out, shift handover | R1 | Not required | Not started | — |
| Finance: double-entry ledger, folios, windows, routing | R1 | Not required | Not started | — |
| Deposits (liability), AR, credit limits, aging | R1 | Not required | Not started | — |
| Invoices/credit notes with gapless numbering | R1 | Maldives invoice requirements: Not started (adviser) | Not started | — |
| Cashier sessions, cash handling, FX with explicit rates | R1 | Not required | Not started | — |
| Payments domain (provider-agnostic) + simulator | R1 | Not required | Not started | — |
| Payments Route D: record-only tenders + terminal batch reconciliation | R1 | Not required | Not started | — |
| Payment reconciliation (daily, PSP vs ledger) | R1 | Not required | Not started | — |
| Dispute evidence pack | R1 | Not required | Not started | — |
| Operations: housekeeping, inspections, maintenance, service requests, escalation | R1 | Not required | Not started | — |
| Day Close (resumable, idempotent) | R1 | Not required | Not started | — |
| Distribution core: mappings, ARI queue, revision log, acks, health panel | R3 (branch `feat/distribution-channex`, not yet merged) | Not required | Not started | `pnpm --filter @portico/distribution test`: 20 files, 151 passed + 2 todo, 2026-11-08, distribution module agent, against real Postgres with the real platform/inventory/rates/secrets bindings and a strict reservations fake; steward review fix round 1 applied (`docs/orchestration/reviews/review-distribution.md`). Real channel ingestion blocked on main by reservations' rates binding (README). |
| OTA simulator | R1 | Not required | N/A | — |
| Groups: blocks, allotments, pickup, rooming lists, function space, events | R1 | Not required | Not started | — |
| Communications workspace, templates, automations, translation | R1 | Not required | Not started | — |
| Integration: public API, webhooks, connector framework | R1 | Not required | Not started | — |
| Migration importers (generic CSV, OPERA) with reconciliation reports | R1 | Not required | Not started | — |
| Tenant data export | R1 | Not required | Not started | — |
| Analytics: metric definitions, daily facts, drill-down, data quality | R1 | Not required | Not started | — |
| Resort: POS charge intake, meal-plan entitlements, transfers/manifests, activities/spa, waivers, itineraries, weather | R1 | Not required | Not started | — |
| AI assistant (cited, permission-aware, approvals, budgets) | R1 | Provider terms review: Not started (Q25) | Not started | — |
| Booking engine and guest portal | R1 | Not required (PCI support evidence later) | Not started | — |
| Staff PWA (offline housekeeping/maintenance) | R1 | Not required | Not started | — |
| Continuity pack (internet-loss snapshot) | R1 | Not required | Not started | — |
| Monoclay SaaS billing (separate from guest money) | R1 | Not required | N/A | — |
| Backups with verified restore drills | R3 in code only: the restore drill, its freshness alarm (missing data counts as breaching) and the backup and DR-copy missing-job alarms pass `terraform test` with mocked providers, and their mutants are red. Never deployed or run on AWS | Not required | N/A | `infra/README.md`, `docs/runbooks/backup-restore-verification.md` (2026-11-07) |

## 3. Integrations

| Integration | Technical level | External approval status | Hotel validation | Evidence link |
|---|---|---|---|---|
| Stripe Connect (direct charges) + Terminal | R1 | Not started (platform activation; eligibility for Maldivian entities `[unconfirmed]`) | Not started | `dependency-register.md` §2.1 |
| Stripe Billing (Monoclay SaaS) | R1 | Not required (existing Monoclay account) | N/A | §2.2 |
| Adyen for Platforms | R1 | Not started | Not started | §2.3 |
| Bank of Maldives (BML Connect / acquiring) | R1 | Not started (API/sandbox existence `[unconfirmed]`) | Not started | §2.4 |
| Maldives Islamic Bank | R1 | Not started | Not started | §2.5 |
| "CBM" (identity to confirm) | R1 | Not started | Not started | §2.6 |
| PCI vault / Channex PCI | R1 | Not started (certified-partner status required) | Not started | §2.9 |
| Channex (ARI, bookings, mapping) | R3 — adapter tested against Portico's own Channex **simulator** only (no call to the real Channex API; a simulator is not a working integration); R4 needs the owner's staging key | Not started (certification + contract required) | Not started | §3.1; `modules/distribution/README.md` "Channex: what is verified and what is not" (WIRE_FACTS statuses) and "R4 staging plan"; tests as above, 2026-11-08 |
| Booking.com via Channex | R1 | Not started (via Channex; hotel authorization) | Not started | `channel-capability-matrix.md` |
| Expedia via Channex | R1 | Not started | Not started | same |
| Airbnb via Channex | R1 | Not started | Not started | same |
| Agoda via Channex | R1 | Not started | Not started | same |
| Trip.com via hub | R1 | Not started | Not started | same |
| Hotelbeds / bedbanks via hub | R1 | Not started | Not started | same |
| Booking.com direct | R1 | Not started (later) | Not started | same |
| Expedia direct | R1 | Not started (later) | Not started | same |
| Agoda YCS direct | R1 | Not started (later) | Not started | same |
| GDS via CRS/switch | R1 | Not started (later) | Not started | same |
| Google Hotel Center / free booking links | R1 | Not started | Not started | same |
| AWS hosting (ap-south-1 default) | Infrastructure as code R3 (tested offline: `terraform test` 38/38, `verify-roles.sh` 53/53, deploy-script test 28/28, on 2026-11-07); on AWS R1, never applied | Not started (Q4 authorization) | N/A | `infra/README.md`; `dependency-register.md` §4.1 |
| Amazon SES | R1 | Not started (production access) | Not started | §4.2 |
| Twilio SMS | R1 | Not started | Not started | §4.3 |
| Meta WhatsApp Cloud API | R1 | Not started (business verification, templates) | Not started | §4.4 |
| Anthropic Claude API / Bedrock | R1 | Not started (terms/DPA) | Not started | §5.1 |
| Translation provider | R1 | Not started | Not started | §5.2 |
| Door locks (ASSA ABLOY, dormakaba, Salto) | R1 | Not started (partner agreements) | Not started | §6.1 |
| POS (Simphony, Lightspeed, Toast, Agilysys, local) | R1 | Not started | Not started | §6.2 |
| Accounting (Xero, QuickBooks, NetSuite, SAP) | R1 | Not started | Not started | §6.3 |
| Salesforce | R1 | Not started | Not started | §6.4 |
| Identity verification | R1 | Not started | Not started | §6.5 |
| Fiscal middleware (EU markets) | R1 | Not started (later) | N/A | §6.6 |
| Revenue management (IDeaS, Duetto, Atomize/Mews RMS) | R1 | Not started | Not started | §6.7 |
| Oracle OHIP (OPERA Cloud migration) | R1 | Not started | Not started | §6.8 |
| Monitoring / paging / status page | R1 | Not required | N/A | §7 |

## 4. Markets

| Market | Status | Evidence link |
|---|---|---|
| Maldives | Candidate; requirements partially validated (TGST, green tax rates only) | `market-matrix.md` §2 |
| All others | Not supported | `market-matrix.md` §3 |
