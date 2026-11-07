# UX round 1 — decisions for backoffice / packages/ui

Branch `feat/backoffice-core`, written at the end of the steward fix round (SR = steward review
`docs/orchestration/reviews/review-backoffice.md`). **Done now** = implemented and tested on this branch.
**Next round** = accepted, not started (the orchestrator asked to keep non-overlapping refinements for round 2).

## Consistency rules C1–C12

| Rule | Decision | Done now |
|---|---|---|
| C1 Shared verbs | Accepted | Partly: "Extend stay", "Move" wording kept; record verb keys `c/o/m/p/a` next round (FD-13) |
| C2 Navigation + go-to map | Accepted | Go-to map exactly as proposed (`g o/w/a/i/d/t/h/l/s`); section list only with ≥ 2 sections on wide screens, section tabs otherwise; hints only for real bindings. Date control (`[` `]`, URL) and view state in the URL: next round |
| C3 Status truth | Accepted | Unknown values → neutral chip, never a crash; Secured ≠ Balance ≠ Payment (no payment chip on stays); in-house never "Ready"; Estimate markers on balances and ready times |
| C4 Records, drawers, keyboard | Adapted | Enter opens, focus moves into the record (the record body, named by its title — not the heading element, so the first Esc and screen-reader context work the same in panel and modal mode); Esc returns focus to the row; non-modal split view with `j/k` at ≥ 1280 px, modal sheet below; width `min(560px, 100vw − 48px)`. Kbd hints on buttons and `Ctrl+Enter` confirm: next round |
| C5 Lists and numbers | Accepted | DataTable: column priority with "+n hidden" chip, quick filter over hidden text (`searchText`), selection + bulk bar, sticky identity column; Today tiles use the same queries as their lists (e2e asserts equality) |
| C6 Previews | Accepted | Infeasible preview shows blockers and Confirm stays disabled; `preview_stale` rendering arrives with the real reservations preview (SR P2-13) |
| C7 Messages | Accepted | Lost connection on a write = pending verification with "Check what was saved"; no retry boilerplate; support reference small and hidden for client-side ids |
| C8 Language | Accepted | Developer terms removed from staff copy (wave, module, scenario ids, help codes, role codes, request keys, demo-seeder); plain "not available in this demo yet". CI copy lint: next round (NAV-09) |
| C9 Provenance and environment | Accepted | One provenance badge per page (header) + one plain sentence; banner never dismissible; sample data made consistent (SR P2-1). Collapsing notes after first view: next round |
| C10 Touch and devices | Adapted | No horizontal scroll at 1024 px asserted in e2e for the boards; the full 360–1440 route matrix is next round (NAV-05) |
| C11 Permissions shown honestly | Accepted | Invite hidden when the server refuses the list; record actions disabled with reasons; invite defaults to the current property |
| C12 Create and find | Accepted | Next round (NAV-01/02) |

## Refinements owned by backoffice/ui

| Id | Decision | Reason | Done now / next |
|---|---|---|---|
| NAV-01 Palette runs actions, speaks hotel | Accepted | Same registry should drive buttons, palette and `?` | Next round (palette lists today's stays from the desk source now) |
| NAV-02 `N` always creates | Accepted | — | Next round |
| NAV-04 Nothing silently does nothing | Accepted | — | Partly: unavailable actions say "not available in this demo yet. Nothing was changed."; full audit next round |
| NAV-05 Navigation fits the device | Adapted | Rail + tabs at mid widths instead of a flyout (fewer layers, same reach) | Done for 1024–1440 (e2e no-overflow at 1024); phone bottom bar next round |
| NAV-06 Phone: first screen is the day | Accepted | — | Next round (source note is one line now) |
| NAV-07 Every number opens its list | Accepted | — | Done: Today tiles = same queries as Arrivals / In house / Departures / My work; e2e asserts the Arrivals tile equals the list's "All" chip |
| NAV-08 Errors that help you recover | Accepted | — | Done: field validation in staff language, 403 without permission codes, sign-in 401 explains recovery, no raw exception text; inline field errors existed |
| NAV-09 Staff language + CI copy lint | Accepted | — | Copy cleaned now; the lint script is next round |
| NAV-10 Touch-safe links and previews | Accepted | — | Next round |
| NAV-11 Hotkeys ready on first paint | Accepted | — | Next round |
| NAV-12 Property and business date readable | Accepted | — | Done: switcher's accessible name starts with its visible name and business date |
| NAV-13 "Room" or "villa", not "unit" | Accepted | Needs the noun from platform/inventory | Next round (sample data already says Villa/Room) |
| FD-03 Never "Paid" while money is due | Accepted | — | Done: Secured + Balance (estimate) columns; no payment chip on stays; simulator says Paid only at zero balance (test) |
| FD-06 Departures and In-house lists | Accepted | — | Done (simulated): one layout, `g d`/`g i`, tiles open them; per-payer balances and check-out state need finance/reservations |
| FD-08 Primary button = next valid action | Accepted | Needs module `allowedActions` ordering | Next round |
| FD-13 Row to Check in in three keys | Adapted | `e` on a row opens the record (the check-in sheet does not exist yet); `c/o/m/p/a` next round | Enter / `e` / `j` / `k` / `x` done; skip link exists |
| FD-14 Arrivals on a phone | Accepted | — | Done: full blocker wraps on phone cards; count chips filter (sticky) |
| HK-09 Board fits a tablet | Accepted | — | Partly: column priorities, no page overflow at 1024; supervisor scan columns next round |
| HLP-01 Built-in help now | Accepted | — | Next round (help codes no longer shown to staff) |
| HLP-02 Help matches the device | Accepted | — | Next round |
| HLP-03 Learning centre shows what exists | Accepted | — | Next round (lesson codes hidden now) |
| HLP-04 Guided practice tours | Accepted | No tour engine yet (category b) | Next round, after HLP-01/03 |
| HLP-06 First-run checklist fits the person | Accepted | — | Next round |
| RSV-09 Availability on Today in rooms | Accepted | — | Next round (occupancy tile already shows occupied / sellable units) |

## Shared refinements where the back office has a part

| Id | Decision | Done now |
|---|---|---|
| GST-01 Guest found in search opens a record | Accepted | Next round (with the guests module) |
| GST-03 VIP and alerts on headers | Accepted | VIP tag on desk rows from operations; headers next round |
| HK-03 Plan and assign the day | Accepted (UI part) | Shared DataTable now has selection + bulk bar; the assignment preview is operations' |
| PAY-02 Pending verification + Check now | Accepted | The "check what was saved" pattern exists for property saves; payments' Check now next round |
| SET-01 Least privilege, several roles | Adapted | Invite defaults to the current property; several roles per invite needs identity's API |
| SET-02 Phone sign-in without retyping | Accepted | Next round |
| SET-08 Labels people read | Accepted | Role names instead of codes; roles deduplicated in the account menu |
| SET-10 Demo settings tell the truth | Accepted (UI part) | "demo-seeder" shown as "System setup"; seed status is platform's |

Nothing was rejected. Four items are adapted (C4 focus target, NAV-05 mid-width pattern, FD-13 key set, SET-01
scope) for the reasons given; each keeps the refinement's outcome.
