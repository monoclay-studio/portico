# 02a — Enterprise vendors: how they build, ship and evolve (2024–2026)

Extends R01 (OPERA, Infor, Shiji, Agilysys concept deep dives). This file adds **primary-source evidence on
product evolution** (Oracle release readiness guides 24.2→26.4, OHIP specs), new commercial facts and the
patterns behind them. Labels per [00-index](00-index.md).

---

## 1. Oracle OPERA Cloud — release engineering, cadence and direction

### 1.1 Cadence and volume (primary data) [V] [ORA-RR-24.2…26.4]

Oracle publishes a *Release Readiness Guide* per OPERA Cloud release with a feature table (feature, scale
SMALL/LARGE, "steps needed to enable"). Parsed counts:

| Release | Published (approx.) | Features listed | LARGE-scale | Top categories by count |
|---|---|---|---|---|
| 24.2 | 2024 | 74 | 0 | Membership 20, Reservations 15, Cashiering 11, Country 10 |
| 24.3 | 2024 | 69 | 0 | Miscellaneous 21, Integration 11, Cashiering 9 |
| 24.4 | 2024 | 68 | 0 | Mobile 17, Cashiering 9, Country 9 |
| 25.1 | 2025 | **170** | 0 | Mobile 44, Reservations 25, Cashiering 20, Country 14 |
| 25.2 | 2025 | 85 | 0 | Mobile 21, Reservations 12, Cashiering 10 |
| 25.3 | 2025 | 107 | 3 | Mobile 34, Cashiering 12, Country 10, Rooms 7 |
| 25.4 | 2025 | 113 | 3 | Mobile 30, Cashiering 21, Reservations 13 |
| 25.5 | 2025 | 122 | 5 | Mobile 25, Cashiering 21, Reservations 15, Client Relations 12, Front Desk 10 |
| 26.1 | 2026 | 107 | 2 | Mobile 28, Cashiering 17, Reservations 13, Front Desk 9 |
| 26.2 | 2026 | 116 | 0 | **Property APIs 20**, Mobile 19, Reservations 17, Cashiering 14 |
| 26.3 | 2026 | 106 | 4 | Mobile 19, Cashiering 16, Country 13, Property APIs 13 |
| 26.4 | 2026-10-29 | **130** | 3 | **Reservations 32**, Property APIs 20, Cashiering 19, Mobile 11 |

**What this shows.**
- **Five releases in 2025 (25.1–25.5), four so far in 2026**, each with ~70–170 listed items — roughly
  **1,270 listed changes in 12 releases** [V]. Most are SMALL; only ~20 LARGE in two years.
- **"Steps needed to enable"**: many features ship *disabled* behind **OPERA Controls** that each property
  switches on [V]. This is Oracle's release-safety mechanism (and a reason configuration feels heavy).
- **Cashiering & financials** is a top-3 category in every release; **country-specific** (fiscal/statutory)
  items appear every release (Poland, Portugal SAF-T, Italy e-invoice, Spain police exports, France archives,
  Germany eStatistik, Angola SAF-T, Philippines BIR, Bahrain statistics, Sweden statistics…) [V]. *This is the
  compliance treadmill Portico's country packs must match.*
- **Mobile** (OPERA Cloud Mobile + housekeeping APIs) is the largest category in 8 of 12 releases [V].
- From **26.2** Oracle lists **Property API** changes as their own category (20 in 26.2 and 26.4) [V] —
  APIs are now release-managed like UI.

### 1.2 Notable capability additions by theme (primary) [V]

| Theme | Release → feature | Why it matters to Portico [I] |
|---|---|---|
| **Payments & PCI** | 24.2 *Pay By Link for Deposit Requests*; 24.3 *Pay By Link Payment Status Check*; 25.1 *Batch Credit Card Authorization for Arrivals*, *Externally Processed Credit Card Payments*; 25.3 *Chip and PIN controls*, *Credit Card Custom Token Provider*, **OPI Cloud Token Proxy Service**; 26.1 *Automatic Payment Status Check Interval for Pay By Link*; 26.2 *Credit Card Surcharge by PSP*, *Credit Card Wallet on Shared Profiles*; 26.3 *Pay by Link for Batch Deposits*; 26.4 *Auto-transfer VCC payment method*, *External System Credit Card Token Validation*, *External tokens automatically stored in wallet*, *Days to Purge Credit Cards*, *Pre-Authorization Days* | OPERA spent two years catching up on payment-link status polling and VCC handling that Mews automated earlier (R02). Portico's collection plans (PAY-R20) already exceed this; keep "status check" explicit as *pending verification*. |
| **Policies** | 25.1 *Auto Cancellation Penalty Posting and Settlement*, *Auto Mass Cancellation*; 25.4 **Tiered Cancel Penalty and Tiered Deposit Rule Schedules** (multiple dated penalties; percentage tiers ≤100%; highest penalty prevails) | Tiered, dated schedules are now table stakes at the top end. Portico rate/payment schedules must support tiers with an explicit "which rule wins" explanation. |
| **Distribution/RM** | 25.4 **Hurdle Rates Evaluation for Restriction Publication** (automatic FPLOS to channels; most restrictive of hurdle-based vs configured) | OPERA now generates FPLOS from hurdles for direct OTA connections. Portico's distribution and rates should accept FPLOS from an RMS and explain the resulting restriction. |
| **Revenue recognition / finance** | 26.2 *Revenue Recognition Method OPERA Control*, *Summarized Transaction View in Billing*, *Sequence for End of Day Final Reports*; 26.1 **Download Archive for Folios and End of Day reports** (needs *OPERA Cloud Archive Solution* subscription); 26.4 *NEW FOLIO business event for interim/advance/checkout bills*, *PRO_FORMA_FOLIO_VIA_API*, *Do not recalculate generates for full credit bill* | Archive and folio history are a **separately sold** capability (OCAS). Portico should include retrievable history and a historical archive (glossary) without upsell. |
| **Packages** | 25.1 *Package Pricing Per Days of Week*, *UDF Generate Function*; 26.2 *Package Postings Display*, *Rate Code Package Configuration*; 26.4 **Price by Age Category for Packages**, *Rate Code and Included Package Validation* | Age-banded package pricing matters for Maldives meal plans (adults/children/infants). |
| **Front desk / guest** | 26.2 *Create Room Keys for Multiple Interfaces*, *Partial Keys Failure Handling*, *Pre-Arrivals Screen*; 26.3 **Address Auto-Suggestion and Validation** (LARGE); 26.4 **Digital Registration** (LARGE: configurable e-forms with matching rules by market, source, rate category, room type, membership, reservation type, **nationality**; guest e-sign; purge-after-days), *eSign Registration Card for Accompanying Guests* | Digital registration with nationality-based templates is exactly the Maldives immigration/registration need (Q43). Portico should treat it as core guest-experience, not add-on. |
| **Operations** | 25.3 **Task Sheet Completion**, *HSK TaskSheet APIs* (LARGE); 26.4 **Service Order Management** (LARGE: one workflow for guest and internal requests; priorities, skills, resource groups, follow-up tasks auto-created; Grid/Board views; mobile with photos) | Oracle is building the task/work-order model Flexkeeping/Optii sold separately. Portico's operations module must match: skills, follow-ups, board view, photo evidence. |
| **Resort/leisure** | 26.4 **Leisure Management** (LARGE; spa treatments, children's activities, rentals, tours, cabanas, classes; locations, categories, resources, pricing, schedules) + **LMS/LMSCFG APIs** | Direct entry into Agilysys' "connected resort" (R01 §6) and Portico's resort module (D11). Maldives resorts on OPERA will get this "free" in their subscription — Portico's resort itinerary must be *better*, not just present. |
| **Central/portfolio** | 26.2 *Inventory and Rate Availability Consolidated Screen* (CENTRAL); 26.4 *Rate Code Booking Limit* (CENTRAL) | Central (CRS-like) features are a separate subscription badge. |
| **Upsell** | 26.4 *Nor1 upgrade check-in workflow on Mobile* (PRiME offers at check-in) | Upsell embedded in check-in on mobile (Stayntouch-style). |

### 1.3 Oracle's AI trajectory (primary + press)

| Date | Feature | Behaviour | Label |
|---|---|---|---|
| 25.4 | *AI Code Description Translation* | GenAI translation of configuration code descriptions | [V] |
| 25.5 | *Generative AI for Distribution Rate Descriptions* (LARGE) | Generates channel rate text from rate long description, package attributes, channel type; preview/edit/accept | [V] |
| 25.5 | **AI Room Search** | Reads reservation **notes**, extracts features matching configured room features (e.g. "beach view" → BEACH) and adds them at room assignment, **with an explanation of why** | [V] |
| 26.4 | *AI Reservation Summary at Check In* | Concise summary (name, membership, VIP, previous stay, requests) on the check-in screen | [V] |
| 26.4 | *AI Booking Suggestions* | AI profile summary and package suggestions from past/future stays | [V] |
| 26.4 | *AI Room Types Description Assistant* (+ "regenerate on config change" prompt with preview) | Long descriptions from room features | [V] |
| 26.4 | *AI Assistant for Rate Code Long Information* | Rate text generation | [V] |
| Jun 2026 | **OPERA Cloud Assistant** — AI room assignments, rate descriptions, multilingual translation, natural-language staff guidance; **no additional cost** | [S] [ORA-AI-2026] |
| 2026 | *Oracle AI Agent Studio for Industry Applications* (customers build own agents) | [S] [ORA-AI-2026] |

**Pattern [I].** Oracle's AI is **assistive, embedded, opt-in per property, always previewable, and free** —
low-risk text generation and extraction at points of work, not autonomous action. Note the explicit
*explanation text* when AI adds a room feature. This sets the market's minimum: Portico AI must be at least
embedded, explainable and included.

### 1.4 OHIP as it actually is (primary) [V] [OHIP-SPECS-26.3] [OHIP-UG]

- **Surface:** public OpenAPI specs (GitHub `oracle/hospitality-api-docs`, property APIs **v26.3.0.0**):
  **45 modules, 3,580 operations** (GET-heavy configuration modules such as `lov` 453 ops, `fofcfg` 369, `crmcfg`
  322, `entcfg` 246; business modules `csh` 196, `rsv` 184, `crm` 168, `rtp` 144, `blk` 93, `ars` 62, `hsk` 60,
  `lms` 46). The 2021 datasheet said "over 3,100 available APIs" [V] [OHIP-DS].
- **Throttling:** up to **50 requests/second per gateway**, short burst to **100**, shared by *all* consumers of that
  gateway; above burst → HTTP 429. Max **100 applications** per developer portal; **8 KB** total header size.
- **Streaming:** only **one consuming client per chain per gateway per application key**; consumers must reconnect at
  least every **24 hours** or resume with an offset; ≥10 s between close and re-subscribe; stream-management requests
  limited to **12/minute** (bursts to 100/min).
- **Synchronous reservation search** returns **at most 1,000 records even with pagination** (Oracle FAQ) — bulk work
  must use **asynchronous ("jobbed") APIs**: POST → HEAD (poll, ≤1/min, honour `retry-after`) → GET; results kept
  **6 hours** and only retrievable once; **identical requests need 30-minute spacing**; **>2 MB requests are
  truncated**; reservation daily summary windows ≤ **94 days**; last-modified windows ≤ **3 days** with 3-hour spacing
  for identical requests; inventory statistics ≤ **365/400 days**; block allocation ≤ 94 days; financial postings
  with net-VAT breakdown ≤ **15 days per reservation** (25.1+); profile **stay-record import** async (24.2+); rooming
  lists async (24.1+).
- **Data APIs** (bulk, from Reporting & Analytics subject areas, to avoid load on the transactional system) require
  the **hotel to buy an R&A Data Access add-on SKU**; partners pay per call unless covered by that SKU.
- **Access model:** partner requests a connection in the partner portal; **hotel chain administrators approve** in the
  customer portal; with *Module Level Access Control*, requests list modules, functional areas and **Sensitive Data
  Access** (ID numbers, dates of birth) — any later change needs re-approval. Customers on OCIM can create **their own
  client applications** ("multiple clients for different integration needs"); **OPERA Cloud Foundation includes
  OHIP access** for the hotel.
- **Commercials:** partners pay per call (R01: ~$10/10,000 calls) [S]; Oracle's 2021 slides: "customers don't pay,
  vendors pay per call" [S] [OHIP-PRICING-S].

*Why this matters:* these limits define how fast anyone (including Portico) can extract an OPERA Cloud
property — see [11-one-button-migration.md](11-one-button-migration.md) §3.

### 1.5 Commercial and delivery facts 2025–2026

- **Wins/rollouts:** Wyndham >2,100 properties on OPERA Cloud; Minor Hotels 106 properties in 59 countries
  (rollout began 2023 at Anantara Siam Bangkok; completed Aug 2026; OPERA Cloud Central added; ANZ next) [S]
  [MINOR-ORA-2026]; Motel One 100+ hotels, 13 countries, with **Oracle Managed Services** for monitoring,
  maintenance and incident management (selected Q2 FY26) [S] [MOTELONE-ORA-2026]; Omni (Mar 2025, OPERA Cloud
  Central), Resorts World Las Vegas (2025) [S]; Cinnamon Hotels (John Keells) — OPERA Cloud PMS, S&EM and
  **Simphony POS** with three **Maldives** resorts first (Dhonveli, Velifushi, Hakuraa Huraa) [S] [CINNAMON-ORA].
- **Pricing:** still unpublished. OPERA R&A licensing parts priced *per guest room* (B89705) or *per property for
  200+ rooms* (B89706) [S] [ORA-RNA-LIC]; third-party estimates $12–18 or $15–60/room/month [3P] (R01).
- **Packaging:** badges in release notes reveal the SKU map — *Sales & Event Management Premium*, *Casino & Gaming
  add-on*, *Loyalty*, *Central Management Services*, *Distribution Channel Cloud Services*, *Archive Solution*,
  *R&A Data Access* [V].

## 2. Agilysys — the chain-scale challenger

- FY26: revenue **$319.3m (+15.9%)**, subscription **+30.2%**, FY27 guide $365–370m; PMS recurring to overtake POS
  recurring in FY27; **>1,000 Marriott properties live** [S] [AGYS-FY26] [AGYS-NASDAQ-2026].
- Strategy: one vendor for PMS + POS + spa/activities (Book4Time $150m, 2024) + payments (Shift4 partnership since
  2020) [S]. Confirms R01 §6; the new fact is **scale at Marriott**, which validates cloud-native challengers for
  chain-mandated deployments.
- APIs: "standards-based PMS with a RESTful API for partners" [S]; partner/NDA gating per R01 §6.4.

## 3. Shiji Group (Daylight PMS, Infrasys POS, ReviewPro, Horizon distribution)

- 2025: Daylight PMS in **35 countries** incl. US, UK, China; Marriott and Amadeus partnerships; **Infrasys POS in
  60+ countries, ~80% of China's upscale market** (board message) [S] [SHIJI-2026].
- 2026: Pakistan's first Daylight deployment (Pearl Continental Rawalpindi, Feb); Bangkok RakYim Siam on Daylight
  + Infrasys + ReviewPro (May); **100+ hotel rollout for one group in two months** (May); **JUFA 61 hotels** with
  Amadeus iHotelier (Jun); **AI·R** "AI-first platform" (May); Kismet partnership for AI discovery/direct booking
  via Horizon (May); US head of sales hired (Jun) [S] [SHIJI-2026] [SHIJI-AIR].
- *Inference:* Shiji's playbook is **migration velocity + full stack in APAC/EMEA**; it is the most likely
  enterprise competitor in South Asia and the Indian Ocean after Oracle.

## 4. Infor HMS

- No significant new 2025–2026 commercial evidence surfaced in this pass [S].
- Documentation shows the **standard export path is manual**: run a *Dataspy* query and export to Excel, **max
  64,000 records per export** [S] [INFOR-HMS-EXPORT]; third-party connectors (e.g. skyData) expose reservation
  entities [S]. Relevant to migration (11).

## 5. Amadeus Hospitality, SynXis (TPG) and Access Group

- **Amadeus:** expanded **Delphi** (sales & catering) with **Accor's premium and luxury brands**; Demand360 and
  MeetingBroker AI enhancements; at HITEC 2026 promoted tools to make hotels **bookable by AI agents** [S]
  [AMADEUS-ACCOR] [ORA-AI-2026]. No divestiture found.
- **SynXis (ex-Sabre Hospitality Solutions):** sold to **TPG for $1.1bn**, closed 7 Jul 2025; now standalone [S]
  [SABRE-TPG]. SynXis documents an HTNG-based *PMS Reservation Sync* (`OTA_HotelResNotifRQ`) [S] [SYNXIS-HTNG].
- **Access Group:** Guestline PMS (~3,000 properties) + SHR CRS/IBE/CRM/RMS (~2,000 hotels) under HgCapital/TA/GIC
  ownership [S] [ACCESS-SHR].

## 6. Cross-vendor patterns in how enterprise vendors build and ship [I]

1. **Opt-in feature delivery** (OPERA Controls) is the dominant release-safety pattern — safe, but it multiplies
   configuration states. Portico's alternative (release rings + per-tenant flags + defaults that are on and
   previewed) must still give properties a way to *defer* behaviour changes.
2. **Statutory/fiscal work is continuous** (every OPERA release). A country pack is a product line with its own
   release train, not a one-off.
3. **APIs are versioned with the product** (OHIP specs v26.3), with async bulk paths and hard limits — evidence that
   bulk extraction is a *designed* capability, not an afterthought; Portico should publish equivalent bulk export
   (and import) APIs from day one so it is the *easiest* system to leave and to join.
4. **AI is embedded and included**, not sold as a separate product, at the top of the market.
5. **Enterprise vendors are absorbing adjacent categories** (Oracle: leisure, service orders, digital registration;
   Agilysys: spa; Shiji: POS/reputation) — the boundary between PMS and "connected stack" is moving toward the PMS.
