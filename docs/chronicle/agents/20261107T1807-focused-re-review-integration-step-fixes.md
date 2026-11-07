# Agent run: Focused re-review: integration-step fixes

- Started: 2026-11-07T18:07:37.453Z · last activity: 2026-11-07T18:29:35.323Z
- Turns: 220 · tool uses: 135 · output tokens: 252,872
- Type: general-purpose

## Brief (2026-11-07T18:07:37.453Z)

````text
Your launch brief is the "Launch brief (v2)" section of /home/user/portico/docs/quality/playbooks/steward-reviewer.md (playbook v2.1). Follow it as written, in its "Variant: focused re-review (after a fix round)" form. Read CLAUDE.md first.

Run parameters (filled by the orchestrator):

```
MODULE:            integration-step (cross-module port bindings) — FOCUSED RE-REVIEW of the fix round
BRANCH / COMMIT:   feat/integration-step @ 6fb1d00 or later (record the exact commit)
WORKTREE:          /home/user/wt/integration-step (read-only for you)
SCRATCH COPY:      /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-intstep2-copy
                   (git worktree add --detach <copy> feat/integration-step; then merge current main into the copy;
                   remove it at the end)
SPEC / README:     docs/orchestration/reviews/review-integration-step.md (first review) and its PoCs in
                   docs/orchestration/reviews/integration-step-poc/; ADR-0015 (incl. §5 as amended); the module READMEs
                   of reservations, finance, payments, rates
FOCUS AREAS:       (a) Re-run every first-review PoC inverted: each must now be refused.
                   (b) Attack the three P1 fixes themselves (the builder's claims, verbatim):
                       P1-1 "reservations now answers which property owns this booking/stay; finance uses it before
                       recording any deposit … payments no longer lets unknown bookings through and refuses holds for
                       another property's/unknown stay or booking";
                       P1-2 "choosing another card or an amount at check-in needs payments.payment.collect; the card must
                       belong to the booking's booker, an occupant, the company/agency or the billing payer (also when a
                       booking records/patches its card); the amount is capped by policy
                       reservations.checkIn.guaranteeCapPercent (default 150% of the agreed stay total)";
                       P1-3 "finance requests min(late charge, folio balance after posting) … under the folio row lock".
                   (c) Gaps the builder itself declared, which must be probed: no concurrent test for two late charges on
                       the same folio; no ±1 boundary test at the guarantee cap; saved-card ownership when a second guest
                       saves the same token; payments events lack aggregateVersion.
                   (d) Exemption audit on every fix (early returns, optional parameters, "external charges ⇒ step done"
                       in P3-9, the money-redaction `unknown` state).
                   (e) Pattern sweep steps 2–6 against the fix commits only.
PARITY FILE:       none
DB PREFIX:         PORTICO_TEST_DB_PREFIX=review_intstep2 (Postgres at postgres://postgres@127.0.0.1:5432/postgres;
                   drop your databases at the end)
REPORT PATH:       /home/user/portico/docs/orchestration/reviews/review-integration-step-2.md (do not commit); new PoCs
                   as docs/orchestration/reviews/integration-step-poc/r2-*.ts.txt
UI REVIEW?:        no
```

Keep it focused: this is a re-check, not a full review. Gates must run on the copy merged with current main:
- `pnpm lint`;
- `pnpm turbo run typecheck --force`;
- `pnpm turbo run test --force --concurrency=2`.

Check exit codes.

Reply with:
- the verdict (merge / merge after fixes / do not merge);
- the counts;
- the top findings in plain English;
- the report path.
````

## Report (2026-11-07T18:29:35.201Z)

````text
**Verdict: merge after fixes.** All 7 original attacks are now refused, but attacking the three P1 fixes themselves finds three new P1s. Each fix stops the exact attack that was reported and fails one step beyond it.

**Counts:** P0 0 · P1 3 · P2 4 · P3 5. I probed 24 of the 37 applicable patterns (groups A–E). The rest were checked by reading code.

**Commit reviewed:** `feat/integration-step` @ `6fb1d00`, with `main` @ `318fbab` merged into a scratch copy. During the review the branch moved to `36a5849`, but that has no file difference from `6fb1d00`, and `main`'s later changes are docs only, so the findings stand. The scratch copy is removed and no test databases remain.

**Gates (exit codes on the merged copy):** `pnpm lint` 0, `pnpm turbo run typecheck --force` 0 (18/18, none cached), `pnpm turbo run test --force --concurrency=2` 0 (16/16, none cached).

**Original PoCs, inverted:** 9/9 now refused. That covers the cross-property and unknown-booking deposit, the stranger's card at check-in, the over-collected late charge, the money leak to housekeeping, finance's unscoped delegation, the forged rates terms, and the connected-mode check-in dead end. Of the other first-review findings, P2-4, P2-5, P2-6 (rates), P2-7 and most P3s are closed; P3-3, P3-7 and guests P2-6 are deferred to `pending-fixes.md`.

**Top findings:**
1. **R2-P1-1 — the card fix can be bypassed by linking the cardholder first.** A reservations agent has no `payments.payment.collect`. They can still read a returning guest's card and profile ids from that guest's own booking. They then create a new booking with that guest as booker or sharing occupant, and record the guest's card as its guarantee; the ownership check passes. An ordinary check-in by a role with no payments key then held USD 7,117.80 on the victim's card. The fix belongs in ADR-0015 §5: a card counts as the agreed guarantee only if the cardholder supplied it for this booking, or a recorded mandate covers it, not because staff linked the person.
2. **R2-P1-2 — late-charge collection only works for one charge.** Payments allows one open balance link per folio, so with three late charges (concurrent or one after another) only 31,900 of 72,850 owed was requested. The fix also introduced a regression: the open exception keeps its first "routine" severity, so the new "collect" is no longer flagged urgent. It also records an amount as requested when nothing was. Separately, reversing a late charge leaves its payment link open for money the guest no longer owes, which is the original harm by another route. Payments needs a command to amend or cancel an open request.
3. **R2-P1-3 — the opening-deposit import never asks reservations who owns the booking.** A Hiyani finance user imported a deposit onto Kandu's booking. Kandu's real deposit then charged the guest's card and failed to post (payment succeeded, ledger failed). The P1-1 fix trusts these imported accounts, which is why this is rated P1. Payments' pre-check and finance's posting check also disagree and should share one predicate.
4. **R2-P2-1 — card ownership is first-saver-wins.** In demo or trial, a second guest who saves the same simulator test token gets the first guest's card and cannot guarantee their own booking. Merging duplicate guest profiles also leaves cards owned by the merged-away profile (from reading the code).
5. **R2-P2-2, R2-P2-3, R2-P2-4:**
   - Housekeeping can still read payment state from the check-in run endpoint and from stay issues.
   - Payments skips its reference check for every type except stay and booking. A Hiyani hold "for" a Kandu folio was accepted, and Kandu's desk then got a 403 on its own folio's payment status.
   - In connected mode, the guarantee step is marked done with "taken in Legacy PMS" although no person and no external system confirmed it.

**On the builder's declared gaps:**
- **Concurrent late charges:** the folio lock works; the defect is finding 2.
- **Cap boundary (±1):** holds. But a non-numeric cap policy removes the cap: USD 25,000 was held on a 1-night stay (R2-P3-1).
- **Same token saved by a second guest:** finding 4.
- **Missing `aggregateVersion` on payments events:** latent only, since nothing consumes those events yet (R2-P3-4).

The other P3s cover: the channel booking paths, the rates seal check being optional rather than required, and revenue managers losing booking totals under the money redaction.

The report is not committed. The orchestrator's checkpoint commit `0fa21bd` on `main` already contains the two new PoC files, identical to my final versions. Each test in `r2-fix-attacks` passes by asserting the defect it demonstrates; flip those assertions once fixed.

Files are in `/home/user/portico/docs/orchestration/reviews/`:
- review-integration-step-2.md
- integration-step-poc/r2-inverted-original-pocs.test.ts.txt
- integration-step-poc/r2-fix-attacks.test.ts.txt
````

