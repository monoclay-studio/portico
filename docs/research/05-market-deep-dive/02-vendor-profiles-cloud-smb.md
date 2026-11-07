# 02b — Cloud and SMB vendors: product evolution, packaging and APIs (2024–2026)

Extends R02 (Mews, Apaleo, Stayntouch) and R03 (Cloudbeds, SiteMinder, RoomRaccoon, Guesty, RMS and brief
profiles). Only **new or updated** facts appear here. Labels per [00-index](00-index.md).

---

## 1. Mews — from PMS to "operating system"

### 1.1 Scale, capital, acquisitions (updates R02 §2.1)

| Item | Evidence |
|---|---|
| Scale | **12,500 properties / 620,000 rooms** (Aug 2025, IDC press) [S] [IDC-PMS-2025-MEWS]; ~15,000 customers / 85 countries (Jan 2026, R02) [C: unit of count differs] |
| Analyst | **Leader, IDC MarketScape WW Hospitality PMS 2025** (first time) [S] |
| Awards | **HotelTechAwards Best PMS 2026 — third year running, HT Score 100**; Mews POS *Best Hotel Restaurant POS* [S] [HTA-2026] |
| Capital | $300m Series D at $2.5bn (Jan 2026) [S]; $100m venture credit for M&A [S] [SKIFT-MEWS-LOAN] |
| Acquisitions | Atomize (RMS), Quotelo (group quotes), Clarity (back office), **Flexkeeping** (housekeeping, Sep 2025, "13th acquisition"), **DataChat** (GenAI analytics/agents, Oct 2025); earlier HS/3 (R02) [S] [MEWS-FLEXKEEPING] [MEWS-DATACHAT] |

### 1.2 Product moves 2025–2026

- **Mews BI** launched **15 Apr 2026**, bundled for Analytics and Enterprise customers [S] — a direct answer to
  the reporting complaint (R02 §8 item 4).
- **Mews OS (Unfold 2026, Amsterdam, 27 May 2026):** five launches "completing an AI-native operating system" —
  sources list combinations of **RMS, Channel Manager, Guest Messaging, Automations, Accounts Receivable**,
  accounting and BI; **SiteMinder's distribution engine embedded natively** in Mews OS [S] [MEWS-OS-2026]
  [HOSPON-UNFOLD]. Vendor-commissioned IDC study (**n = 8 customers**): **476% three-year ROI, 4-month payback**,
  "13.7% revenue lift" [VC].
- **Agents:** stated intent to build operations agents (staffing, housekeeping) and guest agents on a unified
  semantic layer; no independent evidence of production autonomous agents yet [S] [MEWS-AGENTIC].
- **Go-live claims:** average ≈ **two months**, as little as **one week**; Roam Spokane live in **11 days**; Ligula
  Hospitality "cloned one property" to roll out others [VC] [MEWS-MIGRATE].

### 1.3 Connector API evolution in 2026 (primary, docs.mews.com changelog) [V] [MEWS-CHANGELOG-2026]

Mews ships API changes almost weekly (entries dated 25 Feb, Mar, Apr, May 11, Jul, 19 Aug, 21 Aug, 27–28 Aug,
10 Sep, 16–18 Sep, 24 Sep, 1–2 Oct, 16 Oct, 19–21 Oct, 6 Nov 2026). Themes:

| Theme | 2026 changes | Inference for Portico [I] |
|---|---|---|
| **Bulk export** | **Exports** operation (beta, restricted): asynchronous, **JSON Lines** files for `OrderItem, Payment, Reservation, Customer, Company, Bill, AvailabilityAdjustment, AvailabilityBlock, ResourceBlock` and (Apr 2026) **`LedgerEntry`** (filter by posting date); `UpdatedUtc` filter **≤180 days**, end ≥5 min in the past; download links valid **10 minutes**; one pending export per entity type; portfolio tokens supported | Mews is the easiest modern PMS to extract incrementally. Portico needs the same: an async export API with JSONL, incremental windows and a ledger export. |
| **Payments reconciliation** | *Get all payouts*, *payout transactions* (Stripe, Adyen only), **balance transactions** (charges, commissions, fees, payouts, adjustments), payout operations aligned with balance transactions; *recurring payment identification*; transaction details for alternative payments; deprecation of *Add credit card payment* | Hotels and partners demanded payout-level reconciliation (R02 fee-opacity complaints). Portico's PAY-R25 payout reconciliation is market-necessary. |
| **Policy as data** | *Payment policies and assignments* (read), **cancellation policy management** (versioned operation `ver 2026-07-31`, add/update), billing automation **payment plans GA** (card and SEPA DD only), billing automation **prepayment condition for VCCs** | Policies are becoming API-addressable objects. Portico's rate/payment policy objects must be first-class in the API. |
| **Finance documents** | **Bill reissuing** (credit a closed bill/issued invoice and carry items to a new open bill), cashier transaction type, Italian tax-exemption reasons, tax codes for dependent rates, company purchase-order numbers | Correction-by-reissue with a credit note is the accepted pattern; Portico's "corrections are new linked entries" principle matches. |
| **Inventory** | **Sell limit state** (effective limits per rate, category, time unit with sold/available), **multi-occupancy availability blocks**, `RollingReleaseOffset` clarified, restrictions moved from add/delete to **set/clear** (migration guide) | Explainable availability (INV-R28) is converging industry-wide. |
| **Guest & ops** | Single-use **guest portal links**, customer photos, message threads linked to customers, **close tasks**, deletion tracking for loyalty memberships/resources, new webhook events for deletions and product changes | Deletion events matter for mirrors (connected mode). |
| **Honesty in docs** | Removed `CheckOverbooking` and `CheckRateApplicability` parameters from *Update reservations* because they **"were never implemented … and had no effect"** (May 2026) | A documented API parameter that silently did nothing — a cautionary example for Portico's contract tests. |

## 2. Apaleo — the agent-ready headless PMS

- **Scale:** >1,700 → **>2,000 properties, 30+ countries**; customers citizenM, easyHotel, limehome, Korner,
  Miiro, numa; **Cocoon & Eckelmann** moved an 800-room portfolio (Feb 2026) [S] [APALEO-NEWS].
- **AI (primary) [V] [APALEO-AI]:** the **Apaleo MCP server** uses OAuth 2.0 and exposes **~260 tools across
  booking, finance, inventory and operations**, in **open beta with self-serve access**; an official **Claude
  plugin** bundles Apaleo "skills and standard operating procedures" on top of the MCP connector ("pull up
  arrivals, assign rooms, check availability"). MCP launched Sep 2025 ("first PMS") [S]; **Agent Hub** marketplace
  (2025) [S]; agentic task creation with **THE FLAG** in live operations; **room-allocation AI agent** with Cocoon
  (May 2026) [S] [APALEO-NEWS].
- **API limits [V] [APALEO-RATELIMIT]:** global **3,500 requests/minute**, ~100 rps average, bursts to 200 rps per
  client and account; per-resource limits (e.g. 20 PATCHes per booking per 5 min); business-critical offer
  endpoints exempt from throttling on live accounts.
- **Pricing:** €8 per room per month with a **€400 monthly minimum** per property (third-party citing Apaleo's
  page; one aggregator says €400/year) [3P] [C] [APALEO-PRICE-3P].
- **Delivery:** citizenM migrated all properties in 18 cities in ~8 weeks (trade press) [S]; Valk Exclusief
  migrated from IDPMS with a **custom migration by Omniboost** (2025 pilot) [S] [OMNIBOOST-VALK].

## 3. Cloudbeds — data-model AI on an all-in-one

- **Signals** (Sep 2025): "first hospitality foundation AI model", using **causal AI**; powers revenue intelligence
  and guest marketing [S] [CB-SIGNALS]. **Ask Signals** (21 May 2026, Spring Release): conversational interface over
  reservations, revenue, channels, payments, guests, marketing; **early pilot** [S] [CB-ASK-SIGNALS]. Vendor claim
  that general LLMs contain "0.004% hospitality data" is unverified [VC].
- **Awards:** HTA 2026 *Best Hotel Management Software*; finalist PMS and channel manager [S] [HTA-2026].
- **Migration and exit (primary help-centre, via search) [S] [CB-IMPORT] [CB-CANCEL]:** the **Reservation Import
  Service is paid** and **not included in onboarding**; **cancelled and no-show reservations are not imported**;
  "data always requires some manual adjustments". On cancellation, customers must export reports first because
  **access ends at deactivation** and all third-party connections are switched off.
- **API:** v1.3 (`api.cloudbeds.com/api/v1.3/{method}`), API keys (`cbat_` prefix) preferred over OAuth (8-hour
  access, 365-day sliding refresh) per third-party guide [3P] [CB-API-3P].
- **Research marketing:** *PMS User Experience Report* with NYU Tisch professors (500 employees, 5 countries) — see
  03 §2 and 08 [S] [CB-NYU-UX].

## 4. SiteMinder (incl. Little Hotelier) — distribution layer becoming a transaction business

- FY26 numbers in 01 §4.2 (revenue A$266.1m, transaction revenue +33.8%, transaction margin 39.4%) [S].
- **Embedded in Mews OS** as the distribution engine (May 2026) [S] — the clearest case of a former competitor
  becoming a component supplier.
- **Little Hotelier pricing churn (2026)** per trackers: Basics $29–39, Pro/Revenue Optimiser $109–179; top tier
  cut $179→$109 (Feb 2026) then back to $179 with Basics dropped (Aug 2026) [3P] [C] [LH-PRICE-3P].
- **Little Hotelier export (primary help centre via search):** reservations CSV export, **max 365 days per export**;
  third-party guide claims search reaches back **548 days** and **guest details are masked 180 days after check-out**
  [S] [LH-EXPORT] [3P].

## 5. Stayntouch

- **Q1 2026: new-business revenue +75% YoY, "strongest quarter ever"** [VC] [STAYNTOUCH-Q1-2026]; *Stayntouch 2.0*
  platform (PMS, payments, booking engine, channel manager, kiosk); SHMG 500+ rooms (Apr 2026); Giri, Revival (2025)
  [S]; Academy 2.0 training (Nov 2024) [S].
- **Co-publisher of the NYU 2026 Hotel Technology Outlook** arguing for best-of-breed (01 §7) [S].
- **Migration tooling:** CSV **Dataloader** with file specifications; **test import files due one week before**
  the import date; group rooming list CSV import; Connect API with webhooks [S] [STAYNTOUCH-DATALOADER].
- **Case evidence:** FIDI Hotel (131 rooms, NYC) left Stayntouch under a new management company, suffered
  **duplicated reservations and ~2× revenue on the books** from a CRS–PMS mismatch, and **returned within two months**
  (vendor-adjacent author) [S] [3P] [FIDI-CASE].

## 6. Other SMB/regional PMS (migration-relevant facts)

| Vendor | 2024–2026 facts | Key |
|---|---|---|
| **eZee Absolute (Yanolja Cloud Solution)** | Guest database exportable to Excel (privilege-controlled); aggregator prices $23.86–$50/month, ~$2.50–5/room (estimates) [3P]; a sponsored HTR case (The Garden Inn, 220 rooms) cites legacy downtime "~6 h/week" before switching to Yanolja [VC] | [EZEE-EXPORT] [EZEE-PRICE-3P] |
| **RoomRaccoon** | Versioned **v2 REST API with webhooks, no self-serve developer portal**; access via connectivity sign-up, API key + hotel ID, **30-minute certification call** [3P] | [RR-API-3P] |
| **protel (Planet)** | API availability **contested** (aggregator says none; reviewer describes difficult integration via protel's API); protel.io marketplace mentioned [3P] [C] | [PROTEL-3P] |
| **Hotelogix** | No public API/export documentation found in this pass | — |
| **Infor HMS** | Manual Dataspy export to Excel, **≤64,000 records** (see 02a §4) | [INFOR-HMS-EXPORT] |

## 7. Patterns across cloud/SMB vendors [I]

1. **The modern PMS is converging on "OS + payments + AI on one data model"** (Mews OS, Cloudbeds Signals,
   Stayntouch 2.0). Differentiation shifts to *data trust*, *explainability* and *adoption cost*.
2. **APIs evolve weekly** (Mews) and are increasingly agent-facing (Apaleo MCP, ~260 tools). An API that is
   idempotent, previewable and permission-scoped is now a buying criterion for groups planning agents.
3. **Migration *into* these vendors is a paid or semi-manual service** (Cloudbeds paid import; Stayntouch CSV
   dataloader; Mews "semi-automated imports and manual validation"; custom partners such as Omniboost), and
   **exit** is report/CSV-based with data loss traps (no cancelled/no-show import; masking after 180 days). This is
   the white space for Portico's one-button migration (11).
4. **Price transparency remains poor** and volatile at the SMB end (Little Hotelier tier churn; Cloudbeds quote-only;
   Apaleo published but with minimums).
