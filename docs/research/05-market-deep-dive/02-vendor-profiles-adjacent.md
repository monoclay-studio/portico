# 02c — The connected hotel stack: adjacent categories (2024–2026)

What changed around the PMS: revenue management and intelligence, guest messaging and AI front office, CRM and
marketing, reputation, payments, housekeeping and operations, POS/F&B, integration and migration specialists.
Earlier coverage: R03 §8.7–8.9 (Lighthouse, Duetto, IDeaS), R04 Part B (payments), `docs/adoption/
integration-coverage-matrix.md` (provider × workflow). Labels per [00-index](00-index.md).

---

## 1. Revenue management and commercial intelligence

| Vendor | 2024–2026 moves | Evidence | Pattern [I] |
|---|---|---|---|
| **Lighthouse** (ex-OTA Insight) | $370m KKR (Nov 2024), >$1bn valuation, 70k hotels; **AI Channel Manager + Pricing Manager** for independents (Jul 2024; 200+ OTAs, 50+ PMSs); **Revenue Agent** (autonomous decisions, Q1 2026, **no extra cost**); **Ernest** AI assistant (Jun 2026); **Connect AI** incl. a **direct-booking app inside ChatGPT** (Mar 2026); acquired **Hotelrank.ai** (May 2026: AI-visibility scores, direct-vs-OTA link measurement) | [S] [LIGHTHOUSE-KKR] [LIGHTHOUSE-2026] | Intelligence vendors are moving **down into distribution** (channel manager) and **out into AI search visibility**. |
| **IDeaS (SAS)** | Recognised in three 2026 HTA categories; co-sponsor of NYU 2026 outlook | [S] [IDEAS-HTA] | Best-of-breed RMS defends via research sponsorship. |
| **Duetto** | Acquired by **GrowthCurve Capital** (2024) | [S] [HI-2024-REVIEW] | PE ownership. |
| **Atomize → Mews RMS** | "Autopilot" (vendor: 70% of users) (R02) | R02 | PMS absorbs RMS. |
| **RoomPriceGenie** | $75m (2024–25) | [S] [ABODE-2025] | SMB auto-pricing remains fundable. |
| **RateGain + Sojern** | $250m acquisition (closed Nov 2025); combined ~$310m revenue | [S] [RATEGAIN-SOJERN] | Rate intelligence + paid media convergence. |
| **Oracle** | 25.4 FPLOS from hurdle rates to channels | [V] [ORA-RR-25.4] | PMS-side yield controls for direct connects. |

**Implication [I].** "Revenue agent at no extra cost" (Lighthouse) and "free assistant" (Oracle) set the price of
basic AI pricing help near zero. Portico's rates module should ship an explainable pricing assistant in every
edition (already RAT-R31) and compete on **explanations, guardrails and audit**, not on the existence of AI.

## 2. Guest experience, messaging and the AI front office

| Vendor | Facts | Key |
|---|---|---|
| **Canary Technologies** | $80m Series D (Jun 2025), ~$600m valuation; **20,000+ properties in 100+ countries**; launched **AI Voice** and **Webchat**; founded 2018 | [S] [CANARY-SERIES-D] |
| **Duve, Chatlyn, Conduit, Canary** | Together **$152.6m** raised (Apr 2025–Mar 2026) — "AI-led guest experience" | [S] [ABODE-2026-HD] |
| **HiJiffy, Duve** | Named as competitors in an unnamed June 2026 guest-tech merger | [S] [GX-MERGER-2026] |
| **Oracle** | 26.4 Digital Registration with e-sign; AI reservation summary; Nor1 upgrade offers at mobile check-in | [V] [ORA-RR-26.4] |
| **Mews** | Guest Messaging launched as part of Mews OS (May 2026); single-use guest-portal link API | [S] [V] |
| **Nor1 (Oracle)** | PRiME "patented" decision engine; eStandby (request-before-arrival) and eXpress (confirmed last-minute) upgrades; vendor: **17% incremental upsell revenue per transaction (2023)**; Choice Hotels selected Nor1 merchandising | [S] [VC] [NOR1-ORA] |

**Academic counterweight:** self-service only pays off with lag and when failures are rare; failed self-service
reduces return intent (Lui & Piccoli, 163 hotels) — 03 §4.

## 3. CRM, marketing and reputation

| Vendor | Facts | Key |
|---|---|---|
| **Revinate** (Serent) | Earlier acquisitions NAVIS (direct-booking/reservation sales), Go Moment (Nov 2021); a tracker lists **three acquisitions in Apr 2026** (not read) | [S] [REVINATE-2026] |
| **Cendyn** | Acquired Knowland (Oct 2024), Guestfolio, WIHP (metasearch) | [S] [CENDYN-KNOWLAND] |
| **Shiji ReviewPro** | Sold with Daylight + Infrasys (e.g. RakYim Siam, Bangkok, May 2026) | [S] [SHIJI-2026] |
| **dailypoint** | CDP/CRM; expanded collaboration with Motel One around its OPERA Cloud migration (since May 2025) | [S] [MOTELONE-ORA-2026] |

**Pattern [I].** CRM/marketing is consolidating into PE-backed suites (Revinate, Cendyn) and being bundled by PMS
vendors (Mews, Cloudbeds Signals for guest marketing). For Portico, CRM depth is less a feature race than a
**consented, unified guest profile that partners can read** (GUE/CRM specs).

## 4. Payments

- **Shift4**: claims #1 in hospitality payments; Choice Hotels 5-year renewal; Q3 2026 payments revenue less
  network fees **$402m (+18%)** [S] [SHIFT4-Q3-2026].
- **PMS-embedded payments** remain the profit engine (SiteMinder transaction margin 39.4%; Mews payouts and
  balance-transaction APIs for reconciliation; Oracle catching up on Pay-by-Link status checks and VCC transfer)
  [S] [V].
- **Card-data portability** exists but is procedural: **Stripe imports and exports PANs only with another PCI DSS
  Level 1 processor**, via SFTP + PGP, with a validation summary the merchant approves; wallet-stored cards (Google
  Pay etc.) and Link cards cannot be migrated; expired cards may be updated by card-account-updater (fees) [S]
  [STRIPE-PAN-IMPORT] [STRIPE-PAN-EXPORT]. Relevant to migration (11 §5).
- **Maldives:** card payments carry a ~**2.5%** fee per MMA; a **national QR** system over the **Favara** instant
  payment rail is planned for 2026 and pitched as fee-free for vendors (09 §6) [S] [MMA-QR].

## 5. Housekeeping, service orders and operations

- **Mews → Flexkeeping** (Sep 2025): housekeeping and task automation absorbed into the PMS; "advanced
  capabilities in 2026" [S] [MEWS-FLEXKEEPING].
- **Oracle 25.3 Task Sheet Completion**, **26.4 Service Order Management** (skills, specialties, resource groups,
  follow-up tasks, board view, photos on mobile) [V].
- **Patents** on guest-chosen housekeeping windows (The Hotel Communication Network family) and AI room assignment
  (Oracle) — 04.
- **Labour context:** housekeeping is the top staffing need (58% of hotels in AHLA's mid-2025 member survey) [S]
  [AHLA-2025].

## 6. POS and F&B

- **Mews POS** won HTA 2026 *Best Hotel Restaurant POS* [S]; **Oracle Simphony** sold with OPERA Cloud (e.g.
  Cinnamon Maldives) [S]; **Infrasys** (Shiji) in 60+ countries [S]; **Shift4 SkyTab** POS installations growing
  [S]; Agilysys PMS recurring revenue about to overtake POS recurring [S].
- *Inference:* resorts buy PMS+POS as a pair more often in 2025–2026 (Cinnamon, Agilysys, Shiji). Portico's
  decision to *integrate* POS (RST-R01, fnb-pos spec) must make the integrated experience indistinguishable from a
  suite at the folio (posting, balancing, entitlement use).

## 7. Integration platforms and migration specialists

| Player | Role | Evidence |
|---|---|---|
| **OHIP** (Oracle) | 3,580-operation API platform with async bulk, streaming, Data APIs | [V] 02a §1.4 |
| **Omniboost** | Integration platform; **custom PMS data migration** IDPMS → Apaleo for Valk Exclusief ("more than a standard data transfer") | [S] [OMNIBOOST-VALK] |
| **HRS** | **Data Migration Tool** OPERA V5 → OPERA Cloud (XML from V5, code mapping, validation in Cloud, via OXI/OHIP [C]); reported averages **15 reservations/min, 25 profiles/min, 25 rates/min, 50 packages/min** across 10 properties / ~36,000 records | [S] [VC] [HRS-DMT] |
| **RobosizeME** | RPA-based migration where the legacy PMS **lacks complete export tools** | [S] [ROBOSIZEME] |
| **Chatlyn** | Consultancy view: OPERA 5→Cloud prep **6–12 weeks per property**; duplicate profiles migrate intact unless cleaned; OXI replaced by OHIP; interface re-certification is a long pole | [3P] [CHATLYN-O5] |
| **Channex** | Planned Portico distribution hub (R04 §A8; dependency register §3.1) | R04 |

**Pattern [I].** A cottage industry exists because **no vendor offers a productised, any-source migration**.
Oracle's own path (OCM) works only OPERA→OPERA (database copy). Everyone else relies on CSV dataloaders, custom
scripts or RPA. See 11.
