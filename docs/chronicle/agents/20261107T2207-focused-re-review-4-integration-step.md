# Agent run: Focused re-review #4: integration-step

- Started: 2026-11-07T22:07:57.872Z · last activity: 2026-11-07T22:34:12.035Z
- Turns: 119 · tool uses: 123 · output tokens: 129,686
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

