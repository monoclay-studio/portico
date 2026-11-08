# Agent run: Steward review: day-close

- Started: 2026-11-08T05:17:02.222Z · last activity: 2026-11-08T05:48:16.648Z
- Turns: 132 · tool uses: 135 · output tokens: 155,224
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

## Report (2026-11-08T05:48:16.547Z)

````text
## Steward review: day-close (`feat/day-close` @ `cb0fbf33d31118be1e3c8b979713b6d38f7047e4`)

**Verdict: merge after fixes.** P0-1, P0-2 and P1-1 must be fixed before merge. I strongly recommend fixing P2-1, P2-6 and P2-9 before merge too. The fix round should then get a focused re-review.

**Counts: P0 2 · P1 1 · P2 14 · P3 12.** There are 61 patterns in groups A–E. 44 apply: I probed 16, read the code for 26, and used 2 as review steps (AP-45 sibling paths, AP-54 load-bearing check). No applicable pattern was left unprobed. The other 17 do not apply, and the report says why for each.

The engine itself held under every attack I ran. The lease and heartbeat fencing worked, including an executor paused *inside* an item transaction past its lease. The advance and its step completion commit in one transaction. The integrity gate held: an organization-level policy written directly through platform could not demote integrity codes, and override, cancel, restart and resolve were all refused after an integrity failure. RLS is enabled and forced on all 11 tables. All 15 service entry points refuse another property. Two properties in different time zones each closed at their own 02:00.

The defects are all in what gets posted when a stay changes after one of its nights has closed.

### Top findings
1. **P0-1 (latent until reservations can re-price a stay).** When re-pricing moves a package line to another night, Day Close never reconciles it with lines already posted or deferred.
   - Extending a stay after a cancelled seaplane charged the USD 750 departure transfer **twice** (3 `TRANSFER_SEAPLANE` charges where 2 were flown).
   - Shortening a stay means the departure transfer is **never** charged.
   - The root cause is shared with rates: its line key includes the night the line is allocated to.
2. **P0-2.** The next night's allowance is granted right after the advance, before that night exists.
   - **Early departure:** the guest is billed USD 128.70 (credit plus taxes) for a night that is not part of the stay, and finance's check-out consumer forfeits it to breakage revenue.
   - **Correction:** after an occupancy change, the night's posting hits finance's `idempotency_conflict` and the whole night rolls back, room charge included. The failure is wrongly marked retryable. The only way out is an override, which skips the room night, and the next close fails the same way.
3. **P1-1.** If a failed night is overridden and posted by hand (which the item's own error message advises), the next close's catch-up posts it again: two room charges for one night. The catch-up never checks for overrides.
4. **P2-1.** The FR-3 DST fix is wrong in every zone west of UTC. For example, New York at 02:30 on the spring-forward night gives 01:30 EST, an hour early, and the earliest-start guard is wrong the same way. The test covers London only, and FR-3 asks the kernel to copy this logic.
5. **P2-2 / P2-3.**
   - A guest checked in after the pre-advance sweep who leaves before the next close is never charged, and nothing flags it. The README's DCL-I04 claim is therefore false.
   - Day facts are frozen before the sweep posts its stays: the probe shows ADR 415 instead of 830. The report annex then labels these ordinary postings as "restatements".

Other P2s:
- **FR-1 detection is weak (P2-4):** the residual is small, but the only sign of an in-flight posting is an unlabelled revenue difference in the report, and no follow-up is raised.
- **Daytime close allowed by default (P2-5):** a 10:00 close no-shows the afternoon's arrivals and posts their fees. The spec's MUST "schedule ≥ earliest start" is not enforced.
- **Guest names in the report (P2-6):** they are copied from finance's checks into the append-only day report, so erasure can never remove them.
- **No alarm when no close runs (P2-7).**
- **Departure transfer after check-out (P2-10):** the departure transfer is always posted after the guest has checked out.
- **Green Tax on zero-price nights (P2-11):** skipped silently; the `levy_not_posted` follow-up is never raised.
- **Privilege equivalence (P2-12):** `dayClose.policy.manage` can have the date advanced through the schedule, which runs with system authority.
- **Late charges for D (P2-13):** a charge for D posted after D's close never reaches D's report (spec S10).
- **Parity gate (P2-14):** fails with 11 P0 rows open, and 2 rows marked `tested` overclaim.

### Mutant results
- Builder's **M2** (heartbeat lease-owner check): **killed** by the stale-executor test.
- Builder's **M16** (advance completion moved out of its transaction): **killed** by 3 chaos tests.
- Mine, **R1** (seal check removed from the pre-grant, `postings.ts:248`): **survived**, 87/87 green → **P2-8**.

### Gates (merged copy, exit codes captured)
- `pnpm install --frozen-lockfile`: 0.
- `pnpm lint`: 0. Typecheck `--force`: 0.
  - After your heads-up I re-ran both into `scratchpad/gates-dayclose/`: still 0. My results never used the shared `gates/` folder.
- Tests `--force --concurrency=2`: 0 (17/17; day-close 87 tests, api 71).
- Default concurrency: **1 of 2 runs failed** (P2-9).
  - Besides the known api demo-seed flake, two **new day-close timeouts**: S09 and the 40-stay "nothing blocking" test, both at 60 s.
  - In the passing run S09 took 43.2 s, against the builder's 9.4 s.
  - The machine was at load average ~12 on 4 cores while other reviews ran.
  - Day-close alone passed 3 times.
- Parity gate: exit 1.

### Builder's claims
These were verified true:
- S09: 90 finance calls on resume, books balanced.
- The kill -9 and chaos tests.
- RLS on all 11 tables.
- A permission check on every entry point.
- Integrity never overridable.
- The advance and its completion in one transaction.

These were false:
- DCL-I04 "never silently missed" (P2-2).
- FR-3 "fixed locally" (P2-1).
- Self-check item 29 "no guest personal data stored" (P2-6).
- "Tests pass under both concurrency settings" (P2-9).
- "Alarm to finance": the issue is invisible to finance on main (P3-6).

Nothing committed. The scratch worktree is removed and both `review_dayclose*` databases are dropped. The orchestrator's earlier wip checkpoints hold partial versions of the report; the final version is the uncommitted working-tree file.

Files are in `/home/user/portico/docs/orchestration/reviews/`:
- `review-day-close.md`
- `day-close-poc/zz-review-money.test.ts.txt`
- `day-close-poc/zz-review-ops.test.ts.txt`
- `day-close-poc/zz-review-security.test.ts.txt`
- `day-close-poc/zz-review-pii.test.ts.txt`
- `day-close-poc/zz-review-late.test.ts.txt`
- `day-close-poc/zz-review-dst-standalone.mjs.txt`
````

