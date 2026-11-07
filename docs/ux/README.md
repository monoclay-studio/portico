# UX refinement loop (owner direction, 2026-11-07)

Goal: the user experience is **as easy as humanly possible — the best on the market** — while Portico still does
everything competitors do **and more**: better, faster, more streamlined, with easier visuals and flow, **without
missing anything and without weakening any module's power**.

## It never stops (owner direction): continuous loop

The loop runs **continuously** — refined over and over until the application is in its best form, with the best
experience for a **completely new user** adapting with the least friction.

- **Triggers:** (a) any merge to `main` that touches UI or a module with UI → a round focused on what changed;
  (b) a scheduled heartbeat every 3 hours starts the next round if none is running (owner-visible scheduled task);
  (c) every 3rd round is a full sweep of all personas and modules.
- **One round at a time:** tester → refiner → module owners → re-measure. The lab is rebuilt from the latest code
  each round (`tools/ux-lab.sh refresh` then `tools/ux-lab.sh start`).
- **Scorecard:** `docs/ux/scorecard.md` — trends per round; new-user metrics first.
- **Convergence:** full-speed until two consecutive rounds find no blocker/major friction AND every new-user target is
  met; then **maintenance mode** (a round after each release and a monthly full sweep) — never fully off.
- **Guardrails:** one tester at a time; usage-limit aware (pause and resume, never pile up); changes go through the
  normal review/merge gates; nothing in the loop may weaken power, permissions or reconciliation.

## The loop (each round)

**Launch from playbooks (quality steward, 2026-11-07):** the tester runs from `docs/quality/playbooks/blackbox-tester.md`
and the refiner from `docs/quality/playbooks/ux-refiner.md` (latest versions). Before the refiner starts, the
orchestrator runs hand-off checks H-1 to H-4 from the refiner playbook:
- every finding has a stable ID;
- every cited screenshot exists and shows what the finding claims;
- the copy into `docs/ux/round-N/` is complete;
- nothing was compressed away.

The refiner verifies every screenshot it cites and returns its summary in its final reply.

1. **Black-box tester ("mystery user").** Uses the running product only through the browser, as different hotels and
   roles (12-room guesthouse owner on a phone, 120-villa resort front desk at the morning rush, reservations,
   housekeeping on a tablet, night audit, finance, multi-property group director, IT admin, a brand-new hire).
   **No context of how it is built** — it may not read source, specs or docs; it only gets URLs, demo logins,
   personas and realistic hotel tasks. It records per task: completed?, steps/clicks/keystrokes, time, hesitations,
   wrong turns, dead ends, errors, unclear wording/visuals, and everything a real hotel would expect but cannot find.
   Output: `docs/ux/round-N/blackbox-findings.md` + screenshots.
2. **Refining agent.** Reads the findings, then looks at **how each module is built** and **our best outcome**
   (vision, design direction, experience architecture, specs, parity, market research). Produces per-module
   refinements: problem + evidence, proposed change, expected measurable outcome (steps/time/errors), and an explicit
   **power check** (nothing competitors do is lost; no capability removed or hidden from those who need it).
   Output: `docs/ux/round-N/refinements/<module>.md`.
3. **Module agents** (owners, see `docs/orchestration/operating-model.md`) decide for each refinement whether it makes
   the **overall** experience better, implement the accepted ones, and record decisions with reasons
   (`docs/ux/round-N/decisions/<module>.md`). Rejections need a reason the orchestrator can review.
4. **Orchestrator (vision owner)** oversees: resolves conflicts between modules, keeps one consistent experience
   (shared verbs, components, navigation), and decides when the next round runs. Measures before/after with the
   same tasks — improvements are claimed only when the next black-box round confirms them.

Rules: speed never comes from hiding errors, weakening permissions or skipping reconciliation (adoption brief §14);
progressive disclosure may move rarely used power behind one click, never remove it; usability targets are labeled
targets until validated with real hotel staff.
