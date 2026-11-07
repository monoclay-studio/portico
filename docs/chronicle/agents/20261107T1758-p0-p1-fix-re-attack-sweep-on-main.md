# Agent run: P0/P1 fix re-attack sweep on main

- Started: 2026-11-07T17:58:35.237Z · last activity: 2026-11-07T18:15:28.682Z
- Turns: 294 · tool uses: 180 · output tokens: 187,470
- Type: general-purpose

## Brief (2026-11-07T17:58:35.237Z)

````text
Your launch brief is the "Launch brief (v2)" section of /home/user/portico/docs/quality/playbooks/steward-reviewer.md, currently playbook v2.1. Read that section and follow it exactly as written, including its Pattern sweep (steps 1–6, with the v2.1 "fixes as principles" and load-bearing checks) and the "Variant: focused re-review (after a fix round)" section. Read CLAUDE.md first.

Run parameters (filled by the orchestrator):

```
MODULE:            main — re-attack sweep of every P0 and every money/security P1 fix already merged
                   (guests, inventory, rates, payments, operations, reservations, integration, finance, backoffice)
BRANCH / COMMIT:   main @ 722b345 or later (record the exact commit you review)
WORKTREE:          /home/user/portico (read-only for you)
SCRATCH COPY:      /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-sweep-copy
                   (git worktree add --detach <copy> main; remove it at the end)
SPEC / README:     docs/specs/<module>.md and modules/<module>/README.md for each module
FOCUS AREAS:       (a) For each first-round review in docs/orchestration/reviews/review-<module>.md, take every P0,
                       and every P1 in the money / tenant-or-property isolation / authorization / concurrency /
                       webhook / offline-sync classes. Re-run its original attack (PoCs in the review, or rebuild them
                       from the attack steps), inverted: each must be refused on main.
                   (b) Attack each fix itself: reverse order, sibling code paths, failure paths, retries and
                       concurrency, griefing.
                   (c) Exemption audit: list every exemption the fix leaves (early returns, "first X is accepted",
                       optional scope parameters, "booking deposits skip", default-allow branches) and attack each.
                       Known residuals already found elsewhere (don't re-report them; confirm they are tracked):
                       payments/finance booking-deposit ownership (integration-step review P1-1), finance's optional
                       all-property scope, rates seal not verified on sibling functions.
                   (d) Use the pattern library docs/quality/patterns.md (AP-01…AP-56) as the sweep list, and
                       declare coverage per pattern.
PARITY FILE:       none (sweep)
DB PREFIX:         PORTICO_TEST_DB_PREFIX=review_sweep (Postgres at postgres://postgres@127.0.0.1:5432/postgres;
                   drop your databases at the end)
REPORT PATH:       /home/user/portico/docs/orchestration/reviews/review-fix-sweep.md (do not commit);
                   PoCs as docs/orchestration/reviews/fix-sweep-poc/*.ts.txt
UI REVIEW?:        only the backoffice P0 (cache leak across users on a shared tab) and P1-2 (uncertain outcomes)
```

Budget note: weekly usage is constrained. Prioritise P0 fixes, then money and isolation P1s. Stop adding P2-only exploration once those are covered, and say what you didn't reach.

Reply with:
- the verdict per module (fix holds / residual found);
- the counts;
- the top findings in plain English;
- the report path.
````

## Report (2026-11-07T18:15:28.572Z)

````text
**Fix re-attack sweep (review-fix-sweep.md): payments and guests have residual holes; the other seven modules' fixes hold.** Reviewed `main` @ `4ea8905` (722b345 plus two docs-only commits).

I re-ran 56 original attacks (15 P0s and 41 P1s in the money, isolation, authorization, concurrency, webhook and offline-sync classes):
- **48** are now refused on main.
- **4** still get through by a different path or at the edge of the fix (all four are the P1 findings below).
- **2** are held only by detection or by failing closed, and both are already tracked: operations P1-12 and reservations R-01.
- **2** were not re-probed or don't apply on main: finance F-09, and reservations R-14.

**Checks:** lint, typecheck (`--force`) and all 10 test suites pass (exit codes read directly). The 5 new PoC tests fail, and they are written to pass only on the safe outcome, so each failure confirms a residual.

## Verdict per module
| Module | Verdict |
|---|---|
| **payments** | residual found (3 P1, 1 P2) |
| **guests** | residual found (1 P1) |
| finance | fix holds (1 P2 boundary) |
| rates | fix holds (1 P2 default) |
| backoffice (P0-1, P1-2) | fix holds; the P0-1 regression test can't fail (P2) |
| inventory | fix holds (P3 note) |
| operations | fix holds; P1-12 only flags the problem, inventory-side refusal tracked in pending-fixes |
| reservations | holds on main: its rates/finance/payments ports are stubs, so it fails closed. The real bindings are on `feat/integration-step`, which isn't merged and wasn't swept |
| integration | fix holds (P3 nit) |

**New findings:** P0 0, **P1 4**, P2 4, P3 2.

## Top findings
1. **SW-PAY-1 (P1).** The guard against collecting a deposit twice (payments P1-2) only covers the desk charge. After a guest pays the deposit by link, staff can place a hold on the card and capture it. No reason is asked and two deposits are posted. The guard reads are also unlocked, so a link payment can race a desk capture.
2. **SW-PAY-3 (P1).** A desk user at property A can't see a card saved at sister property B, but can still charge it (USD 2,500 in the PoC). The P0-1 fix checks the folio, not the card. This is the direct payments route; integration-step P1-2 is the check-in version of the same problem.
3. **SW-PAY-4 (P1).** The P1-8 fix ("who initiates is a fact, not a claim") decides "guest present" from `entryChannel`. The client sends that field and it defaults to `hosted_entry`. Staff saved a card with no agreement and charged it twice (USD 900 each) as if the guest were present.
4. **SW-GUE-1 (P1).** Erasing a guest reports "completed", but the stored response to the original create request still holds their name and date of birth. Replaying that request returns them. The erasure test doesn't scan that store.
5. **The P2s:**
   - **SW-BO-1:** the cache-leak e2e test reloads the page, so it would pass even with the fix removed.
   - **SW-RAT-1:** a fee a hotel creates defaults to "statutory", so the R-01 re-pricing comes back for every hotel-added fee.
   - **SW-PAY-2:** labelling a charge `custom` skips the double-collection guard with no reason and no audit.
   - **SW-FIN-1 (code-read only):** editing a billing rule's codes or target folio resets its spending limit.

The four P1s fall into two patterns. In three, the fix guarded only the path the reviewer named (charge but not capture; folio but not card; tables the test scans but not the request-response store). In one, the fix moved the trust onto a different client-set field. The builders' regression tests replay the reviewer's exact attack, so the other paths go untested. The report suggests requiring one test per sibling entry point in the next builder self-check.

## Known residuals: confirmed tracked, not re-reported
- **Booking-deposit ownership:** integration-step P1-1, in STATUS. The exemption is still on main at `payments/src/service/shared.ts:149`.
- **Finance's optional all-property scope:** integration-step P2-2, and a foundation line in pending-fixes.
- **Rates seal not checked by the sibling functions:** integration-step P2-3. The one HTTP entry point, `/terms/penalty`, does check it.

## Coverage
- 55 patterns listed: 6 not applicable, 38 probed or code-read, 11 not probed (reasons given in the report).
- **Not reached:**
  - reservations against real providers (integration-step);
  - AP-29, AP-39, AP-40–44, AP-46, AP-48;
  - finance F-09's assertion;
  - concurrent duplicate payments webhooks (reasoned from code only).

Report (not committed): `/home/user/portico/docs/orchestration/reviews/review-fix-sweep.md`
PoCs:
- `/home/user/portico/docs/orchestration/reviews/fix-sweep-poc/payments-zz-review-sweep.test.ts.txt`
- `/home/user/portico/docs/orchestration/reviews/fix-sweep-poc/api-zz-review-sweep-guests.test.ts.txt`

The scratch worktree is removed and every `review_sweep` database has been dropped.
````

