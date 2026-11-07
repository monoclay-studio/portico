# Integration coverage matrix (provider × workflow, prioritized)

> Deliverable 5 (adoption brief §5–§6; operational-readiness brief §4, §9). Status date: 2026-11-07.
> **Every integration below is at readiness R1 (planned).** Nothing here is supported, configured, tested or
> live yet. Commercial terms, certification steps and approval status for each provider belong in
> `docs/readiness/dependency-register.md` and `docs/readiness/certification-matrix.md` (readiness agent); this
> document defines **what each connection must do** and **in which order we build it**.

## 1. How to read this matrix

### 1.1 Evidence

- **[V r0N]** — verified on 2026-11-07 in `docs/research/0N-*.md`, from search-engine extracts of the cited URL
  (those reports explain that direct page fetches were blocked). Re-verify field-level details before building.
- **[V2 r0N]** — from secondary sources in the same report.
- **[Unconfirmed]** — background knowledge, not verified. Must be checked with the vendor before any claim.
- **[Assumption]** — our planning assumption, usually about which systems our target customers use. Maldives
  usage could **not** be verified in this session (web search budget exhausted; vendor documentation hosts not
  reachable). Discovery with real hotels is requested in Q64.

### 1.2 Capability codes per workflow

`R` read · `C` create · `U` update · `RC` receive changes (pushed or detected) · `—` not offered.

### 1.3 Sync modes

| Mode | Meaning | Shown to staff as |
|---|---|---|
| Immediate | Event-driven (webhook, stream, push) with acknowledgement; target seconds | "Live connection" with last exchange time |
| Periodic | Polling on a schedule; state the interval | "Updated every N minutes" |
| Manual | A user triggers it | "Updated when someone presses Sync" with last time |
| File | Export/import of files | "File exchange — not a live connection" (brief §6). Never labeled live |

### 1.4 Priority tiers

- **P0 — pilot-critical:** needed to complete a representative setup (RS-1..RS-3, [adoption-paths.md](adoption-paths.md) §6).
- **P1 — next:** completes the most common variants of the target segments.
- **P2 — later:** breadth, enterprise, or low evidence of demand in the first market.

## 2. Target segments and the systems they use

| Segment | Profile | Systems they typically run | Evidence |
|---|---|---|---|
| S1 Maldives guesthouse | 4–30 rooms on inhabited islands; owner-operated; OTA-dependent; WhatsApp-heavy guest contact | All-in-one cloud PMS with bundled channel manager (eZee Absolute, Cloudbeds and similar), or spreadsheets plus OTA extranets; cash, bank transfer and local card acquiring; spreadsheet or small-business accounting | [Assumption] (eZee strong in South Asia/Middle East: [3P/BK r03 §8.2]); Q64 |
| S2 Maldives resort | 40–400 villas on a private island; meal plans; seaplane/speedboat transfers; spa, dive centre, multiple F&B outlets | Enterprise PMS (OPERA 5.x on-premise or OPERA Cloud most likely for branded resorts; protel, Infor, Shiji possible), enterprise POS, ERP/accounting (e.g. Infor SunSystems), spa system, door locks with on-site encoders, procurement/stock system | [Assumption] Q64 |
| S3 Regional group | 3–20 properties (Indian Ocean, South Asia, Middle East); mixed property types | Mixed PMS estate, central accounting, group reporting needs, central reservations | [Assumption] |
| S4 International operator | 20+ properties, brand standards | OPERA Cloud (de-facto enterprise standard, research 01), Infor HMS, Shiji Daylight, Agilysys; IDeaS/Duetto RMS; enterprise SSO; data platforms | [V r01] for vendor positions; segment usage [Assumption] |

## 3. Workflow catalogue (the unit of coverage)

Coverage is measured per **workflow**, not per vendor logo (brief §5). Each workflow names what is exchanged.

| ID | Workflow | Capabilities needed | Business meaning that must be preserved |
|---|---|---|---|
| **PMS (connected mode: Portico alongside an external PMS)** ||||
| W-PMS-01 | Units and unit types | R | Unit numbers, types, locations, features, connecting units |
| W-PMS-02 | Stays and bookings | R, RC | Stay status vs occupancy, assigned unit, occupants (adults/children ages), arrival/departure, ETA, source, notes |
| W-PMS-03 | Room status | R, U (forward), RC | Dirty/clean/inspected semantics differ by vendor — mapped explicitly |
| W-PMS-04 | Out-of-order / out-of-service blocks | R, C/U (forward) | OOO reduces sellable inventory; OOS does not (glossary) |
| W-PMS-05 | Guest profiles and companies | R, U (forward, where offered) | Booker vs guest vs payer; consent flags |
| W-PMS-06 | Revenue and postings (for reporting) | R | Business date vs posting timestamp; charge category; tax inclusive/exclusive |
| W-PMS-07 | Charge posting to an external folio | C (forward) | Idempotent posting; eligibility; correction by reversal |
| W-PMS-08 | Notes/traces on a reservation | C (forward) | Free-text only; never used for financial data |
| W-PMS-09 | Bulk extract for migration | R (API or file) | See [migration-acceptance-criteria.md](migration-acceptance-criteria.md) |
| **Distribution (Portico as PMS)** ||||
| W-DIST-01..03 | Availability, rates, restrictions | U (push) | Per unit type/rate plan/night; occupancy-based prices; derived rates; min/max stay, CTA/CTD |
| W-DIST-04 | Reservations: new, modified, cancelled | RC | Channel booking id + revision; full-replacement modifications; duplicates |
| W-DIST-05 | Acknowledgement | C | Ack only after commit (research 04 §A9) |
| W-DIST-06 | Room/rate mapping | R | Mapping completeness counter (research 03 §4.6) |
| W-DIST-07 | Missed-reservation recovery | R | Re-delivery / list of bookings for a date window |
| W-DIST-08 | Virtual card and card data | R via PCI service | Card data never enters Portico (CLAUDE.md §5) |
| W-DIST-09 | Guest messages and reviews | R, C | Optional |
| W-DIST-10 | Content and photos | U | Optional, P2 |
| **POS and restaurant systems (POS posts into Portico)** ||||
| W-POS-01 | Room-charge eligibility | R (POS reads Portico) | In-house, posting allowed, credit limit, folio routing |
| W-POS-02 | Guest lookup by unit or name | R | Respect privacy: minimum fields |
| W-POS-03 | Charge posting | C | Outlet, check id, items/categories, tax breakdown, service charge, tips, covers, server, business date |
| W-POS-04 | Corrections and voids | C (linked reversal) | Never edit a posted charge |
| W-POS-05 | Outlet and charge-code mapping | setup | Tax treatment must match |
| W-POS-06 | End-of-day totals | RC | Reconcile POS room-charge total vs Portico postings |
| W-POS-07 | Meal-plan allowance consumption | R, C | Resort entitlements; remaining allowance |
| **Accounting, ERP, AP** ||||
| W-ACC-01 | Daily journal | C | Balanced; dimensions (property, department, legal entity); business date |
| W-ACC-02 | Receivables invoices and credit notes | C | Gapless fiscal numbering stays in Portico |
| W-ACC-03 | Settlements of receivables recorded in the ERP | RC | Avoid double settlement |
| W-ACC-04 | Payouts and fees | C | A payout is not a sale |
| W-ACC-05 | Chart of accounts and dimensions | R | Mapping review mandatory (financially significant) |
| **Payments** ||||
| W-PAY-01 | Hosted card capture and tokenization | C | No raw card data in Portico |
| W-PAY-02 | Authorize / incremental / capture / release | C, U | Authorization ≠ payment |
| W-PAY-03 | Refund | C | Linked to original payment |
| W-PAY-04 | Payment link | C | Submitted ≠ paid |
| W-PAY-05 | Card-present terminal | C | Terminal reference; offline behavior |
| W-PAY-06 | Status webhooks | RC | Pending verification resolved by reconciliation |
| W-PAY-07 | Payouts, fees, disputes | R, RC | Reconciliation |
| **Door locks and mobile keys** ||||
| W-LOCK-01 | Encode key for unit and dates | C | Correct validity window (local time) |
| W-LOCK-02 | Additional / duplicate key | C | |
| W-LOCK-03 | Invalidate on check-out / room move | U | |
| W-LOCK-04 | Mobile key | C | Guest consent and device |
| **Housekeeping and maintenance applications (external app, Portico as PMS)** ||||
| W-HK-01..05 | Assignments, cleaning progress, inspection, maintenance blocks, room readiness | R, U, RC via Portico public API | Same semantics as SM-01/02 |
| **Revenue management and rate intelligence** ||||
| W-RMS-01 | Reservations and on-the-books to RMS | R (RMS reads) | Stay-date granularity, segments |
| W-RMS-02 | Price/restriction recommendations to Portico | RC | Applied through change preview with limits and history (brief §5) |
| **CRM, guest communications, reputation** ||||
| W-MSG-01..03 | Outbound send, inbound receive, delivery status | C, RC | One sender per message type (CR-9) |
| W-MSG-04 | Template approval (WhatsApp) | C | Provider approval required |
| W-CRM-01 | Profiles, stays, consent to CRM | R, RC | Consent and purpose limitation |
| **Spa, activities, recreation** ||||
| W-SPA-01 | Guest/stay lookup and charge posting | R, C | Same as POS |
| W-SPA-02 | Appointments onto the itinerary | RC | Itinerary shows external appointments as `external` |
| **Transport** ||||
| W-TRN-01 | Manifest to operator | C (file/email) | Names, weights/luggage if required, times |
| W-TRN-02 | Schedule and status from operator | RC (manual/file) | Disruption propagation (scenario 12) |
| **Procurement and stock** ||||
| W-PROC-01 | Operational purchase requests and stock consumption export | C (file) | Boundary: Portico does not become the procurement system (brief §12) |
| **Fiscal, tax, government, identity of guests** ||||
| W-GOV-01 | Tax return support data (e.g. Maldives TGST, Green Tax) | C (file/report) | Rules as dated data (CLAUDE.md rule 13) |
| W-GOV-02 | Guest registration / immigration reporting | C | Requirement per country (market matrix) |
| W-GOV-03 | E-invoicing / fiscal devices | C | Per country; outside first market unless required |
| **Enterprise identity, analytics, data** ||||
| W-ID-01 | Single sign-on (SAML 2.0 / OpenID Connect) | — | Standards-based, no partnership needed |
| W-ID-02 | User provisioning (SCIM) | RC | Leaver removal |
| W-DATA-01 | Bulk data export to warehouse | C (file/stream) | Definitions travel with data |

## 4. Essential workflows by segment (the denominator)

`E` essential (cannot go live without it or a documented manual alternative), `I` important, `·` not needed.

| Workflow group | S1 guesthouse (RS-1) | S2 resort (RS-2) | S3 group keeping PMS (RS-3) | S4 international |
|---|---|---|---|---|
| Distribution via hub (W-DIST-01..07) | E | E | · (stays in OPERA) | I |
| OTA virtual cards (W-DIST-08) | I | I | · | I |
| Guest messaging (W-MSG) | E | E | E | I |
| Payments acquirer (W-PAY-01..07) | E (or manual recording) | E (or manual recording) | · | E |
| POS posting (W-POS-01..06) | · | E | · | E |
| Meal-plan consumption (W-POS-07) | · | E | · | I |
| Accounting journal (W-ACC-01, 04, 05) | I (file) | E | · | E |
| Door locks (W-LOCK) | · (usually mechanical keys) [Assumption] | E (manual alternative allowed) | · | E |
| Connected-mode PMS (W-PMS-01..06) | · | · | E | I |
| Migration extract (W-PMS-09) | E | E | · | E |
| Transfers (W-TRN) | · | E | I (if SM-06) | · |
| Spa/activities (W-SPA) | · | I | · | I |
| Tax return data (W-GOV-01) | E | E | · | E |
| SSO (W-ID-01) | · | I | I | E |
| RMS (W-RMS) | · | I | · | E |

**Coverage metric (per segment):** coverage = (number of `E` workflows available at the required readiness for
at least one provider that the segment actually uses) ÷ (number of `E` workflows). Reported separately at R4
(sandbox-tested), R6 (approved for production) and R8 (proven in pilot). A workflow covered only by "file" counts
as covered only where the segment table allows file mode. **Current coverage: 0% at every level.**

## 5. Provider matrix

Columns: **Products/versions · Regions · Access model · Workflows (capabilities, sync mode) · Local connector ·
Costs · Limitations · Evidence · Tier**. Costs not published are "quote required" — never zero
(operational-readiness brief §3).

### 5.1 PMS and central reservation systems (connected mode and migration sources)

| Provider | Products / versions | Regions | Access model | Workflows · sync | Local connector | Costs | Limitations | Evidence | Tier |
|---|---|---|---|---|---|---|---|---|---|
| Oracle OPERA Cloud | OPERA Cloud PMS (numbered releases e.g. 24.x–26.x) via OHIP | Global (Oracle claims 233 countries) | Partner program: OHIP REST + streaming; environment-owner approval; streaming enabled per environment by Oracle Professional Services | W-PMS-01/02/03/04/05/06 R; W-PMS-03/04 U (forward); RC via OHIP streaming (GraphQL subscriptions over WebSocket, 7-day replay) · immediate; W-PMS-09 R | No | Partner pays ~US$10 per 10,000 REST calls/month and US$10 per 100,000 streamed events (tiers above) | Partner access route conflicting in sources (Oracle Store vs OPN reference); streaming payload contains only configured trigger elements since OHIP 25.4; room-status write and OOO write endpoints to be verified | [V r01] [OHIP docs](https://github.com/oracle/hospitality-api-docs/releases), [streaming FAQ](https://docs.oracle.com/en/industries/hospitality/integration-platform/stmig/c_faqs.htm), [datasheet](https://www.oracle.com/a/ocom/docs/industries/hospitality/hosp-integration-platform-ds.pdf) | **P0** (RS-3) |
| Oracle OPERA 5.x (on-premise) | OPERA PMS 5.x | Global legacy base | On-premise: OXI (OPERA Exchange Interface) for rates/reservations, IFC/FIAS-style interfaces for POS/locks/PBX, database reports/exports | W-PMS-09 R (file) for migration · file; connected-mode workflows via local connector [Unconfirmed] | **Yes** | Interface licences quote required (Oracle) [Unconfirmed] | Interface rights and protocol licensing unconfirmed (Q61, Q62); hotel's Oracle contract governs data export | OXI existence [V r01]; rest [Unconfirmed] | **P0 for migration (file)**; P1 for connected mode |
| Mews | Mews Operations via Connector API | 85 countries (vendor) | Public docs; ClientToken (integrator) + AccessToken (property); certification + live pilot for Marketplace listing | W-PMS-01/02/03 R; W-PMS-03 U (resources update — housekeeping use case); W-PMS-06 R (order items, payments); W-PMS-07 C (POS-style posting); RC via General Webhooks/WebSockets **registered through Mews support** · immediate/periodic | No | API free to build; Mews charges hotels no integration fee for Marketplace apps (vendor) | 200 requests / 30 s per AccessToken; multi-property access enabled by support; customer-centric bills differ from folio-per-stay | [V r02] [requests](https://docs.mews.com/connector-api/guidelines/requests), [housekeeping use case](https://docs.mews.com/connector-api/use-cases/housekeeping), [your journey](https://docs.mews.com/connector-api/your-journey) | P1 |
| Cloudbeds | Cloudbeds PMS (Flex/One/Experience/Enterprise tiers) | 150+ countries (vendor) | Public API and marketplace [Unconfirmed]; exports via reports | W-PMS-01/02/03/06 R [Unconfirmed]; W-PMS-09 R (reports/CSV) | No | Quote required | Cloudbeds warns that running it alongside a second PMS can cause wrong availability and overbookings — Portico must not run distribution alongside it (CR-7); reservation import is sold separately by Cloudbeds | [V r03] [channel integrations](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/30906094566427-Channel-Manager-Integrations), [onboarding T&Cs](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/360050401814-Onboarding-Terms-and-Conditions); API [Unconfirmed] | P1 (RS-4) |
| eZee Absolute (Yanolja Cloud Solution) | eZee Absolute + eZee Centrix channel manager | Strong in South Asia, Middle East [BK] | API/partner access [Unconfirmed]; report exports | W-PMS-09 R (export) · file; connected-mode workflows [Unconfirmed] | No | Quote required | "Difficult migration away" reported by reviewers | [3P r03 §8.2] | P1 (RS-4, S1 migration) |
| Apaleo | Apaleo APIs (Inventory, Rate Plan, Booking, Finance, Operations, Webhook…) | 30+ countries (2024) | Public OpenAPI, OAuth 2.0 with consent screen; self-serve webhooks | All W-PMS R; U where API permits; RC via webhooks (24 h retry window reported) · immediate | No | Reported no integration fees on the core [VC] | Rate limits per client + account (request and concurrency) | [V r02] [scopes](https://apaleo.dev/guides/api/scopes.html), [webhooks](https://apaleo.dev/guides/webhook/overview.html), [rate limits](https://apaleo.dev/guides/api/rate-limiting.html) | P2 |
| Infor HMS | HMS (multi-tenant AWS) | Global; casinos, resorts | Infor ION / ION API Gateway (OAuth2) | [Unconfirmed] workflows | No | Quote required | No public developer portal found | [V r01] [Infor developer](https://developer.infor.com/?p=162) | P2 |
| Shiji Daylight PMS | Daylight PMS (+ Infrasys POS, Stellaris, ReviewPro) | 36 countries (vendor) | API catalogue with sandbox, OAuth, webhooks (third-party listing) | [Unconfirmed] | No | Quote required | Evidence quality mixed | [V r01] [API Tracker](https://apitracker.io/a/shijigroup) | P2 |
| Agilysys | Stay, Versa, LMS (+ InfoGenesis POS, Book4Time) | Global; casino/resort | Solution Partners program, NDA, certification per integration type; legacy XML/file interfaces | [Unconfirmed] | Legacy: likely | Quote required | No public specs | [V r01, low confidence] [Supergood](https://supergood.ai/api-report-card/agilysys) | P2 |
| Stayntouch | Stayntouch PMS | Mainly US | "Connect APIs", sandbox, scoped OAuth (vendor claims) | [Unconfirmed] | No | "Free API certification" (vendor claim) | US-centric | [VC r02] [developers](https://www.stayntouch.com/developers/) | P2 |
| protel (Planet) | protel on-premise, protel Air | EU-heavy | [Unconfirmed] | Migration export [Unconfirmed] | On-premise: yes | Quote required | | [3P r03 §8.3] | P2 |
| RoomRaccoon | RoomRaccoon all-in-one | EU, South Africa | [Unconfirmed]; exports | W-PMS-09 (export) | No | Quote required | RaccoonPay tokens not portable [Assumption]; migration data-loss anecdote | [3P r03 §5] | P2 (migration only) |
| Little Hotelier (SiteMinder) | Little Hotelier | Global small properties | [Unconfirmed]; exports | W-PMS-09 (export) | No | Quote required | | [Unconfirmed] | P2 (migration only) |
| Spreadsheets / generic CSV | Portico import templates | All | File | W-PMS-09 · file | No | None | Quality depends on the hotel's records | Internal | **P0** (RS-1) |

### 5.2 Channel managers, hubs, OTAs and metasearch (Portico as PMS)

| Provider | Products | Access model | Workflows · sync | Costs | Limitations | Evidence | Tier |
|---|---|---|---|---|---|---|---|
| Channex (white-label hub) | Channel API, booking revisions feed with acknowledgement, Channex PCI, Payment Application API | Wholesale partner; free staging; production requires integration testing, certification and OTA account authorization (owner brief §5) | W-DIST-01..07 · immediate (push ARI; revisions feed with ack); W-DIST-08 via Channex PCI (tokenized iframe, certified partners only) | Planning baseline (owner brief §5, checked 2026-11-07, re-verify before purchase): US$130/month platform + US$7/property/month with an active channel; messaging and reviews +US$7/property; VAT, extras, overages additional | Channel list ≠ every capability per channel (capability matrix by channel in `docs/readiness/`); platform fee persists with zero properties after activation | [V r04] [pricing](https://channex.io/pricing.md), [bookings](https://docs.channex.io/api-v.1-documentation/bookings-collection), [PCI](https://docs.channex.io/channex-pci/overview) | **P0** (RS-1, RS-2); PCI service P1 |
| Booking.com (via hub) | — | Hotel authorizes the connectivity provider in its extranet | Through Channex | Hotel pays OTA commission (separate) | Booking.com sunsets legacy content endpoints 31 Dec 2026 (relevant for direct only) | [V r04] [docs](https://developers.booking.com/connectivity/docs) | **P0** via hub |
| Expedia Group (via hub) | — | As above | Through Channex | Commission (hotel) | Direct path would be GraphQL + webhook delivery | [V r04] [reservation delivery](https://developers.expediagroup.com/supply/lodging/docs/booking_apis/reservations/getting_started/res_delivery) | **P0** via hub |
| Agoda (via hub) | YCS | As above | Through Channex | Commission (hotel) | Booking pulls must cover full window | [V r04] [Agoda dev](https://developer.agoda.com/supply/docs/introduction) | **P0** via hub (Asia demand) [Assumption] |
| Airbnb (via hub) | — | Closed to new API partners; only via an existing partner | Through Channex | Commission/fees (hotel) | Matters more for guesthouses/apartments | [V2 r04] | P1 |
| Trip.com, Hotelbeds and wholesalers (via hub) | — | Through recognised partners | Through hub | Contract-specific | Wholesale net rates/allotments often contracted outside APIs | [V2 r04] | P1 |
| Maldives tour operators / DMCs (offline contracts) | Allotment contracts, rooming lists | Email/spreadsheet | W-DIST-04 equivalent by **file** · manual | n/a | Not a live connection; allotments managed as blocks | [Assumption] | P1 |
| Google Hotel Center (free booking links) | ARI or Pull | Open to connectivity partners; price-accuracy score required | W-DIST-01..03 direct · immediate | Free to hotels | Prices on the booking page must match exactly (taxes/fees) | [V r04] [Google](https://support.google.com/hotelprices/answer/10687680) | P1 |
| SiteMinder (pmsXchange / SMX) | pmsXchange (PMS ↔ SiteMinder CM); SMX (apps) | Partner agreement; certification per API | W-DIST via SiteMinder for hotels that keep SiteMinder · periodic pull (OTA_ReadRQ) or push | Quote required | Separate builds per API | [V r03/r04] [pmsXchange guide](https://developer.siteminder.com/siteminder-apis/pms-rms/introduction/pmsxchange/developer-guide), [certification](https://developer.siteminder.com/pmsxchange-api/guides/testing-and-certification) | P2 |
| RateGain, DerbySoft | Channel/connectivity switches | Partner | — | From ~US$900–1,000/month (review sites) | Chain/CRS orientation | [V2 r04] | P2 |
| Booking.com / Expedia direct | — | Connectivity partner programs, certification | — | No hub fee; large fixed cost | Re-evaluate at ~500–1,000 properties (research 04) | [V r04] | P2 |

### 5.3 POS and restaurant systems (post into Portico)

| Provider | Products | Access model | Workflows · sync | Local connector | Costs | Limitations | Evidence | Tier |
|---|---|---|---|---|---|---|---|---|
| Oracle Simphony (and MICROS legacy) | Simphony (cloud/on-premise), MICROS 3700/RES legacy | PMS interface typically via Oracle interface layer [Unconfirmed] | W-POS-01..06 · immediate | Likely for on-premise deployments [Unconfirmed] | Quote required (vendor + hotel licences) | Interface protocol and licensing unconfirmed (Q62) | [Assumption] for Maldives resorts | **P0 candidate for RS-2** (confirm via Q64) |
| Shiji Infrasys Cloud POS | Infrasys | [Unconfirmed] | W-POS-01..06 | [Unconfirmed] | Quote required | | Product existence [V r01] | P0 candidate / P1 |
| Agilysys InfoGenesis | InfoGenesis | Agilysys partner program | W-POS-01..06 | [Unconfirmed] | Quote required | NDA-gated | [V r01] | P2 |
| Small-business POS (e.g. Lightspeed, Square, Loyverse) | — | Public APIs [Unconfirmed] | W-POS-03 (posting) · periodic | No | Quote required | Guesthouse cafés usually do not room-charge [Assumption] | [Unconfirmed] | P2 |
| **Portico POS posting API** (any POS can call it) | Public API | Partner program ([ecosystem-and-developer-experience.md](ecosystem-and-developer-experience.md)) | W-POS-01..07 · immediate | Optional (via local connector for on-site POS) | Monoclay-defined | Requires POS vendor to build | Internal | **P0** (the target interface) |

### 5.4 Accounting, ERP, accounts payable, financial reporting

| Provider | Access model | Workflows · sync | Costs | Limitations | Evidence | Tier |
|---|---|---|---|---|---|---|
| **Generic journal file** (CSV/XLSX with configurable columns) | File | W-ACC-01, 02, 04 · file | None | Manual acknowledgement; never labeled live | Internal | **P0** (RS-1, RS-2) |
| Infor SunSystems | File import formats first; API [Unconfirmed] | W-ACC-01..05 · file → periodic | Quote required | Common in regional resort groups [Assumption] | [Assumption] Q64 | P1 (file profile P0 if RS-2 hotel uses it) |
| Xero | Public API, OAuth [Unconfirmed] | W-ACC-01..05 · periodic | Quote/partner terms [Unconfirmed] | — | [Unconfirmed] (developer.xero.com not reachable this session) | P1 |
| QuickBooks Online | Public API [Unconfirmed] | W-ACC-01..05 · periodic | [Unconfirmed] | — | [Unconfirmed] | P1 |
| Microsoft Dynamics 365 Business Central, Oracle NetSuite, SAP Business One | APIs [Unconfirmed] | W-ACC-01..05 | Quote required | — | [Unconfirmed] | P2 |

### 5.5 Payments (processors, terminals, links)

| Provider | Access model | Workflows · sync | Costs | Limitations | Evidence | Tier |
|---|---|---|---|---|---|---|
| **Recorded external payments** (standalone terminal, bank transfer, cash) | Internal | Payment recorded with reference; reconciled against acquirer/bank statements (file) | None | Not an integration; labeled "recorded" | Internal | **P0** (fallback for RS-1, RS-2) |
| Maldivian acquirer / gateway (e.g. bank-provided online gateway and terminals) | [Unconfirmed] | W-PAY-01..07 | Quote required | Availability, API and terms unknown | [Unconfirmed] Q2 | **P0 candidate** (blocked on Q2 research) |
| Stripe Connect (direct charges) | Public API; platform agreement | W-PAY-01..07 · immediate | Stripe pricing [not verified r04] | Availability for Maldivian legal entities believed unavailable (Q2); use only where the hotel's entity is eligible | [V r04] [charges](https://docs.stripe.com/connect/charges) | P1 |
| Adyen for Platforms | Partner/platform agreement | W-PAY-01..07 | Quote required | — | [V r04 partial] | P2 |
| Channex Payment Application API | Through hub | Charge OTA cards via Stripe without Portico touching card numbers | Quote required | Stripe availability caveat applies | [V r04] [payment app API](https://docs.channex.io/api-v.1-documentation/payment-application-api.md) | P1 |

### 5.6 Door locks, key encoders, mobile keys

| Provider | Products | Access model | Local connector | Costs | Limitations | Evidence | Tier |
|---|---|---|---|---|---|---|---|
| ASSA ABLOY Vingcard | Visionline (on-premise), Vostio (cloud) | Vendor SDK/partner program [Unconfirmed] | Visionline: **yes**; Vostio: no [Unconfirmed] | Quote required (vendor + hotel licences) | Firmware/model compatibility per hotel (operational-readiness brief §9) | Cloud PMS integration exists in the market (Mews Digital Key supports Vostio and Visionline) [V r02] [Mews Digital Key](https://www.mews.com/en/products/marketplace/mews-digital-key) | P1 (RS-2; manual alternative at P0) |
| Salto | Salto Space (on-premise), cloud offerings [Unconfirmed] | Vendor partner program [Unconfirmed] | Space: **yes** | Quote required | | Mews supports Salto Space [V r02] | P1 |
| dormakaba | Ambiance, Saflok [Unconfirmed] | [Unconfirmed] | Likely | Quote required | | [Unconfirmed] | P2 |

### 5.7 Revenue management and rate intelligence

| Provider | Workflows | Costs | Evidence | Tier |
|---|---|---|---|---|
| IDeaS G3 | W-RMS-01/02 | Quote required | [3P r03 §8.9] | P2 |
| Duetto | W-RMS-01/02 (deployment ~3.5 weeks from PMS integration, vendor) | Quote required | [V r03] [Duetto](https://www.duettocloud.com/en-us/library/3-tips-stress-free-rms-deployment) | P2 |
| Lighthouse | Rate shopping / market data | Quote required | [BK r03 §8.7] | P2 |

### 5.8 CRM, guest communications, reputation

| Provider | Workflows · sync | Costs | Limitations | Evidence | Tier |
|---|---|---|---|---|---|
| WhatsApp Business Platform (via Meta Cloud API or a provider) | W-MSG-01..04 · immediate | Per-message/conversation charges [Unconfirmed; see `docs/readiness/provider-costs.md`] | Business verification, sender approval, template approval (operational-readiness brief §14) | [Assumption] WhatsApp is a primary channel in the Maldives (Q64) | **P0** |
| Transactional email provider | W-MSG-01..03 · immediate | Usage-based [see readiness costs] | Domain authentication by hotel | Internal choice | **P0** |
| SMS provider | W-MSG-01..03 | Usage-based | Sender ID rules per country | [Unconfirmed] | P1 |
| Salesforce | W-CRM-01 | Quote required | Named by owner as integration example (D5) | D5 | P2 |
| dailypoint, ReviewPro | W-CRM-01, reputation | Quote required | | Product existence [V r01] | P2 |

### 5.9 Spa, activities, recreation, transport, procurement

| Provider | Workflows · sync | Local connector | Costs | Evidence | Tier |
|---|---|---|---|---|---|
| Book4Time (Agilysys) | W-SPA-01/02 · immediate [Unconfirmed] | No [Unconfirmed] | Quote required | Product, room-charge integrations with Agilysys systems [V r01] [Book4Time](https://www.agilysys.com/en/products/book4time/) | P1 |
| Other spa systems (e.g. SpaSoft) | W-SPA-01/02 | [Unconfirmed] | Quote required | [Unconfirmed] | P2 |
| Dive centre and excursion systems | W-SPA-01/02 or Portico activities (SM-10) | — | — | [Assumption] | P2 |
| Seaplane and domestic air operators, speedboat operators | W-TRN-01/02 · **file/email (manual)** | No | n/a | No API known [Unconfirmed] | P1 (file) |
| Procurement/stock (e.g. Oracle Materials Control, Agilysys Eatec) | W-PROC-01 · file | Possibly | Quote required | Eatec existence [V r01]; others [Unconfirmed] | P2 |

### 5.10 Fiscal, government and guest identity

| Authority / provider | Workflows · sync | Status | Evidence | Tier |
|---|---|---|---|---|
| Maldives Inland Revenue Authority (MIRA) — TGST 17% (from 1 Jul 2025), Green Tax US$12 / US$6 per person-night by property class | W-GOV-01 · file/report (data for the hotel's own return) | Rates verified; filing format and any electronic submission channel **not researched** | [V r04] [KPMG](https://kpmg.com/us/en/taxnewsflash/news/2024/11/tnf-maldives-amendments-gst-tourism-act-airport-fees-ratified.html) | **P0** (report only; `government.submit` remains blocked until a submission channel is verified and authorized) |
| Maldives guest registration / immigration reporting | W-GOV-02 | Requirement unknown | [Unconfirmed] — market matrix `docs/readiness/market-matrix.md` | P1 (research) |
| Other countries (EU fiscal, India e-invoicing, Saudi ZATCA, UAE) | W-GOV-03 | Out of first market | [V/V2 r04 §C3] | P2 |

### 5.11 Enterprise identity, analytics and data platforms

| Provider | Workflows | Costs | Evidence | Tier |
|---|---|---|---|---|
| Microsoft Entra ID, Google Workspace, Okta (SAML 2.0 / OIDC; SCIM) | W-ID-01/02 | Standards-based; no partner fee assumed [Unconfirmed] | Enterprise buyers expect SSO via SAML [V2 r04 §D4] | P1 |
| Warehouse export (object storage files; later streaming) | W-DATA-01 | Infrastructure cost | Internal | P2 |

## 6. P0 summary for a Maldives pilot

| Setup | P0 integrations (build order) | Manual alternative while not ready |
|---|---|---|
| RS-1 guesthouse | Spreadsheet/CSV import → Channex hub (Booking.com, Expedia, Agoda) → email + WhatsApp → recorded payments → journal file → MIRA return data | OTA extranets used directly (inventory risk explained); payments recorded manually |
| RS-2 resort | OPERA (5.x file / Cloud) migration extract → Channex hub → Portico POS posting API + one POS interface (chosen after Q64) → journal file profile for the resort's ERP → recorded payments / acquirer (Q2) → email + WhatsApp → MIRA return data | POS: end-of-day posting list entered manually (labeled); locks: encode in lock vendor's software; transfers: manifests by email from Portico |
| RS-3 group on OPERA Cloud | OHIP read (W-PMS-01/02/03/05/06) → OHIP room status forward (W-PMS-03 U) → OHIP streaming (RC) → email + WhatsApp | Periodic OHIP reads if streaming is not enabled for the environment (labeled "updated every N minutes") |

## 7. Unsupported actions: what happens

| Situation | Behavior |
|---|---|
| Provider has no API for a workflow | Workflow shown as "Not available with <provider>"; the manual alternative and its owner are shown during setup and in the console |
| Provider supports read but not write | Domain is `read_only`; write actions are absent with "change this in <provider>" |
| Required field not supplied (e.g. no ETA, no child ages) | Records marked `incomplete` with the missing field; dependent features degrade visibly (e.g. transfer manifest asks for the missing data) |
| Provider sends an unmapped value (new room type, new charge code) | Exchange held as a mapping exception; nothing is guessed; financial items never posted to a fallback code without review |
| Provider retires an API version | Change notice tracked as a dated vendor-required change with impact ([connection-lifecycle-and-health-spec.md](connection-lifecycle-and-health-spec.md) §6) |

## 8. Maintenance of this matrix

- Owner: Integration & Adoption lead. Reviewed monthly and whenever a provider changes status.
- Each row moves through readiness levels with evidence recorded in `docs/readiness/readiness-register.md`.
- Every **[Unconfirmed]** cell has a verification task; the first batch needs network access to vendor
  documentation hosts (blocked in this session) and discovery calls (Q64).
- A provider is added only with a named segment workflow it covers. Logos without workflows are not added.
