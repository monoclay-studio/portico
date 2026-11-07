# Portico gap plan — where we stand and what makes us 10x

Status: v1 · 2026-11-07 · Author: gap strategist · Reviewed against `main` @ e85605f plus the branches
`feat/identity-platform-enterprise`, `feat/backoffice-core`, `feat/integration-step` and `docs/parity-ops` (read-only).
Role and format: `docs/orchestration/operating-model.md`. Per-module briefs: `docs/strategy/modules/<module>.md`.

> **Every target in this folder is a TARGET until it is validated with hotel staff** (brief §15, `docs/product/
> ux-principles.md` §19). Nothing here is a claim that Portico is already better than anyone. Competitor facts are
> cited to our research files; where the research is uncertain we say so. No prices, legal opinions or commitments
> are made here — those are owner questions (Q150–Q155, §9).

## 0. Source key (used in every brief)

| Code | File |
|---|---|
| R01 / R02 / R03 / R04 | `docs/research/01-enterprise-vendors.md` / `02-modern-cloud-vendors.md` / `03-smb-distribution-vendors.md` / `04-connectivity-payments-compliance.md` |
| DG | `docs/research/05-digest.md` (finding numbers `DG #n`, module table `DG §2`) |
| DD01…DD11 | `docs/research/05-market-deep-dive/01-…11-*.md`; DD02a = `02-vendor-profiles-enterprise.md`, DD02b = `02-vendor-profiles-cloud-smb.md`, DD02c = `02-vendor-profiles-adjacent.md` |
| CS | `docs/product/competitive-synthesis.md` |
| UX1 | `docs/ux/round-1/blackbox-findings.md` (black-box tester, round 1) |
| UXP | `docs/product/ux-principles.md` (§19 = usability targets) |
| PAR-x | `docs/parity/<module>.md` rows; numbers from `node tools/parity-report.mjs` on 2026-11-07 |
| REV-x | `docs/orchestration/reviews/review-<module>.md`; PF = `docs/orchestration/pending-fixes.md` |
| README-x | `modules/<module>/README.md` on `main` (or the named branch) |

Evidence labels from the research are kept: [V] primary read, [S] search summary, [VC] vendor claim, [3P] third
party, [I] inference.

---

## 1. Where Portico stands today

### 1.1 One paragraph

Portico has **ten wave-1 engines on `main` at R3** (implemented and tested internally): platform, identity (wave 0),
inventory, rates (with the tax engine), guests, reservations, finance, payments, operations and integration — roughly
**1,000 automated tests** against real Postgres, with tenant isolation, idempotency, audit and optimistic concurrency
proven in tests and checked by eleven independent steward reviews (`docs/orchestration/reviews/`). The **engines are deep and honest; the product a hotel
would touch is not there yet.** Cross-module ports are still being bound (`feat/integration-step`), the staff web app
shows the operational workspaces on **simulated** data (README-backoffice §Status), the enterprise identity branch is
blocked by a new P0 (REV-identity-plus-2 R2-P0-1), and **nothing is R4 or above**: no sandbox-tested integration, no
staff validation, no pilot. The black-box tester completed **5 of 34 core tasks** and hit **14 blockers across 8 of 9
personas** (UX1 persona tables). Twenty modules (Day Close, distribution, groups, comms, analytics, resort, POS, …) are
specified but unbuilt.

### 1.2 Scoreboard by dimension (today vs market)

| Dimension | Portico today (evidence) | Market best today (evidence) | Verdict |
|---|---|---|---|
| **Powerful** | Engines: double-entry ledger with keyed postings, deposits as liabilities with tax at receipt, gapless hash-chained fiscal series (README-finance); composite units with provably consistent availability and `explainAvailability` (README-inventory); sealed agreed terms + single tax engine (README-rates); pending verification, provider journal, Route D (README-payments); offline sync with explicit conflicts (README-operations). Parity "tested/equivalent": rates 61%, payments 50%, finance 30%, platform 28%, inventory 1%, reservations 1% (stale — see §1.4); every wave-2+ module 0%. P0 rows still open: reservations 100, finance 78, inventory 53, payments 28, platform 30, rates 13. | OPERA: the canonical model and complete depth, ~5 releases/yr with 70–170 items each, adding Leisure Management, Service Order Management, Digital Registration in 26.4 (DD02a §1.1–1.2; DG #11, #13). Mews OS bundles PMS+RMS+CM+messaging+AR (DD02b §1.2). | **Behind in breadth, at or ahead in correctness design.** No distribution, Day Close, groups, comms, analytics, POS, resort or booking engine. |
| **Seamless** | Architecture is built for it: one transaction per command across modules, previews with fingerprints (RES-R11/R12), universal record contract on most records, global search endpoint. But ports are partly stubbed (`module_not_available`), contract vocabularies diverge (PF: payer types, `aggregateVersion`, ADR-0015), and the UI's operational screens are simulated, so **no task can be done end to end through the UI** (UX1 top-20 #1–#7). | Mews: approachable flows, status-to-task automation, app-less guest portal (R02 §2.7). Cloudbeds: one inventory across PMS/CM/BE/payments (R03 §3.2). Stayntouch: desk-less mobile operations (R02 §4.3). | **Not yet experienced by a user.** The change preview is already rated "better than anything in Cloudbeds or Mews" by the tester (UX1 top-10 #2). |
| **Friendly** | UX1: no create flows, raw validation JSON, developer jargon ("wave 1 in progress"), 1024 px overflow, empty help, search misses in-house and past guests; strong keyboard model, self-explaining disabled buttons, honest payment wording (UX1 top-10). **0 staff validation sessions.** | Training gap is industry-wide: 52% of managers say desk confidence takes 4 months–3 years; 38% say PMS usability influenced leaving a job (DD03 §2.2 [S][VC], sponsored). Mews/Stayntouch praised for ease (R02 §2.6, §4.4). No vendor publishes time-to-competency (DD03 §2.2). | **Unproven, with blockers.** The opportunity is real: nobody measures learnability. |
| **Well-rounded** | Edge cases tested: payments 66%, rates 59%, finance 44%, others 0–3%. Data authority enforced on every write in every built module (`assertWritable`); forward mode mostly "refused honestly"; mirror mode only partial (guests, operations). Maldives: MIRA-sourced tax pack not adviser-confirmed (Q20), Green Tax rules, seaplane/transfer data, Route D; receipts missing despite the 3-day rule (README-finance F-10); no Dhivehi; no e-invoicing adapter. | OPERA's country treadmill every release (DD02a §1.1); Mews/Apaleo bulk export APIs (DD02b §1.3, DG #17); Oracle's free embedded AI (DG #15). | **Strong foundations (adoption modes, environments, provenance) with thin coverage.** |

### 1.3 Where we are already designed to beat the market (R3 — proven in tests, not with staff)

1. **Money truth:** authorization ≠ payment, `pending_verification` first-class with resolver backoff and an event
   backstop, refunds bounded after corrections, payouts never revenue (README-payments; REV-payments verdict).
2. **Previews before consequences** with stale-preview refusal and alternatives on the last-unit race (RES S01, S03).
3. **Composite and linked inventory** with explanations for every number (README-inventory) — the area where
   Cloudbeds and RMS make trade-offs (R03 §3.2, §7.2).
4. **Reversible profile merge with snapshots** — Stayntouch cannot merge at all (R02 §4.4), OPERA's sharing switch is
   irreversible (R01 §2.4).
5. **Data authority per domain** — the dual-PMS hazard Cloudbeds warns about (R03 §9.2 item 7) is a refusal in Portico.
6. **Honest integration catalogue** — workflow-level capabilities, technical readiness and external approval as
   separate fields (README-integration), versus support-gated or NDA-gated access elsewhere (R02 §2.8, R01 §6.4).

### 1.4 Measurement integrity problems to fix first

- **Parity files are stale for built modules.** Inventory and reservations show 1% tested while their READMEs list
  dozens of rows proven by tests (README-inventory § Competitive parity status; README-reservations scenario table).
  Module agents must reconcile their matrix in their first increment, or every "10x" number is noise.
- **Sixteen modules have no parity file**: guests and operations exist only as drafts on `docs/parity-ops`; identity,
  integration, migration, comms, resort, access, guest-experience, guest-services, crm, contracting, ai, billing,
  workforce, concessions, utilities have none. No baseline → no measurable "better".
- **The committed `docs/parity/COVERAGE.md` is itself stale** (it shows rates at 2% tested and payments at 54%; a fresh
  `node tools/parity-report.mjs` gives 61% and 50%). Regenerate it at every merge; this plan uses fresh numbers.
- **A stale build cache reported a passing typecheck** that failed when forced (REV-identity-plus-2 R2-P2-6). Gates
  must run `--force` in CI for merges.
- **UX scorecard row R1 is empty** (`docs/ux/scorecard.md`). Baseline from UX1: 5/34 tasks done fully, 14 blockers.

---

## 2. What "10x" means here — the measurement contract

The owner's mandate is "3x–10x more powerful, seamless, friendly and well-rounded than anything on the market,
measured rather than claimed" (`docs/orchestration/operating-model.md`). We measure four things, per module and for
the platform, the same way every round:

| Dimension | Platform metric (TARGET) | How measured | Market reference |
|---|---|---|---|
| Powerful | 100% of P0 parity rows and P0 edge cases `tested`; all 20 proof scenarios pass through `apps/api` real workflows; ≥ 80% of routine shift work automated or one action (exceptions-only operation) | `pnpm parity --gate`, `apps/api/test/scenarios/`, automation-share log (actions taken by policy ÷ all actions) | OPERA completeness (R01 §2.2); Mews automation (R02 §2.3) |
| Seamless | Core desk tasks in ≤ ⅓ of the human-equivalent steps of the incumbent flow; zero re-typing of data Portico already holds; context kept across modules (no "go to another module and search again") | UX1 counting rule (clicks/taps + keystroke bursts + screens), repeated each UX round on the same task list | Measured on competitor demo/trial flows when available; until then UXP §19 absolute targets |
| Friendly | New desk agent completes the 10 core tasks unaided **within one shift (≤ 4 h training)**; ≤ 1 help request per 10 tasks; 0 error messages without a recovery step | UXP §19 protocol (≥ 5 users per role, Maldivian staff, non-native English speakers) | 4 months–3 years to desk confidence (DD03 §2.2, sponsored) |
| Well-rounded | Every P0/P1 edge case in the catalogue handled and tested; every module usable **standalone and in connected mode** where the adoption brief offers it; Maldives pack + one non-Maldives pack (to prove "global") | Parity EC rows; A01–A07 adoption evidence (`docs/scenarios/README.md` §3); country-pack tests | OPERA country packs every release (DD02a §1.1) |

Rules: (1) a target is reported as **better / comparable / behind** with the evidence (vision "Ease gate");
(2) a competitor baseline is never invented — if we have not measured it, the cell reads "baseline to measure";
(3) a refinement that removes or hides a capability fails the **power check** regardless of other gains
(`docs/ux/scorecard.md` last row).

---

## 3. The 14 platform moves that create a 10x advantage

Each move names the evidence for the gap, the modules involved, its 10x measure and where it sits in the sequence
(§4). Moves are ordered by dependency, not by glamour.

### M1 — Compose the product: every port bound, every scenario through real workflows, no simulated core shift
- **Why:** engines exist but a hotel cannot run a shift; UX1's top 7 frictions are all "not connected yet". Pending
  cross-module fixes are long (PF).
- **What:** finish `feat/integration-step` (bind reservations↔rates/finance/payments/guests/operations, finance↔rates
  tax, payments↔finance ledger, integration↔platform transitions); converge contract vocabularies (payer types,
  `aggregateVersion` on every state event, ADR-0015 property-scoped delegation); S01–S20 + E01–E15 + A01–A07 in
  `apps/api/test/scenarios/`; backoffice swaps every simulated workspace for the live API.
- **Modules:** all wave-1 modules, apps/api, backoffice. **10x measure:** 20/20 proof scenarios green end to end;
  0 SIMULATED badges on core desk, housekeeping, finance screens in a live-data demo.
- **Sequence:** now (Phase A). Blocks everything else.

### M2 — One record, one command surface, one search
- **Why:** the brief's "one product, not modules" (§3, §15); UX1 found the palette has no commands, `N` creates
  nothing, search misses in-house/past guests and phone numbers, tiles open the wrong lists (UX1 top-20 #1, #8, #16).
- **What:** (a) every primary record type implements the universal record contract (`status`, `allowedActions` with
  reasons, `issues`, `owner`, `links`, `provenance`) — platform/identity records still lack it (README-platform,
  README-identity on identity-plus); (b) an **action registry**: every `allowedAction` is a command addressable from
  the record drawer, the command palette, a hotkey and the API with the same preview/commit contract; (c) one
  **exception shape** (`listExceptions` → `{code, severity, blocking, ref, owner, message, actions[]}`) consumed by My
  work, handover and Day Close (DCL-R01; RES-R38 still own shape); (d) **search providers for every record type**,
  including stays by any occupant, past stays, phone/email any format, confirmation and channel ids.
- **Modules:** kernel, every module's `records`/`search`, backoffice, ai (M12 builds on the registry).
  **10x measure:** find any guest/booking ≤ 5 s, ≤ 2 interactions (UXP §19); every action reachable in ≤ 2
  interactions from wherever the record appears; 0 "go elsewhere and search again" hand-offs in the core task list.
- **Sequence:** Phase A, in parallel with M1.

### M3 — Truthful operations, end to end
- **Why:** the vision's first pillar; competitors' worst reviews are silent failures and "synced"/"paid" lies (CS D2;
  R02 §2.8 #4; R03 §9.2). UX1 found contradictions even in the simulation ("Paid" with a balance due, 9 vs 7 ready,
  check-in allowed for a guest in the air).
- **What:** a single **status-family vocabulary** served by the server and rendered, never derived, by the UI
  (payment chip = payments' status family, never a client computation); provenance labels on every value
  (`live/simulated/copied/delayed/incomplete/external`); `pending verification` used identically for payments,
  channel deliveries, lock encodes, forwarded writes and fiscal submissions; **contradiction tests**: automated checks
  that two screens can never show incompatible states for one record (same query, same projection).
- **Modules:** kernel (status families), payments, distribution, access, integration, finance, reservations,
  backoffice. **10x measure:** 0 contradictory states across the 20 scenarios; 100% of external effects show
  provenance and last-confirmed time.
- **Sequence:** Phase A (contract), then every module as it ships.

### M4 — Productive in one shift (learnability as a product feature, measured)
- **Why:** training is the most-cited barrier to switching PMS (26%, ahead of migration at 24% — DD08 §2.1 [3P], sponsored); nobody publishes
  time-to-competency (DD03 §2.2, §11). UX1: help and lessons are empty shells; copy is developer language.
- **What:** role workspaces that open on the day's work; inline guided tasks generated from the action registry (M2);
  plain-language copy and error contract ("what happened, what it means, what to do") enforced by a lint on strings;
  a personal **training organization** per user with "reset my practice data"; staff languages (Dhivehi plus the
  attendants' languages, Q155); the UXP §19 protocol run with Maldivian staff (Q152).
- **Modules:** backoffice, apps/staff, every module's strings and errors, platform (training environments), identity.
  **10x measure:** new desk agent independent on the 10 core tasks in ≤ 4 h training (vs 4 months–3 years cited
  above); ≤ 1 help request per 10 tasks; 0 raw technical messages (UX1 #12–#13).
- **Sequence:** Phase A copy and errors; Phase B measured sessions.

### M5 — Money without doubt (collect, record, reconcile, prove)
- **Why:** Mews' double-charge risk between links and automation (R02 §2.8 #4); Maldives: no Stripe (D10), card fees
  ~2.5%, Favara/national QR coming (DD09 §6); MIRA 3-day invoice-or-receipt rule (DD09 §7, README-finance F-10).
- **What:** collection plans with exactly one executor per item (PAY-R20–R22); hosted card entry; receipts and
  deposit receipts as fiscal documents; Route D + bank transfer + cash + Favara/QR as **recorded-then-verified**
  methods with statement matching; payout and fee reconciliation (PAY-R16, R25); cancellation deposit treatment and
  no-show charging (unowned in PF — assign to payments+finance); e-invoice adapter seam for MIRA.
- **Modules:** payments, finance, rates (schedules), reservations, comms (link delivery), day-close.
  **10x measure:** 0 duplicate charges/refunds under the full fault matrix; 100% of payments matched to a provider,
  terminal batch or bank line within 1 business day or shown as an owned exception; invoice/receipt issued within the
  legal window 100% of the time.
- **Sequence:** Phase B (pilot-critical).

### M6 — Day Close that never blocks and always resumes
- **Why:** OPERA logs everyone out to roll the date and halts on open items (R01 §3.1); Mews has no audit and fights
  late outlets with editable windows (R02 §5.4). UX1 persona 5: no Day Close at all.
- **What:** the `day-close` module (DCL-R01–R09) on top of M2's exception shape: continuous readiness queue, keyed
  idempotent steps, resume, integrity gate, statistics snapshot, guesthouse auto-close.
- **Modules:** day-close, reservations, finance, payments, operations, inventory, platform, analytics.
  **10x measure:** Day Close with no blocking items ≤ 2 min attention (UXP §19); interrupted run resumes with 0
  duplicate postings (S09); 0 logouts.
- **Sequence:** Phase B (pilot-critical).

### M7 — Connected mode everywhere (adoption as a ramp, not a cliff)
- **Why:** the adoption brief's three paths; integration is the top pain for 38% of hotels (DG #28 [S], sponsored);
  incumbents gate APIs (R02 §2.8 #1, R01 §6.4). Today forward mode is "refused honestly" in most modules and mirror
  mode is partial (README-reservations, README-finance, README-payments, README-operations § Adoption modes).
- **What:** each module mirrors (inbound handler bound to integration) and forwards (outbound with acknowledgement)
  in the domains the adoption brief offers standalone: reservations mirror, inbound stay contract → housekeeping loop
  (operations CR-6), charges forward, payments forward, room status two-way, profiles mirror; "**your yesterday in
  Portico**" trial with discrepancy list (vision moment).
- **Modules:** integration, platform (authority transitions), reservations, operations, finance, payments, guests,
  inventory, rates, comms, analytics. **10x measure:** a hotel on OPERA/Mews runs Portico housekeeping or messaging
  alongside, set up by staff in ≤ 30 min (UXP §19 "first read-only connection"), with 0 split-brain writes.
- **Sequence:** Phase B (simulator + CSV), Phase C (first real PMS connector).

### M8 — One-button migration ("Move to Portico")
- **Why:** owner decision D13; no vendor sells a productised any-source migration (DG #1; DD11 §1); Cloudbeds' import
  is paid and drops cancelled/no-show history (DG #22); FIDI duplicated revenue after a switch (DG #24).
- **What:** connect → discover → auto-map (OPERA concept map) → rehearse in a trial copy → delta sync → reconciliation
  gates → cutover with ≤ 15-minute freeze → history backfill → hypercare; only the 7 irreducible human steps remain
  (DD11 §6.2). Published migration correctness report per migration.
- **Modules:** integration (migration toolkit — brief `modules/migration.md`), platform, every data-owning module
  (import APIs keyed by source id), finance (opening balances), payments (card re-collect), distribution (channel
  switch). **10x measure (targets [I] from DD11 §7.2):** guesthouse from CSV/SMB PMS same day; 100-room resort from
  OPERA Cloud ≤ 5 days elapsed with ≤ 15-min freeze; reconciliation gates exact (DD11 §7.3); 0 duplicate
  reservations; 7 human steps.
- **Sequence:** Phase B (CSV/SMB, guesthouse), Phase C (OPERA paths, gated by Q140/Q141).

### M9 — Distribution you can see and recover, including agentic channels
- **Why:** overbooking after sync failure is the most damaging SMB review theme (R03 §1, §12); SiteMinder sets the
  mechanics bar (R03 §4.3); AI agents are now booking channels (DG #34; DD05 §3).
- **What:** `distribution` (DST-R01–R17): one inventory ledger, ≤ 60 s ARI target, provisional holds for unmapped
  bookings, field-loss diffs, health console with non-destructive replay (R03 §9.3), Channex hub (D7), booking
  engine + Google free booking links, **AI agent as a channel** with its own exposure, content checks and audit.
- **Modules:** distribution, inventory, rates, reservations, integration, payments (VCC), guest-experience.
  **10x measure:** median ARI delivery ≤ 60 s; 0 bookings lost or silently unapplied in the fault matrix; every
  channel outage visible within 2 min with impact list.
- **Sequence:** Phase B if the first pilot wants Portico to manage OTAs; otherwise Phase C.

### M10 — Island-grade resilience (offline-honest everywhere it matters)
- **Why:** island connectivity (brief §16, Q122); OPERA is "slow on weak internet" (R01 §2.3); kiosk research: failed
  self-service is worse than none (DD03 §4). UX1 phone experience is "a squeezed desktop".
- **What:** staff PWA offline-first with explicit conflicts (OPS-R21–R23 server side exists); a **continuity
  snapshot** (arrivals, in-house, balances, allergies, muster list) refreshed and printable/offline on designated
  devices (GSV-R15); desk degraded mode (recorded payments, manual key log ACC-R16, queued postings with honest
  labels); POS connectivity tiers (FNB-R20–R22).
- **Modules:** operations, apps/staff, backoffice, guest-services, access, fnb-pos, payments, reservations, platform.
  **10x measure:** a 4-hour internet outage loses 0 work and produces 0 silent conflicts; staff can answer "who is in
  which villa and what do they owe" offline within 30 s.
- **Sequence:** Phase B (housekeeping + continuity snapshot), Phase C (POS, desk degraded mode).

### M11 — The connected resort: one itinerary, one bill
- **Why:** OPERA 26.4 Leisure Management arrives "free" for OPERA resorts (DG #13); Agilysys' connected resort is the
  reference (R01 §6.2); Cinnamon Maldives buys OPERA + Simphony as a pair (DD09 §3).
- **What:** resort (transfers/manifests, activities with capacity/waivers, meal-plan consumption, itinerary with
  disruption cascade — S12), fnb-pos intake (Simphony first) and Portico POS, guest-services (allergies, amenities,
  cases), concessions settlements.
- **Modules:** resort, fnb-pos, guest-services, finance, rates, reservations, operations, comms, concessions.
  **10x measure:** a 3-hour seaplane delay re-plans check-in, dining and activity with owners in 1 action and
  notifies every affected department in ≤ 2 min; outlet charges land on the right folio with entitlements applied,
  exactly once, ≤ 20 s per post (UXP §19).
- **Sequence:** Phase C (resort pilot).

### M12 — An assistant that acts through the same commands (included, cited, evaluated)
- **Why:** the top of the market gives assistive AI away (Oracle, Lighthouse — DG #15, #33); Apaleo exposes ~260 MCP
  tools (DG #21); agents mostly unproven and unevaluated (DD05 §1 obs. 2; DG §5 #4).
- **What:** cited answers over permission-scoped retrieval; drafts and summaries; proposals that execute **only through
  M2's action registry** with preview and human approval; an MCP server mirroring public API scopes with **dry-run for
  every money tool**; a published evaluation suite (task success, unsafe-action rate, reversal rate); AI usage counted
  against the work it creates.
- **Modules:** ai, kernel/action registry, identity (agent principals, consent scopes), integration (MCP/API), comms,
  analytics. **10x measure:** 0 invented availability/payment/policy facts in the evaluation suite; 100% of answers
  cite records the user may see; unsafe-action rate 0 in red-team runs.
- **Sequence:** Phase C (after M2 and the core modules exist), with read-only answers earlier.

### M13 — Portfolio control and release safety
- **Why:** Shiji's configure-once strength (R01 §5.2); OPERA delivers features disabled behind controls, multiplying
  configuration (DD02a §1.1, §6); Infor update complaints (R01 §4.3). UX1 persona 7: no policy centre, no Add property.
- **What:** policy centre with inheritance and highlighted local overrides (S16), configuration bundles and rollout
  rings (built on identity-plus), a per-property **change calendar** with previews and a defer window, feature
  adoption as a metric, portfolio Today and Day Close board.
- **Modules:** platform, identity, rates, analytics, day-close, backoffice. **10x measure:** a portfolio policy change
  shows affected properties and overrides before commit (S16) in ≤ 3 interactions; 0 behaviour changes reach a
  property without a preview and a defer option.
- **Sequence:** Phase B (policy centre for groups), Phase D (change calendar).

### M14 — Numbers you can trust, and data you can take with you
- **Why:** reporting is the most repeated complaint against modern PMSs (R02 §8 item 4); Mews launched BI only in
  Apr 2026 (DD02b §1.2); OPERA sells folio/EOD archives separately (DG §2 finance row; DD02a §1.2); Mews Exports set the bulk-export bar
  (DG #17).
- **What:** analytics with a metric catalog, drill-down to records, as-of vs restated, data-quality checks, USALI 12
  mapping (DG #42); **bulk export and import APIs** (async JSONL, incremental windows, ledger export) and history
  archive included; migration correctness dashboard.
- **Modules:** analytics, integration, finance, accounting, day-close, every module's facts. **10x measure:** every
  figure has a definition and drills to records in ≤ 2 clicks; a full tenant export completes and re-imports with
  exact reconciliation.
- **Sequence:** Phase B (day facts + core reports), Phase C (exports, USALI).

---

### M15 — Open API and partner platform: an ecosystem, not a list (owner D14)
*Added by the orchestrator after the owner's direction.* Mews's 1,000+ integrations are mostly **built by partners** on
its open API. Portico earns the same effect with a partner platform that is easier than anyone else's:
- **A public, versioned API**: generated OpenAPI docs for every module (already contract-first); a changelog;
  deprecation policy and dates; published rate limits.
- **An event subscription catalogue** with signed webhooks, replay, and per-partner delivery health.
- **A developer portal**: self-serve partner sign-up, sandbox organizations with Maldives sample data, test keys, and a
  "first successful call in 15 minutes" target.
- **Apps a hotel installs with scoped consent** (identity IDN-R17 consent apps): least-privilege scopes, per-property
  install, revocable, audited, with data-authority aware writes.
- **A certification kit**: automated conformance tests a partner runs against the sandbox; certified partners get a
  marketplace badge.
- **A marketplace**: listings, categories (POS, locks, accounting, CRM, revenue management, guest messaging),
  install flow, reviews.
- **Generated SDKs** (TypeScript, Python) and an **MCP server** so AI agents can act through the same commands
  (shares M12).
- **A trust centre**: status page, uptime history, security overview, data-processing terms.

Targets (TARGETS): a partner's first successful sandbox call in 15 minutes or less; a partner app certified in 1 day or
less of the partner's effort; zero breaking changes without a published deprecation window.
Modules: integration, identity (OAuth apps and scopes), platform, every module's contracts. Readiness: R1 → R3
(sandbox), no external claims until partners are live.

### M16 — Speak the hotel industry's existing interfaces (legal check first)
Thousands of door-lock, phone (PBX), minibar, TV and POS devices in hotels already speak a legacy PMS interface
protocol. A compatibility layer would let them connect without one integration each. This needs counsel's review of
the protocol's ownership and licensing before any work (Q159). Until then: HTNG/OpenTravel-aligned APIs where
standards are open.

## 4. Sequencing

```
Phase A — "Make it real" (now; then M15 after Channex — owner D14)                 Phase B — Guesthouse pilot-ready          Phase C — Resort pilot-ready         Phase D — Scale
M1 compose ─┬─► M3 truth contract              M5 money (Route D, receipts, plans)        M8 OPERA migration (Q140/Q141)        M12 agents (MCP, proposals)
M2 record/  │                                  M6 Day Close                               M11 connected resort + POS            M13 change calendar
 command/   ├─► M4 copy, errors, workspaces    M8 CSV/SMB migration (same day)            M9 Channex live (Q23) + booking engine M14 USALI, warehouse
 search ────┘                                  M7 simulator + CSV connected mode          M7 first real PMS connector           back-of-house depth
                                               M10 staff PWA + continuity snapshot        M10 POS tiers, desk degraded mode
                                               M14 day facts + core reports               M12 cited answers, drafts
                                               M4 measured staff sessions (Q152)
```

Wave mapping (`docs/readiness/roadmap-critical-path.md` §2): Phase A = finish waves 0–1; Phase B = waves 2a (Day
Close), 2d (comms email), 2e (CSV import), 3d (staff PWA), plus 2b if the pilot wants OTAs; Phase C = 2b, 2c, 3a, 3c,
contracting, access, fnb-pos intake; Phase D = waves 3b, 4 and back-of-house depth.

Rules for agents: do not start a Phase-C module's UI before M1/M2 contracts are stable; build every external
effect simulator-first (roadmap principle 4); every increment updates its parity matrix and readiness row.

---

## 5. What must exist before a first pilot — and what can wait

Pilot profile default: a Maldivian guesthouse or small hotel (Q26). A resort pilot adds a second list.

### 5.1 Must exist before a guesthouse pilot (Gate 3 — `docs/readiness/launch-checklist.md`)

| # | Capability | Module(s) | Evidence required |
|---|---|---|---|
| P-1 | Create booking / walk-in / quote, change dates, cancel with fee from agreed terms — through the UI | reservations, rates, inventory, backoffice | UXP §19 walk-in ≤ 3 min; S01, S03, S14 through `apps/api` |
| P-2 | Check-in with ID/registration fields (nationality per occupant, JG-13) and payment step; check-out with folio and settlement | reservations, guests, finance, payments | S04, S05; UX1 persona 1 and 2 tasks completed unaided |
| P-3 | Payments recorded and verified: cash, own terminal (Route D), bank transfer, payment link where a gateway exists; receipts and tax invoices within the legal window | payments, finance | F-10 receipts built; statement matching; S05, S06, S20 |
| P-4 | Day Close (automatic for guesthouses with blocking items surfaced) | day-close, finance, reservations | S09 |
| P-5 | Housekeeping on a phone: my rooms, start/done, inspect with reason, DND; offline queue | operations, apps/staff | S07, S13; UXP ≤ 2 taps per condition update |
| P-6 | Search anyone who ever stayed by name/phone/email/code | guests, reservations, backoffice | UXP ≤ 5 s |
| P-7 | Same-day migration from the guesthouse's current tool or spreadsheet: future bookings, deposits (S18), profiles, with a reconciliation report | integration/migration, finance, guests, reservations | DD11 §7.3 gates exact |
| P-8 | Email confirmations and payment links delivered with honest delivery status | comms (email only) | sender register, no duplicates |
| P-9 | OTA path: either keep the current channel manager (connected mode, documented) or Portico distribution via Channex (Q23) | distribution or integration | S02, S20 |
| P-10 | Internet-outage continuity pack: offline arrivals/in-house/balances list, recorded payments, manual key log | operations, reservations, payments, access | Q122 default; outage drill |
| P-11 | Security: identity P0 closed (R2-P0-1), MFA for ⚑, operator support access with reasons, backups + restore drill | identity, platform, infra | REV-identity-plus-3 clean; restore evidence (Q4) |
| P-12 | Staff validation of the core tasks with ≥ 5 users per role (owner, desk, housekeeping) | backoffice, all | UXP §19 protocol recorded in `docs/readiness/` (Q152) |
| P-13 | Live fiscal documents only after the adviser confirms the Maldives pack (otherwise documents are labelled and the pilot uses its current invoicing) | rates, finance | Q20/Q41 |
| P-14 | Support promise and incident runbook for the pilot | operations of Monoclay | Q21 |

### 5.2 Additionally before a resort pilot

Outlet charges via POS intake (Simphony first) or the Portico outlet posting app; meal plans and allowances consumed at
outlets; transfers and manifests with disruption cascade (S12); groups/blocks with cut-off (S11) and tour-operator
contracts with allotments and stop-sales (Q121); keys: manual key log at minimum, lock vendor via SDK if Q80 allows;
guest-services allergies with acknowledgement; cashier sessions and multi-currency USD/MVR; receivables for DMCs;
migration from OPERA (export pack path at minimum; OHIP/OXI if Q140/Q141 approved); Day Close at resort volume
(400 units × 31 nights Timeline render ≤ 1 s — UXP §19 performance targets).

### 5.3 Can wait (after the first pilot)

AI agents and MCP write tools (read-only cited answers can come earlier); CRM campaigns and loyalty; accounting depth
(AP, bank reconciliation, statements — pilots keep their accounting system via journal export); procurement, stock,
workforce, utilities, concessions; guest kiosk; mobile keys; Monoclay SaaS billing (needed before the first **paid**
customer, not a free pilot — Q3); additional country packs.

---

## 6. Risks and how each move contains them

| Risk | Evidence | Effect if ignored | Mitigation (move, owner question) |
|---|---|---|---|
| **Patents — AI room assignment** (Oracle US 11,514,374) | DD04 P1; DG §4 | Auto-assign beyond rules could need a design-around | Rule-based, explainable, pluggable assignment; forward assignment for housekeeping lead time instead (inventory brief); Q145 |
| **Patents — billing-rule ranking** (Agilysys US 2017/0124610) | DD04 P4; CS §3.1 | Finance routing design | Specificity resolution pending counsel (README-finance § patent caution); Q40 |
| **Patents — guest-chosen housekeeping windows, ML upsell, key/kiosk printing, passport-face matching, parity enforcement** | DD04 P2, P5–P9, P13–P16, L1 | Guest-experience, operations, access, distribution features | Staff-entered service preferences only; rule-based inventory-aware upsell; lock-vendor certified SDKs; no biometrics; parity *monitoring* only; counsel package **Q150** |
| **Oracle access for migration** | OHIP approvals, 50 rps shared throttle, 1,000-record cap, Data API SKU (DG #2–#5); OXI licence and eligibility (DG #7; Q141); DB extract contractual risk (DG #9; Q144) | One-button migration from OPERA stalls at "waiting for approval" or disrupts live interfaces | Export-pack path first; OHIP extractor against public specs + simulator (R3); throttle ≤ 10–20 rps off-peak, 429 monitoring; Q140/Q141/Q144 |
| **OPERA 5.6 support horizon unverified** | DG #10 [3P] | Urgency of the resort pitch is uncertain | Do not market on the date; verify before any outreach |
| **Payments availability in the Maldives** | Stripe not available for Maldivian entities (D10, Q2); local gateway APIs unknown (dependency register §8.2); card fee ~2.5%, QR/Favara coming (DD09 §6); PCI vault for OTA VCC unresolved (README-payments Q5) | No integrated card acceptance at pilot; VCC handling manual | Route D recorded-then-verified as the pilot path; bank-transfer/QR as first-class external methods with statement matching; gateway adapters when a bank provides a sandbox (Q2, **Q154**); VCC charged on hotel terminal and recorded |
| **MIRA e-invoicing / MIRAconnect during the pilot** | DD09 §7 [3P] (verify) | Compliance change mid-pilot | Fiscal adapter seam in finance; receipts now; adviser (Q20) |
| **Identity P0 cross-organization takeover** | REV-identity-plus-2 R2-P0-1 | Every first onboarding exposed | ADR-0017 amendment (email-verified identities) + third review before merge |
| **Measurement integrity** | §1.4 | "10x" claims built on stale numbers | Parity reconciliation first in every brief; forced typecheck in CI; scorecard filled each round |
| **No pilot, no staff validation** | D8; UX1 is a single tester | Ease gate unprovable; owner-facing claims impossible | Q26 discovery; Q152 sessions; keep every target labelled TARGET |
| **Free AI at the top of the market** | DG #15, #33 | AI cannot be an upsell | Treat AI as included retention value; meter only expensive generation (**Q153**) |
| **Maldives 2026 downturn** | DG #44; DD09 §4 | Pilot appetite and budgets shrink | Lead with cost reduction: card-fee savings via QR, labour via automation, no-cost migration (Q143) |
| **Competitor velocity** | OPERA ~5 releases/yr (DG #11); Mews weekly API (DG #18) | Parity rows age fast | Quarterly parity refresh (`docs/parity/README.md` check 4) |
| **Staff languages** | Dhivehi staff, expatriate attendants (backoffice README Q1; PAR-OPS-043 draft) | "Friendly" fails for non-English staff | i18n-ready strings now; commissioned translation (**Q155**) |
| **Sponsored statistics** | DG §4 last row | Misleading positioning | Cite with sponsor labels; prefer our own measurements |

---

## 7. Cross-module contract changes the moves require (for the orchestrator)

1. **Kernel status families + action registry** (M2/M3): `allowedActions[]` gain `commandId`, `hotkey?`,
   `previewRequired`, `risk` (`none|money|inventory|guest|authority`); every module exposes its commands in the
   manifest so the palette, AI and API share them.
2. **Common exception shape** (M2/M6): `listExceptions(tx, propertyId, businessDate?)` on every module that owns
   blockers (reservations, finance, payments, operations, inventory, integration, access, distribution, fnb-pos).
3. **Event versioning** (M1/M7): `aggregateVersion` on every state-changing event; consumers use `isNewerThan` (PF).
4. **Import APIs keyed by source identity** (M8): each data-owning module exposes `import<Entity>(tx, {source,
   sourceId, …})` idempotent on `(connection, source_id)` and accepts terms snapshots verbatim.
5. **Mirror and forward handlers** (M7): each authority domain's owner binds an inbound handler and an outbound
   forward contract in integration (README-integration § Known gaps: "No owning module binds an inbound handler yet").
6. **Fiscal document kinds** (M5): `receipt`, `deposit_receipt`, plus a `FiscalAdapter` port for e-invoicing.
7. **Requirement-ID prefix collision:** `docs/specs/access.md` and `docs/specs/accounting.md` both use `ACC-Rnn`
   (`docs/specs/README.md` lists neither). Rename one before parity files cite both (suggest access → `KEY`; the
   accounting parity file already uses `PAR-ACC-*`).
8. **Status vocabulary convergence** in the glossary: payer types, commission vocabulary (README-guests § Known gaps),
   work-order states (README-operations § Known gaps).

---

## 8. Process: how module agents use their brief

1. Start with the brief's **Increment 1**, which for every built module begins by reconciling its parity file with
   the README so the baseline is real.
2. Report results against the brief's target table: better / comparable / behind, with evidence.
3. Never mark a target "met" without the evidence named in its row; staff-validated targets stay open until Q152
   sessions happen.
4. The **power check** section in each brief lists what must never be lost or hidden; the steward reviews against it.
5. The strategist refreshes briefs after each module round, and after each UX round.

---

## 9. Owner questions raised by this plan

Added to `docs/OPEN_QUESTIONS.md` (Q150–Q155; defaults in force):
- **Q150** — counsel package for the remaining patent watch list (extends Q40, Q145).
- **Q151** — publishing comparative "better than <competitor>" claims.
- **Q152** — moderated usability sessions with Maldivian hotel staff (recruiting and incentives).
- **Q153** — assistive AI included in every edition.
- **Q154** — approaching Maldivian banks about Favara / national QR and gateway sandboxes (extends Q2).
- **Q155** — staff-language translations (Dhivehi and expatriate staff languages).

---

## 10. Module briefs and their headline 10x targets (TARGETS)

| Module | State | Headline 10x target | Brief |
|---|---|---|---|
| reservations | built R3 | Walk-in ≤ 3 min; check-out with split folios ≤ 90 s; a grounded seaplane re-plans all affected arrivals in 1 previewed action | [reservations](modules/reservations.md) |
| inventory | built R3 | Every availability number explained in 1 click; 0 oversells without a conflict record across desk, web and channels; tomorrow's assignments suggested with reasons | [inventory](modules/inventory.md) |
| rates | built R3 | Explainable pricing assistant in every edition; season change across N plans in ≤ 5 interactions; 0 tax differences vs adviser-confirmed examples | [rates](modules/rates.md) |
| guests | built R3 | Find anyone in ≤ 5 s by name/phone/email/code; ≥ 95% duplicates caught before creation; 0 fields re-typed for known guests | [guests](modules/guests.md) |
| finance | built R3 | Fiscal documents within the legal window 100%; 0 unexplained ledger differences; 40-invoice bank transfer allocated in ≤ 2 min | [finance](modules/finance.md) |
| payments | built R3 | 0 duplicate charges under the full fault matrix; ≥ 98% of payments verified within 1 business day, incl. Maldivian bank transfers and QR | [payments](modules/payments.md) |
| operations | built R3 | Condition update ≤ 2 taps; tomorrow's plan for 40 units ≤ 5 min; standalone loop next to OPERA/Mews end to end | [operations](modules/operations.md) |
| integration | built R3 | First read-only connection by hotel staff ≤ 30 min; all 10 data-authority domains mirror + forward; partners self-serve in ≤ 15 min | [integration](modules/integration.md) |
| platform | built R3 (+ branch) | Portfolio policy change previewed with overrides in ≤ 3 interactions; guesthouse sign-up to first booking ≤ 30 min | [platform](modules/platform.md) |
| identity | wave 0 (+ branch, P0 open) | 0 open P0/P1; PIN user switch ≤ 3 s on shared desks; invite to one property ≤ 45 s | [identity](modules/identity.md) |
| backoffice / staff PWA | branch | New user completes 100% of core tasks unaided (today 5 of 34); new desk agent productive in one shift | [backoffice](modules/backoffice.md) |
| migration | planned | Guesthouse same day; OPERA Cloud resort ≤ 5 days with ≤ 15-min freeze; 7 human steps; 0 duplicate reservations | [migration](modules/migration.md) |
| day-close | planned | ≤ 2 min auditor attention; 0 logouts; 0 duplicate postings after any interruption | [day-close](modules/day-close.md) |
| distribution | planned | Median ARI ≤ 60 s; 0 lost or silently unapplied bookings; outages visible ≤ 2 min with impact | [distribution](modules/distribution.md) |
| groups | planned | 30-room × 5-night block with rates ≤ 5 min; post-deadline cuts previewed with contract consequences | [groups](modules/groups.md) |
| comms | planned | 0 duplicate or contradictory replies; automations re-evaluate on every booking change | [comms](modules/comms.md) |
| analytics | planned | 0 figures without definition and drill-down; 0 unexplained differences to the ledger | [analytics](modules/analytics.md) |
| access | planned | 0 credentials valid after checkout without an exception; keys never "issued" before confirmation | [access](modules/access.md) |
| contracting | planned | ≥ 95% of voucher bookings priced and checked automatically against the contract | [contracting](modules/contracting.md) |
| guest-services | planned | 0 unacknowledged allergies at service time; offline in-house list in ≤ 30 s | [guest-services](modules/guest-services.md) |
| guest-experience | planned | Online check-in ≤ 4 min; 0 desk re-typing; every self-service failure handed to staff with context | [guest-experience](modules/guest-experience.md) |
| resort | planned | One action re-plans transfer, check-in, dining and activity; outlet post with entitlement ≤ 20 s | [resort](modules/resort.md) |
| ai | planned | 100% cited answers; 0 invented facts and 0 unsafe actions in a published evaluation suite | [ai](modules/ai.md) |
| crm | planned | 0 messages without consent; negative survey → owned case ≤ 5 min | [crm](modules/crm.md) |
| billing | planned | 0 paths from guest money to Monoclay; 0 usage costs without a prior estimate and cap | [billing](modules/billing.md) |
| fnb-pos | planned | Every outlet charge lands once with the right entitlement and tax; outlet close balanced | [fnb-pos](modules/fnb-pos.md) |
| accounting | planned | Month close inside Portico ≤ 3 working days; 0 re-keying between PMS and books | [accounting](modules/accounting.md) |
| procurement | planned | ≥ 85% invoices auto-matched; island shipment delays propagate before receiving | [procurement](modules/procurement.md) |
| stock | planned | Days of cover for every critical island supply; stock value = ledger at month end | [stock](modules/stock.md) |
| workforce | planned | Rosters from forecast ≤ 15 min; service-charge runs reproducible to the cent | [workforce](modules/workforce.md) |
| concessions | planned | Partner settlements tie to folio postings, approved in ≤ 10 min | [concessions](modules/concessions.md) |
| utilities | planned | Diesel/water per guest-night daily after each Day Close; anomalies always owned | [utilities](modules/utilities.md) |
