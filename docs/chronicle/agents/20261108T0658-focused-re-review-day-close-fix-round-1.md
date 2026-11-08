# Agent run: Focused re-review: day-close fix round 1

- Started: 2026-11-08T06:58:24.558Z · last activity: 2026-11-08T07:00:22.495Z
- Turns: 15 · tool uses: 17 · output tokens: 8,744
- Type: general-purpose

## Brief (2026-11-08T06:58:24.558Z)

````text
You are Portico's architecture steward, running a **focused re-review** of `feat/day-close` after its fix round 1. You did not write this code. Find what is still wrong before it reaches `main`. Aim for about 70–90 tool calls. Write the report incrementally: create the file early and append each confirmed finding. Commit nothing.

Follow `docs/quality/playbooks/steward-reviewer.md` (v2.1), using the focused re-review shape (re-run earlier attacks inverted, attack the fixes, sibling paths, reverse order, coverage declaration), with these run parameters:

```
MODULE:            day-close (fix round 1)
BRANCH / COMMIT:   feat/day-close @ 0282e8d (record what you review; re-check findings if it moves)
WORKTREE:          /home/user/wt/day-close (read-only for you)
SCRATCH COPY:      /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-dayclose2-copy (git worktree add --detach <copy> feat/day-close; merge current main into it)
SPEC:              docs/specs/day-close.md; modules/day-close/README.md; docs/adr/0018-allowance-validity-window.md (new)
DB PREFIX:         PORTICO_TEST_DB_PREFIX=review_dayclose2
REPORT PATH:       docs/orchestration/reviews/review-day-close-2.md; PoCs in docs/orchestration/reviews/day-close-poc/r2-*.test.ts.txt
GATE LOG FOLDER:   your own folder, for example scratchpad/gates-dayclose2/ (never a shared folder)
UI REVIEW?:        no
```

## Inputs
- The first review: `docs/orchestration/reviews/review-day-close.md`, plus its probes `docs/orchestration/reviews/day-close-poc/zz-review-*.txt`.
- The builder's fix-round-1 report, verbatim: the last report in `docs/chronicle/agents/20261107T2138-build-day-close-module.md`. It contains the § 3 re-attack table, the state machines, the writer searches, the § 5.4 mutation table and the claim ledger. Treat every line as a claim, and plan your attacks before you read it.

## Focus areas, in priority order
- **(a) Re-run every first-review probe inverted** on the merged copy. Confirm each P0/P1/P2 is now refused or fixed, at the right line.
- **(b) P0-1, the line register.** Attack stable line identity from every side:
  - a re-price after a line posted;
  - a re-price that adds, then removes, a once-per-stay line;
  - a stay move between units or properties;
  - a booking split or merge;
  - two re-prices in one day;
  - a finance correction or reversal of a posted line, which the builder admits is not reconciled. Judge whether that residual is safe.
- **(c) ADR-0018 and P0-2, allowances.**
  - An early departure on any night.
  - An occupancy correction before and after N's close.
  - The arrival-day gap, and whether its labelling is honest.
  - Breakage happening once.
  - The `posting_conflict` set-aside: can it hide a real problem? Is the follow-up owned and loud?
- **(d) P1-1 decisions.**
  - Can `decideNight` be abused, or skip a night that should post?
  - Do decisions interact correctly with the catch-up, the sweeps and departed stays?
  - Is the "latest decision wins" rule safe?
- **(e) P2-2/P2-3 and the new event consumer.**
  - A check-in, extension, shortening or check-out during each step of the close, including inside the advance transaction.
  - The unconsumed `bookingModified` residual: what does it lose?
- **(f) DST** (P2-1 forward rule). Spot-check 3 zones yourself, including one west of UTC and one with a 30-minute shift.
- **(g) Verify the proof.** Re-run 2 of the builder's killed mutants. Then judge its 3 "layered by design" survivors: is the outer layer really always there? Plant 1 mutant of your own on the riskiest new guard. A survivor is a finding.
- **(h) Gates on the merged copy.** Capture exit codes; never pipe them:
  - `pnpm install --frozen-lockfile`
  - `pnpm lint`
  - `pnpm turbo run typecheck --force`
  - `pnpm turbo run test --force --concurrency=2`

  Also run the default-concurrency run once with `--continue`. Report which failures are in day-close and which are the known api demo-seed flake.

## Output
- **The report** starts with the verdict (merge / merge after fixes / do not merge), then counts by severity, then the coverage declaration. Each finding gets an ID (DC2-…), file:line and a reproducing test.
- **Cleanup:** remove the scratch copy and the `review_dayclose2*` databases.
- **Final reply:** verdict, counts, top findings, mutant results and the file list.
````

## Follow-up message (2026-11-08T07:00:22.495Z)

````text
[Request interrupted by user]
````

