# stock — 10x brief (goods inventory for an island)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 4, BOH-3) · Spec `docs/specs/stock.md` (STK-R01–R23) ·
Parity `docs/parity/stock.md` · Source key: `docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated
with stores, F&B and engineering staff.**

## 1. Current state (evidence)

- **No `stock` code exists.** Related pieces: operations' minibar posting is a SHOULD not yet built (README-operations
  § Known gaps); fnb-pos sold-item facts (FNB-R27) and procurement receipts are planned; finance would carry valuation
  journals (STK-R10).
- **Parity:** 34 rows / 25 edge cases, 0% tested, **32 P0 open**; P1 missing: unit-of-measure conversion error (case of
  12 entered as each), weighted average cost at zero/negative on-hand, deleting a store that still holds stock. Baseline:
  Oracle F&B back-office inventory and Simphony inventory; OPERA consumable inventory (parity header).
- **Maldives context:** running out of drinking water, diesel or the house champagne is not an inconvenience when the next
  boat is days away (spec §1); diesel 33.2 L per bed-night (DD09 §5).

## 2. Best on the market today

| Area | Who | How | Source |
|---|---|---|---|
| Hotel F&B inventory | Oracle F&B back office / Simphony | Counts, transfers, recipes, production, yield, waste, stock on hand, forecast out-of-stock, POS-linked menu items | PAR-STK baseline |
| Par levels | Oracle | Par per item and store | PAR-STK-004 |
| Reservation item inventory | OPERA | Items (cots etc.) reserved with stays | PAR-STK baseline; inventory PAR-INV-031 |

Days-of-cover for critical island supplies (fuel, water, gas) with boat schedules is not documented for any competitor
(assumption — differentiator to validate).

## 3. Gaps vs market (ranked)

| # | Gap | Spec |
|---|---|---|
| 1 | Items, units with conversions, partial units for bar control; store tree per property | STK-R01–R04; EC-STK-018 |
| 2 | Movements (receive, issue, transfer, waste, adjust) incl. mobile/offline counts | STK-R05–R08 |
| 3 | Valuation per legal entity, valuation journals through finance, cost of sales per outlet | STK-R09–R11; EC-STK-021 |
| 4 | Recipes, menu costing, theoretical vs actual from POS sold items | STK-R12–R14 |
| 5 | Days of cover for critical items (fuel, water) and fuel tanks as stores | STK-R21, R23 |
| 6 | Reorder suggestions per store feeding procurement | STK-R20 |
| 7 | Amenities per unit type and occupancy, linen, minibar with replenishment routes | STK-R16–R19 |
| 8 | Beverage control, lots and expiry | STK-R15, R22 |

## 4. The 10x outcome (TARGETS)

**Picture:** the GM sees on Monday that diesel and drinking water cover 9 and 6 days against the next two boats, the
bar's pour cost variance is 3% with the bottles that explain it, and a minibar restock is a route on a phone, not a
clipboard.

| Dimension | Metric | Target |
|---|---|---|
| Powerful | Critical items without a days-of-cover figure | 0 |
| Powerful | Stock value vs ledger at month end | 0 unexplained differences |
| Seamless | Full store count on a phone (200 items, offline) | ≤ 30 min, synced without conflicts lost |
| Friendly | Theoretical vs actual variance explained by item | 100% of variance lines drill to movements |

## 5. Next 3 increments

### Increment 1 — Items, stores, movements, counts
- STK-R01–R08 with offline counts on the staff app (operations' sync patterns), unit conversions and partial units.
- **Acceptance:** STK-R01–R08 and EC-STK-018, 025 tested.

### Increment 2 — Valuation and critical cover
- Valuation methods and journals through finance, cost of sales per outlet, fuel tanks as stores, days of cover with
  consumption rates and supply schedules from procurement, reorder suggestions.
- **Acceptance:** STK-R09–R11, R20, R21, R23 and EC-STK-021 tested.

### Increment 3 — Recipes and minibar
- Recipes and menu costing, theoretical vs actual from fnb-pos sold items, amenities per unit type, linen, minibar with
  routes and posting to folios.
- **Acceptance:** STK-R12–R14, R16–R19 tested.

## 6. Cross-module dependencies and contract changes

**procurement:** receipts and landed cost. **fnb-pos:** sold-item facts. **finance:** valuation journals, minibar
postings. **operations:** minibar and amenity tasks; staff app offline sync. **utilities:** fuel and water consumption.
**analytics:** cost KPIs.

## 7. Power check — never lose or hide

Quantities and values always reconcile to movements; negative stock is visible and policy-controlled; counts never
overwrite movements silently; valuation method changes only from a period start.
