# Round 1 refinements — Housekeeping and operations

Scope: the housekeeping board, condition changes, inspections, assignment, the attendant's phone, DND, lost & found
and issue reporting. Personas P4 (housekeeping supervisor on a 1024×768 tablet, and a room attendant on a phone) and
P1 (guesthouse owner who also cleans). Citation keys, categories and the power-check rule are defined at the top of
`front-desk.md`. Outcomes are **TARGETS** until validated with hotel staff.

Almost everything here is **(a) wiring**: operations is complete at R3 on the API side (OPS-R01…R22, see
`modules/operations/README.md`), while the board in the UI is simulated with display-only actions. The design effort
below is on how those capabilities should look and flow on a tablet and a phone.

| ID | Refinement | Cat | Owner | Priority |
|---|---|---|---|---|
| HK-01 | One tap to change a room's condition | (a) | operations | blocker |
| HK-02 | Inspection with pass/fail, reasons and photo | (a) | operations | major |
| HK-03 | Plan and assign the day with explained suggestions | (a) | operations | blocker |
| HK-04 | Warn when a room will be ready after its guest arrives | (c) | operations | major |
| HK-05 | "My rooms" for attendants | (a) | operations | blocker |
| HK-06 | Do not disturb with duration and welfare escalation | (a) | operations | major |
| HK-07 | Lost & found log | (a) | operations | major |
| HK-08 | Report an issue, camera first, with its effect on sale | (a) | operations | major |
| HK-09 | The board fits a tablet and shows what a supervisor scans | (c) | backoffice/ui | major |

---

### HK-01 · One tap to change a room's condition

**Category** (a) — `POST /v1/operations/units/:id/condition`, task transitions `/operations/tasks/:id/transitions` ·
**Owner** operations · **Priority** blocker
**Evidence** P1 › Mark rooms cleaned — **No**: "A Dirty room offers only **Mark inspected** (disabled …) and **Report
issue** (disabled, 'wave 1'). There is no 'Start cleaning', 'Mark clean' or 'Set DND'"; on a Clean room "Mark
inspected" gives a toast and the chip stays Clean (SIM); P4; T4 · `[screens/p1-19-hk-full.jpg]`
`[screens/p1-20-room2.jpg]` `[screens/p1-22-room4-inspect.jpg]`

**Proposed change.** State-driven actions (primary slot per FD-08), on the unit record **and inline on every board
row** (≥ 44 px on touch):

| Condition | Primary | Secondary (menu) |
|---|---|---|
| Dirty | **Start cleaning** | Mark clean · Do not disturb · Report issue |
| Cleaning | **Mark clean** | Can't finish (reason) · Report issue |
| Clean | **Inspect** (supervisor) | Mark dirty again (reason) |
| Failed inspection | **Start re-clean** | Reassign |
| Inspected | — | Mark dirty (reason) · Report issue |

- The success toast offers **Undo** for 10 s (ux §5: reversible actions use undo, not "Are you sure?"); undo records a
  corrective change — history is append-only, never edited.
- **Guesthouse shortcut, by policy only:** where the property's policy says no separate inspection is required, the
  owner sees **Mark ready**, which records the cleaning and a passed inspection by the same person in one action
  (the invariant "inspected only via an inspection record" holds).
- Wiring acceptance: the condition changes on the board immediately (optimistic with rollback on error), and the
  front-desk readiness check updates (the simulated "toast but no state change" disappears).

**Expected outcome (targets).** Update a condition in ≤ 2 taps and ≤ 3 s (ux §19); the owner marks 6 rooms clean in
≤ 30 s. Baseline: not possible.

**Power check.** The supervisor's inspection power and the append-only condition log are unchanged; the guesthouse
shortcut exists only where policy allows it.

---

### HK-02 · Inspection with pass/fail, reasons and photo

**Category** (a) — `POST /v1/operations/units/:id/inspections` (checklist items `pass|fail|na`, photo refs, free-text
reasons), checklist templates, re-clean to the same attendant (OPS-R09) · **Owner** operations · **Priority** major
**Evidence** P4 › Inspect a room — Partly (SIM): "'Mark inspected' on clean rooms only; no fail/reason/checklist; state
doesn't change"; persona ask "An inspection checklist with pass/fail, a reason and a photo" ·
`[screens/p4-02-villa154.jpg]`

**Proposed change.**
- **Inspect** opens an inspection sheet: the property's checklist as large pass/fail toggles (default pass); any fail
  needs a **reason chip** (configurable: drain, hair, linen stain, amenity missing) and an optional **photo**.
- Summary line: "Fail — 1 item: shower drain". Buttons: **Fail and re-clean** (default: same attendant, urgent) /
  **Pass**. Without a checklist: Pass / Fail with reason.
- A fail with an arrival today raises the front-desk issue with **Find a ready villa** (FD-05) automatically.
- Photo capture depends on an object-store upload path (operations keeps `objectRef`; "upload happens elsewhere") —
  confirm with the foundation before wiring photos.

**Expected outcome (targets).** Pass in ≤ 20 s; fail with reason in ≤ 40 s.

**Power check.** OPS-R09 is fully exposed; sampled inspections remain a (b) follow-up.

---

### HK-03 · Plan and assign the day with explained suggestions

**Category** (a) — `/operations/properties/:id/housekeeping/plan`, `/assignment-suggestions`, `/assignments` (OPS-R05,
OPS-R07) · **Owner** operations (+ packages/ui selection, SR P1-5) · **Priority** blocker
**Evidence** P4 › Assign attendants — **No** ("Attendant filter only"); T4; persona ask "Tap or drag rooms onto
attendants, with credit and workload totals" · `[screens/p4-03-views.jpg]`
**Overlaps** SR P1-5 (selection model and bulk actions in DataTable)

**Proposed change.**
- A **Board / Plan** toggle on the housekeeping page. **Plan**: left, unassigned tasks (departure clean, stayover,
  turndown, arrival inspection) with credits; right, one lane per attendant with a credit bar (assigned vs target) and
  their section/island zone.
- **Suggest assignment** → preview with reasons from operations ("keeps Jetty A with Hussain; balances credits 14 / 15
  / 13") → **Apply**. Suggestions are suggestions: nothing changes until applied.
- Manual: tap rooms (or `x` / Shift+click) → **Assign to Hussain**; or drag onto a lane (always with the tap/keyboard
  alternative, WCAG 2.5.7).
- A **Tomorrow** tab uses the plan's `date` parameter for forward planning.

**Expected outcome (targets).** Assign 40 units in ≤ 5 min with 0 unassigned departures (ux §19). Baseline: not
possible.

**Power check.** Matches OPERA/Stayntouch assignment and credits (research 02 §4.3); manual override always wins; no
automatic reassignment without the supervisor.

---

### HK-04 · Warn when a room will be ready after its guest arrives

**Category** (c) · **Owner** operations (derive `lateBy` from `readiness.expectedReadyAt` vs the arrival ETA it already
holds) · **Priority** major
**Evidence** P4 › Board content: "Missing: a warning when the estimate is **after** the arrival. Villa 107 is ready ≈
12:40 for a VIP arriving 11:15"; P2 › Emma: "Ready (estimate) ≈ 13:55, five hours after arrival" ·
`[screens/p4-01-home.jpg]` `[screens/p2-07-villa208.jpg]`

**Proposed change.**
- Operations returns `lateBy` (minutes) when the estimated ready time is after the ETA (one computation, shown
  everywhere — personas "cross-persona consequence 1").
- Board row: red chip **"Late for arrival · 1 h 25 m"** next to the ready estimate (with its *Estimate* marker); the
  "Arrivals first" view sorts these to the top.
- Front-desk readiness shows the same sentence and offers **Rush** (guest-waiting priority) or **Find a ready villa**.

**Expected outcome (targets).** 100 % of at-risk arrivals flagged before their ETA (fixture test).

**Power check.** Adds a derived signal; estimates and their basis are unchanged.

---

### HK-05 · "My rooms" for attendants

**Category** (a) — `/v1/operations/my-work`, task transitions, attendant API (OPS-R08) · **Owner** operations ·
**Priority** blocker (for the attendant role)
**Evidence** P4 › Room attendant (phone): "Sees all 120 villas in one 10,514 px scroll, with no 'my rooms'. Has no
Start / Done cleaning. Gets the supervisor's 'Mark inspected' button"; T4, T17 · `[screens/p4-04-attendant-phone.jpg]`
`[screens/p4-05-attendant-room.jpg]`

**Proposed change.**
- `housekeeping_attendant` lands on **My rooms**: a route-ordered list of *their* tasks (typically 12–16). Each card:
  villa, task kind (Departure clean · Stayover · Turndown), priority tags (VIP, early arrival with ETA), DND state,
  and one big button: **Start** → **Done**.
- Header: "5 of 14 done · 62 credits". Footer actions: **Report issue** (camera), **Found item**, **DND**.
- No board, no inspection buttons — the server's permissions decide, and the UI hides page-level actions the role
  cannot perform (SET-07 rule).
- Connectivity honesty until the staff PWA exists: the back office is online-only, so show "Offline — changes not sent"
  and disable buttons with that reason (ux §11); the offline queue arrives with the staff app (OPS-R21/R22 server side
  is ready).

**Expected outcome (targets).** Update a room in ≤ 2 taps (ux §19); the list shows only own tasks (baseline: 120
rooms, 10,514 px).

**Power check.** The supervisor board is unchanged; an attendant with permission can still open "All rooms" read-only.

---

### HK-06 · Do not disturb with duration and welfare escalation

**Category** (a) — `POST /operations/units/:id/dnd` (on/off + reason), welfare check escalation (OPS-R03); "service
later at HH:MM" is **not built** (b) · **Owner** operations · **Priority** major
**Evidence** P4 › Handle a do-not-disturb room — **No** ("'Do not disturb: No' is display-only"); persona ask "DND with
time, retry and escalation"

**Proposed change.** A **DND** toggle on the room card and record (with an optional note); the board shows "DND · 3 h";
after the policy's hours a welfare task goes to the supervisor; when built, a **Service later at 15:00** chip.

**Expected outcome (targets).** Set DND in ≤ 2 taps; 0 DND rooms older than the policy without a welfare task.

**Power check.** Exposes OPS-R03; nothing removed.

---

### HK-07 · Lost & found log

**Category** (a) — `/v1/operations/lost-found` log, match, release, dispose with retention (OPS-R20) · **Owner**
operations · **Priority** major
**Evidence** P4 › Log a lost item — **No** ("Nothing (role card promises 'manages lost & found')")

**Proposed change.**
- **Found item**: photo first → what (category + description) → where (villa prefilled from context) → found by (me,
  now). Suggested owner: the villa's last occupant from stays, shown for confirmation, never auto-linked.
- List with status **Logged · Matched · Returned · Disposed** and the retention countdown. **Release** requires a
  handover proof (signature/receipt reference) or a shipping tracking number.

**Expected outcome (targets).** Log an item on a phone in ≤ 30 s.

**Power check.** OPS-R20 complete; retention rules are honoured.

---

### HK-08 · Report an issue, camera first, with its effect on sale

**Category** (a) — work orders, out-of-order via inventory with front-office resolution items (OPS-R16/R17), return to
sale gated (OPS-R18) · **Owner** operations · **Priority** major
**Evidence** P1/P4: "Report issue (disabled, 'wave 1')"; T3, T4 · `[screens/p1-20-room2.jpg]`

**Proposed change.** **Report issue**: photo → category chips (plumbing, AC, electrical, furniture…) → urgency → toggle
**"Room can't be sold"** (requires the ⚑ inventory-impact permission) which shows a **preview of affected stays and
nights** before committing. ≤ 3 taps + photo.

**Expected outcome (targets).** Report a fault with a photo in ≤ 30 s (ux §19).

**Power check.** The inventory-impact preview stays mandatory; permissions unchanged.

---

### HK-09 · The board fits a tablet and shows what a supervisor scans

**Category** (c) · **Owner** backoffice/ui (housekeeping screen, DataTable column priority, Drawer) · **Priority** major
**Evidence** P4 › Tablet layout: "every page is **111 px wider than the screen**"; "the record drawer's Close button is
off-screen (x = 1075)"; "the two navigation columns take 315 px, so the board shows only Unit / Section / Condition /
Occupancy above the fold"; T10 · `[screens/p4-01-home.jpg]` `[screens/p4-02-villa154.jpg]`
**Overlaps** SR P1-4 (column priority, collapse section list), NAV-05 (navigation per device)

**Proposed change.**
- At 768–1279 px the navigation collapses to the rail (NAV-05).
- Board columns by priority: **Unit** (+ type, section on a second line) · **Condition** · **Next arrival** (ETA, VIP,
  late chip from HK-04) · **Attendant** · **Ready (est.)** · inline primary action. Occupancy folds into the Unit cell
  as an icon + word. Lower-priority columns hide behind "+n columns" rather than scrolling sideways.
- The condition count tiles become filter chips (like FD-14).
- Drawer: width `min(560px, 100vw − 48px)`; Close always inside the viewport; Esc, back and swipe-down close it.

**Expected outcome (targets).** 0 px horizontal overflow at 1024×768 and 768×1024 (baseline +111 px); Close reachable
on 100 % of records.

**Power check.** Every column remains available through the column chooser and on wider screens.
