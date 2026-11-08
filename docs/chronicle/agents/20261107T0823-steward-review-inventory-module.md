# Agent run: Steward review: inventory module

- Started: 2026-11-07T08:23:40.101Z · last activity: 2026-11-07T11:21:46.429Z
- Turns: 83 · tool uses: 130 · output tokens: 89,359
- Type: general-purpose

## Brief (2026-11-07T08:23:40.101Z)

````text
You are Portico's architecture steward. Read and follow the review brief at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/steward-review.md exactly.
Branch under review: `feat/inventory-core` in worktree /home/user/wt/inventory — module `inventory` (spec: /home/user/portico/docs/specs/inventory.md on main). Author's README: modules/inventory/README.md; FOUNDATION_REQUESTS.md lists requested foundation changes — assess each. The author flags the composite-unit logic and the change-consumption/upgrade paths as the riskiest: review those with extra care, including trying to construct a concurrency or composite double-sell counterexample (write a throwaway test in your OWN scratch copy if needed — do not modify the worktree; you may copy the worktree to /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-inventory-copy and run tests there). Also check the decision that consumption/holds do not re-check `availability` data authority (callers govern) against ADR-0014 and the adoption docs. Parity file: /home/user/wt/parity-front/docs/parity/inventory.md if present, else list capabilities you know OPERA Cloud/Mews/Cloudbeds inventory has that are missing.
Use PORTICO_TEST_DB_PREFIX=review_inventory. Write your report to /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-inventory.md.
````

## Follow-up message (2026-11-07T08:23:40.101Z)

````text
You are Portico's architecture steward. Read and follow the review brief at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/steward-review.md exactly.
Branch under review: `feat/inventory-core` in worktree /home/user/wt/inventory — module `inventory` (spec: /home/user/portico/docs/specs/inventory.md on main). Author's README: modules/inventory/README.md; FOUNDATION_REQUESTS.md lists requested foundation changes — assess each. The author flags the composite-unit logic and the change-consumption/upgrade paths as the riskiest: review those with extra care, including trying to construct a concurrency or composite double-sell counterexample (write a throwaway test in your OWN scratch copy if needed — do not modify the worktree; you may copy the worktree to /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-inventory-copy and run tests there). Also check the decision that consumption/holds do not re-check `availability` data authority (callers govern) against ADR-0014 and the adoption docs. Parity file: /home/user/wt/parity-front/docs/parity/inventory.md if present, else list capabilities you know OPERA Cloud/Mews/Cloudbeds inventory has that are missing.
Use PORTICO_TEST_DB_PREFIX=review_inventory. Write your report to /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-inventory.md.
````

## Follow-up message (2026-11-07T11:13:07.690Z)

````text
The coordinator sent a message while you were working:
Orchestrator: the usage limit has reset. Continue the inventory review exactly where you stopped (you were writing counterexample tests in your scratch copy) and finish the report as originally specified. Postgres was restarted and is up.

Address this before completing your current task.
````

## Report (2026-11-07T11:21:46.349Z)

````text
**Verdict: merge after fixes.** `feat/inventory-core` can't merge as it is. Selling is solid, but releasing inventory can corrupt the availability ledger and lead to overselling.

**Findings:** P0 2 · P1 6 · P2 8 · P3 9. Full report: /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-inventory.md

**Commands (prefix `review_inventory`):** install, lint, typecheck, inventory tests (74) and API tests (17) all pass. The parity gate fails: 53 P0 rows untested and 19 P1 rows missing.

I wrote 8 throwaway counterexample tests (CE1–CE8) in my scratch copy; the worktree is untouched. Seven reproduce a defect. CE4 passed: a residence sale racing an assignment of one of its villas is handled correctly. The file is /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-inventory-copy/modules/inventory/test/zz-review-counterexamples.test.ts

**Top 5:**
1. **INV-01 (P0):** `release(ref)` subtracts an expired but not yet swept hold twice (`consumption.ts:489-503, 578-589`). It happens in a single transaction, with no concurrency needed.
   - With one hold, the cancellation fails with a raw database error (`ledger_held_check`, HTTP 500).
   - With a second active hold on the same night, that hold stops being counted. Both villas then sell, and nothing records a conflict.
2. **INV-02 (P0):** a release reads its rows before it takes the locks (`consumption.ts:472-503` vs `:558`).
   - Two concurrent releases of the same stay ended with 3 sales on a 2-villa night and no conflict (CE2).
   - A release concurrent with a change to the same stay shows the same double-subtraction (CE6).
   - The spec's S11 promise that a released group allocation comes back "exactly once" is false under concurrency.
3. **INV-03 (P1):** nothing checks whether an external system owns availability before selling, holds or assignments. This contradicts spec §14, CLAUDE.md §4.15 and ADR-0014.
   - The reservations worktree checks only its own `reservations` authority, so no module checks it today.
   - A connected-mode test actually requires a sale to succeed while an external system is the system of record.
   - I agree with not re-checking inventory *permissions* on these calls. I disagree with skipping the *authority* check: inventory owns that domain and is the only reliable place to enforce it.
4. **INV-04 (P1):** assigning ordinary stays to two component villas can make a residence hold impossible to convert (CE3).
   - `assignUnit` (`assignments.ts:176-238`) does not refuse, and its result does not report the conflict it opened.
   - The README's claim that composite and component views "always agree" holds only for sales.
5. **INV-05 (P1):** two concurrent conversions of the same hold both succeed, producing two bookings (CE5). In `holds.ts:213-241` an already-converted hold is treated as expired and sold fresh.

**Other P1s:**
- **INV-06:** `UnitAssignmentConflictError.details.conflicts` doesn't match the domain map or the reservations port. Reservations casts it to a plain list of refs.
- **INV-07:** when an overbooking allowance expires, the night shows as oversold with no conflict record until something else touches it (CE7).
- **INV-08:** parity gate. The matrix was written before this code. Real P0 gaps:
  - house total across unit types;
  - protecting accessible units from casual reassignment;
  - preview of affected stays when a unit leaves inventory;
  - availability beyond 400 nights;
  - the allowance-expiry and external-maintenance edge cases.

**Composite and concurrency checks:** composite counting holds up, and I found no composite double-sell of the same physical villa. The S01 last-unit proof for selling is genuine.

**FOUNDATION_REQUESTS:**
- **#1 (test database drop race):** already fixed on main in b484de3, so the module's own workaround should be removed.
- **#2 (fold contract changes into the domain map):** accept, but the update must also cover:
  - the availability authority gate;
  - the conflict error shape;
  - one shape for the availability-changed event (reservations' waitlist consumer reads `cells`, inventory emits `range`).

**For you at merge:** composition needs adapters between reservations' and operations' inventory ports and the provider. The report lists each shape mismatch.
- `withSavepoint` is duplicated with payments and `pgCode` with guests; both are candidates to share.
- Register the inventory demo seed step. Today only the test adds it, so `pnpm seed:demo` leaves inventory out.
````

