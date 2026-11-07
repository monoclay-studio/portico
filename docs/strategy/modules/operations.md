# operations — 10x brief

Status: v1 · 2026-11-07 · Gap strategist · Built (wave 1, R3) · Spec `docs/specs/operations.md` · Parity: draft on
`docs/parity-ops` (`docs/parity/operations.md`, not on `main`) · Source key: `docs/strategy/gap-plan.md` §0. **All
targets are TARGETS until validated with hotel staff.**

## 1. Current state (evidence)

- **Built, R3** (README-operations § Capabilities): unit condition separate from occupancy with append-only history,
  discrepancies (skip/sleep) → front-office task, DND with welfare check, readiness with **estimated** ready time and
  explanation, day plan (departure/stayover/turndown/vacant/arrival inspection) with credits, priority scoring (guest
  waiting, ETA, VIP), assignment suggestions balancing credits by section/island zone, attendant API, inspections with
  checklist reasons and photos, supervisor board, tasks with escalation steps, service requests fulfilled only when the
  task is done, work orders with OOO/OOS through inventory and resolution items, return-to-sale gates, assets and
  preventive schedules, lost & found, **offline sync** with mutation-id dedupe and explicit conflicts. ≈ 114 tests;
  InventoryPort bound to the real inventory.
- **Review:** 2 P0 (S13 overwrite; `/sync/mutations` unauthorized) and P1-1…P1-9 fixed; P1-5/6/8 deferred with
  reasons (REV-operations; README § Review fixes).
- **Standalone next to an external PMS is not end to end (R1):** no inbound stay contract (checkout → dirty →
  departure clean), CR-6 room-status direction rules not built, forward delivery is integration's job (README §
  Adoption modes). This is the flagship "replace selected capabilities" path.
- **Parity (draft):** 39 P0 rows specified, 21 P1 missing (bulk condition change, person discrepancy, vacant decay,
  guest-preferred cleaning time, labour forecast, attendant profiles with skills, regeneration preserving manual work,
  guest notified when ready, composite cleaning, paper fallback, **staff app in attendants' languages**, public areas,
  recurring tasks, request catalogue, complaints with compensation, trade/skill assignment, bulk OOO by location,
  guest lost-item inquiries, high-value chain of custody, luggage); EC-OPS-008, 009, 021 P0 missing.
- **Not built:** minibar posting, "service later at HH:MM", forward plan for tomorrow, sampled inspections, stayover
  frequency policy, `listExceptions` (README § Known gaps).
- **UX1 (simulated UI):** a dirty room offers no Start/Mark clean; no assign attendants (blocker), no DND action, no
  lost & found, attendants see all 120 villas with no "my rooms"; tablet layout overflows 111 px; board lacks an
  "estimate after arrival" warning (UX1 persona 4).

## 2. Best on the market today

| Area | Who does it best | How | Source |
|---|---|---|---|
| Mobile housekeeping loop | Stayntouch | Touch list, auto assignment by floor/section, forward assignment for tomorrow, points coverage, priority cleaning linked to early check-in upsell | R02 §4.3, §4.5 |
| Service orders | OPERA 26.4 Service Order Management | One workflow for guest and internal requests; skills, resource groups, auto follow-up tasks, grid/board, mobile photos | DD02a §1.2; DG #13 |
| Task sheets | OPERA 25.3 | Task sheet completion, housekeeping task-sheet APIs | DD02a §1.2 |
| Housekeeping inside the PMS | Mews + Flexkeeping (acquired Sep 2025) | Housekeeping and task automation absorbed | DD02c §5 |
| Status-to-task automation | Mews | Exceptions become tasks | R02 §2.7 |
| Guest-chosen cleaning windows | The Hotel Communication Network | **Patented** (US 12,586,008; 12,265,929) | DD04 P5–P6 |

Context: housekeeping is the top staffing shortage (58%, AHLA, US) (DD02c §5; DD03 §3).

## 3. Gaps vs market (ranked)

| # | Gap | Why it matters | Parity rows / edge cases (draft ids) |
|---|---|---|---|
| 1 | Staff PWA (apps/staff) on top of the sync API: my rooms, start/done, DND, inspect with reason/photo, lost & found | Housekeeping cannot do housekeeping (UX1 blocker) | OPS-R08, R21–R23; UX1 top-20 #4 |
| 2 | Standalone loop next to an external PMS (inbound stays, CR-6, forward delivery) | Adoption path "replace housekeeping" | PAR-OPS-086 (partial); README § Adoption modes |
| 3 | Planning depth: forward plan for tomorrow, attendant profiles (section, shift, max credits, skills), labour forecast 7–14 days, regeneration preserving manual changes, stayover frequency | Supervisor ≤ 5 min target | PAR-OPS-023, 025, 028; EC-OPS-046, 048 |
| 4 | Service orders like OPERA 26.4: request catalogue, skills/trades, follow-ups, board, recurring/future tasks, public areas | Market just moved | PAR-OPS-049, 054, 057, 065 |
| 5 | Resort-scale events: storm closes a jetty (30 villas), resort-wide power/desalination outage, bulk OOO by location | Maldives | PAR-OPS-068; EC-OPS-024, 025 |
| 6 | Device realities: clock 3 h wrong, two devices, suspended mid-shift with queued actions, photo on 2G | Offline honesty | EC-OPS-006, 007, 040, 042 |
| 7 | Day Close interplay: checkout at 23:58, Day Close re-run | Consistency with business date | EC-OPS-008, 009 |
| 8 | Complaints / service recovery with compensation (links to finance) and guest lost-item inquiries; high-value chain of custody | Guest recovery | PAR-OPS-059, 079, 080; EC-OPS-036, 037 |
| 9 | Staff languages, paper fallback task sheets | Expatriate attendants; outages | PAR-OPS-035, 043; Q155 |
| 10 | Guest notified when the unit is ready; waiting-guest auto check-in prompt | Arrival experience | PAR-OPS-032; PAR-RES-072, 117 |

## 4. The 10x outcome (TARGETS)

**Picture:** at 18:00 the supervisor drags tomorrow's plan into shape on a tablet in under five minutes; at 11:40 a VIP
villa fails inspection and the desk, the attendant and the butler know before the seaplane lands, with the next-best
ready villa offered; an attendant on a water-villa jetty with no signal marks five rooms clean and nothing is lost or
silently overwritten when she reconnects.

| Dimension | Metric | Today | Market reference | Target |
|---|---|---|---|---|
| Powerful | P0 rows + P0 edge cases tested (once the file is on `main`) | ~21 rows evidenced (README § Parity rows) | — | 100% |
| Powerful | Rooms ready before guest ETA on arrival days | not measured | baseline to measure | ≥ 95% (pilot measure) |
| Seamless | Update unit condition (attendant, mobile) | API only | Stayntouch touch list (R02 §4.3) | ≤ 3 s, ≤ 2 taps (UXP §19) |
| Seamless | Assign tomorrow's housekeeping, 40 units | API only | baseline to measure | ≤ 5 min, 0 unassigned departures (UXP §19) |
| Seamless | Report a fault with photo | API only | OPERA mobile photos (DD02a §1.2) | ≤ 30 s, ≤ 3 taps + photo (UXP §19) |
| Friendly | Attendant training to independence | — | — | ≤ 30 min, in her own language where Q155 allows |
| Well-rounded | Offline: work lost or silently overwritten during a 4-hour outage | 0 in S13 tests | — | 0 with real devices and clocks (EC-OPS-006/007) |
| Well-rounded | Standalone next to OPERA/Mews/CSV PMS: checkout → dirty → clean → ready back in the PMS | R1 | Flexkeeping-style add-ons (DD02c §5) | end to end with the PMS simulator, then a real connector |

## 5. Next 3 increments

### Increment 1 — Parity on `main` and the standalone loop
- Bring the draft parity file to `main` (with the parity workstream) and mark tested rows; implement the inbound stay
  contract (`upsertStayProjection` + checkout effects with source revision and freshness → `delayed` provenance) and
  CR-6 direction rules (discrepancy for "more ready", task for "less ready", re-send Portico's value); CR-2 forward
  timeout → pending verification; `listExceptions` in the common shape.
- **Acceptance:** with `pms.simulator`, a checkout in the external PMS produces dirty → departure clean → inspected →
  ready forwarded and acknowledged (A03 evidence); EC-OPS-021 tested; PAR-OPS-086 → tested.

### Increment 2 — Supervisor planning
- Attendant profiles (section, shift, max credits, skills), forward plan for tomorrow, regeneration that preserves
  manual changes and completed work, labour forecast 7–14 days from on-the-books arrivals/departures, stayover frequency
  policy, "estimate after arrival" warnings, bulk condition change, bulk OOO by location with one preview (inventory
  increment 3).
- **Acceptance:** PAR-OPS-006, 023, 025, 028, 068 and EC-OPS-024, 043, 046, 048 tested; assign-40-units flow runnable
  through the API in ≤ 10 calls.

### Increment 3 — Service orders and recovery
- Request catalogue with default department/SLA, skills/trades on work orders, follow-up tasks, recurring and
  future-dated tasks, public-area rounds, complaints with compensation via a finance port (adjustment with reason),
  guest lost-item inquiries matched to the found log, high-value chain of custody; "service later at HH:MM" (staff
  entered — **no guest-chosen windows**, Q150).
- **Acceptance:** PAR-OPS-049, 054, 057, 059, 065, 079, 080 and EC-OPS-033, 035, 036, 037 tested.

The staff PWA itself is built by the backoffice/app workstream against these APIs (see `modules/backoffice.md`).

## 6. Cross-module dependencies and contract changes

- **integration:** inbound stay handler and forward delivery with acknowledgement. **inventory:** multi-unit block
  preview; drop permission re-check (ADR-0015). **reservations:** `aggregateVersion` on stay events, `stays[]` in
  booking events (PF); guest-ready notification; waiting-guest flag. **finance:** compensation adjustments; minibar
  posting. **comms:** guest-ready message; staff notifications. **guest-services:** cases and amenity orders reuse tasks.
  **workforce:** attendant shifts and skills (later). **day-close:** exceptions; checkout-at-23:58 rule.
  **access:** room status from lock events (later).
- Decision needed: composite units in operations' unit mirror (PF; review P1-8).

## 7. Power check — never lose or hide

Condition, occupancy and availability stay separate; offline changes are never silently overwritten — conflicts are
explicit; return to sale requires repair completion and passed inspection where policy says so; a service request is
fulfilled only when its task is done; escalations fire once per step; supervisor overrides need a reason; data authority
for room status and maintenance is respected (forward or refuse, never write behind the external system's back).
