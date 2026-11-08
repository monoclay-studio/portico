# Agent run: Steward review: migration

- Started: 2026-11-08T05:17:02.231Z · last activity: 2026-11-08T05:46:35.539Z
- Turns: 141 · tool uses: 146 · output tokens: 143,435
- Type: general-purpose

## Brief (2026-11-08T05:17:02.231Z)

````text
You are Portico's architecture steward, an independent senior reviewer. Run a full steward review of a newly built module. Read `docs/quality/playbooks/steward-reviewer.md` (v2.1) and follow its **Launch brief** exactly, with these run parameters:

```
MODULE:            migration ("Move to Portico", owner decision D13; increments 1–2: CSV/XLSX + SMB adapters, rehearsal, reconciliation, cutover, rollback)
BRANCH / COMMIT:   feat/migration @ 45be8b9 (record the commit you actually review; re-check findings if it moves)
WORKTREE:          /home/user/wt/migration (read-only for you)
SCRATCH COPY:      /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-migration-copy (git worktree add --detach <copy> feat/migration; then merge current main into the copy)
SPEC / README:     modules/migration/README.md; modules/migration/FOUNDATION_REQUESTS.md; docs/strategy/modules/migration.md (10x brief); docs/research/05-market-deep-dive/11-one-button-migration.md; docs/product/decisions.md D13; docs/OPEN_QUESTIONS.md Q140–Q144, Q162
FOCUS AREAS:       see below
PARITY FILE:       docs/parity/migration.md (on the branch)
DB PREFIX:         PORTICO_TEST_DB_PREFIX=review_migration
REPORT PATH:       docs/orchestration/reviews/review-migration.md; PoC files docs/orchestration/reviews/migration-poc/*.test.ts.txt
UI REVIEW?:        no
```

**The builder's report, verbatim**, is the last report in `docs/chronicle/agents/20261107T2200-build-migration-module-increments-1-2.md`. Quote its claims and verify each one. Draft your own attack plan from the code and the brief before reading its self-assessment.

**Focus areas:**
- **(a) Zero duplicate reservations and opening balances posted once.**
  - Attack the import ledger's unique key: source-key normalisation such as case, whitespace and leading zeros.
  - The same booking delivered by two adapters, or by a re-exported file with new row order.
  - Delta sync racing the post-capture sweep, a crash between the ledger insert and the owning module's write, and five racing importers.
- **(b) The production gate.**
  - Try to cut over with an open blocking exception, a stale rehearsal certificate, a changed plan, an expired or self-granted authorization, the same person as creator and approver, or a non-live environment.
  - Check that a refused gate changes nothing and is audited.
  - Check that the data-authority transition is second-person approved and reversible, and that rollback erases nothing.
- **(c) Reconciliation honesty.** The comparison must be against read-backs from the owning modules, not what migration sent. Check the 1-minor-unit differences, multi-currency, and that "every source record accounted for in exactly one state" really holds.
- **(d) Privacy and card safety.**
  - Any card number in any cell must refuse the whole upload: try PANs with spaces or dashes, Luhn-valid numbers in notes, XLSX shared strings, and formulas.
  - Masked-value detection.
  - The 30-day purge (Q162 default): does it really remove personal data from every staging table and file?
  - The guest data export.
  - PII in logs.
- **(e) File-parsing safety.** The XLSX reader has no dependency, so attack it: zip bombs, XML entity expansion, path traversal in zip entries, huge rows, CSV formula injection in exported reports, and encoding edge cases.
- **(f) Data authority (rule 15) and environment safety (rule 12).** The simulator must be refused in live organizations. Portico must be read-only before the switch.
- **(g) The builder's mutation proof.** Re-run 2 of its mutants and plant 1 of your own on the guard you judge riskiest. A survivor is a finding.
- **(h) Gates on the merged copy, exit codes captured, never piped:** `pnpm install --frozen-lockfile`, `pnpm lint` (`--error-on-warnings`), `pnpm turbo run typecheck --force`, `pnpm turbo run test --force --concurrency=2`.

**Writing the report:**
- Write it incrementally: create the file early and append each confirmed finding.
- Start it with the verdict (merge / merge after fixes / do not merge), then counts by severity, then the coverage declaration.
- Give each finding an ID, file:line and a reproducing test.
- Commit nothing.
- Remove your scratch copy and `review_migration*` databases when done.

**Your final reply:** verdict, counts, top findings, mutant results and the file list.
````

## Report (2026-11-08T05:46:35.240Z)

````text
## Steward review of migration (`feat/migration` @ 45be8b9): do not merge

**Verdict: do not merge.** Fix R-P0-1 and R-P1-1 to R-P1-8 first. Because a P0 was raised, the branch then needs a focused re-review. Merging as it is would put two problems on the shared server: a ~1 KB upload that crashes the API process, and a card-number guard that lets common ways of writing a card number through and stores them.

**Counts:** P0 1 · P1 8 · P2 9 · P3 12.

**Coverage:** all 15 checklist items are declared. Patterns A–E: 61 in total, 50 applicable (28 probed, 19 code-read, 3 applied as review steps), none left unprobed, 11 not applicable. Group F does not apply (no UI). The commit was still 45be8b9 at the end. `main` moved to 0b108b6 during the review, but only docs changed, so no re-merge was needed.

**Gates** (merged copy, exit codes read from files):
- `pnpm install --frozen-lockfile`, `pnpm lint` (with `--error-on-warnings`) and `pnpm turbo run typecheck --force` all exited 0.
- `pnpm turbo run test --force --concurrency=2` exited **1** on the first run. The api demo-seed test in `apps/api/test/rates.test.ts` timed out at 30 s while the machine was loaded, and turbo stopped before the migration tests ran.
  - Re-run with `--continue`: exit 0, 17/17 packages, migration 95/95.
  - That rates test then passed 3/3 on its own, so it is a flake (1 failure in 5 runs) in code outside this branch (R-P3-11).
- `node tools/parity-report.mjs --gate migration` exited 1 (PAR-MIG-004, -005, -012 still "building"). The builder disclosed this.
- About the shared `scratchpad/gates/` folder: my gate logs and exit files went only to my own folder (`scratchpad/rvmig/`), so the distribution reviewer's writes there do not affect these results.

**Top findings** (each has a test that reproduces it, and each test passes on 45be8b9, which proves the defect):
1. **R-P0-1** (`sensitive.ts:45`): the card-number check misses ordinary spellings, so files containing a card number are stored. Examples it lets through:
   - `4111 1111 1111 1111 12/27`, or `room 12 4111…`;
   - double spaces, dots, non-breaking spaces, full-width digits;
   - any card number in a header cell (headers are never scanned).
   `payments/src/domain/pci.ts` has the same flaw.
2. **R-P1-1** (`xlsx.ts`): a 939-byte workbook makes Node run out of memory and abort (exit 134). Sizes declared in the zip are trusted, overlapping entries are allowed, and there is no column or row limit. Any user with migration rights in a trial organization can do this.
3. **R-P1-2**: the cutover gate accepts a rehearsal certificate for different data. An export uploaded while the job is in sync is never rehearsed, yet the freeze passes and it is cut over: the trial rehearsed 8 bookings, live received 9. The certificate's extract fingerprint is never compared.
4. **R-P1-3**: reconciliation only checks source → Portico. Duplicate or extra bookings and balances held in Portico still report "exact", and the control-total counts are never compared.
5. **R-P1-5 / R-P1-8**: the sweep after the switch.
   - It imports re-keyed records as new: live went from 8 to 11 bookings, with two bookings for the same Booking.com id, because quality checks don't run in the sweep.
   - A migration lead without finance sign-off can post a USD 5,000 opening deposit into live finance through it.

**Other P1s:**
- **R-P1-4**: excluding a record by decision (or importing it as is) blocks the cutover forever, because the final-capture check counts raw problems and ignores decisions.
- **R-P1-6**: the 30-day purge (Q162 default) never reaches the copy in the trial organization. That rehearsal job stays "rehearsed" and keeps every guest's name and email.
- **R-P1-7**: a second production migration of the same property from another adapter is accepted, and nothing dedupes its bookings against the first.

**P2 highlights:**
- R-P2-1: one person makes the property's Portico read-only for 8 domains when planning the cutover, and cancelling does not undo it.
- R-P2-2: the gate is checked only once; an authorization revoked after the freeze does not stop the switch.
- R-P2-3: the rollback worklist includes the sweep's own imports, and a client-chosen `X-Request-Id` can hide a change from it.
- R-P2-4: the final-capture and sweep uploads skip the column-detection confirmation.
- R-P2-5: for multi-room bookings under one confirmation number, the error tells the hotel to delete a row.
- R-P2-6: workbooks using the 1904 date system shift every date; dates of birth before 1980 are silently dropped.
- R-P2-7: the housekeeping job visits at most 500 tenants in no fixed order, and nothing alarms when it stops running.
- R-P2-8: "Mark resolved" on a problem that is still there looks closed and never re-opens.
- R-P2-9: six parity rows marked "tested" are disproved, and several capabilities are missing from the parity file.

**Mutants:**
- Builder's M1 (ledger skip removed): **killed**, 11 tests fail.
- Builder's M2 (authorization blocker removed from the gate): **killed**, 2 tests fail.
- My M3 (the "simulator never in live" refusal at extraction time removed): **survived**, all 113 module tests and 7 API tests stay green → R-P3-8. Low impact: no organization can currently change environment on `main`.

**Claims ledger:** these builder claims are false or only partly true:
- "zero duplicates (tested)";
- "comparison against read-backs";
- "any card number in any cell refuses the upload";
- the XLSX reader being safe on hostile files;
- "purged after 30 days";
- "money decisions belong to finance".

The section on claims checked against the builder's report lists all of them.

**Housekeeping:** nothing committed, the worktree under review is untouched, the scratch copy is removed and 0 `review_migration*` databases remain. The orchestrator had already committed an early partial version of the report as wip (`6619e80`); the final version in the working tree needs committing.

Files are in /home/user/portico/docs/orchestration/reviews:
- review-migration.md
- migration-poc/zz-review-domain.test.ts.txt
- migration-poc/zz-review-integration.test.ts.txt
- migration-poc/zz-review-xlsx-oom.test.ts.txt
````

