# Agent run: Focused re-review #6: integration-step

- Started: 2026-11-08T00:51:04.418Z · last activity: 2026-11-08T01:07:44.678Z
- Turns: 65 · tool uses: 70 · output tokens: 72,571
- Type: general-purpose

## Brief (2026-11-08T00:51:04.418Z)

````text
You are Portico's architecture steward, running a **focused re-review (#6)** of `feat/integration-step` after fix round 5. You did not write this code. Find what is still wrong before it reaches `main`.

## Usage and saving
**Hard budget:** the account's weekly allowance is at about 93% and has no overage. Work may be stopped at any moment. So:
- Keep this to about 50–70 tool calls.
- **Write your report incrementally.** Create the report file in your first few steps with a skeleton. Append each finding as soon as you confirm it, so that a sudden stop loses nothing.
- Commit nothing.

## How to run it
Follow `docs/quality/playbooks/steward-reviewer.md` (v2.1), focused re-review shape, with these run parameters:

```
MODULE:            integration-step (round 5: consent inputs are facts; coverage where money lands; capped staff agreements; finance-owned link states)
BRANCH / COMMIT:   feat/integration-step @ 333a83e (record what you review; re-check findings if it moves)
WORKTREE:          /home/user/wt/integration-step (read-only for you)
SCRATCH COPY:      /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-intstep6-copy (git worktree add --detach <copy> feat/integration-step; merge current main into it)
SPEC:              docs/adr/0015-authorization-across-module-ports.md Amendments 1–4; modules/payments/README.md; docs/architecture/domain-map.md
DB PREFIX:         PORTICO_TEST_DB_PREFIX=review_intstep6
REPORT PATH:       docs/orchestration/reviews/review-integration-step-6.md; PoCs in docs/orchestration/reviews/integration-step-poc/r6-*.test.ts.txt
UI REVIEW?:        no
```

## Inputs
- **The builder's fix-round-5 report, verbatim:** the last report in `docs/chronicle/agents/20261107T1616-integration-step-bind-module-ports.md` (heading "Integration-step fix round 5: report"). It includes the input-source grid, the list of every money-moving writer, mutants N1–N25 + M6, and the claim ledger. Treat each line as a claim. Draft your attack plan from ADR-0015 Amendment 4 and the code **before** reading it.
- **Previous review:** `docs/orchestration/reviews/review-integration-step-5.md`.
- **Its PoCs:** `docs/orchestration/reviews/integration-step-poc/r5-*.test.ts.txt`.

## Focus areas, in priority order (stop when the budget runs out; say what you did not reach)
- **(a) Re-run the r5 PoC file inverted** on the merged copy, and confirm each FINDING is refused at the right line.
- **(b) Class closure (Amendment 4 rule 1).** Look for any remaining client-supplied or staff-editable input that reaches `consentProblem`, `purpose.ts`, `cardMoneyMayMeet` or finance's `provenance.ts`. Check the builder's input-source grid against the code; one counterexample is a finding.
- **(c) Where money lands (rule 2).** The builder lists every writer that moves money or debt between folios, stays or bookings. Grep for writers it missed: posting corrections and reversals, split folios, group/master folios, allowance and package postings, the receivables transfer it calls N/A, folio close/reopen, and stay move/merge in reservations. Try both orders.
- **(d) Verify the proof.** Re-run 2 of the builder's mutants (N7 and N8 suggested), and plant 1 of your own on the guard you judge riskiest. A survivor is a finding.
- **(e) Regressions caused by the class fix.** Check whether legitimate front-desk flows now fail where they shouldn't:
  - a walk-in paying their own folio by card at the terminal;
  - a corporate guarantee for a stay the agreement names;
  - deposit collection by payment link;
  - a no-show fee after night audit.

  If a normal hotel flow is now impossible, report it as a P1 (usability with no workaround) or a P2.
- **(f) Gates on the merged copy, exit codes captured, never piped:** `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm turbo run typecheck --force`, `pnpm turbo run test --force --concurrency=2`.

## Output
- **Report opening:** the verdict (merge / merge after fixes / do not merge), counts by severity, and the coverage declaration.
- **Each finding:** an ID (R6-…), file:line, and a reproducing test.
- **When done:** remove the scratch copy and `review_intstep6*` databases.
- **Final reply:** verdict, counts, top findings, mutant results, and the file list.
````

## Report (2026-11-08T01:07:44.581Z)

````text
## Re-review #6 of `feat/integration-step` @ `333a83e`: merge after fixes

**Counts:** P0 0 · P1 2 · P2 1 · P3 3.

I merged `main` @ `a462a4a` into a scratch copy with no conflicts. The branch did not move during the run, and I did not change its worktree. I drafted the attack plan from Amendment 4 and the code before reading the builder's report. I committed nothing.

**Coverage:** focused re-review. Of the 12 checklist items, 9 were probed or code-read, 2 were not probed (with reasons) and 1 does not apply. The pattern subset is in § 7. Not reached:
- a 10-round concurrency re-run;
- probing allowance grant and close postings;
- probing the hold-increase purpose (code-read only, folded into R6-P1-1);
- a full pattern sweep.

### (a) The r5 PoCs re-run on the merged copy
All 4 FINDING tests now fail and all 4 CLEAN tests pass.
- **R5-A2** is refused at line 307 (`no_show_not_recorded`).
- **R5-C** is refused at line 408 (`forbidden`).
- **R5-D** is refused at line 506 (`mandate_reference_not_covered`).
- **R5-A1** is refused earlier than its FINDING line, at line 242 during setup. Its staff agreement has no `maxAmount`, which rule 3 now rejects (`mandate_limit_required`). The same attack with a limit is the builder's flipped R5-A1, which returns `no_show_not_recorded` and passes. I accept it as closed.

### (f) Gates (exit codes written to a file, never piped)
- install: exit 0
- lint: exit 0 (863 files; module boundaries OK)
- typecheck: exit 0 (18/18 tasks, none cached)
- tests: exit 0 (16/16 tasks, none cached). Payments 161, api 166 (+29 todo), finance 92, reservations 154.

### Top findings
Each has a reproducing test in `r6-fix-attacks.test.ts.txt`. The FINDING tests pass on the merged copy, which shows the defects exist.

- **R6-P1-1 — a capture's purpose is still a label.**
  - Where: `collect.ts:599-607` and `:651`; `consent.ts:252-256`.
  - A capture is checked for consent as `guarantee` but lands as a folio `balance`, and the fact limits are not applied to it.
  - Repro: a card agreed for guarantee + no-show is refused a USD 2,500 balance charge. The desk then places a hold for the same amount and captures it: both are accepted, and the folio is paid.
  - Only the front-desk role is needed. This is the R5-P1-1 harm through a sibling path.
- **R6-P1-2 — a refund posting is neither money nor debt to finance's provenance.**
  - Where: `provenance.ts:125` returns `none` for a refund, and `postings.ts:1386-1406` then runs neither coverage check.
  - Repro: Otto pays his USD 300 spa bill by link, and the payment is refunded. The refund posting is moved to Vera's covered folio (accepted), and Vera's card is then charged USD 300 (accepted). Vera's card has paid Otto's spa.
  - It needs a role with transfer and refund rights (GM or supervisor). This is the R5-P1-2 harm.
- **R6-P2-1 — the no-show penalty is not checked against the ledger.**
  - Where: `purpose.ts:148-158`.
  - Repro: the night audit posts the penalty and the GM credits it off. The desk then posts minibar and laundry for the same amount and takes it from the card as a `no_show` fee: accepted.
- **P3s:**
  - **R6-P3-1:** `forfeitDeposit` keeps a card-funded deposit as revenue without a recorded penalty. It is missing from the builder's list of money-moving writers.
  - **R6-P3-2:** the deposit owed is summed per terms snapshot rather than per stay, so it can be counted twice or once too few.
  - **R6-P3-3:** two lines of the builder's claim ledger overstate the coverage.

Each fix in the report is written as a rule with its known cases:
- consent is judged on the purpose of the money where it lands;
- every non-zero posting is someone's money or debt, with no `none`;
- a no-show fee rests on the penalty as it stands on the ledger.

### (e) Front-desk regressions
None found.
- A walk-in paying at the terminal works (recorded payment, code-read).
- A corporate card named for the booking pays the master folio its stay is routed to. My test R6-C confirms this.
- Deposit by payment link works.
- The no-show fee after night audit is accepted up to the penalty.

### (d) Mutant results
| Mutant | Planted at | Result |
|---|---|---|
| Builder N7 (folio debt origins) | `consent.ts:164` | Killed: 1 module test, 3 api tests |
| Builder N8 (re-check under the lock) | `collect.ts:829` | Killed: 1 api test (the held-transfer test) |
| Mine, R6-M1 (`cardMoneyMayMeet` ignores the folio-reference source) | `consent.ts:337` | Killed by the module suite only; no api test kills it |

R6-M1 is not a survivor, but no api test covers card money that is still in flight. One test there would close that gap.

### Files
- `/home/user/portico/docs/orchestration/reviews/review-integration-step-6.md` (report, uncommitted)
- `/home/user/portico/docs/orchestration/reviews/integration-step-poc/r6-fix-attacks.test.ts.txt` (tests R6-A, B and D are findings; R6-C is clean)

### Cleanup
I removed the scratch copy with `git worktree remove` and pruned. No `review_intstep6*` databases remain.
````

