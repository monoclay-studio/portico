# finance — 10x brief

Status: v1 · 2026-11-07 · Gap strategist · Built (wave 1, R3) · Spec `docs/specs/finance.md` · Parity
`docs/parity/finance.md` (+ `docs/parity/gaps-finance.md`) · Source key: `docs/strategy/gap-plan.md` §0. **All
targets are TARGETS until validated with hotel staff.**

## 1. Current state (evidence)

- **Built, R3** (README-finance § Capabilities): double-entry journal per legal entity balanced per currency and in
  functional currency (deferred trigger), append-only, corrections as linked entries, folios as projections (stay,
  booking, group, company, house), `postCharge` with routing by specificity and caps, "who pays for what" preview,
  allowances with breakage/carry/credit, deposits as liabilities with **TGST at receipt** and rate-change credit,
  late charges with supplementary folios, receivables with aging and credit limits, gapless hash-chained invoices and
  credit notes, live issuance blocked while tax rules are unverified, cashier sessions with blind close, FX with MMA
  reference and no silent fallback, trial balance and integrity report, opening-balance import of deposits without
  double TGST (S18), payouts never revenue. 85 module tests + 40 API tests.
- **Review:** 2 P0 (over-correction races; posting blocked by valid rule sets) and 10 P1 fixed (REV-finance; ADR-0016).
- **Parity:** 270 rows (the largest matrix) — **30% tested/equivalent, 78 P0 open, 70 P1 missing**; edge cases 44%.
  Open P0 missing: passer-by folio (PAR-FIN-025), interim bill (151), AR payment unapply/edit/reverse (178), posting
  journal search (294), gross/net transaction exports via API (328); EC-FIN-012, 018, 019, 031, 032, 033, 035, 049, 060,
  065, 066. Open P0 specified: receipts (208), invoice preview (207), write-off (193), statements (180), effective-dated
  account mapping (010), retroactive re-routing with preview (108), period close/restatement (320–323 → accounting),
  POS posting and outlet balancing (330–332), forwarding to an external PMS (333).
- **Known gaps:** receipts (F-10) despite MIRA's 3-day invoice-or-receipt rule; threshold approvals; write-offs;
  agency commissions; company/agency rule templates; transfer previews; journal exports; FX revaluation; business date
  read without a lock (needs platform `lockBusinessDate`) (README § Known gaps; PF).
- **Ports:** tax → rates and payments' `LedgerPort` → finance are being bound on `feat/integration-step` (a35bde0).
- **UX1:** no finance workspace at all — no folios, AR, company accounts, deposits ledger, cashier or payments screen;
  the "payments pending verification" tile totals match nothing visible (persona 6: blocker).

## 2. Best on the market today

| Area | Who does it best | How | Source |
|---|---|---|---|
| Folio windows and routing | OPERA | Routing instructions, folio windows, transaction codes with generates, AR/direct bill/city ledger | R01 §3.6–3.9 |
| Ledger-first accounting | Apaleo | Real double-entry core, receivable sub-account per reservation, business date vs posting date | R02 §3.3.6 |
| Ranked routing with % splits | Agilysys | Ranked rules — **patent application** (DD04 P4; Q40) | R01 §6.5 |
| Correction by reissue | Mews (2026) | Bill reissue with credit note; company PO numbers | DD02b §1.3 |
| Ledger export | Mews Exports `LedgerEntry`; OPERA trial balance at EOD | Bulk export of postings | DG #17; R01 §3.1 |
| History and archive | OPERA sells folio/EOD archive separately (OCAS) | Paid add-on | DD02a §1.2 |
| Late charges without the desk | Infor HMS | Post-departure charges handled automatically | R01 §4.6 |

## 3. Gaps vs market (ranked)

| # | Gap | Why it matters | Parity rows / edge cases |
|---|---|---|---|
| 1 | Receipts and deposit receipts as numbered fiscal documents; invoice preview; issuance-deadline monitor | MIRA 3-day rule (DG #45; JG-08) | PAR-FIN-207, 208; F-10 |
| 2 | No finance workspace data contracts for the UI: billing summary per stay, open balances, deposit activity, posting journal search | Persona 6 blocker | PAR-FIN-030, 291, 294, 299 |
| 3 | AR depth: unapply/reallocate, returned bank transfers, one transfer for 40 invoices, statements, write-off with approval, agency commissions | DMC/tour-operator payments dominate Maldivian resorts (contracting spec §1) | PAR-FIN-178, 180, 193, 264, 265; EC-FIN-031, 032, 033, 035 |
| 4 | Desk money edge cases: change in MVR for a USD note, missing MVR rate, 0.01 residuals, desk currency exchange | Daily Maldivian desk reality | EC-FIN-018, 019, 060; PAR-FIN-241 |
| 5 | Interim bill, passer-by folio, express checkout | Speed and non-staying customers | PAR-FIN-025, 151, 152 |
| 6 | Retroactive re-routing with preview; effective-dated revenue mapping | Corrections without manual transfers | PAR-FIN-010, 108; EC-FIN-009, 070 |
| 7 | Outlet posting contract: POS lines, eligibility, outlet balancing | Resort pilot (M11) | PAR-FIN-330–332 |
| 8 | Journal/transaction exports by business day (gross/net) and API | Accounting bridge before `accounting` exists | PAR-FIN-015, 324, 325, 328 |
| 9 | Weather/early departure realities (06:00 seaplane before desk opens; forced extra night) | Maldives | EC-FIN-065, 066 |
| 10 | Forwarding charges to an external PMS (connected mode) | Adoption path 2 | PAR-FIN-333; EC-FIN-056 |

## 4. The 10x outcome (TARGETS)

**Picture:** the finance clerk opens one workspace that lists only what needs attention — unmatched payments, folios
past their invoice deadline, AR items to allocate — each with the fix one click away; every number reconciles to the
ledger to the cent, every correction is a visible linked entry, and the trial balance at Day Close is balanced by
construction.

| Dimension | Metric | Today | Market reference | Target |
|---|---|---|---|---|
| Powerful | P0 rows + P0 edge cases tested | 30% / 78 open | OPERA cashiering is top-3 in every release (DD02a §1.1) | 100% |
| Powerful | Integrity report differences after the full scenario suite | 0 (all scenario tests assert integrity) | OPERA EOD AR defects (R01 §3.1) | 0, also under concurrency and failover |
| Seamless | Check-out with split folios and settlement | no UI | baseline to measure | ≤ 90 s, 0 wrong payer (UXP §19) |
| Seamless | Allocate one bank transfer to 40 agency invoices | not built | baseline to measure | ≤ 2 min with suggested matching |
| Seamless | Fiscal documents issued within the legal window | receipts not built | — | 100% (deadline monitor + Day Close exception) |
| Friendly | Folio lines a guest or clerk cannot trace to a source (stay, outlet, rule, correction) | 0 in API | — | 0 in every view; package lines grouped with breakdown (PAR-FIN-032) |
| Well-rounded | Edge cases handled | 44% | — | 100% P0, ≥ 90% P1 |
| Well-rounded | Archive and folio history | retained (`retain_until`) | sold separately by OPERA (DD02a §1.2) | included, searchable, exportable |

## 5. Next 3 increments

### Increment 1 — Fiscal completeness for the pilot
- `receipt` and `deposit_receipt` fiscal kinds with their own series and hash chains, issued idempotently per payment
  ref (F-10); invoice preview without consuming a number; issuance-deadline monitor contributing a Day Close exception
  (JG-08); `FiscalAdapter` port seam for MIRA e-invoicing (no adapter yet); `lockBusinessDate` from platform used by
  postings (P2-01).
- **Acceptance:** PAR-FIN-132/133 (re-graded, F-12), 207, 208 tested; a deposit by bank transfer yields a receipt in
  the same business day; parity-finance downgrades applied (PF).

### Increment 2 — The finance workspace contracts
- Read models and endpoints for: billing summary per stay (all folios, deposits, pending items), open balances
  incl. deposits and group folios, deposit activity, posting journal search (by cashier, code, unit, date), cashier
  reports, pending-verification queue joined with payments' status; `listExceptions` in the common shape (unmatched,
  unbalanced, late charge, invoice overdue); interim bill and passer-by folio; MVR change for USD tenders and the
  missing-rate block with a guided fix.
- **Acceptance:** PAR-FIN-025, 030, 151, 243, 291, 294, 299 and EC-FIN-018, 019, 060 tested; backoffice can render a
  finance workspace with zero simulated data.

### Increment 3 — Receivables for DMCs and tour operators
- Allocation engine (suggested matches by invoice refs, amounts, voucher numbers), unapply/reallocate/reverse with
  history, returned bank transfers, statements on demand and in batch with numbering, write-off with approval
  (identity approvals when available), agency commissions (paid in AR offset), net-rate invoicing, FX differences on
  settlement in foreign currency.
- **Acceptance:** PAR-FIN-178, 180, 193, 264, 265 and EC-FIN-030–035 tested; one bank transfer for 40 invoices
  allocated in an API test with a preview.

## 6. Cross-module dependencies and contract changes

- **payments:** `LedgerPort` binding (property-scoped), `markPaymentVerified`, settlement fees, collections; returned
  transfers. **rates:** tax activation sign-off; per-document rounding. **day-close:** integrity step, allowance close,
  deadline exceptions. **reservations:** propertyId on all calls (PF), penalty charge codes. **fnb-pos/resort:** POS
  line posting, eligibility, outlet balancing (PAR-FIN-330–332). **contracting:** statements and settlement models.
  **accounting:** period close and restatement register move there (FIN-R43); journal export format. **integration:**
  forward charges in connected mode. **comms:** invoice/receipt delivery status.
- **New contract:** `issueReceipt`, `previewInvoice`, `listExceptions`, `searchPostings`, `allocateReceivablePayment`
  with preview, `FiscalAdapter` port.

## 7. Power check — never lose or hide

Double entry is the source of truth; posted records are immutable and corrections are linked entries; authorization ≠
payment, deposit ≠ revenue, payout ≠ sale; retries never duplicate; gapless numbering under locks; live fiscal
documents blocked on unverified tax rules; a missing FX rate blocks instead of guessing; routing stays explainable with
the "who pays for what" preview; no ranked-precedence routing until Q40 is answered.
