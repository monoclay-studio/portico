# Portico: black-box usability findings, round 2a

**Evaluator:** "mystery user", an experienced hotel operations professional (OPERA, Mews, Cloudbeds and small-property systems). I used only the running product in a browser and its own help. I did not look at any code, specs or documents.
**Date:** 2026-11-07 (business date shown in the product: 2026-11-07)
**Product:** http://127.0.0.1:5380 (Playwright Chromium, screenshots at deviceScaleFactor 1)
**Output folder:** this folder. All screenshots are named `<persona>-<nn>-<slug>.png`.
**Round 1 baseline:** I had no round-1 report, so I judged only what I saw.

**Finding IDs.** `R2a-P1-…` front desk, `R2a-P4-…` housekeeping supervisor, `R2a-P7-…` group director, `R2a-PN-…` the P-NEW brand-new hire (the persona has no number, so I use "PN"), and `R2a-X-…` for findings that span personas.

**SIMULATED screens.** Arrivals, In house, Departures, the housekeeping board, the timeline, stay and unit records, Extend stay, My work and the Today figures all carry a **Simulated** badge. Settings, users, legal entities, properties, sign-in and search are labelled **Live**. Each finding below is tagged `[SIM]` or `[LIVE]`.

---

## Executive summary

The arrivals list is the best I have used for spotting blockers. Every row says in one line what is wrong, roughly when it will be fixed and who acts next. The Extend stay preview, with its full tax breakdown, would win a demo. The trouble starts once you act on what the screens say:

1. **The screens contradict each other.** Front desk shows three villas as *Ready / Inspected* while the departing guests are still in them (one has a late check-out). The housekeeping board calls the same villas *Vacant* and does not know about four baby-cot requests that the front desk says housekeeping owns.
2. **The main actions dead-end.** *Check in* looks enabled, but clicking it only says "not available in this demo yet". The blockers owned by "Front desk" (assign a unit, add passport details) cannot be fixed anywhere in the product. A departing guest's record has no check-out and no folio.
3. **Roles are not tailored.** The housekeeping supervisor sees guest balances, pending payments and the full Extend stay price preview, and gets a Today page with front-desk numbers instead of housekeeping numbers.
4. **Help is empty.** "Help for this screen" is a placeholder everywhere, and every learning-centre item says "CONTENT COMING". The day-one hire cannot find out who arrives next.
5. **One invalid save crashes the screen.** Saving a property with its required Name empty shows the generic "This screen ran into a problem". By contrast, the staff-invite form handles the same mistake very well.

---

## P1: Front desk agent, Azure Atoll Resort & Spa (desktop 1440×900 and tablet 1024×768)

### Task 1. Sign in, including the code step
- **Completed:** yes. **Effort:** 2 screens. Typed email + Tab + password + Enter, then the 6-digit code + Enter (about 72 keystrokes, 0 clicks). About 20 s.
- After sign-in I landed directly on **Arrivals**, not on Today. For a desk agent that is the right place.
- Errors were tested deliberately. A wrong password gave a clear amber box: "Email or password not recognised · Check both and try again…" with a copyable reference (screens/p1-02-wrong-password.jpg). A wrong code gave an inline red message: "That code is not right. Codes change every 30 seconds — enter the one showing now. 4 more tries…" (screens/p1-03-wrong-code.jpg). Both are excellent.
- The code screen is clear and names the organisation you are signing in to (screens/p1-01-code-step.jpg).
- **R2a-P1-F18 (minor) [LIVE].** There is no "Forgot password?" link on the sign-in card. The only advice ("ask your administrator to reset your password") appears after a failed attempt (screens/p1-02-wrong-password.jpg). Every PMS I know has self-service reset, or at least the link.

### Task 2. Today's arrivals that are not ready, what blocks each, and who is dealing with it
- **Completed:** yes. **Effort:** 1 click on the "Blocked 9" chip, 1 screen, about 10 s (screens/p1-06-blocked-filter.jpg).
- **Strength.** Each blocked row states the blocker in plain words, plus an ETA and a "Next:" line. Example: "Villa 104 failed inspection (shower drain) — re-clean assigned to Hawwa, ready about 14:55 (estimate). Next: Hawwa · Housekeeping". This is better than OPERA, where I would cross-check room status, traces and the arrivals report separately.
- **R2a-P1-F01 (major; blocker for trust) [SIM]. "Ready for check-in" on villas that are still occupied.**
  - Mei Singh (ETA 13:35) is *Ready for check-in*, and Villa 135 is *Inspected* (screens/p1-13-mei-singh-villa135.jpg).
  - But Daniel Johansson is **in house in Villa 135, departing today with a late check-out**. His record even shows the villa as "Inspected" (screens/p1-17-departure-record.jpg).
  - Search for "Villa 135" returns both stays side by side, one Expected and one In house (screens/p1-25-search-villa135.jpg).
  - The same happens with Villa 145 (VIP Li Schneider arriving; Ayesha Kowalska departing) and Villa 160 (Liam Rossi arriving; Olga Nair departing).
  - **Expected:** a villa with an in-house guest is *Occupied / Due out*, never *Inspected*. The readiness check "Unit ready · OK" must also consider the outgoing stay. An agent who trusts this screen walks a VIP into an occupied villa.
- **R2a-P1-F11 (minor) [SIM]. Ownership is mostly a department, and the record contradicts itself.**
  - Only re-cleans name a person (Hawwa). The other blockers say "Next: Housekeeping" or "Next: Front desk".
  - Inside the record, the issue says "Owner: Housekeeping" and the line directly below says "Owner: No owner assigned" (screens/p1-10-record-drawer.jpg).
  - My work has an "Assigned to" column, but it is blank for every exception (screens/p1-27-tile-payments-mywork.jpg).
- **R2a-P1-F10 (minor) [SIM]. Cryptic room-type codes.** SWVP, BVP, WV and BV appear under every villa number with no legend or tooltip (screens/p1-04-landing-arrivals.jpg). A new agent will not know SWVP means "Sunset Water Villa with Pool".
- **R2a-P1-F09 (minor) [SIM]. "estimate" under every balance.**
  - It appears even on USD 0.00 and on guests already checked in (screens/p1-04-landing-arrivals.jpg).
  - Nothing explains what the estimate is made of. For example, Ahmed Kowalska: 6 nights × USD 650 = 3,900, yet the balance is USD 3,993.30, and the record gives no breakdown.

### Task 3. Open the next arrival and move through the following arrivals with the keyboard only; close and return to the list
- **Completed:** partly. **Effort:** 25 × Tab to reach the first row, j j Enter, j j k, Esc: **31 keystrokes**. About 1 min, including a wrong turn.
- **R2a-P1-F06 (major) [SIM]. The list is not keyboard-ready when the page opens.**
  - The help line promises "j / k or arrow keys move between rows. Enter opens…", and the shortcut sheet confirms it (screens/p1-08-shortcuts.jpg). But on landing, and after `g a` or `g d`, focus sits on the page body, so j, k and arrow keys do nothing.
  - Reaching the first row takes **25 Tabs**, or 16 after using "Skip to main content".
  - My first wrong turn: after clicking the "All 16" chip I pressed Enter to open a row, and it simply re-pressed the chip.
  - Nothing on screen says "press Tab to enter the list". **Expected:** focus lands on the first actionable row, or there is a "focus list" key.
- **Strength.** Once a row has focus, Enter opens the record in a side drawer, and j/k inside the drawer step through the next arrivals. The record content follows (screens/p1-11-record-next-j.jpg). This is the Mews-style "next guest" flow done well.
- **R2a-P1-F07 (minor) [SIM]. Focus does not follow j/k.**
  - While the drawer moves to Priya Kapoor, the list highlight stays on Ahmed Kowalska (screens/p1-11-record-next-j.jpg).
  - Esc closes the drawer but returns focus to **Ahmed**, the row I first opened, not to Priya, whom I was reading (screens/p1-12-after-esc.jpg). I lost my place.
- **R2a-P1-F16 (minor) [SIM]. No alternative offered when a room will be very late.**
  - Ahmed Kowalska arrives at 08:00 and Villa 104 will be ready "about 14:55". That is a wait of almost seven hours.
  - Beach Villas are shown as free, but the product neither suggests one nor flags the gap. "Move unit" says "Not available in this demo yet" (screens/p1-10-record-drawer.jpg).

### Task 4. Who is leaving today and who is in house; what each still owes
- **Completed:** partly. **Effort:** 2 clicks (In house tab, Departures tab) plus 1 click per record. About 1 min.
- The lists are clear: In house shows 95 stays with "Balance due 75", and Departures shows 5 with 5 balances (screens/p1-24-tablet-inhouse.jpg, screens/p1-17-departure-record.jpg).
- **R2a-P1-F05 (major) [SIM]. No check-out and no folio on a departing guest.**
  - Daniel Johansson's record has no **Check out**, no folio or charge lines, no payment or settle action, and no late-check-out time.
  - The first button is "Check in", disabled with "Only expected stays can be checked in (this stay is In house)" (screens/p1-17-departure-record.jpg).
  - The Departures list has no status (due out or checked out) and no departure time.
  - I can see *how much* is owed (USD 3,442.20, "estimate"), but not *for what*. OPERA, Mews and Cloudbeds all put the folio one click from the departure.
- **R2a-P1-F04 (major) [SIM]. "Payment pending verification" gives no way to act.**
  - Marco Lin is blocked by "Payment outcome is pending verification — do not take payment again; reconciliation will resolve it" (screens/p1-23-tablet-marco-lin.jpg). The "do not take payment again" instruction is excellent.
  - Missing: the amount, the time of the attempt, the method or terminal, who is reconciling, and by when. The guest arrives at 13:50.
  - Today says "USD 1,170.00 awaiting confirmation" (screens/p1-05-overview.jpg), but the record shows only a USD 5,163.30 balance. I cannot match the two figures.
  - The list says "Check-in in progress", while the record says "Expected".
  - "Owner: Front desk" contradicts "reconciliation will resolve it". What should I actually do?

### Task 5. Open each number on the Today page and check that the list matches
- **Completed:** partly. **Effort:** 6 tiles, about 12 clicks. About 2 min.
- Matches: Arrivals 16 opens 16 rows (5 ready, 2 checked in, 9 blocked; all three match). Departures 5 opens 5 rows, all with a balance due. In house 95 opens "95 of 95 rows". Good.
- **R2a-X-F01 (major) [SIM]. Three tiles open lists you cannot check against the number.**
  - "Open exceptions 9 / 3 urgent" and "Payments pending verification 1" both open the **same unfiltered My work list of 13 rows**, mixing exceptions, tasks, a handover and a rate approval (screens/p1-27-tile-payments-mywork.jpg). I had to count by hand. There are 9 exceptions, 3 urgent, so the numbers are right, but I could not verify them at a glance.
  - "Occupancy tonight 87% (103 of 119 units)" opens the general timeline of all 120 units (screens/p1-28-tile-occupancy-timeline.jpg). Nothing on it can be checked against 103.
  - The page itself promises "Every number opens the records behind it." The housekeeping supervisor sees the same behaviour (screens/p4-08-hk-payments-tile.jpg).
- **R2a-P1-F19 (polish) [LIVE].** The sidebar item is "Overview", but the page and tab are called "Today" (screens/p1-05-overview.jpg).

### Task 6. Try something invalid and judge the message
- **Completed:** partly. A front-desk agent has almost nothing editable. Guest "Edit" says "Not available in this demo yet" (screens/p1-29-guest-record-empty.jpg), and "Move unit" and "Cancel booking" are unavailable (screens/p1-15-more-actions.jpg).
- What I could test: Extend stay of Mei Singh by 2 nights, which runs into the next booking.
  - The message is very good: "This change cannot be made as it stands. Villa 135 is booked by another guest from 2026-11-15. Shorten the extension to end before then, or move the guest to another unit first." (screens/p1-19-extend-confirm-disabled.jpg)
- **R2a-P1-F12 (minor) [SIM]. The refusal is hidden below the preview.**
  - The dialog first shows a full price, tax and availability preview (screens/p1-18-extend-stay.jpg). Why "Confirm change" is greyed out only becomes clear after scrolling to the very bottom.
  - The suggested recovery ("move the guest to another unit") is not available in this demo.
  - **Expected:** a conflict banner at the top.
- **R2a-P1-F02 (major) [SIM]. "Check in" looks available but is not.**
  - On a ready guest (Priya Kapoor), "Check in" is a solid primary button. Clicking it gives only a toast: "Check in is not available in this demo yet. Nothing was changed." (screens/p1-21-checkin-dialog.jpg)
  - "Move unit", next to it, warns *before* you click. The most important desk action should not look live when it is not.
  - Elena Lindqvist's Check in is correctly disabled, with a tooltip giving the reason (screens/p1-20-checkin-blocked-elena.jpg).
- **R2a-P1-F03 (major) [SIM]. Blockers owned by "Front desk" cannot be resolved anywhere.**
  - Jonas Petrova: "No unit assigned yet — 2 Two-Bedroom Beach Residence are ready and free today. Next: Front desk." The two residences are not named, there is no "Assign unit" action, "Move unit" is unavailable, and the "…" menu offers only "Show on timeline" and "Cancel booking (not available)" (screens/p1-14-jonas-no-unit.jpg, screens/p1-15-more-actions.jpg).
  - Elena Lindqvist: "Passport details missing for 2 adults". There is nowhere to enter them (screens/p1-20-checkin-blocked-elena.jpg), and the guest record is an empty shell (screens/p1-29-guest-record-empty.jpg).
- **R2a-P1-F14 (minor) [SIM]. The guest profile is empty.**
  - It shows no contact details, nationality, ID, preferences or stay history, and Edit is "not available".
  - The breadcrumb reads "Mei Singh › Mei Singh", because the stay and the guest have the same name (screens/p1-29-guest-record-empty.jpg).
- **R2a-P1-F13 (minor) [LIVE search].** Searching "Villa 135" lists the unit *types* "Beach Villa" and "Water Villa" first and never the villa record itself (screens/p1-25-search-villa135.jpg).

### Tablet 1024×768 (P1)
- No horizontal scroll. The list honestly says "+2 columns hidden to fit" (screens/p1-22-tablet-arrivals.jpg).
- **R2a-P1-F15 (minor) [SIM].** At tablet width, Balance and Condition·Secured are the columns that get hidden. These are exactly what an arrivals agent checks at the desk.
- The drawer takes half the screen but stays readable (screens/p1-23-tablet-marco-lin.jpg).

---

## P4: Housekeeping supervisor, resort (tablet 1024×768)

### Task 1. Sign in
- **Completed:** yes. Same two screens as P1, about 20 s. I landed directly on the **Housekeeping** board (screens/p4-01-landing.jpg). Good.

### Task 2. Rooms needing attention today, and what to do first
- **Completed:** partly. **Effort:** 0 clicks for the board, plus 1–2 per room. About 2 min.
- **Strength.** The board defaults to "Arrivals first": Villa 104 (Urgent, failed inspection, arrival 08:00), then 208, then departure cleans. Counts by condition sit across the top: Dirty 23, Cleaning 23, Clean 47, Inspected 26, Failed 1.
- **R2a-P4-F01 (major; blocker for trust) [SIM]. The board contradicts the front desk.**
  - Villa 135 is "Vacant · Inspected" (screens/p4-03-villa135-housekeeping.jpg). The front desk has Daniel Johansson in house there, departing with a late check-out.
  - Villas 240 and 245 are "Vacant · Departure today". The front desk still lists Li Laurent and Olga Al Hashimi in house in them (screens/p4-01-landing.jpg vs screens/p4-11-hk-sees-departure-balances.jpg).
  - The departure cleans for 135, 145 and 160 do not appear on the board at all, even though new guests are assigned to those villas today.
- **R2a-P4-F02 (major) [SIM]. Baby-cot requests never reach housekeeping.**
  - The front desk lists four arrivals blocked by "Baby cot — not yet prepared by housekeeping. Next: Housekeeping" (screens/p1-06-blocked-filter.jpg).
  - On the housekeeping board, Villa 108 (Emma Dubois) shows priority "—", attendant "Unassigned" and no task (screens/p4-04-villa108-no-cot.jpg).
  - The board header says "2 same-day arrivals not ready". The front desk says 9 are blocked, 6 of them owned by Housekeeping.
- **R2a-P4-F03 (major) [SIM]. The supervisor cannot act on any room.**
  - Unit records offer "Mark inspected", disabled until the room is clean, and "Report issue", "not available in this demo yet" (screens/p4-05-villa104-record.jpg, screens/p4-13-villa103-actions.jpg).
  - There is no assign or reassign attendant, no change of priority, no mark clean, no rush flag and no bulk selection on the board.
  - Yet the role description reads "Plans and inspects cleaning, assigns attendants" (screens/p7-15-roles-tab.jpg).
- **R2a-P4-F05 (major) [SIM]. The Today page is not about housekeeping.**
  - It is the front-desk Today: occupancy, arrivals, departures "with a balance due", payments pending USD 1,170 (screens/p4-06-hk-overview.jpg).
  - Missing: dirty/clean/inspected progress, attendant workload, DND rooms, cots and amenities, rooms needed by ETA.
- **R2a-P4-F06 (minor) [SIM].** On a tablet, the **Attendant**, **Ready (estimate)** and **Section** columns are hidden (screens/p4-02-hidden-columns.jpg). These are exactly the columns a supervisor plans with.
- **R2a-P4-F08 (polish) [SIM].** A "Sleep" chip with a "?" icon in the Occupancy column is unexplained (screens/p4-04-villa108-no-cot.jpg). The "Do not disturb" label wraps the unit name onto two lines ("Villa / 106") on a tablet (screens/p4-01-landing.jpg).

### Task 3. Try to see the front desk's arrivals and guests' money details
- **Completed:** yes, which is the problem. **Effort:** 1 tap on a Today tile or a search.
- **Should a housekeeping supervisor see them?**
  - Arrivals with ETAs, units and requests: **yes**. They need them to plan.
  - Guest balances, payment status and rate or tax breakdowns: **no**.
- **R2a-P4-F04 (major) [SIM]. Money is fully visible to housekeeping, and nothing tells the user it is outside their role.**
  - The sidebar hides "Front desk", but Today tiles, search and direct URLs open everything.
  - Departures shows per-guest balances, for example USD 10,568.70 (screens/p4-11-hk-sees-departure-balances.jpg).
  - Marco Lin's stay record shows the payment verification status (screens/p4-10-hk-guest-stay-money.jpg).
  - **Extend stay** opens for the housekeeping supervisor with nightly prices, service charge, TGST, green tax and deposits (screens/p4-12-hk-extend-stay-prices.jpg). "Check in" and "Extend stay" also look actionable.
  - The Today page shows "Payments pending verification: USD 1,170.00" (screens/p4-06-hk-overview.jpg).
  - **Expected:** money columns hidden or masked for this role, and front-desk-only actions hidden, with a short "Front desk only" note.
- **R2a-P4-F07 (minor) [SIM].** When the supervisor reaches front-desk screens, the tab bar reads "Today / My work / Learning centre" with nothing selected (screens/p4-07-hk-arrivals-tile.jpg). It is unclear where you are.

---

## P7: Group director (desktop 1440×900)

### Task 1. Sign in and choose between organisations
- **Completed:** yes. **Effort:** 3 screens (password, organisation, code). About 30 s.
- The organisation chooser is clear: "Each is separate — data and money never mix between them." (screens/p7-01-after-password.jpg)
- **R2a-P7-F09 (polish) [LIVE].** It offers "Azure Atoll Collection (training)" next to "(demo)" without saying how training differs from demo, or when I would use it.

### Task 2. Switch property and read which property and business date you are in
- **Completed:** yes by mouse; by keyboard I ended up in the wrong property. **Effort:** 2 clicks. About 10 s.
- The header always shows the property name, code and "Business date 2026-11-07". After switching to Azure Lagoon Hotel, every figure changed accordingly (screens/p7-03-property-switcher.jpg, screens/p7-04-switched-lagoon.jpg).
- **R2a-P7-F02 (major) [LIVE]. The keyboard switch lands in the wrong property, silently.**
  - While in Lagoon, `g s` opens the switcher with focus on the **first** item (Atoll Resort), not on the current property (screens/p7-08-gs-switcher-focus.jpg).
  - Typing "Reef" neither filters the list nor jumps to that entry. Enter then switched me to **Atoll Resort** (screens/p7-09-wrong-property-after-enter.jpg).
  - There is no toast or confirmation. In a group with similar property names, staff will post charges in the wrong hotel.
- **R2a-P7-F03 (major) [SIM].** There is no group or portfolio view. A director must switch three times to compare occupancy, arrivals and exceptions.
  - The switcher does not show each property's business date or status (screens/p7-03-property-switcher.jpg).
  - It shows the raw time-zone ID "Indian/Maldives".
- **R2a-P7-F06 (major for trust) [LIVE vs SIM].** The property record says "Status: Setup · This property is in setup — it is not yet operating" (screens/p7-21-property-record.jpg). The same property's Today page shows 18 arrivals and 41 in house (screens/p7-04-switched-lagoon.jpg). Which is true?

### Task 3. Settings and users: does every visible button work, and do the words make sense to a non-technical manager?
- **Completed:** partly. About 5 min.
- **Button check:**

| Button | Result |
|---|---|
| Invite staff member | Works |
| Staff and Roles tabs | Work |
| Status filter and Columns | Work |
| New legal entity | Works |
| Property "Edit settings" | Works |
| "Work in this property" | Shown |
| Help (?) | Opens a placeholder |
| User "Assign role" | Disabled: "Not available yet" |
| Legal entity "Edit" | Disabled: "Not available yet" |
| Role cards | Not clickable |

- **R2a-P7-F01 (major) [LIVE]. An invalid save crashes the screen.**
  - I cleared the required **Name** on the property edit form and pressed Save. Result: "This screen ran into a problem. Part of this screen stopped working. Try again; if it happens again, reload this screen…" (screens/p7-24-edit-property-invalid.jpg).
  - The field is not highlighted, "Try again" repeats the same error, and pressing Enter does the same. The data was not changed, which I checked.
  - Compare the invite form, where the same kind of mistake gets inline errors plus a summary: "Check the highlighted fields … Nothing was sent." (screens/p7-13-invite-empty-submit.jpg). That is excellent.
- **R2a-P7-F04 (major) [LIVE]. User management is create-only.**
  - On a staff record: "Assign role — Not available yet". There is no deactivate, reset password, reset two-factor, last sign-in, or property-scope change (screens/p7-14-user-record.jpg).
  - Role cards show only a count ("8 PERMISSIONS") and cannot be opened, so I cannot see what a role is allowed to do.
  - "Organization administrator — 1 PERMISSIONS" sits next to "Full access to every property, setting and user" (screens/p7-15-roles-tab.jpg).
  - **Expected:** this is the first thing a director does when someone leaves.
- **R2a-P7-F05 (minor) [LIVE]. The "Invite" form actually creates an account with a password.**
  - The title says "Invite staff member", but the button says "Create", and the director types an "Initial password (optional)… Share it privately" (screens/p7-12-invite-form.jpg).
  - Only one role and one property can be chosen per person, yet the existing staff each have three properties.
- **R2a-P7-F07 (minor) [LIVE].** Visual bug on the staff record: the label "HOUSEKEEPING_ATTENDANT" overprints the property links under Related records (screens/p7-14-user-record.jpg).
- **R2a-P7-F08 (minor) [LIVE].** The legal entity warns "No tax ID (TIN) recorded — needed before fiscal invoices can be issued", but Edit is "Not available yet" (screens/p7-20-legal-entity-record.jpg). The product raises a problem it gives no way to fix. Properties can be edited, so behaviour is inconsistent.
- **R2a-X-F03 (minor; many occurrences) [LIVE]. Technical language a hotel manager will not understand:**
  - Organisation page: "Short name demo-azure-atoll-68e2d4", "Plan enterprise", "Default language en", lowercase "active" and "setup" (screens/p7-10-settings-org.jpg).
  - Staff record: "housekeeping_attendant" and "HOUSEKEEPING_ATTENDANT" (screens/p7-14-user-record.jpg).
  - Property record: the history line "operations.unit.upsertCatalog by System setup" and "Version 1" (screens/p7-21-property-record.jpg).
  - Edit and create forms:
    - "VERSION 1 · Changes are saved with the version you opened…" (screens/p7-23-edit-property.jpg).
    - "If the connection drops while saving, saving again will not create a duplicate" and "ISO 3166, e.g. MV / ISO 4217" (screens/p7-19-new-legal-entity.jpg).
  - Elsewhere:
    - "Country: Mv" (screens/p7-20-legal-entity-record.jpg).
    - "Permissions are always enforced by the server" (screens/p7-11-users-roles.jpg).
    - "العربية (stub)" in the account menu (screens/x-02-account-menu-dark.jpg).
    - "drag-free … before it is committed" on the timeline (screens/pn-06-timeline-phone.jpg).
- **Strength.** The Organisation page's "Where this organization's information comes from" table (Live vs Simulated per capability) is exactly the honesty a buyer needs (screens/p7-10-settings-org.jpg).

---

## P-NEW: brand-new hire at Coral Nest Guesthouse, day one, phone 390×844, no training

The findings below use the words a new hire would use.

### Task 1. Sign in
- **Completed:** yes. 2 screens, about 30 s (screens/pn-01-signin-phone.jpg, screens/pn-02-code-phone.jpg).
- **R2a-PN-F07 (minor) [LIVE].**
  - "Open the authenticator app on your phone…" — *"I'm already on my phone. Which app? Nobody set one up for me."*
  - "use the demo authenticator secret from the demo sign-in details" — *"What secret? What details?"*
  - There is no first-time setup path and no "Forgot password" (screens/pn-02-code-phone.jpg).

### Task 2. Without help, find what I need to do today and the first guest arriving
- **Completed:** partly / no. About 4 min, 8+ taps.
- **R2a-PN-F01 (major) [SIM]. "Who's coming next?" has no answer.**
  - Today says Arrivals **0**, and the Arrivals screen says "No arrivals for this date — Arrivals appear here once bookings for this business date exist." It has no "tomorrow" button and no "next arrival" link (screens/pn-05-arrivals-empty-phone.jpg).
  - Searching "arriving" finds nothing (screens/pn-09-search-arriving-phone.jpg).
  - The timeline on a phone shows about three days, with names cut to "N…" (screens/pn-06-timeline-phone.jpg). *"I still don't know who is coming or when."*
- **R2a-PN-F05 (major) [SIM]. Nothing tells me what to do today.**
  - Departures shows two guests with balances (screens/pn-12-departures-phone.jpg). Opening one shows "Check in" (greyed out) as the first button, no "Check out", and no bill (screens/pn-14-departure-record-phone.jpg).
  - *"Do I take their money? Where? Do I clean rooms 7 and 10?"*
- **R2a-PN-F02 (major) [LIVE].**
  - The phone header truncates to "Coral Nes… / CNG · Busine…", so the business date is hidden (screens/pn-03-landing-phone.jpg).
  - The purple DEMO banner takes about 95 px of an 844 px screen.
  - The property switcher still opens a list with a single property in it (screens/pn-13-property-button-phone.jpg).
- **R2a-PN-F04 (minor) [SIM].**
  - The checklist says "Get started as **Organization administrator**" — *"I'm not an administrator, I'm new."*
  - It asks for "Review staff and roles" and "Search with / or the command palette" (*"What's a command palette? There's no slash key on my phone."*).
  - "Where today's arrivals stand" draws an empty chart with only a legend instead of saying "No arrivals today" (screens/pn-15-today-full-phone.jpg).
- **R2a-PN-F06 (minor) [SIM].** My work shows "Night shift handover" and "Approve rate override… requested by the reservations team" (screens/pn-07-mywork-phone.jpg). *"We're a 12-room guesthouse. What reservations team? Am I allowed to approve that?"* Also, "+6 columns hidden to fit" hides due times and owners.

### Task 3. Find help inside the product
- **Completed:** partly. Help was easy to find (the "?" icon), but it is empty. About 1 min.
- **R2a-X-F04 (major) [LIVE].** "Help for this screen" says on every screen: "Articles and tutorial videos for this screen will appear here once the Portico website courses are published. Nothing is missing from the product itself." (screens/pn-08-help-phone.jpg, screens/p7-22-help-properties.jpg). *"It says nothing is missing, but there's nothing here."*
- **R2a-PN-F03 (major) [LIVE].**
  - On the phone, Help lists only keyboard shortcuts (Ctrl K, /, ?, N) (screens/pn-08-help-phone.jpg).
  - Every learning-centre item is "CONTENT COMING", and "Open" just jumps to a screen (screens/pn-11-content-coming-phone.jpg).
  - "Practise in training — No training organization is linked to your account yet" (screens/pn-10-learning-centre-phone.jpg).
- **R2a-PN-F08 (polish) [LIVE].**
  - The phone menu sheet is titled "Main" (screens/pn-04-menu-phone.jpg).
  - Search on the phone shows "↑ ↓ to move · Enter to run · Esc to close" (screens/pn-09-search-arriving-phone.jpg).
- **R2a-PN-F09 (polish) [SIM].** The timeline subtitle "drag-free: select a stay and preview any change before it is committed" is jargon (screens/pn-06-timeline-phone.jpg).

---

## Cross-persona findings

- **R2a-X-F01 (major) [SIM].** Today tiles do not open lists that match their number. Described under P1 Task 5 (screens/p1-27-tile-payments-mywork.jpg, screens/p1-28-tile-occupancy-timeline.jpg, screens/p4-08-hk-payments-tile.jpg).
- **R2a-X-F02 (major) [SIM+LIVE]. Most "do" actions are not available yet.**
  - Not available: Check in (after the click), Move unit, Cancel booking, guest Edit, Report issue, Assign role, legal entity Edit (screens/p1-15-more-actions.jpg, screens/p1-21-checkin-dialog.jpg, screens/p4-13-villa103-actions.jpg, screens/p7-14-user-record.jpg).
  - No persona could finish their core job loop. Showing them is honest, but the demo then reads mostly as a viewer.
- **R2a-X-F03 (minor) [LIVE].** Technical words (listed under P7 Task 3).
- **R2a-X-F04 (major) [LIVE].** Help and learning content are placeholders (listed under P-NEW Task 3).
- **R2a-X-F05 (minor) [LIVE]. Role names do not match.**
  - The director signs in as "Group Director", but the checklist and role say "Organization administrator" (screens/p7-04-switched-lagoon.jpg, screens/p7-11-users-roles.jpg).
  - The guesthouse owner is "Owner (does everything)" in the account menu, yet the checklist says "Organization administrator" (screens/pn-03-landing-phone.jpg).
- **R2a-X-F06 (minor) [SIM]. The sample data is visibly copied between properties.**
  - Lagoon Hotel has the same "failed inspection (shower drain) — re-clean assigned to Hawwa" and "No unit assigned yet — 2 … ready and free today" blockers as the resort (screens/p7-05-lagoon-arrivals.jpg).
  - The 12-room guesthouse shows "Checked in by Ahmed (front desk)", "Unit assigned by Aishath (front desk)" and "Reservations agent" in its history (screens/pn-14-departure-record-phone.jpg), plus a night-shift handover (screens/pn-07-mywork-phone.jpg).
  - This undercuts realism, and the guesthouse sees resort-level complexity.
- **Light vs dark.**
  - Dark mode follows the system setting automatically. It is calm and readable, status colours keep their meaning, and the Simulated badges stay distinct (screens/x-01-dark-arrivals.jpg, screens/x-03-dark-housekeeping-tablet.jpg, screens/x-04-dark-record-tablet.jpg).
  - The account menu offers Light / Dark / Match system and Compact / Comfortable density (screens/x-02-account-menu-dark.jpg). No dark-only defects found.

---

## Top 20 friction points (ranked)

1. **R2a-P1-F01.** "Ready / Inspected" shown for villas still occupied by departing guests (VIP included).
2. **R2a-P4-F01.** The housekeeping board says Vacant/Inspected for rooms the front desk says are in house; departure cleans are missing.
3. **R2a-P4-F02.** Baby-cot blockers owned by Housekeeping never appear on the housekeeping board.
4. **R2a-P1-F02.** The primary "Check in" looks enabled but only shows "not available in this demo yet".
5. **R2a-P4-F04.** The housekeeping supervisor sees guest balances, payment status and the Extend stay price preview, with no role message.
6. **R2a-P1-F03.** Blockers owned by "Front desk" (assign unit, passport details) have no action anywhere.
7. **R2a-P7-F01.** Saving a property with an empty required field shows "This screen ran into a problem" instead of a field error.
8. **R2a-P1-F05.** Departing guests have no Check out, no folio and no settle; the only button shown is a disabled "Check in".
9. **R2a-P7-F02.** The keyboard property switch focuses the first item, ignores typing, and silently switches to the wrong property.
10. **R2a-P1-F06.** Lists are not keyboard-focused on arrival; it takes 25 Tabs before j/k work.
11. **R2a-PN-F01.** The new hire cannot find the next arriving guest (no date navigation, no "next arrival").
12. **R2a-P1-F04.** Payment pending verification has no amount, attempt time or owner, and its numbers don't reconcile with Today.
13. **R2a-P4-F03.** The supervisor cannot assign attendants, change priority or mark rooms; only a disabled "Mark inspected".
14. **R2a-X-F01.** Exceptions and payments tiles open the same unfiltered 13-row list; the occupancy number can't be verified.
15. **R2a-P7-F04.** User management is create-only: no role change, deactivate or reset; roles cannot be inspected.
16. **R2a-X-F04.** "Help for this screen" is a placeholder everywhere; all learning content is "coming".
17. **R2a-P7-F03.** No group view for the director; the switcher lacks business date and status per property.
18. **R2a-P7-F06.** The property is "in setup — not yet operating" while it shows 18 arrivals and 41 in house.
19. **R2a-P4-F05.** The housekeeping Today page shows front-desk and money figures instead of housekeeping progress.
20. **R2a-X-F03.** Developer language: Indian/Maldives, housekeeping_attendant, upsertCatalog, VERSION 1, ISO 3166, "1 PERMISSIONS", "(stub)".

## Top 10 things that felt better than systems I know

1. **One-line blockers on arrivals**, with an ETA estimate and "Next: who" (screens/p1-06-blocked-filter.jpg). Faster to read than OPERA's arrivals plus room-status plus traces.
2. **Extend stay preview** (screens/p1-18-extend-stay.jpg, screens/p1-19-extend-confirm-disabled.jpg).
   - It shows availability before/after and agreed vs new prices.
   - It includes Maldives service charge, TGST and green tax, and treats the deposit as a liability.
   - It adds "What else happens" (the housekeeping plan) and a preview validity time.
3. **Disabled actions say why**, inline and in a tooltip (screens/p1-20-checkin-blocked-elena.jpg).
4. **Honest provenance:** Simulated/Live badges everywhere, plus a per-capability source table (screens/p7-10-settings-org.jpg).
5. **Sign-in errors** with recovery advice, tries remaining and a support reference (screens/p1-02-wrong-password.jpg, screens/p1-03-wrong-code.jpg).
6. **Form validation on Invite**: inline errors, a summary, and "Nothing was sent" (screens/p7-13-invite-empty-submit.jpg).
7. **Keyboard model**: a shortcut sheet, `g`-chords, the command palette, and j/k that carry the open record along (screens/p1-08-shortcuts.jpg, screens/p1-11-record-next-j.jpg).
8. **Money truthfulness wording**: "Card authorized (not yet charged)" vs "Payment received" vs "Deposit received; balance due at check-out", and "do not take payment again" (screens/p1-11-record-next-j.jpg, screens/p1-23-tablet-marco-lin.jpg).
9. **Responsive and honest layouts.**
   - No horizontal scroll at 390 px or 1024 px.
   - "+N columns hidden to fit" chips, and phone card layouts (screens/p1-22-tablet-arrivals.jpg, screens/pn-12-departures-phone.jpg).
   - Dark mode and density switching (screens/x-01-dark-arrivals.jpg, screens/x-02-account-menu-dark.jpg).
10. **Counts that match.** The Arrivals, Departures and In-house numbers on Today exactly match their lists, and every list states "N of N rows".

## What would make each persona's work "as easy as humanly possible"

- **Front desk agent.**
  - Land with focus on the first arrival row, so j/k and Enter work immediately.
  - One readiness truth shared with housekeeping: a villa with a guest still in it is never "Ready".
  - Every blocker carries its fix button: "Assign Villa 251 (ready)", "Add passport details", "Call PSP / mark verified with manager approval".
  - A departure record opens on the folio, with *Check out* and *Settle* as the primary actions.
  - Esc returns to the record you were on.
  - Show room-type names on hover.
- **Housekeeping supervisor.**
  - A Today page about rooms: dirty/clean/inspected progress, rooms needed by ETA, attendant load, DND rooms, cots and amenities.
  - The board must include requests (cots) and the outgoing guest's status (due out / late check-out).
  - Drag or tap to assign attendants, bulk-select, and mark clean or inspected.
  - Attendant and Ready columns kept visible on a tablet.
  - Money hidden for this role, with a polite "front desk only" note.
- **Group director.**
  - A portfolio Today across all properties, with per-property business date and status.
  - A property switcher with type-ahead that opens on the current property and confirms the switch.
  - Full user lifecycle: change role, deactivate, reset password and 2FA, last sign-in, readable permission lists.
  - Plain-language settings, and field-level validation on every form.
- **Brand-new hire (guesthouse, phone).**
  - A "Your day" list in plain words: "2 guests leave today — collect USD 482.28 from Chloé Lin (Room 7)…; next guest arrives tomorrow 14:00: Emma Singh, Room 3".
  - Arrivals with "next date with arrivals".
  - The property and business date visible on the phone.
  - Help that actually explains the screen, and a role-appropriate checklist with no keyboard talk on a phone.
  - Hide resort-only items (night handover, reservations team) for a 12-room guesthouse.

---

## Evidence manifest

| Finding ID | Screenshot(s) | What the image shows |
|---|---|---|
| (sign-in, strength) | screens/p1-01-code-step.jpg | Code step naming "Azure Atoll Collection (demo)" with a DEMO badge |
| R2a-P1-F18 | screens/p1-02-wrong-password.jpg | "Email or password not recognised" box with reference; no forgot-password link |
| (strength) | screens/p1-03-wrong-code.jpg | Inline "That code is not right… 4 more tries" message |
| R2a-P1-F09, R2a-P1-F10 | screens/p1-04-landing-arrivals.jpg | Arrivals list on landing: SWVP/WV/BV codes, "estimate" under every balance incl. 0.00 |
| R2a-P1-F19, R2a-P1-F04 | screens/p1-05-overview.jpg | Today page titled "Today" under the "Overview" nav; Payments pending USD 1,170.00 tile |
| R2a-P1-F01 (context), R2a-P4-F02, strength 1 | screens/p1-06-blocked-filter.jpg | Blocked 9 filter: one-line blockers, "Next:" owner, baby-cot rows owned by Housekeeping |
| R2a-P1-F06, strength 7 | screens/p1-08-shortcuts.jpg | Keyboard shortcuts sheet promising j/k and Enter on lists |
| R2a-P1-F11, R2a-P1-F16 | screens/p1-10-record-drawer.jpg | Ahmed Kowalska drawer: issue "Owner: Housekeeping" above "Owner: No owner assigned"; 08:00 ETA vs 14:55 ready |
| R2a-P1-F07, strength 7, 8 | screens/p1-11-record-next-j.jpg | Drawer moved to Priya Kapoor via j while list highlight stays on Ahmed; "Card authorized (not yet charged)" |
| R2a-P1-F07 | screens/p1-12-after-esc.jpg | After Esc, focus outline back on Ahmed Kowalska, not Priya |
| R2a-P1-F01 | screens/p1-13-mei-singh-villa135.jpg | Mei Singh "Ready for check-in", Villa 135 "Inspected", "Unit ready · OK" |
| R2a-P1-F03 | screens/p1-14-jonas-no-unit.jpg | Jonas Petrova blocked "No unit assigned"; Check in disabled; Move unit not available |
| R2a-P1-F03, R2a-P1-F14, R2a-X-F02 | screens/p1-15-more-actions.jpg | "…" menu: Show on timeline; Cancel booking "Not available in this demo yet" |
| R2a-P1-F01, R2a-P1-F05 | screens/p1-17-departure-record.jpg | Daniel Johansson in house in Villa 135 (late check-out), "Inspected"; disabled Check in; no checkout/folio |
| R2a-P1-F12, strength 2 | screens/p1-18-extend-stay.jpg | Extend stay preview: availability, price, Service charge 10%, TGST 17%, Green Tax |
| R2a-P1-F12, strength 2 | screens/p1-19-extend-confirm-disabled.jpg | Bottom of preview: "This change cannot be made as it stands…"; Confirm disabled |
| R2a-P1-F03, strength 3 | screens/p1-20-checkin-blocked-elena.jpg | Tooltip "Not available: Passport details missing for 2 adults" on disabled Check in |
| R2a-P1-F02, R2a-X-F02 | screens/p1-21-checkin-dialog.jpg | Toast "Check in is not available in this demo yet. Nothing was changed." after clicking primary Check in |
| R2a-P1-F15, strength 9 | screens/p1-22-tablet-arrivals.jpg | Tablet 1024 arrivals with "+2 columns hidden to fit" (Balance hidden) |
| R2a-P1-F04, strength 8 | screens/p1-23-tablet-marco-lin.jpg | Marco Lin record on tablet: payment pending verification blocking, no amount or owner detail |
| Task P1-4 | screens/p1-24-tablet-inhouse.jpg | In house list on tablet: 95 stays, Balance due 75 |
| R2a-P1-F01, R2a-P1-F13 | screens/p1-25-search-villa135.jpg | Search "Villa 135": unit types first; Mei Singh (Expected) and Daniel Johansson (In house) both in Villa 135 |
| R2a-X-F01, R2a-P1-F11 | screens/p1-27-tile-payments-mywork.jpg | Payments tile lands on unfiltered My work (13 rows, mixed kinds, empty Assigned to) |
| R2a-X-F01 | screens/p1-28-tile-occupancy-timeline.jpg | Occupancy tile lands on generic 120-unit timeline |
| R2a-P1-F03, R2a-P1-F14 | screens/p1-29-guest-record-empty.jpg | Guest record "Mei Singh › Mei Singh", Edit not available, no profile data |
| R2a-P4-F01, R2a-P4-F08 | screens/p4-01-landing.jpg | Housekeeping board: Villas 240/245 "Vacant · Departure today"; DND label wrapping Villa 106 |
| R2a-P4-F06 | screens/p4-02-hidden-columns.jpg | Columns menu: Section, Attendant, Ready (estimate) "hidden to fit" on tablet |
| R2a-P4-F01 | screens/p4-03-villa135-housekeeping.jpg | Villa 135 on board: Inspected, Vacant, next arrival 13:35 Singh |
| R2a-P4-F02, R2a-P4-F08 | screens/p4-04-villa108-no-cot.jpg | Villa 108: no priority, Unassigned, unexplained "Sleep" chip; no baby-cot task |
| R2a-P4-F03 | screens/p4-05-villa104-record.jpg | Villa 104 record: Mark inspected disabled, Report issue not available |
| R2a-P4-F04, R2a-P4-F05 | screens/p4-06-hk-overview.jpg | HK supervisor's Today identical to front desk (arrivals, departures with balance due) |
| R2a-P4-F07 | screens/p4-07-hk-arrivals-tile.jpg | HK on Arrivals with tab bar Today/My work/Learning centre, none selected |
| R2a-X-F01 | screens/p4-08-hk-payments-tile.jpg | HK payments tile opens same unfiltered My work list |
| R2a-P4-F04 | screens/p4-10-hk-guest-stay-money.jpg | HK supervisor viewing Marco Lin stay incl. payment verification status |
| R2a-P4-F01, R2a-P4-F04 | screens/p4-11-hk-sees-departure-balances.jpg | HK supervisor sees Departures with per-guest balances (Villas 240/135/145/245/160) |
| R2a-P4-F04 | screens/p4-12-hk-extend-stay-prices.jpg | HK supervisor opened Extend stay with prices and taxes |
| R2a-P4-F03, R2a-X-F02 | screens/p4-13-villa103-actions.jpg | Villa 103 (departure clean): only disabled Mark inspected / Report issue; no assign |
| R2a-P7-F09 | screens/p7-01-after-password.jpg | Organisation chooser: demo vs training without explanation |
| R2a-P7-F03 | screens/p7-03-property-switcher.jpg | Property switcher listing 3 properties with "Indian/Maldives", no business dates |
| R2a-P7-F03, R2a-P7-F06, R2a-X-F05 | screens/p7-04-switched-lagoon.jpg | Lagoon Hotel Today: 18 arrivals, 41 in house; "Get started as Organization administrator" |
| R2a-X-F06 | screens/p7-05-lagoon-arrivals.jpg | Lagoon arrivals with same "shower drain / Hawwa" and "2 … ready and free" blockers |
| R2a-P7-F02 | screens/p7-08-gs-switcher-focus.jpg | `g s` in Lagoon: focus highlight on first item Atoll Resort, check on Lagoon |
| R2a-P7-F02 | screens/p7-09-wrong-property-after-enter.jpg | After typing "Reef" + Enter: now in Azure Atoll Resort, no confirmation |
| R2a-X-F03, strength 4 | screens/p7-10-settings-org.jpg | Org details (demo-azure-atoll-68e2d4, enterprise, en) and Live/Simulated source table |
| R2a-X-F03, R2a-X-F05 | screens/p7-11-users-roles.jpg | Users list: "Permissions are always enforced by the server", lowercase "active", Organization administrator role |
| R2a-P7-F05 | screens/p7-12-invite-form.jpg | Invite form with "Create" button and Initial password; one role / one property |
| strength 6 | screens/p7-13-invite-empty-submit.jpg | Empty submit: inline errors and "Check the highlighted fields… Nothing was sent." |
| R2a-P7-F04, R2a-P7-F07, R2a-X-F02, R2a-X-F03 | screens/p7-14-user-record.jpg | Staff record: Assign role "Not available yet", raw housekeeping_attendant, overlapping labels |
| R2a-P7-F04, R2a-P4-F03 | screens/p7-15-roles-tab.jpg | Role cards with counts only; "Organization administrator 1 PERMISSIONS"; supervisor "assigns attendants" |
| R2a-P7-F08, R2a-X-F03 | screens/p7-20-legal-entity-record.jpg | Legal entity: "Country: Mv", TIN warning, Edit "Not available yet" |
| R2a-X-F03 | screens/p7-19-new-legal-entity.jpg | New legal entity form: "ISO 3166 / ISO 4217", "If the connection drops…" |
| R2a-P7-F06, R2a-X-F03 | screens/p7-21-property-record.jpg | Lagoon property: "in setup — not yet operating", "operations.unit.upsertCatalog", Version 1 |
| R2a-X-F04 | screens/p7-22-help-properties.jpg | Help panel placeholder "Articles and tutorial videos… will appear here" |
| R2a-X-F03 | screens/p7-23-edit-property.jpg | Property edit form with "VERSION 1" concurrency text |
| R2a-P7-F01 | screens/p7-24-edit-property-invalid.jpg | Empty Name + Save: "This screen ran into a problem" with Try again |
| P-NEW sign-in | screens/pn-01-signin-phone.jpg | Sign-in card on 390 px phone |
| R2a-PN-F07 | screens/pn-02-code-phone.jpg | Phone code step: "Open the authenticator app on your phone", demo secret note |
| R2a-PN-F02, R2a-X-F05 | screens/pn-03-landing-phone.jpg | Phone Today: header "Coral Nes… / CNG · Busine…", tall DEMO banner, "Organization administrator" checklist |
| R2a-PN-F08 | screens/pn-04-menu-phone.jpg | Phone menu sheet titled "Main" |
| R2a-PN-F01 | screens/pn-05-arrivals-empty-phone.jpg | "No arrivals for this date" with no date navigation |
| R2a-PN-F01, R2a-PN-F09, R2a-X-F03 | screens/pn-06-timeline-phone.jpg | Timeline on phone: 3 days visible, truncated names, "drag-free… committed" |
| R2a-PN-F06, R2a-X-F06 | screens/pn-07-mywork-phone.jpg | Guesthouse My work: night shift handover, rate override approval, +6 columns hidden |
| R2a-X-F04, R2a-PN-F03 | screens/pn-08-help-phone.jpg | Phone Help: placeholder + keyboard shortcuts list |
| R2a-PN-F01, R2a-PN-F08 | screens/pn-09-search-arriving-phone.jpg | Search "arriving": No matches; keyboard hints on phone |
| R2a-PN-F03 | screens/pn-10-learning-centre-phone.jpg | Learning centre: "No training organization is linked to your account yet" |
| R2a-PN-F03 | screens/pn-11-content-coming-phone.jpg | Learning paths, every item "CONTENT COMING" |
| R2a-PN-F05, strength 9 | screens/pn-12-departures-phone.jpg | Phone departures cards: Chloé Lin / Hiroshi Kowalska with balances, no check-out |
| R2a-PN-F02 | screens/pn-13-property-button-phone.jpg | Property switcher on phone with a single property |
| R2a-PN-F05, R2a-X-F06 | screens/pn-14-departure-record-phone.jpg | Phone departure record: disabled Check in first, no checkout/folio |
| R2a-PN-F04 | screens/pn-15-today-full-phone.jpg | Full phone Today: empty "Where today's arrivals stand" chart with only a legend |
| Light/dark, strength 9 | screens/x-01-dark-arrivals.jpg | Arrivals in dark mode (follows system) |
| R2a-X-F03, strength 9 | screens/x-02-account-menu-dark.jpg | Account menu: Theme, Density, "العربية (stub)" |
| Light/dark | screens/x-03-dark-housekeeping-tablet.jpg | Housekeeping board in dark mode on tablet |
| Light/dark | screens/x-04-dark-record-tablet.jpg | Villa 104 unit record in dark mode on tablet |

**Evidence check (by script: every `*.png` name in this report is checked to exist in the output folder, and the md5 hashes of the cited files are compared):** 74 cited files, 74 present, 0 duplicates.
