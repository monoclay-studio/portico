# concessions — 10x brief (partner operators inside resorts)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 4, BOH-5) · Spec `docs/specs/concessions.md`
(CNC-R01–R09) · Parity: **none** · Source key: `docs/strategy/gap-plan.md` §0. **All targets are TARGETS until
validated with resort finance and partners.** Owner question: Q104 (agent or principal, tax and invoice presentation).

## 1. Current state (evidence)

- **No `concessions` code exists.** Related: platform outlets with legal entity per outlet and kinds such as dive centre,
  water sports, boutique (identity-plus branch); finance routing, charge codes and receivables (README-finance).
- **No parity file**; no competitor research on concession settlements.

## 2. Best on the market today

No evidence in our research. Resorts commonly run dive centres, spas, boutiques and photo studios through partner
companies whose services are signed to the villa bill (spec §1, assumption to confirm in discovery — Q64).

## 3. Gaps vs market (ranked)

| # | Gap | Spec |
|---|---|---|
| 1 | Concessionaire and immutable versioned agreements (commission, fees, settlement terms) | CNC-R01, R02 |
| 2 | Room charges on behalf of partners with correct principal/agent tax presentation | CNC-R03; Q104 |
| 3 | Declared direct sales (partner's own terminal) | CNC-R04 |
| 4 | Settlement calculation per period, outputs on approval (statement, AP/AR entries) | CNC-R05, R06 |
| 5 | Late charges, refunds and adjustments after settlement roll forward | CNC-R07 |
| 6 | KPIs and principal model | CNC-R08, R09 |

## 4. The 10x outcome (TARGETS)

**Picture:** at month end the dive centre's statement — what the resort collected on its behalf, less commission and
fees — is produced in one approval, ties to the folios, and late refunds roll into next month instead of reopening the
last one.

| Dimension | Metric | Target |
|---|---|---|
| Powerful | Settlements that do not tie to folio postings | 0 |
| Seamless | Month-end settlement per partner | ≤ 10 min review and approval |
| Well-rounded | Tax presentation per agreement model (agent/principal) | per Q104 answer; default shown as pending |

## 5. Next 3 increments

### Increment 0 — Evidence
Confirm partner arrangements with one resort (Q64) and write the parity file.

### Increment 1 — Agreements and charges on behalf
- CNC-R01–R03 with finance charge codes per concession and the outlet's legal entity; principal/agent flag driving tax
  presentation as configuration (default per Q104).
- **Acceptance:** CNC-R01–R03 tested; charges on behalf appear correctly on folios and in the partner ledger.

### Increment 2 — Settlement
- CNC-R04–R07: declared sales, period settlement, approval outputs (statement, payable/receivable entries via
  accounting/finance), roll-forward of late items.
- **Acceptance:** settlement ties to postings in tests; late refund after settlement rolls forward.

### Increment 3 — KPIs and resort integration
- CNC-R08, R09; activities run by partners linked to resort itineraries.
- **Acceptance:** KPIs drill to postings.

## 6. Cross-module dependencies and contract changes

**finance:** charge codes, receivables/payables, statements. **accounting:** payables and recharge invoices
(PAR-ACC-126). **resort:** activities by partners. **platform:** outlets per legal entity. **fnb-pos:** partner outlets
with their own POS (intake).

## 7. Power check — never lose or hide

Money collected on behalf of a partner stays traceable to each folio line; agreements are versioned and snapshotted;
no tax conclusion is hard-coded (Q104).
