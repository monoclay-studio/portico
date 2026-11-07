# Escapes: defects found later than they should have been

An **escape** is a defect found by a later loop than the one that should have caught it: after merge, by the owner,
by a second review, or by the meta loop. This file is the core input to self-improvement (`README.md` § "How the meta
loop improves the others", step 3).

Each entry records:

- where the defect was found;
- the **earliest loop that should have caught it**;
- why that loop missed it;
- the check added, and to which playbook and version.

**Append-only.** IDs are global and never reused (`E-001`, `E-002`, …). Each round adds a section at the end and
updates the counts table. If an entry is corrected later, add a dated note below it. Never rewrite an entry.

## How entries are classified

- **Loops:** L1 = code gates; L2 = steward review; L3 = scenario proof; L4 = UX loop; L5 = market and parity; L6 =
  usage; L7 = owner; L8 = meta loop (this file's author).
- **L1 has two parts:**
  - **L1-gate:** the automated gates and shared tooling (lint, typecheck, tests, boundary and catalogue checks, turbo).
  - **L1-BSC:** the builder's own self-check before "done", including fix rounds. That is
    `playbooks/module-builder-self-check.md`.
- **Earliest loop.** This is the first loop, in pipeline order, that had the information needed to catch the defect.
  If a loop *saw* the defect but only mentioned it in a "note" with no owner, that loop is still the earliest; the
  root cause is then "detected but not tracked".
- **Kinds:**
  - **D:** product defect.
  - **G:** gate, tooling or build defect.
  - **C:** coverage gap in a catalogue, matrix or scope.
  - **Ev:** evidence defect in a checker's own output.
  - **Pr:** checker process defect.
- **Severity** follows the steward scale: P0 security, isolation, money or data loss; P1 contract, architecture, missing
  MUST or false claim; P2 tests, UX/error quality, maintainability; P3 nits. For C, Ev and Pr entries the severity is
  the steward-scale severity of the harm they enable. Severities marked *(est.)* are the quality steward's estimate.

---

## Counts

### By the earliest loop that should have caught it

| Loop | Round 0 (2026-11-07) | Entries |
|---|---|---|
| L1-gate | **9** | E-008, E-009, E-010, E-012, E-013, E-014, E-015, E-016, E-038 |
| L1-BSC (builder self-check, incl. fix rounds) | **7** | E-003, E-004, E-005, E-006, E-007, E-017, E-018 |
| L2 steward review | **11** | E-001, E-002, E-011, E-025, E-026, E-027, E-028, E-029, E-030, E-031, E-037 |
| L3 scenario proof | **0** | No L3 run had finished. L3 has caught nothing yet and has also missed nothing measurable. |
| L4 UX loop (tester, hand-off, refiner) | **5** | E-032, E-033, E-034, E-035, E-036 |
| L5 market, parity and research | **6** | E-019, E-020, E-021, E-022, E-023, E-024 |
| L6 / L7 | 0 | — |
| **Total** | **38** | |

### By where they were found

| Found by | Count | Entries |
|---|---|---|
| L1 at merge time (orchestrator) | 4 | E-008, E-010, E-011, E-018 |
| L1 builder gate runs | 5 | E-009 (also by the second review), E-012, E-014, E-015, E-016 |
| L2 first-round reviews (merge simulation, probes) | 7 | E-013, E-017, E-019, E-020, E-021, E-022, E-023 |
| L2 second review (identity-plus) | 7 | E-001 … E-007 |
| L4 black-box tester | 7 | E-025 … E-031 |
| L4 refiner or the delivery step | 4 | E-032, E-033, E-035, E-036 |
| L7 owner | 1 | E-024 |
| L8 meta loop (this round) | 2 | E-034, E-038 |
| The checker itself (self-reported) | 1 | E-037 |

### By severity and kind

| | D | G | C | Ev | Pr | Total |
|---|---|---|---|---|---|---|
| P0 | 1 | — | 1 *(est.)* | — | — | 2 |
| P1 | 5 | 2 | 2 | — | — | 9 |
| P2 | 10 | 5 | 2 | — | — | 17 |
| P3 | — | 4 | — | 4 | 2 | 10 |
| **Total** | **16** | **11** | **5** | **4** | **2** | **38** |

### Root causes shared by several escapes

| Root cause | Escapes | Main fix |
|---|---|---|
| **RC-1.** The turbo cache key ignored workspace dependencies (fixed in `1be3ddc`). `apps/*` sources are still not hashed (E-038). | E-008, E-009, E-038 | Forced gates; turbo inputs; L1 gate self-test canary `C-L1-01` |
| **RC-2.** A closed enum or error code is copied into each module instead of imported. | E-008, E-009, E-011 | Builder self-check; pattern `AP-42`; proposed lint rule |
| **RC-3.** A review's cross-module "notes for the orchestrator" have no owner and no tracking. | E-008, E-011 | Merge-procedure edit (retro, edit 4) |
| **RC-4.** A fix is applied to the named path only: no sibling, reverse-order, failure-path or abuse probe. | E-001, E-003, E-004, E-005, E-006, E-007 | Builder self-check v2; steward v2 SR2-2 and SR2-4 |
| **RC-5.** The UI review scope was narrower than the personas' reality (viewports, invalid input, roles, results). | E-025 … E-031 | Steward v2 SR2-5 |
| **RC-6.** Evidence is not verified before it is handed off. | E-032, E-033, E-034, E-035 | Black-box tester v2; refiner v2; hand-off checklist |
| **RC-7.** The catalogue is built from features, not from failure classes. | E-020, E-021, E-022, E-024 | Parity v2 PR2-2; gap strategist v2 |
| **RC-8.** The gate command differed from one brief to the next. | E-010, E-015 | Builder self-check v2 runs the gate as CI runs it |

---

## Round 0 — 2026-11-07 (baseline, built from day-1 data)

Sources used for every entry:
- `docs/chronicle/agents/*.md` (briefs and reports, verbatim);
- `docs/orchestration/reviews/*`;
- `docs/orchestration/pending-fixes.md`;
- `docs/ux/round-1/*`;
- `git log main`;
- `docs/chronicle/01-timeline.md` and `04-turning-points-and-lessons.md`.

### L2 — steward review should have caught it

#### E-001 · P0 · D · Account pre-hijacking: an organization mints a global identity for an email it does not own
- **Defect.** Any organization, a free trial included, could create a brand-new global identity with a password it chose
  for someone else's email. When a real hotel later invited that email, the attacker accepted the invitation in-app.
  This also worked for the **first administrator** of a newly provisioned live organization.
- **Found.** L2 second review, 2026-11-07 16:42–16:52: `docs/orchestration/reviews/review-identity-plus-2.md` R2-P0-1.
  PoCs: `identity-plus-poc/identity-zz-review2-poc.test.ts.txt` N-1 and N-1b; `api-zz-review2-poc.test.ts.txt`
  (variant C).
- **Should have been caught by.** The L2 first identity review, 11:25–11:46
  (`docs/orchestration/reviews/review-identity-plus.md`).
- **Why it was missed.**
  1. **Only one order of events was tested.** The first review tested attacks where the victim exists first and the
     attacker acts second. All 11 of its PoCs have that shape.
  2. **The review's own fix created the hole.** Its fix for P0-1, item (3), said "an email that *already* belongs to a
     global user must create an invited membership". That implicitly allowed org-set passwords for *new* emails.
     ADR-0017 §2 adopted it (`docs/adr/0017-…md:43`, "password can be set only when a brand-new global user is
     created"), and nobody attacked the recommended design before the fix round.
- **Checks added.**
  - Steward reviewer v2: **SR2-2** (reverse the order of events; attack the recommended fix).
  - Pattern **AP-08**.
  - Builder self-check v2: **BS2-1(a)**.
  - Canary **C-L2-08**.
- **Status.** ADR-0017 Amendment 1 (17:00); fix round 3 running; a third review is pending.

#### E-002 · P1 · D · `identity.sso.manage` alone is administrator-equivalent
- **Defect.** Holding this permission alone lets a user repoint the SSO issuer to an IdP they control. That IdP then
  asserts the org admin's email with MFA and gets a session as the admin.
- **Found.** L2 second review: R2-P1-1 (PoC N-2).
- **Should have been caught by.** The L2 first identity review. `configureSso` was already in scope there: first
  review P2-4 cites `sso.ts:329-381`. *(Estimate: the issuer-change path existed in round 1. That review's P2-4 shows
  `configureSso` was reachable.)*
- **Why it was missed.**
  - The first review found the same class for SCIM (P2-16: "`identity.scim.provision` is effectively the power to
    grant any mapped role") but did not generalize it to every other delegable permission.
  - There was no step that checks every delegable permission for privilege-equivalence.
- **Checks added.**
  - Steward reviewer v2: **SR2-3** (privilege-equivalence sweep).
  - Pattern **AP-09**.

#### E-011 · P2 · D · Error-code drift: `module_unavailable` vs `module_not_available`
- **Defect.** The payments merge brought a local stub whose error code was `module_unavailable`. Main uses
  `module_not_available`.
- **Found.** At merge, 12:19: commit `5c2b5ee` "one 'module_not_available' code for every unconnected module port",
  and `a35636d`.
- **Should have been caught by.** L2. The payments review (11:32) listed `unavailablePort` as a shared-code candidate.
  The finance review (11:42) stated the drift explicitly under "For the orchestrator": "The 'module not connected'
  error code differs between modules".
- **Why it was missed.**
  - It was **detected but not tracked**: it was a "note for the orchestrator" with no owner and no pending-fixes entry.
  - The kernel `ModuleUnavailableError` landed at 11:44 (`b8a6e75`), during payments' fix round, and nothing told
    payments to adopt it.
- **Checks added.**
  - Retro edit 4: every cross-module note becomes a pending-fixes entry with an owner.
  - Builder self-check v1, item 20, and pattern **AP-42**: import shared enums and errors, never copy them.
  - Queued for steward v3: cross-module notes are filed as findings.

#### E-025 · P2 · D · A form validation error shows raw JSON and harmful advice
- **Defect.** Saving a property with an empty name showed raw Zod JSON and told the user to "Reload the page", which
  loses their edits.
- **Found.** L4 tester, 12:17: `blackbox-findings.md` P7 "Error handling"; `screens/p7-09-empty-name-save.jpg`.
- **Should have been caught by.** The L2 backoffice review (11:33–12:02). Its brief asked it to check "problem+json
  rendering" (`archive/steward-reviewer-v1.md`, Part 3 context; backoffice launch brief (a)).
- **Why it was missed.** The review tested server problem documents and the conflict flow (P2-7) but never submitted
  invalid input to a form.
- **Checks added.** Steward reviewer v2: **SR2-5** (an invalid-input probe on every form). Pattern **UX-04/UX-05**.

#### E-026 · P2 · D · Selecting a live guest-profile search result does nothing
- **Found.** L4 tester, P2 "Search".
- **Should have been caught by.** The L2 backoffice review, which marked global search "Done for navigation and
  search" (`review-backoffice.md` spec-coverage table).
- **Why it was missed.** No step clicks every type of result or link.
- **Checks added.** Steward reviewer v2: **SR2-5** (click every result type and record link). Pattern **UX-01**.

#### E-027 · P1 · D · At 1024 px every page is 111 px too wide, and the drawer's Close button is off-screen on a tablet
- **Found.** L4 tester, P4 "Tablet layout".
- **Should have been caught by.** The L2 backoffice review.
- **Why it was missed.**
  - **The orchestrator's launch brief narrowed the scope.** It asked the reviewer to "judge layout priorities for real
    desk widths (1280–1920)". The housekeeping persona works on a tablet (`docs/product/personas-and-workspaces.md`).
  - The reviewer measured 1280 to 1920 only (P1-4).
- **Checks added.** Steward reviewer v2: **SR2-5** (a viewport matrix from the personas: 390, 768, 1024, 1280, 1440
  and 1920). Pattern **UX-07**.

#### E-028 · P2 · D · The UI does not reflect permissions honestly
- **Defect.**
  - The forbidden page still shows "Invite staff member".
  - The invite form defaults to "Whole organization", the riskiest choice.
- **Found.** L4 tester: P7 and "Cross-cutting checks", `x-04-forbidden.png` (see E-032).
- **Should have been caught by.** The L2 backoffice review.
- **Why it was missed.** The review had no role-based probe of what the UI offers, and no check of least-privilege
  defaults.
- **Checks added.** Steward reviewer v2: **SR2-5** (role × screen probe; risky defaults). Pattern **UX-09**.

#### E-029 · P2 · D · The housekeeping supervisor can open the arrivals workspace by URL
- **Defect.** The workspace shows guest names and payment status, though it is not in that role's navigation.
- **Found.** L4 tester, "Possible permission gap". The data was simulated, so server-side refusal must be re-verified
  once the screens are wired.
- **Should have been caught by.** The L2 backoffice review.
- **Why it was missed.** No step requests each route as a role that should not see it.
- **Checks added.** Steward reviewer v2: **SR2-5** (role × route). Pattern **AP-05/UX-09**.

#### E-030 · P2 · D · Radio buttons in the organization chooser are announced by UUID
- **Found.** L4 tester, P7.
- **Should have been caught by.** The L2 backoffice review. It ran a full axe pass, but axe accepts any non-empty
  accessible name.
- **Why it was missed.** There was no check that accessible names are free of ids and codes.
- **Checks added.** Steward reviewer v2: **SR2-5** (accessible-name sweep). Pattern **UX-13**.

#### E-031 · P2 · D · Developer language and i18n keys are shown to staff
- **Defect.** Examples: `common.loading`, "wave 1 in progress", "(scenario S03)", "demo-seeder", permission codes,
  "Reference: client".
- **Found.** L4 tester, top-20 friction #13.
- **Should have been caught by.** The L2 backoffice review. It caught only the raw role keys (P3-4).
- **Why it was missed.** There was no check of the visible text.
- **Checks added.** Steward reviewer v2: **SR2-5** (copy sweep). Pattern **UX-04**. The refiner's NAV-09 proposes a
  CI copy lint.

#### E-037 · P3 · Pr · A reviewer's gate run wrote into another agent's worktree
- **Defect.** The finance review ran `node tools/parity-report.mjs`, which regenerated `docs/parity/COVERAGE.md` inside
  `/home/user/wt/parity-finance`, where a researcher was still working.
- **Found.** Self-reported in the finance review's final report ("Running the parity gate rewrote the generated
  `docs/parity/COVERAGE.md`… (the tool always does)").
- **Should have been caught by.** L2: the brief says "Do NOT modify any files in the worktree under review", but it
  says nothing about *other* worktrees or about tools with side effects.
- **Checks added.** Steward reviewer v2, an editorial clarification: run tools only in your own scratch copy.

### L1-BSC — the builder's self-check (fix rounds) should have caught it

These five came out of the identity-plus fix round. Only one other module has had a second review so far (see the
retro, improvement 1).

#### E-003 · P1 · D · A pre-created SSO link skips the verified-domain gate, and a failed JIT sign-in commits the user and the link
- **Found.** L2 second review: R2-P1-3 (PoC N-7).
- **Should have been caught by.** The builder's self-check in fix round 2. The verified-domain gate was added in that
  round (`sso.ts:686-734`) and placed only on the "no link yet" branch. Also `fail()` returns, and the transaction
  commits.
- **Why it was missed.**
  - The guard was added to one branch of a state machine.
  - The failure path was never checked for partial commits.
- **Checks added.**
  - Builder self-check v2: **BS2-1(b)** (every branch) and **BS2-1(c)** (failure path commits nothing).
  - Patterns **AP-45** and **AP-46**.

#### E-004 · P1 · D · Any organization can permanently block a new person from joining another organization
- **Found.** L2 second review: R2-P1-2 (PoC N-5).
- **Should have been caught by.** The builder's self-check in the fix round. The refusals came from the ADR-0017 fix
  (`sign_in_to_accept`, the active-only `login_lookup`).
- **Why it was missed.** The fix was tested against takeover only. Nobody asked "can the attacker trigger this new
  refusal against a legitimate person?"
- **Checks added.** Builder self-check v2: **BS2-1(d)** (griefing probe). Pattern **AP-47**.

#### E-005 · P2 · D · The per-person second-factor counter is a check-then-act race
- **Found.** L2 second review: R2-P2-1. Eight of eight wrong codes were checked concurrently.
- **Should have been caught by.** The builder's self-check: the counter was the fix for P1-7.
- **Why it was missed.** The new limit has no concurrent test.
- **Checks added.** Builder self-check v2: **BS2-1(e)** (new counters are reserved atomically and tested
  concurrently). Patterns **AP-12/AP-36**.

#### E-006 · P2 · D · `transferMember` bypasses power ordering and property scope
- **Found.** L2 second review: R2-P2-2 (PoC N-6).
- **Should have been caught by.** The builder's self-check. Power ordering was added to revoke, suspend, remove and
  both resets for P1-6, but not to transfer.
- **Why it was missed.** The fix covered the paths the review named, not their siblings.
- **Checks added.**
  - Builder self-check v2: **BS2-1(b)** (sibling sweep).
  - Steward reviewer v2: **SR2-4**.
  - Pattern **AP-45**.

#### E-007 · P2 · D · SSO or SCIM group reconciliation can remove the last administrator
- **Found.** L2 second review: R2-P2-3 (PoC N-8).
- **Should have been caught by.** The builder's self-check. Last-admin protection was added to SCIM user
  deactivation, but not to group reconciliation.
- **Why it was missed.** Same as E-006.
- **Checks added.** Same as E-006.

#### E-017 · P3 · G · Lockfile drift after merging main breaks `pnpm install --frozen-lockfile`
- **Found.**
  - L2 backoffice review, in its merge simulation ("the merged `pnpm-lock.yaml` breaks
    `pnpm install --frozen-lockfile`").
  - Also listed among merge-time failure causes in `04-turning-points-and-lessons.md`.
- **Should have been caught by.** The builder's self-check. The branch was 91 commits behind main.
- **Why it was missed.** v1 asked builders to merge main only in fix rounds, and did not ask for the frozen install
  after the merge.
- **Checks added.** Builder self-check v2, gate block: merge main, then run the frozen install. Fixed by `0445c3f` in
  the fix round.

#### E-018 · P3 · G · A duplicate import appeared after merging
- **Found.** At merge (orchestrator). It is listed in `04-turning-points-and-lessons.md` § "Verify on a merged copy".
  The commit is not identified, so the evidence is weak.
- **Should have been caught by.** The builder's self-check, by running the gates on the merged tree.
- **Checks added.** Builder self-check v2, gate block (the same as E-017).

### L1-gate — the gates or shared tooling should have caught it

#### E-008 · P1 · G · A kernel enum change broke typecheck on main, hidden by the turbo cache
- **Defect.** The payments merge added `'sandbox'` to the kernel `Provenance` type (`4a058bb`, 12:15). Inventory's and
  payments' contracts each held their **own copy** of the provenance enum, and the cached typecheck passed.
- **Found.** By the orchestrator at merge, one minute later: `48bbc80` "typecheck was masked by the turbo cache".
  `a910cff` then fixed the formatting of that same fix (see E-010).
- **Should have been caught by.** The L1 gate on the commit that changed the kernel.
- **Why it was missed.**
  - **RC-1:** `turbo.json` gave `typecheck` `dependsOn: []`, so a kernel change did not invalidate the dependents'
    cache.
  - **RC-2:** the enum was duplicated instead of imported.
  - **RC-3:** the backoffice review had noted at 12:02, 13 minutes earlier, that "provenance alone has four
    definitions today, and none includes `sandbox`". It was a note, not a tracked fix.
- **Checks added.**
  - Turbo inputs fixed in `1be3ddc` (17:00).
  - Builder self-check v2 gate block.
  - Pattern **AP-42**.
  - Canary **C-L1-01** (gate self-test).
  - Proposed lint rule against duplicated closed enums (retro, edit 5).

#### E-009 · P2 · G · A data-authority domain type mismatch was hidden by the cache on the identity-plus branch
- **Defect.** Platform's view grew to 10 domains (`guestCommunications`), while integration's own enum had 9. As a
  result, `modules/integration/test/harness.ts:102-103` failed with TS2322.
- **Found independently twice.**
  - By the builder, with a forced run: "exposed a type error that my earlier typecheck had missed because turbo served
    it from cache" (identity-plus report, 16:26).
  - By the second review (R2-P2-6): `pnpm typecheck` printed "FULL TURBO 16 cached" and exited 0 at `09d010c`, while
    `--force` failed.
- **Should have been caught by.** The builder's first unforced gate, at its second merge of main.
- **Why it was missed.** RC-1 and RC-2: integration kept its own copy of the domain enum.
- **Checks added.** As for E-008. The builder fixed it in platform (`cf913b2`).

#### E-010 · P3 · G · Lint failures were committed to main
- **Defect.** Commits went to main while lint was failing, and a "style:" fix-up followed each time.
- **Occurrences.**
  - Git shows four fix-up commits: `9deb5a0` (07:36), `82b004a` (08:18), `a910cff` (12:16) and `2700984` (16:41,
    generated chronicle JSON).
  - The chronicle counts three incidents (`04-…lessons.md` § "Pipe output hides failures").
- **Found.** At the next lint run, by the orchestrator.
- **Should have been caught by.** The L1 commit gate.
- **Why it was missed.** Lint output was piped through `tail`, so the exit code was lost. A pre-commit hook was declined
  by the session's safety policy.
- **Checks added.**
  - `tools/commit-checked.sh` (`1241174`, 16:41).
  - Builder self-check v2: read every exit code; never pipe gate output.

#### E-012 · P2 · G · The module-boundary checker reported a false positive
- **Defect.** The checker read `${input.operations.length}` inside a `sql` template as a reference to the `operations`
  schema.
- **Found.** By the operations builder after merging main, when lint failed (its FR-1, 11:56). Fixed centrally in
  `a277666`.
- **Should have been caught by.** L1: the tool's own tests. `tools/check-boundaries.mjs` shipped without any corpus of
  positive and negative cases.
- **Checks added.** Canary **C-L1-03** (the tool must accept known-good interpolations and reject a planted
  cross-schema reference). Retro improvement 4: shared gate tools get tests.

#### E-013 · P3 · G · The permission-catalogue test reported a false positive on a doc comment
- **Defect.** `apps/api/test/permission-catalog.test.ts` flagged `requirePermission(ctx, 'finance.posting.correct')`
  inside a comment in `modules/identity/src/domain/step-up.ts:5`.
- **Found.** By the L2 first identity review, in its merge simulation (P1-1).
- **Should have been caught by.** L1: the test itself. It parses source text without skipping comments.
- **Checks added.** Canary **C-L1-03** (tooling false-positive corpus). Fixed by rewording the comment; the tool
  itself was not changed (residual risk).

#### E-014 · P1 · G · A permission was checked but never registered
- **Defect.** `platform.dataAuthority.manage` was checked but never registered, so only org admins could change data
  authority.
- **Found.** By the integration builder (its FR-1). Fixed in `8d58366`, 11:20, which also added
  `permission-catalog.test.ts`.
- **Should have been caught by.** L1 on the foundation commit. The orchestrator built the platform module, and no
  catalogue test existed yet.
- **Checks added.** The catalogue test (L1, done). Builder self-check v1, item 8.

#### E-015 · P2 · G · The demo-seed test timed out under parallel test runs
- **Defect.** The test took about 2.5 s alone, 15 s under turbo's default concurrency of 10 on 4 CPUs, and hit the
  30 s limit in some runs.
- **Found.** By the identity builder at 16:26: `turbo run test --force` failed twice in three runs. Fixed by `38ccff8`
  (120 s budget).
- **Should have been caught by.** L1 at each merge that registered another module's demo seed.
- **Why it was missed.**
  - **RC-8:** the merge gate uses `pnpm test` (`--concurrency=2`), while the fix-round and integration-step briefs
    asked for `pnpm turbo run test --force` (default concurrency). The test's budget was never checked under the
    stricter command.
  - The demo seed grows with every module.
- **Checks added.**
  - Builder self-check v2 runs both commands.
  - Scenario tests v2 **ST2-3** (record the slowest tests and their budgets).

#### E-016 · P2 · G · Test-database drop race (flaky `57P01`)
- **Defect.** Dropping a test database raced with open pool connections.
- **Found.**
  - By the inventory builder (its FR-1).
  - As a flaky first run in the guests review: "terminating connection due to administrator command" (57P01).
  - Fixed on main in `b484de3`, 08:23.
- **Should have been caught by.** L1: the foundation harness's own tests. `packages/testing` has **0 test files**
  (`05-metrics.md`, per-package table).
- **Why it was missed.** There is no flake detection: nobody re-runs the suites. The guests reviewer only saw it by
  re-running 4 times.
- **Checks added.**
  - Steward v3 (queued): re-run failing suites and report the flake rate.
  - Scorecard: a flaky-test count is tracked for L1.

#### E-038 · P2 · G · *Latent:* the turbo cache key still ignores `apps/*` sources
- **Defect.**
  - `apps/worker/src/main.ts:5` imports `compose` and `loadConfig` from `@portico/api`.
  - After the fix in `1be3ddc`, the `typecheck` and `test` inputs in `turbo.json` list `packages/*/src` and
    `modules/*/src`, but not `apps/*/src`.
  - `turbo run typecheck --filter=@portico/worker --dry=json` lists 404 hashed inputs for `@portico/worker#typecheck`:
    362 from `modules/`, 38 from `packages/`, its own files, and **0 from `apps/api`**. This was run read-only in this
    worktree; the output is in the session scratchpad as `turbo-dry.json`.
  - So a change to `compose` in `apps/api/src` can leave the worker's cached typecheck green.
- **Found.** L8, this round. It is latent: no missed error has been traced to it yet.
- **Should have been caught by.** L1, when the RC-1 fix was verified. That fix was verified only with a kernel edit.
- **Checks added.**
  - Canary **C-L1-01**: the gate self-test edits one source in each of `packages/`, `modules/` and `apps/`.
  - Proposed `turbo.json` edit (retro, edit 6).
  - The merge gate keeps `--force` for typecheck (STATUS.md § 5) until the self-test passes.

### L4 — the UX loop should have caught it

#### E-032 · P3 · Ev · Six cited screenshots were missing from the repository
- **Defect.** The findings cite `x-01-dark-arrivals.png`, `x-02-dark-record.png`, `x-03-account-menu.png`,
  `x-04-forbidden.png`, `x-05-404.png` and `x-06-bad-record.png`. None of them are in `docs/ux/round-1/screens/`.
- **Found.** By the refiner (`summary.md` § "Evidence gaps", item 1).
- **Should have been caught by.** The L4 hand-off, when the orchestrator copied the tester's output into the
  repository.
- **Why it was missed.**
  - The tester's originals **exist**: `ux-round1/x-0[1-6]*.png` in the session scratchpad, verified this round.
  - Commit `3749673` ("compressed screens") converted and copied the `p*`/`01-*` files into `screens/*.jpg` and
    rewrote their references. The `x-*` files, which the tester had cited without a `screens/` prefix, were skipped.
  - Nothing checked that every cited file existed after the copy.
- **Checks added.**
  - Black-box tester v2 **BT2-3** (evidence manifest).
  - Black-box tester v2 orchestrator hand-off checklist (H-1: cited-file check after any copy or compression).
  - Retro edit 7 (copy the six files now, while the scratchpad still exists).

#### E-033 · P3 · Ev · A screenshot shows only loading placeholders
- **Defect.** `screens/p1-03-today-full.jpg` shows loading placeholders only. It is cited for "the first ~830 px are
  banner, checklist and notice".
- **Found.** By the refiner (evidence gap 2).
- **Should have been caught by.** The L4 tester's self-check. The image was captured before the page had loaded.
- **Checks added.** Black-box tester v2 **BT2-2** (capture only after content is present; open every screenshot you
  cite).

#### E-034 · P3 · Ev · A cited screenshot shows a different state from the one claimed
- **Defect.**
  - `screens/p2-08-live-guest.jpg` is byte-identical to `p2-01-home.jpg` (MD5 `1325c86a…`). The tester's original
    PNGs `p2-01-home`, `p2-04-kowal` and `p2-08-live-guest` share MD5 `0d341706…`.
  - The finding claims the image shows a live guest result in the search palette. It shows the arrivals page with no
    palette open.
  - The refiner then cited it again as evidence for GST-01 (`refinements/guests.md:28`).
- **Found.** L8, this round.
- **Should have been caught by.** The L4 tester's self-check first, then the refiner's evidence check.
- **Why it was missed.**
  - The palette state was captured after the palette had closed.
  - Neither agent opened the image it cited. The refiner did open others (it caught E-033).
- **Checks added.**
  - Black-box tester v2 **BT2-2** (duplicate-hash check).
  - Refiner v2 **UR2-1** (open every screenshot you cite).
  - Retro edit 7 (mark the evidence as invalid in round 1; re-capture it in round 2).

#### E-035 · P3 · Ev · Findings had no stable IDs
- **Found.** By the refiner (evidence gap 3): "Ask the tester to number them (`P1-F03`) so decisions can cite them
  exactly".
- **Should have been caught by.** The L4 tester brief, which did not ask for IDs.
- **Checks added.** Black-box tester v2 **BT2-1**.

#### E-036 · P3 · Pr · The refiner's summary write was refused
- **Defect.** The harness refused the write of `summary.md` with "Subagents should return findings as text, not write
  report files" (refiner transcript, tool error). The orchestrator committed the summary verbatim (`fca21b3`).
- **Found.** At delivery.
- **Should have been caught by.** The L4 refiner brief, which asked for a file the harness classifies as a report.
- **Checks added.** Refiner v2 **UR2-2** (return the summary in the final reply as well; if a write is refused, put the
  full text in the reply with its target path).

### L5 — market, parity and research should have caught it

#### E-019 · P1 · C · Parity rows were marked `tested` for behaviour that was not built or not proven
- **Defect.**
  - Finance review F-12: "several parity rows are marked `tested` for things that are not built". The pending-fixes
    list names PAR-FIN-132/133 among them.
  - Payments review P2-13: PAR-PAY-006 `tested` despite the MIT bypass; EC-PAY-015 "sequential only"; EC-PAY-012 a DB
    check; PAR-PAY-009 simulator-only.
  - The payments builder corrected four overclaims.
- **Found.** L2 reviews, 11:23–11:42.
- **Should have been caught by.** The L5 parity researchers.
- **Why it was missed.**
  - The mid-run instruction asked the researchers to compare against unmerged branches
    (`archive/parity-researcher-v1.md`, Part 3).
  - `tested` was set from test names, not from what the tests assert.
  - An overclaimed P0 row lets the parity gate pass.
- **Checks added.** Parity researcher v2 **PR2-1**.

#### E-020 · P2 · C · Rates edge-case catalogue lacked the failure classes the review found
- **Defect.** After the review, the rates builder added 6 capabilities (PAR-RAT-088…093) and 16 edge cases
  (EC-RAT-036…051) "for the guarantees from the review". The catalogue went from 35 to 51 edge cases: 31 % were added
  after the review.
- **Found.** L2 rates review, then the builder's fix round.
- **Should have been caught by.** L5 parity (front cluster).
- **Why it was missed.** RC-7: the edge cases came from competitor documentation and Maldives realities, not from
  failure classes such as snapshot drift, boundary values and concurrency.
- **Checks added.** Parity researcher v2 **PR2-2** (sweep the failure classes in `patterns.md`).

#### E-021 · P2 · C · Payments catalogue lacked the failure classes the review found
- **Defect.** The builder added 8 capability rows and 13 edge cases. Examples: webhook processing failure, concurrent
  desk charges, a payment link plus a desk deposit, net-of-fee settlement, refund after a negative adjustment, a
  cross-property folio, an account claimed twice, and an environment change with a pending intent. The catalogue went
  from 54 to 67 edge cases: 19 % were added after the review.
- **Found.** L2 payments review, then the fix round.
- **Should have been caught by.** L5 parity (finance cluster).
- **Why it was missed.** RC-7.
- **Checks added.** Parity researcher v2 **PR2-2**.

#### E-022 · P1 · C · The inventory matrix missed real P0 capabilities and edge cases
- **Defect.** The missing items were:
  - a house total across unit types;
  - protecting accessible units from casual reassignment;
  - a preview of the stays affected when a unit leaves inventory;
  - availability beyond 400 nights;
  - the allowance-expiry edge case;
  - the external-maintenance edge case.
- **Found.** L2 inventory review, INV-08.
- **Should have been caught by.** L5 parity (front cluster).
- **Why it was missed.** RC-7. The matrix was also written before the code existed ("Code on main: none").
- **Checks added.** Parity researcher v2 **PR2-2**.

#### E-023 · P1 · D · The Maldives tax rule pack had no TGST history before 2023
- **Defect.** The earliest TGST version (16 %) had no start bound, so a 2021 supply would be taxed at 16 % instead of
  12 %.
- **Found.** L2 rates review, R-19 ("I have not verified R-19 … someone should confirm"). Confirmed and fixed in
  `944ff0f` (11:24): `maldives-tax-rules.md` now has TGST 12 % for 2014-11-01 → 2022-12-31.
- **Should have been caught by.** L5 research (`b87d0f7`, 07:50), and the builder.
- **Why it was missed.** The research recorded the current rate and one step back only. An open-ended earliest
  version of an effective-dated rule was not treated as a defect.
- **Checks added.**
  - Pattern **AP-48** (effective-dated data has explicit bounds).
  - Parity researcher v2 **PR2-2** covers it through that class.
  - Builder self-check v2 references AP-48.

#### E-024 · P0 *(est.)* · C · The owner found that the scope was missing keys and the whole guest stay
- **Defect.** 07:58, owner: "that's an important thing you missed… go through an entire guest stay"
  (`03-owner-directions.md`; timeline 07:58–08:10). The audit that followed found 235 touchpoints and 5 new module
  specs.
- **Found.** L7, by the owner.
- **Should have been caught by.** L5: the product strategy and capability catalogue (07:07–07:52), which produced 18
  module specs.
- **Why it was missed.** RC-7: the catalogue was built module by module. Nobody walked a guest's stay, or a staff
  member's day, from end to end.
- **Checks added.** Gap strategist v2 **GS2-1** (journey walks with "no owner" gaps).

---

<!-- Round 1 entries go below this line: "## Round 1 — <date>" -->
