# Checker playbooks

Every checking agent launches from the **current version** of its playbook. The orchestrator fills in the run
parameters and hands over the launch brief (`docs/orchestration/operating-model.md` § "Quality steward").

How versions work:
- Each version carries **one theme**. Its change log says what changed, why, which escape or metric prompted it, and
  how the next round will measure it (`../README.md`, step 4).
- When a version is replaced, its full text moves to `archive/<checker>-v<N>.md`, and the current file keeps the
  change log.
- A **minor version** (for example v2.1) clarifies inside the current theme. Its change log row quotes the exact added
  text, so no archive copy is made.
- A change that the next round's metrics do not support is reverted in the next version, with the evidence.

| Checker | Loop | Current | Theme of the current version | Archive |
|---|---|---|---|---|
| Steward reviewer | L2 | [v2.1](steward-reviewer.md) | A pattern sweep with a declared coverage table (reverse order, attack the fix, sibling paths, privilege equivalence, UI sweep). v2.1: fixes stated as principles; load-bearing check | [v1](archive/steward-reviewer-v1.md) |
| Black-box UX tester | L4 | [v2](blackbox-tester.md) | Evidence integrity (stable IDs, verified screenshots, manifest) + orchestrator hand-off checklist | [v1](archive/blackbox-tester-v1.md) |
| UX refiner | L4 | [v2](ux-refiner.md) | Evidence and hand-off integrity (verify citations, reply carries the summary, traceability) | [v1](archive/ux-refiner-v1.md) |
| Scenario tests | L3 | [v3](scenario-tests.md) | v3: cross-module invariants and writer coverage. v2 still in force: real-path evidence | [v1](archive/scenario-tests-v1.md), [v2](archive/scenario-tests-v2.md) |
| Parity researcher | L5 | [v2](parity-researcher.md) | Gate truthfulness (asserting test on main for `tested`; failure-class edge cases) | [v1](archive/parity-researcher-v1.md) |
| Gap strategist | L5 | [v2](gap-strategist.md) | Journey-lens coverage (guest stay, persona shifts, adoption paths; "no owner" steps) | [v1](archive/gap-strategist-v1.md) |
| Module builder self-check | L1 (every agent) | [v4](module-builder-self-check.md) | v4: invariant closure (premise writers, repeat and inverse operations, own records, exemptions, tests that fail without the fix). v2 and v3 still in force | [v1](archive/module-builder-self-check-v1.md), [v2](archive/module-builder-self-check-v2.md), [v3](archive/module-builder-self-check-v3.md) |
| **Orchestrator** | L-orch | [v3](orchestrator.md) | v3: mechanisms over memory (derived and verified times, no force-push, flakes tracked). v2 still in force: exact hand-offs and records | [v1](archive/orchestrator-v1.md), [v2](archive/orchestrator-v2.md) |

Shared references: `../patterns.md` (probes), `../escapes.md` (why each change exists), `../canaries.md` (how recall is
measured; checkers must not read it), `../scorecard.md` (the metrics each change targets).
