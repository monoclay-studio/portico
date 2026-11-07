# Gap assessment

Deliverable 1 of the operational-readiness brief (§22: "start by inspecting the existing project and comparing it
against this brief"). Owner: Operational Readiness lead. Assessed: 2026-11-07, branch `docs/operational-readiness`
(base commit `f65dff9`).

## 1. What exists today

| Item | State | Evidence |
|---|---|---|
| Owner briefs, decisions D1–D9, glossary, operating manual, domain map | Present | `docs/product/*`, `CLAUDE.md`, `docs/architecture/domain-map.md` |
| Research reports 01–04 | Present (dated 2026-11-07; several sources were network-blocked) | `docs/research/` |
| `packages/kernel` | Present: ids (UUIDv7), Money (minor units, currency exponents, Decimal rounding), LocalDate/DateRange/timezone helpers, DomainError hierarchy, clock, request context/actor, domain event types, module manifest, occupancy | `packages/kernel/src/*.ts` (≈530 lines). Additional kernel files and unit tests were observed in progress in the main working tree, not yet committed |
| `packages/db`, `packages/http`, `packages/testing`, `packages/ui` | **Not present** | — |
| `apps/*` (api, worker, backoffice, staff, guest) | **Not present** | — |
| `modules/*` (all 18 bounded contexts) | **Not present** | — |
| `infra/terraform` | **Not present** | — |
| ADRs, specs, scenarios | Directories referenced; none written yet on this branch | `CLAUDE.md` refers to ADR-0001..0010 |
| Readiness deliverables | Created by this work | `docs/readiness/` |
| External accounts | Monoclay Stripe account (SaaS side only), Stripe Atlas formation, Claude dev subscription (excluded). **No** AWS account designated, **no** Channex, PSP platform, messaging, AI production, or advisers | `decisions.md`, owner statements |
| Deployed environments | None (zero spend) | Q4 |

**Overall:** every product capability and every integration is at **R1 Planned**. The foundation is in progress.

## 2. Product brief (docs/product/brief.md) vs current state

| Brief area | Required outcome (summary) | Planned in | Exists | Main internal gaps | External gaps / dependencies |
|---|---|---|---|---|---|
| §2 Customers, scope, ownership | Org → brand/region → property; legal entities; owners; customer money separation | `platform`, `identity`, `billing` (waves 0, 3) | Kernel context/actor types only | Tenancy, RLS, legal entities, entitlements | None |
| §3 Principles | State/history/issues/owner/next actions on records; facts vs pending vs estimates | All modules, `packages/ui` | — | Design system; audit; status vocabulary | None |
| §4 Reservations & availability | Unit types vs assignments, composite units, all booking types, change previews, last-room concurrency, overbooking workflow | `inventory`, `reservations`, `groups` (waves 1–2) | — | Everything | OTA conflicts depend on distribution (Channex) |
| §5 Rates, packages, revenue | Seasonal/derived/negotiated rates, restrictions, inclusive/exclusive taxes, service charges, packages, snapshots, RM metrics | `rates`, `analytics` | Money/Decimal primitives | Quote engine; **tax engine with Maldives rules as data** | Maldives tax rules unconfirmed at primary source (market matrix); RMS partners later |
| §6 Front desk | Arrivals/departures/in-house, room readiness, interrupted workflows, shift handover | `reservations`, `operations`, `apps/backoffice` | — | Everything | Door locks (optional), terminals (Route D) |
| §7 Guests & communication | Booker/guest/payer distinction, history, dedupe + reversible merge, cross-property sharing, unified inbox, translation | `guests`, `comms` | — | Everything | SES, WhatsApp, SMS, translation providers |
| §8 Housekeeping & maintenance | Assignments, inspections, maintenance impact on inventory, mobile workflows, escalation | `operations`, `apps/staff` | — | Everything; offline PWA | None |
| §9 Finance, folios, payments | Ledger, folio windows, routing, deposits, auth vs capture, invoices/credit notes, AR, cashier, FX, reconciliation | `finance`, `payments` | Money type | Everything | **Payment provider eligibility in the Maldives**; PCI scoping |
| §10 Night audit | Controlled, resumable Day Close without duplicates | `day-close` | — | Everything | None |
| §11 Distribution & direct booking | Booking engine, channel health, duplicates/delays/missed messages, honest sync state | `distribution`, `apps/guest` | — | Everything | Channex certification/contract; OTA authorizations; Google partner |
| §12 Groups, events, outlets, resort ops | Group sales lifecycle, function space, outlets, meal plans, transfers, activities, weather | `groups`, `resort` | — | Everything | POS, transport operators (manual), spa/activity systems |
| §13 Portfolio & analytics | Central policies with overrides, consolidated metrics with definitions, drill-down | `platform`, `analytics` | — | Everything | None |
| §14 Automation & AI | Transparent automations; cited, permission-aware AI; approvals | `comms`, `ai` | — | Everything | Anthropic/Bedrock terms and budget |
| §15 UX | Polished, keyboard/touch, accessible, concurrent edits | `packages/ui`, apps | Kernel `VersionConflictError` | Everything; usability evaluation with real staff | Hotel staff for validation (no pilot yet) |
| §16 Migration, continuity, trust | Imports with reconciliation, training/demo separation, offline honesty, backups, export | `integration`, `platform`, infra | — | Everything | Source-system export rights/fees; pilot data |
| §17 20 operational proof scenarios | Evidence per scenario | `docs/scenarios/` | — | No scenario evidence yet | Some need sandboxes (2, 5, 6, 20) |
| §18 Standard for completion | Distinguish demo / working / integrated / validated / pilot-ready / proven | `readiness-register.md` | Register created (all R1) | Evidence collection process | — |

## 3. Operational-readiness brief vs current state

| Brief § | Required outcome | Status 2026-11-07 | Where addressed | Remaining gap |
|---|---|---|---|---|
| §1 Business boundaries | Monoclay vs product vs customers vs hotel entities; SaaS money ≠ guest money | Designed (CLAUDE.md §4.14; D2) | `responsibility-matrix.md` | Monoclay tax position on SaaS (Q20); product-level bookkeeping policy (business docs M2) |
| §2 Honest readiness statuses | 9 levels, technical vs approval separate, evidence | Register created | `readiness-register.md` | Evidence process to be used by every merge |
| §3 Dependency register | All fields per provider | Done (many `[unconfirmed]`) | `dependency-register.md` | Live verification (network blocked); provider answers |
| §4 Channels | Capability matrix, direct vs hub, what hub covers | Done (mostly Unverified) | `channel-capability-matrix.md` | Channex per-channel capability list |
| §5 Channex baseline | Dated baseline; billing start; certification | Recorded | `channel-capability-matrix.md` §1 | Re-verify before purchase; contract terms |
| §6 Integration correctness | Ownership, mapping, acks, recovery, safe disconnection | Designed | `channel-capability-matrix.md` §5 | Implementation (wave 2b) |
| §7 Payments & money flows | Every scenario documented | Done | `responsibility-matrix.md` | **Maldives payment eligibility** (Q2, X1, X2) |
| §8 PCI | Responsibilities; SP vs merchant; boundary | Designed | `certification-approval-matrix.md` P1/P2; security doc SEC-15 | PSP/QSA confirmation |
| §9 Other integrations | Requirements per category; manual alternatives | Done (category tables) | `dependency-register.md` §6 | Hotel-specific hardware facts (no pilot) |
| §10 Certifications | Matrix by category | Done | `certification-approval-matrix.md` | All items not started |
| §11 Markets | Supported-market register; Maldives specifics | Done (Maldives partially validated) | `market-matrix.md` | **Service charge, invoice, reporting, FX, retention rules unconfirmed** |
| §12 Privacy | Roles per purpose, retention, DSRs, support access | Draft | `security-privacy-readiness.md` | Counsel review |
| §13 Security admin | Acceptance criteria + evidence | Defined | `security-privacy-readiness.md` §1 | Implementation; pen test |
| §14 Comms & AI | Provider requirements, costs, AI safeguards | Done | `dependency-register.md` §4–5; security §7 | Provider terms; WhatsApp rate card |
| §15 Infra & recurring costs | All cost lines incl. human ops | Done (estimates) | `cost-model.md` | Verified AWS prices |
| §16 Zero-cost demo & cost control | Demo approach; notification vs hard cap; scenarios 0/1/10/50/100 | Done | `cost-model.md` §3–4 | Implementation of quotas/meters |
| §17 Reliability & recovery | Targets, continuity, incident roles, restore verification | Done (targets) | `support-recovery-plan.md` | Measurement once hosted; support promise (Q21) |
| §18 Migration & onboarding | Checklist; cutover/rollback without erasing new data | Done | `migration-onboarding-checklist.md` | Importers; vendor export terms |
| §19 Quality & acceptance evidence | Dependency scenarios + staff validation | Listed | `launch-checklist.md`, certification matrix IQ2 | `docs/scenarios/` evidence |
| §20 Contracts & commercial | Business documents register | Done | `business-documents-register.md` | Nothing drafted or reviewed |
| §21 Launch gates | Five gates with evidence and decision-makers | Done | `launch-checklist.md` | — |
| §22 Deliverables | 12 deliverables | Done (this directory) | `README.md` | Keep maintained |

## 4. Top gaps (prioritised)

| # | Gap | Why it matters | Owner | Next action | What proceeds meanwhile |
|---|---|---|---|---|---|
| 1 | **Payment processing eligibility for Maldivian hotel entities** | Stripe/Adyen believed unavailable `[unconfirmed]`; local bank APIs unknown | Founder | X1, X2 (roadmap) | Route D record-only payments; simulator; Stripe test mode |
| 2 | **Maldives tax and invoice rules beyond TGST/green-tax rates** (service charge base and distribution, invoice contents, currency, filing, guest reporting, retention) | Wrong invoices = hotel compliance risk | Founder → adviser | Q20; market-matrix §2.12 | Engine with rules-as-data |
| 3 | Foundation incomplete (db/RLS/audit/outbox/idempotency) | Everything depends on it | Engineering lead | Finish wave 0 | Specs and readiness docs |
| 4 | No pilot hotel | Gates 3–5; real data; staff validation | Founder | Outreach after Gate 1 demo; Q26 | All engineering |
| 5 | No verified prices / provider terms (AWS, Channex re-check, messaging) | Cost decisions | Founder | Allow-list hosts or verify manually; quotes | Estimates labelled |
| 6 | Contracts/DPA/insurance not started | Cannot sign a pilot | Founder | Counsel/broker quotes | Register |
| 7 | Support capacity undefined | Cannot promise service | Founder | Q21 | Runbooks |
| 8 | Security assurance path undefined | Group/enterprise sales | Founder | Q24 when triggered | Audit-ready controls |
