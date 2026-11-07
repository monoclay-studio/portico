# Back-of-house modules — overview

Status: Draft v1 · 2026-11-07 · Proposal for owner review (Q100). Branch `docs/back-of-house-specs`.

The owner asked for Portico to "also solve accounting, room charges, F&B, procurement etc etc". The original brief
(§12) warns against shallow versions of enterprise functions and asks for defined boundaries. This package answers
both: **seven deep modules, built in stages, each with an explicit boundary and a coexistence mode for hotels that
keep their own systems.**

| Spec | Module (schema) | In one line |
|---|---|---|
| [`accounting.md`](../specs/accounting.md) | `accounting` | Complete books on the one finance journal: payables, bank reconciliation, close, USALI-aligned statements, MIRA return data, assets, budgets, owners, ERP export |
| [`fnb-pos.md`](../specs/fnb-pos.md) | `fnb-pos` (`fnb_pos`) | Outlet POS (menus, tables, kitchen, settlement, offline) and the single intake for external POS charges |
| [`procurement.md`](../specs/procurement.md) | `procurement` | Requisition → approval → PO → shipment via Malé → jetty receipt → landed cost → three-way match |
| [`stock.md`](../specs/stock.md) | `stock` | Stores, movements, counts, costing, recipes, theoretical vs actual, minibar, linen/amenities, fuel |
| [`workforce.md`](../specs/workforce.md) | `workforce` | Employees, forecast-driven rosters, attendance, leave, staff village, certifications, Xpat compliance, service-charge distribution; payroll exported |
| [`concessions.md`](../specs/concessions.md) | `concessions` | Partner-run dive centres/spas/boutiques: charges on behalf, revenue share, recharges, settlements |
| [`utilities.md`](../specs/utilities.md) | `utilities` | Meters, power/water/fuel/waste, plant efficiency, cost allocation, emissions and sustainability packs |

Supporting documents: [`scenarios.md`](scenarios.md) (proof scenarios B01–B20) and
[`spec-change-requests.md`](spec-change-requests.md) (CR-01…CR-35: what existing specs, the domain map, glossary,
editions and adoption documents must change). Owner questions: **Q100–Q109** in `docs/OPEN_QUESTIONS.md`.

## 1. The architectural decision: one journal, many sub-ledgers

ADR-0008 already makes a double-entry journal per legal entity the financial source of truth. Back-of-house does
**not** add a second ledger. `finance` stays the ledger kernel (journal, account posting identity, period locks, FX)
and the **hotel ledger** (folios, guest ledger, deposits, city ledger, cashier sessions, guest fiscal documents).
Every other module owns its **sub-ledger** of open items and posts through one new contract,
`finance.postJournal`, onto **control accounts it owns** — AP (`accounting`), bank (`accounting`), stock asset
(`stock`), fixed assets (`accounting`) — with **clearing accounts** carrying keys for hand-offs between modules
(goods received not invoiced `grn:{line}`, landed cost `lc:{shipment}:{component}`, service-charge distribution
`scdist:{run}`, concession settlement `cnc:{settlement}`, cash deposits `dep:{slip}`). Consequences:

- Reconciliation by construction: every control account equals its sub-ledger after every transaction (tested
  invariants ACC-I02, STK-I02, PRC-I03, CNC-I01 plus FIN-I14).
- Every statement figure drills to the folio posting, check, receipt, voucher or payroll import behind it.
- A hotel that keeps its ERP still gets clean sub-ledgers; the journal is exported, never double-posted.
- Business date (Day Close) and accounting date (period close) are separate concepts (CR-04/05, ADR-0016 proposal).

Dependency arrows stay acyclic (verified in CR-24): `accounting ─► finance`; `procurement ─► accounting, stock`;
`stock ─► finance, resort`; `fnb-pos ─► finance, reservations, guests, rates, resort, payments`;
`workforce ─► identity, finance, analytics, operations`; `concessions ─► finance, accounting, utilities, workforce`;
`utilities ─► operations, stock, accounting`. Reverse information flows travel as events.

## 2. Key boundary decisions

| Decision | Choice | Where |
|---|---|---|
| Hotel ledger vs back-office accounting | `finance` keeps guest-side money and the journal kernel; `accounting` adds payables, bank, close, statements, assets, budgets, agreements | ACC §2.1 |
| Payroll | **Not built.** Portico computes payroll *inputs* (hours, leave, days worked, service-charge shares) and checks the payroll journal that comes back; the provider computes gross-to-net, EWT (MIRA 601) and pension | WFM §15, Q101 |
| Salaries in Portico | Never stored; cost bands for forecasting; per-employee service-charge shares stored field-restricted (needs IDN-R13 amendment) | Q102, CR-21 |
| Money movement | Portico prepares payment instructions and files; the hotel's bank executes; "paid" only after statement match | ACC-R15, CR-25 |
| Government submissions (MIRA, Xpat, LRA) | Manual filing with references recorded; no interface without owner authorization | ACC-R37, WFM-R19 |
| External POS | Coexists through the POS intake API; one charge source per outlet | FNB-R26, CR-12 |
| POS hardware | Supported list with evidence; no resale; manual fallbacks | FNB-R28, Q108 |
| Customs, freight booking | Recorded, not performed (clearing agents and carriers) | PRC-R18 |
| Supplier master | One payee master in `accounting`; procurement extends it | ACC-R10, PRC-R01 |
| Data authority | New governed domains `payables`, `purchasing`, `stock`, `staffRecords`, `timeAttendance`; `accounting` narrowed | CR-12 |
| Concession charges | Agent model by default (liability, not revenue) pending adviser | CNC-R03, Q104 |
| Terminology | Goods are **stock** in **stores**; **inventory** stays accommodation availability | STK header, CR-23 |

## 3. Recommended build order (stages BOH-0 … BOH-5)

The back-of-house stages follow the pilot slice (`docs/readiness/roadmap-critical-path.md`): they must not delay the
guesthouse-first pilot (Q26). Each stage is usable on its own and coexists with external systems.

| Stage | Content | Depends on (existing) | Why this order |
|---|---|---|---|
| **BOH-0** Ledger contracts | CR-02…CR-05, CR-12, CR-21, CR-23, CR-24, CR-25 (finance `postJournal`, control owners, clearing accounts, accounting date, period states, new domains, approval chains, `message.supplier`) | finance wave 1, platform, identity | Small, foundational; everything else posts through it; cheap now, expensive to retrofit |
| **BOH-1** F&B POS | `fnb-pos` incl. quick post and external POS intake (moved from resort), CR-09/10/13/15/20/33/34 | finance, reservations, rates, resort (wave 3 meal plans), payments | Resort pilots (RS-2) need room charges and entitlements first; revenue-bearing; brief S10/S19/S20 |
| **BOH-2** Accounting core (stage A) | Reporting structure, journals, payables (incl. commissions and OTA invoices), bank reconciliation, close cockpit, statements, MIRA return data, ERP export profiles, migration of opening positions | BOH-0, finance, integration | Gives every later module somewhere to post; replaces spreadsheets for guesthouses (RS-1 "books") |
| **BOH-3** Procurement + stock | P2P with island logistics and landed cost; stores, counts, costing, recipes, minibar, linen/amenities, fuel | BOH-2 (AP, budgets optional), BOH-1 (sold items) | Three-way match needs AP; theoretical consumption needs POS facts |
| **BOH-4** Workforce | Employees, rosters, attendance, leave, housing, certifications, Xpat compliance, service-charge distribution, payroll export | finance (CR-11), analytics forecasts, operations | Service charge needs the posted fund; rosters need forecasts |
| **BOH-5** Depth | Concessions, utilities; accounting stage B/C (fixed assets, budgets, cash management, management agreements, owner pack; consolidation LATER) | BOH-2…BOH-4 | Uses everything above (meters → recharges → settlements → allocations) |

If the owner chooses a **resort pilot first** (Q26), BOH-1 moves before the end of wave 3 and BOH-2's export profiles
(ACC-R49) come with it, because the resort will keep its ERP initially.

## 4. Build natively vs integrate

| Area | Build natively | Integrate (coexist) | Never |
|---|---|---|---|
| Accounting | Journal sub-ledgers, AP, bank rec, close, statements, tax return data, assets, budgets, management fees | Xero, QuickBooks, NetSuite, SAP, SunSystems, Dynamics BC (export/document sync); group consolidation tools | Audit opinions, tax advice, executing bank payments |
| F&B | Outlet POS, KDS, quick post, offline, entitlement-aware settlement | Simphony, Infrasys, InfoGenesis, Lightspeed, local POS via intake API; reservation platforms | Terminal firmware, card data, hardware resale |
| Procurement | Requisitions, approvals, POs, shipments, landed cost, receiving, matching | Procurement suites, supplier networks, forwarder tracking | Customs filing |
| Stock | Stores, counts, costing, recipes, theoretical vs actual, minibar, linen, fuel | Materials Control/Eatec-type systems, HACCP tools, RFID linen | — |
| Workforce | Rosters, attendance, leave, housing, certifications, Xpat tracking, service charge | Payroll providers, HRIS, biometric clocks, LMS, ATS | Payroll gross-to-net (unless Q101 changes), Xpat submissions without authorization |
| Concessions | Agreements, charges on behalf, settlements | Partner POS/spa systems as sources | Partner's books |
| Utilities | Meters, readings, plant logs, fuel reconciliation, allocation, reporting | BMS/SCADA (read-only), ESG platforms | Equipment control, unverified ESG claims |

## 5. Top risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Scope dilution** — seven modules pull capacity from the PMS core before any pilot | Staged gates (§3); BOH-0 only until the pilot slice is green; owner confirms sequencing (Q100) |
| 2 | **Accounting correctness and liability** — controllers and auditors will test it hard | One journal, owned control accounts, invariants as tests, B01–B07; external accountant review before R7; no statutory claims |
| 3 | **Maldives legal uncertainty** (service-charge basis and currency, input tax, concession treatment, receipt numbering) | Rule packs as data marked `unverified`; adviser list (Q103, Q104, Q106); conservative defaults; live issuance gates |
| 4 | **Fraud vectors** (supplier bank changes, payment release, voids/comps, offline room charges) | SoD as data, dual control, cooling-off, offline exposure limits, loss-prevention reports, audited elevation |
| 5 | **POS reliability and on-site support burden** (offline sync, printers, outlet hub) | Lease + append-only design (ADR-0017 proposal), hardware list with evidence, manual fallbacks, support commitment decision (Q108, Q62) |
| 6 | **Integration sprawl** with ERPs and POS vendors | Generic file profiles first; vendor connectors only after discovery (Q64); readiness R-levels per connector |
| 7 | **Sensitive staff data** (passports, permits, pay shares) | Field encryption, per-read audit, no salaries, IDN-R13 decision (Q102) |
| 8 | **Entrenched specialist vendors** (Simphony, SunSystems, Materials Control) | Coexistence-first adoption modes; win on reconciliation and Maldives specifics, not on replacing everything |
| 9 | **USALI materials are licensed** | "USALI-aligned" wording only; buy materials before claiming detail (Q105) |
| 10 | **Performance at peak** (POS during dinner, month-end batch) | POS commands are small single-check transactions; statements are ledger queries with materialized period balances (engineering, not owner) |

## 6. How a resort's month-end close works in Portico — end to end

*Kandu Atoll Resort, 120 villas, USD functional currency, closing **October 2026**. Portico is the PMS (`charges`
Portico), runs POS in three outlets and quick post at the spa partner, procurement and stock, workforce, utilities, and
the books (`accounting` Portico). Timings are business days after month end (BD+n). Scenario B01 tests this path.*

**During the month (daily, already automatic)**
1. **Folios post themselves.** Each night Day Close posts room and package charges, Green Tax per guest-day and
   inclusions with deterministic keys; POS settlements post room charges as checks close; deposits stay liabilities
   until applied; payments post only on provider confirmation; cashier sessions close with blind counts; payouts are
   recorded gross/fees/net. The guest ledger, deposits and receivables controls equal their sub-ledgers every night.
2. **Operations post their own journals.** Goods receipts post Dr stock / Cr GRNI; issues and sales consumption post
   cost of sales by outlet; agency commissions accrue at check-out; supplier invoices are matched and posted as they
   arrive; the controller's cockpit shows exceptions as they happen, not at month end.

**31 Oct night — BD 0**
3. **Last Day Close of October.** When Day Close for 31 Oct completes, finance automatically soft-closes October for the
   guest-ledger source (cut-off matrix). Late October POS checks queued offline that sync afterwards post as late
   charges with `relatesToBusinessDate` and appear in the restatement annex — nothing silently lands in a closed day.

**1 Nov — BD+1: operations close**
4. **Outlets closed** (Z reports, no open checks — `fnb-pos` check green). **Stock counts** of count-based stores (bars,
   kitchens, minibar store, fuel tank dips) at a 23:00 snapshot; the storekeeper counts offline; variances above
   threshold are recounted; the controller approves; adjustments and count-based cost of sales post (stock check green;
   Σ store valuations = stock control).
5. **Timesheets approved**, days worked locked; the HR manager calculates the **service-charge run**: USD and MVR pools
   from posted service charge (collected basis shown alongside), 1% deduction, shares by days worked; finance approves;
   `scdist:{run}` posts once; payroll inputs are exported to the payroll provider.

**BD+2–BD+4: payables and bank**
6. **Procurement**: GRNI aging reviewed with buyers; the duty and freight vouchers for the September container arrive
   and **landed cost is finalized** — the difference splits between stock on hand and consumed stock.
7. **AP**: remaining supplier invoices captured and matched; the OTAs' **commission invoices** reconciled booking by
   booking against expected commission (two cancelled bookings disputed); tour-operator commission statements matched
   to accruals and netted against their receivables; utilities, Xpat permit fees and clearing-agent invoices coded and
   approved; recurring accruals (insurance, island lease prepayment amortization) post automatically.
8. **Payroll journal** returned by the provider is imported; workforce checks headcount and service-charge amounts match
   the approved run; the service-charge clearing account reaches zero.
9. **Bank**: USD and MVR statements imported (CSV/CAMT); matching by reference clears the payment runs, OTA and acquirer
   **payouts** (net of fees, recorded by payments), DMC transfers (allocated to receivables invoices), cashier **cash
   deposits** (cash in transit) and the MIRA payments of the September returns; bank fees are created by rule; each
   reconciliation statement explains the difference to the cent and is signed off by a reviewer.

**BD+4–BD+5: closing entries**
10. **Depreciation run** (villas, boats, generators, FF&E) previewed and posted; **FX revaluation** of MVR balances at the
    MMA rate; **utilities cost pools** computed (cost per kWh/m³) and the allocation journal proposed and approved;
    **concession settlement** for the spa partner: collected on behalf, revenue share with minimum-guarantee true-up,
    metered power and water, staff beds and meals → statement, hotel tax invoice and netted payable; **management fee**
    accrued from the October figures with every input shown; intercompany recharges from the group office matched.
11. **Integrity**: the cockpit's automatic checks — all business dates closed, no open cashier sessions or checks, counts
    approved, GRNI reviewed, payroll imported, service-charge clearing zero, bank recs signed, suspense zero, every
    control account = its sub-ledger, trial balance balanced — are green. AP's soft-close window ends at BD+5.

**BD+5–BD+7: statements, review, hard close**
12. **Statements**: USALI-aligned P&L by department with budget and last year, balance sheet, cash flow; KPIs (GOPPAR,
    flow-through, F&B cost %, labour cost %, kWh per occupied villa). Variances above thresholds require commentary. The
    GM and controller approve the **management pack**; the owner pack is reviewed and sent. **Hard close** of October.

**BD+7 to 28 Nov: tax returns and payment**
13. **MIRA returns** (working papers, prepared in USD): tourism-sector GST **MIRA 206** — output TGST from the finance
    tax report by time of supply (including deposits received), input tax from supplier vouchers and import
    declarations (recoverable share per the adviser — Q106); general-sector **MIRA 205** if the entity has one;
    **Green Tax MIRA 501** from guest-days by establishment class. The controller reviews (the settlement journal posts),
    files on MIRA's portal **by 28 Nov**, records the filing references, and pays through a payment run; the returns
    become `paid` only when the bank statement shows the debit. (Employee withholding tax, MIRA 601 by 15 Nov, is filed
    by the payroll side.)
14. **If the resort keeps an ERP instead** (`accounting` external): steps 1–5 are identical; at each Day Close and at
    month end Portico exports journal batches (summarized by account and dimension) with deterministic references;
    corrections after export travel as delta batches; the ERP's acknowledgement is shown — never "posted in ERP" before
    it. The ERP then does steps 7–13 with Portico's sub-ledgers as clean inputs.

## 7. What this branch changes and what it does not

- **New files only:** seven specs under `docs/specs/`, three documents here, Q100–Q109 appended to
  `docs/OPEN_QUESTIONS.md`.
- **Not changed (by instruction):** existing specs, domain map, glossary, editions, adoption and readiness documents —
  each needed change is a CR in [`spec-change-requests.md`](spec-change-requests.md), to be applied by the architecture
  steward when merging. `main` has since gained CLAUDE.md rule 17 and a parity gate; CR-35 lists the alignment needed.
- Readiness: every capability in these specs is **R1 (planned)**. No vendor, bank, payroll provider or government
  interface is claimed as supported.
