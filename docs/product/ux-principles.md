# Portico UX principles and interaction standards

Status: v1 · 2026-11-07 · Applies to every surface (back office, staff PWA, guest journey, connect & migrate,
developer platform). Implemented through `packages/ui` (ADR-0013). Specs reference sections of this document.

Portico's promise is that **complicated operations take less effort, cause fewer mistakes, are easier to see, and
feel safer**. Visual polish is not evidence of that (brief §15); the targets in §19 are.

## 1. The five questions every important record answers

Every booking, stay, folio, task, work order, group, connection and Day Close run shows, above the fold:

1. **State** — the record's own status (one vocabulary per concept, §4).
2. **History** — a compact timeline of what happened, by whom, from which system (expandable to full audit).
3. **Outstanding issues** — exceptions, pending verifications, conflicts, discrepancies, with severity.
4. **Owner** — the responsible person or team.
5. **Next actions** — the 1–3 most likely actions as buttons; everything else in a menu and the command palette.

Record header anatomy: title (human identifier, e.g. guest name + confirmation code) → status chips (separate per
concept) → trust markers (§3) → owner → primary actions. Body: tabs or sections ordered by frequency of use for the
viewer's role.

## 2. Information hierarchy and layout

- **Page types:** Workspace (role home), List (filterable table with saved views), Record, Board (kanban/zones),
  Timeline/Calendar, Settings, Journey (stepper for setup/migration). Each type has one layout template.
- **Density:** back office defaults to *Default* density with *Compact* and *Comfortable* options per user; staff app is
  always comfortable. Numbers right-aligned with tabular figures; money shows currency code when more than one currency
  is in play on the screen.
- **Typography:** one sans family with tabular numerals; minimum body 14 px back office, 16 px staff app/guest journey;
  headings by weight and size, not color.
- **Color:** semantic tokens only (`--status-ok`, `--status-warn`, `--status-danger`, `--status-info`,
  `--provenance-*`); color never carries meaning alone (icon + text always present); palette validated for the three
  common color-vision deficiencies.
- **Time:** times are shown in **property local time**; when the viewer's device timezone differs, the zone is shown
  ("14:00 MVT"). Business date is shown in the global header when it differs from the calendar date.

## 3. Trust markers: certainty and provenance

Two independent axes, rendered as small labelled badges (icon + word; tooltip explains; never color-only):

**Certainty** (what kind of statement is this?)

| Marker | Meaning | Example |
|---|---|---|
| *(none)* = **confirmed** | Authoritative system confirmed it | Payment captured; booking confirmed |
| **Pending** | Requested/submitted, outcome not yet confirmed; includes *pending verification* and *pending in <system>* (forwarded writes) | Charge timed out; room status sent to PMS |
| **Estimate** | Computed projection that can change | Projected balance, forecast occupancy, estimated ready time |
| **Suggestion** | Proposed by Portico (rules or AI); nothing happens until a person accepts | Mapping suggestion, upgrade suggestion, AI draft |

**Provenance** (where does it come from? — CLAUDE.md rule 16)

| Marker | Meaning |
|---|---|
| *(none)* = **live** | Portico's own current data |
| **External** | Received from another system; shows the system name and last-sync time on hover/focus |
| **Delayed** | Older than its freshness SLA; shows age ("12 min old") |
| **Incomplete** | Some inputs missing (named) |
| **Copied** | Trial copy; shows copy timestamp |
| **Simulated** / **Sandbox** | Produced by a simulator or provider sandbox; never real |

Rules: a failed action never shows as pending or confirmed; "paid", "confirmed", "synced", "delivered" appear only with
authoritative confirmation (CLAUDE.md §5); markers propagate to totals ("Balance USD 1,240.00 · includes 1 pending
payment").

## 4. Status vocabularies are separate

Each concept has its own field, words and chip style, and they are never merged into one status:

| Concept | Values (UI labels) | Chip style |
|---|---|---|
| Booking status | Inquiry, Quoted, Held, Tentative, Confirmed, Cancelled, Declined, Expired, Completed | rounded, neutral/brand |
| Stay status | Expected, In house, Departed, Cancelled, No-show, Waitlisted (+ derived: Arriving today, Departing today, Overstay, Waiting) | rounded with person icon |
| Occupancy (physical) | Vacant, Occupied (+ discrepancy: Skip, Sleep) | door icon |
| Unit condition | Dirty, Cleaning, Clean, Inspected, Failed inspection | broom icon |
| Unit availability | Available, Assigned, Out of order, Out of service, House use | square, hatch pattern for OOO |
| Inventory cell | n available · Authorized overbooking · Oversold (conflict) | grid cell badge |
| Payment status | Authorized (not paid), Paid, Partially paid, Pending verification, Failed, Refunded, Disputed | card icon |
| Folio status | Open, Settled, Reopened | ledger icon |
| Task status | Open, In progress, Blocked, Done, Verified, Cancelled | check icon |
| Integration health | Healthy, Delayed, Degraded, Failing, Paused, Credentials expiring/invalid, Disconnected | plug icon |

A unit tile on the housekeeping board therefore shows e.g. **Occupied · Dirty · Departing today** as three chips, never
"Dirty-departure".

## 5. Change previews and confirmations

- **Preview required** for: inventory changes (dates, unit type, moves, blocks), money (postings beyond simple
  charges, transfers, refunds, billing rules, write-offs), guest-facing sends in bulk, portfolio/organization policy
  changes, data-authority changes, connection pause/disconnect, group grid changes, bulk operations.
- **Anatomy:** one-sentence summary ("Extend stay by 2 nights to 14 Mar; villa 214 unavailable on 13 Mar") →
  per-night table (availability, price before/after, taxes) → totals before/after per folio → consequences list
  (deposit, payment schedule, channel, housekeeping, guest message) → warnings → **Commit** / **Back**.
- **Stale preview:** if anything changed, the commit returns `preview_stale`; the UI re-renders the preview with
  changes highlighted, never commits silently.
- **Confirmation dialogs only where consequences justify interruption** (irreversible or external effects: refunds,
  write-offs, cancellation with penalty, disconnecting a system of record). Reversible actions use **undo** in the
  success toast instead of "Are you sure?".

## 6. Errors, success and interrupted work

- **Error message standard** (maps to RFC 9457 problem+json `title`, `detail`, `code`, `details`):
  **What happened** (plain words) → **why**, if it helps → **what to do now** (a concrete recovery, ideally a button)
  → reference code for support. Never blame the user; never show stack traces or payloads to hotel staff.
  Example: "Villa 214 can't be assigned for 13 Mar — it's booked for Ms Chen (K7P2M9QX). Choose another villa or
  split the stay. [Show alternatives]".
- **Inline validation** next to fields as the user leaves them; form-level summary on submit with links to fields.
- **Success** states what happened and what happens next ("Checked in. Key issued. Folio: USD 0.00 due.") so nobody
  wonders whether to repeat it; idempotent replays say "Already done earlier — nothing was duplicated."
- **Interrupted workflows** (check-in/out, Day Close, setup journeys, imports) display a step list with
  done/failed/pending/skipped and a **Resume** action; external steps already done are never repeated.

## 7. Keyboard model and command palette

- **Command palette** `Ctrl/⌘ K`: navigate, search records, and run permitted actions on the current record
  ("Extend stay", "Post charge", "Move to…"); results are permission- and entitlement-aware; every palette action also
  exists in the visible UI (palette is an accelerator, never the only path).
- **Global shortcuts:** `/` search · `g` then `a` Arrivals, `d` Departures, `i` In-house, `t` Timeline, `h` Housekeeping,
  `f` Finance exceptions · `n` new booking · `?` shortcut sheet · `Esc` close panel (never discards unsaved work without
  prompt).
- **Lists:** `j`/`k` move, `Enter` open, `x` select, `Shift+click` range, `e` primary action of the row.
- **Records:** `Alt+1…9` tabs; `Ctrl/⌘ S` save where editing; `Ctrl/⌘ Enter` commit preview.
- **Grids and Timeline:** arrow keys move by cell, `Shift+arrows` extend a selection, `Enter` opens the explanation
  or preview, `Space` toggles selection.
- Focus is always visible and never obscured by sticky headers (WCAG 2.2 2.4.11); opening a panel moves focus into it
  and closing returns focus to the trigger; context is preserved when moving between related records (back returns to
  the same scroll and selection).

## 8. Global search

One search box (`/`) across bookings (confirmation code, external/channel references, voucher), guests (any script,
transliteration, phone in any format, email), companies/agencies, units, groups, folios/invoices numbers, tasks and
work orders, settings. Ranking: exact identifiers first, then in-house > arriving today > departing today > future >
past, then recency. Results show type, key status chips and property (in multi-property scope) and respect permissions
and data scope (no existence leaks). Target: results in ≤ 300 ms p95 (§19).

## 9. Tables, calendars and the Timeline

- **Tables:** sticky header, column chooser, sort, filter chips, totals row where numeric, density switch, export
  (permission-gated), bulk actions with preview, row counts always visible, empty states that explain why and offer the
  next action.
- **Saved views:** any list/board/timeline configuration (filters, columns, sort, grouping, zoom) can be saved as
  personal or shared-to-role views, is URL-addressable, and shows a live count. Each workspace ships default views per
  profile.
- **Calendars:** availability grid and rate calendar follow table rules; every number opens its explanation.
- **Timeline — the primary reservation view:** units grouped by unit type (or location) as rows × time as columns;
  zoom hours / days / months; density modes. Stay bars show guest name, stay status, lock icon, alert icon, and a
  balance dot (estimate marker if projected). Unit blocks are hatched with reason; conflicts are outlined in red with
  "Oversold" text. Drag to move/extend/shorten creates a **change preview** (never a silent commit); every drag
  interaction has a keyboard and menu alternative (WCAG 2.2 2.5.7). A list view of the same data is one keystroke
  away for screen-reader users. Target: 400 units × 31 days renders in ≤ 1 s and scrolls at 60 fps on a mid-range
  laptop (§19).

## 10. Concurrency UX (409 conflicts)

- Records show **presence** ("Hassan is editing this booking").
- On `409 version_conflict`, the user's unsaved edits are **kept**; a panel shows what changed since they opened the
  record (field, old → new, who, when) and offers: *Review and re-apply my changes* (default, re-runs preview),
  *Discard my changes*, *Open the latest in a new tab*. Nothing is overwritten silently.
- On `preview_stale` (inventory or price moved), the preview is recomputed with differences highlighted and a plain
  explanation ("Villa 214 was sold 4 s ago by Aishath").

## 11. Offline, stale and degraded data

- A global connectivity indicator (online / reconnecting / offline) plus per-list **freshness** labels.
- Staff app: "n updates waiting to sync · last synced 14:02"; each queued item shows its state; sync conflicts are
  shown to the user who made the change and to the supervisor, with both values.
- Safe offline actions: housekeeping condition updates, task progress, issue reports with photos, notes, lost & found
  logging. Not available offline (and clearly disabled with reason): payments, availability-dependent actions, check-in
  and anything that needs an authoritative answer.
- External system or provider outage: a property-level banner states what is affected, since when, which records may
  be stale, and what to do now; affected values carry **Delayed** markers. Nothing ever shows as synced while failing.

## 12. Mobile and touch (staff app)

Touch targets ≥ 44 × 44 CSS px with ≥ 8 px spacing (exceeds WCAG 2.2 2.5.8 minimum); primary actions in the lower
third (thumb zone); one-handed use; ≤ 2 taps for the commonest action from the list; no typing required for routine
updates (pickers, presets, camera); high-contrast "outdoor" theme for sunlight; haptic and visual confirmation of each
action with its sync state; works at 360 px width; large text up to 200% without loss of function.

## 13. Accessibility (WCAG 2.2 AA)

Requirements beyond the basics (contrast 4.5:1 text / 3:1 UI, labels, keyboard operability, reduced motion):
focus not obscured (2.4.11), dragging alternatives (2.5.7), target size (2.5.8), consistent help location (3.2.6),
**redundant entry** — never ask for information already given in the same process (3.3.7; matches brief §7 "guests
should not repeatedly enter information"), accessible authentication — paste and password managers allowed, passkeys
supported, no cognitive tests (3.3.8). Grids expose row/column headers to assistive technology. The booking engine and
guest portal are tested with screen readers on mobile. Accessibility checks run in CI (axe) and in each usability round.

## 14. Internationalization and right-to-left

All strings externalized with ICU message format; locale-aware dates, numbers and currencies; names stored and shown in
native script with Latin transliteration where needed. Layout uses CSS logical properties so **RTL** works — required for
Arabic (Gulf markets) and **Dhivehi (Thaana script, right-to-left)** for Maldivian staff and local guests. Staff UI ships
in English first; guest-facing surfaces in the property's selected languages. Machine translations are labelled and
originals preserved (comms).

## 15. Progressive disclosure

Visibility = entitlement ∧ profile default ∧ data authority ∧ permission (`docs/product/editions.md` §1). Advanced fields
sit behind "More options" with remembered state; settings show only what the profile uses, with "Show all settings" for
admins. Empty states teach the next step. A guesthouse owner's phone never shows group blocks, routing matrices or
portfolio controls unless enabled.

## 16. Help and learning

Contextual help on every page in the same place (3.2.6); "Why?" links on computed numbers (availability, balances,
taxes, metrics) open explanations; guided setup journeys; the training environment is one switch away and clearly
bannered; release notes inside the product with opt-in windows for disruptive UI changes (research 01 §9 item 12).

## 17. Notifications

Three levels: **inline** (on the record), **inbox** (personal/departmental, persistent until handled), **interrupt**
(only for urgent operational problems — overbooking, payment pending at check-in, failing system of record). Each
notification states what happened, impact and next action, and links to the record. Routine status never interrupts.

## 18. Workspaces

Each role has a home workspace (`docs/product/personas-and-workspaces.md`) composed of saved views, the exceptions that
role owns and the next actions; users may pin views; administrators define role defaults per property profile.

## 19. Usability targets (TARGETS — to be validated)

These are **targets, not claims**. Each is validated in moderated sessions with representative users (≥ 5 per role per
round, including Maldivian resort and guesthouse staff and non-native English speakers), on realistic Maldives sample
data in the training environment, using instrumented task timers plus observation, and — where possible — compared with
the same task on the hotel's incumbent system. Results, dates and participants are recorded in
`docs/readiness/` separately from automated test coverage (CLAUDE.md §7).

| Task (role) | Time target | Error target | Navigation target | Help target |
|---|---|---|---|---|
| Find a reservation by name/code/phone (desk) | ≤ 5 s | 0 wrong record opened | ≤ 2 interactions | none |
| Prepared arrival check-in incl. payment authorization (desk) | ≤ 60 s | ≤ 1 correction / 20 | single screen + checklist | none after training |
| Walk-in: quote, book, assign, check in (desk) | ≤ 3 min | ≤ 1 correction / 10 | ≤ 3 screens | none after training |
| Room move with preview (desk) | ≤ 30 s | 0 unintended price changes | from Timeline or record | none |
| Extend stay incl. alternative unit (desk) | ≤ 45 s | 0 | preview only | none |
| Check-out with split folios and settlement (desk) | ≤ 90 s | 0 wrong payer | single checklist | none |
| Post an outlet charge (cashier) | ≤ 20 s | ≤ 1 / 50 | 1 screen | none |
| Update unit condition (attendant, mobile) | ≤ 3 s, ≤ 2 taps | ≤ 1 / 100 | from list | none |
| Assign tomorrow's housekeeping (supervisor, 40 units) | ≤ 5 min | 0 unassigned departures | 1 board | none |
| Report a fault with photo (any staff, mobile) | ≤ 30 s | — | ≤ 3 taps + photo | none |
| Day Close with no blocking exceptions (auditor) | ≤ 2 min attention | 0 | 1 page | none |
| Create a 30-room × 5-night block with rates (sales) | ≤ 5 min | 0 grid errors | 1 grid editor | ≤ 1 |
| Reply to a guest with context (any) | ≤ 60 s | 0 duplicate replies | inbox only | none |
| First booking made by a guesthouse owner after sign-up (demo) | ≤ 30 min | — | guided | ≤ 2 |
| New front-desk agent completes the 10 core desk tasks unaided | within 1 shift (≤ 4 h training) | ≤ 1 unrecovered error / 50 tasks | ≤ 1 unnecessary screen / task | ≤ 1 help request / 10 tasks |
| First read-only connection (simulator PMS) by hotel staff | ≤ 30 min staff time | — | setup journey | ≤ 2 |

System responsiveness targets (measured in CI performance tests and pilots): interaction feedback ≤ 100 ms, list and
record loads ≤ 1 s p95, search ≤ 300 ms p95, Timeline render ≤ 1 s for 400 units × 31 days.
