# Agent run: Steward review: guests module

- Started: 2026-11-07T08:17:03.671Z · last activity: 2026-11-07T11:13:45.712Z
- Turns: 99 · tool uses: 102 · output tokens: 80,550
- Type: general-purpose

## Brief (2026-11-07T08:17:03.671Z)

````text
You are Portico's architecture steward. Read and follow the review brief at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/steward-review.md exactly.
Branch under review: `feat/guests-core` in worktree /home/user/wt/guests — module `guests` (spec: /home/user/portico/docs/specs/guests.md on main). The author's README is modules/guests/README.md and FOUNDATION_REQUESTS.md lists requested foundation changes — assess each foundation request too (agree/disagree, proposed fix). There is no parity file for guests yet (being produced in parallel at /home/user/wt/parity-ops/docs/parity/guests.md — use it if present; otherwise skip the parity gate but list capabilities you know competitors such as OPERA Cloud profiles, Shiji Daylight cross-property profiles, Mews guest profiles offer that are missing).
Use PORTICO_TEST_DB_PREFIX=review_guests. Write your report to /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-guests.md.
````

## Follow-up message (2026-11-07T11:13:07.329Z)

````text
The coordinator sent a message while you were working:
Orchestrator: the usage limit has reset. Continue the guests review exactly where you stopped and finish the report as originally specified. Postgres was restarted and is up.

Address this before completing your current task.
````

## Report (2026-11-07T11:13:45.576Z)

````text
**Verdict: do not merge yet.** I found 2 P0, 6 P1, 13 P2 and 10 P3 issues. Most of the work is strong: the reversible merge, encryption and connected mode are well done, and the S15 test is excellent. But I reproduced two P0 privacy defects with my own probe tests against the branch code. All fixes stay inside the module, so one fix round should be enough. The full report is at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-guests.md.

**Commands** (in /home/user/wt/guests, head 17b5fe0, PORTICO_TEST_DB_PREFIX=review_guests):
- `pnpm install`, `pnpm lint` and `pnpm typecheck` (also re-run with `--force`) pass.
- `pnpm --filter @portico/guests test`: 157/157 tests pass, but the first run exited 1. Vitest reported an unhandled "terminating connection due to administrator command" error (57P01) from `test/profiles.test.ts`. Four later runs were clean, including one after the Postgres restart, so the suite is flaky.
- `pnpm --filter @portico/api test` passes (17 tests).
- The branch does not merge cleanly into main: `apps/api/src/composition.ts` conflicts with main's new `jobs` field.
- I skipped the parity gate as instructed: `docs/parity/guests.md` does not exist anywhere yet.

**Top 5 findings:**
1. **P0, erasure leaves personal data behind** (`privacy.ts:294-406`). Duplicate candidates keep the plaintext email (`exact_keys`), merge records keep names and date of birth (`decisions`), and consent history keeps an IP address (`consent_events.evidence`). This breaks GUE-I06; the test only checks 5 of the 19 tables.
2. **P0, profile resolution ignores the sharing setting and the guest's objection** (`profiles.ts:237-298`). Sharing was off and the guest had objected, yet resolving the same email at property B reused A's profile and gave B the full view: date of birth and A's phone. Staff entry at B also returned the hidden profile's id as a suggestion. This breaks GUE-I05 and GUE-R16.
3. **P1, staff at B can change A's private items they cannot see** (`profiles.ts:567-738`). They can update and delete A's property-scoped preference and resolve A's property-private alert.
4. **P1, the data-subject export by a user scoped to A reveals property B's passport number, medical detail and private notes.** The cause is unscoped permission checks in `privacy.ts` `buildExport`. Separately, profile `links` expose A's stay and booking ids to B when sharing is off.
5. **P1, the contract with the reservations worktree does not line up, and `domain-map.md` was not updated.**
   - Reservations' `ProfileInput` uses firstName/lastName/email/phone and has no `propertyId`.
   - Its unmerge handler reads `mergedId` and `restored[]`, which guests never sends, so it does nothing.
   - It never calls `recordReferenceRepoints`, so unmerge would restore no reservation references. S15 and GUE-I03 hold only against the test's fake consumer.

Other P1s: several spec MUSTs are only partly built (R14, R15, R19, R20; the README is honest about these). The README also claims R16 and R18 done and GUE-I05/I06 proven, which the probes contradict.

Notable P2s:
- `snapshotProfile` is on the public service with no permission check; it returned full PII to a user with no grants.
- Duplicate lookup is capped at 50 rows with no ordering, so an exact email match can be missed for common names and a duplicate gets created.
- Recording the same re-pointed reference twice creates two rows.
- Alerts outside their active dates still show as critical.
- The document retention purge ignores legal hold.
- A hard-coded dev encryption key is used whenever NODE_ENV isn't "production".
- Guests, rates and reservations each model commission differently. Guests keeps one AR account link per company, while finance keeps one per legal entity.

**Foundation requests:**
- FR-1 (idempotency records hold PII): agree; partly done on main (30-day expiry). Still needed: replay must be tied to the caller (today any user in the organization can replay a key and get the stored profile), plus an option to store no body.
- FR-2 (query strings in logs): done on main.
- FR-3 (KMS cipher and separate blind-index key): agree. Also unify the three env var names used by identity, guests and integration, and add key rotation.
- FR-4 (permission-free property lookup): partly covered by `getPropertyFacts` in identity-plus. A permission-free list of property ids is still needed.
- FR-5 (role templates): agree with changes. Add `guests.profile.readShared` only after P0-2 is fixed, and replace `general_manager: guests.*` with an explicit list, since the wildcard gives every GM erase, document and health-data access.
- FR-6 (record history permission): agree.
- FR-7 (scheduled jobs): the framework is now on main; guests must register its jobs when it rebases.

The probe tests are in /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/probe/. I did not modify the worktree.
````

