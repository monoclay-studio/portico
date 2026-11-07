# accounting — 10x brief (complete books on the hotel ledger)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 4, BOH-2 stage A; pilots keep their accounting system
via journal export until then) · Spec `docs/specs/accounting.md` (ACC-R01–R51 — **prefix collision:** `access` also uses `ACC-Rnn`; cite as `accounting ACC-Rnn` until the orchestrator renames one) · Parity `docs/parity/accounting.md` ·
Source key: `docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated with a hotel controller.** Owner
questions: Q100, Q105 (USALI), Q106 (Maldives items for the adviser), Q107 (bank formats), Q109 (packaging).

## 1. Current state (evidence)

- **No `accounting` code exists.** It deliberately sits on `finance`'s journal (spec §2.1): finance already provides
  balanced append-only entries per legal entity, chart template (USALI-inspired), trial balance, receivables and aging,
  FX with MMA reference rates, payouts and settlement fees, integrity checks (README-finance). Finance gaps that feed
  accounting: journal exports, effective-dated account mapping, period close/restatement register (moved here), FX
  revaluation of open balances.
- **Parity:** 89 rows / 37 edge cases, 0% tested, **68 P0 open**; P0 missing EC-ACC-006 (telegraphic transfer short by
  intermediary fees); P1 missing: repeating supplier bills, non-guest customer invoices (rent, concession and utility
  recharges), auto-reversing accrual into a closed period, supplier advance in USD applied to an MVR invoice, period-end
  revaluation without an MMA rate. Baseline: Xero, QuickBooks Online, NetSuite, OPERA period definitions, Apaleo/Mews
  ledgers (parity file header).

## 2. Best on the market today

| Area | Who | How | Source |
|---|---|---|---|
| SMB accounting UX | Xero, QuickBooks Online | Locked system accounts, tracking categories, bills, bank feeds | PAR-ACC baseline |
| Mid-market GL | NetSuite | Subsidiaries, period close checklists | PAR-ACC baseline |
| PMS-native accounting core | Apaleo | USALI-inspired accounting, receivable sub-accounts | R02 §3.3.6 |
| Ledger export | Mews Exports `LedgerEntry` | Bulk ledger extraction | DG #17 |
| Standard | USALI 12th (from 1 Jan 2026) | Sustainability lines, fee reporting, all-inclusive guidance | DG #42; DD03 §9 |

## 3. Gaps vs market (ranked — stage A first)

| # | Gap | Spec / parity |
|---|---|---|
| 1 | Journal export to the hotel's existing accounting system (bridge for pilots) | PAR-FIN-015, 324, 325, 328 (finance) |
| 2 | Accounting entity, CoA templates by profile, dimensions, reporting trees (USALI 12) | ACC-R01–R04; Q105 |
| 3 | Manual, recurring and accrual journals with an accounting date | ACC-R05–R08; EC-ACC-010 |
| 4 | Payables: supplier master (bank details encrypted), invoices, credit notes, payment runs (instructions only), commissions and OTA invoices | ACC-R10–R18; PAR-ACC-028 |
| 5 | Bank statement import and reconciliation incl. card settlements and short TT receipts | ACC-R21–R24; EC-ACC-006; Q107 |
| 6 | Close cockpit, cut-off matrix, FX revaluation | ACC-R27–R29; EC-ACC-028 |
| 7 | TB, P&L (USALI tree), balance sheet with drill-down; tax return working papers | ACC-R31–R33+ |
| 8 | Non-guest customer invoices (rent, concession and utility recharges) | PAR-ACC-126 |
| 9 | Stage B: fixed assets, budgets, cash management, owner reporting | spec §2.2 |

## 4. The 10x outcome (TARGETS)

**Picture:** a resort controller closes the month inside Portico — supplier invoices matched, bank reconciled, accruals
posted, FX revalued — and the P&L in the USALI tree drills straight down to the folio postings and supplier invoices
behind each line, with no export-import cycle between the PMS and an accounting package.

| Dimension | Metric | Target |
|---|---|---|
| Powerful | P0 rows + P0 edge cases tested (stage A) | 100% |
| Seamless | Days to close a month for a 120-villa resort | baseline to measure with a pilot controller; target ≤ 3 working days |
| Seamless | Re-keying between PMS and books | 0 (one journal) |
| Friendly | Statement lines that do not drill to source documents | 0 |
| Well-rounded | Coexistence with an external accounting system | journal export at R3 before any pilot; authority `accounting` external supported |

## 5. Next 3 increments

### Increment 1 — The accounting bridge (with finance; pilot-useful)
- Journal export by business day (gross/net) with export mappings Portico code → external GL code, CSV and API,
  idempotent per day, re-export after restatement with a delta; authority `accounting` external respected.
- **Acceptance:** PAR-FIN-015, 324, 325, 328 tested; exported totals equal the trial balance movements per day.

### Increment 2 — Stage A core: structure and journals
- Accounting entity and fiscal calendar, CoA templates (compact guesthouse, full resort), dimensions with rules,
  versioned USALI 12 reporting tree (wording per Q105), manual/recurring/accrual journals through `finance.postJournal`,
  close cockpit with period lock.
- **Acceptance:** ACC-R01–R09, R27 tested; EC-ACC-010 tested; no balances stored outside finance.

### Increment 3 — Payables and bank
- Supplier master with encrypted bank details, supplier invoices and credit notes, payment-run instructions (environment
  effect, never executed by Portico), OTA and agency commission invoices, bank statement import (generic + per-bank
  mappings when Q107 yields formats), reconciliation incl. card settlements and short telegraphic transfers.
- **Acceptance:** ACC-R10–R18, R21–R24 and EC-ACC-006, 023 tested.

## 6. Cross-module dependencies and contract changes

**finance:** `postJournal` (CR-02), period lock, FX rates, receivables. **procurement:** three-way match into supplier
invoices. **payments:** payouts and card settlements. **workforce:** payroll journal import. **concessions/utilities:**
recharge invoices. **analytics:** USALI reports. **integration:** ERP connectors.

## 7. Power check — never lose or hide

One journal (finance) — no second set of balances; posted entries immutable; closed periods reopen only with permission
and reason; Portico prepares payment instructions but never moves money; no tax advice or compliance claims (Q106).
