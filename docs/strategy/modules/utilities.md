# utilities — 10x brief (power, water, waste and sustainability for island resorts)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 4, BOH-5) · Spec `docs/specs/utilities.md` (UTL-R01–R10) ·
Parity: **none** · Source key: `docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated with resort
engineering.**

## 1. Current state (evidence)

- **No `utilities` code exists.** Related: operations assets and preventive schedules (README-operations OPS-R19);
  Day Close statistics snapshot (planned) for normalization by occupied rooms and guest-nights.
- **No parity file.**
- **Context:** Maldivian resorts run predominantly on diesel — **33.2 L per bed-night on average, 46–130 L per room-day**,
  298 MW of resort diesel capacity; fuel-price shocks in 2026 flow straight into cost per occupied room (DD09 §5; DD03 §9).
  **USALI 12th** (from 1 Jan 2026) adds sustainability categories (DG #42).

## 2. Best on the market today

No PMS vendor in our research ships per-guest-night diesel/water KPIs; peer-reviewed Maldives resort energy studies were
not found (DD03 §9). Research reading: per-occupied-room and per-guest-night utility KPIs aligned to USALI 12
sustainability lines are a credible Maldives differentiator (DD03 §9; DG §2 procurement/stock row).

## 3. Gaps vs market (ranked)

| # | Gap | Spec |
|---|---|---|
| 1 | Meter registry, readings (manual on mobile, offline), plant logs (generators, RO plants) | UTL-R01–R03 |
| 2 | Normalized KPIs using Day Close and workforce facts (L diesel per guest-night, kWh and water per occupied room) | UTL-R05 |
| 3 | Alerts with owners (consumption anomalies, plant faults) | UTL-R08 |
| 4 | Waste tracking; emissions | UTL-R04, R06 |
| 5 | Cost pools and allocation to departments/outlets/concessions | UTL-R07 |
| 6 | Sustainability reporting pack (USALI 12 lines) | UTL-R09 |
| 7 | Demand and solar optimization suggestions (AI proposals, never actions) | UTL-R10 (LATER) |

## 4. The 10x outcome (TARGETS)

**Picture:** the chief engineer logs generator and RO readings on a phone at the plant, offline; the GM sees diesel per
guest-night against last month and the fuel price, with an alert when a generator's consumption drifts — and the
sustainability report for the owner is produced from the same data.

| Dimension | Metric | Target |
|---|---|---|
| Powerful | Utility KPIs normalized by occupancy available daily | 100% after each Day Close |
| Seamless | Daily plant readings round | ≤ 10 min on a phone, offline |
| Friendly | Anomalies without an owner | 0 |
| Well-rounded | USALI 12 sustainability lines in the report pack | covered (wording per Q105) |

## 5. Next 3 increments

### Increment 1 — Meters, readings, plant logs
- UTL-R01–R03 with mobile offline capture (operations' sync patterns) and links to operations assets.
- **Acceptance:** UTL-R01–R03 tested; readings reject impossible values with a reason.

### Increment 2 — Normalized KPIs and alerts
- UTL-R05, R08 using Day Close statistics and workforce facts; alerts as operations tasks.
- **Acceptance:** KPIs reconcile with readings and occupancy facts in tests.

### Increment 3 — Costs, emissions, reporting
- UTL-R04, R06, R07, R09: waste, emissions factors as data with citations, cost pools and allocation, sustainability pack.
- **Acceptance:** cost allocation ties to accounting; emission factors carry source and verification date.

## 6. Cross-module dependencies and contract changes

**day-close/analytics:** occupancy and guest-night facts. **operations:** assets, tasks. **stock/procurement:** fuel stores
and purchases. **accounting:** cost pools and recharges. **concessions:** utility recharges to partners.

## 7. Power check — never lose or hide

Readings are never overwritten (corrections are new entries); emission factors are data with citations, not constants;
AI suggestions never operate plant.
