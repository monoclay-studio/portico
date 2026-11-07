# 09 — Maldives and the Indian Ocean: market facts for the first pilot

Tax and fee rules (TGST 17% from 1 Jul 2025, green tax $12/$6, service charge open questions) are **already** in
`docs/readiness/market-matrix.md` §2, `docs/readiness/maldives-tax-rules.md` and R04 §C3 — not repeated here.
This file adds **demand, supply, segment, systems, payments, e-invoicing and macro-risk** evidence. Most figures
come from Maldivian press summarising Ministry of Tourism, MMA and World Bank releases [S]. Labels per
[00-index](00-index.md).

---

## 1. Demand

| Metric | Value | Key |
|---|---|---|
| Tourist arrivals 2024 | **2,046,615** | [S] [MV-ARRIVALS-2025] |
| Tourist arrivals 2025 | **2,246,516 (+9.8%)**; government target 2.3m missed | [S] [MV-ARRIVALS-2025] [HM-2025-ARRIVALS] |
| Record month | **December 2025: 224,455** | [S] |
| Source markets (to early Dec 2025) | China **318,032**, Russia **260,416**, UK **186,762** | [S] |
| Tourism revenue 2025 | **>$5.4bn (+15.8%)** (one summary) | [S] [C: single source] |
| Accommodation mix Q1 2025 | **69% resorts, 25% guesthouses** (of arrivals' stays) | [S] |
| Guesthouse guests | ~340,000 by Sep 2025; densest in Kaafu, Alifu Alifu, Baa, Vaavu; ~300,000 by early Sep 2026 vs ~1m at resorts | [S] [MV-GH-2025] [MV-BEDS-2026] |
| Occupancy Jan–Jul 2025 | **Guesthouses 43.2%** (34.3% a year earlier) vs **resorts 69.5%** (MMA) | [S] [MV-OCC-2025] |
| Occupancy Mar 2026 | **57% overall** vs 65% a year earlier (capacity grew); guesthouse bed-nights still rising | [S] [MV-OCC-2026] |

## 2. Supply (registered vs operational — figures differ by date and definition) [C]

| Snapshot | Resorts | Guesthouses | Total beds | Key |
|---|---|---|---|---|
| **Tourism Yearbook 2025 (Ministry)** | **183 resorts / 44,689 beds** (68.5% of capacity) | **920 / 15,491 beds** | **65,286** | [S] [MV-YEARBOOK-2025] |
| Mid-May 2025 | — | — | 64,926 operational; 1,193 registered facilities | [S] |
| Late 2025 | 175 resorts | 890 guesthouses (+158 safari vessels, 16 hotels; 1,239 facilities) | 66,025 registered | [S] |
| Year-end 2025 | 186 resorts (6 new) | 15,494–15,621 guesthouse beds | **67,475** (or 68,244 "in service") | [S] [MV-BEDS-2025] |
| Guesthouse beds trend | 13,609 (2023) → 15,621 (end 2024) | | | [S] |

**Segment reading [I].**
- **Resorts (~180–186, ~45k beds):** island-scale operations (transfers, F&B, activities, utilities), mostly
  international group brands or management companies; OPERA (often with Simphony POS) is the expected incumbent
  (e.g. Cinnamon's three Maldives resorts on OPERA Cloud + Simphony; Minor/Anantara group on OPERA Cloud) [S].
- **Guesthouses (~900, ~15k beds, avg ~17 beds):** small, owner-operated on local islands, OTA-dependent, growing
  faster in occupancy than resorts; cheap SMB PMS/channel managers or spreadsheets; local products are thin
  (MaldivesforYou channel manager with no reviews; "DhivehiStay" exists only as an idea write-up) [3P] [MV-GH-TECH].
- **Safari vessels (~158) and city hotels (~16):** niche; vessel operations resemble resorts with moving inventory.

## 3. Systems in use (evidence available)

| Evidence | Implication [I] | Key |
|---|---|---|
| Cinnamon Hotels: OPERA Cloud PMS + S&EM + **Simphony POS**; **Dhonveli, Velifushi, Hakuraa Huraa** first | Resort migrations from OPERA must carry POS integration (Simphony) on day one | [S] [CINNAMON-ORA] |
| Minor Hotels: 106 properties on OPERA Cloud incl. Central | Anantara/Avani Maldives resorts are likely on OPERA Cloud already (not verified per property) | [S] [MINOR-ORA-2026] |
| IHG: OPERA Cloud optional (Jan 2026) | IHG Maldives resorts may move PMS in 2026–2028 | R01 |
| Marriott → Agilysys rollout is **US/Canada** | Marriott Maldives resorts not covered by that programme | [S] |
| OPERA 5.6 Premier Support reported to end Dec 2027 [3P, unverified] | On-prem OPERA 5 resorts face a decision window 2026–2027 | [3P] [O5-SUPPORT-3P] |
| Hotelier Maldives profiles mention OPERA operations roles at island resorts | Local OPERA-trained labour pool exists | [S] |

**Unknown (Q64 already open):** the actual mix of PMS, POS, channel managers and accounting tools across Maldivian
resorts and guesthouses — no survey found. Discovery interviews remain essential.

## 4. Macro and risk

- World Bank (Jun 2026): **growth 6.3% in 2025 → −0.7% in 2026** due to tourism disruption linked to **Middle East
  conflict**, higher fuel prices and tighter financing; public debt **129.7% of GDP (2025)**, could exceed **140%**;
  ~**$600m** external debt service due 2026 [S] [WB-MDU-2026]. October 2025 update: fiscal deficit ~13% of GDP
  2026–27; Sovereign Development Fund liquid balance ~$80m [S] [WB-MDU-2025] [C: debt figures differ by edition].
- **Implications [I]:** (a) hotels will be cost-sensitive in 2026–2027 — migration that *reduces* cost (licences,
  card fees, manual work) is the pitch; (b) FX and payment-rail reliability matter (USD-denominated tourism, MVR
  local costs); (c) a demand dip lowers occupancy (57% in Mar 2026) and makes RM/channel tools more valuable.

## 5. Energy and sustainability context

- Resorts run predominantly on diesel: **33.2 L per bed-night** on average; **46–130 L per room-day**; resorts
  account for **298 MW** of diesel generation capacity [S] [SAEED-2023] [MV-ENERGY-MW]. Solar retrofits ongoing
  (Hilton Amingiri projection) [VC]. Fuel-price shocks (2026) flow directly into resort cost per occupied room.
- Portico utilities/analytics: per-guest-night diesel/water KPIs, USALI 12 sustainability lines (03 §9).

## 6. Payments rails

| Item | Fact | Key |
|---|---|---|
| **Favara** (MMA instant payments, by Tietoevry) | Launched **Aug 2023** for bank-to-bank transfers; participants incl. **BML, MIB, SBI**; single transfer cap **MVR 50,000**; smart addressing | [S] [MMA-FAVARA] |
| **National QR** | Announced Aug 2025 for launch in **2026** over Favara; MMA: card payments carry **~2.5% fee**, to be eliminated for vendors using QR; "all vendors will be able to use the QR code instead of card payments" | [S] [MMA-QR] |
| **India UPI corridor** | Favara–UPI cross-border corridor went live (31 Jul; year per source context) | [S] |
| Card acquiring (BML, MIB) | No 2025–2026 detail found; see `dependency-register.md` §2.4–2.5 | — |

**Implication [I].** For guesthouses and local spend (excursions, F&B on local islands), **QR/Favara** may become the
cheapest collection method in MVR, while international tourists still pay by card in USD. Portico's payments
should model *external payment methods* (QR/bank transfer confirmations) with reconciliation, not only card PSPs.

## 7. Tax administration signals (beyond rates already documented)

- **MIRA e-invoicing**: MIRA expects its e-invoicing system "to be finished within the year" (undated PSM item);
  e-invoicing is part of MIRA's two-year compliance strategy (Jan 2025) to "directly monitor transactions" [S]
  [MIRA-EINV].
- Aggregator (Lookuptax, unofficial): **31 Aug 2026 — three-day deadline to issue a tax invoice or receipt**;
  **1 Jan 2027 — MIRAconnect mandatory for GST filing and payment** [3P] [LOOKUPTAX-MV]. **Verify against MIRA
  gazette before use** (extends Q41/Q106).
- Implication [I]: Portico's Maldives country pack should be designed to plug in an **e-invoice submission adapter**
  (OPERA shows the pattern: country exports per release) and to issue tax invoices promptly (three-day rule).

## 8. Indian Ocean neighbours (brief)

- **Sri Lanka:** John Keells' Cinnamon selected OPERA Cloud + Simphony for Sri Lanka **and** Maldives — a regional
  group buying once for both markets [S].
- **India:** Favara–UPI corridor; RateGain (Indian) now owns Sojern — strong regional hospitality-tech base [S].
- **Pakistan:** first Shiji Daylight deployment (Feb 2026) — Shiji expanding in South Asia [S].
- Mauritius, Seychelles: no new evidence gathered in this pass (market-matrix §3 remains the reference).

## 9. What this means for the pilot (facts → choices) [I]

1. **Two different beachheads.** Guesthouses (many, small, growing, OTA-dependent, low tech) vs resorts (few, large,
   OPERA-entrenched, group-controlled). Migration effort per bed is far lower for guesthouses; reference value is far
   higher for resorts.
2. **One-button migration matters most for resorts on OPERA** (5.x nearing support horizon; OHIP access needs the
   hotel's approval) — see 11.
3. **2026 downturn** favours propositions that cut cost and labour; avoid a pitch that adds licences.
4. **Payments:** plan for card (USD) + Favara/QR (MVR) + bank transfer + OTA VCC, with reconciliation.
5. **Compliance:** e-invoicing and invoice-timing rules may arrive during the pilot — design for adapter swap.
