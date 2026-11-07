# Supported-market and jurisdiction matrix

Deliverable 5 of the operational-readiness brief (§11, §12). Owner: Operational Readiness lead; professional review by a
Maldives tax/legal adviser (not yet engaged — Q20). Last updated: 2026-11-07. Labels as defined in
`dependency-register.md`.

> **No market is "supported" today.** A market becomes supported only when every requirement row below is
> **validated** (by official source and, where needed, professional confirmation) and the tax/fiscal configuration has
> been tested. Tax rules are effective-dated **data** with source and verification date (CLAUDE.md §4.13); nothing
> below may be hard-coded. This document states facts and open questions — **it is not legal or tax advice**.

## 1. Supported-market register

| Market | Status | Validated requirements | Unvalidated requirements | Blocking for pilot there? |
|---|---|---|---|---|
| Maldives | **Candidate — first market (D3)** | TGST rate and green tax rates (secondary-to-official sources, §2.2–2.3) | Service charge treatment, invoice contents, filing, guest reporting, FX rules, data protection, retention (§2) | Yes, until §2 rows marked "must validate before pilot" are confirmed |
| UAE, Sri Lanka, India, Seychelles, Mauritius, EU, US | Not supported; research only (§3) | Partial (see §3) | Most | N/A (no pilot planned) |

Validation status vocabulary: **Validated** = official source read and dated, plus professional confirmation where the
row says so. **Partially validated** = rate/rule seen in a reliable secondary source, primary not read. **Unvalidated** =
background knowledge or unknown.

---

## 2. Maldives (deep section)

Time zone: `Indian/Maldives`, UTC+05:00, no daylight-saving time `[unconfirmed — per IANA tz database, not re-checked]`.
Many resorts are reported to run on "island time" (clock set ahead of Malé time) `[unconfirmed]` — see
`support-recovery-plan.md` §7.

### 2.1 Summary

| Requirement (readiness brief §11) | Finding | Validation | Must validate before pilot? |
|---|---|---|---|
| Tourism GST (TGST) | **17%** from 1 Jul 2025 (previously 16%) | Partially validated `[verified 2026-11-07]` via KPMG; MIRA primary not read | Yes (MIRA) |
| General GST (non-tourism supplies) | 8% `[unconfirmed]` | Unvalidated | Yes (some guesthouse supplies may be non-tourism) |
| Green tax | **$12** per guest-night (resorts, integrated resorts, tourist vessels, uninhabited-island properties, inhabited-island properties >50 rooms); **$6** (≤50 rooms on inhabited islands), from 1 Jan 2025 | Partially validated `[verified 2026-11-07]` via KPMG / Atoll Times / Travel Trade Maldives | Yes (MIRA): exemptions, child rules, rounding of partial nights |
| Service charge | Customarily 10%; distribution to staff required by employment law `[unconfirmed]`; whether TGST is levied on it `[unconfirmed]` | Unvalidated | **Yes** |
| Invoice requirements | Tax invoice content rules under GST law `[unconfirmed details]` | Unvalidated | **Yes** |
| Fiscal devices / e-invoicing / real-time submission | None identified `[unconfirmed]` | Unvalidated | Yes (confirm absence) |
| MIRA filing and reporting | Periodic GST and green tax returns by the hotel `[unconfirmed periods/formats]` | Unvalidated | Yes (report formats) |
| Guest registration / tourism reporting | Requirements to keep guest registers and report statistics `[unconfirmed]` | Unvalidated | **Yes** |
| Passport / document retention | `[unconfirmed]` | Unvalidated | Yes |
| Currency, rounding, exchange rates | USD pricing common in resorts; MVR legal tender; MMA rules on foreign-currency conversion/pricing `[unconfirmed]` | Unvalidated | **Yes** |
| Privacy, data location, transfers | No comprehensive data-protection statute confirmed `[unconfirmed]`; constitutional privacy right `[unconfirmed]` | Unvalidated | Yes |
| Accessibility & consumer disclosures | `[unconfirmed]` | Unvalidated | No (booking engine is a later wave) |
| Payment authentication & local methods | Local acquirers (BML etc.); Stripe/Adyen believed unavailable for Maldivian entities `[unconfirmed]` | Unvalidated | Yes (if processing payments) |
| Marketing & e-communications | `[unconfirmed]` | Unvalidated | No (marketing automation later) |
| Record retention & audit access | Tax record retention period `[unconfirmed]` | Unvalidated | **Yes** |

### 2.2 Tourism GST (TGST)

- **Rate:** 17% on tourism goods and services from **1 July 2025**, up from 16% `[verified 2026-11-07]` — source:
  KPMG tax news flash ([KPMG](https://kpmg.com/us/en/taxnewsflash/news/2024/11/tnf-maldives-amendments-gst-tourism-act-airport-fees-ratified.html)),
  as cited in R04 §C3. MIRA's own publication (mira.gov.mv) **was not read** — re-verify there.
- **Scope:** which supplies are "tourism goods and services" (accommodation, F&B, excursions, transfers, spa, retail in
  resorts) and how a guesthouse's non-tourism supplies are taxed `[unconfirmed]`.
- **Portico configuration (planned):** `rates` tax rule `MV-TGST` with `effective_from = 2025-07-01`, `rate = 17%`,
  `source = KPMG URL`, `verified = 2026-11-07`, plus historical rule 16% for stays/services before that date so that
  historical documents recompute identically. Which date governs a stay spanning a rate change (service date per night
  vs invoice date) is **unvalidated** — default: per-night service date `[assumption]`.

### 2.3 Green tax

- **Rates from 1 January 2025:** **$12 per person per night** for resorts, integrated resorts, tourist vessels,
  properties on uninhabited islands, and inhabited-island properties with **more than 50 rooms**; **$6 per person per
  night** for properties with **50 rooms or fewer on inhabited islands** `[verified 2026-11-07]` — sources: KPMG (above),
  Atoll Times ([atolltimes.mv/post/news/10320](https://atolltimes.mv/post/news/10320)), Travel Trade Maldives
  ([traveltrademaldives.com/?p=73459](https://www.traveltrademaldives.com/?p=73459)) per R04. MIRA primary not read.
- **Unvalidated details:** exemptions (e.g. children by age, Maldivian nationals, work-permit holders), cap on nights
  if any, how a property's class/room count is determined and when it changes, rounding, invoice presentation, whether
  it is charged per night of stay or per night of business date, whether TGST applies on top of green tax (believed
  **not** — green tax is a tax, not consideration `[unconfirmed]`).
- **Portico configuration (planned):** per-person-per-night fee rule keyed by property classification, with occupant
  age rules as data. Property classification (resort / inhabited-island ≤50 / >50) is a dated property attribute.

### 2.4 Service charge

- **Practice:** 10% service charge is customary on room and F&B bills `[unconfirmed]`.
- **Employment law:** the Employment Act (as amended) is believed to require that service charge collected by tourism
  businesses be distributed to employees, with a minimum share and timing rules `[unconfirmed — exact percentage and
  rules not confirmed; do not encode]`.
- **Tax base:** common practice is to compute TGST on the price **including** service charge (i.e. service charge is
  part of the consideration) `[unconfirmed]`. Example (illustrative only, `[assumption]`): room $500 → service charge
  10% = $50 → TGST 17% × $550 = $93.50 → green tax $12 × 2 guests = $24 → total $667.50. **Must be confirmed with MIRA
  guidance before any live invoice.**
- **Portico configuration (planned):** service charge is a configurable *fee rule* (percentage, applicable charge
  codes, taxable yes/no, compounding order) — not a tax; its distribution reporting (total collected per period) is an
  `analytics`/`finance` report the hotel uses for payroll. Portico does not calculate staff distributions.

### 2.5 Invoices, credit notes and numbering

- Tax invoice contents (supplier name/address, TIN/GST registration number, invoice serial number, date, description,
  quantity, price, tax rate, tax amount, total; recipient details for registered recipients) `[unconfirmed]` — this list
  is a placeholder from general GST practice and **must be replaced by MIRA's actual list**.
- Currency on invoices: whether invoices may be in USD and whether the GST amount must also be shown in MVR at a
  prescribed rate `[unconfirmed]`.
- Credit notes / debit notes for corrections; sequential numbering; whether gaps are permitted `[unconfirmed]`.
  Portico design regardless: gapless series per legal entity, immutable issued documents, corrections via linked
  credit notes, idempotent issuance (a retry never consumes a new number).
- Simplified invoices / receipts for B2C `[unconfirmed]`.

### 2.6 MIRA filing and reporting

- GST (incl. TGST) and green tax are filed by the hotel's legal entity through MIRA's online system; taxable periods
  (monthly/quarterly) and due dates `[unconfirmed]`.
- Portico provides period reports (taxable supplies by rate, TGST collected, green tax by guest-nights and rate,
  service charge collected, adjustments/credit notes) — **the hotel files**; Portico makes **no government submission**
  without owner authorization (CLAUDE.md §1).
- Withholding tax and other taxes (e.g. on payments to non-residents) `[unconfirmed]` — relevant to Monoclay's SaaS fee
  (§2.11).

### 2.7 Guest registration and government reporting

- Whether tourist establishments must keep a guest register with prescribed fields (name, nationality, passport number,
  arrival/departure) and report arrivals/departures or occupancy statistics to the Ministry of Tourism and/or
  Immigration, and at what frequency `[unconfirmed]`.
- Immigration pre-arrival declaration is believed to be completed by travellers themselves `[unconfirmed]`.
- Portico design: configurable registration-card fields (data-driven per market), exportable reports; identity
  documents field-encrypted with restricted access. Format/portal for any submission `[unconfirmed]`.

### 2.8 Currency, rounding and exchange rates

- Resorts commonly price and invoice in USD; guesthouses may price in USD or MVR `[unconfirmed]`.
- Maldives Monetary Authority (MMA) rules on: pricing in MVR vs foreign currency, acceptance of MVR, mandatory
  conversion/sale of foreign-currency receipts by tourism businesses, and the official exchange rate used for tax
  reporting — **all `[unconfirmed]`**; there have been reported regulatory changes in this area that must be checked
  against the current regulation text before pilot.
- Portico design: property base currency + per-transaction currency; explicit exchange rates with source and timestamp;
  settlement differences posted as separate ledger lines (brief §9). Rounding: per currency exponent (MVR and USD both 2
  decimals `[unconfirmed for MVR cash rounding]`), round once per documented rule.

### 2.9 Privacy, data location and international transfers

- No comprehensive data-protection law in force was confirmed; a draft bill has been discussed in the past
  `[unconfirmed]`. Constitutional privacy rights and sector rules (e.g. banking secrecy, telecom) may apply
  `[unconfirmed]`.
- Hotels serving EU/UK residents: GDPR applicability is **not** determined by guest nationality alone (readiness brief
  §12); it depends on establishment and targeting — a question for counsel per hotel, not a Portico assumption.
- Data location: Portico default region is AWS `ap-south-1` (India) (Q4); no Maldives data-localization rule confirmed
  `[unconfirmed]`.

### 2.10 Record retention and audit access

- Retention period for tax records (invoices, ledgers) under Maldives tax administration law `[unconfirmed — believed
  to be several years; do not encode until confirmed]`.
- Employment records (service charge distribution), guest registers, identity documents `[unconfirmed]`.
- Portico default until confirmed: retain financial records **indefinitely** within the hotel's tenant (can be
  shortened, never silently), identity documents per hotel policy with a conservative default (see
  `security-privacy-readiness.md` §4).

### 2.11 Monoclay's own Maldives position (separate from hotels)

These are **Monoclay's** questions, not the hotel's (readiness brief §11 "separate our software-company obligations"):

1. Does a Maldivian hotel paying Monoclay LLC (US) a SaaS fee have to withhold Maldivian tax? At what rate, and does the
   US–Maldives position (no treaty known `[unconfirmed]`) matter?
2. Must Monoclay register for Maldives GST on digital services supplied to Maldivian businesses (or does the hotel
   self-account)?
3. Does the founder's residence in the Maldives create a Maldivian taxable presence for Monoclay LLC? (Question for a
   tax adviser — **no conclusion drawn here.**)
4. Does selling software to Maldivian businesses require any local registration or licence?

### 2.12 Precise questions for a Maldives tax/legal adviser and MIRA

1. Confirm TGST rate history (16% → 17% on 1 Jul 2025) and the rule for a stay spanning a rate change.
2. Is service charge part of the TGST taxable value? Is green tax excluded from it?
3. Green tax: exemptions (age, nationality, residence), definition of "night", class determination (50-room
   threshold — counted how, and when re-evaluated), presentation on invoices.
4. Mandatory tax-invoice contents, invoice currency rules, MVR equivalents and the exchange rate to use, credit-note
   rules, numbering/gap rules, simplified receipts.
5. Filing periods and formats for GST/TGST and green tax; any electronic invoicing or reporting obligation from software.
6. Employment Act service-charge distribution rules (percentage, timing, records) that a PMS should report on.
7. Guest register and reporting obligations (Ministry of Tourism, Immigration, police) — fields, frequency, channel.
8. MMA foreign-exchange rules affecting pricing currency, acceptance of MVR, and conversion of USD receipts.
9. Data-protection status; rules on storing passport copies; cross-border hosting of guest data (India region).
10. Record-retention periods for tax, employment and guest records.
11. §2.11 questions about Monoclay itself.

---

## 3. Next likely markets (lighter section)

Legend: **V** = validated (`[verified 2026-11-07]`, official/primary source), **P** = partially validated
(`[secondary, read 2026-11-07]`), **U** = unvalidated. Sources are R04 §C1–C3 unless stated. Nothing here supports a
launch decision.

| Requirement | UAE | Sri Lanka | India | Seychelles | Mauritius | EU (varies by member state) | US (varies by state/city) |
|---|---|---|---|---|---|---|---|
| Accommodation taxes / tourism levies | **V** Dubai Tourism Dirham AED 7–20 per room-night by class, max 30 nights (rules: [Dubai Res. 2/2020](https://dlp.dubai.gov.ae/Legislation%20Reference/2020/Administrative%20Resolution%20No.%20(2)%20of%202020%20Prescribing%20the%20Rules%20for%20Calculating,%20Collecting,%20and%20Paying%20the%20Tourism%20Dirham%20Fee%20in%20the%20Emirate%20of%20Dubai.html)); rates **P**; Abu Dhabi fees **U** | **U** (tourism levies believed to exist `[unconfirmed]`) | **U** | **U** (per-night visitor levy believed to exist `[unconfirmed]`) | **U** | **P/U** municipal tourist taxes vary (e.g. Italy `[secondary]`) | **P** layered state/county/city occupancy taxes; no public database |
| VAT / GST / sales tax | **U** 5% VAT `[unconfirmed]` | **U** | **P** hotel GST 5% (≤ ₹7,500/night, no ITC) / 18% above, from 22 Sep 2025 | **U** | **U** | **P/U** per country | **P** occupancy + sales tax by jurisdiction |
| Service charges | **U** Dubai municipality fee + service charge `[unconfirmed]` | **U** | **U** | **U** | **U** | **U** | **V** FTC rule: mandatory fees in total price for short-term lodging since 12 May 2025 ([Federal Register](https://www.govinfo.gov/content/pkg/FR-2025-01-10/html/2024-30293.htm)) |
| Invoice numbering, credit notes, fiscal reporting | **U** | **U** | **V** e-invoice reporting within 30 days for AATO ≥ ₹10 crore ([GSTN advisory](https://www.mahagst.gov.in/public/uploads/gstnadvisory/1760531580_293%20Advisory%20Time%20Limit%20for%20Reporting%20e%20Invoice%20on%20the%20IRP%20Portal%20%20Lowering%20of%20Threshold%20to%20AATO%2010%20Crores%20and%20Above.pdf)) | **U** | **U** | **V/P** DE TSE, AT RKSV ([USP.gv.at](https://www.usp.gv.at/themen/steuern-finanzen/steuerliche-rechte-und-pflichten/registrierkassen/registrierkassenpflicht.html)), IT, FR, PT, ES regimes | **U** |
| E-invoicing / government submission | **P** Peppol PINT-AE, AED 50m+ from 1 Jan 2027; others from Jul 2027; dates conflict | **U** | **V** IRP e-invoicing (B2B) | **U** | **U** | **P** DE/FR/PT/ES/IT mandates (dates in R04 §C3) | **U** (none federal `[unconfirmed]`) |
| Guest registration / identity records | **U** | **U** | **U** Form C for foreign nationals `[unconfirmed]` | **U** | **U** | **P/U** e.g. Italy Alloggiati Web `[secondary]`; Spain SES.HOSPEDAJES `[unconfirmed]` | **U** |
| Passport / document retention | **U** | **U** | **U** | **U** | **U** | **U** (GDPR minimisation + national rules) | **U** |
| Currency, rounding, FX | **U** AED | **U** LKR | **U** INR | **U** SCR | **U** MUR | EUR/others **U** | USD **U** |
| Privacy, data location, transfers | **U** UAE PDPL; DIFC/ADGM regimes `[unconfirmed]` | **U** Personal Data Protection Act `[unconfirmed]` | **U** DPDP Act 2023 `[unconfirmed]` | **U** | **U** Data Protection Act `[unconfirmed]` | **P** GDPR (applicability by establishment/targeting) | **U** state privacy laws |
| Accessibility & consumer disclosures | **U** | **U** | **U** | **U** | **U** | **U** European Accessibility Act `[unconfirmed]` | **V** FTC fees rule (above); ADA **U** |
| Payment authentication & local methods | **U** (3DS norms) | **U** | **U** (RBI rules `[unconfirmed]`) | **U** | **U** | **V** SCA: mandate set-up subject to SCA, later MITs out of scope ([EBA Q&A](https://www.eba.europa.eu/single-rule-book-qa/qna/view/publicId/2019_4791)) | **U** |
| Marketing & e-communications | **U** | **U** | **U** | **U** | **U** | **U** ePrivacy + GDPR | **U** CAN-SPAM/TCPA `[unconfirmed]` |
| Record retention & audit access | **U** | **U** | **U** | **U** | **U** | **P** 6–10 years typical `[secondary]` | **U** |
| Payments eligibility (Stripe/Adyen) | **U** believed supported `[unconfirmed]` | **U** | **U** | **U** | **U** | **U** broadly supported `[unconfirmed]` | **U** supported `[unconfirmed]` |

Market-entry rule: each country's fiscal/e-invoicing pack is a **market-entry gate** (R04 decision 6). EU fiscal
markets (DE, AT, IT, FR, PT, ES) each need a dedicated compliance release and possibly per-product certification
(e.g. Portugal AT software certification `[secondary, read 2026-11-07]`).
