# Agent run: Focused re-review #7: integration-step

- Started: 2026-11-08T05:32:52.058Z · last activity: 2026-11-08T05:50:03.298Z
- Turns: 71 · tool uses: 75 · output tokens: 75,652
- Type: general-purpose

## Brief (2026-11-08T05:32:52.058Z)

````text
You are Portico's architecture steward. Run a **focused re-review (#7)** of `feat/integration-step` after fix round 6. You did not write this code. Find what is still wrong before it reaches `main`. Keep it focused, about 60–80 tool calls. Write the report incrementally: create the file early and append each confirmed finding. Commit nothing.

Follow `docs/quality/playbooks/steward-reviewer.md` (v2.1), using the focused re-review shape, with these run parameters:

```
MODULE:            integration-step (round 6: purpose judged where money lands; every posting has an owner; ledger-based no-show penalty; forfeit; deposit per stay)
BRANCH / COMMIT:   feat/integration-step @ 932e7c1 (record what you review; re-check findings if it moves)
WORKTREE:          /home/user/wt/integration-step (read-only for you)
SCRATCH COPY:      /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-intstep7-copy (git worktree add --detach <copy> feat/integration-step; merge current main into it)
SPEC:              docs/adr/0015-authorization-across-module-ports.md Amendments 1–5; modules/payments/README.md; docs/architecture/domain-map.md (round-6 section)
DB PREFIX:         PORTICO_TEST_DB_PREFIX=review_intstep7
REPORT PATH:       docs/orchestration/reviews/review-integration-step-7.md; PoCs in docs/orchestration/reviews/integration-step-poc/r7-*.test.ts.txt
UI REVIEW?:        no
```

## Inputs
- **The builder's fix-round-6 report, verbatim.** It is the last report in `docs/chronicle/agents/20261107T1616-integration-step-bind-module-ports.md`, under the heading "Integration-step fix round 6: report". It contains the landing table, mutants R1–R6 and the stated proof gaps. Treat every line as a claim. Draft your attack plan from Amendment 5 and the code before you read it.
- **Previous review:** `docs/orchestration/reviews/review-integration-step-6.md`.
- **PoCs:** `docs/orchestration/reviews/integration-step-poc/r6-fix-attacks.test.ts.txt`.

## Focus areas, in priority order
- **(a) Re-run the r6 PoCs inverted** on the merged copy, and confirm each FINDING is refused at the right line.
- **(b) Landing completeness (Amendment 5 rule 1).** Grep for every path that turns card authority into money on a ledger reference, then compare with the builder's landing table. A missing row with a working attack is a finding. Pay attention to:
  - the new optional `captureInput.purpose` label: can a client label still steer the derived purpose or its limit?
  - increment followed by capture;
  - recorded payment completing a terminal hold;
  - partial captures;
  - capture onto a different reference than the hold.
- **(c) Every posting has an owner (rule 2).** Try each posting kind that can carry an amount (refund, reversal, correction, allowance, forfeit, receivables transfer, package or allowance breakage, split, folio close/reopen) through transfer and routing, in both orders. Check whether the "unknown owner, fail closed" branch is reachable. If it is, a test is needed.
- **(d) The no-show ledger penalty (rule 3).** Partial credits, a penalty moved between folios, a penalty corrected and then re-posted, and multi-currency.
- **(e) The builder's proof gaps.** Write a test that distinguishes deposit-per-stay from per-terms-snapshot: a stay with two segments or two terms snapshots. If the fix is wrong, it is a finding. Also re-run builder mutants R2 and R3, and plant 1 mutant of your own on the riskiest guard. A survivor is a finding.
- **(f) Front-desk regressions.** Re-confirm that walk-in terminal payment, a corporate card via the master folio, a deposit by link, a no-show fee after night audit, and a normal checkout settle by card on file (within the agreement) all still work.
- **(g) Gates on the merged copy.** Capture exit codes; never pipe them:
  - `pnpm install --frozen-lockfile`
  - `pnpm lint`
  - `pnpm turbo run typecheck --force`
  - `pnpm turbo run test --force --concurrency=2`

## Output
- **Report:** start with the verdict (merge / merge after fixes / do not merge), then counts by severity, then the coverage declaration. Each finding needs an ID (R7-…), file:line and a reproducing test.
- **Cleanup:** remove the scratch copy and the `review_intstep7*` databases.
- **Final reply:** verdict, counts, top findings, mutant results and the file list.
````

