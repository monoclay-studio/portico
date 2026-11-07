# Personas and role workspaces

Status: v1 · 2026-11-07 · Inputs: owner brief §6–§15, research 01–04, vision "Who it is for". Role templates refer to
`modules/identity/src/domain/role-templates.ts` (implemented: Organization administrator, General manager, Front desk
agent, Reservations agent, Night auditor, Housekeeping supervisor, Housekeeping attendant, Engineering / maintenance,
Finance / accounts receivable, Revenue manager, Read only); templates marked *proposed* should be added.

A **workspace** is a role's home screen: saved views, the exceptions that role owns, and next actions
(`docs/product/ux-principles.md` §18). Every workspace follows the same skeleton — **Now** (what needs me), **Today**
(the shape of the shift), **Watch** (risks/trends) — so staff who cover for each other find things in the same place.
Frequencies are planning estimates for a ~120-villa resort unless stated, to be validated in user research.

---

### P1 — Front desk agent ("Shifa", resort reception / jetty arrivals)

- **Devices:** desk PC (keyboard-first), tablet for jetty/villa check-in.
- **Top tasks (frequency per shift):** find a reservation (40–80) · prepare arrivals and assign units (15–40) · check
  in incl. payment authorization and access (10–30) · handle requests and log commitments (10–20) · room move (1–5) ·
  extend/shorten stays (1–5) · check out and settle split folios (10–30) · walk-ins (0–3) · handover (1).
- **Pain points (research):** OPERA cannot be learned in one shift and is click-heavy (01 §2.3); Infor needs multiple
  steps for billing, assignment and lookup (01 §4.3); Stayntouch's room diary is "barely usable" (02 §4.4); interrupted
  work without knowing what succeeded (brief §6).
- **Workspace "Front desk":** Now — arrivals in the next 2 h with readiness (unit inspected? payment secured?
  documents? ETA/transfer) and the single blocker per arrival; waiting guests with timers; urgent exceptions. Today —
  arrivals, departures (balances), in-house with alerts; Timeline shortcut. Watch — failed inspections, pending
  verifications, open relocations. Quick actions: search, walk-in, post charge, move.
- **Role template:** Front desk agent (implemented).

### P2 — Night auditor / Day Close operator ("Ravi")

- **Devices:** desk PC; phone for alerts when Day Close is scheduled.
- **Top tasks:** clear Day Close exceptions (nightly, 5–30 items) · run/resume Day Close (1) · late check-ins/walk-ins ·
  cashier close · review day report.
- **Pain points:** OPERA's global logout and halts on exceptions, statistics only after audit (01 §3.1); fear of
  duplicate postings after a crash (brief §10); Mews pushes over/short and late-outlet problems to finance (02 §2.6).
- **Workspace "Day Close":** Now — readiness panel (blocking vs warning, owners); Today — run status with live steps,
  in-house count, arrivals not yet in; Watch — integrity checks, restatements since last close.
- **Role template:** Night auditor (implemented).

### P3 — Reservations agent ("Aishath", central or property reservations office)

- **Devices:** desk PC with phone/headset and email.
- **Top tasks:** quote and book (20–60/day) · modify/cancel with policy (10–30) · agency vouchers and DMC bookings
  (5–20) · tentative options follow-up · waitlist · payment requests.
- **Pain points:** inconsistent results when two agents sell the last unit (brief §17 S01); hidden repricing; Mews
  payment-link vs automation double charges (02 §2.5).
- **Workspace "Reservations":** Now — options expiring today, unpaid deposits due, waitlist matches; Today — new
  bookings, modifications from channels with field-loss reviews; Watch — pickup vs last year, high-demand dates.
- **Role template:** Reservations agent (implemented).

### P4 — Revenue manager ("Marco", resort or group)

- **Devices:** desk PC, large screen.
- **Top tasks:** review pace/pickup (daily) · adjust prices and restrictions in bulk (daily) · review pricing
  recommendations (daily) · channel mix and costs (weekly) · group displacement checks (ad hoc).
- **Pain points:** reporting is the #1 complaint across modern vendors (02 §8 item 4); Apaleo restriction
  non-inheritance surprises (02 §3.7); RMS gating dynamic pricing to top tier (03 §5.6).
- **Workspace "Revenue":** Now — recommendations with assumptions/freshness/uncertainty, distribution discrepancies;
  Today — on-the-books by night, pickup since yesterday; Watch — pace vs last year, cancellations, channel health.
- **Role template:** Revenue manager (implemented).

### P5 — Housekeeping attendant ("Nimal", villas on the beach and the water jetty)

- **Devices:** phone (staff PWA), often offline on jetties; sunlight; one hand busy.
- **Top tasks:** see my route (start of shift) · start/finish units (12–16) · report issues with photo (2–5) · DND /
  discrepancies (1–3) · minibar (resort) · lost & found (occasional).
- **Pain points:** clunky assignment (Mews feedback, 02 §2.6); no clear sync status (brief §8); typing on phones.
- **Workspace "My work" (mobile):** route-ordered unit list with big status buttons, priority tags (early arrival,
  VIP), sync indicator, report-issue button. Nothing else.
- **Role template:** Housekeeping attendant (implemented).

### P6 — Housekeeping supervisor / executive housekeeper ("Fathimath")

- **Devices:** tablet on the floor, PC in the office.
- **Top tasks:** assign today and tomorrow (2×/day) · inspect (20–40) · reprioritize for early arrivals (5–10) ·
  resolve discrepancies and sync conflicts · track progress.
- **Pain points:** forward planning and points balancing missing elsewhere (Stayntouch strengths, 02 §4.3).
- **Workspace "Housekeeping board":** Now — failed inspections, arrivals waiting on units, late tasks; Today — units by
  condition and zone, attendants' progress vs points; Watch — tomorrow's departures/arrivals forecast, DND > 48 h.
- **Role template:** Housekeeping supervisor (implemented).

### P7 — Engineer / maintenance technician ("Ibrahim")

- **Devices:** phone; tablet in workshop.
- **Top tasks:** take and complete work orders (5–15) · set OOO/OOS with dates · preventive tasks · parts notes.
- **Pain points:** taking a unit out of service without knowing affected guests (brief §8); returning units to sale
  before inspection.
- **Workspace "Maintenance":** Now — P1/P2 orders, guest-reported faults; Today — scheduled work by zone; Watch —
  units OOO with expected return, repeat faults per asset.
- **Role template:** Engineering / maintenance (implemented).

### P8 — F&B / outlet cashier ("Sana", main restaurant, bar, in-villa dining)

- **Devices:** POS terminal (integrated) or Portico outlet tablet.
- **Top tasks:** guest lookup and room charge (30–150) · meal-plan entitlement check · corrections · end-of-shift
  balancing.
- **Pain points:** posting to the wrong guest; not knowing what the all-inclusive covers; late charges after checkout
  (brief §17 S10).
- **Workspace "Outlet":** Now — open checks, entitlement status for the seated guest; Today — covers and postings;
  Watch — POS vs Portico balancing differences.
- **Role template:** *Outlet cashier (proposed)*.

### P9 — Spa / activities coordinator ("Lena", spa reception or dive/excursion desk)

- **Devices:** desk PC or tablet at the dive center.
- **Top tasks:** book sessions with resources (10–40) · waivers and eligibility (dive certification) · weather
  cancellations and rebooking · charges or entitlement consumption.
- **Pain points:** separate systems without charge-to-room or shared itinerary (Agilysys strength, 01 §6.2).
- **Workspace "Experiences":** Now — today's sessions with missing waivers, weather flags; Today — resource diary;
  Watch — utilization, cancellations.
- **Role template:** *Activities coordinator (proposed)*.

### P10 — Transfer coordinator (seaplane / speedboat) ("Ahmed")

- **Devices:** desk PC at the airport/resort desk, phone constantly.
- **Top tasks:** collect arrival details (daily for next 3 days) · build and send manifests · track delays and
  communicate · rebook disrupted transfers.
- **Pain points:** delays cascade to check-in, dining and activities without owners (brief §17 S12).
- **Workspace "Transfers":** Now — delays and missing flight details for the next 24 h; Today — departures board by
  mode with manifest status; Watch — weather alerts, capacity tomorrow.
- **Role template:** *Transfer coordinator (proposed)*.

### P11 — Sales & events manager ("Priya")

- **Devices:** laptop, phone.
- **Top tasks:** inquiries → proposals → contracts · block grid maintenance · rooming lists · event orders · cut-off
  follow-ups · weddings with weather alternates.
- **Pain points:** OPERA requires property-specific configuration of block statuses and flows (01 §9 item 6); Mews
  events are basic (02 §2.6).
- **Workspace "Sales & events":** Now — cut-offs in the next 14 days, unsigned contracts, rooming lists overdue; Today —
  pipeline board, function diary; Watch — pickup vs block, attrition risk.
- **Role template:** *Sales & events manager (proposed)*.

### P12 — Finance / AR clerk ("Mohamed", resort accounts)

- **Devices:** desk PC, spreadsheets today.
- **Top tasks:** daily revenue and ledger review · settle and invoice agencies/DMCs · apply bank transfers · aging and
  reminders · cashier variances · payout reconciliation · exports to the accounting system.
- **Pain points:** reports not matching payouts (Guesty, 03 §6.5); Mews fee opacity and netting (02 §2.8); OPERA EOD
  steps producing wrong AR invoices (01 §3.1).
- **Workspace "Finance":** Now — unbalanced items, pending verifications, unmatched bank transfers, disputes with
  deadlines; Today — trial balance status, cashier sessions, invoices to issue; Watch — aging buckets, credit-limit
  breaches, restatements.
- **Role template:** Finance / accounts receivable (implemented).

### P13 — General manager ("Hussain")

- **Devices:** phone during the day, laptop mornings.
- **Top tasks:** morning shape of the day · VIP arrivals and service recovery · approvals (comps, write-offs,
  overbooking) · performance review.
- **Pain points:** cannot move from summary to records (brief §13); unclear what is stale or estimated.
- **Workspace "Property overview":** Now — approvals waiting, critical alerts, guest complaints open; Today — occupancy,
  arrivals/departures, readiness, revenue on the books; Watch — integration health, exceptions by department.
- **Role template:** General manager (implemented).

### P14 — Group / portfolio director ("Sarah", 3-island group or regional office)

- **Devices:** laptop.
- **Top tasks:** central policy changes with previews · consolidated performance · local exception review · rollout of
  connections/properties.
- **Pain points:** OPERA irreversible switches and per-property controls (01 §2.6); Shiji over-centralization
  frustrates local needs (01 §5.6).
- **Workspace "Portfolio":** Now — overrides pending review, properties lagging Day Close, failing connections;
  Today — consolidated KPIs with property comparison; Watch — policy drift, rollout progress.
- **Role template:** *Portfolio director (proposed)*.

### P15 — Guest relations / butler ("Mariyam")

- **Devices:** phone and tablet; moves around the island.
- **Top tasks:** pre-arrival contact and preferences · inbox replies (20–60) · itinerary changes · service recovery ·
  commitments for handover.
- **Pain points:** duplicate/contradictory replies across departments (brief §7); messages saying "done" while the task
  is open (brief §8).
- **Workspace "Guest relations":** Now — unanswered conversations by SLA, open service requests, VIP arrivals; Today —
  itineraries with flags; Watch — sentiment/complaints, repeat-guest arrivals.
- **Role template:** *Guest relations (proposed)*.

### P16 — IT / integration administrator ("Kiran", group IT or external implementer)

- **Devices:** laptop.
- **Top tasks:** user onboarding/offboarding · roles · connection setup journeys · mapping review · credential rotation ·
  data-authority matrix · trial/pilot setup · exports.
- **Pain points:** support-gated developer features (Mews, 02 §2.8); NDA-gated APIs (Agilysys, 01 §6.4); payloads
  instead of plain errors (adoption brief §7).
- **Workspace "Connect & admin":** Now — urgent integration exceptions, expiring credentials, pending mapping reviews;
  Today — connection health, setup journeys in progress; Watch — usage and costs, security log.
- **Role template:** Organization administrator (implemented, narrow it) and *Integration administrator (proposed)*.

### P17 — Guesthouse owner who does everything ("Ali", 12-room guesthouse on a local island)

- **Devices:** phone first (WhatsApp all day), occasionally a laptop; patchy connectivity.
- **Top tasks:** answer booking inquiries and agency messages · take bookings from OTAs/DMCs · check guests in/out ·
  arrange speedboat transfers and excursions · collect cash/cards/bank transfers · tell the cleaner which rooms ·
  invoice DMCs · see if the month is OK.
- **Pain points:** small-property complexity (Mews "many settings can be overwhelming", 02 §2.6); hidden payment costs and
  lock-in (RoomRaccoon, 03 §5.3); fear of OTA overbooking (03 §1); support that disappears after go-live (03 §12).
- **Workspace "Owner today" (mobile-first):** Now — new bookings/messages, arrivals today with transfer and payment
  status, "2 things to settle before today can close"; Today — rooms (occupied/dirty/ready), cleaner progress;
  Watch — this month's occupancy and revenue, unpaid agency invoices. Everything else is one tap into the menu.
- **Role template:** *Owner (all-in-one, proposed)* — combines desk, reservations, housekeeping supervisor, finance and
  admin permissions for one property, with MFA required.

---

## Cross-persona design consequences

1. **Arrival readiness** is shared by P1, P6, P10, P13, P15 — one computed object (reservations + operations + resort +
   payments), shown everywhere identically.
2. **Exceptions** are owned by roles; each workspace's *Now* panel is the role's slice of the common exception shape.
3. **Mobile-first** for P5, P7, P15, P17; **keyboard-first** for P1–P4, P11, P12.
4. **The guesthouse owner** is the acid test for progressive disclosure: every new capability must answer "what does Ali
   see?" — usually nothing until enabled.
5. **Handover** connects P1, P2, P6, P15: commitments and financial exceptions survive shift changes (RES-R37).
