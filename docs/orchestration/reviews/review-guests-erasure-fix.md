# Focused re-review: guests erasure fix SW-GUE-1 (`fix/guests-erasure-idempotency`)

| | |
|---|---|
| **Verdict** | **merge after fixes** (one small required fix, R2-P2-1, plus a README correction; everything else is a tracked follow-up) |
| **Commit reviewed** | `122f099` (branch head), merged with `main` @ `d9d2e5a` (identity-plus included) in a scratch copy, local merge `48c2694`, no conflicts |
| **Playbook** | steward-reviewer v2.1, variant "focused re-review" |
| **Counts** | P0 0 · P1 0 · **P2 4** · P3 5 |
| **Original PoC** | `fix-sweep-poc/api-zz-review-sweep-guests.test.ts.txt`, run unchanged: **passes**. No stored response holds PII, and the replay answers **410 without the name or date of birth** |
| **New PoCs** | `fix-sweep-poc/guests-r2-api-zz-review-guests-r2.test.ts.txt` (HTTP) and `fix-sweep-poc/guests-r2-service-zz-review-r2.test.ts.txt` (service level). A test named "FINDING …" passes while the defect exists |

## 1. Command results (merged copy, `PORTICO_TEST_DB_PREFIX=review_guestsfix`)

| Command | Exit | Result |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | — |
| `pnpm lint` | 0 | biome: 805 files clean; module boundaries OK (10 modules) |
| `pnpm turbo run typecheck --force` | 0 | 18/18 tasks |
| `pnpm turbo run test --force --concurrency=2` | 0 | 16/16 tasks, **1,504 tests passed**. Guests 175, api 69, db 15, reservations 147, payments 113, finance 85, identity 153, platform 62, integration 173, operations 120, inventory 96, rates 128, backoffice 53, ui 87, kernel 25, http 3 |
| Original PoC (unchanged) | 0 | `idempotency rows still holding PII: []`; `replay 410 … no name no DOB` |
| `zz-review-guests-r2` (API, 2 tests) | 0 | inverted PoC holds; R2-P2-1 reproduced over HTTP |
| `zz-review-r2` (service, 12 tests) | 0 | R2-P2-1a/b/c, R2-P2-2 and R2-P3-1/2/3 reproduced; the claims that hold are confirmed |
| Redaction cost benchmark (psql, 50,000 rows, avg 2,955 bytes, 6 mentions) | — | **4,435 ms** for one erasure's `UPDATE` (R2-P2-3) |

The PoC tests were run after the gates, so the gate results do not include them. All test databases were dropped (the
harness drops them; `review_guestsfix_bench` was dropped by hand). The scratch copy was removed.

## 2. The builder's claims, checked

| Claim (verbatim) | Verdict | Evidence |
|---|---|---|
| "(b) runIdempotent takes a replay plan: it stores ids only and rebuilds the response from the current record, using the caller's current permissions … an erased guest's replay answers 410" | **Holds, with one stale part** | Stored body before erasure: `{"ref":{"created":true,"profileId":…,"propertyId":…,"possibleDuplicates":[]},"$replay":1}`. Replay after erasure: 410 `idempotent_response_erased`. A different actor gets 409. The same user after a role downgrade gets **403** (`guests.profile.read`), not the stored data. A replay therefore equals a `GET` of the current record: data added later is shown only when the caller can read it now. **Exception:** `possibleDuplicates` is replayed from the stored ref and is not re-filtered by current permissions (R2-P3-3) |
| "(a) erasure replaces every stored response, from any module, that mentions the person's profile ids, emails or phone numbers (values under 6 characters never match)" | **Holds, but it over-reaches and under-reaches** | Over-reach: the code also uses **address** values and **raw typed** phone values, and matches them as substrings of any JSON. This produces 410s for unrelated records and for other guests (R2-P2-1). Under-reach: name-only, differently cased or differently formatted copies survive, as do in-flight writes (R2-P2-4, R2-P3-2, R2-P3-4). Tenant scope holds: another organization's identical values are untouched (probed) |
| "a replay now waits for any in-progress erasure of that row and then answers 410" | **Holds** | Erasure first, then replay: the replay blocks on `FOR SHARE` and answers 410 (my test, and the builder's db and service race tests). Replay first, then erasure: by code reading, the erasure's `UPDATE` waits for the replay's share lock, and the replay saw pre-erasure state, which is linearizable. The rebuild only reads, so there is no deadlock |

## 3. Findings

| ID | Sev | Where | Problem | Why it matters | Fix (rule, siblings, attack run against the fix) |
|---|---|---|---|---|---|
| **R2-P2-1** | **P2, required before merge** | `modules/guests/src/service/privacy.ts:398-408` (mentions = **every** contact kind's raw `value` **and** `normalized`); `packages/db/src/idempotency.ts:171,180` (`position(m in response_body::text)`, a substring match on any part of the JSON); README `:228` says "emails or phone numbers" | **The redaction net matches free text as substrings, so one erasure 410s unrelated records and other people's records.** Probed: (a) **over HTTP**, erasing a guest whose address contact is `Maldives` made the replay of the tenant's **`POST /v1/properties`** answer 410, because `"Indian/Maldives"` contains it. (b) A 7-digit Maldives local number typed as `7771234` redacted an unrelated money response containing `17771234`. (c) Two guests share a family email. Erasing one 410s the **other** guest's stored responses, including a guest on **legal hold**. The 410 text says the response "referred to a person whose data has since been erased", which is false for these records | Since this branch, erasure breaks other modules' replay contract (CLAUDE.md §4.7). A timed-out payment, posting or property call can no longer learn its result, and the 410 carries no id to look up. AP-47: a user with `guests.privacy.erase` can create a dummy guest whose "address" is any value of 6 or more characters (a payment id, for example), erase it, and so deny replays of every stored response containing that value | **Rule:** an erasure mention must *identify the subject*, not merely occur near them. It must be an identifier exact to the person, matched as a **whole JSON string value**: profile ids (survivor and merged-in), normalized emails (compared case-insensitively) and E.164 phones. It is never free text (addresses, raw typed numbers, names, notes), and never a substring. **Implementation:** build mentions from `id`s plus `normalized` values of kind `email`/`phone`/`whatsapp` only. Match with `position(to_jsonb(m)::text in …)`, which is quoted and escaped, so `+9607771234` no longer hits `+96077712345`. Lower-case both sides for emails. Correct README `:228`. **Siblings:** `eraseProfile` is the only caller today. The future R19 retention anonymization must use the same mention builder. Document on `redactIdempotencyResponses` that mentions must be exact identifiers. **Attacks run against the fix:** a shared family email still matches the other guest's response. That is acceptable, because the response does contain the erased person's email; say so in the README. A value of 6 or more characters planted as an *email* contact must be a valid email to normalize, and then matches only identical JSON strings, so the AP-47 griefing reduces to "responses that contain that exact email". **Tests:** the three R2-P2-1 PoCs inverted (property replay 201; amount response 201; the held guest's response kept) |
| **R2-P2-2** | P2 (AP-56; existed before this branch, and in the focus area) | `modules/guests/src/service/internal.ts:205-224` (`requireWritableProfile` reads status without a lock); `profiles.ts:454-465` (`addContactPoint`: check → insert → `bumpVersion`); `privacy.ts:371-375` (erasure locks `FOR UPDATE` only for itself) | **A write that passed its checks before the erasure commits after it, and its data survives.** Probed with a test-only gate in the platform port. `addContactPoint` read the profile (active). Then the erasure ran and committed. Then the writer resumed. Result: `writer committed: anonymized`, `contacts after erasure: [late.contact@guest.example]` | GUE-I06 and the README's "every place" claim fail under concurrency. The same shape applies to documents (passport data), special needs (health data), notes, preferences, alerts and consents. The window is short at the desk. It is longer for automated writers (`resolveProfile` from reservations, mirror or import upserts) | **Rule:** every write to a person's data takes the profile row lock (`FOR NO KEY UPDATE` or `FOR SHARE`) **before** it reads the status it decides on, and re-reads the status under the lock. The erasure's `FOR UPDATE` then serializes them, and a writer that arrives later is refused with `profile_anonymized`. **Siblings:** every path through `requireWritableProfile`: contact add, verify and remove; preferences; alerts; notes and revisions; relationships; consents; documents; special needs; legal hold (a hold set racing an erasure lands on an anonymized profile); `PATCH` profile. Also the paths that do not use it: `resolveProfile` (reservations port), mirror/import upserts, `recordStayHistory`, company contacts, merge/unmerge, and the `guests.scanDuplicates` job (it must skip `anonymized`). **Attack run against the fix:** the same gated test for one writer per family, in both orders. A writer that locked first makes the erasure wait and is then erased. An erasure that locked first refuses the writer |
| **R2-P2-3** | P2 (AP-54: the fix made "erasure completes" depend on the volume of idempotency data) | `packages/db/src/idempotency.ts:173-182` (unindexed `position()` over every stored response of the tenant, inside the erasure transaction); `packages/db/src/database.ts:40` (`statement_timeout` 30 s) | One erasure scans every stored response of the organization for every mention. **50,000 rows (≈3 KB) with 6 mentions took 4.4 s.** The 30 s statement timeout is reached at about 340,000 stored responses in 30 days, for example a resort group with POS and channel traffic. Beyond that, **every erasure fails** and holds the profile-family locks until the timeout | GUE-R18 is a MUST. It becomes impossible for the largest customers, and the failure surfaces only in production | **Rule:** redaction finds its rows by an index on subject references, never by scanning bodies. **Implementation:** store `subject_refs text[]` on `core.idempotency_keys` (GIN index), filled at write time (`ReplayPlan.subjects(body)`; for raw-body modules, an optional `subjects` callback). Redact with `subject_refs && $ids`. As an interim step, add a `pg_trgm` GIN index on `(response_body::text)`. **Attack run against the fix:** a row written by a module that declares no subjects is not found. So keep the scan as a **batched background sweep** (outbox consumer of `guests.profile.anonymized`) for un-tagged rows. Replays of those rows stay safe in the meantime only if the module adopts replay plans (R2-P2-4) |
| **R2-P2-4** | P2 (exemption audit; AP-50 on the README) | README `:235` row "Other modules' copies … evidence: consumers' own tests (outside this module)"; `apps/api/src/composition.ts:319-330` (finance names folios from guests); `modules/finance/migrations/0001_finance.sql:90` (`payer_name`); `modules/payments/migrations/0001_payments.sql:71` (`holder_name`) | **Personal data outside guests is not reached, and the README cites tests that do not exist.** No module consumes `guests.profile.anonymized` (grep: 0 consumers). `finance.folios.payer_name` is copied from the guest's display name when a folio opens. `payments.payment_methods.holder_name` and the payment-request `payer` (name, email) keep the name. Other modules' **stored responses** that carry the name without id, email or phone survive (builder residual 1; probed: `holderName` for an `owner: booking` card; a mixed-case email; a phone written with spaces). | The hotel is told "completed" while copies remain in finance and payments, and replays still return them for up to 30 days | **Rule:** every module that copies a guest's personal data either consumes `guests.profile.anonymized` (pseudonymize, or keep with a recorded fiscal-retention reason) **or** stores only the profile id and resolves the name on read. Every endpoint whose response embeds a person adopts a `ReplayPlan`. **Now:** change the README row to "**not reached yet**: no consumer exists", and list the copies (finance open-folio payer name; payments holder name and payer; reservations booker and occupants once guests is bound). **Pending-fixes lines with owners:** finance (payer name for open folios), payments (holder name and payer on erasure; replay plans for payment method and payment request), reservations (replay plans; consumer once the guests port is bound). **Attack run against the fix:** a consumer that is down when the event fires must catch up (outbox redelivery, an idempotent consumer, AP-30) |
| R2-P3-1 | P3 | `idempotency.ts:112-118` (hash check before the erased check); `:176` (redaction keeps `request_hash`) | `request_hash`, a SHA-256 of a body that contains name, DOB and email, survives erasure. For the original actor it acts as an oracle: the right guess gets **410** and a wrong guess gets **409** (probed) | It is a pseudonymous copy of personal data. Exposure is limited: same actor only, 30 days | When redacting, also set `request_hash` to a constant, and answer 410 to any body once `$erased` is set. Then the 409/410 oracle disappears |
| R2-P3-2 | P3 | `idempotency.ts:173-182` (redaction sees committed rows only) | Another module's request that read the guest **before** the erasure and commits **after** it stores the name. The replay returns it (probed: `bookerName: "Quilla Erasemeplease"`) | The window is narrow and ends at the 30-day expiry | Closed by R2-P2-4's replay plans (the rebuild gives 410), or by R2-P2-2's lock if guests-port reads that feed a write take `FOR SHARE` |
| R2-P3-3 | P3 | `modules/guests/src/replay.ts:34-44` | `possibleDuplicates` (other profiles' ids, scores and reason texts) is replayed from the stored ref. After losing `readShared`, the same user still receives a duplicate at another property (probed: `[true] → [true]`) | A small deviation from "current permissions". Ids and reason codes only | On rebuild, filter `possibleDuplicates` with `visibilityOf(access, ids)` |
| R2-P3-4 | P3 | `privacy.ts:398-402` (mentions come from current `contact_points` only) | A contact removed **before** the erasure is not a mention, so other modules' responses that carry the old email or phone survive | This is an under-reach of the safety net | Removal is a sibling of addition (AP-45). Either keep the normalized values of removed contacts in a redactable table until the stored responses expire, or rely on R2-P2-3's subject tags |
| R2-P3-5 | P3 | `modules/guests/src/service/internal.ts:364-391` (`scrubReason`) | The 3-character minimum and no word boundaries cause two problems. Latin two-letter surnames (Li, Wu, Ng, Le, Do) are never scrubbed. A short name is also scrubbed inside other words: a guest named "Ann" turns "Annual leave" into "[guest]ual leave" in the append-only audit reason. This is from code reading | It adds to residual FR-8 and corrupts audit wording | Use Unicode word boundaries (`(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])`), and allow 2-character tokens when bounded |

## 4. Exemption audit: where personal data can still survive an erasure

| # | Path | Builder lists it? | Judgement |
|---|---|---|---|
| 1 | Other modules' stored responses with the name only (no id, email or phone) | yes (residual 1) | Acceptable for this branch **if tracked**. Owners in R2-P2-4 |
| 2 | Misspelled names or other people's names in staff-typed reasons (append-only audit) | yes (FR-8) | Acceptable, with a mitigation in place. Extend it per R2-P3-5 |
| 3 | `request_hash` until expiry | yes | Acceptable short term. Cheap fix in R2-P3-1 |
| 4 | Concurrent guests writes that committed after the erasure | **no** | **Not acceptable long term:** R2-P2-2 |
| 5 | Other modules' own tables (finance folio payer name, payments holder name and payer); no consumer of the event | **no** (the README implies consumers exist) | **R2-P2-4**. Must be tracked. Not a P1 for *this* branch, because guests cannot change those modules |
| 6 | In-flight other-module requests that commit after the erasure | no | Acceptable (R2-P3-2) |
| 7 | Contacts removed before the erasure, still in other modules' responses | no | Acceptable (R2-P3-4) |
| 8 | Merged-in profiles | — | **Clean**: the family ids are mentions, and they are anonymized |
| 9 | Idempotency `key` and `scope` | — | Acceptable: the scope holds pseudonymous ids. Client keys are UUIDs in our clients. Document "never put personal data in an Idempotency-Key" |
| 10 | Backups / PITR; HTTP caches | listed | Acceptable (infra policy; `Cache-Control: private, no-store` is set) |

No residual is a P1 for this branch. Items 4 and 5 are the ones that must become tracked work.

## 5. Attacks on the fix (pattern sweep steps 2–6 against the fix commits)

- **Replay with current permissions:** probed. A different actor gets 409. After a role downgrade the replay answers 403. After a merge it equals `GET` by code reading (`getProfile` follows the merge chain and checks visibility). The replay does not re-run the command's write checks (data authority, create permission), which is by design because a replay is a read. The only stale part is R2-P3-3.
- **Reverse order (AP-08 / step 2):** erasure then replay gives 410 (probed). Replay then erasure is linearizable (code reading). Writer then erasure: R2-P2-2. Erasure then writer: refused (`profile_anonymized`). In-flight request from another module: R2-P3-2.
- **Legal hold:** probed. An erasure on hold redacts nothing, and replays still return the current record. Erasing *another* guest who shares an email 410s the held guest's stored responses (R2-P2-1c). Redaction runs after the hold check and inside the same transaction, so a failed erasure rolls back the redaction (AP-46 clean).
- **Tenant scope:** probed clean. The update is scoped by `tenant_id` and RLS (`core.enable_tenant_isolation('core.idempotency_keys')`).
- **Other modules' contracts:** by code reading, the non-plan path is unchanged except for `FOR SHARE` and two marker checks. `$replay` with no plan fails closed with 409 (AP-35 clean). Every module's replay tests are green on the merged copy. The only change in behaviour comes through redaction (R2-P2-1).
- **Sibling paths (AP-45):** erasure entry points: `POST /v1/guests/privacy-requests` with kind `erasure` → `eraseProfile` (the only one; there is no retention anonymization job yet). Stores of personal data: 16 guests `idem()` routes, all with replay plans except consents. The consent route stores ids, enums and a timestamp (the `legalBasis` enum), which is clean. Other modules: R2-P2-4.
- **Privilege equivalence (AP-09):** `guests.privacy.erase` now also reaches "deny replay of any stored response in the tenant that contains a chosen value" (R2-P2-1). That is a disruption capability, not administrator power.
- **Load-bearing (AP-54):** the fix newly relies on the following. (1) The 30-day purge: `CORE_JOBS` is wired in `composition.ts:603`, clean. (2) Actor binding: clean. Rows with a null `actor_key` bypass it, but none exist after migration 0003. (3) Scan cost against `statement_timeout`: **R2-P2-3**, re-rated to P2. (4) `getProfile` visibility: no open finding. (5) `scrubReason`: FR-8 plus R2-P3-5.

## 6. Coverage declaration

| Item | Status |
|---|---|
| 1 Tenant isolation | probed: clean (redaction is tenant-scoped; RLS on `core.idempotency_keys`) |
| 2 Authorization | probed: replay re-checks read permission (403 after downgrade); finding R2-P3-3 |
| 3 Money & finance | probed: finding R2-P2-1b (money replay hit by a false positive); no ledger effect |
| 4 Idempotency & concurrency | probed: findings R2-P2-1, R2-P2-2, R2-P3-2; the FOR SHARE claim holds |
| 5 Events & audit | code-read only: erasure audit and event unchanged; `scrubReason` (R2-P3-5); no event consumers (R2-P2-4) |
| 6 Contracts | probed: non-plan replay unchanged; contract change only through redaction (R2-P2-1); guests replay returns current state (documented contract change) |
| 7 Data authority & env safety | code-read only: no new external effect; replay is a read |
| 8 Errors & UX contract | code-read: the 410 message is untrue for false positives (R2-P2-1); 409 `idempotent_replay_unavailable` explains recovery |
| 9 Spec coverage | GUE-R18 / GUE-I06: met for guests' own stores; gaps under concurrency (R2-P2-2), at scale (R2-P2-3) and outside guests (R2-P2-4) |
| 10 Scenario claims | not applicable (no scenario claims changed) |
| 11 Honest readiness | probed: README `:228` understates the matched values; `:235` cites non-existent consumer tests (R2-P2-1, R2-P2-4); R18 stays R3 |
| 12 Code quality | code-read: clean (no `any`, typed markers); lint and typecheck green |
| 13 One-product experience | not applicable (no record-contract change) |
| 14 Parity gate | not applicable (PARITY FILE: none) |
| 15 Cross-module coherence | probed: `ReplayPlan` is a shared mechanism that other modules have not adopted yet (R2-P2-4) |
| AP-01, AP-03, AP-04, AP-05, AP-06, AP-07, AP-10, AP-11, AP-12, AP-13, AP-14, AP-16, AP-19, AP-53 | not applicable (focused re-review: the fix adds no endpoint, credential, external call or scope parameter) |
| AP-02 | probed: clean (another organization's identical values untouched) |
| AP-08 | probed: both orders (section 5); finding R2-P2-2 |
| AP-09 | code-read: `guests.privacy.erase` gains replay-denial reach (R2-P2-1); not admin-equivalent |
| AP-15 | probed: actor-bound replay (409); request hash oracle R2-P3-1 |
| AP-17 | probed: original PoC inverted, clean; residuals R2-P2-2, R2-P2-4, R2-P3-1/2/4 |
| AP-18 | probed: finding R2-P3-3 (stale `possibleDuplicates`) |
| AP-20, AP-22…AP-25, AP-27, AP-28 | not applicable (no money arithmetic in the diff) |
| AP-21 | code-read: a 410 replay never re-executes; business keys still prevent duplicates |
| AP-26 | code-read: the 410 hides the outcome of a successful unrelated request (R2-P2-1) |
| AP-29 | not applicable |
| AP-30, AP-31, AP-32, AP-43 | not applicable (no event consumer added); noted for R2-P2-4's future consumers |
| AP-33, AP-34 | not applicable (no offline or resume path) |
| AP-35 | probed by code reading: unknown `$replay` without a plan fails closed (409) |
| AP-36 | probed: finding R2-P2-2 (status read before the lock) |
| AP-37 | not applicable (no external effect) |
| AP-38 | code-read: replay skips write-time authority checks by design (read only) |
| AP-39 | code-read: clean (insert on conflict do nothing; FOR SHARE re-read) |
| AP-56 | probed: **R2-P2-2** |
| AP-40, AP-41 | code-read: clean (the service-level PoCs use the real platform module) |
| AP-42 | code-read: `122f099` ties the provenance subset to the kernel type (FR-9), clean |
| AP-44 | not applicable |
| AP-45 | applied: sibling lists in R2-P2-1, R2-P2-2 and R2-P3-4 |
| AP-46 | code-read: clean (redaction rolls back with a failed erasure) |
| AP-47 | probed: R2-P2-1 (planted value → replay denial) |
| AP-48 | not applicable |
| AP-54 | applied: R2-P2-3 re-rated |
| AP-50 | probed: README `:235` evidence column (R2-P2-4) |
| AP-51 | not applicable (real Postgres and real modules) |
| AP-52 | probed: gates run on the merged copy with `--force`; exit codes captured (0/0/0) |
| AP-55 | code-read: the builder's race tests assert both the wait and the 410; the API sibling test asserts PII absence per route |

Patterns: 23 of the 55 IDs apply. Of those, 10 were probed, 2 were applied as sweep steps (AP-45, AP-54) and 11 were code-read. The other 32 are not applicable.

## 7. Notes for the orchestrator

- Merge condition: R2-P2-1, which covers the mention builder, exact JSON-string matching, the README correction and the three PoCs inverted. Also correct the README `:235` row (R2-P2-4).
- Proposed `pending-fixes.md` lines:
  - guests, next round: R2-P2-2, writer lock order across all sibling writers.
  - foundation (`packages/db`): R2-P2-3, subject tags with a GIN index plus a batched sweep; R2-P3-1.
  - finance: open-folio payer name on erasure.
  - payments: holder name and payer on erasure; replay plans for payment method and payment request.
  - reservations: replay plans; consumer of `guests.profile.anonymized` once the guests port is bound.
- Pattern library candidate: "a safety net that matches by substring" (precision attack: does the net hit records that only contain the value by coincidence?).
