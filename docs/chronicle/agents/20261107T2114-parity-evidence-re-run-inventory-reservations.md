# Agent run: Parity evidence re-run: inventory, reservations

- Started: 2026-11-07T21:14:50.901Z · last activity: 2026-11-07T21:42:19.113Z
- Turns: 101 · tool uses: 126 · output tokens: 182,750
- Type: general-purpose

## Brief (2026-11-07T21:14:50.901Z)

````text
You are a competitive-parity researcher for Portico (repo /home/user/portico; read CLAUDE.md). Follow docs/quality/playbooks/parity-researcher.md (latest version, v2) exactly. The key rule: a row is `tested` only when a test on main asserts it, and the row quotes that test's file:line.

Your worktree is /home/user/wt/parity-evidence (branch docs/parity-evidence, created from main). Write only under docs/parity/. Commit locally; never push.

Task: re-run the evidence rule on docs/parity/inventory.md and docs/parity/reservations.md.
- They still show about 1% tested on main, while modules/inventory and modules/reservations have dozens of tests proving many rows (escape E-060 in docs/quality/escapes.md).
- Since those matrices were written, reservations has merged and an integration step is about to merge real port bindings. Use what is on MAIN only. Rows proven only on an unmerged branch (feat/integration-step) are capped at `built (feat/integration-step@<sha>)`.

For each row:
- read the module README (Known gaps, Checkpoint) and the tests;
- set the true status, quoting the asserting test file:line for `tested`;
- downgrade anything over-claimed;
- run the playbook's failure-class sweep and record it.

Then:
- run `node tools/parity-report.mjs` and check the exit code;
- leave COVERAGE.md regenerated.

Reply with:
- per module: rows, % tested before and after, open P0 rows;
- notable downgrades and upgrades;
- the files written.
````

## Report (2026-11-07T21:42:18.953Z)

````text
## Parity evidence re-run: inventory and reservations

I re-ran the PR2-1 evidence rule and the PR2-2 failure-class sweep on both matrices, against `main` @ `2b1d1a6` only. Work is in worktree `/home/user/wt/parity-evidence` on branch `docs/parity-evidence`, in two local commits (`820a389`, `f95c55a`). Nothing was pushed.

**Report tool:** `node tools/parity-report.mjs` exits 0 with no status errors, and COVERAGE.md is regenerated. Both module gates still fail (`--gate inventory` and `--gate reservations` exit 1).

### Per module

| | inventory | reservations |
|---|---|---|
| Capability rows (P0/P1/P2) | 69 (36/27/6) | 123 (64/38/21) |
| Capabilities tested, before → after | 1% → **42%** (0 → 28 rows) | 1% → **9%** (0 → 10 rows) |
| Edge cases | 34 → 55 (21 added by the sweep) | 52 → 80 (28 added by the sweep) |
| Edge cases tested, before → after | 0% → **31%** (17 rows) | 0% → **14%** (11 rows) |
| Open P0 rows, before → after | 53 → **22** | 100 → **100** |
| P1 rows missing | 19 → 18 | 30 → 32 |

The "before" 1% was only the one `different` row in each matrix. The percentages count that row too.

**Why reservations still has 100 open P0 rows:**
- 19 P0 rows became `tested` and the sweep added 19 new open P0 edge cases, so the count is unchanged by coincidence.
- On `main`, the API wiring binds rates, guests, finance, payments and operations to stubs that answer 503. The running API therefore cannot create a booking yet.
- The module tests use fakes for those modules. Any row whose outcome a fake decides stays `built` (pattern AP-51), even when the reservations logic around it is asserted.

**Open P0 rows by what would close them:**
- **Proven on `feat/integration-step` only:** inventory 3, reservations 16. These are capped at `built (feat/integration-step@db6ae8c)` and need re-verifying when it merges.
- **Need one more assertion on `main`:** inventory 11, reservations 26.
- **Still need building or speccing:** inventory 7, reservations 54.

The full row lists are in `gaps-front.md`.

### Downgrades and upgrades
- **No matrix row was downgraded:** v1 had nothing above `specified`.
- **The over-claims were in the inventory README's parity list:** 13 rows it calls tested are not `tested` here. Examples: PAR-INV-057 (conflicts have no owner), PAR-INV-041 (only the composite refusal of unassign is asserted), PAR-INV-032 (no week or month views), EC-INV-005 (proven only against a fake), EC-INV-028 (forward mode refuses instead of forwarding). The table is in `gaps-front.md`.
- **Inventory upgrades:**
  - The last-unit race, with the second transaction observed waiting on the lock.
  - Connected mode, house totals and composite units.
  - EC-INV-008 and EC-INV-029, which were `missing` in v1, are now `tested`.
- **Reservations upgrades:** the change preview, optimistic concurrency, split stays, extension alternatives (run against the real inventory module), assignment and upgrade, and channel revision handling.

### Self-check and sweep
- **Assertion quotes:** inventory 45 of 45 tested rows, reservations 21 of 21. A script resolved every quoted line. 10 are supporting references rather than assertions (a code guard, the lock-wait check, the ledger check after each test file).
- **Failure-class sweep:** every class in AP-01–48, plus AP-53, 56, 57 and 58, is recorded per module as applied, covered or N/A with a reason.

### New findings for the orchestrator and steward
1. **Payload drift (AP-43):** reservations' waitlist consumer reads `payload.cells`, but inventory emits one unit type and a `range`. The outcome is still correct, but every availability change re-checks every waitlisted stay of the property. The consumer's test uses a hand-made `cells` payload. The branch has the same code.
2. **Block release bypass (AP-45, P0):** inventory's own release route still bypasses operations' return-to-service check. This is already known and tracked in `pending-fixes.md`.
3. **Mirror batch (AP-32):** one conflicting assignment from the external PMS rejects the whole `applyExternalAvailability` batch.
4. **No erasure path (AP-17):** reservations has nothing for guest erasure. Unblocked events are also ignored, so a relocation case can outlive its block.
5. **Overbooking authorizer (AP-04):** direct callers can record any name as the overbooking authorizer. Reservations' own path passes the acting user.
6. **Misleading test title:** a reservations search test says it covers channel-id search but never searches by one.

One decision is needed: EC-INV-017. The code refuses to lower an overbooking allowance below what is already sold, while the row expects a preview that records conflicts. I recommend keeping the refusal and writing it into the INV spec, which makes the row `different`.

Files are in `/home/user/wt/parity-evidence/docs/parity`:
- inventory.md
- reservations.md
- gaps-front.md (new section "v2 evidence re-run" and updated summary rows)
- COVERAGE.md
````

