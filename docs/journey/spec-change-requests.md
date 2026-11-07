# Spec change requests from the guest-journey audit

Status: v1 · 2026-11-07 · Proposed changes to **existing** documents. This audit does not edit existing specs; the
owning module's spec author (or the architecture steward for the domain map and glossary) applies, adjusts or
rejects each request and records the outcome here. Requirement ids below are suggestions — the spec owner assigns
the final ids (never renumbering existing ones).

Columns: **Pri** = Maldives-pilot priority of the gap it serves; **Gap** = [gap-register.md](gap-register.md) id.

## 1. Summary

| SCR | Target document | Change in one line | Gap | Pri |
|---|---|---|---|---|
| SCR-01 | `docs/architecture/domain-map.md` | Add modules `access`, `guest-experience`, `crm`, `contracting`, `guest-services`; arrows; ports | all new | P0 |
| SCR-02 | `docs/product/glossary.md` | Add terms (Credential, Encoder, Contract, Offer, Stop-sale, Service case, Venue reservation, …) | all new | P0 |
| SCR-03 | `docs/product/editions.md` | New entitlement keys and pack membership | all new | P1 |
| SCR-04 | `docs/specs/platform.md` (+ kernel effects) | New external effects, outlet kinds, departments, establishment registration number | JG-07, 40, 42, 02 | P0 |
| SCR-05 | `docs/adoption/source-of-truth-matrix.md` | CR-11 one key issuer; sender-register entries for surveys/reviews/marketing; one venue system per outlet | JG-01, 39–42, 19 | P0 |
| SCR-06 | `docs/scenarios/README.md` | Journey scenarios J01–J12 | many | P1 |
| SCR-07 | `docs/specs/integration.md` | New workflow identifiers; POS lookup returns allergy alerts and charge privileges | JG-01, 09, 11, 25–27, 40, 59 | P0 |
| SCR-08 | `docs/adoption/integration-coverage-matrix.md` | New workflow rows and provider facts for locks, PBX, Wi-Fi, reviews, flight data, table systems | JG-01, 25–28, 40 | P1 |
| SCR-09 | `docs/readiness/dependency-register.md` | New dependencies (review sources, flight data, smart locks, PBX/Wi-Fi/IPTV, table systems); lock facts | JG-01, 25–28, 40 | P1 |
| SCR-10 | `docs/specs/reservations.md` | Structured requests and occasions | JG-14, 33 | P1 |
| SCR-11 | `docs/specs/reservations.md` | Leisure quote documents; inquiry from a conversation | JG-36 | P1 |
| SCR-12 | `docs/specs/reservations.md` | Confirmation document fit for immigration and manifests | JG-07 | P0 |
| SCR-13 | `docs/specs/reservations.md` | Check-in steps: per-occupant nationality, tax-relevant ages, offer proof, pre-check-in import, access outcomes | JG-04, 12, 13, 01 | P0 |
| SCR-14 | `docs/specs/reservations.md` | `AccessPort`; actual check-in/out timestamps in events | JG-01, 12 | P0 |
| SCR-15 | `docs/specs/reservations.md` | Guest-permitted changes policy; guest-initiated checkout request | JG-37, 03 | P1 |
| SCR-16 | `docs/specs/rates.md` | Promotion extensions for contracts (base, order, compounding, benefits, proof, matrix, managed objects) | JG-02 | P0 |
| SCR-17 | `docs/specs/rates.md` | Dated compulsory supplements; market/residency and member eligibility; per-person derivation | JG-02, 44 | P0 |
| SCR-18 | `docs/specs/rates.md` | Green Tax day-block fee kind (12-hour check-out rule) | JG-12 | P0 |
| SCR-19 | `docs/specs/rates.md` | Long-stay pricing and recurring posting rhythms | JG-54 | P2 (A: P1) |
| SCR-20 | `docs/specs/inventory.md` | Ancillary inventory items; day-use slices earlier | JG-34, 35 | P1 |
| SCR-21 | `docs/specs/guests.md` | Emergency contacts, special assistance, per-occupant nationality, document capture source, guardians | JG-04, 10, 13, 33 | P0 |
| SCR-22 | `docs/specs/guests.md` | Consent purposes `feedback`, `review_invitation` | JG-39, 41 | P1 |
| SCR-23 | `docs/specs/finance.md` | Charge privileges and credit limits per stay/folio | JG-09 | P0 |
| SCR-24 | `docs/specs/finance.md` | 3-day invoice deadline monitor, auto-issue and document delivery | JG-08 | P0 |
| SCR-25 | `docs/specs/finance.md` | Gratuity charge-code group outside revenue and GST base | JG-47 | P1 |
| SCR-26 | `docs/specs/finance.md` | Stored-value vouchers as liabilities | JG-45 | P2 |
| SCR-27 | `docs/specs/finance.md` | Commission payable processing; supplier commission receivable | JG-46, 24 | P1 |
| SCR-28 | `docs/specs/finance.md` | Damage/security deposits and periodic (long-stay) billing | JG-54 | P2 (A: P1) |
| SCR-29 | `docs/specs/payments.md` | Voucher tender adapter; card-present terminal workflow for kiosk/express checkout | JG-45, 05 | P2 |
| SCR-30 | `docs/specs/comms.md` | Market content packs and templates; signed guest links; portal channel; host ownership | JG-07, 38, 03, 15, 60 | P0 |
| SCR-31 | `docs/specs/comms.md` | Non-goal update: campaigns and reputation move to `crm`; marketing send path | JG-42 | P2 |
| SCR-32 | `docs/specs/operations.md` | Minibar delegated; lost-and-found shipping; new task kinds; GRMS inbound | JG-20, 53, 27 | P1 |
| SCR-33 | `docs/specs/resort.md` | Dining reservations delegated to `guest-services`; itinerary consumes its events | JG-19 | P1 |
| SCR-34 | `docs/specs/resort.md` | Seaplane daylight cut-off, transit nights, flight-timed departures | JG-29 | P1 |
| SCR-35 | `docs/specs/resort.md` | Airport meet and greet, arrivals board, lounge; flight-status hook | JG-28 | P1 |
| SCR-36 | `docs/specs/resort.md` | Kids club registration/attendance; diving specifics; medical eligibility blocks | JG-30, 31 | P1 |
| SCR-37 | `docs/specs/resort.md` | Passenger data from the guest portal with purpose-limited retention | JG-04 | P1 |
| SCR-38 | `docs/specs/distribution.md` | Property content catalogue; guest-currency display; booking widget and voucher shop | JG-49, 50, 45 | P1 |
| SCR-39 | `docs/specs/distribution.md` | Booking-engine hardening, consent, attribution, abandoned checkout, voucher redemption, group search, parity | JG-43, 48, 51, 52 | P1 |
| SCR-40 | `docs/specs/groups.md` | Allotment engine extensions for contracting; corporate RFP pipeline kind | JG-02, 62 | P0 |
| SCR-41 | `docs/specs/day-close.md` | New exceptions (invoice deadline, keys, minibar checks, allergy acks, snapshot freshness) | JG-01, 08, 11, 20, 10 | P0 |
| SCR-42 | `docs/specs/analytics.md` | Journey metrics (NPS, reviews, upsell, contracts, service recovery, TIMS export) | JG-39, 40, 06, 02 | P1 |
| SCR-43 | `docs/specs/ai.md` | Guest-facing drafting and gated guest-facing answers | JG-57, 40 | P2 |
| SCR-44 | `docs/specs/identity.md` | Guest principals, device sessions, new role templates | JG-03, 05 | P1 |
| SCR-45 | `docs/readiness/readiness-register.md`, `docs/product/personas-and-workspaces.md` | Readiness rows for new capabilities; new personas | all new | P1 |

## 2. Details

### Cross-cutting

**SCR-01 — Domain map.** Add catalog rows:
`access` (schema `access`) — credentials, lock-system profiles, encoders, key operations, key packets, mechanical
keys (wave 2/3) · `guest-experience` (schema `guest_experience`) — guest links, sessions, pre-check-in submissions,
signature evidence, upsell catalogue/offers, kiosk devices (wave 3) · `crm` (schema `crm`) — segments, campaigns,
journeys, surveys/responses, reviews/replies, recognition tiers, voucher products/sales (wave 3/4) · `contracting`
(schema `contracting`) — contracts/versions, notices, booking checks, statements (wave 2/3) · `guest-services`
(schema `guest_services`) — preparation plans, amenity orders, hosts, allergy alerts/acks, cases, incidents, muster,
venue reservations, minibar, laundry, wake-up, logistics (wave 2–4). Dependency arrows (no cycles — checked):
`reservations ─► access (AccessPort)`; `access ─► integration, inventory, finance, operations, platform`;
`guest-experience ─► reservations, guests, payments, finance, comms, operations, guest-services, resort, access, rates,
crm, distribution, platform, identity`; `crm ─► guests, comms, guest-services, finance, payments, ai, integration,
platform`; `contracting ─► rates, groups, inventory, guests, reservations, finance, comms, distribution, platform`;
`guest-services ─► operations, finance, reservations, guests, comms, payments, inventory, integration, platform`.
Rules: `resort` itinerary consumes `guest-services` events (no `resort ─► guest-services` call); `comms` renders guest
links through the shared signed-link library (no `comms ─► guest-experience` call); voucher balances live in
`finance` so `payments` (tender) and `crm` (sale) both depend on `finance` only. Add the ports and functions listed in
each new spec's §6.

**SCR-02 — Glossary.** Add: **Credential** (a key of any kind issued for a stay, unit set and validity window),
**Encoder**, **Key packet**, **Access group**; **Guest link**, **Online check-in** (pre-check-in submission),
**Upsell offer**, **Kiosk**; **Contract** (tour-operator/DMC agreement compiled into rates and allotments),
**Contract version**, **Season** (contract date range — distinct from rates' named date patterns), **Offer**
(contract-level price rule; compiled into a *promotion*), **Combinability**, **Supplement**, **Release period**,
**Free sale / On request / Guaranteed allotment**, **Stop-sale notice**, **Contract check**, **Statement**;
**Segment**, **Campaign**, **Journey** (marketing), **Survey**, **NPS**, **Review**, **Recognition tier**, **Voucher**;
**Arrival preparation plan**, **Amenity order**, **Guest host** (butler), **Allergy alert**, **Service case**,
**Incident**, **Muster**, **Guest locator**, **Venue reservation**. Mark *Promotion* vs *Offer* explicitly (rates vs
contracting) to avoid two words for one thing in the UI: staff see "Offer" only inside contracting screens.

**SCR-03 — Editions.** New keys (default editions in brackets, to be confirmed with Q3): `access.keys` (all),
`integration.locks` (Professional+), `access.mobileKeys` (add-on), `access.commonAreas` (Resort, Enterprise),
`guest.portal`, `guest.onlineCheckIn`, `guest.upsells` (all), `guest.kiosk` (add-on), `crm.surveys`,
`crm.reputation` (all), `crm.campaigns`, `crm.recognition` (Professional+), `crm.vouchers` (add-on),
`contracting.contracts` (Professional+; Essentials add-on), `guestServices.core` (all), `guestServices.inRoom` (all,
hidden by profile), `guestServices.venues`, `guestServices.logistics` (Professional+), `integration.inRoomSystems`
(add-on). Connect-plan packs: add a **Guest Experience** pack (`guest.portal`, `guest.onlineCheckIn`,
`guest.upsells`) and a **Reputation & Feedback** pack (`crm.surveys`, `crm.reputation`); `guestServices.core` joins the
Housekeeping & Maintenance pack. Never gate safety: allergy alerts, guest list/continuity snapshot and the manual key
log belong on the never-gated list.

**SCR-04 — Platform (and `packages/kernel/src/environment.ts`).** Effects: add `message.marketing` (separately
cappable and blockable from operational `message.guest`), `message.partner` (stop-sale notices, statements to
tour operators), `reputation.publish` (public review replies); all simulate outside live. Outlet kinds: add `clinic`,
`laundry`, `kids_club`, `minibar`, `concierge`, `parking`. Department template: add Security and Guest Relations for
`resort`/`hotel` profiles. Property attributes: `tourismRegistration` (licence/registration number and name as
registered — printed on confirmation documents, JG-07). Register new policy keys from the new specs.

**SCR-05 — Source-of-truth matrix (adoption).** Add **CR-11 One key issuer per lock system**: exactly one system
(Portico `access` or the PMS's lock interface) issues guest credentials to a given lock system at a property; Portico
refuses to activate a lock connection when the setup declares another issuer. Extend **CR-9** sender register with
types `survey_post_stay`, `survey_in_stay`, `review_invitation`, `marketing_campaign`, `abandoned_booking`,
`stop_sale_notice`. Add **CR-12 One system of record per venue** for table reservations. State in §2 that credentials
belong to the lock system and Portico is the requesting system.

**SCR-06 — Scenarios.** Add a §5 "Guest-journey scenarios" (test names `scenarios/jNN-*.test.ts`): J01 online
check-in for a family (portal → manifest → desk import); J02 upsell race for the last villa; J03 express checkout with a
queried minibar line and invoice delivery within the deadline; J04 room move at 22:00 with offline locks; J05
duplicate-key request refused; J06 detractor pulse → case → recovery → review reply; J07 voucher sale, partial
redemptions, expiry and breakage reconcile; J08 voucher contract check with combinable offers; J09 stop-sale timing;
J10 allergy alert acknowledgement and escalation; J11 night muster during an outage; J12 complaint with compensation
above limit. Each follows the existing template (Pre, Steps, State, Money, Inventory, Audit, Recovery, Modules, Test).

**SCR-07 — Integration spec (INT-R02).** New workflow identifiers: `keyEncoders`, `doorAuditTrail`,
`mobileCredentials`, `pinCodes` (with existing `doorKeys`), `telephony`, `wifi`, `inRoomSystems`, `flightStatus`,
`tableReservations`, `surveys`, `crmProfiles`, `identityVerification`, `contracts` (rate-sheet/booking exchange with
wholesalers), mapping kind `lockDoor` (safety-relevant → review required, INT-R11 extended). `posCharges` guest lookup
(W-POS-01/02) **returns charge privilege, available credit and active allergy alerts**; a POS that cannot display
alerts is flagged in the catalogue ("allergy alerts not shown at this POS — kitchen list only").

**SCR-08 — Integration coverage matrix.** Add workflows W-LOCK-05 audit trail, W-LOCK-06 encoders, W-LOCK-07 PIN codes,
W-TEL-01..04 (extension, name, wake-up, call records), W-WIFI-01..03 (auth, tiers posting, deactivation),
W-IRS-01/02 (IPTV, GRMS), W-FLT-01 (flight status), W-TBL-01 (table reservations), W-REV-01/02 (review read, reply
publish), W-IDV-01 (document verification). Update §5.6 lock rows with the facts verified 2026-11-07 in
`docs/journey/guest-journey-coverage.md` §1.4 (Vostio cloud API; Salto Space TCP/IP PMS interface and JustIN licence;
dormakaba Ambiance interfaces, LEGIC requirement, no remote unlock). Segment table: Door locks for S2 stays `E` with
the manual key log as the documented alternative.

**SCR-09 — Dependency register.** New entries (all `[quote required]`/`[unconfirmed]` until verified): review sources
(Google Business Profile API, TripAdvisor content/review APIs, Channex reviews add-on), flight-status data providers
(Q85), smart-lock vendors or aggregators, PBX/call-accounting, Wi-Fi gateways, IPTV and GRMS vendors (local connector),
table-reservation systems, ID-verification vendors (extend 6.5), courier services for lost-and-found shipping. Update
6.1 with the lock facts above and Q80.

### Reservations

**SCR-10 — Structured requests.** Replace free-text-only `special requests` with structured request items: category
(`bed`, `dietary`, `allergy` (sensitive → GUE-R02), `accessibility`, `occasion`, `amenity`, `arrival`, `housekeeping`,
`other`), detail, source, guest-visible status (`requested → confirmed | declined → done`), owning department (from
policy), link to the `guest-services` preparation task. Occasions carry date and proof flag. Free text remains as a
note.

**SCR-11 — Quotes and enquiries.** Add a **quote document** for `quoted`/`held` bookings: up to N options (unit type,
rate plan, price, inclusions, policies from the quote's terms), hold expiry (INV-R15), payment request for the deposit
(PAY-R19), guest acceptance via `guest-experience` (GXP-R18) with evidence; lost reasons on `declined`/`expired`; a
`comms` conversation can create an inquiry pre-filled from the conversation (dates, party) and stays linked.

**SCR-12 — Confirmation document.** `getConfirmationDocument(tx, { bookingId, language })` with market-required
fields: establishment name and address as registered with the tourism authority and its registration number
(SCR-04), guest names as in passport (from occupants; "names to follow" shown explicitly), dates, unit type, meal
plan, transfer if booked, booking reference, payment status in truthful words. Delivered by `comms` with the
confirmation and available in the portal. Rationale: visa on arrival requires a booking confirmation [V-web].

**SCR-13 — Check-in steps.** In RES-R24: `registration` collects nationality and document country **per occupant**
(TIMS — JG-13) and imports portal submissions (`importPreCheckIn`, GXP-R14) as `done (guest)`; `documents` verifies
**tax-relevant ages** (date of birth for children; under-2 Green Tax exemption — JG-12) and offer **proof** required by
contracts (CTR-R09); `access` calls `AccessPort.issueKeys` and records per-credential outcomes; RES-R27 `access` step
records end outcomes (`cancelled`, `expires_at`, `collected`, `outstanding`) instead of a single "deactivate keys".

**SCR-14 — Access port and timestamps.** Declare `AccessPort` (access spec §6) in reservations ports. Add
`checkedInAt`/`checkedOutAt` (UTC instants) to `reservations.stay.checkedIn|checkedOut` events and stay records so the
Green Tax day-block rule (SCR-18) and key validity use actual times.

**SCR-15 — Guest-permitted changes.** Policy `reservations.guestChanges` listing change kinds a guest may make
(`addNights`, `removeNights`, `occupancy`, `extras`, `arrivalDetails`, `cancel`) with mode `instant | request |
not_allowed`, never for channel-owned fields (RES-R14) or contract-managed commercial terms; `requestCheckOut(tx, {
stayId, initiator: 'guest_portal' | 'kiosk' | 'tv' })` creates a checkout request the desk or an automation completes.

### Rates and inventory

**SCR-16 — Promotion extensions.** RAT-R11: add **application base** (`room` | `room_and_meal` |
`room_meal_and_compulsory` | `all_including_transfers`), **application order** (integer), **compounding** (`sequential`
| `additive`), **combinability matrix** (pairwise, plus `best_of` groups) replacing the single exclusive flag (keep it
as a shorthand), **non-monetary benefits** (upgrade to unit type, inclusion/package added, allowance granted), **proof
requirement** (kind, validity window) creating a check-in item, **per-night stay-window applicability**, booking-date
reference for amendments, and a `managedBy` marker (contract id/version) making the object read-only in rates.

**SCR-17 — Supplements and eligibility.** Inclusion rhythm `specific_dates[]` for compulsory supplements (gala
dinners) with adult/child-band amounts; eligibility by **source market** (guest residency or nationality as the
contract defines) checked at quote time with the market supplied by the booker; RAT-R10 member-only eligibility
promoted from LATER to SHOULD with `crm` recognition tiers; derived plans may use **per-person** amounts (meal-plan
supplements) in addition to per-unit amount/percent.

**SCR-18 — Green Tax day block.** New fee kind `per_person_day_block`: count 24-hour blocks from actual check-in time;
the check-out block counts if ≥ `minHoursInLastBlock` (12) were spent; age exemption (< 2); applies to complimentary
stays; uses SCR-14 timestamps, with the planned-times estimate at quote/preview labelled *estimate* until checkout.
Day-use treatment remains Q20 item 1. Source: `docs/readiness/maldives-tax-rules.md` §5.

**SCR-19 — Long stays.** Weekly/monthly price bases (price per 7/30 nights with proration rule), posting rhythm
`period_in_advance` (weekly/monthly) producing periodic invoices (SCR-28), and length-of-stay tax exemptions
(already expressible via stay-length applicability, RAT-R22) documented as the long-stay pattern.

**SCR-20 — Ancillary inventory and day use.** INV: **ancillary items** (cots, extra beds, rollaways, parking spaces,
departure-lounge seats) with nightly (or slot) capacity per property, consumed by stays with the same ledger semantics
(`consume`/`release`, last-item concurrency) and priced via rates inclusions or charge codes. Move INV-R30 (time-sliced
inventory for day rooms/day passes) from LATER to SHOULD for wave 4.

### Guests

**SCR-21 — Profile and occupant data.** Add to GUE-R01/R05: **emergency contacts** (name, relation, phone) per
occupant per stay (also in the continuity snapshot — rollout §6), optional **travel insurance** (insurer, policy
number, emergency line), **special assistance** needs (sensitive category, operational text), **nationality and
document country** as non-encrypted reporting attributes distinct from the encrypted document, **document capture
source and verification** (`portal | kiosk | desk_scanner | manual`; `unverified | vendor_verified | staff_verified`),
**guardian relationships** for minors (kids club pick-up authorizations reference them), and link allergy preferences
to `guest-services` allergy alerts (one source of truth: guests holds the data; guest-services holds alert versions and
acknowledgements).

**SCR-22 — Consent purposes.** Add `feedback` (surveys) and `review_invitation`; template classification in comms
gains these classes so a property can decide (with advice) whether they are operational or consent-gated per market.

### Finance and payments

**SCR-23 — Charge privileges and credit limits.** Per stay (default from rate plan/guarantee/market segment):
`chargePrivilege ∈ {allowed, cash_only, blocked}`, `creditLimit` per folio (amount or "up to authorized amount"),
`autoIncrementAt` (% of limit) → payments incremental-authorization request (PAY-R09) or a desk task; `postCharge` from
outlet sources (POS, outlet app, minibar, laundry) checks privilege and limit and returns `charge_not_allowed |
over_limit` with plain-language reasons; overrides with permission; all-inclusive coverage evaluated before limit
consumption. Exposed through `getChargeEligibility(tx, { stayId, outletId })` for POS lookup (SCR-07).

**SCR-24 — Invoice deadline and delivery.** Policy `finance.invoice.issueWithinDays` (Maldives pack: 3, from MIRA —
maldives-tax-rules §4) measured from service completion (departure for stays; service date for outlet sales); FIN-R44
exceptions for documents approaching/after the deadline; policy to auto-issue at checkout per payer; **document
delivery** (email via comms, portal download, print) with delivery status on the document; buyer details (company,
address, TIN) captured before issue.

**SCR-25 — Gratuities.** Charge-code group `gratuity` mapped to a tips-payable liability (not revenue), outside the
service-charge and GST base by default (tax rule data — tips outside GST base, maldives-tax-rules), shown separately on
documents; export per period for staff distribution (BOH payroll). Service-charge distribution report (amounts
collected by period and currency) as an export for BOH.

**SCR-26 — Stored-value vouchers.** Voucher accounts as liabilities (like deposits): `issueVoucher` after confirmed
payment (or as complimentary against an expense account with permission), unique code, currency, balance, expiry;
posting kind `voucher_redemption` (tender) idempotent per `(code, redemptionRef)`; partial redemption; expiry →
breakage per policy (`breakage:voucher:{id}`); refund path; tax point per voucher tax rule (`issue | redemption`, Q83).

**SCR-27 — Commissions.** FIN-R31 from SHOULD to MUST for properties with `contracting` or agency business:
commission accrual at departure from the snapshot, rules for no-show/cancellation commission, commission statements
per agency/OTA, settlement by offset (net invoicing) or payment-run export to AP (BOH). Add **commission receivable**
for concierge/concession suppliers (JG-24).

**SCR-28 — Deposits and periodic billing.** Damage/security deposit as a held liability (cash, bank transfer, or card
pre-authorization via payments) with a settlement workflow after the check-out condition report (deductions with
evidence, refund of remainder); periodic (weekly/monthly) invoices for long stays generated from SCR-19 rhythms.

**SCR-29 — Payments.** Internal **voucher** adapter (capabilities: `charge`, `refund`; provider = Portico voucher
ledger in finance; no card data); **card-present terminal workflow** for kiosk and express checkout (W-PAY-05) where the
property's acquirer supports semi-integrated terminals (Q2); damage-deposit pre-authorization purpose.

### Comms

**SCR-30 — Content packs, templates and links.** Market **content packs** (data, versioned, cited, verification date):
Maldives pack with IMUGA guidance (each traveller incl. children, within 96 h before arrival, official free portal; the
departure requirement marked unconfirmed), visa-on-arrival note, seaplane timing and transit-night explanation,
local-island customs for guesthouses. Template purposes added: `confirmation_document`, `entry_requirements`,
`self_check_in` (PIN release only after conditions, ACC-R15), `transit_night`, `invoice_delivery`. A template
variable `{guestLink:<purpose>}` rendered by the shared signed-link library (no call to `guest-experience`). Channel
`portal`. Conversation owner defaults to the stay's guest host when `guest-services` assigns one (GSV-R05).

**SCR-31 — Non-goals.** Replace "marketing campaigns and segmentation (integrate a CRM)" and "reputation/review
management (LATER via hub)" with "owned by `crm`; comms provides transport, templates and the sender register". Marketing
sends use effect `message.marketing` (SCR-04).

### Operations

**SCR-32 — Operations.** OPS-R08 minibar action records consumption into `guest-services` (GSV-R21) instead of posting
directly; OPS-R20 lost and found adds shipping (address and consent from the guest portal, courier and tracking
reference, customs value, payment request for shipping via payments) and claims as `guest-services` cases; task kinds
add `amenity`, `delivery`, `wake_up`, `luggage`, `dispatch`, `allergy_ack`; GRMS sensor inputs (DND, make-up room) as
integration sources for OPS-R03 with provenance `external`; long-stay condition inspections as an inspection kind.

### Resort

**SCR-33 — Dining reservations.** Retire RST-R09 in favour of `guest-services` venue reservations (GSV-R16–R20); the
itinerary (RST-R10) consumes `guestServices.venueReservation.*` events and shows them as items; special dining keeps
using resort resources (boats, chefs) through GSV-R19.

**SCR-34 — Seaplane cut-off and transit nights.** Policy data per transfer mode/operator: latest scheduled departure
for daylight legs and minimum connection time after international arrival (seaplane: daylight only, roughly
06:00–15:00/16:00 [V-web secondary], confirm per operator). On arrival-details capture or flight change, evaluate and,
if the connection is impossible, create a **transit plan** case with options: domestic flight + speedboat (where
operating), transit night at a sister property or an external hotel in Malé/Hulhumalé (booking or voucher, transfer
to the transit hotel, next-morning leg), or arrival-date shift (previewed reservations change); charges per contract or
policy (often guest-paid). Departures: plan the seaplane leg from the outbound flight backwards (latest leg arriving
≥ connection time), propose departure-lounge use (JG-35) or outbound transit nights.

**SCR-35 — Airport meet and greet.** Representative assignments per flight, arrivals board by flight with passenger
lists and status (met / no-show / delayed), lounge allocation and capacity, handover to the transfer leg; optional
flight-status integration (`flightStatus`, Q85) updating ETAs with provenance `external`; manual updates otherwise.

**SCR-36 — Kids club and diving.** Kids club: registration per child (guardian, authorized pick-up persons, allergy
alert link, swim ability, age group), sign-in/sign-out with the collecting adult verified, capacity per age group.
Diving: certification record (agency, level, number, verified by), last-dive date with refresher rule, medical
statement (signed declaration; "medical required" outcome blocks booking), regulatory limits as data (depth 30 m,
no decompression — [V-web]) per activity, equipment sizes, nitrox certification, dive log entries; medical eligibility
blocks from GSV-R12. Concession dive centres integrate via `activities` workflows.

**SCR-37 — Passenger data.** RST-R04 passenger details may be supplied by the guest portal (GXP-R07); weights are
collected only when the operator requires them, used for the manifest, and deleted N days after the leg (policy) —
never shown outside transfer roles.

### Distribution

**SCR-38 — Content and booking widget.** Promote DST-R18 content to SHOULD for **Portico's own surfaces**: property,
unit-type and policy content (multilingual, photos with alt text, amenities, local rules) used by the booking engine,
guest portal, Google and confirmation documents; OTA content sync stays LATER. Add indicative guest-currency display
(agreed price stays in the plan currency), an embeddable booking widget and deep links for the hotel's existing website,
and a voucher shop page (CRM-R21).

**SCR-39 — Booking-engine hardening and marketing hooks.** Bot and card-testing protection (rate limits per IP/device,
challenge on anomalies, velocity rules on payment attempts, PSP risk signals where available); privacy notice and
cookie/tracking consent; marketing-consent checkbox (unticked, per legal entity — GUE-R06); attribution capture
(campaign parameters, referrer, click ids) stored on the booking only with consent where required; event
`distribution.checkout.abandoned` (consent-aware) for `crm`; voucher redemption as a tender at checkout (via payments);
multi-property search for groups (LATER → P2); parity check comparing Portico's own outbound channel rates with the
booking-engine price per date (P2); wholesale channels (`kind wholesale`) feed `contracting` booking checks.

### Groups, day close, analytics, AI, identity, readiness

**SCR-40 — Groups.** GRP-R11 allotments become the engine `contracting` compiles into: seasons with per-season release
days, kinds `allotment | free_sale | on_request | guaranteed` (guaranteed with attrition terms like GRP-R07), managed-by
markers, partner booking-time for stop-sale decisions. Add group kind `corporate_rfp` to the sales pipeline for annual
corporate rate negotiations (P2).

**SCR-41 — Day Close exceptions.** Add to DCL-R01: invoices approaching or past the issuance deadline (block or warn
per policy), departed stays with credentials `outstanding` or valid beyond departure + grace, departures without a
minibar check, allergy alerts unacknowledged for tomorrow's services, continuity snapshot older than 30 minutes,
amenity orders for tomorrow's VIP arrivals not confirmed (warning), open guest-facing folio queries on departed stays.

**SCR-42 — Analytics.** Metric catalog additions: NPS and ratings by department/outlet, review score and response
time, survey response rate, upsell offers/conversion/revenue by item and channel, service-recovery cost and cases per
100 stays, incidents by kind, production by tour operator/market/offer, allotment utilisation and release
performance, contract-check mismatch rate, online check-in completion rate, express checkout share; TIMS-format
export of arrivals and guest-nights by nationality (file — never presented as a submission).

**SCR-43 — AI.** Guest-facing drafting (review replies, survey follow-ups, quote texts) as suggestions requiring staff
send; any guest-facing automatic answer (portal chat, WhatsApp) is gated by Q84 and limited to approved content and
live tool results (availability and prices only from `rates`/`inventory` tools, never generated).

**SCR-44 — Identity.** Guest principals are not users: stay-scoped link tokens and OTP step-up sessions with their own
audit actor type (`guest`); kiosk and assisted-mode **device sessions** (paired devices, staff quick switch for
assisted mode); role templates: Guest relations/butler (exists as proposed), Security officer, Bell/driver, Concierge,
F&B outlet manager (allergy acknowledgement), Marketing manager, Contracts manager (load) and Revenue manager (approve).

**SCR-45 — Readiness register and personas.** Add readiness rows (R1) for each new module and integration workflow
(locks per vendor, PBX, Wi-Fi, IPTV/GRMS, review sources, flight data, ID verification, table systems) with external
approval columns; add personas: Security officer, Concierge/bell, Marketing manager, Contracts manager, Kitchen/outlet
manager (allergy acknowledgement) to `docs/product/personas-and-workspaces.md`.

## 3. Applying these requests

Order of application (dependencies first): SCR-01, SCR-02, SCR-04 → SCR-07, SCR-14, SCR-16/17, SCR-21, SCR-23 →
module SCRs → SCR-03 (editions) once prices are discussed (Q3) → SCR-06 scenarios with the first implementation of each
module. Each applied SCR is marked here with the date and the resulting requirement ids.
