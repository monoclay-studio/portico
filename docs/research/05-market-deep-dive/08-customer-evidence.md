# 08 — Customer evidence: awards, analyst reports, surveys and case studies

R01–R03 summarised review-site sentiment (G2, Capterra, HTR) per vendor with small samples. This file adds the
2025–2026 survey and award evidence, with **who paid for it** and the internal inconsistencies, so Portico does not
build on marketing statistics. Labels per [00-index](00-index.md).

---

## 1. Awards and analyst placements

| Instrument | Method (as described) | 2025–2026 outcome | Caveat | Key |
|---|---|---|---|---|
| **HotelTechAwards 2026** (Hotel Tech Report) | "Authentic, timely reviews from verified hotel owners and operators"; **3,013 companies evaluated, 245 products qualified** (announced 12 Jan 2026) | **Mews Best PMS** (3rd year, HT Score 100); Mews POS best hotel restaurant POS; **Cloudbeds Best Hotel Management Software** (finalist PMS, channel manager); **IDeaS** recognised in 3 categories | HTR monetises vendor listings; methodology not independently audited [I] | [HTA-2026] |
| **IDC MarketScape WW Hospitality PMS 2025** (#US52038025, Aug 2025) | Vendor assessment, **9 vendors** | **Oracle** Leader (2nd time; largest client share comfort/midscale); **Mews** Leader (1st time) | Paywalled; other placements unknown | [IDC-PMS-2025-ORA] [IDC-PMS-2025-MEWS] |

## 2. Surveys (with sponsorship)

### 2.1 HotelTechReport *2026 PMS Impact Study* (data collected Jun–Sep 2025) [3P] [HTR-PMS-2026]

| Finding | Value |
|---|---|
| Save 2–10+ hours/week from PMS automation | **89%** |
| Save >10 hours/week ("500+ hours/year") | **17%** |
| Onboarding reduced from weeks to days | **92%** |
| Direct revenue growth attributed to PMS features | **91%** |
| Measurable cost savings / significant | **88% / 42%** |
| Would switch PMS over **reliability** issues | **48%** |
| Would switch over **cybersecurity** concerns | **42%** |
| Biggest switching barrier: **staff training** | **26%** |
| Top concern: **data migration complexity** | **24%** |

**Caveats [C].** Sample described both as "450 vetted professionals with ≥8 years' experience" and "1,200+ hotels in
47 countries"; one syndicated copy says it is "formatted for machine readability and LLM ingestion". Treat as
directional.

### 2.2 NYU SPS Tisch Center × **Stayntouch × IDeaS** — *2026 Hotel Technology Outlook: Best-in-Class vs All-in-One*
(published 5 Nov 2025) [S] [NYU-2026]

- 300+ hotel professionals; **38% cite integration as a top pain point**; specialised-system users **70% satisfied
  with PMS, 59% with RMS**; **51%** plan to replace or upgrade their stack in 12–24 months; headline: "clear shift
  toward best-in-class".
- **Sponsorship:** both co-publishers sell best-of-breed products.

### 2.3 Cloudbeds × NYU professors — *PMS User Experience Report* [S] [VC] [CB-NYU-UX]

- 500 employees, 5 countries; 52.2% of managers: 4 months–3 years to confidence; 73% informal training; **38% say
  usability influenced leaving a job**; "85% get ≤2 weeks of training" appears only in a Cloudbeds article [C].

### 2.4 AHLA staffing (US) [S] [AHLA-2025]
- 65% report shortages (Dec 2024–Jan 2025, n=282) vs 97% (49% severe) mid-2025 member survey [C]; housekeeping top
  need (58%); tactics: higher wages 47%, flexible hours ~20%, discounts 13%.

### 2.5 HOTREC *European Hotel Distribution Study 2024* [S] [HOTREC-2024]
- Rate undercutting affects ~**4 in 10** European hotels.

### 2.6 Vendor-commissioned ROI
- IDC for Mews (**n=8**): 476% three-year ROI, 4-month payback; "13.7% revenue lift" [VC] [MEWS-OS-2026].
- Nor1/Oracle: 17% incremental upsell revenue per transaction (2023) [VC].

## 3. Case studies (what customers actually experienced)

| Case | Facts | Lesson [I] | Key |
|---|---|---|---|
| **FIDI Hotel, NYC (131 rooms)** | Opened on Stayntouch; management company moved it to another major PMS; internal champion left mid-project; **CRS–PMS mismatch duplicated reservations and doubled revenue on the books**; revenue not reaching the bank; GM knew in week one; **back on Stayntouch in two months** (switch-back only needed a payment-portal change) | Reconcile on-the-books and payments before switching channels/CRS; keep a fast rollback path | [FIDI-CASE] (vendor-adjacent author) |
| **Motel One** | 100+ hotels to OPERA Cloud; Oracle Managed Services; ~six months (opinion) | Managed services are part of enterprise buying | [MOTELONE-ORA-2026] |
| **Minor Hotels** | 106 properties, 59 countries, ~3 years | Multi-country rollouts are multi-year even with Oracle | [MINOR-ORA-2026] |
| **Cinnamon Hotels (John Keells)** | OPERA Cloud + S&EM + Simphony; **three Maldives resorts first**; motive: easier back/front-office integration than prior system | Maldives resort groups buy the Oracle bundle | [CINNAMON-ORA] |
| **Valk Exclusief** | IDPMS → Apaleo with custom Omniboost migration | Legacy exits need bespoke tooling today | [OMNIBOOST-VALK] |
| **Jordans Untermühle** | HS/3 → Mews; demo testing, semi-automated import, manual validation; historical reservations for YoY reporting | History matters for reporting continuity | [MEWS-MIGRATE] |
| **The Garden Inn (220 rooms)** | Legacy downtime ~6 h/week, check-in delays +18% peak (pre-switch) | Reliability drives switching | [VC] (Yanolja-sponsored) |
| **Cocoon & Eckelmann** | Whole 800-room portfolio to Apaleo ahead of 2026 expansion; room-allocation AI agent (May 2026) | Groups adopt agent-ready PMS for automation | [APALEO-NEWS] |

## 4. What the evidence agrees on (despite sponsorship) [I]

1. **Reliability and security** are top switching triggers (48%/42%), ahead of features.
2. **Training and migration** are the top switching *barriers* (26%/24%) — exactly what one-button migration and
   one-shift learnability attack.
3. **Integration pain** is widespread (38%) regardless of all-in-one vs best-of-breed preference.
4. **PMS usability affects staff retention** (38% in the Cloudbeds/NYU sample) — a labour-market argument owners care
   about in shortage markets.

## 5. Gaps [I]

- No independent, audited satisfaction benchmark (e.g. NPS) exists for PMS vendors in what we could read.
- No public data on PMS churn rates by vendor.
- No Maldives-specific hotel technology satisfaction survey found (09).
