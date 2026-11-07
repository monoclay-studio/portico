# Module builder self-check (L1, every agent) — playbook

| | |
|---|---|
| **Current version** | **v6** (2026-11-07, round 3). v5 and v6 were published together; each has its own theme and its own metric |
| **Theme of v5** | **Complete, derived and proven closure.** The v4 invariant table now covers the record's whole life (every state and exit, including exemption and deferral states), the external systems that hold a copy of it, every enforcement point of a stored control fact, the writers of the invariant's key fields, and concurrency per writer. Writer and reader lists are derived by search and pasted, never recalled. P0/P1 fixes are proven by one mutant per guard element |
| **Theme of v6** | **Claims you can point to.** Every capability statement you write (README, runbook, "Done", parity list, self-check "yes" or "N/A") is in a claim ledger with the test or code line that makes it true. The case that raised a finding is itself a regression test |
| **Still in force** | v4 (invariant closure, exemption list, a test that fails without the fix: § 5 now extends it), v3 (contract integrity, § 4), v2 (re-attack table § 3, gate block § 1), v1 (§ 2 checklist) |
| **Previous** | `archive/module-builder-self-check-v4.md` (v4); `…-v3.md`; `…-v2.md`; `…-v1.md` |
| **Launch** | Builders run it before saying "done" and in every fix round. The final reply includes the § 3 and § 5 tables, the mutation table (§ 5.4) and the claim ledger (§ 6). The orchestrator links this file from every build and fix-round brief, **including resumed agents** (orchestrator v4 O4-5) |
| **Measured by** | v5: defects fix rounds leave behind, found by re-reviews (round 3: 10 in the integration-step fix round 2); guard elements with no failing test, by mutation canary (round 3: 1 of 6). v6: prose claims contradicted later (round 3: 13) |

## Change log

| Version | Date | ID | What changed | Why | Prompted by | Measured next round by |
|---|---|---|---|---|---|---|
| v1 | 2026-11-07 | — | 32-item "done" checklist in 9 groups (gates; isolation and authorization; concurrency; idempotency, events and effects; money; contracts; data authority and environment; security and privacy; honest claims), each item tied to the reviews that found the class | Every builder said "done, tests green", and every one of the 10 reviews still found real defects (`04-…lessons.md`) | Round-1 reviews | P0/P1 per first review |
| v2 | 2026-11-07 | **BS2-1** | **Re-attack your own fix.** For every finding fixed: (a) run the attack in reverse order; (b) apply the fix to every sibling path; (c) make the failure path commit nothing; (d) check that a third party cannot trigger the new refusal against a legitimate user (griefing); (e) reserve every new counter or limit atomically, and test it concurrently | The identity-plus fix round closed all 11 original attacks, yet introduced or left 1 P0, 2 P1 and 3 P2 that only a second review found. 7 other modules merged on fix verification alone, with no second review | E-001, E-003, E-004, E-005, E-006, E-007 | Fix-introduced defects found by re-reviews or canaries (round 0: 6 in identity-plus); canaries C-L2-08 and C-L2-13 |
| v2 | 2026-11-07 | **BS2-2** | The fix-round reply table gains columns: siblings checked, reverse-order probe, failure-path probe, griefing probe | Makes BS2-1 auditable by the re-reviewer and the orchestrator | as BS2-1 | Columns filled in 100 % of fix-round replies |
| v2 | 2026-11-07 | **BS2-3** | **The gate block, after any merge of `main`:** `pnpm install --frozen-lockfile` (commit the lockfile if it changed); the gates on the **merged** tree with `--force`; both test commands (`pnpm test` and `pnpm turbo run test --force`); exit codes read directly, never piped | Lockfile drift and duplicate imports surfaced only after merging. A demo-seed timeout appeared only under turbo's default concurrency. Lint failures were committed through piped output. Cached typecheck hid type errors | E-008, E-009, E-010, E-015, E-017, E-018 | Merge-time breakages that the branch's own gate should have caught (round 0: E-008, E-010, E-011, E-018) |
| v3 | 2026-11-07 | **BS3-1** | **Import, never copy, a shared vocabulary.** No module-local `z.enum` or union may copy a kernel or provider vocabulary: provenance, environment, data-authority domains, payer types, statuses, error codes. Grep before "done" (§ 4). If the owner does not export it, request it in `FOUNDATION_REQUESTS.md` and import the type meanwhile | RC-2 recurred. Five modules hold six literal provenance copies, four of them different from the kernel's, and reservations lacks `sandbox`. A planted kernel value was caught only through payments' copy (canary C-L1-02b) | E-008, E-009, E-011, **E-058** | Module-local copies of kernel or provider vocabularies (R1 baseline: 6 provenance literals in 5 modules; see `scorecard.md` § 7); merge-time drift breakages |
| v3 | 2026-11-07 | **BS3-2** | **Use the value's own family.** Every status chip, badge or stored label uses the vocabulary of the field the value comes from | The backoffice rendered a discrepancy value (`skip`) with the occupancy vocabulary | **E-054** | Wrong-family call sites (UX-03b) found later |
| v3 | 2026-11-07 | **BS3-3** | **Scope parameters are required.** No port function takes an optional `propertyId` or `legalEntityId`. An omitted scope throws; it never widens to every property | Finance's reservations port widened delegation to every property when `propertyId` was omitted. That is the shape of round-0 finance P0-1 | **E-045** | Optional scope parameters on port surfaces (R1 baseline: 22 matches of the § 4 grep; 6 functions in `financeForReservations` per the review) |
| v4 | 2026-11-07 | **BS4-1** | **Invariant closure** (new § 5). For each fix, write the invariant it establishes over stored state. Then fill one row per writer: (a) **premise writers**, every path that writes a fact the fix reads (AP-57); (b) **repeat and inverse** operations of the guarded operation (AP-58); (c) the fix's **own records** (exceptions, statuses, requests, audits), recomputed on every change; (d) the other **record parameters** and **stores** the invariant covers (AP-01, AP-17) | v2's § 3 was measured for the first time this round. All 3 fix rounds filled it in. Even so, the integration-step fix round left 3 P1s "one step beyond" its fixes, and the sweep found 8 residuals of round-0 fixes. § 3(b) "siblings" was read as *other callers of the guarded action*, never as *writers of the facts the guard trusts*, inverse operations or repeated application | E-063, E-066, E-067, E-070, E-073, E-074, E-075, E-076 (RC-13) | Defects that fix rounds introduce or leave behind (round 2: 12 from L1-BSC plus 2 from recommendations); canaries C-L2-18 and C-L2-19 |
| v4 | 2026-11-07 | **BS4-2** | **Exemption list.** The fix-round reply lists every early `return`, default, label or flag that lets something pass, with the attack run against each | R2-P2-3: the fix added two fail-open `return`s. SW-PAY-2: the `custom` label skipped the guard. SW-RAT-1: an unsafe default | E-064, E-069, E-077 | Exemptions found by the re-review that were absent from the builder's list |
| v4 | 2026-11-07 | **BS4-3** | **The test must fail without the fix.** For each regression test, revert or disable the fix locally and confirm the test fails. Note "fails without fix: yes" in the table | SW-BO-1: the P0-1 e2e test cannot fail. R2-P2-4: the test asserts `done`, not the attestation | E-068, E-078 (AP-55) | Regression tests that pass without their fix (round 2: 2 found by review) |
| v5 | 2026-11-07 | **BS5-1** | **State machine.** Draw every state of each record the fix touches (including failed, expired, cancelled, superseded, transferred, settled elsewhere) and of each exemption or deferral the fix adds, with every transition and the trigger that ends each state. One closure row per transition | R3-P1-1: a deferral that never resumes, a folio settled to receivables, a superseded request. v4's "repeat and inverse" did not reach the record's other exits | E-086 (RC-14) | Defects a fix round leaves, found by re-review; canary C-L2-19 |
| v5 | 2026-11-07 | **BS5-2** | **External holders.** List every external system holding a copy of the record (payment provider, channel, OTA, lock, POS, email already sent). Every Portico transition is mirrored there first; until the holder confirms, the record is "possibly live". Every external event maps to a transition, including on a superseded record. The simulator models it | R3-P1-1(iii): a re-issued request left the old link payable at the provider; the guest paid both | E-086 (AP-59) | Canary C-L2-20 |
| v5 | 2026-11-07 | **BS5-3** | **Derived lists.** Writer and reader lists come from a search of the code (inserts, updates, function callers, field reads, copies into text), and the search command and its hits are pasted under the table | The builder listed 7 writers from memory; the reviewer found 2 more by search. A protected balance was copied into stored issue text that no field filter reached (third FD-15 sibling) | E-086, E-089 | Writers or readers a re-review finds that the pasted search missed |
| v5 | 2026-11-07 | **BS5-4** | **Enforcement points of a stored control fact.** For a consent, mandate, scope, limit or approval: a grid of every path that acts under it × every field it stores, each cell citing the line that checks it | R3-P1-2: the mandate's purposes, amount and bookings were enforced on the guarantee path only | E-087 (AP-60) | Canary C-L2-21 |
| v5 | 2026-11-07 | **BS5-5** | **Key fields and recommendation lines.** The fields that **select** the invariant's records (reference, purpose label, family) are inputs with writers like any other. Every line of the reviewer's recommendation, including its "attack on the fix", is a row | R3-P2-1: the guard keyed on a client-chosen label; the sweep's "treat booking and folios as one family" was not implemented | E-088 (AP-28, AP-35) | Unimplemented recommendation lines found by re-review |
| v5 | 2026-11-07 | **BS5-6** | **Concurrency per writer.** Each writer row has a concurrency cell: the lock, unique key or serialization that holds it, or a concurrent test. "n/a" needs the reason. A cross-module call made while holding a lock follows the lock order in the domain map | R3-P2-3: concurrent imports skipped a check that holds sequentially (§ 3 said "n/a"); R3-P3-3: reversed lock order between finance and payments | E-090, E-092 (AP-36) | Races found by re-review |
| v5 | 2026-11-07 | **BS5-7** | **One mutant per guard element** for P0/P1 fixes and any fix with more than one guard: remove each lock, branch, check, audit and sibling call in turn; name the test that turns red. A pre-fix-commit run (v4 BS4-3) remains enough for a single-guard P2/P3 fix | A pre-fix run proves a test file fails, not which guard each test protects. Canary `r3-l1`: 1 of 6 guard elements of a fix "proven" by the pre-fix run (the collection lock) has no failing test. The guests fix used 14 mutants and named each test | E-114, E-102 (AP-55) | Mutation canary survivors (round 3: 1 of 6) |
| v6 | 2026-11-07 | **BS6-1** | **Claim ledger.** Search everything you wrote (README, runbooks, docs, decisions files, parity lists, reports) for capability words: *cannot, never, only, always, every, all, pages, alarms, refuses, enforced, guarantees, Done, tested*. Each hit is a ledger row with the asserting test (quoted line) or the code line that makes it true. A hit with neither is rewritten or downgraded before "done" | 15 of 32 round-3 escapes contradict a written claim: a runbook said the deploy role cannot read secrets; the drill "pages"; "every tile opens its list"; "scope enforced"; 13 parity rows "tested" | E-087, E-096 … E-102, E-106, E-107, E-109, E-110, E-111 (RC-15, AP-50) | Prose claims contradicted later (round 3: 13) |
| v6 | 2026-11-07 | **BS6-2** | **The finding's own reproduction is a test.** A fixed finding or a "Done" refinement cites the regression test of the exact case that raised it (same screen, field and input), and that test fails without the fix | NAV-08 was "Done", yet the very E-025 case (empty property Name) crashed the screen in round 2a; no test covered it | E-106 | Re-raised reproductions (round 3: 1) |
| v6 | 2026-11-07 | **BS6-3** | **Checklist answers carry their evidence.** "yes" names the tests (v1 already said so); "N/A" gives a reason about the item, checked against what the module configures or deploys. A summary such as "14 yes, 14 N/A" without the per-item list is not an answer | The infra report answered "23: guard rails tested", "25: LIVE keys refused", "31: README claims cite tests" with no test names, and marked PII "N/A" while setting the database's log parameters | E-098, E-099, E-103 | Self-check answers contradicted later |

### Round-3 measurement of v4

- **§ 5 (invariant closure)** was run in **2 of 2** fix rounds: the integration-step fix round 2 (six invariants, a
  pre-fix-commit run) and the guests fix (invariant (g), 14 mutants).
- **What it caught.** Every one of the 9 first-review and 9 re-review-#2 attacks is now refused. The guests fix was
  merged on the orchestrator's verification and has had no re-review yet.
- **What it missed.** Re-review #3 found **2 P1 and 4 P2** one step beyond the integration-step table (E-086 …
  E-090): exits of the record, an external holder, readers of a stored control fact, the key fields, concurrency. All
  five gaps are outside v4's frame (RC-14), so v5 widens the frame.
- **BS4-2 (exemptions):** 7 listed; re-review #3 attacked all 7 and found 3 unsafe (R3 § 4). Listing them made the
  attack cheap, which is the point.
- **BS4-3 (fails without the fix):** the pre-fix-commit run reported 4 tests that passed before the fix and labelled
  them honestly. One of them hides an untested lock (E-114). BS5-7 adds mutation per guard.
- **The infra build (v3, not v4)** answered items 23, 25 and 31 "yes" without test names; 8 escapes contradict those
  answers (E-096 … E-103). That is v6's subject.

### Round-2 measurement of v2 and v3

- **v2 § 3 (re-attack table):** filled in **3 of 3** fix rounds (integration step, identity round 4, guests). The
  identity round added genuine reverse-order and sibling regression tests for the W-1 race. The integration-step round
  still produced **3 P1s one step beyond** its fixes. § 3 works as a record but is not sufficient as a technique, so
  v4 adds invariant closure.
- **v3 § 4 (contract integrity):** run in **1 of 2** fix rounds. Identity round 4 self-detected platform vocabulary
  copies (environment, effect modes, provenance, data authority). The integration-step round did not run § 4.
  Vocabulary copies on `main` are unchanged, because the lint rule is still unbuilt.
- **§ 1 gate block:** identity round 4 ran only the coordinator's command set, not both test commands. Report every
  gate command in the reply, including those not run.

### Why v3 is published before v2 has been measured

No builder has yet run v2. The round-1 fix rounds (integration step, identity round 4) are the first to use it. v3
targets a **separate** metric: vocabulary copies, wrong-family call sites and optional scope parameters. v2 targets
defects that fix rounds introduce or leave behind. So round 2 can still attribute each change. The trigger was RC-2
recurring twice in one round (E-054, E-058), with a canary confirming that the gate catches drift only by accident.

### Queued for later versions (one theme each)

- *(v3 contract drift: published in round 1; see the change log.)*
- *(v5 "assert what you claim" was folded into v6, published in round 3; the money-path assertion rule, "every test
  that touches a money path asserts the amount and the counterparty", stays in AP-55's probe.)*
- **v7, lock and race tests that can fail.** Every lock or ordering guard has a test whose competing writer starts
  inside the window (barrier or held transaction). Queued from E-114; v5's mutation step will show whether it is
  needed as its own version.
- **v4, effective-dated data.** Every rule pack has an explicit first `valid_from` and refuses dates before it
  (AP-48, E-023).

---

## How to run it

1. **Before you say "done"**, go through § 2, the v1 checklist. For every item answer `yes, test <name>`,
   `N/A: reason` or `no: listed in README Known gaps`. Put the summary in your final reply: counts of yes, N/A and no,
   and every "no" with its gap entry.
2. **In every fix round**, also do § 3 (the re-attack table) and § 5 (closure, v4 + v5) for each finding you fix.
   Include both tables, the exemption list, the pasted searches and the mutation table in your reply.
3. **Before "done" and in every fix round**, fill the claim ledger (§ 6, v6) for everything you wrote or changed.
4. **After every merge of `main`**, run § 1, the gate block, again on the merged tree.

## 1. Gate block (v2, BS2-3; supersedes v1 items 1–4)

```bash
git merge --no-edit main                         # resolve; composition.ts conflicts: keep every module's block
pnpm install --frozen-lockfile || { pnpm install && git add pnpm-lock.yaml; }   # commit a changed lockfile
pnpm lint;                                    echo "lint exit=$?"
pnpm turbo run typecheck --force;             echo "typecheck exit=$?"
pnpm test;                                    echo "test (CI concurrency) exit=$?"
pnpm turbo run test --force;                  echo "test (default concurrency) exit=$?"
```

- Read each `exit=` line. Never pipe a gate through `tail`, `grep` or `head`; that hides its exit code. To shorten
  the output, redirect it to a log file and then read the exit code.
- A gate that fails only under the second test command still counts as a failure. Report it, with the slowest tests
  and their durations.
- Format with `npx biome check --write <your paths>`, and never on `*.md`. If a shared tool, such as the boundary
  checker or the catalogue test, blocks you with a false positive, add a minimal reproduction to
  `FOUNDATION_REQUESTS.md`. Do not work around it in a way that hides the check.

## 2. Done checklist (v1, unchanged; items 1–4 now in § 1)

See `archive/module-builder-self-check-v1.md` §§ 2–9, items 5–32:

- isolation and authorization (5–8);
- concurrency (9–11);
- idempotency, events and external effects (12–15);
- money (16–18);
- contracts (19–23);
- data authority and environment safety (24–25);
- security and privacy (26–30);
- honest claims (31–32).

For each item, the matching probe is in `docs/quality/patterns.md`.

## 3. Fix-round re-attack (v2, BS2-1 and BS2-2)

For **each** finding you fix:

| Step | Do | Pattern |
|---|---|---|
| 0 | Turn the reviewer's PoC or probe into a regression test that asserts the attack is **refused** | — |
| (a) Reverse order | Run the same attack with the actors' order swapped. The attacker sets up the identity, account, link or record first, and the legitimate owner arrives later. Especially for any "only when new" or "only when not yet linked" exception your fix introduces | AP-08 |
| (b) Siblings | Grep every entry point that makes the **same state change**: routes, services, SCIM/SSO, jobs, event consumers, imports, transfers. Apply the fix to each, with a test for each | AP-45 |
| (c) Failure path | For each refusal your fix adds inside a multi-step command, assert that **no row was created or changed** (compare row counts before and after). Audit refusals in a separate transaction | AP-46 |
| (d) Griefing | Ask whether someone else (another organization, a guest, a channel) can put a legitimate user into your new refused state. If so, the user needs a recovery path that does not depend on that party | AP-47 |
| (e) Atomic limits | Every new counter, cap or limit is reserved atomically (`update … set n = n + 1 where … returning`, or a row lock) **before** the protected action, and has a concurrent test (N = 10) | AP-12, AP-36 |

Reply table (BS2-2):

| Finding | Fix commit | Regression test | (a) reverse | (b) siblings checked (list) | (c) failure path | (d) griefing | (e) atomic |
|---|---|---|---|---|---|---|---|
| e.g. P1-6 | `abc123` | `review-regressions.test.ts` "P1-6 …" | n/a (no exception added) | revoke, suspend, remove, reset password, reset MFA, **transfer**, SCIM group, SSO group | refusal leaves 0 rows | an invited membership from another org cannot block it | n/a |

## 4. Contract integrity (v3: BS3-1, BS3-2, BS3-3)

Run before "done", and after every merge of `main`.

```bash
# BS3-1: copies of shared vocabularies (each hit must be an import or a re-export, never a literal copy)
grep -rnE "z\.enum\(\[ *'(live|demo|trial|portico|external|guest_profile|module_)" modules/*/src packages/ui/src apps/*/src
grep -rn -A2 "z\.enum(\[\s*$" modules/*/src packages/ui/src apps/*/src | grep -E "'(live|sandbox|simulated|portico|guest_profile)'"   # multi-line literals
grep -rnE "'module_(un)?available'|'module_not_available'" modules/*/src apps/*/src
# BS3-3: optional scope on port surfaces
grep -rnE "propertyId\?: *string|legalEntityId\?: *string" modules/*/src/ports.ts modules/*/src/service/index.ts modules/*/src/*-port.ts
```

| Check | Pass condition |
|---|---|
| BS3-1 | Every vocabulary your module shares with the kernel or another module is imported from the owner's contracts, or a foundation request is filed |
| BS3-2 | Every `StatusBadge`/label call site passes the vocabulary of the value's own field. No family receives another family's values |
| BS3-3 | No port function your module exposes or consumes accepts an omitted scope. `delegated(…, undefined)` throws |

## 5. Invariant closure (v4: BS4-1, BS4-2, BS4-3; widened by v5: BS5-1 … BS5-7)

For **each** finding you fix, after the § 3 table:

1. **Write the invariant** the fix establishes over **stored state**, not as a check on a path. Examples:
   - "After departure, a folio has at most one open balance request, and it equals the folio's debt."
   - "A card held at check-in was supplied by its cardholder for this booking, or is covered by a mandate."
   - "Every deposit account's booking belongs to the account's property and legal entity."
   - "No personal data of an erased subject is returned by any API, including idempotent replays."
2. **List its inputs:** every field, row, link and flag the invariant depends on.
3. **List every writer of each input.** Grep the inserts and updates, the commands, imports, channel ingestion,
   merges and unmerges, jobs, seeds and migrations. Include writers in **other modules** reached through ports.
4. **Fill the table.** One row per writer, plus the repeat, inverse and own-record rows. Each row needs a test that
   **fails without the fix** (BS4-3).

| Invariant | Input | Writer, repeat or inverse | Held to the rule? | Test (fails without fix?) |
|---|---|---|---|---|
| a departed folio's open request = its debt | folio balance | late charge ×3, with a request already open | yes: amend under the folio lock | `late-charges ×3` (yes) |
| | | reversal, adjustment, transfer out | yes: amend down, or cancel at 0 | `reversal cancels request` (yes) |
| | exception severity (the fix's own record) | every recompute | recomputed, never frozen | `severity follows debt` (yes) |
| a held card was supplied by its cardholder | booking guarantee link | create, patch, channel create, channel modify, check-in input | yes: owner = `booking:<id>` supply, or a mandate | `stranger linked as booker → refused` (yes) |

5. **Exemptions (BS4-2).** List every early `return`, default value, client-chosen label or optional dependency that
   lets something pass, and the attack you ran against each. An exemption you cannot defend becomes a refusal.
   **v5:** an exemption that defers or holds something is a **state** (BS5-1): name the trigger that ends it, and
   test that trigger firing both ways (for example, the in-flight payment succeeds; it fails).

### 5.1 Before the table (v5)

1. **State machine (BS5-1).** For each record the fix touches, and each exemption or deferral it adds, write:

   | Record | States | Transition | Trigger (internal or external) | Closure row? |
   |---|---|---|---|---|
   | balance request | open, partially paid, paid, deferred, superseded, cancelled, expired | open → deferred | a payment on the folio is in flight | yes |
   | | | deferred → open | that payment **fails** or is reversed | yes |
   | | | open → superseded | re-issue or amend | yes (with BS5-2) |
   | | | open → cancelled | the folio is settled to receivables | yes |

   A state with no exit, or a transition with no test, is a finding against your own fix.
2. **External holders (BS5-2).** For each record: which external systems hold a copy (provider link or intent,
   channel booking or ARI, OTA, lock credential, POS check, email or message already sent, exported file)? For every
   Portico transition, the external copy is deactivated or updated **first**; until the holder confirms, show the
   record as "possibly live" (pending verification). For every external event (paid, failed, expired, disputed,
   modified), name the transition it drives, including on a record Portico already superseded. If the simulator
   cannot model the external behaviour, say so: the closure is then unproven, not closed.
3. **Derived lists (BS5-3).** Produce the writer list and the reader list by search, and paste the commands and their
   hits under the table. At least: the table's inserts and updates; the callers of the function that keeps the
   invariant (for example `syncDepartedFolios`) **compared with** every function that changes the input (for example
   every path that posts to or settles a folio); every read of a protected field, and every place its value is
   **copied** into text, details, summaries, exports or previews.
4. **Control facts (BS5-4).** If the fix relies on a stored consent, mandate, scope, limit or approval, fill the grid:

   | Path acting under it | field 1 (e.g. legal entity) | field 2 (properties) | field 3 (purposes) | field 4 (amount cap) | field 5 (bookings) |
   |---|---|---|---|---|---|
   | charge | `collect.ts:150` | `:151` | **missing** | **missing** | **missing** |
   | authorize, increment, capture beyond the authorization, request drawn on the card | … | … | … | … | … |

   Every cell cites a line or says **missing**. A staff permission decides who may act **within** the fact, never
   how far beyond it.
5. **Key fields and recommendation lines (BS5-5).** Add rows for the fields that **select** the invariant's records
   (reference, family, purpose label, type) and their writers. Copy every line of the reviewer's recommendation,
   including its "attack on the fix", into the table as a row; mark each implemented (with test) or declined (with
   reason).

### 5.2 The table (v4 columns plus v5's concurrency column)

| Invariant | Input or state | Writer, transition, repeat or inverse | Held to the rule? | Concurrency (BS5-6) | Test (fails without fix: mutant or pre-fix) |
|---|---|---|---|---|---|
| a departed folio's open request = its debt | folio balance | settle to receivables | yes: cancels the request, deactivates the link first | folio lock, then collection lock (domain-map order) | `settle cancels request` (M3 red) |
| | deferral state | in-flight payment fails | yes: request resumes, open item until it does | collection lock | `deferral resumes on failure` (M4 red) |
| deposit account ↔ booking's property and entity | `deposit_accounts` | import (two files concurrently) | yes: re-checked under the row lock | advisory lock on the booking id; 10-way concurrent test | `concurrent imports` (M5 red) |

"n/a" in the concurrency column needs its reason (one writer only; serialized by lock X). A cross-module call made
while holding a lock follows the order written in `docs/architecture/domain-map.md`; if none is written, write it.

### 5.3 Exemptions (BS4-2, unchanged)

As step 5 above.

### 5.4 Proof by mutation (BS5-7)

For P0/P1 fixes, and any fix with more than one guard element:

| Mutant | Guard element removed | File:line | Test that turns red |
|---|---|---|---|
| M1 | the per-reference collection lock | `collect.ts:200` | `concurrent link payment vs desk charge` |
| M2 | the `custom` branch | `collect.ts:208` | `SW-PAY-2 custom on a paid link` |

- Remove one element at a time (a lock, a branch, a check, an audit call, a call on one sibling path, a field of a
  control-fact check) and run the module's tests; restore it before the next.
- A mutant that leaves every test green is a missing test: write it, then re-run the mutant.
- A test that passed before the fix (BS4-3) is a mutation **signal**: say which guard it protects, or replace it.
- For a lock, the test's competing writer must start **inside** the window (a barrier, or a transaction held open);
  creating the competing record first and racing afterwards tests nothing (E-114).
- A single-guard P2/P3 fix may keep the v4 pre-fix-commit run instead.

## 6. Claim ledger (v6: BS6-1, BS6-2, BS6-3)

Run before "done" and in every fix round, over everything you wrote or changed.

```bash
# BS6-1: capability words in your prose (adjust the paths to your write scope)
grep -rnE "\b(cannot|can't|never|only|always|every|pages?|alarms?|refuses?|enforced|guarantees?|Done|tested)\b" \
  <your README.md> docs/runbooks/<yours> <your decisions/parity/spec files>
```

| Claim (file:line, quoted) | Kind | Evidence: test (quoted assertion) or code (file:line) | Verdict |
|---|---|---|---|
| `deploy.md:20` "The deploy role cannot … read secret values" | capability (negative) | none: `PassRole` on the bootstrap execution role + `RunTask` overrides | **rewrite**: "the deploy role is administrator-equivalent for its cell" |
| `README.md:38` "its `scope` … is enforced" | guard | `charge` checks 2 of 5 fields | **downgrade** until BS5-4's grid is full |
| decisions "NAV-08 Done: field validation in staff language" | Done | e2e `empty property Name shows a field error` | keep |

- **BS6-1.** Expect noise: triage each hit as a claim or not, and every claim is a row. A negative capability ("cannot", "never", "only") needs a test that tries it and is
  refused, or the code line that makes it impossible. A monitoring promise ("pages", "alarms") needs the delivery path
  checked end to end (AP-61). A recorded default needs the code line that implements it (AP-62).
- **BS6-2.** For each finding fixed or refinement marked "Done", the ledger names the test of the **exact case** that
  raised it, and that test fails without the fix.
- **BS6-3.** In the § 2 checklist summary, "yes" lists test names per item and "N/A" gives a reason about the item,
  checked against what your module configures or deploys. Infra owns the database's, load balancer's and CDN's log
  settings, so PII and erasure items are never "N/A" for infra.
