# 06 — Pricing and go-to-market (short form)

**Scope note.** At the owner's request (orchestrator message, 2026-11-07) this file was **shrunk**; the effort moved
to [11-one-button-migration.md](11-one-button-migration.md). R03 §14 item 4, R04 §D3 and `docs/product/editions.md`
already cover pricing principles; this file only adds 2025–2026 price observations and GTM patterns. Labels per
[00-index](00-index.md).

---

## 1. Observed price points (2025–2026)

| Product | Observation | Label | Key |
|---|---|---|---|
| Apaleo PMS | **€8 / room / month, €400 monthly minimum per property** (one aggregator says per year [C]); APIs included; payments and many capabilities via Apaleo Pay / Store apps | [3P] | [APALEO-PRICE-3P] |
| Little Hotelier | Basics $29–39, Pro/Revenue Optimiser $109–179 per month; **tiers changed twice in 2026** (cut Feb, raised and Basics removed Aug) | [3P] [C] | [LH-PRICE-3P] |
| eZee Absolute | $23.86–$50 / month entry; ~$2.50–5 / room estimates | [3P] [C] | [EZEE-PRICE-3P] |
| OPERA Cloud | Unpublished; R&A licensed **per guest room** or **per property (200+ rooms)**; estimates $12–60 / room / month | [S] [3P] | [ORA-RNA-LIC]; R01 |
| OPERA Cloud Assistant (AI) | **Included at no additional cost** | [S] | [ORA-AI-2026] |
| OPERA add-ons visible in release notes | S&EM Premium, Casino & Gaming, Loyalty, Central Management Services, Distribution Channel, **Archive Solution (OCAS)**, **R&A Data Access** (required for Data APIs) | [V] | [ORA-RR-26.4] [OHIP-UG] |
| OHIP | Partner pays per call; customers "don't pay" (2021 slides); bulk Data APIs need hotel's R&A Data Access SKU or partner per-call | [S] [V] | [OHIP-PRICING-S] [OHIP-UG] |
| Mews | Quote-based (R02); BI bundled in Analytics/Enterprise (2026) | [S] | R02 |
| Cloudbeds | Quote-based; **Reservation Import Service is a paid extra**, not part of onboarding | [S] | [CB-IMPORT] |
| Lighthouse Revenue Agent | **No additional cost** to existing customers | [S] | [LIGHTHOUSE-2026] |
| Maldives card acceptance | ~**2.5%** card fee cited by MMA (to be undercut by national QR) | [S] | [MMA-QR] |

## 2. Go-to-market patterns observed

1. **Awards and analyst placements as primary proof.** HTA 2026 (3,013 companies evaluated, 245 qualified) and IDC
   MarketScape 2025 are headline assets for Mews, Cloudbeds, IDeaS and Oracle [S] (08).
2. **Commissioned research as content.** NYU/Stayntouch/IDeaS (best-of-breed), Cloudbeds/NYU (UX), IDC/Mews (ROI
   n=8), HTR impact study — each supports the sponsor's model [S].
3. **"Switching" landing pages and migration guides** (Mews "switching PMS" research, Roommaster "How to migrate from
   Cloudbeds/Stayntouch") — switching is a marketed motion, but the *service* behind it is manual or paid (07, 11).
4. **AI as free differentiator at the top, paid SKU at the edge.** Oracle and Lighthouse give it away; Canary sells
   AI Voice; Cloudbeds pilots Ask Signals.
5. **Distribution partnerships over competition.** SiteMinder embedded inside Mews OS (May 2026).
6. **Chain programmes drive volume.** Wyndham (20 hotels/week, R01), Marriott/Agilysys, IHG optional approval —
   brand certification remains the gate to franchised hotels.

## 3. Implications (brief) [I]

- Publish prices (editions.md) and **include migration** — competitors charge for it (Cloudbeds) or hide it in
  professional services (Oracle). "Migration included, measured and reversible" is a sharper wedge than price.
- Do not plan AI as a revenue line; plan it as **retention and switching argument** (Oracle anchor at zero).
- For the Maldives, price against **total cost** (subscription + payments fees + integration fees + migration),
  because card fees (2.5%) and OHIP/partner costs dominate for small properties.
- Use *measured* claims only (CLAUDE.md §7): time-to-competency and migration correctness metrics (03 §11).
