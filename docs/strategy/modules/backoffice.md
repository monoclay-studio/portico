# backoffice (staff web app, `packages/ui`) and the staff PWA — 10x brief

Status: v1 · 2026-11-07 · Gap strategist · Branch `feat/backoffice-core` (fix round in progress, not merged) · ADR-0013 ·
Design: `docs/product/design-direction.md`, `experience-architecture.md`, `ux-principles.md` · UX loop
`docs/ux/README.md` · Source key: `docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated with
hotel staff.**

## 1. Current state (evidence)

- **Real against the API (R3):** sign-in with organization choice, session handling, `/v1/me`, organization,
  properties + switcher, legal entities, users & roles, property settings with `If-Match` and the 409 dialog (yours vs
  theirs), global search + command palette on `/v1/search`, record summaries and history (README-backoffice § Status).
- **Simulated (R2, badged SIMULATED):** arrivals board with readiness and single blocker, housekeeping board, timeline,
  extend-stay preview, Today dashboard, My work, stay/unit/guest records. Learning layer (help anchors, learning centre,
  first-run checklist, training org switch) with empty content by design.
- **Steward review:** P0-1 cached data leaking to the next user on a shared tab; P1-1 drawer focus, P1-2 uncertain
  writes reported as "safe to retry", P1-3 unknown statuses crash, P1-4 arrivals blocker unreadable at desk widths,
  P1-5 no selection/bulk/list keys, P1-6 mock layer not swappable (REV-backoffice). Fix commits on the branch cover
  P0-1, P1-1, P1-2, P1-3, P1-5, P1-6 (incl. Departures and In-house lists); **P1-4 and re-verification pending**.
- **UX1 (8 of 9 personas blocked):** no create commands; key actions disabled with "module connected (wave 1)" text;
  no checkout/folio/payment/Day Close/finance/integrations areas; search narrow; 1024 px overflow (drawer Close
  off-screen); raw Zod JSON and "Reload the page" advice; developer jargon; help and lessons empty; phone experience a
  squeezed desktop; contradictory simulated states. **Praised:** arrival readiness model, change preview, honest payment
  language, provenance banners, keyboard model (`G`+letter, `/`, `?`), consistent record drawers, self-explaining
  disabled buttons, role landing, Maldives-aware arrival details, dark mode (UX1 top-10).
- **Staff PWA (`apps/staff`):** not started; operations' offline sync API is ready (README-operations OPS-R21–R23).

## 2. Best on the market today

| Area | Who does it best | How | Source |
|---|---|---|---|
| Approachable UI | Mews | "Easy" for OPERA switchers; Timeline density/zoom; app-less guest portal | R02 §2.6–2.7 |
| Mobile staff | Stayntouch | Tablet desk, mobile housekeeping with forward planning | R02 §4.3 |
| Completeness (but heavy) | OPERA | Click-heavy, crowded, slow on weak internet, cannot be learned in a shift | R01 §2.3 |
| Embedded AI assistance | OPERA 26.4 | AI reservation summary at check-in; previews for generated text | DD02a §1.3 |
| Training | Mews University; Stayntouch Academy 2.0 | Separate training sites | R02 §2.7; DD07 §3 |

No vendor publishes time-to-competency or task-step counts (DD03 §2.2, §11).

## 3. Gaps vs market (ranked)

| # | Gap | Why it matters | Evidence |
|---|---|---|---|
| 1 | Swap every simulated workspace for the live API as modules bind (M1); remove "module connected" copy | Nothing can be done today | UX1 top-20 #1–#7 |
| 2 | Command surface: create commands in the palette (`N` → new booking/walk-in/quote), action hotkeys (C check in, M move, P pay), actions from the registry (gap plan M2) | Keyboard-first desk | UX1 persona 2 keyboard pass |
| 3 | Missing workspaces: checkout + folio + split, payments (take/record/verify), Day Close, finance, connections, policy centre, portfolio Today | Personas 1, 2, 5, 6, 7, 8 blocked | UX1 personas |
| 4 | Responsive layout: 1024 px tablet without overflow, collapsible navigation, phone-first Today (day first, banners compact) | Tablet supervisors, phone owners | UX1 top-20 #10, #17 |
| 5 | Error and copy contract: no raw validation, no "reload", no developer terms, recovery in every error | Friendly | UX1 top-20 #12–#13 |
| 6 | Search UX over all providers incl. phone/email/past stays; selecting a result always opens it | Find anything | UX1 top-20 #8 |
| 7 | Staff PWA: my rooms, start/done, inspect, DND, lost & found, offline queue with visible sync | Housekeeping blocked | UX1 persona 4 |
| 8 | Learning content and guided tasks; personal training org for every role | New hire "partly" | UX1 persona 9 |
| 9 | Arrivals board readable at 1280–1440 px (P1-4) | The one job of the board | REV-backoffice P1-4 |
| 10 | Staff languages and RTL (Dhivehi) | Maldivian staff | README-backoffice Q1; Q155 |

## 4. The 10x outcome (TARGETS)

**Picture:** one calm product where every record looks and behaves the same, every action is one keystroke or tap from
wherever the record appears, nothing is ever shown as done that isn't, and a new hire is productive on her first shift.

| Dimension | Metric | Today (UX1 baseline) | Market reference | Target |
|---|---|---|---|---|
| Powerful | Core tasks completed unaided by a new user | 5 of 34 (15%) | — | 100% (`docs/ux/scorecard.md`) |
| Powerful | SIMULATED badges on core shift screens with live modules | all operational screens | — | 0 |
| Seamless | Median interactions per core desk task | not measurable (blocked) | baseline to measure on competitor flows | ≤ ⅓ of the incumbent's flow; Tabs to reach "Check in" from a row ≤ 2 (today 17) |
| Seamless | "Go elsewhere and search again" hand-offs in the core task list | many | — | 0 |
| Friendly | Blocker + major findings per black-box round | 14 blockers + ≥ 15 majors | — | 0 in two consecutive rounds |
| Friendly | New desk agent independent on 10 core tasks | — | 4 months–3 years (DD03 §2.2, sponsored) | ≤ 4 h training, 1 shift |
| Friendly | Error messages without a recovery step / raw technical text | several | — | 0 / 0 |
| Well-rounded | Accessibility serious/critical violations (axe, light + dark, keyboard-only) | drawer failure fixed on branch; re-verify | EAA applies to booking flows (DD05 §4) | 0; 100% keyboard-only completion of desk tasks |
| Well-rounded | Viewports supported without horizontal scroll: 390, 768, 1024, 1280, 1440, 1920 | overflow at 1024 | — | all |
| Performance | Interaction feedback / list load / search | not measured | — | ≤ 100 ms / ≤ 1 s p95 / ≤ 300 ms p95 (UXP §19) |

## 5. Next 3 increments

### Increment 1 — Finish the fix round and make the copy honest
- Close P1-4 with the steward's arrivals layout proposal (`docs/orchestration/reviews/backoffice/
  proposal-arrivals-layout.diff`); re-verify P0-1…P1-6; error and copy contract (field-level messages, no raw schema
  text, no "reload", plain-language recovery, hotel vocabulary instead of module/wave terms) enforced by a string lint;
  1024 px layout with collapsible navigation; simulator made consistent (no guest in two villas, no "Paid" with a
  balance, counts that agree) so demos never lie; merge.
- **Acceptance:** steward re-review clean; UX1 frictions #10, #11 (simulated), #12, #13 resolved in the round-2
  black-box run; axe 0 serious/critical at all six viewports.

### Increment 2 — Live desk loop with the command surface
- Bind arrivals, departures, in-house, timeline, stay/booking records, check-in/out, move, extend, cancel and walk-in
  to the live reservations/finance/payments APIs as they land (integration step); palette with create commands and the
  action registry; action hotkeys; focus moves into the drawer; search results open records for every provider;
  "Take payment / Record cash / Record transfer / Check status" on folio and arrivals rows.
- **Acceptance:** UX1 personas 1–3 tasks complete through the UI on live data in round 2; walk-in ≤ 3 screens;
  Tabs-to-check-in ≤ 2; UXP §19 desk targets timed in an internal run (labelled internal, not staff-validated).

### Increment 3 — Staff PWA v1 and the missing workspaces' shells
- `apps/staff` PWA on operations' sync API: my rooms, start/done, inspect with reason/photo, DND, report issue, lost &
  found, visible sync status and conflicts; plus finance workspace, Day Close readiness page and connections area as
  thin shells over the APIs those modules expose (no simulated data — empty states that say what is coming).
- **Acceptance:** S13 walked end to end on a phone with airplane mode; condition update ≤ 2 taps; persona 4 tasks
  complete in round 3; no simulated data in the new shells.

## 6. Cross-module dependencies and contract changes

Kernel action registry and status families (gap plan §7.1); every module's search provider and record contract;
`listExceptions` common shape for My work; identity PIN switch, invite contracts, `mfa_required` handling (PF);
platform feature visibility API (progressive disclosure); operations sync API; finance/payments workspace read models;
day-close readiness API; integration connection journey API.

## 7. Power check — never lose or hide

Every capability the API exposes stays reachable (progressive disclosure hides by profile, never by accident); previews
before consequential changes; failed or uncertain actions never look successful (pending verification); provenance
banners for demo/training/simulated/copied/external data; 409 shows yours vs theirs; disabled actions keep their
reasons; keyboard paths for every desk action; density and dark mode preserved; no guest data left in browser storage.
