# 05 — Digest: market deep dive → Portico decisions

Status: v1 · 2026-11-07 · Source: `docs/research/05-market-deep-dive/` (files 00–11; keys resolve in
`10-bibliography.md`). This digest is the **non-duplicated** feed into the process: it lists what is *new* compared
with `docs/research/01–04` (R01–R04) and `docs/product/competitive-synthesis.md` (CS), or marks where it
*confirms/updates* them. Section 3 is the owner's **one-button migration** priority (it replaces the planned
go-to-market section). Evidence labels: [V] primary document read; [S] search summary; [VC] vendor claim;
[3P] third-party/sponsored; [I] inference.

---

## 1. The 45 most decision-relevant findings

| # | Finding (one line) | Evidence | New / updates |
|---|---|---|---|
| 1 | No vendor sells a productised any-source PMS migration; Oracle's own OPERA→Cloud path (OCM) is an Oracle-run **database copy** after contract; others use CSV loaders, paid import services, custom projects or RPA. | 11 §1, §4 [V][S] | **New** |
| 2 | OHIP property APIs v26.3 = **45 modules / 3,580 operations**; synchronous reservation search caps at **1,000 records**; bulk work must use async jobs (94-day windows, 30-min spacing, 2 MB truncation, results kept 6 h). | 02a §1.4 [V] | **New** (R01 had only pricing) |
| 3 | OHIP throttles at **50 rps per gateway shared by all the hotel's integrations** (burst 100); streaming allows one consumer per chain/gateway/app key and needs reconnect ≤24 h. | 02a §1.4 [V] | **New** |
| 4 | OPERA Cloud partner access requires the **hotel's chain admin to approve** each connection, with module-level scopes and separate **Sensitive Data Access**; hotels on OCIM can create their own client apps; Foundation includes OHIP. | 02a §1.4 [V] | **Updates** dependency register §6.8 ("access route conflicting") |
| 5 | Bulk **Data APIs** (R&A subject areas) require the hotel to buy an **R&A Data Access SKU** (or partner per-call). | 02a §1.4 [V] | **New** |
| 6 | Full extraction of a 100-room OPERA Cloud resort ≈ **100k calls ≈ US$100** at the reported partner rate; approvals and async spacing, not cost, are the bottleneck. | 11 §3.2 [I] | **New** (estimate) |
| 7 | OPERA 5 supports **OXI "initial cutover resync"** to an external system in a documented order (products → rate codes → restrictions → inventory → profiles → blocks → reservations, incl. cancels/no-shows/checked-in), then business events; licence per interface and property. | 11 §3.1 [V] | **New** |
| 8 | OPERA 5 **File Exports** (`OPP_EXP`) run templated or custom-SQL exports from standard views, schedulable at End of Day; **PII is masked unless delivered by SFTP/HTTPS**. | 11 §3.1 [V] | **Updates** migration checklist `[unconfirmed]` |
| 9 | Direct reads of the OPERA 5 Oracle DB carry contractual risk (ASFU-type licences restrict third-party tools per advisers). | 11 §3.1 [3P] | **New** |
| 10 | OPERA 5.6 Premier Support reportedly ends **Dec 2027** — a 2026–27 migration window (unverified). | 01 §5, 09 §3 [3P] | **New** |
| 11 | Oracle ships **~5 OPERA Cloud releases/year** with 70–170 listed changes each (~1,270 items in 12 releases since 24.2); many delivered **disabled behind OPERA Controls**. | 02a §1.1 [V] | **New** |
| 12 | Every OPERA release contains country/fiscal items (SAF-T, e-invoice, police exports, statistics) — compliance is a continuous treadmill. | 02a §1.1 [V] | **Confirms** R01 #9 with release data |
| 13 | OPERA 26.4 added **Leisure Management** (spa, kids, rentals, tours, cabanas), **Service Order Management** and **Digital Registration** (nationality-based e-forms, e-sign, purge rules). | 02a §1.2 [V] | **New** — raises the bar for resort/ops/guest-experience |
| 14 | OPERA added **tiered cancel/deposit schedules** (25.4) and **FPLOS from hurdle rates** to channels (25.4). | 02a §1.2 [V] | **New** |
| 15 | Oracle's AI is assistive, embedded, previewed and **free** (OPERA Cloud Assistant, Jun 2026; AI Room Search adds features from notes **with a reason**). | 05 §1 [V][S] | **New** |
| 16 | Oracle holds **US 11,514,374** (AI room assignment via weighted cost matrix + Hungarian heuristic) and **US 12,014,310** (AI hotel demand model). | 04 P1–P2 [S] | **New** (risk) |
| 17 | Mews **Exports API**: async JSONL for reservations, customers, companies, bills, order items, payments, availability/resource blocks and **ledger entries**; incremental ≤180 days. | 02b §1.3 [V] | **New** |
| 18 | Mews ships API changes ~weekly; 2026 focus: payouts/balance transactions, policies as data, bill reissue, sell-limit state; it removed two parameters that "were never implemented … and had no effect". | 02b §1.3 [V] | **New** |
| 19 | **Mews OS** (May 2026) bundles PMS, RMS, channel manager (**SiteMinder engine embedded**), messaging, automations, AR; ROI claim from an IDC study of **n=8**. | 02b §1.2 [S][VC] | **New** |
| 20 | Mews scale: 12,500 properties / 620k rooms (Aug 2025); 13 acquisitions incl. Flexkeeping and DataChat; HTA Best PMS 3 years; IDC Leader 2025. | 02b §1 [S] | **Updates** R02 |
| 21 | Apaleo **MCP server exposes ~260 tools** (OAuth, open beta, self-serve) plus an official **Claude plugin** bundling SOPs; 3,500 req/min API. | 02b §2 [V] | **Updates** R02 #15 |
| 22 | Cloudbeds **Reservation Import is paid**, excludes **cancelled/no-show** bookings and always needs manual fixes; access ends at account deactivation. | 02b §3 [S] | **Updates** R03 §3.5 |
| 23 | Little Hotelier exports ≤365 days per file; third-party: guest details **masked 180 days after check-out**. | 02b §4 [S][3P] | **New** |
| 24 | Case FIDI: CRS–PMS mismatch after a switch **duplicated reservations and doubled revenue on the books**; reverted in 2 months. | 07 §5 [S][3P] | **New** |
| 25 | Stripe moves card data only **PSP-to-PSP with PCI DSS Level 1** counterparts (SFTP+PGP, merchant approval); wallet/Link cards not portable. | 11 §6.3 [S] | **Updates** dependency register (portability `[unconfirmed]`) |
| 26 | HTR 2026: **48%** would switch PMS over reliability, **42%** over cybersecurity; barriers: **training 26%**, **migration 24%** (sponsored, sample inconsistent). | 08 §2.1 [3P] | **New** |
| 27 | Cloudbeds×NYU: 52% of managers say front-desk confidence takes **4 months–3 years**; **38%** say PMS usability influenced leaving a job. | 03 §2.2 [S][VC] | **New** |
| 28 | NYU 2026 outlook (Stayntouch/IDeaS-sponsored): **38%** cite integration as top pain; 51% plan stack change in 12–24 months. | 01 §7 [S] | **New** |
| 29 | Abode index: hotel tech raised **>$1bn** (Apr 2025–Mar 2026); **PMS led with $408.1m** across 7 companies; AI guest-experience $152.6m. | 01 §3 [S] | **New** |
| 30 | Consolidation: Sabre Hospitality→TPG **$1.1bn** (2025); RateGain→Sojern **$250m**; Access (Guestline+SHR); Lighthouse **$370m**; Canary **$80m @ ~$600m**. | 01 §3 [S] | **New** |
| 31 | Agilysys FY26 **$319.3m (+15.9%)**, subscription +30%; **>1,000 Marriott hotels live**; PMS recurring to pass POS recurring in FY27. | 01 §4.1 [S] | **Updates** R01 §6 |
| 32 | SiteMinder FY26 transaction revenue **A$110.9m (+33.8%)**, transaction gross margin **39.4%** (from 32%). | 01 §4.2 [S] | **Updates** R03 #2 |
| 33 | Lighthouse ships a **Revenue Agent at no extra cost**, a ChatGPT direct-booking app and bought Hotelrank.ai (AI visibility). | 02c §1 [S] | **New** |
| 34 | Agentic distribution is live: ChatGPT apps (Booking.com, Expedia, Oct 2025) and **Google AI Mode hotel booking** with OTAs and chains; hotel/OTA remains merchant. | 05 §3 [S] | **New** |
| 35 | Minor Hotels (106 properties) took **~3 years** on OPERA Cloud; Motel One 100+ in ~6 months with Oracle Managed Services; Shiji claims 100+ hotels in 2 months. | 07 §1 [S] | **New** |
| 36 | Kiosk evidence (163 hotels): benefits arrive **with lag**; **failed self-service lowers return intent**. | 03 §4 [S] | **New** |
| 37 | Overbooking theory: optimal levels depend on walk cost, unsold cost and the cancellation distribution; DP models show up to **9%** gains; confirmation calls change no-show risk. | 03 §5.1 [S] | **New** |
| 38 | Cancellation models on PMS data were deployed in production with A/B tests; a public **119,390-booking** resort/city dataset exists for benchmarking. | 03 §5.2 [S] | **New** |
| 39 | Parity clauses: Hunold et al. — direct channel more often price leader after bans; Mantovani et al. — price drops short-run only; **CJEU C-264/23** and DMA constrain Booking.com. | 03 §6 [S] | **New** (R04 had no academic/legal update) |
| 40 | Billboard effect is **contested** (Cornell: 3–9 extra brand bookings per Expedia booking vs clickstream counter-studies). | 03 §6.1 [S] | **New** |
| 41 | Workforce: AI job insecurity raises turnover intention; **role ambiguity** amplifies technostress; housekeeping is the top US shortage (58%). | 03 §3 [S] | **New** |
| 42 | **USALI 12th** effective 1 Jan 2026 (sustainability lines, fee reporting, all-inclusive guidance). | 03 §9 [S] | **New** (relevant to Q105) |
| 43 | Maldives 2025: **2,246,516 arrivals (+9.8%)**; 183–186 resorts (~45k beds) and ~900 guesthouses (~15.5k beds); guesthouse occupancy 43% vs resorts 70% (Jan–Jul 2025). | 09 §1–2 [S] | **New** |
| 44 | Maldives 2026 shock: World Bank sees growth **−0.7%** (Middle East conflict, fuel); debt ~130% of GDP; Mar 2026 occupancy 57%. | 09 §4 [S] | **New** |
| 45 | Maldives rails and tax admin: **Favara** instant payments + national **QR in 2026** (cards ~2.5% fee); **MIRA e-invoicing** coming; 3-day invoice rule and MIRAconnect mandatory 2027 (aggregator, verify). | 09 §6–7 [S][3P] | **New** |

---

## 2. Implications per Portico module (what to add, change or do better)

Each line names the market bar (evidence) and the 3–10× move [I]. IDs refer to existing specs where known.

| Module | Market bar now | 3–10× move for Portico |
|---|---|---|
| **platform** | OPERA delivers features disabled behind controls; Mews weekly API changes with deprecations | Per-property **change calendar** with previews and a defer window; release rings; feature adoption as a metric; publish API deprecation policy and a versioned changelog from day one |
| **identity** | OHIP module-level access + Sensitive Data Access approvals; customer-owned client apps | Partner/agent **consent screens with module and sensitive-data scopes**, re-approval on scope change, per-integration clients; human principal behind every agent action |
| **inventory** | Oracle patent on AI assignment (P1); Mews sell-limit state; OPERA scheduled room moves | Keep auto-assign rule-based and pluggable (INV-R23) pending counsel; **explain every availability number** (INV-R28) incl. sell limits; forward assignment for housekeeping lead time instead of AI optimisation |
| **rates** | Tiered cancel/deposit (OPERA 25.4), FPLOS from hurdles, age-band package pricing (26.4); free AI pricing agents (Lighthouse) | Tiered dated policies with "which rule wins" explanation; accept RMS FPLOS; **explainable pricing assistant in every edition** (RAT-R31); overbooking per night with explicit walk cost and cancellation distribution |
| **reservations** | 1,000-record API caps; duplicate-reservation disasters after switches | External-ID uniqueness and duplicate detection on every import/channel feed; **import every status** (cancelled/no-show) for history; agreed-terms snapshots for migrated bookings |
| **guests** | OPERA profile matching, stay-record import; dirty profiles migrate intact | Duplicate scoring + merge/unmerge before import; "archive, don't import" for stale profiles; sensitive data encrypted and scoped |
| **finance** | OPERA archive and folio history sold separately (OCAS); Mews bill reissue with credit note | Folio/invoice history and archive **included**; correction by reissue with linked credit note; opening-balance import with reconciliation report; keep non-overlapping billing rules (Q40) |
| **payments** | Pay-by-link status polling, VCC auto-transfer, token proxies (OPERA); payout/balance-transaction APIs (Mews) | One executor per collection (PAY-R20), payout- and fee-level reconciliation (PAY-R25), **PSP-to-PSP card migration workflow** with token map and "re-collect" fallback; support Favara/QR and bank-transfer confirmations |
| **operations** | OPERA Service Order Management (skills, follow-ups, board, photos); Mews + Flexkeeping; patents on guest-chosen cleaning windows | Skills/specialties, auto follow-ups, board view, photo proof, offline mobile; review guest-selected service windows with counsel (P5) |
| **integration** | OHIP async/streaming + Data APIs; Mews Exports; Apaleo MCP | **Bulk export and import APIs** (async, JSONL, incremental windows, ledger export); webhooks with replay; publish limits; make Portico the easiest system to *leave* and to *join* |
| **distribution** | FPLOS to channels; SiteMinder inside Mews OS; AI agents as channels (ChatGPT, Google AI Mode) | Treat **AI agents as a channel** with rate/availability exposure, content quality checks and audit; parity *monitoring* (where undercut, cost per channel), never parity enforcement |
| **groups** | Block status by type; rooming list async API (OHIP 24.1+) | Block status mapped by type with reasons; async rooming-list import; block-grid reconciliation in migration |
| **comms** | Guest messaging bundled (Mews OS); confirmation calls reduce no-show uncertainty (research) | Confirmation/reconfirmation workflows tied to RM no-show forecasts; sender register to avoid duplicates during coexistence |
| **resort** | OPERA Leisure Management (26.4); Agilysys + Book4Time; Cinnamon Maldives on OPERA + Simphony | Itinerary across transfers, activities, dining and stay **with capacity, waivers and disruption cascades** (RST-R06/R10) — beyond OPERA's scheduling; Simphony integration day one |
| **day-close** | OPERA EOD archive downloads; automatic EOD scheduler tasks | Non-blocking Day Close (CS D5) + first post-migration Day Close as **opening-balance reconciliation** step |
| **analytics** | Mews BI (Apr 2026); Cloudbeds Ask Signals pilot; USALI 12 | USALI 12 mappings incl. sustainability lines; as-of vs restated reports; natural-language questions only over governed metrics with definitions; **migration correctness dashboard** |
| **access** | Dense patents on mobile→kiosk key printing, QR cards, passport-face matching; Hilton litigation | Use lock vendors' certified SDKs; no home-grown key-issuance protocols; counsel review before biometric check-in |
| **guest-experience** | OPERA Digital Registration (nationality templates, e-sign, purge); kiosk research (failure hurts return intent) | Digital registration as core (Maldives Q43); graceful failure to staff with context; measured self-service failure rate |
| **crm** | CRM consolidating in PE suites (Revinate, Cendyn); dailypoint around OPERA migrations | Consented unified profile with partner read APIs; profile clean-up as part of migration |
| **contracting** | OPERA negotiated rates and tiered policies | Import negotiated rates/allotments with agreed-terms snapshots and expiry alerts |
| **accounting** | USALI 12; OPERA trial balance at EOD; Mews ledger entries export | Ledger export API; USALI 12 chart mapping; migration imports opening balances as journal entries with source references |
| **fnb-pos** | PMS+POS bought as pairs (Cinnamon, Agilysys, Shiji); Mews POS award | Folio-level indistinguishable POS integration (posting, balancing, entitlements); Simphony first for Maldives resorts |
| **procurement / stock** | Resort diesel 33.2 L per bed-night; fuel shock 2026 | Fuel/utility consumption per occupied room and per guest-night; procurement alerts on fuel price changes |
| **workforce** | Technostress amplified by role ambiguity; 38% leave partly over PMS usability | Clear task ownership on every record; time-to-competency tracking per role; training built into workflows |
| **ai** | Free assistive AI (Oracle, Lighthouse); Apaleo MCP ~260 tools; agents mostly unproven | **MCP server mirroring public API scopes with dry-run for money tools**; AI included in every edition; publish an **agent evaluation suite**; count the work AI creates |
| **billing (SaaS)** | Competitors charge for imports (Cloudbeds) and archives (Oracle OCAS); AI bundled free | Migration and history archive included; usage costs (e.g. OHIP calls) shown before incurred and capped (Q45) |
| **UI / experience** | Training gap (4 months–3 years); failed self-service hurts; AI previews | "Productive in one shift" measured with a published protocol; previews for AI changes; provenance labels for migrated data (`copied`, `external`) |

---

## 3. ONE-BUTTON MIGRATION (owner priority; replaces the go-to-market section)

Full analysis: `05-market-deep-dive/11-one-button-migration.md`.

### 3.1 What "one button" means — honestly
One action by the hotel (**Move to Portico**) starts a Portico-run pipeline: **connect → discover → auto-map →
rehearse in a trial copy → continuous delta sync → reconciliation gates → cutover with ≤15-minute freeze → history
backfill → hypercare**. Nothing is marked migrated until reconciled. Only these **seven** steps remain for people:

1. Sign the data authorisation/DPA (legal entity).
2. Grant source access (approve OHIP connection + Sensitive Data Access; or activate OXI 2-way; or run the export pack /
   allow local connector; or issue Mews/Apaleo/Cloudbeds credentials).
3. Request PSP-to-PSP card-data transfer (or accept "re-collect" for guarantees).
4. Confirm opening balances and resolve the prepared list of ambiguous financial items.
5. Authorise channel/OTA/interface switches (channel manager, POS, keys, CRS).
6. Pick the cutover window.
7. Staff acceptance of key workflows on migrated data.

### 3.2 Source paths (best available, by automation level)
| Source | Path | Deltas | Target elapsed [I] |
|---|---|---|---|
| OPERA Cloud | OHIP async + detail + (Data APIs if SKU) | Streaming business events + async last-modified | ≤5 days, ≤15-min freeze |
| OPERA 5 / V5 (incl. 5.6) | OXI 2-way **initial cutover resync** + File Export pack for finance history; DB extract only with written rights | OXI business events | ≤10 days (excl. licence lead time) |
| Mews | Exports API (JSONL incl. ledger) + Connector API | Exports `UpdatedUtc` + webhooks | ≤5 days |
| Apaleo | REST/OAuth | Webhooks | ≤3 days |
| Cloudbeds, Little Hotelier, eZee, Hotelogix, Infor, protel, RoomRaccoon, Stayntouch | API where available; guided CSV/report packs; local connector | Re-export near cutover | Same day (guesthouse, future business first) – 2 weeks |
| Spreadsheets | Templates | Re-upload | Same day |

### 3.3 What must be built (in order)
1. **OPERA concept map + mapping engine** (profile types, statuses, reservation types, block status types, rate codes,
   packages, windows/routing → folios/billing rules, transaction codes/generates → charge codes/tax rules, AR, deposits;
   tables in 11 §8) with confidence, reasons and finance review.
2. **OPERA Cloud connector** (OHIP partner access Q61; sandbox measurement replaces the ~$100/100-room estimate).
3. **OPERA 5 OXI external-system connector** (confirm partner/certification requirements) + signed File Export pack.
4. **Reconciliation engine and gates** (exact match on counts by status, room nights and revenue on the books per
   stay date, deposits, AR open items/aging, in-house balances, block grids).
5. **Delta sync + cutover orchestrator** (authority transition, channel switch via Channex, freeze ≤15 min, rollback
   with cutover journal).
6. **Card migration workflow** (PSP-to-PSP request, token map, per-reservation guarantee report, re-collect fallback).
7. Mews and Apaleo connectors; CSV packs for Maldives guesthouse systems.
8. **Published migration correctness report** for every migration (market first).

### 3.4 Design guards from evidence
- Duplicates/doubled revenue (FIDI) → external-ID uniqueness + revenue-on-books gate before any channel/CRS switch.
- Missing cancelled/no-show history (Cloudbeds) → import all statuses.
- Masked exports (OPERA, Little Hotelier) → secure delivery + masked-value detection.
- OHIP truncation/caps and shared throttles → size-aware paging, completeness counts, ≤10–20 rps off-peak.
- Big-bang downtime (Oracle's own warning) → continuous delta sync, short freeze.
- Champion leaves → autopilot + checklist owners and escalation.

### 3.5 Proposed owner questions (for the orchestrator to add to OPEN_QUESTIONS)
- **Q-M1 OHIP partner enrolment and budget** (extends Q61): enrol as OHIP partner now to measure extraction in the
  partner sandbox; default: enrol, budget ≤ $500 for sandbox/pilot calls.
- **Q-M2 OXI external-system eligibility**: can Portico act as an OXI 2-way external system without Oracle
  partnership/certification? Default: ask Oracle; meanwhile build the File Export pack path.
- **Q-M3 Card migration stance for the pilot**: default "re-collect via collection plans" (no PSP-to-PSP transfer)
  until a PSP is chosen (Q2).
- **Q-M4 "Migration included" commercial promise** (extends Q60): default included for pilot properties, with usage
  costs (e.g. OHIP calls) shown and capped.
- **Q-M5 Database-extract policy**: default — never query an OPERA 5 database without the hotel's written
  confirmation of rights from its Oracle/ISV contract.

---

## 4. Risks and patents to watch

| Risk | Why it matters | Action [I] |
|---|---|---|
| **US 11,514,374 (Oracle, AI room assignment)** | Overlaps any optimisation-based auto-assign | Add to counsel review with Q40; keep assignment rule-based/pluggable |
| **US 2017/0124610 (Agilysys, rules-based folio routing)** | Billing rules | Q40 (existing) |
| **US 12,586,008 / 12,265,929 (guest-chosen housekeeping windows, departures)** | Guest-experience/ops features | Counsel review before launch |
| **US 12,014,310 (Oracle demand model); upsell ML patents (Nor1 PRiME, US 10,387,795)** | Offer ranking, ML upsell pricing | Start rule-based, inventory-aware upsell |
| **Key/kiosk/identity patents (US 10,735,201; 12,113,911; 11,257,315; 9,342,939; 12,056,779) + Hilton litigation** | Access and kiosk | Use lock-vendor SDKs; counsel before biometrics |
| **US 8,458,010 (price-parity enforcement)** | Distribution | Monitor, never enforce |
| **Oracle contract terms (OXI/exports/ASFU)** | Migration legality | Q-M2, Q-M5 |
| **OHIP throttling shared with live integrations** | A migration could disrupt a hotel's operations | Throttle, schedule off-peak, monitor 429s |
| **Free AI at the top of the market** | AI cannot be priced as an add-on | Treat AI as retention/switching argument |
| **Maldives 2026 downturn** | Pilot appetite and budgets | Cost-reduction pitch; low-risk migration |
| **MIRA e-invoicing during pilot** | Compliance change mid-pilot | Adapter-ready country pack; verify dates |
| **Sponsored statistics** | Misleading claims | Cite only with sponsor labels; prefer own measurements |

---

## 5. Open debates (unresolved in the evidence)

1. **Best-of-breed vs all-in-one/OS** — NYU (sponsored by best-of-breed vendors) vs Mews/Cloudbeds/Shiji OS claims;
   both agree integration is the pain (38%).
2. **Billboard effect** — alive (Cornell, OTA/chain data) or dead (clickstream attribution)?
3. **Do parity bans lower prices durably?** — short-run yes, medium-run limited (Mantovani); direct channel leads more
   often (Hunold).
4. **Are hotel AI agents real?** — Apaleo shows tooling and named deployments; others announce; no independent
   evaluations; ROI claims rest on n=8 or unsourced figures.
5. **Can AI be monetised** after Oracle and Lighthouse made it free?
6. **Market size** — $1.2bn–$3.8bn (2025); cloud share 65%–>80%.
7. **Physical vs logical migration** — Oracle's DB copy keeps everything but risks downtime; logical migration keeps
   operations running but needs mapping and reconciliation — which do enterprise buyers trust more?
8. **OPERA 5 end-of-support date** — Dec 2027 for 5.6 is unverified; the urgency of the migration window depends on it.
9. **Maldives guesthouse systems** — no survey of what PMS/channel tools guesthouses use (Q64 discovery remains the
   only route).
