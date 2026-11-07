# Portico: black-box UX evaluation, round 1

**Evaluator:** "mystery user". I am a hotel operations professional who has used OPERA, Mews, Cloudbeds and small-property systems. I used only the running product at http://127.0.0.1:5380, driven with Playwright (Chromium, deviceScaleFactor 1). I read no code or docs.
**Date:** 2026-11-07, which is the product's business date.
**Organizations used:** Azure Atoll Collection (demo and training) and Coral Nest Guesthouse (demo).
**Screenshots:** stored next to this file. File names appear in brackets, e.g. `[screens/p1-05-arrivals-full.jpg]`.

> **Which screens are simulated.** Arrivals, Timeline, Housekeeping board, My work, Today KPIs and the Change preview are all marked **SIMULATED**. Sign-in, organization/property/legal-entity/user settings, global search and record history are **live**.
>
> I judged the simulated screens on flow and clarity as if they were real. In the tables, findings from simulated screens are tagged **(SIM)**.

Counts are human-equivalent: taps/clicks plus keystrokes, the screens passed through, and my estimate of real staff time. Automation time is not used.

---

## Persona 1 — Guesthouse owner, phone 390×844 (Coral Nest, `owner.does.everything@…`)

| Task | Done? | Effort | Severity |
|---|---|---|---|
| Sign in | Yes | 1 tap + ~75 keystrokes, 1 screen, ~40 s | Major (repeat cost) |
| See who arrives today and what's not ready | Yes | 2 taps (Menu → Arrivals), 2 screens, ~15 s | Minor |
| Check in a guest | Partly (SIM) | 2 taps; toast only | Major |
| Walk-in for tonight | **No** | ~8 taps, 5 screens, ~3 min before giving up | **Blocker** |
| Take or record a payment | **No** | ~6 taps, 3 screens | **Blocker** |
| Mark rooms cleaned | **No** | 3 taps; there is no such action | **Blocker** |
| See tomorrow | Partly | Timeline only; no date control on Arrivals | Major |
| Find a past guest by partial name | **No** | 5 searches | **Blocker** |

**Sign-in** `[screens/01-landing.jpg] [screens/p1-01-wrong-password.jpg] [screens/p1-02-home.jpg]`
- The email is 55 characters long and the session "ends when the browser closes". There is no "remember this device", so the owner retypes it every morning on a phone.
- The wrong-password message is clear, but its title is "Sign-in required", which is odd for a wrong password. It also says "Trying again unchanged will fail the same way. Follow the steps above first." and shows a UUID reference that means nothing to an owner.
- There is no "forgot password" link.

**Today on phone** `[screens/p1-02-home.jpg] [screens/p1-03-today-full.jpg]`
- The first ~830 px are taken by:
  - the purple DEMO banner (~95 px);
  - the "Get started as **Organization administrator**" checklist (the persona is an owner);
  - a dashed SIMULATED notice.
- The real numbers only start below the fold.
- The property name is truncated to "Coral Nes…".
- The Departures tile is not tappable. The other tiles are.

**Arrivals** `[screens/p1-05-arrivals-full.jpg]`
- Good:
  - one card per arrival with a status line;
  - chips for condition, payment and stay;
  - red/green readiness.
- Not good:
  - The blocker, the most important line, is cut with an ellipsis ("Deposit charge of USD 132.00 is pending verif…").
  - The count tiles (2 Ready / 2 Blocked / 1 Transfer delayed) are not filters.
  - (SIM) Vikram Singh shows a speedboat icon, but the note says "Seaplane delayed about 3 h". He also counts as "Ready" although he will be 3 h late.

**Check in** `[screens/p1-06-priya.jpg] [screens/p1-07-checkin-1.jpg]`
- Tapping **Check in** acts immediately: no confirmation, no ID, no registration card, no signature, no key, no balance collection.
- A toast says "Check in — simulated. Nothing real changed". The chip still reads *Expected*, so the simulation does not move either. (SIM)
- Ahmed's record shows a "Check-in progress 1 of 4 steps" panel (Verify identity / Secure payment / Confirm unit / Issue key) `[screens/p1-16-ahmed.jpg]`. None of the steps can be done from it.
- **Truthfulness:** the payment chip says **Paid**, while the same record shows *Balance $191.79* and "Deposit received" (30 %). A desk agent would believe nothing is owed. (SIM)
- "Move unit — Available when the reservations module is connected (wave 1 in progress)". This is internal project language shown to hotel staff.

**Extend stay** `[screens/p1-09-extend.jpg] [screens/p1-10-extend-options.jpg] [screens/p1-11-extend-confirmed.jpg]`
- This is the best screen in the product.
  - The preview shows availability before→after, nights, accommodation, service charge 10 % → TGST 17 % → Green Tax, and the deposit held as a liability.
  - It shows the balance, what else happens (housekeeping re-plan, "nothing charged now"), a preview expiry, and a re-check on confirm.
- But:
  - The default is 2 nights and the only choices are 1–3 nights. There is no date picker.
  - On phone the "Change" column is clipped.
  - The preview already warns "Room 1 is booked by another stay … will require a room move **(scenario S03)**". Confirm is still enabled. It then fails with "Conflict … Choose a room move or other dates". Move unit is disabled, so this is a **dead end**.
  - "(scenario S03)" and "Simulator sample lines. Real taxes come from the rates module's effective-dated rules…" are developer text.

**Walk-in** `[screens/p1-13-search-walk.jpg] [screens/p1-14-timeline-full.jpg] [screens/p1-15b-free-cell-enter.jpg]`
- These all returned "No results. *Try fewer words.*":
  - the menu (Today, My work, Learning centre, Arrivals, Timeline, Board, Settings): no item;
  - search for "walk", "new", "book", "reserv", "check", "pay" and "clean". That advice makes no sense for a one-word query.
- The palette contains records only. It has no commands.
- The only path I found was Timeline → tap the free Room 5 cell tonight. The toast said "Walk-in for Room 5 on 2026-11-07 — not available yet (reservations module in progress)". Tapping twice stacked two identical toasts.

**Payment** `[screens/p1-16-ahmed.jpg] [screens/p1-18-mywork-full.jpg]`
- The blocker says "pending verification — check status; do not charge again". There is no **Check status** button and no link to the payment.
- There is no "Take payment" or "Record cash / bank transfer" anywhere.
- The Today tile "Payments pending verification **2 · $664.28**" opens *My work*. That list has **one** payment item ($132), so the numbers don't reconcile.
- *My work* on a phone is a desktop table you scroll sideways.
- (SIM) A 12-room guesthouse's list includes "minibar charge disputed in **Villa 118**" and "Approve rate override: **Water Villa**". Resort data is leaking into the guesthouse.

**Mark rooms cleaned** `[screens/p1-19-hk-full.jpg] [screens/p1-20-room2.jpg] [screens/p1-22-room4-inspect.jpg]`
- The board itself is fine on phone for 12 rooms.
- A Dirty room offers only **Mark inspected** (disabled: "Only clean units can be inspected") and **Report issue** (disabled, "wave 1").
- There is no "Start cleaning", "Mark clean" or "Set DND". On a Clean room, "Mark inspected" gives a toast and the chip stays *Clean*. (SIM)
- Tapping a related-stay link pops a hover card over the content, which is clumsy on touch.

**See tomorrow:** Arrivals has no date selector, previous/next or "Tomorrow" tab. The only option is reading the Sun 8 column on the Timeline, or the 14-night occupancy chart in percent.

**Past guest by partial name** (live search + SIM stays)

| Query | Result |
|---|---|
| "Kowal" | none, although Anna Kowalska is **in house** in Room 10 |
| "beck" | none (Lukas Becker departed this morning) |
| "lukas" | only "Lukas Müller", a profile not linked to any stay |
| "anna k" | "Anna Smirnova" |

Search covers only today's arrivals and stand-alone guest profiles. In-house and past stays are not searchable.

**Help** `[screens/p1-23-help-arrivals.jpg]`
- It reads "Help anchor: `frontDesk.arrivals` … Articles … will appear here once the Portico website courses are published. **Nothing is missing from the product itself.**"
- It also lists desktop keyboard shortcuts on a phone.

---

## Persona 2 — Resort front-desk agent, desktop 1440×900, 07:30 rush

| Task | Done? | Effort | Severity |
|---|---|---|---|
| Find guest by partial name | Yes | `/` + 5 chars + Enter, 1 screen, ~4 s | — |
| Find by phone-number fragment | **No** | Guest profiles hold no phone at all | Major |
| Find by confirmation code | Yes | `/` + "2QMG" + Enter, ~4 s; case-insensitive | — |
| See which arrivals are blocked and why | Yes/partly | 3 clicks (Readiness → Not ready), ~10 s | Minor |
| Villa failed inspection before VIP arrival | Partly (diagnose yes, act no) | 2 clicks to find; no fix action | **Blocker** |
| Move guest to another villa | **No** | Move unit disabled | **Blocker** |
| Extend a stay | Partly (SIM) | 3 clicks, preview; 1–3 nights only | Minor |
| Delayed seaplane | Partly (visible, not actionable) | 1 click to see | Major |
| Checkout, bill split company/guest | **No** | ~6 clicks searching; no checkout, folio or routing | **Blocker** |

**Arrivals table** `[screens/p2-01-home.jpg] [screens/p2-11-not-ready.jpg] [screens/p2-13-arrivals-full.jpg]`
- Good:
  - dense, sortable table;
  - Condition / Payment / Readiness filters;
  - "Views" with a modified-view asterisk and removable chips;
  - red left bar on blocked rows;
  - VIP and Family/Honeymoon tags;
  - "**Authorized (not paid)**" shown as different from Paid.
- Not good:
  - At 1440 px the table is cut off on the right (Stay, Owner) and readiness reasons are truncated.
  - The left two-level navigation (icon rail plus a "Front desk" column holding a single item, "Arrivals") wastes ~315 px.
  - The free-text filter only matches names and codes: "delay" and "seaplane" both return 0 rows `[screens/p2-12-filter-delay.jpg]`.
  - The tiles are not clickable.
- (SIM) Two arrivals marked "Stay status: **In house**" still say "Ready for check-in".
- (SIM) Today says "9 of 16 ready"; Arrivals says "7 Ready". The counts disagree.

**Search** `[screens/p2-03-search-kowal.jpg]`
- Fast, keyboard-driven, and it shows the code and villa.
- "villa 208" also returns "**Standard Room 208**" and the unit types "Beach Villa" and "Water Villa", which come from live configuration that doesn't match the simulated villas.
- Selecting a live guest-profile result such as "Anna Smirnova" **does nothing**: the palette closes and no record opens `[screens/p2-08-live-guest.jpg] [screens/p2-09-live-guest-click.jpg]`.
- The phone queries "+960" and "7712" return nothing. The guest record holds only name and VIP; "Edit — Available when the guests module is connected" `[screens/p2-06-guest.jpg]`.

**Failed inspection, VIP Emma Johansson, ETA 08:45, Villa 208** `[screens/p2-05-emma.jpg] [screens/p2-07-villa208.jpg]`
- The blocker is very clear: "failed inspection at 09:12 (shower drain) — re-clean assigned to Aishath". The villa shows "Ready (estimate) ≈ 13:55", five hours after arrival.
- Expected, as in OPERA's room-assign "suggest" or Mews's space reassignment: offer the inspected free Water Villas, with one action to "Move and notify housekeeping/butler".
- Instead there is nothing: Move unit is disabled, there is no Assign, no "Rush clean" and no "Notify".
- (SIM) The re-clean is "assigned to Aishath", but Aishath is the front-desk agent (owner "Aishath (front desk)").
- The VIP tag is on the list row but **not on the stay record header**.

**Unassigned Sara Lindqvist** `[screens/p2-22-unassigned.jpg]`
- The system says "No Two-Bedroom Beach Residence assigned — **2 inspected and free today**", yet offers no Assign button.
- "2 adults, 1 children".

**Delayed seaplane, Wei Zhang** `[screens/p2-14-wei-delay.jpg]`
- The record shows the delay well: "ETA 13:35 scheduled → 16:35 (estimated)", "Transfer · Needs attention".
- (SIM) The labels disagree: the list says "Domestic flight · delayed 180 min" and the issue says "**Seaplane** delayed about 3 h".
- "Dinner and sunset dive flagged", but flagged to whom? There is no Update ETA, notify F&B/spa/butler, rebook transfer, message guest, or "overnight in Malé" option. That last one matters because seaplanes stop at sunset.
- **Check in is enabled** for a guest who is still in the air.

**Checkout + split bill** `[screens/p2-15-today.jpg] [screens/p2-16-inhouse.jpg] [screens/p2-18-inhouse-stay.jpg]`
- There is no Departures list or In-house list, and the Departures tile is not clickable.
- "In house: 106 — Open the records behind" lands on the **Housekeeping board**.
- An in-house stay opened from the Timeline has no Check out, no folio, no balance and no routing. Its first button is a disabled **Check in** ("Only expected stays can be checked in").

**Keyboard-only pass** `[screens/p2-19-shortcuts.jpg] [screens/p2-21-drawer-focus.jpg] [screens/p2-23-timeline-keyboard.jpg]`
- Good:
  - `G` then `A`/`T`/`D`/`H`/`W`/`L`/`P`/`U` go-to chords, `/` and Ctrl K, `?` shortcut sheet, Esc closes drawers;
  - visible focus rings everywhere;
  - skip link;
  - the Timeline is one tab stop with arrow keys and Enter (17 Tabs to reach it).
- Problems:
  - The arrivals grid needs 21 Tabs to reach the first row, and every villa link is its own tab stop.
  - **Opening a row with Enter leaves focus in the grid**: 13 more Tabs pass hidden links before reaching the drawer, so **17 Tabs to reach "Check in"**.
  - There are no action hotkeys (e.g. C = check in, M = move, P = payment).
  - "N" says "Nothing to create on this screen — use the command palette", but the palette has no create commands.

---

## Persona 3 — Reservations agent, desktop 1920×1080

| Task | Done? | Effort | Severity |
|---|---|---|---|
| Quote and book a family of 4 in two villas | **No** | ~6 attempts (N, palette, empty cell, hold) | **Blocker** |
| Change dates | Partly (SIM) | Only "Extend stay" by 1–3 nights at the end | Major |
| Cancel and understand the fee | **No** | More actions → Cancel booking disabled; no policy shown | **Blocker** |
| Availability next two weeks | Partly | Timeline (21 nights) + Today occupancy % | Major |

`[screens/p3-01-home.jpg] [screens/p3-03-option.jpg] [screens/p3-04-occ-table.jpg] [screens/p3-05-future-stay.jpg] [screens/p3-06-future-more.jpg] [screens/p3-07-future-checkin.jpg] [screens/p3-08-extend-future.jpg]`

- The navigation has Overview and Reservations → Timeline only. There is no "New reservation", availability search, rate or quote screen, rate plans, or multi-room booking.
- Clicking a hold bar ("Option 3GXVK") opens the **Villa** record, not the option or quote. Holds cannot be inspected.
- The Timeline looks clean and uses 1920 px well (21 nights × 120 villas, legend for expected / in-house / departed / OOO / hold).
- What it lacks:
  - unit-type filter;
  - free-count row per type;
  - "find free villa for dates";
  - jump-to-date (only Earlier / Today / Later).
- The availability counts the agent needs ("9 free → 8 free") appear only inside the extend preview.
- The Today occupancy chart gives percent by type, not rooms free.
- (SIM) A stay arriving **Nov 16** can be checked in today: "Check in — simulated" with no guard.
- (SIM) Its History shows "Unit assigned … **in 8 days**", "Arrival details received … **in 6 days**". These are future-dated history events.
- The booking record has no rate plan, source/channel, booker/contact, cancellation or deposit policy, or guarantee type.

---

## Persona 4 — Housekeeping supervisor, tablet 1024×768

| Task | Done? | Effort | Severity |
|---|---|---|---|
| Plan today's work | Partly | Board opens on login, "Arrivals first" view | Minor |
| Assign attendants | **No** | Attendant filter only | **Blocker** |
| Inspect a room | Partly (SIM) | "Mark inspected" on clean rooms only; no fail/reason/checklist; state doesn't change | Major |
| Handle a do-not-disturb room | **No** | "Do not disturb: No" is display-only | Major |
| Log a lost item | **No** | Nothing (role card promises "manages lost & found") | Major |

`[screens/p4-01-home.jpg] [screens/p4-02-villa154.jpg] [screens/p4-03-views.jpg] [screens/p4-04-attendant-phone.jpg] [screens/p4-05-attendant-room.jpg]`

**Tablet layout**
- At 1024 px every page is **111 px wider than the screen**.
- The Help and Account buttons are off-screen, and **the record drawer's Close button is off-screen** (x = 1075). On a tablet without a keyboard you cannot close a room record except with browser back.
- The two navigation columns take 315 px, so the board shows only Unit / Section / Condition / Occupancy above the fold.

**Board content**
- Good:
  - sorted by urgency;
  - VIP, next-arrival ETA and surname;
  - priority reason ("Arrival today · VIP · Failed inspection — re-clean");
  - attendant and ready estimate;
  - saved views (Arrivals first / All units / Failed inspection / Save current view…).
- Missing: a warning when the estimate is **after** the arrival. Villa 107 is ready ≈ 12:40 for a VIP arriving 11:15, with no warning. (SIM)

**Room attendant (phone)**
- Sees all 120 villas in one 10,514 px scroll, with no "my rooms".
- Has no Start / Done cleaning.
- Gets the supervisor's "Mark inspected" button.

---

## Persona 5 — Night auditor

**Done?** **No. Blocker.**

`[screens/p5-01-home.jpg] [screens/p9-01-learn.jpg]`

- There is no Day Close / Night audit item in the navigation.
- Search for "day close", "audit", "close" and "end of day" returns nothing.
- The only traces are:
  - the extend preview's phrase "the folio receives the new nights at Day Close";
  - Learning centre → "Day Close step by step — VIDEO · `DAYCLOSE.RUN` · CONTENT COMING".
- What needs resolving first: *My work* lists exceptions "Urgent first" across departments, which is a reasonable start.
- What's missing: the classic audit pre-checks (pending-verification payments, un-checked-in arrivals and no-shows, open folios, room-status discrepancies, rate checks).

---

## Persona 6 — Finance manager

**Done?** **No. Blocker.**

`[screens/p6-01-home.jpg] [screens/p6-02-payments-mywork.jpg]`

- The navigation is Overview + Settings only. There is no folios, accounts receivable, company accounts, deposits ledger, cashier or payments screen.
- "Payments pending verification: 2 · $6,546.36" opens *My work*, which lists 14 items. They are all housekeeping or front-desk items; **none are payments**.
- Search for "folio", "invoice", "company" and "ledger" returns nothing.
- The role card says finance covers "Folios, invoices, receivables, cashier reconciliation, payouts and exports". None of these is reachable.

---

## Persona 7 — Group director (all properties)

| Task | Done? | Effort | Severity |
|---|---|---|---|
| Compare the properties | **No** | Must switch property and read each Today | Major |
| Change a policy for all properties, see overrides | **No** | Property settings = name, type, timezone, check-in/out time, status | **Blocker** |
| Add a user limited to one property | **Yes** | ~8 clicks, ~100 keystrokes, 1 page + modal, ~90 s | Minor |
| Add a new property | **No** | No "New property"; `N` does nothing; only "New legal entity" exists | Major |

`[screens/p7-01-home.jpg] [screens/p7-02-switch-property.jpg] [screens/p7-03-settings-org.jpg] [screens/p7-04-properties.jpg] [screens/p7-06-property-record.jpg] [screens/p7-07-edit-property.jpg] [screens/p7-09-empty-name-save.jpg] [screens/p7-10-users.jpg] [screens/p7-11-invite.jpg] [screens/p7-12-invite-invalid.jpg] [screens/p7-15-invite-done.jpg] [screens/p7-16-newuser-home.jpg] [screens/p7-17-roles.jpg] [screens/p7-18-legal.jpg]`

**Organization chooser at sign-in**
- Demo vs Training is clearly tagged.
- The radio buttons are announced by **UUID** to screen readers.
- The group director's onboarding checklist says "Organization administrator".

**Properties**
- All three show status **setup** and the issue "This property is in setup — it is not yet operating", while the resort Today shows 106 guests in house. (SIM)
- History says "Property created by **demo-seeder**".
- While editing Azure Lagoon Hotel, the header switcher still says Azure Atoll Resort.

**Error handling: empty property name → Save.** The red box reads:

> "Something went wrong in this screen `[ { "origin": "string", "code": "too_small", "minimum": 1, … "message": "Too small: expected string to have >=1 characters" } ]`. **Reload the page**; if it happens again, quote the reference to support. Reference: `property-save`"

- The output is raw JSON.
- The field is not highlighted.
- The advice is harmful: reloading loses the user's edits.

**Invite staff member**
- It works, and signing in as the new user confirms they see **only Azure Lagoon Hotel**.
- Friction:
  - "Applies to" defaults to **Whole organization**, the riskiest choice;
  - one role per invite;
  - "Safe to retry: this form reuses one request key until it succeeds" is developer copy;
  - validation copy is raw: "Too small: expected string to have >=1 characters", "Reference: client";
  - "Invite" sends nothing; you set a password yourself;
  - the staff table shows raw role codes (`front_desk`, `org_admin`, `housekeeping_attendant`);
  - the Roles tab shows "Organization administrator · **1 PERMISSIONS**";
  - the account menu shows "Front desk agent, Front desk agent, Front desk agent".
- Positive: the Roles tab gives a plain-language description of each role.

---

## Persona 8 — IT administrator: connect an existing system

**Done?** **No. Blocker.**

- Settings has only Organization / Properties / Legal entities / Users & roles. There is no Integrations, Connections, API keys, webhooks or data-authority screen.
- Search for "connect" and "integration" returns nothing. `/integrations` returns "Page not found" `[x-05-404.png]`.
- One honest touch: the Organization page has a "**What is live in this build**" table listing each capability as Live API or SIMULATED `[screens/p7-03-settings-org.jpg]`. Its wording ("this build", module names) is still developer language.

---

## Persona 9 — Brand-new hire, day one

**Done?** **Partly. Major.**

`[screens/p9-01-learn.jpg] [screens/p9-02-practise.jpg] [screens/p9-03-training-org.jpg] [screens/p9-04-training-arrivals.jpg] [x-03-account-menu.png]`

- Good:
  - a role-based Learning centre with progress;
  - a "Get started as …" checklist that ticks itself off as you use the product (it noticed my `/` search and `?` use);
  - "Practise in training" in the account menu;
  - for the group director, a real **training organization** with an amber TRAINING banner that is unmistakably different from the purple DEMO one.
- Not good:
  - **Every** lesson is "CONTENT COMING", with internal codes shown (`APP.SHELL`, `RESERVATIONS.CHECKIN`).
  - The front-desk agent and night auditor see "No training organization is linked to your account yet".
  - "Help for this screen" is empty everywhere (see P1).
- A new hire would understand the layout from the consistent record anatomy, but would get no task guidance.

---

## Cross-cutting checks

**Light vs dark** `[x-01-dark-arrivals.png] [x-02-dark-record.png] [x-03-account-menu.png]`
- Dark mode is well done: chips keep their meaning and contrast, the focus ring is visible and the banners keep their identity.
- The theme can follow the system, and the menu also offers Compact/Comfortable density and an Arabic stub.

**Error handling**

| Case | Message | Verdict |
|---|---|---|
| Wrong password | Clear text, odd title | OK |
| Extend conflict | "…Nothing was changed" | Good |
| Bad record link | "This record was not found or you do not have access to it" (with a `common.loading` key leak) `[x-06-bad-record.png]` | Good |
| 404 | Plain page | Good |
| Forbidden page | "Not allowed … (`identity.user.read`)" while the **Invite staff member** button stays visible `[x-04-forbidden.png]` | Poor |
| Property save | Raw JSON (see P7) | Bad |

- "Trying again unchanged will fail the same way. Follow the steps above first." is appended to **every** error. That includes errors where retrying is exactly right.

**Possible permission gap**
- The housekeeping supervisor has no Front desk in the navigation, but typing `/front-desk/arrivals` shows the full arrivals list with guest names and payment status (`x-06` background). (SIM screen)
- Server read permission should be verified for simulated workspaces too.

**Data truthfulness (SIM)**
- The same guest appears in several rooms at once (Ayesha Khan in-house in 2 villas; Mateo Fernández in-house in 103, departing from 208 and arriving in 205).
- A "Paid" chip appears with a balance due.
- Today and Arrivals counts disagree.
- History is future-dated.
- Live unit names don't match simulated ones.
- This undermines an evaluator's trust even when labelled simulated.

---

## Top 20 friction points (ranked)

1. **No way to create anything: booking, walk-in, quote or option.**
   - The `N` key tells you to use the command palette, but the palette has no commands.
   - Clicking a free cell says "not available yet". (P1, P3; Blocker)
2. **No checkout, folio, balance, payment capture or bill split.**
   - There are no Departures or In-house lists.
   - "In house" opens the housekeeping board.
   - An in-house record's main button is a disabled "Check in". (P1, P2, P6; Blocker)
3. **The key operational actions are all disabled** with "Available when the … module is connected (wave 1 in progress)": Move unit, Cancel booking, Assign, Edit guest and Report issue. A failed-inspection VIP cannot be re-roomed. (P2; Blocker)
4. **Housekeeping cannot do housekeeping.** There is no mark clean, start cleaning, assign attendant, DND, lost & found or fail-inspection-with-reason. Attendants have no "my rooms". (P1, P4; Blocker)
5. **Night audit / Day Close does not exist** in navigation or search. (P5; Blocker)
6. **No finance area.** The payments-pending tile opens an unrelated list, and its totals ($664.28 / $6,546.36) match nothing you can see. (P6; Blocker)
7. **No integrations/connections area.** This contradicts the "connect alongside your current system" positioning. (P8; Blocker)
8. **Search is narrow and partly broken.**
   - It covers only today's arrivals and profiles; in-house and past guests are not found.
   - It has no phone or email search.
   - Selecting a guest-profile result does nothing.
   - "Try fewer words" appears for one-word queries. (P1, P2; Blocker/Major)
9. **Simulated actions don't change the simulation.** Check-in and Mark inspected leave the status unchanged, so no scenario can be walked end to end in a demo. (SIM; Major)
10. **Tablet 1024 px layout overflows by 111 px.** Account, Help and the drawer Close button are off-screen, and the 315 px double navigation shrinks the board. (P4; Major)
11. **Contradictory status = untrustworthy.**
    - "Paid" with a balance due.
    - 9 vs 7 ready.
    - "In house" rows marked "Ready for check-in".
    - Check-in allowed 9 days early and for a guest still in the air.
    - Future-dated history.
    - Properties "not yet operating" with 106 guests. (Major)
12. **Raw validation output:** JSON blobs, Zod sentences ("Too small: expected string to have >=1 characters") and "Reload the page" advice. (P7; Major)
13. **Developer jargon throughout:**
    - "wave 1 in progress", "module is connected";
    - "(scenario S03)", "Simulator sample lines…rates module";
    - "Help anchor: frontDesk.arrivals", "demo-seeder";
    - `identity.user.read`, role codes, lesson codes, `common.loading`;
    - "Reference: client";
    - "this form reuses one request key". (Major)
14. **Help and learning are empty shells.** Every lesson is "CONTENT COMING", and most roles have no training organization. (P9; Major)
15. **Keyboard flow breaks at the record drawer.** Focus stays behind it (17 Tabs to Check in), every villa link is a tab stop, and there are no action hotkeys. (P2; Major)
16. **No date navigation or alternative lists.** There is no "tomorrow" on Arrivals, no Departures or In-house list, and the KPI tiles are inconsistent: some are not clickable, others open the wrong place. (P1, P2; Major)
17. **The phone experience is a squeezed desktop.**
    - Numbers sit below the fold under the banner, checklist and notice.
    - Blocker text is truncated.
    - *My work* is a sideways table.
    - The 120-villa board is 10,500 px long.
    - The 55-character email must be retyped every session. (P1; Major)
18. **Delayed transfers are visible but not manageable.** There is no ETA update, departmental notification, rebooking or overnight option, and transport-mode labels contradict each other. (P2; Major)
19. **Group tooling is missing:** no portfolio comparison, no policy centre with inheritance and overrides, and no Add property. (P7; Major/Blocker)
20. **Access hygiene.**
    - The invite form defaults to "Whole organization".
    - Only one role per invite.
    - Role codes are shown raw.
    - The forbidden page still shows "Invite".
    - The HK supervisor can open arrivals and payment status by URL. (P7; Major)

*Polish:*
- "1 children"
- "Front desk agent ×3" in the account menu
- "1 PERMISSIONS"
- radio buttons announced by UUID
- a hover card popping up on tap
- "Organization administrator" checklist shown to an owner
- "Sign-in required" as the title for a wrong password
- extend-stay defaults to 2 nights
- "/" doesn't respond in the first ~second after a page loads

## Top 10 things that felt better than systems I know

1. **The arrival readiness model.**
   - Each arrival has one plain-language blocker, six readiness checks (unit, condition, payment, documents, transfer, requests) and an owner.
   - It answers "why can't I check this guest in?" faster than OPERA's arrivals or Mews's timeline. (SIM)
2. **The change preview.**
   - It shows before/after for availability, price and each tax line (service charge → TGST → Green Tax), the deposit as a liability, the balance, side effects on housekeeping, a preview expiry and a re-check on confirm.
   - This is better than anything in Cloudbeds or Mews. (SIM)
3. **Honest payment language:** "Pending verification — do not charge again" and "Authorized (not paid)". This is exactly how double charges are prevented (once "Paid" is fixed).
4. **Provenance you can't miss.** There are DEMO (purple) and TRAINING (amber) banners, SIMULATED chips with "last synced", per-tile data-source tags, and the "What is live in this build" table.
5. **Keyboard-first desk ergonomics:**
   - `G`+letter navigation, `/` and Ctrl K, the `?` sheet;
   - arrow-key timeline with a single tab stop;
   - Esc to close, visible focus rings;
   - compact density.
6. **Consistent record drawers.** Every record has the same anatomy: chips, actions with **disabled reasons**, issues, owner, details, related records, history. They stack with breadcrumbs and can be pinned or opened full page.
7. **Disabled buttons explain themselves:** "Only clean units can be inspected (this one is Dirty)", "Only expected stays can be checked in (this stay is In house)".
8. **Role-based landing and onboarding.** Housekeeping lands on the board, reservations on the timeline, front desk on arrivals. The "Get started" checklist ticks itself off.
9. **A housekeeping board built for arrivals.** It is sorted "Arrivals first" with VIP, ETA and surname, the priority reason, attendant and ready estimate, and it supports saved views.
10. **Maldives-aware arrival detail** (seaplane, speedboat or domestic flight + speedboat; international flight; arrival point; scheduled → estimated ETA) and **well-made dark mode**. Concurrency messaging ("saved with the version you opened … re-apply yours") and "Nothing was changed" on conflicts also build trust.

## What would make each persona's work "as easy as humanly possible"

**Guesthouse owner (phone)**
- Make the first screenful the day itself: arrivals with a one-tap fix per blocker, rooms to clean with a one-tap **Clean ✓**, and money to collect.
- Add a big **+ Walk-in** button: it picks a free room tonight, captures name/phone/passport by camera, takes cash, card or bank transfer and prints or WhatsApps a receipt, in about 3 taps.
- Add a Today/Tomorrow swipe.
- Make search find anyone who ever stayed, by name, phone or email.
- Remember the device, and let the checklist and notices be dismissed for good.

**Front-desk agent**
- Give arrival rows inline actions (Check in · Assign · Move · Pay) with hotkeys, and move focus into the drawer when it opens.
- When a villa fails inspection, show the inspected free villas of the same type. One action should move the guest and notify housekeeping and the butler.
- Add Departures and In-house lists with balances.
- Add **Check out** → folio with routing rules (company pays room + tax, guest pays extras), a split preview, and the invoice per payer.
- Add a transfer board: an ETA change cascades to F&B, spa and butler, with an "overnight in Malé" path.

**Reservations agent**
- `N` → quote: dates, rooms × (adults, children, ages), rate plans with policies shown and an availability count by type.
- Holds/options with expiry; convert a quote into a booking.
- Change dates (shift, shorten, change type) and cancel, each through the same preview, including the **fee from the snapshotted policy**.

**Housekeeping supervisor (tablet)**
- A board that fits 1024 px with collapsible navigation.
- Tap or drag rooms onto attendants, with credit and workload totals.
- An inspection checklist with pass/fail, a reason and a photo.
- DND with time, retry and escalation.
- A lost & found log with photo, location and a guest link.
- Each attendant's phone shows "My rooms" with Start/Done buttons that update the board live.

**Night auditor**
- A Day Close wizard: pre-checks (pending payments, no-shows, open folios, room-status mismatches, unposted charges), each with its fix button, then roll the date and produce the report pack.

**Finance manager**
- A Finance workspace with:
  - open folios;
  - company/AR accounts with balances and ageing;
  - a pending-verification queue showing provider status and a "Mark verified/failed" reconciliation;
  - deposits held;
  - cashier shift close and exports.

**Group director**
- A portfolio Today with properties side by side.
- A policy centre: organization defaults, per-property overrides highlighted, and a "where is this overridden?" view.
- An Add-property wizard.
- Invites that default to the current property, with several role/property chips.

**IT administrator**
- A **Connections** area:
  - a catalogue (PMS, channel manager, POS, accounting, door locks);
  - start read-only;
  - test in sandbox;
  - choose which system is authoritative per data domain;
  - see sync health and last-sync time.

**New hire**
- Real guided tours on each screen.
- A personal training organization created automatically, with a "reset my practice data" button.
- Help written in hotel language, not in project or module terms.
