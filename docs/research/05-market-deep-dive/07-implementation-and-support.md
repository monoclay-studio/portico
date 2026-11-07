# 07 — Implementation, support and training: how competitors deliver (2024–2026)

R03 §11 compared SMB onboarding (Cloudbeds 2–4 weeks with paid import; RoomRaccoon 28 days; RMS
go-live-then-integrate). R01 noted Wyndham's 20 hotels/week and Shiji's 7 properties/day. This file adds new
timelines, Oracle's own migration mechanics, support models and failure modes. Labels per [00-index](00-index.md).

---

## 1. Implementation timelines (evidence table)

| Vendor / programme | Scope | Elapsed time | How | Label | Key |
|---|---|---|---|---|---|
| **Oracle OCM** (OPERA on-prem → OPERA Cloud / OPERA 5 Hosted) | Per property / database | Not stated; **contract signature gates** the Oracle-run steps | Customer: SFTP + DB credentials + evaluation (3 steps); Oracle: checklist, **initial and final RMAN backup transfer**, restore on migration server, **SaaS Pull** into production | [V] | [ORA-OCM-UG] [ORA-OCM-RN] |
| Oracle Consulting "Journey to OPERA" (2019/2020) | Methodology | — | *New install* (clean config, import config from V5, **reservation & profile sync via third party**, minimal downtime) **vs** *migration* (retain all data and history, **potential for significant downtime**, cleaning required, test migration recommended); 640+ consultants + 450+ subcontractors globally; **OPERA Cloud Configuration Suite (OCCS)** pre-installation workbook | [V] | [ORA-CONSULT-2020] |
| Wyndham | ~2,000 additional hotels | **20 hotels/week**, franchisees "in days" | Brand programme | [S] | R01 |
| Minor Hotels | 106 properties, 59 countries | **~3 years** (2023 → Aug 2026) | OPERA Cloud + Central | [S] | [MINOR-ORA-2026] |
| Motel One | 100+ (or 110) hotels, 13 countries | "**six months**, all properties live" (opinion piece); dailypoint involvement since May 2025 | Internal teams + **Oracle Managed Services** | [S] [C] | [MOTELONE-ORA-2026] [HT-MOTELONE] |
| Shiji Daylight | 100+ hotels of one group | **two months** | Factory approach | [VC] | [SHIJI-2026] |
| HRS Data Migration Tool | OPERA V5 → OPERA Cloud, 10 properties, ~36,000 records | **15 reservations/min; 25 profiles/min; 25 rates/min; 50 packages/min** (≈ 900 reservations/hour) | XML from V5, code mapping, validation | [VC] | [HRS-DMT] |
| Chatlyn (consultancy) | OPERA 5 → OPERA Cloud, single property | **6–12 weeks** preparation | Clean-up and interface re-certification are long poles | [3P] | [CHATLYN-O5] |
| Mews | Independent / group | **Average ~2 months**; "as little as a week"; Roam Spokane **11 days**; 5 properties in 2 weeks (HTR) | Templates, guided setup, cloning a property (Ligula); **semi-automated imports + manual validation** (Jordans Untermühle from HS/3) | [VC] | [MEWS-MIGRATE] |
| Apaleo | citizenM, 18 cities | **~8 weeks** | Data migration from legacy | [S] | [CITIZENM-APALEO] |
| Apaleo + Omniboost | Valk Exclusief from IDPMS | Pilot completed May 2025 | **Custom** migration | [S] | [OMNIBOOST-VALK] |
| Cloudbeds | Independent | 2–4 weeks (R03) | **Paid** Reservation Import; **no cancelled/no-show import**; manual adjustments always needed | [S] | [CB-IMPORT] |
| Stayntouch | Independent / managed | — | CSV **Dataloader**; test files **one week before** import | [S] | [STAYNTOUCH-DATALOADER] |

**Synthesis [I].**
- Chain-scale programmes achieve **tens of hotels per week** only with a *standard configuration shell* (OCCS,
  brand templates) and a franchise mandate.
- For independents, "days" is achievable only when **history is not migrated** (fresh install + future
  reservations); full-history migrations take **weeks to months**.
- Oracle's own best path (OCM) is a **physical database copy** — impossible for a different vendor, so Portico must
  win with a *logical* migration that is faster to rehearse and safer to cut over (11).

## 2. Support models

| Vendor | Support signal | Label |
|---|---|---|
| Oracle | **Oracle Managed Services** sold to run monitoring, maintenance, incident management (Motel One); support via My Oracle Support portal; OHIP has its own support and "premium assistance" paths | [S] [V] |
| Mews | Mews University; ~weekly API changelog with deprecation policy; status not reviewed | [V] (R02) |
| Stayntouch | **Academy 2.0** training (Nov 2024) | [S] |
| Cloudbeds | Onboarding coach; post-go-live support complaints (R03) | [S] |
| General | German IT-security firm: PMS outages (Cloudbeds, protel, Mews, Apaleo, Sihot) "**several times a year**", often after updates or provider cloud issues; advice to bookmark status pages | [3P] [HAGEL-PMS] |
| Downtime practice | Recover multi-day outages **one business day at a time** from the latest backup reports; premise vs cloud outages differ | [S] [HU-RECOVERY] |

## 3. Training and competency

- Managers estimate **4 months to 3 years** for front-desk confidence (52.2%); **73%** trained informally; **38%**
  say usability affected leaving (Cloudbeds × NYU) [S] [VC] [CB-NYU-UX].
- HTR 2026: **26%** say staff training is the biggest switching barrier; **24%** say data migration complexity
  [3P] [HTR-PMS-2026].
- Oracle: role-based e-learning, OXI e-learning module free with OXI implementation (2020) [V] [ORA-CONSULT-2020].

## 4. Release management as part of delivery

- OPERA Cloud: ~5 releases/year; many features delivered **disabled** with *steps to enable* per property; Property
  APIs listed as release items from 26.2 [V] (02a §1.1).
- Mews: API changes dated weekly; deprecations documented; versioned operations [V].
- *Inference:* hotels experience change as **configuration work** (Oracle) or **surprise** (complaints about
  frequent updates at Infor, R01). Portico should give each property a **change calendar with previews** and a
  defer window — and count adoption of new features as a support metric.

## 5. Failure modes in implementations and switches (evidence)

| Failure | Evidence | Mitigation in Portico [I] |
|---|---|---|
| **Duplicate reservations and inflated revenue** after a CRS–PMS mismatch; payments not reaching the bank; hotel reverted within 2 months | FIDI Hotel (131 rooms) [S] [3P] [FIDI-CASE] | Reconciliation gates on reservation counts and on-the-books revenue *before* channel/CRS switch; duplicate detection on external IDs (11 §6) |
| **Champion leaves mid-project** | FIDI [S] | Migration that does not depend on one person: guided checklist, owners per step, autopilot |
| **History incomplete** (no cancelled/no-show import) | Cloudbeds import service [S] | Import every status incl. cancellations/no-shows (needed for RM and pace) |
| **Dirty profiles migrated intact** | Chatlyn; Mews warns old profiles "pollute" data [3P] [VC] | Duplicate scoring and merge suggestions *before* import; option to archive instead of import |
| **Masked/expiring data in exports** | Little Hotelier masking after 180 days [3P]; OPERA exports mask PII unless SFTP/HTTPS delivery [S] | Export early; prefer API/secure channels; detect masked values and flag |
| **Interface re-certification delays** | Chatlyn [3P] | Pre-certified connectors and validation runs before go-live (INT-R06) |
| **Lost payment details** | RoomRaccoon anecdote (R03) [3P] | Deposit and token reconciliation report; PSP-mediated card migration (11 §5) |
| **Long downtime during physical migration** | Oracle's own slide: "potential for significant downtime" [V] | Continuous delta sync with short freeze (11 §6) |
| **Legacy downtime ~6 h/week** (on-prem) | Sponsored HTR case [VC] | Reliability as an adoption argument |

## 6. Implications for Portico's delivery model [I]

1. Separate **"go-live with future business"** (days) from **"history complete"** (background, can finish after
   go-live) — both measured, both reconciled.
2. Make **rehearsal free and repeatable** (trial environment with copied data, `docs/adoption/evaluation-and-trial.md`).
3. Offer **standard shells** per property type (guesthouse, resort, city hotel) like OCCS, but self-service.
4. Publish a **support promise with night-time severity-1 coverage** for migrations (Q21) — complaints at Agilysys
   and Cloudbeds centre on after-hours and post-go-live support.
5. Track **time-to-competency** per role after go-live as a delivery KPI (03 §2).
