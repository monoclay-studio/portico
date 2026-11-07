# Checker playbooks

Every checking agent launches from the **current version** of its playbook. The orchestrator fills in the run
parameters and hands over the launch brief (`docs/orchestration/operating-model.md` § "Quality steward").

How versions work:
- Each version carries **one theme**. Its change log says what changed, why, which escape or metric prompted it, and
  how the next round will measure it (`../README.md`, step 4).
- When a version is replaced, its full text moves to `archive/<checker>-v<N>.md`, and the current file keeps the
  change log.
- A change that the next round's metrics do not support is reverted in the next version, with the evidence.

| Checker | Loop | Current | Theme of the current version | Archive |
|---|---|---|---|---|
| Steward reviewer | L2 | [v2](steward-reviewer.md) | A pattern sweep with a declared coverage table (reverse order, attack the fix, sibling paths, privilege equivalence, UI sweep) | [v1](archive/steward-reviewer-v1.md) |
| Black-box UX tester | L4 | [v2](blackbox-tester.md) | Evidence integrity (stable IDs, verified screenshots, manifest) + orchestrator hand-off checklist | [v1](archive/blackbox-tester-v1.md) |
| UX refiner | L4 | [v2](ux-refiner.md) | Evidence and hand-off integrity (verify citations, reply carries the summary, traceability) | [v1](archive/ux-refiner-v1.md) |
| Scenario tests | L3 | [v2](scenario-tests.md) | Real-path evidence (binding manifest, assertion map, holds under the CI gate) | [v1](archive/scenario-tests-v1.md) |
| Parity researcher | L5 | [v2](parity-researcher.md) | Gate truthfulness (asserting test on main for `tested`; failure-class edge cases) | [v1](archive/parity-researcher-v1.md) |
| Gap strategist | L5 | [v2](gap-strategist.md) | Journey-lens coverage (guest stay, persona shifts, adoption paths; "no owner" steps) | [v1](archive/gap-strategist-v1.md) |
| Module builder self-check | L1 (every agent) | [v2](module-builder-self-check.md) | Re-verify every change in a fix round or merge (re-attack the fix; gate block on the merged tree) | [v1](archive/module-builder-self-check-v1.md) |

Shared references: `../patterns.md` (probes), `../escapes.md` (why each change exists), `../canaries.md` (how recall is
measured; checkers must not read it), `../scorecard.md` (the metrics each change targets).
