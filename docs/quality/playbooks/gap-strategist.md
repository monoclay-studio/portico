# Gap strategist (L5) — playbook

| | |
|---|---|
| **Current version** | **v2** (2026-11-07, round 0) |
| **Theme of v2** | Journey-lens coverage: walk the whole guest stay, every staff day and every adoption path, so that no step has no owner |
| **Previous** | `archive/gap-strategist-v1.md` (the brief of run 1, verbatim) |
| **Launch** | Per wave (`README.md` L5). Run 1 is still running under v1; v2 applies from the next run, or as a follow-up message to run 1 if the orchestrator chooses |
| **Measured by** | `scorecard.md`: scope gaps later found by the owner or by audits (round 0: 1, E-024); journey steps with no owner; module agents' use of the briefs (increments accepted) |

## Change log

| Version | Date | ID | What changed | Why | Prompted by | Measured next round by |
|---|---|---|---|---|---|---|
| v1 | 2026-11-07 | — | Run-1 brief: research, promises, parity, built code and UX inputs, giving `gap-plan.md` plus one 10x brief per module (current state, best on the market, gaps, 10x targets, next 3 increments, dependencies, power check) | Baseline | — | First result |
| v2 | 2026-11-07 | **GS2-1** | **Journey walks.** Before the module briefs, walk end to end: (1) a guest stay, from discovery and booking through pre-arrival, the transfer, arrival, the stay, departure and post-stay; (2) one shift for each persona in `docs/product/personas-and-workspaces.md`; (3) each adoption path (connect alongside, replace selected capabilities, full migration) through demo, trial, read-only, pilot and production. Each step maps to its owning module, or **"no owner"**. Steps with no owner become ranked gaps in the plan | The owner found keys and the whole guest stay missing (07:58, "an important thing you missed"), after a module-by-module catalogue had produced 18 specs. The later audit found 235 touchpoints and 5 new specs | E-024 | Scope gaps found later by the owner or by audits: target 0. Steps with no owner, listed with a sequencing decision |

### Queued for later versions (one theme each)

- **v3, failure-class strength.** In each module brief's "current state", report the open escapes and the patterns
  not yet probed for that module (`docs/quality/escapes.md`, `scorecard.md`) beside the parity percentage. This keeps
  "powerful" from meaning "many features".
- **v4, target validation plan.** Every 10x target names how and when it will be validated with hotel staff, and the
  readiness level that validation reaches (CLAUDE.md §7).

---

## Run parameters (filled by the orchestrator)

```
WORKTREE / BRANCH:  /home/user/wt/strategy (docs/strategy)
WAVE:               <wave and the modules in scope>
UNMERGED BRANCHES:  <read-only list>
QUESTION RANGE:     next free Q number in docs/OPEN_QUESTIONS.md
```

## Launch brief (v2)

v2 is the v1 brief (`archive/gap-strategist-v1.md`) with one addition to "Produce".

````text
- **docs/strategy/journeys.md** — journey walks (do this BEFORE the module briefs):
  1. A guest stay end to end: discover → quote/book (direct, OTA, tour operator, group) → pre-arrival (payment,
     documents, transfer, requests) → transfer (seaplane, speedboat, domestic flight; delays) → arrival and check-in
     (keys) → the stay (dining, spa, activities, housekeeping, maintenance, charges, complaints) → departure (bill,
     split, transfer back) → post-stay (invoice, feedback, data rights).
  2. One shift for each persona P1–P17 in docs/product/personas-and-workspaces.md (front desk through guesthouse
     owner, including F&B cashier, spa/activities, transfer coordinator, sales & events and guest relations), plus a
     brand-new hire on day one.
  3. Each adoption path in docs/product/adoption-integration-brief.md (connect alongside / replace selected
     capabilities / full migration) through demo → trial → read-only connection → pilot → production.
  For every step: the owning module (spec section), its state (built/tested on main, specified, missing), and
  **"no owner"** where no module or spec covers it. Rank the no-owner steps in gap-plan.md and add each to the brief of
  the module that should own it (or propose a new module).
````

**Reply addition:** the number of journey steps walked, and the steps with no owner (top 10 in plain English).
