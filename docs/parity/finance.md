# Parity: finance

Module: `finance` (folios, postings, charge codes, billing rules, deposits, receivables, fiscal documents,
cashiering, FX, commissions, finance reports) · Spec: `docs/specs/finance.md` · Format: `docs/parity/README.md`.

**Baseline.** OPERA Cloud 26.2 *Financials* and *Financial Administration* chapters (Cashiering, Accounts
Receivable, Commissions, End of Day, Exports, Reports) are the inventory; Apaleo Finance API v1/beta, Mews
Connector API and Mews help centre add the modern/automation rows; Agilysys Stay and Infor HMS add resort and
date-roll behaviour. Evidence links are listed at the end of the file; **every link was verified 2026-11-07**.
Rows without a source say `assumption`.

**Status rule.** `specified` = the current spec states it (cited); `missing` = no spec text and no code;
`deferred` / `different` = deliberate, reason in the Spec column. **`built`/`tested` cite branch
`feat/finance-core` @ `232be3a` (worktree `wt/finance`, under review, not yet on `main`)**: paths in the Test column
are relative to the repository root on that branch. If the branch merges with changes, the steward re-verifies these
rows; if it is rejected they fall back to `specified`. Tax figures in those tests come from a fake tax engine until
`rates` is bound (finance README). Priorities: P0 = needed to compete or to run a Maldives pilot; P1 = expected by
full-service hotels, resorts or groups; P2 = differentiator or rare.

## Capabilities

### Ledger and chart of accounts

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-001 | One double-entry ledger per legal entity, real time, source of truth for every money figure | Apaleo [accounting][ap-acct] · [chart of accounts API][ap-fin] · Mews [ledgers][mw-ledger-api] | P0 | tested | finance.md FIN-R01, FIN-R02 | modules/finance/test/ledger.test.ts |
| PAR-FIN-002 | Hospitality chart-of-accounts template (guest ledger, deposits held, receivables, revenue by department, taxes payable, card clearing, cash, payout clearing, commissions, FX, rounding, suspense) | Apaleo [accounting][ap-acct] · OPERA [revenue buckets][op-rev-buckets] | P0 | tested | finance.md FIN-R01 | modules/finance/src/domain/domain.test.ts (chart); test/demo-seed.test.ts |
| PAR-FIN-003 | Receivable sub-account per folio/reservation so every bill's balance is provable from the ledger | Apaleo [accounting][ap-acct] · [guest accounts API][ap-fin] | P0 | tested | finance.md FIN-R01, FIN-I03 | modules/finance/test/ledger.test.ts (folio is a projection) |
| PAR-FIN-004 | Separate ledgers visible to finance: guest, deposit, city (receivables), package/allowance, revenue, tax, payment, non-revenue | Mews [ledger types][mw-ledger-api] · OPERA [EOD ledgers][op-eod-procs] | P0 | built | finance.md FIN-R42, FIN-R45 | modules/finance/test/scenario-s19-package-allowance-taxes.test.ts (integrity report; ledger lists partial) |
| PAR-FIN-005 | Every entry carries business date and posting timestamp; service date and revenue date per line | Apaleo [night audit][ap-night-audit] · OPERA [business date][op-eod] | P0 | tested | finance.md FIN-R02, FIN-R04 | modules/finance/test/ledger.test.ts |
| PAR-FIN-006 | Balanced in transaction currency and in functional currency on every entry | assumption (double-entry practice) | P0 | tested | finance.md FIN-R02, FIN-I01 | modules/finance/test/ledger.test.ts; src/domain/domain.test.ts (functional amounts) |
| PAR-FIN-007 | Posted entries immutable; corrections are linked reversing/adjusting entries | Mews [immutable ledger activity][mw-ledger-activity] · Apaleo [folio correct][ap-fin] | P0 | tested | finance.md FIN-R03, FIN-I05 | modules/finance/test/ledger.test.ts (append-only); test/security-and-corrections.test.ts |
| PAR-FIN-008 | No posting to a past business date except labelled restatements | Apaleo [only audit posts to past dates][ap-night-audit] | P0 | tested | finance.md FIN-R04 | modules/finance/test/security-and-corrections.test.ts (restatement); test/scenario-s10-late-restaurant-charge.test.ts |
| PAR-FIN-009 | Editable history window (edit past days freely for N days) | Mews [editable history window][mw-ehw] | P2 | different | finance.md FIN-R04 — Portico uses current-date corrections + restatement register instead | — |
| PAR-FIN-010 | Effective-dated mapping of charge codes to revenue accounts (history keeps old mapping) | OPERA [transaction codes][op-trx-codes] · Apaleo [accounting config updates][ap-ops-beta] | P0 | specified | finance.md FIN-R12 — branch keeps account used per line; effective-dated mapping table not built | — |
| PAR-FIN-011 | Recalculate unposted future charges after accounting configuration change (preview first) | Apaleo [accounting-config-updates, city-tax-recalculation][ap-ops-beta] | P1 | missing | — | — |
| PAR-FIN-012 | Real-time trial balance with drill-down to postings | OPERA [trial balance][op-rpt-fin] · Mews [trial balance][mw-trial-balance] | P0 | tested | finance.md FIN-R42 | modules/finance/test/scenario-s19-package-allowance-taxes.test.ts |
| PAR-FIN-013 | Continuous integrity checks: Σ folios = guest ledger control; deposits and receivables controls; unbalanced items list | OPERA [guest ledger imbalance fix][op-eod-procs] · Apaleo [accounting][ap-acct] | P0 | tested | finance.md FIN-R44, FIN-R45 | modules/finance/test/scenario-s19-package-allowance-taxes.test.ts (assertLedgerIntegrity in every scenario) |
| PAR-FIN-014 | Ledger balances API (opening/closing per ledger per day) for integrators | Mews [ledger balances][mw-ledger-api] · Apaleo [aggregate-daily][ap-fin] | P1 | missing | — | — |
| PAR-FIN-015 | Transaction export by business day and by timestamp (net and gross) for accounting systems | Apaleo [export-daily, export-gross-daily][ap-fin] | P0 | specified | finance.md FIN-R43, §11 (journal export via integration) | — |

### Folios

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-020 | Multiple folios per stay, each with its own payer and payment method | OPERA [billing windows 1–8][op-billing] · Apaleo [additional folios][ap-fin] | P0 | tested | finance.md FIN-R05 | modules/finance/test/scenario-s04-company-pays-accommodation.test.ts |
| PAR-FIN-021 | Folios labelled by payer name, not window number | assumption (research 01 §3.6 design implication) | P1 | tested | finance.md FIN-R05, §9 | modules/finance/test/scenario-s04-company-pays-accommodation.test.ts |
| PAR-FIN-022 | Booking-level folio (one bill for a multi-room booking) | Apaleo [booking folio][ap-fin-beta] | P0 | tested | finance.md FIN-R05 | modules/finance/test/reservations-port.test.ts |
| PAR-FIN-023 | Group master folio / posting master and additional posting masters | OPERA [posting master][op-posting-master] | P1 | built | finance.md FIN-R05; groups.md GRP-R09 | — (owner `group` implemented; no dedicated test) |
| PAR-FIN-024 | House accounts (pseudo rooms) for non-stay revenue, staff meals, hotel use | OPERA [house posting accounts][op-house-acct] · Apaleo [house account][ap-folio-types] | P0 | built | finance.md FIN-R05 (owner `house`) | — (owner `house` implemented; no dedicated test) |
| PAR-FIN-025 | External / passer-by folio for non-staying customers (day guests, walk-in spa) | Apaleo [external folios][ap-pos-nonres] · OPERA [Post It][op-postit] | P0 | missing | — | — |
| PAR-FIN-026 | Company-owned bills for non-stay commerce (events, corporate packages) | Mews [bills owned by company][mw-bills] | P1 | specified | finance.md FIN-R05 (owner `company`) | — |
| PAR-FIN-027 | Folio close / reopen with reason and counter | Apaleo [close / reopen][ap-fin] | P0 | tested | finance.md §4.2 folio state machine | modules/finance/test/scenario-s10-late-restaurant-charge.test.ts (reopen) |
| PAR-FIN-028 | Void a folio that never had a posting; country rules requiring a replacement folio after void | OPERA [void folios][op-void-folio] · [EOD Greece void check][op-eod] | P1 | specified | finance.md §4.2 (`voided`); country replacement rule missing | — |
| PAR-FIN-029 | Delete an empty additional folio | Apaleo [DELETE folio][ap-fin] | P2 | specified | finance.md §4.2 (`voided`) | — |
| PAR-FIN-030 | Billing summary per stay (all folios, balances, deposits, pending items) | OPERA [billing summary][op-billing-summary] | P0 | specified | finance.md §9 folio workspace | — |
| PAR-FIN-031 | Folio presentation styles (detailed by date, summary per code, per day one line, package arrangement, group summary) | OPERA [folio styles][op-folio-styles] · Mews [bill PDF templates][mw-bills] | P1 | missing | — | — |
| PAR-FIN-032 | Package components grouped under package line with expandable breakdown | OPERA [folio arrangement codes][op-folio-arr] | P0 | specified | finance.md FIN-R21 | — |
| PAR-FIN-033 | Pro-forma folio / pro-forma invoice before arrival or checkout | OPERA [pro forma folio][op-proforma] · Apaleo [pro-forma invoice][ap-fin-beta] | P1 | missing | — | — |
| PAR-FIN-034 | Folio history: search and reprint historical folios; archive | OPERA [historical folios][op-folio-hist] | P1 | specified | finance.md FIN-R33 (reproducible PDF from snapshot) | — |
| PAR-FIN-035 | Internal charge number per stay usable across outlets before check-in and after checkout | OPERA [internal charge number][op-icn] | P2 | missing | — | — |
| PAR-FIN-036 | Paid-charges view (which charges a payment covered) | Apaleo [paid-charges][ap-fin-beta] | P2 | missing | — | — |

### Postings

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-040 | Post a charge by charge code: amount or quantity × unit price, service date, description, reference | OPERA [posting charges][op-postings] · Apaleo [charges][ap-fin] | P0 | tested | finance.md FIN-R09 | modules/finance/test/ledger.test.ts |
| PAR-FIN-041 | Taxes and service charge generated automatically on every charge (single tax engine) | OPERA [generates][op-generates] | P0 | tested | finance.md FIN-R07; rates.md RAT-R23 | modules/finance/test/scenario-s19-package-allowance-taxes.test.ts (fake tax engine until rates is bound) |
| PAR-FIN-042 | Idempotent postings with deterministic keys (room night, POS line, fee, penalty) | Mews [outlet bills][mw-pos-uc] · assumption (key design) | P0 | tested | finance.md FIN-R08, FIN-I04 | modules/finance/test/scenario-s09-ledger-reposting.test.ts |
| PAR-FIN-043 | Post articles (retail items, UPC/barcode) with price and code | OPERA [articles][op-articles] · [Post It][op-postit] | P1 | missing | — | — |
| PAR-FIN-044 | Batch charges to many folios at once (e.g., event fee to every group member) | OPERA [batch charges][op-batch-charges] | P1 | missing | — | — |
| PAR-FIN-045 | Scheduled fixed charges on a stay (once, daily, weekly, monthly; posted at Day Close) | OPERA [fixed charges][op-fixed-charges] | P1 | missing | — | — |
| PAR-FIN-046 | Pre-stay charging (post to a reservation before check-in, limited days, by payment type) | OPERA [pre-stay charging][op-prestay] | P1 | missing | — | — |
| PAR-FIN-047 | Post-stay charging on open folios after checkout | OPERA [post-stay / open folio][op-open-folio] · Infor [post-departure charges][inf-help] | P0 | tested | finance.md FIN-R25 | modules/finance/test/scenario-s10-late-restaurant-charge.test.ts |
| PAR-FIN-048 | Cross-property posting within a chain using matching code at target property | OPERA [cross property charges][op-xprop] | P2 | missing | — | — |
| PAR-FIN-049 | Transitory charges (collected for third parties, excluded from revenue) | Apaleo [transitory charges][ap-fin] | P1 | missing | — | — |
| PAR-FIN-050 | Cancellation-fee and no-show-fee postings with own codes | Apaleo [cancellation-fee / no-show-fee][ap-fin] · OPERA [no-show posting rules][op-noshow-rules] | P0 | built | finance.md FIN-R08 (`penalty:{kind}`); reservations.md RES-R29 | — (penalty keys implemented; no dedicated test) |
| PAR-FIN-051 | Post a full stay's charges up-front (e.g., prepaid stays) | Apaleo [post-charges][ap-fin] · OPERA [advance folio payment][op-adv-folio-pay] | P1 | missing | — | — |
| PAR-FIN-052 | Charges from POS with check image/line detail viewable from the folio | OPERA [POS check image][op-pos-check] · Mews [outlet items][mw-outletitems] | P1 | specified | resort.md RST-R01 (line items) | — |
| PAR-FIN-053 | Manual posting preview of resulting folio balance | assumption (brief §4 previews) | P1 | specified | finance.md FIN-R09 | — |
| PAR-FIN-054 | Custom charges / resort or destination fees with exemptions per reservation | OPERA [custom charges][op-custom-charges] · [custom charge exemption][op-custom-exempt] | P1 | specified | rates.md RAT-R22 (fees as tax & fee rules); exemption per stay missing | — |
| PAR-FIN-055 | Transaction diversion (auto-divert certain charges, e.g. internet for loyalty tier, to a house account) | OPERA [transaction diversion][op-trx-diversion] | P2 | missing | — | — |
| PAR-FIN-056 | Membership/automatic transaction discounts on posting | OPERA [transaction discount rules][op-trx-discount] | P2 | missing | — | — |
| PAR-FIN-057 | Daily covers adjustment (F&B covers statistics per outlet) | OPERA [adjusting daily covers][op-covers] | P2 | missing | — | — |

### Corrections, splits and transfers

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-060 | Adjust a posting (partial/full) with configurable reason codes | OPERA [adjustment reason codes][op-adj-codes] · [adjustments][op-postings] | P0 | tested | finance.md FIN-R10 | modules/finance/test/security-and-corrections.test.ts |
| PAR-FIN-061 | Threshold-based approval for adjustments above policy amount | assumption (common control; identity IDN-R15) | P1 | specified | finance.md FIN-R10 — threshold approvals not built on branch (identity approvals pending) | — |
| PAR-FIN-062 | Same-day correction flagged so daily revenue nets transparently | OPERA [corrections report][op-rpt-fin] | P0 | built | finance.md FIN-R10 | — (same-day flag implemented; covered indirectly by corrections tests) |
| PAR-FIN-063 | Delete same-day transactions | OPERA [deleting same day transactions][op-postings] | P2 | different | finance.md FIN-R03 — never delete; same-day correction flag instead | — |
| PAR-FIN-064 | Split a charge by amount, percentage or quantity, taxes recalculated on both parts | OPERA [splitting charges][op-postings] · Apaleo [split charge][ap-fin] | P0 | built | finance.md FIN-R11 (partial transfer with taxes); in-place split by amount/%/qty not specified | modules/finance/src/domain/domain.test.ts (splitComponents exact sums) |
| PAR-FIN-065 | Split a payment by amount or percentage | OPERA [splitting payments][op-postings] · Apaleo [split payment][ap-fin] | P1 | missing | — | — |
| PAR-FIN-066 | Transfer selected postings or an amount between folios with before/after preview | OPERA [transferring postings][op-postings] · Apaleo [move-charges, bulk-move][ap-fin] | P0 | tested | finance.md FIN-R11 | modules/finance/test/security-and-corrections.test.ts (transfers) |
| PAR-FIN-067 | Move all charges from one folio to another in one action | Apaleo [move-all-charges][ap-fin] | P1 | built | finance.md FIN-R11 (select all) | — (transfer accepts any posting set) |
| PAR-FIN-068 | Move payments between folios | Apaleo [move-payments][ap-fin] | P1 | missing | — | — |
| PAR-FIN-069 | Transfer a folio balance to another guest's folio (e.g., parent pays child's room) | OPERA [userlog transfers report][op-rpt-fin] | P0 | tested | finance.md FIN-R11, FIN-R26 | modules/finance/test/security-and-corrections.test.ts (transfers) |
| PAR-FIN-070 | Correct a closed folio by moving charges to a new folio (creates correction record) | Apaleo [folio correct][ap-fin] · Mews [correct a closed bill][mw-correct-bill] | P0 | tested | finance.md FIN-R25, FIN-R34 | modules/finance/test/fiscal.test.ts (credit-note cancel re-opens postings) |
| PAR-FIN-071 | Service recovery adjustment codes (goodwill credits tracked separately) | OPERA [service recovery adjustment][op-postings] | P1 | missing | — | — |
| PAR-FIN-072 | Allowance/rebate posted against a specific charge or the whole folio | Apaleo [allowances][ap-fin] · Mews [rebates][mw-correct-bill] | P0 | tested | finance.md FIN-R10 (adjustment), FIN-R19 | modules/finance/test/scenario-s19-package-allowance-taxes.test.ts |
| PAR-FIN-073 | Reverse a direct-bill settlement back to the guest folio | OPERA [reversing direct bill settlement][op-postings] | P1 | missing | — | — |
| PAR-FIN-074 | Transfer card payments with surcharges (surcharge follows payment) | OPERA [card payments with surcharges][op-postings] | P2 | missing | — | — |
| PAR-FIN-075 | Edit non-financial details of a posting (reference, supplement) with audit | OPERA [editing charge details][op-postings] | P1 | missing | — | — |

### Charge codes, taxes on postings, rounding

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-080 | Charge code hierarchy (code → subgroup → group) with revenue/payment/wrapper types | OPERA [transaction codes][op-trx-codes] | P0 | built | finance.md FIN-R12 (group); subgroup level missing | modules/finance/src/domain/domain.test.ts (maps groups to accounts); subgroup level not built |
| PAR-FIN-081 | Charge code restricted posting (permission per code; manual post allowed flag) | OPERA [transaction code protection][op-trx-protect] | P0 | built | finance.md FIN-R12, §8 `restrictedCodes` | — (restricted-code permission implemented; general permission test in security-and-corrections) |
| PAR-FIN-082 | Accounting categories that POS/integrations map to | Mews [accounting categories][mw-acct-cat] | P0 | specified | finance.md FIN-R12; integration.md INT-R10 (`chargeCode` mapping) | — |
| PAR-FIN-083 | Revenue buckets / reporting groups independent of ledger accounts | OPERA [revenue buckets][op-rev-buckets] | P1 | missing | — | — |
| PAR-FIN-084 | Routing codes (named bundles of charge codes) used in billing rules | OPERA [routing codes][op-routing-codes] | P1 | specified | finance.md FIN-R13 (selector by groups) | — |
| PAR-FIN-085 | Cash rounding factor for currencies without small coins (rounding difference posted to rounding code) | OPERA [rounding factors][op-rounding] | P1 | missing | — | — |
| PAR-FIN-086 | Tax types / exemptions per guest or company (tax-exempt folio with certificate) | OPERA [tax types][op-tax-types] · [lodging tax exempt report][op-rpt-fin] | P1 | missing | — | — |
| PAR-FIN-087 | Taxes recalculated when a split charge moves to a folio of a payer with different tax type | OPERA [split with tax type by profile][op-postings] | P2 | missing | — | — |
| PAR-FIN-088 | Collecting-agent / withholding taxes on postings (country packs) | OPERA [collecting agent taxes][op-collect-tax] | P2 | missing | — | — |
| PAR-FIN-089 | Tax on currency-exchange service | OPERA [exchange service taxes][op-exch-tax] | P2 | missing | — | — |
| PAR-FIN-090 | Charge code templates copied across properties of a chain | OPERA [copy transaction codes to template][op-trx-codes] | P1 | missing | — | — |

### Billing rules — who pays for what

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-100 | Route charges by charge code/group to another folio of the same stay | OPERA [routing instructions][op-routing] · Apaleo [routings][ap-fin] | P0 | tested | finance.md FIN-R13 | modules/finance/src/domain/routing.test.ts; test/scenario-s04-company-pays-accommodation.test.ts |
| PAR-FIN-101 | Route charges to another stay's folio (room routing: parent pays child's room) | OPERA [room routing][op-routing] | P0 | built | finance.md FIN-R13 (destination folio any owner) | — (destination folio of any owner; S04 covers company folio) |
| PAR-FIN-102 | Routing by date range and days of week | OPERA [routing instructions][op-routing] | P1 | tested | finance.md FIN-R13 | modules/finance/src/domain/routing.test.ts (dates, weekday) |
| PAR-FIN-103 | Routing limits: cap per night, per stay or percentage; overflow to default folio | OPERA [routing limits][op-routing-limits] | P0 | tested | finance.md FIN-R13 | modules/finance/src/domain/routing.test.ts (limits); test/security-and-corrections.test.ts (cap concurrency) |
| PAR-FIN-104 | Split each matching charge by percentage across payers | Agilysys [split by percentage][ag-split] | P1 | tested | finance.md FIN-R13 (percent cap) | modules/finance/src/domain/routing.test.ts (percentage limits) |
| PAR-FIN-105 | Default routing from company, agent, source profile and rate plan, applied on booking | OPERA [rate code default routing][op-rate-routing] · Agilysys [routing templates][ag-split] | P1 | specified | finance.md FIN-R17 | — |
| PAR-FIN-106 | Ranked precedence when several rules match | Agilysys [ranked routing rules][ag-routing] | P1 | deferred | finance.md FIN-R14 — no ranking until Q40; branch resolves strictly nested rules by specificity (README), see gaps-finance.md | — |
| PAR-FIN-107 | Overlapping rules rejected with the colliding rule named and suggested fixes | assumption (Portico design, Q40 default) | P0 | tested | finance.md FIN-R14, FIN-I13 (branch allows strictly nested rules — spec change request) | modules/finance/src/domain/routing.test.ts; test/scenario-s04-company-pays-accommodation.test.ts |
| PAR-FIN-108 | Apply rules to existing postings (retroactive re-routing) with preview | OPERA ["apply to existing postings"][op-routing] | P0 | specified | finance.md FIN-R16 — not built on branch (manual transfers only) | — |
| PAR-FIN-109 | "Who pays for what" projected preview per folio before saving | assumption (research 01 §3.6) | P0 | tested | finance.md FIN-R15 | modules/finance/test/scenario-s04-company-pays-accommodation.test.ts (preview equals posting) |
| PAR-FIN-110 | Comp routing to comp folios with required authorizer (and request variant) | OPERA [comp routing][op-comp] | P1 | missing | — | — |
| PAR-FIN-111 | Group billing defaults applied to every picked-up stay | OPERA [posting master][op-posting-master] | P1 | specified | groups.md GRP-R09; finance.md FIN-R17 | — |
| PAR-FIN-112 | Billing instructions viewable/editable on mobile | OPERA [PWA billing instructions][op-pwa-billing] | P2 | missing | — | — |
| PAR-FIN-113 | Payment method per folio (each payer's card / direct bill / cash) | OPERA [payment instructions][op-pay-instr] | P0 | specified | finance.md FIN-R05; payments.md PAY-R05 | — |

### Packages and allowances (finance side)

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-120 | Package revenue allocation to component charge codes at night posting | OPERA [package codes][op-pkg-codes] · [post room and tax][op-prt] | P0 | tested | finance.md FIN-R18 | modules/finance/test/scenario-s19-package-allowance-taxes.test.ts |
| PAR-FIN-121 | Allowance ledger (allowance clearing, not revenue) with balance per stay/period | OPERA [package ledger][op-rpt-fin] · [package allowances][op-pkg-allow] | P0 | tested | finance.md FIN-R18 | modules/finance/test/scenario-s19-package-allowance-taxes.test.ts |
| PAR-FIN-122 | Outlet consumption applied against allowance automatically; overuse charged | OPERA [package allowances][op-pkg-allow] · Apaleo [allowances][ap-fin] | P0 | tested | finance.md FIN-R19 | modules/finance/test/scenario-s19-package-allowance-taxes.test.ts |
| PAR-FIN-123 | Breakage / package profit-loss posted at period end | OPERA [package profit/loss][op-prt] | P0 | tested | finance.md FIN-R20 | modules/finance/test/scenario-s19-package-allowance-taxes.test.ts; src/domain/domain.test.ts |
| PAR-FIN-124 | Package ledger balance and detail reports; effective package allowance report | OPERA [package ledger reports][op-rpt-fin] | P1 | specified | finance.md FIN-R42 (allowance/breakage report) | — |
| PAR-FIN-125 | Guest-visible allowance balance (portal/app) | Agilysys [entitlements][ag-split] | P2 | deferred | finance.md FIN-R21 (guest portal LATER) | — |
| PAR-FIN-126 | Package consumption recorded from mobile at the outlet | OPERA [PWA package consumption][op-pwa-pkg] | P1 | specified | resort.md RST-R02, RST-R03 | — |

### Deposits and prepayments

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-130 | Deposit received is a liability per booking (deposit ledger), not revenue | Apaleo [liabilities #3000][ap-acct] · Mews [deposit ledger][mw-deposit-ledger] | P0 | tested | finance.md FIN-R22 | modules/finance/test/deposits.test.ts |
| PAR-FIN-131 | Deposit request schedule per reservation (amount, due date) from deposit policy | OPERA [deposit and cancellation][op-dep-policy] | P0 | specified | rates.md RAT-R20; payments.md PAY-R20 | — |
| PAR-FIN-132 | Post deposit payment with deposit receipt | OPERA [deposit payments][op-deposits] · [advanced deposit handling][op-adv-deposit] | P0 | tested | finance.md FIN-R22, FIN-R32 (receipts) | modules/finance/test/payments-ledger-port.test.ts |
| PAR-FIN-133 | Deposit (prepayment) invoice and tax on prepayment where law requires | Apaleo [deposit invoice, VAT on prepayments][ap-fin-beta] · OPERA [tax on deposit receipt][op-adv-deposit] | P1 | tested | finance.md FIN-R22 (branch: TGST declared at receipt per Maldives time of supply) | modules/finance/test/deposits.test.ts |
| PAR-FIN-134 | Classify an existing payment as a deposit | Apaleo [classify-as-deposit][ap-fin-beta] | P2 | missing | — | — |
| PAR-FIN-135 | Deposit transferred to the folio at check-in (deposit transfer report) | OPERA [deposit transferred at check-in][op-rpt-eod] | P0 | tested | finance.md FIN-R23 | modules/finance/test/deposits.test.ts; test/reservations-port.test.ts |
| PAR-FIN-136 | Multi-stay booking deposit allocation by stay share or staff choice | assumption | P1 | specified | finance.md FIN-R23 | — |
| PAR-FIN-137 | Deposit outcome on cancellation: forfeit to revenue, refund, or keep as credit | OPERA [no-show and cancellation deposits][op-noshow-charges] | P0 | tested | finance.md FIN-R24 | modules/finance/test/deposits.test.ts (refund vs forfeiture) |
| PAR-FIN-138 | Refund a card deposit | OPERA [refund credit card deposit][op-dep-refund] | P0 | tested | payments.md PAY-R17; finance.md FIN-R24 | modules/finance/test/payments-ledger-port.test.ts (refunds held and applied deposits) |
| PAR-FIN-139 | Batch deposit processing (charge due card deposits on due date) | OPERA [batch deposits][op-batch-deposits] · [EOD batch deposit][op-eod-procs] | P1 | specified | payments.md PAY-R22 | — |
| PAR-FIN-140 | Block/group deposits and cancellations | OPERA [block deposits][op-block-deposits] | P1 | specified | groups.md (deposit via payments); finance.md FIN-R22 (booking/group owner) | — |
| PAR-FIN-141 | Day Close check: arrivals with deposit balance must be resolved | OPERA [arrivals with deposit balance check][op-eod] | P1 | missing | — | — |
| PAR-FIN-142 | Reverse an advance bill created for deposits | OPERA [reversing advance bill][op-adv-bill-rev] | P2 | missing | — | — |
| PAR-FIN-143 | Deposit ledger report with opening/closing per day | OPERA [deposit ledger][op-rpt-fin] · Mews [deposit ledger][mw-deposit-ledger] | P0 | built | finance.md FIN-R42 | — (deposits control in integrity report; ledger list partial) |
| PAR-FIN-144 | Prepayment notice (request for prepayment document) | Apaleo [prepayment-notices][ap-fin-beta] | P2 | missing | — | — |

### Settlement and checkout

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-150 | Settle each folio by payment, transfer to receivables, transfer to another folio, write-off or leave open with permission | OPERA [settling balances][op-postings] | P0 | built | finance.md FIN-R26 — write-off not built on branch | modules/finance/test/scenario-s04-company-pays-accommodation.test.ts |
| PAR-FIN-151 | Interim bill: settle and print a folio mid-stay without checking out | OPERA [interim folios][op-billing] | P0 | missing | — | — |
| PAR-FIN-152 | Express / quick checkout with card on file and emailed folio | OPERA [quick check-out][op-quick-co] | P0 | specified | reservations.md RES-R27 (settle step); express flow missing | — |
| PAR-FIN-153 | Scheduled checkout (time set in advance, auto-settle) | OPERA [scheduling checkout][op-sched-co] | P2 | missing | — | — |
| PAR-FIN-154 | Checkout with open folio to accept late charges | OPERA [open folio status][op-open-folio] | P0 | tested | finance.md FIN-R25; reservations.md RES-R27 | modules/finance/test/scenario-s10-late-restaurant-charge.test.ts |
| PAR-FIN-155 | Reinstate a checked-out stay (same business date) | OPERA [reinstating checked out][op-reinstate-co] | P1 | specified | reservations.md RES-R10 | — |
| PAR-FIN-156 | Automatic folio settlement rules (by payment type, frequency, during Day Close) | OPERA [auto folio settlement][op-auto-settle] · [settlement types][op-auto-settle-types] | P1 | missing | — | — |
| PAR-FIN-157 | Credit limit per card type: when a folio reaches the limit, auto-charge the balance; failed charge blocks further posting | OPERA [credit limit overage][op-cl-overage] | P1 | missing | — | — |
| PAR-FIN-158 | Batch folios: generate/email folios for many stays (e.g., all departures) | OPERA [batch folios][op-batch-folio] | P1 | missing | — | — |
| PAR-FIN-159 | Email folio/invoice to guest; folio delivery to SFTP / eFolio export | OPERA [upload folios to SFTP][op-sftp] · [eFolio exports][op-efolio] | P1 | missing | — | — |
| PAR-FIN-160 | Receipt history search and reprint | OPERA [receipt history][op-receipts] | P1 | specified | finance.md FIN-R32 (receipts as fiscal documents) | — |
| PAR-FIN-161 | Checkout preview: what each payer will be charged and which documents will be issued | assumption (brief §4 previews) | P1 | missing | — | — |
| PAR-FIN-162 | Guest self-checkout with digital folio review and payment | OPERA [advance folio payment][op-adv-folio-pay] · Mews [payment requests][mw-payreq-api] | P1 | deferred | guest-experience module (domain map, wave 3) | — |
| PAR-FIN-163 | Prepayment at check-in for stays paid by cash/no card (advance folio payment, nights paid gate keys) | OPERA [advance folio payment][op-adv-folio-pay] | P1 | missing | — | — |

### Receivables (city ledger)

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-170 | Receivables account per company/agency per legal entity with terms, currency, contacts, status | OPERA [AR accounts][op-ar-acct] | P0 | tested | finance.md FIN-R27 | modules/finance/test/receivables-cashier-fx.test.ts |
| PAR-FIN-171 | Account types with aging/reminder cycles and finance-charge setup | OPERA [AR account types][op-ar-types] | P1 | missing | — | — |
| PAR-FIN-172 | Restricted/flagged accounts with reasons; override permission | OPERA [restricted reasons][op-ar-restricted] | P1 | specified | finance.md FIN-R27 (`on_hold`); reason list missing | — |
| PAR-FIN-173 | Direct-bill transfer from folio creates a receivables invoice with due date | OPERA [direct bill][op-dbt] · Apaleo [AR transfer #9999][ap-acct] | P0 | tested | finance.md FIN-R27 | modules/finance/test/scenario-s04-company-pays-accommodation.test.ts (auto invoice) |
| PAR-FIN-174 | Review queue for direct-bill invoices before they move to receivables (accruals shown on trial balance) | OPERA [direct bill transfer][op-dbt] | P1 | missing | — | — |
| PAR-FIN-175 | Credit limit check at transfer with approval above limit | OPERA [restricted accounts][op-ar] | P0 | tested | finance.md FIN-R29 | modules/finance/test/receivables-cashier-fx.test.ts (block with override, warn) |
| PAR-FIN-176 | Payments allocated to selected or oldest invoices, full or partial | OPERA [AR payments][op-ar-pay] | P0 | tested | finance.md FIN-R28 | modules/finance/test/receivables-cashier-fx.test.ts |
| PAR-FIN-177 | Unallocated payments held as account credit and applied later | OPERA [unallocated payments][op-ar-pay] | P0 | built | finance.md FIN-R28 | — (allocation service; no dedicated unallocated-credit test) |
| PAR-FIN-178 | Unapply, edit, reverse and transfer AR payments with history | OPERA [unapply / reverse / transfer payments][op-ar-pay] | P0 | missing | — | — |
| PAR-FIN-179 | Aging buckets with configurable aging date basis (transfer, finalize, checkout, invoice date) | OPERA [AR aging][op-ar-aging] · Infor [AR aging details][inf-aging] | P0 | tested | finance.md FIN-R28 (due-date buckets); basis option missing | modules/finance/test/receivables-cashier-fx.test.ts; src/domain/domain.test.ts (aging) |
| PAR-FIN-180 | Statement of account on demand and in batch, with statement numbering | OPERA [statements][op-ar-stmt] · [batch statements][op-ar-batchstmt] | P0 | specified | finance.md FIN-R28 (on demand); batch + numbering missing | — |
| PAR-FIN-181 | Reminder letters by cycle (minimum days between reminders), batch reminders, history | OPERA [reminders][op-ar-remind] · [batch reminders][op-ar-batchremind] | P1 | specified | finance.md FIN-R29 (`finance.creditControl` dunning) | — |
| PAR-FIN-182 | Late-payment finance charges on overdue balances | OPERA [finance charges][op-ar] | P2 | missing | — | — |
| PAR-FIN-183 | Recurring fixed charges on receivables accounts (e.g., monthly fee) | OPERA [AR fixed charges][op-ar-fixed] | P2 | missing | — | — |
| PAR-FIN-184 | Post additional or adjustment charges to an AR invoice; transfer charges between AR invoices | OPERA [AR invoice details][op-ar-inv] | P1 | missing | — | — |
| PAR-FIN-185 | Finalize invoices to lock them; un-finalize with permission | OPERA [finalize invoices][op-ar-invoices] | P1 | different | finance.md FIN-R32–R34 — issued documents are always final; corrections by credit note | — |
| PAR-FIN-186 | Compress several invoices into one consolidated invoice (and decompress) | OPERA [compress invoices][op-ar-invoices] | P1 | missing | — | — |
| PAR-FIN-187 | Transfer an AR invoice to another receivables account | OPERA [transfer AR invoices][op-ar-invoices] | P1 | missing | — | — |
| PAR-FIN-188 | Batch AR charges across many accounts | OPERA [AR batch charges][op-ar-batch] | P2 | missing | — | — |
| PAR-FIN-189 | AR notes and traces (actionable follow-ups with due dates) | OPERA [AR notes][op-ar-notes] · [AR traces][op-ar-traces] | P1 | missing | — | — |
| PAR-FIN-190 | AR year view, future/past stays of the account, changes log | OPERA [year view][op-ar-yearview] · [stays][op-ar-stays] · [changes log][op-ar-log] | P1 | missing | — | — |
| PAR-FIN-191 | AR transaction research (find any AR posting by criteria) | OPERA [transaction research][op-ar-research] | P1 | specified | finance.md §9 receivables (account page); search missing | — |
| PAR-FIN-192 | Card receivables: consolidate card payments by card type into AR for remittance matching | OPERA [AR credit card transfer][op-ar-cc] | P1 | missing | — | — |
| PAR-FIN-193 | Write-off with approval and bad-debt mapping | Apaleo [invoice write-off][ap-fin-beta] | P0 | specified | finance.md FIN-R30 — not built on branch | — |
| PAR-FIN-194 | Mark invoice paid when settled outside the system | Apaleo [invoice pay][ap-fin] | P1 | specified | finance.md FIN-R28 (bank transfer allocation) | — |
| PAR-FIN-195 | AR distributed to several properties of a chain (one account, many properties) | OPERA [AR distributed to properties][op-ar] | P1 | missing | — | — |
| PAR-FIN-196 | Comp AR accounts for authorised complimentary charges | OPERA [comp AR accounts][op-comp-ar] | P2 | missing | — | — |
| PAR-FIN-197 | City ledger aging and ledger activity reports | Mews [city ledger][mw-city-ledger] · OPERA [AR reports][op-rpt-ar] | P0 | built | finance.md FIN-R42 | — (city ledger control in integrity report) |
| PAR-FIN-198 | Customer self-service statement and invoice download / pay online (payer portal) | assumption (research 01 §7 "payer portal") | P2 | missing | — | — |
| PAR-FIN-199 | Credit notes as negative invoices inside AR | OPERA [negative invoices][op-ar] | P0 | tested | finance.md FIN-R34 | modules/finance/test/fiscal.test.ts |

### Fiscal documents (invoices, credit notes, receipts)

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-200 | Invoice issued from a folio; numbering series per legal entity (and property), gapless | Mews [bill counters][mw-bills] · Apaleo [invoices][ap-fin] | P0 | tested | finance.md FIN-R32 | modules/finance/test/fiscal.test.ts (24 concurrent issues) |
| PAR-FIN-201 | Immutable invoice snapshot reproducible as PDF | Apaleo [invoice PDF][ap-fin] | P0 | tested | finance.md FIN-R33 | modules/finance/test/fiscal.test.ts (reproducible PDF) |
| PAR-FIN-202 | Credit note (full/partial) referencing the invoice; cancel invoice creates credit | Apaleo [cancel invoice][ap-fin] · Mews [reissue invoice][mw-reissue] | P0 | tested | finance.md FIN-R34 | modules/finance/test/fiscal.test.ts |
| PAR-FIN-203 | Reissue an invoice with corrected payer details (credit + new invoice in one action) | Mews [reissue invoice][mw-reissue] | P0 | tested | — not in spec; branch credit-note `cancel` re-opens postings for a corrected invoice | modules/finance/test/fiscal.test.ts |
| PAR-FIN-204 | Credit bill against a folio within N days of generation; same-day credit bill policy | OPERA [credit bills][op-credit-bill] · [credit bills from billing][op-credit-bill2] | P1 | specified | finance.md FIN-R34; time-limit policy missing | — |
| PAR-FIN-205 | Debit bill (additional charge document after a folio is generated) | OPERA [debit bills][op-debit-bill] | P1 | specified | finance.md FIN-R25 (supplementary folio) | — |
| PAR-FIN-206 | Advance invoice (invoice before service, e.g., for corporate prepayment) | Apaleo [advance invoice][ap-fin-beta] | P1 | missing | — | — |
| PAR-FIN-207 | Invoice preview before issuing (no number consumed) | Apaleo [invoice preview][ap-fin] | P0 | specified | finance.md §4.2 ("drafts are previews without numbers") | — |
| PAR-FIN-208 | Payment receipts and deposit receipts as numbered documents | OPERA [advanced deposit handling][op-adv-deposit] · [payment tax invoices][op-rpt-fin] | P0 | specified | finance.md FIN-R32 | — |
| PAR-FIN-209 | Folio types per country (goods/services, tax type, credit/debit/deposit folio types) | OPERA [folio types][op-folio-types] | P1 | missing | — | — |
| PAR-FIN-210 | Custom reference numbers (check-digit formulas, structured payment references) on folios/receipts | OPERA [custom numbers][op-custom-numbers] | P2 | missing | — | — |
| PAR-FIN-211 | Amount in words on invoices (per language) | OPERA [numbers to words][op-words] | P2 | missing | — | — |
| PAR-FIN-212 | Configurable document templates with logo, QR codes, languages, copy legend | OPERA [stationery editor][op-stationery] · [QR code definitions][op-rpt-qr] · [folio copy legend][op-copy-legend] | P1 | missing | — | — |
| PAR-FIN-213 | Second-currency display on invoices with stored rate | assumption (Maldives MVR presentation) | P1 | tested | finance.md FIN-R33 | modules/finance/test/fiscal.test.ts (USD conversion vs MMA rate) |
| PAR-FIN-214 | Live issuance blocked while tax rule pack unverified or fiscal adapter missing | assumption (readiness brief) | P0 | tested | finance.md FIN-R35 | modules/finance/test/fiscal.test.ts |
| PAR-FIN-215 | Fiscal partner framework (submission, retries, failed-payload resend, status monitor) | OPERA [fiscal partners][op-fiscal-partners] · [OFIS][op-ofis] · [failed payloads][op-fiscal-failed] · [fiscal status][op-fiscal-status] | P1 | deferred | finance.md FIN-R36 [LATER] via integration | — |
| PAR-FIN-216 | Invoice pending/failed/committed states for asynchronous fiscal clearance | Apaleo [invoice commit/fail][ap-fin-beta] | P1 | deferred | finance.md FIN-R36 [LATER] | — |
| PAR-FIN-217 | Year-end reset of bill numbers where a country requires annual series | OPERA [year end procedure][op-eod-procs] | P2 | missing | — | — |
| PAR-FIN-218 | Company invoices VAT report (company, VAT breakdown) | Apaleo [company-invoices-vat][ap-reports] | P1 | specified | finance.md FIN-R42 (tax report) | — |
| PAR-FIN-219 | B2B structured e-invoices (country formats) | assumption (research 04 §C3) | P2 | deferred | finance.md FIN-R36 [LATER] | — |
| PAR-FIN-220 | Hash-chained fiscal ledger per legal entity (tamper and gap detection) | OPERA [fiscal partners][op-fiscal-partners] · assumption (research 04 §C3 primitives) | P1 | tested | — not in spec; branch fiscal chain (finance README) | modules/finance/test/fiscal.test.ts; src/domain/domain.test.ts |
| PAR-FIN-221 | Mandatory tax-invoice particulars enforced in live (supplier TIN, buyer TIN for business buyers, levy shown separately) | assumption (Maldives tax-invoice rules, unverified Q41) | P0 | tested | finance.md FIN-R33, FIN-R35 | modules/finance/test/fiscal.test.ts |
| PAR-FIN-222 | Invoice-issue deadline check (e.g., within 3 days) as a Day Close exception | assumption (Maldives rule, unverified Q41) | P1 | built | — not in spec; branch `invoice_overdue_for_issue` | — |
| PAR-FIN-223 | Converted (USD) reporting amount on non-USD invoices validated against the central-bank reference rate within tolerance | assumption (Maldives MMA reference, unverified) | P1 | tested | — not in spec; branch ±2% check | modules/finance/test/fiscal.test.ts |
| PAR-FIN-224 | Record retention dates and legal holds on fiscal records | assumption (Q44) | P1 | tested | — not in spec; branch `retain_until` + legal holds | modules/finance/test/security-and-corrections.test.ts |

### Cashiering

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-230 | Cashier login with PIN for cashiering functions | OPERA [cashier login][op-cashier-login] | P1 | missing | — | — |
| PAR-FIN-231 | Cashier session per user with opening float per currency | OPERA [cashier configuration][op-cashiers-cfg] | P0 | tested | finance.md FIN-R37 | modules/finance/test/receivables-cashier-fx.test.ts |
| PAR-FIN-232 | Every cash payment, refund, paid-out and exchange attributed to the session | OPERA [cashier closure][op-cashier-close] · Mews [cashier transactions][mw-cashier-api] | P0 | tested | finance.md FIN-R37 | modules/finance/test/receivables-cashier-fx.test.ts (cash requires open session) |
| PAR-FIN-233 | Blind close count per currency; variance posted to over/short | OPERA [blind shift drop][op-cashier-close] | P0 | tested | finance.md FIN-R37 | modules/finance/test/receivables-cashier-fx.test.ts; src/domain/domain.test.ts (variance per currency) |
| PAR-FIN-234 | Shift drop with bag numbers and drop locations; cashier shift bag report | OPERA [shift drop locations][op-shift-drop] · [shift bag report][op-rpt-fin] | P1 | missing | — | — |
| PAR-FIN-235 | Float carry-over and negative banking between sessions | OPERA [float over/short][op-cashier-close] | P1 | missing | — | — |
| PAR-FIN-236 | Card totals listed per session for reconciliation against terminal batches | OPERA [cashier closure][op-cashier-close] | P0 | tested | finance.md FIN-R37 | modules/finance/test/scenario-s19-package-allowance-taxes.test.ts (per-method summary) |
| PAR-FIN-237 | Maximum opens per business day per cashier; reopen after close | OPERA [open cashiers][op-open-cashiers] | P2 | different | finance.md §4.2 — closed session is terminal; a new session is opened instead | — |
| PAR-FIN-238 | View open cashiers; supervisor closes sessions without transactions | OPERA [open cashiers][op-open-cashiers] | P1 | specified | finance.md FIN-R39, FIN-R44 | — |
| PAR-FIN-239 | Auto-close open cashiers at Day Close (or require close first) | OPERA [EOD cashier closure][op-eod] | P1 | specified | finance.md FIN-R39 (policy) | — |
| PAR-FIN-240 | Paid-outs (cash advances, petty payments for guests) with permission | OPERA [paid outs report][op-rpt-fin] | P0 | tested | finance.md FIN-R38 | modules/finance/test/receivables-cashier-fx.test.ts (paid-outs) |
| PAR-FIN-241 | Currency exchange at the desk (buy foreign cash at sell rate) with exchange receipt | OPERA [currency exchange][op-fx] · [currency exchange summary][op-rpt-fin] | P0 | specified | finance.md FIN-R37, FIN-R40 (spread) | — |
| PAR-FIN-242 | Foreign currency limits per transaction | OPERA [foreign currency limits][op-fcy-limits] | P2 | missing | — | — |
| PAR-FIN-243 | Cashier reports (cashier audit, journal by cashier and code, by foreign currency) | OPERA [cashier reports][op-cashier-reports] · [financial reports][op-rpt-fin] | P0 | specified | finance.md FIN-R42 (cashier report) | — |
| PAR-FIN-244 | Cash drawer deposits and withdrawals tracking for the open drawer | Mews [cash deposits and withdrawals][mw-cash-track] · [cash drawer report][mw-cash-drawer] | P1 | missing | — | — |
| PAR-FIN-245 | Cashier sessions spanning several properties (hub cashier) | OPERA [multi-property closure][op-cashier-close] | P2 | missing | — | — |
| PAR-FIN-246 | Bank deposit / safe drop record linking cash sessions to the bank deposit slip | Infor [cashier banking report][inf-cashier-bank] | P1 | missing | — | — |
| PAR-FIN-247 | Cheque / traveller's cheque ledger | OPERA [check ledgers report][op-rpt-fin] | P2 | n/a | Cheques are not a Maldives guest payment instrument (assumption); can be modelled as a payment method | — |

### Multi-currency

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-250 | Exchange rates per business date per currency pair with source | OPERA [exchange rates][op-fx-rates] · Mews [exchange rates][mw-fx-api] | P0 | tested | finance.md FIN-R40 | modules/finance/src/domain/domain.test.ts (latest rate on or before date) |
| PAR-FIN-251 | Buy/sell spread for cash exchange | OPERA [currency exchange][op-fx] | P1 | specified | finance.md FIN-R40 | — |
| PAR-FIN-252 | Rate feed from a provider | assumption | P2 | specified | finance.md FIN-R40 [SHOULD] | — |
| PAR-FIN-253 | Pay a USD folio with MVR cash (converted at stored rate, rate on receipt) | OPERA [currency exchange][op-fx] | P0 | tested | finance.md FIN-R41, §11 | modules/finance/test/scenario-s19-package-allowance-taxes.test.ts (MVR cash on USD folio) |
| PAR-FIN-254 | Folio in a currency other than the property base | assumption | P1 | tested | finance.md FIN-R41 | modules/finance/test/receivables-cashier-fx.test.ts |
| PAR-FIN-255 | Settlement FX differences to gains/losses at reconciliation | assumption (accounting practice) | P0 | tested | finance.md FIN-R41 | modules/finance/test/receivables-cashier-fx.test.ts (realized FX on settlement) |
| PAR-FIN-256 | Currency calculator for staff | OPERA [currency calculator][op-cashier-login] | P2 | missing | — | — |
| PAR-FIN-257 | Global (chain-level) exchange rates for membership/loyalty conversions | OPERA [global exchange rates][op-global-fx] | P2 | missing | — | — |
| PAR-FIN-258 | Quote/view receivables in foreign currency | OPERA [reminders in currency][op-ar-remind] | P1 | specified | finance.md FIN-R27 (account currency) | — |

### Commissions

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-260 | Commission codes (percent of revenue or flat) on agent/source profiles, overridable by rate plan | OPERA [commission codes][op-comm-codes] · [commissions][op-comm] | P1 | specified | finance.md FIN-R31 (from agreed terms) | — |
| PAR-FIN-261 | Commission accrual at checkout to commissions payable | OPERA [EOD commissions procedure][op-eod-procs] | P1 | specified | finance.md FIN-R31 | — |
| PAR-FIN-262 | Commission on cancellations/no-shows optional; zero-commission records optional | OPERA [commissions][op-comm] · [zero commissions to history][op-comm-zero] | P2 | missing | — | — |
| PAR-FIN-263 | Prepaid commission (agent deducted commission from a net deposit) | OPERA [prepaid commission][op-comm] · [prepayment report][op-rpt-comm] | P1 | missing | — | — |
| PAR-FIN-264 | Commission "paid in AR" offset against agency invoices | OPERA [paid in AR][op-comm] | P0 | specified | finance.md FIN-R31 — commissions not built on branch | — |
| PAR-FIN-265 | Net-rate bookings invoice the agency the net amount | assumption (Maldives DMC practice) | P0 | specified | finance.md FIN-R31, §11 | — |
| PAR-FIN-266 | Commission holds per agent or per stay with reasons | OPERA [payment holds][op-comm-hold] · [stop reasons][op-comm-stop] | P1 | missing | — | — |
| PAR-FIN-267 | Commission payment runs by departure date range; check printing or EFT export file | OPERA [processing commission payments][op-comm-pay] · [EFT formats][op-comm-eft] | P1 | missing | — | — |
| PAR-FIN-268 | Commission payment activity: outstanding, cleared, void, reprint | OPERA [payment activity][op-comm-activity] | P1 | missing | — | — |
| PAR-FIN-269 | Attach/detach agent or source to a stay after booking (commission correction) | OPERA [attach/detach agents][op-comm-detach] | P1 | missing | — | — |
| PAR-FIN-270 | Research a stay's commission details; adjust commission with reason | OPERA [commission research][op-comm-research] | P1 | missing | — | — |
| PAR-FIN-271 | OTA commission invoices matched to stays (channel cost reconciliation) | assumption (common hotel back-office task) | P1 | missing | — | — |
| PAR-FIN-272 | Commission bank accounts and currency per payment method | OPERA [commission bank accounts][op-comm-bank] | P2 | missing | — | — |

### Stored value, vouchers, loyalty and comps

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-280 | Gift card / prepaid card: issue, reload, balance, transfer, cash out; liability until redeemed | OPERA [prepaid cards][op-giftcard] · Simphony [gift cards][sim-gift] | P1 | missing | — | — |
| PAR-FIN-281 | Redeem gift card or voucher as payment on a folio | OPERA [redeem prepaid cards][op-postings] · [reservation prepaid cards][op-res-giftcard] | P1 | missing | — | — |
| PAR-FIN-282 | Vouchers generated from postings (e.g., breakfast vouchers) and voucher rules | OPERA [voucher rules][op-voucher-rules] · [batch vouchers][op-vouchers] | P2 | missing | — | — |
| PAR-FIN-283 | Pay with loyalty points (award redemption as payment) | OPERA [pay with points][op-pay-points] | P2 | missing | — | — |
| PAR-FIN-284 | Casino comp accounting (comp windows, player snapshot, comp posting journal) | OPERA [comp accounting][op-comp] | P2 | n/a | Gaming out of scope for launch (competitive-synthesis §1 Infor) | — |
| PAR-FIN-285 | Complimentary stays posted at zero or to a comp house account with authorizer | OPERA [comp routing][op-comp] | P0 | specified | reservations.md RES-R05; finance.md FIN-R05 (house) | — |

### Reports

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-290 | Guest ledger report (in-house balances) and guest balance snapshot | OPERA [guest ledger][op-rpt-fin] | P0 | built | finance.md FIN-R42 | — (guest ledger control; list view partial) |
| PAR-FIN-291 | Open balances report incl. deposits and group folios | OPERA [open balances][op-rpt-fin] | P0 | specified | finance.md FIN-R42 (folio balance list) | — |
| PAR-FIN-292 | Daily revenue by charge code/department (financial payment and revenue) | OPERA [findeptcodes][op-rpt-fin] · Apaleo [revenues report][ap-reports] | P0 | tested | finance.md FIN-R42 | modules/finance/test/scenario-s19-package-allowance-taxes.test.ts (daily revenue by charge code) |
| PAR-FIN-293 | Financial transactions journal by code, by folio, by tax type, with generates | OPERA [financial transactions reports][op-rpt-fin] | P0 | specified | finance.md FIN-R42 (drill-down) | — |
| PAR-FIN-294 | Posting journal search (all postings, by cashier, code, room, date) | OPERA [posting journal][op-posting-journal] | P0 | missing | — | — |
| PAR-FIN-295 | Adjustments, corrections and cancelled payments report | OPERA [corrections report][op-rpt-fin] · [EOD posting adjustments][op-rpt-eod] | P0 | tested | finance.md FIN-R42 (restatement register), FIN-R43 | modules/finance/test/security-and-corrections.test.ts (restatement flag) |
| PAR-FIN-296 | Tax report by rule, rate and period; folio tax revenue | OPERA [tax report, folio tax][op-rpt-fin] | P0 | tested | finance.md FIN-R42 | modules/finance/test/scenario-s19-package-allowance-taxes.test.ts (daily tax report) |
| PAR-FIN-297 | Maldives Green Tax monthly report (checked-in, stayed, carried over from previous month) | OPERA [Maldives Green Tax report][op-rpt-fin] | P0 | tested | — not in spec; branch `GET /v1/finance/reports/green-tax` (finance README) | modules/finance/test/scenario-s19-package-allowance-taxes.test.ts |
| PAR-FIN-298 | Tax-exempt revenue report | OPERA [lodging tax exempt][op-rpt-fin] | P1 | missing | — | — |
| PAR-FIN-299 | Deposit activity report (received, applied, refunded, forfeited) | OPERA [deposit activity][op-rpt-deposit-activity] | P0 | specified | finance.md FIN-R42 (deposits ledger) | — |
| PAR-FIN-300 | Folio transfers log (userlog transfers) | OPERA [userlog transfers][op-rpt-fin] | P1 | specified | finance.md §7 `finance.postings.transferred`; report missing | — |
| PAR-FIN-301 | Credit card report (card payments by type for the day) | OPERA [credit cards report][op-rpt-fin] | P0 | specified | finance.md FIN-R37 (card totals) | — |
| PAR-FIN-302 | Invoices of today's check-outs by bill number (numbering audit) | OPERA [fininvtodaycobybill][op-rpt-fin] | P1 | missing | — | — |
| PAR-FIN-303 | Month-end details report | OPERA [month end details][op-rpt-month-end] | P1 | missing | — | — |
| PAR-FIN-304 | Every figure shows definition, period, currency treatment and source; drill-down | assumption (brief §13) | P0 | specified | finance.md FIN-R42 | — |
| PAR-FIN-305 | Ledger activity report built on immutable entries (reconciles to trial balance) | Mews [ledger activity][mw-ledger-activity] | P0 | built | finance.md FIN-R42 | — (append-only journal; activity report UI pending) |

### Controls, permissions and audit

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-310 | Fine-grained finance permissions (post, correct, transfer, restricted codes, write-off, credit override, period close) | OPERA [roles and tasks][op-roles] | P0 | tested | finance.md §8 | modules/finance/test/security-and-corrections.test.ts |
| PAR-FIN-311 | Append-only audit of every financial action with reason | Mews [ledger activity immutable][mw-ledger-activity] | P0 | built | CLAUDE.md §4 rule 9; finance.md FIN-R03 | apps/api/test/records.test.ts (record history) |
| PAR-FIN-312 | Optimistic concurrency on folios (409 with current state) | assumption (architecture rule 8) | P0 | tested | finance.md §4.1 `version` | apps/api/test/finance.test.ts (ETag / If-Match) |
| PAR-FIN-313 | Finance exceptions feed for Day Close (unbalanced, suspense, pending verification, open sessions) | OPERA [EOD checks][op-eod] · Apaleo [integrity add-on][ap-acct] | P0 | tested | finance.md FIN-R44 | modules/finance/test/scenario-s10-late-restaurant-charge.test.ts (Day Close exception) |
| PAR-FIN-314 | Income audit: keep past business dates open for revenue corrections, then finalize in order | OPERA [income audit][op-ia] | P1 | different | finance.md FIN-R04 — corrections post today with `relatesToBusinessDate`; restatement annex instead of reopened days | — |
| PAR-FIN-315 | Audit totals entry (night auditor verifies totals per charge code) | OPERA [EOD audit procedure][op-eod] | P2 | missing | — | — |
| PAR-FIN-316 | Tenant isolation and data-authority enforcement on every finance read/write | assumption (architecture rules 4, 15) | P0 | tested | finance.md §14; CLAUDE.md §4 | modules/finance/test/security-and-corrections.test.ts |
| PAR-FIN-317 | Honest failure when the tax engine is unavailable (no posting without computed tax) | assumption (truthful operations) | P0 | tested | finance.md FIN-R07 | apps/api/test/finance.test.ts (503) |

### Period close and exports

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-320 | Accounting period definitions (years, periods) per legal entity | OPERA [period definition years/periods][op-periods] | P0 | specified | finance.md §4.1 — not built on branch; GL periods now owned by accounting.md | — |
| PAR-FIN-321 | Period close locks a period; reopen with permission and reason | Agilysys [fiscal close][ag-fiscal-man] · NetSuite [period close][ns-close] | P0 | specified | finance.md FIN-R43 — not built; GL period close moved to accounting.md | — |
| PAR-FIN-322 | Separate operational day roll from accounting day close (automatic or manual) | Agilysys [auto fiscal close][ag-fiscal-auto] | P1 | specified | day-close.md §2 non-goals; finance.md FIN-R43 | — |
| PAR-FIN-323 | Restatement register for corrections after close | assumption (brief §10) | P0 | specified | finance.md FIN-R43 | — |
| PAR-FIN-324 | Back-office export (revenue, city ledger, bills, statistics, customers) with account mapping | OPERA [back office exports][op-bo-exports] · [generic XML back office][op-xml-bo] | P0 | specified | finance.md §11; integration.md (journal file export) | — |
| PAR-FIN-325 | Export mappings (Portico code → external GL code) with types | OPERA [export mapping][op-export-map] | P0 | specified | integration.md INT-R10 (`chargeCode` mapping) | — |
| PAR-FIN-326 | Scheduled exports with file delivery (SFTP, email) and results log | OPERA [scheduled exports][op-export-sched] · [file delivery][op-export-delivery] | P1 | specified | day-close.md DCL-R02 step 9; delivery targets missing | — |
| PAR-FIN-327 | Country statutory exports (SAF-T, JPK, cash register exports) | OPERA [export APIs][op-export-api] | P2 | deferred | finance.md FIN-R36 [LATER] (country packs) | — |
| PAR-FIN-328 | Gross and net transaction exports per business day via API | Apaleo [export-gross-daily][ap-fin] · Mews [accounting use case][mw-acct-uc] | P0 | missing | — | — |

### Integration touchpoints and connected mode

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-FIN-330 | POS posts charges to folios with outlet attribution, lines, tips, tax | Apaleo [POS non-reservation postings][ap-pos-nonres] · Mews [POS use case][mw-pos-uc] | P0 | specified | resort.md RST-R01 | — |
| PAR-FIN-331 | Outlet end-of-day revenue push for balancing (POS totals vs postings) | Mews [outlet bills][mw-pos-uc] | P0 | specified | resort.md RST-R01 (daily balancing) | — |
| PAR-FIN-332 | Room-charge eligibility check (in-house, posting allowed, credit status) | Simphony [OPERA guest lookup][sim-opera-lookup] | P0 | specified | resort.md RST-R01 | — |
| PAR-FIN-333 | Forward Portico-originated charges to an external PMS folio (connected mode) with pending state | assumption (adoption brief) | P0 | specified | finance.md §14 — branch refuses postings when `charges` is external (tested); forwarding not built | — |
| PAR-FIN-334 | Minibar and amenity consumption postings | OPERA [consumable inventory][op-consumable] | P1 | specified | operations.md OPS-R (minibar, SHOULD) | — |
| PAR-FIN-335 | Event (banquet) revenue posted to the group master | OPERA [posting charges for events][op-event-post] | P1 | specified | groups.md GRP-R09 | — |
| PAR-FIN-336 | Public finance API: folios, charges, payments, invoices, routings, accounts | Apaleo [finance API][ap-fin] · Mews [bills][mw-bills] | P1 | tested | finance.md §6 (contracts → OpenAPI, INT-R26) | apps/api/test/finance.test.ts |
| PAR-FIN-337 | Finance events/webhooks (posting created, folio settled, invoice issued) | Mews [webhooks][mw-acct-uc] | P1 | built | finance.md §7 | — (events emitted; consumer tests in S10) |
| PAR-FIN-338 | Opening balances import through migration suspense with reconciliation | assumption (S18) | P0 | tested | finance.md §10 S18/E12 | modules/finance/test/scenario-s18-opening-deposits.test.ts |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-FIN-001 | A bar charge commits at 00:20 while Day Close for the previous date is still running | Posting carries the business date current at commit (the old date until `advance` commits, the new date after); report for each date includes it exactly once (FIN-I10) | P0 | built | — (business date stamped from PlatformPort at commit) |
| EC-FIN-002 | The POS retries the same check line after a timeout | Same key `pos:{outlet}:{check}:{line}` returns the original posting ids; nothing new posts; outlet balancing shows one line | P0 | tested | modules/finance/test/scenario-s09-ledger-reposting.test.ts (key replay) |
| EC-FIN-003 | Two Day Close workers try to post the same room night concurrently | Unique key `room:{stay}:{night}` lets one insert win; the other reads the existing posting; no duplicate, no error surfaced to the auditor | P0 | tested | modules/finance/test/scenario-s09-ledger-reposting.test.ts (concurrent duplicates) |
| EC-FIN-004 | Restaurant charge arrives two hours after checkout on a settled folio | Folio reopens (`reopenedReason=late_charge`), charge posts flagged post-departure, collection follow-up created (MIT only if terms allowed it, otherwise payment request), departures exception raised | P0 | tested | modules/finance/test/scenario-s10-late-restaurant-charge.test.ts |
| EC-FIN-005 | Late charge arrives after the folio was fully invoiced | Charge posts to a new supplementary folio for the same payer; issued invoice untouched; follow-up task as EC-FIN-004 | P0 | tested | modules/finance/test/scenario-s10-late-restaurant-charge.test.ts |
| EC-FIN-006 | Late charge for a guest whose terms did not authorise post-departure card charges | No card charge is attempted; a payment request is created and the balance stays open with owner Finance; never shown as paid | P0 | built | modules/finance/test/scenario-s10-late-restaurant-charge.test.ts (collection request; MIT decision in payments) |
| EC-FIN-007 | Staff saves a billing rule overlapping an existing rule (same code, overlapping dates) | Save rejected with the colliding rule named and three fixes offered (narrow dates, narrow codes, edit other rule) | P0 | tested | modules/finance/src/domain/routing.test.ts |
| EC-FIN-008 | Company pays room up to USD 300/night; actual room + tax is USD 340 | USD 300 posts to the company folio, USD 40 overflow to the guest's default folio; both lines show the rule and cap that split them | P0 | tested | modules/finance/src/domain/routing.test.ts (overflow to default folio) |
| EC-FIN-009 | A new billing rule is applied retroactively but three of the matching postings are on an issued invoice | Preview lists the three as "locked by invoice INV-…" and excludes them; only unlocked postings move; audit records both lists | P0 | specified | — |
| EC-FIN-010 | Staff drags a posting to a folio owned by another legal entity's property | Rejected `intercompany_transfer` with explanation; suggests charging at the target property and refunding here | P1 | tested | modules/finance/test/security-and-corrections.test.ts (same legal entity only) |
| EC-FIN-011 | Staff tries to transfer or adjust a posting that is on an issued invoice | Rejected; offers credit note (full/partial) and re-issue flow | P0 | tested | modules/finance/test/security-and-corrections.test.ts (invoiced postings cannot move) |
| EC-FIN-012 | An adjustment larger than the original posting is attempted | Rejected (cannot reverse more than remains); remaining correctable amount shown; a credit beyond it must be a separate goodwill/service-recovery charge code with permission | P0 | missing | — |
| EC-FIN-013 | Wrong rate discovered for a night two days after it was posted and the period is still open | Correction posts today with `relatesToBusinessDate` = original date; original day report shows a restatement note; nothing is edited | P0 | tested | modules/finance/test/security-and-corrections.test.ts |
| EC-FIN-014 | Correction relates to a closed accounting period | Same as EC-FIN-013 plus entry in the restatement register and labelled in exports for the closed period; period stays closed | P0 | specified | — |
| EC-FIN-015 | USD 100.00 charge split three ways | Parts 33.34/33.33/33.33 (largest remainder), tax recomputed per part so parts' taxes sum to the original tax exactly | P0 | tested | modules/finance/src/domain/domain.test.ts (splitComponents) |
| EC-FIN-016 | TGST changes from 16% to 17% in the middle of an in-house stay | Each night uses the rule version effective on its service date (Q42 default); earlier postings unchanged; tax report splits by rate | P0 | specified | — |
| EC-FIN-017 | Guest pays a USD folio with MVR cash | Payment stores MVR amount, rate id and USD equivalent; receipt shows the rate; cashier session MVR total increases; folio balance reduces by USD equivalent | P0 | tested | modules/finance/test/scenario-s19-package-allowance-taxes.test.ts |
| EC-FIN-018 | Guest pays USD 100 note for USD 83.40 and wants change in MVR | Payment USD 100 cash; change USD 16.60 converted at today's sell rate and paid out in MVR from the drawer as a linked exchange; both currencies balance in the session | P0 | missing | — |
| EC-FIN-019 | No MVR rate entered for today's business date | MVR payments and conversions are blocked with "Enter today's MVR rate (finance)"; policy may allow the previous business date's rate with a visible warning; never a default of 1.0 | P0 | missing | — (branch picks the latest earlier rate silently: domain.test.ts; staleness warning needed) |
| EC-FIN-020 | Today's rate was mistyped (15.24 instead of 15.42) and used by 12 payments | New rate version supersedes for new postings; existing postings keep their rate id; finance sees the affected list and corrects each by adjustment with reason; FX report shows the restatement | P1 | missing | — |
| EC-FIN-021 | Card acquirer settles a USD sale in MVR at its own rate | Difference between folio functional amount and settled amount posts to FX gains/losses at reconciliation, linked to the payout | P0 | tested | modules/finance/test/receivables-cashier-fx.test.ts |
| EC-FIN-022 | Booking with USD 1,000 deposit is cancelled; policy forfeits 30% | Single previewed outcome: USD 300 to cancellation revenue, USD 700 refund via payments; deposit balance reaches 0 only when the refund is provider-confirmed (pending until then) | P0 | tested | modules/finance/test/deposits.test.ts |
| EC-FIN-023 | Deposit exceeds the final bill (guest left early) | Folio shows a credit balance; folio cannot be `settled` until refund (pending → confirmed), transfer, or "keep as guest credit" with permission; exception owned by Finance | P0 | specified | — |
| EC-FIN-024 | One stay of a three-stay booking is cancelled after a booking-level deposit | Preview reallocates the deposit by stay share (or staff choice); forfeiture applies only to the cancelled stay's share per its terms | P1 | specified | — |
| EC-FIN-025 | Check-in is reversed on the same business date after deposits were applied | Deposit application reverses back to the deposit liability; no revenue posted; audit links both | P1 | missing | — |
| EC-FIN-026 | A booking with a deposit is moved to a sister property operated by another legal entity | Deposit cannot move across entities; preview shows "refund here and re-collect there" (or inter-company LATER); booking move waits for staff confirmation | P1 | missing | — |
| EC-FIN-027 | A deposit sub-account goes negative due to a bug or manual error | Integrity alarm raised immediately, Day Close blocked at `integrity`, Finance owner notified (FIN-I08) | P0 | tested | modules/finance/test/deposits.test.ts (balance ≥ 0 constraint) |
| EC-FIN-028 | Direct bill to a receivables account that is on hold | Blocked with the hold reason and alternatives (other payer, card, approval to override) | P0 | tested | modules/finance/test/receivables-cashier-fx.test.ts |
| EC-FIN-029 | Direct bill exceeds the account's available credit | Approval request created; folio remains open (not settled) until approved; exception visible to Finance and Day Close | P0 | tested | modules/finance/test/receivables-cashier-fx.test.ts |
| EC-FIN-030 | DMC bank transfer exceeds the invoices it names | Allocated to the named invoices; surplus stays as unallocated account credit; statement shows it | P0 | built | — |
| EC-FIN-031 | DMC pays a USD invoice from an EUR account; bank credits USD less fees | Bank fee to bank charges (below policy threshold auto, above with approval); remaining short-pay stays open on the invoice; never written off silently | P0 | missing | — |
| EC-FIN-032 | A payment was allocated to the wrong invoice | Unapply then re-apply, both audited; aging recalculated; no deletion | P0 | missing | — |
| EC-FIN-033 | A bank transfer previously recorded as received is returned by the bank | Reversal posting re-opens the invoices, aging restored to the original due dates, credit-control exception and reminder task created | P0 | missing | — |
| EC-FIN-034 | Agency pays net of its commission without a commission agreement on file | Short payment left open and flagged "possible commission deduction"; staff resolves by commission offset (if contract allows) or claim | P1 | missing | — |
| EC-FIN-035 | One bank transfer covers 40 agency invoices | Bulk allocation screen with auto-match by invoice numbers in the bank reference; unmatched remainder shown; one allocation batch audited | P0 | missing | — |
| EC-FIN-036 | Invoice issuance transaction fails after reserving a number | Transaction rolls back including the number; next successful issue uses that number; series stays gapless (FIN-I06) | P0 | tested | modules/finance/test/fiscal.test.ts |
| EC-FIN-037 | Two cashiers issue invoices from the same series at the same moment | Series row lock serialises; numbers unique and consecutive; neither request fails | P0 | tested | modules/finance/test/fiscal.test.ts |
| EC-FIN-038 | A retried "issue invoice" request after a network timeout | Idempotency key returns the same document and number; no second invoice | P0 | tested | modules/finance/test/fiscal.test.ts (replays retries) |
| EC-FIN-039 | Guest asks to change the company name on an invoice issued yesterday | Credit note for the original (referencing it) and a new invoice with corrected payer, in one previewed action; both in the fiscal ledger | P0 | tested | modules/finance/test/fiscal.test.ts (cancel + corrected invoice) |
| EC-FIN-040 | Invoice template changes after documents were issued | Reprints render from the stored snapshot with its template version; output identical to the original | P1 | tested | modules/finance/test/fiscal.test.ts |
| EC-FIN-041 | Live Maldives property tries to issue an invoice while the rule pack is unverified | Blocked with reason (FIN-R35, Q41) and a link to the verification status; pro-forma/preview still allowed and labelled "not a tax invoice" | P0 | tested | modules/finance/test/fiscal.test.ts |
| EC-FIN-042 | Cashier closes a session while one card payment is pending verification | Close allowed; pending item listed separately and excluded from counted totals; resolution later posts to the session's business date record with a link | P1 | missing | — |
| EC-FIN-043 | Cashier forgets to close the drawer before Day Close | Per policy: warning (default) or blocking exception; session continues and cashier report splits totals by business date | P1 | specified | — |
| EC-FIN-044 | Blind count variance of USD 50 exceeds the review threshold | Variance posts to over/short; session marked "review required"; supervisor records explanation; appears in cashier report and handover | P0 | tested | modules/finance/test/receivables-cashier-fx.test.ts |
| EC-FIN-045 | Paid-out larger than the cash in the drawer | Blocked unless permission allows negative banking; then expected drawer shows negative and next opening float reflects policy | P1 | missing | — |
| EC-FIN-046 | Guest wants to change USD 2,000 into MVR beyond the configured exchange limit | Blocked with the limit and who can approve; partial exchange allowed | P2 | missing | — |
| EC-FIN-047 | MVR cash settlement of MVR 1,234.57 with cash rounding to 0.50 | Payment rounded to the configured multiple only for cash; difference posted to the rounding code; card payments never rounded | P1 | missing | — |
| EC-FIN-048 | Staff without permission tries to post a restricted charge code | 403 with the missing permission named and "Request approval" path; nothing posted | P0 | built | modules/finance/test/security-and-corrections.test.ts (permission refusal, general) |
| EC-FIN-049 | Dinner at 00:30 against a per-night dining allowance before Day Close | Allowance period follows the business date at commit (still the previous night), so the previous night's allowance applies; documented in the allowance definition | P0 | missing | — |
| EC-FIN-050 | Allowance would be exceeded only because of tax and service charge | Allowance usage = min(charge incl. taxes per definition, remaining); excess payable by guest shown on the line | P0 | tested | modules/finance/test/scenario-s19-package-allowance-taxes.test.ts |
| EC-FIN-051 | Stay shortened after breakage was posted for earlier nights | Closed periods keep their breakage; future allowance instances are cancelled and their allocations reversed | P1 | specified | — |
| EC-FIN-052 | Charge posted to the wrong villa, noticed next morning | Transfer to the correct stay's folio (if not invoiced) with reason and audit; if invoiced, credit note + re-post | P0 | tested | modules/finance/test/security-and-corrections.test.ts |
| EC-FIN-053 | Guest disputes a minibar item at checkout | Adjustment with reason code `guest_dispute`; minibar stock movement unchanged (consumption record kept for stock audit) | P1 | specified | — |
| EC-FIN-054 | Folio balance is zero only because a payment is pending verification | Folio shows "balance 0 incl. USD 840 pending verification"; cannot be marked settled; checkout warns | P0 | built | modules/finance/test/payments-ledger-port.test.ts (unverified flagged) |
| EC-FIN-055 | Opening balances imported from the old PMS differ from its closing report by USD 312.40 | Difference sits in migration suspense with a per-booking discrepancy list and owner; nothing auto-adjusted (S18) | P0 | tested | modules/finance/test/scenario-s18-opening-deposits.test.ts |
| EC-FIN-056 | Connected mode: a Portico spa charge is rejected by the external PMS | Charge shown "not on guest bill" (pending → rejected), integration exception with business impact and retry/manual-post options; not counted as revenue in Portico | P0 | specified | — |
| EC-FIN-057 | Two agents transfer the same posting at the same time | One succeeds; the other receives 409 with the current folio state and what changed | P0 | built | apps/api/test/finance.test.ts (ETag) |
| EC-FIN-058 | Agency commission on a cancelled booking whose deposit was forfeited | Commission per agency contract flag `commissionOnCancellationRevenue` (default no); decision recorded on the commission line | P1 | missing | — |
| EC-FIN-059 | Commission already deducted from a net deposit (prepaid) | Commission marked prepaid; excluded from payment runs; no double payment | P1 | missing | — |
| EC-FIN-060 | USD 0.01 residual after FX conversion on settlement | Auto write-off to rounding below the configured threshold (default 1 minor unit × currency factor), audited; above threshold requires action | P0 | missing | — |
| EC-FIN-061 | Day-use stay (arrive and leave the same day) | No night posting; day-use fee posts as a charge per terms; folio settles normally; statistics count day use separately | P1 | missing | — |
| EC-FIN-062 | 45-night long stay billed monthly | Interim invoice per month locks those postings; folio stays open; next month continues; deposit applied per policy | P1 | missing | — |
| EC-FIN-063 | Tip added to a POS check charged to the villa | Tip posts to tips payable (liability), not revenue or taxable base; payout to staff is a cash/payroll flow outside guest revenue | P0 | tested | modules/finance/src/domain/domain.test.ts (tips outside the tax base) |
| EC-FIN-064 | Diplomatic guest exempt from TGST | Exemption recorded with certificate reference on the stay/folio; postings carry exempt tax lines; tax report lists exempt revenue | P1 | missing | — |
| EC-FIN-065 | Weather cancels the departure seaplane; guest must stay one more night | Extra night created via reservations with a policy choice (charge, discounted, complimentary with reason); Green Tax per person-night still computed by the rule pack; reason linked to the weather disruption | P0 | missing | — |
| EC-FIN-066 | Guest departs on a 06:00 seaplane before the desk opens | Express checkout night before or by link: folio previewed, card on file charged only with consent/terms, folio emailed; late outlet charges follow EC-FIN-004 | P0 | missing | — |
| EC-FIN-067 | Guesthouse did not run Day Close for two days | Postings carry the lagging business date with a prominent banner; Day Close runs sequentially per missed date; no posting to skipped dates except catch-up keyed postings | P0 | specified | — |
| EC-FIN-068 | Group property in a DST time zone; 02:00–03:00 does not exist on the spring-forward date | Business date unaffected; occurredAt stored in UTC; scheduled Day Close start at a non-existent local time runs at the next valid minute | P1 | missing | — |
| EC-FIN-069 | A payer company profile is merged into another after invoices were issued | Issued invoices keep their payer snapshot; receivables account follows the merge with audit; unmerge restores the link | P1 | specified | — |
| EC-FIN-070 | Revenue account mapping for "Spa" changes effective today | Earlier postings keep the old account; new postings use the new mapping; export shows both with effective dates | P0 | specified | — |
| EC-FIN-071 | Database failover in the middle of a multi-posting command | Whole command rolls back (one transaction); client retries with the same idempotency key; exactly one result | P0 | built | modules/finance/test/ledger.test.ts (atomic balanced commit) |
| EC-FIN-072 | A company asks for one consolidated invoice for 12 stays across a month | Compress/consolidate flow (missing today) produces one invoice referencing all folios; individual folios locked; credit notes still per original documents | P1 | missing | — |
| EC-FIN-073 | Folio currency USD but a German corporate requests the invoice in EUR | Invoice shows EUR as second currency at the stored rate with rate source; legal amounts remain in folio currency unless law requires otherwise | P2 | specified | — |
| EC-FIN-074 | Service charge 10% must not apply to Green Tax lines | Tax engine computes service charge only on its base (rule pack data); folio shows bases per line; tax report reconciles | P0 | tested | modules/finance/src/domain/domain.test.ts (Green Tax as levy) |
| EC-FIN-075 | Cancelled booking needs a cancellation-fee invoice but no stay was ever checked in | Fee posts to the booking folio; invoice issued from it; deposit applied against the fee | P0 | specified | — |
| EC-FIN-076 | The same idempotency key is replayed with a different amount | Refused as a key conflict; original posting unchanged; error explains the mismatch | P0 | tested | modules/finance/test/scenario-s09-ledger-reposting.test.ts |
| EC-FIN-077 | Two outlet charges race for the last USD 20 of a company's per-night cap | Capped rule row locked; exactly one charge uses the remainder, the other overflows to the default folio | P0 | tested | modules/finance/test/security-and-corrections.test.ts |
| EC-FIN-078 | Deposit paid at TGST 16%; stay happens after the rate rose to 17% | Prepaid part keeps the rate declared at receipt; difference credited per time-of-supply rule (unverified Q41/Q42) | P0 | tested | modules/finance/test/deposits.test.ts |
| EC-FIN-079 | Cash payment attempted with no open cashier session | Refused (or flagged per policy) with "open your cash drawer first"; nothing posted unattributed | P0 | tested | modules/finance/test/payments-ledger-port.test.ts |
| EC-FIN-080 | A whole charge entry is reversed twice (double click, retry) | Reversed exactly once; allowance usage restored once; second request returns the first reversal | P0 | tested | modules/finance/test/security-and-corrections.test.ts |
| EC-FIN-081 | Retention period ends for invoices under a tax audit legal hold | Purge refused while the hold exists; hold reason and owner visible | P1 | tested | modules/finance/test/security-and-corrections.test.ts |
| EC-FIN-082 | Child under the Green Tax exemption age in a family stay | Exempt guest-nights recorded (rule-pack data, unverified Q41); Green Tax report shows exempt days separately | P0 | tested | modules/finance/test/scenario-s19-package-allowance-taxes.test.ts |
| EC-FIN-083 | Non-USD invoice whose USD rate deviates more than 2% from the MMA reference rate | Issue blocked with both rates and the deviation shown; corrected rate required | P1 | tested | modules/finance/test/fiscal.test.ts |
| EC-FIN-084 | Tax engine (`rates`) is not connected or errors | Posting refused with an honest 503 explaining that taxes cannot be computed; nothing posted untaxed | P0 | tested | apps/api/test/finance.test.ts |

## Evidence sources (all verified 2026-11-07)

OPERA Cloud 26.2 User Guide (`docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/`):

[op-ar]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_accounts_receivable_accounts_receivable_ch.htm
[op-ar-acct]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_accounts_receivable_creating_account_receivables_accounts.htm
[op-ar-fixed]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_postings_adjustments_posting_fixed_charges.htm
[op-ar-notes]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_accounts_receivable_notes.htm
[op-ar-traces]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_accounts_receivable_adding_traces_to_accounts_receivable_accounts.htm
[op-ar-inv]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_accounts_receivable_viewing_and_managing_invoice_details.htm
[op-ar-pay]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_accounts_receivable_managing_ar_invoice_payments.htm
[op-ar-invoices]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_managing_ar_account_invoices_and_payments.htm
[op-ar-aging]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_accounts_receivable_accounts_receivable_aging.htm
[op-ar-remind]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_accounts_receivable_sending_ar_reminders.htm
[op-ar-batchremind]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_accounts_receivable_generating_batch_account_receivable_reminder_letters.htm
[op-ar-stmt]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_accounts_receivable_generating_accounts_receivable_statements.htm
[op-ar-batchstmt]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_accounts_receivable_generating_batch_account_receivable_statements.htm
[op-dbt]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_accounts_receivable_direct_bill_transfer.htm
[op-ar-batch]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_accounts_receivable_batch_postings.htm
[op-ar-research]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_accounts_receivable_transaction_research.htm
[op-ar-cc]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_accounts_receivable_consolidated_credit_cards.htm
[op-ar-yearview]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_accounts_receivable_viewing_accounts_receivables_year_view.htm
[op-ar-stays]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_accounts_receivable_future_past_stays.htm
[op-ar-log]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_accounts_receivable_viewing_the_ar_changes_log.htm
[op-ar-types]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_ar_managing_ar_account_types.htm
[op-ar-restricted]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_ar_creating_ar_restricted_reasons.htm
[op-comp-ar]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_comp_accounting_comp_ar_accounts.htm
[op-cl-overage]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_using_credit_limit_overage.htm
[op-folio-styles]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_cashiering_finance_selecting_folio_styles_for_viewing_printing.htm
[op-folio-hist]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_advance_billing_viewing_folio_histories.htm
[op-credit-bill]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_cashiering_finance_generating_credit_bill.htm
[op-credit-bill2]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_manage_billing_generate_credit_bills_from_billing.htm
[op-debit-bill]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_advance_billing_bebit_bills_for_folios.htm
[op-billing]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_manage_billing_manage_billing.htm
[op-postings]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_postings_adjustments_postings_adjustments_and_payments_ch.htm
[op-pos-check]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_manage_billing_viewing_pos_check_image_for_a_charge.htm
[op-prestay]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_cashiering_finance_prestay_poststay_charging.htm
[op-cashier-login]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_cashiering_finance_cashier_login.htm
[op-billing-summary]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_manage_billing_viewing_billing_summary.htm
[op-void-folio]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_front_desk_departures_voiding_a_folio.htm
[op-pkg-allow]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_managing_reservation_package_allowances_and_charges.htm
[op-adv-bill-rev]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_manage_billing_reversing_advance_bill_for_deposits.htm
[op-batch-folio]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_batch_folios_generating_batch_folios.htm
[op-auto-settle]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_auto_folio_settlement.htm
[op-batch-charges]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_batch_folios_applying_batch_postings.htm
[op-batch-deposits]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_batch_folios_processing_batch_deposits.htm
[op-giftcard]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_managing_prepaid_gift_cards.htm
[op-fx]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_manage_billing_calculating_currency_exchanges.htm
[op-fx-rates]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_creating_currency_exchange_rates.htm
[op-global-fx]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_manage_billing_managing_global_membership_exchange_rates.htm
[op-postit]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_manage_billing_charging_purchases_using_post_it.htm
[op-xprop]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_posting_cross_property_charges.htm
[op-receipts]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_manage_billing_finding_receipts.htm
[op-open-cashiers]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_cashiering_finance_open_cashiers.htm
[op-cashier-close]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_cashiers_closure.htm
[op-cashier-reports]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_cashiering_finance_generating_cashier_reports.htm
[op-posting-journal]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_viewing_posting_journal.htm
[op-fiscal-failed]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_cashiers_sending_failed_fiscal_payloads.htm
[op-vouchers]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_generating_batch_vouchers.htm
[op-covers]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_cashiering_finance_adjusting_daily_covers.htm
[op-consumable]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_cashiering_finance_monitoring_consumable_inventory.htm
[op-sftp]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_cashiers_upload_folios_to_sftp.htm
[op-comm]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_commissions_commissions_ch.htm
[op-comm-hold]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_commissions_placing_commission_processing_on_hold.htm
[op-comm-zero]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_commissions_transferring_zero_commissions_to_history.htm
[op-comm-pay]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_commissions_processing_commission_payments.htm
[op-comm-activity]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_commissions_using_commission_payment_activity.htm
[op-comm-research]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_commissions_researching_reservations_commission_details.htm
[op-comm-detach]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_commissions_detaching_reservations_from_travel_agents_sources.htm
[op-comm-codes]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_configuration_codes_commission_codes.htm
[op-comm-bank]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_configuration_codes_bank_accounts.htm
[op-comm-stop]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_configuration_stop_processing_reasons.htm
[op-comm-eft]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_config_admin_about_commission_eft_export_file_formats.htm
[op-icn]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_hotel_charge_card.htm
[op-comp]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_comp_accounting.htm
[op-eod]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_endofday_procedures.htm
[op-ia]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_endofday_income_audit.htm
[op-prt]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_post_room_tax.htm
[op-eod-procs]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_mandatory_optional_procedures.htm
[op-adj-codes]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_creating_adjustment_reason_codes.htm
[op-auto-settle-types]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_setting_up_auto_folio_settlement_rules.htm
[op-folio-types]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_configuring_folio_types.htm
[op-copy-legend]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_configuring_folio_copy_legend.htm
[op-folio-arr]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_configuring_folio_arrangement_codes_folio_groupings.htm
[op-cashiers-cfg]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_management_setting_up_cashiers.htm
[op-custom-numbers]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_configuring_custom_numbers.htm
[op-custom-charges]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_configuring_custom_charges.htm
[op-custom-exempt]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_managing_custom_charge_exemption.htm
[op-periods]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_configuring_period_definition_periods.htm
[op-fcy-limits]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_configuring_foreign_currency_limits.htm
[op-noshow-rules]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_configuring_no_show_posting_rules.htm
[op-words]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_admin_financial_cashiering_translating_numbers_into_words.htm
[op-shift-drop]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_cashiering_finance_configuring_shift_drop_locations.htm
[op-tax-types]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_managing_tax_types.htm
[op-exch-tax]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_configuring_exchange_service_taxes.htm
[op-trx-discount]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_configuring_transaction_discount_rules.htm
[op-voucher-rules]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_configuring_voucher_rules.htm
[op-collect-tax]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_configuring_collecting_tax_agents.htm
[op-trx-codes]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_admin_financial_cashiering_about_transaction_codes.htm
[op-trx-diversion]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_admin_booking_reservations_transaction_diversion.htm
[op-rev-buckets]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_admin_financial_revenue_bucket_types_overview.htm
[op-routing-codes]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_transaction_management_managing_routing_codes.htm
[op-generates]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_admin_financial_transaction_management_tax_generates.htm
[op-rounding]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_admin_financial_cashiering_about_rounding_factors.htm
[op-trx-protect]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_transaction_management_configuring_transaction_code_protection.htm
[op-articles]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_managing_articles.htm
[op-fiscal-partners]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_financial_admin_fiscal_management_configuring_fiscal_partners.htm
[op-ofis]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_configuring_ofis_cloud_integrations.htm
[op-fiscal-status]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_monitoring_fiscal_business_event_status.htm
[op-routing]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_managing_reservations_routing_instructions.htm
[op-routing-limits]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_managing_reservations_routing_limits.htm
[op-rate-routing]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_creating_a_new_rate_code.htm
[op-pay-instr]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_managing_reservation_payment_instructions.htm
[op-deposits]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_managing_reservations_deposit_payments.htm
[op-adv-deposit]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_managing_reservations_advanced_deposit_handling.htm
[op-dep-refund]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_managing_reservations_refunding_credit_card_deposit_payments.htm
[op-dep-policy]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_managing_reservation_deposit_and_cancellation.htm
[op-noshow-charges]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_managing_reservations_managing_no_show_and_cancellation_deposits_and_charges.htm
[op-fixed-charges]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_managing_reservations_fixed_charges.htm
[op-proforma]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_advance_billing_generating_a_proforma_folio.htm
[op-house-acct]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_booking_reservations_creating_house_accounts.htm
[op-posting-master]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_booking_creating_new_posting_master.htm
[op-block-deposits]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_managing_blocks_reservation_deposits_and_cancellations.htm
[op-event-post]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_osem_managing_event_posting.htm
[op-adv-folio-pay]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_inhouse_about_advanced_folio_payment.htm
[op-quick-co]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_departures_using_quick_checkout.htm
[op-open-folio]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_dep_check_out_res_with_open_folio.htm
[op-sched-co]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_managing_reservations_scheduling_check_out.htm
[op-reinstate-co]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_departures_reinstating_checked_out_reservations.htm
[op-res-giftcard]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_managing_reservation_prepaid_gift_cards.htm
[op-pay-points]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_managing_reservations_redeem_awards_pay_with_points.htm
[op-pkg-codes]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_package_codes.htm
[op-pwa-billing]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_managing_billing_instructions_mobile_app_pwa.htm
[op-pwa-pkg]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_package_consumption_mobile_app_pwa.htm
[op-rpt-fin]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_financials.htm
[op-rpt-eod]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_end_of_day.htm
[op-rpt-ar]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_accounts_receivable.htm
[op-rpt-comm]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_commissions.htm
[op-rpt-deposit-activity]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_deposit_activity_report_deposit_activity.htm
[op-rpt-month-end]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_month_end_details_report.htm
[op-rpt-qr]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_reports_managing_qr_code_definitions.htm
[op-stationery]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_stationery_editor_bi_pub.htm
[op-bo-exports]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_exports_back_office_exports.htm
[op-xml-bo]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_exports_generic_xml_back_office_export.htm
[op-export-map]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_exports_export_mapping.htm
[op-export-sched]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_managing_scheduled_exports.htm
[op-export-delivery]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_exports_managing_export_file_delivery_configuration.htm
[op-export-api]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_export_api_files.htm
[op-efolio]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_using_efolio_exports.htm
[op-roles]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_manage_roles.htm

Apaleo, Mews, Agilysys, Infor, NetSuite, Oracle Simphony:

[ap-fin]: https://api.apaleo.com/swagger/finance-v1/swagger.json
[ap-fin-beta]: https://api.apaleo.com/swagger/finance-v0-nsfw/swagger.json
[ap-reports]: https://api.apaleo.com/swagger/reports-v1/swagger.json
[ap-ops-beta]: https://api.apaleo.com/swagger/operations-v0-nsfw/swagger.json
[ap-acct]: https://apaleo.zendesk.com/hc/en-us/articles/360019220119-Introduction-to-the-Apaleo-Accounting
[ap-night-audit]: https://apaleo.zendesk.com/hc/en-us/articles/115003519971-Night-Audit-Revenue-Recognition-and-Prepayment-Handling-payment-deposits
[ap-folio-types]: https://apaleo.zendesk.com/hc/en-us/articles/360017096760-Folio-Types-and-House-Account
[ap-pos-nonres]: https://apaleo.dev/guides/business-cases/pos-integration/non-reservation-postings.html
[mw-acct-uc]: https://docs.mews.com/connector-api/use-cases/accounting
[mw-ledger-api]: https://docs.mews.com/connector-api/operations/ledgerbalances
[mw-bills]: https://docs.mews.com/connector-api/operations/bills
[mw-pos-uc]: https://docs.mews.com/connector-api/use-cases/point-of-sale
[mw-acct-cat]: https://docs.mews.com/connector-api/operations/accountingcategories
[mw-cashier-api]: https://docs.mews.com/connector-api/operations/cashiertransactions
[mw-fx-api]: https://docs.mews.com/connector-api/operations/exchangerates
[mw-outletitems]: https://docs.mews.com/connector-api/operations/outletitems
[mw-payreq-api]: https://docs.mews.com/connector-api/operations/paymentrequests
[mw-ehw]: https://mewssystems.freshdesk.com/support/solutions/articles/31000129871-editable-history-window
[mw-trial-balance]: https://help.mews.com/s/article/The-Trial-balance-in-Mews-Operations-1
[mw-deposit-ledger]: https://help.mews.com/s/article/The-Deposit-ledger-in-Mews-Operations-1
[mw-city-ledger]: https://help.mews.com/s/article/The-City-ledger
[mw-ledger-activity]: https://help.mews.com/s/article/The-Ledger-activity-report-in-Mews-Operations
[mw-reissue]: https://help.mews.com/s/article/How-to-reissue-an-issued-invoice-or-closed-bill-to-make-changes-and-issue-refunds
[mw-correct-bill]: https://help.mews.com/s/article/new-billing-procedure-correct-a-closed-bill
[mw-cash-drawer]: https://help.mews.com/s/article/cash-drawer-reports
[mw-cash-track]: https://help.mews.com/s/article/tracking-cash-deposits-and-withdrawals-for-the-current-open-drawer
[ag-split]: https://help.rguest.com/stay/UserGuide/Split%20Charges%20Between%20Accounts.htm
[ag-routing]: https://help.rguest.com/stay/UserGuide/Add%20a%20New%20Routing%20Rule.htm
[ag-fiscal-auto]: https://help.rguest.com/stay/UserGuide/Automatically%20Closing%20a%20Fiscal.htm
[ag-fiscal-man]: https://help.rguest.com/stay/UserGuide/Manually%20Closing%20a%20Fiscal.htm
[inf-help]: https://docs.infor.com/hms/2025.x/en-us/hmsolh/default.html
[inf-aging]: https://docs.infor.com/hms/3.8/en-us/hmsolh/pages/aragingdetailsreport_help.html
[inf-cashier-bank]: https://docs.infor.com/hms/3.8/en-us/hmsolh/pages/cashierbankingreport_help.html
[ns-close]: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1455781.html
[sim-gift]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_svc_issue_card.htm
[sim-opera-lookup]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_opera_connect_guest_lookup.htm
