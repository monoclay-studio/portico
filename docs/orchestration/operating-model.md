# Operating model (owner direction, 2026-11-07)

**The orchestrator (main session) owns the vision** — `docs/product/vision.md` — and the coherence of the whole:
one product, consistent experience, clean boundaries, honest readiness, sensible sequencing, owner communication.

**Each module agent owns its module's superiority.** Its mandate: make the module **at least 3x–10x more powerful,
more seamless, friendlier and more well-rounded than anything on the current market** — measured, not claimed:

| Dimension | Measured as (examples) |
|---|---|
| Powerful | capability coverage vs parity matrix (P0/P1 tested), automation of manual steps, depth for resorts/groups |
| Seamless | steps and screens per task, re-typing eliminated, context preserved across modules, cross-module consistency |
| Friendly | training time to independence by role, errors per task, help needed, clarity of errors/recovery |
| Well-rounded | edge cases handled (catalogue), adoption modes (standalone/connected), Maldives + global readiness |

Inputs each module agent works from:
1. Its spec (`docs/specs/<module>.md`) and parity matrix + edge-case catalogue (`docs/parity/<module>.md`).
2. Market research: `docs/research/*` incl. the deep dive and its digest (`05-*`).
3. Its **10x brief** from the gap strategist (`docs/strategy/modules/<module>.md`): current state, gaps vs market,
   desired outcomes with measurable targets (labeled as targets until validated with hotel staff).
4. Steward review findings (`docs/orchestration/reviews/`).

Loop per module: brief → build → steward review → fix → merge → measure against targets → next brief.
The orchestrator resolves cross-module conflicts, keeps contracts in `docs/architecture/domain-map.md` current, and
never lets a module optimise locally at the expense of the whole (e.g. one module's shortcut that breaks another's
invariant or the shared experience).

Research flow: deep dive (`docs/orchestration/research-prompt.md`, exhaustive report + bibliography) → digest
(summarised, de-duplicated, mapped to modules and process) → gap strategist (reviews research + actual
implementation of every module and the whole platform) → 10x briefs and a platform gap plan → module agents.

## UX refinement loop

Black-box tester (no build context) → refining agent (knows how it's built and the best outcome) → module agents
decide & implement → orchestrator oversees and re-measures. Details: `docs/ux/README.md`.

## Quality steward: the meta loop (owner direction, 2026-11-07 16:52)

A dedicated agent is in charge of every *checking* agent: steward reviewers, the black-box tester, the UX refiner,
scenario tests, parity researchers and the gap strategist. After each round it:
- measures the checkers (precision, recall, evidence, coverage, cost);
- traces every late-found defect to the loop that should have caught it (`docs/quality/escapes.md`);
- improves their versioned playbooks (`docs/quality/playbooks/`);
- plants canary defects to measure recall;
- keeps the attack and UX-trap pattern library.

Checkers launch from their latest playbook. The orchestrator applies playbook changes that never weaken a gate.
Details: `docs/quality/README.md`.

The orchestrator runs from `docs/quality/playbooks/orchestrator.md` (latest) and is measured in `docs/quality/scorecard.md` § 9.

## Capability scouting: keep adding what makes Portico stronger (owner D14, 2026-11-07)

After every wave, the gap strategist re-scans the market (research digest, competitor releases, parity gaps,
black-box findings) and proposes additions to `docs/strategy/gap-plan.md`. The orchestrator adopts an addition only if
it passes the **vision-fit test**:
- (1) it serves a named persona's real hotel task, with a measurable outcome;
- (2) it strengthens truthful operations, depth without weight, the adoption ramp or honest readiness, and never
  trades them away;
- (3) it isn't already covered by a move or a module;
- (4) it isn't overkill for where Portico is going: no enterprise-only machinery before the segment needs it;
  progressive disclosure keeps a guesthouse simple.

Adopted additions get a brief, parity rows and a place in the sequencing. Rejected ones are logged with the reason.

