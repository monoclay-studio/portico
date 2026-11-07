# Spec: inventory

Status: Draft v1 · 2026-11-07 · Wave 1 · Schema `inventory` · Prefix `INV`

## 1. Purpose

Inventory is the single source of truth for **what can be sold and what can be occupied**, per unit type per
night, and for **which physical unit a stay occupies**. It must give every seller — front desk, reservations,
booking engine, channels, groups — the same answer for the last unit, explain every number it shows, and make
it impossible (by database constraint) for two stays to occupy one unit on the same night.

## 2. Scope and non-goals

**In scope:** unit types, units, unit features, composite units (connecting rooms, multi-bedroom suites,
dorm beds vs private dorm), the availability ledger (capacity, out of order, sold, held, authorized
overbooking), holds with expiry, unit assignments, unit blocks (out of order, out of service, house use),
authorized overbooking, inventory conflicts, availability explanations, assignable-unit search.

**Non-goals:** prices and restrictions (`rates`); stays and bookings (`reservations`); unit condition and
housekeeping (`operations` — inventory never reads condition); channel allocations and stop-sell per channel
(`distribution`); group block grids and pickup accounting (`groups`, which consumes inventory through this
contract); day-use/hourly time slices (LATER, see INV-R30).

## 3. Capabilities

### 3.1 Unit types and units

- **INV-R01** [MUST] Unit type: code, name (localized), unit noun ("Villa", "Room", "Bed", "Apartment"),
  kind (`room`, `villa`, `suite`, `apartment`, `bed`, `tent`, `other`), base occupancy, max adults, max children,
  max occupants, bedding description, size, rank (for upgrade ordering), sellable flag, features (default),
  `isComposite`.
- **INV-R02** [MUST] Unit: number/name, unit type, location (building/wing/floor/jetty/zone free-form path),
  features (e.g. `sea_view`, `water_villa`, `accessible`, `connecting`, `private_pool`), max occupancy override,
  status `active | inactive | retired` with effective dates.
- **INV-R03** [SHOULD] **Effective-dated re-typing**: moving a unit to another unit type from business date D
  changes capacity of both types from D; reports spanning D show it in both types for their respective nights.
  Existing stays assigned to the unit on nights ≥ D are listed for review (not silently moved).
- **INV-R04** [MUST] Capacity of a non-composite unit type for night *n* = number of its units that are
  `active` on *n*. Capacity of a composite unit type = number of its composite units active on *n*.

### 3.2 Composite units

- **INV-R05** [MUST] A composite unit is composed of ≥ 2 component units (e.g. Two-Bedroom Pool Villa = Villa 21 +
  Villa 22; Private Dorm 6 = Beds 6A–6F). Components keep their own unit type. A unit may be a component of at
  most one composite unit of a given composite type.
- **INV-R06** [MUST] **Composite types are sold assignment-first:** consuming a composite unit type assigns a
  specific composite unit for the consumed nights in the same transaction, creating assignments for every
  component unit and component consumption on each component's unit type. Changing which composite unit is
  assigned is allowed; leaving a composite stay unassigned is not.
- **INV-R07** [MUST] Availability of a composite type for night *n* =
  `min( freeComposites(n) − heldComposite(n), min over component types T of floor(available_T(n) / k_T) )`
  evaluated per §4.3, where `freeComposites(n)` counts composite units none of whose components is assigned,
  out of order or out of service on *n*, `heldComposite(n)` counts active holds on the composite type, and
  `k_T` is the number of components of type T in the composite. A hold on a composite type also holds `k_T`
  units on each component type (so component sales cannot make the hold unconvertible). Authorized
  overbooking is not permitted on composite types. Selling a component unit type therefore reduces composite
  availability, and vice versa.
- **INV-R08** [MUST] Assignable-unit search ranks non-component units ahead of component units for
  non-composite stays (so composites are not broken needlessly) and explains the ranking.

### 3.3 Availability ledger

- **INV-R09** [MUST] Per (unit type, night) the ledger holds: `capacity`, `outOfOrder`, `sold` (stays, house use,
  group block allocations, composite components), `held` (unexpired holds), `overbookingAllowance`, and the
  derived `available = capacity − outOfOrder − sold − held + overbookingAllowance` (glossary formula; house use
  is counted in `sold`, out-of-service is not subtracted).
- **INV-R10** [MUST] `consume(tx, {propertyId, unitTypeId, nights, quantity, ref, overbooking?, onShortfall?})`
  locks the affected ledger rows in deterministic order `(unitTypeId, night)`, lazily releases expired holds on
  those rows, and either commits consumption for **every** night or throws `InventoryUnavailableError
  {shortNights: [{date, available}]}`. Partial success is impossible.
- **INV-R11** [MUST] `onShortfall: 'record_conflict'` (used only by channel ingestion, imports and
  administrative restores) commits the consumption even when `available` would go below zero *beyond* the
  authorized allowance, and records an **inventory conflict** (§3.6) instead of throwing.
- **INV-R12** [MUST] `release(tx, {ref, nights?})` and `changeConsumption(tx, {ref, from, to})` (type and/or
  dates change, e.g. room move to another type, extension) are atomic: a change that fails for any new night
  leaves the original consumption intact.
- **INV-R13** [MUST] `transferConsumption(tx, {from: ref, to: ref, unitTypeId, nights, quantity})` moves
  consumption between refs without changing availability (group block → picked-up stay; hold → stay is
  `convertHold`).
- **INV-R14** [MUST] Consumption rows are keyed by `(ref, unitTypeId, night)` so re-applying the same
  consumption for the same ref is idempotent (no double count).

### 3.4 Holds

- **INV-R15** [MUST] `createHold` with `expiresAt` (policy defaults: booking-engine cart 15 min; staff quote
  30 min; tentative option set by user up to 14 days; group option per groups spec). Holds count in `held`
  until converted, released or expired.
- **INV-R16** [MUST] Expired holds are released lazily inside any transaction that touches their ledger rows
  and by a sweeper every 60 s; `inventory.hold.expired` is emitted once per hold.
- **INV-R17** [MUST] `extendHold` (new expiry, audited, permission-gated beyond policy maximum) and `releaseHold`.

### 3.5 Assignments

- **INV-R18** [MUST] `assignUnit(tx, {unitId, ref, nights})` creates an assignment for the half-open night range.
  The database guarantees no two assignments overlap on one unit (exclusion constraint on
  `(unit_id, daterange)`); violation → `UnitAssignmentConflictError {conflicts: EntityRef[]}`.
- **INV-R19** [MUST] An assignment's unit must be of the consumed unit type for those nights, **or** the
  assignment carries `upgrade: {fromUnitTypeId, reason, chargeable: boolean}` in which case the consumption is
  moved to the assigned unit type (`changeConsumption`) in the same transaction — availability always reflects
  the physical unit type actually occupied.
- **INV-R20** [MUST] Assignments may be **locked** (`locked: true`, reason) so automated assignment and
  optimization never move them; manual moves of a locked assignment require confirmation.
- **INV-R21** [MUST] Assigning a unit that is out of order or out of service on any of the nights is rejected
  (`unit_not_assignable`, naming the block and its expected end); house-use units can't be assigned to stays.
- **INV-R22** [SHOULD] `findAssignableUnits` returns candidates with: fit score, matched/missed preferences
  (features passed by caller), adjacency hints (composite, connecting), and for excluded units the reason
  (assigned to which ref, blocked, inactive). Condition-aware ranking is done by the caller (reservations reads
  `operations`), keeping inventory free of housekeeping data.
- **INV-R23** [SHOULD] Auto-assign service (used by reservations for arrivals) operates per stay with optimistic
  concurrency; it never locks a calendar, a unit type or a date range beyond the rows it changes.

### 3.6 Unit blocks, overbooking and conflicts

- **INV-R24** [MUST] `blockUnit(tx, {unitId, nights, kind, reason, sourceRef?})`:
  - `out_of_order` — removes the unit from capacity (increments `outOfOrder`) and from assignment.
  - `out_of_service` — unit stays in capacity but is not assignable.
  - `house_use` — consumes inventory (increments `sold`) with ref `{type:'unitBlock'}`; no revenue.
  It **never fails because of sold-out nights**: it returns `affectedAssignments` (stays assigned to the unit
  on those nights) and creates inventory conflicts for nights where `available` drops below zero beyond
  allowance. Callers must route affected stays into resolution (reservations relocation workflow).
- **INV-R25** [MUST] `releaseBlock` restores capacity/assignability. Whether the unit may *return to sale* is
  decided by the caller (operations enforces work-order completion and inspection policy before calling it).
- **INV-R26** [MUST] **Authorized overbooking** (`inventory.overbooking`): an allowance per (unit type, night)
  set by a user with `inventory.overbooking.authorize` ⚑ with reason and optional expiry; consumption into the
  allowance is labelled *authorized overbooking* everywhere. Ad-hoc overbooking for one sale requires
  `overbooking: {authorizedBy, reason}` on `consume` (or an approval from identity) and increments the
  allowance for exactly that quantity.
- **INV-R27** [MUST] An **inventory conflict** exists for (unit type, night) whenever
  `capacity − outOfOrder − sold − held < −overbookingAllowance` (oversold beyond authorization). Conflicts carry
  causes (refs that consumed last, blocks placed, channel bookings), status `open | resolving | resolved`, owner,
  and resolution kind (`relocated`, `upgraded`, `moved_dates`, `cancelled`, `allowance_authorized`,
  `capacity_restored`). A conflict resolves automatically when the inequality no longer holds; the resolution
  kind is recorded from the action that resolved it.

### 3.7 Explanations and reads

- **INV-R28** [MUST] `explainAvailability(unitTypeId, date)` returns the formula with every term and the
  records behind it: units by state (free, assigned→ref, out of order→block + reason + expected end,
  out of service, component of assigned composite), sold refs with booking source, holds with expiry and
  creator, overbooking allowance with authorizer and reason, open conflicts. Every number in any availability
  UI links to this explanation (brief §4 "why").
- **INV-R29** [MUST] `getAvailability(range ≤ 400 nights, unit types)` returns cells with the breakdown and a
  `generatedAt`; responses are strongly consistent with committed transactions (read from the ledger, not a
  cache).
- **INV-R30** [LATER] Time-sliced inventory (day use, hourly function rooms) using slices instead of nights;
  the ledger key becomes `(unitTypeId, slice)` with night slices as the default.

## 4. Entities, states and rules

### 4.1 Entities

`unit_type(id, property_id, code, kind, noun, base_occ, max_adults, max_children, max_occupants, rank,
is_composite, sellable, version)` · `unit(id, property_id, unit_type_id, number, location_path, features[],
status, valid_from, valid_to?, version)` · `unit_type_membership(unit_id, unit_type_id, valid_from, valid_to?)`
(INV-R03) · `composite_unit(id, unit_type_id, component_unit_ids[])` · `ledger(property_id, unit_type_id, night,
capacity, out_of_order, sold, held, overbooking_allowance, version)` · `consumption(ref_type, ref_id,
unit_type_id, night, quantity, kind: stay|house_use|block_allocation|composite_component|import,
overbooking_authorization_id?)` · `hold(id, ref, unit_type_id, nights, quantity, expires_at, status)` ·
`assignment(id, unit_id, ref, nights daterange, locked, upgrade jsonb?, composite_assignment_id?)` ·
`unit_block(id, unit_id, kind, nights daterange, reason, source_ref?, status, created_by)` ·
`overbooking_allowance(id, unit_type_id, night, quantity, reason, authorized_by, expires_at?)` ·
`conflict(id, unit_type_id, night, shortfall, causes jsonb, status, owner_user_id?, resolution?)`.

### 4.2 State machines

**Hold:** `active → converted` (convertHold) · `active → released` (releaseHold / ref cancelled) ·
`active → expired` (time ≥ expiresAt, by sweeper or lazy release). Terminal states immutable.

**Unit block:** `scheduled → active` (start night reached; or created active) · `scheduled|active → released`
(releaseBlock) · `active → completed` (end night passed). Extending a block is an update with audit; shortening
below today is a release.

**Unit status:** `active ⇄ inactive` (effective-dated, previewed with affected stays) · `inactive → retired`
(no future assignments, terminal).

**Conflict:** `open → resolving` (owner assigned / relocation started) · `open|resolving → resolved` (inequality
no longer holds) · `resolved → open` (reappears if a later change re-oversells the night; new conflict row,
linked to the previous).

### 4.3 Calculation rules

- Night ranges are half-open `[arrival, departure)`; a zero-night range is invalid for consumption.
- Lock order for multi-row operations: ascending `(unit_type_id, night)`; composites lock component types
  in the same global order.
- `available` is computed on the locked rows inside the transaction; `getAvailability` outside commands reads
  committed rows.
- Composite availability (INV-R07) — worked example: Deluxe units 101, 102, 103; Suite S = 101+102.
  Sell 1 Deluxe (unassigned) → `available_Deluxe = 2`, Suite = min(1 free composite, floor(2/2)=1) = 1.
  Sell Suite → assigns 101+102, Deluxe `sold = 3`, `available_Deluxe = 0`; the unassigned Deluxe stay can only
  be assigned 103 — feasible by construction.

## 5. Invariants

- **INV-I01** For every unit and night, at most one assignment covers it (DB exclusion constraint).
- **INV-I02** For every (unit type, night): `sold = Σ consumption.quantity` for that cell and `held = Σ quantity`
  of active, unexpired holds (verified by a consistency check job and in tests after every scenario).
- **INV-I03** For every (unit type, night): `available ≥ −overbookingAllowance` **or** an open conflict exists
  for that cell. No oversold cell without a conflict record.
- **INV-I04** Two concurrent `consume` calls that together exceed `available` result in exactly one success
  and one `InventoryUnavailableError` (S01, E01) — never two successes, never a deadlock surfaced to users
  (deadlocks are retried internally ≤ 3 times).
- **INV-I05** A `consume` either changes every requested night or none.
- **INV-I06** Every assignment of a composite unit has assignments for all its components with identical nights
  and ref.
- **INV-I07** No assignment exists on a night where its unit has an active `out_of_order` or `out_of_service`
  block **unless** that assignment is listed in an open affected-assignment record awaiting resolution.
- **INV-I08** Consumption for a ref and night is unique per unit type (idempotent re-application).
- **INV-I09** Expired holds never prevent a sale: any command that finds an expired hold on a locked row
  releases it first.
- **INV-I10** Authorized-overbooking consumption always references an allowance with an authorizer and reason.

## 6. Cross-module interactions

Provider to: `reservations` (consume, release, changeConsumption, holds, assignments, explain), `groups`
(block allocation consumption, transferConsumption on pickup, release at cut-off), `distribution`
(getAvailability, `inventory.availability.changed`), `operations` (blockUnit/releaseBlock for work orders and
house use), `day-close` (getAvailability for statistics), `analytics`. Depends on `platform` (property,
business date) and `identity`.

### Proposed contract changes

1. `consume(..., onShortfall?: 'reject' | 'record_conflict')` (INV-R11). Default `'reject'`. Additive.
2. New `transferConsumption(tx, { from, to, unitTypeId, nights, quantity })` (INV-R13).
3. New `extendHold`, `releaseHold(tx, { holdId })` (INV-R17).
4. New `setOverbookingAllowance(tx, { propertyId, unitTypeId, nights, quantity, reason, expiresAt? })` (INV-R26).
5. `assignUnit(tx, { unitId, ref, nights, locked?, upgrade? })` (INV-R19/R20). Additive.
6. New `listConflicts(tx, { propertyId, status? })`, `getConflict`.
7. `blockUnit` returns `{ blockId, affectedAssignments, conflictsCreated: Uuid[] }`.

## 7. Events

Emitted: `inventory.availability.changed {propertyId, cells: [{unitTypeId, night}]}` (coalescible) ·
`inventory.unit.blocked {unitId, kind, nights, affectedAssignments}` · `inventory.unit.unblocked` ·
`inventory.assignment.changed {ref, unitId?, previousUnitId?, nights}` · proposed:
`inventory.hold.expired {holdId, ref}`, `inventory.conflict.detected {conflictId, unitTypeId, night, shortfall}`,
`inventory.conflict.resolved {conflictId, resolution}`, `inventory.overbooking.authorized`.
Consumed: `reservations.booking.cancelled` is **not** consumed — reservations releases synchronously in its
transaction. Inventory consumes nothing asynchronously in wave 1.

## 8. Permissions

`inventory.unit.read` · `inventory.unitType.manage` · `inventory.unit.manage` · `inventory.availability.read` ·
`inventory.availability.explain` · `inventory.hold.create` · `inventory.hold.extend` ·
`inventory.assignment.manage` · `inventory.assignment.overrideLock` · `inventory.unitBlock.create` ·
`inventory.unitBlock.release` · `inventory.houseUse.create` ⚑ · `inventory.overbooking.authorize` ⚑ ·
`inventory.conflict.resolve`.

## 9. UX surfaces

- **Availability grid** (unit types × nights): available count, badges for authorized overbooking (amber,
  labelled), conflicts (red, labelled "Oversold — needs resolution"), out of order count; every cell opens the
  **explanation drawer** (INV-R28). Keyboard: arrows move cells, `Enter` opens explanation.
- **Unit board**: units by location with assignment for tonight, block state and (from operations) condition.
- **Out-of-order dialog**: unit, dates, reason, expected return; preview lists affected stays and nights that
  will become oversold before committing.
- **Conflict queue**: open conflicts ordered by night, each with causes and recommended resolutions (from
  reservations' relocation workflow).
- The **Timeline** (owned by reservations) renders assignments and blocks from this module.

## 10. Proof scenarios and evidence

| ID | Inventory must demonstrate |
|---|---|
| S01 / E01 | 2–50 parallel `consume` calls for the last unit: exactly `available` succeed; losers get `InventoryUnavailableError` with `shortNights`; ledger consistent (INV-I02/I04). |
| S02 / E02 | Duplicate channel delivery consumes once (INV-I08); a channel booking on a sold-out night records a conflict, not a silent oversell. |
| S03 | Extension into nights where the assigned unit is taken: `changeConsumption` succeeds at type level if available; `assignUnit` for the extra nights fails with the conflicting ref; alternatives come from `findAssignableUnits`. |
| S07 | Reassignment to another unit is atomic and locked assignments are respected. |
| S08 | OOO on several assigned units returns `affectedAssignments` and conflicts; availability and explanation update immediately. |
| S11 | Block allocation release at cut-off returns inventory exactly once. |
| S20 | Inventory stays authoritative and sellable at the desk while channels are down. |
| E08 | Not applicable (no prices here). |

## 11. Maldives specifics

Resort unit types are typically villa categories (Beach Villa, Water Villa, Sunset Water Villa with Pool,
Two-Bedroom Beach Residence = composite) with unit numbering by jetty/zone; location path supports
`Jetty B / 214`. Guesthouses are small (often 6–20 rooms) — one unit type with 4–8 units is common, so the grid
and explanations must stay legible at tiny scale. Water-villa jetty maintenance (e.g. jetty closure) blocks many
units at once: OOO dialog supports multi-unit selection by location. Unit features include `water_villa`,
`overwater_hammock`, `private_pool`, `beachfront`, `sunset_side`, `sunrise_side`.

## 12. Competitive inspirations

- One inventory ledger shared by PMS, channel manager and booking engine — Cloudbeds (research 03 §3.2, §13).
- Linked/shared inventory (dorm bed vs private room) — Cloudbeds; associated/interconnecting categories —
  RMS (research 03 §3.2, §7.2). Improved: exact composite availability with assignment-first composites.
- Type-agnostic units and requested-type vs assigned-unit with a lock flag — Apaleo/Mews (research 02 §3.3.2,
  §2.4, §6). Explanations for visible-but-unbookable inventory — RMS (research 03 §7.2).
- Never lock the whole diary for auto-assign — Stayntouch anti-pattern (research 02 §4.6).
- OPERA's deduct/non-deduct and block-type inventory semantics informed `sold` kinds (research 01 §3.3–3.4).

## 13. Open questions

None for the owner. Product decisions: hold defaults (§3.4); composite types are sold assignment-first; OOO
never refused for sold-out nights (a broken unit cannot be "unavailable to break").

## 14. Adoption modes

- **Standalone alongside an external PMS:** yes, in **catalog-and-mirror** form. Unit types and units are always
  held in Portico (created from `integration` mappings or setup), because housekeeping, maintenance, messaging,
  transfers and analytics need a unit catalog even when the PMS sells the inventory.
- **Hard dependencies:** `platform`, `identity`; `integration` (mappings `unitType`, `unit`) in connected mode.
- **Connected mode** (`availability` authority external):
  - Reads: unit types/units (mapped), occupancy and assignments (from the PMS reservation feed via reservations'
    mirror), availability counts if the connector supports them (provenance `external`, last-sync time).
  - Disabled: `consume`, holds, overbooking allowances, conflicts — `assertWritable(availability)` returns
    `external_system_of_record` (read_only) or the action is forwarded (`forward`, e.g. an out-of-order block
    sent to the PMS and effective only when acknowledged).
  - Assignments mirror the PMS (read-only) unless the connector supports forwarding room assignment.
  - Explanations show "Availability is managed in <system>; last update 14:02" instead of a local formula.
- **Data-authority domains:** owns `availability` when Portico is authoritative; respects `reservations` (no
  local consumption when reservations are external) and `maintenance` (OOO/OOS blocks are created by
  operations; when `maintenance` is external, blocks are mirrored read-only).
- **Trial:** availability computed from the copied reservations is labelled `copied`; discrepancies against the
  PMS's own availability (read-only connection) are listed for investigation, never auto-corrected.
