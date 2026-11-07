# Spec: accounting

Status: Draft v1 · 2026-11-07 · Wave 4 (back-of-house stage BOH-2, depth in BOH-5) · Schema `accounting` · Prefix `ACC`
Entitlements (proposed, `docs/backofhouse/spec-change-requests.md` CR-29): `accounting.core` (journals, reporting
structure, bank reconciliation, period close, statements, tax return data), `accounting.payables`,
`accounting.fixedAssets`, `accounting.budgets`, `accounting.consolidation`, `accounting.managementAgreements`,
`owners.accounting` (existing key, unit owners). ERP export profiles are never gated (integration is core —
`docs/product/editions.md` §2.3).

## 1. Purpose

Accounting turns Portico's hotel ledger into complete books. A resort's financial controller must be able to close
the month inside Portico — from posted folios, outlet checks, receipts and supplier invoices to bank reconciliation,
financial statements and the data for the MIRA returns — or keep her ERP and receive clean, idempotent journals that
never double-post. Accounting is **not a second ledger**: ADR-0008 keeps one double-entry journal per legal entity,
owned by `finance`. Accounting adds the back-office sub-ledgers (payables, bank, fixed assets), the processes
(approvals, close, revaluation, budgets, consolidation) and the reporting structure (USALI-aligned statements) on
top of that one journal, so every number in a statement drills down to the folio posting, check, receipt or
invoice behind it.

## 2. Scope and non-goals

### 2.1 Hotel ledger vs back-office accounting

| Concern | Hotel ledger — `finance` (unchanged owner) | Back-office accounting — `accounting` (this spec) |
|---|---|---|
| Journal engine | Owns journal entries/lines, the posting identity of accounts, the period lock primitive, FX rates, integrity checks | Posts through `finance.postJournal` (CR-02); never stores balances of its own |
| Chart of accounts | Account records used for posting (code, type, currency, control owner) | Account **classification and reporting trees** (USALI schedules, statutory, owner trees), dimension rules, CoA templates and the CoA management UX |
| Customers | Folios, guest ledger, deposits, city-ledger receivables, guest/company fiscal documents, cashier sessions | Bad-debt provisioning journals (SHOULD), AR in statements and cash forecast |
| Suppliers | Agency commission **accruals** from stays (FIN-R31) | Supplier master, supplier invoices and credit notes, payments, commission and OTA invoice settlement |
| Money in banks | Card clearing, payouts (`recordPayout`), cash in cashier sessions | Bank accounts, statements, reconciliation, cash position and forecast, petty cash, inter-account transfers |
| Taxes | Output taxes on postings (tax engine in `rates`), tax report by rule and rate | Return working papers incl. input tax, filing record, settlement |
| Closing | Day Close (business day), simple period lock (FIN-R43) | Month and year close workflow, accruals, revaluation, depreciation, close checklist, statements |
| Other | — | Fixed assets, budgets and forecasts, consolidation and intercompany, management agreements, owner reporting |

A guesthouse that does not license `accounting` keeps exactly today's finance behaviour (FIN-R43 period lock and
journal export). A resort that licenses it gets complete books without any migration of finance data.

### 2.2 Delivery stages

| Stage | Content | Priority |
|---|---|---|
| A (BOH-2) | Reporting structure, dimensions, manual/recurring/accrual journals, payables (incl. commissions and OTA invoices), bank statement import and reconciliation, month close, P&L/BS/TB, tax return data, audit trail, ERP export profiles, migration of opening positions | MUST |
| B (BOH-4/5) | Fixed assets and depreciation, budgets and forecasts, cash management, cash-flow statement, FX revaluation, year-end close, management agreements and owner reporting pack | SHOULD |
| C (BOH-5+) | Consolidation, intercompany automation, unit-owner accounting, lease accounting | LATER |

**Non-goals:** a second journal or balances outside `finance`; payroll gross-to-net (`workforce` exports to the
payroll provider; accounting imports the payroll journal); moving money (Portico prepares payment instructions; the
hotel's bank executes them — CR-25 environment effect); statutory audit opinions, IFRS compliance claims, corporate
income tax returns and tax advice (Portico provides data; the hotel and its advisers file); treasury instruments
(loans, investments) beyond recording journals; expense-card management (integrate); e-invoicing networks (LATER,
per market via `integration`).

## 3. Capabilities

### 3.1 Accounting setup and chart of accounts

- **ACC-R01** [MUST] Accounting entity = platform legal entity (PLT-R16) + fiscal calendar: fiscal-year start month,
  12 monthly periods plus an optional adjustment period 13 (audit adjustments), functional currency (from the legal
  entity), reporting currencies, close policy (cut-off matrix ACC-R28), numbering series for manual journals, supplier
  vouchers and payment batches.
- **ACC-R02** [MUST] **CoA templates** by property profile — *compact* (guesthouse, ~90 accounts) and *full* (resort,
  multi-department) — structured to the publicly described **USALI 12th Revised Edition** layout (effective
  1 January 2026; see Sources). Each account has: natural code, name (localized), type (`asset | liability | equity |
  revenue | expense | statistical`), normal balance, **control owner** (`finance | accounting.payables |
  accounting.bank | accounting.fixedAssets | accounting.prepayments | accounting.intercompany | stock |
  clearing`) , cash-flow class, tax relevance, dimension rules (ACC-R03), active period. Accounts are created through
  `finance.upsertAccount` (CR-03); accounting owns their classification. The template is called *USALI-aligned*, never
  *USALI-compliant* (Q105).
- **ACC-R03** [MUST] **Dimensions**: `property`, `department` (USALI departments: Rooms; Food & Beverage; Other
  Operated Departments such as spa, recreation/dive, transport, retail; Miscellaneous Income; Administrative &
  General; Information & Telecommunications Systems; Sales & Marketing; Property Operation & Maintenance; Utilities;
  Management Fees; Non-Operating), `outlet` (cost/revenue centre), `project` (capex, pre-opening), `intercompanyPartner`,
  `concessionaire`, `ownerUnit` (owner accounting). Per account: each dimension `required | optional | forbidden`;
  validated by `finance.postJournal` before commit (error names the line, account and missing dimension). Finance stamps
  `department`/`outlet` on guest-ledger revenue from charge codes.
- **ACC-R04** [MUST] **Reporting trees** (versioned): USALI summary operating statement and departmental schedules,
  balance sheet, cash-flow statement, a Maldivian statutory presentation (template marked `unverified` until reviewed —
  Q106), and owner/management-company trees. Every active account maps to exactly one line per tree (completeness
  check blocks publishing a tree version with gaps or double mappings).

### 3.2 Journals

- **ACC-R05** [MUST] **Manual journals**: header (entity, accounting date, description, reference, attachments) and
  lines (account, dimensions, debit/credit, transaction currency, FX rate id); `draft → submitted → approved → posted`;
  approval policy by amount and account class through identity approvals (IDN-R15); preparer ≠ approver (IDN-R14);
  posting via `finance.postJournal` with key `mj:{journalId}`; correction only by a linked reversal (FIN-R03).
- **ACC-R06** [MUST] **Recurring and scheduled journals**: templates with schedule and end date (`recur:{templateId}:
  {period}`); auto-reversing accruals (posted on the period's last date, reversed on the next period's first date,
  `reverse:{entryId}`); prepayment amortization schedules (insurance, licences, island lease prepayments); allocation
  journals by basis (statistical account — m², headcount, metered kWh from `utilities`, covers — fixed %, or account
  balance). Allocations are a **management view**: the USALI tree keeps undistributed expenses undistributed; an
  "allocated departmental P&L" is a separate tree.
- **ACC-R07** [MUST] **Journal import** (CSV/XLSX, later API via `integration` workflow `journals`): mapping profile,
  validation preview (balanced per currency, accounts active, dimensions, open period, duplicates by source
  reference), imported as a draft batch → approval → post. Used for the **payroll journal** returned by the payroll
  provider (WFM-R26), migration opening balances (ACC-R51) and revenue journals from an external PMS in connected mode
  (§14).
- **ACC-R08** [MUST] **Accounting date** (CR-04): every back-office journal carries an accounting date that must fall in
  a period open for its source (ACC-R28); the property business date at commit and `occurredAt` are also stored
  (FIN-R02). Guest-ledger postings keep accounting date = business date (FIN-I10 unchanged). After hard close, a
  correction goes to the current open period with `relatesToPeriod` and appears in the restatement register (FIN-R43).
- **ACC-R09** [MUST] **Statistical accounts** (non-monetary): rooms available/sold/OOO, guests, guest-nights, covers by
  outlet and period, labour hours, kWh, m³, staff in house — fed from Day Close snapshots, `fnb-pos`, `workforce` and
  `utilities`; used for ratios (per available room, per occupied room, per cover) and allocation bases.

### 3.3 Accounts payable (`accounting.payables`)

- **ACC-R10** [MUST] **Supplier master** (owned here; `procurement` adds a purchasing profile, PRC-R01): legal and
  trading name, TIN, GST registration and sector (`tourism | general | none`), residence (`resident | non_resident`,
  drives withholding codes — Q106), addresses, contacts, currency, payment terms and method, kind (`goods_services`,
  `travel_agency` (linked to the `guests` company/agency profile), `ota`, `concessionaire`, `government` (MIRA, the
  ministry collecting Xpat fees, customs), `management_company`, `owner`, `utility`, `freight_forwarder`,
  `clearing_agent`), status (`draft → active ⇄ on_hold → blocked → archived`), duplicate detection (TIN, bank account,
  name similarity).
- **ACC-R11** [MUST] **Supplier bank details** are field-encrypted and masked; a change is a request that needs (a) a
  second person to approve (requester ≠ approver), (b) a recorded out-of-band verification (who called whom, at which
  number already on file — never the number in the change request), (c) a cooling-off period before the first payment
  to the new details (policy, default 24 h), (d) a notice to the supplier's existing contact (`message.supplier`,
  CR-25). Payment runs hold items whose bank details changed within the cooling-off period.
- **ACC-R12** [MUST] **Supplier invoice** (voucher): captured by upload, phone photo or a per-entity email inbox;
  fields: supplier, invoice number, invoice date, tax-point date, due date (terms), currency, lines (PO line reference,
  or GL coding with account and dimensions, quantity and price), tax lines by tax code (data: e.g. Maldives input GST
  8% general, TGST 17% from tourism-registered suppliers, import GST, exempt, zero-rated, non-recoverable), withholding
  code (data, `unverified` — Q106), attachments stored immutably with a content hash. **Duplicate detection**: same
  supplier + normalized invoice number blocks; same supplier + amount + date window warns; override needs
  `accounting.invoice.overrideDuplicate` ⚑ with reason.
- **ACC-R13** [MUST] **Invoice paths**: PO-backed invoices go to `awaiting_match` and emit
  `accounting.supplierInvoice.awaitingMatch`; `procurement` returns a match result (PRC-R23) through
  `recordMatchResult`; exceptions route to approval. Non-PO invoices (utilities, OTA commission, rent, Xpat fees,
  professional services) need coding and approval by cost-centre owner and amount band, showing budget availability
  (ACC-R40). Posting on approval: Dr expense/asset/GRNI (clearing key from the match)/input tax recoverable, Cr AP
  (supplier sub-account), key `apv:{voucherId}`.
- **ACC-R14** [MUST] Supplier **credit and debit notes** linked to invoices (returns to supplier from PRC-R21, price
  disputes); allocations between invoices, credit notes and payments; supplier **advances/prepayments** (common for
  imports paid before shipment) posted to supplier prepayment and applied to later invoices.
- **ACC-R15** [MUST] **Payment runs**: select by due date, discount date, supplier, currency, bank account; proposal
  with totals per currency and the cash position after payment; review and approval (preparer ≠ approver; a second
  approver above policy amount); output a **payment instruction file** (generic CSV first; bank-specific formats only
  once verified with the bank — Q107) or a manual payment record (transfer reference, cheque number); remittance advice
  (`message.supplier`). Status: `approved → released (file handed to the bank) → confirmed (matched to a bank
  statement line, or an explicit bank confirmation reference) | returned`. Portico **never shows a supplier invoice as
  paid** until `confirmed` (CLAUDE.md §5). Journals: release Dr AP / Cr payments in transit (per bank account);
  confirmation Dr payments in transit / Cr bank; return reverses the release and reopens the invoice. Payment in a
  currency other than the invoice's posts realized FX.
- **ACC-R16** [MUST] **Travel-agent commissions payable**: commission accruals posted by finance at check-out (FIN-R31)
  are listed per agency with their stays; an agency's commission statement or invoice is matched against them
  (differences: cancelled stays, no-shows, rate or night changes) and the approved amount relieves the accrual through
  the commission clearing handoff (`finance.relieveCommissionAccrual`, CR-07) into AP. Net settlement against the
  agency's receivables (FIN-R31 offset) is recorded as an AP/AR netting with both sides visible.
- **ACC-R17** [MUST] **OTA commission invoices** (hotel-collect bookings): the monthly OTA invoice (PDF plus statement
  CSV where the OTA provides one) is reconciled line by line against Portico's **expected commission** per booking
  (distribution commission terms × agreed stay revenue per the booking's terms snapshot); differences (cancelled,
  no-show, modified stay, commission charged on taxes) are listed for dispute with the evidence; the approved amount
  becomes an AP voucher; OTA direct debits are matched in bank reconciliation. Merchant-model OTA payouts (OTA collects
  and pays net) are reconciled by `payments` (PAY-R25) with the deducted commission posted as expense — no AP voucher.
- **ACC-R18** [MUST] AP aging (by due date and currency), supplier statement reconciliation (supplier's statement vs
  ledger with open differences), GRNI aging with `procurement`, payment forecast feeding ACC-R25.
- **ACC-R19** [SHOULD] Invoice data extraction (OCR/AI) produces **proposals** shown next to the image; a person
  confirms every field before posting (brief §14); suggestion accuracy measured.
- **ACC-R20** [SHOULD] Early-payment discounts, payment holds with reason, partial payments, supplier/customer offsets
  (a DMC that is both).

### 3.4 Bank and cash

- **ACC-R21** [MUST] **Bank accounts** per entity: bank, masked account number, currency, GL account (control owner
  `accounting.bank`), statement source and format, status. **Petty cash funds** (imprest) per property/department with
  custodian. Front-office and outlet floats remain finance cashier sessions (FIN-R37).
- **ACC-R22** [MUST] **Statement import**: CSV with mapping profiles, MT940 and ISO 20022 CAMT.053 (which formats
  Maldivian banks provide is unverified — Q107); bank feeds LATER via `integration` workflow `bankStatements`. Statements
  and lines are immutable with the source file hash; duplicates rejected on (account, statement id or date range, line
  hash); opening balance must equal the previous closing balance, otherwise an exception (`statement_gap` /
  `statement_overlap`).
- **ACC-R23** [MUST] **Reconciliation**: matching candidates ranked by confidence — (1) exact reference: payment-run
  reference, `payments` payout id (PAY-R25), receivables remittance reference (FIN-R28), cash deposit slip
  (`finance.recordCashDeposit`, CR-08); (2) amount + date window + counterparty; (3) one-to-many and many-to-one
  (a payout covering many transactions; one deposit of several cashier sessions). Matches below the confidence threshold
  need confirmation. **Create from statement** for bank charges, interest, FX conversions and direct debits by rule
  (approval above threshold). Unmatched lines have aging and an owner. A **reconciliation statement** per period shows
  bank closing balance vs ledger balance with every outstanding item (unpresented payments, deposits in transit,
  unrecorded bank items) and must explain the difference to the minor unit; sign-off (preparer ≠ reviewer) locks the
  period's matches.
- **ACC-R24** [MUST] Card settlements: integrated provider payouts and external-terminal batch settlements are recorded
  by `payments`/`finance` as payouts with gross, fees and net (PAY-R24, PAY-R25); bank reconciliation matches the net
  deposit to that payout — accounting never re-derives card fees.
- **ACC-R25** [SHOULD] **Cash management**: cash position per bank and currency (reconciled + unreconciled), 13-week
  cash forecast from receivables due (finance), scheduled payment runs, payroll dates and amounts (payroll journal
  history), tax due dates (MIRA returns on the 28th and the 15th — §11), expected payouts (payments), capex commitments
  (procurement), manual items; USD/MVR conversions with the bank recorded with both legs and rate; inter-account
  transfers through in-transit.
- **ACC-R26** [SHOULD] Petty cash vouchers (coding, receipt photo), replenishment claims → payment, counts with variance.

### 3.5 Period close

- **ACC-R27** [MUST] **Close cockpit** per entity and period: checklist template by profile; tasks with owner, due
  (business-day offset, e.g. BD+3), dependencies and evidence; **automatic checks** evaluated by the system: every
  business date of the period completed Day Close (`day-close`); no open cashier sessions; all outlets closed and no open
  checks (`fnb-pos`); count-based stores counted and approved (`stock`); GRNI reviewed (`procurement`); payroll journal
  imported and service-charge clearing zero (`workforce`); depreciation run (ACC-R39); bank reconciliations signed;
  intercompany matched; FX revaluation run; suspense = 0; every sub-ledger ↔ control-account reconciliation shows zero
  difference (ACC-R31); tax return data reviewed (ACC-R36).
- **ACC-R28** [MUST] **Cut-off matrix**: period state (`open → soft_closed → closed`; year `closed → final`) is held by
  finance (CR-05) per entity; soft close allows postings only from sources and users permitted for the period (e.g. guest
  ledger closes automatically when the period's last business date completes Day Close; stock and POS after counts; AP
  until BD+5 with `accounting.period.postSoftClosed`); hard close blocks everything; reopen requires
  `finance.period.reopen` ⚑ with reason and notifies the controller.
- **ACC-R29** [SHOULD] **FX revaluation** of open monetary balances (AP, receivables, bank, cash, intercompany) in
  non-functional currencies at the period-end rate (rate source per entity policy; for MVR the Maldives Monetary
  Authority rate), auto-reversed next period; realized FX on settlement.
- **ACC-R30** [SHOULD] **Year-end**: P&L closed to retained earnings (generated, previewed, keyed `yearend:{entity}:
  {year}`), period-13 audit adjustments with auditor references, final lock; statutory statement export pack.

### 3.6 Financial statements and reports

- **ACC-R31** [MUST] Trial balance (any range, by dimension), GL detail with drill-down to the source document (folio
  posting, check, goods receipt, supplier voucher, payroll import, depreciation run), **sub-ledger reconciliation
  report**: each control account vs its sub-ledger total (guest ledger, deposits, receivables — FIN-R45; AP, bank, fixed
  assets, prepayments, stock, GRNI, clearing accounts); any difference is an integrity exception.
- **ACC-R32** [MUST] **P&L** in the USALI-aligned tree: operated-department revenues, departmental expenses and profit,
  undistributed operating expenses, gross operating profit, management fees, non-operating income and expenses,
  EBITDA, replacement reserve; departmental schedules; columns actual / budget / last year / forecast, month and YTD;
  % of revenue, per available room, per occupied room, per cover; by property, entity and (Enterprise) portfolio.
- **ACC-R33** [MUST] Balance sheet (current/non-current from mapping) with comparatives; [SHOULD] cash-flow statement
  (indirect method from cash-flow classes).
- **ACC-R34** [MUST] Every statement figure shows definition, period, currency treatment and source, and offers **as
  closed vs current** with restatement deltas linked to the corrections (parity with ANL-R04); drill-down counts and
  sums equal the figure; export XLSX/PDF.
- **ACC-R35** [MUST] **Monthly management pack** (GM, owner, management company): statements, KPIs (occupancy, ADR,
  RevPAR, TRevPAR, GOPPAR, flow-through, labour cost %, F&B cost %, utilities per occupied room), variance commentary
  required above thresholds, review and approval before distribution.

### 3.7 Tax return data (country packs as data; Maldives first)

- **ACC-R36** [MUST] **Return working papers** per registration (entity × sector): output tax from finance's tax report
  (by rule, rate and time of supply, incl. deposits and credit notes — `docs/readiness/maldives-tax-rules.md` §1),
  input tax from AP vouchers and import declarations (recoverable share per rule pack — Q106), adjustments, net payable.
  Maldives: **tourism-sector GST return (MIRA 206)** prepared and paid in USD with any conversion within ±2% of the MMA
  rate recorded; **general-sector GST return (MIRA 205)** where the entity has a general-sector registration; **Green
  Tax return (MIRA 501)** from finance's Green Tax postings (guest-days by establishment class); due on the 28th of the
  following month. Box mappings are data marked `unverified` until the adviser confirms (Q20, Q106).
- **ACC-R37** [MUST] Return lifecycle `draft → reviewed → filed → paid` (or `amended` as a new linked version):
  **Portico does not submit to MIRA** — a user files on MIRA's portal and records the filing reference, date and
  acknowledgement; `paid` only after bank reconciliation matches the payment. On review, the settlement journal (Dr
  output tax payable / Cr input tax recoverable / Cr tax settlement payable) is posted.
- **ACC-R38** [SHOULD] Statutory data beyond GST: employee withholding tax and pension liabilities from imported payroll
  journals (the payroll provider files MIRA 601 — boundary, WFM §15); a trial balance export by tax category for the
  business profit tax return prepared by the hotel's adviser.

### 3.8 Fixed assets (`accounting.fixedAssets`, stage B)

- **ACC-R39** [SHOULD] **Asset register**: classes with GL accounts, default life and method (leasehold improvements
  over the island lease term, villas and over-water structures, FF&E, OS&E (capitalize or expense by threshold policy),
  vehicles and vessels, power plant, desalination plant, IT); asset record: tag, description, property, department,
  link to the physical asset in `operations` (OPS-R19; 1 physical : n financial components allowed), acquisition source
  (AP capex line, `procurement` receipt with capex flag, manual), cost incl. landed cost, in-service date, life, method
  (straight-line, declining balance), salvage; monthly **depreciation run** (preview, post, key
  `depr:{assetId}:{period}`); disposals and write-offs with gain/loss (salt corrosion makes these frequent); transfers
  between properties (and entities via intercompany); FF&E replacement-reserve tracking against management agreements.
  Impairment, revaluation and lease (right-of-use) accounting LATER (USALI 12th edition notes lease changes — Sources).

### 3.9 Budgets and forecasts (`accounting.budgets`, stage B)

- **ACC-R40** [SHOULD] **Budget versions** per entity and fiscal year (original, reforecasts, rolling 12) by account ×
  dimension × month; driver modules: rooms (occupied room-nights × ADR), F&B (covers × average check, capture ratios),
  labour (hours from `workforce` standards × cost bands), cost-of-sales %, utilities (kWh per occupied room × cost per
  kWh); spreadsheet import/export; `draft → submitted → approved → locked`. **Budget availability** API for
  procurement (budget − actual − commitments) with policy per account class (`warn | extra_approval | block`); capex
  budgets by project.
- **ACC-R41** [SHOULD] Forecasts from on-the-books revenue (analytics pace) plus labelled assumptions, shown as
  **estimates** with freshness; comparisons original vs latest forecast.

### 3.10 Groups of entities, owners and management companies

- **ACC-R42** [LATER] **Consolidation** (`accounting.consolidation`): group structure (entities, ownership %, method),
  translation to reporting currency (policy: closing rate for balance sheet, average for P&L, historical for equity;
  translation reserve), intercompany elimination proposals, consolidated statements drilling to entities.
- **ACC-R43** [SHOULD] **Intercompany**: partner dimension, due-to/due-from accounts per pair, intercompany recharges
  (central purchasing, group services, staff on loan, dine-around settlement — RST-R03 LATER), mirror-entry proposals in
  the partner entity (approved there), matching report; guest charges across entities through finance LATER (FIN-R11).
- **ACC-R44** [SHOULD] **Management agreements** (`accounting.managementAgreements`): terms snapshot (base fee % of total
  revenue as defined in the agreement, incentive fee on GOP/adjusted GOP after owner's priority, brand/system fees,
  caps/floors, FF&E reserve %), monthly accrual calculated from the statements with every input shown, annual true-up,
  fee invoice/statement to the owner entity (receivable or intercompany), approval before posting.
- **ACC-R45** [SHOULD] **Owner reporting package** for the owner of a managed property: monthly pack (statements vs
  budget and last year, fees calculation, reserve, cash, capex, aging), review-before-send, time-boxed read access for
  owner representatives (owner portal LATER).
- **ACC-R46** [LATER] **Unit-owner accounting** (`owners.accounting`): ownership shares (PLT-R17), rental-pool or per-unit
  revenue models with formula placeholders, owner stays (house use, no revenue), owner charges and reserves, statements
  review-before-send, payments through AP, reconciliation to OTA payouts (research 03 §6.2).

### 3.11 Audit trail, controls and exports

- **ACC-R47** [MUST] **Audit trail**: every journal shows source, preparer, approvers, posting time, reversal links,
  attachments; master-data change logs with before/after (reporting trees, supplier bank details, approval rules,
  period states); reports: journal register, manual-journal report, user activity on financial records, **SoD conflict
  report** (users holding conflicting pairs, e.g. `accounting.supplier.manageBank` + `accounting.payment.release`).
- **ACC-R48** [MUST] **Auditor access**: time-boxed read-only role scoped to entity and periods, every read audited;
  **PBC pack** export (TB, GL detail, sub-ledger reconciliations, AP/receivables aging, asset register, bank
  reconciliations, journal register) with a manifest and file hashes.
- **ACC-R49** [MUST] **ERP export** when `accounting` is external (data authority, §14): export profiles — **generic
  journal file** (P0; configurable columns), **Xero**, **QuickBooks Online**, **Oracle NetSuite**, **SAP (S/4HANA and
  Business One)**, **Infor SunSystems** (file), **Microsoft Dynamics 365 Business Central** — each a connector starting at
  R1 with declared workflow capabilities (INT-R01) and vendor details marked unverified until tested. Journals summarized
  (per accounting date × account × dimensions) or detailed; account and dimension mapping is financially significant
  (INT-R11); batch lifecycle `prepared → sent | exported (file) → acknowledged | rejected | pending_verification`;
  deterministic external references (`{entity}:{period}:{date}:{seq}`) so a resend never duplicates where the target
  accepts references; where it does not, a re-export shows "already exported on …" and needs ⚑ with reason; changes
  after export flow only as **delta batches**; coverage report proves each posted entry is in exactly one batch per
  active profile.
- **ACC-R50** [MUST] Optional document sync per profile capability: receivables invoices and receipts (W-ACC-02/03),
  supplier vouchers and payments when AP lives in the ERP (new W-ACC-06/07 — CR-19), supplier master sync.

### 3.12 Migration

- **ACC-R51** [MUST] Opening position at cutover: trial balance per entity through migration suspense, open supplier
  invoices with due dates, open commitments (procurement), asset register (cost, accumulated depreciation, remaining
  life), outstanding bank reconciliation items, budgets; reconciliation to the source trial balance to the minor unit
  (S18 pattern); historical monthly balances kept as comparatives (statistical history), not re-posted journals.

## 4. Entities and states

`accounting_entity(legal_entity_id, fiscal_year_start, periods jsonb, reporting_currencies[], policies jsonb)` ·
`account_classification(account_id, tree_id, line_id, cash_flow_class, dimension_rules jsonb, version)` ·
`reporting_tree(id, kind, version, status)` · `tree_line(id, tree_id, parent_id, code, label, sign)` ·
`manual_journal(id, entity_id, accounting_date, status, preparer, approvals jsonb, entry_id?, version)` ·
`recurring_template(id, schedule, lines jsonb, next_run, end_date)` · `supplier(id, kind, legal_name, tin, gst jsonb,
residence, terms, status, version)` · `supplier_bank_account(id, supplier_id, enc_details, masked, status,
verified_by, verified_at, cooling_off_until)` · `supplier_voucher(id, supplier_id, number, number_normalized,
invoice_date, tax_point_date, due_date, currency, lines jsonb, taxes jsonb, status, match_ref?, entry_id?, version)`
UNIQUE (supplier_id, number_normalized) where not overridden · `payment_run(id, entity_id, status, items jsonb,
approvals, file_ref?)` · `supplier_payment(id, run_id, voucher_allocations jsonb, amount, currency, status,
bank_ref?, statement_line_id?)` · `bank_account(id, entity_id, account_id, currency, masked, source)` ·
`bank_statement(id, bank_account_id, period, opening, closing, file_hash)` · `statement_line(id, statement_id,
date, amount, reference, counterparty, hash, match_status)` · `bank_match(id, statement_line_ids[], ledger_refs
jsonb, confidence, confirmed_by)` · `reconciliation(id, bank_account_id, period, difference, status, signed_by)` ·
`close_period(entity_id, period, tasks jsonb, checks jsonb, status)` · `tax_return(id, registration, period,
version, figures jsonb, status, filing_ref?, payment_ref?)` · `fixed_asset(id, class, tag, cost, life, method,
status, links jsonb)` · `depreciation_run(id, period, status)` · `budget_version(id, entity_id, year, kind, status)`
· `budget_line(version_id, account_id, dims jsonb, month, amount)` · `management_agreement(id, terms_snapshot jsonb,
version)` · `export_profile(id, target, mapping_set_id, granularity)` · `export_batch(id, profile_id, external_ref,
entry_ids[], status, ack jsonb)`.

**Manual journal:** `draft → submitted → approved → posted` · `submitted → rejected → draft` · `posted → reversed`
(linked reversal; terminal for the original).
**Supplier voucher:** `received → awaiting_match → matched | match_exception → approved → posted → partially_paid → paid`
· non-PO: `received → coded → in_approval → approved → posted …` · `received|coded → rejected` (reason) · `posted →
disputed ⇄ posted` · `posted → credited` (fully credited). `paid` requires confirmed payments only.
**Supplier payment:** `proposed → approved → released → confirmed | returned` · `proposed|approved → cancelled`.
**Bank details change:** `requested → verified → approved → cooling_off → active` · `requested|verified → rejected`.
**Reconciliation:** `in_progress → balanced → signed_off` · `signed_off → reopened` (⚑, reason).
**Close period:** `open → closing (checklist running) → soft_closed → closed → final (year)` · `closed → reopened` (⚑).
**Tax return:** `draft → reviewed → filed → paid` · `filed → amended` (new version) · `draft → superseded`.
**Export batch:** `prepared → sent|exported → acknowledged | rejected | pending_verification` · `pending_verification
→ acknowledged | rejected` (read-back) · `rejected → prepared` (fix, same external ref).
**Fixed asset:** `draft → in_service → fully_depreciated → disposed` · `in_service → disposed | transferred`.

## 5. Invariants

- **ACC-I01** Accounting holds no ledger balances: every amount in a statement is a query over `finance` journal lines;
  each accounting-originated journal exists in the journal exactly once (idempotency key unique, FIN-I04).
- **ACC-I02** For each control account owned by an accounting sub-ledger (AP, payments in transit, bank, fixed assets,
  prepayments, intercompany), Σ sub-ledger open items = control-account balance after every committed transaction.
- **ACC-I03** No journal has an accounting date in a hard-closed period; a soft-closed period accepts only sources and
  users permitted by the cut-off matrix.
- **ACC-I04** Segregation: manual-journal approver ≠ preparer; bank-detail approver ≠ requester; payment-run approver ≠
  preparer — unless the property runs the documented single-person policy (guesthouse profile), which flags every such
  item on the SoD report.
- **ACC-I05** A (supplier, normalized invoice number) is registered at most once unless an override with reason exists.
- **ACC-I06** A supplier voucher is `paid` only if Σ confirmed payments + credit notes = its total; Σ allocations to a
  voucher never exceed its total.
- **ACC-I07** A bank statement line is matched at most once (or split explicitly summing to its amount); matches in a
  signed-off reconciliation are immutable unless it is reopened.
- **ACC-I08** Statement continuity: each statement's opening balance = previous closing balance, or an open exception
  exists.
- **ACC-I09** Every active account maps to exactly one line in every active reporting tree; the USALI tree's net equals
  the trial balance's revenue + expense net for the same scope.
- **ACC-I10** Depreciation for (asset, period) posts at most once; net book value ≥ salvage.
- **ACC-I11** Each posted journal entry is in exactly one export batch per active export profile; a sent batch's content
  never changes.
- **ACC-I12** A return's figures equal the sum of its drill-down lines; a `filed` return is immutable.
- **ACC-I13** Intercompany: per partner pair and period, due-to = due-from after FX, or a listed difference exists.
- **ACC-I14** Management-fee accruals are reproducible from the agreement snapshot and the statement figures cited.
- **ACC-I15** Recurring and auto-reversal instances post at most once per key (`recur:…`, `reverse:…`).
- **ACC-I16** In non-live environments no remittance or bank-detail notice reaches a real supplier and every payment
  file is watermarked `NOT FOR BANK — <environment>` (CR-25).

## 6. Cross-module interactions

Calls `finance` (`postJournal`, `upsertAccount`, `setPeriodState`, `getLedgerLines`, `relieveCommissionAccrual`,
`getTaxReport`, `listPayouts`, receivables remittances — CR-02…CR-09), `platform` (legal entities, policies, data
authority `accounting`/`payables` — CR-12), `identity` (approval chains, SoD — CR-21), `integration` (bank statements,
ERP export connectors, document sync, payroll journal import), `analytics` (statistics, forecasts — read). Called by
`procurement` (supplier lookup, `recordMatchResult`, budget availability, commitments), `concessions` (settlement
payables), `workforce` (payroll journal check — read), `utilities` (allocation journal proposals). Accounting never
calls `procurement`, `stock`, `workforce`, `concessions` or `utilities` synchronously; it receives their facts through
events or through calls they make.

### Proposed contract changes (not in force until the domain map is updated)

1. Provider: `getSupplier`, `findSuppliers`, `recordMatchResult(tx, { voucherId, outcome, lines, codings })`,
   `getBudgetAvailability(tx, { entityId, account, dims, period })`, `recordCommitment / relieveCommitment(tx, { ref,
   amount, account, dims, period })`, `createVoucherFromSettlement(tx, { supplierId, lines, sourceRef,
   idempotencyKey })` (concessions), `proposeAllocationJournal(tx, { basisRef, lines })` (utilities).
2. Dependency arrow `accounting ─► finance, platform, identity, integration`.

## 7. Events

`accounting.journal.posted|reversed` · `accounting.supplier.created|blocked|bankDetailsChangeRequested|bankDetailsActivated`
· `accounting.supplierInvoice.received|awaitingMatch|approved|posted|disputed` · `accounting.paymentRun.approved|released`
· `accounting.payment.confirmed|returned` · `accounting.bankStatement.imported` · `accounting.reconciliation.signedOff`
· `accounting.period.softClosed|closed|reopened` · `accounting.closeTask.overdue` · `accounting.taxReturn.reviewed|filed|paid`
· `accounting.asset.capitalized|disposed` · `accounting.depreciation.posted` · `accounting.budget.approved` ·
`accounting.exportBatch.sent|acknowledged|rejected`.
Consumed: `finance.commission.accrued` (CR-07), `finance.period.stateChanged`, `payments.payout.received`,
`dayClose.run.completed`, `fnbPos.outlet.closed`, `stock.count.approved`, `procurement.receipt.posted`,
`workforce.serviceChargeRun.approved`, `platform.dataAuthority.changed` (`accounting`, `payables`).

## 8. Permissions

`accounting.coa.manage` ⚑ · `accounting.tree.manage` ⚑ · `accounting.journal.create` · `accounting.journal.approve` ⚑ ·
`accounting.journal.import` ⚑ · `accounting.recurring.manage` · `accounting.supplier.read` · `accounting.supplier.manage`
· `accounting.supplier.manageBank` ⚑ · `accounting.supplier.approveBank` ⚑ · `accounting.invoice.capture` ·
`accounting.invoice.approve` · `accounting.invoice.overrideDuplicate` ⚑ · `accounting.paymentRun.prepare` ·
`accounting.paymentRun.approve` ⚑ · `accounting.payment.release` ⚑ · `accounting.bank.import` ·
`accounting.bank.reconcile` · `accounting.bank.signOff` ⚑ · `accounting.period.close` ⚑ ·
`accounting.period.postSoftClosed` ⚑ · `accounting.taxReturn.prepare` · `accounting.taxReturn.review` ⚑ ·
`accounting.asset.manage` · `accounting.depreciation.run` ⚑ · `accounting.budget.manage` · `accounting.budget.approve` ⚑
· `accounting.statement.read` · `accounting.audit.read` (time-boxed) · `accounting.export.run` ⚑ ·
`accounting.agreement.manage` ⚑ · `accounting.consolidation.run` ⚑ (org).

## 9. UX surfaces

- **Controller workspace (close cockpit)**: period status per entity; checklist with automatic checks (green only when
  the system verified them), owners and due days; sub-ledger reconciliation tiles with differences; "what blocks hard
  close".
- **AP inbox**: invoices by state with image side-by-side, duplicate warnings, match exceptions linking to procurement,
  approval queue (mobile approve with budget impact), aging.
- **Supplier record**: five questions (state, history, what is wrong, owner, next actions); bank details masked with
  change-request trail and cooling-off countdown.
- **Payment run**: proposal grid, cash impact per bank/currency, holds with reasons, approval, file download (watermarked
  outside live), confirmation status per payment.
- **Bank reconciliation**: statement lines left, ledger items right, ranked suggestions with reasons, rules editor,
  reconciliation statement explaining the difference to the cent.
- **Journal editor** (keyboard-first, balance indicator per currency), **statements viewer** (USALI P&L with drill-down,
  as-closed vs current toggle, budget/LY columns), **tax return workpaper** (boxes with drill-down; filing record),
  **asset register**, **budget grid**, **export batches** (sent/acknowledged, coverage).

## 10. Proof scenarios and evidence

Back-of-house scenarios are defined in `docs/backofhouse/scenarios.md` (`B01`–`B20`).

| ID | Accounting must demonstrate |
|---|---|
| B01 | Month-end close end-to-end: every automatic check verified; sub-ledgers = controls; statements drill to sources; returns prepared; hard close. |
| B02 | The same supplier invoice captured three ways posts once; override needs reason and permission. |
| B03 | Fraudulent bank-detail change: dual control, out-of-band verification, cooling-off hold; no payment to new details before activation. |
| B04 | One payment in a released run is returned by the bank: invoice reopens, nothing shows paid, a re-run pays once. |
| B05 | Bank reconciliation with an OTA payout, a terminal batch net of fees, a DMC transfer, a two-session cash deposit and a bank fee explains the difference to the minor unit. |
| B06 | ERP export retried after a timeout creates one journal in the ERP; a later correction flows as a delta batch. |
| B07 | Late supplier invoice after soft close: posts per cut-off policy; no P&L distortion because GRNI already carried the cost. |
| S18 / E12 (extended) | Opening trial balance and open AP import reconcile to the source to the minor unit (ACC-R51). |
| E15 (extended) | A wrong manual journal is reversed and re-posted; statements show the restatement for the closed period. |

## 11. Maldives specifics

- Resorts usually keep **USD functional currency**; local costs (staff, local suppliers, utilities on inhabited
  islands, Xpat fees) are in MVR; MVR conversions for tax purposes stay within ±2% of the MMA rate
  (`maldives-tax-rules.md` §3).
- **Returns** (verified 2026-11-07 via search-indexed MIRA pages — Sources): general-sector GST return **MIRA 205**,
  tourism-sector GST return **MIRA 206**, both due by the 28th of the month after the taxable period; tourism-sector
  returns are prepared and paid in USD and filed online. Green Tax return **MIRA 501** by the 28th
  (`maldives-tax-rules.md` §5). Employee withholding tax return **MIRA 601** by the 15th of the following month is filed
  by the payroll side (WFM §15). Box mappings remain `unverified` (Q20, Q106).
- Imports are often paid in advance by telegraphic transfer → supplier advances (ACC-R14) are routine; import GST and
  duty arrive on clearing-agent invoices and feed landed cost (PRC-R17) and input tax (Q106).
- Fiscal-record retention ≥ 5 years after the tax year (`maldives-tax-rules.md` §6) applies to vouchers, statements
  and returns.
- Island lease rent and its prepayments, power and desalination plants, vessels and over-water structures dominate the
  asset register [assumption — confirm with discovery, Q64].
- Statement formats and any bank APIs of Maldivian banks are unverified (Q107); file import is the default.

## 12. Competitive inspirations

- Apaleo's revenue-focused, USALI-inspired double-entry ledger that is "agnostic to expenses" with GL mapping outside
  the PMS (research 02 §3.3.6) — Portico keeps that ledger kernel and adds the expense side natively, so hotels without
  an ERP are not forced to buy one.
- Agilysys separates the operational date roll from the fiscal close (research 01 §6.5) → Day Close vs period close
  (ACC-R27/R28).
- Owner statements with formula placeholders and review-before-send (Guesty, research 03 §6.2) → ACC-R45/R46.
- Reports not matching payouts is a top complaint (research 03 §6.5; research 02 §2.8) → bank reconciliation matches
  payouts by id and explains every difference (ACC-R23/R24).

## 13. Open questions

Q105 (USALI materials and claims), Q106 (Maldives back-of-house tax items: input tax, import GST, withholding on
non-residents, statutory presentation), Q107 (bank formats, feeds and payment instructions), Q20/Q41 (existing adviser
and tax items).

## 14. Adoption modes

- **Standalone alongside an external PMS:** **conditional** (proposed standalone module SM-13 — CR-27). A hotel keeps its
  PMS but runs payables, bank reconciliation, fixed assets, budgets and statements in Portico. Revenue arrives as the
  PMS's daily revenue journal (workflow `journals: read`, often a night-audit file — sync `file`, never labelled live)
  mapped by reviewed `ledgerAccount` mappings and posted by ACC-R07 to PMS clearing and revenue accounts; finance runs in
  **journal-only mode** (no folios). Guest-ledger depth (folio drill-down) is then `incomplete` and says so.
- **Hard dependencies:** `platform`, `identity`, `finance` (journal kernel), `integration` (imports/exports).
- **Connected mode:**
  - `accounting` external (ERP is the book of record), `payables` external: accounting features are hidden except the
    export profiles (ACC-R49/R50); every Portico journal (guest ledger, stock, procurement) is exported; Portico shows ERP
    acknowledgements, never "posted in ERP" before acknowledgement.
  - `accounting` external, `payables` Portico: AP runs here; vouchers and payments are exported to the ERP as journals or
    documents (W-ACC-06/07); bank reconciliation of AP payments stays where the bank account is reconciled (policy names
    one system per bank account — never both).
  - `accounting` Portico, `payables` external: supplier invoices mirrored read-only for GRNI and commitments; payment
    status `external`.
- **Data-authority domains:** owns `accounting` (narrowed to GL, statements, bank, fixed assets, close — CR-12) and the
  proposed `payables` domain when authoritative; respects `charges` (never posts to guest ledger accounts).
- **Trial:** opening trial balance and AP copied; statements computed and compared with the source system's statements
  side by side; differences listed, never auto-adjusted; no payment file or supplier message leaves the environment.

## 15. Boundary — build here, integrate instead

| Capability | Decision | Why |
|---|---|---|
| Journal, sub-ledgers, AP, bank reconciliation, close, statements, tax return **data** | **Build** (stages A/B) | Hotels want the controller's month inside the system that holds the operational truth; reconciliation is by construction |
| Fixed assets, budgets, management fees, owner pack | **Build** (stage B) | Hospitality-specific (FF&E reserve, USALI fees, owner reporting) and poorly served by generic tools |
| Consolidation of large groups, complex ownership, IFRS 16 lease engine | **Integrate** (export to the group ERP/CPM) until demand is proven | High statutory risk, low first-market demand |
| Payroll, payslips, EWT/pension filing | **Integrate** (payroll provider) — WFM §15 | Statutory complexity and pay-data sensitivity |
| Executing bank payments, holding funds | **Never** — bank executes Portico's instructions | Monoclay never moves or holds money (CLAUDE.md §4.14) |
| Government submissions (MIRA) | **Manual filing** with references recorded; an interface only after authorization (`government.submit`) | No verified interface; legal responsibility stays with the hotel |
| Audit opinion, tax advice, statutory compliance claims | **Never** | Professional services; no claims without evidence (CLAUDE.md §7) |
| Hotels keeping Xero/QuickBooks/NetSuite/SAP/SunSystems | **Integrate** through export profiles and document sync | Adoption path A/B: keep the systems they like |

## Sources (verified 2026-11-07 unless stated; MIRA and Maldivian pages read via search-indexed content because
direct fetches of `.mv` hosts were blocked in this session)

- USALI 12th Revised Edition effective 1 January 2026, new sustainability and all-inclusive sections:
  [Hospitality Net — HFTP, AHLA and GFC unveil the 12th Revised Edition](https://www.hospitalitynet.org/news/4122858/hftp-ahla-and-gfc-unveil-groundbreaking-12th-revised-edition-of-the-uniform-system-of-accounts-for-the-lodging-industry-usali);
  [Hotel Online — Is your finance team ready for January 2026?](https://www.hotel-online.com/news/usali-12th-revised-edition-is-your-finance-team-ready-for-january-2026);
  new sustainability and brand cost categories, updated departmental schedules, lease accounting changes:
  [Hotel Online — HFTP Dubai chapter session](https://www.hotel-online.com/news/hftp-dubai-chapter-hosts-insightful-session-on-usali-12th-revised-edition).
  11th edition: Miscellaneous Income line and EBITDA naming:
  [Hospitality Net — changes in the 11th edition](https://www.hospitalitynet.org/opinion/4072936/small-yet-impactful-changes-in-the-11th-edition-of-the-uniform-system-of-accounts-for-the-lodging-industry).
  Line-item detail of the 12th edition was **not** verified (HFTP materials — Q105).
- GST returns MIRA 205 (general) / MIRA 206 (tourism), due 28th, tourism in USD and online:
  [MIRA — Do I need to file a GST return?](https://www.mira.gov.mv/Pages/View/gstreturn).
- Employee withholding tax MIRA 601 due by the 15th; currency rules:
  [MIRA — How to file EWT return](https://www.mira.gov.mv/Pages/View/ewtfile).
