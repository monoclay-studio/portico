# inventory — 10x brief

Status: v1 · 2026-11-07 · Gap strategist · Built (wave 1, R3) · Spec `docs/specs/inventory.md` · Parity
`docs/parity/inventory.md` · Source key: `docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated
with hotel staff.**

## 1. Current state (evidence)

- **Built, R3** (README-inventory § Capabilities): unit types (room/villa/bed/tent/pitch…), units, features, composite
  units with exact component availability, availability ledger with all-or-nothing `consume`, holds with sweeper,
  assignments under exclusion constraints, unit blocks (OOO/OOS/house use) with previews and conflicts, authorized
  overbooking (standing + ad hoc), `explainAvailability` with sentences, 731-night grid, strongly consistent reads,
  universal record contract, Maldives demo inventory (R2). ≈ 96 tests incl. real interleaved S01 races.
- **Steward review:** release-side ledger corruption found (7 of 8 counterexamples reproduced) and fixed with
  regression tests CE1/CE1b/CE2/CE5/CE6 (REV-inventory; README § Capabilities).
- **Parity:** 69 rows / 34 edge cases; report shows **1% tested, 53 P0 open — stale**: the README lists ~40 rows and
  17 edge cases proven by tests (README § Competitive parity status). Genuinely open P0: PAR-INV-041 unassign;
  EC-INV-008 (hold expires as the guest presses Book), EC-INV-020 (type oversold, house positive).
- **Known gaps:** effective-dated re-typing (R03), auto-assign (R23), extend/shorten a block in place, multi-unit block
  with one preview, localized type names, approval-based overbooking, separate block-release permission, forward mode
  refused until integration forwarding exists (README § Known gaps). Pending: stop re-checking `inventory.block.manage`
  on port calls (ADR-0015, PF).
- **UX1:** the Timeline "uses 1920 px well" but has no unit-type filter, no free-count row per type, no "find free
  villa for dates", no jump-to-date; availability counts appear only inside the extend preview (UX1 persona 3).

## 2. Best on the market today

| Area | Who does it best | How | Source |
|---|---|---|---|
| Flexible inventory models | RMS Cloud | Category/area inventory with typed constraints and explanations for visible-but-unbookable inventory | R03 §7.2 |
| Linked inventory | Cloudbeds | Dorm beds and private rooms on one inventory (with trade-offs) | R03 §3.2 |
| Explaining sell limits | Mews (2026) | Sell-limit state per rate/category/time unit with sold/available | DD02b §1.3; DG #17 note |
| Assignment control | Mews | Locked vs unlocked assignment respected by optimisation | R02 §2.7 |
| AI room assignment | Oracle (OPERA Cloud Assistant, AI Room Search with reason text) | Features extracted from notes with an explanation | DD02a §1.3 — **patented approach** (DD04 P1) |
| Scheduled moves | OPERA | Room moves scheduled for later today after cleaning | PAR-RES-066 (cited there) |
| Group/allotment inventory | OPERA | Block inventory deducts from block, not house; elastic blocks with sell limits | R01 §3.5 |

## 3. Gaps vs market (ranked)

| # | Gap | Why it matters | Parity rows / edge cases |
|---|---|---|---|
| 1 | Parity file not reconciled with tests | Baseline unusable | all PAR-INV/EC-INV rows the README cites |
| 2 | Unassign; atomic swap of two stays' units; unit hold for minutes while assigning | Desk rooming at 07:30 | PAR-INV-041, 045, 039; EC-INV-012, 034 |
| 3 | Assignment suggestions at scale (rule-based auto-assign, forward assignment for tomorrow) | OPERA/Stayntouch have it; housekeeping lead time | INV-R23; R02 §4.5 |
| 4 | Sellable vs physical availability (published never negative, house-level allowance, hold-back) | Distribution needs it (wave 2) | PAR-INV-024, 026, 028; EC-INV-020 |
| 5 | Item inventory (cots, extra beds, rollaways) | Families; Maldives villas | PAR-INV-031; EC-INV-030 |
| 6 | Bed configuration and connecting pairs | Family assignment without composites | PAR-INV-006, 009 |
| 7 | Multi-unit blocks by location (whole jetty) with one preview; block extend/shorten in place | Storms, renovations | PAR-INV-052 (deferred); EC-INV-032; ops PAR-OPS-068 (draft) |
| 8 | Re-typing a unit with effective date | Renovations convert villas | PAR-INV-010; EC-INV-014 |
| 9 | Availability "what-if" including tentative business; sister-property availability | Sales and groups | PAR-INV-034, 030 |
| 10 | Bulk unit import at setup; reason codes | Onboarding speed | PAR-INV-015, 016 |

## 4. The 10x outcome (TARGETS)

**Picture:** every availability number anywhere in Portico can be clicked to a plain sentence with the records behind
it, the last villa is sold exactly once across desk, booking engine and channels, and a supervisor can see by 18:00
which villa each of tomorrow's arrivals will get — with reasons a human can override.

| Dimension | Metric | Today | Market reference | Target |
|---|---|---|---|---|
| Powerful | P0 rows + P0 edge cases tested | stale (≈ 60% true, estimate from README) | — | 100% |
| Powerful | Oversell without a conflict record under concurrency (10/50-agent races, sweeper down) | 0 in tests | — | 0, also with the booking engine and channels attached |
| Seamless | Assign tomorrow's arrivals (40 units) with suggestions | not built | baseline to measure | ≤ 2 min supervisor attention; ≥ 80% suggestions accepted unchanged |
| Seamless | Answer "why is this type closed on 14 Feb?" | API only | Mews sell-limit state (DD02b §1.3) | 1 click from any grid cell, ≤ 2 s |
| Seamless | Find a free villa of a type for given dates | not available in UI | baseline to measure | ≤ 3 interactions from the Timeline |
| Friendly | Grid availability numbers without an explanation | 0 via API; UI none | — | 0 |
| Well-rounded | Edge cases handled | ≈ 17/34 tested (README) | — | 34/34 |
| Well-rounded | Unit kinds proven with demo data | rooms, villas, residences, apartments | RMS park/apartment flexibility (R03 §7.2) | + dorm beds, safari-vessel cabins (moving inventory, DD09 §2) |
| Performance | Availability grid read | not measured | — | ≤ 1 s p95 for 400 units × 31 nights (UXP §19) |

## 5. Next 3 increments

### Increment 1 — Reconcile, finish the desk primitives
- Reconcile `docs/parity/inventory.md` with tests (README list). Build `unassignUnit`, atomic `swapAssignments`
  (no intermediate unassigned state), short **assignment holds** (unit hold for N minutes per user), refusal naming the
  component's stay (EC-INV-010). Drop the permission re-check on port calls (ADR-0015) and remove operations' system
  scope workaround.
- **Acceptance:** PAR-INV-039, 041, 045 and EC-INV-008, 010, 012, 034 tested; parity report shows the reconciled share;
  operations' composition adapter no longer uses system scope.

### Increment 2 — Assignment suggestions (rule-based, explainable, pluggable)
- `suggestAssignments(propertyId, date range)`: rule-based scoring (requested features, accessibility protection,
  composite fit, VIP/loyalty preference, housekeeping readiness by ETA, keep locked assignments), each suggestion with
  reasons; batch apply with preview; forward assignment for tomorrow's arrivals; never locks the calendar; scoring
  engine behind a port so it can be replaced. **No cost-matrix/Hungarian optimisation** until counsel answers Q145.
- **Acceptance:** S07 path uses suggestions to re-room a failed-inspection arrival (alternatives ranked with reasons);
  ≥ 80% acceptance target instrumented; documented design rationale in the spec (Q145).

### Increment 3 — Sellable availability for distribution
- Sellable vs physical view (published never negative), house-level overbooking allowance, internal hold-back per type,
  item inventory (cots/extra beds) consumed by stays, multi-unit block by location with one preview, block extend/
  shorten in place.
- **Acceptance:** PAR-INV-024, 026, 028, 031, 052 and EC-INV-016, 017, 020, 030, 032 tested; distribution's spec
  (DST-R03/R04) can read `sellable` per channel pool without new inventory calls.

## 6. Cross-module dependencies and contract changes

- **reservations:** assignment suggestions in the arrival flow; swap and unassign commands; composite `assignedUnitId`.
- **operations:** readiness estimates feed suggestion scoring; storm/jetty blocks via multi-unit preview; work-order
  blocks released only by the owning module (PF).
- **distribution:** `sellable` read model per channel pool; availability events with ranges (PF note on `range` shape).
- **groups:** block inventory (deduct from block, elastic sell limits) — define `consume` with `poolRef`.
- **New contract:** `suggestAssignments`, `swapAssignments`, `holdUnit/releaseUnitHold`, `getSellable(poolRef)`;
  item inventory resources (`kind: item`).

## 7. Power check — never lose or hide

Strong consistency for the last unit; all-or-nothing multi-night consumption; out of order never refused on sold-out
nights (it creates conflicts instead); every number explainable; locked assignments respected by any automation;
authorized overbooking always labelled and distinguishable from accidental conflict (brief §4); no automation that
locks the calendar for other users.
