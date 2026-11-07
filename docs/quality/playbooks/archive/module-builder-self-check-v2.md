# Module builder self-check (L1, every agent) — playbook

| | |
|---|---|
| **Current version** | **v2** (2026-11-07, round 0) |
| **Theme of v2** | Re-verify every change you make in a fix round or a merge, the way a reviewer would |
| **Previous** | `archive/module-builder-self-check-v1.md`. That is the 32-item "done" checklist: the gates from the briefs actually used, plus the defect classes the first ten reviews found in branches that had passed their own tests |
| **Launch** | Builders run it before saying "done" and in every fix round. The final reply includes the § 3 table. The orchestrator links this file from `module-agent-playbook.md` (retro, edit 2) |
| **Measured by** | `scorecard.md`: escapes attributed to L1-BSC (round 0: 7); P0/P1 findings per first review (round 0: 17 P0 and 94 P1 across 10 reviews); defects that a fix round introduced or left behind, found by re-reviews (round 0, identity-plus: 6, of which 1 P0, 2 P1 and 3 P2) |

## Change log

| Version | Date | ID | What changed | Why | Prompted by | Measured next round by |
|---|---|---|---|---|---|---|
| v1 | 2026-11-07 | — | 32-item "done" checklist in 9 groups (gates; isolation and authorization; concurrency; idempotency, events and effects; money; contracts; data authority and environment; security and privacy; honest claims), each item tied to the reviews that found the class | Every builder said "done, tests green", and every one of the 10 reviews still found real defects (`04-…lessons.md`) | Round-1 reviews | P0/P1 per first review |
| v2 | 2026-11-07 | **BS2-1** | **Re-attack your own fix.** For every finding fixed: (a) run the attack in reverse order; (b) apply the fix to every sibling path; (c) make the failure path commit nothing; (d) check that a third party cannot trigger the new refusal against a legitimate user (griefing); (e) reserve every new counter or limit atomically, and test it concurrently | The identity-plus fix round closed all 11 original attacks, yet introduced or left 1 P0, 2 P1 and 3 P2 that only a second review found. 7 other modules merged on fix verification alone, with no second review | E-001, E-003, E-004, E-005, E-006, E-007 | Fix-introduced defects found by re-reviews or canaries (round 0: 6 in identity-plus); canaries C-L2-08 and C-L2-13 |
| v2 | 2026-11-07 | **BS2-2** | The fix-round reply table gains columns: siblings checked, reverse-order probe, failure-path probe, griefing probe | Makes BS2-1 auditable by the re-reviewer and the orchestrator | as BS2-1 | Columns filled in 100 % of fix-round replies |
| v2 | 2026-11-07 | **BS2-3** | **The gate block, after any merge of `main`:** `pnpm install --frozen-lockfile` (commit the lockfile if it changed); the gates on the **merged** tree with `--force`; both test commands (`pnpm test` and `pnpm turbo run test --force`); exit codes read directly, never piped | Lockfile drift and duplicate imports surfaced only after merging. A demo-seed timeout appeared only under turbo's default concurrency. Lint failures were committed through piped output. Cached typecheck hid type errors | E-008, E-009, E-010, E-015, E-017, E-018 | Merge-time breakages that the branch's own gate should have caught (round 0: E-008, E-010, E-011, E-018) |

### Queued for later versions (one theme each)

- **v3, contract drift.** Never copy a kernel or provider enum, status vocabulary or error code: import it. Grep the
  workspace for near-duplicates of every enum you add or change. Prompted by E-008, E-009, E-011 and RC-2 (provenance
  copies, a 9-domain vs 10-domain enum, `module_unavailable` vs `module_not_available`, three payer-type vocabularies).
  Pairs with the lint rule proposed in the retro (edit 5).
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
