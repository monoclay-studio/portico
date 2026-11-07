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
  usage; L7 = owner; L8 = meta loop (this file's author). **L-orch** (added in round 1) = the orchestrator's own process
  steps: briefs, mid-run messages, hand-offs, commits, merges and records (`playbooks/orchestrator.md`).
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

**Reclassification (round 1, 2026-11-07).** The orchestrator became a measured loop in round 1, so five round-0
entries whose earliest point was an orchestrator step now count under **L-orch**:
- E-010, the commit step (from L1-gate);
- E-027, the review brief (from L2);
- E-032 and E-036, the hand-off and the brief (from L4);
- E-019, the mid-run instruction (from L5).

Before reclassification, round 0 read L1-gate 9 / L1-BSC 7 / L2 11 / L3 0 / L4 5 / L5 6.

| Loop | Round 0 (reclassified) | Round 1 | Round 2 | Cumulative | Round-2 entries |
|---|---|---|---|---|---|
| L1-gate | 8 | 2 | **1** | 11 | E-079 |
| L1-BSC (builder self-check, incl. fix rounds) | 7 | 13 | **15** | 35 | E-063, E-064, E-066, E-068, E-069, E-070, E-071, E-072 (residuals of round-0 fixes); E-075, E-076, E-077, E-078 (integration-step fix round); E-082, E-084, E-085 (guests fix round) |
| L2 steward review | 10 | 3 | **5** | 18 | E-065, E-067, E-083 (recall misses of round-0 reviews; L8 contributed to E-083); E-073, E-074 (recommendation defects of a v1-era review) |
| L3 scenario proof | 0 | 1 | **0** | 1 | — |
| L4 UX loop | 3 | 0 | **0** | 3 | No L4 round ran |
| L5 market, parity and research | 5 | 1 | **0** | 6 | — |
| L-orch (orchestrator process) | 5 | 3 | **2** | 10 | E-080, E-081 |
| L8 meta loop | 0 | 1 | **0** | 1 | — |
| **Total** | **38** | **24** | **23** | **85** | |

### By where they were found

| Found by | Round 0 | Round 1 | Round-1 entries |
|---|---|---|---|
| L1 at merge time (orchestrator) | 4 | 2 | E-053, E-054 (backoffice merge verification) |
| L1 builder gate runs | 5 | 0 | — |
| L2 first-round reviews | 7 | — | — |
| L2 re-reviews (identity-plus 2 and 3) | 7 | 6 | E-047 … E-052 |
| L2 integration-step review | — | 8 | E-039 … E-046 |
| L4 black-box tester | 7 | 0 | — |
| L4 refiner or the delivery step | 4 | 0 | — |
| L5 gap strategist | — | 2 | E-060, E-061 |
| L7 owner | 1 | 0 | — |
| L8 meta loop | 2 | 4 | E-056, E-058, E-059, E-062 (three of them by scripted canary or static scan) |
| The orchestrator about its own process | — | 2 | E-055, E-057 |
| The checker itself (self-reported) | 1 | 0 | — |

**Round 2 by where found:**
- the L2 fix sweep: 10 (E-063 … E-072);
- the L2 integration-step re-review: 6 (E-073 … E-078);
- the orchestrator's merge verification: 1 (E-079);
- the orchestrator about its own process: 2 (E-080, E-081);
- the L2 guests erasure re-review: 4 (E-082 … E-085).

### By severity and kind

| | D (R0 / R1) | G | C | Ev | Pr | Total R0 | Total R1 |
|---|---|---|---|---|---|---|---|
| P0 | 1 / 0 | — | 1 / 0 | — | — | 2 | **0** |
| P1 | 5 / 5 | 2 / 0 | 2 / 0 | — | — | 9 | **5** |
| P2 | 10 / 7 | 5 / 3 | 2 / 3 | — | 0 / 1 | 17 | **14** |
| P3 | — / 2 | 4 / 0 | 0 / 1 | 4 / 1 | 2 / 1 | 10 | **5** |
| **Total** | 16 / 14 | 11 / 3 | 5 / 4 | 4 / 1 | 2 / 2 | **38** | **24** |

"Fix-related" escapes in round 1 are those a fix introduced, or a fix left incomplete, or that a reviewer's own
recommended fix caused. There are **12 of 24**:
- incomplete or residual fixes: E-039, E-044, E-045, E-046, E-049, E-053, E-054, E-062;
- introduced by the fix: E-047;
- caused by the recommendation: E-048, E-050, E-051.

**Round 2 by severity:** P0 0, P1 7, P2 12, P3 4. **By kind:** D 18, G 2, C 1, Pr 2.

**Round 2, fix-related: 17 of 23 (74 %).**
- Residuals of round-0 fixes: 8 (sweep).
- Introduced or missed by the integration-step fix round: 4.
- Introduced by the guests fix round: 3.
- Recommendation-induced: 2.

The trend is 7 of 38 → 12 of 24 → 17 of 23. As P0/P1 classes close, the remaining defects come increasingly from
fixes.

### Root causes shared by several escapes

| Root cause | Escapes | Main fix |
|---|---|---|
| **RC-1.** The turbo cache key ignored workspace dependencies (fixed in `1be3ddc`). `apps/*` sources are still not hashed (E-038). | E-008, E-009, E-038 | Forced gates; turbo inputs; L1 gate self-test canary `C-L1-01` |
| **RC-2.** A closed enum or error code is copied into each module instead of imported. | E-008, E-009, E-011; round 1: E-054, E-058, E-062 | Builder self-check; pattern `AP-42`; proposed lint rule |
| **RC-3.** A review's cross-module "notes for the orchestrator" have no owner and no tracking. | E-008, E-011 | Merge-procedure edit (retro, edit 4) |
| **RC-4.** A fix is applied to the named path only: no sibling, reverse-order, failure-path or abuse probe. | E-001, E-003, E-004, E-005, E-006, E-007 | Builder self-check v2; steward v2 SR2-2 and SR2-4 |
| **RC-5.** The UI review scope was narrower than the personas' reality (viewports, invalid input, roles, results). | E-025 … E-031 | Steward v2 SR2-5 |
| **RC-6.** Evidence is not verified before it is handed off. | E-032, E-033, E-034, E-035 | Black-box tester v2; refiner v2; hand-off checklist |
| **RC-7.** The catalogue is built from features, not from failure classes. | E-020, E-021, E-022, E-024 | Parity v2 PR2-2; gap strategist v2 |
| **RC-8.** The gate command differed from one brief to the next. | E-010, E-015 | Builder self-check v2 runs the gate as CI runs it |
| **RC-4 (round 1).** It recurred as the main source: residuals of merged fixes (E-039, E-045, E-046), sibling paths (E-044, E-049, E-053, E-054) and races in fix code (E-047) | 8 in round 1 | Builder self-check v2 § 3 (first used by the round-2 fix rounds); orchestrator v3 (re-check P1 fixes, audit exemptions) |
| **RC-9.** A reviewer's fix recommendation was given as a list rather than a principle, or made a known weakness load-bearing, and was never attacked itself | E-001, E-048, E-050, E-051 | Steward v2.1 (SR2-2 clarified) |
| **RC-10.** A test exercises the path but asserts neither the outcome nor the claim | E-041, E-042, E-043, E-044 | Pattern AP-55; scenario tests v2 ST2-2; builder self-check v1 items 31–32 |
| **RC-11.** The test environment is not the production environment: superuser migrations, a single e2e port, Playwright outside the gate | E-052, E-053 | Retro edits 3c and 1c; orchestrator v4 queued |
| **RC-12.** The orchestrator passed things on or recorded them inexactly: paraphrased claims, broad commits, estimated times, generated files not refreshed | E-043 (contributing), E-055, E-057, E-060 | Orchestrator v2 (O2-1…O2-4) |
| **RC-13 (round 2).** A fix guards the reported *path*, not the *invariant*. The writers of the facts it trusts (premises), the inverse and repeated operations, the other record parameters, the other stores and the fix's own records are never enumerated | E-063, E-066, E-067 (stores), E-070, E-073, E-074, E-075, E-076, E-077 | Builder self-check **v4** (invariant closure); patterns AP-57 and AP-58 |

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
     attacker acts second. All five of its cross-organization PoCs start from a victim who already has an identity:
     "a trial-org admin resets the global password of a live-org GM", "strips the MFA of a live-org member",
     "createUser … on an existing password-less global user", the wave-0 existing-person case, and the SSO PoC
     (`reviews/identity-plus-poc/*review-poc*`, `*sso-poc*`).
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
- *Note (round 1, 2026-11-07):* times corrected (E-056). The second review ran **16:15–16:43**, and ADR-0017
  Amendment 1 is dated **16:43**, not 16:42–16:52 and 17:00. Both come from commit and transcript timestamps.

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
  - Pattern **AP-42** (import shared enums and errors, never copy them). Builder self-check v3, theme "contract
    drift", is queued.
  - Queued for steward v4: cross-module notes are filed as findings.

#### E-025 · P2 · D · A form validation error shows raw JSON and harmful advice
- **Defect.** Saving a property with an empty name showed raw Zod JSON and told the user to "Reload the page", which
  loses their edits.
- **Found.** L4 tester, 12:17: `blackbox-findings.md` P7 "Error handling"; `screens/p7-09-empty-name-save.jpg`.
- **Should have been caught by.** The L2 backoffice review (11:33–12:02). Its brief asked it to check "problem+json
  rendering" (backoffice launch brief, item (a), in `docs/chronicle/agents/20261107T1133-steward-review-backoffice-ui.md`).
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
- *Note (round 1, 2026-11-07):* reclassified. The earliest loop is now **L-orch**: the launch brief set
  1280–1920, and the reviewer followed it. Check now in orchestrator O2-1 (scope parameters come from the personas).

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

E-003 to E-007 came out of the identity-plus fix round. No other module has had a second review, so the fix rounds of
the 8 merged modules are unchecked for this class (retro, improvement 1).

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
- *Note (round 1, 2026-11-07):* `1be3ddc` was committed at **16:44**, not 17:00 (E-056). The residual hole E-038 was
  closed by the round-0 edit 6, and canary C-L1-01 was caught at 17:30.

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
- *Note (round 1, 2026-11-07):* reclassified. The earliest loop is now **L-orch** (the orchestrator's commit step).
  The orchestrator counts three incidents before `tools/commit-checked.sh` existed; git shows four fix-up commits.
  Check now in `playbooks/orchestrator.md` O2-2.

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
    rewrote their references; the tester's original report cited bare `.png` names. The `x-*` files were neither
    copied nor rewritten, and their references still read `x-0N-….png`. *(Inferred from the commit's file list and
    the committed text; the copy command itself is not recorded.)*
  - Nothing checked that every cited file existed after the copy.
- **Checks added.**
  - Black-box tester v2 **BT2-3** (evidence manifest).
  - Black-box tester v2 orchestrator hand-off checklist (H-1: cited-file check after any copy or compression).
  - Retro edit 7 (copy the six files now, while the scratchpad still exists).
- *Note (round 1, 2026-11-07):* reclassified. The earliest loop is now **L-orch** (the hand-off). The six files were
  restored at 17:28 (`8ed5bf8`). Check now in orchestrator O2-3.

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
- *Note (round 1, 2026-11-07):* reclassified. The earliest loop is now **L-orch** (the brief asked for a file type
  the harness refuses). Check now in orchestrator O2-1.

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
- *Note (round 1, 2026-11-07):* reclassified. The earliest loop is now **L-orch**, because the evidence rule was
  changed by the orchestrator's mid-run instruction. Check now in orchestrator O2-1 (no evidence-rule changes in
  mid-run messages).

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

## Round 1 — 2026-11-07, 17:04–17:38 UTC (the integration-step review, identity review 3, the backoffice merge verification, the orchestrator's process)

Sources:
- `docs/orchestration/reviews/review-integration-step.md` and `integration-step-poc/`;
- `review-identity-plus-3.md` and `identity-plus-poc/*review3*`;
- `docs/orchestration/pending-fixes.md` (the backoffice entry);
- `docs/chronicle/04-turning-points-and-lessons.md` §§ "Process lessons" and "Corrections";
- `docs/chronicle/agents/20261107T1616-integration-step-bind-module-ports.md` (the builder's report);
- `docs/chronicle/agents/20261107T1642-gap-strategist-10x-module-briefs.md`;
- `git log main`;
- the canary run `r1-l1` (`canaries.md` § 6).

**Classification rule added this round.** From round 1, a defect found by L2 counts as an **L1-BSC escape** in two
cases:
- its class was already in the builder's brief or self-check (for example the integration step's own "refusal test
  (wrong property …)" requirement, or v1 items 6, 16–18 and 31–32);
- it is a residual of an earlier fix.

Defects of a class nobody had listed still go into the self-check as new classes.

**Playbook versions in force.** Both reviews launched (17:04 and 17:09) before steward v2 was published (17:20 on
`docs/quality`, merged 17:26). The integration step (16:16) and identity fix round 3 started before builder self-check
v2 existed. So **no v2 playbook was used in round 1**, and the v2 effect is still unmeasured.

### L1-BSC — the builder's self-check, or an earlier fix round

#### E-039 · P1 · D · A booking deposit is never checked against the property that owns the booking
- **Found.** L2 integration-step review, P1-1 (PoC `poc-deposit-wrong-property`). A desk agent at Hiyani posted a
  deposit to Kandu's booking, at legal entity B. A deposit for a booking that does not exist anywhere was also
  accepted. Kandu's check-in then threw 403.
- **Should have been caught by.** L1-BSC, at two points:
  - **The round-0 payments and finance fix rounds.** Their P0-1 fix (cross-property posting) added `describeTarget`
    checks for folios, but **exempted bookings**: `payments/src/service/shared.ts:149`
    `if (ref.type === 'booking') return; // first deposit…`, and finance `assertTargetInScope`, "a booking without any
    finance record yet is accepted".
  - **The integration step.** Its brief required "a refusal test (wrong property …)" for every binding.
- **Why it was missed.**
  - The fix covered the path named in the finding (folios), and the exemption was never attacked (RC-4).
  - The stub hid it until binding made it live.
  - The P0 fix was merged without a re-attack, because the re-attack rule applied only from round 0's edits onward.
- **Checks added.**
  - Orchestrator v3 (queued): re-check **P1 and P0** fixes and audit exemptions.
  - Retro edit 1: run the sweep now.
  - Pattern AP-01, extended (booking refs, "first X accepted" exemptions).
  - Canary C-L2-01.

#### E-040 · P1 · D · Check-in can place a hold of any amount on any saved card, with no payments permission
- **Found.** L2 integration-step review, P1-2 (PoC `poc-checkin-any-card`): USD 25,000 held on another guest's card by
  a role with no `payments.*` key.
- **Should have been caught by.** L1-BSC, the integration engineer. Applying ADR-0015, it listed which effects stay
  explicit (refunds, overbooking, house use, lock override) but not **which card** or **how much**.
- **Why it was missed.**
  - A delegated port call accepts parameters chosen by the caller, and those parameters carry the risk.
  - ADR-0015 §5 does not name *whose* key gates an explicit effect. The orchestrator wrote the ADR, so L-orch
    contributed.
- **Checks added.**
  - New pattern **AP-53** (delegation widens authority through caller-chosen effect parameters).
  - Canary **C-L2-16**.
  - Retro edit 6 (ADR-0015 §5 wording).

#### E-041 · P1 · D · A late-charge collection asks a guest in credit to pay money they do not owe
- **Found.** L2 integration-step review, P1-3 (PoC `poc-late-charge-overcollect`). A payment request for 11,700 was
  opened while the folio stood at −38,300.
- **Should have been caught by.** L1-BSC. The builder's own binding test (`bindings.test.ts`, the "late spa charge"
  step) **ran this path, and over-collected** 64,000 against a 14,000 debt, but it asserted neither the amount nor
  the outcome.
- **Why it was missed.** RC-10: the test exercised the path but asserted nothing. AP-28 (collecting money twice) did not
  name over-collection against existing credit.
- **Checks added.**
  - New pattern **AP-55** (exercised but not asserted).
  - Pattern AP-28, extended (net against credit).
  - Scenario tests v3 (queued): cross-module money invariants.

#### E-043 · P2 · C · Binding completeness was overclaimed
- **Found.** L2 integration-step review, P2-5 and P2-6.
  - The builder's headline read "every reservations, finance and payments port that was still a 503 stub now goes to
    its real provider". It also listed four unbound groups, but missed:
    - integration's and rates' `asSystem` reads;
    - the permission re-checks that rates and guests still do;
    - a dangling reference to OPEN_QUESTIONS.
  - The orchestrator's review brief **broadened** the claim to "binds every cross-module port that was stubbed".
- **Should have been caught by.** L1-BSC (v1 item 31: claims). The orchestrator contributed (RC-12).
- **Checks added.**
  - Orchestrator v2 **O2-1** (quote claims verbatim).
  - Builder self-check v1, items 31–32 (unchanged; this is a v1 miss).

#### E-044 · P2 · D · FD-15 money hiding was claimed "tested" while payment state still leaks
- **Found.** L2 integration-step review, P2-1 (PoC `poc-fd15-money-leak`).
  - The builder's report said: "balances and payment detail are hidden on the front-desk boards … (tested)".
  - Housekeeping still sees `payment_secured.status` and `ready`.
  - `getBooking` returns totals and `status.payment`.
- **Should have been caught by.** L1-BSC. The redaction was applied to one field (`message`), not to the fields derived
  from it, and not to the record routes.
- **Why it was missed.** A sibling path (AP-45) within a privacy rule (AP-18), and a claim broader than its assertion
  (RC-10).
- **Checks added.** Patterns AP-18 and AP-45, extended (derived fields and other routes).

#### E-045 · P2 · D · Finance's reservations port still delegates organization-wide when the property is omitted
- **Found.** L2 integration-step review, P2-2 (PoC `poc-finance-unscoped-delegation`). It is not reachable over HTTP
  today. It has the exact shape of finance's round-0 P0-1.
- **Should have been caught by.** L1-BSC, the round-0 finance fix round (F-07 / ADR-0015). The fix made the scope
  *possible* but left `propertyId?` optional, and `delegated(tx, perms, undefined)` grants at every property.
- **Why it was missed.** An optional scope parameter defaults to the widest scope (fail-open). The fix was not
  re-attacked (RC-4).
- **Checks added.**
  - Pattern AP-35, extended (an omitted scope means refusal, never "all").
  - Builder self-check **v3** (scope parameters required on port surfaces).

#### E-046 · P2 · D · Sealed terms are not verified before penalties and deposits are evaluated
- **Found.** L2 integration-step review, P2-3 (PoC `poc-rates-adapter`). A document with its policies nulled gave a
  penalty of 0 instead of 297,000.
- **Should have been caught by.** L1-BSC, at two points:
  - **The round-0 rates fix round (R-05, keyed seal).** `priceChange` verifies the seal, but the sibling evaluators
    (`evaluateCancellationPenalty`, `instantiatePaymentSchedule`) do not.
  - **The new adapter** in the integration step.
- **Why it was missed.** The fix was applied to the named path only (RC-4).
- **Checks added.** Pattern AP-04, extended (verify before **every** use).

#### E-047 · P1 · D · The first-verification wipe is not serialized against credential writes already in flight
- **Found.** L2 identity review 3, R3-P1-1 (PoC W-1). A pending authenticator confirmed during the wipe survives it, and
  the real GM is locked out at onboarding.
- **Should have been caught by.** L1-BSC, identity fix round 3. That round introduced the wipe (ADR-0017 rule 12).
- **Why it was missed.**
  - A one-time security transition was added without serializing the credential writers against it: `confirmTotp`
    reads before it locks, and activation does not re-check `status`.
  - Concurrency was not part of re-attacking the fix. BS2-1(e) existed only from 17:20, after the round had started.
- **Checks added.**
  - New pattern **AP-56** (a one-time security transition races in-flight writers; use lock order plus an epoch).
  - Canary **C-L2-17**.
  - Retro edit 4 (identity fix round 4 uses the § 3 table).

#### E-049 · P2 · D · SSO managers can delete group mappings they could not create
- **Found.** L2 identity review 3, R3-P2-1 (PoC W-3).
- **Should have been caught by.** L1-BSC, identity fix round 3. Power ordering was checked on added mappings but not
  on removed ones. It is the R2-P2-2 class again.
- **Why it was missed.** A sibling path (RC-4).
- **Checks added.** Pattern AP-45, extended (removal is a sibling of addition).

#### E-053 · P2 · G · The backoffice e2e passes only on port 5180
- **Defect.**
  - `apps/backoffice/e2e/fixtures.ts` hard-codes `127.0.0.1:5180` (lines 67 and 75). A run on other ports fails 8 of 11.
  - With `reuseExistingServer`, a run can silently test another branch's server.
  - Playwright is also outside `turbo test`, so the integration-step reviewer did not run it.
- **Found.** The orchestrator's backoffice merge verification (`pending-fixes.md`, backoffice entry).
- **Should have been caught by.** L1-BSC, the backoffice fix round. Its fix for review P3-7 ("env-driven e2e ports",
  `5b6a46a`) changed the config but not the fixtures, which are a sibling.
- **Why it was missed.** RC-4 and RC-11.
- **Checks added.**
  - Retro edit 1c (e2e on non-default ports at merge).
  - Orchestrator v4 (queued).
  - Pattern AP-52, extended.

#### E-054 · P3 · D · A discrepancy value is rendered with the occupancy vocabulary
- **Found.** The orchestrator's merge verification, reported as "occupancy value `skip` unknown to the UI vocabulary".
- **Diagnosis (L8, this round).**
  - `apps/backoffice/src/features/housekeeping/housekeeping-page.tsx` (occupancy column) renders
    `<StatusBadge vocabulary="occupancy" value={r.discrepancy} />`.
  - Operations' occupancy is `vacant|occupied` (`modules/operations/src/domain/model.ts:10`).
  - `skip` is a **discrepancy** value, and the UI already has a `discrepancy` vocabulary containing it
    (`packages/ui/src/components/status-badge.tsx:77`).
  - So the defect is the **wrong vocabulary family** at the call site, not a missing occupancy value.
- **Risk in the planned fix.** The pending-fixes remedy ("add `skip` to the UI occupancy vocabulary") would hide the
  defect and merge two status families. That breaks consistency rule C3.2 ("separate questions get separate chips").
- **Should have been caught by.** L1-BSC, the backoffice fix round's P1-3 vocabulary alignment.
- **What held.** The neutral fallback added by the P1-3 fix worked as designed: there was no crash.
- **Checks added.**
  - Pattern UX-03, extended (wrong family).
  - Builder self-check **v3** (use the owner's vocabulary for the value's own family).
  - Retro edit 2 (correct the pending-fixes entry).

#### E-058 · P2 · D · *Latent:* module-local provenance enums have drifted from the kernel
- **Defect.** The kernel `Provenance` has 7 values, including `sandbox` (`packages/kernel/src/context.ts:21`). Five
  modules hold six literal copies, with five distinct value sets, **four of which differ from the kernel's**:
  - reservations `contracts.ts:200` lacks `sandbox`, and `:525` allows only `live|simulated`;
  - guests `:13` allows `live|copied|external`;
  - operations `:48` allows `live|external|copied|simulated`;
  - inventory and payments allow all 7.
- **Why it matters.** CLAUDE.md §4.12 requires sandbox results to be labelled.
- **Found.** L8, by a static scan and canary C-L1-02b. A planted kernel value was caught **only** through payments'
  copy (in `shared.ts`), and the other four copies drift silently.
- **Should have been caught by.** L1-BSC (RC-2). The lint rule from round-0 edit 5 is queued but not built.
- **Checks added.** Builder self-check **v3**; retro edit 3a (the lint rule, with this drift list).

#### E-062 · P3 · D · *Latent:* integration still defines its own `ModuleUnavailableError` with the code `module_unavailable`
- **Found.** L8 in round 1, while validating builder self-check v3's BS3-1 grep.
- **Where.** `modules/integration/src/ports.ts:153-161` declares a local class with the code `'module_unavailable'`. The
  kernel and every other module use `module_not_available` (`apps/api/src/composition.ts:159`;
  `operations/src/service/maintenance.ts:645`; `reservations/src/service/context.ts:60`).
- **Why it matters.** Any caller that maps the kernel code, such as reservations' refusal handling or the UI, treats
  integration's refusal as an unknown error.
- **Should have been caught by.** L1-BSC. The E-011 fix (`5c2b5ee`) unified the code in the composition root, but not
  this sibling declaration inside integration (RC-2 and RC-4).
- **Checks added.** Builder self-check v3 BS3-1 (its second grep finds it); retro edit 3a (the lint rule).

### L1-gate — the gates or shared tooling

#### E-052 · P2 · G · *Latent:* tests run migrations as the superuser, so logic that depends on RLS in SECURITY DEFINER functions cannot fail a test
- **Found.** L2 identity review 3, R3-P3-1. PoC W-6 passes: the orphan purge is wrong under the superuser and right only
  under the production owner, which has `nobypassrls`.
- **Should have been caught by.** L1-gate, in the design of the test harness (`packages/testing`).
- **Why it was missed.** RC-11: the test environment differs from production in the one property that the isolation
  P0 tests depend on.
- **Checks added.** Pattern AP-02, extended; retro edit 3c (`nobypassrls` migration owner in tests).

#### E-059 · P2 · G · *Latent:* the boundary checker misses cross-schema SQL in `sql.raw(...)`
- **Found.** L8 scripted canary C-L1-03b2 (run `r1-l1`). `sql.raw('select * from operations.units')` in `inventory`
  passed `tools/check-boundaries.mjs` with exit 0. The `` sql`…` `` form was caught.
- **Should have been caught by.** L1-gate, in the tool's own test corpus, which still does not exist.
- **Checks added.**
  - Canary **C-L1-04**, a permanent corpus entry.
  - Retro edit 3a (extend the checker to string literals in `sql.raw`, `executeQuery` and `.raw`).

### L2 — the steward review's own recommendations

#### E-048 · P1 · D · Changing the SSO groups claim (and `jit_provisioning`, `client_id`) is not treated as a root change
- **Found.** L2 identity review 3, R3-P1-2 (PoC W-2). An `identity.sso.manage` holder re-points the groups claim to a
  self-editable profile field and becomes `org_admin`.
- **Should have been caught by.** L2 identity review 2. Its fix for R2-P1-1 **enumerated** the root changes as
  "issuer, allow-list, `trustIdpMfa` and SSO-required". ADR-0017 rule 15 copied the list, so L-orch contributed, and
  the builder implemented exactly that list.
- **Why it was missed.** RC-9: the fix was written as a list instead of the principle ("anything that decides who
  signs in or which roles a sign-in grants"), and the recommendation itself was never attacked.
- **Checks added.**
  - Steward **v2.1** (SR2-2: recommend a principle with examples, and attack the principle's boundary).
  - Pattern AP-09, extended.
  - Retro edit 6 (ADR-0017 rule 15 wording).

#### E-050 · P2 · D · A stale, non-exclusive domain verification became a global email-verification authority
- **Found.** L2 identity review 3, R3-P2-2 (PoC W-4).
- **Should have been caught by.** L2 identity review 2. Its fix for R2-P0-1, item (2), made a verified-domain sign-in
  set `email_verified_at` globally. In the **same review**, R2-P3-5 rated "domain verification is never re-checked
  and not bound" as only a P3.
- **Why it was missed.** RC-9: a fix made a known weakness **load-bearing**, and nobody re-rated the weakness.
- **Checks added.** New pattern **AP-54** (a fix makes a weakness load-bearing); steward **v2.1**.

#### E-051 · P2 · D · The first-verification wipe permanently locks an SSO-only member out of an SSO-required organization
- **Found.** L2 identity review 3, R3-P2-3 (PoC W-5). The README's stated remedy does not work.
- **Should have been caught by.** L2 identity review 2. Its wipe recommendation ("wipe … other orgs' `sso_identities`
  links …") did not consider legitimate links held by a person who later verifies elsewhere in good faith.
- **Why it was missed.** RC-9. The wipe was attacked for takeover but not for lock-out of the legitimate user (AP-47).
- **Checks added.** Steward **v2.1**; pattern AP-47, extended.

### L3 — scenario proof

#### E-042 · P2 · C · Scenario S04 does not prove the claim it makes about child ages and Green Tax (the first L3 escape)
- **Found.** L2 integration-step review, P2-4 and P3-8.
  - S04 compares a Water Villa with children against a cheaper Beach Villa, and never asserts Green Tax.
  - S01's "nothing posted at booking" is a comment, not an assertion.
  - S05's "second attempt" goes through the port, not the user path.
- **Should have been caught by.** L3, the scenario author (the integration step, under scenario-tests v1).
- **Why it was missed.** RC-10. There was no assertion map from catalogue lines to asserting lines. That is exactly
  scenario-tests v2 ST2-2, which this run predates.
- **Checks added.** Scenario tests v2 ST2-2, already published. This escape is the first evidence for it, and the
  fix round now runs under v2.

### L5 — market, parity and research

#### E-061 · P3 · C · Two specs used the same requirement prefix (`ACC-R` for both access and accounting)
- **Found.** L5 gap strategist. Fixed by the orchestrator in `ba6bf62` (access → `ACS-R`).
- **Should have been caught by.** L5 spec production: the journey audit and the back-of-house audit wrote specs in
  parallel, with no registry of prefixes.
- **Checks added.** None in a playbook. This is a small data-quality class; it is noted for the parity tool, which
  could reject duplicate prefixes. It is not urgent.

### L-orch — the orchestrator's own process

#### E-055 · P3 · Pr · Estimated timestamps were written into the chronicle
- **Defect.** Timeline entries written between 16:45 and 17:22 were 10–60 minutes off, some of them **ahead of the
  clock**.
- **Found.** By the orchestrator. Corrected at 17:25 (`012652e`; `04-…lessons.md` § Corrections).
- **Should have been caught by.** L-orch, the recording step.
- **Checks added.** Orchestrator v2 **O2-4**.

#### E-057 · P2 · Pr · A broad `git add` swept a running reviewer's unfinished files into `main`
- **Defect.**
  - `1179c98` (17:22) swept the integration-step reviewer's PoC files into `main`.
  - `012652e` (17:24) swept its **unfinished** 400-line report into `main`. The reviewer reported at 17:26:52, and the
    final text landed in `8ed5bf8`.
  - An unfinished report on `main` can be read as final by builders, by fix rounds, or by the timeline.
- **Found.** By the orchestrator (`04-…lessons.md`, "commits only explicit paths").
- **Should have been caught by.** L-orch, the commit step.
- **Checks added.** Orchestrator v2 **O2-2**, already practised since 17:30 (`3decba7` is labelled WIP).

#### E-060 · P2 · C · Parity statuses and the generated coverage file went stale after merges
- **Defect.**
  - The parity files for inventory and reservations showed 1 % tested, while their READMEs prove dozens of rows.
  - The committed `docs/parity/COVERAGE.md` showed rates at 2 %, where a fresh run gives 61 %.
  - As a result, the completion gate reports false failures, and the gate itself becomes untrustworthy.
- **Found.** L5 gap strategist (its report, "measurement problems"). The orchestrator regenerated the coverage file in
  `ba6bf62`.
- **Should have been caught by.** L-orch, the merge procedure. Step 4 refreshes the domain map, the seed, the role
  templates and the readiness register, but not the parity rows or the coverage file. The round-0 inventory builder
  said it "couldn't edit `docs/parity/inventory.md` because it is on another branch".
- **Checks added.** Orchestrator v2 **O2-4**; retro edit 1b.

### L8 — the meta loop itself

#### E-056 · P3 · Ev · Round 0 of the meta loop carried estimated chronicle times and costs cut off by the extraction
- **Defect.**
  - The round-0 escapes, scorecard and retro used the timeline's estimated times: the second review "16:42–16:52",
    the ADR amendment and turbo fix at "17:00", the refiner at "≈16:58". The true times are 16:43, 16:43, 16:44 and
    16:43.
  - It also reported the second review's and the refiner's costs as "≥" figures from a mid-run extraction. The final
    figures are 235 turns, 347,021 output tokens and 68.0M input for the second review, and 123 turns, 428,145 output
    tokens and 27.2M input for the refiner.
- **Found.** L8, this round, after the orchestrator's correction (E-055).
- **Should have been caught by.** L8. Times must be cross-checked against git and `agents.json` before they are used.
- **Checks added.** In this file and the scorecard: times come from git or `agents.json`, and "≥" figures are re-read
  each round (scorecard § 1, method). Corrections are appended in the scorecard's "Corrections" section.

---

## Round 2 — 2026-11-07, 17:58–18:44 UTC (the fix re-attack sweep, the integration-step re-review, the identity merge, parity-ops, the orchestrator's process)

Sources:
- `docs/orchestration/reviews/review-fix-sweep.md` and `fix-sweep-poc/`;
- `review-integration-step-2.md` and `integration-step-poc/r2-*`;
- the integration-step and identity builder reports (`docs/chronicle/agents/20261107T1616-*`, `…T0738-*`, fix-round
  reports at 18:07 and 18:29);
- `docs/chronicle/01-timeline.md` (17:38 onward) and `04-…lessons.md` ("Checkpoint WIP commits must not be
  rewritten");
- the time-correction commits `9d08ee7`, `5e486f1`, `c6a34eb` and `f62ddf0`;
- `docs/parity/gaps-ops.md` § 5;
- scripted canary `r2-l3` (`canaries.md` § 6).

**Playbook versions in force (the first measured round):**
- Both reviews ran on **steward v2.1**.
- Three fix rounds produced the **self-check § 3 re-attack table**: integration step, identity round 4 and guests.
- Identity round 4 also ran **§ 4 (v3)**.
- The integration-step fix round ran **scenario tests v2**.
- Parity-ops ran **parity v2**.

The guests erasure re-review landed at 18:53, and is folded in below (E-082 to E-085).

### L1-BSC — residuals of round-0 fixes, found by the sweep

#### E-063 · P1 · D · The link-versus-desk ownership guard is bypassed by authorize → capture (SW-PAY-1)
- **Found.** L2 fix sweep (PoC `SW-PAY-1`). A deposit paid by link, then a desk authorize and capture on the same
  booking, produces 2 deposit postings.
- **Should have been caught by.** L1-BSC, the round-0 payments fix round for P1-2. The guard was put on `chargeNow`
  only, and the regression test encodes the reviewer's exact path.
- **Why it was missed.** RC-4. The fix guarded one *path* instead of the *invariant* "one collection per ref and
  purpose" (RC-13, below).
- **Checks added.** Builder self-check **v4** BS4-1 (invariant closure); pattern AP-28, extended.

#### E-064 · P2 · D · The `custom` purpose skips the ownership guard with no reason and no audit (SW-PAY-2)
- **Found.** Fix sweep.
- **Should have been caught by.** L1-BSC, the same fix. An exemption was keyed on a label the client chooses.
- **Checks added.** Pattern AP-35, extended (an exemption keyed on a client-chosen value).

#### E-066 · P1 · D · The P1-8 fix trusts `entry_channel`, a field the client declares (SW-PAY-4)
- **Found.** Fix sweep (PoC `SW-PAY-4`). Two charges of USD 900 each were recorded as customer-initiated on a token
  with no mandate.
- **Should have been caught by.** L1-BSC, the round-0 payments fix round. The fix moved the trust from `initiator` to
  `entry_channel`, which the client writes and which defaults to `hosted_entry`.
- **Why it was missed.** No step asks "who writes the fact my fix now trusts?" (RC-13; AP-54 at fix time).
- **Checks added.** Builder **v4** BS4-1(a), premise writers; new pattern **AP-57**.

#### E-068 · P2 · G · The backoffice P0-1 regression test cannot fail (SW-BO-1)
- **Defect.** `page.goto` reloads the page, which clears the cache whether or not the fix is present.
- **Found.** Fix sweep.
- **Should have been caught by.** L1-BSC, the backoffice fix round (AP-55).
- **Checks added.** Builder **v4** BS4-3 (mutate the fix: the test must fail without it); pattern AP-55, extended.

#### E-069 · P2 · D · R-01 recurs for fees the hotel adds, because `nature` defaults to `statutory` (SW-RAT-1)
- **Found.** Fix sweep.
- **Should have been caught by.** L1-BSC, the rates fix round. The principle "what the hotel sets is agreed" was
  implemented as a flag whose default is unsafe.
- **Checks added.** Pattern AP-35, extended.

#### E-070 · P2 · D · The F-04 cap lineage resets when the selector or destination folio changes (SW-FIN-1)
- **Found.** Fix sweep (code-read).
- **Should have been caught by.** L1-BSC, the finance fix round.
- **Checks added.** Builder **v4** BS4-1(b) (inverse and repeated operations).

#### E-071 · P3 · D · A release racing an add-nights change leaves orphan consumption (SW-INV-1)
- **Found.** Fix sweep (code-read).
- **Should have been caught by.** L1-BSC, the inventory INV-02 fix. The lock covers only the cells read before
  locking.
- **Checks added.** AP-36 is already in the library. INV-10 should flag consumption for a cancelled ref.

#### E-072 · P3 · D · The SSRF address policy does not decode the RFC 2765 `::ffff:0:0:0/96` form (SW-INT-1)
- **Found.** Fix sweep. It is defence in depth only.
- **Should have been caught by.** L1-BSC, the integration F1 fix.
- **Checks added.** Pattern AP-14, extended.

### L2 — recall misses of round-0 reviews

#### E-065 · P1 · D · A card saved at property B is charged by a user scoped to property A (SW-PAY-3)
- **Found.** Fix sweep (PoC `SW-PAY-3`).
- **Should have been caught by.** The **L2 round-0 payments review**. The defect existed then: `loadActiveMethod`
  checks neither property nor owner. That review probed AP-01 on the ledger target (P0-1) but not on the **card**,
  which is another record parameter of the same command.
- **Why it was missed.** AP-01 was applied to one record parameter of a command, not to all of them.
- **Effect on the scorecard.** This is a measured recall miss: the payments review's P0+P1 recall is now ≈ 15/16.
- **Checks added.** Pattern AP-01, extended (every record-valued parameter: card, authorization, request, account).

#### E-067 · P1 · D · Erasure leaves the guest's name and date of birth in `core.idempotency_keys`, and a replay returns them (SW-GUE-1)
- **Found.** Fix sweep (PoC `SW-GUE-1`).
- **Should have been caught by.** The **L2 round-0 guests review**. In the same report it endorsed foundation request
  FR-1 ("idempotency records hold PII") and raised G-P0-1 (erasure leftovers), but never connected the two. The
  builder contributed: its erasure scan listed `guests.*`, the outbox and the audit log, but not `core` jsonb stores.
- **Why it was missed.** "Detected but not connected". AP-17's probe has listed idempotency records since round 0,
  but the guests fix predates the pattern library.
- **Effect on the scorecard.** The guests review's P0+P1 recall is now ≈ 8/9.
- **Checks added.** Pattern AP-17, extended (replay after erasure). Guests erasure fix in progress.

### L2 — recommendation defects of a v1-era review (integration-step review 1, 17:04)

#### E-073 · P1 · D · Whoever links the cardholder to a booking chooses the card held at check-in (R2-P1-1)
- **Found.** L2 integration-step re-review, on v2.1 (PoC R2-A). A role with no payments key held USD 7,117.80 on a
  stranger's card.
- **Should have been caught by.** L2 integration-step review 1. Its fix for P1-2 recommended "verify that the
  method's owner is the booker, an occupant or the billing payer". The guarded role writes those links. The builder
  implemented the recommendation exactly, and its § 3 reverse-order probe attacked the *input* (another card), not
  the *premise* (who sets the owner links).
- **Why it was missed.** RC-9 (review 1 ran on v1, before "attack the fix" existed) and RC-13.
- **Checks added.**
  - ADR-0015 Amendment 1 (applied at 18:29).
  - Builder **v4** BS4-1(a).
  - New pattern **AP-57**; pattern AP-53, extended.

#### E-074 · P1 · D · The late-charge collection is kept in step for one charge only; the fix froze the severity, and a reversal leaves the request open (R2-P1-2)
- **Found.** L2 integration-step re-review (R2-D, run concurrently and sequentially; R2-E).
- **Should have been caught by.** L2 integration-step review 1. Its P1-3 recommendation was framed on a single
  charge ("request `min(share, …)`; when 0 … raise a routine exception"). The builder's § 3 probes used one charge,
  with no repetition and no reversal.
- **Note.** The fix introduced a regression: an urgent exception is now stored as routine.
- **Why it was missed.** RC-9 and RC-13: no repetition, no inverse operation, and the fix's own records were not
  re-checked.
- **Checks added.** Builder **v4** BS4-1(b) and (c); new pattern **AP-58**.

### L1-BSC — the integration-step fix round (under self-check v2 § 3)

#### E-075 · P1 · D · The P1-1 fix trusts `deposit_accounts`, whose import writer skips the ownership check; a real deposit is charged but not posted (R2-P1-3)
- **Found.** L2 integration-step re-review (R2-F).
- **Should have been caught by.** L1-BSC. The builder designed the fallback ("finance falls back to `deposit_accounts`
  for imported bookings") but did not attack the writers of that table.
- **Checks added.** Builder **v4** BS4-1(a); pattern AP-57. Scripted canary C-L3-03 confirmed that the new global
  consistency check catches this plant (§ 6).

#### E-076 · P2 · D · FD-15 money hiding still misses workflow runs and stay issues (R2-P2-2)
- **Found.** L2 re-review (R2-G).
- **Should have been caught by.** L1-BSC. This is the **second** sibling miss on FD-15 (E-044 was the first). The
  P2-1 fix enumerated the routes it knew, not every field derived from payment state.
- **Checks added.** Builder **v4** BS4-1 (every reader of the protected quantity); pattern AP-18, extended.

#### E-077 · P2 · D · The payments reference check fails open for unknown types, and when the directory is unbound (R2-P2-3)
- **Found.** L2 re-review (R2-H).
- **Should have been caught by.** L1-BSC. The fix itself added two early `return`s. Exemptions are now audited by
  reviewers (round-1 edit 1a), but not by builders.
- **Checks added.** Builder **v4** BS4-2 (exemption list in the fix-round reply); pattern AP-35, extended.

#### E-078 · P2 · D · The replacement for P3-9 marks an external money step done with no attestation, and its regression test asserts "done" (R2-P2-4)
- **Found.** L2 re-review.
- **Should have been caught by.** L1-BSC. The builder deviated from the recommendation ("mark the step external with
  an attestation") (AP-26, AP-55).
- **Checks added.** Builder **v4** BS4-3; patterns AP-26 and AP-55, extended.

### L1-gate

#### E-079 · P3 · G · A flaky end-to-end test (409 toast) on non-default ports passed only on re-run
- **Found.** The orchestrator's identity merge verification. Playwright went 11/12 on non-default ports, which is
  round-1 edit 1c doing its job.
- **Should have been caught by.** L1-gate. There is no flaky-test register or quarantine rule; it is logged only "for
  backoffice".
- **Checks added.** Canary C-L1-05; orchestrator **v3** O3-3 (a flake is a tracked defect with an owner, never a
  silent rerun).

### L-orch — the orchestrator's process

#### E-080 · P3 · Pr · Estimated chronicle times recurred four times despite rule O2-4
- **Defect.** Four timeline times were first written wrong:

  | Entry | Written | Correct |
  |---|---|---|
  | Quality steward round 0 | 17:24 | 17:27 |
  | Parity merge | 18:08 | 18:02 |
  | Fix sweep | 18:13 | 18:15 |
  | Integration-step re-review | 18:30 | 18:29 |

  Each was corrected within minutes from the agent records (`9d08ee7`, `5e486f1`, `c6a34eb`, `f62ddf0`). The error
  shrank from 10–60 minutes (E-055) to 1–6 minutes, but did not stop.
- **Should have been caught by.** L-orch. O2-4 is a rule a person has to remember, and the record it points to
  (`agents.json`) is refreshed only when the chronicle is extracted.
- **Effect on the round-1 anomaly.** The 17:24 vs 17:26:52 question is resolved: it was an estimate. The timeline now
  reads 17:27, while the record says 17:26:51; a rounding convention is still needed.
- **Checks added.** Orchestrator **v3** O3-1 (times derived by a helper that reads the live transcript, and verified
  at commit). The prototype is `canary-scripts/when.py` in the session scratchpad. Retro edit 1.

#### E-081 · P2 · Pr · A force-push was attempted on a branch whose pushed checkpoint commit the agent had rewritten
- **Defect.** `tools/checkpoint.sh` committed and pushed a WIP commit in a running agent's worktree. The resume message
  did not tell the agent to build on top of it, and the integration builder "replaced the usage-limit WIP checkpoint
  with a proper commit".
- **What happened next.** The normal push was refused, and the orchestrator attempted a force-push. The safety policy
  declined it. The divergence was resolved with an `-s ours` merge, and a rule was added to the builder playbook
  (`51dd70c`).
- **Should have been caught by.** L-orch: the checkpoint and resume procedure, and the choice of a destructive
  remedy. The builder contributed.
- **Checks added.**
  - Orchestrator **v3** O3-2 (the resume message names the WIP commit and the build-on-top rule; never force-push;
    reconcile by merge).
  - Retro edit 2.

### Guests erasure fix — the focused re-review on v2.1, landed at 18:53 and folded in here

#### E-082 · P2 · D · The erasure redaction net matches free text as substrings, so one erasure makes unrelated replays answer 410 (R2-P2-1)
- **Found.** L2 guests re-review, on v2.1 (`review-guests-erasure-fix.md` R2-P2-1).
  - Erasing a guest whose address was `Maldives` made `POST /v1/properties` replays answer 410.
  - `7771234` redacted a response containing `17771234`.
  - A shared family email 410'd another guest's responses, including one under legal hold.
  - The capability can be weaponized (AP-47).
- **Should have been caught by.** L1-BSC, the guests fix round. The fix defined "a mention" as any contact value,
  matched as a substring. The invariant was right; its **identifier** (premise) was wrong.
- **Checks added.**
  - Pattern AP-17, extended (match exact identifiers, never substrings).
  - Pattern AP-47, extended.
  - Builder v4 BS4-1(a).

#### E-083 · P2 · D · A guests write that passed its checks before an erasure commits after it, and its data survives (R2-P2-2)
- **Found.** L2 guests re-review (a gated concurrency PoC).
- **Should have been caught by.** The **L2 round-0 guests review**. The defect existed before the fix branch:
  `requireWritableProfile` reads the status without a lock.
- **L8 contributed.** The round-2 fix sweep marked AP-56 "not applicable (no one-time security transition)",
  because AP-56's examples (credential wipe, key rotation, revocation, offboarding, cutover) did not name
  **erasure**. The pattern's wording narrowed a reviewer's sweep.
- **Checks added.** AP-56's examples now include erasure and anonymization (L8 correction). Builder v4 BS4-1(a):
  writers of the subject's data.

#### E-084 · P2 · D · Redaction scans every stored response of the tenant inside the erasure transaction; erasure fails at about 340,000 stored responses (R2-P2-3)
- **Found.** L2 guests re-review (benchmark: 4.4 s for 50,000 rows).
- **Should have been caught by.** L1-BSC, the guests fix round. The fix made "erasure completes" depend on the volume
  of data (AP-54, re-rated to P2 by the reviewer).
- **Checks added.** Pattern AP-54, extended (volume and time as load-bearing premises). Builder v4 BS4-1 (the fix's
  own cost).

#### E-085 · P2 · C · Personal data in finance and payments is not reached, and the README cites consumer tests that do not exist (R2-P2-4)
- **Found.** L2 guests re-review. No module consumes `guests.profile.anonymized`. `finance.folios.payer_name` and
  `payments` `holder_name` and payer keep the name.
- **Should have been caught by.** L1-BSC, guests' claims (v1 item 31, AP-50).
- **Checks added.** Builder v1 items 31–32 already cover it; this is a miss under them. Pending-fixes lines with owners
  (retro, edit 5).

### Not counted as escapes this round (recorded for completeness)

- **R2-P2-1** (card ownership is first-saver) was a declared and tracked gap in the builder's report.
- The **R2-P3** items, and the sweep's tracked residuals (booking exemption, optional scope, rates siblings), were
  already logged as E-039, E-045 and E-046.
- **17 parity rows downgraded** by the parity researcher itself under PR2-1. That is the playbook working at the
  source, not an escape.
- **Identity round 4's self-detected vocabulary copies in platform** (BS3-1). The builder found them itself.

---

<!-- Round 3 entries go below this line: "## Round 3 — <date>" -->
