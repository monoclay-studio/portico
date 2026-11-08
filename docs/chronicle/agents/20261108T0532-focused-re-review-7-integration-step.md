# Agent run: Focused re-review #7: integration-step

- Started: 2026-11-08T05:32:52.058Z · last activity: 2026-11-08T05:51:21.380Z
- Turns: 77 · tool uses: 81 · output tokens: 83,085
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

## Report (2026-11-08T05:51:21.224Z)

````text
**Verdict: merge after fixes.** Counts: P0 0 · P1 2 · P2 2 · P3 5.

I reviewed `feat/integration-step` @ `932e7c1`, with `main` @ `1e1be80` merged into a scratch copy. The branch did not move during the run and the worktree was not modified. I committed nothing.

**What held**
- **(a) r6 PoCs, inverted:** all three FINDING tests are now refused at the right line. R6-A is refused at the capture (`:277`, `mandate_purpose_not_covered`). R6-B is refused at the card charge (`:354`, `mandate_reference_not_covered`). R6-D is refused at the `no_show` charge (`:440`, `no_show_penalty_exceeded`). The R6-C corporate-card check still passes.
- **(g) Gates:** all exit 0. Install, lint (864 files, module boundaries OK), `turbo typecheck --force` (18/18, 0 cached) and `turbo test --force --concurrency=2` (16/16, 0 cached). Test counts match the builder's: api 173 (+29 todo), payments 161, finance 92, reservations 154.
- **(f) Front-desk flows:** no regressions. These still work:
  - walk-in paid on the hotel's own terminal (`external_terminal`)
  - corporate card via the master folio
  - deposit by link, then checkout settled by the card on file
  - no-show fee after the night audit (penalty + 1 is refused, the penalty itself is accepted)
- **(b) Captures:** the new `purpose` label cannot steer the derived purpose. A `deposit` label on a folio is refused. A `no_show` label on a booking is refused. Two partial `no_show` captures cannot exceed the penalty.
- **(e) Deposit per stay:** the fix is correct. R7-D1 uses a 4-night stay whose rate plan changes from night 3, giving two segments on two snapshots. The deposit owed comes out at 207,013 = 51,633 + 155,380, matching two reference bookings. The old per-snapshot sum would have been 258,646. This is the distinguishing test the builder said was missing.

**Top findings**
1. **R7-P1-1** — `payments/src/service/consent.ts:430-457` and `finance/src/service/deposits.ts:739-747`. A card-funded deposit is forfeited on the recorded penalty alone, and a forfeit does not count as money already collected. The cancellation penalty is also posted on the folio, so the cardholder can be charged twice for one penalty.
   - F1: forfeit first, then the full penalty charged to the card as `no_show` — both accepted.
   - F2: the reverse order — also accepted.
   - F3: the penalty credited off as goodwill, then the deposit still forfeited.
   - The front-desk role can do all of this, because forfeit needs only `finance.posting.create`.
2. **R7-P1-2** — `finance/src/service/provenance.ts:118-121` and `postings.ts:1384-1408`. When money moves off a folio, the debit it leaves behind has no foreign owner. PoC M1: Otto's cheque is moved onto Vera's folio, then Otto's card is charged for the balance the cheque had paid. Re-review #6's fix text ("its debit counterpart is still debt") was only half implemented.
3. **R7-P2-1** — `payments/src/service/purpose.ts:151-154`. The no-show limit ignores payments not labelled `no_show`. PoC N1: the penalty is paid by cheque, then an ordinary bill is taken from the card as `no_show`.
4. **R7-P2-2** — `provenance.ts:283`. My mutant M7 survived: if `penaltyOn` stops following transfers, nothing in api, finance or payments fails (426 tests). My R7-N2 test kills it.
5. **R7-P3-1…5:**
   - The capture request hash leaves out the new `purpose` label.
   - A customer-initiated hold is captured with no fact limit. It is not reachable today and is missing from the landing table.
   - `recordPayment` with `authorizationId` does not check the hold's property, booking or remaining amount.
   - The landing-table claims for forfeit and transfers overstate what is checked.
   - The unknown-owner branch is unreachable and untested; I suggest a DB-level test.

I suggested an Amendment 6 in § 5 of the report: (1) the debit a credit leaves behind belongs to whoever the credit now benefits; (2) a penalty is one balance, and every way of collecting it draws it down under one lock.

**Mutant results:** builder R2 (capture fact limit) killed. Builder R3 (refund with no owner) killed, 2 tests red. My M7 survived (that is R7-P2-2).

**Not reached:** concurrency probes such as two forfeits at once (AP-56), and routing of a penalty or of a moved credit (code-read only).

**Cleanup:** the scratch copy is removed and no `review_intstep7*` databases remain. The orchestrator had already committed my in-progress report to `main` (402f753, "wip re-review #7"), so the final version shows as modified, not new.

Files are in `/home/user/portico/docs/orchestration/reviews/`:
- `review-integration-step-7.md`
- `integration-step-poc/r7-fix-attacks.test.ts.txt` — 5 FINDING tests (F1, F2, F3, N1, M1) that pass on `932e7c1`, plus CLEAN/PROBE tests N2, C1 and D1
- `integration-step-poc/r7-desk-regressions.test.ts.txt` — the three front-desk regression checks
````

