# Agent run: Wave1: inventory module

- Started: 2026-11-07T07:32:35.534Z · last activity: 2026-11-07T11:38:19.196Z
- Turns: 405 · tool uses: 216 · output tokens: 990,965
- Type: general-purpose

## Brief (2026-11-07T07:32:35.534Z)

````text
You are the engineer for Portico's **inventory** module (wave 1). First read the shared playbook at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/wave1-playbook.md and follow it exactly.

Your worktree: /home/user/wt/inventory (branch feat/inventory-core). Test DB prefix: PORTICO_TEST_DB_PREFIX=w1_inventory. Module path: modules/inventory (package @portico/inventory, Postgres schema `inventory`). Spec: /home/user/wt/product/docs/specs/inventory.md.

Build (provider contract in docs/architecture/domain-map.md § inventory):
- Unit types (room/villa/suite/apartment/bed/tent/pitch kinds; max occupancy, adults/children limits, features), units (number, location: building/floor/island zone, features, sort order), unit features catalog.
- Composite units / connecting rooms: selling or assigning a composite consumes its components and vice versa. Type-level availability of composite and component types must stay consistent (explain your model in the README).
- Availability ledger per unit type per night with capacity, out-of-order count, sold, held, authorized overbooking allowance. consume/release/changeConsumption/createHold/convertHold/hold expiry. Guarded updates in deterministic lock order so two concurrent sellers of the last unit get one success and one InventoryUnavailableError with shortNights (scenario 1 — prove it with truly concurrent transactions in a test).
- Authorized overbooking: explicit allowance with who/why, distinguishable from an inventory conflict (accidental negative availability, e.g. from channel bookings or OOO) — expose conflicts as data.
- Assignments: specific unit to a ref for a night range, enforced by an exclusion constraint (btree_gist) — overlapping assignment throws UnitAssignmentConflictError listing conflicts (scenario 3 core: an extension into nights where the assigned villa is taken must fail clearly and offer alternatives via findAssignableUnits).
- Unit blocks: out_of_order (reduces sellable capacity), out_of_service (not assignable, still counted), house_use (consumes inventory, no revenue). blockUnit returns affectedAssignments (scenario 8 core) and emits inventory.unit.blocked with them; releaseBlock.
- getAvailability (grid by type × date with breakdown), explainAvailability (why a type/night is available/unavailable/held/blocked/oversold — human-readable reasons + numbers), findAssignableUnits (respect blocks, assignments, composites, features).
- Respect data authority domain `availability` (platform.assertWritable) for configuration and manual inventory changes; consumption by reservations is authorized by the caller's own authority check (document your decision).
- Events per domain-map; availability.changed events must be coalescible (include unitTypeId + date range).
- HTTP routes for configuration (unit types, units, features, composites), availability grid, explanation, blocks, assignments (read), overbooking allowances. Permissions like inventory.unitType.manage, inventory.unit.manage, inventory.unit.read, inventory.availability.read, inventory.availability.manage, inventory.overbooking.authorize (sensitive), inventory.block.manage, inventory.assignment.manage.
- Plan limit `limits.units` (platform.getLimit) enforced when creating units.
- A seed helper that creates realistic Maldives demo inventory (e.g. 12-room guesthouse; 120-villa resort with beach/water/overwater/family villas incl. a 2-bedroom composite) exported for the demo seeder.

Scenario tests to include: s01 last unit concurrency; s03 assignment conflict on extension (inventory part); s08 maintenance block returns affected assignments; plus isolation/permission tests.
````

## Follow-up message (2026-11-07T11:22:37.083Z)

````text
The coordinator sent a message while you were working:
Orchestrator: steward verdict on feat/inventory-core — "merge after fixes": P0 2, P1 6, P2 8, P3 9. Full report: /home/user/portico/docs/orchestration/reviews/review-inventory.md; reproducing counterexample tests CE1–CE8: /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-inventory-copy/modules/inventory/test/zz-review-counterexamples.test.ts — copy them into your test suite as regression tests (CE4 already passes).
Fix:
- INV-01 (P0): release(ref) double-subtracts an expired-but-unswept hold (consumption.ts ~489-503, 578-589) → raw ledger_held_check 500 or a second hold silently uncounted → oversell.
- INV-02 (P0): release reads rows before taking locks (vs :558); concurrent releases/changes double-subtract → 3 sales on a 2-villa night. Lock first (deterministic order), then read; make release exactly-once per ref/night.
- INV-03 (P1): DECISION — inventory must enforce `availability` data authority on consume/holds/assign (you own the domain; nobody else checks it). When an external system is the system of record, refuse direct sales with a clear explanation; mirrored external state is applied only through a dedicated path for the integration module (e.g. `applyExternalAvailability`). Update the connected-mode test accordingly.
- INV-04 (P1): assignUnit on component villas can make a residence hold unconvertible — refuse or report the conflict it opens.
- INV-05 (P1): concurrent convertHold both succeed → two bookings; converted holds must never be re-sold.
- INV-06 (P1): UnitAssignmentConflictError.details.conflicts must match domain-map: `{ ref: EntityRef; nights: DateRange }[]` (document precisely).
- INV-07 (P1): expiring overbooking allowance must create the conflict record when it lapses (job).
- INV-08 (P1): parity P0 gaps (house total across types, protected accessible units, preview of affected stays when a unit leaves inventory, availability beyond 400 nights, allowance-expiry / external-maintenance edge cases) — implement the cheap ones, mark the rest honestly.
- Event shape: keep your `inventory.availability.changed` `range` shape; document it as THE shape (reservations will adapt).
- Use main's new shared helpers `pgCode`/`pgConstraint`/`withSavepoint` from @portico/db and remove your copies; remove your test-drop workaround (fixed on main in b484de3).
Then `git merge --no-edit main`, lint/typecheck/tests, commit, and report back briefly.

Address this before completing your current task.
````

## Report (2026-11-07T08:23:29.945Z)

````text
## Inventory module (wave 1): built, tested and committed

The inventory module is built and committed on branch `feat/inventory-core` in `/home/user/wt/inventory` (nothing pushed). All checks pass: `pnpm lint` (including the boundary check), `pnpm typecheck`, 74 module tests in 11 files (run three times with no failures) and 17 tests in `@portico/api`. Main was merged three times as you asked.

**What it does**
- **Catalog:** unit types (room, villa, suite, apartment, bed, tent, pitch, other) with occupancy limits; units with building/floor/zone, features and dates when they enter or leave inventory; a feature catalog per property. The plan's `limits.units` is enforced when creating units.
- **Availability ledger:** one row per unit type per night. It supports consume, release, changing or transferring consumption, and holds (create, convert, release, extend). Expired holds are released whenever a command touches them, and a 60-second job sweeps the rest.
- **Last unit (S01):** the S01 test proves this with two truly concurrent transactions. Agent B is observed waiting on agent A's lock inside Postgres; then A succeeds and B gets `InventoryUnavailableError` with `shortNights`. Also tested: 20 agents racing for 3 villas, opposite-direction moves with no deadlock, and a residence vs one of its own villas.
- **Composite units** (e.g. two connecting villas sold as one residence): selling one assigns a specific residence and uses up both villas. The residence's availability is the smaller of its free residences and what its villas allow, so the two views never double-sell. The README explains the model.
- **Authorized overbooking vs conflicts:** overbooking is an explicit allowance recorded with who and why. Accidental overselling is recorded as a separate conflict that closes itself when the numbers fit again.
- **Assignments:** the database prevents overlaps. Supports locked assignments, upgrades and finding alternative units with reasons.
- **Blocks:** out of order, out of service and house use. Placing one never fails on sold-out nights; it returns the stays affected. Blocks can be previewed and released.
- **Reads:** availability grid and "why" explanations.
- **HTTP routes** for all of the above. Your later conventions are in too: status/actions/issues/links on the main records, the search provider, and record history.
- **Demo seed:** 12-room guesthouse, 120-villa resort with two two-bedroom residences, 64-room hotel, 24 apartments.

**Scenarios proven:** S01, S03 (inventory part), S08 (inventory part), S17 tenant isolation, plus property scope, permission per action, connected mode and the hold-expiry job.

**Decisions to know about**
- Selling and releasing inventory, and holds, don't re-check inventory permissions or `availability` authority; the calling module's own check governs them. Overbooking always needs `inventory.overbooking.authorize`.
- Catalog changes, blocks and allowances do check `availability` authority. In "forward" mode they are refused, because forwarding to the external system doesn't exist yet.

**Contract changes:** all additive, listed in the README. The domain map isn't updated because it's outside my write boundary.

**Ports and wiring:** the only port is platform, bound to the real provider, so nothing is stubbed. `composition.ts` exports `inventoryService` (bind other modules' inventory ports to it) and adds the hold-expiry job to `jobs`.

**For you at merge**
- **Demo seed:** register `{ name: 'inventory', run: inventoryDemoSeed }` in `DEMO_SEED_STEPS`.
- **Domain map:** fold in the contract changes from the README.
- **Test database drop:** `TestDatabase.drop()` can crash a test run when a file used many connections. I worked around it in my tests; the proposed fix is in `FOUNDATION_REQUESTS.md`.
- **Parity:** no parity catalogue exists for inventory yet (`docs/parity/inventory.md`).

**Not built:** moving a unit to another unit type from a future date, auto-assign, extending a block in place, overbooking via identity approvals, more than one residence per booking reference, localized unit type names.

**Risks:** the composite logic and the change-consumption/upgrade paths are the most complex parts, so they deserve a careful review.

Files are in `/home/user/wt/inventory/modules/inventory/`:
- `README.md`
- `FOUNDATION_REQUESTS.md`
- `migrations/0001_inventory.sql`, `migrations/0002_hold_expiry_routing.sql`
- `src/`
- `test/`

Plus `/home/user/wt/inventory/apps/api/src/composition.ts` and `/home/user/wt/inventory/apps/api/test/inventory.test.ts`.
````

## Report (2026-11-07T11:38:19.122Z)

````text
## Inventory review fixes: done on `feat/inventory-core` (head 1212d22, not pushed)

Both P0s and all six P1s from the steward review are fixed. Main is merged, lint (including the boundary check) and typecheck pass, inventory has 96 tests in 12 files (two clean runs back to back) and the API has 24. The seven failing counterexamples (CE1–CE3, CE5–CE8) now fail before the fix and pass after; CE4 already passed and is kept. They live in `modules/inventory/test/regression-review.test.ts`. Every concurrency test there proves the second transaction is waiting on the first one's lock.

**P0**
- **INV-01 and INV-02:** `release` and `changeConsumption` now take the locks first, then re-read the rows. They change the ledger only by what they actually delete or close. A concurrent release, change or the hold sweeper therefore never subtracts twice, and an expired hold is never released twice.
  - Covered by CE1, CE1b, CE2, CE6 and a new release × sweeper test.

**P1**
- **INV-03:** inventory now checks `availability` authority on every write, including consume, holds and assignments. The forward-mode test now expects refusal.
  - New `applyExternalAvailability` is the only write path while an external system is authoritative, and only that system's connection can call it.
  - Mirrored sales use `record_conflict`, so a difference shows up as a conflict rather than a refusal. The sync time is recorded.
  - Reads say `external` with `lastSyncAt`, or `incomplete` before the first sync (covers INV-12).
  - Out-of-order and out-of-service blocks also check `maintenance` authority (INV-11).
- **INV-04:** `assignUnit` refuses with `composite_hold_at_risk` if the assignment would break a residence hold or sale. `allowCompositeConflict` overrides it, and the result now includes `conflictsCreated`. A residence stay can no longer be unassigned (INV-09).
- **INV-05:** `convertHold` now checks the hold's status after it takes the lock. One hold now yields at most one booking. An expired hold is tried as a fresh sale and fails with "your hold expired and the inventory was sold" if the villa is gone.
- **INV-06:** `UnitAssignmentConflictError` `conflicts` and `details.conflicts` are now exactly `{ ref, nights }[]`; unit details are in `conflictDetails`.
- **INV-07:** the job `inventory.expireDue` also sweeps lapsed overbooking allowances and opens the conflict. Added an hourly `inventory.checkLedger` job that reports mismatches but never corrects them (INV-10).
- **INV-08 (cheap parity items built):**
  - house totals and a never-negative `sellable` per cell (INV-15);
  - a 731-night availability horizon;
  - `previewUnitChange` plus `POST /units/:id/preview-change`;
  - accessible units ranked last unless requested;
  - holds longer than the `inventory.hold.maxDays` policy (default 14 days) need `inventory.availability.manage` (INV-13);
  - the composite mix check now locks first (INV-19);
  - the S01 race now uses 50 sellers.

  The README has a parity status section: which rows are tested, which are deferred or different and why. I couldn't edit `docs/parity/inventory.md` because it is on another branch.

**Other requests**
- **Event shape:** the `range` payload is documented as the shape in `events.ts` and the README.
- **Shared helpers:** now imported from `@portico/db`; my local copies and the test-drop workaround are removed.

**Merge conflict in `composition.ts`:** guests and inventory now sit side by side. I filled the new `services.inventory` slot and registered the inventory demo seed in `demoSeedSteps`, ahead of guests, which also closes INV-21. Two new migrations, both unmerged: `0003_due_expiries_and_external_sync.sql` (sweeper routing functions plus a sync-time table) and the earlier `0002`.

**Still open:** INV-18 (transfer leaves an ad-hoc overbooking allowance on the source ref) and INV-24 (no separate block-release permission) are documented as known gaps. INV-22 (the sweeper routing pattern) is a foundation request.

**For whoever wires operations:** operations' engineer role doesn't have `inventory.block.manage`, so `blockUnit` called with an engineer's context will be refused. Either grant it to that role or use a system context for the call.
````

