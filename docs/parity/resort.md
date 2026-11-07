# Parity matrix and edge cases: resort

Module: `resort` (outlet charge intake and outlet posting, meal-plan entitlements, transfers and manifests including
seaplanes, disruptions and weather, activities and spa with resources, waivers and eligibility, dining sessions,
itineraries). Spec: `docs/specs/resort.md` (Draft v1, wave 3, prefix RST); related: `guest-services.md` (venues,
special dining, allergy propagation, guest locator), `concessions.md` (partner-run spas and dive centres),
`fnb-pos.md` parity (POS posting detail), `docs/journey/spec-change-requests.md` SCR-33–SCR-37 (proposed, not yet
applied). Researched 2026-11-07 by the parity-ops researcher. **No code exists** (`modules/resort` not started), so
every row is `specified`, `missing`, `deferred` or `different`.

**Baseline:** OPERA Cloud 26.3 *Reservation Transportation* and *Transportation* configuration, *Guest Locators*,
*External Leisure* scheduled activities on reservations and profiles, and OPERA 26.4 *Leisure Management* (spa,
kids, rentals, tours, cabanas — R05 digest #13). **Resort leaders:** Agilysys (rGuest Stay itinerary in the
reservation, S.P.E.N.D. guest-bookable entitlements, Agilysys Spa, rGuest Book combining room and activity bookings),
Infor HMS (guest booking of activities, dining and spa; post-departure room charges), Apaleo POS and upsell business
cases. Maldives facts: Trans Maldivian Airways FAQ (daylight operations) and journey coverage §1.4 (seaplanes daylight
only, roughly 06:00–15:00/16:00; recreational diving limited to 30 m, licensed dive centres). Our research: R01 §3.8
(OPERA packages and allowances), §4.2 (Infor), §6.2 (Agilysys itinerary as the stay), §9 item 15 (integrate
best-of-breed spa/POS); R05 digest #13 and §2 resort row. Portico terms in the Capability column (transfer, leg,
manifest, itinerary, entitlement, allowance, session, resource, disruption).
**Evidence:** a source marked "search-located" under *Sources* was found by web search but its host blocks direct
fetches here — facts resting only on it are unverified; press and trade press are vendor claims. Priorities: P0
compete/Maldives pilot, P1 full-service/resort expectation, P2 differentiator or rare.

## Capabilities

### 1. Outlets and meal plans

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-RST-001 | POS charge to room: guest lookup by unit, name or booking code returning only eligible in-house stays with room-charge permission and credit status (detail in `fnb-pos.md`) | Apaleo [POS integration business case][apaleo-pos] · R01 §6.2 (Agilysys charge to room across spa, golf, dining) · verified 2026-11-07 | P0 | specified | resort.md RST-R01 | — |
| PAR-RST-002 | Daily outlet balancing: POS totals vs postings, differences as open exceptions | R01 §6.2 | P0 | specified | resort.md RST-R01, RST-I02 | — |
| PAR-RST-003 | Outlet posting app for outlets without a POS (beach bar, dive shop): find guest, items, entitlement applied, signature, offline queue | assumption (Maldives island outlets) | P0 | specified | resort.md RST-R02 | — |
| PAR-RST-004 | Guest photo shown at outlets for recognition, only with consent | OPERA [profile image][op-profimage] · verified 2026-11-07 | P2 | specified | resort.md RST-R02 (guests has no photo field yet — PAR-GUE-009) | — |
| PAR-RST-005 | Meal-plan entitlements per occupant per day from the stay's agreed inclusions (breakfast, lunch, dinner, beverage tiers, exclusions) | R01 §3.8 (OPERA package allowances) | P0 | specified | resort.md RST-R03 | — |
| PAR-RST-006 | Outlet staff see "covered / partially covered / not covered" before posting | Agilysys [S.P.E.N.D. entitlements (press)][agy-spend] · search-located 2026-11-07, unverified | P0 | specified | resort.md RST-R03 | — |
| PAR-RST-007 | Consumption recorded per occupant and meal; over-entitlement items charged | R01 §3.8 | P0 | specified | resort.md RST-R03, RST-I03 | — |
| PAR-RST-008 | All-inclusive tiers with beverage exclusion lists (premium brands charged) | assumption (Maldives all-inclusive practice, resort.md §11) | P0 | specified | resort.md RST-R03 | — |
| PAR-RST-009 | Dine-around at sister properties with inter-property settlement | R01 §6.2 | P2 | deferred | resort.md RST-R03 (LATER: needs inter-property settlement in finance) | — |
| PAR-RST-010 | Package allowances (dining or spa credit) with balance and breakage | R01 §3.8 · Agilysys [S.P.E.N.D. (press)][agy-spend] · search-located 2026-11-07, unverified | P1 | specified | finance.md FIN-R20, FIN-R21; resort.md RST-R08 | — |
| PAR-RST-011 | Outlet charges after check-out post to the departed stay without desk intervention | R01 §4.2 (Infor post-departure charges) | P1 | specified | resort.md S10; finance late-charge rules | — |
| PAR-RST-012 | Partner-run outlets (spa, dive centre) post to room and are settled with the partner | assumption (Maldives concessions, resort.md §11) | P1 | specified | concessions.md CNC-R03, CNC-R05 | — |

### 2. Transfers and manifests

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-RST-013 | Transfer legs with mode (seaplane, domestic flight, speedboat, car), operator, scheduled and estimated times, origin and destination, linked stays and occupants | OPERA [reservation transportation][op-transport] · [transportation configuration][op-transportcfg] · verified 2026-11-07 | P0 | specified | resort.md RST-R04 | — |
| PAR-RST-014 | Passenger data the operator requires (passport names, body and baggage weights) collected with purpose text, visible to transfer roles only, deleted after the leg | journey coverage §1.4 · Trans Maldivian [FAQ][tma-faq] · search-located 2026-11-07, unverified | P0 | specified | resort.md RST-R04; guest-experience.md GXP-R07 (deletion; SCR-37 proposed) | — |
| PAR-RST-015 | Transfers included per person in packages or charged per leg | OPERA [transportation configuration][op-transportcfg] · verified 2026-11-07 | P0 | specified | resort.md RST-R04 | — |
| PAR-RST-016 | Operator confirmation reference and status (requested → confirmed → manifested → departed → arrived; delayed, cancelled, rebooked) | OPERA [reservation transportation][op-transport] · verified 2026-11-07 | P0 | specified | resort.md RST-R04, §4 | — |
| PAR-RST-017 | Manifest per departure with capacity, baggage and special assistance; sent to the operator; later changes as new versions | assumption (Maldives seaplane operations) | P0 | specified | resort.md RST-R05, RST-I05 | — |
| PAR-RST-018 | Transfer board: today's arrivals and departures by mode with delays and manifest status | OPERA [reservation transportation][op-transport] · verified 2026-11-07 | P0 | specified | resort.md §9 | — |
| PAR-RST-019 | Seaplane daylight cut-off and minimum connection time; a transit-night plan (domestic flight + speedboat, Malé hotel, or date shift) when the connection is impossible | journey coverage §1.4 · Trans Maldivian [FAQ][tma-faq] · search-located 2026-11-07, unverified | P0 | missing | — (proposed SCR-34) | — |
| PAR-RST-020 | Departure leg planned backwards from the outbound flight, with departure-lounge or outbound transit-night options | journey coverage §1.4 | P1 | missing | — (proposed SCR-34) | — |
| PAR-RST-021 | Airport meet and greet: representative per flight, arrivals by flight with met/no-show/delayed, lounge allocation | assumption (Maldives airport operations) | P1 | missing | — (proposed SCR-35) | — |
| PAR-RST-022 | Flight-status feed updating arrival ETAs with provenance `external` | assumption | P2 | missing | — (proposed SCR-35, Q85) | — |
| PAR-RST-023 | Operator system integration (booking and confirmation by API) where the operator offers one | assumption | P2 | specified | resort.md §2, §6 (integration where available) | — |
| PAR-RST-024 | Transfer cost per leg reconciled with the operator's invoice | assumption | P2 | missing | — | — |

### 3. Disruptions and weather

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-RST-025 | A transfer delay or cancellation updates ETAs and evaluates every dependent itinerary item (check-in window, unit readiness priority, dining, activity, departure check-out) with flags, owners and suggested actions | R01 §6.2 · R05 digest §2 resort row ("beyond OPERA's scheduling") | P0 | specified | resort.md RST-R06 | — |
| PAR-RST-026 | One guest message summarizing all changes, not one per item | assumption | P0 | specified | resort.md RST-R06 | — |
| PAR-RST-027 | Weather disruption: declare area, window, activity kinds and transfer modes; affected sessions and transfers listed; bulk cancel, move or waive as one previewed change | assumption (monsoon seasons, resort.md §11) | P0 | specified | resort.md RST-R12, RST-I04 | — |
| PAR-RST-028 | Weather refunds and credits follow the agreed policy as folio adjustments or payment refunds, never deletion | R01 §3.8 | P0 | specified | resort.md RST-R13 | — |

### 4. Activities, spa and leisure

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-RST-029 | Activity catalogue (excursion, dive, snorkel, spa treatment, fitness, kids club) with sessions, times and capacity | OPERA [scheduled activities (external leisure)][op-schedact] · [configuration][op-schedactcfg] · R05 digest #13 (OPERA 26.4 Leisure Management) · Infor [HMS guest activity booking (press)][infor-hms] · verified 2026-11-07 (Infor search-located, unverified) | P0 | specified | resort.md RST-R07 | — |
| PAR-RST-030 | Required resources (boat, guide, therapist, treatment room, equipment sizes) never double-booked | Agilysys [Spa profile (trade press)][agy-spaprof] · search-located 2026-11-07, unverified | P0 | specified | resort.md RST-R07, RST-R08, RST-I01 | — |
| PAR-RST-031 | Staff qualifications per session (dive instructor level, therapist skills) | Agilysys [Spa profile][agy-spaprof] · search-located 2026-11-07, unverified | P1 | specified | resort.md RST-R07; workforce.md WFM-R07 | — |
| PAR-RST-032 | Eligibility rules (age, certification level, health declaration) checked at booking | journey coverage §1.4 (Maldives diving regulation) | P0 | specified | resort.md RST-R07 | — |
| PAR-RST-033 | Diving record: certification agency and level, last dive and refresher rule, signed medical statement, regulatory limits as data (30 m, no decompression) | journey coverage §1.4 (Ministry of Tourism diving regulation) | P1 | missing | — (proposed SCR-36) | — |
| PAR-RST-034 | Kids club: registration, guardian and authorized pick-up persons, allergy link, sign-in and sign-out with the collecting adult verified, capacity per age group | R05 digest #13 (OPERA 26.4 kids) | P1 | missing | — (proposed SCR-36) | — |
| PAR-RST-035 | Waivers with versioned text and e-signature per participant | assumption | P0 | specified | resort.md RST-R07 | — |
| PAR-RST-036 | Bookings per participant linked to the stay and itinerary; waitlist | Agilysys [rGuest Stay itineraries][rguest-itin] · search-located 2026-11-07, unverified | P0 | specified | resort.md RST-R08 | — |
| PAR-RST-037 | Charges to the folio or consumption of package entitlements and allowances | Agilysys [S.P.E.N.D. (press)][agy-spend] · search-located 2026-11-07, unverified | P0 | specified | resort.md RST-R08 | — |
| PAR-RST-038 | Cancellation and weather policies per activity with fees | assumption | P1 | specified | resort.md RST-R07 | — |
| PAR-RST-039 | Treatment set-up and clean-down times and minimum-gap rules to avoid fragmented spa schedules | Agilysys [Spa booking optimisation (trade press)][agy-spa] · search-located 2026-11-07, unverified | P2 | missing | — | — |
| PAR-RST-040 | Activity diary with resource lanes (therapists, rooms, boats) | Agilysys [Spa profile][agy-spaprof] · search-located 2026-11-07, unverified | P1 | specified | resort.md §9 | — |
| PAR-RST-041 | Guest self-booking of activities and spa with eligibility, waiver and charge rules | Infor [HMS guest activity booking (press)][infor-hms] · Agilysys [rGuest Book (press)][agy-rguestbook] · search-located 2026-11-07, unverified | P1 | specified | guest-experience.md GXP-R24; resort.md RST-R11 | — |
| PAR-RST-042 | Activities sold together with the room in the booking engine | Agilysys [rGuest Book (press)][agy-rguestbook] · search-located 2026-11-07, unverified | P2 | missing | — (distribution DST-R16 sells rooms and extras; activity sessions not named) | — |
| PAR-RST-043 | Rentals and equipment (snorkel sets, bikes, cabanas) | R05 digest #13 (OPERA rentals, cabanas) | P2 | deferred | guest-services.md GSV-R25 [LATER] | — |
| PAR-RST-044 | Integration with a specialist spa or activity system, showing its bookings on the itinerary with provenance `external` | OPERA [profile scheduled activities (external leisure)][op-schedactprof] · R01 §9 item 15 · verified 2026-11-07 | P1 | specified | resort.md §2, §6 (integrate where present) | — |
| PAR-RST-045 | Activity and spa reports: session occupancy, resource and therapist utilization, revenue per activity | Agilysys [Spa profile][agy-spaprof] · search-located 2026-11-07, unverified | P1 | missing | — | — |
| PAR-RST-046 | Third-party excursions sold with commission to or from the provider | assumption | P2 | specified | concessions.md CNC-R02 (agreements); guest-services.md GSV-R28 [LATER] | — |

### 5. Dining

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-RST-047 | Dining reservations as outlet sessions with table capacity by time slot and meal-plan awareness | Infor [HMS dining booking (press)][infor-hms] · search-located 2026-11-07, unverified | P1 | specified | resort.md RST-R09 [SHOULD]; guest-services.md GSV-R16–R18 (SCR-33 proposes moving it there) | — |
| PAR-RST-048 | Special dining (sandbank dinner, private chef, in-villa menu) with resources such as boats and chefs | assumption (Maldives resorts) | P1 | specified | guest-services.md GSV-R19 | — |

### 6. Itinerary

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-RST-049 | One itinerary per stay or booking combining transfers, stay events, dining, activities, spa and group events | Agilysys [rGuest Stay itineraries][rguest-itin] · OPERA [scheduled activities on the reservation][op-schedact] · R01 §6.2 · verified 2026-11-07 (Agilysys search-located, unverified) | P0 | specified | resort.md RST-R10 | — |
| PAR-RST-050 | Family and group itineraries linked (children's activities vs parents' dinner) | Agilysys [rGuest Stay itineraries][rguest-itin] · search-located 2026-11-07, unverified | P1 | specified | resort.md RST-R10 | — |
| PAR-RST-051 | Each itinerary item shows status and provenance (confirmed by the operator vs requested) | assumption (vision: facts vs pending distinct) | P0 | specified | resort.md RST-R10 | — |
| PAR-RST-052 | Guest-visible itinerary and entitlement balances in the portal | Agilysys [rGuest Book (press)][agy-rguestbook] · search-located 2026-11-07, unverified | P1 | specified | resort.md RST-R11; guest-experience.md GXP-R19, GXP-R21 | — |
| PAR-RST-053 | Daily programme printed or sent to the villa in the guest's language | assumption | P2 | missing | — | — |
| PAR-RST-054 | Guest locator ("at the spa until 15:00") for reaching in-house guests | OPERA [guest locators][op-locators] · verified 2026-11-07 | P2 | specified | guest-services.md GSV-R13 [SHOULD] | — |

### 7. Boundaries, connected mode and control

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-RST-055 | Outlet requisitions handed to procurement | assumption | P2 | specified | resort.md RST-R14 [LATER]; procurement.md | — |
| PAR-RST-056 | Resort modules alongside an external PMS: activity, transfer and outlet charges forwarded to the PMS folio and shown pending until acknowledged | Apaleo [POS business case][apaleo-pos] · verified 2026-11-07 | P0 | specified | resort.md §14 | — |
| PAR-RST-057 | Meal-plan entitlements derived from mirrored rate or package codes through mapping, labelled `incomplete` when the PMS does not expose them | assumption | P1 | specified | resort.md §14 | — |
| PAR-RST-058 | Trial: operator confirmations and manifests simulated; nothing sent to operators | assumption | P0 | specified | resort.md §14 | — |
| PAR-RST-059 | Permissions: transfers, manifest send, activities, waivers, outlet post, outlet correct ⚑, disruption declare ⚑ | OPERA [role tasks][op-roletasks] · verified 2026-11-07 | P0 | specified | resort.md §8 | — |
| PAR-RST-060 | Meal-plan consumption reconciled with entitlements and folio (S19) | R01 §3.8 | P1 | specified | resort.md §10 (S19) | — |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-RST-001 | Seaplane delayed 3 hours (S12) | ETA updated; villa readiness re-prioritized; dinner and sunset dive flagged with owners; one guest message; rebooking previewed and applied; charges and refunds per policy | P0 | specified | — |
| EC-RST-002 | International flight lands at 16:30, after the last seaplane departure | Transit plan case with options (domestic flight + speedboat, Malé hotel night, arrival-date shift); the seaplane is never shown confirmed for today | P0 | missing | — |
| EC-RST-003 | The operator re-times the seaplane the day before | Transfer updated with the operator's provenance; check-in window and readiness recomputed; the guest told once | P0 | specified | — |
| EC-RST-004 | A passenger is added after the manifest was sent | New manifest version; the sent version stays identifiable; the change goes to the operator as a new version | P0 | specified | — |
| EC-RST-005 | Passenger and baggage weights exceed the seaplane's limit | Manifest warning before sending with options (excess baggage fee, separate cargo, another departure) | P1 | specified | — |
| EC-RST-006 | Body weights collected for a seaplane leg | Visible only to transfer roles; deleted the policy number of days after the leg; never in reports or exports | P0 | specified | — |
| EC-RST-007 | A monsoon squall cancels all afternoon dives and sandbank trips | Disruption lists affected sessions and guests; bulk move or cancel with policy refunds as one previewed change; one message per guest | P0 | specified | — |
| EC-RST-008 | A package-included excursion is cancelled for weather | No refund on a zero-priced item; the entitlement is restored or an alternative offered, per policy | P1 | missing | — |
| EC-RST-009 | A therapist is booked into two overlapping treatments | Refused at booking (RST-I01) with the conflicting session named | P0 | specified | — |
| EC-RST-010 | A therapist calls in sick on the day | Her sessions flagged; reassignment to a qualified colleague or moving guests offered as one preview | P1 | missing | — |
| EC-RST-011 | A 9-year-old is booked on a dive that requires age 10 | Refused with the eligibility reason; alternatives (snorkel) suggested | P0 | specified | — |
| EC-RST-012 | A diver's last logged dive was three years ago | Refresher required before an open-water booking is confirmed | P1 | missing | — |
| EC-RST-013 | Waiver text changes from v3 to v4 after the guest signed v3 | Policy decides whether v4 needs a new signature; the signature records which version was signed | P1 | missing | — |
| EC-RST-014 | A participant has not signed the waiver when the session starts | That participant cannot be checked in; "sign now on the tablet" offered | P0 | specified | — |
| EC-RST-015 | A full session frees a seat after a cancellation | First waitlisted guest offered the seat with a hold time; notified via comms | P1 | specified | — |
| EC-RST-016 | A half-board guest orders lunch, then dinner with wine (S19) | Lunch charged; dinner covered; wine per the beverage tier; folio and entitlement balance reconcile | P0 | specified | — |
| EC-RST-017 | An all-inclusive guest orders champagne on the exclusion list | Server sees "not covered" with the price before posting; charged with an explanation line | P0 | specified | — |
| EC-RST-018 | Breakfast is taken at two restaurants on the same day | The second is charged (one breakfast per occupant per day) unless the plan allows it | P0 | specified | — |
| EC-RST-019 | A child under 2 eats from the buffet | Covered per the stay's agreed inclusions (age bands from rates); no charge posted | P1 | specified | — |
| EC-RST-020 | The POS resends a check line after a timeout | Posts once (key `pos:{outletId}:{checkId}:{lineId}`) | P0 | specified | — |
| EC-RST-021 | A restaurant charge arrives after the guest checked out (S10) | Posts to the departed stay under late-charge rules; desk follow-up list | P0 | specified | — |
| EC-RST-022 | Outlet balancing finds POS totals differ from postings | Exception per check with the difference and an owner | P0 | specified | — |
| EC-RST-023 | The beach-bar posting tablet is offline for an hour | Posts queued with signatures; synced later; a guest who checked out meanwhile gets a late charge, not a lost one | P1 | specified | — |
| EC-RST-024 | An outlet charge was posted to the wrong villa | Linked correcting adjustment with `resort.outlet.correct` ⚑ and reason; original never deleted | P0 | specified | — |
| EC-RST-025 | The guest moves villas mid-stay | Unit-dependent itinerary items (in-villa dinner, buggy pick-up, departure pick-up point) flagged for update | P1 | missing | — |
| EC-RST-026 | The stay is extended by two nights | Departure transfer flagged for rebooking with a new manifest version; activities on the old departure day reviewed | P1 | missing | — |
| EC-RST-027 | A booking with a confirmed seaplane and spa treatments is cancelled | Transfer and activity bookings cancelled under their own policies; the operator gets a manifest version; nothing left orphaned | P1 | missing | — |
| EC-RST-028 | Connected mode: a forwarded activity charge is rejected by the PMS (stay already checked out there) | Charge shown `rejected` with the reason; desk exception; never shown as posted | P0 | specified | — |
| EC-RST-029 | Connected mode: the PMS's rate codes do not carry the meal plan | Entitlements labelled `incomplete`; outlet staff see "entitlement unknown — ask the desk" instead of a guess | P1 | specified | — |
| EC-RST-030 | A trial organization confirms a seaplane | Operator confirmation simulated and labelled; nothing sent | P0 | specified | — |
| EC-RST-031 | A group of 40 arrives on three seaplanes | Manifests per departure; group itinerary links; arrival readiness per wave | P1 | specified | — |
| EC-RST-032 | The speedboat from Malé to a guesthouse island is cancelled for sea state | Guests notified once with options; no charge per policy; check-in window moved | P1 | specified | — |
| EC-RST-033 | A dinner reservation for a guest with a nut allergy | Allergy alert propagated to the outlet and kitchen with acknowledgement (GSV-R07, GSV-R18) | P0 | specified | — |
| EC-RST-034 | The partner-run spa posts a treatment to a room | Posted with outlet attribution; included in the partner's settlement statement (CNC-R03, CNC-R05) | P1 | specified | — |

<!-- sources (generated from a verified registry; do not edit by hand) -->

## Sources

Registry checked 2026-11-07. **Opened** = the page was fetched from this environment. **Search-located** = found by web search; the host blocks direct fetches here, so the fact is unverified until re-checked. Press releases and trade press are vendor claims, not verified behaviour.

- [Agilysys — Agilysys Spa booking optimisation (trade press)][agy-spa] (search-located)
- [Agilysys — Agilysys Spa company profile (trade press)][agy-spaprof] (search-located)
- [Agilysys — Book with S.P.E.N.D. — guest-bookable package entitlements (press)][agy-spend] (search-located)
- [Agilysys — rGuest Book combines room and activity bookings (press, 2021)][agy-rguestbook] (search-located)
- [Agilysys — rGuest Stay — Itineraries in Reservation][rguest-itin] (search-located)
- [Apaleo — POS integration business case][apaleo-pos] (opened)
- [Infor — Next generation of Hospitality Management Solution (press)][infor-hms] (search-located)
- [OPERA Cloud 25.5 — Managing Profile Scheduled Activities (External Leisure)][op-schedactprof] (opened)
- [OPERA Cloud 26.3 — Assigning Tasks to a Role][op-roletasks] (opened)
- [OPERA Cloud 26.3 — Configuring Scheduled Activities (External Leisure)][op-schedactcfg] (opened)
- [OPERA Cloud 26.3 — Configuring Transportation][op-transportcfg] (opened)
- [OPERA Cloud 26.3 — Managing Profile Image][op-profimage] (opened)
- [OPERA Cloud 26.3 — Managing Reservation (Guest) Locators][op-locators] (opened)
- [OPERA Cloud 26.3 — Managing Reservation Scheduled Activities (External Leisure)][op-schedact] (opened)
- [OPERA Cloud 26.3 — Managing Reservation Transportation][op-transport] (opened)
- [Trans Maldivian Airways — FAQs (sunrise-to-sunset operations)][tma-faq] (search-located)

[agy-rguestbook]: https://www.businesswire.com/news/home/20210209005683/en/Agilysys-Announces-State-of-the-Art-Enhancements-To-Its-Online-Reservations-Solution-rGuest-Book
[agy-spa]: https://www.spabusiness.com/wellness-products-and-services/Elevating-spa-profitability-booking-optimisation-with-Agilysys-Spa-powered-by-guestsenseai/361260
[agy-spaprof]: https://www.spabusiness.com/company-profiles/Agilysys/1516
[agy-spend]: https://www.businesswire.com/news/home/20250616959509/en/
[apaleo-pos]: https://apaleo.dev/guides/business-cases/pos-integration/overview.html
[infor-hms]: https://www.infor.com/news/infor-next-gen-hospitality-management
[op-locators]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_reservations_locators.htm
[op-profimage]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_profile_image.htm
[op-roletasks]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_manage_property_roles_assigning_tasks_to_roles.htm
[op-schedact]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_reservations_scheduled_activities.htm
[op-schedactcfg]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_admin_interfaces_configuring_scheduling_activities.htm
[op-schedactprof]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.5/ocsuh/t_managing_profile_scheduled_activities.htm
[op-transport]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_reservations_transportation.htm
[op-transportcfg]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_configuring_transportation.htm
[rguest-itin]: https://help.rguest.com/stay/UserGuide/Itineraries%20in%20Reservation.htm
[tma-faq]: https://www.transmaldivian.com/faqs/
