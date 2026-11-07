# 01 — Market structure, capital and consolidation (2024–2026)

Builds on R04 §D1–D3 (market-size table, vendor landscape, pricing bands). Labels per [00-index](00-index.md).
Bibliography keys in square brackets resolve in [10-bibliography.md](10-bibliography.md).

---

## 1. How big is the market, really? (unresolved)

R04 §D1 already lists four PMS market-size estimates spanning **$1.22bn–$3.8bn for 2025**. New evidence does not
resolve the spread; it widens it.

| Source | Claim | Note |
|---|---|---|
| GMI | $3.8bn (2025) → $8.5bn (2034), 9.2% CAGR; cloud **>80%** share | [S] [GMI-PMS]; already in R04 |
| Superscout | ~$2.5bn (2025); cloud **65%** | [S] [SUPERSCOUT]; contradicts GMI's cloud share [C] |
| LP Information | **Top five vendors ≈ 20%** of revenue | [S] [LPI-PMS] — the clearest concentration figure found |
| The Business Research Company | Oracle Hospitality (OPERA) "led global sales in 2024 with **3%** share" | [S] [TBRC-HOTELDIGITAL] — measured against a broad "hotel digital" market, **not** a PMS share [C] |
| IDC MarketScape WW Hospitality PMS 2025 (doc #US52038025, Aug 2025) | **9 vendors** assessed; **Oracle** (2nd time) and **Mews** (1st time) named Leaders | [S] [IDC-PMS-2025-ORA] [IDC-PMS-2025-MEWS]; placement of the other seven not public in what we could read |
| Getlatka / aggregator | Cloudbeds revenue ~$84.8m (2024), ~$57m (2023) | [3P] [LATKA-CB]; Zeliq says ~$25m [C] |
| Trade analysis | Mews ~$85m revenue (2024) | [3P] [HT-RETHINK]; unverified |

**Interpretation [I].** The PMS licence pool is small (low single-digit billions) and **fragmented** (top-5
≈ 20%). The money is in (a) payments and other transaction revenue (SiteMinder §6), (b) chain-wide platform
deals (Marriott/Agilysys, Wyndham/IHG/Minor/Motel One on OPERA Cloud), and (c) adjacent intelligence and
marketing (Lighthouse, RateGain+Sojern). A Portico business case should never rest on "PMS market size"; it
should rest on per-property economics (subscription + payments + modules) and migration velocity.

## 2. Segments and who is winning them (2024–2026 evidence)

| Segment | Who decides | 2024–2026 movement | Evidence |
|---|---|---|---|
| **Global chains (brand-managed and franchised)** | Brand IT; mandated or certified PMS lists | Marriott replacing proprietary PMSs with **Agilysys** in US/Canada (deal Dec 2022; **>1,000 properties live** per CEO citing Marriott); IHG approved **OPERA Cloud as optional** (Jan 2026, R01); **Wyndham >2,100** on OPERA Cloud (Jun 2026); Choice renewed **Shift4** payments 5 years (2026) | [S] [AGYS-NASDAQ-2026] [ORA-AI-2026] [SHIFT4-Q1-2026]; R01 §2.1 |
| **Regional/management groups (50–150 hotels)** | Group CIO | Large OPERA Cloud migrations completed: **Minor Hotels 106 properties / 59 countries** (completed Aug 2026, start 2023); **Motel One 100+ hotels / 13 countries** (Mar 2026); **JUFA 61 hotels** chose **Shiji Daylight + Amadeus iHotelier** (Jun 2026); Shiji claims **100+ hotel rollout for one group in two months** (May 2026) | [S] [MINOR-ORA-2026] [MOTELONE-ORA-2026] [SHIJI-2026] |
| **Upscale independents and resorts** | Owner/GM + finance | OPERA still default for complex resorts; Oracle shipped **Leisure Management** (spa, kids' club, rentals, tours, cabanas) in **26.4** to close the "connected resort" gap Agilysys owned | [V] [ORA-RR-26.4] |
| **Independents and small groups (10–200 rooms)** | Owner | Mews (HTA Best PMS 3 years running), Cloudbeds, Apaleo, RoomRaccoon, Little Hotelier compete; all-in-one vs best-of-breed debate (§7) | [S] [HTA-2026] |
| **Hostels, apartments, alternative accommodation** | Operator | Mews (hostel BI planned), Cloudbeds, Apaleo (citizenM, limehome, numa); short-term-rental PMS (Guesty, Hostaway) per R03 | R02, R03 |

## 3. Capital flows 2024–2026

### 3.1 Funding indices (Abode Worldwide)

| Period | Total | Category leaders | Notes |
|---|---|---|---|
| Dec 2023 – Apr 2025 | — | **Revenue tech $480m+** overtook **PMS $375m** for the first time; Mews ≈ **$290m of the PMS total** across three rounds incl. a €101m round; RoomPriceGenie **$75m**; Smartness €13m | [S] [ABODE-2025] |
| Apr 2025 – Mar 2026 | **>$1bn across 40 companies** | **PMS first: 7 companies, $408.1m** (incl. Amenitiz, Arbio, Boom; Mews $300m largest); AI-led guest experience (Duve, Chatlyn, Conduit, Canary) **$152.6m**; ~half of companies at pre-seed–Series A; >half founded after 2020 | [S] [ABODE-2026] [ABODE-2026-HD] |

**Conflict [C].** The two Abode windows overlap differently and must not be summed. A Romanian outlet quotes
~€850m for the second window (currency basis) [S].

### 3.2 Notable rounds

| Company | Round | Date | Amount / valuation | Stated use | Key |
|---|---|---|---|---|---|
| Mews | Series D (EQT Growth; Atomico, HarbourVest new) | Jan 2026 | **$300m at $2.5bn** | AI agents, payments (R02) | [S] [MEWS-SERIES-D] |
| Mews | Venture credit | 2024–25 | $100m for M&A ("market is ripe for consolidation") | Acquisitions | [S] [SKIFT-MEWS-LOAN] |
| Lighthouse (ex-OTA Insight) | Growth (KKR NGT III) | Nov 2024 | **~$370m, >$1bn valuation**; 70,000 hotels, 185 countries, 700+ staff | Product, **acquisitions**, expansion | [S] [LIGHTHOUSE-KKR] |
| Canary Technologies | Series D (Brighton Park) | Jun 2025 | **$80m, ~$600m valuation**; 20,000+ properties, 100+ countries | AI Voice, Webchat, global | [S] [CANARY-SERIES-D] |
| Apaleo | Growth (PSG) | late 2024 | €20m; total ~$31–32m | Groups in Europe | [S] [APALEO-PSG] |
| RoomPriceGenie | Growth | 2024–25 | $75m | RMS for small hotels | [S] [ABODE-2025] |
| Cloudbeds | Series D (SoftBank VF2) | earlier | $150m; total $248–275m [C] | — | [S] [CB-SERIES-D] |

### 3.3 M&A timeline (hotel operations stack)

| Date | Acquirer → target | Value | Category | Significance [I] | Key |
|---|---|---|---|---|---|
| Jul 2023 | Access Group → Guestline (from Riverside) | n/d | PMS (UK/EU, ~3,000 properties) | PE-backed suite roll-up | [S] [ACCESS-SHR] |
| Jun 2024 | Access Group → SHR (Sceptre) from Serent | n/d | CRS, IBE, CRM, RMS (~2,000 hotels) | PMS + CRS bundle in one group | [S] [ACCESS-SHR] |
| 2024 | Agilysys → Book4Time | **$150m** | Spa/activity booking | Connected-resort depth (R01 §6) | [S] [HI-2024-REVIEW] |
| 2024 | GrowthCurve Capital → Duetto | n/d | RMS | RMS consolidation under PE | [S] [HI-2024-REVIEW] |
| Oct 2024 | Cendyn → Knowland | n/d | Group-demand data | Sales intelligence | [S] [CENDYN-KNOWLAND] |
| Nov 2024 | Mews → Atomize | n/d | RMS → "Mews RMS" | PMS absorbs RMS | R02; [S] [ABODE-2025] |
| late 2024 | Mews → Quotelo | n/d | Group quotes | Groups gap | [S] [ABODE-2025] |
| Jan 2025 | Mews → Clarity Hospitality Software | n/d | (Clarity: back-office/accounting, UK) [S] | Finance/back office | [S] [MERGR-CLARITY] |
| Apr→Jul 2025 | **Sabre → TPG: Hospitality Solutions (SynXis CRS etc.)** | **$1.1bn** (≈$960m net) | CRS/distribution | Largest CRS now standalone PE-owned | [S] [SABRE-TPG] |
| Sep 2025 | Mews → **Flexkeeping** ("Mews' 13th acquisition", Axios) | n/d | Housekeeping/ops | PMS absorbs ops apps | [S] [MEWS-FLEXKEEPING] |
| Oct 2025 | Mews → **DataChat** (no-code GenAI analytics) | n/d | AI analytics/agents | Foundation for agents | [S] [MEWS-DATACHAT] |
| Sep→Nov 2025 | **RateGain → Sojern** | **$250m**; Sojern 2024 revenue **$172.2m** | Marketing/ads | Creates a ~$310m+ revenue "marketing + revenue" platform | [S] [RATEGAIN-SOJERN] |
| 2026 | Revinate (3 acquisitions noted, Apr 2026 — details unread) | n/d | CRM/marketing | — | [S] [REVINATE-2026] |
| Jun 2026 | Unnamed guest-experience merger (competitors cited: Duve, HiJiffy) | n/d | Guest apps/messaging | Category consolidation | [S] [GX-MERGER-2026] |

No evidence was found of an Amadeus Hospitality divestment in 2025–2026; Amadeus instead expanded Delphi with
Accor's premium/luxury brands [S] [AMADEUS-ACCOR].

## 4. Public-company signals (hard numbers)

### 4.1 Agilysys (FY ends 31 March) [S] [AGYS-FY26]

- FY2026 revenue **$319.3m (+15.9%)**; **subscription revenue +30.2%**; Q4 revenue $82.9m (+11.7%), Q4 subscription
  +24.1%; adjusted EBITDA **$67.7m**; free cash flow **$68.1m**.
- FY2027 guidance **$365–370m**, subscription growth **≥30%** (third straight year), adjusted EBITDA **24%** of revenue.
- CEO: **PMS recurring revenue expected to exceed POS recurring revenue for the first time** in FY27; **>1,000
  Marriott properties live** (citing Marriott) [S] [AGYS-NASDAQ-2026].
- Earlier guidance **excluded** the large PMS project from subscription growth [S] — i.e. the Marriott ramp is upside.

### 4.2 SiteMinder (FY ends 30 June; A$) [S] [SDR-FY26] [FOOL-SDR-FY26]

- Revenue **$266.1m (+22% constant currency, organic)**; ARR **$313.7m (+24.1% cc)**; adjusted EBITDA **$28.1m (+96%)**.
- **Transaction revenue $110.9m (+33.8% cc)**; **transaction ARR $144.3m** (+26.5% reported, +37.1% cc);
  transaction products adopted **45.4k (+29.7%)**; **adjusted transaction gross margin 39.4%** (FY24: 32%).
- Channels Plus hotel count **+43%**; Dynamic Revenue Plus billings more than doubled Q-on-Q (AGM, Oct 2026).
- Outlook: ARR compound growth "in the 20s" to FY30. 56,000 hotel customers (R03).
- **Conflict [C]:** one broker note calls $110.9m "transaction ARR"; the release is authoritative.

### 4.3 Shift4 (payments) [S] [SHIFT4-Q1-2026] [SHIFT4-Q3-2026]

- CEO: "clearly number-one in hospitality payments in the world" [VC]; Q3 2026 gross revenue less network fees
  **$648m (+10%)**; payments-based revenue less network fees $402m (+18%); 5-year **Choice Hotels** renewal; hotel
  wins via the Eigen acquisition (Pechanga, Lotte New York Palace).

## 5. Structural forces (what is changing the shape of the market)

1. **Platformisation under an "operating system" banner.** Mews launched **Mews OS** (May 2026) unifying PMS, RMS,
   channel manager (SiteMinder engine embedded), guest messaging, automations and AR "on a single data model"
   [S] [MEWS-OS-2026]; Shiji announced **AI·R**, an "AI-first platform" (May 2026) [S] [SHIJI-AIR]; Cloudbeds
   positions **Signals** as a hospitality "foundation model" (Sep 2025) [S] [CB-SIGNALS]. *Inference:* the
   competitive unit is no longer "PMS" but "operating data model + automation + payments".
2. **Payments and transactions as the profit engine.** SiteMinder transaction margin rising (32%→39.4%), Mews'
   Series D earmarked for payments, Shift4's hospitality push (§4). Confirms R03 §1 item 2 with FY26 numbers.
3. **AI as funding narrative and free feature.** Oracle made **OPERA Cloud Assistant free** to all OPERA Cloud
   customers (Jun 2026) — "giving away the AI its rivals want to sell" [S] [ORA-AI-2026] [HT-ORA-FREE]. This
   compresses any AI-upsell pricing strategy (see 06).
4. **Chain-led cloud migration waves.** Wyndham, Minor, Motel One, Omni, Resorts World Las Vegas (2025) on OPERA
   Cloud; Marriott on Agilysys. OPERA 5.x support horizon (5.6 Premier Support reported to Dec 2027, **unverified**
   [3P]) forces decisions in 2026–2027 — **a migration window Portico can target** (see 11).
5. **PE roll-ups of adjacent categories.** Access (Guestline+SHR), TPG (SynXis), GrowthCurve (Duetto), KKR
   (Lighthouse), Serent (Revinate), RateGain+Sojern. Suites assembled by acquisition historically integrate poorly
   (R03 protel/Planet complaints) [I].
6. **Best-of-breed vs all-in-one is unresolved** — see §7.
7. **Agentic distribution.** OpenAI apps with Booking.com and Expedia (Oct 2025); Google AI Mode hotel booking with
   OTAs and chains (Nov 2025 →) — hotels or OTAs remain merchant [S] [GOOGLE-AIMODE] (details in 05).

## 6. Distribution economics context

- OTA commissions commonly quoted at **15–30%**, effective cost higher once programme fees and promotions are
  included [3P] [HO-OTA-COST-2026]; HOTREC *European Hotel Distribution Study 2024*: **rate undercutting affects four
  in ten European hotels** [S] [HOTREC-2024].
- Kalibri Labs' older finding (≈2015): customer-acquisition cost growing about **twice as fast as revenue**;
  digital distribution ≈ 5.4% of lodging revenue [S] [KALIBRI-TW]. No 2024–2026 update found.
- Regulatory: Booking.com designated a **DMA gatekeeper** (May 2024) — may not use wide or narrow parity clauses
  in the EU; CJEU **C-264/23 (19 Sep 2024)**: parity clauses are not "ancillary restraints" [S] [CJEU-C264-23]
  (academic evidence in 03 §6).

## 7. The best-of-breed vs all-in-one debate (evidence and sponsorship)

| Position | Evidence | Sponsorship / caveat |
|---|---|---|
| **Best-of-breed is winning** | NYU SPS Tisch Center *2026 Hotel Technology Outlook*: "clear shift" to best-in-class integrated systems; 300+ respondents; **38% cite integration as a top pain point**; specialised users 70% satisfied with PMS, 59% with RMS; **51% plan to replace/upgrade within 12–24 months** | Co-published with **Stayntouch and IDeaS** (best-of-breed vendors) [S] [NYU-2026] |
| **All-in-one / OS is winning** | Mews OS, Cloudbeds Signals, Shiji AI·R; Mews' IDC study (n=8) claims **476% 3-year ROI, 4-month payback** | Vendor-commissioned; tiny sample [S] [MEWS-OS-2026] |
| **Both** | 38% integration pain point is consistent with both: integration pain motivates either fewer systems or better integration | [I] |

**Implication for Portico [I].** Portico's architecture (native core modules + connected mode + adoption ramp)
lets it sell *both* positions honestly: a full suite for those who want one bill, and standalone modules in
connected mode for those keeping best-of-breed. The differentiator is not the stance but **integration that
staff can see and recover** (D7, D10 in competitive-synthesis) and **migration that is a product** (11).

## 8. Unresolved debates and conflicting evidence (market level)

1. Market size: $1.2bn–$3.8bn (2025), cloud share 65%–>80% [C].
2. Mews scale: 12,500 properties / 620k rooms (Aug 2025, IDC press) vs ~15,000 customers / 85 countries (Jan 2026,
   R02) — consistent with growth or with different counting units (property vs customer) [C].
3. Cloudbeds headcount 650 (PitchBook 2026) vs 777 (Getlatka 2026) — possible reduction, unconfirmed [C].
4. Whether OPERA 5 end-of-support forces migration in 2027 (date unverified) [3P].
5. Whether AI can be monetised at all after Oracle's free assistant [I].
