# UX refinement loop (owner direction, 2026-11-07)

Goal: the user experience is **as easy as humanly possible — the best on the market** — while Portico still does
everything competitors do **and more**: better, faster, more streamlined, with easier visuals and flow, **without
missing anything and without weakening any module's power**.

## The loop (repeats every UX round, and for every module as its UI lands)

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
