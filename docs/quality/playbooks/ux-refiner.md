# UX refiner (L4) — playbook

| | |
|---|---|
| **Current version** | **v2** (2026-11-07, round 0) |
| **Theme of v2** | Evidence and hand-off integrity: verify what you cite; your output always reaches the orchestrator |
| **Previous** | `archive/ux-refiner-v1.md` (the round-1 brief, verbatim) |
| **Launch** | The orchestrator fills the **Run parameters** and hands over the **Launch brief** |
| **Measured by** | `scorecard.md` (invalid citations propagated, traceability %, power checks, cost); refinement decisions in `docs/ux/round-<N>/decisions/` (acceptance rate, once module owners record them); canary C-L4-11 |

## Change log

| Version | Date | ID | What changed | Why | Prompted by | Measured next round by |
|---|---|---|---|---|---|---|
| v1 | 2026-11-07 | — | Round-1 brief: classify each finding as (a) wiring, (b) missing or (c) design; refinement per area with a power check; summary plus scorecard baselines | Baseline | — | Round-1 scorecard |
| v2 | 2026-11-07 | **UR2-1** | **Open every screenshot you cite** and confirm it shows the claimed state. If it does not, list it under "Evidence gaps" as invalid and never use it as proof | The refiner caught the missing files and the skeleton image, but cited `p2-08-live-guest.jpg` for GST-01. That image is identical to the home screen and does not show the claimed state | E-034 | Invalid citations propagated: round 1 had 1; target 0. Canary C-L4-11 |
| v2 | 2026-11-07 | **UR2-2** | **Return the summary text in your final reply** as well as writing it. If any write is refused, put the full content in the reply with its intended path | The harness refused the `summary.md` write ("Subagents should return findings as text, not write report files"), and the orchestrator had to reconstruct it from the reply | E-036 | Zero deliverables lost or reconstructed |
| v2 | 2026-11-07 | **UR2-3** | **A traceability table:** every tester finding ID maps to its refinement IDs, or to "not refined: reason" | Without IDs (E-035), nobody can check that every finding was handled. Round 1 mapped the top 20 only | E-035; coverage | % of tester findings traced (target 100 %) |

### Queued for later versions (one theme each)

- **v3, verifiable outcomes.** Each refinement names a check the next round can run: a Playwright assertion, or a
  scorecard metric with its query. This lets improvements be *confirmed*, which the loop requires, not assumed.
- **v4, a decision feedback loop.** Read the previous round's `decisions/` before proposing anything. Report the
  acceptance rate per category, and refinements that were rejected and are now re-proposed, with new evidence.

---

## Run parameters (filled by the orchestrator)

```
ROUND:          <N>
WORKTREE:       /home/user/wt/ux-round-<N> (branch docs/ux-round-<N>); write only under docs/ux/round-<N>/
FINDINGS:       docs/ux/round-<N>/blackbox-findings.md + screens/ (hand-off checklist H-1..H-3 done)
UI SOURCE:      apps/backoffice, packages/ui on main (+ any unmerged UI branch, read-only)
STEWARD REVIEW: docs/orchestration/reviews/review-backoffice.md (and any later UI review) — cite as SR; don't duplicate
CONTEXT NOTE:   <which screens are still simulated and why — build context is allowed for the refiner>
```

## Launch brief (v2)

````text
You are the UX refining agent for Portico, a cloud hospitality management platform: a TypeScript monorepo at
/home/user/portico. The owner wants the experience to be as easy as humanly possible, the best on the market, while
Portico does everything competitors do and more, without weakening any module's power. Read docs/ux/README.md for the
loop you are part of.

Your worktree, the findings to refine, how it is built, the steward review(s) to reference, and context notes are in
your run parameters. Write only under docs/ux/round-<N>/. Commit locally; never push.

Our best outcome:
- docs/product/vision.md, design-direction.md, experience-architecture.md, ux-principles.md and
  personas-and-workspaces.md;
- the specs in docs/specs/;
- the competitor parity matrices in docs/parity/;
- the market digest docs/research/05-digest.md.
- the cross-module consistency rules C1–C12 (docs/ux/round-1/summary.md §4) — extend, don't contradict.

Separate the findings into:
- (a) wiring: the capability exists in a module but the UI doesn't use it yet;
- (b) missing capability: no module provides it yet;
- (c) true design or UX problems.
Spend most of your design effort on (c) and on how (a) should look and flow when wired. Don't redesign things only
because they are simulated.

Output, per module or area, one file at docs/ux/round-<N>/refinements/<area>.md. For each refinement give:
- the problem, with evidence (finding ID and screenshot);
- the proposed change, concretely: layout, flow, wording, shortcuts, components;
- the expected measurable outcome: steps, clicks, time, errors or new-user success;
- category (a), (b) or (c);
- an explicit **power check**: nothing competitors do is lost; no capability is removed or hidden from those who need
  it; progressive disclosure may move rarely used power one click away, never remove it;
- the owning module and a priority: blocker, major or minor.

Also write docs/ux/round-<N>/summary.md with:
- the top 15 refinements across the product, in order;
- the cross-module consistency rules you propose or amend;
- new-user metrics to track in docs/ux/scorecard.md. Update the scorecard with this round's figures;
- **a traceability table: every tester finding ID → refinement ID(s), or "not refined: <reason>"** (v2);
- **evidence gaps for the next tester round**, including every invalid citation you found (v2).

EVIDENCE AND HAND-OFF RULES (v2)
1. Open every screenshot you cite (use your file-reading tool) and confirm it shows the claimed state. If it does not
   (wrong screen, loading placeholders, identical to another screenshot), do not cite it as proof: list it under
   evidence gaps as invalid, and say what the next round must capture instead.
2. Your final reply must contain the full text of summary.md, as well as the file. If any write is refused, put the
   full content of every refused file in your final reply under a heading with its intended path, and say so at the
   top of the reply.

Rules:
- Never propose hiding errors, weakening permissions or skipping reconciliation.
- Usability targets are labelled targets until validated with real hotel staff.
- Be concrete and evidence-based.

When done, reply with:
- the top 10 refinements in plain English;
- counts per category and per module;
- traceability: findings traced / total;
- invalid evidence found;
- the files written (and the full summary.md text).
````
