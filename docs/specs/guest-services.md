# Spec: guest-services

Status: Draft v1 · 2026-11-07 · Proposed by the guest-journey audit (`docs/journey/`) · Wave 2 (safety: allergy
propagation, guest list/continuity snapshot) / Wave 3 (arrival preparation, hosts, cases, incidents, venue
reservations, minibar, laundry, luggage) / Wave 4 (dispatch, concierge, loans, parking, visitors, in-room integrations)
· Schema `guest_services` · Prefix `GSV`
Entitlements (proposed, SCR-03): `guestServices.core` (all editions — arrival preparation, amenity orders, cases,
incidents, allergy safety, guest list and muster), `guestServices.venues` (Professional+), `guestServices.inRoom`
(minibar, laundry, wake-up, loans — all editions, hidden by profile until enabled), `guestServices.logistics`
(luggage, dispatch, concierge, parking, visitors — Professional+), `integration.inRoomSystems` (PBX, Wi-Fi, IPTV,
GRMS connectors — add-on).

## 1. Purpose

Most of what a guest remembers happens between check-in and checkout and is delivered by people: the anniversary
cake that arrived, the allergy the chef knew about, the butler who already knew the flight was late, the table that
was ready, the shirt back on time, the bag that reached the villa, the complaint someone owned until it was fixed —
and, on the worst night, a manager who knew exactly who was on the island. `guest-services` gives these services an
owner, a due time, a cost route and an audit trail, using `operations` tasks for the work itself, `finance` for every
charge, and `comms` for every guest message.

## 2. Scope and non-goals

**In scope:** arrival preparation plans, amenity and celebration orders, VIP and pre-arrival lists, guest host/butler
assignment and courtesy contacts, allergy and dietary propagation with acknowledgement, complaints and
service-recovery cases (incl. guest folio queries), incident/security/damage log, medical visits and medevac
coordination records, guest locator, emergency muster and the guest content of the continuity snapshot, dining and
venue reservations, minibar and honour bar, laundry and valet, wake-up calls, equipment loans, luggage and bell desk,
buggy and on-property dispatch, concierge and third-party bookings, parking and valet parking, visitors and day
guests, parcels and long-stay condition reports, and the workflows for telephony, Wi-Fi, IPTV and in-room sensors.

**Non-goals:** task engine, escalation and housekeeping (`operations` — guest-services creates tasks there); POS,
kitchen display and menus (BOH F&B); stock levels and purchasing (BOH); rosters and payroll (BOH workforce); clinical
records (the clinic's own system); activities, spa, transfers and itineraries (`resort`); guest messaging transport
(`comms`); surveys (`crm`).

## 3. Capabilities

### 3.1 Arrival preparation, amenities and celebrations

- **GSV-R01** [MUST] **Arrival preparation plan** per arriving stay (generated at T−n days and refreshed on change):
  structured requests (SCR-10), preferences, occasions, recognition benefits (`crm`), contract entitlements
  (`contracting`, e.g. honeymoon benefits), and accessibility needs become **department tasks** in `operations`
  with due time = planned arrival − lead time (ETA-aware; S12 re-prioritises), owner and checklist; the arrival
  readiness view (RES-R35) shows "preparation 4/5 done" with the open item.
- **GSV-R02** [MUST] **Amenity orders**: catalogue items (welcome fruit, sparkling wine, cake, flowers, bed
  decoration, kids' welcome pack, turndown gift), quantity, delivery window and location (unit, restaurant table,
  sandbank), message card text, **cost route** (`house` amenity budget per department, `guest folio` charge with
  charge code via `finance.postCharge` keyed `amenity:{orderId}`, `partner` per contract benefit, `recognition`
  benefit); fulfilment task with delivery confirmation (photo optional); stock issue request to BOH stock as an
  export/event (boundary).
- **GSV-R03** [SHOULD] **Celebrations and couple ceremonies**: occasion packages combining amenity orders, venue
  reservations, activity sessions (`resort`) and supplier bookings (photographer, celebrant) into one order with one
  owner and a guest-visible plan (portal itinerary); weather alternate for outdoor set-ups.
- **GSV-R04** [MUST] **Lists**: tomorrow's and today's VIP arrivals, celebrations, amenity deliveries by department
  and time, allergy list for kitchens, butler assignments — printable and on mobile, each with freshness label.

### 3.2 Guest hosts (butlers)

- **GSV-R05** [SHOULD] **Host assignment** per stay (or per villa cluster) with primary and covering host per shift;
  assignment feeds `comms` conversation ownership (the host owns the guest's conversation by default) and appears
  on the stay header and in handover; reassignment on shift change is explicit (handover item until accepted).
  Availability and rosters come from BOH workforce (import or manual).
- **GSV-R06** [SHOULD] **Courtesy contacts and orientation**: scheduled contacts (arrival + 2 h call, day-2 check,
  pre-departure) as guest-commitment tasks (OPS-R14) with outcome codes; villa orientation checklist completed on
  the host's phone; negative outcomes open a case (GSV-R08).

### 3.3 Allergy and dietary safety

- **GSV-R07** [MUST] **Allergy propagation with acknowledgement**: an allergy or medically relevant dietary need
  (GUE-R02 sensitive category, captured with consent from booking, portal, check-in or a conversation) creates an
  **allergy alert** for the stay's occupants that (a) appears on the kitchen allergy list for every service period
  in stay, (b) must be **acknowledged** by each F&B outlet's responsible person (chef or outlet manager) before the
  guest's first service there — unacknowledged alerts escalate (OPS-R12) and show on the GM and F&B workspaces,
  (c) is returned by POS guest lookup (W-POS-02, SCR-07) and the outlet posting app (RST-R02) as a non-dismissable
  banner, and (d) is attached to venue reservations and in-villa dining orders. Changes notify every acknowledger
  again. The alert text shown operationally is only what the guest agreed to share (GUE-R02).

### 3.4 Complaints, service recovery, incidents and medical

- **GSV-R08** [MUST] **Case** (proposed glossary term *Service case*): kind `complaint`, `service_recovery`,
  `folio_query` (GXP-R28), `feedback_followup` (from `crm` detractors), `lost_property_claim`; source (desk, phone,
  conversation, portal, survey, review), stay/profile, department(s), severity, owner, due time, status (§4),
  timeline of actions, guest-visible summary where appropriate; cases survive checkout and appear in handover until
  closed (RES-R37).
- **GSV-R09** [MUST] **Compensation** inside a case: actions `folio_adjustment` (through FIN-R10 with reason code
  `service_recovery`), `amenity` (GSV-R02 with house cost route), `complimentary_night` / `upgrade` (through
  reservations previews), `voucher` (`crm`), each within **approval limits** per role (IDN-R15 approvals above
  `guestServices.compensation.limit`); totals per case and per stay visible; service-recovery cost reported by
  department and cause.
- **GSV-R10** [MUST] **Incident log**: kind (`injury`, `illness`, `theft`, `loss`, `damage`, `disturbance`,
  `safety`, `security`, `environmental`, `other`), time and place, persons involved (guests, staff, visitors) with
  roles, witnesses, narrative (append-only entries), photos/files, actions taken, external references (police report
  number, insurer claim, Ministry notification where required — Q86), confidentiality level (restricted by default;
  `guestServices.incident.read` ⚑), links to cases, work orders, door audit trail (ACC-R21) and charges.
- **GSV-R11** [MUST] **Evidence-backed charges** for damage, smoking, missing items, lost keys: charge through
  `finance.postCharge` (key `damage:{incidentId}:{n}`) only from an incident or inspection with evidence attached;
  the guest message and the dispute evidence pack (PAY-R18) reference the evidence.
- **GSV-R12** [SHOULD] **Medical visits and medevac**: a minimal record (date/time, guest, clinic outlet, visit
  reference, chargeable services posted by the clinic outlet, follow-up flags such as "no diving 48 h" shared with
  the dive centre only as an eligibility block, medevac coordination steps with transport and insurer references) —
  **no clinical notes in Portico** (they stay in the clinic's records); records restricted (`guestServices.medical.read`
  ⚑) and retained per Q86/Q44.

### 3.5 Guest locator, muster and continuity

- **GSV-R13** [SHOULD] **Guest locator**: for each in-house occupant, last known status derived from events —
  `on_property` (default), `off_property` (excursion departed/returned from `resort` activity check-in, inter-island
  transfer legs, manual sign-out/sign-in at the jetty or gate), `in_transit` (transfer), `departed`; shown with the
  source and time ("off island since 09:10 — Sandbank trip, boat Dhoni 2"); never presented as GPS tracking.
- **GSV-R14** [SHOULD] **Emergency muster mode** (`guestServices.muster.start` ⚑): snapshot of everyone expected on
  property — occupants (adults/children with ages), special assistance needs, units by location/jetty, plus day
  visitors (GSV-R30) and staff on duty (from BOH workforce import, labelled with its freshness) — assembly points per
  zone; staff mark people accounted for on phones (offline-capable, OPS-R21 sync rules); live counts per point;
  unaccounted list with last known location; end of muster with report (immutable) for the incident log.
- **GSV-R15** [MUST] **Guest content of the continuity snapshot** (rollout §6, RO-09): today's in-house occupants
  per unit with ages, nationalities, special assistance, allergy alerts (operational text only), emergency
  contacts (SCR-21), today's arrivals/departures with transfer times, off-property status — refreshed every 15
  minutes (target) to designated devices, encrypted, timestamped, printable; contains no card data and no document
  numbers.

### 3.6 Dining and venue reservations

- **GSV-R16** [SHOULD] **Venues** (`guestServices.venues`): outlets and bookable spaces (restaurant sections, private
  dining deck, beach, sandbank) with tables (capacity, combinable tables), service periods, slot length and turn
  times per party size, pacing (covers per slot), blackout dates, theme nights, and per-venue rules (adults only,
  dress code, meal-plan eligibility).
- **GSV-R17** [SHOULD] **Reservations**: in-house guests, other-property guests (group), outside guests (city
  hotels; day visitors); party size, children, occasion, table preference, notes; status `requested → confirmed →
  seated → completed | no_show | cancelled`; waitlist and walk-ins; reminder via `comms`; optional deposit or card
  guarantee for special dinners (payments) and no-show fee per policy (posting with key `venue-noshow:{resId}`);
  reservations appear on the guest itinerary through events (RST-R10 consumes them, SCR-33).
- **GSV-R18** [SHOULD] **Meal-plan and allergy awareness**: the booking shows whether the guest's meal plan covers
  the venue/menu (RST-R03 entitlement read), whether a supplement applies (e.g. à la carte venue on half board), and
  allergy alerts (GSV-R07).
- **GSV-R19** [SHOULD] **Special dining** (sandbank dinner, private chef, in-villa set menu): reservation plus required
  resources (boat, chef, waiter, set-up team) via `resort` resources where entitled, weather alternate, and price per
  package; disruption handled by `resort` weather flows (RST-R12).
- **GSV-R20** [LATER] **External table systems** (city hotels that keep one): `tableReservations` workflow (SCR-07)
  mirrors reservations into the itinerary and allergy alerts into the external system; native venues then disabled
  for that outlet (one system of record per outlet).

### 3.7 In-room and personal services

- **GSV-R21** [SHOULD] **Minibar** (`guestServices.inRoom`): catalogue per unit type with par levels and prices
  (charge codes), meal-plan coverage (e.g. all-inclusive soft drinks free, spirits excluded — RAT-R17 lists),
  consumption reported by attendant (OPS-R08 button), minibar team or sensor integration (LATER), posted through
  `finance.postCharge` keyed `minibar:{unitId}:{reportId}:{item}` with allowance coverage; refill task; replenishment
  request to BOH stock.
- **GSV-R22** [SHOULD] **Minibar controls**: departure check task triggered by checkout start or express checkout
  (GXP-R26) with a target time; consumption found after checkout posts as a late charge (FIN-R25) and notifies the
  guest with an explanation; guest disputes become folio-query cases; periodic audits compare par vs found vs posted.
- **GSV-R23** [SHOULD] **Laundry and valet**: order (items from a price list per category — wash, press, dry clean;
  express surcharge; included-laundry allowances from packages), pick-up and delivery tasks with due times, item
  count at pick-up and return (photo optional), status visible to the guest, damage/loss claim as a case with
  compensation; charges posted on delivery (`laundry:{orderId}`); outsourced laundry vendor is BOH.
- **GSV-R24** [MUST] **Wake-up calls**: request (time, unit, guest, language, method `phone_auto | phone_manual |
  knock`), scheduled as a guest commitment (OPS-R14); with a PBX integration the call is placed automatically and the
  result read back; an **unanswered** or failed call escalates to a task "knock on the door" within policy minutes;
  every wake-up has an outcome. Typical use: early seaplane and international departures.
- **GSV-R25** [LATER] **Loans and equipment**: items (towel cards, snorkel sets, bikes, adapters, umbrellas, cots
  in-stay) issued to a stay with due-back time, optional deposit or charge on non-return (posting with evidence),
  returns logged; outstanding loans on the departure checklist (warning).

### 3.8 Logistics and long-stay services

- **GSV-R26** [SHOULD] **Luggage and bell desk**: luggage items per stay (count, tags, weight where a seaplane
  operator requires it — feeds RST-R05 manifests), arrival flow (received at jetty/airport → delivered to unit, with
  timestamps and who), left-luggage storage with claim tickets and storage location, departure collection time
  derived from the departure transfer (`resort`) minus policy lead time, delivered-to-transfer confirmation; missing
  bag → case.
- **GSV-R27** [LATER] **Buggy and on-property dispatch**: requests from guests (portal, phone) and staff with pick-up
  and drop-off points, vehicles and drivers as resources, queue with estimated wait, driver app accept/complete,
  response-time reporting.
- **GSV-R28** [LATER] **Concierge and third-party bookings**: supplier directory (tours, restaurants, car hire,
  photographers, celebrants) with contacts and commission terms; booking records with supplier reference and voucher;
  guest pays supplier directly, through a paid-out (FIN-R38) re-charged to the folio, or through the hotel as merchant
  with supplier payable (BOH AP); commission receivable recorded (SCR-27); itinerary item (external provenance).
- **GSV-R29** [LATER] **Parking and valet** (city hotels, apartments): vehicle (plate, model), space or zone, valet
  ticket number, in/out times, nightly or hourly charges (posting keyed `parking:{stayId}:{night}`), vehicle
  request with ready time; integration with parking systems where present (one system of record).
- **GSV-R30** [LATER] **Visitors and day guests**: visitor log (who, host guest or event, arrival/departure, boat or
  gate, ID seen), day passes sold (day-use inventory INV-R30, SCR-20), included in muster while on property.
- **GSV-R31** [LATER] **Long-stay services** (serviced apartments): parcels and mail log with notification and
  pick-up signature; check-in and check-out **condition reports** (room inventory checklist with photos, signed by
  guest and staff via the portal) that support deposit deductions (SCR-28).

### 3.9 In-room systems (integration workflows)

- **GSV-R32** [LATER] **Telephony** (`integration.inRoomSystems`, workflow `telephony`): on check-in/move/checkout
  open/close the extension, set guest name, language and VIP flag; DND sync; wake-up placement and results (GSV-R24);
  call records → charges posted with key `call:{pbxCallId}`; housekeeping room-status dial codes → `operations`
  (as integration source with CR-6 safe-direction rules). Usually requires the local connector and a legacy interface
  licence (Q62).
- **GSV-R33** [SHOULD] **Wi-Fi**: per-unit or per-stay credentials stored encrypted and shown to the guest (portal,
  welcome card, kiosk) — the P1 path without any integration; with a gateway integration (`wifi` workflow), Portico
  provides stay data for room-number + surname authentication, receives premium-tier purchases as charges
  (`wifi:{gatewayTxnId}`), and ends access at checkout [V-web: common gateway pattern]; gateway outages never block
  check-in.
- **GSV-R34** [LATER] **IPTV and GRMS**: `inRoomSystems` workflows for TV welcome name and language, folio view and
  express checkout request on TV (calls `guest-experience`/`reservations` rules), and in-room sensors (DND, make-up
  room, occupancy) feeding `operations` (OPS-R03) with provenance `external`.

## 4. Entities and states

`prep_plan(stay_id, version, items jsonb, generated_at)` · `amenity_item(id, property_id, name, charge_code?, cost_route
default, content)` · `amenity_order(id, stay_id?, items jsonb, deliver_at, location, cost_route, posting_ref?, task_ref,
status)` · `host_assignment(stay_id, host_user_id, role primary|cover, from, to)` · `allergy_alert(id, stay_id,
occupant_ref, text_operational, source, version, status)` · `allergy_ack(alert_id, alert_version, outlet_id, user_id,
acked_at)` · `case(id, property_id, kind, stay_id?, profile_id?, departments, severity, owner_id, due_at, status,
version)` · `case_action(case_id, kind, payload jsonb, approval_ref?, posting_ref?, at, by)` · `incident(id, property_id,
kind, occurred_at, location, confidentiality, status, version)` · `incident_entry(incident_id, at, by, text, files[])`
(append-only) · `incident_party(incident_id, party_ref, role)` · `medical_visit(id, stay_id, occupant_ref, at,
clinic_outlet_id, visit_ref, flags jsonb)` · `locator_status(occupant_ref, status, source_ref, at)` ·
`muster(id, started_at, started_by, scope, status)` · `muster_mark(muster_id, person_ref, point, by, at)` ·
`venue(id, outlet_id, rules jsonb)` · `venue_table(id, venue_id, capacity, combinable_with[])` ·
`venue_reservation(id, venue_id, stay_id?, guest_ref, party jsonb, starts_at, table_ids[], status, guarantee_ref?,
version)` · `minibar_catalog(unit_type_id, items jsonb)` · `minibar_report(id, unit_id, stay_id?, items jsonb,
reported_by, at, posting_refs[])` · `laundry_order(id, stay_id, items jsonb, express, status, posting_ref?)` ·
`wakeup(id, stay_id, at_local, method, status, attempts)` · `loan(id, stay_id, item, due_back, status)` ·
`luggage_item(id, stay_id, tag, weight?, status, location)` · `dispatch_request(id, from, to, status, vehicle?, driver?)` ·
`concierge_booking(id, stay_id, supplier_id, ref, commission jsonb, status)` · `vehicle_record(id, stay_id, plate,
ticket, status)` · `visitor(id, host_ref, in_at, out_at?)` · `parcel(id, stay_id, carrier, status)` ·
`condition_report(id, stay_id, kind in|out, items jsonb, photos[], signed_by_guest_ref?)`.

**Case:** `open → in_progress → awaiting_guest → resolved → closed` · `resolved → in_progress` (reopened with reason) ·
`open|in_progress → cancelled` (reason). **Incident:** `reported → investigating → actions_taken → closed` (closed
entries remain append-only; reopening adds an entry). **Amenity order:** `requested → confirmed → in_preparation →
delivered | failed | cancelled`. **Allergy alert:** `active (version n) → acknowledged_by_all → active (version n+1 on
change)` · `active → ended` (stay departed). **Venue reservation:** see GSV-R17. **Wake-up:** `scheduled → placed →
answered | unanswered → escalated → done`. **Muster:** `active → closed`. **Luggage item:** `expected → received →
delivered | stored → collected → loaded`.

## 5. Invariants

- **GSV-I01** A guest with an active allergy alert never has a venue reservation, in-villa order or outlet lookup
  without the alert attached; an outlet serving the guest without acknowledgement of the current version is an open
  escalated exception.
- **GSV-I02** Every compensation action above the role's limit has an approval record; every monetary compensation
  is a finance posting (never a silent price change).
- **GSV-I03** Incident entries and muster reports are append-only.
- **GSV-I04** Every chargeable service posts at most once per idempotency key (`amenity:`, `minibar:`, `laundry:`,
  `damage:`, `call:`, `wifi:`, `parking:`, `venue-noshow:`).
- **GSV-I05** The continuity snapshot never contains card data, document numbers or clinical notes.
- **GSV-I06** A wake-up call always ends in `answered`, `done` (after escalation) or a recorded cancellation — never
  silently missed.

## 6. Cross-module interactions

Calls `operations` (`createTask`, task status — work execution), `finance` (`postCharge`, adjustments via cases),
`reservations` (read stays, previews for compensation upgrades/nights), `guests` (alerts, sensitive data with
permission, emergency contacts), `comms` (guest messages, owner of conversations), `payments` (guarantees/deposits for
venues and loans), `inventory` (units, locations), `integration` (PBX, Wi-Fi, IPTV, GRMS, table systems, POS alerts),
`platform`. Consumes events from `resort` (transfers, activity check-ins, weather), `reservations`, `crm` (detractor
responses), `access` (lost keys), `guest-experience` (requests, folio queries). No synchronous calls to `resort`
(itinerary consumes this module's events instead — no cycle).

### Proposed contract changes (SCR-01)

Module row `guest-services` (schema `guest_services`); arrows `guest-services ─► operations, finance, reservations,
guests, comms, payments, inventory, integration, platform`; `guest-experience ─► guest-services`;
`crm ─► guest-services` (create cases, amenity orders). Exposes `createCase`, `createAmenityOrder`,
`getAllergyAlerts(tx, { stayId })` (used by POS lookup and outlet app), `listExceptions` (common shape).

## 7. Events

Emitted: `guestServices.prep.itemOverdue`, `guestServices.amenity.delivered`, `guestServices.allergy.changed|
unacknowledged`, `guestServices.case.opened|resolved`, `guestServices.incident.reported`, `guestServices.muster.started|
closed`, `guestServices.venueReservation.booked|changed|cancelled`, `guestServices.minibar.posted`,
`guestServices.wakeup.unanswered`, `guestServices.luggage.delivered`. Consumed: `reservations.booking.confirmed|
modified|cancelled`, `reservations.stay.checkedIn|checkedOut|moved`, `resort.transfer.*`, `resort.activity.*`,
`resort.session.cancelledWeather`, `crm.survey.responded`, `access.credential.lost`, `guestExperience.folioQuery.raised`.

## 8. Permissions

`guestServices.prep.manage` · `guestServices.amenity.order` · `guestServices.amenity.catalog.manage` ·
`guestServices.host.assign` · `guestServices.allergy.acknowledge` · `guestServices.case.manage` ·
`guestServices.compensation.grant` (within limits; above → approval) · `guestServices.incident.report` ·
`guestServices.incident.read` ⚑ · `guestServices.medical.read` ⚑ · `guestServices.muster.start` ⚑ ·
`guestServices.locator.read` · `guestServices.venue.manage` · `guestServices.venueReservation.manage` ·
`guestServices.minibar.post` · `guestServices.laundry.manage` · `guestServices.wakeup.manage` ·
`guestServices.logistics.manage` · `guestServices.concierge.manage` · `guestServices.config.manage` ⚑.

## 9. UX surfaces

Guest-relations workspace (persona P15): arrivals with preparation progress, VIP/celebration board, open cases by
SLA, host assignments. Kitchen and outlet allergy board with acknowledge buttons (tablet). Case record (timeline,
compensation, approvals). Incident form (mobile, camera-first) and restricted incident register. Muster mode (big
counters, assembly points, unaccounted list, works offline). Venue diary (tables × time). Minibar/laundry/luggage
quick actions on the staff PWA. Guesthouse profile: amenity orders, cases and the guest list only — everything else
hidden until enabled.

## 10. Proof scenarios and evidence

| ID | Guest services must demonstrate |
|---|---|
| S07 (supporting) | Re-assignment after a failed inspection moves the anniversary decoration order to the new villa with a fresh due time. |
| S12 (supporting) | Seaplane delay re-times amenity deliveries and the venue reservation; host informed; one guest message. |
| S10 (supporting) | Minibar consumption found after checkout posts as a late charge exactly once, with guest notification. |
| S13 (supporting) | Muster marks and minibar reports made offline sync without duplicates. |
| E14 (supporting) | AI and message caps reached: allergy acknowledgements, muster and cases keep working. |
| J10 (proposed, SCR-06) | Peanut allergy added via WhatsApp the day before arrival: alert reaches 4 outlets, 3 acknowledge, the 4th escalates to the F&B manager before dinner; POS lookup shows the banner. |
| J11 (proposed) | Tsunami warning muster at 02:00 during a partial outage: snapshot opened offline, 214 occupants incl. 31 children, 6 guests on an overnight sandbank camp shown off-island, all accounted for; report attached to the incident. |
| J12 (proposed) | Complaint about a noisy generator: case with engineering task, compensation of one dinner above the butler's limit approved by the duty manager, follow-up after departure, linked survey response. |

## 11. Maldives specifics

Allergy safety matters more on islands with limited emergency medical capacity and medevac by seaplane or speedboat
[DK]; resorts use butlers/hosts per villa [DK]; guests leave the island for sandbank picnics, excursions and
local-island visits, so the locator must know who is off-island; tsunami, storm and fire drills need a muster list
that works without connectivity; seaplane baggage weight and early departures make luggage and wake-up services
part of transfer logistics; clinics and laundries are often run by third parties (BOH concessions); dive restrictions
after medical visits must reach the dive centre as an eligibility block (resort SCR-36). Ministry notification
duties for incidents and record retention are unconfirmed (Q86).

## 12. Competitive inspirations

- Itinerary-centred resort operations and charge-to-room across amenities — Agilysys (research 01 §6.2).
- Full tasks on mobile including concierge and lost & found — Infor HMS iPad app (research 01 §4).
- Requests that are "done" only when the task is done — owner brief §8; OPS-R13 pattern extended to every service.
- Improvement: allergy alerts with per-outlet acknowledgement and escalation, and a muster list that is part of the
  product rather than a printout.

## 13. Open questions

Q86 (incident, medical and security records: scope, legal duties, retention), Q44 (retention), Q62 (PBX/Wi-Fi
local interfaces and licences), Q85 (flight data, indirectly for luggage/transfer timing). Product decisions: no
clinical notes in Portico; allergy acknowledgement required before first service by default; compensation limits per
role as policy.

## 14. Adoption modes

- **Standalone alongside an external PMS:** **yes** for arrival preparation, amenity orders, hosts, cases, incidents,
  allergy safety, locator/muster, venue reservations, laundry, luggage and dispatch (a natural extension of the
  housekeeping/messaging packs SM-01/SM-03/SM-04); charges are **forwarded** to the PMS folio (`charges` external +
  forward, idempotent keys above) and shown pending until acknowledged.
- **Hard dependencies:** `platform`, `identity`, `operations` (tasks), `reservations` mirror (arrivals, in-house,
  moves, checkouts — receive changes required for allergy alerts and muster accuracy), `guests` mirror;
  `finance`/`integration` for charges.
- **Connected mode:** muster and the snapshot show the mirror's freshness ("in-house list as of 01:52 from
  <PMS>"); when the mirror is `delayed` beyond 15 minutes the muster screen says so in red text, not only colour.
- **Data-authority domains:** owns none of the nine; respects `charges`, `reservations`, `guestProfiles`; owns its
  cases, incidents, orders and venue reservations (venue system of record per outlet when an external table system is
  connected).
- **Trial:** all services usable on copied stays; no charges forwarded, no guest messages sent; muster can be
  rehearsed as a drill.
