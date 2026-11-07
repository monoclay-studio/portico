# Gaps: front cluster (inventory, rates, reservations, groups, distribution, platform)

Status: v1 · 2026-11-07 · Source matrices: `inventory.md`, `rates.md`, `reservations.md`, `groups.md`,
`distribution.md`, `platform.md` in this folder. This file lists every `missing` **P0/P1** capability row
(`PAR-…`) and edge case (`EC-…`) as **spec change requests**: what to add, to which spec section. It contains no
matrix tables, so `tools/parity-report.mjs` reports it with zero rows.

## Summary

| Module | Capabilities (P0 / P1 / P2) | Missing capabilities (P0 / P1) | Edge cases | Missing edge cases (P0 / P1) | Tested on `main` |
|---|---|---|---|---|---|
| inventory | 69 (36 / 27 / 6) | 19 (1 / 13) | 34 | 8 (2 / 6) | none (no module) |
| rates | 87 (48 / 28 / 11) | 20 (0 / 14) | 35 | 10 (2 / 6) | none (no module) |
| reservations | 123 (64 / 38 / 21) | 44 (1 / 23) | 52 | 14 (6 / 7) | none (no module) |
| groups | 80 (4 / 53 / 23) | 32 (1 / 12) | 32 | 13 (1 / 11) | none (no module) |
| distribution | 70 (34 / 23 / 13) | 21 (1 / 14) | 34 | 12 (2 / 8) | none (no module) |
| platform | 64 (35 / 21 / 8) | 5 (0 / 1) | 35 | 4 (0 / 2) | 16 capabilities, 11 edge cases |

Most rows are `specified`: the specs already cover OPERA's core concepts. The gaps are concentrated in
front-desk throughput tools, Maldives disruption handling, tour-operator contracting, guest self-service and
booking-engine content.

## Spec change requests

### inventory.md

- **§3.1 Unit types and units**: add *unit classes* (grouping of unit types for totals, restrictions and
  limits) (PAR-INV-002); per-unit bed configuration and extra-bed/cot capacity (PAR-INV-006); connecting-unit pair
  relationships, separate from composites (PAR-INV-009); a configurable out-of-order/out-of-service reason-code
  list with default expected duration (PAR-INV-015); bulk unit creation from a list/CSV with a validation report
  (PAR-INV-016, also PLT-R41).
- **§3.3 Availability ledger**: add a **sellable availability** rule for publication: never negative, type totals
  capped by the house total (PAR-INV-024, EC-INV-020); a **house-level overbooking allowance** (PAR-INV-026); an
  **internal hold-back** quantity per type and night that takes units off sale without blocking specific units
  (PAR-INV-028); a preview when an allowance is reduced below the current overbooked quantity, recording conflicts
  rather than refusing (EC-INV-017).
- **New §3.8 Item inventory**: cots, extra beds, rollaways and similar items with daily quantities, reserved with
  stays and shown in availability (PAR-INV-031, EC-INV-030).
- **§3.7 Explanations and reads**: sister-property availability lookup for sales and relocation
  (PAR-INV-030); availability forecast including non-deducting tentative business (PAR-INV-034).
- **§3.4 Holds**: unit-level short holds ("hold Villa 214 for 3 minutes") with reason, expiry and override
  permission (PAR-INV-039, EC-INV-034); define the commit behaviour when a hold expires at the moment of booking:
  re-check under lock, succeed if free, otherwise "your hold expired" (EC-INV-008).
- **§3.5 Assignments and §6 contract**: add `unassignUnit` (PAR-INV-041, P0) and an atomic `swapAssignments`
  (PAR-INV-045, EC-INV-012).
- **§5 Invariants / operations**: the consistency job raises an urgent exception with expected vs actual and
  never auto-corrects (EC-INV-029); an out-of-order block whose expected return passes raises an engineering
  exception and keeps the unit out (EC-INV-032, island supply delays).

### rates.md

- **§3.1 Rate plans**: rate plan *category* used by restrictions, eligibility and reports (PAR-RAT-002);
  optional approval step before a new or changed plan becomes sellable (PAR-RAT-019); central vs property
  ownership with field-level protection (PAR-RAT-020, links to PLT-R27 locks); copy a plan within and across
  properties (PAR-RAT-023); structured discounts at booking with reason codes, shown separately from the price
  (PAR-RAT-025); profile-based default rate structures for guided setup (PAR-RAT-030, with PLT-R41).
- **§3.2 Restrictions**: record the **source** of every restriction and price cell (manual, pricing rule, revenue
  system, API) and define precedence so sources never silently overwrite each other (PAR-RAT-040); occupancy- or
  pickup-driven restriction rules alongside the RAT-R31 price rules (PAR-RAT-041); modifications re-evaluate
  restrictions only for changed elements, overridable with permission (EC-RAT-020).
- **§3.3 Promotions**: single-use or limited coupon codes with redemption counts (PAR-RAT-044); deterministic
  selection between exclusive and stackable promotions with "not applied because…" lines (EC-RAT-014); booking
  windows evaluated in property local time (EC-RAT-016); promotion sales limits closed immediately on ARI, with
  late channel bookings recorded as rate discrepancies (EC-RAT-029); crossing an LOS tier on extension offers the
  tier reprice as an explicit option (EC-RAT-030).
- **§3.4 Packages**: inclusion/meal forecast per day from on-the-books stays (breakfasts, dinners, transfers)
  (PAR-RAT-054; may live in `analytics` with RAT as the source).
- **§3.5 Policies**: policy schedules by stay date or season on the same plan (PAR-RAT-061).
- **§3.6 Tax engine**: manual per-stay exemption or removal of a tax or fee with permission, reason and audit
  (PAR-RAT-068); a rule-level setting for age evaluation (at arrival vs per night) (EC-RAT-008); a documented
  provisional treatment when child ages are missing on channel bookings, with a stay issue until fixed
  (EC-RAT-009, P0, depends on Q41).
- **§3.7 Quote engine**: lowest-price calendar over a date range for desk and booking engine (PAR-RAT-074);
  in-house rate check report (agreed vs current plan price, overrides) (PAR-RAT-080).
- **§5 Invariants**: price and restriction grids use cell-level optimistic concurrency; a second editor gets
  `409` with the cells changed (EC-RAT-035, P0).

### reservations.md

- **§3.1 Bookings and stays**: turnaway capture with reason codes (PAR-RES-003); a market segment and source
  code catalog with groups (PAR-RES-007, or in platform); attachments on bookings (PAR-RES-016); a pro forma bill
  for the guest from the agreed terms (PAR-RES-021); copy a booking (PAR-RES-023); cancellation reason codes and
  a cancellation number (PAR-RES-032); a privacy/incognito flag that masks names on shared boards (EC-RES-045).
- **§3.2 Lifecycle**: mass cancellation with per-booking penalty preview (PAR-RES-033).
- **§3.3–3.4 Changes**: link separate bookings of one party (PAR-RES-049); **sharers** in one unit with separate
  accounts and different dates (PAR-RES-050, EC-RES-043); mass update with preview (PAR-RES-051); move a booking
  to a sister property with history (PAR-RES-052); merge duplicate bookings, with duplicate detection at booking
  and ingestion (PAR-RES-053, EC-RES-042); fixed recurring charges on a stay, posted by Day Close with
  deterministic keys (PAR-RES-056, coordinate with finance); timed **scheduled room moves** with a pending and
  completed list (PAR-RES-066); occupant name corrections never alter issued fiscal documents and prompt for a
  credit note (EC-RES-031).
- **§3.6 Check-in**: pre-registration (run check-in steps before the arrival day) (PAR-RES-070); waiting-guest
  notification and optional automatic check-in when the unit becomes ready (PAR-RES-072, PAR-RES-117,
  EC-RES-020); advance check-in (register now, key later) (PAR-RES-073); **mass check-in** with per-stay status and
  resume (PAR-RES-074, PAR-GRP-043, EC-GRP-027); prepayment of all nights at check-in for cash and walk-in guests
  (PAR-RES-086); **online check-in** (details, ID, arrival flight, signature, payment) feeding the same checklist
  (PAR-RES-083, P0, see Q120).
- **§3.6 Check-out**: express check-out (settle to card on file, e-mail folio) (PAR-RES-098); online check-out
  (PAR-RES-099).
- **§3.9 Views**: export any operational list to CSV/XLSX and print (PAR-RES-108).
- **New §3.11 Disruptions (Maldives)**: policy `reservations.lateArrival.firstNight` for guests who cannot reach
  the resort on arrival day (last seaplane missed), with a previewed arrival shift, the villa held or released,
  and an optional linked Malé booking (EC-RES-002, P0); a **bulk transfer delay** action: one previewed ETA/date
  update for many arrivals, and no automatic no-show at Day Close for stays with a known delayed transfer
  (EC-RES-003, P0); a **forced extension** policy for departures that cannot leave (comp, discounted or agreed
  rate), with relocation cases for tomorrow's arrivals if needed (EC-RES-004, P0).
- **§3.5/§4 business date**: walk-in and "tonight" defaults use the business date, labelled, around midnight
  (EC-RES-012, P0).
- **§3.7 Channel ingestion**: a channel cancellation for an in-house or departed stay is never applied
  automatically (urgent exception) (EC-RES-039, P0); late-delivered bookings for past dates are stored without
  consuming past nights and raised for reconciliation (EC-RES-040); channel date changes on a locked assignment
  keep the lock when possible, otherwise unassign with a task (EC-RES-041).
- **New §3.12 Continuity**: during an island connectivity outage, a continuity snapshot of arrivals, assignments
  and balances is available offline, and actions are entered late with their original times labelled
  (EC-RES-046, P0, see Q122).

### groups.md

- **§3 Blocks**: shoulder dates (PAR-GRP-018); wash schedule (PAR-GRP-021); shift block dates with preview
  (PAR-GRP-023, EC-GRP-029); copy block (PAR-GRP-024); **tour series** (recurring linked blocks) (PAR-GRP-025);
  rolling cut-off validation at creation (EC-GRP-004); an explicit rule that cancellations after release return
  rooms to house inventory (EC-GRP-007); block cancellation with picked-up future stays offers cancel or convert
  per stay (EC-GRP-009); a force-majeure clause in the contract snapshot that waives attrition (EC-GRP-028).
- **§3 Rooming lists and pickup**: bulk changes to block stays (PAR-GRP-041); bulk assignment, key encoding and
  key packets (PAR-GRP-042); mass check-in (PAR-GRP-043, shared with RES); remove a stay from a block
  (PAR-GRP-046); change the unit type of a picked-up stay inside the block (PAR-GRP-047); late rooming lists after
  cut-off placed where available, with a list of unplaced names (EC-GRP-005).
- **GRP-R11 Allotments**: **free-sale contracts** and over-allotment handling (PAR-GRP-052, EC-GRP-024, P0);
  stop-sale and release notices to tour operators with an acknowledgement log and a "received after stop-sale"
  flag (PAR-GRP-053, EC-GRP-026); agency bookings arriving via a channel without allotment mapping consume house
  inventory and raise a discrepancy (EC-GRP-025). See Q121.
- **GRP-R12 Events**: space rental pricing (rental codes) (PAR-GRP-070); the weather alternate space held as a
  tentative reservation with conflict detection (EC-GRP-018); a guaranteed-attendance deadline and charging rule
  (EC-GRP-019).

### distribution.md

- **§3.1 Mapping and content**: inbound guarantee, payment and card-type code mapping (PAR-DST-004); publish tax
  and fee information so channels show correct all-in prices, including Green Tax payable at the property
  (PAR-DST-010); bring **booking-engine content** (unit-type photos, descriptions, size, amenities, bed types)
  forward from DST-R18 (LATER) into the booking-engine requirement (PAR-DST-042, P0); mapping changes preview
  their ARI effect, and retired-but-mapped types publish as closed (EC-DST-014, EC-DST-015).
- **§3.2 ARI**: per-channel restriction translation, documented and visible to staff (PAR-DST-019);
  channel-scoped restrictions (close a rate on one OTA) (PAR-DST-020).
- **§3.3 Inbound**: OTA commission per booking reconciled with OTA invoices (PAR-DST-030, with finance);
  tour-operator e-mail bookings turned into draft bookings for human review (PAR-DST-034); per-channel tax-mode
  normalization with the interpretation stored on the snapshot (EC-DST-016, P0); record which taxes the channel
  collected so the folio never charges them twice (EC-DST-017, P0, see Q124); VCC-covered amounts routed
  automatically, with extras to the guest folio (EC-DST-019); modifications for locally cancelled bookings and
  shortenings of in-house stays raise exceptions instead of applying (EC-DST-003, EC-DST-020); the same revision
  with different content is a conflict (EC-DST-032); bookings for out-of-scope channels or properties are
  accepted and raised as urgent (EC-DST-027).
- **DST-R16 Booking engine**: guest-currency display with the charge currency stated (PAR-DST-044, EC-DST-025);
  deep links (PAR-DST-045); an embeddable widget plus a hosted page (PAR-DST-046); analytics and conversion
  tracking (PAR-DST-047); booking into a group block via code or link (PAR-DST-052); guest self-service
  modify/cancel within policy (PAR-DST-054); a lowest-price calendar (PAR-DST-055, uses PAR-RAT-074); bot and
  card-testing protection (PAR-DST-056).

### platform.md

- **§3.3 Properties**: an arrival points and transport modes catalog per property (airports, jetties, seaplane
  terminals) used by RES-R39 and resort transfers (PAR-PLT-026).
- **§3.6 Plans**: a downgrade keeps contractual automation (cut-off and allotment releases) running while the
  feature is read-only (EC-PLT-021).
- **§3.4 Legal entities**: an operator change on business date D needs a cutover checklist for in-house folios
  and invoice series (EC-PLT-025).

## Ten "beat the market" opportunities

1. **Previews before every consequence, with stale-preview protection** (RES-R11/R12, PLT-R28, PLT-R37). OPERA,
   Mews and Cloudbeds commit drags and edits directly, and Cloudbeds documents that calendar drags can create
   overbookings. Portico shows availability, price, taxes, deposits and balances first.
2. **The "why" behind every availability number, and out-of-order never refused** (INV-R24, INV-R27, INV-R28). A
   broken villa is blocked even on a sold-out night, and the oversell becomes an owned conflict with a relocation
   case, not a hidden negative.
3. **Distribution you can verify**: the last channel-acknowledged state per cell, provisional holds for unmapped
   bookings, orphan parking and field-loss diffs (DST-R06, R09, R10, RES-R30). This targets the most damaging
   SMB complaint, overbookings after a sync failure (research 03).
4. **A Maldives disruption toolkit** (new RES §3.11): one action for a grounded seaplane wave (bulk ETA, no-show
   suppression, itinerary cascade), forced-extension pricing, and the missed-last-seaplane transit night. No
   competitor documents these.
5. **Tour-operator contracting done properly**: allotments plus free-sale, stop-sale notices with an
   acknowledgement log, and e-mail bookings turned into reviewable drafts (PAR-GRP-052/053, PAR-DST-034). This is
   how Maldives resorts actually sell, and most modern PMSs model it poorly.
6. **Resumable check-in and check-out checklists** whose external steps (authorization, key encoding) never repeat
   on resume (RES-R24–R27), extended with pre-registration, mass check-in and online check-in feeding the same
   checklist.
7. **One tax engine with a change-impact report before activation** (RAT-R23, RAT-R25), plus per-channel tax
   normalization so Green Tax and TGST are never double-charged or silently omitted (EC-DST-016/017).
8. **Restriction and price provenance**: every cell says who set it (manual, rule, revenue system, API) and what
   will overwrite it (PAR-RAT-040). SiteMinder documents that PMS/RMS updates silently overwrite manual changes.
9. **A data-authority matrix with switch preview and reconciliation** (PLT-R35–R39; the core is tested). Hotels
   can adopt Portico module by module without two systems fighting over inventory.
10. **Portfolio policy changes that list the affected properties first and never delete local overrides**
    (PLT-R26–R28; tested). This gives Shiji's configure-once portfolio without OPERA's irreversible switches.

## Owner questions raised

Q120 (guest self-service scope), Q121 (tour-operator contract forms), Q122 (offline continuity promise),
Q123 (GDS distribution), Q124 (taxes collected by OTAs). See `docs/OPEN_QUESTIONS.md`.
