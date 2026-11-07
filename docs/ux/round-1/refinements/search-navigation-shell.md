# Round 1 refinements — Search, navigation and shell

Scope: the command palette and global search, `N`, the rail and section list, device layouts, Today tiles, errors,
wording, links and hotkeys — everything every module inherits from the shell (`apps/backoffice/src/app/shell`,
`packages/ui`). All personas. Citation keys, categories and the power-check rule are defined at the top of
`front-desk.md`. Outcomes are **TARGETS** until validated with hotel staff.

These are mostly **(c) design** problems: they stay broken even after every module is wired. They are owned by the
backoffice/ui engineer, who is fixing the steward review in parallel; overlaps are named per item so nothing is done
twice.

| ID | Refinement | Cat | Owner | Priority |
|---|---|---|---|---|
| NAV-01 | The palette runs actions, and speaks hotel | (c) | backoffice/ui | blocker |
| NAV-02 | `N` always creates something | (c) | backoffice/ui | major |
| NAV-03 | Search finds every guest and stay the desk asks about | (a) | foundation search | blocker |
| NAV-04 | Nothing silently does nothing | (c) | backoffice/ui | major |
| NAV-05 | Navigation that fits the device | (c) | backoffice/ui | major |
| NAV-06 | On a phone, the first screen is the day | (c) | backoffice/ui | major |
| NAV-07 | Every number opens the list it counts | (c) | backoffice/ui | major |
| NAV-08 | Errors that help you recover | (c) | backoffice/ui | major |
| NAV-09 | Staff language only — a copy lint in CI | (c) | backoffice/ui | major |
| NAV-10 | Touch-safe links and previews | (c) | backoffice/ui | minor |
| NAV-11 | Hotkeys ready on first paint | (c) | backoffice/ui | minor |
| NAV-12 | Property and business date always readable | (c) | backoffice/ui | minor |
| NAV-13 | Say "room" or "villa", not "unit" | (c) | backoffice/ui | minor |

---

### NAV-01 · The palette runs actions, and speaks hotel

**Category** (c) (the actions' backends are (a)) · **Owner** backoffice/ui (command registry), every module registers
its verbs · **Priority** blocker
**Evidence** P1 › Walk-in: menu and search for "walk", "new", "book", "reserv", "check", "pay", "clean" → "No results.
*Try fewer words.*"; "The palette contains records only. It has no commands." P5: "day close", "audit", "close", "end
of day" → nothing. P6: "folio", "invoice", "company", "ledger" → nothing. P8: "connect", "integration" → nothing.
T1, T5, T8 · `[screens/p1-13-search-walk.jpg]`
**Overlaps** SR P1-5 (palette has no record actions)

**Proposed change.**
- A shared **command registry** (like `SHORTCUTS` in `app/shortcuts.ts`): each workspace/module registers verbs with
  label, **synonyms** (including competitor and colloquial words), required permission, availability rule and
  handler. One registry feeds the palette, `N` (NAV-02), the `?` sheet and the help articles.
- **Global verbs** (role-filtered): New booking · Walk-in · Find availability · Day Close · Post charge · Record
  payment · Report issue · Log found item · Add staff member · Add property · Connections · Switch property.
- **Record verbs** (SR P1-5): with a record open, its `allowedActions` come first ("Check in Ahmed Al Rashid", "Change
  dates", "Move villa…"); disabled ones show their reason.
- **Synonyms** (seed list): walk in → Walk-in; reservation, rez, book, quote → New booking; night audit, end of day,
  EOD, close day, audit → Day Close; folio, bill, invoice → Bills; city ledger, AR, receivables → Receivables; OOO,
  out of order, maintenance → Report issue; interface, integration, PMS, channel manager, connect, API, webhook →
  Connections; check-outs → Departures; clean, housekeeping → Housekeeping / Mark clean.
- **Ranking**: exact command match → record identifiers → names; groups **Actions · Records · Go to**.
- **Empty state** (replaces "No results. Try fewer words."): "Nothing matches 'xyz'. Search by guest name, booking
  code, villa number or phone — or press N to create something."
- Every palette action also exists in visible UI (ux §7: an accelerator, never the only path).

**Expected outcome (targets).** Round-1 action-word queries (17: walk, new, book, reserv, check, pay, clean, day close,
audit, close, end of day, folio, invoice, company, ledger, connect, integration) → right action first: **0 / 17 →
17 / 17**; kept as a regression list in a test. Start a walk-in in ≤ 6 keystrokes (`Ctrl K`, "walk", `Enter`).

**Power check.** Pure accelerator; permissions applied per command; nothing hidden.

---

### NAV-02 · `N` always creates something

**Category** (c) · **Owner** backoffice/ui · **Priority** major
**Evidence** P2 › Keyboard: "'N' says 'Nothing to create on this screen — use the command palette', but the palette has
no create commands"; P7: "No 'New property'; `N` does nothing"; T1

**Proposed change.**
- `N` runs the screen's primary create when it has one: Arrivals → Walk-in; Reservations/Timeline → New booking;
  Users → Add staff member; Properties → Add property; Housekeeping → Report issue; Lost & found → Log item.
- Everywhere else `N` opens a **Create** menu with the role's creates (from the NAV-01 registry). A visible **+ New**
  button in the header mirrors it for mouse and touch.

**Expected outcome (targets).** 0 dead `N` presses (baseline: every screen tested).

**Power check.** Adds.

---

### NAV-03 · Search finds every guest and stay the desk asks about

**Category** (a) — reservations' provider already matches booking codes, external refs, booker and **occupant** names
(trigram) and unit numbers; guests' provider matches names in any script, email and phone; `GET /v1/search` aggregates
them · **Owner** foundation search (`apps/api` aggregator) with reservations and guests providers · **Priority** blocker
**Evidence** P1 › Past guest by partial name: "Kowal" → none although Anna Kowalska is in house; "beck" → none;
"lukas" → the wrong Lukas; "anna k" → "Anna Smirnova". P2: "+960" and "7712" → nothing. "Search covers only today's
arrivals and stand-alone guest profiles." T8 · `[screens/p2-03-search-kowal.jpg]` (the working case),
`[screens/p1-13-search-walk.jpg]`
**Overlaps** SR P2-11 (quick filter on lists must search code and blocker text — a separate, list-level fix)

**Proposed change (when wired).**
- Drop the client-side "simulated arrivals" search; use `/v1/search` only.
- **Ranking** per ux §8: exact identifiers → in house → arriving today → departing today → future → past → recency.
- **Matching**: multi-word queries match given and family names independently ("anna k" = given starts "anna" and
  family starts "k"); phone digits normalised (any fragment of ≥ 3 digits, with or without "+960"); email local part.
- **Result line** shows type icon, stay-status chip, dates, villa and property (multi-property scope), plus **why it
  matched** ("phone …7712", "booker of 2QMG3GQM").
- Unit queries ("villa 208") show the unit and its current/next stay first; configuration objects (unit types) group
  under "Settings" at the end.

**Expected outcome (targets).** Round-1 lookup set (Kowal, beck, lukas, anna k, P2 partial name, +960, 7712, 2QMG,
villa 208): correct first result **3 / 9 → 9 / 9**; p95 ≤ 300 ms (ux §19).

**Power check.** Permission- and scope-aware with no existence leaks (ux §8); adds coverage only.

---

### NAV-04 · Nothing silently does nothing

**Category** (c) · **Owner** backoffice/ui (palette, record host, toasts, i18n) · **Priority** major
**Evidence** P2: a guest-profile result "does nothing"; P1: "Tapping twice stacked two identical toasts"; P3: a hold bar
opens the villa instead of the option; X: "`common.loading` key leak" · `[screens/p2-09-live-guest-click.jpg]`
`[screens/p1-15b-free-cell-enter.jpg]`

**Proposed change.**
1. Selecting any result opens its record. Without a specialised view, open the **generic record view** (title,
   status, links and history from `/v1/records/:type/:id`) and report a client error event — never close silently.
2. Identical toasts within 5 s merge into one with a counter ("×2").
3. Every clickable thing acts, opens, or explains (disabled with a reason). A test walks each registered command and
   record link and fails on a no-op handler.
4. A missing translation key never reaches the screen: CI fails on missing keys (e.g. `common.loading`).

**Expected outcome (targets).** Distinct dead ends met by the round-2 tester: **15 → 0** (scorecard).

**Power check.** Fix only.

---

### NAV-05 · Navigation that fits the device

**Category** (c) · **Owner** backoffice/ui (shell, Drawer) · **Priority** major
**Evidence** P2: "The left two-level navigation (icon rail plus a 'Front desk' column holding a single item,
'Arrivals') wastes ~315 px"; P4: "At 1024 px every page is **111 px wider than the screen**. The Help and Account
buttons are off-screen, and the record drawer's Close button is off-screen"; P1: Arrivals needs Menu → Arrivals
(2 taps); T10, T17 · `[screens/p4-01-home.jpg]` `[screens/p2-13-arrivals-full.jpg]` `[screens/p1-02-home.jpg]`
**Overlaps** SR P1-4 item 3 (hide the section column for ≤ 1 item; collapse below 1536 px)

**Proposed change.**
- **≥ 1536 px**: rail + section list, but only when the workspace has ≥ 2 sections.
- **1024–1535 px**: rail only; sections appear as a flyout from the rail (hover, focus or tap) **and** as tabs in the
  page header ("Arrivals · In house · Departures").
- **< 1024 px on touch** (tablet portrait, phone): a **bottom bar** with up to 4 role-chosen destinations + **More**
  (thumb zone, ux §12). Owner: Today · Arrivals · Rooms · Money. Attendant: My rooms · Report · Found · More. The
  header keeps property, search, help (same place on every screen, WCAG 3.2.6) and account.
- The header search field collapses to an icon below 1280 px so the header never overflows.
- **Layout contract test** (Playwright): `document.scrollingElement.scrollWidth ≤ innerWidth` on every route at
  360, 768, 1024, 1280 and 1440 px, with the drawer open and closed.

**Expected outcome (targets).** Horizontal overflow at 1024×768: **111 px → 0**; content width at 1440 px + 224 px;
owner reaches Arrivals in 1 tap (baseline 2).

**Power check.** Every section stays reachable (flyout, header tabs, More, `g` chords, palette).

---

### NAV-06 · On a phone, the first screen is the day

**Category** (c) · **Owner** backoffice/ui (EnvironmentBanner, SimulatedNote, FirstRunChecklist, Today) · **Priority**
major
**Evidence** P1 › Today on phone: "The first ~830 px are taken by the purple DEMO banner (~95 px), the 'Get started as
**Organization administrator**' checklist … a dashed SIMULATED notice. The real numbers only start below the fold."
T17 · `[screens/p1-02-home.jpg]`; `[screens/p1-03-today-full.jpg]` was captured while Today still showed only loading
skeletons.
**Overlaps** SR P1-4 item 6 (fold the simulated note into one line)

**Proposed change.**
- **Environment banner** below 640 px: one 32 px line — "DEMO · sample data — nothing real is charged or sent" (tap for
  the full text). It stays **non-dismissible** on every screen (truth first); it only gets shorter.
- **Simulated note**: the page badge carries it; the explanatory paragraph collapses after first view per user into a
  "What's simulated?" link.
- **Checklist**: after first view it collapses to a one-line pill "Get started · 1 of 6 ›" (dismiss-forever remains);
  the right checklist for the person is HLP-06.
- **Owner's Today** puts **Now** first: arrivals needing action (with fixes), rooms to clean (with Mark clean), money to
  collect; KPI tiles after.
- **Speed**: Today renders content in ≤ 1 s p95 on a mid-range phone (ux §19); measure LCP in the lab.

**Expected outcome (targets).** First operational number ≤ 300 px from the top at 390×844 (baseline ≈ 830 px).

**Power check.** No information removed; the environment banner is never hidden.

---

### NAV-07 · Every number opens the list it counts

**Category** (c) · **Owner** backoffice/ui (Today, KpiTile), counts from reservations, payments, operations ·
**Priority** major
**Evidence** P1: "The Departures tile is not tappable"; "'Payments pending verification **2 · $664.28**' opens *My
work*. That list has **one** payment item ($132)". P2: "Today says '9 of 16 ready'; Arrivals says '7 Ready'"; "'In
house: 106' … lands on the **Housekeeping board**". P6: "'2 · $6,546.36' opens *My work* … none are payments". T6,
T11, T16 · `[screens/p2-15-today.jpg]` `[screens/p6-02-payments-mywork.jpg]` `[screens/p1-18-mywork-full.jpg]`
**Overlaps** SR P2-1 (fabricated KPI offsets in the simulator), SR P3-8 (tiles not actionable), SR P2-10 (view state in
the URL)

**Proposed change.**
- **Rule: a KPI tile is a saved view.** Its number comes from the same query as its destination, and clicking opens
  that destination filtered, with a totals row equal to the tile (design direction: "numbers drill into records").
- Destinations: Ready arrivals → Arrivals (Ready); Departures → Departures (FD-06); In house → In house (FD-06);
  Payments pending → Finance › Payments › Unresolved (PAY-04), or My work filtered to payments for desk roles;
  Open work → My work.
- "Ready" counts only expected arrivals with every blocking check OK; checked-in arrivals count as "Checked in".
- Amounts show the currency code when more than one currency is on screen (ux §2).
- Contract test per tile: `count(tile) == count(destination rows)` and `sum(tile) == totals row`.

**Expected outcome (targets).** Today tiles with a mismatched count or wrong/no destination: **4 of 6 → 0**.

**Power check.** Fix only.

---

### NAV-08 · Errors that help you recover

**Category** (c) · **Owner** backoffice/ui (`ProblemAlert`, `Field`, `api/errors.ts`, forms) + module problem titles ·
**Priority** major
**Evidence** P7 › Empty property name → Save: "Something went wrong in this screen `[ { "origin": "string", "code":
"too_small", … } ]`. **Reload the page**…" — raw JSON, field not highlighted, harmful advice (reload loses edits).
Invite: "Too small: expected string to have >=1 characters", "Reference: client". X: "'Trying again unchanged will
fail the same way…' is appended to **every** error". P1: wrong password titled "Sign-in required" with a UUID
reference. T12 · `[screens/p7-09-empty-name-save.jpg]` `[screens/p7-12-invite-invalid.jpg]`
`[screens/p1-01-wrong-password.jpg]`
**Root cause.** Client-side schema errors thrown before the request are caught by `problemFromUnknown`, which
stringifies the error and appends "Reload the page" (`apps/backoffice/src/api/errors.ts`, branch
`feat/backoffice-core`).
**Overlaps** SR P1-2 (retry wording must depend on the call; uncertain = pending verification), SR P2-7 (conflict edge
cases), SR P2-12 (session expiry keeps edits)

**Proposed change.**
- **Validation is inline**: on blur and on submit, each schema issue maps (by issue code + field) to a staff sentence —
  "Enter the property name.", "Use at least 12 characters.", "Enter an email like name@hotel.mv". The field is
  outlined, a summary at the top links to it, focus moves to the first invalid field. No request is sent and no
  ProblemAlert appears.
- `problemFromUnknown` never shows `error.message` to hotel staff. Unknown client errors read: "This screen hit a
  problem it didn't expect. Your changes are still here — try again, or copy them before leaving." — **never "reload"
  while a form has unsaved edits**.
- Remove the default `notRetryableHint` sentence; retry guidance appears only when the server says it helps (SR P1-2
  owns the safety wording).
- Module problem titles follow ux §6 (what happened → why → what now, ideally a button). The reference is small with
  "Copy reference", never mid-sentence.
- Sign-in: title "Email or password doesn't match", detail "Check both and try again. After several attempts sign-in
  slows down for a few minutes." + **Forgot password?** (SET-03). No reference on a 401 at sign-in.

**Expected outcome (targets).** Error messages without a working recovery: **4 (+ boilerplate on every error) → 0**;
raw payloads shown to staff: 0.

**Power check.** Errors are never hidden — they become specific. Server-side validation and permissions are unchanged.

---

### NAV-09 · Staff language only — a copy lint in CI

**Category** (c) · **Owner** backoffice/ui (i18n, `packages/ui/src/strings.ts`) + every module's staff-facing
`reason`/`message` strings · **Priority** major
**Evidence** T13: "wave 1 in progress", "module is connected", "(scenario S03)", "Simulator sample lines…rates module",
"Help anchor: frontDesk.arrivals", "demo-seeder", `identity.user.read`, role codes, lesson codes, `common.loading`,
"Reference: client", "this form reuses one request key", "What is live in this build" · `[screens/p1-16-ahmed.jpg]`
`[screens/p1-23-help-arrivals.jpg]` `[screens/p7-11-invite.jpg]` `[screens/p7-03-settings-org.jpg]`

**Proposed change.**
- A CI lint over `apps/*/src/i18n/*.ts`, `packages/ui/src/strings.ts` and module strings returned to staff
  (`allowedActions[].reason`, `issues[].message`, problem `title/detail`) that fails on: *module, wave, API, endpoint,
  payload, request key, idempotency, anchor, seeder, simulator* (outside provenance badges), `scenario S\d+`, dotted
  permission keys (`\w+\.\w+\.\w+`), snake_case role keys. Allowlist: developer surfaces (Connections exchange log,
  API docs).
- Replacements:
  - Not-yet-available features (non-live environments only): "Not available in Portico yet" + what to do instead.
    The current string `records.reasons.moduleNotConnected` ("Available when the {{module}} module is connected (wave
    1 in progress).") is retired.
  - "Help anchor…" and "Nothing is missing from the product itself" → removed (HLP-01).
  - "Safe to retry: this form reuses one request key…" → removed (the behaviour stays).
  - "What is live in this build" → "What's real in this demo" (SET-10).
  - Permission codes → "You can't manage staff. Organization administrators can." with the code under "Details for
    IT" (SET-07).

**Expected outcome (targets).** Distinct developer terms visible to staff: **≥ 14 → 0**, enforced by CI.

**Power check.** Technical detail stays available to IT in details panels.

---

### NAV-10 · Touch-safe links and previews

**Category** (c) · **Owner** backoffice/ui (EntityLink, Popover) · **Priority** minor
**Evidence** P1 › Mark rooms cleaned: "Tapping a related-stay link pops a hover card over the content, which is clumsy
on touch" · `[screens/p1-20-room2.jpg]`

**Proposed change.** On `pointer: coarse`, a tap on an entity link opens the record; the preview appears only on
long-press. On desktop the preview appears after a hover/focus delay (≈ 400 ms) and never steals focus.

**Expected outcome (targets).** 0 accidental overlays on touch in round 2.

**Power check.** Previews remain (experience architecture §2).

---

### NAV-11 · Hotkeys ready on first paint

**Category** (c) · **Owner** backoffice/ui · **Priority** minor
**Evidence** Pol: "'/' doesn't respond in the first ~second after a page loads"

**Proposed change.** Register global hotkeys at shell mount, before data queries resolve; the palette opens at once
with recent/pinned records while search warms up.

**Expected outcome (targets).** `/` responds ≤ 100 ms after first paint.

**Power check.** n/a.

---

### NAV-12 · Property and business date always readable

**Category** (c) · **Owner** backoffice/ui (PropertySwitcher) · **Priority** minor
**Evidence** P1: "The property name is truncated to 'Coral Nes…'"; P7: editing another property while the header shows
the current one (see SET-09) · `[screens/p1-02-home.jpg]`
**Overlaps** SR P2-4 (switcher `aria-label` must include the visible business date)

**Proposed change.** On narrow screens show the property's **short name** (configurable; default the first two words)
plus code; the business date appears as its own chip ("Sat 7 Nov") when it differs from the calendar date (ux §2) and
always for night-audit roles.

**Expected outcome (targets).** The property is identifiable at 360 px.

**Power check.** n/a.

---

### NAV-13 · Say "room" or "villa", not "unit"

**Category** (c) · **Owner** backoffice/ui (i18n) with the noun from the property profile / unit types (platform,
inventory) · **Priority** minor
**Evidence** P1/P2: "Move unit — Available when…" on stay records · `[screens/p1-16-ahmed.jpg]` `[screens/p2-05-emma.jpg]`

**Proposed change.** The property (or unit type) defines the noun staff use — Room, Villa, Suite, Apartment, Tent;
verbs interpolate it ("Move villa", "Assign room", "Find a ready villa"). "Unit" stays in settings and the glossary.

**Expected outcome (targets).** 0 occurrences of "unit" on operational screens.

**Power check.** n/a.
