# @portico/inventory

**Purpose.** The single source of truth for *what can be sold* (per unit type per night) and *which physical unit a
stay occupies*. Every seller — desk, reservations, booking engine, channels, groups — gets the same answer for the
last unit; every number is explainable; the database makes it impossible for two stays to occupy one unit on the
same night. Spec: `docs/specs/inventory.md` (INV-*). Contract: `docs/architecture/domain-map.md` § inventory.

Schema `inventory` (`migrations/0001_inventory.sql`): `features`, `unit_types`, `units`, `composite_components`,
`ledger`, `consumptions`, `holds`, `assignments`, `unit_blocks`, `overbooking_allowances`, `conflicts`. Every table has
`tenant_id` + forced RLS (`core.enable_tenant_isolation`), `version` on mutable aggregates, business-identity unique
keys, and no foreign keys into other schemas.

## How to use it (other modules)

```ts
import { createInventoryService } from '@portico/inventory';
// composition root: apps/api/src/composition.ts exports `inventoryService` — bind your inventory port to it.
await inventoryService.consume(tx, { propertyId, unitTypeId, nights: { from, to }, quantity: 1, ref: { type: 'stay', id } });
```

All provider functions take the caller's `tx` (one transaction per command) and either fully succeed or throw.

## The availability model

Per (unit type, night) the ledger row holds `capacity` (active units), `out_of_order`, `sold` (Σ consumption: stays,
house use, block allocations, composite components, imports), `held` (Σ unexpired holds) and
`overbooking_allowance` (Σ active authorized allowances):

```
available = capacity − out_of_order − sold − held + overbooking_allowance        (glossary formula)
```

* Ledger rows are created lazily by the first command that touches a night (capacity counted from active units);
  reads of nights without a row compute the same numbers from the units.
* **Concurrency (S01, INV-I04).** Every command locks, in one global order: unit types `FOR SHARE` (capacity changes
  take them `FOR UPDATE`) → ledger rows `FOR UPDATE` ascending `(unit_type_id, night)` → hold rows → unit rows. It
  then checks every night on the locked numbers and only writes when all fit (version-guarded update of the locked
  rows), so a `consume` changes every night or none — even if the caller catches the error and continues its
  transaction. Multi-step changes (`changeConsumption`, `assignUnit` with upgrade) pre-lock the union of all cells in
  the same order and run inside a savepoint. Deadlocks are therefore not expected; `withTenantTx` still retries
  40P01/40001 twice.
* **Releases are exactly-once.** `release` and `changeConsumption` take the locks first, then re-read the ref's
  consumption, allowances and holds under the lock and adjust the ledger only from the rows they actually delete or
  close (`delete … returning`, `update … where status = 'active' returning`). A concurrent release or change of the
  same ref that committed first leaves nothing for the second to subtract, and an expired hold already released lazily
  is not subtracted again (review INV-01/02; tests CE1, CE1b, CE2, CE6, release × sweeper).
* **Holds** count in `held` until converted, released or expired. Expired holds are released lazily by any command
  that locks their rows (the command first extends its lock set to every cell of such holds) and are already
  excluded from reads, so an expired hold never blocks a sale (INV-I09). Converting a hold decides on its status
  *under the lock*: converted → idempotent for the same ref, `hold_already_converted` otherwise; released →
  `hold_not_active`; expired → tried as a fresh sale, failing with "your hold expired and the inventory was sold" if
  it is gone (EC-INV-008). One hold therefore yields at most one booking (CE5). Holds longer than the property policy
  `inventory.hold.maxDays` (default 14) need `inventory.availability.manage`; 180 days is the ceiling.
* **Scheduled jobs** (`createInventoryJobs`, registered in `Composition.jobs`): `inventory.expireDue` (60 s) releases
  expired holds and lapsed overbooking allowances — a lapsed allowance with sales inside it opens a conflict at once
  (INV-I03, EC-INV-016); `inventory.checkLedger` (hourly) verifies INV-I02 from yesterday on and reports any
  discrepancy as an urgent `inventory.ledger.inconsistent` event + audit, never correcting it (EC-INV-029).
  Organizations with work are found through reviewed SECURITY DEFINER routing functions that return tenant ids only
  (`inventory.tenants_with_due_expiries`, `inventory.tenants_with_ledger_since`); the work runs inside each
  organization's RLS-scoped transaction with a system context.
* **Authorized overbooking vs inventory conflict.** An allowance is explicit, sensitive
  (`inventory.overbooking.authorize`) and recorded with who and why — standing (`setOverbookingAllowance`) or ad hoc
  for one sale (`consume(..., overbooking: { authorizedBy, reason })`, which adds exactly the shortfall). Selling into
  it is shown as `status: 'overbooked'`, `overbookingInUse`. A **conflict** is different: a cell where
  `available < 0` beyond the allowance (channel bookings with `onShortfall: 'record_conflict'`, out-of-order blocks on
  sold nights, capacity removed). Every such cell has exactly one open `inventory.conflicts` row (INV-I03) with causes,
  owner and status `open → resolving → resolved`; it resolves automatically when the numbers fit again, recording the
  resolution kind from the action that fixed it (`cancelled`, `moved_dates`, `upgraded`, `relocated`,
  `allowance_authorized`, `capacity_restored`). Conflicts are data: `listConflicts`, `GET /inventory-conflicts`.

### Composite units (connecting villas, two-bedroom residences)

A composite unit (e.g. *Residence R1 = Beach Pool Villa P201 + P202*) is a unit of a **composite unit type**, linked to
≥ 2 component units of ordinary types. Every composite unit of a type combines the same mix of component types
(`k_T` units of type T), and a unit belongs to at most one composite of a given composite type.

* Component units keep counting in their own type's capacity; the composite type's capacity is its composite units.
* **Selling a composite is assignment-first** (INV-R06): `consume` on a composite type picks a composite unit free on
  every night (it and all components unassigned and unblocked), locks it, assigns it (one top-level assignment plus
  one child assignment per component, same ref and nights — INV-I06) and consumes `k_T` of every component type
  (`kind: composite_component`). Quantity is one per ref.
* **Composite availability** (INV-R07):
  `min(freeComposites − heldComposite − unassignedSold, min_T floor(available_T / k_T))`.
  Selling (even unassigned) component villas lowers it through `available_T`; assigning a component villa to an
  ordinary stay lowers it through `freeComposites`; selling a composite lowers component availability through its
  component consumption. *Sales* of the two views therefore always agree on the physical villas (interleaved tests:
  residence vs villa sale, residence sale vs assignment of one of its villas).
* **Assignments cannot silently break a residence hold or sale** (review INV-04): if giving a component villa to an
  ordinary stay would leave fewer free residences than are held or sold on a night, `assignUnit` refuses with
  `composite_hold_at_risk` (choose another villa) unless the caller passes `allowCompositeConflict`, in which case the
  conflict it opens is returned in `conflictsCreated`. Assignable-unit search already ranks such villas last.
* A residence stay can be moved to another residence but never left unassigned (`composite_must_stay_assigned`,
  INV-R06).
* A **hold on a composite type** also holds `k_T` units of each component type, so component sales cannot make it
  unconvertible; conversion assigns a specific composite unit.
* Composite types cannot be overbooked; composite units cannot be blocked (block the physical villas — the composite
  becomes unavailable automatically). A channel sale with `record_conflict` and no free composite is consumed
  unassigned and opens a conflict on the composite cell (`unassignedSold`).
* Assignable-unit search ranks standalone units ahead of components for ordinary stays (INV-R08) and explains it.

## Capabilities (spec MUST/SHOULD) and status

| Req | Capability | Status | Readiness |
|---|---|---|---|
| R01–R02, R04 | Unit types (room/villa/suite/apartment/bed/tent/pitch/other; occupancy limits, bedding, size, rank, sellable, features), units (number, building/floor/zone, features, max-occupancy override, sort order, active/inactive/retired with inventory dates), feature catalog, capacity per night | Done | R3 |
| R03 (SHOULD) | Effective-dated re-typing of a unit | Not built (unit type is fixed per unit) | R1 |
| R05–R08 | Composite units, assignment-first sales, consistent composite/component availability, ranking | Done | R3 |
| R09–R14 | Ledger, `consume` (all-or-nothing, lazy hold release, `onShortfall`), `release`, `changeConsumption`, `transferConsumption`, idempotent re-application; exactly-once releases under concurrency | Done (review defects INV-01/02 fixed, regression tests CE1/CE1b/CE2/CE6) | R3 |
| R15–R17 | Holds: create, convert (one hold → one booking), release, extend (policy-gated beyond `inventory.hold.maxDays`), lazy expiry, scheduled sweeper, `inventory.hold.expired` once per hold | Done (INV-05/13 fixed, CE5) | R3 |
| R18–R21 | Assignments with exclusion constraints, upgrade moves consumption, locked assignments + override, not assignable when blocked/house use | Done | R3 |
| R22 (SHOULD) | `findAssignableUnits` with exclusion reasons, feature match, composite awareness, ranking | Done (adjacency hints limited to composite membership) | R3 |
| R23 (SHOULD) | Auto-assign service | Not built (reservations' arrival flow will call `findAssignableUnits` + `assignUnit`) | R1 |
| R24–R25 | Unit blocks: out of order / out of service / house use, affected assignments, conflicts, preview, release from the business date | Done | R3 |
| R26–R27 | Authorized overbooking (standing + ad hoc), inventory conflicts with causes/owner/resolution | Done | R3 |
| R28–R29 | `explainAvailability` (formula, units by state, sold refs, holds, allowances, conflict, composite notes, sentences), `getAvailability` grid up to 731 nights with house totals and non-negative `sellable`, strongly consistent | Done | R3 |
| — | Universal record contract (unit, unit type, unit block, conflict), search provider, record history | Done | R3 |
| — | Plan limit `limits.units` (physical units, organization-wide) | Done | R3 |
| — | Maldives demo inventory (12-room guesthouse, 120-villa resort with 2 two-bedroom residences, 64-room hotel, 24 apartments) | Done (`createInventoryDemoSeed`) | R2 |

Nothing here is external, so nothing claims beyond R3.

## Invariants and the tests that prove them

| Invariant | Enforced by | Proven in |
|---|---|---|
| INV-I01 one assignment per unit per night | `EXCLUDE USING gist (unit_id =, nights &&)` + a ref occupies one top-level unit per night | `scenario-s03…` (conflict), `composite.test.ts` |
| INV-I02 `sold = Σ consumption`, `held = Σ active holds` | single write path through `LedgerSession`; lock-then-read releases; hourly `inventory.checkLedger` job in production | `assertLedgerConsistent` after **every** integration test file; `regression-review.test.ts` (CE1/CE1b/CE2/CE6, consistency job) |
| INV-I03 no oversold cell without an open conflict | `reconcileConflicts` after every ledger change (incl. lapsed allowances via the sweeper); unique open conflict per cell | `availability.test.ts`, `scenario-s08…`, `composite.test.ts`, `isolation-permissions.test.ts`, `regression-review.test.ts` (CE7) |
| INV-I04 concurrent sellers: one success, one `InventoryUnavailableError` | lock order + check-then-write on locked rows | `scenario-s01…` (blocked transaction observed in `pg_stat_activity`; 50 sellers / 3 villas; opposite moves; composite vs component) |
| INV-I05 consume changes every night or none | checks before writes; savepoints for multi-step changes | `availability.test.ts` (short night, caller continues its tx), `scenario-s03…` |
| INV-I06 composite assignment has identical component rows | `placeAssignment` / `trimAssignments`; composite stays cannot be unassigned | `composite.test.ts`, `regression-review.test.ts` (CE8) |
| INV-I07 assignments on blocked nights are visible for resolution | block keeps `affectedAssignments`; record shows `outstandingAssignments` + blocking issues | `scenario-s08…`, API test |
| INV-I08 consumption unique per (ref, type, night) | unique key | `availability.test.ts` (idempotent re-apply) |
| INV-I09 expired holds never prevent a sale | lazy expiry on locked rows; reads exclude expired; releases never subtract them twice | `availability.test.ts`, `regression-review.test.ts` (CE1/CE1b) |
| INV-I10 authorized-overbooking consumption references an allowance | `consumptions.overbooking_allowance_id` | `availability.test.ts` |

## Scenarios covered

| Test file | Demonstrates |
|---|---|
| `test/scenario-s01-last-unit-concurrency.test.ts` | S01: two truly concurrent transactions for the last villa (B provably waits on A's row lock) → one success, one `InventoryUnavailableError { shortNights }`; 50 agents / 3 villas → exactly 3; opposite-direction moves never surface a deadlock; residence vs component villa race; coalescible `inventory.availability.changed` with unit type + range |
| `test/scenario-s03-extension-assignment-conflict.test.ts` | S03 (inventory part): extension succeeds at type level, assigning the same villa for the new nights throws `UnitAssignmentConflictError` naming the other stay, `findAssignableUnits` offers villas for the extra nights or the whole stay; split, whole-stay move, locked assignment override, type sold out → nothing changes |
| `test/scenario-s08-maintenance-block.test.ts` | S08 (inventory part): out-of-order blocks on several assigned villas return `affectedAssignments` (also in `inventory.unit.blocked`), open conflicts when nights oversell, explanation updates, blocked villas refuse assignment, relocation by upgrade/move resolves the conflicts, release restores capacity; OOS vs house use semantics |
| `test/composite.test.ts` | Composite model end to end |
| `test/isolation-permissions.test.ts` | S17 tenant isolation (by id, raw-SQL RLS), property scope, permission per action, connected mode |
| `test/availability.test.ts` | Catalog, consume/release/change/transfer, holds, overbooking vs conflicts, explanations |
| `test/hold-expiry-job.test.ts` | INV-R16: scheduled sweeper expires due holds across organizations, once, inside RLS |
| `test/regression-review.test.ts` | Steward review CE1–CE8 as regression tests with proven interleaving (release × release, release × change, release × sweeper, convert × convert, residence sale × villa assignment, residence sale × villa sale); composite hold protection; lapsed allowances; consistency check; house totals; 2-year horizon; unit-change preview; hold policy |
| `apps/api/test/inventory.test.ts` | HTTP: idempotent creates, ETag/If-Match, record contract, grid, explanation, block preview/place/release + history, overbooking, search/summary, isolation over HTTP, demo seed through `Composition.demoSeedSteps` |

Counts: 31 domain unit tests, 65 module integration tests, 6 API tests (`pnpm --filter @portico/inventory test`,
`pnpm --filter @portico/api test`, with `PORTICO_TEST_DB_PREFIX`).

## Permissions

| Key | Used for |
|---|---|
| `inventory.unit.read` | Read unit types, units, features, composite units, assignments, blocks |
| `inventory.unitType.manage` | Create/edit unit types and the feature catalog |
| `inventory.unit.manage` | Create/edit units and composite units, take units out of inventory |
| `inventory.availability.read` | Grid, explanations, conflicts, allowances |
| `inventory.availability.manage` | Holds beyond the `inventory.hold.maxDays` policy; take ownership of / mark conflicts as resolving |
| `inventory.overbooking.authorize` ⚑ | Standing allowances and ad-hoc overbooking on `consume` |
| `inventory.block.manage` | Place/release out-of-order and out-of-service blocks |
| `inventory.houseUse.create` ⚑ | House-use blocks (in addition to block.manage) |
| `inventory.assignment.manage` | `assignUnit` / `unassignUnit` |
| `inventory.assignment.overrideLock` ⚑ | Move/remove a locked assignment |

Spec §8 lists finer keys (`unitBlock.create/release`, `hold.create/extend`, `availability.explain`,
`conflict.resolve`); the task's coarser keys were used (`block.manage`, `availability.read/manage`). Role templates in
identity already grant `inventory.availability.read`, `inventory.unit.read`, `inventory.assignment.manage`,
`inventory.availability.*` and `inventory.*` as appropriate.

**Authorization decision for provider calls.** `consume`, `release`, `changeConsumption`, `transferConsumption` and
holds are provider calls made *inside another module's command* (reservations confirming a booking, distribution
ingesting a channel booking, groups picking up a block). They do **not** re-check inventory *permissions*: the
caller's command permission (e.g. `reservations.booking.create`) governs, so a desk agent never needs inventory
permissions to sell. Exceptions: overbooking always requires `inventory.overbooking.authorize`; holds beyond the
policy maximum require `inventory.availability.manage`. Assignment, blocks, allowances and catalog changes check
inventory permissions.

**Data authority decision (orchestrator, after review INV-03).** Inventory owns the `availability` domain and is the
only reliable choke point, so **every** write — consume, release, change, transfer, holds, assignments, blocks,
allowances, catalog — calls `assertWritable(availability)` itself (ADR-0014, CLAUDE.md §4.15, spec §14). Callers do
not need to check `availability` too.

## Data authority and adoption modes

* **Standalone:** yes (catalog + availability), depends on `platform` and `identity` only.
* **Connected mode** (`availability` external): every direct write is refused — `read_only` →
  `external_system_of_record`, `forward` → `forwarding_not_available` (no forwarding transport yet) — with an
  explanation naming the system. Mirrored state enters **only** through `applyExternalAvailability(tx, { propertyId,
  connectionId, operations })`, callable only by the connection that is the system of record: sales are mirrored with
  `record_conflict` (a difference with Portico's ledger becomes a visible conflict, never a refusal), locks are
  overridden, and the sync time is recorded. Catalog changes from that integration pass `{ origin: { connectionId } }`.
  Reads carry `provenance: 'external'` with `lastSyncAt`, or `'incomplete'` before the first sync (trial:
  `'copied'`), and explanations start with "Availability at this property is managed in <system>".
* `maintenance` (external): out-of-order / out-of-service blocks are refused (or would be forwarded) by inventory
  itself, on every path including its own HTTP route; house use depends on `availability` only.

## Events

Emitted (outbox): `inventory.availability.changed` `{ propertyId, unitTypeId, range, coalesceKey, cause }` — **this is
the shape** (decided at review, INV-14): one event per unit type per command with the half-open `range` covering
every changed night, no `cells` list; consumers re-read availability for the range; events with the same
`coalesceKey` may be merged by widening the range; composite types built from a changed type are included ·
`inventory.unit.blocked` `{ blockId, unitId, unitTypeId, kind, nights, reason, sourceRef, affectedAssignments,
conflictsCreated }` · `inventory.unit.unblocked` · `inventory.assignment.changed` `{ ref, change, unitId,
previousUnitIds, nights }` · `inventory.hold.expired` · `inventory.conflict.detected|resolved` ·
`inventory.overbooking.authorized` · `inventory.unitType.changed` · `inventory.unit.changed` ·
`inventory.ledger.inconsistent` (urgent, from the consistency job). Consumed: none.

## Ports

`PlatformPort` (`getBusinessDate`, `getDataAuthority`, `assertWritable`, `getLimit`, `resolvePolicy`) — bound to the real platform
provider in `apps/api/src/composition.ts`. The hold-expiry job resolves an organization's environment through the
whitelisted `platform.tenant_environment()` routing function. Inventory needs nothing from other wave-1 modules, so nothing is stubbed.
Composition exposes `inventoryService` (also as `services.inventory`; bind other modules' inventory ports to it),
registers the jobs in `jobs` and the demo inventory in `demoSeedSteps` (it runs before the other modules' demo data).

## Universal record contract coverage

`GET /units/:id`, `/unit-types/:id`, `/unit-blocks/:id`, `/inventory-conflicts/:id` (and create/update responses)
return `status` per family (unit: `lifecycle`, `maintenance`, `assignment` as of the business date; block: `block`,
`phase`; conflict: `conflict`), `allowedActions` with plain-language disabled reasons (permission and business rule),
`issues`, `owner` (conflicts), `links`, `provenance`. `recordTypes`: `unit`, `unitType`, `unitBlock`,
`inventoryConflict`, `unitFeature` (block events are audited on both the block and its unit). `inventorySearch`
searches units (number, name, zone) and unit types, and summarizes all four record types; registered in
composition. Audit before/after contain no secrets or personal data. List endpoints return plain DTOs.

## HTTP (under `/v1`)

Features `GET|POST /properties/:propertyId/unit-features`, `PATCH /unit-features/:id` · Unit types
`GET|POST /properties/:propertyId/unit-types`, `GET|PATCH /unit-types/:id` · Units `GET|POST
/properties/:propertyId/units`, `POST /properties/:propertyId/composite-units`, `GET|PATCH /units/:id` · Availability
`GET /properties/:propertyId/availability?from&to&unitTypeIds`, `GET …/availability/explanation?unitTypeId&date` ·
Assignments (read) `GET …/assignments`, `GET …/assignable-units` · Blocks `GET|POST …/unit-blocks`,
`POST …/unit-blocks/preview`, `GET /unit-blocks/:id`, `POST /unit-blocks/:id/release` · Unit lifecycle preview
`POST /units/:id/preview-change` · Overbooking
`GET|POST …/overbooking-allowances` · Conflicts `GET …/inventory-conflicts`, `GET|PATCH /inventory-conflicts/:id`.
Creates need `Idempotency-Key` (scoped by path params + body); updates need `If-Match`; reads of versioned records
return `ETag`; errors are problem+json that say what to do next.

## Contract changes (vs domain-map § inventory — all additive; domain-map not edited from this branch)

1. `consume` adds `onShortfall: 'reject' | 'record_conflict'` (spec proposal 1), `kind` (`stay | block_allocation |
   import`), `preferUnitId` (composites); returns `{ applied, nights, overbookingAllowanceIds, conflictIds,
   assignedUnitId }` instead of `void`. Re-applying the same consumption is a no-op; a different quantity is
   rejected (`consumption_mismatch`).
2. `release` returns what it released; without `nights` it also releases the ref's active holds. Releasing nights
   also removes the ref's unit assignment for those nights (one set of facts).
3. `changeConsumption(tx, { ref, from: { unitTypeId, nights }, to: { unitTypeId, nights, quantity? }, overbooking?,
   onShortfall?, reason?, preferUnitId? })` — unchanged nights keep their assignment.
4. New `transferConsumption`, `releaseHold`, `extendHold`, `getHold`, `expireDueHolds` (spec proposals 2–3).
5. `createHold` returns `{ holdId, expiresAt }`; `convertHold` returns the consumption result.
6. `assignUnit` adds `locked/lockReason`, `upgrade: { reason, chargeable }`, `overrideLock` (spec proposal 5), requires
   the ref to have consumption on the nights, moves an existing assignment of the ref, refuses to break a combined-unit
   hold/sale unless `allowCompositeConflict`, returns `{ change, unitId, previousUnitIds, upgradedFromUnitTypeIds,
   conflictsCreated }`. `unassignUnit` adds `overrideLock`, `reason`, and refuses composite stays.
   `UnitAssignmentConflictError`: `err.conflicts` and `details.conflicts` are exactly `{ ref: EntityRef; nights:
   DateRange }[]` (one entry per conflicting assignment, nights = the overlap); `conflictDetails` adds `unitId` and
   `unitNumber`.
7. `blockUnit` returns `{ blockId, block, affectedAssignments, conflictsCreated }` (spec proposal 7); affected items
   carry `unitId` and `viaCompositeUnitId`; never fails for sold-out nights. New `previewBlock`.
8. `releaseBlock` adds `reason`, `expectedVersion`; releases from max(block start, business date).
9. New `setOverbookingAllowance`, `listOverbookingAllowances`, `listConflicts`, `getConflict`, `updateConflict`
   (spec proposals 4, 6), `getAvailabilityGrid`, `listAssignments`, `listBlocks`, `getBlock`, record getters.
10. `findAssignableUnits` adds `features`, `ref`, `includeUnavailable`; returns ranked `UnitCandidate`s with reasons.
11. `inventory.availability.changed` payload is per unit type with a `range` (decided shape) instead of the spec's
    `cells` list.
12. The provider is a bound object: `createInventoryService({ platform })`.
13. Every write checks the `availability` authority (out-of-order/out-of-service also `maintenance`); new
    `applyExternalAvailability` is the mirroring path for the system-of-record connection.
14. New `expireDueAllowances`, `checkLedgerConsistency`, `previewUnitChange`; grid adds `houseTotals`, `lastSyncAt`,
    per-cell `sellable`; explanation adds `lastSyncAt`; horizon raised to 731 nights.
15. Deviation from INV-R06 (to add to the spec): a `record_conflict` sale of a combined unit with none free is
    consumed unassigned and opens a conflict on the combined cell (`unassignedSold`), because a channel booking must
    never be dropped.

## Known gaps

* Effective-dated re-typing (INV-R03), auto-assign (INV-R23), extending/shortening a block in place, multi-unit block
  dialog by location (UI can loop `blockUnit`; no single multi-unit preview yet), localized unit type names,
  approval-based overbooking via identity approvals (`authorizedBy` is recorded as given; the acting user must hold
  the permission).
* `transferConsumption` leaves an ad-hoc overbooking allowance linked to the source ref (review INV-18, P3).
* Block placement and release share `inventory.block.manage` (review INV-24: no separate release permission yet).
* Operations calling `blockUnit` with an engineer's context needs `inventory.block.manage` in that role, or a system
  context for the provider call — to settle when operations is wired.
* Composite types: one composite unit per ref (stays); group blocks of composite types need one ref per residence.
* Forward-mode writes to an external system of record are refused until integration provides forwarding.
* Spec §4.2 block states `scheduled/active/completed` are derived (`status.phase`) rather than stored.

## Competitive parity status (for `docs/parity/inventory.md`, which lives on another branch)

Rows now **tested** (test file → evidence): PAR-INV-008/047 (composite), 020/022/023 (grid, explanation, strongly
consistent reads), 021 (house totals: `regression-review.test.ts`), 025/027/057/063 (allowances, ad hoc, conflicts,
`record_conflict`), 032 (731-night horizon), 036/037/038 (holds, sweeper, policy-gated extension), 040/041/042/044/046/
048 (assignments, unassign, search, locks, upgrades, blocked units excluded), 049/050/053/054 (blocks, preview),
059/060/061 (S01, all-or-nothing, idempotency), 062 (consistency job), 065 (audit + record history), 067 (connected
mode), 005 (accessible units ranked last unless requested — ranking only), 011 (lifecycle preview).
Edge cases tested: EC-INV-001–006, 008, 009, 013, 015, 016, 018, 020, 023, 025, 028, 029; EC-INV-010 behaves as
expected except that the refusal does not yet name the component's stay.
**Deferred / different** (with reason): PAR-INV-010 / EC-014 re-typing (SHOULD, next wave); PAR-INV-024 per-type
caps against the house total are a distribution rule — inventory exposes `houseTotals.sellable`; PAR-INV-052 /
EC-007 multi-unit block with one preview (next wave; UI loops); EC-017 lowering an allowance below what is sold is
*refused* with the cells listed (different: never creates conflicts silently); PAR-INV-064 separate block-release
permission (different for now: one `block.manage`); PAR-INV-002/013/026/028/031/039/043/045 and EC-012/030/034 not
built in wave 1.

## Open questions for the owner

None. Product decisions taken from the spec: composites are sold assignment-first; out of order is never refused
for sold-out nights; lowering an allowance below what is sold into it is refused.


## Port surface for other modules (ADR-0015, integration step)

`inventoryProvider(service)` (`src/provider.ts`) is what the composition root binds for reservations and operations: every function takes the property the caller authorized; inventory grants its own read/assignment/block keys at that property only (kernel `delegateAtProperty`), verifies that every referenced unit, block, hold, unit type and ref belongs to it (`scope_mismatch`), keeps overbooking explicit (the `overbooking` argument) and never delegates house-use blocks or lock overrides. Inventory's HTTP routes keep its own permissions. Proven in `test/provider-port.test.ts`. Unit and unit-type events now carry `aggregateVersion`.
