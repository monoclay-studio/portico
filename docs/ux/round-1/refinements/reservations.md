# Round 1 refinements — Reservations

Scope: new bookings and quotes, date changes, cancellations, options/holds, the Timeline and availability. Persona P3
(reservations agent, desktop 1920×1080), plus booking needs raised by P1 and P2. Citation keys, categories and the
power-check rule are defined at the top of `front-desk.md`. Outcomes are **TARGETS** until validated with hotel staff.

| ID | Refinement | Cat | Owner | Priority |
|---|---|---|---|---|
| RSV-01 | New booking and quote in one sheet from `N` | (a) | reservations | blocker |
| RSV-02 | "Change dates" replaces "Extend 1–3 nights"; an infeasible preview never offers Confirm | (a) | reservations | blocker |
| RSV-03 | Cancel with the fee shown before you commit | (a) | reservations | blocker |
| RSV-04 | The Timeline answers "what's free?" | (a) | reservations | major |
| RSV-05 | Options and holds are records you can open and act on | (a) | reservations | major |
| RSV-06 | Booking terms at a glance | (a) | reservations | major |
| RSV-07 | A Reservations workspace with Now / Today / Watch | (a) | reservations | major |
| RSV-08 | Move or change type from the Timeline, always through a preview | (a) | reservations | major |
| RSV-09 | Availability on Today in rooms, not only percent | (c) | backoffice/ui | minor |

---

### RSV-01 · New booking and quote in one sheet from `N`

**Category** (a) — `POST /v1/reservations/quotes`, change preview `new_booking` → commit, rates quote engine and
policies, guests `resolveProfile`, payments guarantee · **Owner** reservations (+ rates, guests, payments) ·
**Priority** blocker
**Evidence** P3 › Quote and book a family of 4 in two villas — **No**, ~6 attempts (`N`, palette, empty cell, hold);
"no New reservation, availability search, rate or quote screen, rate plans, or multi-room booking"; T1 ·
`[screens/p3-01-home.jpg]` `[screens/p3-03-option.jpg]`

**Proposed change.**
- `N` on Reservations/Timeline, "+ New booking" in the header, or palette "New booking" / "quote" / "book" opens the
  **Booking sheet**: a wide side panel (not a modal) so the Timeline stays visible at ≥ 1440 px.
- **1 · Search.** Arrival/departure fields that accept typing ("14 nov", "5n" → 5 nights) with the nights count;
  **Rooms**: one row per room with adults, children and **child-age chips** (ages drive price and Green Tax,
  scenario S04); `+ Add room`. Optional filters: rate plan, company/agency (negotiated rates), promo code.
- **2 · Offers.** A matrix: rows = unit types with the **free count for the whole range** ("Water Villa · 3 free"),
  columns = rate plans (e.g. BAR, Half board, Non-refundable). Each cell = all-in total for the stay incl. taxes and
  Green Tax, with policy glyphs; restriction violations as text ("Minimum 3 nights on 15 Nov"). Clicking a cell
  assigns that offer to the selected room row. Under the chosen offer: the plain-language policy from rates
  ("Free cancellation until 14 days before arrival (Malé time); then 100 % of stay").
- **3 · Guest and booker.** Search-or-create with duplicate hints (GST-04); occupants per room (optional now);
  booker / company / agency; source, channel and market segment default from the user's desk.
- **4 · Status.** **Confirm** (choose guarantee: card, deposit request, agency voucher) · **Hold as option until
  [date]** (tentative with option date, RES-R09) · **Save quote** (sending it to the guest needs comms — (b)).
- Footer: total for all rooms, deposit due now, **Preview booking** → change preview (per night per room, taxes,
  deposit schedule) → **Confirm** (`Ctrl+Enter`).
- Last-unit race (scenario S01, already built): on `preview_stale` show "Water Villa just sold 4 s ago by Aishath —
  here are the alternatives" with the previewed alternatives selectable.

**Expected outcome (targets).** Quote + book a two-villa family booking in ≤ 3 min, one sheet + preview; round-2
new-user unaided success on this task ≥ 80 % (baseline: 0 — not possible).

**Power check.** All booking fields (RES-R01) remain under "More details"; multi-room, child ages, negotiated rates,
options and quotes match PAR-RES-022 and Mews/OPERA booking flows. Nothing is removed.

---

### RSV-02 · "Change dates" replaces "Extend 1–3 nights"; an infeasible preview never offers Confirm

**Category** (a) — change kind `dates` with `extraNights` strategies, server `alternatives`, `preview_stale`
(RES-R11/R12/R15/R16) · **Owner** reservations · **Priority** blocker
**Evidence** P1 › Extend stay: default 2 nights, choices 1–3 only, no date picker; the preview warns "Room 1 is booked
by another stay… (scenario S03)", **Confirm is still enabled**, then fails; Move unit is disabled → **dead end**;
"Change" column clipped on phone. P3 › Change dates (Partly). T3. B2 (the preview is the best screen in the product) ·
`[screens/p1-09-extend.jpg]` `[screens/p1-10-extend-options.jpg]` `[screens/p1-11-extend-confirmed.jpg]`
`[screens/p3-08-extend-future.jpg]`
**Overlaps** SR P2-13 (model the real preview contract, `preview_stale`, 202 forwarded, Idempotency-Key)

**Proposed change.**
- Rename to **Change dates** (keep "Extend stay" as the quick action label on in-house stays). Two date fields
  (arrival editable only before check-in) with nights count; quick chips **+1 night · +2 · −1**; default **+1**
  (the commonest extension), not +2.
- Keep the preview anatomy the tester praised (summary sentence → per-night table → taxes → deposit as liability →
  balance → consequences → expiry).
- When the assigned room is not free for added nights, show the server's **alternatives as choices above the button**:
  1. Stay in Room 1 until 9 Nov, move to Room 3 for the extra nights;
  2. Move the whole stay to Room 3;
  3. Change type for the extra nights (chargeable / complimentary);
  4. Waitlist the extension.
  **Confirm stays disabled until one is chosen**, and its label states the choice ("Extend and move to Room 3 for
  2 nights").
- Remove "(scenario S03)" and "Simulator sample lines … rates module's effective-dated rules" (NAV-09).
- Phone: the per-night table stacks (date, then "Before → After"); the change column is never clipped.

**Expected outcome (targets).** Extend incl. an alternative unit ≤ 45 s, 0 dead ends (ux §19). Baseline: dead end
after Confirm.

**Power check.** Shorten / early departure (RES-R16) and arrival shifts use the same sheet and preview; all four
alternatives of RES-R15 (PAR-RES-044, P0) are visible. More power than today, none removed.

---

### RSV-03 · Cancel with the fee shown before you commit

**Category** (a) — `cancel_booking` / `cancel_stay` with penalty from agreed terms in property time, waive with
permission (RES-R20); deposit forfeit/refund executed by finance/payments · **Owner** reservations (+ rates, finance,
payments) · **Priority** blocker
**Evidence** P3 › Cancel and understand the fee — **No**: "More actions → Cancel booking disabled; no policy shown";
T3 · `[screens/p3-06-future-more.jpg]`

**Proposed change.**
- **Cancel booking** (or **Cancel this stay** on a multi-stay booking) → reason (picklist + note) → **preview**:
  - "Cancellation fee USD 450.00 (1 night + taxes). Free cancellation ended Sat 14 Nov 23:59 Malé time — terms agreed
    on 2 Oct."
  - "Deposit held USD 600.00 → USD 450.00 applied to the fee, USD 150.00 refunded to card ending 4242 (the refund
    runs after you confirm)."
  - Consequences: nights released to inventory; channel booking → "Cancel at the channel" when the channel owns it;
    guest message (when comms exists).
- **Waive fee**: toggle requiring the waive permission (⚑) and a reason; if the user lacks it, show who can approve.
- The preview's **Confirm** is the single confirmation (irreversible + external refund justifies it, ux §5).

**Expected outcome (targets).** 100 % of cancellations show fee and deposit outcome before commit; ≤ 4 interactions.

**Power check.** Per-stay cancellation, waivers with permission and channel-owned rules are preserved; no fee is ever
charged silently.

---

### RSV-04 · The Timeline answers "what's free?"

**Category** (a) — inventory availability per type and night + explanation (INV-R28) · **Owner** reservations
(Timeline UI, + inventory) · **Priority** major
**Evidence** P3: no unit-type filter, no free-count row per type, no "find free villa for dates", no jump-to-date;
"the availability counts the agent needs ('9 free → 8 free') appear only inside the extend preview" ·
`[screens/p3-04-occ-table.jpg]` `[screens/p1-14-timeline-full.jpg]`
**Overlaps** SR P2-18 (zoom levels, list view for screen-reader users)

**Proposed change.**
- A sticky **availability row per unit-type group**: free count per night ("Water Villa 3 · 2 · 0 · 1 …"); "Oversold"
  in red with text; authorized overbooking in amber with text. Each count opens inventory's explanation ("12 villas −
  8 sold − 1 out of order = 3").
- **Type filter chips** and an **"Only free"** toggle; **Jump to date** (date picker; `d` focuses it).
- Select empty cells (drag, or Shift+arrows, ux §9) → **New booking for these nights** (RSV-01 prefilled), **Hold**,
  **Block (out of order)…** (inventory preview).

**Expected outcome (targets).** "How many Water Villas are free 14–18 Nov?" answered in ≤ 5 s on one view.

**Power check.** The Timeline keeps its current behaviour (B5: one tab stop, arrow keys); this adds the inventory
grid's power into it.

---

### RSV-05 · Options and holds are records you can open and act on

**Category** (a) — tentative bookings with option date, expiry job (RES-R09), inventory holds · **Owner**
reservations · **Priority** major
**Evidence** P3: "Clicking a hold bar ('Option 3GXVK') opens the **Villa** record, not the option or quote. Holds
cannot be inspected." · `[screens/p3-03-option.jpg]`

**Proposed change.**
- A hold/option bar opens the **booking**: status chip "Held", "Option until Tue 10 Nov 18:00 MVT · in 3 days",
  requester, offered rate; actions **Confirm** (→ guarantee), **Extend option** (policy/permission), **Release**.
- Bars show an expiry icon; the Reservations "Now" list shows options expiring today and tomorrow (RSV-07).

**Expected outcome (targets).** Inspect an option in 1 click; 0 options expiring unnoticed.

**Power check.** Adds visibility; matches PAR-RES-022.

---

### RSV-06 · Booking terms at a glance

**Category** (a) — booking fields (RES-R01) and the sealed terms snapshot; rates policy text · **Owner** reservations
(+ rates) · **Priority** major
**Evidence** P3: "The booking record has no rate plan, source/channel, booker/contact, cancellation or deposit policy,
or guarantee type." · `[screens/p3-05-future-stay.jpg]`

**Proposed change.**
- A **Terms** section on booking and stay records, collapsed to one line: "BAR Half Board · Booking.com (ref 4821…) ·
  Guarantee: card · Free cancellation until 14 Nov · Deposit 30 % paid".
- Expanded: the snapshotted terms with "agreed on 2 Oct" stamp, nightly prices, inclusions, cancellation tiers,
  payment schedule; booker and contact; channel-owned fields with an **External** marker (the lock itself, RES-R14, is
  (b)).

**Expected outcome (targets).** "What did the guest agree to?" answered in 1 click.

**Power check.** Shows data already captured; nothing removed. Progressive disclosure keeps the header calm.

---

### RSV-07 · A Reservations workspace with Now / Today / Watch

**Category** (a) — `/reservations/issues`, bookings list, channel field-loss reviews, waitlist, handovers ·
**Owner** reservations · **Priority** major
**Evidence** P3: "The navigation has Overview and Reservations → Timeline only"; personas P3 workspace definition
("options expiring today, unpaid deposits due, waitlist matches") · `[screens/p3-01-home.jpg]`

**Proposed change.**
- Sections: **Timeline** (default) · **Bookings** (DataTable with saved views: arriving by date, modified today,
  channel reviews) · **Options & waitlist** · **Issues**.
- Workspace "Now" panel above the Timeline (collapsible): options expiring today, deposits due/unpaid, channel
  field-loss reviews, waitlist matches — each row with its action (Confirm / Release, Request payment, Review, Offer).

**Expected outcome (targets).** The day's follow-ups found in 1 screen (baseline: none visible).

**Power check.** The Timeline stays the default view; lists add power.

---

### RSV-08 · Move or change type from the Timeline, always through a preview

**Category** (a) — change kinds `move`, `unit_type`, segment split (RES-R03/R17) · **Owner** reservations ·
**Priority** major
**Evidence** P2 › Move guest to another villa — **No** ("Move unit disabled"); T3; ux §9 (drag creates a preview,
keyboard alternative required)

**Proposed change.**
- On a stay bar: **drag** to another row, or keyboard `m` → arrow to the target row → `Enter` (WCAG 2.5.7
  alternative) → **move preview** (reason, chargeable, from which night) → Confirm.
- Context menu (`Shift+F10` / long-press): Move, Change dates, Change type, Split stay. Never a silent commit.

**Expected outcome (targets).** Room move ≤ 30 s (ux §19); keyboard-only move possible (baseline: impossible).

**Power check.** Matches PAR-RES-064/065 (P0) and split stays PAR-RES-043 (P0).

---

### RSV-09 · Availability on Today in rooms, not only percent

**Category** (c) · **Owner** backoffice/ui (Today), data from inventory · **Priority** minor
**Evidence** P3: "The Today occupancy chart gives percent by type, not rooms free" · `[screens/p3-04-occ-table.jpg]`

**Proposed change.** The occupancy tile reads "Tonight 106 of 120 occupied · 11 free (3 Water, 8 Beach) · 3 out of
order" with the percentage as the secondary figure (design direction: value + denominator). Per-type small multiples
label the free count. Clicking opens the Timeline on tonight with free cells highlighted.

**Expected outcome (targets).** Free rooms tonight read in ≤ 3 s.

**Power check.** Percentages stay as secondary figures.
