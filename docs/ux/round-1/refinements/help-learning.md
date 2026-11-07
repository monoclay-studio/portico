# Round 1 refinements — Help and learning

Scope: "Help for this screen", the Learning centre, the first-run checklist, guided practice and the training
organization. Personas P9 (brand-new hire on day one) and P1 (owner looking for help on a phone). Citation keys,
categories and the power-check rule are defined at the top of `front-desk.md`. Outcomes are **TARGETS** until validated
with hotel staff.

The structure is good (B8: role-based landing, a checklist that ticks itself off; stable help anchors ready for the
website). What fails is that every help surface is **empty**, and waiting for the website is not necessary: short,
task-level help can ship inside the product now and the website plugs into the same anchors later.

| ID | Refinement | Cat | Owner | Priority |
|---|---|---|---|---|
| HLP-01 | Built-in help on every screen, now | (c) | backoffice/ui | major |
| HLP-02 | Help that matches the device | (c) | backoffice/ui | minor |
| HLP-03 | The Learning centre shows what exists today | (c) | backoffice/ui | major |
| HLP-04 | Guided practice: tours that drive the real screens | (b) | backoffice/ui | major |
| HLP-05 | Every role can practise in training | (b) | platform | major |
| HLP-06 | The first-run checklist fits the person | (c) | backoffice/ui | minor |

---

### HLP-01 · Built-in help on every screen, now

**Category** (c) · **Owner** backoffice/ui (learning: `help-map.ts`, `help-panel.tsx`) · **Priority** major
**Evidence** P1 › Help: "It reads 'Help anchor: `frontDesk.arrivals` … Articles … will appear here once the Portico
website courses are published. **Nothing is missing from the product itself.**'"; P9: "'Help for this screen' is empty
everywhere"; T14 · `[screens/p1-23-help-arrivals.jpg]`

**Proposed change.**
- Each `helpKey` resolves first to an **in-product article** shipped with the app (Markdown in the repo, i18n-ready),
  then appends website articles/videos when `HELP_LINKS` has them (no code change, experience architecture §4):
  1. **What this screen is for** — one sentence.
  2. **Common tasks** — 3–5, each with numbered steps and a **Show me** link that highlights the control (uses
     `data-help-key`).
  3. **What the chips mean** — the screen's status vocabularies from ux §4 (Secured vs Balance, Ready vs Checked in…).
  4. **Keys** — desktop only (HLP-02).
- Remove "Help anchor: …" and "Nothing is missing from the product itself".
- A "Was this useful?" control feeds the help-anchor usage metric.
- Write order: Arrivals, stay record + check-in, walk-in, Housekeeping board, My rooms, Today, Bills, Day Close —
  following the top refinements as they ship.

**Expected outcome (targets).** Screens with non-empty help: **0 % → 100 %** of shipped screens; help requests per
persona ≤ 1 (scorecard).

**Power check.** Adds; the website plug-in path is unchanged.

---

### HLP-02 · Help that matches the device

**Category** (c) · **Owner** backoffice/ui · **Priority** minor
**Evidence** P1 › Help: "It also lists desktop keyboard shortcuts on a phone"

**Proposed change.** The Keys section appears only with a fine pointer (`pointer: fine`) or after a hardware key press;
touch devices see tap targets and gestures instead.

**Expected outcome (targets).** 0 keyboard-only instructions on touch devices.

**Power check.** n/a.

---

### HLP-03 · The Learning centre shows what exists today

**Category** (c) · **Owner** backoffice/ui (learning paths) · **Priority** major
**Evidence** P9: "**Every** lesson is 'CONTENT COMING', with internal codes shown (`APP.SHELL`,
`RESERVATIONS.CHECKIN`)"; P5: "Day Close step by step — VIDEO · `DAYCLOSE.RUN` · CONTENT COMING" ·
`[screens/p9-01-learn.jpg]`

**Proposed change.**
- Lesson cards show hotel-language titles only — no internal codes (NAV-09 lint).
- Each path starts with what exists now: the in-product articles (HLP-01), **Practise in training** scenarios (seaplane
  delay, last villa, failed inspection) and the checklist.
- Lessons without content are grouped under a collapsed **Coming later (12)**; progress counts only available items.

**Expected outcome (targets).** A new hire finds a usable check-in lesson in 1 click (baseline: none usable).

**Power check.** Nothing removed; future lessons stay listed under "Coming later".

---

### HLP-04 · Guided practice: tours that drive the real screens

**Category** (b) — no tour engine exists · **Owner** backoffice/ui (learning) + training scenarios · **Priority** major
**Evidence** P9: "A new hire would understand the layout … but would get no task guidance"; persona ask "Real guided
tours on each screen"

**Proposed change (design to build against).** A tour engine on the existing `data-help-key` anchors steps through a
real task on the live UI, in the training environment by default: "Check in a prepared arrival" (5 steps), "Walk-in",
"Move a guest after a failed inspection", "Check out with company billing", "Mark rooms clean". Each tour ends on the
real outcome, is resumable, and records completion in learning progress.

**Expected outcome (targets).** A new front-desk agent completes the 10 core desk tasks unaided within one shift
(ux §19).

**Power check.** Adds; tours never run in live without the user starting them.

---

### HLP-05 · Every role can practise in training

**Category** (b) — training-organization provisioning per membership (platform + identity, ADR-0017 global identity) ·
**Owner** platform (+ identity) · **Priority** major
**Evidence** P9: "The front-desk agent and night auditor see 'No training organization is linked to your account
yet'"; only the group director had one · `[screens/p9-02-practise.jpg]` `[screens/p9-03-training-org.jpg]`
`[screens/p9-04-training-arrivals.jpg]`

**Proposed change.** Every staff membership gets a linked training organization automatically (or a shared property
training org with per-user practice data), seeded with the scripted scenarios, plus **Reset my practice data**.
Switching keeps the amber TRAINING banner (B4).

**Expected outcome (targets).** Roles able to open training in 1 click: **1 of 3 tested → all**.

**Power check.** Adds; training stays fully isolated from live data.

---

### HLP-06 · The first-run checklist fits the person

**Category** (c) (the *Owner (all-in-one)* role template is (b), proposed in personas P17) · **Owner** backoffice/ui
(learning `checklistFor`) · **Priority** minor
**Evidence** P1: "the 'Get started as **Organization administrator**' checklist (the persona is an owner)"; P7: the group
director also sees "Organization administrator" · `[screens/p1-02-home.jpg]`

**Proposed change.**
- Choose the checklist from the **property profile + roles**, operational roles first: a single guesthouse with admin +
  operational roles → **Guesthouse owner** path (Walk-in, Record a payment, Mark rooms clean, See tomorrow, Add your
  cleaner); group-level admin → **Group director** path (Compare properties, Policies, Add staff to one property).
- Items are real tasks with **Do it now** links (not "Open a record from a list").
- Collapse after first view (NAV-06); dismiss-forever stays.

**Expected outcome (targets).** ≥ 4 of 6 checklist items completed in the first session.

**Power check.** Admin items remain available in the admin path and in Settings.
