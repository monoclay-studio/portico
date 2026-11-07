# Guest-journey gap register

Status: v1 · 2026-11-07 · Every touchpoint marked **MISSING**, **partial** or **planned** in
[guest-journey-coverage.md](guest-journey-coverage.md), grouped into gaps with an owner, a priority and a delivery
approach. Gap ids `JG-nn` are stable (never renumber; retire with ~~strikethrough~~). They do not collide with the
adoption gaps `G-01…G-14` in `docs/adoption/gap-assessment.md`.

## 1. Conventions

- **Pri** — priority for a Maldives pilot: **P0** pilot-critical (or a documented manual alternative must exist
  before the pilot), **P1** needed for a convincing pilot / first resort, **P2** later. Segment exceptions in
  brackets (`G` guesthouse, `R` resort, `H` city hotel, `A` serviced apartments, `M` group).
- **Approach** — following the adoption brief ("retain systems they like"):
  **Build** (Portico native capability), **Integrate** (Portico defines the workflow; a specialist system does the
  work), **Both** (native for properties without a specialist system, connector for those that keep one — the
  property's choice is recorded like a data-authority choice so two systems never do the same job).
- **Owner** — the module that will hold the requirement. *New* modules are proposed by this audit: `access`,
  `guest-experience`, `crm` (spec `crm-marketing.md`), `contracting`, `guest-services`.
- **Specified in** — where the requirement now lives: a new spec section, or a spec change request `SCR-nn` in
  [spec-change-requests.md](spec-change-requests.md) (existing specs are not edited by this audit).
- **BOH** — back-of-house area audited separately (accounting/GL/AP, F&B POS and kitchen, procurement, stock,
  workforce/HR, utilities, concessions). Listed as a dependency, not specified here.

## 2. Register

| ID | Gap | Touchpoints | Owner | Approach | Pri | Dependencies | Specified in |
|---|---|---|---|---|---|---|---|
| JG-01 | **Keys and access credentials**: RFID cards, wristbands, mobile and wallet keys, PIN codes, mechanical-key register, pre-encoded key packets, key handling on room move, extension and checkout (incl. honest "expires at" for offline locks), lost keys, common-area access groups, door audit trail | T-C25, T-D11–D16, T-E25, T-E26, T-F11 | `access` (new) | Both: native key lifecycle + manual log; integrate lock systems (cloud API or local connector) | **P0** manual log, key-collection and room-move rules · P1 lock integration (R) · P2 wristbands, wallet, common areas (H/A: P1) | `integration` local connector (G-13, Q62); lock simulator (G-11); lock-vendor partner programmes (Q80); `access.key` effect (exists, PLT-R04); reservations `AccessPort` | [access.md](../specs/access.md); SCR-01, SCR-05, SCR-13, SCR-14 |
| JG-02 | **Tour-operator / DMC / wholesale contracting**: contracts, seasons, market-restricted net or commissionable rates, supplements and reductions, child/extra-bed policy, combinable offers with application order and proof, allotments (guaranteed / free sale / on request) and release, stop-sale notices with acknowledgement, booking intake with **contract check**, rooming-list and name changes, voucher verification, statements and remittances | T-A23–A28, T-B04, T-B24, T-C29, T-D31, T-G09 | `contracting` (new) | Build (compiles into `rates` and `groups`); integrate bedbanks/wholesalers via hub where supported | **P0** (R, G via DMCs) | `rates` SCR-16/17; `groups` SCR-40; `reservations` booking intake; `finance` receivables/statements; Q81 | [contracting.md](../specs/contracting.md); SCR-16, SCR-17, SCR-40 |
| JG-03 | **Guest portal** (web, no install): booking summary with truthful statuses, requests with live status, chat, itinerary, entitlement balances, digital folio, info and emergency numbers, express checkout, buyer/TIN details for invoices, post-stay downloads and claims | T-A18, T-C03, T-C31, T-E02, T-E04, T-E37, T-E46–E48, T-E57, T-F05, T-F10, T-G20 | `guest-experience` (new) | Build | P1 | Signed-link library (SCR-30); comms portal channel; payments hosted fields; finance folio read; resort itinerary | [guest-experience.md](../specs/guest-experience.md) |
| JG-04 | **Online check-in**: registration card per market, passport-exact names, document capture (photo/MRZ), e-signature with evidence, weights/baggage for seaplane manifests, staff review that feeds the desk checklist | T-C04–C06, T-C08, T-D07, T-D08 | `guest-experience` + `guests` + `reservations` | Build; optionally integrate an ID-verification vendor and desk scanners | P1 | Q43 (what may/must be stored); dependency 6.5 (ID verification); GUE-R05 encryption | guest-experience.md §3.3; SCR-13, SCR-21, SCR-37 |
| JG-05 | **Kiosk and assisted tablet mode** (find booking, ID, pay, key, check-out) | T-D30 (+T-D06) | `guest-experience` | Both: native kiosk app; card-present terminal and encoder integrations | P2 (H/A: P1) | Terminal workflow W-PAY-05 (Q2); `access` encoders | guest-experience.md §3.7; SCR-29 |
| JG-06 | **Upsell catalogue and offers** (upgrade ladder, early check-in/late checkout, transfers, experiences, celebrations, in-stay offers) with eligibility, inventory/capacity checks, approval mode and posting rules | T-C14, T-E59 (+T-B17) | `guest-experience` (presentation, catalogue) + `rates` (tax) + owning modules (fulfilment) | Build | P1 | RES-R23 upgrades; `rates.computeTaxes`; `guest-services` amenity orders | guest-experience.md §3.4 |
| JG-07 | **Booking confirmation document fit for the immigration desk and manifests**: registered establishment name, address and tourism licence/registration number, guest names as in passport, dates, reference, what is paid | T-B06, T-C10 | `reservations` (document data) + `comms` (delivery) + `platform` (licence number) | Build | **P0** | Visa on arrival needs a booking confirmation [V-web]; Q43 | SCR-04, SCR-12, SCR-30 |
| JG-08 | **Tax invoice within 3 days + delivery**: issuance-deadline monitor and Day Close exception, auto-issue at check-out by policy, e-mail/portal/print delivery with delivery status | T-F08, T-F09 | `finance` + `day-close` + `comms` | Build | **P0** | Q20/Q41 (live invoices still blocked until verified) | SCR-24, SCR-41 |
| JG-09 | **Charge privileges and credit limits per stay** (`allowed` / `cash_only` / `blocked`, per-folio limit tied to authorization, auto-increment request, all-inclusive coverage) enforced at POS lookup, outlet posting app and `postCharge` | T-D10, T-E09 | `finance` (+ `resort` RST-R01, POS workflow W-POS-01) | Build | **P0** (R) · P1 (G) | `payments` incremental authorization (PAY-R09); POS connectors (BOH) | SCR-23 |
| JG-10 | **Emergency muster, guest locator and continuity snapshot**: in-house occupants incl. children and special assistance, who is off property (excursion, transfer, sign-out), muster mode with headcount per assembly point, emergency contacts, offline snapshot | T-E42, T-E43, T-E57 | `guest-services` (new) | Build | **P0** list and snapshot · P1 muster mode and locator | Rollout §6 continuity snapshot (RO-09); `resort` transfer/activity events; staff-on-duty list (BOH workforce) | [guest-services.md](../specs/guest-services.md) §3.5 |
| JG-11 | **Allergy and dietary safety**: from booking/portal/check-in to every kitchen and outlet with **acknowledgement**, shown on POS guest lookup and outlet posting app, pre-arrival allergy list, consent-scoped sensitive data | T-C16, T-C30 | `guest-services` + `guests` + `integration` (W-POS-02) | Both: native alert/ack; POS/KDS display via integration (BOH) | **P0** | GUE-R02 sensitive data; POS/KDS (BOH) | guest-services.md §3.3; SCR-21, SCR-07 |
| JG-12 | **Green Tax day-block and tax-relevant ages**: Green Tax counted per 24-hour block with the ≥ 12 h check-out rule using actual check-in/out times (affects late checkout and day use); occupant ages verified at check-in (under-2 exemption) | T-D32, T-F04 | `rates` + `reservations` | Build | **P0** (Maldives) | maldives-tax-rules §5 [R]; Q20 item 1, Q41 | SCR-13, SCR-14, SCR-18 |
| JG-13 | **Registration and statistics capture**: nationality and document country per occupant (not only the booker), residency for market-restricted rates, guest-register fields per market | T-D33, T-B24 | `reservations` + `guests` | Build | **P0** (Maldives TIMS) | TIMS [R]; Q43 | SCR-13, SCR-21 |
| JG-14 | **Arrival preparation, amenity orders and celebrations**: requests become department tasks with due times before ETA; VIP setups, welcome amenities, decorations, cakes, couple ceremonies; cost routed to house, guest folio or tour operator; arrival/amenity lists; farewell amenities | T-A31, T-B10, T-C15, T-C17, T-C30, T-D21, T-E38, T-F20 | `guest-services` | Build | P1 | `operations` tasks; stock issue for amenities (BOH) | guest-services.md §3.1 |
| JG-15 | **Butler / guest host** assignment, coverage across shifts, conversation ownership, courtesy contacts, villa orientation checklist | T-C18, T-D20, T-E28 | `guest-services` (+ `comms` owner) | Build | P1 (R) | Rosters (BOH workforce) | guest-services.md §3.2; SCR-30 |
| JG-16 | **Complaints and service recovery** cases: severity, owner, compensation within approval limits (folio adjustment, amenity, comp night), follow-up after departure, history on the profile, links to surveys | T-E29, T-E30, T-G05 | `guest-services` | Build | P1 | IDN-R15 approvals; FIN-R10 adjustments | guest-services.md §3.4 |
| JG-17 | **Incident, security and damage log** with evidence (photos, witnesses, police/insurance references) and evidence-backed charges | T-E31, T-E33 | `guest-services` | Build | P1 | Q86 (records scope/retention) | guest-services.md §3.4 |
| JG-18 | **Medical clinic visits, clinic charges and medevac coordination** — minimal, restricted data; clinical notes stay in the clinic's own records | T-E32 | `guest-services` (+ concessions, BOH) | Both | P1 (R) | Q86; clinic concession (BOH) | guest-services.md §3.4 |
| JG-19 | **Dining and venue reservations**: venues, table plans and slots, covers, turn times, walk-ins and waitlist, meal-plan and allergy awareness, special dinners with resources and weather alternates, deposits/no-show fees, external table systems | T-C22, T-E05, T-E07 | `guest-services` (RST-R09 delegated) | Both: native; integrate table-reservation systems (H) | P1 | `resort` itinerary (events); `rates` meal-plan entitlements | guest-services.md §3.6; SCR-33 |
| JG-20 | **Minibar and honour bar**: catalogue and par per unit type, consumption posting, audits, departure check, late detection after checkout, disputes, AI-tier coverage, replenishment request | T-E11, T-E12, T-F13 | `guest-services` (OPS-R08 delegates) | Build; minibar sensors integrate (P2) | P1 | Stock (BOH); FIN-R25 late charges | guest-services.md §3.7; SCR-32 |
| JG-21 | **Laundry and valet orders**: price list, express, pick-up/delivery tasks, damage/loss claims, package allowances | T-E13 | `guest-services` | Build | P1 (R) | Outsourced laundry (BOH) | guest-services.md §3.7 |
| JG-22 | **Luggage and bell desk**: tags, delivery to unit, seaplane baggage, left-luggage with claim ticket, departure collection timed to transfer | T-D18, T-F12 | `guest-services` | Build | P1 (R/H) | `resort` transfer times | guest-services.md §3.8 |
| JG-23 | **Buggy and on-property transport dispatch** | T-D19 | `guest-services` | Build | P2 | — | guest-services.md §3.8 |
| JG-24 | **Concierge and third-party bookings** (supplier directory, references, vouchers, paid-outs, commission receivable) | T-E20 | `guest-services` + `finance` | Build | P2 | FIN-R38 paid-outs; SCR-27 commission receivable | guest-services.md §3.8; SCR-27 |
| JG-25 | **Wake-up calls and telephony**: native wake-up schedule with unanswered → visit escalation; PBX integration (name, language, DND, wake-up, call records posting, room-status dial codes) | T-D29, T-E21, T-E22 | `guest-services` + `integration` | Both | P1 wake-up · P2 PBX | Local connector, legacy protocol licensing (Q62) | guest-services.md §3.7, §3.9; SCR-07 |
| JG-26 | **Wi-Fi**: per-stay or per-unit credentials shown in portal and welcome card; gateway integration (room + surname auth, tiers, posting, deactivation at checkout) | T-D17, T-E23 | `guest-services` + `integration` | Both | P1 credentials · P2 gateway | Wi-Fi gateway vendors (FIAS-style) | guest-services.md §3.9; SCR-07 |
| JG-27 | **In-room systems**: IPTV (welcome, folio, express checkout), GRMS sensors (DND/make-up room, occupancy) | T-E24, T-E36 | `integration` (workflows declared in `guest-services`) | Integrate | P2 | Local connector | guest-services.md §3.9; SCR-07, SCR-32 |
| JG-28 | **Airport meet and greet**: representative assignment, arrivals board by flight, lounge allocation; flight-status feed | T-D01, T-D02 | `resort` | Build; integrate a flight-data provider later | P1 (R) · P2 feed | Q85 (paid feed) | SCR-35 |
| JG-29 | **Seaplane daylight cut-off, transit nights and flight-timed departures**: detect arrivals too late for a seaplane, propose domestic flight + speedboat or a Malé/Hulhumalé transit night (sister property or external hotel with voucher), plan departure legs from the outbound flight | T-C12, T-C13, T-E26, T-F01, T-F23 | `resort` (+ `reservations`) | Build | P1 (R) | Operator cut-off times are policy data [V-web secondary] | SCR-34 |
| JG-30 | **Kids club** registration (guardian, authorized pick-up, allergies, age group) and attendance sign-in/out | T-C19, T-E18 | `resort` | Build | P1 (R) | GUE sensitive data | SCR-36 |
| JG-31 | **Diving specifics**: certification record and verification, last-dive/refresher rule, medical statement, regulatory limits as data (30 m), equipment sizes, nitrox, dive log; dive centre often a concession with its own system | T-C20, T-E16 | `resort` | Both | P1 | Dive-centre systems / concessions (BOH) | SCR-36 |
| JG-32 | **Equipment and item loans** (towel cards, snorkel gear, bikes, adapters) with deposits/charges on non-return | T-E17 | `guest-services` | Build | P2 | — | guest-services.md §3.7 |
| JG-33 | **Structured requests, emergency contact, special assistance and travel insurance** captured once and propagated | T-B09, T-C26, T-C27, T-D34 | `reservations` + `guests` | Build | P1 | Continuity snapshot needs emergency contacts (rollout §6) | SCR-10, SCR-21 |
| JG-34 | **Ancillary inventory** (cots, extra beds, rollaways, parking spaces) with nightly capacity and pricing | T-B13 | `inventory` + `rates` | Build | P1 | — | SCR-20 |
| JG-35 | **Day use**: day rooms before readiness, departure lounge/showers after checkout, day passes and day visits | T-A37, T-D23, T-F03 | `inventory` (INV-R30 earlier) + `guest-services` | Build | P2 | Green Tax on day use (Q20 item 1) | SCR-20; guest-services.md §3.8 |
| JG-36 | **Leisure quotes and enquiry linkage**: conversation → inquiry; multi-option quote document with hold and expiry, online acceptance with payment link, follow-up and lost reasons | T-A20, T-A21 | `reservations` + `guest-experience` + `comms` | Build | P1 (G: high) | INV-R15 holds; PAY-R19 links | SCR-11; guest-experience.md §3.4 |
| JG-37 | **Manage my booking**: guest-permitted changes (add night, add extras, change arrival details, cancel within policy) as previewed changes; policy decides instant vs request | T-B14 | `guest-experience` + `reservations` | Build | P1 | RES-R11 previews; channel-owned fields stay with the channel (RES-R14) | guest-experience.md §3.2; SCR-15 |
| JG-38 | **IMUGA and entry-requirement guidance** (templates and portal checklist; never submits on the guest's behalf) | T-C09, T-C10 | `comms` + `guest-experience` | Build | P1 | Official portal only [V-web] | SCR-30; guest-experience.md §3.2 |
| JG-39 | **Surveys and NPS**: in-stay pulse, post-stay, low-score alert → service recovery, results by department/outlet | T-E28, T-E56, T-F20, T-F22, T-G02 | `crm` (new) | Both (native; integrate survey/CRM vendors that a group keeps) | P1 | Sender register (CR-9); `guest-services` cases | [crm-marketing.md](../specs/crm-marketing.md) §3.3 |
| JG-40 | **Reputation management**: review aggregation (OTAs, Google, TripAdvisor), sentiment/topics, reply drafting and approval, publication or copy-to-platform | T-G04 | `crm` + `integration` | Both | P1 | Hub reviews add-on (readiness §5 baseline +$7/property); Google Business Profile access; Q82 | crm-marketing.md §3.4; SCR-04 (effect `reputation.publish`) |
| JG-41 | **Review solicitation** for direct/agency guests within platform policies | T-G03 | `crm` | Build | P1 | Platform review policies | crm-marketing.md §3.4 |
| JG-42 | **Segmentation, consent-gated campaigns and lifecycle journeys** (post-stay, anniversary, win-back, remarketing) | T-G14, T-G15 | `crm` | Both (native basic; integrate Salesforce/others for groups) | P2 | `usage.messages` (Q45); WhatsApp marketing template costs [V-web] | crm-marketing.md §3.1–3.2; SCR-31 |
| JG-43 | **Abandoned-booking recovery** | T-B22 | `crm` + `distribution` | Build | P2 | Consent at capture | crm-marketing.md §3.2; SCR-39 |
| JG-44 | **Recognition tiers and benefits** (points later) | T-A14, T-G13 | `crm` | Build; integrate brand programmes | P2 | Q87 (points programme) | crm-marketing.md §3.5 |
| JG-45 | **Gift vouchers** (monetary and experience): sale, delivery, redemption as tender, expiry, breakage, liability | T-A15, T-G21 | `crm` + `finance` + `payments` | Build | P2 | Q83 (tax/expiry rules) | crm-marketing.md §3.6; SCR-26, SCR-29 |
| JG-46 | **Travel-agent / tour-operator commission processing**: accrual at departure, rules for no-shows and cancellations, statements, payment-run export | T-G10 | `contracting` + `finance` | Build (payment execution in AP, BOH) | P1 | AP (BOH) | contracting.md §3.6; SCR-27 |
| JG-47 | **Gratuities and tips**: charge-code group outside revenue and outside GST base; export for staff distribution | T-F16 (T-F17 BOH) | `finance` | Build | P1 | Payroll distribution (BOH) | SCR-25 |
| JG-48 | **Booking-engine hardening**: bot and card-testing protection, fraud signals, privacy notice and cookie consent, marketing-consent UI, attribution capture | T-A05–A07, T-B16, T-B25 | `distribution` | Both (PSP risk tooling) | P1 abuse/consent · P2 attribution | PSP capabilities (Q2) | SCR-39 |
| JG-49 | **Property content catalogue** (texts, photos, amenities, policies, local rules) reused by booking engine, portal, Google, OTAs; indicative guest-currency display | T-A02, T-A11, T-A36 | `distribution` | Build; hub content APIs later | P1 · P2 OTA sync | Hub content capability (unverified) | SCR-38 |
| JG-50 | **Website/CMS and paid metasearch** — hotels keep their website; Portico supplies an embeddable booking widget, deep links and a hosted single-page fallback | T-A01, T-A09 | `distribution` | Integrate (metasearch later) | P2 | Metasearch partners | SCR-38 |
| JG-51 | **Rate parity monitoring** (Portico's own outbound rates vs direct; external shopping) | T-A12 | `distribution` | Both | P2 | Rate-intelligence vendors | SCR-39 |
| JG-52 | **Multi-property search, central reservations, inter-property dine-around** | T-A33, T-A34, T-E58 | `distribution`, `reservations`, `resort` | Build | P2 (M) | `portfolio.centralReservations` | SCR-39 (existing LATER items) |
| JG-53 | **Lost-and-found shipping**: address capture, courier booking reference, customs value, guest payment request | T-G06 | `operations` | Build | P2 | Couriers | SCR-32 |
| JG-54 | **Long-stay / serviced-apartment needs**: rental agreement e-signature, damage deposit held and settled after inspection, recurring weekly/monthly billing, metered utilities recharge, condition reports with photos, parcels | T-C32, T-D35, T-E53, T-E54 | `finance`, `rates`, `guest-services` | Build (meter readings from BOH utilities) | P2 (A: P1) | Utilities (BOH) | SCR-19, SCR-28; guest-services.md §3.8 |
| JG-55 | **Parking and valet** | T-E52 | `guest-services` | Both (integrate parking systems) | P2 (H: P1) | Parking systems | guest-services.md §3.8 |
| JG-56 | **Visitors and day guests** log | T-E51 | `guest-services` | Build | P2 | — | guest-services.md §3.8 |
| JG-57 | **Guest-facing AI** (concierge answers, auto-replies) | T-A35 | `ai` | Build, gated | P2 | Q84, Q25 | SCR-43 |
| JG-58 | **Guest folio queries and disputes** raised before payment (portal or desk), tracked to resolution | T-F06 | `guest-experience` + `guest-services` + `finance` | Build | P1 | FIN-R10 | guest-experience.md §3.6; guest-services.md §3.4 |
| JG-59 | **Phone enquiries and caller identification** (CTI) | T-A19 | `integration` + `comms` | Integrate | P2 | PBX/CTI vendors | SCR-07 |
| JG-60 | **Self check-in for late arrivals**: instructions, PIN or lockbox code released only after guarantee and identity checks, emergency contact | T-C33 (+T-D15) | `access` + `guest-experience` + `comms` | Build; smart-lock integration | P1 (G/A) | Smart-lock vendors | access.md §3.3; guest-experience.md §3.3 |
| JG-61 | **OTA commission invoice reconciliation** (OTA monthly invoice vs bookings and cancellations) | T-G11 | AP (BOH) with `distribution` data | BOH | P2 | BOH accounting/AP | Reference only |
| JG-62 | **Corporate RFP process** (annual rate negotiation, RFP platforms) | T-A29 | `groups` sales pipeline | Build; integrate RFP platforms later | P2 (H) | — | SCR-40 |

## 3. Gaps by approach

| Approach | Gaps |
|---|---|
| **Build only** | JG-02 (core), 03, 04 (core), 06, 07, 08, 09, 10, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 28 (core), 29, 30, 32, 33, 34, 35, 36, 37, 38, 41, 43, 46, 47, 53, 54, 56, 57, 58, 60, 62 |
| **Both** (native default; connector for hotels that keep a specialist) | JG-01 locks, 05 kiosk hardware, 11 POS/KDS display, 18 clinic, 19 table systems, 20 minibar sensors, 25 PBX, 26 Wi-Fi, 31 dive systems, 39 survey vendors, 40 review platforms, 42 external CRM, 44 brand loyalty, 45 voucher tender, 48 PSP risk, 49 OTA content, 51 rate shopping, 55 parking |
| **Integrate only** | JG-27 IPTV/GRMS, JG-50 website and metasearch, JG-59 CTI |
| **BOH reference** | JG-61 (and the BOH dependencies named per row) |

"Both" never means two systems doing the same job at one property: the property chooses native or connector per
capability during setup, and that choice is enforced the same way as data authority (one key issuer, one survey
sender, one table-reservation system of record — SCR-05).

## 4. Gaps by priority

- **P0 (9):** JG-01 (manual key log, key collection, room-move rules), JG-02, JG-07, JG-08, JG-09, JG-10 (list +
  snapshot), JG-11, JG-12, JG-13 — plus the P0 parts of existing specs already listed as specified in the coverage
  map (e.g. T-B05, T-D06, T-E06). Every P0 gap has a manual alternative described in its spec for the period before
  it is built, so a pilot is never blocked by software alone — but each manual alternative must be written into the
  pilot's operating procedures (readiness launch checklist).
- **P1 (32):** JG-03, 04, 06, 14–22, 25 (wake-up), 26 (credentials), 28–31, 33, 34, 36–41, 46, 47, 48 (abuse,
  consent), 49, 58, 60.
- **P2 (21):** JG-05, 23, 24, 27, 32, 35, 42–45, 50–57, 59, 61, 62 and the P2 parts of P0/P1 gaps.

## 5. Dependencies on the back-of-house audit

| BOH area | Guest-journey hand-off | Gaps |
|---|---|---|
| F&B POS and kitchen | Room-charge eligibility with charge privileges; allergy alerts on guest lookup and kitchen tickets; in-villa dining orders; meal-plan consumption | JG-09, JG-11, JG-19, JG-03 (digital ordering) |
| Stock and procurement | Amenity items, minibar replenishment, laundry consumables issued against guest orders | JG-14, JG-20, JG-21 |
| Workforce / HR | Butler and duty rosters; staff on duty for muster; tip and service-charge distribution | JG-10, JG-15, JG-47 |
| Concessions | Spa, dive centre, photography, clinic, boutique run by third parties posting to folios and earning commission | JG-18, JG-31, T-E41 |
| Utilities | Metered electricity/water for long stays recharged to guests | JG-54 |
| Accounting / AP | Commission payment runs; OTA commission invoices; voucher liability in the GL | JG-46, JG-61, JG-45 |
