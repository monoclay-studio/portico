# Self-improving quality system

**Owner direction (2026-11-07 17:05 UTC):** "let's make another agent who is in charge of these testing agents. see
the way they are testing and refine their process and how they go through the flow each time. basically let's create
a very very intelligent self improving system with many feedback loops."

Portico is built by many agents. Some build. Others **check**: steward reviewers, black-box UX testers, refiners,
scenario tests, parity researchers and the gap strategist. This system makes the checkers themselves get better every
round. Each round is measured, missed defects are traced back to the loop that should have caught them, and that
loop's playbook is improved. A loop that is never measured cannot improve, so everything here is measured.

## The loops

| # | Loop | Who runs it | Cadence | Catches | Measured by |
|---|---|---|---|---|---|
| L1 | **Code gates**: lint, forced typecheck, unit and integration tests, boundaries | every agent; orchestrator at merge | every commit / merge | regressions, type and contract drift | green on a merged copy; flaky-test rate |
| L2 | **Steward review**: independent review with attack and counterexample tests | review agents | every branch "done", then every fix round | security, isolation, money, concurrency, contract bugs | findings by severity; **escapes** (defects found later); false positives; time to verdict |
| L3 | **Scenario proof**: S01–S20 end to end, plus global consistency checks | integration engineer | every merge batch | cross-module breaks | scenarios passing; consistency violations |
| L4 | **UX loop**: black-box tester → refiner → module owners → re-measure | UX agents | continuous (heartbeat every 3 h) | friction, dead ends, confusing language | new-user metrics (`docs/ux/scorecard.md`); tasks completed; refinements accepted vs rejected |
| L5 | **Market loop**: research → digest → gap strategist → 10x briefs → module rounds | research and strategy agents | per wave | gaps vs competitors | parity gate %; 10x targets met |
| L6 | **Usage loop**: guardrail checks, pause, checkpoint, scheduled resume | orchestrator | every ~20 min | running out of budget mid-work | work lost on pause (target 0); utilization pacing |
| L7 | **Owner loop**: directions → decisions → chronicle | owner + orchestrator | as it happens | wrong assumptions | open questions answered; reversals |
| **L8** | **Meta loop: the quality steward** | **quality-steward agent** | after every L2/L3/L4/L5 round, plus a weekly meta-review | **loops that test badly** | playbook versions; each checker's precision, recall and cost; escape rate trend |

## How the meta loop (L8) improves the others

1. **Observe.** After every round of a checking loop, the quality steward reads:
   - the checker's brief and its full report, in `docs/chronicle/agents/`;
   - its outputs (reviews, findings, refinements);
   - what happened next downstream: what owners accepted or rejected, and what later loops found.
2. **Measure each checker.**
   - **Precision:** findings that were real and acted on, out of findings raised.
   - **Recall:** defects it caught, out of defects that existed. Estimated from escapes and from canaries (step 5).
   - **Evidence quality:** reproducible, with file:line or screenshot, stable IDs.
   - **Coverage:** personas × tasks × modules; review dimensions.
   - **Cost:** time and tokens.
3. **Escape analysis.** This is the core of self-improvement. Every defect found *later than it should have been* is
   traced to the earliest loop that could have caught it, together with the missing check. Late means found by a
   later loop, after merge, by the owner, or by a second review. The missing check is added to that loop's playbook
   (`escapes.md`).
   - Example: a cached typecheck hid real type errors. Root cause: turbo task inputs. New L1 check: forced gates.
   - Example: the first identity review missed pre-hijacking. New L2 check: the "who controls this email/identity
     before the person does" attack class.
4. **Improve the playbooks.** Each checker works from a versioned playbook (`playbooks/<checker>.md`) with a change
   log saying what changed, why, and which escape or metric prompted it. Changes are small and attributable: one theme
   per version, so the next round's metrics show whether it helped. Changes that make no difference are reverted.
5. **Test the testers (canaries).** Known defects are planted in a disposable copy, never on main or a real branch,
   and we check whether the checker finds them:
   - for L2, a scratch branch with seeded bugs (an IDOR, a missing tenant filter, a double-post on retry, a
     non-idempotent webhook);
   - for L4, a lab build with seeded UX traps (a dead button, a mislabelled total, a hidden error).

   This measures recall directly, without waiting for real escapes. The canary catalogue is kept in
   `canaries.md`. Canary runs are budgeted: at most one per checker per week while usage is constrained.
6. **Cross-pollinate.** An attack or test that worked in one module becomes a standard check for every module (the
   attack-pattern library in `patterns.md`). A UX rule that fixed one screen becomes a consistency rule (C1–C12 in
   `docs/ux/round-1/summary.md`).
7. **Report.** After every round, the steward adds a short retrospective to `retros/<date>-<loop>.md` and a
   line in `scorecard.md`. Playbook changes it proposes are applied by the orchestrator, the vision owner. The
   steward never edits product code, never weakens a gate, and never lowers a bar to improve a metric.

## Artifacts

| File | Purpose |
|---|---|
| `scorecard.md` | One row per checker per round: precision, recall estimate, escapes, evidence quality, coverage, cost, playbook version |
| `escapes.md` | Every late-found defect: where found, where it should have been caught, why it was missed, the check added |
| `patterns.md` | Attack, test and UX-trap patterns that worked, reusable across modules |
| `canaries.md` | Seeded-defect catalogue, canary runs and results |
| `playbooks/*.md` | Versioned playbooks: steward reviewer, black-box tester, UX refiner, scenario tests, parity researcher, gap strategist, module builder (self-check before "done") |
| `retros/*.md` | Per-round retrospectives |

## Guardrails

- Measured, not claimed: a playbook change counts as an improvement only when the following round's metrics show it.
- No metric gaming: precision is never improved by raising fewer findings, and recall never by flooding.
- Checkers stay independent. The black-box tester never receives build context through a playbook, and reviewers
  never see the builder's own self-assessment before they reach their own verdict.
- Usage-aware: retrospectives are cheap and run every round. Canary runs and the weekly meta-review are skipped when
  the seven-day usage is ≥ 80%.
