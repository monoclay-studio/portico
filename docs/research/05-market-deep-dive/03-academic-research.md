# 03 — Academic and institutional research on hotel operations and hospitality software

Purpose: what peer-reviewed and institutional research says that should shape Portico's design, and where the
evidence is thin, contested or sponsored. Research files 01–04 contain almost no academic evidence; everything
here is **new** unless marked. Abstract-level access only (publishers not reachable; see 00 limitations) — labels
`[S]`. Bibliography keys in [10-bibliography.md](10-bibliography.md).

---

## 1. Map of the literature (what exists, how strong)

| Theme | Strength of evidence | Typical method | Most useful for |
|---|---|---|---|
| PMS / hotel IS acceptance and usability | Moderate, dated (2005–2010 core, small 2020s updates) | TAM surveys of front-office staff | identity, UI/experience, workforce, training |
| Workforce, technostress, AI anxiety | Growing (2020–2026), cross-sectional | Surveys (n≈240–413), SEM | workforce, UI, AI |
| Self-service (kiosks, mobile) | Moderate; one strong multi-hotel field study | Panel/financial data + surveys | guest-experience, reservations |
| Revenue management, overbooking | Strong theory (OR), weaker hotel field validation | Stochastic/DP models, simulations, some field A/B | rates, inventory, reservations, analytics |
| Cancellation prediction / ML on PMS data | Moderate; real deployments at a few hotels | Classification, A/B in production | analytics, rates, payments |
| Channel economics, parity clauses | Strong econometrics; legally consequential | Natural experiments, metasearch panels | distribution, rates, GTM |
| Generative AI / LLMs in hospitality | Fast-growing, mostly reviews/agendas | Bibliometrics, expert opinion | ai, comms, guest-experience |
| Service robots | Moderate; cautionary field cases | Case studies, surveys | operations (do not over-automate) |
| Sustainability / energy | Weak peer-reviewed for Maldives; industry data | Presentations, ministry studies | resort, utilities, analytics |

## 2. PMS usability, acceptance and the training burden

### 2.1 Technology acceptance of hotel front-office systems
- **Kim, Lee & Law (2008), *Tourism Management* 29(3):500–513** — extends the **Technology Acceptance Model**
  (TAM) to hotel front-office systems; tests how **information-system quality** and **perceived value** relate to
  acceptance and actual use [S] [KIM-LEE-LAW-2008]. *Design reading [I]:* staff adoption depends on *system quality*
  (accuracy, speed, reliability) as much as ease of use — supporting Portico's emphasis on truthful state and
  reliability before polish.
- **Hemdi (2009), *ESTEEM Academic Journal*** — 240 frontline employees in twelve 5-star hotels (Penang): extended
  TAM with IS quality, ease of use, usefulness, attitude [S] [HEMDI-2009].
- **Najafi (2024), thesis (Finland)** — qualitative, 7 front-office employees / 5 hotels: recommends personalised
  training, self-efficacy building and **intuitive HIS interfaces** [S] [NAJAFI-2024].
- **Rahman et al. (2026), *Jurnal Kepariwisataan Indonesia*** — PMS contribution to employee performance is
  inconsistent "due to variations in system usability, employee readiness" (South Sulawesi) [S] [RAHMAN-2026].

### 2.2 The training gap (vendor-sponsored but academically co-authored)
- **Cloudbeds × NYU Tisch Center — *PMS User Experience Report*** (500 hotel employees, 5 countries) [S] [VC]
  [CB-NYU-UX]:
  - **52.2% of managers** estimate front-desk staff need **between four months and three years** to feel confident
    with the PMS;
  - **73%** were trained by a supervisor or colleague (not structured training);
  - **38%** said PMS usability **influenced a decision to leave a job**;
  - a Cloudbeds article adds **85% receive two weeks or less of PMS training** (not found in the report summary — [C]).
- **HTR 2026 PMS Impact Study** (sample reported as 450 professionals *or* 1,200+ hotels [C]): **26%** name staff
  training as the biggest barrier to switching PMS; **92%** say modern PMS cut onboarding "from weeks to days" [3P]
  [HTR-PMS-2026].

**Synthesis [I].** Independent peer-reviewed measurement of *time-to-competency* on PMSs **does not exist** in what we
found. Portico's "productive in one shift" target (ux §19) would be a genuinely new, publishable metric if measured
with a protocol (task success, time on task, errors) — a credible marketing *and* academic asset.

## 3. Workforce, technostress and AI anxiety

- **Başer & Büyükbeşe (2024), *Journal of Hospitality and Tourism Insights*** — 324 Turkish hotel employees:
  awareness of **STARA** (smart technology, AI, robotics, algorithms) harms job outcomes; **perceived organisational
  support reduces fear of technological unemployment** [S] [BASER-2024].
- **Kang, Shin & Kang (2024), *JHTT*** — 259 frontline employees: **AI-driven job insecurity raises turnover
  intention**, more strongly *toward leaving the hotel industry* [S] [KANG-2024].
- **Antalya studies (Springer *Information Technology & Tourism*, 2026; Synapse record)** — 245 employees:
  technostress types reduce performance especially under **role ambiguity**; technostress affects turnover
  intention directly and indirectly; organisational support buffers [S] [ANTALYA-TECHNOSTRESS].
- **Bakir (Auburn dissertation, 2026)** — 413 US hotel employees: competitive psychological climate mediates;
  **technostress did not explain** the relationships in that sample [S] [C] [BAKIR-2026].
- **Wen et al. (2020)** — role stress → burnout → turnover among frontline staff [S] [WEN-2020].
- **AHLA (US) 2025:** 65% of hotels report shortages (Dec 2024–Jan 2025, n=282) vs **97% (49% severe)** in a mid-2025
  member survey [C]; **housekeeping is the top need (58%)** [S] [AHLA-2025].

**Design reading [I].** AI features must be framed and built as *support with clear roles* (who decides, who
checks), with explicit task ownership — role ambiguity is the documented amplifier of technostress. Matches
Portico's universal record contract (owner, allowedActions) and AI "suggestion vs fact" labelling.

## 4. Self-service, kiosks and mobile

- **Lui & Piccoli (2010), Cornell Center for Hospitality Research** — **163 hotels in two chains**; automated vs
  failed check-in ratios matched to STR financials [S] [LUI-PICCOLI-2010]:
  - kiosks improved financial results **with a time lag**;
  - guests favour kiosks for routine tasks; **failed self-service check-in reduced willingness to return**;
  - kiosks did **not** improve *perceived* check-in speed; staff time freed went to consultation/upselling;
  - recommendation: careful rollout with substantial staff support.
- Mobile check-in demand vs supply (34% of connected travellers want it; ~11% of hotels offered it — TripAdvisor via
  vendor blog) [3P] — dated.

**Design reading [I].** Self-service must have *graceful failure* (hand-off to staff with context) and measured
failure rates; a failed digital step is worse than no digital step.

## 5. Revenue management, overbooking, cancellations and upgrades

### 5.1 Overbooking models
| Study | Model | Key result / relevance |
|---|---|---|
| **Subramanian, Stidham & Lautenbacher (1999), *Transportation Science* 33(2):147–167** | Dynamic programming for multi-class capacity control with overbooking, cancellations and no-shows | Optimal policy = state- and time-dependent booking limits; **up to 9% revenue gain** vs ignoring cancellations/no-shows; applies to hotels [S] [SUBRAMANIAN-1999] |
| **Phumchusri & Maneesophon (2014), *JHTT*** | Closed-form optimal overbooking for one room type; convexity proof and equations for two room types | Optimal level depends on **walk cost, cost of unsold room and historical cancellation distribution** [S] [PHUMCHUSRI-2014] |
| **Saito, Takahashi, Koide & Ichifuji (2017), CIRJE WP** | Joint overbooking level + room rate using cancellation data; two Tokyo hotels | Price competition can drive "significantly low" room rates and expected sales [S] [SAITO-2017] |
| **arXiv 2410.15245 (2024)** "Two-stage online reusable resource allocation" | Reservations + walk-ins + overbooking + **confirmation calls** to predict no-shows; Algarve resort data | Confirmation calls as an information action that changes overbooking risk [S] [ARXIV-2410.15245] |

### 5.2 Cancellation prediction on PMS data
- **António, de Almeida & Nunes (2017, ICMLA; 2019, *JHTR*)** — daily-retrained classifier on **PMS data**, deployed
  **in production at two hotels with A/B testing**; contacted "likely-to-cancel" bookings **cancelled less**; 2019
  extension: eight hotels' PMS data plus weather, events, reputation and online prices with interpretable models
  exposing cancellation drivers [S] [ANTONIO-2017] [ANTONIO-2019].
- **Open dataset:** *Hotel booking demand datasets* (*Data in Brief* 22:41–49, 2019): **119,390 bookings** (resort
  40,060; city 79,330), arrivals Jul 2015–Aug 2017, incl. cancellations, de-identified [S] [ANTONIO-DIB-2019].
  *Use [I]:* a public benchmark for Portico's demand/cancellation features and demo data realism (resort H1 is
  closer to Maldives patterns than city hotels).

### 5.3 Upgrades and upsell
- **arXiv 2402.08804 (2024)** "When should you offer an upgrade" — **13,155 real upgrade offers over a year**; models
  acceptance as a function of upgrade price relative to room price; shows the incumbent system **ignored remaining
  inventory per category** and proposes inventory-aware mechanisms [S] [ARXIV-2402.08804].
- Nor1 vendor claim: 17% incremental upsell revenue per transaction [VC] (02c §2).

### 5.4 AI in RM — the state of research
- A 2025 systematic review (Indonesian journal) finds ML, deep learning, random forests, XGBoost, ANN, LSTM and
  **reinforcement learning** most applied to demand forecasting; **explainable AI, generative AI, digital twins, IoT
  and sustainability are under-researched** [S] [AI-RM-REVIEW-2025].
- Commonly repeated "5–15% revenue gains from AI RM" appears in an arXiv survey **without a primary study** [S] [C].
- University of Catania thesis frames RL pricing agents as an open research direction [S] [SAITTA-THESIS].

**Design reading [I].** (a) Overbooking should be a *per-night, per-unit-type decision with explicit walk cost and
cancellation distribution*, not a flat percentage; (b) confirmation contact is an RM lever (comms + RM);
(c) upsell must be inventory-aware; (d) explainability is an open research gap Portico can own.

## 6. Channel economics and parity clauses

### 6.1 The billboard effect (contested)
- **Anderson (2009/2011, Cornell CHR)** — JHM hotels: Expedia listing raised total reservations **7.5–26%**
  (excluding OTA bookings); replication on **1,720 IHG reservations (summers 2008–2010)**: each Expedia reservation
  associated with **3–9 additional brand-website reservations** [S] [ANDERSON-2011].
- **Anderson & Han** follow-up: effect "still alive" [S] [ANDERSON-HAN].
- **Counter-evidence:** an AHLA Consumer Innovation Forum study using **clickstream attribution** found the effect
  gone/reversed; a Kannan study (~50,000 shoppers, 2014) found hotel-site visitors more likely to convert at
  intermediaries [S] [AHLA-CIF-BILLBOARD]. **Unresolved [C]** — methods differ (OTA/chain data vs clickstream).

### 6.2 Parity clauses — econometrics and law
- **Hunold, Kesler, Laitenberger & Schlütter (2018), *International Journal of Industrial Organization* 61:542–571**
  — metasearch data on tens of thousands of hotels: best-price clauses shape pricing and availability across
  channels; hotels publish on Booking.com more often when it does **not** use the narrow clause; after the German ban,
  the **direct channel is price leader more often** [S] [HUNOLD-2018].
- **Mantovani, Piga & Reggiani (2021), *European Economic Review*** — France's removal of parity clauses as a
  quasi-experiment: **significant short-run price decreases, limited medium-run effect**; chain hotels cut prices more
  than independents [S] [MANTOVANI-2021].
- **CJEU C-264/23 (19 Sep 2024)** — wide and narrow parity clauses **cannot in principle be ancillary restraints**;
  not automatically infringing; case returns to Amsterdam court [S] [CJEU-C264-23]. **DMA**: Booking.com
  designated gatekeeper (May 2024) — may not use wide or narrow parity clauses in the EU [S].
- **HOTREC 2024**: undercutting affects ~4 in 10 European hotels [S] [HOTREC-2024].

**Design reading [I].** Rate-parity *monitoring* is legitimate operational hygiene, but Portico should not build
features that *enforce* parity on behalf of an OTA; it should show the hotel **where it is undercut** and the
cost of each channel (distribution, analytics). Note a granted patent on "monitoring and enforcing price parity"
(04).

## 7. Generative AI and LLMs in hospitality

- **Dwivedi, Pandey, Currie & Micu (2024), *IJCHM*** — applications, challenges for firms, customers and
  regulators; research agenda [S] [DWIVEDI-2024].
- **Sigala et al. (2024), *Journal of Hospitality and Tourism Management*** — expert opinion across six areas
  incl. hospitality services and business intelligence [S] [SIGALA-2024].
- **Bibliometric review (2024), *JHTT*** — GenAI research rising, concentrated on **customer service**; also
  education and HR; English-only scope [S] [JHTT-GENAI-2024].
- **Gap:** no peer-reviewed field study found measuring LLM agents performing PMS operations (booking changes,
  postings) with error rates. *Implication [I]:* Portico should publish its own **agent evaluation suite**
  (task success, unsafe-action rate, reversals) — a differentiator and a research contribution.

## 8. Service robots — a cautionary record

- **Henn na Hotel (Japan):** in **January 2019 switched off more than half of its robots** because they created more
  work for staff and annoyed guests; failure factors: need for human intervention, usefulness, embodiment (Bhimasta &
  Kuo 2019) [S] [HENNNA-2019].
- **Webster & Ivanov (2020):** guests rated a service robot's performance highly; positive adoption attitudes [S].
- *Reading [I]:* automation that shifts hidden work to staff fails. Portico's AI/automation must **count the work
  it creates** (exceptions, overrides) and surface it.

## 9. Sustainability and energy (Maldives-relevant)

- **Maldives resorts:** 85% of resort diesel goes to electricity; **average 33.2 litres diesel per bed-night**;
  **46–130 litres per room per day** depending on season and tier (Dr Simad Saeed, Hotelier Maldives GM Forum 2023)
  [S] [SAEED-2023]; national diesel capacity **298 MW in resorts** vs 310 MW residential, 30 MW industrial (minister)
  [S] [MV-ENERGY-MW]; solar cases (Hilton Amingiri ~321,000 L diesel/year avoided, projected) [VC].
- **USALI 12th Revised Edition** (HFTP, published Feb 2025; adoption **1 Jan 2026**) adds **new sustainability and
  brand-cost categories**, yearly reporting of all fees charged to the hotel, and **all-inclusive guidelines** [S]
  [USALI-12].
- Peer-reviewed Maldives resort energy studies were **not found** in this pass; the Ministry's 2018 *Energy Supply and
  Demand Study* exists (catalogue only) [S].

**Design reading [I].** Per-occupied-room and per-guest-night utility KPIs (diesel litres, kWh, water) aligned to
USALI 12 sustainability lines are a credible Maldives differentiator (utilities spec), and all-inclusive guidance
affects package revenue allocation (finance/rates).

## 10. Interoperability and standards research

- **Buhalis & Leung (2018)** "smart hospitality" — interconnectivity and interoperability as preconditions (not
  verified in this pass; cited widely) [I].
- **HTNG**: the 2007 *Open Data eXchange* initiative aimed at an open standard for any two hotel systems; no
  2024–2026 PMS data-portability specification found [S] [HTNG-ODX]. Oracle documents migration **from legacy HTNG
  interfaces to OHIP REST** [S] [ORA-HTNG].
- *Gap [I]:* there is **no industry standard for PMS-to-PMS migration**. A published, open Portico migration schema
  (OPERA-concept-compatible) could become a de facto standard (11 §8).

## 11. Research gaps Portico can turn into advantages [I]

1. Measured time-to-competency for PMS tasks (no independent studies).
2. Explainable RM and overbooking decisions for small hotels (under-researched).
3. Agent safety metrics for PMS operations (no field studies).
4. Migration correctness metrics (no academic work found).
5. Resort energy KPIs per guest-night in SIDS (small island developing states).
