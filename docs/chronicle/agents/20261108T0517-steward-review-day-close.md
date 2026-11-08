# Agent run: Steward review: day-close

- Started: 2026-11-08T05:17:02.222Z · last activity: 2026-11-08T05:37:27.638Z
- Turns: 97 · tool uses: 100 · output tokens: 100,352
- Type: general-purpose

## Brief (2026-11-08T05:17:02.222Z)

````text
You are Portico's architecture steward, an independent senior reviewer. Run a full steward review of a newly built module. Read `docs/quality/playbooks/steward-reviewer.md` (v2.1) and follow its **Launch brief** exactly, with these run parameters:

```
MODULE:            day-close (night audit / business-date close)
BRANCH / COMMIT:   feat/day-close @ cb0fbf3 (record the commit you actually review; re-check findings if it moves)
WORKTREE:          /home/user/wt/day-close (read-only for you)
SCRATCH COPY:      /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-dayclose-copy (git worktree add --detach <copy> feat/day-close; then merge current main into the copy)
SPEC / README:     docs/specs/day-close.md; modules/day-close/README.md; modules/day-close/FOUNDATION_REQUESTS.md; docs/strategy/modules/day-close.md (10x brief)
FOCUS AREAS:       see below
PARITY FILE:       docs/parity/day-close.md (on the branch)
DB PREFIX:         PORTICO_TEST_DB_PREFIX=review_dayclose
REPORT PATH:       docs/orchestration/reviews/review-day-close.md; PoC files docs/orchestration/reviews/day-close-poc/*.test.ts.txt
UI REVIEW?:        no
```

**The builder's report, verbatim**, is the last report in `docs/chronicle/agents/20261107T2138-build-day-close-module.md`. Quote its claims and verify each one. Draft your own attack plan from the code and spec before reading its self-assessment.

**Focus areas:**
- **(a) Zero duplicate postings after any interruption.**
  - Attack the lease and heartbeat: expiry while still running (a GC pause or slow transaction), two executors, a resume racing a live executor, and a crash between an effect and its item record.
  - Attack the advance with completion in one transaction.
  - Check whether the finance idempotency keys really hold across a retry with changed inputs (rate correction mid-close).
- **(b) "Nobody logged out."**
  - Postings and check-ins during the close: a check-in after the sweep but before the advance, and a late charge dated D posted after the advance.
  - The missing `lockBusinessDate` (CR-11): is "detected, not prevented" honest, and is the residual harm bounded and visible?
- **(c) Business date, DST and time zones.**
  - The scheduler at local time.
  - Two properties in different time zones.
  - The kernel `zonedTimeToInstant` DST fix made locally on the branch (FR-3). Is it correct and tested?
- **(d) Integrity is never overridable.**
  - Try to override, demote or bypass the integrity blockers through policy, permissions or the API.
  - Check that a failed integrity check stops before the advance and raises an alarm.
- **(e) Money correctness.**
  - Room and tax postings from the sealed terms.
  - Allowances and breakage.
  - Deferred lines, and caught-up nights.
  - No-show fees going only through `payments.collectAgreedNoShowFee`. That port is stubbed on main, so check the follow-up path is honest.
  - Seal tampering.
- **(f) Security.** Check RLS on all 11 tables, the permission on every route and service function, the property scope on run access, and the `markNoShow` composition check that the builder says is untested.
- **(g) The builder's mutation proof.** Re-run 2 of the builder's 22 mutants and plant 1 of your own on the guard you judge riskiest. A survivor is a finding.
- **(h) Gates on the merged copy, exit codes captured, never piped:** `pnpm install --frozen-lockfile`, `pnpm lint` (`--error-on-warnings`), `pnpm turbo run typecheck --force`, `pnpm turbo run test --force --concurrency=2`. Also run the default-concurrency run once, and report any flake against the known demo-seed flake.

**Writing the report:**
- Write it incrementally: create the file early and append each confirmed finding.
- Start it with the verdict (merge / merge after fixes / do not merge), then counts by severity, then the coverage declaration.
- Give each finding an ID, file:line and a reproducing test.
- Commit nothing.
- Remove your scratch copy and `review_dayclose*` databases when done.

**Your final reply:** verdict, counts, top findings, mutant results and the file list.
````

