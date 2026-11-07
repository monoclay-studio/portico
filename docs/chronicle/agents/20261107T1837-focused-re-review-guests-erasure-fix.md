# Agent run: Focused re-review: guests erasure fix

- Started: 2026-11-07T18:37:15.284Z · last activity: 2026-11-07T18:52:45.493Z
- Turns: 80 · tool uses: 83 · output tokens: 88,511
- Type: general-purpose

## Brief (2026-11-07T18:37:15.284Z)

````text
Your launch brief is the "Launch brief (v2)" section of /home/user/portico/docs/quality/playbooks/steward-reviewer.md (playbook v2.1). Follow it in its "Variant: focused re-review (after a fix round)" form. Read CLAUDE.md first. Keep it tight: this is a re-check of one fix.

Run parameters (filled by the orchestrator):

```
MODULE:            guests + packages/db idempotency — FOCUSED RE-REVIEW of fix SW-GUE-1
BRANCH / COMMIT:   fix/guests-erasure-idempotency @ 122f099 or later (record the exact commit)
WORKTREE:          /home/user/wt/guests-fix (read-only for you)
SCRATCH COPY:      /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-guestsfix-copy
                   (git worktree add --detach <copy> fix/guests-erasure-idempotency; merge current main into it, since
                   main now includes identity-plus; remove the copy at the end)
SPEC / README:     docs/orchestration/reviews/review-fix-sweep.md § SW-GUE-1 and fix-sweep-poc/api-zz-review-sweep-guests.test.ts.txt;
                   modules/guests/README.md ("Erasure reach"); packages/db/src/idempotency.ts
FOCUS AREAS:       Builder's claims, verbatim: "(b) runIdempotent takes a replay plan: it stores ids only and rebuilds the
                   response from the current record, using the caller's current permissions … an erased guest's replay
                   answers 410"; "(a) erasure replaces every stored response, from any module, that mentions the
                   person's profile ids, emails or phone numbers (values under 6 characters never match)"; "a replay
                   now waits for any in-progress erasure of that row and then answers 410".
                   (a) Re-run the original PoC inverted.
                   (b) Attack the fix itself:
                       - a replay that now re-reads with the CALLER'S CURRENT permissions: can it leak data the
                         original response didn't include, or skip a check the original command made (replay as a
                         different actor, after a role change, after a merge)?
                       - redaction-net false positives: can one guest's erasure corrupt or 410 another tenant's or
                         another guest's stored responses (shared email, short values, substrings)? Is it
                         tenant-scoped?
                       - do the other modules' idempotent endpoints (reservations, payments, finance, identity) still
                         replay correctly, i.e. are their contracts unchanged?
                       - erasure on legal hold;
                       - concurrency both ways.
                   (c) Exemption audit: list every path where personal data can still survive erasure (the builder
                       lists two residuals) and judge whether each is acceptable or a P1.
PARITY FILE:       none
DB PREFIX:         PORTICO_TEST_DB_PREFIX=review_guestsfix (Postgres at postgres://postgres@127.0.0.1:5432/postgres;
                   drop your databases at the end)
REPORT PATH:       /home/user/portico/docs/orchestration/reviews/review-guests-erasure-fix.md (do not commit); PoCs as
                   docs/orchestration/reviews/fix-sweep-poc/guests-r2-*.ts.txt
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

## Report (2026-11-07T18:52:45.371Z)

````text
**Verdict: merge after fixes.** I reviewed `fix/guests-erasure-idempotency` at `122f099`, merged with `main` at `d9d2e5a` (local merge `48c2694`, no conflicts). One fix is required before merge (R2-P2-1, small and inside guests) plus a README correction. Everything else can be tracked follow-up work.

**Counts:** P0 0 · P1 0 · P2 4 · P3 5. Patterns: 23 of 55 apply (10 probed, 2 applied as sweep steps, 11 code-read), 32 not applicable.

**Gates on the merged copy:** all three exited 0.
- `pnpm lint` passed.
- `pnpm turbo run typecheck --force` passed (18/18 tasks).
- `pnpm turbo run test --force --concurrency=2` passed (16/16 tasks, 1,504 tests).

**The original fix-sweep test, run unchanged, now passes.** No stored response holds the guest's data, and replaying the request returns 410 without the name or date of birth.

**The builder's three claims:**
- **Replay rebuilds from the current record with the caller's current permissions:** holds. A different user gets 409. The same user after losing read access gets 403, not the old data. One exception: the list of possible duplicate profiles is replayed from the stored copy, not re-checked (R2-P3-3).
- **Erasure redacts any module's stored response that mentions the person:** holds, but it hits too much and too little (R2-P2-1 and R2-P2-4).
- **A replay waits for an in-progress erasure, then answers 410:** holds in both orders.

**Top findings:**
1. **R2-P2-1, the required fix: erasure wipes unrelated records' stored responses.** The match uses every contact value, including addresses and phone numbers as typed, as a plain substring of any stored response.
   - Over HTTP, erasing a guest whose address was "Maldives" made a replay of the organization's property creation answer 410, because the time zone "Indian/Maldives" contains it.
   - A 7-digit local phone number wiped an unrelated money response whose amount contained those digits.
   - Two guests sharing a family email: erasing one wiped the other guest's stored responses, including one on legal hold.
   - Someone with erase permission could plant any value as a contact and erase that guest, which turns replays of any response containing that value into 410.
   - Fix: match only profile ids, normalized emails (case-insensitive) and international-format phones, as whole values. Never addresses or numbers as typed, never substrings.
   - Other organizations are never affected.
2. **R2-P2-2: an edit that starts just before an erasure survives it.** This race existed before this branch. The writer checks the profile status without a lock. In my test, an email added in that window stayed on the anonymized profile. The same applies to identity documents, special needs, notes and consents. Fix: every write to a person's data locks the profile row before checking its status.
3. **R2-P2-3: erasure can time out for large customers.** It reads every stored response of the organization for each value. 50,000 rows took 4.4 seconds. The 30-second statement timeout is reached at about 340,000 stored responses in 30 days, and then every erasure fails. Fix: tag stored responses with the person's ids and index the tags.
4. **R2-P2-4: copies outside guests are not erased, and the README cites tests that do not exist.**
   - No module consumes the "profile anonymized" event.
   - Finance keeps the payer name on folios, and payments keeps the card holder name and payer details.
   - Other modules' stored responses that carry only the name survive (the builder's first listed residual).
   - These need tracked owners in finance, payments and reservations, and the README row must say "not reached yet".
5. **P3s:**
   - R2-P3-1: the request hash survives erasure and lets the original user confirm a guess (410 for the right body, 409 for a wrong one).
   - R2-P3-2: a request from another module already in progress when the erasure runs can commit afterwards with the name.
   - R2-P3-3: the stale duplicate list described above.
   - R2-P3-4: contacts removed before the erasure are not searched for.
   - R2-P3-5: reason scrubbing misses two-letter surnames and mangles words that contain a short name.

**What could still survive an erasure:** none of these is a P1 for this branch.
- Acceptable if tracked: the builder's listed residuals (name-only copies in other modules, misspelled names in staff-typed reasons, request hashes), plus in-progress requests from other modules and removed contacts.
- Must become tracked work: the edit race (R2-P2-2) and the copies in other modules (R2-P2-4).

**Other checks:**
- Other modules' replays are unchanged except through the erasure redaction above, and all their suites are green.
- Erasure on legal hold redacts nothing and replays still work.

**Clean-up:** the scratch copy is removed and all `review_guestsfix*` databases are dropped. Nothing is committed and the branch worktree is untouched.

Files are in /home/user/portico/docs/orchestration/reviews:
- review-guests-erasure-fix.md (the report; it also lists the follow-up lines to add to pending-fixes)
- fix-sweep-poc/guests-r2-api-zz-review-guests-r2.test.ts.txt
- fix-sweep-poc/guests-r2-service-zz-review-r2.test.ts.txt
````

