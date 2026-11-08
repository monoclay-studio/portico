# UX scorecard (continuous loop)

One row per round. Targets are TARGETS until validated with real hotel staff. "New user" = the black-box tester's
zero-knowledge personas (no build context, no prior Portico use).

## Core metrics

| Metric | Target | R1 | R2 | R3 |
|---|---|---|---|---|
| Core tasks completed unaided by a new user (%) | 100 | **15** (5 of 34) | | |
| Blocker + major friction findings (count) | 0 in two consecutive rounds | **27** (14 blocker + 13 major) | | |
| Median clicks per core front-desk task | ≤ OPERA/Mews equivalent ÷ 3 (baseline from research) | **n/a** | | |
| Time for a new hire to first successful check-in (min) | ≤ 10 | **not achievable** | | |
| Times help was needed per persona | ≤ 1 | **n/a** | | |
| Error messages that did not explain recovery | 0 | **4** + boilerplate on every error | | |
| Keyboard-only completion of desk tasks (%) | 100 | **partial** | | |
| Accessibility serious/critical violations | 0 | **2 serious rule types** + 1 WCAG 2.4.3 failure | | |
| Capabilities lost or hidden by refinements | 0 (power check) | **0** | | |

## New-user metrics (added in round 1)

| Metric | Target | R1 | R2 | R3 |
|---|---|---|---|---|
| Distinct dead ends met | 0 | **15** | | |
| Distinct developer terms visible to staff | 0 | **≥ 14** | | |
| Search: correct first result on the round's lookup set | 100% | **3 of 9** | | |
| Palette: right action first for action words | 100% | **0 of 17** | | |
| Today tiles with a wrong, mismatched or missing destination | 0 | **4 of 6** | | |
| Keystrokes from an arrival row to the check-in sheet | ≤ 2 (3 incl. confirm) | **17 Tabs + Enter** | | |
| Horizontal page overflow at 1024×768 (px) | 0 | **111** | | |
| First operational number from the top, phone 390×844 (px) | ≤ 300 | **≈ 830** | | |
| Screens whose help panel has content (%) | 100 | **0** | | |
| Roles able to open a training organization in 1 click | all | **1 of 3 tested** | | |

## Evidence and handling (added in round 2a)

Focused rounds (2a, 2b…) re-test only the changed screens, so they do not fill the core columns above. Their
evidence quality and handling are measured here.

| Metric | Target | R1 | R2a |
|---|---|---|---|
| Cited evidence files present after hand-off | all | n/a (not checked) | **74 of 74** |
| Findings with a stable ID | all | 0 (none had IDs) | **49 of 49** |
| Earlier "Done" decisions refuted on re-test | 0 | n/a | **4 of 7** (NAV-07, NAV-08, C3/C9, FD-13/C4; `docs/quality/scorecard.md` § 4.1) |
| Findings with a disposition (`tools/quality/dispositions.py`) | all | n/a | **49 of 49** (2026-11-07, after quality round 3) |

## Round log

| Round | Date | Tester | Refinements | Decisions |
|---|---|---|---|---|
| R1 | 2026-11-07 | 9 personas, 34 tasks, 70 screenshots (`round-1/blackbox-findings.md`) | 83 in `round-1/refinements/`: 44 (a) wiring · 6 (b) missing · 33 (c) design; 23 blocker · 46 major · 14 minor | pending (`round-1/decisions/`) |
| R2a (focused) | 2026-11-07 | 4 personas, changed screens only, 74 cited files (`round-2a/blackbox-findings.md`) | none (triage-only, routed by cause) | 49 of 49 dispositioned in `docs/orchestration/pending-fixes.md` |

## R1 baselines: how they were measured

All R1 figures come from `round-1/blackbox-findings.md`, except the accessibility figure, which comes from the steward
review.

**Context for every figure.** Arrivals, Timeline, Housekeeping, My work, Today KPIs and the Change preview were
**simulated** in R1. The modules merged the same day, and the UI was not yet bound to them. Most failures are wiring
gaps. Re-measure with the same tasks once the modules are bound.

### Core metrics

- **Core tasks completed: 15%.**
  - The task tables give 34 tasks across 9 personas.
  - 5 were fully done: sign in, partial-name search, confirmation-code search, add a property-scoped user, and see
    arrivals.
  - 1 more was "yes/partly": blocked arrivals. Counting it gives 18%.
  - 11 were partly done and 18 were not done.
- **Blocker + major: 27.** Task-level severities in the persona tables: 14 blocker, 13 major and 5 minor. All 20 of
  the ranked top-20 frictions are blocker or major.
- **Median clicks: n/a.**
  - Check-in, walk-in, move, check-out and payment could not be completed, so a click count would not be comparable.
  - The 6 desk tasks that were at least partly possible had a median of 3 interactions.
  - The competitor baseline has not been measured yet.
- **First check-in: not achievable.** Check-in was a simulated toast and the stay stayed *Expected*.
- **Help needed: n/a.**
  - Every help panel and lesson was empty.
  - 2 of 9 personas (P1 and P9) looked for help, and 0 got an answer.
  - Count "help needed" from round 2, once help has content (HLP-01).
- **Errors without recovery: 4.**
  - Property save showed raw JSON and advised reloading.
  - Invite validation showed raw Zod text with "Reference: client".
  - The forbidden page showed a permission code and the Invite button stayed.
  - The extend conflict told the user to "Choose a room move" while Move was disabled.
  - Separately, "Trying again unchanged will fail the same way" was appended to every error.
- **Keyboard: partial.**
  - Every existing desk action could be reached, but it took 17 Tabs from an arrival row to Check in.
  - There were no action keys, and `N` was a dead end.
- **Accessibility.** From the steward review, full axe run:
  - `label-content-name-mismatch` (serious) on every screen;
  - `nested-interactive` (serious) on 18 nodes in the palette;
  - drawer focus failing WCAG 2.4.3, found manually.
  - The tester also found radio buttons announced by UUID.
- **Capabilities lost: 0.** No refinement had shipped yet, and all 83 proposals carry a power check.

### New-user metrics

- **Dead ends: 15.**
  1. The walk-in cell toast.
  2. `N` pointing to a palette with no commands.
  3. The palette having no create or action commands.
  4. A guest-profile search result that does nothing.
  5. The extend conflict, with Move disabled.
  6. "Check status" text with no button.
  7. A failed inspection with no action.
  8. "2 inspected and free" with no Assign.
  9. The In-house tile opening the housekeeping board.
  10. The Payments tile opening a list with no payments in it.
  11. The Departures tile not clickable.
  12. A hold bar opening the villa.
  13. Check-in progress steps that cannot be done.
  14. Mark inspected leaving the state unchanged (simulated).
  15. `/integrations` returning 404.
- **Developer terms: ≥ 14.** See top-20 friction #13, polish and refinement NAV-09.
- **Search lookups: 3 of 9.** The lookup set was:
  - Kowal, beck, lukas, anna k;
  - P2's partial name;
  - +960, 7712;
  - 2QMG;
  - villa 208, which returned the villa plus noise.
- **Palette: 0 of 17.** The action words were walk, new, book, reserv, check, pay, clean, day close, audit, close,
  end of day, folio, invoice, company, ledger, connect and integration.
- **Today tiles: 4 of 6.**
  - Departures is not clickable.
  - In house goes to the wrong place.
  - Arrivals ready shows 9 against 7.
  - Payments pending does not reconcile.
- **Phone first number: ≈ 830 px.** On P1's Today, the banner, the checklist and the simulated notice come before
  the first number.
- **Training access: 1 of 3.** Only the group director had a training organization. The front-desk agent and the
  night auditor did not.
