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
* **Holds** count in `held` until converted, released or expired. Expired holds are released lazily by any command
  that locks their rows (the command first extends its lock set to every cell of such holds) and are already
  excluded from reads, so an expired hold never blocks a sale (INV-I09). The scheduled job `inventory.expireHolds`
  (every 60 s, `createInventoryJobs`, registered in `Composition.jobs`) finds organizations with due holds through the
  reviewed SECURITY DEFINER routing function `inventory.tenants_with_expired_holds` (tenant ids only,
  `migrations/0002_hold_expiry_routing.sql`) and releases them inside each organization's RLS-scoped transaction.
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
  component consumption. Both views therefore always agree on the physical villas (S01 race test proves a residence
  and one of its villas sold concurrently never both succeed).
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
| R09–R14 | Ledger, `consume` (all-or-nothing, lazy hold release, `onShortfall`), `release`, `changeConsumption`, `transferConsumption`, idempotent re-application | Done | R3 |
| R15–R17 | Holds: create, convert, release, extend, lazy expiry, scheduled sweeper, `inventory.hold.expired` once per hold | Done | R3 |
| R18–R21 | Assignments with exclusion constraints, upgrade moves consumption, locked assignments + override, not assignable when blocked/house use | Done | R3 |
| R22 (SHOULD) | `findAssignableUnits` with exclusion reasons, feature match, composite awareness, ranking | Done (adjacency hints limited to composite membership) | R3 |
| R23 (SHOULD) | Auto-assign service | Not built (reservations' arrival flow will call `findAssignableUnits` + `assignUnit`) | R1 |
| R24–R25 | Unit blocks: out of order / out of service / house use, affected assignments, conflicts, preview, release from the business date | Done | R3 |
| R26–R27 | Authorized overbooking (standing + ad hoc), inventory conflicts with causes/owner/resolution | Done | R3 |
| R28–R29 | `explainAvailability` (formula, units by state, sold refs, holds, allowances, conflict, composite notes, sentences), `getAvailability` grid ≤ 400 nights, strongly consistent | Done | R3 |
| — | Universal record contract (unit, unit type, unit block, conflict), search provider, record history | Done | R3 |
| — | Plan limit `limits.units` (physical units, organization-wide) | Done | R3 |
| — | Maldives demo inventory (12-room guesthouse, 120-villa resort with 2 two-bedroom residences, 64-room hotel, 24 apartments) | Done (`createInventoryDemoSeed`) | R2 |

Nothing here is external, so nothing claims beyond R3.

## Invariants and the tests that prove them

| Invariant | Enforced by | Proven in |
|---|---|---|
| INV-I01 one assignment per unit per night | `EXCLUDE USING gist (unit_id =, nights &&)` + a ref occupies one top-level unit per night | `scenario-s03…` (conflict), `composite.test.ts` |
| INV-I02 `sold = Σ consumption`, `held = Σ active holds` | single write path through `LedgerSession` | `assertLedgerConsistent` runs after **every** integration test file |
| INV-I03 no oversold cell without an open conflict | `reconcileConflicts` after every ledger change; unique open conflict per cell | `availability.test.ts`, `scenario-s08…`, `composite.test.ts`, `isolation-permissions.test.ts` |
| INV-I04 concurrent sellers: one success, one `InventoryUnavailableError` | lock order + check-then-write on locked rows | `scenario-s01…` (blocked transaction observed in `pg_stat_activity`; 20 sellers / 3 villas; opposite moves; composite vs component) |
| INV-I05 consume changes every night or none | checks before writes; savepoints for multi-step changes | `availability.test.ts` (short night, caller continues its tx), `scenario-s03…` |
| INV-I06 composite assignment has identical component rows | `placeAssignment` / `trimAssignments` | `composite.test.ts` |
| INV-I07 assignments on blocked nights are visible for resolution | block keeps `affectedAssignments`; record shows `outstandingAssignments` + blocking issues | `scenario-s08…`, API test |
| INV-I08 consumption unique per (ref, type, night) | unique key | `availability.test.ts` (idempotent re-apply) |
| INV-I09 expired holds never prevent a sale | lazy expiry on locked rows; reads exclude expired | `availability.test.ts` |
| INV-I10 authorized-overbooking consumption references an allowance | `consumptions.overbooking_allowance_id` | `availability.test.ts` |

## Scenarios covered

| Test file | Demonstrates |
|---|---|
| `test/scenario-s01-last-unit-concurrency.test.ts` | S01: two truly concurrent transactions for the last villa (B provably waits on A's row lock) → one success, one `InventoryUnavailableError { shortNights }`; 20 agents / 3 villas → exactly 3; opposite-direction moves never surface a deadlock; residence vs component villa race; coalescible `inventory.availability.changed` with unit type + range |
| `test/scenario-s03-extension-assignment-conflict.test.ts` | S03 (inventory part): extension succeeds at type level, assigning the same villa for the new nights throws `UnitAssignmentConflictError` naming the other stay, `findAssignableUnits` offers villas for the extra nights or the whole stay; split, whole-stay move, locked assignment override, type sold out → nothing changes |
| `test/scenario-s08-maintenance-block.test.ts` | S08 (inventory part): out-of-order blocks on several assigned villas return `affectedAssignments` (also in `inventory.unit.blocked`), open conflicts when nights oversell, explanation updates, blocked villas refuse assignment, relocation by upgrade/move resolves the conflicts, release restores capacity; OOS vs house use semantics |
| `test/composite.test.ts` | Composite model end to end |
| `test/isolation-permissions.test.ts` | S17 tenant isolation (by id, raw-SQL RLS), property scope, permission per action, connected mode |
| `test/availability.test.ts` | Catalog, consume/release/change/transfer, holds, overbooking vs conflicts, explanations |
| `test/hold-expiry-job.test.ts` | INV-R16: scheduled sweeper expires due holds across organizations, once, inside RLS |
| `apps/api/test/inventory.test.ts` | HTTP: idempotent creates, ETag/If-Match, record contract, grid, explanation, block preview/place/release + history, overbooking, search/summary, isolation over HTTP, demo seed through `DEMO_SEED_STEPS` |

Counts: 30 domain unit tests, 44 module integration tests, 6 API tests (`pnpm --filter @portico/inventory test`,
`pnpm --filter @portico/api test`, with `PORTICO_TEST_DB_PREFIX`).

## Permissions

| Key | Used for |
|---|---|
| `inventory.unit.read` | Read unit types, units, features, composite units, assignments, blocks |
| `inventory.unitType.manage` | Create/edit unit types and the feature catalog |
| `inventory.unit.manage` | Create/edit units and composite units, take units out of inventory |
| `inventory.availability.read` | Grid, explanations, conflicts, allowances |
| `inventory.availability.manage` | Take ownership of / mark conflicts as resolving |
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
ingesting a channel booking, groups picking up a block). They do **not** re-check inventory permissions or the
`availability` data authority: the caller's command permission (e.g. `reservations.booking.create`) and the caller's
own authority check (`reservations`) govern them, so a desk agent never needs inventory permissions to sell. The
exception is overbooking, which is a decision about inventory and always requires
`inventory.overbooking.authorize`. Assignment, blocks, allowances and catalog changes check inventory permissions.

## Data authority and adoption modes

* **Standalone:** yes (catalog + availability), depends on `platform` and `identity` only.
* **Connected mode** (`availability` external): configuration and manual inventory changes (features, unit types,
  units, composites, blocks, allowances) call `assertWritable(availability)`. `read_only` → rejected with
  `external_system_of_record`; `forward` → rejected with `forwarding_not_available` (no forwarding transport yet).
  An integration mirroring the system of record passes `{ origin: { connectionId } }` matching the authority's
  connection and is allowed (catalog-and-mirror). Reads carry `provenance: 'external'` (trial: `'copied'`) and
  explanations start with "Availability at this property is managed in <system>".
* `maintenance` authority is checked by operations before it calls `blockUnit`; inventory checks `availability`.

## Events

Emitted (outbox): `inventory.availability.changed` `{ propertyId, unitTypeId, range, coalesceKey, cause }` — one per
unit type per command, coalescible by `coalesceKey`; composite types built from a changed type are included ·
`inventory.unit.blocked` `{ blockId, unitId, unitTypeId, kind, nights, reason, sourceRef, affectedAssignments,
conflictsCreated }` · `inventory.unit.unblocked` · `inventory.assignment.changed` `{ ref, change, unitId,
previousUnitIds, nights }` · `inventory.hold.expired` · `inventory.conflict.detected|resolved` ·
`inventory.overbooking.authorized` · `inventory.unitType.changed` · `inventory.unit.changed`. Consumed: none.

## Ports

`PlatformPort` (`getBusinessDate`, `getDataAuthority`, `assertWritable`, `getLimit`) — bound to the real platform
provider in `apps/api/src/composition.ts`. The hold-expiry job resolves an organization's environment through the
whitelisted `platform.tenant_environment()` routing function. Inventory needs nothing from other wave-1 modules, so nothing is stubbed.
Composition also exports `inventoryService` (bind other modules' inventory ports to it) and `inventoryDemoSeed`
(register as `{ name: 'inventory', run: inventoryDemoSeed }` in `DEMO_SEED_STEPS`).

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
`POST …/unit-blocks/preview`, `GET /unit-blocks/:id`, `POST /unit-blocks/:id/release` · Overbooking
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
   the ref to have consumption on the nights, moves an existing assignment of the ref, returns `{ change, unitId,
   previousUnitIds, upgradedFromUnitTypeIds }`. `unassignUnit` adds `overrideLock`, `reason`.
7. `blockUnit` returns `{ blockId, block, affectedAssignments, conflictsCreated }` (spec proposal 7); affected items
   carry `unitId` and `viaCompositeUnitId`; never fails for sold-out nights. New `previewBlock`.
8. `releaseBlock` adds `reason`, `expectedVersion`; releases from max(block start, business date).
9. New `setOverbookingAllowance`, `listOverbookingAllowances`, `listConflicts`, `getConflict`, `updateConflict`
   (spec proposals 4, 6), `getAvailabilityGrid`, `listAssignments`, `listBlocks`, `getBlock`, record getters.
10. `findAssignableUnits` adds `features`, `ref`, `includeUnavailable`; returns ranked `UnitCandidate`s with reasons.
11. `inventory.availability.changed` payload is per unit type with a `range` (task requirement) instead of the
    spec's `cells` list.
12. The provider is a bound object: `createInventoryService({ platform })`.

## Known gaps

* Effective-dated re-typing (INV-R03), auto-assign (INV-R23), extending/shortening a block in place, multi-unit block
  dialog by location (UI can loop `blockUnit`), localized unit type names, permission-gated hold extension beyond a
  policy maximum (fixed cap: 180 days), approval-based overbooking via identity approvals (`authorizedBy` is recorded
  as given; the acting user must hold the permission).
* Composite types: one composite unit per ref (stays); group blocks of composite types need one ref per residence.
* Forward-mode writes to an external system of record are refused until integration provides forwarding.
* Spec §4.2 block states `scheduled/active/completed` are derived (`status.phase`) rather than stored.

## Open questions for the owner

None. Product decisions taken from the spec: composites are sold assignment-first; out of order is never refused
for sold-out nights; lowering an allowance below what is sold into it is refused.
