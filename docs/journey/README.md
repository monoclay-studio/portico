# Guest-journey audit

Status: v1 complete · 2026-11-07 · branch `docs/guest-journey-audit`.

The owner noticed that door locks and key cards had no module and asked for everything else we missed: "go through
an entire guest stay. Portico needs to solve all of a hotel's problems from pre-reservation to reservation to
check-out and follow up." This folder is that audit, done for five property types — a 12-room guesthouse on an
inhabited island, a 120-villa resort with seaplane transfers, a city hotel, serviced apartments and a multi-property
group. Back-of-house (accounting/GL/AP, F&B POS and kitchen, procurement, stock, workforce, utilities, concessions)
is audited separately; this audit names the hand-off points only.

## What is here

| File | What it is |
|---|---|
| [guest-journey-coverage.md](guest-journey-coverage.md) | 235 touchpoints in seven stages (discover → book → pre-arrival → arrival → in-stay → departure → post-stay): who, systems, Portico module and requirement ids, coverage status, external dependency, Maldives specifics, property types, pilot priority. Includes the verified facts used (IMUGA, visa on arrival, seaplane daylight operations, diving limits, lock-vendor integration models, Wi-Fi gateway pattern, WhatsApp pricing) with sources dated 2026-11-07. |
| [gap-register.md](gap-register.md) | 62 gaps (JG-01…JG-62): owner module, build / integrate / both, priority, dependencies, where specified, back-of-house hand-offs. |
| [spec-change-requests.md](spec-change-requests.md) | SCR-01…SCR-46: proposed changes to existing specs and documents (domain map, glossary, editions, platform effects, source-of-truth rules, scenarios J01–J12, reservations, rates, inventory, guests, finance, payments, comms, operations, resort, distribution, groups, day-close, analytics, ai, identity, readiness, parity). |
| [../specs/access.md](../specs/access.md) | **New module `access`** — keys of every kind bound to the stay, lock systems via cloud API or local connector, manual key log, honest end-of-stay ("expires at", "collect"), `access.key` safety, audit. |
| [../specs/guest-experience.md](../specs/guest-experience.md) | **New module `guest-experience`** — app-less guest portal (pre-arrival, manage booking, online check-in with ID and e-signature, upsells, itinerary, requests, folio, express checkout, post-stay) and kiosk/assisted modes. |
| [../specs/crm-marketing.md](../specs/crm-marketing.md) | **New module `crm`** — segments and consent-gated campaigns, journeys, abandoned bookings, surveys/NPS with recovery, reputation (aggregation and replies), review solicitation, recognition, gift vouchers, external CRM. |
| [../specs/contracting.md](../specs/contracting.md) | **New module `contracting`** — tour-operator/DMC/wholesale contracts, seasons, markets, supplements, combinable offers, allotments and release, stop-sale notices, voucher intake with contract check, statements. |
| [../specs/guest-services.md](../specs/guest-services.md) | **New module `guest-services`** — arrival preparation and amenities, butlers, allergy propagation with acknowledgement, cases and service recovery, incidents and medical, guest locator and muster, dining/venue reservations, minibar, laundry, wake-up, luggage, dispatch, concierge, parking, visitors, PBX/Wi-Fi/IPTV/GRMS workflows. |

## The headline

- **Nothing in the guest journey is built yet** (only the `platform` and `identity` foundations exist). Of 235
  touchpoints, 33% were specified, 27% partial, 4% planned, 2% deliberately integration-only or back-of-house, and
  **34% missing**.
- The existing specs are deep where the owner's brief was explicit (reservations, finance, payments, housekeeping,
  distribution, transfers and activities). The misses cluster in five places: **access** (keys, Wi-Fi, PBX),
  **the guest's own surface** (portal, online check-in, upsells, e-folio, kiosk), **commercial contracting** with tour
  operators, **service delivery around the stay** (amenities, butlers, allergies, dining reservations, minibar,
  laundry, luggage, incidents, muster), and **everything after the stay** (surveys, reviews, marketing, recognition,
  vouchers).
- Seven Maldives realities had no home: the booking confirmation needed for visa on arrival, IMUGA guidance, the
  seaplane daylight cut-off and transit nights, the Green Tax 12-hour check-out block, the 3-day tax-invoice
  deadline, nationality capture for TIMS, and the 30 m diving limit.

## Top 25 gaps, ranked

Ranked by impact on a **Maldives pilot** (a guesthouse first per Q26's default, a resort soon after) and on the
vision — *a hotel operating system you can trust at 2 a.m. and adopt without a leap of faith*. Trust items (safety,
money, law) rank above experience items; within a band, the gap that hurts more properties ranks higher.
[A] marks a planning assumption to confirm in discovery (Q64).

| # | Gap | Why it ranks here | Pri | Where |
|---|---|---|---|---|
| 1 | **JG-02 Tour-operator/DMC contracting** | Most resort room nights (and many guesthouse bookings via Malé DMCs) are priced from contracts [A]; without contracts, offers, allotments and an automatic voucher check, the price of most bookings is hand-computed — the opposite of "money is exact". Also a strong trial proof: Portico finds mismatches the hotel did not know about. | P0 | contracting.md |
| 2 | **JG-01 Keys and access** | Check-in cannot complete truthfully without a key step; a card still valid after checkout is a security failure. The manual key log, room-move and checkout rules are pilot-critical even before any lock integration. | P0 | access.md |
| 3 | **JG-10 Muster, guest locator, continuity snapshot** | The literal 2 a.m. test: who is on the island, who is on the sandbank camp, which children, which special needs — offline. | P0 | guest-services.md §3.5 |
| 4 | **JG-11 Allergy propagation with acknowledgement** | Life safety; today an allergy can sit in a booking note no chef reads. | P0 | guest-services.md §3.3 |
| 5 | **JG-08 Tax invoice within 3 days + delivery** | Legal obligation (MIRA); issuance existed but not the deadline or getting the invoice to the guest. | P0 | SCR-24, SCR-41 |
| 6 | **JG-09 Charge privileges and credit limits** | Resort room-charging across outlets without no-post flags or limits is uncontrolled credit risk. | P0 | SCR-23 |
| 7 | **JG-12 Green Tax day block and tax-relevant ages** | Late checkout or day use can add a Green Tax day; under-2s are exempt — tax correctness depends on actual times and verified ages. | P0 | SCR-13, SCR-14, SCR-18 |
| 8 | **JG-07 Confirmation document for the immigration desk** | Visa on arrival needs a booking confirmation; a wrong or missing one strands a guest at the airport. | P0 | SCR-12, SCR-30 |
| 9 | **JG-13 Nationality capture per guest (TIMS)** | Weekly/monthly statistics are a legal duty; the booker's nationality is not the guests'. | P0 | SCR-13, SCR-21 |
| 10 | **JG-03 Guest portal** | "Guests should not repeatedly enter information already available" (brief §7) needs a guest surface; it carries online check-in, requests, folio and checkout. | P1 | guest-experience.md |
| 11 | **JG-04 Online check-in (ID, e-signature, passport names, weights)** | Removes jetty paperwork and feeds seaplane manifests; storage rules wait on Q43. | P1 | guest-experience.md §3.3 |
| 12 | **JG-29 Seaplane cut-off and transit nights** | A daily resort reality that otherwise lives in a coordinator's head; it decides the first night of the stay. | P1 | SCR-34 |
| 13 | **JG-14 Arrival preparation and amenity orders** | Requests become owned tasks with due times; celebrations and VIP set-ups are where resorts win or lose reviews. | P1 | guest-services.md §3.1 |
| 14 | **JG-16 Complaints and service recovery** | Problems need an owner until fixed, with compensation inside approval limits and a record on the profile. | P1 | guest-services.md §3.4 |
| 15 | **JG-17 Incident and security log** | Injuries, thefts and damage need evidence and an audit trail, not a paper book. | P1 | guest-services.md §3.4 |
| 16 | **JG-40 + JG-41 Reputation and review solicitation** | OTA review scores drive guesthouse demand [A]; answering reviews from a phone is a daily owner task. | P1 | crm-marketing.md §3.4 |
| 17 | **JG-36 WhatsApp enquiry → quote → hold → pay** | The guesthouse owner's main sales motion; today it is free text and manual links. | P1 | SCR-11, guest-experience.md §3.4 |
| 18 | **JG-39 Surveys and NPS with same-day recovery** | Catch problems while the guest is still on the island; feeds recovery cases. | P1 | crm-marketing.md §3.3 |
| 19 | **JG-19 Dining and venue reservations** | Meal-plan resorts run on table plans, theme nights and sandbank dinners; allergy-aware. | P1 | guest-services.md §3.6 |
| 20 | **JG-06 Upsells** | Revenue every competitor sells at every self-service step; priced by the single tax engine. | P1 | guest-experience.md §3.4 |
| 21 | **JG-46 Commission processing** | Tour-operator and agent commissions settle monthly; accrual and statements prevent disputes. | P1 | contracting.md §3.6, SCR-27 |
| 22 | **JG-15 Butler / guest host** | Luxury resorts assign a host per villa who owns the conversation; handover must carry it. | P1 | guest-services.md §3.2 |
| 23 | **JG-20 Minibar** | Consumption detected after checkout is a classic late-charge and dispute source. | P1 | guest-services.md §3.7 |
| 24 | **JG-33 Structured requests, emergency contacts, special assistance** | Captured once, propagated everywhere; emergency contacts are already required in the continuity snapshot but had no field. | P1 | SCR-10, SCR-21 |
| 25 | **JG-28 Airport meet and greet** | The resort's first touchpoint at Velana: representative, arrivals board, lounge; flight feed later (Q85). | P1 | SCR-35 |

Next in line: JG-22 luggage, JG-21 laundry, JG-30 kids club, JG-31 diving, JG-25 wake-up, JG-26 Wi-Fi credentials,
JG-37 manage my booking, JG-38 IMUGA guidance, JG-48 booking-engine hardening, JG-49 content catalogue, JG-58 folio
queries, JG-60 self check-in.

## Proposed sequencing

| Wave | Add from this audit |
|---|---|
| 2 (with distribution, groups, comms) | `contracting` core (contracts, offers, allotments, contract check, stop-sales); `access` manual key log, key rules and lock simulator; `guest-services` allergy alerts and guest list/continuity snapshot; SCR-12/13/14/18/21/23/24/41 (confirmation document, check-in data, Green Tax day block, charge privileges, invoice deadline). |
| 3 (with resort, ai) | `guest-experience` portal and online check-in; `guest-services` preparation, hosts, cases, incidents, venues, minibar, laundry, luggage; `crm` surveys and reputation; first lock connector (after Q80, Q64); resort SCR-33–37. |
| 4 | Kiosk, mobile/wallet keys, campaigns, recognition, vouchers, dispatch, concierge, parking, visitors, PBX/IPTV/GRMS, long-stay billing. |

## Questions added for the owner

Q80 lock-vendor partner programmes · Q81 contracting in the first pilot slice · Q82 review platform access and paid
add-on · Q83 voucher tax point and expiry · Q84 guest-facing AI · Q85 paid flight-status data · Q86 incident, medical
and security records · Q87 loyalty points vs recognition. Each has a default; nothing in development is blocked.

## How to keep this current

Update a coverage row when its SCR or spec lands (status `specified`) and when the readiness register reaches R3
(status `built`, with evidence). Gap and SCR ids are stable; retire with ~~strikethrough~~. New modules also need
parity matrices and edge-case catalogues under `docs/parity/` (SCR-46) before they can be called complete.
