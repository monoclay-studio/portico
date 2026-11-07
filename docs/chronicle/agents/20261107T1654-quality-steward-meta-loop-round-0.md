# Agent run: Quality steward (meta loop) round 0

- Started: 2026-11-07T16:54:09.351Z · last activity: 2026-11-07T17:31:31.370Z
- Turns: 241 · tool uses: 143 · output tokens: 579,945
- Type: general-purpose

## Brief (2026-11-07T16:54:09.351Z)

````text
You are the **quality steward** for Portico, a cloud hospitality platform built by many AI agents in parallel (repo /home/user/portico). You are in charge of the agents that CHECK the work: steward reviewers, black-box UX testers, the UX refiner, scenario tests, parity researchers and the gap strategist.

Your job is to make the checkers better every round. You see how they test, measure them, trace defects that were found late back to the loop that should have caught them, and improve their playbooks. In the owner's words: "a very very intelligent self improving system with many feedback loops".

Read first:
- docs/quality/README.md: your mandate, the loops L1–L8 and the artifacts you own. Follow it exactly.
- CLAUDE.md and docs/orchestration/operating-model.md.
- docs/chronicle/README.md, 01-timeline.md and 04-turning-points-and-lessons.md: the history so far.

Your worktree is /home/user/wt/quality (branch docs/quality, created from main). Write ONLY under docs/quality/. Commit locally after each meaningful step; never push. You never edit product code, other agents' branches or other docs. Changes you want elsewhere, for example to docs/orchestration/steward-review-brief.md, go into your playbooks and your report, and the orchestrator applies them.

Your data:
- docs/chronicle/agents/*.md: every agent run's brief and final report, verbatim. That is how each checker was instructed and what it delivered.
- docs/orchestration/reviews/: the 10 first-round steward reviews, the second identity review (review-identity-plus-2.md) and its proof-of-concept attack tests in identity-plus-poc/.
- The builders' fix-round reports, in docs/chronicle/agents: which findings were fixed, deferred or disputed. These are your precision data.
- docs/ux/round-1/: the black-box findings, the 83 refinements and the summary, which lists the tester's evidence gaps.
- docs/orchestration/pending-fixes.md and the git history: defects found at merge time.
- docs/orchestration/steward-review-brief.md, module-agent-playbook.md, parity-researcher-brief.md, docs/ux/README.md: the current instructions.

Round 0 deliverables: build the system from today's real data.
1. **playbooks/** — v1 of each checker's playbook, extracted faithfully from the briefs actually used: steward-reviewer, blackbox-tester, ux-refiner, scenario-tests, parity-researcher, gap-strategist. Add **module-builder-self-check**: the checks a builder runs before declaring "done", derived from what reviewers caught. Then write **v2** of each, with a change log: what changed, why, and which escape or metric prompted it. Keep v2 changes small and attributable.
2. **escapes.md** — every defect found later than it should have been, each with: where found, the earliest loop that should have caught it, why it was missed, and the check added to which playbook. Today's examples include:
   - the first identity review missing the pre-hijacking class;
   - the stale turbo cache hiding type errors three times;
   - a cross-package enum change breaking typecheck on main;
   - error-code drift between modules found only at merge;
   - the boundary-checker false positive;
   - the demo-seed timeout under parallel runs;
   - lint failures committed because output was piped;
   - the UX tester citing screenshots that don't exist, and a skeleton-only screenshot;
   - the refiner's summary write being refused.

   Find the rest yourself.
3. **patterns.md** — the attack and test pattern library: every P0/P1 class from all the reviews, generalised so any module can be checked for it. Examples: cross-property posting, claimable external accounts, lost webhooks, stale offline writes, SSRF, concurrent over-correction, cross-org credential control, pre-hijacking, X-Forwarded-For spoofing, a cache leaking across users. Each entry gives the probe a reviewer runs. Also include the UX trap patterns from round 1.
4. **canaries.md** — a seeded-defect catalogue for L2 (a scratch branch with planted bugs per pattern) and L4 (planted UX traps in a lab build). Include how to plant them safely, never on main or real branches, how to score recall, and a budget-aware schedule. Do NOT run canaries in this round; usage is constrained.
5. **scorecard.md** — one row per checker run so far: precision and recall estimates with your method stated, evidence quality, coverage, cost from the chronicle's turns and tokens, and playbook version.
6. **retros/2026-11-07-day1.md** — the retrospective: what worked, what didn't, and the top 10 improvements across all loops, ranked by expected effect.

Rules:
- Evidence for every claim, citing file and section.
- Mark estimates as estimates.
- Never propose weakening a gate or lowering a bar to improve a metric.
- Keep the black-box tester's independence: no build context may ever leak into its playbook.

Finish with `git log --oneline` of your commits.

Reply with:
- the top 10 improvements, in plain English;
- the escape count by loop;
- the exact edits you want the orchestrator to apply to docs/orchestration/* and docs/ux/README.md, as a short list;
- the files written.

You will be resumed after every future testing or review round to run the meta loop again. Keep your files structured so each round appends cleanly.
````

## Follow-up message (2026-11-07T17:31:01.813Z)

````text
The coordinator sent a message while you were working:
Round 0 is merged into main (commit 9df588b), and I applied all 8 of your edits in commit 8ed5bf8. Edit 6 added the apps/* turbo inputs; canary C-L1-01 for apps/api then ran at 17:30 and was caught: the worker typecheck had a cache miss and failed. I also restored the six x-0* screenshots and marked p2-08 as invalid evidence.

Run meta-loop round 1 on the checking rounds that just finished. Work on branch docs/quality after `git merge main`, and append to your files.

1. **Integration-step steward review:** docs/orchestration/reviews/review-integration-step.md and integration-step-poc/.
   - The builder's report said "every stubbed port bound", and it wasn't.
   - The reviewer found 3 P1s and showed that S04 didn't prove its claim. These are builder self-assessment escapes.
2. **Identity third review:** review-identity-plus-3.md.
   - Across three rounds, each fix opened a narrower new class of P0 or P1: a race on the wipe, and a missed root-change field.
3. **Backoffice merge verification, done by me:**
   - all gates and Playwright passed 11/11;
   - but e2e/fixtures.ts hard-codes port 5180, so a run on other ports failed 8/11;
   - one occupancy value, "skip", was unknown to the UI vocabulary and fell back to a neutral chip.
4. **Orchestrator process escapes, attributable to me:**
   - estimated timestamps in the chronicle, corrected later;
   - broad `git add` swept a running reviewer's in-progress files into main;
   - three lint failures committed before tools/commit-checked.sh existed.

Update escapes.md, the scorecard and patterns. Write retros/2026-11-07-round1.md. Propose playbook versions where the evidence supports them.

Also add an **orchestrator playbook** (`playbooks/orchestrator.md`). I'm a loop too, and my process should be measured and improved like the others.

Rules as before: write only under docs/quality, commit, don't push, and run no paid canaries; scripted CPU-only canaries are fine. Reply with:
- the top improvements;
- escape counts;
- exact edits for me to apply.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T17:31:31.370Z)

````text
[Request interrupted by user]
````

## Report (2026-11-07T17:26:39.508Z)

````text
## Quality steward, round 0: report

Round 0 is done. I wrote only under `docs/quality/` on branch `docs/quality`, committed locally, and pushed nothing. I ran no canaries.

Three things I found that weren't in the brief:
- **A turbo cache gap is still open after the 17:00 fix (E-038).** `apps/worker` imports `compose` from `@portico/api`. A turbo dry run shows `@portico/worker#typecheck` hashes 404 files, none of them from `apps/api`. A change to `apps/api` can therefore still pass from cache.
- **One round-1 screenshot shows the wrong screen.** `screens/p2-08-live-guest.jpg` is byte-identical to `p2-01-home.jpg`, so it does not show the palette state the finding claims. The refiner cited it again for GST-01.
- **The six "missing" screenshots still exist.** `x-01`…`x-06` are in the session scratchpad (`…/scratchpad/ux-round1/`). The orchestrator's compress-and-copy step skipped them; the tester didn't lose them.

Also relevant to canaries: `tools/checkpoint.sh` commits and pushes every branch, so planted defects may only ever sit in detached worktrees.

### Top 10 improvements, ranked by expected effect
1. **Attack every fix again before it merges.** Identity-plus was the only module reviewed twice, and its fix round introduced or left 6 defects, one of them a P0. Start with a one-off re-check of the 14 P0 fixes already on main, which nobody has attacked since they were fixed.
2. **Reviewers sweep a shared list of attack patterns and declare what they checked.** That includes running each attack with the order reversed (attacker first, victim later), attacking their own recommended fix, checking sibling code paths, and checking which delegated permissions are admin-equivalent. UI reviews add every persona's screen size, invalid input on every form, clicking every result, and access by role and URL.
3. **Track cross-module notes and stop duplicated enums.** Two reviews flagged contract drift 13 and 37 minutes before it broke main, but only as notes with no owner.
4. **Make the gates trustworthy.** Close the `apps/*` cache gap, give shared gate tools their own tests, use one gate command everywhere, and run a scripted gate self-test at every merge batch.
5. **Scenario tests must run on real providers.** Each scenario lists which ports were real and which assertion proves each expected outcome, and must hold under the CI gate.
6. **Make the parity gate truthful.** A row counts as `tested` only when a test on main asserts it; edge cases must cover the failure classes; resume parity-ops, because 4 built modules have no matrix at all.
7. **Measure recall with planted defects.** Recall is currently unknown for 8 of the 10 reviews.
8. **Repair the UX evidence chain.** Only 89% of the tester's screenshot citations are valid. Add stable finding IDs, check every screenshot before citing it, and check the hand-off copy.
9. **Keep each review's proof-of-concept tests in the repo.** Today 9 of 11 exist only in the scratchpad.
10. **Walk whole journeys to find scope gaps.** A guest's stay, each staff shift and each adoption path, with any step nobody owns flagged. The owner had to point out the keys and guest-stay gap himself.

### Escape count by loop (where it should first have been caught)

| Loop | Escapes |
|---|---|
| L1 gates and tooling | 9 |
| L1 builder self-check (including fix rounds) | 7 |
| L2 steward review | 11 |
| L3 scenario tests | 0 (no run has finished) |
| L4 UX loop | 5 |
| L5 parity and research | 6 |
| **Total** | **38** (2 P0, 9 P1, 17 P2, 10 P3) |

### Edits for you to apply
1. **`docs/orchestration/steward-review-brief.md`**
   - Add a first line marking it superseded by `docs/quality/playbooks/steward-reviewer.md`.
   - Replace the malformed line 58 ("(formerly scratchpad)") with "Write the report to the path given in your task (default `docs/orchestration/reviews/review-<module>.md`)".
2. **`docs/orchestration/module-agent-playbook.md`**, end of § Quality bar: "Before you say done, and in every fix round, run `docs/quality/playbooks/module-builder-self-check.md` and put its tables in your final reply. Never pipe a gate's output; read its exit code."
3. **`docs/orchestration/STATUS.md` § 5, step 1:** save each review's proof-of-concept and probe files as `reviews/<module>-poc/*.ts.txt` alongside the report.
4. **`docs/orchestration/STATUS.md` § 5:**
   - Step 2: every cross-module note becomes a `pending-fixes.md` entry with an owner before the fix round starts. Every P0 fix gets the builder's re-attack table plus a targeted re-check on the merged copy before merge.
   - Step 5: change `pnpm test` to `pnpm turbo run test --force --concurrency=2`.
5. **`docs/orchestration/pending-fixes.md`:** add a foundation lint check that fails on module-local copies of kernel or provider enums and error codes (provenance, data-authority domains, payer types, status vocabularies). Also make `permission-catalog.test.ts` ignore code comments.
6. **`turbo.json`** (outside docs): add `"$TURBO_ROOT$/apps/*/src/**"` and `"$TURBO_ROOT$/apps/*/package.json"` to the inputs of both `typecheck` and `test`, then run canary C-L1-01.
7. **`docs/ux/README.md`:**
   - Launch the tester and the refiner from their playbooks.
   - Run hand-off checks H-1 to H-4 before the refiner starts.
   - The refiner verifies every screenshot it cites and returns its summary in its final reply.
   - One-off, while the scratchpad still exists: copy the six `x-0*.png` files into `docs/ux/round-1/screens/` and fix their references. Note in `blackbox-findings.md` that `p2-08` is invalid evidence.
8. **`docs/orchestration/parity-researcher-brief.md`:** mark it superseded by playbook v2, and resume parity-ops from v2.

Optional now: send the scenario-tests v2 block (ST2-1…3) to the running integration step, and GS2-1 (journey walks) to the gap strategist.

### Files are in /home/user/wt/quality/docs/quality:
- escapes.md
- patterns.md (51 attack patterns, 17 UX traps)
- canaries.md
- scorecard.md
- retros/2026-11-07-day1.md
- playbooks/README.md
- playbooks/ (v2, one theme each, with change logs): steward-reviewer.md, blackbox-tester.md, ux-refiner.md, scenario-tests.md, parity-researcher.md, gap-strategist.md, module-builder-self-check.md
- playbooks/archive/ (v1 of each, extracted from the briefs actually used; demo password redacted)

### git log --oneline
```
c1ef41c docs(quality): order AP-28/AP-29
128b966 docs(quality): patterns cover every review P0/P1 class — time semantics and lazy expiry, keyed seals, nOAuth, connected-mode round trip, cross-module invariant bypass
ef29534 docs(quality): escape evidence precision — PoC shapes, citations, hand-off inference marked
0b79eb5 docs(quality): day-1 retrospective — what worked, what didn't, top 10 improvements, edits for the orchestrator
2000464 docs(quality): checker scorecard round 0 — precision, recall estimates, evidence, coverage and cost per run, with method
f5328b4 docs(quality): v2 playbooks with change logs — one theme each, attributed to escapes and metrics
d42a78d docs(quality): attack, test and UX-trap pattern library; canary catalogue with safe planting, scoring and schedule
cb19fee docs(quality): escape register round 0 — 38 late-found defects traced to the loop that should have caught them
bfb5cb2 docs(quality): v1 playbooks extracted from the briefs actually used (steward, black-box tester, refiner, scenario tests, parity, gap strategist, builder self-check)
```
````

