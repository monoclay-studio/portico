# workforce — 10x brief (rosters, time, staff village, certifications, service charge)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 4, BOH-4) · Spec `docs/specs/workforce.md` (WFM-R01–R28) ·
Parity: **none** · Source key: `docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated with HR and
department heads.** Owner questions: Q101 payroll boundary, Q102 pay data in Portico, Q103 service-charge distribution.

## 1. Current state (evidence)

- **No `workforce` code exists.** Related: identity staff members (distinct from employees, WFM-R02), operations'
  attendant workload credits and section assignment (README-operations OPS-R05–R07), finance service-charge postings.
- **No parity file** — no competitor baseline is recorded.
- **Maldives context:** a 120-villa resort employs several hundred people, many expatriates living on the island,
  sharing in the service charge (spec §1).

## 2. Best on the market today (what our research has)

| Area | Evidence | Source |
|---|---|---|
| Staff shortage | Housekeeping is the top staffing need (58%, AHLA US survey) | DD03 §3; DD02c §5 |
| Technostress | Role ambiguity amplifies technostress; AI job insecurity raises turnover intention | DD03 §3; DG #41 |
| PMS usability and retention | 38% say PMS usability influenced leaving a job (sponsored) | DD03 §2.2 |

**Gap in our research:** no workforce-management vendor (rostering, time and attendance) was profiled. Write the parity
file before building (increment 0).

## 3. Gaps vs market (ranked)

| # | Gap | Spec |
|---|---|---|
| 1 | Employee records linked to identity; positions; labour standards per department/task | WFM-R01–R04 |
| 2 | Rosters from forecast with rule checks; publish to the staff app; resort staffing link | WFM-R05–R07 |
| 3 | Punches from the staff app, timesheets, days-worked ledger (input to service charge) | WFM-R08–R10 |
| 4 | Service-charge distribution runs with evidence pack and journal | WFM-R21–R24; Q103 |
| 5 | Leave as rule-pack data; expatriate entitlements | WFM-R11, R12 |
| 6 | Staff village (never accommodation inventory), canteen | WFM-R13–R15 |
| 7 | Certifications, training, work permits per employer legal entity | WFM-R16–R20 |
| 8 | Payroll input export (computation stays a boundary — Q101) | WFM-R25–R27 |
| 9 | Productivity KPIs (hours per occupied room) | WFM-R28 |

## 4. The 10x outcome (TARGETS)

**Picture:** next week's housekeeping roster is generated from on-the-books departures and stayovers, checked against
rules, and published to staff phones; the service-charge run at month end is reproducible to the cent with its evidence
pack; and nobody's role is ambiguous because every task in Portico has an owner.

| Dimension | Metric | Target |
|---|---|---|
| Powerful | Service-charge runs reproducible from their evidence pack | 100% |
| Seamless | Weekly roster for a department from forecast | ≤ 15 min supervisor time |
| Friendly | Staff who can see their roster and punches on their own phone | 100% of rostered staff |
| Well-rounded | Payroll provider export accepted without manual edits | target per provider once Q101 is answered |

## 5. Next 3 increments

### Increment 0 — Evidence
Write `docs/parity/workforce.md` (rostering, time and attendance, hospitality HR references) with the parity workstream.

### Increment 1 — Employees, labour standards, rosters
- WFM-R01–R07: employee records, identity link, positions, labour standards, roster builder with rule checks from a rule
  pack, publish via comms/staff app, staffing link from operations' labour forecast (PAR-OPS-023).
- **Acceptance:** WFM-R01–R07 tested; rule violations explained per shift.

### Increment 2 — Time and the days-worked ledger
- Punches from the staff app with device PIN, timesheets per pay period, days-worked ledger, leave as rule-pack data.
- **Acceptance:** WFM-R08–R11 tested; offline punches sync without loss.

### Increment 3 — Service charge distribution
- Distribution runs per scope with lifecycle `draft → calculated → reviewed → approved`, evidence pack, journal through
  finance; payroll input export.
- **Acceptance:** WFM-R21–R26 tested; a run recalculates identically from its evidence pack.

## 6. Cross-module dependencies and contract changes

**identity:** employee ↔ staff link; pay data restrictions (Q102). **operations:** labour forecast, attendant shifts and
skills. **finance/accounting:** service-charge and payroll journals. **comms/staff app:** roster publication. **platform:**
departments, legal entities. **analytics:** productivity KPIs.

## 7. Power check — never lose or hide

Staff housing is never accommodation inventory; pay computation stays a boundary unless the owner decides otherwise
(Q101); service-charge runs are reproducible and approved by people; personal data is minimal and restricted.
