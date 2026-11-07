# analytics — 10x brief (numbers you can trust)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 2f) · Spec `docs/specs/analytics.md` (ANL-R01–R10) ·
Parity `docs/parity/analytics.md` · Source key: `docs/strategy/gap-plan.md` §0. **All targets are TARGETS until
validated with hotel staff.**

## 1. Current state (evidence)

- **No `analytics` module exists.** Finance ships trial balance, daily revenue by charge code with restatements, Green
  Tax monthly projection, aging and integrity reports (README-finance R42–R45); inventory exposes an availability grid
  with explanations; integration measures mapping suggestion accuracy. The Day Close statistics snapshot (DCL-R02 step 7)
  that analytics consumes is unbuilt.
- **Parity:** 49 rows / 30 edge cases; 0% tested; 36 P0 open; P1 missing: package/meal forecast for kitchens,
  profile/company production statistics, in-house rate check, copy report configuration across properties, reports
  API; EC-ANL-010 (scheduled email bounces), 011 (report during Day Close), 014 (CSV leading zeros/MVR decimals).
- **UX1:** Today KPIs are simulated and disagree with Arrivals (9 vs 7 ready); the "payments pending verification"
  totals match nothing visible; group director cannot compare properties (persona 7).

## 2. Best on the market today

| Area | Who | How | Source |
|---|---|---|---|
| Report catalogue | OPERA (R&A, manager's report, scheduled reports) | Broad catalogue; R&A Data Access sold as a separate SKU | PAR-ANL baseline; DD02a §1.4 |
| BI bundled | Mews BI (15 Apr 2026) | Bundled for Analytics/Enterprise customers — a direct answer to reporting complaints | DD02b §1.2 |
| Conversational analytics | Cloudbeds Ask Signals (pilot, May 2026) | Natural-language questions over reservations, revenue, channels | DD02b §3 |
| As-of reporting gap | Stayntouch | Cannot run some reports "as of" a past date without scheduling | R02 §4.4 |
| Accounting standard | USALI 12th (effective 1 Jan 2026) | Sustainability lines, fee reporting, all-inclusive guidance | DG #42; DD03 §9 |

Reporting is the most repeated complaint against modern PMSs (R02 §8 item 4).

## 3. Gaps vs market (ranked)

| # | Gap | Spec / parity |
|---|---|---|
| 1 | Metric catalog with definition, formula, period semantics, currency treatment, source, version | ANL-R01; PAR-ANL-001 |
| 2 | Daily facts from the Day Close snapshot + real-time "today" facts from events | ANL-R02; DCL-R02 step 7 |
| 3 | Drill-down from any figure to the records behind it | ANL-R03 |
| 4 | As-of vs restated views with an explanation of every restatement | ANL-R04 |
| 5 | Standard report catalogue for every edition (desk, HK, finance, revenue, GM, group) | ANL-R05 |
| 6 | Data-quality checks with counts and fix links; integration health reporting | ANL-R06 |
| 7 | Portfolio consolidation with currency treatment | ANL-R08 |
| 8 | External comparison (Portico vs the hotel's current system — adoption brief §4) and migration correctness dashboard | ANL-R10; gap plan M8, M14 |
| 9 | Kitchen/transfer forecasts from packages and meal plans; production statistics per company/agent | PAR-ANL-025, 027 |
| 10 | Reports API, warehouse sync, scheduled exports; USALI 12 mapping | ANL-R09; PAR-ANL-062 |

## 4. The 10x outcome (TARGETS)

**Picture:** the GM taps "RevPAR 412" and sees its definition, the period, the currency treatment and the stays and
postings behind it; last month's report still reads the same after a correction, with a note explaining the
restatement; the group director compares three islands side by side; and a trial hotel sees Portico's numbers next to
its old system's with each difference listed.

| Dimension | Metric | Market reference | Target |
|---|---|---|---|
| Powerful | Figures without a definition, period, currency treatment and source | reporting complaints (R02 §8) | 0 |
| Powerful | Figures that do not drill to records | — | 0; ≤ 2 clicks to records |
| Powerful | Report totals vs ledger (revenue, taxes, deposits, AR) | — | 0 unexplained differences, daily |
| Seamless | Same KPI shown differently on two screens | UX1 (9 vs 7 ready) | 0 (one metric service) |
| Friendly | Standard reports per role available on day one, every edition | Mews BI bundled only in higher tiers (DD02b §1.2) | 100% of the catalogue in every edition |
| Well-rounded | Restatements explained | Stayntouch lacks as-of (R02 §4.4) | as-of and restated for every daily report |
| Performance | Report load | — | ≤ 1 s p95 for a property-month |

## 5. Next 3 increments

### Increment 1 — Metric catalog and daily facts
- Catalog (definitions as data, versioned), fact tables per property and business date fed by the Day Close snapshot and
  by events for "today", one metric service used by every dashboard tile (fixes contradictory counts), core rooms and
  revenue metrics (available, sold, OOO, comp, house use, occupancy, ADR, RevPAR, TRevPAR, revenue by department/charge
  code/segment/source/channel, guests and guest-nights by nationality for tourism statistics).
- **Acceptance:** ANL-R01, R02 tested; facts reconcile to finance's daily revenue and the trial balance on the scenario
  suite; Today and Arrivals counts come from the same service.

### Increment 2 — Drill-down, as-of vs restated, data quality
- Drill-down to records (respecting permissions), restatement annex from finance corrections, data-quality checks with
  fix links (stays without segment, unmapped codes, missing nationality, unverified payments), CSV/XLSX export safe for
  leading zeros and decimals.
- **Acceptance:** ANL-R03, R04, R06 and EC-ANL-011, 014 tested.

### Increment 3 — Catalogue, portfolio and external comparison
- Standard report catalogue per role and edition; scheduled delivery via comms (bounce handling); portfolio
  consolidation; kitchen/transfer forecast; company/agent production; external comparison and migration correctness
  dashboard reading integration's reconciliation; reports API.
- **Acceptance:** ANL-R05, R08, R10 and PAR-ANL-025, 027, 062, EC-ANL-010 tested.

## 6. Cross-module dependencies and contract changes

**day-close:** statistics snapshot. **finance:** postings, restatements, ledger reconciliation. **reservations,
inventory, operations, payments, distribution, comms:** events with versions and record links for drill-down.
**integration/migration:** reconciliation results, warehouse sync. **platform:** portfolio structure, currency.
**ai:** natural-language questions only over governed metrics (definitions cited). **accounting:** USALI 12 mapping.

## 7. Power check — never lose or hide

Every number has a definition and a source; historical reports never change silently; drill-down respects permissions;
data problems are visible, not smoothed over; estimates and forecasts are labelled as such.
