# Maldives tax and reporting rules for Portico

**Researched:** 2026-11-07 · **Status:** working reference for engineering — **not legal or tax advice**.
A Maldives tax adviser must confirm before any live invoice is issued (OPEN_QUESTIONS Q20).

**Source method.** Every rule below comes from the Maldives Inland Revenue Authority (MIRA) or the Ministry of
Tourism's own published pages, regulations, circulars and FAQs. MIRA's website blocks automated page fetches
(bot protection), so the text was read from the official pages' content as indexed by web search, restricted to
`mira.gov.mv` / `tourism.gov.mv`. Where MIRA publishes English text it is marked "unofficial translation"; the
Dhivehi gazette text is authoritative. Each rule's status: **verified (official page)**, **verified (official
regulation text, consolidated — check for later amendments)**, or **unconfirmed**.

## Summary for the tax engine (data, not code — CLAUDE.md rule 13)

| Rule | Value | Effective | Status | Source |
|---|---|---|---|---|
| Tourism GST (TGST) | **17%** | supplies with time of supply on/after **2025-07-01** | verified (official page + circular) | [MIRA GST overview](https://mira.gov.mv/Pages/View/gst), [MIRA circular on TGST rate change](https://www.mira.gov.mv/ContentItems/View/circular-issued-changes-to-tgst-rate) |
| TGST (history) | 16% | 2023-01-01 → 2025-06-30 | verified (official page) | same |
| TGST (history) | 12% (general sector 6%) | 2014-11-01 → 2022-12-31; 6th amendment raised to 16% / 8% from 2023-01-01, same 24-hour-operator midnight rule | verified (official news item) | [MIRA: GST rate changes from 1 January 2023](https://www.mira.gov.mv/ContentItems/View/newsgstratechange) |
| General-sector GST | 8% | current | verified (official page) | [MIRA GST overview](https://mira.gov.mv/Pages/View/gst) |
| Green Tax — resorts, integrated resorts, resort hotels, hotels, guesthouses, tourist vessels | **USD 12 per guest per day** | from **2025-01-01** | verified (official circular + amendment) | [MIRA circular on Green Tax rates from 1 Jan 2025](https://www.mira.gov.mv/ContentItems/View/circular-re-changes-to-grt-rates-on-20250101-news), [14th amendment to the Tourism Act](https://www.mira.gov.mv/Legislations/View/14-th-amendment-to%20the-tourism-act) |
| Green Tax — hotels and guesthouses on **inhabited islands** with **≤ 50 registered rooms** | **USD 6 per guest per day** | from 2025-01-01 | verified (official circular) | same |
| Green Tax — guesthouses > 50 rooms or on uninhabited islands | USD 12 | from 2025-01-01 | verified (official circular) | same |
| Green Tax — children under 2 at check-in | **exempt** | from 2025-01-01 | verified (official circular) | same |
| Green Tax — complimentary (free) stays | **still payable** | current | verified (official FAQ) | [MIRA Green Tax FAQ](https://mira.gov.mv/Pages/View/FAQ_GreenTax) |
| Green Tax — what counts as a day | each 24-hour block; the check-out block counts if the guest spent **12 hours or more** in it | current | verified (official FAQ), confirm still applies after 2025 amendment | [MIRA Green Tax FAQ](https://mira.gov.mv/Pages/View/FAQ_GreenTax) |
| Green Tax and GST | **GST is not charged on Green Tax**; the Green Tax amount must be **stated clearly** on the invoice/receipt to be excluded from the GST base | current | verified (Green Tax Regulation reg. 16 + FAQ) | [Green Tax Regulation (consolidated)](https://mira.gov.mv/Legislations/View/Green-tax-regulation), [FAQ](https://mira.gov.mv/Pages/View/FAQ_GreenTax) |
| Service charge and GST | Service charge is **part of the taxable value** at the rate of the underlying supply; **voluntary tips are not** | current | verified (GST Regulation, consolidated) | [GST Regulation (consolidated)](https://www.mira.gov.mv/Legislations/View/Goods-and-Services-Tax-Regulation-consolidated) |
| Service charge level (employment law) | Tourism businesses must levy **at least 10%** service charge and distribute it to employees (after a small administrative deduction — exact rule unconfirmed); an Employment Act amendment on paying staff in the **collected currency** was accepted by Parliament in April 2026 and sent to committee — **not yet law as far as found** | current / pending | unconfirmed (news sources; Labour Relations Authority regulation not read directly) | [Atoll Times](https://atolltimes.mv/post/business/15673), [LRA: Service Charge Regulation gazetted](https://lra.gov.mv/2021/03/), [PSM News](https://psmnews.mv/en/178784) |

## Detailed rules and what Portico must do

### 1. TGST rate and the "time of supply" (critical for deposits)
- The tourism rate is set by the **time of supply**, the **earlier of invoice issue or payment**, not by the stay
  date. MIRA's circular says TGST at the new rate applies where the time of supply is on or after 1 July 2025.
  (verified: MIRA circular; GST Regulation)
- **Portico impact:** a deposit/prepayment creates a tax point when received. The tax engine must compute TGST on
  deposits at the rate in force at payment time, and the final invoice must account for tax already declared on
  deposits (no double taxation, no rate re-application). Rates are effective-dated data; a future rate change
  must not alter tax already fixed by an earlier time of supply. Implement as a property of the tax rule:
  `taxPoint: 'time_of_supply' (earlier of invoice | payment)`.
- 24-hour operators: supplies before 00:00 on the change date at the old rate, from 00:00 at the new rate.

### 2. Registration
- Supplying tourism goods/services triggers **mandatory tourism-sector GST registration regardless of turnover**
  (the MVR 1,000,000 threshold does not apply). Activities inside a tourist hotel/guesthouse premises register in
  the tourism sector (Tax Ruling TR-2016/G40). Tourism and general-sector activities are registered separately.
  (verified: [MIRA GST FAQ](https://www.mira.gov.mv/Pages/View/FAQ_GST), [GST Regulation](https://www.mira.gov.mv/Legislations/View/Goods-and-Services-Tax-Regulation-consolidated))
- **Portico impact:** legal entities carry a tourism-sector TIN; outlets inside the premises default to tourism
  sector; an outlet registered in the general sector (8%) must be configurable explicitly.

### 3. Currency
- Tax on tourism-sector supplies is **paid to MIRA in US dollars** (GST Act §… currency provision; the Minister
  may require MVR). Tourism-sector GST returns are prepared in USD. Green Tax is paid in USD.
- If a tourism registrant issues or receives an invoice in another currency, it must convert to **USD at a rate
  within ±2% of the Maldives Monetary Authority (MMA) rate** for the time of supply.
  (verified: [GST Act consolidated](https://www.mira.gov.mv/Legislations/View/Goods-And-Services-Act-consolidated),
  [GST FAQ](https://www.mira.gov.mv/Pages/View/FAQ_GST), [MIRA Guide to Currency and Exchange Rate (M818)](https://www.mira.gov.mv/Files/GetFile/1bfa3873-7bb7-4849-8175-4da5728b1196) — the guide is about two years old; confirm it is current)
- **Portico impact:** Maldives properties default to USD base currency for tourism-sector tax reporting; any
  non-USD invoice records the USD conversion rate used, its source (MMA) and date, and validates it is within ±2%.

### 4. Tax invoices
- A registered supplier must issue a **tax invoice or receipt within 3 days** of completing a service (and within
  28 days on request by a registered buyer).
- Required particulars include: prominent "Tax Invoice" title; supplier name, address and TIN; buyer name,
  address and TIN where applicable; **invoice number (software-generated or pre-printed serial)**; date; description;
  value before tax; tax charged; total including tax. Tourism tax (Green Tax) amounts must be **stated clearly**.
  (verified: [MIRA Tax invoice page](https://www.mira.gov.mv/Pages/View/gsttaxinvoice), [GST Act](https://www.mira.gov.mv/Legislations/View/Goods-And-Services-Act-consolidated))
- No MIRA **e-invoicing mandate** was found as of 2026-11-07 (unconfirmed — absence of evidence; adviser to confirm).
- **Portico impact:** fiscal document ledger with gapless software-generated numbers per legal entity/series
  (already in the finance spec), mandatory fields enforced at issue time, Green Tax shown as its own line, service
  charge within the GST base, tips outside it, issuance-deadline monitoring (3 days) surfaced as a Day Close check.

### 5. Green Tax mechanics
- Charged per guest per 24-hour block; the check-out block counts if ≥ 12 hours were spent in it; children under 2
  exempt; complimentary stays still taxable; paid monthly to MIRA in USD by the **28th of the following month**
  (Green Tax return MIRA 501). (verified: [Green Tax FAQ](https://mira.gov.mv/Pages/View/FAQ_GreenTax),
  [Green Tax return guide (MIRA 501)](https://www.mira.gov.mv/Files/GetFile/c34fbdce-c81d-45d8-8c06-1fe73dbe9a92))
- Rate depends on the establishment type and, for hotels/guesthouses, on **inhabited island + registered room
  count ≤ 50** → `platform.properties.classification` keys `mv.establishmentType`, `mv.inhabitedIsland`,
  `mv.registeredRooms` (rename from `mv.roomCount`: it is the **registered** room count that matters).
- **Portico impact:** Green Tax is a per-person-per-day fee rule with age exemption, a 12-hour check-out rule,
  complimentary-stay inclusion, excluded from the GST base, and a monthly Green Tax report per legal entity.

### 6. Record retention
- Tax documents must be kept **at least 5 years from the end of the tax year** they relate to; MIRA may require
  longer during an audit. (verified: [Tax Administration Act (consolidated)](https://www.mira.gov.mv/Legislations/View/tax-admin-act))
- **Portico impact:** retention schedule minimum 5 years after year-end for fiscal documents, ledgers and
  supporting records, with legal-hold extension; guest erasure requests anonymize profiles but keep fiscal records
  until retention ends (CLAUDE.md; readiness brief §12).

### 7. Tourism statistics reporting (Ministry of Tourism)
- Registered tourist establishments (resorts, hotels, guesthouses, vessels…) must submit **occupancy reports,
  arrivals by nationality and employee details** through the Ministry's **Tourism Information Management System
  (TIMS)**; the Ministry's TIMS page refers to **weekly and monthly** reports. Regulation number cited as
  2020/R-39 in one Ministry circular (older 2011/R-19 also referenced) — confirm which applies.
  (verified: [Ministry of Tourism — TIMS](https://tourism.gov.mv/en/page/tourism_information_management_system_tims_),
  [Ministry circular: reminder of submission of statistical reports](https://tourism.gov.mv/en/circulars/reminder_of_submission_of_statistical_reports))
- **Portico impact:** a Maldives statistics report (bed-nights, occupancy, arrivals by nationality) exportable in the
  format TIMS needs. TIMS submission is a government submission (`government.submit` effect — blocked outside
  live); until a TIMS interface is confirmed, it is a **file/manual export, never presented as an integration**.

### 8. Not Portico's obligation (for clarity)
Airport taxes and fees are collected through airline tickets (Airport Taxes and Fees Act), not by hotels.
Business profit / income tax is the hotel's accounting matter; Portico provides exports.

## Open items for the Maldives adviser (Q20)
1. Exact Green Tax daily-block rule after the 2025 amendment, and treatment of day-use rooms.
2. TGST on deposits that are later forfeited (cancellation) and on cancellation fees.
3. Whether the service-charge employee distribution must be evidenced from PMS data (and in which currency, if the
   pending Employment Act amendment passes).
4. Whether MIRA requires invoices to show MVR equivalents, and any e-invoicing plans.
5. TIMS report formats and whether an API/file interface exists for software vendors.
6. Rules for tourist vessels / liveaboards if Portico supports them.
