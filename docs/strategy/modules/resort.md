# resort — 10x brief (transfers, activities, meal plans, itinerary, disruptions)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 3a; resort-pilot critical) · Spec `docs/specs/resort.md`
(RST-R01–R14) · Parity: **none** (planned on `docs/parity-ops`) · Related: `modules/fnb-pos.md`,
`modules/guest-services.md`, `modules/concessions.md` · Source key: `docs/strategy/gap-plan.md` §0. **All targets are
TARGETS until validated with resort staff.**

## 1. Current state (evidence)

- **No `resort` module exists.** Building blocks: reservations' arrival details (transport mode, flight, vessel,
  scheduled → estimated ETA) and arrival readiness with a transfer check (README-reservations RES-R39; UX1 top-10 #10
  praises the Maldives-aware arrival detail); rates' meal plans, allowances and packages (RAT-R13–R17); finance allowance
  consumption, breakage and outlet attribution (FIN-R18–R20); platform outlets with kinds incl. dive centre, water sports,
  excursions, transfer desk (identity-plus branch).
- **Scenario S12** (transfer delay affects check-in, dining and an activity) has no test; reservations' P0 edge cases
  for seaplanes and weather are missing (EC-RES-002–004).
- **UX1 persona 2:** the delayed seaplane is visible but not manageable — no ETA update, no notification of F&B/spa/butler,
  no rebooking, no "overnight in Malé"; transport labels contradict; check-in enabled for a guest in the air.

## 2. Best on the market today

| Area | Who | How | Source |
|---|---|---|---|
| Connected resort | Agilysys | PMS + POS + spa/golf/activities on one itinerary and one confirmation; guest-bookable package entitlements; charge-to-room everywhere | R01 §6.2 |
| Leisure inside the PMS | OPERA 26.4 Leisure Management | Spa, kids' activities, rentals, tours, cabanas, classes with locations, resources, pricing, schedules + LMS APIs — included for OPERA resorts | DD02a §1.2; DG #13 |
| Resort stack in the Maldives | Cinnamon (OPERA Cloud + Simphony), Minor (OPERA Cloud) | PMS + POS bought as a pair | DD09 §3 |
| Age-banded packages | OPERA 26.4 | Price by age category for packages (meal plans for adults/children/infants) | DD02a §1.2 |

Research recommendation: Portico's itinerary must be **better than OPERA's scheduling** — capacity, waivers and
disruption cascades (DG §2 resort row).

## 3. Gaps vs market (ranked)

| # | Gap | Spec / scenario |
|---|---|---|
| 1 | Transfers with arrival details, manifests per departure (passengers, weights, baggage), capacity | RST-R04, R05 |
| 2 | Disruption cascade: ETA change ripples to check-in window, dining, activities, butler with owners and one-tap rebooking; overnight-in-Malé path | RST-R06; S12; EC-RES-002–004 |
| 3 | Meal-plan entitlement consumption at outlets (with fnb-pos), exclusions, overuse payable | RST-R03; FIN-R18–R20 |
| 4 | Outlet posting app (quick post) and POS intake with balancing | RST-R01, R02 (with fnb-pos) |
| 5 | Activities with resources, capacity, staff, equipment, waivers and eligibility | RST-R07, R08 |
| 6 | Itinerary per stay/party | RST-R10 |
| 7 | Weather disruption: cancellations, rebooking, refunds/credits per agreed policy | RST-R12, R13 |
| 8 | Dining reservations as outlet sessions with table capacity | RST-R09 (with guest-services venues) |
| 9 | Guest-visible itinerary and entitlement balances | RST-R11 (with guest-experience) |

## 4. The 10x outcome (TARGETS)

**Picture:** a seaplane is delayed three hours; one action updates the ETA for its 14 passengers, moves their check-in
window, offers new dinner times and re-slots the sunset dive (or offers a credit per policy), and every affected
department sees its new task with an owner within two minutes — while the bar posts a half-board guest's drinks against
the right entitlement in under 20 seconds.

| Dimension | Metric | Market reference | Target |
|---|---|---|---|
| Powerful | S12 end to end (transfer → check-in → dining → activity) | OPERA Leisure Mgmt schedules without disruption cascade (assumption — verify) | green through `apps/api` |
| Seamless | Re-plan everything affected by one transfer delay | manual across systems (UX1; assumption) | 1 previewed action; departments notified ≤ 2 min |
| Seamless | Post an outlet charge with entitlement applied | baseline to measure | ≤ 20 s, ≤ 1 error / 50 (UXP §19) |
| Friendly | Itinerary items without an owner after a disruption | — | 0 |
| Well-rounded | Activities with capacity/waiver/eligibility checks enforced | — | 100% of bookable activities |
| Well-rounded | Charges with the wrong entitlement or tax sector | — | 0 in the scenario suite |

## 5. Next 3 increments

### Increment 1 — Transfers, manifests and the disruption cascade
- Transfer aggregate (mode, legs, schedule, vessel/seaplane, capacity), manifests per departure with weights and baggage,
  ETA changes as events; itinerary skeleton per stay; disruption command producing a previewed re-plan across
  check-in readiness (reservations), dining and activity holds, with owners and notifications (simulated until comms).
- **Acceptance:** S12 through `apps/api`; EC-RES-002, 003, 004 tested jointly with reservations increment 3; check-in
  guard when the guest is still in transit.

### Increment 2 — Meal plans and outlet posting
- Entitlement consumption API used by the outlet posting app and POS intake (with fnb-pos and finance): plan coverage,
  exclusions, overuse payable, tax sector per outlet; quick-post app for outlets without a POS.
- **Acceptance:** RST-R01–R03 tested; S19 extended to outlet postings against allowances; EC-FIN-049 (dinner at 00:30
  against a per-night allowance) tested with finance.

### Increment 3 — Activities and weather
- Activity catalogue with resources (boats, guides, equipment), capacity, waivers and eligibility; bookings per
  participant linked to the itinerary; weather disruption with policy-driven rebooking or refunds/credits.
- **Acceptance:** RST-R07, R08, R12, R13 tested; resource double-booking impossible under concurrency.

## 6. Cross-module dependencies and contract changes

**reservations:** arrival-details events with versions, disruption commands, check-in guard. **rates/finance:**
entitlements, allowance consumption, refunds/credits. **fnb-pos:** POS intake and posting privileges. **guest-services:**
venues, special dining, allergies. **operations:** tasks for butlers and resources. **comms:** guest and staff
notifications. **concessions:** activities run by partners. **guest-experience:** guest itinerary. **integration:**
flight-status data (Q85) and external activity systems.

## 7. Power check — never lose or hide

A disruption never silently cancels a booking — every change is previewed with owners; entitlements are consumed exactly
once; refunds follow agreed terms; capacity and waivers are enforced, never assumed; transfer status is never shown as
"arrived" without confirmation.
