# Agent run: Focused re-review #5: integration-step

- Started: 2026-11-07T23:36:13.255Z · last activity: 2026-11-07T23:54:57.090Z
- Turns: 75 · tool uses: 77 · output tokens: 79,138
- Type: general-purpose

## Brief (2026-11-07T23:36:13.255Z)

````text
You are Portico's architecture steward, running a **focused re-review (#5)** of `feat/integration-step` after its fix round 4. You did not write this code. Your job is to find what is still wrong before it reaches `main`.

**Usage note:** the account's weekly allowance is at about 90% and has no overage. Keep this run tight. It is a focused re-review, not a full review. Aim for about 60–90 tool calls. Commit nothing yourself.

## How to run it
Read `docs/quality/playbooks/steward-reviewer.md` (v2.1) and follow its **Launch brief** and the focused re-review shape (re-run earlier attacks, attack the fixes, sibling paths, reverse order, coverage declaration) with these run parameters:

```
MODULE:            integration-step (cross-module port bindings; this round: payments consent and limits, payment-request lifecycle, finance deposits lock order)
BRANCH / COMMIT:   feat/integration-step @ a1bdd70 (record the commit you actually review; re-check findings if it moves)
WORKTREE:          /home/user/wt/integration-step (read-only for you)
SCRATCH COPY:      /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-intstep5-copy (git worktree add --detach <copy> feat/integration-step; then merge current main into the copy)
SPEC / README:     docs/adr/0015-authorization-across-module-ports.md (Amendments 1–3), modules/payments/README.md, docs/architecture/domain-map.md, docs/OPEN_QUESTIONS.md Q156 and Q160
FOCUS AREAS:       see below
PARITY FILE:       none for this round
DB PREFIX:         PORTICO_TEST_DB_PREFIX=review_intstep5
REPORT PATH:       docs/orchestration/reviews/review-integration-step-5.md; PoC files in docs/orchestration/reviews/integration-step-poc/r5-*.test.ts.txt
UI REVIEW?:        no
```

## Inputs
- **The builder's fix-round-4 report, verbatim:** the last report in `docs/chronicle/agents/20261107T1616-integration-step-bind-module-ports.md` (heading "Integration-step fix round 4: report"). It has the claims, the § 5.1 state machine, the derived writer lists, the control-fact grid, the § 5.4 mutation table (M1–M11) and the § 6 claim ledger. Treat every line as a claim to verify, not as fact. Do not read it until you have drafted your own attack plan from the code and ADR-0015 Amendment 3.
- **Previous review:** `docs/orchestration/reviews/review-integration-step-4.md`.
- **Its PoCs:** `docs/orchestration/reviews/integration-step-poc/r4-fix-attacks.test.ts.txt` and `r4-inverted-r3-original-pocs.test.ts.txt`.

## Focus areas
- **(a) Re-run every r4 attack inverted on the merged copy**, and confirm each is refused at the right line.
- **(b) Consent scope (R4-P1-1).** Look for any staff-editable path that still widens what a card covers:
  - a new agreement recorded by staff naming bookings;
  - `scope.folioIds` (new this round);
  - folio transfers or splits;
  - moving a stay or charges between folios or bookings;
  - group or master folios;
  - profile merge/unmerge;
  - the channel virtual-card path;
  - re-confirmation flows;
  - anything that changes which folio a charge lands on after consent.
- **(c) The running total (R4-P1-2).** Check what goes up and down: refunds, voids, expiries, failed captures and partial captures, in-flight increases, and multi-currency. Also check concurrency at N=10, not the builder's N=5. Try lock-order cycles between the card-row lock and the collection lock, and the order across finance `applyDeposits`.
- **(d) The link lifecycle (R4-P2-1/2):**
  - the deactivating → completed → deactivated exits;
  - the new `POST /v1/payments/requests/:id/link-stopped` route: who may call it, idempotency, audit, and whether staff can falsely mark a live link stopped;
  - the over-collected refund amount when several links or partial payments exist.
- **(e) Verify the proof (steward v3 "verify the proof", promoted this run because builder mutation tables now exist).** Re-run 2 of the builder's mutants (M6 and M9 suggested; your choice). Plant 1 mutant of your own on the guard you judge riskiest. A survivor is a finding.
- **(f) Gates on the merged copy, exit codes captured, never piped:** `pnpm install --frozen-lockfile`, `pnpm lint` (now `--error-on-warnings`), `pnpm turbo run typecheck --force`, `pnpm turbo run test --force --concurrency=2`. Main gained the infra merge (ci.yml, Dockerfiles), so report any conflicts.

## Output
- Write the report to the REPORT PATH, starting with: verdict (merge / merge after fixes / do not merge), then counts by severity and the coverage declaration.
- Each finding gets an ID (R5-P1-1, …), file:line, and a reproducing test.
- Remove your scratch copy and `review_intstep5*` databases when done.
- Your final reply: verdict, counts, top findings, the mutant results, and the file list.
````

## Report (2026-11-07T23:54:57.000Z)

````text
## Verdict: **merge after fixes** — `feat/integration-step` @ `a1bdd70`

Counts: **P0 0 · P1 2 · P2 2 · P3 4.** The commit did not move during the run, and I committed nothing.

Coverage: 61 patterns, 44 applicable (25 probed, 19 code-read), 17 not applicable with reasons, none left unprobed.

All four gates exit 0 on the merged copy. `main` @ `39ef7e2` merged in with no conflicts; the infra merge was already in the branch.
- `pnpm install --frozen-lockfile`: 0
- `pnpm lint` (`--error-on-warnings`): 0, 859 files
- `pnpm turbo run typecheck --force`: 0, 18/18 tasks, none cached
- `pnpm turbo run test --force --concurrency=2`: 0, 16/16 tasks, none cached

**(a) The r4 attacks re-run inverted.** Every r4 FINDING is refused at its FINDING line, or at the same line shifted once the setups record consent first (`bookWithCard`). A few, R4-J among them, are now refused earlier by consent. Two gaps:
- R4-K, R3-D1 and the old fd15 PoC are refused in setup by the new named-bookings rule. R4-K and R3-D1 are covered by the builder's flipped tests, which pass. fd15 was not re-run; its code did not change.
- R4-E's "no exception" line still passes, because that PoC never moves the clock past the 30-minute deadline. The builder's flipped R4-E (40 minutes) proves the alarm.

## Top findings

1. **R5-P1-1: the `no_show` purpose is a label the desk types.**
   - Where: `contracts.ts:352` and `:376` accept it from any caller; `consent.ts:167-170` treats it as fact; `collect.ts:201-209` does not treat it as a catch-all label.
   - A card agreed for "guarantee + no-show fee" pays USD 2,500 of an ordinary bill (`accepted`) on a stay that is not a no-show. The same charge as `balance` is refused (`mandate_purpose_not_covered`).
   - It also re-opens R4-J: a paid deposit link is collected again as `no_show` with no reason.
   - The builder's own no-show test charges a booking months before arrival and asserts `accepted`.
   - Fix: derive the purpose from the reservations no-show or cancellation penalty, capped at what that penalty still owes. The desk lacks `reservations.stay.noShow`, so it cannot create that fact.
2. **R5-P1-2: "a stay added later is not covered" holds only for stay references.**
   - `consent.ts:185` returns `true` when the reference has no stay.
   - After `add_stay` puts Otto on Vera's named booking, the desk charges Vera's card USD 2,500 as a booking-level deposit (`accepted`). `applyDeposits` then moves it to Otto's added-stay folio.
   - That is the R4-A2 harm through a sibling path. Fix: check coverage when the money is used and again when the deposit is applied, so the reverse order is closed too.
3. **R5-P2-1: "link stopped" also accepts a `completed` link** (`requests.ts:516`), one the provider reported as already paid.
   - It releases the replacement before that payment is recorded. A front-desk agent can do it with no exception and no deadline, although finance owns the exception. The route takes no `If-Match`.
   - Probe result: the replacement asks again for the USD 200 just paid; the guest pays it, the folio ends in credit, and an overpaid item is raised.
   - Fix: refuse staff confirmation on `completed`. On `deactivating`, allow it only to a finance role, and only once the exception exists.
4. **R5-P2-2: mutation survivor.** Removing `pending_verification` from the running total (`consent.ts:234`) leaves all 152 payments tests and all 152 api tests green. My R5-M test (a timed-out charge, then a second charge) passes on `a1bdd70` and kills the mutant.
5. **P3s:**
   - R5-P3-1: the consent evidence's time and channel come from the client, although the code says "never by the client".
   - R5-P3-2: guest ownership checks read `owner_id`, which a profile merge rewrites. `confirmCardForBooking` has no route, so the README's "today it is guest self-service" overclaims. Latent.
   - R5-P3-3: after "already paid", any earlier partial payment counts as the reported one (simulator-only); the overpaid item states the wrong credit figure.
   - R5-P3-4: proof strength. M6's module test kill depends on timing, and the `applyDeposits` lock-order fix is guarded only by a 12-round probe (about a 34 % chance of catching a regression).

Clean on attack:
- **Running total at N=10:** one capture, 4 charges and 5 holds at once on a USD 100 agreement, 3 rounds. Taken plus open stayed at or under USD 100, with no deadlock.
- **Lock order:** no path takes the collection lock and then the card lock.
- **Other paths:** channel virtual cards, re-saving a card token, captures onto another reference, refunds, voids and expiries, mixed currencies.

## Mutant results

| Mutant | Guard removed | Result |
|---|---|---|
| Builder M6 | card-row `FOR UPDATE` | Killed by api R4-B, the three-concurrent-holds test and my R5-B. The module test caught it in the full run but not in isolation |
| Builder M9 | collection lock in `assertCollectionOwnership` | Killed by E-114 ×2, as claimed |
| Mine | running total without `processing` and `pending_verification` | Killed by R4-B |
| Mine | running total without `pending_verification` | **Survived** (R5-P2-2) |

Every mutant was restored, and the copy's diff was empty after each one.

**Owner question candidate (for Q160):** should `maxAmount` be mandatory for agreements staff record? Every remaining widening, including named-folio postings and the residuals of both P1s, is bounded only by that optional cap.

The scratch copy and all `review_intstep5*` databases are removed (none remain). The report and PoC files are written but not committed.

## Files

- /home/user/portico/docs/orchestration/reviews/review-integration-step-5.md
- /home/user/portico/docs/orchestration/reviews/integration-step-poc/r5-fix-attacks.test.ts.txt (FINDING: R5-A1, R5-A2, R5-C, R5-D; CLEAN: R5-B ×3, R5-M)
- /home/user/portico/docs/orchestration/reviews/integration-step-poc/r5-inverted-r4-fix-attacks.test.ts.txt
- /home/user/portico/docs/orchestration/reviews/integration-step-poc/r5-inverted-r4-r3-original-pocs.test.ts.txt
````

