# 11 — One-button migration from OPERA (legacy and Cloud) and other PMSs

**Owner requirement (2026-11-07):** "one button and it should be done" — a one-button migration from any legacy or
modern OPERA platform, and from other PMSs.

**Honest definition used in this report [I].** *One button* means: **one action by the hotel starts a migration
that Portico runs end to end** — discovery, mapping, rehearsal, reconciliation, continuous delta sync, cutover and
history backfill — and **only the steps that are legally or technically impossible to automate remain**, presented
as a short guided checklist with owners and due times. Nothing is shown as "migrated" until reconciled
(CLAUDE.md §5; brief truthfulness).

This file builds on (does not repeat) `docs/adoption/migration-acceptance-criteria.md` (phases M0–M10, per-source
notes, acceptance tests) and `docs/readiness/migration-onboarding-checklist.md`. It replaces many `[unconfirmed]`
cells there with primary evidence. Labels per [00-index](00-index.md).

---

## 1. Executive summary

1. **No vendor offers a productised any-source migration today.** Oracle's own OPERA→OPERA Cloud path (**OCM**) is a
   *physical Oracle database copy* run by Oracle's migration team after contract signature [V]; everyone else uses
   CSV dataloaders (Stayntouch), paid import services that skip cancelled/no-show bookings (Cloudbeds), semi-manual
   imports (Mews), custom projects (Omniboost) or RPA (RobosizeME) [S]. **A real one-button migration would be a
   category first.**
2. **OPERA Cloud is extractable at modest cost but within hard limits** [V]: 45 API modules / 3,580 operations;
   synchronous search capped at **1,000 records**; bulk via async jobs (94-day windows, 30-minute spacing for
   identical requests, 2 MB truncation, 6-hour result retention); **50 rps per gateway shared with the hotel's live
   integrations**; partner access needs the **hotel's chain administrator to approve** a connection (module-level
   scopes and **Sensitive Data Access**). Estimated API cost for a 100-room resort full extraction: **on the order
   of $100** at the reported partner rate [I].
3. **OPERA 5 (on-premises) has three realistic non-Oracle paths** [V]: (a) **OXI 2-way interface + Resync** —
   Oracle's documented "initial cutover resync" sends products, rate codes, restrictions, inventory, profiles,
   blocks and reservations (incl. cancels, no-shows, checked-in) to an external system, then business events stream
   deltas; requires an **OXI licence per interface and property**; (b) **File Exports** (licence `OPP_EXP`): ASCII/XML
   from OPERA views, templated or custom SQL, schedulable at End of Day, **PII masked unless SFTP/HTTPS**; (c) a
   **read-only database extract** by the hotel's DBA — **contractual risk** under Oracle licence terms (ASFU-type
   restrictions per third-party licensing advisers) [3P]. Financial history (folios, AR, ledgers) is **not** carried
   by OXI; it needs exports/reports or database extraction.
4. **Mews has the best modern bulk export** (Exports API: JSONL files for reservations, customers, companies, bills,
   order items, payments, availability blocks, ledger entries; incremental by `UpdatedUtc` ≤180 days) [V];
   **Apaleo** is fully open (REST, OAuth, 3,500 req/min) [V]; **Cloudbeds, Little Hotelier, eZee, Infor HMS** are
   report/CSV-centric with traps (access ends at account deactivation; masking after 180 days; 64,000-record export
   cap) [S][3P].
5. **What cannot be automated** (and therefore defines the checklist): the hotel's **legal authorisation/DPA**;
   **approving source-system access** (OHIP connection approval, OXI licence purchase/activation, export credentials);
   **card-data transfer**, which only the PSPs can do PSP-to-PSP (Stripe: PCI DSS Level 1 counterpart, SFTP + PGP,
   merchant approval; wallet cards not portable) [S]; **sign-off of opening balances and ambiguous financial items**;
   **channel/OTA connectivity switch authorisations**; and **staff acceptance**.
6. **Evidence-based failure modes** to design against: duplicated reservations and doubled revenue after a CRS–PMS
   mismatch (FIDI, reverted in two months), dirty profiles migrated intact, missing cancelled/no-show history,
   masked exports, interface re-certification delays, long downtime in big-bang database moves [S][V].
7. **Proposed design — "Move to Portico"** (§7): *connect → discover → auto-map → rehearse in a trial copy →
   continuous delta sync → reconciliation gates → cutover with a ≤15-minute freeze → history backfill → hypercare*,
   with a 7-item irreducible checklist. Targets: guesthouse from CSV/SMB PMS **same day**; 100-room resort from
   OPERA Cloud **≤5 days elapsed, ≤15-minute freeze**; from OPERA 5 via OXI **≤10 days** [I, targets to validate].

---

## 2. What has to move (data classes)

| Class | Needed at cutover? | Typical volume (100-room resort) [I] | Notes |
|---|---|---|---|
| Property configuration (rooms/units, unit types, features, outlets, departments) | Yes | 100–300 rooms; 10–40 types | Derive from source config APIs/exports |
| Commercial configuration (rate codes/plans, seasons, packages, restrictions, policies, market/source/channel codes) | Yes | 50–500 rate codes (OPERA estates often hundreds) | Map to Portico base + derivations where possible (R01 §3.8) |
| Financial configuration (transaction codes/groups/subgroups, generates/taxes, payment methods, routing codes, AR settings) | Yes | 200–600 codes | **Finance review mandatory** (INT mapping suggestions) |
| Future and in-house reservations (incl. shares, accompanying guests, routing, packages, deposits, traces, comments, preferences) | **Yes** | 2,000–8,000 | The operational core |
| Blocks/groups (grids, pickup, cutoffs, posting masters, rooming lists) | Yes | 20–200 | Status mapping by **type** (§8.5) |
| Guest/company/agent profiles | Yes (linked ones); rest can backfill | 20k–200k | Duplicate scoring before import |
| Open folios / balances (in-house, deposits held, AR open items) | **Yes** | in-house + deposits + AR ledger | **Opening balances signed off** |
| Payment tokens | Yes for guaranteed future stays | 1 per future reservation | **PSP-to-PSP only** (§5) |
| Historical reservations, stays, folios, invoices | No (backfill) | 2–7 years | Needed for RM pace, guest history, legal retention (Q44) |
| Housekeeping status, OOO/OOS | Yes (at cutover) | rooms | Snapshot at freeze |
| Users/roles | Yes | 20–200 | Re-create in Portico identity; never migrate passwords |

---

## 3. Source systems: access paths, limits, costs and gates

### 3.1 OPERA 5 / V5 on-premises (incl. 5.6) — legacy Fidelio lineage

**Data model facts.** Oracle Database schema per installation; exports read from "views supplied as standard with
OPERA", which collect data "from the many hundreds of OPERA database tables" [V] [O5-EXPORT]. OCM supports **OPERA
V5.0.03.03 and higher on Oracle Database 10.x/11.x** (Windows servers) [V] [ORA-OCM-UG]. OPERA 5.6 Premier Support
reported to end **Dec 2027** (LinkedIn posts; unverified) [3P].

| Path | What it gives | Licence / approval | Limits and risks | Use in Portico [I] |
|---|---|---|---|---|
| **A. Oracle OCM** (OPERA Cloud Migration On-Premise) | Full database: customer installs OCMO, enters SFTP + DB + SYS credentials, runs an **evaluation XML**; Oracle migration team runs checklist, **initial and final RMAN backups**, restore on migration server, **SaaS Pull** into OPERA Cloud/OPERA 5 Hosted [V] | Oracle sales enters the request; Oracle team runs steps 4–6 **after contract** [V] | Only to Oracle targets; not available to third parties | None (competitive reference: Oracle's "migration" = DB copy) |
| **B. OXI 2-way + Resync** | XML messages to an external system: **initial cutover resync in sequence** *Products → Rate Codes → Rate Restrictions → Inventory (overbooking levels/OOO) → Profiles → Blocks → Reservations*; filters incl. **Include Cancels, Include No Shows, Include Checked In**, arrival date ranges, confirmation numbers, "All Profiles", cancelled blocks; then **business events** send deltas [V] [O5-OXI-RESYNC] [O5-OXI-HUB] | **Licence code per interface and property** [V]; activating a 2-way licence prompts activation of the external system ID [V] and enables external-system business events [S]; OXI permission set (resync, conversion tables, message status) [V] [O5-OXI-LIC] [O5-OXI-SETUP] [O5-OXI-S] | Oracle advises resync **off-peak in smaller ranges**; mandatory config elements (rate codes, room types, reservation types, payment methods, market/source codes, exchange rates…) must exist on both sides; **no folio/ledger history**; whether a non-Oracle vendor needs Oracle partnership/certification to be an OXI external system is **unconfirmed** (Q61) | **Primary automated path** when the hotel has/buys OXI 2-way: Portico acts as the external system; gives near-real-time deltas until cutover |
| **C. File Exports** (`OPP_EXP`) | ASCII/XML exports from standard views; templates or custom SQL; manual or **automatic at End of Day** (`GENERATE EXPORT NA DATA`); written to the export directory (`FORMS90_output`, e.g. `D:\micros\opera\export`) [V] [O5-EXPORT] | `OPP_EXP` add-on licence; SQL knowledge for custom exports | **PII masked unless delivery is SFTP or HTTPS**; performance impact if run in daytime | **History and finance path** (folio history, AR, transaction history) via a Portico-supplied export pack the hotel imports once |
| **D. Reports** | PDFs/CSVs (trial balance, AR aging, deposit ledger, guest ledger) | None beyond user rights | Not machine-friendly | **Reconciliation evidence**, not data source |
| **E. Read-only DB extract by the hotel's DBA or local connector** | Everything | Hotel's Oracle/ISV contract; ASFU-style licences typically restrict third-party tools querying the embedded DB; extraction to a separate licensed DB sometimes advised [3P] [ASFU-3P] | Legal risk; schema complexity | **Only with written confirmation of rights** (Q61/Q62); Portico local connector could run hotel-authorised SQL exports |
| **F. HRS-style tooling** | Partner tool OPERA V5 → OPERA Cloud (XML via OXI/OHIP [C]) | Partner engagement | Direction is *into* OPERA Cloud | Evidence that OXI-based extraction at scale works (≈15 res/min, 25 profiles/min observed into Cloud) [VC] |

### 3.2 OPERA Cloud (OHIP) [V] [OHIP-SPECS-26.3] [OHIP-UG]

**Readable entities (examples of GET operations in the v26.3 specs):**

| Domain | Operations (examples) |
|---|---|
| Profiles (`crm`, 168 ops) | `getProfiles`, `getProfile`, `getProfilesByIds`, `getStayHistory`, `getProfileRelationships`, `getLinkedProfiles`, `getMembershipDetails`, `getProfileAccounts`, `getProfileCommissionAccount`, `getProfileActivityLog`, `getProfileMatches`; async **stay-record import** (CRMASYNC) |
| Reservations (`rsv`, 184 ops) | `getHotelReservations`, `getRoutingInstructions`, `getPackage`, `getReservationPreference`, `getTracesByReservation`, `getAlertNotices`, `getCallHistory`, `getCancellationHistory`, `getGuestMessages`, `getRoomCalendar`, `getExternalSystemReservations`; async `getReservationsDailySummary` |
| Blocks (`blk`, 93 ops) | `getBlocks`, `getBlockReservations`, `getBlockPMReservations` (posting master); async `getBlockAllocationSummary` |
| Rates & packages (`rtp`, 144 ops) | `getRatePlans`, `getRatePlansByHotel`, `getPackages`, `getPackage`, `getPackageRates`, `getPackageGroups`, `getPackageFormulaRanges`; async rate-plan operations |
| Cashiering (`csh`, 196 ops) | `getFolioHistory` (filters incl. AR, check-out, credit bill, folio/invoice numbers, fiscal folio no., date ranges, limit/offset), `getFinancialPostings`, `getFinancialPostingsNetVat`, `getDepositFolio`, `getDepositFolioTransactionDetails`, `getCashierTransactions`, `getTransactionCodes`; async financial postings |
| AR (`ars`, 62 ops) | `getAccounts`, `getInvoicePostings`, `getInvoicesPayments`, `getProfileAging`, `getStatementsHistory`, `getRemindersHistory` |
| Financial config (`fofcfg`, 369 ops) | `getTransactionCodes`, `getBulkTransactionCodes`, `getTransactionGroups`, `getTransactionSubgroups`, `getGenerateTaxTypes`, `calculatePosting` (charge simulation), `getFolioTypesConfig`, `getFolioArrangementCodes`, payment methods |
| Exports (`expcfg`) | `getExportsAvailable`, export mappings, **export schedules (create/change)**, `getExportsGenerated`, export activity log |
| Housekeeping (`hsk`), inventory (`inv`), leisure (`lms`), configuration (`rmcfg`, `rsvcfg`, `entcfg`, `lov`) | Rooms, features, OOO/OOS, task sheets, room types, reservation types, deposit policies, LOVs |

**Enumerations (from the specs) used in mapping (§8):** profile types `Guest, Agent, Company, Group, Source,
Employee, Hotel, Vendor, Contact, Purge, BusinessHeader, BillingAccount, Activity, Potential, Account`; PMS reservation
status `Reserved, Requested, NoShow, Cancelled, InHouse, CheckedOut, Waitlisted, DueIn, DueOut, Walkin,
PendingCheckout`; housekeeping room status `Clean, Dirty, Pickup, Inspected, OutOfOrder, OutOfService`; front-office
status `Vacant, Occupied`; turndown `Required, NotRequired, Completed` [V].

**Limits that shape the design:**

| Limit | Value | Consequence [I] |
|---|---|---|
| Gateway throttle | **50 rps/gateway**, burst 100, **shared with all the hotel's integrations** | Run extraction at ≤10–20 rps, off-peak, with backoff; never starve POS/keys/channel links |
| Synchronous reservation search | **≤1,000 records** even with paging | Use async summaries to enumerate IDs, then fetch detail per reservation |
| Async jobs | POST→HEAD(≤1/min)→GET; **identical requests 30 min apart**; >2 MB truncated; results **6 h**, readable once | Partition by date windows (≤94 days) and properties; persist results immediately |
| Incremental window | last-modified ≤ **3 days**, identical requests 3 h apart | Deltas between rehearsal and cutover via **streaming business events** plus async catch-up |
| Financial postings async | **≤15 days per reservation** | Folio history via `getFolioHistory` + postings per reservation for in-house/open items; older history via Data APIs |
| Data APIs (R&A subject areas) | Need hotel's **R&A Data Access SKU** (or partner per-call plan) | Ask hotel up front; otherwise use operational APIs for history (slower) |
| Streaming | 1 consumer per chain/gateway/app key; reconnect ≤24 h | Portico's consumer must be the only one for its app key; durable offsets |
| Access approval | Partner connection approved by chain admins; **Sensitive Data Access** separately requested | Checklist item; request the minimum modules; explain why sensitive data is needed (ID docs for registration) |
| Cost | Partner per-call (R01: ~$10 / 10,000 calls) [S] | See estimate below |

**Extraction estimate for a 100-room resort [I, to validate in sandbox].** ~6,000 future + in-house reservations ×
~6 detail calls = ~36k calls; ~30,000 historical reservations × 2 calls (folio history + summary) = ~60k; ~100k
profiles via `getProfilesByIds` batches ≈ 2–5k calls; configuration ≈ 3–5k calls → **~100k–110k calls ≈ US$100–110** at
the reported rate; at 15 rps sustained ≈ **2 hours** of calls plus async job waits (hours). The binding constraints
are approvals and async spacing, **not money**.

### 3.3 Mews [V] [MEWS-EXPORTS] [MEWS-CHANGELOG-2026]
- **Exports API** (beta, restricted): async; JSONL files; entity types `OrderItem, Payment, Reservation, Customer,
  Company, Bill, AvailabilityAdjustment, AvailabilityBlock, ResourceBlock, LedgerEntry`; `UpdatedUtc` filter ≤180
  days (end ≥5 min ago); one pending export per type; download URLs valid **10 minutes**; portfolio tokens.
- Plus Connector API for configuration (rates, rate groups, resource categories, products, policies, routing rules,
  tax environments), webhooks for deltas; **editable-history windows** mean recent past can still change (R02) — final
  sweep after the window closes.
- Access: hotel-issued access token for an integration (partner listing/certification rules per R02) — whether
  Mews will grant a competitor's migration client is **unconfirmed** [I].

### 3.4 Apaleo [V] [APALEO-RATELIMIT] [APALEO-AI]
- Open REST with OAuth (consent screen, fine-grained permissions); **3,500 requests/minute** global; booking,
  inventory, rate plans, folios, accounts, invoices; webhooks; MCP (~260 tools). Easiest modern source.

### 3.5 Cloudbeds [S] [CB-IMPORT] [CB-CANCEL] [3P] [CB-API-3P]
- API v1.3 (`getReservations`, `getReservation`, `getGuest`, `getGuestList`); API keys or OAuth; rate limits unread.
- Help centre: export reservation list and reports **before cancelling** — access ends at deactivation; all
  third-party connections switched off. **Plan the export before notice is given.**

### 3.6 Little Hotelier / SiteMinder [S] [LH-EXPORT] [3P]
- Reservations CSV export **≤365 days per export**; third-party: search reaches back **548 days**; **guest details
  masked 180 days after check-out**. Channel manager relationship must be ended or moved.

### 3.7 Stayntouch [S] [STAYNTOUCH-DATALOADER]
- Connect API + webhooks; CSV Dataloader (import side); export scope per third-party guide: reservations, profiles,
  groups/rate blocks, message templates [3P].

### 3.8 eZee Absolute (Yanolja) [S] [EZEE-EXPORT]
- Guest database export to Excel (privilege needed); reservations export not confirmed; partner API unconfirmed.
  Common in South Asia/Middle East SMB (R03) — **likely in Maldives guesthouses** [I].

### 3.9 RoomRaccoon [3P] [RR-API-3P]
- v2 REST + webhooks; **no self-serve portal**; API key + hotel ID after connectivity sign-up and a **30-minute
  certification call**.

### 3.10 protel (Planet) [3P] [C]
- API availability contested; protel.io marketplace referenced; treat as **export/report + local connector** source
  until confirmed.

### 3.11 Infor HMS [S] [INFOR-HMS-EXPORT]
- Dataspy query → Excel, **≤64,000 records per export**; third-party connectors expose reservations.

### 3.12 Agilysys (Stay/Visual One/LMS) [S]
- REST API for partners (NDA-gated per R01 §6.4); R01 notes "lost data during migration" complaints.

### 3.13 Hotelogix
- No public API/export documentation found; treat as CSV/report source (Q64 discovery).

### 3.14 Spreadsheets and paper
- Portico templates (migration-acceptance-criteria §11); bank statements for deposits; cards never accepted in files.

### 3.15 Summary matrix [I]

| Source | Best automated path | Incremental deltas | Finance history | Hotel action required | Automation level |
|---|---|---|---|---|---|
| OPERA Cloud | OHIP (async + detail + Data APIs) | Streaming events + async last-modified | Folio history, postings, AR via API; bulk via Data APIs (SKU) | Approve partner connection (+ Sensitive Data Access; optional Data Access SKU) | **High** |
| OPERA 5 | OXI 2-way Resync + File Export pack | OXI business events | File exports / reports / DB (rights) | Buy/activate OXI licence; run export pack or allow local connector | **Medium–High** |
| Mews | Exports API + Connector API | `UpdatedUtc` exports + webhooks | Bills, payments, ledger entries | Issue access token | **High** (if access granted) |
| Apaleo | REST/OAuth | Webhooks | Folios, accounts, invoices | Consent | **High** |
| Cloudbeds | API v1.3 + report exports | API polling | Reports | API key/OAuth; export before cancel | Medium |
| Stayntouch | Connect API | Webhooks | Unconfirmed | Credentials | Medium |
| RoomRaccoon | Partner API | Webhooks | Unconfirmed | Partner onboarding | Medium–Low |
| Little Hotelier, eZee, Hotelogix, Infor, protel | CSV/report packs (+ local connector) | Re-export near cutover | Reports | Run exports (guided) | Low–Medium |
| Spreadsheets | Templates | Re-upload | Bank statements | Fill templates | Medium |

---

## 4. How the market migrates today (tooling and claims)

| Provider | Mechanism | Throughput / time | What is left manual | Evidence |
|---|---|---|---|---|
| Oracle OCM | DB backup + restore + SaaS Pull (OPERA→OPERA) | Not published | Contract, Oracle team steps 4–6, data cleaning, custom object validation, test migration | [V] [ORA-OCM-UG] |
| Oracle Consulting (2020 deck) | Choose **New Install** (clean, config import, **reservation & profile sync via third party**, minimal downtime) vs **Migration** (keep all history, **potential significant downtime**) | — | Configuration via **OCCS workbook** | [V] [ORA-CONSULT-2020] |
| HRS Data Migration Tool | OPERA V5 XML → code mapping → validation → OPERA Cloud | 15 res/min, 25 profiles/min, 25 rates/min, 50 packages/min | Code mapping where not 1:1 | [VC] [HRS-DMT] |
| Shiji | Factory rollouts | 100+ hotels in 2 months; 7 properties/day (R01) | n/a | [VC] |
| Mews | Templates, guided setup, semi-automated import, manual validation; warns against importing old profiles | avg ~2 months; 1 week minimum | Validation, profile clean-up | [VC] [MEWS-MIGRATE] |
| Cloudbeds | **Paid** Reservation Import Service | 2–4 weeks onboarding (R03) | **No cancelled/no-show import**; "always manual adjustments" | [S] [CB-IMPORT] |
| Stayntouch | CSV Dataloader | Test files 1 week ahead | File preparation | [S] |
| Apaleo/Omniboost | Custom migration (IDPMS → Apaleo) | Pilot 2025 | Bespoke | [S] [OMNIBOOST-VALK] |
| RobosizeME | RPA where exports are incomplete | — | Bot maintenance | [S] [ROBOSIZEME] |
| Chatlyn (consultancy) | OPERA 5 → Cloud advisory | 6–12 weeks/property | Clean-up, interface re-certification | [3P] [CHATLYN-O5] |

**How competitors advertise "easy switching":** Mews' switching-PMS research and "as little as a week"; Stayntouch's
"how to make the switch to SaaS PMS" guidance (ask what imports automatically vs manually); Roommaster's "migrate from
Cloudbeds/Stayntouch without losing a booking" guides [S]. None publish migration correctness metrics.

---

## 5. Failure modes (evidence) and the control Portico needs

| # | Failure | Evidence | Control [I] |
|---|---|---|---|
| F1 | **Duplicate reservations; on-the-books revenue doubled**; payments not reaching bank; reversal in 2 months | FIDI Hotel [S][3P] | External-ID uniqueness; pre-cutover count/revenue reconciliation per stay date; CRS/channel switch only after green gates; rollback path |
| F2 | Dirty/duplicate profiles migrate intact | Chatlyn [3P]; Mews warning [VC] | Duplicate scoring, merge suggestions, "archive don't import" option |
| F3 | Missing cancelled/no-show history | Cloudbeds import [S] | Import all statuses (OXI resync includes cancels/no-shows) |
| F4 | Masked PII in exports | OPERA exports over non-secure delivery [V]; Little Hotelier 180-day masking [3P] | Use SFTP/HTTPS; detect masked patterns; flag fields |
| F5 | Truncated/partial bulk results | OHIP >2 MB truncation; 1,000-record sync cap [V] | Size-aware paging; completeness counts vs source statistics (`getRevenueInventoryStatistics`) |
| F6 | Recent history still changing after extraction | Mews editable windows (R02); OPERA business date not closed | Final sweep after source Day Close; compare trial balance |
| F7 | Interface re-certification and partner access delays | Chatlyn [3P]; OHIP approvals [V] | Start access requests on day 1; parallel validation runs |
| F8 | Big-bang downtime | Oracle slide: "potential for significant downtime" [V] | Continuous delta sync; ≤15-minute freeze |
| F9 | Lost payment details | RoomRaccoon anecdote (R03) [3P] | PSP-to-PSP card migration with token map and per-reservation guarantee report |
| F10 | Champion leaves mid-project | FIDI [S] | Autopilot + checklist with named owners and escalation |
| F11 | Configuration not 1:1 (rate codes, transaction codes) | HRS "Code Mapping" step [VC]; OXI mandatory elements [V] | Mapping suggestions with confidence; finance review; unmapped → parked with blocking exceptions |

---

## 6. What can be automated end to end — and what cannot

### 6.1 Automatable (Portico does it, no human needed except to watch)

| Step | How | Evidence base |
|---|---|---|
| Source discovery (system, version, modules, volumes) | API calls (OHIP config/LOV, Mews config), OXI resync history, export manifests | [V] |
| Configuration extraction | OHIP cfg APIs; OXI products/rates/restrictions/inventory; Mews/Apaleo config | [V] |
| Mapping suggestions | Rules + similarity on codes/descriptions; OPERA concept map (§8) | [I] |
| Data extraction (full + incremental) | OHIP async + detail + streaming; OXI resync + events; Mews Exports; Apaleo REST | [V] |
| Data quality checks and duplicate detection | Deterministic rules + scoring | migration-acceptance-criteria M2 |
| Rehearsal imports into a **trial copy** | Isolated environment (evaluation-and-trial.md) | — |
| Reconciliation | Counts by status/date; room nights and revenue on the books per stay date; deposits held; AR open items and aging buckets; in-house balances; trial balance at source business date; block pickup | migration-acceptance-criteria M4 |
| Delta sync until cutover | Events/streams + periodic catch-up; idempotent upserts keyed by source IDs | [V] |
| Cutover orchestration | Freeze, final delta, last reconciliation, authority transition (`planned → frozen → effective`), channel switch through Channex, key/POS interface switch | glossary; platform spec |
| History backfill after go-live | Background, throttled, resumable | [I] |
| Post-cutover monitoring | Exceptions with owners | — |

### 6.2 Not automatable (irreducible checklist) — **the 7 steps the hotel must do**

| # | Step | Why it cannot be automated | Who | Typical effort |
|---|---|---|---|---|
| 1 | Sign the **data authorisation and DPA** for the migration | Legal act of the hotel's legal entity (migration-onboarding-checklist 1.1) | GM/owner | 5 min e-sign |
| 2 | **Grant source access**: approve the OHIP partner connection (+ Sensitive Data Access) **or** activate an OXI 2-way licence **or** run the Portico export pack / allow the local connector **or** issue a Mews/Apaleo/Cloudbeds token | Source vendor requires the customer's approval; licences are commercial with Oracle | Hotel IT / chain admin | 10 min – days (licence purchase) |
| 3 | **Request card-data transfer** from the current PSP/vault to Portico's PSP (if future guarantees should keep cards) | Only PCI-compliant PSPs can move PANs; requires merchant request and approval of the validation summary (Stripe process) | Finance | Request 10 min; PSP lead time weeks [S] |
| 4 | **Confirm opening balances and resolve ambiguous financial items** (deposits without reservations, AR disputes, unbalanced folios, unknown transaction codes) | Accounting judgement and legal responsibility | Finance controller | 1–4 h with Portico's prepared list |
| 5 | **Authorise channel/OTA and interface switches** (channel manager disconnect, OTA connectivity provider change, POS/keys/CRS re-pointing) | Contracts with third parties; some OTAs require the property to confirm provider changes in their extranet | Revenue/IT | 30–60 min |
| 6 | **Choose the cutover window** (date/time; ≤15-minute freeze) | Operational decision | GM | 2 min |
| 7 | **Staff acceptance** of key workflows on migrated data (arrivals, check-in, posting, payment, check-out, Day Close) | Human sign-off (CLAUDE.md §7: staff validation recorded separately) | Department heads | 1–2 h guided |

Everything else is Portico's job. If a step fails (e.g. OHIP approval not given), the button **does not pretend**: the
migration shows *waiting for hotel approval* with the exact screen path and a reminder schedule.

### 6.3 Payment cards — the hardest honest limit
- Tokens in OPERA live at the hotel's PSP/OPI vault; Mews/Cloudbeds tokens live at their payment facilitators (R02/R03).
- **Portable only PSP-to-PSP**: Stripe imports via SFTP + PGP from another processor and exports only to a **PCI DSS
  Level 1** processor; the merchant approves a validation summary; **wallet and Link cards are not migratable**;
  expired cards may be refreshed via card-account-updater (fees) [S] [STRIPE-PAN-IMPORT] [STRIPE-PAN-EXPORT].
- Fallback (default for the Maldives pilot): keep guarantees as **"card held at previous PSP — re-collect"** and send
  pay-by-link/collection-plan requests before arrival (PAY-R20); never import PANs from files (rejected by design).

---

## 7. Proposed design: "Move to Portico" (one button) [I]

### 7.1 Flow and states

```
[Move to Portico]  →  Connect  →  Discover  →  Map  →  Rehearse  →  Sync  →  Cutover  →  Backfill  →  Done
                     (checklist   (auto)       (auto +   (trial      (continuous (≤15-min    (background) (hypercare
                      2 & 1)                    finance   copy,       deltas,     freeze,                 14 days)
                                                review 4) reconcile)  gates)      checklist 5–7)
```

| State | Exit criterion (gate) | Visible to hotel |
|---|---|---|
| Connect | Authorisation signed; source access proven (read probe succeeds) | "Waiting for: approve connection in OHIP portal → Environments → Partner Connections" |
| Discover | Inventory of source config and volumes; estimate of duration and cost (OHIP calls) | Plain-language summary: "312 rate codes, 4,812 future reservations, 96,000 profiles…" |
| Map | 100% of codes mapped or parked; finance mappings reviewed | Mapping screen with confidence and reasons; only uncertain items need a click |
| Rehearse | Trial import passes reconciliation thresholds (migration-acceptance-criteria M4) on two consecutive runs | Reconciliation report with drill-down to every difference |
| Sync | Delta lag < 5 min (OPERA Cloud streaming) / < 15 min (OXI) / < 1 h (CSV sources need re-export) | Live "in sync" with provenance `external` + last-sync time |
| Cutover | Final delta applied; counts, room nights, revenue on books, deposits, AR, in-house balances match; channels switched; staff acceptance recorded | Countdown, freeze banner, then "Portico is now the system of record for: reservations, rates…" |
| Backfill | History imported and reconciled to source reports | Progress bar; history marked `copied` until reconciled |

### 7.2 Source-specific strategies

| Source | Bulk | Delta | Cutover freeze | Target elapsed |
|---|---|---|---|---|
| OPERA Cloud | Async summaries to enumerate; detail per reservation; Data APIs for history if SKU | **Streaming business events** + async last-modified (≤3-day windows) | Stop new bookings on OPERA side (close channels via channel manager), final events drain, flip | **≤5 days** (gated by approvals) |
| OPERA 5 + OXI | **Initial cutover resync** in Oracle's order (products → rates → restrictions → inventory → profiles → blocks → reservations, incl. cancels/no-shows/checked-in) | OXI business events | Same; final resync of changed reservations | **≤10 days** (licence lead time excluded) |
| OPERA 5 without OXI | Export pack (templated exports via `OPP_EXP`) or local connector | Re-run export at cutover | Longer (30–60 min) | 1–3 weeks |
| Mews | Exports API (JSONL) | Exports `UpdatedUtc` + webhooks | Short | ≤5 days |
| Apaleo | REST | Webhooks | Short | ≤3 days |
| Cloudbeds/SMB PMS/CSV | Report/CSV pack; API where available | Re-export | 30–60 min | **Same day** for guesthouses (future reservations first; history next day) |

### 7.3 Reconciliation gates (numbers to add to migration-acceptance-criteria) [I]
- Reservation count by status and arrival month: **exact match** (allow only listed exclusions with reasons).
- Room nights and room revenue on the books per stay date for next 365 days: **exact** (rounding ≤ 0.01 per night due
  to tax recomputation, explained).
- Deposits held per reservation and in total: **exact**.
- AR open items and aging buckets per account: **exact**.
- In-house folio balances by window/payer: **exact**.
- Block grids (allocated, picked up) per date/type: **exact**.
- Profiles: linked profiles 100%; unlinked profiles imported or archived per hotel choice with counts.
- Each difference is an exception with owner and reason; **no cutover with open blocking exceptions**.

### 7.4 Concept fidelity and "no surprises"
- Show the **OPERA concept map** (§8) inside the mapping screen ("OPERA routing instruction → Portico billing rule").
- Preserve source IDs (confirmation numbers, profile IDs, block codes, AR account numbers) as external references —
  searchable from day one.
- Never recompute agreed prices or taxes for migrated bookings: import them as **agreed terms snapshots** with the
  source's amounts; differences in tax logic are surfaced, not silently "fixed" (CLAUDE.md §5).

---

## 8. OPERA → Portico mapping tables

Portico terms from `docs/product/glossary.md`. OPERA facts from R01 §3 and OHIP enumerations [V]. Mapping decisions
are proposals [I] for the integration/migration spec owners.

### 8.1 Profiles

| OPERA profile type | Portico concept | Notes |
|---|---|---|
| Guest (Individual) | **Guest profile** | Memberships → loyalty; preferences/features → guest preferences; Sensitive Data (ID, DOB) only with consent and encryption |
| Company | **Company** (+ **Receivables account** if AR) | Negotiated rates → contracting; credit limits → AR |
| Agent (Travel Agent) | **Travel agent** (`company.kind=agency`) | Commission codes/accounts → commission settings |
| Source | Travel agent/company with kind `source` or **Source** code | OPERA uses source profiles for wholesalers/OTAs as payers |
| Group | **Group** (sales account) | Linked to blocks |
| Contact | Contact person on company/agency | |
| Employee | Staff member reference (not migrated as user) | Re-create users in identity |
| BillingAccount / Account / BusinessHeader / Potential / Activity / Vendor / Hotel | CRM/sales objects (crm-marketing, contracting) or **not migrated** | Purge type excluded |

### 8.2 Reservation status

| OPERA (PMS status) | Portico stay status | Portico booking status | Notes |
|---|---|---|---|
| Reserved / Requested | `expected` | `confirmed` (or `tentative` by reservation type) | Requested = pending confirmation |
| DueIn | `expected` (derived "arriving today") | `confirmed` | Derived from business date (R01 §3.2) |
| InHouse / CheckedIn | `in_house` | `confirmed` | |
| DueOut / PendingCheckout | `in_house` (derived "departing today") | `confirmed` | |
| CheckedOut | `departed` | `completed` | |
| NoShow | `no_show` | `confirmed`→ terminal per policy | Import with no-show charge state |
| Cancelled | `cancelled` | `cancelled` | Keep cancellation number and reason |
| Waitlisted / WaitList | `waitlisted` | `held`/`tentative` | Waitlist reason code |
| Walkin | `in_house` + source `walk_in` | `confirmed` | |

### 8.3 Reservation types (deduct / non-deduct)
| OPERA | Portico |
|---|---|
| Deduct types (e.g. guaranteed by CC, deposit, company) | Booking **guarantee** (`card`, `deposit`, `company`, `agency`, `prepaid_channel`) and inventory-consuming stay |
| Non-deduct (e.g. 6 PM / 4 PM release, tentative) | `tentative` booking with **hold** expiry or non-consuming stay |

### 8.4 Rates, packages, restrictions
| OPERA | Portico | Notes |
|---|---|---|
| Rate code (header, details by room type/occupancy, seasons, financial details) | **Rate plan** (+ prices by unit type, occupancy, date) | Detect derived/negotiated linkages → derivation rules; flag rate-code proliferation for consolidation suggestions |
| Rate category / class | Rate plan grouping / tags | |
| Market code / source code / channel | **Market segment / Source / Channel** | Keep as reporting dimensions |
| Package code (Included in Rate / Added to Rate; calculation rule per room/person/adult/child/age bucket; posting rhythm; allowance) | **Package** with **inclusions** and **allowances** | 26.4 *price by age category* → age-banded pricing; posting rhythm → schedule |
| Package profit/loss and allowance breakage | **Breakage** entries | Policy-driven |
| Restrictions (CTA, CTD, min/max LOS, closed), FPLOS from hurdles | **Restrictions**; FPLOS imported as RMS-provided restriction | |
| Deposit / cancellation policies incl. **tiered** schedules (25.4) | **Payment schedule** + cancellation policy in **agreed terms** | Snapshot per booking |

### 8.5 Blocks
| OPERA | Portico |
|---|---|
| Block header, owner, cutoff date/days, elastic sell limits | **Block** with release rules |
| Status code with **type** (INQ, TEN non-deduct; DEF deduct; ACT; CAN/LOS/REF return inventory with mandatory reason) | Block status mapped **by type** (non-deduct / deduct / returned) with reason codes |
| Room & rate grid (original, current, pickup) | Block grid per unit type per night (contracted, current, picked up) |
| Posting master reservation | **Group master folio** |
| Rooming list | **Rooming list** |

### 8.6 Billing: windows, routing, transaction codes
| OPERA | Portico | Notes |
|---|---|---|
| Folio windows 1–8 with payee and payment method | **Folios** per payer (stay can have several) | Window number kept as external reference |
| Window routing (transaction codes / routing codes, date range, days of week, limits) | **Billing rules** (charge-code selectors, date range, weekdays, caps) | Non-overlapping rules (Q40) |
| Room routing (to another reservation) | Billing rule targeting another stay's folio | |
| Comp routing with authoriser | Comp billing rule with approver | |
| Default routing from profiles/rate codes (precedence source→agent→company→contact→rate code) | Billing rule *sources* (profile, rate plan) | Import resolved instructions on each reservation; templates on profiles |
| Transaction code → subgroup → group (revenue / payment / wrapper) | **Charge code** hierarchy; payment methods; wrapper → package allocation | Code lengths up to 20 (25.2) |
| Generates (tax, service charge; chained; inclusive/exclusive) | **Tax & fee rules** (effective-dated data) | Recompute only for new postings; migrated postings keep amounts |
| Fixed charges | Recurring charges on stay | |
| Cashier / cashier closure | **Cashier session** | Open sessions closed before cutover |

### 8.7 Accounts receivable and deposits
| OPERA | Portico |
|---|---|
| AR account (city ledger) with credit limit, restricted flag | **Receivables account** |
| Direct-bill transfer (auto at EOD or reviewed) | Folio settlement to receivables |
| Invoices, payments applied, aging, statements, reminders | AR open items with aging; history archived |
| Deposit ledger (advance deposits) | **Deposit** liabilities per booking |
| Consolidated credit-card AR | Card receivables (reconciled to PSP) |

### 8.8 Operations and front office
| OPERA | Portico |
|---|---|
| Housekeeping status Clean / Dirty / Pickup / Inspected | **Unit condition** `clean / dirty / cleaning(pickup) / inspected` |
| Out of Order / Out of Service | **Unit block** OOO / OOS |
| Front-office status Vacant / Occupied | Physical occupancy |
| Turndown Required / Not Required / Completed | Task type `turndown` with status |
| Traces | **Tasks** with department owner and due time |
| Alerts, comments, guest messages | Notes/alerts on stay; messages in comms |
| Room features, preferences | Unit features; guest preferences |
| Business date | **Business date** (start at source's current business date) |
| End of Day | **Day Close** (first Portico Day Close after cutover reconciles opening balances) |
| Task sheets, service orders (26.4) | Housekeeping tasks / work orders |
| Leisure bookings (26.4 LMS) | Activities/experiences in resort module |

### 8.9 Other PMS notes
- **Mews:** bills belong to customers; order items (Open/Closed/Inactive/Canceled) → postings; ledger entries → journal
  backfill; rate groups → rate plan families; resource categories → unit types (R02 §2.4).
- **Apaleo:** booking → reservations → time slices maps 1:1 to booking → stays → nights; folios per reservation;
  accounting accounts → ledger accounts (R02 §3.3).
- **Cloudbeds:** linked dorm/private inventory → composite units (INV-R05–R07).

---

## 9. Legal and contractual gates (no legal conclusions)

1. **Oracle contracts:** OXI and File Export are licensed add-ons; database access may be restricted by the hotel's
   licence (ASFU-type terms per advisers) — confirm per hotel (extends Q61/Q62).
2. **OHIP partner programme:** Portico as partner pays per call; Data APIs require the hotel's SKU; Sensitive Data
   Access must be justified.
3. **Data protection:** the hotel is controller; Portico processes under a DPA; ID documents and DOB are sensitive
   (identity spec, field encryption).
4. **PCI:** PANs move only PSP-to-PSP; Portico never receives raw card data.
5. **Trademarks:** "Import from OPERA / Mews" labels need nominative-use review (competitive-synthesis §3 item 2).
6. **Source-vendor terms:** some SaaS terms may restrict automated extraction by competitors — check per vendor
   (adoption brief §10).

## 10. Recommendations (build order) [I]

1. **OPERA Cloud connector first** (highest automation, biggest strategic value; OHIP partner access Q61).
2. **OPERA 5 OXI external-system connector** second, plus a signed **File Export pack** for finance history.
3. **Mews and Apaleo** connectors (modern competitors; clean APIs) third.
4. **CSV/report packs** for Cloudbeds, Little Hotelier, eZee, Hotelogix, Infor, protel and spreadsheets — needed for
   Maldives guesthouses on day one.
5. Publish an **open migration schema** and **correctness metrics** (counts, revenue-on-books, deposits, AR) for every
   migration — a market first.
6. Run a **sandbox measurement** (OHIP partner sandbox) to replace the estimates in §3.2 and §7.2 with evidence.
