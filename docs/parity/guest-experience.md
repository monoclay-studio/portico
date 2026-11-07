# Parity matrix and edge cases: guest-experience

Module: `guest-experience` (guest portal: links and step-up, booking summary, manage-my-booking, arrival and transfer
details, entry requirements, preferences, payments, online check-in with registration card, document capture and
e-signature, upsells, in-stay requests and chat, digital folio, express checkout, e-folio, post-stay page; kiosk and
assisted tablet mode). Spec: `docs/specs/guest-experience.md` (Draft v1, wave 3 portal / wave 4 kiosk, prefix GXP),
proposed by the guest-journey audit; app `apps/guest`. Researched 2026-11-07 by the parity-ops researcher. **No code
exists** (`apps/guest` and the module are not started), so every row is `specified`, `missing`, `deferred` or
`different`.

**Baseline:** OPERA Cloud 26.3 *eSignature registration cards*, *batch registration cards*, *electronic registration
card templates*, *advance check-in* and *auto check-in*, *upgrade offers* (incl. Nor1 PRiME), *pre-arrival lookup
schedules*, *queue status*, *eFolio exports*, *mobile ID scanner*; OPERA 26.4 *Digital Registration*
(nationality-based e-forms, e-sign, purge rules — R05 digest #13). **Modern leaders:** Mews Guest Portal, online
check-in journey, upsells and Kiosk (incl. Kiosk API); Stayntouch kiosk (check-in, key pick-up, ID scanning and facial
recognition) and Guest Mobility; Duve (online check-in, ID scan, guest app); RMS Cloud guest portal (self check-in,
digital registration card, registered kiosk devices, self check-out); RoomRaccoon (upsell inside online check-in);
Apaleo guest-journey and upsell business cases; Infor guest self-service. Our research: R02 §2.2 and §8 item 12
(Mews app-less portal), §4.2–§4.3 (Stayntouch upsell with priority cleaning), R03 §5 (RoomRaccoon), §8.4 (Clock PMS+
self-service), R01 §6.2 (Agilysys itinerary app); R05 digest #13, #36 (kiosk benefits arrive with a lag; failed
self-service lowers return intent). Portico terms in the Capability column (stay link, step-up, pre-check-in,
registration card, upsell offer, express checkout).
**Evidence:** a source marked "search-located" under *Sources* was found by web search but its host blocks direct
fetches here — facts resting only on it are unverified; press releases are vendor claims. Priorities: P0
compete/pilot, P1 full-service/resort expectation, P2 differentiator or rare.

## Capabilities

### 1. Access and the guest surface

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-GXP-001 | Stay-scoped signed links for the booker and each adult occupant, with revocation (cancellation, on request, after the stay) | Mews [Guest Portal][mews-portal] · Duve [guest experience platform][duve-gxp] · verified 2026-11-07 (Duve search-located, unverified) | P0 | specified | guest-experience.md GXP-R01 | — |
| PAR-GXP-002 | Step-up verification (one-time code to a verified contact, or booking code + surname + arrival date) before folio, payment, documents, keys or contact changes | assumption | P0 | specified | guest-experience.md GXP-R02 | — |
| PAR-GXP-003 | Who sees what: booker, each occupant, payer; adults edit children's data; agency and company amounts hidden by default | assumption (contracting: net rates are commercial secrets) | P0 | specified | guest-experience.md GXP-R03 | — |
| PAR-GXP-004 | Accessible (WCAG 2.2 AA), multilingual incl. RTL, ≤ 300 KB first load on 3G, offline caching of itinerary, key and property information | assumption (Maldives island connectivity) | P0 | specified | guest-experience.md GXP-R04 | — |
| PAR-GXP-005 | Guest accounts with passwords across stays | Mews [Guest Portal][mews-portal] · verified 2026-11-07 | P2 | deferred | guest-experience.md §2 (LATER: magic links first) | — |
| PAR-GXP-006 | Native mobile guest app | Duve [hotel guest app][duve-app] · R01 §6.2 (Agilysys app) · search-located 2026-11-07, unverified | P2 | different | guest-experience.md §2 (web app; native only if web cannot meet a need such as wallet keys) | — |
| PAR-GXP-007 | Property branding of the portal (logo, colours, own domain) | Duve [guest experience platform][duve-gxp] · search-located 2026-11-07, unverified | P1 | missing | — | — |

### 2. Pre-arrival

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-GXP-008 | Booking summary in staff vocabulary: status, dates, occupants, inclusions, policies from the terms snapshot, payment schedule states, request states, what the hotel still needs | Mews [Guest Portal][mews-portal] · verified 2026-11-07 | P0 | specified | guest-experience.md GXP-R05 | — |
| PAR-GXP-009 | Manage my booking within policy: instant previewed changes or requests; channel-owned and tour-operator bookings redirected | Apaleo [guest journey business case][apaleo-guestjourney] · verified 2026-11-07 | P1 | specified | guest-experience.md GXP-R06 | — |
| PAR-GXP-010 | Arrival and transfer details: international flight, arrival time, transfer choice, passport-exact names and operator-required weights per passenger | journey coverage §1.4 (seaplane operations) | P0 | specified | guest-experience.md GXP-R07 | — |
| PAR-GXP-011 | Entry-requirement checklist from the market content pack (Maldives IMUGA within 96 h, visa-on-arrival booking confirmation); Portico never submits declarations | journey coverage §1.4 | P0 | specified | guest-experience.md GXP-R08 | — |
| PAR-GXP-012 | Structured preferences and requests (bed, pillow, dietary, allergy, accessibility, occasion, housekeeping time) with live status; allergy only with explicit consent | Duve [online check-in][duve-oci] · search-located 2026-11-07, unverified | P0 | specified | guest-experience.md GXP-R09 | — |
| PAR-GXP-013 | Pay deposits and balances and give an incidental authorization through hosted fields; outcomes shown exactly | Mews [online check-in journey][mews-oci] · RMS [self check-in (payment gateway)][rms-selfci] · verified 2026-11-07 (RMS Cloud search-located, unverified) | P0 | specified | guest-experience.md GXP-R10 | — |
| PAR-GXP-014 | Scheduled pre-arrival lookups that invite arriving guests to check in online | OPERA [pre-arrival lookup schedules][op-prearrival] · verified 2026-11-07 | P1 | specified | comms.md COM-R06 (time-anchored automations); guest-experience.md GXP-R01 | — |

### 3. Online check-in and registration

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-GXP-015 | Registration card per market (fields per country pack), prefilled from what is known, nothing asked twice | OPERA [electronic registration card templates][op-eregcfg] · RMS [digital registration card][rms-digreg] · Mews [online check-in][mews-oci] · R05 digest #13 · verified 2026-11-07 (RMS Cloud search-located, unverified) | P0 | specified | guest-experience.md GXP-R11 | — |
| PAR-GXP-016 | Passport capture with on-device MRZ reading; images kept only if policy allows; optional ID-verification vendor; verification state recorded | Stayntouch [ID scanning][snt-idscan] · Duve [ID/passport scan][duve-idscan] · OPERA [mobile ID scanner][op-idscanmob] · verified 2026-11-07 (Stayntouch, Duve search-located, unverified) | P1 | specified | guest-experience.md GXP-R12 [SHOULD] | — |
| PAR-GXP-017 | Face match against the passport photo | Stayntouch [ID scanning and facial recognition][snt-idscan] · search-located 2026-11-07, unverified | P2 | specified | guest-experience.md GXP-R12 (vendor only; counsel review of patents, R05 §4) | — |
| PAR-GXP-018 | E-signature with evidence (document version, signature, time, device summary) for the registration card, house rules and policies, reusable for disputes | OPERA [eSignature registration cards][op-esig] · verified 2026-11-07 | P0 | specified | guest-experience.md GXP-R13 | — |
| PAR-GXP-019 | Submission becomes a pre-check-in record; the desk checklist imports completed steps; staff accept or return items with a reason | Mews [online check-in journey][mews-oci] · verified 2026-11-07 | P0 | specified | guest-experience.md GXP-R14 | — |
| PAR-GXP-020 | Batch printing of registration cards for tomorrow's arrivals (paper fallback, outage) | OPERA [batch registration cards][op-batchreg] · verified 2026-11-07 | P1 | missing | — (GXP-R30 prints at the kiosk only) | — |
| PAR-GXP-021 | Advance check-in (stay prepared and marked ready ahead of arrival) and automatic check-in when the room becomes ready | OPERA [advance check-in][op-advci] · [auto check-in][op-autoci] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GXP-022 | Guest told automatically when their room is ready (queue) | OPERA [queue status][op-queue] · verified 2026-11-07 | P1 | missing | — (also PAR-OPS-032) | — |
| PAR-GXP-023 | Self check-in for guesthouses, apartments and late arrivals: unit, directions, PIN or mobile key and emergency contact once conditions pass | RMS [Guest Portal self check-in][rms-selfci] · Stayntouch [Guest Mobility][snt-mobility] · search-located 2026-11-07, unverified | P1 | specified | guest-experience.md GXP-R15 [SHOULD]; access.md ACS-R15 | — |
| PAR-GXP-024 | Emergency contact and optional travel insurance captured per adult | assumption | P2 | specified | guest-experience.md GXP-R11 | — |
| PAR-GXP-025 | Retention and purge of registration data per market | R05 digest #13 (OPERA Digital Registration purge rules) | P1 | specified | guests.md GUE-R19 (documents); guest-experience.md GXP-R07 (transfer data) | — |

### 4. Upsells, offers and quotes

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-GXP-026 | Upsell catalogue: upgrade ladder, early check-in, late check-out, transfer upgrade, package, experience, amenity, custom — with images and text per language | Mews [create upsells][mews-upsells] · OPERA [upgrade offers][op-upgrade] · Apaleo [upsell business case][apaleo-upsell] · verified 2026-11-07 | P0 | specified | guest-experience.md GXP-R16 | — |
| PAR-GXP-027 | Eligibility (dates, unit types, rate plans, channel — e.g. exclude tour-operator bookings) and live availability through the owning module | RoomRaccoon [upsell in online check-in][rr-upsell] · search-located 2026-11-07, unverified | P0 | specified | guest-experience.md GXP-R16 | — |
| PAR-GXP-028 | Acceptance modes: instant (previewed change), on request, pay now; consent evidence; revenue attributed to the offer | Mews [offer products during online check-in][mews-upsellci] · verified 2026-11-07 | P0 | specified | guest-experience.md GXP-R17 | — |
| PAR-GXP-029 | Upsell inside online check-in with a check-in-only price and quantity caps | RoomRaccoon [upsell in online check-in][rr-upsell] · search-located 2026-11-07, unverified | P1 | specified | guest-experience.md GXP-R16 (time windows; price via rates) | — |
| PAR-GXP-030 | Algorithmic upgrade pricing based on demand and the guest's bid | OPERA [upgrade powered by Nor1 PRiME][op-nor1] · R02 §4.3 (Stayntouch) · verified 2026-11-07 | P2 | missing | — (price = rate difference via `rates.priceChange`) | — |
| PAR-GXP-031 | Early check-in purchased raises the unit's cleaning priority | R02 §4.3 (Stayntouch priority cleaning) | P1 | specified | guest-experience.md GXP-R16; operations.md OPS-R06 (early check-in priority) | — |
| PAR-GXP-032 | Leisure quote page with options, policies, hold expiry and "accept and pay" | assumption | P2 | specified | guest-experience.md GXP-R18 [SHOULD] | — |
| PAR-GXP-033 | Upsell performance report (offers shown, accepted, revenue by item and touchpoint) | OPERA [upgrade offers][op-upgrade] · verified 2026-11-07 | P1 | specified | guest-experience.md GXP-R17 (attribution); analytics.md | — |
| PAR-GXP-034 | A sold upsell that cannot be delivered (villa not ready for early check-in) is refunded or credited per policy and the guest told | assumption | P1 | missing | — | — |

### 5. In-stay

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-GXP-035 | Itinerary with confirmed vs requested items and live disruption changes | R01 §6.2 (Agilysys) | P1 | specified | guest-experience.md GXP-R19 | — |
| PAR-GXP-036 | Requests and chat from the portal with real task status and department routing | Duve [guest experience platform][duve-gxp] · Mews [Guest Portal][mews-portal] · verified 2026-11-07 (Duve search-located, unverified) | P0 | specified | guest-experience.md GXP-R20 | — |
| PAR-GXP-037 | Digital folio as staff see it: packages with breakdown, pending items labelled, allowance balances, `external` provenance when mirrored | Mews [Guest Portal][mews-portal] · verified 2026-11-07 | P0 | specified | guest-experience.md GXP-R21 | — |
| PAR-GXP-038 | Property information: guide, outlets and hours, Wi-Fi, house rules, local customs, emergency numbers, clinic hours | Duve [hotel guest app][duve-app] · search-located 2026-11-07, unverified | P0 | specified | guest-experience.md GXP-R22 | — |
| PAR-GXP-039 | Mobile key and PIN card with status as reported | Mews [Digital Key][mews-dkey] · search-located 2026-11-07, unverified | P1 | specified | guest-experience.md GXP-R23 | — |
| PAR-GXP-040 | Self-booking of dining slots and activities with eligibility, waivers and charges | Infor [guest self-service (press)][infor-selfsvc] · search-located 2026-11-07, unverified | P1 | specified | guest-experience.md GXP-R24 | — |
| PAR-GXP-041 | Digital ordering (in-villa dining menu to the POS) | Duve [hotel guest app][duve-app] · search-located 2026-11-07, unverified | P2 | deferred | guest-experience.md GXP-R25 [LATER] (needs POS order workflow) | — |

### 6. Departure and after the stay

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-GXP-042 | Express checkout: final folios, pending-charge warning, settle with card on file or new card, luggage pick-up, buyer details (incl. MIRA TIN); check-out done by the desk or an automation, never assumed | RMS [Guest Portal self check-out][rms-selfco] · Stayntouch [Guest Mobility][snt-mobility] · Infor [guest self-service (press)][infor-selfsvc] · search-located 2026-11-07, unverified | P0 | specified | guest-experience.md GXP-R26 | — |
| PAR-GXP-043 | E-folio and invoice download with delivery status; re-download for the post-stay period | OPERA [eFolio exports][op-efolio] · verified 2026-11-07 | P0 | specified | guest-experience.md GXP-R27 | — |
| PAR-GXP-044 | Folio queries ("I don't recognise this line") opened as a case visible before settlement | assumption | P1 | specified | guest-experience.md GXP-R28 | — |
| PAR-GXP-045 | Post-stay page: survey, invoices, lost-item claim, rebook | assumption | P1 | specified | guest-experience.md GXP-R29 | — |

### 7. Kiosk and assisted mode

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-GXP-046 | Lobby kiosk: find booking (QR, code, name + date), check-in steps, document scan, card-present payment, key encoding, registration card, walk-in sale, express checkout | Mews [Kiosk][mews-kiosk] · [kiosk check-in journey][mews-kioskci] · Stayntouch [kiosk check-in][snt-kioskci] · [key pick-up][snt-kioskkeys] · verified 2026-11-07 (Stayntouch search-located, unverified) | P1 | specified | guest-experience.md GXP-R30 [SHOULD] | — |
| PAR-GXP-047 | Kiosk sessions auto-reset; no back navigation into a previous guest's data | Stayntouch [kiosk general settings][snt-kiosk] · search-located 2026-11-07, unverified | P0 | specified | guest-experience.md GXP-R30 | — |
| PAR-GXP-048 | Assisted tablet mode for jetty, airport lounge and in-villa check-in with the staff member's identity on every action and the guest signing on the device | assumption (Maldives arrivals, access.md §11) | P0 | specified | guest-experience.md GXP-R31 | — |
| PAR-GXP-049 | Device registration by QR pairing, bound encoder and terminal, health, remote lock | RMS [register device for digital check-in][rms-kioskdev] · Mews [kiosk set-up][mews-kiosksetup] · verified 2026-11-07 (RMS Cloud search-located, unverified) | P1 | specified | guest-experience.md GXP-R32 [SHOULD] | — |
| PAR-GXP-050 | Kiosk API so third-party kiosks can run Portico check-in | Mews [Connector API kiosk use case][mews-kioskapi] · verified 2026-11-07 | P2 | missing | — | — |

### 8. Truthfulness, safety and adoption

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-GXP-051 | Environment banner; payments and keys simulated; messages to the simulated outbox in demo, trial and training | assumption (CLAUDE.md §4.12) | P0 | specified | guest-experience.md GXP-R33 | — |
| PAR-GXP-052 | Every guest action idempotent; failures explained with the recovery ("the villa was just sold — here are other options") | assumption | P0 | specified | guest-experience.md GXP-R34 | — |
| PAR-GXP-053 | No shared caching of sensitive data; document images never shown back after submission | assumption (R04 C1) | P0 | specified | guest-experience.md GXP-R35 | — |
| PAR-GXP-054 | Self-service failure rate measured, with graceful hand-off to staff carrying the guest's context | R05 digest #36 (failed self-service lowers return intent) | P1 | missing | — | — |
| PAR-GXP-055 | Portal next to an external PMS: registration forwarded to the PMS profile or labelled "Portico only"; folio from mirrored balances; booking-changing upsells become requests | Duve [guest experience platform][duve-gxp] · search-located 2026-11-07, unverified | P1 | specified | guest-experience.md §14 | — |
| PAR-GXP-056 | Hotels that keep an existing guest app connect it through Portico's API and webhooks | RMS [Canary Technologies module][rms-canary] · search-located 2026-11-07, unverified | P2 | specified | integration.md INT-R26, INT-R27 | — |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-GXP-001 | A portal deposit payment times out (S05) | "We are confirming your payment" (pending); a second payment is blocked; "Paid" only after reconciliation | P0 | specified | — |
| EC-GXP-002 | The seaplane is delayed 3 hours (S12) | One message; itinerary shows shifted times with requested/confirmed labels | P0 | specified | — |
| EC-GXP-003 | The guest compares the portal folio with the desk folio (S19) | Identical to the minor unit; packages grouped the same way; allowance balance shown | P0 | specified | — |
| EC-GXP-004 | A trial organization previews the portal (A01) | Payments, keys and messages simulated with the environment banner; no real guest receives a link | P0 | specified | — |
| EC-GXP-005 | Family of four checks in online (J01) | Two adults sign; children's ages verified; the seaplane manifest receives passport names; the desk imports steps; nothing re-asked at the jetty | P0 | specified | — |
| EC-GXP-006 | An upgrade is accepted in the portal while the desk sells the last water villa (J02) | Exactly one succeeds; the guest sees "no longer available" with alternatives; no charge | P0 | specified | — |
| EC-GXP-007 | Express checkout with a queried minibar line (J03) | Query resolved by adjustment before settlement; invoice issued within the 3-day rule; e-folio delivered | P0 | specified | — |
| EC-GXP-008 | A stay link is forwarded to a friend | Only the non-sensitive summary without step-up; occupants' data and documents hidden | P0 | specified | — |
| EC-GXP-009 | A link is opened after the booking was cancelled | Link version bumped; page says the booking was cancelled and how to contact the hotel | P1 | specified | — |
| EC-GXP-010 | The same passport number is entered for two occupants | Warning before submission; the duplicate is flagged for the desk | P1 | missing | — |
| EC-GXP-011 | The passport MRZ cannot be read (glare) | Manual entry marked `unverified`; desk verifies at arrival | P1 | specified | — |
| EC-GXP-012 | The guest submits online check-in while the desk edits the same profile | Submission staged; differences shown to staff for review; nothing overwritten silently | P1 | specified | — |
| EC-GXP-013 | A 16-year-old tries to sign the registration card for the room | Refused; an adult occupant signs for minors | P1 | specified | — |
| EC-GXP-014 | A tour-operator guest tries to add nights in the portal | "Contact your travel agent" for commercial changes; arrival details still editable | P1 | specified | — |
| EC-GXP-015 | A Booking.com guest tries to change dates in the portal | "Change this with Booking.com" for channel-owned fields | P1 | specified | — |
| EC-GXP-016 | Prices change between the portal preview and the guest's confirmation | Re-preview with the new price; the guest is never charged a price they did not see | P0 | specified | — |
| EC-GXP-017 | A paid early check-in cannot be honoured (villa not ready at the promised time) | Guest told with the real ETA; refund or credit per policy; nothing shown as ready before it is | P1 | missing | — |
| EC-GXP-018 | A guest abandons the kiosk mid check-in | Auto-reset after the timeout; completed steps kept on the stay for the desk; nothing visible to the next guest | P0 | specified | — |
| EC-GXP-019 | The kiosk card terminal declines | Retry or another card offered; no key encoded until the guarantee is satisfied | P1 | specified | — |
| EC-GXP-020 | The kiosk encoder runs out of cards | Device health alert to staff; guest directed to the desk with their progress carried over | P1 | specified | — |
| EC-GXP-021 | A guesthouse guest opens the portal on 3G on a local island | First load within budget; itinerary, key and property information cached for offline use | P1 | specified | — |
| EC-GXP-022 | An Arabic-speaking guest uses the portal | Right-to-left layout; times in property time with the zone named | P2 | specified | — |
| EC-GXP-023 | Image storage is off and the guest uploads a passport photo | Only the MRZ data is kept; the image is discarded on the device; the guest sees "received" | P0 | specified | — |
| EC-GXP-024 | A late restaurant charge posts after express-checkout settlement | Guest notified; charged per late-charge rules with the card on file; invoice corrected by credit note and reissue | P1 | specified | — |
| EC-GXP-025 | The guest settled by express checkout but the desk has not checked the stay out | Portal shows "settled — check-out pending at the desk"; never "checked out" | P0 | specified | — |
| EC-GXP-026 | A company TIN for the invoice is entered in the wrong format | Validated before submission with the expected format; invoice not issued with an invalid TIN | P1 | specified | — |
| EC-GXP-027 | The guest ticks "IMUGA done" without filing it | Portico never verifies, stores or submits declarations; it only shows the official link and reminders | P1 | specified | — |
| EC-GXP-028 | Late check-out requested when the villa is booked for an early arrival | Created as a request for staff, not an instant change | P1 | specified | — |
| EC-GXP-029 | A mobile key is revoked by a room move while the guest has the portal open | Key card shows the old key revoked and the new key's status exactly as reported | P1 | specified | — |
| EC-GXP-030 | A stay link is used 45 days after check-out | Expired with a way to request the invoice again after verification | P2 | specified | — |
| EC-GXP-031 | The guest's bank shows a debit but the payment provider has not confirmed | Portal keeps "pending verification" until the provider confirms | P0 | specified | — |
| EC-GXP-032 | Self-service fails three times for one guest (ID scan, then payment) | Hand-off to staff with the guest's progress and the failure reasons; counted in the self-service failure metric | P1 | missing | — |

<!-- sources (generated from a verified registry; do not edit by hand) -->

## Sources

Registry checked 2026-11-07. **Opened** = the page was fetched from this environment. **Search-located** = found by web search; the host blocks direct fetches here, so the fact is unverified until re-checked. Press releases and trade press are vendor claims, not verified behaviour.

- [Apaleo — Guest journey business case][apaleo-guestjourney] (opened)
- [Apaleo — Upsell business case][apaleo-upsell] (opened)
- [Duve — Guest experience platform][duve-gxp] (search-located)
- [Duve — Hotel guest app][duve-app] (search-located)
- [Duve — ID / passport scan (support)][duve-idscan] (search-located)
- [Duve — Online check-in][duve-oci] (search-located)
- [Infor — Contactless guest self-service apps for hospitality (press)][infor-selfsvc] (search-located)
- [Mews — Connector API — Kiosk use case][mews-kioskapi] (opened)
- [Mews — How to create upsells in Mews Operations][mews-upsells] (opened)
- [Mews — How to offer products to guests during online check-in][mews-upsellci] (opened)
- [Mews — Mews Digital Key][mews-dkey] (search-located)
- [Mews — Setting up your Mews Kiosk][mews-kiosksetup] (opened)
- [Mews — The Mews Kiosk][mews-kiosk] (opened)
- [Mews — The check-in journey in Mews Kiosk][mews-kioskci] (opened)
- [Mews — The online check-in journey in the Guest Portal][mews-oci] (opened)
- [Mews — Understanding the Guest Portal][mews-portal] (opened)
- [OPERA Cloud 26.3 — Advance Checking In Reservations][op-advci] (opened)
- [OPERA Cloud 26.3 — Auto Check In of Advance Checked In Reservations][op-autoci] (opened)
- [OPERA Cloud 26.3 — Configuring Electronic Registration Card Templates][op-eregcfg] (opened)
- [OPERA Cloud 26.3 — Generating Batch Registration Cards][op-batchreg] (opened)
- [OPERA Cloud 26.3 — Managing Pre-Arrival Lookup Schedules][op-prearrival] (opened)
- [OPERA Cloud 26.3 — Managing Reservation Queue Status][op-queue] (opened)
- [OPERA Cloud 26.3 — Managing Reservation Upgrade Offers][op-upgrade] (opened)
- [OPERA Cloud 26.3 — Managing eSignature Registration Cards][op-esig] (opened)
- [OPERA Cloud 26.3 — Reservation Upgrade — Powered by Nor1 PRiME][op-nor1] (opened)
- [OPERA Cloud 26.3 — Using eFolio Exports][op-efolio] (opened)
- [OPERA Cloud 26.3 — Using the Mobile ID Document Scanner][op-idscanmob] (opened)
- [RMS Cloud — Canary Technologies module (guest experience and kiosk partner)][rms-canary] (search-located)
- [RMS Cloud — Digital check-in (digital registration card)][rms-digreg] (search-located)
- [RMS Cloud — Guest Portal self check-in][rms-selfci] (search-located)
- [RMS Cloud — Guest Portal self check-out][rms-selfco] (search-located)
- [RMS Cloud — Register device for digital check-in][rms-kioskdev] (search-located)
- [RoomRaccoon — How to upsell an add-on in the online check-in][rr-upsell] (search-located)
- [Stayntouch — Check-in with ID scanning / facial recognition][snt-idscan] (search-located)
- [Stayntouch — Guest Kiosk Check-In Settings][snt-kioskci] (search-located)
- [Stayntouch — Guest Kiosk General Settings][snt-kiosk] (search-located)
- [Stayntouch — Guest Kiosk Pick-Up Keys Settings][snt-kioskkeys] (search-located)
- [Stayntouch — Guest Mobility: contactless check-in/out][snt-mobility] (search-located)

[apaleo-guestjourney]: https://apaleo.dev/guides/business-cases/guest-journey/overview.html
[apaleo-upsell]: https://apaleo.dev/guides/business-cases/upsell/overview.html
[duve-app]: https://duve.com/duve-ai/hotel-guest-app/
[duve-gxp]: https://duve.com/guest-experience-platform
[duve-idscan]: https://support.duve.com/id-passport-scan/
[duve-oci]: https://duve.com/online-check-in
[infor-selfsvc]: https://www.infor.com/en-gb/news/infor-launches-contactless-hospitality-apps
[mews-dkey]: https://www.mews.com/en/products/marketplace/mews-digital-key
[mews-kiosk]: https://help.mews.com/s/article/what-are-mews-kiosks
[mews-kioskapi]: https://docs.mews.com/connector-api/use-cases/kiosk
[mews-kioskci]: https://help.mews.com/s/article/The-check-in-journey-in-Mews-Kiosk
[mews-kiosksetup]: https://help.mews.com/s/article/Setting-up-your-Mews-Kiosk
[mews-oci]: https://help.mews.com/s/article/The-online-check-in-journey-in-the-guest-portal
[mews-portal]: https://help.mews.com/s/article/what-is-online-guest-services
[mews-upsellci]: https://help.mews.com/s/article/How-to-offer-products-to-guests-during-online-check-in
[mews-upsells]: https://help.mews.com/s/article/How-to-create-upsells-to-increase-revenue-in-Mews-Operations
[op-advci]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_advance_checking_in_of_reservations.htm
[op-autoci]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_auto_check_in_of_advance_checked_in_reservations.htm
[op-batchreg]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_printing_registration_cards.htm
[op-efolio]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_using_efolio_exports.htm
[op-eregcfg]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_chain_and_property_configuring_electronic_registration_card_templates.htm
[op-esig]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_arrivals_in-house_managing_esignature_registration_cards.htm
[op-idscanmob]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_profiles_using_mobile_id_document_scanner.htm
[op-nor1]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_introduction_to_nor1_reserv_upgrade_powered_by_prime_in_cloud.htm
[op-prearrival]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_booking_workspace_managing_pre-arrival_lookup_schedules.htm
[op-queue]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_arrivals_in-house_adding_reservation_to_queue.htm
[op-upgrade]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_reservation_upgrade_offers.htm
[rms-canary]: https://support.rmscloud.com/hc/en-gb/articles/15373766345743-Canary-Technologies
[rms-digreg]: https://rms-help-centre.helpjuice.com/paperless-check-in-with-guest-portal/digital-check-in-reservation
[rms-kioskdev]: https://rms-help-centre.helpjuice.com/register-device-for-digital-check-in
[rms-selfci]: https://rms-help-centre.helpjuice.com/guest-portal-setup/guest-portal-self-check-in
[rms-selfco]: https://rms-help-centre.helpjuice.com/guest-portal-setup/guest-portal-self-check-out
[rr-upsell]: https://contact.roomraccoon.com/en/support/solutions/articles/150000009815-how-to-upsell-an-add-on-in-the-online-check-in
[snt-idscan]: https://stayntouch.freshdesk.com/support/solutions/articles/24000048295-check-in-with-id-scanning-facial-recognition-for-stayntouch-guest-kiosk-mobility
[snt-kiosk]: https://stayntouch.freshdesk.com/support/solutions/articles/24000075625-stayntouch-guest-kiosk-general-settings
[snt-kioskci]: https://stayntouch.freshdesk.com/support/solutions/articles/24000055074-stayntouch-guest-kiosk-check-in-settings
[snt-kioskkeys]: https://stayntouch.freshdesk.com/support/solutions/articles/24000075627-stayntouch-guest-kiosk-pick-up-keys-settings
[snt-mobility]: https://stayntouch.freshdesk.com/support/solutions/articles/24000055126-stayntouch-guest-mobility-your-tool-for-a-contactless-check-in-out-experience
