# Round 1 refinements: Front desk

Scope: Arrivals, In house, Departures, the stay record, check-in, check-out, walk-ins and transfers. The personas are
P1 (guesthouse owner on a phone) and P2 (resort front desk during the 07:30 rush).

**How to read these files**

- **Citations.**
  - `P1`–`P9` are the persona sections of `../blackbox-findings.md`.
  - `T1`–`T20` are its "Top 20 friction points".
  - `B1`–`B10` are its "Top 10 things that felt better" (keep them).
  - `X` is "Cross-cutting checks" and `Pol` is the polish list.
  - `SR` is the steward review `docs/orchestration/reviews/review-backoffice.md`, and its fix round is already running.
  - Screenshot paths are relative to `docs/ux/round-1/`.
- **Categories.**
  - **(a) wiring:** a module already provides the capability but the UI does not use it yet.
  - **(b) missing capability:** no module provides it yet.
  - **(c) design / UX problem.**
- **Outcomes are TARGETS** until they are validated with real hotel staff (ux-principles §19). Baselines come from round 1.
- **Power check** confirms two things: nothing that competitors offer is lost, and nothing is removed or hidden from the
  people who need it.

| ID | Refinement | Cat | Owner | Priority |
|---|---|---|---|---|
| FD-01 | Check in opens a resumable checklist, not an instant action | (a) | reservations | blocker |
| FD-02 | Check-in knows whether the guest has actually arrived | (c) | reservations | major |
| FD-03 | Never "Paid" while money is due: show what is secured and what is still owed | (c) | reservations | major |
| FD-04 | Every blocker carries the button that clears it | (a) | reservations | blocker |
| FD-05 | Failed inspection before a VIP arrival: a ready villa in three clicks | (a) | reservations | blocker |
| FD-06 | Departures and In-house lists, opened by their tiles | (a) | reservations | blocker |
| FD-07 | Check-out with a split bill as one checklist | (a) | reservations | blocker |
| FD-08 | The primary button is always the next valid action | (c) | backoffice/ui | major |
| FD-09 | Walk-in in one sheet | (a) | reservations | blocker |
| FD-10 | Tomorrow is one tap away | (a) | reservations | major |
| FD-11 | Update the ETA and see who is affected | (a) | reservations | major |
| FD-12 | Disruption actions for Maldives transfers | (b) | reservations | major |
| FD-13 | Keyboard: from an arrival row to Check in in three keys | (c) | backoffice/ui | major |
| FD-14 | Arrivals on a phone: the full blocker, one fix, filters from the counts | (c) | backoffice/ui | major |
| FD-15 | Money on the arrivals board only for roles that handle money | (c) | reservations | major |

---

### FD-01 · Check in opens a resumable checklist, not an instant action

**Category** (a) · **Owner** reservations (with payments, guests and access) · **Priority** blocker
**Evidence** P1 › Check in; T2, T9 · `[screens/p1-07-checkin-1.jpg]` `[screens/p1-16-ahmed.jpg]` `[screens/p3-07-future-checkin.jpg]`
**Overlaps** SR P1-1 (focus in the drawer); SR P1-6 (`readiness` is null for stays that are not expected)

**Problem.**

- Tapping **Check in** acts at once. There is no ID check, guarantee, deposit, key or confirmation.
- The record shows a "Check-in progress 1 of 4 steps" panel whose steps cannot be done.
- The server already has the real workflow:
  - `GET/POST /v1/stays/:id/check-in` and `/steps/:step`, plus `/skip` with a reason;
  - steps `registration → unit → guarantee → deposits → access → confirm` (`modules/reservations/src/domain/workflow.ts`);
  - each step is persisted, external steps are never repeated, and an interrupted run can be resumed (RES-R24..R27).

**Proposed change.**

- **Check in** (button, or the `c` key in a record) turns the drawer body into the **Check-in sheet**. The header stays
  (guest, code, status chips). It is not a dialog on top of the drawer.
- The sheet renders `workflowRun.steps` as a vertical checklist. Each row has a status icon, a plain label and its own
  control:
  1. **Identity and details.** Prefilled from the profile and booking. It asks only for fields that the property's
     policy requires and that are missing (GST-05), so nothing is asked twice (WCAG 3.3.7).
  2. **Room / villa.** Shows the assigned unit and its condition chip. If the unit is not in the required condition
     (policy `reservations.checkIn.requiredCondition`), it offers **Choose a ready villa** (FD-05). It also offers
     **Check in anyway** with a reason, for users who hold that permission.
  3. **Payment guarantee.** The Collect panel is embedded here (PAY-01) with the suggested action from the collection
     plan, for example "Authorize USD 500 incidentals on card ending 4242". It shows the result exactly:
     - Authorized (not paid);
     - Pending verification, with **Check now**;
     - Failed, with what to do next.
  4. **Deposits.** For example "Apply deposit USD 82.50 to Ahmed Al Rashid's bill". This is on by default and can be
     changed until Confirm.
  5. **Keys.** A count stepper (default from the number of occupants) and the key kind.
     - In demo or training the result is labelled "Simulated key".
     - When the key system is unavailable, a manual-fallback note is required and audited (as already built).
  6. **Confirm.** One summary sentence, for example: "Check in Ahmed Al Rashid to Room 8 tonight, 4 nights, 2 keys.
     Balance at check-out USD 191.79 (estimate)." The button is **Check in** (`Ctrl/⌘ Enter`).
- **Steps that are already satisfied** show a ✓ and are collapsed. For a prepared arrival, only Confirm needs attention.
- **Skipping.** Optional steps can be skipped with a reason. Mandatory steps can be skipped only with the permission
  the server already checks.
- **Interruptions.** If the drawer is closed or the network drops, the arrivals row shows "Check-in in progress · 3 of
  6 · Resume". **Resume** reopens the sheet at the first unfinished step.
  - A pending external step reads "Waiting for the card provider. Don't run the card again. [Check now]".
- **Success toast.** "Checked in · Room 8 · 2 keys issued. Balance USD 191.79 due at check-out." (ux §6)
  - There is no undo, because reversing a check-in (RES-R10) is not built. That is why the explicit Confirm step stays.
- **Phone and tablet.** Steps stack full width. The Check in button is pinned to the bottom, in the thumb zone
  (ux §12).
- **Wiring acceptance.**
  - The server's `allowedActions` decides whether Check in is enabled. The simulated "check in 9 days early" must be
    impossible. Add an e2e test.
  - Rows whose `readiness` is null must render without crashing (SR P1-6).

**Expected outcome (targets).**

- A prepared arrival is checked in in ≤ 60 s with ≤ 4 interactions: open, confirm guarantee, accept the key default,
  Check in. On the keyboard that is `Enter`, `c`, `Ctrl+Enter`.
- No check-in happens without the ID or guarantee that policy requires.
- A new hire completes a first check-in in ≤ 10 min (scorecard).
- **R1 baseline:** check-in could not be completed. It was a toast and the chip stayed *Expected*.

**Power check.**

- This matches the OPERA and Mews check-in checklist (PAR-RES-076, P0) and adds safe resume. Nothing is removed.
- Policy decides which steps are optional. Overrides keep their permissions and reasons.
- Mass check-in (PAR-RES-074) and pre-registration (PAR-RES-070) are still missing. They are (b) follow-ups and are
  not hidden by this design.

---

### FD-02 · Check-in knows whether the guest has actually arrived

**Category** (c) · **Owner** reservations (readiness), later resort (transfer status) · **Priority** major
**Evidence** P2 › Delayed seaplane ("Check in is enabled for a guest who is still in the air"); P3 (SIM check-in on a
Nov 16 arrival) · `[screens/p2-14-wei-delay.jpg]` `[screens/p3-07-future-checkin.jpg]`

**Problem.**

- Readiness answers "is the villa ready?" but not "is the guest here?".
- Checking in a guest who is still in transit starts the stay and activates keys. Housekeeping and Day Close then treat
  the villa as occupied.
- Checking in early is legitimate, for example a VIP who goes straight to the villa. It should be a choice, not an
  accident.

**Proposed change.**

- Arrival rows and the check-in sheet show an **"On property?"** fact taken from the arrival details:
  - "In transit · ETA 16:35 (estimated)";
  - "Arrived 08:52";
  - "Not known".
- Until a transfer status exists, the rule is simple: if the ETA is more than 30 min in the future, the guest counts as
  "in transit".
- Check in stays enabled for guests in transit, but:
  - the Confirm step adds one line: "Wei Zhang hasn't arrived yet (seaplane ETA 16:35, estimated). Checking in now
    starts the stay and activates keys before arrival.";
  - the button label becomes **Check in before arrival**.
  - There is no extra dialog (ux §5: confirm only for irreversible or external effects).
- A future arrival date is the server's rule, and the UI renders the reason: "Arrives Mon 16 Nov. To bring the arrival
  forward, use Change dates."

**Expected outcome (targets).** No unintended check-ins before arrival in round-2 tasks. Normal arrivals need no
extra clicks.

**Power check.** Nothing is restricted. Early check-in stays possible and is now labelled honestly.

---

### FD-03 · Never "Paid" while money is due: show what is secured and what is still owed

**Category** (c) · **Owner** reservations (readiness check `payment_secured`, row fields), with payments
(`statusPresentation`) and packages/ui · **Priority** major
**Evidence** P1 › Check in ("the payment chip says **Paid**, while the same record shows *Balance $191.79* and
'Deposit received' (30 %)"); T11; B3 (honest "Authorized (not paid)") · `[screens/p1-16-ahmed.jpg]`
`[screens/p2-13-arrivals-full.jpg]`
**Overlaps** SR P1-3 (payment vocabulary), SR P2-1 (simulated "Paid")

**Problem.**

- One "Payment" chip tries to answer two different questions:
  1. Is the stay secured enough to check in?
  2. Is money still owed?
- A deposit makes the answer to (1) yes while (2) is still yes. "Paid" tells the agent that nothing is owed, and that
  is false.

**Proposed change.**

- Arrivals, In house and Departures show **two facts** instead of one chip:
  - **Secured:** Card authorized · Deposit 30 % received · Prepaid by channel · Agency voucher · Not secured. This
    follows the guarantee kinds in RES-R06.
  - **Balance:** money, right-aligned. It carries an *Estimate* marker before check-out and "includes 1 pending
    payment" when it does (ux §3: markers propagate to totals).
- The payment status vocabulary (ux §4) is used only for a **payment** (a transaction).
  - **Paid** appears only on a captured transaction or a settled bill.
  - A stay header reads "Deposit received USD 82.50 · Balance USD 191.79 (estimate)".
- The readiness check is named **Payment secured**.
- Add a UI test: a fixture with a deposit and a positive balance must never render "Paid".

**Expected outcome (targets).**

- No screen shows "Paid" next to a positive balance.
- In round 2, no new user misreads a stay with a deposit as fully paid.

**Power check.** More information is shown, not less. Guarantee kinds and payment states stay distinct, as CLAUDE.md
§5 requires.

---

### FD-04 · Every blocker carries the button that clears it

**Category** (a) · **Owner** reservations (issue `actions[]`), with operations, inventory, payments and guests ·
**Priority** blocker
**Evidence** P1 › Payment ("There is no **Check status** button"); P2 › Failed inspection and Unassigned ("2 inspected
and free today", yet no Assign button); T3; B1 (readiness is the best model the tester has seen) ·
`[screens/p2-22-unassigned.jpg]` `[screens/p2-05-emma.jpg]` `[screens/p1-16-ahmed.jpg]`

**Problem.** The readiness model is the product's strongest idea (B1), but today it diagnoses and offers no remedy.
Every fix is disabled with "wave 1" text.

**Proposed change.**

- Readiness checks and record issues use the common exception shape from DCL-R01:
  `{code, severity, blocking, ref, owner, message, actions[]}`.
  - The UI renders `actions[0]` as a button next to the message. Other actions go in "…".
- Mapping once wired:

| Blocker | Button | Calls | Result shown |
|---|---|---|---|
| No unit assigned | **Assign Villa 214** (the best suggestion, named), then "Other villas…" | inventory `assignable-units` → reservations `POST /stays/:id/assignment` | "Assigned Villa 214 (inspected)"; readiness re-evaluates |
| Unit dirty, being cleaned, or failed inspection | **Find a ready villa** (FD-05) · **Rush clean** | operations `POST /operations/stays/:id/guest-waiting` (priority) | Ready estimate updates |
| Payment pending verification | **Check now** | payments `POST /payments/transactions/:id/check` | Inline: "Still pending (checked 07:41)", Paid, or Failed with the next step |
| Nothing secured | **Collect…** | Collect panel (PAY-01) | Result per PAY-01 |
| Passport details missing | **Add details** | guests documents / check-in `registration` step | Check turns ✓ |
| Open requests | **Open requests (2)** | operations service requests | — |

- **On the arrivals board** the Readiness cell holds the blocker text (two lines, per SR P1-4) and its button.
  - The `e` key runs the row's primary fix (ux §7: "`e` primary action of the row").
- **Rule:** a warning such as "do not charge again" never appears without the button that resolves it (PAY-02).

**Expected outcome (targets).**

- A blocker can be fixed in ≤ 1 click from the board and ≤ 2 from the record. The R1 baseline is impossible.
- An assignable blocker is cleared in ≤ 15 s (median).

**Power check.** Every fix is an existing command that keeps its permissions. "Other villas…" keeps full manual
choice beyond the suggestion.

---

### FD-05 · Failed inspection before a VIP arrival: a ready villa in three clicks

**Category** (a) · **Owner** reservations (`move` change), with inventory (assignable units) and operations (condition,
re-clean) · **Priority** blocker
**Evidence** P2 › Failed inspection: Emma Johansson, Villa 208 ready ≈ 13:55 against an ETA of 08:45; "Move unit is
disabled, there is no Assign, no 'Rush clean' and no 'Notify'". Vision moment "A villa fails inspection as the guest
lands". T3 · `[screens/p2-05-emma.jpg]` `[screens/p2-07-villa208.jpg]`

**Proposed change.**

- **Find a ready villa** (from the blocker, or `m` in the record) opens the **Room choice panel** inside the drawer.
- The panel groups candidates:
  1. Same type · inspected · free for every night.
  2. Same type · clean, needs inspection (with the ready estimate).
  3. Upgrades, with a *complimentary / chargeable* switch.
- Each row shows:
  - the villa and its section (Jetty A, Beach North);
  - the condition chip and the ready estimate;
  - differences from the booked villa ("no plunge pool");
  - inventory's fit reason (`reason` and `fitScore` from `findAssignableUnits`).
- Picking a villa opens the **Move preview** (reservations `move`). The reason is prefilled as *maintenance* for a
  failed inspection, and *chargeable* is off. The preview shows:
  - the price unchanged;
  - keys re-encoded;
  - "Housekeeping: Villa 208 re-clean continues; Villa 214 gets VIP arrival priority";
  - "Butler / guest relations: tell the guest" (a manual task until messaging exists).
- **Confirm** (`Ctrl+Enter`) shows the toast "Emma Johansson moved to Villa 214 (inspected). Villa 208 re-clean stays
  with its attendant.", with a link to the stay.
- When the failed inspection comes from housekeeping (operations `inspection.failed` carries the affected arrival and
  ETA), the front desk gets the same issue with the same **Find a ready villa** action. They are told before the guest
  lands.

**Expected outcome (targets).** A room move with preview takes ≤ 30 s and 3 interactions (Find → pick → Confirm), with
no unintended price changes (ux §19). The R1 baseline is impossible.

**Power check.**

- Manual choice is kept through the "All villas" tab.
- Upgrade and chargeable options are visible, and the preview is mandatory.
- This matches PAR-RES-064 and PAR-RES-065 (P0) and adds a ranked, explained shortlist that OPERA's room search does
  not give.

---

### FD-06 · Departures and In-house lists, opened by their tiles

**Category** (a) · **Owner** reservations (`/front-desk/departures`, `/front-desk/in-house`), with finance (balances) ·
**Priority** blocker
**Evidence** P2 › Checkout ("There is no Departures list or In-house list… 'In house: 106 — Open the records behind'
lands on the **Housekeeping board**"); T2, T16 · `[screens/p2-15-today.jpg]` `[screens/p2-16-inhouse.jpg]`

**Proposed change.**

- **Sections and keys.** The Front desk section list is Arrivals · In house · Departures, with Waiting guests added
  when PAR-RES-072 is built.
  - The keys are `g a`, `g i` and `g d`, following ux §7. Today moves to `g o`, which also resolves SR P2-16.
- **Layout.** All three use the same DataTable template as Arrivals (one layout per page type), with the date control
  from FD-10.
- **Departures columns:**
  - guest and code;
  - villa;
  - departure time, with a late check-out chip;
  - balance per payer (FD-07);
  - check-out state: Not started / In progress 2 of 4 / Checked out 10:42;
  - transfer out (time and mode).
  - Default sort is by transfer time, because the seaplane leaves on time. The row's primary action (`e`) is
    **Check out**.
- **In-house columns:**
  - guest;
  - villa;
  - night *n of N*;
  - balance (estimate);
  - alerts: overstay, DND for more than 24 h, open requests, credit limit reached;
  - departure date.
- **Today tiles.** Departures opens Departures, and In house opens In house (NAV-07).

**Expected outcome (targets).** Departures is reachable in 1 click or `g d`. No tile opens an unrelated screen. The R1
baseline was 1 tile not clickable and 1 tile opening the wrong place.

**Power check.** This matches PAR-RES-096 (P0) and RES-R35. Nothing is removed.

---

### FD-07 · Check-out with a split bill as one checklist

**Category** (a) · **Owner** reservations (check-out workflow `charges → settle → access → confirm`), with finance
(bills, billing rules, transfer to receivables, invoices) and payments · **Priority** blocker
**Evidence** P2 › Checkout + split bill: an in-house stay "has no Check out, no folio, no balance and no routing"; T2.
Persona ask: "Check out → folio with routing rules … a split preview, and the invoice per payer" ·
`[screens/p2-18-inhouse-stay.jpg]`

**Proposed change.**

- **Check out** opens the **Check-out sheet**. It is the primary action for in-house stays from the departure day
  (FD-08), and its key is `o`.
  1. **Charges.** Pending and late charges, such as open restaurant checks or minibar, with **Post charge** inline.
     It warns when an outlet check is still open.
  2. **Settle.** The bills sit side by side, labelled by the **payer's name**, for example "Maldivian Holidays Ltd —
     accommodation" and "Ms Johansson — incidentals" (finance §9). Each bill has its balance and its own action:
     - **Pay now**, using the Collect panel;
     - **Send to company account**, a finance transfer to receivables with the credit limit checked;
     - **Leave open — reason**, for expected late charges (RES-R28).
     - One explanatory line says why: "Room and taxes go to Maldivian Holidays, per the booking's billing
       instructions."
  3. **Invoice.** One fiscal document per bill (finance documents), sent by email or printed.
  4. **Keys.** Deactivated.
  5. **Confirm.** For example: "Check out Emma Johansson from Villa 214. Company account billed USD 4,320.00; guest
     paid USD 186.50 by card. Villa 214 becomes Dirty (departure clean)."
- **Moving a charge** to the other payer: select the charges, choose **Move to…**, review the preview (finance
  transfers), then confirm. Drag and drop is offered, but never as the only way (WCAG 2.5.7).

**Expected outcome (targets).** A check-out with split bills takes ≤ 90 s with no wrong payer (ux §19), and ≤ 6
interactions for a prepared split check-out. The R1 baseline is impossible.

**Power check.**

- OPERA-style routing and windows are fully kept through billing rules (finance §3.4).
- Express check-out (PAR-RES-098) and online check-out (PAR-RES-099) are still (b) follow-ups and are not blocked by
  this design.

---

### FD-08 · The primary button is always the next valid action

**Category** (c) · **Owner** backoffice/ui (`RecordView`), and every module's ordering of `allowedActions` ·
**Priority** major
**Evidence** P2 › Checkout ("Its first button is a disabled **Check in**"); P1 › Ahmed (disabled Check in and Move
unit in the primary row) · `[screens/p2-18-inhouse-stay.jpg]` `[screens/p1-16-ahmed.jpg]`

**Proposed change.**

- **Rule.** The primary slot holds the first **enabled** action for the record's state.
  - Disabled actions never fill the primary slot. They move to "…" and keep their reason. "Why can't I…?" lists them
    (identity §9).
- **Exception.** When the natural action is blocked by an issue, it shows disabled **together with its fix**, for
  example "Check in — blocked: Villa 208 failed inspection [Find a ready villa]" (FD-04).
- **Server order by state.** The server returns `allowedActions` in order of likelihood, and the UI keeps that order:
  - *Expected:* Check in, Assign/Move, Change dates.
  - *In house:* Check out (on the departure day), Post charge, Change dates, Move.
  - *Departed:* Open bill, Reopen bill.
- Verbs use the property's word for a unit (NAV-13): "Move villa", not "Move unit".

**Expected outcome (targets).** No record header has a disabled primary button without a fix. The median number of
clicks to the next action is 1.

**Power check.** No action is removed, and every disabled action still explains itself (B7).

---

### FD-09 · Walk-in in one sheet

**Category** (a) · **Owner** reservations (walk-ins, RES-R22), with rates (quote), guests (resolve) and payments ·
**Priority** blocker
**Evidence** P1 › Walk-in: not done after ~8 taps, 5 screens and ~3 min. Search for "walk/new/book" found nothing. The
Timeline free cell said "not available yet (reservations module in progress)", and a double tap stacked two toasts.
T1 · `[screens/p1-13-search-walk.jpg]` `[screens/p1-14-timeline-full.jpg]` `[screens/p1-15b-free-cell-enter.jpg]`

**Proposed change.**

- **Entry points**, which all open the same sheet:
  - **+ Walk-in** in the Arrivals header and on the owner's Today;
  - `N` on Arrivals (NAV-02);
  - the palette: "walk-in", "walk", "new guest tonight" (NAV-01);
  - on the Timeline, Enter or a tap on tonight's free cell, which prefills that villa.
- **One sheet, three blocks:**
  1. **Stay.** A "Tonight · Sat 7 Nov" chip. It is labelled "Business date" and explains itself around midnight
     (EC-RES-012).
     - Controls: a nights stepper (default 1), and adults and children with ages.
     - The list shows each free type with its count and its all-in price per night and in total (quote).
     - The best ready villa is preselected: "Room 5 · inspected".
  2. **Guest.** Name and phone (the country code defaults from the property). Email is optional.
     - As you type, existing profiles are offered (GST-04).
     - Passport details are asked for only if policy requires them now; otherwise they wait for the check-in step.
  3. **Payment.** The Collect panel: Cash · Card · Bank transfer (recorded, unverified) · Later (if policy allows).
     The amount defaults to the full stay.
- **Preview.** A compact preview (nights, price, taxes including Green Tax, payment) sits above the buttons. It is not
  a separate screen.
- **Buttons.** The primary is **Book and check in**: it commits, then continues into the check-in sheet with the
  satisfied steps collapsed. The secondary is **Book only**.

**Expected outcome (targets).**

- A walk-in takes ≤ 3 min and ≤ 3 screens (ux §19; PAR-RES-075, P0).
- A guesthouse owner on a phone needs ≤ 12 taps plus typing the name and phone.
- The R1 baseline is impossible.

**Power check.** "More details" exposes every booking field: source, market segment, rate plan override (with
permission) and notes. Afterwards the walk-in is an ordinary booking with full power.

---

### FD-10 · Tomorrow is one tap away

**Category** (a) (`frontDeskQuery.date` exists) · **Owner** reservations · **Priority** major
**Evidence** P1 › See tomorrow ("Arrivals has no date selector, previous/next or 'Tomorrow' tab"); T16

**Proposed change.**

- **Date control.** The headers of Arrivals, In house and Departures get:
  - a segmented control **Today · Tomorrow**;
  - ‹ › day steppers and a date picker;
  - the keys `[` and `]` for the previous and next day.
- **The date lives in the URL**, so a deep link opens the same day (SR P2-10).
- **Viewing another day is unmistakable.** An amber outline and a chip read "Viewing Sun 8 Nov — not today's business
  date".
  - On future days only preparation actions are enabled (assign, add details, pre-arrival notes). Check in is
    disabled with a reason.
- **On a phone** the segmented control sits at the top. There is no swipe gesture, because it would fight vertical
  scrolling.

**Expected outcome (targets).** Tomorrow's arrivals are ≤ 1 tap away. The R1 baseline was not possible on Arrivals.

**Power check.** This only adds.

---

### FD-11 · Update the ETA and see who is affected

**Category** (a) (stay `arrivalDetails` via `PATCH /v1/stays/:id`; operations re-scores priority on stay events) ·
**Owner** reservations · **Priority** major
**Evidence** P2 › Delayed seaplane ("There is no Update ETA… The labels disagree: 'Domestic flight · delayed 180 min'
… '**Seaplane** delayed about 3 h'"); T18 · `[screens/p2-14-wei-delay.jpg]`

**Proposed change.**

- **Update ETA** sits on any stay that has arrival details. It is an inline edit of the estimated time with a reason:
  flight delay, seaplane delay, or the guest called.
- After saving:
  - Arrivals re-sorts;
  - housekeeping priority re-scores;
  - the row reads "ETA 13:35 → 16:35 (estimated) · updated by Shifa 07:52".
- The transport mode is shown from **one** field, `arrivalDetails.transportMode`. The simulated contradiction is SR
  P2-1.
- An **"Affected today"** list (dinner, dive) appears once resort data exists (FD-12).

**Expected outcome (targets).** An ETA is updated in ≤ 15 s with 2 interactions.

**Power check.** The arrival-details model is kept, and editing is added.

---

### FD-12 · Disruption actions for Maldives transfers

**Category** (b) · **Owner** reservations (EC-RES-002 and EC-RES-003, both P0 and missing), with resort (itinerary
cascade, wave 2) and comms · **Priority** major
**Evidence** P2 › Delayed seaplane (no "overnight in Malé" option, which matters because seaplanes stop at sunset);
T18; vision moment "Seaplane delayed 3 hours" · `[screens/p2-14-wei-delay.jpg]`

**Proposed change (the design to build against).**

- **Bulk "Transfer delayed".**
  - Select the arrivals that share a transfer: `x`, Shift+click, or "Select same flight" (SR P1-5 selection).
  - **Delay transfer…** applies one previewed ETA update to all of them.
  - It includes the option "Don't mark as no-show at Day Close" (EC-RES-003).
- **Can't reach the resort tonight.** A previewed arrival shift of one night under the policy
  `reservations.lateArrival.firstNight`, which decides whether the first night is charged or waived.
  - The villa is held or released.
  - An optional linked Malé booking reference can be added (EC-RES-002).
- **Affected today panel.** Itinerary items (Sea Grill 19:00, sunset dive 17:30), each with its owner department and
  **Reschedule / Notify**, once the resort module exists.

**Expected outcome (targets).** Twelve arrivals on one delayed seaplane are updated in ≤ 60 s, instead of 12 separate
edits.

**Power check.** This is new capability and nothing is removed. It goes beyond OPERA, which has no transfer cascade.

---

### FD-13 · Keyboard: from an arrival row to Check in in three keys

**Category** (c) · **Owner** backoffice/ui (RecordDrawer, DataTable, shortcut map) · **Priority** major
**Evidence** P2 › Keyboard-only pass ("21 Tabs to reach the first row … **17 Tabs to reach 'Check in'** … no action
hotkeys"); T15; B5 (keep the `g` chords and the single-tab-stop Timeline) · `[screens/p2-21-drawer-focus.jpg]`
`[screens/p2-19-shortcuts.jpg]`
**Overlaps** SR P1-1 (focus moves into the drawer), SR P1-5 (non-modal split view, `j/k`, palette record actions),
SR P2-4 (the grid is a single tab stop), SR P2-16 (shortcut map)

**Proposed change.** These go beyond the SR fixes.

- **Record verbs get mnemonic keys**, active while a record has focus and disabled inside inputs:
  - `c` Check in, `o` Check out, `m` Move, `p` Take payment, `a` Assign;
  - `e` Edit (in a record) and the row's primary action (in a list), per ux §7.
- **Each button shows its key** as a small Kbd hint, on desktop only.
- **Reaching the list is direct.** Opening Arrivals with `g a` puts focus on the first row. A skip link, "Skip to
  arrivals list", is the first tab stop.
- **The `?` sheet** gets a "Records" group generated from the same map, so it never drifts.

**Expected outcome (targets).**

- From a row to the check-in sheet takes `Enter`, `c`, and `Ctrl+Enter` to confirm: 3 keys. The R1 baseline was 17
  Tabs plus Enter.
- Keyboard-only completion of desk tasks reaches 100% (scorecard).

**Power check.** These keys are accelerators. Every action stays visible and clickable (ux §7).

---

### FD-14 · Arrivals on a phone: the full blocker, one fix, filters from the counts

**Category** (c) · **Owner** backoffice/ui (front-desk screens) · **Priority** major
**Evidence** P1 › Arrivals ("The blocker, the most important line, is cut with an ellipsis"; "The count tiles … are
not filters"); T17 · `[screens/p1-05-arrivals-full.jpg]`
**Overlaps** SR P1-4 (desktop layout), SR P3-8 (tiles as filters)

**Proposed change.**

- **Phone card anatomy:**
  1. Guest, VIP or party tags, and ETA.
  2. Villa, condition chip, and Secured / Balance (FD-03).
  3. and 4. The blocker in full: it wraps and is never cut with an ellipsis. Its fix button sits below it (≥ 44 px,
     FD-04).
- **Tapping a card** opens the record full screen.
- **The count tiles become one row of filter chips**: "All 16 · Blocked 7 · Ready 7 · Transfer delayed 1". The row
  stays sticky while scrolling and one chip is active at a time.

**Expected outcome (targets).** No truncated blockers between 360 and 430 px. Filtering to blocked arrivals takes 1 tap.
The R1 baseline was not possible, because the tiles were not filters.

**Power check.** The data is the same as on desktop, and the desktop filters remain.

---

### FD-15 · Money on the arrivals board only for roles that handle money

**Category** (c) · **Owner** reservations (field-level read of `balance` and payment detail) · **Priority** major
(privacy hygiene; this strengthens permissions)
**Evidence** X › Possible permission gap: the housekeeping supervisor typed `/front-desk/arrivals` and saw "guest names
and payment status". The `housekeeping_supervisor` role holds `reservations.booking.read`
(`modules/identity/src/domain/role-templates.ts`), so the real `GET /v1/front-desk/arrivals` will answer too, and
`frontDeskRow` includes `balance`.

**Problem.**

- Housekeeping legitimately needs arrival names, VIP flags and ETAs to set priorities.
- It does not need balances or payment state.
- Hiding the navigation is not access control.

**Proposed change.**

- Reservations returns `balance` and payment readiness detail only to callers who hold a money-read permission, such as
  `finance.folio.read` or a payments read.
  - Otherwise the fields are `null` with `redacted: true`.
  - The UI shows "—" with the explanation "Not shown for your role".
- Add a permission test to `test/isolation-permissions.test.ts`.
- The UI never assumes that hidden navigation means no access. The server's answer decides.

**Expected outcome (targets).** No money fields are visible to housekeeping roles. This is proven by a test.

**Power check.** Nothing is lost for the roles that handle money. Least privilege is strengthened (CLAUDE.md §6).
