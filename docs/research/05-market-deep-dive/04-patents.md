# 04 — Patents that could constrain or inspire Portico designs

> **Not legal advice.** This is a research inventory of patent documents surfaced by search. It makes **no
> statement about validity, enforceability, scope or infringement**. Legal status and assignees were confirmed only
> where a search summary quoted them; patent databases (Google Patents, USPTO, Espacenet) were not directly
> reachable in this session. Any design that resembles a listed claim goes to qualified counsel for
> freedom-to-operate review (OPEN_QUESTIONS **Q40** already covers the Agilysys application).

R01 §6.5 and competitive-synthesis §3 item 1 already flagged **US 2017/0124610 (Agilysys)**. Everything else here is
**new**. Labels per [00-index](00-index.md).

---

## 1. Inventory

| # | Document | Assignee (as reported) | Dates (as reported) | Subject (from abstract/claims summaries) | Status | Portico areas touched | Watch level [I] |
|---|---|---|---|---|---|---|---|
| P1 | **US 11,514,374 B2** — "Method, system, and non-transitory computer readable medium for an artificial intelligence based room assignment optimization system" | **Oracle International Corp.** | Filed 2020-01-07; granted/published 2022-11-29 | Weighted **cost matrix** combining guest-satisfaction cost (mismatch between requests and room features) and **operational-efficiency** cost; preliminary assignments via a **Hungarian-algorithm heuristic**; **double-booking relaxation** step; earlier assignment gives housekeeping more time | Granted [S] | inventory (auto-assign INV-R23), operations, ai | **High** — Oracle shipped "AI room assignments" in OPERA Cloud Assistant (Jun 2026) and *AI Room Search* (25.5) |
| P2 | **US 12,014,310 B2** (pub. US 2022/0414557 A1; WO 2023/278935; CA 3222594) — "Artificial intelligence based hotel demand model" | **Oracle International Corp.** | Priority 2021-06-28; granted 2024-06-18 | Demand model for a potential customer choosing among offered rooms (multinomial-logit style: price, position in offer list, features such as view/breakfast) | Granted [S] | rates (pricing assistant), guest-experience (offer ranking), analytics | Medium |
| P3 | US 2021/0117998 — "Artificial intelligence based room personalized demand model" | (Oracle family per inventor listing) [S] | 2021 | Personalised room demand | Application [S] | guest-experience, rates | Medium |
| P4 | **US 2017/0124610 A1** — "Rules-based folio routing" | **Agilysys, Inc.** | Filed 2015-10-30; published 2017-05-04 | Routing rules per stay with destination folio and criteria; each accrued charge evaluated against rules (incl. **ranking**) and routed | Status **unknown** [S] | finance (billing rules FIN-R13–R16) | **High** (Q40 already open) |
| P5 | **US 12,586,008** (pub. US 2022/0188726) — "Managing hotel guest housekeeping within an automated guest satisfaction and services scheduling system" | Not confirmed; sibling assigned to **The Hotel Communication Network, Inc.** (Ottawa) | Provisional 62/823,474 (Mar 2019) | Guests choose **housekeeping time windows or opt out** on in-room terminals; scheduler uses choices and **DND** | Granted [S] | operations (housekeeping), guest-experience (requests) | Medium |
| P6 | **US 12,265,929 B2** — "Managing hotel guest departures within an automated guest satisfaction and services scheduling system" | **The Hotel Communication Network, Inc.** | Gazette 2025-04-01 | Departure management in the same scheduling system | Granted [S] | operations, reservations (departure) | Medium |
| P7 | Nor1 **PRiME** decision engine ("patented") | Nor1 (now Oracle) | n/a | ML-driven upgrade/upsell offers (eStandby, eXpress) | Patent number not identified [S] | guest-experience upsell | Medium — identify number |
| P8 | **US 10,387,795** — "Systems and methods for training and employing a machine learning system in providing service level upgrade offers" | Not confirmed in summary | n/a | ML estimates propensity to upgrade; tailors price/discount | Granted [S] | upsell, rates | Medium |
| P9 | **US 8,458,010 B1** — "Monitoring and enforcing price parity" | Not confirmed | n/a | Price-check tasks (human reviewers), comparison to reference price, notices to violators | Granted [S] | distribution/rate-shopping features | Low–Medium (avoid "enforcement" features anyway, 03 §6) |
| P10 | US 2007/0075136 A1 — "Hotel inventory management system and method" | n/a | 2007 | **Rate relationships** between room types (e.g. deluxe = BAR + fixed amount) pushing price/inventory to channels | Application (age suggests expired/abandoned) [S] | rates (derived rates) | Low — prior art for derived rates |
| P11 | **US 9,547,878 B1** — "Central reservation system availability engine" | n/a | n/a | Availability across room-type × rate-plan combinations with room-type, rate and hotel limits | Granted [S] | inventory, rates, distribution | Low–Medium |
| P12 | US 7,328,166 B1 / WO 2000/043927 — "Global reservations transaction management system and method" | n/a | ~2000 | Central DB updating all channels from property changes; notes PMS is the only real-time inventory view | Granted (old) [S] | distribution | Low (likely expired) |
| P13 | **US 10,735,201** and **US 12,113,911** — "Method and apparatus for key printing" | n/a | n/a | Phone app connects to kiosk, sends encrypted digital key payload; kiosk authenticates device and **prints a physical key card** | Granted [S] | access (keys), guest-experience (kiosk) | Medium if Portico builds kiosk/key flows |
| P14 | **US 11,257,315** — "Encoder multiplexer for digital key integration" | n/a | n/a | Kiosk/credential service issues virtual key; PMS requests physical cards | Granted [S] | access | Medium |
| P15 | **US 9,342,939 B1** — "Method and system utilizing magnetic card key with a QRC" | n/a | n/a | Pre-printed card with QR code activated via phone for self check-in | Granted [S] | access, guest-experience | Low–Medium |
| P16 | **US 12,056,779** — "Reception system, reception method, and program" (Japanese origin) | n/a | n/a | Compares **passport face photo** with live capture at check-in; writes room number/auth key to card; works without changing existing reservation system | Granted [S] | guest-experience (ID capture), access | Medium if biometric check-in is built |
| P17 | US 6,808,112 — "Automated self service hotel/motel front desk attendant system" | n/a | old | Self-service front desk | Granted (old) [S] | prior art | Low |
| P18 | US 8,245,276 B1 — internet access at hotels; notes PMS "night audit" blocks postings and queues them | n/a | old | Gateway queues postings during night audit | Granted (old) [S] | day-close (prior art for "posting during audit") | Low |
| P19 | US 2004/0019513 A1 — "Communication system for managing hotel operations" | n/a | 2004 | Wireless handhelds on housekeeping carts; central ranking of shift orders; completion updates | Application (old) [S] | operations (prior art) | Low |
| L1 | **Litigation:** 2018 suit alleging Hilton **Digital Key** infringes two mobile-unlock patents (Illinois federal court) | Plaintiff: Texas technology company | 2018 | Mobile key | Outcome unknown [S] | access | Awareness |

## 2. What each cluster means for Portico design [I]

### 2.1 Room assignment (P1, P2, P3)
- Oracle holds a granted patent on an **AI room assignment optimiser** formulated as a weighted cost matrix (guest
  satisfaction + operational efficiency) solved with a Hungarian-algorithm heuristic and a double-booking relaxation.
- The Hungarian method itself is classic, public operations research (Kuhn, 1955) — **prior art exists for the
  algorithm**, but what matters legally is the claims as a whole; counsel must assess.
- **Recommendation:** before Portico ships automatic assignment beyond simple rules (INV-R23), record the design
  rationale, prefer documented academic formulations, keep the assignment engine pluggable, and add P1 to the
  counsel review list alongside Q40. Do not copy Oracle's described cost structure.

### 2.2 Billing rules (P4)
- Already handled by Q40: Portico avoids ranked precedence (non-overlapping rules, FIN-R14) until review.
- Keep the "who pays for what" preview (D3) — previews are not the claimed subject per the summary.

### 2.3 Housekeeping scheduling (P5, P6, P19)
- Guest-selected cleaning windows and DND-driven scheduling are claimed in at least one granted patent family.
- **Recommendation:** Portico's guest-requested service windows (guest-experience/operations) should be reviewed by
  counsel before launch; older prior art (P19) exists for mobile dispatch.

### 2.4 Upsell and offer ranking (P2, P7, P8)
- ML-priced upgrade offers are patented by several parties (Nor1/Oracle, P8). Inventory-aware upgrade mechanisms are
  public in arXiv 2402.08804 (03 §5.3).
- **Recommendation:** start with transparent, rule-based upsell (published prices, inventory-aware); treat ML
  personalised pricing of upgrades as a counsel-reviewed later feature.

### 2.5 Keys, kiosks and identity (P13–P16, L1)
- Dense patenting around mobile-to-physical key issuance and kiosk identity checks; litigation history (Hilton).
- **Recommendation:** integrate with lock vendors' certified SDKs (ASSA ABLOY, dormakaba, Salto) rather than inventing
  key-issuance flows; the lock vendors carry their own patent positions (dependency register §6.1).

### 2.6 Distribution and parity (P9–P12)
- Old CRS/availability patents are likely expired or narrow; parity *enforcement* monitoring is patented (P9) and is
  also commercially/legally unattractive post-DMA.

## 3. Inspiration (ideas worth building on, subject to review)
1. **Explanations attached to AI changes** (Oracle 25.5 AI Room Search adds a reason text) — not a patent, but a
   good pattern.
2. **Earlier assignment → more housekeeping lead time** (P1's stated benefit) — Portico can achieve the same
   operational effect with *forward planning* (OPS-R05–R07) without automatic optimisation.
3. **Guest choice of service windows** (P5) as a stated guest-experience benefit — design alternatives with counsel.
4. **Async, incremental bulk extraction** (OHIP, Mews) — not patented in what we found; core to 11.

## 4. Follow-ups (for counsel / next pass)
1. Confirm status, assignee, claims and expiry for P1, P4, P5, P6, P8, P9, P13–P16 on USPTO/Espacenet.
2. Identify Nor1 PRiME patent number(s).
3. Search assignees *Mews Systems*, *Shiji*, *Cloudbeds*, *SiteMinder*, *IDeaS/SAS*, *Duetto*, *Agilysys* for
   2020–2026 grants (not achievable with search summaries in this pass — results returned no hits for IDeaS/Duetto).
4. Ask counsel whether Maldivian law currently provides patent protection at all and which foreign filings matter
   for a Maldives launch (not researched; do not assume either way); check WIPO PATENTSCOPE for filings designating
   Indian Ocean markets.
