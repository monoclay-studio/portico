# Agent run: Focused re-review #3: integration-step

- Started: 2026-11-07T21:14:50.880Z · last activity: 2026-11-07T21:37:42.396Z
- Turns: 128 · tool uses: 132 · output tokens: 126,075
- Type: general-purpose

## Brief (2026-11-07T21:14:50.880Z)

````text
Your launch brief is the "Launch brief (v2)" section of /home/user/portico/docs/quality/playbooks/steward-reviewer.md (latest version). Follow it in its "Variant: focused re-review (after a fix round)" form. Read CLAUDE.md first. Keep it focused.

Run parameters (filled by the orchestrator):

```
MODULE:            integration-step (cross-module bindings) — FOCUSED RE-REVIEW #3 of fix round 2
BRANCH / COMMIT:   feat/integration-step @ db6ae8c or later (record the exact commit)
WORKTREE:          /home/user/wt/integration-step (read-only for you)
SCRATCH COPY:      /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-intstep3-copy
                   (git worktree add --detach <copy> feat/integration-step; merge current main into it; remove at end)
SPEC / README:     docs/orchestration/reviews/review-integration-step.md and review-integration-step-2.md with their
                   PoCs (integration-step-poc/); docs/orchestration/reviews/review-fix-sweep.md (payments SW-PAY-1..4);
                   ADR-0015 incl. Amendment 1 (agreed card guarantee); the builder's fix-round-2 claims in
                   docs/chronicle/agents (the "Integration step: bind module ports" agent file, last report)
FOCUS AREAS:       (a) Re-run every earlier PoC, inverted: first review, re-review #2 (r2-fix-attacks) and the
                       payments sweep PoCs. Each must be refused. The builder notes: "the inverted P3-9 PoC (payments
                       variant) needs checkIn.guarantee.externalReference added", and "a stranger's card is still
                       refused even for a user with payments.payment.collect".
                   (b) Attack each invariant the builder claims to have closed ((a)–(f)), ONE STEP BEYOND each fix:
                       other writers of the trusted facts, repeats and inverses, records the fix creates, exemptions
                       (the builder lists 7, each with an attack it ran; re-attack them).
                   (c) The declared open item: invariant (e) on payments' own routes ("card owned by the payer"). Judge
                       its severity under ADR-0015 Amendment 1 and say whether it blocks merge.
                   (d) The merged-tree changes the builder made after merging identity-plus (scenario harness MFA,
                       makeExternal through the real plan/approve/freeze/effective flow, the duplicate data-authority
                       route removed): no weakened tests.
PARITY FILE:       none
DB PREFIX:         PORTICO_TEST_DB_PREFIX=review_intstep3 (drop your databases at the end)
REPORT PATH:       /home/user/portico/docs/orchestration/reviews/review-integration-step-3.md (do not commit); new
                   PoCs as docs/orchestration/reviews/integration-step-poc/r3-*.ts.txt
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
````

## Report (2026-11-07T21:37:42.248Z)

````text
## Integration-step re-review #3: merge after fixes (P0 0 · P1 2 · P2 4 · P3 4)

Reviewed `feat/integration-step` at **`db6ae8c`**, merged with `main` at `2b1d1a6` in a scratch copy. The worktree under review was not modified.

**Gates on the merged copy** (exit codes read directly):
- `pnpm lint`: exit 0, but with one warning (`modules/payments/src/service/accounts.ts:630`, use an optional chain).
- `pnpm turbo run typecheck --force`: exit 0, 18/18.
- `pnpm turbo run test --force --concurrency=2`: exit 0, 16/16. The api package has 117 passing tests and 29 todo; the per-package counts match the builder's report.

### (a) Earlier PoCs, re-run: every attack is now refused
- **First review:** all 9 tests pass inverted. As the builder warned, the P3-9 payments test needed `checkIn.guarantee.externalReference` added. It now shows the guarantee step pending with no card held, then completed once the external reference is recorded.
- **Re-review #2:** I ran `r2-fix-attacks` unchanged. 9 of 11 fail exactly at the line that asserted the defect, so each defect is gone. Of the other two, the cap ±1 test was already a clean test and still passes. R2-H had no assertion, so I rewrote it inverted: all 5 reference types are refused, and Kandu can still read its own status.
- **Payments sweep:** 4/4 pass, so SW-PAY-1 to 4 are refused.
- The builder's other note holds: a stranger's card is still refused on the guarantee path, even for a user with `payments.payment.collect`.

### Top findings
1. **R3-P1-1: a departed guest can still be asked to pay money they no longer owe.** The claimed rule (one payment request per departed folio, equal to its debt) breaks in three places, each proven:
   - **Settling the folio to a company account** never updates the request. The company was invoiced USD 234 and the guest then paid the same USD 234 through the still-open link. No alert was raised.
   - **The "wait while a payment is in flight" exception never resumes when that payment fails.** A reversal during that wait marked the late-charge item "owes nothing" but left a USD 234 link open, with no open item to warn anyone.
   - **A re-issued request cancels the old one only inside Portico.** The old link stays payable at the provider, and nothing in payments ever deactivates a link. The guest paid both emails: USD 585 collected for a USD 351 debt, flagged only as routine.
2. **R3-P1-2: the cardholder's agreement limits are stored but not checked when money moves.** Only the legal entity and property are checked; the purposes, amount limit and named bookings are not, although the payments README says they are.
   - A front-desk agent charged USD 5,000 to another guest's folio, and held USD 9,000, on a card agreed only for "a guarantee of booking A, at most USD 100".
   - Increasing an existing hold skips the check too.
3. **R3-P2-1: the double-collection guard can still be bypassed by changing the purpose label.**
   - A paid USD 300 balance link plus a desk charge of the same USD 300 labelled `incidentals` succeeds with no reason asked and no audit.
   - A `custom` charge on a stay's folio is accepted while a deposit link on its booking is paid. The sweep had asked for the booking and its folios to be treated as one family; this was not done.
4. **R3-P2-2: housekeeping can still see folio balances.** The stored "departed with an open balance: folio 17550 USD" issue appears on the stay record (which is otherwise marked as redacted) and in the issue list.
5. **R3-P2-3: two concurrent opening-deposit imports skip the new "deposits held elsewhere" check.** Kandu and Hiyani, two different hotel companies, imported the same not-yet-migrated booking at the same time. Both were accepted into one account at Kandu, holding 20,000. Run one after the other, the second import is correctly rejected.

The 4 P3s:
- A guest acting for themselves is treated as present for any saved card, not only their own. Nothing creates guest actors yet, so this is latent.
- The lint warning above.
- Finance and payments take their locks in opposite orders. I did not reproduce a deadlock in 12 concurrent rounds.
- The scenario harness completes data-authority changes without the platform's real transition guard. This is setup only.

### (c) The declared open item ("card owned by the payer" on payments' own routes)
I rate it **P2: it does not block merge by itself.** ADR-0015 Amendment 1 names `payments.payment.collect` as the explicit permission for using another card, and payments does check the card's property and hotel company.

That only holds **once R3-P1-2 is fixed**, because the cardholder's agreement is the real control here. Until then, every front-desk agent can charge any guest's saved card at the property, for any amount, onto any folio. That also makes the guarantee path's "stranger's card refused" rule easy to sidestep, since the same agent can simply charge the card through payments.

### (d) Merged-tree changes after identity-plus
I found no weakened tests. The MFA sign-in, the real plan/approve/freeze/complete flow in `makeExternal`, and the removed duplicate data-authority route all check out; main's route keeps the same 404 for a property the organization does not have. The fixture changes either add the card agreements SW-PAY-4 now requires or make assertions stricter.

### Coverage and cleanup
- Patterns: 25 of the 40 applicable patterns were probed (57 in groups A–E: 15 code-read only, 17 not applicable).
- Checklist: 6 items probed, 7 code-read only, 1 not applicable, 1 not probed (spec coverage).
- The scratch copy is removed, and no `review_intstep3*` databases remain.

The report and new PoCs are not committed. The PoCs are `r3-fix-attacks.test.ts.txt` (10 tests; each one that proves a finding passes by asserting the defect, so flip it once fixed) and `r3-inverted-original-pocs.test.ts.txt`. The report covers fixes for each finding, the attack I ran against each fix, and notes for you. The main one: Amendment 1's "a different amount is an explicit capability" mixes staff permission with cardholder consent.

Files are in /home/user/portico/docs/orchestration/reviews:
- review-integration-step-3.md
- integration-step-poc/r3-fix-attacks.test.ts.txt
- integration-step-poc/r3-inverted-original-pocs.test.ts.txt
````

