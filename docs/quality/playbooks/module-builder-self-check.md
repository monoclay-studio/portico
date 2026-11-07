# Module builder self-check (L1, every agent) — playbook

| | |
|---|---|
| **Current version** | **v3** (2026-11-07, round 1) |
| **Theme of v3** | Contract integrity: import shared vocabularies, never copy them; use the value's own family; scope parameters are required. The v2 theme (re-verify every change in a fix round or merge) stays in force, unchanged |
| **Previous** | `archive/module-builder-self-check-v2.md` (v2); `archive/module-builder-self-check-v1.md`. That is the 32-item "done" checklist: the gates from the briefs actually used, plus the defect classes the first ten reviews found in branches that had passed their own tests |
| **Launch** | Builders run it before saying "done" and in every fix round. The final reply includes the § 3 table. The orchestrator links this file from `module-agent-playbook.md` (retro, edit 2) |
| **Measured by** | `scorecard.md`: escapes attributed to L1-BSC (round 0: 7); P0/P1 findings per first review (round 0: 17 P0 and 94 P1 across 10 reviews); defects that a fix round introduced or left behind, found by re-reviews (round 0, identity-plus: 6, of which 1 P0, 2 P1 and 3 P2) |

## Change log

| Version | Date | ID | What changed | Why | Prompted by | Measured next round by |
|---|---|---|---|---|---|---|
| v1 | 2026-11-07 | — | 32-item "done" checklist in 9 groups (gates; isolation and authorization; concurrency; idempotency, events and effects; money; contracts; data authority and environment; security and privacy; honest claims), each item tied to the reviews that found the class | Every builder said "done, tests green", and every one of the 10 reviews still found real defects (`04-…lessons.md`) | Round-1 reviews | P0/P1 per first review |
| v2 | 2026-11-07 | **BS2-1** | **Re-attack your own fix.** For every finding fixed: (a) run the attack in reverse order; (b) apply the fix to every sibling path; (c) make the failure path commit nothing; (d) check that a third party cannot trigger the new refusal against a legitimate user (griefing); (e) reserve every new counter or limit atomically, and test it concurrently | The identity-plus fix round closed all 11 original attacks, yet introduced or left 1 P0, 2 P1 and 3 P2 that only a second review found. 7 other modules merged on fix verification alone, with no second review | E-001, E-003, E-004, E-005, E-006, E-007 | Fix-introduced defects found by re-reviews or canaries (round 0: 6 in identity-plus); canaries C-L2-08 and C-L2-13 |
| v2 | 2026-11-07 | **BS2-2** | The fix-round reply table gains columns: siblings checked, reverse-order probe, failure-path probe, griefing probe | Makes BS2-1 auditable by the re-reviewer and the orchestrator | as BS2-1 | Columns filled in 100 % of fix-round replies |
| v2 | 2026-11-07 | **BS2-3** | **The gate block, after any merge of `main`:** `pnpm install --frozen-lockfile` (commit the lockfile if it changed); the gates on the **merged** tree with `--force`; both test commands (`pnpm test` and `pnpm turbo run test --force`); exit codes read directly, never piped | Lockfile drift and duplicate imports surfaced only after merging. A demo-seed timeout appeared only under turbo's default concurrency. Lint failures were committed through piped output. Cached typecheck hid type errors | E-008, E-009, E-010, E-015, E-017, E-018 | Merge-time breakages that the branch's own gate should have caught (round 0: E-008, E-010, E-011, E-018) |
| v3 | 2026-11-07 | **BS3-1** | **Import, never copy, a shared vocabulary.** No module-local `z.enum` or union may copy a kernel or provider vocabulary: provenance, environment, data-authority domains, payer types, statuses, error codes. Grep before "done" (§ 4). If the owner does not export it, request it in `FOUNDATION_REQUESTS.md` and import the type meanwhile | RC-2 recurred. Five provenance copies exist with four value sets, and reservations lacks `sandbox`. A planted kernel value was caught only through payments' copy (canary C-L1-02b) | E-008, E-009, E-011, **E-058** | Module-local copies of kernel or provider vocabularies (R1 baseline: 5 provenance copies; see `scorecard.md` § 7); merge-time drift breakages |
| v3 | 2026-11-07 | **BS3-2** | **Use the value's own family.** Every status chip, badge or stored label uses the vocabulary of the field the value comes from | The backoffice rendered a discrepancy value (`skip`) with the occupancy vocabulary | **E-054** | Wrong-family call sites (UX-03b) found later |
| v3 | 2026-11-07 | **BS3-3** | **Scope parameters are required.** No port function takes an optional `propertyId` or `legalEntityId`. An omitted scope throws; it never widens to every property | Finance's reservations port widened delegation to every property when `propertyId` was omitted. That is the shape of round-0 finance P0-1 | **E-045** | Optional scope parameters on port surfaces (R1 baseline: 6 in `financeForReservations`) |

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
2. **In every fix round**, also do § 3, the v2 re-attack, for each finding you fix. Include the table in your reply.
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
