# Steward review: `feat/inventory-core` (module `inventory`)

Worktree `/home/user/wt/inventory` at 94ebd21, compared with `main` at b484de3. Spec: `docs/specs/inventory.md` on main.
Reviewer: architecture steward. I did not modify the worktree. My counterexample tests were run only in a scratch copy:
`/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-inventory-copy/modules/inventory/test/zz-review-counterexamples.test.ts`

## Verdict: **merge after fixes** (cannot merge as it is)

The architecture is sound and the consume path is solid:
- lock order is one global order;
- the check happens on locked rows;
- version-guarded writes;
- a real interleaved S01 test.

Composite availability counting is also correct. A residence sale and an assignment of one of its villas, run
concurrently, never both succeed (CE4).

The **release side of the ledger can be corrupted**, though. A release reads its rows *before* it takes the locks,
and it does not exclude expired holds. I wrote 8 counterexample tests (CE1–CE8) and seven of them (all except CE4)
reproduce a defect:
- an oversell with no conflict record;
- a cancellation that fails with a raw database error;
- a hold converted twice;
- a residence hold made unconvertible;
- an oversold cell with no conflict record.

There is also a P1 architecture gap. Nothing checks the `availability` data authority before `consume`, holds or
assignments. Spec §14 and ADR-0014 both require that check.

The fixes are local, so this does not need a redesign. Fix the P0s and P1s, then add CE1–CE8 as regression tests.

## Command results (PORTICO_TEST_DB_PREFIX=review_inventory, DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass (lockfile up to date) |
| `pnpm lint` | pass: biome clean; "Module boundaries OK (3 modules checked)" |
| `pnpm typecheck` | pass (9/9 tasks) |
| `pnpm --filter @portico/inventory test` | pass: 11 files, **74 tests** (matches the README: 30 domain + 44 integration) |
| `pnpm --filter @portico/api test` | pass: 4 files, 17 tests (6 of them inventory) |
| `node tools/parity-report.mjs --gate inventory` (in `/home/user/wt/parity-front`) | **FAIL**: 69 capabilities, 1% tested; 34 edge cases, 0% tested; **53 P0 not tested, 19 P1 missing** |

### Counterexample tests (scratch copy)

| Test | Setup | Observed |
|---|---|---|
| CE1 | One cart hold expires and nobody sweeps it. Then `release({ref: cart})` | Release fails with `new row for relation "ledger" violates check constraint "ledger_held_check"`, which is a raw DB error (HTTP 500). The cancellation is impossible until the sweeper runs. |
| CE1b | As CE1, plus a second, still-active hold on the same cell | `held` goes 2 → 0 (decremented twice). Both villas then sell while hold 2 is still active. `convertHold(hold2)` then fails with `ledger_held_check`. **0 conflicts recorded.** Ledger check: `held:0, holds:1`. |
| CE2 | Two truly concurrent `release({ref: A})` calls; B waits on A's lock (shown in `pg_stat_activity`). Stay B is still in house. | Both succeed. `sold` goes 2 → 0. Two later sales succeed, giving **3 consumption rows on a 2-villa night**. The cell says `sold:2, status:'sold_out'`. **0 conflicts.** |
| CE3 | Residence hold exists. Two villa stays are assigned to P01 (R1) and P03 (R2). | Both `assignUnit` calls return `change:'assigned'` with no warning. The residence cell is `oversold` (unitLimit −1). `convertHold` → `InventoryUnavailableError hold_not_convertible`. |
| CE4 | Residence sale races an assignment of component P01; the wait is shown in `pg_stat_activity` | Correct: the assignment succeeds, the sale gets `InventoryUnavailableError`, and there is one assignment row. |
| CE5 | Two concurrent `convertHold(sameHold)` calls for two different refs | **Both succeed** (`applied=true` twice). The second one silently becomes a fresh sale instead of `hold_already_converted`. |
| CE6 | `changeConsumption` shortens stay A's 10–13 Nov booking to 10–12 Nov. At the same time, `release(A, nights 12–13)` runs. Another stay is still on night 12. | Night 12 shows `sold:0, available:2`, although one stay still consumes it. |
| CE7 | A standing allowance (1) with an expiry; 2 sales on 1 villa; the allowance expires | The grid shows `status:'oversold', oversoldBy:1, conflictId:null`. **0 conflicts** (INV-I03 violated). |
| CE8 | `unassignUnit` on a residence stay | Allowed. The composite stay is now unassigned (`unassignedSold:1`), which INV-R06 forbids. |

## Findings (ranked)

| ID | Sev | Where | Problem | Why it matters | Fix |
|---|---|---|---|---|---|
| INV-01 | **P0** | `src/service/consumption.ts:489-503, 558, 578-589`; `src/service/ledger.ts:126-131, 186` | `release(ref)` reads the ref's holds with `status='active'` but keeps holds that have already expired. `LedgerSession.open` then lazily expires them (held −q). The loop at :578 subtracts held −q **again**. The `update … set status='released'` at :584 has no `status='active'` guard, so it also overwrites `expired`. | This happens in one transaction, with no concurrency needed (CE1/CE1b). Either the cancellation fails with a raw DB error, or `held` under-counts and the hotel oversells with no conflict record. INV-I02 and INV-I09 are broken. The window is 60 s when the sweeper runs, and unbounded when it is down (EC-INV-009). | Read the holds **after** `LedgerSession.open`, with `FOR UPDATE` and `status='active'`. Close them with `update … where status='active' returning …` and adjust `held` only for the rows actually returned. Add CE1/CE1b as tests. |
| INV-02 | **P0** | `src/service/consumption.ts:472-503` (reads) vs `:558` (locks); `:559-577` | `releaseInternal` reads consumption, allowance and hold rows *before* it takes the ledger locks. A second releaser of the same ref waits on the lock. It then subtracts the stale quantities again. Its `delete … where id in` deletes 0 rows but the adjustment has already been applied. | `sold`, `held` and the allowance are decremented twice, which gives phantom availability and an **oversell with no conflict** (CE2, CE6). S11 ("block allocation release returns inventory exactly once") is broken under concurrency, for example a groups cut-off job plus a manual release. The safety claim currently depends on every caller serializing for inventory. | Lock first, then read: derive the target cells from a first read, open the session, re-read the rows under the lock, and compute deltas only from the re-read. Simpler alternative: `delete … returning quantity` and `update … where status='active' returning`, adjusting from what was returned. Add concurrent tests that prove the wait in `pg_stat_activity` (CE2, CE6). |
| INV-03 | **P1** | `src/service/consumption.ts:75-79`; `src/service/holds.ts`; `src/service/assignments.ts`; README § "Authorization decision"; `test/isolation-permissions.test.ts:334-349` | `consume`, `release`, `changeConsumption`, `transferConsumption`, the hold functions, ad-hoc overbooking and `assignUnit` **never call `assertWritable(availability)`**. The connected-mode test actually requires `consume` to succeed in `forward` mode. | This contradicts three sources. Spec §14: "Disabled: consume, holds, overbooking allowances, conflicts — `assertWritable(availability)` returns external_system_of_record"; "Assignments mirror the PMS (read-only)". CLAUDE.md §4.15. ADR-0014: "Services call `platform.assertWritable` before writes". The reservations worktree checks only `'reservations'` (`bookings.ts:1049`, `channel.ts:369`, `authority.ts:44`), not `'availability'`, so **no one checks it**. Distribution and groups callers would also bypass it. In connect-alongside mode, Portico would keep a split-brain ledger next to the PMS. | Keep the half of the decision that says inventory does not re-check *permissions* for provider calls. Reverse the *authority* half. Inventory owns `availability` and must gate every ledger and assignment write with `guardAvailabilityWrite` (allowing `origin.connectionId` for mirrors and imports). Flip the forward-mode test to expect a refusal. |
| INV-04 | **P1** | `src/service/assignments.ts:176-238, 258-264`; README § Composite ("both views therefore always agree"); `test/composite.test.ts:235` | An ordinary stay can be assigned to a component villa even when that consumes the only free composite needed by an active residence hold (or an unassigned composite sale). `finish()` opens a conflict on the composite cell, but `assignUnit` neither refuses nor reports it: `AssignUnitResult` has no `conflictsCreated`. | A residence quote or option becomes unconvertible because a desk agent chose P03 instead of P02 (CE3). The README and the test name claim holds cannot be made unconvertible, and that claim is only true for *sales*. | In `assignUnit`, compute the composite `unitLimit` before and after. If it would go below zero, refuse with `composite_hold_at_risk` and name the hold and alternatives, or require an explicit override. Also return `conflictsCreated`. Add a test. |
| INV-05 | **P1** | `src/service/holds.ts:213-241` | After locking, `if (locked.status !== 'active')` treats `converted` and `released` as if the hold had just expired, and tries a fresh sale. | A double-submitted cart or quote produces **two bookings** from one hold (CE5). This breaks the `hold_already_converted` contract and idempotency (CLAUDE §4.7). | Under the lock, branch on status. For `converted`, return idempotently when it is the same ref and throw `hold_already_converted` otherwise. For `released`, throw `hold_not_active`. Fall back to a fresh sale only for `expired`. |
| INV-06 | **P1** | `src/errors.ts:66-70` vs domain-map §inventory (`UnitAssignmentConflictError { conflicts: EntityRef[] }`) and `/home/user/wt/reservations/modules/reservations/src/ports.ts:554-560` | `details.conflicts` is `{ref, unitId, unitNumber, nights}[]`. The reservations helper casts `details.conflicts` to `EntityRef[]`. | Reservations will show `undefined` refs in the S03 / room-move UX. This is a provider/port contract mismatch. | Put `conflicts: EntityRef[]` in `details` (as the domain map says) and add `conflictDetails` alongside it. Or change both the domain map and reservations in the same merge. |
| INV-07 | **P1** | `src/service/ledger.ts:276-292` (lazy expiry only); `src/service/reads.ts:127` | Allowances that reach `expires_at` are removed from reads but expire only when a command touches the cell. No job sweeps them, so an oversold cell has no conflict, owner or event (CE7). | Violates INV-I03 ("no oversold cell without a conflict record") and EC-INV-016, a P0 row in the parity matrix. The conflict queue does not show the problem. | Extend `inventory.expireHolds` (or add a sibling job) to expire due allowances through `LedgerSession`, so that `reconcileConflicts` runs. Add a test. |
| INV-08 | **P1** | `/home/user/wt/parity-front/docs/parity/inventory.md` (separate branch); gate output above | The gate fails: 53 P0 not tested, 19 P1 missing. The matrix was written before this code ("Code on main: none"). Many rows are now really implemented and tested but not referenced: PAR-INV-020/022/023/025/027/036/037/040–042/044/046–050/053/054/057/059–061/063/065/067 and EC-INV-001–006/008/009/010/013/015/018/023/025. **Real P0 gaps:** house total (PAR-INV-021; EC-INV-020 is `missing`); accessible-unit protection from casual reassignment (PAR-INV-005); lifecycle change with a preview of affected stays (PAR-INV-011: the code refuses instead); ≥ 400-night horizons and day/week/month views (PAR-INV-032: the grid caps at 400 nights); EC-INV-016 (INV-07); EC-INV-028 (INV-11). | CLAUDE.md §7: the module is not complete until the gate passes. | After merging parity-front, fill the Test column with test file and name for the implemented rows. Build or explicitly defer (with a reason) the gaps listed. Re-run the gate. |
| INV-09 | P2 | `src/service/assignments.ts:320-355` | `unassignUnit` lets a composite stay become unassigned (CE8). | INV-R06: "leaving a composite stay unassigned is not [allowed]". Reassignment may fail later. | Refuse `unassignUnit` for composite-type assignments unless the change is a move. Assigning another composite unit is still allowed. |
| INV-10 | P2 | README § Invariants ("assertLedgerConsistent runs after every integration test file") | There is no production consistency check. The spec says INV-I02 is "verified by a consistency check job". PAR-INV-062 and EC-INV-029 cover the same. Drift paths now exist (INV-01/02, CE6). | Silent drift means oversells nobody sees. | Add a periodic `inventory.checkLedger` job that compares `sold`/`held` with Σ consumption and active holds per organization, and raises an urgent exception (no auto-fix). |
| INV-11 | P2 | `src/service/blocks.ts:224`; `routes.ts` `POST /properties/:propertyId/unit-blocks` | Blocks check only `availability`. The README says `maintenance` authority is checked by operations, but inventory's own HTTP route lets staff place out-of-order blocks directly, bypassing operations. | When `maintenance` is external, the out-of-order block is not forwarded or disabled (EC-INV-028, a P0 parity row; CLAUDE §4.15). | In `blockUnit` (or at least on the HTTP path), also call `assertWritable(maintenance)` for `out_of_order`/`out_of_service`, unless `origin` is the mirroring connection. |
| INV-12 | P2 | `src/service/reads.ts:257-260, 498-500` | Provenance `external` has no last-sync time. It also labels Portico's *local* ledger as `external`, although nothing mirrors the external system's availability counts into it. | CLAUDE §4.16 requires `external` "with last-sync time". Spec §14 says "last update 14:02". Staff would trust counts that are not the PMS's. | Until a mirror feed exists, return `incomplete` (or hide the counts) when authority is external, and add `lastSyncAt` from the integration/authority record. |
| INV-13 | P2 | `src/service/holds.ts:21, 369-400`; `src/manifest.ts:130-133` | `extendHold` has no permission gate "beyond policy maximum" (INV-R17 MUST). The 180-day cap is a code constant rather than a policy. The manifest says `availability.manage` lets a user "Manage holds", but no hold function checks it. | This is a partial MUST, and the permission description misleads admins. | Read the maximum from `platform.resolvePolicy`. Require `inventory.hold.extend` (or `availability.manage`) beyond it. Fix the description. |
| INV-14 | P2 | `src/service/ledger.ts:553-567` vs spec §7 (`cells`) and `/home/user/wt/reservations/modules/reservations/src/service/subscriptions.ts:70-77` | `inventory.availability.changed` carries `{unitTypeId, range}`, but reservations' waitlist consumer reads `payload.cells`. | Reservations falls back to scanning *every* waitlisted stay on every availability event. It still works, but the contract is inconsistent. | Decide one shape in the domain map (per type + `range` is fine for distribution's DST-R04). Update the reservations consumer, or also emit `cells`. |
| INV-15 | P2 | `src/contracts.ts:263-279` (grid) | There is no house total, and composite types appear as separate cells, so summing `sold`/`capacity` across types double-counts residences together with their villas. | PAR-INV-021 is P0. Day-close and analytics need physical totals. | Add `houseTotals` per night computed over non-composite types only, and document that composite `sold` is not physical occupancy. |
| INV-16 | P2 | `test/*` | Truly concurrent tests cover `consume` only. Release, holds, convert, assign and change paths have none, and INV-01/02/05 slipped through as a result. The S01 residence-vs-villa race (`scenario-s01…:232`) uses `Promise.allSettled` with no proof of interleaving (CE4 confirmed the behavior for the assignment path). | Checklist #4 ("genuinely concurrent tests"). | Add gated-interleave tests (pattern of S01 test 1) for release×release, release×change, convert×convert, release×sweeper, and residence-sale×villa-sale. |
| INV-17 | P3 | `src/service/holds.ts:273-292` | `convertHold` to a ref that already consumes those cells hits the unique key and surfaces as a raw 23505 error. Found by reading the code; not tested. | The error is unhelpful (500). | Pre-check, or map the error to `consumption_mismatch`. |
| INV-18 | P3 | `src/service/consumption.ts:834-852` | `transferConsumption` moves quantity but leaves the ad-hoc allowance (`ref = from`) and `overbooking_allowance_id` with the source ref. Releasing the block at cut-off then revokes an authorization that the picked-up stay is using. | A spurious conflict appears after pickup. | Move or split the allowance link with the transferred quantity. |
| INV-19 | P3 | `src/service/catalog.ts:631-653` | `createCompositeUnit` checks the "same mix" rule before it takes the type lock. Two concurrent creations can store different mixes. | Breaks the `perType` assumption (the structure is taken from the first unit only). | Take `lockTypesForCapacityChange([type.id])` before the mix check. |
| INV-20 | P3 | `test/harness.ts:146-184`; FOUNDATION_REQUESTS #1 | Main b484de3 already fixed `TestDatabase.drop()` (bounded wait plus an error listener). | `dropTestDatabase` is now redundant duplication. | Use `t.drop()`. Move `adminQuery`/`waitFor` to `packages/testing` if other modules need them. |
| INV-21 | P3 | `apps/api/src/seed/demo.ts:36`; `apps/api/test/inventory.test.ts:301` | `DEMO_SEED_STEPS` is still empty. The test pushes the inventory step temporarily. | `pnpm seed:demo` does not include the R2 "Maldives demo inventory". | Register `{ name: 'inventory', run: inventoryDemoSeed }` at merge. |
| INV-22 | P3 | `src/jobs.ts:22-23`; `migrations/0002_hold_expiry_routing.sql` | The job queries `platform.tenant_environment` with raw SQL instead of a port (the same as worker and identity). It also adds a module-level `SECURITY DEFINER` routing function. | Every sweeper will copy this pattern. | Promote a generic foundation routing helper (e.g. `core.tenants_with_due(schema, …)`), or approve the pattern explicitly in an ADR. |
| INV-23 | P3 | branch-wide | The domain map (FOUNDATION_REQUESTS #2) and `docs/readiness/readiness-register.md` are not updated. README R3 claims for R09–R17 overstate the release and holds paths until INV-01/02/05 are fixed. | Readiness must not exceed the evidence (§7). | Lower the release/holds rows to R2 ("known defects") until the fixes land, then restore R3 with the regression tests. |
| INV-24 | P3 | `src/manifest.ts` vs spec §8 | Permission keys are coarser than the spec (documented in the README). `block.manage` covers both creating and releasing blocks, so PAR-INV-064 (separate block-release permission) is only partly met. | Hotels cannot let maintenance place blocks while reserving their release to a supervisor. | Add `inventory.unitBlock.release` (or record a `different` decision in parity). |
| INV-25 | P3 | `src/service/consumption.ts:291-301`; README § Composite | A `record_conflict` composite sale with no free unit is consumed *unassigned*, which deviates from INV-R06. | It is documented and reasonable, but the spec does not say it. | Add it to the spec when folding the contract changes in. |

**Counts:** P0 2 · P1 6 · P2 8 · P3 9.

## Assessment of FOUNDATION_REQUESTS.md

1. **`TestDatabase.drop()` race.** Already resolved on main by b484de3: a bounded wait for backends plus an error
   listener on the client that drops the database. It does not add the pool `error` listeners that were proposed;
   the wait makes them unnecessary in practice. **Accept as done.** The module should delete its `dropTestDatabase`
   workaround after merge (INV-20).
2. **Fold the contract changes into the domain map.** **Accept, with amendments**:
   - the domain map must say that consume, holds and assignments are gated on `availability` authority (INV-03);
   - align the `UnitAssignmentConflictError.details.conflicts` shape (INV-06);
   - choose one payload for `inventory.availability.changed` (INV-14);
   - document the `createInventoryService({ platform })` binding;
   - record the extra functions (`transferConsumption`, `previewBlock`, `getAvailabilityGrid`, record getters);
   - record the documented deviation for unassigned composites (INV-25).

## The data-authority decision, checked against ADR-0014 and the adoption docs

The README makes two decisions under "Authorization decision for provider calls".

**No inventory *permission* re-check for provider calls: agree.** The caller's command permission governs, and the
sensitive overbooking permission is still enforced.

**No `availability` *authority* re-check: disagree.**
- ADR-0014: "Services call `platform.assertWritable` before writes."
- CLAUDE.md §4.15: "Before writing in such a domain, call `platform.assertWritable(tx, propertyId, domain)`."
- Inventory spec §14: "Disabled: `consume`, holds, overbooking allowances, conflicts — `assertWritable(availability)`
  returns `external_system_of_record` … Assignments mirror the PMS (read-only)."
- Adoption brief §2: "Prevent competing systems from independently modifying the same information."

`reservations` and `availability` are separate domains with separate authorities. The reservations spec says
reservations "respects `availability` (no local consumption when external)", yet the reservations worktree checks
only `reservations`. Distribution and groups will call `consume` too. The domain owner is the only reliable choke
point, so inventory must enforce it (INV-03). The current test (`isolation-permissions.test.ts:334`) codifies the
violation.

## Spec coverage (MUST unless noted)

| Req | Status |
|---|---|
| R01 | Partial: `name` is not localized (README known gap) |
| R02, R04, R05, R08, R09, R10, R11, R18, R19, R20, R21, R24, R25, R28, R29 | Implemented and tested |
| R06 | Partial: composite stays can be unassigned (INV-09), and `record_conflict` sales stay unassigned (INV-25) |
| R07 | Counting correct; hold protection incomplete against assignments (INV-04) |
| R12 | Atomic, but the release half corrupts the ledger (INV-01/02, CE6) |
| R13 | Implemented; allowance link edge case (INV-18) |
| R14 | Correct sequentially and for concurrent duplicate `consume` |
| R15 | Implemented |
| R16 | Implemented, but release-by-ref double-counts expired holds (INV-01) |
| R17 | Partial (INV-13) |
| R22 (SHOULD) | Done; adjacency hints limited to composite membership |
| R26 | Done; no approval-from-identity path (documented) |
| R27 | Done, except conflicts on allowance expiry (INV-07) |
| R03, R23 (SHOULD) | Not built (documented) |
| R30 (LATER) | Not applicable |

| Invariant | Status |
|---|---|
| I01, I04 (consume), I05, I06, I08, I10 | Hold |
| **I02** | Broken (INV-01/02); no consistency job (INV-10) |
| **I03** | Broken on allowance expiry (INV-07) |
| I07 | Holds |
| I09 | Holds for reads and sales, broken on the release-by-ref path |

| Section | Status |
|---|---|
| §14 connected mode | Catalog, blocks and allowances guarded; **consume, holds and assignments not guarded** (INV-03); provenance lacks last-sync (INV-12) |
| §9 multi-unit out-of-order by location | Not built (documented; UI loops) |

## Scenario claims

- **S01** (`scenario-s01…`): the claim is genuine. B is observed waiting in `pg_stat_activity`, and 20 sellers for 3
  villas give exactly 3 sales. The residence-vs-villa race is not provably interleaved, but the behavior holds (CE4).
  The claim "ledger consistent" is proven only for `consume`. Releases can break it (INV-01/02).
- **S03**: the claim holds. Extension at type level, a conflict naming the other stay, alternatives, split, move, the
  lock override, and a sold-out type that leaves nothing changed.
- **S08**: the claim holds. Affected assignments, conflicts, updated explanations, resolution by relocation, and
  release.
- **S11** (not claimed, in spec §10): "returns inventory exactly once" is **false under concurrency** (CE2).
- **Composite test "villa sales cannot make it unconvertible"**: true as written. The README generalizes it to "both
  views always agree on the physical villas", which is false for assignments (CE3, INV-04).
- **Readiness**: everything internal is claimed at R3 or below, which is within the cap. The R3 for the
  release/holds rows should drop until INV-01/02/05 are fixed (INV-23). The demo is R2 only through test-time wiring
  (INV-21).

## Competitive parity

The parity file exists (`/home/user/wt/parity-front/docs/parity/inventory.md`, 69 capability rows and 34 edge-case
rows) and the gate **fails** (INV-08). Rows marked `tested`: none (the matrix was written before this code).

These competitor capabilities are absent from the matrix and should be added (or marked `different`):
- OPERA **Room Conditions**: assignment-restriction codes (show room, VIP hold, "pending inspection") that block
  assignment without out-of-order or out-of-service and without affecting capacity.
- OPERA **pseudo / non-inventory room types** (PM rooms for master and house accounts): likely `different`, because
  finance owns house accounts.
- **Turnaway / denial (regret) capture** when inventory is unavailable (OPERA, most RMS-integrated PMSs). Cross-check
  with the reservations matrix.
- **Percentage-based overbooking levels** per type, class or house (OPERA overbooking by % of capacity). The matrix
  has absolute quantities only.
- **Availability snapshots** ("availability as of" date and time for disputes and day-close statistics): OPERA
  history/forecast. Possibly day-close-owned.

## Cross-module notes for the orchestrator

1. **Reservations `InventoryPort` vs the provider** (`/home/user/wt/reservations/modules/reservations/src/ports.ts:99-205`).
   Composition needs adapters, and two items are real contract decisions.

   Contract decisions:
   - `UnitAssignmentConflictError.details.conflicts` shape (INV-06).
   - `inventory.availability.changed` payload: reservations reads `cells`, inventory emits `range` (INV-14).

   Adapters:
   - `explainAvailability`: the port expects `consumers[{ref, quantity, consumedAt}]`; the provider returns
     `sold[{ref, quantity, kind}]`.
   - `findAssignableUnits`: the port's `UnitCandidate` has `{name, reason?, conflictingRefs?, fitScore?}`; the
     provider has `{number, name|null, exclusions[], score, ranking}`.
   - `listUnits` and `listUnitTypes`: the port takes `(tx, {propertyId})`; the provider takes `(tx, propertyId, filter?)`.
   - `getUnit`: the port's `UnitSummary.name: string` maps to the provider's `number` / `name|null`.
   - Composite `consume` requires `quantity: 1` per ref. Reservations must split multi-residence bookings into one
     ref per residence.
   - `assignUnit` additionally requires `inventory.assignment.manage` (role templates grant it to the desk).
2. **Operations `InventoryPort`** (`/home/user/wt/operations/modules/operations/src/ports.ts:41-66`):
   - `blockUnit` and `releaseBlock` are compatible.
   - `listUnits(tx, {propertyId})` expects `{number, unitTypeCode, locationPath, active}`, so an adapter is needed.
   - The `maintenance` authority responsibility is split between operations and inventory's own HTTP route (INV-11).
3. **Rates** (`/home/user/wt/rates/modules/rates/src/ports.ts:42-44`): the optional `listUnitTypes(tx, propertyId)`
   matches the provider signature. Map `RatesUnitType` fields at composition.
4. **Data authority gap across modules**: nobody checks `availability` today (INV-03). Decide at merge that inventory
   enforces it. Distribution and groups ingestion then pass `origin` only for the mirroring connection.
5. **Shared-code candidates** for `@portico/db` (or `@portico/testing` for the test helpers):
   - `withSavepoint`: inventory `src/service/context.ts:128` and payments `src/service/ledger.ts:11`.
   - `pgCode`: inventory `context.ts:112` and guests `src/service/internal.ts:32`.
   - `requireAnyPermission`.
   - Test helpers `adminQuery` and `waitFor`.
   - A generic `SECURITY DEFINER` tenant-routing helper for sweepers (INV-22).
6. **Day-close and analytics**: composite `sold` and component `sold` both count one residence sale. Physical totals
   must use non-composite types only (INV-15).
