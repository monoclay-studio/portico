# Agent run: Steward review: operations module

- Started: 2026-11-07T11:15:48.634Z · last activity: 2026-11-07T11:36:02.440Z
- Turns: 209 · tool uses: 119 · output tokens: 241,151
- Type: general-purpose

## Brief (2026-11-07T11:15:48.634Z)

````text
You are Portico's architecture steward. Read and follow the review brief at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/steward-review.md exactly.
Branch under review: `feat/operations-core` in worktree /home/user/wt/operations — module `operations` (housekeeping, maintenance, tasks, service requests, lost & found, offline sync; spec: /home/user/portico/docs/specs/operations.md on main). Author's README: modules/operations/README.md. Focus extra care on: (a) the OFFLINE SYNC API (scenario s13) — try to make it apply a stale update silently or duplicate a mutation under concurrent submissions (experiment in a scratch copy, not the worktree); (b) separation of unit condition vs occupancy vs availability; return-to-service rules; (c) connected-mode forwarding for roomStatus/maintenance against ADR-0014 and /home/user/portico/docs/adoption/source-of-truth-matrix.md (housekeeping alongside an external PMS is the flagship standalone module — judge whether it truly works standalone); (d) task escalation correctness with time zones/business dates; (e) the InventoryPort contract vs the inventory branch provider (/home/user/wt/inventory/modules/inventory) — list mismatches precisely. Parity file: /home/user/wt/parity-ops/docs/parity/operations.md (exists, partial) — run the gate on a scratch copy and list important missing rows.
Do not modify the worktree; copy it to /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-operations-copy for experiments. Use PORTICO_TEST_DB_PREFIX=review_operations. Write your report to /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-operations.md.
````

## Report (2026-11-07T11:36:02.233Z)

````text
**Verdict: merge after fixes.** All P0s and P1-1 to P1-9 block the merge. Findings: **P0 2 · P1 12 · P2 22 · P3 14**. Full report: `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-operations.md`.

**Command results (worktree left clean)**
- `pnpm install --frozen-lockfile`, lint, typecheck (also re-run uncached for operations and api): all pass.
- `pnpm --filter @portico/operations test`: 15 files, 90 tests, pass. `pnpm --filter @portico/api test`: 4 files, 15 tests, pass.
- Merged with main@9363f2d: everything green, including main's new permission-catalog test.
- Main has since moved to c2bf70c (guests merged), and the branch now conflicts with it in `apps/api/src/composition.ts`. It is a trivial one-block-per-module conflict.
- Parity gate on the parity-ops matrix: **fails**. 98 capabilities with 1% tested, 48 edge cases with 0% tested, 61 P0 rows still open.

**Experiments.** I wrote 16 tests in the scratch copy. Each one asserts the defective behaviour, so all 16 passing means every defect below is reproduced. Five of them bind operations to the real inventory module from the inventory branch.

What held up: I could not make a mutation apply twice under concurrent submission. The per-mutation id claim serializes duplicates correctly, two devices editing the same unit concurrently produce one apply and one conflict, and the delta-feed pagination is sound.

**Top 5 findings**
1. **P0, stale offline update applied silently** (`service/sync.ts:433-440, 464-471`; `domain/sync.ts:28-41`). The "already in this state" shortcut runs before the version check and moves the batch's base to the current server version. Result: a stale offline "clean" overwrote a re-clean in progress after a failed inspection. A stale "done" also completed a task that had been reassigned and started by someone else. This breaks OPS-I04, the core S13 promise.
2. **P0, `/sync/mutations` has no permission gate** (`routes.ts:615`, `service/sync.ts:138-158, 429-459`). A user in the same organization with no operations permission, or with access only to another property, gets back the full unit and task records by id, including a guest name in the task title. They also see the unit's change history with staff names, and can inject fake conflicts into any property's supervisor list.
3. **P1, events delivered out of order corrupt state.**
   - After a correct return to service, a late `inventory.unit.blocked` event puts the unit back out of order in operations.
   - A `checkedIn` event arriving after `checkedOut` leaves the vacated unit occupied.
   - The `booking.modified` payload the README asks reservations to add resets an in-house guest to `expected`. The unit then shows vacant and ready, and the stay reappears in today's arrivals.
4. **P1, `InventoryPort` does not match the real inventory provider.**
   - `listUnits` differs in signature and shape: no `unitTypeCode`, `location` instead of `locationPath`, `status` instead of `active`, and composite units are returned that operations cannot represent.
   - `releaseBlock` returns a block where the port expects nothing.
   - At runtime, `blockUnit` needs `inventory.block.manage`, which an engineer with every operations permission lacks.
   - It also refuses when availability is owned by an external system, and refuses a second block on an already-blocked unit. In each case the whole command rolls back and the work order is lost.
   - A block can be released directly in inventory, bypassing the return-to-service gate.
5. **P1, housekeeping next to an external PMS does not work end to end.**
   - There is no inbound contract for a PMS's stays, so checkout → dirty → departure clean cannot run.
   - With Portico as the room-status authority (the recommended Path B), the rule for PMS-side edits (CR-6) is missing: every inbound status is refused.
   - Maintenance forward mode never becomes effective: acknowledging a work-order forward changes nothing, so return to service is impossible.
   - Escalation counts from the task's creation time, so tomorrow's day plan escalates to supervisors 15 minutes after it is generated. Preventive work orders are also due at 23:59 UTC rather than property time.

The report also covers the spec coverage gaps, which scenario and parity claims are false, the important rows missing from the parity matrix, and cross-module notes for you.

Files are in `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-operations-copy/modules/operations/test/`:
- review-experiments.test.ts
- review-real-inventory.test.ts
- review-port-check.ts
````

