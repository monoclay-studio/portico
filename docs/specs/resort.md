# Spec: resort

Status: Draft v1 · 2026-11-07 · Wave 3 · Schema `resort` · Prefix `RST`
Entitlements: `resort.transfers`, `resort.activities`, `resort.itinerary`, `resort.mealPlans`, `resort.outlets`,
`resort.weatherDisruptions` (Resort, Enterprise; transfers/activities as add-ons for Essentials/Professional with
`resort.itinerary` implied); `integration.pos` (Professional+).

## 1. Purpose

Connect everything a resort guest experiences — the seaplane, the villa, breakfast entitlements, the sunset dive,
the couples massage — to one itinerary and one financial record, so a three-hour transfer delay ripples visibly to
check-in, dinner and the activity with owners and one-tap rebooking, and so every outlet charge lands on the right
bill with the right allowance applied.

## 2. Scope and non-goals

**In scope:** outlet charge intake (POS) and resort outlet posting, meal-plan entitlement consumption, transfers
(legs, operators, schedules, manifests, capacity, disruptions), activities and spa sessions (capacity, resources,
staff, eligibility, waivers), dining reservations (as outlet sessions), itineraries (guest, booking, family/group),
weather disruptions with rebook/refund policies, operational requisitions boundary.
**Non-goals:** full POS (integrate; Portico offers a lightweight outlet posting app only), spa management depth of
specialist systems (integrate where present), procurement/stock (integrate; RST-R14 defines the boundary), airline/
seaplane operator systems (Portico records bookings and confirmations; operators are external parties).

## 3. Capabilities

### 3.1 Outlets and meal plans

- **RST-R01** [MUST] **POS intake** (`integration.pos`): guest lookup (by unit, name, booking code; returns only
  in-house/eligible stays with room-charge permission and credit status), charge posting via `finance.postCharge`
  with outlet attribution, line items, taxes as computed by Portico (or verified provided taxes), tips/service charge,
  corrections as linked adjustments; idempotency `pos:{outletId}:{checkId}:{lineId}`; daily outlet balancing report
  (POS totals vs postings) with differences as exceptions.
- **RST-R02** [MUST] **Resort outlet posting app** (`resort.outlets`): tablet/phone flow for outlets without an
  integrated POS: find guest (unit + name + photo where consented), choose items/charge codes, apply entitlement or
  allowance automatically, capture signature, post; works offline-tolerant with queued posts (sync rules as OPS-R21).
- **RST-R03** [MUST] **Meal-plan consumption** (`resort.mealPlans`): per occupant per day entitlements derived from the
  stay's agreed inclusions (breakfast/lunch/dinner, beverage tiers, exclusions list); outlet staff see "covered /
  partially covered / not covered" before posting; consumption recorded per occupant/meal; over-entitlement items
  charged; dine-around at sister properties LATER (inter-property settlement).

### 3.2 Transfers

- **RST-R04** [MUST] Transfer (`resort.transfers`): leg(s) with mode (`seaplane`, `domestic_flight`, `speedboat`,
  `car`, `other`), operator, scheduled/estimated departure and arrival, origin/destination, linked stays and
  occupants, passenger details required by the operator (names as in passport, weights/baggage when the operator
  requires), status (§4), charge (inclusion or chargeable per person/leg), confirmation reference from the operator.
- **RST-R05** [MUST] **Manifests** per departure: passengers, capacity per vessel/flight, baggage, special assistance;
  export/send to operator; changes after sending tracked as manifest versions.
- **RST-R06** [MUST] **Disruptions** (S12): a delay/cancellation updates estimated times, then evaluates dependent
  itinerary items (check-in window, unit readiness priority, dining reservation, activity session, departure
  checkout time) and creates **flags with owners and suggested actions** (rebook, shift, refund per policy); guest
  notification via comms (one message summarizing all changes, not one per item).

### 3.3 Activities, spa, dining

- **RST-R07** [MUST] Activity (`resort.activities`): kind (excursion, dive, snorkel, spa treatment, fitness, kids club,
  dining session), sessions with times, capacity, required **resources** (boat, guide, therapist, treatment room,
  equipment sizes) and staff qualifications, eligibility rules (age, certification such as dive level, health
  declaration), waivers (versioned text, e-signature per participant), price and policies (cancellation, weather).
- **RST-R08** [MUST] Bookings per participant linked to stay/itinerary; resource conflicts prevented (no double booking
  of a therapist or boat); waitlist; charges to folio via finance or consumption of package allowances/entitlements.
- **RST-R09** [SHOULD] Dining reservations as outlet sessions with table capacity by time slot and meal-plan
  awareness.

### 3.4 Itinerary

- **RST-R10** [MUST] Itinerary (`resort.itinerary`): one timeline per stay/booking combining arrival/departure
  transfers, stay events (check-in window, late checkout), dining, activities, spa, events (groups); family/group
  coordination links itineraries (e.g. children's activities vs parents' dinner); each item shows status and provenance
  (confirmed by operator vs requested).
- **RST-R11** [SHOULD] Guest-visible itinerary and entitlement balances in the guest portal (later app wave).

### 3.5 Weather and requisitions

- **RST-R12** [MUST] Weather disruption (`resort.weatherDisruptions`): staff declare a disruption (area, time window,
  activity kinds, transfer modes); affected sessions/transfers listed; bulk actions (cancel with policy refund, move
  to alternate session, waive fees) as one previewed change with per-guest effects and communications.
- **RST-R13** [MUST] Refunds/credits from weather cancellations follow agreed policy: folio adjustment or payments
  refund (never deletion of the original charge).
- **RST-R14** [LATER] Operational requisitions (e.g. outlet stock requests) as tasks with an export to the property's
  procurement system — boundary: Portico does not manage stock levels or purchase orders (brief §12).

## 4. Entities and states

`outlet_check(id, outlet_id, external_ref?, stay_id, lines jsonb, status)` · `entitlement_use(stay_id, occupant_ref,
date, meal, outlet_id, posting_id?)` · `transfer(id, property_id, booking_id?, legs jsonb, status, version)` ·
`manifest(id, departure_ref, passengers jsonb, version, sent_at?)` · `activity(id, kind, rules jsonb)` · `session(id,
activity_id, starts_at, ends_at, capacity, resources jsonb, status)` · `activity_booking(id, session_id, stay_id,
participants jsonb, waiver_refs, status, charge_ref?)` · `resource(id, kind, capacity, qualifications[])` ·
`itinerary_item(id, stay_id, kind, ref, starts_at, ends_at, status, flags jsonb)` · `disruption(id, kind, scope jsonb,
window, status)`.

**Transfer:** `requested → confirmed (operator ref) → manifested → departed → arrived` · `requested|confirmed|
manifested → delayed → departed` · any non-terminal → `cancelled` · `delayed → rebooked` (new transfer linked).
**Activity booking:** `requested → confirmed → checked_in → completed` · `requested|confirmed → cancelled | no_show` ·
`confirmed → moved` (new booking linked). **Session:** `scheduled → full → in_progress → completed` · `scheduled|full
→ cancelled_weather | cancelled`. **Disruption:** `declared → actions_previewed → applied → closed`.

## 5. Invariants

- **RST-I01** A resource is never booked into overlapping sessions beyond its capacity.
- **RST-I02** A POS check line posts at most once (idempotency key); outlet balancing differences are open exceptions.
- **RST-I03** Entitlement consumption per occupant/day/meal never exceeds the entitlement; overflow is charged.
- **RST-I04** A disruption's applied actions are reproducible from its preview (no unpreviewed side effects).
- **RST-I05** Manifest versions are append-only; the operator-sent version is identifiable.

## 6. Cross-module interactions

Calls `reservations` (stays, ETAs, arrival details), `finance` (postCharge, allowances, adjustments), `guests`,
`operations` (unit readiness priority, tasks), `comms` (guest updates), `payments` (refunds), `rates` (activity and
transfer pricing via tax engine, package entitlements), `integration` (POS, operators' systems where available).
Domain map arrow: `resort ─► reservations, finance, guests, operations`.

## 7. Events

`resort.transfer.delayed|cancelled|arrived`, `resort.itinerary.flagged`, `resort.activity.booked|cancelled`,
`resort.session.cancelledWeather`, `resort.posCheck.posted`. Consumed: reservations stay events (ETA changes,
check-in/out), `operations.unit.conditionChanged`, `finance.posting.created`.

## 8. Permissions

`resort.transfer.read` · `resort.transfer.manage` · `resort.manifest.send` · `resort.activity.manage` ·
`resort.booking.manage` · `resort.waiver.collect` · `resort.outlet.post` · `resort.outlet.correct` ⚑ ·
`resort.disruption.declare` ⚑ · `resort.itinerary.read`.

## 9. UX surfaces

Transfer board (today's arrivals/departures by mode, delays highlighted, manifest status), manifest editor, activity
diary with resource lanes, outlet posting app, itinerary timeline on the stay record and in the guest relations
workspace, disruption wizard with preview.

## 10. Proof scenarios and evidence

| ID | Resort must demonstrate |
|---|---|
| S12 | Seaplane delayed 3 h: arrival ETA updated, unit readiness reprioritized, dinner reservation and sunset dive flagged with owners; one guest message; rebooking previewed and applied; charges/refunds per policy. |
| S10 | Restaurant (POS) charge after checkout posts to the departed stay per finance late-charge rules; POS idempotency prevents duplicates on retry. |
| S19 | Half-board entitlement consumption, dining allowance usage and over-entitlement charges reconcile on the folio. |

## 11. Maldives specifics

Seaplane transfers (daylight-dependent operations, weight/baggage limits — verify per operator), domestic flights +
speedboat, and speedboat transfers from Malé for guesthouses; transfers are often included per person in packages.
Weather (monsoon seasons) affects excursions, sandbank trips, dives and seaplanes. Dive centers and spas are often
concessions run by third parties (integration or outlet posting with commission). All-inclusive tiers with beverage
exclusions are common. Guesthouses sell excursions (snorkeling, sandbank, fishing) — hence the add-on.

## 12. Competitive inspirations

Agilysys itinerary with one confirmation and card, guest-bookable package entitlements (S.P.E.N.D.), charge-to-room
across spa/golf/dining (research 01 §6.2); Infor post-departure room charges without desk intervention (research 01
§4.2); OPERA package allowances and P&L (research 01 §3.8); integrate best-of-breed spa/POS rather than build them
(research 01 §9 item 15).

## 13. Open questions

None for the owner. Operator/integration access for seaplane and transfer companies is tracked in the dependency
register.

## 14. Adoption modes

- **Standalone alongside an external PMS:** **yes** — transfers, activities/spa, itinerary and outlet posting can run
  alongside an external PMS ("replace selected capabilities").
- **Hard dependencies:** `platform`, `identity`, `guests` (mirror), `reservations` mirror (stays, arrival details) via a
  PMS connector; `finance` only when `charges` is Portico-authoritative.
- **Connected mode:** charges (activities, transfers, outlet posts) call `assertWritable(charges)` and are
  **forwarded** to the PMS folio (`posCharges` workflow) — pending until acknowledged; meal-plan entitlements derive
  from mirrored rate/package codes via mapping (or are `incomplete` if the PMS does not expose them).
- **Data-authority domains:** respects `charges`, `reservations`, `guestProfiles`; owns transfer, activity and
  itinerary data (no governed domain).
- **Trial:** simulated operator confirmations and manifests; nothing sent to operators.
