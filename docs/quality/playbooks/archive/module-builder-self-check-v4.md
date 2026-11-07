# Module builder self-check (L1, every agent) — playbook

| | |
|---|---|
| **Current version** | **v4** (2026-11-07, round 2) |
| **Theme of v4** | Invariant closure: state each fix as an invariant over stored state, then test every writer of its inputs, every repeat and inverse operation, and the fix's own records. It revises the v2 theme, which was measured once and found insufficient. v3 (contract integrity) stays in force:  import shared vocabularies, never copy them; use the value's own family; scope parameters are required. The v2 theme (re-verify every change in a fix round or merge) stays in force, unchanged |
| **Previous** | `archive/module-builder-self-check-v3.md` (v3); `archive/module-builder-self-check-v2.md` (v2); `archive/module-builder-self-check-v1.md`. That is the 32-item "done" checklist: the gates from the briefs actually used, plus the defect classes the first ten reviews found in branches that had passed their own tests |
| **Launch** | Builders run it before saying "done" and in every fix round. The final reply includes the § 3 table. The orchestrator links this file from `module-agent-playbook.md` (retro, edit 2) |
| **Measured by** | `scorecard.md`: escapes attributed to L1-BSC (round 0: 7); P0/P1 findings per first review (round 0: 17 P0 and 94 P1 across 10 reviews); defects that a fix round introduced or left behind, found by re-reviews (round 0, identity-plus: 6, of which 1 P0, 2 P1 and 3 P2) |

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
- **v5, assert what you claim (RC-10).** Every test that touches a money path asserts the amount and the counterparty.
  Every README "tested" claim cites its asserting line. Prompted by E-041, E-042, E-043 and E-044 (AP-55).
- **v4, effective-dated data.** Every rule pack has an explicit first `valid_from` and refuses dates before it
  (AP-48, E-023).

---

## How to run it

1. **Before you say "done"**, go through § 2, the v1 checklist. For every item answer `yes, test <name>`,
   `N/A: reason` or `no: listed in README Known gaps`. Put the summary in your final reply: counts of yes, N/A and no,
   and every "no" with its gap entry.
2. **In every fix round**, also do § 3 (the re-attack table) and § 5 (invariant closure, v4) for each finding you
   fix. Include both tables and the exemption list in your reply.
3. **After every merge of `main`**, run § 1, the gate block, again on the merged tree.

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

## 5. Invariant closure (v4: BS4-1, BS4-2, BS4-3)

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
