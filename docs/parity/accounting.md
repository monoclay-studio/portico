# Parity: accounting

Module: `accounting` (back-office accounting on the finance journal: chart and dimensions, journals, payables, bank
and cash, period close, statements, tax-return data, fixed assets, budgets, intercompany, management and owner
reporting, ERP export) · Spec: `docs/specs/accounting.md` (merged on `main`).

**Baseline.** The expectations a hotel controller brings from Xero, QuickBooks Online and Oracle NetSuite (official
help pages), plus hotel-specific accounting in OPERA Cloud (budget forecast, period definitions, back-office exports)
and the PMS ledgers of Mews and Apaleo. Evidence links at the end; **all verified 2026-11-07**.

**Status rule.** No `accounting` code exists on `main` or any branch: rows are `specified` (cited ACC-Rnn),
`deferred` (spec says LATER / integrate), or `missing`. Stage A = MUST, stage B = SHOULD (accounting.md §2.2).

## Capabilities

### Setup, chart of accounts and dimensions

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ACC-001 | Accounting entity per legal entity with fiscal calendar (12 periods + adjustment period) | OPERA [period definitions][op-periods] · NetSuite [period close][ns-close] | P0 | specified | accounting.md ACC-R01 | — |
| PAR-ACC-002 | Chart-of-accounts templates by property profile (compact guesthouse, full resort), USALI-aligned | Apaleo [USALI-inspired accounting][ap-acct] | P0 | specified | accounting.md ACC-R02 | — |
| PAR-ACC-003 | Account types, normal balance, control owner (sub-ledger accounts cannot take manual journals) | Xero [locked and system accounts][xero-locked] | P0 | specified | accounting.md ACC-R02 | — |
| PAR-ACC-004 | Dimensions (property, department, outlet, project, partner) with required/optional/forbidden per account | Xero [tracking categories][xero-tracking] · NetSuite [subsidiaries][ns-subs] | P0 | specified | accounting.md ACC-R03 | — |
| PAR-ACC-005 | Versioned reporting trees (USALI summary, departmental schedules, statutory, owner) with completeness check | assumption (USALI practice; Q105) | P0 | specified | accounting.md ACC-R04 | — |
| PAR-ACC-006 | Statistical (non-monetary) accounts for ratios and allocation bases | OPERA [statistics export][op-xml-bo] | P1 | specified | accounting.md ACC-R09 | — |
| PAR-ACC-007 | Multi-currency: functional + reporting currencies, foreign-currency accounts | Xero [foreign currency accounts][xero-fx-accts] | P0 | specified | accounting.md ACC-R01; finance.md FIN-R40 | — |

### Journals

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ACC-010 | Manual journals with attachments, approval by amount/account class, preparer ≠ approver | NetSuite [journal approvals via FAM][ns-depr] · QuickBooks [approval workflows][qb-approval] | P0 | specified | accounting.md ACC-R05 | — |
| PAR-ACC-011 | Recurring journals with schedule and end date | Xero [repeating journal][xero-repeat-journal] | P0 | specified | accounting.md ACC-R06 | — |
| PAR-ACC-012 | Auto-reversing accruals | NetSuite [period close checklist][ns-close] | P0 | specified | accounting.md ACC-R06 | — |
| PAR-ACC-013 | Prepayment amortization schedules | NetSuite [amortization schedules][ns-amort] | P1 | specified | accounting.md ACC-R06 | — |
| PAR-ACC-014 | Allocation journals by statistical basis (management view, separate tree) | assumption (USALI undistributed expenses) | P1 | specified | accounting.md ACC-R06 | — |
| PAR-ACC-015 | Journal import (CSV/XLSX) with validation preview, as a draft batch | assumption (common) | P0 | specified | accounting.md ACC-R07 | — |
| PAR-ACC-016 | Payroll journal import from the payroll provider | assumption (boundary WFM §15) | P0 | specified | accounting.md ACC-R07 | — |
| PAR-ACC-017 | Accounting date vs business date vs occurred-at on every back-office journal | Apaleo [business date vs posting date][ap-night-audit] | P0 | specified | accounting.md ACC-R08 | — |
| PAR-ACC-018 | Corrections only by linked reversal; posted journals immutable | Mews [immutable ledger activity][mw-ledger-activity] | P0 | specified | accounting.md ACC-R05; finance.md FIN-R03 | — |
| PAR-ACC-019 | Deferred revenue recognition schedules (e.g., memberships, long-stay prepayments) | NetSuite [revenue recognition before close][ns-close] | P2 | missing | — | — |

### Accounts payable

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ACC-020 | Supplier master with tax registration, residence, terms, status, duplicate detection | Oracle F&B [vendors][fb-vendors] | P0 | specified | accounting.md ACC-R10 | — |
| PAR-ACC-021 | Supplier bank-detail change controls (second approver, out-of-band verification, cooling-off) | QuickBooks [payment release roles][qb-approval] | P0 | specified | accounting.md ACC-R11 | — |
| PAR-ACC-022 | Supplier invoice capture (upload, photo, email inbox) with tax lines and attachments | Oracle F&B [invoicing][fb-invoicing] | P0 | specified | accounting.md ACC-R12 | — |
| PAR-ACC-023 | Duplicate supplier-invoice detection with override reason | assumption (AP control) | P0 | specified | accounting.md ACC-R12 | — |
| PAR-ACC-024 | PO-backed invoices matched (three-way) before approval; non-PO invoices coded and approved by owner and amount band | Oracle F&B [send approved invoice to AP][fb-invoice-ap] · QuickBooks [bill approval][qb-approval] | P0 | specified | accounting.md ACC-R13; procurement.md PRC-R23 | — |
| PAR-ACC-025 | Supplier credit/debit notes, allocations and supplier advances/prepayments | Oracle F&B [returns to vendor][fb-returns] | P0 | specified | accounting.md ACC-R14 | — |
| PAR-ACC-026 | Payment runs: proposal by due/discount date, approval, payment instruction file, remittance advice | Xero [pay multiple bills / batch payment file][xero-pay-bills] | P0 | specified | accounting.md ACC-R15 | — |
| PAR-ACC-027 | Supplier invoice shown paid only after bank confirmation | assumption (CLAUDE.md §5) | P0 | specified | accounting.md ACC-R15 | — |
| PAR-ACC-028 | Repeating supplier bills (rent, leases, subscriptions) | Xero [repeating bill][xero-repeat-bill] | P1 | missing | — | — |
| PAR-ACC-029 | Travel-agent commissions payable matched to agency statements | OPERA [commission payments][op-comm-pay] | P1 | specified | accounting.md ACC-R16 | — |
| PAR-ACC-030 | OTA commission invoice reconciled line by line against expected commission | assumption (hotel back-office practice) | P1 | specified | accounting.md ACC-R17 | — |
| PAR-ACC-031 | AP aging, supplier statement reconciliation, GRNI aging | Oracle F&B [receipts invoiced status][fb-receipts-view] | P0 | specified | accounting.md ACC-R18 | — |
| PAR-ACC-032 | Invoice data extraction (OCR/AI) as proposals confirmed by a person | assumption (market trend) | P2 | specified | accounting.md ACC-R19 | — |
| PAR-ACC-033 | Early-payment discounts, payment holds, partial payments, AP/AR offsets | QuickBooks [pay bills][qb-approval] | P1 | specified | accounting.md ACC-R20 | — |
| PAR-ACC-034 | Withholding tax codes on non-resident supplier payments | assumption (Q106) | P1 | specified | accounting.md ACC-R12 (data, unverified) | — |
| PAR-ACC-035 | Employee expense claims and reimbursement | assumption (Xero/QuickBooks expense claims) | P2 | missing | — | — |
| PAR-ACC-036 | Corporate expense-card feeds and receipts | assumption | P2 | deferred | accounting.md §2 non-goal (integrate) | — |

### Bank and cash

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ACC-040 | Bank accounts per entity and currency mapped to GL | Xero [reconcile bank account][xero-rec] | P0 | specified | accounting.md ACC-R21 | — |
| PAR-ACC-041 | Statement import (CSV profiles, MT940, CAMT.053) with gap/overlap detection | Xero [bank statement lines][xero-statements] | P0 | specified | accounting.md ACC-R22 | — |
| PAR-ACC-042 | Live bank feeds | Xero [reconcile with bank feeds][xero-rec] | P1 | deferred | accounting.md ACC-R22 (LATER via integration; Q107) | — |
| PAR-ACC-043 | Suggested matches by reference, amount/date/counterparty; one-to-many and many-to-one | Xero [find and match][xero-findmatch] | P0 | specified | accounting.md ACC-R23 | — |
| PAR-ACC-044 | Bank rules creating transactions for recurring lines (bank charges, interest, direct debits) | Xero [bank rules][xero-bankrule] | P0 | specified | accounting.md ACC-R23 | — |
| PAR-ACC-045 | Reconcile many statement lines in bulk (cash coding) | Xero [cash coding][xero-cashcode] | P2 | missing | — | — |
| PAR-ACC-046 | Batch payment / batch deposit matched as one line | Xero [batch payments and deposits][xero-batch] | P0 | specified | accounting.md ACC-R23 (many-to-one) | — |
| PAR-ACC-047 | Reconciliation statement per period explaining every outstanding item; sign-off locks matches | Xero [reconciliation details][xero-recdetails] · [reconcile a period][xero-period] | P0 | specified | accounting.md ACC-R23 | — |
| PAR-ACC-048 | Card payouts matched to the payments module's payout records (fees not re-derived) | Mews [reconcile ledgers][mw-ledger-reconcile] | P0 | specified | accounting.md ACC-R24 | — |
| PAR-ACC-049 | Cash position and 13-week cash forecast | assumption (treasury practice) | P1 | specified | accounting.md ACC-R25 | — |
| PAR-ACC-050 | USD/MVR conversions at the bank recorded with both legs and rate | assumption (Maldives) | P0 | specified | accounting.md ACC-R25 | — |
| PAR-ACC-051 | Petty cash funds, vouchers, replenishment and counts | assumption | P1 | specified | accounting.md ACC-R26 | — |
| PAR-ACC-052 | Cash deposits from cashier sessions matched to the bank | Infor [cashier banking report][inf-cashier-bank] | P0 | specified | accounting.md ACC-R23 (cash deposit slip) | — |

### Period close and year end

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ACC-060 | Close checklist with owners, due days, dependencies and automatic system checks | NetSuite [period close checklist][ns-close] | P0 | specified | accounting.md ACC-R27 | — |
| PAR-ACC-061 | Soft close / hard close per source (cut-off matrix); reopen with permission and reason | Xero [lock dates in financial settings][xero-lockdates] · Agilysys [fiscal close][ag-fiscal-man] | P0 | specified | accounting.md ACC-R28 | — |
| PAR-ACC-062 | FX revaluation of open balances at period-end rate, auto-reversed | Xero [FX gains and losses][xero-fx] · NetSuite [revaluation before close][ns-close] | P1 | specified | accounting.md ACC-R29 | — |
| PAR-ACC-063 | Realized FX on settlement | Xero [realised gains and losses][xero-realised] | P0 | specified | accounting.md ACC-R29; finance.md FIN-R41 | — |
| PAR-ACC-064 | Year-end close to retained earnings with preview; period-13 audit adjustments; final lock | Xero [year end][xero-yearend] | P1 | specified | accounting.md ACC-R30 | — |
| PAR-ACC-065 | Restatement register for corrections after close | assumption (brief §10) | P0 | specified | accounting.md ACC-R08; finance.md FIN-R43 | — |
| PAR-ACC-066 | Close requires every business date of the period to have completed Day Close | Agilysys [date roll vs fiscal close][ag-fiscal-auto] | P0 | specified | accounting.md ACC-R27 | — |

### Statements, reports and tax

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ACC-070 | Trial balance by range and dimension; GL detail with drill-down to the source document | Mews [trial balance][mw-trial-balance] | P0 | specified | accounting.md ACC-R31 | — |
| PAR-ACC-071 | Sub-ledger vs control account reconciliation report | Xero [fixed asset reconciliation report][xero-fa-rec] | P0 | specified | accounting.md ACC-R31 | — |
| PAR-ACC-072 | USALI-aligned P&L with departmental schedules, budget/last year/forecast columns, per room/cover ratios | Xero [profit and loss][xero-pl] · [budget variance][xero-budget-var] | P0 | specified | accounting.md ACC-R32 | — |
| PAR-ACC-073 | Balance sheet with comparatives | Xero [profit and loss / reports][xero-pl] | P0 | specified | accounting.md ACC-R33 | — |
| PAR-ACC-074 | Cash-flow statement (indirect) | assumption | P1 | specified | accounting.md ACC-R33 [SHOULD] | — |
| PAR-ACC-075 | As-closed vs current statements with restatement deltas | assumption (brief §10) | P1 | specified | accounting.md ACC-R34 | — |
| PAR-ACC-076 | Monthly management pack (KPIs incl. GOPPAR, flow-through, labour %, F&B cost %) with variance commentary and approval | assumption (hotel controller practice) | P1 | specified | accounting.md ACC-R35 | — |
| PAR-ACC-077 | Tax return working papers (MIRA 205/206 GST, 501 Green Tax) with output and input tax | OPERA [Maldives Green Tax report][op-rpt-fin] | P0 | specified | accounting.md ACC-R36 | — |
| PAR-ACC-078 | Return lifecycle draft → reviewed → filed (reference recorded) → paid (bank matched); amendments | assumption | P0 | specified | accounting.md ACC-R37 | — |
| PAR-ACC-079 | Direct electronic filing with the tax authority | assumption | P2 | deferred | accounting.md §15 — manual filing until an authorized interface exists | — |
| PAR-ACC-080 | Statutory data beyond GST (payroll withholding/pension liabilities, profit-tax TB export) | assumption | P2 | specified | accounting.md ACC-R38 | — |
| PAR-ACC-081 | Budget forecast entry per property and period in the PMS | OPERA [budget forecast entry][op-budget] | P1 | specified | accounting.md ACC-R40 | — |

### Fixed assets, budgets, groups and owners

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ACC-090 | Asset register with classes, methods, life, salvage, link to physical asset | NetSuite [fixed assets management][ns-fam] · [asset register report][ns-asset-register] | P1 | specified | accounting.md ACC-R39 | — |
| PAR-ACC-091 | Monthly depreciation run with preview, keyed posting | NetSuite [depreciating assets for the period][ns-depr] | P1 | specified | accounting.md ACC-R39 | — |
| PAR-ACC-092 | Disposals, write-offs (gain/loss), transfers between properties | NetSuite [FAM FAQ][ns-fam] | P1 | specified | accounting.md ACC-R39 | — |
| PAR-ACC-093 | Capitalize from AP capex lines and procurement receipts | assumption | P1 | specified | accounting.md ACC-R39 | — |
| PAR-ACC-094 | Depreciation schedule forecast for future periods | NetSuite [fixed asset reports][ns-fa-reports] | P2 | missing | — | — |
| PAR-ACC-095 | Impairment, revaluation, IFRS 16 lease accounting | assumption | P2 | deferred | accounting.md ACC-R39 (LATER), §15 | — |
| PAR-ACC-100 | Budget versions by account × dimension × month with drivers (rooms, F&B, labour) and approval | Xero [create a budget][xero-budget] | P1 | specified | accounting.md ACC-R40 | — |
| PAR-ACC-101 | Budget availability check for purchasing (warn / extra approval / block) | assumption | P1 | specified | accounting.md ACC-R40 | — |
| PAR-ACC-102 | Forecasts from on-the-books revenue labelled as estimates | assumption | P1 | specified | accounting.md ACC-R41 | — |
| PAR-ACC-103 | Budget by tracking category / department | Xero [budget manager per tracking category][xero-budget] | P1 | specified | accounting.md ACC-R40 | — |
| PAR-ACC-110 | Consolidation with currency translation and eliminations | NetSuite [elimination journal entries][ns-elim] · [OneWorld][ns-oneworld] | P1 | deferred | accounting.md ACC-R42 [LATER] — export to group ERP until demand proven | — |
| PAR-ACC-111 | Intercompany due-to/due-from, recharges and mirror entries with matching report | NetSuite [intercompany journals][ns-ic-je] | P1 | specified | accounting.md ACC-R43 | — |
| PAR-ACC-112 | Management agreement fees (base, incentive, FF&E reserve) accrued from statements | assumption (hotel management contracts) | P1 | specified | accounting.md ACC-R44 | — |
| PAR-ACC-113 | Owner reporting package with review-before-send | assumption (Guesty owner statements, research 03 §6.2) | P1 | specified | accounting.md ACC-R45 | — |
| PAR-ACC-114 | Unit-owner (condo/rental pool) accounting | assumption (research 03 §6.2) | P2 | deferred | accounting.md ACC-R46 [LATER] | — |

### Controls, export and migration

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ACC-120 | Audit trail per journal and master-data change log; SoD conflict report | QuickBooks [roles for approval and release][qb-approval] | P0 | specified | accounting.md ACC-R47 | — |
| PAR-ACC-121 | Time-boxed auditor access and PBC pack export with file hashes | assumption (audit practice) | P1 | specified | accounting.md ACC-R48 | — |
| PAR-ACC-122 | ERP export profiles (generic file, Xero, QuickBooks, NetSuite, SAP, SunSystems, Business Central) with acknowledgement and delta batches | OPERA [back office exports][op-bo-exports] · Apaleo [accounts export][ap-fin] · Mews [accounting integrations][mw-acct-uc] | P0 | specified | accounting.md ACC-R49 | — |
| PAR-ACC-123 | Document sync to the ERP (receivables invoices, receipts, supplier vouchers, payments) | Mews [accounting use case][mw-acct-uc] | P1 | specified | accounting.md ACC-R50 | — |
| PAR-ACC-124 | Opening position migration through suspense, reconciled to the minor unit | assumption (S18) | P0 | specified | accounting.md ACC-R51 | — |
| PAR-ACC-125 | Journal-only mode for hotels keeping their PMS (revenue journal imported) | Mews [editable history window before export][mw-acct-uc] | P1 | specified | accounting.md §14 | — |
| PAR-ACC-126 | Non-guest customer invoices (rent, concession and utility recharges) issued from accounting | OPERA [adding AR invoices][op-ar-invoices] | P1 | missing | — | — |
| PAR-ACC-127 | Custom financial report builder (rows/columns, saved, scheduled) | Xero [reporting topic][xero-reporting] | P2 | specified | analytics.md ANL-R07 | — |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-ACC-001 | Imported bank statement overlaps the previous one by three days | Duplicate lines rejected by line hash; overlap reported as `statement_overlap`; nothing double-counted | P0 | specified | — |
| EC-ACC-002 | Statement opening balance differs from the last closing balance | `statement_gap` exception with the difference; reconciliation for the period cannot be signed off | P0 | specified | — |
| EC-ACC-003 | Supplier asks by email to change bank details the day before a payment run | Change request needs a second approver and recorded out-of-band verification; payments to new details held for the cooling-off period; supplier's known contact notified | P0 | specified | — |
| EC-ACC-004 | The same supplier invoice is uploaded twice (photo + email) | Second blocked as duplicate (supplier + normalized number); override only with permission and reason | P0 | specified | — |
| EC-ACC-005 | Payment file handed to the bank but the bank rejects two lines | Those payments `returned`; release journal reversed for them; invoices reopened; others proceed | P0 | specified | — |
| EC-ACC-006 | Telegraphic transfer to a foreign island supplier arrives short by intermediary bank fees | Supplier shows a residual; staff records bank fee on our side or supplier credit per agreement; never auto-written-off silently | P0 | missing | — |
| EC-ACC-007 | Supplier invoice in EUR paid from a USD account | Payment posts realized FX between invoice rate and payment rate; bank line matched in USD | P0 | specified | — |
| EC-ACC-008 | Late supplier invoice dated in a hard-closed period | Posts to the current open period with `relatesToPeriod`; restatement register entry; closed period untouched | P0 | specified | — |
| EC-ACC-009 | AP clerk posts in a soft-closed period at BD+4 | Allowed only with `accounting.period.postSoftClosed` and within the source's cut-off; otherwise refused with the cut-off rule shown | P0 | specified | — |
| EC-ACC-010 | Auto-reversing accrual cannot reverse because next period is closed | Reversal posts in the first open period with link and warning; never skipped | P1 | missing | — |
| EC-ACC-011 | Depreciation run executed twice for the same period | Key `depr:{asset}:{period}` replays; no second entry | P1 | specified | — |
| EC-ACC-012 | Asset disposed mid-month after salt-corrosion damage | Depreciation to disposal date per policy; gain/loss computed; register and GL reconcile | P1 | specified | — |
| EC-ACC-013 | Payroll journal imported unbalanced or with an unknown account | Import preview rejects with line-level reasons; nothing posted | P0 | specified | — |
| EC-ACC-014 | Payroll journal for the same month imported twice | Duplicate detected by source reference; second import blocked | P0 | specified | — |
| EC-ACC-015 | Preparer tries to approve their own manual journal | Refused (preparer ≠ approver); approval request goes to another holder | P0 | specified | — |
| EC-ACC-016 | GST return amended after it was filed | New linked version `amended`; original stays `filed`; settlement journal difference only | P0 | specified | — |
| EC-ACC-017 | MVR conversion on a USD tourism GST return deviates more than 2% from the MMA rate | Review blocked with both rates and deviation shown (unverified rule, Q106) | P1 | specified | — |
| EC-ACC-018 | ERP export batch resent after a timeout | Deterministic external reference prevents duplicates where the target accepts references; otherwise "already exported on …" warning requiring permission | P0 | specified | — |
| EC-ACC-019 | ERP rejects a batch because an account is unmapped | Batch `rejected` with the missing mapping; delta batch after fix; coverage report shows every entry exported exactly once | P0 | specified | — |
| EC-ACC-020 | Correction to an already exported journal | Only a delta batch is sent; ERP acknowledgement tracked; never "posted in ERP" before acknowledgement | P0 | specified | — |
| EC-ACC-021 | Opening trial balance import differs from the source TB by USD 3.17 | Difference in migration suspense with account-level list; cutover sign-off blocked until explained | P0 | specified | — |
| EC-ACC-022 | Supplier credit note exceeds the open invoice | Excess becomes supplier credit (debit balance) applied to future invoices or refunded; aging shows it | P1 | specified | — |
| EC-ACC-023 | Supplier advance paid in USD applied to an invoice in MVR | Application at the stored rates; FX difference realized; advance balance never negative | P1 | missing | — |
| EC-ACC-024 | Goods received before month end, invoice arrives next month | GRNI accrual from procurement at receipt; invoice match relieves GRNI next month; GRNI aging lists unmatched receipts | P0 | specified | — |
| EC-ACC-025 | OTA charges commission on taxes and fees | Line-level difference flagged with evidence for dispute; only the approved amount becomes a voucher | P1 | specified | — |
| EC-ACC-026 | Bank line matched to two records (one deposit covering three cashier sessions) | Many-to-one match recorded once; a line can never be matched twice across periods | P0 | specified | — |
| EC-ACC-027 | Reconciliation shows USD 0.01 unexplained | Sign-off blocked; rounding adjustment only via rule with approval; difference visible | P0 | specified | — |
| EC-ACC-028 | Period-end FX revaluation with no MMA rate entered for the last day | Revaluation blocked with "enter period-end rate"; no default rate | P1 | missing | — |
| EC-ACC-029 | Intercompany recharge posted in entity A but the mirror entry is rejected in entity B | Matching report shows the open difference with owner; close checklist item "intercompany matched" stays red | P1 | specified | — |
| EC-ACC-030 | Budget locked, then a reforecast is needed mid-year | New version (reforecast) created; original locked version unchanged; reports choose version | P1 | specified | — |
| EC-ACC-031 | Purchase exceeds remaining budget for the account | Per policy: warning, extra approval or block, with availability = budget − actual − commitments shown | P1 | specified | — |
| EC-ACC-032 | Auditor access window expires during fieldwork | Access ends automatically; extension needs approval; all reads remain audited | P1 | specified | — |
| EC-ACC-033 | Reporting tree published with an unmapped new account | Publication blocked by completeness check naming the account | P0 | specified | — |
| EC-ACC-034 | Close checklist auto-check: one business date of the month never completed Day Close | Check red with the date and link; period cannot hard-close | P0 | specified | — |
| EC-ACC-035 | Management fee incentive depends on GOP that is later restated | True-up computed from current figures with the restatement linked; prior accrual not edited | P1 | specified | — |
| EC-ACC-036 | Non-resident supplier invoice requiring withholding (rules unverified) | Withholding code applied from data marked `unverified`; payment run shows gross, withheld and net; live filing blocked until verified (Q106) | P1 | specified | — |
| EC-ACC-037 | Bank statement in MVR for an MVR account while functional currency is USD | Lines kept in MVR; GL in both currencies via rate per date; revaluation at period end | P0 | specified | — |

## Evidence sources (all verified 2026-11-07)

Verification method: pages on docs.oracle.com, docs.mews.com, help.mews.com, api.apaleo.com, apaleo.dev and
docs.stripe.com were fetched and read on 2026-11-07. Pages on hosts this environment's proxy blocks
(central.xero.com, quickbooks.intuit.com, help.rguest.com, docs.infor.com, apaleo.zendesk.com,
mewssystems.freshdesk.com, Toast, Omniboost, Stayntouch, Clock, TrustRadius, oracle.com marketing) were verified
2026-11-07 through web-search results showing the page and its content, or through `docs/research/` citations;
re-open them before any external use. Third-party pages (Omniboost, Stayntouch, Clock, TrustRadius) describe a
competitor's behaviour indirectly and are weaker evidence than the vendor's own documentation.

[xero-rec]: https://central.xero.com/0/article/Reconcile-your-bank-account
[xero-findmatch]: https://central.xero.com/0/article/Reconcile-a-bank-statement-line-using-Find-Match
[xero-bankrule]: https://central.xero.com/0/article/Create-a-bank-rule
[xero-cashcode]: https://central.xero.com/0/article/Reconcile-using-cash-coding
[xero-statements]: https://central.xero.com/s/article/View-bank-statements-and-bank-statement-lines-UK
[xero-recdetails]: https://central.xero.com/0/article/View-bank-reconciliation-details
[xero-period]: https://central.xero.com/0/article/Reconcile-a-period
[xero-batch]: https://central.xero.com/0/article/Reconcile-a-batch-payment-or-batch-deposit
[xero-pay-bills]: https://central.xero.com/0/article/Pay-multiple-bills-GL
[xero-repeat-bill]: https://central.xero.com/0/article/Add-or-edit-a-repeating-bill-GL
[xero-repeat-journal]: https://central.xero.com/0/article/Set-up-a-repeating-journal
[xero-fa-rec]: https://central.xero.com/0/article/Fixed-Asset-Reconciliation-report-new-AU
[xero-fx]: https://central.xero.com/0/article/Foreign-Currency-Gains-and-Losses-report
[xero-realised]: https://central.xero.com/0/article/Realised-gains-and-losses-report
[xero-fx-accts]: https://central.xero.com/0/article/Foreign-currency-accounts-in-the-chart-of-accounts-GL
[xero-tracking]: https://central.xero.com/0/article/Set-up-tracking-categories
[xero-budget]: https://central.xero.com/0/article/Create-a-budget
[xero-budget-var]: https://central.xero.com/0/article/Budget-Variance-report
[xero-locked]: https://central.xero.com/0/article/Locked-and-system-accounts-in-your-chart-of-accounts
[xero-lockdates]: https://central.xero.com/0/article/Troubleshooting-for-conversion-balances
[xero-yearend]: https://central.xero.com/0/article/Do-a-year-end-in-Xero-GL
[xero-pl]: https://central.xero.com/0/article/Profit-and-Loss-New
[xero-reporting]: https://central.xero.com/s/topic/0TO1N0000017kmLWAQ/reporting-tracking
[ns-close]: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1455781.html
[ns-elim]: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1475762.html
[ns-ic-je]: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1475891.html
[ns-amort]: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1776086.html
[ns-oneworld]: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N266701.html
[ns-subs]: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N268563.html
[ns-fam]: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_3891643944.html
[ns-depr]: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/subsect_1201085716.html
[ns-asset-register]: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_4466048022.html
[ns-fa-reports]: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/subsect_1202061114.html
[qb-approval]: https://quickbooks.intuit.com/learn-support/en-us/help-article/manage-workflows/set-use-bill-approval-and-payment-release-workflows/L1IOLL9hv_US_en_US
[op-periods]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_configuring_period_definition_periods.htm
[op-budget]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_budget_forecast_entry.htm
[op-xml-bo]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_exports_generic_xml_back_office_export.htm
[op-bo-exports]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_exports_back_office_exports.htm
[op-comm-pay]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_commissions_processing_commission_payments.htm
[op-rpt-fin]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_financials.htm
[op-ar-invoices]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_managing_ar_account_invoices_and_payments.htm
[ap-acct]: https://apaleo.zendesk.com/hc/en-us/articles/360019220119-Introduction-to-the-Apaleo-Accounting
[ap-night-audit]: https://apaleo.zendesk.com/hc/en-us/articles/115003519971-Night-Audit-Revenue-Recognition-and-Prepayment-Handling-payment-deposits
[ap-fin]: https://api.apaleo.com/swagger/finance-v1/swagger.json
[mw-acct-uc]: https://docs.mews.com/connector-api/use-cases/accounting
[mw-ledger-activity]: https://help.mews.com/s/article/The-Ledger-activity-report-in-Mews-Operations
[mw-ledger-reconcile]: https://help.mews.com/s/article/How-to-reconcile-your-Ledgers-in-Mews-Operations
[mw-trial-balance]: https://help.mews.com/s/article/Understanding-the-new-Ledgers-and-Trial-balance-in-Mews-Operations
[ag-fiscal-auto]: https://help.rguest.com/stay/UserGuide/Automatically%20Closing%20a%20Fiscal.htm
[ag-fiscal-man]: https://help.rguest.com/stay/UserGuide/Manually%20Closing%20a%20Fiscal.htm
[inf-cashier-bank]: https://docs.infor.com/hms/3.8/en-us/hmsolh/pages/cashierbankingreport_help.html
[fb-vendors]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_masterdata_vendors.htm
[fb-invoicing]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_invoicing.htm
[fb-invoice-ap]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_invoicing_send_approved_invoice_to_ap.htm
[fb-returns]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_receiving_return_items_to_vendor.htm
[fb-receipts-view]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_receiving_view_suspend_booked_invoiced_cancelled_receipts.htm
