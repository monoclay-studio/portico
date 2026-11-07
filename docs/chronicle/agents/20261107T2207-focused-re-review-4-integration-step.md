# Agent run: Focused re-review #4: integration-step

- Started: 2026-11-07T22:07:57.872Z · last activity: 2026-11-07T22:37:11.198Z
- Turns: 128 · tool uses: 132 · output tokens: 149,757
- Type: general-purpose

## Brief (2026-11-07T22:07:57.872Z)

````text
Your launch brief is the "Launch brief (v2)" section of /home/user/portico/docs/quality/playbooks/steward-reviewer.md (latest version). Follow it in its "Variant: focused re-review (after a fix round)" form. Read CLAUDE.md first. Keep it focused on the money paths.

Run parameters (filled by the orchestrator):

```
MODULE:            integration-step — FOCUSED RE-REVIEW #4 of fix round 3 (payments consent + payment-request lifecycle)
BRANCH / COMMIT:   feat/integration-step @ 1424662 or later (record the exact commit)
WORKTREE:          /home/user/wt/integration-step (read-only for you)
SCRATCH COPY:      /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-intstep4-copy
                   (git worktree add --detach <copy> feat/integration-step; merge current main; remove at end)
SPEC / README:     docs/orchestration/reviews/review-integration-step-3.md and its PoCs (integration-step-poc/r3-*);
                   ADR-0015 Amendments 1 and 2; modules/payments/README.md (consent, request lifecycle, lock order);
                   docs/architecture/domain-map.md § "Integration-step fix round 3"
FOCUS AREAS:       (a) Re-run the r3 PoCs inverted. Each must be refused.
                   (b) The builder's claims, verbatim: "Hotel staff can no longer take money from a stored card
                       beyond what the cardholder agreed to … a stored agreement without a recorded scope is now
                       refused"; "maxAmount caps everything taken on the card under the agreement … custom is never a
                       covered purpose"; "the guest no longer receives a new payment link until the old one is
                       confirmed dead at the provider … while the provider is down, the old link stays marked
                       possibly payable and the replacement waits". Attack each one step beyond:
                       - consent: refunds and reversals restoring headroom; currency mixing in the running total;
                         mandate edits and revocation racing a charge; the "card the guest entered for a booking"
                         exemption across a booking move, split or merge;
                       - lifecycle: webhook ordering (paid before deactivated); a provider that never answers;
                         reconciliation retries; two closes racing; a link created for a request closed meanwhile
                         (the builder says there is no deterministic test).
                   (c) Re-check the 5 exemptions the builder added, each with its attack.
                   (d) Lock order everywhere: collection lock (per booking family) → folio row → request row. Look for
                       any path that inverts it.
PARITY FILE:       none
DB PREFIX:         PORTICO_TEST_DB_PREFIX=review_intstep4 (drop your databases at the end)
REPORT PATH:       /home/user/portico/docs/orchestration/reviews/review-integration-step-4.md (do not commit); PoCs as
                   docs/orchestration/reviews/integration-step-poc/r4-*.ts.txt
UI REVIEW?:        no
```

Gates on the merged copy:
- `pnpm lint`;
- `pnpm turbo run typecheck --force`;
- `pnpm turbo run test --force --concurrency=2`.

Check exit codes.

Reply with:
- the verdict (merge / merge after fixes / do not merge);
- the counts;
- the top findings in plain English;
- the report path.

If no P0 or P1 remains, say so plainly.
````

## Report (2026-11-07T22:37:10.903Z)

````text
## Verdict: **merge after fixes** — 2 P1s remain

I reviewed `feat/integration-step` at `1424662` on a scratch copy with `main` (`e4954c1`) merged in.

**Counts: P0 0 · P1 2 · P2 2 · P3 6.** Patterns: 27 of the 46 that apply were probed, 19 were checked by reading code only, and none were left out.

**Gates on the merged copy** (exit codes captured directly):
- `pnpm lint`: exit 0, with 0 warnings now.
- `pnpm turbo run typecheck --force`: exit 0, 18 of 18 tasks, none cached.
- `pnpm turbo run test --force --concurrency=2`: exit 0, 16 of 16 tasks, none cached. The api package has 129 passing tests and payments has 142.

**The r3 attacks, re-run inverted: every one is now refused.**
- First-review attacks: 9 of 9 refused. One test setup needed a change: it charged a stranger's card for a booking deposit, which the new consent rule correctly refuses.
- All 8 "this is broken" tests from review 3 now fail at, or one line before, the line that proved the defect. So each defect is gone. The relabelled-purpose attack was re-run inverted and is refused.
- Also holding:
  - Two cancels racing on the same payment link: no problem in 10 runs, with both orders seen.
  - A link created while its request was being closed: handled correctly, now with a repeatable test.
  - An old saved-card agreement with no recorded scope: refused for charges, holds, hold increases and captures.

**Top findings:**
1. **P1 (R4-P1-1): staff can still put a guest's saved card in reach of any booking.**
   - A card saved with a general "card on file" agreement covers "the cardholder's own bookings". Front-desk staff decide who is on a booking.
   - A desk agent created a booking for Otto that named Vera as the booker, then charged Vera's card USD 5,000 for it. The test card's agreement had no limit.
   - Worse: one routine "add a stay" change put Vera on Otto's existing booking. Her card then paid USD 2,500 onto Otto's original bill.
   - The payments code's own comment says staff linking a person to a booking never extends the cardholder's consent.
   - This is partly review 3's fault: its suggested "payer directory" fix didn't consider who can edit that directory.
   - Suggested default: a guest's general agreement covers only the bookings it names; anything else needs a payment link or the card terminal. Whether a saved card should cover future stays booked by phone is your call (add it to `OPEN_QUESTIONS`).
2. **P1 (R4-P1-2): the agreement's spending limit can be beaten by charging in parallel.**
   - The running total is read without a lock. Five simultaneous USD 100 charges on a USD 100 agreement all succeeded, taking USD 500.
   - This reproduced in 4 of 4 runs.
   - Fix: lock the saved card before reading the total, on charge, capture, hold and hold increase.
3. **P2 (R4-P2-1): the urgent "refund" alert gives the wrong amount.** When a guest pays a link that was replaced or has expired, the alert says to refund the whole payment even when the guest owed it. The builder's own scenario shows it: the guest paid $234, still owed $117, and the alert said "Refund $234.00". In the same area:
   - When the provider says the old link was already paid, the replacement link is released anyway, still asking for the old amount.
   - The simulator can't produce that "already paid" answer, so no test reaches this path.
   - Links that expire are never switched off at the provider.
4. **P2 (R4-P2-2): if the provider never confirms the old link is off, the replacement waits forever.** No alert is raised and nobody owns it. Meanwhile the late-charge item tells staff "A payment link for $351.00 is open — send it", but no link exists.
5. **P3 (R4-P3-2): one module still takes its locks in the wrong order, and it can deadlock.**
   - Applying a booking's deposits at check-in locks the deposit record before the shared lock that payments takes first. A deposit-link payment arriving at the same moment can deadlock with it.
   - Reproduced 3 times in about 88 rounds. It causes a retried posting and an urgent alert, but no bad data.
   - Everywhere else the order you asked about (shared lock → bill → payment request) holds.

**Other P3s:**
- Two holds at once can each use the full limit.
- A "balance" charge right after a paid deposit link needs no reason, so it can collect the deposit a second time before it is applied.
- An agreement covering "no-show" fees never matches any charge.
- A code comment calls the limit "per use" while the code treats it as a total.
- The Stripe adapter sets link expiry to 7 days, which is more than Stripe's 24-hour maximum, and its link switch-off has no test.
- Two guest-facing paths skip the consent check, but no guest-facing screen exists yet.

**About the "5 exemptions":** the builder's round-3 report isn't in the repo. I listed the five exceptions the round-3 code adds and attacked each one; they are in report § 5. The older "wait while a payment is still being confirmed" exception now holds.

**No P0. Two P1s remain.**

Files are in `/home/user/portico/docs/orchestration/reviews/`:
- review-integration-step-4.md — the report (not committed)
- integration-step-poc/r4-fix-attacks.test.ts.txt — the new attacks, 13 tests
- integration-step-poc/r4-inverted-r3-original-pocs.test.ts.txt — the earlier attacks, inverted

You already committed both test files as work in progress (`072cd80`), and that commit matches their final content. The scratch copy has been removed, no `review_intstep4*` databases remain, and the branch worktree was not touched.
````

