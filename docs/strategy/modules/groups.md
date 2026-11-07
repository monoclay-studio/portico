# groups — 10x brief (blocks, allotments, sales & events, function space)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 2c) · Spec `docs/specs/groups.md` (GRP-R01–R12) · Parity
`docs/parity/groups.md` · Related: `modules/contracting.md` (tour-operator contracts) · Source key:
`docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated with hotel staff.**

## 1. Current state (evidence)

- **No `groups` module exists.** Foundations: inventory holds/consumption with refs (block pools not yet modelled —
  inventory brief §6), rates negotiated plans and restrictions, reservations' stays carry a nullable block reference
  (RES-R02), finance group folios and billing rules (FIN-R05, R13–R16).
- **Parity:** 80 rows / 32 edge cases; 0% tested; only 6 P0 (allotments and free sale: PAR-GRP-048–050, 052;
  EC-GRP-023, 024 — P0 because Maldivian resorts sell through tour-operator allotments), 41 P1 specified and 12 P1
  missing (shoulder dates, wash schedule, shift/copy block, tour series, bulk stay changes, bulk keys, mass check-in,
  remove a stay from a block, stop-sale notices with acknowledgement, space rental pricing) + 11 P1 edge cases missing
  (rolling cut-off, rooming list after cut-off, block cancelled with pickup, three seaplane waves, force majeure,
  shifted dates after pickup).
- **Scenario S11** (group reduces its block after the contractual deadline) has no test anywhere.

## 2. Best on the market today

| Area | Who | How | Source |
|---|---|---|---|
| Block status by type | OPERA | Status codes with types driving deduction (INQ/TEN/DEF/ACT/CAN/LOS/REF), status flow per property, reasons mandatory, "open for pickup" | R01 §3.4 |
| Grid mechanics | OPERA | Original/current/pickup grids, cut-off date vs days, elastic blocks with sell limits, rooming list deducts from block, posting master | R01 §3.5 |
| Async rooming lists | OHIP 24.1+ | Asynchronous rooming-list import | DD02a §1.4; DG §2 groups row |
| Group quotes | Mews (Quotelo acquisition) | Group quoting | DD02b §1.1 |
| Sales & catering | Amadeus Delphi (Accor premium/luxury); OPERA S&EM premium | Function space and events | DD02a §5, §1.5 |
| Blocks API | Apaleo, Mews availability blocks, Cloudbeds allotment blocks | Modern block APIs | PAR-GRP baseline (parity file header) |

Maldives specifics: weddings, incentive groups and tour series arrive in **seaplane waves**; tour operators dominate
contracted volume (contracting spec §1, assumption to confirm in Q64/Q121).

## 3. Gaps vs market (ranked)

| # | Gap | Parity / scenario |
|---|---|---|
| 1 | Allotments with release days, free sale until stop-sale, bookings beyond allotment | PAR-GRP-048–050, 052; EC-GRP-023–026 |
| 2 | Blocks with typed status flow, original/current/pickup grids, cut-off (date and rolling), pickup from reservations | GRP-R03–R06; EC-GRP-004 |
| 3 | Post-deadline grid changes with attrition per contract (S11) | GRP-R07; S11 |
| 4 | Rooming lists (async import, validation, after cut-off) | GRP-R08; EC-GRP-005 |
| 5 | Group billing: posting master, routing to group folio, attrition and deposits | GRP-R09 |
| 6 | Operational group days: bulk stay changes, bulk keys, mass check-in in waves | PAR-GRP-041–043; EC-GRP-027 |
| 7 | Block lifecycle tools: shift dates with preview, copy, tour series, wash schedule, shoulder dates | PAR-GRP-018, 021, 023–025; EC-GRP-029 |
| 8 | Function space and events with event orders visible to departments | GRP-R12; EC-GRP-018, 019 |
| 9 | Force majeure cancellation with per-stay policy | EC-GRP-028 |

## 4. The 10x outcome (TARGETS)

**Picture:** a sales manager builds a 30-villa × 5-night wedding block with rates in one grid, sees pickup live from the
rooming list, and when the planner cuts six villas after the deadline, the preview shows the attrition charge per the
contract, the released inventory and the billing effect before anyone confirms — and on arrival day the three seaplane
waves are checked in as three batches.

| Dimension | Metric | Market reference | Target |
|---|---|---|---|
| Powerful | P0 + P1 rows tested (groups is P1-heavy) | OPERA S&C depth (R01 §3.4–3.5) | 100% P0, ≥ 90% P1 |
| Seamless | Create a 30-room × 5-night block with rates | baseline to measure | ≤ 5 min, 0 grid errors, 1 grid editor (UXP §19) |
| Seamless | Import a 60-name rooming list with validation | OHIP async rooming lists (DD02a §1.4) | ≤ 3 min incl. fixing flagged rows |
| Seamless | Mass check-in of a group wave | — | 1 action per wave with per-stay results |
| Friendly | Grid change after deadline shows contract consequences before commit | — | 100% (attrition, release, billing, deposits) |
| Well-rounded | Edge cases handled | — | 100% P0, ≥ 90% P1 |

## 5. Next 3 increments

### Increment 1 — Allotments and blocks (inventory core)
- Block aggregate with typed status flow and reasons; grids (original/current/pickup) per unit type × night; block
  inventory pool in inventory (consume from pool, elastic sell limits); allotments per agency with release days and
  idempotent automatic release; free sale until stop-sale; bookings beyond allotment → owned exception.
- **Acceptance:** PAR-GRP-048–050, 052 and EC-GRP-023, 024, 025 tested; pickup is consistent with inventory under
  concurrency (S01-style race on the last block room).

### Increment 2 — Cut-off, changes after deadline, rooming lists, billing
- Cut-off by date and rolling days; S11 previewed reductions with attrition from the contract snapshot; async rooming
  list import with validation and after-cut-off handling; posting master and routing to the group folio; deposits via
  payments' collection plans.
- **Acceptance:** S11 through `apps/api`; EC-GRP-004, 005, 007, 009 tested; GRP-R05–R09 tested.

### Increment 3 — Group operations and lifecycle tools
- Bulk stay changes, bulk assignment and key packets, mass check-in by wave, remove a stay from a block, change type
  within the block; shift block dates with preview, copy block, tour series, wash schedule, shoulder dates; force
  majeure cancellation.
- **Acceptance:** PAR-GRP-018, 021, 023–025, 041–047 and EC-GRP-027, 028, 029 tested. Function space and events
  (GRP-R12) follow as increment 4 unless a pilot needs them first.

## 6. Cross-module dependencies and contract changes

**inventory:** block pools (`poolRef`), elastic limits, release. **reservations:** block-linked stays, mass check-in,
pickup events. **rates/contracting:** contract rate tables and attrition terms as snapshots. **finance:** posting master,
group folio routing, attrition charges. **payments:** group deposit plans. **access:** bulk key packets. **distribution:**
attendee booking codes; allotments via channels (EC-GRP-025). **comms:** stop-sale/release notices with acknowledgement
log (PAR-GRP-053). **analytics:** pickup, wash, attrition reports.

## 7. Power check — never lose or hide

Block inventory never double-counts against house inventory; cut-offs and releases are idempotent and visible; contract
terms are snapshotted; reductions after deadlines are previewed with their consequences; the posting master's charges
stay traceable to the group account.
