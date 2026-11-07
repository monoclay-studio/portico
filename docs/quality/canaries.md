# Canaries: seeded defects that test the testers

A **canary** is a known defect planted in a disposable copy. We then check whether a checker finds it. Canaries measure
**recall directly**, without waiting for real escapes (`README.md` step 5). The catalogue is organized by the pattern
each canary exercises (`patterns.md`).

> **Round 0: no canary has been run.** Usage is constrained. This file defines the catalogue, the planting procedure,
> the scoring rule and the schedule. Results are appended to § 6 from round 1 onward.

---

## 1. Safety rules (non-negotiable)

1. **Never on `main`, never on a named branch, and never pushed.**
   - `tools/checkpoint.sh` commits work in progress in **every worktree that has a branch**, then pushes **every local
     branch** (`refs/heads/`).
   - A canary on a named branch, or as an uncommitted patch in the `ux/lab` worktree, would therefore be committed and
     pushed at the next usage checkpoint.
   - So canaries live only in **detached** worktrees, which `checkpoint.sh` skips because they have no branch name.
2. **Location:** a detached worktree in the session scratchpad: `<scratchpad>/canary-<run-id>/`. Remove it with
   `git worktree remove --force` when the run is scored, and run `git worktree prune`.
3. **Databases:** `PORTICO_TEST_DB_PREFIX=canary_<run-id>`. A canary lab uses database `portico_canary_<run-id>` and
   its own ports: API 4400–4499, UI 5400–5499. Never use the UX lab's 4300 or 5380. Drop the databases after scoring:
   `select datname from pg_database where datname like 'canary_%'` must return nothing.
4. **Answer key outside the repository.** The key is the exact file, line, diff, planted severity and pattern. It is
   written at plant time to `<scratchpad>/canary-keys/<run-id>.md`, never under `/home/user/portico` or any worktree.
   Reviewers read the repository, so the key reaches `canaries.md` § 6 only **after** scoring.
5. **Blind but honest.**
   - Checker playbooks carry a standing notice that any run may be a calibration run on a copy with seeded defects.
     The checker is never told *which* run, or what was planted.
   - Commit messages in the canary copy are neutral ("review snapshot of `<module>` at `<sha>`"). They never describe
     planted behaviour as real work, and never claim it was reviewed or tested.
6. **Never forwarded as real.**
   - Findings from a canary run go only to the quality steward.
   - A finding that is *not* planted may still be real, because the copy is real code. Re-check it on `main` before
     forwarding it through the normal pending-fixes flow, and mark its origin as "found during canary `<run-id>`".
7. **The black-box tester never sees source.** L4 traps are planted in the UI code of a separate canary lab. The
   tester only receives its URL, as in any round. No trap text may appear in the tester's playbook.
8. **No external effects.** Canary copies run only in demo, trial or sandbox environments. Planted code must not touch
   `assertExternalEffectAllowed` or any provider adapter, so that a planted bug cannot reach a real provider.
9. **Usage gate.** Skip every canary run while seven-day usage is at or above 80 % (`README.md` § Guardrails). Run at
   most one canary per checker per week while usage is constrained.

## 2. How to plant

### 2.1 L2: a review snapshot with seeded bugs

1. Choose a module **already on `main`**, so that `<module>` code exists. Let `<pre>` be the commit before that module's
   merge. Let `<head>` be the current `main` commit.
2. Create the copy:

   ```
   git -C /home/user/portico worktree add --detach <scratchpad>/canary-<run-id> <pre>
   cd <scratchpad>/canary-<run-id>
   git checkout <head> -- .
   git -c commit.gpgsign=false commit -qm "review snapshot of <module> at <head>"
   ```

   The diff against `<pre>` now looks like a feature branch.
3. Apply 3–5 canaries from § 3, in one module, and **re-run the module's own tests**. A canary that makes an existing
   test fail is not a canary of the reviewer. It is already caught by L1: record it as an L1 detection and replace it.
4. Commit as "review snapshot of `<module>` (wip)". Write the answer key (§ 1.4).
5. Launch the steward reviewer from the latest `playbooks/steward-reviewer.md` with the copy as the "worktree under
   review". Use the normal focus template, with no added hints.

### 2.2 L4: a lab with seeded UX traps

1. Detached worktree: `git worktree add --detach <scratchpad>/canary-lab-<run-id> <main-or-ux/lab sha>`. Merge any
   unmerged UI branch with `git merge --no-edit <branch>` on the detached HEAD.
2. Apply 4–6 traps from § 3.3 in `apps/backoffice` only.
3. Install, migrate to `portico_canary_<run-id>`, seed (`pnpm --filter @portico/backoffice seed:dev`, or
   `pnpm seed:demo`), and start on ports 44xx and 54xx.
4. Run a **mini round**: 2–3 personas and the tasks the traps sit on, given to the black-box tester exactly as in a
   normal round, with the canary lab's URL.
5. Score the tester first. Then hand the findings to the refiner, which is scored on whether it flags planted
   evidence traps (`C-L4-11`).

### 2.3 Scripted canaries (L1, L3, L5): no agent needed

Run them as scripts in a detached copy. Each one plants a defect, runs the gate or check, and records pass or fail.
They cost CPU minutes, not tokens.

## 3. Catalogue

Severity is the steward-scale severity of the planted defect. **Expected detection** is the probe that should find it
(`patterns.md`).

### 3.1 L1: gate self-tests (scripted)

| ID | Pattern | Plant (in a detached copy) | Pass condition |
|---|---|---|---|
| C-L1-01 | AP-52 stale cache (E-008, E-009, E-038) | Warm the cache with `pnpm typecheck`. Then change one exported signature in each of `packages/kernel/src`, `modules/<m>/src` and **`apps/api/src`** (for example the `compose` options used by `apps/worker`). Run `pnpm typecheck` **without** `--force` | It fails for each of the three edits. Today the `apps/api` edit is expected to **pass wrongly** (E-038): that is the known failure this canary tracks |
| C-L1-02 | AP-06 / AP-42 contract drift | (a) Add `requirePermission(tx,'<module>.planted.key')` without registering it. (b) Add a value to a kernel enum that a module copies as a `z.enum` literal | (a) The permission-catalogue test fails. (b) Typecheck, or the proposed duplicated-enum lint, fails. (b) passing silently is the known gap (RC-2) |
| C-L1-03 | AP-52 tool false positives and negatives (E-012, E-013, E-010) | (a) A `${x.operations.length}` interpolation inside a `sql` template. (b) A real cross-schema reference `operations.units` from another module. (c) `requirePermission(` inside a comment. (d) A lint error, then `tools/commit-checked.sh` | (a) Passes. (b) Fails. (c) Not counted. (d) "NOT COMMITTED" |

### 3.2 L2: seeded bugs for the steward reviewer

| ID | Pattern | Severity | Plant (behaviour; exact place in the key) | Expected detection |
|---|---|---|---|---|
| C-L2-01 | AP-01 cross-property reference | P0 | Remove the check that the referenced folio, booking or item belongs to the caller's property in one provider or mutation path | The A/B probe posts onto B |
| C-L2-02 | AP-02 tenant isolation | P0 | A new tenant-owned table in a migration without `core.enable_tenant_isolation` | Per-table isolation sweep; reading `migrations/` |
| C-L2-03 | AP-03 claimable external id | P0 | Change a global unique constraint on an external identifier to `(tenant_id, …)` | Register the same id in tenant 2 |
| C-L2-04 | AP-20 / AP-36 lock after read | P0 | Move the row lock below the "remaining amount" read in a correction or refund path | Concurrent corrections with different keys |
| C-L2-05 | AP-21 / AP-30 duplicate or lost effect | P0 | (a) Drop the unique constraint on a derived business key. (b) Commit a webhook dedupe marker in its own transaction before processing | Concurrent same-key retries; injecting a failure and redelivering |
| C-L2-06 | AP-22 terms not honoured | P0 | Recompute one hotel fee from current configuration at posting | Changing the configuration after booking, then posting |
| C-L2-07 | AP-14 SSRF | P0 | Remove IPv4-mapped IPv6 handling from the address policy | The bypass list |
| C-L2-08 | AP-08 pre-hijacking | P0 | Allow an org to set the initial password of a **new** global identity | Reversing the order of events |
| C-L2-09 | AP-31 out-of-order events | P1 | Remove the `isNewerThan` guard in one consumer | Reverse-order delivery |
| C-L2-10 | AP-17 erasure residue | P0 | Stop clearing one personal-data column on erasure | The `information_schema`-driven value scan |
| C-L2-11 | AP-16 cache leak (UI) | P0 | Remove `userId` from the query keys, or skip clearing the cache on a 401 | The shared-desk handover probe |
| C-L2-12 | AP-12 racy limit | P1 | Replace the atomic attempt reservation with read-then-update | N concurrent wrong codes |
| C-L2-13 | AP-45 sibling path | P1 | Remove a guard from one of two entry points that make the same state change | The sibling grep |
| C-L2-14 | AP-38 data-authority bypass | P1 | Remove `assertWritable` from one write path | Forward and read-only mode probe |
| C-L2-15 | AP-43 event schema drift | P1 | Rename a field in a producer's event payload, without changing the consumer or its schema test | Parsing producer events with the consumer's schema |

Combine them into **sets** so that each run covers one theme:

| Set | Canaries | Suggested module copy |
|---|---|---|
| A: isolation and money | C-L2-01, C-L2-04, C-L2-05, C-L2-06 | payments or finance |
| B: identity and abuse | C-L2-08, C-L2-12, C-L2-13, C-L2-02 | identity |
| C: events and authority | C-L2-09, C-L2-14, C-L2-15, C-L2-05b | operations or reservations |
| D: outbound and privacy | C-L2-07, C-L2-10, C-L2-03 | integration or guests |
| E: UI | C-L2-11, plus two UX-trap probes from § 3.3 planted in code | backoffice |

### 3.3 L4: lab traps for the black-box tester (and the refiner)

| ID | Trap | Plant (in `apps/backoffice`, canary lab only) | Detected when the finding… |
|---|---|---|---|
| C-L4-01 | UX-01 dead end | A visible primary button on a common task that does nothing | …names the button and says nothing happened |
| C-L4-02 | UX-02 total does not match | One KPI tile counts 1 more than its destination list | …reports the mismatch with both numbers |
| C-L4-03 | UX-11 / UX-05 hidden failure | A save that fails on the server but shows a success toast | …reports success with no change (re-read) |
| C-L4-04 | UX-07 off-screen control | The dialog's Close button is pushed off-screen at 1024 px only | …reports it on the tablet persona |
| C-L4-05 | UX-04 raw technical text | One validation error renders the raw error object | …quotes the text as developer language |
| C-L4-06 | UX-09 permission-dishonest UI | A "Delete" action shown to a read-only role, then refused | …reports a tempting forbidden action |
| C-L4-07 | UX-16 truncated critical text | The blocker text is truncated at every width, with the full text only on hover | …reports that the key fact cannot be read |
| C-L4-08 | UX-03 contradictory status | A "Paid" chip next to a positive balance on one record | …reports the contradiction |
| C-L4-09 | UX-15 shared-desk handover | The previous user's name stays in the header after another user signs in on the tab | …reports another person's identity or data |
| C-L4-10 | UX-06 focus | A dialog that does not take focus | …reports it in the keyboard pass |
| C-L4-11 | Refiner evidence check (E-034) | In the findings handed to the refiner, one cited screenshot is swapped for one showing a different state | The refiner flags the evidence as invalid (UR2-1) |

### 3.4 L3 and L5 (scripted or cheap)

| ID | Loop | Plant | Pass condition |
|---|---|---|---|
| C-L3-01 | L3 | In a copy, post one ledger line to a control account without its sub-ledger mirror; separately, consume one inventory night without a reservation | The scenario global-consistency checks (`docs/scenarios/README.md`) fail |
| C-L3-02 | L3 | Bind one port in a scenario's composition to a fake | The binding manifest (ST2-1) flags the scenario as not real-path |
| C-L5-01 | L5 | In a copy of a parity file, mark 3 rows `tested`, citing tests that exist but do not assert the row | The parity re-check (PR2-1) downgrades all 3 |
| C-L5-02 | L5 | Remove 3 edge-case rows that belong to applicable AP classes | The PR2-2 sweep re-adds them |

## 4. Scoring

- **Detection credit for each planted defect:**
  - **1:** a finding names the planted location (same function, or file:line ±10 lines) **or** describes the planted
    behaviour with a reproducing probe; **and** its severity is within one level of the key.
  - **0.5:** the behaviour is described but at the wrong location, without reproduction, or two or more levels off in
    severity.
  - **0:** not mentioned.
- **Recall per run** = Σ credit ÷ planted. **Recall per checker** = pooled over its last 4 canary runs, reported with
  *n* planted. On fewer than 10 planted defects the number is labelled "indicative".
- **Pattern miss list:** every canary that scored 0 names its pattern. The next playbook version targets the patterns
  that are missed most often, one theme at a time (`README.md` step 4).
- **False positives on a canary run:** findings that are neither planted nor confirmed real on `main`. They feed the
  checker's precision.
- **Also recorded:** time to first detection, total time, turns, output tokens, and the playbook version used. Every
  run gets a row in `scorecard.md` § "Canary runs".
- **L1, L3 and L5 scripted canaries:** pass or fail per condition. A failed condition is an L1 escape-in-waiting and is
  logged in `escapes.md` (as E-038 was).

## 5. Budget-aware schedule (proposal; all subject to § 1.9)

Cost estimates come from the round-0 costs in `scorecard.md`. They are **estimates**.

| When | Canary | Cost (estimate) | Why now |
|---|---|---|---|
| Next merge batch | C-L1-01, C-L1-02, C-L1-03 (scripted) | ≈ 5–10 CPU minutes, no tokens | Verifies the RC-1 fix and exposes E-038 and RC-2. Cheapest, highest signal |
| Week of 2026-11-09 | L2 set A on a payments or finance copy | ≈ 150–250k output tokens, 20–30 min (first-round reviews used 150–280k) | The money classes are most of the P0 history |
| When scenario tests exist | C-L3-01, C-L3-02 (scripted) | CPU only | Proves that the L3 consistency checks can fail |
| Week of 2026-11-16 | L2 set B (identity) | ≈ 200–280k | Tests SR2-2, SR2-3 and SR2-4 directly: the classes the first identity review missed |
| Week of 2026-11-16 | L4 mini round (C-L4-01, -03, -04, -07, -09, -11) with 2 personas | ≈ 60–100k (round 1 cost 169k for 9 personas) | Tests the tester's recall and the refiner's evidence check after BT v2 and UR v2 |
| With the parity-ops resume | C-L5-01, C-L5-02 | ≈ 20–50k | Tests PR v2 |
| Week of 2026-11-23 | L2 set C or D | ≈ 200k | Rotation |
| Monthly | L2 set E (UI) | ≈ 200k | UI reviews are fewer |

**Do not run L4 canary traps inside the normal UX round.** Mixing traps into the round's lab would change the new-user
metrics the round exists to measure (`docs/ux/scorecard.md`). Keep L4 canaries in a separate mini round.

## 6. Results log

| Run id | Date | Checker / playbook version | Set | Planted | Credit | Recall | False positives | Time | Output tokens | Patterns missed |
|---|---|---|---|---|---|---|---|---|---|---|
| — | — | Round 0: no runs (usage constrained) | — | — | — | — | — | — | — | — |

<!-- Append one row per canary run. After scoring, append the answer key under "### <run-id> key". -->
